#!/usr/bin/env bash
#
# SWS runtime installer for generic Linux x86_64 (systemd required).
# Run as root from the unpacked tarball directory, or from the repo root
# after running scripts/package.sh.
#
# Usage:
#   sudo ./install.sh            # install or upgrade
#   sudo ./install.sh --uninstall
#
# Paths used:
#   /opt/sws/           — binaries, web assets, templates  (read-only after install)
#   /var/lib/sws/       — project data, TLS config         (writable, persistent)
#   /etc/sws/           — runtime.env options file          (root, readable by sws)
#   /etc/systemd/system/sws-runtime.service
#   /etc/polkit-1/...   — what the control panel may change on the system
#
# The service runs as the system user `sws`, not root (18-11-2026, decision
# D19 of the CRA sessions), like the Tiny TY: the control panel gets network,
# time, reboot and power-off through the same polkit rule.

set -euo pipefail

INSTALL_DIR=/opt/sws
DATA_DIR=/var/lib/sws
CONF_DIR=/etc/sws
ENV_FILE="$CONF_DIR/runtime.env"
SERVICE_NAME=sws-runtime
SERVICE_FILE=/etc/systemd/system/${SERVICE_NAME}.service
SERVICE_USER=sws
POLKIT_PKLA=/etc/polkit-1/localauthority/50-local.d/50-sws-control-panel.pkla
POLKIT_RULES=/etc/polkit-1/rules.d/50-sws-control-panel.rules

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

# The control panel's initial PIN, as the runtime computes it
# (`control_panel/pin.rs`): the low six hex digits of the MAC of eth0, then
# ethernet0, then the first physical card in name order. Empty if none.
initial_pin() {
    local c
    for c in eth0 ethernet0 $(LC_ALL=C ls /sys/class/net 2>/dev/null); do
        [ -r "/sys/class/net/$c/address" ] || continue
        case "$c" in eth0|ethernet0) ;; *) [ -e "/sys/class/net/$c/device" ] || continue ;; esac
        local hex
        hex="$(tr -d ':\n' < "/sys/class/net/$c/address" | tr '[:upper:]' '[:lower:]')"
        [ ${#hex} -eq 12 ] && [ "$hex" != 000000000000 ] && { echo "${hex:6}"; return; }
    done
}

require_root() {
    [ "$(id -u)" -eq 0 ] || die "Run as root:  sudo $0 $*"
}

# ── Uninstall ─────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    require_root
    echo "==> Stopping and disabling $SERVICE_NAME..."
    systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE" "$POLKIT_PKLA" "$POLKIT_RULES"
    systemctl daemon-reload
    echo "==> Removing $INSTALL_DIR ..."
    rm -rf "$INSTALL_DIR"
    echo ""
    echo "NOTE: project data in $DATA_DIR and config in $CONF_DIR are kept."
    echo "      Remove them manually if you want a clean wipe:"
    echo "      sudo rm -rf $DATA_DIR $CONF_DIR"
    exit 0
fi

# ── Install / upgrade ─────────────────────────────────────────────────────────

require_root

# Verify required files are present next to this script.
for f in bin/sws-runtime bin/sws-runtime-launch.sh www/index.html sws-runtime.service polkit/50-sws-control-panel.rules; do
    [ -e "$SCRIPT_DIR/$f" ] || die "Missing file: $SCRIPT_DIR/$f — run from the unpacked tarball."
done

echo "==> Creating directories..."
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/www" "$INSTALL_DIR/templates"
mkdir -p "$DATA_DIR/config" "$DATA_DIR/projects"
mkdir -p "$CONF_DIR"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    echo "==> Creating the system user $SERVICE_USER..."
    useradd --system --home-dir "$DATA_DIR" --no-create-home \
        --shell /usr/sbin/nologin "$SERVICE_USER"
fi
# Serial ports for Modbus RTU: the unit gives the group too (SupplementaryGroups),
# this is for whoever runs the runtime by hand as `sws` for a test.
getent group dialout >/dev/null && usermod -aG dialout "$SERVICE_USER"
# The data were root's until 18-11-2026: an upgrade hands them over, or the
# runtime would not open its own projects any more.
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

echo "==> Installing the control panel's polkit rule..."
install -d -m 755 "$(dirname "$POLKIT_PKLA")" "$(dirname "$POLKIT_RULES")"
install -m 644 "$SCRIPT_DIR/polkit/50-sws-control-panel.pkla" "$POLKIT_PKLA"
install -m 644 "$SCRIPT_DIR/polkit/50-sws-control-panel.rules" "$POLKIT_RULES"

echo "==> Installing binary and launch wrapper..."
install -m 755 "$SCRIPT_DIR/bin/sws-runtime"          "$INSTALL_DIR/bin/sws-runtime"
install -m 755 "$SCRIPT_DIR/bin/sws-runtime-launch.sh" "$INSTALL_DIR/bin/sws-runtime-launch.sh"

echo "==> Installing web assets..."
rm -rf "$INSTALL_DIR/www"
cp -r  "$SCRIPT_DIR/www" "$INSTALL_DIR/www"

echo "==> Installing templates..."
rm -rf "$INSTALL_DIR/templates"
cp -r  "$SCRIPT_DIR/templates" "$INSTALL_DIR/templates"

echo "==> Installing the device catalog..."
rm -rf "$INSTALL_DIR/catalogo"
[ -d "$SCRIPT_DIR/catalogo" ] && cp -r "$SCRIPT_DIR/catalogo" "$INSTALL_DIR/catalogo"

echo "==> Installing systemd service..."
cp "$SCRIPT_DIR/sws-runtime.service" "$SERVICE_FILE"

# Seed the env file only on the very first install so that subsequent
# upgrades never clobber the operator's settings.
if [ ! -f "$ENV_FILE" ]; then
    echo "==> Seeding $ENV_FILE (first install)..."
    cat > "$ENV_FILE" <<'ENVEOF'
# SWS runtime options.
# Sourced by /opt/sws/bin/sws-runtime-launch.sh at startup.
# Changes take effect after: systemctl restart sws-runtime
#
# No default password: the runtime waits for its pairing code, printed at
# the end of the installation and in the log, and whoever types it chooses
# the first Admin's password.
#
# A recovery account, only for a project that has no users (optional):
# SWS_ADMIN_USER=admin
# SWS_ADMIN_PASSWORD=
ENVEOF
else
    echo "    $ENV_FILE already exists — settings preserved."
    # The factory value of the installers before 18-11-2026 goes: it is not
    # someone's credential, it is the one everybody knows.
    if grep -qx 'SWS_ADMIN_PASSWORD=admin' "$ENV_FILE"; then
        sed -i 's/^SWS_ADMIN_PASSWORD=admin$/# SWS_ADMIN_PASSWORD=admin  (factory value, switched off by the installer: the runtime pairs with its code)/' "$ENV_FILE"
        echo "    factory password admin/admin switched off in $ENV_FILE"
    fi
fi
# Root writes it, the service reads it.
chown "root:$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

echo "==> Reloading systemd and enabling $SERVICE_NAME..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# Restart if already running, otherwise start fresh.
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "==> Restarting $SERVICE_NAME (upgrade)..."
    systemctl restart "$SERVICE_NAME"
else
    echo "==> Starting $SERVICE_NAME..."
    systemctl start "$SERVICE_NAME"
fi

# Give the service a moment to start and verify it answers /health. TLS is
# opt-in (config/tls.crt) and never seeded by this installer, so a fresh
# install serves plain HTTP on this same port — only a device that already
# had TLS enabled in a previous run (config/ persists across upgrades)
# answers HTTPS. Try both instead of assuming one.
sleep 2
if curl -sk https://localhost:7443/health 2>/dev/null | grep -q '"status":"ok"' \
    || curl -s http://localhost:7443/health 2>/dev/null | grep -q '"status":"ok"'; then
    echo "==> Health check: OK"
else
    echo "    Health check did not respond yet — the service may still be starting."
    echo "    Check: journalctl -u $SERVICE_NAME -n 30"
fi

echo ""
echo "==> Installation complete."
# `hostname -I` è un'opzione di net-tools: dove /usr/bin/hostname è quello di
# coreutils (Pixsys OS, per esempio) fallisce, e con `set -euo pipefail` la
# sostituzione fallita abortiva lo script proprio su questo messaggio finale,
# a installazione già completata. `ip` c'è su qualunque Linux recente ed elenca
# tutti gli indirizzi, non solo il primo.
lan_ips() {
    ip -4 -o addr show scope global 2>/dev/null \
        | awk '{split($4,a,"/"); printf "%s ", a[1]}' || true
}
IPS="$(lan_ips)"; IPS="${IPS% }"; [ -n "$IPS" ] || IPS="localhost"
# Same opt-in TLS logic as the health check above: print the scheme that
# actually matches what the runtime will serve, not a hardcoded https that's
# wrong on every fresh install.
SCHEME=http
[ -f "$DATA_DIR/config/tls.crt" ] && SCHEME=https
for a in $IPS; do
    echo "    Viewer  (operators):  $SCHEME://$a:7443"
    echo "    Admin   (IDE):        $SCHEME://$a:7444"
done
echo "    Logs:                 journalctl -u $SERVICE_NAME -f"
echo "    Config:               $ENV_FILE"
echo "    Projects:             $DATA_DIR/projects/"
# The pairing code (CRA D18): the first access, instead of admin/admin. Asked
# from this machine on the operator page's port, the only place besides the
# screen and the log that is shown it (D16).
code=""
for _ in $(seq 1 15); do
    # `|| true` inside: under `set -euo pipefail` a runtime not listening yet
    # would end the script here, before the code and before the retry.
    code="$( { curl -sk --max-time 2 "$SCHEME://127.0.0.1:7443/api/abbinamento" 2>/dev/null || true; } \
        | sed -n 's/.*"codice":"\([0-9A-Z-]*\)".*/\1/p')"
    [ -n "$code" ] && break
    sleep 1
done
echo ""
if [ -n "$code" ]; then
    echo "    Pairing code: $code"
    echo "    Type it in the IDE («Connect») or on the runtime's page, with the user"
    echo "    and password of the first Admin. It is also in: journalctl -u $SERVICE_NAME"
else
    echo "    The pairing code is in the log: journalctl -u $SERVICE_NAME | grep -i abbinamento"
    echo "    (none if the runtime already has users)"
fi
pin="$(initial_pin)"
if [ -n "$pin" ]; then
    echo ""
    echo "    Device control panel: initial PIN $pin"
    echo "    (the last 6 digits of the MAC; it holds only from the device's own screen,"
    echo "    until the project sets its own PIN)"
fi
