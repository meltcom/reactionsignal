import {seconds} from './discovery.mjs';
import {videoFormat} from './video-format.mjs';

export const PILOT_LIMIT=12;
export function validateRecoveryRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>PILOT_LIMIT)throw Error('Provide 1–12 explicitly selected pilot records.');
 const seen=new Set();
 for(const row of rows){
  if(!row||!/^[\w-]{11}$/.test(row.id)||!/^UC[\w-]{22}$/.test(row.channel_id))throw Error('Each pilot record needs valid video and expected channel IDs.');
  if(seen.has(row.id))throw Error('Duplicate pilot video IDs are not permitted.');seen.add(row.id);
  if(row.performer_id!=='missioned-souls'||row.performer_status!=='active'||!['CONFIRMED','PROBABLE'].includes(row.match_status)||row.format!=='UNKNOWN'||row.available!==1||row.format_locked!==0||row.excluded!==0)throw Error('Pilot records must be active, approved, available, unlocked and non-excluded Missioned Souls UNKNOWN videos.');
 }
 return rows;
}

// No database handle or apply mode: only a bounded YouTube read and proposals.
export async function previewFormatRecovery(rows,{apiKey,fetcher=fetch}={}){
 validateRecoveryRows(rows);
 if(typeof apiKey!=='string'||!apiKey.trim())throw Error('YouTube API key is not configured.');
 const url=new URL('https://www.googleapis.com/youtube/v3/videos');
 url.searchParams.set('part','snippet,contentDetails,status,player');
 url.searchParams.set('maxWidth','480');url.searchParams.set('id',rows.map(row=>row.id).join(','));
 let response;
 try{response=await fetcher(url,{headers:{'X-Goog-Api-Key':apiKey},redirect:'error',signal:AbortSignal.timeout(15000)});}
 catch{throw Error('YouTube metadata request could not finish; no preview was produced.');}
 if(!response.ok)throw Error('YouTube metadata request failed (HTTP '+response.status+'); no preview was produced.');
 let data;try{data=await response.json();}catch{throw Error('YouTube metadata response was not valid JSON.');}
 if(!Array.isArray(data.items))throw Error('YouTube metadata response did not contain an items list.');
 const requested=new Set(rows.map(row=>row.id)),items=new Map();
 for(const item of data.items){
  if(!item||!requested.has(item.id)||items.has(item.id))throw Error('YouTube response contains unexpected or duplicate video IDs.');
  items.set(item.id,item);
 }
 const records=rows.map(row=>{
  const item=items.get(row.id),duration=seconds(item?.contentDetails?.duration);
  let outcome='not_returned',proposedFormat='UNKNOWN';
  if(item){
   if(item.status?.privacyStatus!=='public')outcome='not_public';
   else if(item.snippet?.channelId!==row.channel_id)outcome='channel_mismatch';
   else{
    proposedFormat=videoFormat(item,duration);
    outcome=proposedFormat!=='UNKNOWN'?'proposed':!Number.isFinite(duration)||duration<=0?'missing_duration':'insufficient_format_evidence';
   }
  }
  return {id:row.id,title:item?.snippet?.title||row.title||row.id,outcome,proposedFormat,before:{channelId:row.channel_id,format:row.format,formatLocked:row.format_locked,available:row.available,matchStatus:row.match_status,matchSource:row.match_source,performerStatus:row.performer_status,excluded:row.excluded},evidence:item?{channelId:item.snippet?.channelId||null,privacy:item.status?.privacyStatus||null,publishedAt:item.snippet?.publishedAt||null,duration,playerWidth:item.player?.embedWidth??null,playerHeight:item.player?.embedHeight??null}:null};
 });
 return {schema:1,mode:'fresh-preview-only',fetchedAt:new Date().toISOString(),apiCalls:1,requested:rows.length,proposed:records.filter(row=>row.outcome==='proposed').length,unresolved:records.filter(row=>row.outcome!=='proposed').length,notice:'No database writes. Re-read current database guards and review these proposals before any future apply operation.',records};
}
