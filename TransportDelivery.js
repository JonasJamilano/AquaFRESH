import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let map;
let deliveryMarkers = {};
let watchId = null;

const deliveriesCol = collection(db, "deliveries");
const usersCol = collection(db, "users");
const batchesCol = collection(db, "batches");

document.addEventListener("DOMContentLoaded", initPage);

async function initPage() {
  const role = localStorage.getItem("role");

  if (["superadmin", "admin", "manager"].includes(role)) {
    document.getElementById("createDeliveryPanel").style.display = "block";
    loadBatches();
    loadDrivers();
  }

  initMap();
  loadDeliveries();

  setInterval(loadDeliveries, 10000);
}

/* =====================
   MAP
===================== */
function initMap() {
  map = L.map('delivery-map').setView([14.5995, 120.9842], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  document.getElementById('map-status').innerText =
    "Map loaded. Awaiting active deliveries.";
}

/* =====================
   LOAD BATCHES
===================== */
async function loadBatches() {
  const snapshot = await getDocs(batchesCol);
  const select = document.getElementById("batchSelect");

  select.innerHTML = `<option value="">Select Batch</option>`;

  snapshot.forEach(docSnap => {
    const b = docSnap.data();
    select.innerHTML += `
      <option value="${docSnap.id}">${b.batchCode}</option>
    `;
  });
}

/* =====================
   LOAD DRIVERS
===================== */
async function loadDrivers() {
  const q = query(usersCol,
    where("role", "==", "delivery"),
    where("status", "==", "active")
  );

  const snapshot = await getDocs(q);
  const select = document.getElementById("driverSelect");

  select.innerHTML = `<option value="">Assign Driver</option>`;

  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    select.innerHTML += `
      <option value="${docSnap.id}">${d.fullName}</option>
    `;
  });
}

/* =====================
   CREATE DELIVERY
===================== */
window.createDelivery = async function () {

  const deliveryCode = document.getElementById("deliveryCode").value;
  const batchId = document.getElementById("batchSelect").value;
  const driverId = document.getElementById("driverSelect").value;
  const origin = document.getElementById("origin").value;
  const destination = document.getElementById("destination").value;
  const eta = document.getElementById("eta").value;

  if (!deliveryCode || !batchId || !driverId) {
    alert("Please fill required fields.");
    return;
  }

  // Get driver name
  const driverSnap = await getDocs(query(usersCol, where("__name__", "==", driverId)));
  let driverName = "";
  driverSnap.forEach(doc => driverName = doc.data().fullName);

  await addDoc(deliveriesCol, {
    deliveryCode,
    batchId,
    driverId,
    driverName,
    origin,
    destination,
    eta,
    status: "pending",
    createdAt: serverTimestamp(),
    currentLat: null,
    currentLng: null,
    avgTemp: null
  });

  alert("Delivery created successfully!");
  loadDeliveries();
};

/* =====================
   LOAD DELIVERIES
===================== */
async function loadDeliveries() {
  const role = localStorage.getItem("role");
  const userId = localStorage.getItem("userId");

  let snapshot;

  if (role === "delivery") {
    const q = query(deliveriesCol, where("driverId", "==", userId));
    snapshot = await getDocs(q);
  } else {
    snapshot = await getDocs(deliveriesCol);
  }

  const tbody = document.querySelector(".delivery-table tbody");
  tbody.innerHTML = "";

  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    const id = docSnap.id;

    if (d.currentLat && d.currentLng) {
      if (!deliveryMarkers[id]) {
        deliveryMarkers[id] = L.marker([d.currentLat, d.currentLng])
          .addTo(map)
          .bindPopup(`<b>${d.deliveryCode}</b><br>Status: ${d.status}`);
      } else {
        deliveryMarkers[id].setLatLng([d.currentLat, d.currentLng]);
      }
    }

    let actionButton = "";

    if (role === "delivery") {
      if (d.status === "pending") {
        actionButton = `
          <button class="start-btn"
            onclick="updateStatus('${id}', 'en_route')">
            Start Delivery
          </button>
        `;
      } else if (d.status === "en_route") {
        actionButton = `
          <button class="deliver-btn"
            onclick="updateStatus('${id}', 'delivered')">
            Mark Delivered
          </button>
        `;
      }
    }

    const row = `
      <tr>
        <td>${d.deliveryCode}</td>
        <td>${d.batchId}</td>
        <td>${d.destination || "-"}</td>
        <td>${d.avgTemp || "-"}</td>
        <td class="status-${d.status}">
          ${d.status.replace("_", " ")}
        </td>
        <td>${d.eta ? new Date(d.eta).toLocaleString() : "-"}</td>
        <td>${actionButton}</td>
      </tr>
    `;

    tbody.innerHTML += row;
  });
}

/* =====================
   UPDATE STATUS
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

  alert("Status updated to: " + status);
  loadDeliveries();
};

/* =====================
   GPS TRACKING
===================== */
function startTracking(deliveryId) {
  if (!navigator.geolocation) return;

  document.getElementById('map-status').innerText =
    "Tracking active. Broadcasting location...";

  watchId = navigator.geolocation.watchPosition(async position => {

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    if (!deliveryMarkers[deliveryId]) {
      deliveryMarkers[deliveryId] = L.marker([lat, lng]).addTo(map);
    } else {
      deliveryMarkers[deliveryId].setLatLng([lat, lng]);
    }

    await updateDoc(doc(db, "deliveries", deliveryId), {
      currentLat: lat,
      currentLng: lng
    });

  }, error => {
    document.getElementById('map-status').innerText =
      "GPS Error: " + error.message;
  }, { enableHighAccuracy: true });
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    document.getElementById('map-status').innerText =
      "Tracking stopped.";
  }
}