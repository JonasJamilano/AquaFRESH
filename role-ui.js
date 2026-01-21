document.addEventListener("DOMContentLoaded", () => {
  const role = localStorage.getItem("role");
  const roleLabel = document.getElementById("userRoleLabel");

  if (!role || !roleLabel) return;

  const roleMap = {
    superadmin: "Super Admin",
    admin: "Admin",
    manager: "Manager",
    inspector: "Inspector",
    delivery: "Delivery Staff"
  };

  roleLabel.textContent = roleMap[role] || "User";
});