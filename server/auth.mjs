const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

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
  let response;
  try{response=await fetchUser(`${config.url}/auth/v1/user`,{headers:{apikey:config.key,Authorization:`Bearer ${match[1]}`},redirect:'manual'});}
  catch{return {error:json({error:'Sign-in verification is temporarily unavailable.'},503)};}
  if(!response.ok)return {error:json({error:'Your sign-in has expired. Please sign in again.'},401)};
  let profile;try{profile=await response.json();}catch{return {error:json({error:'Sign-in verification failed.'},503)};}
  if(typeof profile.id!=='string'||!profile.id||typeof profile.email!=='string'||!profile.email_confirmed_at)
    return {error:json({error:'Confirm your email before participating.'},403)};
  const email=profile.email.trim().toLowerCase();
  const allowlist=String(env.MEMBER_EMAIL_ALLOWLIST||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(allowlist.length&&!allowlist.includes(email))return {error:json({error:'Reaction Signal is currently limited to invited members.'},403)};
  const moderators=String(env.COMMUNITY_MODERATOR_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return {user:{id:`supabase:${profile.id}`,email,moderator:moderators.includes(email)}};
}
