import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {community,tier,profilePicture} from '../server/community.mjs';
const helpers=readFileSync(new URL('../community.js',import.meta.url),'utf8').split('let communityState=')[0];
const context=vm.createContext({escapeHtml:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
vm.runInContext(helpers,context);
test('point badge boundaries match server tiers including reversals',()=>{
 for(const points of [-5,0,24,25,99,100,249,250,999,1000,1500])assert.equal(context.memberPointLevel(points).label,tier(points));
 assert.equal(context.memberPointLevel(24).key,'novice');
 assert.equal(context.memberPointLevel(25).key,'contributor');
});
test('badges precede safely escaped names and have accessible point labels',()=>{
 const html=context.memberDisplayName('<img onerror="alert(1)">',1000);
 assert.ok(html.indexOf('badge-champion')<html.indexOf('&lt;img'));
 assert.match(html,/aria-label="Community champion · 1,000 points"/);
 assert.ok(!html.includes('<img'));
 assert.equal(context.memberPointBadge(undefined),'');
 assert.equal(context.memberPointBadge('invalid'),'');
 assert.equal(context.memberPointBadge(Infinity),'');
 assert.match(context.memberBadgeLegend(),/250–999/);
});

import {DatabaseSync} from 'node:sqlite';
import {readdirSync} from 'node:fs';
import {seedDatabase} from '../server/db.mjs';
import {social} from '../server/social.mjs';
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

test('comment, chat, mention, leaderboard and moderator APIs return current ledger totals',async()=>{
 const {sql,call,video,env}=await setup();video();
 await call('/profile',{name:'fan',icon:'headphones',color:'blue'});
 const now=new Date().toISOString();
 sql.prepare('INSERT INTO points VALUES(?,?,?,?,?)').run('badge-award','fan','test',250,now);
 sql.prepare("INSERT INTO contributions(id,user_id,kind,video_id,performer_id,body,status,created_at) VALUES('badge-comment','fan','comment','abcdefghijk','missioned-souls','@other Great reaction','accepted',?)").run(now);
 sql.prepare("INSERT INTO chat_messages(id,room,user_id,body,status,created_at) VALUES('badge-chat','missioned-souls','fan','@other Great music','visible',?)").run(now);
 const socialGet=async path=>{const response=await social(new Request('https://pilot.test/api/social'+path),env,seed,{id:'other',moderator:false});assert.equal(response.status,200);return response.json();};
 const verify=async expected=>{
  assert.equal((await call('/video?id=abcdefghijk')).data.comments[0].points,expected);
  assert.equal((await call('/queue',null,'owner')).data.items.find(c=>c.id==='badge-comment').points,expected);
  assert.equal((await call('/users',null,'owner')).data.items.find(m=>m.id==='fan').points,expected);
  assert.equal((await call('/summary')).data.leaders.find(m=>m.name==='fan').points,expected);
  assert.equal((await socialGet('/comments?video=abcdefghijk')).items[0].points,expected);
  assert.equal((await socialGet('/chat?room=missioned-souls')).messages[0].points,expected);
  assert.equal((await socialGet('/chat?room=missioned-souls')).messages[0].profile_icon,'headphones');
  assert.equal((await socialGet('/comments?video=abcdefghijk')).items[0].profile_color,'blue');
  assert.equal((await call('/summary')).data.leaders.find(m=>m.name==='fan').profile_icon,'headphones');
  const mentions=await socialGet('/mentions');assert.equal(mentions.items[0].points,expected);assert.equal(mentions.comments[0].points,expected);
 };
 await verify(250);
 sql.prepare('INSERT INTO points VALUES(?,?,?,?,?)').run('badge-deduction','fan','reversal',-151,now);
 await verify(99);sql.close();
});


test('profile icons persist per account, reject unsafe values, and preserve choices on name-only edits',async()=>{
 const {sql,call}=await setup();
 assert.equal((await call('/profile',{name:'Music Fan',icon:'guitar',color:'purple'})).status,200);
 let me=(await call('/summary')).data;assert.equal(me.profile_icon,'guitar');assert.equal(me.profile_color,'purple');
 assert.equal((await call('/summary',null,'other')).data.profile_icon,'initials');
 assert.equal((await call('/profile',{name:'Renamed Fan'})).status,200);
 assert.equal((await call('/summary')).data.profile_icon,'guitar');
 for(const body of [{icon:'<script>'},{color:'red; background:url(https://evil.test)'}])assert.equal((await call('/profile',{name:'Music Fan',...body})).status,400);
 assert.equal((await call('/profile',{name:'Music Fan',icon:'initials',color:'teal'})).status,200);
 assert.equal((await call('/summary')).data.profile_icon,'initials');sql.close();
});
test('profile icon markup escapes initials and falls back for invalid styling',()=>{
 const html=context.memberProfileIcon('<img','unknown','evil');
 assert.match(html,/profile-color-teal/);assert.ok(!html.includes('<img'));assert.ok(!html.includes('evil'));
 assert.match(context.memberDisplayName('Fan',25,{profile_icon:'guitar',profile_color:'purple'}),/🎸/);
});


test('pictures upload, replace, render, and remove without affecting other accounts',async()=>{
 const {sql,call,env}=await setup();
 const picture='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3EKKKKACiiigAooooA//Z';
 assert.equal((await call('/profile',{name:'fan',picture})).status,200);
 const first=(await call('/summary')).data.profile_picture;assert.match(first,/^\/api\/profile-pictures\//);
 assert.equal((await call('/summary',null,'other')).data.profile_picture,null);
 const response=await profilePicture(new Request('https://pilot.test'+first),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/jpeg');assert.ok((await response.arrayBuffer()).byteLength>0);
 assert.equal((await call('/profile',{name:'renamed'})).status,200);assert.equal((await call('/summary')).data.profile_picture,first);
 for(const bad of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,AAAA',picture+'x'.repeat(44000)])assert.equal((await call('/profile',{name:'fan',picture:bad})).status,400);
 assert.equal((await call('/summary')).data.profile_picture,first);
 await call('/profile',{name:'fan',picture});const second=(await call('/summary')).data.profile_picture;assert.notEqual(first,second);
 assert.equal((await profilePicture(new Request('https://pilot.test'+first),env)).status,404);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM profile_pictures').get().n,1);
 await call('/profile',{name:'fan',picture:null});assert.equal((await call('/summary')).data.profile_picture,null);
 assert.equal((await profilePicture(new Request('https://pilot.test'+second),env)).status,404);sql.close();
});
test('picture rendering accepts only the site picture route',()=>{
 assert.match(context.memberProfileIcon('fan','initials','teal','/api/profile-pictures/12345678-1234-1234-1234-123456789abc'),/<img/);
 assert.ok(!context.memberProfileIcon('fan','initials','teal','https://evil.test/tracker').includes('<img'));
});
