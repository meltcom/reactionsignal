import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {community} from '../server/community.mjs';
import {seedDatabase} from '../server/db.mjs';
import {canPublishDirectly} from '../server/reputation.mjs';
const migration='0035_simple_member_trust_20261010.sql';
async function setup(beforeMigration=false){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())if(!beforeMigration||f!==migration)sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const db={prepare(q){let v=[];return{bind(...a){v=a;return this;},async first(){return sql.prepare(q).get(...v)||null;},async all(){return{results:sql.prepare(q).all(...v)};},async run(){return{meta:{changes:Number(sql.prepare(q).run(...v).changes)}};}};},async batch(ops){sql.exec('BEGIN');try{const out=[];for(const op of ops)out.push(await op.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]};await seedDatabase(db,seed);
 for(const id of ['owner','fan','other'])sql.prepare('INSERT INTO members(id,name,created_at) VALUES(?,?,?)').run(id,id,'2026-10-01T00:00:00Z');
 async function call(path,body,user='owner'){
  const r=await community(new Request('https://pilot.test/api/community'+path,{method:body?'POST':'GET',headers:{Origin:'https://pilot.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{DB:db},seed,{id:user,moderator:user==='owner'});return{status:r.status,data:await r.json()};
 }
 function approval(id,status='accepted',reviewer='owner',member='fan'){
  sql.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,status,created_at,reviewed_at,reviewed_by) VALUES(?,?,'comment','missioned-souls','abcdefghijk','Useful comment',?,'2026-10-01T00:00:00Z',?,?)").run(id,member,status,reviewer?'2026-10-02T00:00:00Z':null,reviewer);
 }
 return{sql,db,call,approval};
}
test('transition preserves existing trust and reputation history without converting points into access',async()=>{
 const {sql,db}=await setup(true);
 sql.exec("INSERT INTO reputation_events VALUES('old','fan',16,'Prior verified help','2026-10-01'); INSERT INTO reputation_events VALUES('threshold','other',15,'Prior verified help','2026-10-01'); INSERT INTO points VALUES('many','other','rating',1000,'2026-10-01')");
 sql.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));
 assert.equal(await canPublishDirectly(db,'fan'),true);assert.equal(await canPublishDirectly(db,'other'),false);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM reputation_events').get().n,2);
 assert.equal(sql.prepare("SELECT reason FROM member_trust_history WHERE user_id='fan'").get().reason,'Preserved existing trusted posting access');
});
test('three independent approvals flag for review; only moderators grant, defer or revoke and decisions are audited',async()=>{
 const {sql,call,approval,db}=await setup();
 const change={id:'fan',action:'grant-trust',note:'Checked quality and accuracy'};
 assert.equal((await call('/users/update',change,'fan')).status,403);
 assert.equal((await call('/users/contributions?id=fan',null,'fan')).status,403);
 assert.equal((await call('/users/update',change)).status,409);
 approval('first');approval('second');approval('self','accepted','fan');approval('direct','accepted',null);approval('rejected','rejected');approval('hidden','hidden');
 assert.equal((await call('/users?trust=ready')).data.items.length,0);
 approval('third');
 const ready=(await call('/users?trust=ready')).data.items;assert.equal(ready.length,1);assert.equal(ready[0].approved_count,3);
 assert.equal(await canPublishDirectly(db,'fan'),false);
 assert.equal((await call('/users/update',{...change,action:'defer-trust'})).status,200);
 assert.equal((await call('/users?trust=ready')).data.items.length,0);
 assert.equal((await call('/users/update',change)).status,200);assert.equal(await canPublishDirectly(db,'fan'),true);
 assert.equal((await call('/summary',null,'fan')).data.trusted,true);assert.equal((await call('/summary',null,'fan')).data.approvedCount,3);
 assert.equal((await call('/users?trust=trusted')).data.items.length,1);
 assert.equal((await call('/users/update',{...change,action:'revoke-trust'})).status,200);assert.equal(await canPublishDirectly(db,'fan'),false);
 assert.equal((await call('/users/contributions?id=fan')).data.trustHistory.length,3);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM points WHERE user_id='fan'").get().n,0);
 approval('owner1','accepted','fan','owner');approval('owner2','accepted','fan','owner');approval('owner3','accepted','fan','owner');
 assert.equal((await call('/users/update',{...change,id:'owner'})).status,403);
});
test('approvals earn only contribution points and corrected reports earn ten while archived reputation is immutable',async()=>{
 const {sql,call}=await setup();
 sql.exec("INSERT INTO reputation_events VALUES('archive','fan',10,'Old record','2026-10-01'); INSERT INTO videos(id,channel_id,title,available) VALUES('abcdefghijk','UC1234567890123456789012','Reaction',1); INSERT INTO matches VALUES('missioned-souls','abcdefghijk','CONFIRMED','test')");
 const b={kind:'comment',performerId:'missioned-souls',videoId:'abcdefghijk',body:'A thoughtful comment about this reaction.'};
 await call('/contribute',b,'fan');
 assert.equal((await call('/moderate',{id:'comment:fan:abcdefghijk',decision:'accept',note:'Useful relevant discussion'})).status,200);
 await call('/contribute',{...b,kind:'flag',reason:'wrong-performer'},'fan');
 assert.equal((await call('/moderate',{id:'flag:fan:missioned-souls:abcdefghijk',decision:'accept',note:'Verified wrong performer'})).status,200);
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,13);
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM reputation_events WHERE user_id='fan'").get().n,10);
 assert.equal((await call('/moderate',{id:'comment:fan:abcdefghijk',decision:'hide',note:'Remove unsuitable comment'})).status,200);
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM points WHERE user_id='fan'").get().n,10);
 assert.equal(sql.prepare("SELECT SUM(amount) n FROM reputation_events WHERE user_id='fan'").get().n,10);
});
