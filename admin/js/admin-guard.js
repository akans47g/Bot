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
  collection, addDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const ADMIN_EMAIL = 'akans47g@gmail.com';

export function requireAdmin(onReady){
  watchAuthState(function(user){
    if (!user || user.email !== ADMIN_EMAIL){
      window.location.href = '../admin.html';
      return;
    }
    updateNavBadges();
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
