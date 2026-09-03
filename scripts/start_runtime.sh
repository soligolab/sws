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
#   ./scripts/start_runtime.sh --no-admin     # come i dispositivi: nessun IDE
#                                             # sulla 8444, solo gestione remota
#
# Variabili d'ambiente (opzionali):
#   SWS_ADMIN_USER / SWS_ADMIN_PASSWORD   per creare un utente admin all'avvio
#   RUST_LOG=debug   per log verbosi

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse --instance N ────────────────────────────────────────────────────────
INSTANCE=1
SPA_BUILD=1
NO_ADMIN_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) INSTANCE="$2"; shift 2 ;;
    # Prova la postura che i dispositivi hanno per default dal 2026-09-02:
    # nessun IDE sulla porta admin, solo la gestione remota che l'editor chiama.
    # Qui NON è il default, perché lo stack di sviluppo serve anche a lavorare
    # sull'IDE del dispositivo — ma senza questa opzione la postura vera non
    # sarebbe provabile in locale, e una configurazione che si prova solo in
    # campo è una configurazione che non si prova.
    --no-admin) NO_ADMIN_ARGS=(--no-admin); shift ;;
    # Non ricostruire la SPA: si serve la dist così com'è.
    --no-spa)   SPA_BUILD=0; shift ;;
    *) echo "uso: $0 [--instance N] [--no-admin] [--no-spa]" >&2; exit 2 ;;
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

PYTHON_PATH=$(which python3 2>/dev/null || echo "")
if [ -z "${PYO3_PYTHON:-}" ] && [ -n "$PYTHON_PATH" ]; then
  export PYO3_PYTHON="$PYTHON_PATH"
fi

# Su Arch/pyenv il binario Python è uno shim che non espone le shared libs:
# PyO3 non trova libpython e crasha. Patcha LD_LIBRARY_PATH con la versione attiva.
if [[ "${PYTHON_PATH:-}" == *".pyenv/shims"* ]]; then
  python_version=$(pyenv version 2>/dev/null | awk '{print $1}')
  if [ -n "$python_version" ]; then
    pyenv_lib="$HOME/.pyenv/versions/$python_version/lib"
    export LD_LIBRARY_PATH="${pyenv_lib}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  fi
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

# Le porte sono ancora occupate? `fuser -k` qui sopra NON può né uccidere né
# VEDERE un processo di root (senza privilegi non mappa i socket altrui, e
# fallisce in silenzio) — tipicamente il servizio systemd dell'installazione
# nativa (/opt/sws), che ogni deploy nativo dall'IDE ri-abilita e riavvia.
# L'avvio moriva molto più sotto con un generico "Address already in use":
# meglio fermarsi subito, col rimedio esatto. `ss` legge /proc/net/tcp e vede
# i listener di chiunque.
port_busy() {
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":$1\$"
}
if port_busy "$VIEWER_PORT" || port_busy "$ADMIN_PORT"; then
  echo ""
  echo "ERRORE: le porte $VIEWER_PORT/$ADMIN_PORT sono ancora occupate da un processo"
  echo "        che questo script non può fermare (probabilmente gira come root)."
  if systemctl is-active --quiet sws-runtime 2>/dev/null; then
    echo ""
    echo "        È il servizio systemd dell'installazione nativa (/opt/sws)."
    echo "        Ogni deploy nativo dall'IDE lo ri-abilita e riavvia. Fermalo con:"
    echo ""
    echo "          sudo systemctl disable --now sws-runtime"
    echo ""
    echo "        poi rilancia questo script."
  else
    echo "        Chi le occupa:"
    fuser -v "${VIEWER_PORT}/tcp" "${ADMIN_PORT}/tcp" 2>&1 | sed 's/^/          /' || true
  fi
  exit 1
fi

echo "[runtime] build (cargo build -p sws-runtime -j 1)…"
echo "[runtime]  (in attesa del file lock se un altro build è in corso)"
(cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime -j 1)

# ── La SPA, con lo stesso criterio del backend ───────────────────────────────
#
# Qui c'era `ensure_frontend_built`, duplicata in entrambi gli script start_*,
# che ricostruiva la dist se mancava `index-admin.html` **oppure** se qualcosa
# sotto `sws-editor/src` era più recente. Due buchi, e si vedevano:
#
#  * guardava solo `src/`. Un `index*.html` nuovo (la finestra dei log, la chat
#    staccata), un `vite.config.ts` toccato, una dipendenza cambiata in
#    `package.json` o nel lockfile non facevano scattare niente — e il marcatore
#    controllato era un entry point solo, quindi gli altri potevano mancare
#    dalla dist senza che nessuno se ne accorgesse (404 sulla finestra staccata).
#  * se `pnpm build` falliva — un errore di TypeScript, o `node_modules`
#    assente — lo script **tirava avanti** e più sotto stampava «Costruisci con:
#    cd sws-editor && pnpm build», come se l'utente se ne fosse dimenticato. Il
#    rimedio suggerito era quello appena fallito.
#
# Ora la decisione sta in un posto solo, `scripts/build_spa_if_needed.sh`, che
# scopre gli entry point con un glob invece di elencarli, fa `pnpm install` se
# manca, e quando fallisce lo dice.
#
# Resta **prima** di `sync_branding`: `vite build` svuota dist/, quindi
# costruire dopo cancellerebbe il branding appena copiato dentro.
if [ "$SPA_BUILD" -eq 1 ]; then
  SPA_LOG_PREFIX="[runtime]" "$REPO_ROOT/scripts/build_spa_if_needed.sh" || \
    echo "[runtime] si continua con la dist che c'è (vedi l'errore sopra)"
else
  echo "[runtime] --no-spa: la dist non viene toccata"
fi

# ── Sync branding → dist ──────────────────────────────────────────────────────
# public/branding/ è la SORGENTE, dist/branding/ è ciò che il runtime serve.
# Risincronizziamo sempre (copia istantanea) così cambiare brand non richiede un
# rebuild del frontend.
sync_branding() {
  local src="$REPO_ROOT/sws-editor/public/branding"
  local dst="$REPO_ROOT/sws-editor/dist/branding"
  if [ -d "$src" ] && [ -d "$REPO_ROOT/sws-editor/dist" ]; then
    rm -rf "$dst" && cp -r "$src" "$dst"
    echo "[runtime] branding sincronizzato (attivo: $(grep -o '\"brand\"[^,}]*' "$src/active.json" 2>/dev/null || echo '?'))"
  fi
}
sync_branding

WWW_DIST="$REPO_ROOT/sws-editor/dist"
WWW_ARGS=()
if [ -f "$WWW_DIST/index.html" ]; then
  WWW_ARGS=(--www "$WWW_DIST")
  echo "[runtime] SPA da $WWW_DIST"
else
  # Se siamo qui, o la build è fallita (l'errore è appena sopra) o è stata
  # saltata con --no-spa. In entrambi i casi il rimedio non è «costruisci a
  # mano»: è guardare l'errore, oppure togliere --no-spa.
  echo "[runtime] ATTENZIONE: dist/index.html non trovata — si avvia in sola API"
  echo "[runtime]   (la SPA non è stata costruita: vedi sopra, oppure ./scripts/build_spa_if_needed.sh)"
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
  "${WWW_ARGS[@]}"                       \
  "${NO_ADMIN_ARGS[@]}"
