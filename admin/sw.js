/* =================================================================
   ADMIN/SW.JS — Service Worker (sirf admin/ folder ke liye)
   =================================================================
   Root wale sw.js jaisa hi, bilkul safe strategy: sirf offline.html
   cache hota hai. Koi bhi Firestore data (orders, top-ups, balances)
   KABHI cache nahi hota — hamesha live/fresh dikhega.
================================================================= */

const CACHE_NAME = 'akans-admin-v1';
const OFFLINE_URL = 'offline.html';

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll([OFFLINE_URL]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){ return key !== CACHE_NAME; })
            .map(function(key){ return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event){
  if (event.request.mode === 'navigate'){
    event.respondWith(
      fetch(event.request).catch(function(){
        return caches.match(OFFLINE_URL);
      })
    );
  }
});
