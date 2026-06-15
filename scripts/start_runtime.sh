#!/usr/bin/env bash
#
# Avvia il runtime SWS sul dispositivo (panel, server, Raspberry Pi, ecc.).
#
#   8443 — viewer per operatori e kiosk (RuntimeViewer SPA)
#   8444 — IDE/admin remoto (App SPA + API admin complete)
#
# Un ingegnere può collegarsi a https://<ip>:8444 dal proprio PC per gestire
# il progetto da remoto, oppure usare start_editor.sh in locale e "Connetti
# runtime" dalla ConfigView per deployare.
#
# Uso:
#   ./scripts/start_runtime.sh                # instance 1: 8443/8444, dati .run/
#   ./scripts/start_runtime.sh --instance 2   # instance 2: 8445/8446, dati .run-2/
#
# Variabili d'ambiente (opzionali):
#   SWS_ADMIN_USER / SWS_ADMIN_PASSWORD   per creare un utente admin all'avvio
#   RUST_LOG=debug   per log verbosi

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse --instance N ────────────────────────────────────────────────────────
INSTANCE=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) INSTANCE="$2"; shift 2 ;;
    *) echo "uso: $0 [--instance N]" >&2; exit 2 ;;
  esac
done

# ── Porte e directory per-istanza ─────────────────────────────────────────────
VIEWER_PORT=$((8443 + (INSTANCE - 1) * 2))
ADMIN_PORT=$((8444  + (INSTANCE - 1) * 2))
HTTP_PORT=$((8080   + (INSTANCE - 1)))

if [ "$INSTANCE" -eq 1 ]; then
  RUN_DIR="$REPO_ROOT/.run"
else
  RUN_DIR="$REPO_ROOT/.run-$INSTANCE"
fi

CONFIG_DIR="$RUN_DIR/config"
PROJECTS_ROOT="$RUN_DIR/projects"
TEMPLATES_ROOT="$REPO_ROOT/examples/templates"
LOG_DIR="$RUN_DIR/logs"

# Debian Bookworm non ha /usr/bin/python, solo python3.
if [ -z "${PYO3_PYTHON:-}" ] && command -v python3 >/dev/null 2>&1; then
  export PYO3_PYTHON=python3
fi

mkdir -p "$CONFIG_DIR" "$PROJECTS_ROOT" "$LOG_DIR"

# ── Pulizia processi stale sulle porte di questa istanza ──────────────────────
stop_existing() {
  local killed=0

  # NON uccidiamo cargo build: Cargo usa file lock e gestisce da solo la
  # concorrenza. Un pkill globale ammazzerebbe la build di un'altra istanza.

  for variant in debug release; do
    if pgrep -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" >/dev/null 2>&1; then
      if fuser "${VIEWER_PORT}/tcp" "${ADMIN_PORT}/tcp" >/dev/null 2>&1; then
        echo "[cleanup] fermo sws-runtime ($variant) su porte $VIEWER_PORT/$ADMIN_PORT…"
        pkill -TERM -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" 2>/dev/null || true
        local i
        for i in $(seq 1 6); do
          pgrep -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" >/dev/null 2>&1 || break
          sleep 0.5
        done
        pkill -KILL -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" 2>/dev/null || true
        killed=1
      fi
    fi
  done

  if [ "$killed" -eq 1 ]; then sleep 0.3; fi
  fuser -k "${VIEWER_PORT}/tcp" "${ADMIN_PORT}/tcp" 2>/dev/null || true
  sleep 0.3
}

# ── Build + avvio ─────────────────────────────────────────────────────────────
stop_existing

echo "[runtime] build (cargo build -p sws-runtime -j 1)…"
echo "[runtime]  (in attesa del file lock se un altro build è in corso)"
(cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime -j 1)

# ── Build frontend se dist manca o è più vecchio dei sorgenti ────────────────
# Lo script ricompila sempre il backend ma servirebbe un dist/ stantio: questo
# evita di mostrare una SPA vecchia (es. login dopo un aggiornamento no-auth).
ensure_frontend_built() {
  local dist="$REPO_ROOT/sws-editor/dist"
  local marker="$dist/index-admin.html"
  if [ ! -f "$marker" ] || [ -n "$(find "$REPO_ROOT/sws-editor/src" -newer "$marker" -print -quit 2>/dev/null)" ]; then
    echo "[runtime] frontend: dist assente o più vecchio dei sorgenti → pnpm build…"
    (cd "$REPO_ROOT/sws-editor" && pnpm build)
  else
    echo "[runtime] frontend: dist aggiornato — skip build"
  fi
}
ensure_frontend_built

WWW_DIST="$REPO_ROOT/sws-editor/dist"
WWW_ARGS=()
if [ -f "$WWW_DIST/index.html" ]; then
  WWW_ARGS=(--www "$WWW_DIST")
  echo "[runtime] SPA da $WWW_DIST"
else
  echo "[runtime] ATTENZIONE: $WWW_DIST non trovata — solo API"
  echo "[runtime]   Costruisci con: cd sws-editor && pnpm build"
fi

# Auto-apertura del progetto: NON passiamo --project. Il runtime, mono-progetto,
# riapre da solo l'ultimo progetto attivo (marker .active-project) oppure, in
# mancanza, l'unico progetto presente sotto projects-root.
PROJECT_ARGS=()

# IP LAN per il banner
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LAN_IP" ] && LAN_IP="<ip-dispositivo>"

INST_LABEL=""
[ "$INSTANCE" -ne 1 ] && INST_LABEL=" (istanza $INSTANCE)"

# Passa --http-port solo se il cert è già presente (TLS mode).
# Senza cert il runtime parte in plain HTTP — il companion è inutile.
HTTP_ARGS=()
if [ -f "$CONFIG_DIR/tls.crt" ]; then
  HTTP_ARGS=(--http-port "$HTTP_PORT")
  cat <<MSG

────────────────────────────────────────────────────────────────
SWS Runtime$INST_LABEL — pronto (HTTPS)

  Viewer operatori : https://$LAN_IP:$VIEWER_PORT
  IDE/Admin        : https://$LAN_IP:$ADMIN_PORT

  Primo accesso (cert non ancora accettato nel browser):
    http://$LAN_IP:$HTTP_PORT  ← apri qui prima di usare gli URL sopra

  Stop: Ctrl-C
────────────────────────────────────────────────────────────────

MSG
else
  cat <<MSG

────────────────────────────────────────────────────────────────
SWS Runtime$INST_LABEL — pronto (HTTP)

  Viewer operatori : http://$LAN_IP:$VIEWER_PORT
  IDE/Admin        : http://$LAN_IP:$ADMIN_PORT

  Per abilitare HTTPS: IDE → ConfigView → Stato → Certificato TLS
  Stop: Ctrl-C
────────────────────────────────────────────────────────────────

MSG
fi

exec "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
  --config         "$CONFIG_DIR"         \
  --projects-root  "$PROJECTS_ROOT"      \
  --templates-root "$TEMPLATES_ROOT"     \
  --viewer-port    "$VIEWER_PORT"        \
  --admin-port     "$ADMIN_PORT"         \
  "${HTTP_ARGS[@]}"                      \
  "${PROJECT_ARGS[@]}"                   \
  "${WWW_ARGS[@]}"
