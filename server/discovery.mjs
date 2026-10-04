import { database, seedDatabase } from './db.mjs';

const normalize = s => String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function classify(title,aliases,duration) {
  const t=` ${normalize(title)} `;
  if(!aliases.some(a=>t.includes(` ${normalize(a)} `))) return null;
  if(duration===null || duration<=180) return 'PENDING';
  return /\b(reacts?|reaction|reacting)\b/i.test(t)?'CONFIRMED':'PENDING';
}
export function seconds(s) { const m=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s||''); return m?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0):null; }
export class YouTube {
  constructor(key,fetcher=fetch){this.key=key;this.fetcher=fetcher.bind(globalThis);this.calls=0;this.requestMs=0;this.deadline=Date.now()+20000;}
  async get(endpoint,params){
    for(let attempt=0;attempt<3;attempt++){
      if(this.calls>=28||Date.now()>this.deadline) throw new Error('Batch budget reached; continuation retained');
      this.calls++;
      const url=new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`); for(const [k,v] of Object.entries(params)) if(v!==null&&v!==undefined)url.searchParams.set(k,String(v));
      let response,body;const requestStart=Date.now();try { response=await this.fetcher(url,{headers:{'X-Goog-Api-Key':this.key},signal:AbortSignal.timeout(6000)});body=await response.json().catch(()=>({})); } catch { if(attempt===2) throw new Error('YouTube request timed out'); continue; } finally {this.requestMs+=Date.now()-requestStart;}
      if(response.ok)return body;
      if(response.status===429||response.status>=500){if(attempt<2){await new Promise(r=>setTimeout(r,200*(2**attempt)));continue;}}
      const allowed=['quotaExceeded','dailyLimitExceeded','playlistNotFound','keyInvalid','accessNotConfigured','forbidden'];
      const reason=body.error?.errors?.[0]?.reason;
      throw new Error(`YouTube ${response.status}: ${allowed.includes(reason)?reason:'request rejected'}`);
    }
  }
}
// Bulk lookups and bounded D1 batches replace per-video round trips.
export async function saveVideos(db,items,performers,runTime,source){
  const unique=[...new Map(items.filter(item=>/^[\w-]{11}$/.test(item.id)&&item.snippet&&item.status?.privacyStatus==='public').map(item=>[item.id,item])).values()];
  let inserted=0;
  for(let offset=0;offset<unique.length;offset+=50){
    const chunk=unique.slice(offset,offset+50),ids=chunk.map(x=>x.id),marks=ids.map(()=>'?').join(',');
    const old=new Map((await db.prepare(`SELECT * FROM videos WHERE id IN (${marks})`).bind(...ids).all()).results.map(v=>[v.id,v]));
    const matches=new Set((await db.prepare(`SELECT performer_id,video_id FROM matches WHERE video_id IN (${marks})`).bind(...ids).all()).results.map(v=>v.performer_id+':'+v.video_id));
    const excluded=new Set((await db.prepare(`SELECT performer_id,video_id FROM exclusions WHERE video_id IN (${marks})`).bind(...ids).all()).results.map(v=>v.performer_id+':'+v.video_id));
    const statements=[],channels=new Map();
    for(const item of chunk){
      const snippet=item.snippet,duration=seconds(item.contentDetails?.duration),prior=old.get(item.id);
      if(prior&&prior.channel_id!==snippet.channelId)continue;
      const eligible=performers.map(p=>({p,classification:classify(snippet.title,JSON.parse(p.aliases),duration)})).filter(({p,classification})=>classification&&!excluded.has(p.id+':'+item.id));
      if(!eligible.length)continue;
      const changed=!prior||prior.title!==snippet.title||prior.published_at!==(snippet.publishedAt||null)||!prior.available;
      const stale=!prior?.checked_at||Date.parse(runTime)-Date.parse(prior.checked_at)>=7*86400000;
      const missing=eligible.filter(({p})=>!matches.has(p.id+':'+item.id));
      if(changed||stale||missing.length){
        channels.set(snippet.channelId,snippet.channelTitle||'Unknown reactor');
        statements.push(db.prepare('INSERT INTO videos(id,channel_id,title,published_at,discovered_at,checked_at,format,available) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,published_at=excluded.published_at,checked_at=excluded.checked_at,available=1').bind(item.id,snippet.channelId,snippet.title,snippet.publishedAt||null,runTime,runTime,duration!==null&&duration>180?'FULL_LENGTH':'UNKNOWN'));
      }
      if(!prior)inserted++;
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
function measuredDatabase(raw,metrics){
  const originals=new WeakMap();
  const measure=async task=>{const start=Date.now();try{return await task();}finally{metrics.dbMs+=Date.now()-start;}};
  function wrap(statement){const proxy={bind(...args){return wrap(statement.bind(...args));},first(...args){return measure(()=>statement.first(...args));},all(...args){return measure(()=>statement.all(...args));},run(...args){return measure(()=>statement.run(...args));}};originals.set(proxy,statement);return proxy;}
  return {prepare(query){return wrap(raw.prepare(query));},batch(statements){return measure(()=>raw.batch(statements.map(s=>originals.get(s)||s)));}};
}
export async function runDiscovery(env,seed,fetcher=fetch,options={}){
  const startedMs=Date.now(),metrics={dbMs:0,examined:0};const db=measuredDatabase(database(env),metrics);await seedDatabase(db,seed);
  if(!env.YOUTUBE_API_KEY)return {status:'blocked',reason:'YouTube API key is not configured'};
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const lease=await db.prepare("INSERT INTO state(key,value) VALUES('discovery-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(String(Date.now()+120000),Date.now()).run();
  if(!lease.meta.changes)return {status:'busy'};
  const api=new YouTube(env.YOUTUBE_API_KEY,fetcher);let added=0,scanned=0,historyPages=0,recentAdded=0,historyAdded=0,final='succeeded',detail='';
  await db.prepare('INSERT INTO runs(id,started_at,status) VALUES(?,?,?)').bind(id,now,'running').run();
  try{
    const performers=(await db.prepare("SELECT p.* FROM performers p LEFT JOIN state s ON s.key='search-touch:'||p.id WHERE p.discovery_enabled=1 AND p.id='missioned-souls' ORDER BY COALESCE(s.value,''),p.id").all()).results;
    if(!performers.length)return {id,status:'succeeded',calls:0,channels:0,added:0,detail:'No discovery-enabled performers.'};
    // Fresh uploads get the first allocation. Historical cursors are independent.
    const due=options.performerId?[]:(await db.prepare('SELECT * FROM channels WHERE recent_checked_at IS NULL OR recent_checked_at<? ORDER BY recent_attempted_at ASC,recent_checked_at ASC,id LIMIT 7').bind(new Date(Date.now()-86400000).toISOString()).all()).results;
    if(due.length)await db.batch(due.map(c=>db.prepare('UPDATE channels SET recent_attempted_at=? WHERE id=?').bind(now,c.id)));
    const missing=due.filter(c=>!c.uploads);
    if(missing.length){
      const data=await api.get('channels',{part:'contentDetails',id:missing.map(c=>c.id).join(',')});
      const playlists=new Map((data.items||[]).map(c=>[c.id,c.contentDetails?.relatedPlaylists?.uploads]));
      for(const c of missing){c.uploads=playlists.get(c.id);if(c.uploads)await db.prepare('UPDATE channels SET uploads=? WHERE id=?').bind(c.uploads,c.id).run();else detail+='Unavailable channel; ';}
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
        else if(result.reason.message.includes('playlistNotFound')){await db.prepare('UPDATE channels SET uploads=NULL WHERE id=?').bind(channel.id).run();detail+='Unavailable uploads playlist; ';}
        else pageError=result.reason;
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
      await db.prepare('UPDATE channels SET recent_checked_at=?,next_page=COALESCE(next_page,?),scan_before=COALESCE(scan_before,?),scan_started=COALESCE(scan_started,?) WHERE id=?').bind(now,next||null,next?cutoff:null,next?now:null,channel.id).run();
      scanned++;channel.checkpointed=true;
    }}
    for(let offset=0;offset<ids.length;offset+=50){
      const chunk=ids.slice(offset,offset+50);
      const data=await api.get('videos',{part:'snippet,contentDetails,status',id:chunk.join(',')});
      const n=await saveVideos(db,data.items||[],performers,now,'Recent-upload check');added+=n;recentAdded+=n;
      for(const id of chunk)fetched.add(id);
      await checkpointRecent();
    }
    await checkpointRecent();
    if(pageError)throw pageError;
    // Rotate historical work separately, at most two pages from distinct channels.
    const backlog=options.performerId?[]:(await db.prepare('SELECT * FROM channels WHERE next_page IS NOT NULL ORDER BY history_checked_at ASC,id LIMIT 2').all()).results;
    for(const channel of backlog){
      if(api.calls>22||Date.now()>api.deadline-6000)break;
      const page=await api.get('playlistItems',{part:'contentDetails',playlistId:channel.uploads,maxResults:50,pageToken:channel.next_page});
      const ids=(page.items||[]).map(x=>x.contentDetails?.videoId).filter(Boolean);
      if(ids.length){const data=await api.get('videos',{part:'snippet,contentDetails,status',id:ids.join(',')});const n=await saveVideos(db,data.items||[],performers,now,'Historical upload scan');added+=n;historyAdded+=n;metrics.examined+=ids.length;}
      const reached=(page.items||[]).some(x=>x.contentDetails?.videoPublishedAt&&x.contentDetails.videoPublishedAt<channel.scan_before);
      const next=!reached?page.nextPageToken:null;
      await db.prepare('UPDATE channels SET next_page=?,scan_before=?,scan_started=?,checked_at=?,history_checked_at=? WHERE id=?').bind(next||null,next?channel.scan_before:null,next?channel.scan_started:null,next?channel.checked_at:channel.scan_started,now,channel.id).run();
      historyPages++;
      if(next){final='partial';detail+='Historical upload continuation retained; ';}
    }
    // Resume a fixed-window search one page at a time; completed windows become incremental.
    let searched=0;
    for(const p of performers){
      if(options.performerId&&p.id!==options.performerId)continue;
      if(searched>=4||api.calls>22||Date.now()>api.deadline-4000)break;
      const key=`search:${p.id}`,progressKey=`search-progress:${p.id}`;
      const prev=await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first();
      const pending=await db.prepare('SELECT value FROM state WHERE key=?').bind(progressKey).first();
      if(!pending&&prev?.value.slice(0,10)===now.slice(0,10))continue;
      const terms=JSON.parse(p.aliases);
      const cursor=pending?JSON.parse(pending.value):{term:0,page:null,startedAt:now,after:prev?new Date(Date.parse(prev.value)-48*3600000).toISOString():p.lookback_days===0?null:new Date(Date.now()-p.lookback_days*86400000).toISOString()};
      const quotaKey=`search-budget:${now.slice(0,10)}`;
      const dailyLimit=Math.max(1,Math.min(80,Number(env.DISCOVERY_DAILY_SEARCH_LIMIT)||20));
      const slot=await db.prepare("INSERT INTO state(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(state.value AS INTEGER)+1 WHERE CAST(state.value AS INTEGER)<?").bind(quotaKey,dailyLimit).run();
      if(!slot.meta.changes){final='partial';detail+='Daily search budget reached; queued searches resume tomorrow. ';break;}
      searched++;
      await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(`search-touch:${p.id}`,now).run();
      try{
        if(!pending)await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(progressKey,JSON.stringify(cursor)).run();
        const result=await api.get('search',{part:'snippet',type:'video',order:'date',maxResults:50,q:`"${terms[cursor.term]||p.name}" reaction`,publishedAfter:cursor.after,publishedBefore:cursor.startedAt,pageToken:cursor.page});
        const ids=(result.items||[]).map(x=>x.id?.videoId).filter(Boolean);
        if(ids.length){const data=await api.get('videos',{part:'snippet,contentDetails,status',id:ids.join(',')});added+=await saveVideos(db,data.items||[],[p],now,'Performer discovery search');metrics.examined+=ids.length;}
        if(result.nextPageToken)cursor.page=result.nextPageToken;
        else{cursor.page=null;cursor.term++;}
        if(cursor.term<terms.length){
          await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(progressKey,JSON.stringify(cursor)).run();
          final='partial';detail+='Performer history scan continuation queued. ';
        }else await db.batch([
          db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,cursor.startedAt),
          db.prepare('DELETE FROM state WHERE key=?').bind(progressKey)
        ]);
        await db.prepare('DELETE FROM state WHERE key=?').bind(`search-error:${p.id}`).run();
      }catch(error){
        await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(`search-error:${p.id}`,error.message).run();
        throw error;
      }
    }
    // Refresh a bounded oldest-first batch, including items no longer publicly available.
    if(!options.performerId&&api.calls<27&&Date.now()<api.deadline-4000){
      const stale=(await db.prepare('SELECT id FROM videos WHERE checked_at IS NULL OR checked_at<? ORDER BY checked_at ASC LIMIT 50').bind(new Date(Date.now()-7*86400000).toISOString()).all()).results;
      if(stale.length){const result=await api.get('videos',{part:'snippet,status',id:stale.map(v=>v.id).join(',')});const found=new Map((result.items||[]).map(v=>[v.id,v]));
        await db.batch(stale.map(v=>{const fresh=found.get(v.id);return fresh?.status?.privacyStatus==='public'?db.prepare('UPDATE videos SET title=?,checked_at=?,available=1 WHERE id=?').bind(fresh.snippet.title,now,v.id):db.prepare('UPDATE videos SET checked_at=?,available=0 WHERE id=?').bind(now,v.id);}));}
    }
    if(detail&&final==='succeeded')final='partial';
  }catch(error){final='partial';detail+=error.message;}
  finally{
    await db.prepare('UPDATE runs SET finished_at=?,status=?,calls=?,channels=?,added=?,detail=?,history_pages=?,recent_added=?,history_added=?,api_ms=?,db_ms=?,duration_ms=?,records_examined=? WHERE id=?').bind(new Date().toISOString(),final,api.calls,scanned,added,detail,historyPages,recentAdded,historyAdded,api.requestMs,metrics.dbMs,Date.now()-startedMs,metrics.examined,id).run();
    // Lease remains until its 120-second expiry, preventing accidental rapid repeats.
  }
  return {id,status:final,calls:api.calls,channels:scanned,added,detail};
}
