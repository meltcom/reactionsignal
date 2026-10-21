import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function releaseFixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 let reads=0;
 const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){reads++;return sql.prepare(query).get(...values)||null;},async all(){reads++;return {results:sql.prepare(query).all(...values)};},run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}}},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={DB:db,COMMUNITY_MODERATOR_EMAILS:'lead@example.com,backup@example.com'};
 for(const [id,email] of [['lead','lead@example.com'],['backup','backup@example.com'],['fan','fan@example.com']])sql.prepare('INSERT INTO members(id,name,email,created_at) VALUES(?,?,?,?)').run(id,id,email,new Date().toISOString());
 return {sql,db,env,reads:()=>reads};
}
