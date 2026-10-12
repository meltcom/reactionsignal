// Isolated local benchmark and recovery drill. Never connects to production.
import {performance} from 'node:perf_hooks';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {releaseFixture} from '../tests/release-fixture.mjs';
import {community} from '../server/community.mjs';
import {social} from '../server/social.mjs';
const {sql,db,env,reads}=releaseFixture(),seed={performers:[],channels:[],videos:[]};
for(let i=0;i<1000;i++)sql.prepare('INSERT INTO members(id,name,email,created_at) VALUES(?,?,?,?)').run('load-'+i,'Member '+i,`member${i}@example.com`,new Date().toISOString());
for(let i=0;i<1000;i++)sql.prepare('INSERT INTO points(id,user_id,kind,amount,created_at) VALUES(?,?,?,10,?)').run('point-'+i,'load-'+i,'test',new Date().toISOString());
const latencies=[],statuses={},start=performance.now(),initialReads=reads();let next=0;
await Promise.all(Array.from({length:50},async()=>{
 while(next<1000){const i=next++,user={id:'load-'+i,email:`member${i}@example.com`,moderator:false},path=i%2?'/api/community/summary':'/api/social/dashboard',began=performance.now();
  const req=new Request('https://local.test'+path);const r=await (i%2?community(req,env,seed,user):social(req,env,seed,user));
  statuses[r.status]=(statuses[r.status]||0)+1;assert.equal(r.status,200);const data=await r.json();if(i%2)assert.equal(data.points,10);latencies.push(performance.now()-began);
 }
}));
latencies.sort((a,b)=>a-b);
const report={scope:'Local SQLite service simulation; excludes network, remote Auth, Cloudflare/D1 limits and browser rendering',members:1000,requests:1000,concurrency:50,durationMs:Math.round(performance.now()-start),p95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),p99Ms:Math.round(latencies[Math.floor(latencies.length*.99)]),statuses,databaseReads:reads()-initialReads};
// Restore a consistent backup into a separate database; verify data and constraints.
const directory=mkdtempSync(join(tmpdir(),'reactionjourney-recovery-'));
try{
 const path=join(directory,'backup.sqlite');sql.prepare('VACUUM INTO ?').run(path);
 const restored=new DatabaseSync(path);restored.exec('PRAGMA foreign_keys=ON');
 assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
 for(const table of sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name)){
  const safe='"'+table.replaceAll('"','""')+'"';assert.deepEqual(restored.prepare('SELECT * FROM '+safe+' ORDER BY rowid').all(),sql.prepare('SELECT * FROM '+safe+' ORDER BY rowid').all());
 }
 restored.close();report.recovery='All fixture tables restored with identical rows; integrity and foreign keys pass';
}finally{rmSync(directory,{recursive:true,force:true});sql.close();}
console.log(JSON.stringify(report,null,2));
