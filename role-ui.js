document.addEventListener("DOMContentLoaded", () => {
    const role      = localStorage.getItem("role");
    const roleLabel = document.getElementById("userRoleLabel");

    if (!role) return;

    /* ── Display name in topbar ── */
    if (roleLabel) {
        const roleMap = {
            superadmin : "Super Admin",
            admin      : "Admin",
            manager    : "Manager",
            inspector  : "Inspector",
            delivery   : "Delivery Staff"
        };
        roleLabel.textContent = roleMap[role] || "User";
    }

    /* ── Hide Trends section for delivery role ──
       The Trends <section> must have id="trendsPanelSection"
       (already added in the updated AnalyticsReporting.html)
    ── */
    if (role === "delivery") {
        const trendsSection = document.getElementById("trendsPanelSection");
        if (trendsSection) {
            trendsSection.style.display = "none";
        }
    }
});