/* Only public presentation assets are cached. Never cache member data or auth. */
const CACHE='reaction-journey-static-__APP_VERSION__';
const PUBLIC=new Set(['/offline.html','/app.webmanifest','/images/app-192.png','/images/app-512.png','/images/app-maskable.png','/images/app-apple.png']);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...PUBLIC]))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('reaction-journey-static-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||request.headers.has('Authorization')||url.pathname.startsWith('/api/')||url.pathname==='/data.json')return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')));return;}
 if(!PUBLIC.has(url.pathname)||url.search)return;
 event.respondWith(fetch(request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}return response;}).catch(()=>caches.match(request)));
});
