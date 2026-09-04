/* =================================================================
   REFER.JS — Refer & Earn page logic (open to ALL users)
   =================================================================
   Partner Program se alag: koi admin-gating nahi, har logged-in
   user ka apna referCode aur referBalance hota hai (auth.js me
   signup ke time hi generate ho jaata hai).
================================================================= */

import { db } from "./firebase-init.js";
import { watchAuthState, assignUniqueReferCode } from "./auth.js";
import {
  doc, getDoc, onSnapshot, updateDoc, collection, addDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let currentUser = null;
let myReferCode = null;

watchAuthState(function(user){
  if (!user){
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  init(user);
});

async function init(user){
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};

  // Purane accounts jinko Refer System banne se PEHLE signup kiya
  // tha, unke paas referCode nahi hoga — abhi generate karke save
  // kar do, taaki link kabhi "----" jaisa placeholder na dikhaye.
  myReferCode = data.referCode;
  if (!myReferCode){
    myReferCode = await assignUniqueReferCode(user.uid);
    await updateDoc(ref, { referCode: myReferCode });
  }

  document.getElementById('rfCode').textContent = myReferCode;
  setupLink();
  listenBalance(user.uid);
  loadReferrals(user.uid);
  loadWithdrawHistory(user.uid);
}

function setupLink(){
  const loginPath = window.location.pathname.replace(/refer\.html$/, 'login.html');
  const link = window.location.origin + loginPath + '?rc=' + myReferCode;
  document.getElementById('rfLinkText').textContent = link;

  document.getElementById('rfCodeCopyBtn').addEventListener('click', function(){
    copyText(myReferCode, this, 'Copy Code');
  });
  document.getElementById('rfLinkCopyBtn').addEventListener('click', function(){
    copyText(link, this, 'Copy Link');
  });
}

async function copyText(text, btn, resetLabel){
  try{
    await navigator.clipboard.writeText(text);
  } catch(e){
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  btn.textContent = '✅';
  setTimeout(function(){ btn.textContent = resetLabel; }, 2000);
}

function listenBalance(uid){
  onSnapshot(doc(db, 'users', uid), function(snap){
    const bal = typeof (snap.data() || {}).referBalance === 'number' ? snap.data().referBalance : 0;
    document.getElementById('rfBalance').textContent = '₹' + bal;
  });
}

async function loadReferrals(uid){
  const snap = await getDocs(query(collection(db, 'users'), where('referredByUid', '==', uid)));
  document.getElementById('rfReferralCount').textContent = snap.size;

  const list = document.getElementById('rfReferralList');
  if (snap.empty){
    list.innerHTML = '<p class="admin-empty">Abhi tak koi referral nahi hai</p>';
    return;
  }

  const docs = [];
  snap.forEach(function(d){ docs.push(d.data()); });
  docs.sort(function(a, b){ return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });

  list.innerHTML = '';
  docs.forEach(function(u){
    const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    const status = u.firstDepositDone ? '✅ Deposit ho gaya' : '⏳ Deposit baaki';
    const div = document.createElement('div');
    div.className = 'pp-ref-item';
    div.innerHTML = '<span>' + escapeHtml(u.name || u.email || 'User') + '</span><span class="pp-ref-date">' + status + ' • ' + joined + '</span>';
    list.appendChild(div);
  });
}

document.getElementById('rfConvertBtn').addEventListener('click', async function(){
  const amtEl = document.getElementById('rfConvertAmount');
  const errEl = document.getElementById('rfConvertError');
  const amount = parseFloat(amtEl.value);
  errEl.textContent = '';

  if (isNaN(amount) || amount <= 0){
    errEl.textContent = 'Sahi amount daalein';
    return;
  }

  const ref = doc(db, 'users', currentUser.uid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  const referBal = typeof data.referBalance === 'number' ? data.referBalance : 0;
  const walletBal = typeof data.walletBalance === 'number' ? data.walletBalance : 0;

  if (amount > referBal){
    errEl.textContent = 'Itna Refer Balance nahi hai';
    return;
  }

  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Convert ho raha hai...';

  try{
    await updateDoc(ref, {
      referBalance: referBal - amount,
      walletBalance: walletBal + amount
    });
    amtEl.value = '';
    errEl.style.color = 'var(--success)';
    errEl.textContent = '✅ ₹' + amount + ' wallet me convert ho gaya!';
  } catch(err){
    errEl.style.color = '';
    errEl.textContent = 'Kuch galat ho gaya, dobara try karein';
  }

  btn.disabled = false;
  btn.textContent = 'Convert Now';
});

document.getElementById('rfWithdrawBtn').addEventListener('click', async function(){
  const errEl = document.getElementById('rfError');
  const upiId = document.getElementById('rfUpiId').value.trim();
  const amount = parseFloat(document.getElementById('rfWithdrawAmount').value);

  errEl.style.color = '';
  errEl.textContent = '';

  if (!upiId){
    errEl.textContent = 'Apna UPI ID daalein';
    return;
  }
  if (isNaN(amount) || amount < 25){
    errEl.textContent = 'Minimum ₹25 withdraw kar sakte hain';
    return;
  }

  const ref = doc(db, 'users', currentUser.uid);
  const snap = await getDoc(ref);
  const referBal = typeof (snap.data() || {}).referBalance === 'number' ? snap.data().referBalance : 0;

  if (amount > referBal){
    errEl.textContent = 'Itna Refer Balance nahi hai';
    return;
  }

  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Submit ho raha hai...';

  try{
    await updateDoc(ref, { referBalance: referBal - amount });
    await addDoc(collection(db, 'referWithdrawals'), {
      uid: currentUser.uid,
      userEmail: currentUser.email || '',
      upiId: upiId,
      amount: amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    document.getElementById('rfUpiId').value = '';
    document.getElementById('rfWithdrawAmount').value = '';
    errEl.style.color = 'var(--success)';
    errEl.textContent = '✅ Withdrawal request bhej di gayi! Admin verify karke bhej dega.';
    loadWithdrawHistory(currentUser.uid);
  } catch(err){
    errEl.style.color = '';
    errEl.textContent = 'Kuch galat ho gaya, dobara try karein';
  }

  btn.disabled = false;
  btn.textContent = 'Submit Withdrawal Request';
});

async function loadWithdrawHistory(uid){
  const snap = await getDocs(query(collection(db, 'referWithdrawals'), where('uid', '==', uid)));
  const list = document.getElementById('rfWithdrawHistory');

  if (snap.empty){
    list.innerHTML = '<p class="admin-empty">Koi withdrawal nahi hai</p>';
    return;
  }

  const docs = [];
  snap.forEach(function(d){ docs.push(d.data()); });
  docs.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });

  list.innerHTML = '';
  docs.forEach(function(w){
    const date = w.createdAt ? new Date(w.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    const div = document.createElement('div');
    div.className = 'pp-withdraw-item';
    div.innerHTML =
      '<span>₹' + w.amount + ' • ' + escapeHtml(w.upiId) + ' • ' + date + '</span>' +
      '<span class="admin-status ' + w.status + '">' + w.status + '</span>';
    list.appendChild(div);
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
