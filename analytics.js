/* =================================================================
   ANALYTICS.JS — Revenue/Orders/Growth charts, product ranking,
   login activity. Ek hi "range" toggle (Today/Week/Month/Year)
   revenue, orders, aur user-growth teeno charts ko control karta
   hai, taaki sab ek hi time-period ka data dikhayein.
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin } from "./admin-guard.js";
import {
  collection, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let allTopups = [], allOrders = [], allUsers = [];
let currentRange = 'week';
const chartInstances = {};

requireAdmin(function(){
  loadAllData();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async function(){
  await logout();
  window.location.href = '../admin.html';
});

document.getElementById('rangeToggle').addEventListener('click', function(e){
  const btn = e.target.closest('.range-btn');
  if (!btn) return;
  document.querySelectorAll('.range-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  currentRange = btn.dataset.range;
  renderAll();
});

async function loadAllData(){
  const [topupsSnap, ordersSnap, usersSnap, logsSnap] = await Promise.all([
    getDocs(collection(db, 'topups')),
    getDocs(collection(db, 'orders')),
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'), limit(30)))
  ]);
  allTopups = []; topupsSnap.forEach(function(d){ allTopups.push(d.data()); });
  allOrders = []; ordersSnap.forEach(function(d){ allOrders.push(Object.assign({ id: d.id }, d.data())); });
  allUsers = []; usersSnap.forEach(function(d){ allUsers.push(Object.assign({ id: d.id }, d.data())); });

  renderAll();
  renderLoginActivity();
  renderActivityLog(logsSnap);
}

function renderActivityLog(snap){
  const el = document.getElementById('activityLog');
  if (snap.empty){
    el.innerHTML = '<p class="admin-empty">Abhi tak koi admin activity nahi hai</p>';
    return;
  }
  el.innerHTML = '';
  snap.forEach(function(d){
    const log = d.data();
    const time = log.timestamp ? new Date(log.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML =
      '<div class="log-summary">' + escapeHtml(log.summary || log.action || '') + '</div>' +
      '<div class="log-time">' + time + '</div>';
    el.appendChild(div);
  });
}

/* ---------- Time-bucket helper: har range ke liye labels + match/key logic ---------- */
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
  // year
  const months = [];
  for (let i = 11; i >= 0; i--){ months.push(new Date(now.getFullYear(), now.getMonth() - i, 1)); }
  return {
    count: 12,
    label: function(i){ return months[i].toLocaleDateString('en-IN', { month: 'short' }); },
    key: function(date){ return months.findIndex(function(m){ return m.getFullYear() === date.getFullYear() && m.getMonth() === date.getMonth(); }); },
    match: function(date){ return months.some(function(m){ return m.getFullYear() === date.getFullYear() && m.getMonth() === date.getMonth(); }); }
  };
}

function bucketSum(records, dateField, valueField, range){
  const b = getBuckets(range);
  const values = new Array(b.count).fill(0);
  records.forEach(function(r){
    if (!r[dateField]) return;
    const d = new Date(r[dateField]);
    if (!b.match(d)) return;
    const idx = b.key(d);
    if (idx >= 0) values[idx] += (valueField ? (r[valueField] || 0) : 1);
  });
  const labels = [];
  for (let i = 0; i < b.count; i++) labels.push(b.label(i));
  return { labels: labels, values: values };
}

function renderAll(){
  const approvedTopups = allTopups.filter(function(t){ return t.status === 'approved'; });
  const rev = bucketSum(approvedTopups, 'approvedAt', 'amount', currentRange);
  drawLineChart('revenueChart', rev.labels, rev.values, 'Revenue', '#4F2FCE');
  document.getElementById('revenueTotal').innerHTML = 'Total: <strong>₹' + rev.values.reduce(function(a, b){ return a + b; }, 0) + '</strong>';

  const validOrders = allOrders.filter(function(o){ return o.status !== 'rejected'; });
  const ord = bucketSum(validOrders, 'createdAt', null, currentRange);
  drawLineChart('ordersChart', ord.labels, ord.values, 'Orders', '#FF6B3D');
  document.getElementById('ordersTotal').innerHTML = 'Total: <strong>' + ord.values.reduce(function(a, b){ return a + b; }, 0) + ' orders</strong>';

  const grw = bucketSum(allUsers, 'createdAt', null, currentRange);
  drawLineChart('growthChart', grw.labels, grw.values, 'New Users', '#16C784');
  document.getElementById('growthTotal').innerHTML = 'New signups: <strong>' + grw.values.reduce(function(a, b){ return a + b; }, 0) + '</strong>';

  renderProductRanking();
}

function drawLineChart(canvasId, labels, values, label, color){
  const ctx = document.getElementById(canvasId);
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: values,
        borderColor: color,
        backgroundColor: color + '22',
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
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderProductRanking(){
  const b = getBuckets(currentRange);
  const counts = {};
  allOrders.forEach(function(o){
    if (o.status === 'rejected') return;
    if (!o.createdAt) return;
    const d = new Date(o.createdAt);
    if (!b.match(d)) return;
    counts[o.productName] = (counts[o.productName] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort(function(a, b){ return b[1] - a[1]; });
  const el = document.getElementById('productRanking');

  if (!sorted.length){
    el.innerHTML = '<p class="admin-empty">Is period me koi order nahi hai</p>';
    return;
  }

  const max = sorted[0][1];
  el.innerHTML = '';
  sorted.forEach(function(entry, i){
    const name = entry[0], count = entry[1];
    const pct = Math.round((count / max) * 100);
    const div = document.createElement('div');
    div.className = 'rank-item';
    div.innerHTML =
      '<div class="rank-num">' + (i + 1) + '</div>' +
      '<div class="rank-bar-wrap">' +
        '<div class="rank-name">' + escapeHtml(name) + '</div>' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="rank-count">' + count + '</div>';
    el.appendChild(div);
  });
}

function renderLoginActivity(){
  const el = document.getElementById('loginActivity');
  const sorted = allUsers.slice().sort(function(a, b){
    const at = a.lastLogin ? new Date(a.lastLogin) : new Date(0);
    const bt = b.lastLogin ? new Date(b.lastLogin) : new Date(0);
    return bt - at;
  });

  if (!sorted.length){
    el.innerHTML = '<p class="admin-empty">Koi user nahi hai</p>';
    return;
  }

  el.innerHTML = '';
  sorted.forEach(function(u){
    const lastLoginTxt = u.lastLogin
      ? new Date(u.lastLogin).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Track nahi hua';
    const joinedTxt = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    const div = document.createElement('div');
    div.className = 'user-row';
    div.innerHTML =
      '<div class="user-row-left">' +
        '<div class="user-row-name">' + escapeHtml(u.name || u.email || 'User') + '</div>' +
        '<div class="user-row-email">' + escapeHtml(u.email || '') + '</div>' +
      '</div>' +
      '<div class="user-row-right">' +
        '<div class="user-row-time">' + lastLoginTxt + '</div>' +
        '<div class="user-row-joined">Joined: ' + joinedTxt + '</div>' +
      '</div>';
    el.appendChild(div);
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
