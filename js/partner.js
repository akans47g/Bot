/* =================================================================
   PARTNER.JS — Partner Program page logic
   =================================================================
   Sirf woh users chala sakte hain jinka Firestore users/{uid}
   document me isPartner === true hai (admin ne set kiya hoga).
================================================================= */

import { db } from "./firebase-init.js";
import { watchAuthState, assignUniquePartnerCode } from "./auth.js";
import {
  doc, getDoc, onSnapshot, updateDoc, collection, addDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let currentUser = null;

watchAuthState(function(user){
  if (!user){
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  checkPartnerAccess(user);
});

async function checkPartnerAccess(user){
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  if (!data.isPartner){
    alert('Ye page sirf Partner Program members ke liye hai');
    window.location.href = 'index.html';
    return;
  }

  // Purane partners jinko code kabhi assign nahi hua tha, unke liye
  // abhi generate karke save kar do (naye partners ko admin ne
  // "Make Partner" karte hi de diya hoga).
  let myPartnerCode = data.partnerCode;
  if (!myPartnerCode){
    myPartnerCode = await assignUniquePartnerCode(user.uid);
    await updateDoc(ref, { partnerCode: myPartnerCode });
  }

  setupCodeAndLink(myPartnerCode);
  listenBalance(user.uid);
  loadReferrals(user.uid);
  loadWithdrawHistory(user.uid);
}

function setupCodeAndLink(code){
  document.getElementById('ppCode').textContent = code;

  const loginPath = window.location.pathname.replace(/p\.html$/, 'login.html');
  const link = window.location.origin + loginPath + '?pc=' + code;
  document.getElementById('ppLinkText').textContent = link;

  document.getElementById('ppCodeCopyBtn').addEventListener('click', function(){
    copyText(code, this, 'Copy Code');
  });
  document.getElementById('ppCopyBtn').addEventListener('click', function(){
    copyText(link, this, 'Copy');
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
    const bal = typeof (snap.data() || {}).partnerBalance === 'number' ? snap.data().partnerBalance : 0;
    document.getElementById('ppBalance').textContent = '₹' + bal;
  });
}

async function loadReferrals(uid){
  const snap = await getDocs(query(collection(db, 'users'), where('referredBy', '==', uid)));
  document.getElementById('ppReferralCount').textContent = snap.size;

  const list = document.getElementById('ppReferralList');
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
    const div = document.createElement('div');
    div.className = 'pp-ref-item';
    div.innerHTML = '<span>' + escapeHtml(u.name || u.email || 'User') + '</span><span class="pp-ref-date">' + joined + '</span>';
    list.appendChild(div);
  });
}

document.getElementById('ppConvertBtn').addEventListener('click', async function(){
  const amtEl = document.getElementById('ppConvertAmount');
  const errEl = document.getElementById('ppConvertError');
  const amount = parseFloat(amtEl.value);
  errEl.textContent = '';

  if (isNaN(amount) || amount <= 0){
    errEl.textContent = 'Sahi amount daalein';
    return;
  }

  const ref = doc(db, 'users', currentUser.uid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  const partnerBal = typeof data.partnerBalance === 'number' ? data.partnerBalance : 0;
  const walletBal = typeof data.walletBalance === 'number' ? data.walletBalance : 0;

  if (amount > partnerBal){
    errEl.textContent = 'Itna Partner Balance nahi hai';
    return;
  }

  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Convert ho raha hai...';

  try{
    await updateDoc(ref, {
      partnerBalance: partnerBal - amount,
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

document.getElementById('ppWithdrawBtn').addEventListener('click', async function(){
  const errEl = document.getElementById('ppError');
  const upiId = document.getElementById('ppUpiId').value.trim();
  const amount = parseFloat(document.getElementById('ppWithdrawAmount').value);

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
  const partnerBal = typeof (snap.data() || {}).partnerBalance === 'number' ? snap.data().partnerBalance : 0;

  if (amount > partnerBal){
    errEl.textContent = 'Itna Partner Balance nahi hai';
    return;
  }

  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Submit ho raha hai...';

  try{
    await updateDoc(ref, { partnerBalance: partnerBal - amount });
    await addDoc(collection(db, 'partnerWithdrawals'), {
      uid: currentUser.uid,
      userEmail: currentUser.email || '',
      upiId: upiId,
      amount: amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    document.getElementById('ppUpiId').value = '';
    document.getElementById('ppWithdrawAmount').value = '';
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
  const snap = await getDocs(query(collection(db, 'partnerWithdrawals'), where('uid', '==', uid)));
  const list = document.getElementById('ppWithdrawHistory');

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
