import {YouTube,seconds} from './discovery.mjs';
import {videoFormat} from './video-format.mjs';

// Fifty metadata lookups in one API call per tick. Unresolved entries retry after
// a week; storing the attempt separately prevents newest Unknowns starving older ones.
export async function recheckVideoFormats(env,fetcher=fetch){
 if(!env.DB||!env.YOUTUBE_API_KEY)return {status:'blocked',processed:0};
 const db=env.DB,now=new Date().toISOString(),lease=String(Date.now()+120000);
 const lock=await db.prepare("INSERT INTO state(key,value) VALUES('format-recheck-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(lease,Date.now()).run();
 if(!lock.meta?.changes)return {status:'busy',processed:0};
 try{
  const cutoff=new Date(Date.now()-7*86400000).toISOString();
  const rows=(await db.prepare(`SELECT v.id,v.channel_id FROM videos v
   LEFT JOIN state s ON s.key='format-check-v1:'||v.id
   WHERE v.format='UNKNOWN' AND v.format_locked=0 AND v.available=1
   AND (s.value IS NULL OR json_extract(s.value,'$.at')<?)
   AND EXISTS(SELECT 1 FROM matches m JOIN performers p ON p.id=m.performer_id
    WHERE m.video_id=v.id AND m.status IN ('CONFIRMED','PROBABLE') AND p.status='active'
    AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.video_id=v.id AND e.performer_id=m.performer_id))
   ORDER BY COALESCE(json_extract(s.value,'$.at'),''),v.published_at DESC,v.id LIMIT 50`).bind(cutoff).all()).results;
  if(!rows.length)return {status:'complete',processed:0,updated:0};
  const api=new YouTube(env.YOUTUBE_API_KEY,fetcher,db);
  const data=await api.get('videos',{part:'snippet,contentDetails,status,player',maxWidth:480,id:rows.map(v=>v.id).join(',')});
  const items=new Map((data.items||[]).map(v=>[v.id,v])),writes=[],resolved=new Set();
  for(const row of rows){
   const item=items.get(row.id),valid=item?.status?.privacyStatus==='public'&&item.snippet?.channelId===row.channel_id;
   const format=valid?videoFormat(item,seconds(item.contentDetails?.duration)):'UNKNOWN';
   if(format!=='UNKNOWN')resolved.add(row.id);
   const evidence={at:now,format,duration:valid?seconds(item.contentDetails?.duration):null,width:item?.player?.embedWidth??null,height:item?.player?.embedHeight??null,source:'YouTube metadata format recheck'};
   writes.push(db.prepare("UPDATE videos SET format=? WHERE id=? AND channel_id=? AND format='UNKNOWN' AND format_locked=0 AND available=1").bind(format,row.id,row.channel_id));
   writes.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('format-check-v1:'+row.id,JSON.stringify(evidence)));
  }
  const results=await db.batch(writes);let updated=0;
  for(let i=0;i<rows.length;i++)if(resolved.has(rows[i].id)&&results[i*2]?.meta?.changes)updated++;
  const result={status:'checked',at:now,processed:rows.length,updated};
  await db.prepare("INSERT INTO state(key,value) VALUES('format-recheck-last',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(result)).run();
  return result;
 }finally{await db.prepare("DELETE FROM state WHERE key='format-recheck-lease' AND value=?").bind(lease).run();}
}
