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
 await seedDatabase(db,seed);sql.exec('DELETE FROM matches; DELETE FROM videos; DELETE FROM channels; DELETE FROM discovery_notifications; DELETE FROM discovery_observations;');sql.prepare("INSERT INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(channel,'Reactor');const env={DB:db,YOUTUBE_API_KEY:'fixture-only',YOUTUBE_PUSH_CALLBACK_URL:'https://relay.test/api/youtube/push'};
 const call=async(path,body,moderator=true,origin='https://site.test')=>{const response=await managePerformers(new Request('https://site.test/api/performers'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,seed,{id:moderator?'mod':'fan',moderator});return {status:response.status,data:await response.json()};};
 return {sql,db,env,call};
}

import {pollRss} from '../server/rss.mjs';
import {status} from '../server/db.mjs';

const xml=(ch=channel,title='Missioned Souls reaction')=>`<feed><entry><yt:videoId>${video}</yt:videoId><yt:channelId>${ch}</yt:channelId><title>${title}</title></entry></feed>`;
const metadata={id:video,snippet:{channelId:channel,channelTitle:'Reactor',title:'Missioned Souls reaction',publishedAt:new Date(Date.now()-3600000).toISOString()},contentDetails:{duration:'PT6M'},status:{privacyStatus:'public'}};
async function eligible(){const x=await setup();x.sql.prepare("UPDATE channels SET discovery_scope='eligible' WHERE id=?").run(channel);return x;}
test('RSS queues candidate IDs without API calls and verifies metadata before publishing',async()=>{
 const {db,env,sql}=await eligible();let feeds=0;
 const fetched=async url=>{assert.match(url,/youtube.com\/feeds\/videos.xml/);feeds++;return new Response(xml());};
 assert.equal((await pollRss(env,seed,fetched)).queued,1);assert.equal(feeds,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM videos').get().n,0);
 let api=0;await processPushJobs(env,seed,async url=>{api++;assert.ok(url.pathname.endsWith('/videos'));return Response.json({items:[metadata]});});
 assert.equal(api,1);assert.equal(sql.prepare('SELECT source FROM discovery_observations').get().source,'RSS fallback');
 const report=await status(db,env);assert.equal(report.delaySources[0].samples,1);assert.equal(report.notificationDelays[0].processed,1);assert.ok(report.notificationDelays[0].publication_to_receipt_seconds>3500);
 sql.exec("DELETE FROM rss_checks");await pollRss(env,seed,fetched);assert.equal(sql.prepare('SELECT attempts FROM push_jobs').get().attempts,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM notification_receipts').get().n,1);
});
test('RSS failures and unrelated uploads do not suppress API checks or enqueue bad feeds',async()=>{
 const {db,env,sql}=await eligible();
 await pollRss(env,seed,async()=>new Response(xml(channel,'Other artist reaction')));assert.equal(sql.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,0);
 sql.exec('DELETE FROM rss_checks');await pollRss(env,seed,async()=>new Response(xml('UC0000000000000000000000')));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,0);assert.ok(sql.prepare('SELECT error FROM rss_checks').get().error);
 assert.equal(sql.prepare('SELECT recent_checked_at FROM channels').get().recent_checked_at,null);
 let requests=0;await pollRss(env,seed,async()=>{requests++;return new Response(xml());});assert.equal(requests,0);
});
test('RSS repeat polling preserves pending API retries',async()=>{
 const {db,env,sql}=await eligible();await pollRss(env,seed,async()=>new Response(xml()));
 await processPushJobs(env,seed,async()=>Response.json({error:{errors:[{reason:'quotaExceeded'}]}},{status:403}));
 const before=sql.prepare('SELECT * FROM push_jobs').get();sql.exec('DELETE FROM rss_checks');await pollRss(env,seed,async()=>new Response(xml()));
 const after=sql.prepare('SELECT * FROM push_jobs').get();assert.equal(after.attempts,before.attempts);assert.equal(after.next_attempt,before.next_attempt);
});
test('RSS records HTTP and timeout failures separately and recovers after retry',async()=>{
 const {db,env,sql}=await eligible();
 await pollRss(env,seed,async()=>new Response('Not found',{status:404}));
 assert.equal(sql.prepare('SELECT error FROM rss_checks').get().error,'Feed HTTP 404; retry scheduled');
 let report=await status(db,env);assert.equal(report.rss.errors[0].channels,1);
 sql.exec('DELETE FROM rss_checks');
 const before=Date.now();await pollRss(env,seed,async()=>{throw new DOMException('Timeout','TimeoutError');});
 const row=sql.prepare('SELECT * FROM rss_checks').get();assert.equal(row.error,'Feed timeout; retry scheduled');assert.ok(Date.parse(row.retry_at)-before<=15*60000+1000);
 sql.exec("UPDATE rss_checks SET retry_at='2000-01-01',checked_at='2000-01-01'");
 await pollRss(env,seed,async(url,options)=>{assert.equal(options.redirect,'manual');assert.match(options.headers.Accept,/atom/);return new Response(xml());});
 assert.equal(sql.prepare('SELECT error FROM rss_checks').get().error,null);
 assert.equal((await status(db,env)).rss.coverage.checked,1);
});
test('RSS rejects redirects without fetching another host',async()=>{
 const {env,sql}=await eligible();let calls=0;
 await pollRss(env,seed,async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://untrusted.test'}});});
 assert.equal(calls,1);assert.equal(sql.prepare('SELECT error FROM rss_checks').get().error,'Feed HTTP 302; retry scheduled');
});
