/* =================================================================
   BUNDLES.JS — Bundle manager (Firestore-backed)
   =================================================================
   index.html ab js/products-loader.js ke through Firestore ke
   "products" collection se live data padhta hai (agar khaali hai
   to products.js ki static values fallback ban jaati hain).
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin, logAdminAction } from "./admin-guard.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let bundles = {};

requireAdmin(function(){
  loadBundles();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async function(){
  await logout();
  window.location.href = '../admin.html';
});

async function loadBundles(){
  const snap = await getDocs(collection(db, 'products'));
  bundles = {};
  snap.forEach(function(d){ bundles[d.id] = d.data(); });

  document.getElementById('importBanner').style.display = snap.empty ? 'block' : 'none';
  render();
}

function render(){
  const list = document.getElementById('bundleList');
  const ids = Object.keys(bundles);
  document.getElementById('bundleCount').textContent = ids.length;

  if (!ids.length){
    list.innerHTML = '<p class="admin-empty">Koi bundle nahi mila — upar se import ya add karein</p>';
    return;
  }

  list.innerHTML = '';
  ids.forEach(function(id){
    const b = bundles[id];
    const row = document.createElement('div');
    row.className = 'bundle-item';
    row.innerHTML =
      '<div>' +
        '<div class="bundle-item-name">' + escapeHtml(b.name) + '</div>' +
        '<div class="bundle-item-rate">₹' + b.rate + ' / 1000 • id: ' + escapeHtml(id) + '</div>' +
      '</div>' +
      '<div class="bundle-item-actions">' +
        '<button type="button" class="bundle-icon-btn" data-edit="' + id + '" aria-label="Edit">✏️</button>' +
        '<button type="button" class="bundle-icon-btn danger" data-delete="' + id + '" aria-label="Delete">🗑️</button>' +
      '</div>';
    list.appendChild(row);
  });
}

document.getElementById('bundleList').addEventListener('click', async function(e){
  const editBtn = e.target.closest('[data-edit]');
  const deleteBtn = e.target.closest('[data-delete]');

  if (editBtn){
    const id = editBtn.dataset.edit;
    const b = bundles[id];
    const newName = prompt('Bundle ka naam:', b.name);
    if (newName === null) return;
    const newRateStr = prompt('Rate (₹ per 1000):', b.rate);
    if (newRateStr === null) return;
    const newRate = parseFloat(newRateStr);
    if (!newName.trim() || isNaN(newRate) || newRate <= 0){
      alert('Sahi naam aur rate dalein');
      return;
    }
    await setDoc(doc(db, 'products', id), { name: newName.trim(), rate: newRate });
    await logAdminAction('bundle_edited', '✏️ Edited "' + newName.trim() + '" (id: ' + id + ') → ₹' + newRate + '/1000');
    await loadBundles();
  }

  if (deleteBtn){
    const id = deleteBtn.dataset.delete;
    if (!confirm('"' + bundles[id].name + '" delete karna hai? Ye undo nahi ho sakta.')) return;
    const name = bundles[id].name;
    await deleteDoc(doc(db, 'products', id));
    await logAdminAction('bundle_deleted', '🗑️ Deleted bundle: ' + name + ' (id: ' + id + ')');
    await loadBundles();
  }
});

document.getElementById('importBtn').addEventListener('click', async function(){
  const staticProducts = window.PRODUCTS || {};
  const ids = Object.keys(staticProducts);
  if (!ids.length){
    alert('products.js me data nahi mila');
    return;
  }
  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Import ho raha hai...';

  for (const id of ids){
    await setDoc(doc(db, 'products', id), staticProducts[id]);
  }

  btn.disabled = false;
  btn.textContent = '📥 Import from products.js';
  await logAdminAction('bundle_imported', '📥 Imported ' + ids.length + ' bundles from products.js');
  await loadBundles();
});

document.getElementById('addBundleBtn').addEventListener('click', async function(){
  const nameEl = document.getElementById('newBundleName');
  const rateEl = document.getElementById('newBundleRate');
  const errEl = document.getElementById('bundleFormError');

  const name = nameEl.value.trim();
  const rate = parseFloat(rateEl.value);

  if (!name){
    errEl.textContent = 'Bundle ka naam likhein';
    errEl.style.display = 'block';
    return;
  }
  if (isNaN(rate) || rate <= 0){
    errEl.textContent = 'Sahi rate daalein';
    errEl.style.display = 'block';
    return;
  }

  const id = slugify(name);
  if (bundles[id]){
    errEl.textContent = 'Is naam ka bundle pehle se hai, alag naam try karein';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  await setDoc(doc(db, 'products', id), { name: name, rate: rate });
  await logAdminAction('bundle_added', '➕ Added new bundle: ' + name + ' (₹' + rate + '/1000)');

  nameEl.value = '';
  rateEl.value = '';
  await loadBundles();
  alert('✅ Bundle add ho gaya! Ise storefront pe card ke roop me dikhane ke liye index.html me ek naya card bhi add karna hoga — bata dena, kar dungi.');
});

function slugify(str){
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
