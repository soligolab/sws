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
#   SWS_ADMIN_USER / SWS_ADMIN_PASSWORD   (default: admin/admin)
#   SWS_SUPERVISOR_PASSWORD / SWS_OPERATOR_PASSWORD / SWS_VIEWER_PASSWORD
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

# Credenziali admin — vanno bene per lo sviluppo locale; sovrascrivere in produzione.
: "${SWS_ADMIN_USER:=admin}"
: "${SWS_ADMIN_PASSWORD:=admin}"
export SWS_ADMIN_USER SWS_ADMIN_PASSWORD

: "${SWS_SUPERVISOR_PASSWORD:=supervisor}"
: "${SWS_OPERATOR_PASSWORD:=operator}"
: "${SWS_VIEWER_PASSWORD:=viewer}"
export SWS_SUPERVISOR_PASSWORD SWS_OPERATOR_PASSWORD SWS_VIEWER_PASSWORD

mkdir -p "$CONFIG_DIR" "$PROJECTS_ROOT" "$LOG_DIR"

# ── Pulizia processi stale sulle porte di questa istanza ──────────────────────
stop_existing() {
  local killed=0

  if pkill -KILL -f "cargo build.*-p sws-runtime" 2>/dev/null; then
    echo "[cleanup] terminato cargo build residuo"
    killed=1
  fi

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
(cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime -j 1)

WWW_DIST="$REPO_ROOT/sws-editor/dist"
WWW_ARGS=()
if [ -f "$WWW_DIST/index.html" ]; then
  WWW_ARGS=(--www "$WWW_DIST")
  echo "[runtime] SPA da $WWW_DIST"
else
  echo "[runtime] ATTENZIONE: $WWW_DIST non trovata — solo API"
  echo "[runtime]   Costruisci con: cd sws-editor && pnpm build"
fi

# Auto-apre il progetto 'default' se esiste (evita "Nessun progetto attivo")
PROJECT_ARGS=()
if [ -d "$PROJECTS_ROOT/default" ]; then
  PROJECT_ARGS=(--project "$PROJECTS_ROOT/default")
  echo "[runtime] auto-apertura progetto: default"
fi

# IP LAN per il banner
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LAN_IP" ] && LAN_IP="<ip-dispositivo>"

INST_LABEL=""
[ "$INSTANCE" -ne 1 ] && INST_LABEL=" (istanza $INSTANCE)"

cat <<MSG

────────────────────────────────────────────────────────────────
SWS Runtime$INST_LABEL — pronto

  Primo accesso    : http://$LAN_IP:$HTTP_PORT   ← accetta il cert qui (no TLS)
  Viewer operatori : https://$LAN_IP:$VIEWER_PORT
  IDE/Admin        : https://$LAN_IP:$ADMIN_PORT

  Cert TLS: curl -k https://localhost:$VIEWER_PORT/cert -o sws.crt
  Stop: Ctrl-C

Per simulare un secondo dispositivo:
  ./scripts/start_runtime.sh --instance 2
────────────────────────────────────────────────────────────────

MSG

exec "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
  --config         "$CONFIG_DIR"         \
  --projects-root  "$PROJECTS_ROOT"      \
  --templates-root "$TEMPLATES_ROOT"     \
  --viewer-port    "$VIEWER_PORT"        \
  --admin-port     "$ADMIN_PORT"         \
  --http-port      "$HTTP_PORT"          \
  "${PROJECT_ARGS[@]}"                   \
  "${WWW_ARGS[@]}"
