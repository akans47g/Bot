/* =================================================================
   AUTH.JS — Login, Sign Up, Google Sign-In, Logout, Password Reset
   =================================================================
   ⚠️ BUG-FIX NOTE: Email/Password se signup karne ke turant baad,
   naye account ka auth token Firestore ke liye kabhi-kabhi turant
   "ready" nahi hota (ek chhota sa timing gap) — isse profile
   Firestore me create hone se PEHLE hi silently fail ho sakta tha.
   (Google Sign-In me ye dikkat nahi aati, uska token turant ready
   rehta hai.) Do fixes:
   1. Signup ke turant baad token FORCE-REFRESH karte hain.
   2. Profile create fail ho to ek baar 1.2 second baad RETRY.
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
   ⚠️ Ye function ab EXPORT hai — kisi bhi page pe agar user ka
   profile missing mile (jaise purane broken signup ki wajah se),
   to wahan se bhi call karke self-heal kiya jaa sakta hai. */
export async function ensureUserProfile(user, extra = {}){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    let myReferCode = null;
    try{
      myReferCode = await assignUniqueReferCode(user.uid);
    } catch(e){
      console.warn('Refer code generate nahi ho paya, baad me khud ban jaayega', e);
    }

    let referredBy = null;
    if (extra.partnerCode){
      try{
        const codeSnap = await getDoc(doc(db, 'partnerCodes', extra.partnerCode.toUpperCase()));
        if (codeSnap.exists()){
          referredBy = codeSnap.data().uid;
        }
      } catch(e){
        console.warn('Partner code lookup fail hua', e);
      }
    }

    let referredByUid = null;
    if (extra.referCode){
      try{
        const codeSnap = await getDoc(doc(db, 'referCodes', extra.referCode.toUpperCase()));
        if (codeSnap.exists()){
          referredByUid = codeSnap.data().uid;
        }
      } catch(e){
        console.warn('Refer code lookup fail hua', e);
      }
    }

    const profileData = {
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
    };

    // MAIN profile write — agar auth token timing ki wajah se pehli
    // baar fail ho jaaye, to thoda ruk ke ek baar retry karte hain,
    // taaki koi bhi naya signup silently broken na reh jaaye.
    try{
      await setDoc(ref, profileData);
    } catch(e){
      console.warn('Profile create pehli baar fail hua, 1.2s baad retry kar rahe hain...', e);
      await new Promise(function(resolve){ setTimeout(resolve, 1200); });
      await setDoc(ref, profileData);
    }
  }
}

/* Har successful login pe "kab last login hua" record karta hai. */
function trackLogin(user){
  const ref = doc(db, "users", user.uid);
  setDoc(ref, { lastLogin: new Date().toISOString() }, { merge: true }).catch(function(){});
}

export async function signupWithEmail(email, password, name, whatsapp, partnerCode, referCode){
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  // ⚠️ FIX: naya account banne ke turant baad token FORCE-REFRESH
  // karte hain, taaki Firestore rules ko fresh/ready auth turant
  // dikhe — isse email/password signup ka race-condition bug fix
  // hota hai.
  try{
    await cred.user.getIdToken(true);
  } catch(e){
    console.warn('Token refresh fail hua, aage badh rahe hain', e);
  }

  if (name){
    await updateProfile(cred.user, { displayName: name });
  }
  await ensureUserProfile(cred.user, { name: name || "", whatsapp: whatsapp || "", partnerCode: partnerCode || null, referCode: referCode || null });
  trackLogin(cred.user);
  return cred.user;
}

export async function loginWithEmail(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  // ⚠️ Self-heal: agar ye account purana hai aur kisi wajah se
  // (jaise wahi token-timing bug) iska Firestore profile kabhi bana
  // hi nahi tha, to ye yahan turant bana dega. Agar profile pehle
  // se hai to ensureUserProfile kuch nahi karta (harmless).
  try{
    await ensureUserProfile(cred.user);
  } catch(e){
    console.warn('Profile self-heal check fail hua', e);
  }
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

/* callback(user) — user null hoga agar logged out hai. */
export function watchAuthState(callback){
  return onAuthStateChanged(auth, callback);
}
