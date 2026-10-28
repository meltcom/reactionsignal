export const categories=['Community finds','Live Concerts','Home Studio','All Vlogs','Location Vlogs','Equipment Vlogs','Birthday Vlogs','Solo performances','Shorts','Songs','Handuraw gigs','Jcobs gigs','Living Room performances','Porch performances','Christmas videos','Christian videos','OPM'];
export function suggestCategories(title){
 const t=title.toLowerCase(),tags=[];
 const rules={'Live Concerts':/concert|live in|live at|tour performance/,'Home Studio':/studio/,'All Vlogs':/vlog|unboxing|birthday|celebrating|in dumaguete/,'Location Vlogs':/vlog.*(?:in |trip|travel)|in dumaguete/,'Equipment Vlogs':/unboxing|equipment|gear|pedal|rig|play button/,'Birthday Vlogs':/birthday|celebrating.*today/,'Solo performances':/solo/,'Shorts':/#shorts|\bshorts\b/,'Songs':/cover| by |official music|official video/,'Handuraw gigs':/handuraw/,'Jcobs gigs':/jcobs|j.?cob.?s/,'Living Room performances':/living room/,'Porch performances':/porch/,'Christmas videos':/christmas|silent night|jingle bells/,'Christian videos':/christian|worship|praise|gospel/,'OPM':/\bopm\b|original pilipino/};
 for(const [tag,re] of Object.entries(rules))if(re.test(t))tags.push(tag);
 if(tags.some(x=>x.endsWith('Vlogs'))&&!tags.includes('All Vlogs'))tags.push('All Vlogs');return tags;
}
export function normalizeVideo(v,allowedCategories=categories){
 if(!v||typeof v.title!=='string'||!v.title.trim()||v.title.length>500)throw new Error('A video needs a title (up to 500 characters).');
 let u;try{u=new URL(v.url);}catch{throw new Error('Use a valid HTTPS video URL.');}
 if(u.protocol!=='https:'||u.username||u.password)throw new Error('Use a valid HTTPS video URL.');
 const youtube=['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname);
 const facebook=['facebook.com','www.facebook.com','m.facebook.com','fb.watch','www.fb.watch'].includes(u.hostname);
 const platform=youtube?'YouTube':facebook?'Facebook':'Other';
 const ytId=youtube?(u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|live)\/([-\w]{11})/)?.[1]):null;
 if(youtube&&!/^[-\w]{11}$/.test(ytId||''))throw new Error('Use an individual YouTube watch, Shorts, or live video URL.');
 u.hash='';
 const id=youtube?'yt:'+ytId:platform.toLowerCase()+':'+u.href;
 const num=k=>v[k]==null||v[k]===''?null:Number.isSafeInteger(Number(v[k]))&&Number(v[k])>=0?Number(v[k]):(()=>{throw new Error('Statistics must be nonnegative whole numbers.');})();
 const date=k=>!v[k]?null:Number.isFinite(Date.parse(v[k]))?new Date(v[k]).toISOString():(()=>{throw new Error('Use a valid date.');})();
 const thumbnail=()=>{if(v.thumbnailUrl==null||v.thumbnailUrl==='')return null;const value=String(v.thumbnailUrl);if(value.startsWith('/api/missioned-souls/thumbnails/')&&/^\/api\/missioned-souls\/thumbnails\/[a-f0-9-]{36}$/.test(value))return value;let image;try{image=new URL(value);}catch{throw new Error('Use a valid HTTPS thumbnail URL.');}if(image.protocol!=='https:'||image.username||image.password)throw new Error('Use a valid HTTPS thumbnail URL.');image.hash='';return image.href;};
 const duration=v.durationSeconds==null||v.durationSeconds===''?null:Number.isFinite(Number(v.durationSeconds))&&Number(v.durationSeconds)>=0&&Number(v.durationSeconds)<=86400?Math.round(Number(v.durationSeconds)):(()=>{throw new Error('Duration must be between 0 and 86,400 seconds.');})();
 const statsPrecision=v.statsPrecision==null||v.statsPrecision===''?'unknown':String(v.statsPrecision);if(!['exact','rounded','unknown'].includes(statsPrecision))throw new Error('Statistics precision must be exact, rounded, or unknown.');
 if(v.tags!=null&&(!Array.isArray(v.tags)||v.tags.some(t=>!allowedCategories.includes(t)&&!/^year:\d{4}$/.test(t))))throw new Error('Choose categories from the catalog list.');
 return {visibility:['hidden','removed'].includes(v.visibility)?v.visibility:'visible',id,title:v.title.trim(),url:youtube?'https://www.youtube.com/watch?v='+ytId:u.href,platform,youtubeId:ytId,publishedAt:date('publishedAt'),thumbnailUrl:thumbnail(),durationSeconds:duration,statsAt:date('statsAt'),views:num('views'),likes:num('likes'),comments:num('comments'),statsPrecision,statsSource:String(v.statsSource||'').slice(0,200),tags:v.tags||suggestCategories(v.title),shortsOverride:typeof v.shortsOverride==='boolean'?v.shortsOverride:null,reviewed:!!v.reviewed,available:v.available!==false,youtubeEquivalent:!!v.youtubeEquivalent,sourceNote:String(v.sourceNote||'').slice(0,500)};
}
export function classifyShort(v,isShort){
 if(typeof isShort!=='boolean')throw new Error('Choose whether this video is a Short.');
 return {...v,tags:[...(v.tags||[]).filter(t=>t!=='Shorts'),...(isShort?['Shorts']:[])],shortsOverride:isShort};
}
export function viewGain(v,days,now=Date.now()){
 const end=Date.parse(v.statsAt),target=end-days*86400000;
 if(v.views==null||!Number.isFinite(end)||now-end>2*86400000)return null;
 // Require a baseline within six hours of the window boundary. Never substitute lifetime totals.
 const candidates=(v.history||[]).filter(s=>s.views!=null&&Math.abs(Date.parse(s.at)-target)<=6*3600000).sort((a,b)=>Math.abs(Date.parse(a.at)-target)-Math.abs(Date.parse(b.at)-target));
 if(!candidates.length||v.views<candidates[0].views)return null;return v.views-candidates[0].views;
}
const inCategory=(video,category)=>category==='All videos'||(category==='Facebook only'?video.platform==='Facebook'&&!video.youtubeEquivalent:category==='YouTube only'?video.platform==='YouTube':(video.tags||[]).includes(category));
export function selectVideos(videos,{category='All videos',source='all',query='',includeShorts=true,ranking='latest',year='all',visibility='visible'}={},now=Date.now()){
 videos=videos.filter(v=>visibility==='managed'?['hidden','removed'].includes(v.visibility):!['hidden','removed'].includes(v.visibility));
 videos=videos.filter(v=>year==='all'||(year==='unknown'?!Number.isFinite(Date.parse(v.publishedAt||'')):Number.isFinite(Date.parse(v.publishedAt||''))&&String(new Date(v.publishedAt).getUTCFullYear())===year));
 let list=videos.filter(v=>visibility==='managed'||v.available!==false).filter(v=>inCategory(v,category)).filter(v=>source==='all'||v.platform===source).filter(v=>includeShorts||!(v.tags||[]).includes('Shorts')).filter(v=>v.title.toLowerCase().includes(query.toLowerCase()));
 const windows={day:1,week:7,month:30};
 const metric=v=>windows[ranking]?viewGain(v,windows[ranking],now):ranking==='latest'||ranking==='recent'?Date.parse(v.publishedAt):v[ranking];
 list=list.filter(v=>metric(v)!=null&&Number.isFinite(metric(v))).sort((a,b)=>metric(b)-metric(a)||a.id.localeCompare(b.id));
 if(ranking==='latest'){
  const unknown=videos.filter(v=>(visibility==='managed'||v.available!==false)&&!v.publishedAt).filter(v=>inCategory(v,category)).filter(v=>source==='all'||v.platform===source).filter(v=>includeShorts||!(v.tags||[]).includes('Shorts')).filter(v=>v.title.toLowerCase().includes(query.toLowerCase()));list.push(...unknown);
 }
 return ['recent','views','likes','comments','day','week','month'].includes(ranking)?list.slice(0,10):list;
}
