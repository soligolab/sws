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
exec "$SWS_INSTALL/bin/sws-runtime" \
    --config         "$SWS_DATA/config" \
    --projects-root  "$SWS_DATA/projects" \
    --templates-root "$SWS_INSTALL/templates" \
    --www            "$SWS_INSTALL/www" \
    --viewer-port    8443 \
    --admin-port     8444 \
    "${NO_ADMIN_ARGS[@]}"
