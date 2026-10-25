import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('official channel migration is ordered after YouTube following and safely excludes existing and future reaction matches',()=>{
 const root=new URL('../drizzle/',import.meta.url),sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(root).filter(n=>n.endsWith('.sql')&&n<'0042_official_channel_exclusion.sql').sort())sql.exec(readFileSync(new URL(name,root),'utf8'));
 const channel='UCeTfwcnUVurw7Qrk_KF5Idw';
 sql.prepare('INSERT INTO channels(id,name) VALUES(?,?)').run(channel,'Missioned Souls');
 sql.prepare('INSERT INTO videos(id,channel_id,title,available) VALUES(?,?,?,1)').run('official1234',channel,'Official upload');
 sql.prepare('INSERT INTO matches(performer_id,video_id,status,source) VALUES(?,?,?,?)').run('missioned-souls','official1234','CONFIRMED','historic');
 sql.exec(readFileSync(new URL('0042_official_channel_exclusion.sql',root),'utf8'));
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM matches WHERE video_id='official1234'").get().n,0);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM exclusions WHERE video_id='official1234' AND performer_id='missioned-souls'").get().n,1);
 sql.prepare('INSERT INTO matches(performer_id,video_id,status,source) VALUES(?,?,?,?)').run('missioned-souls','official1234','CONFIRMED','new attempt');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM matches WHERE video_id='official1234'").get().n,0);
 sql.exec(readFileSync(new URL('0042_official_channel_exclusion.sql',root),'utf8'));
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM exclusions WHERE video_id='official1234'").get().n,1);
});
