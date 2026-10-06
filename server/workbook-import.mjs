import { database } from './db.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const cid=/^UC[\w-]{22}$/,vid=/^[\w-]{11}$/;
export function validateImport(input){
 if(!input||!Array.isArray(input.channels)||!Array.isArray(input.videos))fail('Workbook channels and videos are required.');
 if(input.channels.length>1000||input.videos.length>1000)fail('Import up to 1,000 channels and 1,000 videos at a time.',413);
 if(!input.channels.length&&!input.videos.length)fail('No importable rows found.');
 const channels=new Map(),videos=new Map();let duplicates=0;
 for(const c of input.channels){if(!c||!cid.test(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>300)fail('Each channel needs a valid YouTube channel ID and name.');const row={id:c.id,name:c.name.trim()};if(channels.has(c.id)){if(channels.get(c.id).name!==row.name)fail('Conflicting channel names for '+c.id);duplicates++;}channels.set(c.id,row);}
 for(const v of input.videos){
  if(!v||!vid.test(v.id)||!cid.test(v.channelId)||typeof v.title!=='string'||!v.title.trim()||v.title.length>1000||!['CONFIRMED','PROBABLE','PENDING'].includes(v.confidence)||!['FULL_LENGTH','SHORT','SHORT_CANDIDATE','UNKNOWN'].includes(v.format))fail('A video has an invalid ID, title, status, or format.');
  if(v.publishedAt!==null&&(typeof v.publishedAt!=='string'||!Number.isFinite(Date.parse(v.publishedAt))))fail('Invalid publication date for '+v.id);
  const row={id:v.id,channelId:v.channelId,title:v.title.trim(),publishedAt:v.publishedAt,confidence:v.confidence,format:v.format};
  if(!channels.has(v.channelId))fail('Video channel '+v.channelId+' is missing from Updated Master.');
  if(videos.has(v.id)){if(JSON.stringify(videos.get(v.id))!==JSON.stringify(row))fail('Conflicting video rows for '+v.id);duplicates++;}videos.set(v.id,row);
 }
 return {channels:[...channels.values()],videos:[...videos.values()],duplicates,omitted:Math.max(0,Math.min(100000,Number(input.omitted)||0)),filename:String(input.filename||'Workbook').slice(0,200),sheet:String(input.sheet||'Video import').slice(0,100)};
}
function inserts(db,table,columns,rows){
 const statements=[];for(let start=0;start<rows.length;start+=10){const part=rows.slice(start,start+10);statements.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES ${part.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')}`).bind(...part.flat()));}return statements;
}
const blockers=`EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id='missioned-souls' AND e.video_id=i.id) OR EXISTS(SELECT 1 FROM matches m WHERE m.performer_id='missioned-souls' AND m.video_id=i.id AND m.status='REJECTED')`;
const rowStatus=`CASE WHEN (${blockers}) THEN 'excluded' WHEN EXISTS(SELECT 1 FROM videos v WHERE v.id=i.id AND (v.channel_id<>i.channel_id OR v.available=0)) OR EXISTS(SELECT 1 FROM channels c WHERE c.id=i.channel_id AND c.discovery_scope NOT IN ('eligible','other','review')) THEN 'protected' WHEN EXISTS(SELECT 1 FROM matches m WHERE m.performer_id='missioned-souls' AND m.video_id=i.id) THEN 'existing' ELSE 'add' END`;
const importStatus=`CASE WHEN i.confidence='CONFIRMED' AND i.format='FULL_LENGTH' AND NOT EXISTS(SELECT 1 FROM videos v WHERE v.id=i.id AND v.format<>'FULL_LENGTH') THEN 'CONFIRMED' ELSE 'PENDING' END`;
async function preview(db,id){
 const channels=(await db.prepare('SELECT i.id,i.name,CASE WHEN c.id IS NULL THEN \'add\' ELSE \'existing\' END disposition FROM workbook_import_channels i LEFT JOIN channels c ON c.id=i.id WHERE i.job_id=? ORDER BY i.name').bind(id).all()).results;
 const videos=(await db.prepare(`SELECT i.id,i.title,i.channel_id,c.name channel_name,${rowStatus} disposition,${importStatus} import_status,(SELECT reason FROM exclusions WHERE performer_id='missioned-souls' AND video_id=i.id) exclusion_reason,(SELECT status FROM matches WHERE performer_id='missioned-souls' AND video_id=i.id) existing_status FROM workbook_import_videos i LEFT JOIN workbook_import_channels c ON c.job_id=i.job_id AND c.id=i.channel_id WHERE i.job_id=? ORDER BY i.title`).bind(id).all()).results;
 return {channels,videos,counts:{channelsAdded:channels.filter(x=>x.disposition==='add').length,channelsExisting:channels.filter(x=>x.disposition==='existing').length,videosAdded:videos.filter(x=>x.disposition==='add').length,videosExisting:videos.filter(x=>x.disposition==='existing').length,videosExcluded:videos.filter(x=>x.disposition==='excluded').length,videosProtected:videos.filter(x=>x.disposition==='protected').length,review:videos.filter(x=>x.disposition==='add'&&x.import_status==='PENDING').length}};
}
export async function workbookImport(request,env,user){
 try{
  if(!user)return json({error:'Sign in required.'},401);if(!user.moderator)return json({error:'Moderator access required.'},403);
  const u=new URL(request.url),path=u.pathname.slice('/api/workbook-import'.length),db=database(env);
  if(request.method==='GET'&&path==='/history')return json({items:(await db.prepare('SELECT id,filename,sheet,status,created_at,applied_at,receipt,duplicates,omitted FROM workbook_import_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 20').bind(user.id).all()).results.map(x=>({...x,receipt:x.receipt?JSON.parse(x.receipt):null}))});
  if(request.method!=='POST')return json({error:'POST required.'},405);
  if(request.headers.get('Origin')!==u.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Submit from the Reaction Journey website.',403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('JSON required.',415);
  if(Number(request.headers.get('Content-Length'))>4000000)fail('Workbook payload too large.',413);
  const reader=request.body?.getReader();if(!reader)fail('Upload required.');const chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4000000){await reader.cancel();fail('Workbook payload too large.',413);}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid upload.');}
  if(path==='/preview'){
   const data=validateImport(body),id=crypto.randomUUID(),now=new Date().toISOString();
   await db.batch([db.prepare('INSERT INTO workbook_import_jobs(id,owner_id,filename,sheet,status,created_at,duplicates,omitted) VALUES(?,?,?,?,\'ready\',?,?,?)').bind(id,user.id,data.filename,data.sheet,now,data.duplicates,data.omitted),...inserts(db,'workbook_import_channels',['job_id','id','name'],data.channels.map(c=>[id,c.id,c.name])),...inserts(db,'workbook_import_videos',['job_id','id','channel_id','title','published_at','confidence','format'],data.videos.map(v=>[id,v.id,v.channelId,v.title,v.publishedAt,v.confidence,v.format]))]);
   return json({id,filename:data.filename,sheet:data.sheet,duplicates:data.duplicates,omitted:data.omitted,...await preview(db,id)});
  }
  if(path==='/apply'){
   if(typeof body.id!=='string'||body.id.length>80)fail('Invalid import.');
   const job=await db.prepare('SELECT * FROM workbook_import_jobs WHERE id=? AND owner_id=?').bind(body.id,user.id).first();if(!job)fail('Import not found.',404);
   if(job.status==='applied')return json({id:job.id,receipt:JSON.parse(job.receipt),alreadyApplied:true});
   if(Date.now()-Date.parse(job.created_at)>86400000)fail('Preview expired. Upload the workbook again.',409);
   const id=job.id,now=new Date().toISOString(),ready="EXISTS(SELECT 1 FROM workbook_import_jobs j WHERE j.id=i.job_id AND j.status='ready')";
   // One atomic D1 batch: the receipt is computed from live rows, then the same guarded
   // rows are inserted. A competing discovery/moderation batch cannot interleave.
   await db.batch([
    db.prepare("INSERT OR IGNORE INTO workbook_import_scopes(job_id,channel_id,scope) SELECT ?,c.id,c.discovery_scope FROM channels c JOIN workbook_import_channels i ON i.id=c.id WHERE i.job_id=? AND c.discovery_scope NOT IN ('eligible','other','review') AND EXISTS(SELECT 1 FROM workbook_import_jobs WHERE id=? AND status='ready')").bind(id,id,id),
    db.prepare(`UPDATE workbook_import_jobs SET receipt=json_object('channelsAdded',(SELECT COUNT(*) FROM workbook_import_channels i WHERE i.job_id=? AND NOT EXISTS(SELECT 1 FROM channels c WHERE c.id=i.id)),'channelsExisting',(SELECT COUNT(*) FROM workbook_import_channels i WHERE i.job_id=? AND EXISTS(SELECT 1 FROM channels c WHERE c.id=i.id)),'channels',json((SELECT json_group_array(json_object('id',i.id,'name',i.name,'disposition',CASE WHEN EXISTS(SELECT 1 FROM channels c WHERE c.id=i.id) THEN 'existing' ELSE 'add' END)) FROM workbook_import_channels i WHERE i.job_id=?)),'videos',json((SELECT json_group_array(json_object('id',i.id,'title',i.title,'disposition',${rowStatus},'status',${importStatus},'existingStatus',(SELECT status FROM matches WHERE performer_id='missioned-souls' AND video_id=i.id),'reason',(SELECT reason FROM exclusions WHERE performer_id='missioned-souls' AND video_id=i.id))) FROM workbook_import_videos i WHERE i.job_id=?))) WHERE id=? AND status='ready'`).bind(id,id,id,id,id),
    db.prepare(`INSERT OR IGNORE INTO channels(id,name) SELECT i.id,i.name FROM workbook_import_channels i WHERE i.job_id=? AND ${ready}`).bind(id),
    db.prepare(`INSERT OR IGNORE INTO videos(id,channel_id,title,published_at,discovered_at,format) SELECT i.id,i.channel_id,i.title,i.published_at,?,i.format FROM workbook_import_videos i WHERE i.job_id=? AND ${ready} AND (${rowStatus})='add'`).bind(now,id),
    db.prepare(`INSERT OR IGNORE INTO matches(performer_id,video_id,status,source) SELECT 'missioned-souls',i.id,${importStatus},'Workbook import '||i.job_id||'; source confidence: '||i.confidence FROM workbook_import_videos i WHERE i.job_id=? AND ${ready} AND (${rowStatus})='add' AND EXISTS(SELECT 1 FROM videos v WHERE v.id=i.id AND v.channel_id=i.channel_id AND v.available=1)`).bind(id),
    // Existing discovery triggers may promote channels. Restore the pre-import scope
    // of explicitly protected channels captured before inserting matches.
    db.prepare("UPDATE channels SET discovery_scope=(SELECT scope FROM workbook_import_scopes s WHERE s.job_id=? AND s.channel_id=channels.id) WHERE id IN (SELECT channel_id FROM workbook_import_scopes WHERE job_id=?) AND EXISTS(SELECT 1 FROM workbook_import_jobs WHERE id=? AND status='ready')").bind(id,id,id),
    db.prepare("UPDATE workbook_import_jobs SET status='applied',applied_at=? WHERE id=? AND status='ready'").bind(now,id)
   ]);
   const result=await db.prepare('SELECT receipt FROM workbook_import_jobs WHERE id=?').bind(id).first();return json({id,receipt:JSON.parse(result.receipt)});
  }
  return json({error:'Not found.'},404);
 }catch(e){if(e.status)return json({error:e.message},e.status);console.error('Workbook import failed');return json({error:'Import could not complete. Retry or reopen your import history.'},503);}
}
