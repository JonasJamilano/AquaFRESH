import { db } from "./firebase.js";
import { database } from "./firebase.js";
import {
    collection, getDocs, doc, updateDoc, query,
    where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    ref, onValue, query as dbQuery, orderByKey, limitToLast
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* =========================================
   STATE
========================================= */
const deliveriesCol = collection(db, "deliveries");

let map               = null;
let deliveryMarker    = null;
let routeControl      = null;
let simInterval       = null;
let simStepIndex      = 0;
let simWaypoints      = [];
let isSimulating      = false;
let activeDeliveryId  = null;

const SIM_STEP_MS    = 1500;
const SIM_ZOOM_LEVEL = 16;

/* =========================================
   INIT
========================================= */
document.addEventListener("DOMContentLoaded", async () => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;

    initMap();
    listenToMyDeliveries(userId);
    watchSensor();
});

/* =========================================
   MAP INIT
========================================= */
function initMap() {
    map = L.map("delivery-map").setView([14.5995, 120.9842], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    document.getElementById("map-status").innerText = "Map loaded. Awaiting active delivery.";
}

/* =========================================
   LISTEN TO MY DELIVERIES (real-time)
========================================= */
function listenToMyDeliveries(userId) {
    const q = query(deliveriesCol, where("driverId", "==", userId));

    onSnapshot(q, (snapshot) => {
        let docs = [];
        snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
        docs.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        let counts = { pending: 0, enroute: 0, delivered: 0, delayed: 0 };
        const bodies = {
            all:       document.getElementById("all-deliveries-body"),
            pending:   document.getElementById("pending-body"),
            enroute:   document.getElementById("enroute-body"),
            delivered: document.getElementById("delivered-body"),
            delayed:   document.getElementById("delayed-body"),
        };
        Object.values(bodies).forEach(b => { if (b) b.innerHTML = ""; });

        // Notification bell
        const newAssignments = docs.filter(d => d.status === "pending");
        const badge = document.getElementById("notif-count");
        if (badge) badge.textContent = newAssignments.length;
        const notifList = document.getElementById("notif-list");
        if (notifList) {
            if (newAssignments.length === 0) {
                notifList.innerHTML = `<div class="notif-item">No new deliveries.</div>`;
            } else {
                notifList.innerHTML = newAssignments.map(d => `
                    <div class="notif-item" onclick="document.getElementById('notif-toggle').checked=false;">
                        <strong>${d.deliveryCode}</strong> → ${d.destination?.split(",")[0] || "—"}
                        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">ETA: ${d.eta ? new Date(d.eta).toLocaleString("en-PH",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true}) : "—"}</div>
                    </div>`).join("");
            }
        }

        docs.forEach(d => {
            const shortDest = d.destination ? d.destination.split(",")[0] : "—";
            const etaStr    = d.eta ? new Date(d.eta).toLocaleString("en-PH", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true }) : "—";
            const deliveredStr = d.deliveredAt?.toDate ? d.deliveredAt.toDate().toLocaleString("en-PH", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true }) : "—";

            let actionBtn = "";
            if (d.status === "pending") {
                actionBtn = `<button class="start-btn" onclick="handleStartDelivery('${d.id}', ${d.originLat}, ${d.originLng}, ${d.destLat}, ${d.destLng})">
                    <i class="fa-solid fa-play"></i> Start Delivery
                </button>`;
            } else if (d.status === "en_route" || d.status === "delayed") {
                actionBtn = `<button class="deliver-btn" onclick="handleMarkDelivered('${d.id}')">
                    <i class="fa-solid fa-flag-checkered"></i> Mark Delivered
                </button>`;
            } else if (d.status === "delivered") {
                actionBtn = `<span class="status-delivered">Delivered ✓</span>`;
            }

            const statusBadge = getStatusBadge(d.status);

            // All deliveries table row
            if (bodies.all) {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><strong>${d.deliveryCode}</strong></td>
                    <td>${shortDest}</td>
                    <td>${etaStr}</td>
                    <td>${statusBadge}</td>
                    <td>${actionBtn}</td>
                `;
                bodies.all.appendChild(tr);
            }

            // Modal table rows
            const modalRow = `
                <td><strong>${d.deliveryCode}</strong></td>
                <td>${shortDest}</td>
                <td>${d.status === "delivered" ? deliveredStr : etaStr}</td>
                <td>${d.status === "delivered" ? statusBadge : actionBtn}</td>
            `;

            if (d.status === "pending" && bodies.pending) {
                counts.pending++;
                const tr = document.createElement("tr");
                tr.innerHTML = modalRow;
                bodies.pending.appendChild(tr);
            } else if (d.status === "en_route" && bodies.enroute) {
                counts.enroute++;
                const tr = document.createElement("tr");
                tr.innerHTML = modalRow;
                bodies.enroute.appendChild(tr);
            } else if (d.status === "delivered" && bodies.delivered) {
                counts.delivered++;
                const tr = document.createElement("tr");
                tr.innerHTML = modalRow;
                bodies.delivered.appendChild(tr);
            } else if ((d.status === "delayed") && bodies.delayed) {
                counts.delayed++;
                const tr = document.createElement("tr");
                tr.innerHTML = modalRow;
                bodies.delayed.appendChild(tr);
            }

            // If already en_route and simulation not running, resume it
            if (d.status === "en_route" && !isSimulating && d.currentLat && d.destLat) {
                startSimulation(d.id, d.currentLat, d.currentLng, d.destLat, d.destLng);
            }
        });

        // Update counts
        document.getElementById("pending-count").textContent   = counts.pending;
        document.getElementById("enroute-count").textContent   = counts.enroute;
        document.getElementById("delivered-count").textContent = counts.delivered;
        document.getElementById("delayed-count").textContent   = counts.delayed;

        document.getElementById("modal-pending-count").textContent   = counts.pending;
        document.getElementById("modal-enroute-count").textContent   = counts.enroute;
        document.getElementById("modal-delivered-count").textContent = counts.delivered;
        document.getElementById("modal-delayed-count").textContent   = counts.delayed;
    });
}

/* =========================================
   START DELIVERY HANDLER
========================================= */
window.handleStartDelivery = async function(id, originLat, originLng, destLat, destLng) {
    try {
        await updateDoc(doc(db, "deliveries", id), {
            status:    "en_route",
            startedAt: serverTimestamp()
        });
        startSimulation(id, originLat, originLng, destLat, destLng);
    } catch (e) {
        console.error("Start delivery error:", e);
        alert("Failed to start delivery.");
    }
};

/* =========================================
   MARK DELIVERED HANDLER
========================================= */
window.handleMarkDelivered = async function(id) {
    stopSimulation();
    try {
        await updateDoc(doc(db, "deliveries", id), {
            status:      "delivered",
            deliveredAt: serverTimestamp()
        });
        document.getElementById("map-status").innerText = "Delivery completed!";
        if (map) map.setZoom(12);
    } catch (e) {
        console.error("Mark delivered error:", e);
    }
};

/* =========================================
   FETCH REAL OSRM ROUTE
========================================= */
async function fetchRouteWaypoints(fromLat, fromLng, toLat, toLng) {
    try {
        const url  = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
        const res  = await fetch(url);
        const data = await res.json();
        if (data.routes?.[0]) {
            return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        }
    } catch (e) {
        console.warn("OSRM fallback to straight line:", e);
    }
    // Fallback straight line
    const steps = 30;
    return Array.from({ length: steps + 1 }, (_, i) => [
        fromLat + (toLat - fromLat) * (i / steps),
        fromLng + (toLng - fromLng) * (i / steps)
    ]);
}

/* =========================================
   SIMULATION ENGINE
========================================= */
async function startSimulation(deliveryId, fromLat, fromLng, destLat, destLng) {
    if (isSimulating) return;

    isSimulating     = true;
    activeDeliveryId = deliveryId;

    const statusBox = document.getElementById("map-status");
    if (statusBox) statusBox.innerHTML =
        `<i class="fa-solid fa-satellite-dish" style="color:#3b82f6;"></i> <strong>GPS Simulation Active</strong> — truck moving along route`;

    // Show banner
    showSimBanner();

    // Draw route on map
    const truckIcon = L.divIcon({
        className: "custom-truck-icon",
        html: `<div class="truck-marker"><i class="fa-solid fa-truck"></i></div>`,
        iconSize: [36, 36], iconAnchor: [18, 18]
    });

    if (!deliveryMarker) {
        deliveryMarker = L.marker([fromLat, fromLng], { icon: truckIcon })
            .addTo(map)
            .bindPopup(`<b>${deliveryId}</b><br>Status: En Route<br><small>Simulated GPS</small>`);
    } else {
        deliveryMarker.setLatLng([fromLat, fromLng]);
    }

    // Draw the full route line
    if (routeControl) { map.removeControl(routeControl); routeControl = null; }
    routeControl = L.Routing.control({
        waypoints: [L.latLng(fromLat, fromLng), L.latLng(destLat, destLng)],
        addWaypoints: false, routeWhileDragging: false,
        fitSelectedRoutes: true, show: false,
        lineOptions: { styles: [{ color: "#0d9488", opacity: 1, weight: 5 }] },
        createMarker: () => null
    }).addTo(map);

    // Fetch waypoints
    simWaypoints  = await fetchRouteWaypoints(fromLat, fromLng, destLat, destLng);
    simStepIndex  = 0;

    map.setView([fromLat, fromLng], SIM_ZOOM_LEVEL);

    if (simInterval) clearInterval(simInterval);
    simInterval = setInterval(async () => {
        if (simStepIndex >= simWaypoints.length) {
            clearInterval(simInterval);
            simInterval  = null;
            if (statusBox) statusBox.innerHTML =
                `<i class="fa-solid fa-flag-checkered" style="color:#059669;"></i> Arrived at destination — please mark as delivered`;
            updateSimBanner(simWaypoints.length, simWaypoints.length);
            return;
        }

        const [lat, lng] = simWaypoints[simStepIndex];
        simStepIndex++;

        // Move marker
        deliveryMarker.setLatLng([lat, lng]);
        map.setView([lat, lng], SIM_ZOOM_LEVEL);

        // Update route remaining
        if (routeControl) {
            routeControl.setWaypoints([L.latLng(lat, lng), L.latLng(destLat, destLng)]);
        }

        // Write to Firestore — admin sees it live
        try {
            await updateDoc(doc(db, "deliveries", deliveryId), {
                currentLat: lat,
                currentLng: lng
            });
        } catch (e) { console.warn("Firestore GPS write error:", e); }

        updateSimBanner(simStepIndex, simWaypoints.length);

    }, SIM_STEP_MS);
}

function stopSimulation() {
    if (simInterval) { clearInterval(simInterval); simInterval = null; }
    isSimulating     = false;
    simStepIndex     = 0;
    simWaypoints     = [];
    activeDeliveryId = null;
    hideSimBanner();
}

/* =========================================
   SIMULATION BANNER (driver side)
========================================= */
function showSimBanner() {
    let banner = document.getElementById("sim-banner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "sim-banner";
        banner.className = "sim-banner";
        const mapEl = document.getElementById("delivery-map");
        if (mapEl) mapEl.insertAdjacentElement("afterend", banner);
        else document.querySelector(".content")?.prepend(banner);
    }
    banner.innerHTML = `
        <div class="sim-banner-left">
            <i class="fa-solid fa-satellite-dish sim-pulse"></i>
            <div>
                <div class="sim-banner-title">GPS Simulation Active</div>
                <div class="sim-banner-sub">Demo mode — truck position updates live for admin view</div>
            </div>
        </div>
        <div class="sim-banner-right">
            <div class="sim-progress-wrap">
                <div class="sim-progress-bar" id="sim-progress-bar" style="width:0%"></div>
            </div>
            <span class="sim-progress-label" id="sim-progress-label">Starting…</span>
        </div>
    `;
    banner.style.display = "flex";
}

function updateSimBanner(current, total) {
    const bar   = document.getElementById("sim-progress-bar");
    const label = document.getElementById("sim-progress-label");
    const pct   = Math.round((current / total) * 100);
    if (bar)   bar.style.width   = pct + "%";
    if (label) label.textContent = `${pct}% complete (${current}/${total} steps)`;
}

function hideSimBanner() {
    const banner = document.getElementById("sim-banner");
    if (banner) banner.style.display = "none";
}

/* =========================================
   SENSOR WATCHER (threshold alerts)
========================================= */
function watchSensor() {
    const q = dbQuery(ref(database, "AquaFresh_Logs"), orderByKey(), limitToLast(1));
    onValue(q, (snapshot) => {
        if (!snapshot.exists()) return;
        let payload = null;
        snapshot.forEach(child => { payload = child.val(); });

        const messages = [];
        const temp = parseFloat(payload?.water_temp);
        const ph   = parseFloat(payload?.ph_level);
        if (!isNaN(temp)) {
            if (temp < 0) messages.push(`Water temp below 0°C (${temp.toFixed(1)}°C)`);
            else if (temp > 4) messages.push(`Water temp above 4°C (${temp.toFixed(1)}°C)`);
        }
        if (!isNaN(ph)) {
            if (ph < 6.5) messages.push(`pH below 6.5 (${ph.toFixed(2)})`);
            else if (ph > 7.5) messages.push(`pH above 7.5 (${ph.toFixed(2)})`);
        }

        const banner = document.getElementById("deliveryAlarmBanner");
        const list   = document.getElementById("deliveryAlarmMessages");
        const tsEl   = document.getElementById("deliveryAlarmTimestamp");
        if (!banner) return;

        if (messages.length === 0) { banner.hidden = true; return; }
        if (list) list.innerHTML = messages.map(m => `<li>${m}</li>`).join("");
        if (tsEl && payload?.timestamp) {
            const d = new Date(payload.timestamp < 1e12 ? payload.timestamp * 1000 : payload.timestamp);
            tsEl.textContent = `Last updated ${d.toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}`;
        }
        banner.hidden = false;
    });
}

/* =========================================
   HELPERS
========================================= */
function getStatusBadge(status) {
    const map = {
        pending:   `<span style="background:#fef9c3;color:#854d0e;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">Pending</span>`,
        en_route:  `<span style="background:#dbeafe;color:#1e40af;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">En Route</span>`,
        delivered: `<span style="background:#dcfce7;color:#166534;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">Delivered</span>`,
        delayed:   `<span style="background:#fee2e2;color:#991b1b;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">Delayed</span>`,
    };
    return map[status] || `<span>${status}</span>`;
}
