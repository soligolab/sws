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
#   /etc/sws/           — runtime.env credentials file     (writable by admin)
#   /etc/systemd/system/sws-runtime.service

set -euo pipefail

INSTALL_DIR=/opt/sws
DATA_DIR=/var/lib/sws
CONF_DIR=/etc/sws
ENV_FILE="$CONF_DIR/runtime.env"
SERVICE_NAME=sws-runtime
SERVICE_FILE=/etc/systemd/system/${SERVICE_NAME}.service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
    [ "$(id -u)" -eq 0 ] || die "Run as root:  sudo $0 $*"
}

# ── Uninstall ─────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    require_root
    echo "==> Stopping and disabling $SERVICE_NAME..."
    systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
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
for f in bin/sws-runtime bin/sws-runtime-launch.sh www/index.html sws-runtime.service; do
    [ -e "$SCRIPT_DIR/$f" ] || die "Missing file: $SCRIPT_DIR/$f — run from the unpacked tarball."
done

echo "==> Creating directories..."
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/www" "$INSTALL_DIR/templates"
mkdir -p "$DATA_DIR/config" "$DATA_DIR/projects"
mkdir -p "$CONF_DIR"

echo "==> Installing binary and launch wrapper..."
install -m 755 "$SCRIPT_DIR/bin/sws-runtime"          "$INSTALL_DIR/bin/sws-runtime"
install -m 755 "$SCRIPT_DIR/bin/sws-runtime-launch.sh" "$INSTALL_DIR/bin/sws-runtime-launch.sh"

echo "==> Installing web assets..."
rm -rf "$INSTALL_DIR/www"
cp -r  "$SCRIPT_DIR/www" "$INSTALL_DIR/www"

echo "==> Installing templates..."
rm -rf "$INSTALL_DIR/templates"
cp -r  "$SCRIPT_DIR/templates" "$INSTALL_DIR/templates"

echo "==> Installing systemd service..."
cp "$SCRIPT_DIR/sws-runtime.service" "$SERVICE_FILE"

# Seed the env file only on the very first install so that subsequent
# upgrades never clobber the operator's credentials.
if [ ! -f "$ENV_FILE" ]; then
    echo "==> Seeding $ENV_FILE (first install)..."
    cat > "$ENV_FILE" <<'ENVEOF'
# SWS runtime credentials and options.
# Sourced by /opt/sws/bin/sws-runtime-launch.sh at startup.
# Changes take effect after: systemctl restart sws-runtime

SWS_ADMIN_USER=admin
SWS_ADMIN_PASSWORD=admin

# Uncomment to enable additional roles (empty = account disabled):
# SWS_SUPERVISOR_PASSWORD=
# SWS_OPERATOR_PASSWORD=
# SWS_VIEWER_PASSWORD=
ENVEOF
    chmod 600 "$ENV_FILE"
    echo ""
    echo "    *** IMPORTANT: change SWS_ADMIN_PASSWORD in $ENV_FILE ***"
    echo ""
else
    echo "    $ENV_FILE already exists — credentials preserved."
fi

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
if curl -sk https://localhost:8443/health 2>/dev/null | grep -q '"status":"ok"' \
    || curl -s http://localhost:8443/health 2>/dev/null | grep -q '"status":"ok"'; then
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
    echo "    Viewer  (operators):  $SCHEME://$a:8443"
    echo "    Admin   (IDE):        $SCHEME://$a:8444"
done
echo "    Logs:                 journalctl -u $SERVICE_NAME -f"
echo "    Config:               $ENV_FILE"
echo "    Projects:             $DATA_DIR/projects/"
echo ""
echo "    First login: admin / admin"
echo "    Change the default password immediately via the admin UI."
