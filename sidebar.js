document.addEventListener("DOMContentLoaded", () => {
    const menuBtn = document.querySelector(".menu-btn");
    const sidebar = document.querySelector(".sidebar");
    const topbar = document.querySelector(".topbar");
    const content = document.querySelector(".content");

    menuBtn.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
        topbar.classList.toggle("collapsed");
        content.classList.toggle("collapsed");
    });
});