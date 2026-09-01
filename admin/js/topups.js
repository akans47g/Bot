/* =================================================================
   TOPUPS.JS — List, filter, approve (wallet credit), reject
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin, logAdminAction, downloadCSV } from "./admin-guard.js";
import {
  collection, getDocs, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let allTopups = [];
let currentFilter = 'pending';

requireAdmin(function(){
  loadTopups();
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

async function loadTopups(){
  const snap = await getDocs(collection(db, 'topups'));
  allTopups = [];
  snap.forEach(function(d){ allTopups.push(Object.assign({ id: d.id }, d.data())); });
  allTopups.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  render();
}

function render(){
  const list = document.getElementById('topupsList');
  const filtered = currentFilter === 'all' ? allTopups : allTopups.filter(function(t){ return t.status === currentFilter; });

  if (!filtered.length){
    list.innerHTML = '<p class="admin-empty">Is category me koi request nahi hai</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(function(t){
    const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML =
      '<div class="admin-item-top">' +
        '<div><div class="admin-item-title">' + escapeHtml(t.userEmail || 'Unknown') + '</div>' +
        '<div class="admin-item-sub">UTR: ' + escapeHtml(t.utr) + ' • ' + date + '</div></div>' +
        '<div class="admin-item-amount">₹' + t.amount + '</div>' +
      '</div>' +
      '<span class="admin-status ' + t.status + '">' + t.status + '</span>' +
      (t.status === 'pending' ?
        '<div class="admin-actions">' +
          '<button type="button" class="admin-btn approve" data-id="' + t.id + '" data-uid="' + t.uid + '" data-amount="' + t.amount + '">✅ Approve</button>' +
          '<button type="button" class="admin-btn reject" data-id="' + t.id + '">❌ Reject</button>' +
        '</div>' : '');
    list.appendChild(div);
  });
}

document.getElementById('topupsList').addEventListener('click', async function(e){
  const approveBtn = e.target.closest('.admin-btn.approve');
  const rejectBtn = e.target.closest('.admin-btn.reject');

  if (approveBtn){
    const id = approveBtn.dataset.id;
    const uid = approveBtn.dataset.uid;
    const amount = parseFloat(approveBtn.dataset.amount);
    approveBtn.disabled = true;
    approveBtn.textContent = 'Processing...';
    try{
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : {};
      const currentBal = typeof userData.walletBalance === 'number' ? userData.walletBalance : 0;
      const isFirstDeposit = !userData.firstDepositDone;
      await updateDoc(userRef, { walletBalance: currentBal + amount, firstDepositDone: true });

      // Partner Program commission — agar ye user kisi partner ke
      // referral se aaya tha, to us partner ko 49% commission milega.
      // Ye HAR top-up par chalta hai, sirf pehle wale par nahi.
      if (userData.referredBy){
        const partnerRef = doc(db, 'users', userData.referredBy);
        const partnerSnap = await getDoc(partnerRef);
        if (partnerSnap.exists()){
          const partnerData = partnerSnap.data();
          const currentPartnerBal = typeof partnerData.partnerBalance === 'number' ? partnerData.partnerBalance : 0;
          const commission = Math.round(amount * 0.49 * 100) / 100;
          await updateDoc(partnerRef, { partnerBalance: currentPartnerBal + commission });
          await logAdminAction('partner_commission', '🤝 ₹' + commission + ' commission → ' + (partnerData.email || userData.referredBy) + ' (from ' + (userData.email || uid) + '\'s ₹' + amount + ' top-up)');
        }
      }

      // Refer System commission — agar ye user kisi refer-code se
      // aaya tha, to us referrer ko 21% milta hai, LEKIN sirf is
      // user ke PEHLE hi deposit par (baad ke top-ups par nahi).
      if (userData.referredByUid && isFirstDeposit){
        const referrerRef = doc(db, 'users', userData.referredByUid);
        const referrerSnap = await getDoc(referrerRef);
        if (referrerSnap.exists()){
          const referrerData = referrerSnap.data();
          const currentReferBal = typeof referrerData.referBalance === 'number' ? referrerData.referBalance : 0;
          const referCommission = Math.round(amount * 0.21 * 100) / 100;
          await updateDoc(referrerRef, { referBalance: currentReferBal + referCommission });
          await logAdminAction('refer_commission', '🎯 ₹' + referCommission + ' refer-commission → ' + (referrerData.email || userData.referredByUid) + ' (from ' + (userData.email || uid) + '\'s FIRST ₹' + amount + ' top-up)');
        }
      }

      await updateDoc(doc(db, 'topups', id), { status: 'approved', approvedAt: new Date().toISOString() });
      const t = allTopups.find(function(x){ return x.id === id; });
      await logAdminAction('topup_approved', '✅ Approved ₹' + amount + ' top-up for ' + (t ? t.userEmail : uid));
      await loadTopups();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      approveBtn.disabled = false;
      approveBtn.textContent = '✅ Approve';
    }
  }

  if (rejectBtn){
    const id = rejectBtn.dataset.id;
    rejectBtn.disabled = true;
    try{
      await updateDoc(doc(db, 'topups', id), { status: 'rejected', rejectedAt: new Date().toISOString() });
      const t = allTopups.find(function(x){ return x.id === id; });
      await logAdminAction('topup_rejected', '❌ Rejected ₹' + (t ? t.amount : '') + ' top-up for ' + (t ? t.userEmail : id));
      await loadTopups();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
      rejectBtn.disabled = false;
    }
  }
});

document.getElementById('exportBtn').addEventListener('click', function(){
  const filtered = currentFilter === 'all' ? allTopups : allTopups.filter(function(t){ return t.status === currentFilter; });
  const rows = filtered.map(function(t){
    return [t.userEmail || '', t.amount, t.utr || '', t.status, t.createdAt || ''];
  });
  downloadCSV('topups-' + currentFilter + '.csv', ['Email', 'Amount', 'UTR', 'Status', 'Date'], rows);
});

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
