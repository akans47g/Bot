/* =================================================================
   FF-ORDERS.JS — Free Fire plan requests
   =================================================================
   Approve karne ke baad order "Processing" dikhega — koi extra
   button dabane ki zaroorat nahi, jab plan ke utne din (days)
   guzar jaate hain (approvedAt se), automatically "Completed"
   dikhne lagta hai — pure date-math se, koi background job nahi.
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin, logAdminAction, downloadCSV } from "./admin-guard.js";
import {
  collection, getDocs, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let allFFOrders = [];
let currentFilter = 'pending';

requireAdmin(function(){
  loadFFOrders();
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

async function loadFFOrders(){
  const snap = await getDocs(collection(db, 'ffOrders'));
  allFFOrders = [];
  snap.forEach(function(d){ allFFOrders.push(Object.assign({ id: d.id }, d.data())); });
  allFFOrders.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  render();
}

/* status jo Firestore me hai: pending/approved/rejected.
   Yahan "approved" ko days ke hisaab se processing/completed
   me todte hain — pure client-side, koi write nahi hoti. */
function getEffectiveStatus(order){
  if (order.status !== 'approved') return order.status;
  const daysElapsed = (Date.now() - new Date(order.approvedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysElapsed >= order.days ? 'completed' : 'processing';
}

function daysRemainingText(order){
  const daysElapsed = (Date.now() - new Date(order.approvedAt).getTime()) / (1000 * 60 * 60 * 24);
  const remaining = Math.max(0, Math.ceil(order.days - daysElapsed));
  return remaining + ' din baaki';
}

function render(){
  const list = document.getElementById('ffOrdersList');
  const filtered = allFFOrders.filter(function(o){
    const eff = getEffectiveStatus(o);
    return currentFilter === 'all' || eff === currentFilter;
  });

  if (!filtered.length){
    list.innerHTML = '<p class="admin-empty">Is category me koi plan nahi hai</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(function(o){
    const eff = getEffectiveStatus(o);
    const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

    let actions = '';
    if (o.status === 'pending'){
      actions = '<div class="admin-actions">' +
        '<button type="button" class="admin-btn approve" data-id="' + o.id + '">✅ Approve</button>' +
        '<button type="button" class="admin-btn reject" data-id="' + o.id + '" data-uid="' + o.uid + '" data-price="' + o.price + '">❌ Reject</button>' +
      '</div>';
    }

    const extraLine = eff === 'processing' ? '<div class="admin-item-sub">⏳ ' + daysRemainingText(o) + '</div>' : '';

    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML =
      '<div class="admin-item-top">' +
        '<div><div class="admin-item-title">' + escapeHtml(o.planName) + '</div>' +
        '<div class="admin-item-sub">' + escapeHtml(o.userEmail || '') + ' • ' + o.totalContent + ' total • UTR: ' + escapeHtml(o.utr) + '</div>' +
        '<div class="admin-item-sub">' + date + '</div>' +
        extraLine +
        '</div>' +
        '<div class="admin-item-amount">₹' + o.price + '</div>' +
      '</div>' +
      '<span class="admin-status ' + eff + '">' + eff + '</span>' +
      actions;
    list.appendChild(div);
  });
}

document.getElementById('ffOrdersList').addEventListener('click', async function(e){
  const approveBtn = e.target.closest('.admin-btn.approve');
  const rejectBtn = e.target.closest('.admin-btn.reject');

  if (approveBtn){
    const id = approveBtn.dataset.id;
    approveBtn.disabled = true;
    try{
      await updateDoc(doc(db, 'ffOrders', id), { status: 'approved', approvedAt: new Date().toISOString() });
      const o = allFFOrders.find(function(x){ return x.id === id; });
      await logAdminAction('ff_approved', '✅ Approved FF plan: ' + (o ? o.planName : id) + ' for ' + (o ? o.userEmail : ''));
      await loadFFOrders();
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
      await updateDoc(doc(db, 'ffOrders', id), { status: 'rejected', rejectedAt: new Date().toISOString() });
      const o = allFFOrders.find(function(x){ return x.id === id; });
      await logAdminAction('ff_rejected', '❌ Rejected FF plan: ' + (o ? o.planName : id) + ' • ₹' + price + ' refunded to ' + (o ? o.userEmail : ''));
      await loadFFOrders();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      rejectBtn.disabled = false;
      rejectBtn.textContent = '❌ Reject';
    }
  }
});

document.getElementById('exportBtn').addEventListener('click', function(){
  const filtered = allFFOrders.filter(function(o){
    const eff = getEffectiveStatus(o);
    return currentFilter === 'all' || eff === currentFilter;
  });
  const rows = filtered.map(function(o){
    return [o.userEmail || '', o.planName, o.totalContent, o.price, o.utr || '', getEffectiveStatus(o), o.createdAt || ''];
  });
  downloadCSV('ff-orders-' + currentFilter + '.csv', ['Email', 'Plan', 'Total Content', 'Price', 'UTR', 'Status', 'Date'], rows);
});

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
