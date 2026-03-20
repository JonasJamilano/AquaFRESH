import { database } from "./firebase.js";
import {
    ref,
    onValue,
    query,
    orderByKey,
    limitToLast,
    get
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* =========================================
   CONSTANTS
========================================= */

const MAX_LIVE_POINTS    = 30;
const MAX_HISTORY_POINTS = 50;
const LIVE_POLL_INTERVAL = 10_000;
const HISTORY_DAYS       = 7;
const LOGS_PATH          = "AquaFresh_Logs";

/* =========================================
   ROLE
========================================= */

const CURRENT_ROLE = localStorage.getItem("role") || "";

/* =========================================
   ALERT SOUND — delivery role only
========================================= */

let audioCtx         = null;
let alarmSoundActive = false;

function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playAlertSound() {
    if (CURRENT_ROLE !== "delivery") return;
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
    if (CURRENT_ROLE !== "delivery") return;
    const unlock = () => {
        try { const ctx = getAudioContext(); if (ctx.state === "suspended") ctx.resume(); } catch (_) {}
    };
    document.addEventListener("click",      unlock, { once: true });
    document.addEventListener("keydown",    unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
}

/* =========================================
   METRIC CONFIGS
========================================= */

const metricConfigs = {
    temperature: {
        firebaseKey      : "water_temp",
        label            : "Water Temperature (°C)",
        valueElement     : "temperature-current",
        timestampElement : "temperature-updated",
        chartId          : "temperatureChart",
        unit             : "°C",
        decimals         : 1,
        color            : "#0ea5e9"
    },
    ph: {
        firebaseKey      : "ph_level",
        label            : "pH Level",
        valueElement     : "ph-current",
        timestampElement : "ph-updated",
        chartId          : "phChart",
        unit             : "",
        decimals         : 2,
        color            : "#10b981"
    },
    humidity: {
        firebaseKey      : "humidity",
        label            : "Humidity (%)",
        valueElement     : "humidity-current",
        timestampElement : "humidity-updated",
        chartId          : "humidityChart",
        unit             : "%",
        decimals         : 1,
        color            : "#f97316"
    }
};

/* =========================================
   THRESHOLD CHECKS
========================================= */

const metricThresholdChecks = {
    temperature(value, config) {
        if (Number.isNaN(value)) return null;
        if (value < 0) return { metric: "temperature", message: `Water temperature dropped below 0°C (current: ${formatValueForAlert(value, config)})` };
        if (value > 4) return { metric: "temperature", message: `Water temperature exceeded 4°C (current: ${formatValueForAlert(value, config)})` };
        return null;
    },
    ph(value, config) {
        if (Number.isNaN(value)) return null;
        if (value >= 7.7) return { metric: "ph", message: `pH level exceeded 7.7 (current: ${formatValueForAlert(value, config)})` };
        return null;
    }
};

/* =========================================
   CHART INSTANCES
========================================= */

const liveCharts    = {};
const historyCharts = {};

/* =========================================
   INIT
========================================= */

document.addEventListener("DOMContentLoaded", () => {
    unlockAudio();
    initLiveCharts();
    startLivePolling();
    watchConnectionStatus();
    injectHistorySections();
    loadAllHistory();
});

/* =========================================
   VIEW TANKS CARD
   Switches between green (all normal)
   and red (at least one alert) based on
   the live threshold result.
========================================= */

function updateViewTanksCard(isAlert, alertCount) {
    const card     = document.getElementById("viewTanksCard");
    const icon     = document.getElementById("viewTanksIcon");
    const glyph    = document.getElementById("viewTanksIconGlyph");
    const title    = document.getElementById("viewTanksTitle");
    const subtitle = document.getElementById("viewTanksSubtitle");

    if (!card) return;

    if (isAlert) {
        card.className    = "view-tanks-card red";
        icon.className    = "card-icon";
        glyph.className   = "fa-solid fa-circle-exclamation";
        title.textContent = alertCount > 1
            ? `${alertCount} Tanks in Alert`
            : "Attention Required";
        subtitle.textContent = "One or more sensors exceeded safe thresholds";
    } else {
        card.className    = "view-tanks-card green";
        icon.className    = "card-icon";
        glyph.className   = "fa-solid fa-check";
        title.textContent = "All Tanks Normal";
        subtitle.textContent = "All sensors within safe thresholds";
    }
}

/* =========================================
   CONNECTION STATUS
========================================= */

function watchConnectionStatus() {
    const connectedRef = ref(database, ".info/connected");

    onValue(connectedRef, (snap) => {
        const isOnline = snap.val() === true;
        const cell     = document.getElementById("tank1-connection");
        if (!cell) return;

        cell.innerHTML = isOnline
            ? `<span class="connection-badge online"><i class="fa-solid fa-circle-dot"></i> Online</span>`
            : `<span class="connection-badge offline"><i class="fa-solid fa-circle-xmark"></i> Offline</span>`;
    });
}

/* =========================================
   LIVE CHARTS
========================================= */

function initLiveCharts() {
    if (typeof Chart === "undefined") { console.warn("Chart.js not available."); return; }

    Object.entries(metricConfigs).forEach(([metric, config]) => {
        const canvas = document.getElementById(config.chartId);
        if (!canvas) return;

        const decimals = typeof config.decimals === "number" ? config.decimals : 2;

        liveCharts[metric] = new Chart(canvas, {
            type: "line",
            data: {
                labels  : [],
                datasets: [{
                    label               : config.label,
                    data                : [],
                    borderColor         : config.color,
                    backgroundColor     : `${config.color}33`,
                    borderWidth         : 2,
                    tension             : 0.35,
                    fill                : true,
                    pointRadius         : 3,
                    pointBackgroundColor: "#ffffff"
                }]
            },
            options: {
                responsive         : true,
                maintainAspectRatio: false,
                animation          : { duration: 0 },
                scales: {
                    x: { ticks: { color: "#475569" }, grid: { display: false } },
                    y: {
                        ticks      : { color: "#475569" },
                        beginAtZero: metric === "humidity",
                        grid       : { color: "rgba(148,163,184,0.2)" }
                    }
                },
                plugins: {
                    legend : { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const v = ctx.parsed.y;
                                if (typeof v !== "number" || Number.isNaN(v)) return "";
                                return `${v.toFixed(decimals)}${config.unit ? ` ${config.unit}` : ""}`;
                            }
                        }
                    }
                }
            }
        });
    });
}

/* =========================================
   LIVE POLLING — every 10 seconds
========================================= */

function startLivePolling() {
    fetchLatestReading();
    setInterval(fetchLatestReading, LIVE_POLL_INTERVAL);
}

function fetchLatestReading() {
    const latestQuery = query(ref(database, LOGS_PATH), orderByKey(), limitToLast(1));

    onValue(latestQuery, (snapshot) => {
        if (!snapshot.exists()) { showNoDataMessage("No logs found in AquaFresh_Logs."); return; }

        let payload = null;
        snapshot.forEach((child) => { payload = child.val(); });

        updateTankMonitoring(payload);

        if (!payload || typeof payload !== "object") { showNoDataMessage("Latest log entry is empty."); return; }

        const payloadTimestamp = extractTimestampFromPayload(payload);
        const triggeredAlarms  = [];

        Object.entries(metricConfigs).forEach(([metric, config]) => {
            const rawValue     = payload[config.firebaseKey];
            const numericValue = updateMetricDisplay(metric, rawValue, payloadTimestamp);
            const alarmInfo    = evaluateMetricThreshold(metric, numericValue);
            setMetricAlertState(metric, alarmInfo, numericValue);
            if (alarmInfo) triggeredAlarms.push(alarmInfo);
        });

        renderAlarmBanner(triggeredAlarms, payloadTimestamp);
        handleAlarmSound(triggeredAlarms.length > 0);
    },
    (error) => { console.error("Failed to fetch live sensor data:", error); showNoDataMessage("Unable to load live data."); });
}

/* =========================================
   UPDATE METRIC DISPLAY
========================================= */

function updateMetricDisplay(metric, rawValue, lastUpdatedMeta = Date.now()) {
    const config = metricConfigs[metric];
    if (!config) return Number.NaN;

    if (rawValue === null || typeof rawValue === "undefined") {
        setTextContent(config.valueElement,    "--");
        setTextContent(config.timestampElement, "Awaiting data");
        return Number.NaN;
    }

    setTextContent(config.valueElement,    formatDisplayValue(config, rawValue));
    setTextContent(config.timestampElement, `Updated ${formatTimestamp(lastUpdatedMeta)}`);

    const numericValue = parseNumericValue(rawValue);
    if (!Number.isNaN(numericValue)) addLiveChartPoint(metric, numericValue);
    return numericValue;
}

function showNoDataMessage(message = "No live data available.") {
    Object.entries(metricConfigs).forEach(([metric, config]) => {
        setTextContent(config.valueElement,    "--");
        setTextContent(config.timestampElement, message);
        const chart = liveCharts[metric];
        if (chart) { chart.data.labels = []; chart.data.datasets[0].data = []; chart.update(); }
    });
}

function addLiveChartPoint(metric, value) {
    const chart = liveCharts[metric];
    if (!chart) return;
    const timestamp = formatTimestamp(Date.now(), true);
    chart.data.labels.push(timestamp);
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > MAX_LIVE_POINTS) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
    chart.update("none");
}

/* =========================================
   THRESHOLD + ALERT STATE
========================================= */

function evaluateMetricThreshold(metric, numericValue) {
    const config = metricConfigs[metric];
    const check  = metricThresholdChecks[metric];
    if (!config || !check) return null;
    return check(numericValue, config);
}

function setMetricAlertState(metric, alarmInfo, numericValue) {
    const config = metricConfigs[metric];
    if (!config) return;
    const valueElement = document.getElementById(config.valueElement);
    if (!valueElement) return;
    const card = valueElement.closest(".metric-value-card");
    if (!card) return;
    card.classList.remove("alarm", "optimal");
    if (Number.isNaN(numericValue)) return;
    if (alarmInfo) card.classList.add("alarm"); else card.classList.add("optimal");
}

/* =========================================
   ALARM BANNER
========================================= */

function renderAlarmBanner(alarms, payloadTimestamp) {
    const banner      = document.getElementById("alarmBanner");
    const list        = document.getElementById("alarmMessages");
    const timestampEl = document.getElementById("alarmTimestamp");
    if (!banner || !list) return;

    if (!alarms || alarms.length === 0) {
        list.innerHTML = "";
        if (timestampEl) timestampEl.textContent = "All readings are within safe thresholds.";
        banner.hidden = true;
        return;
    }

    list.innerHTML = "";
    alarms.forEach((alarm) => {
        const item = document.createElement("li");
        item.textContent = alarm.message;
        list.appendChild(item);
    });

    if (timestampEl) {
        const src = payloadTimestamp ?? Date.now();
        timestampEl.textContent = `Last updated ${formatTimestamp(src)}`;
    }
    banner.hidden = false;
}

/* =========================================
   TANK MONITORING
   Also drives the View Tanks card color
========================================= */

function updateTankMonitoring(payload) {
    if (!payload) return;

    const temp     = parseNumericValue(payload.water_temp);
    const ph       = parseNumericValue(payload.ph_level);
    const humidity = parseNumericValue(payload.humidity);

    const tsDate    = normalizeTimestampValue(payload.timestamp || Date.now());
    const timestamp = tsDate.toLocaleString([], {
        month  : "short",
        day    : "numeric",
        year   : "numeric",
        hour   : "2-digit",
        minute : "2-digit",
        second : "2-digit"
    });

    const isAlert  = temp < 0 || temp > 4 || ph < 6.5 || ph > 7.5;
    const alertCount = isAlert ? 1 : 0;

    /* ── Update the single View Tanks card ── */
    updateViewTanksCard(isAlert, alertCount);

    const statusHTML = isAlert
        ? `<span class="status alert"><i class="fa-solid fa-circle-exclamation"></i> Threshold Alert</span>`
        : `<span class="status good"><i class="fa-solid fa-check"></i> Threshold Normal</span>`;

    const tanks = ["tank1"];

    tanks.forEach((tank) => {
        const tempEl   = document.getElementById(`${tank}-temp`);
        const phEl     = document.getElementById(`${tank}-ph`);
        const humEl    = document.getElementById(`${tank}-humidity`);
        const statusEl = document.getElementById(`${tank}-status`);
        const timeEl   = document.getElementById(`${tank}-time`);

        if (tempEl)   tempEl.innerHTML   = `<i class="fa-solid fa-temperature-half"></i> ${Number.isNaN(temp)    ? "--" : temp.toFixed(1)   + "°C"}`;
        if (phEl)     phEl.innerHTML     = `<i class="fa-solid fa-droplet"></i> ${Number.isNaN(ph)       ? "--" : ph.toFixed(2)}`;
        if (humEl)    humEl.innerHTML    = `<i class="fa-solid fa-cloud"></i> ${Number.isNaN(humidity)   ? "--" : humidity.toFixed(1) + "%"}`;
        if (statusEl) statusEl.innerHTML = statusHTML;
        if (timeEl)   timeEl.textContent = timestamp;
    });
}

/* =========================================
   HISTORY — DOM INJECTION
========================================= */

const historyMeta = {
    temperature: { containerId: "temp",     title: "Temperature History", icon: "fa-temperature-half", chartId: "tempHistoryChart",     tableId: "tempHistoryTable",     badgeId: "tempHistoryBadge",     color: "#0ea5e9", unit: "°C", decimals: 1, firebaseKey: "water_temp" },
    ph:          { containerId: "ph",       title: "pH Level History",    icon: "fa-droplet",          chartId: "phHistoryChart",       tableId: "phHistoryTable",       badgeId: "phHistoryBadge",       color: "#10b981", unit: "",   decimals: 2, firebaseKey: "ph_level"  },
    humidity:    { containerId: "humidity", title: "Humidity History",    icon: "fa-cloud",            chartId: "humidityHistoryChart", tableId: "humidityHistoryTable", badgeId: "humidityHistoryBadge", color: "#f97316", unit: "%",  decimals: 1, firebaseKey: "humidity"  }
};

function injectHistorySections() {
    Object.values(historyMeta).forEach((m) => {
        const parent = document.getElementById(m.containerId);
        if (!parent) return;

        const section     = document.createElement("div");
        section.className = "history-section";
        section.id        = `${m.containerId}-history-section`;

        section.innerHTML = `
            <div class="history-section-header">
                <span class="history-section-title">
                    <i class="fa-solid ${m.icon}"></i> ${m.title}
                    <span class="history-range-label">· Last 7 Days</span>
                </span>
                <span class="history-badge badge-loading" id="${m.badgeId}">
                    <i class="fa-solid fa-spinner fa-spin"></i> Loading…
                </span>
            </div>
            <div class="history-chart-wrapper">
                <canvas id="${m.chartId}" aria-label="${m.title} chart"></canvas>
            </div>
            <div class="history-table-scroll">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th class="history-row-num">#</th>
                            <th><i class="fa-solid fa-calendar-day"></i> Date</th>
                            <th><i class="fa-solid fa-clock"></i> Time</th>
                            <th><i class="fa-solid ${m.icon}"></i> Reading</th>
                            <th><i class="fa-solid fa-circle-dot"></i> Status</th>
                        </tr>
                    </thead>
                    <tbody id="${m.tableId}">
                        <tr><td colspan="5" class="history-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading history…</td></tr>
                    </tbody>
                </table>
            </div>`;

        parent.appendChild(section);
    });
}

/* =========================================
   HISTORY — LOAD FROM FIREBASE
========================================= */

async function loadAllHistory() {
    const cutoff   = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const snapshot = await get(
        query(ref(database, LOGS_PATH), orderByKey(), limitToLast(500))
    ).catch((err) => { console.error("History fetch failed:", err); return null; });

    if (!snapshot || !snapshot.exists()) {
        Object.values(historyMeta).forEach((m) => setBadge(m.badgeId, "empty", "No data"));
        return;
    }

    const allRows = [];
    snapshot.forEach((child) => {
        const val = child.val();
        if (!val) return;
        const ts = normalizeTimestampValue(extractTimestampFromPayload(val) ?? Date.now());
        if (ts.getTime() < cutoff) return;
        allRows.push({ ts, val });
    });

    allRows.sort((a, b) => a.ts - b.ts);

    Object.entries(historyMeta).forEach(([, m]) => {
        const rows = allRows
            .map((r) => ({ ts: r.ts, value: parseNumericValue(r.val[m.firebaseKey]) }))
            .filter((r) => !Number.isNaN(r.value));

        renderHistoryChart(m, rows);
        renderHistoryTable(m, rows);
        setBadge(m.badgeId, rows.length ? "ok" : "empty", rows.length ? `${rows.length} records` : "No data");
    });
}

/* =========================================
   HISTORY CHART
========================================= */

function renderHistoryChart(m, rows) {
    const canvas = document.getElementById(m.chartId);
    if (!canvas || typeof Chart === "undefined") return;

    const sampled  = subsample(rows, MAX_HISTORY_POINTS);
    const decimals = m.decimals ?? 1;

    historyCharts[m.chartId] = new Chart(canvas, {
        type: "line",
        data: {
            labels  : sampled.map((r) => formatTimestamp(r.ts, true)),
            datasets: [{
                label               : m.title,
                data                : sampled.map((r) => r.value),
                borderColor         : m.color,
                backgroundColor     : `${m.color}22`,
                borderWidth         : 1.5,
                tension             : 0.35,
                fill                : true,
                pointRadius         : sampled.length > 30 ? 1 : 3,
                pointBackgroundColor: "#ffffff"
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
            scales: {
                x: { ticks: { color: "#94a3b8", maxRotation: 45, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
                y: { ticks: { color: "#94a3b8" }, beginAtZero: m.firebaseKey === "humidity", grid: { color: "rgba(148,163,184,0.15)" } }
            },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(decimals)}${m.unit ? ` ${m.unit}` : ""}` } } }
        }
    });
}

/* =========================================
   HISTORY TABLE
========================================= */

function renderHistoryTable(m, rows) {
    const tbody = document.getElementById(m.tableId);
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="history-empty">No records found for the last 7 days.</td></tr>`;
        return;
    }

    const decimals = m.decimals ?? 1;
    tbody.innerHTML = [...rows].reverse().map((r, idx) => {
        const date    = r.ts.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
        const time    = r.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const reading = `${r.value.toFixed(decimals)}${m.unit ? ` ${m.unit}` : ""}`;
        return `
        <tr>
            <td class="history-row-num">${idx + 1}</td>
            <td class="history-row-time">${date}</td>
            <td class="history-row-time">${time}</td>
            <td class="history-row-value">${reading}</td>
            <td>${getRowStatus(m.firebaseKey, r.value)}</td>
        </tr>`;
    }).join("");
}

function getRowStatus(firebaseKey, value) {
    let isAlert = false;
    if (firebaseKey === "water_temp") isAlert = value < 0 || value > 4;
    else if (firebaseKey === "ph_level") isAlert = value >= 7.7;
    return isAlert
        ? `<span class="history-status-badge alert-badge"><i class="fa-solid fa-circle-exclamation"></i> Alert</span>`
        : `<span class="history-status-badge ok-badge"><i class="fa-solid fa-check"></i> Optimal</span>`;
}

/* =========================================
   BADGE / SUBSAMPLE / HELPERS
========================================= */

function setBadge(id, type, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const classes = { loading: "badge-loading", ok: "badge-ok", empty: "badge-empty", error: "badge-error" };
    const icons   = { loading: `<i class="fa-solid fa-spinner fa-spin"></i>`, ok: `<i class="fa-solid fa-check-circle"></i>`, empty: `<i class="fa-solid fa-inbox"></i>`, error: `<i class="fa-solid fa-triangle-exclamation"></i>` };
    el.className  = `history-badge ${classes[type] || "badge-empty"}`;
    el.innerHTML  = `${icons[type] || ""} ${text}`;
}

function subsample(arr, maxPoints) {
    if (arr.length <= maxPoints) return arr;
    const step = arr.length / maxPoints;
    return Array.from({ length: maxPoints }, (_, i) => arr[Math.round(i * step)]);
}

function formatValueForAlert(value, config) {
    if (typeof value !== "number" || Number.isNaN(value)) return "--";
    const formatted = value.toFixed(typeof config.decimals === "number" ? config.decimals : 2);
    return config.unit ? `${formatted} ${config.unit}` : formatted;
}

function formatDisplayValue(config, rawValue) {
    if (typeof rawValue === "string" && rawValue.trim().length) return rawValue;
    const n = Number(rawValue);
    if (Number.isNaN(n)) return "--";
    const formatted = n.toFixed(typeof config.decimals === "number" ? config.decimals : 1);
    return config.unit ? `${formatted} ${config.unit}` : formatted;
}

function parseNumericValue(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") { const m = value.match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : Number.NaN; }
    return Number.NaN;
}

function formatTimestamp(value, short = false) {
    const date = normalizeTimestampValue(value);
    return date.toLocaleTimeString([], short
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function setTextContent(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = text;
}

function extractTimestampFromPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    for (const field of ["timestamp","Timestamp","createdAt","created_at","updatedAt","updated_at","time","loggedAt","logged_at"]) {
        if (payload[field]) return payload[field];
    }
    return null;
}

function normalizeTimestampValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number") {
        const d = new Date(value < 1e12 ? value * 1000 : value);
        if (!Number.isNaN(d.getTime())) return d;
    }
    if (typeof value === "string") {
        const n = Number(value);
        if (!Number.isNaN(n)) return normalizeTimestampValue(n);
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
}