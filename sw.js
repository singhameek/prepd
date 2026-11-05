const V='sk-v23',ASSETS=['./','index.html','app.js','db.js','engine.js','ingredient-engine.js','ingredientParser.js','sources.js','quality.js','steps.js','timers.js','corrections.js','config.js','cloud.js','units.js','inventoryEngine.js','recipeFinder.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png','favicon.ico'];
// Files are cached once per version (change V to publish an update) and then served straight from the cache.
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(V).then(c=>Promise.all(ASSETS.map(a=>fetch(a,{cache:'reload'}).then(r=>r.ok?c.put(a,r):0).catch(()=>{})))));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||(u.origin!==location.origin&&u.hostname!=='cdn.jsdelivr.net')||u.pathname.startsWith('/api/')||u.pathname.startsWith('/_vercel/'))return;
  const put=res=>{if(res&&res.ok){const cp=res.clone();caches.open(V).then(c=>c.put(r,cp))}return res};
  if(u.pathname.endsWith('/config.js')){                                    // settings you edit: always try the network first
    e.respondWith(fetch(r).then(put).catch(()=>caches.match(r)));return;
  }
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(hit=>hit||fetch(r).then(put).catch(()=>r.mode==='navigate'?caches.match('index.html'):undefined)));
});
self.addEventListener('periodicsync',e=>{if(e.tag==='shortage-check')e.waitUntil(self.clients.matchAll().then(cs=>cs.forEach(c=>c.postMessage('check-shortages'))))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow('./#grocery'))});