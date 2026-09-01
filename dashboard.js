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
    const [topupsSnap, ordersSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, 'topups')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'users'))
    ]);

    let pendingTopups = 0, pendingOrders = 0, todayRevenue = 0;
    const todayStr = new Date().toDateString();
    const activity = [];

    topupsSnap.forEach(function(d){
      const data = d.data();
      if (data.status === 'pending') pendingTopups++;
      if (data.status === 'approved' && data.approvedAt && new Date(data.approvedAt).toDateString() === todayStr){
        todayRevenue += data.amount;
      }
      activity.push({ type: 'topup', amount: data.amount, status: data.status, date: data.createdAt, email: data.userEmail });
    });

    ordersSnap.forEach(function(d){
      const data = d.data();
      if (data.status === 'pending') pendingOrders++;
      activity.push({ type: 'order', amount: data.price, status: data.status, date: data.createdAt, email: data.userEmail, product: data.productName });
    });

    document.getElementById('statPendingTopups').textContent = pendingTopups;
    document.getElementById('statPendingOrders').textContent = pendingOrders;
    document.getElementById('statTotalUsers').textContent = usersSnap.size;
    document.getElementById('statTodayRevenue').textContent = '₹' + todayRevenue;

    activity.sort(function(a, b){ return new Date(b.date) - new Date(a.date); });
    renderActivity(activity.slice(0, 8));
  } catch(err){
    console.error(err);
    document.getElementById('recentActivity').innerHTML = '<p class="admin-empty">Data load nahi ho paya</p>';
  }
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
