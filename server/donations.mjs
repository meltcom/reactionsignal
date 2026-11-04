// Hosted PayPal Donate buttons use IPN, not REST-app webhooks.
// No browser callback or return URL is accepted as proof of payment.
const recipient='meltcom@gmail.com';
const button='H83DMS4NXCZLG';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function provider(env,request){
 if(!env.PAYPAL_MODE||env.PAYPAL_MODE==='live')return {recipient,button,sandbox:false,checkout:'https://www.paypal.com/donate/',verify:'https://ipnpb.paypal.com/cgi-bin/webscr'};
 if(env.PAYPAL_MODE!=='sandbox'||!['reactionsignal-staging.kk6mes.workers.dev','127.0.0.1','localhost','pilot.test'].includes(new URL(request.url).hostname))fail('Invalid PayPal test environment.',503);
 if(!env.PAYPAL_SANDBOX_RECEIVER_EMAIL||!env.PAYPAL_SANDBOX_BUTTON_ID)fail('PayPal sandbox settings are incomplete.',503);
 return {recipient:env.PAYPAL_SANDBOX_RECEIVER_EMAIL.toLowerCase(),button:env.PAYPAL_SANDBOX_BUTTON_ID,sandbox:true,checkout:'https://www.sandbox.paypal.com/donate/',verify:'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr'};
}
const bounds=now=>{const start=now.slice(0,10)+'T00:00:00.000Z';return [start,new Date(Date.parse(start)+86400000).toISOString()];};
export const offsetKey=(user,now)=>'donation-point-offset:'+now.slice(0,10)+':'+user;
export async function pointAllowance(db,user,now=new Date().toISOString()){
 const [start,end]=bounds(now);
 const earned=Number((await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM points WHERE user_id=? AND amount>0 AND created_at>=? AND created_at<?').bind(user,start,end).first())?.total||0);
 const offset=Number((await db.prepare('SELECT value FROM state WHERE key=?').bind(offsetKey(user,now)).first())?.value||0);
 const used=Math.max(0,earned-offset);
 const credits=Number((await db.prepare("SELECT COUNT(*) total FROM state WHERE key LIKE 'donation-receipt:%' AND json_extract(value,'$.user')=? AND json_extract(value,'$.status')='completed' AND json_extract(value,'$.used') IS NULL").bind(user).first())?.total||0);
 return {earnedToday:earned,used,remaining:Math.max(0,500-used),limit:500,warningAt:450,resetsAvailable:credits,resetsAt:end,day:start.slice(0,10)};
}
export async function donations(request,env,user,fetcher=fetch){
 try{
  const url=new URL(request.url),path=url.pathname.replace('/api/donations',''),db=env.DB;
  if(!db)fail('Storage unavailable.',503);
  if(path==='/ipn')return await receiveIPN(request,env,fetcher);
  if(!user)fail('Sign in to continue.',401);
  const trusted=await db.prepare('SELECT trusted FROM members WHERE id=?').bind(user.id).first();
  if(request.method==='GET'&&path==='/status')return json({...await pointAllowance(db,user.id),trusted:trusted?.trusted===1,enabled:env.DONATION_RESETS_ENABLED==='1',sandbox:env.PAYPAL_MODE==='sandbox'});
  if(request.method!=='POST')fail('POST required.',405);
  if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Use the Reaction Journey website.',403);
  if(env.DONATION_RESETS_ENABLED!=='1')fail('Donation resets are not enabled yet.',503);
  if(trusted?.trusted!==1)fail('This allowance applies to Trusted Members.',403);
  const now=new Date().toISOString(),allowance=await pointAllowance(db,user.id,now);
  if(path==='/start'){
   const paypal=provider(env,request);
   if(allowance.used<450)fail('Your allowance is not near its limit yet.',409);
   // Reuse a pending intent briefly to avoid creating rows on repeated clicks.
   let intent=await db.prepare("SELECT key FROM state WHERE key LIKE 'donation-intent:%' AND json_extract(value,'$.user')=? AND json_extract(value,'$.created')>? ORDER BY key LIMIT 1").bind(user.id,new Date(Date.now()-600000).toISOString()).first();
   const token=intent?.key.slice('donation-intent:'.length)||crypto.randomUUID();
   if(!intent)await db.prepare('INSERT INTO state(key,value) VALUES(?,?)').bind('donation-intent:'+token,JSON.stringify({user:user.id,created:now})).run();
   const checkout=new URL(paypal.checkout);
   checkout.search=new URLSearchParams({hosted_button_id:paypal.button,custom:token,notify_url:url.origin+'/api/donations/ipn',return:url.origin+'/#reputation',cancel_return:url.origin+'/#reputation',currency_code:'USD'}).toString();
   return json({url:checkout.href});
  }
  if(path==='/reset'){
   if(allowance.used<450)fail('Use your current allowance before resetting.',409);
   const credit=await db.prepare("SELECT key FROM state WHERE key LIKE 'donation-receipt:%' AND json_extract(value,'$.user')=? AND json_extract(value,'$.status')='completed' AND json_extract(value,'$.used') IS NULL ORDER BY key LIMIT 1").bind(user.id).first();
   if(!credit)fail('A verified donation is required for each reset.',409);
   const nonce=crypto.randomUUID(),[start,end]=bounds(now);
   // D1 batch is transactional. Only the caller that consumes the receipt may
   // write its offset; concurrent/repeated clicks cannot reuse the donation.
   const result=await db.batch([
    db.prepare("UPDATE state SET value=json_set(value,'$.used',?,'$.reset',?) WHERE key=? AND json_extract(value,'$.user')=? AND json_extract(value,'$.status')='completed' AND json_extract(value,'$.used') IS NULL AND COALESCE((SELECT SUM(amount) FROM points WHERE user_id=? AND amount>0 AND created_at>=? AND created_at<?),0)-CAST(COALESCE((SELECT value FROM state WHERE key=?),'0') AS INTEGER)>=450").bind(now,nonce,credit.key,user.id,user.id,start,end,offsetKey(user.id,now)),
    db.prepare("INSERT INTO state(key,value) SELECT ?,CAST(COALESCE((SELECT SUM(amount) FROM points WHERE user_id=? AND amount>0 AND created_at>=? AND created_at<?),0) AS TEXT) WHERE EXISTS(SELECT 1 FROM state WHERE key=? AND json_extract(value,'$.reset')=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(offsetKey(user.id,now),user.id,start,end,credit.key,nonce)
   ]);
   if(!result[0].meta.changes)fail('This reset was already used. Refresh your allowance.',409);
   return json({ok:true,...await pointAllowance(db,user.id,now)});
  }
  fail('Not found.',404);
 }catch(error){return json({error:error.status?error.message:'Donation verification is temporarily unavailable.'},error.status||503);}
}
export async function receiveIPN(request,env,fetcher=fetch){
 if(request.method!=='POST')return json({error:'POST required.'},405);
 if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return json({error:'Form notification required.'},415);
 const raw=await request.text();if(raw.length>32768)return json({error:'Notification too large.'},413);
 const params=new URLSearchParams(raw);
 const paypal=provider(env,request);
 // Reject duplicate fields before parsing security-sensitive values.
 if([...new Set(params.keys())].some(key=>params.getAll(key).length!==1))return json({error:'Duplicate notification fields.'},400);
 if(params.has('cmd')||(params.get('test_ipn')==='1')!==paypal.sandbox)return json({error:'Unsupported notification.'},400);
 const verification=await fetcher(paypal.verify,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'cmd=_notify-validate&'+raw,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!verification.ok||await verification.text()!=='VERIFIED')return json({error:'Payment not verified.'},400);
 if((params.get('receiver_email')||'').toLowerCase()!==paypal.recipient)return json({error:'Recipient mismatch.'},400);
 const txn=params.get('txn_id')||'',status=params.get('payment_status'),db=env.DB;
 if(!/^[A-Za-z0-9]{6,30}$/.test(txn))return json({error:'Invalid transaction.'},400);
 const parent=params.get('parent_txn_id')||'';
 if(['Refunded','Reversed'].includes(status)&&/^[A-Za-z0-9]{6,30}$/.test(parent)){
  // Tombstones also block a delayed Completed notification after a refund.
  await db.prepare("INSERT INTO state(key,value) VALUES(?,json_object('status','revoked')) ON CONFLICT(key) DO UPDATE SET value=json_set(value,'$.status','revoked')").bind('donation-receipt:'+parent).run();
  return json({ok:true});
 }
 if(status!=='Completed')return json({ok:true,ignored:true});
 if(params.get('txn_type')!=='web_accept'||params.get('mc_currency')!=='USD'||!/^\d+(\.\d{1,2})?$/.test(params.get('mc_gross')||'')||Number(params.get('mc_gross'))<=0)return json({error:'Unsupported donation.'},400);
 const token=params.get('custom')||'';
 if(!/^[a-f0-9-]{36}$/.test(token))return json({error:'Donation reference missing.'},400);
 const intent=await db.prepare('SELECT value FROM state WHERE key=?').bind('donation-intent:'+token).first();
 if(!intent)return json({error:'Donation reference unknown.'},400);
 const {user}=JSON.parse(intent.value);
 await db.prepare('INSERT OR IGNORE INTO state(key,value) VALUES(?,?)').bind('donation-receipt:'+txn,JSON.stringify({user,status:'completed',verified:new Date().toISOString()})).run();
 return json({ok:true});
}
