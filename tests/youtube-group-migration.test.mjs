import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
test('migration moves tracked imports without rewriting existing manual group contents',()=>{
 const sql=new DatabaseSync(':memory:'),root=new URL('../drizzle/',import.meta.url);
 for(const name of readdirSync(root).filter(n=>n.endsWith('.sql')&&n<'0041').sort())sql.exec(readFileSync(new URL(name,root),'utf8'));
 const original=JSON.stringify([{kind:'reactor',target:'overlap'},{kind:'song',target:'Song'}]);
 sql.prepare('INSERT INTO following_groups VALUES(?,?,?,?,?,?)').run('manual','member','Original',original,1,'now');
 for(const target of ['overlap','global-import']){
  sql.prepare('INSERT INTO youtube_imported_follows VALUES(?,?,?)').run('member',target,'connection');
  sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member','reactor',target);
 }
 sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member','song','Song');
 sql.exec(readFileSync(new URL('0041_youtube_following_group.sql',root),'utf8'));
 assert.equal(sql.prepare('SELECT follows FROM following_groups WHERE id=?').get('manual').follows,original);
 assert.equal(sql.prepare('SELECT active FROM following_groups WHERE id=?').get('manual').active,1);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM following_groups WHERE kind='youtube'").get().n,1);
 assert.deepEqual(sql.prepare("SELECT target FROM follows WHERE kind='reactor'").all().map(r=>r.target),['overlap']);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_imported_follows').get().n,2);
 sql.exec("DELETE FROM follows WHERE user_id='member'");
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_imported_follows').get().n,2,'view changes must preserve provenance');
});
