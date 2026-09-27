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
  const [topupsSnap, ordersSnap, ffOrdersSnap, usersSnap, logsSnap] = await Promise.all([
    getDocs(collection(db, 'topups')),
    getDocs(collection(db, 'orders')),
    getDocs(collection(db, 'ffOrders')),
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'), limit(30)))
  ]);
  allTopups = []; topupsSnap.forEach(function(d){ allTopups.push(d.data()); });

  allOrders = [];
  ordersSnap.forEach(function(d){ allOrders.push(Object.assign({ id: d.id }, d.data())); });
  // Free Fire plan orders 'ffOrders' collection me alag se hain —
  // unhe 'orders' jaisa hi shape (productName, price, status,
  // createdAt) deke isi list me jod dete hain, taaki Orders chart aur
  // Product Performance ranking dono inhe automatically count karein.
  ffOrdersSnap.forEach(function(d){
    const data = d.data();
    allOrders.push({
      id: d.id,
      uid: data.uid,
      userEmail: data.userEmail,
      productName: data.planName,
      qty: data.totalContent,
      price: data.price,
      status: data.status,
      createdAt: data.createdAt
    });
  });

  allUsers = []; usersSnap.forEach(function(d){ allUsers.push(Object.assign({ id: d.id }, d.data())); });

  renderAll();
  renderLoginActivity();
  renderActivityLog(logsSnap);
  renderTopPartners();
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

/* ================================================================
   PREVIOUS-PERIOD COMPARISON — "is week vs last week" jaisa % change
================================================================ */
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
  // year
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { start: start, end: end };
}

function sumInBounds(records, dateField, valueField, bounds){
  let sum = 0;
  records.forEach(function(r){
    if (!r[dateField]) return;
    const d = new Date(r[dateField]);
    if (d >= bounds.start && d <= bounds.end) sum += (valueField ? (r[valueField] || 0) : 1);
  });
  return sum;
}

function changeBadge(current, previous){
  if (previous === 0){
    if (current === 0) return '';
    return ' <span class="change-badge up">🆕 Naya</span>';
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return ' <span class="change-badge flat">→ 0%</span>';
  const cls = pct > 0 ? 'up' : 'down';
  const arrow = pct > 0 ? '▲' : '▼';
  const sign = pct > 0 ? '+' : '';
  return ' <span class="change-badge ' + cls + '">' + arrow + ' ' + sign + pct + '%</span>';
}

function renderAll(){
  const prevBounds = getPreviousPeriodBounds(currentRange);

  const approvedTopups = allTopups.filter(function(t){ return t.status === 'approved'; });
  const rev = bucketSum(approvedTopups, 'approvedAt', 'amount', currentRange);
  drawLineChart('revenueChart', rev.labels, rev.values, 'Revenue', '#4F2FCE', 'revenueChart');
  const revTotal = rev.values.reduce(function(a, b){ return a + b; }, 0);
  const revPrev = sumInBounds(approvedTopups, 'approvedAt', 'amount', prevBounds);
  document.getElementById('revenueTotal').innerHTML = 'Total: <strong>₹' + revTotal + '</strong>' + changeBadge(revTotal, revPrev);

  const validOrders = allOrders.filter(function(o){ return o.status !== 'rejected'; });
  const ord = bucketSum(validOrders, 'createdAt', null, currentRange);
  drawLineChart('ordersChart', ord.labels, ord.values, 'Orders', '#FF6B3D', 'ordersChart');
  const totalOrderCount = ord.values.reduce(function(a, b){ return a + b; }, 0);
  const ordPrev = sumInBounds(validOrders, 'createdAt', null, prevBounds);
  document.getElementById('ordersTotal').innerHTML = 'Total: <strong>' + totalOrderCount + ' orders</strong>' + changeBadge(totalOrderCount, ordPrev);

  // Average Order Value — usi range ke andar aane wale orders ki
  // average price (sirf non-rejected).
  const rangeBuckets = getBuckets(currentRange);
  const ordersInRange = validOrders.filter(function(o){ return o.createdAt && rangeBuckets.match(new Date(o.createdAt)); });
  const totalOrderValue = ordersInRange.reduce(function(sum, o){ return sum + (o.price || 0); }, 0);
  const aov = ordersInRange.length ? (totalOrderValue / ordersInRange.length) : 0;
  document.getElementById('aovTotal').innerHTML = 'Average Order Value: <strong>₹' + aov.toFixed(2) + '</strong>';

  const grw = bucketSum(allUsers, 'createdAt', null, currentRange);
  drawLineChart('growthChart', grw.labels, grw.values, 'New Users', '#16C784', 'growthChart');
  const totalNewUsers = grw.values.reduce(function(a, b){ return a + b; }, 0);
  const grwPrev = sumInBounds(allUsers, 'createdAt', null, prevBounds);
  document.getElementById('growthTotal').innerHTML = 'New signups: <strong>' + totalNewUsers + '</strong>' + changeBadge(totalNewUsers, grwPrev);

  renderProductRanking();
  renderTopSpenders();
}

function drawLineChart(canvasId, labels, values, label, color, drilldownKey){
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
      },
      onClick: drilldownKey ? function(evt, elements){
        if (elements.length) showDrilldown(drilldownKey, elements[0].index);
      } : undefined
    }
  });
}

/* ================================================================
   DRILL-DOWN — chart ke kisi point par tap karne par us exact
   period (din/ghante/mahine) ka data ek bottom-sheet me dikhata hai.
================================================================ */
function showDrilldown(canvasId, index){
  const b = getBuckets(currentRange);
  const periodLabel = b.label(index);
  let title = '';
  let html = '';

  function matchesBucket(dateStr){
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return b.match(d) && b.key(d) === index;
  }

  if (canvasId === 'ordersChart'){
    const items = allOrders.filter(function(o){ return o.status !== 'rejected' && matchesBucket(o.createdAt); });
    items.sort(function(a, c){ return new Date(c.createdAt) - new Date(a.createdAt); });
    title = periodLabel + ' — ' + items.length + ' orders';
    html = items.length ? items.map(function(o){
      return '<div class="dd-item"><div class="dd-item-top"><strong>' + escapeHtml(o.productName || '') + '</strong><span>₹' + o.price + '</span></div>' +
        '<div class="dd-item-sub">' + escapeHtml(o.userEmail || '') + ' • ' + o.qty + ' qty • ' + (o.status || '') + '</div></div>';
    }).join('') : '<p class="admin-empty">Is period me koi order nahi hai</p>';
  } else if (canvasId === 'revenueChart'){
    const items = allTopups.filter(function(t){ return t.status === 'approved' && matchesBucket(t.approvedAt); });
    items.sort(function(a, c){ return new Date(c.approvedAt) - new Date(a.approvedAt); });
    title = periodLabel + ' — ' + items.length + ' top-ups';
    html = items.length ? items.map(function(t){
      return '<div class="dd-item"><div class="dd-item-top"><strong>' + escapeHtml(t.userEmail || '') + '</strong><span>₹' + t.amount + '</span></div>' +
        '<div class="dd-item-sub">UTR: ' + escapeHtml(t.utr || '') + '</div></div>';
    }).join('') : '<p class="admin-empty">Is period me koi top-up approve nahi hua</p>';
  } else if (canvasId === 'growthChart'){
    const items = allUsers.filter(function(u){ return matchesBucket(u.createdAt); });
    title = periodLabel + ' — ' + items.length + ' naye signups';
    html = items.length ? items.map(function(u){
      return '<div class="dd-item"><div class="dd-item-top"><strong>' + escapeHtml(u.name || 'Unnamed') + '</strong></div>' +
        '<div class="dd-item-sub">' + escapeHtml(u.email || '') + '</div></div>';
    }).join('') : '<p class="admin-empty">Is period me koi naya signup nahi hai</p>';
  }

  document.getElementById('drilldownTitle').textContent = title;
  document.getElementById('drilldownBody').innerHTML = html;
  document.getElementById('drilldownModal').classList.add('show');
}

window.closeDrilldown = function(){
  document.getElementById('drilldownModal').classList.remove('show');
};

function renderProductRanking(){
  const b = getBuckets(currentRange);
  const stats = {};
  allOrders.forEach(function(o){
    if (o.status === 'rejected') return;
    if (!o.createdAt) return;
    const d = new Date(o.createdAt);
    if (!b.match(d)) return;
    const qty = typeof o.qty === 'number' ? o.qty : (parseInt(o.qty, 10) || 1);
    if (!stats[o.productName]) stats[o.productName] = { orders: 0, qty: 0 };
    stats[o.productName].orders += 1;
    stats[o.productName].qty += qty;
  });

  // Sabse zyada quantity/content wala product upar, kyunki wahi
  // asli "performance" batata hai — sirf orders ki ginti se nahi.
  const sorted = Object.entries(stats).sort(function(a, b){ return b[1].qty - a[1].qty; });
  const el = document.getElementById('productRanking');

  if (!sorted.length){
    el.innerHTML = '<p class="admin-empty">Is period me koi order nahi hai</p>';
    return;
  }

  const max = sorted[0][1].qty;
  el.innerHTML = '';
  sorted.forEach(function(entry, i){
    const name = entry[0], stat = entry[1];
    const pct = max > 0 ? Math.round((stat.qty / max) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'rank-item';
    div.innerHTML =
      '<div class="rank-num">' + (i + 1) + '</div>' +
      '<div class="rank-bar-wrap">' +
        '<div class="rank-name">' + escapeHtml(name) + '</div>' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="rank-sub">' + stat.orders + ' baar purchase hua</div>' +
      '</div>' +
      '<div class="rank-count">' + stat.qty + '</div>';
    el.appendChild(div);
  });
}

/* ================================================================
   TOP SPENDERS — is range ke andar sabse zyada order value wale
   users, top 5. uid se group karke allUsers se naam/email nikalte
   hain.
================================================================ */
function renderTopSpenders(){
  const b = getBuckets(currentRange);
  const spend = {};

  allOrders.forEach(function(o){
    if (o.status === 'rejected') return;
    if (!o.createdAt || !o.uid) return;
    const d = new Date(o.createdAt);
    if (!b.match(d)) return;
    if (!spend[o.uid]) spend[o.uid] = { total: 0, orders: 0, email: o.userEmail || '' };
    spend[o.uid].total += (o.price || 0);
    spend[o.uid].orders += 1;
  });

  const el = document.getElementById('topSpenders');
  const sorted = Object.entries(spend).sort(function(a, b){ return b[1].total - a[1].total; }).slice(0, 5);

  if (!sorted.length){
    el.innerHTML = '<p class="admin-empty">Is period me koi order nahi hai</p>';
    return;
  }

  const max = sorted[0][1].total;
  el.innerHTML = '';
  sorted.forEach(function(entry, i){
    const uid = entry[0], stat = entry[1];
    const userDoc = allUsers.find(function(u){ return u.id === uid; });
    const label = (userDoc && userDoc.name) || stat.email || 'Unknown';
    const pct = max > 0 ? Math.round((stat.total / max) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'rank-item';
    div.innerHTML =
      '<div class="rank-num">' + (i + 1) + '</div>' +
      '<div class="rank-bar-wrap">' +
        '<div class="rank-name">' + escapeHtml(label) + '</div>' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="rank-sub">' + stat.orders + ' order' + (stat.orders === 1 ? '' : 's') + '</div>' +
      '</div>' +
      '<div class="rank-count">₹' + stat.total.toFixed(0) + '</div>';
    el.appendChild(div);
  });
}

/* ================================================================
   TOP PARTNERS — sabse zyada partnerBalance kamaane wale partners,
   top 5. Ye all-time snapshot hai (range se independent), kyunki
   partnerBalance current cumulative earning hai, kisi date se bandha
   nahi.
================================================================ */
function renderTopPartners(){
  const el = document.getElementById('topPartners');
  const partners = allUsers.filter(function(u){ return u.isPartner && (u.partnerBalance || 0) > 0; });
  const sorted = partners.sort(function(a, b){ return (b.partnerBalance || 0) - (a.partnerBalance || 0); }).slice(0, 5);

  if (!sorted.length){
    el.innerHTML = '<p class="admin-empty">Abhi koi partner earning nahi hai</p>';
    return;
  }

  const max = sorted[0].partnerBalance || 1;
  el.innerHTML = '';
  sorted.forEach(function(u, i){
    const pct = Math.round(((u.partnerBalance || 0) / max) * 100);
    const div = document.createElement('div');
    div.className = 'rank-item';
    div.innerHTML =
      '<div class="rank-num">' + (i + 1) + '</div>' +
      '<div class="rank-bar-wrap">' +
        '<div class="rank-name">' + escapeHtml(u.name || u.email || 'Unknown') + '</div>' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="rank-sub">Code: ' + escapeHtml(u.partnerCode || '—') + '</div>' +
      '</div>' +
      '<div class="rank-count">₹' + (u.partnerBalance || 0).toFixed(0) + '</div>';
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

/* ================================================================
   SHARE REPORT — abhi wale range ka summary text/PDF banate hain,
   fresh data se (jo bhi latest allOrders/allTopups/allUsers me hai).
================================================================ */
function pctChange(current, previous){
  if (previous === 0) return current === 0 ? null : Infinity;
  return Math.round(((current - previous) / previous) * 100);
}

function formatChangeText(pct){
  if (pct === null) return '';
  if (pct === Infinity) return ' (🆕 Naya)';
  const sign = pct > 0 ? '+' : '';
  const arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '→');
  return ' (' + arrow + ' ' + sign + pct + '%)';
}

function buildReportData(){
  const prevBounds = getPreviousPeriodBounds(currentRange);
  const b = getBuckets(currentRange);

  const approvedTopups = allTopups.filter(function(t){ return t.status === 'approved'; });
  const revInRange = approvedTopups.filter(function(t){ return t.approvedAt && b.match(new Date(t.approvedAt)); });
  const revTotal = revInRange.reduce(function(s, t){ return s + (t.amount || 0); }, 0);
  const revPrev = sumInBounds(approvedTopups, 'approvedAt', 'amount', prevBounds);

  const validOrders = allOrders.filter(function(o){ return o.status !== 'rejected'; });
  const ordersInRange = validOrders.filter(function(o){ return o.createdAt && b.match(new Date(o.createdAt)); });
  const ordersTotal = ordersInRange.length;
  const ordersPrev = sumInBounds(validOrders, 'createdAt', null, prevBounds);
  const orderValueTotal = ordersInRange.reduce(function(s, o){ return s + (o.price || 0); }, 0);
  const aov = ordersTotal ? (orderValueTotal / ordersTotal) : 0;

  const newUsersInRange = allUsers.filter(function(u){ return u.createdAt && b.match(new Date(u.createdAt)); });
  const newUsersTotal = newUsersInRange.length;
  const newUsersPrev = sumInBounds(allUsers, 'createdAt', null, prevBounds);

  const prodStats = {};
  ordersInRange.forEach(function(o){
    const qty = typeof o.qty === 'number' ? o.qty : (parseInt(o.qty, 10) || 1);
    prodStats[o.productName] = (prodStats[o.productName] || 0) + qty;
  });
  const topProducts = Object.entries(prodStats).sort(function(a, c){ return c[1] - a[1]; }).slice(0, 5);

  const spendStats = {};
  ordersInRange.forEach(function(o){
    if (!o.uid) return;
    if (!spendStats[o.uid]) spendStats[o.uid] = { total: 0, email: o.userEmail || '' };
    spendStats[o.uid].total += (o.price || 0);
  });
  const topSpenders = Object.entries(spendStats).sort(function(a, c){ return c[1].total - a[1].total; }).slice(0, 5).map(function(e){
    const u = allUsers.find(function(x){ return x.id === e[0]; });
    return { name: (u && u.name) || e[1].email || 'Unknown', total: e[1].total };
  });

  const topPartners = allUsers.filter(function(u){ return u.isPartner && (u.partnerBalance || 0) > 0; })
    .sort(function(a, c){ return (c.partnerBalance || 0) - (a.partnerBalance || 0); })
    .slice(0, 5).map(function(u){ return { name: u.name || u.email || 'Unknown', earned: u.partnerBalance || 0 }; });

  const rangeLabels = { today: 'Aaj', week: 'Is Hafte', month: 'Is Mahine', year: 'Is Saal' };

  return {
    rangeLabel: rangeLabels[currentRange] || currentRange,
    revenue: revTotal, revenueChangePct: pctChange(revTotal, revPrev),
    orders: ordersTotal, ordersChangePct: pctChange(ordersTotal, ordersPrev),
    aov: aov,
    newSignups: newUsersTotal, signupsChangePct: pctChange(newUsersTotal, newUsersPrev),
    topProducts: topProducts,
    topSpenders: topSpenders,
    topPartners: topPartners
  };
}

function buildReportText(){
  const d = buildReportData();
  const lines = [];
  lines.push('📊 *AKANS Social Store — Analytics Report*');
  lines.push('📅 Period: ' + d.rangeLabel);
  lines.push('');
  lines.push('💰 Revenue: ₹' + d.revenue + formatChangeText(d.revenueChangePct));
  lines.push('📦 Orders: ' + d.orders + formatChangeText(d.ordersChangePct));
  lines.push('💵 Avg Order Value: ₹' + d.aov.toFixed(2));
  lines.push('👥 New Signups: ' + d.newSignups + formatChangeText(d.signupsChangePct));

  if (d.topProducts.length){
    lines.push('');
    lines.push('🏆 *Top Products:*');
    d.topProducts.forEach(function(p, i){ lines.push((i + 1) + '. ' + p[0] + ' — ' + p[1] + ' units'); });
  }
  if (d.topSpenders.length){
    lines.push('');
    lines.push('💎 *Top Spenders:*');
    d.topSpenders.forEach(function(s, i){ lines.push((i + 1) + '. ' + s.name + ' — ₹' + s.total.toFixed(0)); });
  }
  if (d.topPartners.length){
    lines.push('');
    lines.push('🤝 *Top Partners:*');
    d.topPartners.forEach(function(p, i){ lines.push((i + 1) + '. ' + p.name + ' — ₹' + p.earned.toFixed(0) + ' earned'); });
  }
  return lines.join('\n');
}

window.shareOnWhatsApp = function(){
  const text = buildReportText();
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
};

window.downloadPDF = function(){
  if (!window.jspdf){
    alert('PDF library load nahi ho payi, internet check karke dobara try karein');
    return;
  }
  const d = buildReportData();
  const jsPDFCtor = window.jspdf.jsPDF;
  const doc = new jsPDFCtor();
  let y = 20;

  doc.setFontSize(16);
  doc.text('AKANS Social Store - Analytics Report', 14, y); y += 8;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text('Period: ' + d.rangeLabel + '  |  Generated: ' + new Date().toLocaleString('en-IN'), 14, y); y += 10;
  doc.setTextColor(0);

  doc.setFontSize(13);
  doc.text('Summary', 14, y); y += 7;
  doc.setFontSize(11);
  doc.text('Revenue: Rs.' + d.revenue, 14, y); y += 6;
  doc.text('Orders: ' + d.orders, 14, y); y += 6;
  doc.text('Avg Order Value: Rs.' + d.aov.toFixed(2), 14, y); y += 6;
  doc.text('New Signups: ' + d.newSignups, 14, y); y += 10;

  if (d.topProducts.length){
    doc.setFontSize(13); doc.text('Top Products', 14, y); y += 7;
    doc.setFontSize(11);
    d.topProducts.forEach(function(p, i){ doc.text((i + 1) + '. ' + p[0] + ' - ' + p[1] + ' units', 14, y); y += 6; });
    y += 4;
  }
  if (d.topSpenders.length){
    doc.setFontSize(13); doc.text('Top Spenders', 14, y); y += 7;
    doc.setFontSize(11);
    d.topSpenders.forEach(function(s, i){ doc.text((i + 1) + '. ' + s.name + ' - Rs.' + s.total.toFixed(0), 14, y); y += 6; });
    y += 4;
  }
  if (d.topPartners.length){
    doc.setFontSize(13); doc.text('Top Partners', 14, y); y += 7;
    doc.setFontSize(11);
    d.topPartners.forEach(function(p, i){ doc.text((i + 1) + '. ' + p.name + ' - Rs.' + p.earned.toFixed(0) + ' earned', 14, y); y += 6; });
  }

  doc.save('analytics-report-' + currentRange + '-' + new Date().toISOString().slice(0, 10) + '.pdf');
};

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
