import {database} from './db.mjs';
import {recordOperationalEvent} from './operations.mjs';
export const scope='https://www.googleapis.com/auth/youtube.readonly';
const day=86400000;
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
export const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async text=>b64(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
export function configured(env){return /^[\w-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_YOUTUBE_CLIENT_ID||'')&&!!env.GOOGLE_YOUTUBE_CLIENT_SECRET&&/^[A-Za-z0-9_-]{43}$/.test(env.YOUTUBE_TOKEN_ENCRYPTION_KEY||'')&&/^https:\/\/[\w.-]+$/.test(env.YOUTUBE_OAUTH_ORIGIN||'');}
async function key(env){if(!configured(env))throw new Error('YouTube connection setup is incomplete.');return crypto.subtle.importKey('raw',bytes(env.YOUTUBE_TOKEN_ENCRYPTION_KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function seal(env,value,aad){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},await key(env),encoder.encode(value));return b64(iv)+'.'+b64(cipher);}
export async function unseal(env,value,aad){const [iv,cipher]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:encoder.encode(aad)},await key(env),bytes(cipher)));}
// Workers accepts manual/follow, but rejects redirect:'error'. Keep credentials
// on the intended Google endpoint by never following redirects.
export async function google(env,url,params){return (env.YOUTUBE_FETCH||fetch)(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(10000),redirect:'manual'});}
export async function revoke(env,token){const r=await google(env,'https://oauth2.googleapis.com/revoke',{token});if(r.ok)return true;if(r.status===400){const d=await r.json().catch(()=>({}));return d.error==='invalid_token';}return false;}
export async function deleteConnection(env,row,{revokeToken=false}={}){
 const db=database(env),ops=[];
 // Queue before deleting so a network failure never leaves the member's data accessible.
 if(revokeToken)ops.push(db.prepare('INSERT OR IGNORE INTO youtube_revoke_jobs(id,token_cipher,created_at) VALUES(?,?,?)').bind(row.id,row.token_cipher,Date.now()));
 ops.push(db.prepare("DELETE FROM follows WHERE user_id=? AND kind='reactor' AND target IN(SELECT target FROM youtube_imported_follows WHERE user_id=? AND connection_id=?)").bind(row.user_id,row.user_id,row.id));
 ops.push(db.prepare('DELETE FROM youtube_imported_follows WHERE user_id=? AND connection_id=?').bind(row.user_id,row.id));
 ops.push(db.prepare('DELETE FROM youtube_connections WHERE user_id=? AND id=?').bind(row.user_id,row.id));
 ops.push(db.prepare('DELETE FROM youtube_oauth_states WHERE user_id=?').bind(row.user_id));
 await db.batch(ops);
 if(revokeToken)await processRevocations(env,row.id);
}
export async function processRevocations(env,onlyId){if(!configured(env))return;const db=database(env);const rows=(await db.prepare('SELECT * FROM youtube_revoke_jobs'+(onlyId?' WHERE id=?':' ORDER BY created_at LIMIT 20')).bind(...(onlyId?[onlyId]:[])).all()).results;for(const row of rows){try{const token=await unseal(env,row.token_cipher,'connection:'+row.id);if(await revoke(env,token))await db.prepare('DELETE FROM youtube_revoke_jobs WHERE id=?').bind(row.id).run();}catch{/* Retry without logging tokens or provider responses. */}}}
export async function accessToken(env,row){
 const token=await unseal(env,row.token_cipher,'connection:'+row.id);
 const r=await google(env,'https://oauth2.googleapis.com/token',{client_id:env.GOOGLE_YOUTUBE_CLIENT_ID,client_secret:env.GOOGLE_YOUTUBE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:token});
 const data=await r.json().catch(()=>({}));
 if(r.status===400&&data.error==='invalid_grant'){await deleteConnection(env,row);throw Object.assign(new Error('Google access was revoked or expired. Imported follows were removed. Connect again to import.'),{status:409});}
 if(!r.ok||!data.access_token)throw Object.assign(new Error('Google permission check is temporarily unavailable. Your follows have been preserved.'),{status:503});
 if(data.scope&&!data.scope.split(' ').includes(scope)){await deleteConnection(env,row,{revokeToken:true});throw Object.assign(new Error('YouTube permission is no longer available. Imported follows were removed.'),{status:409});}
 const now=Date.now();await database(env).prepare('UPDATE youtube_connections SET verified_at=?,checked_at=? WHERE id=?').bind(now,now,row.id).run();return data.access_token;
}
export async function checkYoutubeConnections(env){
 const db=database(env),now=Date.now();
 await db.prepare('DELETE FROM youtube_oauth_states WHERE expires_at<?').bind(now).run();
 await db.prepare('DELETE FROM youtube_revoke_jobs WHERE created_at<?').bind(now-7*day).run();
 // Hard deadline prevents indefinite retention if Google is unreachable.
 const stale=(await db.prepare('SELECT * FROM youtube_connections WHERE verified_at<? LIMIT 100').bind(now-25*day).all()).results;
 for(const row of stale)await deleteConnection(env,row,{revokeToken:true});
 if(!configured(env))return;
 await processRevocations(env);
 const due=(await db.prepare('SELECT * FROM youtube_connections WHERE checked_at<? ORDER BY checked_at LIMIT 20').bind(now-day).all()).results;
 for(const row of due){await db.prepare('UPDATE youtube_connections SET checked_at=? WHERE id=?').bind(now,row.id).run();try{await accessToken(env,row);}catch{/* Definitive revocation purges; temporary failures retry next day. */}}
}
export async function startConnection(request,env,user){
 if(!configured(env))return Response.json({error:'YouTube connection setup is incomplete. Manual follows remain available.'},{status:503});
 const origin=env.YOUTUBE_OAUTH_ORIGIN;if(new URL(request.url).origin!==origin)return Response.json({error:'Connect on the configured Reaction Journey origin.'},{status:403});
 const db=database(env);if(await db.prepare('SELECT id FROM youtube_connections WHERE user_id=?').bind(user.id).first())return Response.json({error:'Already connected. Re-import or disconnect before choosing another account.'},{status:409});
 const state=random(),hash=await digest(state),verifier=random();
 await db.batch([db.prepare('DELETE FROM youtube_oauth_states WHERE user_id=?').bind(user.id),db.prepare('INSERT INTO youtube_oauth_states(hash,user_id,verifier_cipher,expires_at) VALUES(?,?,?,?)').bind(hash,user.id,await seal(env,verifier,'state:'+hash),Date.now()+600000)]);
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GOOGLE_YOUTUBE_CLIENT_ID,redirect_uri:origin+'/api/youtube/subscriptions/callback',response_type:'code',scope,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false',state,code_challenge:await digest(verifier),code_challenge_method:'S256'}).toString();
 return Response.json({authorizationUrl:url.toString()},{headers:{'Set-Cookie':`rj_youtube_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/youtube/subscriptions/callback; Max-Age=600`,'Cache-Control':'no-store'}});
}
export async function finishConnection(request,env){
 const url=new URL(request.url),state=url.searchParams.get('state')||'',cookie=request.headers.get('Cookie')||'';
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'rj_youtube_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/youtube/subscriptions/callback; Max-Age=0'};
 const back=status=>new Response(null,{status:303,headers:{...headers,Location:env.YOUTUBE_OAUTH_ORIGIN+'/?youtube='+status+'#reactors'}});
 const outcome=async(status,reason)=>{await recordOperationalEvent(env,'youtube-oauth-'+reason,status==='failed'?'error':'info');return back(status);};
 if(!configured(env)||url.origin!==env.YOUTUBE_OAUTH_ORIGIN)return new Response('YouTube connection setup is incomplete.',{status:503,headers});
 if(!/^[\w-]{43}$/.test(state)||!cookie.split(';').some(c=>c.trim()==='rj_youtube_state='+state))return new Response('Invalid connection request. Start again in Reaction Journey.',{status:400,headers});
 const hash=await digest(state),db=database(env);
 // Consume once, but retain the row during exchange so disconnect can cancel it.
 const states=await db.prepare('UPDATE youtube_oauth_states SET used=1 WHERE hash=? AND used=0 RETURNING *').bind(hash).all();const row=states.results[0];
 if(!row||row.expires_at<Date.now())return new Response('Connection request expired. Start again.',{status:400,headers});
 if(url.searchParams.has('error'))return outcome('cancelled','consent-cancelled');
 const code=url.searchParams.get('code');if(!code||code.length>4096)return outcome('failed','missing-code');
 let stage='connection-check';
 try{
  if(await db.prepare('SELECT id FROM youtube_connections WHERE user_id=?').bind(row.user_id).first())return back('already-connected');
  stage='state-decryption';const verifier=await unseal(env,row.verifier_cipher,'state:'+hash);
  stage='token-exchange';const r=await google(env,'https://oauth2.googleapis.com/token',{client_id:env.GOOGLE_YOUTUBE_CLIENT_ID,client_secret:env.GOOGLE_YOUTUBE_CLIENT_SECRET,code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:env.YOUTUBE_OAUTH_ORIGIN+'/api/youtube/subscriptions/callback'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.refresh_token||!data.scope?.split(' ').includes(scope)){
   const reason=!r.ok?('token-'+(['invalid_client','invalid_grant','redirect_uri_mismatch','unauthorized_client','invalid_request'].includes(data.error)?data.error:'rejected')):!data.refresh_token?'refresh-token-missing':'scope-missing';
   await recordOperationalEvent(env,'youtube-oauth-'+reason);if(data.refresh_token){try{await revoke(env,data.refresh_token);}catch{}}return back('failed');
  }
  const id=crypto.randomUUID(),now=Date.now();stage='token-encryption';const cipher=await seal(env,data.refresh_token,'connection:'+id);
  stage='connection-save';const inserted=await db.prepare('INSERT INTO youtube_connections SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM youtube_oauth_states WHERE hash=? AND expires_at>?) RETURNING id').bind(row.user_id,id,cipher,now,now,now,hash,now).all();
  stage='state-cleanup';await db.prepare('DELETE FROM youtube_oauth_states WHERE hash=?').bind(hash).run();if(!inserted.results.length){try{await revoke(env,data.refresh_token);}catch{}return outcome('cancelled','save-cancelled');}return outcome('connected','connected');
 }catch{return outcome('failed',stage);}
}
