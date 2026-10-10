import {award} from './community.mjs';
import {canPublishDirectly} from './reputation.mjs';
import {database,seedDatabase} from './db.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const txt=(v,min,max)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail(`Use ${min}–${max} characters.`);return v.trim();};
export function settings(input,performerIds=[]){
 const b=input||{},out={};
 const choices={theme:['light','dark','system'],accent:['teal','blue','violet'],layout:['cards','compact','large','table'],density:['compact','standard','spacious'],thumbnail:['small','medium','large'],sort:['latest','rated','views','comments','subscribers','discovered','new-reactor','reactor-ranked'],group:['none','performer','reactor','song','genre','date','source'],landing:['all','today','favorites','following','community'],performer:['all',...performerIds]};
 for(const [k,allowed] of Object.entries(choices))if(b[k]!==undefined){if(!allowed.includes(b[k]))fail(`Invalid ${k}.`);out[k]=b[k];}
 for(const k of ['hideShorts','hideWatched','verifiedOnly','favoritesOnly','autoplay'])if(b[k]!==undefined){if(typeof b[k]!=='boolean')fail(`Invalid ${k}.`);out[k]=b[k];}
 for(const k of ['minSubscribers','minRating','days','columns'])if(b[k]!==undefined){if(typeof b[k]!=='number'||!Number.isFinite(b[k])||b[k]<0||b[k]>(k==='minRating'?5:k==='columns'?5:k==='days'?36500:1e10))fail(`Invalid ${k}.`);out[k]=b[k];}
 for(const k of ['startDate','endDate'])if(b[k]!==undefined){if(b[k]!==''&&(!/^\d{4}-\d{2}-\d{2}$/.test(b[k])||Number.isNaN(Date.parse(b[k]))))fail('Invalid date.');out[k]=b[k];}
 for(const k of ['query','song','genre','reactor','defaultView'])if(b[k]!==undefined)out[k]=typeof b[k]==='string'?b[k].slice(0,200):'';
 if(b.fields!==undefined){if(!Array.isArray(b.fields)||b.fields.some(x=>!['subscribers','views','likes','date','rating','comments','performer','song','genre','discovered'].includes(x)))fail('Invalid display fields.');out.fields=b.fields;}
 return out;
}
export async function social(request,env,seed,user){try{
 const db=database(env);await seedDatabase(db,seed);if(!user)fail('Sign in to continue.',401);
 const active=(await db.prepare("SELECT id,name,chat_enabled FROM performers WHERE status='active' AND id='missioned-souls' ORDER BY name").all()).results;
 const rooms=[...active.filter(p=>p.chat_enabled).map(p=>({id:p.id,name:p.name,description:'Discuss the music and reactions.'})),{id:'new-reactions',name:'New reactions today'},{id:'song-talk',name:'Songs & performances'}];
 const performerIds=active.map(p=>p.id);
 const url=new URL(request.url),path=url.pathname.replace('/api/social',''),now=new Date().toISOString();
 const all=async(q,...v)=>(await db.prepare(q).bind(...v).all()).results;
 const first=async(q,...v)=>db.prepare(q).bind(...v).first();
 const run=async(q,...v)=>db.prepare(q).bind(...v).run();
 if(request.method==='GET'){
  if(path==='/dashboard'){
    // These account-scoped reads are independent; avoid one round trip after another.
    const reads={
      userId: async()=>(user.id),
      reactorScores: async()=>(await all('SELECT channel_id,COUNT(*) count,AVG(score) average FROM reactor_ratings GROUP BY channel_id')),
      myReactorRatings: async()=>(await all('SELECT channel_id,score FROM reactor_ratings WHERE user_id=?',user.id)),
      hiddenReactors: async()=>(await all('SELECT h.channel_id,c.name FROM hidden_reactors h JOIN channels c ON c.id=h.channel_id WHERE h.user_id=? ORDER BY c.name',user.id)),
      preferences: async()=>(JSON.parse((await first('SELECT settings FROM preferences WHERE user_id=?',user.id))?.settings||'{}')),
      views: async()=>((await all('SELECT * FROM saved_views WHERE user_id=? ORDER BY created_at DESC',user.id)).map(v=>({...v,settings:JSON.parse(v.settings)}))),
      follows: async()=>(await all('SELECT kind,target FROM follows WHERE user_id=?',user.id)),
      watch: async()=>(await all('SELECT video_id,status,favorite FROM watch WHERE user_id=?',user.id)),
      blocks: async()=>(await all('SELECT b.target,m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM blocks b LEFT JOIN members m ON m.id=b.target WHERE b.user_id=?',user.id)),
      reputation: async()=>(await all('SELECT amount,reason,created_at FROM reputation_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user.id)),
      reputationTotal: async()=>((await first('SELECT COALESCE(SUM(amount),0) total FROM reputation_events WHERE user_id=?',user.id)).total),
      leaders: async()=>(await all('SELECT m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points,SUM(r.amount) reputation FROM reputation_events r JOIN members m ON m.id=r.user_id GROUP BY r.user_id HAVING SUM(r.amount)>0 ORDER BY reputation DESC LIMIT 20')),
      scores: async()=>(await all("SELECT video_id,COUNT(*) comments FROM contributions WHERE kind='comment' AND channel_id IS NULL AND status='accepted' GROUP BY video_id")),
    };
    return json(Object.fromEntries(await Promise.all(
      Object.entries(reads).map(async([key,read])=>[key,await read()])
    )));
  }
  if(path==='/comments'){const channel=url.searchParams.get('channel');const target=channel||url.searchParams.get('video');if(!target||channel&&url.searchParams.has('video'))fail('Choose one discussion.');return json({items:await all(`SELECT c.id,c.parent_id,c.user_id,c.body,c.status,c.created_at,m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points,(SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id) likes,EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) liked FROM contributions c JOIN members m ON m.id=c.user_id WHERE c.kind='comment' AND ${channel?'c.channel_id=?':"c.channel_id IS NULL AND c.video_id=?"} AND (c.status='accepted' OR (c.user_id=? AND c.status='pending')) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.target=c.user_id) ORDER BY c.created_at ASC LIMIT 300`,user.id,target,user.id,user.id)});}
  if(path==='/rooms'){
   const data=[];for(const r of rooms){const unread=await first("SELECT COUNT(*) n FROM chat_messages c WHERE room=? AND status='visible' AND user_id<>? AND created_at>COALESCE((SELECT last_read FROM room_members WHERE user_id=? AND room=?),'') AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.target=c.user_id)",r.id,user.id,user.id,r.id,user.id);const active=await first('SELECT COUNT(*) n FROM room_members WHERE room=? AND seen_at>?',r.id,new Date(Date.now()-60000).toISOString());data.push({...r,unread:unread.n,active:active.n});}return json({rooms:data});
  }
  if(path==='/chat'){const room=url.searchParams.get('room');if(!rooms.some(r=>r.id===room))fail('Unknown room.');return json({messages:await all("SELECT c.id,c.user_id,c.body,c.created_at,m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM chat_messages c JOIN members m ON m.id=c.user_id WHERE c.room=? AND c.status='visible' AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.target=c.user_id) ORDER BY c.created_at DESC LIMIT 100",room,user.id)});}
  if(path==='/mentions')return json({items:await all("SELECT c.id,c.room,c.body,c.created_at,m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM chat_messages c JOIN members m ON m.id=c.user_id WHERE c.status='visible' AND c.user_id<>? AND instr(lower(c.body),'@'||lower((SELECT name FROM members WHERE id=?)))>0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.target=c.user_id) ORDER BY c.created_at DESC LIMIT 50",user.id,user.id,user.id),comments:await all("SELECT c.id,c.video_id,c.channel_id,c.body,c.created_at,m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM contributions c JOIN members m ON m.id=c.user_id WHERE c.kind='comment' AND c.status='accepted' AND c.user_id<>? AND instr(lower(c.body),'@'||lower((SELECT name FROM members WHERE id=?)))>0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.target=c.user_id) ORDER BY c.created_at DESC LIMIT 50",user.id,user.id,user.id)});
  if(path==='/queue'){if(!user.moderator)fail('Moderator access required.',403);return json({reports:await all("SELECT a.*,m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points,COALESCE(c.body,t.body) content,COALESCE(c.user_id,t.user_id) author_id FROM abuse_reports a JOIN members m ON m.id=a.user_id LEFT JOIN contributions c ON a.kind='comment' AND c.id=a.target LEFT JOIN chat_messages t ON a.kind='chat' AND t.id=a.target WHERE a.status='pending' ORDER BY a.created_at LIMIT 100"),mutes:await all('SELECT u.*,m.name,m.profile_icon,m.profile_color,m.profile_picture,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM mutes u JOIN members m ON m.id=u.user_id WHERE u.until>?',now)});}
  fail('Not found.',404);
 }
 if(request.method!=='POST')fail('Method not allowed.',405);
 if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Use the Reaction Journey website.',403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('JSON required.',415);
 const raw=await request.text();if(raw.length>16000)fail('Request too large.',413);let b;try{b=JSON.parse(raw);}catch{fail('Invalid JSON.');}if(!b||typeof b!=='object')fail('Invalid request.');
 if(path==='/preferences'){await run('INSERT INTO preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at',user.id,JSON.stringify(settings(b,performerIds)),now);return json({ok:true});}
 if(path==='/view'){if(b.remove){await run('DELETE FROM saved_views WHERE id=? AND user_id=?',txt(b.id,1,100),user.id);return json({ok:true});}if((await first('SELECT COUNT(*) n FROM saved_views WHERE user_id=?',user.id)).n>=50)fail('You can save up to 50 views.');await run('INSERT INTO saved_views VALUES(?,?,?,?,?)',crypto.randomUUID(),user.id,txt(b.name,1,60),JSON.stringify(settings(b.settings,performerIds)),now);return json({ok:true});}
 if(path==='/reactor-rating'){
  if(!/^UC[\w-]{22}$/.test(b.channelId||'')||typeof b.remove!=='boolean')fail('Choose a valid reactor.');
  if(!await first('SELECT 1 FROM channels WHERE id=?',b.channelId))fail('Unknown reactor.',404);
  if(b.remove)await run('DELETE FROM reactor_ratings WHERE user_id=? AND channel_id=?',user.id,b.channelId);
  else{if(!Number.isInteger(b.score)||b.score<1||b.score>100)fail('Choose a whole-number rating from 1 to 100.');
   await run('INSERT INTO reactor_ratings(user_id,channel_id,score,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at',user.id,b.channelId,b.score,now);}
  return json({ok:true});
 }
 if(path==='/hide-reactor'){
  if(!/^UC[\w-]{22}$/.test(b.channelId||'')||typeof b.remove!=='boolean')fail('Choose a valid reactor and action.');
  if(!await first('SELECT 1 FROM channels WHERE id=?',b.channelId))fail('Unknown reactor.',404);
  await run(b.remove?'DELETE FROM hidden_reactors WHERE user_id=? AND channel_id=?':'INSERT OR IGNORE INTO hidden_reactors(user_id,channel_id,created_at) VALUES(?,?,?)',...(b.remove?[user.id,b.channelId]:[user.id,b.channelId,now]));
  return json({ok:true});
 }
 if(path==='/master-reset'){
  if(b.confirm!==true)fail('Confirm Master Reset.');
  await db.batch([
   db.prepare("DELETE FROM follows WHERE user_id=? AND kind IN ('reactor','song')").bind(user.id),
   db.prepare('DELETE FROM hidden_reactors WHERE user_id=?').bind(user.id),
   db.prepare('DELETE FROM reactor_ratings WHERE user_id=?').bind(user.id)
  ]);
  return json({ok:true});
 }
 if(path==='/reset-follows'){
  if(!['reactor','song'].includes(b.kind)||b.confirm!==true)fail('Confirm resetting reactor or song follows.');
  await run('DELETE FROM follows WHERE user_id=? AND kind=?',user.id,b.kind);
  return json({ok:true});
 }
 if(path==='/follow'){if(!['performer','reactor','song'].includes(b.kind))fail('Invalid follow type.');const target=txt(b.target,1,200);if(b.kind==='performer'&&!performerIds.includes(target))fail('Unknown performer.');if(b.kind==='reactor'&&!await first('SELECT 1 FROM channels WHERE id=?',target))fail('Unknown reactor.');await run(b.remove?'DELETE FROM follows WHERE user_id=? AND kind=? AND target=?':'INSERT OR IGNORE INTO follows VALUES(?,?,?)',user.id,b.kind,target);return json({ok:true});}
 if(path==='/watch'){if(!await first('SELECT 1 FROM videos WHERE id=?',b.videoId))fail('Unknown video.');if(!['unwatched','watching','watched'].includes(b.status)||typeof b.favorite!=='boolean')fail('Invalid watch status.');await run('INSERT INTO watch VALUES(?,?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET status=excluded.status,favorite=excluded.favorite',user.id,b.videoId,b.status,Number(b.favorite));return json({ok:true});}
 const me=await first('SELECT name FROM members WHERE id=?',user.id);if(!me)fail('Save your display name in My Profile first.',409);
 if(path==='/block'){if(b.target===user.id||!await first('SELECT 1 FROM members WHERE id=?',b.target))fail('Choose another member.');await run(b.remove?'DELETE FROM blocks WHERE user_id=? AND target=?':'INSERT OR IGNORE INTO blocks VALUES(?,?)',user.id,b.target);return json({ok:true});}
 if(path==='/presence'){if(!rooms.some(r=>r.id===b.room))fail('Unknown room.');await run('INSERT INTO room_members VALUES(?,?,?,?) ON CONFLICT(user_id,room) DO UPDATE SET last_read=excluded.last_read,seen_at=excluded.seen_at',user.id,b.room,now,now);return json({ok:true});}
 if(path==='/like'){if(!await first("SELECT 1 FROM contributions WHERE id=? AND kind='comment' AND status='accepted'",b.id))fail('Comment unavailable.');await run(b.remove?'DELETE FROM comment_likes WHERE user_id=? AND comment_id=?':'INSERT OR IGNORE INTO comment_likes VALUES(?,?)',user.id,b.id);return json({ok:true});}
 if(path==='/report'){if(!['comment','chat'].includes(b.kind))fail('Invalid report.');const exists=await first(b.kind==='comment'?"SELECT 1 FROM contributions WHERE id=? AND kind='comment' AND status='accepted'":"SELECT 1 FROM chat_messages WHERE id=? AND status='visible'",b.target);if(!exists)fail('Content unavailable.');if((await first('SELECT COUNT(*) n FROM abuse_reports WHERE user_id=? AND created_at>=?',user.id,now.slice(0,10))).n>=20)fail('Daily report limit reached.');await run('INSERT OR IGNORE INTO abuse_reports VALUES(?,?,?,?,?,\'pending\',?)',`${user.id}:${b.kind}:${b.target}`,user.id,b.kind,b.target,txt(b.body,5,500),now);return json({ok:true});}
 if(path==='/moderate'){if(!user.moderator)fail('Moderator access required.',403);const report=await first("SELECT * FROM abuse_reports WHERE id=? AND status='pending'",b.id);if(!report)fail('Report already resolved.');if(!['dismiss','hide','mute'].includes(b.action))fail('Invalid decision.');const item=await first(report.kind==='chat'?'SELECT user_id FROM chat_messages WHERE id=?':'SELECT user_id FROM contributions WHERE id=?',report.target);const stmts=[];
  if(b.action!=='dismiss'){stmts.push(db.prepare(report.kind==='chat'?"UPDATE chat_messages SET status='hidden' WHERE id=?":"UPDATE contributions SET status='hidden',review_note='Community abuse report upheld' WHERE id=?").bind(report.target));if(report.kind==='comment'){stmts.push(db.prepare("INSERT OR IGNORE INTO points SELECT ?,user_id,'reversal',-amount,? FROM points WHERE id=? AND amount>0").bind(`revoke:${report.target}`,now,report.target));}}
  if(b.action==='mute'&&item)stmts.push(db.prepare('INSERT INTO mutes VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET until=excluded.until,reason=excluded.reason').bind(item.user_id,new Date(Date.now()+86400000).toISOString(),'Community abuse report upheld'));
  stmts.push(db.prepare('UPDATE abuse_reports SET status=? WHERE id=?').bind(b.action,report.id));await db.batch(stmts);return json({ok:true});
 }
 if(path==='/mute'){if(!user.moderator)fail('Moderator access required.',403);if(b.id===user.id||!await first('SELECT 1 FROM members WHERE id=?',b.id))fail('Choose another member.');await run('INSERT INTO mutes VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET until=excluded.until,reason=excluded.reason',b.id,new Date(Date.now()+86400000).toISOString(),'Moderator action');return json({ok:true});}
 if(path==='/unmute'){if(!user.moderator)fail('Moderator access required.',403);await run('DELETE FROM mutes WHERE user_id=?',b.id);return json({ok:true});}
 if(path==='/delete'){if(!['chat','comment'].includes(b.kind))fail('Invalid content type.');const item=await first(b.kind==='chat'?'SELECT user_id FROM chat_messages WHERE id=?':"SELECT user_id FROM contributions WHERE id=? AND kind='comment'",b.id);if(!item||item.user_id!==user.id&&!user.moderator)fail('Not allowed.',403);const ops=[db.prepare(b.kind==='chat'?"UPDATE chat_messages SET status='deleted' WHERE id=?":"UPDATE contributions SET status='hidden' WHERE id=?").bind(b.id)];if(b.kind==='comment'){ops.push(db.prepare("INSERT OR IGNORE INTO points SELECT ?,user_id,'reversal',-amount,? FROM points WHERE id=? AND amount>0").bind(`revoke:${b.id}`,now,b.id));}await db.batch(ops);return json({ok:true});}
 if(await first('SELECT 1 FROM mutes WHERE user_id=? AND until>?',user.id,now))fail('Posting is temporarily muted. You can still browse.',403);
 if(path==='/chat'){if(!rooms.some(r=>r.id===b.room))fail('Unknown room.');const body=txt(b.body,1,2000);const result=await run("INSERT INTO chat_messages SELECT ?,?,?,?,'visible',? WHERE (SELECT COUNT(*) FROM chat_messages WHERE user_id=? AND created_at>?)<1 AND (SELECT COUNT(*) FROM chat_messages WHERE user_id=? AND created_at>=?)<200",crypto.randomUUID(),b.room,user.id,body,now,user.id,new Date(Date.now()-3000).toISOString(),user.id,now.slice(0,10));if(!result.meta.changes)fail('Please wait 3 seconds between messages. Daily limit: 200.',429);return json({ok:true});}
 if(path==='/comment'){const channel=b.channelId||null;if(channel){if(b.videoId||!/^UC[\w-]{22}$/.test(channel)||!await first('SELECT 1 FROM channels WHERE id=?',channel))fail('Choose a valid reactor.');b.videoId='';b.performerId='missioned-souls';}const direct=await canPublishDirectly(db,user.id),status=direct?'accepted':'pending';const body=txt(b.body,10,2000);if(!channel&&(!performerIds.includes(b.performerId)||!await first("SELECT 1 FROM matches WHERE video_id=? AND performer_id=? AND status='CONFIRMED'",b.videoId,b.performerId)))fail('Choose a confirmed video.');let parent=b.parentId||null;if(parent&&!await first("SELECT 1 FROM contributions WHERE id=? AND video_id=? AND channel_id IS ? AND kind='comment' AND status='accepted'",parent,b.videoId,channel))fail('Reply target unavailable.');
  const note=direct?'Published directly: Trusted Member; points awarded within daily limits.':null;
  if(b.id){
   const c=await first("SELECT * FROM contributions WHERE id=? AND user_id=? AND kind='comment' AND status IN ('pending','accepted')",b.id,user.id);
   if(!c)fail('Comment cannot be edited.',403);if(c.video_id!==b.videoId||(c.channel_id||null)!==channel)fail('Discussion mismatch.');
   const ops=[];
   // Trusted edits retain participation points but never earn a second award.
   if(!direct)ops.push(db.prepare("INSERT OR IGNORE INTO points SELECT ?,user_id,'reversal',-amount,? FROM points WHERE id=? AND amount>0").bind(`revoke:${b.id}`,now,b.id));
   ops.push(db.prepare("UPDATE contributions SET body=?,status=?,review_note=?,reviewed_at=NULL,reviewed_by=NULL WHERE id=?").bind(body,status,note,b.id));
   if(direct)ops.push(award(db,b.id,user.id,'comment',3,3,now,
     "EXISTS(SELECT 1 FROM contributions WHERE id=? AND status='accepted') AND NOT EXISTS(SELECT 1 FROM points WHERE id=?)",[b.id,`revoke:${b.id}`]));
   await db.batch(ops);return json({ok:true,status,message:direct?'Comment published directly. Each comment can earn points only once, within daily limits.':'Comment saved for review. Only you can see it until approved.'});
  }
  const id=crypto.randomUUID();
  const insert=db.prepare("INSERT INTO contributions(id,user_id,kind,performer_id,video_id,body,parent_id,status,created_at,review_note,channel_id) SELECT ?,?,'comment',?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM contributions WHERE user_id=? AND created_at>=?)<20 AND NOT EXISTS(SELECT 1 FROM contributions WHERE user_id=? AND video_id=? AND channel_id IS ? AND body=? AND status IN ('pending','accepted'))").bind(id,user.id,b.performerId,b.videoId,body,parent,status,now,note,channel,user.id,now.slice(0,10),user.id,b.videoId,channel,body);
  const ops=[insert];
  if(direct)ops.push(award(db,id,user.id,'comment',3,3,now,"EXISTS(SELECT 1 FROM contributions WHERE id=? AND status='accepted' AND created_at=?)",[id,now]));
  const result=await db.batch(ops);if(!result[0].meta.changes)fail('Duplicate comment or daily limit reached.',409);
  return json({ok:true,status,message:direct?'Comment published directly. Points awarded within daily limits.':'Comment saved for review. Only you can see it until approved.'});}

 fail('Not found.',404);
 }catch(e){if(!e.status)console.error('Social service failure',e.message);return json({error:e.status?e.message:'Could not save or load this information. Please retry.'},e.status||503);}}
