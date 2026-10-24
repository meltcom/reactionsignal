import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../auth-client.js',import.meta.url),'utf8');
const authSource=source.slice(source.indexOf('let client='),source.indexOf('async function getAccessToken'));
async function setup(){
 const calls={config:0,me:0},events=[];let session={access_token:'test-token',userId:'member-a'},listener;
 const nodes=new Map(),element=()=>({hidden:false,inert:false,textContent:'',children:[],attributes:{},append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;},classList:{toggle(){}},removeAttribute(){},querySelectorAll:()=>[],querySelector:()=>({disabled:false,focus(){}})});
 const document={createElement:()=>element(),getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},body:element(),querySelectorAll:()=>[]};
 const context={document,window:{dispatchEvent:e=>events.push(e.type)},Event,location:{replace:url=>events.push('replace:'+url)},Headers,
  fetch:async path=>{if(path==='/api/auth/config'){calls.config++;return{ok:true,json:async()=>({url:'https://example.invalid',key:'test-key'})};}calls.me++;return session?{ok:true,json:async()=>({id:session.userId,email:session.userId+'@example.invalid',moderator:false})}:{ok:false,status:401,json:async()=>({error:'signed out'})};},
  createClient:()=>({auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{listener=fn;queueMicrotask(()=>fn('INITIAL_SESSION',session));},signOut:async()=>{session=null;}}}),setTimeout:(fn)=>setTimeout(fn,0)};
 runInNewContext(authSource,context);await context.ready;await new Promise(r=>setImmediate(r));return{calls,events,nodes,emit:async(event,next)=>{session=next;listener(event,next);await new Promise(r=>setTimeout(r,5));}};
}
test('initial session is verified once, not again by INITIAL_SESSION event',async()=>{const h=await setup();assert.deepEqual(h.calls,{config:1,me:1});assert.deepEqual(h.events,['reaction-auth-change']);});
test('token refresh still verifies the signed-in account',async()=>{const h=await setup();await h.emit('TOKEN_REFRESHED',{access_token:'rotated',userId:'member-a'});assert.equal(h.calls.me,2);});
test('changed account is reverified and forces a clean reload',async()=>{const h=await setup();await h.emit('SIGNED_IN',{access_token:'other',userId:'member-b'});assert.equal(h.calls.me,2);assert.ok(h.events.includes('replace:/'));});
test('sign-out rechecks the session and forces a clean reload',async()=>{const h=await setup();await h.emit('SIGNED_OUT',null);assert.equal(h.calls.me,1);assert.ok(h.events.includes('replace:/'));});

test('account control keeps the visible logout label and clears it on sign-out',async()=>{
 const h=await setup(),button=h.nodes.get('accountButton');
 assert.equal(button.children[1].textContent,'Log out');
 assert.match(button.attributes['aria-label'],/Log out/);
 await h.emit('SIGNED_OUT',null);
 assert.equal(button.children.length,1);assert.equal(button.children[0].textContent,'Sign in');
 assert.equal(button.attributes['aria-label'],'Sign in');
});
