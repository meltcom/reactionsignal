import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyProductionBeforeUpload} from '../scripts/check-production-before-upload.mjs';
const expected=[{version_id:'approved',percentage:100}];
const reply=versions=>async()=>Response.json({success:true,result:{deployments:[{versions}]}});
test('upload guard rechecks provider versions at the end of preparation',async()=>{
 await verifyProductionBeforeUpload({expected,token:'test',fetcher:reply(expected)});
 await assert.rejects(verifyProductionBeforeUpload({expected,token:'test',fetcher:reply([{version_id:'changed-during-build',percentage:100}])}),/Production changed/);
 await assert.rejects(verifyProductionBeforeUpload({expected,token:'test',fetcher:reply([{version_id:'approved',percentage:50},{version_id:'other',percentage:50}])}),/Production changed/);
});
test('unverifiable production or missing guarded context fails closed',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({success:false},{status:403});};
 await assert.rejects(verifyProductionBeforeUpload({expected,token:'test',fetcher}),/Cannot verify/);
 await assert.rejects(verifyProductionBeforeUpload({expected,fetcher}),/Missing guarded/);
 await assert.rejects(verifyProductionBeforeUpload({expected:[],token:'test',fetcher}),/Missing guarded/);
 assert.equal(calls,1);
 await assert.rejects(verifyProductionBeforeUpload({expected,token:'test',fetcher:reply([])}),/Cannot verify/);
});
