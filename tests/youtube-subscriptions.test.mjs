import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {youtubeSubscriptions} from '../server/youtube-subscriptions.mjs';
import {matchSubscriptions,readSubscriptions} from '../youtube-subscriptions-core.js';
const id=n=>'UC'+String(n).padStart(22,'0');
function setup(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const db={prepare(q){let v=[];return {bind(...a){v=a;return this;},async first(){return sql.prepare(q).get(...v)||null;},async all(){return {results:sql.prepare(q).all(...v)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...v).changes)}};}}},async batch(ss){sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const seed={performers:[{id:'missioned-souls',name:'Missioned Souls'}],channels:[1,2,3].map(n=>({id:id(n),name:'Reactor '+n,performerId:'missioned-souls'})),videos:[]};
 const call=async(body,user={id:'member-a'},origin='https://reactionjourney.com',method='POST',path='import',extra={})=>{const r=await youtubeSubscriptions(new Request('https://reactionjourney.com/api/youtube/subscriptions/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{DB:db,...extra},seed,user);return {status:r.status,data:await r.json()};};return {sql,call};
}
test('read-only preview matches IDs, deduplicates, and excludes hidden or followed reactors',()=>{
 const channels=[1,2,3].map(n=>({id:id(n),name:'Reactor '+n}));const r=matchSubscriptions([id(1),id(1),id(2),id(3),id(4)],channels,[{kind:'reactor',target:id(2)}],[{channel_id:id(3)}]);assert.deepEqual(r.matches,[channels[0]]);assert.equal(r.total,4);assert.equal(r.unmatched,1);assert.equal(r.alreadyFollowing,1);assert.equal(r.hiddenCount,1);
});
test('reads every page with bearer header, no API key, and deduplicates',async()=>{
 let n=0;const progress=[];const items=ids=>ids.map(id=>({snippet:{resourceId:{channelId:id}}}));const ids=await readSubscriptions('fixture-token',{onProgress:n=>progress.push(n),fetcher:async(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer fixture-token');assert.equal(url.searchParams.get('mine'),'true');assert.equal(url.searchParams.get('maxResults'),'50');assert.equal(url.searchParams.has('key'),false);assert.equal(url.toString().includes('fixture-token'),false);return ++n===1?Response.json({items:items([id(1)]),nextPageToken:'next'}):(assert.equal(url.searchParams.get('pageToken'),'next'),Response.json({items:items([id(1),id(2)])}));}});assert.deepEqual(ids,[id(1),id(2)]);assert.deepEqual(progress,[1,2]);
});
test('errors for expired permission, quota, malformed pagination, cancellation; no partial preview',async()=>{
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({}, {status:401})}),/expired/);
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({error:{errors:[{reason:'quotaExceeded'}]}},{status:403})}),/quota/);
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({items:[],nextPageToken:'repeat'})}),/stalled/);
 await assert.rejects(()=>readSubscriptions('x',{fetcher:async()=>Response.json({})}),/invalid/);
 const c=new AbortController();c.abort();await assert.rejects(()=>readSubscriptions('x',{signal:c.signal,fetcher:async(u,o)=>{o.signal.throwIfAborted();}}),{name:'AbortError'});
});
test('import is add-only, duplicate safe, account isolated and rechecks hidden state',async()=>{
 const {sql,call}=setup();await call({channelIds:[id(1)]});sql.prepare('INSERT INTO hidden_reactors VALUES(?,?,?)').run('member-a',id(2),'now');sql.prepare('INSERT INTO follows VALUES(?,?,?)').run('member-a','song','existing');
 const r=await call({channelIds:[id(1),id(1),id(2),id(3)],userId:'member-b'});assert.deepEqual(r.data,{added:1,skipped:2});assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-a'").get().n,3);assert.equal(sql.prepare("SELECT COUNT(*) n FROM follows WHERE user_id='member-b'").get().n,0);assert.equal((await call({channelIds:[id(3)]})).data.added,0);assert.equal((await call({channelIds:[id(2)]},{id:'member-b'})).data.added,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM hidden_reactors').get().n,1);
});
test('rejects unauthenticated, cross-origin, oversized, invalid or unknown channels before writing',async()=>{
 const {sql,call}=setup();assert.equal((await call({channelIds:[id(1)]},null)).status,401);assert.equal((await call({channelIds:[id(1)]},undefined,'https://evil.test')).status,403);assert.equal((await call({channelIds:[]})).status,400);assert.equal((await call({channelIds:['@name']})).status,400);assert.equal((await call({channelIds:Array(101).fill(id(1))})).status,400);assert.equal((await call({channelIds:[id(1),id(99)]})).status,409);assert.equal(sql.prepare('SELECT COUNT(*) n FROM follows').get().n,0);
});
test('only public OAuth client ID returned; missing/invalid config disabled',async()=>{
 const {call}=setup();assert.deepEqual((await call(null,undefined,undefined,'GET','config',{GOOGLE_YOUTUBE_CLIENT_ID:'123-abc.apps.googleusercontent.com',SECRET:'never-expose'})).data,{clientId:'123-abc.apps.googleusercontent.com'});assert.equal((await call(null,undefined,undefined,'GET','config')).data.clientId,null);assert.equal((await call(null,undefined,undefined,'GET','config',{GOOGLE_YOUTUBE_CLIENT_ID:'<script>'})).data.clientId,null);
});

test('built interface requires consent and selection, posts IDs only, and ignores cancelled callbacks',async()=>{
 const {build}=await import('esbuild');const {runInNewContext}=await import('node:vm');
 const bundle=(await build({entryPoints:[new URL('../youtube-subscriptions.js',import.meta.url).pathname],bundle:true,format:'iife',platform:'browser',write:false})).outputFiles[0].text;
 const elements=new Map(),listeners={};let tokenConfig,reads=0,posts=[];
 class Element{constructor(){this.children=[];this.hidden=false;this.disabled=false;this.textContent='';}set innerHTML(html){for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,new Element());elements.get('youtubeImportForm')?.children.push(new Element());}get innerHTML(){return '';}append(...nodes){this.children.push(...nodes);}before(){}replaceChildren(){this.children=[];}querySelector(){return this.children[0];}querySelectorAll(){return elements.get('youtubeImportMatches').children.flatMap(row=>row.children.filter(n=>n?.type==='checkbox'&&n.checked));}}
 elements.set('reactorGrid',new Element());
 const dash={follows:[],hiddenReactors:[]},account={id:'member-a'};
 const context={URL,URLSearchParams,Response,AbortController,console,setTimeout,clearTimeout,catalog:{channels:[{id:id(1),name:'Reactor one'}]},dashboard:dash,refreshDashboard:async()=>{},document:{createElement:()=>new Element(),createTextNode:text=>({text}),getElementById:id=>elements.get(id),head:new Element()},reactionAuth:{account,fetch:async(path,opts)=>{if(path.endsWith('/config'))return Response.json({clientId:'client.apps.googleusercontent.com'});posts.push(JSON.parse(opts.body));return Response.json({added:1,skipped:0});}},fetch:async()=>{reads++;return Response.json({items:[{snippet:{resourceId:{channelId:id(1)}}}]});},google:{accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:config=>{tokenConfig=config;return {requestAccessToken(){}};}}}},window:{addEventListener:(name,fn)=>listeners[name]=fn}};context.window.google=context.google;
 runInNewContext(bundle,context);
 await elements.get('prepareYoutubeImport').onclick();assert.equal(reads,0);assert.equal(posts.length,0);assert.equal(tokenConfig.include_granted_scopes,false);
 elements.get('connectYoutubeImport').onclick();const token={access_token:'sensitive-fixture-token'};await tokenConfig.callback(token);assert.equal(token.access_token,'');assert.equal(reads,1);assert.equal(posts.length,0);assert.equal(elements.get('youtubeImportMatches').children.length,1);
 await elements.get('youtubeImportForm').onsubmit({preventDefault(){}});assert.deepEqual(posts,[{channelIds:[id(1)]}]);
 await elements.get('prepareYoutubeImport').onclick();const old=tokenConfig;elements.get('cancelYoutubeImport').onclick();await old.callback({access_token:'late'});assert.equal(reads,1);assert.equal(elements.get('youtubeImportForm').hidden,true);
 listeners['reaction-auth-change']();assert.equal(elements.get('youtubeImportMatches').children.length,0);
});
