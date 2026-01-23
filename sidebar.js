document.addEventListener("DOMContentLoaded", () => {
  const role = localStorage.getItem("role");

  if (!role) return;

  document.querySelectorAll(".menu li[data-role]").forEach(item => {
    const allowedRoles = item.dataset.role.split(" ");
    if (allowedRoles.includes(role)) {
      item.style.display = "block";
    }
  });

  const menuBtn = document.querySelector(".menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      document.querySelector(".sidebar")?.classList.toggle("collapsed");
      document.querySelector(".topbar")?.classList.toggle("collapsed");
      document.querySelector(".content")?.classList.toggle("collapsed");
    });
  }
});