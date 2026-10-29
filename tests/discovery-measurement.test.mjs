import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseFixture} from './release-fixture.mjs';
import {SEARCH_STRATEGY,pacificDay,startSearchPage,reserveSearchAttempt,finishSearchAttempt,finishSearchPage,recordSearchResults,sampleDiscoveryHealth,discoveryPerformance} from '../server/discovery-measurement.mjs';
import {YouTube,searchInterval,recentSongTitles,saveVideos,runDiscovery} from '../server/discovery.mjs';
import {seedDatabase} from '../server/db.mjs';

test('Pacific reporting day follows midnight and DST; pacing follows allowance without a 75-minute floor',()=>{
 assert.equal(pacificDay('2026-10-28T06:59:59Z'),'2026-10-27');assert.equal(pacificDay('2026-10-28T07:00:00Z'),'2026-10-28');
 assert.equal(pacificDay('2026-11-02T07:59:59Z'),'2026-11-01');assert.equal(pacificDay('2026-11-02T08:00:00Z'),'2026-11-02');
 assert.equal(searchInterval({DISCOVERY_DAILY_SEARCH_LIMIT:40}),36*60000);assert.equal(searchInterval({DISCOVERY_DAILY_SEARCH_LIMIT:20}),72*60000);assert.equal(searchInterval({DISCOVERY_DAILY_SEARCH_LIMIT:0}),86400000);
});
test('song hints reject promotions and livestreams while extracting legitimate by/dash song titles',()=>{
 const date='2026-10-28T00:00:00Z',titles=['Mark your calendars October 23, 7 PM','Missioned Souls Live Stream','Black Velvet #sneakpeek #siblings','Missioned Souls - Live in Zambales | DECODE by Paramore','I HATE MYSELF FOR LOVING YOU - Joan Jett | studio cover','Black Velvet #siblings #studio #cover'];
 assert.deepEqual(recentSongTitles(titles.map(title=>({title,publishedAt:date}))),['DECODE','I HATE MYSELF FOR LOVING YOU','Black Velvet']);
});
async function page(db,at='2026-10-28T12:00:00Z') {return startSearchPage(db,{runId:'test',performerId:'missioned-souls',query:'"Missioned Souls"',cursor:{after:'2026-10-01T00:00:00Z',startedAt:at,depth:2},env:{DISCOVERY_DAILY_SEARCH_LIMIT:2},at});}
test('every HTTP retry is charged before sending and stops at the cap, with a failed page retained',async()=>{
 const {db}=releaseFixture(),id=await page(db);let calls=0;
 const api=new YouTube('fixture-secret',async()=>{calls++;return Response.json({}, {status:503});},db);
 await assert.rejects(()=>api.get('search',{q:'test'},{pageId:id,limit:1}),/Daily search attempt budget/);
 assert.equal(calls,1);const rows=(await db.prepare('SELECT * FROM discovery_search_attempts').all()).results;assert.equal(rows.length,1);assert.equal(rows[0].http_status,503);assert.equal(rows[0].status,'http_error');
 await finishSearchPage(db,id,{status:'failed',error:'Daily search attempt budget reached'});assert.equal((await db.prepare('SELECT status FROM discovery_search_pages').first()).status,'failed');
});
test('timeouts count against the same cap and successful requests are recorded separately',async()=>{
 const {db}=releaseFixture(),id=await page(db);let calls=0;const api=new YouTube('fixture',async()=>{if(++calls===1)throw Error('timeout');return Response.json({items:[]});},db);
 await api.get('search',{q:'test'},{pageId:id,limit:2});const rows=(await db.prepare('SELECT * FROM discovery_search_attempts ORDER BY attempted_at').all()).results;
 assert.equal(calls,2);assert.deepEqual(rows.map(r=>r.status),['network_error','succeeded']);assert.ok(rows.every(r=>r.quota_day===pacificDay()));
 await assert.rejects(()=>api.get('search',{q:'test'},{pageId:id,limit:2}),/budget/);assert.equal(calls,2);
});
test('release carryover is conservative and subsequent Pacific days start a fresh allowance',async()=>{
 const {db}=releaseFixture();await db.prepare("INSERT INTO state VALUES('youtube-requests:2026-10-28:search','2')").run();const id=await page(db);
 await assert.rejects(()=>reserveSearchAttempt(db,id,2,'2026-10-28T12:00:00Z'),/budget/);
 const attempt=await reserveSearchAttempt(db,id,3,'2026-10-28T12:00:00Z');await finishSearchAttempt(db,attempt,'succeeded',200,1);
 await reserveSearchAttempt(db,id,2,'2026-10-29T07:00:00Z');assert.equal((await db.prepare("SELECT value FROM state WHERE key='search-attempt-budget:2026-10-29'").first()).value,'1');
});
test('result attribution distinguishes existing/excluded/new, counts a reactor once, and never changes decisions',async()=>{
 const {db}=releaseFixture();const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]};await seedDatabase(db,seed);const p=(await db.prepare("SELECT * FROM performers WHERE id='missioned-souls'").all()).results;
 const item=id=>({id,snippet:{title:'Missioned Souls reaction',channelId:'UCnewreactor123456789012',channelTitle:'Fixture reactor',publishedAt:'2026-10-28T11:50:00Z'},contentDetails:{duration:'PT10M'},status:{privacyStatus:'public'}});
 const id=await page(db);await saveVideos(db,[item('newvid00001'),item('newvid00002')],p,'2026-10-28T12:00:00Z','Performer discovery search',{pageId:id});
 const outcome=await recordSearchResults(db,id,'missioned-souls',['newvid00001','newvid00002'],new Set(),new Set(),'2026-10-28T12:00:00Z');assert.equal(outcome.newVideos,2);assert.equal(outcome.newReactors,1);
 const obs=await db.prepare("SELECT * FROM discovery_observations WHERE video_id='newvid00001'").first();assert.equal(obs.search_page_id,id);assert.equal(obs.strategy_version,SEARCH_STRATEGY);
 await db.prepare("INSERT INTO exclusions(performer_id,video_id,reason) VALUES('missioned-souls','excluded001','fixture')").run();
 const next=await page(db);await recordSearchResults(db,next,'missioned-souls',['newvid00001','excluded001','unknown0001'],new Set(['newvid00001']),new Set(['UCnewreactor123456789012']),'2026-10-28T12:00:00Z');
 const rows=(await db.prepare('SELECT * FROM discovery_search_results WHERE page_id=?').bind(next).all()).results;assert.equal(rows.find(x=>x.video_id==='newvid00001').is_new,0);assert.equal((await db.prepare("SELECT status FROM matches WHERE video_id='newvid00001'").first()).status,'CONFIRMED');
});
test('daily and completed-week reports preserve raw samples, exclude old/premiere timing, and group settings',async()=>{
 const {db}=releaseFixture();const at='2026-10-27T12:00:00Z',id=await page(db,at);const a=await reserveSearchAttempt(db,id,20,at);await finishSearchAttempt(db,a,'succeeded',200,30);await finishSearchPage(db,id,{status:'completed',results:2,at});
 for(const [video,delay,source]of [['sample00001',60,'Performer discovery search'],['sample00002',180,'RSS fallback'],['sample00003',90000,'Historical upload scan'],['sample00004',null,'Recent-upload check']])await db.prepare('INSERT INTO discovery_observations(video_id,source,discovered_at,published_at,delay_seconds,strategy_version) VALUES(?,?,?,?,?,?)').bind(video,source,at,null,delay,SEARCH_STRATEGY).run();
 await sampleDiscoveryHealth(db,{}, {status:'succeeded',calls:2,durationMs:400},at);
 const result=await discoveryPerformance(db,new Date('2026-10-28T12:00:00Z'));assert.equal(result.daily.length,15);const day=result.daily.find(x=>x.day==='2026-10-27');assert.equal(day.freshSamples,2);assert.equal(day.medianSeconds,120);assert.equal(day.p90Seconds,180);assert.equal(day.olderVideos,1);assert.equal(day.unknownTiming,1);assert.equal(day.attempts,1);assert.equal(day.queries[0].strategy,SEARCH_STRATEGY);assert.equal(result.weeks[0].attempts,1);assert.equal(result.weeks[0].days.length,7);assert.equal(result.weeks[1].days.length,7);assert.equal(result.weeks[0].measuredDays,1);
});
test('packaged measurement route rejects anonymous/member callers and returns private reports to moderators',async(t)=>{
 const {default:worker}=await import('../dist/server/index.js');const {env}=releaseFixture();env.SUPABASE_URL='https://test.supabase.co';env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';
 t.mock.method(globalThis,'fetch',async(_url,options)=>Response.json({id:'report-user',email:options.headers.Authorization==='Bearer staff.report'?'lead@example.com':'fan@example.com',email_confirmed_at:'2026-09-29T00:00:00Z'}));
 const request=token=>new Request('https://test/api/discovery/performance',{headers:token?{Authorization:'Bearer '+token}:{}});
 assert.equal((await worker.fetch(request(),env)).status,401);assert.equal((await worker.fetch(request('member.report'),env)).status,403);
 const response=await worker.fetch(request('staff.report'),env);assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private.*no-store/);assert.equal((await response.json()).timezone,'America/Los_Angeles');
});
