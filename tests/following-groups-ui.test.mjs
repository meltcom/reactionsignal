import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');
const binding=source.slice(source.indexOf('function bindFollowingGroups(){'),source.indexOf('function followingName(f)'));
function setup({fail=false,confirm=true,active=true}={}){
 const choice={value:active?'rock':'',disabled:false,isConnected:true};
 const buttons=['activate','save','rename','delete'].map(groupAction=>({dataset:{groupAction},disabled:false,isConnected:true}));
 const nodes={followingGroupChoice:choice,followingGroups:{open:true},createFollowingGroup:{}};
 const calls=[],notices=[];
 const context={followingGroupsOpen:true,dashboard:{followingGroups:[{id:'rock',name:'Rock',active:active?1:0,follows:[{kind:'song',target:'Hysteria'}]},{id:'empty',name:'Empty',active:0,follows:[]}],follows:[{kind:'song',target:'Hysteria'}]},
  $:id=>nodes[id],document:{querySelectorAll:()=>buttons},confirm:()=>confirm,notice:message=>notices.push(message),
  socialApi:async(path,body)=>{calls.push({path,body});if(fail)throw new Error('Could not switch.');context.dashboard.followingGroups.forEach(g=>g.active=Number(g.id===body.id));context.dashboard.follows=context.dashboard.followingGroups.find(g=>g.active).follows;},
  refreshDashboard:async()=>{choice.value=context.dashboard.followingGroups.find(g=>g.active)?.id||'';},
 };
 vm.createContext(context);
 vm.runInContext(source.split('\n').find(line=>line.startsWith('async function action('))+'\n'+binding+'\nbindFollowingGroups();',context);
 return {context,choice,buttons,calls,notices};
}

test('choosing saved groups activates them and refreshes follows in both directions',async()=>{
 const {context,choice,calls}=setup();
 choice.value='empty';const pending=choice.onchange();assert.equal(choice.disabled,true);await pending;
 assert.equal(calls[0].path,'/following-group');assert.equal(calls[0].body.action,'activate');assert.equal(calls[0].body.id,'empty');
 assert.equal(context.dashboard.follows.length,0);assert.equal(choice.value,'empty');assert.equal(choice.disabled,false);
 choice.value='rock';await choice.onchange();
 assert.equal(context.dashboard.follows.length,1);assert.equal(choice.value,'rock');
});

test('a failed switch restores the active selection and enables controls',async()=>{
 const {choice,buttons,notices}=setup({fail:true});choice.value='empty';await choice.onchange();
 assert.equal(choice.value,'rock');assert.equal(choice.disabled,false);assert.ok(buttons.every(b=>!b.disabled));assert.deepEqual(notices,['Could not switch.']);
});

test('canceling replacement of unsaved follows restores the selection without a request',async()=>{
 const {choice,calls,context}=setup({active:false,confirm:false});choice.value='empty';await choice.onchange();
 assert.equal(choice.value,'');assert.equal(calls.length,0);assert.equal(context.dashboard.follows.length,1);
});

test('placeholder selection and repeated clicks during a switch do not send requests',async()=>{
 const {choice,buttons,calls}=setup();choice.value='';await choice.onchange();assert.equal(choice.value,'rock');assert.equal(calls.length,0);
 choice.value='empty';const pending=choice.onchange();await buttons[0].onclick();await pending;assert.equal(calls.length,1);
});
