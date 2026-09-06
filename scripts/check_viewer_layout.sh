#!/usr/bin/env bash
#
# Verifica che il viewer NON produca barre di scorrimento su un pannello
# 1280×800 (il WP620), con e senza la barra superiore.
#
# Perché esiste: il maintainer vedeva TRE barre di scorrimento per pochi pixel,
# e le cause erano indipendenti fra loro — il margine di default del `body`
# contro un figlio `height: 100vh`, l'`<svg>` a height letterale in modalità
# fisso che non sottraeva le fasce (nav + allarmi, 70 px), e la larghezza
# mangiata da quei margini più la scrollbar del documento. A occhio si vedono
# solo "pochi pixel di troppo", quindi la regressione è facile da reintrodurre e
# difficile da notare: questo script misura, invece di guardare.
#
# Uso:
#   pnpm --dir sws-editor build          # serve la dist compilata
#   ./scripts/check_viewer_layout.sh
#
# Esce 0 se non c'è nessuna barra in nessuna delle quattro configurazioni.
# Richiede il browser di Playwright: pnpm --dir sws-editor exec playwright install chromium
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-viewer-layout.$$"
VPORT="${VPORT:-8643}"
APORT="${APORT:-8644}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index.html" ] || { echo "manca $DIST — esegui: pnpm --dir sws-editor build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
cleanup() {
  [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Su pyenv il `python3` nel PATH è uno shim e il runtime muore all'avvio con
# «libpython3.11.so.1.0: cannot open shared object file». Senza questa toppa
# questa guardia usciva **7 senza una riga di output**: `set -eu` più un `curl`
# che non trova nessuno in ascolto: un fallimento dell'ambiente travestito da
# fallimento della misura. Stessa toppa di `check_project_write_safety.sh` e
# degli script `start_*`.
if [[ "$(command -v python3)" == *".pyenv/shims"* ]]; then
  pv="$(pyenv version 2>/dev/null | awk '{print $1}')"
  [ -n "$pv" ] && export LD_LIBRARY_PATH="$HOME/.pyenv/versions/$pv/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$DIST" \
  --viewer-port "$VPORT" --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"

# Il runtime parte in HTTP puro finché non gli si dà un certificato: va bene,
# qui si misura il layout, non il TLS.
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$APORT/health" && break
  sleep 0.5
done
# E se non risponde lo dice, invece di lasciare che il primo `curl` faccia
# uscire lo script muto: chi legge deve sapere che il guasto è nell'avvio e non
# in quello che questa guardia misura.
if ! curl -sf -o /dev/null "http://localhost:$APORT/health"; then
  echo "✗ il runtime di prova non risponde su :$APORT — non è la misura che fallisce, è l'avvio" >&2
  echo "  ultime righe di $WORK/rt.log:" >&2
  tail -20 "$WORK/rt.log" >&2 || true
  exit 1
fi

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"viewer-layout","template":"demo-items-web"}' > /dev/null

# La dimensione della pagina in modalità "fisso" viene dal synoptic, non da
# page_layout: si portano le pagine a 1280×800 così la pagina è esattamente
# quanto lo schermo e le fasce vanno in eccesso — il caso del dispositivo.
python3 - "$WORK/projects/viewer-layout/synoptics" <<'PY'
import glob, os, re, sys
for f in glob.glob(os.path.join(sys.argv[1], "*.yaml")):
    s = open(f).read()
    s = re.sub(r"^width: \d+$",  "width: 1280", s, count=1, flags=re.M)
    s = re.sub(r"^height: \d+$", "height: 800", s, count=1, flags=re.M)
    open(f, "w").write(s)
PY

curl -sf -X POST "$API/projects/viewer-layout/open" > /dev/null

# Lo script di misura sta sotto sws-editor/ perché node risolve `@playwright/test`
# risalendo dal file, non dalla cwd.
VIEWER="http://localhost:$VPORT" ADMIN="$API" \
  node "$REPO/sws-editor/scripts/viewer_layout_measure.mjs"
