import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {recognizeCandidate,candidateEvidence,CANDIDATE_REVIEW_SOURCE} from '../server/candidate-recognition.mjs';
import {recommend} from '../server/recheck.mjs';
import {saveVideos,classify,runDiscovery} from '../server/discovery.mjs';
import {pollRss} from '../server/rss.mjs';
import {seedDatabase} from '../server/db.mjs';
import {releaseFixture} from './release-fixture.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/ms-candidates/golden-fixtures.json',import.meta.url),'utf8'));
const cases=[...fixture.observedCases,...fixture.syntheticCases];

test('shared candidate contract: all 33 captured metadata cases and 25 boundary cases',()=>{
 for(const row of cases)assert.deepEqual(recognizeCandidate(row.input),row.expectedRecognizer,row.caseId);
 const locked=JSON.parse(readFileSync(new URL('./fixtures/ms-candidates/policy-spec.json',import.meta.url),'utf8'));
 const policy=JSON.parse(readFileSync(new URL('../server/candidate-policy.json',import.meta.url),'utf8'));
 for(const key of ['version','rulesInPriorityOrder','noEvidence'])assert.deepEqual(policy[key],locked[key]);
});
test('Python/JavaScript outputs, policy hashes and metadata hashes are identical',async()=>{
 const python=spawnSync(process.env.PYTHON||'python',[fileURLToPath(new URL('../backfill-pilot/test_candidate_recognition.py',import.meta.url)),'--evidence-json'],{input:JSON.stringify(cases.map(r=>r.input)),encoding:'utf8',maxBuffer:2*1024*1024});
 assert.equal(python.status,0,python.stderr);
 const expected=JSON.parse(python.stdout);
 for(let i=0;i<cases.length;i++)assert.deepEqual(await candidateEvidence(cases[i].input),expected[i],cases[i].caseId);
});
test('candidate additions become PENDING with immutable evidence; decisions, exclusions and format locks survive',async()=>{
 const {db,sql}=releaseFixture();
 await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]});
 sql.exec('DELETE FROM matches; DELETE FROM videos; DELETE FROM channels; DELETE FROM discovery_notifications; DELETE FROM discovery_observations;');
 for(const row of fixture.observedCases)sql.prepare("INSERT OR IGNORE INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(row.input.channelId,'Fixture reactor');
 const performers=(await db.prepare("SELECT * FROM performers WHERE id='missioned-souls'").all()).results;
 const items=fixture.observedCases.map(r=>({id:r.input.id,snippet:{...r.input,publishedAt:'2020-01-01T00:00:00Z'},status:{privacyStatus:'public'},contentDetails:{duration:'PT4M'}}));
 await saveVideos(db,items,performers,'2026-11-02T19:00:00Z','offline fixture');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM matches WHERE status='PENDING'").get().n,18);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_notifications').get().n,0);
 const held=sql.prepare("SELECT source FROM matches WHERE status='PENDING' LIMIT 1").get();
 assert.ok(held.source.startsWith(CANDIDATE_REVIEW_SOURCE));
 const changedMetadata={snippet:{channelId:fixture.observedCases[0].input.channelId,title:'Missioned Souls reaction'},status:{privacyStatus:'public'},contentDetails:{duration:'PT4M'}};
 assert.equal(recommend({source:held.source,review_mode:'auto',aliases:'["Missioned Souls"]',channel_id:changedMetadata.snippet.channelId},changedMetadata).outcome,'protected');
 const evidence=sql.prepare("SELECT value FROM state WHERE key LIKE 'candidate-recognition:%'").all();
 assert.equal(evidence.length,18);assert.equal(JSON.parse(evidence[0].value).proposedDisposition,'PENDING');
 for(const control of fixture.decisionControls){
  const c=control.catalogSnapshot;
  sql.prepare("INSERT OR IGNORE INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(c.channel_id,'Known reactor');
  sql.prepare("INSERT INTO videos(id,channel_id,title,format,format_locked,available) VALUES(?,?,?,'FULL_LENGTH',1,1)").run(c.id,c.channel_id,c.title);
  sql.prepare('INSERT INTO matches(performer_id,video_id,status,source) VALUES(?,?,?,?)').run('missioned-souls',c.id,control.expectedDecision,'prior decision');
  await saveVideos(db,[{id:c.id,snippet:{channelId:c.channel_id,title:c.title,description:'#shorts'},status:{privacyStatus:'public'},contentDetails:{duration:'PT30S'}}],performers,'2026-11-03T19:00:00Z','offline fixture');
  assert.deepEqual({...sql.prepare('SELECT status,source FROM matches WHERE video_id=?').get(c.id)},{status:control.expectedDecision,source:'prior decision'});
  assert.equal(sql.prepare('SELECT format FROM videos WHERE id=?').get(c.id).format,'FULL_LENGTH');
 }
 const blocked=items[0];sql.prepare('DELETE FROM matches WHERE video_id=?').run(blocked.id);
 sql.prepare('INSERT INTO exclusions(performer_id,video_id,reason) VALUES(?,?,?)').run('missioned-souls',blocked.id,'Prior exclusion');
 await saveVideos(db,[blocked],performers,'2026-11-04T19:00:00Z','offline fixture');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches WHERE video_id=?').get(blocked.id).n,0);
 assert.equal(classify('Missioned Souls reaction',['Missioned Souls'],null),'CONFIRMED');
});
test('unknown/ineligible and official channels do not receive expanded matches; links never inherit identity',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]});
 sql.exec('DELETE FROM matches; DELETE FROM videos; DELETE FROM channels; DELETE FROM discovery_notifications; DELETE FROM discovery_observations;');
 const performers=(await db.prepare("SELECT * FROM performers WHERE id='missioned-souls'").all()).results;
 for(const channelId of ['UC'+'x'.repeat(22),'UCeTfwcnUVurw7Qrk_KF5Idw']){
  sql.prepare("INSERT OR IGNORE INTO channels(id,name,discovery_scope) VALUES(?,?,'review')").run(channelId,'Ineligible reactor');
  await saveVideos(db,[{id:'novideo0001',snippet:{channelId,title:'Missioned Soul band'},status:{privacyStatus:'public'}}],performers,'2026-11-02T19:00:00Z','fixture');
 }
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,0);
 assert.equal(recognizeCandidate({title:'A generic short',channelId:fixture.observedCases[11].input.channelId,relatedVideo:{id:'F1NuwywFyGk',confirmed:true}}).candidate,false);
});
test('recent and RSS title screens admit scoped hints without fetching generic titles',async()=>{
 const {db,sql}=releaseFixture();const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]};
 await seedDatabase(db,seed);sql.exec('DELETE FROM matches; DELETE FROM videos; DELETE FROM channels; DELETE FROM discovery_notifications; DELETE FROM discovery_observations;');
 const channel=fixture.observedCases[0].input.channelId;
 sql.prepare("INSERT INTO channels(id,name,uploads,discovery_scope) VALUES(?,?,?,'eligible')").run(channel,'Bobcat','UUtest');
 const requested=[];
 const fetcher=async input=>{
  const url=new URL(input);
  if(url.hostname==='www.youtube.com')return new Response('<feed></feed>');
  const endpoint=url.pathname.split('/').at(-1);
  if(endpoint==='playlistItems')return Response.json({items:[{snippet:{title:'MS BAND / a song'},contentDetails:{videoId:'recent00001',videoPublishedAt:'2026-11-01T00:00:00Z'}},{snippet:{title:'A generic music story'},contentDetails:{videoId:'generic0001',videoPublishedAt:'2026-11-01T00:00:00Z'}}]});
  assert.equal(endpoint,'videos');requested.push(url.searchParams.get('id'));
  return Response.json({items:[{id:'recent00001',snippet:{channelId:channel,title:'MS BAND / a song',publishedAt:'2026-11-01T00:00:00Z'},status:{privacyStatus:'public'},contentDetails:{duration:'PT4M'}}]});
 };
 const env={DB:db,YOUTUBE_API_KEY:'local-fixture',DISCOVERY_RECENT_BATCH_SIZE:'1',DISCOVERY_HISTORY_PAGES:'0',DISCOVERY_DAILY_SEARCH_LIMIT:'0'};
 const result=await runDiscovery(env,seed,fetcher);
 assert.equal(result.status,'succeeded',result.detail);assert.deepEqual(requested,['recent00001']);
 assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get('recent00001').status,'PENDING');
 const xml=`<feed><entry><yt:videoId>rssvid00001</yt:videoId><yt:channelId>${channel}</yt:channelId><title>MISSINOED SOUL BAND / Smoke</title></entry></feed>`;
 await pollRss(env,seed,async()=>new Response(xml));
 assert.equal(sql.prepare('SELECT video_id FROM push_jobs WHERE video_id=?').get('rssvid00001').video_id,'rssvid00001');
});
