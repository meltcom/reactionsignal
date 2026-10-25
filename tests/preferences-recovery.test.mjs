import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');
test('restore original defaults resets transient filters without persisting or sharing fields',()=>{
 const elements=new Map([['preferencesStatus',{}]]),calls=[];
 const c=vm.createContext({defaults:{fields:['duration'],performer:'missioned-souls',query:'',sort:'latest',landing:'all'},prefs:{fields:['views']},state:{performer:'old',query:'old',sort:'views',format:'SHORT',confidence:'PROBABLE',visible:100},feedMode:'following',$:id=>elements.get(id),applyAppearance:()=>calls.push('appearance'),syncControls:()=>calls.push('sync'),renderPerformers:()=>{},renderVideos:()=>calls.push('render'),openPreferences:()=>calls.push('open')});
 vm.runInContext(source.slice(source.indexOf('function restoreOriginalDefaults(){'),source.indexOf("$('restoreOriginalDefault').onclick")),c);c.restoreOriginalDefaults();
 assert.equal(c.state.format,'all');assert.equal(c.state.confidence,'all');assert.equal(c.state.visible,24);assert.equal(c.feedMode,'all');assert.equal(c.state.query,'');assert.notEqual(c.prefs.fields,c.defaults.fields);assert.deepEqual(calls,['appearance','sync','render','open']);assert.match(elements.get('preferencesStatus').textContent,/Save as default/);
});
test('duration formatter supports seconds, minutes and hours',()=>{
 const c=vm.createContext({});vm.runInContext(source.slice(source.indexOf('function formatVideoDuration('),source.indexOf('function metadata(')),c);
 assert.equal(c.formatVideoDuration(9),'0:09');assert.equal(c.formatVideoDuration(187),'3:07');assert.equal(c.formatVideoDuration(3609),'1:00:09');
});
