let managedPerformers=[],selectedDiscoveryPerformer=null,managerLoading=false;
const performerApi=async(path,body)=>{const response=await reactionAuth.fetch('/api/performers'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Please try again.');return data;};
let catalogEtag=null;
window.addEventListener('reaction-auth-change',()=>{catalogEtag=null;});
async function reloadMemberCatalog(){const response=await reactionAuth.fetch('/data.json',{cache:'no-store',headers:catalogEtag?{'If-None-Match':catalogEtag}:{}});if(response.status===304)return;if(!response.ok)throw new Error('Catalog refresh failed. Please reload.');const nextCatalog=await response.json();catalogEtag=response.headers.get('ETag');catalog=nextCatalog;$('performerCount').textContent=catalog.performers.length;if(state.performer!=='all'&&!catalog.performers.some(p=>p.id===state.performer))state.performer=catalog.performers[0]?.id||'all';renderAll();await refreshRooms();}
async function loadPerformerManager(){
 if(!communityState?.moderator||managerLoading)return;managerLoading=true;
 try{
  const result=await performerApi('/list');managedPerformers=result.items;
  $('performerServiceStatus').textContent=result.discovery.message+' Searches share a daily budget and continue in batches.';
  $('managedPerformers').innerHTML=managedPerformers.map(p=>`<article class="managed-performer"><div><strong>${escapeHtml(p.name)}</strong><p class="subtle">${p.status==='active'?'Published':'Draft'} · ${p.discovery_enabled?'Discovery enabled':'Discovery paused'} · ${p.approved} approved · ${p.pending} awaiting review</p><p class="subtle">${p.progress?'Search in progress; more batches queued.':p.last_search?'Last search: '+prettyDate(p.last_search):'First search queued.'}${p.search_error?' · '+escapeHtml(p.search_error):''}</p></div><div class="managed-actions"><button class="outline-button" data-edit-performer="${p.id}">Settings${p.status==='draft'?' & publish':''}</button><button class="outline-button" data-find-performer="${p.id}" ${!p.discovery_enabled||!result.discovery.apiConfigured?'disabled':''}>Find reactions</button><button class="outline-button" data-review-performer="${p.id}">Review results</button></div></article>`).join('');
  $('managedPerformers').insertAdjacentHTML('beforeend','<details class="panel"><summary>Channels held outside routine discovery (up to 50)</summary><p>These records are retained. Verify Missioned Souls evidence before approving pending videos; an approved match enables its channel.</p>'+((result.discovery.heldChannels||[]).map(c=>'<p>'+escapeHtml(c.name)+' · '+escapeHtml(c.id)+' · '+escapeHtml(c.discovery_scope)+'</p>').join('')||'<p>No channels held.</p>')+'</details>');
  $('managedPerformers').querySelectorAll('[data-edit-performer]').forEach(b=>b.onclick=()=>openPerformerEditor(managedPerformers.find(p=>p.id===b.dataset.editPerformer)));
  $('managedPerformers').querySelectorAll('[data-find-performer]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await performerApi('/discover',{id:b.dataset.findPerformer});$('performerManagerStatus').textContent=r.message;await loadDiscoveryResults(b.dataset.findPerformer);await reloadMemberCatalog();}catch(e){$('performerManagerStatus').textContent=e.message;}finally{b.disabled=false;loadPerformerManager();}});
  $('managedPerformers').querySelectorAll('[data-review-performer]').forEach(b=>b.onclick=()=>loadDiscoveryResults(b.dataset.reviewPerformer).catch(e=>$('performerManagerStatus').textContent=e.message));
 }catch(e){$('performerManagerStatus').textContent=e.message;}finally{managerLoading=false;}
}
function openPerformerEditor(performer=null,recommendation=null){
 const form=$('performerForm');form.reset();
 form.elements.id.value=performer?.id||'';form.elements.requestId.value=recommendation?.id||'';
 form.elements.name.value=performer?.name||recommendation?.name||'';
 form.elements.officialUrl.value=performer?.official_url||recommendation?.url||'';
 form.elements.aliases.value=performer?.aliases.filter(a=>a!==performer.name).join('\n')||'';
 form.elements.lookbackDays.value=String(performer?.lookback_days??30);
 form.elements.reviewMode.value=performer?.review_mode||'auto';
 form.elements.status.value=performer?.status||'draft';
 form.elements.discoveryEnabled.checked=performer?!!performer.discovery_enabled:true;
 form.elements.chatEnabled.checked=performer?!!performer.chat_enabled:true;
 $('performerDialogTitle').textContent=performer?'Manage '+performer.name:'Add a band or performer';
 $('performerFormStatus').textContent='';$('performerDialog').showModal();
}
$('addPerformer').onclick=()=>openPerformerEditor();$('closePerformer').onclick=()=>$('performerDialog').close();
$('performerForm').onsubmit=async event=>{
 event.preventDefault();const form=event.currentTarget,buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 const payload={id:form.elements.id.value||undefined,requestId:form.elements.requestId.value||undefined,name:form.elements.name.value,officialUrl:form.elements.officialUrl.value,aliases:form.elements.aliases.value.split('\n').map(a=>a.trim()).filter(Boolean),lookbackDays:Number(form.elements.lookbackDays.value),reviewMode:form.elements.reviewMode.value,status:form.elements.status.value,discoveryEnabled:form.elements.discoveryEnabled.checked,chatEnabled:form.elements.chatEnabled.checked};
 let saved=false;
 try{
  $('performerFormStatus').textContent='Saving coverage profile…';const result=await performerApi('/save',payload);saved=true;form.elements.id.value=result.id;form.elements.requestId.value='';
  let message=result.message;
  if(event.submitter?.value==='discover'&&payload.discoveryEnabled){$('performerFormStatus').textContent='Profile saved. Finding reaction videos…';try{const scan=await performerApi('/discover',{id:result.id});message+=' '+scan.message;}catch(error){message+=' Discovery could not start: '+error.message;}}
  $('performerManagerStatus').textContent=message;$('performerDialog').close();await reloadMemberCatalog();await loadCoverageQueue();await loadPerformerManager();await loadDiscoveryResults(result.id);
 }catch(error){$('performerFormStatus').textContent=(saved?'Profile saved. ':'')+error.message;$('performerManagerStatus').textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}
};
async function loadDiscoveryResults(id){
 selectedDiscoveryPerformer=id;const result=await performerApi('/results?id='+encodeURIComponent(id));
 if(selectedDiscoveryPerformer!==id)return;
 $('performerResults').hidden=false;$('selectDiscoveryResults').checked=false;
 $('performerResultsTitle').textContent='Discovery results · '+(managedPerformers.find(p=>p.id===id)?.name||'Performer');
 $('discoveryResultsList').innerHTML=result.items.length?result.items.map(v=>`<article class="discovery-result"><label class="check-label">${escapeHtml(v.title)}<input type="checkbox" data-discovery-video="${escapeHtml(v.video_id)}" data-pending="${v.status==='PENDING'}" ${v.status==='REJECTED'?'disabled':''}></label><p class="subtle">${escapeHtml(v.channel_name||'Unknown reactor')} · ${prettyDate(v.published_at)} · ${{PENDING:'Awaiting review',CONFIRMED:'Approved',PROBABLE:'Probable',REJECTED:'Excluded'}[v.status]||escapeHtml(v.status)}${v.format!=='FULL_LENGTH'?' · Check length / Shorts':''}${!v.available?' · Video unavailable':''}</p><a href="https://www.youtube.com/watch?v=${escapeHtml(v.video_id)}" target="_blank" rel="noopener noreferrer">Open video on YouTube</a></article>`).join(''):'<p class="empty-state">No matches yet. Use Find reactions, or wait for the next scheduled batch.</p>';
}
$('selectDiscoveryResults').onchange=event=>[...$('discoveryResultsList').querySelectorAll('input[data-pending="true"]')].forEach((input,index)=>input.checked=event.target.checked&&index<50);
async function reviewDiscovery(decision){
 const videos=[...$('discoveryResultsList').querySelectorAll('input:checked[data-discovery-video]')].map(e=>e.dataset.discoveryVideo);
 if(!videos.length){$('performerManagerStatus').textContent='Select at least one result to review.';return;}
 if(videos.length>50){$('performerManagerStatus').textContent='Review up to 50 results at a time.';return;}
 $('approveDiscovery').disabled=$('excludeDiscovery').disabled=$('markShortDiscovery').disabled=true;
 try{const result=await performerApi(decision==='short'?'/mark-short':'/review',{id:selectedDiscoveryPerformer,videos,decision});$('performerManagerStatus').textContent=result.message;await loadPerformerManager();await loadDiscoveryResults(selectedDiscoveryPerformer);await reloadMemberCatalog();}catch(e){$('performerManagerStatus').textContent=e.message;}finally{$('approveDiscovery').disabled=$('excludeDiscovery').disabled=$('markShortDiscovery').disabled=false;}
}
$('approveDiscovery').onclick=()=>reviewDiscovery('approve');$('excludeDiscovery').onclick=()=>reviewDiscovery('exclude');
setInterval(()=>{if(!document.hidden&&page==='review'&&reactionAuth.account?.moderator)loadPerformerManager();},60000);

let additionsLoading=false;
async function loadAutomaticAdditions(summaryOnly=false,force=false){
 if(!reactionAuth.account?.moderator||additionsLoading)return;additionsLoading=true;
 try{
  const data=await performerApi('/notifications'+(summaryOnly?'?summary=1':'?group='+encodeURIComponent($('reviewGroup').value)));
  $('discoveryNoticeBadge').textContent=data.count+data.reports||'';
  if(summaryOnly)return;
  const push=data.push;
  $('pushServiceStatus').textContent=!push.configured?'Upload notifications need a public endpoint before they can connect.':!push.apiConfigured?'Upload notifications need YouTube API access before videos can be checked.':`${push.active} of ${push.total} channel notifications connected · ${push.queued} uploads queued · ${push.expiring||0} leases expire within 24h${push.errors?' · '+push.errors+' connection errors':''}${push.oldestQueuedAt?' · Oldest queued '+new Date(push.oldestQueuedAt).toLocaleString():''}${push.problemChannels?.length?' · '+push.problemChannels.map(c=>c.name+': '+c.error).join('; '):''}${push.lastReceivedAt?' · Last notification '+new Date(push.lastReceivedAt).toLocaleString():''}`;
  $('connectPush').disabled=!push.configured||!push.apiConfigured;
  if(!force&&(document.activeElement?.closest('#automaticAdditions')||document.querySelector('#automaticAdditions .queue-select:checked')))return;
  await loadShortRecovery();
  await loadRecheckStatus();
  const filtered=data.items.filter(v=>$('reviewGroup').value==='all'||(v.review_group||'unprocessed')===$('reviewGroup').value);
  $('automaticAdditions').innerHTML=filtered.length?filtered.map(v=>`<article class="panel"><label><input type="checkbox" class="queue-select" data-performer="${escapeHtml(v.performer_id)}" data-video="${escapeHtml(v.video_id)}"> Select for bulk review</label><h3>${escapeHtml(v.title)}</h3><p class="subtle">${escapeHtml(v.performer_name)} · ${escapeHtml(v.channel_name||'Unknown reactor')} · Found ${v.created_at?new Date(v.created_at).toLocaleString():'in the historical catalog'}</p><p>Awaiting review - not published${v.format==='SHORT'?' · Classified as Short':''}</p><p class="subtle">${escapeHtml(v.review_reason||'Not yet rechecked.')}</p><a href="https://www.youtube.com/watch?v=${escapeHtml(v.video_id)}" target="_blank" rel="noopener noreferrer">Check video on YouTube</a><form data-addition-performer="${escapeHtml(v.performer_id)}" data-addition-video="${escapeHtml(v.video_id)}"><label>Reason if removing<input name="note" minlength="5" maxlength="500" placeholder="Wrong performer, excerpt, or another issue"></label><button class="outline-button" type="submit" name="action" value="keep">Approve & publish</button> <button class="outline-button" type="submit" name="action" value="remove">Exclude video</button> <button class="outline-button" type="submit" name="action" value="short">Mark as Short</button><p class="review-result" role="status"></p></form></article>`).join(''):'<p class="subtle">No uncertain matches awaiting review.</p>';
  $('automaticAdditions').querySelectorAll('form').forEach(form=>form.onsubmit=async event=>{
   event.preventDefault();const action=event.submitter?.value;if(!action)return;
   if(action==='remove'&&form.elements.note.value.trim().length<5){form.querySelector('.review-result').textContent='Enter a reason with at least 5 characters.';form.elements.note.focus();return;}
   form.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{const result=await performerApi(action==='short'?'/mark-short':'/review',{id:form.dataset.additionPerformer,videos:[form.dataset.additionVideo],decision:action==='keep'?'approve':'exclude'});$('additionStatus').textContent=result.message;await reloadMemberCatalog();additionsLoading=false;await loadAutomaticAdditions(false,true);await loadReviewQueue();}catch(error){form.querySelector('.review-result').textContent=error.message;}finally{form.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
 }catch(error){$('additionStatus').textContent=error.message;}finally{additionsLoading=false;}
}
$('connectPush').onclick=async()=>{const button=$('connectPush');button.disabled=true;try{const result=await performerApi('/push/connect',{});$('additionStatus').textContent=result.message;await loadAutomaticAdditions(false,true);}catch(error){$('additionStatus').textContent=error.message;}finally{button.disabled=false;}};
setInterval(()=>{if(!document.hidden&&reactionAuth.account?.moderator)loadAutomaticAdditions(page!=='review');},60000);

$('markShortDiscovery').onclick=()=>reviewDiscovery('short');

async function loadRecheckStatus(){
 const data=await performerApi('/recheck');
 $('recheckStatus').textContent=(data.enabled?'Background previews enabled. ':'Background previews paused. ')+(data.last?`Last batch: ${data.last.processed} matches · ${data.last.status} · ${new Date(data.last.at).toLocaleString()}${data.last.message?' · '+data.last.message:''}`:'No recheck batch yet.');
 const labels={strong:'Strong matches',shorts:'Possible Shorts / excerpts',unrelated:'Possibly unrelated',uncertain:'Uncertain evidence',protected:'Moderator / performer holds',unprocessed:'Not rechecked yet'};
 $('recheckGroups').textContent=data.groups.map(g=>`${labels[g.outcome]||g.outcome}: ${g.count}`).join(' · ');
 $('publishRecheck').disabled=!data.groups.some(g=>g.outcome==='strong'&&g.count>0);
 $('batchRecheck').disabled=!data.enabled;
}
for(const [id,action] of [['startRecheck','start'],['batchRecheck','batch'],['pauseRecheck','pause'],['publishRecheck','publish']]){
 $(id).onclick=async()=>{const button=$(id);button.disabled=true;try{const data=await performerApi('/recheck',{action});$('additionStatus').textContent=data.message;await reloadMemberCatalog();await loadAutomaticAdditions(false,true);}catch(e){$('additionStatus').textContent=e.message;}finally{button.disabled=false;await loadRecheckStatus();}};
}
$('reviewGroup').onchange=()=>loadAutomaticAdditions(false,true);

$('selectQueueVisible').onclick=()=>{const boxes=[...document.querySelectorAll('#automaticAdditions .queue-select')];const select=!boxes.slice(0,50).every(b=>b.checked);boxes.forEach((b,i)=>b.checked=select&&i<50);};
for(const [id,decision] of [['approveQueueSelected','approve'],['excludeQueueSelected','exclude'],['shortQueueSelected','short']]){
 $(id).onclick=async()=>{
  const boxes=[...document.querySelectorAll('#automaticAdditions .queue-select:checked')];
  if(!boxes.length||boxes.length>50){$('additionStatus').textContent='Select 1–50 videos.';return;}
  const buttons=['approveQueueSelected','excludeQueueSelected','shortQueueSelected','selectQueueVisible'].map($);buttons.forEach(b=>b.disabled=true);
  try{const groups=new Map();for(const b of boxes){const list=groups.get(b.dataset.performer)||[];list.push(b.dataset.video);groups.set(b.dataset.performer,list);}const messages=[];
   for(const [performer,videos] of groups){const result=await performerApi(decision==='short'?'/mark-short':'/review',{id:performer,videos,decision});messages.push(result.message);}
   $('additionStatus').textContent=messages.join(' ');await reloadMemberCatalog();await loadAutomaticAdditions(false,true);
  }catch(e){$('additionStatus').textContent=e.message+' Some groups may already be processed; refresh before retrying.';}finally{buttons.forEach(b=>b.disabled=false);}
 };
}

async function loadShortRecovery(){
 const data=await performerApi('/shorts/recovery');let panel=$('shortRecovery');
 if(!panel){panel=document.createElement('details');panel.id='shortRecovery';$('automaticAdditions').before(panel);}
 panel.innerHTML='<summary>Previously excluded Shorts ('+data.items.length+(data.items.length===100?' shown; refresh after restoring':'')+')</summary><p>Review each video before restoring. Only exclusions made by the old Mark as Short action appear. Other exclusions remain protected.</p>'+data.items.map(v=>`<article class="panel"><h3>${escapeHtml(v.title)}</h3><p>${escapeHtml(v.channel_name||'Unknown reactor')} · ${prettyDate(v.published_at)}</p><a href="https://www.youtube.com/watch?v=${escapeHtml(v.video_id)}" target="_blank" rel="noopener">Check video on YouTube</a><p>${escapeHtml(v.reason)}</p><button class="outline-button" data-restore-short="${escapeHtml(v.video_id)}">Restore &amp; approve as Short</button><p role="status"></p></article>`).join('');
 panel.querySelectorAll('[data-restore-short]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const r=await performerApi('/shorts/restore',{id:'missioned-souls',videos:[button.dataset.restoreShort]});$('additionStatus').textContent=r.message;await reloadMemberCatalog();await loadShortRecovery();}catch(error){button.nextElementSibling.textContent=error.message;button.disabled=false;}});
}
