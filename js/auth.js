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
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

/* Naye user ke liye Firestore me profile document banata hai
   (wallet balance 0 se start hoti hai). Agar document pehle se
   hai (purana user), to kuch overwrite nahi karta. */
async function ensureUserProfile(user){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, {
      email: user.email || "",
      name: user.displayName || "",
      walletBalance: 0,
      createdAt: new Date().toISOString()
    });
  }
}

export async function signupWithEmail(email, password){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserProfile(cred.user);
  return cred.user;
}

export async function loginWithEmail(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function loginWithGoogle(){
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  await ensureUserProfile(cred.user);
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
