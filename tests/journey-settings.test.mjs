import {test} from 'node:test';
import assert from 'node:assert/strict';
import {builtinViews,protectedViewName,archiveSettings} from '../server/view-settings.mjs';
import {ratingMarkup} from '../journey-rating.mjs';
import {selectVideos} from '../missioned-souls-core.mjs';

test('protected presets have immutable, scoped identities and restore original presentation',()=>{
 const rj=builtinViews(),ms=builtinViews('ms-journey');assert.deepEqual(rj.map(v=>v.name),['Small','Default','Large']);
 assert.deepEqual(rj.map(v=>v.settings.columns),[4,3,2]);assert.equal(ms[1].settings.thumbnail,'medium');assert.notEqual(rj[0].id,ms[0].id);
 assert.throws(()=>{ms[1].settings.columns=5;});assert.equal('query' in ms[1].settings,false);
 for(const value of [' Small ','DEFAULT','large','Ｓｍａｌｌ','\u2003Large\u2003'])assert.equal(protectedViewName(value),true);assert.equal(protectedViewName('My Large view'),false);
});
test('MS settings validate their own filters and cannot inject appearance or account identity',()=>{
 assert.deepEqual(archiveSettings({theme:'dark',user_id:'other',query:'My video',format:'shorts',columns:4}),{scope:'ms-journey',format:'shorts',columns:4,query:'My video'});
 assert.throws(()=>archiveSettings({columns:2.5}));assert.throws(()=>archiveSettings({source:'<script>'}));assert.throws(()=>archiveSettings({year:'not a year'}));
});
test('five stars show the actual fractional average and accessible rating count',()=>{
 const stars=ratingMarkup(4.2,12);assert.ok(stars.includes('★★★★★'));assert.ok(stars.includes('width:84%'));assert.ok(stars.includes('4.2 out of 5 stars, 12 ratings'));
 for(const args of [[null,0],[undefined,4],[6,3],[4,-1],[4,1.2],['<script>',2]])assert.equal(ratingMarkup(...args),'');
});
test('sort, Top 10, source and format are independent and keep valid zero statistics',()=>{
 const items=Array.from({length:13},(_,i)=>({id:String(i),title:'Video '+i,publishedAt:'2026-10-01',platform:i===0?'Facebook':'YouTube',youtubeEquivalent:false,tags:i===1?['Shorts']:[],views:i}));
 assert.equal(selectVideos(items,{ranking:'views',limit:'all'}).length,13);assert.equal(selectVideos(items,{ranking:'views',limit:'10'}).length,10);
 assert.equal(selectVideos(items,{source:'facebook-only',ranking:'views',limit:'all'})[0].views,0);
 assert.equal(selectVideos(items,{format:'shorts'}).length,1);assert.equal(selectVideos(items,{format:'full'}).length,12);
});
