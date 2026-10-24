/* =================================================================
   DASHBOARD.JS — Summary stats + recent activity
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin } from "./admin-guard.js";
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

requireAdmin(function(){
  loadStats();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async function(){
  await logout();
  window.location.href = '../admin.html';
});

async function loadStats(){
  try{
    const [topupsSnap, ordersSnap, usersSnap, withdrawalsSnap] = await Promise.all([
      getDocs(collection(db, 'topups')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'withdrawals')).catch(function(){ return { forEach: function(){}, size: 0 }; })
    ]);

    let pendingTopups = 0, pendingOrders = 0, pendingWithdrawals = 0, todayRevenue = 0;
    const todayStr = new Date().toDateString();
    const activity = [];
    const topupsData = [];
    const ordersData = [];

    topupsSnap.forEach(function(d){
      const data = d.data();
      topupsData.push(data);
      if (data.status === 'pending') pendingTopups++;
      if (data.status === 'approved' && data.approvedAt && new Date(data.approvedAt).toDateString() === todayStr){
        todayRevenue += data.amount;
      }
      activity.push({ type: 'topup', amount: data.amount, status: data.status, date: data.createdAt, email: data.userEmail });
    });

    ordersSnap.forEach(function(d){
      const data = d.data();
      ordersData.push(data);
      if (data.status === 'pending') pendingOrders++;
      activity.push({ type: 'order', amount: data.price, status: data.status, date: data.createdAt, email: data.userEmail, product: data.productName });
    });

    if (withdrawalsSnap && withdrawalsSnap.forEach) {
      withdrawalsSnap.forEach(function(d){
        if (d.data().status === 'pending') pendingWithdrawals++;
      });
    }

    document.getElementById('statPendingTopups').textContent = pendingTopups;
    document.getElementById('statPendingOrders').textContent = pendingOrders;
    document.getElementById('statTotalUsers').textContent = usersSnap.size;
    document.getElementById('statTodayRevenue').textContent = '₹' + todayRevenue;
    const pw = document.getElementById('statPendingWithdrawals');
    if (pw) pw.textContent = pendingWithdrawals;

    activity.sort(function(a, b){ return new Date(b.date) - new Date(a.date); });
    renderActivity(activity.slice(0, 8));

    // ---- Advanced dashboard: revenue history, insights, forecast ----
    computeAndRenderAnalytics(topupsData, ordersData);
  } catch(err){
    console.error(err);
    document.getElementById('recentActivity').innerHTML = '<p class="admin-empty">Data load nahi ho paya</p>';
  }
}

function computeAndRenderAnalytics(topupsData, ordersData){
  // 1) Revenue history — last 90 days, from approved topups (same "revenue" definition
  //    as statTodayRevenue above: wallet top-ups, since orders are paid from wallet balance)
  const days = {};
  const now = new Date();
  for (let i = 89; i >= 0; i--){
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = 0;
  }
  topupsData.forEach(function(data){
    if (data.status === 'approved' && data.approvedAt){
      const key = new Date(data.approvedAt).toISOString().slice(0, 10);
      if (Object.prototype.hasOwnProperty.call(days, key)) days[key] += (data.amount || 0);
    }
  });
  const revenueHistory = Object.keys(days).map(function(date){ return { date: date, amount: days[date] }; });
  window.AKANS_REVENUE_HISTORY = revenueHistory;

  // 2) Insights
  const approvedTopups = topupsData.filter(function(t){ return t.status === 'approved'; });
  const totalRevenue = approvedTopups.reduce(function(sum, t){ return sum + (t.amount || 0); }, 0);

  const validOrders = ordersData.filter(function(o){ return typeof o.price === 'number'; });
  const aov = validOrders.length ? Math.round(validOrders.reduce(function(s, o){ return s + o.price; }, 0) / validOrders.length) : 0;

  const decidedOrders = ordersData.filter(function(o){ return o.status === 'approved' || o.status === 'rejected'; });
  const approvedOrders = decidedOrders.filter(function(o){ return o.status === 'approved'; });
  const approvalRate = decidedOrders.length ? Math.round((approvedOrders.length / decidedOrders.length) * 100) : 0;

  const emailCounts = {};
  ordersData.forEach(function(o){
    if (!o.userEmail) return;
    emailCounts[o.userEmail] = (emailCounts[o.userEmail] || 0) + 1;
  });
  const repeatBuyers = Object.values(emailCounts).filter(function(c){ return c > 1; }).length;

  window.AKANS_INSIGHTS = {
    totalRevenue: '₹' + totalRevenue,
    aov: '₹' + aov,
    approvalRate: approvalRate + '%',
    repeatBuyers: repeatBuyers
  };

  // 3) Forecast — average daily revenue over the last 30 days, projected across this month
  const last30 = revenueHistory.slice(-30);
  const avgDaily = last30.length ? last30.reduce(function(s, d){ return s + d.amount; }, 0) / last30.length : 0;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const estimated = Math.round(avgDaily * daysInMonth);
  window.AKANS_FORECAST = {
    amount: '₹' + estimated,
    note: 'Pichle 30 din ke average daily revenue ke adhar par estimate'
  };

  if (typeof window.renderAkansAnalytics === 'function') window.renderAkansAnalytics();
}

function renderActivity(items){
  const el = document.getElementById('recentActivity');
  if (!items.length){
    el.innerHTML = '<p class="admin-empty">Koi activity nahi hai</p>';
    return;
  }
  el.innerHTML = '';
  items.forEach(function(item){
    const date = item.date ? new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    const label = item.type === 'topup' ? '💰 Top-up' : ('📦 ' + escapeHtml(item.product || 'Order'));
    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML =
      '<div class="admin-item-top">' +
        '<div><div class="admin-item-title">' + label + '</div><div class="admin-item-sub">' + escapeHtml(item.email || '') + ' • ' + date + '</div></div>' +
        '<div class="admin-item-amount">₹' + item.amount + '</div>' +
      '</div>' +
      '<span class="admin-status ' + item.status + '">' + item.status + '</span>';
    el.appendChild(div);
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ---------- INSTALL ADMIN APP BUTTON ---------- */
function isStandaloneMode(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOSDevice(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

(function setupInstallButton(){
  const btn = document.getElementById('adminInstallBtn');
  if (!btn || isStandaloneMode()) return;

  btn.style.display = 'block';

  btn.addEventListener('click', async function(){
    if (window.deferredInstallPrompt){
      window.deferredInstallPrompt.prompt();
      await window.deferredInstallPrompt.userChoice;
      window.deferredInstallPrompt = null;
    } else if (isIOSDevice()){
      alert('📲 iPhone par install karne ke liye:\n\nNeeche Share button (⬆️) dabayein, phir "Add to Home Screen" choose karein.');
    } else {
      alert('📲 Apne browser ke menu (⋮ ya ...) me jaakar "Install App" ya "Add to Home Screen" option dhoondein.');
    }
  });
})();
