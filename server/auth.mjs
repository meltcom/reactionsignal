const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const verifiedReads=new Map(),pendingReads=new Map();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function authConfig(env){
  const url=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.SUPABASE_PUBLISHABLE_KEY||'');
  try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!key)return null;}
  catch{return null;}
  return {url,key};
}

export async function authenticate(request,env,fetchUser=fetch){
  const config=authConfig(env);
  if(!config)return {error:json({error:'Member sign-in is being configured.'},503)};
  const header=request.headers.get('Authorization')||'';
  const match=/^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  if(!match)return {error:json({error:'Sign in to participate.'},401)};
  // Cache only successful confirmed identities; never cache writes or staff access.
  // A 30-second bound preserves remote revocation checks without custom JWT logic.
  const read=request.method==='GET'&&!new URL(request.url).pathname.startsWith('/api/auth/');
  const cacheable=read&&fetchUser===fetch;
  const digest=cacheable?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(match[1]))),b=>b.toString(16).padStart(2,'0')).join(''):null;
  const cacheKey=digest?`${config.url}:${config.key}:${env.MEMBER_EMAIL_ALLOWLIST||''}:${env.COMMUNITY_MODERATOR_EMAILS||''}:${digest}`:null;
  const old=cacheKey&&verifiedReads.get(cacheKey);
  if(old&&old.until>Date.now())return {user:{...old.user}};
  if(cacheKey&&pendingReads.has(cacheKey)){const result=await pendingReads.get(cacheKey);return result.error?{error:result.error.clone()}:{user:{...result.user}};}
  const verify=async()=>{
  let response;
  try{response=await fetchUser(`${config.url}/auth/v1/user`,{headers:{apikey:config.key,Authorization:`Bearer ${match[1]}`},redirect:'manual',signal:AbortSignal.timeout(5000)});}
  catch{return {error:json({error:'Sign-in verification is temporarily unavailable.'},503)};}
  if(response.status===429||response.status>=500)return {error:json({error:'Sign-in verification is temporarily busy. Please retry shortly.'},503)};
  if(!response.ok)return {error:json({error:'Your sign-in has expired. Please sign in again.'},401)};
  let profile;try{profile=await response.json();}catch{return {error:json({error:'Sign-in verification failed.'},503)};}
  if(typeof profile.id!=='string'||!profile.id||typeof profile.email!=='string'||!profile.email_confirmed_at)
    return {error:json({error:'Confirm your email before participating.'},403)};
  const email=profile.email.trim().toLowerCase();
  const allowlist=String(env.MEMBER_EMAIL_ALLOWLIST||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(allowlist.length&&!allowlist.includes(email))return {error:json({error:'Reaction Journey is currently limited to invited members.'},403)};
  const moderators=String(env.COMMUNITY_MODERATOR_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const user={id:`supabase:${profile.id}`,email,moderator:moderators.includes(email)};
  if(cacheKey&&!user.moderator){
    let until=Date.now()+30000;
    // Expiry only shortens a remotely verified identity's TTL; it never establishes identity.
    try{const claim=JSON.parse(atob(match[1].split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(Number.isFinite(claim.exp))until=Math.min(until,claim.exp*1000);}catch{until=Date.now();}
    if(uuid.test(profile.id)&&until>Date.now()){
      if(verifiedReads.size>=1000)verifiedReads.delete(verifiedReads.keys().next().value);
      verifiedReads.set(cacheKey,{user,until});
    }
  }
  return {user};
  };
  const task=verify();if(cacheKey)pendingReads.set(cacheKey,task);
  try{return await task;}finally{if(cacheKey)pendingReads.delete(cacheKey);}
}
