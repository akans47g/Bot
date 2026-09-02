/* =================================================================
   PWA-INSTALL.JS — beforeinstallprompt event ko capture karta hai
   =================================================================
   Ye har customer-facing page pe load hota hai (jaldi, <head> me)
   taaki chahe user kisi bhi page pe ho, agar browser install-prompt
   fire kare to hum usse pakad ke rakh lein. account.html ka
   "Install App" button isi window.deferredInstallPrompt ko use
   karta hai.
================================================================= */

window.deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  window.deferredInstallPrompt = e;
});

window.addEventListener('appinstalled', function(){
  window.deferredInstallPrompt = null;
});

if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(err){
      console.warn('Service worker register nahi ho paya', err);
    });
  });
}
