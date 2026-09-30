import {database,seedDatabase} from './db.mjs';
import {YouTube,saveVideo} from './discovery.mjs';
const channelPattern=/^UC[\w-]{22}$/;
const topic=id=>`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const reply=(text,status=200)=>new Response(text,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
export function callbackBase(env){try{const u=new URL(env.YOUTUBE_PUSH_CALLBACK_URL);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/api/youtube/push'?u.href:null;}catch{return null;}}
export async function pushStatus(db,env){
 const now=Date.now();
 const counts=await db.prepare('SELECT COUNT(*) total,SUM(CASE WHEN expires_at>? THEN 1 ELSE 0 END) active,SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) errors FROM push_subscriptions').bind(now).first();
 const jobs=await db.prepare("SELECT COUNT(*) total FROM push_jobs WHERE status='pending'").first();
 const last=await db.prepare("SELECT value FROM state WHERE key='last-push-received'").first();
 return {configured:Boolean(callbackBase(env)),apiConfigured:Boolean(env.YOUTUBE_API_KEY),total:counts.total,active:counts.active||0,errors:counts.errors||0,queued:jobs.total,lastReceivedAt:last?.value||null};
}
// Subscribe/renew a bounded batch. Only a verified hub callback activates a lease.
export async function renewSubscriptions(env,seed,fetcher=fetch){
 const db=database(env);await seedDatabase(db,seed);
 const base=callbackBase(env);if(!base)return {status:'blocked',reason:'A public YouTube notification endpoint is not configured.'};
 const now=Date.now(),leaseValue=String(now+60000);
 const lease=await db.prepare("INSERT INTO state(key,value) VALUES('push-renew-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(leaseValue,now).run();
 if(!lease.meta.changes)return {status:'busy'};
 let requested=0,failed=0;
 try{
  const rows=(await db.prepare(`SELECT c.id,s.secret,s.token FROM channels c LEFT JOIN push_subscriptions s ON s.channel_id=c.id
   WHERE (s.channel_id IS NULL OR (s.expires_at<? AND s.pending_until<?) OR (s.callback<>? AND s.pending_until<?))
   ORDER BY COALESCE(s.requested_at,''),c.id LIMIT 20`).bind(now+86400000,now,base,now).all()).results;
  for(const c of rows){
   if(!channelPattern.test(c.id))continue;
   const secret=c.secret||random(),token=c.token||random();
   // Stable capability URL and secret also authenticate challenges during renewals.
   const callback=new URL(base);callback.searchParams.set('channel',c.id);callback.searchParams.set('token',token);
   await db.prepare('INSERT INTO push_subscriptions(channel_id,secret,token,callback,requested_at,pending_until) VALUES(?,?,?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET callback=excluded.callback,requested_at=excluded.requested_at,pending_until=excluded.pending_until,error=NULL').bind(c.id,secret,token,base,new Date().toISOString(),now+600000).run();
   try{
    const response=await fetcher('https://pubsubhubbub.appspot.com/subscribe',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({'hub.mode':'subscribe','hub.callback':callback.href,'hub.topic':topic(c.id),'hub.verify':'async','hub.verify_token':token,'hub.secret':secret,'hub.lease_seconds':'432000'}),signal:AbortSignal.timeout(3000),redirect:'error'});
    if(response.status!==202)throw new Error('Hub rejected subscription');requested++;
   }catch{failed++;await db.prepare("UPDATE push_subscriptions SET error='Subscription request failed; retry queued' WHERE channel_id=?").bind(c.id).run();}
  }
 }finally{await db.prepare("DELETE FROM state WHERE key='push-renew-lease' AND value=?").bind(leaseValue).run();}
 return {status:failed?'partial':'requested',requested,failed};
}
export function feedEntries(xml,channel){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsupported XML');
 const entries=[];
 for(const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/g)){
  const video=/<yt:videoId\s*>\s*([\w-]{11})\s*<\/yt:videoId\s*>/.exec(match[1])?.[1];
  const id=/<yt:channelId\s*>\s*(UC[\w-]{22})\s*<\/yt:channelId\s*>/.exec(match[1])?.[1];
  if(!video||id!==channel)throw new Error('Invalid channel or video');entries.push(video);
 }
 if(entries.length>50)throw new Error('Too many entries');return [...new Set(entries)];
}
export async function signatureValid(secret,bytes,header){
 const match=/^(sha1|sha256)=([a-f0-9]+)$/i.exec(header||'');if(!match)return false;
 const algorithm=match[1].toLowerCase()==='sha1'?'SHA-1':'SHA-256';
 if(match[2].length!==(algorithm==='SHA-1'?40:64))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:algorithm},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(match[2].match(/../g),v=>parseInt(v,16)),bytes);
}
async function boundedBody(request,max=262144){
 if(Number(request.headers.get('Content-Length'))>max)throw new Error('Too large');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('Too large');}chunks.push(value);}
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return body;
}
export async function youtubePush(request,env,seed,ctx){
 if(!['GET','POST'].includes(request.method))return reply('Method not allowed',405);
 const db=database(env);await seedDatabase(db,seed);const url=new URL(request.url),channel=url.searchParams.get('channel');
 if(!channelPattern.test(channel||''))return reply('Invalid channel',400);
 const sub=await db.prepare('SELECT * FROM push_subscriptions WHERE channel_id=?').bind(channel).first();
 if(!sub||url.searchParams.get('token')!==sub.token)return reply('Unknown subscription',404);
 const now=Date.now();
 if(request.method==='GET'){
  const mode=url.searchParams.get('hub.mode'),challenge=url.searchParams.get('hub.challenge'),seconds=Number(url.searchParams.get('hub.lease_seconds'));
  if(mode!=='subscribe'||url.searchParams.get('hub.topic')!==topic(channel)||!challenge||challenge.length>2000||!Number.isInteger(seconds)||seconds<1||seconds>31536000||sub.pending_until<now)return reply('Invalid verification',403);
  // hub.verify_token is an older extension; the capability token is always checked.
  if(url.searchParams.has('hub.verify_token')&&url.searchParams.get('hub.verify_token')!==sub.token)return reply('Invalid verification',403);
  await db.prepare('UPDATE push_subscriptions SET expires_at=?,pending_until=0,error=NULL WHERE channel_id=?').bind(now+seconds*1000,channel).run();
  return reply(challenge);
 }
 if(sub.expires_at<now)return reply('Subscription expired',403);
 let bytes;try{bytes=await boundedBody(request);}catch{return reply('Payload too large',413);}
 if(!await signatureValid(sub.secret,bytes,request.headers.get('X-Hub-Signature')))return reply('Invalid signature',403);
 let entries;try{entries=feedEntries(new TextDecoder().decode(bytes),channel);}catch{return reply('Invalid feed',400);}
 const received=new Date().toISOString();
 await db.batch([...entries.map(video=>db.prepare(`INSERT INTO push_jobs(video_id,channel_id,received_at) VALUES(?,?,?) ON CONFLICT(video_id) DO UPDATE SET received_at=excluded.received_at,status='pending',attempts=0,next_attempt=0,error=NULL
  WHERE push_jobs.status<>'pending' AND (push_jobs.processed_at IS NULL OR push_jobs.processed_at<?)`).bind(video,channel,received,new Date(now-300000).toISOString())),
  db.prepare("INSERT INTO state(key,value) VALUES('last-push-received',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(received)]);
 // Acknowledge only after persistence. A scheduler retries work if background processing fails.
 if(ctx?.waitUntil)ctx.waitUntil(processPushJobs(env,seed).catch(()=>console.error('Push processing queued for retry')));
 return reply('Accepted',202);
}
export async function processPushJobs(env,seed,fetcher=fetch){
 const db=database(env);await seedDatabase(db,seed);if(!env.YOUTUBE_API_KEY)return {status:'blocked'};
 const now=Date.now(),leaseValue=String(now+60000);
 const lease=await db.prepare("INSERT INTO state(key,value) VALUES('push-process-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(leaseValue,now).run();
 if(!lease.meta.changes)return {status:'busy'};
 let added=0,processed=0;
 try{
  const jobs=(await db.prepare("SELECT * FROM push_jobs WHERE status='pending' AND next_attempt<=? ORDER BY received_at LIMIT 50").bind(now).all()).results;
  if(!jobs.length)return {status:'idle',added:0};
  const performers=(await db.prepare('SELECT * FROM performers WHERE discovery_enabled=1').all()).results;
  const api=new YouTube(env.YOUTUBE_API_KEY,fetcher);let items,failed=false;
  try{const response=await api.get('videos',{part:'snippet,contentDetails,status',id:jobs.map(j=>j.video_id).join(',')});items=new Map((response.items||[]).map(v=>[v.id,v]));}catch{failed=true;items=new Map();}
  for(const job of jobs){
   const item=items.get(job.video_id),at=new Date().toISOString();
   if(failed||!item||!item.contentDetails?.duration){
    const attempts=job.attempts+1;
    // Quota/network failures remain retryable; a missing upload eventually ends its retries.
    const state=!failed&&attempts>=8?'failed':'pending';
    await db.prepare('UPDATE push_jobs SET attempts=?,next_attempt=?,status=?,error=?,processed_at=? WHERE video_id=? AND received_at=?').bind(attempts,Date.now()+Math.min(6*3600000,60000*2**Math.min(attempts,8)),state,failed?'YouTube temporarily unavailable':'Video details not yet available',state==='failed'?at:null,job.video_id,job.received_at).run();continue;
   }
   // Treat hub IDs as hints: YouTube metadata must confirm the subscribed channel.
   if(item.snippet?.channelId===job.channel_id)added+=await saveVideo(db,item,performers,at,'YouTube upload notification');
   await db.prepare("UPDATE push_jobs SET status='done',processed_at=?,error=NULL WHERE video_id=? AND received_at=?").bind(at,job.video_id,job.received_at).run();processed++;
  }
 }finally{await db.prepare("DELETE FROM state WHERE key='push-process-lease' AND value=?").bind(leaseValue).run();}
 return {status:'processed',processed,added};
}
