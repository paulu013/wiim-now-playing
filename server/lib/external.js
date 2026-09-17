// ===========================================================================
// external.js
//
// External "now playing" sources: Plex and Jellyfin sessions.
// When a session is playing, this module synthesises `state` and `metadata`
// messages in the same shape the UPnP client produces, so the existing UI
// renders them without changes.
//
// Priority (serverSettings.features.external.priority):
//   "wiim"     - the WiiM wins while it is PLAYING; external fills in otherwise (default)
//   "external" - a playing Plex/Jellyfin session always wins
//
// Config lives in serverSettings.features.external (persisted in settings.json)
// and can be overridden with env vars: PLEX_URL, PLEX_TOKEN, PLEX_PLAYERS,
// JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_PLAYERS, EXTERNAL_PRIORITY.

const lib = require("./lib.js");
const log = require("debug")("lib:external");

const DEFAULTS = {
    enabled: true,
    priority: "wiim",
    pollMs: 2000,
    artwork: "backdrop", // "backdrop" (full-screen hero + logo) | "poster" | "still"
    clearLogo: true, // Show the clear logo (Plex clearLogo / Jellyfin Logo) instead of the plain-text title when available
    showDetails: false, // Show the director/genre + release year for video (music always shows artist/album)
    plex: { url: "", token: "", players: [], users: [] },
    jellyfin: { url: "", apiKey: "", players: [], users: [] }
};

let current = null;      // Normalised external session, or null
let pollTimer = null;
const plexLogoCache = new Map(); // Plex ratingKey -> clearLogo URL ("" = none). /status/sessions omits the Image[] array, so we fetch the full metadata once per item and cache it. (fork)

// ---------------------------------------------------------------- helpers

const csv = (s) => (s || "").split(",").map(x => x.trim()).filter(Boolean);

/**
 * Effective config = defaults <- saved settings <- env vars.
 */
const getConfig = (serverSettings) => {
    const saved = (serverSettings.features && serverSettings.features.external) || {};
    const cfg = {
        ...DEFAULTS, ...saved,
        plex: { ...DEFAULTS.plex, ...(saved.plex || {}) },
        jellyfin: { ...DEFAULTS.jellyfin, ...(saved.jellyfin || {}) }
    };
    if (process.env.PLEX_URL) cfg.plex.url = process.env.PLEX_URL;
    if (process.env.PLEX_TOKEN) cfg.plex.token = process.env.PLEX_TOKEN;
    if (process.env.PLEX_PLAYERS) cfg.plex.players = csv(process.env.PLEX_PLAYERS);
    if (process.env.PLEX_USERS) cfg.plex.users = csv(process.env.PLEX_USERS);
    if (process.env.JELLYFIN_URL) cfg.jellyfin.url = process.env.JELLYFIN_URL;
    if (process.env.JELLYFIN_API_KEY) cfg.jellyfin.apiKey = process.env.JELLYFIN_API_KEY;
    if (process.env.JELLYFIN_PLAYERS) cfg.jellyfin.players = csv(process.env.JELLYFIN_PLAYERS);
    if (process.env.JELLYFIN_USERS) cfg.jellyfin.users = csv(process.env.JELLYFIN_USERS);
    if (process.env.EXTERNAL_PRIORITY) cfg.priority = process.env.EXTERNAL_PRIORITY;
    if (typeof cfg.plex.players === "string") cfg.plex.players = csv(cfg.plex.players);
    if (typeof cfg.plex.users === "string") cfg.plex.users = csv(cfg.plex.users);
    if (typeof cfg.jellyfin.players === "string") cfg.jellyfin.players = csv(cfg.jellyfin.players);
    if (typeof cfg.jellyfin.users === "string") cfg.jellyfin.users = csv(cfg.jellyfin.users);
    return cfg;
};

/** Seconds -> "HH:MM:SS" as UPnP RelTime/TrackDuration. */
const hms = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
};

const fetchJson = async (url, headers, timeoutMs = 4000) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: ctl.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
    } finally {
        clearTimeout(t);
    }
};

// ---------------------------------------------------------------- Plex

const pollPlex = async (cfg, artwork) => {
    if (!cfg.url || !cfg.token) return null;
    const base = cfg.url.replace(/\/$/, "");
    let items;
    try {
        const j = await fetchJson(`${base}/status/sessions?X-Plex-Token=${encodeURIComponent(cfg.token)}`);
        items = (j.MediaContainer && j.MediaContainer.Metadata) || [];
    } catch (e) {
        log("plex", e.message);
        return null;
    }
    const PLEX_TYPES = ["track", "movie", "episode", "clip"]; // music + video
    const players = cfg.players.map(p => p.toLowerCase());
    const users = (cfg.users || []).map(u => u.toLowerCase());
    let best = null;
    for (const it of items) {
        if (!PLEX_TYPES.includes(it.type)) continue;
        const player = it.Player || {};
        const user = it.User || {};
        if (players.length && !players.includes((player.title || "").toLowerCase())) continue;
        if (users.length && !users.includes((user.title || "").toLowerCase())) continue; // restrict to specific account(s)
        if (player.state === "playing") { best = it; break; }
        if (player.state === "paused" && !best) best = it;
    }
    if (!best) return null;
    const media = (best.Media && best.Media[0]) || {};
    const isEp = best.type === "episode";
    const img = (path) => path ? `${base}${path}?X-Plex-Token=${encodeURIComponent(cfg.token)}` : "";
    // Pick artwork per the chosen style (see DEFAULTS.artwork).
    const poster = isEp ? (best.grandparentThumb || best.parentThumb || best.thumb) : best.thumb;
    let artPath;
    if (artwork === "still") { artPath = best.thumb || poster; }
    else if (artwork === "backdrop" || artwork === "clock") { artPath = best.art || best.grandparentArt || poster; }
    else { artPath = poster; } // poster (default fallback)
    // Clear logo: /status/sessions omits the Image[] array, so fall back to the full
    // library-metadata endpoint and cache the result per ratingKey. (fork)
    let logo = "";
    const inlineLogo = (best.Image || []).find(i => i.type === "clearLogo");
    if (inlineLogo) {
        logo = img(inlineLogo.url);
    } else if (best.ratingKey != null) {
        const rk = String(best.ratingKey);
        if (plexLogoCache.has(rk)) {
            logo = plexLogoCache.get(rk);
        } else {
            try {
                const meta = await fetchJson(`${base}/library/metadata/${encodeURIComponent(rk)}?X-Plex-Token=${encodeURIComponent(cfg.token)}`);
                const m0 = meta && meta.MediaContainer && meta.MediaContainer.Metadata && meta.MediaContainer.Metadata[0];
                const lo = m0 && (m0.Image || []).find(i => i.type === "clearLogo");
                logo = lo ? img(lo.url) : "";
            } catch (e) {
                log("plex logo", e.message);
                logo = "";
            }
            if (plexLogoCache.size > 200) { plexLogoCache.clear(); } // bound the cache
            plexLogoCache.set(rk, logo);
        }
    }

    // Map to the music-shaped now-playing fields per content type.
    let title = best.title || "", artist = "", album = "", year = null;
    if (best.type === "episode") {
        artist = best.grandparentTitle || "";                                   // show name
        album = best.parentTitle || (best.parentIndex ? `Season ${best.parentIndex}` : "");
        if (best.index) { album = (album ? album + " · " : "") + `Episode ${best.index}`; }
    } else if (best.type === "movie" || best.type === "clip") {
        artist = (best.Director && best.Director[0] && best.Director[0].tag) || best.tagline || "";
        album = best.year ? String(best.year) : "";
    } else { // track (music)
        artist = best.originalTitle || best.grandparentTitle || "";
        album = best.parentTitle || "";
        year = best.parentYear || best.year || null;
    }
    // A client can be remote-controlled only if it advertises the "playback" capability.
    const controllable = /(^|,)\s*playback\s*(,|$)/.test((best.Player && best.Player.protocolCapabilities) || "");
    return {
        source: "Plex",
        kind: best.type, // track | movie | episode | clip
        controlId: (best.Player && best.Player.machineIdentifier) || "", // target client for remote play/pause
        controllable,
        state: best.Player.state === "playing" ? "PLAYING" : "PAUSED_PLAYBACK",
        title, artist, album, year,
        art: img(artPath),
        logo, artwork: artwork || "poster",
        position: (best.viewOffset || 0) / 1000,
        duration: (best.duration || 0) / 1000,
        player: best.Player.title || "",
        bitrate: media.bitrate || 0,
        bitDepth: 0,
        sampleRate: 0,
        codec: (media.audioCodec || "").toUpperCase(),
        rating: best.userRating || null
    };
};

// ---------------------------------------------------------------- Jellyfin

const pollJellyfin = async (cfg, artwork) => {
    if (!cfg.url || !cfg.apiKey) return null;
    const base = cfg.url.replace(/\/$/, "");
    let sessions;
    try {
        sessions = await fetchJson(`${base}/Sessions`, { Authorization: `MediaBrowser Token="${cfg.apiKey}"` });
    } catch (e) {
        log("jellyfin", e.message);
        return null;
    }
    const JF_TYPES = ["Audio", "Movie", "Episode", "Video", "MusicVideo"]; // music + video
    const players = cfg.players.map(p => p.toLowerCase());
    const users = (cfg.users || []).map(u => u.toLowerCase());
    let best = null;
    for (const s of sessions) {
        const item = s.NowPlayingItem;
        if (!item || !JF_TYPES.includes(item.Type)) continue;
        if (players.length && !players.includes((s.DeviceName || "").toLowerCase())) continue;
        if (users.length && !users.includes((s.UserName || "").toLowerCase())) continue; // restrict to specific user(s)
        const paused = s.PlayState && s.PlayState.IsPaused;
        if (!paused) { best = s; break; }
        if (!best) best = s;
    }
    if (!best) return null;
    const item = best.NowPlayingItem;
    const ps = best.PlayState || {};
    const isEpisode = item.Type === "Episode";
    const stream = (item.MediaStreams || []).find(m => m.Type === "Audio") || {};

    // Pick artwork per the chosen style (Jellyfin image endpoints need no auth).
    const posterId = (isEpisode ? item.SeriesId : item.AlbumId) || item.Id; // series/movie/album poster
    const backdropId = (isEpisode ? item.SeriesId : item.Id) || item.Id;    // series/movie backdrop
    const jimg = (id, type, extra) => id ? `${base}/Items/${id}/Images/${type}?${extra || "fillHeight=1400"}` : "";
    let art;
    if (artwork === "still") { art = jimg(item.Id, "Primary"); }             // episode's own image = still
    else if (artwork === "backdrop" || artwork === "clock") { art = jimg(backdropId, "Backdrop/0", "fillWidth=2000") || jimg(posterId, "Primary"); }
    else { art = jimg(posterId, "Primary"); }                               // poster
    // Clear logo (series logo for episodes, item logo for movies) if present.
    let logo = "";
    if (isEpisode && item.ParentLogoItemId) { logo = jimg(item.ParentLogoItemId, "Logo", "fillHeight=400"); }
    else if (item.ImageTags && item.ImageTags.Logo) { logo = jimg(item.Id, "Logo", "fillHeight=400"); }
    else if (item.AlbumId) { logo = jimg(item.AlbumId, "Logo", "fillHeight=400"); } // music: album logo (may 404 -> client falls back to the title)

    // Map to the music-shaped now-playing fields per content type.
    let title = item.Name || "", artist = "", album = "", year = null;
    if (isEpisode) {
        artist = item.SeriesName || "";
        album = (item.SeasonName || (item.ParentIndexNumber ? `Season ${item.ParentIndexNumber}` : ""));
        if (item.IndexNumber) { album = (album ? album + " · " : "") + `Episode ${item.IndexNumber}`; }
    } else if (item.Type === "Movie" || item.Type === "Video") {
        artist = (item.Genres && item.Genres[0]) || "";
        album = item.ProductionYear ? String(item.ProductionYear) : "";
    } else { // Audio / MusicVideo
        artist = (item.Artists && item.Artists.join(", ")) || item.AlbumArtist || "";
        album = item.Album || "";
        year = item.ProductionYear || null;
    }
    return {
        source: "Jellyfin",
        kind: isEpisode ? "episode" : ((item.Type === "Audio" || item.Type === "MusicVideo") ? "track" : "movie"),
        controlId: best.Id || "", // session id for remote play/pause
        controllable: Boolean(best.SupportsRemoteControl),
        state: ps.IsPaused ? "PAUSED_PLAYBACK" : "PLAYING",
        title, artist, album, year,
        art,
        logo, artwork: artwork || "poster",
        position: (ps.PositionTicks || 0) / 1e7,
        duration: (item.RunTimeTicks || 0) / 1e7,
        player: best.DeviceName || "",
        bitrate: stream.BitRate ? Math.round(stream.BitRate / 1000) : 0,
        bitDepth: stream.BitDepth || 0,
        sampleRate: stream.SampleRate || 0,
        codec: (stream.Codec || "").toUpperCase(),
        rating: null
    };
};

// ---------------------------------------------------------------- synthesis

/** Build a UPnP-shaped metadata message from a normalised session. */
const toMetadata = (s) => {
    const ts = lib.getTimeStamp();
    return {
        trackMetaData: {
            "dc:title": s.title,
            "dc:subtitle": s.player ? `on ${s.player}` : "",
            "upnp:artist": s.artist,
            "upnp:album": s.year ? `${s.album} (${s.year})` : s.album,
            "upnp:albumArtURI": s.art,
            "song:bitrate": s.bitrate || "",
            "song:format_s": s.bitDepth || "",
            "song:rate_hz": s.sampleRate || "",
            "song:quality": "",
            "song:actualQuality": s.codec || "", // e.g. FLAC, ALAC, MP3 -> quality badge
            "wnp:rating": s.rating || "",
            "wnp:kind": s.kind || "", // track | movie | episode | clip -> client hides audio-quality for video
            "wnp:logo": s.logo || "", // clear title logo (for the backdrop-hero layout)
            "wnp:artwork": s.artwork || "poster", // backdrop | poster | still -> client picks the layout
            "wnp:controllable": s.controllable ? "1" : "" // whether the source accepts remote play/pause

        },
        RelTime: hms(s.position),
        TrackDuration: hms(s.duration),
        PlayMedium: s.source.toUpperCase(),
        TrackSource: s.source,
        CurrentTransportState: s.state,
        external: true,
        metadataTimeStamp: ts
    };
};

const toState = (s, meta) => ({
    CurrentTransportState: s.state,
    CurrentTransportStatus: "OK",
    CurrentSpeed: "1",
    RelTime: meta.RelTime,
    TimeStamp: null,
    TrackDuration: meta.TrackDuration,
    PlayMedium: meta.PlayMedium,
    external: true,
    metadataTimeStamp: meta.metadataTimeStamp,
    stateTimeStamp: lib.getTimeStamp()
});

// ---------------------------------------------------------------- public API

/**
 * Whether the external session should be shown instead of the device.
 * @param {object} deviceInfo - The device info object (device state/metadata).
 * @param {object} serverSettings - The server settings object.
 * @returns {boolean}
 */
const shouldOverride = (deviceInfo, serverSettings) => {
    if (!current) return false;
    const cfg = getConfig(serverSettings);
    if (!cfg.enabled) return false;
    if (cfg.priority === "external") return true;
    const devState = deviceInfo.state && deviceInfo.state.CurrentTransportState;
    if (devState === "PLAYING" || devState === "TRANSITIONING") return false;
    // Device paused: external only if it is actually playing.
    if (devState === "PAUSED_PLAYBACK") return current.state === "PLAYING";
    return true;
};

const getCurrent = () => current;

/**
 * Send a transport command to the current external session's player.
 * @param {object} serverSettings
 * @param {string} action - "Play" | "Pause" | "Stop"
 * Plex control is best-effort (needs the client's Plex Companion / "advertise as
 * player" enabled); Jellyfin uses the documented Sessions command API.
 */
let plexCmdId = 0;
const control = async (serverSettings, action) => {
    if (!current || !current.controlId) { log("control: no controllable session"); return; }
    const cfg = getConfig(serverSettings);
    try {
        if (current.source === "Plex") {
            const base = cfg.plex.url.replace(/\/$/, "");
            const cmd = { Play: "play", Pause: "pause", Stop: "stop", Next: "skipNext", Previous: "skipPrevious" }[action] || "playPause";
            plexCmdId += 1;
            // Plex Companion remote control: the PMS relays to the target client. Needs the
            // client to support remote control ("Advertise as player"). Best-effort.
            const url = `${base}/player/playback/${cmd}?type=video&commandID=${plexCmdId}`
                + `&X-Plex-Target-Client-Identifier=${encodeURIComponent(current.controlId)}`
                + `&X-Plex-Token=${encodeURIComponent(cfg.plex.token)}`;
            const r = await fetch(url, {
                headers: {
                    "X-Plex-Target-Client-Identifier": current.controlId,
                    "X-Plex-Client-Identifier": "wiim-now-playing",
                    "X-Plex-Device-Name": "WiiM Now Playing",
                    "X-Plex-Product": "WiiM Now Playing",
                    "X-Plex-Version": "1.0",
                    Accept: "application/json"
                }
            });
            log("plex control", cmd, "target", current.controlId, "->", r.status, url);
            log("plex control response:", (await r.text()).slice(0, 300));
        } else if (current.source === "Jellyfin") {
            const base = cfg.jellyfin.url.replace(/\/$/, "");
            const cmd = { Play: "Unpause", Pause: "Pause", Stop: "Stop", Next: "NextTrack", Previous: "PreviousTrack" }[action] || "PlayPause";
            const r = await fetch(`${base}/Sessions/${encodeURIComponent(current.controlId)}/Playing/${cmd}`, {
                method: "POST", headers: { Authorization: `MediaBrowser Token="${cfg.jellyfin.apiKey}"` }
            });
            log("jellyfin control", cmd, "->", r.status);
        }
    } catch (e) { log("control failed:", e.message); }
};

/** One poll of all configured sources; emits if the outcome changed what should be shown. */
const poll = async (io, deviceInfo, serverSettings) => {
    const cfg = getConfig(serverSettings);
    if (!cfg.enabled) { current = null; return; }
    const [plex, jf] = await Promise.all([pollPlex(cfg.plex, cfg.artwork), pollJellyfin(cfg.jellyfin, cfg.artwork)]);
    const cands = [plex, jf].filter(Boolean);
    const next = cands.find(c => c.state === "PLAYING") || cands[0] || null;

    const wasOverriding = shouldOverride(deviceInfo, serverSettings);
    current = next;
    const nowOverriding = shouldOverride(deviceInfo, serverSettings);

    if (nowOverriding) {
        const meta = toMetadata(current);
        io.emit("metadata", meta);
        io.emit("state", toState(current, meta));
    }
    else if (wasOverriding) {
        // Hand back to the device immediately rather than waiting for its next poll.
        if (deviceInfo.metadata) io.emit("metadata", deviceInfo.metadata);
        if (deviceInfo.state) { io.emit("state", deviceInfo.state); }
        else {
            // No device configured: tell the UI the session ended so it goes idle
            // (clock returns) instead of freezing on the last external frame.
            io.emit("state", {
                CurrentTransportState: "STOPPED", CurrentTransportStatus: "OK", CurrentSpeed: "1",
                RelTime: "00:00:00", TrackDuration: "00:00:00", PlayMedium: "",
                external: true, stateTimeStamp: lib.getTimeStamp()
            });
        }
    }
};

const start = (io, deviceInfo, serverSettings) => {
    stop();
    const cfg = getConfig(serverSettings);
    if (!cfg.enabled || (!cfg.plex.url && !cfg.jellyfin.url)) {
        log("External sources not configured");
        return null;
    }
    log("Start polling external sources every", cfg.pollMs, "ms");
    poll(io, deviceInfo, serverSettings);
    pollTimer = setInterval(() => poll(io, deviceInfo, serverSettings), cfg.pollMs);
    return pollTimer;
};

const stop = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
};

/**
 * Wrap io so device-originated state/metadata emits are suppressed while an
 * external session is being shown. Everything else passes through untouched.
 */
const wrapIo = (io, deviceInfo, serverSettings) => new Proxy(io, {
    get(target, prop) {
        if (prop === "emit") {
            return (event, ...args) => {
                if ((event === "state" || event === "metadata") && shouldOverride(deviceInfo, serverSettings)) {
                    return true;
                }
                return target.emit(event, ...args);
            };
        }
        const v = target[prop];
        return (typeof v === "function") ? v.bind(target) : v;
    }
});

/** Messages to send a freshly connected client. */
const currentMessages = (deviceInfo, serverSettings) => {
    if (shouldOverride(deviceInfo, serverSettings)) {
        const meta = toMetadata(current);
        return { metadata: meta, state: toState(current, meta) };
    }
    return { metadata: deviceInfo.metadata, state: deviceInfo.state };
};

module.exports = { DEFAULTS, getConfig, shouldOverride, getCurrent, control, poll, start, stop, wrapIo, currentMessages };
