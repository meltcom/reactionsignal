import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {community,youtubeId,tier} from '../server/community.mjs';
import {seedDatabase,catalog} from '../server/db.mjs';
import {managePerformers} from '../server/performers.mjs';
import {social} from '../server/social.mjs';
import {saveVideo} from '../server/discovery.mjs';
const channel='UC1234567890123456789012';
const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]};
async function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
 const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 await seedDatabase(db,seed);
 const env={DB:db,COMMUNITY_MODERATOR_EMAILS:'owner@example.com'};
 async function call(path,body,user='fan',extra={}){const response=await community(new Request(`https://pilot.test/api/community${path}`,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user==='owner'?'owner@example.com':`${user}@example.com`}:{}),'Origin':'https://pilot.test','Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})}),env,seed,user?{id:user,moderator:user==='owner'}:null);return {status:response.status,data:await response.json()};}
 for(const user of ['owner','fan','other'])assert.equal((await call('/profile',{name:user},user)).status,200);
 function video(id='abcdefghijk'){sql.prepare('INSERT OR IGNORE INTO videos(id,channel_id,title,format,available) VALUES(?,?,?,\'UNKNOWN\',1)').run(id,channel,'Missioned Souls reaction');sql.prepare("INSERT OR IGNORE INTO matches VALUES('missioned-souls',?,'CONFIRMED','test')").run(id);}
 const points=user=>Number(sql.prepare('SELECT COALESCE(SUM(amount),0) n FROM points WHERE user_id=?').get(user).n);
 return {sql,call,video,points,env,db};
}
test('requires verified identity, same origin, and server-side moderator authorization',async()=>{const {call}=await setup();assert.equal((await call('/summary',null,null)).status,401);assert.equal((await call('/profile',{name:'unsafe'},'fan',{Origin:'https://evil.test'})).status,403);assert.equal((await call('/queue',null,'fan')).status,403);assert.equal((await call('/moderate',{id:'x',moderator:true},'fan')).status,403);});
test('ratings are one per user and video; first-rating points have a daily cap',async()=>{const {call,video,points}=await setup();for(let i=0;i<12;i++){const id=String(i).padStart(11,'0');video(id);assert.equal((await call('/rating',{videoId:id,performerId:'missioned-souls',score:5})).status,200);}assert.equal(points('fan'),10);assert.equal((await call('/rating',{videoId:'00000000000',performerId:'missioned-souls',score:1})).status,200);assert.equal(points('fan'),10);const r=await call('/summary');const s=r.data.scores.find(x=>x.video_id==='00000000000');assert.equal(s.count,1);assert.equal(s.average,1);assert.equal((await call('/rating',{videoId:'00000000000',performerId:'missioned-souls',score:6})).status,400);});
test('comments remain private until accepted; hiding reverses points exactly once',async()=>{const {call,video,points}=await setup();video();const body={kind:'comment',performerId:'missioned-souls',videoId:'abcdefghijk',body:'A detailed and thoughtful reaction.'};assert.equal((await call('/contribute',body)).status,200);assert.equal((await call('/contribute',body)).status,409);assert.equal((await call('/video?id=abcdefghijk')).data.comments.length,0);const id=(await call('/summary')).data.mine[0].id;assert.equal((await call('/moderate',{id,decision:'accept',note:'Constructive relevant comment'},'owner')).status,200);assert.equal(points('fan'),3);assert.equal((await call('/video?id=abcdefghijk')).data.comments.length,1);assert.equal((await call('/moderate',{id,decision:'accept',note:'Approve a second time'},'owner')).status,409);assert.equal((await call('/moderate',{id,decision:'hide',note:'Spam discovered after review'},'owner')).status,200);assert.equal(points('fan'),0);assert.equal((await call('/video?id=abcdefghijk')).data.comments.length,0);});
test('submitted videos are canonicalized and only published after verified approval',async()=>{const {call,sql,points}=await setup();const body={kind:'submission',performerId:'missioned-souls',url:'https://youtu.be/abcdefghijk?t=5',body:'This new reaction features Missioned Souls.'};assert.equal((await call('/contribute',body)).status,200);assert.equal((await call('/contribute',{...body,url:'https://www.youtube.com/watch?v=abcdefghijk'},'other')).status,409);assert.equal(sql.prepare("SELECT COUNT(*) n FROM videos WHERE id='abcdefghijk'").get().n,0);const id=(await call('/summary')).data.mine[0].id;assert.equal((await call('/moderate',{id,decision:'accept',note:'Verified on YouTube'},'owner')).status,400);assert.equal((await call('/moderate',{id,decision:'accept',note:'Verified full reaction on YouTube',title:'Missioned Souls reaction',channelName:'Sample reactor',channelId:channel},'owner')).status,200);assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get('abcdefghijk').status,'CONFIRMED');assert.equal(points('fan'),20);assert.equal((await call('/contribute',body,'other')).status,409);});
test('confirmed flag excludes only the selected match and rewards one correction',async()=>{const {call,video,sql,points}=await setup();video();for(const user of ['fan','other'])assert.equal((await call('/contribute',{kind:'flag',performerId:'missioned-souls',videoId:'abcdefghijk',reason:'wrong-performer',body:'This video features another performer.'},user)).status,200);const id=(await call('/summary')).data.mine[0].id;assert.equal((await call('/moderate',{id,decision:'accept',note:'Confirmed another performer'},'owner')).status,200);assert.equal(points('fan'),10);assert.equal(sql.prepare("SELECT COUNT(*) n FROM videos WHERE id='abcdefghijk'").get().n,1);assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get('abcdefghijk').status,'REJECTED');const other=(await call('/summary',null,'other')).data.mine[0].id;assert.equal((await call('/moderate',{id:other,decision:'accept',note:'Duplicate flag accepted'},'owner')).status,409);assert.equal(points('other'),0);});
test('self approvals do not award points; prior exclusions cannot be submitted',async()=>{const {call,video,points}=await setup();video();await call('/contribute',{kind:'comment',performerId:'missioned-souls',videoId:'abcdefghijk',body:'The owner can test a thoughtful comment.'},'owner');const id=(await call('/summary',null,'owner')).data.mine[0].id;assert.equal((await call('/moderate',{id,decision:'accept',note:'Owner test comment approval'},'owner')).status,200);assert.equal(points('owner'),0);assert.equal((await call('/contribute',{kind:'submission',performerId:'missioned-souls',url:'https://youtu.be/pwNtcFZ_59I',body:'Previously excluded reaction video.'})).status,409);});
test('only YouTube HTTPS video URLs accepted and tier thresholds are explicit',()=>{assert.equal(youtubeId('https://youtube.com/shorts/P69VWMewzQY'),'P69VWMewzQY');for(const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk','http://youtu.be/abcdefghijk','https://evil.test/abcdefghijk','https://youtu.be/a','https://u:p@youtu.be/abcdefghijk'])assert.equal(youtubeId(url),null);assert.equal(tier(100),'Reaction scout');assert.equal(tier(0),'Novice');});
test('performer recommendations remain closed with no writes and moderator-only queues',async()=>{
 const {call,sql}=await setup();const before=sql.prepare('SELECT COUNT(*) n FROM coverage_requests').get().n;
 for(const user of ['fan','other','owner']){
  assert.equal((await call('/coverage',{name:'Franz Rhythm',url:'https://youtube.com/@FranzRhythm',body:'Please cover these performances.'},user)).status,400);
  assert.deepEqual((await call('/coverage',null,user)).data.items,[]);
 }
 assert.equal((await call('/coverage/queue',null,'fan')).status,403);
 assert.deepEqual((await call('/coverage/queue',null,'owner')).data.items,[]);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM coverage_requests').get().n,before);
});
test('closed recommendations reject unsafe links and cannot be reopened through review',async()=>{
 const {call,sql}=await setup();
 for(const url of ['http://example.com','javascript:alert(1)','https://user:password@example.com'])assert.equal((await call('/coverage',{name:'Another performer',url,body:'Please add this performer.'})).status,400);
 assert.equal((await call('/coverage/review',{id:'old',decision:'shortlisted',note:'Review a former suggestion'},'owner')).status,400);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM coverage_requests').get().n,0);
});
test('moderators can edit Missioned Souls but cannot onboard additional performers',async()=>{
 const {env,db}=await setup();
 const api=async(path,body,user='owner',origin='https://pilot.test')=>{
  const r=await managePerformers(new Request('https://pilot.test/api/performers'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,seed,{id:user,moderator:user==='owner'});return {status:r.status,data:await r.json()};
 };
 const before=(await db.prepare('SELECT COUNT(*) n FROM performers').first()).n;
 assert.equal((await api('/list',null,'fan')).status,403);
 const payload={id:'missioned-souls',name:'Missioned Souls',officialUrl:'https://missionedsoulsofficial.com',aliases:['Missioned Souls'],lookbackDays:90,reviewMode:'review',status:'active',discoveryEnabled:true,chatEnabled:true};
 assert.equal((await api('/save',payload,'owner','https://evil.test')).status,403);
 assert.equal((await api('/save',payload,'fan')).status,403);
 assert.equal((await api('/save',{...payload,id:undefined,name:'Franz Rhythm'})).status,400);
 assert.equal((await api('/save',{...payload,id:'new-act',name:'New Act'})).status,400);
 assert.equal((await api('/save',payload)).status,200);
 assert.equal((await db.prepare("SELECT review_mode FROM performers WHERE id='missioned-souls'").first()).review_mode,'review');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM performers').first()).n,before);
 assert.equal((await api('/results?id=new-act')).status,400);
});

test('moderators can correct catalog channel details with history and without altering decisions',async()=>{
 const {call,video,sql,points}=await setup();
 sql.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').run(channel,'Original reactor');video();
 const newChannel='UCabcdefghijklmnopqrstuv';
 const correction={videoId:'abcdefghijk',title:'Correct reaction title',channelName:'Correct reactor',channelId:newChannel,publishedAt:'2026-01-01',format:'FULL_LENGTH',note:'Corrected wrong submitted channel'};
 assert.equal((await call('/catalog-video?video=abcdefghijk',null,'fan')).status,403);
 assert.equal((await call('/catalog-video/update',correction,'fan')).status,403);
 assert.equal((await call('/catalog-video/update',{...correction,channelId:'invalid'},'owner')).status,400);
 sql.prepare("INSERT INTO exclusions(performer_id,video_id,reason) VALUES('missioned-souls',?,'Retained exclusion')").run('abcdefghijk');
 assert.equal((await call('/catalog-video/update',correction,'owner')).status,200);
 const row=sql.prepare('SELECT * FROM videos WHERE id=?').get('abcdefghijk');assert.equal(row.channel_id,newChannel);assert.equal(row.title,correction.title);assert.equal(row.format_locked,1);
 assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get('abcdefghijk').status,'CONFIRMED');
 assert.equal(sql.prepare('SELECT reason FROM exclusions WHERE video_id=?').get('abcdefghijk').reason,'Retained exclusion');
 assert.equal(points('fan'),0);assert.equal(points('owner'),0);
 const result=await call('/catalog-video?video=https%3A%2F%2Fyoutu.be%2Fabcdefghijk',null,'owner');assert.equal(result.status,200);assert.equal(result.data.video.channelName,'Correct reactor');assert.equal(result.data.history.length,1);assert.equal(JSON.parse(result.data.history[0].before_json).channel_id,channel);
 assert.equal((await call('/catalog-video/update',{...correction,channelName:'Rename shared channel'},'owner')).status,409);
});
test('approval fixes an existing wrong video channel instead of retaining it',async()=>{
 const {call,sql}=await setup();
 await call('/contribute',{kind:'submission',performerId:'missioned-souls',url:'https://youtu.be/abcdefghijk',body:'This is a new Missioned Souls reaction.'});
 const id=(await call('/summary')).data.mine[0].id;
 sql.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').run(channel,'Wrong reactor');
 sql.prepare("INSERT INTO videos(id,channel_id,title,format,available) VALUES(?,?,?,'UNKNOWN',1)").run('abcdefghijk',channel,'Incorrect title');
 const correct='UCabcdefghijklmnopqrstuv';
 assert.equal((await call('/moderate',{id,decision:'accept',note:'Verified correct YouTube channel',title:'Verified reaction title',channelId:correct,channelName:'Correct reactor'},'owner')).status,200);
 assert.equal(sql.prepare('SELECT channel_id FROM videos WHERE id=?').get('abcdefghijk').channel_id,correct);
});

test('correction uses verified YouTube metadata over incorrect form channel',async()=>{
 const {call,video,sql,env}=await setup();sql.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').run(channel,'Wrong reactor');video();
 env.YOUTUBE_API_KEY='test-key';const actual='UCabcdefghijklmnopqrstuv';
 sql.prepare('INSERT INTO state(key,value) VALUES(?,?)').run('submission-metadata:abcdefghijk',JSON.stringify({title:'Actual YouTube title',channelName:'Actual reactor',channelId:actual,publishedAt:'2026-01-02T00:00:00Z',format:'UNKNOWN',fetchedAt:Date.now()}));
 assert.equal((await call('/catalog-video/update',{videoId:'abcdefghijk',title:'Wrong title',channelId:channel,channelName:'Wrong reactor',format:'SHORT',note:'Refresh incorrect channel from YouTube'},'owner')).status,200);
 const row=sql.prepare('SELECT * FROM videos WHERE id=?').get('abcdefghijk');assert.equal(row.channel_id,actual);assert.equal(row.title,'Actual YouTube title');assert.equal(row.format,'SHORT');
});

test('correction restore confirms only Missioned Souls and records the reversed decision',async()=>{
 const {call,video,sql,db,points}=await setup();sql.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').run(channel,'Original reactor');video();
 sql.exec("UPDATE matches SET status='REJECTED' WHERE video_id='abcdefghijk'; INSERT INTO exclusions VALUES('missioned-souls','abcdefghijk','Community review: duplicate. wrong reactor listed'); INSERT INTO performers(id,name,status,aliases) VALUES('another-band','Another band','active','[]'); INSERT INTO matches VALUES('another-band','abcdefghijk','REJECTED','test'); INSERT INTO exclusions VALUES('another-band','abcdefghijk','Keep other exclusion');");
 const body={videoId:'abcdefghijk',title:'Correct reaction title',channelId:channel,channelName:'Original reactor',format:'FULL_LENGTH',note:'Verified channel; reverse mistaken removal',restore:true};
 const loaded=await call('/catalog-video?video=abcdefghijk',null,'owner');assert.equal(loaded.data.decision.status,'REJECTED');assert.match(loaded.data.decision.exclusionReason,/wrong reactor/);
 assert.equal((await call('/catalog-video/update',body,'fan')).status,403);
 assert.equal((await call('/catalog-video/update',{...body,note:''},'owner')).status,400);
 assert.equal((await call('/catalog-video/update',{...body,restore:'true'},'owner')).status,400);
 const restored=await call('/catalog-video/update',body,'owner');assert.equal(restored.status,200);assert.equal(restored.data.eligible,true);
 assert.equal(sql.prepare("SELECT status FROM matches WHERE video_id=? AND performer_id='missioned-souls'").get(body.videoId).status,'CONFIRMED');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM exclusions WHERE video_id=? AND performer_id='missioned-souls'").get(body.videoId).n,0);
 assert.equal(sql.prepare("SELECT reason FROM exclusions WHERE video_id=? AND performer_id='another-band'").get(body.videoId).reason,'Keep other exclusion');
 assert.ok((await catalog(db,seed,{})).videos.some(v=>v.id===body.videoId));
 const history=(await call('/catalog-video?video=abcdefghijk',null,'owner')).data.history[0];assert.equal(history.moderator_id,'owner');assert.equal(JSON.parse(history.before_json).decision.status,'REJECTED');assert.equal(JSON.parse(history.after_json).action,'restore-and-confirm');assert.equal(points('owner'),0);
});
test('correction restore does not publish unavailable or unmatched videos',async()=>{
 const {call,video,sql}=await setup();sql.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').run(channel,'Original reactor');video();
 const body={videoId:'abcdefghijk',title:'Correct reaction title',channelId:channel,channelName:'Original reactor',format:'FULL_LENGTH',note:'Verified restoration reason',restore:true};
 sql.prepare('UPDATE videos SET available=0 WHERE id=?').run(body.videoId);assert.equal((await call('/catalog-video/update',body,'owner')).status,409);
 sql.prepare('UPDATE videos SET available=1 WHERE id=?').run(body.videoId);sql.prepare('DELETE FROM matches WHERE video_id=?').run(body.videoId);assert.equal((await call('/catalog-video/update',body,'owner')).status,409);
});

test('reviewed submission history finds rejected videos outside the catalog and is moderator-only',async()=>{
 const {call,sql}=await setup();
 sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at,reviewed_at,reviewed_by,review_note) VALUES('history-test','fan','submission','missioned-souls','KYI8i2_v8nU','Please check this MS reaction','rejected','2026-01-01','2026-01-02','owner','Incorrect details')").run();
 assert.equal((await call('/submission-history',null,'fan')).status,403);
 const r=await call('/submission-history?status=rejected&q='+encodeURIComponent('https://youtu.be/KYI8i2_v8nU?si=test'),null,'owner');assert.equal(r.status,200);assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].review_note,'Incorrect details');
 assert.equal((await call('/submission-history?status=accepted',null,'owner')).data.items.length,0);
 assert.equal((await call('/submission-history?status=invalid',null,'owner')).status,400);
});
test('reopening a rejected submission preserves decisions, audits the old review and returns it to the queue',async()=>{
 const {call,sql,points}=await setup();
 sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at,reviewed_at,reviewed_by,review_note) VALUES('reopen-test','fan','submission','missioned-souls','KYI8i2_v8nU','Please check this MS reaction','rejected','2026-01-01','2026-01-02','owner','Incorrect details')").run();
 sql.prepare("INSERT INTO exclusions VALUES('missioned-souls','KYI8i2_v8nU','Preserved exclusion')").run();
 const b={id:'reopen-test',note:'Verify corrected details again'};
 assert.equal((await call('/submission/reopen',b,'fan')).status,403);
 assert.equal((await call('/submission/reopen',{...b,note:''},'owner')).status,400);
 assert.equal((await call('/submission/reopen',b,'owner')).status,200);
 const row=sql.prepare('SELECT * FROM contributions WHERE id=?').get(b.id);assert.equal(row.status,'pending');assert.equal(row.review_note,null);assert.equal(row.reviewed_at,null);assert.equal(row.created_at,'2026-01-01');
 assert.ok((await call('/queue?kind=submission',null,'owner')).data.items.some(c=>c.id===b.id));
 assert.equal(sql.prepare("SELECT reason FROM exclusions WHERE video_id='KYI8i2_v8nU'").get().reason,'Preserved exclusion');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM videos WHERE id='KYI8i2_v8nU'").get().n,0);
 const audit=JSON.parse(sql.prepare("SELECT value FROM state WHERE key LIKE 'submission-reopen:%'").get().value);assert.equal(audit.actor,'owner');assert.equal(audit.before.review_note,'Incorrect details');assert.equal(audit.note,b.note);assert.equal(points('fan'),0);
 assert.equal((await call('/submission/reopen',b,'owner')).status,409);
});
test('accepted submissions and rejected comments cannot be reopened as submissions',async()=>{
 const {call,sql}=await setup();
 for(const [id,kind,status] of [['accepted-test','submission','accepted'],['comment-test','comment','rejected']]){sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at) VALUES(?,'fan',?,'missioned-souls','KYI8i2_v8nU','Test contribution',?,'2026-01-01')").run(id,kind,status);assert.equal((await call('/submission/reopen',{id,note:'Review this item again'},'owner')).status,409);}
});

test('trusted reaction submissions publish fetched metadata with immediate points and preserve exclusions',async()=>{
 const {sql,call,env,points}=await setup();
 const now=new Date().toISOString();sql.prepare("UPDATE members SET trusted=1 WHERE id='fan'").run();
 const id='newvideo123';sql.prepare('INSERT INTO state(key,value) VALUES(?,?)').run('submission-metadata:'+id,JSON.stringify({title:'Missioned Souls reaction',channelName:'Trusted reactor',channelId:channel,publishedAt:'2026-09-01T00:00:00Z',format:'FULL_LENGTH',fetchedAt:Date.now()}));
 const b={kind:'submission',performerId:'missioned-souls',url:'https://youtu.be/'+id,body:'A verified reaction to Missioned Souls.'};
 const r=await call('/contribute',b);assert.equal(r.status,200);assert.equal(r.data.published,true);
 assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get(id).status,'CONFIRMED');assert.equal(points('fan'),20);
 assert.equal((await call('/contribute',b)).status,409);
 assert.equal((await call('/contribute',{...b,url:'https://youtu.be/pwNtcFZ_59I'})).status,409);
 assert.equal((await call('/contribute',{...b,url:'https://youtu.be/unavailable'})).status,503);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM contributions WHERE video_id='unavailable'").get().n,0);
});

test('trusted comments earn capped points once and hiding reverses the award',async()=>{
 const {sql,call,video,points}=await setup();
 sql.prepare("UPDATE members SET trusted=1 WHERE id='fan'").run();
 for(let i=0;i<4;i++){
  const id=String(i).padStart(11,'0');video(id);
  const b={kind:'comment',performerId:'missioned-souls',videoId:id,body:'A thoughtful comment about this reaction.'};
  assert.equal((await call('/contribute',b)).data.published,true);
  assert.equal((await call('/contribute',b)).status,409);
 }
 assert.equal(points('fan'),9);
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM reputation_events WHERE user_id='fan'").get().n,null);
 assert.equal((await call('/moderate',{id:'comment:fan:00000000000',decision:'hide',note:'Remove this comment'},'owner')).status,200);
 assert.equal(points('fan'),6);
});

test('trusted points migration backfills original UTC days once, respecting caps and decisions',async()=>{
 const {sql,points}=await setup();
 const migration=readFileSync(new URL('../drizzle/0033_trusted_member_points_20261010.sql',import.meta.url),'utf8');
 sql.exec("DELETE FROM state WHERE key='trusted-member-points-backfill-v1'");
 const note='Published directly: verified reputation above 15; no verification rewards awarded.';
 const insert=sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at,review_note) VALUES(?,'fan',?,'missioned-souls',?,'Useful contribution',?,?,?)");
 for(let i=0;i<5;i++)insert.run('old-comment-'+i,'comment',String(i).padStart(11,'0'),'accepted','2026-10-08T01:00:00Z',note);
 insert.run('hidden','comment','00000000008','hidden','2026-10-07T00:00:00Z',note);
 insert.run('pending','comment','00000000009','pending','2026-10-07T00:00:00Z',note);
 insert.run('ordinary','comment','00000000010','accepted','2026-10-07T00:00:00Z','Moderator approval');
 insert.run('old-submission','submission','00000000011','accepted','2026-10-07T00:00:00Z',note);
 insert.run('excluded-submission','submission','pwNtcFZ_59I','accepted','2026-10-07T00:00:00Z',note);
 sql.prepare("INSERT INTO videos(id,channel_id,title,available) VALUES('00000000011',?,'Reaction',1)").run(channel);
 sql.exec("INSERT INTO matches VALUES('missioned-souls','00000000011','CONFIRMED','Direct submission by trusted member')");
 sql.exec("INSERT INTO points VALUES('existing','fan','comment',3,'2026-10-08T02:00:00Z')");
 sql.exec(migration);assert.equal(points('fan'),29);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM points WHERE id LIKE 'old-comment-%'").get().n,2);
 assert.equal(sql.prepare("SELECT created_at FROM points WHERE id='old-submission'").get().created_at,'2026-10-07T00:00:00Z');
 const audit=JSON.parse(sql.prepare("SELECT value FROM state WHERE key='trusted-member-points-backfill-v1'").get().value);
 assert.equal(audit.awards,3);assert.equal(audit.points,26);
 sql.exec(migration);assert.equal(points('fan'),29);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM reputation_events').get().n,0);
});
