const memberPointLevels=[
  {min:0,label:'Novice',key:'novice',icon:'●'},
  {min:25,label:'Contributor',key:'contributor',icon:'◆'},
  {min:100,label:'Reaction scout',key:'scout',icon:'★'},
  {min:250,label:'Catalog curator',key:'curator',icon:'✦'},
  {min:1000,label:'Community champion',key:'champion',icon:'♛'}
];
function memberPointLevel(points){const n=Number(points);return [...memberPointLevels].reverse().find(l=>Number.isFinite(n)&&n>=l.min)||memberPointLevels[0];}
function memberPointBadge(points){
  if(points==null||!Number.isFinite(Number(points)))return '';
  const level=memberPointLevel(points),label=`${level.label} · ${Number(points).toLocaleString()} points`;
  return `<span class="member-point-badge badge-${level.key}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span aria-hidden="true">${level.icon}</span></span>`;
}
const profileIcons={initials:'Initials',music:'♫',guitar:'🎸',headphones:'🎧',microphone:'🎤',wave:'🌊',sun:'☀',flower:'🌼',heart:'♥',bird:'🕊',record:'💿',piano:'🎹'};
const profileColors=['teal','blue','purple','rose','gold','green'];
function memberProfileIcon(name,icon='initials',color='teal',picture=null){
  if(typeof picture==='string'&&/^\/api\/profile-pictures\/[a-f0-9-]{36}$/.test(picture))return `<img class="member-profile-icon profile-picture" src="${picture}" alt="" loading="lazy">`;
  const safeIcon=Object.hasOwn(profileIcons,icon)?icon:'initials',safeColor=profileColors.includes(color)?color:'teal';
  const symbol=safeIcon==='initials'?Array.from(String(name||'Member').trim()).slice(0,2).join('').toUpperCase():profileIcons[safeIcon];
  return `<span class="member-profile-icon profile-color-${safeColor}" aria-hidden="true">${escapeHtml(symbol)}</span>`;
}
function memberDisplayName(name,points,profile={}){return `<span class="member-display-name">${memberProfileIcon(name,profile.profile_icon,profile.profile_color,profile.profile_picture)}${memberPointBadge(points)}<span>${escapeHtml(name||'Member')}</span></span>`;}

function memberBadgeLegend(){return `<div class="member-badge-legend" aria-label="Member point levels">${memberPointLevels.map((l,i)=>`<span>${memberPointBadge(l.min)} ${l.label} <small>${l.min.toLocaleString()}${memberPointLevels[i+1]?'–'+(memberPointLevels[i+1].min-1).toLocaleString():'+'} points</small></span>`).join('')}</div>`;}
let communityState=null, scoreMap=new Map(), activeCommunityVideo=null, dialogRequest=0;
async function communityApi(path,body){
  const response=await reactionAuth.fetch(`/api/community${path}`,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Please try again.');return result;
}
function communityScore(id){const s=scoreMap.get(id);return s?`${Number(s.average).toFixed(1)} / 5 · ${s.count} rating${s.count===1?'':'s'}`:'Not rated yet';}
function communityRank(id){const s=scoreMap.get(id);return s&&s.count>=3?s.ranking:-1;}
function communityMessage(id,message){$(id).textContent=message;}
async function loadCommunity({deferSecondary=false}={}){
  try{
    communityState=await communityApi('/summary');scoreMap=new Map(communityState.scores.map(s=>[s.video_id,s]));
    $('displayName').value=communityState.name;
    $('profileIcon').value=communityState.profile_icon||'initials';
    $('profileColor').value=communityState.profile_color||'teal';
    pendingProfilePicture=undefined;$('profilePictureUpload').value='';updateProfilePreview();
    const avatar=document.querySelector('.app-header .avatar');
    if(avatar){avatar.innerHTML=memberProfileIcon(communityState.name,communityState.profile_icon,communityState.profile_color,communityState.profile_picture);avatar.title='Edit your community profile';avatar.setAttribute('aria-label','Edit your community profile');}
    $('pointsBadge').innerHTML=`${memberDisplayName(communityState.name,communityState.points,communityState)} · ${communityState.points} points · ${escapeHtml(communityState.tier)}`;
    $('communityStatus').textContent=communityState.name?'Ready to contribute.':'Save a display name to start participating.';
    $('suggestPerformer').innerHTML=catalog.performers.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    $('leaderboard').innerHTML=communityState.leaders.length?communityState.leaders.map(p=>`<li>${memberDisplayName(p.name,p.points,p)} <strong>${p.points} points</strong></li>`).join(''):'<li>No points awarded yet. Help start the community.</li>';
    $('myContributions').innerHTML=communityState.mine.length?communityState.mine.map(c=>`<article class="contribution"><strong>${escapeHtml(c.kind)} · ${escapeHtml(c.status)}</strong> <a target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${escapeHtml(c.video_id)}">Open video ↗</a><p>${escapeHtml(c.body)}</p>${c.review_note?`<p>Review: ${escapeHtml(c.review_note)}</p>`:''}</article>`).join(''):'<p>No contributions submitted yet.</p>';
    $('pointsHistory').innerHTML=communityState.ledger.length?communityState.ledger.map(p=>`<p>${prettyDate(p.created_at)} · ${escapeHtml(p.kind)} · ${p.amount>0?'+':''}${p.amount} points</p>`).join(''):'<p>Your points history will appear here.</p>';
    $('moderation').hidden=!communityState.moderator;
    if(!deferSecondary){
      await loadCoverage();
      if(communityState.moderator)await loadReviewQueue();
    }
  }catch(e){communityMessage('communityStatus',e.message);}
}
async function formAction(form,statusId,work){
  const button=form.querySelector('button[type="submit"],button:not([type])');if(button)button.disabled=true;
  communityMessage(statusId,'Saving…');
  try{const result=await work();if(result?.published){const response=await reactionAuth.fetch('/data.json',{cache:'no-store'});if(response.ok)catalog=await response.json();}await loadCommunity();if(catalog)renderVideos();communityMessage(statusId,result?.message||'Saved.');}
  catch(e){communityMessage(statusId,e.message);}finally{if(button)button.disabled=false;}
}
$('profileForm').addEventListener('submit',e=>{e.preventDefault();formAction(e.currentTarget,'communityStatus',()=>communityApi('/profile',{name:$('displayName').value,icon:$('profileIcon').value,color:$('profileColor').value,...(pendingProfilePicture!==undefined?{picture:pendingProfilePicture}:{})}));});
$('suggestForm').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;formAction(form,'communityStatus',async()=>{const r=await communityApi('/contribute',{kind:'submission',...Object.fromEntries(new FormData(form))});form.reset();return r;});});
$('coverageForm').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;formAction(form,'coverageStatus',async()=>{const result=await communityApi('/coverage',Object.fromEntries(new FormData(form)));form.reset();return result;});});
$('coverageOpen').onclick=()=>{navigate('community');$('coverageForm').scrollIntoView({block:'start',behavior:'smooth'});$('coverageForm').elements.name.focus({preventScroll:true});};
const coverageLabel=status=>({pending:'Awaiting review',shortlisted:'Shortlisted for future coverage',declined:'Not selected',covered:'Coverage available'}[status]||status);
async function loadCoverage(){
  const result=await communityApi('/coverage');
  $('myCoverage').innerHTML=result.items.length?result.items.map(c=>`<article class="contribution"><strong>${memberDisplayName(c.name,c.points,c)} · ${escapeHtml(coverageLabel(c.status))}</strong><p>${escapeHtml(c.body)}</p><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">Official channel or website</a>${c.review_note?`<p>Moderator note: ${escapeHtml(c.review_note)}</p>`:''}</article>`).join(''):'<p class="subtle">Your recommendations and moderator decisions will appear here.</p>';
}
async function loadCoverageQueue(){
  const result=await communityApi('/coverage/queue');
  $('coverageQueue').innerHTML=result.items.length?result.items.map(c=>`<article class="panel"><h3>${memberDisplayName(c.name,c.points,c)}</h3><p class="subtle">Suggested by ${memberDisplayName(c.member_name,c.points)} · ${escapeHtml(coverageLabel(c.status))}</p><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">Official channel or website</a><p class="submitted-text">${escapeHtml(c.body)}</p>${!c.performer_id&&['pending','shortlisted'].includes(c.status)?`<button type="button" class="primary-button" data-setup-coverage="${escapeHtml(c.id)}">Set up coverage</button>`:''}${c.status==='pending'?`<form data-coverage-review="${escapeHtml(c.id)}"><label>Decision<select name="decision"><option value="shortlisted">Shortlist for future coverage</option><option value="declined">Decline</option></select></label><label>Note to the member<textarea name="note" minlength="5" maxlength="500" required></textarea></label><button class="outline-button">Save decision</button></form>`:`<p>Moderator note: ${escapeHtml(c.review_note||'')}</p>`}</article>`).join(''):'<p class="subtle">No coverage recommendations yet.</p>';
  $('coverageQueue').querySelectorAll('[data-setup-coverage]').forEach(button=>button.onclick=()=>openPerformerEditor(null,result.items.find(c=>c.id===button.dataset.setupCoverage)));
  $('coverageQueue').querySelectorAll('[data-coverage-review]').forEach(form=>form.onsubmit=e=>{e.preventDefault();formAction(form,'notice',()=>communityApi('/coverage/review',{id:form.dataset.coverageReview,...Object.fromEntries(new FormData(form))}));});
}
async function openCommunityVideo(id){
  activeCommunityVideo=catalog.videos.find(v=>v.id===id&&v.performerId===state.performer);if(!activeCommunityVideo)return;
  const request=++dialogRequest;
  $('dialogTitle').textContent=activeCommunityVideo.title;$('dialogMeta').textContent=communityScore(id);
  $('commentForm').reset();$('flagForm').reset();$('myRating').value='';$('videoComments').textContent='Loading comments…';
  communityMessage('videoStatus',communityState?.name?'':'Save a display name in Community before contributing.');
  if(!$('videoDialog').open)$('videoDialog').showModal();
  try{const r=await communityApi(`/video?id=${encodeURIComponent(id)}`);if(request!==dialogRequest)return;
    $('myRating').value=r.rating||'';
    $('videoComments').innerHTML=r.comments.length?r.comments.map(c=>`<article class="contribution"><strong>${memberDisplayName(c.name,c.points,c)}</strong><span> · ${prettyDate(c.created_at)}</span><p>${escapeHtml(c.body)}</p></article>`).join(''):'<p>No approved comments yet.</p>';
  }catch(e){if(request===dialogRequest){$('videoComments').textContent='Comments could not be loaded.';communityMessage('videoStatus',e.message);}}
}
$('closeVideo').addEventListener('click',()=>$('videoDialog').close());
$('videoDialog').addEventListener('close',()=>{dialogRequest++;activeCommunityVideo=null;});
$('ratingForm').addEventListener('submit',e=>{e.preventDefault();if(!activeCommunityVideo)return;const v=activeCommunityVideo;formAction(e.currentTarget,'videoStatus',async()=>{const r=await communityApi('/rating',{videoId:v.id,performerId:v.performerId,score:Number($('myRating').value)});return r;}).then(()=>{if(activeCommunityVideo?.id===v.id)$('dialogMeta').textContent=communityScore(v.id);});});
for(const [formId,kind] of [['commentForm','comment'],['flagForm','flag']])$(formId).addEventListener('submit',e=>{e.preventDefault();if(!activeCommunityVideo)return;const form=e.currentTarget,v=activeCommunityVideo;formAction(form,'videoStatus',async()=>{const r=await communityApi('/contribute',{kind,videoId:v.id,performerId:v.performerId,...Object.fromEntries(new FormData(form))});form.reset();return r;});});
let memberContributionOffset=0;
async function loadReviewQueue(){
  if(!communityState?.moderator)return;
  $('moderation').hidden=false;
  await loadSubmissionHistory();
  try{$('memberContributionStatus').textContent='Loading member contributions…';const kind=$('memberContributionKind').value;const r=await communityApi('/queue?kind='+kind+'&offset='+memberContributionOffset);
    $('memberContributionPrevious').disabled=memberContributionOffset===0;$('memberContributionNext').disabled=!r.hasMore;
    $('memberContributionStatus').textContent=r.items.length?`${r.items.length} ${kind==='submission'?'submitted reactions':'contributions'} shown.`:'No '+(kind==='submission'?'submitted reactions awaiting review':'matching contributions')+'.';
    $('reviewQueue').innerHTML=r.items.length?r.items.map(c=>`<form class="review-item" data-review-id="${escapeHtml(c.id)}"><h4>${c.kind==='flag'?'Removal request':escapeHtml(c.kind)} · ${memberDisplayName(c.name,c.points,c)} · ${escapeHtml(c.status)}</h4><p>${escapeHtml(c.performer_id)}${c.reason?` · ${escapeHtml(c.reason)}`:''}</p><a target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${escapeHtml(c.video_id)}">Verify on YouTube ↗</a><p class="submitted-text">${escapeHtml(c.body)}</p>${c.kind==='submission'?'<button type="button" class="outline-button" data-fetch-submission>Fetch YouTube details</button><p class="metadata-status" role="status"></p><label>Video format<select name="format"><option value="">Automatic from metadata</option><option value="UNKNOWN">Unknown / needs format review</option><option value="FULL_LENGTH">Full-length</option><option value="SHORT">Short</option></select></label><details><summary>Video details (filled automatically; manual fallback)</summary><label>Video title<input name="title" maxlength="250"></label><label>Channel name<input name="channelName" maxlength="100"></label><label>Channel ID<input name="channelId" placeholder="UC…"></label><label>Upload date (optional)<input name="publishedAt" type="date"></label></details>':''}<label>Review note<textarea name="note" minlength="5" maxlength="500" required></textarea></label><label>Decision<select name="decision">${c.status==='accepted'?'<option value="hide">Hide comment and reverse its points</option>':c.kind==='flag'?'<option value="reject">Keep video · dismiss request</option><option value="accept">Remove video · uphold request</option>':'<option value="reject">Reject</option><option value="accept">Accept</option>'}</select></label><button class="outline-button">Save review</button><p class="review-result" role="status"></p></form>`).join(''):'<p>No contributions awaiting review.</p>';
    $('reviewQueue').querySelectorAll('[data-fetch-submission]').forEach(button=>button.onclick=async()=>{const form=button.closest('form'),status=form.querySelector('.metadata-status');button.disabled=true;status.textContent='Fetching YouTube details…';try{const m=await communityApi('/submission/metadata?id='+encodeURIComponent(form.dataset.reviewId));for(const k of ['title','channelName','channelId'])form.elements[k].value=m[k];form.elements.publishedAt.value=m.publishedAt?.slice(0,10)||'';form.elements.format.value=m.format;status.textContent=`${m.title} · ${m.channelName} · ${m.duration==null?'Duration unknown':m.duration+' seconds'}. Verify the reaction on YouTube; short duration alone does not prove a Short.`;}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
    document.querySelectorAll('[data-review-id]').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;const result=form.querySelector('.review-result');result.textContent='Saving…';try{const reviewedVideoId=form.querySelector('a[href*="youtube.com/watch"]')?.href;const r=await communityApi('/moderate',{id:form.dataset.reviewId,...Object.fromEntries(new FormData(form))});const response=await reactionAuth.fetch('/data.json',{cache:'no-store'});if(response.ok)catalog=await response.json();await loadCommunity();renderAll();communityMessage('communityStatus',r.message);$('memberContributionStatus').textContent=r.message;if(reviewedVideoId&&form.elements.decision.value==='accept'&&form.dataset.reviewId.startsWith('submission:')){const link=document.createElement('a');link.textContent=' Open approved reaction';link.href='#feed';link.className='text-link';link.onclick=e=>{e.preventDefault();navigate('feed');const id=new URL(reviewedVideoId).searchParams.get('v');openCommunityVideo(id,'missioned-souls');};$('memberContributionStatus').append(link);}}catch(e){result.textContent=e.message;}finally{button.disabled=false;}}));
  }catch(e){$('reviewQueue').textContent='';$('memberContributionStatus').textContent=e.message;}
}
$('refreshQueue').addEventListener('click',loadReviewQueue);
$('memberContributionKind').onchange=()=>{memberContributionOffset=0;loadReviewQueue();};
$('memberContributionPrevious').onclick=()=>{memberContributionOffset=Math.max(0,memberContributionOffset-50);loadReviewQueue();};
$('memberContributionNext').onclick=()=>{memberContributionOffset+=50;loadReviewQueue();};

let submissionHistoryOffset=0,submissionHistoryRequest=0;
async function loadSubmissionHistory(){
 if(!communityState?.moderator)return;
 const token=++submissionHistoryRequest;
 $('submissionHistoryStatus').textContent='Loading reviewed submissions…';
 try{
  const params=new URLSearchParams({status:$('submissionHistoryFilter').value,q:$('submissionHistoryQuery').value.trim(),offset:String(submissionHistoryOffset)});
  const r=await communityApi('/submission-history?'+params);
  if(token!==submissionHistoryRequest||!communityState?.moderator)return;
  $('submissionHistoryPrevious').disabled=submissionHistoryOffset===0;$('submissionHistoryNext').disabled=!r.hasMore;
  $('submissionHistoryStatus').textContent=r.items.length?`${r.items.length} reviewed submissions shown.`:'No reviewed submissions match this search.';
  $('submissionHistoryItems').innerHTML=r.items.map(c=>`<article class="review-item"><h4>${escapeHtml(c.video_id)} · ${escapeHtml(c.status)} · ${memberDisplayName(c.name||'Member',c.points)}</h4><a href="https://www.youtube.com/watch?v=${escapeHtml(c.video_id)}" target="_blank" rel="noopener">Verify on YouTube ↗</a><p>${escapeHtml(c.body)}</p><p><strong>Review note:</strong> ${escapeHtml(c.review_note||'No note recorded')}</p><p>Reviewed ${escapeHtml(prettyDate(c.reviewed_at||c.created_at))}</p>${c.status==='rejected'?`<form data-reopen-submission="${escapeHtml(c.id)}"><label>Reason for reopening<textarea name="note" required minlength="5" maxlength="500"></textarea></label><button class="outline-button">Reopen for Review</button><p role="status"></p></form>`:''}</article>`).join('');
  $('submissionHistoryItems').querySelectorAll('[data-reopen-submission]').forEach(form=>form.onsubmit=async e=>{
   e.preventDefault();const button=form.querySelector('button'),message=form.querySelector('[role=status]');button.disabled=true;
   try{const r=await communityApi('/submission/reopen',{id:form.dataset.reopenSubmission,note:form.elements.note.value});$('memberContributionKind').value='submission';memberContributionOffset=0;await loadReviewQueue();$('submissionHistoryStatus').textContent=r.message;}
   catch(err){message.textContent=err.message;}finally{button.disabled=false;}
  });
 }catch(err){if(token===submissionHistoryRequest){$('submissionHistoryItems').replaceChildren();$('submissionHistoryStatus').textContent=err.message;}}
}
$('submissionHistorySearch').onsubmit=e=>{e.preventDefault();submissionHistoryOffset=0;loadSubmissionHistory();};
$('submissionHistoryFilter').onchange=()=>{submissionHistoryOffset=0;loadSubmissionHistory();};
$('submissionHistoryPrevious').onclick=()=>{submissionHistoryOffset=Math.max(0,submissionHistoryOffset-50);loadSubmissionHistory();};
$('submissionHistoryNext').onclick=()=>{submissionHistoryOffset+=50;loadSubmissionHistory();};
window.addEventListener('reaction-auth-change',()=>{submissionHistoryRequest++;submissionHistoryOffset=0;$('submissionHistoryItems').replaceChildren();$('submissionHistoryStatus').textContent='';});

$('profileIcon').innerHTML=Object.entries(profileIcons).map(([key,label])=>`<option value="${key}">${label==='Initials'?label:key[0].toUpperCase()+key.slice(1)+' '+label}</option>`).join('');
let pendingProfilePicture;
function updateProfilePreview(){
 const picture=pendingProfilePicture===undefined?communityState?.profile_picture:pendingProfilePicture;
 $('profilePreview').innerHTML=typeof picture==='string'&&picture.startsWith('data:image/jpeg;base64,')?`<img class="member-profile-icon profile-picture" alt="Profile picture preview" src="${picture}">`:memberProfileIcon($('displayName').value,$('profileIcon').value,$('profileColor').value,picture);
 $('removeProfilePicture').disabled=!picture;
}
let pictureUploadSequence=0;
$('profilePictureUpload').addEventListener('change',async e=>{
 const sequence=++pictureUploadSequence,file=e.target.files[0];if(!file)return;
 try{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPG, PNG, or WebP image under 10 MB.');
  const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,256);
  const size=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);bitmap.close();
  let picture;for(const quality of [0.85,0.7,0.5,0.3]){picture=canvas.toDataURL('image/jpeg',quality);if(picture.length<=43714)break;}
  if(picture.length>43714)throw new Error('This picture is too detailed. Try a simpler image.');
  if(sequence!==pictureUploadSequence)return;pendingProfilePicture=picture;updateProfilePreview();communityMessage('communityStatus','Picture ready. Select Save profile to upload it.');
 }catch(error){if(sequence===pictureUploadSequence)communityMessage('communityStatus',error.message);}
});
$('removeProfilePicture').onclick=()=>{pictureUploadSequence++;pendingProfilePicture=null;$('profilePictureUpload').value='';updateProfilePreview();communityMessage('communityStatus','Select Save profile to remove your picture.');};
for(const id of ['profileIcon','profileColor','displayName'])$(id).addEventListener('input',updateProfilePreview);
updateProfilePreview();
