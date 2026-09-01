/* =================================================================
   WITHDRAWALS.JS — Partner (49%) aur Refer (21%) dono payout
   requests, ek hi page se, type-toggle se switch hote hain.
   =================================================================
   Complete: paisa already deduct ho chuka hai request ke time,
   admin ne bahar UPI se bhej diya, bas status update karna hai.
   Reject: sahi balance field (partnerBalance/referBalance) wapas
   refund hota hai.
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin, logAdminAction, downloadCSV } from "./admin-guard.js";
import {
  collection, getDocs, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const TYPE_CONFIG = {
  partner: { collection: 'partnerWithdrawals', balanceField: 'partnerBalance', label: 'Partner' },
  refer:   { collection: 'referWithdrawals',   balanceField: 'referBalance',   label: 'Refer' }
};

let allWithdrawals = [];
let currentType = 'partner';
let currentFilter = 'pending';

requireAdmin(function(){
  loadWithdrawals();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async function(){
  await logout();
  window.location.href = '../admin.html';
});

document.getElementById('typeToggle').addEventListener('click', function(e){
  const btn = e.target.closest('.range-btn');
  if (!btn) return;
  document.querySelectorAll('#typeToggle .range-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  currentType = btn.dataset.type;
  loadWithdrawals();
});

document.getElementById('filterTabs').addEventListener('click', function(e){
  const btn = e.target.closest('.filter-tab');
  if (!btn) return;
  document.querySelectorAll('.filter-tab').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  render();
});

async function loadWithdrawals(){
  const list = document.getElementById('withdrawalsList');
  list.innerHTML = '<p class="admin-empty">Load ho raha hai...</p>';

  const config = TYPE_CONFIG[currentType];
  const snap = await getDocs(collection(db, config.collection));
  allWithdrawals = [];
  snap.forEach(function(d){ allWithdrawals.push(Object.assign({ id: d.id }, d.data())); });
  allWithdrawals.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  render();
}

function render(){
  const list = document.getElementById('withdrawalsList');
  const filtered = currentFilter === 'all' ? allWithdrawals : allWithdrawals.filter(function(w){ return w.status === currentFilter; });

  if (!filtered.length){
    list.innerHTML = '<p class="admin-empty">Is category me koi request nahi hai</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(function(w){
    const date = w.createdAt ? new Date(w.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML =
      '<div class="admin-item-top">' +
        '<div><div class="admin-item-title">' + escapeHtml(w.userEmail || 'Unknown') + '</div>' +
        '<div class="admin-item-sub">UPI: ' + escapeHtml(w.upiId) + ' • ' + date + '</div></div>' +
        '<div class="admin-item-amount">₹' + w.amount + '</div>' +
      '</div>' +
      '<span class="admin-status ' + w.status + '">' + w.status + '</span>' +
      (w.status === 'pending' ?
        '<div class="admin-actions">' +
          '<button type="button" class="admin-btn approve" data-id="' + w.id + '">✅ Mark Completed</button>' +
          '<button type="button" class="admin-btn reject" data-id="' + w.id + '" data-uid="' + w.uid + '" data-amount="' + w.amount + '">❌ Reject</button>' +
        '</div>' : '');
    list.appendChild(div);
  });
}

document.getElementById('withdrawalsList').addEventListener('click', async function(e){
  const approveBtn = e.target.closest('.admin-btn.approve');
  const rejectBtn = e.target.closest('.admin-btn.reject');
  const config = TYPE_CONFIG[currentType];

  if (approveBtn){
    const id = approveBtn.dataset.id;
    approveBtn.disabled = true;
    try{
      await updateDoc(doc(db, config.collection, id), { status: 'completed', completedAt: new Date().toISOString() });
      const w = allWithdrawals.find(function(x){ return x.id === id; });
      await logAdminAction(config.label.toLowerCase() + '_withdrawal_completed', '✅ [' + config.label + '] Paid ₹' + (w ? w.amount : '') + ' to ' + (w ? w.userEmail : id) + ' (UPI: ' + (w ? w.upiId : '') + ')');
      await loadWithdrawals();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      approveBtn.disabled = false;
    }
  }

  if (rejectBtn){
    const id = rejectBtn.dataset.id;
    const uid = rejectBtn.dataset.uid;
    const amount = parseFloat(rejectBtn.dataset.amount);
    rejectBtn.disabled = true;
    rejectBtn.textContent = 'Processing...';
    try{
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      const currentBal = userSnap.exists() && typeof userSnap.data()[config.balanceField] === 'number' ? userSnap.data()[config.balanceField] : 0;
      await updateDoc(userRef, { [config.balanceField]: currentBal + amount });
      await updateDoc(doc(db, config.collection, id), { status: 'rejected', rejectedAt: new Date().toISOString() });
      const w = allWithdrawals.find(function(x){ return x.id === id; });
      await logAdminAction(config.label.toLowerCase() + '_withdrawal_rejected', '❌ [' + config.label + '] Rejected withdrawal, ₹' + amount + ' refunded to ' + (w ? w.userEmail : uid));
      await loadWithdrawals();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      rejectBtn.disabled = false;
      rejectBtn.textContent = '❌ Reject';
    }
  }
});

document.getElementById('exportBtn').addEventListener('click', function(){
  const filtered = currentFilter === 'all' ? allWithdrawals : allWithdrawals.filter(function(w){ return w.status === currentFilter; });
  const rows = filtered.map(function(w){
    return [w.userEmail || '', w.upiId || '', w.amount, w.status, w.createdAt || ''];
  });
  downloadCSV(currentType + '-withdrawals-' + currentFilter + '.csv', ['Email', 'UPI ID', 'Amount', 'Status', 'Date'], rows);
});

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
