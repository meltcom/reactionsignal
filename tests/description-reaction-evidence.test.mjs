import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reactionEvidence,explicitDescriptionReaction} from '../server/approval-rules.mjs';
import {automaticMatch} from '../server/automatic-matches.mjs';
import {historicalReaction} from '../server/backfill-broker.mjs';
import {classify,saveVideos} from '../server/discovery.mjs';
import {recommend} from '../server/recheck.mjs';
import {releaseFixture} from './release-fixture.mjs';
import {seedDatabase} from '../server/db.mjs';

const fixtures=JSON.parse(readFileSync(new URL('./fixtures/description-reaction-evidence.json',import.meta.url),'utf8'));
const aliases=['Missioned Souls'];
const performer={id:'missioned-souls',aliases:JSON.stringify(aliases),review_mode:'auto'};
const channel=fixtures[0].channelId;
const row={...performer,performer_id:performer.id,channel_id:channel,discovery_scope:'eligible',source:'Recent-upload check',format:'FULL_LENGTH',other_aliases:'[]'};
const cutoff=Date.parse('2026-11-18T14:00:00Z');
const video=(title,description)=>({id:'fixture1234',snippet:{title,description,channelId:channel,publishedAt:'2025-01-20T10:00:50Z'},status:{privacyStatus:'public'},contentDetails:{duration:'PT6M39S'}});

for(const fixture of fixtures)test(`description-only real case: ${fixture.id}`,()=>{
 const item={...video(fixture.title,fixture.description),id:fixture.id};
 assert.equal(explicitDescriptionReaction(fixture.title,aliases,fixture.description),true);
 assert.equal(classify(fixture.title,aliases,399,{description:fixture.description}),'CONFIRMED');
 assert.equal(automaticMatch(row,item).status,'CONFIRMED');
 assert.equal(historicalReaction(performer,item,channel,cutoff),true);
 assert.equal(recommend(row,item).outcome,'strong');
});

const negatives=[
 ['tag only','A family band surprised me','#MissionedSouls #reaction'],
 ['tagged heading','A family band surprised me','# REACTING TO Missioned Souls'],
 ['inline tag','A family band surprised me','REACTING TO #Missioned Souls'],
 ['original link','A family band surprised me','Original video: Reacting to Missioned Souls https://example.com/watch'],
 ['URL split bait','A family band surprised me','https://example.com/REACTING-TO-Missioned-Souls'],
 ['credit header','A family band surprised me','Credits: Reacting to Missioned Souls'],
 ['separate sentences','A family band surprised me','Reacting to another band. Missioned Souls is credited below.'],
 ['separate lines','A family band surprised me','REACTING TO another band\nMissioned Souls'],
 ['semicolon aside','A family band surprised me','Reacting to another band; Missioned Souls inspired me.'],
 ['generic disclaimer','A family band surprised me','I am reacting to the video, critiquing it, and giving constructive feedback.\nARTIST: Missioned Souls'],
 ['copyright statement','A family band surprised me','Reacting to Missioned Souls under the copyright fair use disclaimer.'],
 ['future plan','A family band surprised me','Tomorrow I will be reacting to Missioned Souls.'],
 ['future suffix','A family band surprised me','Reacting to Missioned Souls next week.'],
 ['request','A family band surprised me','Please react to Missioned Souls.'],
 ['imperative request','A family band surprised me','React to Missioned Souls.'],
 ['negated target','A family band surprised me','Reacting to another band, not Missioned Souls.'],
 ['incidental comparison','A family band surprised me','Reacting to another band inspired by Missioned Souls.'],
 ['third-party statement','A family band surprised me','My friend is reacting to Missioned Souls.'],
 ['quoted statement','A family band surprised me','"Reacting to Missioned Souls" is what the other channel wrote.'],
 ['performer substring','A family band surprised me','Reacting to Missioned Soulsmates.'],
 ['interview framing','Interview with a talented family','REACTING TO Missioned Souls'],
 ['tribute framing','A tribute to a talented family','REACTING TO Missioned Souls'],
 ['AI profile framing','An AI narrated biography','REACTING TO Missioned Souls'],
 ['promotion framing','Trailer for my next upload','REACTING TO Missioned Souls'],
 ['watch-party framing','Watch party today','REACTING TO Missioned Souls'],
];
for(const [name,title,description] of negatives)test(`description-only false-positive protection: ${name}`,()=>{
 assert.equal(reactionEvidence(title,aliases,description),false);
 assert.equal(automaticMatch(row,video(title,description)).status,'REJECTED');
 assert.equal(historicalReaction(performer,video(title,description),channel,cutoff),false);
 assert.notEqual(recommend(row,video(title,description)).outcome,'strong');
});

test('explicit first-person and Unicode sentence separators work without combining unrelated sentences',()=>{
 for(const prefix of ['I am reacting to','We are reacting to','Today, reacting to','In this video, we are reacting to']){
  assert.equal(reactionEvidence('This family surprised me',aliases,prefix+' Missioned Souls.'),true,prefix);
 }
 assert.equal(reactionEvidence('This family surprised me',aliases,'Source: other band\u2028REACTING TO Missioned Souls'),true);
 assert.equal(reactionEvidence('This family surprised me',aliases,'REACTING TO another band\u2028Missioned Souls'),false);
});

test('existing title and title-plus-narrative routes retain their behavior',()=>{
 assert.equal(reactionEvidence('Missioned Souls cover',aliases,''),true);
 assert.equal(reactionEvidence('My first reaction',aliases,'My reaction to Missioned Souls is here.'),true);
 assert.equal(historicalReaction(performer,video('Missioned Souls cover',''),channel,cutoff),false);
 assert.equal(reactionEvidence('This family surprised me',aliases,'My channel does reactions to Missioned Souls.'),false);
});

test('description-only evidence does not bypass privacy, channel identity, manual policy or the history cutoff',()=>{
 const f=fixtures[0],item=video(f.title,f.description);
 assert.equal(automaticMatch({...row,source:'Moderator catalog unapprove'},item).status,null);
 assert.equal(automaticMatch({...row,review_mode:'review'},item).status,null);
 assert.equal(automaticMatch({...row,channel_id:'different'},item).status,null);
 assert.equal(automaticMatch(row,{...item,status:{privacyStatus:'private'}}).status,null);
 assert.equal(automaticMatch(row,{...item,snippet:{...item.snippet,liveBroadcastContent:'upcoming'}}).deferred,true);
 assert.equal(historicalReaction(performer,item,channel,Date.parse('2024-01-01T00:00:00Z')),false);
});

test('fresh-discovery save publishes a new description-only reaction and preserves an excluded counterpart',async()=>{
 const {db,sql}=releaseFixture();
 try{
  await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]});
  sql.exec('DELETE FROM discovery_notifications; DELETE FROM matches; DELETE FROM videos; DELETE FROM channels;');
  sql.prepare("INSERT INTO channels(id,name,discovery_scope) VALUES(?,?,'eligible')").run(channel,'VI3ION');
  const items=fixtures.map(f=>({...video(f.title,f.description),id:f.id}));
  sql.prepare("INSERT INTO exclusions(performer_id,video_id,reason) VALUES('missioned-souls',?,'Preserve existing decision')").run(items[1].id);
  const performers=(await db.prepare('SELECT * FROM performers').all()).results;
  await saveVideos(db,items,performers,'2026-11-18T14:00:00Z','Recent-upload check');
  assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get(items[0].id)?.status,'CONFIRMED');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches WHERE video_id=?').get(items[1].id).n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_notifications WHERE video_id=?').get(items[0].id).n,1);
 }finally{sql.close();}
});
