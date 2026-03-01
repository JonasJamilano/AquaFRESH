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
   SIGN UP
====================== */
document.addEventListener("DOMContentLoaded", () => {
  const signupForm = document.getElementById("signupForm");

  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const fullName = document.getElementById("fullName").value;
      const email = document.getElementById("signupEmail").value;
      const phone = document.getElementById("phone").value;
      const address = document.getElementById("address").value;
      const role = document.getElementById("role").value;
      const password = document.getElementById("signupPassword").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      if (password !== confirmPassword) {
        alert("Passwords do not match");
        return;
      }

      try {
        // 🔥 Create Auth account
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        const user = userCredential.user;

        // 🔥 Save additional info in Firestore
        await setDoc(doc(db, "users", user.uid), {
          fullName,
          email,
          phone,
          address,
          role,
          status: "active",
          createdAt: serverTimestamp()
        });

        alert("Account created successfully!");
        window.location.href = "Login.html";

      } catch (error) {
        console.error(error);
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
        const userCredential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

        const user = userCredential.user;

        // 🔥 Get user role from Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));

        if (!userDoc.exists()) {
          alert("User profile not found.");
          return;
        }

        const userData = userDoc.data();

        if (userData.status !== "active") {
          alert("Account is inactive.");
          return;
        }

        // Save to localStorage (keep same keys so system works)
        localStorage.setItem("role", userData.role);
        localStorage.setItem("user", userData.fullName);
        localStorage.setItem("userId", user.uid);
        localStorage.setItem("userFullName", userData.fullName);
        localStorage.setItem("userRole", userData.role);

        // Redirect by role
        if (["superadmin", "admin", "manager"].includes(userData.role)) {
          window.location.href = "Dashboard.html";
        } else if (userData.role === "inspector") {
          window.location.href = "InspectorDashboard.html";
        } else {
          window.location.href = "DeliveryDashboard.html";
        }

      } catch (error) {
        console.error(error);
        alert("Invalid email or password.");
      }
    });
  }
});