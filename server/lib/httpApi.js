// ===========================================================================
// httpApi.js

/**
 * HTTP API functionality module
 *
 * This module will handle the HTTP API requests to the WIIM device.
 * It will proxy requests from the client to the device and return the results.
 * It uses the https module to make requests to the device.
 * It disables SSL validation to allow for self-signed certificates.
 * It emits the (parsed) results to all connected clients using Socket.IO.
 * @module
 */

// User https module
const https = require("https");

// Other modules
const lib = require("./lib.js"); // Generic functionality
const log = require("debug")("lib:httpApi");

/**
 * Proxy requests to WiiM/Linkplay device using the HTTP API.
 * @param {string} cmd - The command to send to the device.
 * @param {object} serverSettings - The server settings object.
 * @param {function} callback - The callback function to handle the response.
 * @returns {undefined}
 */
const callHttpApi = (cmd, serverSettings, callback) => {
    // Check if a valid IP address is available
    const ipAddress = lib.getIpAddressFromLocation(serverSettings);
    if (!ipAddress) {
        log("No IP address found for selected device. Aborting request.");
    }
    else {

        // Construct the URL to the WiiM/Linkplay device
        const url = "https://" + ipAddress + "/httpapi.asp?command=" + encodeURIComponent(cmd);
        // Options for the HTTPS request
        const options = {
            rejectUnauthorized: false, // Disable SSL validation, for self-signed certificates
        };

        log("HTTP API call:", url);
        try {
            https.get(url, options, (res) => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => callback(null, data));
            }).on("error", err => callback(err));
        } catch (err) {
            callback(err);
        }

    }
}

/**
 * This function handles the API call by calling the HTTP API.
 * @param {object} io - The Socket.IO object to emit to clients.
 * @param {string} msg - The message to mirror.
 * @param {object} serverSettings - The server settings object.
 * @returns {object} The resulting object of the action (or null).
 */
const callApi = (io, msg, serverSettings) => {
    log("API function called:", msg);
    callHttpApi(msg, serverSettings, (err, result) => {
        if (err) {
            log("API function error:", msg, err.code);
            io.emit("device-api", msg, null);
        }
        if (result) {
            log("API function result:", msg, result);
            try {
                // Emit the parsed JSON result to all connected clients
                const obj = JSON.parse(result);
                io.emit("device-api", msg, obj);
            } catch (e) {
                // Emit the raw result to all connected clients
                io.emit("device-api", msg, result);
            }
        }
    });
}

/**
 * Fetch and parse the device player status (volume, mute, transport, ...).
 * @param {object} serverSettings - The server settings object.
 * @param {function} callback - callback(err, statusObject)
 * @returns {undefined}
 */
const getStatus = (serverSettings, callback) => {
    callHttpApi("getPlayerStatus", serverSettings, (err, data) => {
        if (err) { return callback(err); }
        try { callback(null, JSON.parse(data)); }
        catch (e) { callback(e); }
    });
};

/**
 * Adjust the device volume by a relative delta (read-modify-write, since the
 * LinkPlay API only sets absolute volume). Used by the wireless volume knob.
 * @param {object} io - The Socket.IO object.
 * @param {number} delta - Signed volume step (percent).
 * @param {object} serverSettings - The server settings object.
 * @returns {undefined}
 */
const adjustVolume = (io, delta, serverSettings) => {
    getStatus(serverSettings, (err, st) => {
        if (err || !st) { log("adjustVolume: no status", err && err.code); return; }
        let vol = parseInt(st.vol, 10);
        if (isNaN(vol)) { vol = 0; }
        const next = Math.max(0, Math.min(100, vol + delta));
        callApi(io, "setPlayerCmd:vol:" + next, serverSettings);
    });
};

/**
 * Toggle mute based on the current device state.
 * @param {object} io - The Socket.IO object.
 * @param {object} serverSettings - The server settings object.
 * @returns {undefined}
 */
const toggleMute = (io, serverSettings) => {
    getStatus(serverSettings, (err, st) => {
        if (err || !st) { log("toggleMute: no status", err && err.code); return; }
        const muted = String(st.mute) === "1";
        callApi(io, "setPlayerCmd:mute:" + (muted ? "0" : "1"), serverSettings);
    });
};

module.exports = {
    callApi,
    getStatus,
    adjustVolume,
    toggleMute
};