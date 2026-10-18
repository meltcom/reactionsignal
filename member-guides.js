(()=>{
const names={overview:'reaction-journey-overview.pdf','app-guide':'reaction-journey-app-guide.pdf'};
document.querySelectorAll('[data-open-guide-downloads]').forEach(b=>b.addEventListener('click',()=>{navigate('help');const section=document.getElementById('help-downloads');section.open=true;section.scrollIntoView({block:'start',behavior:'smooth'});section.querySelector('summary').focus();}));
document.querySelectorAll('[data-member-guide]').forEach(button=>button.addEventListener('click',async()=>{
 const guide=button.dataset.memberGuide,status=document.getElementById('memberGuideStatus');
 if(!names[guide])return;
 if(!reactionAuth.account?.id){status.textContent='Please sign in to download a guide.';reactionAuth.showDialog();return;}
 button.disabled=true;status.textContent='Preparing your PDF…';
 try{const response=await reactionAuth.fetch('/api/member-guides/'+guide,{cache:'no-store'});if(!response.ok)throw Error(response.status===401?'Please sign in again to download the guide.':'The guide could not be downloaded. Please try again.');if(!response.headers.get('Content-Type')?.includes('application/pdf'))throw Error('The guide is temporarily unavailable. Please try again.');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=names[guide];document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent='Your PDF is ready. Check your browser downloads or save options.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}));})();