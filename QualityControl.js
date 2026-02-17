// QualityControl.js
const API_BASE = "http://localhost:3000"; // change if using another server/port

// Example: logged-in inspector ID (replace with real login system)
const inspectorId = 1; // normally set from session or token

// ==========================
// Helper: Collect Criteria Data (Only from New Inspection table)
// ==========================
function getCriteriaData() {
    const inspectionSection = document.getElementById("save-inspection-btn")
        .closest("section"); // the new inspection section
    const rows = inspectionSection.querySelectorAll("tbody tr");

    return Array.from(rows).map(row => ({
        criteriaName: row.querySelector(".criteria-select").dataset.criteria,
        assessment: row.querySelector(".criteria-select").value,
        remarks: row.querySelector(".criteria-remarks").value || ""
    }));
}

// ==========================
// Submit New Inspection
// ==========================
document.getElementById("save-inspection-btn").addEventListener("click", async () => {
    const batchCode = document.getElementById("batch-code").value.trim();
    const productType = document.getElementById("product-type").value.trim();
    const location = document.getElementById("inspection-location").value.trim();

    if (!batchCode || !productType || !location) {
        alert("Please fill in Batch ID, Product Type, and Location.");
        return;
    }

    const criteria = getCriteriaData();

    try {
        const res = await fetch(`${API_BASE}/quality-control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchCode, productType, location, inspectorId, criteria })
        });

        const data = await res.json();
        if (data.success) {
            alert(`Inspection saved! Overall Status: ${data.status}`);

            // Refresh tables
            loadInspectionsToday();
            loadInspectionsByStatus();

            // Reset form for next entry
            resetInspectionForm();
        } else {
            alert("Error: " + (data.error || "Unknown error"));
        }
    } catch (err) {
        console.error(err);
        alert("Server error");
    }
});

// ==========================
// Reset New Inspection Form
// ==========================
function resetInspectionForm() {
    document.getElementById("batch-code").value = "";
    document.getElementById("product-type").value = "";
    document.getElementById("inspection-location").value = "";
    document.getElementById("inspector-name").value = "";

    document.querySelectorAll(".criteria-select").forEach(sel => sel.value = "Excellent");
    document.querySelectorAll(".criteria-remarks").forEach(inp => inp.value = "");
}

// ==========================
// Load Inspections Today
// ==========================
async function loadInspectionsToday() {
    try {
        const res = await fetch(`${API_BASE}/quality-control/today`);
        const rows = await res.json();

        const tbody = document.getElementById("inspections-today-body");
        tbody.innerHTML = "";

        rows.forEach(r => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${r.batch_code}</td>
                <td>${r.inspector}</td>
                <td>${r.location}</td>
                <td>${r.product_type}</td>
                <td class="status ${r.overall_status.toLowerCase().replace(" ", "-")}">${r.overall_status}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById("inspections-today-count").innerText = rows.length;

    } catch (err) {
        console.error("Load today inspections error:", err);
    }
}

// ==========================
// Load Inspections by Status
// ==========================
async function loadInspectionsByStatus() {
    const statuses = [
        { id: "passed-body", labelId: "passed-count", status: "Passed" },
        { id: "issues-body", labelId: "issues-count", status: "With Issues" },
        { id: "rejected-body", labelId: "rejected-count", status: "Rejected" },
    ];

    for (let s of statuses) {
        try {
            const res = await fetch(`${API_BASE}/quality-control/status/${encodeURIComponent(s.status)}`);
            const rows = await res.json();

            const tbody = document.getElementById(s.id);
            tbody.innerHTML = "";

            rows.forEach(r => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${r.batch_code}</td>
                    <td>${r.product_type}</td>
                    <td>${r.location}</td>
                    <td>${r.overall_remarks || (r.overall_status === "Rejected" ? "Failed criteria" : "No issues")}</td>
                    <td class="status ${r.overall_status.toLowerCase().replace(" ", "-")}">${r.overall_status}</td>
                `;
                tbody.appendChild(tr);
            });

            document.getElementById(s.labelId).innerText = rows.length;

        } catch (err) {
            console.error(`Load ${s.status} inspections error:`, err);
        }
    }
}

// ==========================
// Initial Load
// ==========================
window.addEventListener("DOMContentLoaded", () => {
    loadInspectionsToday();
    loadInspectionsByStatus();
});
