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
test('submitted videos are canonicalized and only published after verified approval',async()=>{const {call,sql,points}=await setup();const body={kind:'submission',performerId:'missioned-souls',url:'https://youtu.be/abcdefghijk?t=5',body:'This new reaction features Missioned Souls.'};assert.equal((await call('/contribute',body)).status,200);assert.equal((await call('/contribute',{...body,url:'https://www.youtube.com/watch?v=abcdefghijk'},'other')).status,409);assert.equal(sql.prepare('SELECT COUNT(*) n FROM videos').get().n,0);const id=(await call('/summary')).data.mine[0].id;assert.equal((await call('/moderate',{id,decision:'accept',note:'Verified on YouTube'},'owner')).status,400);assert.equal((await call('/moderate',{id,decision:'accept',note:'Verified full reaction on YouTube',title:'Missioned Souls reaction',channelName:'Sample reactor',channelId:channel},'owner')).status,200);assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get('abcdefghijk').status,'CONFIRMED');assert.equal(points('fan'),20);assert.equal((await call('/contribute',body,'other')).status,409);});
test('confirmed flag excludes only the selected match and rewards one correction',async()=>{const {call,video,sql,points}=await setup();video();for(const user of ['fan','other'])assert.equal((await call('/contribute',{kind:'flag',performerId:'missioned-souls',videoId:'abcdefghijk',reason:'wrong-performer',body:'This video features another performer.'},user)).status,200);const id=(await call('/summary')).data.mine[0].id;assert.equal((await call('/moderate',{id,decision:'accept',note:'Confirmed another performer'},'owner')).status,200);assert.equal(points('fan'),5);assert.equal(sql.prepare('SELECT COUNT(*) n FROM videos').get().n,1);assert.equal(sql.prepare('SELECT status FROM matches WHERE video_id=?').get('abcdefghijk').status,'REJECTED');const other=(await call('/summary',null,'other')).data.mine[0].id;assert.equal((await call('/moderate',{id:other,decision:'accept',note:'Duplicate flag accepted'},'owner')).status,409);assert.equal(points('other'),0);});
test('self approvals do not award points; prior exclusions cannot be submitted',async()=>{const {call,video,points}=await setup();video();await call('/contribute',{kind:'comment',performerId:'missioned-souls',videoId:'abcdefghijk',body:'The owner can test a thoughtful comment.'},'owner');const id=(await call('/summary',null,'owner')).data.mine[0].id;assert.equal((await call('/moderate',{id,decision:'accept',note:'Owner test comment approval'},'owner')).status,200);assert.equal(points('owner'),0);assert.equal((await call('/contribute',{kind:'submission',performerId:'missioned-souls',url:'https://youtu.be/pwNtcFZ_59I',body:'Previously excluded reaction video.'})).status,409);});
test('only YouTube HTTPS video URLs accepted and tier thresholds are explicit',()=>{assert.equal(youtubeId('https://youtube.com/shorts/P69VWMewzQY'),'P69VWMewzQY');for(const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk','http://youtu.be/abcdefghijk','https://evil.test/abcdefghijk','https://youtu.be/a','https://u:p@youtu.be/abcdefghijk'])assert.equal(youtubeId(url),null);assert.equal(tier(100),'Reaction scout');assert.equal(tier(0),'New member');});
test('coverage recommendations persist, stay account-isolated, and require moderator review',async()=>{
 const {call,sql}=await setup();
 const suggestion={name:'Franz Rhythm',url:'https://www.youtube.com/@FranzRhythm',body:'Please cover their family performances and the reactions to them.'};
 assert.equal((await call('/coverage',suggestion)).status,200);
 assert.equal((await call('/coverage',{...suggestion,name:'  FRANZ   RHYTHM  '})).status,409);
 assert.equal((await call('/coverage',null,'other')).data.items.length,0);
 const saved=(await call('/coverage')).data.items[0];assert.equal(saved.status,'pending');
 assert.equal((await call('/coverage/queue',null,'fan')).status,403);
 assert.equal((await call('/coverage/review',{id:saved.id,decision:'shortlisted',note:'Good suggestion for future coverage.'},'fan')).status,403);
 assert.equal((await call('/coverage/queue',null,'owner')).data.items[0].name,'Franz Rhythm');
 assert.equal((await call('/coverage/review',{id:saved.id,decision:'shortlisted',note:'Good suggestion for future coverage.'},'owner')).status,200);
 assert.equal((await call('/coverage')).data.items[0].status,'shortlisted');
 assert.equal((await call('/coverage')).data.items[0].review_note,'Good suggestion for future coverage.');
 assert.equal((await call('/coverage/review',{id:saved.id,decision:'declined',note:'Second review'},'owner')).status,409);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM performers').get().n,1);
});
test('coverage recommendations validate links, reject covered performers, and limit spam',async()=>{
 const {call,sql}=await setup();const suggestion={name:'Another performer',url:'https://example.com/artist',body:'A performer with interesting music and reactions.'};
 for(const url of ['http://example.com','javascript:alert(1)','https://name:password@example.com'])assert.equal((await call('/coverage',{...suggestion,url})).status,400);
 assert.equal((await call('/coverage',{...suggestion,name:'Missioned Souls'})).status,409);
 for(let i=0;i<5;i++)assert.equal((await call('/coverage',{...suggestion,name:'Performer '+i})).status,200);
 assert.equal((await call('/coverage',{...suggestion,name:'Performer 6'})).status,429);
 assert.equal((await call('/coverage',{...suggestion,name:'Performer 6'},'other')).status,200);
 sql.prepare('INSERT INTO mutes VALUES(?,?,?)').run('other',new Date(Date.now()+60000).toISOString(),'test');
 assert.equal((await call('/coverage',{...suggestion,name:'Muted suggestion'},'other')).status,403);
});

test('moderator onboarding supports drafts, reviews, publishing, recommendations, and dynamic member features',async()=>{
 const {env,db,call}=await setup();
 const api=async(path,body,user='owner',origin='https://pilot.test')=>{const r=await managePerformers(new Request('https://pilot.test/api/performers'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,seed,{id:user,moderator:user==='owner'});return {status:r.status,data:await r.json()};};
 assert.equal((await api('/list',null,'fan')).status,403);
 await call('/coverage',{name:'Franz Rhythm',url:'https://youtube.com/@FranzRhythm',body:'Please cover their songs and reaction videos.'});
 const recommendation=(await call('/coverage')).data.items[0];
 const payload={name:'Franz Rhythm',officialUrl:'https://youtube.com/@FranzRhythm',aliases:['FranzRhythm'],lookbackDays:90,reviewMode:'review',status:'draft',discoveryEnabled:true,chatEnabled:true,requestId:recommendation.id};
 assert.equal((await api('/save',payload,'owner','https://evil.test')).status,403);
 const saved=await api('/save',payload);assert.equal(saved.status,200);const id=saved.data.id;
 assert.equal((await api('/save',{...payload,requestId:undefined,name:'FRANZ   RHYTHM'})).status,409);
 assert.equal((await catalog(db,seed,env)).performers.some(p=>p.id===id),false);
 assert.equal((await call('/coverage')).data.items[0].status,'shortlisted');
 const profile=await db.prepare('SELECT * FROM performers WHERE id=?').bind(id).first();
 const discovered={id:'zyxwvutsrqp',snippet:{title:'FranzRhythm REACTION',channelId:channel,channelTitle:'Reactor',publishedAt:'2026-09-24T00:00:00Z'},status:{privacyStatus:'public'},contentDetails:{duration:'PT8M'}};
 await saveVideo(db,discovered,[profile],new Date().toISOString(),'test');
 assert.equal((await api('/results?id='+id)).data.items[0].status,'PENDING');
 assert.equal((await api('/review',{id,videos:['zyxwvutsrqp'],decision:'approve'},'fan')).status,403);
 assert.equal((await api('/review',{id,videos:['zyxwvutsrqp'],decision:'approve'})).status,200);
 assert.equal((await api('/save',{...payload,id,status:'active',requestId:undefined})).status,200);
 const active=await catalog(db,seed,env);assert.ok(active.performers.some(p=>p.id===id));assert.ok(active.videos.some(v=>v.performerId===id));
 assert.equal((await call('/coverage')).data.items[0].status,'covered');
 const memberApi=async(path,body)=>{const r=await social(new Request('https://pilot.test/api/social'+path,{method:body?'POST':'GET',headers:{Origin:'https://pilot.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,seed,{id:'fan',moderator:false});return {status:r.status,data:await r.json()};};
 assert.equal((await memberApi('/follow',{kind:'performer',target:id})).status,200);
 assert.equal((await memberApi('/preferences',{performer:id})).status,200);
 assert.ok((await memberApi('/rooms')).data.rooms.some(r=>r.id===id));
 assert.equal((await call('/contribute',{kind:'comment',performerId:id,videoId:'zyxwvutsrqp',body:'A thoughtful reaction to this performance.'})).status,200);
 assert.equal((await api('/discover',{id})).data.result.status,'blocked');
 assert.equal((await api('/review',{id,videos:['zyxwvutsrqp'],decision:'exclude'})).status,200);
 await saveVideo(db,discovered,[profile],new Date().toISOString(),'rescan');
 assert.equal((await api('/results?id='+id)).data.items[0].status,'REJECTED');
});
