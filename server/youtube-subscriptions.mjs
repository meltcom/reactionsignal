import {database,seedDatabase,catalog} from './db.mjs';
import {configured,startConnection,accessToken,deleteConnection} from './youtube-connection.mjs';
import {readSubscriptions} from '../youtube-subscriptions-core.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function youtubeSubscriptions(request,env,seed,user){
 if(!user?.id)return json({error:'Sign in to continue.'},401);
 const url=new URL(request.url),path=url.pathname.split('/').pop(),db=database(env);
 if(path==='config'&&request.method==='GET'){
  const row=await db.prepare('SELECT id,verified_at FROM youtube_connections WHERE user_id=?').bind(user.id).first();
  return json({configured:configured(env),connected:!!row,lastChecked:row?.verified_at||null,legacyFollowsUnclassified:true});
 }
 if(!['connect','preview','import','disconnect'].includes(path))return json({error:'Not found.'},404);
 if(request.method!=='POST')return json({error:'POST required.'},405);
 if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Use the Reaction Journey website.'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request.'},400);
 try{
 if(path==='connect')return await startConnection(request,env,user);
 const row=await db.prepare('SELECT * FROM youtube_connections WHERE user_id=?').bind(user.id).first();
 if(path==='disconnect'){
  if(body.confirm!==true)return json({error:'Confirm disconnecting and deleting imported follows.'},400);
  await db.prepare('DELETE FROM youtube_oauth_states WHERE user_id=?').bind(user.id).run();
  if(row)await deleteConnection(env,row,{revokeToken:true});
  return json({ok:true,message:'Imported follows and the stored connection were removed. Google revocation is retried if temporarily unavailable. Older unclassified follows remain; use Following to remove them.'});
 }
 if(!row)return json({error:'Connect YouTube before importing.'},409);
 if(!configured(env))return json({error:'YouTube connection setup is incomplete.'},503);
 // A fresh check before every read/write also closes revocation gaps between cron runs.
 let token=await accessToken(env,row);
 if(path==='preview'){
  try{const ids=await readSubscriptions(token,{fetcher:env.YOUTUBE_FETCH||fetch,signal:AbortSignal.timeout(30000)});return json({channelIds:ids,connectionId:row.id});}finally{token='';}
 }
 token='';
 if(body.connectionId!==row.id)return json({error:'The YouTube connection changed. Read subscriptions again.'},409);
 const ids=body.channelIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!/^UC[\w-]{22}$/.test(id)))return json({error:'Select between 1 and 100 valid reactor channels.'},400);
 const unique=[...new Set(ids)];await seedDatabase(db,seed);
 const known=new Set((await catalog(db,seed,env)).channels.map(c=>c.id));
 if(unique.some(id=>!known.has(id)))return json({error:'A selected reactor is no longer in the catalog. Refresh the preview.'},409);
 const ops=[];
 for(const id of unique){
  // Marker precedes the follow within the same transaction so activity triggers omit imported data.
  ops.push(db.prepare("INSERT OR IGNORE INTO youtube_imported_follows SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM youtube_connections WHERE user_id=? AND id=?) AND NOT EXISTS(SELECT 1 FROM follows WHERE user_id=? AND kind='reactor' AND target=?) AND NOT EXISTS(SELECT 1 FROM hidden_reactors WHERE user_id=? AND channel_id=?)").bind(user.id,id,row.id,user.id,row.id,user.id,id,user.id,id));
  ops.push(db.prepare("INSERT OR IGNORE INTO follows(user_id,kind,target) SELECT ?,'reactor',? WHERE EXISTS(SELECT 1 FROM youtube_imported_follows WHERE user_id=? AND target=? AND connection_id=?) AND EXISTS(SELECT 1 FROM youtube_connections WHERE user_id=? AND id=?) RETURNING target").bind(user.id,id,user.id,id,row.id,user.id,row.id));
 }
 const results=await db.batch(ops),added=results.reduce((n,r,i)=>n+(i%2?r.results.length:0),0);
 return json({added,skipped:unique.length-added});
 }catch(error){return json({error:error.status?error.message:'YouTube connection could not be completed. Try again.'},error.status||503);}
}
