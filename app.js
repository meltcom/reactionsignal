const state = { performer: 'missioned-souls', query: '', format: 'all', confidence: 'all', sort:'latest', visible:24 };
let catalog = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const prettyDate = (value) => { if (!value) return 'Date unknown'; const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date unknown' : d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };

function renderPerformers() {
  $('performerTabs').innerHTML = catalog.performers.map((p) => `<button class="performer-tab ${p.id === state.performer ? 'active' : ''}" data-performer="${p.id}">${escapeHtml(p.name)}</button>`).join('');
  document.querySelectorAll('[data-performer]').forEach((button) => button.addEventListener('click', () => { state.performer = button.dataset.performer; renderAll(); }));
}

function performerVideos() { return catalog.videos.filter(v => v.performerId === state.performer).filter(v => !state.query || `${v.title} ${v.channelName} ${v.song || ''}`.toLowerCase().includes(state.query.toLowerCase())).filter(v => state.format === 'all' || v.format === state.format).filter(v => state.confidence === 'all' || v.confidence === state.confidence).sort((a,b) => state.sort==='rated' ? communityRank(b.id)-communityRank(a.id) || new Date(b.publishedAt||0)-new Date(a.publishedAt||0) : state.sort==='discovered' ? new Date(b.discoveredAt||0)-new Date(a.discoveredAt||0) : new Date(b.publishedAt||0)-new Date(a.publishedAt||0)); }

function renderVideos() {
  const performer = catalog.performers.find(p => p.id === state.performer);
  $('feedTitle').textContent = `Latest ${performer.name} reactions`;
  const videos = performerVideos();
  $('emptyState').hidden = videos.length > 0;
  $('videoGrid').innerHTML = videos.slice(0, state.visible).map((v) => `<article class="video-card"><div class="card-top"><span class="tag ${v.isNew ? 'coral' : ''}">${v.isNew ? 'NEWLY DISCOVERED' : (v.confidence || 'CATALOGED')}</span><span class="tag">${v.format === 'SHORT' ? 'SHORT' : 'VIDEO'}</span></div><h3>${escapeHtml(v.title)}</h3><p class="reactor-name">${escapeHtml(v.channelName)}</p><div class="card-footer"><span>${prettyDate(v.publishedAt)}${v.views ? ` · ${Number(v.views).toLocaleString()} views` : ''}</span><a href="${escapeHtml(v.videoUrl)}" target="_blank" rel="noopener">Watch on YouTube ↗</a></div><div class="video-community"><span>${communityScore(v.id)}</span><button class="outline-button" data-community-video="${escapeHtml(v.id)}">Rate, comment & report</button></div></article>`).join('');
  $('moreVideos').hidden=videos.length<=state.visible;
  document.querySelectorAll('[data-community-video]').forEach(b=>b.addEventListener('click',()=>openCommunityVideo(b.dataset.communityVideo)));
}

function renderReactors() { const channels = catalog.channels.filter(c => c.performerId === state.performer).sort((a,b) => (b.reactions || 0) - (a.reactions || 0)).slice(0, 8); $('reactorGrid').innerHTML = channels.length ? channels.map((c,i) => `<article class="reactor-card"><span class="rank">0${i+1} · ${c.status || 'VERIFIED'}</span><h3>${escapeHtml(c.name)}</h3><p>${c.reactions || 0} cataloged reaction${c.reactions === 1 ? '' : 's'}</p><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">Open channel ↗</a></article>`).join('') : '<div class="empty-state">No Missioned Souls reactors match this view yet.</div>'; }

function renderAll() { renderPerformers(); renderNewReactors(); renderVideos(); renderReactors(); }
function renderNewReactors() { const el=$('newReactors'); const channels=catalog.channels.filter(c=>c.performerId===state.performer&&c.currentDiscovery); el.hidden=!channels.length; el.innerHTML=channels.length?`<strong>New reactors found in the latest scan</strong><div>${channels.map(c=>`<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.name)}</a>`).join(' · ')}</div>`:''; }

function renderDiscovery() {
  const d = catalog.discovery;
  $('discoveryStatus').textContent = d?.message || 'Historical catalog snapshot. Automatic updates are not active.';
  $('lastDiscovery').textContent = d?.lastDiscoveryRunAt ? new Date(d.lastDiscoveryRunAt).toLocaleString() : 'Not run yet';
  $('discoveryCoverage').textContent = d?.coverage ? `${d.coverage.checked || 0} of ${d.coverage.total} eligible Missioned Souls channels had their latest uploads checked in the past 24 hours. Historical scans are tracked separately.` : '';
  $('discoveryHistory').textContent = `${d?.historyBacklog || 0} channels have historical upload pages queued. Newly cataloged videos may have older upload dates.`;
  let health=document.getElementById('discoveryHealth');if(!health){health=document.createElement('p');health.id='discoveryHealth';$('discoveryHistory').after(health);}
  health.textContent=d?.scopes?`Channels: ${d.scopes.map(s=>s.discovery_scope+': '+s.n).join(', ')}. Recorded YouTube request attempts on ${d.requestDay} UTC: ${(d.youtubeRequests||[]).reduce((n,x)=>n+Number(x.value),0)} (${(d.youtubeRequests||[]).map(x=>x.key.split(':').at(-1)+': '+x.value).join(', ')}). New-upload discovery delay: ${d.delay?.samples||0} samples${d.delay?.samples?' · average '+Math.round(d.delay.average_seconds/60)+' minutes · maximum '+Math.round(d.delay.max_seconds/60)+' minutes':''}. Measurements begin with this deployment; request attempts exclude other scripts and are not Google quota totals.`:'';
  $('discoveryRuns').innerHTML = d?.runs?.length ? d.runs.map(r => `<p>${escapeHtml(r.started_at)} — ${escapeHtml(r.status)} · ${r.channels} recent channel checks · ${r.history_pages || 0} history pages · ${r.added} newly cataloged video IDs (${r.recent_added || 0} from recent checks, ${r.history_added || 0} from upload history, ${Math.max(0,r.added-(r.recent_added||0)-(r.history_added||0))} from performer searches) · ${r.calls} API calls${r.duration_ms ? ` · ${(r.duration_ms/1000).toFixed(1)}s elapsed · ${(r.api_ms/1000).toFixed(1)}s API requests (summed) · ${(r.db_ms/1000).toFixed(1)}s database · ${r.records_examined || 0} uploads examined · ${r.rows_read||0} measured D1 rows read · ${r.rows_written||0} written` : ''}${r.detail ? ` · ${escapeHtml(r.detail)}` : ''}</p>`).join('') : 'No hosted discovery runs yet.';
}
async function init() { try { const response = await reactionAuth.fetch('/data.json', {cache:'no-store'}); if(!response.ok) throw new Error('Unavailable'); catalog = await response.json(); $('catalogCount').textContent = catalog.stats.channels.toLocaleString(); $('performerCount').textContent = catalog.performers.length; await loadCommunity(); await loadDashboard(); renderAll(); renderDiscovery(); } catch (error) { $('discoveryStatus').textContent='The catalog service is temporarily unavailable. Please reload to retry.'; $('videoGrid').innerHTML = '<div class="empty-state">The catalog is temporarily unavailable. Please try again shortly.</div>'; } }

$('searchInput').addEventListener('input', (event) => { state.query = event.target.value; renderVideos(); });
$('formatFilter').addEventListener('change', (event) => { state.format = event.target.value; renderVideos(); });
$('confidenceFilter').addEventListener('change', (event) => { state.confidence = event.target.value; renderVideos(); });
$('followButton').addEventListener('click', () => document.querySelector('.performer-strip').scrollIntoView({ behavior:'smooth' }));
$('sortFilter').addEventListener('change',e=>{state.sort=e.target.value;renderVideos();});
$('moreVideos').addEventListener('click',()=>{state.visible+=24;renderVideos();});
