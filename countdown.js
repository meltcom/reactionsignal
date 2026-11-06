export const localTime=(value)=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
const pad=n=>String(n).padStart(2,'0');
export function localInput(value){const d=new Date(value);return value&&Number.isFinite(+d)?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`:'';}
export function readStart(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(+d)||localInput(d.toISOString())!==value)throw Error('That time does not exist in your time zone. Choose a different time.');return d.toISOString();}
export function displayCountdown(root,settings,{now=Date.now}={}){
 root.replaceChildren();root.hidden=true;
 const target=Date.parse(settings.start);if(!settings.enabled||!Number.isFinite(target))return ()=>{};
 const url=(()=>{try{const u=new URL(settings.link);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}})();
 const card=document.createElement(url?'a':'div');card.className='countdown-card';
 if(url){card.href=url;card.target='_blank';card.rel='noopener noreferrer';}
 const title=document.createElement('strong');title.textContent=settings.title;
 const time=document.createElement('time');time.dateTime=settings.start;time.textContent=localTime(settings.start);
 const clock=document.createElement('span');clock.className='countdown-digits';clock.setAttribute('role','timer');clock.setAttribute('aria-live','off');
 const message=document.createElement('span');message.className='countdown-message';message.setAttribute('role','status');message.hidden=true;
 card.append(title,time,clock,message);if(url){const hint=document.createElement('span');hint.className='countdown-link';hint.textContent='Open event link ↗';card.append(hint);}
 root.append(card);root.hidden=false;
 let interval;
 function tick(){const seconds=Math.max(0,Math.ceil((target-now())/1000));if(!seconds){clock.hidden=true;message.hidden=false;message.textContent=settings.message;clearInterval(interval);return false;}clock.textContent=`${Math.floor(seconds/86400)}d ${pad(Math.floor(seconds/3600)%24)}h ${pad(Math.floor(seconds/60)%60)}m ${pad(seconds%60)}s`;return true;}
 if(tick())interval=setInterval(tick,1000);
 return ()=>clearInterval(interval);
}

export async function mountCountdownSettings(root,{load,save,afterSave=()=>{}}){
 root.innerHTML=`<h1>Countdown setup</h1><p>Show a countdown inside the My Feed banner. Members see the start time in their own time zone.</p><div class="countdown-settings"><form class="panel countdown-form"><label class="countdown-check"><input name="enabled" type="checkbox"> Show countdown in My Feed</label><label>Event title<input name="title" maxlength="100" placeholder="Missioned Souls Livestream YouTube Hangout"></label><label>Event date and time <small class="countdown-zone"></small><input name="start" type="datetime-local" step="60"></label><label>Website link <small>Optional</small><input name="link" type="url" maxlength="1000" placeholder="https://www.youtube.com/…"></label><label>Message at zero<textarea name="message" maxlength="200" rows="2" placeholder="The hangout is live! Click here to join."></textarea></label><div><button class="primary-button" type="submit">Save countdown</button></div><p class="countdown-status" role="status"></p></form><section class="panel countdown-preview"><h2>Member preview</h2><p>See how the banner looks before and after the event starts.</p><label>Preview state <select class="countdown-preview-state"><option value="before">Counting down</option><option value="after">At zero</option></select></label><div class="countdown-preview-banner"><strong>Your feed. Your rhythm.</strong><div class="countdown-example" hidden></div></div><p class="countdown-off">The countdown is off. Members see the original banner.</p></section></div>`;
 const form=root.querySelector('form'),fields=form.elements,status=root.querySelector('.countdown-status'),preview=root.querySelector('.countdown-example'),off=root.querySelector('.countdown-off'),mode=root.querySelector('.countdown-preview-state');
 root.querySelector('.countdown-zone').textContent=`(${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
 let stop=()=>{};
 const read=()=>({enabled:fields.enabled.checked,title:fields.title.value.trim(),start:readStart(fields.start.value),link:fields.link.value.trim(),message:fields.message.value.trim()});
 function update(){stop();try{const value=read();stop=displayCountdown(preview,{...value,title:value.title||'Event title',message:value.message||'Event start message'},{now:()=>Date.parse(value.start)+(mode.value==='after'?0:-3753000)});off.textContent=!value.enabled?'The countdown is off. Members see the original banner.':'Choose a start date and time to preview the countdown.';}catch(error){preview.hidden=true;off.textContent=error.message;}off.hidden=!preview.hidden;}
 form.addEventListener('input',update);mode.addEventListener('change',update);
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const value=read();if(value.enabled&&(!value.title||!value.start||!value.message))throw Error('Enter a title, start time, and message to turn on the countdown.');await save(value);status.textContent='Countdown settings saved.';await afterSave();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
 const button=form.querySelector('button');button.disabled=true;
 try{const value=await load();fields.enabled.checked=value.enabled;for(const key of ['title','message','link'])fields[key].value=value[key]||'';fields.start.value=localInput(value.start);update();button.disabled=false;}catch(error){status.textContent=error.message;}
 return ()=>stop();
}

const member=document.getElementById('feed-countdown');
if(member){
 let stop=()=>{},stopSettings=()=>{},opened=false,generation=0;
 const api=async(path,settings)=>{const response=await window.reactionAuth.fetch(path,{cache:'no-store',...(settings?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'Countdown unavailable.');return result;};
 const refresh=async()=>{const request=++generation;try{const data=await api('/api/countdown');if(request===generation){stop();stop=displayCountdown(member,data);}}catch{}};
 window.addEventListener('reaction-page-change',async({detail})=>{if(detail.page==='feed')void refresh();if(detail.page==='countdown-settings'&&!opened){opened=true;stopSettings=await mountCountdownSettings(document.getElementById('countdown-settings'),{load:()=>api('/api/moderator/countdown'),save:value=>api('/api/moderator/countdown',value),afterSave:refresh});}});
 window.addEventListener('reaction-auth-change',()=>{generation++;stop();stopSettings();opened=false;member.hidden=true;member.replaceChildren();document.getElementById('countdown-settings').replaceChildren();});
 if(window.reactionAuth?.account)void refresh();
}
