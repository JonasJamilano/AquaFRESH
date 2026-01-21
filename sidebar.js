import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "Login.html";
    return;
  }

  const userDoc = await getDoc(doc(db, "users", user.uid));

  if (!userDoc.exists()) {
    alert("User profile not found");
    await auth.signOut();
    window.location.href = "Login.html";
    return;
  }

  const role = userDoc.data().role;
  localStorage.setItem("role", role);

  // 🔒 Role-based sidebar filtering
  document.querySelectorAll("[data-role]").forEach(item => {
    const allowedRoles = item.dataset.role.split(" ");
    item.style.display = allowedRoles.includes(role) ? "block" : "none";
  });

  // Sidebar toggle (ONLY ONE PLACE)
  const menuBtn = document.querySelector(".menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      document.querySelector(".sidebar")?.classList.toggle("collapsed");
      document.querySelector(".topbar")?.classList.toggle("collapsed");
      document.querySelector(".content")?.classList.toggle("collapsed");
    });
  }
});