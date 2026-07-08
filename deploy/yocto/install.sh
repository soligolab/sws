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

# ── Uninstall ─────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    require_root
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

# Seed the env file only on the very first install so upgrades never clobber
# the operator's credentials.
if [ ! -f "$SWS_HOME/runtime.env" ]; then
    echo "==> Seeding $SWS_HOME/runtime.env (first install)..."
    cat > "$SWS_HOME/runtime.env" <<'ENVEOF'
# SWS runtime credentials and options (Pixsys device).
# Sourced by /data/user/sws/sws-runtime-launch.sh at startup.
# Changes take effect after: systemctl restart sws-runtime

SWS_ADMIN_USER=admin
SWS_ADMIN_PASSWORD=admin

# Uncomment to enable additional roles (empty = account disabled):
# SWS_SUPERVISOR_PASSWORD=
# SWS_OPERATOR_PASSWORD=
# SWS_VIEWER_PASSWORD=
ENVEOF
    chmod 600 "$SWS_HOME/runtime.env"
    echo ""
    echo "    *** IMPORTANT: change SWS_ADMIN_PASSWORD in $SWS_HOME/runtime.env ***"
    echo ""
else
    echo "    $SWS_HOME/runtime.env already exists — credentials preserved."
fi

echo "==> Installing systemd service..."
install -m 644 "$SCRIPT_DIR/sws-runtime.service" "$SERVICE_FILE"

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
echo "==> Installation complete."
echo "    Viewer  (operators):  https://$(hostname -I | awk '{print $1}'):8443"
echo "    Admin   (IDE):        https://$(hostname -I | awk '{print $1}'):8444"
echo "    Logs:                 journalctl -u $SERVICE_NAME -f"
echo "    Config:               $SWS_HOME/runtime.env"
echo "    Projects:             $SWS_HOME/projects/"
echo ""
echo "    First login: admin / admin"
echo "    Change the default password immediately via the admin UI."
