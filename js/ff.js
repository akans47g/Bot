/* =================================================================
   FF.JS — Free Fire plan purchase logic
   =================================================================
   👉 Plan data yahin hai — naya plan add karna ho to bas is object
      me ek entry aur add karo, aur ff.html me ek card copy-paste
      karke uska data-target/onclick id match kar do.

   ⚠️ ff4 (30 Days) ka price abhi PLACEHOLDER hai (₹399) — jab tak
      confirm na ho jaaye, real revenue is number pe based hoga.
================================================================= */

import { auth, db } from "./firebase-init.js";
import {
  doc, getDoc, updateDoc, collection, addDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const FF_PLANS = {
  ff1: { name: '1 Day Plan',   days: 1,  totalContent: 220,  price: 25  },
  ff2: { name: '5 Days Plan',  days: 5,  totalContent: 1100, price: 99  },
  ff3: { name: '15 Days Plan', days: 15, totalContent: 3300, price: 219 },
  ff4: { name: '30 Days Plan', days: 30, totalContent: 6600, price: 399 } // ⚠️ placeholder
};

let currentPlanId = null;

function formatINR(n){
  n = Math.round(n * 100) / 100;
  return "₹" + (n % 1 === 0 ? n : n.toFixed(2));
}

async function openFFModal(planId){
  const plan = FF_PLANS[planId];
  if (!plan){ alert('Plan data nahi mili'); return; }

  currentPlanId = planId;
  document.getElementById('ffModalTitle').textContent = plan.name;
  document.getElementById('ffModalSub').textContent = plan.totalContent + ' total content • ' + plan.days + ' din • 220/day';
  document.getElementById('ffModalPrice').textContent = formatINR(plan.price);
  document.getElementById('ffUtr').value = '';
  document.getElementById('ffError').textContent = '';
  document.getElementById('ffInsufficient').classList.remove('show');

  const user = auth.currentUser;
  if (user){
    document.getElementById('ffWalletBal').textContent = '...';
    try{
      const snap = await getDoc(doc(db, 'users', user.uid));
      const bal = snap.exists() && typeof snap.data().walletBalance === 'number' ? snap.data().walletBalance : 0;
      document.getElementById('ffWalletBal').textContent = formatINR(bal);
    } catch(e){
      document.getElementById('ffWalletBal').textContent = '—';
    }
  } else {
    document.getElementById('ffWalletBal').textContent = 'Login karein';
  }

  document.body.classList.add('bm-open');
  document.getElementById('ffModalOverlay').classList.add('active');
}

function closeFFModal(){
  document.getElementById('ffModalOverlay').classList.remove('active');
  document.body.classList.remove('bm-open');
}

async function confirmFFPurchase(){
  const errorEl = document.getElementById('ffError');
  const plan = FF_PLANS[currentPlanId];
  if (!plan) return;

  const utr = document.getElementById('ffUtr').value.trim();
  if (!utr){
    errorEl.textContent = 'UTR number ya payment link dalein';
    document.getElementById('ffUtr').focus();
    return;
  }

  const user = auth.currentUser;
  if (!user){
    errorEl.textContent = 'Login karna zaroori hai, redirect ho raha hai...';
    setTimeout(function(){ window.location.href = 'login.html'; }, 1200);
    return;
  }

  errorEl.textContent = '';
  const confirmBtn = document.getElementById('ffConfirmBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Processing...';

  try{
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    const balance = snap.exists() && typeof snap.data().walletBalance === 'number' ? snap.data().walletBalance : 0;

    if (balance >= plan.price){
      await updateDoc(userRef, { walletBalance: balance - plan.price });

      await addDoc(collection(db, 'ffOrders'), {
        uid: user.uid,
        userEmail: user.email || '',
        planId: currentPlanId,
        planName: plan.name,
        days: plan.days,
        totalContent: plan.totalContent,
        price: plan.price,
        utr: utr,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      closeFFModal();
      showToast('✅ Plan request bheja gaya! Admin approve karega.');
    } else {
      document.getElementById('ffShort').textContent = formatINR(plan.price - balance);
      document.getElementById('ffInsufficient').classList.add('show');
    }
  } catch(err){
    errorEl.textContent = 'Kuch galat ho gaya, dobara try karein';
  }

  confirmBtn.disabled = false;
  confirmBtn.textContent = '✅ Confirm & Buy Now';
}

document.getElementById('ffModalOverlay').addEventListener('click', function(e){
  if (e.target === this) closeFFModal();
});

let ffToastTimer;
function showToast(msg){
  const t = document.getElementById('ffToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(ffToastTimer);
  ffToastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2600);
}

window.openFFModal = openFFModal;
window.closeFFModal = closeFFModal;
window.confirmFFPurchase = confirmFFPurchase;
