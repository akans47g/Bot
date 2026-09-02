/* =================================================================
   SW.JS — Service Worker
   =================================================================
   👉 Jaan-boojh kar bahut simple rakha hai: sirf offline.html cache
      hoti hai. Wallet balance, orders, koi bhi Firestore data KABHI
      cache nahi hota — taaki purana/galat data kabhi na dikhe.
      Bas itna hota hai: agar internet na ho aur koi page load na ho
      paye, to browser ka ugly error na dikh kar offline.html dikhta
      hai.
================================================================= */

const CACHE_NAME = 'akans-store-v1';
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
  // Sirf full page navigation (jab koi .html page khola/refresh
  // kiya jaaye) ke liye offline fallback lagate hain. Baaki sab
  // (JS, images, Firebase/Firestore calls) hamesha seedha network
  // se jaate hain — koi caching nahi, koi purana data nahi.
  if (event.request.mode === 'navigate'){
    event.respondWith(
      fetch(event.request).catch(function(){
        return caches.match(OFFLINE_URL);
      })
    );
  }
});
