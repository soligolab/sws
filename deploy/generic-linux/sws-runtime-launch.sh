#!/usr/bin/env sh
#
# Launch wrapper for sws-runtime on generic Linux systems.
# Installed at /opt/sws/bin/sws-runtime-launch.sh and invoked by
# sws-runtime.service.
#
# Edit /etc/sws/runtime.env to override credentials and options.
# The installer seeds runtime.env on first install only — it is never
# overwritten on subsequent upgrades.

set -eu

SWS_INSTALL=/opt/sws
SWS_DATA=/var/lib/sws

# Source environment overrides if present (key=value lines, no export needed).
if [ -f /etc/sws/runtime.env ]; then
    # shellcheck disable=SC1091
    . /etc/sws/runtime.env
fi

# Defaults — change SWS_ADMIN_PASSWORD in /etc/sws/runtime.env before
# going live. Leaving it as "admin" is only safe on an isolated network.
: "${SWS_ADMIN_USER:=admin}"
: "${SWS_ADMIN_PASSWORD:=admin}"
export SWS_ADMIN_USER SWS_ADMIN_PASSWORD

# Optional additional roles. Empty string disables the account.
: "${SWS_SUPERVISOR_PASSWORD:=}"
: "${SWS_OPERATOR_PASSWORD:=}"
: "${SWS_VIEWER_PASSWORD:=}"
export SWS_SUPERVISOR_PASSWORD SWS_OPERATOR_PASSWORD SWS_VIEWER_PASSWORD

exec "$SWS_INSTALL/bin/sws-runtime" \
    --config         "$SWS_DATA/config" \
    --projects-root  "$SWS_DATA/projects" \
    --templates-root "$SWS_INSTALL/templates" \
    --www            "$SWS_INSTALL/www"
