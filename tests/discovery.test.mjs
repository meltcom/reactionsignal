import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { seedDatabase, catalog, EXCLUDED } from '../server/db.mjs';
import { classify, seconds, saveVideo, runDiscovery, YouTube, searchDailyLimit } from '../server/discovery.mjs';
function db(){
  const sql=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));
  const database={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return database;
}
const channel='UC1234567890123456789012';
const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[{id:channel,name:'Sample reactor',performerId:'missioned-souls',url:`https://www.youtube.com/channel/${channel}`}],videos:[]};
function item(id='abcdefghijk',title='Missioned Souls reaction'){return {id,snippet:{channelId:channel,channelTitle:'Sample reactor',title,publishedAt:'2026-09-24T12:00:00Z'},contentDetails:{duration:'PT6M12S'},status:{privacyStatus:'public'}};}
test('zero search budget disables requests and reports the scheduling reason',async()=>{
 const d=await isolatedDiscovery();await d.prepare("UPDATE channels SET discovery_scope='other'").run();let searches=0;
 await runDiscovery({DB:d,YOUTUBE_API_KEY:'fixture-only',DISCOVERY_DAILY_SEARCH_LIMIT:'0'},seed,async url=>{if(url.pathname.endsWith('/search'))searches++;return Response.json({items:[]});});
 assert.equal(searches,0);const report=JSON.parse((await d.prepare("SELECT value FROM state WHERE key='search-diagnostics:missioned-souls'").first()).value);assert.equal(report.status,'disabled');assert.equal(report.dailyLimit,0);
 assert.equal(searchDailyLimit({}),20);assert.equal(searchDailyLimit({DISCOVERY_DAILY_SEARCH_LIMIT:'bad'}),20);
});
test('classifies exact performer names; holds ambiguous and short matches',()=>{
 assert.equal(classify('Missioned Souls reaction',['Missioned Souls'],400),'CONFIRMED');
 assert.equal(classify('NotMissioned Souls reaction',['Missioned Souls'],400),null);
 assert.equal(classify('Missioned Souls cover',['Missioned Souls'],400),'PENDING');
 assert.equal(classify('Missioned Souls reaction',['Missioned Souls'],90),'PENDING');
 assert.equal(seconds('PT1H2M3S'),3723);
});
test('seed is idempotent and applies prior exclusions',async()=>{
 const d=db(),input={...seed,videos:[{id:EXCLUDED[0],channelId:channel,title:'False positive',performerId:'missioned-souls',confidence:'CONFIRMED'}]};
 await seedDatabase(d,input);await seedDatabase(d,input);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM channels').first()).n,1);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM videos').first()).n,0);
});
test('repeated discovery preserves first discovery time and correction status',async()=>{
 const d=db();await seedDatabase(d,seed);const p=(await d.prepare('SELECT * FROM performers').all()).results;
 assert.equal(await saveVideo(d,item(),p,'2026-09-24T12:00:00Z','test'),1);
 assert.equal(await saveVideo(d,item(),p,'2026-09-25T12:00:00Z','test'),0);
 assert.equal((await d.prepare('SELECT discovered_at FROM videos').first()).discovered_at,'2026-09-24T12:00:00Z');
 await d.prepare("UPDATE matches SET status='PENDING'").run();await saveVideo(d,item(),p,'2026-09-25T13:00:00Z','test');
 assert.equal((await d.prepare('SELECT status FROM matches').first()).status,'PENDING');
 assert.equal(await saveVideo(d,item(EXCLUDED[0]),p,'2026-09-25T13:00:00Z','test'),0);
 assert.equal((await catalog(d,seed,{})).videos.length,0);
});
test('missing credentials never report success or fetch YouTube',async()=>{
 const d=db();const r=await runDiscovery({DB:d},seed,()=>{throw new Error('must not fetch');});assert.equal(r.status,'blocked');
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM runs').first()).n,0);
});
test('schedule status comes from actual scheduled invocations, not manual runs',async()=>{
 const d=db();await seedDatabase(d,seed);
 assert.equal((await catalog(d,seed,{YOUTUBE_API_KEY:'fixture-only'})).discovery.automation,'not_connected');
 await d.prepare("INSERT INTO state(key,value) VALUES('last-scheduled-invocation',?)").bind(new Date().toISOString()).run();
 assert.equal((await catalog(d,seed,{YOUTUBE_API_KEY:'fixture-only'})).discovery.automation,'active');
 await d.prepare("UPDATE state SET value=? WHERE key='last-scheduled-invocation'").bind(new Date(Date.now()-25*3600000).toISOString()).run();
 assert.equal((await catalog(d,seed,{YOUTUBE_API_KEY:'fixture-only'})).discovery.automation,'stale');
});
test('known channel scan persists data, searches once daily, and throttles repeats',async()=>{
 const d=db();let calls=0;const fake=async url=>{calls++;const endpoint=url.pathname.split('/').pop();return Response.json(endpoint==='channels'?{items:[{contentDetails:{relatedPlaylists:{uploads:'uploads-example'}}}]}:endpoint==='playlistItems'?{items:[{contentDetails:{videoId:'abcdefghijk',videoPublishedAt:'2026-09-24T12:00:00Z'}}]}:endpoint==='videos'?{items:[item()]}:{items:[]});};
 const env={DB:d,YOUTUBE_API_KEY:'fixture-only'};const result=await runDiscovery(env,seed,fake);
 assert.equal(result.status,'succeeded');assert.equal(result.added,1);assert.equal(result.channels,1);
 assert.ok((await d.prepare('SELECT checked_at FROM channels').first()).checked_at);
 const before=calls;assert.equal((await runDiscovery(env,seed,fake)).status,'busy');assert.equal(calls,before);
});
test('quota rejection leaves the scan resumable and last successful date empty',async()=>{
 const d=db();const r=await runDiscovery({DB:d,YOUTUBE_API_KEY:'fixture-only'},seed,async()=>Response.json({error:{errors:[{reason:'quotaExceeded'}]}},{status:403}));
 assert.equal(r.status,'partial');assert.match(r.detail,/quotaExceeded/);
 assert.equal((await d.prepare('SELECT checked_at FROM channels').first()).checked_at,null);
 assert.equal((await catalog(d,seed,{})).discovery.lastSuccessfulBatchAt,null);
});
test('transient errors retry without leaking the API key',async()=>{
 let calls=0;const api=new YouTube('never-log-this',async url=>{assert.equal(url.searchParams.has('key'),false);return ++calls===1?Response.json({}, {status:503}):Response.json({items:[]});});
 assert.deepEqual(await api.get('videos',{id:'abcdefghijk'}),{items:[]});assert.equal(api.calls,2);
});
test('real pilot seed loads persistently without reintroducing excluded videos',async()=>{
 const input=JSON.parse(readFileSync(new URL('../data.json',import.meta.url),'utf8'));const d=db();
 await seedDatabase(d,input);await seedDatabase(d,input);const result=await catalog(d,input,{});
 assert.ok(result.videos.length>300);assert.ok(result.channels.length>=390);
 assert.equal(result.videos.some(v=>EXCLUDED.includes(v.id)),false);
 assert.equal(result.videos.some(v=>v.id==='gXWQQNUpKcA'),false);
 assert.equal(result.discovery.automation,'not_connected');
});
test('reviewed discovery run imports once with probable labels and duplicate holds',async()=>{
 const input=JSON.parse(readFileSync(new URL('../data.json',import.meta.url),'utf8'));
 input.importRun=JSON.parse(readFileSync(new URL('../import-run.json',import.meta.url),'utf8'));
 const d=db();await seedDatabase(d,input);await seedDatabase(d,input);
 const result=await catalog(d,input,{});
 const imported=result.videos.filter(v=>v.source===`v3.3.1 import ${input.importRun.id}`);
 assert.equal(imported.length,63);
 assert.equal(imported.filter(v=>v.confidence==='PROBABLE').length,8);
 assert.equal(result.channels.filter(c=>c.currentDiscovery).length,2);
 assert.equal(input.importRun.channels.length,7);
 for(const held of input.importRun.possibleDuplicates) assert.equal((await d.prepare('SELECT id FROM channels WHERE id=?').bind(held.candidateId).first()),null);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM state WHERE key=?').bind(`import:${input.importRun.id}`).first()).n,1);
});
test('packaged Worker gates catalog and status behind member sign-in',async(t)=>{
 const worker=(await import('../dist/server/index.js')).default;const env={DB:db(),SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'member',email:'fan@example.com',email_confirmed_at:'2026-09-29T00:00:00Z'}));
 for(const path of ['/data.json','/api/status']){
  const anonymous=await worker.fetch(new Request('https://pilot.test'+path),env);assert.equal(anonymous.status,401);
  const forged=await worker.fetch(new Request('https://pilot.test'+path,{headers:{'oai-authenticated-user-id':'owner'}}),env);assert.equal(forged.status,401);
 }
 const catalogResponse=await worker.fetch(new Request('https://pilot.test/data.json',{headers:{Authorization:'Bearer verified.token'}}),env);
 assert.equal(catalogResponse.status,200);assert.ok((await catalogResponse.json()).videos.length>300);
 const rejected=await worker.fetch(new Request('https://pilot.test/api/discovery/run',{method:'POST'}),env);assert.equal(rejected.status,401);
 const unavailable=await worker.fetch(new Request('https://pilot.test/data.json'),{});assert.equal(unavailable.status,503);
 const home=await worker.fetch(new Request('https://pilot.test/'),env);assert.equal(home.status,200);const html=await home.text();assert.match(html,/Sign in to continue/);assert.match(html,/id="memberApp" hidden inert/);
});

test('performer onboarding resumes history pages, honors daily budgets, and keeps drafts private',async()=>{
 const d=db();await seedDatabase(d,seed);
 await d.prepare("INSERT INTO performers(id,name,aliases,status,review_mode,lookback_days) VALUES('new-act','New Act','[\"New Act\"]','draft','review',90)").run();
 const env={DB:d,YOUTUBE_API_KEY:'test-key',DISCOVERY_DAILY_SEARCH_LIMIT:1};let searches=0,firstWindow;
 const fetcher=async request=>{
  const u=new URL(request);
  if(u.pathname.endsWith('/search')){
   searches++;assert.equal(u.searchParams.get('q'),'"New Act" reaction');
   if(searches===1){firstWindow=u.searchParams.get('publishedAfter');return Response.json({items:[{id:{videoId:'abcdefghijk'}}],nextPageToken:'next-page'});}
   assert.equal(u.searchParams.get('pageToken'),'next-page');assert.equal(u.searchParams.get('publishedAfter'),firstWindow);
   return Response.json({items:[]});
  }
  if(u.pathname.endsWith('/videos'))return Response.json({items:[item('abcdefghijk','New Act reaction')]});
  throw new Error('Targeted onboarding should not scan unrelated channels');
 };
 const first=await runDiscovery(env,seed,fetcher,{performerId:'new-act'});assert.equal(first.status,'partial');
 const progress=(await d.prepare("SELECT value FROM state WHERE key='search-progress:new-act'").first()).value;
 assert.equal(JSON.parse(progress).page,'next-page');
 assert.equal((await d.prepare("SELECT status FROM matches WHERE performer_id='new-act'").first()).status,'PENDING');
 assert.equal((await catalog(d,seed,env)).performers.some(p=>p.id==='new-act'),false);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 const capped=await runDiscovery(env,seed,fetcher,{performerId:'new-act'});assert.equal(capped.status,'partial');assert.match(capped.detail,/Daily search budget/);assert.equal(searches,1);
 assert.equal((await d.prepare("SELECT value FROM state WHERE key='search-progress:new-act'").first()).value,progress);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease' OR key LIKE 'search-budget:%'").run();
 await runDiscovery(env,seed,fetcher,{performerId:'new-act'});assert.equal(searches,2);
 assert.equal(await d.prepare("SELECT value FROM state WHERE key='search-progress:new-act'").first(),null);
 assert.ok(await d.prepare("SELECT value FROM state WHERE key='search:new-act'").first());
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await runDiscovery(env,seed,fetcher,{performerId:'new-act'});assert.equal(searches,2);
});
test('unknown durations remain held for review even with a clear title',()=>{
 assert.equal(classify('New Act reaction',['New Act'],null),'PENDING');
});

async function isolatedDiscovery(){
 const d=db();await seedDatabase(d,seed);
 await d.prepare("UPDATE channels SET discovery_scope='other'").run();
 await d.prepare("UPDATE channels SET discovery_scope='eligible',uploads='active-uploads',recent_checked_at=? WHERE id=?").bind(new Date(Date.now()-2*3600000).toISOString(),channel).run();
 const performers=(await d.prepare("SELECT * FROM performers WHERE id='missioned-souls'").all()).results;
 const video=item();video.snippet.publishedAt=new Date(Date.now()-86400000).toISOString();
 await saveVideo(d,video,performers,new Date().toISOString(),'fixture');
 return d;
}
test('active reactors retain reserved slots during a daily backlog, and search precedes history',async()=>{
 const d=await isolatedDiscovery();
 for(let i=0;i<8;i++)await d.prepare("INSERT INTO channels(id,name,uploads,discovery_scope) VALUES(?,?,?,'eligible')").bind('backlog-'+i,'Backlog','backlog-uploads-'+i).run();
 await d.prepare("UPDATE channels SET next_page='older',scan_before='2020-01-01' WHERE id=?").bind(channel).run();
 const requests=[];const fake=async url=>{requests.push({endpoint:url.pathname.split('/').pop(),playlist:url.searchParams.get('playlistId'),page:url.searchParams.get('pageToken')});return Response.json({items:[]});};
 await runDiscovery({DB:d,YOUTUBE_API_KEY:'fixture-only',DISCOVERY_RECENT_BATCH_SIZE:4},seed,fake);
 const recent=requests.filter(r=>r.endpoint==='playlistItems'&&!r.page);
 assert.equal(recent.length,4);assert.equal(recent[0].playlist,'active-uploads');
 assert.equal(new Set(recent.map(r=>r.playlist)).size,4);
 assert.ok(requests.findIndex(r=>r.endpoint==='search')<requests.findIndex(r=>r.page==='older'));
});
test('completed searches repeat after two hours within the daily cap',async()=>{
 const d=await isolatedDiscovery();
 await d.prepare("UPDATE channels SET discovery_scope='other'").run();
 const now=new Date().toISOString();
 await d.prepare("INSERT INTO state(key,value) VALUES('search:missioned-souls',?)").bind(now).run();
 let searches=0;const fake=async url=>{if(url.pathname.endsWith('/search'))searches++;return Response.json({items:[]});};
 const env={DB:d,YOUTUBE_API_KEY:'fixture-only',DISCOVERY_DAILY_SEARCH_LIMIT:1};
 await runDiscovery(env,seed,fake);assert.equal(searches,0);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await d.prepare("UPDATE state SET value=? WHERE key='search:missioned-souls'").bind(new Date(Date.now()-3*3600000).toISOString()).run();
 await runDiscovery(env,seed,fake);assert.equal(searches,1);
 await d.prepare("DELETE FROM state WHERE key='discovery-lease'").run();
 await d.prepare("UPDATE state SET value=? WHERE key='search:missioned-souls'").bind(new Date(Date.now()-3*3600000).toISOString()).run();
 const capped=await runDiscovery(env,seed,fake);assert.equal(searches,1);assert.match(capped.detail,/Daily search budget/);
});
