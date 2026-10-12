// Prepare a trusted D1 export for recovery. Never contacts a provider or modifies the input.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const [input,output]=process.argv.slice(2);
if(!input||!output||resolve(input)===resolve(output))throw Error('Usage: node scripts/prepare-d1-recovery.mjs <trusted-export.sql> <new-restore.sql>');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=OFF');sql.exec(readFileSync(input,'utf8'));
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
const quoted=id=>'"'+id.replaceAll('"','""')+'"';
const value=v=>v===null?'NULL':typeof v==='string'?"'"+v.replaceAll("'","''")+"'":v instanceof Uint8Array?"X'"+Buffer.from(v).toString('hex')+"'":String(v);
const schema=sql.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
const pending=schema.filter(x=>x.type==='table'),ordered=[];
while(pending.length){
 const index=pending.findIndex(t=>sql.prepare('PRAGMA foreign_key_list('+quoted(t.name)+')').all().every(f=>f.table===t.name||ordered.some(x=>x.name===f.table)));
 if(index<0)throw Error('Cross-table dependency cycle: prepare a transactional restore with an operator.');
 ordered.push(pending.splice(index,1)[0]);
}
const lines=['PRAGMA defer_foreign_keys=ON;',...ordered.map(x=>x.sql+';')];
for(const table of ordered){
 const columns=sql.prepare('PRAGMA table_info('+quoted(table.name)+')').all().map(x=>x.name);
 const statement=sql.prepare('SELECT * FROM '+quoted(table.name)+' ORDER BY rowid');statement.setReadBigInts(true);
 for(const row of statement.all())lines.push('INSERT INTO '+quoted(table.name)+'('+columns.map(quoted).join(',')+') VALUES('+columns.map(c=>value(row[c])).join(',')+');');
}
if(sql.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()){
 lines.push('DELETE FROM sqlite_sequence;');
 for(const row of sql.prepare('SELECT name,seq FROM sqlite_sequence').all())lines.push('INSERT INTO sqlite_sequence(name,seq) VALUES('+value(row.name)+','+value(row.seq)+');');
}
lines.push(...schema.filter(x=>x.type!=='table').map(x=>x.sql+';'),'PRAGMA defer_foreign_keys=OFF;');
const normalized=lines.join('\n'),restored=new DatabaseSync(':memory:');restored.exec('PRAGMA foreign_keys=ON');restored.exec(normalized);
assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
for(const table of ordered){
 const query='SELECT * FROM '+quoted(table.name)+' ORDER BY rowid',a=sql.prepare(query),b=restored.prepare(query);a.setReadBigInts(true);b.setReadBigInts(true);assert.deepEqual(b.all(),a.all(),'Restored rows differ: '+table.name);
}
writeFileSync(output,normalized,{flag:'wx'});console.log(JSON.stringify({tables:ordered.length,bytes:Buffer.byteLength(normalized),validation:'All user-table rows match; local integrity and foreign keys pass'}));
sql.close();restored.close();
