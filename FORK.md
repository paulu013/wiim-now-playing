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
- **Clear logo instead of the title** (`features.external.clearLogo`, default **on**): when a clear logo is available for the album / show / movie it replaces the plain-text title in the now-playing view (standard, poster and backdrop layouts). Sources are Plex `clearLogo` (from the item's `Image[]` array) and Jellyfin `Logo` (series logo for episodes, item logo for movies, album logo for music). Emitted as `wnp:logo`; the client shows it as `#mediaTitleLogo` and falls back to the title text if the logo image fails to load. Toggle in Settings › Sources ("Show the clear logo instead of the title").

**Clock (Settings › Display)** — `WNP.startClock()` in `client/src/js/wnp.js`
- Full-screen black clock after N seconds of nothing playing (default 10). Works on `/` and `/tv`.
- Optionally also while HDMI/optical/line-in/Bluetooth is active (with a small "TV audio via hdmi" note).
- Drift: the clock moves ±20 px every minute (OLED burn-in).
- Blank after N idle minutes (0 = never): page goes fully black; any playback wakes it.

**Clock themes, weather, overlay (Settings › Display)**
- Themes live in `WNP.clockThemes` (client) + optional `[data-theme]` geometry blocks in `wnp.scss`. Fonts (Google Fonts, loaded on demand) and colour presets (`WNP.clockColors`) come from the theme; "Overrule" lets the user pick any font/colour preset instead. Dial text (brand / sub label, e.g. "Paulus / Quartz") is shown on themes with `dial: true`.
- Built-in: digital-minimal, digital-mono, digital-serif, digital-flip, analog-classic, analog-bauhaus, analog-night, analog-alarm (white dial, yellow cap), segment-bedside (seven-segment, dot, slanted), segment-alarm (seven-segment, colon, AM/PM, temperature/date readout). Seven-segment digits are SVG, not a font. Adding one from an example image: add an entry (kind, font, colours, numerals) and a small SCSS block.
- Day/night: separate day and night theme, switched at sunset/sunrise from the weather data (fallback 07:00–19:00).
- Weather via Open-Meteo (`server/lib/weather.js`, no API key): outside temperature and/or 3-day forecast, location as free text (geocoded once and cached in settings), °C/°F, polled every 10 min.
- Mini clock over the now-playing view: on/off, corner, size.
- Language for date/day names (English, Dutch, German, French; add more `<option>`s in the Display tab).
- Colours per role (background, gradient end, dial face, digits/numerals/ticks, secondary text, hour/minute hands, hand inset, second hand/accent): every theme has defaults, each role has a colour picker with a reset; presets ("Apply preset to all roles") as starting points, including a light "Daylight" one; scheme helper (base colour + mono/complementary/analogous/triadic fills digits, secondary, accent); optional gradient background; night dimming percentage applied between sunset and sunrise (weather) or 19:00–07:00.
- Swipe to reveal the clock while playing: gesture (right→left, left→right, either), transition (slide from right, slide from left, crossfade — also used when the clock appears by itself), auto-return after N seconds (0 = stay). Swipe back or tap the clock to return.

**Night shift (Settings › Display, whole screen)**
- Page-wide warm tint + dimming overlay (`#wnpNightShift`, multiply blend so black stays black; sits above modals like a phone's night mode). Schedule: sunset→sunrise (weather location, fallback 19:00–07:00), custom from/to (may cross midnight), or always. Colour-temperature slider 0–100, brightness 20–100 %. Live preview while dragging. Stored in `features.display.nightShift`.

## Files touched
- `server/index.js` — wires `external.js` (io proxy, start/stop with client count, `features-settings` socket event, clock/external defaults)
- `server/lib/external.js` — new
- `server/lib/weather.js` — new
- `client/src/js/wnp.js` — clock, settings wiring, source-name fallback, codec badge, rating
- `client/src/index.html`, `client/src/tv.html` — clock overlay; Display and Sources settings tabs
- `client/src/scss/wnp.scss` — clock and blank styles
- `server/public/` — rebuilt client

## Run
Same as upstream (`npm install && node server/index.js`, or Docker). Set env vars or fill in Settings › Sources.
On the Pi: upstream's kiosk docs apply unchanged; for a 2480×1860 panel nothing extra is needed, the layout is responsive.
