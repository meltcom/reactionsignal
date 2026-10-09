import {database,seedDatabase} from './db.mjs';
import {classify} from './discovery.mjs';
import {feedEntries, boundedBody} from './push.mjs';
// Only known, eligible channel IDs are polled; feed IDs remain untrusted hints.
export async function pollRss(env,seed,fetcher=fetch){
 const db=database(env);await seedDatabase(db,seed);
 const now=Date.now(),at=new Date(now).toISOString(),lease=String(now+60000);
 const acquired=await db.prepare("INSERT INTO state(key,value) VALUES('rss-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(lease,now).run();
 if(!acquired.meta.changes)return {status:'busy'};
 let checked=0,queued=0,failed=0;const deadline=now+12000;
 try{
  const performers=(await db.prepare("SELECT aliases FROM performers WHERE discovery_enabled=1 AND id='missioned-souls'").all()).results;
  const aliases=performers.flatMap(p=>JSON.parse(p.aliases));
  if(!aliases.length)return {status:'idle',checked,queued,failed};
  const rows=(await db.prepare("SELECT c.id FROM channels c LEFT JOIN rss_checks r ON r.channel_id=c.id WHERE c.discovery_scope='eligible' AND (r.retry_at IS NULL OR r.retry_at<=?) AND (r.checked_at IS NULL OR r.checked_at<?) ORDER BY COALESCE(r.checked_at,''),c.id LIMIT 40").bind(at,new Date(now-30*60000).toISOString()).all()).results;
  for(let offset=0;offset<rows.length&&Date.now()<deadline;offset+=4){
   await Promise.all(rows.slice(offset,offset+4).map(async c=>{
    if(!/^UC[\w-]{22}$/.test(c.id))return;
    try{
     const response=await fetcher(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.id}`,{signal:AbortSignal.timeout(3000),redirect:'error'});
     if(!response.ok)throw new Error('Feed unavailable');
     const xml=new TextDecoder().decode(await boundedBody(response));
     if(!/<feed\b/.test(xml)||!/<\/feed\s*>/.test(xml))throw new Error('Invalid feed');
     feedEntries(xml,c.id); // Validate every entry, even ones filtered by title.
     const ids=[];
     for(const entry of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/g)){
      const title=/<title\b[^>]*>([\s\S]*?)<\/title\s*>/.exec(entry[1])?.[1];
      if(!title||classify(title,aliases,null))ids.push(...feedEntries(`<entry>${entry[1]}</entry>`,c.id));
     }
     for(const id of new Set(ids)){
      // Polling repeats do not reset retries or reopen completed jobs.
      const result=await db.prepare('INSERT OR IGNORE INTO push_jobs(video_id,channel_id,received_at,source) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM videos WHERE id=?)').bind(id,c.id,at,'RSS fallback',id).run();
      queued+=result.meta.changes||0;
      if(result.meta.changes)await db.prepare('INSERT OR IGNORE INTO notification_receipts(video_id,source,received_at) VALUES(?,?,?)').bind(id,'RSS fallback',at).run();
     }
     await db.prepare('INSERT INTO rss_checks(channel_id,checked_at) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET checked_at=excluded.checked_at,retry_at=NULL,error=NULL').bind(c.id,at).run();checked++;
    }catch{
     failed++;await db.prepare('INSERT INTO rss_checks(channel_id,checked_at,retry_at,error) VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET checked_at=excluded.checked_at,retry_at=excluded.retry_at,error=excluded.error').bind(c.id,at,new Date(now+3600000).toISOString(),'Feed unavailable or invalid; retry scheduled').run();
    }
   }));
  }
  await db.prepare("INSERT INTO state(key,value) VALUES('rss-last-batch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({at,checked,queued,failed})).run();
 }finally{await db.prepare("DELETE FROM state WHERE key='rss-lease' AND value=?").bind(lease).run();}
 return {status:failed?'partial':'checked',checked,queued,failed};
}
