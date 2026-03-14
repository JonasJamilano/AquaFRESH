import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, doc, updateDoc, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let map;
let deliveryMarkers = {};
let deliveryRoutes = {}; 
let watchId = null;
let isNavigating = false;

const deliveriesCol  = collection(db, "deliveries");
const usersCol       = collection(db, "users");
const inspectionsCol = collection(db, "inspections");

let selectedOrigin = { lat: null, lng: null, name: "" };
let selectedDest   = { lat: null, lng: null, name: "" };

let batchesMap = {};

document.addEventListener("DOMContentLoaded", initPage);

async function initPage() {
  const role = localStorage.getItem("role");

  await loadBatches();

  if (["superadmin", "admin", "manager"].includes(role)) {
    const triggerWrap = document.getElementById("createDeliveryWrapper");
    if (triggerWrap) triggerWrap.style.display = "block";

    loadDrivers();
    setupLocationAutocomplete();
  }

  initMap();
  listenToDeliveries();
}

/* ===================
   MAP INITIALIZATION
===================== */
function initMap() {
  map = L.map('delivery-map').setView([14.5995, 120.9842], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  document.getElementById('map-status').innerText = "Map loaded. Awaiting active deliveries.";
}

/* ===================
   LOCATION AUTOCOMPLETE
===================== */
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

/* =====================================================================
   LOAD BATCHES
   Rules:
     1. Only inspections with overallStatus === "Passed" are candidates.
     2. If a batch is already linked to ANY delivery (pending, en_route,
        delayed, or delivered), it is hidden — it has already been used.
     3. Only truly unscheduled Passed batches appear in the dropdown.
======================================================================= */
async function loadBatches() {
  const select = document.getElementById("batchSelect");
  if (select) select.innerHTML = `<option value="">Select Batch</option>`;

  try {
    // Step 1: Get all Passed inspections
    const passedSnap = await getDocs(
      query(inspectionsCol, where("overallStatus", "==", "Passed"))
    );

    if (passedSnap.empty) {
      if (select) select.innerHTML += `<option value="" disabled>No passed batches available</option>`;
      return;
    }

    // Step 2: Collect all batchIds already used in any delivery
    const deliveriesSnap = await getDocs(deliveriesCol);
    const usedBatchIds   = new Set();
    deliveriesSnap.forEach(d => {
      const data = d.data();
      if (data.batchId) usedBatchIds.add(data.batchId);
    });

    // Step 3: Populate batchesMap for ALL passed batches (so table rows
    //         can still resolve a batch name even after it's been used)
    passedSnap.forEach(docSnap => {
      const data      = docSnap.data();
      const batchCode = data.batchCode || docSnap.id;
      batchesMap[docSnap.id] = batchCode;
    });

    // Step 4: Only add UNUSED batches to the dropdown
    let availableCount = 0;
    passedSnap.forEach(docSnap => {
      if (usedBatchIds.has(docSnap.id)) return; // already scheduled — skip

      availableCount++;
      if (select) {
        select.innerHTML += `<option value="${docSnap.id}">${batchesMap[docSnap.id]}</option>`;
      }
    });

    if (availableCount === 0 && select) {
      select.innerHTML += `<option value="" disabled>All passed batches are already scheduled</option>`;
    }

  } catch (err) {
    console.error("Error loading batches:", err);
  }
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

/* =====================
   CREATE DELIVERY
===================== */
window.createDelivery = async function () {
  const deliveryCode = document.getElementById("deliveryCode").value;
  const batchId      = document.getElementById("batchSelect").value;
  const driverId     = document.getElementById("driverSelect").value;
  const truck        = document.getElementById("truckSelect").value;
  const eta          = document.getElementById("eta").value;

  if (!deliveryCode || !batchId || !driverId || !truck || !selectedOrigin.lat || !selectedDest.lat) {
    alert("Please fill all fields, select a truck, and pick valid locations from the dropdown.");
    return;
  }

  const driverSnap = await getDocs(query(usersCol, where("__name__", "==", driverId)));
  let driverName   = "";
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

  alert("Delivery created successfully!");

  // Reset form fields
  document.getElementById("deliveryCode").value = "";
  document.getElementById("origin").value       = "";
  document.getElementById("destination").value  = "";
  document.getElementById("truckSelect").value  = "";
  selectedOrigin = { lat: null, lng: null, name: "" };
  selectedDest   = { lat: null, lng: null, name: "" };

  // Refresh dropdown — the batch just used will now be hidden
  await loadBatches();

  if (window.closeModal) window.closeModal("modal-new-delivery");
};

/* =====================
   REAL-TIME DELIVERIES LISTENER
===================== */
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

    docsArray.forEach(d => {
      const id = d.id;

      // ── MAP: clean up when delivered ──
      if (d.status === "delivered") {
        if (deliveryMarkers[id]) { map.removeLayer(deliveryMarkers[id]); delete deliveryMarkers[id]; }
        if (deliveryRoutes[id])  { map.removeControl(deliveryRoutes[id]); delete deliveryRoutes[id]; }
      } else {
        // Draw route
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

        // Focus zoom
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('focus') === id && !isNavigating) {
          map.setView([d.currentLat || d.originLat, d.currentLng || d.originLng], 14);
        }

        // Update marker
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
      }

      // ── TABLE ROWS ──
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

/* =====================
   UPDATE STATUS & GPS TRACKING
===================== */
window.updateStatus = async function (id, status, destLat = null, destLng = null) {
  const updateData = { status };

  if (status === "en_route") {
    updateData.startedAt = serverTimestamp();
    startTracking(id, destLat, destLng);
  }

  if (status === "delivered") {
    updateData.deliveredAt = serverTimestamp();
    stopTracking();
    // Refresh the dropdown — the delivered batch stays hidden
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
    isNavigating = false;
    document.getElementById('map-status').innerText = "Tracking stopped. Delivery completed.";
    map.setZoom(12);
  }
}