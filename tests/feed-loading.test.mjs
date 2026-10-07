import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const initSource=source.slice(source.indexOf('async function init()'),source.indexOf("\n$('searchInput')"));
test('feed startup overlaps dashboard and catalog reads and does not wait for coverage',async()=>{
 let releaseCatalog,releaseDashboard;
 const catalogGate=new Promise(resolve=>releaseCatalog=resolve);
 const dashboardGate=new Promise(resolve=>releaseDashboard=resolve);
 const calls=[];const elements=new Map();const memberDashboard={preferences:{theme:'dark'}};
 const context=vm.createContext({
  catalog:null,catalogEtag:null,$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},
  reactionAuth:{fetch:async()=>{calls.push('catalog');await catalogGate;return {ok:true,headers:new Headers({ETag:'"catalog-123"'}),json:async()=>({stats:{channels:412},performers:[]})};}},
  socialApi:async path=>{assert.equal(path,'/dashboard');calls.push('dashboard');await dashboardGate;return memberDashboard;},
  loadCommunity:async options=>{assert.equal(options.deferSecondary,true);calls.push('community');},
  loadDashboard:async data=>{assert.equal(data,memberDashboard);calls.push('display');},
  renderAll:()=>calls.push('render'),renderDiscovery:()=>{},
  loadCoverage:()=>{calls.push('coverage');return new Promise(()=>{});},communityMessage:()=>{},
 });
 vm.runInContext(initSource,context);const loading=context.init();
 assert.deepEqual(calls,['catalog','dashboard']);
 releaseDashboard();releaseCatalog();await loading;
 assert.deepEqual(calls,['catalog','dashboard','community','display','render','coverage']);
 assert.equal(context.catalogEtag,'"catalog-123"');assert.equal(elements.get('catalogCount').textContent,'412');
});
