import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ======================
   SIGN UP (ADMIN ONLY FOR NOW)
====================== */
const signupForm = document.getElementById("signupForm");

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    // ✅ NEW
    const phone = document.getElementById("phone").value.trim();
    const address = document.getElementById("address").value.trim();

    if (password !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        fullName,
        email,
        phone,          // ✅ added
        address,        // ✅ added
        role: "admin",  // TEMP
        status: "active",
        photoURL: "default-avatar.png",
        createdAt: serverTimestamp()
      });

      alert("Account created successfully!");
      window.location.href = "Login.html";

    } catch (err) {
      alert(err.message);
    }
  });
}

/* ======================
   LOGIN + ROLE REDIRECT
====================== */
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = loginForm.loginEmail.value;
    const password = loginForm.loginPassword.value;

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDoc = await getDoc(doc(db, "users", cred.user.uid));

      if (!userDoc.exists()) {
        alert("User profile not found");
        return;
      }

      const role = userDoc.data().role;
      localStorage.setItem("role", role);

      // Role-based redirect
      if (["superadmin", "admin", "manager"].includes(role)) {
        window.location.href = "Dashboard.html";
      } else if (role === "inspector") {
        window.location.href = "InspectorDashboard.html";
      } else if (role === "delivery") {
        window.location.href = "DeliveryDashboard.html";
      }

    } catch {
      alert("Invalid login credentials");
    }
  });
}