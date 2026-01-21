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
   SIGN UP (INSPECTOR / DELIVERY)
====================== */
const signupForm = document.getElementById("signupForm");

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // ✅ CORRECT ELEMENT REFERENCES
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const address = document.getElementById("address").value.trim();
    const role = document.getElementById("role").value;
    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    // ✅ VALIDATION
    if (!role) {
      alert("Please select a role");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }

    try {
      // 🔐 CREATE AUTH USER
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // 🧾 SAVE USER PROFILE
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        fullName,
        email,
        phone,
        address,
        role,
        status: "active",
        photoURL: "default-avatar.png",
        createdAt: serverTimestamp()
      });

      alert("✅ Account created successfully!");
      window.location.href = "Login.html";

    } catch (err) {
      alert(err.message);
      console.error(err);
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

    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userSnap = await getDoc(doc(db, "users", cred.user.uid));

      if (!userSnap.exists()) {
        alert("User profile not found");
        return;
      }

      const role = userSnap.data().role;
      localStorage.setItem("role", role);

      if (["superadmin", "admin", "manager"].includes(role)) {
        window.location.href = "Dashboard.html";
      } else if (role === "inspector") {
        window.location.href = "InspectorDashboard.html";
      } else if (role === "delivery") {
        window.location.href = "DeliveryDashboard.html";
      }

    } catch (err) {
      alert("Invalid login credentials");
    }
  });
}