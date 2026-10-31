import {quotaFetch,quotaPolicy,QuotaBlocked} from './youtube-quota.mjs';
import { database, seedDatabase } from './db.mjs';
import {reactionEvidence} from './approval-rules.mjs';
import {videoFormat} from './video-format.mjs';
import {SEARCH_STRATEGY,pacificDay,startSearchPage,reserveSearchAttempt,finishSearchAttempt,finishSearchPage,recordSearchResults,sampleDiscoveryHealth} from './discovery-measurement.mjs';

const normalize = s => String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function classify(title,aliases,duration,{description=''}={}) {
  const t=` ${normalize(title)} `;
  const evidence=reactionEvidence(title,aliases,description);
  if(!aliases.some(a=>t.includes(` ${normalize(a)} `))&&!evidence)return null;
  return evidence?'CONFIRMED':'PENDING';
}
export function seconds(s) { const m=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s||''); return m?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0):null; }
export function videoMetadata(item,at){
 const count=v=>v!==undefined&&/^\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))?Number(v):null;
 return {duration:seconds(item.contentDetails?.duration),views:count(item.statistics?.viewCount),likes:count(item.statistics?.likeCount),youtubeComments:count(item.statistics?.commentCount),metadataUpdatedAt:at};
}
export class YouTube {
  constructor(key,fetcher=fetch,usageDb=null,quotaEnv={}){this.quotaEnv=quotaEnv;this.usageDb=usageDb;this.key=key;this.fetcher=quotaFetch(quotaEnv,fetcher.bind(globalThis));this.calls=0;this.requestMs=0;this.deadline=Date.now()+20000;}
  async get(endpoint,params,searchContext=null){
    if(endpoint==='videos'&&String(params.part||'').split(',').includes('contentDetails'))params={...params,part:[...new Set([...params.part.split(','),'player','statistics'])].join(','),maxWidth:480};
    for(let attempt=0;attempt<3;attempt++){
      if(this.calls>=28||Date.now()>this.deadline) throw new Error('Batch budget reached; continuation retained');
      const attemptId=endpoint==='search'&&searchContext?await reserveSearchAttempt(this.usageDb,searchContext.pageId,searchContext.limit):null;
      this.calls++;
      if(this.usageDb&&(endpoint==='search'||!quotaPolicy(this.quotaEnv).tracking))await this.usageDb.prepare("INSERT INTO state(key,value) VALUES(?, '1') ON CONFLICT(key) DO UPDATE SET value=CAST(state.value AS INTEGER)+1").bind('youtube-requests:'+new Date().toISOString().slice(0,10)+':'+endpoint).run();
      const url=new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`); for(const [k,v] of Object.entries(params)) if(v!==null&&v!==undefined)url.searchParams.set(k,String(v));
      let response,body;const requestStart=Date.now();try { response=await this.fetcher(url,{headers:{'X-Goog-Api-Key':this.key},signal:AbortSignal.timeout(6000)});body=await response.json().catch(()=>({})); } catch(error) { if(error instanceof QuotaBlocked)throw error;if(attemptId)await finishSearchAttempt(this.usageDb,attemptId,'network_error',null,Date.now()-requestStart);if(attempt===2) throw new Error('YouTube request timed out'); continue; } finally {this.requestMs+=Date.now()-requestStart;}
      if(attemptId)await finishSearchAttempt(this.usageDb,attemptId,response.ok?'succeeded':'http_error',response.status,Date.now()-requestStart);
      if(response.ok)return body;
      if(response.status===429||response.status>=500){if(attempt<2){await new Promise(r=>setTimeout(r,200*(2**attempt)));continue;}}
      const allowed=['quotaExceeded','dailyLimitExceeded','playlistNotFound','keyInvalid','accessNotConfigured','forbidden'];
      const reason=body.error?.errors?.[0]?.reason;
      throw new Error(`YouTube ${response.status}: ${allowed.includes(reason)?reason:'request rejected'}`);
    }
  }
}
// Bulk lookups and bounded D1 batches replace per-video round trips.
export async function saveVideos(db,items,performers,runTime,source,context={}){
  items=items.filter(item=>item.snippet?.channelId!=='UCeTfwcnUVurw7Qrk_KF5Idw');
  const unique=[...new Map(items.filter(item=>/^[\w-]{11}$/.test(item.id)&&item.snippet&&item.status?.privacyStatus==='public').map(item=>[item.id,item])).values()];
  let inserted=0;
  for(let offset=0;offset<unique.length;offset+=50){
    const chunk=unique.slice(offset,offset+50),ids=chunk.map(x=>x.id);
    // One lookup round trip per 50-video chunk; one JSON binding stays below D1's bind limit.
    const snapshot=await db.prepare(`WITH ids AS (SELECT value FROM json_each(?)) SELECT
      (SELECT json_group_array(json_object('id',id,'channel_id',channel_id,'title',title,'published_at',published_at,'available',available,'checked_at',checked_at)) FROM videos WHERE id IN (SELECT value FROM ids)) old_json,
      (SELECT json_group_array(json_object('performer_id',performer_id,'video_id',video_id)) FROM matches WHERE video_id IN (SELECT value FROM ids)) matches_json,
      (SELECT json_group_array(json_object('performer_id',performer_id,'video_id',video_id)) FROM exclusions WHERE video_id IN (SELECT value FROM ids)) excluded_json`).bind(JSON.stringify(ids)).first();
    const old=new Map(JSON.parse(snapshot.old_json).map(v=>[v.id,v]));
    const matches=new Set(JSON.parse(snapshot.matches_json).map(v=>v.performer_id+':'+v.video_id));
    const excluded=new Set(JSON.parse(snapshot.excluded_json).map(v=>v.performer_id+':'+v.video_id));
    const statements=[],channels=new Map();
    for(const item of chunk){
      const snippet=item.snippet,duration=seconds(item.contentDetails?.duration),prior=old.get(item.id);
      if(prior&&prior.channel_id!==snippet.channelId)continue;
      const eligible=performers.map(p=>({p,classification:classify(snippet.title,JSON.parse(p.aliases),duration,{description:snippet.description})})).filter(({p,classification})=>classification&&!excluded.has(p.id+':'+item.id));
      if(!eligible.length)continue;
      const changed=!prior||prior.title!==snippet.title||prior.published_at!==(snippet.publishedAt||null)||!prior.available;
      const stale=!prior?.checked_at||Date.parse(runTime)-Date.parse(prior.checked_at)>=7*86400000;
      const missing=eligible.filter(({p})=>!matches.has(p.id+':'+item.id));
      if(changed||stale||missing.length){
        channels.set(snippet.channelId,snippet.channelTitle||'Unknown reactor');
        const detectedFormat=videoFormat(item,duration);
        statements.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('youtube-video-metadata:'+item.id,JSON.stringify(videoMetadata(item,runTime))));
        statements.push(db.prepare(`INSERT INTO videos(id,channel_id,title,published_at,discovered_at,checked_at,format,available) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,published_at=excluded.published_at,checked_at=excluded.checked_at,format=CASE WHEN videos.format_locked=1 OR videos.format IN ('SHORT','FULL_LENGTH') THEN videos.format ELSE excluded.format END,available=1`).bind(item.id,snippet.channelId,snippet.title,snippet.publishedAt||null,runTime,runTime,detectedFormat));
      }
      if(!prior){inserted++;const lag=Date.parse(runTime)-Date.parse(snippet.publishedAt);statements.push(db.prepare('INSERT OR IGNORE INTO discovery_observations(video_id,source,discovered_at,published_at,delay_seconds,strategy_version,search_page_id) VALUES(?,?,?,?,?,?,?)').bind(item.id,source,runTime,snippet.publishedAt||null,Number.isFinite(lag)&&lag>=0?Math.floor(lag/1000):null,SEARCH_STRATEGY,context.pageId||null));}
      for(const {p,classification:found} of missing){
        const classification=p.review_mode==='review'?'PENDING':found;
        statements.push(db.prepare("INSERT OR IGNORE INTO discovery_notifications(performer_id,video_id,created_at,source) SELECT ?,?,?,? WHERE ?='CONFIRMED' AND ?='active' AND NOT EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=?) AND NOT EXISTS(SELECT 1 FROM exclusions WHERE performer_id=? AND video_id=?)").bind(p.id,item.id,runTime,source,classification,p.status,p.id,item.id,p.id,item.id));
        statements.push(db.prepare('INSERT OR IGNORE INTO matches(performer_id,video_id,status,source) VALUES(?,?,?,?)').bind(p.id,item.id,classification,source));
      }
    }
    const channelStatements=[...channels].map(([id,name])=>db.prepare('INSERT INTO channels(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE channels.name IS NOT excluded.name').bind(id,name));
    const work=[...channelStatements,...statements];
    for(let i=0;i<work.length;i+=80)await db.batch(work.slice(i,i+80));
  }
  return inserted;
}
export async function saveVideo(db,item,performers,runTime,source){return saveVideos(db,[item],performers,runTime,source);}
export function measuredDatabase(raw,metrics){
  const originals=new WeakMap(),queries=new WeakMap();metrics.queries ||= new Map();
  const measure=async(task,labels)=>{const start=Date.now();try{const result=await task();const items=Array.isArray(result)?result:[result];items.forEach((item,i)=>{const key=labels[i]||labels[0],entry=metrics.queries.get(key)||{query:key,calls:0,rowsRead:0,rowsWritten:0,ms:0};entry.calls++;entry.rowsRead+=item?.meta?.rows_read||0;entry.rowsWritten+=item?.meta?.rows_written||0;metrics.rowsRead+=item?.meta?.rows_read||0;metrics.rowsWritten+=item?.meta?.rows_written||0;metrics.queries.set(key,entry);});return result;}finally{const ms=Date.now()-start;metrics.dbMs+=ms;if(labels.length===1){const e=metrics.queries.get(labels[0]);if(e)e.ms+=ms;}}};
  function wrap(statement,query){const proxy={bind(...args){return wrap(statement.bind(...args),query);},async first(column){const result=await measure(()=>statement.all(),[query]);const row=result.results?.[0]||null;return column?(row?.[column]??null):row;},all(...args){return measure(()=>statement.all(...args),[query]);},run(...args){return measure(()=>statement.run(...args),[query]);}};originals.set(proxy,statement);queries.set(proxy,query);return proxy;}
  return {prepare(query){return wrap(raw.prepare(query),query.replace(/\s+/g,' ').trim());},batch(statements){return measure(()=>raw.batch(statements.map(s=>originals.get(s)||s)),statements.map(s=>queries.get(s)||'batch statement'));}};
}
export function retryDelay(failures){return failures<=1?3600000:failures===2?21600000:86400000;}
export function searchDailyLimit(env){
  const value=env.DISCOVERY_DAILY_SEARCH_LIMIT;
  if(value===undefined||value===null||value==='')return 20;
  const limit=Number(value);return Number.isFinite(limit)?Math.max(0,Math.min(80,Math.floor(limit))):20;
}
export function searchInterval(env){return Math.max(15,1440/Math.max(1,searchDailyLimit(env)))*60000;}
export function performerQueries(p,songs=[],rotation=0){
  const quote=s=>'"'+String(s).replace(/["\\]/g,' ').trim()+'"';
  const names=[...new Set([p.name,...JSON.parse(p.aliases)])].filter(Boolean);
  const main=quote(p.name), mainReaction=`${main} reaction`;
  const aliasQueries=names.filter(name=>normalize(name)!==normalize(p.name)).map(name=>`${quote(name)} reaction`);
  const songQueries=[...new Set(songs.map(song=>String(song).trim()).filter(Boolean))].map(song=>`${quote(song)} reaction`);
  // Keep 20 weighted query windows per rotation: 12 exact-name, 6 name+reaction,
  // and 2 experiments. The experiment slots retain alias coverage and test the
  // newest song title without requiring the band name to appear in a reactor title.
  const experiments=[];
  if(songQueries.length)experiments.push(songQueries[rotation% songQueries.length]);
  if(aliasQueries.length)experiments.push(aliasQueries[Math.floor(rotation/20)%aliasQueries.length]);
  else if(songQueries.length>1)experiments.push(songQueries[(rotation+1)%songQueries.length]);
  while(experiments.length<2)experiments.push(experiments.length?mainReaction:main);
  const slots=[0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,2,3];
  return slots.map(slot=>slot===0?main:slot===1?mainReaction:experiments[slot-2]);
}
export function recentSongTitles(videos){
  const extract=v=>{
    if(typeof v.song==='string'&&v.song.trim())return v.song.trim();
    const title=String(v.title||'');
    if(/mark your calendars|sneak\s*peek|live\s*stream|livestream|vlog|announcement|happy birthday|concert tickets|save the date|premiere countdown/i.test(title))return '';
    const parts=title.replace(/#[\p{L}\p{N}_-]+/gu,' ').split(/\s*\|\s*/).map(s=>s.trim()).filter(Boolean);
    // Prefer a title segment with an explicit “by Artist” marker (for example,
    // “DECODE by Paramore”) over location/series text elsewhere in the title.
    const by=parts.map(s=>/^(.+?)\s+by\s+.+$/i.exec(s)?.[1]).find(Boolean);
    let candidate=by||parts[0]||'';
    candidate=candidate.replace(/^Missioned\s+Souls\s*[-:–—]\s*/i,'').trim();
    if(!by)candidate=candidate.split(/\s[-–—]\s/)[0].trim();
    return candidate.replace(/\s*\((?:studio |family band )?cover\)\s*/ig,' ').replace(/\s+/g,' ').trim();
  };
  return [...new Set(videos.filter(v=>Number.isFinite(Date.parse(v.publishedAt))).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).map(extract).filter(s=>typeof s==='string'&&s.trim().length>=3&&s.length<=100).map(s=>s.trim()))].slice(0,3);
}
function decodeXml(value){return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();}
function xmlValue(xml,name){const match=new RegExp('<(?:[\\w.-]+:)?'+name+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'\\s*>','i').exec(xml);return match?decodeXml(match[1]):'';}
async function boundedText(response,limit=512*1024){
  const reader=response.body?.getReader();if(!reader){const text=await response.text();if(new TextEncoder().encode(text).byteLength>limit)throw new Error('Official video feed too large');return text;}
  const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Official video feed too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}
// The official channel's Atom feed provides a fresh song hint without consuming
// YouTube Data API quota. Keep the most recent valid snapshot if the feed is down.
export async function refreshOfficialSearchFeed(db,fetcher=fetch){
  const state=(await db.prepare("SELECT value FROM state WHERE key='ms-refresh'").first())?.value;
  if(!state)return [];
  const channelId=JSON.parse(state).channelId;
  if(!/^UC[\w-]{22}$/.test(channelId||''))return [];
  const key='search-official-feed:missioned-souls';
  const cached=(await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first())?.value;
  try{
    const response=await fetcher('https://www.youtube.com/feeds/videos.xml?channel_id='+encodeURIComponent(channelId),{signal:AbortSignal.timeout(4000),redirect:'manual',headers:{Accept:'application/atom+xml, application/xml, text/xml'}});
    if(!response.ok)throw new Error('Official video feed unavailable');
    const xml=await boundedText(response);
    if(!/<feed\b/i.test(xml)||!/<\/feed\s*>/i.test(xml))throw new Error('Invalid official video feed');
    const entries=[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)];
    if(entries.length>50)throw new Error('Official video feed has too many entries');
    const videos=entries.map(([,entry])=>({id:xmlValue(entry,'videoId'),channelId:xmlValue(entry,'channelId'),title:xmlValue(entry,'title'),publishedAt:xmlValue(entry,'published')})).filter(v=>/^[\w-]{11}$/.test(v.id)&&v.channelId===channelId&&v.title&&Number.isFinite(Date.parse(v.publishedAt)));
    if(!videos.length)return cached?JSON.parse(cached).videos:[];
    const value={at:new Date().toISOString(),channelId,videos};
    await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();
    return videos;
  }catch{return cached?JSON.parse(cached).videos:[];}
}
export async function runDiscovery(env,seed,fetcher=fetch,options={}){
  const startedMs=Date.now(),metrics={dbMs:0,examined:0,rowsRead:0,rowsWritten:0};const db=measuredDatabase(database(env),metrics);await seedDatabase(db,seed);
  if(!env.YOUTUBE_API_KEY)return {status:'blocked',reason:'YouTube API key is not configured'};
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const lease=await db.prepare("INSERT INTO state(key,value) VALUES('discovery-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(String(Date.now()+120000),Date.now()).run();
  if(!lease.meta.changes)return {status:'busy'};
  async function unavailable(channel,reason){const failures=(channel.recent_failures||0)+1;const retry=new Date(Date.now()+retryDelay(failures)).toISOString();await db.prepare('UPDATE channels SET uploads=NULL,recent_failures=?,recent_retry_at=?,recent_error=? WHERE id=?').bind(failures,retry,reason,channel.id).run();detail+=`${reason}: ${channel.name} (${channel.id}); retry after ${retry}; `;}
  const api=new YouTube(env.YOUTUBE_API_KEY,fetcher,db,env);let added=0,scanned=0,historyPages=0,recentAdded=0,historyAdded=0,final='succeeded',detail='';
  await db.prepare('INSERT INTO runs(id,started_at,status) VALUES(?,?,?)').bind(id,now,'running').run();
  try{
    if(!await db.prepare("SELECT value FROM state WHERE key='discovery-repair-baseline-v1'").first()){
      const sources=(await db.prepare("SELECT source,COUNT(*) samples,AVG(delay_seconds) average_seconds,MAX(delay_seconds) max_seconds FROM discovery_observations WHERE discovered_at>=? AND delay_seconds BETWEEN 0 AND 604800 GROUP BY source").bind(new Date(startedMs-86400000).toISOString()).all()).results;
      await db.prepare("INSERT OR IGNORE INTO state(key,value) VALUES('discovery-repair-baseline-v1',?)").bind(JSON.stringify({at:now,sources})).run();
    }
    const performers=(await db.prepare("SELECT p.* FROM performers p LEFT JOIN state s ON s.key='search-touch:'||p.id WHERE p.discovery_enabled=1 AND p.id='missioned-souls' ORDER BY COALESCE(s.value,''),p.id").all()).results;
    if(!performers.length)return {id,status:'succeeded',calls:0,channels:0,added:0,detail:'No discovery-enabled performers.'};
    const officialFeedVideos=await refreshOfficialSearchFeed(db,fetcher);
    // Fresh uploads get the first allocation. Historical cursors are independent.
    const batchSize=Math.max(1,Math.min(14,Number.parseInt(env.DISCOVERY_RECENT_BATCH_SIZE,10)||7));
    const historyLimit=Math.max(0,Math.min(2,Number.parseInt(env.DISCOVERY_HISTORY_PAGES??'1',10)||0));
    // Active reactors have reserved capacity even while daily coverage is overdue.
    // At least half the batch remains available for oldest-first daily coverage.
    const overdue=options.performerId?[]:(await db.prepare("SELECT * FROM channels WHERE discovery_scope='eligible' AND (recent_retry_at IS NULL OR recent_retry_at<=?) AND (recent_checked_at IS NULL OR recent_checked_at<?) ORDER BY recent_attempted_at ASC,recent_checked_at ASC,id LIMIT ?").bind(now,new Date(Date.now()-86400000).toISOString(),batchSize).all()).results;
    const prioritySlots=Math.min(Math.floor(batchSize/2),batchSize-overdue.length);
    const priority=options.performerId||!prioritySlots?[]:(await db.prepare("SELECT c.* FROM channels c WHERE c.discovery_scope='eligible' AND (c.recent_retry_at IS NULL OR c.recent_retry_at<=?) AND (c.recent_checked_at IS NULL OR c.recent_checked_at<?) AND c.id IN (SELECT DISTINCT v.channel_id FROM videos v INDEXED BY journey_videos_published_channel JOIN matches m ON m.video_id=v.id WHERE v.published_at>? AND m.performer_id='missioned-souls' AND m.status='CONFIRMED') ORDER BY c.recent_attempted_at ASC,c.recent_checked_at ASC,c.id LIMIT ?").bind(now,new Date(Date.now()-3600000).toISOString(),new Date(Date.now()-14*86400000).toISOString(),prioritySlots).all()).results;
    const exclude=priority.length?` AND id NOT IN (${priority.map(()=>'?').join(',')})`:'';
    const regular=options.performerId||overdue.length?[]:(await db.prepare("SELECT * FROM channels WHERE discovery_scope='eligible' AND (recent_retry_at IS NULL OR recent_retry_at<=?) AND (recent_checked_at IS NULL OR recent_checked_at<?)"+exclude+" ORDER BY recent_attempted_at ASC,recent_checked_at ASC,id LIMIT ?").bind(now,new Date(Date.now()-86400000).toISOString(),...priority.map(c=>c.id),batchSize-priority.length).all()).results;
    const due=overdue.length? [...overdue,...priority].slice(0,batchSize):[...priority,...regular];

    if(due.length)await db.batch(due.map(c=>db.prepare('UPDATE channels SET recent_attempted_at=? WHERE id=?').bind(now,c.id)));
    const missing=due.filter(c=>!c.uploads);
    if(missing.length){
      const data=await api.get('channels',{part:'contentDetails',id:missing.map(c=>c.id).join(',')});
      const playlists=new Map((data.items||[]).map(c=>[c.id,c.contentDetails?.relatedPlaylists?.uploads]));
      for(const c of missing){c.uploads=playlists.get(c.id);if(c.uploads)await db.prepare('UPDATE channels SET uploads=? WHERE id=?').bind(c.uploads,c.id).run();else await unavailable(c,'Unavailable channel');}
    }
    const pages=[],ready=due.filter(c=>c.uploads);
    let pageError;
    // Only two concurrent requests, keeping retry/call accounting on the shared API budget.
    for(let offset=0;offset<ready.length;offset+=2){
      if(Date.now()>api.deadline-6000||api.calls>=20){final='partial';detail+='Recent checks deferred by batch budget; ';break;}
      const pair=ready.slice(offset,offset+2);
      const results=await Promise.allSettled(pair.map(channel=>api.get('playlistItems',{part:'snippet,contentDetails',playlistId:channel.uploads,maxResults:50})));
      for(let i=0;i<results.length;i++){
        const result=results[i],channel=pair[i];
        if(result.status==='fulfilled')pages.push({channel,page:result.value});
        else if(result.reason.message.includes('playlistNotFound')){await unavailable(channel,'Unavailable uploads playlist');}
        else {const failures=(channel.recent_failures||0)+1;await db.prepare('UPDATE channels SET recent_failures=?,recent_retry_at=?,recent_error=? WHERE id=?').bind(failures,new Date(Date.now()+retryDelay(failures)).toISOString(),result.reason.message,channel.id).run();pageError=result.reason;}
      }
      if(pageError)break;
    }
    const allIds=[...new Set(pages.flatMap(({page})=>(page.items||[]).map(x=>x.contentDetails?.videoId).filter(Boolean)))];
    // Playlist titles screen unrelated uploads before costly video metadata requests.
    // Missing titles are fetched conservatively rather than discarded.
    const candidates=new Set(pages.flatMap(({page})=>(page.items||[]).filter(x=>!x.snippet?.title||performers.some(p=>classify(x.snippet.title,JSON.parse(p.aliases),null))).map(x=>x.contentDetails?.videoId).filter(Boolean)));
    const ids=[...candidates];metrics.examined+=allIds.length;
    const fetched=new Set(allIds.filter(id=>!candidates.has(id)));
    async function checkpointRecent(){for(const {channel,page} of pages){
      if(channel.checkpointed)continue;
      if(!(page.items||[]).every(x=>!x.contentDetails?.videoId||fetched.has(x.contentDetails.videoId)))continue;
      const cutoff=new Date((channel.recent_checked_at?Date.parse(channel.recent_checked_at):Date.now()-30*86400000)-48*3600000).toISOString();
      const reached=(page.items||[]).some(x=>x.contentDetails?.videoPublishedAt&&x.contentDetails.videoPublishedAt<cutoff);
      // Keep an existing history cursor intact; start one only when there is none.
      const next=!reached?page.nextPageToken:null;
      await db.prepare('UPDATE channels SET recent_checked_at=?,recent_failures=0,recent_retry_at=NULL,recent_error=NULL,next_page=COALESCE(next_page,?),scan_before=COALESCE(scan_before,?),scan_started=COALESCE(scan_started,?) WHERE id=?').bind(now,next||null,next?cutoff:null,next?now:null,channel.id).run();
      scanned++;channel.checkpointed=true;
    }}
    for(let offset=0;offset<ids.length;offset+=50){
      const chunk=ids.slice(offset,offset+50);
      const data=await api.get('videos',{part:'snippet,contentDetails,statistics,status',id:chunk.join(',')});
      const n=await saveVideos(db,data.items||[],performers,now,'Recent-upload check');added+=n;recentAdded+=n;
      for(const id of chunk)fetched.add(id);
      await checkpointRecent();
    }
    await checkpointRecent();
    if(pageError)throw pageError;
    // Resume a fixed-window search one page at a time; completed windows become incremental.
    let searched=0;
    for(const p of performers){
      if(options.performerId&&p.id!==options.performerId)continue;
      const recordSearch=async report=>db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(`search-diagnostics:${p.id}`,JSON.stringify({at:now,dailyLimit:searchDailyLimit(env),...report})).run();
      if(searched>=4||api.calls>22||Date.now()>api.deadline-4000){await recordSearch({status:'deferred',reason:'Discovery run budget reached'});break;}
      const key=`search:${p.id}`,progressKey=`search-progress:${p.id}`;
      const quotaKey=`search-attempt-budget:${pacificDay(now)}`,rotationKey=`search-rotation:${p.id}`,touchKey=`search-touch:${p.id}`;
      const stateKeys=[key,progressKey,quotaKey,rotationKey,touchKey];
      const searchState=new Map((await db.prepare('SELECT key,value FROM state WHERE key IN ('+stateKeys.map(()=>'?').join(',')+')').bind(...stateKeys).all()).results.map(r=>[r.key,r]));
      const prev=searchState.get(key),pending=searchState.get(progressKey);
      const dailyLimit=searchDailyLimit(env);
      if(!dailyLimit){await recordSearch({status:'disabled',reason:'Daily search limit is zero'});continue;}
      const used=Number(searchState.get(quotaKey)?.value||0);
      if(used>=dailyLimit){await recordSearch({status:'capped',reason:'Daily search budget reached'});final='partial';detail+='Daily search budget reached; queued searches resume tomorrow. ';break;}
      const interval=searchInterval(env);
      const touched=searchState.get(touchKey);
      if(touched&&(!pending||JSON.parse(pending.value).query)&&Date.parse(now)-Date.parse(touched.value)<interval){await recordSearch({status:'waiting',reason:'Budget-paced search interval',nextDueAt:new Date(Date.parse(touched.value)+interval).toISOString()});continue;}
      if(!pending&&prev&&Date.parse(now)-Date.parse(prev.value)<interval){await recordSearch({status:'waiting',reason:`${interval/60000}-minute budget-paced interval`,lastCompletedAt:prev.value,nextDueAt:new Date(Date.parse(prev.value)+interval).toISOString()});continue;}
      const terms=JSON.parse(p.aliases);
      const rotation=Number(searchState.get(rotationKey)?.value||0);
      let cursor=pending?JSON.parse(pending.value):null;
      if(!cursor){
        const official=(await db.prepare("SELECT value FROM state WHERE key>='ms-video:' AND key<'ms-video;' ORDER BY key").all()).results.map(r=>JSON.parse(r.value));
        const queries=performerQueries(p,recentSongTitles([...official,...officialFeedVideos,...(seed.videos||[])]),rotation);
        cursor={term:0,page:null,query:queries[rotation%queries.length],rotation,startedAt:now,after:prev?new Date(Date.parse(prev.value)-7*86400000).toISOString():p.lookback_days===0?null:new Date(Date.now()-p.lookback_days*86400000).toISOString()};
      }
      const query=cursor.query||`"${terms[cursor.term]||p.name}" reaction`;
      const pageId=await startSearchPage(db,{runId:id,performerId:p.id,query,cursor,env,at:now});
      searched++;
      await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(`search-touch:${p.id}`,now).run();
      try{
        if(!pending)await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(progressKey,JSON.stringify(cursor)).run();
        await recordSearch({status:'requesting',term:terms[cursor.term]||p.name,windowEnd:cursor.startedAt});
        const result=await api.get('search',{part:'snippet',type:'video',order:'date',maxResults:50,q:query,publishedAfter:cursor.after,publishedBefore:cursor.startedAt,pageToken:cursor.page},{pageId,limit:dailyLimit});
        const ids=(result.items||[]).map(x=>x.id?.videoId).filter(Boolean);
        let uniqueAdded=0,newReactors=0,delaySamples=0,delayTotal=0,maxDelay=0;
        const beforeMatches=new Set((await db.prepare('SELECT video_id FROM matches WHERE performer_id=? AND video_id IN (SELECT value FROM json_each(?))').bind(p.id,JSON.stringify(ids)).all()).results.map(r=>r.video_id));
        const eligibleBeforePage=new Set((await db.prepare("SELECT id FROM channels WHERE discovery_scope='eligible'").all()).results.map(c=>c.id));
        if(ids.length){const data=await api.get('videos',{part:'snippet,contentDetails,statistics,status',id:ids.join(',')});
          const before=(await db.prepare('SELECT video_id FROM discovery_observations WHERE video_id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results;
          const known=new Set(before.map(v=>v.video_id));
          const eligibleBefore=new Set((await db.prepare("SELECT id FROM channels WHERE discovery_scope='eligible'").all()).results.map(c=>c.id));
          uniqueAdded=await saveVideos(db,data.items||[],[p],now,'Performer discovery search',{pageId});added+=uniqueAdded;metrics.examined+=ids.length;
          const observations=(await db.prepare('SELECT video_id,delay_seconds FROM discovery_observations WHERE source=\'Performer discovery search\' AND discovered_at=? AND video_id IN ('+ids.map(()=>'?').join(',')+')').bind(now,...ids).all()).results.filter(v=>!known.has(v.video_id));
          const found=new Set(observations.map(v=>v.video_id));
          const eligibleAfter=new Set((await db.prepare("SELECT id FROM channels WHERE discovery_scope='eligible'").all()).results.map(c=>c.id));
          newReactors=new Set((data.items||[]).filter(v=>found.has(v.id)&&!eligibleBefore.has(v.snippet.channelId)&&eligibleAfter.has(v.snippet.channelId)).map(v=>v.snippet.channelId)).size;
          for(const v of observations)if(v.delay_seconds!==null&&v.delay_seconds>=0&&v.delay_seconds<=604800){delaySamples++;delayTotal+=v.delay_seconds;maxDelay=Math.max(maxDelay,v.delay_seconds);}
        }
        const outcome=await recordSearchResults(db,pageId,p.id,ids,beforeMatches,eligibleBeforePage,now);
        await finishSearchPage(db,pageId,{status:'completed',results:ids.length,newVideos:outcome.newVideos,newReactors:outcome.newReactors});
        const depth=cursor.depth??(cursor.page?0:1);
        if(result.nextPageToken){cursor.page=result.nextPageToken;cursor.depth=depth?depth+1:0;}
        else{cursor.page=null;cursor.term++;cursor.depth=1;}
        const continuing=Boolean(cursor.page)||(!cursor.query&&cursor.term<terms.length);
        if(continuing){
          await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(progressKey,JSON.stringify(cursor)).run();
          final='partial';detail+='Performer history scan continuation queued. ';
        }else await db.batch([
          db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,cursor.startedAt),
          db.prepare('DELETE FROM state WHERE key=?').bind(progressKey),
          db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(rotationKey,String((cursor.rotation??rotation)+1))
        ]);
        const metricKey=`search-query:${p.id}:${query}`;
        const previous=JSON.parse((await db.prepare('SELECT value FROM state WHERE key=?').bind(metricKey).first())?.value||'{}');
        await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(metricKey,JSON.stringify({query,at:now,pages:(previous.pages||0)+1,results:(previous.results||0)+ids.length,uniqueVideos:(previous.uniqueVideos||0)+uniqueAdded,newReactors:(previous.newReactors||0)+newReactors,delaySamples:(previous.delaySamples||0)+delaySamples,delayTotal:(previous.delayTotal||0)+delayTotal,maxDelay:Math.max(previous.maxDelay||0,maxDelay)})).run();
        await db.prepare('DELETE FROM state WHERE key=?').bind(`search-error:${p.id}`).run();
        await recordSearch({status:continuing?'continuing':'completed',query,results:ids.length,uniqueVideos:uniqueAdded,newReactors,windowEnd:cursor.startedAt,nextDueAt:new Date(Date.parse(now)+interval).toISOString()});
      }catch(error){
        await finishSearchPage(db,pageId,{status:'failed',error:error.message});
        await recordSearch({status:'failed',reason:error.message});
        await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(`search-error:${p.id}`,error.message).run();
        throw error;
      }
    }
    // Rotate historical work separately, at most two pages from distinct channels.
    const backlog=options.performerId?[]:(await db.prepare('SELECT * FROM channels WHERE discovery_scope=\'eligible\' AND uploads IS NOT NULL AND (recent_retry_at IS NULL OR recent_retry_at<=?) AND next_page IS NOT NULL ORDER BY history_checked_at ASC,id LIMIT ?').bind(now,historyLimit).all()).results;
    for(const channel of backlog){
      if(api.calls>22||Date.now()>api.deadline-6000)break;
      let page;try{page=await api.get('playlistItems',{part:'contentDetails',playlistId:channel.uploads,maxResults:50,pageToken:channel.next_page});}catch(error){if(error.message.includes('playlistNotFound')){await unavailable(channel,'Unavailable uploads playlist');continue;}throw error;}
      const ids=(page.items||[]).map(x=>x.contentDetails?.videoId).filter(Boolean);
      if(ids.length){const data=await api.get('videos',{part:'snippet,contentDetails,statistics,status',id:ids.join(',')});const n=await saveVideos(db,data.items||[],performers,now,'Historical upload scan');added+=n;historyAdded+=n;metrics.examined+=ids.length;}
      const reached=(page.items||[]).some(x=>x.contentDetails?.videoPublishedAt&&x.contentDetails.videoPublishedAt<channel.scan_before);
      const next=!reached?page.nextPageToken:null;
      await db.prepare('UPDATE channels SET next_page=?,scan_before=?,scan_started=?,checked_at=?,history_checked_at=? WHERE id=?').bind(next||null,next?channel.scan_before:null,next?channel.scan_started:null,next?channel.checked_at:channel.scan_started,now,channel.id).run();
      historyPages++;
      if(next){final='partial';detail+='Historical upload continuation retained; ';}
    }
    // Refresh a bounded oldest-first batch, including items no longer publicly available.
    if(!options.performerId&&api.calls<27&&Date.now()<api.deadline-4000){
      const stale=(await db.prepare('SELECT id FROM (SELECT id,checked_at FROM (SELECT v.id,v.checked_at FROM videos v INDEXED BY journey_videos_checked_id WHERE v.checked_at IS NULL AND EXISTS(SELECT 1 FROM matches m WHERE m.video_id=v.id AND m.performer_id=\'missioned-souls\') ORDER BY v.id LIMIT 50) UNION ALL SELECT id,checked_at FROM (SELECT v.id,v.checked_at FROM videos v INDEXED BY journey_videos_checked_id WHERE v.checked_at<? AND EXISTS(SELECT 1 FROM matches m WHERE m.video_id=v.id AND m.performer_id=\'missioned-souls\') ORDER BY v.checked_at,v.id LIMIT 50)) ORDER BY checked_at,id LIMIT 50').bind(new Date(Date.now()-7*86400000).toISOString()).all()).results;
      if(stale.length){const result=await api.get('videos',{part:'snippet,status',id:stale.map(v=>v.id).join(',')});const found=new Map((result.items||[]).map(v=>[v.id,v]));
        await db.batch(stale.map(v=>{const fresh=found.get(v.id);return fresh?.status?.privacyStatus==='public'?db.prepare('UPDATE videos SET title=?,checked_at=?,available=1 WHERE id=?').bind(fresh.snippet.title,now,v.id):db.prepare('UPDATE videos SET checked_at=?,available=0 WHERE id=?').bind(now,v.id);}));}
    }
    if(detail&&final==='succeeded')final='partial';
  }catch(error){final='partial';detail+=error.message;}
  finally{
    await db.prepare('UPDATE runs SET finished_at=?,status=?,calls=?,channels=?,added=?,detail=?,history_pages=?,recent_added=?,history_added=?,api_ms=?,db_ms=?,duration_ms=?,records_examined=?,rows_read=?,rows_written=?,query_metrics=? WHERE id=?').bind(new Date().toISOString(),final,api.calls,scanned,added,detail,historyPages,recentAdded,historyAdded,api.requestMs,metrics.dbMs,Date.now()-startedMs,metrics.examined,metrics.rowsRead,metrics.rowsWritten,JSON.stringify([...metrics.queries.values()].sort((a,b)=>b.rowsRead-a.rowsRead).slice(0,8)),id).run();
    await sampleDiscoveryHealth(db,env,{status:final,calls:api.calls,durationMs:Date.now()-startedMs,rowsRead:metrics.rowsRead,rowsWritten:metrics.rowsWritten});
    // Lease remains until its 120-second expiry, preventing accidental rapid repeats.
  }
  return {id,status:final,calls:api.calls,channels:scanned,added,detail};
}
