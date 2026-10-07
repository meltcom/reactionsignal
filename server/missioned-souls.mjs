import {categoryRegistry,manageCategories} from "./ms-categories.mjs";
import {normalizeVideo,suggestCategories,classifyShort} from '../missioned-souls-core.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const upsert=(db,key,value)=>db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value));
async function state(db,key){const r=await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first();return r?JSON.parse(r.value):null;}
export async function readMissionedSouls(db,seed){
 const registry=await categoryRegistry(db);
 const rows=(await db.prepare("SELECT key,value FROM state WHERE key LIKE 'ms-video:%' OR key LIKE 'ms-history:%'").all()).results;
 const videos=new Map(seed.videos.map(v=>{const n=normalizeVideo(v,registry.items.map(c=>c.id));return [n.id,n];})),history=new Map();
 for(const r of rows){const v=JSON.parse(r.value);if(r.key.startsWith('ms-video:'))videos.set(v.id,v);else{const h=history.get(v.id)||[];h.push(v);history.set(v.id,h);}}
 const refresh=await state(db,'ms-refresh');
 return {categoryDefinitions:registry.items,categoryRevision:registry.revision,videos:[...videos.values()].map(v=>({...v,history:history.get(v.id)||[]})),coverage:refresh?.lastCompleteAt?'Official-channel upload scan completed '+refresh.lastCompleteAt+'. Category review and Facebook / other-source coverage may still be incomplete.':(await state(db,'ms-coverage'))?.message||seed.coverage,refresh,updatedAt:(await state(db,'ms-updated'))?.at||null};
}
async function saveVideos(db,items,{manual=false}={}){
 const registry=await categoryRegistry(db);
 const normalized=items.map(v=>normalizeVideo(v,registry.items.map(c=>c.id))),ops=[];
 // Validate complete imports before the first write, including historical snapshots.
 const histories=items.map((item,index)=>{if(item.history==null)return [];if(!Array.isArray(item.history)||item.history.length>400)throw new Error('Use at most 400 daily snapshots per video.');return item.history.map(s=>{if(!s||!Number.isFinite(Date.parse(s.at))||!Number.isSafeInteger(s.views)||s.views<0)throw new Error('History needs dated, nonnegative whole view counts.');return {id:normalized[index].id,at:new Date(s.at).toISOString(),views:s.views};});});
 for(const [index,item] of normalized.entries()){const old=await state(db,'ms-video:'+item.id);const v={...item};
  if(!manual&&old&&!old.reviewed)v.tags=[...new Set([...v.tags,...old.tags.filter(t=>t.startsWith('custom:'))])];
  if(!manual&&old?.reviewed){v.tags=old.tags;v.reviewed=true;v.youtubeEquivalent=old.youtubeEquivalent;}
  if(!manual&&typeof old?.shortsOverride==='boolean')Object.assign(v,classifyShort(v,old.shortsOverride));
  ops.push(upsert(db,'ms-video:'+v.id,v));
  for(const s of histories[index])ops.push(upsert(db,'ms-history:'+v.id+':'+s.at.slice(0,10),s));
  if(v.statsAt&&v.views!=null)ops.push(upsert(db,'ms-history:'+v.id+':'+v.statsAt.slice(0,10),{id:v.id,at:v.statsAt,views:v.views}));
 }
 for(let i=0;i<ops.length;i+=50)await db.batch(ops.slice(i,i+50));
 await upsert(db,'ms-updated',{at:new Date().toISOString()}).run();return normalized.length;
}
export async function refreshMissionedSouls(env,seed,fetcher=fetch){
 const db=env.DB;if(!db)return {status:'blocked',message:'Catalog storage is unavailable.'};
 if(!env.YOUTUBE_API_KEY)return {status:'blocked',message:'YouTube API access is not configured. Import a saved catalog, or configure YOUTUBE_API_KEY on the server.'};
 const now=new Date().toISOString();
 // Database compare-and-set prevents concurrent manual and scheduled scans.
 const lock=await db.prepare("INSERT INTO state(key,value) VALUES('ms-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER) < ?").bind(String(Date.now()+300000),Date.now()).run();
 if(!lock.meta?.changes)return {status:'busy',message:'A refresh is already running.'};
 let progress=await state(db,'ms-refresh')||{};
 const api=async(endpoint,params)=>{const u=new URL('https://www.googleapis.com/youtube/v3/'+endpoint);for(const [k,v]of Object.entries({...params,key:env.YOUTUBE_API_KEY}))u.searchParams.set(k,v);const r=await fetcher(u,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('YouTube refresh failed ('+r.status+'). Existing catalog preserved.');return r.json();};
 try{
  if(!progress.uploads){const c=await api('channels',{part:'contentDetails',forHandle:'@MissionedSouls'});if(!c.items?.[0])throw new Error('Official YouTube channel not found.');progress.uploads=c.items[0].contentDetails.relatedPlaylists.uploads;progress.channelId=c.items[0].id;}
  let pageToken=progress.nextPage||'',added=0,done=false;
  // Four upload pages per invocation; the next invocation resumes older uploads.
  for(let page=0;page<4;page++){
   const p=await api('playlistItems',{part:'contentDetails',playlistId:progress.uploads,maxResults:'50',...(pageToken?{pageToken}:{})});
   const ids=p.items.map(x=>x.contentDetails.videoId);
   if(ids.length){const data=await api('videos',{part:'snippet,statistics,contentDetails',id:ids.join(',')});
    const items=data.items.filter(v=>v.snippet.channelId===progress.channelId).map(v=>({title:v.snippet.title,url:'https://www.youtube.com/watch?v='+v.id,publishedAt:v.snippet.publishedAt,statsAt:now,views:v.statistics?.viewCount??null,likes:v.statistics?.likeCount??null,comments:v.statistics?.commentCount??null,tags:suggestCategories(v.snippet.title),sourceNote:'Official channel YouTube API import; suggested categories need review.'}));
    added+=await saveVideos(db,items);
    const found=new Set(data.items.map(v=>v.id));for(const id of ids)if(!found.has(id)){const old=await state(db,'ms-video:yt:'+id);if(old)await upsert(db,'ms-video:yt:'+id,{...old,available:false}).run();}
   }
   pageToken=p.nextPageToken||'';if(!pageToken){done=true;break;}
  }
  progress={...progress,nextPage:pageToken,status:done?'complete':'continuing',lastBatchAt:now,lastCompleteAt:done?now:progress.lastCompleteAt||null,message:done?'Full upload pass complete.':'More uploads remain; next refresh continues the scan.',count:added};
  await upsert(db,'ms-refresh',progress).run();return progress;
 }catch(error){progress={...progress,status:'error',message:error.message,lastAttemptAt:now};await upsert(db,'ms-refresh',progress).run();return progress;}
 finally{await db.prepare("DELETE FROM state WHERE key='ms-lock'").run();}
}
export async function missionedSouls(request,env,seed,user){
 try{
  if(!user?.id)return json({error:'Sign in to view MS Journey.'},401);
  if(request.method==='GET'){const data=await readMissionedSouls(env.DB,seed);if(!user.moderator)data.videos=data.videos.map(({sourceNote,...v})=>v);return json({...data,moderator:!!user.moderator,apiConfigured:!!env.YOUTUBE_API_KEY});}
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!user.moderator)return json({error:'Moderator access required.'},403);
  if(Number(request.headers.get('Content-Length'))>2000000)return json({error:'Import is too large.'},413);
  const raw=await request.text();if(raw.length>2000000)return json({error:'Import is too large.'},413);const b=JSON.parse(raw);
  if(b.action==='categories')return manageCategories(env.DB,b);
  if(b.action==='refresh')return json(await refreshMissionedSouls(env,seed));
  if(b.action==='set-short'){
   if(typeof b.isShort!=='boolean'||typeof b.id!=='string')return json({error:'Choose a video and whether it is a Short.'},400);
   const video=(await readMissionedSouls(env.DB,seed)).videos.find(v=>v.id===b.id);
   if(!video)return json({error:'Video not found.'},404);
   await saveVideos(env.DB,[classifyShort(video,b.isShort)],{manual:true});
   return json({ok:true,message:b.isShort?'Video categorized as Shorts.':'Shorts category removed.'});
  }
  if(b.action==='save'||b.action==='import'){
   const items=b.action==='save'?[b.video]:b.videos;
   if(!Array.isArray(items)||!items.length||items.length>1000)return json({error:'Import 1–1000 videos per file.'},400);
   const count=await saveVideos(env.DB,items,{manual:true});if(b.action==='import')await upsert(env.DB,'ms-coverage',{message:'Imported catalog records. Completeness depends on the input files; category and source coverage need review.'}).run();return json({ok:true,message:count+' video records saved.'});
  }
  return json({error:'Unknown action'},400);
 }catch(error){return json({error:error.message||'Catalog request failed.'},400);}
}

// Start only after a moderator initiates collection; then continue bounded batches.
export async function scheduledMissionedSouls(env,seed,fetcher=fetch){
 if(!env.DB||!env.YOUTUBE_API_KEY)return {status:'idle'};
 const progress=await state(env.DB,'ms-refresh');
 if(!progress)return {status:'idle'};
 const since=Date.now()-Date.parse(progress.lastCompleteAt||0);
 if(progress.status==='complete'&&since<86400000)return {status:'waiting'};
 if(progress.status==='error'&&Date.now()-Date.parse(progress.lastAttemptAt)<3600000)return {status:'waiting'};
 return refreshMissionedSouls(env,seed,fetcher);
}
