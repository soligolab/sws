#!/usr/bin/env sh
#
# Launch wrapper for sws-runtime on Pixsys Yocto devices. Installed at
# /data/user/sws/sws-runtime-launch.sh by scripts/yocto/deploy.sh and invoked
# by sws-runtime.service.
#
# Edit /data/user/sws/runtime.env on the device to override the credentials below
# (the deploy script seeds runtime.env on first install only — never
# overwritten on subsequent deploys).

set -eu

SWS_HOME="/data/user/sws"

# Source environment overrides if present (key=value lines).
if [ -f "$SWS_HOME/runtime.env" ]; then
    # shellcheck disable=SC1091
    . "$SWS_HOME/runtime.env"
fi

# Defaults — DO NOT leave these in production. They exist so a fresh install
# answers /health and lets the operator log in to set a real password.
: "${SWS_ADMIN_USER:=admin}"
: "${SWS_ADMIN_PASSWORD:=admin}"
: "${SWS_HISTORIAN_DB:=$SWS_HOME/historian.db}"

export SWS_ADMIN_USER SWS_ADMIN_PASSWORD SWS_HISTORIAN_DB

# Optional other-role passwords. Empty disables the account.
: "${SWS_SUPERVISOR_PASSWORD:=}"
: "${SWS_OPERATOR_PASSWORD:=}"
: "${SWS_VIEWER_PASSWORD:=}"
export SWS_SUPERVISOR_PASSWORD SWS_OPERATOR_PASSWORD SWS_VIEWER_PASSWORD

exec "$SWS_HOME/sws-runtime" \
    --config         "$SWS_HOME/config" \
    --projects-root  "$SWS_HOME/projects" \
    --templates-root "$SWS_HOME/templates" \
    --www            "$SWS_HOME/www"
