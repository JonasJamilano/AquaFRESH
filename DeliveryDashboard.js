import { db } from "./firebase.js";
import { database } from "./firebase.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    ref,
    onValue,
    query as dbQuery,
    orderByKey,
    limitToLast
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* =========================================
   CONSTANTS
========================================= */

const LOGS_PATH          = "AquaFresh_Logs";
const LIVE_POLL_INTERVAL = 10_000; // 10 seconds

/* =========================================
   ALERT SOUND
   Same system as AnalyticsReporting.js.
   Uses Web Audio API — no external file.
   Plays a short double-beep when threshold
   is breached. Delivery role only.
========================================= */

let audioCtx         = null;
let alarmSoundActive = false;

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playAlertSound() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        // Two beeps — 80ms each, 200ms apart
        [0, 0.2].forEach((offset) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = "sine";
            osc.frequency.setValueAtTime(880, now + offset); // A5 tone

            gain.gain.setValueAtTime(0,    now + offset);
            gain.gain.linearRampToValueAtTime(0.6, now + offset + 0.01);
            gain.gain.linearRampToValueAtTime(0,   now + offset + 0.08);

            osc.start(now + offset);
            osc.stop(now  + offset + 0.1);
        });
    } catch (err) {
        console.warn("Alert sound failed:", err);
    }
}

function handleAlarmSound(hasAlarms) {
    if (hasAlarms && !alarmSoundActive) {
        alarmSoundActive = true;
        playAlertSound();
    } else if (!hasAlarms) {
        alarmSoundActive = false; // reset so next alarm plays again
    }
}

function unlockAudio() {
    const unlock = () => {
        try {
            const ctx = getAudioContext();
            if (ctx.state === "suspended") ctx.resume();
        } catch (_) {}
    };

    document.addEventListener("click",      unlock, { once: true });
    document.addEventListener("keydown",    unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
}

/* =========================================
   THRESHOLD CHECKS
   temperature : alert if < 0 OR > 4 °C
   pH          : alert if >= 7.7
========================================= */

function parseNumericValue(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const match = value.match(/-?\d+(?:\.\d+)?/);
        return match ? parseFloat(match[0]) : Number.NaN;
    }
    return Number.NaN;
}

function checkThresholds(payload) {
    if (!payload) return false;

    const temp = parseNumericValue(payload.water_temp);
    const ph   = parseNumericValue(payload.ph_level);

    const tempAlert = !Number.isNaN(temp) && (temp < 0 || temp > 4);
    const phAlert   = !Number.isNaN(ph)   && ph >= 7.7;

    return tempAlert || phAlert;
}

/* =========================================
   LIVE SENSOR POLLING — every 10 seconds
   Runs in the background on this page too.
   Only purpose here is to trigger the sound.
========================================= */

function startSensorWatch() {
    watchSensor(); // immediate
    setInterval(watchSensor, LIVE_POLL_INTERVAL);
}

function watchSensor() {
    const latestQuery = dbQuery(
        ref(database, LOGS_PATH),
        orderByKey(),
        limitToLast(1)
    );

    onValue(
        latestQuery,
        (snapshot) => {
            if (!snapshot.exists()) return;

            let payload = null;
            snapshot.forEach((child) => { payload = child.val(); });

            const hasAlarms = checkThresholds(payload);
            handleAlarmSound(hasAlarms);
        },
        (error) => {
            console.warn("Sensor watch error on DeliveryDashboard:", error);
        }
    );
}

/* =========================================
   INIT
========================================= */

document.addEventListener("DOMContentLoaded", () => {
    unlockAudio();
    startSensorWatch();
    listenToMyDeliveries();
});

/* =========================================
   DELIVERIES — original logic (unchanged)
========================================= */

function listenToMyDeliveries() {
    const userId = localStorage.getItem("userId");
    if (!userId) return;

    // FIX: Removed orderBy() from the query to prevent Firebase Index errors!
    const q = query(collection(db, "deliveries"), where("driverId", "==", userId));

    onSnapshot(q, (snapshot) => {
        const allBody       = document.getElementById("all-deliveries-body");
        const pendingBody   = document.getElementById("pending-body");
        const enrouteBody   = document.getElementById("enroute-body");
        const deliveredBody = document.getElementById("delivered-body");
        const delayedBody   = document.getElementById("delayed-body");
        const notifList     = document.getElementById("notif-list");

        allBody.innerHTML       = "";
        pendingBody.innerHTML   = "";
        enrouteBody.innerHTML   = "";
        deliveredBody.innerHTML = "";
        delayedBody.innerHTML   = "";
        notifList.innerHTML     = "";

        let counts   = { pending: 0, enroute: 0, delivered: 0, delayed: 0 };
        let newNotifs = 0;

        if (snapshot.empty) {
            allBody.innerHTML   = `<tr><td colspan="5" style="text-align: center; padding: 20px;">No deliveries assigned to you yet.</td></tr>`;
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

            const shortDest      = d.destination ? d.destination.split(',')[0] : "-";
            const formattedDate  = d.eta ? new Date(d.eta).toLocaleString() : "-";
            const deliveredDate  = d.deliveredAt ? d.deliveredAt.toDate().toLocaleString() : "-";

            // Click to view Map Route!
            const viewMapBtn  = `<a href="TransportDelivery.html?focus=${id}" class="btn-map"><i class="fa-solid fa-map-location-dot"></i> View Route</a>`;
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