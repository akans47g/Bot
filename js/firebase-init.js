/* =================================================================
   FIREBASE-INIT.JS — Firebase Setup
   =================================================================
   👉 Neeche apna REAL Firebase config paste karna hai. Kaise milega:

   1. https://console.firebase.google.com kholo, login karo
   2. "Add project" karke naya project banao (jaise "akans-store")
   3. Project ke andar "</>" (Web) icon pe click karke ek Web App
      register karo (nickname kuch bhi rakh do)
   4. Wahan ek "firebaseConfig = {...}" object dikhega — usko copy
      karke neeche wali jagah PURA replace kar dena

   5. Authentication enable karna (zaroori hai, warna login kaam
      nahi karega):
      Build → Authentication → Get started → "Sign-in method" tab
        → "Email/Password"  → Enable → Save
        → "Google"          → Enable → apna support email select karo → Save

   6. ⚠️ IMPORTANT — GitHub Pages ke liye:
      Authentication → Settings → Authorized domains → Add domain
      → apna GitHub Pages wala domain daalo, jaise: akans47g.github.io
      (Ye step skip mat karna, iske bina Google Sign-In fail karega)
================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCN4bamwRVheZaIOxg07FB-0eFeHvzFDv8",
  authDomain: "gf-store-b760e.firebaseapp.com",
  projectId: "gf-store-b760e",
  storageBucket: "gf-store-b760e.firebasestorage.app",
  messagingSenderId: "812868445574",
  appId: "1:812868445574:web:c40066f608c854bf9db807"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
