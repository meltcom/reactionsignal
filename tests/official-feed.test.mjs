import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {officialFeedVideos} from '../server/official-feed.mjs';
import {refreshMissionedSouls,scheduledMissionedSouls} from '../server/missioned-souls.mjs';
function database(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');return {sql,prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(ops){return Promise.all(ops.map(op=>op.run()));}};}
test('official feed excludes unavailable, undated, future and non-YouTube entries without creating reactions',async()=>{
 const db=database();const put=(id,changes={})=>db.sql.prepare('INSERT INTO state VALUES(?,?)').run('ms-video:yt:'+id,JSON.stringify({id:'yt:'+id,youtubeId:id,platform:'YouTube',title:'Official cover',url:'https://www.youtube.com/watch?v='+id,publishedAt:'2026-10-15T12:00:00Z',available:true,tags:[],...changes}));
 put('abcdefghijk');put('12345678901',{available:false});put('12345678902',{publishedAt:null});put('12345678903',{publishedAt:'2026-10-17T00:00:00Z'});put('12345678904',{platform:'Facebook'});put('12345678905',{tags:['Shorts']});
 const rows=await officialFeedVideos(db,{videos:[]},Date.parse('2026-10-16T00:00:00Z'));assert.equal(rows.length,2);assert.ok(rows.every(v=>v.isOfficial&&v.source==='MS Journey'));assert.equal(rows[1].format,'SHORT');assert.equal(rows[0].discoveredAt,rows[0].publishedAt);assert.deepEqual(db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['state']);
});
test('feed deduplicates official uploads while reaction catalog data stays unchanged',()=>{
 const source=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');const helper=source.slice(source.indexOf('function feedVideos(){'),source.indexOf('function officialFeedCard('));
 const catalog={videos:[{id:'abcdefghijk',title:'old reaction entry'},{id:'12345678901',title:'reaction'}],officialVideos:[{id:'abcdefghijk',title:'official',isOfficial:true}]};
 const context=vm.createContext({catalog});vm.runInContext(helper,context);const rows=vm.runInContext('feedVideos()',context);assert.equal(rows.length,2);assert.equal(rows[0].isOfficial,true);assert.equal(catalog.videos[0].title,'old reaction entry');
});
test('latest upload polling preserves the historical cursor and completed-scan timestamp',async()=>{
 const db=database(),now=new Date().toISOString();const progress={uploads:'uploads',channelId:'official',status:'continuing',nextPage:'older-cursor',lastCompleteAt:now};db.sql.prepare('INSERT INTO state VALUES(?,?)').run('ms-refresh',JSON.stringify(progress));let playlistCalls=0;
 const fetcher=async url=>{const u=new URL(url);if(u.pathname.endsWith('/playlistItems')){playlistCalls++;assert.equal(u.searchParams.has('pageToken'),false);return Response.json({items:[{contentDetails:{videoId:'abcdefghijk'}}],nextPageToken:'new-cursor'});}return Response.json({items:[{id:'abcdefghijk',snippet:{channelId:'official',title:'New official cover',publishedAt:now},statistics:{viewCount:'10'}}]});};
 const result=await refreshMissionedSouls({DB:db,YOUTUBE_API_KEY:'test'},{videos:[]},fetcher,{latestOnly:true});assert.equal(result.status,'latest-refreshed');assert.equal(playlistCalls,1);const after=JSON.parse(db.sql.prepare("SELECT value FROM state WHERE key='ms-refresh'").get().value);assert.equal(after.nextPage,'older-cursor');assert.equal(after.lastCompleteAt,now);assert.ok(after.lastLatestAt);assert.equal(after.status,'continuing');
});
test('scheduler checks newest uploads before the daily full-scan boundary and backs off on repeated latest failures',async()=>{
 const db=database();db.sql.prepare('INSERT INTO state VALUES(?,?)').run('ms-refresh',JSON.stringify({uploads:'uploads',channelId:'official',status:'complete',lastCompleteAt:new Date(Date.now()-3600000).toISOString()}));let calls=0;
 const fetcher=async()=>{calls++;return Response.json({items:[]});};await scheduledMissionedSouls({DB:db,YOUTUBE_API_KEY:'test'},{videos:[]},fetcher);assert.equal(calls,1);await scheduledMissionedSouls({DB:db,YOUTUBE_API_KEY:'test'},{videos:[]},fetcher);assert.equal(calls,1);
});
