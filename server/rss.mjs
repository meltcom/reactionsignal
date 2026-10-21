import {database,seedDatabase} from './db.mjs';
import {classify,runDiscovery} from './discovery.mjs';
import {feedEntries,boundedBody,processPushJobs,renewSubscriptions} from './push.mjs';
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
  const rows=(await db.prepare("SELECT c.id FROM channels c LEFT JOIN rss_checks r ON r.channel_id=c.id WHERE c.discovery_scope='eligible' AND (r.retry_at IS NULL OR r.retry_at<=?) AND (r.checked_at IS NULL OR r.checked_at<?) ORDER BY COALESCE(r.checked_at,''),c.id LIMIT 40").bind(at,new Date(now-30*60000).toISOString()).all()).results;
  for(let offset=0;offset<rows.length&&Date.now()<deadline;offset+=4){
   await Promise.all(rows.slice(offset,offset+4).map(async c=>{
    if(!/^UC[\w-]{22}$/.test(c.id))return;
    try{
     const response=await fetcher(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.id}`,{signal:AbortSignal.timeout(6000),redirect:'manual',headers:{Accept:'application/atom+xml, application/xml, text/xml'}});
     if(!response.ok){await response.body?.cancel();throw new Error(`Feed HTTP ${response.status}`);}
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
    }catch(error){
     const reason=/^Feed HTTP \d{3}$/.test(error.message)?error.message:['Invalid feed','Invalid channel or video','Unsupported XML','Too many entries','Too large'].includes(error.message)?error.message:['TimeoutError','AbortError'].includes(error.name)?'Feed timeout':'Feed network or runtime error';
     errors[reason]=(errors[reason]||0)+1;
     // A feed 404 does not establish that a channel is unavailable. YouTube's
     // feed endpoint can fail for valid channels; probe again on the next cron.
     const retryMs=reason==='Feed timeout'||reason==='Feed network or runtime error'||/^Feed HTTP (404|429|5\d\d)$/.test(reason)?15*60000:3600000;
     failed++;await db.prepare('INSERT INTO rss_checks(channel_id,checked_at,retry_at,error) VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET checked_at=excluded.checked_at,retry_at=excluded.retry_at,error=excluded.error').bind(c.id,at,new Date(now+retryMs).toISOString(),reason+'; retry scheduled').run();
    }
   }));
   if(!checked&&failed>=8&&Object.keys(errors).length===1&&errors['Feed HTTP 404']){limited=true;deferred=Math.max(0,rows.length-offset-4);break;}
  }
  await db.prepare("INSERT INTO state(key,value) VALUES('rss-last-batch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({at,checked,queued,failed,errors,deferred,serviceStatus:limited?'degraded':failed?'partial':checked?'available':'idle'})).run();
 }finally{await db.prepare("DELETE FROM state WHERE key='rss-lease' AND value=?").bind(lease).run();}
 return {status:failed?'partial':'checked',checked,queued,failed};
}
