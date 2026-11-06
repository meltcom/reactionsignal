const key='member-feed-countdown';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export function countdownSettings(input){
 if(!input||typeof input.enabled!=='boolean')throw Error('Choose whether the countdown is on.');
 const field=(name,max)=>{const value=input[name];if(typeof value!=='string'||value.trim().length>max)throw Error(`Invalid ${name}.`);return value.trim();};
 const title=field('title',100),message=field('message',200),link=field('link',1000),start=field('start',32);
 if(start&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(start)||!Number.isFinite(Date.parse(start))||new Date(start).toISOString()!==start))throw Error('Choose a valid start date and time.');
 if(input.enabled&&(!title||!start||!message))throw Error('Enter a title, start time, and message to turn on the countdown.');
 if(link){let url;try{url=new URL(link);}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Enter an HTTP or HTTPS link without credentials.');}
 return {enabled:input.enabled,title,start,link,message};
}
export async function countdown(request,db,user,moderatorRoute){
 if(moderatorRoute&&!user?.moderator)return json({error:'Moderator access required.'},403);
 if(request.method==='GET'){
  const row=await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first();
  const settings=row?JSON.parse(row.value):{enabled:false,title:'',start:'',link:'',message:''};
  return json(moderatorRoute||settings.enabled?settings:{enabled:false});
 }
 if(!moderatorRoute||request.method!=='PUT')return json({error:'Method not allowed.'},405);
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json({error:'JSON required.'},415);
 let settings;try{const body=await request.text();if(body.length>4096)return json({error:'Settings are too long.'},413);settings=countdownSettings(JSON.parse(body));}catch(error){return json({error:error instanceof SyntaxError?'Invalid JSON.':error.message},400);}
 await db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(settings)).run();
 return json(settings);
}
