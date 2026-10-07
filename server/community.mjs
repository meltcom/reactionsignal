import { database, seedDatabase } from './db.mjs';
import {YouTube,seconds} from './discovery.mjs';
export async function submissionMetadata(db,env,videoId,fetcher=fetch){
 const key='submission-metadata:'+videoId,cached=await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first();
 if(cached){try{const c=JSON.parse(cached.value);if(Date.now()-c.fetchedAt<600000)return c;}catch{}}
 if(!env.YOUTUBE_API_KEY)fail('YouTube metadata lookup is not configured. Enter verified details manually.',503);
 const data=await new YouTube(env.YOUTUBE_API_KEY,fetcher,db).get('videos',{part:'snippet,contentDetails,status',id:videoId});
 const v=data.items?.find(v=>v.id===videoId);if(!v?.snippet||v.status?.privacyStatus!=='public')fail('This video is not publicly available on YouTube.',409);
 const duration=seconds(v.contentDetails?.duration),m={title:v.snippet.title,channelName:v.snippet.channelTitle,channelId:v.snippet.channelId,publishedAt:v.snippet.publishedAt,duration,format:duration!==null&&duration>180?'FULL_LENGTH':'UNKNOWN',fetchedAt:Date.now()};
 if(!/^UC[\w-]{22}$/.test(m.channelId||'')||!m.title||!m.publishedAt)fail('YouTube returned incomplete video details.',502);
 await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(m)).run();return m;
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=(value,min,max,label)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(`${label} must contain ${min}–${max} characters.`);return value.trim();};
export function youtubeId(input){
  try {const u=new URL(input);if(u.protocol!=='https:'||u.port||u.username||u.password)return null;
    const host=u.hostname.toLowerCase();let id;
    if(host==='youtu.be')id=u.pathname.slice(1);
    else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host))id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/)?.[1];
    return /^[\w-]{11}$/.test(id||'')?id:null;
  }catch{return null;}
}
export const tier=points=>points>=1000?'Community champion':points>=250?'Catalog curator':points>=100?'Reaction scout':points>=25?'Contributor':'Novice';
function award(db,id,user,kind,amount,cap,now,guard='1',args=[]){
  return db.prepare(`INSERT OR IGNORE INTO points(id,user_id,kind,amount,created_at)
    SELECT ?,?,?,?,? WHERE (${guard}) AND (SELECT COUNT(*) FROM points WHERE user_id=? AND kind=? AND amount>0 AND created_at>=?)<?`)
    .bind(id,user,kind,amount,now,...args,user,kind,now.slice(0,10),cap);
}
const pending='EXISTS(SELECT 1 FROM contributions WHERE id=? AND status=\'pending\')';
async function videoDecision(db,id){
 const row=await db.prepare("SELECT m.status,m.source,p.status performerStatus,e.reason exclusionReason FROM matches m JOIN performers p ON p.id=m.performer_id LEFT JOIN exclusions e ON e.performer_id=m.performer_id AND e.video_id=m.video_id WHERE m.performer_id='missioned-souls' AND m.video_id=?").bind(id).first();
 return row||{status:null,exclusionReason:null};
}
async function known(db,performer,video){if(!await db.prepare("SELECT 1 FROM matches m JOIN videos v ON v.id=m.video_id WHERE m.performer_id=? AND m.video_id=? AND m.status='CONFIRMED' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)").bind(performer,video).first())fail('This video is not currently in the confirmed catalog.',404);}
export async function community(request,env,seed,user){
  try {
    if(!user)return json({error:'Sign in to participate.'},401);
    if(new URL(request.url).pathname.startsWith('/api/community/users')&&!user.moderator)return json({error:'Moderator access required.'},403);
    if(new URL(request.url).pathname==='/api/community/contact/inbox'&&!user.moderator)return json({error:'Moderator access required.'},403);
    if(new URL(request.url).pathname.startsWith('/api/community/activity')&&!user.moderator)return json({error:'Moderator access required.'},403);
    const db=database(env);await seedDatabase(db,seed);
    const u=new URL(request.url),path=u.pathname.replace('/api/community','');
    if(!user)return json({error:'Sign in to participate.'},401);
    if(path==='/coverage'||path==='/coverage/queue'){if(request.method==='GET')return json({items:[]});fail('Reaction Journey covers Missioned Souls only.',400);}
    if(path==='/coverage/review')fail('Performer recommendations are closed.',400);
    if(path==='/summary'&&request.method==='GET')await db.prepare("INSERT INTO members(id,name,created_at,email,last_seen_at) VALUES(?,'',?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,last_seen_at=excluded.last_seen_at WHERE members.last_seen_at IS NULL OR members.last_seen_at<? OR members.email IS NOT excluded.email").bind(user.id,new Date().toISOString(),user.email||null,new Date().toISOString(),new Date(Date.now()-3600000).toISOString()).run();
    const me=await db.prepare('SELECT name FROM members WHERE id=?').bind(user.id).first();
    if(request.method==='GET'){
      if(path==='/coverage'){
        const rows=await db.prepare('SELECT id,name,url,body,status,created_at,review_note FROM coverage_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
        return json({items:rows.results});
      }
      if(path==='/coverage/queue'){
        if(!user.moderator)fail('Moderator access required.',403);
        const rows=await db.prepare("SELECT c.*,m.name member_name,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM coverage_requests c JOIN members m ON m.id=c.user_id ORDER BY CASE WHEN c.status='pending' THEN 0 ELSE 1 END,c.created_at DESC LIMIT 100").all();
        return json({items:rows.results});
      }
    if(path==='/reactor-requests'){
        const rows=await db.prepare('SELECT id,kind,channel_id,channel_name,body,status,created_at,review_note FROM reactor_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();return json({items:rows.results});
      }
      if(path==='/catalog-video'||path==='/catalog-video/metadata'){
        if(!user.moderator)fail('Moderator access required.',403);
        const input=u.searchParams.get('video')||'',id=/^[\w-]{11}$/.test(input)?input:youtubeId(input);
        if(!id)fail('Paste a YouTube video URL or video ID.');
        const video=await db.prepare('SELECT v.*,c.name channelName FROM videos v LEFT JOIN channels c ON c.id=v.channel_id WHERE v.id=?').bind(id).first();
        if(!video)fail('Video not found in the catalog.',404);
        if(path.endsWith('/metadata'))return json(await submissionMetadata(db,env,id));
        const history=await db.prepare('SELECT moderator_id,note,before_json,after_json,created_at FROM video_corrections WHERE video_id=? ORDER BY created_at DESC LIMIT 10').bind(id).all();
        const decision=await videoDecision(db,id);
        return json({video,decision,history:history.results});
      }
      if(path==='/submission/metadata'){
        if(!user.moderator)fail('Moderator access required.',403);
        const c=await db.prepare("SELECT video_id FROM contributions WHERE id=? AND kind='submission' AND status='pending'").bind(u.searchParams.get('id')).first();if(!c)fail('Submission not available.',404);
        return json(await submissionMetadata(db,env,c.video_id));
      }
      if(path==='/activity/presence'){
        const rows=await db.prepare('SELECT id,name,active_at,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=members.id),0) points FROM members WHERE active_at IS NOT NULL ORDER BY active_at DESC,id LIMIT 100').all();
        return json({items:rows.results.map(m=>({...m,activeRecently:Date.now()-Date.parse(m.active_at)<300000})),windowMinutes:5});
      }
      if(path==='/activity'){
        const offset=Math.max(0,Math.min(100000,Number(u.searchParams.get('offset'))||0)),q=(u.searchParams.get('q')||'').slice(0,100),member=(u.searchParams.get('user')||'').slice(0,100),kind=u.searchParams.get('kind')||'all';
        if(!['all','rating','contribution','chat','follow','watch','contact','preferences','profile','video-click'].includes(kind))fail('Invalid activity filter.');
        const cutoff=new Date(Date.now()-30*86400000).toISOString();
        const rows=await db.prepare("SELECT a.*,m.name,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM user_activity a LEFT JOIN members m ON m.id=a.user_id WHERE a.created_at>=? "+(member?"AND a.user_id=? ":"")+(kind!=='all'?"AND a.kind=? ":"")+"AND instr(lower(COALESCE(m.name,'')||' '||a.user_id),lower(?))>0 ORDER BY a.created_at DESC,a.id DESC LIMIT 101 OFFSET ?").bind(cutoff,...(member?[member]:[]),...(kind!=='all'?[kind]:[]),q,offset).all();
        return json({items:rows.results.slice(0,100),hasMore:rows.results.length>100,windowDays:30});
      }
      if(path==='/contact'||path==='/contact/inbox'){
        const offset=Math.max(0,Math.min(100000,Number(u.searchParams.get('offset'))||0));
        const rows=await db.prepare("SELECT t.id,t.subject,t.category,t.status,t.created_at,t.updated_at,m.name,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM contact_tickets t LEFT JOIN members m ON m.id=t.user_id "+(path==='/contact'?"WHERE t.user_id=? ":"")+"ORDER BY t.updated_at DESC,t.id LIMIT 51 OFFSET ?").bind(...(path==='/contact'?[user.id,offset]:[offset])).all();
        return json({items:rows.results.slice(0,50),hasMore:rows.results.length>50});
      }
      if(path==='/contact/thread'){
        const ticket=await db.prepare('SELECT * FROM contact_tickets WHERE id=?').bind(u.searchParams.get('id')).first();
        if(!ticket||!user.moderator&&ticket.user_id!==user.id)fail('Request not found.',404);
        const messages=await db.prepare('SELECT body,moderator,created_at FROM contact_messages WHERE ticket_id=? ORDER BY created_at,id').bind(ticket.id).all();
        return json({ticket,messages:messages.results});
      }
      if(path==='/users'){
        const offset=Math.max(0,Math.min(100000,Number(u.searchParams.get('offset'))||0)),q=(u.searchParams.get('q')||'').slice(0,100);
        const rows=await db.prepare("SELECT m.id,m.name,m.email,m.created_at,m.last_seen_at,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points,(SELECT until FROM mutes WHERE user_id=m.id) muted_until FROM members m WHERE instr(lower(m.name||' '||COALESCE(m.email,'')),lower(?))>0 ORDER BY m.created_at DESC,m.id LIMIT 101 OFFSET ?").bind(q,offset).all();
        const moderators=String(env.COMMUNITY_MODERATOR_EMAILS||'').toLowerCase().split(',').map(x=>x.trim());
        return json({items:rows.results.slice(0,100).map(m=>({...m,tier:tier(m.points),moderator:moderators.includes(m.email?.toLowerCase())})),hasMore:rows.results.length>100,offset});
      }
      if(path==='/summary'){
        const totals=await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM points WHERE user_id=?').bind(user.id).first();
        const scores=await db.prepare('SELECT video_id,COUNT(*) count,AVG(score) average,(SUM(score)+15.0)/(COUNT(*)+5) ranking FROM ratings GROUP BY video_id').all();
        const leaders=await db.prepare('SELECT m.name,SUM(p.amount) points FROM points p JOIN members m ON m.id=p.user_id GROUP BY p.user_id HAVING SUM(p.amount)>0 ORDER BY points DESC,m.created_at ASC LIMIT 10').all();
        const mine=await db.prepare('SELECT id,kind,video_id,performer_id,body,status,review_note,created_at FROM contributions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
        const ledger=await db.prepare('SELECT kind,amount,created_at FROM points WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(user.id).all();
        return json({name:me?.name||'',moderator:user.moderator,points:totals.total,tier:tier(totals.total),scores:scores.results,leaders:leaders.results,mine:mine.results,ledger:ledger.results});
      }
      if(path==='/video'){
        const video=u.searchParams.get('id');if(!/^[\w-]{11}$/.test(video||''))fail('Invalid video ID.');
        const rating=await db.prepare('SELECT score FROM ratings WHERE user_id=? AND video_id=?').bind(user.id,video).first();
        const comments=await db.prepare("SELECT c.id,c.body,c.created_at,m.name,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM contributions c JOIN members m ON m.id=c.user_id WHERE c.kind='comment' AND c.video_id=? AND c.status='accepted' ORDER BY c.created_at DESC LIMIT 100").bind(video).all();
        return json({rating:rating?.score||0,comments:comments.results});
      }
      if(path==='/submission-history'){
        if(!user.moderator)fail('Moderator access required.',403);
        const status=u.searchParams.get('status')||'all',q=(u.searchParams.get('q')||'').trim().slice(0,250),offset=Math.max(0,Math.min(100000,Number(u.searchParams.get('offset'))||0));
        if(!['all','accepted','rejected'].includes(status))fail('Invalid submission status.');
        const id=youtubeId(q)||q;
        const rows=await db.prepare("SELECT c.*,m.name,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=c.user_id),0) points FROM contributions c LEFT JOIN members m ON m.id=c.user_id WHERE c.kind='submission' AND c.status IN ('accepted','rejected') "+(status!=='all'?"AND c.status=? ":"")+"AND instr(lower(c.video_id||' '||c.body||' '||COALESCE(c.review_note,'')),lower(?))>0 ORDER BY c.reviewed_at DESC,c.id LIMIT 51 OFFSET ?").bind(...(status!=='all'?[status]:[]),id,offset).all();
        return json({items:rows.results.slice(0,50),hasMore:rows.results.length>50});
      }
      if(path==='/queue'){
        if(!user.moderator)fail('Moderator access required.',403);
        const kind=u.searchParams.get('kind')||'all',offset=Math.max(0,Math.min(100000,Number(u.searchParams.get('offset'))||0));
        if(!['all','submission','comment','flag'].includes(kind))fail('Invalid review category.');
        const rows=await db.prepare("SELECT c.*,m.name,COALESCE((SELECT SUM(amount) FROM points WHERE user_id=m.id),0) points FROM contributions c JOIN members m ON m.id=c.user_id WHERE (c.status='pending' OR (c.kind='comment' AND c.status='accepted')) "+(kind!=='all'?"AND c.kind=? ":"")+"ORDER BY CASE WHEN c.status='pending' THEN 0 ELSE 1 END,c.created_at ASC,c.id LIMIT 51 OFFSET ?").bind(...(kind!=='all'?[kind,offset]:[offset])).all();return json({items:rows.results.slice(0,50),hasMore:rows.results.length>50});
      }
      return json({error:'Not found'},404);
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('Origin')!==u.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Please submit from the Reaction Journey website.',403);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('JSON required.',415);
    const raw=await request.text();if(raw.length>10000)fail('Submission too large.',413);
    let b;try{b=JSON.parse(raw);}catch{fail('Invalid submission.');}if(!b||typeof b!=='object')fail('Invalid submission.');
    const now=new Date().toISOString();
    if(path==='/submission/reopen'){
      if(!user.moderator)fail('Moderator access required.',403);
      const id=text(b.id,1,200,'Submission ID'),note=text(b.note,5,500,'Reason for reopening');
      const before=await db.prepare("SELECT * FROM contributions WHERE id=? AND kind='submission' AND status='rejected'").bind(id).first();
      if(!before)fail('Only rejected submissions can be reopened. Refresh the history.',409);
      const guard="EXISTS(SELECT 1 FROM contributions WHERE id=? AND kind='submission' AND status='rejected')";
      const result=await db.batch([
        db.prepare(`INSERT INTO state(key,value) SELECT ?,? WHERE ${guard}`).bind('submission-reopen:'+crypto.randomUUID(),JSON.stringify({actor:user.id,action:'reopen-submission',note,before,at:now}),id),
        db.prepare("UPDATE contributions SET status='pending',reviewed_at=NULL,reviewed_by=NULL,review_note=NULL WHERE id=? AND kind='submission' AND status='rejected'").bind(id)
      ]);
      if(!result[1].meta?.changes)fail('This submission has already changed. Refresh the history.',409);
      return json({ok:true,message:'Submission reopened for review. It is awaiting approval in Submitted reactions; catalog decisions and exclusions are unchanged.'});
    }
      if(path==='/catalog-video/update'){
      if(!user.moderator)fail('Moderator access required.',403);
      if(!/^[\w-]{11}$/.test(b.videoId||''))fail('Invalid video ID.');
      const before=await db.prepare('SELECT v.*,c.name channelName FROM videos v LEFT JOIN channels c ON c.id=v.channel_id WHERE v.id=?').bind(b.videoId).first();
      if(!before)fail('Video not found in the catalog.',404);
      if(b.restore!==undefined&&typeof b.restore!=='boolean')fail('Invalid restore action.');
      const decision=await videoDecision(db,b.videoId),restore=b.restore===true;
      if(restore&&!decision.status)fail('This video has no Missioned Souls match to restore.',409);
      if(restore&&before.available!==1)fail('This video is marked unavailable. Verify availability before restoring it.',409);
      if(restore&&decision.performerStatus!=='active')fail('Missioned Souls coverage must be active before restoring this video.',409);
      const note=text(b.note,5,500,'Correction reason');
      const metadata=env.YOUTUBE_API_KEY?await submissionMetadata(db,env,b.videoId):null;
      const title=text(metadata?.title||b.title,3,250,'Verified video title'),channelName=text(metadata?.channelName||b.channelName,2,100,'Verified channel name'),channelId=metadata?.channelId||b.channelId;
      if(!/^UC[\w-]{22}$/.test(channelId||''))fail('Enter the verified YouTube channel ID.');
      const date=metadata?.publishedAt||b.publishedAt||null;
      if(date&&(Number.isNaN(Date.parse(date))||Date.parse(date)>Date.now()))fail('Enter a valid past upload date, or leave blank.');
      if(!['FULL_LENGTH','SHORT','UNKNOWN'].includes(b.format))fail('Choose a valid format.');
      const existingChannel=await db.prepare('SELECT name FROM channels WHERE id=?').bind(channelId).first();
      // A manual fallback may reassign this video, but must not rename a shared channel.
      if(!metadata&&existingChannel&&existingChannel.name!==channelName)fail('Channel name differs from the existing catalog channel. Use its current name or fetch YouTube details.',409);
      const after={title,channel_id:channelId,channelName,published_at:date,format:b.format,action:restore?'restore-and-confirm':'correct-details',decision:restore?{...decision,status:'CONFIRMED',source:'Moderator restored after video correction',exclusionReason:null}:decision};
      await db.batch([
        db.prepare('INSERT INTO channels(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(channelId,channelName),
        db.prepare('UPDATE videos SET channel_id=?,title=?,published_at=?,format=?,format_locked=1 WHERE id=?').bind(channelId,title,date,b.format,b.videoId),
        ...(restore?[
          db.prepare("DELETE FROM exclusions WHERE performer_id='missioned-souls' AND video_id=?").bind(b.videoId),
          db.prepare("UPDATE matches SET status='CONFIRMED',source='Moderator restored after video correction' WHERE performer_id='missioned-souls' AND video_id=?").bind(b.videoId)
        ]:[]),
        db.prepare('INSERT INTO video_corrections(id,video_id,moderator_id,note,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),b.videoId,user.id,note,JSON.stringify({...before,decision}),JSON.stringify(after),now)
      ]);
      const current=await videoDecision(db,b.videoId),eligible=before.available===1&&current.performerStatus==='active'&&['CONFIRMED','PROBABLE'].includes(current.status)&&!current.exclusionReason;
      return json({ok:true,eligible,decision:current,message:restore?'Corrections saved and video restored as Confirmed. Eligible for the catalog; member feed filters still apply.':'Video details corrected. '+(eligible?'Eligible for the catalog; member feed filters still apply.':'Still hidden by its catalog status, exclusion, availability, or performer coverage. Use Save Corrections & Restore to reverse a rejection or exclusion.')});
    }
    if(path==='/reactor-requests'){
      if(!['add','remove'].includes(b.kind))fail('Choose Add or Remove.');
      const raw=text(b.channelId,24,200,'Channel ID or URL');let id=raw;
      if(raw.startsWith('https://')){let link;try{link=new URL(raw);}catch{fail('Invalid channel URL.');}if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(link.hostname)||link.username||link.password||link.port)fail('Use a direct YouTube channel URL.');id=link.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/)?.[1];}
      if(!/^UC[\w-]{22}$/.test(id||''))fail('Use a UC channel ID or a direct youtube.com/channel/UC… URL.');
      const existing=await db.prepare('SELECT name,discovery_scope FROM channels WHERE id=?').bind(id).first();
      if(b.kind==='remove'&&!existing)fail('Choose a listed reactor.',404);
      if(b.kind==='add'&&existing?.discovery_scope==='eligible')fail('This reactor is already active. Search its name or unhide it.',409);
      const name=b.kind==='remove'?existing.name:text(b.name,2,100,'Channel name'),body=text(b.body,10,1000,'Explanation');
      if(await db.prepare("SELECT 1 FROM reactor_requests WHERE user_id=? AND kind=? AND channel_id=? AND status='pending'").bind(user.id,b.kind,id).first())fail('Your request for this channel is already awaiting review.',409);
      const r=await db.prepare("INSERT INTO reactor_requests(id,user_id,kind,channel_id,channel_name,body,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM reactor_requests WHERE user_id=? AND created_at>=?)<5").bind(crypto.randomUUID(),user.id,b.kind,id,name,body,now,user.id,now.slice(0,10)).run();
      if(!r.meta?.changes)fail('You can send up to five reactor requests per day.',429);
      return json({ok:true,message:'Request sent to moderators. No channel changes until review.'});
    }
    if(path==='/presence'){
      await db.prepare("INSERT INTO members(id,name,created_at,email,active_at) VALUES(?,'',?,?,?) ON CONFLICT(id) DO UPDATE SET active_at=excluded.active_at WHERE members.active_at IS NULL OR members.active_at<?").bind(user.id,now,user.email||null,now,new Date(Date.now()-90000).toISOString()).run();
      return json({ok:true});
    }
    if(path==='/video-click'){
      const id=text(b.videoId,11,11,'Video');if(!/^[\w-]{11}$/.test(id)||!['details','preview','youtube'].includes(b.action))fail('Invalid video click.');
      const video=await db.prepare("SELECT v.title FROM videos v WHERE v.id=? AND EXISTS(SELECT 1 FROM matches m WHERE m.video_id=v.id AND m.performer_id='missioned-souls')").bind(id).first();if(!video)fail('Video not found.',404);
      const summary={details:'Opened video details',preview:'Clicked video preview',youtube:'Clicked Watch on YouTube'}[b.action]+': '+video.title;
      await db.prepare("INSERT INTO user_activity(user_id,kind,target,summary,created_at) SELECT ?,'video-click',?,?,? WHERE NOT EXISTS(SELECT 1 FROM user_activity WHERE user_id=? AND kind='video-click' AND target=? AND summary=? AND created_at>=?)").bind(user.id,id,summary,now,user.id,id,summary,new Date(Date.now()-60000).toISOString()).run();
      return json({ok:true});
    }
    if(path==='/contact'){
      const subject=text(b.subject,3,120,'Subject'),body=text(b.body,10,4000,'Message');
      if(!['question','bug','account','other'].includes(b.category))fail('Choose a category.');
      const id=crypto.randomUUID();
      // The member row is needed for the ticket foreign key, even before a profile is saved.
      await db.prepare("INSERT OR IGNORE INTO members(id,name,created_at,email,last_seen_at) VALUES(?,'',?,?,?)").bind(user.id,now,user.email||null,now).run();
      const r=await db.batch([
       db.prepare("INSERT INTO contact_tickets(id,user_id,subject,category,status,created_at,updated_at) SELECT ?,?,?,?,'open',?,? WHERE (SELECT COUNT(*) FROM contact_tickets WHERE user_id=? AND created_at>=?)<5").bind(id,user.id,subject,b.category,now,now,user.id,now.slice(0,10)),
       db.prepare('INSERT INTO contact_messages(id,ticket_id,user_id,moderator,body,created_at) SELECT ?,?,?,0,?,? WHERE EXISTS(SELECT 1 FROM contact_tickets WHERE id=?)').bind(crypto.randomUUID(),id,user.id,body,now,id)
      ]);
      if(!r[0].meta?.changes)fail('You can submit up to five new requests per day.',429);
      return json({ok:true,id,message:'Request sent. Check Contact for replies.'});
    }
    if(path==='/contact/reply'||path==='/contact/status'){
      if(path==='/contact/status'&&!user.moderator)fail('Moderator access required.',403);
      const id=text(b.id,1,100,'Request ID'),t=await db.prepare('SELECT * FROM contact_tickets WHERE id=?').bind(id).first();
      if(!t||!user.moderator&&t.user_id!==user.id)fail('Request not found.',404);
      if(path==='/contact/status'){
       if(!['open','closed'].includes(b.status))fail('Choose Open or Closed.');
       await db.batch([db.prepare('UPDATE contact_tickets SET status=?,updated_at=? WHERE id=?').bind(b.status,now,id),db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('contact-audit:'+crypto.randomUUID(),JSON.stringify({actor:user.id,ticket:id,status:b.status,at:now}))]);
      }else{
       const body=text(b.body,2,4000,'Reply');
       const r=await db.batch([
        db.prepare('INSERT INTO contact_messages(id,ticket_id,user_id,moderator,body,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM contact_messages WHERE user_id=? AND created_at>=?)<50').bind(crypto.randomUUID(),id,user.id,Number(user.moderator),body,now,user.id,now.slice(0,10)),
        db.prepare("UPDATE contact_tickets SET status='open',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM contact_messages WHERE ticket_id=? AND user_id=? AND created_at=?)").bind(now,id,id,user.id,now)
       ]);if(!r[0].meta?.changes)fail('Daily reply limit reached.',429);
      }return json({ok:true,message:'Request updated.'});
    }
    if(path==='/users/update'){
      const id=text(b.id,1,100,'Member ID'),note=text(b.note,5,500,'Reason');
      if(!await db.prepare('SELECT 1 FROM members WHERE id=?').bind(id).first())fail('Member not found.',404);
      const ops=[];
      if(b.action==='name')ops.push(db.prepare('UPDATE members SET name=? WHERE id=?').bind(text(b.name,2,40,'Display name'),id));
      else if(b.action==='points'){
        if(!Number.isInteger(b.amount)||b.amount===0||Math.abs(b.amount)>1000)fail('Choose a nonzero adjustment from -1000 to 1000.');
        ops.push(db.prepare('INSERT INTO points(id,user_id,kind,amount,created_at) VALUES(?,?,?,?,?)').bind('moderator-adjustment:'+crypto.randomUUID(),id,'Moderator adjustment: '+note,b.amount,now));
      }else if(b.action==='mute'){
        if(id===user.id)fail('Choose another member.');
        ops.push(db.prepare('INSERT INTO mutes(user_id,until,reason) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET until=excluded.until,reason=excluded.reason').bind(id,new Date(Date.now()+86400000).toISOString(),note));
      }else if(b.action==='unmute')ops.push(db.prepare('DELETE FROM mutes WHERE user_id=?').bind(id));
      else fail('Choose a valid member action.');
      ops.push(db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('member-audit:'+crypto.randomUUID(),JSON.stringify({actor:user.id,member:id,action:b.action,amount:b.amount,name:b.name,note,at:now})));
      await db.batch(ops);return json({ok:true,message:'Member updated. Badge follows the current point total.'});
    }
    if(path==='/profile'){
      const name=text(b.name,2,40,'Display name');
      await db.prepare('INSERT INTO members(id,name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(user.id,name,now).run();return json({ok:true});
    }
    if(!me?.name)fail('Save a community display name first.',409);
    if(path==='/coverage'){
      if(await db.prepare('SELECT 1 FROM mutes WHERE user_id=? AND until>?').bind(user.id,now).first())fail('Posting is temporarily muted.',403);
      const name=text(b.name,2,100,'Band or performer name');
      const nameKey=name.normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
      if((await db.prepare('SELECT name FROM performers').all()).results.some(p=>p.name.normalize('NFKC').toLowerCase().replace(/\s+/g,' ')===nameKey))fail('This performer is already covered. You can suggest a missing reaction video instead.',409);
      const body=text(b.body,10,1000,'Recommendation');
      const link=text(b.url,10,500,'Official link');let url;
      try{url=new URL(link);if(url.protocol!=='https:'||url.username||url.password)throw new Error();}catch{fail('Enter an HTTPS link to the official channel or website.');}
      if(await db.prepare('SELECT 1 FROM coverage_requests WHERE user_id=? AND name_key=?').bind(user.id,nameKey).first())fail('You have already recommended this performer. Check your suggestions below.',409);
      const result=await db.prepare(`INSERT INTO coverage_requests(id,user_id,name,name_key,url,body,created_at)
        SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM coverage_requests WHERE user_id=? AND name_key=?)
        AND (SELECT COUNT(*) FROM coverage_requests WHERE user_id=? AND created_at>=?)<5`)
        .bind(crypto.randomUUID(),user.id,name,nameKey,url.href,body,now,user.id,nameKey,user.id,now.slice(0,10)).run();
      if(!result.meta?.changes)fail('Suggestion not saved. You may have already sent it or reached the daily limit of five.',429);
      return json({ok:true,message:'Recommendation sent to moderators. You can follow its review status below.'});
    }
    if(path==='/coverage/review'){
      if(!user.moderator)fail('Moderator access required.',403);
      if(!['shortlisted','declined'].includes(b.decision))fail('Choose shortlist or decline.');
      const id=text(b.id,1,100,'Recommendation ID');
      const note=text(b.note,5,500,'Review note');
      const result=await db.prepare("UPDATE coverage_requests SET status=?,review_note=?,reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'").bind(b.decision,note,now,user.id,id).run();
      if(!result.meta?.changes)fail('This recommendation has already been reviewed or is unavailable.',409);
      return json({ok:true,message:'Coverage review saved. Shortlisting does not activate discovery for this performer.'});
    }
    if(path==='/rating'){
      const video=b.videoId,performer=b.performerId;if(!/^[\w-]{11}$/.test(video||'')||!await db.prepare("SELECT 1 FROM performers WHERE id=? AND status='active'").bind(performer).first())fail('Choose a catalog video and performer.');if(!Number.isInteger(b.score)||b.score<1||b.score>5)fail('Choose a rating from 1 to 5.');
      await known(db,performer,video);
      await db.batch([
        award(db,`rating:${user.id}:${video}`,user.id,'rating',1,10,now,'NOT EXISTS(SELECT 1 FROM ratings WHERE user_id=? AND video_id=?)',[user.id,video]),
        db.prepare('INSERT INTO ratings(user_id,video_id,score,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET score=excluded.score').bind(user.id,video,b.score,now)
      ]);return json({ok:true,message:'Rating saved. Editing a rating does not earn more points.'});
    }
    if(path==='/contribute'){
      if(await db.prepare('SELECT 1 FROM mutes WHERE user_id=? AND until>?').bind(user.id,now).first())fail('Posting is temporarily muted.',403);
      if(!['comment','submission','flag'].includes(b.kind))fail('Invalid contribution type.');
      if(!await db.prepare("SELECT 1 FROM performers WHERE id=? AND status='active'").bind(b.performerId).first())fail('Choose a catalog performer.');
      const video=b.kind==='submission'?youtubeId(b.url):b.videoId;
      if(!/^[\w-]{11}$/.test(video||''))fail('Enter a valid HTTPS YouTube video link.');
      const body=text(b.body,10,b.kind==='comment'?2000:1000,b.kind==='comment'?'Comment':'Explanation');
      const reason=b.kind==='flag'?b.reason:null;
      if(b.kind==='flag'&&!['wrong-performer','not-reaction','short-excerpt','unavailable','duplicate','other'].includes(reason))fail('Choose a reason.');
      if(b.kind==='submission'){
        if(await db.prepare('SELECT 1 FROM matches WHERE performer_id=? AND video_id=? UNION ALL SELECT 1 FROM exclusions WHERE performer_id=? AND video_id=?').bind(b.performerId,video,b.performerId,video).first())fail('This video is already cataloged, pending review, or excluded for this performer.',409);
      }else await known(db,b.performerId,video);
      const id=b.kind==='submission'?`submission:${b.performerId}:${video}`:b.kind==='comment'?`comment:${user.id}:${video}`:`flag:${user.id}:${b.performerId}:${video}`;
      const result=await db.prepare(`INSERT OR IGNORE INTO contributions(id,user_id,kind,performer_id,video_id,body,reason,status,created_at)
        SELECT ?,?,?,?,?,?,?,'pending',? WHERE (SELECT COUNT(*) FROM contributions WHERE user_id=? AND created_at>=?)<20`).bind(id,user.id,b.kind,b.performerId,video,body,reason,now,user.id,now.slice(0,10)).run();
      if(!result.meta.changes)fail('Already submitted, or your daily limit of 20 contributions has been reached.',409);
      return json({ok:true,message:b.kind==='flag'?'Removal request sent to moderators. The video remains listed while they review it.':'Saved for review. Points are awarded only after approval, within daily limits.'});
    }
    if(path==='/moderate'){
      if(!user.moderator)fail('Moderator access required.',403);
      const c=await db.prepare('SELECT * FROM contributions WHERE id=?').bind(b.id).first();if(!c)fail('Contribution not found.',404);
      const note=text(b.note,5,500,'Review note');
      if(b.decision==='hide'&&c.kind==='comment'&&c.status==='accepted'){
        await db.batch([
          db.prepare("INSERT OR IGNORE INTO points(id,user_id,kind,amount,created_at) SELECT ?,user_id,'reversal',-amount,? FROM points WHERE id=? AND amount>0").bind(`revoke:${c.id}`,now,c.id),
          db.prepare("INSERT OR IGNORE INTO reputation_events SELECT ?,user_id,-amount,'Comment removed',? FROM reputation_events WHERE id=? AND amount>0").bind(`revoke:${c.id}`,now,c.id),
          db.prepare("UPDATE contributions SET status='hidden',review_note=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='accepted'").bind(note,user.id,now,c.id)
        ]);return json({ok:true,message:'Comment hidden; any associated points reversed.'});
      }
      if(c.status!=='pending')fail('This item has already been reviewed.',409);
      if(!['accept','reject'].includes(b.decision))fail('Invalid review decision.');
      const statements=[];
      if(b.decision==='accept'){
        // Moderator self-reviews can change the catalog but never earn approval points.
        if(c.kind==='submission'){
          if(await db.prepare('SELECT 1 FROM exclusions WHERE performer_id=? AND video_id=?').bind(c.performer_id,c.video_id).first())fail('This video is excluded. Resolve the existing catalog decision first.',409);
          const metadata=env.YOUTUBE_API_KEY?await submissionMetadata(db,env,c.video_id):null;
          const title=text(metadata?.title||b.title,3,250,'Verified video title'),channelName=text(metadata?.channelName||b.channelName,2,100,'Verified channel name'),channelId=metadata?.channelId||b.channelId;
          if(!/^UC[\w-]{22}$/.test(channelId||''))fail('Enter the verified YouTube channel ID.');
          const date=metadata?.publishedAt||b.publishedAt||null;
          if(date&&(Number.isNaN(Date.parse(date))||Date.parse(date)>Date.now()))fail('Enter a valid past upload date, or leave blank.');
          const format=b.format||metadata?.format||'UNKNOWN';if(!['FULL_LENGTH','SHORT','UNKNOWN'].includes(format))fail('Choose a valid format.');
          statements.push(db.prepare(`INSERT OR IGNORE INTO channels(id,name) SELECT ?,? WHERE ${pending}`).bind(channelId,channelName,c.id));
          statements.push(db.prepare(`INSERT INTO videos(id,channel_id,title,published_at,discovered_at,format,available,format_locked) SELECT ?,?,?,?,?,?,1,? WHERE ${pending} ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id,title=excluded.title,published_at=excluded.published_at,available=1,discovered_at=COALESCE(videos.discovered_at,excluded.discovered_at),format=CASE WHEN videos.format_locked=1 THEN videos.format ELSE excluded.format END,format_locked=MAX(videos.format_locked,excluded.format_locked)`).bind(c.video_id,channelId,title,date,now,format,Number(Boolean(b.format)),c.id));
          statements.push(db.prepare(`INSERT INTO matches(performer_id,video_id,status,source) SELECT ?,?,'CONFIRMED','Community submission verified by moderator' WHERE ${pending} ON CONFLICT(performer_id,video_id) DO UPDATE SET status='CONFIRMED',source=excluded.source`).bind(c.performer_id,c.video_id,c.id));
        }
        if(c.kind==='flag'){
          if(await db.prepare('SELECT 1 FROM exclusions WHERE performer_id=? AND video_id=?').bind(c.performer_id,c.video_id).first())fail('Already excluded. Reject this report as a duplicate.',409);
          statements.push(db.prepare(`INSERT OR IGNORE INTO exclusions(performer_id,video_id,reason) SELECT ?,?,? WHERE ${pending}`).bind(c.performer_id,c.video_id,`Community review: ${c.reason}. ${note}`,c.id));
          statements.push(db.prepare(`UPDATE discovery_notifications SET status='removed',reviewed_at=?,reviewed_by=?,note=? WHERE performer_id=? AND video_id=? AND ${pending}`).bind(now,user.id,note,c.performer_id,c.video_id,c.id));
          statements.push(db.prepare(`UPDATE matches SET status='REJECTED' WHERE performer_id=? AND video_id=? AND ${pending}`).bind(c.performer_id,c.video_id,c.id));
        }
        if(c.user_id!==user.id){
          statements.push(db.prepare(`INSERT OR IGNORE INTO reputation_events(id,user_id,amount,reason,created_at) SELECT ?,?,?,?,? WHERE ${pending}`).bind(c.id,c.user_id,{comment:2,submission:10,flag:5}[c.kind],`Verified ${c.kind}`,now,c.id));
          const rule={comment:[3,3],submission:[20,5],flag:[5,5]}[c.kind];
          const key=c.kind==='flag'?`correction:${c.performer_id}:${c.video_id}`:c.id;
          const extra=c.kind==='submission'?" AND NOT EXISTS(SELECT 1 FROM matches WHERE performer_id=? AND video_id=?)":c.kind==='flag'?" AND NOT EXISTS(SELECT 1 FROM exclusions WHERE performer_id=? AND video_id=?)":"";
          statements.unshift(award(db,key,c.user_id,c.kind,rule[0],rule[1],now,pending+extra,extra?[c.id,c.performer_id,c.video_id]:[c.id]));
        }
      }
      statements.push(db.prepare("UPDATE contributions SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'").bind(b.decision==='accept'?'accepted':'rejected',note,user.id,now,c.id));
      await db.batch(statements);return json({ok:true,message:'Review saved. Your own approvals do not earn points.'});
    }
    return json({error:'Not found'},404);
  }catch(e){if(e.status)return json({error:e.message},e.status);console.error('Community service failed');return json({error:'Community service temporarily unavailable. Your form has been kept; please retry.'},503);}
}
