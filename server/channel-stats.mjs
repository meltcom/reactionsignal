import { database, batches } from './db.mjs';
import { YouTube } from './discovery.mjs';

// One 50-channel batch per existing cron invocation; no visitor API requests.
export async function refreshChannelStats(env, fetcher=fetch, now=new Date()) {
  if (!env.YOUTUBE_API_KEY) return {status:'blocked', calls:0};
  const db=database(env), at=now.toISOString(), cutoff=new Date(+now-86400000).toISOString();
  const lease=String(+now+300000);
  const lock=await db.prepare("INSERT INTO state(key,value) VALUES('channel-stats-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(lease,+now).run();
  if (!lock.meta.changes) return {status:'busy',calls:0};
  const api=new YouTube(env.YOUTUBE_API_KEY,fetcher,db);
  try {
    const rows=(await db.prepare(`SELECT c.id,s.value FROM channels c LEFT JOIN state s ON s.key='youtube-channel-stats:'||c.id
      WHERE c.id GLOB 'UC*' AND length(c.id)=24
      AND (json_extract(s.value,'$.updatedAt') IS NULL OR json_extract(s.value,'$.updatedAt')<=?)
      AND (json_extract(s.value,'$.retryAt') IS NULL OR json_extract(s.value,'$.retryAt')<=?)
      ORDER BY COALESCE(json_extract(s.value,'$.attemptedAt'),'') ASC,c.id LIMIT 50`).bind(cutoff,at).all()).results;
    if (!rows.length) return {status:'current',calls:0};
    let response, error;
    try {response=await api.get('channels',{part:'snippet,statistics',id:rows.map(r=>r.id).join(','),maxResults:50});if(!Array.isArray(response.items))throw new Error('Invalid YouTube response');}
    catch(e) {error=e.message;}
    const items=new Map((response?.items||[]).map(c=>[c.id,c]));
    let updated=0, unavailable=0;
    const statements=rows.map(row=>{
      const previous=row.value?JSON.parse(row.value):{}, item=items.get(row.id);
      const next={...previous,attemptedAt:at};
      if (error) {next.error=error;next.retryAt=new Date(+now+3600000).toISOString();}
      else if (!item) {unavailable++;next.availability='unavailable';next.error='Channel not returned by YouTube';next.retryAt=new Date(+now+86400000).toISOString();}
      else {
        updated++;next.updatedAt=at;next.retryAt=null;next.error=null;next.availability='available';
        const count=value=>value!==undefined&&/^\d+$/.test(String(value))?Number(value):null;
        next.subscribersHidden=Boolean(item.statistics?.hiddenSubscriberCount);
        next.subscribers=next.subscribersHidden?null:count(item.statistics?.subscriberCount);
        next.channelViews=count(item.statistics?.viewCount);next.channelVideoCount=count(item.statistics?.videoCount);
        next.youtubeName=item.snippet?.title||null;next.description=item.snippet?.description||null;
        next.thumbnailUrl=item.snippet?.thumbnails?.medium?.url||item.snippet?.thumbnails?.default?.url||null;
      }
      return db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('youtube-channel-stats:'+row.id,JSON.stringify(next));
    });
    const report={status:error?'retry':unavailable?'partial':'succeeded',at,checked:rows.length,updated,unavailable,calls:api.calls,error:error||null};
    statements.push(db.prepare("INSERT INTO state(key,value) VALUES('channel-stats-last-batch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(report)));
    // Invalidate cached catalog data after stats or availability changes.
    statements.push(db.prepare("INSERT INTO state(key,value) VALUES('catalog-revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(state.value AS INTEGER)+1"));
    await batches(db,statements);
    return report;
  } finally {
    await db.prepare("DELETE FROM state WHERE key='channel-stats-lock' AND value=?").bind(lease).run();
  }
}
