/* ======================
   SIGN UP
====================== */
document.addEventListener("DOMContentLoaded", () => {
  const signupForm = document.getElementById("signupForm");

  if (!signupForm) return;

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    console.log("🟡 Signup form submitted");

    const data = {
      fullName: document.getElementById("fullName").value,
      email: document.getElementById("signupEmail").value,
      phone: document.getElementById("phone").value,
      address: document.getElementById("address").value,
      role: document.getElementById("role").value,
      password: document.getElementById("signupPassword").value
    };

    console.log("🟡 Sending data:", data);

    if (
      document.getElementById("signupPassword").value !==
      document.getElementById("confirmPassword").value
    ) {
      alert("Passwords do not match");
      return;
    }

    try {
      const res = await fetch("http://localhost:3000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const result = await res.json();
      console.log("🟢 Server response:", result);

      if (res.ok) {
        alert("Account created successfully!");
        window.location.href = "Login.html";
      } else {
        alert(result.error || "Registration failed");
      }

    } catch (err) {
      console.error("❌ FETCH ERROR:", err);
      alert("Cannot connect to server");
    }
  });
});

/* ======================
   LOGIN
====================== */
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      const res = await fetch("http://localhost:3000/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("loginEmail").value,
          password: document.getElementById("loginPassword").value
        })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error);
        return;
      }

      // ✅ SAVE EXACT KEYS YOUR PROFILE PAGE EXPECTS
      localStorage.setItem("userId", data.id);
      localStorage.setItem("userFullName", data.fullName);
      localStorage.setItem("userRole", data.role);

      // Redirect by role (fixed for multiple roles)
      const roles = data.role.split(",").map(r => r.trim()); // split and trim

      if (roles.includes("superadmin") || roles.includes("admin") || roles.includes("manager")) {
          window.location.href = "Dashboard.html";
      } else if (roles.includes("inspector")) {
          window.location.href = "InspectorDashboard.html";
      } else if (roles.includes("delivery")) {
          window.location.href = "DeliveryDashboard.html";
      } else {
          alert("Unknown role. Contact admin.");
      }

    } catch (err) {
      console.error(err);
      alert("Login failed");
    }
  });
}
