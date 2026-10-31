// Local measurement and review controls. All evidence text is rendered as text.
let reviewOffset=0, reviewSample=null, selectedVideo=null;
const byId=id=>document.getElementById(id);
const metric=value=>value==null?'Not measured':typeof value==='number'?value.toLocaleString():String(value);
function measurementRows(id,items,columns){rows(id,items.map(item=>Object.fromEntries(columns.map(k=>[k,metric(item[k])]))),columns)}
function renderMeasurements(s){
  const m=s.measurements;
  if(!m){byId('measurement-state').textContent='Sample mode: activity figures are illustrative. Measurement results require actual recorded work.';return}
  byId('measurement-state').textContent=`${m.version} · ${m.matcher} · Pacific dates · As of ${new Date(m.as_of).toLocaleString()}`;
  const current=m.daily[0],life=m.lifetime;
  byId('verified-today').textContent=metric(current.verified_missing);
  byId('saved-requests').textContent=metric(current.metadata_requests_avoided);
  byId('saved-ids').textContent=`${metric(current.metadata_ids_avoided)} video metadata lookups avoided today`;
  byId('review-time').textContent=`${metric(m.review_seconds)} seconds across ${metric(m.review_time_samples)} timed review events`;
  byId('review-outcomes').textContent=Object.entries(m.review_outcomes).map(([k,v])=>`${k.replaceAll('_',' ')}: ${v}`).join(' · ')||'No review outcomes recorded';
  byId('unfinished').textContent=`${life.unfinished_requests} unfinished requests · ${life.legacy_requests} requests without v2 attribution`;
  const gate=m.broker;
  byId('broker-state').textContent=gate?`Last gate check: ${gate.ready?'ready':gate.reason||'blocked'} · ${new Date(gate.checked_at).toLocaleString()}`:'RJ quota gate has not been checked. Configure the dedicated broker credential locally, then check readiness.';
  byId('broker-quota').textContent=`Pilot provider units: ${life.general_units_confirmed} confirmed · ${life.general_units_unknown} ambiguous · ${life.broker_denials} admissions blocked without a YouTube request`;
  byId('broker-policy').textContent=gate?.ledger?`Shared general: ${gate.ledger.general} / ${gate.generalLimit} · Backfill: ${gate.ledger.backfill} / ${gate.backfillLimit} · RJ reserve: ${gate.reserve} · Search allowance for pilot: 0`:'The Worker enforces shared reservations on every request. A readiness check is only a snapshot.';
  measurementRows('measurement-daily',m.daily,['day','requests','failures','unfinished_requests','pages','encountered','existing_ids','repeat_ids','candidates','verified_missing','metadata_requests_avoided','review_events']);
  measurementRows('measurement-weekly',['requests','pages','encountered','existing_ids','repeat_ids','candidates','verified_missing','verified_per_request','metadata_requests_avoided','request_duration_samples','p95_request_ms','measured_days'].map(k=>({name:k.replaceAll('_',' '),current:m.weekly[k],previous:m.previous_week[k]})),['name','current','previous']);
  const names=new Map(s.channels.map(c=>[c.id,c.name]));
  measurementRows('strategy-yield',m.yields.map(r=>({...r,channel:names.get(r.channel)||r.channel||'—',window:`${r.window_start||'Beginning'} → ${r.window_end||'—'}`,query:r.query||'Uploads playlist',config:r.config_hash.slice(0,12)})),['strategy','matcher','config','channel','query','window','depth','requests','new_records','candidates','verified_missing','verified_per_request','p95_request_ms']);
  measurementRows('audit-summary',m.audit_samples.map(r=>({...r,state:r.complete?'Fully reviewed':'Incomplete',interval:r.wilson_95_interval?r.wilson_95_interval.map(v=>(v*100).toFixed(1)+'%').join(' – '):'Not estimated'})),['id','stratum','population','sample_size','reviewed','positive','state','interval']);
  const monitor=m.monitor;
  byId('monitor-state').textContent=`RJ monitor: ${monitor.status} · Health samples: ${monitor.health_status||'missing'}. ${monitor.message}`;
  byId('monitor-observed').textContent=monitor.exported_at?`Snapshot ${new Date(monitor.exported_at).toLocaleString()} · Observed RJ general-request upper bound: ${metric(monitor.observed_rj_general_upper_bound)} · Pilot: ${metric(monitor.pilot_general)} · Other consumers: unknown`:'Import a read-only RJ monitor snapshot to view observed usage and fresh-discovery health.';
  const before=monitor.before_pilot||{},during=monitor.during_pilot||{};
  measurementRows('health-comparison',['health_samples','fresh_delay_samples','minimum_coverage','failed_runs','median_fresh_delay_seconds','p90_fresh_delay_seconds'].map(k=>({name:k.replaceAll('_',' '),before:before[k],during:during[k]})),['name','before','during']);
  byId('health-note').textContent=monitor.comparison_note||'No before/during comparison yet.';
}
async function postMeasurement(path,payload){
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pilot-Token':document.querySelector('meta[name="pilot-token"]').content},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
}
async function loadEvidence(){
  if(demo){byId('review-notice').textContent='Review controls use actual evidence in the live dashboard.';return}
  try{
    const query=new URLSearchParams({classification:byId('review-filter').value,offset:String(reviewOffset)});
    if(reviewSample)query.set('sample',reviewSample);
    const response=await fetch('/api/evidence?'+query);const data=await response.json();if(!response.ok)throw Error(data.error);
    byId('review-count').textContent=`${data.total?data.offset+1:0}–${Math.min(data.offset+50,data.total)} of ${data.total}`;
    byId('review-previous').disabled=!data.offset;byId('review-next').disabled=data.offset+50>=data.total;
    const body=byId('review-records');body.replaceChildren();
    for(const record of data.rows){const tr=document.createElement('tr');cell(tr,record.title);cell(tr,record.classification);cell(tr,record.outcome||'Not reviewed');const td=cell(tr,'');const button=document.createElement('button');button.className='secondary';button.textContent='Review';button.onclick=()=>selectEvidence(record);td.append(button);body.append(tr)}
  }catch(e){byId('review-notice').textContent=e.message}
}
function selectEvidence(record){
  selectedVideo=record;byId('review-video').textContent=`${record.title} (${record.id})`;
  byId('review-link').href='https://www.youtube.com/watch?v='+encodeURIComponent(record.id);byId('review-link').hidden=false;
  byId('review-evidence').textContent=JSON.stringify(JSON.parse(record.evidence),null,2);
  byId('outcome').value=record.outcome||'unresolved';byId('review-reason').value='';byId('review-proof').value='';byId('live-check').value='';byId('review-seconds').value='';byId('attest').checked=false;
}
function setupMeasurements(){
  byId('check-broker').onclick=async()=>{try{if(demo)throw Error('Use the actual campaign dashboard');await postMeasurement('broker-check',{});await refresh()}catch(e){byId('broker-state').textContent=e.message}};
  byId('review-load').onclick=()=>{reviewOffset=0;reviewSample=null;loadEvidence()};
  byId('review-previous').onclick=()=>{reviewOffset=Math.max(0,reviewOffset-50);loadEvidence()};
  byId('review-next').onclick=()=>{reviewOffset+=50;loadEvidence()};
  byId('create-sample').onclick=async()=>{try{if(demo)throw Error('Samples require the actual campaign');const sample=await postMeasurement('sample',{stratum:byId('sample-stratum').value,size:Number(byId('sample-size').value),seed:Number(byId('sample-seed').value)});reviewSample=sample.id;reviewOffset=0;byId('review-notice').textContent=`Saved sample ${sample.id}; population ${sample.population}, selected ${sample.sample_size}.`;await loadEvidence();await refresh()}catch(e){byId('review-notice').textContent=e.message}};
  byId('save-review').onclick=async()=>{try{if(!selectedVideo)throw Error('Select an evidence record first');const checked=byId('live-check').value;await postMeasurement('review',{video_id:selectedVideo.id,outcome:byId('outcome').value,reason:byId('review-reason').value,evidence:byId('review-proof').value,live_checked_at:checked?new Date(checked).toISOString():null,live_check_attested:byId('attest').checked,review_seconds:byId('review-seconds').value===''?null:Number(byId('review-seconds').value),sample_id:reviewSample});byId('review-notice').textContent='Review saved to local audit history; RJ was not modified.';await loadEvidence();await refresh()}catch(e){byId('review-notice').textContent=e.message}};
  byId('import-monitor').onclick=async()=>{try{if(demo)throw Error('Monitor import requires the actual campaign');const file=byId('monitor-file').files[0];if(!file)throw Error('Choose a monitor JSON file');await postMeasurement('monitor',JSON.parse(await file.text()));await refresh()}catch(e){byId('monitor-state').textContent=e.message}};
}
