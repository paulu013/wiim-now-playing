#!/usr/bin/env python3
"""
WiiM Now Playing — wireless volume-knob shim.

An off-the-shelf HID volume knob (e.g. Anticater VK-01 in 2.4 GHz-dongle mode, or
Fosi Audio VOL20 over Bluetooth) pairs with the Pi as a standard multimedia input
device. By default its keys would move the Pi's own (unused) audio; this shim
grabs the device and instead forwards the events to the now-playing server, which
maps them to WiiM volume/transport over the LinkPlay API.

Design goals:
  * OPTIONAL / never fatal. If python-evdev is missing or no knob is attached, the
    shim logs once and idles (retrying) — it never crashes or affects the kiosk.
  * Web-toggle aware. Honours features.volumeKnob from server settings (enabled +
    action map), falling back to local config.
"""

import os
import sys
import time

LOG_PREFIX = "volume-knob:"


def log(*args):
    print(LOG_PREFIX, *args, flush=True)


def env(name, default=""):
    return os.environ.get(name, default)


def env_int(name, default):
    try:
        return int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


WNP_URL = env("WNP_URL", "")
NAME_MATCH = env("VOLUME_KNOB_MATCH", "").strip().lower()
LOCAL_ENABLED = env("VOLUME_KNOB_ENABLED", "0") == "1"
STEP = env_int("VOLUME_KNOB_STEP", 3)

settings = {"enabled": LOCAL_ENABLED, "step": STEP}

# Default HID key -> action map. Overridable via features.volumeKnob.map.
DEFAULT_MAP = {
    "KEY_VOLUMEUP": "vol-up",
    "KEY_VOLUMEDOWN": "vol-down",
    "KEY_MUTE": "mute",
    "KEY_PLAYPAUSE": "play-pause",
    "KEY_NEXTSONG": "next",
    "KEY_PREVIOUSSONG": "previous",
}
action_map = dict(DEFAULT_MAP)

sio = None


def _connect_socket():
    global sio
    if not WNP_URL:
        log("WNP_URL not set; cannot forward knob events")
        return
    try:
        import socketio  # type: ignore
    except ImportError:
        log("python-socketio not installed; knob disabled. Install python3-socketio.")
        return
    origin = WNP_URL.split("/tv")[0].rstrip("/") or WNP_URL
    sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)

    @sio.event
    def connect():
        log("connected to server", origin)
        sio.emit("server-settings")

    @sio.on("server-settings")
    def on_server_settings(msg):
        try:
            vk = (msg or {}).get("features", {}).get("volumeKnob", {})
            if isinstance(vk, dict):
                if vk.get("enabled") is not None:
                    settings["enabled"] = vk["enabled"]
                if vk.get("step"):
                    settings["step"] = vk["step"]
                if isinstance(vk.get("map"), dict):
                    action_map.update(vk["map"])
                log("settings from server:", settings)
        except Exception as exc:  # noqa: BLE001
            log("ignoring bad server-settings:", exc)

    try:
        sio.connect(origin, wait=False)
    except Exception as exc:  # noqa: BLE001
        log("server not reachable (will keep retrying):", exc)


def send(action):
    if sio is None or not sio.connected:
        log("dropped (no server):", action)
        return
    try:
        sio.emit("knob-action", {"action": action, "step": settings.get("step", STEP)})
    except Exception as exc:  # noqa: BLE001
        log("knob-action emit failed:", exc)


def find_knob(evdev):
    """Return the first input device that looks like a volume/media knob, or None."""
    from evdev import ecodes
    for path in evdev.list_devices():
        try:
            dev = evdev.InputDevice(path)
        except Exception:  # noqa: BLE001
            continue
        if NAME_MATCH and NAME_MATCH not in dev.name.lower():
            continue
        caps = dev.capabilities().get(ecodes.EV_KEY, [])
        if ecodes.KEY_VOLUMEUP in caps or ecodes.KEY_VOLUMEDOWN in caps:
            return dev
    return None


def run():
    _connect_socket()
    try:
        import evdev  # type: ignore
        from evdev import categorize, ecodes  # noqa: F401
    except ImportError:
        log("python-evdev not installed; knob idle. Install python3-evdev.")
        _idle_forever()
        return

    while True:
        dev = find_knob(evdev)
        if dev is None:
            log("no volume knob found; idle, retrying in 20s")
            time.sleep(20)
            continue

        log("using knob:", dev.name, "(%s)" % dev.path)
        try:
            dev.grab()  # stop the events from also moving the Pi's ALSA volume
        except Exception as exc:  # noqa: BLE001
            log("could not grab device (continuing ungrabbed):", exc)

        try:
            for event in dev.read_loop():
                if event.type != evdev.ecodes.EV_KEY or event.value != 1:
                    continue  # key-down only
                if not settings.get("enabled", False):
                    continue  # disabled in the web UI
                keyname = evdev.ecodes.KEY.get(event.code)
                names = keyname if isinstance(keyname, list) else [keyname]
                for n in names:
                    if n in action_map:
                        send(action_map[n])
                        break
        except OSError as exc:
            log("knob disconnected (%s); rescanning" % exc)
            time.sleep(3)
        except Exception as exc:  # noqa: BLE001
            log("read error (%s); rescanning" % exc)
            time.sleep(3)


def _idle_forever():
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        sys.exit(0)
