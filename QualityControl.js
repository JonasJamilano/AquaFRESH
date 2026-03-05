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


// ==========================
// Helper: Collect Criteria Data
// ==========================
function getCriteriaData() {
    const inspectionSection = document
        .getElementById("save-inspection-btn")
        .closest("section");

    const rows = inspectionSection.querySelectorAll("tbody tr");

    return Array.from(rows).map(row => ({
        criteriaName: row.querySelector(".criteria-select").dataset.criteria,
        assessment: row.querySelector(".criteria-select").value,
        remarks: row.querySelector(".criteria-remarks").value || ""
    }));
}


// ==========================
// Calculate Freshness Score
// ==========================
function calculateScore() {

    let sensoryTotal = 0;
    const scoreMap = { "Excellent": 100, "Acceptable": 50, "Rejected": 0 };

    $(".criteria-select").each(function() {
        let val = $(this).val();
        sensoryTotal += scoreMap[val] ?? 0;
    });

    let sensoryAverage = sensoryTotal / 4;

    let tempValue = parseFloat($("#temperature").val()) || 0;
    let tempScore = tempValue <= 4.0 ? 100 : (tempValue <= 8.0 ? 50 : 0);

    let phValue = parseFloat($("#ph-level").val()) || 0;
    let phScore =
        (phValue >= 6.5 && phValue <= 6.8) ? 100 :
        ((phValue >= 6.0 && phValue < 6.5) ||
        (phValue > 6.8 && phValue <= 7.2)) ? 50 : 0;

    let finalScore = Math.round(
        (sensoryAverage * 0.50) +
        (tempScore * 0.25) +
        (phScore * 0.25)
    );

    let classification = "";
    let statusClass = "";
    let iconHTML = "";

    if (finalScore >= 80) {
        classification = "Passed";
        statusClass = "success";
        iconHTML = '<i class="fa-solid fa-check"></i> ';
    } else if (finalScore >= 50) {
        classification = "With Issues";
        statusClass = "warning";
        iconHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ';
    } else {
        classification = "Rejected";
        statusClass = "danger";
        iconHTML = '<i class="fa-solid fa-circle-xmark"></i> ';
    }

    $("#live-score").text(finalScore);
    $("#live-classification")
        .html(iconHTML + classification)
        .attr("class", "status " + statusClass);

    return { finalScore, classification };
}


// ==========================
// Bind Live Calculation
// ==========================
$(document).ready(function() {
    $(document).on(
        "change input",
        ".criteria-select, #temperature, #ph-level",
        calculateScore
    );
    calculateScore();
});


// ==========================
// Save Inspection (Firestore)
// ==========================
document.getElementById("save-inspection-btn")
.addEventListener("click", async () => {

    const batchCode = document.getElementById("batch-code").value.trim();
    const productType = document.getElementById("product-type").value.trim();
    const location = document.getElementById("inspection-location").value.trim();

    if (!batchCode || !productType || !location) {
        alert("Please fill required fields.");
        return;
    }

    const criteria = getCriteriaData();
    const { finalScore, classification } = calculateScore();

    try {
        await addDoc(collection(db, "qualityControl"), {
            batchCode,
            productType,
            location,
            criteria,
            temperature: parseFloat($("#temperature").val()),
            phLevel: parseFloat($("#ph-level").val()),
            score: finalScore,
            overallStatus: classification,
            createdAt: serverTimestamp()
        });

        alert("Inspection saved successfully!");
        resetInspectionForm();
        loadInspectionsToday();
        loadInspectionsByStatus();

    } catch (error) {
        console.error("Firestore save error:", error);
        alert("Failed to save inspection.");
    }
});


// ==========================
// Reset Form
// ==========================
function resetInspectionForm() {
    document.getElementById("batch-code").value = "";
    document.getElementById("product-type").value = "";
    document.getElementById("inspection-location").value = "";
    document.getElementById("temperature").value = "4.0";
    document.getElementById("ph-level").value = "6.5";

    document.querySelectorAll(".criteria-select")
        .forEach(sel => sel.value = "Excellent");

    document.querySelectorAll(".criteria-remarks")
        .forEach(inp => inp.value = "");
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
// Load Today Inspections
// ==========================
async function loadInspectionsToday() {

    const today = new Date();
    today.setHours(0,0,0,0);

    const q = query(
        collection(db, "qualityControl"),
        where("createdAt", ">=", today)
    );

    const snapshot = await getDocs(q);

    const tbody = document.getElementById("inspections-today-body");
    tbody.innerHTML = "";

    snapshot.forEach(doc => {
        const r = doc.data();

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${r.batchCode}</strong></td>
            <td>${r.location}</td>
            <td>${r.productType}</td>
            <td>${getStatusBadgeHTML(r.overallStatus)}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById("inspections-today-count")
        .innerText = snapshot.size;
}


// ==========================
// Load By Status
// ==========================
async function loadInspectionsByStatus() {

    const statuses = [
        { id: "passed-body", labelId: "passed-count", status: "Passed" },
        { id: "issues-body", labelId: "issues-count", status: "With Issues" },
        { id: "rejected-body", labelId: "rejected-count", status: "Rejected" },
    ];

    for (let s of statuses) {

        const q = query(
            collection(db, "qualityControl"),
            where("overallStatus", "==", s.status)
        );

        const snapshot = await getDocs(q);

        const tbody = document.getElementById(s.id);
        tbody.innerHTML = "";

        snapshot.forEach(doc => {
            const r = doc.data();

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${r.batchCode}</strong></td>
                <td>${r.productType}</td>
                <td>${r.location}</td>
                <td>${getStatusBadgeHTML(r.overallStatus)}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById(s.labelId)
            .innerText = snapshot.size;
    }
}


// ==========================
// Download Delivery Report (Excel)
// ==========================
document.getElementById("download-delivery-report-btn")
?.addEventListener("click", async () => {

    try {

        const q = query(
            collection(db, "deliveries"),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            alert("No delivery data found.");
            return;
        }

        const formattedData = [];

        snapshot.forEach(doc => {
            const d = doc.data();

            formattedData.push({
                "Delivery ID": d.deliveryId || "",
                "Driver Name": d.driverName || "",
                "Vehicle": d.vehicle || "",
                "Destination": d.destination || "",
                "Product Type": d.productType || "",
                "Quantity": d.quantity || "",
                "Status": d.status || "",
                "Temperature (°C)": d.temperature || "",
                "Created At": d.createdAt?.toDate
                    ? d.createdAt.toDate().toLocaleString()
                    : ""
            });
        });

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Delivery Report");

        const today = new Date().toISOString().split("T")[0];
        XLSX.writeFile(workbook, `Delivery_Report_${today}.xlsx`);

    } catch (error) {
        console.error("Delivery report error:", error);
        alert("Failed to generate delivery report.");
    }
});


// ==========================
// Initial Load
// ==========================
window.addEventListener("DOMContentLoaded", () => {
    loadInspectionsToday();
    loadInspectionsByStatus();
});