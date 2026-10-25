import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceFingerprint,artifactFingerprint,assertSameDeployment,assertRelease,assertReleaseCheckout} from '../scripts/release-provenance.mjs';

test('backend-only changes invalidate a release even if banner assets match',async()=>{
 const root=await mkdtemp(join(tmpdir(),'release-provenance-'));
 try{
  await mkdir(join(root,'server'));await mkdir(join(root,'tmp'));
  await writeFile(join(root,'index.html'),'same banner');await writeFile(join(root,'server','worker.mjs'),'old backend');
  const old=await sourceFingerprint(root);
  await writeFile(join(root,'tmp','old-worker.js'),'ignored downloaded bundle');assert.equal(await sourceFingerprint(root),old);
  await writeFile(join(root,'server','worker.mjs'),'current backend');assert.notEqual(await sourceFingerprint(root),old);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('release stops when production changes or uses an unexpected traffic split',()=>{
 const before=[{version_id:'approved',percentage:100}];
 assert.doesNotThrow(()=>assertSameDeployment(before,before));
 assert.throws(()=>assertSameDeployment(before,[{version_id:'newer',percentage:100}]));
 assert.throws(()=>assertSameDeployment(before,[{version_id:'approved',percentage:50},{version_id:'other',percentage:50}]));
 assert.throws(()=>assertSameDeployment([],[]));
});
test('matching frontend alone cannot pass live release verification',()=>{
 const expected={schema:1,sourceHash:'current',builtAt:'now'};
 assert.doesNotThrow(()=>assertRelease(expected,{...expected}));
 assert.throws(()=>assertRelease(expected,{...expected,sourceHash:'stale-backend'}));
 assert.throws(()=>assertRelease(expected,{...expected,builtAt:'previous-upload'}));
 assert.throws(()=>assertRelease(expected,null));
});
test('replacing only the packaged backend invalidates build integrity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'release-artifact-'));
 try{
  await mkdir(join(root,'server'));await writeFile(join(root,'server','index.js'),'current');
  const hash=await artifactFingerprint(root);
  await writeFile(join(root,'build-integrity.json'),JSON.stringify({sha256:hash}));assert.equal(await artifactFingerprint(root),hash);
  await writeFile(join(root,'server','index.js'),'stale downloaded worker');assert.notEqual(await artifactFingerprint(root),hash);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('only the current reviewed main commit is a production release candidate',()=>{
 const good={head:'a'.repeat(40),remoteMain:'a'.repeat(40),branch:'main',dirty:false};
 assert.doesNotThrow(()=>assertReleaseCheckout(good));assert.doesNotThrow(()=>assertReleaseCheckout({...good,branch:''}));
 assert.throws(()=>assertReleaseCheckout({...good,remoteMain:'b'.repeat(40)}));
 assert.throws(()=>assertReleaseCheckout({...good,branch:'codex/reconciliation'}));
 assert.throws(()=>assertReleaseCheckout({...good,dirty:true}));
 assert.doesNotThrow(()=>assertReleaseCheckout({...good,dirty:true,allowDirty:true}));
 assert.throws(()=>assertReleaseCheckout({...good,head:'b'.repeat(40),dirty:true,allowDirty:true}));
});

test('migration and regression-test changes invalidate source identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'release-complete-source-'));
 try{await mkdir(join(root,'drizzle'));await mkdir(join(root,'tests'));await writeFile(join(root,'index.html'),'stable');
 const before=await sourceFingerprint(root);await writeFile(join(root,'drizzle','0042.sql'),'SELECT 1;');const migration=await sourceFingerprint(root);assert.notEqual(migration,before);
 await writeFile(join(root,'tests','flow.test.mjs'),'new test');assert.notEqual(await sourceFingerprint(root),migration);
 }finally{await rm(root,{recursive:true,force:true});}
});
