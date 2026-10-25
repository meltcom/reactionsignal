import {database,batches} from './db.mjs';
import {YouTube,videoMetadata} from './discovery.mjs';

// Refresh one bounded batch per scheduler tick; never call YouTube on a page view.
export async function refreshVideoMetadata(env,fetcher=fetch,now=new Date()){
 if(!env.YOUTUBE_API_KEY)return {status:'blocked',calls:0};
 const db=database(env),at=now.toISOString(),cutoff=new Date(+now-86400000).toISOString();
 const lease=await db.prepare("INSERT INTO state(key,value) VALUES('video-metadata-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<?").bind(String(+now+300000),+now).run();
 if(!lease.meta.changes)return {status:'busy',calls:0};
 try{
  const rows=(await db.prepare(`SELECT v.id FROM videos v LEFT JOIN state s ON s.key='youtube-video-metadata:'||v.id
   WHERE v.available=1 AND (json_extract(s.value,'$.metadataUpdatedAt') IS NULL OR json_extract(s.value,'$.metadataUpdatedAt')<=?)
   AND (json_extract(s.value,'$.retryAt') IS NULL OR json_extract(s.value,'$.retryAt')<=?)
   ORDER BY COALESCE(json_extract(s.value,'$.metadataUpdatedAt'),''),v.published_at DESC LIMIT 50`).bind(cutoff,at).all()).results;
  if(!rows.length)return {status:'current',calls:0};
  const api=new YouTube(env.YOUTUBE_API_KEY,fetcher,db);
  const response=await api.get('videos',{part:'contentDetails,statistics',id:rows.map(r=>r.id).join(',')});
  if(!Array.isArray(response.items))throw new Error('Invalid YouTube metadata response');
  const items=new Map(response.items.map(v=>[v.id,v]));
  const work=rows.map(row=>items.has(row.id)
   ?db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('youtube-video-metadata:'+row.id,JSON.stringify(videoMetadata(items.get(row.id),at)))
   :db.prepare("INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=json_set(state.value,'$.retryAt',?)").bind('youtube-video-metadata:'+row.id,JSON.stringify({retryAt:new Date(+now+86400000).toISOString()}),new Date(+now+86400000).toISOString()));
  work.push(db.prepare("INSERT INTO state(key,value) VALUES('catalog-revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(state.value AS INTEGER)+1"));
  await batches(db,work);return {status:'succeeded',updated:items.size,calls:api.calls};
 }finally{await db.prepare("DELETE FROM state WHERE key='video-metadata-lock' AND value=?").bind(String(+now+300000)).run();}
}
