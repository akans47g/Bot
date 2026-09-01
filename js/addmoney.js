/* =================================================================
   ADDMONEY.JS — Wallet balance, UPI payment, UTR submit, history
   =================================================================
   👉 UPI ID yahi 3 lines me hain — agar kabhi badalna ho to sirf
      yahin change karna.
================================================================= */

import { auth, db } from "./firebase-init.js";
import { watchAuthState } from "./auth.js";
import {
  doc, onSnapshot, collection, addDoc, query, where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const UPI_PHONEPE = "9021958286@ybl";
const UPI_PAYTM   = "akans.m7@ptaxis";
const UPI_GPAY    = "moinkhanmanyar@okhdfcbank";
const UPI_NAME    = "AKANS Social Store";

const PRESETS = [25, 50, 100, 250, 500, 1000, 2000, 4000];
const MIN_AMOUNT = 25;

let currentUser = null;
let selectedAmount = 0;

/* ---------- QR CODE (payee ID fixed, amount user khud daalega) ---------- */
(function setupQr(){
  const data = encodeURIComponent('upi://pay?pa=' + UPI_PHONEPE + '&pn=' + UPI_NAME);
  document.getElementById('amQrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + data;
})();

/* ---------- AUTH GUARD ---------- */
watchAuthState(function(user){
  if (!user){
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  listenToBalance(user.uid);
  listenToHistory(user.uid);
});

/* ---------- BALANCE (live) ---------- */
function listenToBalance(uid){
  const ref = doc(db, "users", uid);
  onSnapshot(ref, function(snap){
    const data = snap.data();
    const bal = data && typeof data.walletBalance === 'number' ? data.walletBalance : 0;
    document.getElementById('amBalance').textContent = '₹' + bal;
  });
}

/* ---------- PRESET BUTTONS ---------- */
const grid = document.getElementById('amPresetGrid');
PRESETS.forEach(function(amt){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'am-preset-btn';
  btn.textContent = '₹' + amt;
  btn.onclick = function(){ selectAmount(amt, btn); };
  grid.appendChild(btn);
});

function selectAmount(amt, btnEl){
  document.querySelectorAll('.am-preset-btn').forEach(function(b){ b.classList.remove('selected'); });
  if (btnEl) btnEl.classList.add('selected');
  selectedAmount = amt;
  document.getElementById('amCustomAmount').value = amt;
  document.getElementById('amConfirmAmount').value = amt;
  document.getElementById('amError').textContent = '';
}

document.getElementById('amCustomAmount').addEventListener('input', function(){
  document.querySelectorAll('.am-preset-btn').forEach(function(b){ b.classList.remove('selected'); });
  const val = parseInt(this.value, 10);
  selectedAmount = isNaN(val) ? 0 : val;
  document.getElementById('amConfirmAmount').value = this.value;
  document.getElementById('amError').textContent = '';
});

/* ---------- UPI DEEP LINKS ---------- */
function getValidAmount(){
  if (!selectedAmount || selectedAmount < MIN_AMOUNT){
    document.getElementById('amError').textContent = 'Kam se kam ₹' + MIN_AMOUNT + ' amount select karein';
    return null;
  }
  return selectedAmount.toFixed(2);
}

function openUPI(upiId, scheme){
  const amount = getValidAmount();
  if (!amount) return;

  const genericLink = 'upi://pay?pa=' + upiId + '&pn=' + encodeURIComponent(UPI_NAME) + '&am=' + amount + '&cu=INR&tn=AKANS+Add+Money';

  const appLinks = {
    phonepe: 'phonepe://pay?pa=' + upiId + '&pn=' + encodeURIComponent(UPI_NAME) + '&am=' + amount + '&cu=INR',
    paytm:   'paytmmp://pay?pa=' + upiId + '&pn=' + encodeURIComponent(UPI_NAME) + '&am=' + amount + '&cu=INR',
    gpay:    'tez://upi/pay?pa=' + upiId + '&pn=' + encodeURIComponent(UPI_NAME) + '&am=' + amount + '&cu=INR'
  };

  window.location.href = appLinks[scheme] || genericLink;
  setTimeout(function(){ window.location.href = genericLink; }, 1500);
}

document.getElementById('amPhonePe').addEventListener('click', function(){ openUPI(UPI_PHONEPE, 'phonepe'); });
document.getElementById('amPaytm').addEventListener('click', function(){ openUPI(UPI_PAYTM, 'paytm'); });
document.getElementById('amGPay').addEventListener('click', function(){ openUPI(UPI_GPAY, 'gpay'); });
document.getElementById('amOther').addEventListener('click', function(){ openUPI(UPI_PHONEPE, 'other'); });

/* ---------- COPY UPI ID ---------- */
document.getElementById('amCopyBtn').addEventListener('click', async function(){
  try{
    await navigator.clipboard.writeText(UPI_PHONEPE);
  } catch(e){
    const ta = document.createElement('textarea');
    ta.value = UPI_PHONEPE;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const btn = document.getElementById('amCopyBtn');
  btn.textContent = '✅';
  setTimeout(function(){ btn.textContent = 'Copy'; }, 2000);
});

/* ---------- SUBMIT UTR ---------- */
document.getElementById('amSubmitBtn').addEventListener('click', async function(){
  const errEl = document.getElementById('amError');
  const utr = document.getElementById('amUtr').value.trim();
  const amount = selectedAmount;
  const btn = this;

  errEl.style.color = '';

  if (!amount || amount < MIN_AMOUNT){
    errEl.textContent = 'Kam se kam ₹' + MIN_AMOUNT + ' amount select karein';
    return;
  }
  if (!utr){
    errEl.textContent = 'UTR / Transaction ID daalein';
    return;
  }
  if (!currentUser){
    errEl.textContent = 'Login check ho raha hai, thoda ruk kar try karein';
    return;
  }

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Submit ho raha hai...';

  try{
    await addDoc(collection(db, 'topups'), {
      uid: currentUser.uid,
      userEmail: currentUser.email || '',
      amount: amount,
      utr: utr,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    document.getElementById('amUtr').value = '';
    document.getElementById('amCustomAmount').value = '';
    document.getElementById('amConfirmAmount').value = '';
    document.querySelectorAll('.am-preset-btn').forEach(function(b){ b.classList.remove('selected'); });
    selectedAmount = 0;

    errEl.style.color = 'var(--success)';
    errEl.textContent = '✅ Request submit ho gayi! Verification ka wait karein.';
  } catch(err){
    errEl.style.color = '';
    errEl.textContent = 'Kuch galat ho gaya, dobara try karein';
  }

  btn.disabled = false;
  btn.textContent = 'Submit Request 🚀';
});

/* ---------- HISTORY (live, sorted client-side to avoid needing a Firestore index) ---------- */
function listenToHistory(uid){
  const q = query(collection(db, 'topups'), where('uid', '==', uid));
  onSnapshot(q, function(snap){
    const list = document.getElementById('amHistoryList');
    const countEl = document.getElementById('amHistoryCount');
    countEl.textContent = snap.size;

    if (snap.empty){
      list.innerHTML = '<p class="am-empty">Koi request nahi hai abhi tak</p>';
      return;
    }

    const docs = [];
    snap.forEach(function(docSnap){ docs.push(docSnap.data()); });
    docs.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });

    list.innerHTML = '';
    docs.forEach(function(d){
      const date = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
      const item = document.createElement('div');
      item.className = 'am-history-item';
      item.innerHTML =
        '<div class="am-history-left">' +
          '<div class="am-history-app">' + date + '</div>' +
          '<div class="am-history-utr">UTR: ' + escapeHtml(d.utr) + '</div>' +
        '</div>' +
        '<div class="am-history-right">' +
          '<div class="am-history-amount">₹' + d.amount + '</div>' +
          '<span class="am-status ' + d.status + '">' + d.status + '</span>' +
        '</div>';
      list.appendChild(item);
    });
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
