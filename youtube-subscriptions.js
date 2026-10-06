import {youtubeScope,matchSubscriptions,readSubscriptions} from './youtube-subscriptions-core.js';
const mount=document.createElement('section');mount.className='panel';
mount.innerHTML='<h2>Import YouTube subscriptions</h2><p>Connect YouTube to find reactors you already subscribe to. Review matches before adding them to this Reaction Journey account. Choose the Google account and YouTube channel whose subscriptions you want to import.</p><p class="subtle">Read-only, one-time import. Existing follows and hidden reactors are preserved. Only selected reactor IDs are saved; your full subscription list and Google access token are not stored by Reaction Journey. Manage Google permission at <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener">Google account connections</a>.</p><button type="button" class="primary-button" id="prepareYoutubeImport">Import YouTube subscriptions</button> <button type="button" class="outline-button" id="connectYoutubeImport" hidden>Connect YouTube</button> <button type="button" class="outline-button" id="cancelYoutubeImport" hidden>Cancel</button><p id="youtubeImportStatus" role="status" aria-live="polite"></p><form id="youtubeImportForm" hidden><div id="youtubeImportMatches"></div><p class="subtle">Select up to 100 reactors per import.</p><button type="submit" class="primary-button">Follow selected reactors</button></form>';
document.getElementById('reactorGrid').before(mount);
const el=id=>document.getElementById(id),prepare=el('prepareYoutubeImport'),connect=el('connectYoutubeImport'),cancel=el('cancelYoutubeImport'),status=el('youtubeImportStatus'),form=el('youtubeImportForm');
let generation=0,controller=null,client=null,subscriptionIds=[],owner=null,loadingLibrary=null;
const message=text=>{status.textContent=text;};
function reset(){generation++;controller?.abort();controller=null;client=null;subscriptionIds=[];owner=null;form.hidden=true;el('youtubeImportMatches').replaceChildren();connect.hidden=true;cancel.hidden=true;prepare.disabled=false;message('');}
function loadGoogle(){if(window.google?.accounts?.oauth2)return Promise.resolve();if(loadingLibrary)return loadingLibrary;
 loadingLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;let timer=setTimeout(()=>{script.remove();loadingLibrary=null;reject(new Error('Google connection timed out. Try again.'));},15000);script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();loadingLibrary=null;reject(new Error('Could not load Google connection. Check your browser settings and try again.'));};document.head.append(script);});return loadingLibrary;
}
function paintPreview(){
 const result=matchSubscriptions(subscriptionIds,catalog.channels,dashboard.follows,dashboard.hiddenReactors);
 const list=el('youtubeImportMatches');list.replaceChildren();
 for(const channel of result.matches){const row=document.createElement('label');row.className='follow-row';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=channel.id;checkbox.checked=list.children.length<100;row.append(checkbox,document.createTextNode(' '+channel.name));list.append(row);}
 form.hidden=!result.matches.length;
 message(`${result.total} subscriptions checked: ${result.matches.length} new reactor matches, ${result.alreadyFollowing} already followed, ${result.hiddenCount} hidden, ${result.unmatched} outside the catalog. Review your selections below.`);
 prepare.disabled=false;connect.hidden=true;
}
prepare.onclick=async()=>{
 reset();const current=generation;owner=reactionAuth.account?.id;if(!owner){reactionAuth.showDialog();return;}prepare.disabled=true;cancel.hidden=false;message('Preparing secure Google connection…');
 try{const r=await reactionAuth.fetch('/api/youtube/subscriptions/config',{cache:'no-store'});const config=await r.json();if(!r.ok)throw new Error(config.error||'Could not prepare import.');if(!config.clientId)throw new Error('YouTube import is awaiting Google configuration. You can still follow reactors manually.');await loadGoogle();if(current!==generation)return;
  client=google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:youtubeScope,include_granted_scopes:false,error_callback:()=>{if(current!==generation)return;connect.disabled=false;message('Google connection was closed or blocked. Try again.');},callback:async response=>{
   if(current!==generation||owner!==reactionAuth.account?.id)return;
   if(response.error||!response.access_token||!google.accounts.oauth2.hasGrantedAllScopes(response,youtubeScope)){connect.disabled=false;message('YouTube read permission was not granted. Connect again to retry.');return;}
   controller=new AbortController();message('Reading YouTube subscriptions…');
   try{subscriptionIds=await readSubscriptions(response.access_token,{signal:controller.signal,onProgress:n=>{if(current===generation)message(`Reading YouTube subscriptions… ${n} channels checked.`);}});if(current!==generation||owner!==reactionAuth.account?.id)return;await refreshDashboard();if(current!==generation)return;paintPreview();}
   catch(error){if(current!==generation)return;connect.disabled=false;prepare.disabled=false;message(error.message);}
   finally{response.access_token='';}
  }});
  connect.hidden=false;connect.disabled=false;message('Ready. Connect YouTube to choose an account and grant read-only permission.');
 }catch(error){if(current===generation){prepare.disabled=false;message(error.message);}}
};
connect.onclick=()=>{if(!client||owner!==reactionAuth.account?.id){reset();return;}connect.disabled=true;message('Complete the Google permission window.');try{client.requestAccessToken({prompt:'select_account'});}catch{connect.disabled=false;message('Could not open Google connection. Please try again.');}};
cancel.onclick=reset;
form.onsubmit=async event=>{
 event.preventDefault();const current=generation;if(owner!==reactionAuth.account?.id){reset();return;}
 const ids=[...form.querySelectorAll('input:checked')].map(i=>i.value);if(!ids.length||ids.length>100){message('Select between 1 and 100 reactors.');return;}
 const button=form.querySelector('button');button.disabled=true;
 try{const r=await reactionAuth.fetch('/api/youtube/subscriptions/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelIds:ids})});const result=await r.json();if(!r.ok)throw new Error(result.error||'Could not import follows.');await refreshDashboard();if(current!==generation)return;paintPreview();message(`${result.added} reactor follows added. ${result.skipped} already followed or hidden. Existing follows were preserved.`);}
 catch(error){if(current===generation)message(error.message);}finally{button.disabled=false;}
};
window.addEventListener('reaction-auth-change',reset);
window.addEventListener('pagehide',reset);
