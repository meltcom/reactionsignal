(()=>{
 let staff=[],auditOffset=0,caseOffset=0;
 const api=async(path,body)=>{const r=await reactionAuth.fetch('/api/operations'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Operations unavailable.');return data;};
 const name=id=>staff.find(s=>s.id===id)?.email||id;
 async function summary(){
  try{const d=await api('/summary');staff=d.staff;$('operationsSummary').textContent=`Database: ${(d.databaseBytes/1048576).toFixed(1)} MiB · Pending contributions: ${d.queues.contribution.count} · Abuse reports: ${d.queues.abuse.count} · Open support: ${d.queues.contact.count} · Alerts: ${d.alertDeliveryConfigured?'destination configured':'destination not configured'} · ${d.coverageWarning||d.configuredModeratorCount+' moderators configured'}`;
   $('operationsWarnings').textContent=d.warnings.length?'Needs attention: '+d.warnings.join(', '):'No current monitored warning thresholds exceeded.';
   $('operationsStaff').textContent='Staff who have signed in: '+staff.map(s=>`${s.email} (${s.id})`).join('; ');
   await cases();
  }catch(e){$('operationsStatus').textContent=e.message;}
 }
 async function cases(){
  try{const kind=$('operationsCaseKind').value,d=await api('/cases?kind='+kind+'&assigned='+$('operationsCaseAssigned').value+'&offset='+caseOffset);
   $('operationsCases').innerHTML=d.items.map(c=>`<article class="review-item"><p>${escapeHtml(c.title)} · ${escapeHtml(c.created_at)}</p><p>Owner: ${escapeHtml(c.assignee_id?name(c.assignee_id):'Unassigned')}</p><label>Assign to<select data-case-assignee="${escapeHtml(c.id)}"><option value="">Unassigned</option>${staff.map(s=>`<option value="${escapeHtml(s.id)}" ${s.id===c.assignee_id?'selected':''}>${escapeHtml(s.email)}</option>`).join('')}</select></label><button data-assign-case="${escapeHtml(c.id)}" class="outline-button">Save assignment</button><p>Review ${escapeHtml(kind)} cases in the corresponding moderator queue or Contact Inbox.</p></article>`).join('')||'<p>No open cases in this filter.</p>';
   $('operationsCasesPrevious').disabled=caseOffset===0;$('operationsCasesNext').disabled=!d.hasMore;
   $('operationsCases').querySelectorAll('[data-assign-case]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const select=b.closest('article').querySelector('select');await api('/assign',{kind,id:b.dataset.assignCase,assignee:select.value});await cases();$('operationsStatus').textContent='Assignment saved.';}catch(e){$('operationsStatus').textContent=e.message;}finally{b.disabled=false;}});
  }catch(e){$('operationsStatus').textContent=e.message;}
 }
 async function audit(){
  try{const d=await api('/audit?offset='+auditOffset);$('operationsAudit').innerHTML=d.items.map(a=>`<article class="review-item"><strong>${escapeHtml(a.action)} · ${escapeHtml(a.target_kind)}</strong><p>By ${escapeHtml(name(a.actor_id))} · ${escapeHtml(a.created_at)}</p><p>Target: ${escapeHtml(a.target_id)}</p><p>${escapeHtml(a.reason)}</p><details><summary>Recorded evidence</summary><pre>${escapeHtml(JSON.stringify({before:JSON.parse(a.before_json||'null'),after:JSON.parse(a.after_json||'null')},null,2))}</pre></details></article>`).join('')||'<p>No recorded actions yet.</p>';$('operationsAuditPrevious').disabled=auditOffset===0;$('operationsAuditNext').disabled=!d.hasMore;}catch(e){$('operationsStatus').textContent=e.message;}
 }
 function mount(){
  if(!communityState?.moderator||$('operationsPanel'))return;
  const panel=document.createElement('details');panel.id='operationsPanel';panel.className='panel';panel.innerHTML='<summary><strong>Operations, staff assignments & audit</strong></summary><p id="operationsSummary"></p><p id="operationsWarnings" role="status"></p><p id="operationsStaff"></p><button id="operationsRefresh" class="outline-button">Refresh health & cases</button><label>Case type<select id="operationsCaseKind"><option value="abuse">Abuse reports</option><option value="contribution">Contributions</option><option value="contact">Support tickets</option><option value="reactor">Reactor requests</option></select></label><label>Assignment<select id="operationsCaseAssigned"><option value="all">All</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option></select></label><div id="operationsCases"></div><button id="operationsCasesPrevious" class="outline-button">Previous cases</button><button id="operationsCasesNext" class="outline-button">Next cases</button><h3>Moderator action history</h3><button id="operationsAuditRefresh" class="outline-button">Load audit history</button><div id="operationsAudit"></div><button id="operationsAuditPrevious" class="outline-button">Previous actions</button><button id="operationsAuditNext" class="outline-button">Next actions</button><p id="operationsStatus" role="status"></p>';
  $('review').append(panel);panel.addEventListener('toggle',()=>{if(panel.open)summary();});
  $('operationsRefresh').onclick=summary;$('operationsAuditRefresh').onclick=()=>{auditOffset=0;audit();};
  for(const id of ['operationsCaseKind','operationsCaseAssigned'])$(id).onchange=()=>{caseOffset=0;cases();};
  $('operationsCasesPrevious').onclick=()=>{caseOffset=Math.max(0,caseOffset-50);cases();};$('operationsCasesNext').onclick=()=>{caseOffset+=50;cases();};
  $('operationsAuditPrevious').onclick=()=>{auditOffset=Math.max(0,auditOffset-50);audit();};$('operationsAuditNext').onclick=()=>{auditOffset+=50;audit();};
 }
 window.addEventListener('reaction-page-change',e=>{if(e.detail.page==='review'){mount();refreshDiscoveryDiagnostics();}});
 window.addEventListener('reaction-auth-change',()=>{$('operationsPanel')?.remove();staff=[];auditOffset=caseOffset=0;});
})();
