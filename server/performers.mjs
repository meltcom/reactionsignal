import {database,seedDatabase,status} from './db.mjs';
import {pushStatus,renewSubscriptions,processPushJobs} from './push.mjs';
import {runDiscovery} from './discovery.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=(value,min,max,label)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(`${label} must contain ${min}–${max} characters.`);return value.trim();};
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export async function managePerformers(request,env,seed,user){try{
 if(!user)fail('Sign in to continue.',401);if(!user.moderator)fail('Moderator access required.',403);
 const db=database(env);await seedDatabase(db,seed);
 const url=new URL(request.url),path=url.pathname.replace('/api/performers','');
 const all=async(q,...v)=>(await db.prepare(q).bind(...v).all()).results;
 const first=async(q,...v)=>db.prepare(q).bind(...v).first();
 if(request.method==='GET'){
  if(path==='/notifications'){
   const counts=await first("SELECT COUNT(*) n FROM matches m JOIN videos v ON v.id=m.video_id JOIN performers p ON p.id=m.performer_id WHERE m.status='PENDING' AND p.status='active' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)");
   const reports=await first("SELECT COUNT(*) n FROM contributions WHERE kind='flag' AND status='pending'");
   if(url.searchParams.get('summary')==='1')return json({count:counts.n,reports:reports.n});
   return json({count:counts.n,reports:reports.n,push:await pushStatus(db,env),items:await all(`SELECT m.performer_id,m.video_id,m.source,COALESCE(v.discovered_at,v.published_at) created_at,v.title,v.published_at,v.available,c.name channel_name,p.name performer_name,m.status match_status,0 excluded
     FROM matches m JOIN videos v ON v.id=m.video_id JOIN performers p ON p.id=m.performer_id
     LEFT JOIN channels c ON c.id=v.channel_id WHERE m.status='PENDING' AND p.status='active' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id) ORDER BY COALESCE(v.discovered_at,v.published_at) DESC,m.video_id LIMIT 100`)});
  }
  if(path==='/list'){
   const items=await all(`SELECT p.*,(SELECT COUNT(*) FROM matches m WHERE m.performer_id=p.id AND m.status='PENDING') pending,
    (SELECT COUNT(*) FROM matches m WHERE m.performer_id=p.id AND m.status IN ('CONFIRMED','PROBABLE')) approved,
    (SELECT value FROM state WHERE key='search:'||p.id) last_search,
    (SELECT value FROM state WHERE key='search-progress:'||p.id) progress,
    (SELECT value FROM state WHERE key='search-error:'||p.id) search_error FROM performers p ORDER BY p.name`);
   return json({items:items.map(p=>({...p,aliases:JSON.parse(p.aliases),progress:p.progress?JSON.parse(p.progress):null})),discovery:await status(db,env)});
  }
  if(path==='/results'){
   const id=text(url.searchParams.get('id'),1,100,'Performer');if(!await first('SELECT 1 FROM performers WHERE id=?',id))fail('Performer not found.',404);
   return json({items:await all(`SELECT m.performer_id,m.video_id,m.status,m.source,v.title,v.published_at,v.format,v.available,c.name channel_name
    FROM matches m JOIN videos v ON v.id=m.video_id LEFT JOIN channels c ON c.id=v.channel_id WHERE m.performer_id=? AND m.status='PENDING' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)
    ORDER BY CASE WHEN m.status='PENDING' THEN 0 ELSE 1 END,v.published_at DESC LIMIT 100`,id)});
  }
  fail('Not found.',404);
 }
 if(request.method!=='POST')fail('Method not allowed.',405);
 if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Use the Reaction Signal website.',403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('JSON required.',415);
 const raw=await request.text();if(raw.length>12000)fail('Request too large.',413);let b;try{b=JSON.parse(raw);}catch{fail('Invalid JSON.');}if(!b||typeof b!=='object'||Array.isArray(b))fail('Invalid request.');
 const now=new Date().toISOString();
 if(path==='/push/connect'){
  const subscriptions=await renewSubscriptions(env,seed);const jobs=await processPushJobs(env,seed);
  return json({subscriptions,jobs,push:await pushStatus(db,env),message:subscriptions.reason||'Channel notification requests sent. More channels are connected by subsequent scheduled batches.'});
 }
 if(path==='/notifications/review'){
  const id=text(b.performerId,1,100,'Performer'),video=text(b.videoId,11,11,'Video');
  if(!/^[\w-]{11}$/.test(video)||!['keep','remove'].includes(b.action))fail('Choose Keep or Remove.');
  const entry=await first('SELECT * FROM discovery_notifications WHERE performer_id=? AND video_id=?',id,video);if(!entry)fail('Addition not found.',404);
  if(entry.status!=='new')fail('This addition was already reviewed. Refresh the queue.',409);
  const note=b.action==='remove'?text(b.note,5,500,'Removal reason'):'Checked by moderator';
  const pending="EXISTS(SELECT 1 FROM discovery_notifications WHERE performer_id=? AND video_id=? AND status='new')";
  const ops=[];
  if(b.action==='remove'){
   ops.push(db.prepare(`INSERT OR IGNORE INTO exclusions(performer_id,video_id,reason) SELECT ?,?,? WHERE ${pending}`).bind(id,video,note,id,video));
   ops.push(db.prepare(`UPDATE matches SET status='REJECTED' WHERE performer_id=? AND video_id=? AND ${pending}`).bind(id,video,id,video));
  }
  ops.push(db.prepare("UPDATE discovery_notifications SET status=?,reviewed_at=?,reviewed_by=?,note=? WHERE performer_id=? AND video_id=? AND status='new'").bind(b.action==='remove'?'removed':'kept',now,user.id,note,id,video));
  await db.batch(ops);return json({ok:true,message:b.action==='remove'?'Video removed for this performer. Future discovery will respect this exclusion.':'Addition checked. The video stays published.'});
 }
 if(path==='/save'){
  const name=text(b.name,2,100,'Performer name');
  if(!Array.isArray(b.aliases)||b.aliases.length>4)fail('Use up to four alternate names.');
  const aliases=[name,...b.aliases.map(a=>text(a,2,100,'Alternate name'))].filter((a,i,list)=>list.findIndex(x=>norm(x)===norm(a))===i);
  if(aliases.some(a=>!/[\p{L}\p{N}]/u.test(a)))fail('Names must contain letters or numbers.');
  const official=text(b.officialUrl,10,500,'Official link');let link;try{link=new URL(official);if(link.protocol!=='https:'||link.username||link.password)throw new Error();}catch{fail('Use an HTTPS official channel or website link.');}
  if(!['draft','active'].includes(b.status)||!['review','auto'].includes(b.reviewMode)||![0,30,90,365].includes(b.lookbackDays)||typeof b.discoveryEnabled!=='boolean'||typeof b.chatEnabled!=='boolean')fail('Choose valid coverage and discovery options.');
  const existing=b.id?await first('SELECT * FROM performers WHERE id=?',text(b.id,1,100,'Performer ID')):null;
  if(b.id&&!existing)fail('Performer not found.',404);
  if((await all('SELECT id,name FROM performers')).some(p=>p.id!==existing?.id&&norm(p.name)===norm(name)))fail('A performer with this name already exists. Edit their profile instead.',409);
  if(b.requestId&&!await first("SELECT 1 FROM coverage_requests WHERE id=? AND status IN ('pending','shortlisted')",text(b.requestId,1,100,'Recommendation ID')))fail('Recommendation unavailable.',409);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(norm(name)));
  const id=existing?.id||'artist-'+Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,20);
  const stmts=[];
  const values=[name,JSON.stringify(aliases),link.href,b.status,b.reviewMode,b.lookbackDays,Number(b.discoveryEnabled),Number(b.chatEnabled),now];
  if(existing)stmts.push(db.prepare('UPDATE performers SET name=?,aliases=?,official_url=?,status=?,review_mode=?,lookback_days=?,discovery_enabled=?,chat_enabled=?,updated_at=? WHERE id=?').bind(...values,id));
  else stmts.push(db.prepare('INSERT INTO performers(name,aliases,official_url,status,review_mode,lookback_days,discovery_enabled,chat_enabled,updated_at,id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(...values,id));
  if(existing&&(existing.aliases!==JSON.stringify(aliases)||existing.lookback_days!==b.lookbackDays))for(const key of [`search:${id}`,`search-progress:${id}`])stmts.push(db.prepare('DELETE FROM state WHERE key=?').bind(key));
  if(b.requestId)stmts.push(db.prepare("UPDATE coverage_requests SET performer_id=?,status=?,review_note=?,reviewed_at=?,reviewed_by=? WHERE id=?").bind(id,b.status==='active'?'covered':'shortlisted',b.status==='active'?'Coverage is now available.':'A draft coverage profile has been created.',now,user.id,b.requestId));
  if(b.status==='active')stmts.push(db.prepare("INSERT OR IGNORE INTO discovery_notifications(performer_id,video_id,created_at,source) SELECT m.performer_id,m.video_id,?,m.source FROM matches m JOIN videos v ON v.id=m.video_id WHERE m.performer_id=? AND m.status='CONFIRMED' AND v.discovered_at IS NOT NULL AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)").bind(now,id));
  if(b.status==='active')stmts.push(db.prepare("UPDATE coverage_requests SET status='covered',review_note='Coverage is now available.',reviewed_at=?,reviewed_by=? WHERE performer_id=?").bind(now,user.id,id));
  stmts.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('performer-audit:'+crypto.randomUUID(),JSON.stringify({performerId:id,actor:user.id,at:now,action:existing?'updated':'created',status:b.status})));
  await db.batch(stmts);
  return json({ok:true,id,message:b.status==='draft'?'Draft saved. Discovery is queued when enabled; publish after reviewing results.':'Coverage published. Discovery uses your saved options.'});
 }
 if(path==='/discover'){
  const id=text(b.id,1,100,'Performer');const p=await first('SELECT * FROM performers WHERE id=?',id);if(!p)fail('Performer not found.',404);if(!p.discovery_enabled)fail('Enable discovery for this performer first.');
  const result=await runDiscovery(env,seed,fetch,{performerId:id});
  return json({result,message:result.status==='blocked'?result.reason:result.status==='busy'?'Another discovery batch is running. Try again in two minutes.':result.detail||'Discovery batch finished. Review the results below.'});
 }
 if(path==='/mark-short'){
  const id=text(b.id,1,100,'Performer');
  if(!Array.isArray(b.videos)||!b.videos.length||b.videos.length>50||b.videos.some(v=>typeof v!=='string'||!/^[-\w]{11}$/.test(v)))fail('Select 1–50 valid videos.');
  if(!await first('SELECT 1 FROM performers WHERE id=?',id))fail('Performer not found.',404);
  const ops=[];
  for(const video of [...new Set(b.videos)]){
   ops.push(db.prepare("UPDATE videos SET format='SHORT' WHERE id=? AND EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=?)").bind(video,id,video));
   ops.push(db.prepare("INSERT OR IGNORE INTO exclusions(performer_id,video_id,reason) SELECT ?,?,'Moderator marked as Short/excerpt' WHERE EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=?)").bind(id,video,id,video));
   ops.push(db.prepare("UPDATE matches SET status='REJECTED' WHERE performer_id=? AND video_id=? AND status<>'REJECTED'").bind(id,video));
   ops.push(db.prepare("UPDATE discovery_notifications SET status='removed',reviewed_at=?,reviewed_by=?,note='Moderator marked as Short/excerpt' WHERE performer_id=? AND video_id=?").bind(now,user.id,id,video));
  }
  ops.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('performer-audit:'+crypto.randomUUID(),JSON.stringify({performerId:id,actor:user.id,at:now,action:'mark-short',videos:[...new Set(b.videos)]})));
  const results=await db.batch(ops);const changed=results.slice(0,-1).reduce((n,r,i)=>n+(i%4===2?Number(r.meta?.changes||0):0),0);
  return json({ok:true,message:`${changed} video${changed===1?'':'s'} marked as Short and excluded for this performer. Future discovery respects the exclusion.`});
 }
 if(path==='/review'){
  const id=text(b.id,1,100,'Performer');if(!Array.isArray(b.videos)||!b.videos.length||b.videos.length>50||b.videos.some(v=>typeof v!=='string'||!/^[-\w]{11}$/.test(v)))fail('Select 1–50 valid videos.');
  if(!['approve','exclude'].includes(b.decision))fail('Choose approve or exclude.');
  if(!await first('SELECT 1 FROM performers WHERE id=?',id))fail('Performer not found.',404);
  const ops=[];
  for(const video of [...new Set(b.videos)]){
   if(b.decision==='approve')ops.push(db.prepare("UPDATE matches SET status='CONFIRMED',source='Moderator-approved discovery' WHERE performer_id=? AND video_id=? AND status='PENDING' AND EXISTS(SELECT 1 FROM videos WHERE id=? AND available=1) AND NOT EXISTS(SELECT 1 FROM exclusions WHERE performer_id=? AND video_id=?)").bind(id,video,video,id,video));
   else{
    ops.push(db.prepare("INSERT OR IGNORE INTO exclusions(performer_id,video_id,reason) SELECT ?,?,'Moderator excluded during discovery review' WHERE EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=? AND status IN ('PENDING','CONFIRMED','PROBABLE'))").bind(id,video,id,video));
    ops.push(db.prepare("UPDATE discovery_notifications SET status='removed',reviewed_at=?,reviewed_by=?,note='Excluded during discovery review' WHERE performer_id=? AND video_id=?").bind(now,user.id,id,video));
    ops.push(db.prepare("UPDATE matches SET status='REJECTED' WHERE performer_id=? AND video_id=? AND status IN ('PENDING','CONFIRMED','PROBABLE')").bind(id,video));
   }
  }
  ops.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('performer-audit:'+crypto.randomUUID(),JSON.stringify({performerId:id,actor:user.id,at:now,action:b.decision,videos:b.videos})));
  const changes=await db.batch(ops);
  const changed=changes.slice(0,-1).reduce((total,result,index)=>total+(b.decision==='approve'||index%3===2?Number(result.meta?.changes||0):0),0);
  return json({ok:true,message:`${changed} result${changed===1?'':'s'} ${b.decision==='approve'?'approved':'excluded'}. Excluded videos stay excluded in future scans.`});
 }
 fail('Not found.',404);
}catch(error){if(error.status)return json({error:error.message},error.status);console.error('Performer management failed');return json({error:'Performer management is temporarily unavailable. Please retry.'},503);}}
