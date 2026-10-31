import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseFixture} from './release-fixture.mjs';
import {reserveGeneral,quotaStatus,quotaFetch,quotaPolicy,pruneQuotaRecords} from '../server/youtube-quota.mjs';
import {backfillBroker} from '../server/backfill-broker.mjs';
import {YouTube} from '../server/discovery.mjs';

const channel='UC'+'a'.repeat(22),uploads='UU'+'a'.repeat(22),video='v'+'a'.repeat(10);
const at=new Date('2026-10-30T12:00:00Z');
async function fixture(){
 const {db,sql}=releaseFixture(),env={DB:db,YOUTUBE_API_KEY:'test-key',BACKFILL_API_TOKEN:'test-token-'.repeat(4),YOUTUBE_QUOTA_TRACKING:'1',YOUTUBE_QUOTA_VERIFIED:'1',YOUTUBE_GENERAL_DAILY_LIMIT:'2050',BACKFILL_DAILY_GENERAL_LIMIT:'300',BACKFILL_ENABLED:'1'};
 await db.prepare("INSERT INTO state VALUES('youtube-quota-v1:baseline-day','2026-10-29')").run();
 await db.prepare("INSERT INTO channels(id,name,uploads,discovery_scope) VALUES(?,?,?,'eligible')").bind(channel,'Test reactor',uploads).run();
 await db.prepare('INSERT INTO discovery_health_samples VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(at.toISOString(),'fixture','{}',100,100,0,0,'succeeded',0,0,0,0).run();
 return {env,db,sql};
}
test('defaults cannot start backfill and preserve unconfigured RJ fetch behavior',async()=>{
 assert.equal(quotaPolicy({}).backfillLimit,0);assert.equal((await quotaStatus({})).ready,false);
 let calls=0;const response=await quotaFetch({},async()=>{calls++;return Response.json({});})('https://www.googleapis.com/youtube/v3/videos');
 assert.equal(calls,1);assert.equal(response.status,200);
});
test('concurrent backfill reservations never consume the 2000-request RJ reserve',async()=>{
 const {env,db}=await fixture();
 const results=await Promise.allSettled(Array.from({length:100},()=>reserveGeneral(env,{actor:'backfill',endpoint:'videos',at})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,50);
 const status=await quotaStatus(env,at);assert.deepEqual(status.ledger,{general:50,backfill:50});assert.equal(status.reason,'fresh_reserve_protected');
 await reserveGeneral(env,{actor:'rj',endpoint:'videos',at});
 assert.equal((await quotaStatus(env,at)).ledger.general,51);
});
test('concurrent retries with the same request ID reserve only once',async()=>{
 const {env}=await fixture(),requestId=crypto.randomUUID();
 const results=await Promise.allSettled(Array.from({length:20},()=>reserveGeneral(env,{actor:'backfill',endpoint:'videos',requestId,at})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await quotaStatus(env,at)).ledger.general,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'duplicate_request');
});
test('baseline day blocks backfill and next Pacific day starts without carrying yesterday twice',async()=>{
 const {env,db}=await fixture();await db.prepare("UPDATE state SET value='2026-10-30' WHERE key='youtube-quota-v1:baseline-day'").run();
 await db.prepare("INSERT INTO state VALUES('youtube-requests:2026-10-30:videos','123')").run();
 assert.equal((await quotaStatus(env,at)).reason,'baseline_day_incomplete');
 assert.equal((await quotaStatus(env,at)).ledger.general,123);
 env.YOUTUBE_GENERAL_DAILY_LIMIT='100';await reserveGeneral(env,{endpoint:'videos',at});
 assert.equal((await quotaStatus(env,at)).ledger.general,124); // Conservative initial carryover must not block primary work.
 const next=new Date('2026-10-31T07:00:00Z');
 assert.equal((await quotaStatus(env,next)).ledger.general,0);
});
test('unhealthy or stale fresh coverage blocks only backfill admission',async()=>{
 const {env,db}=await fixture();await db.prepare('UPDATE discovery_health_samples SET checked=90').run();
 await assert.rejects(()=>reserveGeneral(env,{actor:'backfill',endpoint:'videos',at}),/fresh_coverage_unhealthy/);
 await reserveGeneral(env,{endpoint:'videos',at});
 await db.prepare('UPDATE discovery_health_samples SET checked=100,sampled_at=?').bind('2026-10-29T12:00:00Z').run();
 assert.equal((await quotaStatus(env,at)).reason,'fresh_coverage_unhealthy');
});
test('backfill daily limit is independent of the shared reserve and retries remain charged',async()=>{
 const {env}=await fixture();env.BACKFILL_DAILY_GENERAL_LIMIT='1';
 await reserveGeneral(env,{actor:'backfill',endpoint:'videos',at});
 await assert.rejects(()=>reserveGeneral(env,{actor:'backfill',endpoint:'videos',at}),/backfill_daily_cap/);
 assert.equal((await quotaStatus(env,at)).ledger.general,1);
});
test('general gateway counts network failures, passes search to the separate search bucket',async()=>{
 const {env,db}=await fixture();const realNow=new Date();
 await db.prepare("UPDATE state SET value='2020-01-01' WHERE key='youtube-quota-v1:baseline-day'").run();
 let calls=0;const wrapped=quotaFetch(env,async()=>{calls++;throw Error('network');});
 await assert.rejects(()=>wrapped('https://www.googleapis.com/youtube/v3/videos'),/network/);
 assert.equal((await quotaStatus(env)).ledger.general,1);
 const ticket=(await db.prepare("SELECT value FROM state WHERE key LIKE 'youtube-quota-v1:request:%'").first()).value;
 assert.equal(JSON.parse(ticket).status,'network_error');
 await assert.rejects(()=>wrapped('https://www.googleapis.com/youtube/v3/search'),/network/);
 assert.equal((await quotaStatus(env)).ledger.general,1);assert.equal(calls,2);
});
test('existing YouTube client uses the common gateway without double-counting UTC counters',async()=>{
 const {env,db}=await fixture();let calls=0;
 const api=new YouTube('fixture',async()=>{calls++;return Response.json({items:[]});},db,env);
 await api.get('videos',{part:'snippet',id:video});
 assert.equal(calls,1);assert.equal((await quotaStatus(env)).ledger.general,1);
 const counters=(await db.prepare("SELECT value FROM state WHERE key LIKE 'youtube-requests:%:videos'").all()).results;
 assert.equal(counters.reduce((n,r)=>n+Number(r.value),0),1);
});
test('broker requires its own token and rejects search, official and other-scope reactors before network',async()=>{
 const {env,db}=await fixture();let calls=0;
 const body={endpoint:'videos',params:{part:'snippet,contentDetails,status',id:video},channel_id:channel,request_id:crypto.randomUUID()};
 const request=(data,token=env.BACKFILL_API_TOKEN)=>new Request('https://test/api/backfill/execute',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});
 assert.equal((await backfillBroker(request(body,'wrong'),env,()=>calls++)).status,401);
 assert.equal((await backfillBroker(request({...body,endpoint:'search'}),env,()=>calls++)).status,400);
 await db.prepare("UPDATE channels SET discovery_scope='other'").run();
 assert.equal((await backfillBroker(request(body),env,()=>calls++)).status,403);assert.equal(calls,0);
});
test('broker validates playlist binding and returns a receipt without exposing credentials',async()=>{
 const {env,db}=await fixture();await db.prepare('UPDATE discovery_health_samples SET sampled_at=?').bind(new Date().toISOString()).run();
 const body={endpoint:'playlistItems',params:{part:'snippet,contentDetails',playlistId:uploads,maxResults:50},channel_id:channel,request_id:crypto.randomUUID()};
 const request=data=>new Request('https://test/api/backfill/execute',{method:'POST',headers:{Authorization:'Bearer '+env.BACKFILL_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(data)});
 let calls=0;
 assert.equal((await backfillBroker(request({...body,params:{...body.params,playlistId:'unrelated'}}),env,()=>calls++)).status,400);
 const response=await backfillBroker(request(body),env,async(url,options)=>{calls++;assert.equal(url.searchParams.has('key'),false);assert.equal(options.headers['X-Goog-Api-Key'],'test-key');return Response.json({items:[]});});
 assert.equal(response.status,200);assert.equal(response.headers.get('X-RJ-Quota-Charged'),'1');
 const data=await response.json();assert.equal(data.receipt.units,1);assert.deepEqual(data.data,{items:[]});assert.equal(JSON.stringify(data).includes('test-key'),false);
 assert.equal((await backfillBroker(request(body),env,()=>calls++)).status,409);assert.equal(calls,1);
});
test('receipt cleanup is bounded and preserves unrelated state and current reservations',async()=>{
 const {env,db}=await fixture();
 await db.prepare("INSERT INTO state VALUES('youtube-quota-v1:request:2026-01-01:old','{}')").run();
 await db.prepare("INSERT INTO state VALUES('unrelated-catalog-state','keep')").run();
 await reserveGeneral(env,{endpoint:'videos',at});
 assert.equal(await pruneQuotaRecords(env,at),1);
 assert.equal((await db.prepare("SELECT value FROM state WHERE key='unrelated-catalog-state'").first()).value,'keep');
 assert.equal((await quotaStatus(env,at)).ledger.general,1);
});
