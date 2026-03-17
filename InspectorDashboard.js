import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async () => {
  setupModals();
  await loadInspectorDashboard();
});

async function loadInspectorDashboard() {

  try {

    const q = query(collection(db, "inspections"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    const today = new Date();
    today.setHours(0,0,0,0);

    let todayCount = 0, passed = 0, issues = 0, rejected = 0;

    const pendingList = document.getElementById("pending-inspections");

    const todayBody = document.getElementById("today-body");
    const passedBody = document.getElementById("passed-body");
    const issuesBody = document.getElementById("issues-body");
    const rejectedBody = document.getElementById("rejected-body");

    // SAFE RESET
    if (pendingList) pendingList.innerHTML = "";
    if (todayBody) todayBody.innerHTML = "";
    if (passedBody) passedBody.innerHTML = "";
    if (issuesBody) issuesBody.innerHTML = "";
    if (rejectedBody) rejectedBody.innerHTML = "";

    snapshot.forEach(docSnap => {

      const d = docSnap.data();
      const createdAt = d.createdAt?.toDate?.();

      if (!createdAt) return; // skip invalid data

      const time = formatDate(d.createdAt);

      const row = `
        <tr>
          <td><strong>${d.batchCode || "-"}</strong></td>
          <td>${d.productType || "Fish"}</td>
          <td>${d.location || "-"}</td>
          <td>${d.overallStatus || "-"}</td>
          <td>${time}</td>
        </tr>
      `;

      // TODAY
      if (createdAt >= today) {
        todayCount++;
        if (todayBody) todayBody.innerHTML += row;
      }

      // STATUS
      if (d.overallStatus === "Passed") {
        passed++;
        if (passedBody) passedBody.innerHTML += row;
      }
      else if (d.overallStatus === "With Issues") {
        issues++;
        if (issuesBody) issuesBody.innerHTML += row;
      }
      else if (d.overallStatus === "Rejected") {
        rejected++;
        if (rejectedBody) rejectedBody.innerHTML += row;
      }

      // PENDING
      if (d.overallStatus !== "Passed" && pendingList) {

        const li = document.createElement("li");

        li.innerHTML = `
          <div class="task-card">
            <div>
              <strong>${d.batchCode}</strong>
              <div class="task-sub">${d.productType || "Fish"} • ${d.location}</div>
            </div>
            <span class="task-status ${getStatusClass(d.overallStatus)}">
              ${d.overallStatus}
            </span>
          </div>
        `;

        pendingList.appendChild(li);
      }

    });

    // UPDATE COUNTS
    document.getElementById("inspections-today").textContent = todayCount;
    document.getElementById("passed-count").textContent = passed;
    document.getElementById("issues-count").textContent = issues;
    document.getElementById("rejected-count").textContent = rejected;

    // EMPTY STATE
    // EMPTY STATE FOR MODALS
    if (todayBody && !todayBody.innerHTML) {
      todayBody.innerHTML = `<tr><td colspan="5">No inspections today</td></tr>`;
    }

    if (passedBody && !passedBody.innerHTML) {
      passedBody.innerHTML = `<tr><td colspan="5">No passed records</td></tr>`;
    }

    if (issuesBody && !issuesBody.innerHTML) {
      issuesBody.innerHTML = `<tr><td colspan="5">No issues records</td></tr>`;
    }

    if (rejectedBody && !rejectedBody.innerHTML) {
      rejectedBody.innerHTML = `<tr><td colspan="5">No rejected records</td></tr>`;
    }

  } catch (error) {
    console.error("🔥 Inspector Dashboard Error:", error);
  }

}

/* ================= MODALS ================= */

function setupModals() {

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add("active");
      document.body.style.overflow = "hidden";
    }
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove("active");
      document.body.style.overflow = "";
    }
  }

  document.getElementById("btn-today")?.addEventListener("click", () => openModal("modal-today"));
  document.getElementById("btn-passed")?.addEventListener("click", () => openModal("modal-passed"));
  document.getElementById("btn-issues")?.addEventListener("click", () => openModal("modal-issues"));
  document.getElementById("btn-rejected")?.addEventListener("click", () => openModal("modal-rejected"));

  document.querySelectorAll(".qc-modal-close").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  document.querySelectorAll(".qc-modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

}

/* ================= HELPERS ================= */

function formatDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "--";

  return timestamp.toDate().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function getStatusClass(status) {
  if (status === "Passed") return "success";
  if (status === "With Issues") return "warning";
  return "danger";
}