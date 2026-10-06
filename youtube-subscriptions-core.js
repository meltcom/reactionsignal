export const youtubeScope='https://www.googleapis.com/auth/youtube.readonly';
export function matchSubscriptions(ids,channels,follows=[],hidden=[]){
 const subscribed=new Set(ids),following=new Set(follows.filter(f=>f.kind==='reactor').map(f=>f.target)),excluded=new Set(hidden.map(h=>h.channel_id));
 const known=new Map(channels.map(c=>[c.id,c])),matches=[];let alreadyFollowing=0,hiddenCount=0,unmatched=0;
 for(const id of subscribed){const channel=known.get(id);if(!channel){unmatched++;continue;}if(excluded.has(id)){hiddenCount++;continue;}if(following.has(id)){alreadyFollowing++;continue;}matches.push(channel);}
 return {matches:matches.sort((a,b)=>a.name.localeCompare(b.name)),alreadyFollowing,hiddenCount,unmatched,total:subscribed.size};
}
export async function readSubscriptions(token,{fetcher=fetch,signal,onProgress=()=>{}}={}){
 const ids=new Set(),pages=new Set();let pageToken='',count=0;
 do{
  if(++count>200)throw new Error('This account has too many subscriptions for one import. No follows were changed.');
  const url=new URL('https://www.googleapis.com/youtube/v3/subscriptions');
  url.search=new URLSearchParams({part:'snippet',mine:'true',maxResults:'50',...(pageToken?{pageToken}:{})}).toString();
  const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal,cache:'no-store',redirect:'error'});
  if(!response.ok){let data;try{data=await response.json();}catch{}const reason=data?.error?.errors?.[0]?.reason;
   throw new Error(response.status===401?'YouTube access expired. Connect again.':reason==='quotaExceeded'||reason==='dailyLimitExceeded'?'YouTube’s daily API quota has been reached. Try again tomorrow.':reason==='youtubeSignupRequired'?'Choose a Google account with a YouTube channel.':'Could not read YouTube subscriptions. Check permission and try again.');
  }
  const data=await response.json();if(!Array.isArray(data.items))throw new Error('YouTube returned an invalid subscription list. Try again.');
  for(const item of data.items){const id=item?.snippet?.resourceId?.channelId;if(/^UC[\w-]{22}$/.test(id||''))ids.add(id);}
  onProgress(ids.size);pageToken=data.nextPageToken||'';
  if(pageToken&&pages.has(pageToken))throw new Error('YouTube pagination stalled. No follows were changed.');
  pages.add(pageToken);
 }while(pageToken);
 return [...ids];
}
