const facebookHosts=['facebook.com','fb.watch'];
const isFacebookHost=host=>facebookHosts.some(domain=>host===domain||host.endsWith('.'+domain));
const isImageHost=host=>isFacebookHost(host)||host==='fbcdn.net'||host.endsWith('.fbcdn.net');
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};

export function facebookVideoUrl(value){
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.port||url.username||url.password||!isFacebookHost(url.hostname.toLowerCase()))return null;
  const path=url.pathname;
  const valid=(['fb.watch','www.fb.watch'].includes(url.hostname)&&/^\/[\w-]+\/?$/.test(path))
   ||(/^\/(?:watch|reel|videos|share\/(?:r|v))\/?$/.test(path)&&url.searchParams.has('v'))
   ||/^\/(?:[\w.-]+\/videos\/|(?:reel|videos|share\/(?:r|v))\/[\w.-]+)\/?$/.test(path);
  if(!valid)return null;
  url.hash='';
  return url;
 }catch{return null;}
}

async function fetchFollowingRedirects(input,hosts,accept,fetcher){
 let url=new URL(input);
 for(let redirects=0;redirects<=4;redirects++){
  if(!hosts(url.hostname.toLowerCase()))fail('Facebook redirected to an unsupported host.');
  let response;
  try{response=await fetcher(url.href,{redirect:'manual',headers:{Accept:accept},signal:AbortSignal.timeout(8000)});}
  catch{fail('Facebook could not be reached. Try again or enter the details manually.',502);}
  if(response.status>=300&&response.status<400){
   const location=response.headers.get('location');
   if(!location||redirects===4)fail('Facebook redirected too many times. Enter the video details manually.');
   url=new URL(location,url);
   continue;
  }
  return response;
 }
 fail('Facebook redirected too many times. Enter the video details manually.');
}

async function limitedText(response,limit){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>limit)fail('Facebook returned too much page data.');
 if(!response.body){const text=await response.text();if(text.length>limit)fail('Facebook returned too much page data.');return text;}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('Facebook returned too much page data.');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder().decode(bytes);
}
async function limitedBytes(response,limit){
 const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>limit)fail('Facebook returned an oversized thumbnail.');
 if(!response.body){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>limit)fail('Facebook returned an oversized thumbnail.');return bytes;}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('Facebook returned an oversized thumbnail.');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}

function decodeHtml(value){
 return String(value||'').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(all,entity)=>{
  if(entity[0]==='#'){const hex=entity[1]?.toLowerCase()==='x',number=parseInt(entity.slice(hex?2:1),hex?16:10);try{return String.fromCodePoint(number);}catch{return all;}}
  return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'})[entity.toLowerCase()]||all;
 });
}

function durationSeconds(value){
 const text=String(value||'').trim(),iso=text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
 const seconds=iso?Number(iso[1]||0)*3600+Number(iso[2]||0)*60+Number(iso[3]||0):/^\d+$/.test(text)?Number(text):NaN;
 return Number.isSafeInteger(seconds)&&seconds>=0&&seconds<=86400?seconds:null;
}

function pageMetadata(html){
 const meta=new Map();
 for(const [,attributes] of html.matchAll(/<meta\b([^>]{0,4096})>/gi)){
  const values={};for(const [,name,double,single,unquoted] of attributes.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))values[name.toLowerCase()]=double??single??unquoted??'';
  const key=(values.property||values.name||values.itemprop||'').toLowerCase(),content=decodeHtml(values.content||'').trim();
  if(key&&content)meta.set(key,content);
 }
 const title=meta.get('og:title')||meta.get('twitter:title')||null;
 const thumbnail=meta.get('og:image:secure_url')||meta.get('og:image')||meta.get('og:image:url')||meta.get('twitter:image')||meta.get('twitter:image:src')||null;
 const duration=durationSeconds(meta.get('og:video:duration')||meta.get('video:duration')||meta.get('duration')||meta.get('durationSeconds'));
 const published=meta.get('article:published_time')||meta.get('video:release_date')||meta.get('uploadDate')||meta.get('datePublished')||null;
 const metric=keys=>{for(const key of keys){const raw=meta.get(key);if(raw!=null&&/^\d+$/.test(raw))return Number(raw);}return null;};
 const videoPage=(meta.get('og:type')||'').toLowerCase().startsWith('video:')||meta.has('og:video')||meta.has('og:video:url')||meta.has('og:video:secure_url')||duration!==null;
 return {title:title&&title.toLowerCase()!=='facebook'?title:null,thumbnailUrl:thumbnail,durationSeconds:duration,publishedAt:Number.isFinite(Date.parse(published||''))?new Date(published).toISOString():null,views:metric(['video:view_count','og:video:views','video:views']),likes:metric(['video:likes','og:video:likes']),comments:metric(['video:comments','og:video:comments']),videoPage};
}

function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}

export async function fetchFacebookMetadata(value,fetcher=fetch){
 const pageUrl=facebookVideoUrl(value);if(!pageUrl)fail('Use a public Facebook Watch, Reel, or video link.',400);
 const response=await fetchFollowingRedirects(pageUrl,isFacebookHost,'text/html,application/xhtml+xml',fetcher);
 if(!response.ok)fail('Facebook could not provide public video details. Enter them manually.',422);
 const type=(response.headers.get('content-type')||'').toLowerCase();
 if(!type.includes('text/html')&&!type.includes('application/xhtml+xml'))fail('Facebook did not return a public video page.',422);
 const metadata=pageMetadata(await limitedText(response,1_000_000));
 if(!metadata.title&&!metadata.videoPage)fail('Facebook did not expose public video details. Confirm the link is public, then continue with manual details.');
 let thumbnailData=null;
 if(metadata.thumbnailUrl){
  try{
   const imageUrl=new URL(metadata.thumbnailUrl,pageUrl);
   if(imageUrl.protocol==='https:'&&isImageHost(imageUrl.hostname.toLowerCase())){
    const image=await fetchFollowingRedirects(imageUrl,isImageHost,'image/jpeg,image/png,image/webp',fetcher);
    const imageType=(image.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    const size=Number(image.headers.get('content-length'));
    if(image.ok&&['image/jpeg','image/png','image/webp'].includes(imageType)&&(!Number.isFinite(size)||size<=8_000_000)){
     const bytes=await limitedBytes(image,8_000_000);thumbnailData=`data:${imageType};base64,${base64(bytes)}`;
    }
   }
  }catch{}
 }
 const hasMetrics=[metadata.views,metadata.likes,metadata.comments].some(value=>value!=null);
 const {videoPage,...details}=metadata;
 return {...details,thumbnailData,statsAt:hasMetrics?new Date().toISOString():null,statsPrecision:hasMetrics?'unknown':null,statsSource:hasMetrics?'Facebook public page metadata':null};
}
