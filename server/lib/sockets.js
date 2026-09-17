// ===========================================================================
// socket.js

/**
 * Socket.io functionality module.
 * Contains generic functions to aid the sockets in the app.
 * @module
 */

// Other modules
const lib = require("./lib.js"); // Generic functionality
const log = require("debug")("lib:sockets");

/**
 * This function provides a cleaned up array of found devices emitted to clients.
 * @param {object} io - The Socket.IO object to emit to clients.
 * @param {array} deviceList - The array of found device objects.
 * @returns {undefined}
 */
const getDevices = (io, deviceList) => {
    log("Device list requested.");
    let devicesMap = deviceList.map(d => ({
        "friendlyName": d.friendlyName,
        "manufacturer": d.manufacturer,
        "modelName": d.modelName,
        "location": d.location,
    }));
    io.emit("devices-get", devicesMap);
}

/**
 * This function sets a chosen device as the selected device based on location.
 * @param {object} io - The Socket.IO object to emit to clients.
 * @param {array} deviceList - The array of found device objects.
 * @param {object} deviceInfo - The device info object.
 * @param {object} serverSettings - The server settings object.
 * @param {string} location - The device location uri.
 * @returns {undefined}
 */
const setDevice = (io, deviceList, deviceInfo, serverSettings, location) => {
    log("Change selected device...");
    const selDevice = deviceList.filter((d) => { return d.location === location })
    if (selDevice.length > 0) {

        // Reset device info
        deviceInfo.state = null;
        deviceInfo.metadata = null;
        deviceInfo.client = null;
        deviceInfo.lyrics = null;

        // Set currently selected device
        serverSettings.selectedDevice = {
            "friendlyName": selDevice[0].friendlyName,
            "manufacturer": selDevice[0].manufacturer,
            "modelName": selDevice[0].modelName,
            "location": selDevice[0].location,
            "actions": Object.keys(selDevice[0].actions)
        };

        io.emit("device-set", serverSettings.selectedDevice); // Send selected device props
        lib.saveSettings(serverSettings); // Make sure the settings are stored

    }
    else {
        log("Selected device not in found list!");
        // TODO: Should there be feedback to the clients?
    }
}

/**
 * This function initiates the SSDP device discovery.
 * @param {object} io - The Socket.IO object to emit to clients.
 * @param {object} ssdp - The SSDP module reference.
 * @param {array} deviceList - The array of found device objects.
 * @returns {undefined}
 */
const scanDevices = (io, ssdp, deviceList, serverSettings) => {
    log("Scanning for devices...");
    ssdp.scan(deviceList, serverSettings);
    io.emit("devices-refresh", "Scanning for devices...");
}

/**
 * This function gets the server settings.
 * @param {object} io - The Socket.IO object to emit to clients.
 * @param {object} serverSettings - The server settings object.
 * @returns {undefined}
 */
const getServerSettings = (io, serverSettings) => {
    log("Get server settings...");
    // Which Sources fields are supplied by env vars (they override the UI). The client shows
    // these read-only. Non-secret env values are surfaced for display; secrets are not. (fork)
    const e = process.env;
    const lk = (envVal, secret) => envVal ? { locked: true, value: secret ? "" : envVal, secret: !!secret } : { locked: false };
    const envLocks = {
        external: {
            priority: lk(e.EXTERNAL_PRIORITY),
            plex: { url: lk(e.PLEX_URL), token: lk(e.PLEX_TOKEN, true), players: lk(e.PLEX_PLAYERS), users: lk(e.PLEX_USERS) },
            jellyfin: { url: lk(e.JELLYFIN_URL), apiKey: lk(e.JELLYFIN_API_KEY, true), players: lk(e.JELLYFIN_PLAYERS), users: lk(e.JELLYFIN_USERS) }
        }
    };
    io.emit("server-settings", { ...serverSettings, envLocks });
}

module.exports = {
    getDevices,
    setDevice,
    scanDevices,
    getServerSettings,
};
