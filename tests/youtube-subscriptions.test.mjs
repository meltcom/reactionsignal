import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {seal,unseal,scope,checkYoutubeConnections,startConnection,finishConnection} from '../server/youtube-connection.mjs';
import {youtubeSubscriptions} from '../server/youtube-subscriptions.mjs';
import {matchSubscriptions,readSubscriptions} from '../youtube-subscriptions-core.js';
const id=n=>'UC'+String(n).padStart(22,'0');
function setup(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 // Model D1 metadata, including writes made by activity triggers.
 const db={prepare(q){let v=[];return {bind(...a){v=a;return this;},async first(){return sql.prepare(q).get(...v)||null;},async all(){return {results:sql.prepare(q).all(...v)};},async run(){const before=sql.prepare('SELECT total_changes() n').get().n;const results=sql.prepare(q).all(...v);return {results,meta:{changes:Number(sql.prepare('SELECT total_changes() n').get().n-before)}};}}},async batch(ss){sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[1,2,3].map(n=>({id:id(n),name:'Reactor '+n,performerId:'missioned-souls'})),videos:[]};
 const env={DB:db,GOOGLE_YOUTUBE_CLIENT_ID:'123-abc.apps.googleusercontent.com',GOOGLE_YOUTUBE_CLIENT_SECRET:'fixture-secret',YOUTUBE_TOKEN_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',YOUTUBE_OAUTH_ORIGIN:'https://reactionjourney.com'};
 env.YOUTUBE_TOKEN_ENCRYPTION_KEY='A'.repeat(43);
 env.YOUTUBE_FETCH=async(url,opts)=>{if(String(url).endsWith('/revoke'))return new Response(null,{status:200});if(String(url).endsWith('/token'))return Response.json({access_token:'fixture-access',scope});return Response.json({items:[{snippet:{resourceId:{channelId:id(1)}}}]});};
 const ready=(async()=>{for(const user of ['member-a','member-b'])await db.prepare('INSERT INTO youtube_connections VALUES(?,?,?,?,?,?)').bind(user,user,await seal(env,'fixture-refresh','connection:'+user),Date.now(),Date.now(),Date.now()).run();})();
 const call=async(body,user={id:'member-a'},origin='https://reactionjourney.com',method='POST',path='import',extra={})=>{await ready;if(path==='import'&&body&&body.connectionId===undefined)body={...body,connectionId:user?.id};const r=await youtubeSubscriptions(new Request('https://reactionjourney.com/api/youtube/subscriptions/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{...env,...extra},seed,user);return {status:r.status,data:await r.json()};};return {sql,call,db,env,ready};
}
test('read-only preview matches IDs, deduplicates, and excludes hidden or followed reactors',()=>{
 const channels=[1,2,3].map(n=>({id:id(n),name:'Reactor '+n}));const r=matchSubscriptions([id(1),id(1),id(2),id(3),id(4)],channels,[{kind:'reactor',target:id(2)}],[{channel_id:id(3)}]);assert.deepEqual(r.matches,[channels[0]]);assert.equal(r.total,4);assert.equal(r.unmatched,1);assert.equal(r.alreadyFollowing,1);assert.equal(r.hiddenCount,1);
});
test('reads every page with bearer header, no API key, and deduplicates',async()=>{
 let n=0;const progress=[];const items=ids=>ids.map(id=>({snippet:{resourceId:{channelId:id}}}));const ids=await readSubscriptions('fixture-token',{onProgress:n=>progress.push(n),fetcher:async(url,opts)=>{assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Authorization,'Bearer fixture-token');assert.equal(url.searchParams.get('mine'),'true');assert.equal(url.searchParams.get('maxResults'),'50');assert.equal(url.searchParams.has('key'),false);assert.equal(url.toString().includes('fixture-token'),false);return ++n===1?Response.json({items:items([id(1)]),nextPageToken:'next'}):(assert.equal(url.searchParams.get('pageToken'),'next'),Response.json({items:items([id(1),id(2)])}));}});assert.deepEqual(ids,[id(1),id(2)]);assert.deepEqual(progress,[1,2]);
});
test('errors for expired permission, quota, malformed pagination, cancellation; no partial preview',async()=>{
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({}, {status:401})}),/expired/);
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({error:{errors:[{reason:'quotaExceeded'}]}},{status:403})}),/quota/);
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({items:[],nextPageToken:'repeat'})}),/stalled/);
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({})}),/invalid/);
 const c=new AbortController();c.abort();await assert.rejects(()=>readSubscriptions('x',{signal:c.signal,fetcher:async(u,o)=>{o.signal.throwIfAborted();}}),{name:'AbortError'});
});
test('import counts follows rather than trigger writes and remains idempotent',async()=>{
 const {sql,call}=setup();
 assert.deepEqual((await call({channelIds:[id(1),id(2),id(3)]})).data,{added:3,skipped:0});
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-a' AND kind='reactor'").get().n,3);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM user_activity WHERE user_id='member-a' AND kind='follow'").get().n,0);
 assert.deepEqual((await call({channelIds:[id(1),id(2),id(3)]})).data,{added:0,skipped:3});
});

test('import is add-only, duplicate safe, account isolated and rechecks hidden state',async()=>{
 const {sql,call}=setup();await call({channelIds:[id(1)]});sql.prepare('INSERT INTO hidden_reactors VALUES(?,?,?)').run('member-a',id(2),'now');sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member-a','song','existing');
 const r=await call({channelIds:[id(1),id(1),id(2),id(3)],userId:'member-b'});assert.deepEqual(r.data,{added:1,skipped:2});assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-a'").get().n,3);assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-b'").get().n,0);assert.equal((await call({channelIds:[id(3)]})).data.added,0);assert.equal((await call({channelIds:[id(2)]},{id:'member-b'})).data.added,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM hidden_reactors').get().n,1);
});
test('rejects unauthenticated, cross-origin, oversized, invalid or unknown channels before writing',async()=>{
 const {sql,call}=setup();assert.equal((await call({channelIds:[id(1)]},null)).status,401);assert.equal((await call({channelIds:[id(1)]},undefined,'https://evil.test')).status,403);assert.equal((await call({channelIds:[]})).status,400);assert.equal((await call({channelIds:['@name']})).status,400);assert.equal((await call({channelIds:Array(101).fill(id(1))})).status,400);assert.equal((await call({channelIds:[id(1),id(99)]})).status,409);assert.equal(sql.prepare('SELECT COUNT(*) n FROM follows').get().n,0);
});
test('configuration returns status without credentials',async()=>{
 const {call}=setup();const result=await call(null,undefined,undefined,'GET','config');assert.equal(result.data.configured,true);assert.equal(result.data.connected,true);assert.equal(JSON.stringify(result.data).includes('fixture-secret'),false);
 assert.equal((await call(null,undefined,undefined,'GET','config',{GOOGLE_YOUTUBE_CLIENT_SECRET:''})).data.configured,false);
});
test('disconnect deletes only tracked imports and cancels pending authorization',async()=>{
 const {sql,call,env,ready}=setup();await ready;
 await call({channelIds:[id(1)]});sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member-a','reactor',id(2));sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member-a','song','song');
 await call({channelIds:[id(1)]},{id:'member-b'});
 assert.equal((await call({},undefined,undefined,'POST','disconnect')).status,400);
 assert.equal((await call({confirm:true},undefined,'https://evil.test','POST','disconnect')).status,403);
 assert.equal((await call({confirm:true},undefined,undefined,'POST','disconnect')).status,200);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-a'").get().n,2);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-b'").get().n,1);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM user_activity WHERE user_id='member-a' AND target=?").get(id(1)).n,0);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM youtube_connections WHERE user_id='member-a'").get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_revoke_jobs').get().n,0);
 assert.equal((await call({channelIds:[id(1)]})).status,409);
});
test('scheduled check distinguishes revocation from temporary and configuration failures',async()=>{
 const {sql,call,env}=setup();await call({channelIds:[id(1)]});
 sql.prepare('UPDATE youtube_connections SET checked_at=0').run();env.YOUTUBE_FETCH=async()=>Response.json({error:'server_error'},{status:503});await checkYoutubeConnections(env);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-a'").get().n,1);
 sql.prepare('UPDATE youtube_connections SET checked_at=0').run();env.YOUTUBE_FETCH=async()=>Response.json({error:'invalid_client'},{status:400});await checkYoutubeConnections(env);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_connections').get().n,2);
 sql.prepare('UPDATE youtube_connections SET checked_at=0').run();env.YOUTUBE_FETCH=async()=>Response.json({error:'invalid_grant'},{status:400});await checkYoutubeConnections(env);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_connections').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_imported_follows').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM follows').get().n,0);
});
test('bounded retention removes unverifiable connections and revocation retries are private',async()=>{
 const {sql,call,env}=setup();await call({channelIds:[id(1)]});sql.prepare('UPDATE youtube_connections SET verified_at=0').run();env.YOUTUBE_FETCH=async()=>{throw new Error('offline')};await checkYoutubeConnections(env);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM follows').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_connections').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_revoke_jobs').get().n,2);
 const cipher=sql.prepare('SELECT token_cipher FROM youtube_revoke_jobs LIMIT 1').get().token_cipher;assert.equal(cipher.includes('fixture-refresh'),false);
 env.YOUTUBE_FETCH=async()=>new Response(null,{status:200});await checkYoutubeConnections(env);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_revoke_jobs').get().n,0);
});
test('unfollowing an import removes provenance so a later manual follow survives disconnect',async()=>{
 const {sql,call}=setup();await call({channelIds:[id(1)]});sql.prepare("DELETE FROM follows WHERE user_id='member-a'").run();sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member-a','reactor',id(1));await call({confirm:true},undefined,undefined,'POST','disconnect');assert.equal(sql.prepare('SELECT COUNT(*) n FROM follows').get().n,1);
});
test('preview is server-side and stale connection confirmations fail closed',async()=>{
 const {call}=setup();const result=await call({},undefined,undefined,'POST','preview');assert.deepEqual(result.data,{channelIds:[id(1)],connectionId:'member-a'});assert.equal((await call({channelIds:[id(1)],connectionId:'old'})).status,409);
});
test('encrypted tokens are bound to their connection and never decrypt with another identity',async()=>{
 const {env}=setup();const cipher=await seal(env,'secret','connection:a');assert.equal(await unseal(env,cipher,'connection:a'),'secret');await assert.rejects(()=>unseal(env,cipher,'connection:b'));
});
test('OAuth callback validates cookie, PKCE, one-time state, and disconnect cancellation',async()=>{
 const {sql,env,ready,call}=setup();await ready;sql.prepare('DELETE FROM youtube_connections').run();
 const request=new Request('https://reactionjourney.com/api/youtube/subscriptions/connect');let start=await startConnection(request,env,{id:'member-a'});const info=await start.json(),auth=new URL(info.authorizationUrl),state=auth.searchParams.get('state');assert.equal(auth.searchParams.get('access_type'),'offline');assert.equal(auth.searchParams.get('scope'),scope);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 const callback=new Request('https://reactionjourney.com/api/youtube/subscriptions/callback?state='+state+'&code=fixture-code',{headers:{Cookie:'rj_youtube_state='+state}});
 assert.equal((await finishConnection(new Request(callback.url),env)).status,400);
 env.YOUTUBE_FETCH=async(url,opts)=>{assert.equal(opts.redirect,'manual');assert.equal(new URLSearchParams(opts.body).get('code_verifier')?.length,43);return Response.json({refresh_token:'fixture-new-refresh',scope});};
 assert.equal((await finishConnection(callback,env)).status,303);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_connections').get().n,1);assert.equal((await finishConnection(callback,env)).status,400);
 sql.prepare('DELETE FROM youtube_connections').run();start=await startConnection(request,env,{id:'member-a'});const second=new URL((await start.json()).authorizationUrl).searchParams.get('state');
 env.YOUTUBE_FETCH=async(url)=>{if(String(url).endsWith('/token')){await call({confirm:true},undefined,undefined,'POST','disconnect');return Response.json({refresh_token:'late-token',scope});}return new Response(null,{status:200});};
 await finishConnection(new Request('https://reactionjourney.com/api/youtube/subscriptions/callback?state='+second+'&code=x',{headers:{Cookie:'rj_youtube_state='+second}}),env);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_connections').get().n,0);
});
test('callback failure diagnostics contain only safe stages and allowlisted labels',async()=>{
 const {sql,env,ready}=setup();await ready;sql.prepare('DELETE FROM youtube_connections').run();
 async function attempt(fetcher){env.YOUTUBE_FETCH=fetcher;const start=await startConnection(new Request('https://reactionjourney.com/api/youtube/subscriptions/connect'),env,{id:'member-a'});const state=new URL((await start.json()).authorizationUrl).searchParams.get('state');return finishConnection(new Request('https://reactionjourney.com/api/youtube/subscriptions/callback?state='+state+'&code=fixture-code',{headers:{Cookie:'rj_youtube_state='+state}}),env);}
 const failed=await attempt(async()=>Response.json({error:'invalid_client',error_description:'sensitive provider detail'},{status:400}));assert.equal(new URL(failed.headers.get('Location')).searchParams.get('youtube'),'failed');
 assert.equal(sql.prepare('SELECT code FROM operational_events ORDER BY created_at DESC LIMIT 1').get().code,'youtube-oauth-token-invalid_client');
 await attempt(async()=>{throw new Error('sensitive exception detail');});assert.equal(sql.prepare("SELECT COUNT(*) n FROM operational_events WHERE code='youtube-oauth-token-exchange'").get().n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_connections').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_oauth_states WHERE used=1').get().n,1);
 assert.equal(JSON.stringify(sql.prepare('SELECT code FROM operational_events').all()).includes('sensitive'),false);
});
test('saved groups cannot retain or resurrect tracked imported follows',async()=>{
 const {social}=await import('../server/social.mjs');const {sql,db,env,call}=setup();await call({channelIds:[id(1)]});sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member-a','reactor',id(2));
 const group=async body=>{const response=await social(new Request('https://reactionjourney.com/api/social/following-group',{method:'POST',headers:{Origin:'https://reactionjourney.com','Content-Type':'application/json'},body:JSON.stringify(body)}),env,{performers:[],channels:[],videos:[]},{id:'member-a'});assert.equal(response.status,200);return response.json();};
 const created=await group({action:'create',name:'My group'});let stored=JSON.parse(sql.prepare('SELECT follows FROM following_groups WHERE id=?').get(created.id).follows);assert.deepEqual(stored,[{kind:'reactor',target:id(2)}]);
 await group({action:'activate',id:created.id});assert.equal(sql.prepare('SELECT COUNT(*) n FROM youtube_imported_follows').get().n,1);assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-a'").get().n,2);
 await call({confirm:true},undefined,undefined,'POST','disconnect');await group({action:'activate',id:created.id});assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE target=?").get(id(1)).n,0);
});
test('browser connection and disconnect controls use authenticated routes without tokens',async()=>{
 const {build}=await import('esbuild'),{runInNewContext}=await import('node:vm');
 const bundle=(await build({entryPoints:[fileURLToPath(new URL('../youtube-subscriptions.js',import.meta.url))],bundle:true,format:'iife',platform:'browser',write:false})).outputFiles[0].text;
 const elements=new Map(),posts=[],listeners={};let destination=null,refreshes=0;
 class Element{constructor(){this.children=[];this.hidden=false;this.disabled=false;}set innerHTML(html){for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,new Element());elements.get('youtubeImportForm').children.push(new Element());}before(){}scrollIntoView(){}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}querySelector(){return this.children[0];}querySelectorAll(selector){return elements.get('youtubeImportMatches').children.flatMap(row=>row.children.filter(n=>n.type==='checkbox'&&(selector!=='input:checked'||n.checked)));}}
 elements.set('reactorGrid',new Element());elements.set('reactorPaginationTop',new Element());let connected=false;
 const context={URLSearchParams,Response,console,confirm:()=>true,history:{replaceState(){}},document:{createElement:()=>new Element(),createTextNode:text=>({text}),getElementById:id=>elements.get(id)},catalog:{channels:[{id:id(1),name:'Reactor one'}]},dashboard:{follows:[],hiddenReactors:[]},startMemberApp:async()=>{},refreshDashboard:async()=>{refreshes++;},reactionAuth:{ready:new Promise(()=>{}),account:{id:'member-a'},fetch:async(path,opts)=>{if(path.endsWith('/config'))return Response.json({configured:true,connected});const body=JSON.parse(opts.body);posts.push({path,body});if(path.endsWith('/connect'))return Response.json({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?fixture=1'});if(path.endsWith('/preview'))return Response.json({channelIds:[id(1)],connectionId:'connection-one'});if(path.endsWith('/import'))return Response.json({added:1,skipped:0});return Response.json({ok:true,message:'Disconnected'});}},window:{location:{search:'',pathname:'/',hash:'',assign:url=>destination=url},addEventListener:(event,fn)=>listeners[event]=fn}};
 runInNewContext(bundle,context);await elements.get('prepareYoutubeImport').onclick();assert.equal(elements.get('connectYoutubeImport').hidden,false);await elements.get('connectYoutubeImport').onclick();assert.equal(destination.startsWith('https://accounts.google.com/'),true);
 connected=true;
 const loadedCatalog=context.catalog;context.catalog=null;let finishCatalogLoad;
 context.startMemberApp=()=>new Promise(resolve=>{finishCatalogLoad=()=>{context.catalog=loadedCatalog;resolve();};});
 const pendingPreview=elements.get('prepareYoutubeImport').onclick();
 while(!finishCatalogLoad)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(posts.some(p=>p.path.endsWith('/preview')),false,'preview waits for the member catalog');
 finishCatalogLoad();await pendingPreview;
 assert.equal(elements.get('youtubeImportForm').hidden,false,'matching reactors appear after the catalog loads');
 context.startMemberApp=async()=>{};context.reactionAuth.ready=Promise.resolve();
 listeners.pagehide();assert.equal(elements.get('youtubeImportForm').hidden,true);
 await listeners.pageshow({persisted:true});
 assert.equal(elements.get('youtubeImportForm').hidden,false,'cached browser return restores the subscription review');
 assert.match(elements.get('youtubeImportStatus').textContent,/subscriptions checked/);
 await elements.get('youtubeImportForm').onsubmit({preventDefault(){}});assert.deepEqual(posts.find(p=>p.path.endsWith('/import')).body,{channelIds:[id(1)],connectionId:'connection-one'});
 await elements.get('disconnectYoutubeImport').onclick();assert.deepEqual(posts.at(-1).body,{confirm:true});assert.ok(refreshes>=3);assert.equal(JSON.stringify(posts).includes('access_token'),false);assert.equal(elements.get('youtubeImportForm').hidden,true);
 listeners['reaction-auth-change']();assert.equal(elements.get('youtubeImportMatches').children.length,0);
});
