import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseFixture} from './release-fixture.mjs';
import {seedDatabase} from '../server/db.mjs';
import {runDiscovery} from '../server/discovery.mjs';
import {SEARCH_STRATEGY} from '../server/discovery-measurement.mjs';

async function setup(){
 const {db,sql}=releaseFixture();
 const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[],videos:[]};
 await seedDatabase(db,seed);
 await db.prepare("UPDATE channels SET discovery_scope='other'").run();
 const env={DB:db,YOUTUBE_API_KEY:'fixture-only',DISCOVERY_DAILY_SEARCH_LIMIT:40};
 const put=(key,value)=>db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();
 const due=async()=>{await db.prepare("DELETE FROM state WHERE key='discovery-lease'").run();await put('search-touch:missioned-souls',new Date(Date.now()-37*60000).toISOString());};
 return {db,sql,seed,env,put,due};
}
test('three current first pages precede an unchanged legacy continuation, which remains resumable',async()=>{
 const {db,sql,seed,env,put,due}=await setup();
 const legacy={query:'"Missioned Souls"',term:0,page:'legacy-token',depth:3,rotation:4,after:'2026-01-01T00:00:00Z',startedAt:'2026-10-01T00:00:00Z'};
 const original=JSON.stringify(legacy);await put('search-progress:missioned-souls',original);
 const requests=[];
 const fake=async url=>{if(url.pathname.endsWith('/search')){requests.push(Object.fromEntries(url.searchParams));return Response.json({items:[],nextPageToken:'deeper-token'});}return Response.json({items:[]});};
 for(let n=0;n<4;n++){
  await due();await runDiscovery(env,seed,fake);
  if(n<3)assert.equal((await db.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first()).value,original);
 }
 assert.equal(requests.length,4);
 assert.deepEqual(requests.slice(0,3).map(request=>request.q), ['"Missioned Souls"', '"Missioned Souls" reaction', '"Missioned Souls"']);
 for(const req of requests.slice(0,3)){assert.equal(req.pageToken,undefined);assert.ok(Date.parse(req.publishedBefore)>Date.parse(legacy.startedAt));}
 assert.equal(requests[3].pageToken,'legacy-token');assert.equal(requests[3].publishedAfter,legacy.after);assert.equal(requests[3].publishedBefore,legacy.startedAt);
 const next=JSON.parse((await db.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first()).value);
 assert.equal(next.page,'deeper-token');assert.equal(next.depth,4);
 assert.equal(await db.prepare("SELECT value FROM state WHERE key='search:missioned-souls'").first(),null);
 const pages=sql.prepare('SELECT settings_json,strategy_version,page_depth FROM discovery_search_pages ORDER BY rowid').all();
 assert.deepEqual(pages.map(p=>JSON.parse(p.settings_json).lane),['fresh','fresh','fresh','catchup']);
 assert.deepEqual(pages.map(p=>p.page_depth),[1,1,1,3]);assert.ok(pages.every(p=>p.strategy_version===SEARCH_STRATEGY));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM discovery_search_attempts').get().n,4);
});
test('fresh and catch-up share pacing and reservations; a reached cap leaves both cursors intact',async()=>{
 const {db,seed,env,put,due}=await setup();let calls=0;
 const fake=async url=>{if(url.pathname.endsWith('/search'))calls++;return Response.json({items:[]});};
 await runDiscovery(env,seed,fake);await db.prepare("DELETE FROM state WHERE key='discovery-lease'").run();await runDiscovery(env,seed,fake);assert.equal(calls,1);
 assert.equal(JSON.parse((await db.prepare("SELECT value FROM state WHERE key='search-diagnostics:missioned-souls'").first()).value).status,'waiting');
 const cursor=JSON.stringify({query:'"Missioned Souls"',page:'keep',startedAt:'2026-10-01T00:00:00Z',after:null,term:0});
 await put('search-progress:missioned-souls',cursor);await put('search-fresh-progress:missioned-souls',cursor);
 await due();const result=await runDiscovery({...env,DISCOVERY_DAILY_SEARCH_LIMIT:1},seed,fake);
 assert.match(result.detail,/Daily search budget/);assert.equal(calls,1);
 for(const key of ['search-progress:missioned-souls','search-fresh-progress:missioned-souls'])assert.equal((await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first()).value,cursor);
});
test('a failed catch-up opportunity retains its cursor and yields the following opportunity to fresh work',async()=>{
 const {db,seed,env,put,due}=await setup();
 const cursor=JSON.stringify({query:'"Missioned Souls"',page:'retry-token',startedAt:'2026-10-01T00:00:00Z',after:null,term:0});
 await put('search-progress:missioned-souls',cursor);await put('search-lane-turn:missioned-souls','3');
 await runDiscovery(env,seed,async url=>url.pathname.endsWith('/search')?Response.json({error:{errors:[{reason:'forbidden'}]}},{status:403}):Response.json({items:[]}));
 assert.equal((await db.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first()).value,cursor);
 await due();let token='not-called';await runDiscovery(env,seed,async url=>{if(url.pathname.endsWith('/search'))token=url.searchParams.get('pageToken');return Response.json({items:[]});});
 assert.equal(token,null);assert.equal((await db.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first()).value,cursor);
});
test('catch-up completion alone advances its watermark and rotation',async()=>{
 const {db,seed,env,put}=await setup();
 const end='2026-10-01T00:00:00Z';await put('search-progress:missioned-souls',JSON.stringify({query:'"Missioned Souls"',page:'last',startedAt:end,after:null,term:0,rotation:7}));
 await put('search-lane-turn:missioned-souls','3');
 await runDiscovery(env,seed,async()=>Response.json({items:[]}));
 assert.equal((await db.prepare("SELECT value FROM state WHERE key='search:missioned-souls'").first()).value,end);
 assert.equal((await db.prepare("SELECT value FROM state WHERE key='search-rotation:missioned-souls'").first()).value,'8');
 assert.equal(await db.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first(),null);
});
test('legacy cursors without a fixed query still obey scheduled cross-lane pacing',async()=>{
 const {db,seed,env,put}=await setup();
 await put('search-progress:missioned-souls',JSON.stringify({term:0,page:'legacy',startedAt:'2026-10-01T00:00:00Z',after:null}));
 await put('search-lane-turn:missioned-souls','3');await put('search-touch:missioned-souls',new Date().toISOString());
 let searches=0;await runDiscovery(env,seed,async url=>{if(url.pathname.endsWith('/search'))searches++;return Response.json({items:[]});});
 assert.equal(searches,0);assert.equal((await db.prepare("SELECT value FROM state WHERE key='search-lane-turn:missioned-souls'").first()).value,'3');
});
test('fresh failure retries its fixed window without advancing the catch-up watermark',async()=>{
 const {db,seed,env,due}=await setup();let first;
 await runDiscovery(env,seed,async url=>{if(url.pathname.endsWith('/search')){first=Object.fromEntries(url.searchParams);return Response.json({error:{errors:[{reason:'forbidden'}]}},{status:403});}return Response.json({items:[]});});
 const pending=(await db.prepare("SELECT value FROM state WHERE key='search-fresh-progress:missioned-souls'").first()).value;
 assert.ok(pending);await due();let retried;
 await runDiscovery(env,seed,async url=>{if(url.pathname.endsWith('/search'))retried=Object.fromEntries(url.searchParams);return Response.json({items:[],nextPageToken:'not-a-fresh-continuation'});});
 assert.deepEqual(retried,first);
 assert.equal(await db.prepare("SELECT value FROM state WHERE key='search-fresh-progress:missioned-souls'").first(),null);
 assert.equal(await db.prepare("SELECT value FROM state WHERE key='search:missioned-souls'").first(),null);
 assert.equal(await db.prepare("SELECT value FROM state WHERE key='search-progress:missioned-souls'").first(),null);
});
