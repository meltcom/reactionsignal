import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewFormatRecovery,validateRecoveryRows} from '../server/format-recovery-preview.mjs';
import {previewArguments} from '../scripts/preview-format-recovery.mjs';
const channel='UC'+'x'.repeat(22);
const row=i=>({id:'pilot'+String(i).padStart(6,'0'),title:'Fixture reaction',channel_id:channel,performer_id:'missioned-souls',performer_status:'active',match_status:'CONFIRMED',match_source:'Moderator decision',format:'UNKNOWN',available:1,format_locked:0,excluded:0});
const item=(i,extra={})=>({id:row(i).id,snippet:{channelId:channel,title:'Fixture reaction',publishedAt:'2026-10-01T00:00:00Z'},contentDetails:{duration:'PT5M'},status:{privacyStatus:'public'},player:{embedWidth:480,embedHeight:270},...extra});
test('pilot scope rejects unsafe rows, duplicates and requests above twelve before any fetch',async()=>{
 for(const rows of [[],Array.from({length:13},(_,i)=>row(i)),[row(1),row(1)],...Object.entries({performer_id:'nene-royal',performer_status:'draft',match_status:'REJECTED',available:0,format_locked:1,excluded:1,format:'SHORT',id:'bad',channel_id:'bad'}).map(([key,value])=>[{...row(1),[key]:value}])]){
  let calls=0;
  await assert.rejects(previewFormatRecovery(rows,{apiKey:'fixture',fetcher:()=>{calls++;throw Error('Must not fetch');}}));
  assert.equal(calls,0);
 }
 assert.equal(validateRecoveryRows([row(1)])[0].id,row(1).id);
});
test('a twelve-video pilot makes one bounded read with the key only in a header and never mutates input',async()=>{
 const rows=Array.from({length:12},(_,i)=>row(i)),before=structuredClone(rows);let calls=0;
 const report=await previewFormatRecovery(rows,{apiKey:'fixture-key',fetcher:async(url,options)=>{
  calls++;assert.equal(url.origin,'https://www.googleapis.com');assert.equal(url.searchParams.has('key'),false);assert.equal(url.searchParams.get('id').split(',').length,12);assert.equal(url.searchParams.get('maxWidth'),'480');assert.equal(url.searchParams.has('maxResults'),false);assert.equal(options.headers['X-Goog-Api-Key'],'fixture-key');assert.equal(options.redirect,'error');
  return Response.json({items:rows.map((r,i)=>item(i))});
 }});
 assert.equal(calls,1);assert.equal(report.proposed,12);assert.equal(report.mode,'fresh-preview-only');assert.deepEqual(rows,before);assert.equal(JSON.stringify(report).includes('fixture-key'),false);
});
test('fresh duration and real dimensions resolve formats without falling back to cached values',async()=>{
 const rows=[row(1),row(2),{...row(3),metadata_json:'{"duration":5000}'}];
 const report=await previewFormatRecovery(rows,{apiKey:'fixture',fetcher:async()=>Response.json({items:[item(1),item(2,{contentDetails:{duration:'PT1M'},player:{embedWidth:270,embedHeight:480}}),item(3,{contentDetails:{}})]})});
 assert.deepEqual(report.records.map(r=>r.proposedFormat),['FULL_LENGTH','SHORT','UNKNOWN']);assert.equal(report.records[2].outcome,'missing_duration');assert.equal(report.records[0].before.matchSource,'Moderator decision');
});
test('missing, private, wrong-channel and insufficient-evidence items never become proposals',async()=>{
 const report=await previewFormatRecovery([row(1),row(2),row(3),row(4)],{apiKey:'fixture',fetcher:async()=>Response.json({items:[item(2,{status:{privacyStatus:'private'}}),item(3,{snippet:{channelId:'UCwrong'}}),item(4,{contentDetails:{duration:'PT1M'},player:{}})]})});
 assert.deepEqual(report.records.map(r=>r.outcome),['not_returned','not_public','channel_mismatch','insufficient_format_evidence']);assert.equal(report.proposed,0);
});
test('invalid response shape, duplicate or foreign IDs fail closed without a partial preview',async()=>{
 for(const data of [{},{items:[item(1),item(1)]},{items:[item(2)]}])await assert.rejects(previewFormatRecovery([row(1)],{apiKey:'fixture',fetcher:async()=>Response.json(data)}));
});
test('missing credentials, quota and network failures produce safe errors without credential or response dumps',async()=>{
 await assert.rejects(previewFormatRecovery([row(1)]),/not configured/);
 await assert.rejects(previewFormatRecovery([row(1)],{apiKey:'sensitive-fixture',fetcher:async()=>new Response('sensitive-fixture',{status:403})}),error=>!error.message.includes('sensitive-fixture')&&error.message.includes('403'));
 await assert.rejects(previewFormatRecovery([row(1)],{apiKey:'sensitive-fixture',fetcher:async()=>{throw Error('sensitive-fixture');}}),error=>!error.message.includes('sensitive-fixture'));
});
test('CLI has no apply mode and cannot overwrite input or write outside output',()=>{
 assert.throws(()=>previewArguments(['--apply','yes']),/no apply/);
 assert.throws(()=>previewArguments(['--input','output/pilot.json','--output','server/auth.mjs']),/inside project output/);
 assert.throws(()=>previewArguments(['--input','output/pilot.json','--output','output/pilot.json']),/separate JSON/);
 assert.ok(previewArguments(['--input','output/pilot.json']).output.endsWith('format-recovery-fresh-preview.json'));
});
