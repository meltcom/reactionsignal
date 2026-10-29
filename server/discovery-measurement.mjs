export const SEARCH_STRATEGY='fresh-v2-clean-hints-paced-attempts';
export const REPORT_TIMEZONE='America/Los_Angeles';
const dayFormatter=new Intl.DateTimeFormat('en-US',{timeZone:REPORT_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function pacificDay(at=new Date()){
 const parts=dayFormatter.formatToParts(new Date(at));
 const value=k=>parts.find(p=>p.type===k).value;return `${value('year')}-${value('month')}-${value('day')}`;
}
export function searchSettings(env){const configured=Number(env.DISCOVERY_DAILY_SEARCH_LIMIT??20);return {dailyLimit:Number.isFinite(configured)?Math.max(0,Math.min(80,Math.floor(configured))):20,timezone:REPORT_TIMEZONE,rotation:'12-name/6-reaction/2-experiment',windowOverlapDays:7};}
export async function startSearchPage(db,{runId,performerId,query,cursor,env,at}){
 const id=crypto.randomUUID();await db.prepare('INSERT INTO discovery_search_pages(id,run_id,performer_id,strategy_version,settings_json,query,window_start,window_end,page_depth,started_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,runId,performerId,SEARCH_STRATEGY,JSON.stringify(searchSettings(env)),query,cursor.after||null,cursor.startedAt,cursor.depth??(cursor.page?0:1),at).run();return id;
}
export async function reserveSearchAttempt(db,pageId,limit,at=new Date().toISOString()){
 const day=pacificDay(at),key='search-attempt-budget:'+day;
 // First deployment conservatively carries both overlapping UTC days. Never reset
 // an existing day's allowance or ignore requests made by the preceding release.
 const utc=new Date(at),today=utc.toISOString().slice(0,10);utc.setUTCDate(utc.getUTCDate()-1);const yesterday=utc.toISOString().slice(0,10);
 await db.prepare("INSERT OR IGNORE INTO state(key,value) SELECT ?,CAST(CASE WHEN EXISTS(SELECT 1 FROM discovery_search_attempts LIMIT 1) THEN 0 ELSE COALESCE(SUM(CAST(value AS INTEGER)),0) END AS TEXT) FROM state WHERE key IN (?,?)").bind(key,'youtube-requests:'+today+':search','youtube-requests:'+yesterday+':search').run();
 const slot=await db.prepare('UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key=? AND CAST(value AS INTEGER)<?').bind(key,limit).run();
 if(!slot.meta.changes)throw Error('Daily search attempt budget reached; continuation retained');
 const id=crypto.randomUUID();await db.prepare('INSERT INTO discovery_search_attempts(id,page_id,attempted_at,quota_day) VALUES(?,?,?,?)').bind(id,pageId,at,day).run();return id;
}
export async function finishSearchAttempt(db,id,status,httpStatus,duration){await db.prepare('UPDATE discovery_search_attempts SET status=?,http_status=?,duration_ms=? WHERE id=?').bind(status,httpStatus??null,duration,id).run();}
export async function finishSearchPage(db,id,{status,results=0,newVideos=0,newReactors=0,error=null,at=new Date().toISOString()}){
 await db.prepare('UPDATE discovery_search_pages SET finished_at=?,status=?,results=?,new_videos=?,new_reactors=?,duration_ms=MAX(0,CAST((julianday(?)-julianday(started_at))*86400000 AS INTEGER)),error=? WHERE id=?').bind(at,status,results,newVideos,newReactors,at,error,id).run();
}
export async function recordSearchResults(db,pageId,performerId,ids,before,eligibleBefore,at){
 const rows=(await db.prepare(`WITH input AS (SELECT value id FROM json_each(?)) SELECT i.id,v.channel_id,v.published_at,m.status,e.video_id excluded,c.discovery_scope FROM input i LEFT JOIN videos v ON v.id=i.id LEFT JOIN matches m ON m.video_id=i.id AND m.performer_id=? LEFT JOIN exclusions e ON e.video_id=i.id AND e.performer_id=? LEFT JOIN channels c ON c.id=v.channel_id`).bind(JSON.stringify(ids),performerId,performerId).all()).results;
 const found=new Map(rows.map(r=>[r.id,r])),newChannels=new Set();let newVideos=0;
 const statements=[...new Set(ids)].map(id=>{
  const row=found.get(id),prior=before.has(id),isNew=Boolean(row?.status&&!prior&&!row.excluded),qualified=isNew&&['CONFIRMED','PROBABLE'].includes(row.status);
  const newReactor=qualified&&row.discovery_scope==='eligible'&&!eligibleBefore.has(row.channel_id)&&!newChannels.has(row.channel_id);if(newReactor)newChannels.add(row.channel_id);if(isNew)newVideos++;
  const lag=row?.published_at?(Date.parse(at)-Date.parse(row.published_at))/1000:null,delay=Number.isFinite(lag)&&lag>=0?Math.floor(lag):null;
  const disposition=row?.excluded?'excluded':!row?.status?'not_cataloged':prior?'existing':row.status==='REJECTED'?'rejected':'new';
  return db.prepare('INSERT OR IGNORE INTO discovery_search_results(page_id,video_id,channel_id,match_status,disposition,is_new,new_reactor,delay_seconds) VALUES(?,?,?,?,?,?,?,?)').bind(pageId,id,row?.channel_id||null,row?.status||null,disposition,isNew?1:0,newReactor?1:0,delay);
 });if(statements.length)await db.batch(statements);return {newVideos,newReactors:newChannels.size};
}
export async function sampleDiscoveryHealth(db,env,run,at=new Date().toISOString()){
 const since=new Date(Date.parse(at)-86400000).toISOString();
 const c=await db.prepare("SELECT COUNT(*) eligible,COALESCE(SUM(c.recent_checked_at>=?),0) checked,COALESCE(SUM(r.checked_at>=? AND r.error IS NULL),0) rss_checked,COALESCE(SUM(r.error IS NOT NULL),0) rss_errors FROM channels c LEFT JOIN rss_checks r ON r.channel_id=c.id WHERE c.discovery_scope='eligible'").bind(since,since).first();
 await db.prepare('INSERT OR REPLACE INTO discovery_health_samples VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(at,SEARCH_STRATEGY,JSON.stringify(searchSettings(env)),c.eligible,c.checked,c.rss_checked,c.rss_errors,run.status,run.durationMs||0,run.calls||0,run.rowsRead||0,run.rowsWritten||0).run();
}
const percentile=(a,p)=>{if(!a.length)return null;const s=a.toSorted((x,y)=>x-y);if(p===.5&&s.length%2===0)return (s[s.length/2-1]+s[s.length/2])/2;return s[Math.max(0,Math.ceil(s.length*p)-1)];};
function summarize(pages,attempts,results,observations,health){
 const delays=observations.filter(o=>o.delay_seconds!=null&&o.delay_seconds>=0&&o.delay_seconds<=86400).map(o=>o.delay_seconds);
 const groups=new Map();for(const p of pages){const key=JSON.stringify([p.strategy_version,p.settings_json,p.query]);if(!groups.has(key))groups.set(key,{strategy:p.strategy_version,settings:JSON.parse(p.settings_json),query:p.query,pages:0,attempts:0,results:0,newVideos:0,qualifyingVideos:0,newReactors:0,failures:0});const g=groups.get(key);g.pages++;g.results+=p.results;g.failures+=p.status!=='completed'?1:0;g.attempts+=attempts.filter(a=>a.page_id===p.id).length;const rr=results.filter(r=>r.page_id===p.id);g.newVideos+=rr.filter(r=>r.is_new).length;g.qualifyingVideos+=rr.filter(r=>r.is_new&&['CONFIRMED','PROBABLE'].includes(r.match_status)).length;g.newReactors+=rr.reduce((n,r)=>n+r.new_reactor,0);}
 const sources=[...new Set(observations.map(o=>o.source))].map(source=>{const rows=observations.filter(o=>o.source===source),fresh=rows.filter(o=>o.delay_seconds!=null&&o.delay_seconds>=0&&o.delay_seconds<=86400).map(o=>o.delay_seconds);return {source,newVideos:rows.length,freshSamples:fresh.length,medianSeconds:percentile(fresh,.5),p90Seconds:percentile(fresh,.9),olderVideos:rows.filter(o=>o.delay_seconds>86400).length};});
 return {pages:pages.length,attempts:attempts.length,attemptFailures:attempts.filter(a=>a.status!=='succeeded').length,unfinishedPages:pages.filter(p=>p.status==='started').length,newVideos:observations.length,freshSamples:delays.length,medianSeconds:percentile(delays,.5),p90Seconds:percentile(delays,.9),olderVideos:observations.filter(o=>o.delay_seconds>86400).length,unknownTiming:observations.filter(o=>o.delay_seconds==null||o.delay_seconds<0).length,observationStrategies:[...new Set(observations.map(o=>o.strategy_version))],sources,queries:[...groups.values()],healthSamples:health.length,measuredDays:new Set(health.map(x=>x._day)).size,latestCoverage:health.at(-1)||null,minimumCoverage:health.length?Math.min(...health.map(h=>h.eligible?h.checked/h.eligible:1)):null,runFailures:health.filter(h=>h.run_status!=='succeeded').length,averageRunMs:health.length?Math.round(health.reduce((n,h)=>n+h.duration_ms,0)/health.length):null};
}
export async function discoveryPerformance(db,now=new Date()){
 const today=pacificDay(now),first=new Date(today+'T12:00:00Z');first.setUTCDate(first.getUTCDate()-14);const firstDay=first.toISOString().slice(0,10),since=firstDay+'T00:00:00Z',end=new Date(now).toISOString();
 const [p,a,r,o,h]=await Promise.all([
  db.prepare('SELECT * FROM discovery_search_pages WHERE started_at>=? AND started_at<=? ORDER BY started_at').bind(since,end).all(),
  db.prepare('SELECT * FROM discovery_search_attempts WHERE attempted_at>=? AND attempted_at<=?').bind(since,end).all(),
  db.prepare('SELECT r.* FROM discovery_search_results r JOIN discovery_search_pages p ON p.id=r.page_id WHERE p.started_at>=? AND p.started_at<=?').bind(since,end).all(),
  db.prepare('SELECT * FROM discovery_observations WHERE discovered_at>=? AND discovered_at<=?').bind(since,end).all(),
  db.prepare('SELECT * FROM discovery_health_samples WHERE sampled_at>=? AND sampled_at<=? ORDER BY sampled_at').bind(since,end).all()
 ]);
 const tag=(rows,key)=>rows.map(x=>({...x,_day:pacificDay(x[key])}));
 const pages=tag(p.results,'started_at'),attempts=tag(a.results,'attempted_at'),results=r.results,observations=tag(o.results,'discovered_at'),health=tag(h.results,'sampled_at');
 const period=(days)=>{const pp=pages.filter(x=>days.has(x._day)),aa=attempts.filter(x=>days.has(x._day)),ids=new Set(pp.map(x=>x.id));return summarize(pp,aa,results.filter(x=>ids.has(x.page_id)),observations.filter(x=>days.has(x._day)),health.filter(x=>days.has(x._day)));};
 const days=[];for(let i=0;i<15;i++){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-i);days.push(d.toISOString().slice(0,10));}
 return {timezone:REPORT_TIMEZONE,strategy:SEARCH_STRATEGY,startedAt:health[0]?.sampled_at||null,asOf:end,note:'Today is partial. Weekly comparisons use the last 7 completed Pacific days and the preceding 7; legacy observations have no query attribution. Counts are observed discoveries, not completeness or a controlled experiment.',daily:days.map(day=>({day,partial:day===today,...period(new Set([day]))})),weeks:[{label:'Last 7 completed days',days:days.slice(1,8),...period(new Set(days.slice(1,8)))},{label:'Previous 7 completed days',days:days.slice(8,15),...period(new Set(days.slice(8,15)))}]};
}
