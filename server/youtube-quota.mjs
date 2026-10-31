import {pacificDay} from './discovery-measurement.mjs';

export const QUOTA_PROTOCOL='rj-backfill-broker-v1';
const prefix='youtube-quota-v1:',baseline=prefix+'baseline-day';
const integer=(value,fallback)=>/^\d+$/.test(String(value??''))&&Number.isSafeInteger(Number(value))?Number(value):fallback;
export function quotaPolicy(env){
 return {protocol:QUOTA_PROTOCOL,tracking:env.YOUTUBE_QUOTA_TRACKING==='1',verified:env.YOUTUBE_QUOTA_VERIFIED==='1',enabled:env.BACKFILL_ENABLED==='1',
  generalLimit:integer(env.YOUTUBE_GENERAL_DAILY_LIMIT,0),backfillLimit:Math.min(300,integer(env.BACKFILL_DAILY_GENERAL_LIMIT,0)),
  reserve:Math.max(2000,integer(env.BACKFILL_GENERAL_RESERVE,2000)),minimumCoverage:0.95,
  searchLimit:0,timezone:'America/Los_Angeles'};
}
export class QuotaBlocked extends Error{constructor(code,status=429){super(code);this.code=code;this.status=status;}}

async function initialize(env,at){
 const day=pacificDay(at),key=prefix+'day:'+day,db=env.DB;
 // Legacy counters use UTC. Both overlapping UTC days overestimate rather than erase prior known usage.
 // Uncounted legacy paths are why backfill cannot begin on the instrumentation baseline day.
 const date=new Date(at),today=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()-1);const yesterday=date.toISOString().slice(0,10);
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO state(key,value) VALUES(?,?)').bind(baseline,day),
  db.prepare(`INSERT OR IGNORE INTO state(key,value)
   SELECT ?,json_object('general',CASE WHEN (SELECT value FROM state WHERE key=?)=? THEN COALESCE(SUM(CAST(value AS INTEGER)),0) ELSE 0 END,'backfill',0)
   FROM state WHERE (key LIKE ? OR key LIKE ?) AND key NOT LIKE '%:search'`).bind(key,baseline,day,'youtube-requests:'+today+':%','youtube-requests:'+yesterday+':%')
 ]);
 return {day,key,baselineDay:(await db.prepare('SELECT value FROM state WHERE key=?').bind(baseline).first()).value};
}

export async function quotaStatus(env,at=new Date()){
 const policy=quotaPolicy(env);
 if(!policy.tracking||!env.DB)return {...policy,baselineComplete:false,ledger:null,health:null,ready:false,reason:'tracking_disabled'};
 const state=await initialize(env,at),ledger=JSON.parse((await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(state.key).first()).value);
 const health=await env.DB.prepare('SELECT sampled_at,eligible,checked,run_status FROM discovery_health_samples ORDER BY sampled_at DESC LIMIT 1').first();
 const age=health?Date.parse(at)-Date.parse(health.sampled_at):Infinity;
 const healthy=!!health&&Number.isFinite(age)&&age>=-60000&&age<=1800000&&health.eligible>0&&health.checked/health.eligible>=policy.minimumCoverage&&['succeeded','partial'].includes(health.run_status);
 const baselineComplete=state.baselineDay<state.day;
 const reason=!policy.enabled?'backfill_disabled':!policy.verified?'project_quota_unverified':!policy.generalLimit||policy.generalLimit<=policy.reserve?'invalid_general_limit':!policy.backfillLimit?'backfill_limit_zero':!baselineComplete?'baseline_day_incomplete':!healthy?'fresh_coverage_unhealthy':ledger.backfill>=policy.backfillLimit?'backfill_daily_cap':ledger.general>=policy.generalLimit-policy.reserve?'fresh_reserve_protected':null;
 return {...policy,quotaDay:state.day,baselineDay:state.baselineDay,baselineComplete,ledger,health,healthy,ready:!reason,reason};
}

export async function reserveGeneral(env,{actor='rj',requestId=crypto.randomUUID(),endpoint,at=new Date()}={}){
 if(!['rj','backfill'].includes(actor))throw new QuotaBlocked('invalid_actor',400);
 const policy=quotaPolicy(env);
 if(!policy.tracking||!env.DB)throw new QuotaBlocked('tracking_disabled',503);
 if(!/^[a-zA-Z]+$/.test(endpoint||'')||endpoint==='search')throw new QuotaBlocked('endpoint_not_general',400);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId))throw new QuotaBlocked('invalid_request_id',400);
 const state=await initialize(env,at),ticket=prefix+'request:'+state.day+':'+requestId;
 if(await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(ticket).first())throw new QuotaBlocked('duplicate_request',409);
 if(actor==='backfill'){
  const status=await quotaStatus(env,at);if(!status.ready)throw new QuotaBlocked(status.reason,429);
 }
 // RJ keeps priority. During tracking-only rollout it is counted but not capped until the actual project limit is verified.
 const limit=actor==='backfill'?policy.generalLimit-policy.reserve:policy.verified&&policy.generalLimit&&state.baselineDay<state.day?policy.generalLimit:Number.MAX_SAFE_INTEGER;
 const record={requestId,actor,endpoint,quotaDay:state.day,status:'reserved',at:new Date(at).toISOString(),units:1};
 // One transactional compare-and-increment covers BOTH counters. A repeated ticket cannot increment either.
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE state SET value=json_set(value,'$.general',json_extract(value,'$.general')+1,'$.backfill',json_extract(value,'$.backfill')+?)
   WHERE key=? AND json_extract(value,'$.general')<? AND (?='rj' OR json_extract(value,'$.backfill')<?)
   AND NOT EXISTS(SELECT 1 FROM state WHERE key=?)`).bind(actor==='backfill'?1:0,state.key,limit,actor,policy.backfillLimit,ticket),
  env.DB.prepare('INSERT INTO state(key,value) SELECT ?,? WHERE changes()=1').bind(ticket,JSON.stringify(record))
 ]);
 if(!result[0]?.meta?.changes){
  if(await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(ticket).first())throw new QuotaBlocked('duplicate_request',409);
  throw new QuotaBlocked(actor==='backfill'?'shared_budget_exhausted':'general_daily_cap');
 }
 return {...record,ticket};
}

export async function finishReservation(env,reservation,status,httpStatus,durationMs){
 // Never refund ambiguous or failed calls: they may have consumed the provider's quota.
 const row=await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(reservation.ticket).first();
 if(!row)throw Error('Quota reservation missing');
 await env.DB.prepare('UPDATE state SET value=? WHERE key=?').bind(JSON.stringify({...JSON.parse(row.value),status,httpStatus:httpStatus??null,durationMs,finishedAt:new Date().toISOString()}),reservation.ticket).run();
}

export function quotaFetch(env,fetcher=fetch){
 return async(input,options={})=>{
  const policy=quotaPolicy(env),url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(!policy.tracking||url.origin!=='https://www.googleapis.com'||!url.pathname.startsWith('/youtube/v3/')||url.pathname.endsWith('/search'))return fetcher(input,options);
  if((options.method||'GET')!=='GET')throw new QuotaBlocked('unaccounted_youtube_method',503);
  const endpoint=url.pathname.split('/').at(-1),reservation=await reserveGeneral(env,{endpoint});
  await env.DB.prepare("INSERT INTO state(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(state.value AS INTEGER)+1").bind('youtube-requests:'+new Date().toISOString().slice(0,10)+':'+endpoint).run();
  const started=Date.now();let response;
  try{response=await fetcher(input,{...options,redirect:'error'});}
  catch(error){await finishReservation(env,reservation,'network_error',null,Date.now()-started);throw error;}
  await finishReservation(env,reservation,response.ok?'succeeded':'http_error',response.status,Date.now()-started);
  return response;
 };
}

export async function pruneQuotaRecords(env,at=new Date()){
 if(!quotaPolicy(env).tracking||!env.DB)return 0;
 const start=prefix+'request:',end=start+pacificDay(new Date(Date.parse(at)-8*86400000));
 const result=await env.DB.prepare('DELETE FROM state WHERE key IN (SELECT key FROM state WHERE key>=? AND key<? ORDER BY key LIMIT 200)').bind(start,end).run();
 return result.meta?.changes||0;
}
