# CLAUDE.md — wiim-now-playing (paulu013 fork)

Private fork of https://github.com/cvdlinden/wiim-now-playing (GPL-3.0). Upstream is `upstream`, this fork is `origin`.
Goal: a now-playing display on a TV cabinet for a WiiM Ultra, on a Raspberry Pi 4 driving a Wisecoco 8" 2480×1860 AMOLED (4:3) over HDMI, Chromium kiosk.

## Fork additions (see FORK.md for the full description)
- `server/lib/external.js` — Plex `/status/sessions` + Jellyfin `/Sessions` polling. Emits `state`/`metadata` in the UPnP shape the client already renders. Priority setting `wiim` (default) or `external`. Env overrides: `PLEX_URL`, `PLEX_TOKEN`, `PLEX_PLAYERS`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_PLAYERS`, `EXTERNAL_PRIORITY`.
- `server/lib/weather.js` — Open-Meteo current temp + 3-day forecast + sunrise/sunset; free-text location geocoded once and cached in `features.weather.lat/lon/name`. Emits socket `weather`; `weather-get` forces a refresh.
- Colours: `WNP.colorRoles` (role list + which clock kinds show them), `WNP.clockColors` (presets with all roles), `WNP.effectiveColors(theme)` = preset ∪ `features.clock.colors.custom`; night dimming via `WNP.dimHex` (RGB multiply); scheme helper `WNP.schemeColors`. Server merge replaces `colors.custom` wholesale so resets stick.
- Night shift: `features.display.nightShift`; `WNP.applyNightShift()` runs every tick, `WNP.nightShiftActive()` evaluates the schedule, `WNP.nightShiftColor()` maps warmth/brightness to the overlay colour.
- Clock themes: `WNP.clockThemes` / `WNP.clockColors` / `WNP.clockFonts` in `wnp.js`, applied by `WNP.applyClockTheme()` via CSS variables (`--clock-font/bg/fg/fg2/accent`) on `#wnpClock`; per-theme geometry in `wnp.scss` under `#wnpClock[data-theme=…]`. Analog dial is inline SVG (`#clockDial`), ticks/numerals generated in JS. Day/night switching in `WNP.isNight()`. Mini clock `#wnpMiniClock`. Clock visibility = `.visible` class (never `d-none` after init); entrance/exit transition from `data-transition`; drift via `--drift` CSS var so it composes with the slide transform. Swipe/tap handling is at the end of `WNP.startClock()` (pointer events on `document`, ignores controls/modals). `features.clock.locale` drives `toLocaleDateString`.
- `server/index.js` — `ioDev = external.wrapIo(io, …)` proxy given to the UPnP poller so device emits are suppressed while an external session is shown; `features-settings` socket event; defaults for `features.clock` and `features.external`.
- `client/src/js/wnp.js` — `WNP.startClock()` (clock overlay, drift, idle blank), Display/Sources settings wiring, codec badge cases (`:FLAC` etc.), Plex star rating appended to album line, source-name text fallback when no icon.
- `client/src/index.html`, `client/src/tv.html` — `#wnpClock` overlay; Display and Sources tabs (index only).
- `client/src/scss/wnp.scss` — `#wnpClock`, `body.wnp-blank`.

## Architecture (upstream, unchanged)
- Server: Express + Socket.IO, `server/index.js`. Finds the WiiM via SSDP (`lib/ssdp.js`), polls UPnP AVTransport every 1 s for state and every 4 s for metadata (`lib/upnpClient.js`), LinkPlay HTTP API for volume/presets (`lib/httpApi.js`). Polling only runs while ≥1 client is connected. Settings persist in `server/settings.json` (`lib/lib.js` saveSettings/getSettings; `features` is shallow-merged).
- Client: vanilla JS + Bootstrap 5, built with Parcel from `client/src/` into `server/public/` (committed). `WNP.r` holds element refs (ids listed in `WNP.s.aDeviceUI` / `aServerUI`; missing ids are tolerated, so `/tv` can omit the settings modal).
- Socket events: `state`, `metadata`, `server-settings`, `devices-get`, `device-set`, `device-action`, `device-api`, `lyrics-*`, `features-settings` (fork).
- Metadata field names used by the UI: `trackMetaData["dc:title"|"dc:subtitle"|"upnp:artist"|"upnp:album"|"upnp:albumArtURI"|"song:bitrate"|"song:format_s"|"song:rate_hz"|"song:quality"|"song:actualQuality"]`, plus `RelTime`, `TrackDuration`, `PlayMedium`, `TrackSource`, `CurrentTransportState`, `metadataTimeStamp`. State: `CurrentTransportState`, `RelTime`, `TrackDuration`, `PlayMedium`, `stateTimeStamp`.

## Commands
```
npm install                      # server deps
node server/index.js             # run (PORT=3000 to avoid :80); DEBUG=* for logs
npm run client-build             # rebuild client into server/public (do this before committing client changes)
npm test                         # jest, server only
git fetch upstream && git rebase upstream/main   # pick up upstream releases
```
Always commit `server/public/` after a client build; the Pi runs from the committed build.

## Conventions
- Keep fork changes additive and localized so upstream rebases stay clean. New behaviour goes in new files or clearly marked blocks; don't reformat upstream code.
- Client settings: add the element id to `WNP.s.aServerUI`, guard with `if (WNP.r.<id>)`, persist via `features-settings`.
- Server settings: add defaults under `serverSettings.features.<name>` in `server/index.js`; `lib.saveSettings` persists the whole `features` object.
- No external CSS/JS beyond what upstream already loads from CDN.

## Adding a clock theme from an example image
1. Pick `kind` (digital / analog / segment — segment = SVG seven-segment digits drawn by `WNP.renderSegments`, options `separator: "dot"|"colon"`, `skew`, `ghost` (unlit segment opacity), `ampm`, `aux` (temperature or date readout)), a Google Font family, and a colour preset (add one to `WNP.clockColors` if needed).
2. Add the entry to `WNP.clockThemes` (`name`, `kind`, `font`, `colors`, `dial`, `numerals: "arabic"|"quarters"|"none"`).
   Analog extras: `brandY`/`subY` for dial-text position; colour presets may add `face`, `hand`, `inset` (white alarm-clock style).
3. Add `#wnpClock[data-theme="<id>"] { … }` in `wnp.scss` for geometry only (sizes, weights, hand shapes, tick visibility). Colours/fonts must stay on the CSS variables so the override switch keeps working.
4. `npm run client-build`, check on `/` with Settings › Display › Show clock after = 0.

## Known gaps / next steps
- Weather is untested against the live Open-Meteo API from the dev sandbox (network-blocked there); the request URLs follow the documented v1 forecast/geocoding endpoints.
- Jellyfin `MediaStreams` field names for bit depth / sample rate are unverified against a real server; check one `/Sessions` response.
- WiiM LinkPlay `mode` code for native Plex playback not known; only matters for the source icon.
- Verify HDMI/optical detection: `PlayMedium` values seen so far are `HDMI`, `OPTICAL`, `LINE-IN`, `BLUETOOTH` (list in `WNP.startClock`).
- Possible: a dedicated 4:3 layout for the 2480×1860 panel (art left, text right) — currently the responsive upstream layout is used.
- Possible: tap zones on the clock/TV view for prev/pause/next.

## Deployment target
Raspberry Pi OS Lite (Bookworm, 64-bit) on Pi 4, Node 20+, upstream's kiosk docs (cage/Chromium). Panel: Wisecoco 8" AMOLED 2480×1860 via HDMI board (EDID expected; fallback `hdmi_cvt` in README of the earlier Python prototype).
