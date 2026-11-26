#!/usr/bin/env bash
#
# SWS runtime installer for Pixsys Yocto devices (systemd required).
# Run as root from the unpacked tarball directory on the device.
#
# Pixsys boxes have a read-only root filesystem (squashfs/ubifs), so unlike the
# generic-linux installer this one installs under /data/user/sws — the writable
# operator partition — NOT /opt. This mirrors the in-place layout produced by
# scripts/yocto/deploy.sh, but as a self-contained tarball installer.
#
# Usage:
#   sudo ./install.sh            # install or upgrade
#   sudo ./install.sh --uninstall
#
# Paths used:
#   /data/user/sws/                       — binary, launch wrapper, www, templates, data
#   /data/user/sws/runtime.env            — credentials (seeded once, never clobbered)
#   /etc/systemd/system/sws-runtime.service

set -euo pipefail

SWS_HOME=/data/user/sws
SERVICE_NAME=sws-runtime
SERVICE_FILE=/etc/systemd/system/${SERVICE_NAME}.service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }
require_root() { [ "$(id -u)" -eq 0 ] || die "Run as root:  sudo $0 $*"; }

# ── firewalld (Pixsys OS 2.2.0, 26-11-2026) ───────────────────────────────────
# The system runs firewalld, and the Pixsys zone opens its own services but not
# the ports of SWS: from the network the panel did not answer ("No route to
# host"). Open 7443 and 7444 in the zones with a network card (or in the default
# zone), at once and permanently, without `--reload`. Without firewalld, do
# nothing; without the permission, show the command and continue.
SWS_FIREWALL_PORTS="7443/tcp 7444/tcp"
firewall_sws_zones() {
    local z
    z="$(firewall-cmd --get-active-zones 2>/dev/null | awk '/^[^ \t]/{z=$1} /interfaces:/{print z}')"
    [ -n "$z" ] || z="$(firewall-cmd --get-default-zone 2>/dev/null)"
    echo "$z"
}
firewall_running() {
    command -v firewall-cmd >/dev/null 2>&1 && [ "$(firewall-cmd --state 2>/dev/null)" = running ]
}
open_firewall_ports() {
    firewall_running || return 0
    local zone port
    for zone in $(firewall_sws_zones); do
        for port in $SWS_FIREWALL_PORTS; do
            firewall-cmd --zone="$zone" --query-port="$port" >/dev/null 2>&1 && continue
            if firewall-cmd --zone="$zone" --add-port="$port" >/dev/null 2>&1 \
               && firewall-cmd --permanent --zone="$zone" --add-port="$port" >/dev/null 2>&1; then
                echo "    firewall: $port open in zone $zone"
            else
                echo "    WARNING: firewalld does not let this user open $port in zone $zone." >&2
                echo "    As root: firewall-cmd --permanent --zone=$zone --add-port=$port && firewall-cmd --reload" >&2
            fi
        done
    done
}
close_firewall_ports() {
    firewall_running || return 0
    local zone port
    for zone in $(firewall-cmd --get-zones 2>/dev/null); do
        for port in $SWS_FIREWALL_PORTS; do
            firewall-cmd --zone="$zone" --remove-port="$port" >/dev/null 2>&1 || true
            firewall-cmd --permanent --zone="$zone" --remove-port="$port" >/dev/null 2>&1 || true
        done
    done
    echo "    firewall: the ports of SWS are closed"
}

# ── Uninstall ─────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    require_root
    close_firewall_ports
    echo "==> Stopping and disabling $SERVICE_NAME..."
    systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    echo ""
    echo "NOTE: project data in $SWS_HOME is kept."
    echo "      Remove it manually for a clean wipe:  sudo rm -rf $SWS_HOME"
    exit 0
fi

# ── Install / upgrade ─────────────────────────────────────────────────────────

require_root

# Verify required files are present next to this script.
for f in bin/sws-runtime bin/sws-runtime-launch.sh www/index.html sws-runtime.service; do
    [ -e "$SCRIPT_DIR/$f" ] || die "Missing file: $SCRIPT_DIR/$f — run from the unpacked tarball."
done

echo "==> Creating directories under $SWS_HOME ..."
mkdir -p "$SWS_HOME/config" "$SWS_HOME/projects" "$SWS_HOME/templates" "$SWS_HOME/www"

echo "==> Installing binary and launch wrapper..."
# The Yocto launch wrapper execs "$SWS_HOME/sws-runtime" (flat layout).
install -m 755 "$SCRIPT_DIR/bin/sws-runtime"           "$SWS_HOME/sws-runtime"
install -m 755 "$SCRIPT_DIR/bin/sws-runtime-launch.sh" "$SWS_HOME/sws-runtime-launch.sh"

echo "==> Installing web assets..."
rm -rf "$SWS_HOME/www"
cp -r  "$SCRIPT_DIR/www" "$SWS_HOME/www"

echo "==> Installing templates..."
rm -rf "$SWS_HOME/templates"
cp -r  "$SCRIPT_DIR/templates" "$SWS_HOME/templates"

echo "==> Installing the device catalog..."
rm -rf "$SWS_HOME/catalogo"
[ -d "$SCRIPT_DIR/catalogo" ] && cp -r "$SCRIPT_DIR/catalogo" "$SWS_HOME/catalogo"

# Seed the env file only on the very first install so upgrades never clobber
# the operator's settings.
if [ ! -f "$SWS_HOME/runtime.env" ]; then
    echo "==> Seeding $SWS_HOME/runtime.env (first install)..."
    cat > "$SWS_HOME/runtime.env" <<'ENVEOF'
# SWS runtime options (Pixsys device).
# Sourced by /data/user/sws/sws-runtime-launch.sh at startup.
# Changes take effect after: systemctl restart sws-runtime
#
# No default password (18-11-2026, CRA D18): the runtime waits for its
# pairing code, printed at the end of the installation, in the log and on
# the screen, and whoever types it chooses the first Admin's password.
#
# A recovery account, only for a project that has no users (optional):
# SWS_ADMIN_USER=admin
# SWS_ADMIN_PASSWORD=
ENVEOF
    chmod 600 "$SWS_HOME/runtime.env"
else
    echo "    $SWS_HOME/runtime.env already exists — settings preserved."
    # The factory value of the installers before 18-11-2026 goes: it is not
    # someone's credential, it is the one everybody knows.
    if grep -qx 'SWS_ADMIN_PASSWORD=admin' "$SWS_HOME/runtime.env"; then
        sed -i 's/^SWS_ADMIN_PASSWORD=admin$/# SWS_ADMIN_PASSWORD=admin  (factory value, switched off by the installer: the runtime pairs with its code)/' "$SWS_HOME/runtime.env"
        echo "    factory password admin/admin switched off in $SWS_HOME/runtime.env"
    fi
fi

echo "==> Installing systemd service..."
install -m 644 "$SCRIPT_DIR/sws-runtime.service" "$SERVICE_FILE"

# The runtime runs as `user`, not root (CRA D19, 18-11-2026): the folder is
# its, including what a root runtime of the installations before created.
id user >/dev/null 2>&1 || die "the user 'user' does not exist: this installer is for PixsysOS"
chown -R user: "$SWS_HOME"

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

echo ""
echo "==> Firewall"
open_firewall_ports

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
for a in $IPS; do
    echo "    Viewer  (operators):  https://$a:7443"
    echo "    Admin   (IDE):        https://$a:7444"
done
echo "    Logs:                 journalctl -u $SERVICE_NAME -f"
echo "    Config:               $SWS_HOME/runtime.env"
echo "    Projects:             $SWS_HOME/projects/"
# The pairing code (CRA D18): the first access, instead of admin/admin. From
# the operator page's port on this machine, the only one shown it (D16).
code=""
for _ in $(seq 1 15); do
    # `|| true` inside: under `set -euo pipefail` a runtime not listening yet
    # would end the script here, before the code and before the retry.
    code="$(curl -sk --max-time 2 "https://127.0.0.1:7443/api/abbinamento" 2>/dev/null \
        || curl -s --max-time 2 "http://127.0.0.1:7443/api/abbinamento" 2>/dev/null || true)"
    code="$(printf '%s' "$code" | sed -n 's/.*"codice":"\([0-9A-Z-]*\)".*/\1/p')"
    [ -n "$code" ] && break
    sleep 1
done
echo ""
if [ -n "$code" ]; then
    echo "    Pairing code: $code"
    echo "    Type it in the IDE («Connect») or on the panel's page, with the user"
    echo "    and password of the first Admin. The panel's screen shows it too."
else
    echo "    The pairing code is on the screen and in: journalctl -u $SERVICE_NAME | grep -i abbinamento"
    echo "    (none if the runtime already has users)"
fi
