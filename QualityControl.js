import { db } from "./firebase.js";
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    serverTimestamp,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
// Read the logged-in user's full name directly from localStorage
// (set by auth.js on login as "userFullName")
const currentInspectorName = localStorage.getItem("userFullName") || "Unknown";


// ==========================
// Helper: Collect Criteria Data
// ==========================
// Previously used .closest("section") which broke when the form moved into a modal.
// Now queries directly from the modal by ID.
function getCriteriaData() {
    const rows = document.querySelectorAll("#new-inspection-tbody tr");

    return Array.from(rows).map(row => ({
        criteriaName: row.querySelector(".criteria-select").dataset.criteria,
        assessment:   row.querySelector(".criteria-select").value,
        remarks:      row.querySelector(".criteria-remarks").value.trim() || ""
    }));
}


// ==========================
// Calculate Freshness Score
// ==========================
function calculateScore() {
    const scoreMap = { "Excellent": 100, "Acceptable": 50, "Rejected": 0 };

    let sensoryTotal = 0;
    document.querySelectorAll(".criteria-select").forEach(sel => {
        sensoryTotal += scoreMap[sel.value] ?? 0;
    });
    const sensoryAverage = sensoryTotal / 4;

    const tempValue = parseFloat(document.getElementById("temperature").value) || 0;
    const tempScore = tempValue <= 4.0 ? 100 : (tempValue <= 8.0 ? 50 : 0);

    const phValue = parseFloat(document.getElementById("ph-level").value) || 0;
    const phScore =
        (phValue >= 6.5 && phValue <= 6.8) ? 100 :
        ((phValue >= 6.0 && phValue < 6.5) || (phValue > 6.8 && phValue <= 7.2)) ? 50 : 0;

    const finalScore = Math.round(
        (sensoryAverage * 0.50) +
        (tempScore      * 0.25) +
        (phScore        * 0.25)
    );

    let classification, statusClass, iconHTML;

    if (finalScore >= 80) {
        classification = "Passed";
        statusClass    = "success";
        iconHTML       = '<i class="fa-solid fa-check"></i> ';
    } else if (finalScore >= 50) {
        classification = "With Issues";
        statusClass    = "warning";
        iconHTML       = '<i class="fa-solid fa-triangle-exclamation"></i> ';
    } else {
        classification = "Rejected";
        statusClass    = "danger";
        iconHTML       = '<i class="fa-solid fa-circle-xmark"></i> ';
    }

    document.getElementById("live-score").textContent = finalScore;
    const classEl = document.getElementById("live-classification");
    classEl.innerHTML   = iconHTML + classification;
    classEl.className   = "status " + statusClass;

    return { finalScore, classification };
}


// ==========================
// Bind Live Score Calculation
// ==========================
// Use event delegation on document so it works whether the modal
// is open or closed (elements exist in DOM but may be hidden).
document.addEventListener("change", e => {
    if (
        e.target.matches(".criteria-select") ||
        e.target.matches("#temperature") ||
        e.target.matches("#ph-level")
    ) {
        calculateScore();
    }
});

document.addEventListener("input", e => {
    if (
        e.target.matches("#temperature") ||
        e.target.matches("#ph-level")
    ) {
        calculateScore();
    }
});

// Run once on load so the widget shows the default score
document.addEventListener("DOMContentLoaded", () => {
    calculateScore();
});


// ==========================
// Save Inspection (Firestore)
// ==========================
document.getElementById("save-inspection-btn")
    .addEventListener("click", async () => {

        const batchCode  = document.getElementById("batch-code").value.trim();
        const productType = document.getElementById("product-type").value.trim();
        const location   = document.getElementById("inspection-location").value.trim();

        if (!batchCode || !productType || !location) {
            alert("Please fill in all required fields: Batch ID, Product Type, and Location.");
            return;
        }

        const criteria               = getCriteriaData();
        const { finalScore, classification } = calculateScore();

        const temperature = parseFloat(document.getElementById("temperature").value);
        const phLevel     = parseFloat(document.getElementById("ph-level").value);

        const inspectorName = currentInspectorName;

        try {
            await addDoc(collection(db, "qualityControl"), {
                batchCode,
                productType,
                location,
                inspectorName,
                criteria,
                temperature,
                phLevel,
                score:         finalScore,
                overallStatus: classification,
                createdAt:     serverTimestamp()
            });

            alert("Inspection saved successfully!");

            // Reset form fields
            resetInspectionForm();

            // Refresh all tables so new data appears immediately
            await loadInspectionsToday();
            await loadInspectionsByStatus();

        } catch (error) {
            console.error("Firestore save error:", error);
            alert("Failed to save inspection. Check console for details.");
        }
    });


// ==========================
// Clear Form Button
// ==========================
document.getElementById("add-inspection-btn")
    .addEventListener("click", () => {
        resetInspectionForm();
    });


// ==========================
// Reset Form
// ==========================
function resetInspectionForm() {
    document.getElementById("batch-code").value          = "";
    document.getElementById("inspection-location").value = "";
    document.getElementById("product-type").value        = "";
    document.getElementById("temperature").value         = "4.0";
    document.getElementById("ph-level").value            = "6.5";

    document.querySelectorAll(".criteria-select")
        .forEach(sel => sel.value = "Excellent");

    document.querySelectorAll(".criteria-remarks")
        .forEach(inp => inp.value = "");

    // Recalculate score to reset the live widget back to 100/Passed
    calculateScore();
}


// ==========================
// Status Badge Helper
// ==========================
function getStatusBadgeHTML(status) {
    if (status === "Passed")
        return `<span class="status success"><i class="fa-solid fa-check"></i> Passed</span>`;
    if (status === "With Issues")
        return `<span class="status warning"><i class="fa-solid fa-triangle-exclamation"></i> With Issues</span>`;
    if (status === "Rejected")
        return `<span class="status danger"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`;
    return `<span>${status}</span>`;
}


// ==========================
// Format Timestamp Helper
// ==========================
function formatDate(timestamp) {
    if (!timestamp) return "—";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString("en-PH", {
        month:  "short",
        day:    "numeric",
        year:   "numeric",
        hour:   "numeric",
        minute: "2-digit",
        hour12: true
    });
}


// ==========================
// Load Today's Inspections
// ==========================
async function loadInspectionsToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        const q = query(
            collection(db, "qualityControl"),
            where("createdAt", ">=", today),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        const tbody    = document.getElementById("inspections-today-body");
        tbody.innerHTML = "";

        snapshot.forEach(doc => {
            const r  = doc.data();
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${r.batchCode   ?? ""}</strong></td>
                <td>${r.inspectorName       ?? "—"}</td>
                <td>${r.location            ?? ""}</td>
                <td>${r.productType         ?? ""}</td>
                <td>${formatDate(r.createdAt)}</td>
                <td class="text-right">${getStatusBadgeHTML(r.overallStatus)}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById("inspections-today-count").textContent = snapshot.size;

    } catch (error) {
        console.error("Error loading today's inspections:", error);
    }
}


// ==========================
// Load Inspections By Status
// ==========================
async function loadInspectionsByStatus() {
    const statuses = [
        { bodyId: "passed-body",   countId: "passed-count",   status: "Passed"      },
        { bodyId: "issues-body",   countId: "issues-count",   status: "With Issues" },
        { bodyId: "rejected-body", countId: "rejected-count", status: "Rejected"    },
    ];

    for (const s of statuses) {
        try {
            const q = query(
                collection(db, "qualityControl"),
                where("overallStatus", "==", s.status)
            );

            const snapshot = await getDocs(q);
            const tbody    = document.getElementById(s.bodyId);
            tbody.innerHTML = "";

            snapshot.forEach(doc => {
                const r  = doc.data();
                const tr = document.createElement("tr");

                // Build the 4th column based on status type
                let detailCell = "";
                if (s.status === "Passed") {
                    // Show any remarks from criteria
                    const remarks = (r.criteria || [])
                        .filter(c => c.remarks)
                        .map(c => c.remarks)
                        .join(", ");
                    detailCell = remarks || "—";
                } else if (s.status === "With Issues") {
                    // Show which criteria were Acceptable
                    const issues = (r.criteria || [])
                        .filter(c => c.assessment === "Acceptable")
                        .map(c => c.criteriaName)
                        .join(", ");
                    detailCell = issues || "—";
                } else if (s.status === "Rejected") {
                    // Show which criteria were Rejected
                    const rejected = (r.criteria || [])
                        .filter(c => c.assessment === "Rejected")
                        .map(c => c.criteriaName)
                        .join(", ");
                    detailCell = rejected || "—";
                }

                tr.innerHTML = `
                    <td><strong>${r.batchCode ?? ""}</strong></td>
                    <td>${r.productType       ?? ""}</td>
                    <td>${r.location          ?? ""}</td>
                    <td>${detailCell}</td>
                    <td>${formatDate(r.createdAt)}</td>
                    <td class="text-right">${getStatusBadgeHTML(r.overallStatus)}</td>
                `;
                tbody.appendChild(tr);
            });

            document.getElementById(s.countId).textContent = snapshot.size;

        } catch (error) {
            console.error(`Error loading ${s.status} inspections:`, error);
        }
    }
}


// ==========================
// Download Inspection Report (Excel)
// ==========================
document.getElementById("download-delivery-report-btn")
    ?.addEventListener("click", async () => {

        try {
            const q = query(
                collection(db, "qualityControl"),
                orderBy("createdAt", "desc")
            );

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                alert("No inspection data found.");
                return;
            }

            const formattedData = [];

            snapshot.forEach(doc => {
                const d = doc.data();

                // Flatten criteria into readable strings
                const criteriaStr = (d.criteria || [])
                    .map(c => `${c.criteriaName}: ${c.assessment}${c.remarks ? ` (${c.remarks})` : ""}`)
                    .join(" | ");

                formattedData.push({
                    "Batch ID":         d.batchCode      || "",
                    "Inspector":        d.inspectorName  || "",
                    "Location":         d.location       || "",
                    "Product Type":     d.productType    || "",
                    "Temperature (°C)": d.temperature    || "",
                    "pH Level":         d.phLevel        || "",
                    "Criteria":         criteriaStr      || "",
                    "Freshness Score":  d.score          ?? "",
                    "Overall Status":   d.overallStatus  || "",
                    "Date":             d.createdAt?.toDate
                        ? d.createdAt.toDate().toLocaleString("en-PH", {
                            month: "short", day: "numeric", year: "numeric",
                            hour: "numeric", minute: "2-digit", hour12: true
                          })
                        : ""
                });
            });

            const worksheet = XLSX.utils.json_to_sheet(formattedData);
            const workbook  = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Inspection Report");

            const today = new Date().toISOString().split("T")[0];
            XLSX.writeFile(workbook, `Inspection_Report_${today}.xlsx`);

        } catch (error) {
            console.error("Inspection report error:", error);
            alert("Failed to generate inspection report.");
        }
    });


// ==========================
// Initial Load
// ==========================
window.addEventListener("DOMContentLoaded", () => {
    loadInspectionsToday();
    loadInspectionsByStatus();
});