/* =================================================================
   ACCOUNT.JS — Profile, live wallet balance, logout
================================================================= */

import { db } from "./firebase-init.js";
import { watchAuthState, logout } from "./auth.js";
import {
  doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

watchAuthState(function(user){
  if (!user){
    window.location.href = 'login.html';
    return;
  }

  const displayName = user.displayName || 'AKANS User';
  document.getElementById('acName').textContent = displayName;
  document.getElementById('acEmail').textContent = user.email || '';
  document.getElementById('acAvatar').textContent = (user.displayName || user.email || 'A').charAt(0).toUpperCase();

  const ref = doc(db, 'users', user.uid);
  onSnapshot(ref, function(snap){
    const data = snap.data() || {};
    const bal = typeof data.walletBalance === 'number' ? data.walletBalance : 0;
    document.getElementById('acBalance').textContent = '₹' + bal;

    if (data.whatsapp){
      document.getElementById('acWhatsapp').textContent = data.whatsapp;
      document.getElementById('acWhatsappCard').style.display = 'block';
    }

    if (data.isPartner){
      document.getElementById('acPartnerLink').style.display = 'flex';
    }
  });
});

document.getElementById('acLogoutBtn').addEventListener('click', async function(){
  await logout();
  window.location.href = 'login.html';
});

/* ---------- INSTALL APP BUTTON ---------- */
function isStandaloneMode(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOSDevice(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

(function setupInstallButton(){
  const btn = document.getElementById('acInstallBtn');
  if (!btn) return;

  if (isStandaloneMode()){
    btn.style.display = 'none';
    return;
  }

  btn.addEventListener('click', async function(){
    if (window.deferredInstallPrompt){
      window.deferredInstallPrompt.prompt();
      await window.deferredInstallPrompt.userChoice;
      window.deferredInstallPrompt = null;
    } else if (isIOSDevice()){
      alert('📲 iPhone par install karne ke liye:\n\nNeeche diye Share button (⬆️) par tap karein, phir "Add to Home Screen" choose karein.');
    } else {
      alert('📲 Apne browser ke menu (⋮ ya ...) me jaakar "Install App" ya "Add to Home Screen" option dhoondein.');
    }
  });
})();
