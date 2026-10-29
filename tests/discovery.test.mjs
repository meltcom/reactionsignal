import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { seedDatabase, catalog, status, EXCLUDED } from '../server/db.mjs';
import { classify, seconds, saveVideo, runDiscovery, YouTube, searchDailyLimit, searchInterval, performerQueries, recentSongTitles, refreshOfficialSearchFeed } from '../server/discovery.mjs';
import {refreshVideoMetadata} from '../server/video-metadata.mjs';
import {videoFormat} from '../server/video-format.mjs';
import {recheckVideoFormats} from '../server/format-recheck.mjs';

test('format evidence uses description tags and real player dimensions, never thumbnails or duration alone',()=>{
 const v={snippet:{title:'Reaction',description:'#SHORTS',publishedAt:'2026-10-19T00:00:00Z'}};
 assert.equal(videoFormat(v,90),'SHORT');
 assert.equal(videoFormat(v,181),'FULL_LENGTH');
 assert.equal(videoFormat(v,null),'UNKNOWN');
 assert.equal(videoFormat({...v,player:{embedWidth:480,embedHeight:270}},90),'FULL_LENGTH');
 assert.equal(videoFormat({...v,snippet:{...v.snippet,description:''},player:{embedWidth:270,embedHeight:480}},90),'SHORT');
 assert.equal(videoFormat({...v,snippet:{...v.snippet,description:'',publishedAt:'2024-01-01'},player:{embedWidth:270,embedHeight:480}},90),'UNKNOWN');
 assert.equal(videoFormat({...v,snippet:{...v.snippet,description:''}},90),'UNKNOWN');
 assert.equal(videoFormat({...v,snippet:{...v.snippet,description:'#shortstory'}},90),'UNKNOWN');
});

test('refresh upgrades Unknown from description evidence but preserves established and manually locked formats',async()=>{
 const d=db();await seedDatabase(d,seed);const p=(await d.prepare('SELECT * FROM performers').all()).results;
 const v={...item(),contentDetails:{duration:'PT1M30S'}};
 await saveVideo(d,v,p,'2026-10-01T00:00:00Z','test');
 assert.equal((await d.prepare('SELECT format FROM videos').first()).format,'UNKNOWN');
 v.snippet.description='#shorts';
 await saveVideo(d,v,p,'2026-10-09T00:00:00Z','test');
 assert.equal((await d.prepare('SELECT format FROM videos').first()).format,'SHORT');
 v.snippet.description='';
 await saveVideo(d,v,p,'2026-10-17T00:00:00Z','test');
 assert.equal((await d.prepare('SELECT format FROM videos').first()).format,'SHORT');
 await d.prepare("UPDATE videos SET format='FULL_LENGTH',format_locked=1").run();
 v.snippet.description='#shorts';
 await saveVideo(d,v,p,'2026-10-25T00:00:00Z','test');
 assert.equal((await d.prepare('SELECT format FROM videos').first()).format,'FULL_LENGTH');
});

test('Unknown recheck uses one enriched lookup, preserves locks and decisions, and does not immediately repeat',async()=>{
 const d=db();await seedDatabase(d,seed);const p=(await d.prepare('SELECT * FROM performers').all()).results;
 const v={...item(),contentDetails:{duration:'PT1M30S'}};
 await saveVideo(d,v,p,'2026-10-01T00:00:00Z','test');
 const locked={...v,id:'locked12345'};await saveVideo(d,locked,p,'2026-10-01T00:00:00Z','test');
 await d.prepare('UPDATE videos SET format_locked=1 WHERE id=?').bind(locked.id).run();
 let calls=0;
 const fetcher=async url=>{calls++;assert.equal(url.searchParams.get('maxWidth'),'480');assert.ok(url.searchParams.get('part').includes('player'));assert.equal(url.searchParams.get('id'),v.id);return Response.json({items:[{...v,player:{embedWidth:270,embedHeight:480}}]});};
 const result=await recheckVideoFormats({DB:d,YOUTUBE_API_KEY:'fixture'},fetcher);
 assert.equal(result.updated,1);assert.equal(calls,1);
 assert.equal((await d.prepare('SELECT format FROM videos WHERE id=?').bind(v.id).first()).format,'SHORT');
 assert.equal((await d.prepare('SELECT format FROM videos WHERE id=?').bind(locked.id).first()).format,'UNKNOWN');
 assert.equal((await d.prepare('SELECT status FROM matches WHERE video_id=?').bind(v.id).first()).status,'CONFIRMED');
 assert.equal((await recheckVideoFormats({DB:d,YOUTUBE_API_KEY:'fixture'},fetcher)).status,'complete');
 assert.equal(calls,1);
});
function db(historical=false){
  const sql=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));
  if(!historical)sql.exec('DELETE FROM discovery_notifications; DELETE FROM discovery_observations; DELETE FROM exclusions; DELETE FROM matches; DELETE FROM videos; DELETE FROM channels; DELETE FROM state; DELETE FROM performers;');
  const database={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return database;
}
const channel='UC1234567890123456789012';
const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[{id:channel,name:'Sample reactor',performerId:'missioned-souls',url:`https://www.youtube.com/channel/${channel}`}],videos:[]};
function item(id='abcdefghijk',title='Missioned Souls reaction'){return {id,snippet:{channelId:channel,channelTitle:'Sample reactor',title,publishedAt:'2026-09-24T12:00:00Z'},contentDetails:{duration:'PT6M12S'},status:{privacyStatus:'public'}};}
test('discovery never turns official-channel uploads into reaction matches',async()=>{
 const d=db();await seedDatabase(d,seed);const performers=(await d.prepare('SELECT * FROM performers').all()).results;
 const official={...item('official1234'),snippet:{...item('official1234').snippet,channelId:'UCeTfwcnUVurw7Qrk_KF5Idw'}};
 assert.equal(await saveVideo(d,official,performers,'2026-10-21T00:00:00Z','test'),0);
 assert.equal((await d.prepare("SELECT COUNT(*) n FROM videos WHERE id='official1234'").first()).n,0);
});
test('zero search budget disables requests and reports the scheduling reason',async()=>{
 const d=await isolatedDiscovery();await d.prepare("UPDATE channels SET discovery_scope='other'").run();let searches=0;
 await runDiscovery({DB:d,YOUTUBE_API_KEY:'fixture-only',DISCOVERY_DAILY_SEARCH_LIMIT:'0'},seed,async url=>{if(url.pathname.endsWith('/search'))searches++;return Response.json({items:[]});});
 assert.equal(searches,0);const report=JSON.parse((await d.prepare("SELECT value FROM state WHERE key='search-diagnostics:missioned-souls'").first()).value);assert.equal(report.status,'disabled');assert.equal(report.dailyLimit,0);
 assert.equal(searchDailyLimit({}),20);assert.equal(searchDailyLimit({DISCOVERY_DAILY_SEARCH_LIMIT:'bad'}),20);
});
test('classifies exact performer names; accepts cover and short title matches',()=>{
 assert.equal(classify('Missioned Souls reaction',['Missioned Souls'],400),'CONFIRMED');
 assert.equal(classify('NotMissioned Souls reaction',['Missioned Souls'],400),null);
 assert.equal(classify('Missioned Souls cover',['Missioned Souls'],400),'CONFIRMED');
 assert.equal(classify('Missioned Souls reaction',['Missioned Souls'],90),'CONFIRMED');
 assert.equal(seconds('PT1H2M3S'),3723);
});
test('broad approval rules use performer evidence on any channel',()=>{
 for(const aliases of [['Missioned Souls'],['New Act']]){
  const name=aliases[0];
  for(const duration of [400,90,null])assert.equal(classify(name+' cover',aliases,duration),'CONFIRMED');
  assert.equal(classify(name+' Watch Party!!',aliases,400),'PENDING');
  assert.equal(classify(name+' - LIVE Requests, Tour Updates, Behind the Scenes',aliases,400),'PENDING');
  assert.equal(classify('Before '+name+', there was Another Band | FIRST reaction',aliases,400),'PENDING');
  assert.equal(classify('Not'+name+' reaction',aliases,400),null);
  assert.equal(classify('My first reaction',aliases,null,{description:'I react to '+name+' today.'}),'CONFIRMED');
  assert.equal(classify('My reaction',aliases,400,{description:'#'+name}),null);
  assert.equal(classify('My reaction',aliases,400,{description:'Original video: '+name}),null);
 }
});
test('approved short pattern publishes as Short; exclusions, holds and manual formats win',async()=>{
 const d=db();await seedDatabase(d,seed);const p=(await d.prepare('SELECT * FROM performers').all()).results;
 const shortChannel=channel;
 const short={...item('shortvideo1','Missioned Souls Fernando Reaction #shorts'),snippet:{...item().snippet,channelId:shortChannel,title:'Missioned Souls Fernando Reaction #shorts'},contentDetails:{duration:'PT1M'}};
 await saveVideo(d,short,p,'2026-10-11T12:00:00Z','test');
 assert.equal((await d.prepare('SELECT status FROM matches WHERE video_id=?').bind(short.id).first()).status,'CONFIRMED');
 assert.equal((await d.prepare('SELECT format FROM videos WHERE id=?').bind(short.id).first()).format,'SHORT');
 await d.prepare("UPDATE matches SET status='PENDING',source='Manual hold' WHERE video_id=?").bind(short.id).run();
 await d.prepare("UPDATE videos SET format='FULL_LENGTH',format_locked=1 WHERE id=?").bind(short.id).run();
 await saveVideo(d,short,p,'2026-10-12T12:00:00Z','test');
 assert.equal((await d.prepare('SELECT status FROM matches WHERE video_id=?').bind(short.id).first()).status,'PENDING');
 assert.equal((await d.prepare('SELECT format FROM videos WHERE id=?').bind(short.id).first()).format,'FULL_LENGTH');
 await d.prepare("INSERT INTO exclusions(performer_id,video_id,reason) VALUES('missioned-souls','excluded123','Checked by moderator')").run();
 await saveVideo(d,{...short,id:'excluded123'},p,'2026-10-12T12:00:00Z','test');
 assert.equal(await d.prepare("SELECT 1 FROM matches WHERE video_id='excluded123'").first(),null);
 await saveVideo(d,{...short,id:'private1234',status:{privacyStatus:'private'}},p,'2026-10-12T12:00:00Z','test');
 assert.equal(await d.prepare("SELECT 1 FROM videos WHERE id='private1234'").first(),null);
 await saveVideo(d,{...short,id:'heldvideo12'},p.map(p=>({...p,review_mode:'review'})),'2026-10-12T12:00:00Z','test');
 assert.equal((await d.prepare("SELECT status FROM matches WHERE video_id='heldvideo12'").first()).status,'PENDING');
});
test('seed is idempotent and applies prior exclusions',async()=>{
 const d=db(),input={...seed,videos:[{id:EXCLUDED[0],channelId:channel,title:'False positive',performerId:'missioned-souls',confidence:'CONFIRMED'}]};
 await seedDatabase(d,input);await seedDatabase(d,input);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM channels').first()).n,1);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM videos').first()).n,0);
});
test('repeated discovery preserves first discovery time and correction status',async()=>{
 const d=db();await seedDatabase(d,seed);const p=(await d.prepare('SELECT * FROM performers').all()).results;
 assert.equal(await saveVideo(d,item(),p,'2026-09-24T12:00:00Z','test'),1);
 assert.equal(await saveVideo(d,item(),p,'2026-09-25T12:00:00Z','test'),0);
 assert.equal((await d.prepare("SELECT discovered_at FROM videos WHERE id='abcdefghijk'").first()).discovered_at,'2026-09-24T12:00:00Z');
 await d.prepare("UPDATE matches SET status='PENDING'").run();await saveVideo(d,item(),p,'2026-09-25T13:00:00Z','test');
 assert.equal((await d.prepare("SELECT status FROM matches WHERE video_id='abcdefghijk' AND performer_id='missioned-souls'").first()).status,'PENDING');
 assert.equal(await saveVideo(d,item(EXCLUDED[0]),p,'2026-09-25T13:00:00Z','test'),0);
 assert.equal((await catalog(d,seed,{})).videos.length,0);
});
test('missing credentials never report success or fetch YouTube',async()=>{
 const d=db();const r=await runDiscovery({DB:d},seed,()=>{throw new Error('must not fetch');});assert.equal(r.status,'blocked');
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM runs').first()).n,0);
});
test('schedule status comes from actual scheduled invocations, not manual runs',async()=>{
 const d=db();await seedDatabase(d,seed);
 assert.equal((await status(d,{YOUTUBE_API_KEY:'fixture-only'})).automation,'not_connected');
 await d.prepare("INSERT INTO state(key,value) VALUES('last-scheduled-invocation',?)").bind(new Date().toISOString()).run();
 assert.equal((await status(d,{YOUTUBE_API_KEY:'fixture-only'})).automation,'active');
 await d.prepare("UPDATE state SET value=? WHERE key='last-scheduled-invocation'").bind(new Date(Date.now()-25*3600000).toISOString()).run();
 assert.equal((await status(d,{YOUTUBE_API_KEY:'fixture-only'})).automation,'stale');
});
test('known channel scan persists fixture data and throttles immediate repeats',async()=>{
 const d=db();await seedDatabase(d,seed);await d.prepare("UPDATE channels SET discovery_scope='eligible' WHERE id=?").bind(channel).run();let calls=0;const fake=async url=>{calls++;const endpoint=url.pathname.split('/').pop();return Response.json(endpoint==='channels'?{items:[{id:channel,contentDetails:{relatedPlaylists:{uploads:'uploads-example'}}}]}:endpoint==='playlistItems'?{items:[{contentDetails:{videoId:'abcdefghijk',videoPublishedAt:'2026-09-24T12:00:00Z'}}]}:endpoint==='videos'?{items:[item()]}:{items:[]});};
 const env={DB:d,YOUTUBE_API_KEY:'fixture-only'};const result=await runDiscovery(env,seed,fake);
 assert.equal(result.status,'succeeded');assert.equal(result.added,1);assert.equal(result.channels,1);
 assert.ok((await d.prepare('SELECT recent_checked_at FROM channels WHERE id=?').bind(channel).first()).recent_checked_at);
 const before=calls;assert.equal((await runDiscovery(env,seed,fake)).status,'busy');assert.equal(calls,before);
});
test('quota rejection leaves the scan resumable and last successful date empty',async()=>{
 const d=db();const r=await runDiscovery({DB:d,YOUTUBE_API_KEY:'fixture-only'},seed,async()=>Response.json({error:{errors:[{reason:'quotaExceeded'}]}},{status:403}));
 assert.equal(r.status,'partial');assert.match(r.detail,/quotaExceeded/);
 assert.equal((await d.prepare('SELECT checked_at FROM channels').first()).checked_at,null);
 assert.equal((await status(d,{})).lastSuccessfulBatchAt,null);
});
test('transient errors retry without leaking the API key',async()=>{
 let calls=0;const api=new YouTube('never-log-this',async url=>{assert.equal(url.searchParams.has('key'),false);return ++calls===1?Response.json({}, {status:503}):Response.json({items:[]});});
 assert.deepEqual(await api.get('videos',{id:'abcdefghijk'}),{items:[]});assert.equal(api.calls,2);
});
test('real pilot seed loads persistently without reintroducing excluded videos',async()=>{
 const input=JSON.parse(readFileSync(new URL('../data.json',import.meta.url),'utf8'));const d=db(true);
 await seedDatabase(d,input);await seedDatabase(d,input);const result=await catalog(d,input,{});
 assert.ok(result.videos.length>300);assert.ok(result.channels.length>=390);
 assert.equal(result.videos.some(v=>EXCLUDED.includes(v.id)),false);
 assert.equal(result.videos.some(v=>v.id==='gXWQQNUpKcA'),false);
 assert.equal((await status(d,{})).automation,'not_connected');
});
test('reviewed discovery run preserves prior decisions, records once, and retains duplicate holds',async()=>{
 const input=JSON.parse(readFileSync(new URL('../data.json',import.meta.url),'utf8'));
 input.importRun=JSON.parse(readFileSync(new URL('../import-run.json',import.meta.url),'utf8'));
 const d=db(true),priorMatches=new Map();
 for(const v of input.importRun.videos){const match=await d.prepare("SELECT status,source FROM matches WHERE performer_id='missioned-souls' AND video_id=?").bind(v.id).first();if(match)priorMatches.set(v.id,match);}
 const priorCandidates=new Map();for(const held of input.importRun.possibleDuplicates)priorCandidates.set(held.candidateId,await d.prepare('SELECT id FROM channels WHERE id=?').bind(held.candidateId).first());await seedDatabase(d,input);await seedDatabase(d,input);
 const result=await catalog(d,input,{});
 assert.ok(priorMatches.size>0,'historical fixture exercises existing decisions');
 for(const [id,prior] of priorMatches)assert.deepEqual(await d.prepare("SELECT status,source FROM matches WHERE performer_id='missioned-souls' AND video_id=?").bind(id).first(),prior,'import must retain the existing decision and its provenance');
 for(const c of result.channels){const snapshot=await d.prepare('SELECT value FROM state WHERE key=?').bind('master-channel-snapshot:'+c.id).first();if(snapshot)assert.equal(c.currentDiscovery,false,'newest master snapshots replace older new-reactor flags');}
 assert.equal(input.importRun.channels.length,7);
 for(const held of input.importRun.possibleDuplicates)assert.deepEqual(await d.prepare('SELECT id FROM channels WHERE id=?').bind(held.candidateId).first(),priorCandidates.get(held.candidateId),'imports must not add or delete held candidate identities');
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM state WHERE key=?').bind(`import:${input.importRun.id}`).first()).n,1);
});
test('packaged Worker gates catalog and status behind member sign-in',async(t)=>{
 const worker=(await import('../dist/server/index.js')).default;const env={DB:db(true),SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'member',email:'fan@example.com',email_confirmed_at:'2026-09-29T00:00:00Z'}));
 for(const path of ['/data.json','/api/status']){
  const anonymous=await worker.fetch(new Request('https://pilot.test'+path),env);assert.equal(anonymous.status,401);
  const forged=await worker.fetch(new Request('https://pilot.test'+path,{headers:{'oai-authenticated-user-id':'owner'}}),env);assert.equal(forged.status,401);
 }
 const catalogResponse=await worker.fetch(new Request('https://pilot.test/data.json',{headers:{Authorization:'Bearer verified.token'}}),env);
 assert.equal(catalogResponse.status,200);assert.ok((await catalogResponse.json()).videos.length>300);
 const rejected=await worker.fetch(new Request('https://pilot.test/api/discovery/run',{method:'POST'}),env);assert.equal(rejected.status,401);
 const unavailable=await worker.fetch(new Request('https://pilot.test/data.json'),{});assert.equal(unavailable.status,503);
 const home=await worker.fetch(new Request('https://pilot.test/'),env);assert.equal(home.status,200);const html=await home.text();assert.match(html,/Reaction Journey/);assert.match(html,/id="welcome"/);assert.match(html,/id="memberApp" hidden inert/);
});

test('Missioned Souls history resumes pages, honors daily budgets and holds uncertain reactions',async()=>{
 const d=db();await seedDatabase(d,seed);
 await d.prepare("UPDATE performers SET review_mode='review',lookback_days=90 WHERE id='missioned-souls'").run();
 const env={DB:d,YOUTUBE_API_KEY:'test-key',DISCOVERY_DAILY_SEARCH_LIMIT:1};let searches=0,firstWindow;
 const fetcher=async request=>{
  const u=new URL(request);
  if(u.pathname.endsWith('/search')){
   searches++;assert.equal(u.searchParams.get('q'),'"Missioned Souls"');
   if(searches===1){firstWindow=u.searchParams.get('publishedAfter');return Response.json({items:[{id:{videoId:'abcdefghijk'}}],nextPageToken:'next-page'});}
   assert.equal(u.searchParams.get('pageToken'),'next-page');assert.equal(u.searchParams.get('publishedAfter'),firstWindow);
   return Response.json({items:[]});
  }
  if(u.pathname.endsWith('/videos'))return Response.json({items:[item('abcdefghijk','Missioned Souls reaction')]});
  throw new Error('Targeted onboarding should not scan unrelated channels');
 };
 const first=await runDiscovery(env,seed,fetcher,{performerId:'missioned-souls'});assert.equal(first.status,'partial');
 const progress=(await d.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first()).value;
 assert.equal(JSON.parse(progress).page,'next-page');
 assert.equal((await d.prepare("SELECT status FROM matches WHERE performer_id='missioned-souls'").first()).status,'PENDING');
 assert.equal((await catalog(d,seed,env)).videos.some(v=>v.id==='abcdefghijk'),false);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 const capped=await runDiscovery(env,seed,fetcher,{performerId:'missioned-souls'});assert.equal(capped.status,'partial');assert.match(capped.detail,/Daily search budget/);assert.equal(searches,1);
 assert.equal((await d.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first()).value,progress);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease' OR key LIKE 'search-attempt-budget:%'").run();
 await d.prepare("UPDATE state SET value=? WHERE key='search-touch:missioned-souls'").bind(new Date(Date.now()-25*3600000).toISOString()).run();
 await runDiscovery(env,seed,fetcher,{performerId:'missioned-souls'});assert.equal(searches,2);
 assert.equal(await d.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first(),null);
 assert.ok(await d.prepare("SELECT value FROM state WHERE key='search:missioned-souls'").first());
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await runDiscovery(env,seed,fetcher,{performerId:'missioned-souls'});assert.equal(searches,2);
});
test('unknown durations no longer block clear title matches',()=>{
 assert.equal(classify('New Act reaction',['New Act'],null),'CONFIRMED');
});
test('weighted query rotation favors proven name searches and retains song and alias experiments',()=>{
 const p={name:'Missioned Souls',aliases:JSON.stringify(['Missioned Souls','MissionedSoul'])};
 const songs=recentSongTitles([
  {title:'Old Song by Artist',publishedAt:'2020-01-01'},
  {title:'Missioned Souls - Live in Zambales | DECODE by Paramore',publishedAt:'2026-10-12'},
  {title:'I HATE MYSELF FOR LOVING YOU - Joan Jett & The Blackhearts | Missioned Souls | studio cover',publishedAt:'2026-10-13'},
  {title:'Undated by Artist'}
 ]);
 assert.deepEqual(songs,['I HATE MYSELF FOR LOVING YOU','DECODE','Old Song']);
 const q=performerQueries(p,songs);assert.equal(q.length,20);
 assert.equal(q.filter(x=>x==='"Missioned Souls"').length,12);
 assert.equal(q.filter(x=>x==='"Missioned Souls" reaction').length,6);
 assert.ok(q.includes('"I HATE MYSELF FOR LOVING YOU" reaction'));
 assert.ok(q.includes('"MissionedSoul" reaction'));
 assert.equal(searchInterval({}),72*60000);assert.equal(searchInterval({DISCOVERY_DAILY_SEARCH_LIMIT:10}),144*60000);
});
test('official channel RSS refreshes recent song hints without Data API calls and falls back to cache',async()=>{
 const d=db(),channelId='UCabcdefghijklmnopqrstuv';
 await d.prepare("INSERT INTO state(key,value) VALUES('ms-refresh',?)").bind(JSON.stringify({channelId})).run();
 let calls=0;
 const xml=`<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>Missioned Souls - Live in Zambales | DECODE by Paramore</title><published>2026-10-17T12:00:00Z</published></entry></feed>`;
 const videos=await refreshOfficialSearchFeed(d,async(url,options)=>{calls++;assert.match(url,new RegExp(encodeURIComponent(channelId)+'$'));assert.ok(options.signal);return new Response(xml);});
 assert.equal(calls,1);assert.equal(videos[0].id,'abcdefghijk');assert.deepEqual(recentSongTitles(videos),['DECODE']);
 const cached=await refreshOfficialSearchFeed(d,async()=>{throw new Error('temporary feed outage');});
 assert.deepEqual(cached,videos);
});
test('paced rotation overlaps windows, preserves pagination, and counts unique discoveries only once',async()=>{
 const d=await isolatedDiscovery();await d.prepare("UPDATE channels SET discovery_scope='other'").run();
 const recent=new Date(Date.now()-2*3600000).toISOString();await d.prepare("INSERT INTO state(key,value) VALUES('search:missioned-souls',?)").bind(recent).run();
 let calls=0;const queries=[];
 const fake=async url=>{if(url.pathname.endsWith('/search')){calls++;queries.push(url.searchParams.get('q'));assert.equal(url.searchParams.get('publishedAfter'),new Date(Date.parse(recent)-7*86400000).toISOString());return Response.json({items:[{id:{videoId:'newvideo123'}}],...(calls===1?{nextPageToken:'next'}:{})});}if(url.pathname.endsWith('/videos'))return Response.json({items:[{...item('newvideo123'),snippet:{...item().snippet,channelId:'UCnewreactor123456789012',publishedAt:new Date(Date.now()-600000).toISOString()}}]});return Response.json({items:[]});};
 const env={DB:d,YOUTUBE_API_KEY:'fixture-only'};
 await runDiscovery(env,seed,fake);assert.equal(calls,1);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await runDiscovery(env,seed,fake);assert.equal(calls,1);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await d.prepare("UPDATE state SET value=? WHERE key='search-touch:missioned-souls'").bind(new Date(Date.now()-76*60000).toISOString()).run();
 await runDiscovery(env,seed,fake);assert.equal(calls,2);assert.equal(queries[0],queries[1]);
 const metric=JSON.parse((await d.prepare("SELECT value FROM state WHERE key LIKE 'search-query:%'").first()).value);assert.equal(metric.pages,2);assert.equal(metric.uniqueVideos,1);assert.equal(metric.newReactors,1);assert.equal(metric.delaySamples,1);
});

async function isolatedDiscovery(){
 const d=db();await seedDatabase(d,seed);
 await d.prepare("UPDATE channels SET discovery_scope='other'").run();
 await d.prepare("UPDATE channels SET discovery_scope='eligible',uploads='active-uploads',recent_checked_at=? WHERE id=?").bind(new Date(Date.now()-2*3600000).toISOString(),channel).run();
 const performers=(await d.prepare("SELECT * FROM performers WHERE id='missioned-souls'").all()).results;
 const video=item();video.snippet.publishedAt=new Date(Date.now()-86400000).toISOString();
 await saveVideo(d,video,performers,new Date().toISOString(),'fixture');
 return d;
}
test('overdue coverage precedes active reactors, and search precedes history',async()=>{
 const d=await isolatedDiscovery();
 for(let i=0;i<8;i++)await d.prepare("INSERT INTO channels(id,name,uploads,discovery_scope) VALUES(?,?,?,'eligible')").bind('backlog-'+i,'Backlog','backlog-uploads-'+i).run();
 await d.prepare("UPDATE channels SET next_page='older',scan_before='2020-01-01' WHERE id=?").bind(channel).run();
 const requests=[];const fake=async url=>{requests.push({endpoint:url.pathname.split('/').pop(),playlist:url.searchParams.get('playlistId'),page:url.searchParams.get('pageToken')});return Response.json({items:[]});};
 await runDiscovery({DB:d,YOUTUBE_API_KEY:'fixture-only',DISCOVERY_RECENT_BATCH_SIZE:4},seed,fake);
 const recent=requests.filter(r=>r.endpoint==='playlistItems'&&!r.page);
 assert.equal(recent.length,4);assert.equal(recent[0].playlist,'backlog-uploads-0');
 assert.equal(new Set(recent.map(r=>r.playlist)).size,4);
 assert.ok(requests.findIndex(r=>r.endpoint==='search')<requests.findIndex(r=>r.page==='older'));
});
test('completed searches use the interval appropriate to the daily cap',async()=>{
 const d=await isolatedDiscovery();
 await d.prepare("UPDATE channels SET discovery_scope='other'").run();
 const now=new Date().toISOString();
 await d.prepare("INSERT INTO state(key,value) VALUES('search:missioned-souls',?)").bind(now).run();
 let searches=0;const fake=async url=>{if(url.pathname.endsWith('/search'))searches++;return Response.json({items:[]});};
 const env={DB:d,YOUTUBE_API_KEY:'fixture-only',DISCOVERY_DAILY_SEARCH_LIMIT:1};
 await runDiscovery(env,seed,fake);assert.equal(searches,0);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await d.prepare("UPDATE state SET value=? WHERE key='search:missioned-souls'").bind(new Date(Date.now()-25*3600000).toISOString()).run();
 await runDiscovery(env,seed,fake);assert.equal(searches,1);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await d.prepare("UPDATE state SET value=? WHERE key='search:missioned-souls'").bind(new Date(Date.now()-3*3600000).toISOString()).run();
 const capped=await runDiscovery(env,seed,fake);assert.equal(searches,1);assert.match(capped.detail,/Daily search budget/);
});

test('actual packaged scheduled handler records invocation without YouTube credentials',async(t)=>{
 const worker=(await import('../dist/server/index.js')).default,d=db(true),pending=[];
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No unconfigured API request should occur');});
 await worker.scheduled({cron:'*/15 * * * *'},{DB:d},{waitUntil(p){pending.push(p);}});
 await Promise.all(pending);
 const recorded=await d.prepare("SELECT value FROM state WHERE key='last-scheduled-invocation'").first();
 assert.ok(Number.isFinite(Date.parse(recorded.value)));assert.equal((await status(d,{})).automation,'active');
});

test('candidate hold repair retains the record, audits it, and never overrides reviewed decisions',async()=>{
 const d=db(true),id='gXWQQNUpKcA',migration=readFileSync(new URL('../drizzle/0036_restore_import_candidate_hold_20261010.sql',import.meta.url),'utf8');
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')&&!x.startsWith('0036')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 sql.exec(migration);
 assert.equal(sql.prepare("SELECT status FROM matches WHERE video_id=? AND performer_id='missioned-souls'").get(id).status,'PENDING');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM videos WHERE id=?').get(id).n,1);
 const audit=JSON.parse(sql.prepare("SELECT value FROM state WHERE key='candidate-hold-repair:gXWQQNUpKcA'").get().value);assert.equal(audit.beforeStatus,'PROBABLE');
 for(const status of ['CONFIRMED','REJECTED']){
  sql.prepare("UPDATE matches SET status=?,source='Moderator decision' WHERE video_id=?").run(status,id);sql.exec(migration);
  assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get(id).status,status);
 }
 // A correction audit protects a historical-looking row too.
 sql.prepare("UPDATE matches SET status='PROBABLE',source='Reconciled master/CSV historical import 2026-09-30' WHERE video_id=?").run(id);
 sql.prepare("INSERT INTO video_corrections(id,video_id,moderator_id,note,before_json,after_json,created_at) VALUES('review',?,'owner','Checked metadata','{}','{}','2026-10-01')").run(id);
 sql.exec(migration);assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get(id).status,'PROBABLE');
 assert.equal((await d.prepare('SELECT status FROM matches WHERE video_id=?').bind(id).first()).status,'PENDING');
});

test('fresh delay median excludes older catalog finds and unknown or negative timestamps',async()=>{
 const {discoveryTiming}=await import('../server/db.mjs');
 const timing=discoveryTiming([{source:'RSS fallback',delay_seconds:60},{source:'RSS fallback',delay_seconds:180},{source:'Performer discovery search',delay_seconds:86400},{source:'Historical upload scan',delay_seconds:86401},{source:'Performer discovery search',delay_seconds:20*86400},{source:'RSS fallback',delay_seconds:null},{source:'RSS fallback',delay_seconds:-60}]);
 assert.equal(timing.delay.samples,3);assert.equal(timing.delay.median_seconds,180);assert.equal(timing.olderDiscoveryDelay.samples,2);assert.equal(timing.olderDiscoveryDelay.median_seconds,(86401+20*86400)/2);assert.equal(timing.delayWindow.unavailableSamples,2);
 assert.equal(timing.delaySources.find(x=>x.source==='RSS fallback').median_seconds,120);
 assert.deepEqual(discoveryTiming([]).delay,{samples:0,average_seconds:null,median_seconds:null,max_seconds:null});
});
test('video batch snapshots use one lookup per chunk and retain exclusion guards',async()=>{
 const {saveVideos}=await import('../server/discovery.mjs');const d=db();await seedDatabase(d,seed);
 const performers=(await d.prepare('SELECT * FROM performers').all()).results;
 const items=Array.from({length:51},(_,n)=>item('batch'+String(n).padStart(6,'0')));
 await d.prepare('INSERT INTO exclusions(performer_id,video_id,reason) VALUES(?,?,?)').bind('missioned-souls',items[0].id,'fixture exclusion').run();
 let lookups=0;const measured={prepare(query){if(query.startsWith('WITH ids AS'))lookups++;return d.prepare(query);},batch:statements=>d.batch(statements)};
 assert.equal(await saveVideos(measured,items,performers,'2026-09-24T13:00:00Z','Performer discovery search'),50);assert.equal(lookups,2);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM videos WHERE id=?').bind(items[0].id).first()).n,0);
 lookups=0;assert.equal(await saveVideos(measured,items,performers,'2026-09-24T13:00:00Z','Performer discovery search'),0);assert.equal(lookups,2);
});

test('video metadata refresh backfills duration and separate YouTube statistics, retaining curated song and genre',async()=>{
 const curatedSeed={...seed,videos:[...seed.videos,{id:'abcdefghijk',performerId:'missioned-souls',channelId:channel,channelName:'Sample reactor',title:'Missioned Souls reaction I Hate Myself for Loving You',publishedAt:'2026-09-24T12:00:00Z',format:'UNKNOWN',confidence:'CONFIRMED',song:'I Hate Myself for Loving You',genre:'Rock'}]};
 const d=db();await seedDatabase(d,curatedSeed);const performers=(await d.prepare('SELECT * FROM performers').all()).results;
 await saveVideo(d,item('abcdefghijk','Missioned Souls reaction I Hate Myself for Loving You'),performers,'2026-10-01T00:00:00Z','test');
 let calls=0;const fetcher=async url=>{calls++;assert.ok(url.searchParams.get('part').includes('statistics'));return Response.json({items:[{id:'abcdefghijk',contentDetails:{duration:'PT1H2M3S'},statistics:{viewCount:'0',likeCount:'12',commentCount:'43'}}]});};
 const result=await refreshVideoMetadata({DB:d,YOUTUBE_API_KEY:'fixture'},fetcher,new Date('2026-10-21T12:00:00Z'));
 assert.equal(result.updated,1);const data=await catalog(d,curatedSeed,{}),v=data.videos.find(x=>x.id==='abcdefghijk');
 assert.equal(v.duration,3723);assert.equal(v.views,0);assert.equal(v.likes,12);assert.equal(v.youtubeComments,43);assert.equal(v.song,'I Hate Myself for Loving You');assert.equal(v.genre,'Rock');
 await refreshVideoMetadata({DB:d,YOUTUBE_API_KEY:'fixture'},fetcher,new Date('2026-10-21T12:01:00Z'));assert.equal(calls,1);
});
test('metadata refresh preserves previous counts when a video is not returned',async()=>{
 const d=db();await seedDatabase(d,seed);await saveVideo(d,{...item(),statistics:{viewCount:'19'}},(await d.prepare('SELECT * FROM performers').all()).results,'2026-10-01T00:00:00Z','test');
 await refreshVideoMetadata({DB:d,YOUTUBE_API_KEY:'fixture'},async()=>Response.json({items:[]}),new Date('2026-10-21T12:00:00Z'));
 const value=JSON.parse((await d.prepare("SELECT value FROM state WHERE key='youtube-video-metadata:abcdefghijk'").first()).value);assert.equal(value.views,19);assert.ok(value.retryAt);
});
