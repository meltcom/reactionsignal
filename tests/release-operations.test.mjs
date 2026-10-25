import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseFixture} from './release-fixture.mjs';
import {accountAccess,restrictAccount,operations,operationalSummary,checkOperationalAlerts} from '../server/operations.mjs';
import {sharedCache} from '../server/cache.mjs';
import {authenticate} from '../server/auth.mjs';
import {social} from '../server/social.mjs';
const lead={id:'lead',moderator:true},backup={id:'backup',moderator:true},fan={id:'fan',moderator:false};
const request=(path,body)=>new Request('https://pilot.test/api/operations'+path,{method:body?'POST':'GET',headers:{Origin:'https://pilot.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('a stale second abuse decision cannot hide content or create a second audit',async()=>{
 const {sql,env}=releaseFixture(),now=new Date().toISOString();
 sql.prepare("INSERT INTO chat_messages(id,user_id,room,body,status,created_at) VALUES('message','fan','general','hello','visible',?)").run(now);
 sql.prepare("INSERT INTO abuse_reports VALUES('report','fan','chat','message','please review','pending',?)").run(now);
 const req=action=>new Request('https://pilot.test/api/social/moderate',{method:'POST',headers:{Origin:'https://pilot.test','Content-Type':'application/json'},body:JSON.stringify({id:'report',action,note:'Reviewed evidence'})});
 const seed={performers:[],channels:[],videos:[]};
 assert.equal((await social(req('dismiss'),env,seed,lead)).status,200);
 assert.equal((await social(req('hide'),env,seed,backup)).status,409);
 assert.equal(sql.prepare("SELECT status FROM chat_messages WHERE id='message'").get().status,'visible');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM moderation_audit').get().n,1);
});
test('the Worker enforces restrictions even with a cached identity',async()=>{
 const {default:worker}=await import('../dist/server/index.js');const {sql,env}=releaseFixture(),original=globalThis.fetch;
 const id='cdc6ec62-30d1-4dba-b6f8-99db7563f221',memberId='supabase:'+id;
 sql.prepare('INSERT INTO members(id,name,email,created_at) VALUES(?,?,?,?)').run(memberId,'Test','test@example.com',new Date().toISOString());
 const token='head.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+600}))+'.sig',authEnv={...env,SUPABASE_URL:'https://worker-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
 const req=path=>new Request('https://pilot.test'+path,{headers:{Authorization:'Bearer '+token}});
 try{
  globalThis.fetch=async()=>Response.json({id,email:'test@example.com',email_confirmed_at:'2026-01-01'});
  assert.equal((await worker.fetch(req('/api/operations/summary'),authEnv)).status,403);
  await restrictAccount(env.DB,lead,env,{id:memberId,action:'ban',note:'Confirmed abuse'});
  const blocked=await worker.fetch(req('/data.json'),authEnv);assert.equal(blocked.status,403);assert.equal((await blocked.json()).restriction,'banned');
  assert.ok(blocked.headers.get('X-Request-ID'));
  await restrictAccount(env.DB,lead,env,{id:memberId,action:'restore-access',note:'Appeal accepted'});
  assert.equal((await worker.fetch(req('/api/auth/me'),authEnv)).status,200);
 }finally{globalThis.fetch=original;}
});
test('restrictions are checked immediately, expire, restore, and identify each moderator',async()=>{
 const {sql,db,env}=releaseFixture();
 assert.equal((await restrictAccount(db,fan,env,{id:'fan',action:'ban',note:'abuse confirmed'})).status,403);
 assert.equal((await restrictAccount(db,lead,env,{id:'backup',action:'ban',note:'abuse confirmed'})).status,403);
 assert.equal((await restrictAccount(db,lead,env,{id:'fan',action:'suspend',hours:1,note:'Repeated abuse'})).status,200);
 assert.equal((await accountAccess(db,fan)).status,403);
 sql.prepare('UPDATE account_restrictions SET expires_at=?').run('2000-01-01T00:00:00Z');assert.equal(await accountAccess(db,fan),null);
 await restrictAccount(db,backup,env,{id:'fan',action:'ban',note:'Repeated abuse'});assert.equal((await accountAccess(db,fan)).status,403);
 await restrictAccount(db,lead,env,{id:'fan',action:'restore-access',note:'Appeal accepted'});assert.equal(await accountAccess(db,fan),null);
 assert.deepEqual(sql.prepare('SELECT actor_id FROM moderation_audit ORDER BY rowid').all().map(x=>x.actor_id),['lead','backup','lead']);
 assert.match(sql.prepare("SELECT before_json FROM moderation_audit WHERE action='restore-access'").get().before_json,/banned/);
});
test('only configured moderators can receive cases, and personal assignment filters stay separate',async()=>{
 const {sql,env}=releaseFixture();sql.prepare("INSERT INTO abuse_reports VALUES('report','fan','chat','message','please review','pending',?)").run(new Date().toISOString());
 assert.equal((await operations(request('/assign',{kind:'abuse',id:'report',assignee:'backup'}),env,fan)).status,403);
 assert.equal((await operations(request('/assign',{kind:'abuse',id:'report',assignee:'fan'}),env,lead)).status,400);
 assert.equal((await operations(request('/assign',{kind:'abuse',id:'report',assignee:'backup'}),env,lead)).status,200);
 assert.equal((await (await operations(request('/cases?assigned=mine'),env,lead)).json()).items.length,0);
 assert.equal((await (await operations(request('/cases?assigned=mine'),env,backup)).json()).items.length,1);
 sql.prepare("UPDATE abuse_reports SET status='dismiss' WHERE id='report'").run();
 assert.equal((await operations(request('/assign',{kind:'abuse',id:'report',assignee:'lead'}),env,backup)).status,409);
 assert.equal(sql.prepare('SELECT actor_id FROM moderation_audit').get().actor_id,'lead');
});
test('alerts identify stale schedules and errors, deduplicate, and record delivery failures',async()=>{
 const {sql,env}=releaseFixture();
 for(let i=0;i<5;i++)sql.prepare('INSERT INTO operational_events VALUES(?,?,?,?)').run('e'+i,'request-unavailable','error',new Date().toISOString());
 assert.deepEqual((await operationalSummary(env)).warnings.sort(),['recent-errors','scheduler-stale']);
 let calls=0;const destination={...env,OPERATIONS_ALERT_WEBHOOK:'https://alerts.example.com/events'};
 await checkOperationalAlerts(destination,async()=>{calls++;return new Response(null,{status:204});});
 await checkOperationalAlerts(destination,async()=>{calls++;throw Error();});assert.equal(calls,2);
 sql.prepare("UPDATE operational_alerts SET last_attempt_at='2000-01-01'").run();
 await checkOperationalAlerts(destination,async()=>new Response(null,{status:500}));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM operational_alerts WHERE error IS NOT NULL').get().n,2);
 assert.equal((await operations(request('/audit'),env,fan)).status,403);
});
test('shared projections coalesce bursts, stay database scoped, recover from failures, and revisions change on UPSERT',async()=>{
 const {sql,db}=releaseFixture();let calls=0;
 await Promise.all(Array.from({length:50},()=>sharedCache(db,'aggregate',30000,async()=>{calls++;return 42;})));assert.equal(calls,1);
 assert.equal(await sharedCache({},'aggregate',30000,async()=>7),7);
 await assert.rejects(sharedCache(db,'failure',30000,async()=>{throw Error('unavailable');}));assert.equal(await sharedCache(db,'failure',30000,async()=>9),9);
 const before=sql.prepare("SELECT value FROM state WHERE key='aggregate-revision'").get().value;
 sql.prepare("INSERT INTO members(id,name,created_at) VALUES('fan','Updated',?) ON CONFLICT(id) DO UPDATE SET name=excluded.name").run(new Date().toISOString());
 assert.ok(Number(sql.prepare("SELECT value FROM state WHERE key='aggregate-revision'").get().value)>Number(before));
});
test('ordinary reads coalesce verification; staff and writes reverify; upstream failures remain retryable',async()=>{
 const original=globalThis.fetch;let calls=0;const id='f16fb451-f220-4bf2-93ae-580c84c36a00';
 const token='header.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+600}))+'.signature';
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',COMMUNITY_MODERATOR_EMAILS:'lead@example.com'};
 const req=(method='GET',path='/data.json')=>new Request('https://pilot.test'+path,{method,headers:{Authorization:'Bearer '+token}});
 try{
  globalThis.fetch=async()=>{calls++;return Response.json({id,email:'fan@example.com',email_confirmed_at:'2026-01-01'});};
  await Promise.all(Array.from({length:20},()=>authenticate(req(),env)));assert.equal(calls,1);
  await authenticate(req(),env);assert.equal(calls,1);
  await authenticate(req('POST'),env);await authenticate(req('GET','/api/auth/me'),env);assert.equal(calls,3);
  const staffEnv={...env,COMMUNITY_MODERATOR_EMAILS:'fan@example.com'};await authenticate(req(),staffEnv);await authenticate(req(),staffEnv);assert.equal(calls,5);
  globalThis.fetch=async()=>new Response(null,{status:429});assert.equal((await authenticate(req('POST'),env)).error.status,503);
  globalThis.fetch=async()=>new Response(null,{status:401});assert.equal((await authenticate(req('POST'),env)).error.status,401);
 }finally{globalThis.fetch=original;}
});
