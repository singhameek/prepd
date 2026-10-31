const V='sk-v7',ASSETS=['./','index.html','app.js','db.js','openrouterService.js','inventoryEngine.js','manifest.webmanifest','icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.hostname==='openrouter.ai')return; // never cache API calls
  e.respondWith(caches.match(r).then(hit=>{
    const net=fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(V).then(c=>c.put(r,cp))}return res}).catch(()=>hit||(r.mode==='navigate'?caches.match('index.html'):undefined));
    return hit||net; // cache-first, refresh in background
  }));
});
self.addEventListener('periodicsync',e=>{if(e.tag==='shortage-check')e.waitUntil(self.clients.matchAll().then(cs=>cs.forEach(c=>c.postMessage('check-shortages'))))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow('./#grocery'))});