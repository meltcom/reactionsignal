import {database} from './db.mjs';
import {YouTube,seconds} from './discovery.mjs';
import {recommend} from './recheck.mjs';
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
export function validateCandidates(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw new Error('Provide 1–100 video IDs per batch.');
 const found=new Map();for(const r of rows){if(!r||!/^[\w-]{11}$/.test(r.id)||!/^UC[\w-]{22}$/.test(r.channelId))throw new Error('Each video needs its expected YouTube channel ID.');if(found.has(r.id)&&found.get(r.id).channelId!==r.channelId)throw new Error('Conflicting channel IDs.');found.set(r.id,{id:r.id,channelId:r.channelId});}return [...found.values()];
}
export async function reconcile(request,env,user,fetcher=fetch){
 if(!user?.moderator)return json({error:'Moderator access required.'},403);
 const db=database(env),u=new URL(request.url);
 if(request.method==='GET')return json({items:(await db.prepare("SELECT value FROM state WHERE key LIKE 'reconciliation-receipt:%' ORDER BY key DESC LIMIT 20").all()).results.map(r=>JSON.parse(r.value))});
 if(request.method!=='POST')return json({error:'POST required.'},405);
 if(request.headers.get('Origin')!==u.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Submit from the Reaction Journey website.'},403);
 try{
 const reader=request.body?.getReader();if(!reader)return json({error:'Batch required.'},400);let raw='',size=0;const decoder=new TextDecoder();for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>40000){await reader.cancel();return json({error:'Batch too large.'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 const candidates=validateCandidates(JSON.parse(raw).candidates);
 if(!env.YOUTUBE_API_KEY)return json({error:'YouTube discovery credentials are not configured.'},503);
 const performer=await db.prepare("SELECT * FROM performers WHERE id='missioned-souls'").first();
 if(!performer||performer.status!=='active')return json({error:'Missioned Souls is not active.'},409);
 const api=new YouTube(env.YOUTUBE_API_KEY,fetcher,db),items=new Map();
 for(let i=0;i<candidates.length;i+=50){const page=await api.get('videos',{id:candidates.slice(i,i+50).map(r=>r.id).join(','),part:'snippet,contentDetails,status',maxResults:50});for(const item of page.items||[])items.set(item.id,item);}
 const now=new Date().toISOString(),run=crypto.randomUUID(),source='Moderator reconciliation '+run,results=[],work=[];
 const oldMatches=new Map(),exclusions=new Map(),channels=new Map(),videos=new Map(),knownChannels=new Set();
 for(let offset=0;offset<candidates.length;offset+=50){
 const chunk=candidates.slice(offset,offset+50),ids=chunk.map(r=>r.id),cids=[...new Set(chunk.map(r=>r.channelId))],marks=ids.map(()=>'?').join(','),cm=cids.map(()=>'?').join(',');
 for(const r of (await db.prepare(`SELECT * FROM matches WHERE performer_id='missioned-souls' AND video_id IN (${marks})`).bind(...ids).all()).results)oldMatches.set(r.video_id,r);
 for(const r of (await db.prepare(`SELECT * FROM exclusions WHERE performer_id='missioned-souls' AND video_id IN (${marks})`).bind(...ids).all()).results)exclusions.set(r.video_id,r);
 for(const r of (await db.prepare(`SELECT * FROM videos WHERE id IN (${marks})`).bind(...ids).all()).results)videos.set(r.id,r);
 for(const r of (await db.prepare(`SELECT * FROM channels WHERE id IN (${cm})`).bind(...cids).all()).results)channels.set(r.id,r);
 for(const r of (await db.prepare(`SELECT DISTINCT v.channel_id FROM matches m JOIN videos v ON v.id=m.video_id WHERE m.performer_id='missioned-souls' AND m.status='CONFIRMED' AND v.available=1 AND v.channel_id IN (${cm}) AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)`).bind(...cids).all()).results)knownChannels.add(r.channel_id);
 }
 for(const candidate of candidates){
 const {id,channelId}=candidate,item=items.get(id),prior=oldMatches.get(id),exclusion=exclusions.get(id),channel=channels.get(channelId),video=videos.get(id);
 const result={id,channelId,title:item?.snippet?.title||id};results.push(result);
 if(exclusion||prior){Object.assign(result,{outcome:exclusion?'excluded':'existing',status:prior?.status,reason:exclusion?.reason||'Existing decision preserved.'});continue;}
 if(!channel||!['eligible','other','review'].includes(channel.discovery_scope)||video&&(video.channel_id!==channelId||!video.available)){Object.assign(result,{outcome:'protected',reason:'Missing/held channel, unavailable record, or channel conflict.'});continue;}
 const proposal=recommend({source:'',review_mode:performer.review_mode,channel_id:channelId,format:video?.format||'UNKNOWN',aliases:performer.aliases,other_aliases:'[]',known_reactor:knownChannels.has(channelId)},item);
 Object.assign(result,{outcome:proposal.outcome,reason:proposal.reason});
 if(!item||item.status?.privacyStatus!=='public'||item.snippet?.channelId!==channelId||['unrelated','protected'].includes(proposal.outcome))continue;
 const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const evidence=' '+normalize(item.snippet.title)+' ';
 if(!JSON.parse(performer.aliases).some(a=>evidence.includes(' '+normalize(a)+' '))&&proposal.outcome!=='strong'){result.outcome='uncertain';result.reason='Performer not established in title; retained in receipt for review, not imported.';continue;}
 const status=proposal.outcome==='strong'?'CONFIRMED':'PENDING',format=video?.format||((seconds(item.contentDetails?.duration)||0)>180?'FULL_LENGTH':'UNKNOWN');
 const guard="NOT EXISTS(SELECT 1 FROM exclusions WHERE performer_id='missioned-souls' AND video_id=?) AND NOT EXISTS(SELECT 1 FROM matches WHERE performer_id='missioned-souls' AND video_id=?) AND EXISTS(SELECT 1 FROM channels WHERE id=? AND discovery_scope IN ('eligible','other','review')) AND EXISTS(SELECT 1 FROM performers WHERE id='missioned-souls' AND status='active' AND aliases=? AND review_mode=?)";
 work.push(
 db.prepare(`INSERT OR IGNORE INTO videos(id,channel_id,title,published_at,discovered_at,checked_at,format,available) SELECT ?,?,?,?,?,?,?,1 WHERE ${guard}`).bind(id,channelId,item.snippet.title,item.snippet.publishedAt||null,now,now,format,id,id,channelId,performer.aliases,performer.review_mode),
 db.prepare(`INSERT OR IGNORE INTO matches(performer_id,video_id,status,source) SELECT 'missioned-souls',?,?,? WHERE ${guard} AND EXISTS(SELECT 1 FROM videos WHERE id=? AND channel_id=? AND available=1 AND format=?)`).bind(id,status,source,id,id,channelId,performer.aliases,performer.review_mode,id,channelId,format)
 );
 Object.assign(result,{outcome:'candidate',status});
 }
 for(let i=0;i<work.length;i+=80)await db.batch(work.slice(i,i+80));
 for(const result of results.filter(r=>r.outcome==='candidate')){
 const {id}=result;
 const after=await db.prepare("SELECT status,source FROM matches WHERE performer_id='missioned-souls' AND video_id=?").bind(id).first();
 Object.assign(result,after?.source===source?{outcome:'added',status:after.status}:{outcome:'protected',reason:'Catalog changed during checking; no decision overwritten.'});
 }
 const receipt={id:run,actor:user.id,at:now,apiCalls:api.calls,results};
 await db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('reconciliation-receipt:'+now+':'+run,JSON.stringify(receipt)).run();
 return json(receipt);
 }catch(e){return json({error:/Provide|Each video|Conflicting|JSON/.test(e.message)?e.message:'Reconciliation could not finish. Retry safely; existing decisions are preserved.'},400);}
}
