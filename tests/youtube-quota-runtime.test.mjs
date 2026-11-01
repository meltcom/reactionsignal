import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Response as MockResponse} from 'miniflare';

const channel='UC'+'a'.repeat(22),video='v'.repeat(11),credential='runtime-fixture-token-'.repeat(3);
const root=fileURLToPath(new URL('../',import.meta.url));
const source=await build({stdin:{resolveDir:root,contents:`
 import {quotaFetch} from './server/youtube-quota.mjs';
 import {backfillBroker} from './server/backfill-broker.mjs';
 export default {async fetch(request,env){
  if(new URL(request.url).pathname==='/general'){
   const response=await quotaFetch(env)('https://www.googleapis.com/youtube/v3/videos',{headers:{'X-Goog-Api-Key':env.YOUTUBE_API_KEY}});
   return Response.json({status:response.status,body:response.ok?await response.json():null});
  }
  return backfillBroker(request,env);
 }};`},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});

async function runtime(t,{redirect=false}={}){
 const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({
  modules:true,script:source.outputFiles[0].text,compatibilityDate:'2026-09-30',cf:false,
  bindings:{YOUTUBE_API_KEY:'runtime-fixture-key',BACKFILL_API_TOKEN:credential,YOUTUBE_QUOTA_TRACKING:'1',YOUTUBE_QUOTA_VERIFIED:'1',YOUTUBE_GENERAL_DAILY_LIMIT:'10000',BACKFILL_DAILY_GENERAL_LIMIT:'300',BACKFILL_GENERAL_RESERVE:'2000',BACKFILL_ENABLED:'1'},
  d1Databases:['DB'],
  outboundService:request=>{
   calls.push({url:request.url,key:request.headers.get('X-Goog-Api-Key')});
   assert.equal(new URL(request.url).origin,'https://www.googleapis.com');
   return redirect?new MockResponse('<html>Moved</html>',{status:302,headers:{Location:'https://redirect.invalid/steal'}}):new MockResponse('{"items":[]}',{headers:{'Content-Type':'application/json'}});
  }
 }));
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 await db.exec("CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT);\nCREATE TABLE channels(id TEXT PRIMARY KEY,uploads TEXT,discovery_scope TEXT);\nCREATE TABLE discovery_health_samples(sampled_at TEXT,eligible INTEGER,checked INTEGER,run_status TEXT);");
 await db.batch([
  db.prepare("INSERT INTO state VALUES('youtube-quota-v1:baseline-day','2000-01-01')"),
  db.prepare("INSERT INTO channels VALUES(?,'UUfixture','eligible')").bind(channel),
  db.prepare("INSERT INTO discovery_health_samples VALUES(?,1,1,'succeeded')").bind(new Date().toISOString())
 ]);
 const evidence=async()=>({
  ledger:JSON.parse((await db.prepare("SELECT value FROM state WHERE key LIKE 'youtube-quota-v1:day:%'").first()).value),
  ticket:JSON.parse((await db.prepare("SELECT value FROM state WHERE key LIKE 'youtube-quota-v1:request:%'").first()).value)
 });
 const broker=()=>mf.dispatchFetch('https://fixture/api/backfill/execute',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify({endpoint:'videos',params:{part:'snippet,contentDetails,status',id:video},channel_id:channel,request_id:crypto.randomUUID()})});
 return {mf,calls,evidence,broker};
}

test('workerd sends a general request and records a successful native-runtime receipt',async t=>{
 const {mf,calls,evidence}=await runtime(t);
 const response=await mf.dispatchFetch('https://fixture/general');
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:200,body:{items:[]}});
 assert.equal(calls.length,1);assert.equal(calls[0].key,'runtime-fixture-key');
 const {ledger,ticket}=await evidence();assert.deepEqual(ledger,{general:1,backfill:0});assert.equal(ticket.status,'succeeded');assert.equal(ticket.httpStatus,200);
});

test('workerd broker makes one provider request and returns its charged receipt',async t=>{
 const {broker,calls,evidence}=await runtime(t);
 const response=await broker();assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.receipt.units,1);assert.deepEqual(body.data,{items:[]});
 assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).searchParams.has('key'),false);
 const {ledger,ticket}=await evidence();assert.deepEqual(ledger,{general:1,backfill:1});assert.equal(ticket.status,'succeeded');
});

test('workerd general requests never follow redirects and retain the charged HTTP outcome',async t=>{
 const {mf,calls,evidence}=await runtime(t,{redirect:true});
 const response=await mf.dispatchFetch('https://fixture/general');assert.equal((await response.json()).status,302);
 assert.equal(calls.length,1);const {ledger,ticket}=await evidence();assert.equal(ledger.general,1);assert.equal(ticket.status,'http_error');assert.equal(ticket.httpStatus,302);
});

test('workerd broker rejects non-JSON redirects without forwarding credentials or Location',async t=>{
 const {broker,calls,evidence}=await runtime(t,{redirect:true});
 const response=await broker();assert.equal(response.status,502);assert.equal(response.headers.get('X-RJ-Quota-Charged'),'1');assert.equal(response.headers.get('Location'),null);
 const body=await response.json();assert.equal(body.code,'upstream_redirect');assert.equal(body.http_status,302);assert.equal(JSON.stringify(body).includes('runtime-fixture-key'),false);
 assert.equal(calls.length,1);const {ledger,ticket}=await evidence();assert.equal(ledger.backfill,1);assert.equal(ticket.status,'http_error');assert.equal(ticket.httpStatus,302);
});
