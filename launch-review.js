let classificationOffset=0,memberOffset=0;
async function loadLaunchReview(){
 if(!communityState?.moderator)return;
 let panel=$('launchReview');
 if(!panel){panel=document.createElement('div');panel.id='launchReview';panel.className='panel';$('member-review').append(panel);
 panel.innerHTML='<h2>Member review</h2><p>Novice: fewer than 25 points. Contributor: 25 points. Higher existing badges continue at 100, 250 and 1,000 points. Mutes stop posting for 24 hours and allow browsing.</p><label>Search names or email <input id="memberSearch" maxlength="100"></label><button id="memberRefresh" class="outline-button">Search / refresh</button><div id="memberItems"></div><button id="memberPrevious" class="outline-button">Previous 100</button><button id="memberNext" class="outline-button">Next 100</button><p id="memberReviewStatus" role="status"></p>';
 $('memberRefresh').onclick=()=>{memberOffset=0;loadMembers();};
 $('memberPrevious').onclick=()=>{memberOffset=Math.max(0,memberOffset-100);loadMembers();};
 $('memberNext').onclick=()=>{memberOffset+=100;loadMembers();};
 }
 await loadMembers();
}
async function loadClassificationReview(){
 if(!communityState?.moderator)return;
 let panel=$('classificationReviewPanel');
 if(!panel){panel=document.createElement('div');panel.id='classificationReviewPanel';panel.className='panel';$('classification-review').append(panel);
 panel.innerHTML='<h2>Video classification review</h2><p>Verify the reaction on YouTube, choose its format, then confirm. Unknown describes format; Probable describes reaction confidence. Excluded and unavailable videos stay outside these lists.</p><label>List <select id="classificationGroup"><option value="unknown">Unknown format</option><option value="probable">Probable reactions</option></select></label><button id="classificationRefresh" class="outline-button">Refresh list</button><div id="classificationItems"></div><button id="classificationPrevious" class="outline-button">Previous 50</button><button id="classificationNext" class="outline-button">Next 50</button><p id="classificationStatus" role="status"></p>';
 $('classificationGroup').onchange=$('classificationRefresh').onclick=()=>{classificationOffset=0;loadClassification();};
 $('classificationPrevious').onclick=()=>{classificationOffset=Math.max(0,classificationOffset-50);loadClassification();};
 $('classificationNext').onclick=()=>{classificationOffset+=50;loadClassification();};
 }
 installVideoCorrectionPanel();
 await loadClassification();
}
async function loadClassification(){try{
 const r=await performerApi('/classification?group='+$('classificationGroup').value+'&offset='+classificationOffset);
 $('classificationItems').innerHTML=r.items.map(v=>`<form class="review-item" data-classify="${escapeHtml(v.id)}"><h3>${escapeHtml(v.title)}</h3><p>${escapeHtml(v.channel_name||'Unknown channel')} · ${escapeHtml(v.status)} · ${escapeHtml(v.format)}</p><a href="https://www.youtube.com/watch?v=${escapeHtml(v.id)}" target="_blank" rel="noopener">Check on YouTube ↗</a><label>Format <select name="format"><option value="">Choose format</option><option value="SHORT" ${v.format==='SHORT'?'selected':''}>Short</option><option value="FULL_LENGTH" ${v.format==='FULL_LENGTH'?'selected':''}>Full-length</option></select></label><label><input type="checkbox" name="verified" required> I verified this is a Missioned Souls reaction</label><button class="outline-button">Confirm reaction &amp; save format</button><button type="button" class="outline-button" data-classification-reject>Reject / remove video</button><p role="status"></p></form>`).join('')||'<p>No matching videos.</p>';
 $('classificationPrevious').disabled=classificationOffset===0;$('classificationNext').disabled=!r.hasMore;
 $('classificationItems').querySelectorAll('form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;try{const r=await performerApi('/classification/confirm',{videoId:f.dataset.classify,format:f.elements.format.value});$('classificationStatus').textContent=r.message;await loadClassification();await reloadMemberCatalog();}catch(err){f.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}});
 $('classificationItems').querySelectorAll('[data-classification-reject]').forEach(b=>b.onclick=async()=>{
 const f=b.closest('form');if(!confirm('Remove this video from the catalog and review lists? Future discovery will respect this exclusion.'))return;
 f.querySelectorAll('button').forEach(x=>x.disabled=true);
 try{const r=await performerApi('/review',{id:'missioned-souls',videos:[f.dataset.classify],decision:'exclude'});$('classificationStatus').textContent=r.message;await loadClassification();await reloadMemberCatalog();}
 catch(e){f.querySelector('[role=status]').textContent=e.message;f.querySelectorAll('button').forEach(x=>x.disabled=false);}
 });
 }catch(e){$('classificationStatus').textContent=e.message;}}
async function loadMembers(){try{
 const r=await communityApi('/users?q='+encodeURIComponent($('memberSearch').value)+'&offset='+memberOffset);
 $('memberItems').innerHTML=r.items.map(m=>`<form class="review-item" data-member="${escapeHtml(m.id)}"><h3>${escapeHtml(m.name||'Display name not set')} · ${escapeHtml(m.tier)}${m.moderator?' · Moderator':''}</h3><p>${escapeHtml(m.email||'Email recorded on next visit')} · ${m.points} points</p><p>Joined: ${prettyDate(m.created_at)} · Last seen: ${m.last_seen_at?prettyDate(m.last_seen_at):'Not recorded'}${m.muted_until&&Date.parse(m.muted_until)>Date.now()?' · Muted until '+prettyDate(m.muted_until):''}</p><label>Action <select name="action"><option value="name">Correct display name</option><option value="points">Adjust points</option><option value="mute">Mute posting for 24 hours</option><option value="unmute">Remove posting mute</option></select></label><label>Display name <input name="name" maxlength="40" value="${escapeHtml(m.name)}"></label><label>Point adjustment (+ or −) <input name="amount" type="number" step="1" min="-1000" max="1000" value="0"></label><label>Reason <input name="note" minlength="5" maxlength="500" required></label><button class="outline-button">Save member change</button><p role="status"></p></form>`).join('')||'<p>No members found.</p>';
 $('memberPrevious').disabled=memberOffset===0;$('memberNext').disabled=!r.hasMore;
 $('memberItems').querySelectorAll('form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;try{const r=await communityApi('/users/update',{id:f.dataset.member,action:f.elements.action.value,name:f.elements.name.value,amount:Number(f.elements.amount.value),note:f.elements.note.value});$('memberReviewStatus').textContent=r.message;await loadMembers();await loadCommunity();}catch(err){f.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}});
 }catch(e){$('memberReviewStatus').textContent=e.message;}}
window.addEventListener('reaction-auth-change',()=>{$('launchReview')?.remove();$('classificationReviewPanel')?.remove();$('videoCorrectionPanel')?.remove();$('classificationReviewNav').hidden=true;$('moderatorNavSection').hidden=true;});

function installVideoCorrectionPanel(){
 if($('videoCorrectionPanel'))return;
 const panel=document.createElement('div');panel.id='videoCorrectionPanel';panel.className='panel';$('classification-review').prepend(panel);
 panel.innerHTML='<h2>Correct video information</h2><p>Fix a video before or after approval. Paste its YouTube link, load the saved details, then fetch the correct title and channel from YouTube. Saving keeps the video’s review status, comments and ratings.</p><form id="videoCorrectionLookup"><label>YouTube video link or ID<input name="video" required maxlength="250"></label><button class="outline-button">Load video</button></form><div id="videoCorrectionEditor"></div><p id="videoCorrectionStatus" role="status"></p>';
 $('videoCorrectionLookup').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;$('videoCorrectionEditor').replaceChildren();try{
 const r=await communityApi('/catalog-video?video='+encodeURIComponent(e.target.elements.video.value.trim())),v=r.video;
 $('videoCorrectionStatus').textContent='Loaded saved details. Fetch YouTube details to verify the correct channel.';
 $('videoCorrectionEditor').innerHTML=`<form id="videoCorrectionForm"><a href="https://www.youtube.com/watch?v=${escapeHtml(v.id)}" target="_blank" rel="noopener">Verify on YouTube ↗</a><button type="button" class="outline-button" id="videoCorrectionFetch">Fetch YouTube details</button><label>Video title<input name="title" maxlength="250" required value="${escapeHtml(v.title)}"></label><label>Channel name<input name="channelName" maxlength="100" required value="${escapeHtml(v.channelName||'')}"></label><label>Channel ID<input name="channelId" required value="${escapeHtml(v.channel_id)}"></label><label>Upload date<input name="publishedAt" type="date" value="${escapeHtml(v.published_at?.slice(0,10)||'')}"></label><label>Format<select name="format">${['UNKNOWN','FULL_LENGTH','SHORT'].map(f=>`<option value="${f}" ${v.format===f?'selected':''}>${f==='FULL_LENGTH'?'Full-length':f==='SHORT'?'Short':'Unknown'}</option>`).join('')}</select></label><label>Reason for correction<textarea name="note" required minlength="5" maxlength="500"></textarea></label><button class="primary-button">Save correction</button><p class="subtle">When the YouTube API is configured, the saved title, channel and upload date are verified again on the server.</p></form><h3>Recent corrections</h3>${r.history.map(h=>`<p>${escapeHtml(prettyDate(h.created_at))} · ${escapeHtml(h.note)}</p>`).join('')||'<p>No previous corrections.</p>'}`;
 const form=$('videoCorrectionForm');
 $('videoCorrectionFetch').onclick=async()=>{const b=$('videoCorrectionFetch');b.disabled=true;try{const m=await communityApi('/catalog-video/metadata?video='+encodeURIComponent(v.id));for(const k of ['title','channelName','channelId'])form.elements[k].value=m[k];form.elements.publishedAt.value=m.publishedAt?.slice(0,10)||'';$('videoCorrectionStatus').textContent='YouTube details loaded. Check the format and enter a correction reason.';}catch(err){$('videoCorrectionStatus').textContent=err.message;}finally{b.disabled=false;}};
 form.onsubmit=async e=>{e.preventDefault();form.querySelectorAll('button').forEach(b=>b.disabled=true);try{const result=await communityApi('/catalog-video/update',{videoId:v.id,...Object.fromEntries(new FormData(form))});await reloadMemberCatalog();$('videoCorrectionEditor').replaceChildren();$('videoCorrectionStatus').textContent=result.message;}catch(err){$('videoCorrectionStatus').textContent=err.message;}finally{form.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 }catch(err){$('videoCorrectionStatus').textContent=err.message;}finally{button.disabled=false;}};
}
