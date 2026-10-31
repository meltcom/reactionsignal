import {quotaFetch} from './youtube-quota.mjs';
import snapshot from '../ms-playlist-catalog.json' with {type:'json'};
import {playlistCatalog,yearCatalog} from '../ms-journey-catalog.mjs';
import {refreshPlaylists} from './ms-playlists.mjs';
import {categoryRegistry,manageCategories} from "./ms-categories.mjs";
import {normalizeVideo,suggestCategories,classifyShort} from '../missioned-souls-core.mjs';
import {canPublishDirectly} from './reputation.mjs';
import {fetchFacebookMetadata} from './facebook-metadata.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const upsert=(db,key,value)=>db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value));
async function state(db,key){const r=await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first();return r?JSON.parse(r.value):null;}
const youtubeSeconds=value=>{const m=String(value||'').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);return m?(Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0)):null;};
function historySnapshot(value,id){
 if(!value||!Number.isFinite(Date.parse(value.at)))throw new Error('History needs a valid observation date.');
 const number=key=>value[key]==null?null:Number.isSafeInteger(Number(value[key]))&&Number(value[key])>=0?Number(value[key]):(()=>{throw new Error('History statistics must be nonnegative whole numbers.');})();
 const snapshot={id,at:new Date(value.at).toISOString(),views:number('views'),likes:number('likes'),comments:number('comments'),statsPrecision:value.statsPrecision||'unknown',statsSource:String(value.statsSource||'').slice(0,200)};
 if(!['exact','rounded','unknown'].includes(snapshot.statsPrecision))throw new Error('History precision must be exact, rounded, or unknown.');
 if(snapshot.views==null&&snapshot.likes==null&&snapshot.comments==null)throw new Error('Each history snapshot needs views, likes, or comments.');
 return snapshot;
}
function validateThumbnail(value){
 if(typeof value!=='string'||value.length>180000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('Upload a JPEG thumbnail no larger than 128 KB.');
 let bytes;try{bytes=Uint8Array.from(atob(value.split(',')[1]),c=>c.charCodeAt(0));}catch{throw new Error('Invalid thumbnail encoding.');}
 if(bytes.length>131072||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error('Upload a valid JPEG thumbnail no larger than 128 KB.');
 let pos=2,dimensions=false;
 while(pos+4<bytes.length){if(bytes[pos++]!==255)throw new Error('Invalid JPEG thumbnail.');while(bytes[pos]===255)pos++;const marker=bytes[pos++];if(marker===218)break;const length=(bytes[pos]<<8)|bytes[pos+1];if(length<2||pos+length>bytes.length)throw new Error('Invalid JPEG thumbnail.');if([192,193,194].includes(marker)){const h=(bytes[pos+3]<<8)|bytes[pos+4],w=(bytes[pos+5]<<8)|bytes[pos+6];if(length<8||!w||!h||w>1280||h>720)throw new Error('Thumbnail dimensions must be at most 1280 × 720 pixels.');dimensions=true;}pos+=length;}
 if(!dimensions)throw new Error('Invalid JPEG thumbnail dimensions.');return value.slice('data:image/jpeg;base64,'.length);
}
export async function missionedSoulsThumbnail(request,env){
 const id=new URL(request.url).pathname.split('/').pop();
 if(!['GET','HEAD'].includes(request.method)||!/^[a-f0-9-]{36}$/.test(id||''))return new Response('Not found',{status:404});
 const saved=await state(env.DB,'ms-thumbnail:'+id);if(!saved?.data)return new Response('Not found',{status:404});
 const bytes=Uint8Array.from(atob(saved.data),c=>c.charCodeAt(0));
 return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length)}});
}
export async function readMissionedSouls(db,seed){
 const registry=await categoryRegistry(db);
 const rows=(await db.prepare("SELECT key,value FROM state WHERE key LIKE 'ms-video:%' OR key LIKE 'ms-history:%' OR key LIKE 'ms-visibility:%'").all()).results;
 const videos=new Map(seed.videos.map(v=>{const n=normalizeVideo(v,registry.items.map(c=>c.id));return [n.id,n];})),history=new Map(),visibility=new Map();
 for(const r of rows){const v=JSON.parse(r.value);if(r.key.startsWith('ms-video:'))videos.set(v.id,v);else if(r.key.startsWith('ms-visibility:'))visibility.set(v.id,v.visibility);else{const h=history.get(v.id)||[];h.push(v);history.set(v.id,h);}}
 const refresh=await state(db,'ms-refresh');
 const playlists=await state(db,'ms-playlists')||snapshot;
 const catalog=playlistCatalog([...videos.values()].map(v=>({...v,visibility:visibility.get(v.id)||'visible',history:(history.get(v.id)||[]).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))})),registry.items,playlists.playlists);
 const dated=yearCatalog(catalog.videos,catalog.categoryDefinitions);
 return {...dated,categoryRevision:registry.revision,playlistRefresh:await state(db,'ms-playlist-refresh'),playlistUpdatedAt:playlists.updatedAt||playlists.fetchedAt||null,coverage:refresh?.lastCompleteAt?'Official-channel upload scan completed '+refresh.lastCompleteAt+'. Category review and Facebook / other-source coverage may still be incomplete.':(await state(db,'ms-coverage'))?.message||seed.coverage,refresh,updatedAt:(await state(db,'ms-updated'))?.at||null};
}
async function saveVideos(db,items,{manual=false}={}){
 const registry=await categoryRegistry(db);
 const normalized=items.map(v=>normalizeVideo(v,registry.items.map(c=>c.id))),ops=[];
 // Validate complete imports before the first write, including historical snapshots.
 const histories=items.map((item,index)=>{if(item.history==null)return [];if(!Array.isArray(item.history)||item.history.length>400)throw new Error('Use at most 400 daily snapshots per video.');return item.history.map(s=>historySnapshot(s,normalized[index].id));});
 for(const [index,item] of normalized.entries()){const old=await state(db,'ms-video:'+item.id);const v={...item};
  if(!manual&&old&&!old.reviewed)v.tags=[...new Set([...v.tags,...old.tags.filter(t=>t.startsWith('custom:'))])];
  if(!manual&&old?.reviewed){v.tags=old.tags;v.reviewed=true;v.youtubeEquivalent=old.youtubeEquivalent;}
  if(!manual&&typeof old?.shortsOverride==='boolean')Object.assign(v,classifyShort(v,old.shortsOverride));
  if(!manual&&old?.thumbnailUrl&&!v.thumbnailUrl)v.thumbnailUrl=old.thumbnailUrl;
  if(!manual&&old?.durationSeconds!=null&&v.durationSeconds==null)v.durationSeconds=old.durationSeconds;
  ops.push(upsert(db,'ms-video:'+v.id,v));
  for(const s of histories[index])ops.push(upsert(db,'ms-history:'+v.id+':'+s.at.slice(0,10),s));
  if(v.statsAt&&[v.views,v.likes,v.comments].some(x=>x!=null))ops.push(upsert(db,'ms-history:'+v.id+':'+v.statsAt.slice(0,10),historySnapshot({at:v.statsAt,views:v.views,likes:v.likes,comments:v.comments,statsPrecision:v.statsPrecision,statsSource:v.statsSource},v.id)));
 }
 for(let i=0;i<ops.length;i+=50)await db.batch(ops.slice(i,i+50));
 await upsert(db,'ms-updated',{at:new Date().toISOString()}).run();return normalized.length;
}
async function importStatistics(db,seed,records){
 if(!Array.isArray(records)||!records.length||records.length>1000)throw new Error('Import 1–1000 statistics rows per file.');
 const registry=await categoryRegistry(db),allowed=new Set(registry.items.map(c=>c.id));
 const catalog=await readMissionedSouls(db,seed),byId=new Map(catalog.videos.map(v=>[v.id,v])),updates=[],seen=new Set();
 for(const row of records){
  if(!row||typeof row!=='object')throw new Error('Each statistics row must be an object.');
  let id=typeof row.id==='string'?row.id:null;
  if(!id&&row.url)id=normalizeVideo({title:'Statistics import',url:row.url},[...allowed]).id;
  const current=byId.get(id);if(!current)throw new Error('Statistics row does not match an existing MS Journey video: '+String(row.url||row.id||'missing URL or ID'));
  if(seen.has(id))throw new Error('Use one statistics row per video in each import.');seen.add(id);
  const metricKeys=['views','likes','comments'],hasMetric=metricKeys.some(key=>Object.hasOwn(row,key));
  const hasEnrichment=hasMetric||Object.hasOwn(row,'thumbnailUrl')||Object.hasOwn(row,'durationSeconds');
  if(!hasEnrichment)throw new Error('A statistics row needs a count, thumbnail URL, or duration.');
  if(hasMetric&&!row.statsAt)throw new Error('Statistics rows with counts need statsAt.');
  const next={...current,tags:(current.tags||[]).filter(tag=>allowed.has(tag))};delete next.history;
  for(const key of [...metricKeys,'thumbnailUrl','durationSeconds','statsPrecision','statsSource'])if(Object.hasOwn(row,key))next[key]=row[key];
  if(Object.hasOwn(row,'statsAt'))next.statsAt=row.statsAt;
  updates.push(next);
 }
 return saveVideos(db,updates,{manual:true});
}
export async function refreshMissionedSouls(env,seed,fetcher=fetch,{latestOnly=false}={}){
 const db=env.DB;if(!db)return {status:'blocked',message:'Catalog storage is unavailable.'};
 if(!env.YOUTUBE_API_KEY)return {status:'blocked',message:'YouTube API access is not configured. Import a saved catalog, or configure YOUTUBE_API_KEY on the server.'};
 const now=new Date().toISOString();
 fetcher=quotaFetch(env,fetcher);
 // Database compare-and-set prevents concurrent manual and scheduled scans.
 const lock=await db.prepare("INSERT INTO state(key,value) VALUES('ms-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER) < ?").bind(String(Date.now()+300000),Date.now()).run();
 if(!lock.meta?.changes)return {status:'busy',message:'A refresh is already running.'};
 let progress=await state(db,'ms-refresh')||{};
 const api=async(endpoint,params)=>{const u=new URL('https://www.googleapis.com/youtube/v3/'+endpoint);for(const [k,v]of Object.entries({...params,key:env.YOUTUBE_API_KEY}))u.searchParams.set(k,v);const r=await fetcher(u,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('YouTube refresh failed ('+r.status+'). Existing catalog preserved.');return r.json();};
 try{
  if(!progress.uploads){const c=await api('channels',{part:'contentDetails',forHandle:'@MissionedSouls'});if(!c.items?.[0])throw new Error('Official YouTube channel not found.');progress.uploads=c.items[0].contentDetails.relatedPlaylists.uploads;progress.channelId=c.items[0].id;}
  let pageToken=latestOnly?'':progress.nextPage||'',added=0,done=false;
  // Four upload pages per invocation; the next invocation resumes older uploads.
  for(let page=0;page<(latestOnly?1:4);page++){
   const p=await api('playlistItems',{part:'contentDetails',playlistId:progress.uploads,maxResults:'50',...(pageToken?{pageToken}:{})});
   const ids=p.items.map(x=>x.contentDetails.videoId);
   if(ids.length){const data=await api('videos',{part:'snippet,statistics,contentDetails',id:ids.join(',')});
    const items=data.items.filter(v=>v.snippet.channelId===progress.channelId).map(v=>({title:v.snippet.title,url:'https://www.youtube.com/watch?v='+v.id,publishedAt:v.snippet.publishedAt,thumbnailUrl:v.snippet.thumbnails?.high?.url||v.snippet.thumbnails?.medium?.url||null,durationSeconds:youtubeSeconds(v.contentDetails?.duration),statsAt:now,views:v.statistics?.viewCount??null,likes:v.statistics?.likeCount??null,comments:v.statistics?.commentCount??null,statsPrecision:'exact',statsSource:'Official YouTube Data API',tags:suggestCategories(v.snippet.title),sourceNote:'Official channel YouTube API import; suggested categories need review.'}));
    added+=await saveVideos(db,items);
    const found=new Set(data.items.map(v=>v.id));for(const id of ids)if(!found.has(id)){const old=await state(db,'ms-video:yt:'+id);if(old)await upsert(db,'ms-video:yt:'+id,{...old,available:false}).run();}
   }
   pageToken=p.nextPageToken||'';if(!pageToken){done=true;break;}
  }
  if(latestOnly){progress={...progress,lastLatestAt:now,latestStatus:'complete'};await upsert(db,'ms-refresh',progress).run();return {status:'latest-refreshed',count:added};}
  progress={...progress,nextPage:pageToken,status:done?'complete':'continuing',lastBatchAt:now,lastCompleteAt:done?now:progress.lastCompleteAt||null,message:done?'Full upload pass complete.':'More uploads remain; next refresh continues the scan.',count:added};
  await upsert(db,'ms-refresh',progress).run();return progress;
 }catch(error){if(latestOnly){await upsert(db,'ms-refresh',{...progress,latestStatus:'error',latestError:error.message,lastLatestAttemptAt:now}).run();return {status:'error',message:error.message};}progress={...progress,status:'error',message:error.message,lastAttemptAt:now};await upsert(db,'ms-refresh',progress).run();return progress;}
 finally{await db.prepare("DELETE FROM state WHERE key='ms-lock'").run();}
}
export async function missionedSouls(request,env,seed,user,fetcher=fetch){
 try{
  if(!user?.id)return json({error:'Sign in to view MS Journey.'},401);
  if(request.method==='GET'){const data=await readMissionedSouls(env.DB,seed);if(!user.moderator)data.videos=data.videos.filter(v=>v.visibility==='visible').map(({sourceNote,...v})=>v);return json({...data,moderator:!!user.moderator,canAddVideos:await canPublishDirectly(env.DB,user.id),apiConfigured:!!env.YOUTUBE_API_KEY});}
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(Number(request.headers.get('Content-Length'))>2000000)return json({error:'Import is too large.'},413);
  const raw=await request.text();if(raw.length>2000000)return json({error:'Import is too large.'},413);const b=JSON.parse(raw);
  if(b.action==='fetch-facebook-metadata'){
   if(!user.moderator&&!await canPublishDirectly(env.DB,user.id))return json({error:'Trusted Member access required to fetch Facebook details.'},403);
   return json(await fetchFacebookMetadata(b.url,fetcher));
  }
  if(b.action==='community-add'){
   if(!await canPublishDirectly(env.DB,user.id))return json({error:'Trusted Member access required to add a Facebook video.'},403);
   if(b.publicConfirmed!==true)return json({error:'Confirm the Facebook video is publicly viewable before submitting.'},400);
   if(!b.video||typeof b.video!=='object')return json({error:'Add a Facebook video to submit.'},400);
   const allowed=(await categoryRegistry(env.DB)).items.map(c=>c.id),input=normalizeVideo(b.video,allowed);
   if(input.platform!=='Facebook'||input.youtubeEquivalent)return json({error:'Submit a Facebook-only public video link.'},400);
   const url=new URL(input.url),path=url.pathname;
   const validVideoPath=(['fb.watch','www.fb.watch'].includes(url.hostname)&&/^\/[\w-]+\/?$/.test(path))
    ||(/^\/(?:watch|reel|videos|share\/(?:r|v))\/?$/.test(path)&&url.searchParams.has('v'))
    ||/^\/(?:[\w.-]+\/videos\/|(?:reel|videos|share\/(?:r|v))\/[\w.-]+)\/?$/.test(path);
   if(!validVideoPath)return json({error:'Use a Facebook Watch, Reel, or video link.'},400);
   if(path==='/watch'||path==='/watch/')url.search='?v='+encodeURIComponent(url.searchParams.get('v'));else url.search='';
   const video=normalizeVideo({...b.video,url:url.href},allowed);
   if(video.available===false)return json({error:'The submitted Facebook video must be available.'},400);
   if([video.views,video.likes,video.comments].some(x=>x!=null)&&!video.statsAt)return json({error:'Choose when these statistics were recorded.'},400);
   const id=video.id,existing=await state(env.DB,'ms-video:'+id);
   if(existing||seed.videos.some(v=>v.id===id))return json({error:'This Facebook video is already in the archive.'},409);
   const submitted={...video,tags:[...new Set([...video.tags,'Community finds'])],reviewed:false,youtubeEquivalent:false,visibility:'visible',available:true,sourceNote:'Community find submitted by trusted member '+user.id};
   const saved=normalizeVideo(submitted,allowed),now=new Date().toISOString(),ops=[];
   let thumbnailUrl=saved.thumbnailUrl;
   if(b.thumbnailData){const data=validateThumbnail(b.thumbnailData),thumbnailId=crypto.randomUUID();thumbnailUrl='/api/missioned-souls/thumbnails/'+thumbnailId;ops.push(upsert(env.DB,'ms-thumbnail:'+thumbnailId,{id:thumbnailId,data,videoUrl:saved.url,createdAt:now,createdBy:user.id}));}
   const record={...saved,thumbnailUrl};
   ops.push(upsert(env.DB,'ms-video:'+id,record));
   if(record.statsAt&&[record.views,record.likes,record.comments].some(x=>x!=null))ops.push(upsert(env.DB,'ms-history:'+id+':'+record.statsAt.slice(0,10),historySnapshot({at:record.statsAt,views:record.views,likes:record.likes,comments:record.comments,statsPrecision:record.statsPrecision,statsSource:record.statsSource},id)));
   const start=now.slice(0,10)+'T00:00:00.000Z',end=new Date(Date.parse(start)+86400000).toISOString();
   ops.push(env.DB.prepare("INSERT OR IGNORE INTO points(id,user_id,kind,amount,created_at) SELECT ?,?,'facebook-submission',MIN(25,MAX(0,500-COALESCE((SELECT SUM(amount) FROM points WHERE user_id=? AND amount>0 AND created_at>=? AND created_at<?),0))),? WHERE EXISTS(SELECT 1 FROM state WHERE key=?)").bind('facebook-submission:'+id,user.id,user.id,start,end,now,'ms-video:'+id));
   ops.push(upsert(env.DB,'ms-updated',{at:now}));
   await env.DB.batch(ops);
   const awarded=await env.DB.prepare('SELECT amount FROM points WHERE id=?').bind('facebook-submission:'+id).first();
   return json({ok:true,points:awarded?.amount||0,message:'Facebook video added to Community finds.'+(awarded?.amount?' You earned '+awarded.amount+' contribution points.':' Your daily contribution point limit has been reached.')});
  }
  if(!user.moderator)return json({error:'Moderator access required.'},403);
  if(b.action==='categories')return manageCategories(env.DB,b);
  if(b.action==='playlists')return json(await refreshPlaylists(env,saveVideos));
  if(b.action==='refresh')return json(await refreshMissionedSouls(env,seed));
  if(b.action==='thumbnail'){
   normalizeVideo({title:'Thumbnail upload',url:b.videoUrl});
   const data=validateThumbnail(b.data),id=crypto.randomUUID(),thumbnailUrl='/api/missioned-souls/thumbnails/'+id;
   await upsert(env.DB,'ms-thumbnail:'+id,{id,data,videoUrl:b.videoUrl,createdAt:new Date().toISOString(),createdBy:user.id}).run();
   return json({ok:true,thumbnailUrl,message:'Thumbnail uploaded.'});
  }
  if(b.action==='stats-import')return json({ok:true,count:await importStatistics(env.DB,seed,b.records),message:b.records.length+' video statistics records saved.'});
  if(b.action==='visibility'){
   if(typeof b.id!=='string'||!['visible','hidden','removed'].includes(b.visibility))return json({error:'Choose a video and a valid visibility.'},400);
   const video=(await readMissionedSouls(env.DB,seed)).videos.find(v=>v.id===b.id);
   if(!video)return json({error:'Video not found.'},404);
   await env.DB.batch([upsert(env.DB,'ms-visibility:'+video.id,{id:video.id,visibility:b.visibility,at:new Date().toISOString(),by:user.id}),upsert(env.DB,'ms-updated',{at:new Date().toISOString()})]);
   return json({ok:true,message:b.visibility==='visible'?'Video restored to MS Journey.':b.visibility==='hidden'?'Video hidden from members.':'Video removed from MS Journey. You can restore it from Hidden / removed videos.'});
  }
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
 const playlistProgress=await state(env.DB,'ms-playlist-refresh');
 if(playlistProgress&&(!playlistProgress.updatedAt||Date.now()-Date.parse(playlistProgress.updatedAt)>86400000)&&(!playlistProgress.lastAttemptAt||Date.now()-Date.parse(playlistProgress.lastAttemptAt)>3600000))await refreshPlaylists(env,saveVideos,fetcher);
 const progress=await state(env.DB,'ms-refresh');
 if(!progress)return {status:'idle'};
 const latestAt=Date.parse(progress.lastLatestAt||progress.lastCompleteAt||0);
 if(!Number.isFinite(latestAt)||Date.now()-latestAt>=14*60000){
  const latest=await refreshMissionedSouls(env,seed,fetcher,{latestOnly:true});
  if(latest.status!=='latest-refreshed')return latest;
 }
 const since=Date.now()-Date.parse(progress.lastCompleteAt||0);
 if(progress.status==='complete'&&since<86400000)return {status:'waiting'};
 if(progress.status==='error'&&Date.now()-Date.parse(progress.lastAttemptAt)<3600000)return {status:'waiting'};
 return refreshMissionedSouls(env,seed,fetcher);
}
