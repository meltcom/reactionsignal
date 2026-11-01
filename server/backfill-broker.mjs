import {quotaPolicy,quotaStatus,reserveGeneral,finishReservation,QuotaBlocked,QUOTA_PROTOCOL} from './youtube-quota.mjs';
const json=(value,status=200,charged=0)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-RJ-Quota-Charged':String(charged),'X-RJ-Quota-Protocol':QUOTA_PROTOCOL}});
async function authorized(request,env){
 if(!env.BACKFILL_API_TOKEN||env.BACKFILL_API_TOKEN.length<32)return false;
 const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([hash(request.headers.get('Authorization')||''),hash('Bearer '+env.BACKFILL_API_TOKEN)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function backfillBroker(request,env,fetcher=fetch){
 if(!await authorized(request,env))return json({error:'Backfill credential required',code:'unauthorized'},401);
 const path=new URL(request.url).pathname;
 if(path==='/api/backfill/status'&&request.method==='GET')return json(await quotaStatus(env));
 if(path!=='/api/backfill/execute'||request.method!=='POST')return json({error:'Not found'},404);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 if(Number(request.headers.get('Content-Length'))>16000)return json({error:'Request too large'},413);
 let body;try{const text=await request.text();if(text.length>16000)return json({error:'Request too large'},413);body=JSON.parse(text);}catch{return json({error:'Invalid JSON'},400);}
 if(!body||Array.isArray(body)||typeof body!=='object')return json({error:'Invalid request'},400);
 const {endpoint,params,channel_id:channelId,request_id:requestId}=body;
 if(!['channels','playlistItems','videos'].includes(endpoint)||!/^UC[\w-]{22}$/.test(channelId||'')||!params||Array.isArray(params)||typeof params!=='object')return json({error:'Only known-reactor read requests are supported'},400);
 if(!quotaPolicy(env).tracking||!env.DB||!env.YOUTUBE_API_KEY)return json({error:'Broker is not configured',code:'broker_unconfigured'},503);
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
 return json({data,receipt:{protocol:QUOTA_PROTOCOL,requestId,quotaDay:reservation.quotaDay,units:1}},200,1);
}
