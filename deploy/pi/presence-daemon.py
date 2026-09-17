#!/usr/bin/env python3
"""
WiiM Now Playing — presence daemon.

Reads an HLK LD2410 mmWave sensor over UART and powers the kiosk panel on when a
person is in the room, off when it has been empty for a grace period.

Design goals (see deploy/README.md and the plan):
  * OPTIONAL / never fatal. If pyserial is missing, the serial port is absent, or
    no valid frames arrive, the daemon logs once and idles — it must never
    crash-loop or affect the kiosk.
  * Web-toggle aware. It connects to the now-playing server (if python-socketio is
    available) and honours features.presence from server settings, falling back to
    the local EnvironmentFile config when the server is unreachable.
  * Two "off" modes:
      power-off  -> wlr-randr (cage/Wayland) or vcgencmd, real HDMI power down.
      app-blank  -> tell the browser to paint black via a socket 'presence-report'.
  * Best-effort dog rejection via a distance-zone + energy threshold (tune on hw).

Config comes from the environment (systemd EnvironmentFile=/etc/wnp-kiosk.conf).
"""

import os
import sys
import time
import glob
import subprocess

LOG_PREFIX = "presence-daemon:"


def log(*args):
    print(LOG_PREFIX, *args, flush=True)


def env(name, default=""):
    return os.environ.get(name, default)


def env_int(name, default):
    try:
        return int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


# --- Configuration (local fallback; may be overridden by server settings) -----
WNP_URL = env("WNP_URL", "")
SERIAL_DEV = env("PRESENCE_SERIAL", "/dev/serial0")
SERIAL_BAUD = env_int("PRESENCE_BAUD", 256000)
LOCAL_ENABLED = env("PRESENCE_ENABLED", "0") == "1"
OFF_DELAY_SEC = env_int("PRESENCE_OFF_DELAY_SEC", 45)
MODE = env("PRESENCE_MODE", "power-off")
OUTPUT = env("PRESENCE_OUTPUT", "")
ZONE_MIN_CM = env_int("PRESENCE_ZONE_MIN_CM", 50)
ZONE_MAX_CM = env_int("PRESENCE_ZONE_MAX_CM", 450)
ENERGY_MIN = env_int("PRESENCE_ENERGY_MIN", 40)

# Runtime state that server settings can override (see _on_server_settings).
settings = {
    "enabled": LOCAL_ENABLED,
    "mode": MODE,
    "offDelaySec": OFF_DELAY_SEC,
    "zoneMinCm": ZONE_MIN_CM,
    "zoneMaxCm": ZONE_MAX_CM,
    "energyMin": ENERGY_MIN,
}


# --- Optional socket.io link to the server ------------------------------------
sio = None


def _connect_socket():
    """Connect to the now-playing server for settings + app-blank reporting.
    Optional: absence of python-socketio or the server is non-fatal."""
    global sio
    if not WNP_URL:
        return
    try:
        import socketio  # type: ignore
    except ImportError:
        log("python-socketio not installed; running from local config only")
        return
    # Derive the socket origin from the /tv URL.
    origin = WNP_URL.split("/tv")[0].rstrip("/") or WNP_URL
    sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)

    @sio.event
    def connect():
        log("connected to server", origin)
        sio.emit("server-settings")  # request current settings

    @sio.on("server-settings")
    def on_server_settings(msg):
        try:
            pres = (msg or {}).get("features", {}).get("presence", {})
            if isinstance(pres, dict):
                for k in ("enabled", "mode", "offDelaySec",
                          "zoneMinCm", "zoneMaxCm", "energyMin"):
                    if k in pres and pres[k] is not None:
                        settings[k] = pres[k]
                log("settings from server:", settings)
        except Exception as exc:  # noqa: BLE001 - never let a bad message kill us
            log("ignoring bad server-settings:", exc)

    try:
        sio.connect(origin, wait=False)
    except Exception as exc:  # noqa: BLE001
        log("server not reachable (will keep retrying):", exc)


# --- Display power -------------------------------------------------------------
_display_on = True  # assume the panel starts on


def _wayland_env():
    """Build an environment that can reach the cage compositor for wlr-randr."""
    e = dict(os.environ)
    runtime = e.get("XDG_RUNTIME_DIR", "/run/user/1000")
    e["XDG_RUNTIME_DIR"] = runtime
    if "WAYLAND_DISPLAY" not in e:
        socks = sorted(glob.glob(os.path.join(runtime, "wayland-*")))
        socks = [s for s in socks if not s.endswith(".lock")]
        if socks:
            e["WAYLAND_DISPLAY"] = os.path.basename(socks[0])
    return e


def _run(cmd, env_override=None):
    try:
        subprocess.run(cmd, check=True, env=env_override,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception as exc:  # noqa: BLE001
        log("command failed", cmd, exc)
        return False


def set_display(on):
    global _display_on
    if on == _display_on:
        return
    _display_on = on
    mode = settings.get("mode", "power-off")

    if mode == "app-blank":
        # Let the browser paint black; keep HDMI up (no "No Signal" OSD risk).
        if sio is not None and sio.connected:
            try:
                sio.emit("presence-report", {"occupied": on})
            except Exception as exc:  # noqa: BLE001
                log("presence-report emit failed:", exc)
        log("display", "ON" if on else "BLANK (app)")
        return

    # power-off mode: wlr-randr first (cage/Wayland), then vcgencmd as a fallback.
    e = _wayland_env()
    out = OUTPUT
    if not out:
        try:
            res = subprocess.run(["wlr-randr"], env=e, capture_output=True,
                                 text=True, timeout=5)
            for line in res.stdout.splitlines():
                if line and not line.startswith((" ", "\t")):
                    out = line.split()[0]
                    break
        except Exception:  # noqa: BLE001
            out = ""
    ok = False
    if out:
        ok = _run(["wlr-randr", "--output", out, "--on" if on else "--off"], e)
    if not ok:
        _run(["vcgencmd", "display_power", "1" if on else "0"])
    log("display", "ON" if on else "OFF", "(output=%s)" % (out or "?"))


# --- LD2410 frame parsing -----------------------------------------------------
FRAME_HEAD = b"\xf4\xf3\xf2\xf1"
FRAME_TAIL = b"\xf8\xf7\xf6\xf5"


def parse_frame(payload):
    """Parse the LD2410 target-data frame body (works for basic & engineering
    modes; both start with the same fields). Returns (state, move_cm, move_e,
    still_cm, still_e, detect_cm) or None."""
    # payload starts after the 2-byte length; expect 0xAA data head.
    # layout: [type:1][head:0xAA:1][state:1][move_dist:2][move_e:1]
    #         [still_dist:2][still_e:1][detect_dist:2] ...
    if len(payload) < 11:
        return None
    if payload[1] != 0xAA:
        return None
    state = payload[2]
    move_cm = payload[3] | (payload[4] << 8)
    move_e = payload[5]
    still_cm = payload[6] | (payload[7] << 8)
    still_e = payload[8]
    detect_cm = payload[9] | (payload[10] << 8)
    return state, move_cm, move_e, still_cm, still_e, detect_cm


def is_person(frame):
    """Apply the distance-zone + energy filter (best-effort dog rejection)."""
    state, move_cm, move_e, still_cm, still_e, _detect = frame
    if state == 0:
        return False
    zmin, zmax = settings["zoneMinCm"], settings["zoneMaxCm"]
    emin = settings["energyMin"]
    # A moving OR stationary target counts if it is in the seating band with
    # enough energy (a dog on the floor is nearer/lower-energy and filtered out).
    if move_e >= emin and zmin <= move_cm <= zmax:
        return True
    if still_e >= emin and zmin <= still_cm <= zmax:
        return True
    return False


def read_frames(ser):
    """Generator yielding parsed target frames from an open serial port."""
    buf = bytearray()
    while True:
        chunk = ser.read(64)
        if chunk:
            buf.extend(chunk)
        else:
            time.sleep(0.02)
        while True:
            h = buf.find(FRAME_HEAD)
            if h < 0:
                if len(buf) > 4096:
                    del buf[:-4]
                break
            t = buf.find(FRAME_TAIL, h + 4)
            if t < 0:
                if h > 0:
                    del buf[:h]
                break
            body = bytes(buf[h + 4:t])
            del buf[:t + 4]
            if len(body) >= 2:
                frame = parse_frame(body[2:])  # skip 2-byte length
                if frame:
                    yield frame


# --- Main loop ----------------------------------------------------------------
def run():
    _connect_socket()
    try:
        import serial  # type: ignore
    except ImportError:
        log("pyserial not installed; presence idle. Install python3-serial.")
        _idle_forever()
        return

    absent_since = None
    while True:
        try:
            ser = serial.Serial(SERIAL_DEV, SERIAL_BAUD, timeout=0.2)
        except Exception as exc:  # noqa: BLE001
            log("no LD2410 on %s (%s); idle, retrying in 30s" % (SERIAL_DEV, exc))
            time.sleep(30)
            continue

        log("LD2410 open on %s @ %d" % (SERIAL_DEV, SERIAL_BAUD))
        try:
            for frame in read_frames(ser):
                if not settings.get("enabled", False):
                    # Feature disabled in the web UI: keep the panel on, do nothing.
                    set_display(True)
                    absent_since = None
                    continue
                now = time.time()
                if is_person(frame):
                    absent_since = None
                    set_display(True)
                else:
                    if absent_since is None:
                        absent_since = now
                    elif now - absent_since >= settings.get("offDelaySec", 45):
                        set_display(False)
        except Exception as exc:  # noqa: BLE001
            log("serial read error (%s); reopening" % exc)
            try:
                ser.close()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(5)


def _idle_forever():
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        sys.exit(0)
