const offlineCache='healthbrowse-offline-v2';
const offlineIcons=new Set(['/favicon.svg?v=atlas-2','/favicon-16.png?v=atlas-2','/favicon-32.png?v=atlas-2']);
self.addEventListener('install', event=>{
  event.waitUntil(caches.open(offlineCache).then(cache=>cache.addAll(['/offline.html',...offlineIcons])));
});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('healthbrowse-offline-')&&k!==offlineCache).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
  }else if(offlineIcons.has(url.pathname+url.search)){
    event.respondWith(caches.match(event.request).then(icon=>icon||fetch(event.request)));
  }
});
