// ===========================================================================
// index.js
//
// The server to handle the communication between the selected media renderer and the ui client(s)

// Express modules
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const app = express();

// Node.js modules
const http = require("http");
const https = require("https");
const server = http.createServer(app);

// Socket.io modules, with CORS
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Other (custom) modules
const ssdp = require("./lib/ssdp.js"); // SSDP functionality
const upnp = require("./lib/upnpClient.js"); // UPnP Client functionality
const httpApi = require("./lib/httpApi.js"); // HTTP API functionality
const sockets = require("./lib/sockets.js"); // Sockets.io functionality
const shell = require("./lib/shell.js"); // Shell command functionality
const lib = require("./lib/lib.js"); // Generic functionality
const lyrics = require("./lib/lyrics.js"); // Lyrics functionality
const lyricsCache = require("./lib/lyricsCache.js");
const external = require("./lib/external.js"); // Plex / Jellyfin sessions
const weather = require("./lib/weather.js"); // Outside temperature / forecast (Open-Meteo)
const log = require("debug")("index"); // See the documentation on debugging

// For versionioning purposes
// Load the package.json files to get the version numbers
const packageJsonServer = require('../package.json'); // Server package.json
const packageJsonClient = require('../client/package.json'); // Client package.json

// ===========================================================================
// Server constants & variables

// Port 80 is the default www port, if the server won't start then choose another port i.e. 3000, 8000, 8080
// Use PORT environment variable or default to 80
log("process.env.PORT:", process.env.PORT);
const port = process.env.PORT || 80;

// Server side placeholders for data:
let deviceList = []; // Placeholder for found devices through SSDP
let deviceInfo = { // Placeholder for the currently selected device info
    state: null, // Keeps the device state updates
    metadata: null, // Keeps the device metadata updates
    client: null, // Keeps the UPnP client object
    lyrics: null // Keeps the lyrics object
};
let serverSettings = { // Placeholder for current server settings
    "selectedDevice": { // The selected device properties, a placeholder for now. Will be filled once a (default) device selection has been made.
        "friendlyName": null,
        "manufacturer": null,
        "modelName": null,
        "location": null,
        "actions": {}
    },
    "os": lib.getOS(), // Initially grab the environment we are running in. Things may not have settled yet, so we update this later.
    "timeouts": {
        "immediate": 250, // Timeout for 'immediate' updates in milliseconds. Quarter of a second.
        "state": 1000, // Timeout for state updates in milliseconds. Every second.
        "metadata": 4 * 1000, // Timeout for metadata updates in milliseconds. Every 4 seconds.
        "rescan": 10 * 1000 // Timeout for possible rescan of devices in milliseconds. Every 10 seconds.
    },
    "features": {
        "lyrics": {
            "enabled": false, // Whether the lyrics feature is enabled or not
            "offsetMs": 0 // The offset in milliseconds to apply to the synced lyrics, can be positive or negative, default is 0.
        },
        "clock": {
            "enabled": true, // Show a clock when nothing is playing
            "afterSeconds": 10, // ...after this many seconds of not playing
            "onInput": false, // Also show the clock while an HDMI/optical/line-in/bluetooth input is active
            "drift": true, // Nudge the clock a few pixels every minute (OLED burn-in)
            "blankAfterMinutes": 0, // Blank the whole screen after this many idle minutes (0 = never)
            "theme": "digital-minimal", // Day theme id, see client WNP.clockThemes
            "nightTheme": "digital-minimal", // Theme used between sunset and sunrise when autoDayNight is on
            "segmentSlant": true, // Use the slanted (italic) DSEG face for seven-segment themes
            "autoDayNight": false, // Switch themes on sunrise/sunset (needs weather location)
            "override": { "enabled": false, "font": "" }, // Overrule theme font
            "colors": { "custom": {}, "gradient": false, "nightDim": 100, "base": "#ede8df", "scheme": "mono" }, // Per-role colour overrides (see WNP.colorRoles), gradient bg, night dimming %
            "dialText": { "brand": "", "sub": "" }, // Text on themes that have a dial label, e.g. "Paulus" / "Quartz"
            "overlay": { "enabled": false, "position": "top-right", "size": "m" }, // Small clock over the now-playing view
            "locale": "en-GB", // Language for date / day names: en-GB, nl-NL, ...
            "swipe": { "enabled": false, "gesture": "left", "transition": "slide-left", "returnAfterSeconds": 30 } // Swipe to reveal the clock while playing
        },
        "weather": weather.DEFAULTS, // Outside temperature / forecast, see lib/weather.js
        "display": {
            "nightShift": { // Page-wide warm tint + dimming, like a phone's night mode
                "enabled": false,
                "schedule": "sun", // "sun" (sunset-sunrise, needs weather location; falls back to 19:00-07:00), "custom", "always"
                "from": "22:00",
                "to": "07:00",
                "warmth": 60, // 0 = neutral, 100 = very warm
                "brightness": 80 // 20-100 %
            }
        },
        "external": external.DEFAULTS // Plex / Jellyfin sources, see lib/external.js
    },
    "server": null, // Placeholder for the express server (port) information
    "version": { // Version information for the server and client
        "server": packageJsonServer.version,
        "client": packageJsonClient.version
    }
};

// Interval placeholders:
let pollState = null; // For the renderer state
let pollMetadata = null; // For the renderer metadata
let pollExternal = null; // For Plex / Jellyfin sessions
let pollWeather = null; // For the weather

// Device polling emits through this proxy: while an external (Plex/Jellyfin) session
// is being shown, device state/metadata emits are held back. See lib/external.js.
const ioDev = external.wrapIo(io, deviceInfo, serverSettings);

// ===========================================================================
// Get the server settings from local file storage, if any.
lib.getSettings(serverSettings);

// ===========================================================================
// Device discovery. Normally via SSDP multicast, but SSDP can't cross VLANs — so
// WIIM_LOCATION lets you point the server straight at the device descriptor URL
// (e.g. http://192.168.30.20:49152/description.xml) and skip discovery entirely.
// Everything after this (descriptor, AVTransport polling, LinkPlay) is unicast HTTP. (fork)
if (process.env.WIIM_LOCATION) {
    log("WIIM_LOCATION set, selecting device directly (no SSDP):", process.env.WIIM_LOCATION);
    upnp.getDeviceDescription(deviceList, serverSettings, { LOCATION: process.env.WIIM_LOCATION });
    // Re-seed periodically so a rebooted/late device still gets picked up (until one is selected).
    setInterval(() => {
        if (!serverSettings.selectedDevice || !serverSettings.selectedDevice.location) {
            upnp.getDeviceDescription(deviceList, serverSettings, { LOCATION: process.env.WIIM_LOCATION });
        }
    }, 30000);
}
else {
    // Initial SSDP scan for devices.
    ssdp.scan(deviceList, serverSettings);
}

// Check after a while whether any device has been found.
// Due to wifi initialisation delay the scan may have failed.
// Not aware of a method of knowing whether wifi connection has been established fully.
setTimeout(() => {
    log("Rescanning devices...");
    // Start new device scan, if first scan failed... (skip when pinned via WIIM_LOCATION)
    if (deviceList.length === 0 && !process.env.WIIM_LOCATION) {
        ssdp.scan(deviceList, serverSettings);
        // The client may not be aware of any devices and have an empty list, waiting for rescan results and send the device list again
        setTimeout(() => {
            sockets.getDevices(io, deviceList);
        }, serverSettings.timeouts.metadata)
    }
    // Node.js may have started before the wifi connection was established, so we rescan after a while
    serverSettings.os = lib.getOS(); // Update the OS information
    io.emit("server-settings", serverSettings); // And resend to clients
}, serverSettings.timeouts.rescan);

// ===========================================================================
// Set Express functionality
// Use CORS
app.use(cors());

// Set up rate limiter: maximum 1000 requests per 15 minutes per IP
// As static file serving can be quite intensive we set a limit here
// As suggested by Github code scanning tools
// As suggested by: https://www.npmjs.com/package/express-rate-limit
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
});

// Apply rate limiter to static/file-serving routes
app.use(limiter);

// By default reroute all clients to the /public server folder
app.use(express.static(__dirname + "/public"));

// Exceptions:
app.get("/tv", limiter, function (req, res) { // TV Mode
    res.sendFile(__dirname + "/public/tv.html");
});
app.get("/debug", limiter, function (req, res) { // Debug page
    res.sendFile(__dirname + "/public/debug.html");
});
app.get("/res", limiter, function (req, res) { // Resolution test page
    res.sendFile(__dirname + "/public/res.html");
});
app.get("/assets", limiter, function (req, res) { // Assets test page
    res.sendFile(__dirname + "/public/assets.html");
});

// Proxy https album art requests through this app, because this could be a https request with a self signed certificate.
// If the device does not have a valid (self-signed) certificate the browser cannot load the album art, hence we ignore the self signed certificate.
app.get("/proxy-art", limiter, function (req, res) {
    log("Album Art Proxy request:", req.query.url, req.query.ts);

    // Validate URL
    let targetUrl;
    try {
        targetUrl = new URL(req.query.url);
    } catch (e) {
        res.status(400).send("<div>Invalid URL</div>");
        return;
    }
    if (targetUrl.protocol !== "https:") {
        res.status(400).send("<div>Invalid protocol</div>");
        return;
    }

    const options = {
        rejectUnauthorized: false, // Ignore self-signed certificate
    };
    let identified = false;

    // Make the request to the target URL
    const request = https.get(targetUrl.href, options, (resp) => {

        // What content type do we have?
        let contentType = resp.headers['content-type'];
        // console.log("Content type:", contentType);

        // Wait for the first chunk to inspect the content if no content type is provided or if the content type does not start with image/,
        // to check if it's a valid image and determine the content type based on the magic bytes,
        // as some devices do not provide a content-type header or provide an incorrect one.
        resp.once('data', (chunk) => {
            identified = true;

            if (!contentType || !contentType.startsWith('image/')) {
                const magicBytes = chunk.toString('hex', 0, 4).toUpperCase();
                // console.log("Magic bytes:", magicBytes);

                switch (true) {
                    case magicBytes.startsWith('FFD8FF'):
                        contentType = 'image/jpeg';
                        break;
                    case magicBytes.startsWith('89504E47'):
                        contentType = 'image/png';
                        break;
                    case magicBytes.startsWith('47494638'):
                        contentType = 'image/gif';
                        break;
                    case magicBytes.startsWith('52494646'): // RIFF (WebP)
                        contentType = 'image/webp';
                        break;
                    case magicBytes.startsWith('3C737667'): // <svg
                    case magicBytes.startsWith('3C3F786D'): // <?xm
                        contentType = 'image/svg+xml';
                        break;
                    case magicBytes.startsWith('424D'): // BMP (Bitmap)
                        contentType = 'image/bmp';
                        break;
                }
                // console.log("Determined content type:", contentType);
            }

            // If the response is invalid, not an image, tell the client and stop processing the response
            if (!contentType || !contentType.startsWith('image/')) {
                res.status(415).send("<div>Unsupported Media Type</div>");
                resp.destroy(); // Stop receiving data
                return;
            }

            // Update the content-type header for the response to the client
            const headers = { ...resp.headers, 'content-type': contentType };

            // Pipe the response to the client
            res.writeHead(resp.statusCode, headers);
            res.write(chunk); // Write the first chunk that we already received
            resp.pipe(res); // Pipe the rest of the response chunks directly to the client

        });

        // If the response ends without us being able to identify the content type, we return an error
        resp.once('end', () => {
            if (!identified && !res.writableEnded) {
                res.status(415).send("<div>Empty or Unsupported Response</div>");
            }
        });

        // Handle errors in the response stream
        resp.on('error', (e) => {
            if (!res.writableEnded) res.status(502).send("<div>Gateway Error</div>");
        });

    })

    // Handle errors in the request to the target URL
    request.on('error', function (e) {
        // console.error("Error fetching album art:", e);
        if (!res.writableEnded) res.status(404).send("<div>404 Not Found</div>");
    });

});

// ===========================================================================
// Socket.io definitions

/**
 * On (new) client connection.
 * If first client to connect, then start polling and streaming.
 * @returns {undefined}
 */
io.on("connection", (socket) => {
    log("Client connected");

    // On connection check if this is the first client to connect.
    // If so, start polling the device and streaming to the device(s).
    log("No. of sockets:", io.sockets.sockets.size);
    if (io.sockets.sockets.size === 1) {
        // Start polling the selected device
        pollMetadata = upnp.startMetadata(ioDev, deviceInfo, serverSettings);
        pollState = upnp.startState(ioDev, deviceInfo, serverSettings);
        pollExternal = external.start(io, deviceInfo, serverSettings);
        pollWeather = weather.start(io, serverSettings, lib);
    }

    // Send the latest known state/metadata to every freshly connected client
    // (including the first one / a page refresh) so it doesn't sit on the empty
    // placeholder template until the next poll cycle. Guarded because nothing may
    // be cached yet on a cold start.
    const cur = external.currentMessages(deviceInfo, serverSettings);
    if (cur.state) { socket.emit("state", cur.state); }
    if (cur.metadata) { socket.emit("metadata", cur.metadata); }
    if (weather.getCurrent()) { socket.emit("weather", weather.getCurrent()); }
    if (deviceInfo.lyrics) {
        socket.emit("lyrics-get", deviceInfo.lyrics);
        lyrics.getLyricsCacheStats(io);
    }

    /**
     * On client disconnect.
     * If no clients are connected stop polling and streaming.
     * @returns {undefined}
     */
    socket.on("disconnect", () => {
        log("Client disconnected");

        // On disconnection we check the amount of connected clients.
        // If there is none, the streaming and polling are stopped.
        log("No. of sockets:", io.sockets.sockets.size);
        if (io.sockets.sockets.size === 0) {
            log("No sockets are connected!");
            // Stop polling the selected device
            upnp.stopPolling(pollState, "pollState");
            upnp.stopPolling(pollMetadata, "pollMetadata");
            external.stop();
            weather.stop();
        }

    });

    // ======================================
    // Device(s) related

    /**
     * Listener for devices get.
     * @returns {undefined}
     */
    socket.on("devices-get", () => {
        log("Socket event", "devices-get");
        sockets.getDevices(io, deviceList);
    });

    /**
     * Listener for devices refresh.
     * @returns {undefined}
     */
    socket.on("devices-refresh", () => {
        log("Socket event", "devices-refresh");
        sockets.scanDevices(io, ssdp, deviceList, serverSettings);
    });

    /**
     * Listener for device selection.
     * @param {string} msg - The selected device location URI.
     * @returns {undefined}
     */
    socket.on("device-set", (msg) => {
        log("Socket event", "device-set", msg);
        sockets.setDevice(io, deviceList, deviceInfo, serverSettings, msg);
        // Immediately get new metadata and state from new device
        upnp.updateDeviceMetadata(ioDev, deviceInfo, serverSettings);
        upnp.updateDeviceState(ioDev, deviceInfo, serverSettings);
    });

    /**
     * Listener for device actions. I.e. Play, Stop, Pause, ...
     * @param {string} msg - The action to perform on the device.
     * @returns {undefined}
     */
    socket.on("device-action", (msg) => {
        log("Socket event", "device-action", msg);
        upnp.callDeviceAction(ioDev, msg, deviceInfo, serverSettings);
    });

    /**
     * Transport control for the current external (Plex/Jellyfin) session.
     * @param {string} action - "Play" | "Pause" | "Stop"
     */
    socket.on("external-action", (action) => {
        log("Socket event", "external-action", action);
        external.control(serverSettings, action).then(() => {
            // Re-poll shortly after so the UI reflects the new play/pause state.
            setTimeout(() => external.poll(io, deviceInfo, serverSettings), 700);
        });
    });

    /**
     * Listener for HTTP API commands.
     * @param {string} msg - The API command to perform on the device.
     * @returns {undefined}
     */
    socket.on("device-api", (msg) => {
        log("Socket event", "device-api", msg);
        httpApi.callApi(io, msg, serverSettings);
    });

    // ======================================
    // Lyrics related

    /**
     * Listener for lyrics get.
     * Returns the lyrics for the currently playing track, if any and if the feature is enabled.
     * @returns {undefined}
     */
    socket.on("lyrics-get", () => {
        log("Socket event", "lyrics-get");
        if (serverSettings.features.lyrics.enabled && deviceInfo.lyrics) {
            socket.emit("lyrics-get", deviceInfo.lyrics);
            lyrics.getLyricsCacheStats(io);
        }
    });

    /**
     * Listener for lyrics cache stats get.
     * Returns the current stats of the lyrics cache, such as the number of items in cache.
     * @returns {undefined}
     */
    socket.on("lyrics-cache-stats", () => {
        log("Socket event", "lyrics-cache-stats");
        lyrics.getLyricsCacheStats(io);
    });

    /**
     * Listener for lyrics cache clear.
     * Clears the lyrics cache and sends back the updated cache stats.
     * @returns {undefined}
     */
    socket.on("lyrics-cache-clear", async () => {
        log("Socket event", "lyrics-cache-clear");
        await lyricsCache.clear();
        // Send back the updated cache stats
        lyrics.getLyricsCacheStats(io);
    });

    /**
     * Listener for lyrics settings updates.
     * Sets the lyrics related settings and saves them to the local storage.
     * @param {object} msg - The updated settings.
     * @returns {undefined}
     */
    socket.on("lyrics-settings", (msg) => {
        log("Socket event", "lyrics-settings", msg);
        if (msg && msg.features && msg.features.lyrics) {

            var shouldRefreshLyrics = false;

            // Lyrics enabled/disabled setting
            if (typeof msg.features.lyrics.enabled === "boolean") {
                serverSettings.features.lyrics.enabled = msg.features.lyrics.enabled;
                shouldRefreshLyrics = true;
            }

            // Lyrics offset in ms setting
            if (typeof msg.features.lyrics.offsetMs === "number") {
                serverSettings.features.lyrics.offsetMs = msg.features.lyrics.offsetMs;
            }

            // Save settings and send updated settings to clients
            lib.saveSettings(serverSettings);
            sockets.getServerSettings(io, serverSettings);

            // Should the lyrics be refreshed? Only if the enabled setting is changed, 
            // not for offset changes, as the offset is applied on the client side and does not require new lyrics to be fetched.
            if (shouldRefreshLyrics) {
                lyrics.getLyricsForMetadata(io, deviceInfo, serverSettings);
            }

        }
    });

    // ======================================
    // Clock & external sources settings

    /**
     * Listener for feature settings updates (clock, external sources).
     * Shallow-merges msg.features.clock / msg.features.external into the server settings and saves.
     * @param {object} msg - { features: { clock: {...}, external: {...} } }
     * @returns {undefined}
     */
    socket.on("features-settings", (msg) => {
        log("Socket event", "features-settings", msg);
        if (!msg || !msg.features) { return; }
        if (msg.features.clock && typeof msg.features.clock === "object") {
            const c = msg.features.clock;
            serverSettings.features.clock = {
                ...serverSettings.features.clock, ...c,
                override: { ...serverSettings.features.clock.override, ...(c.override || {}) },
                dialText: { ...serverSettings.features.clock.dialText, ...(c.dialText || {}) },
                overlay: { ...serverSettings.features.clock.overlay, ...(c.overlay || {}) },
                swipe: { ...serverSettings.features.clock.swipe, ...(c.swipe || {}) },
                colors: { ...serverSettings.features.clock.colors, ...(c.colors || {}) } // `custom` is replaced as a whole so resets stick
            };
        }
        if (msg.features.display && typeof msg.features.display === "object") {
            const d = msg.features.display;
            serverSettings.features.display = {
                ...serverSettings.features.display,
                ...d,
                nightShift: { ...serverSettings.features.display.nightShift, ...(d.nightShift || {}) }
            };
        }
        if (msg.features.weather && typeof msg.features.weather === "object") {
            const w = msg.features.weather;
            const prev = serverSettings.features.weather;
            serverSettings.features.weather = { ...prev, ...w };
            // Location text changed: drop cached coordinates so it is geocoded again
            if (typeof w.location === "string" && w.location !== prev.location) {
                serverSettings.features.weather.lat = null;
                serverSettings.features.weather.lon = null;
                serverSettings.features.weather.name = "";
            }
            if (io.sockets.sockets.size > 0) {
                pollWeather = weather.start(io, serverSettings, lib);
            }
        }
        if (msg.features.external && typeof msg.features.external === "object") {
            const ext = msg.features.external;
            serverSettings.features.external = {
                ...serverSettings.features.external,
                ...ext,
                plex: { ...serverSettings.features.external.plex, ...(ext.plex || {}) },
                jellyfin: { ...serverSettings.features.external.jellyfin, ...(ext.jellyfin || {}) }
            };
            // Restart external polling with the new config, if clients are connected
            if (io.sockets.sockets.size > 0) {
                pollExternal = external.start(io, deviceInfo, serverSettings);
            }
        }
        lib.saveSettings(serverSettings);
        sockets.getServerSettings(io, serverSettings);
    });

    /**
     * Listener for a weather refresh request.
     * @returns {undefined}
     */
    socket.on("weather-get", () => {
        log("Socket event", "weather-get");
        weather.poll(io, serverSettings, lib);
    });

    // ======================================
    // Server related

    /**
     * Listener for server settings.
     * @returns {undefined}
     */
    socket.on("server-settings", () => {
        log("Socket event", "server-settings");
        sockets.getServerSettings(io, serverSettings);
    });

    /**
     * Listener for server reboot.
     * @returns {undefined}
     */
    socket.on("server-reboot", () => {
        log("Socket event", "server-reboot");
        shell.reboot(io);
    });

    /**
     * Listener for server shutdown.
     * @returns {undefined}
     */
    socket.on("server-shutdown", () => {
        log("Socket event", "server-shutdown");
        shell.shutdown(io);
    });

    /**
     * Listener for server update (git pull).
     * @returns {undefined}
     */
    socket.on("server-update", () => {
        log("Socket event", "server-update");
        shell.update(io);
    });

});

// Start the webserver and listen for traffic
server.listen(port, () => {
    serverSettings.server = server.address();
    console.log("Web Server started at http://localhost:%s", server.address().port);
});

// Caching related, so is this still required?
// const shutdownServer = (signal) => {
//     log("Shutdown signal received:", signal);
//     try {
//         lyricsCache.closeCache();
//     } finally {
//         process.exit(0);
//     }
// };

// process.on("SIGINT", () => shutdownServer("SIGINT"));
// process.on("SIGTERM", () => shutdownServer("SIGTERM"));
