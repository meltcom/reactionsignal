(()=>{
 let current=null,busy=false,lastCheck=0;
 const seen=new Set();
 const dialog=document.createElement('dialog');dialog.id='dailyPointsDialog';dialog.setAttribute('aria-labelledby','dailyPointsTitle');
 dialog.innerHTML='<header><h2 id="dailyPointsTitle">You’re nearing today’s points limit</h2><button type="button" class="outline-button" data-close aria-label="Close daily points warning">Close</button></header><p class="daily-points-count" data-count></p><progress max="500" value="0" aria-label="Points used in current allowance"></progress><p data-remaining></p><p data-reset-time></p><p>You can continue participating at the limit. Extra activity earns no points until your allowance resets. Your earned points and badge stay intact.</p><p data-donation-copy>Each verified donation unlocks one new 500-point allowance. You can repeat this without a daily limit. No moderator approval is needed.</p><p data-status role="status" aria-live="polite"></p><div class="daily-points-actions"><button type="button" class="primary-button" data-support>Support Reaction Journey ↗</button><button type="button" class="outline-button" data-reset>Reset daily points allowance</button><button type="button" class="outline-button" data-close>Keep browsing</button></div>';
 document.body.append(dialog);
 const el=selector=>dialog.querySelector(selector);
 function paint(){if(!current)return;const enabled=current.enabled===true,credits=current.resetsAvailable||0;
  el('[data-count]').textContent=`${current.used} / 500 points`;
  el('progress').value=Math.min(500,current.used);
  el('[data-remaining]').textContent=`${current.remaining} points remaining in this allowance.`;
  el('[data-reset-time]').textContent='Daily reset: '+new Date(current.resetsAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+' (midnight UTC).';
  el('[data-reset]').disabled=busy||!enabled||credits<1||current.used<450;
  el('[data-support]').disabled=busy;
  el('[data-donation-copy]').textContent=enabled?'Each verified donation unlocks one new 500-point allowance. Repeat as often as you wish. No moderator approval is needed.':'Automatic donation resets are not enabled yet. You can still support the site; donations made now will not unlock a reset.';
  el('[data-status]').textContent=credits?`${credits} verified donation reset${credits===1?'':'s'} available.`:enabled?'After donating, return here. Your reset unlocks when PayPal confirms payment.':'';
  if(current.sandbox)el('[data-status]').textContent='PayPal sandbox test — no real payment. '+el('[data-status]').textContent;
 }
 function update(data){current=data;if(!data?.trusted){if(dialog.open)dialog.close();return;}paint();
  const key=[window.reactionAuth?.account?.id,data.day,data.earnedToday-data.used,data.used>=500?'limit':'warning',data.resetsAvailable>0?'ready':'none'].join(':');
  if(data.used>=450&&!seen.has(key)&&!document.querySelector('dialog[open]')){seen.add(key);dialog.showModal();}
 }
 async function api(path){const response=await reactionAuth.fetch('/api/donations'+path,{cache:'no-store',...(path==='/status'?{}:{method:'POST'})});const data=await response.json();if(!response.ok)throw Error(data.error||'Please try again.');return data;}
 async function refresh(){if(!window.reactionAuth?.account||document.hidden||busy||Date.now()-lastCheck<15000)return;lastCheck=Date.now();try{update(await api('/status'));}catch{/* Retain the previous confirmed allowance; never grant from a failed request. */}}
 dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>dialog.close());
 el('[data-support]').onclick=async()=>{if(busy)return;if(!current.enabled){window.open('https://www.paypal.com/donate?hosted_button_id=H83DMS4NXCZLG','_blank','noopener,noreferrer');return;}busy=true;paint();try{const result=await api('/start');const target=new URL(result.url);if(!['https://www.paypal.com','https://www.sandbox.paypal.com'].includes(target.origin)||target.pathname!=='/donate/')throw Error('Unexpected donation destination.');sessionStorage.setItem('rj-donation-pending','1');location.assign(target.href);}catch(error){el('[data-status]').textContent=error.message;}finally{busy=false;el('[data-support]').disabled=false;}};
 el('[data-reset]').onclick=async()=>{if(busy)return;busy=true;paint();try{const result=await api('/reset');update({...current,...result});el('[data-status]').textContent='Allowance reset. You can earn 500 more points; your earned points are preserved.';sessionStorage.removeItem('rj-donation-pending');}catch(error){el('[data-status]').textContent=error.message;}finally{busy=false;el('[data-reset]').disabled=!current.enabled||current.resetsAvailable<1||current.used<450;}};
 window.addEventListener('rj-points-updated',event=>update(event.detail));
 window.addEventListener('focus',()=>{lastCheck=0;refresh();});
 document.addEventListener('visibilitychange',refresh);
 setInterval(refresh,60000);
 window.addEventListener('click',async event=>{if(event.target.closest('[data-open-daily-points]')){lastCheck=0;await refresh();if(current?.trusted&&!dialog.open){paint();dialog.showModal();}}else if(event.target.closest('[data-page="reputation"]')){lastCheck=0;refresh();}});
})();
