import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {donations,pointAllowance,offsetKey} from '../server/donations.mjs';
import {award} from '../server/community.mjs';
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE members(id TEXT PRIMARY KEY,trusted INTEGER);CREATE TABLE points(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,amount INTEGER,created_at TEXT);INSERT INTO members VALUES(\'fan\',1),(\'other\',1),(\'new\',0)');
 const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={DB:db,DONATION_RESETS_ENABLED:'1'},now=new Date().toISOString();
 const points=(amount=450,user='fan')=>sql.prepare('INSERT INTO points VALUES(?,?,?,?,?)').run(crypto.randomUUID(),user,'comment',amount,now);
 const state=(key,value)=>sql.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(key,JSON.stringify(value));
 const call=async(path,method='GET',user='fan',origin='https://pilot.test')=>{const response=await donations(new Request('https://pilot.test/api/donations'+path,{method,headers:{Origin:origin}}),env,user?{id:user}:null);return {status:response.status,data:await response.json()};};
 const token='12345678-1234-1234-1234-123456789abc';state('donation-intent:'+token,{user:'fan',created:now});
 const payload=(extra={})=>new URLSearchParams({receiver_email:'meltcom@gmail.com',txn_id:'TXN123456',payment_status:'Completed',txn_type:'web_accept',mc_currency:'USD',mc_gross:'1.00',custom:token,...extra}).toString();
 const ipn=async(extra={},verified='VERIFIED')=>{const response=await donations(new Request('https://pilot.test/api/donations/ipn',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:payload(extra)}),env,null,async(url,options)=>{assert.equal(url,'https://ipnpb.paypal.com/cgi-bin/webscr');assert.equal(options.body,'cmd=_notify-validate&'+payload(extra));return new Response(verified);});return {status:response.status,data:await response.json()};};
 return {db,sql,env,now,points,state,call,ipn,payload,token};
}
test('checkout requires authenticated trusted member, enabled feature, same origin, and near-limit allowance',async()=>{
 const x=setup();assert.equal((await x.call('/start','POST',null)).status,401);assert.equal((await x.call('/start','POST','new')).status,403);assert.equal((await x.call('/start','POST','fan','https://evil.test')).status,403);assert.equal((await x.call('/start','POST')).status,409);x.points();x.env.DONATION_RESETS_ENABLED='0';assert.equal((await x.call('/start','POST')).status,503);x.env.DONATION_RESETS_ENABLED='1';const r=await x.call('/start','POST');assert.equal(r.status,200);const url=new URL(r.data.url);assert.equal(url.origin,'https://www.paypal.com');assert.equal(url.searchParams.get('hosted_button_id'),'H83DMS4NXCZLG');assert.equal(url.searchParams.get('notify_url'),'https://pilot.test/api/donations/ipn');assert.match(url.searchParams.get('custom'),/^[a-f0-9-]{36}$/);
});
test('only PayPal-verified completed positive USD donation to configured recipient earns a credit; duplicate delivery is idempotent',async()=>{
 const x=setup();assert.equal((await x.ipn({},'INVALID')).status,400);assert.equal((await x.ipn({receiver_email:'other@example.com'})).status,400);assert.equal((await x.ipn({mc_gross:'0.00'})).status,400);assert.equal((await x.ipn({mc_currency:'EUR'})).status,400);assert.equal((await x.ipn({custom:'unknown'})).status,400);assert.equal((await x.ipn({payment_status:'Pending'})).status,200);assert.equal((await x.call('/status')).data.resetsAvailable,0);assert.equal((await x.ipn()).status,200);assert.equal((await x.ipn()).status,200);assert.equal((await x.call('/status')).data.resetsAvailable,1);assert.equal((await x.call('/status','GET','other')).data.resetsAvailable,0);
});
test('a donation reset restores 500-point allowance while preserving ledger; unlimited distinct donations support repeated resets',async()=>{
 const x=setup();x.points(500);await x.ipn();assert.equal((await x.call('/reset','POST','other')).status,409);let r=await x.call('/reset','POST');assert.equal(r.status,200);assert.equal(r.data.remaining,500);assert.equal(r.data.earnedToday,500);assert.equal(r.data.resetsAvailable,0);assert.equal((await x.call('/reset','POST')).status,409);
 await award(x.db,'next','fan','comment',500,3,x.now).run();assert.equal((await pointAllowance(x.db,'fan')).remaining,0);await x.ipn({txn_id:'TXNSECOND'});r=await x.call('/reset','POST');assert.equal(r.status,200);assert.equal(r.data.earnedToday,1000);assert.equal(r.data.remaining,500);assert.equal(x.sql.prepare('SELECT SUM(amount) n FROM points').get().n,1000);
});
test('unused credits are not consumed early and a daily offset never carries into the next UTC day',async()=>{
 const x=setup();x.points(450);await x.ipn();await x.call('/reset','POST');await x.ipn({txn_id:'TXNLATER'});assert.equal((await x.call('/reset','POST')).status,409);assert.equal((await x.call('/status')).data.resetsAvailable,1);const tomorrow=new Date(Date.parse(x.now)+86400000).toISOString();const next=await pointAllowance(x.db,'fan',tomorrow);assert.equal(next.remaining,500);assert.equal(next.earnedToday,0);assert.notEqual(offsetKey('fan',tomorrow),offsetKey('fan',x.now));
});
test('refunds revoke unused credits and block out-of-order completed payment replay',async()=>{
 const x=setup();await x.ipn();await x.ipn({txn_id:'TXNREFUND',parent_txn_id:'TXN123456',payment_status:'Refunded',mc_gross:'-1.00'});await x.ipn();assert.equal((await x.call('/status')).data.resetsAvailable,0);await x.ipn({txn_id:'TXNREVERSAL',parent_txn_id:'TXNFUTURE',payment_status:'Reversed'});await x.ipn({txn_id:'TXNFUTURE'});assert.equal((await x.call('/status')).data.resetsAvailable,0);
});
test('normal trusted awards remain capped at 500; negative awards cannot manufacture allowance',async()=>{
 const x=setup();x.points(490);await award(x.db,'partial','fan','comment',20,3,x.now).run();await award(x.db,'blocked','fan','comment',20,3,x.now).run();x.points(-100);assert.equal((await pointAllowance(x.db,'fan')).remaining,0);assert.equal(x.sql.prepare('SELECT amount FROM points WHERE id=\'partial\'').get().amount,10);assert.equal(x.sql.prepare('SELECT amount FROM points WHERE id=\'blocked\'').get().amount,0);
});
test('sandbox uses isolated PayPal endpoints and receiver, rejects live notifications and cannot run on production hosts',async()=>{
 const x=setup();x.env.PAYPAL_MODE='sandbox';x.env.PAYPAL_SANDBOX_RECEIVER_EMAIL='sandbox@example.test';x.env.PAYPAL_SANDBOX_BUTTON_ID='SANDBOXBUTTON';x.points();const checkout=await x.call('/start','POST');assert.equal(new URL(checkout.data.url).origin,'https://www.sandbox.paypal.com');
 const body=x.payload({receiver_email:'sandbox@example.test',test_ipn:'1'});
 const response=await donations(new Request('https://pilot.test/api/donations/ipn',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}),x.env,null,async url=>{assert.equal(url,'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr');return new Response('VERIFIED');});assert.equal(response.status,200);assert.equal((await x.call('/status')).data.resetsAvailable,1);
 assert.equal((await x.ipn()).status,400);
 const blocked=await donations(new Request('https://reactionjourney.com/api/donations/start',{method:'POST',headers:{Origin:'https://reactionjourney.com'}}),x.env,{id:'fan'});assert.equal(blocked.status,503);
});
