#!/usr/bin/env bash
#
# Avvia l'IDE SWS in locale sul PC dello sviluppatore (solo porta 8460).
# Nessun viewer operatori — solo l'interfaccia di progettazione canvas.
#
# Di default parte in plain HTTP (nessun certificato necessario — localhost è
# sempre un "secure context" nei browser moderni). TLS si abilita da
# ConfigView → Stato → Certificato TLS dopo il primo avvio.
#
# Uso:
#   ./scripts/start_editor.sh                # IDE su 8460, dati .run/
#   ./scripts/start_editor.sh --instance 2   # IDE su 8462, dati .run-2/
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

# ── Porta IDE per-istanza (solo admin — nessun viewer) ────────────────────────
# Range separato dal runtime (8443-8449/8080-8089) per evitare conflitti
# quando entrambi girano sulla stessa macchina di sviluppo.
ADMIN_PORT=$((8460 + (INSTANCE - 1) * 2))

if [ "$INSTANCE" -eq 1 ]; then
  RUN_DIR="$REPO_ROOT/.run"
else
  RUN_DIR="$REPO_ROOT/.run-$INSTANCE"
fi

CONFIG_DIR="$RUN_DIR/config"
PROJECTS_ROOT="$RUN_DIR/projects"
TEMPLATES_ROOT="$REPO_ROOT/examples/templates"
LOG_DIR="$RUN_DIR/logs"

if [ -z "${PYO3_PYTHON:-}" ] && command -v python3 >/dev/null 2>&1; then
  export PYO3_PYTHON=python3
fi

mkdir -p "$CONFIG_DIR" "$PROJECTS_ROOT" "$LOG_DIR"

# ── Pulizia processi stale sulla porta IDE ────────────────────────────────────
stop_existing() {
  local killed=0

  # NON uccidiamo cargo build: Cargo usa file lock e gestisce da solo la
  # concorrenza. Un pkill globale ammazzerebbe la build di un'altra istanza.

  for variant in debug release; do
    if fuser "${ADMIN_PORT}/tcp" >/dev/null 2>&1; then
      if pgrep -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" >/dev/null 2>&1; then
        echo "[cleanup] fermo sws-runtime ($variant) su porta $ADMIN_PORT…"
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
  fuser -k "${ADMIN_PORT}/tcp" 2>/dev/null || true
  sleep 0.3
}

# ── Build + avvio ─────────────────────────────────────────────────────────────
stop_existing

echo "[editor] build (cargo build -p sws-runtime -j 1)…"
echo "[editor]  (in attesa del file lock se un altro build è in corso)"
(cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime -j 1)

WWW_DIST="$REPO_ROOT/sws-editor/dist"
WWW_ARGS=()
if [ -f "$WWW_DIST/index-admin.html" ]; then
  WWW_ARGS=(--www "$WWW_DIST")
  echo "[editor] SPA da $WWW_DIST"
else
  echo "[editor] ATTENZIONE: $WWW_DIST/index-admin.html non trovata — solo API"
  echo "[editor]   Costruisci con: cd sws-editor && pnpm build"
fi

# Auto-apre il progetto 'default' se esiste
PROJECT_ARGS=()
if [ -d "$PROJECTS_ROOT/default" ]; then
  PROJECT_ARGS=(--project "$PROJECTS_ROOT/default")
  echo "[editor] auto-apertura progetto: default"
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LAN_IP" ] && LAN_IP="localhost"

INST_LABEL=""
[ "$INSTANCE" -ne 1 ] && INST_LABEL=" (istanza $INSTANCE)"

# Mostra URL corretto in base allo stato TLS
if [ -f "$CONFIG_DIR/tls.crt" ]; then
  HTTP_PORT=$((8090 + (INSTANCE - 1)))
  HTTP_ARGS=(--http-port "$HTTP_PORT")
  cat <<MSG

────────────────────────────────────────────────────────────────
SWS IDE$INST_LABEL — pronto (HTTPS)

  IDE locale : https://$LAN_IP:$ADMIN_PORT

  → Per connettere un runtime: ConfigView → Runtime → Connetti
    (abilita deploy progetto + visualizzazione tag/allarmi live)

  Primo accesso (cert non ancora accettato nel browser):
    http://$LAN_IP:$HTTP_PORT  ← apri qui prima di usare l'IDE

  Stop: Ctrl-C
────────────────────────────────────────────────────────────────

MSG
else
  HTTP_ARGS=()
  cat <<MSG

────────────────────────────────────────────────────────────────
SWS IDE$INST_LABEL — pronto (HTTP)

  IDE locale : http://$LAN_IP:$ADMIN_PORT

  → Per connettere un runtime: ConfigView → Runtime → Connetti
    (abilita deploy progetto + visualizzazione tag/allarmi live)

  Per abilitare HTTPS: ConfigView → Stato → Certificato TLS
  Stop: Ctrl-C
────────────────────────────────────────────────────────────────

MSG
fi

# Avvia senza --viewer-port: solo la porta admin (IDE) è in ascolto.
exec "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
  --config         "$CONFIG_DIR"     \
  --projects-root  "$PROJECTS_ROOT"  \
  --templates-root "$TEMPLATES_ROOT" \
  --admin-port     "$ADMIN_PORT"     \
  "${HTTP_ARGS[@]}"                  \
  "${PROJECT_ARGS[@]}"               \
  "${WWW_ARGS[@]}"
