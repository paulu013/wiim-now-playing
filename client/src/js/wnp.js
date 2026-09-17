// =======================================================
// WiiM Now Playing

// Namespacing
window.WNP = window.WNP || {};

// Default settings
WNP.s = {
    // Host runs on default port 80, but in cases where another port is chosen adapt
    locHostname: location.hostname,
    locPort: (location.port && location.port != "80" && location.port != "1234") ? location.port : "80",
    rndAlbumArtUri: "./img/fake-album-1.jpg",
    // Device selection
    aDeviceUI: ["btnPrev", "btnPlay", "btnStop", "btnNext", "btnRefresh", "selDeviceChoices", "devName", "devNameHolder", "mediaTitle", "mediaTitleLogo", "mediaSubTitle", "mediaArtist", "mediaAlbum", "mediaBitRate", "mediaBitDepth", "mediaSampleRate", "mediaQualityIdent", "devVol", "btnRepeat", "btnShuffle", "progressPlayed", "progressLeft", "progressPercent", "mediaSource", "albumArt", "bgAlbumArtBlur", "btnDevSelect", "oDeviceList", "btnDevPreset", "oPresetList", "btnDevVolume", "rVolume", "mediaLyrics", "lyricPrev", "lyricCurrent", "lyricNext", "lyricAfter", "alerts"],
    // Server actions to be used in the app
    aServerUI: ["btnReboot", "btnUpdate", "btnShutdown", "btnReloadUI", "sServerUrlHostname", "sServerUrlIP", "sServerVersion", "sClientVersion", "chkLyricsEnabled", "lyricsCacheSize", "btnClearLyricsCache", "lyricsOffsetMs",
        "wnpClock", "clockTime", "clockDate", "clockNote", "clockWeather", "clockDial", "dialTicks", "dialNumbers", "dialBrand", "dialSub", "handHour", "handMinute", "handSecond", "clockSeg", "wnpMiniClock",
        "chkClockEnabled", "chkClockOnInput", "chkClockDrift", "clockAfterSeconds", "clockBlankAfterMinutes",
        "selClockTheme", "selClockNightTheme", "chkClockAutoDayNight", "clockDialBrand", "clockDialSub", "chkSegSlant",
        "chkClockOverride", "selClockFont", "selClockColors", "btnApplyPreset", "btnResetColors", "colorRoles", "chkClockGradient", "clockBaseColor", "selClockScheme", "btnApplyScheme", "clockNightDim", "clockNightDimValue", "chkOverlayEnabled", "selOverlayPosition", "selOverlaySize",
        "chkWeatherTemp", "chkWeatherForecast", "chkWeatherLabel", "weatherLocation", "selWeatherUnits", "weatherStatus",
        "selClockLocale", "chkSwipeEnabled", "selSwipeGesture", "selSwipeTransition", "swipeReturnSeconds",
        "wnpNightShift", "chkNightShift", "selNightShiftSchedule", "nightShiftFrom", "nightShiftTo", "nightShiftWarmth", "nightShiftWarmthValue", "nightShiftBrightness", "nightShiftBrightnessValue",
        "chkPresenceEnabled", "selPresenceMode", "presenceOffDelay", "chkVolumeKnob", "volumeKnobStep",
        "chkExternalEnabled", "selExternalPriority", "selExternalArtwork", "plexUrl", "plexToken", "plexPlayers", "plexUsers", "jellyfinUrl", "jellyfinApiKey", "jellyfinPlayers", "jellyfinUsers", "chkClearLogo", "btnSaveSources",
        "wnpHero", "wnpHeroImg", "wnpHeroImgB", "wnpHeroLogo"],
    // Default timeout for alerts in ms
    alertTimeoutMs: 5000
};

// Data placeholders.
WNP.d = {
    serverSettings: null, // Server settings, used to store the server settings
    deviceList: null, // Device list, used to store the devices found through SSDP
    prevTransportState: null, // Previous transport state, used to detect changes in the transport state
    prevPlayMedium: null, // Previous play medium, used to detect changes in the play medium
    prevSourceIdent: null, // Previous source ident, used to detect changes in the source
    prevTrackInfo: null, // Previous track info, used to detect changes in the metadata
    lyrics: [], // Parsed lyrics lines
    lyricsLastRelTime: null, // Last known RelTime, used for lyrics timing
    lyricsLastTimeStampDiffMs: null, // Last known timestamp difference in ms, used for lyrics timing
    lyricsIndex: null, // Current lyrics line index
    alertTimeout: null, // Alert timeout, used for storing the timeout for the alerts
    lastState: null, // Last state message, used by the clock logic
    lastPlayingMs: 0, // Last time real playback occurred (0 = nothing yet, so the clock shows immediately at boot)
    lastActivityMs: Date.now(), // Last time there was any playback activity (drives idle blanking; starts "now" so boot never blanks)
    clockVisible: false, // Whether the clock overlay is currently shown
    clockTimer: null, // Clock tick interval
    driftTimer: null, // Clock drift interval
    weather: null, // Last weather message
    appliedTheme: null, // Theme id currently applied to the clock overlay
    loadedFonts: {}, // Google Fonts already injected
    manualClock: false, // Clock revealed by swipe
    manualClockUntil: 0, // ...and auto-return deadline (ms epoch, 0 = stay)
    swipeStart: null, // Pointer start for swipe detection
    cachedClockCfg: null, // Last-known clock config (from localStorage) used before server-settings arrives
    isExternal: false, // Whether the current session is a Plex/Jellyfin source (routes play/pause, hides N/A controls)
    settingsOpen: false, // Whether the settings modal is open (guards manual-save fields from being clobbered by broadcasts)
    progAnchor: null, // Last known playback position anchor for smooth local progress interpolation
    progressTimer: null, // Local progress ticker interval
    populateSourcesOnce: false, // One-shot: repopulate the Sources form on the next server-settings (set on modal open)
    presenceBlank: false, // Room empty (presence "app-blank" mode) -> blank the screen (fork)
    heroActiveLayer: "a" // Which hero image layer is currently shown (for crossfading backdrop art)
};

// Reference placeholders.
// These are set in the init function
// and are used to reference the UI elements in the app.
WNP.r = {};

/**
 * Initialisation of app.
 * @returns {undefined}
 */
WNP.Init = function () {
    console.log("WNP", "Initialising...");

    // Init Socket.IO, connect to port where server resides
    console.log("WNP", "Listening on " + this.s.locHostname + ":" + this.s.locPort)
    // Connect to the same origin that served the page. Works for direct LAN access
    // (http://host:8099) AND behind a reverse proxy on 443 (wss://name.example.com) — the
    // old `io.connect(":" + locPort)` forced :80 and broke behind an HTTPS proxy. (fork)
    window.socket = io();

    // Set references to the UI elements
    this.setUIReferences();

    // Set Socket.IO definitions
    this.setSocketDefinitions();

    // Set UI event listeners
    this.setUIListeners();

    // Restore the last-known clock config so the correct theme/locale render on the
    // very first frame, before server-settings arrives (avoids a default-theme /
    // English flash on load). Refreshed whenever server-settings is received. (fork)
    try { this.d.cachedClockCfg = JSON.parse(window.localStorage.getItem("wnpClockCfg")); } catch (e) { this.d.cachedClockCfg = null; }

    // Clock overlay (see Settings > Display)
    this.startClock();

    // Smoothly advance the progress bar between polls (no extra API calls)
    this.startProgressTicker();

    // Initial calls, wait a bit for socket to start
    setTimeout(() => {
        // Get server settings
        socket.emit("server-settings");
        // Get devices
        socket.emit("devices-get");
        // See if any lyrics are present for the currently playing track
        socket.emit("lyrics-get");
    }, 500);

    // Create random album intervals, every 3 minutes
    WNP.s.rndAlbumArtUri = WNP.rndAlbumArt("fake-album-");
    var rndAlbumInterval = setInterval(function () {
        WNP.s.rndAlbumArtUri = WNP.rndAlbumArt("fake-album-");
    }, 3 * 60 * 1000);

};

/**
 * Reference to the UI elements of the app.
 * @returns {undefined}
 */
WNP.setUIReferences = function () {
    console.log("WNP", "Set UI references...")

    function addElementToRef(id) {
        const element = document.getElementById(id);
        if (element) {
            WNP.r[id] = element;
        } else {
            console.log("WNP", `Element with ID '${id}' not found in current HTML.`);
        }
    }

    // Set references to the UI elements
    this.s.aDeviceUI.forEach((id) => { addElementToRef(id); });
    this.s.aServerUI.forEach((id) => { addElementToRef(id); });

};

/**
 * Setting the listeners on the UI elements of the app.
 * @returns {void}
 */
WNP.setUIListeners = function () {
    console.log("WNP", "Set UI Listeners...")

    // ------------------------------------------------
    // Player buttons

    // Transport buttons — routed to the external source for Plex/Jellyfin sessions,
    // otherwise to the WiiM device. (fork)
    var transportClick = function () {
        var wnpAction = this.getAttribute("wnp-action");
        if (wnpAction) {
            this.disabled = true;
            socket.emit(WNP.d.isExternal ? "external-action" : "device-action", wnpAction);
        }
    };
    this.r.btnPrev.addEventListener("click", transportClick);
    this.r.btnPlay.addEventListener("click", transportClick);
    this.r.btnNext.addEventListener("click", transportClick);
    if (this.r.btnStop) { this.r.btnStop.addEventListener("click", transportClick); }

    // ------------------------------------------------
    // Device control inputs (only for default GUI, not TV mode)

    // Device select button
    if (this.r.btnDevPreset) {
        this.r.btnDevPreset.addEventListener("click", function () {
            socket.emit("device-api", "getPresetInfo");
        });
    }

    // Device volume range input
    if (this.r.rVolume) {
        this.r.rVolume.addEventListener('input', function () {
            if (!isNaN(this.value) && this.value >= 0 && this.value <= 100) {
                socket.emit("device-api", "setPlayerCmd:vol:" + this.value);
            }
        });
    }

    // ------------------------------------------------
    // Settings buttons

    // Device selection dropdown
    this.r.selDeviceChoices.addEventListener("change", function () {
        socket.emit("device-set", this.value);
    });

    // Refresh devices button
    this.r.btnRefresh.addEventListener("click", function () {
        socket.emit("devices-refresh");
        // Wait for discovery to finish
        setTimeout(() => {
            socket.emit("devices-get");
            socket.emit("server-settings");
        }, 5000);
    });

    // Reboot button
    this.r.btnReboot.addEventListener("click", function () {
        WNP.showAlert("Reboot requested...", "warning");
        socket.emit("server-reboot");
    });

    // Update button
    this.r.btnUpdate.addEventListener("click", function () {
        WNP.showAlert("Update requested...", "warning");
        socket.emit("server-update");
    });

    // Shutdown button
    this.r.btnShutdown.addEventListener("click", function () {
        WNP.showAlert("Shutdown requested...", "danger");
        socket.emit("server-shutdown");
    });

    // Reload UI button
    this.r.btnReloadUI.addEventListener("click", function () {
        location.reload();
    });

    // Clock + weather settings: any change re-sends the whole block
    this.fillClockSelects();
    var clockInputs = ["chkClockEnabled", "chkClockOnInput", "chkClockDrift", "clockAfterSeconds", "clockBlankAfterMinutes",
        "selClockTheme", "selClockNightTheme", "chkClockAutoDayNight", "clockDialBrand", "clockDialSub", "chkSegSlant",
        // NB: clockBaseColor / selClockScheme are deliberately NOT here — they only
        // take effect via the "Apply scheme" button. Auto-emitting on their change
        // round-trips settings that don't carry base/scheme, reverting the pick. (fork)
        "chkClockOverride", "selClockFont", "selClockColors", "btnApplyPreset", "btnResetColors", "colorRoles", "chkClockGradient", "btnApplyScheme", "clockNightDim", "clockNightDimValue", "chkOverlayEnabled", "selOverlayPosition", "selOverlaySize",
        "selClockLocale", "chkSwipeEnabled", "selSwipeGesture", "selSwipeTransition", "swipeReturnSeconds"];
    clockInputs.forEach(function (id) {
        if (!WNP.r[id]) { return; }
        WNP.r[id].addEventListener("change", function () { WNP.emitClockSettings(); });
    });
    // Re-sync the whole settings form from the server each time the modal opens.
    // Init requests server-settings only once (after a short delay), so opening
    // Settings right after a refresh could otherwise show stale HTML defaults
    // (e.g. the clock switch looking off when it is actually on). (fork)
    var settingsModal = document.getElementById("settingsModal");
    if (settingsModal) {
        settingsModal.addEventListener("show.bs.modal", function () { WNP.d.settingsOpen = true; WNP.d.populateSourcesOnce = true; socket.emit("server-settings"); });
        settingsModal.addEventListener("hidden.bs.modal", function () { WNP.d.settingsOpen = false; });
    }
    // Night shift settings
    if (this.r.chkNightShift) {
        var nsEmit = function () {
            socket.emit("features-settings", {
                features: {
                    display: {
                        nightShift: {
                            enabled: WNP.r.chkNightShift.checked,
                            schedule: WNP.r.selNightShiftSchedule.value,
                            from: WNP.r.nightShiftFrom.value || "22:00",
                            to: WNP.r.nightShiftTo.value || "07:00",
                            warmth: parseInt(WNP.r.nightShiftWarmth.value, 10) || 0,
                            brightness: parseInt(WNP.r.nightShiftBrightness.value, 10) || 100
                        }
                    }
                }
            });
        };
        ["chkNightShift", "selNightShiftSchedule", "nightShiftFrom", "nightShiftTo", "nightShiftWarmth", "nightShiftBrightness"].forEach(function (id) {
            WNP.r[id].addEventListener("change", nsEmit);
        });
        this.r.nightShiftWarmth.addEventListener("input", function () { WNP.r.nightShiftWarmthValue.innerText = this.value; WNP.previewNightShift(); });
        this.r.nightShiftBrightness.addEventListener("input", function () { WNP.r.nightShiftBrightnessValue.innerText = this.value; WNP.previewNightShift(); });
    }

    ["chkWeatherTemp", "chkWeatherForecast", "chkWeatherLabel", "weatherLocation", "selWeatherUnits"].forEach(function (id) {
        if (!WNP.r[id]) { return; }
        WNP.r[id].addEventListener("change", function () {
            socket.emit("features-settings", {
                features: {
                    weather: {
                        enabled: WNP.r.chkWeatherTemp.checked,
                        forecast: WNP.r.chkWeatherForecast.checked,
                        showLabel: WNP.r.chkWeatherLabel.checked,
                        location: WNP.r.weatherLocation.value.trim(),
                        units: WNP.r.selWeatherUnits.value
                    }
                }
            });
        });
    });

    // Presence sensor + volume knob (kiosk companion features). (fork)
    ["chkPresenceEnabled", "selPresenceMode", "presenceOffDelay"].forEach(function (id) {
        if (!WNP.r[id]) { return; }
        WNP.r[id].addEventListener("change", function () {
            socket.emit("features-settings", {
                features: {
                    presence: {
                        enabled: WNP.r.chkPresenceEnabled.checked,
                        mode: WNP.r.selPresenceMode.value,
                        offDelaySec: parseInt(WNP.r.presenceOffDelay.value, 10) || 45
                    }
                }
            });
        });
    });
    ["chkVolumeKnob", "volumeKnobStep"].forEach(function (id) {
        if (!WNP.r[id]) { return; }
        WNP.r[id].addEventListener("change", function () {
            socket.emit("features-settings", {
                features: {
                    volumeKnob: {
                        enabled: WNP.r.chkVolumeKnob.checked,
                        step: parseInt(WNP.r.volumeKnobStep.value, 10) || 3
                    }
                }
            });
        });
    });

    // External sources (Plex / Jellyfin) settings
    if (this.r.btnSaveSources) {
        this.r.btnSaveSources.addEventListener("click", function () {
            socket.emit("features-settings", {
                features: {
                    external: {
                        enabled: WNP.r.chkExternalEnabled.checked,
                        priority: WNP.r.selExternalPriority.value,
                        artwork: WNP.r.selExternalArtwork.value,
                        clearLogo: WNP.r.chkClearLogo ? WNP.r.chkClearLogo.checked : true,
                        plex: { url: WNP.r.plexUrl.value.trim(), token: WNP.r.plexToken.value.trim(), players: WNP.r.plexPlayers.value, users: WNP.r.plexUsers.value },
                        jellyfin: { url: WNP.r.jellyfinUrl.value.trim(), apiKey: WNP.r.jellyfinApiKey.value.trim(), players: WNP.r.jellyfinPlayers.value, users: WNP.r.jellyfinUsers.value }
                    }
                }
            });
            WNP.showAlert("Sources saved", "success");
        });
    }

    // Set lyrics toggle
    this.r.chkLyricsEnabled.addEventListener("change", function () {
        socket.emit("lyrics-settings", {
            features: {
                lyrics: {
                    enabled: this.checked
                }
            }
        });
    });

    // Clear lyrics cache button
    this.r.btnClearLyricsCache.addEventListener("click", function () {
        if (confirm("Are you sure you want to clear the lyrics cache?")) {
            socket.emit("lyrics-cache-clear");
        }
    });

    // Set lyrics offset in ms
    this.r.lyricsOffsetMs.addEventListener("change", function () {
        var offsetValue = parseInt(this.value, 10);
        if (isNaN(offsetValue)) {
            offsetValue = 0;
        }
        socket.emit("lyrics-settings", {
            features: {
                lyrics: {
                    offsetMs: offsetValue
                }
            }
        });
    });

};

/**
 * Set the socket definitions to listen for specific websocket traffic and handle accordingly.
 * @returns {undefined}
 */
WNP.setSocketDefinitions = function () {
    console.log("WNP", "Setting Socket definitions...")

    // On socket connect
    socket.on("connect", function () {
        console.log("WNP", "Socket connected");
    });

    // On socket disconnect
    socket.on("disconnect", function () {
        console.log("WNP", "Socket disconnected");
        WNP.showAlert("Disconnected from server. Attempting to reconnect...", "warning");
    });

    // On socket connect error
    socket.on("connect_error", (error) => {
        console.log("WNP", "Socket connect error:", error.message);
        WNP.showAlert("Unable to connect to server. <br />Please ensure the server is running and refresh the page.", "danger");
    });

    // On server settings
    socket.on("server-settings", function (msg) {

        // Store server settings
        WNP.d.serverSettings = msg;

        // Cache the clock config so the next load paints the right theme/locale
        // immediately (see WNP.d.cachedClockCfg / clockCfg). (fork)
        if (msg && msg.features && msg.features.clock) {
            try { window.localStorage.setItem("wnpClockCfg", JSON.stringify(msg.features.clock)); } catch (e) { /* storage unavailable */ }
        }

        // RPi has bash, so possibly able to reboot/shutdown.
        if (msg && msg.os && msg.os.userInfo && msg.os.userInfo.shell === "/bin/bash") {
            WNP.r.btnReboot.disabled = false;
            WNP.r.btnUpdate.disabled = false;
            WNP.r.btnShutdown.disabled = false;
        };

        // Set device name
        WNP.r.devName.innerText = (msg && msg.selectedDevice && msg.selectedDevice.friendlyName) ? msg.selectedDevice.friendlyName : "-";

        // Set the server local url
        if (msg && msg.os && msg.os.hostname) {
            var sUrl = "http://" + msg.os.hostname.toLowerCase() + ".local";
            sUrl += (location && location.port && location.port != 80) ? ":" + location.port + "/" : "/";
            WNP.r.sServerUrlHostname.innerHTML = "<a href=\"" + sUrl + "\">" + sUrl + "</a>";
        }
        else {
            WNP.r.sServerUrlHostname.innerText = "-";
        }
        // Set the server ip address
        if (msg && msg.selectedDevice && msg.selectedDevice.location && msg.os && msg.os.networkInterfaces) {
            // Grab the ip address pattern of the selected device
            // Assumption is that the wiim-now-playing server is on the same ip range as the client..
            var sLocationIp = msg.selectedDevice.location.split("/")[2]; // Extract ip address from location
            var aIpAddress = sLocationIp.split("."); // Split ip address in parts
            aIpAddress.pop(); // Remove the last part
            var sIpPattern = aIpAddress.join("."); // Construct ip address pattern
            // Search for server ip address(es) in this range...
            Object.keys(msg.os.networkInterfaces).forEach(function (key, index) {
                var sIpFound = msg.os.networkInterfaces[key].find(addr => addr.address.startsWith(sIpPattern))
                if (sIpFound) {
                    // Construct ip address and optional port
                    var sUrl = "http://" + sIpFound.address;
                    sUrl += (location && location.port && location.port != 80) ? ":" + location.port + "/" : "/";
                    WNP.r.sServerUrlIP.innerHTML = "<a href=\"" + sUrl + "\">" + sUrl + "</a>";
                }
            });
        }
        else {
            WNP.r.sServerUrlIP.innerText = "-";
        }

        // Set the server version
        WNP.r.sServerVersion.innerText = (msg && msg.version && msg.version.server) ? msg.version.server : "-";
        // Set the client version
        WNP.r.sClientVersion.innerText = (msg && msg.version && msg.version.client) ? msg.version.client : "-";

        // Clock settings
        var clk = (msg && msg.features && msg.features.clock) ? msg.features.clock : {};
        if (WNP.r.chkClockEnabled) {
            WNP.r.chkClockEnabled.checked = clk.enabled !== false;
            WNP.r.chkClockOnInput.checked = Boolean(clk.onInput);
            WNP.r.chkClockDrift.checked = clk.drift !== false;
            WNP.r.clockAfterSeconds.value = (typeof clk.afterSeconds === "number") ? clk.afterSeconds : 10;
            WNP.r.clockBlankAfterMinutes.value = (typeof clk.blankAfterMinutes === "number") ? clk.blankAfterMinutes : 0;
            WNP.r.selClockTheme.value = clk.theme || "digital-minimal";
            WNP.r.selClockNightTheme.value = clk.nightTheme || clk.theme || "digital-minimal";
            WNP.r.chkClockAutoDayNight.checked = Boolean(clk.autoDayNight);
            WNP.r.clockDialBrand.value = (clk.dialText && clk.dialText.brand) || "";
            WNP.r.clockDialSub.value = (clk.dialText && clk.dialText.sub) || "";
            if (WNP.r.chkSegSlant) {
                WNP.r.chkSegSlant.checked = clk.segmentSlant !== false; // default slanted
            }
            WNP.r.chkClockOverride.checked = Boolean(clk.override && clk.override.enabled);
            WNP.r.selClockFont.value = (clk.override && clk.override.font) || "";
            var col = clk.colors || {};
            WNP.r.chkClockGradient.checked = Boolean(col.gradient);
            WNP.r.clockNightDim.value = (typeof col.nightDim === "number") ? col.nightDim : 100;
            WNP.r.clockNightDimValue.innerText = WNP.r.clockNightDim.value;
            if (col.base) { WNP.r.clockBaseColor.value = col.base; }
            if (col.scheme) { WNP.r.selClockScheme.value = col.scheme; }
            var themeNow = WNP.clockThemes[clk.theme] || WNP.clockThemes["digital-minimal"];
            var eff = WNP.effectiveColors(themeNow);
            var custom = col.custom || {};
            WNP.colorRoles.forEach(function (r) {
                var inp = document.getElementById("role_" + r.id);
                if (!inp) { return; }
                inp.value = eff[r.id];
                inp.parentElement.parentElement.classList.toggle("opacity-50", !custom[r.id]);
                inp.parentElement.parentElement.style.display = (r.kinds.indexOf(themeNow.kind) >= 0) ? "" : "none";
            });
            WNP.r.chkOverlayEnabled.checked = Boolean(clk.overlay && clk.overlay.enabled);
            WNP.r.selOverlayPosition.value = (clk.overlay && clk.overlay.position) || "top-right";
            WNP.r.selOverlaySize.value = (clk.overlay && clk.overlay.size) || "m";
            WNP.r.selClockLocale.value = clk.locale || "en-GB";
            WNP.r.chkSwipeEnabled.checked = Boolean(clk.swipe && clk.swipe.enabled);
            WNP.r.selSwipeGesture.value = (clk.swipe && clk.swipe.gesture) || "left";
            WNP.r.selSwipeTransition.value = (clk.swipe && clk.swipe.transition) || "slide-left";
            WNP.r.swipeReturnSeconds.value = (clk.swipe && typeof clk.swipe.returnAfterSeconds === "number") ? clk.swipe.returnAfterSeconds : 30;
        }
        var ns = (msg && msg.features && msg.features.display && msg.features.display.nightShift) || {};
        if (WNP.r.chkNightShift) {
            WNP.r.chkNightShift.checked = Boolean(ns.enabled);
            WNP.r.selNightShiftSchedule.value = ns.schedule || "sun";
            WNP.r.nightShiftFrom.value = ns.from || "22:00";
            WNP.r.nightShiftTo.value = ns.to || "07:00";
            WNP.r.nightShiftWarmth.value = (typeof ns.warmth === "number") ? ns.warmth : 60;
            WNP.r.nightShiftWarmthValue.innerText = WNP.r.nightShiftWarmth.value;
            WNP.r.nightShiftBrightness.value = (typeof ns.brightness === "number") ? ns.brightness : 80;
            WNP.r.nightShiftBrightnessValue.innerText = WNP.r.nightShiftBrightness.value;
        }
        WNP.applyNightShift();
        var pres = (msg && msg.features && msg.features.presence) ? msg.features.presence : {};
        if (WNP.r.chkPresenceEnabled) {
            WNP.r.chkPresenceEnabled.checked = Boolean(pres.enabled);
            WNP.r.selPresenceMode.value = pres.mode || "power-off";
            WNP.r.presenceOffDelay.value = (typeof pres.offDelaySec === "number") ? pres.offDelaySec : 45;
        }
        var vk = (msg && msg.features && msg.features.volumeKnob) ? msg.features.volumeKnob : {};
        if (WNP.r.chkVolumeKnob) {
            WNP.r.chkVolumeKnob.checked = Boolean(vk.enabled);
            WNP.r.volumeKnobStep.value = (typeof vk.step === "number") ? vk.step : 3;
        }
        var wx = (msg && msg.features && msg.features.weather) ? msg.features.weather : {};
        if (WNP.r.chkWeatherTemp) {
            WNP.r.chkWeatherTemp.checked = Boolean(wx.enabled);
            WNP.r.chkWeatherForecast.checked = Boolean(wx.forecast);
            if (WNP.r.chkWeatherLabel) { WNP.r.chkWeatherLabel.checked = wx.showLabel !== false; } // default on
            WNP.r.weatherLocation.value = wx.location || "";
            WNP.r.selWeatherUnits.value = wx.units || "metric";
            WNP.r.weatherStatus.innerText = wx.name ? ("Resolved to: " + wx.name) : (wx.location ? "Resolving location..." : "");
        }
        WNP.d.appliedTheme = null; // Re-apply theme with the new settings
        WNP.applyClockTheme();
        WNP.applyMiniClock();
        WNP.renderWeather(); // weather may have arrived before settings; (re)render now that we know if it's enabled

        // External sources settings. These save only on the "Save sources" button, so
        // don't repopulate them while the modal is open — a background server-settings
        // broadcast (e.g. the ~10s rescan, or another auto-save) would otherwise wipe an
        // in-progress edit such as the Plex token before it is saved. (fork)
        var ext = (msg && msg.features && msg.features.external) ? msg.features.external : {};
        if (WNP.r.chkExternalEnabled && (!WNP.d.settingsOpen || WNP.d.populateSourcesOnce)) {
            WNP.d.populateSourcesOnce = false; // consumed: later background broadcasts won't clobber edits
            WNP.r.chkExternalEnabled.checked = ext.enabled !== false;
            WNP.r.selExternalPriority.value = ext.priority || "wiim";
            if (WNP.r.selExternalArtwork) { WNP.r.selExternalArtwork.value = ext.artwork || "backdrop"; }
            if (WNP.r.chkClearLogo) { WNP.r.chkClearLogo.checked = ext.clearLogo !== false; } // default on
            WNP.r.plexUrl.value = (ext.plex && ext.plex.url) || "";
            WNP.r.plexToken.value = (ext.plex && ext.plex.token) || "";
            WNP.r.plexPlayers.value = (ext.plex && ext.plex.players) ? [].concat(ext.plex.players).join(", ") : "";
            if (WNP.r.plexUsers) { WNP.r.plexUsers.value = (ext.plex && ext.plex.users) ? [].concat(ext.plex.users).join(", ") : ""; }
            WNP.r.jellyfinUrl.value = (ext.jellyfin && ext.jellyfin.url) || "";
            WNP.r.jellyfinApiKey.value = (ext.jellyfin && ext.jellyfin.apiKey) || "";
            WNP.r.jellyfinPlayers.value = (ext.jellyfin && ext.jellyfin.players) ? [].concat(ext.jellyfin.players).join(", ") : "";
            if (WNP.r.jellyfinUsers) { WNP.r.jellyfinUsers.value = (ext.jellyfin && ext.jellyfin.users) ? [].concat(ext.jellyfin.users).join(", ") : ""; }
        }

        // Lyrics enabled/disabled
        if (WNP.r.chkLyricsEnabled) {
            WNP.r.chkLyricsEnabled.checked = Boolean(msg && msg.features && msg.features.lyrics && msg.features.lyrics.enabled);
        }
        // Lyrics offset in ms
        if (WNP.r.lyricsOffsetMs) {
            var offsetMs = (msg && msg.features && msg.features.lyrics && typeof msg.features.lyrics.offsetMs === "number") ? msg.features.lyrics.offsetMs : 0;
            WNP.r.lyricsOffsetMs.value = offsetMs;
        }

    });

    // On devices get
    socket.on("devices-get", function (msg) {

        // Store and sort device list
        WNP.d.deviceList = msg;
        WNP.d.deviceList.sort((a, b) => { return (a.friendlyName < b.friendlyName) ? -1 : 1 });

        // Clear choices
        WNP.r.selDeviceChoices.innerHTML = "<option value=\"\">Select a device...</em></li>"; // Settings modal
        if (WNP.r.oDeviceList) WNP.r.oDeviceList.innerHTML = ""; // Device dropup

        // Add WiiM devices
        var devicesWiiM = WNP.d.deviceList.filter((d) => { return d.manufacturer.startsWith("Linkplay") });
        if (devicesWiiM.length > 0) {

            // Device select options
            var optGroup = document.createElement("optgroup");
            optGroup.label = "WiiM devices";
            devicesWiiM.forEach((device) => {
                var opt = document.createElement("option");
                opt.value = device.location;
                opt.innerText = device.friendlyName;
                opt.title = "By " + device.manufacturer;
                if (WNP.d.serverSettings && WNP.d.serverSettings.selectedDevice && WNP.d.serverSettings.selectedDevice.location === device.location) {
                    opt.setAttribute("selected", "selected");
                };
                optGroup.appendChild(opt);
            })
            WNP.r.selDeviceChoices.appendChild(optGroup);

            // Device dropup
            if (WNP.r.oDeviceList) {
                devicesWiiM.forEach((device) => {
                    var ddItem = document.createElement("li");
                    var ddItemA = document.createElement("a");
                    ddItemA.className = "dropdown-item";
                    ddItemA.href = "javascript:WNP.setDeviceByLocation('" + device.location + "');";
                    ddItemA.innerText = device.friendlyName;
                    if (WNP.d.serverSettings && WNP.d.serverSettings.selectedDevice && WNP.d.serverSettings.selectedDevice.location === device.location) {
                        ddItemA.classList.add("active");
                        ddItemA.setAttribute("aria-current", "true");
                    }
                    ddItem.appendChild(ddItemA);
                    WNP.r.oDeviceList.appendChild(ddItem);
                })
            }

        };

        // Other devices
        // Possibly removing this section in future releases.
        var devicesOther = WNP.d.deviceList.filter((d) => { return !d.manufacturer.startsWith("Linkplay") });
        if (devicesOther.length > 0) {

            // Device select dropdown options
            var optGroup = document.createElement("optgroup");
            optGroup.label = "Other devices";
            devicesOther.forEach((device) => {
                var opt = document.createElement("option");
                opt.value = device.location;
                opt.innerText = device.friendlyName;
                opt.title = "By " + device.manufacturer;
                if (WNP.d.serverSettings && WNP.d.serverSettings.selectedDevice && WNP.d.serverSettings.selectedDevice.location === device.location) {
                    opt.setAttribute("selected", "selected");
                };
                optGroup.appendChild(opt);
            })
            WNP.r.selDeviceChoices.appendChild(optGroup);

            // Device dropup
            // We won't show non-WiiM devices in the dropup for now.

        };

        // No devices found
        if (devicesWiiM.length == 0 && devicesOther.length == 0) {
            WNP.r.selDeviceChoices.innerHTML = "<option disabled=\"disabled\">No devices found!</em></li>";
            if (WNP.r.oDeviceList) WNP.r.oDeviceList.innerHTML = "<li><span class=\"dropdown-header\">No devices found!</span></li>";
        };

    });

    // On state
    socket.on("state", function (msg) {
        WNP.d.lastState = msg || null;
        if (!msg) { return false; }

        // Get player progress data from the state message.
        var timeStampDiffMs = 0;
        var timeStampDiff = 0;
        if (msg.stateTimeStamp && msg.metadataTimeStamp) {
            timeStampDiffMs = msg.stateTimeStamp - msg.metadataTimeStamp;
            timeStampDiff = Math.round(timeStampDiffMs / 1000);
        }
        var relTime = (msg.RelTime) ? msg.RelTime : "00:00:00";
        var trackDuration = (msg.TrackDuration) ? msg.TrackDuration : "00:00:00";

        // Only if PLAYING do we need to update the progress bar and lyrics timing.
        // We also want to update the lyrics if the transport state changed and the RelTime is different than the last known one, as this indicates that the track was changed or playback was stopped/started again.
        if (msg.CurrentTransportState === "PLAYING" || (WNP.d.prevTransportState !== msg.CurrentTransportState && WNP.d.lyricsLastRelTime !== relTime)) {
            // console.log("WNP", "Updating progress and lyrics timing...", { relTime, trackDuration, timeStampDiff, currentTransportState: msg.CurrentTransportState });

            WNP.d.lyricsLastRelTime = relTime; // Update the last known RelTime for lyrics timing
            WNP.d.lyricsLastTimeStampDiffMs = timeStampDiffMs; // Update the last known timestamp difference for lyrics timing

            // Anchor the progress so a local ticker advances it smoothly between polls
            // (fluent bar, no extra API calls). See WNP.renderProgress / startProgressTicker. (fork)
            var newBase = WNP.convertToSeconds(relTime) + timeStampDiff;
            var durSec = WNP.convertToSeconds(trackDuration);
            var nowPlaying = msg.CurrentTransportState === "PLAYING";
            var prevAnchor = WNP.d.progAnchor;
            // Ignore tiny backward corrections (whole-second RelTime vs. fractional
            // interpolation / poll jitter) so the bar never visibly steps back. Real
            // seeks (>3s) and track changes (duration change) still snap. (fork)
            if (prevAnchor && nowPlaying && prevAnchor.playing && prevAnchor.durationSec === durSec) {
                var curPos = prevAnchor.baseSec + (Date.now() - prevAnchor.atMs) / 1000;
                if (newBase < curPos && (curPos - newBase) < 3) { newBase = curPos; }
            }
            WNP.d.progAnchor = { baseSec: newBase, durationSec: durSec, playing: nowPlaying, atMs: Date.now() };
            WNP.renderProgress();

            WNP.updateLyricsProgress(relTime, timeStampDiffMs, "state tick");
            setTimeout(function () { // Do another update half tick (state timeout) to make sure the progress is updated and the lyrics are in sync.
                var timeoutState = (WNP.d.serverSettings?.timeouts?.state || 1000) / 2;
                WNP.updateLyricsProgress(msg.RelTime, timeStampDiffMs + timeoutState, "half state tick");
            }, 500);

        }

        // Device transport state or play medium changed...?
        if (WNP.d.prevTransportState !== msg.CurrentTransportState || WNP.d.prevPlayMedium !== msg.PlayMedium) {
            if (msg.CurrentTransportState === "TRANSITIONING") {
                WNP.r.btnPlay.children[0].className = "bi bi-circle-fill";
                WNP.r.btnPlay.disabled = true;
            };
            if (msg.CurrentTransportState === "PLAYING") {
                // Radio live streams are preferrentialy stopped as pausing keeps cache for minutes/hours(?).
                // Stop > Play resets the stream to 'now'. Pause works like 'live tv time shift'.
                if (msg.PlayMedium && msg.PlayMedium === "RADIO-NETWORK") {
                    WNP.r.btnPlay.children[0].className = "bi bi-stop-circle-fill";
                    WNP.r.btnPlay.setAttribute("wnp-action", "Stop");
                }
                else {
                    WNP.r.btnPlay.children[0].className = "bi bi-pause-circle-fill";
                    WNP.r.btnPlay.setAttribute("wnp-action", "Pause");
                }
                WNP.r.btnPlay.disabled = false;
            }
            else if (msg.CurrentTransportState === "PAUSED_PLAYBACK" || msg.CurrentTransportState === "STOPPED") {
                WNP.r.btnPlay.children[0].className = "bi bi-play-circle-fill";
                WNP.r.btnPlay.setAttribute("wnp-action", "Play");
                WNP.r.btnPlay.disabled = false;
            };
            WNP.d.prevTransportState = msg.CurrentTransportState; // Remember the last transport state
            WNP.d.prevPlayMedium = msg.PlayMedium; // Remember the last PlayMedium
        }

        // If internet radio, there is no skipping... just start and stop!
        if (msg.PlayMedium && msg.PlayMedium === "RADIO-NETWORK") {
            WNP.r.btnPrev.disabled = true;
            WNP.r.btnNext.disabled = true;
        }
        else {
            WNP.r.btnPrev.disabled = false;
            WNP.r.btnNext.disabled = false;
        }

        // External (Plex/Jellyfin) session: shuffle/repeat don't apply (hidden) and a
        // stop button is shown; prev/play/next/stop route to the external source. Driven
        // by a body class + CSS so it can't flicker when other code rewrites button
        // classes (e.g. the LoopMode block). (fork)
        WNP.d.isExternal = Boolean(msg.external);
        document.body.classList.toggle("wnp-external", WNP.d.isExternal);

        // Session ended: drop the hero/artwork layout so the normal idle clock + controls
        // return. The classes are set from metadata, which isn't re-emitted on stop, so we
        // clear them here on the STOPPED state (which is emitted). PAUSED keeps the backdrop. (fork)
        if (msg.CurrentTransportState === "STOPPED" || msg.CurrentTransportState === "NO_MEDIA_PRESENT") {
            var hadArt = ["wnp-hero", "wnp-art-backdrop", "wnp-art-poster", "wnp-art-still", "wnp-art-clock"]
                .some(function (c) { return document.body.classList.contains(c); });
            document.body.classList.remove("wnp-hero", "wnp-art-backdrop", "wnp-art-poster", "wnp-art-still", "wnp-art-clock");
            // Removing the hero/art classes reveals the plain now-playing view (with the last
            // album-art poster) until the idle-clock delay elapses. When we were showing the
            // hero/clock, jump straight to the clock in this same frame so the poster never
            // flashes: reset the idle timer and reveal the clock now (the tick keeps it up). (fork)
            if (hadArt && WNP.r.wnpClock) {
                WNP.d.lastPlayingMs = 0; // idle immediately, skip the "show clock after" delay
                WNP.d.manualClock = false;
                WNP.d.clockVisible = true;
                WNP.r.wnpClock.classList.add("visible");
                document.body.classList.add("wnp-clock-on");
            }
        }

    });

    // On metadata
    socket.on("metadata", function (msg) {
        if (!msg) { return false; }

        // Source detection
        var playMedium = (msg.PlayMedium) ? msg.PlayMedium : "";
        var trackSource = (msg.TrackSource) ? msg.TrackSource : "";
        var sourceIdent = WNP.getSourceIdent(playMedium, trackSource);
        // Did the source ident change...?
        if (sourceIdent !== WNP.d.prevSourceIdent) {
            if (sourceIdent !== "") {
                var identImg = document.createElement("img");
                identImg.src = sourceIdent;
                identImg.alt = playMedium + ": " + trackSource;
                identImg.title = playMedium + ": " + trackSource;
                mediaSource.innerHTML = identImg.outerHTML;
            }
            else {
                // No icon for this source: show its name (e.g. Jellyfin)
                mediaSource.innerText = trackSource || playMedium;
            }
            WNP.d.prevSourceIdent = sourceIdent; // Remember the last Source Ident
        }

        // Song Title, Subtitle, Artist, Album
        WNP.r.mediaTitle.innerText = (msg.trackMetaData && msg.trackMetaData["dc:title"]) ? msg.trackMetaData["dc:title"] : "";
        WNP.r.mediaSubTitle.innerText = (msg.trackMetaData && msg.trackMetaData["dc:subtitle"]) ? msg.trackMetaData["dc:subtitle"] : "";
        WNP.r.mediaArtist.innerText = (msg.trackMetaData && msg.trackMetaData["upnp:artist"]) ? (Array.isArray(msg.trackMetaData["upnp:artist"]) ? msg.trackMetaData["upnp:artist"][0] : msg.trackMetaData["upnp:artist"]) : "";
        WNP.r.mediaAlbum.innerText = (msg.trackMetaData && msg.trackMetaData["upnp:album"]) ? msg.trackMetaData["upnp:album"] : "";
        // Plex user rating (external sessions only), 0-10 -> stars
        var wnpRating = (msg.trackMetaData && msg.trackMetaData["wnp:rating"]) ? Number(msg.trackMetaData["wnp:rating"]) : 0;
        if (wnpRating > 0) {
            WNP.r.mediaAlbum.innerText += "  " + "\u2605".repeat(Math.round(wnpRating / 2));
        }
        if (playMedium === "SONGLIST-NETWORK" && !trackSource && msg.CurrentTransportState === "STOPPED") {
            WNP.r.mediaTitle.innerText = "No Music Selected";
        }

        // Audio quality — not meaningful for video (Plex/Jellyfin movies & episodes),
        // so hide the whole kbps/bits/kHz line for those. (fork)
        var mediaKind = (msg.trackMetaData && msg.trackMetaData["wnp:kind"]) ? msg.trackMetaData["wnp:kind"] : "";
        var isVideo = ["movie", "episode", "video", "clip"].indexOf(mediaKind) >= 0;
        var mediaQualityEl = document.getElementById("mediaQuality");
        if (mediaQualityEl) { mediaQualityEl.style.display = isVideo ? "none" : ""; }
        var songBitrate = (msg.trackMetaData && msg.trackMetaData["song:bitrate"]) ? msg.trackMetaData["song:bitrate"] : "";
        var songBitDepth = (msg.trackMetaData && msg.trackMetaData["song:format_s"]) ? msg.trackMetaData["song:format_s"] : "";
        var songSampleRate = (msg.trackMetaData && msg.trackMetaData["song:rate_hz"]) ? msg.trackMetaData["song:rate_hz"] : "";
        WNP.r.mediaBitRate.innerText = (songBitrate > 0) ? ((songBitrate > 1000) ? (songBitrate / 1000).toFixed(2) + " mbps, " : songBitrate + " kbps, ") : "";
        WNP.r.mediaBitDepth.innerText = (songBitDepth > 0) ? ((songBitDepth > 24) ? "24 bit/" : songBitDepth + " bit/") : "";
        WNP.r.mediaSampleRate.innerText = (songSampleRate > 0) ? (songSampleRate / 1000).toFixed(1) + " kHz" : "";
        if (!songBitrate && !songBitDepth && !songSampleRate) {
            WNP.r.mediaQualityIdent.style.display = "none";
        }
        else {
            WNP.r.mediaQualityIdent.style.display = "inline-block";
        }

        // Audio quality ident badge (HD/Hi-res/CD/...)
        var songQuality = (msg.trackMetaData && msg.trackMetaData["song:quality"]) ? msg.trackMetaData["song:quality"] : "";
        var songActualQuality = (msg.trackMetaData && msg.trackMetaData["song:actualQuality"]) ? msg.trackMetaData["song:actualQuality"] : "";
        var qualiIdent = WNP.getQualityIdent(songQuality, songActualQuality, songBitrate, songBitDepth, songSampleRate);
        if (qualiIdent !== "") {
            WNP.r.mediaQualityIdent.innerText = qualiIdent;
            WNP.r.mediaQualityIdent.title = "Quality: " + songQuality + ", " + songActualQuality;
        }
        else {
            var identId = document.createElement("i");
            identId.className = "bi bi-soundwave text-secondary";
            identId.title = "Quality: " + songQuality + ", " + songActualQuality;
            WNP.r.mediaQualityIdent.innerHTML = identId.outerHTML;
        }

        // Pre-process Album Art uri, if any is available from the metadata.
        var albumArtUriRaw = (msg.trackMetaData && msg.trackMetaData["upnp:albumArtURI"]) ? (Array.isArray(msg.trackMetaData["upnp:albumArtURI"]) ? msg.trackMetaData["upnp:albumArtURI"][0] : msg.trackMetaData["upnp:albumArtURI"]) : "";
        var albumArtUri = WNP.checkAlbumArtURI(albumArtUriRaw, msg.metadataTimeStamp);

        // Set Album Art, only if the track changed and the URI changed
        var trackChanged = false;
        var currentTrackInfo = WNP.r.mediaTitle.textContent + "|" + WNP.r.mediaSubTitle.innerText + "|" + WNP.r.mediaArtist.innerText + "|" + WNP.r.mediaAlbum.innerText; // textContent: title may be hidden (clear-logo mode) where innerText returns ""
        var currentAlbumArt = WNP.r.albumArt.src;
        if (WNP.d.prevTrackInfo !== currentTrackInfo) {
            trackChanged = true;
            WNP.d.prevTrackInfo = currentTrackInfo; // Remember the last track info
            console.log("WNP", "Track changed:", currentTrackInfo);
            WNP.clearLyrics();
            // Fade/slide the now-playing info and album art in on each new track. (fork)
            WNP.playEnter(document.querySelector(".wnpMediaInfo"));
            WNP.playEnter(document.querySelector(".wnpAlbumArt"));
        }
        if (trackChanged && currentAlbumArt != albumArtUri) {
            WNP.setAlbumArt(albumArtUri);
        }

        // Backdrop-hero artwork: full-screen fanart behind the now-playing view
        // (Plex/Jellyfin video, Settings > Sources > Artwork). (fork)
        var artMode = (msg.trackMetaData && msg.trackMetaData["wnp:artwork"]) || "";
        var heroLogo = (msg.trackMetaData && msg.trackMetaData["wnp:logo"]) || "";
        // Per-artwork layout hooks (external only): poster/backdrop get a large left-aligned
        // title, hide the device line, and move the source logo to the bottom-right. (fork)
        var extArtMode = msg.external ? artMode : "";
        ["backdrop", "poster", "still", "clock"].forEach(function (m) {
            document.body.classList.toggle("wnp-art-" + m, extArtMode === m);
        });
        // "clock" shows the clock over the backdrop (like backdrop, but the clock replaces the info).
        var heroOn = (artMode === "backdrop" || artMode === "clock") && Boolean(albumArtUri) && WNP.r.wnpHero;
        document.body.classList.toggle("wnp-hero", Boolean(heroOn));
        // Only (re)set the backdrop on a track change or when empty — the https art URL
        // carries a changing cache-buster, so setting it every tick would flicker.
        var heroHasImg = WNP.r.wnpHeroImg.getAttribute("src") || (WNP.r.wnpHeroImgB && WNP.r.wnpHeroImgB.getAttribute("src"));
        if (heroOn && (trackChanged || !heroHasImg)) {
            WNP.setHeroImage(albumArtUri); // crossfade to the new backdrop
        }

        // Clear logo instead of the plain-text title (Settings > Sources > "Show the clear
        // logo…", default on) when one is available for the album/show/movie. Falls back to
        // the title text if the logo image fails to load. (fork)
        var extCfg = (WNP.d.serverSettings && WNP.d.serverSettings.features && WNP.d.serverSettings.features.external) || {};
        var showTitleLogo = (extCfg.clearLogo !== false) && Boolean(heroLogo);
        if (WNP.r.mediaTitleLogo) {
            if (showTitleLogo) {
                if (WNP.r.mediaTitleLogo.getAttribute("src") !== heroLogo) {
                    WNP.r.mediaTitleLogo.onerror = function () { // no logo at that URL -> revert to the title text
                        this.classList.add("d-none");
                        this.removeAttribute("src");
                        WNP.r.mediaTitle.classList.remove("d-none");
                    };
                    WNP.r.mediaTitleLogo.src = heroLogo;
                    if (trackChanged) { WNP.playEnter(WNP.r.mediaTitleLogo); }
                }
                WNP.r.mediaTitleLogo.classList.remove("d-none");
                WNP.r.mediaTitle.classList.add("d-none");
            } else {
                WNP.r.mediaTitleLogo.classList.add("d-none");
                WNP.r.mediaTitleLogo.removeAttribute("src");
                WNP.r.mediaTitle.classList.remove("d-none");
            }
        }

        // Device volume
        WNP.r.devVol.innerText = (msg.CurrentVolume) ? msg.CurrentVolume : "-"; // Set the volume on the UI
        if (WNP.r.rVolume && (WNP.r.rVolume.value !== WNP.r.devVol.innerText)) { // If volume on the range slider is different then update the range input value
            WNP.r.rVolume.value = WNP.r.devVol.innerText;
        }

        // Loop mode status (not applicable to external Plex/Jellyfin sessions)
        if (msg.LoopMode && !WNP.d.isExternal) {
            switch (msg.LoopMode) {
                case "5": // repeat-1 | shuffle
                    WNP.r.btnRepeat.className = "btn btn-outline-success";
                    WNP.r.btnRepeat.children[0].className = "bi bi-repeat-1";
                    WNP.r.btnShuffle.className = "btn btn-outline-success";
                    break;
                case "3": // no repeat | shuffle
                    WNP.r.btnRepeat.className = "btn btn-outline-light";
                    WNP.r.btnRepeat.children[0].className = "bi bi-repeat";
                    WNP.r.btnShuffle.className = "btn btn-outline-success";
                    break;
                case "2": // repeat | shuffle
                    WNP.r.btnRepeat.className = "btn btn-outline-success";
                    WNP.r.btnRepeat.children[0].className = "bi bi-repeat";
                    WNP.r.btnShuffle.className = "btn btn-outline-success";
                    break;
                case "1": // repeat-1 | no shuffle
                    WNP.r.btnRepeat.className = "btn btn-outline-success";
                    WNP.r.btnRepeat.children[0].className = "bi bi-repeat-1";
                    WNP.r.btnShuffle.className = "btn btn-outline-light";
                    // change repeat icon
                    break;
                case "0": // repeat | no shuffle
                    WNP.r.btnRepeat.className = "btn btn-outline-success";
                    WNP.r.btnRepeat.children[0].className = "bi bi-repeat";
                    WNP.r.btnShuffle.className = "btn btn-outline-light";
                    break;
                default: // no repeat | no shuffle #4
                    WNP.r.btnRepeat.className = "btn btn-outline-light";
                    WNP.r.btnRepeat.children[0].className = "bi bi-repeat";
                    WNP.r.btnShuffle.className = "btn btn-outline-light";
            }
        }
        else { // Unknown, so set default
            WNP.r.btnRepeat.className = "btn btn-outline-light";
            WNP.r.btnRepeat.children[0].className = "bi bi-repeat";
            WNP.r.btnShuffle.className = "btn btn-outline-light";
        }

    });

    // On lyrics
    socket.on("lyrics-get", function (msg) {
        console.log("IO: lyrics-get", msg);
        WNP.d.lyricsIndex = null;

        // If no lyrics or no synced lyrics, clear the lyrics and return.
        if (!msg || msg.status !== "ok" || !msg.payload?.syncedLyrics) {
            WNP.clearLyrics();
            return;
        }

        // Parse the synced lyrics and store them in the data object.
        // If nothing has been parsed, clear the lyrics and return.
        WNP.d.lyrics = WNP.parseSyncedLyrics(msg.payload.syncedLyrics);
        if (!WNP.d.lyrics.length) {
            WNP.clearLyrics();
            return;
        }

        // Show lyrics container and update the lyrics progress to set the correct line according to the current RelTime and timestamp difference.
        WNP.r.mediaLyrics.classList.add("is-visible");
        WNP.updateLyricsProgress(null, WNP.d.lyricsLastTimeStampDiffMs, "on lyrics-get");
    });

    // On lyrics cache stats
    socket.on("lyrics-cache-stats", function (msg) {
        // console.log("IO: lyrics-cache-stats", msg);
        WNP.r.lyricsCacheSize.value = (msg && msg.count) ? `${msg.count} items cached` : "no items cached";
    });

    // On weather
    socket.on("weather", function (msg) {
        WNP.d.weather = msg || null;
        WNP.renderWeather();
        if (WNP.r.weatherStatus && msg) {
            WNP.r.weatherStatus.innerText = msg.error ? ("Weather: " + msg.error) : ("Weather for " + msg.name + ", updated " + new Date(msg.updated).toLocaleTimeString());
        }
    });

    // On presence (app-blank mode): blank the screen when the room is empty. The
    // clock tick() also ORs this flag in, so it survives the 1s refresh. (fork)
    socket.on("presence", function (msg) {
        WNP.d.presenceBlank = !(msg && msg.occupied);
        document.body.classList.toggle("wnp-blank", WNP.d.presenceBlank);
    });

    // On device set
    socket.on("device-set", function (msg) {
        // Device switch? Fetch settings and device info again.
        socket.emit("server-settings");
        socket.emit("devices-get");
    });

    // On device refresh
    socket.on("devices-refresh", function (msg) {
        WNP.r.selDeviceChoices.innerHTML = "<option disabled=\"disabled\">Waiting for devices...</em></li>";
        if (WNP.r.oDeviceList) WNP.r.oDeviceList.innerHTML = "<li><span class=\"dropdown-header\">Waiting for devices...</span></li>";
    });

    // On device action (i.e. for play, pause, next, previous)
    socket.on("device-action", function (msg, param) {
        // Actions do not return a message.
        // so we don't need to do anything here.
        // Maybe later we can use this to show a notification or similar.
        console.log("WNP", "Action:", msg);
    });

    // On device API response
    socket.on("device-api", function (msg, param) {
        // console.log("IO: device-api", msg, param);
        switch (msg) {
            case "getPresetInfo":
                // Preset info response
                if (!param || param.preset_num < 1) {
                    // No presets
                    WNP.r.oPresetList.innerHTML = "<li><span class=\"dropdown-header\">No presets found!</span></li>";
                    return false;
                }
                else {
                    // Presets found
                    WNP.r.oPresetList.innerHTML = ""; // Clear existing list
                    var sCurrentTitle = WNP.r.mediaTitle.textContent; // textContent: title may be hidden in clear-logo mode
                    var sCurrentSubtitle = WNP.r.mediaSubTitle.innerText;
                    param.preset_list.forEach((preset) => {
                        var ddItem = document.createElement("li");
                        var ddItemA = document.createElement("a");
                        ddItemA.className = "dropdown-item";
                        ddItemA.href = "javascript:WNP.setPresetByNumber(" + preset.number + ");";
                        ddItemA.innerHTML = "<img src=\"" + WNP.checkAlbumArtURI(preset.picurl, Date.now()) + "\"/> " + preset.name;
                        if (sCurrentTitle === preset.name || sCurrentSubtitle === preset.name) {
                            ddItemA.classList.add("active");
                            ddItemA.setAttribute("aria-current", "true");
                        }
                        ddItem.appendChild(ddItemA);
                        WNP.r.oPresetList.appendChild(ddItem);
                    })
                }
                break;
            case msg.startsWith("MCUKeyShortClick:") ? msg : false:
                // Preset set response, no further action needed
                break;
            case "getPlayerStatus":
                // Player status response
                // Called when getting volume
                if (param && param.vol !== undefined) {
                    WNP.r.devVol.innerText = param.vol;
                }
                break;
            case msg.startsWith("setPlayerCmd:vol:") ? msg : false:
                // Volume set response
                socket.emit("device-api", "getPlayerStatus"); // Refresh volume UI
                break;
            default:
                // No action
                break;
        }
    });

    // On server reboot
    socket.on("server-reboot", function (msg) {
        // Possibly show a notification that reboot is in progress
        WNP.showAlert("Reboot: " + msg, "warning");
        console.log("WNP", "Server reboot:", msg);
    });

    // On server update
    socket.on("server-update", function (msg) {
        // Possibly show a notification that update is in progress
        console.log("WNP", "Server update:", msg);
        switch (msg.status) {
            case "updating":
                WNP.showAlert("Updating...", "warning");
                break;
            case "ok":
                WNP.showAlert("Update successful! Please reboot server.", "success");
                break;
            case "error":
                WNP.showAlert("Update failed: " + (msg.npm.cmd || msg.git || "Unknown error"), "danger", 10000);
                break;
            default:
                WNP.showAlert("Update status: " + msg.status, "info");
        }
    });

    // On server shutdown
    socket.on("server-shutdown", function (msg) {
        // Possibly show a notification that shutdown is in progress
        WNP.showAlert("Shutdown: " + msg, "warning");
        console.log("WNP", "Server shutdown:", msg);
    });

};

// =======================================================
// Helper functions

/**
 * Set device according to the chosen one through the Device dropup.
 * @param {string} deviceLocation - The location of the device to set.
 * @return {undefined}
  */
WNP.setDeviceByLocation = function (deviceLocation) {
    if (deviceLocation) {
        socket.emit("device-set", deviceLocation);
    }
    return false;
};

/**
 * Set the preset on the device.
 * @param {integer} presetNumber - The number of the preset to set.
 * @return {undefined}
 */
WNP.setPresetByNumber = function (presetNumber) {
    if (presetNumber && !isNaN(presetNumber) && presetNumber > 0) {
        socket.emit("device-api", "MCUKeyShortClick:" + presetNumber);
    }
    return false;
};

/**
 * Get player progress helper.
 * @param {string} relTime - Time elapsed while playing, format 00:00:00
 * @param {string} trackDuration - Total play time, format 00:00:00
 * @param {integer} timeStampDiff - Possible play time offset in seconds
 * @param {string} currentTransportState - The current transport state "PLAYING" or otherwise
 * @returns {object} An object with corrected played, left, total and percentage played
 */
WNP.getPlayerProgress = function (relTime, trackDuration, timeStampDiff, currentTransportState) {
    var relTimeSec = this.convertToSeconds(relTime) + timeStampDiff;
    var trackDurationSec = this.convertToSeconds(trackDuration);
    if (trackDurationSec > 0 && relTimeSec < trackDurationSec) { // Only calculate percentage if we have a valid track duration and the relTime is within the track duration
        var percentPlayed = ((relTimeSec / trackDurationSec) * 100).toFixed(1);
        return {
            played: WNP.convertToMinutes(relTimeSec),
            left: WNP.convertToMinutes(trackDurationSec - relTimeSec),
            total: WNP.convertToMinutes(trackDurationSec),
            percent: percentPlayed
        };
    }
    else if (trackDurationSec == 0 && currentTransportState == "PLAYING") { // For live streams or unknown duration, show "Live" when playing and "Paused" when paused/stopped
        return {
            played: "Live",
            left: "",
            total: "",
            percent: 100
        };
    }
    else { // Default fallback for paused/stopped state or when relTime exceeds track duration
        return {
            played: "Paused",
            left: "",
            total: "",
            percent: 0
        };
    };
};

/**
 * Render the progress bar from the last state anchor, extrapolating the played
 * position from elapsed wall-clock time while playing. Called by the state handler
 * and by a local ticker so the bar is fluent between polls (no extra API calls). (fork)
 */
WNP.renderProgress = function () {
    var a = this.d.progAnchor;
    if (!a || !this.r.progressPercent) { return; }
    var pos = a.baseSec + (a.playing ? (Date.now() - a.atMs) / 1000 : 0);
    var dur = a.durationSec, played, left, percent;
    if (dur > 0) {
        pos = Math.max(0, Math.min(pos, dur));
        played = this.convertToMinutes(pos);
        left = "-" + this.convertToMinutes(dur - pos);
        percent = ((pos / dur) * 100).toFixed(1);
    } else if (dur === 0 && a.playing) {
        played = "Live"; left = ""; percent = 100;
    } else {
        played = "Paused"; left = ""; percent = 0;
    }
    this.r.progressPlayed.children[0].innerText = played;
    this.r.progressLeft.children[0].innerText = left;
    this.r.progressPercent.setAttribute("aria-valuenow", percent);
    this.r.progressPercent.children[0].setAttribute("style", "width:" + percent + "%");
};

/** Crossfade the backdrop-hero art to a new image (two stacked layers). (fork) */
WNP.setHeroImage = function (url) {
    var a = this.r.wnpHeroImg, b = this.r.wnpHeroImgB;
    if (!a || !b) { if (a) { a.src = url; } return; }
    var active = this.d.heroActiveLayer === "b" ? b : a;
    var incoming = (active === a) ? b : a;
    var self = this;
    if (incoming.getAttribute("src") === url) { return; } // already showing this art
    incoming.onload = function () {
        incoming.classList.add("show");
        active.classList.remove("show");
        self.d.heroActiveLayer = (incoming === a) ? "a" : "b";
        self.applyHeroContrast(incoming); // keep the clock legible over this backdrop (fork)
    };
    incoming.src = url;
};

/** WCAG relative luminance for an sRGB colour (0-255 channels). */
WNP.relLuminance = function (r, g, b) {
    var f = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/**
 * Clock-on-backdrop legibility: sample the backdrop's average colour and, if its contrast with
 * the clock colour is below WCAG 3:1, darken the backdrop (a flat black scrim, --hero-scrim)
 * just enough to reach 3:1. Runs when a backdrop image finishes loading. The hero art is served
 * same-origin via /proxy-art, so the canvas read isn't tainted; any failure just skips. (fork)
 */
WNP.applyHeroContrast = function (img) {
    var hero = this.r.wnpHero;
    if (!hero) { return; }
    // Only the "clock on backdrop" layout needs this; other modes clear any scrim.
    if (!document.body.classList.contains("wnp-art-clock") || !this.r.clockTime) {
        hero.style.removeProperty("--hero-scrim");
        return;
    }
    try {
        var w = 32, h = 32;
        var cv = this.d.heroCanvas || (this.d.heroCanvas = document.createElement("canvas"));
        cv.width = w; cv.height = h;
        var ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        var data = ctx.getImageData(0, 0, w, h).data;
        var r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        r /= n; g /= n; b /= n;
        var Lbg = this.relLuminance(r, g, b);
        // Clock foreground colour as actually rendered (theme fg / lit-segment colour).
        var m = (getComputedStyle(this.r.clockTime).color.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
        var Lfg = this.relLuminance(m[0], m[1], m[2]);
        var contrastAt = function (alpha) {
            var L = WNP.relLuminance(r * (1 - alpha), g * (1 - alpha), b * (1 - alpha));
            var hi = Math.max(Lfg, L), lo = Math.min(Lfg, L);
            return (hi + 0.05) / (lo + 0.05);
        };
        var alpha = 0;
        if (contrastAt(0) < 3) {
            if (Lfg > Lbg) { // darkening the backdrop only helps when the clock is the lighter one
                for (var a = 0.05; a <= 0.9; a += 0.05) { alpha = a; if (contrastAt(a) >= 3) { break; } }
            } else {
                alpha = 0.9; // clock darker than backdrop (rare for these themes): darken as far as we can
            }
        }
        hero.style.setProperty("--hero-scrim", alpha.toFixed(2));
    } catch (e) {
        hero.style.removeProperty("--hero-scrim"); // tainted canvas / no context: skip
    }
};

/** Restart the fade/slide-in "enter" animation on an element (used on track change). (fork) */
WNP.playEnter = function (el) {
    if (!el) { return; }
    el.classList.remove("wnp-enter");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("wnp-enter");
};

/** Tick the progress bar locally so it moves smoothly between polls. */
WNP.startProgressTicker = function () {
    var self = this;
    if (this.d.progressTimer) { clearInterval(this.d.progressTimer); }
    this.d.progressTimer = setInterval(function () {
        if (self.d.progAnchor && self.d.progAnchor.playing) { self.renderProgress(); }
    }, 250);
};

/**
 * Convert time format '00:00:00' to total number of seconds.
 * @param {string} sDuration - Time, format 00:00:00.
 * @returns {integer} The number of seconds that the string represents.
 */
WNP.convertToSeconds = function (sDuration) {
    const timeSections = sDuration.split(":");
    let totalSeconds = 0;
    for (let i = 0; i < timeSections.length; i++) {
        var nFactor = timeSections.length - 1 - i; // Count backwards
        var nMultiplier = Math.pow(60, nFactor); // 60^n
        totalSeconds += nMultiplier * parseInt(timeSections[i]); // Calculate the seconds
    }
    return totalSeconds
};

/**
 * Convert number of seconds to '00:00' string format. 
 * Sorry for those hour+ long songs...
 * @param {integer} seconds - Number of seconds total.
 * @returns {string} The string representation of seconds in minutes, format 00:00.
 */
WNP.convertToMinutes = function (seconds) {
    var tempDate = new Date(0);
    tempDate.setSeconds(seconds);
    var result = tempDate.toISOString().substring(14, 19);
    return result;
};

/**
 * Parse synced lyrics (LRC format) into timestamps.
 * @param {string} syncedLyrics - LRC formatted lyrics string.
 * @returns {array} Array of lyric lines with time in ms.
 */
WNP.parseSyncedLyrics = function (syncedLyrics) {
    // console.log("WNP", "Parsing synced lyrics...");
    if (!syncedLyrics) return [];

    const lines = syncedLyrics.split(/\r?\n/);
    const parsed = [];
    let globalOffsetMs = 0;

    // Regex for timestamps: [hh:mm:ss.xxx] or [mm:ss.xxx]
    const timeRegex = /\[(?:(\d+):)?(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
    // Regex for the offset tag: [offset:500] or [offset:-200]
    const offsetRegex = /\[offset:\s*(-?\d+)\s*\]/i;

    lines.forEach((line) => {

        // Check for global offset tag first
        const offsetMatch = line.match(offsetRegex);
        if (offsetMatch) {
            globalOffsetMs = parseInt(offsetMatch[1], 10);
            return; // Skip further processing of this line
        }

        // Remove all time tags to extract the text
        const text = line.replace(/\[.*?\]/g, "").trim();
        // if (!text) return;

        // Extract all time tags and convert to milliseconds
        let match;
        timeRegex.lastIndex = 0; // Reset regex for exec()
        while ((match = timeRegex.exec(line)) !== null) {
            const hrs = parseInt(match[1] || 0, 10);
            const min = parseInt(match[2], 10);
            const sec = parseInt(match[3], 10);
            const msPart = match[4].padEnd(3, "0");
            const millis = parseInt(msPart, 10);

            // Calculate total time in milliseconds and apply global offset
            let totalMs = (hrs * 3600000) + (min * 60000) + (sec * 1000) + millis;
            totalMs += globalOffsetMs;

            // Push the parsed line with time and text, ensuring time is not negative
            parsed.push({
                timestamp: match[0], // Original timestamp string (for reference, not used in logic)
                timeMs: Math.max(0, totalMs), // Ensure time is not negative after applying offset
                text: text // Store the text without time tags
            });
        }

    });

    // Sort parsed lines by time in ascending order (important for findLastIndex to work correctly)
    return parsed.sort((a, b) => a.timeMs - b.timeMs);

};

/**
 * Clear lyrics UI.
 * @returns {undefined}
 */
WNP.clearLyrics = function () {
    // console.log("WNP", "Clearing lyrics...");
    // Remove visibility and pending state classes, if set
    if (WNP.r.mediaLyrics) {
        WNP.r.mediaLyrics.classList.remove("is-visible", "is-pending");
    }

    // Clear lyric lines text content
    if (WNP.r.lyricPrev) WNP.r.lyricPrev.textContent = "";
    if (WNP.r.lyricCurrent) WNP.r.lyricCurrent.textContent = "";
    if (WNP.r.lyricNext) WNP.r.lyricNext.textContent = "";
    if (WNP.r.lyricAfter) WNP.r.lyricAfter.textContent = "";

    // Reset data states
    WNP.d.lyrics = [];
    WNP.d.lyricsIndex = null;
};

/**
 * Toggle pending lyrics state.
 * @param {boolean} isPending - Whether lyrics are pending.
 * @returns {undefined}
 */
WNP.setLyricsPending = function (isPending) {
    // console.log("WNP", "Lyrics pending:", isPending);
    if (!WNP.r.mediaLyrics) return;
    WNP.r.mediaLyrics.classList.toggle("is-pending", isPending);
};

/**
 * Update lyrics display based on player progress.
 * Normally called on state updates to sync lyrics with the current play time.
 * Also called when new lyrics are loaded to set the initial display.
 * @param {string|null} relTime - Time elapsed while playing, format 00:00:00.
 * @param {integer} stateTimeStamp - The timestamp of the state update.
 * @param {integer} metadataTimeStamp - The timestamp of the metadata update.
 * @param {string} source - The source of the update (e.g., "state", "metadata", "lyrics-get") for logging purposes.
 * @returns {undefined}
 */
WNP.updateLyricsProgress = function (relTime, timeStampDiffMs, source) {
    // console.log("WNP", "Updating lyrics progress...", { relTime, timeStampDiffMs, lyricsLastRelTime: WNP.d.lyricsLastRelTime, source });
    // Are any lyrics available...?
    if (!WNP.d.lyrics || WNP.d.lyrics.length === 0) {
        return;
    }

    // Calculate the current play time in milliseconds, using relTime
    var currentRelTime = relTime || WNP.d.lyricsLastRelTime || "00:00:00";
    var [hours, minutes, seconds] = currentRelTime.split(':').map(Number);
    var relTimeMs = ((hours * 3600) + (minutes * 60) + seconds) * 1000;

    // Calculate the current play time in milliseconds by adding the time difference to the relTime milliseconds
    var currentMs = relTimeMs + timeStampDiffMs;
    var offsetMs = WNP.getLyricsOffsetMs();
    if (offsetMs !== 0) {
        currentMs += offsetMs;
    }

    // Find the current lyric line index based on the current play time in milliseconds.
    // Current play time is at or past the lyric line time, but before the next lyric line time.
    var currentLyricIdx = WNP.d.lyrics.findLastIndex(item => item.timeMs <= currentMs);
    // console.log("WNP", "Current play time (ms):", currentMs, "Current lyric index:", currentLyricIdx, source);

    // If no lyric line is found for the current play time, set pending state and show the first line as next lyric.
    if (currentLyricIdx === -1) {
        WNP.setLyricsPending(true);
        WNP.d.lyricsIndex = -1;
        WNP.setLyrics(
            "",
            WNP.d.lyrics[0] ? WNP.d.lyrics[0].text : "",
            WNP.d.lyrics[1] ? WNP.d.lyrics[1].text : "",
            WNP.d.lyrics[2] ? WNP.d.lyrics[2].text : ""
        );
        return;
    }

    // Check for the 'outro' (after the last lyric)
    const isLastLyric = currentLyricIdx === WNP.d.lyrics.length - 1;
    if (isLastLyric) {
        const lastLyricTime = WNP.d.lyrics[currentLyricIdx].timeMs;
        if (currentMs > lastLyricTime + 2000) { // If we are 2 seconds past the last lyric, consider it as 'outro' time and set pending state without changing the lyrics (or optionally clear the next lyrics).
            if (WNP.d.lyricsIndex !== 99999) {
                console.log("WNP", "Entering outro state (2s past last lyric)");
                WNP.setLyricsPending(true);
                WNP.d.lyricsIndex = 99999; // Mark as outro
            }
            return;
        }
    }

    // If the current lyric line index is the same as the last one, no need to update the display.
    if (currentLyricIdx === WNP.d.lyricsIndex) {
        return;
    }

    // Clear pending state and update the lyrics display with the current, previous and next lines.
    WNP.setLyricsPending(false);
    WNP.d.lyricsIndex = currentLyricIdx; // Remember the current lyric line index
    var prevLine = WNP.d.lyrics[currentLyricIdx - 1] ? WNP.d.lyrics[currentLyricIdx - 1].text : "";
    var currentLine = WNP.d.lyrics[currentLyricIdx] ? WNP.d.lyrics[currentLyricIdx].text : "";
    var nextLine = WNP.d.lyrics[currentLyricIdx + 1] ? WNP.d.lyrics[currentLyricIdx + 1].text : "";
    var afterLine = WNP.d.lyrics[currentLyricIdx + 2] ? WNP.d.lyrics[currentLyricIdx + 2].text : "";
    WNP.setLyrics(prevLine, currentLine, nextLine, afterLine);

};

/**
 * Update the lyric lines in the UI.
 * @param {string} prevLine - Previous line.
 * @param {string} currentLine - Current line.
 * @param {string} nextLine - Next line.
 * @returns {undefined}
 */
WNP.setLyrics = function (prevLine, currentLine, nextLine, afterLine) {
    if (!WNP.r.lyricPrev || !WNP.r.lyricCurrent || !WNP.r.lyricNext || !WNP.r.lyricAfter) {
        return;
    }
    WNP.r.lyricPrev.textContent = prevLine;
    WNP.r.lyricCurrent.textContent = currentLine;
    WNP.r.lyricNext.textContent = nextLine;
    WNP.r.lyricAfter.textContent = afterLine;
};

/**
 * Get lyrics offset (in ms) from server settings.
 * @returns {number}
 */
WNP.getLyricsOffsetMs = function () {
    if (WNP.d.serverSettings && WNP.d.serverSettings.features && WNP.d.serverSettings.features.lyrics && typeof WNP.d.serverSettings.features.lyrics.offsetMs === "number") {
        return WNP.d.serverSettings.features.lyrics.offsetMs;
    }
    return 0;
};

/**
 * Check if the album art is a valid URI. Returns the URI if valid, otherwise a random URI.
 * Error handling is handled by the onerror event on the image itself.
 * @param {string} sAlbumArtUri - The URI of the album art.
 * @param {integer} nTimestamp - The time in milliseconds, used as cache buster.
 * @returns {string} The URI of the album art.
 */
WNP.checkAlbumArtURI = function (sAlbumArtUri, nTimestamp) {
    // If the URI starts with https, the self signed certificate may not trusted by the browser.
    // Hence we always try and load the image through a reverse proxy, ignoring the certificate.
    if (sAlbumArtUri && sAlbumArtUri.startsWith("https")) {
        // Proxy self-signed https art through our own origin (relative URL → correct
        // host/port/scheme whether direct or behind an HTTPS reverse proxy). (fork)
        return "/proxy-art?url=" + encodeURIComponent(sAlbumArtUri) + "&ts=" + nTimestamp;
    } else if (sAlbumArtUri && sAlbumArtUri.startsWith("http")) {
        return sAlbumArtUri;
    } else {
        // Looks like an invalid/un_known album art, use the fallback.
        return WNP.s.rndAlbumArtUri;
    }
};

/**
 * Sets the album art. Both on the foreground and background.
 * @param {integer} imgUri - The URI of the album art.
 * @returns {undefined}
 */
WNP.setAlbumArt = function (imgUri) {
    console.log("WNP", "Set Album Art", imgUri);
    this.r.albumArt.src = imgUri;
    this.r.bgAlbumArtBlur.style.backgroundImage = "url('" + imgUri + "')";
};

/**
 * Come up with a random album art URI (locally from the img folder).
 * @param {string} prefix - The prefix for the album art URI, i.e. 'fake-album-'
 * @returns {string} An URI for album art
 */
WNP.rndAlbumArt = function (prefix) {
    return "./img/" + prefix + this.rndNumber(1, 16) + ".jpg";
};

/**
 * Get a random number between min and max, including min and max.
 * @param {integer} min - Minimum number to pick, keep it lower than max.
 * @param {integer} max - Maximum number to pick.
 * @returns {integer} The random number
 */
WNP.rndNumber = function (min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

// =======================================================
// Clock overlay, themes, weather, mini clock (Settings > Display)

/**
 * Clock themes. Adding a theme = one entry here + a `#wnpClock[data-theme="<id>"]` block in wnp.scss.
 * kind: "digital" | "analog"; font: Google Fonts family (loaded on demand) or "" for system;
 * colors: preset id from WNP.clockColors; dial: whether brand/sub text is shown (analog dial or under digital time).
 */
WNP.clockThemes = {
    "digital-minimal": { name: "Digital – minimal", kind: "digital", font: "Manrope", colors: "ink", dial: false },
    "digital-mono": { name: "Digital – terminal", kind: "digital", font: "JetBrains Mono", colors: "phosphor", dial: false },
    "digital-serif": { name: "Digital – editorial", kind: "digital", font: "Playfair Display", colors: "paper", dial: true },
    "digital-flip": { name: "Digital – flap board", kind: "digital", font: "Bebas Neue", colors: "flap", dial: false },
    "analog-classic": { name: "Analog – classic", kind: "analog", font: "Cormorant Garamond", colors: "ink", dial: true, numerals: "arabic" },
    "analog-bauhaus": { name: "Analog – bauhaus", kind: "analog", font: "DM Sans", colors: "bauhaus", dial: true, numerals: "none" },
    "analog-night": { name: "Analog – night dial", kind: "analog", font: "Manrope", colors: "lume", dial: true, numerals: "quarters" },
    "analog-alarm": { name: "Analog – white alarm clock", kind: "analog", font: "DM Sans", colors: "alarm", dial: true, numerals: "arabic", brandY: 58, subY: 68 },
    "segment-bedside": { name: "Seven-segment – bedside", kind: "segment", font: "", colors: "vfd", dial: false, ghost: 0.08 },
    "segment-bedside-wx": { name: "Seven-segment – bedside (weather)", kind: "segment", font: "", colors: "vfd", dial: false, ghost: 0.08 },
    "segment-alarm": { name: "Seven-segment – alarm clock", kind: "segment", font: "", colors: "lcd", dial: false, ghost: 0.12, ampm: true }
};

/** Colour roles on the clock. Every preset defines all of them; a theme picks a preset as its defaults. */
WNP.colorRoles = [
    { id: "bg", name: "Background", kinds: ["digital", "analog", "segment"] },
    { id: "bg2", name: "Background end (gradient)", kinds: ["digital", "analog", "segment"] },
    { id: "face", name: "Dial face", kinds: ["analog"] },
    { id: "fg", name: "Digits / numerals / ticks", kinds: ["digital", "analog", "segment"] },
    { id: "fg2", name: "Secondary text", kinds: ["digital", "analog", "segment"] },
    { id: "hand", name: "Hour and minute hands", kinds: ["analog"] },
    { id: "inset", name: "Hand inset", kinds: ["analog"] },
    { id: "accent", name: "Second hand / accent", kinds: ["digital", "analog", "segment"] }
];

/** Colour presets: bg, bg2 (gradient end), face (dial), fg (digits/numerals), fg2 (secondary), hand, inset, accent. */
WNP.clockColors = {
    "ink": { name: "Warm white on black", bg: "#000000", bg2: "#1a1714", face: "#000000", fg: "#ede8df", fg2: "#8a857c", hand: "#ede8df", inset: "#000000", accent: "#c8a26b" },
    "paper": { name: "Cream on black", bg: "#000000", bg2: "#1d1712", face: "#000000", fg: "#f2ead8", fg2: "#9a927e", hand: "#f2ead8", inset: "#000000", accent: "#b45f3c" },
    "phosphor": { name: "Green phosphor", bg: "#000000", bg2: "#06140a", face: "#000000", fg: "#7dff9b", fg2: "#2f8a45", hand: "#7dff9b", inset: "#000000", accent: "#c6ffd1" },
    "amber": { name: "Amber", bg: "#000000", bg2: "#1a1000", face: "#000000", fg: "#ffb547", fg2: "#8c5a1a", hand: "#ffb547", inset: "#000000", accent: "#fff1d6" },
    "flap": { name: "Flap board", bg: "#000000", bg2: "#141414", face: "#000000", fg: "#f4f4f4", fg2: "#6c6c6c", hand: "#f4f4f4", inset: "#000000", accent: "#f4f4f4" },
    "bauhaus": { name: "Bauhaus", bg: "#000000", bg2: "#171717", face: "#000000", fg: "#f1efe6", fg2: "#5b5b5b", hand: "#f1efe6", inset: "#000000", accent: "#d9342b" },
    "lume": { name: "Lume", bg: "#000000", bg2: "#06110b", face: "#000000", fg: "#cfe6d8", fg2: "#3b5446", hand: "#cfe6d8", inset: "#000000", accent: "#9df0c1" },
    "ice": { name: "Ice blue", bg: "#000000", bg2: "#0a1220", face: "#000000", fg: "#dbe9ff", fg2: "#5f7594", hand: "#dbe9ff", inset: "#000000", accent: "#8ec5ff" },
    "alarm": { name: "White alarm clock", bg: "#000000", bg2: "#1a1a1a", face: "#ffffff", fg: "#161616", fg2: "#6a6a6a", hand: "#161616", inset: "#ffffff", accent: "#f2b705" },
    "vfd": { name: "Cool white VFD", bg: "#000000", bg2: "#0a1018", face: "#000000", fg: "#dcefff", fg2: "#4e6478", hand: "#dcefff", inset: "#000000", accent: "#dcefff" },
    "lcd": { name: "Lavender LCD", bg: "#000000", bg2: "#0e0f1c", face: "#000000", fg: "#b9c4ee", fg2: "#5a628a", hand: "#b9c4ee", inset: "#000000", accent: "#3ad35a" },
    "red-led": { name: "Red LED", bg: "#000000", bg2: "#180605", face: "#000000", fg: "#ff3b2f", fg2: "#5a1a16", hand: "#ff3b2f", inset: "#000000", accent: "#ff3b2f" },
    "daylight": { name: "Daylight (light background)", bg: "#f3efe6", bg2: "#e2dccf", face: "#ffffff", fg: "#1c1a17", fg2: "#6e685f", hand: "#1c1a17", inset: "#ffffff", accent: "#c8442e" }
};

// ---- colour maths (hex <-> hsl) for schemes and night dimming
WNP.hexToHsl = function (hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) { return null; }
    var n = parseInt(m[1], 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2, d = max - min;
    if (d) {
        s = l > .5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) { h = (g - b) / d + (g < b ? 6 : 0); }
        else if (max === g) { h = (b - r) / d + 2; }
        else { h = (r - g) / d + 4; }
        h *= 60;
    }
    return { h: h, s: s, l: l };
};
WNP.hslToHex = function (h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    var to = function (v) { return Math.round((v + m) * 255).toString(16).padStart(2, "0"); };
    return "#" + to(r) + to(g) + to(b);
};
/** Multiply RGB channels (factor 0..1): hue-preserving darkening. Used for night dimming and secondary text. */
WNP.dimHex = function (hex, factor) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m || factor >= 1) { return hex; }
    var n = parseInt(m[1], 16);
    var to = function (v) { return Math.round(Math.max(0, Math.min(255, v * factor))).toString(16).padStart(2, "0"); };
    return "#" + to((n >> 16) & 255) + to((n >> 8) & 255) + to(n & 255);
};
/** Derive fg / fg2 / accent from a base colour and a scheme. */
WNP.schemeColors = function (base, scheme) {
    var c = this.hexToHsl(base) || { h: 40, s: .2, l: .9 };
    var sat = Math.min(Math.max(c.s, .35), .75); // derived hues: neither muddy nor neon
    var fg = base;
    var fg2 = this.dimHex(base, .55);
    var accent;
    switch (scheme) {
        case "complementary": accent = this.hslToHex(c.h + 180, sat, .62); break;
        case "analogous": fg2 = this.hslToHex(c.h - 30, sat * .6, .42); accent = this.hslToHex(c.h + 30, sat, .68); break;
        case "triadic": fg2 = this.hslToHex(c.h + 120, sat * .6, .42); accent = this.hslToHex(c.h + 240, sat, .66); break;
        default: accent = c.l > .8 ? this.hslToHex(c.h, Math.min(1, c.s + .2), .72) : this.hslToHex(c.h, c.s, Math.min(.95, c.l + .2)); // mono
    }
    return { fg: fg, fg2: fg2, accent: accent };
};

/** Fonts offered in the override dropdown (Google Fonts family names). */
WNP.clockFonts = ["Manrope", "Inter", "DM Sans", "JetBrains Mono", "Roboto Mono", "Bebas Neue", "Oswald", "Playfair Display", "Cormorant Garamond", "DM Serif Display", "Orbitron", "Fraunces"];

/** Populate the theme/font/colour selects in the settings modal. */
WNP.fillClockSelects = function () {
    if (!this.r.selClockTheme) { return; }
    var themeOpts = Object.keys(this.clockThemes).map(function (id) { return '<option value="' + id + '">' + WNP.clockThemes[id].name + '</option>'; }).join("");
    this.r.selClockTheme.innerHTML = themeOpts;
    this.r.selClockNightTheme.innerHTML = themeOpts;
    this.r.selClockFont.innerHTML = '<option value="">Theme default</option>' + this.clockFonts.map(function (f) { return '<option value="' + f + '">' + f + '</option>'; }).join("");
    this.r.selClockColors.innerHTML = Object.keys(this.clockColors).map(function (id) { return '<option value="' + id + '">' + WNP.clockColors[id].name + '</option>'; }).join("");
    this.r.colorRoles.innerHTML = this.colorRoles.map(function (r) {
        return '<div class="col-6 col-md-4"><label class="form-label small mb-0" for="role_' + r.id + '">' + r.name + '</label>'
            + '<div class="input-group input-group-sm"><input type="color" class="form-control form-control-color" id="role_' + r.id + '" data-role="' + r.id + '">'
            + '<button type="button" class="btn btn-outline-secondary" data-reset="' + r.id + '" title="Theme default">&times;</button></div></div>';
    }).join("");
    var self = this;
    this.r.colorRoles.querySelectorAll("input[type=color]").forEach(function (inp) {
        inp.addEventListener("input", function () { self.setRoleColor(this.dataset.role, this.value); });
    });
    this.r.colorRoles.querySelectorAll("button[data-reset]").forEach(function (btn) {
        btn.addEventListener("click", function () { self.setRoleColor(this.dataset.reset, null); });
    });
    this.r.btnApplyPreset.addEventListener("click", function () {
        var p = self.clockColors[self.r.selClockColors.value];
        if (!p) { return; }
        var custom = {};
        self.colorRoles.forEach(function (r) { custom[r.id] = p[r.id]; });
        self.setCustomColors(custom);
    });
    this.r.btnResetColors.addEventListener("click", function () { self.setCustomColors({}); });
    this.r.btnApplyScheme.addEventListener("click", function () {
        var derived = self.schemeColors(self.r.clockBaseColor.value, self.r.selClockScheme.value);
        var custom = { ...(self.clockCfg().colors && self.clockCfg().colors.custom || {}), ...derived, hand: derived.fg };
        self.setCustomColors(custom, { base: self.r.clockBaseColor.value, scheme: self.r.selClockScheme.value });
    });
    this.r.chkClockGradient.addEventListener("change", function () { self.emitClockSettings(); });
    this.r.clockNightDim.addEventListener("input", function () { self.r.clockNightDimValue.innerText = this.value; });
    this.r.clockNightDim.addEventListener("change", function () { self.emitClockSettings(); });
};

/** Set one role's custom colour (null = back to theme default) and save. */
WNP.setRoleColor = function (role, hex) {
    var custom = { ...((this.clockCfg().colors && this.clockCfg().colors.custom) || {}) };
    if (hex) { custom[role] = hex; } else { delete custom[role]; }
    this.setCustomColors(custom);
};

WNP.setCustomColors = function (custom, extra) {
    if (!this.d.serverSettings) { return; }
    this.d.serverSettings.features.clock.colors = { ...(this.clockCfg().colors || {}), ...(extra || {}), custom: custom };
    this.emitClockSettings();
};

/** Effective palette for a theme: preset defaults overlaid with the user's custom roles. */
WNP.effectiveColors = function (theme) {
    var preset = this.clockColors[theme.colors] || this.clockColors.ink;
    var custom = (this.clockCfg().colors && this.clockCfg().colors.custom) || {};
    var out = {};
    this.colorRoles.forEach(function (r) { out[r.id] = custom[r.id] || preset[r.id]; });
    return out;
};

/** Send the complete clock settings block to the server. */
WNP.emitClockSettings = function () {
    socket.emit("features-settings", {
        features: {
            clock: {
                enabled: this.r.chkClockEnabled.checked,
                onInput: this.r.chkClockOnInput.checked,
                drift: this.r.chkClockDrift.checked,
                afterSeconds: Math.max(0, parseInt(this.r.clockAfterSeconds.value, 10) || 0),
                blankAfterMinutes: Math.max(0, parseInt(this.r.clockBlankAfterMinutes.value, 10) || 0),
                theme: this.r.selClockTheme.value,
                nightTheme: this.r.selClockNightTheme.value,
                autoDayNight: this.r.chkClockAutoDayNight.checked,
                segmentSlant: this.r.chkSegSlant ? this.r.chkSegSlant.checked : true,
                dialText: { brand: this.r.clockDialBrand.value.trim(), sub: this.r.clockDialSub.value.trim() },
                override: { enabled: this.r.chkClockOverride.checked, font: this.r.selClockFont.value },
                colors: {
                    ...((this.clockCfg().colors) || {}),
                    gradient: this.r.chkClockGradient.checked,
                    nightDim: parseInt(this.r.clockNightDim.value, 10) || 100,
                    custom: (this.clockCfg().colors && this.clockCfg().colors.custom) || {}
                },
                overlay: { enabled: this.r.chkOverlayEnabled.checked, position: this.r.selOverlayPosition.value, size: this.r.selOverlaySize.value },
                locale: this.r.selClockLocale.value,
                swipe: { enabled: this.r.chkSwipeEnabled.checked, gesture: this.r.selSwipeGesture.value, transition: this.r.selSwipeTransition.value, returnAfterSeconds: Math.max(0, parseInt(this.r.swipeReturnSeconds.value, 10) || 0) }
            }
        }
    });
};

WNP.clockLocale = function () {
    return this.clockCfg().locale || undefined;
};

WNP.clockCfg = function () {
    if (this.d.serverSettings && this.d.serverSettings.features && this.d.serverSettings.features.clock) {
        return this.d.serverSettings.features.clock;
    }
    return this.d.cachedClockCfg || {}; // before server-settings arrives, use the cached config
};

/** Load a Google Font once. Falls back silently to system fonts when offline. */
WNP.loadFont = function (family) {
    if (!family || this.d.loadedFonts[family]) { return; }
    this.d.loadedFonts[family] = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family).replace(/%20/g, "+") + ":wght@300;400;500;700&display=swap";
    document.head.appendChild(link);
};

/** Night = between sunset and sunrise from the weather data, else 19:00–07:00. */
WNP.isNight = function () {
    var now = new Date();
    var w = this.d.weather;
    if (w && w.sunrise && w.sunset) {
        var sr = new Date(w.sunrise), ss = new Date(w.sunset);
        var t = now.getHours() * 60 + now.getMinutes();
        var a = sr.getHours() * 60 + sr.getMinutes(), b = ss.getHours() * 60 + ss.getMinutes();
        return t < a || t >= b;
    }
    return now.getHours() >= 19 || now.getHours() < 7;
};

/** Apply theme + overrides to the clock overlay (idempotent; cheap to call every second). */
WNP.applyClockTheme = function () {
    if (!this.r.wnpClock) { return; }
    var cfg = this.clockCfg();
    var id = cfg.theme || "digital-minimal";
    if (cfg.autoDayNight && cfg.nightTheme && this.isNight()) { id = cfg.nightTheme; }
    var theme = this.clockThemes[id] || this.clockThemes["digital-minimal"];
    var ov = cfg.override || {};
    var font = (ov.enabled && ov.font) ? ov.font : theme.font;
    var colors = this.effectiveColors(theme);
    var colCfg = cfg.colors || {};
    var night = this.isNight();
    var dim = night && typeof colCfg.nightDim === "number" ? colCfg.nightDim / 100 : 1;
    if (dim < 1) {
        var dimmed = {};
        Object.keys(colors).forEach(function (k) { dimmed[k] = WNP.dimHex(colors[k], dim); });
        colors = dimmed;
    }
    var key = [id, font, JSON.stringify(colors), colCfg.gradient, cfg.dialText && cfg.dialText.brand, cfg.dialText && cfg.dialText.sub].join("|");
    if (key === this.d.appliedTheme) { return; }
    this.d.appliedTheme = key;

    if (font) { this.loadFont(font); }
    var el = this.r.wnpClock;
    el.setAttribute("data-theme", id);
    el.setAttribute("data-kind", theme.kind);
    el.style.setProperty("--clock-font", font ? ('"' + font + '", system-ui, sans-serif') : "system-ui, sans-serif");
    el.style.setProperty("--clock-bg", colors.bg);
    el.style.setProperty("--clock-bg2", colors.bg2 || colors.bg);
    el.style.setProperty("--clock-fg", colors.fg);
    el.style.setProperty("--clock-fg2", colors.fg2);
    el.style.setProperty("--clock-accent", colors.accent);
    el.style.setProperty("--clock-face", colors.face || colors.bg);
    el.style.setProperty("--clock-hand", colors.hand || colors.fg);
    el.style.setProperty("--clock-inset", colors.inset || colors.face || colors.bg);
    el.classList.toggle("gradient", Boolean(colCfg.gradient));

    // Dial text (elements are guarded: the HTML minifier can drop empty SVG
    // nodes, and /tv omits them — a missing ref must never abort the tick)
    var brand = (cfg.dialText && cfg.dialText.brand) || "";
    var sub = (cfg.dialText && cfg.dialText.sub) || "";
    if (this.r.dialBrand) {
        this.r.dialBrand.textContent = theme.dial ? brand : "";
        this.r.dialBrand.setAttribute("y", theme.brandY || 62);
    }
    if (this.r.dialSub) {
        this.r.dialSub.textContent = theme.dial ? sub : "";
        this.r.dialSub.setAttribute("y", theme.subY || 140);
    }

    // Analog dial: ticks and numerals
    if (theme.kind === "analog" && this.r.dialTicks && this.r.dialNumbers) {
        var ticks = "", nums = "";
        for (var i = 0; i < 60; i++) {
            var major = i % 5 === 0;
            var a = i * 6 * Math.PI / 180;
            var r1 = major ? 86 : 91, r2 = 95;
            ticks += '<line class="' + (major ? "tickMajor" : "tickMinor") + '" x1="' + (100 + r1 * Math.sin(a)).toFixed(2) + '" y1="' + (100 - r1 * Math.cos(a)).toFixed(2) + '" x2="' + (100 + r2 * Math.sin(a)).toFixed(2) + '" y2="' + (100 - r2 * Math.cos(a)).toFixed(2) + '"/>';
        }
        var numerals = theme.numerals || "none";
        for (var h = 1; h <= 12; h++) {
            if (numerals === "none") { break; }
            if (numerals === "quarters" && h % 3 !== 0) { continue; }
            var ah = h * 30 * Math.PI / 180;
            nums += '<text class="dialNumber" x="' + (100 + 74 * Math.sin(ah)).toFixed(2) + '" y="' + (100 - 74 * Math.cos(ah) + 4).toFixed(2) + '" text-anchor="middle">' + h + '</text>';
        }
        this.r.dialTicks.innerHTML = ticks;
        this.r.dialNumbers.innerHTML = nums;
    }
};

/** WMO weather code -> Bootstrap icon class + short label. */
WNP.weatherIcon = function (code, isDay) {
    var c = Number(code);
    if (c === 0) { return [isDay === false ? "bi-moon-stars" : "bi-sun", "Clear"]; }
    if (c <= 2) { return [isDay === false ? "bi-cloud-moon" : "bi-cloud-sun", "Partly cloudy"]; }
    if (c === 3) { return ["bi-cloud", "Overcast"]; }
    if (c <= 48) { return ["bi-cloud-fog", "Fog"]; }
    if (c <= 57) { return ["bi-cloud-drizzle", "Drizzle"]; }
    if (c <= 67) { return ["bi-cloud-rain", "Rain"]; }
    if (c <= 77) { return ["bi-cloud-snow", "Snow"]; }
    if (c <= 82) { return ["bi-cloud-rain-heavy", "Showers"]; }
    if (c <= 86) { return ["bi-cloud-snow", "Snow showers"]; }
    return ["bi-cloud-lightning-rain", "Thunderstorm"];
};

/** Weather condition labels per supported clock language (en is the key itself). */
WNP.wxLabels = {
    "Clear": { nl: "Helder", de: "Klar", fr: "Dégagé" },
    "Partly cloudy": { nl: "Half bewolkt", de: "Teils bewölkt", fr: "Partiellement nuageux" },
    "Overcast": { nl: "Bewolkt", de: "Bedeckt", fr: "Couvert" },
    "Fog": { nl: "Mist", de: "Nebel", fr: "Brouillard" },
    "Drizzle": { nl: "Motregen", de: "Nieselregen", fr: "Bruine" },
    "Rain": { nl: "Regen", de: "Regen", fr: "Pluie" },
    "Snow": { nl: "Sneeuw", de: "Schnee", fr: "Neige" },
    "Showers": { nl: "Buien", de: "Schauer", fr: "Averses" },
    "Snow showers": { nl: "Sneeuwbuien", de: "Schneeschauer", fr: "Averses de neige" },
    "Thunderstorm": { nl: "Onweer", de: "Gewitter", fr: "Orage" }
};

/** Translate an English condition label to the configured clock language. */
WNP.wxLabel = function (label) {
    var lang = (this.clockLocale() || "en").split("-")[0];
    var t = this.wxLabels[label];
    return (t && t[lang]) || label;
};

/** Render temperature / forecast block on the clock. */
WNP.renderWeather = function () {
    if (!this.r.clockWeather) { return; }
    var cfg = (this.d.serverSettings && this.d.serverSettings.features && this.d.serverSettings.features.weather) || {};
    var w = this.d.weather;
    if ((!cfg.enabled && !cfg.forecast) || !w || w.error) { this.r.clockWeather.innerHTML = ""; return; }
    var html = "";
    if (cfg.enabled) {
        var ic = this.weatherIcon(w.code, w.isDay);
        var wxLabelHtml = (cfg.showLabel !== false) ? '<span class="wxLabel">' + this.wxLabel(ic[1]) + '</span>' : '';
        html += '<div class="wxNow"><i class="bi ' + ic[0] + '"></i><span class="wxTemp">' + w.temp + '°</span>' + wxLabelHtml + '</div>';
    }
    if (cfg.forecast && w.daily) {
        html += '<div class="wxDays">' + w.daily.map(function (d) {
            var di = WNP.weatherIcon(d.code, true);
            var day = new Date(d.date + "T12:00:00").toLocaleDateString(WNP.clockLocale(), { weekday: "short" });
            return '<div class="wxDay"><span class="wxDayName">' + day + '</span><i class="bi ' + di[0] + '"></i><span class="wxRange">' + d.tmax + '° <small>' + d.tmin + '°</small></span></div>';
        }).join("") + '</div>';
    }
    this.r.clockWeather.innerHTML = html;
};

// ---- Seven-segment display (DSEG font, bundled in client/src/fonts).
/**
 * Render a seven-segment time into #clockSeg using the DSEG7 Classic font.
 * A faint "ghost" layer (all segments lit) sits behind the time for themes that
 * ask for it; the slant is the italic DSEG face, toggled by features.clock.segmentSlant.
 * @param {string} main - e.g. "13:06"
 * @param {object} theme - theme entry (ghost, ampm)
 * @param {string} tag - small text before the digits (AM/PM) or ""
 */
WNP.renderSegments = function (main, theme, tag) {
    var el = this.r.clockSeg;
    if (!el) { return; }
    var slant = this.clockCfg().segmentSlant;
    el.classList.toggle("slant", slant !== false); // default slanted
    // Mirror the slant on the clock root so themes can italicise their seven-segment
    // weather readout in step with the time (see segment-bedside-wx). (fork)
    if (this.r.wnpClock) { this.r.wnpClock.classList.toggle("seg-slant", slant !== false); }
    var ghost = theme.ghost || 0;
    // Ghost = every glyph lit; digits -> 8, colon stays, spaces stay.
    var ghostText = main.replace(/[0-9]/g, "8");
    var html = "";
    if (ghost > 0) { html += '<span class="segGhost" style="opacity:' + ghost + '">' + ghostText + '</span>'; }
    if (tag) { html += '<span class="segTag">' + tag + '</span>'; }
    html += '<span class="segMain">' + main + '</span>';
    el.innerHTML = html;
};

// ---- Night shift (page-wide warm tint + dimming)
WNP.nightShiftCfg = function () {
    return (this.d.serverSettings && this.d.serverSettings.features && this.d.serverSettings.features.display && this.d.serverSettings.features.display.nightShift) || {};
};

/** Is the night-shift schedule active right now? */
WNP.nightShiftActive = function (cfg) {
    if (!cfg.enabled) { return false; }
    if (cfg.schedule === "always") { return true; }
    if (cfg.schedule === "custom") {
        var toMin = function (t) { var p = (t || "00:00").split(":"); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
        var now = new Date(), t = now.getHours() * 60 + now.getMinutes(), a = toMin(cfg.from), b = toMin(cfg.to);
        return a <= b ? (t >= a && t < b) : (t >= a || t < b); // crosses midnight when from > to
    }
    return this.isNight(); // "sun"
};

/** Compute the overlay colour: warm tint (multiply blend) scaled by brightness. */
WNP.nightShiftColor = function (warmth, brightness) {
    var w = Math.max(0, Math.min(100, warmth)) / 100, b = Math.max(.2, Math.min(1, brightness / 100));
    // 0 -> neutral white, 1 -> ~2400 K (255, 170, 100)
    var r = 255, g = Math.round(255 - w * 85), bl = Math.round(255 - w * 155);
    return "rgb(" + Math.round(r * b) + "," + Math.round(g * b) + "," + Math.round(bl * b) + ")";
};

WNP.applyNightShift = function (force) {
    if (!this.r.wnpNightShift) { return; }
    var cfg = this.nightShiftCfg();
    var on = force !== undefined ? force : this.nightShiftActive(cfg);
    var el = this.r.wnpNightShift;
    // Native form-control popups (e.g. <select> option lists) are painted by the OS above the
    // page, so the multiply overlay can't tint them; switch the document to a dark colour
    // scheme during night shift so those popups aren't jarringly bright white. (fork)
    document.documentElement.classList.toggle("wnp-nightshift", on);
    if (!on) { el.style.opacity = "0"; return; }
    el.style.background = this.nightShiftColor(cfg.warmth || 0, (typeof cfg.brightness === "number") ? cfg.brightness : 100);
    el.style.opacity = "1";
};

/** Live preview while dragging the sliders, before the change event saves them. */
WNP.previewNightShift = function () {
    if (!this.r.wnpNightShift) { return; }
    this.r.wnpNightShift.style.background = this.nightShiftColor(parseInt(this.r.nightShiftWarmth.value, 10) || 0, parseInt(this.r.nightShiftBrightness.value, 10) || 100);
    this.r.wnpNightShift.style.opacity = "1";
};

/** Small clock over the now-playing view. */
WNP.applyMiniClock = function () {
    if (!this.r.wnpMiniClock) { return; }
    var ov = this.clockCfg().overlay || {};
    var el = this.r.wnpMiniClock;
    el.className = (ov.enabled ? "" : "d-none ") + "pos-" + (ov.position || "top-right") + " size-" + (ov.size || "m");
};

/**
 * Start the clock overlay logic. Runs every second.
 * Shows the clock when nothing has been playing for features.clock.afterSeconds,
 * optionally also while a TV/line input is active, and blanks the page after
 * features.clock.blankAfterMinutes of idle time.
 * @returns {undefined}
 */
WNP.startClock = function () {
    if (!this.r.wnpClock) { return; }
    var self = this;
    var inputs = ["HDMI", "OPTICAL", "LINE-IN", "BLUETOOTH", "SPDIF"];

    // The production HTML minifier strips empty inline-SVG nodes, so the analog
    // dial's dialTicks/dialNumbers/dialBrand/dialSub can be missing at runtime.
    // Recreate any that are absent so analog themes work regardless of the build. (fork)
    var dial = document.getElementById("clockDial");
    if (dial) {
        var SVGNS = "http://www.w3.org/2000/svg";
        [["dialTicks", "g", {}],
         ["dialNumbers", "g", {}],
         ["dialBrand", "text", { class: "dialBrand", x: "100", y: "62", "text-anchor": "middle" }],
         ["dialSub", "text", { class: "dialSub", x: "100", y: "140", "text-anchor": "middle" }]
        ].forEach(function (spec) {
            var el = document.getElementById(spec[0]);
            if (!el) {
                el = document.createElementNS(SVGNS, spec[1]);
                el.setAttribute("id", spec[0]);
                Object.keys(spec[2]).forEach(function (k) { el.setAttribute(k, spec[2][k]); });
                dial.appendChild(el);
            }
            self.r[spec[0]] = el;
        });
    }

    var tick = function () {
        var cfg = self.clockCfg();
        var enabled = cfg.enabled !== false;
        var afterMs = ((typeof cfg.afterSeconds === "number") ? cfg.afterSeconds : 10) * 1000;
        var blankMs = ((typeof cfg.blankAfterMinutes === "number") ? cfg.blankAfterMinutes : 0) * 60000;

        var st = self.d.lastState;
        var transport = st ? st.CurrentTransportState : null;
        var medium = st && st.PlayMedium ? String(st.PlayMedium).toUpperCase() : "";
        var onInput = inputs.indexOf(medium) >= 0;
        var playing = transport === "PLAYING" || transport === "TRANSITIONING" || transport === "PAUSED_PLAYBACK";
        var now = Date.now();

        // "Active playback" = something playing that should occupy the now-playing
        // screen. Playback over a TV/line input still counts as active unless the
        // user chose to show the clock over inputs.
        var activePlayback = playing && !(onInput && cfg.onInput);
        if (playing) { self.d.lastActivityMs = now; } // any playback resets the idle-blank timer
        if (activePlayback) { self.d.lastPlayingMs = now; } // ...only real playback resets the idle-clock timer

        // Show the clock when nothing is actively playing (immediately at boot, since
        // lastPlayingMs starts at 0) once it's been idle for afterSeconds. Never cover
        // an actively-playing track, even when afterSeconds is 0. (fork)
        var idleClock = enabled && !activePlayback && (now - self.d.lastPlayingMs) >= afterMs;
        if (self.d.manualClock && self.d.manualClockUntil && now >= self.d.manualClockUntil) { self.d.manualClock = false; }
        if (idleClock) { self.d.manualClock = false; } // idle takes over; swipe state resets
        // "Clock on backdrop" artwork mode: keep the clock shown over the hero art while a
        // Plex/Jellyfin video plays (CSS makes the clock background transparent). (fork)
        var clockOverHero = document.body.classList.contains("wnp-art-clock");
        var showClock = idleClock || self.d.manualClock || clockOverHero;
        var blank = (blankMs > 0 && (now - self.d.lastActivityMs) >= blankMs) || self.d.presenceBlank;
        var trans = (cfg.swipe && cfg.swipe.transition) || "fade";
        if (self.r.wnpClock.getAttribute("data-transition") !== trans) { self.r.wnpClock.setAttribute("data-transition", trans); }

        // Time / date
        var d = new Date();
        var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
        var timeHtml = hh + '<span class="colon">:</span>' + mm; // steady colon (no per-second blink) everywhere
        self.r.clockTime.innerHTML = timeHtml;
        self.r.clockDate.innerText = d.toLocaleDateString(self.clockLocale(), { weekday: "long", day: "numeric", month: "long" });
        self.r.clockNote.innerText = (onInput && playing) ? ("TV audio via " + medium.toLowerCase()) : "";
        if (self.r.wnpMiniClock) { self.r.wnpMiniClock.innerHTML = timeHtml; }

        // Analog hands
        if (self.r.wnpClock.getAttribute("data-kind") === "analog") {
            var sec = d.getSeconds(), min = d.getMinutes() + sec / 60, hr = (d.getHours() % 12) + min / 60;
            self.r.handSecond.setAttribute("transform", "rotate(" + (sec * 6) + " 100 100)");
            self.r.handMinute.setAttribute("transform", "rotate(" + (min * 6) + " 100 100)");
            self.r.handHour.setAttribute("transform", "rotate(" + (hr * 30) + " 100 100)");
        }

        // Seven-segment (weather is shown as icons via #clockWeather, not as digits)
        if (self.r.wnpClock.getAttribute("data-kind") === "segment") {
            var themeId = self.r.wnpClock.getAttribute("data-theme");
            var th = self.clockThemes[themeId] || {};
            var h24 = d.getHours(), tag = "";
            var hh2 = hh;
            if (th.ampm) { tag = h24 >= 12 ? "PM" : "AM"; hh2 = String(((h24 + 11) % 12) + 1).padStart(2, " "); }
            self.renderSegments(hh2 + ":" + mm, th, tag);
        }

        self.applyClockTheme(); // handles day/night switching
        self.applyNightShift(); // schedule may have flipped

        if (showClock !== self.d.clockVisible) {
            self.d.clockVisible = showClock;
            self.r.wnpClock.classList.toggle("visible", showClock);
            document.body.classList.toggle("wnp-clock-on", showClock);
        }
        document.body.classList.toggle("wnp-blank", blank);
    };

    this.r.wnpClock.classList.remove("d-none"); // visibility is driven by .visible from here on
    if (this.d.clockTimer) { clearInterval(this.d.clockTimer); }
    this.d.clockTimer = setInterval(tick, 1000);
    tick();

    // Drift: nudge the clock content every minute against OLED burn-in. The --drift
    // var is applied to .wnpClockInner (not #wnpClock) so only the digits move, never
    // the background. (fork)
    if (this.d.driftTimer) { clearInterval(this.d.driftTimer); }
    this.d.driftTimer = setInterval(function () {
        var cfg = self.clockCfg();
        if (cfg.drift === false) {
            self.r.wnpClock.style.setProperty("--drift", "translate(0, 0)");
            return;
        }
        var x = Math.round((Math.random() - 0.5) * 40), y = Math.round((Math.random() - 0.5) * 40);
        self.r.wnpClock.style.setProperty("--drift", "translate(" + x + "px, " + y + "px)");
    }, 60000);

    // Auto-hiding controls: while the clock covers the screen the toolbar is hidden,
    // and any mouse/touch movement fades it back in for a few seconds so the
    // fullscreen/settings icons stay reachable. (fork)
    var controlsTimer = null;
    var wakeControls = function () {
        document.body.classList.add("controls-active");
        if (controlsTimer) { clearTimeout(controlsTimer); }
        controlsTimer = setTimeout(function () { document.body.classList.remove("controls-active"); }, 3000);
    };
    document.addEventListener("pointermove", wakeControls, { passive: true });
    document.addEventListener("pointerdown", wakeControls, { passive: true });

    // Swipe to reveal / hide the clock while playing (touch or mouse drag)
    var swipeCfg = function () { return self.clockCfg().swipe || {}; };
    var inModal = function (el) { return el && el.closest && el.closest(".modal, .dropdown-menu, button, input, select, a"); };
    document.addEventListener("pointerdown", function (e) {
        if (!swipeCfg().enabled || inModal(e.target)) { self.d.swipeStart = null; return; }
        self.d.swipeStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, { passive: true });
    document.addEventListener("pointerup", function (e) {
        var st = self.d.swipeStart; self.d.swipeStart = null;
        var cfg = swipeCfg();
        if (!st || !cfg.enabled) { return; }
        var dx = e.clientX - st.x, dy = e.clientY - st.y;
        var isSwipe = Math.abs(dx) > 80 && Math.abs(dy) < 80 && (Date.now() - st.t) < 800;
        var isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10;
        var dir = dx < 0 ? "left" : "right";
        if (self.d.manualClock) {
            // Return: opposite swipe, or a tap on the clock
            var opposite = cfg.gesture === "any" || dir !== cfg.gesture;
            if ((isSwipe && opposite) || isTap) { self.d.manualClock = false; }
            return;
        }
        if (self.d.clockVisible) { return; } // idle clock: nothing to do
        if (isSwipe && (cfg.gesture === "any" || dir === cfg.gesture)) {
            self.d.manualClock = true;
            var ret = (typeof cfg.returnAfterSeconds === "number") ? cfg.returnAfterSeconds : 30;
            self.d.manualClockUntil = ret > 0 ? Date.now() + ret * 1000 : 0;
        }
    }, { passive: true });
};

/**
 * Get an identifier for the current play medium combined with the tracksource.
 * TODO: Verify all/most sources...
 * @param {string} playMedium - The PlayMedium as indicated by the device. Values: SONGLIST-NETWORK, RADIO-NETWORK, STATION-NETWORK, CAST, AIRPLAY, SPOTIFY, UNKOWN
 * @param {string} trackSource - The stream source as indicated by the device. Values: Prime, Qobuz, SPOTIFY, newTuneIn, iHeartRadio, Deezer, UPnPServer, Tidal, vTuner
 * @returns {string} The uri to the source identifier (image url)
 */
WNP.getSourceIdent = function (playMedium, trackSource) {

    var sIdentUri = "";

    switch (playMedium.toLowerCase()) {
        case "airplay":
            sIdentUri = "./img/sources/airplay2.png";
            break;
        case "third-dlna":
            sIdentUri = "./img/sources/dlna2.png";
            break;
        case "cast":
            sIdentUri = "./img/sources/chromecast2.png";
            break;
        case "radio-network":
            sIdentUri = "./img/sources/radio.png";
            break;
        case "songlist-network":
            sIdentUri = "./img/sources/ethernet2.png";
            break;
        case "spotify":
            sIdentUri = "./img/sources/spotify.png";
            break;
        case "squeezelite":
            sIdentUri = "./img/sources/music-assistant2.png";
            break;
        case "none":
            sIdentUri = "./img/sources/none2.png";
            break;
        case "bluetooth":
            sIdentUri = "./img/sources/bluetooth2.png";
            break;
        case "hdmi":
            sIdentUri = "./img/sources/hdmi2.png";
            break;
        case "line-in":
            sIdentUri = "./img/sources/line-in2.png";
            break;
        case "optical":
            sIdentUri = "./img/sources/spdif2.png";
            break;
    };

    switch (trackSource.toLowerCase()) {
        case "deezer":
        case "deezer2":
            sIdentUri = "./img/sources/deezer.png";
            break;
        case "iheartradio":
            sIdentUri = "./img/sources/iheart.png";
            break;
        case "newtunein":
            sIdentUri = "./img/sources/newtunein.png";
            break;
        case "plex":
            sIdentUri = "./img/sources/plex.png";
            break;
        case "prime":
            sIdentUri = "./img/sources/amazon-music2.png";
            break;
        case "qobuz":
            sIdentUri = "./img/sources/qobuz2.png";
            break;
        case "tidal":
            sIdentUri = "./img/sources/tidal2.png";
            break;
        case "upnpserver":
            sIdentUri = "./img/sources/dlna2.png";
            break;
        case "vtuner":
            sIdentUri = "./img/sources/vtuner2.png";
            break;
    };

    return sIdentUri;

};

/**
 * Get an identifier for the current audio/song quality.
 * TODO: Verify all/most sources...
 * Found so far:
 * 
 * CD Quality: 44.1 KHz/16 bit. Bitrate 1,411 kbps. For mp3 bitrate can vary, but also be 320/192/160/128/... kbps.
 * Hi-Res quality: 96 kHz/24 bit and up. Bitrate 9,216 kbps.
 * 
 * Spotify Lossless: bitrate 700 kbps, 44.1 kHz/24 bit
 * Spotify and Pandora usual bitrate 160 kbps, premium is 320 kbps
 * Tidal has CD quality, and FLAC, MQA, Master, ...
 * Qobuz apparently really has hi-res?
 * Amazon Music (Unlimited) does Atmos?
 * Apple Music -> Airplay 2, does hi-res?
 * YouTube Music -> Cast, does what?
 * 
 * TIDAL -
 * Sample High: "song:quality":"2","song:actualQuality":"LOSSLESS"
 * Sample MQA: "song:quality":"3","song:actualQuality":"HI_RES"
 * Sample FLAC: "song:quality":"4","song:actualQuality":"HI_RES_LOSSLESS"
 * 
 * @param {integer} songQuality - A number identifying the quality, as indicated by the streaming service(?).
 * @param {string} songActualQuality - An indicator for the actual quality, as indicated by the streaming service(?).
 * @param {integer} songBitrate - The current bitrate in kilobit per second.
 * @param {integer} songBitDepth - The current sample depth in bits.
 * @param {integer} songSampleRate - The current sample rate in Hz.
 * @returns {string} The identifier for the audio quality, just a string.
 */
WNP.getQualityIdent = function (songQuality, songActualQuality, songBitrate, songBitDepth, songSampleRate) {
    // console.log(songQuality, songActualQuality, songBitrate, songBitDepth, songSampleRate);

    var sIdent = "";

    if (songBitrate >= 700 && songBitDepth == 24 && songSampleRate == 44100) {
        sIdent = "Lossless";
    }
    if (songBitrate > 1000 && songBitDepth == 16 && songSampleRate == 44100) {
        sIdent = "CD";
    }
    else if (songBitrate > 7000 && songBitDepth >= 24 && songSampleRate >= 96000) {
        sIdent = "Hi-Res";
    }

    // Based of Tidal/Amazon Music Unlimited/Deezer/Qobuz
    switch (songQuality + ":" + songActualQuality) {
        case "2:LOSSLESS": // Tidal
        case ":LOSSLESS": // Tidal
            sIdent = "HIGH";
            break;
        case "3:HI_RES": // Tidal
            sIdent = "MQA";
            break;
        case "4:HI_RES_LOSSLESS": // Tidal
        case ":HI_RES_LOSSLESS": // Tidal
        case "0:LOSSLESS": // Deezer
            sIdent = "FLAC";
            break;
        case ":FLAC": // Plex / Jellyfin (external sessions)
        case ":ALAC":
        case ":MP3":
        case ":AAC":
        case ":OPUS":
        case ":OGG":
            sIdent = songActualQuality;
            break;
        case ":UHD": // Amazon Music
            sIdent = "ULTRA HD";
            break;
        case ":HD":
            sIdent = "HD"; // Amazon Music
            break;
        case "3:7":
        case "4:27":
            sIdent = "Hi-Res"; // Qobuz
            break;
        case "2:6":
            sIdent = "CD"; // Qobuz
            break;
    };

    return sIdent;

};

/**
 * Show a Bootstrap alert with the given message and type. The alert will automatically disappear after a few seconds.
 * Only one alert will be shown at a time, if a new alert is shown while another one is still visible, the previous one will be removed immediately.
 * @param {*} sMessage - The message to show in the alert
 * @param {*} sType - The Bootstrap alert type (primary, secondary, success, danger, warning, info, light, dark)
 */
WNP.showAlert = function (sMessage, sType) {

    // Clear existing alert and timeout, if any
    if (this.d.alertTimeout) {
        clearTimeout(this.d.alertTimeout);
        this.d.alertTimeout = null;
    }

    // Close existing alert, if any
    const currentAlert = this.r.alerts.querySelector('.alert');
    if (currentAlert) {
        const bsAlert = bootstrap.Alert.getOrCreateInstance(currentAlert);
        bsAlert.close();
    }

    // Construct new alert element
    const alertDiv = document.createElement("div");
    alertDiv.classList = "alert alert-" + sType + " alert-dismissible fade show";
    alertDiv.setAttribute("role", "alert");
    alertDiv.innerHTML = sMessage + '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>';

    // Add alert to the container
    this.r.alerts.replaceChildren(alertDiv);

    // Set timeout to remove alert after a few seconds
    this.d.alertTimeout = setTimeout(() => {
        const bsAlert = bootstrap.Alert.getOrCreateInstance(alertDiv);
        bsAlert.close();
        this.d.alertTimeout = null;
    }, this.s.alertTimeoutMs);

};

// =======================================================
// Start WiiM Now Playing app
WNP.Init();
