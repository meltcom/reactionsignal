import test from 'node:test';
import assert from 'node:assert/strict';
import {countdown,countdownSettings} from '../server/countdown.mjs';
const event={enabled:true,title:'Hangout',start:'2026-11-06T15:00:00.000Z',message:'We are live!',link:'https://www.youtube.com/watch?v=example'};
const request=(method,value)=>new Request('https://example.com/api/countdown',{method,...(value?{body:JSON.stringify(value),headers:{'Content-Type':'application/json'}}:{})});
test('only moderators can save, members see enabled settings and no disabled draft',async()=>{
 let value;
 const db={prepare:()=>({bind:(_,data)=>({first:async()=>value?{value}:null,run:async()=>{value=data;}})})};
 assert.equal((await countdown(request('PUT',event),db,{},true)).status,403);
 assert.equal((await countdown(request('PUT',event),db,{},false)).status,405);
 assert.equal((await countdown(request('PUT',event),db,{moderator:true},true)).status,200);
 assert.deepEqual(await (await countdown(request('GET'),db,{},false)).json(),event);
 await countdown(request('PUT',{...event,enabled:false}),db,{moderator:true},true);
 assert.deepEqual(await (await countdown(request('GET'),db,{},false)).json(),{enabled:false});
 assert.equal((await (await countdown(request('GET'),db,{moderator:true},true)).json()).title,'Hangout');
});
test('rejects unsafe links and invalid or missing enabled event dates',()=>{
 for(const link of ['javascript:alert(1)','//example.com','https://user:password@example.com'])assert.throws(()=>countdownSettings({...event,link}));
 for(const start of ['', '2026-02-30T15:00:00.000Z','2026-11-06T07:00'])assert.throws(()=>countdownSettings({...event,start}));
 assert.deepEqual(countdownSettings(event),event);
});
