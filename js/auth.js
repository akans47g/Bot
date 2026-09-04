/* =================================================================
   AUTH.JS — Login, Sign Up, Google Sign-In, Logout, Password Reset
   =================================================================
   Ye file firebase-init.js se auth/db leke, saara login logic
   ready-made functions me deti hai. login.html (aur baad me
   account.html, index.html) inhi functions ko use karenge.
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

/* ---------- REFER CODE — 4 char: 2 letters (A-Z) + 2 digits (0-9), jaise "MK07" ---------- */
function generateReferCode(){
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l1 = letters[Math.floor(Math.random() * 26)];
  const l2 = letters[Math.floor(Math.random() * 26)];
  const n1 = Math.floor(Math.random() * 10);
  const n2 = Math.floor(Math.random() * 10);
  return l1 + l2 + n1 + n2;
}

export async function assignUniqueReferCode(uid){
  for (let attempt = 0; attempt < 10; attempt++){
    const code = generateReferCode();
    const codeRef = doc(db, 'referCodes', code);
    const existing = await getDoc(codeRef);
    if (!existing.exists()){
      await setDoc(codeRef, { uid: uid });
      return code;
    }
  }
  return 'XX' + Math.floor(Math.random() * 90 + 10); // extremely unlikely fallback
}

/* ---------- PARTNER CODE — 3 char: 1 letter (A-Z) + 2 digits (0-9), jaise "M04" ---------- */
function generatePartnerCode(){
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l1 = letters[Math.floor(Math.random() * 26)];
  const n1 = Math.floor(Math.random() * 10);
  const n2 = Math.floor(Math.random() * 10);
  return l1 + n1 + n2;
}

export async function assignUniquePartnerCode(uid){
  for (let attempt = 0; attempt < 10; attempt++){
    const code = generatePartnerCode();
    const codeRef = doc(db, 'partnerCodes', code);
    const existing = await getDoc(codeRef);
    if (!existing.exists()){
      await setDoc(codeRef, { uid: uid });
      return code;
    }
  }
  return 'X' + Math.floor(Math.random() * 90 + 10); // extremely unlikely fallback
}

/* Naye user ke liye Firestore me profile document banata hai
   (wallet balance 0 se start hoti hai). Agar document pehle se
   hai (purana user), to kuch overwrite nahi karta.
   extra.partnerCode — Partner Program link (?pc=CODE) se aaya to,
                        us CODE ka asli owner "referredBy" bnta hai
   extra.referCode   — Refer System link (?rc=CODE) se aaya to,
                        us CODE ka asli owner "referredByUid" bnta hai */
async function ensureUserProfile(user, extra = {}){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    const myReferCode = await assignUniqueReferCode(user.uid);

    let referredBy = null;
    if (extra.partnerCode){
      const codeSnap = await getDoc(doc(db, 'partnerCodes', extra.partnerCode.toUpperCase()));
      if (codeSnap.exists()){
        referredBy = codeSnap.data().uid;
      }
    }

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
      referredBy: referredBy,
      referCode: myReferCode,
      referredByUid: referredByUid,
      firstDepositDone: false,
      walletBalance: 0,
      isPartner: false,
      partnerCode: null,
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

export async function signupWithEmail(email, password, name, whatsapp, partnerCode, referCode){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name){
    await updateProfile(cred.user, { displayName: name });
  }
  await ensureUserProfile(cred.user, { name: name || "", whatsapp: whatsapp || "", partnerCode: partnerCode || null, referCode: referCode || null });
  return cred.user;
}

export async function loginWithEmail(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  trackLogin(cred.user);
  return cred.user;
}

export async function loginWithGoogle(partnerCode, referCode){
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  await ensureUserProfile(cred.user, { partnerCode: partnerCode || null, referCode: referCode || null });
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
