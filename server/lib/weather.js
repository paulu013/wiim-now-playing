// ===========================================================================
// weather.js
//
// Outside temperature, short forecast and sunrise/sunset for the clock view.
// Uses Open-Meteo (https://open-meteo.com) — free, no API key, geocoding included.
//
// Config: serverSettings.features.weather
//   { enabled, forecast, location, lat, lon, units: "metric"|"imperial", pollMinutes }
// Emits socket event "weather" with:
//   { name, temp, code, isDay, sunrise, sunset, daily: [{ date, tmax, tmin, code }], updated }

const log = require("debug")("lib:weather");

const DEFAULTS = {
    enabled: false,      // show outside temperature on the clock
    forecast: false,     // show a 3-day forecast on the clock
    location: "",        // free text, e.g. "Venray" — geocoded once, result cached in lat/lon/name
    lat: null,
    lon: null,
    name: "",
    units: "metric",
    pollMinutes: 10
};

let current = null;
let timer = null;
let lastGeocoded = null;

const fetchJson = async (url, timeoutMs = 6000) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ctl.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
    } finally {
        clearTimeout(t);
    }
};

const getConfig = (serverSettings) => ({ ...DEFAULTS, ...((serverSettings.features && serverSettings.features.weather) || {}) });

/** Resolve a free-text location to lat/lon/name (cached in settings). */
const geocode = async (cfg) => {
    const q = (cfg.location || "").trim();
    if (!q) return null;
    const j = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
    const r = j.results && j.results[0];
    if (!r) throw new Error("location not found: " + q);
    return { lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", ") };
};

const poll = async (io, serverSettings, lib) => {
    const cfg = getConfig(serverSettings);
    if (!cfg.enabled && !cfg.forecast) { current = null; return; }
    try {
        // Geocode when the location text changed or no coordinates are stored
        if ((cfg.location && cfg.location !== lastGeocoded) || (cfg.lat == null || cfg.lon == null)) {
            const g = await geocode(cfg);
            if (g) {
                Object.assign(serverSettings.features.weather, g);
                lastGeocoded = cfg.location;
                lib.saveSettings(serverSettings);
                Object.assign(cfg, g);
            }
        }
        if (cfg.lat == null || cfg.lon == null) { log("no location"); return; }
        const imperial = cfg.units === "imperial";
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}`
            + `&current=temperature_2m,weather_code,is_day`
            + `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=4&timezone=auto`
            + (imperial ? "&temperature_unit=fahrenheit" : "");
        const j = await fetchJson(url);
        current = {
            name: cfg.name || cfg.location,
            temp: Math.round(j.current.temperature_2m),
            code: j.current.weather_code,
            isDay: j.current.is_day === 1,
            sunrise: j.daily.sunrise[0],
            sunset: j.daily.sunset[0],
            units: imperial ? "°F" : "°C",
            daily: j.daily.time.slice(1, 4).map((d, i) => ({
                date: d,
                tmax: Math.round(j.daily.temperature_2m_max[i + 1]),
                tmin: Math.round(j.daily.temperature_2m_min[i + 1]),
                code: j.daily.weather_code[i + 1]
            })),
            updated: Date.now()
        };
        io.emit("weather", current);
    } catch (e) {
        log("poll failed:", e.message);
        io.emit("weather", { error: e.message, updated: Date.now() });
    }
};

const start = (io, serverSettings, lib) => {
    stop();
    const cfg = getConfig(serverSettings);
    if (!cfg.enabled && !cfg.forecast) return null;
    poll(io, serverSettings, lib);
    timer = setInterval(() => poll(io, serverSettings, lib), Math.max(2, cfg.pollMinutes) * 60000);
    return timer;
};

const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
const getCurrent = () => current;

module.exports = { DEFAULTS, getConfig, poll, start, stop, getCurrent };
