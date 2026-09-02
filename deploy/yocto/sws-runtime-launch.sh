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

# ── L'IDE sul dispositivo è un caso particolare, non il default ──────────────
#
# Decisione del maintainer (2026-09-02). `--no-admin` **non toglie il Deploy**:
# la porta admin resta e serve solo la gestione remota che l'editor chiama
# (deploy, pull, backup, utenti, datastore), tutto autenticato. Cade l'IDE —
# nessuna interfaccia servita, nessuna modifica del progetto sul dispositivo,
# nessun `/api/script/exec`, nessun `/api/fs/*`. Vedi `deploy_only_app` in
# `sws-web/src/router.rs` e OPEN_QUESTIONS Q8.
#
# Per riaccendere l'IDE completo su questo dispositivo — messa in servizio,
# assistenza — basta `SWS_ENABLE_IDE=1` nell'env del servizio e un restart.
NO_ADMIN_ARGS=(--no-admin)
case "${SWS_ENABLE_IDE:-}" in
    1|true|yes|on) NO_ADMIN_ARGS=()
        echo "[sws] SWS_ENABLE_IDE: IDE COMPLETO abilitato su questo dispositivo" >&2 ;;
esac

# Runtime role: viewer operatori (8443) + porta di gestione remota (8444).
# Without --viewer-port the viewer never binds and this would be IDE-only.
exec "$SWS_HOME/sws-runtime" \
    --config         "$SWS_HOME/config" \
    --projects-root  "$SWS_HOME/projects" \
    --templates-root "$SWS_HOME/templates" \
    --www            "$SWS_HOME/www" \
    --viewer-port    8443 \
    --admin-port     8444 \
    "${NO_ADMIN_ARGS[@]}"
