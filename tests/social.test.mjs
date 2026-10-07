import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {social,settings} from '../server/social.mjs';
import {community} from '../server/community.mjs';
import {seedDatabase} from '../server/db.mjs';
async function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const db={prepare(q){let v=[];return {bind(...a){v=a;return this;},async first(){return sql.prepare(q).get(...v)||null;},async all(){return {results:sql.prepare(q).all(...v)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...v).changes)}};}}},async batch(stmts){sql.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]},env={DB:db,COMMUNITY_MODERATOR_EMAILS:'owner@test.com'};
 await seedDatabase(db,seed);for(const id of ['owner','fan','other'])sql.prepare('INSERT INTO members(id,name,created_at) VALUES(?,?,?)').run(id,id,new Date().toISOString());sql.prepare("INSERT INTO videos(id,channel_id,title) VALUES('abcdefghijk','UC1234567890123456789012','Real reaction')").run();sql.prepare("INSERT INTO matches(performer_id,video_id,status,source) VALUES('missioned-souls','abcdefghijk','CONFIRMED','test')").run();
 const call=async(path,body,user='fan',origin='https://pilot.test',service=social)=>{const r=await service(new Request('https://pilot.test/api/'+(service===social?'social':'community')+path,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@test.com'}:{}),Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,seed,user?{id:user,moderator:user==='owner'}:null);return {status:r.status,data:await r.json()};};return {sql,call,db};
}
test('preferences, saved views, follows and watch lists are account isolated and persistent',async()=>{const {call}=await setup();assert.equal((await call('/dashboard',null,null)).status,401);assert.equal((await call('/preferences',{theme:'dark'},'fan','https://evil.test')).status,403);assert.equal((await call('/preferences',{theme:'dark',layout:'table',fields:['rating'],hideWatched:true})).status,200);assert.equal((await call('/dashboard')).data.preferences.theme,'dark');assert.deepEqual((await call('/dashboard',null,'other')).data.preferences,{});await call('/view',{name:'My favorites',settings:{landing:'favorites',layout:'compact'}});const id=(await call('/dashboard')).data.views[0].id;await call('/view',{id,remove:true},'other');assert.equal((await call('/dashboard')).data.views.length,1);await call('/follow',{kind:'performer',target:'missioned-souls'});await call('/watch',{videoId:'abcdefghijk',status:'watched',favorite:true});const d=(await call('/dashboard')).data;assert.equal(d.follows.length,1);assert.equal(d.watch[0].favorite,1);assert.equal(d.watch[0].status,'watched');assert.equal((await call('/dashboard',null,'other')).data.watch.length,0);assert.equal((await call('/preferences',{layout:'hacked'})).status,400);});
test('threaded comments are reviewed, ownership enforced, likes deduplicated and rewards reversed',async()=>{const {call,sql}=await setup();const c={videoId:'abcdefghijk',performerId:'missioned-souls',body:'A thoughtful and detailed comment.'};assert.equal((await call('/comment',c)).status,200);const id=sql.prepare("SELECT id FROM contributions WHERE user_id='fan'").get().id;assert.equal((await call('/comments?video=abcdefghijk',null,'other')).data.items.length,0);assert.equal((await call('/comments?video=abcdefghijk')).data.items.length,1);assert.equal((await call('/moderate',{id,decision:'accept',note:'Helpful discussion'},'owner','https://pilot.test',community)).status,200);assert.equal((await call('/dashboard')).data.reputationTotal,2);assert.equal((await call('/comment',{...c,body:'A useful reply to that comment.',parentId:id},'other')).status,200);await call('/like',{id},'other');await call('/like',{id},'other');assert.equal((await call('/comments?video=abcdefghijk')).data.items[0].likes,1);assert.equal((await call('/comment',{...c,id},'other')).status,403);assert.equal((await call('/delete',{id,kind:'comment'},'other')).status,403);assert.equal((await call('/delete',{id,kind:'comment'})).status,200);assert.equal((await call('/dashboard')).data.reputationTotal,0);assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,0);});
test('chat messages, unread counts, mentions, blocking, reports and moderator mutes work together',async()=>{const {call,sql}=await setup();assert.equal((await call('/chat',{room:'missioned-souls',body:'Hello @other, what a great performance!'})).status,200);assert.equal((await call('/chat',{room:'missioned-souls',body:'Too fast'})).status,429);assert.equal((await call('/rooms',null,'other')).data.rooms[0].unread,1);assert.equal((await call('/mentions',null,'other')).data.items.length,1);await call('/presence',{room:'missioned-souls'},'other');assert.equal((await call('/rooms',null,'other')).data.rooms[0].unread,0);await call('/block',{target:'fan'},'other');assert.equal((await call('/chat?room=missioned-souls',null,'other')).data.messages.length,0);await call('/block',{target:'fan',remove:true},'other');const id=(await call('/chat?room=missioned-souls',null,'other')).data.messages[0].id;assert.equal((await call('/delete',{kind:'chat',id},'other')).status,403);await call('/report',{kind:'chat',target:id,body:'Please review this message.'},'other');assert.equal((await call('/queue',null,'fan')).status,403);const report=(await call('/queue',null,'owner')).data.reports[0];assert.equal((await call('/moderate',{id:report.id,action:'mute'},'fan')).status,403);assert.equal((await call('/moderate',{id:report.id,action:'mute'},'owner')).status,200);assert.equal((await call('/chat?room=missioned-souls')).data.messages.length,0);assert.equal((await call('/comment',{videoId:'abcdefghijk',performerId:'missioned-souls',body:'A muted member tries posting.'})).status,403);await call('/unmute',{id:'fan'},'owner');assert.equal(sql.prepare('SELECT COUNT(*) n FROM mutes').get().n,0);});
test('settings reject invalid fields and numbers',()=>{assert.throws(()=>settings({minRating:8}));assert.throws(()=>settings({fields:['admin']}));assert.throws(()=>settings({hideWatched:'yes'}));assert.equal(settings({startDate:'2026-09-01'}).startDate,'2026-09-01');});

test('dashboard reads overlap and keep the existing account-scoped response',async()=>{
 const {call,db}=await setup();
 const prepare=db.prepare.bind(db);let inFlight=0,peak=0;
 db.prepare=q=>{const statement=prepare(q);for(const method of ['all','first']){
  const read=statement[method].bind(statement);
  statement[method]=async()=>{inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setImmediate(resolve));try{return await read();}finally{inFlight--;}};
 }return statement;};
 const response=await call('/dashboard');
 assert.equal(response.status,200);assert.ok(peak>=12,`expected concurrent dashboard reads, got ${peak}`);
 assert.equal(response.data.userId,'fan');assert.deepEqual(response.data.preferences,{});assert.deepEqual(response.data.watch,[]);assert.equal(response.data.reputationTotal,0);
});

 test('reset follows clears only the selected kind for the signed-in member',async()=>{
 const {call,sql}=await setup();
 for(const user of ['fan','other'])for(const kind of ['reactor','song','performer'])sql.prepare('INSERT INTO follows VALUES(?,?,?)').run(user,kind,kind==='performer'?'missioned-souls':'sample');
 assert.equal((await call('/reset-follows',{kind:'reactor',confirm:true},null)).status,401);
 assert.equal((await call('/reset-follows',{kind:'reactor',confirm:true},'fan','https://evil.test')).status,403);
 for(const body of [{kind:'performer',confirm:true},{kind:'song'},{kind:'reactor',confirm:false}])assert.equal((await call('/reset-follows',body)).status,400);
 assert.equal((await call('/reset-follows',{kind:'reactor',confirm:true})).status,200);
 assert.deepEqual((await call('/dashboard')).data.follows.map(f=>f.kind).sort(),['performer','song']);
 assert.equal((await call('/dashboard',null,'other')).data.follows.length,3);
 assert.equal((await call('/reset-follows',{kind:'song',confirm:true})).status,200);
 assert.deepEqual((await call('/dashboard')).data.follows.map(f=>f.kind),['performer']);
 assert.equal((await call('/reset-follows',{kind:'song',confirm:true})).status,200);
 });
