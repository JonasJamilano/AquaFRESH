import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ======================
   SIGN UP
====================== */
const signupForm = document.getElementById("signupForm");

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("fullName").value;
    const email = document.getElementById("signupEmail").value;
    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      alert("❌ Passwords do not match");
      return;
    }

    try {
      // Create user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = userCredential.user;

      // Save user data in Firestore (ADMIN for now)
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        fullName: fullName,
        email: email,
        role: "admin",        // TEMPORARY
        status: "active",
        createdAt: serverTimestamp()
      });

      alert("✅ Registered successfully!");
      window.location.href = "Login.html";

    } catch (error) {
      alert(error.message);
    }
  });
}

/* ======================
   LOGIN
====================== */
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    try {
      await signInWithEmailAndPassword(auth, email, password);

      // Login successful → go to dashboard
      window.location.href = "Dashboard.html";

    } catch (error) {
      alert("❌ Invalid email or password");
    }
  });
}