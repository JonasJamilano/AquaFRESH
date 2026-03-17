import { db } from "./firebase.js";
import {
    collection,
    addDoc,
    getDocs,
    deleteDoc,
    updateDoc,
    doc,
    query,
    where,
    serverTimestamp,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Read the logged-in user's full name directly from localStorage
const currentInspectorName = localStorage.getItem("userFullName") || "Unknown";

// Tracks whether we're editing an existing record (stores doc ID) or creating new
let editingRecordId = null;


// ==========================
// Auto-Generate Batch ID
// ==========================
async function generateBatchId() {
    try {
        const snapshot = await getDocs(collection(db, "inspections"));
        let maxNum = 0;
        snapshot.forEach(d => {
            const code  = d.data().batchCode || "";
            const match = code.match(/^B0-(\d+)$/i);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        });
        return "B0-" + (maxNum + 1);
    } catch (e) {
        console.error("Could not generate batch ID:", e);
        return "B0-1";
    }
}


// ==========================
// Helper: Collect Criteria Data
// ==========================
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
    classEl.innerHTML = iconHTML + classification;
    classEl.className = "status " + statusClass;

    return { finalScore, classification };
}


// ==========================
// Bind Live Score Calculation
// ==========================
document.addEventListener("change", e => {
    if (e.target.matches(".criteria-select") || e.target.matches("#temperature") || e.target.matches("#ph-level")) {
        calculateScore();
    }
});
document.addEventListener("input", e => {
    if (e.target.matches("#temperature") || e.target.matches("#ph-level")) {
        calculateScore();
    }
});
document.addEventListener("DOMContentLoaded", () => { calculateScore(); });


// ==========================
// Open modal in NEW mode
// ==========================
document.getElementById("btn-new-inspection")
    .addEventListener("click", async () => {
        editingRecordId = null;

        document.getElementById("modal-inspection-title").innerHTML =
            '<i class="fa-solid fa-clipboard-list"></i> New Inspection Log';
        document.getElementById("save-inspection-btn").innerHTML =
            '<i class="fa-solid fa-floppy-disk"></i> Save Inspection Log';

        const batchInput    = document.getElementById("batch-code");
        batchInput.value    = "Generating...";
        batchInput.readOnly = true;
        batchInput.style.color      = "#94a3b8";
        batchInput.style.background = "#f1f5f9";
        batchInput.value = await generateBatchId();

        document.getElementById("modal-new-inspection").classList.add("active");
        document.body.style.overflow = "hidden";
    });


// ==========================
// Open modal in EDIT mode
// ==========================
async function openEditModal(id, data) {
    editingRecordId = id;

    document.getElementById("modal-inspection-title").innerHTML =
        '<i class="fa-solid fa-pen-to-square"></i> Edit Inspection Log';
    document.getElementById("save-inspection-btn").innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Save Changes';

    const batchInput        = document.getElementById("batch-code");
    batchInput.value        = data.batchCode    || "";
    batchInput.readOnly     = true;
    batchInput.style.color  = "#94a3b8";
    batchInput.style.background = "#f1f5f9";

    document.getElementById("inspection-location").value = data.location    || "";
    document.getElementById("temperature").value         = data.temperature ?? "4.0";
    document.getElementById("ph-level").value            = data.phLevel     ?? "6.5";

    const productSelect = document.getElementById("product-type");
    productSelect.value = data.productType || "";

    const criteriaRows = document.querySelectorAll("#new-inspection-tbody tr");
    criteriaRows.forEach(row => {
        const name   = row.querySelector(".criteria-select").dataset.criteria;
        const match  = (data.criteria || []).find(c => c.criteriaName === name);
        if (match) {
            row.querySelector(".criteria-select").value  = match.assessment || "Excellent";
            row.querySelector(".criteria-remarks").value = match.remarks    || "";
        }
    });

    calculateScore();

    document.getElementById("modal-new-inspection").classList.add("active");
    document.body.style.overflow = "hidden";
}


// ==========================
// Save / Update Inspection
// ==========================
document.getElementById("save-inspection-btn")
    .addEventListener("click", async () => {

        const batchCode   = document.getElementById("batch-code").value.trim();
        const productType = document.getElementById("product-type").value.trim();
        const location    = document.getElementById("inspection-location").value.trim();

        if (!batchCode || !productType || !location) {
            alert("Please fill in all required fields: Batch ID, Product Type, and Location.");
            return;
        }

        const criteria                       = getCriteriaData();
        const { finalScore, classification } = calculateScore();
        const temperature = parseFloat(document.getElementById("temperature").value);
        const phLevel     = parseFloat(document.getElementById("ph-level").value);

        try {
            if (editingRecordId) {
                await updateDoc(doc(db, "inspections", editingRecordId), {
                    batchCode,
                    productType,
                    location,
                    criteria,
                    temperature,
                    phLevel,
                    score:         finalScore,
                    overallStatus: classification
                });
                alert("Inspection updated successfully!");
            } else {
                await addDoc(collection(db, "inspections"), {
                    batchCode,
                    productType,
                    location,
                    inspectorName: currentInspectorName,
                    criteria,
                    temperature,
                    phLevel,
                    score:         finalScore,
                    overallStatus: classification,
                    createdAt:     serverTimestamp()
                });
                alert("Inspection saved successfully!");
            }

            editingRecordId = null;
            await resetInspectionForm();
            await loadInspectionsToday();
            await loadInspectionsByStatus();

        } catch (error) {
            console.error("Firestore error:", error);
            alert("Failed to save inspection. Check console for details.");
        }
    });


// ==========================
// Clear Form Button
// ==========================
document.getElementById("add-inspection-btn")
    .addEventListener("click", async () => {
        await resetInspectionForm();
    });


// ==========================
// Reset Form
// ==========================
async function resetInspectionForm() {
    editingRecordId = null;

    document.getElementById("inspection-location").value = "";
    document.getElementById("product-type").value        = "";
    document.getElementById("temperature").value         = "4.0";
    document.getElementById("ph-level").value            = "6.5";

    document.querySelectorAll(".criteria-select").forEach(sel => sel.value = "Excellent");
    document.querySelectorAll(".criteria-remarks").forEach(inp => inp.value = "");

    calculateScore();

    document.getElementById("modal-inspection-title").innerHTML =
        '<i class="fa-solid fa-clipboard-list"></i> New Inspection Log';
    document.getElementById("save-inspection-btn").innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Save Inspection Log';

    const batchInput        = document.getElementById("batch-code");
    batchInput.value        = "Generating...";
    batchInput.readOnly     = true;
    batchInput.style.color  = "#94a3b8";
    batchInput.style.background = "#f1f5f9";
    batchInput.value = await generateBatchId();
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
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true
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
            collection(db, "inspections"),
            where("createdAt", ">=", today),
            orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);
        const tbody    = document.getElementById("inspections-today-body");
        tbody.innerHTML = "";

        snapshot.forEach(d => {
            const r  = d.data();
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
                collection(db, "inspections"),
                where("overallStatus", "==", s.status)
            );
            const snapshot = await getDocs(q);
            const tbody    = document.getElementById(s.bodyId);
            tbody.innerHTML = "";

            snapshot.forEach(docSnap => {
                const r  = docSnap.data();
                const id = docSnap.id;
                const tr = document.createElement("tr");

                let detailCell = "";
                if (s.status === "Passed") {
                    detailCell = (r.criteria || []).filter(c => c.remarks).map(c => c.remarks).join(", ") || "—";
                } else if (s.status === "With Issues") {
                    detailCell = (r.criteria || []).filter(c => c.assessment === "Acceptable").map(c => c.criteriaName).join(", ") || "—";
                } else if (s.status === "Rejected") {
                    detailCell = (r.criteria || []).filter(c => c.assessment === "Rejected").map(c => c.criteriaName).join(", ") || "—";
                }

                const safeData = encodeURIComponent(JSON.stringify({
                    batchCode:     r.batchCode     ?? "",
                    productType:   r.productType   ?? "",
                    location:      r.location      ?? "",
                    temperature:   r.temperature   ?? 4.0,
                    phLevel:       r.phLevel        ?? 6.5,
                    overallStatus: r.overallStatus ?? "",
                    criteria:      r.criteria      ?? []
                }));

                // Inspector name included in all three status modal tables
                tr.innerHTML = `
                    <td><strong>${r.batchCode    ?? ""}</strong></td>
                    <td>${r.inspectorName        ?? "—"}</td>
                    <td>${r.productType          ?? ""}</td>
                    <td>${r.location             ?? ""}</td>
                    <td>${detailCell}</td>
                    <td>${formatDate(r.createdAt)}</td>
                    <td class="text-right">${getStatusBadgeHTML(r.overallStatus)}</td>
                    <td>
                        <button class="edit-record-btn" data-id="${id}" data-record="${safeData}">
                            <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            document.getElementById(s.countId).textContent = snapshot.size;
        } catch (error) {
            console.error(`Error loading ${s.status} inspections:`, error);
        }
    }

    attachEditListeners();
}


// ==========================
// Attach Edit Button Listeners
// ==========================
function attachEditListeners() {
    document.querySelectorAll(".edit-record-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id   = btn.dataset.id;
            const data = JSON.parse(decodeURIComponent(btn.dataset.record));

            ["modal-passed", "modal-issues", "modal-rejected"].forEach(modalId => {
                document.getElementById(modalId)?.classList.remove("active");
            });

            openEditModal(id, data);
        });
    });
}


// ==========================
// Download Inspection Report (Excel)
// ==========================
document.getElementById("download-delivery-report-btn")
    ?.addEventListener("click", async () => {
        try {
            const q        = query(collection(db, "inspections"), orderBy("createdAt", "desc"));
            const snapshot = await getDocs(q);

            if (snapshot.empty) { alert("No inspection data found."); return; }

            const formattedData = [];
            snapshot.forEach(d => {
                const r = d.data();
                const criteriaStr = (r.criteria || [])
                    .map(c => `${c.criteriaName}: ${c.assessment}${c.remarks ? ` (${c.remarks})` : ""}`)
                    .join(" | ");

                formattedData.push({
                    "Batch ID":         r.batchCode     || "",
                    "Inspector":        r.inspectorName || "",
                    "Location":         r.location      || "",
                    "Product Type":     r.productType   || "",
                    "Temperature (°C)": r.temperature   || "",
                    "pH Level":         r.phLevel       || "",
                    "Criteria":         criteriaStr     || "",
                    "Freshness Score":  r.score         ?? "",
                    "Overall Status":   r.overallStatus || "",
                    "Date":             r.createdAt?.toDate
                        ? r.createdAt.toDate().toLocaleString("en-PH", {
                            month: "short", day: "numeric", year: "numeric",
                            hour: "numeric", minute: "2-digit", hour12: true
                          })
                        : ""
                });
            });

            const worksheet = XLSX.utils.json_to_sheet(formattedData);
            const workbook  = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Inspection Report");
            XLSX.writeFile(workbook, `Inspection_Report_${new Date().toISOString().split("T")[0]}.xlsx`);

        } catch (error) {
            console.error("Inspection report error:", error);
            alert("Failed to generate inspection report.");
        }
    });


// ==========================
// Clear All Inspection Data
// ==========================
document.getElementById("clear-all-data-btn")
    .addEventListener("click", () => {
        document.getElementById("modal-clear-warning").classList.add("active");
        document.body.style.overflow = "hidden";
    });

document.getElementById("cancel-clear-btn")
    .addEventListener("click", () => {
        document.getElementById("modal-clear-warning").classList.remove("active");
        document.body.style.overflow = "";
    });

document.getElementById("confirm-clear-btn")
    .addEventListener("click", async () => {
        const confirmBtn = document.getElementById("confirm-clear-btn");
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

        try {
            const snapshot  = await getDocs(collection(db, "inspections"));
            const deletions = snapshot.docs.map(d => deleteDoc(doc(db, "inspections", d.id)));
            await Promise.all(deletions);

            document.getElementById("modal-clear-warning").classList.remove("active");
            document.body.style.overflow = "";

            alert(`Successfully deleted ${snapshot.size} inspection record(s).`);
            await loadInspectionsToday();
            await loadInspectionsByStatus();

        } catch (error) {
            console.error("Error clearing inspection data:", error);
            alert("Failed to clear data. Check console for details.");
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Yes, Delete All';
        }
    });


// ==========================
// Initial Load
// ==========================
window.addEventListener("DOMContentLoaded", () => {
    loadInspectionsToday();
    loadInspectionsByStatus();
});