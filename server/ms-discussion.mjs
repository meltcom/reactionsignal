// Archive IDs stay distinct from YouTube reaction IDs and never enter the reaction feed.
export const isFacebookDiscussion=id=>typeof id==='string'&&id.startsWith('facebook:https://');
export async function facebookDiscussion(db,seed,id){
 if(!isFacebookDiscussion(id))return null;
 const saved=await db.prepare('SELECT value FROM state WHERE key=?').bind('ms-video:'+id).first();
 const video=saved?JSON.parse(saved.value):(seed.missionedSouls?.videos||[]).find(v=>v.id===id);
 const visibility=await db.prepare('SELECT value FROM state WHERE key=?').bind('ms-visibility:'+id).first();
 if(!video||video.platform!=='Facebook'||video.youtubeEquivalent||video.available===false||(visibility?JSON.parse(visibility.value).visibility:video.visibility||'visible')!=='visible')return null;
 return video;
}
