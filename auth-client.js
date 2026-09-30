import {createClient} from '@supabase/supabase-js';

let client=null, account=null, lastAccountId=null;
const dialog=document.getElementById('signInDialog');
const status=document.getElementById('signInStatus');
const button=document.getElementById('accountButton');
const emailForm=document.getElementById('emailSignIn');
const googleButton=document.getElementById('googleSignIn');
const signOutButton=document.getElementById('signOut');
const welcome=document.getElementById('welcome');
const memberApp=document.getElementById('memberApp');
function paint(){
  welcome.hidden=!!account;
  memberApp.hidden=!account;
  memberApp.inert=!account;
  document.body.classList.toggle('signed-out',!account);
  if(!account)document.body.removeAttribute('data-theme');
  button.textContent=account?account.moderator?'Moderator · '+account.email:account.email:'Sign in';
  signOutButton.hidden=!account;
  document.getElementById('accountStatus').textContent=account?`Signed in as ${account.email}${account.moderator?' · Moderator':''}.`:'';
  if(!account)document.querySelectorAll('dialog[open]').forEach(d=>d.close());
}
function lock(message){account=null;paint();status.textContent=message;}
async function verify(){
  const oldId=account?.id||lastAccountId;
  const {data}=await client.auth.getSession();
  account=null;
  if(data.session){
    const response=await fetch('/api/auth/me',{headers:{Authorization:`Bearer ${data.session.access_token}`},cache:'no-store'});
    if(response.ok)account=await response.json();
    else if(response.status===401||response.status===403){await client.auth.signOut();status.textContent='Please sign in again to continue.';}
    else status.textContent='We couldn’t verify your sign-in. Please reload to retry.';
  }
  paint();
  if(oldId&&oldId!==account?.id){location.replace('/');return;}
  lastAccountId=account?.id||lastAccountId;
  if(oldId!==account?.id)window.dispatchEvent(new Event('reaction-auth-change'));
  return account;
}
const ready=(async()=>{
  paint();
  try{
    const response=await fetch('/api/auth/config',{cache:'no-store'});
    if(!response.ok)throw new Error('Sign-in is temporarily unavailable. Please try again later.');
    const config=await response.json();
    if(!config.url||!config.key)throw new Error('Sign-in will be available soon. Please check back.');
    client=createClient(config.url,config.key,{auth:{detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
    await verify();
    emailForm.querySelectorAll('input,button').forEach(e=>e.disabled=false);
    googleButton.disabled=false;
    if(!status.textContent.includes('again')&&!status.textContent.includes('couldn’t'))status.textContent='We’ll email you a one-time link. No password needed.';
    client.auth.onAuthStateChange(()=>{setTimeout(()=>verify().catch(()=>lock('We couldn’t verify your sign-in. Please reload to retry.')),0);});
  }catch(error){lock(error.message);}
})();
async function getAccessToken(){await ready;if(!account)return null;return (await client.auth.getSession()).data.session?.access_token||null;}
function showSignIn(){if(account)dialog.showModal();else{welcome.scrollIntoView({block:'start'});emailForm.elements.email.focus();}}
window.reactionAuth={ready,getAccessToken,showDialog:showSignIn,get account(){return account;},async fetch(url,options={}){
  const token=await getAccessToken();
  if(!token){showSignIn();throw new Error('Sign in with email or Google to continue.');}
  const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${token}`);
  const response=await fetch(url,{...options,headers});
  if(response.status===401)lock('Your sign-in has expired. Please sign in again.');
  return response;
}};
button.onclick=showSignIn;
document.getElementById('closeSignIn').onclick=()=>dialog.close();
emailForm.onsubmit=async event=>{
  event.preventDefault();await ready;if(!client)return;
  const submit=emailForm.querySelector('button');submit.disabled=true;
  try{
    const {error}=await client.auth.signInWithOtp({email:emailForm.elements.email.value.trim(),options:{emailRedirectTo:location.origin+'/'}});
    if(error)throw error;
    status.textContent='Check your email for a sign-in link. Open it on this device to continue.';
  }catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
};
googleButton.onclick=async()=>{
  await ready;if(!client)return;googleButton.disabled=true;
  try{const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'}});if(error)throw error;}
  catch(error){status.textContent=error.message;googleButton.disabled=false;}
};
signOutButton.onclick=async()=>{
  signOutButton.disabled=true;
  try{const {error}=await client.auth.signOut();if(error)throw error;lock('Signed out.');location.replace('/');}
  catch(error){document.getElementById('accountStatus').textContent=error.message;signOutButton.disabled=false;}
};
