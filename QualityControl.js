import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const inspectionsCol = collection(db, "inspections");
const batchesCol = collection(db, "batches");

/* ==========================
   Helper: Collect Criteria
========================== */
function getCriteriaData() {
  const rows = document.querySelectorAll("#new-inspection-tbody tr");

  return Array.from(rows).map(row => ({
    criteriaName: row.querySelector(".criteria-select").dataset.criteria,
    assessment: row.querySelector(".criteria-select").value,
    remarks: row.querySelector(".criteria-remarks").value || ""
  }));
}

/* ==========================
   Calculate Score
========================== */
function calculateScore() {
  const scoreMap = { Excellent: 100, Acceptable: 50, Rejected: 0 };

  let sensoryTotal = 0;
  document.querySelectorAll(".criteria-select").forEach(sel => {
    sensoryTotal += scoreMap[sel.value];
  });

  const sensoryAverage = sensoryTotal / 4;

  const temp = parseFloat(document.getElementById("temperature").value) || 0;
  const tempScore = temp <= 4 ? 100 : temp <= 8 ? 50 : 0;

  const ph = parseFloat(document.getElementById("ph-level").value) || 0;
  const phScore =
    ph >= 6.5 && ph <= 6.8
      ? 100
      : (ph >= 6 && ph < 6.5) || (ph > 6.8 && ph <= 7.2)
      ? 50
      : 0;

  const finalScore = Math.round(
    sensoryAverage * 0.5 + tempScore * 0.25 + phScore * 0.25
  );

  let classification = "Rejected";
  let className = "danger";

  if (finalScore >= 80) {
    classification = "Passed";
    className = "success";
  } else if (finalScore >= 50) {
    classification = "With Issues";
    className = "warning";
  }

  document.getElementById("live-score").textContent = finalScore;
  document.getElementById("live-classification").className =
    "status " + className;
  document.getElementById("live-classification").innerHTML =
    classification;

  return { finalScore, classification };
}

/* Live score binding */
document.addEventListener("change", calculateScore);
document.addEventListener("input", calculateScore);
calculateScore();

/* ==========================
   SAVE INSPECTION
========================== */
document
  .getElementById("save-inspection-btn")
  .addEventListener("click", async () => {
    const batchCode = document.getElementById("batch-code").value.trim();
    const productType = document.getElementById("product-type").value.trim();
    const location = document.getElementById("inspection-location").value.trim();
    const inspectorName =
      localStorage.getItem("userFullName") || "Unknown";

    if (!batchCode || !productType || !location) {
      alert("Fill required fields.");
      return;
    }

    const criteria = getCriteriaData();
    const { finalScore, classification } = calculateScore();

    try {
      /* ---- Create batch if not exists ---- */
      const batchQuery = query(
        batchesCol,
        where("batchCode", "==", batchCode)
      );
      const batchSnapshot = await getDocs(batchQuery);

      let batchId;

      if (batchSnapshot.empty) {
        const newBatch = await addDoc(batchesCol, {
          batchCode,
          productType,
          location,
          createdAt: serverTimestamp()
        });
        batchId = newBatch.id;
      } else {
        batchId = batchSnapshot.docs[0].id;
      }

      /* ---- Save inspection ---- */
      await addDoc(inspectionsCol, {
        batchId,
        batchCode,
        productType,
        location,
        inspectorName,
        inspectorId: localStorage.getItem("userId"),
        temperature: parseFloat(document.getElementById("temperature").value),
        phLevel: parseFloat(document.getElementById("ph-level").value),
        score: finalScore,
        overallStatus: classification,
        criteria,
        createdAt: serverTimestamp()
      });

      alert("Inspection saved!");
      resetForm();
      loadInspections();

    } catch (err) {
      console.error(err);
      alert("Error saving inspection.");
    }
  });

/* ==========================
   RESET FORM
========================== */
function resetForm() {
  document.getElementById("batch-code").value = "";
  document.getElementById("product-type").value = "";
  document.getElementById("inspection-location").value = "";
  document.getElementById("temperature").value = "4.0";
  document.getElementById("ph-level").value = "6.5";
  document
    .querySelectorAll(".criteria-select")
    .forEach(sel => (sel.value = "Excellent"));
  document
    .querySelectorAll(".criteria-remarks")
    .forEach(inp => (inp.value = ""));
  calculateScore();
}

/* ==========================
   LOAD INSPECTIONS
========================== */
async function loadInspections() {
  const snapshot = await getDocs(inspectionsCol);

  const todayBody = document.getElementById("inspections-today-body");
  const passedBody = document.getElementById("passed-body");
  const issuesBody = document.getElementById("issues-body");
  const rejectedBody = document.getElementById("rejected-body");

  todayBody.innerHTML = "";
  passedBody.innerHTML = "";
  issuesBody.innerHTML = "";
  rejectedBody.innerHTML = "";

  let passed = 0,
    issues = 0,
    rejected = 0;

  snapshot.forEach(docSnap => {
    const d = docSnap.data();

    const rowHTML = `
      <tr>
        <td><strong>${d.batchCode}</strong></td>
        <td>${d.productType}</td>
        <td>${d.location}</td>
        <td>${d.overallStatus}</td>
      </tr>
    `;

    todayBody.innerHTML += rowHTML;

    if (d.overallStatus === "Passed") {
      passedBody.innerHTML += rowHTML;
      passed++;
    } else if (d.overallStatus === "With Issues") {
      issuesBody.innerHTML += rowHTML;
      issues++;
    } else {
      rejectedBody.innerHTML += rowHTML;
      rejected++;
    }
  });

  document.getElementById("inspections-today-count").textContent =
    snapshot.size;
  document.getElementById("passed-count").textContent = passed;
  document.getElementById("issues-count").textContent = issues;
  document.getElementById("rejected-count").textContent = rejected;
}

loadInspections();