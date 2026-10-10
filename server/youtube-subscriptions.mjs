import {database,seedDatabase,catalog} from './db.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function youtubeSubscriptions(request,env,seed,user){
 if(!user?.id)return json({error:'Sign in to continue.'},401);
 const url=new URL(request.url);
 if(url.pathname==='/api/youtube/subscriptions/config'&&request.method==='GET'){
  const clientId=String(env.GOOGLE_YOUTUBE_CLIENT_ID||'');
  return json({clientId:/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)?clientId:null});
 }
 if(url.pathname!=='/api/youtube/subscriptions/import')return json({error:'Not found.'},404);
 if(request.method!=='POST')return json({error:'POST required.'},405);
 if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Use the Reaction Journey website.'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 const ids=body?.channelIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!/^UC[\w-]{22}$/.test(id)))return json({error:'Select between 1 and 100 valid reactor channels.'},400);
 const unique=[...new Set(ids)],db=database(env);await seedDatabase(db,seed);
 const known=new Set((await catalog(db,seed,env)).channels.map(c=>c.id));
 if(unique.some(id=>!known.has(id)))return json({error:'A selected reactor is no longer in the catalog. Refresh the preview.'},409);
 // Atomic, additive and idempotent. Recheck hidden channels at write time.
 const results=await db.batch(unique.map(id=>db.prepare("INSERT OR IGNORE INTO follows(user_id,kind,target) SELECT ?,'reactor',id FROM channels WHERE id=? AND NOT EXISTS(SELECT 1 FROM hidden_reactors WHERE user_id=? AND channel_id=channels.id) RETURNING target").bind(user.id,id,user.id)));
 // D1 change metadata includes activity-trigger writes; count only inserted follows.
 const added=results.reduce((n,r)=>n+r.results.length,0);
 return json({added,skipped:unique.length-added});
}
