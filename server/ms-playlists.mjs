import {quotaFetch} from './youtube-quota.mjs';
const CHANNEL='UCeTfwcnUVurw7Qrk_KF5Idw';
const put=(db,key,value)=>db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();
export async function refreshPlaylists(env,saveVideos,fetcher=fetch){
 if(!env.DB||!env.YOUTUBE_API_KEY)return {status:'blocked',message:'YouTube API access is unavailable.'};
 const db=env.DB,now=new Date().toISOString();fetcher=quotaFetch(env,fetcher);
 const lock=await db.prepare("INSERT INTO state(key,value) VALUES('ms-playlist-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER) < ?").bind(String(Date.now()+600000),Date.now()).run();
 if(!lock.meta?.changes)return {status:'busy',message:'Playlist synchronization is already running.'};
 const api=async(endpoint,params)=>{
  const url=new URL('https://www.googleapis.com/youtube/v3/'+endpoint);
  for(const [k,v] of Object.entries({...params,key:env.YOUTUBE_API_KEY}))url.searchParams.set(k,v);
  const r=await fetcher(url,{signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('Playlist synchronization failed ('+r.status+'). Previous playlists retained.');
  const data=await r.json();if(!Array.isArray(data.items))throw new Error('Incomplete YouTube response. Previous playlists retained.');return data;
 };
 try{
  const playlists=[];let token='';
  do{
   const page=await api('playlists',{part:'snippet,contentDetails',channelId:CHANNEL,maxResults:'50',...(token?{pageToken:token}:{})});
   playlists.push(...page.items.map(p=>({id:p.id,name:p.snippet.title,videos:[]})));token=page.nextPageToken||'';
   if(playlists.length>500)throw new Error('Playlist safety limit reached; previous catalog retained.');
  }while(token);
  for(const p of playlists){
   token='';let pages=0;
   do{
    const page=await api('playlistItems',{part:'snippet,contentDetails',playlistId:p.id,maxResults:'50',...(token?{pageToken:token}:{})});
    p.videos.push(...page.items.filter(v=>v.contentDetails?.videoId).map(v=>({id:v.contentDetails.videoId,title:v.snippet.title,publishedAt:v.contentDetails.videoPublishedAt||null})));
    token=page.nextPageToken||'';if(++pages>100)throw new Error('Playlist page limit reached; previous catalog retained.');
   }while(token);
  }
  // Publish only a complete membership scan. Stable playlist IDs survive renames.
  const snapshot={playlists,updatedAt:now,source:'YouTube Data API · official channel',status:'complete'};
  const rows=(await db.prepare("SELECT value FROM state WHERE key LIKE 'ms-video:%'").all()).results;
  const known=new Set(rows.map(r=>JSON.parse(r.value).youtubeId));
  const missing=[...new Set(playlists.flatMap(p=>p.videos.map(v=>v.id)))].filter(id=>!known.has(id));let added=0,unavailable=0;
  for(let i=0;i<missing.length;i+=50){
   const page=await api('videos',{part:'snippet,statistics',id:missing.slice(i,i+50).join(',')});
   const items=page.items.filter(v=>v.snippet.channelId===CHANNEL).map(v=>({title:v.snippet.title,url:'https://www.youtube.com/watch?v='+v.id,publishedAt:v.snippet.publishedAt,statsAt:now,views:v.statistics?.viewCount??null,likes:v.statistics?.likeCount??null,comments:v.statistics?.commentCount??null,sourceNote:'Official playlist import.'}));
   if(items.length)added+=await saveVideos(db,items);unavailable+=missing.slice(i,i+50).length-items.length;
  }
  await put(db,'ms-playlists',snapshot);
  const result={status:'complete',updatedAt:now,count:playlists.length,added,unavailable,message:playlists.length+' official playlists synchronized.'};
  await put(db,'ms-playlist-refresh',result);await put(db,'ms-updated',{at:now});return result;
 }catch(e){const result={status:'error',message:e.message,lastAttemptAt:now};await put(db,'ms-playlist-refresh',result);return result;}
 finally{await db.prepare("DELETE FROM state WHERE key='ms-playlist-lock'").run();}
}
