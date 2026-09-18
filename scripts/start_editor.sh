#!/usr/bin/env bash
#
# Avvia l'IDE SWS (solo porta 8460). Nessun viewer operatori — solo
# l'interfaccia di progettazione canvas.
#
# **Questo script è la corsa di PRODUZIONE**: si comporta come si comporterebbe
# per un cliente. Per lo sviluppo c'è `start_editor_develop.sh`, che tiene i
# progetti dentro il checkout.
#
# La differenza è una sola, ed è **dove vivono i progetti**. Qui la radice la
# decide il runtime: `~/sws_projects`, fuori dal repo, o `SWS_PROJECTS_ROOT` se
# l'hai impostata. Fino al 18-09-2026 questo script imponeva
# `.run-editor/projects`, dentro il checkout, e il default del runtime non
# entrava mai in gioco: il maintainer se n'è accorto vedendosi proporre
# `/home/ut1/sws/.run-editor/projects` alla creazione di un progetto, e ha
# chiarito che questo script l'ha sempre inteso come corsa di produzione.
#
# La directory dati di servizio (configurazione, log) resta .run-editor/,
# SEPARATA da .run/ usata da start_runtime.sh. Editor e runtime hanno progetti
# distinti: il deploy copia via API, non su disco.
#
# Di default parte in plain HTTP (nessun certificato necessario — localhost è
# sempre un "secure context" nei browser moderni). TLS si abilita da
# ConfigView → Stato → Certificato TLS dopo il primo avvio.
#
# Uso:
#   ./scripts/start_editor.sh                # IDE su 8460, progetti in ~/sws_projects
#   ./scripts/start_editor.sh --instance 2   # IDE su 8462, config in .run-editor-2/
#   ./scripts/start_editor_develop.sh        # progetti dentro il checkout
#
# Variabili d'ambiente (opzionali):
#   SWS_PROJECTS_ROOT  dove tenere i progetti (default del runtime: ~/sws_projects)
#   SWS_ADMIN_USER / SWS_ADMIN_PASSWORD   per creare un utente admin all'avvio
#   RUST_LOG=debug   per log verbosi

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse --instance N ────────────────────────────────────────────────────────
INSTANCE=1
SPA_BUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) INSTANCE="$2"; shift 2 ;;
    # Non ricostruire la SPA: si serve la dist così com'è. Per quando si sta
    # lavorando solo sul Rust e i dieci secondi di vite danno fastidio, o per
    # provare deliberatamente una dist vecchia.
    --no-spa)   SPA_BUILD=0; shift ;;
    *) echo "uso: $0 [--instance N] [--no-spa]" >&2; exit 2 ;;
  esac
done

# ── Porta IDE per-istanza (solo admin — nessun viewer) ────────────────────────
# Range separato dal runtime (8443-8449/8080-8089) per evitare conflitti
# quando entrambi girano sulla stessa macchina di sviluppo.
ADMIN_PORT=$((8460 + (INSTANCE - 1) * 2))

if [ "$INSTANCE" -eq 1 ]; then
  RUN_DIR="$REPO_ROOT/.run-editor"
else
  RUN_DIR="$REPO_ROOT/.run-editor-$INSTANCE"
fi

CONFIG_DIR="$RUN_DIR/config"
TEMPLATES_ROOT="$REPO_ROOT/examples/templates"
LOG_DIR="$RUN_DIR/logs"

# ── Dove vivono i progetti ────────────────────────────────────────────────────
#
# **Non si decide qui.** La radice è `SWS_PROJECTS_ROOT` se impostata, altrimenti
# il default del runtime (`~/sws_projects`, vedi `projects_root_predefinita()` in
# main.rs). Questo script passa `--projects-root` **solo** quando la variabile
# c'è: così la radice ha un posto solo da cui venire, e non due che possono
# divergere.
#
# Il percorso qui sotto serve soltanto al messaggio d'avvio — e quella è l'unica
# copia del default che esiste fuori dal Rust. Se un giorno cambia lì, questa
# riga mente: è il prezzo, dichiarato, di dire all'utente dove sta andando a
# scrivere invece di lasciarglielo scoprire.
if [ -n "${SWS_PROJECTS_ROOT:-}" ]; then
  PROJECTS_ARGS=(--projects-root "$SWS_PROJECTS_ROOT")
  PROJECTS_MOSTRATI="$SWS_PROJECTS_ROOT"
  PROJECTS_ORIGINE="SWS_PROJECTS_ROOT"
else
  PROJECTS_ARGS=()
  PROJECTS_MOSTRATI="${HOME:-.}/sws_projects"
  PROJECTS_ORIGINE="default del runtime"
fi

if [ -z "${PYO3_PYTHON:-}" ] && command -v python3 >/dev/null 2>&1; then
  export PYO3_PYTHON=python3
fi

# Su pyenv il `python3` nel PATH è uno shim, e il binario che ne risulta è
# linkato a una libpython che il loader non trova: parte, stampa «pronto», e
# muore con «libpython3.11.so.1.0: cannot open shared object file». Il messaggio
# arriva *dopo* il banner, quindi sembra che l'IDE sia su e invece non c'è
# nessuno in ascolto — visto su frodo il 2026-09-01, ed è lo stesso blocco che
# `start_runtime.sh` ha da tempo (righe 54-62). Senza questo, il comando che
# `docs/HOWTO.md` §7 dà per accendere la chat non funziona su questa macchina.
python_reale="$(command -v python3 || true)"
if [[ "$python_reale" == *".pyenv/shims"* ]]; then
  pyenv_lib="$(python3 -c 'import sysconfig; print(sysconfig.get_config_var("LIBDIR"))' 2>/dev/null || true)"
  if [ -n "$pyenv_lib" ] && [ -d "$pyenv_lib" ]; then
    export LD_LIBRARY_PATH="${pyenv_lib}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  fi
fi

# La radice dei progetti non si crea qui: la crea il runtime all'avvio, ed è
# l'unico che sa qual è quando la variabile non c'è.
mkdir -p "$CONFIG_DIR" "$LOG_DIR"

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
  SPA_LOG_PREFIX="[editor]" "$REPO_ROOT/scripts/build_spa_if_needed.sh" || \
    echo "[editor] si continua con la dist che c'è (vedi l'errore sopra)"
else
  echo "[editor] --no-spa: la dist non viene toccata"
fi

# ── Sync branding → dist ──────────────────────────────────────────────────────
# public/branding/ è la SORGENTE, dist/branding/ è ciò che l'app serve/legge.
# Vite copia public→dist solo al build, ma cambiare brand non deve richiedere un
# rebuild: risincronizziamo sempre (copia istantanea) così "edita
# public/branding/active.json + riavvia" cambia davvero il brand.
sync_branding() {
  local src="$REPO_ROOT/sws-editor/public/branding"
  local dst="$REPO_ROOT/sws-editor/dist/branding"
  if [ -d "$src" ] && [ -d "$REPO_ROOT/sws-editor/dist" ]; then
    rm -rf "$dst" && cp -r "$src" "$dst"
    echo "[editor] branding sincronizzato (attivo: $(grep -o '\"brand\"[^,}]*' "$src/active.json" 2>/dev/null || echo '?'))"
  fi
}
sync_branding

WWW_DIST="$REPO_ROOT/sws-editor/dist"
WWW_ARGS=()
if [ -f "$WWW_DIST/index-admin.html" ]; then
  WWW_ARGS=(--www "$WWW_DIST")
  echo "[editor] SPA da $WWW_DIST"
else
  # Se siamo qui, o la build è fallita (l'errore è appena sopra) o è stata
  # saltata con --no-spa. In entrambi i casi il rimedio non è «costruisci a
  # mano»: è guardare l'errore, oppure togliere --no-spa.
  echo "[editor] ATTENZIONE: dist/index-admin.html non trovata — si avvia in sola API"
  echo "[editor]   (la SPA non è stata costruita: vedi sopra, oppure ./scripts/build_spa_if_needed.sh)"
fi

# Auto-apertura del progetto: NON passiamo --project. Il runtime riapre da solo
# l'ultimo progetto attivo (marker .active-project) o l'unico presente.
PROJECT_ARGS=()

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
  Progetti   : $PROJECTS_MOSTRATI   ($PROJECTS_ORIGINE)

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
  "${PROJECTS_ARGS[@]}"              \
  --templates-root "$TEMPLATES_ROOT" \
  --admin-port     "$ADMIN_PORT"     \
  "${HTTP_ARGS[@]}"                  \
  "${PROJECT_ARGS[@]}"               \
  "${WWW_ARGS[@]}"
