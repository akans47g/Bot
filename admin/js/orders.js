/* =================================================================
   ORDERS.JS — List, filter, approve, deliver, reject (with refund)
   =================================================================
   Reject par wallet balance refund hota hai, kyunki purchase ke
   time hi paisa kaat liya gaya tha (index.html ke confirmPurchase).
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin, logAdminAction, downloadCSV } from "./admin-guard.js";
import {
  collection, getDocs, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let allOrders = [];
let currentFilter = 'pending';

requireAdmin(function(){
  loadOrders();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async function(){
  await logout();
  window.location.href = '../admin.html';
});

document.getElementById('filterTabs').addEventListener('click', function(e){
  const btn = e.target.closest('.filter-tab');
  if (!btn) return;
  document.querySelectorAll('.filter-tab').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  render();
});

async function loadOrders(){
  const snap = await getDocs(collection(db, 'orders'));
  allOrders = [];
  snap.forEach(function(d){ allOrders.push(Object.assign({ id: d.id }, d.data())); });
  allOrders.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  render();
}

function render(){
  const list = document.getElementById('ordersList');
  const filtered = currentFilter === 'all' ? allOrders : allOrders.filter(function(o){ return o.status === currentFilter; });

  if (!filtered.length){
    list.innerHTML = '<p class="admin-empty">Is category me koi order nahi hai</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(function(o){
    const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

    let actions = '';
    if (o.status === 'pending'){
      actions = '<div class="admin-actions">' +
        '<button type="button" class="admin-btn approve" data-id="' + o.id + '">✅ Approve</button>' +
        '<button type="button" class="admin-btn reject" data-id="' + o.id + '" data-uid="' + o.uid + '" data-price="' + o.price + '">❌ Reject</button>' +
      '</div>';
    } else if (o.status === 'approved'){
      actions = '<div class="admin-actions">' +
        '<button type="button" class="admin-btn deliver" data-id="' + o.id + '">📦 Mark Delivered</button>' +
      '</div>';
    }

    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML =
      '<div class="admin-item-top">' +
        '<div><div class="admin-item-title">' + escapeHtml(o.productName) + '</div>' +
        '<div class="admin-item-sub">' + escapeHtml(o.userEmail || '') + ' • ' + o.qty + ' qty • UTR: ' + escapeHtml(o.utr) + '</div>' +
        '<div class="admin-item-sub">' + date + '</div></div>' +
        '<div class="admin-item-amount">₹' + o.price + '</div>' +
      '</div>' +
      '<span class="admin-status ' + o.status + '">' + o.status + '</span>' +
      actions;
    list.appendChild(div);
  });
}

document.getElementById('ordersList').addEventListener('click', async function(e){
  const approveBtn = e.target.closest('.admin-btn.approve');
  const rejectBtn = e.target.closest('.admin-btn.reject');
  const deliverBtn = e.target.closest('.admin-btn.deliver');

  if (approveBtn){
    const id = approveBtn.dataset.id;
    approveBtn.disabled = true;
    try{
      await updateDoc(doc(db, 'orders', id), { status: 'approved', approvedAt: new Date().toISOString() });
      const o = allOrders.find(function(x){ return x.id === id; });
      await logAdminAction('order_approved', '✅ Approved order: ' + (o ? o.productName : id) + ' for ' + (o ? o.userEmail : ''));
      await loadOrders();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      approveBtn.disabled = false;
    }
  }

  if (rejectBtn){
    const id = rejectBtn.dataset.id;
    const uid = rejectBtn.dataset.uid;
    const price = parseFloat(rejectBtn.dataset.price);
    rejectBtn.disabled = true;
    rejectBtn.textContent = 'Processing...';
    try{
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      const currentBal = userSnap.exists() && typeof userSnap.data().walletBalance === 'number' ? userSnap.data().walletBalance : 0;
      await updateDoc(userRef, { walletBalance: currentBal + price });
      await updateDoc(doc(db, 'orders', id), { status: 'rejected', rejectedAt: new Date().toISOString() });
      const o = allOrders.find(function(x){ return x.id === id; });
      await logAdminAction('order_rejected', '❌ Rejected order: ' + (o ? o.productName : id) + ' • ₹' + price + ' refunded to ' + (o ? o.userEmail : ''));
      await loadOrders();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      rejectBtn.disabled = false;
      rejectBtn.textContent = '❌ Reject';
    }
  }

  if (deliverBtn){
    const id = deliverBtn.dataset.id;
    deliverBtn.disabled = true;
    try{
      await updateDoc(doc(db, 'orders', id), { status: 'delivered', deliveredAt: new Date().toISOString() });
      const o = allOrders.find(function(x){ return x.id === id; });
      await logAdminAction('order_delivered', '📦 Delivered: ' + (o ? o.productName : id) + ' to ' + (o ? o.userEmail : ''));
      await loadOrders();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      deliverBtn.disabled = false;
    }
  }
});

document.getElementById('exportBtn').addEventListener('click', function(){
  const filtered = currentFilter === 'all' ? allOrders : allOrders.filter(function(o){ return o.status === currentFilter; });
  const rows = filtered.map(function(o){
    return [o.userEmail || '', o.productName || '', o.qty, o.price, o.utr || '', o.status, o.createdAt || ''];
  });
  downloadCSV('orders-' + currentFilter + '.csv', ['Email', 'Product', 'Qty', 'Price', 'UTR', 'Status', 'Date'], rows);
});

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
