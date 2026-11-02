const CACHE='readmate-v4102-archive-repair';
const ASSETS=['./','./index.html','./icon.svg','./manifest.webmanifest','./firebase-config.js','./cloud.js?v=4102','./mdx-local.js?v=493','./mdx-worker.js?v=493'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('message',event=>{if(event.data?.type==='READMATE_ACTIVATE_UPDATE')self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('readmate-v')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith(new URL('./',self.registration.scope).pathname))return;event.respondWith(fetch(event.request).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(event.request,clone)).catch(()=>{})}return res}).catch(()=>caches.match(event.request)))});
