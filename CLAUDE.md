# CLAUDE.md — wiim-now-playing (paulu013 fork)

Private fork of https://github.com/cvdlinden/wiim-now-playing (GPL-3.0). Upstream is `upstream`, this fork is `origin`.
Goal: a now-playing display on a TV cabinet for a WiiM Ultra, on a Raspberry Pi 4 driving a Wisecoco 8" 2480×1860 AMOLED (4:3) over HDMI, Chromium kiosk.

## Fork additions (see FORK.md for the full description)
- `server/lib/external.js` — Plex `/status/sessions` + Jellyfin `/Sessions` polling. Emits `state`/`metadata` in the UPnP shape the client already renders. Handles **music and video** (movie/episode) with per-type field mapping (movie→director/year, episode→show/"Season·Episode"). Priority `wiim` (default) or `external`. Filter by device (`players`) and/or **user** (`users`: Plex username / Jellyfin user). `artwork` setting `backdrop` (default) | `poster` | `still` chooses `upnp:albumArtURI`; also emits `wnp:kind` `wnp:logo` (clear logo) `wnp:artwork` `wnp:controllable`. `external.control(action)` does remote play/pause/stop/next/previous (Jellyfin Sessions API; Plex Companion best-effort, needs a controllable client) via the `external-action` socket event. Env overrides: `PLEX_URL/TOKEN/PLAYERS/USERS`, `JELLYFIN_URL/API_KEY/PLAYERS/USERS`, `EXTERNAL_PRIORITY`.
- `server/lib/weather.js` — Open-Meteo current temp + 3-day forecast + sunrise/sunset; free-text location geocoded once and cached in `features.weather.lat/lon/name`. Emits socket `weather` (with a clear `error` when enabled but no location); `weather-get` forces a refresh. `features.weather.showLabel` toggles the condition text (icon+temp only when off); condition labels localised (nl/de/fr) client-side via `WNP.wxLabels`.
- Colours: `WNP.colorRoles` (role list + which clock kinds show them), `WNP.clockColors` (presets with all roles), `WNP.effectiveColors(theme)` = preset ∪ `features.clock.colors.custom`; night dimming via `WNP.dimHex` (RGB multiply); scheme helper `WNP.schemeColors`. Server merge replaces `colors.custom` wholesale so resets stick.
- Night shift: `features.display.nightShift`; `WNP.applyNightShift()` runs every tick, `WNP.nightShiftActive()` evaluates the schedule, `WNP.nightShiftColor()` maps warmth/brightness to the overlay colour.
- Clock themes: `WNP.clockThemes` / `WNP.clockColors` / `WNP.clockFonts` in `wnp.js`, applied by `WNP.applyClockTheme()` via CSS variables (`--clock-font/bg/fg/fg2/accent`) on `#wnpClock`; per-theme geometry in `wnp.scss` under `#wnpClock[data-theme=…]`. Analog dial is inline SVG (`#clockDial`), ticks/numerals generated in JS (recreated in `startClock` since the build strips empty SVG nodes — see [[build-strips-empty-svg]]). Seven-segment themes use the bundled **DSEG7 Classic** font (`client/src/fonts/`, `@font-face` in wnp.scss) drawn as text by `WNP.renderSegments`; slant = `features.clock.segmentSlant` (italic face). Day/night switching in `WNP.isNight()`. Mini clock `#wnpMiniClock`. Colon is static (no per-second blink). Clock visibility = `.visible` class (never `d-none` after init); entrance/exit transition from `data-transition`; **drift moves `.wnpClockInner` only (not the background)** via `--drift`. Clock config is cached in `localStorage` (`wnpClockCfg`) and used before `server-settings` arrives so the right theme/locale render on the first frame (no flash). Clock shows immediately at boot when nothing is playing; top toolbar auto-hides and fades in on movement (`body.controls-active`). Swipe/tap handling at the end of `WNP.startClock()`. `features.clock.locale` drives `toLocaleDateString`.
- Now-playing extras (`wnp.js`/`wnp.scss`): **fluent progress bar** — `WNP.renderProgress` interpolates the played position locally between polls (anchor in `WNP.d.progAnchor`, monotonic guard, CSS width glide, no extra API calls). **Backdrop-hero / poster / still** artwork for external video: `#wnpHero` full-bleed backdrop (two crossfading `<img>` layers) + optional clear logo; `body.wnp-hero` / `body.wnp-art-{backdrop,poster,still}` drive the layout (large left-aligned title, hidden device line, source logo bottom-right). Track changes fade/slide in via `.wnp-enter`. External transport: prev/play/next + `#btnStop` shown (shuffle/repeat hidden) via `body.wnp-external`, routed to `external-action`.
- `server/index.js` — `ioDev = external.wrapIo(io, …)` proxy so device emits are suppressed while an external session is shown; `features-settings` and `external-action` socket events; sends current state/metadata to every freshly connected client; defaults for `features.clock` and `features.external`.
- `client/src/js/wnp.js` — `WNP.startClock()` (clock overlay, drift, idle blank), Display/Sources settings wiring (Sources fields not clobbered by broadcasts while the modal is open), codec badge cases, Plex star rating on the album line, source-name text fallback when no icon.
- `client/src/index.html`, `client/src/tv.html` — `#wnpClock` overlay, `#wnpHero` backdrop; Display and Sources tabs (index only).
- `client/src/scss/wnp.scss` — `#wnpClock`, `body.wnp-blank`, `#wnpHero`, DSEG `@font-face`, `body.wnp-external` / `body.wnp-art-*` layouts.

## Architecture (upstream, unchanged)
- Server: Express + Socket.IO, `server/index.js`. Finds the WiiM via SSDP (`lib/ssdp.js`), polls UPnP AVTransport every 1 s for state and every 4 s for metadata (`lib/upnpClient.js`), LinkPlay HTTP API for volume/presets (`lib/httpApi.js`). Polling only runs while ≥1 client is connected. Settings persist in `server/settings.json` (`lib/lib.js` saveSettings/getSettings; `features` is shallow-merged).
- Client: vanilla JS + Bootstrap 5, built with Parcel from `client/src/` into `server/public/` (committed). `WNP.r` holds element refs (ids listed in `WNP.s.aDeviceUI` / `aServerUI`; missing ids are tolerated, so `/tv` can omit the settings modal).
- Socket events: `state`, `metadata`, `server-settings`, `devices-get`, `device-set`, `device-action`, `device-api`, `lyrics-*`, `features-settings` (fork), `external-action` (fork), `weather`/`weather-get` (fork).
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
1. Pick `kind` (digital / analog / segment — segment = the bundled DSEG7 Classic font (`client/src/fonts/`, `@font-face` in wnp.scss) rendered by `WNP.renderSegments`; per-theme options `ghost` (faint all-segments layer opacity) and `ampm`; the slant is the global user setting `features.clock.segmentSlant` = italic DSEG face; weather shows as icons via `#clockWeather`, not segment digits), a Google Font family, and a colour preset (add one to `WNP.clockColors` if needed).
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

## Deployment (see `deploy/README.md` for full steps)
Architecture: **server in the homelab** (Portainer, server VLAN) + **WiiM in the IOT VLAN** + a
**Raspberry Pi as a pure Chromium kiosk** (Wisecoco 8" AMOLED 2480×1860 via HDMI) pointed at the
homelab URL's `/tv` route.
- **Image:** `.github/workflows/docker-publish.yml` builds `docker/Dockerfile` (which builds *this
  fork* from the repo context — no upstream clone) multi-arch (amd64+arm64) → **private**
  `ghcr.io/paulu013/wiim-now-playing` via `GITHUB_TOKEN` on push to `main`/tags. Pull needs a
  `read:packages` PAT (add as a Portainer registry).
- **Cross-VLAN WiiM without SSDP:** set `WIIM_LOCATION` (the device descriptor URL, e.g.
  `http://<wiim-ip>:49152/description.xml`) — `server/index.js` selects the device directly via
  `upnp.getDeviceDescription` and skips SSDP; all WiiM comms are then unicast (UPnP ~TCP 49152 +
  LinkPlay HTTPS 443), which routes across VLANs. Firewall: allow Docker host → WiiM 49152/443;
  DHCP-reserve the WiiM. (Fallback for same-L2 auto-discovery: omit `WIIM_LOCATION`, use
  `network_mode: host`, allow UDP 1900 — or an SSDP `multicast-relay`.) The WiiM *Home app* uses
  mDNS (`_linkplay._tcp`, Avahi reflector) — a different protocol than this SSDP/UPnP app.
- **Config/secrets:** a gitignored `.env` (`docker/.env.example`) supplies `WIIM_LOCATION`, Plex/
  Jellyfin URL+token/key+users, `EXTERNAL_PRIORITY`; env overrides the UI (`getConfig`) so secrets
  stay out of `settings.json`. Data volume `/app/data`. Default `PORT` 80 (compose maps `8099:80`).
- **Homelab stack:** `deploy/homelab/nowplaying/` → copy into the `paulu013/homelab` repo as
  `docker/nowplaying/` (own stack folder; bridge net + published port, optional Traefik labels —
  never behind Authentik, the kiosk can't SSO).
- **Kiosk Pi:** Raspberry Pi OS Lite (Bookworm 64-bit), `cage` + Chromium via a systemd unit (see
  `deploy/README.md`); AMOLED via EDID, fallback `hdmi_cvt`/`hdmi_timings` in `config.txt`,
  `consoleblank=0`; enable clock drift / night shift / idle-blank for OLED care.
