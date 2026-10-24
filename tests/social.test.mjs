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
test('threaded comments are reviewed, ownership enforced, likes deduplicated and rewards reversed',async()=>{const {call,sql}=await setup();const c={videoId:'abcdefghijk',performerId:'missioned-souls',body:'A thoughtful and detailed comment.'};assert.equal((await call('/comment',c)).status,200);const id=sql.prepare("SELECT id FROM contributions WHERE user_id='fan'").get().id;assert.equal((await call('/comments?video=abcdefghijk',null,'other')).data.items.length,0);assert.equal((await call('/comments?video=abcdefghijk')).data.items.length,1);assert.equal((await call('/moderate',{id,decision:'accept',note:'Helpful discussion'},'owner','https://pilot.test',community)).status,200);assert.equal((await call('/dashboard')).data.reputationTotal,0);assert.equal((await call('/comment',{...c,body:'A useful reply to that comment.',parentId:id},'other')).status,200);await call('/like',{id},'other');await call('/like',{id},'other');assert.equal((await call('/comments?video=abcdefghijk')).data.items[0].likes,1);assert.equal((await call('/comment',{...c,id},'other')).status,403);assert.equal((await call('/delete',{id,kind:'comment'},'other')).status,403);assert.equal((await call('/delete',{id,kind:'comment'})).status,200);assert.equal((await call('/dashboard')).data.reputationTotal,0);assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,0);});
test('chat messages, unread counts, mentions, blocking, reports and moderator mutes work together',async()=>{const {call,sql}=await setup();assert.equal((await call('/chat',{room:'missioned-souls',body:'Hello @other, what a great performance!'})).status,200);assert.equal((await call('/chat',{room:'missioned-souls',body:'Too fast'})).status,429);assert.equal((await call('/rooms',null,'other')).data.rooms[0].unread,1);assert.equal((await call('/mentions',null,'other')).data.items.length,1);await call('/presence',{room:'missioned-souls'},'other');assert.equal((await call('/rooms',null,'other')).data.rooms[0].unread,0);await call('/block',{target:'fan'},'other');assert.equal((await call('/chat?room=missioned-souls',null,'other')).data.messages.length,0);await call('/block',{target:'fan',remove:true},'other');const id=(await call('/chat?room=missioned-souls',null,'other')).data.messages[0].id;assert.equal((await call('/delete',{kind:'chat',id},'other')).status,403);await call('/report',{kind:'chat',target:id,body:'Please review this message.'},'other');assert.equal((await call('/queue',null,'fan')).status,403);const report=(await call('/queue',null,'owner')).data.reports[0];assert.equal((await call('/moderate',{id:report.id,action:'mute'},'fan')).status,403);assert.equal((await call('/moderate',{id:report.id,action:'mute'},'owner')).status,200);assert.equal((await call('/chat?room=missioned-souls')).data.messages.length,0);assert.equal((await call('/comment',{videoId:'abcdefghijk',performerId:'missioned-souls',body:'A muted member tries posting.'})).status,403);await call('/unmute',{id:'fan'},'owner');assert.equal(sql.prepare('SELECT COUNT(*) n FROM mutes').get().n,0);});
test('settings accept video metadata fields and reject invalid fields and numbers',()=>{assert.throws(()=>settings({minRating:8}));assert.throws(()=>settings({fields:['admin']}));assert.throws(()=>settings({hideWatched:'yes'}));assert.equal(settings({startDate:'2026-09-01'}).startDate,'2026-09-01');assert.deepEqual(settings({fields:['youtubeComments','duration']}).fields,['youtubeComments','duration']);});

test('reactor discussions keep targets, pending visibility, moderation and ownership isolated',async()=>{
 const {call,sql}=await setup();
 const channelId='UC1234567890123456789012',second='UCabcdefghijklmnopqrstuv';
 for(const id of [channelId,second])sql.prepare('INSERT INTO channels(id,name) VALUES(?,?)').run(id,'Test reactor');
 const c={channelId,body:'A thoughtful reactor comment mentioning @other.'};
 assert.equal((await call('/comment',c,null)).status,401);
 assert.equal((await call('/comment',c,'fan','https://evil.test')).status,403);
 assert.equal((await call('/comment',{...c,channelId:'missing'})).status,400);
 assert.equal((await call('/comment',{...c,videoId:'abcdefghijk'})).status,400);
 assert.equal((await call('/comment',c)).data.status,'pending');
 assert.equal((await call('/comment',c)).status,409);
 let items=(await call('/comments?channel='+channelId)).data.items;assert.equal(items.length,1);const id=items[0].id;
 assert.equal((await call('/comments?channel='+channelId,null,'other')).data.items.length,0);
 assert.equal((await call('/comments?video=abcdefghijk')).data.items.length,0);
 assert.equal((await call('/comments?channel='+second)).data.items.length,0);
 assert.equal((await call('/comment',{...c,id},'other')).status,403);
 assert.equal((await call('/comment',{...c,id,channelId:second})).status,400);
 assert.equal((await call('/moderate',{id,decision:'accept',note:'Useful channel discussion'},'owner','https://pilot.test',community)).status,200);
 assert.equal((await call('/comments?channel='+channelId,null,'other')).data.items.length,1);
 assert.equal((await call('/mentions',null,'other')).data.comments[0].channel_id,channelId);
 assert.equal((await call('/comment',{channelId:second,parentId:id,body:'Wrong channel reply must fail.'},'other')).status,400);
 assert.equal((await call('/comment',{videoId:'abcdefghijk',performerId:'missioned-souls',parentId:id,body:'Video reply must not cross targets.'},'other')).status,400);
 assert.equal((await call('/comment',{...c,parentId:id,body:'A useful reply about this reactor.'},'other')).data.status,'pending');
 await call('/like',{id},'other');await call('/like',{id},'other');
 assert.equal((await call('/comments?channel='+channelId)).data.items[0].likes,1);
 await call('/block',{target:'fan'},'other');
 assert.equal((await call('/comments?channel='+channelId,null,'other')).data.items.some(i=>i.id===id),false);
 await call('/block',{target:'fan',remove:true},'other');
 assert.equal((await call('/comment',{...c,id,body:'Edited reactor comment returns to review.'})).data.status,'pending');
 assert.equal((await call('/comments?channel='+channelId,null,'other')).data.items.some(i=>i.id===id),false);
 assert.equal((await call('/delete',{id,kind:'comment'},'other')).status,403);
 assert.equal((await call('/delete',{id,kind:'comment'})).status,200);
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,0);
});

test('trusted reactor comments retain uncapped video points, support reports, and respect mutes',async()=>{
 const {call,sql}=await setup();const channelId='UC1234567890123456789012';
 sql.prepare('INSERT INTO channels(id,name) VALUES(?,?)').run(channelId,'Test reactor');
 sql.prepare("UPDATE members SET trusted=1 WHERE id='fan'").run();
 for(let i=0;i<2;i++)assert.equal((await call('/comment',{videoId:'abcdefghijk',performerId:'missioned-souls',body:'Useful video discussion number '+i})).data.status,'accepted');
 for(let i=0;i<2;i++)assert.equal((await call('/comment',{channelId,body:'Useful reactor discussion number '+i})).data.status,'accepted');
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,12);
 const id=sql.prepare('SELECT id FROM contributions WHERE channel_id=? ORDER BY created_at LIMIT 1').get(channelId).id;
 assert.equal((await call('/comment',{channelId,id,body:'A trusted edit keeps existing points.'})).data.status,'accepted');
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,12);
 assert.equal((await call('/report',{kind:'comment',target:id,body:'Please review this reactor comment.'},'other')).status,200);
 const report=(await call('/queue',null,'owner')).data.reports[0];
 assert.equal((await call('/moderate',{id:report.id,action:'mute'},'owner')).status,200);
 assert.equal((await call('/comments?channel='+channelId)).data.items.some(c=>c.id===id),false);
 assert.equal((await call('/comment',{channelId,body:'Muted comments should not be published.'})).status,403);
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,9);
});

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

test('Master Reset clears the four selected groups atomically and preserves other member data',async()=>{
 const {call,sql}=await setup();
 sql.prepare('INSERT INTO channels(id,name) VALUES(?,?)').run('UC1234567890123456789012','Test reactor');
 for(const user of ['fan','other']){
 for(const kind of ['reactor','song','performer'])sql.prepare('INSERT INTO follows VALUES(?,?,?)').run(user,kind,kind==='performer'?'missioned-souls':'sample');
 sql.prepare('INSERT INTO hidden_reactors VALUES(?,?,?)').run(user,'UC1234567890123456789012','2026-10-07');
 sql.prepare('INSERT INTO reactor_ratings VALUES(?,?,?,?)').run(user,'UC1234567890123456789012',80,'2026-10-07');
 sql.prepare('INSERT INTO ratings(user_id,video_id,score,created_at) VALUES(?,?,?,?)').run(user,'abcdefghijk',5,'2026-10-07');
 }
 await call('/watch',{videoId:'abcdefghijk',status:'watched',favorite:true});
 await call('/preferences',{theme:'dark'});
 assert.equal((await call('/master-reset',{})).status,400);
 assert.equal((await call('/master-reset',{confirm:true},null)).status,401);
 assert.equal((await call('/master-reset',{confirm:true},'fan','https://evil.test')).status,403);
 assert.equal((await call('/master-reset',{confirm:true})).status,200);
 for(const table of ['hidden_reactors','reactor_ratings']){assert.equal(sql.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id='fan'`).get().n,0);assert.equal(sql.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id='other'`).get().n,1);}
 assert.equal(sql.prepare("SELECT score FROM ratings WHERE user_id='fan'").get().score,5);
 const d=(await call('/dashboard')).data;assert.deepEqual(d.follows.map(f=>f.kind),['performer']);assert.equal(d.watch[0].favorite,1);assert.equal(d.watch[0].status,'watched');assert.equal(d.preferences.theme,'dark');
 assert.equal((await call('/master-reset',{confirm:true})).status,200);
});

test('direct comments depend on moderator-managed trust, not contribution points or archived reputation',async()=>{
 const {call,sql}=await setup();
 sql.prepare("INSERT INTO reputation_events VALUES('earned','fan',100,'Archived reputation',?)").run(new Date().toISOString());
 sql.prepare("INSERT INTO points VALUES('participation','fan','submission',1000,?)").run(new Date().toISOString());
 const c={videoId:'abcdefghijk',performerId:'missioned-souls',body:'High scores still require a moderator trust decision.'};
 assert.equal((await call('/comment',c)).data.status,'pending');
 sql.prepare("UPDATE members SET trusted=1 WHERE id='fan'").run();
 assert.equal((await call('/comment',{...c,body:'Trusted status publishes directly.'})).data.status,'accepted');
 sql.prepare("UPDATE members SET trusted=0 WHERE id='fan'").run();
 assert.equal((await call('/comment',{...c,body:'Revoked trust returns posting to approval.'})).data.status,'pending');
 assert.equal((await call('/dashboard')).data.reputationTotal,100);
});

test('trusted comments and replies earn uncapped awards across routes; edits retain points and removal reverses once',async()=>{
 const {sql,call}=await setup();
 sql.prepare("UPDATE members SET trusted=1 WHERE id='fan'").run();
 const b={videoId:'abcdefghijk',performerId:'missioned-souls',body:'A useful trusted comment about this reaction.'};
 assert.equal((await call('/comment',b)).data.status,'accepted');
 const id=sql.prepare("SELECT id FROM contributions WHERE body=?").get(b.body).id;
 const points=()=>sql.prepare("SELECT COALESCE(SUM(amount),0) n FROM points WHERE user_id='fan'").get().n;
 assert.equal(points(),3);
 assert.equal((await call('/comment',b)).status,409);assert.equal(points(),3);
 assert.equal((await call('/comment',{...b,id,body:'An improved trusted comment about this reaction.'})).status,200);assert.equal(points(),3);
 assert.equal((await call('/comment',{...b,parentId:id,body:'A useful reply discussing the performance.'})).status,200);assert.equal(points(),6);
 assert.equal((await call('/contribute',{kind:'comment',...b,body:'A comment through the original contribution form.'},'fan','https://pilot.test',community)).status,200);assert.equal(points(),9);
 assert.equal((await call('/comment',{...b,body:'Another useful comment above the daily reward limit.'})).status,200);assert.equal(points(),12);
 assert.equal((await call('/dashboard')).data.reputationTotal,0);
 assert.equal((await call('/delete',{id,kind:'comment'})).status,200);assert.equal(points(),9);
 assert.equal((await call('/delete',{id,kind:'comment'})).status,200);assert.equal(points(),9);
});

test('social backfill restores unreviewed direct comments and replies on original days without duplicate awards',async()=>{
 const {sql}=await setup();
 const migration=readFileSync(new URL('../drizzle/0034_trusted_comment_points_20261010.sql',import.meta.url),'utf8');
 sql.exec("DELETE FROM state WHERE key='trusted-comment-points-backfill-v2'");
 const add=sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at,review_note,reviewed_by,reviewed_at,parent_id) VALUES(?,'fan','comment','missioned-souls','abcdefghijk','Useful comment',?,?,?,?,?,?)");
 const day='2026-10-08T01:00:00Z';
 add.run('parent','accepted',day,null,null,null,null);
 add.run('reply','accepted',day,null,null,null,'parent');
 add.run('over-cap','accepted',day,null,null,null,null);
 add.run('already-paid','accepted',day,null,null,null,null);
 add.run('hidden-old','hidden',day,null,null,null,null);
 add.run('pending-old','pending',day,null,null,null,null);
 add.run('reviewed-old','accepted','2026-10-07T00:00:00Z',null,'owner','2026-10-07T01:00:00Z',null);
 add.run('reversed-old','accepted','2026-10-07T00:00:00Z',null,null,null,null);
 sql.exec("INSERT INTO points VALUES('already-paid','fan','comment',3,'2026-10-08T01:00:00Z'); INSERT INTO points VALUES('revoke:reversed-old','fan','reversal',-3,'2026-10-07T00:00:00Z')");
 sql.exec(migration);
 const awards=sql.prepare("SELECT id,created_at FROM points WHERE id IN ('parent','reply','over-cap','reviewed-old','reversed-old') ORDER BY id").all();
 // Stable creation-time/id ordering gives remaining slots to over-cap and parent.
 assert.deepEqual(awards.map(p=>p.id),['over-cap','parent']);assert.ok(awards.every(p=>p.created_at===day));
 const audit=JSON.parse(sql.prepare("SELECT value FROM state WHERE key='trusted-comment-points-backfill-v2'").get().value);assert.equal(audit.awards,2);assert.equal(audit.points,6);
 const before=sql.prepare('SELECT COUNT(*) n FROM points').get().n;sql.exec(migration);assert.equal(sql.prepare('SELECT COUNT(*) n FROM points').get().n,before);
});

test('first trusted publication of an edited pending comment earns one award',async()=>{
 const {sql,call}=await setup();
 const b={videoId:'abcdefghijk',performerId:'missioned-souls',body:'Initially this comment needs review.'};
 assert.equal((await call('/comment',b)).data.status,'pending');
 const id=sql.prepare('SELECT id FROM contributions').get().id;
 sql.prepare("UPDATE members SET trusted=1 WHERE id='fan'").run();
 for(let i=0;i<2;i++)assert.equal((await call('/comment',{...b,id,body:'Now trusted, this comment publishes directly.'})).data.status,'accepted');
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,3);
});

test('following groups persist, isolate accounts, switch atomically and preserve active edits',async()=>{
 const {call}=await setup();
 await call('/follow',{kind:'performer',target:'missioned-souls'});
 await call('/follow',{kind:'song',target:'Hysteria'});
 const a=await call('/following-group',{action:'create',name:'Rock'});assert.equal(a.status,200);
 await call('/reset-follows',{kind:'song',confirm:true});
 const b=await call('/following-group',{action:'create',name:'Empty'});
 assert.equal((await call('/following-group',{action:'activate',id:a.data.id},'other')).status,404);
 assert.equal((await call('/dashboard',null,'other')).data.followingGroups.length,0);
 await call('/following-group',{action:'activate',id:a.data.id});
 assert.equal((await call('/dashboard')).data.follows.some(f=>f.target==='Hysteria'),true);
 await call('/follow',{kind:'song',target:'All It Takes'});
 await call('/following-group',{action:'activate',id:b.data.id});
 assert.deepEqual((await call('/dashboard')).data.follows,[{kind:'performer',target:'missioned-souls'}]);
 await call('/following-group',{action:'activate',id:a.data.id});
 assert.equal((await call('/dashboard')).data.follows.filter(f=>f.kind==='song').length,2);
 await call('/following-group',{action:'rename',id:a.data.id,name:'Favorites'});
 assert.equal((await call('/dashboard')).data.followingGroups.find(g=>g.id===a.data.id).name,'Favorites');
 await call('/master-reset',{confirm:true});
 assert.equal((await call('/dashboard')).data.followingGroups.length,2);
 assert.equal((await call('/dashboard')).data.followingGroups.some(g=>g.active),false);
 await call('/following-group',{action:'activate',id:a.data.id});
 await call('/following-group',{action:'delete',id:a.data.id});
 assert.equal((await call('/dashboard')).data.follows.filter(f=>f.kind==='song').length,2);
 assert.equal((await call('/following-group',{action:'create',name:' '})).status,400);
});

test('moderator daily reset also restores the social comment allowance',async()=>{
 const {sql,call}=await setup(),now=new Date().toISOString();
 for(let i=0;i<20;i++)sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at) VALUES(?,'fan','comment','missioned-souls','abcdefghijk','Previous comment','pending',?)").run('social-prior:'+i,now.slice(0,10)+'T00:00:00.000Z');
 const comment={videoId:'abcdefghijk',performerId:'missioned-souls',body:'A separate useful comment after the reset.'};
 assert.equal((await call('/comment',comment)).status,409);
 assert.equal((await call('/users/update',{id:'fan',action:'reset-daily-limit',note:'Allow another batch'},'owner',undefined,community)).status,200);
 assert.equal((await call('/comment',comment)).status,200);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM contributions WHERE user_id='fan'").get().n,21);
});

test('all displayed reactor sorts persist in preferences and saved views without crossing accounts',async()=>{
 const {call,sql}=await setup();
 try{
  for(const sort of ['newest','ranked','personal','subscribers','name']){
   assert.equal((await call('/preferences',{followingReactorSort:sort})).status,200);
   assert.equal((await call('/dashboard')).data.preferences.followingReactorSort,sort);
   assert.equal((await call('/view',{name:'Sort '+sort,settings:{followingReactorSort:sort}})).status,200);
   assert.equal((await call('/dashboard')).data.views.find(v=>v.name==='Sort '+sort).settings.followingReactorSort,sort);
  }
  assert.deepEqual((await call('/dashboard',null,'other')).data.preferences,{});
  assert.equal((await call('/dashboard',null,'other')).data.views.length,0);
  assert.equal((await call('/preferences',{followingReactorSort:'invalid'})).status,400);
  assert.equal((await call('/dashboard')).data.preferences.followingReactorSort,'name');
 }finally{sql.close();}
});

test('trusted daily posting exemption spans both routes and revocation restores the cap',async()=>{
 const {sql,call}=await setup(),day=new Date().toISOString().slice(0,10);
 try{
  for(let i=0;i<20;i++)sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at) VALUES(?,'fan','comment','missioned-souls','abcdefghijk','Previous','pending',?)").run('exemption:'+i,day+'T00:00:00.000Z');
  sql.prepare("UPDATE members SET trusted=1 WHERE id='fan'").run();
  const b={videoId:'abcdefghijk',performerId:'missioned-souls',body:'Trusted comment after twenty earlier posts.'};
  assert.equal((await call('/comment',b)).data.status,'accepted');
  assert.equal((await call('/contribute',{...b,kind:'comment',body:'Trusted original-route post beyond twenty.'},'fan',undefined,community)).data.published,true);
  sql.prepare("UPDATE members SET trusted=0 WHERE id='fan'").run();
  assert.equal((await call('/comment',{...b,body:'After trust revocation this should be capped.'})).status,409);
  assert.equal((await call('/contribute',{...b,kind:'comment',body:'Original route is capped after revocation.'},'fan',undefined,community)).status,409);
 }finally{sql.close();}
});
