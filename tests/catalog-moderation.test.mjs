import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {seedDatabase,catalog} from '../server/db.mjs';
import {saveVideo} from '../server/discovery.mjs';
import {managePerformers} from '../server/performers.mjs';
import {community} from '../server/community.mjs';
import {recommend} from '../server/recheck.mjs';
const id='abcdefghijk',channel='UC1234567890123456789012';
const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]};
const item={id,snippet:{title:'Missioned Souls COVER',channelId:channel,channelTitle:'New channel',publishedAt:'2026-10-11T00:00:00Z'},contentDetails:{duration:'PT1M'},status:{privacyStatus:'public'}};
async function setup(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 sql.exec('DELETE FROM discovery_notifications;DELETE FROM discovery_observations;DELETE FROM exclusions;DELETE FROM matches;DELETE FROM videos;DELETE FROM state;DELETE FROM performers;');
 let race=null;
 const db={prepare(q){let args=[];return {bind(...v){args=v;return this;},async first(){return sql.prepare(q).get(...args)||null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...args).changes)}};}}},async batch(ops){if(race){const fn=race;race=null;fn();}sql.exec('BEGIN');try{const result=[];for(const op of ops)result.push(await op.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 await seedDatabase(db,seed);const performers=(await db.prepare('SELECT * FROM performers').all()).results;await saveVideo(db,item,performers,new Date().toISOString(),'fixture');
 const call=async(path,body,user={id:'moderator',moderator:true},origin='https://site.test')=>{const response=await managePerformers(new Request('https://site.test/api/performers'+path,body?{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),{DB:db},seed,user);return {status:response.status,data:await response.json()};};
 const body=action=>({videoId:id,action,note:'Verified catalog decision',expectedStatus:'CONFIRMED',expectedSource:'fixture'});
 return {sql,db,performers,call,body,race(fn){race=fn;}};
}
test('moderators can withdraw, hide or delete approvals; refresh preserves all three decisions',async()=>{
 for(const [action,status] of [['unapprove','PENDING'],['hide','HIDDEN'],['delete','REJECTED']]){
  const s=await setup();assert.equal((await catalog(s.db,seed,{})).videos.length,1);
  assert.equal((await s.call('/catalog-action',s.body(action))).status,200);
  assert.equal((await catalog(s.db,seed,{})).videos.length,0);
  await saveVideo(s.db,item,s.performers,new Date().toISOString(),'refresh');
  assert.equal(s.sql.prepare('SELECT status FROM matches WHERE video_id=?').get(id).status,status);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM videos WHERE id=?').get(id).n,1);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM exclusions WHERE video_id=?').get(id).n,action==='delete'?1:0);
  const history=await s.call('/catalog-history?videoId='+id);assert.equal(history.data.items[0].action,action);assert.equal(history.data.items[0].before.status,'CONFIRMED');assert.equal(history.data.items[0].after.status,status);
  const list=await s.call('/catalog-management?q='+id);assert.equal(list.data.items[0].status,status);
  if(action==='unapprove')assert.equal(recommend({source:list.data.items[0].source,review_mode:'auto'},item).outcome,'protected');
 }
});
test('catalog controls enforce access, origin, reasons, exclusions and stale decisions',async()=>{
 const s=await setup(),body=s.body('hide');
 assert.equal((await s.call('/catalog-management',null,{id:'member',moderator:false})).status,403);
 assert.equal((await s.call('/catalog-action',body,{id:'member',moderator:false})).status,403);
 assert.equal((await s.call('/catalog-action',body,undefined,'https://elsewhere.test')).status,403);
 assert.equal((await s.call('/catalog-action',{...body,note:'x'})).status,400);
 assert.equal((await s.call('/catalog-action',{...body,expectedSource:'old'})).status,409);
 s.sql.prepare("INSERT INTO exclusions VALUES('missioned-souls',?,'Existing moderator rejection')").run(id);
 assert.equal((await s.call('/catalog-action',body)).status,409);
 assert.equal(s.sql.prepare("SELECT COUNT(*) n FROM state WHERE key LIKE 'catalog-audit:%'").get().n,0);
});
test('a concurrent moderator decision or exclusion cannot be overwritten or falsely audited',async()=>{
 for(const kind of ['status','exclusion']){
  const s=await setup();s.race(()=>kind==='status'?s.sql.prepare("UPDATE matches SET status='PENDING',source='Manual hold' WHERE video_id=?").run(id):s.sql.prepare("INSERT INTO exclusions VALUES('missioned-souls',?,'Concurrent exclusion')").run(id));
  assert.equal((await s.call('/catalog-action',s.body('delete'))).status,409);
  assert.equal(s.sql.prepare("SELECT COUNT(*) n FROM state WHERE key LIKE 'catalog-audit:%'").get().n,0);
  assert.equal(s.sql.prepare('SELECT status FROM matches WHERE video_id=?').get(id).status,kind==='status'?'PENDING':'CONFIRMED');
 }
});
test('broad rechecks accept title matches on new channels and retain ambiguous or protected cases',()=>{
 const row={source:'fixture',review_mode:'auto',channel_id:channel,aliases:'["Missioned Souls"]',format:'SHORT',known_reactor:0};
 for(const duration of ['PT1M',undefined])assert.equal(recommend(row,{...item,contentDetails:{duration}}).outcome,'strong');
 assert.notEqual(recommend(row,{...item,snippet:{...item.snippet,title:'Missioned Souls Watch Party'}}).outcome,'strong');
 assert.equal(recommend({...row,source:'Moderator catalog unapprove:abc'},item).outcome,'protected');
 assert.equal(recommend({...row,review_mode:'review'},item).outcome,'protected');
 assert.equal(recommend(row,{...item,snippet:{...item.snippet,channelId:'wrong'}}).outcome,'protected');
});

test('hidden, unapproved and deleted catalog entries can be explicitly restored with history',async()=>{
 for(const action of ['hide','unapprove','delete']){
  const s=await setup();await s.call('/catalog-action',s.body(action));
  s.sql.prepare("INSERT INTO members(id,name,created_at) VALUES('moderator','Moderator',?)").run(new Date().toISOString());
  const body={videoId:id,title:item.snippet.title,channelId:channel,channelName:'New channel',format:'UNKNOWN',note:'Verified full reaction for restoration',restore:true};
  const response=await community(new Request('https://site.test/api/community/catalog-video/update',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(body)}),{DB:s.db},seed,{id:'moderator',moderator:true});
  assert.equal(response.status,200);assert.equal((await catalog(s.db,seed,{})).videos.length,1);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM exclusions WHERE video_id=?').get(id).n,0);
  const restored=JSON.parse(s.sql.prepare('SELECT before_json FROM video_corrections WHERE video_id=?').get(id).before_json);
  assert.equal(restored.decision.status,{hide:'HIDDEN',unapprove:'PENDING',delete:'REJECTED'}[action]);
 }
});

test('automatic review pagination reaches every pending video without loading service details',async()=>{
 const s=await setup();s.sql.prepare("UPDATE matches SET status='PENDING'").run();
 for(let i=0;i<54;i++){
  const videoId='queue'+String(i).padStart(6,'0');
  s.sql.prepare("INSERT INTO videos(id,channel_id,title,format,available) VALUES(?,?,?,'UNKNOWN',1)").run(videoId,channel,'Missioned Souls reaction '+i);
  s.sql.prepare("INSERT INTO matches VALUES('missioned-souls',?,'PENDING','fixture')").run(videoId);
 }
 const seen=new Set();
 for(const [offset,size,more] of [[0,25,true],[25,25,true],[50,5,false]]){
  const r=await s.call('/notifications?group=all&offset='+offset);assert.equal(r.status,200);assert.equal(r.data.items.length,size);assert.equal(r.data.hasMore,more);assert.equal(r.data.count,55);assert.equal(r.data.push,undefined);
  for(const row of r.data.items){assert.equal(seen.has(row.video_id),false);seen.add(row.video_id);}
 }
 assert.equal(seen.size,55);
 const summary=await s.call('/notifications?summary=1');assert.equal(summary.data.count,55);assert.equal(summary.data.items,undefined);
 const service=await s.call('/notifications?service=1');assert.ok(service.data.push);assert.equal(service.data.items,undefined);
});
