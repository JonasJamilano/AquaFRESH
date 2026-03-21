document.addEventListener("DOMContentLoaded", () => {
    const role = localStorage.getItem("role");

    if (!role) return;

    // Show nav items for this role
    document.querySelectorAll(".menu li[data-role]").forEach(item => {
        const allowedRoles = item.dataset.role.split(" ");
        if (allowedRoles.includes(role)) {
            item.style.display = "block";
        }
    });

    const menuBtn = document.querySelector(".menu-btn");
    if (menuBtn) {
        menuBtn.addEventListener("click", () => {

            // On desktop (> 768px): toggle collapsed sidebar
            // On mobile (≤ 768px): the checkbox/label handles the drawer — do nothing extra
            if (window.innerWidth > 768) {
                document.querySelector(".sidebar")?.classList.toggle("collapsed");
                document.querySelector(".topbar")?.classList.toggle("collapsed");
                document.querySelector(".content")?.classList.toggle("collapsed");
            }
            // Mobile drawer is handled purely by the #nav-toggle checkbox in CSS
        });
    }
});