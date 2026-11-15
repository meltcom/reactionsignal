import {database,seedDatabase} from './db.mjs';
import {classify,runDiscovery} from './discovery.mjs';
import {recognizeCandidate} from './candidate-recognition.mjs';
import {feedEntries,boundedBody,processPushJobs,renewSubscriptions} from './push.mjs';
export function rssRetryMs(streak,retryAfter,now=Date.now(),random=Math.random){
 const base=Math.min(6*3600000,15*60000*2**Math.min(5,Math.max(0,streak-1)));
 const hint=/^\d+$/.test(retryAfter||'')?Number(retryAfter)*1000:Date.parse(retryAfter)-now;
 return Math.round(Math.min(6*3600000,Math.max(base*(streak>1?1+random()*.1:1),Number.isFinite(hint)?hint:0)));
}
// API coverage always runs before optional feed polling. Feed failures cannot
// prevent the reliable path; new RSS hints are verified after polling.
export async function discoveryCycle(env,seed,tasks={}){
 const process=tasks.processPushJobs||processPushJobs;
 const safe=async(task,label)=>{try{return await task(env,seed);}catch{console.error(label);return {status:'failed'};}};
 const push=await safe(process,'Notification processing failed; API discovery remains enabled');
 const discovery=await (tasks.runDiscovery||runDiscovery)(env,seed);
 const rss=await safe(tasks.pollRss||pollRss,'RSS fallback failed; API discovery already completed');
 const rssPush=rss?.queued?await safe(process,'RSS verification queued for retry'):null;
 const subscriptions=await safe(tasks.renewSubscriptions||renewSubscriptions,'Notification renewal failed; retry on next run');
 return {...discovery,push,rss,rssPush,subscriptions};
}
// Only known, eligible channel IDs are polled; feed IDs remain untrusted hints.
export async function pollRss(env,seed,fetcher=fetch){
 fetcher=fetcher.bind(globalThis);
 const db=database(env);await seedDatabase(db,seed);
 const now=Date.now(),at=new Date(now).toISOString(),lease=String(now+60000);
 const acquired=await db.prepare("INSERT INTO state(key,value) VALUES('rss-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(lease,now).run();
 if(!acquired.meta.changes)return {status:'busy'};
 let checked=0,queued=0,failed=0,deferred=0,limited=false;const errors={};const deadline=now+20000;
 try{
  const performers=(await db.prepare("SELECT aliases FROM performers WHERE discovery_enabled=1 AND id='missioned-souls'").all()).results;
  const aliases=performers.flatMap(p=>JSON.parse(p.aliases));
  if(!aliases.length)return {status:'idle',checked,queued,failed};
  const rows=(await db.prepare("SELECT c.id,h.value health FROM channels c LEFT JOIN rss_checks r ON r.channel_id=c.id LEFT JOIN state h ON h.key='rss-health:'||c.id WHERE c.discovery_scope='eligible' AND (r.retry_at IS NULL OR r.retry_at<=?) AND (r.checked_at IS NULL OR r.checked_at<?) ORDER BY COALESCE(r.checked_at,''),c.id LIMIT 40").bind(at,new Date(now-30*60000).toISOString()).all()).results;
  for(let offset=0;offset<rows.length&&Date.now()<deadline;offset+=4){
   await Promise.all(rows.slice(offset,offset+4).map(async c=>{
    if(!/^UC[\w-]{22}$/.test(c.id))return;
    const began=Date.now(),prior=c.health?JSON.parse(c.health):{};
    let httpStatus=null,retryAfter=null;
    try{
     const response=await fetcher(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.id}`,{signal:AbortSignal.timeout(6000),redirect:'manual',headers:{Accept:'application/atom+xml, application/xml, text/xml'}});
     httpStatus=response.status;retryAfter=[429,503].includes(httpStatus)?response.headers.get('retry-after'):null;
     if(!response.ok){await response.body?.cancel();throw new Error(`Feed HTTP ${response.status}`);}
     const xml=new TextDecoder().decode(await boundedBody(response));
     if(!/<feed\b/.test(xml)||!/<\/feed\s*>/.test(xml))throw new Error('Invalid feed');
     feedEntries(xml,c.id); // Validate every entry, even ones filtered by title.
     const ids=[];
     for(const entry of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/g)){
      const title=/<title\b[^>]*>([\s\S]*?)<\/title\s*>/.exec(entry[1])?.[1];
      if(!title||classify(title,aliases,null)||recognizeCandidate({title,channelId:c.id}).positiveTitleHint)ids.push(...feedEntries(`<entry>${entry[1]}</entry>`,c.id));
     }
     for(const id of new Set(ids)){
      // Polling repeats do not reset retries or reopen completed jobs.
      const result=await db.prepare('INSERT OR IGNORE INTO push_jobs(video_id,channel_id,received_at,source) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM videos WHERE id=?)').bind(id,c.id,at,'RSS fallback',id).run();
      queued+=result.meta.changes||0;
      if(result.meta.changes)await db.prepare('INSERT OR IGNORE INTO notification_receipts(video_id,source,received_at) VALUES(?,?,?)').bind(id,'RSS fallback',at).run();
     }
     await db.prepare('INSERT INTO rss_checks(channel_id,checked_at) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET checked_at=excluded.checked_at,retry_at=NULL,error=NULL').bind(c.id,at).run();checked++;
     await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('rss-health:'+c.id,JSON.stringify({lastAttempt:at,lastSuccess:at,streak:0,httpStatus,durationMs:Date.now()-began})).run();
    }catch(error){
     const reason=/^Feed HTTP \d{3}$/.test(error.message)?error.message:['Invalid feed','Invalid channel or video','Unsupported XML','Too many entries','Too large'].includes(error.message)?error.message:['TimeoutError','AbortError'].includes(error.name)?'Feed timeout':'Feed network or runtime error';
     errors[reason]=(errors[reason]||0)+1;
     // A feed 404 does not establish that a channel is unavailable. YouTube's
     // feed endpoint can fail for valid channels; retain bounded recovery probes.
     const streak=(prior.streak||0)+1;
     const retryMs=rssRetryMs(streak,retryAfter,now);
     failed++;await db.prepare('INSERT INTO rss_checks(channel_id,checked_at,retry_at,error) VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET checked_at=excluded.checked_at,retry_at=excluded.retry_at,error=excluded.error').bind(c.id,at,new Date(now+retryMs).toISOString(),reason+'; retry scheduled').run();
     await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('rss-health:'+c.id,JSON.stringify({lastAttempt:at,lastSuccess:prior.lastSuccess||null,streak,httpStatus,durationMs:Date.now()-began,error:reason})).run();
    }
   }));
   // Failed feeds back off individually. Continue bounded recovery probes so
   // early failures cannot starve healthy channels later in this batch.
   if(!checked&&failed>=8&&Object.keys(errors).length===1&&errors['Feed HTTP 404'])limited=true;
  }
  deferred=Math.max(0,rows.length-checked-failed);
  await db.prepare("INSERT INTO state(key,value) VALUES('rss-last-batch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({at,checked,queued,failed,errors,deferred,serviceStatus:limited?'degraded':failed?'partial':checked?'available':'idle'})).run();
 }finally{await db.prepare("DELETE FROM state WHERE key='rss-lease' AND value=?").bind(lease).run();}
 return {status:failed?'partial':'checked',checked,queued,failed};
}
