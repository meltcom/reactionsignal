import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVideo,selectVideos,viewGain,suggestCategories} from '../missioned-souls-core.mjs';
import {missionedSouls,refreshMissionedSouls,readMissionedSouls,scheduledMissionedSouls} from '../server/missioned-souls.mjs';
import {DatabaseSync} from 'node:sqlite';
function database(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');return {prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(ops){const result=[];for(const op of ops)result.push(await op.run());return result;}};}
const video=(id='C1yfkA_0_Sg',extra={})=>normalizeVideo({title:'Studio cover',url:'https://www.youtube.com/watch?v='+id,...extra});
test('manual Shorts classification preserves metadata and survives later refreshes in either direction',async()=>{
 const db=database(),seed={videos:[video(undefined,{tags:['OPM'],views:123})],coverage:'starter'},env={DB:db,YOUTUBE_API_KEY:'fixture'};
 const mark=isShort=>missionedSouls(new Request('https://reactionjourney.com/api/missioned-souls',{method:'POST',body:JSON.stringify({action:'set-short',id:'yt:C1yfkA_0_Sg',isShort})}),env,seed,{id:'member',moderator:true});
 assert.equal((await mark(true)).status,200);
 let current=(await readMissionedSouls(db,seed)).videos[0];
 assert.deepEqual(current.tags,['OPM','Shorts']);assert.equal(current.views,123);assert.equal(current.reviewed,false);
 const fetcher=async url=>{const p=new URL(url).pathname;return Response.json(p.endsWith('/channels')?{items:[{id:'official',contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]}:p.endsWith('/playlistItems')?{items:[{contentDetails:{videoId:'C1yfkA_0_Sg'}}]}:{items:[{id:'C1yfkA_0_Sg',snippet:{title:'Studio cover #shorts',channelId:'official',publishedAt:'2026-01-01'},statistics:{viewCount:'456'}}]});};
 await refreshMissionedSouls(env,seed,fetcher);
 current=(await readMissionedSouls(db,seed)).videos[0];assert.ok(current.tags.includes('Shorts'));assert.equal(current.views,456);
 assert.equal((await mark(false)).status,200);
 await refreshMissionedSouls(env,seed,fetcher);
 current=(await readMissionedSouls(db,seed)).videos[0];assert.equal(current.tags.includes('Shorts'),false);assert.equal(current.shortsOverride,false);
 const denied=await missionedSouls(new Request('https://reactionjourney.com/api/missioned-souls',{method:'POST',body:JSON.stringify({action:'set-short',id:current.id,isShort:true})}),env,seed,{id:'member',moderator:false});assert.equal(denied.status,403);
});
test('overlapping categories and OPM Shorts inclusion',()=>{
 const a=video(undefined,{tags:['OPM','Shorts','Songs']}),b=video('3DzA_GoOE60',{tags:['OPM','Songs']});
 assert.equal(selectVideos([a,b],{category:'OPM'}).length,2);
 assert.equal(selectVideos([a,b],{category:'OPM',includeShorts:false}).length,1);
 assert.equal(selectVideos([a,b],{category:'Songs'}).length,2);
 assert.deepEqual(suggestCategories('Happy birthday vlog'),['All Vlogs','Birthday Vlogs']);
});
test('latest ten exclude missing dates; unknown counters are excluded but zero is valid',()=>{
 const list=Array.from({length:14},(_,i)=>video(undefined,{publishedAt:'2026-10-'+String(i+1).padStart(2,'0'),views:i}));
 list.push(video('3DzA_GoOE60'));
 assert.equal(selectVideos(list,{ranking:'recent'}).length,10);
 assert.equal(selectVideos(list,{ranking:'recent'})[0].views,13);
 assert.equal(selectVideos([video(),video('3DzA_GoOE60',{views:0})],{ranking:'views'}).length,1);
});
test('rolling windows require dated baselines, current data, and non-decreasing counts',()=>{
 const now=Date.parse('2026-10-07T12:00:00Z'),v={views:1000,statsAt:new Date(now).toISOString(),history:[{at:'2026-10-06T12:00:00Z',views:700},{at:'2026-09-30T12:00:00Z',views:300}]};
 assert.equal(viewGain(v,1,now),300);assert.equal(viewGain(v,7,now),700);assert.equal(viewGain(v,30,now),null);
 assert.equal(viewGain(v,1,now+3*86400000),null);assert.equal(viewGain({...v,views:100},1,now),null);
});
test('Facebook-only excludes cross-posts; URLs and statistics are validated',()=>{
 const fb=normalizeVideo({title:'Porch',url:'https://www.facebook.com/watch/?v=123'});
 assert.equal(selectVideos([fb,{...fb,id:'other',youtubeEquivalent:true}],{category:'Facebook only'}).length,1);
 assert.throws(()=>normalizeVideo({title:'x',url:'javascript:alert(1)'}));
 assert.throws(()=>video(undefined,{views:-1}));assert.throws(()=>video(undefined,{tags:['Fake']}));
});
test('mutations are moderator-only and unconfigured refresh preserves catalog',async()=>{
 const response=await missionedSouls(new Request('https://local/api/missioned-souls',{method:'POST',body:'{"action":"save"}'}),{}, {},{id:'member',moderator:false});assert.equal(response.status,403);
 const r=await refreshMissionedSouls({DB:{}},{});assert.equal(r.status,'blocked');
});
test('signed-in members can read the catalog',async()=>{
 const r=await missionedSouls(new Request('https://reactionjourney.com/api/missioned-souls'),{DB:database()},{videos:[]},{id:'member',moderator:false});
 assert.equal(r.status,200);
});
test('scheduled collection waits for moderator initiation and a daily refresh boundary',async()=>{
 const db=database(),env={DB:db,YOUTUBE_API_KEY:'fixture'};
 const noFetch=()=>{throw new Error('Unexpected API call');};
 assert.equal((await scheduledMissionedSouls(env,{},noFetch)).status,'idle');
 await db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('ms-refresh',JSON.stringify({status:'complete',lastCompleteAt:new Date().toISOString()})).run();
 assert.equal((await scheduledMissionedSouls(env,{},noFetch)).status,'waiting');
});
test('imports retain view history, reviewed tags survive refresh, and duplicate scans merge',async()=>{
 const db=database(),seed={videos:[],coverage:'starter'},v=video(undefined,{tags:['OPM'],reviewed:true,views:300,statsAt:'2026-10-06T12:00:00Z'});
 const req=body=>new Request('https://local/api/missioned-souls',{method:'POST',body:JSON.stringify(body)});
 const response=await missionedSouls(req({action:'import',videos:[{...v,history:[{at:'2026-10-05T12:00:00Z',views:100}]}]}),{DB:db},seed,{id:'member',moderator:true});assert.equal(response.status,200);
 const channel='UC1234567890123456789012';let calls=0;
 const fetcher=async url=>{calls++;const p=new URL(url).pathname;return new Response(JSON.stringify(p.endsWith('/channels')?{items:[{id:channel,contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]}:p.endsWith('/playlistItems')?{items:[{contentDetails:{videoId:'C1yfkA_0_Sg'}}]}:{items:[{id:'C1yfkA_0_Sg',snippet:{title:'Studio cover',channelId:channel,publishedAt:'2026-01-01T00:00:00Z'},statistics:{viewCount:'500',likeCount:'20'}}]}));};
 const env={DB:db,YOUTUBE_API_KEY:'test-secret'};await refreshMissionedSouls(env,seed,fetcher);await refreshMissionedSouls(env,seed,fetcher);
 const data=await readMissionedSouls(db,seed);assert.equal(data.videos.length,1);assert.deepEqual(data.videos[0].tags,['OPM']);assert.equal(data.videos[0].reviewed,true);assert.equal(data.videos[0].views,500);assert.equal(data.videos[0].comments,null);assert.equal(data.videos[0].history.length,3);assert.ok(data.refresh.lastCompleteAt);assert.equal(calls,5);
 const bad=await missionedSouls(req({action:'import',videos:[{...v,history:[{at:'invalid',views:3}]}]}),{DB:db},seed,{id:'member',moderator:true});assert.equal(bad.status,400);assert.equal((await readMissionedSouls(db,seed)).videos[0].views,500);
});
test('category lifecycle preserves assignments and rejects stale updates and member writes',async()=>{
 const db=database(),seed={videos:[video(undefined,{tags:['OPM']})]},env={DB:db};
 const request=body=>new Request('https://local/api/missioned-souls',{method:'POST',body:JSON.stringify(body)});
 const mod={id:'moderator',moderator:true};
 let catalog=await readMissionedSouls(db,seed);
 const act=async body=>{const r=await missionedSouls(request({action:'categories',revision:catalog.categoryRevision,...body}),env,seed,mod);assert.equal(r.status,200);catalog=await readMissionedSouls(db,seed);};
 await act({operation:'add',name:'Favorites'});
 const custom=catalog.categoryDefinitions.at(-1).id;
 const saved=await missionedSouls(request({action:'save',video:{...catalog.videos[0],tags:['OPM',custom]}}),env,seed,mod);assert.equal(saved.status,200,JSON.stringify(await saved.json()));
 await act({operation:'rename',id:custom,name:'Family favorites'});
 await act({operation:'move',id:custom,direction:-1});
 await act({operation:'archive',id:custom,archived:true});
 assert.deepEqual(catalog.videos[0].tags,['OPM',custom]);
 await act({operation:'archive',id:custom,archived:false});
 assert.equal(catalog.categoryDefinitions.find(c=>c.id===custom).name,'Family favorites');
 assert.deepEqual(catalog.videos[0].tags,['OPM',custom]);
 assert.equal((await missionedSouls(request({action:'categories',revision:0,operation:'add',name:'Stale'}),env,seed,mod)).status,409);
 assert.equal((await missionedSouls(request({action:'categories',revision:catalog.categoryRevision,operation:'archive',id:custom,archived:true}),env,seed,{id:'member',moderator:false})).status,403);
 assert.equal((await missionedSouls(new Request('https://local/api/missioned-souls'),env,seed,null)).status,401);
});
