import { db } from "./firebase.js";
import {
  collection, onSnapshot, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// FIX: Global dictionary to translate ugly Batch IDs into readable codes
let batchesMap = {};

document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    
    // FIX: Load the dictionary first before attempting to build the tables!
    await loadBatches();
    
    try { listenToKPIs(); } catch (e) { console.error(e); }
    try { listenToRecentActivity(); } catch (e) { console.error(e); }
    try { listenToQualityControl(); } catch (e) { console.error(e); }
    try { listenToTransport(); } catch (e) { console.error(e); }
});

/* ==============================================
   LOAD BATCHES DICTIONARY
============================================== */
async function loadBatches() {
    try {
        const snap = await getDocs(collection(db, "batches"));
        snap.forEach(docSnap => {
            const b = docSnap.data();
            // Save to our map (e.g. "rcI98alPqv4UK..." = "B-001")
            batchesMap[docSnap.id] = b.batchCode || b.batch_code || docSnap.id;
        });
    } catch (e) {
        console.error("Failed to load batches dictionary", e);
    }
}

/* ==============================================
   TAB LOGIC 
============================================== */
function setupTabs() {
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));

            btn.classList.add("active");
            document.getElementById(btn.dataset.target).classList.add("active");
        });
    });
}

/* ==============================================
   UNIFORM STATUS BADGE GENERATOR
============================================== */
function getStatusBadgeHTML(statusStr) {
    if (!statusStr) return "";
    let norm = statusStr.toLowerCase().replace(/_/g, ' ');
    let colorClass = 'status-default';

    if (norm.includes('pending')) colorClass = 'status-pending';
    else if (norm.includes('route')) colorClass = 'status-enroute';
    else if (norm.includes('delivered') || norm.includes('passed')) colorClass = 'status-success';
    else if (norm.includes('delayed') || norm.includes('rejected')) colorClass = 'status-danger';
    else if (norm.includes('issue')) colorClass = 'status-warning';

    const displayStr = statusStr.replace("_", " ");
    return `
        <div class="status-pill ${colorClass}">
            <span class="status-dot"></span>
            <span>${displayStr}</span>
        </div>
    `;
}

/* ==============================================
   KPI CARDS (Top Summaries)
============================================== */
async function listenToKPIs() {
    const usersSnap = await getDocs(query(collection(db, "users"), where("status", "==", "active")));
    document.getElementById("kpi-users").textContent = usersSnap.size;

    onSnapshot(collection(db, "deliveries"), (snapshot) => {
        let activeCount = 0;
        snapshot.forEach(doc => {
            const status = doc.data().status;
            if (status === "pending" || status === "en_route") activeCount++;
        });
        document.getElementById("kpi-deliveries").textContent = activeCount;
    });

    onSnapshot(collection(db, "inspections"), (snapshot) => {
        let todayCount = 0;
        let issuesCount = 0;
        const todayString = new Date().toDateString();

        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.createdAt && d.createdAt.toDate().toDateString() === todayString) todayCount++;
            if (d.overallStatus === "With Issues" || d.overallStatus === "Rejected") issuesCount++;
        });
        
        document.getElementById("kpi-inspections").textContent = todayCount;
        document.getElementById("kpi-issues").textContent = issuesCount;
    });
}

/* ==============================================
   TAB 1: RECENT ACTIVITY 
============================================== */
function listenToRecentActivity() {
    const tbody = document.getElementById("recent-activity-body");
    let activities = [];

    const renderActivities = () => {
        activities.sort((a, b) => b.time - a.time); 
        
        tbody.innerHTML = "";
        if (activities.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 30px;">No recent activity.</td></tr>`;
            return;
        }

        activities.slice(0, 6).forEach(act => {
            const tr = document.createElement('tr');
            tr.onclick = () => { window.location.href = act.link; };
            
            tr.innerHTML = `
                <td>${act.time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td><strong>${act.module}</strong></td>
                <td class="wrap-text">${act.detail}</td>
                <td class="hide-on-mobile">${getStatusBadgeHTML(act.status)}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    onSnapshot(collection(db, "inspections"), (snap) => {
        activities = activities.filter(a => a.type !== "inspection");
        snap.forEach(doc => {
            const d = doc.data();
            if(d.createdAt) {
                // Ensure QC batches display their readable name too if available
                const displayBatch = batchesMap[d.batchId] || d.batchCode || d.batchId || "-"; 
                activities.push({
                    type: "inspection",
                    time: d.createdAt.toDate(),
                    module: "QC Inspection",
                    detail: `Batch ${displayBatch} checked`,
                    status: d.overallStatus,
                    link: "QualityControl.html"
                });
            }
        });
        renderActivities();
    });

    onSnapshot(collection(db, "deliveries"), (snap) => {
        activities = activities.filter(a => a.type !== "delivery");
        snap.forEach(doc => {
            const d = doc.data();
            if(d.createdAt) {
                activities.push({
                    type: "delivery",
                    time: d.createdAt.toDate(),
                    module: "Transport",
                    detail: `Delivery ${d.deliveryCode} updated`,
                    status: d.status,
                    link: "TransportDelivery.html"
                });
            }
        });
        renderActivities();
    });
}

/* ==============================================
   TAB 2: QUALITY CONTROL
============================================== */
function listenToQualityControl() {
    const tbody = document.getElementById("qc-summary-body");

    onSnapshot(collection(db, "inspections"), (snapshot) => {
        let docs = [];
        snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
        
        docs.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        
        tbody.innerHTML = "";
        if (docs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 30px;">No recent inspections.</td></tr>`;
            return;
        }

        docs.slice(0, 5).forEach(d => {
            const tr = document.createElement('tr');
            tr.onclick = () => { window.location.href = "QualityControl.html"; };
            
            // Safe fallback translation using our dictionary
            const displayBatch = batchesMap[d.batchId] || d.batchCode || d.batchId || "-"; 

            tr.innerHTML = `
                <td><strong>${displayBatch}</strong></td>
                <td>${d.inspectorName || "Unknown"}</td>
                <td class="hide-on-mobile">${d.location || "-"}</td>
                <td>${getStatusBadgeHTML(d.overallStatus)}</td>
            `;
            tbody.appendChild(tr);
        });
    });
}

/* ==============================================
   TAB 3: TRANSPORT & DELIVERY
============================================== */
function listenToTransport() {
    const tbody = document.getElementById("transport-summary-body");

    onSnapshot(collection(db, "deliveries"), (snapshot) => {
        let docs = [];
        snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
        
        docs.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        tbody.innerHTML = "";
        if (docs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 30px;">No recent deliveries.</td></tr>`;
            return;
        }

        docs.slice(0, 5).forEach(d => {
            const shortOrigin = d.origin ? d.origin.split(',')[0] : "-";
            const shortDest = d.destination ? d.destination.split(',')[0] : "-";
            
            // FIX: Using the dictionary we loaded to perfectly translate the ID!
            const displayBatch = batchesMap[d.batchId] || d.batchCode || d.batchId || "-"; 
            
            const formattedDate = d.eta ? new Date(d.eta).toLocaleString() : "-";
            const truckName = d.truck || "-";

            const tr = document.createElement('tr');
            tr.onclick = () => { window.location.href = "TransportDelivery.html"; };
            
            tr.innerHTML = `
                <td><strong>${d.deliveryCode}</strong></td>
                <td>${displayBatch}</td>
                <td>${truckName}</td>
                <td>${d.driverName || "-"}</td>
                <td>${shortOrigin}</td>
                <td class="hide-on-mobile">${shortDest}</td>
                <td>${d.avgTemp || "-"}</td>
                <td>${formattedDate}</td>
                <td>${getStatusBadgeHTML(d.status)}</td>
            `;
            tbody.appendChild(tr);
        });
    });
}