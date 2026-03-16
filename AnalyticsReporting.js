import { database } from "./firebase.js";
import { ref, onValue, query, orderByKey, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const MAX_DATA_POINTS = 24;
const LOGS_PATH = "AquaFresh_Logs";

const metricConfigs = {
    temperature: {
        firebaseKey: "water_temp",
        label: "Water Temperature (°C)",
        valueElement: "temperature-current",
        timestampElement: "temperature-updated",
        chartId: "temperatureChart",
        unit: "°C",
        decimals: 1,
        color: "#0ea5e9"
    },
    ph: {
        firebaseKey: "ph_level",
        label: "pH Level",
        valueElement: "ph-current",
        timestampElement: "ph-updated",
        chartId: "phChart",
        decimals: 2,
        color: "#10b981"
    },
    humidity: {
        firebaseKey: "humidity",
        label: "Humidity (%)",
        valueElement: "humidity-current",
        timestampElement: "humidity-updated",
        chartId: "humidityChart",
        unit: "%",
        decimals: 1,
        color: "#f97316"
    }
};

const metricThresholdChecks = {
    temperature(value, config) {
        if (Number.isNaN(value)) {
            return null;
        }

        if (value < 0) {
            return {
                metric: "temperature",
                message: `Water temperature dropped below 0°C (current: ${formatValueForAlert(value, config)})`
            };
        }

        if (value > 4) {
            return {
                metric: "temperature",
                message: `Water temperature exceeded 4°C (current: ${formatValueForAlert(value, config)})`
            };
        }

        return null;
    },
    ph(value, config) {
        if (Number.isNaN(value)) {
            return null;
        }

        if (value >= 7.7) {
            return {
                metric: "ph",
                message: `pH level exceeded 7.7 (current: ${formatValueForAlert(value, config)})`
            };
        }

        return null;
    }
};

const charts = {};

document.addEventListener("DOMContentLoaded", () => {
    initCharts();
    listenToSensorData();
});

function initCharts() {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js not available. Skipping sensor trend charts.");
        return;
    }

    Object.entries(metricConfigs).forEach(([metric, config]) => {
        const canvas = document.getElementById(config.chartId);
        if (!canvas) return;

        const decimals = typeof config.decimals === "number" ? config.decimals : 2;

        charts[metric] = new Chart(canvas, {
            type: "line",
            data: {
                labels: [],
                datasets: [
                    {
                        label: config.label,
                        data: [],
                        borderColor: config.color,
                        backgroundColor: `${config.color}33`,
                        borderWidth: 2,
                        tension: 0.35,
                        fill: true,
                        pointRadius: 3,
                        pointBackgroundColor: "#ffffff"
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                scales: {
                    x: {
                        ticks: { color: "#475569" },
                        grid: { display: false }
                    },
                    y: {
                        ticks: { color: "#475569" },
                        beginAtZero: metric === "humidity",
                        grid: { color: "rgba(148,163,184,0.2)" }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                if (typeof value !== "number" || Number.isNaN(value)) {
                                    return "";
                                }
                                return `${value.toFixed(decimals)}${config.unit ? ` ${config.unit}` : ""}`;
                            }
                        }
                    }
                }
            }
        });
    });
}

function listenToSensorData() {
    const latestLogsQuery = query(
        ref(database, LOGS_PATH),
        orderByKey(),
        limitToLast(1)
    );

    onValue(
        latestLogsQuery,
        (snapshot) => {
            if (!snapshot.exists()) {
                showNoDataMessage("No logs found in AquaFresh_Logs.");
                return;
            }

            let payload = null;
            snapshot.forEach((childSnap) => {
                payload = childSnap.val();
            });

            updateTankMonitoring(payload);

            if (!payload || typeof payload !== "object") {
                showNoDataMessage("Latest log entry is empty.");
                return;
            }

            const payloadTimestamp = extractTimestampFromPayload(payload);

            const triggeredAlarms = [];

            Object.entries(metricConfigs).forEach(([metric, config]) => {
                const rawValue = payload[config.firebaseKey];
                const numericValue = updateMetricDisplay(metric, rawValue, payloadTimestamp);
                const alarmInfo = evaluateMetricThreshold(metric, numericValue);
                setMetricAlertState(metric, alarmInfo);

                if (alarmInfo) {
                    triggeredAlarms.push(alarmInfo);
                }
            });

            renderAlarmBanner(triggeredAlarms, payloadTimestamp);
        },
        (error) => {
            console.error("Failed to fetch live sensor data:", error);
            showNoDataMessage("Unable to load live data.");
        }
    );
}

function updateMetricDisplay(metric, rawValue, lastUpdatedMeta = Date.now()) {
    const config = metricConfigs[metric];
    if (!config) return Number.NaN;

    if (rawValue === null || typeof rawValue === "undefined") {
        setTextContent(config.valueElement, "--");
        setTextContent(config.timestampElement, "Awaiting data");
        return Number.NaN;
    }

    setTextContent(config.valueElement, formatDisplayValue(config, rawValue));
    setTextContent(
        config.timestampElement,
        `Updated ${formatTimestamp(lastUpdatedMeta)}`
    );

    const numericValue = parseNumericValue(rawValue);
    if (!Number.isNaN(numericValue)) {
        addChartPoint(metric, numericValue);
    }

    return numericValue;
}

function showNoDataMessage(message = "No live data available.") {
    Object.entries(metricConfigs).forEach(([metric, config]) => {
        setTextContent(config.valueElement, "--");
        setTextContent(config.timestampElement, message);

        const chart = charts[metric];
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();
        }
    });
}

function addChartPoint(metric, value) {
    const chart = charts[metric];
    if (!chart) return;

    const timestamp = formatTimestamp(Date.now(), true);
    chart.data.labels.push(timestamp);
    chart.data.datasets[0].data.push(value);

    if (chart.data.labels.length > MAX_DATA_POINTS) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }

    chart.update("none");
}

function evaluateMetricThreshold(metric, numericValue) {
    const config = metricConfigs[metric];
    const check = metricThresholdChecks[metric];

    if (!config || !check) {
        return null;
    }

    return check(numericValue, config);
}

function setMetricAlertState(metric, alarmInfo) {
    const config = metricConfigs[metric];
    if (!config) {
        return;
    }

    const valueElement = document.getElementById(config.valueElement);
    if (!valueElement) {
        return;
    }

    const card = valueElement.closest(".metric-value-card");
    if (!card) {
        return;
    }

    if (alarmInfo) {
        card.classList.add("alarm");
    } else {
        card.classList.remove("alarm");
    }
}

function renderAlarmBanner(alarms, payloadTimestamp) {
    const banner = document.getElementById("alarmBanner");
    const list = document.getElementById("alarmMessages");
    const timestampEl = document.getElementById("alarmTimestamp");

    if (!banner || !list) {
        return;
    }

    if (!alarms || alarms.length === 0) {
        list.innerHTML = "";
        if (timestampEl) {
            timestampEl.textContent = "All readings are within safe thresholds.";
        }
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
        const timestampSource = payloadTimestamp ?? Date.now();
        timestampEl.textContent = `Last updated ${formatTimestamp(timestampSource)}`;
    }

    banner.hidden = false;
}

function formatValueForAlert(value, config) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }

    const decimals = typeof config.decimals === "number" ? config.decimals : 2;
    const formatted = value.toFixed(decimals);
    return config.unit ? `${formatted} ${config.unit}` : formatted;
}

function formatDisplayValue(config, rawValue) {
    if (typeof rawValue === "string" && rawValue.trim().length) {
        return rawValue;
    }

    const numericValue = Number(rawValue);
    if (Number.isNaN(numericValue)) {
        return "--";
    }

    const decimals = typeof config.decimals === "number" ? config.decimals : 1;
    const formatted = numericValue.toFixed(decimals);
    return config.unit ? `${formatted} ${config.unit}` : formatted;
}

function parseNumericValue(value) {
    if (typeof value === "number") {
        return value;
    }

    if (typeof value === "string") {
        const match = value.match(/-?\d+(?:\.\d+)?/);
        return match ? parseFloat(match[0]) : Number.NaN;
    }

    return Number.NaN;
}

function formatTimestamp(value, short = false) {
    const date = normalizeTimestampValue(value);
    const options = short
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : { hour: "numeric", minute: "2-digit", second: "2-digit" };
    return date.toLocaleTimeString([], options);
}

function setTextContent(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = text;
    }
}

function extractTimestampFromPayload(payload) {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const timestampFields = [
        "timestamp",
        "Timestamp",
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
        "time",
        "loggedAt",
        "logged_at"
    ];

    for (const field of timestampFields) {
        if (payload[field]) {
            return payload[field];
        }
    }

    return null;
}

function normalizeTimestampValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }

    if (typeof value === "number") {
        const adjusted = value < 1e12 ? value * 1000 : value;
        const date = new Date(adjusted);
        if (!Number.isNaN(date.getTime())) {
            return date;
        }
    }

    if (typeof value === "string") {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) {
            return normalizeTimestampValue(numeric);
        }

        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date();
}

function updateTankMonitoring(payload) {

    const temp = parseNumericValue(payload.water_temp);
    const ph = parseNumericValue(payload.ph_level);
    const humidity = parseNumericValue(payload.humidity);

    const timestampSource = payload.timestamp || Date.now();
    const timestamp = formatTimestamp(timestampSource);

    let normalCount = 0;
    let alertCount = 0;

    let status = "normal";

    if (temp > 4 || ph < 6.5 || ph > 7.5) {
        status = "alert";
    }

    if (status === "normal") {
        normalCount++;
    } else {
        alertCount++;
    }

    const statusHTML =
        status === "normal"
            ? `
            <span class="status good">
                <i class="fa-solid fa-check"></i>
                Threshold Normal
            </span>
        `
            : `
            <span class="status alert">
                <i class="fa-solid fa-circle-exclamation"></i>
                Threshold Alert
            </span>
        `;
                    //truck A only has the IoT in tank1
    const tanks = ["tank1"]; // ADD tank2 and tank3 if there are new sensors

    tanks.forEach((tank) => {

        const tempEl = document.getElementById(`${tank}-temp`);
        const phEl = document.getElementById(`${tank}-ph`);
        const humEl = document.getElementById(`${tank}-humidity`);
        const statusEl = document.getElementById(`${tank}-status`);
        const timeEl = document.getElementById(`${tank}-time`);

        const normalEl = document.getElementById("normalCount");
        const alertEl = document.getElementById("alertCount");

        if (normalEl) normalEl.textContent = normalCount;
        if (alertEl) alertEl.textContent = alertCount;

        if (tempEl) tempEl.innerHTML = `<i class="fa-solid fa-temperature-half"></i> ${temp.toFixed(1)}°C`;
        if (phEl) phEl.innerHTML = `<i class="fa-solid fa-droplet"></i> ${ph.toFixed(2)}`;
        if (humEl) humEl.innerHTML = `<i class="fa-solid fa-cloud"></i> ${humidity.toFixed(1)}%`;

        if (statusEl) statusEl.innerHTML = statusHTML;

        if (timeEl) timeEl.textContent = timestamp;
    });
}
