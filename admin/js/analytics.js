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

  renderAll(); // also triggers Smart Alerts + Forecast + Ad Spend calc (range-aware)
  renderLoginActivity();
  renderActivityLog(logsSnap);
  renderTopPartners();
  renderGoalTracker();
  renderHeatmap();
  renderFunnel();
  renderChurnRisk();
  renderLTV();
  renderBestProductForAds();
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
  if (allTopups.length || allOrders.length) { renderSmartAlerts(); renderForecast(); renderAdSpendCalculator(); renderBestProductForAds(); }
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

/* ================================================================
   SMART ALERTS — auto-generated from the SAME period-comparison
   data buildReportData() already computes for the Share Report.
================================================================ */
function renderSmartAlerts(){
  const d = buildReportData();
  const alerts = [];

  if (d.revenueChangePct !== null && d.revenueChangePct !== Infinity){
    if (d.revenueChangePct <= -20) alerts.push({ type:'danger', icon:'📉', text:'Revenue ' + Math.abs(d.revenueChangePct) + '% gira hai pichle period se — turant check karo.' });
    else if (d.revenueChangePct >= 30) alerts.push({ type:'success', icon:'📈', text:'Revenue ' + d.revenueChangePct + '% badha hai — badhiya ja raha hai!' });
  }
  if (d.ordersChangePct !== null && d.ordersChangePct !== Infinity && d.ordersChangePct <= -25){
    alerts.push({ type:'warn', icon:'📦', text:'Orders ' + Math.abs(d.ordersChangePct) + '% kam hue hain — demand check karo.' });
  }
  if (d.signupsChangePct !== null && d.signupsChangePct !== Infinity && d.signupsChangePct >= 50){
    alerts.push({ type:'info', icon:'🆕', text:'New signups ' + d.signupsChangePct + '% badhe hain — growth acchi hai!' });
  }
  if (!alerts.length){
    alerts.push({ type:'success', icon:'✅', text:'Sab metrics stable hain — koi major change nahi.' });
  }

  const el = document.getElementById('smartAlertsList');
  if (el){
    el.innerHTML = alerts.map(function(a){
      return '<div class="smart-alert ' + a.type + '"><span class="sa-icon">' + a.icon + '</span><span>' + a.text + '</span></div>';
    }).join('');
  }
}

/* ================================================================
   MONTHLY REVENUE GOAL — admin sets their own target (stored in
   localStorage); progress is always THIS calendar month, regardless
   of the range toggle.
================================================================ */
function renderGoalTracker(){
  const goal = parseFloat(localStorage.getItem('akans_revenue_goal') || '10000');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const approvedTopups = allTopups.filter(function(t){ return t.status === 'approved'; });
  const thisMonthRevenue = approvedTopups
    .filter(function(t){ return t.approvedAt && new Date(t.approvedAt) >= monthStart; })
    .reduce(function(s, t){ return s + (t.amount || 0); }, 0);

  const pct = goal > 0 ? Math.min(100, Math.round((thisMonthRevenue / goal) * 100)) : 0;

  const amtEl = document.getElementById('goalCurrentAmount');
  const targetEl = document.getElementById('goalTargetText');
  const fillEl = document.getElementById('goalFill');
  const noteEl = document.getElementById('goalNote');

  if (amtEl) amtEl.textContent = '₹' + thisMonthRevenue;
  if (targetEl) targetEl.textContent = 'of ₹' + goal + ' goal';
  if (fillEl) fillEl.style.width = pct + '%';
  if (noteEl) noteEl.textContent = (pct >= 100 ? '🎉 Goal achieve ho gaya! ' : pct + '% complete — ') + monthStart.toLocaleDateString('en-IN', { month: 'long' }) + ' ka target';
}

window.editGoal = function(){
  const current = localStorage.getItem('akans_revenue_goal') || '10000';
  const input = prompt('Is mahine ka revenue goal set karo (₹):', current);
  if (input === null) return;
  const num = parseFloat(input);
  if (isNaN(num) || num <= 0){ alert('Sahi number daalo'); return; }
  localStorage.setItem('akans_revenue_goal', String(num));
  renderGoalTracker();
};

/* ================================================================
   ACTIVITY HEATMAP — day-of-week × hour grid, last 30 days,
   combining orders + topups as "activity".
================================================================ */
function renderHeatmap(){
  const el = document.getElementById('heatmapGrid');
  if (!el) return;

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const grid = [];
  for (let i = 0; i < 7; i++) grid.push(new Array(24).fill(0));

  allOrders.concat(allTopups).forEach(function(r){
    if (!r.createdAt) return;
    const d = new Date(r.createdAt);
    if (d < since) return;
    grid[d.getDay()][d.getHours()]++;
  });

  let max = 0;
  grid.forEach(function(row){ row.forEach(function(v){ if (v > max) max = v; }); });

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const colors = ['var(--bg)', '#E4DAFB', '#D4C6FA', '#B19AF5', '#9B7AF0', 'var(--brand)'];

  function colorFor(v){
    if (max === 0 || v === 0) return colors[0];
    const ratio = v / max;
    const idx = Math.min(colors.length - 1, Math.ceil(ratio * (colors.length - 1)));
    return colors[idx];
  }

  let html = '<div></div>';
  for (let h = 0; h < 24; h++) html += '<div class="heatmap-hour-label">' + (h % 3 === 0 ? h : '') + '</div>';
  for (let day = 0; day < 7; day++){
    html += '<div class="heatmap-day-label">' + dayNames[day] + '</div>';
    for (let h = 0; h < 24; h++){
      const v = grid[day][h];
      html += '<div class="heatmap-cell" style="background:' + colorFor(v) + '" title="' + dayNames[day] + ' ' + h + ':00 — ' + v + '"></div>';
    }
  }
  el.innerHTML = html;
}

/* ================================================================
   CONVERSION FUNNEL — Signups → First Order → Repeat Order.
   All-time (not range-based), since it's a lifetime behaviour metric.
================================================================ */
function renderFunnel(){
  const el = document.getElementById('funnelCard');
  if (!el) return;
  if (!allUsers.length){ el.innerHTML = '<p class="admin-empty">Koi user nahi hai</p>'; return; }

  const validOrders = allOrders.filter(function(o){ return o.status !== 'rejected'; });
  const ordersByUid = {};
  validOrders.forEach(function(o){
    if (!o.uid) return;
    ordersByUid[o.uid] = (ordersByUid[o.uid] || 0) + 1;
  });

  const totalUsers = allUsers.length;
  const usersWithOrder = Object.keys(ordersByUid).length;
  const usersWithRepeat = Object.values(ordersByUid).filter(function(c){ return c > 1; }).length;

  const steps = [
    { label: 'Signups', count: totalUsers },
    { label: 'First Order', count: usersWithOrder },
    { label: 'Repeat Order', count: usersWithRepeat }
  ];

  let html = '';
  steps.forEach(function(s, i){
    const pct = totalUsers > 0 ? Math.round((s.count / totalUsers) * 100) : 0;
    html += '<div class="funnel-step">' +
      '<div class="funnel-step-top"><span>' + s.label + '</span><span class="funnel-step-pct">' + s.count + ' (' + pct + '%)</span></div>' +
      '<div class="funnel-bar-track"><div class="funnel-bar-fill" style="width:' + Math.max(pct, 4) + '%"></div></div>';
    if (i > 0){
      const prev = steps[i - 1].count;
      const dropPct = prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : 0;
      if (dropPct > 0) html += '<div class="funnel-drop">↓ ' + dropPct + '% drop from ' + steps[i - 1].label + '</div>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
}

/* ================================================================
   CHURN RISK — users with at least one past order but none in the
   last 30 days, sorted by how long they've been gone.
================================================================ */
function renderChurnRisk(){
  const el = document.getElementById('churnList');
  if (!el) return;

  const validOrders = allOrders.filter(function(o){ return o.status !== 'rejected' && o.uid && o.createdAt; });
  const lastOrderByUid = {};
  validOrders.forEach(function(o){
    const d = new Date(o.createdAt);
    if (!lastOrderByUid[o.uid] || d > lastOrderByUid[o.uid]) lastOrderByUid[o.uid] = d;
  });

  const now = new Date();
  const churned = Object.entries(lastOrderByUid)
    .map(function(entry){
      return { uid: entry[0], lastDate: entry[1], days: Math.floor((now - entry[1]) / 86400000) };
    })
    .filter(function(c){ return c.days >= 30; })
    .sort(function(a, b){ return b.days - a.days; })
    .slice(0, 10);

  if (!churned.length){ el.innerHTML = '<p class="admin-empty">Koi churn risk nahi — sab active hain 🎉</p>'; return; }

  el.innerHTML = '';
  churned.forEach(function(c){
    const u = allUsers.find(function(x){ return x.id === c.uid; });
    const div = document.createElement('div');
    div.className = 'churn-item';
    div.innerHTML =
      '<div><div class="churn-name">' + escapeHtml((u && u.name) || (u && u.email) || 'Unknown') + '</div>' +
      '<div class="churn-sub">Last order: ' + c.lastDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '</div></div>' +
      '<div class="churn-days">' + c.days + 'd ago</div>';
    el.appendChild(div);
  });
}

/* ================================================================
   FORECAST — projects the CURRENT range-toggle's period forward,
   using the average of this period's own buckets as the daily/
   weekly/monthly run-rate.
================================================================ */
function renderForecast(){
  const amtEl = document.getElementById('forecastAmount');
  const noteEl = document.getElementById('forecastNote');
  if (!amtEl) return;

  const approvedTopups = allTopups.filter(function(t){ return t.status === 'approved'; });
  const rev = bucketSum(approvedTopups, 'approvedAt', 'amount', currentRange);
  const avg = rev.values.length ? (rev.values.reduce(function(a, b){ return a + b; }, 0) / rev.values.length) : 0;
  const projected = Math.round(avg * rev.values.length);

  const rangeLabels = { today: 'kal', week: 'agle hafte', month: 'agle mahine', year: 'agle saal' };
  amtEl.textContent = '₹' + projected;
  noteEl.textContent = 'Is period ke average trend ke adhar par ' + (rangeLabels[currentRange] || 'agle period') + ' ka estimate';
}

/* ================================================================
   CUSTOMER LTV — all-time average revenue per paying customer.
   Uses userEmail (not uid) since that's confirmed present on topups.
================================================================ */
function renderLTV(){
  const amtEl = document.getElementById('ltvAmount');
  const noteEl = document.getElementById('ltvNote');
  if (!amtEl) return;

  const approvedTopups = allTopups.filter(function(t){ return t.status === 'approved'; });
  const totalRevenue = approvedTopups.reduce(function(s, t){ return s + (t.amount || 0); }, 0);
  const payingEmails = new Set();
  approvedTopups.forEach(function(t){ if (t.userEmail) payingEmails.add(t.userEmail); });
  const count = payingEmails.size;
  const ltv = count > 0 ? Math.round(totalRevenue / count) : 0;

  amtEl.textContent = '₹' + ltv;
  noteEl.textContent = count + ' paying customer' + (count === 1 ? '' : 's') + ' · Total revenue ₹' + totalRevenue;
}

/* ================================================================
   AD SPEND & ROI CALCULATOR — admin manually enters ad spend for the
   current range-toggle period; CAC and ROAS computed from real
   revenue + new-signup numbers (buildReportData). Spend is saved
   per-range in localStorage so it's remembered across visits.
================================================================ */
function adSpendStorageKey(){
  return 'akans_ad_spend_' + currentRange;
}

function renderAdSpendCalculator(){
  const input = document.getElementById('adSpendInput');
  const labelEl = document.getElementById('adCalcRangeLabel');
  if (!input) return;

  const rangeLabels = { today: 'Today', week: 'Week', month: 'Month', year: 'Year' };
  if (labelEl) labelEl.textContent = rangeLabels[currentRange] || currentRange;

  const saved = localStorage.getItem(adSpendStorageKey());
  input.value = saved || '';
  computeAdMetrics(saved ? parseFloat(saved) : 0);
}

window.onAdSpendInput = function(val){
  const num = parseFloat(val);
  localStorage.setItem(adSpendStorageKey(), isNaN(num) ? '' : String(num));
  computeAdMetrics(isNaN(num) ? 0 : num);
};

function computeAdMetrics(adSpend){
  const el = document.getElementById('adCalcMetrics');
  if (!el) return;

  if (!adSpend || adSpend <= 0){
    el.innerHTML = '<p class="admin-empty" style="grid-column:1/-1;">Ad spend daalo upar ↑</p>';
    return;
  }

  const d = buildReportData();
  const newCustomers = d.newSignups || 0;
  const revenue = d.revenue || 0;

  const cac = newCustomers > 0 ? Math.round(adSpend / newCustomers) : null;
  const roas = (revenue / adSpend);
  const profit = revenue - adSpend;
  const isProfit = profit >= 0;

  el.innerHTML =
    '<div class="ad-metric"><div class="ad-metric-val">' + (cac !== null ? '₹' + cac : '—') + '</div><div class="ad-metric-label">Cost / Customer</div></div>' +
    '<div class="ad-metric"><div class="ad-metric-val">' + roas.toFixed(2) + 'x</div><div class="ad-metric-label">ROAS</div></div>' +
    '<div class="ad-metric"><div class="ad-metric-val">' + newCustomers + '</div><div class="ad-metric-label">New Customers</div></div>' +
    '<div class="ad-metric"><div class="ad-metric-val">₹' + revenue + '</div><div class="ad-metric-label">Period Revenue</div></div>' +
    '<div class="ad-verdict ' + (isProfit ? 'profit' : 'loss') + '">' +
      (isProfit ? '✅ Profitable — ₹' + profit + ' net is period' : '⚠️ Loss — ₹' + Math.abs(profit) + ' is period, spend kam karo ya conversion improve karo') +
    '</div>';
}

/* ================================================================
   BEST PRODUCT FOR ADS — ranks products by REVENUE generated
   (not just units sold) in the current range, since that's what
   actually matters when deciding where to put ad budget.
================================================================ */
function renderBestProductForAds(){
  const el = document.getElementById('bestProductList');
  if (!el) return;

  const b = getBuckets(currentRange);
  const stats = {};
  allOrders.forEach(function(o){
    if (o.status === 'rejected') return;
    if (!o.createdAt) return;
    const d = new Date(o.createdAt);
    if (!b.match(d)) return;
    if (!stats[o.productName]) stats[o.productName] = { revenue: 0, units: 0 };
    stats[o.productName].revenue += (o.price || 0);
    stats[o.productName].units += (typeof o.qty === 'number' ? o.qty : (parseInt(o.qty, 10) || 1));
  });

  const sorted = Object.entries(stats).sort(function(a, c){ return c[1].revenue - a[1].revenue; }).slice(0, 5);

  if (!sorted.length){ el.innerHTML = '<p class="admin-empty">Is period me koi order nahi hai</p>'; return; }

  el.innerHTML = '';
  sorted.forEach(function(entry, i){
    const name = entry[0], stat = entry[1];
    const div = document.createElement('div');
    div.className = 'best-product-item';
    div.innerHTML =
      '<div class="bp-rank">' + (i + 1) + '</div>' +
      '<div class="bp-info"><div class="bp-name">' + escapeHtml(name) + '</div>' +
      '<div class="bp-sub">' + stat.units + ' units sold' + (i === 0 ? ' · 🚀 Top pick for ads' : '') + '</div></div>' +
      '<div class="bp-revenue">₹' + stat.revenue + '</div>';
    el.appendChild(div);
  });
}

/* ================================================================
   CSV EXPORT — same data as PDF/WhatsApp (buildReportData), as a
   downloadable .csv file.
================================================================ */
window.downloadCSV = function(){
  const d = buildReportData();
  const rows = [];
  rows.push(['Metric', 'Value']);
  rows.push(['Period', d.rangeLabel]);
  rows.push(['Revenue', d.revenue]);
  rows.push(['Orders', d.orders]);
  rows.push(['Average Order Value', d.aov.toFixed(2)]);
  rows.push(['New Signups', d.newSignups]);
  rows.push([]);
  rows.push(['Top Products', 'Units Sold']);
  d.topProducts.forEach(function(p){ rows.push([p[0], p[1]]); });
  rows.push([]);
  rows.push(['Top Spenders', 'Amount']);
  d.topSpenders.forEach(function(s){ rows.push([s.name, s.total.toFixed(0)]); });
  rows.push([]);
  rows.push(['Top Partners', 'Earned']);
  d.topPartners.forEach(function(p){ rows.push([p.name, p.earned.toFixed(0)]); });

  const csv = rows.map(function(row){
    return row.map(function(cell){
      const s = String(cell);
      return s.indexOf(',') >= 0 ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'analytics-report-' + currentRange + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* ================================================================
   QUICK SEARCH, KEYBOARD SHORTCUTS, COLLAPSIBLE + DRAGGABLE SECTIONS
   — same conventions as the upgraded dashboard.html, for consistency.
================================================================ */
(function(){
  const ADMIN_PAGES = [
    { icon:"📊", label:"Dashboard", url:"dashboard.html" },
    { icon:"💰", label:"Top-ups", url:"topups.html" },
    { icon:"📦", label:"Orders", url:"orders.html" },
    { icon:"🎁", label:"Bundles", url:"bundles.html" },
    { icon:"📈", label:"Stats / Analytics", url:"analytics.html" },
    { icon:"👥", label:"Users", url:"users.html" },
    { icon:"💸", label:"Payouts / Withdrawals", url:"withdrawals.html" },
    { icon:"🎮", label:"FF Orders", url:"ff-orders.html" },
  ];

  window.openAdminSearch = function(){
    const overlay = document.getElementById('adminSearchOverlay');
    const input = document.getElementById('adminSearchInput');
    if (!overlay) return;
    overlay.classList.add('show');
    renderSearchResults('');
    setTimeout(function(){ input && input.focus(); }, 50);
  };
  window.closeAdminSearch = function(){
    const overlay = document.getElementById('adminSearchOverlay');
    if (overlay) overlay.classList.remove('show');
  };
  window.renderSearchResults = function(query){
    const q = (query || '').trim().toLowerCase();
    const matches = ADMIN_PAGES.filter(function(p){ return p.label.toLowerCase().indexOf(q) >= 0; });
    const el = document.getElementById('adminSearchResults');
    if (!el) return;
    if (!matches.length){ el.innerHTML = '<div class="admin-search-empty">Koi page nahi mila</div>'; return; }
    el.innerHTML = matches.map(function(p, i){
      return '<div class="admin-search-result' + (i === 0 ? ' highlighted' : '') + '" onclick="location.href=\'' + p.url + '\'">' +
        '<span class="admin-search-result-icon">' + p.icon + '</span>' +
        '<span class="admin-search-result-label">' + p.label + '</span></div>';
    }).join('');
  };

  const SHORTCUT_MAP = { d:'dashboard.html', t:'topups.html', o:'orders.html', b:'bundles.html', s:'analytics.html', u:'users.html', p:'withdrawals.html', f:'ff-orders.html' };
  document.addEventListener('keydown', function(e){
    const tag = (e.target.tagName || '').toLowerCase();
    const editing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape'){
      closeAdminSearch();
      const kh = document.getElementById('kbdHintPopup');
      if (kh) kh.classList.remove('show');
      return;
    }
    if (editing) return;
    if (e.key === '/'){ e.preventDefault(); openAdminSearch(); return; }
    if (e.key === '?'){ const kh = document.getElementById('kbdHintPopup'); if (kh) kh.classList.toggle('show'); return; }
    if (SHORTCUT_MAP[e.key]) location.href = SHORTCUT_MAP[e.key];
  });

  window.toggleSection = function(bodyId, headEl){
    const body = document.getElementById(bodyId);
    if (!body) return;
    const isC = body.classList.contains('collapsed');
    body.classList.toggle('collapsed', !isC);
    headEl.classList.toggle('collapsed', !isC);
    try {
      const saved = JSON.parse(localStorage.getItem('akans_analytics_collapsed') || '{}');
      saved[bodyId] = !isC;
      localStorage.setItem('akans_analytics_collapsed', JSON.stringify(saved));
    } catch(e){}
  };
  function restoreCollapsed(){
    try {
      const saved = JSON.parse(localStorage.getItem('akans_analytics_collapsed') || '{}');
      Object.entries(saved).forEach(function(entry){
        if (!entry[1]) return;
        const body = document.getElementById(entry[0]);
        if (!body) return;
        body.classList.add('collapsed');
        const head = body.previousElementSibling;
        if (head && head.classList.contains('sec-head')) head.classList.add('collapsed');
      });
    } catch(e){}
  }
  function initDrag(){
    const area = document.getElementById('sortableArea');
    if (!area || !window.Sortable) return;
    Sortable.create(area, {
      handle: '.sec-drag-handle',
      animation: 150,
      ghostClass: 'sort-ghost',
      onEnd: function(){
        try {
          const order = Array.prototype.map.call(area.children, function(el){ return el.id; });
          localStorage.setItem('akans_analytics_section_order', JSON.stringify(order));
        } catch(e){}
      }
    });
    try {
      const order = JSON.parse(localStorage.getItem('akans_analytics_section_order') || '[]');
      order.forEach(function(id){ const el = document.getElementById(id); if (el) area.appendChild(el); });
    } catch(e){}
  }

  document.addEventListener('DOMContentLoaded', function(){
    restoreCollapsed();
    initDrag();
  });
})();
