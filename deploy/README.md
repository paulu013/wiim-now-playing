# Deployment: homelab server + Raspberry Pi kiosk

Architecture: the **server** runs in the homelab (Portainer, server VLAN); the **WiiM** lives in the
IOT VLAN; a **Raspberry Pi** is a pure Chromium kiosk pointed at the homelab URL. The server reaches
the WiiM over **unicast** via `WIIM_LOCATION` (no SSDP/multicast, no reflector) — see the repo root
`CLAUDE.md` and `server/index.js`.

## 1. Build & publish the image (this repo)
Pushing to `main` runs `.github/workflows/docker-publish.yml`, which builds `docker/Dockerfile`
multi-arch (amd64 + arm64) and pushes a **private** package to `ghcr.io/paulu013/wiim-now-playing`.
Verify: `docker manifest inspect ghcr.io/paulu013/wiim-now-playing:latest`.

## 2. Homelab stack (paulu013/homelab repo)
Copy `deploy/homelab/nowplaying/` into the homelab repo as `docker/nowplaying/`, create the real
`.env` from `.env.example` on the host, then in Portainer:
- **Registries** → add GHCR (`ghcr.io`, user `paulu013`, a `read:packages` PAT) so it can pull.
- **Stacks → Add stack → Git repository** → path `docker/nowplaying/docker-compose.yml`.

Find the WiiM descriptor URL for `WIIM_LOCATION` (give the WiiM a DHCP reservation first):
```
curl http://<wiim-ip>:49152/description.xml   # LinkPlay is usually port 49152
```

## 3. Firewall (pfSense now, OPNsense later)
Only unicast is needed (discovery is bypassed):
- **server VLAN (Docker host) → IOT (WiiM):** allow TCP **49152** (UPnP/AVTransport) and **443** (LinkPlay).
- **kiosk Pi → server:** allow the Pi's VLAN → `<docker-host>:8099` (or your Traefik host).
- **Docker host → internet:** Open-Meteo (weather) + `ghcr.io` (image pull).
- (Your Avahi `_linkplay._tcp` mDNS reflector is for the WiiM *Home app*; this app doesn't use mDNS.)

Fallback if you ever want SSDP auto-discovery instead of `WIIM_LOCATION`: run an SSDP reflector
(`multicast-relay`) for `239.255.255.250:1900` with a leg in each VLAN, set the container to
`network_mode: host`, and also allow UDP 1900.

## 4. Kiosk Pi (Raspberry Pi OS Lite, Bookworm 64-bit)
```bash
sudo apt update
sudo apt install --no-install-recommends cage chromium seatd
sudo systemctl enable seatd
```
Create `/etc/systemd/system/kiosk.service` (adjust the URL to your server):
```ini
[Unit]
Description=WiiM Now Playing kiosk (cage + Chromium)
After=network-online.target
Wants=network-online.target

[Service]
User=pi
Environment=WNP_URL=http://<docker-host>:8099/tv
ExecStart=/usr/bin/cage -- /usr/bin/chromium \
  --kiosk --noerrdialogs --disable-infobars --incognito \
  --check-for-update-interval=31536000 --ozone-platform=wayland \
  --app=${WNP_URL}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable kiosk
sudo systemctl start kiosk
```

### Display (Wisecoco 8" AMOLED, 2480×1860)
Rely on EDID first. If the mode is wrong, add a custom mode in `/boot/firmware/config.txt`
(`hdmi_cvt` / `hdmi_timings`; timings are in the older Python-prototype README). Also set
`consoleblank=0` — the app handles turning the panel off.

### OLED care
In Settings enable clock drift, night shift, and "blank after N minutes". Use the `/tv` route
(clean fullscreen). The kiosk points at `.../tv`.
