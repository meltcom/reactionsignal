import { database, seedDatabase, catalog, status } from './db.mjs';
import { youtubeSubscriptions } from './youtube-subscriptions.mjs';
import { social } from './social.mjs';
import { community } from './community.mjs';
import { runDiscovery } from './discovery.mjs';
import { refreshChannelStats } from './channel-stats.mjs';
import { authenticate, authConfig } from './auth.mjs';
import { youtubePush, renewSubscriptions, processPushJobs } from './push.mjs';
import {recheckBatch} from './recheck.mjs';
import { managePerformers } from './performers.mjs';
import { reconcile } from './reconciliation.mjs';
import { workbookImport } from './workbook-import.mjs';
import { assets, seed } from './assets.mjs';
const json=(data,code=200)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function authorized(request,env){
  if(!env.DISCOVERY_TOKEN)return false;
  const token=request.headers.get('Authorization')||'';
  const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([digest(token),digest(`Bearer ${env.DISCOVERY_TOKEN}`)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    try{
      if(path==='/api/youtube/push')return await youtubePush(request,env,seed,ctx);
      if(path.startsWith('/api/youtube/subscriptions/')){
        const result=await authenticate(request,env);if(result.error)return result.error;
        return youtubeSubscriptions(request,env,seed,result.user);
      }
      if(path==='/api/auth/config'){
        if(request.method!=='GET')return json({error:'Method not allowed'},405);
        return json(authConfig(env)||{configured:false});
      }
      if(path==='/api/auth/me'){
        if(request.method!=='GET')return json({error:'Method not allowed'},405);
        const result=await authenticate(request,env);
        return result.error||json({id:result.user.id,email:result.user.email,moderator:result.user.moderator});
      }
      if(path==='/api/reconciliation'){const result=await authenticate(request,env);if(result.error)return result.error;return reconcile(request,env,result.user);}
      if(path.startsWith('/api/workbook-import/')){
        const result=await authenticate(request,env);
        if(result.error)return result.error;
        return workbookImport(request,env,result.user);
      }
      if(path.startsWith('/api/social/')||path.startsWith('/api/community/')||path.startsWith('/api/performers/')){
        const result=await authenticate(request,env);
        if(result.error)return result.error;
        if(path.startsWith('/api/performers/'))return managePerformers(request,env,seed,result.user);
        return path.startsWith('/api/social/')?social(request,env,seed,result.user):community(request,env,seed,result.user);
      }
      if(path==='/api/discovery/run'){
        if(request.method!=='POST')return json({error:'POST required'},405);
        if(!await authorized(request,env))return json({error:'Not authorized'},401);
        const push=await processPushJobs(env,seed);
        const subscriptions=await renewSubscriptions(env,seed);
        return json({...await runDiscovery(env,seed),push,subscriptions});
      }
      if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'Method not allowed'},405);
      if(path==='/data.json'||path==='/api/status'){
        const result=await authenticate(request,env);
        if(result.error)return result.error;
        const db=database(env);await seedDatabase(db,seed);
        if(path==='/api/status')return json(await status(db,env));
        const revision=await db.prepare("SELECT value FROM state WHERE key='catalog-revision'").first();
        const etag=revision?`"catalog-${revision.value}"`:null;
        // Always authenticate before checking the tag; no member response is publicly cached.
        if(etag&&request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'private, no-store'}});
        const response=json(await catalog(db,seed,env));if(etag)response.headers.set('ETag',etag);return response;
      }
      const asset=assets[path==='/'?'/index.html':path];if(!asset)return new Response('Not found',{status:404});
      return new Response(request.method==='HEAD'?null:asset.base64?Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)):asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
    }catch{console.error('Catalog request failed');return json({error:'Catalog temporarily unavailable. Please retry.'},503);}
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil(refreshChannelStats(env).catch(()=>console.error('Channel statistics refresh failed')));
    ctx.waitUntil((async()=>{
      const db=database(env);
      await seedDatabase(db,seed);
      await db.prepare("INSERT INTO state(key,value) VALUES('last-scheduled-invocation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(new Date().toISOString()).run();
      await processPushJobs(env,seed);
      await renewSubscriptions(env,seed);
      await runDiscovery(env,seed);
      await recheckBatch(env);
    })());
  }
};

