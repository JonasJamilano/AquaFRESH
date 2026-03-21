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

// Current product category: "fish" | "shrimp"
let currentProductCategory = "fish";


// ==========================
// Criteria Config per type
// ==========================
const CRITERIA_CONFIG = {
    fish: [
        { name: "Eye Clarity",    weight: 0.30, label: "30%" },
        { name: "Gill Color",     weight: 0.25, label: "25%" },
        { name: "Odor",           weight: 0.25, label: "25%" },
        { name: "Body Firmness",  weight: 0.20, label: "20%" },
    ],
    shrimp: [
        { name: "Shell Condition", weight: 0.30, label: "30%" },
        { name: "Odor",            weight: 0.30, label: "30%" },
        { name: "Texture",         weight: 0.25, label: "25%" },
        { name: "Tail Appearance", weight: 0.15, label: "15%" },
    ]
};

const PRODUCT_OPTIONS = {
    fish:   ["Bangus", "Tilapia"],
    shrimp: ["Fresh Water Shrimp"]
};


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
// Render Criteria Rows
// ==========================
function renderCriteriaRows(category) {
    const tbody = document.getElementById("new-inspection-tbody");
    tbody.innerHTML = "";
    CRITERIA_CONFIG[category].forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${c.name}</strong></td>
            <td><span class="weight-badge">${c.label}</span></td>
            <td>
                <select class="criteria-select" data-criteria="${c.name}" data-weight="${c.weight}">
                    <option value="Excellent">Excellent</option>
                    <option value="Acceptable">Acceptable</option>
                    <option value="Rejected">Rejected</option>
                </select>
            </td>
            <td><input class="criteria-remarks" type="text" placeholder="Optional notes..."></td>
        `;
        tbody.appendChild(tr);
    });
    calculateScore();
}


// ==========================
// Render Product Type Options
// ==========================
function renderProductOptions(category) {
    const select = document.getElementById("product-type");
    select.innerHTML = '<option value="" disabled selected>Select Product</option>';
    PRODUCT_OPTIONS[category].forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        select.appendChild(opt);
    });
}


// ==========================
// Update Product Badge in Inspection Modal
// ==========================
function updateProductBadge(category) {
    const badge = document.getElementById("ni-product-badge");
    const label = document.getElementById("ni-product-badge-label");
    badge.className = "ni-product-badge " + category;
    if (category === "fish") {
        badge.querySelector("i").className = "fa-solid fa-fish";
        label.textContent = "Fish Inspection";
    } else {
        badge.querySelector("i").className = "fa-solid fa-shrimp";
        label.textContent = "Shrimp Inspection";
    }
}


// ==========================
// Helper: Collect Criteria Data
// ==========================
function getCriteriaData() {
    const rows = document.querySelectorAll("#new-inspection-tbody tr");
    return Array.from(rows).map(row => ({
        criteriaName: row.querySelector(".criteria-select").dataset.criteria,
        weight:       parseFloat(row.querySelector(".criteria-select").dataset.weight),
        assessment:   row.querySelector(".criteria-select").value,
        remarks:      row.querySelector(".criteria-remarks").value.trim() || ""
    }));
}


// ==========================
// Calculate Freshness Score
// Fish:   Score = (Eye×0.3)+(Gill×0.25)+(Odor×0.25)+(Firmness×0.2) × 20  → 0-100
// Shrimp: Score = (Shell×0.3)+(Odor×0.3)+(Texture×0.25)+(Tail×0.15) × 20 → 0-100
// Thresholds: 80-100 = Passed, 60-79 = With Issues, <60 = Rejected
// ==========================
function calculateScore() {
    const scoreMap = { "Excellent": 5, "Acceptable": 3, "Rejected": 1 };

    let weightedSum = 0;
    document.querySelectorAll(".criteria-select").forEach(sel => {
        const rawScore = scoreMap[sel.value] ?? 1;
        const weight   = parseFloat(sel.dataset.weight) || 0;
        weightedSum += rawScore * weight;
    });

    // Multiply by 20 to convert to 0–100 scale
    const finalScore = Math.min(100, Math.round(weightedSum * 20));

    let classification, statusClass, iconHTML;
    if (finalScore >= 80) {
        classification = "Passed";
        statusClass    = "success";
        iconHTML       = '<i class="fa-solid fa-check"></i> ';
    } else if (finalScore >= 60) {
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
    if (e.target.matches(".criteria-select")) {
        calculateScore();
    }
});

document.addEventListener("DOMContentLoaded", () => { calculateScore(); });


// ==========================
// Product Chooser Modal Logic
// ==========================
document.getElementById("btn-new-inspection")
    .addEventListener("click", () => {
        editingRecordId = null;
        document.getElementById("modal-product-chooser").classList.add("active");
        document.body.style.overflow = "hidden";
    });

async function openInspectionModal(category) {
    currentProductCategory = category;

    // Close chooser
    document.getElementById("modal-product-chooser").classList.remove("active");

    // Reset title & button
    document.getElementById("modal-inspection-title").innerHTML =
        '<i class="fa-solid fa-clipboard-list"></i> New Inspection Log';
    document.getElementById("save-inspection-btn").innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Save Inspection Log';

    // Product badge
    updateProductBadge(category);

    // Product dropdown options
    renderProductOptions(category);

    // Criteria rows
    renderCriteriaRows(category);

    // Batch ID
    const batchInput    = document.getElementById("batch-code");
    batchInput.value    = "Generating...";
    batchInput.readOnly = true;
    batchInput.style.color      = "#94a3b8";
    batchInput.style.background = "#f1f5f9";
    batchInput.value = await generateBatchId();

    // Clear location
    document.getElementById("inspection-location").selectedIndex = 0;

    document.getElementById("modal-new-inspection").classList.add("active");
    document.body.style.overflow = "hidden";
}

document.getElementById("choose-fish").addEventListener("click",  () => openInspectionModal("fish"));
document.getElementById("choose-shrimp").addEventListener("click", () => openInspectionModal("shrimp"));

// "Change Type" button — toggles directly between fish and shrimp
document.getElementById("ni-change-type-btn").addEventListener("click", async () => {
    const newCategory = currentProductCategory === "fish" ? "shrimp" : "fish";
    currentProductCategory = newCategory;

    updateProductBadge(newCategory);
    renderProductOptions(newCategory);
    renderCriteriaRows(newCategory);

    // Reset location and regenerate batch ID
    document.getElementById("inspection-location").selectedIndex = 0;
    const batchInput = document.getElementById("batch-code");
    batchInput.value = "Generating...";
    batchInput.value = await generateBatchId();
});


// ==========================
// Open modal in EDIT mode
// ==========================
async function openEditModal(id, data) {
    editingRecordId = id;

    // Determine category from saved productType
    const shrimpProducts = ["Fresh Water Shrimp"];
    const category = shrimpProducts.includes(data.productType) ? "shrimp" : "fish";
    currentProductCategory = category;

    document.getElementById("modal-inspection-title").innerHTML =
        '<i class="fa-solid fa-pen-to-square"></i> Edit Inspection Log';
    document.getElementById("save-inspection-btn").innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Save Changes';

    // Product badge + options
    updateProductBadge(category);
    renderProductOptions(category);

    // Batch ID
    const batchInput        = document.getElementById("batch-code");
    batchInput.value        = data.batchCode    || "";
    batchInput.readOnly     = true;
    batchInput.style.color  = "#94a3b8";
    batchInput.style.background = "#f1f5f9";

    document.getElementById("inspection-location").value = data.location || "";

    // Product select
    const productSelect = document.getElementById("product-type");
    productSelect.value = data.productType || "";

    // Render criteria rows for this category, then fill saved values
    renderCriteriaRows(category);
    const criteriaRows = document.querySelectorAll("#new-inspection-tbody tr");
    criteriaRows.forEach(row => {
        const name  = row.querySelector(".criteria-select").dataset.criteria;
        const match = (data.criteria || []).find(c => c.criteriaName === name);
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

        try {
            if (editingRecordId) {
                await updateDoc(doc(db, "inspections", editingRecordId), {
                    batchCode,
                    productType,
                    productCategory: currentProductCategory,
                    location,
                    criteria,
                    score:         finalScore,
                    overallStatus: classification
                });
                alert("Inspection updated successfully!");
            } else {
                await addDoc(collection(db, "inspections"), {
                    batchCode,
                    productType,
                    productCategory: currentProductCategory,
                    location,
                    inspectorName:   currentInspectorName,
                    criteria,
                    score:           finalScore,
                    overallStatus:   classification,
                    createdAt:       serverTimestamp()
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

    document.getElementById("inspection-location").selectedIndex = 0;
    renderProductOptions(currentProductCategory);
    renderCriteriaRows(currentProductCategory);

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
        const snapshot  = await getDocs(q);
        const container = document.getElementById("inspections-today-body");
        const emptyEl   = document.getElementById("inspections-today-empty");
        container.innerHTML = "";

        if (snapshot.empty) {
            if (emptyEl) emptyEl.style.display = "block";
            document.getElementById("inspections-today-count").textContent = 0;
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        snapshot.forEach(d => {
            const r = d.data();

            const statusKey = r.overallStatus === "Passed"      ? "passed"
                            : r.overallStatus === "With Issues" ? "issues"
                            : "rejected";

            const shrimpProducts = ["Fresh Water Shrimp"];
            const pillClass = shrimpProducts.includes(r.productType) ? "shrimp" : "fish";

            const badgeLabel = r.overallStatus === "With Issues" ? "With Issues" : r.overallStatus;

            const card = document.createElement("div");
            card.className = `insp-card ${statusKey}`;
            card.innerHTML = `
                <div class="insp-batch-col">
                    <div class="insp-batch-id">${r.batchCode ?? ""}</div>
                    <span class="insp-product-pill ${pillClass}">${r.productType ?? ""}</span>
                </div>
                <div class="insp-meta-col">
                    <div class="insp-meta-item">
                        <span class="insp-meta-label">Inspector</span>
                        <span class="insp-meta-val">${r.inspectorName ?? "—"}</span>
                    </div>
                    <div class="insp-meta-item">
                        <span class="insp-meta-label">Location</span>
                        <span class="insp-meta-val">${r.location ?? "—"}</span>
                    </div>
                    <div class="insp-meta-item">
                        <span class="insp-meta-label">Score</span>
                        <span class="insp-meta-val score-val">${r.score ?? "—"} <span style="font-weight:400;color:#94a3b8;font-size:0.78rem;">/ 100</span></span>
                    </div>
                </div>
                <div class="insp-date-col">${formatDate(r.createdAt)}</div>
                <span class="insp-badge ${statusKey}">
                    <span class="insp-badge-dot ${statusKey}"></span>
                    ${badgeLabel}
                </span>
            `;
            container.appendChild(card);
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
                    batchCode:       r.batchCode       ?? "",
                    productType:     r.productType     ?? "",
                    productCategory: r.productCategory ?? "fish",
                    location:        r.location        ?? "",
                    overallStatus:   r.overallStatus   ?? "",
                    criteria:        r.criteria        ?? []
                }));

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
                    "Batch ID":        r.batchCode        || "",
                    "Inspector":       r.inspectorName    || "",
                    "Location":        r.location         || "",
                    "Product Type":    r.productType      || "",
                    "Product Category":r.productCategory  || "",
                    "Criteria":        criteriaStr        || "",
                    "Freshness Score": r.score            ?? "",
                    "Overall Status":  r.overallStatus    || "",
                    "Date":            r.createdAt?.toDate
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