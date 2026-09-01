/* =================================================================
   AUTH.JS — Login, Sign Up, Google Sign-In, Logout, Password Reset
   =================================================================
   Ye file firebase-init.js se auth/db leke, saara login logic
   ready-made functions me deti hai. login.html (aur baad me
   account.html, index.html) inhi functions ko import karke use
   karenge.
================================================================= */

import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

/* 4-char refer code banata hai: 2 letters (A-Z) + 2 digits (0-9),
   jaise "MK07". Uniqueness "referCodes" collection me check hoti
   hai (document ID hi code hota hai). */
function generateReferCode(){
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l1 = letters[Math.floor(Math.random() * 26)];
  const l2 = letters[Math.floor(Math.random() * 26)];
  const n1 = Math.floor(Math.random() * 10);
  const n2 = Math.floor(Math.random() * 10);
  return l1 + l2 + n1 + n2;
}

async function assignUniqueReferCode(uid){
  for (let attempt = 0; attempt < 10; attempt++){
    const code = generateReferCode();
    const codeRef = doc(db, 'referCodes', code);
    const existing = await getDoc(codeRef);
    if (!existing.exists()){
      await setDoc(codeRef, { uid: uid });
      return code;
    }
  }
  // 67,600 combinations me 10 baar collision practically nahi hoga,
  // fir bhi ek fallback taaki signup kabhi na atke
  return 'XX' + Math.floor(Math.random() * 90 + 10);
}

/* Naye user ke liye Firestore me profile document banata hai
   (wallet balance 0 se start hoti hai). Agar document pehle se
   hai (purana user), to kuch overwrite nahi karta.
   extra.referredBy   — Partner Program link (?ref=uid) se aaya to
   extra.referCode    — Refer System link (?rc=CODE) se aaya to,
                         is CODE ka asli owner "referredByUid" bhanta hai */
async function ensureUserProfile(user, extra = {}){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    const myReferCode = await assignUniqueReferCode(user.uid);

    let referredByUid = null;
    if (extra.referCode){
      const codeSnap = await getDoc(doc(db, 'referCodes', extra.referCode.toUpperCase()));
      if (codeSnap.exists()){
        referredByUid = codeSnap.data().uid;
      }
    }

    await setDoc(ref, {
      email: user.email || "",
      name: extra.name || user.displayName || "",
      whatsapp: extra.whatsapp || "",
      referredBy: extra.referredBy || null,
      referCode: myReferCode,
      referredByUid: referredByUid,
      firstDepositDone: false,
      walletBalance: 0,
      isPartner: false,
      partnerBalance: 0,
      referBalance: 0,
      createdAt: new Date().toISOString()
    });
  }
}

/* Har successful login pe "kab last login hua" record karta hai
   (Admin Panel ke Analytics me "Login Activity" isi se banti hai). */
function trackLogin(user){
  const ref = doc(db, "users", user.uid);
  setDoc(ref, { lastLogin: new Date().toISOString() }, { merge: true }).catch(function(){});
}

export async function signupWithEmail(email, password, name, whatsapp, referredBy, referCode){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name){
    await updateProfile(cred.user, { displayName: name });
  }
  await ensureUserProfile(cred.user, { name: name || "", whatsapp: whatsapp || "", referredBy: referredBy || null, referCode: referCode || null });
  return cred.user;
}

export async function loginWithEmail(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  trackLogin(cred.user);
  return cred.user;
}

export async function loginWithGoogle(referredBy, referCode){
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  await ensureUserProfile(cred.user, { referredBy: referredBy || null, referCode: referCode || null });
  trackLogin(cred.user);
  return cred.user;
}

export function resetPassword(email){
  return sendPasswordResetEmail(auth, email);
}

export function logout(){
  return signOut(auth);
}

/* callback(user) — user null hoga agar logged out hai.
   Kisi bhi page pe login-status check karne ke liye ye use hoga. */
export function watchAuthState(callback){
  return onAuthStateChanged(auth, callback);
}
