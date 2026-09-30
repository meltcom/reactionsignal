import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {seedDatabase,catalog} from '../server/db.mjs';
import {youtubePush,renewSubscriptions,processPushJobs,pushStatus} from '../server/push.mjs';
import {managePerformers} from '../server/performers.mjs';
import {community} from '../server/community.mjs';
import {saveVideo} from '../server/discovery.mjs';
const channel='UC1234567890123456789012',video='abcdefghijk';
const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[{id:channel,name:'Reactor'}],videos:[]};
async function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const db={prepare(q){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(q).get(...values)||null;},async all(){return {results:sql.prepare(q).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...values).changes)}};}}},async batch(stmts){sql.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 await seedDatabase(db,seed);const env={DB:db,YOUTUBE_API_KEY:'fixture-only',YOUTUBE_PUSH_CALLBACK_URL:'https://relay.test/api/youtube/push'};
 const call=async(path,body,moderator=true,origin='https://site.test')=>{const response=await managePerformers(new Request('https://site.test/api/performers'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,seed,{id:moderator?'mod':'fan',moderator});return {status:response.status,data:await response.json()};};
 return {sql,db,env,call};
}
const feed=(id=video,ch=channel)=>`<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>${id}</yt:videoId><yt:channelId>${ch}</yt:channelId></entry></feed>`;
const item=(id=video)=>({id,snippet:{channelId:channel,channelTitle:'Reactor',title:'Missioned Souls reaction',publishedAt:new Date().toISOString()},contentDetails:{duration:'PT6M'},status:{privacyStatus:'public'}});
async function subscribe(env,db){
 let callback;
 assert.equal((await renewSubscriptions(env,seed,async(url,options)=>{const params=new URLSearchParams(options.body);callback=new URL(params.get('hub.callback'));assert.equal(params.get('hub.secret').length,64);return new Response(null,{status:202});})).requested,1);
 assert.equal((await pushStatus(db,env)).active,0);
 callback.searchParams.set('hub.mode','subscribe');callback.searchParams.set('hub.topic',`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`);callback.searchParams.set('hub.challenge','test-challenge');callback.searchParams.set('hub.lease_seconds','432000');
 assert.equal(await (await youtubePush(new Request(callback),env,seed)).text(),'test-challenge');
 assert.equal((await pushStatus(db,env)).active,1);
 callback.searchParams.delete('hub.mode');callback.searchParams.delete('hub.topic');callback.searchParams.delete('hub.challenge');callback.searchParams.delete('hub.lease_seconds');return callback;
}
async function delivery(callback,env,db,body=feed(),badSignature=false){
 const sub=await db.prepare('SELECT secret FROM push_subscriptions WHERE channel_id=?').bind(channel).first();
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(sub.secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
 return youtubePush(new Request(callback,{method:'POST',headers:{'X-Hub-Signature':'sha1='+(badSignature?'0'.repeat(40):signature)},body}),env,seed);
}
test('verified signed uploads publish immediately and notify once; duplicate delivery costs no extra call',async()=>{
 const {db,env,sql,call}=await setup();const callback=await subscribe(env,db);
 assert.equal((await delivery(callback,env,db,feed(),true)).status,403);assert.equal(sql.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,0);
 assert.equal((await delivery(callback,env,db)).status,202);let calls=0;
 const fetcher=async url=>{calls++;assert.ok(url.pathname.endsWith('/videos'));assert.equal(url.searchParams.has('key'),false);return Response.json({items:[item()]});};
 assert.equal((await processPushJobs(env,seed,fetcher)).added,1);assert.equal((await catalog(db,seed,env)).videos.length,1);
 assert.equal((await call('/notifications')).data.count,1);
 assert.equal((await delivery(callback,env,db)).status,202);await processPushJobs(env,seed,fetcher);assert.equal(calls,1);
 assert.equal((await call('/notifications')).data.count,1);
 const p=(await db.prepare('SELECT * FROM performers').all()).results;await saveVideo(db,item(),p,new Date().toISOString(),'backup scan');assert.equal((await call('/notifications')).data.count,1);
});
test('invalid challenges, expired subscriptions, mixed-channel feeds and unsupported XML cannot enqueue work',async()=>{
 const {env,db,sql}=await setup();const callback=await subscribe(env,db);
 const wrong=new URL(callback);wrong.searchParams.set('token','forged');assert.equal((await youtubePush(new Request(wrong),env,seed)).status,404);
 const challenge=new URL(callback);challenge.searchParams.set('hub.mode','subscribe');challenge.searchParams.set('hub.topic','https://evil.test');challenge.searchParams.set('hub.challenge','forged');assert.equal((await youtubePush(new Request(challenge),env,seed)).status,403);
 assert.equal((await delivery(callback,env,db,feed(video,'UCabcdefghijklmnopqrstuv'))).status,400);
 assert.equal((await delivery(callback,env,db,'<!DOCTYPE feed>'+feed())).status,400);
 sql.prepare('UPDATE push_subscriptions SET expires_at=0').run();assert.equal((await delivery(callback,env,db)).status,403);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,0);
});
test('member cannot read or remove additions; removal stays excluded across subsequent uploads',async()=>{
 const {env,db,sql,call}=await setup();const callback=await subscribe(env,db);await delivery(callback,env,db);await processPushJobs(env,seed,async()=>Response.json({items:[item()]}));
 assert.equal((await call('/notifications',null,false)).status,403);
 const action={performerId:'missioned-souls',videoId:video,action:'remove',note:'Not the covered performer'};
 assert.equal((await call('/notifications/review',action,false)).status,403);
 assert.equal((await call('/notifications/review',action,true,'https://evil.test')).status,403);
 assert.equal((await call('/notifications/review',action)).status,200);
 assert.equal((await catalog(db,seed,env)).videos.length,0);assert.equal(sql.prepare('SELECT status FROM discovery_notifications').get().status,'removed');
 sql.prepare("UPDATE push_jobs SET processed_at='2020-01-01T00:00:00Z'").run();await delivery(callback,env,db);await processPushJobs(env,seed,async()=>Response.json({items:[item()]}));
 assert.equal((await catalog(db,seed,env)).videos.length,0);assert.equal((await call('/notifications')).data.count,0);
 assert.equal((await call('/notifications/review',action)).status,409);
});
test('keep clears notification without hiding; members can request removal without automatic hiding',async()=>{
 const {env,db,sql,call}=await setup();const callback=await subscribe(env,db);await delivery(callback,env,db);await processPushJobs(env,seed,async()=>Response.json({items:[item()]}));
 assert.equal((await call('/notifications/review',{performerId:'missioned-souls',videoId:video,action:'keep'})).status,200);
 assert.equal((await catalog(db,seed,env)).videos.length,1);
 sql.prepare("INSERT INTO members VALUES('fan','Fan',?)").run(new Date().toISOString());
 const body={kind:'flag',performerId:'missioned-souls',videoId:video,reason:'not-reaction',body:'Please check whether this is a full reaction.'};
 const request=new Request('https://site.test/api/community/contribute',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await community(request,env,seed,{id:'fan',moderator:false})).status,200);
 assert.equal((await call('/notifications')).data.reports,1);assert.equal((await catalog(db,seed,env)).videos.length,1);
 const report=sql.prepare('SELECT id FROM contributions').get().id;
 const review=new Request('https://site.test/api/community/moderate',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({id:report,decision:'accept',note:'Confirmed this is not a reaction'})});
 sql.prepare("INSERT INTO members VALUES('mod','Moderator',?)").run(new Date().toISOString());
 assert.equal((await community(review,env,seed,{id:'mod',moderator:true})).status,200);
 assert.equal((await catalog(db,seed,env)).videos.length,0);assert.equal(sql.prepare('SELECT status FROM discovery_notifications').get().status,'removed');
});
test('quota failures and delayed metadata stay queued; channel metadata mismatches never publish',async()=>{
 const {env,db,sql}=await setup();const callback=await subscribe(env,db);await delivery(callback,env,db);
 await processPushJobs(env,seed,async()=>Response.json({error:{errors:[{reason:'quotaExceeded'}]}},{status:403}));
 assert.equal(sql.prepare('SELECT status FROM push_jobs').get().status,'pending');assert.ok(sql.prepare('SELECT next_attempt FROM push_jobs').get().next_attempt>Date.now());
 sql.prepare('UPDATE push_jobs SET next_attempt=0').run();await processPushJobs(env,seed,async()=>Response.json({items:[]}));assert.equal(sql.prepare('SELECT attempts FROM push_jobs').get().attempts,2);
 sql.prepare('UPDATE push_jobs SET next_attempt=0').run();await processPushJobs(env,seed,async()=>Response.json({items:[{...item(),snippet:{...item().snippet,channelId:'UCabcdefghijklmnopqrstuv'}}]}));
 assert.equal((await catalog(db,seed,env)).videos.length,0);assert.equal(sql.prepare('SELECT status FROM push_jobs').get().status,'done');
});
test('uncertain, short and draft matches do not appear as published additions',async()=>{
 const {db,env,sql}=await setup();const performers=(await db.prepare('SELECT * FROM performers').all()).results;
 await saveVideo(db,{...item(),contentDetails:{duration:'PT1M'}},performers,new Date().toISOString(),'test');
 assert.equal((await catalog(db,seed,env)).videos.length,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_notifications').get().n,0);
 sql.prepare("INSERT INTO performers(id,name,aliases,status) VALUES('draft','New Act','[\"New Act\"]','draft')").run();
 await saveVideo(db,{...item('12345678901'),snippet:{...item().snippet,title:'New Act reaction'}},(await db.prepare("SELECT * FROM performers WHERE id='draft'").all()).results,new Date().toISOString(),'test');
 assert.equal((await catalog(db,seed,env)).videos.length,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_notifications').get().n,0);
});
