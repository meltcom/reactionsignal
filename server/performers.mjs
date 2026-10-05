import {database,seedDatabase,status} from './db.mjs';
import {pushStatus,renewSubscriptions,processPushJobs} from './push.mjs';
import {recheckStatus,recheckBatch,publishPreview} from './recheck.mjs';
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
 if(url.searchParams.has('id')&&url.searchParams.get('id')!=='missioned-souls')fail('Reaction Journey covers Missioned Souls only.',400);
 if(request.method==='GET'){
  if(path==='/channels'){
   const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0)),q=(url.searchParams.get('q')||'').slice(0,100),unavailable=url.searchParams.get('unavailable')==='1';
   const items=await all("SELECT id,name,discovery_scope,recent_failures,recent_retry_at,recent_error,recent_checked_at FROM channels WHERE instr(lower(name||' '||id),lower(?))>0 "+(unavailable?"AND recent_failures>0 ":"")+"ORDER BY name,id LIMIT 51 OFFSET ?",q,offset);
   return json({items:items.slice(0,50),hasMore:items.length>50});
  }
  if(path==='/classification'){
   const group=url.searchParams.get('group');if(!['unknown','probable'].includes(group))fail('Choose Unknown or Probable.');
   const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
   const items=await all("SELECT v.id,v.title,v.format,v.published_at,c.name channel_name,m.status FROM videos v JOIN matches m ON m.video_id=v.id LEFT JOIN channels c ON c.id=v.channel_id WHERE m.performer_id='missioned-souls' AND m.status IN ('CONFIRMED','PROBABLE','PENDING') AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.video_id=v.id AND e.performer_id=m.performer_id) AND "+(group==='unknown'?"v.format='UNKNOWN'":"m.status='PROBABLE'")+" ORDER BY v.id LIMIT 51 OFFSET ?",offset);
   return json({items:items.slice(0,50),hasMore:items.length>50,offset});
  }
  if(path==='/shorts/recovery')return json({items:await all("SELECT v.id video_id,v.title,v.format,v.published_at,c.name channel_name,e.reason FROM exclusions e JOIN videos v ON v.id=e.video_id JOIN matches m ON m.video_id=v.id AND m.performer_id=e.performer_id LEFT JOIN channels c ON c.id=v.channel_id WHERE e.performer_id='missioned-souls' AND e.reason='Moderator marked as Short/excerpt' AND v.format='SHORT' AND v.available=1 AND m.status='REJECTED' ORDER BY v.published_at DESC,v.id LIMIT 100")});
  if(path==='/recheck')return json(await recheckStatus(db));
  if(path==='/notifications'){
   const counts=await first("SELECT COUNT(*) n FROM matches m JOIN videos v ON v.id=m.video_id JOIN performers p ON p.id=m.performer_id WHERE m.status='PENDING' AND p.status='active' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)");
   const reports=await first("SELECT COUNT(*) n FROM contributions WHERE kind='flag' AND status='pending'");
   if(url.searchParams.get('summary')==='1')return json({count:counts.n,reports:reports.n});
   const group=url.searchParams.get('group')||'all';if(!['all','strong','shorts','unrelated','uncertain','protected','unprocessed'].includes(group))fail('Invalid review group.');
   return json({count:counts.n,reports:reports.n,push:await pushStatus(db,env),items:await all(`SELECT m.performer_id,m.video_id,m.source,COALESCE(v.discovered_at,v.published_at) created_at,v.title,v.published_at,v.format,v.available,r.outcome review_group,r.reason review_reason,c.name channel_name,p.name performer_name,m.status match_status,0 excluded
     FROM matches m JOIN videos v ON v.id=m.video_id JOIN performers p ON p.id=m.performer_id
     LEFT JOIN channels c ON c.id=v.channel_id LEFT JOIN review_previews r ON r.performer_id=m.performer_id AND r.video_id=m.video_id AND r.original_source=m.source AND r.original_title=v.title AND r.original_format=v.format AND r.aliases=p.aliases AND r.review_mode=p.review_mode AND r.checked_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours') WHERE m.status='PENDING' AND p.status='active' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id) AND (?='all' OR COALESCE(r.outcome,'unprocessed')=?) ORDER BY COALESCE(v.discovered_at,v.published_at) DESC,m.video_id LIMIT 100`,group,group)});
  }
  if(path==='/list'){
   const items=await all(`SELECT p.*,(SELECT COUNT(*) FROM matches m WHERE m.performer_id=p.id AND m.status='PENDING') pending,
    (SELECT COUNT(*) FROM matches m WHERE m.performer_id=p.id AND m.status IN ('CONFIRMED','PROBABLE')) approved,
    (SELECT value FROM state WHERE key='search:'||p.id) last_search,
    (SELECT value FROM state WHERE key='search-progress:'||p.id) progress,
    (SELECT value FROM state WHERE key='search-error:'||p.id) search_error FROM performers p WHERE p.id='missioned-souls' ORDER BY p.name`);
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
 if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Use the Reaction Journey website.',403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('JSON required.',415);
 const raw=await request.text();if(raw.length>12000)fail('Request too large.',413);let b;try{b=JSON.parse(raw);}catch{fail('Invalid JSON.');}if(!b||typeof b!=='object'||Array.isArray(b))fail('Invalid request.');
 if((b.id&&b.id!=='missioned-souls')||(b.performerId&&b.performerId!=='missioned-souls')||(path==='/save'&&(!b.id||b.name!=='Missioned Souls')))fail('Reaction Journey covers Missioned Souls only.',400);
 const now=new Date().toISOString();
 if(path==='/recheck'){
  if(!['start','pause','batch','publish'].includes(b.action))fail('Choose a recheck action.');
  if(b.action==='publish')return json(await publishPreview(db,user));
  if(b.action==='start'||b.action==='pause')await db.prepare("INSERT INTO state(key,value) VALUES('recheck-enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(b.action==='start'?'1':'0').run();
  if(b.action==='start'||b.action==='batch'){const result=await recheckBatch(env);return json({...result,message:result.message||'Preview only: matches are unchanged. Further batches run every 15 minutes while enabled.'});}
  return json({message:'Background recheck previews paused.'});
 }

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
 if(path==='/channels/save'||path==='/channels/retry'){
  const channel=text(b.channelId,24,200,'Channel ID or URL');
  let id=channel;
  if(channel.startsWith('https://')){let u;try{u=new URL(channel);}catch{fail('Invalid channel URL.');}if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)||u.username||u.password||u.port)fail('Use a YouTube channel URL.');id=u.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/)?.[1];}
  if(!/^UC[\w-]{22}$/.test(id||''))fail('Use the channel ID (UC plus 22 characters) or its youtube.com/channel/UC… URL. Handles must be resolved to a channel ID first.');
  const prior=await first('SELECT * FROM channels WHERE id=?',id),note=text(b.note,5,500,'Reason');
  const ops=[];
  if(path==='/channels/retry'){
   if(!prior||prior.discovery_scope!=='eligible')fail('Activate this channel before requesting a retry.');
   ops.push(db.prepare('UPDATE channels SET recent_retry_at=NULL,recent_attempted_at=NULL,recent_checked_at=NULL,uploads=NULL WHERE id=?').bind(id));
  }else{
   const name=text(b.name,2,100,'Channel name');if(!['eligible','paused','retired','official','review','other'].includes(b.status))fail('Choose a valid channel status.');
   ops.push(db.prepare('INSERT INTO channels(id,name,discovery_scope,scope_locked) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,discovery_scope=excluded.discovery_scope,scope_locked=1').bind(id,name,b.status));
   if(b.status==='eligible'&&prior?.discovery_scope!=='eligible')ops.push(db.prepare('UPDATE channels SET recent_retry_at=NULL,recent_attempted_at=NULL,recent_checked_at=NULL WHERE id=?').bind(id));
  }
  ops.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('channel-audit:'+crypto.randomUUID(),JSON.stringify({channelId:id,actor:user.id,at:now,action:path==='/channels/retry'?'retry':'save',before:prior?{name:prior.name,status:prior.discovery_scope}:null,name:b.name,status:b.status,note})));
  await db.batch(ops);return json({ok:true,message:path==='/channels/retry'?'Retry queued for a scheduled discovery run.':'Channel saved. Only Active reactor channels receive routine discovery checks.'});
 }
 if(path==='/classification/confirm'){
  const video=text(b.videoId,11,11,'Video');if(!/^[\w-]{11}$/.test(video))fail('Invalid video ID.');
  const prior=await first("SELECT v.format,m.status FROM videos v JOIN matches m ON m.video_id=v.id WHERE v.id=? AND m.performer_id='missioned-souls' AND v.available=1 AND m.status IN ('PENDING','PROBABLE','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.video_id=v.id AND e.performer_id=m.performer_id)",video);
  if(!prior)fail('Video unavailable or excluded.',409);
  if(!['SHORT','FULL_LENGTH','UNKNOWN'].includes(b.format)||prior.format==='UNKNOWN'&&b.format==='UNKNOWN')fail('Choose Short or Full-length for an Unknown video.');
  await db.batch([
   db.prepare("UPDATE videos SET format=?,format_locked=1 WHERE id=? AND available=1 AND EXISTS(SELECT 1 FROM matches m WHERE m.video_id=videos.id AND m.performer_id='missioned-souls' AND m.status IN ('PENDING','PROBABLE','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.video_id=m.video_id AND e.performer_id=m.performer_id))").bind(b.format,video),
   db.prepare("UPDATE matches SET status='CONFIRMED',source='Moderator-confirmed classification' WHERE video_id=? AND performer_id='missioned-souls' AND status IN ('PENDING','PROBABLE','CONFIRMED') AND EXISTS(SELECT 1 FROM videos WHERE id=? AND available=1) AND NOT EXISTS(SELECT 1 FROM exclusions WHERE video_id=? AND performer_id='missioned-souls')").bind(video,video,video),
   db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('performer-audit:'+crypto.randomUUID(),JSON.stringify({actor:user.id,action:'confirm-classification',videoId:video,from:prior,format:b.format,at:now}))
  ]);return json({ok:true,message:'Reaction confirmed and format saved.'});
 }
 if(path==='/format'){
  const video=text(b.videoId,11,11,'Video');if(!/^[\w-]{11}$/.test(video)||!['SHORT','FULL_LENGTH','UNKNOWN'].includes(b.format))fail('Choose Short, Full-length, or Unknown.');
  const prior=await first("SELECT v.format FROM videos v JOIN matches m ON m.video_id=v.id WHERE v.id=? AND m.performer_id='missioned-souls'",video);if(!prior)fail('Video not found.',404);
  await db.batch([
   db.prepare("UPDATE videos SET format=?,format_locked=1 WHERE id=?").bind(b.format,video),
   db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('performer-audit:'+crypto.randomUUID(),JSON.stringify({performerId:'missioned-souls',actor:user.id,at:now,action:'change-format',videoId:video,from:prior.format,to:b.format}))
  ]);return json({ok:true,message:'Video format updated. Approval and exclusions are unchanged.'});
 }
 if(path==='/mark-short'||path==='/shorts/restore'){
  const id=text(b.id,1,100,'Performer');
  if(!Array.isArray(b.videos)||!b.videos.length||b.videos.length>50||b.videos.some(v=>typeof v!=='string'||!/^[-\w]{11}$/.test(v)))fail('Select 1–50 valid videos.');
  if(!await first('SELECT 1 FROM performers WHERE id=?',id))fail('Performer not found.',404);
  const ops=[],restore=path==='/shorts/restore';
  for(const video of [...new Set(b.videos)]){
   if(restore){
    ops.push(db.prepare("UPDATE matches SET status='CONFIRMED',source='Moderator-restored Short' WHERE performer_id=? AND video_id=? AND status='REJECTED' AND EXISTS(SELECT 1 FROM videos WHERE id=? AND format='SHORT' AND available=1) AND EXISTS(SELECT 1 FROM exclusions WHERE performer_id=? AND video_id=? AND reason='Moderator marked as Short/excerpt')").bind(id,video,video,id,video));
    ops.push(db.prepare("DELETE FROM exclusions WHERE performer_id=? AND video_id=? AND reason='Moderator marked as Short/excerpt' AND EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=? AND status='CONFIRMED' AND source='Moderator-restored Short')").bind(id,video,id,video));
   }else ops.push(db.prepare("UPDATE videos SET format='SHORT',format_locked=1 WHERE id=? AND EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=?)").bind(video,id,video));
  }
  ops.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('performer-audit:'+crypto.randomUUID(),JSON.stringify({performerId:id,actor:user.id,at:now,action:restore?'restore-short':'classify-short',videos:[...new Set(b.videos)]})));
  const results=await db.batch(ops);const changed=results.slice(0,-1).reduce((n,r,i)=>n+(!restore||i%2===0?Number(r.meta?.changes||0):0),0);
  return json({ok:true,message:restore?`${changed} Shorts restored and approved. Other exclusions remain unchanged.`:`${changed} videos classified as Short. Publication status unchanged; approve pending matches separately.`});
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
