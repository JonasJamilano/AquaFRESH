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

    const navToggle = document.getElementById("nav-toggle");
    const menuBtn   = document.querySelector(".menu-btn");

    if (menuBtn && navToggle) {
        // Remove the label's default checkbox-toggling behaviour on desktop
        // so we can handle desktop collapse ourselves via classList
        menuBtn.addEventListener("click", (e) => {
            if (window.innerWidth > 768) {
                // Desktop: prevent the label from toggling the checkbox
                // and instead toggle the collapsed class
                e.preventDefault();
                navToggle.checked = false;
                document.querySelector(".sidebar")?.classList.toggle("collapsed");
                document.querySelector(".topbar")?.classList.toggle("collapsed");
                document.querySelector(".content")?.classList.toggle("collapsed");
            }
            // Mobile: do NOT call preventDefault — let the label
            // naturally toggle the checkbox so CSS drawer works
        });
    }

    // Close sidebar when a nav link is tapped on mobile
    document.querySelectorAll(".menu li a").forEach(link => {
        link.addEventListener("click", () => {
            if (window.innerWidth <= 768 && navToggle) {
                navToggle.checked = false;
            }
        });
    });
});