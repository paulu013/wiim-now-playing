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

The kiosk is provisioned by one idempotent script, `deploy/pi/install.sh`. It installs the
cage + Chromium kiosk, optional presence / volume-knob companion services, display tweaks, and
auto-update / cleanup / hardening — all driven by a config file that keeps the URL and any secrets
out of git.

### Quick setup
1. Flash Raspberry Pi OS Lite (Bookworm 64-bit), enable SSH, boot, log in.
2. Get this repo onto the Pi (the fork is private, so clone with your credentials — a bare
   `curl … raw.githubusercontent.com | bash` won't authenticate):
   ```bash
   git clone https://github.com/paulu013/wiim-now-playing.git
   cd wiim-now-playing
   ```
3. Create the config from the example and set at least `WNP_URL`:
   ```bash
   cp deploy/pi/wnp-kiosk.conf.example /boot/firmware/wnp-kiosk.conf
   sudoedit /boot/firmware/wnp-kiosk.conf   # set WNP_URL=http://<docker-host>:8099/tv
   ```
   (You can also drop `wnp-kiosk.conf` onto the FAT boot partition from another machine before first
   boot.) The real `wnp-kiosk.conf` is gitignored; only the `.example` is committed.
4. Run the installer and reboot:
   ```bash
   sudo deploy/pi/install.sh
   sudo reboot
   ```
Re-run `sudo deploy/pi/install.sh` any time to apply config changes.

### What the config controls (`deploy/pi/wnp-kiosk.conf.example`)
- `WNP_URL`, `KIOSK_USER` — required basics (URL is the `/tv` route).
- `PRESENCE_ENABLED`, `VOLUME_KNOB_ENABLED` — install/enable the companion services (default off).
- `AUTO_UPDATES` (+ `NIGHTLY_REBOOT`) — unattended-upgrades with **both** Debian and Raspberry Pi
  origins (so Chromium is patched too), a nightly reboot window, journald cap, and fstrim.
- `HARDEN_SSH` / `HARDEN_UFW` (+ `ADMIN_CIDR`) — opt-in, default off to avoid lockout. UFW allows SSH
  only from `ADMIN_CIDR`.
- Note: auto-updates need a writable root, so don't enable overlayfs at the same time; a USB-SSD boot
  avoids SD wear.

### Presence sensor (optional — turns the panel off when the room is empty)
Wire an **HLK LD2410** over UART: `VCC`→5V (pin 2), `GND`→GND (pin 6), `TX`→GPIO15/RXD (pin 10),
`RX`→GPIO14/TXD (pin 8). Set `PRESENCE_ENABLED=1` (install.sh sets `enable_uart=1`). It is **safe with
no sensor attached** — the daemon just idles. Behaviour is also toggleable at runtime in
**Settings › Display › Presence sensor** (enable, power-off vs blank, off-delay). `PRESENCE_MODE`:
- `power-off` — `wlr-randr --off/--on` (best for OLED). Verify the driver board sleeps without a
  "No Signal" OSD; if it doesn't, use `app-blank`.
- `app-blank` — paints the browser black (no HDMI signal loss).

Best-effort dog rejection: aim the sensor at seated-human height and tune `PRESENCE_ZONE_*` /
`PRESENCE_ENERGY_MIN` (see the plan / `deploy/pi/wnp-kiosk.conf.example`).

### Wireless volume knob (optional)
An off-the-shelf HID knob (e.g. **Anticater VK-01** in 2.4 GHz-dongle mode, or **Fosi Audio VOL20**
over Bluetooth) connects to the **Pi** (the WiiM's Bluetooth is audio-only and can't host it). Set
`VOLUME_KNOB_ENABLED=1`; the shim grabs the device and forwards rotate/click to WiiM volume/transport
via the server. Toggle + step in **Settings › Display › Wireless volume knob**. Safe with no knob
attached.

### Display (Wisecoco 8" AMOLED, 2480×1860)
Rely on EDID first. If the mode is wrong, add a custom mode in `/boot/firmware/config.txt`
(`hdmi_cvt` / `hdmi_timings`; timings are in the older Python-prototype README). install.sh sets
`consoleblank=0`.

### OLED care
In Settings enable clock drift, night shift, and "blank after N minutes". Use the `/tv` route
(clean fullscreen). The kiosk points at `.../tv`.

### Manual setup (fallback, without install.sh)
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
