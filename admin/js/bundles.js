/* =================================================================
   BUNDLES.JS — Bundle manager (Firestore-backed)
   =================================================================
   index.html ab js/products-loader.js ke through Firestore ke
   "products" collection se live data padhta hai (agar khaali hai
   to products.js ki static values fallback ban jaati hain).

   Har bundle ka "rate" (normal linear price) hota hai, aur
   optional "tierPrices" — jisme specific quantities (50/100/300/
   500/1000/5000/10000/50000) ka apna fixed price set kiya jaa
   sakta hai, jo linear formula ko override kar deta hai.
================================================================= */

import { db } from "../../js/firebase-init.js";
import { logout } from "../../js/auth.js";
import { requireAdmin, logAdminAction } from "./admin-guard.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const QTY_TIERS = [50, 100, 300, 500, 1000, 5000, 10000, 50000];

let bundles = {};
let editingId = null;

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

function tierLabel(n){
  return n >= 1000 ? (n / 1000) + 'K' : String(n);
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
    const overrideCount = b.tierPrices ? Object.keys(b.tierPrices).filter(function(k){ return b.tierPrices[k] != null; }).length : 0;
    const row = document.createElement('div');
    row.className = 'bundle-item';
    row.innerHTML =
      '<div>' +
        '<div class="bundle-item-name">' + escapeHtml(b.name) + '</div>' +
        '<div class="bundle-item-rate">₹' + b.rate + ' / 1000 • id: ' + escapeHtml(id) + (overrideCount ? ' • 🎯 ' + overrideCount + ' custom price' + (overrideCount > 1 ? 's' : '') : '') + '</div>' +
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
    openBundleEditModal(editBtn.dataset.edit);
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

/* ---------- EDIT MODAL ---------- */
function openBundleEditModal(id){
  const b = bundles[id];
  editingId = id;

  document.getElementById('bemError').textContent = '';
  document.getElementById('bemName').value = b.name;
  document.getElementById('bemRate').value = b.rate;

  const grid = document.getElementById('bemTierGrid');
  grid.innerHTML = '';
  QTY_TIERS.forEach(function(qty){
    const autoPrice = Math.round((b.rate / 1000) * qty * 100) / 100;
    const existing = b.tierPrices && b.tierPrices[String(qty)] != null ? b.tierPrices[String(qty)] : '';
    const item = document.createElement('div');
    item.className = 'bem-tier-item';
    item.innerHTML =
      '<label>' + tierLabel(qty) + ' <span class="bem-auto">(auto: ₹' + autoPrice + ')</span></label>' +
      '<input type="number" data-tier="' + qty + '" placeholder="Auto" value="' + existing + '">';
    grid.appendChild(item);
  });

  document.getElementById('bemOverlay').classList.add('active');
}

window.closeBundleEditModal = function(){
  document.getElementById('bemOverlay').classList.remove('active');
  editingId = null;
};

document.getElementById('bemOverlay').addEventListener('click', function(e){
  if (e.target === this) window.closeBundleEditModal();
});

document.getElementById('bemSaveBtn').addEventListener('click', async function(){
  if (!editingId) return;
  const errEl = document.getElementById('bemError');
  const name = document.getElementById('bemName').value.trim();
  const rate = parseFloat(document.getElementById('bemRate').value);

  if (!name){
    errEl.textContent = 'Bundle ka naam likhein';
    return;
  }
  if (isNaN(rate) || rate <= 0){
    errEl.textContent = 'Sahi rate daalein';
    return;
  }

  const tierPrices = {};
  const tierInputs = document.querySelectorAll('#bemTierGrid input[data-tier]');
  tierInputs.forEach(function(input){
    const raw = input.value.trim();
    if (raw !== ''){
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 0){
        tierPrices[input.dataset.tier] = val;
      }
    }
  });

  errEl.textContent = '';
  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try{
    await setDoc(doc(db, 'products', editingId), { name: name, rate: rate, tierPrices: tierPrices });
    const overrideCount = Object.keys(tierPrices).length;
    await logAdminAction('bundle_edited', '✏️ Edited "' + name + '" (id: ' + editingId + ') → ₹' + rate + '/1000' + (overrideCount ? ' + ' + overrideCount + ' custom price(s)' : ''));
    window.closeBundleEditModal();
    await loadBundles();
  } catch(err){
    errEl.textContent = 'Kuch galat ho gaya, dobara try karein';
  }

  btn.disabled = false;
  btn.textContent = 'Save Changes';
});

/* ---------- IMPORT FROM products.js ---------- */
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

/* ---------- ADD NEW BUNDLE ---------- */
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
  await setDoc(doc(db, 'products', id), { name: name, rate: rate, tierPrices: {} });
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
