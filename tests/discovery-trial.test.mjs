import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseFixture} from './release-fixture.mjs';
import {seedDatabase} from '../server/db.mjs';
import {runDiscovery,searchDue,searchDailyLimit,searchInterval} from '../server/discovery.mjs';
import {discoveryTrialEnv,TRIAL_KEY,SEARCH_STRATEGY,recordDiscoveryPublications,discoveryTrialComparison} from '../server/discovery-measurement.mjs';
import {rssRetryMs} from '../server/rss.mjs';
const trial={DISCOVERY_SEARCH_TRIAL:'20261114',DISCOVERY_DAILY_SEARCH_LIMIT:60};
const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]};
test('trial is initialized once, expires after exactly seven days, and staging cannot start it',async()=>{
 const {db}=releaseFixture();const staging={...trial,DISCOVERY_DAILY_SEARCH_LIMIT:0};assert.equal(await discoveryTrialEnv(db,staging),staging);
 assert.equal(await db.prepare('SELECT value FROM state WHERE key=?').bind(TRIAL_KEY).first(),null);
 const start='2026-11-15T08:00:00Z',env=await discoveryTrialEnv(db,trial,start);assert.equal(searchDailyLimit(env),60);
 assert.equal(env.discoveryTrial.endsAt,'2026-11-22T08:00:00.000Z');
 const before=await discoveryTrialEnv(db,trial,'2026-11-22T07:59:59Z');assert.equal(searchDailyLimit(before),60);assert.equal(before.discoveryTrial.startedAt,start);
 const after=await discoveryTrialEnv(db,trial,'2026-11-22T08:00:00Z');assert.equal(searchDailyLimit(after),40);assert.equal(after.discoveryTrial.active,false);
});
test('24-minute slots permit 60 opportunities on a 15-minute scheduler, with no duplicate slot',()=>{
 const env={...trial,discoveryTrial:{active:true}};assert.equal(searchInterval(env),24*60000);
 let touched=null,calls=0;const start=Date.parse('2026-11-16T08:00:00Z');
 for(let i=0;i<96;i++){const now=new Date(start+i*15*60000).toISOString();if(searchDue(env,now,touched)){touched=now;calls++;assert.equal(searchDue(env,now,touched),false);}}
 assert.equal(calls,60);
});
test('bounded RSS backoff respects Retry-After and resets through a fresh streak',()=>{
 assert.equal(rssRetryMs(1,null,0,()=>0),15*60000);assert.equal(rssRetryMs(2,null,0,()=>0),30*60000);
 assert.equal(rssRetryMs(8,null,0,()=>0),6*3600000);assert.equal(rssRetryMs(1,'3600',0,()=>0),3600000);
 assert.equal(rssRetryMs(2,'invalid',0,()=>1),33*60000);assert.equal(rssRetryMs(1,'999999',0),6*3600000);
});
test('trial reserves a reactor first-page slot and preserves the catch-up token',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,seed);sql.exec("UPDATE channels SET discovery_scope='other'");
 const put=async(k,v)=>db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,v).run();
 const legacy=JSON.stringify({query:'"Missioned Souls"',page:'original-token',depth:3,term:0,rotation:0,after:null,startedAt:'2026-10-01T00:00:00Z'});await put('search-progress:missioned-souls',legacy);
 const calls=[];
 for(let i=0;i<10;i++){
  sql.exec("DELETE FROM state WHERE key='discovery-lease'");await put('search-touch:missioned-souls','2000-01-01T00:00:00Z');
  await runDiscovery({...trial,DB:db,YOUTUBE_API_KEY:'fixture'},seed,async url=>{if(url.pathname.endsWith('/search')){calls.push(Object.fromEntries(url.searchParams));return Response.json({items:[],nextPageToken:'retained-token'});}return Response.json({items:[]});});
 }
 const pages=sql.prepare('SELECT settings_json FROM discovery_search_pages ORDER BY rowid').all().map(p=>JSON.parse(p.settings_json));
 assert.equal(calls.length,10);assert.equal(pages.filter(p=>p.lane==='fresh').length,7);assert.equal(pages.filter(p=>p.lane==='reactor').length,1);assert.equal(pages.filter(p=>p.lane==='catchup').length,2);
 assert.equal(calls[3].q,'"Missioned Souls" "first time"');assert.equal(calls[3].pageToken,undefined);assert.equal(calls[4].pageToken,'original-token');assert.equal(calls[9].pageToken,'retained-token');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_search_attempts').get().n,10);
});
test('publication metrics retain first availability, exclude backfill and expose missing baseline timings',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,seed);const channel='UC1234567890123456789012';
 sql.prepare("INSERT OR IGNORE INTO channels(id,name,discovery_scope) VALUES(?,'test','eligible')").run(channel);
 await discoveryTrialEnv(db,trial,'2026-11-15T08:00:00Z');
 for(const [id,discovered,strategy] of [['beforevideo','2026-11-14T08:01:00Z','legacy'],['aftervideo1','2026-11-15T08:01:00Z',SEARCH_STRATEGY]]){
  const published=new Date(Date.parse(discovered)-60000).toISOString();
  sql.prepare("INSERT INTO videos(id,channel_id,title,published_at,format) VALUES(?,?,'reaction',?,'VIDEO')").run(id,channel,published);
  sql.prepare("INSERT INTO matches VALUES('missioned-souls',?,'CONFIRMED','Performer discovery search')").run(id);
  sql.prepare("INSERT INTO discovery_observations(video_id,source,discovered_at,published_at,delay_seconds,strategy_version) VALUES(?,'Performer discovery search',?,?,60,?)").run(id,discovered,published,strategy);
 }
 await recordDiscoveryPublications(db,['beforevideo','aftervideo1'],'2026-11-15T08:02:00Z');await recordDiscoveryPublications(db,['aftervideo1'],'2026-11-15T08:03:00Z');
 const report=await discoveryTrialComparison(db,new Date('2026-11-16T08:00:00Z'));
 assert.equal(report.matchedBaseline.freshSamples,1);assert.equal(report.matchedTrial.freshSamples,1);assert.equal(report.baseline.publicationSamples,0);assert.equal(report.trial.publicationMedianSeconds,120);assert.equal(report.trial.processingMedianSeconds,60);
});
test('failed-feed active channels receive 30-minute checks while oldest daily coverage keeps half the batch',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,seed);sql.exec("UPDATE channels SET discovery_scope='other'");
 const old=new Date(Date.now()-25*3600000).toISOString(),recent=new Date(Date.now()-45*60000).toISOString();
 for(let i=0;i<11;i++){
  const id='UC'+String(i).padStart(22,'0'),uploads='UU'+String(i).padStart(22,'0');
  sql.prepare("INSERT INTO channels(id,name,uploads,recent_checked_at,discovery_scope) VALUES(?,?,?,?, 'eligible')").run(id,'reactor',uploads,i<5?old:recent);
  if(i>=5){const video='vid'+String(i).padStart(8,'0');sql.prepare("INSERT INTO videos(id,channel_id,title,published_at,checked_at) VALUES(?,?,'reaction',?,?)").run(video,id,recent,recent);sql.prepare("INSERT INTO matches VALUES('missioned-souls',?,'CONFIRMED','test')").run(video);}
  if(i>=5&&i<10)sql.prepare("INSERT INTO rss_checks(channel_id,checked_at,error) VALUES(?,?,'Feed HTTP 404; retry scheduled')").run(id,recent);
 }
 const uploads=[];await runDiscovery({...trial,DB:db,YOUTUBE_API_KEY:'fixture'},seed,async url=>{if(url.pathname.endsWith('/playlistItems'))uploads.push(url.searchParams.get('playlistId'));return Response.json({items:[]});});
 assert.equal(uploads.length,10);assert.ok(uploads.slice(0,5).every(id=>Number(id.slice(2))<5));assert.ok(uploads.slice(5).every(id=>Number(id.slice(2))>=5&&Number(id.slice(2))<10));
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM channels WHERE discovery_scope='eligible'").get().n,11);
});
