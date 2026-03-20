import { db } from "./firebase.js";
import { database } from "./firebase.js";
import {
  collection, addDoc, getDocs, doc, updateDoc, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    ref,
    onValue,
    query as dbQuery,
    orderByKey,
    limitToLast
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* =========================================
   MAP & DELIVERY STATE
========================================= */

let map;
let deliveryMarkers = {};
let deliveryRoutes  = {};
let watchId         = null;
let isNavigating    = false;

/* Current driver GPS position — updated by watchPosition */
let driverLat = null;
let driverLng = null;

/* Store markers currently on the map */
let storeMarkers = [];

/* Active store detour route — replaces delivery route temporarily */
let storeRoute       = null;
let savedDeliveryId  = null; // which delivery route was hidden for the detour

const deliveriesCol  = collection(db, "deliveries");
const usersCol       = collection(db, "users");
const inspectionsCol = collection(db, "inspections");

let selectedOrigin = { lat: null, lng: null, name: "" };
let selectedDest   = { lat: null, lng: null, name: "" };
let batchesMap     = {};

/* =========================================
   CONSTANTS
========================================= */

const LOGS_PATH          = "AquaFresh_Logs";
const LIVE_POLL_INTERVAL = 10_000; // 10 seconds
const STORE_SEARCH_RADIUS = 5000;  // 5 km in meters

/* =========================================
   ALERT SOUND — delivery role only
   Same Web Audio double-beep as other pages
========================================= */

let audioCtx         = null;
let alarmSoundActive = false;

function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playAlertSound() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;
        [0, 0.2].forEach((offset) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, now + offset);
            gain.gain.setValueAtTime(0,    now + offset);
            gain.gain.linearRampToValueAtTime(0.6, now + offset + 0.01);
            gain.gain.linearRampToValueAtTime(0,   now + offset + 0.08);
            osc.start(now + offset);
            osc.stop(now  + offset + 0.1);
        });
    } catch (err) { console.warn("Alert sound failed:", err); }
}

function handleAlarmSound(hasAlarms) {
    if (hasAlarms && !alarmSoundActive) { alarmSoundActive = true; playAlertSound(); }
    else if (!hasAlarms) { alarmSoundActive = false; }
}

function unlockAudio() {
    const unlock = () => {
        try { const ctx = getAudioContext(); if (ctx.state === "suspended") ctx.resume(); } catch (_) {}
    };
    document.addEventListener("click",      unlock, { once: true });
    document.addEventListener("keydown",    unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
}

/* =========================================
   THRESHOLD CHECKS
   temp  : alert if < 0 OR > 4 °C
   pH    : alert if < 6.5 OR > 7.5
========================================= */

function parseNumericValue(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const m = value.match(/-?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : Number.NaN;
    }
    return Number.NaN;
}

function getAlarmMessages(payload) {
    if (!payload) return [];
    const messages = [];
    const temp = parseNumericValue(payload.water_temp);
    const ph   = parseNumericValue(payload.ph_level);

    if (!Number.isNaN(temp)) {
        if (temp < 0) messages.push(`Water temperature dropped below 0°C (current: ${temp.toFixed(1)} °C)`);
        else if (temp > 4) messages.push(`Water temperature exceeded 4°C (current: ${temp.toFixed(1)} °C)`);
    }
    if (!Number.isNaN(ph)) {
        if (ph < 6.5) messages.push(`pH level dropped below 6.5 (current: ${ph.toFixed(2)})`);
        else if (ph > 7.5) messages.push(`pH level exceeded 7.5 (current: ${ph.toFixed(2)})`);
    }
    return messages;
}

/* =========================================
   THRESHOLD ALERT BANNER (on-map overlay)
   Shows/hides the floating red banner
   above the map. Clicking goes to Analytics.
========================================= */

function renderMapAlarmBanner(messages, timestamp) {
    const banner = document.getElementById("mapAlarmBanner");
    const list   = document.getElementById("mapAlarmMessages");
    const tsEl   = document.getElementById("mapAlarmTimestamp");

    if (!banner || !list) return;

    if (!messages || messages.length === 0) {
        banner.hidden = true;
        list.innerHTML = "";
        return;
    }

    list.innerHTML = messages.map(m => `<li>${m}</li>`).join("");

    if (tsEl && timestamp) {
        const d = new Date(typeof timestamp === "number"
            ? (timestamp < 1e12 ? timestamp * 1000 : timestamp)
            : timestamp);
        tsEl.textContent = isNaN(d.getTime()) ? "" : `Last updated ${d.toLocaleString([], {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        })}`;
    }

    banner.hidden = false;
}

/* =========================================
   NEAREST STORE FINDER
   Uses Overpass API to find convenience
   stores, supermarkets, and shops near
   the driver's current GPS position.
   Only runs when delivery is en_route
   AND a threshold alert is active.
========================================= */

let lastStoreFetchLat = null;
let lastStoreFetchLng = null;
let storeFetchActive  = false;

async function findNearestStores(lat, lng) {
    // Avoid refetching if driver hasn't moved much (within ~200m)
    if (lastStoreFetchLat !== null) {
        const dist = getDistanceMeters(lat, lng, lastStoreFetchLat, lastStoreFetchLng);
        if (dist < 200 && storeFetchActive) return;
    }

    lastStoreFetchLat = lat;
    lastStoreFetchLng = lng;
    storeFetchActive  = true;

    // Overpass query — searches for:
    // - convenience stores
    // - supermarkets
    // - shops selling ice
    // within STORE_SEARCH_RADIUS meters
    const radius = STORE_SEARCH_RADIUS;
    const overpassQuery = `
        [out:json][timeout:15];
        (
          node["shop"="convenience"](around:${radius},${lat},${lng});
          node["shop"="supermarket"](around:${radius},${lat},${lng});
          node["shop"="ice_cream"](around:${radius},${lat},${lng});
          node["shop"="frozen_food"](around:${radius},${lat},${lng});
          node["amenity"="ice_cream"](around:${radius},${lat},${lng});
          node["vending"="ice"](around:${radius},${lat},${lng});
        );
        out body;
    `;

    try {
        updateStoreStatus("Searching for nearby stores…", "loading");

        const res  = await fetch("https://overpass-api.de/api/interpreter", {
            method : "POST",
            body   : overpassQuery
        });
        const data = await res.json();
        const stores = data.elements || [];

        clearStoreMarkers();

        if (stores.length === 0) {
            updateStoreStatus("No nearby stores found within 5 km.", "empty");
            hideStorePanel();
            return;
        }

        // Sort by distance from driver
        const sorted = stores
            .map(s => ({
                ...s,
                distance: getDistanceMeters(lat, lng, s.lat, s.lon)
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 10); // show up to 10 nearest

        plotStoreMarkers(sorted, lat, lng);
        renderStoreList(sorted);
        updateStoreStatus(`Found ${sorted.length} store(s) within 5 km`, "ok");

    } catch (err) {
        console.error("Overpass API error:", err);
        updateStoreStatus("Could not load nearby stores. Check connection.", "error");
    }
}

function clearStoreMarkers() {
    storeMarkers.forEach(m => map.removeLayer(m));
    storeMarkers = [];
}

function plotStoreMarkers(stores, fromLat, fromLng) {
    const storeIcon = L.divIcon({
        className: "store-marker-icon",
        html: `<div class="store-marker"><i class="fa-solid fa-store"></i></div>`,
        iconSize:  [34, 34],
        iconAnchor:[17, 17]
    });

    stores.forEach((store, idx) => {
        const name   = store.tags?.name || "Unnamed Store";
        const type   = getStoreTypeLabel(store.tags);
        const distKm = (store.distance / 1000).toFixed(1);

        const marker = L.marker([store.lat, store.lon], { icon: storeIcon })
            .addTo(map)
            .bindPopup(`
                <div class="store-popup">
                    <div class="store-popup-name">${idx + 1}. ${name}</div>
                    <div class="store-popup-type">${type}</div>
                    <div class="store-popup-dist"><i class="fa-solid fa-location-dot"></i> ${distKm} km away</div>
                    <button
                        class="store-popup-directions"
                        onclick="navigateToStore(${store.lat}, ${store.lon}, '${name.replace(/'/g, "\\'")}')">
                        <i class="fa-solid fa-diamond-turn-right"></i> Get Directions
                    </button>
                </div>
            `, { maxWidth: 220 });

        storeMarkers.push(marker);
    });
}

function renderStoreList(stores) {
    const panel = document.getElementById("nearbyStoresPanel");
    const list  = document.getElementById("nearbyStoresList");
    if (!panel || !list) return;

    list.innerHTML = stores.map((store, idx) => {
        const name   = store.tags?.name || "Unnamed Store";
        const type   = getStoreTypeLabel(store.tags);
        const distKm = (store.distance / 1000).toFixed(1);

        return `
        <div class="store-list-item" onclick="focusStore(${store.lat}, ${store.lon})">
            <div class="store-list-num">${idx + 1}</div>
            <div class="store-list-info">
                <div class="store-list-name">${name}</div>
                <div class="store-list-meta">${type} · ${distKm} km away</div>
            </div>
            <i class="fa-solid fa-chevron-right store-list-arrow"></i>
        </div>`;
    }).join("");

    panel.hidden = false;
}

function hideStorePanel() {
    const panel = document.getElementById("nearbyStoresPanel");
    if (panel) panel.hidden = true;
}

function clearStoresAndHidePanel() {
    clearStoreMarkers();
    hideStorePanel();
    storeFetchActive  = false;
    lastStoreFetchLat = null;
    lastStoreFetchLng = null;
    updateStoreStatus("", "");
}

/* =========================================
   FIND NEARBY STORES — manual trigger
   Called when driver taps the banner button.
   Checks GPS is available first.
========================================= */

window.onFindStoresClicked = function () {
    if (!currentlyEnRoute) {
        showStoreBtnFeedback("Start your delivery first to find nearby stores.", "empty");
        return;
    }

    if (driverLat === null || driverLng === null) {
        showStoreBtnFeedback("Waiting for GPS signal… try again in a moment.", "loading");
        return;
    }

    // Scroll smoothly down to the map so driver can see the pins appear
    document.getElementById("delivery-map")?.scrollIntoView({ behavior: "smooth", block: "center" });

    findNearestStores(driverLat, driverLng);
};

/* Brief feedback shown on the store button itself */
function showStoreBtnFeedback(message, type) {
    updateStoreStatus(message, type);
    // Scroll to status line so driver sees it
    document.getElementById("storeSearchStatus")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* Focus map on a store when list item clicked */
window.focusStore = function(lat, lng) {
    if (map) map.setView([lat, lng], 17);
    storeMarkers.forEach(m => {
        const pos = m.getLatLng();
        if (Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lng) < 0.0001) {
            m.openPopup();
        }
    });
};

/* =========================================
   NAVIGATE TO STORE ON LEAFLET MAP
   Replaces the active delivery route with
   a new route from driver → chosen store.
   Shows a "Back to Delivery Route" button.
========================================= */

window.navigateToStore = function(storeLat, storeLng, storeName) {
    if (driverLat === null || driverLng === null) {
        alert("GPS position not available yet. Please wait a moment and try again.");
        return;
    }

    // Close any open popup
    map.closePopup();

    // Hide all active delivery routes temporarily
    Object.keys(deliveryRoutes).forEach(id => {
        const route = deliveryRoutes[id];
        if (route) {
            map.removeControl(route);
            savedDeliveryId = id; // remember which one to restore
        }
    });

    // Remove existing store route if any
    if (storeRoute) {
        map.removeControl(storeRoute);
        storeRoute = null;
    }

    // Draw new route: driver → store in blue
    storeRoute = L.Routing.control({
        waypoints: [
            L.latLng(driverLat, driverLng),
            L.latLng(storeLat, storeLng)
        ],
        addWaypoints      : false,
        routeWhileDragging: false,
        fitSelectedRoutes : true,
        show              : false,
        lineOptions: {
            styles: [{ color: '#0ea5e9', opacity: 1, weight: 6 }]
        },
        createMarker: () => null
    }).addTo(map);

    storeRoute.on('routesfound', function(e) {
        const route      = e.routes[0];
        const distKm     = (route.summary.totalDistance / 1000).toFixed(1);
        const minutes    = Math.round(route.summary.totalTime / 60);
        const statusBox  = document.getElementById('map-status');
        if (statusBox) {
            statusBox.innerHTML = `
                <i class="fa-solid fa-store" style="color:#0ea5e9;"></i>
                <b>Detour to ${storeName}:</b>
                ${distKm} km · ~${minutes} min
                &nbsp;
                <button class="back-to-delivery-btn" onclick="backToDeliveryRoute()">
                    <i class="fa-solid fa-rotate-left"></i> Back to Delivery Route
                </button>`;
        }
    });

    // Update store status line
    updateStoreStatus(`Routing to ${storeName}…`, "loading");
};

/* Restores the original delivery route */
window.backToDeliveryRoute = function() {
    // Remove store route
    if (storeRoute) {
        map.removeControl(storeRoute);
        storeRoute = null;
    }

    // Restore the saved delivery route
    if (savedDeliveryId && deliveryRoutes[savedDeliveryId]) {
        deliveryRoutes[savedDeliveryId].addTo(map);
    }

    savedDeliveryId = null;

    const statusBox = document.getElementById('map-status');
    if (statusBox) {
        statusBox.innerHTML = `
            <i class="fa-solid fa-location-crosshairs" style="color:#059669;"></i>
            Navigation Mode Active`;
    }

    updateStoreStatus("", "");
};

function getStoreTypeLabel(tags) {
    if (!tags) return "Store";
    if (tags.shop === "convenience")   return "Convenience Store";
    if (tags.shop === "supermarket")   return "Supermarket";
    if (tags.shop === "ice_cream")     return "Ice Cream / Ice Shop";
    if (tags.shop === "frozen_food")   return "Frozen Food Store";
    if (tags.amenity === "ice_cream")  return "Ice Cream Shop";
    if (tags.vending === "ice")        return "Ice Vending Machine";
    return "Store";
}

function updateStoreStatus(message, type) {
    const el = document.getElementById("storeSearchStatus");
    if (!el) return;

    const colors = {
        loading: "#0ea5e9",
        ok     : "#16a34a",
        empty  : "#94a3b8",
        error  : "#dc2626",
        ""     : "#94a3b8"
    };

    const icons = {
        loading: `<i class="fa-solid fa-spinner fa-spin"></i>`,
        ok     : `<i class="fa-solid fa-check-circle"></i>`,
        empty  : `<i class="fa-solid fa-inbox"></i>`,
        error  : `<i class="fa-solid fa-triangle-exclamation"></i>`,
        ""     : ""
    };

    el.style.color   = colors[type] || "#94a3b8";
    el.innerHTML     = message ? `${icons[type] || ""} ${message}` : "";
    el.style.display = message ? "flex" : "none";
}

/* Haversine distance in meters */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R    = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180)
               * Math.cos(lat2 * Math.PI / 180)
               * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* =========================================
   SENSOR WATCHER — every 10 seconds
   Checks thresholds and decides whether to:
   - show/hide the map alarm banner
   - play the alert sound
   - trigger the store finder (if en_route)
========================================= */

let currentlyEnRoute = false; // true when driver has an active en_route delivery

function startSensorWatch() {
    watchSensor();
    setInterval(watchSensor, LIVE_POLL_INTERVAL);
}

function watchSensor() {
    const latestQuery = dbQuery(
        ref(database, LOGS_PATH),
        orderByKey(),
        limitToLast(1)
    );

    onValue(latestQuery, (snapshot) => {
        if (!snapshot.exists()) return;

        let payload = null;
        snapshot.forEach((child) => { payload = child.val(); });

        const messages  = getAlarmMessages(payload);
        const hasAlarms = messages.length > 0;
        const timestamp = payload?.timestamp ?? Date.now();

        renderMapAlarmBanner(messages, timestamp);
        handleAlarmSound(hasAlarms);

        // If alarm cleared — remove store markers and hide panel
        if (!hasAlarms && storeFetchActive) {
            clearStoresAndHidePanel();
        }

    }, (error) => { console.warn("Sensor watch error on TransportDelivery:", error); });
}

/* =========================================
   INIT
========================================= */

document.addEventListener("DOMContentLoaded", initPage);

async function initPage() {
    const role = localStorage.getItem("role");

    unlockAudio();
    await loadBatches();

    if (["superadmin", "admin", "manager"].includes(role)) {
        const triggerWrap = document.getElementById("createDeliveryWrapper");
        if (triggerWrap) triggerWrap.style.display = "block";

        loadDrivers();
        setupLocationAutocomplete();

        document.getElementById("btn-new-delivery")?.addEventListener("click", async () => {
            const preview = document.getElementById("deliveryCodeDisplay");
            if (preview) {
                preview.value = "Generating...";
                preview.value = await generateDeliveryCode();
            }
        });
    }

    initMap();
    listenToDeliveries();
    startSensorWatch();
}

/* =========================================
   AUTO-GENERATE DELIVERY CODE
========================================= */

async function generateDeliveryCode() {
    try {
        const snapshot = await getDocs(deliveriesCol);
        let maxNum = 0;
        snapshot.forEach(d => {
            const code  = d.data().deliveryCode || "";
            const match = code.match(/^D-(\d+)$/i);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        });
        return "D-" + String(maxNum + 1).padStart(2, "0");
    } catch (e) {
        console.error("Could not generate delivery code:", e);
        return "D-01";
    }
}

/* =========================================
   MAP INITIALIZATION
========================================= */

function initMap() {
    map = L.map('delivery-map').setView([14.5995, 120.9842], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    document.getElementById('map-status').innerText = "Map loaded. Awaiting active deliveries.";
}

/* =========================================
   LOCATION AUTOCOMPLETE
========================================= */

function setupLocationAutocomplete() {
    const originInput = document.getElementById("origin");
    const destInput   = document.getElementById("destination");

    originInput.addEventListener("input", (e) => handleSearch(e.target.value, "origin"));
    destInput.addEventListener("input",   (e) => handleSearch(e.target.value, "destination"));

    document.addEventListener("click", (e) => {
        if (e.target.id !== "origin")      document.getElementById("origin-suggestions").style.display = "none";
        if (e.target.id !== "destination") document.getElementById("dest-suggestions").style.display   = "none";
    });
}

let searchTimeout;
async function handleSearch(queryText, type) {
    clearTimeout(searchTimeout);
    const suggestionBox = document.getElementById(type === "origin" ? "origin-suggestions" : "dest-suggestions");
    if (queryText.length < 3) { suggestionBox.style.display = "none"; return; }

    searchTimeout = setTimeout(async () => {
        try {
            const res     = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${queryText}&limit=5&countrycodes=ph`);
            const results = await res.json();
            suggestionBox.innerHTML = "";
            if (results.length > 0) {
                suggestionBox.style.display = "block";
                results.forEach(place => {
                    const div     = document.createElement("div");
                    div.className = "autocomplete-item";
                    div.innerText = place.display_name;
                    div.onclick   = () => selectLocation(place, type);
                    suggestionBox.appendChild(div);
                });
            } else {
                suggestionBox.style.display = "none";
            }
        } catch (err) { console.error("Geocoding error", err); }
    }, 500);
}

function selectLocation(place, type) {
    if (type === "origin") {
        document.getElementById("origin").value = place.display_name;
        selectedOrigin = { lat: parseFloat(place.lat), lng: parseFloat(place.lon), name: place.display_name };
        document.getElementById("origin-suggestions").style.display = "none";
    } else {
        document.getElementById("destination").value = place.display_name;
        selectedDest = { lat: parseFloat(place.lat), lng: parseFloat(place.lon), name: place.display_name };
        document.getElementById("dest-suggestions").style.display = "none";
    }
}

/* =========================================
   LOAD BATCHES
========================================= */

async function loadBatches() {
    const select = document.getElementById("batchSelect");
    if (select) select.innerHTML = `<option value="">Select Batch</option>`;

    try {
        const passedSnap = await getDocs(query(inspectionsCol, where("overallStatus", "==", "Passed")));
        if (passedSnap.empty) {
            if (select) select.innerHTML += `<option value="" disabled>No passed batches available</option>`;
            return;
        }

        const deliveriesSnap = await getDocs(deliveriesCol);
        const usedBatchIds   = new Set();
        deliveriesSnap.forEach(d => { if (d.data().batchId) usedBatchIds.add(d.data().batchId); });

        passedSnap.forEach(docSnap => {
            batchesMap[docSnap.id] = docSnap.data().batchCode || docSnap.id;
        });

        let availableCount = 0;
        passedSnap.forEach(docSnap => {
            if (usedBatchIds.has(docSnap.id)) return;
            availableCount++;
            if (select) select.innerHTML += `<option value="${docSnap.id}">${batchesMap[docSnap.id]}</option>`;
        });

        if (availableCount === 0 && select) {
            select.innerHTML += `<option value="" disabled>All passed batches are already scheduled</option>`;
        }
    } catch (err) { console.error("Error loading batches:", err); }
}

async function loadDrivers() {
    const q        = query(usersCol, where("role", "==", "delivery"), where("status", "==", "active"));
    const snapshot = await getDocs(q);
    const select   = document.getElementById("driverSelect");
    select.innerHTML = `<option value="">Assign Driver</option>`;
    snapshot.forEach(docSnap => {
        select.innerHTML += `<option value="${docSnap.id}">${docSnap.data().fullName}</option>`;
    });
}

/* =========================================
   CREATE DELIVERY
========================================= */

window.createDelivery = async function () {
    const batchId  = document.getElementById("batchSelect").value;
    const driverId = document.getElementById("driverSelect").value;
    const truck    = document.getElementById("truckSelect").value;
    const eta      = document.getElementById("eta").value;

    if (!batchId || !driverId || !truck || !selectedOrigin.lat || !selectedDest.lat) {
        alert("Please fill all fields, select a truck, and pick valid locations from the dropdown.");
        return;
    }

    const deliveryCode = document.getElementById("deliveryCodeDisplay").value || await generateDeliveryCode();
    const driverSnap   = await getDocs(query(usersCol, where("__name__", "==", driverId)));
    let driverName     = "";
    driverSnap.forEach(d => driverName = d.data().fullName);

    await addDoc(deliveriesCol, {
        deliveryCode,
        batchId,
        driverId,
        driverName,
        truck,
        eta,
        origin:      selectedOrigin.name,
        originLat:   selectedOrigin.lat,
        originLng:   selectedOrigin.lng,
        destination: selectedDest.name,
        destLat:     selectedDest.lat,
        destLng:     selectedDest.lng,
        status:      "pending",
        createdAt:   serverTimestamp(),
        currentLat:  selectedOrigin.lat,
        currentLng:  selectedOrigin.lng,
        avgTemp:     null
    });

    alert(`Delivery ${deliveryCode} created successfully!`);

    document.getElementById("origin").value      = "";
    document.getElementById("destination").value = "";
    document.getElementById("truckSelect").value = "";
    document.getElementById("deliveryCodeDisplay").value = "";
    selectedOrigin = { lat: null, lng: null, name: "" };
    selectedDest   = { lat: null, lng: null, name: "" };

    await loadBatches();
    if (window.closeModal) window.closeModal("modal-new-delivery");
};

/* =========================================
   REAL-TIME DELIVERIES LISTENER
========================================= */

function listenToDeliveries() {
    const role   = localStorage.getItem("role");
    const userId = localStorage.getItem("userId");

    let q = query(deliveriesCol);
    if (role === "delivery") {
        q = query(deliveriesCol, where("driverId", "==", userId));
    }

    const truckIcon = L.divIcon({
        className: 'custom-truck-icon',
        html:      "<div class='truck-marker'><i class='fa-solid fa-truck'></i></div>",
        iconSize:  [36, 36],
        iconAnchor:[18, 18]
    });

    onSnapshot(q, (snapshot) => {
        const allBody       = document.getElementById("all-deliveries-body");
        const pendingBody   = document.getElementById("pending-body");
        const enrouteBody   = document.getElementById("enroute-body");
        const deliveredBody = document.getElementById("delivered-body");
        const delayedBody   = document.getElementById("delayed-body");

        allBody.innerHTML       = "";
        pendingBody.innerHTML   = "";
        enrouteBody.innerHTML   = "";
        deliveredBody.innerHTML = "";
        delayedBody.innerHTML   = "";

        let counts = { pending: 0, enroute: 0, delivered: 0, delayed: 0 };

        let docsArray = [];
        snapshot.forEach(docSnap => docsArray.push({ id: docSnap.id, ...docSnap.data() }));
        docsArray.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        // Track if ANY delivery is en_route for this driver
        currentlyEnRoute = docsArray.some(d => d.status === "en_route");

        docsArray.forEach(d => {
            const id = d.id;

            if (d.status === "delivered") {
                if (deliveryMarkers[id]) { map.removeLayer(deliveryMarkers[id]); delete deliveryMarkers[id]; }
                if (deliveryRoutes[id])  { map.removeControl(deliveryRoutes[id]); delete deliveryRoutes[id]; }
            } else {
                if (d.originLat && d.destLat && !deliveryRoutes[id]) {
                    deliveryRoutes[id] = L.Routing.control({
                        waypoints:          [L.latLng(d.currentLat || d.originLat, d.currentLng || d.originLng), L.latLng(d.destLat, d.destLng)],
                        addWaypoints:       false,
                        routeWhileDragging: false,
                        fitSelectedRoutes:  true,
                        show:               true,
                        showAlternatives:   true,
                        altLineOptions: {
                            styles: [
                                { color: 'black',   opacity: 0.15, weight: 9   },
                                { color: 'white',   opacity: 0.8,  weight: 6   },
                                { color: '#64748b', opacity: 0.9,  weight: 4.5 }
                            ]
                        },
                        lineOptions:  { styles: [{ color: '#0d9488', opacity: 1, weight: 6 }] },
                        createMarker: function() { return null; }
                    }).addTo(map);

                    deliveryRoutes[id].on('routeselected', function(e) {
                        const route      = e.route;
                        const distanceKm = (route.summary.totalDistance / 1000).toFixed(1);
                        const hours      = Math.floor(route.summary.totalTime / 3600);
                        const minutes    = Math.round((route.summary.totalTime % 3600) / 60);
                        const timeString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} mins`;
                        const statusBox  = document.getElementById('map-status');
                        if (statusBox) {
                            statusBox.innerHTML = `<i class="fa-solid fa-route" style="color:#0f766e;"></i> <b>Route:</b> ${distanceKm} km | Est. Time: <span style="color:#0f766e; font-weight:700;">${timeString}</span>`;
                        }
                    });
                }

                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.get('focus') === id && !isNavigating) {
                    map.setView([d.currentLat || d.originLat, d.currentLng || d.originLng], 14);
                }

                if (d.currentLat && d.currentLng) {
                    if (!deliveryMarkers[id]) {
                        deliveryMarkers[id] = L.marker([d.currentLat, d.currentLng], { icon: truckIcon })
                            .addTo(map)
                            .bindPopup(`<b>${d.deliveryCode}</b><br>Status: ${d.status.replace("_", " ")}`);
                    } else {
                        deliveryMarkers[id].setLatLng([d.currentLat, d.currentLng]);
                        deliveryMarkers[id].getPopup().setContent(`<b>${d.deliveryCode}</b><br>Status: ${d.status.replace("_", " ")}`);
                    }
                }

                if (role === "delivery" && d.status === "en_route" && !isNavigating) {
                    startTracking(id, d.destLat, d.destLng);
                }
            }

            let actionButton = "";
            if (role === "delivery") {
                if (d.status === "pending")  actionButton = `<button class="start-btn"   onclick="updateStatus('${id}', 'en_route', ${d.destLat}, ${d.destLng})">Start Delivery</button>`;
                if (d.status === "en_route") actionButton = `<button class="deliver-btn" onclick="updateStatus('${id}', 'delivered')">Mark Delivered</button>`;
            } else {
                actionButton = `<span class="status-${d.status}">${d.status.replace("_", " ")}</span>`;
            }

            const shortOrigin   = d.origin      ? d.origin.split(',')[0]      : "-";
            const shortDest     = d.destination ? d.destination.split(',')[0] : "-";
            const truckName     = d.truck       || "-";
            const displayBatch  = batchesMap[d.batchId] || d.batchId || "-";
            const formattedDate = d.eta         ? new Date(d.eta).toLocaleString() : "-";
            const deliveredDate = d.deliveredAt ? d.deliveredAt.toDate().toLocaleString() : "-";

            allBody.innerHTML += `
                <tr>
                    <td><strong>${d.deliveryCode}</strong></td>
                    <td>${displayBatch}</td>
                    <td>${truckName}</td>
                    <td>${shortOrigin}</td>
                    <td>${shortDest}</td>
                    <td>${d.avgTemp || "-"}</td>
                    <td>${formattedDate}</td>
                    <td>${actionButton}</td>
                </tr>`;

            if (d.status === "pending") {
                counts.pending++;
                pendingBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${displayBatch}</td><td>${truckName}</td><td>${shortOrigin}</td><td>${shortDest}</td><td>${formattedDate}</td><td>${actionButton}</td></tr>`;
            } else if (d.status === "en_route") {
                counts.enroute++;
                enrouteBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${displayBatch}</td><td>${truckName}</td><td>${shortOrigin}</td><td>${shortDest}</td><td>${formattedDate}</td><td>${actionButton}</td></tr>`;
            } else if (d.status === "delivered") {
                counts.delivered++;
                deliveredBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${displayBatch}</td><td>${truckName}</td><td>${shortOrigin}</td><td>${shortDest}</td><td>${deliveredDate}</td><td><span class="status-delivered">Delivered</span></td></tr>`;
            } else {
                counts.delayed++;
                delayedBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${displayBatch}</td><td>${truckName}</td><td>${shortOrigin}</td><td>${shortDest}</td><td>${formattedDate}</td><td>${actionButton}</td></tr>`;
            }
        });

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
   UPDATE STATUS & GPS TRACKING
========================================= */

window.updateStatus = async function (id, status, destLat = null, destLng = null) {
    const updateData = { status };

    if (status === "en_route") {
        updateData.startedAt = serverTimestamp();
        startTracking(id, destLat, destLng);
    }

    if (status === "delivered") {
        updateData.deliveredAt = serverTimestamp();
        stopTracking();
        clearStoresAndHidePanel();
        await loadBatches();
    }

    await updateDoc(doc(db, "deliveries", id), updateData);
};

function startTracking(deliveryId, destLat, destLng) {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(position => {
        isNavigating = true;
        document.getElementById('map-status').innerHTML =
            `<i class="fa-solid fa-location-crosshairs" style="color:#059669;"></i> Navigation Mode Active`;

        watchId = navigator.geolocation.watchPosition(async pos => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            // Keep driver position updated for store search
            driverLat = lat;
            driverLng = lng;

            map.setView([lat, lng], 18);

            if (deliveryMarkers[deliveryId]) deliveryMarkers[deliveryId].setLatLng([lat, lng]);

            if (deliveryRoutes[deliveryId] && destLat && destLng) {
                deliveryRoutes[deliveryId].setWaypoints([
                    L.latLng(lat, lng),
                    L.latLng(destLat, destLng)
                ]);
            }

            await updateDoc(doc(db, "deliveries", deliveryId), { currentLat: lat, currentLng: lng });

        }, error => {
            console.error(error);
            document.getElementById('map-status').innerText = "GPS Error: Please enable location services.";
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });

    }, error => {
        alert("Location permission denied. Please enable location access for this site.");
        console.error(error);
    });
}

function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        isNavigating  = false;
        driverLat     = null;
        driverLng     = null;
        document.getElementById('map-status').innerText = "Tracking stopped. Delivery completed.";
        map.setZoom(12);
    }
}