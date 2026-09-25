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
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";


/* ================================================================
   REFER CODE
   Format: 2 letters + 2 numbers
   Example: MK07
================================================================ */

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

      await setDoc(codeRef, {
        uid: uid
      });

      return code;
    }
  }

  return 'XX' + Math.floor(Math.random() * 90 + 10);
}


/* ================================================================
   PARTNER CODE
   Format: 1 letter + 2 numbers
   Example: M04
================================================================ */

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

      await setDoc(codeRef, {
        uid: uid
      });

      return code;
    }
  }

  return 'X' + Math.floor(Math.random() * 90 + 10);
}


/* ================================================================
   ENSURE USER PROFILE
================================================================

   Har authenticated user ke liye:

   users/{Firebase UID}

   document hona zaroori hai.

   Agar document already exist karta hai:
   → existing data ko overwrite nahi karega.

   Agar document missing hai:
   → complete profile create karega.

================================================================ */

async function ensureUserProfile(user, extra = {}){

  const ref = doc(db, "users", user.uid);

  const snap = await getDoc(ref);


  /* --------------------------------------------------------------
     Existing user
     -------------------------------------------------------------- */

  if (snap.exists()){
    return;
  }


  /* --------------------------------------------------------------
     New / missing profile
     -------------------------------------------------------------- */

  let myReferCode = null;


  /* Generate unique referral code */

  try{

    myReferCode = await assignUniqueReferCode(user.uid);

  } catch(e){

    console.warn(
      'Refer code generate nahi ho paya.',
      e
    );
  }


  /* --------------------------------------------------------------
     Partner referral
  -------------------------------------------------------------- */

  let referredBy = null;

  if (extra.partnerCode){

    try{

      const codeSnap = await getDoc(
        doc(
          db,
          'partnerCodes',
          extra.partnerCode.toUpperCase()
        )
      );

      if (codeSnap.exists()){

        referredBy = codeSnap.data().uid;
      }

    } catch(e){

      console.warn(
        'Partner code lookup fail hua.',
        e
      );
    }
  }


  /* --------------------------------------------------------------
     Normal referral
  -------------------------------------------------------------- */

  let referredByUid = null;

  if (extra.referCode){

    try{

      const codeSnap = await getDoc(
        doc(
          db,
          'referCodes',
          extra.referCode.toUpperCase()
        )
      );

      if (codeSnap.exists()){

        referredByUid = codeSnap.data().uid;
      }

    } catch(e){

      console.warn(
        'Refer code lookup fail hua.',
        e
      );
    }
  }


  /* --------------------------------------------------------------
     MAIN USER PROFILE
  --------------------------------------------------------------

     Ye write mandatory hai.

     Agar ye fail hota hai to error caller tak jayega.
     Login/signup silently successful nahi maana jayega.
  */

  await setDoc(ref, {

    email: user.email || "",

    name:
      extra.name ||
      user.displayName ||
      "",

    whatsapp:
      extra.whatsapp ||
      "",

    referredBy:
      referredBy,

    referCode:
      myReferCode,

    referredByUid:
      referredByUid,

    firstDepositDone:
      false,

    walletBalance:
      0,

    isPartner:
      false,

    partnerCode:
      null,

    partnerBalance:
      0,

    referBalance:
      0,

    createdAt:
      new Date().toISOString()

  });
}


/* ================================================================
   TRACK LAST LOGIN
================================================================ */

function trackLogin(user){

  const ref = doc(
    db,
    "users",
    user.uid
  );

  setDoc(
    ref,
    {
      lastLogin:
        new Date().toISOString()
    },
    {
      merge: true
    }
  ).catch(function(error){

    console.warn(
      "Last login update failed:",
      error
    );

  });
}


/* ================================================================
   EMAIL SIGNUP
================================================================ */

export async function signupWithEmail(
  email,
  password,
  name,
  whatsapp,
  partnerCode,
  referCode
){

  /* Create Firebase Authentication account */

  const cred =
    await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );


  /* Force-refresh authentication token */

  await cred.user.getIdToken(true);


  /* Save display name in Firebase Auth */

  if (name){

    await updateProfile(
      cred.user,
      {
        displayName: name
      }
    );
  }


  /* --------------------------------------------------------------
     VERY IMPORTANT

     Firestore profile MUST be created before redirect.
  -------------------------------------------------------------- */

  await ensureUserProfile(
    cred.user,
    {
      name:
        name || "",

      whatsapp:
        whatsapp || "",

      partnerCode:
        partnerCode || null,

      referCode:
        referCode || null
    }
  );


  return cred.user;
}


/* ================================================================
   EMAIL LOGIN
================================================================

   IMPORTANT FIX:

   Pehle ensureUserProfile() error catch ho raha tha aur
   login successful return ho raha tha.

   Ab:

   Firebase Auth Login
          ↓
   ensureUserProfile()
          ↓
   trackLogin()
          ↓
   return user
          ↓
   login.html redirect

   Agar Firestore profile creation fail hota hai,
   error caller tak jayega.
================================================================ */

export async function loginWithEmail(
  email,
  password
){

  const cred =
    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );


  /* --------------------------------------------------------------
     Profile MUST exist before login flow finishes.
  -------------------------------------------------------------- */

  await ensureUserProfile(
    cred.user
  );


  /* Record last login */

  trackLogin(
    cred.user
  );


  return cred.user;
}


/* ================================================================
   GOOGLE LOGIN
================================================================ */

export async function loginWithGoogle(
  partnerCode,
  referCode
){

  const provider =
    new GoogleAuthProvider();


  const cred =
    await signInWithPopup(
      auth,
      provider
    );


  /* Ensure Firestore profile */

  await ensureUserProfile(
    cred.user,
    {
      partnerCode:
        partnerCode || null,

      referCode:
        referCode || null
    }
  );


  /* Record last login */

  trackLogin(
    cred.user
  );


  return cred.user;
}


/* ================================================================
   PASSWORD RESET
================================================================ */

export function resetPassword(email){

  return sendPasswordResetEmail(
    auth,
    email
  );
}


/* ================================================================
   LOGOUT
================================================================ */

export function logout(){

  return signOut(
    auth
  );
}


/* ================================================================
   AUTH STATE LISTENER
================================================================

   NOTE:

   Ye function delete nahi kiya gaya hai.

   Account/index/other pages agar isko use kar rahe hain
   to unki functionality break nahi hogi.

   login.html me automatic redirect ke liye ab ise use nahi
   kiya jayega.
================================================================ */

export function watchAuthState(callback){

  return onAuthStateChanged(
    auth,
    callback
  );
}
