import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('let reactorPage=0'),source.indexOf('\nfunction renderFollowing'));
function setup(){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:'',querySelectorAll:()=>[]});return elements.get(id);};
 $('reactorSort').value='ranked';$('reactorPageSize').value='25';
 const ctx=vm.createContext({$,renderReactors:null,catalog:{channels:Array.from({length:61},(_,i)=>({id:String(i),name:`Reactor ${String(i).padStart(2,'0')}`,performerId:'ms'}))},state:{performer:'ms'},dashboard:{hiddenReactors:[]},reactorRankValue:id=>Number(id),reactorScore:()=>({count:1}),myReactorRating:id=>id==='0'?100:undefined,escapeHtml:s=>s,num:String,reactorRankLabel:()=>'',follows:()=>false,hiddenReactorsMarkup:()=>'',bindHiddenReactors:()=>{},bindReactorRatings:()=>{},loadMyReactorRequests:()=>{}});
 vm.runInContext(block,ctx);ctx.renderReactors();return {ctx,$};
}
test('shorter reactor pages clamp and reset when filters change',()=>{
 const {ctx,$}=setup();assert.equal($('reactorPageStatus').textContent,'Showing 1–25 of 61 reactors');
 assert.equal(($('reactorGrid').innerHTML.match(/data-channel=/g)||[]).length,25);
 $('reactorNext').onclick();assert.equal($('reactorPageStatus').textContent,'Showing 26–50 of 61 reactors');
 $('reactorNext').onclick();assert.equal($('reactorPageStatus').textContent,'Showing 51–61 of 61 reactors');assert.equal($('reactorNext').disabled,true);
 $('reactorSearch').value='Reactor 00';$('reactorSearch').oninput();assert.equal($('reactorPageStatus').textContent,'Showing 1–1 of 1 reactors');
 $('reactorSearch').value='absent';ctx.renderReactors();assert.equal($('reactorPageStatus').textContent,'0 reactors');
 $('reactorSearch').value='';$('reactorPageSize').value='all';$('reactorPageSize').onchange();assert.equal($('reactorPageStatus').textContent,'Showing 1–61 of 61 reactors');assert.equal($('reactorNext').disabled,true);
});
test('community and personal ranking use their respective ratings',()=>{
 const {ctx,$}=setup();assert.match($('reactorGrid').innerHTML,/<tbody><tr><td><a[^>]+>Reactor 60/);
 $('reactorSort').value='personal';$('reactorSort').onchange();assert.match($('reactorGrid').innerHTML,/<tbody><tr><td><a[^>]+>Reactor 00/);
 ctx.dashboard.hiddenReactors=[{channel_id:'0'}];ctx.renderReactors();assert.doesNotMatch($('reactorGrid').innerHTML,/data-channel="0"/);
});
