import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authConfig,authenticate} from '../server/auth.mjs';
import {seedDatabase,importDiscoveryRun} from '../server/db.mjs';
import {recheckVideoFormats} from '../server/format-recheck.mjs';
import {releaseFixture} from './release-fixture.mjs';

const channel='UC'+'x'.repeat(22);
const publicEnv={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
const jwt=role=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({role})).toString('base64url'),'fixture_signature'].join('.');
const invalidKeys=['sb_secret_fixture',jwt('service_role'),jwt('authenticated'),'fixture-key','sb_publishable_','a.not-json.sig',jwt('anon')+'.extra','','sb_publishable_fixture\n'];

test('public auth configuration accepts publishable and legacy anon keys only',()=>{
 for(const key of ['sb_publishable_fixture',jwt('anon')])assert.equal(authConfig({...publicEnv,SUPABASE_PUBLISHABLE_KEY:key})?.key,key);
 for(const key of invalidKeys)assert.equal(authConfig({...publicEnv,SUPABASE_PUBLISHABLE_KEY:key}),null,'Rejected key type or malformed value');
});

test('invalid public auth keys are never returned by the public endpoint or used for identity lookup',async()=>{
 const worker=(await import('../dist/server/index.js')).default;
 for(const key of invalidKeys){
  const env={...publicEnv,SUPABASE_PUBLISHABLE_KEY:key};
  const response=await worker.fetch(new Request('https://fixture.test/api/auth/config'),env,{});
  assert.deepEqual(await response.json(),{configured:false});
  let lookups=0;
  const result=await authenticate(new Request('https://fixture.test/api/auth/me',{headers:{Authorization:'Bearer fixture.token'}}),env,async()=>{lookups++;throw Error('Invalid config must not be sent upstream');});
  assert.equal(result.error.status,503);assert.equal(lookups,0);
 }
 const response=await worker.fetch(new Request('https://fixture.test/api/auth/config'),publicEnv,{});
 assert.deepEqual(await response.json(),{url:publicEnv.SUPABASE_URL,key:publicEnv.SUPABASE_PUBLISHABLE_KEY});
});

function video(id,confidence='CONFIRMED'){
 return {id,channelId:channel,channelName:'Fixture reactor',performerId:'missioned-souls',title:'Missioned Souls reaction',publishedAt:'2026-10-01T00:00:00Z',format:'FULL_LENGTH',confidence};
}
function setup(){
 const fixture=releaseFixture();
 fixture.sql.prepare('INSERT OR IGNORE INTO performers(id,name,aliases) VALUES(?,?,?)').run('missioned-souls','Missioned Souls','["Missioned Souls"]');
 fixture.sql.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').run(channel,'Fixture reactor');
 return fixture;
}
function existing(sql,v,status,source){
 sql.prepare('INSERT INTO videos(id,channel_id,title,published_at,format) VALUES(?,?,?,?,?)').run(v.id,channel,v.title,v.publishedAt,'FULL_LENGTH');
 if(status)sql.prepare('INSERT INTO matches(performer_id,video_id,status,source) VALUES(?,?,?,?)').run('missioned-souls',v.id,status,source);
}

test('new discovery imports preserve every existing decision and exclusion while adding missing matches',async()=>{
 const {sql,db}=setup();
 try{
  const statuses=['CONFIRMED','PROBABLE','PENDING','REJECTED'];
  const videos=statuses.map((status,i)=>video('import'+String(i).padStart(5,'0'),status==='CONFIRMED'?'PENDING':'CONFIRMED'));
  videos.forEach((v,i)=>existing(sql,v,statuses[i],'Moderator decision '+i));
  sql.prepare('UPDATE videos SET format_locked=1 WHERE id=?').run(videos[0].id);
  const excluded=video('excluded001'),fresh=video('fresh000001'),probable=video('probable001','PROBABLE');
  existing(sql,excluded);
  sql.prepare('INSERT INTO exclusions(performer_id,video_id,reason) VALUES(?,?,?)').run('missioned-souls',excluded.id,'Moderator exclusion');
  const run={id:'safeguard-import',startedAt:'2026-10-25T00:00:00Z',channels:[],videos:[...videos,excluded,fresh,probable],possibleDuplicates:[],rejectedThisRun:[]};
  await importDiscoveryRun(db,run);
  for(const [i,v] of videos.entries())assert.deepEqual({...sql.prepare('SELECT status,source FROM matches WHERE video_id=?').get(v.id)},{status:statuses[i],source:'Moderator decision '+i});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches WHERE video_id=?').get(excluded.id).n,0);
  assert.equal(sql.prepare('SELECT reason FROM exclusions WHERE video_id=?').get(excluded.id).reason,'Moderator exclusion');
  assert.equal(sql.prepare('SELECT format_locked FROM videos WHERE id=?').get(videos[0].id).format_locked,1);
  const imported=sql.prepare('SELECT status,source FROM matches WHERE video_id=?').get(fresh.id);
  assert.equal(imported.status,'CONFIRMED');assert.match(imported.source,/safeguard-import/);
  assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get(probable.id).status,'PROBABLE');
  assert.ok(sql.prepare('SELECT value FROM state WHERE key=?').get('import:'+run.id));
  assert.ok(sql.prepare('SELECT value FROM state WHERE key=?').get('import-audit:'+run.id));
  await importDiscoveryRun(db,{...run,videos:[video('retry000001')]});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM videos WHERE id=?').get('retry000001').n,0);
  await importDiscoveryRun(db,{...run,id:'next-import',videos:[video(fresh.id,'REJECTED')]});
  assert.deepEqual({...sql.prepare('SELECT status,source FROM matches WHERE video_id=?').get(fresh.id)},{...imported});
 }finally{sql.close();}
});

test('initial seeding preserves existing decisions and exclusions and adds genuinely new matches',async()=>{
 const {sql,db}=setup();
 try{
  sql.prepare("DELETE FROM state WHERE key='seed-v2'").run();
  const held=video('seedheld001'),excluded=video('seedexcl001'),fresh=video('seednew0001');
  existing(sql,held,'REJECTED','Moderator hold');existing(sql,excluded);
  sql.prepare('INSERT INTO exclusions(performer_id,video_id,reason) VALUES(?,?,?)').run('missioned-souls',excluded.id,'Keep excluded');
  await seedDatabase(db,{performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[{id:channel,name:'Fixture reactor'}],videos:[held,excluded,fresh]});
  assert.deepEqual({...sql.prepare('SELECT status,source FROM matches WHERE video_id=?').get(held.id)},{status:'REJECTED',source:'Moderator hold'});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches WHERE video_id=?').get(excluded.id).n,0);
  assert.equal(sql.prepare('SELECT reason FROM exclusions WHERE video_id=?').get(excluded.id).reason,'Keep excluded');
  assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get(fresh.id).status,'CONFIRMED');
  assert.ok(sql.prepare("SELECT value FROM state WHERE key='seed-v2'").get());
 }finally{sql.close();}
});

test('format recheck counts only resolved changes, including concurrent lock and availability changes',async()=>{
 const {sql,db}=setup();
 try{
  // Historical migration fixtures are unrelated to this batch.
  sql.exec("UPDATE videos SET format_locked=1");
  const kinds=['short','full','unknown','wrong-channel','private','missing','locked-during-fetch','unavailable-during-fetch'];
  const videos=kinds.map((kind,i)=>video('format'+String(i).padStart(5,'0')));
  for(const v of videos){existing(sql,v,'CONFIRMED','Fixture decision');sql.prepare("UPDATE videos SET format='UNKNOWN' WHERE id=?").run(v.id);}
  let calls=0;
  const response=await recheckVideoFormats({DB:db,YOUTUBE_API_KEY:'fixture'},async url=>{
   calls++;assert.equal(url.searchParams.get('id').split(',').length,kinds.length);
   sql.prepare('UPDATE videos SET format_locked=1 WHERE id=?').run(videos[6].id);
   sql.prepare('UPDATE videos SET available=0 WHERE id=?').run(videos[7].id);
   return Response.json({items:videos.flatMap((v,i)=>{
    const kind=kinds[i];if(kind==='missing')return [];
    return [{id:v.id,snippet:{channelId:kind==='wrong-channel'?'UCwrong':channel,title:v.title,publishedAt:v.publishedAt},status:{privacyStatus:kind==='private'?'private':'public'},contentDetails:{duration:kind==='unknown'?'':'PT1M'},player:{embedWidth:kind==='short'?270:480,embedHeight:kind==='short'?480:270}}];
   })});
  });
  assert.equal(calls,1);assert.equal(response.processed,kinds.length);assert.equal(response.updated,2);
  assert.equal(sql.prepare('SELECT format FROM videos WHERE id=?').get(videos[0].id).format,'SHORT');
  assert.equal(sql.prepare('SELECT format FROM videos WHERE id=?').get(videos[1].id).format,'FULL_LENGTH');
  for(const v of videos.slice(2))assert.equal(sql.prepare('SELECT format FROM videos WHERE id=?').get(v.id).format,'UNKNOWN');
  assert.equal(JSON.parse(sql.prepare("SELECT value FROM state WHERE key='format-recheck-last'").get().value).updated,2);
  for(const v of videos)assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get(v.id).status,'CONFIRMED');
 }finally{sql.close();}
});
