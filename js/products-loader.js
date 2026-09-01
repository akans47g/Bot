/* =================================================================
   PRODUCTS-LOADER.JS — Dynamic products from Admin Panel
   =================================================================
   Firestore "products" collection me jo bhi bundles admin edit/add
   karega, wahi yahan se load hoke static products.js ki values ko
   override kar dega. Agar Firestore khaali hai (abhi tak import
   nahi hua), to products.js ki static values hi chalti rahengi —
   isliye site kabhi bhi tootegi nahi.
================================================================= */

import { db } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

(async function loadDynamicProducts(){
  try{
    const snap = await getDocs(collection(db, 'products'));
    if (snap.empty) return;

    const dynamicProducts = {};
    snap.forEach(function(docSnap){
      dynamicProducts[docSnap.id] = docSnap.data();
    });

    window.PRODUCTS = Object.assign({}, window.PRODUCTS, dynamicProducts);
  } catch(e){
    console.warn('Dynamic products load nahi ho paye, static data use ho raha hai.');
  }
})();
