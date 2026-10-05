let lastPresencePing=0,presenceBusy=false;
async function pingSitePresence(){
 if(document.visibilityState!=='visible'||$('memberApp').hidden||document.body.classList.contains('signed-out')||presenceBusy||Date.now()-lastPresencePing<90000)return;
 presenceBusy=true;lastPresencePing=Date.now();try{await communityApi('/presence',{});}catch{}finally{presenceBusy=false;}
}
setInterval(pingSitePresence,120000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pingSitePresence();});
window.addEventListener('reaction-auth-change',()=>{lastPresencePing=0;pingSitePresence();});
// Log intent; do not wait for telemetry before opening a video or external tab.
document.addEventListener('click',e=>{
 if(document.body.classList.contains('signed-out'))return;
 let id,action;
 const details=e.target.closest('[data-community-video]');
 if(details){id=details.dataset.communityVideo;action='details';}
 else if(e.target.closest('#loadPreview')){id=activeCommunityVideo?.id;action='preview';}
 else{const a=e.target.closest('a[href]');if(a){try{const u=new URL(a.href);if(['www.youtube.com','youtube.com'].includes(u.hostname)&&u.pathname==='/watch'){id=u.searchParams.get('v');action='youtube';}}catch{}}}
 if(id&&/^[\w-]{11}$/.test(id))communityApi('/video-click',{videoId:id,action}).catch(()=>{});
},true);
pingSitePresence();
