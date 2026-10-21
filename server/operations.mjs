const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const emails=env=>String(env.COMMUNITY_MODERATOR_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
export function auditStatement(db,user,action,kind,target,reason,before=null,after=null){
 return db.prepare('INSERT INTO moderation_audit(id,actor_id,action,target_kind,target_id,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),user.id,action,kind,target,reason,JSON.stringify(before),JSON.stringify(after),new Date().toISOString());
}
export async function accountAccess(db,user){
 if(!db||!user)return null;
 const row=await db.prepare('SELECT kind,expires_at FROM account_restrictions WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)').bind(user.id,new Date().toISOString()).first();
 return row?json({error:row.kind==='banned'?'Your account is banned. Contact support to appeal.':'Your account is suspended. Contact support to appeal.',restriction:row.kind,expiresAt:row.expires_at},403):null;
}
export async function restrictAccount(db,user,env,b){
 if(!user?.moderator)return json({error:'Moderator access required.'},403);
 const id=String(b.id||''),reason=String(b.note||'').trim();
 if(reason.length<5||reason.length>500)return json({error:'Enter a reason of 5–500 characters.'},400);
 const target=await db.prepare('SELECT id,email FROM members WHERE id=?').bind(id).first();
 if(!target)return json({error:'Member not found.'},404);
 if(id===user.id||emails(env).includes(String(target.email||'').toLowerCase()))return json({error:'Staff accounts cannot be restricted through this tool.'},403);
 const before=await db.prepare('SELECT * FROM account_restrictions WHERE user_id=?').bind(id).first();
 if(!['suspend','ban','restore-access'].includes(b.action))return json({error:'Invalid account action.'},400);
 const hours=Number(b.hours||24);
 if(b.action==='suspend'&&![1,24,168,720].includes(hours))return json({error:'Choose 1 hour, 1 day, 7 days or 30 days.'},400);
 const now=new Date().toISOString(),after=b.action==='restore-access'?null:{kind:b.action==='ban'?'banned':'suspended',reason,expires_at:b.action==='ban'?null:new Date(Date.now()+hours*3600000).toISOString(),moderator_id:user.id};
 await db.batch([
  after?db.prepare('INSERT INTO account_restrictions(user_id,kind,reason,expires_at,moderator_id,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind,reason=excluded.reason,expires_at=excluded.expires_at,moderator_id=excluded.moderator_id,created_at=excluded.created_at').bind(id,after.kind,reason,after.expires_at,user.id,now):db.prepare('DELETE FROM account_restrictions WHERE user_id=?').bind(id),
  auditStatement(db,user,b.action,'account',id,reason,before,after)
 ]);
 return json({ok:true,message:after?'Account access restricted. The change applies on the next protected request.':'Account access restored.'});
}
export async function recordOperationalEvent(env,code,severity='error'){
 try{if(env.DB)await env.DB.prepare('INSERT INTO operational_events(id,code,severity,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),code,severity,new Date().toISOString()).run();}catch{console.error('Operational event storage unavailable');}
}
export async function operationalSummary(env){
 const db=env.DB,now=Date.now(),cutoff=new Date(now-15*60000).toISOString();
 const [events,queue,abuse,contact,scheduled,size,alerts,staff]=await Promise.all([
  db.prepare('SELECT code,COUNT(*) count FROM operational_events WHERE created_at>=? GROUP BY code').bind(cutoff).all(),
  db.prepare("SELECT COUNT(*) count,MIN(created_at) oldest FROM contributions WHERE status='pending'").first(),
  db.prepare("SELECT COUNT(*) count,MIN(created_at) oldest FROM abuse_reports WHERE status='pending'").first(),
  db.prepare("SELECT COUNT(*) count,MIN(updated_at) oldest FROM contact_tickets WHERE status='open'").first(),
  db.prepare("SELECT value FROM state WHERE key='last-scheduled-invocation'").first(),
  db.prepare('PRAGMA page_count').first(),
  db.prepare('SELECT code,last_attempt_at,delivered_at,error FROM operational_alerts ORDER BY last_attempt_at DESC LIMIT 20').all(),
  db.prepare('SELECT id,name,email FROM members WHERE email IN ('+emails(env).map(()=>'?').join(',')+')').bind(...emails(env)).all()
 ]);
 const page=await db.prepare('PRAGMA page_size').first();
 const warnings=[];
 if(events.results.reduce((n,e)=>n+e.count,0)>=5)warnings.push('recent-errors');
 if(!scheduled?.value||now-Date.parse(scheduled.value)>3600000)warnings.push('scheduler-stale');
 for(const [key,item] of [['contribution',queue],['abuse',abuse],['contact',contact]])if(item.oldest&&now-Date.parse(item.oldest)>86400000)warnings.push(`${key}-backlog`);
 const configured=emails(env),known=staff.results.filter(s=>configured.includes(s.email.toLowerCase()));
 return {at:new Date(now).toISOString(),events:events.results,queues:{contribution:queue,abuse,contact},lastScheduledAt:scheduled?.value||null,databaseBytes:Number(size?.page_count||0)*Number(page?.page_size||0),warnings,alertDeliveryConfigured:Boolean(env.OPERATIONS_ALERT_WEBHOOK),alerts:alerts.results,staff:known,configuredModeratorCount:configured.length,coverageWarning:configured.length<2?'Only one moderator is configured. Arrange backup coverage before broad promotion.':null};
}
export async function checkOperationalAlerts(env,fetcher=fetch){
 const summary=await operationalSummary(env),db=env.DB;
 await db.prepare('DELETE FROM operational_events WHERE id IN (SELECT id FROM operational_events WHERE created_at<? LIMIT 1000)').bind(new Date(Date.now()-7*86400000).toISOString()).run();
 if(!env.OPERATIONS_ALERT_WEBHOOK)return summary;
 let endpoint;try{endpoint=new URL(env.OPERATIONS_ALERT_WEBHOOK);if(endpoint.protocol!=='https:')throw Error();}catch{return summary;}
 for(const code of summary.warnings){
  const now=new Date().toISOString();
  const slot=await db.prepare('INSERT INTO operational_alerts(code,last_attempt_at) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET last_attempt_at=excluded.last_attempt_at WHERE operational_alerts.last_attempt_at<?').bind(code,now,new Date(Date.now()-3600000).toISOString()).run();
  if(!slot.meta?.changes)continue;
  try{
   const r=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({service:'Reaction Journey',code,at:now}),signal:AbortSignal.timeout(5000)});
   if(!r.ok)throw Error('Delivery failed');
   await r.body?.cancel();await db.prepare('UPDATE operational_alerts SET delivered_at=?,error=NULL WHERE code=?').bind(now,code).run();
  }catch{await db.prepare("UPDATE operational_alerts SET error='Delivery failed; check destination configuration' WHERE code=?").bind(code).run();}
 }
 return summary;
}
export async function operations(request,env,user){
 if(!user?.moderator)return json({error:'Moderator access required.'},403);
 const u=new URL(request.url),path=u.pathname.replace('/api/operations',''),db=env.DB;
 if(request.method==='GET'){
  if(path==='/summary')return json(await operationalSummary(env));
  if(path==='/audit'){
   const target=(u.searchParams.get('target')||'').slice(0,200),offset=Math.max(0,Math.min(100000,Math.floor(Number(u.searchParams.get('offset'))||0)));
   const rows=(await db.prepare("SELECT * FROM moderation_audit WHERE (?='' OR target_id=?) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?").bind(target,target,offset).all()).results;
   return json({items:rows.slice(0,50),hasMore:rows.length>50});
  }
  if(path==='/cases'){
   const kind=u.searchParams.get('kind')||'abuse',assigned=u.searchParams.get('assigned')||'all',offset=Math.max(0,Math.min(100000,Math.floor(Number(u.searchParams.get('offset'))||0)));
   const sources={abuse:"SELECT id,body title,created_at FROM abuse_reports WHERE status='pending'",contribution:"SELECT id,body title,created_at FROM contributions WHERE status='pending'",contact:"SELECT id,subject title,updated_at created_at FROM contact_tickets WHERE status='open'",reactor:"SELECT id,body title,created_at FROM reactor_requests WHERE status='pending'"};
   if(!Object.hasOwn(sources,kind)||!['all','mine','unassigned'].includes(assigned))return json({error:'Invalid case filter.'},400);
   const rows=(await db.prepare(`SELECT c.*,a.assignee_id,a.assigned_at FROM (${sources[kind]}) c LEFT JOIN case_assignments a ON a.kind=? AND a.target_id=c.id WHERE ${assigned==='mine'?'a.assignee_id=?':assigned==='unassigned'?'a.assignee_id IS NULL':'1'} ORDER BY c.created_at,c.id LIMIT 51 OFFSET ?`).bind(kind,...(assigned==='mine'?[user.id]:[]),offset).all()).results;
   return json({items:rows.slice(0,50),hasMore:rows.length>50});
  }
  return json({error:'Not found.'},404);
 }
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')!==u.origin||request.headers.get('Sec-Fetch-Site')==='cross-site'||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Submit JSON from this website.'},403);
 const raw=await request.text();if(raw.length>10000)return json({error:'Submission too large.'},413);
 let b;try{b=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 if(!b||typeof b!=='object')return json({error:'Invalid request.'},400);
 if(path==='/restriction')return restrictAccount(db,user,env,b);
 if(path==='/assign'){
  const tables={abuse:'abuse_reports',contribution:'contributions',contact:'contact_tickets',reactor:'reactor_requests'};
  if(!Object.hasOwn(tables,b.kind)||typeof b.id!=='string'||b.id.length>200)return json({error:'Invalid case.'},400);
  if(!await db.prepare(`SELECT 1 FROM ${tables[b.kind]} WHERE id=? AND status=?`).bind(b.id,b.kind==='contact'?'open':'pending').first())return json({error:'Case no longer open.'},409);
  if(b.assignee){const staff=await db.prepare('SELECT email FROM members WHERE id=?').bind(b.assignee).first();if(!staff?.email||!emails(env).includes(staff.email.toLowerCase()))return json({error:'Choose a configured moderator who has signed in.'},400);}
  const before=await db.prepare('SELECT * FROM case_assignments WHERE kind=? AND target_id=?').bind(b.kind,b.id).first();
  await db.batch([b.assignee?db.prepare('INSERT INTO case_assignments(kind,target_id,assignee_id,assigned_by,assigned_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,target_id) DO UPDATE SET assignee_id=excluded.assignee_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at').bind(b.kind,b.id,b.assignee,user.id,new Date().toISOString()):db.prepare('DELETE FROM case_assignments WHERE kind=? AND target_id=?').bind(b.kind,b.id),auditStatement(db,user,'assign-case',b.kind,b.id,'Moderator queue assignment',before,{assignee:b.assignee||null})]);
  return json({ok:true});
 }
 return json({error:'Not found.'},404);
}
