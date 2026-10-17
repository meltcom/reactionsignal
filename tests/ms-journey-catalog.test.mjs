import test from 'node:test';
import assert from 'node:assert/strict';
import {yearCatalog,playlistCatalog} from '../ms-journey-catalog.mjs';
import {selectVideos} from '../missioned-souls-core.mjs';
import {refreshPlaylists} from '../server/ms-playlists.mjs';
test('years correct stale assignments and respect UTC publication dates, including unknown dates',()=>{
 const defs=[{id:'old2024',name:'2024'},{id:'old2025',name:'2025'}];
 const result=yearCatalog([{id:'a',title:'A',tags:['old2024','OPM'],publishedAt:'2025-01-01T00:30:00Z'},{id:'b',title:'B',tags:['old2024'],publishedAt:null}],defs);
 assert.deepEqual(result.videos[0].tags,['OPM','old2025']);assert.deepEqual(result.videos[1].tags,[]);
 assert.equal(selectVideos(result.videos,{year:'2024'}).length,0);assert.equal(selectVideos(result.videos,{year:'2025'}).length,1);assert.equal(selectVideos(result.videos,{year:'unknown'}).length,1);
});
test('playlist membership is exact, overlapping, deduplicated, and replaces matching browse categories',()=>{
 const defs=[{id:'OPM',name:'OPM'},{id:'faith',name:'Christian videos'}];
 const playlists=[{id:'one',name:'Missioned Souls - OPM covers',videos:[{id:'abc'},{id:'abc'}]},{id:'two',name:'Lenten Special \'24',videos:[{id:'abc'}]}];
 const result=playlistCatalog([{youtubeId:'abc',tags:['OPM']},{youtubeId:'def',tags:['OPM','playlist:obsolete']}],defs,playlists);
 assert.equal(result.categoryDefinitions.find(c=>c.id==='OPM').archived,true);assert.equal(result.categoryDefinitions.find(c=>c.id==='faith').archived,undefined);
 assert.deepEqual(result.videos[0].tags,['OPM','playlist:one','playlist:two']);assert.deepEqual(result.videos[1].tags,['OPM']);
});
test('failed paginated playlist sync retains the last complete membership catalog',async()=>{
 const writes=[];const db={prepare(sql){return {bind(...values){this.values=values;return this;},async run(){writes.push([sql,this.values]);return {meta:{changes:1}};}};}};
 let calls=0;const fetcher=async()=>++calls===1?Response.json({items:[{id:'p',snippet:{title:'Playlist'}}],nextPageToken:'next'}):new Response('',{status:503});
 const result=await refreshPlaylists({DB:db,YOUTUBE_API_KEY:'fixture'},()=>{},fetcher);
 assert.equal(result.status,'error');assert.equal(calls,2);assert.equal(writes.some(([,values])=>values?.[0]==='ms-playlists'),false);
});
