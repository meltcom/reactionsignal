let contactOffset=0,contactCurrentPage='';
async function loadContactPage(){
 if(page==='contact-inbox'&&!communityState?.moderator)return;
 if(contactCurrentPage!==page){contactOffset=0;contactCurrentPage=page;}
 const mount=$(page==='contact-inbox'?'contactInboxRequests':'contactRequests');
 try{const r=await communityApi((page==='contact-inbox'?'/contact/inbox':'/contact')+'?offset='+contactOffset);
 mount.innerHTML=r.items.map(t=>`<article class="panel"><h3>${escapeHtml(t.subject)}</h3><p>${escapeHtml(t.category)} · ${escapeHtml(t.status)} · ${prettyDate(t.updated_at)}${page==='contact-inbox'?' · '+memberDisplayName(t.name,t.points,t):''}</p><button class="outline-button" data-contact-open="${escapeHtml(t.id)}">Read / reply</button><div data-contact-thread="${escapeHtml(t.id)}"></div></article>`).join('')||'<p>No requests yet.</p>';
 mount.insertAdjacentHTML('beforeend',`<button class="outline-button" data-contact-prev ${contactOffset===0?'disabled':''}>Previous 50</button><button class="outline-button" data-contact-next ${!r.hasMore?'disabled':''}>Next 50</button><p role="status" class="contact-list-status"></p>`);
 mount.querySelector('[data-contact-prev]').onclick=()=>{contactOffset=Math.max(0,contactOffset-50);loadContactPage();};
 mount.querySelector('[data-contact-next]').onclick=()=>{contactOffset+=50;loadContactPage();};
 mount.querySelectorAll('[data-contact-open]').forEach(b=>b.onclick=()=>openContactThread(b.dataset.contactOpen,mount));
 }catch(e){mount.textContent=e.message;}
}
async function openContactThread(id,mount){
 const container=[...mount.querySelectorAll('[data-contact-thread]')].find(el=>el.dataset.contactThread===id);
 try{const r=await communityApi('/contact/thread?id='+encodeURIComponent(id));
 container.innerHTML=r.messages.map(m=>`<div class="panel"><strong>${m.moderator?'Moderator':'Member'}</strong><small> · ${prettyDate(m.created_at)}</small><p style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(m.body)}</p></div>`).join('')+`<form><label>Reply<textarea name="body" minlength="2" maxlength="4000" required></textarea></label><button class="primary-button">Send reply</button><p role="status"></p></form>${communityState?.moderator?`<button class="outline-button" data-contact-state="${r.ticket.status==='closed'?'open':'closed'}">${r.ticket.status==='closed'?'Reopen request':'Close request'}</button>`:''}`;
 const f=container.querySelector('form');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;try{await communityApi('/contact/reply',{id,body:f.elements.body.value});await openContactThread(id,mount);mount.querySelector('.contact-list-status').textContent='Reply sent. The member can read it on Contact.';}catch(err){f.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};
 const state=container.querySelector('[data-contact-state]');if(state)state.onclick=async()=>{state.disabled=true;try{await communityApi('/contact/status',{id,status:state.dataset.contactState});await loadContactPage();}catch(e){f.querySelector('[role=status]').textContent=e.message;state.disabled=false;}};
 }catch(e){container.textContent=e.message;}
}
$('contactForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{const r=await communityApi('/contact',{subject:f.elements.subject.value,category:f.elements.category.value,body:f.elements.body.value});f.reset();$('contactFormStatus').textContent=r.message;contactOffset=0;await loadContactPage();}catch(e){$('contactFormStatus').textContent=e.message;}finally{b.disabled=false;}};
window.addEventListener('reaction-auth-change',()=>{$('contactRequests').replaceChildren();$('contactInboxRequests').replaceChildren();$('contactInboxNav').hidden=true;$('contactForm').reset();$('contactFormStatus').textContent='';contactOffset=0;});
