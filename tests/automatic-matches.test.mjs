import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticMatch} from '../server/automatic-matches.mjs';
import {resolveAutomaticMatches} from '../server/recheck.mjs';
import {releaseFixture} from './release-fixture.mjs';
import {seedDatabase} from '../server/db.mjs';
import {saveVideos} from '../server/discovery.mjs';
const channel='UCZ77h_VX7l7SOOh7uAmZuVA';
const row={performer_id:'missioned-souls',aliases:'["Missioned Souls"]',review_mode:'auto',source:'Candidate review: Recent-upload check',channel_id:channel,discovery_scope:'eligible'};
const video=title=>({id:'newvideo123',snippet:{title,channelId:channel,description:''},status:{privacyStatus:'public'},contentDetails:{duration:'PT4M'}});
test('automatically resolves scoped variants and Shorts while rejecting promotions and unsupported identity',()=>{
 for(const title of ['MS BAND / ITS MY LIFE','MISSINOED SOUL BAND / SMOKE','Missioned soul band /ALONE','My first experience of #missionedsouls #shorts'])assert.equal(automaticMatch(row,video(title)).status,'CONFIRMED',title);
 for(const title of ['Missioned Souls Watch Party today!','New Reaction Monday #missionedsouls','Truth Hurts #missionedsouls #tomorrowrelease','SNOW THE NEXT NACES CHEN AND STACEY'])assert.equal(automaticMatch(row,video(title)).status,'REJECTED',title);
 assert.equal(automaticMatch({...row,channel_id:'different'},video('MS BAND / song')).status,null);
 assert.equal(automaticMatch({...row,source:'Moderator catalog unapprove'},video('Missioned Souls reaction')).status,null);
 assert.equal(automaticMatch({...row,review_mode:'review'},video('Missioned Souls reaction')).status,null);
 assert.equal(automaticMatch(row,null).status,null);
 assert.equal(automaticMatch({...row,channel_id:'other'}, {...video('MS BAND / song'),snippet:{title:'MS BAND / song',channelId:'other'}}).status,'REJECTED');
});
test('scheduled resolver publishes and rejects without approval, preserves manual decisions, and is idempotent',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]});
 sql.exec('DELETE FROM discovery_notifications; DELETE FROM matches; DELETE FROM videos; DELETE FROM channels;');
 sql.prepare("INSERT INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(channel,'Bobcat');
 for(const [id,title,source] of [['newvideo123','MS BAND / ITS MY LIFE',row.source],['promotion01','New Reaction Monday #missionedsouls',row.source],['manualhold1','Missioned Souls reaction','Moderator catalog unapprove']]){
  sql.prepare("INSERT INTO videos(id,channel_id,title,format,available) VALUES(?,?,?,'FULL_LENGTH',1)").run(id,channel,title);
  sql.prepare("INSERT INTO matches(performer_id,video_id,status,source) VALUES('missioned-souls',?,'PENDING',?)").run(id,source);
 }
 let calls=0;const fetcher=async()=>{calls++;return Response.json({items:[video('MS BAND / ITS MY LIFE'),{...video('New Reaction Monday #missionedsouls'),id:'promotion01'}]});};
 const env={DB:db,YOUTUBE_API_KEY:'fixture-only'};
 const result=await resolveAutomaticMatches(env,fetcher);
 assert.equal(result.status,'succeeded');assert.equal(result.published,1);assert.equal(result.rejected,1);assert.equal(calls,1);
 assert.deepEqual(sql.prepare('SELECT status FROM matches ORDER BY video_id').all().map(x=>x.status),['PENDING','CONFIRMED','REJECTED']);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_notifications').get().n,1);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM state WHERE key LIKE 'automatic-match:%'").get().n,2);
 assert.equal((await resolveAutomaticMatches(env,fetcher)).processed,0);assert.equal(calls,1);
});
test('temporary metadata absence defers and backs off without rejecting or needing moderator approval',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]});
 sql.exec('DELETE FROM discovery_notifications; DELETE FROM matches; DELETE FROM videos; DELETE FROM channels;');
 sql.prepare("INSERT OR IGNORE INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(channel,'Bobcat');
 sql.prepare("INSERT INTO videos(id,channel_id,title,available) VALUES('newvideo123',?,'MS BAND / song',1)").run(channel);
 sql.prepare("INSERT INTO matches(performer_id,video_id,status,source) VALUES('missioned-souls','newvideo123','PENDING',?)").run(row.source);
 const env={DB:db,YOUTUBE_API_KEY:'fixture-only'};let calls=0;const fetcher=async()=>{calls++;return Response.json({items:[]});};
 assert.equal((await resolveAutomaticMatches(env,fetcher)).deferred,1);
 assert.equal((await resolveAutomaticMatches(env,fetcher)).processed,0);assert.equal(calls,1);
 assert.equal(sql.prepare("SELECT status FROM matches WHERE video_id='newvideo123'").get().status,'PENDING');
});
test('a concurrent exclusion prevents publication, notification and applied audit',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]});
 sql.exec('DELETE FROM discovery_notifications; DELETE FROM matches; DELETE FROM videos; DELETE FROM channels;');
 sql.prepare("INSERT INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(channel,'Bobcat');
 sql.prepare("INSERT INTO videos(id,channel_id,title,format,available) VALUES('newvideo123',?,'MS BAND / song','FULL_LENGTH',1)").run(channel);
 sql.prepare("INSERT INTO matches(performer_id,video_id,status,source) VALUES('missioned-souls','newvideo123','PENDING',?)").run(row.source);
 const racing={...db,async batch(ops){sql.prepare("INSERT INTO exclusions(performer_id,video_id,reason) VALUES('missioned-souls','newvideo123','Concurrent exclusion')").run();return db.batch(ops);}};
 const result=await resolveAutomaticMatches({DB:racing,YOUTUBE_API_KEY:'fixture-only'},async()=>Response.json({items:[video('MS BAND / song')]}));
 assert.equal(result.published,0);assert.equal(sql.prepare("SELECT status FROM matches WHERE video_id='newvideo123'").get().status,'PENDING');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM state WHERE key LIKE 'automatic-match:%'").get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_notifications').get().n,0);
});
test('new upcoming matches wait and are published automatically once public content is available',async()=>{
 const {db,sql}=releaseFixture();await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]});
 sql.exec('DELETE FROM discovery_notifications; DELETE FROM matches; DELETE FROM videos; DELETE FROM channels;');
 sql.prepare("INSERT INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(channel,'Bobcat');
 const performers=(await db.prepare('SELECT * FROM performers').all()).results;
 const item=video('Missioned Souls reaction');item.snippet.liveBroadcastContent='upcoming';
 await saveVideos(db,[item],performers,new Date().toISOString(),'Recent-upload check');
 assert.equal(sql.prepare("SELECT status FROM matches WHERE video_id='newvideo123'").get().status,'PENDING');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_notifications').get().n,0);
 const result=await resolveAutomaticMatches({DB:db,YOUTUBE_API_KEY:'fixture-only'},async()=>Response.json({items:[video('Missioned Souls reaction')]}));
 assert.equal(result.published,1);
});
