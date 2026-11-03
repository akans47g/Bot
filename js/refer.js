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

// 👉 Commission rates (page text + calculator me dikhte hain).
// ⚠️ ASLI credit admin ke top-up APPROVE logic me hota hai — wahan bhi
// yahi rates hone chahiye: pehle deposit par 21%, uske baad har deposit par 19%.
const FIRST_DEPOSIT_PCT = 21;
const REPEAT_DEPOSIT_PCT = 19;

// Advanced sections ke liye state (sab wahi data jo page pehle se load karta hai)
let allReferrals = [];
let allWithdrawals = [];
let referLink = '';

watchAuthState(function(user){
  if (!user){
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  init(user).catch(function(err){
    console.error('Refer page load fail hua:', err);
    document.getElementById('rfCode').textContent = 'ERR';
    document.getElementById('rfLinkText').textContent = '⚠️ Load nahi ho paya — Firestore Rules check karein';
  });
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
  referLink = link;
  renderShareTemplates();

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

  const docs = [];
  snap.forEach(function(d){ docs.push(d.data()); });
  docs.sort(function(a, b){ return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });

  allReferrals = docs;
  renderReferralStats();
  renderReferLevel();
  renderReferGoal();
  renderFollowUp();

  const list = document.getElementById('rfReferralList');
  if (snap.empty){
    list.innerHTML = '<p class="admin-empty">Abhi tak koi referral nahi hai</p>';
    return;
  }

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

  const docs = [];
  snap.forEach(function(d){ docs.push(d.data()); });
  docs.sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  allWithdrawals = docs;
  renderWithdrawSummary();

  if (snap.empty){
    list.innerHTML = '<p class="admin-empty">Koi withdrawal nahi hai</p>';
    return;
  }

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

/* ================================================================
   ADVANCED SECTIONS — sab kuch wahi data use karta hai jo page
   pehle se load kar raha hai (referrals + referWithdrawals).
   Koi naya Firestore query / rule nahi chahiye.
================================================================ */

/* ---------------- COMMISSION CALCULATOR ---------------- */
function fmtRs(n){
  return '₹' + (Math.round(n * 100) / 100);
}

document.getElementById('rfCalcAmount').addEventListener('input', function(){
  const out = document.getElementById('rfCalcResult');
  const amt = parseFloat(this.value);
  if (isNaN(amt) || amt <= 0){
    out.textContent = 'Amount daalo — kamai turant dikhegi';
    return;
  }
  const first = amt * FIRST_DEPOSIT_PCT / 100;
  const repeat = amt * REPEAT_DEPOSIT_PCT / 100;
  out.innerHTML =
    'Pehla deposit <b>' + fmtRs(amt) + '</b> → aapko <b>' + fmtRs(first) + '</b> (' + FIRST_DEPOSIT_PCT + '%)<br>' +
    'Uske baad har <b>' + fmtRs(amt) + '</b> deposit → aapko <b>' + fmtRs(repeat) + '</b> (' + REPEAT_DEPOSIT_PCT + '%)';
});

/* ---------------- REFERRAL STATS ---------------- */
function renderReferralStats(){
  const total = allReferrals.length;
  const deposited = allReferrals.filter(function(u){ return u.firstDepositDone; }).length;
  document.getElementById('rfDepositedCount').textContent = deposited;
  document.getElementById('rfConversion').textContent = total ? Math.round((deposited / total) * 100) + '%' : '0%';
}

/* ---------------- REFERRAL LEVEL (milestone badges only) ---------------- */
const REFER_LEVELS = [
  { name: 'Starter',  icon: '🌱', min: 0 },
  { name: 'Bronze',   icon: '🥉', min: 3 },
  { name: 'Silver',   icon: '🥈', min: 10 },
  { name: 'Gold',     icon: '🥇', min: 25 },
  { name: 'Platinum', icon: '💎', min: 50 }
];

function renderReferLevel(){
  const iconEl = document.getElementById('rfLevelIcon');
  if (!iconEl) return;
  const active = allReferrals.filter(function(u){ return u.firstDepositDone; }).length;

  let idx = 0;
  REFER_LEVELS.forEach(function(l, i){ if (active >= l.min) idx = i; });
  const cur = REFER_LEVELS[idx];
  const next = REFER_LEVELS[idx + 1];

  iconEl.textContent = cur.icon;
  document.getElementById('rfLevelName').textContent = cur.name + ' Referrer';

  const fill = document.getElementById('rfLevelFill');
  const nextEl = document.getElementById('rfLevelNext');
  if (next){
    const pct = Math.min(100, Math.round(((active - cur.min) / (next.min - cur.min)) * 100));
    fill.style.width = pct + '%';
    nextEl.textContent = next.icon + ' ' + next.name + ' tak ' + (next.min - active) + ' aur deposit karne wale referral (' + active + ' abhi)';
  } else {
    fill.style.width = '100%';
    nextEl.textContent = '🎉 Highest level achieve ho gaya!';
  }
}

/* ---------------- MONTHLY REFERRAL GOAL (localStorage) ---------------- */
function renderReferGoal(){
  const curEl = document.getElementById('rfGoalCurrent');
  if (!curEl) return;

  const goal = parseInt(localStorage.getItem('akans_refer_goal') || '5', 10);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const joined = allReferrals.filter(function(u){
    return u.createdAt && new Date(u.createdAt) >= monthStart;
  }).length;

  const pct = goal > 0 ? Math.min(100, Math.round((joined / goal) * 100)) : 0;
  curEl.textContent = joined;
  document.getElementById('rfGoalTarget').textContent = 'of ' + goal + ' naye referrals';
  document.getElementById('rfGoalFill').style.width = pct + '%';
  document.getElementById('rfGoalNote').textContent =
    (pct >= 100 ? '🎉 Goal achieve ho gaya! ' : pct + '% complete — ') +
    monthStart.toLocaleDateString('en-IN', { month: 'long' }) + ' ka target';
}

document.getElementById('rfGoalEditBtn').addEventListener('click', function(){
  const current = localStorage.getItem('akans_refer_goal') || '5';
  const input = prompt('Is mahine kitne naye referrals laane hain?', current);
  if (input === null) return;
  const num = parseInt(input, 10);
  if (isNaN(num) || num <= 0){ alert('Sahi number daalo'); return; }
  localStorage.setItem('akans_refer_goal', String(num));
  renderReferGoal();
});

/* ---------------- FOLLOW-UP (joined, no deposit yet) ---------------- */
function renderFollowUp(){
  const el = document.getElementById('rfFollowList');
  const copyBtn = document.getElementById('rfReminderCopyBtn');
  if (!el) return;

  const now = new Date();
  const pending = allReferrals
    .filter(function(u){
      if (u.firstDepositDone || !u.createdAt) return false;
      return (now - new Date(u.createdAt)) >= 2 * 86400000; // 2+ din ho gaye
    })
    .sort(function(a, b){ return new Date(a.createdAt) - new Date(b.createdAt); })
    .slice(0, 8);

  if (!pending.length){
    el.innerHTML = '<p class="admin-empty">' + (allReferrals.length ? 'Sab referrals active hain 🎉' : 'Abhi koi referral nahi hai') + '</p>';
    if (copyBtn) copyBtn.style.display = 'none';
    return;
  }

  el.innerHTML = '';
  pending.forEach(function(u){
    const days = Math.floor((now - new Date(u.createdAt)) / 86400000);
    const div = document.createElement('div');
    div.className = 'pp-ref-item';
    div.innerHTML =
      '<span>' + escapeHtml(u.name || u.email || 'User') + '</span>' +
      '<span class="rf-followup-days">' + days + ' din se deposit baaki</span>';
    el.appendChild(div);
  });

  if (copyBtn){
    copyBtn.style.display = 'inline-block';
    copyBtn.onclick = function(){
      copyText('Hi! AKANS Social Store pe account bana liya hai to ek baar chhota deposit karke try karo 🙂 Koi problem ho to mujhe batao.', copyBtn, '📋 Reminder Message Copy Karo');
    };
  }
}

/* ---------------- SHARE TEMPLATES ---------------- */
function renderShareTemplates(){
  const el = document.getElementById('rfTemplates');
  if (!el || !referLink) return;

  const templates = [
    '📈 Instagram Views, Likes, Followers sasti price me chahiye? AKANS Social Store try karo — mere refer code ' + myReferCode + ' ya link se join karo:\n' + referLink,
    '🎮 Free Fire Profile Likes chahiye? AKANS Store pe easy plans milte hain — mere link se join karo:\n' + referLink,
    '🎁 AKANS Social Store pe join karo aur apna pehla deposit karke services use karo. Refer code: ' + myReferCode + '\n' + referLink
  ];

  el.innerHTML = '';
  templates.forEach(function(text){
    const box = document.createElement('div');
    box.className = 'rf-template';
    box.innerHTML =
      '<p class="rf-template-text">' + escapeHtml(text) + '</p>' +
      '<div class="rf-template-btns"><button type="button" class="copy">📋 Copy</button><button type="button" class="wa">💬 WhatsApp</button></div>';
    const copyBtn = box.querySelector('.copy');
    copyBtn.addEventListener('click', function(){ copyText(text, copyBtn, '📋 Copy'); });
    box.querySelector('.wa').addEventListener('click', function(){
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    });
    el.appendChild(box);
  });
}

/* ---------------- WITHDRAW SUMMARY ---------------- */
function renderWithdrawSummary(){
  const el = document.getElementById('rfWithdrawSummary');
  if (!el) return;
  if (!allWithdrawals.length){ el.style.display = 'none'; return; }

  let done = 0, pending = 0, rejected = 0;
  allWithdrawals.forEach(function(w){
    const amt = w.amount || 0;
    if (w.status === 'completed') done += amt;
    else if (w.status === 'pending') pending += amt;
    else if (w.status === 'rejected') rejected += amt;
  });

  el.style.display = 'grid';
  el.innerHTML =
    '<div class="rf-wd-stat"><div class="rf-wd-val">₹' + done + '</div><div class="rf-wd-label">Mil Chuka</div></div>' +
    '<div class="rf-wd-stat"><div class="rf-wd-val">₹' + pending + '</div><div class="rf-wd-label">Pending</div></div>' +
    '<div class="rf-wd-stat"><div class="rf-wd-val">₹' + rejected + '</div><div class="rf-wd-label">Rejected</div></div>';
}

/* ---------------- COLLAPSIBLE CARDS (tap on card title) ---------------- */
(function setupCollapsibleCards(){
  const KEY = 'akans_refer_collapsed';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){}

  document.querySelectorAll('.pp-card').forEach(function(card){
    const h3 = card.querySelector('h3');
    if (!h3) return;
    const id = h3.textContent.trim();
    if (saved[id]) card.classList.add('collapsed');
    h3.addEventListener('click', function(){
      const nowCollapsed = card.classList.toggle('collapsed');
      saved[id] = nowCollapsed;
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch(e){}
    });
  });
})();
