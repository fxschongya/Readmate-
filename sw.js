const CACHE='readmate-v35-local-cloud-delete';
const ASSETS=['./','./index.html','./icon.svg','./manifest.webmanifest','./firebase-config.js','./cloud.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return res}).catch(()=>caches.match(event.request)))})
