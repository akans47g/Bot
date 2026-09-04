/* =================================================================
   USERS.JS — Search users, manually adjust wallet balance
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout, assignUniquePartnerCode } from "../../js/auth.js";
import { requireAdmin, logAdminAction } from "./admin-guard.js";
import {
  collection, getDocs, doc, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let allUsers = [];

requireAdmin(function(){
  loadUsers();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async function(){
  await logout();
  window.location.href = '../admin.html';
});

document.getElementById('userSearch').addEventListener('input', function(){
  render(this.value.trim().toLowerCase());
});

async function loadUsers(){
  const snap = await getDocs(collection(db, 'users'));
  allUsers = [];
  snap.forEach(function(d){ allUsers.push(Object.assign({ id: d.id }, d.data())); });
  allUsers.sort(function(a, b){ return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  render('');
}

function render(searchTerm){
  const list = document.getElementById('usersList');
  const filtered = !searchTerm ? allUsers : allUsers.filter(function(u){
    return (u.name || '').toLowerCase().indexOf(searchTerm) !== -1 ||
           (u.email || '').toLowerCase().indexOf(searchTerm) !== -1;
  });

  document.getElementById('userCount').textContent = filtered.length + ' / ' + allUsers.length;

  if (!filtered.length){
    list.innerHTML = '<p class="admin-empty">Koi user nahi mila</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(function(u){
    const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const bal = typeof u.walletBalance === 'number' ? u.walletBalance : 0;
    const partnerBal = typeof u.partnerBalance === 'number' ? u.partnerBalance : 0;
    const referBal = typeof u.referBalance === 'number' ? u.referBalance : 0;
    const isPartner = !!u.isPartner;
    const div = document.createElement('div');
    div.className = 'um-item';
    div.innerHTML =
      '<div class="um-item-top">' +
        '<div>' +
          '<div class="um-name">' + escapeHtml(u.name || 'Unnamed') + (isPartner ? ' <span class="admin-status approved">PARTNER</span>' : '') + '</div>' +
          '<div class="um-email">' + escapeHtml(u.email || '') + '</div>' +
          '<div class="um-meta">Joined: ' + joined + (u.whatsapp ? ' • WA: ' + escapeHtml(u.whatsapp) : '') + (isPartner ? ' • Code: ' + escapeHtml(u.partnerCode || '—') + ' • Bal: ₹' + partnerBal : '') + '</div>' +
          '<div class="um-meta">Refer Code: ' + escapeHtml(u.referCode || '—') + ' • Refer Bal: ₹' + referBal + '</div>' +
        '</div>' +
        '<div class="um-balance">₹' + bal + '</div>' +
      '</div>' +
      '<div class="admin-actions">' +
        '<button type="button" class="um-adjust-btn" data-uid="' + u.id + '" data-email="' + escapeHtml(u.email || '') + '" data-bal="' + bal + '">⚙️ Adjust Balance</button>' +
        '<button type="button" class="um-adjust-btn' + (isPartner ? ' danger' : '') + '" data-partner-toggle="' + u.id + '" data-email="' + escapeHtml(u.email || '') + '" data-current="' + isPartner + '">' + (isPartner ? '❌ Remove Partner' : '🤝 Make Partner') + '</button>' +
      '</div>';
    list.appendChild(div);
  });
}

document.getElementById('usersList').addEventListener('click', async function(e){
  const adjustBtn = e.target.closest('.um-adjust-btn[data-uid]');
  const partnerBtn = e.target.closest('[data-partner-toggle]');

  if (partnerBtn){
    const uid = partnerBtn.dataset.partnerToggle;
    const email = partnerBtn.dataset.email;
    const isCurrentlyPartner = partnerBtn.dataset.current === 'true';
    const action = isCurrentlyPartner ? 'remove' : 'make';

    if (!confirm((isCurrentlyPartner ? 'Remove' : 'Make') + ' ' + email + ' as Partner?')) return;

    try{
      const updates = { isPartner: !isCurrentlyPartner };

      if (!isCurrentlyPartner){
        // Partner banaya jaa raha hai — agar code pehle se nahi hai to abhi generate karo
        const userSnap = await getDoc(doc(db, 'users', uid));
        const existingCode = userSnap.exists() ? userSnap.data().partnerCode : null;
        if (!existingCode){
          updates.partnerCode = await assignUniquePartnerCode(uid);
        }
      }

      await updateDoc(doc(db, 'users', uid), updates);
      await logAdminAction(
        isCurrentlyPartner ? 'partner_removed' : 'partner_added',
        isCurrentlyPartner ? ('❌ Removed partner status from ' + email) : ('🤝 Made ' + email + ' a Partner')
      );
      await loadUsers();
    } catch(err){
      alert('Kuch galat ho gaya, dobara try karein');
    }
    return;
  }

  if (!adjustBtn) return;

  const uid = adjustBtn.dataset.uid;
  const email = adjustBtn.dataset.email;
  const currentBal = parseFloat(adjustBtn.dataset.bal);

  const amountStr = prompt('Kitna add/subtract karna hai?\n(Add ke liye: 50, Subtract ke liye: -50)');
  if (amountStr === null) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount === 0){
    alert('Sahi number daalein (jaise 50 ya -50)');
    return;
  }

  const reason = prompt('Reason likhein (support record ke liye):');
  if (reason === null) return;

  const newBalance = currentBal + amount;
  if (newBalance < 0){
    alert('Balance negative nahi ho sakta');
    return;
  }

  try{
    await updateDoc(doc(db, 'users', uid), { walletBalance: newBalance });
    await logAdminAction(
      'balance_adjusted',
      (amount > 0 ? '➕ Added ₹' + amount : '➖ Subtracted ₹' + Math.abs(amount)) +
      ' for ' + email + ' (' + (reason || 'no reason') + '). New balance: ₹' + newBalance
    );
    await loadUsers();
    document.getElementById('userSearch').value = '';
  } catch(err){
    alert('Kuch galat ho gaya, dobara try karein');
  }
});

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
