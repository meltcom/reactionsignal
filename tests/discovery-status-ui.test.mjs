import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function renderDiscovery()'),source.indexOf('async function init()'));
function setup(moderator,fetch){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{hidden:false,after(){},append(){}});return elements.get(id);};
 const context=vm.createContext({communityState:{moderator},discoveryDiagnostics:null,discoveryStatusError:null,catalog:{},$,
  document:{getElementById:$},reactionAuth:{fetch},escapeHtml:String,prettyDate:String});
 vm.runInContext(functions,context);return {context,$};
}
const live={message:'Scheduled discovery is running.',lastDiscoveryRunAt:'2026-10-12T20:00:00Z',coverage:{checked:418,total:418},historyBacklog:0,runs:[{started_at:'2026-10-12T20:00:00Z',status:'succeeded',channels:8,added:2,calls:9}]};
test('discovery section is hidden by default and regular members never request diagnostics',async()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/<details[^>]*id="discoveryDetails"[^>]*hidden/);
 for(const role of [false,undefined]){const s=setup(role,()=>assert.fail('Member fetched moderator status'));s.context.renderDiscovery();await s.context.refreshDiscoveryDiagnostics();assert.equal(s.$('discoveryDetails').hidden,true);}
});
test('moderators load live status and retain it across catalog replacement',async()=>{
 const s=setup(true,async(path,options)=>{assert.equal(path,'/api/status');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>live};});
 await s.context.refreshDiscoveryDiagnostics();assert.equal(s.$('discoveryDetails').hidden,false);assert.equal(s.$('discoveryStatus').textContent,live.message);
 assert.match(s.$('discoveryCoverage').textContent,/418 of 418/);assert.match(s.$('discoveryRuns').innerHTML,/succeeded/);
 s.context.catalog={};s.context.renderDiscovery();assert.equal(s.$('discoveryStatus').textContent,live.message);
});
test('failed live status does not claim discovery is inactive or has never run',async()=>{
 const s=setup(true,async()=>({ok:false}));await s.context.refreshDiscoveryDiagnostics();assert.match(s.$('discoveryStatus').textContent,/temporarily unavailable/);assert.equal(s.$('lastDiscovery').textContent,'Unavailable');assert.equal(s.$('discoveryRuns').textContent,'');
 s.context.discoveryDiagnostics=live;await s.context.refreshDiscoveryDiagnostics();assert.match(s.$('discoveryStatus').textContent,/last successfully loaded status/);assert.match(s.$('discoveryCoverage').textContent,/418 of 418/);
 s.context.reactionAuth.fetch=async()=>({ok:true,json:async()=>live});await s.context.refreshDiscoveryDiagnostics();assert.equal(s.$('discoveryStatus').textContent,live.message);
});
test('periodic feed refresh also refreshes moderator diagnostics',()=>{
 const dashboard=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');assert.match(dashboard,/await reloadMemberCatalog\(\);if\(communityState\?\.moderator\)await refreshDiscoveryDiagnostics\(\)/);
});
