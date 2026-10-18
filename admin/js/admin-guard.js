/* =================================================================
   ADMIN-GUARD.JS — Shared utilities for every admin page
   =================================================================
   requireAdmin(onReady)   — auth check, redirect agar admin nahi
   logAdminAction(action, summary) — adminLogs collection me entry
   downloadCSV(filename, headers, rows) — browser me CSV download
================================================================= */

import { db } from "../../js/firebase-init.js";
import { watchAuthState } from "../../js/auth.js";
import {
  collection, addDoc, getDocs, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const ADMIN_EMAIL = 'akans47g@gmail.com';

export function requireAdmin(onReady){
  watchAuthState(function(user){
    if (!user || user.email !== ADMIN_EMAIL){
      window.location.href = '../admin.html';
      return;
    }
    updateNavBadges();
    watchPendingBadge();
    onReady(user);
  });
}

export async function logAdminAction(action, summary){
  try{
    await addDoc(collection(db, 'adminLogs'), {
      action: action,
      summary: summary,
      timestamp: new Date().toISOString()
    });
  } catch(e){
    console.warn('Activity log fail ho gaya', e);
  }
}

export function downloadCSV(filename, headers, rows){
  const escapeCell = function(cell){
    const str = String(cell === null || cell === undefined ? '' : cell);
    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1){
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines = [headers.map(escapeCell).join(',')];
  rows.forEach(function(row){
    lines.push(row.map(escapeCell).join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Har admin page ke bottom-nav pe Top-ups/Orders ke upar pending
   count ka red badge dikhata hai — bina push-notification setup
   ke, "kuch naya pending hai" turant dikh jaata hai. */
async function updateNavBadges(){
  try{
    const [topupsSnap, ordersSnap] = await Promise.all([
      getDocs(query(collection(db, 'topups'), where('status', '==', 'pending'))),
      getDocs(query(collection(db, 'orders'), where('status', '==', 'pending')))
    ]);
    setBadge('topups.html', topupsSnap.size);
    setBadge('orders.html', ordersSnap.size);
  } catch(e){
    // Badge fail ho to bhi page normally kaam karta rahe
  }
}

function setBadge(page, count){
  if (!count) return;
  const btn = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (!btn) return;
  const badge = document.createElement('span');
  badge.className = 'nav-badge';
  badge.textContent = count > 9 ? '9+' : String(count);
  btn.appendChild(badge);
}

/* =================================================================
   HOME-SCREEN APP BADGE + IN-APP ALERT  ("Level 1" notifications)
   =================================================================
   Backend/Cloud Functions ke bina: jab tak Admin App khula ya
   background me hai, pending orders/top-ups/FF-orders ka total
   count seedha app ke HOME-SCREEN ICON par red badge ki tarah
   dikhta hai (Badging API — Android Chrome/installed-PWA me kaam
   karta hai). App poori tarah band/kill ho jaaye to badge apni
   aakhri value par freeze ho jaata hai, jab tak dobara na khole —
   asli push-notification (app band hone par bhi alert) ke liye
   Firebase Cloud Functions chahiye hoga.

   Isi ke saath, jab app khula ho aur koi NAYA pending item aaye
   (sirf pehli load wale nahi, genuinely naya), ek chhota beep sound
   aur toast bhi dikhta hai.
================================================================= */

let _pendingWatchStarted = false;

function watchPendingBadge(){
  if (_pendingWatchStarted) return; // ek hi baar start ho, dobara nahi
  _pendingWatchStarted = true;

  const badgeSupported = 'setAppBadge' in navigator;

  const state = {
    topups:   { known: new Set(), count: 0, ready: false, label: 'Payment Request' },
    orders:   { known: new Set(), count: 0, ready: false, label: 'Order' },
    ffOrders: { known: new Set(), count: 0, ready: false, label: 'FF Order' }
  };

  function updateAppBadge(){
    if (!badgeSupported) return;
    const total = state.topups.count + state.orders.count + state.ffOrders.count;
    try{
      if (total > 0) navigator.setAppBadge(total).catch(function(){});
      else navigator.clearAppBadge().catch(function(){});
    } catch(e){}
  }

  function playAlertBeep(){
    try{
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch(e){}
  }

  function showAlertToast(message){
    let toast = document.getElementById('adminPendingToast');
    if (!toast){
      toast = document.createElement('div');
      toast.id = 'adminPendingToast';
      toast.style.cssText =
        'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);' +
        'background:#1A1A2E;color:#fff;padding:12px 22px;border-radius:30px;' +
        'font-size:13.5px;font-weight:600;z-index:99999;max-width:88%;text-align:center;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.3);opacity:0;transition:opacity .25s ease;' +
        'pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(function(){ toast.style.opacity = '1'; });
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function(){ toast.style.opacity = '0'; }, 3200);
  }

  function watchCollection(collectionName, key){
    const q = query(collection(db, collectionName), where('status', '==', 'pending'));
    onSnapshot(q, function(snap){
      const s = state[key];
      const newIds = new Set();
      let newlyArrived = 0;
      snap.forEach(function(d){
        newIds.add(d.id);
        if (s.ready && !s.known.has(d.id)) newlyArrived++;
      });
      s.known = newIds;
      s.count = snap.size;

      if (s.ready && newlyArrived > 0){
        playAlertBeep();
        showAlertToast('🔔 ' + newlyArrived + ' naya ' + s.label + (newlyArrived > 1 ? '(s)' : '') + ' aaya hai!');
      }
      s.ready = true;
      updateAppBadge();
    }, function(){
      // Listener fail (jaise rules/permissions) ho to chup-chaap ignore,
      // baaki page normally kaam karta rahe.
    });
  }

  watchCollection('topups', 'topups');
  watchCollection('orders', 'orders');
  watchCollection('ffOrders', 'ffOrders');
}
