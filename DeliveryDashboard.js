import { db } from "./firebase.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
    listenToMyDeliveries();
});

function listenToMyDeliveries() {
    const userId = localStorage.getItem("userId");
    if (!userId) return;

    // FIX: Removed orderBy() from the query to prevent Firebase Index errors!
    const q = query(collection(db, "deliveries"), where("driverId", "==", userId));

    onSnapshot(q, (snapshot) => {
        const allBody = document.getElementById("all-deliveries-body");
        const pendingBody = document.getElementById("pending-body");
        const enrouteBody = document.getElementById("enroute-body");
        const deliveredBody = document.getElementById("delivered-body");
        const delayedBody = document.getElementById("delayed-body");
        const notifList = document.getElementById("notif-list");

        allBody.innerHTML = "";
        pendingBody.innerHTML = "";
        enrouteBody.innerHTML = "";
        deliveredBody.innerHTML = "";
        delayedBody.innerHTML = "";
        notifList.innerHTML = "";

        let counts = { pending: 0, enroute: 0, delivered: 0, delayed: 0 };
        let newNotifs = 0;

        if (snapshot.empty) {
            allBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">No deliveries assigned to you yet.</td></tr>`;
            notifList.innerHTML = `<div class="notif-item">No new deliveries.</div>`;
            document.getElementById("notif-count").style.display = "none";
            return;
        }

        // FIX: Safely sort the data in the browser instead of relying on Firebase indices
        let deliveriesArray = [];
        snapshot.forEach(docSnap => deliveriesArray.push({ id: docSnap.id, ...docSnap.data() }));
        deliveriesArray.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        deliveriesArray.forEach(d => {
            const id = d.id;

            const shortDest = d.destination ? d.destination.split(',')[0] : "-";
            const formattedDate = d.eta ? new Date(d.eta).toLocaleString() : "-";
            const deliveredDate = d.deliveredAt ? d.deliveredAt.toDate().toLocaleString() : "-";

            // Click to view Map Route!
            const viewMapBtn = `<a href="TransportDelivery.html?focus=${id}" class="btn-map"><i class="fa-solid fa-map-location-dot"></i> View Route</a>`;
            const statusBadge = `<span class="status-${d.status}">${d.status.replace("_", " ")}</span>`;

            // Main Table Row
            allBody.innerHTML += `
                <tr>
                    <td><strong>${d.deliveryCode}</strong></td>
                    <td>${shortDest}</td>
                    <td>${formattedDate}</td>
                    <td>${statusBadge}</td>
                    <td>${viewMapBtn}</td>
                </tr>
            `;

            // Sort into Categories & Notifications
            if (d.status === "pending") {
                counts.pending++;
                newNotifs++;
                
                // Add to Notification Dropdown
                notifList.innerHTML += `
                    <div class="notif-item" onclick="window.location.href='TransportDelivery.html?focus=${id}'">
                        <strong>New Delivery Assigned!</strong><br>
                        ${d.deliveryCode} to ${shortDest}
                    </div>
                `;

                pendingBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${shortDest}</td><td>${formattedDate}</td><td>${viewMapBtn}</td></tr>`;
            } 
            else if (d.status === "en_route") {
                counts.enroute++;
                enrouteBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${shortDest}</td><td>${formattedDate}</td><td>${viewMapBtn}</td></tr>`;
            } 
            else if (d.status === "delivered") {
                counts.delivered++;
                deliveredBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${shortDest}</td><td>${deliveredDate}</td><td>${statusBadge}</td></tr>`;
            } 
            else {
                counts.delayed++;
                delayedBody.innerHTML += `<tr><td><strong>${d.deliveryCode}</strong></td><td>${shortDest}</td><td>${formattedDate}</td><td>${viewMapBtn}</td></tr>`;
            }
        });

        // Update the Notification Bell Counter
        document.getElementById("notif-count").textContent = newNotifs;
        if (newNotifs === 0) {
            document.getElementById("notif-count").style.display = "none";
            notifList.innerHTML = `<div class="notif-item">No new deliveries.</div>`;
        } else {
            document.getElementById("notif-count").style.display = "flex";
        }
        
        // Update the big card numbers
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