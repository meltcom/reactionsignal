import {quotaPolicy,quotaStatus,reserveGeneral,finishReservation,QuotaBlocked,QUOTA_PROTOCOL} from './youtube-quota.mjs';
import {automaticMatch} from './automatic-matches.mjs';
import {mentionsPerformer,reactionWording} from './approval-rules.mjs';
import {EXCLUDED} from './db.mjs';
import {seconds} from './discovery.mjs';
import {videoFormat} from './video-format.mjs';
const json=(value,status=200,charged=0)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-RJ-Quota-Charged':String(charged),'X-RJ-Quota-Protocol':QUOTA_PROTOCOL}});
async function authorized(request,env){
 if(!env.BACKFILL_API_TOKEN||env.BACKFILL_API_TOKEN.length<32)return false;
 const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([hash(request.headers.get('Authorization')||''),hash('Bearer '+env.BACKFILL_API_TOKEN)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
const HISTORY_POLICY='historical-reactions-v1';
const nonReaction=/\b(?:livestream|live stream|watch party|announcement|trailer|teaser|preview|tour updates?|behind the scenes|view count|analytics|tribute|fan girling)\b/i;
export function historicalReaction(performer,item,channelId,cutoff){
 const snippet=item?.snippet;
 const published=Date.parse(snippet?.publishedAt);
 if(!snippet?.title||!Number.isFinite(published)||published>cutoff||EXCLUDED.includes(item.id)||nonReaction.test(snippet.title))return false;
 const aliases=JSON.parse(performer.aliases);
 const narrative=String(snippet.description||'').split(/[\n.!?]+/).some(sentence=>
  !/https?:\/\/|^\s*#|\boriginal\s+(?:video|link)\b/i.test(sentence)&&mentionsPerformer(sentence,aliases)&&reactionWording(sentence));
 if(!narrative&&!(mentionsPerformer(snippet.title,aliases)&&reactionWording(snippet.title)))return false;
 return automaticMatch({...performer,performer_id:'missioned-souls',channel_id:channelId,discovery_scope:'eligible'},item).status==='CONFIRMED';
}
async function publishHistorical(db,items,ids,channelId,cutoff,requestId){
 const performer=await db.prepare("SELECT aliases,review_mode FROM performers WHERE id='missioned-souls' AND status='active' AND review_mode='auto'").first();
 if(!performer)return [];
 const added=[];
 const at=new Date().toISOString();
 const source='Automatic historical backfill '+requestId;
 for(const item of items){
  if(!ids.has(item.id)||!historicalReaction(performer,item,channelId,cutoff))continue;
  const guard=`EXISTS(SELECT 1 FROM channels WHERE id=? AND discovery_scope='eligible')
   AND EXISTS(SELECT 1 FROM performers WHERE id='missioned-souls' AND status='active' AND review_mode='auto' AND aliases=?)
   AND NOT EXISTS(SELECT 1 FROM matches WHERE video_id=?)
   AND NOT EXISTS(SELECT 1 FROM exclusions WHERE performer_id='missioned-souls' AND video_id=?)`;
  const format=videoFormat(item,seconds(item.contentDetails?.duration));
  const auditKey='historical-backfill:'+item.id;
  const audit=JSON.stringify({id:item.id,channelId,requestId,at,policy:HISTORY_POLICY,title:item.snippet.title});
  const claimed="EXISTS(SELECT 1 FROM state WHERE key=? AND value=?)";
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO state(key,value) SELECT ?,? WHERE ${guard}
    AND NOT EXISTS(SELECT 1 FROM videos WHERE id=?)`).bind(auditKey,audit,channelId,performer.aliases,item.id,item.id,item.id),
   db.prepare(`INSERT OR IGNORE INTO videos(id,channel_id,title,published_at,discovered_at,checked_at,format,available)
    SELECT ?,?,?,?,?,?,?,1 WHERE ${claimed}`).bind(item.id,channelId,item.snippet.title,item.snippet.publishedAt,at,at,format,auditKey,audit),
   db.prepare(`INSERT OR IGNORE INTO matches(performer_id,video_id,status,source)
    SELECT 'missioned-souls',?,'CONFIRMED',? WHERE ${claimed}`).bind(item.id,source,auditKey,audit)
  ]);
  // D1 change counts include trigger writes. Read the committed decision and
  // request-owned audit instead of assuming exactly one row changed.
  const committed=await db.prepare(`SELECT m.video_id FROM matches m
   JOIN state s ON s.key=? AND s.value=?
   WHERE m.performer_id='missioned-souls' AND m.video_id=?
   AND m.status='CONFIRMED' AND m.source=?
   AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)`)
   .bind(auditKey,audit,item.id,source).first();
  if(committed)added.push(item.id);
 }
 return added;
}
export async function backfillBroker(request,env,fetcher=fetch){
 if(!await authorized(request,env))return json({error:'Backfill credential required',code:'unauthorized'},401);
 const path=new URL(request.url).pathname;
 if(path==='/api/backfill/status'&&request.method==='GET')return json(await quotaStatus(env));
 if(path==='/api/backfill/publications'&&request.method==='GET'){
  if(!env.DB)return json({error:'Catalog unavailable',code:'broker_unconfigured'},503);
  const ids=(new URL(request.url).searchParams.get('ids')||'').split(',');
  if(!ids.length||ids.length>50||ids.some(id=>!/^[-\w]{11}$/.test(id)))return json({error:'Invalid IDs',code:'invalid_ids'},400);
  const rows=[];
  for(const id of new Set(ids)){
   const match=await env.DB.prepare("SELECT status,source FROM matches WHERE performer_id='missioned-souls' AND video_id=?").bind(id).first();
   const excluded=await env.DB.prepare("SELECT 1 AS present FROM exclusions WHERE performer_id='missioned-souls' AND video_id=?").bind(id).first();
   const audit=await env.DB.prepare('SELECT value FROM state WHERE key=?').bind('historical-backfill:'+id).first();
   const evidence=audit?JSON.parse(audit.value):null;
   const published=!excluded&&match?.status==='CONFIRMED'&&evidence&&match.source==='Automatic historical backfill '+evidence.requestId;
   rows.push({id,outcome:excluded?'excluded':published?'published':match?'existing':'missing',audit:published?evidence:null});
  }
  return json({rows});
 }
 if(path!=='/api/backfill/execute'||request.method!=='POST')return json({error:'Not found'},404);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 if(Number(request.headers.get('Content-Length'))>16000)return json({error:'Request too large'},413);
 let body;try{const text=await request.text();if(text.length>16000)return json({error:'Request too large'},413);body=JSON.parse(text);}catch{return json({error:'Invalid JSON'},400);}
 if(!body||Array.isArray(body)||typeof body!=='object')return json({error:'Invalid request'},400);
 const {endpoint,params,channel_id:channelId,request_id:requestId,publish_before:publishBefore}=body;
 if(!['channels','playlistItems','videos'].includes(endpoint)||!/^UC[\w-]{22}$/.test(channelId||'')||!params||Array.isArray(params)||typeof params!=='object')return json({error:'Only known-reactor read requests are supported'},400);
 if(!quotaPolicy(env).tracking||!env.DB||!env.YOUTUBE_API_KEY)return json({error:'Broker is not configured',code:'broker_unconfigured'},503);
 const cutoff=typeof publishBefore==='string'?Date.parse(publishBefore):NaN;
 if(publishBefore!==undefined&&(endpoint!=='videos'||!Number.isFinite(cutoff)||cutoff>Date.now()))return json({error:'Invalid historical cutoff',code:'invalid_publish_cutoff'},400);
 if(publishBefore!==undefined&&env.BACKFILL_AUTO_PUBLISH!=='1')return json({error:'Automatic publication is disabled',code:'publish_disabled'},403);
 const channel=await env.DB.prepare("SELECT id,uploads FROM channels WHERE id=? AND discovery_scope='eligible' AND id<>'UCeTfwcnUVurw7Qrk_KF5Idw'").bind(channelId).first();
 if(!channel)return json({error:'Reactor is not currently eligible',code:'reactor_ineligible'},403);
 const accepted={channels:['part','id'],playlistItems:['part','playlistId','pageToken','maxResults'],videos:['part','id']};
 if(Object.keys(params).some(k=>!accepted[endpoint].includes(k)))return json({error:'Unsupported parameters'},400);
 let query;
 if(endpoint==='channels'){
  if(params.id!==channelId||params.part!=='contentDetails')return json({error:'Invalid channel lookup'},400);
  query={part:'contentDetails',id:channelId};
 }else if(endpoint==='playlistItems'){
  const saved=channel.uploads||((await env.DB.prepare('SELECT value FROM state WHERE key=?').bind('backfill-upload-playlist:'+channelId).first())?.value);
  if(!saved||params.playlistId!==saved||String(params.maxResults)!=='50'||params.part!=='snippet,contentDetails'||(params.pageToken!==undefined&&(typeof params.pageToken!=='string'||params.pageToken.length>2048)))return json({error:'Uploads playlist does not match the eligible reactor'},400);
  query={part:'snippet,contentDetails',playlistId:saved,maxResults:50,...(params.pageToken?{pageToken:params.pageToken}:{})};
 }else{
  const ids=typeof params.id==='string'?params.id.split(','):[];
  if(params.part!=='snippet,contentDetails,status'||!ids.length||ids.length>50||ids.some(id=>!/^[-\w]{11}$/.test(id)))return json({error:'Invalid metadata batch'},400);
  query={part:'snippet,contentDetails,status',id:[...new Set(ids)].join(',')};
 }
 let reservation;
 try{reservation=await reserveGeneral(env,{actor:'backfill',endpoint,requestId});}
 catch(error){if(error instanceof QuotaBlocked)return json({error:error.message,code:error.code},error.status);throw error;}
 const url=new URL('https://www.googleapis.com/youtube/v3/'+endpoint);for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
 const started=Date.now();let response,data;
 try{response=await fetcher(url,{headers:{'X-Goog-Api-Key':env.YOUTUBE_API_KEY},redirect:'manual',signal:AbortSignal.timeout(15000)});if(response.status<300||response.status>=400)data=await response.json();}
 catch{await finishReservation(env,reservation,'network_error',null,Date.now()-started);return json({error:'Upstream request incomplete',code:'upstream_error'},502,1);}
 await finishReservation(env,reservation,response.ok?'succeeded':'http_error',response.status,Date.now()-started);
 if(response.status>=300&&response.status<400)return json({error:'Unexpected YouTube redirect',code:'upstream_redirect',http_status:response.status},502,1);
 if(!response.ok)return json({error:'YouTube request rejected',code:'upstream_rejected',http_status:response.status},response.status,1);
 if(endpoint==='channels'){
  const uploads=data.items?.find(c=>c.id===channelId)?.contentDetails?.relatedPlaylists?.uploads;
  if(uploads)await env.DB.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('backfill-upload-playlist:'+channelId,uploads).run();
 }
 const published=publishBefore===undefined?undefined:
  await publishHistorical(env.DB,data.items||[],new Set(query.id.split(',')),channelId,cutoff,requestId);
 return json({data,receipt:{protocol:QUOTA_PROTOCOL,requestId,quotaDay:reservation.quotaDay,units:1,published}},200,1);
}
