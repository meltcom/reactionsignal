function reviewSectionOpen(id){return document.getElementById('review')?.hidden===false&&document.getElementById(id)?.open===true;}
async function loadNotificationService(){
 const data=await performerApi('/notifications?service=1'),push=data.push;
 $('pushServiceStatus').textContent=!push.configured?'Upload notifications need a public endpoint before they can connect.':!push.apiConfigured?'Upload notifications need YouTube API access before videos can be checked.':`${push.active} of ${push.total} channel notifications connected · ${push.queued} uploads queued · ${push.expiring||0} leases expire within 24h${push.errors?' · '+push.errors+' connection errors':''}${push.lastReceivedAt?' · Last notification '+new Date(push.lastReceivedAt).toLocaleString():''}`;
 $('connectPush').disabled=!push.configured||!push.apiConfigured;
}
async function loadOpenModeratorSection(section){
 if(!communityState?.moderator||!reviewSectionOpen(section.id))return;
 try{
  if(section.id==='reviewDiscoveries')await loadAutomaticAdditions();
  if(section.id==='reviewMembers')await loadReviewQueue();
  if(section.id==='reviewReports')await renderAbuse();
  if(section.id==='reviewHistory'){await Promise.all([loadSubmissionHistory(),loadShortRecovery()]);}
  if(section.id==='reviewTools')await Promise.all([loadPerformerManager(),loadRecheckStatus(),loadNotificationService()]);
 }catch(e){notice(e.message);}
}
async function refreshModeratorQueue(){
 if(!communityState?.moderator)return;
 await loadAutomaticAdditions(true);
 const section=document.querySelector('#review > .review-section[open]');if(section)await loadOpenModeratorSection(section);
}
document.querySelectorAll('#review > .review-section').forEach(section=>{
 section.addEventListener('toggle',()=>{
  if(!section.open)return;
  document.querySelectorAll('#review > .review-section').forEach(other=>{if(other!==section)other.open=false;});
  loadOpenModeratorSection(section);
 });
 section.querySelector('[data-close-review]').onclick=()=>{section.open=false;section.querySelector('summary').focus();};
});
$('submissionHistoryPanel').addEventListener('toggle',()=>{if($('submissionHistoryPanel').open)loadSubmissionHistory();});
$('shortRecovery').addEventListener('toggle',()=>{if($('shortRecovery').open)loadShortRecovery();});
window.addEventListener('reaction-auth-change',()=>{document.querySelectorAll('#review details').forEach(section=>section.open=false);});
