/* =================================================================
   ADMIN/JS/PWA-INSTALL.JS — beforeinstallprompt capture (admin app)
   =================================================================
   Root wale js/pwa-install.js jaisa hi, bas admin/sw.js register
   karta hai (root wala sw.js nahi) taaki dono apps (customer +
   admin) ek dusre se independent rahein.
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
