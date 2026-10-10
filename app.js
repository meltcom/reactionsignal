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
  if(d?.delaySources?.length)health.textContent+=' Discovery delay by source (past 24h; nonnegative delays up to 7 days): '+d.delaySources.map(x=>`${x.source}: ${x.samples} samples, average ${Math.round(x.average_seconds/60)} min, max ${Math.round(x.max_seconds/60)} min`).join('; ')+'.';
  if(d?.notificationDelays?.length)health.textContent+=' Feed timing (past 24h): '+d.notificationDelays.map(x=>`${x.source}: ${x.receipts} receipts, ${x.processed} processed; publication → receipt ${x.publication_samples?Math.round(x.publication_to_receipt_seconds/60)+' min average ('+x.publication_samples+' samples)':'unavailable'}; receipt → processing ${x.receipt_to_processed_seconds===null?'unavailable':Math.round(x.receipt_to_processed_seconds/60)+' min average'}`).join('; ')+'. Negative publication delays, including advance premieres, are excluded from publication averages.';
  if(d?.rss)health.textContent+=` RSS fallback: ${d.rss.coverage.checked||0} of ${d.rss.coverage.total} eligible channels checked successfully in 24h; ${d.rss.coverage.errors||0} feed errors.${d.rss.lastBatch?' Last batch: '+d.rss.lastBatch.checked+' checked, '+d.rss.lastBatch.queued+' queued, '+d.rss.lastBatch.failed+' failed.':''}`;
  if(d?.rss?.errors?.length)health.textContent+=' RSS error reasons: '+d.rss.errors.map(x=>`${x.error} (${x.channels} channels)`).join('; ')+'.';
  if(d?.rss?.lastBatch?.serviceStatus==='degraded')health.textContent+=` RSS polling reduced after repeated HTTP 404 responses; ${d.rss.lastBatch.deferred} feed checks deferred. API discovery runs before RSS polling; failed feeds retry after 15 minutes.`;
  if(d?.discoverySearch){const s=d.discoverySearch,b=s.lastBatch;health.textContent+=` Performer search: ${b?.status||'not yet measured'}${b?.reason?' — '+b.reason:''}; ${s.usedToday} search pages used today${b?'/'+b.dailyLimit:''}; ${s.pending?'continuation pending':'no continuation pending'}.${b?.nextDueAt?' Next eligible: '+new Date(b.nextDueAt).toLocaleString()+'.':''}${s.error?' Last error: '+s.error+'.':''}`;}
  if(d?.repairBaseline){const format=x=>`${x.source}: ${x.samples} samples, average ${Math.round(x.average_seconds/60)} min, max ${Math.round(x.max_seconds/60)} min`;health.textContent+=' Discovery repair measurement started '+new Date(d.repairBaseline.at).toLocaleString()+'. Previous 24h baseline: '+(d.repairBaseline.sources.map(format).join('; ')||'no samples')+'. Since repair (up to past 24h): '+(d.repairDelays.map(format).join('; ')||'waiting for newly discovered videos')+'.';}

  if(d?.channelStats)health.textContent+=` Subscriber refresh: ${d.channelStats.status} · ${d.channelStats.updated} of ${d.channelStats.checked} channels updated · ${d.channelStats.calls} request attempts · ${prettyDate(d.channelStats.at)}.`;
  let retryPanel=$('discoveryRetries');if(!retryPanel){retryPanel=document.createElement('div');retryPanel.id='discoveryRetries';health.after(retryPanel);}
  retryPanel.hidden=communityState?.moderator!==true;
  retryPanel.innerHTML=(d?.unavailableChannels||[]).map(c=>`<p>Unavailable: <a href="https://www.youtube.com/channel/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">${escapeHtml(c.name)}</a> · ${escapeHtml(c.id)} · ${c.recent_failures} consecutive failures · retry ${escapeHtml(c.recent_retry_at)} · ${escapeHtml(c.recent_error)}</p>`).join('');
  $('discoveryRuns').innerHTML = d?.runs?.length ? d.runs.map(r => `<p>${escapeHtml(r.started_at)} — ${escapeHtml(r.status)} · ${r.channels} recent channel checks · ${r.history_pages || 0} history pages · ${r.added} newly cataloged video IDs (${r.recent_added || 0} from recent checks, ${r.history_added || 0} from upload history, ${Math.max(0,r.added-(r.recent_added||0)-(r.history_added||0))} from performer searches) · ${r.calls} API calls${r.duration_ms ? ` · ${(r.duration_ms/1000).toFixed(1)}s elapsed · ${(r.api_ms/1000).toFixed(1)}s API requests (summed) · ${(r.db_ms/1000).toFixed(1)}s database · ${r.records_examined || 0} uploads examined · ${r.rows_read||0} measured D1 rows read · ${r.rows_written||0} written` : ''}${r.detail ? ` · ${escapeHtml(r.detail)}` : ''}</p>`).join('') : 'No hosted discovery runs yet.';
  if(communityState?.moderator===true)for(const r of d?.runs||[]){let queries=[];try{queries=JSON.parse(r.query_metrics||'[]');}catch{}if(!queries.length)continue;const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`Query diagnostics: ${r.started_at}`;details.append(summary);for(const q of queries){const line=document.createElement('p');line.textContent=`${q.rowsRead} rows read · ${q.rowsWritten} written · ${q.calls} calls · ${q.ms}ms individual requests · ${q.query}`;details.append(line);}$('discoveryRuns').append(details);}

}
async function init() {
  try {
    // Start independent member reads together; only rendering needs the catalog.
    const catalogLoad=(async()=>{const response=await reactionAuth.fetch('/data.json',{cache:'no-store'});if(!response.ok)throw new Error('Unavailable');catalog=await response.json();catalogEtag=response.headers.get('ETag');$('catalogCount').textContent=catalog.stats.channels.toLocaleString();$('performerCount').textContent=catalog.performers.length;})();
    const dashboardLoad=socialApi('/dashboard');
    const communityLoad=catalogLoad.then(()=>loadCommunity({deferSecondary:true}));
    const [, , memberDashboard]=await Promise.all([catalogLoad,communityLoad,dashboardLoad]);
    await loadDashboard(memberDashboard);
    renderAll();renderDiscovery();
    loadCoverage().catch(error=>communityMessage('communityStatus',error.message));
  } catch (error) {
    $('discoveryStatus').textContent='The catalog service is temporarily unavailable. Please reload to retry.';
    $('videoGrid').innerHTML='<div class="empty-state">The catalog is temporarily unavailable. Please try again shortly.</div>';
  }
}

$('searchInput').addEventListener('input', (event) => { state.query = event.target.value; renderVideos(); });
$('formatFilter').addEventListener('change', (event) => { state.format = event.target.value; renderVideos(); });
$('confidenceFilter').addEventListener('change', (event) => { state.confidence = event.target.value; renderVideos(); });
$('followButton').addEventListener('click', () => document.querySelector('.performer-strip').scrollIntoView({ behavior:'smooth' }));
$('sortFilter').addEventListener('change',e=>{state.sort=e.target.value;renderVideos();});
$('moreVideos').addEventListener('click',()=>{state.visible+=24;renderVideos();});
