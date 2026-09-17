#!/usr/bin/env bash
#
# WiiM Now Playing — Raspberry Pi kiosk provisioner.
#
# Idempotent: safe to re-run to pick up changes. Installs cage + Chromium kiosk,
# optional presence + volume-knob companion services, display tweaks, and
# auto-update / cleanup / hardening. Reads all site-specific values from a config
# file (never from git) — see deploy/pi/wnp-kiosk.conf.example.
#
# Usage (as root, from a clone of this repo):
#   sudo deploy/pi/install.sh [/path/to/wnp-kiosk.conf]
#
# Config is located in this order: $1, $WNP_CONF, /boot/firmware/wnp-kiosk.conf,
# /etc/wnp-kiosk.conf. It is copied to /etc/wnp-kiosk.conf for the services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPT_DIR="/opt/wnp"
ETC_CONF="/etc/wnp-kiosk.conf"

log()  { printf '\033[1;32m[wnp]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[wnp]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[wnp]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (sudo)."

# --- Locate & load config -----------------------------------------------------
CONF=""
for candidate in "${1:-}" "${WNP_CONF:-}" "/boot/firmware/wnp-kiosk.conf" "$ETC_CONF"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then CONF="$candidate"; break; fi
done
[ -n "$CONF" ] || die "No config found. Copy deploy/pi/wnp-kiosk.conf.example to /boot/firmware/wnp-kiosk.conf and edit it."
log "Using config: $CONF"
# shellcheck disable=SC1090
. "$CONF"

# Defaults for anything the config omits.
: "${WNP_URL:?WNP_URL must be set in the config}"
: "${KIOSK_USER:=pi}"
: "${PRESENCE_ENABLED:=0}"
: "${VOLUME_KNOB_ENABLED:=0}"
: "${AUTO_UPDATES:=1}"
: "${NIGHTLY_REBOOT:=04:00}"
: "${HARDEN_SSH:=0}"
: "${HARDEN_UFW:=0}"
: "${ADMIN_CIDR:=}"
: "${REBOOT_AFTER_INSTALL:=0}"

id "$KIOSK_USER" >/dev/null 2>&1 || die "KIOSK_USER '$KIOSK_USER' does not exist."
KIOSK_UID="$(id -u "$KIOSK_USER")"

# Persist the config where the services read it.
if [ "$CONF" != "$ETC_CONF" ]; then
    install -m 0644 "$CONF" "$ETC_CONF"
    log "Copied config to $ETC_CONF"
fi

# --- Packages -----------------------------------------------------------------
log "Installing base packages (cage, chromium, seatd)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends cage chromium seatd

PY_PKGS=()
[ "$PRESENCE_ENABLED" = "1" ]   && PY_PKGS+=(python3-serial python3-socketio)
[ "$VOLUME_KNOB_ENABLED" = "1" ] && PY_PKGS+=(python3-evdev python3-socketio)
if [ "${#PY_PKGS[@]}" -gt 0 ]; then
    # De-duplicate.
    mapfile -t PY_PKGS < <(printf '%s\n' "${PY_PKGS[@]}" | sort -u)
    log "Installing companion deps: ${PY_PKGS[*]}"
    apt-get install -y --no-install-recommends "${PY_PKGS[@]}"
fi
systemctl enable seatd >/dev/null 2>&1 || true

# --- Helper: append a line to a file only if missing ---------------------------
ensure_line() {  # ensure_line <file> <line>
    local file="$1" line="$2"
    touch "$file"
    grep -qxF "$line" "$file" || printf '%s\n' "$line" >> "$file"
}

# --- boot config.txt tweaks ---------------------------------------------------
BOOT_CFG="/boot/firmware/config.txt"
[ -f "$BOOT_CFG" ] || BOOT_CFG="/boot/config.txt"
if [ -f "$BOOT_CFG" ]; then
    log "Applying display tweaks to $BOOT_CFG"
    ensure_line "$BOOT_CFG" "consoleblank=0"
    if [ "$PRESENCE_ENABLED" = "1" ]; then
        ensure_line "$BOOT_CFG" "enable_uart=1"
    fi
else
    warn "config.txt not found; skipping display tweaks."
fi

# --- Kiosk service ------------------------------------------------------------
log "Installing kiosk.service"
install -m 0644 "$SCRIPT_DIR/kiosk.service" /etc/systemd/system/kiosk.service
if [ "$KIOSK_USER" != "pi" ]; then
    install -d /etc/systemd/system/kiosk.service.d
    cat > /etc/systemd/system/kiosk.service.d/override.conf <<EOF
[Service]
User=$KIOSK_USER
EOF
fi

# --- Companion services -------------------------------------------------------
install -d "$OPT_DIR"

install_companion() {  # install_companion <script> <unit> [extra_runtime_env]
    local script="$1" unit="$2" runtime_env="${3:-}"
    install -m 0755 "$SCRIPT_DIR/$script" "$OPT_DIR/$script"
    install -m 0644 "$SCRIPT_DIR/$unit" "/etc/systemd/system/$unit"
    install -d "/etc/systemd/system/$unit.d"
    {
        echo "[Service]"
        [ "$KIOSK_USER" != "pi" ] && echo "User=$KIOSK_USER"
        [ -n "$runtime_env" ] && echo "Environment=$runtime_env"
    } > "/etc/systemd/system/$unit.d/override.conf"
}

if [ "$PRESENCE_ENABLED" = "1" ]; then
    log "Installing presence daemon"
    install_companion presence-daemon.py presence.service "XDG_RUNTIME_DIR=/run/user/$KIOSK_UID"
else
    systemctl disable presence.service >/dev/null 2>&1 || true
fi

if [ "$VOLUME_KNOB_ENABLED" = "1" ]; then
    log "Installing volume-knob shim"
    install_companion volume-knob.py volume-knob.service
    usermod -aG input "$KIOSK_USER"
else
    systemctl disable volume-knob.service >/dev/null 2>&1 || true
fi

# --- Maintenance & hardening --------------------------------------------------
if [ "$AUTO_UPDATES" = "1" ]; then
    log "Configuring unattended-upgrades + cleanup"
    apt-get install -y --no-install-recommends unattended-upgrades
    cat > /etc/apt/apt.conf.d/51wnp-unattended <<'EOF'
Unattended-Upgrade::Origins-Pattern {
    "origin=Debian,codename=${distro_codename},label=Debian";
    "origin=Debian,codename=${distro_codename},label=Debian-Security";
    "origin=Raspberry Pi Foundation";
    "origin=Raspberry Pi Foundation,label=Raspberry Pi Foundation";
};
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
    cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
    if [ -n "$NIGHTLY_REBOOT" ]; then
        cat > /etc/apt/apt.conf.d/52wnp-reboot <<EOF
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "$NIGHTLY_REBOOT";
EOF
    fi
    # Cap the journal and enable periodic trim.
    install -d /etc/systemd/journald.conf.d
    printf '[Journal]\nSystemMaxUse=100M\n' > /etc/systemd/journald.conf.d/51wnp.conf
    systemctl enable fstrim.timer >/dev/null 2>&1 || true
fi

if [ "$HARDEN_SSH" = "1" ]; then
    log "Hardening SSH (password auth off)"
    install -d /etc/ssh/sshd_config.d
    printf 'PasswordAuthentication no\nChallengeResponseAuthentication no\n' \
        > /etc/ssh/sshd_config.d/51wnp.conf
    systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || true
fi

if [ "$HARDEN_UFW" = "1" ]; then
    if [ -z "$ADMIN_CIDR" ]; then
        warn "HARDEN_UFW=1 but ADMIN_CIDR is empty; skipping firewall to avoid lockout."
    else
        log "Enabling ufw (SSH allowed only from $ADMIN_CIDR)"
        apt-get install -y --no-install-recommends ufw
        ufw --force reset >/dev/null
        ufw default deny incoming >/dev/null
        ufw default allow outgoing >/dev/null
        ufw allow from "$ADMIN_CIDR" to any port 22 proto tcp >/dev/null
        ufw --force enable >/dev/null
    fi
fi

# --- Enable & report ----------------------------------------------------------
log "Reloading systemd + enabling services"
systemctl daemon-reload
systemctl enable kiosk.service >/dev/null
[ "$PRESENCE_ENABLED" = "1" ]    && systemctl enable presence.service   >/dev/null || true
[ "$VOLUME_KNOB_ENABLED" = "1" ] && systemctl enable volume-knob.service >/dev/null || true

log "Done."
log "  kiosk URL : $WNP_URL"
log "  user      : $KIOSK_USER (uid $KIOSK_UID)"
log "  presence  : $PRESENCE_ENABLED   volume-knob: $VOLUME_KNOB_ENABLED"
log "  auto-upd  : $AUTO_UPDATES   nightly-reboot: ${NIGHTLY_REBOOT:-off}"

if [ "$REBOOT_AFTER_INSTALL" = "1" ]; then
    log "Rebooting in 5s (REBOOT_AFTER_INSTALL=1)…"
    sleep 5
    reboot
else
    log "Reboot to start the kiosk:  sudo reboot"
fi
