import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVideo,selectVideos,viewGain,suggestCategories} from '../missioned-souls-core.mjs';
import {missionedSouls,missionedSoulsThumbnail,refreshMissionedSouls,readMissionedSouls,scheduledMissionedSouls} from '../server/missioned-souls.mjs';
import {DatabaseSync} from 'node:sqlite';
function database(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE members(id TEXT PRIMARY KEY,trusted INTEGER NOT NULL DEFAULT 0); CREATE TABLE points(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,created_at TEXT NOT NULL)');return {sql,prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(ops){const result=[];for(const op of ops)result.push(await op.run());return result;}};}
const video=(id='C1yfkA_0_Sg',extra={})=>normalizeVideo({title:'Studio cover',url:'https://www.youtube.com/watch?v='+id,...extra});
test('manual Shorts classification preserves metadata and survives later refreshes in either direction',async()=>{
 const db=database(),seed={videos:[video(undefined,{tags:['OPM'],views:123})],coverage:'starter'},env={DB:db,YOUTUBE_API_KEY:'fixture'};
 const mark=isShort=>missionedSouls(new Request('https://reactionjourney.com/api/missioned-souls',{method:'POST',body:JSON.stringify({action:'set-short',id:'yt:C1yfkA_0_Sg',isShort})}),env,seed,{id:'member',moderator:true});
 assert.equal((await mark(true)).status,200);
 let current=(await readMissionedSouls(db,seed)).videos[0];
 assert.deepEqual(current.tags.filter(t=>!t.startsWith('playlist:')&&!t.startsWith('year:')),['OPM','Shorts']);assert.equal(current.views,123);assert.equal(current.reviewed,false);
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
test('video enrichment validates permanent thumbnails, duration and statistics provenance',()=>{
 const v=normalizeVideo({title:'Facebook reel',url:'https://www.facebook.com/reel/123/',thumbnailUrl:'https://images.example/reel.jpg#fragment',durationSeconds:43.4,statsPrecision:'rounded',statsSource:'Facebook public reel'});
 assert.equal(v.thumbnailUrl,'https://images.example/reel.jpg');assert.equal(v.durationSeconds,43);assert.equal(v.statsPrecision,'rounded');assert.equal(v.statsSource,'Facebook public reel');
 assert.equal(normalizeVideo({...v,thumbnailUrl:'/api/missioned-souls/thumbnails/123e4567-e89b-12d3-a456-426614174000'}).thumbnailUrl,'/api/missioned-souls/thumbnails/123e4567-e89b-12d3-a456-426614174000');
 for(const thumbnailUrl of ['http://images.example/reel.jpg','javascript:alert(1)','/untrusted/image.jpg'])assert.throws(()=>normalizeVideo({...v,thumbnailUrl}));
 assert.throws(()=>normalizeVideo({...v,durationSeconds:-1}));assert.throws(()=>normalizeVideo({...v,statsPrecision:'estimated'}));
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
 const data=await readMissionedSouls(db,seed);assert.equal(data.videos.length,1);assert.deepEqual(data.videos[0].tags.filter(t=>!t.startsWith('playlist:')&&!t.startsWith('year:')),['OPM']);assert.equal(data.videos[0].reviewed,true);assert.equal(data.videos[0].views,500);assert.equal(data.videos[0].comments,null);assert.equal(data.videos[0].history.length,3);assert.ok(data.refresh.lastCompleteAt);assert.equal(calls,5);
 const bad=await missionedSouls(req({action:'import',videos:[{...v,history:[{at:'invalid',views:3}]}]}),{DB:db},seed,{id:'member',moderator:true});assert.equal(bad.status,400);assert.equal((await readMissionedSouls(db,seed)).videos[0].views,500);
});
test('bulk statistics imports enrich existing videos and keep dated likes and comments history atomically',async()=>{
 const db=database(),base=normalizeVideo({title:'Facebook reel',url:'https://www.facebook.com/reel/123/'}),seed={videos:[base],coverage:'starter'},env={DB:db},mod={id:'moderator',moderator:true};
 const req=body=>new Request('https://local/api/missioned-souls',{method:'POST',body:JSON.stringify(body)});
 const record={url:base.url,statsAt:'2026-10-27T12:00:00Z',views:1200,likes:88,comments:14,statsPrecision:'rounded',statsSource:'Facebook public reel',durationSeconds:43,thumbnailUrl:'https://images.example/reel.jpg'};
 const imported=await missionedSouls(req({action:'stats-import',records:[record]}),env,seed,mod);assert.equal(imported.status,200,JSON.stringify(await imported.json()));
 let saved=(await readMissionedSouls(db,seed)).videos[0];assert.equal(saved.views,1200);assert.equal(saved.likes,88);assert.equal(saved.comments,14);assert.equal(saved.durationSeconds,43);assert.equal(saved.thumbnailUrl,record.thumbnailUrl);assert.deepEqual(saved.history.map(({views,likes,comments,statsPrecision,statsSource})=>({views,likes,comments,statsPrecision,statsSource})),[{views:1200,likes:88,comments:14,statsPrecision:'rounded',statsSource:'Facebook public reel'}]);
 const rejected=await missionedSouls(req({action:'stats-import',records:[{...record,views:1300},{url:'https://www.facebook.com/reel/missing/',statsAt:record.statsAt,views:1}]}),env,seed,mod);assert.equal(rejected.status,400);saved=(await readMissionedSouls(db,seed)).videos[0];assert.equal(saved.views,1200);
 assert.equal((await missionedSouls(req({action:'stats-import',records:[{url:base.url,views:1}]}),env,seed,mod)).status,400);
});
test('moderators can store a resized thumbnail and the immutable image endpoint serves it',async()=>{
 const db=database(),env={DB:db},bytes=Uint8Array.from([255,216,255,192,0,17,8,0,1,0,1,3,1,17,0,2,17,0,3,17,0,255,217]);
 const data='data:image/jpeg;base64,'+Buffer.from(bytes).toString('base64'),body={action:'thumbnail',videoUrl:'https://www.facebook.com/reel/123/',data};
 const uploaded=await missionedSouls(new Request('https://local/api/missioned-souls',{method:'POST',body:JSON.stringify(body)}),env,{videos:[]},{id:'moderator',moderator:true});assert.equal(uploaded.status,200);const result=await uploaded.json();assert.match(result.thumbnailUrl,/^\/api\/missioned-souls\/thumbnails\/[a-f0-9-]{36}$/);
 const image=await missionedSoulsThumbnail(new Request('https://local'+result.thumbnailUrl),env);assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/jpeg');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);
 assert.equal((await missionedSouls(new Request('https://local/api/missioned-souls',{method:'POST',body:JSON.stringify(body)}),env,{videos:[]},{id:'member',moderator:false})).status,403);
});
test('trusted members add public Facebook videos to Community finds with metadata, permanent thumbnails and 25 points',async()=>{
 const db=database(),seed={videos:[]},env={DB:db},trusted={id:'trusted-member'},ordinary={id:'ordinary-member'};
 db.sql.exec("INSERT INTO members(id,trusted) VALUES('trusted-member',1),('ordinary-member',0)");
 const req=body=>new Request('https://reactionjourney.com/api/missioned-souls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const catalog=await (await missionedSouls(new Request('https://reactionjourney.com/api/missioned-souls'),env,seed,trusted)).json();assert.equal(catalog.canAddVideos,true);
 const ordinaryCatalog=await (await missionedSouls(new Request('https://reactionjourney.com/api/missioned-souls'),env,seed,ordinary)).json();assert.equal(ordinaryCatalog.canAddVideos,false);
 const bytes=Uint8Array.from([255,216,255,192,0,17,8,0,1,0,1,3,1,17,0,2,17,0,3,17,0,255,217]);
 const video={title:'Community concert find',url:'https://www.facebook.com/reel/community-reel-123/',publishedAt:'2026-10-20T00:00:00.000Z',durationSeconds:94,views:1200,likes:80,comments:12,statsAt:'2026-10-27T12:00:00.000Z',statsPrecision:'rounded',statsSource:'Public Facebook reel',tags:['Live Concerts']};
 const body={action:'community-add',video,publicConfirmed:true,thumbnailData:'data:image/jpeg;base64,'+Buffer.from(bytes).toString('base64')};
 const response=await missionedSouls(req(body),env,seed,trusted);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).points,25);
 const saved=(await readMissionedSouls(db,seed)).videos[0];assert.equal(saved.platform,'Facebook');assert.equal(saved.durationSeconds,94);assert.equal(saved.thumbnailUrl.startsWith('/api/missioned-souls/thumbnails/'),true);assert.ok(saved.tags.includes('Community finds'));assert.ok(saved.tags.includes('Live Concerts'));assert.deepEqual(saved.history.map(({views,likes,comments,statsPrecision,statsSource})=>({views,likes,comments,statsPrecision,statsSource})),[{views:1200,likes:80,comments:12,statsPrecision:'rounded',statsSource:'Public Facebook reel'}]);
 const image=await missionedSoulsThumbnail(new Request('https://reactionjourney.com'+saved.thumbnailUrl),env);assert.equal(image.status,200);assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);
 assert.equal(db.sql.prepare('SELECT SUM(amount) amount FROM points WHERE user_id=?').get(trusted.id).amount,25);
 assert.equal((await missionedSouls(req(body),env,seed,trusted)).status,409);
 assert.equal(db.sql.prepare('SELECT COUNT(*) count FROM points WHERE user_id=?').get(trusted.id).count,1);
 assert.equal((await missionedSouls(req({...body,video:{...video,url:'https://www.facebook.com/reel/community-reel-456/'},publicConfirmed:false}),env,seed,trusted)).status,400);
 assert.equal((await missionedSouls(req(body),env,seed,ordinary)).status,403);
 assert.equal((await missionedSouls(req({...body,video:{...video,url:'https://www.facebook.com/ordinary/profile/'} }),env,seed,trusted)).status,400);
});
test('trusted members can fetch public Facebook details and thumbnail without writing catalog data',async()=>{
 const db=database(),env={DB:db},seed={videos:[]},trusted={id:'trusted-member'},ordinary={id:'ordinary-member'};
 db.sql.exec("INSERT INTO members(id,trusted) VALUES('trusted-member',1),('ordinary-member',0)");
 const html='<html><head><meta property="og:title" content="Missioned Souls live &amp; loud"><meta property="og:image" content="https://scontent.xx.fbcdn.net/video-thumb.jpg"><meta property="og:video:duration" content="94"><meta property="article:published_time" content="2026-10-20T00:00:00Z"><meta property="video:view_count" content="1234"><meta property="video:likes" content="81"><meta property="video:comments" content="12"></head></html>';
 const fetcher=async(url,options)=>{assert.equal(options.redirect,'manual');return String(url).includes('fbcdn.net')?new Response(Uint8Array.from([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}}):new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});};
 const req=body=>new Request('https://reactionjourney.com/api/missioned-souls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const response=await missionedSouls(req({action:'fetch-facebook-metadata',url:'https://www.facebook.com/reel/public-reel-123/'}),env,seed,trusted,fetcher);
 assert.equal(response.status,200);const details=await response.json();assert.equal(details.title,'Missioned Souls live & loud');assert.equal(details.durationSeconds,94);assert.equal(details.publishedAt,'2026-10-20T00:00:00.000Z');assert.equal(details.views,1234);assert.equal(details.likes,81);assert.equal(details.comments,12);assert.match(details.thumbnailData,/^data:image\/jpeg;base64,/);assert.equal(details.statsSource,'Facebook public page metadata');
 assert.equal((await missionedSouls(req({action:'fetch-facebook-metadata',url:'https://www.facebook.com/reel/public-reel-123/'}),env,seed,ordinary,fetcher)).status,403);
 assert.equal((await missionedSouls(req({action:'fetch-facebook-metadata',url:'https://example.com/reel/public-reel-123/'}),env,seed,trusted,fetcher)).status,400);
 assert.equal((await db.prepare("SELECT COUNT(*) count FROM state").first()).count,0);
});
test('Facebook metadata fetch returns useful partial video metadata when the public page has no title',async()=>{
 const db=database(),env={DB:db},seed={videos:[]},trusted={id:'trusted-member'};
 db.sql.exec("INSERT INTO members(id,trusted) VALUES('trusted-member',1)");
 const html='<html><head><meta property="og:type" content="video.other"><meta property="og:image" content="https://scontent.xx.fbcdn.net/partial-thumb.jpg"><meta property="og:video:duration" content="PT26S"><meta property="article:published_time" content="2026-10-20T00:00:00Z"></head></html>';
 const bytes=Uint8Array.from([255,216,255,217]);
 const fetcher=async url=>String(url).includes('fbcdn.net')?new Response(bytes,{headers:{'Content-Type':'image/jpeg'}}):new Response(html,{headers:{'Content-Type':'text/html'}});
 const request=new Request('https://reactionjourney.com/api/missioned-souls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fetch-facebook-metadata',url:'https://www.facebook.com/reel/public-reel-456/'})});
 const response=await missionedSouls(request,env,seed,trusted,fetcher);assert.equal(response.status,200);
 const details=await response.json();assert.equal(details.title,null);assert.equal(details.durationSeconds,26);assert.equal(details.publishedAt,'2026-10-20T00:00:00.000Z');assert.equal(details.thumbnailUrl,'https://scontent.xx.fbcdn.net/partial-thumb.jpg');assert.match(details.thumbnailData,/^data:image\/jpeg;base64,/);
});
test('Facebook metadata fetch rejects a generic error page without video evidence',async()=>{
 const db=database(),env={DB:db},seed={videos:[]},trusted={id:'trusted-member'};db.sql.exec("INSERT INTO members(id,trusted) VALUES('trusted-member',1)");
 const request=new Request('https://reactionjourney.com/api/missioned-souls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fetch-facebook-metadata',url:'https://www.facebook.com/reel/private-or-blocked-123/'})});
 const response=await missionedSouls(request,env,seed,trusted,async()=>new Response('<html><head><title>Facebook</title></head><body>Something went wrong</body></html>',{headers:{'Content-Type':'text/html'}}));
 assert.equal(response.status,400,await response.clone().text());assert.match((await response.json()).error,/continue with manual details/i);
});
test('category lifecycle preserves assignments and rejects stale updates and member writes',async()=>{
 const db=database(),seed={videos:[video(undefined,{tags:['OPM']})]},env={DB:db};
 const request=body=>new Request('https://local/api/missioned-souls',{method:'POST',body:JSON.stringify(body)});
 const mod={id:'moderator',moderator:true};
 let catalog=await readMissionedSouls(db,seed);
 const act=async body=>{const r=await missionedSouls(request({action:'categories',revision:catalog.categoryRevision,...body}),env,seed,mod);assert.equal(r.status,200,await r.clone().text());catalog=await readMissionedSouls(db,seed);};
 await act({operation:'add',name:'Favorites'});
 const custom=catalog.categoryDefinitions.find(c=>c.name==='Favorites').id;
 const saved=await missionedSouls(request({action:'save',video:{...catalog.videos[0],tags:['OPM',custom]}}),env,seed,mod);assert.equal(saved.status,200,JSON.stringify(await saved.json()));
 await act({operation:'rename',id:custom,name:'Family favorites'});
 await act({operation:'move',id:custom,direction:-1});
 await act({operation:'archive',id:custom,archived:true});
 assert.deepEqual(catalog.videos[0].tags.filter(t=>!t.startsWith('playlist:')&&!t.startsWith('year:')),['OPM',custom]);
 await act({operation:'archive',id:custom,archived:false});
 assert.equal(catalog.categoryDefinitions.find(c=>c.id===custom).name,'Family favorites');
 assert.deepEqual(catalog.videos[0].tags.filter(t=>!t.startsWith('playlist:')&&!t.startsWith('year:')),['OPM',custom]);
 assert.equal((await missionedSouls(request({action:'categories',revision:0,operation:'add',name:'Stale'}),env,seed,mod)).status,409);
 assert.equal((await missionedSouls(request({action:'categories',revision:catalog.categoryRevision,operation:'archive',id:custom,archived:true}),env,seed,{id:'member',moderator:false})).status,403);
 assert.equal((await missionedSouls(new Request('https://local/api/missioned-souls'),env,seed,null)).status,401);
});
test('moderator hide/remove survives refresh and import, filters member API, and restores seed records',async()=>{
 const db=database(),seed={videos:[video(undefined,{views:123,tags:['OPM'],reviewed:true})]},env={DB:db,YOUTUBE_API_KEY:'fixture'},mod={id:'moderator',moderator:true};
 const req=body=>new Request('https://local/api/missioned-souls',{method:'POST',body:JSON.stringify(body)});
 const act=(visibility,user=mod,id=seed.videos[0].id)=>missionedSouls(req({action:'visibility',id,visibility}),env,seed,user);
 assert.equal((await act('hidden',{id:'member'})).status,403);
 assert.equal((await act('wrong')).status,400);
 assert.equal((await act('hidden',mod,'missing')).status,404);
 const fetcher=async url=>{const p=new URL(url).pathname;return Response.json(p.endsWith('/channels')?{items:[{id:'official',contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]}:p.endsWith('/playlistItems')?{items:[{contentDetails:{videoId:'C1yfkA_0_Sg'}}]}:{items:[{id:'C1yfkA_0_Sg',snippet:{title:'Studio cover',channelId:'official',publishedAt:'2026-01-01'},statistics:{viewCount:'456'}}]});};
 for(const visibility of ['hidden','removed']){
  assert.equal((await act(visibility)).status,200);
  await refreshMissionedSouls(env,seed,fetcher);
  assert.equal((await missionedSouls(req({action:'import',videos:seed.videos}),env,seed,mod)).status,200);
  const member=await (await missionedSouls(new Request('https://local/api/missioned-souls'),env,seed,{id:'member'})).json();
  assert.equal(member.videos.length,0);
  const catalog=await readMissionedSouls(db,seed);assert.equal(catalog.videos[0].visibility,visibility);
  assert.deepEqual(catalog.videos[0].tags.filter(t=>!t.startsWith('playlist:')&&!t.startsWith('year:')),['OPM']);assert.ok(catalog.videos[0].history.length);
  assert.equal(selectVideos(catalog.videos).length,0);
  assert.equal(selectVideos(catalog.videos,{visibility:'managed'}).length,1);
 }
 assert.equal((await act('visible')).status,200);
 const member=await (await missionedSouls(new Request('https://local/api/missioned-souls'),env,seed,{id:'member'})).json();assert.equal(member.videos.length,1);
});
test('hidden unknown-date and unavailable records remain recoverable',()=>{
 const hidden=video(undefined,{visibility:'hidden',available:false});
 assert.equal(selectVideos([hidden]).length,0);
 assert.equal(selectVideos([hidden],{visibility:'managed'}).length,1);
});

test('managed newest-first lists dated, undated and unavailable videos once and respects year',()=>{
 const dated=video(undefined,{visibility:'hidden',publishedAt:'2026-01-01'});
 const undated=video('3DzA_GoOE60',{visibility:'removed',available:false});
 const unavailable=video('abcdefghijk',{visibility:'removed',available:false,publishedAt:'2025-01-01'});
 const items=[dated,undated,unavailable];
 assert.deepEqual(selectVideos(items,{visibility:'managed'}).map(v=>v.id),[dated.id,unavailable.id,undated.id]);
 assert.deepEqual(selectVideos(items,{visibility:'managed',year:'2026'}).map(v=>v.id),[dated.id]);
 assert.deepEqual(selectVideos(items),[]);
});
