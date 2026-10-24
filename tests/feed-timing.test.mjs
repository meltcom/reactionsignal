import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const initSource=source.slice(source.indexOf('async function init()'),source.indexOf("\n$('searchInput')"));
test('opt-in feed diagnostics report only stage, elapsed time, and status/count',async()=>{
 const logs=[],nodes=new Map(),calls=[];const document={querySelectorAll:()=>Array(3),};
 const context={catalog:null,catalogEtag:null,location:{hash:'#feed',search:'?feedTiming=1'},page:'feed',communityState:null,document,performance:{now:()=>42},console:{info:(...args)=>logs.push(args)},$:(id)=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},
  reactionAuth:{fetch:async()=>{calls.push('catalog');return{ok:true,status:200,headers:new Headers({ETag:'"test"'}),json:async()=>({stats:{channels:4},performers:[]})};}},
  socialApi:async()=>{calls.push('dashboard');return{preferences:{},views:[]};},loadCommunity:async()=>{},loadDashboard:async()=>{},renderPerformers(){},renderNewReactors(){},renderDiscovery(){},renderVideos(){},syncCommunityAccess(){},refreshRooms(){},loadCoverage:async()=>{},communityMessage(){}};
 runInNewContext(initSource+';globalThis.start=init;',context);await context.start();
 const stages=logs.filter(row=>row[0]==='[feed-timing]').map(row=>JSON.parse(row[1]));
 assert.deepEqual(calls,['catalog','dashboard']);assert.deepEqual(stages.map(x=>x.stage).sort(),['catalog-response-and-parse','dashboard-response-and-parse','first-card-render'].sort());
 assert.ok(stages.every(x=>Number.isFinite(x.elapsedMs)&&Object.keys(x).every(k=>['stage','elapsedMs','status','cards'].includes(k))));
});
