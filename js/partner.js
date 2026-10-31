/* =================================================================
   PARTNER.JS — Partner Program page logic (Premium version)
   =================================================================
   Sirf woh users chala sakte hain jinka Firestore users/{uid}
   document me isPartner === true hai (admin ne set kiya hoga).

   ⚠️ Iske liye Firestore Rules me 2 changes zaroori hain:
   1. users/{userId} read rule me ye add karna:
        resource.data.referredBy == request.auth.uid ||
        resource.data.referredByUid == request.auth.uid
   2. Naya collection rule add karna:
        match /partnerCommissions/{id} {
          allow create: if isAdmin();
          allow read: if request.auth != null &&
            (request.auth.uid == resource.data.partnerUid || isAdmin());
        }
================================================================= */

import { db } from "./firebase-init.js";
import { watchAuthState, assignUniquePartnerCode } from "./auth.js";
import {
  doc, getDoc, onSnapshot, updateDoc, collection, addDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

/* Paise ki gadbad (jaise 7.07e-16) se bachne ke liye har balance ko
   2 decimal tak round karke hi dikhate/save karte hain. */
function round2(n){ return Math.round(n * 100) / 100; }
function fmtMoney(n){
  n = Number(n) || 0;
  if (Math.abs(n) < 0.005) return '₹0';
  return '₹' + round2(n);
}

let currentUser = null;
let currentRange = 'week';
let allCommissions = [];
let earningsChart = null;

// State used by the advanced sections (all filled from data the page already loads)
let allReferrals = [];
let allWithdrawals = [];
let lifetimeEarned = 0;
let partnerLink = '';

watchAuthState(function(user){
  if (!user){
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  checkPartnerAccess(user).catch(function(err){
    console.error('Partner page load fail hua:', err);
    document.getElementById('ppCode').textContent = 'ERR';
    document.getElementById('ppLinkText').textContent = '⚠️ Load nahi ho paya — Firestore Rules check karein';
  });
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
  setupRangeToggle();
  loadCommissionsAndChart(user.uid);
  loadReferrals(user.uid);
  loadWithdrawHistory(user.uid);
}

function setupCodeAndLink(code){
  document.getElementById('ppCode').textContent = code;

  const loginPath = window.location.pathname.replace(/p\.html$/, 'login.html');
  const link = window.location.origin + loginPath + '?pc=' + code;
  document.getElementById('ppLinkText').textContent = link;
  partnerLink = link;
  renderShareTemplates();

  document.getElementById('ppCodeCopyBtn').addEventListener('click', function(){
    copyText(code, this, 'Copy Code');
  });
  document.getElementById('ppCopyBtn').addEventListener('click', function(){
    copyText(link, this, 'Copy');
  });

  document.getElementById('ppShareBtn').addEventListener('click', function(){
    const text = '🤝 AKANS Social Store Partner Program me join karo mere link se!\n' + link;
    if (navigator.share){
      navigator.share({ text: text }).catch(function(){});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
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

/* ================================================================
   BALANCE — current (withdraw-able) aur lifetime (total kamaya hua)
   dono dikhate hain.
================================================================ */
function listenBalance(uid){
  onSnapshot(doc(db, 'users', uid), async function(snap){
    const data = snap.data() || {};
    const bal = typeof data.partnerBalance === 'number' ? data.partnerBalance : 0;
    document.getElementById('ppBalance').textContent = fmtMoney(bal);

    let lifetime = data.totalPartnerEarned;
    if (typeof lifetime !== 'number'){
      // Purane partners ke liye jinke liye ye field abhi tak nahi bana
      // — ek approximate estimate dikhate hain (save nahi karte).
      // Jaise hi agla commission aayega, asli field ban jaayega aur
      // ye estimate khud replace ho jaayega.
      try{
        const wdSnap = await getDocs(query(collection(db, 'partnerWithdrawals'), where('uid', '==', uid)));
        let withdrawnTotal = 0;
        wdSnap.forEach(function(d){ withdrawnTotal += (d.data().amount || 0); });
        lifetime = round2(bal + withdrawnTotal);
      } catch(e){
        lifetime = bal;
      }
    }
    document.getElementById('ppTotalEarned').textContent = fmtMoney(lifetime);
    lifetimeEarned = Number(lifetime) || 0;
    renderPartnerLevel();
  });
}

/* ================================================================
   EARNINGS CHART — Today / Week / Month / Year, aur is period vs
   pichle utne hi period ka growth trend badge.
================================================================ */
function setupRangeToggle(){
  document.querySelectorAll('.pp-range-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.pp-range-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      renderChart();
    });
  });
}

async function loadCommissionsAndChart(uid){
  try{
    const snap = await getDocs(query(collection(db, 'partnerCommissions'), where('partnerUid', '==', uid)));
    allCommissions = [];
    snap.forEach(function(d){ allCommissions.push(d.data()); });
  } catch(e){
    console.warn('Commissions load nahi ho payi (Firestore Rules check karein):', e);
    allCommissions = [];
  }
  renderChart();
  renderPartnerGoal();
  renderPartnerInsights();
}

function renderChart(){
  const b = getBuckets(currentRange);
  const values = new Array(b.count).fill(0);
  allCommissions.forEach(function(c){
    if (!c.createdAt) return;
    const d = new Date(c.createdAt);
    if (!b.match(d)) return;
    const idx = b.key(d);
    if (idx >= 0) values[idx] += (c.amount || 0);
  });
  const labels = [];
  for (let i = 0; i < b.count; i++) labels.push(b.label(i));

  const total = values.reduce(function(a, x){ return a + x; }, 0);
  document.getElementById('ppEarningsTotal').textContent = fmtMoney(total);

  const prevBounds = getPreviousPeriodBounds(currentRange);
  let prevTotal = 0;
  allCommissions.forEach(function(c){
    if (!c.createdAt) return;
    const d = new Date(c.createdAt);
    if (d >= prevBounds.start && d <= prevBounds.end) prevTotal += (c.amount || 0);
  });
  document.getElementById('ppGrowthBadge').innerHTML = changeBadge(total, prevTotal);

  drawChart(labels, values);
}

function drawChart(labels, values){
  const ctx = document.getElementById('ppEarningsChart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (earningsChart) earningsChart.destroy();
  earningsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        borderColor: '#4F2FCE',
        backgroundColor: '#4F2FCE22',
        fill: true,
        tension: 0.35,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 7, font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 } } }
      }
    }
  });
}

function getBuckets(range){
  const now = new Date();
  if (range === 'today'){
    return {
      count: 24,
      label: function(i){ return i + ':00'; },
      key: function(date){ return date.getHours(); },
      match: function(date){ return date.toDateString() === now.toDateString(); }
    };
  }
  if (range === 'week'){
    const days = [];
    for (let i = 6; i >= 0; i--){ const d = new Date(now); d.setDate(d.getDate() - i); days.push(d); }
    return {
      count: 7,
      label: function(i){ return days[i].toLocaleDateString('en-IN', { weekday: 'short' }); },
      key: function(date){ return days.findIndex(function(d){ return d.toDateString() === date.toDateString(); }); },
      match: function(date){ return days.some(function(d){ return d.toDateString() === date.toDateString(); }); }
    };
  }
  if (range === 'month'){
    const days = [];
    for (let i = 29; i >= 0; i--){ const d = new Date(now); d.setDate(d.getDate() - i); days.push(d); }
    return {
      count: 30,
      label: function(i){ return days[i].getDate() + '/' + (days[i].getMonth() + 1); },
      key: function(date){ return days.findIndex(function(d){ return d.toDateString() === date.toDateString(); }); },
      match: function(date){ return days.some(function(d){ return d.toDateString() === date.toDateString(); }); }
    };
  }
  const months = [];
  for (let i = 11; i >= 0; i--){ months.push(new Date(now.getFullYear(), now.getMonth() - i, 1)); }
  return {
    count: 12,
    label: function(i){ return months[i].toLocaleDateString('en-IN', { month: 'short' }); },
    key: function(date){ return months.findIndex(function(m){ return m.getFullYear() === date.getFullYear() && m.getMonth() === date.getMonth(); }); },
    match: function(date){ return months.some(function(m){ return m.getFullYear() === date.getFullYear() && m.getMonth() === date.getMonth(); }); }
  };
}

function getPreviousPeriodBounds(range){
  const now = new Date();
  if (range === 'today'){
    const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    return { start: start, end: end };
  }
  if (range === 'week'){
    const end = new Date(now); end.setDate(end.getDate() - 7); end.setHours(23, 59, 59, 999);
    const start = new Date(now); start.setDate(start.getDate() - 13); start.setHours(0, 0, 0, 0);
    return { start: start, end: end };
  }
  if (range === 'month'){
    const end = new Date(now); end.setDate(end.getDate() - 30); end.setHours(23, 59, 59, 999);
    const start = new Date(now); start.setDate(start.getDate() - 59); start.setHours(0, 0, 0, 0);
    return { start: start, end: end };
  }
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { start: start, end: end };
}

function changeBadge(current, previous){
  if (previous === 0){
    if (current === 0) return '';
    return '<span class="pp-change-badge up">🆕 Naya</span>';
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return '<span class="pp-change-badge flat">→ 0%</span>';
  const cls = pct > 0 ? 'up' : 'down';
  const arrow = pct > 0 ? '▲' : '▼';
  const sign = pct > 0 ? '+' : '';
  return '<span class="pp-change-badge ' + cls + '">' + arrow + ' ' + sign + pct + '% vs pichla period</span>';
}

/* ================================================================
   REFERRED USERS — kaun join hua, aur us ne ab tak kitna fund
   (top-up) kiya hai.
================================================================ */
async function loadReferrals(uid){
  let docs = [];
  try{
    const snap = await getDocs(query(collection(db, 'users'), where('referredBy', '==', uid)));
    snap.forEach(function(d){ docs.push(d.data()); });
  } catch(e){
    console.warn('Referrals load nahi ho paye (Firestore Rules check karein):', e);
  }

  document.getElementById('ppReferralCount').textContent = docs.length;

  const totalFunded = docs.reduce(function(sum, u){ return sum + (typeof u.totalDeposited === 'number' ? u.totalDeposited : 0); }, 0);
  document.getElementById('ppTeamFunded').textContent = '₹' + totalFunded.toFixed(0);

  allReferrals = docs;
  renderTopPerformers();
  renderFollowUp();
  renderPartnerInsights();

  const list = document.getElementById('ppReferralList');
  if (!docs.length){
    list.innerHTML = '<p class="admin-empty">Abhi tak koi referral nahi hai — apna link share karke shuru karein!</p>';
    return;
  }

  docs.sort(function(a, b){ return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });

  list.innerHTML = '';
  docs.forEach(function(u){
    const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    const funded = typeof u.totalDeposited === 'number' ? u.totalDeposited : 0;
    const div = document.createElement('div');
    div.className = 'pp-ref-item';
    div.innerHTML =
      '<div class="pp-ref-avatar">' + escapeHtml((u.name || u.email || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div class="pp-ref-mid">' +
        '<span class="pp-ref-name">' + escapeHtml(u.name || u.email || 'User') + '</span>' +
        '<span class="pp-ref-date">Joined ' + joined + '</span>' +
      '</div>' +
      '<span class="pp-ref-funded">₹' + funded.toFixed(0) + '</span>';
    list.appendChild(div);
  });
}

/* ================================================================
   UPI WITHDRAW CHARGES
   Partner ko top-up ka 49% milta hai. UPI me nikalte waqt us 49% me se
   4 charges (har ek top-up ka 1%) kat-te hain:
     Website Fee 1% + Payment Charges 1% + Web Service Charge 1%
     + Other Charges 1%  = 4%
   Yaani ₹49 commission me se ₹45 milta hai. Ye fee balance ke hisaab se
   1/49 ke unit me nikalti hai (₹100 top-up -> ₹49 -> ₹4 charges -> ₹45).
   Wallet me convert karne par KOI charge nahi lagta.
================================================================ */
function calcWithdrawFees(amount){
  // Har charge ko upar ki taraf paise tak round karte hain, taaki
  // partner ko kabhi bhi formula se zyada na mile.
  const unit = Math.ceil((amount / 49) * 100 - 1e-9) / 100;
  const totalFee = round2(unit * 4);
  return {
    website: unit,
    payment: unit,
    service: unit,
    other: unit,
    totalFee: totalFee,
    net: round2(amount - totalFee)
  };
}

function renderFeePreview(){
  const box = document.getElementById('ppFeePreview');
  const amount = parseFloat(document.getElementById('ppWithdrawAmount').value);
  if (isNaN(amount) || amount <= 0){
    box.style.display = 'none';
    return;
  }
  const f = calcWithdrawFees(amount);
  box.style.display = 'block';
  box.innerHTML =
    '<div class="pp-fee-row"><span>Withdraw Amount</span><span>₹' + amount.toFixed(2) + '</span></div>' +
    '<div class="pp-fee-row minus"><span>Website Fee (1%)</span><span>− ₹' + f.website.toFixed(2) + '</span></div>' +
    '<div class="pp-fee-row minus"><span>Payment Charges (1%)</span><span>− ₹' + f.payment.toFixed(2) + '</span></div>' +
    '<div class="pp-fee-row minus"><span>Web Service Charge (1%)</span><span>− ₹' + f.service.toFixed(2) + '</span></div>' +
    '<div class="pp-fee-row minus"><span>Other Charges (1%)</span><span>− ₹' + f.other.toFixed(2) + '</span></div>' +
    '<div class="pp-fee-row total"><span>UPI me aapko milega</span><span>₹' + f.net.toFixed(2) + '</span></div>';
}

document.getElementById('ppWithdrawAmount').addEventListener('input', renderFeePreview);

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
  const partnerBal = typeof data.partnerBalance === 'number' ? round2(data.partnerBalance) : 0;
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
      partnerBalance: Math.max(0, round2(partnerBal - amount)),
      walletBalance: round2(walletBal + amount)
    });
    amtEl.value = '';
    errEl.style.color = 'var(--success)';
    errEl.textContent = '✅ ₹' + amount + ' wallet me convert ho gaya — koi charge nahi laga!';
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
  const partnerBal = typeof (snap.data() || {}).partnerBalance === 'number' ? round2(snap.data().partnerBalance) : 0;

  if (amount > partnerBal){
    errEl.textContent = 'Itna Partner Balance nahi hai';
    return;
  }

  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Submit ho raha hai...';

  try{
    // amount = partnerBalance se kat-ne wala poora amount. Charges kat-ne ke
    // baad jo bachta hai (netAmount) wahi UPI me bheja jayega.
    const fees = calcWithdrawFees(amount);
    await updateDoc(ref, { partnerBalance: Math.max(0, round2(partnerBal - amount)) });
    await addDoc(collection(db, 'partnerWithdrawals'), {
      uid: currentUser.uid,
      userEmail: currentUser.email || '',
      upiId: upiId,
      amount: amount,
      fee: fees.totalFee,
      netAmount: fees.net,
      feeBreakdown: { website: fees.website, payment: fees.payment, service: fees.service, other: fees.other },
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    document.getElementById('ppUpiId').value = '';
    document.getElementById('ppWithdrawAmount').value = '';
    renderFeePreview();
    errEl.style.color = 'var(--success)';
    errEl.textContent = '✅ Request bhej di gayi! Charges kat-ne ke baad ₹' + fees.net.toFixed(2) + ' aapke UPI me aayega.';
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
      '<span>' + (typeof w.netAmount === 'number' ? '₹' + w.amount + ' → <strong>₹' + w.netAmount.toFixed(2) + '</strong> milega' : '₹' + w.amount) + ' • ' + escapeHtml(w.upiId) + ' • ' + date + '</span>' +
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
   ADVANCED SECTIONS — sab kuch wahi data use karta hai jo page pehle
   se load kar raha hai (commissions, referrals, withdrawals,
   lifetime earned). Koi naya Firestore query / rule nahi chahiye.
================================================================ */

/* ---------------- PARTNER LEVEL (milestone badges only) ---------------- */
const PARTNER_LEVELS = [
  { name: 'Starter',  icon: '🌱', min: 0 },
  { name: 'Bronze',   icon: '🥉', min: 500 },
  { name: 'Silver',   icon: '🥈', min: 2000 },
  { name: 'Gold',     icon: '🥇', min: 5000 },
  { name: 'Platinum', icon: '💎', min: 10000 }
];

function renderPartnerLevel(){
  const iconEl = document.getElementById('ppLevelIcon');
  if (!iconEl) return;

  let idx = 0;
  PARTNER_LEVELS.forEach(function(l, i){ if (lifetimeEarned >= l.min) idx = i; });
  const cur = PARTNER_LEVELS[idx];
  const next = PARTNER_LEVELS[idx + 1];

  iconEl.textContent = cur.icon;
  document.getElementById('ppLevelName').textContent = cur.name + ' Partner';

  const fill = document.getElementById('ppLevelFill');
  const nextEl = document.getElementById('ppLevelNext');
  if (next){
    const pct = Math.min(100, Math.round(((lifetimeEarned - cur.min) / (next.min - cur.min)) * 100));
    fill.style.width = pct + '%';
    nextEl.textContent = next.icon + ' ' + next.name + ' tak ' + fmtMoney(next.min - lifetimeEarned) + ' aur (' + pct + '% complete)';
  } else {
    fill.style.width = '100%';
    nextEl.textContent = '🎉 Highest level achieve ho gaya!';
  }
}

/* ---------------- MONTHLY EARNING GOAL (localStorage) ---------------- */
function renderPartnerGoal(){
  const curEl = document.getElementById('ppGoalCurrent');
  if (!curEl) return;

  const goal = parseFloat(localStorage.getItem('akans_partner_goal') || '1000');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const earned = allCommissions.reduce(function(s, c){
    if (!c.createdAt) return s;
    return new Date(c.createdAt) >= monthStart ? s + (c.amount || 0) : s;
  }, 0);

  const pct = goal > 0 ? Math.min(100, Math.round((earned / goal) * 100)) : 0;
  curEl.textContent = fmtMoney(earned);
  document.getElementById('ppGoalTarget').textContent = 'of ₹' + goal + ' goal';
  document.getElementById('ppGoalFill').style.width = pct + '%';
  document.getElementById('ppGoalNote').textContent =
    (pct >= 100 ? '🎉 Goal achieve ho gaya! ' : pct + '% complete — ') +
    monthStart.toLocaleDateString('en-IN', { month: 'long' }) + ' ka target';
}

document.getElementById('ppGoalEditBtn').addEventListener('click', function(){
  const current = localStorage.getItem('akans_partner_goal') || '1000';
  const input = prompt('Is mahine ka earning goal set karo (₹):', current);
  if (input === null) return;
  const num = parseFloat(input);
  if (isNaN(num) || num <= 0){ alert('Sahi number daalo'); return; }
  localStorage.setItem('akans_partner_goal', String(num));
  renderPartnerGoal();
});

/* ---------------- SMART INSIGHTS ---------------- */
function renderPartnerInsights(){
  const convEl = document.getElementById('ppInsConversion');
  if (!convEl) return;

  // Referral-based tiles
  const total = allReferrals.length;
  const active = allReferrals.filter(function(u){ return typeof u.totalDeposited === 'number' && u.totalDeposited > 0; });
  const funded = active.reduce(function(s, u){ return s + u.totalDeposited; }, 0);
  convEl.textContent = total ? (active.length + '/' + total + ' (' + Math.round((active.length / total) * 100) + '%)') : '—';
  document.getElementById('ppInsAvg').textContent = active.length ? '₹' + Math.round(funded / active.length) : '—';

  // Month-end estimate from this month's pace
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const earnedThisMonth = allCommissions.reduce(function(s, c){
    if (!c.createdAt) return s;
    return new Date(c.createdAt) >= monthStart ? s + (c.amount || 0) : s;
  }, 0);
  const projEl = document.getElementById('ppInsProjected');
  projEl.textContent = earnedThisMonth > 0 ? fmtMoney((earnedThisMonth / now.getDate()) * daysInMonth) : '—';

  // Best earning weekday (all-time)
  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  allCommissions.forEach(function(c){
    if (!c.createdAt) return;
    dayTotals[new Date(c.createdAt).getDay()] += (c.amount || 0);
  });
  const bestVal = Math.max.apply(null, dayTotals);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  document.getElementById('ppInsBestDay').textContent = bestVal > 0 ? dayNames[dayTotals.indexOf(bestVal)] : '—';
}

/* ---------------- TOP PERFORMERS ---------------- */
function renderTopPerformers(){
  const el = document.getElementById('ppTopList');
  if (!el) return;

  const top = allReferrals
    .filter(function(u){ return typeof u.totalDeposited === 'number' && u.totalDeposited > 0; })
    .sort(function(a, b){ return b.totalDeposited - a.totalDeposited; })
    .slice(0, 5);

  if (!top.length){
    el.innerHTML = '<p class="admin-empty">Abhi kisi referral ne fund nahi kiya</p>';
    return;
  }

  el.innerHTML = '';
  top.forEach(function(u, i){
    const div = document.createElement('div');
    div.className = 'pp-ref-item';
    div.innerHTML =
      '<div class="pp-rank-badge">' + (i + 1) + '</div>' +
      '<div class="pp-ref-mid">' +
        '<span class="pp-ref-name">' + escapeHtml(u.name || u.email || 'User') + '</span>' +
        '<span class="pp-ref-date">Total fund ₹' + u.totalDeposited.toFixed(0) + '</span>' +
      '</div>' +
      '<div><span class="pp-ref-funded">≈ ₹' + Math.round(u.totalDeposited * 0.49) + '</span>' +
      '<span class="pp-ref-share">aapka hissa</span></div>';
    el.appendChild(div);
  });
}

/* ---------------- FOLLOW-UP (joined, never funded) ---------------- */
function renderFollowUp(){
  const el = document.getElementById('ppFollowList');
  const copyBtn = document.getElementById('ppReminderCopyBtn');
  if (!el) return;

  const now = new Date();
  const pending = allReferrals
    .filter(function(u){
      const funded = typeof u.totalDeposited === 'number' ? u.totalDeposited : 0;
      if (funded > 0 || !u.createdAt) return false;
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
      '<div class="pp-ref-avatar">' + escapeHtml((u.name || u.email || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div class="pp-ref-mid">' +
        '<span class="pp-ref-name">' + escapeHtml(u.name || u.email || 'User') + '</span>' +
        '<span class="pp-ref-date">Abhi tak fund nahi kiya</span>' +
      '</div>' +
      '<span class="pp-followup-days">' + days + 'd</span>';
    el.appendChild(div);
  });

  if (copyBtn){
    copyBtn.style.display = 'inline-block';
    copyBtn.onclick = function(){
      copyText('Hi! AKANS Social Store pe account bana liya hai to ek baar try karo — chhote amount se start kar sakte ho. Koi problem ho to mujhe batao 🙂', copyBtn, '📋 Reminder Message Copy Karo');
    };
  }
}

/* ---------------- SHARE TEMPLATES ---------------- */
function renderShareTemplates(){
  const el = document.getElementById('ppTemplates');
  if (!el || !partnerLink) return;

  const templates = [
    '📈 Instagram Views, Likes, Followers sabse kam price me chahiye? AKANS Social Store try karo — fast delivery, 100% safe service.\n' + partnerLink,
    '🎮 Free Fire Profile Likes chahiye? AKANS Store pe easy plans milte hain — mere link se join karo:\n' + partnerLink,
    '🤝 Online earning karna chahte ho? AKANS Partner Program join karo aur har top-up par commission kamao:\n' + partnerLink
  ];

  el.innerHTML = '';
  templates.forEach(function(text){
    const box = document.createElement('div');
    box.className = 'pp-template';
    box.innerHTML =
      '<p class="pp-template-text">' + escapeHtml(text) + '</p>' +
      '<div class="pp-template-btns"><button type="button" class="copy">📋 Copy</button><button type="button" class="wa">💬 WhatsApp</button></div>';
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
  const el = document.getElementById('ppWithdrawSummary');
  if (!el) return;
  if (!allWithdrawals.length){ el.style.display = 'none'; return; }

  let received = 0, pending = 0, fees = 0;
  allWithdrawals.forEach(function(w){
    if (w.status === 'completed'){
      received += (typeof w.netAmount === 'number' ? w.netAmount : (w.amount || 0));
      fees += (w.fee || 0);
    } else if (w.status === 'pending'){
      pending += (w.amount || 0);
    }
  });

  el.style.display = 'grid';
  el.innerHTML =
    '<div class="pp-wd-stat"><div class="pp-wd-val">' + fmtMoney(received) + '</div><div class="pp-wd-label">Mil Chuka</div></div>' +
    '<div class="pp-wd-stat"><div class="pp-wd-val">' + fmtMoney(pending) + '</div><div class="pp-wd-label">Pending</div></div>' +
    '<div class="pp-wd-stat"><div class="pp-wd-val">' + fmtMoney(fees) + '</div><div class="pp-wd-label">Charges Gaye</div></div>';
}

/* ---------------- COLLAPSIBLE CARDS (tap on card title) ---------------- */
(function setupCollapsibleCards(){
  const KEY = 'akans_partner_collapsed';
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
