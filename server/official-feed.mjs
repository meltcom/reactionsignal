import {readMissionedSouls} from './missioned-souls.mjs';
export const OFFICIAL_CHANNEL='UCeTfwcnUVurw7Qrk_KF5Idw';
// Feed projection only: official uploads never become reaction matches here.
export async function officialFeedVideos(db,seed,now=Date.now()){
 const collection=await readMissionedSouls(db,seed);
 return collection.videos.filter(v=>v.available!==false&&v.platform==='YouTube'&&/^[\w-]{11}$/.test(v.youtubeId||'')&&v.publishedAt&&Number.isFinite(Date.parse(v.publishedAt))&&Date.parse(v.publishedAt)<=now).map(v=>({id:v.youtubeId,performerId:'missioned-souls',channelId:OFFICIAL_CHANNEL,channelName:'Missioned Souls',title:v.title,publishedAt:v.publishedAt,discoveredAt:v.publishedAt,videoUrl:v.url,views:v.views,likes:v.likes,comments:v.comments,youtubeComments:v.comments,format:v.tags?.includes('Shorts')?'SHORT':'FULL_LENGTH',confidence:'CONFIRMED',source:'MS Journey',isOfficial:true}));
}
