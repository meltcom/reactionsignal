import { database, seedDatabase } from './db.mjs';
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
export const tier=points=>points>=1000?'Community champion':points>=250?'Catalog curator':points>=100?'Reaction scout':points>=25?'Contributor':'New member';
function award(db,id,user,kind,amount,cap,now,guard='1',args=[]){
  return db.prepare(`INSERT OR IGNORE INTO points(id,user_id,kind,amount,created_at)
    SELECT ?,?,?,?,? WHERE (${guard}) AND (SELECT COUNT(*) FROM points WHERE user_id=? AND kind=? AND amount>0 AND created_at>=?)<?`)
    .bind(id,user,kind,amount,now,...args,user,kind,now.slice(0,10),cap);
}
const pending='EXISTS(SELECT 1 FROM contributions WHERE id=? AND status=\'pending\')';
async function known(db,performer,video){if(!await db.prepare("SELECT 1 FROM matches m JOIN videos v ON v.id=m.video_id WHERE m.performer_id=? AND m.video_id=? AND m.status='CONFIRMED' AND v.available=1 AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id)").bind(performer,video).first())fail('This video is not currently in the confirmed catalog.',404);}
export async function community(request,env,seed,user){
  try {
    const db=database(env);await seedDatabase(db,seed);
    const u=new URL(request.url),path=u.pathname.replace('/api/community','');
    if(!user)return json({error:'Sign in to participate.'},401);
    const me=await db.prepare('SELECT name FROM members WHERE id=?').bind(user.id).first();
    if(request.method==='GET'){
      if(path==='/coverage'){
        const rows=await db.prepare('SELECT id,name,url,body,status,created_at,review_note FROM coverage_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
        return json({items:rows.results});
      }
      if(path==='/coverage/queue'){
        if(!user.moderator)fail('Moderator access required.',403);
        const rows=await db.prepare("SELECT c.*,m.name member_name FROM coverage_requests c JOIN members m ON m.id=c.user_id ORDER BY CASE WHEN c.status='pending' THEN 0 ELSE 1 END,c.created_at DESC LIMIT 100").all();
        return json({items:rows.results});
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
        const comments=await db.prepare("SELECT c.id,c.body,c.created_at,m.name FROM contributions c JOIN members m ON m.id=c.user_id WHERE c.kind='comment' AND c.video_id=? AND c.status='accepted' ORDER BY c.created_at DESC LIMIT 100").bind(video).all();
        return json({rating:rating?.score||0,comments:comments.results});
      }
      if(path==='/queue'){
        if(!user.moderator)fail('Moderator access required.',403);
        const rows=await db.prepare("SELECT c.*,m.name FROM contributions c JOIN members m ON m.id=c.user_id WHERE c.status='pending' OR (c.kind='comment' AND c.status='accepted') ORDER BY CASE WHEN c.status='pending' THEN 0 ELSE 1 END,c.created_at ASC LIMIT 100").all();return json({items:rows.results});
      }
      return json({error:'Not found'},404);
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('Origin')!==u.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Please submit from the Reaction Signal website.',403);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('JSON required.',415);
    const raw=await request.text();if(raw.length>10000)fail('Submission too large.',413);
    let b;try{b=JSON.parse(raw);}catch{fail('Invalid submission.');}if(!b||typeof b!=='object')fail('Invalid submission.');
    const now=new Date().toISOString();
    if(path==='/profile'){
      const name=text(b.name,2,40,'Display name');
      await db.prepare('INSERT INTO members(id,name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(user.id,name,now).run();return json({ok:true});
    }
    if(!me)fail('Save a community display name first.',409);
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
          if(await db.prepare('SELECT 1 FROM matches WHERE performer_id=? AND video_id=?').bind(c.performer_id,c.video_id).first())fail('Already in the catalog. Reject this submission as a duplicate.',409);
          const title=text(b.title,3,250,'Verified video title'),channelName=text(b.channelName,2,100,'Verified channel name');
          if(!/^UC[\w-]{22}$/.test(b.channelId||''))fail('Enter the verified YouTube channel ID (UC plus 22 characters).');
          const date=b.publishedAt||null;if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||Date.parse(date)>Date.now()))fail('Enter a valid past upload date, or leave blank.');
          statements.push(db.prepare(`INSERT OR IGNORE INTO channels(id,name) SELECT ?,? WHERE ${pending}`).bind(b.channelId,channelName,c.id));
          statements.push(db.prepare(`INSERT OR IGNORE INTO videos(id,channel_id,title,published_at,discovered_at,format) SELECT ?,?,?,?,?,'UNKNOWN' WHERE ${pending}`).bind(c.video_id,b.channelId,title,date,now,c.id));
          statements.push(db.prepare(`INSERT OR IGNORE INTO matches(performer_id,video_id,status,source) SELECT ?,?,'CONFIRMED','Community submission verified by moderator' WHERE ${pending}`).bind(c.performer_id,c.video_id,c.id));
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
