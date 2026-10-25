import {explicitShort} from './approval-rules.mjs';

// Player dimensions are returned only when the API knows the video's aspect ratio
// and videos.list supplies maxWidth/maxHeight. Thumbnail sizes are not video sizes.
export function videoFormat(item,duration){
 if(!Number.isFinite(duration)||duration<=0)return 'UNKNOWN';
 if(duration>180)return 'FULL_LENGTH';
 if(item.snippet?.liveBroadcastContent==='live'||item.liveStreamingDetails)return 'FULL_LENGTH';
 const width=Number(item.player?.embedWidth),height=Number(item.player?.embedHeight);
 if(width>0&&height>0){
  if(width>height)return 'FULL_LENGTH';
  const published=Date.parse(item.snippet?.publishedAt);
  if(duration<=60||published>=Date.parse('2024-10-15T00:00:00Z'))return 'SHORT';
  return 'UNKNOWN';
 }
 return explicitShort(item.snippet?.title)||explicitShort(item.snippet?.description)?'SHORT':'UNKNOWN';
}
