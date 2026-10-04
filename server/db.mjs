export const EXCLUDED = ['pwNtcFZ_59I','N1VgQd6YGXY','dw3TLJ9tfdE','_605HPZxVcg','P69VWMewzQY'];
export function database(env) { if (!env.DB) throw new Error('Catalog storage is unavailable'); return env.DB; }
export async function batches(db, statements) { for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50)); }
export async function seedDatabase(db, seed) {
  if(!await db.prepare("SELECT value FROM state WHERE key='seed-v2'").first()) {
  const sql=[];
  for(const p of seed.performers) sql.push(db.prepare('INSERT OR IGNORE INTO performers(id,name,aliases) VALUES(?,?,?)').bind(p.id,p.name,JSON.stringify([p.name])));
  for(const c of seed.channels) if(/^UC[\w-]{22}$/.test(c.id)) sql.push(db.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').bind(c.id,c.name));
  for(const id of EXCLUDED) sql.push(db.prepare('INSERT OR IGNORE INTO exclusions(performer_id,video_id,reason) VALUES(?,?,?)').bind('missioned-souls',id,'Prior user correction: unrelated, false positive, or excerpt'));
  for(const v of seed.videos) {
    if(EXCLUDED.includes(v.id) || !/^[\w-]{11}$/.test(v.id)) continue;
    if(v.channelId) sql.push(db.prepare('INSERT OR IGNORE INTO channels(id,name) VALUES(?,?)').bind(v.channelId,v.channelName || 'Unknown reactor'));
    sql.push(db.prepare('INSERT OR IGNORE INTO videos(id,channel_id,title,published_at,format) VALUES(?,?,?,?,?)').bind(v.id,v.channelId||'',v.title,v.publishedAt||null,v.format||'UNKNOWN'));
    const status = v.id === 'gXWQQNUpKcA' ? 'PENDING' : (v.confidence === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING');
    sql.push(db.prepare('INSERT OR IGNORE INTO matches(performer_id,video_id,status,source) VALUES(?,?,?,?)').bind(v.performerId,v.id,status,'Imported reconciliation workbook; not live-checked'));
  }
  await batches(db,sql);
  await db.prepare("INSERT OR IGNORE INTO state(key,value) VALUES('seed-v2','complete')").run();
  }
  await importDiscoveryRun(db,seed.importRun);
  // Apply the owner's new default once, without changing prior video decisions.
  const mode=await db.prepare("SELECT value FROM state WHERE key='automatic-publication-v1'").first();
  if(!mode)await db.batch([
    db.prepare("UPDATE performers SET review_mode='auto'"),
    db.prepare("INSERT OR IGNORE INTO state(key,value) VALUES('automatic-publication-v1','enabled')")
  ]);
}
export async function importDiscoveryRun(db,run) {
  if(!run || await db.prepare('SELECT value FROM state WHERE key=?').bind(`import:${run.id}`).first()) return;
  const statements=[];
  for(const c of run.channels) statements.push(db.prepare('INSERT INTO channels(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(c.id,c.name));
  for(const v of run.videos) {
    statements.push(db.prepare('INSERT INTO channels(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(v.channelId,v.channelName));
    statements.push(db.prepare('INSERT INTO videos(id,channel_id,title,published_at,discovered_at,format) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id,title=excluded.title,published_at=excluded.published_at,discovered_at=COALESCE(videos.discovered_at,excluded.discovered_at),format=excluded.format').bind(v.id,v.channelId,v.title,v.publishedAt,run.startedAt,v.format));
    statements.push(db.prepare('INSERT INTO matches(performer_id,video_id,status,source) VALUES(?,?,?,?) ON CONFLICT(performer_id,video_id) DO UPDATE SET status=excluded.status,source=excluded.source').bind('missioned-souls',v.id,v.confidence,`v3.3.1 import ${run.id}`));
  }
  await batches(db,statements);
  // Keep uncertain identity matches and review decisions as audit data, never as merged identities.
  await db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)').bind(`import-audit:${run.id}`,JSON.stringify({possibleDuplicates:run.possibleDuplicates,rejectedThisRun:run.rejectedThisRun,reactors:run.channels})).run();
  await db.prepare('INSERT OR IGNORE INTO state(key,value) VALUES(?,?)').bind(`import:${run.id}`,JSON.stringify({videos:run.videos.length,channels:run.channels.length,startedAt:run.startedAt})).run();
}
export async function status(db,env) {
  const history=await db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 12').all();
  const last=await db.prepare("SELECT finished_at FROM runs WHERE status='succeeded' ORDER BY finished_at DESC LIMIT 1").first();
  const scheduled=await db.prepare("SELECT value FROM state WHERE key='last-scheduled-invocation'").first();
  const coverage=await db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN recent_checked_at >= ? THEN 1 ELSE 0 END) checked FROM channels WHERE discovery_scope='eligible'").bind(new Date(Date.now()-86400000).toISOString()).first();
  const backlog=await db.prepare("SELECT COUNT(*) channels FROM channels WHERE discovery_scope='eligible' AND next_page IS NOT NULL").first();
  const scopes=(await db.prepare('SELECT discovery_scope,COUNT(*) n FROM channels GROUP BY discovery_scope').all()).results;
  const heldChannels=(await db.prepare("SELECT id,name,discovery_scope FROM channels WHERE discovery_scope<>'eligible' ORDER BY name LIMIT 50").all()).results;
  const requestDay=new Date().toISOString().slice(0,10);
  const youtubeRequests=(await db.prepare('SELECT key,value FROM state WHERE key>=? AND key<?').bind('youtube-requests:'+requestDay+':','youtube-requests:'+requestDay+';').all()).results;
  const delay=await db.prepare("SELECT COUNT(*) samples,AVG(delay_seconds) average_seconds,MAX(delay_seconds) max_seconds FROM discovery_observations WHERE discovered_at>=? AND source IN ('Recent-upload check','YouTube upload notification') AND delay_seconds BETWEEN 0 AND 604800").bind(new Date(Date.now()-86400000).toISOString()).first();
  const age=scheduled?.value?Date.now()-Date.parse(scheduled.value):Infinity;
  const automation=age>=0&&age<24*3600000?'active':scheduled?'stale':'not_connected';
  const message=!env.YOUTUBE_API_KEY?'Automatic discovery is inactive: YouTube API access is not configured.':automation==='active'?'Scheduled discovery is running. Check the recent batches and channel coverage below.':automation==='stale'?'Scheduled discovery has not fired in the past 24 hours. Check the scheduler.':'Discovery worker ready; scheduled execution is not connected.';
  return {heldChannels,scopes,youtubeRequests,requestDay,delay,apiConfigured:Boolean(env.YOUTUBE_API_KEY),automation,lastScheduledAt:scheduled?.value||null,lastSuccessfulBatchAt:last?.finished_at||null,coverage,historyBacklog:backlog?.channels||0,lastDiscoveryRunAt:history.results.find(r=>r.finished_at)?.finished_at||null,runs:history.results,message};
}
export async function catalog(db,seed,env) {
  const rows=await db.prepare("SELECT v.*,m.performer_id,m.status,m.source,c.name channel_name FROM videos v JOIN matches m ON v.id=m.video_id LEFT JOIN channels c ON c.id=v.channel_id JOIN performers p ON p.id=m.performer_id WHERE p.status='active' AND p.id='missioned-souls' AND v.available=1 AND m.status IN ('CONFIRMED','PROBABLE') AND NOT EXISTS (SELECT 1 FROM exclusions e WHERE e.video_id=v.id AND e.performer_id=m.performer_id) ORDER BY v.published_at DESC").all();
  const performers=(await db.prepare("SELECT id,name,official_url FROM performers WHERE status='active' AND id='missioned-souls' ORDER BY name").all()).results;
  const activeIds=new Set(performers.map(p=>p.id));
  const snapshots=new Map(seed.videos.map(v=>[v.id,v]));
  const importedSnapshots=(await db.prepare("SELECT value FROM state WHERE key >= 'master-video-snapshot:' AND key < 'master-video-snapshot;'").all()).results;
  for(const row of importedSnapshots){const v=JSON.parse(row.value);snapshots.set(v.id,{...snapshots.get(v.id),...v});}
  const videos=rows.results.map(v=>({...snapshots.get(v.id),source:v.source,id:v.id,performerId:v.performer_id,channelId:v.channel_id,channelName:v.channel_name||'Unknown reactor',title:v.title,publishedAt:v.published_at,discoveredAt:v.discovered_at,format:v.format,confidence:v.status,videoUrl:`https://www.youtube.com/watch?v=${v.id}`,isNew:Boolean(v.discovered_at&&Date.now()-Date.parse(v.discovered_at)<7*86400000)}));
  const known=new Map(seed.channels.filter(c=>activeIds.has(c.performerId)&&/^UC[\w-]{22}$/.test(c.id)).map(c=>[`${c.performerId}:${c.id}`,{...c}]));
  for(const v of seed.importRun?.videos||[]) { const key=`missioned-souls:${v.channelId}`; if(known.has(key)) known.set(key,{...known.get(key),name:v.channelName}); }
  const imported=seed.importRun?.channels||[];
  for(const c of imported) if(activeIds.has('missioned-souls')) known.set(`missioned-souls:${c.id}`,{...known.get(`missioned-souls:${c.id}`),performerId:'missioned-souls',id:c.id,name:c.name,url:`https://www.youtube.com/channel/${c.id}`,status:c.currentDiscovery?'NEW REACTOR':'CATALOGED',reactions:c.reactions,discoveredAt:seed.importRun.startedAt,currentDiscovery:c.currentDiscovery});
  const masterChannels=(await db.prepare("SELECT value FROM state WHERE key >= 'master-channel-snapshot:' AND key < 'master-channel-snapshot;'").all()).results;
  for(const row of masterChannels)if(activeIds.has('missioned-souls')){const c=JSON.parse(row.value);const key=`missioned-souls:${c.id}`;known.set(key,{...known.get(key),...c,performerId:'missioned-souls',url:`https://www.youtube.com/channel/${c.id}`,currentDiscovery:false});}
  for(const v of videos) if(!known.has(`${v.performerId}:${v.channelId}`)) known.set(`${v.performerId}:${v.channelId}`,{performerId:v.performerId,id:v.channelId,name:v.channelName,url:`https://www.youtube.com/channel/${v.channelId}`,status:'CATALOGED',reactions:videos.filter(x=>x.channelId===v.channelId&&x.performerId===v.performerId).length});
  return {performers,channels:[...known.values()],videos,stats:{channels:new Set([...known.values()].map(c=>c.id)).size,videos:videos.length,performers:performers.length},discovery:await status(db,env)};
}
