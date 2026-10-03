import {database} from './db.mjs';
import {YouTube,seconds} from './discovery.mjs';
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const mentions=(s,aliases)=>aliases.some(a=>a&&` ${norm(s)} `.includes(` ${norm(a)} `));
export function recommend(row,item){
 if(/moderator|manual/i.test(row.source))return {outcome:'protected',reason:'Explicit moderator/manual hold is preserved.'};
 if(row.review_mode!=='auto')return {outcome:'protected',reason:'Performer policy requires moderator approval.'};
 if(!item||item.status?.privacyStatus!=='public')return {outcome:'uncertain',reason:'Public video metadata is unavailable; no automatic removal.'};
 if(item.snippet?.channelId!==row.channel_id)return {outcome:'protected',reason:'Channel identity conflicts with the catalog.'};
 const duration=seconds(item.contentDetails?.duration),title=item.snippet?.title||'',description=item.snippet?.description||'';
 if(row.format==='SHORT'||duration!==null&&duration<=180||/\b(shorts?|excerpt|teaser|clip|preview)\b/i.test(title))return {outcome:'shorts',reason:'Possible Short or excerpt; duration alone does not establish format.'};
 if(duration===null)return {outcome:'uncertain',reason:'Duration is unknown.'};
 const aliases=JSON.parse(row.aliases),inTitle=mentions(title,aliases),inDescription=mentions(description,aliases);
 if(!inTitle&&!inDescription)return {outcome:'unrelated',reason:'No exact performer name found in title or description; review before excluding.'};
 const otherAliases=JSON.parse(row.other_aliases||'[]').flatMap(a=>JSON.parse(a)).filter(a=>!aliases.some(current=>norm(current)===norm(a)));
 if(inTitle&&mentions(title,otherAliases))return {outcome:'uncertain',reason:'Title names multiple covered performers; review the performer match.'};
 const reactionTitle=/\b(reacts?|reaction|reacting)\b/i.test(title);
 // Restrict description evidence to a sentence also naming the performer.
 const reactionDescription=description.split(/[\n.!?]+/).some(sentence=>mentions(sentence,aliases)&&/\b(reacts?|reaction|reacting)\b/i.test(sentence));
 if(!row.known_reactor)return {outcome:'uncertain',reason:'Channel is not yet supported by a verified master record or a confirmed reaction.'};
 if(inTitle&&reactionTitle||reactionDescription&&(inTitle||reactionTitle))return {outcome:'strong',reason:'Known reactor, exact performer evidence, reaction wording and duration over three minutes agree. Metadata does not verify video contents.'};
 return {outcome:'uncertain',reason:'Performer is mentioned, but reaction context is not strong enough.'};
}
export async function recheckStatus(db){
 const enabled=await db.prepare("SELECT value FROM state WHERE key='recheck-enabled'").first();
 const state=await db.prepare("SELECT value FROM state WHERE key='recheck-last'").first();
 const groups=(await db.prepare(`SELECT COALESCE(r.outcome,'unprocessed') outcome,COUNT(*) count FROM matches m JOIN videos v ON v.id=m.video_id JOIN performers p ON p.id=m.performer_id LEFT JOIN review_previews r ON r.performer_id=m.performer_id AND r.video_id=m.video_id AND r.original_source=m.source AND r.original_title=v.title AND r.original_format=v.format AND r.aliases=p.aliases AND r.review_mode=p.review_mode AND r.checked_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours') WHERE m.status='PENDING' AND p.status='active' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id) GROUP BY COALESCE(r.outcome,'unprocessed')`).all()).results;
 return {enabled:enabled?.value==='1',last:state?JSON.parse(state.value):null,groups};
}
export async function recheckBatch(env,fetcher=fetch){
 const db=database(env),setting=await db.prepare("SELECT value FROM state WHERE key='recheck-enabled'").first();
 if(setting?.value!=='1')return {status:'paused',processed:0};
 if(!env.YOUTUBE_API_KEY)return {status:'blocked',processed:0,message:'YouTube API key is not configured.'};
 const lease=await db.prepare("INSERT INTO state(key,value) VALUES('recheck-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(String(Date.now()+120000),Date.now()).run();if(!lease.meta.changes)return {status:'busy',processed:0};
 const now=new Date().toISOString(),api=new YouTube(env.YOUTUBE_API_KEY,fetcher);let result;
 try{
  const rows=(await db.prepare(`SELECT m.performer_id,m.video_id,m.source,v.title original_title,v.channel_id,v.format,p.aliases,p.review_mode,(SELECT json_group_array(other.aliases) FROM performers other WHERE other.id<>m.performer_id AND other.status='active') other_aliases,
   CASE WHEN EXISTS(SELECT 1 FROM matches known JOIN videos kv ON kv.id=known.video_id WHERE known.performer_id=m.performer_id AND kv.channel_id=v.channel_id AND known.status='CONFIRMED' AND kv.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions ex WHERE ex.performer_id=known.performer_id AND ex.video_id=known.video_id)) OR EXISTS(SELECT 1 FROM state s WHERE s.key='master-channel-snapshot:'||v.channel_id AND json_extract(s.value,'$.status') LIKE 'VERIFIED%') THEN 1 ELSE 0 END known_reactor
   FROM matches m JOIN videos v ON v.id=m.video_id JOIN performers p ON p.id=m.performer_id LEFT JOIN review_previews r ON r.performer_id=m.performer_id AND r.video_id=m.video_id
   WHERE m.status='PENDING' AND p.status='active' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)
   AND (r.video_id IS NULL OR r.original_source<>m.source OR r.original_title<>v.title OR r.original_format<>v.format OR r.aliases<>p.aliases OR r.review_mode<>p.review_mode OR r.checked_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours'))
   ORDER BY COALESCE(r.checked_at,''),m.video_id,m.performer_id LIMIT 50`).all()).results;
  const ids=[...new Set(rows.filter(r=>!/moderator|manual/i.test(r.source)&&r.review_mode==='auto').map(r=>r.video_id))];
  const data=ids.length?await api.get('videos',{part:'snippet,contentDetails,status',id:ids.join(',')}):{items:[]};
  const items=new Map((data.items||[]).map(v=>[v.id,v]));
  const ops=rows.map(row=>{const proposal=recommend(row,items.get(row.video_id));return db.prepare(`INSERT INTO review_previews(performer_id,video_id,outcome,reason,checked_at,original_source,original_title,original_format,channel_id,aliases,review_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(performer_id,video_id) DO UPDATE SET outcome=excluded.outcome,reason=excluded.reason,checked_at=excluded.checked_at,original_source=excluded.original_source,original_title=excluded.original_title,original_format=excluded.original_format,channel_id=excluded.channel_id,aliases=excluded.aliases,review_mode=excluded.review_mode`).bind(row.performer_id,row.video_id,proposal.outcome,proposal.reason,now,row.source,row.original_title,row.format,row.channel_id,row.aliases,row.review_mode);});
  if(ops.length)await db.batch(ops);result={status:'preview',processed:rows.length,calls:api.calls,at:now};
 }catch{result={status:'error',processed:0,calls:api.calls,at:now,message:'Metadata recheck failed; pending decisions are unchanged. Retry the batch.'};}
 finally{await db.prepare("INSERT INTO state(key,value) VALUES('recheck-last',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(result)).run();await db.prepare("DELETE FROM state WHERE key='recheck-lease'").run();}
 return result;
}
export async function publishPreview(db,user){
 const now=new Date().toISOString(),cutoff=new Date(Date.now()-86400000).toISOString();
 const rows=(await db.prepare("SELECT r.* FROM review_previews r JOIN matches m ON m.performer_id=r.performer_id AND m.video_id=r.video_id JOIN videos v ON v.id=m.video_id JOIN performers p ON p.id=m.performer_id WHERE r.outcome='strong' AND r.checked_at>=? AND m.status='PENDING' AND m.source=r.original_source AND v.title=r.original_title AND v.format=r.original_format AND v.channel_id=r.channel_id AND v.available=1 AND p.aliases=r.aliases AND p.review_mode='auto' AND p.status='active' AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id) ORDER BY r.checked_at DESC LIMIT 50").bind(cutoff).all()).results;
 let published=0;
 for(const r of rows){
  const source='Moderator applied metadata preview:'+crypto.randomUUID();
  const results=await db.batch([
   db.prepare(`UPDATE matches SET status='CONFIRMED',source=? WHERE performer_id=? AND video_id=? AND status='PENDING' AND source=? AND EXISTS(SELECT 1 FROM videos v WHERE v.id=? AND v.title=? AND v.format=? AND v.channel_id=? AND v.available=1 AND v.format<>'SHORT') AND EXISTS(SELECT 1 FROM performers p WHERE p.id=? AND p.status='active' AND p.aliases=? AND p.review_mode='auto' AND p.review_mode=?) AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=? AND e.video_id=?)`).bind(source,r.performer_id,r.video_id,r.original_source,r.video_id,r.original_title,r.original_format,r.channel_id,r.performer_id,r.aliases,r.review_mode,r.performer_id,r.video_id),
   db.prepare("INSERT OR IGNORE INTO discovery_notifications(performer_id,video_id,created_at,source) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=? AND status='CONFIRMED' AND source=?)").bind(r.performer_id,r.video_id,now,'Metadata preview published',r.performer_id,r.video_id,source),
   db.prepare("INSERT INTO state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=? AND source=?)").bind('performer-audit:'+crypto.randomUUID(),JSON.stringify({actor:user.id,at:now,action:'publish-metadata-preview',performerId:r.performer_id,videoId:r.video_id,reason:r.reason}),r.performer_id,r.video_id,source)
  ]);published+=Number(results[0].meta?.changes||0);
 }
 return {published,message:`${published} strong preview matches published. Changed decisions and exclusions were skipped.`};
}
