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
  const list = document.getElementById('moList');
  const countEl = document.getElementById('moCount');

  // Bundle/product orders 'orders' collection me hain aur Free Fire
  // plan orders 'ffOrders' collection me — dono ko alag-alag sunte
  // hain, fir merge karke ek hi list me (naye-se-purane) dikhate hain.
  let regularOrders = [];
  let ffOrders = [];

  function render(){
    const docs = regularOrders.concat(ffOrders);
    countEl.textContent = docs.length;

    if (docs.length === 0){
      list.innerHTML = '<p class="mo-empty">Abhi tak koi order nahi hai</p>';
      return;
    }

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
          '<span>' + d.qtyLabel + ' • ' + date + '</span>' +
          '<strong>₹' + d.price + '</strong>' +
        '</div>';
      list.appendChild(item);
    });
  }

  const ordersQ = query(collection(db, 'orders'), where('uid', '==', uid));
  onSnapshot(ordersQ, function(snap){
    regularOrders = [];
    snap.forEach(function(d){
      const data = d.data();
      regularOrders.push({
        productName: data.productName,
        qtyLabel: data.qty + ' qty',
        price: data.price,
        status: data.status,
        createdAt: data.createdAt
      });
    });
    render();
  });

  const ffQ = query(collection(db, 'ffOrders'), where('uid', '==', uid));
  onSnapshot(ffQ, function(snap){
    ffOrders = [];
    snap.forEach(function(d){
      const data = d.data();
      ffOrders.push({
        productName: data.planName,
        qtyLabel: (data.totalContent || '') + ' total',
        price: data.price,
        status: data.status,
        createdAt: data.createdAt
      });
    });
    render();
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
