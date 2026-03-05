import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, doc, updateDoc, query, where, serverTimestamp, onSnapshot, orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let map;
let deliveryMarkers = {};
let deliveryRoutes = {}; 
let watchId = null;

const deliveriesCol = collection(db, "deliveries");
const usersCol = collection(db, "users");
const batchesCol = collection(db, "batches");

let selectedOrigin = { lat: null, lng: null, name: "" };
let selectedDest = { lat: null, lng: null, name: "" };

// NEW: A dictionary to translate ugly Firebase IDs into readable Batch Codes
let batchesMap = {}; 

document.addEventListener("DOMContentLoaded", initPage);

async function initPage() {
  const role = localStorage.getItem("role");

  // NEW: We await loadBatches FIRST for everyone, so the dictionary is ready before the table loads
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

/* =====================
   MAP INITIALIZATION
===================== */
function initMap() {
  map = L.map('delivery-map').setView([14.5995, 120.9842], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  document.getElementById('map-status').innerText = "Map loaded. Awaiting active deliveries.";
}

/* =====================
   LOCATION AUTOCOMPLETE API
===================== */
function setupLocationAutocomplete() {
  const originInput = document.getElementById("origin");
  const destInput = document.getElementById("destination");

  originInput.addEventListener("input", (e) => handleSearch(e.target.value, "origin"));
  destInput.addEventListener("input", (e) => handleSearch(e.target.value, "destination"));

  document.addEventListener("click", (e) => {
    if (e.target.id !== "origin") document.getElementById("origin-suggestions").style.display = "none";
    if (e.target.id !== "destination") document.getElementById("dest-suggestions").style.display = "none";
  });
}

let searchTimeout;
async function handleSearch(queryText, type) {
  clearTimeout(searchTimeout);
  const suggestionBox = document.getElementById(type === "origin" ? "origin-suggestions" : "dest-suggestions");
  
  if (queryText.length < 3) {
    suggestionBox.style.display = "none";
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${queryText}&limit=5&countrycodes=ph`);
      const results = await res.json();
      
      suggestionBox.innerHTML = "";
      if (results.length > 0) {
        suggestionBox.style.display = "block";
        results.forEach(place => {
          const div = document.createElement("div");
          div.className = "autocomplete-item";
          div.innerText = place.display_name;
          div.onclick = () => selectLocation(place, type);
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

/* =====================
   LOAD BATCHES & MAP DICTIONARY
===================== */
async function loadBatches() {
  const snapshot = await getDocs(batchesCol);
  const select = document.getElementById("batchSelect");
  
  if (select) select.innerHTML = `<option value="">Select Batch</option>`;
  
  snapshot.forEach(docSnap => {
    const bData = docSnap.data();
    // Grab the readable code
    const readableCode = bData.batchCode || bData.batch_code || docSnap.id;
    
    // Save to our dictionary map
    batchesMap[docSnap.id] = readableCode;
    
    if (select) {
        select.innerHTML += `<option value="${docSnap.id}">${readableCode}</option>`;
    }
  });
}

async function loadDrivers() {
  const q = query(usersCol, where("role", "==", "delivery"), where("status", "==", "active"));
  const snapshot = await getDocs(q);
  const select = document.getElementById("driverSelect");
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
  const batchId = document.getElementById("batchSelect").value;
  const driverId = document.getElementById("driverSelect").value;
  const truck = document.getElementById("truckSelect").value; 
  const eta = document.getElementById("eta").value;

  if (!deliveryCode || !batchId || !driverId || !truck || !selectedOrigin.lat || !selectedDest.lat) {
    alert("Please fill all fields, select a truck, and pick valid locations from the dropdown.");
    return;
  }

  const driverSnap = await getDocs(query(usersCol, where("__name__", "==", driverId)));
  let driverName = "";
  driverSnap.forEach(doc => driverName = doc.data().fullName);

  await addDoc(deliveriesCol, {
    deliveryCode, 
    batchId, 
    driverId, 
    driverName, 
    truck, 
    eta,
    origin: selectedOrigin.name, originLat: selectedOrigin.lat, originLng: selectedOrigin.lng,
    destination: selectedDest.name, destLat: selectedDest.lat, destLng: selectedDest.lng,
    status: "pending",
    createdAt: serverTimestamp(),
    currentLat: selectedOrigin.lat, 
    currentLng: selectedOrigin.lng,
    avgTemp: null
  });

  alert("Delivery created successfully!");
  
  // Reset Form
  document.getElementById("deliveryCode").value = "";
  document.getElementById("origin").value = "";
  document.getElementById("destination").value = "";
  document.getElementById("truckSelect").value = "";
  selectedOrigin = { lat: null, lng: null, name: "" };
  selectedDest = { lat: null, lng: null, name: "" };
  
  if(window.closeModal) window.closeModal("modal-new-delivery");
};

/* =====================
   REAL-TIME DELIVERIES LISTENER
===================== */
function listenToDeliveries() {
  const role = localStorage.getItem("role");
  const userId = localStorage.getItem("userId");

  let q = query(deliveriesCol, orderBy("createdAt", "desc"));
  if (role === "delivery") {
    q = query(deliveriesCol, where("driverId", "==", userId), orderBy("createdAt", "desc"));
  }

  const truckIcon = L.divIcon({
    className: 'custom-truck-icon',
    html: "<div class='truck-marker'><i class='fa-solid fa-truck'></i></div>",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  onSnapshot(q, (snapshot) => {
    const allBody = document.getElementById("all-deliveries-body");
    const pendingBody = document.getElementById("pending-body");
    const enrouteBody = document.getElementById("enroute-body");
    const deliveredBody = document.getElementById("delivered-body");
    const delayedBody = document.getElementById("delayed-body");

    allBody.innerHTML = "";
    pendingBody.innerHTML = "";
    enrouteBody.innerHTML = "";
    deliveredBody.innerHTML = "";
    delayedBody.innerHTML = "";

    let counts = { pending: 0, enroute: 0, delivered: 0, delayed: 0 };

    snapshot.forEach(docSnap => {
      const d = docSnap.data();
      const id = docSnap.id;

      // 1. Draw Routes
      if (d.originLat && d.destLat && !deliveryRoutes[id]) {
        deliveryRoutes[id] = L.Routing.control({
          waypoints: [L.latLng(d.originLat, d.originLng), L.latLng(d.destLat, d.destLng)],
          addWaypoints: false, routeWhileDragging: false, fitSelectedRoutes: true, showAlternatives: false,
          createMarker: function() { return null; }, 
          lineOptions: { styles: [{ color: '#3b82f6', opacity: 0.8, weight: 5 }] }
        }).addTo(map);
      }

      // 2. Update Map Marker
      if (d.currentLat && d.currentLng) {
        if (!deliveryMarkers[id]) {
          deliveryMarkers[id] = L.marker([d.currentLat, d.currentLng], { icon: truckIcon })
            .addTo(map).bindPopup(`<b>${d.deliveryCode}</b><br>Status: ${d.status}`);
        } else {
          deliveryMarkers[id].setLatLng([d.currentLat, d.currentLng]);
        }
      }

      // 3. Populate Tables
      let actionButton = "";
      if (role === "delivery") {
        if (d.status === "pending") actionButton = `<button class="start-btn" onclick="updateStatus('${id}', 'en_route')">Start Delivery</button>`;
        else if (d.status === "en_route") actionButton = `<button class="deliver-btn" onclick="updateStatus('${id}', 'delivered')">Mark Delivered</button>`;
      } else {
          actionButton = `<span class="status-${d.status}">${d.status.replace("_", " ")}</span>`;
      }

      // Formatting details
      const shortOrigin = d.origin ? d.origin.split(',')[0] : "-";
      const shortDest = d.destination ? d.destination.split(',')[0] : "-";
      const truckName = d.truck || "-";
      
      // FIX: Translate the ugly ID into the clean Batch Code using our dictionary
      const displayBatch = batchesMap[d.batchId] || d.batchId || "-"; 
      
      const formattedDate = d.eta ? new Date(d.eta).toLocaleString() : "-";
      const deliveredDate = d.deliveredAt ? d.deliveredAt.toDate().toLocaleString() : "-";

      // Row for Main Table
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

      // Distribute into Modals and increment counts
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

    // Update DOM counts
    document.getElementById("pending-count").textContent = counts.pending;
    document.getElementById("enroute-count").textContent = counts.enroute;
    document.getElementById("delivered-count").textContent = counts.delivered;
    document.getElementById("delayed-count").textContent = counts.delayed;

    document.getElementById("modal-pending-count").textContent = counts.pending;
    document.getElementById("modal-enroute-count").textContent = counts.enroute;
    document.getElementById("modal-delivered-count").textContent = counts.delivered;
    document.getElementById("modal-delayed-count").textContent = counts.delayed;
  });
}

/* =====================
   UPDATE STATUS & GPS
===================== */
window.updateStatus = async function (id, status) {
  const updateData = { status };
  if (status === "en_route") {
    updateData.startedAt = serverTimestamp();
    startTracking(id);
  }
  if (status === "delivered") {
    updateData.deliveredAt = serverTimestamp();
    stopTracking();
  }
  await updateDoc(doc(db, "deliveries", id), updateData);
};

function startTracking(deliveryId) {
  if (!navigator.geolocation) return;
  document.getElementById('map-status').innerText = "Tracking active. Broadcasting location...";
  watchId = navigator.geolocation.watchPosition(async position => {
    const lat = position.coords.latitude, lng = position.coords.longitude;
    if (deliveryMarkers[deliveryId]) deliveryMarkers[deliveryId].setLatLng([lat, lng]);
    await updateDoc(doc(db, "deliveries", deliveryId), { currentLat: lat, currentLng: lng });
  }, error => {
    document.getElementById('map-status').innerText = "GPS Error: " + error.message;
  }, { enableHighAccuracy: true });
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    document.getElementById('map-status').innerText = "Tracking stopped.";
  }
}