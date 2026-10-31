import {discoveryPerformance} from './discovery-measurement.mjs';
import {backfillBroker} from './backfill-broker.mjs';
import {pruneQuotaRecords} from './youtube-quota.mjs';
import {secureRedirect,secureResponse} from './security.mjs';
import {recheckVideoFormats} from './format-recheck.mjs';
import {discoveryCycle} from './rss.mjs';
import { missionedSouls, missionedSoulsThumbnail, scheduledMissionedSouls } from './missioned-souls.mjs';
import { database, seedDatabase, catalog, status } from './db.mjs';
import {finishConnection,checkYoutubeConnections} from './youtube-connection.mjs';
import { youtubeSubscriptions } from './youtube-subscriptions.mjs';
import { social } from './social.mjs';
import { community, profilePicture } from './community.mjs';
import {refreshVideoMetadata} from './video-metadata.mjs';
import { refreshChannelStats } from './channel-stats.mjs';
import { authenticate, authConfig } from './auth.mjs';
import { youtubePush } from './push.mjs';
import {recheckBatch} from './recheck.mjs';
import { managePerformers } from './performers.mjs';
import { reconcile } from './reconciliation.mjs';
import { workbookImport } from './workbook-import.mjs';
import { assets, seed } from './assets.mjs';
import {sharedCache} from './cache.mjs';
import {accountAccess,operations,recordOperationalEvent,checkOperationalAlerts} from './operations.mjs';
const json=(data,code=200)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function authorized(request,env){
  if(!env.DISCOVERY_TOKEN)return false;
  const token=request.headers.get('Authorization')||'';
  const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([digest(token),digest(`Bearer ${env.DISCOVERY_TOKEN}`)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
async function member(request,env){
 const result=await authenticate(request,env);
 if(!result.error)result.error=await accountAccess(env.DB,result.user);
 return result;
}
export default {
  async fetch(request,env,ctx){
    const redirect=secureRedirect(request);if(redirect)return redirect;
    const started=Date.now(),requestId=crypto.randomUUID();
    const original=await handleRequest(request,env,ctx);
    const response=secureResponse(request,original);
    const route=new URL(request.url).pathname.replace(/\/api\/profile-pictures\/.*/, '/api/profile-pictures/:id').replace(/\/api\/missioned-souls\/thumbnails\/.*/, '/api/missioned-souls/thumbnails/:id');
    console.log(JSON.stringify({event:'request',requestId,route,method:request.method,status:response.status,durationMs:Date.now()-started}));
    response.headers.set('X-Request-ID',requestId);
    if(response.status>=500){const task=recordOperationalEvent(env,response.status===503?'request-unavailable':'request-error');if(ctx?.waitUntil)ctx.waitUntil(task);else await task;}
    return response;
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil(checkYoutubeConnections(env).catch(()=>console.error('YouTube permission checks failed')));
    ctx.waitUntil(refreshVideoMetadata(env).catch(()=>recordOperationalEvent(env,'video-metadata-refresh-failed')));
    ctx.waitUntil(refreshChannelStats(env).catch(()=>recordOperationalEvent(env,'channel-refresh-failed')));
    ctx.waitUntil((async()=>{
      try{
        const db=database(env);await seedDatabase(db,seed);
        try{await pruneQuotaRecords(env);}catch{console.error('Quota receipt cleanup deferred');}
        await db.prepare("INSERT INTO state(key,value) VALUES('last-scheduled-invocation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(new Date().toISOString()).run();
        await discoveryCycle(env,seed);await recheckBatch(env);
        try{await recheckVideoFormats(env);}catch{console.error('Video format recheck failed; retry next tick');}
        const ms=await scheduledMissionedSouls(env,seed.missionedSouls);if(ms?.status==='error')await recordOperationalEvent(env,'ms-refresh-failed');
      }catch{await recordOperationalEvent(env,'scheduler-failed');}
      try{await checkOperationalAlerts(env);}catch{console.error('Operations check failed');}
    })());
  }
};
async function handleRequest(request,env,ctx){
    const path=new URL(request.url).pathname;
    try{
      if(path.startsWith('/api/backfill/'))return await backfillBroker(request,env);
      if(path.startsWith('/private-guides/'))return new Response('Not found',{status:404});
      if(path.startsWith('/api/member-guides/')){
        if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'Method not allowed'},405);
        const result=await member(request,env);if(result.error)return result.error;
        const names={overview:'reaction-journey-overview.pdf','app-guide':'reaction-journey-app-guide.pdf'},name=names[path.slice('/api/member-guides/'.length)];
        if(!name)return json({error:'Guide not found.'},404);
        const file=assets['/private-guides/'+name];if(!file?.base64)return json({error:'Guide unavailable.'},404);
        return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization'}});
      }
      if(path.startsWith('/api/profile-pictures/'))return await profilePicture(request,env);
      if(path.startsWith('/api/missioned-souls/thumbnails/'))return await missionedSoulsThumbnail(request,env);
      if(path==='/api/youtube/push')return await youtubePush(request,env,seed,ctx);
      if(path==='/api/youtube/subscriptions/callback'&&request.method==='GET')return await finishConnection(request,env);
      if(path.startsWith('/api/youtube/subscriptions/')){
        const result=await member(request,env);if(result.error)return result.error;
        return await youtubeSubscriptions(request,env,seed,result.user);
      }
      if(path==='/api/auth/config'){
        if(request.method!=='GET')return json({error:'Method not allowed'},405);
        return json(authConfig(env)||{configured:false});
      }
      if(path==='/api/auth/me'){
        if(request.method!=='GET')return json({error:'Method not allowed'},405);
        const result=await member(request,env);
        return result.error||json({id:result.user.id,email:result.user.email,moderator:result.user.moderator});
      }
      if(path.startsWith('/api/operations/')){const result=await member(request,env);if(result.error)return result.error;return await operations(request,env,result.user);}
      if(path==='/api/missioned-souls'){const result=await member(request,env);if(result.error)return result.error;return await missionedSouls(request,env,seed.missionedSouls,result.user);}
      if(path==='/api/reconciliation'){const result=await member(request,env);if(result.error)return result.error;return await reconcile(request,env,result.user);}
      if(path.startsWith('/api/workbook-import/')){
        const result=await member(request,env);
        if(result.error)return result.error;
        return await workbookImport(request,env,result.user);
      }
      if(path.startsWith('/api/social/')||path.startsWith('/api/community/')||path.startsWith('/api/performers/')){
        const result=await member(request,env);
        if(result.error)return result.error;
        if(path.startsWith('/api/performers/'))return await managePerformers(request,env,seed,result.user);
        return await (path.startsWith('/api/social/')?social(request,env,seed,result.user):community(request,env,seed,result.user));
      }
      if(path==='/api/discovery/run'){
        if(request.method!=='POST')return json({error:'POST required'},405);
        if(!await authorized(request,env))return json({error:'Not authorized'},401);
        return json(await discoveryCycle(env,seed));
      }
      if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'Method not allowed'},405);
      if(path==='/data.json'||path==='/api/status'||path==='/api/discovery/performance'){
        const result=await member(request,env);
        if(result.error)return result.error;
        const db=database(env);await seedDatabase(db,seed);
        if(path==='/api/discovery/performance')return result.user.moderator?json(await discoveryPerformance(db)):json({error:'Moderator access required.'},403);
        if(path==='/api/status')return result.user.moderator?json(await status(db,env)):json({error:'Moderator access required.'},403);
        const revision=await db.prepare("SELECT value FROM state WHERE key='catalog-revision'").first();
        const officialRevision=await db.prepare("SELECT value FROM state WHERE key='ms-updated'").first();
        const version=encodeURIComponent((revision?.value||'none')+':'+(officialRevision?.value||'none'));
        const etag=`"catalog-${version}"`;
        // Always authenticate before checking the tag; no member response is publicly cached.
        if(etag&&request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'private, no-store'}});
        const data=await sharedCache(db,`catalog:${version}`,15000,()=>catalog(db,seed,env));
        const response=json(data);if(etag)response.headers.set('ETag',etag);return response;
      }
      if(path==='/missioned-souls'||path==='/missioned-souls/')return Response.redirect(new URL('/#missioned-souls',request.url),302);
      const publicPage={'/privacy':'/privacy.html','/privacy/':'/privacy.html','/terms':'/terms.html','/terms/':'/terms.html'}[path];
      const asset=assets[publicPage||(path==='/'?'/index.html':path)];if(!asset)return new Response('Not found',{status:404});
      return new Response(request.method==='HEAD'?null:asset.base64?Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)):asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
    }catch{console.error('Catalog request failed');return json({error:'Catalog temporarily unavailable. Please retry.'},503);}
}
