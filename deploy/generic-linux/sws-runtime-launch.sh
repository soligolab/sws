#!/usr/bin/env bash
#
# bash, not sh (22-11-2026): the script uses arrays (NO_ADMIN_ARGS), and where
# /bin/sh is dash (Debian, Ubuntu) it stopped with «Syntax error: "(" unexpected»
# before starting the runtime. It was declared sh since 363e79ce.
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

# No default password (18-11-2026, decision D18 of the CRA sessions): until
# 18-11 an empty project received `admin`/`admin` from here. A fresh install
# now waits for its pairing code, like the container: the installer, the log
# and the device's screen show it, and whoever types it chooses the first
# Admin's password. `SWS_ADMIN_PASSWORD` in the env file stays a recovery
# account for a project with no users, and only when set there.
if [ -n "${SWS_ADMIN_PASSWORD:-}" ]; then
    : "${SWS_ADMIN_USER:=admin}"
    export SWS_ADMIN_USER SWS_ADMIN_PASSWORD
fi

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

# The version this install declares (22-11-2026): the package's VERSIONE file
# (`2.27.0-dev.3 (abc1234)`; the runtime keeps the first word). No longer
# compiled into the binary: sws_core::project::runtime_version.
if [ -f "$SWS_INSTALL/VERSIONE" ]; then
    SWS_VERSION="$(cut -d' ' -f1 "$SWS_INSTALL/VERSIONE")"
    export SWS_VERSION
fi

# Runtime role: viewer operatori (7443) + porta di gestione remota (7444).
# Without --viewer-port the viewer never binds and this would be IDE-only.
exec "$SWS_INSTALL/bin/sws-runtime" \
    --config         "$SWS_DATA/config" \
    --projects-root  "$SWS_DATA/projects" \
    --templates-root "$SWS_INSTALL/templates" \
    --catalog-root "$SWS_INSTALL/catalogo/dispositivi" \
    --www            "$SWS_INSTALL/www" \
    --viewer-port    7443 \
    --admin-port     7444 \
    "${NO_ADMIN_ARGS[@]}"
