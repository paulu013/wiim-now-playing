# Fork additions: Plex + Jellyfin sessions, clock, OLED care

Upstream: https://github.com/cvdlinden/wiim-now-playing (GPL-3.0). Everything upstream still works as before.

## What's new

**Sources (Settings › Sources)** — `server/lib/external.js`
- Polls Plex `/status/sessions` and Jellyfin `/Sessions` every 2 s.
- A playing session is rendered by the existing UI (title, artist, album + year, art, codec badge, bitrate, Plex star rating, "on <player>" subtitle). No client rendering changes needed: the module emits `state`/`metadata` in the same shape as the UPnP client.
- Priority: by default the WiiM wins while it is PLAYING and Plex/Jellyfin fill in otherwise. Switch to "the Plex/Jellyfin session" in Settings if you want them to override.
- Optional player/device filter (comma-separated names) so sessions in other rooms are ignored.
- Config is saved in `server/settings.json`; env vars override: `PLEX_URL`, `PLEX_TOKEN`, `PLEX_PLAYERS`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_PLAYERS`, `EXTERNAL_PRIORITY`.
- Plex played natively on the WiiM already shows via the WiiM's own metadata; this adds sessions on other players.

**Clock (Settings › Display)** — `WNP.startClock()` in `client/src/js/wnp.js`
- Full-screen black clock after N seconds of nothing playing (default 10). Works on `/` and `/tv`.
- Optionally also while HDMI/optical/line-in/Bluetooth is active (with a small "TV audio via hdmi" note).
- Drift: the clock moves ±20 px every minute (OLED burn-in).
- Blank after N idle minutes (0 = never): page goes fully black; any playback wakes it.

## Files touched
- `server/index.js` — wires `external.js` (io proxy, start/stop with client count, `features-settings` socket event, clock/external defaults)
- `server/lib/external.js` — new
- `client/src/js/wnp.js` — clock, settings wiring, source-name fallback, codec badge, rating
- `client/src/index.html`, `client/src/tv.html` — clock overlay; Display and Sources settings tabs
- `client/src/scss/wnp.scss` — clock and blank styles
- `server/public/` — rebuilt client

## Run
Same as upstream (`npm install && node server/index.js`, or Docker). Set env vars or fill in Settings › Sources.
On the Pi: upstream's kiosk docs apply unchanged; for a 2480×1860 panel nothing extra is needed, the layout is responsive.
