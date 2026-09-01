/* =================================================================
   MYORDER.JS — Order history (live, per logged-in user)
================================================================= */

import { db } from "./firebase-init.js";
import { watchAuthState } from "./auth.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

watchAuthState(function(user){
  if (!user){
    window.location.href = 'login.html';
    return;
  }
  listenToOrders(user.uid);
});

function listenToOrders(uid){
  const q = query(collection(db, 'orders'), where('uid', '==', uid));
  onSnapshot(q, function(snap){
    const list = document.getElementById('moList');
    document.getElementById('moCount').textContent = snap.size;

    if (snap.empty){
      list.innerHTML = '<p class="mo-empty">Abhi tak koi order nahi hai</p>';
      return;
    }

    const docs = [];
    snap.forEach(function(d){ docs.push(d.data()); });
    docs.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });

    list.innerHTML = '';
    docs.forEach(function(d){
      const date = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
      const item = document.createElement('div');
      item.className = 'mo-item';
      item.innerHTML =
        '<div class="mo-item-top">' +
          '<span class="mo-product">' + escapeHtml(d.productName) + '</span>' +
          '<span class="mo-status ' + d.status + '">' + statusLabel(d.status) + '</span>' +
        '</div>' +
        '<div class="mo-item-bottom">' +
          '<span>' + d.qty + ' qty • ' + date + '</span>' +
          '<strong>₹' + d.price + '</strong>' +
        '</div>';
      list.appendChild(item);
    });
  });
}

function statusLabel(status){
  const map = { pending: '⏳ Pending', approved: '✅ Approved', delivered: '📦 Delivered', rejected: '❌ Rejected' };
  return map[status] || status;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
