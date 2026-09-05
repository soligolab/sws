#!/usr/bin/env bash
#
# T-52 — il bordo pagina trattiene, ma non imprigiona: si misura col mouse vero.
#
# Perché esiste: `softEdgeAxis` è una funzione pura e i suoi casi stanno in
# `sws-editor/tests/pageLayout.test.ts`, ma fra quella funzione e l'oggetto che
# si muove ci sono la gabbia calcolata alla presa, gli offset del drag, lo zoom
# del canvas e tutta la cascata di snap. Nessun unit test vede quel tratto, e la
# richiesta del maintainer («deve trattenere, ma uscire se trascino con
# decisione») è esattamente una proprietà di quel tratto.
#
# Le quattro misure sono descritte in testa a `soft_edge_measure.mjs`. Quella
# che conta di più è la terza: distingue una soglia in pixel schermo da una
# scritta per sbaglio in unità pagina, cosa che le prime due non vedrebbero.
#
# Uso:
#   cargo build -p sws-runtime                 # da sws-runtime/
#   pnpm --dir sws-editor build
#   ./scripts/check_soft_edge.sh
#
# Richiede il browser di Playwright:
#   pnpm --dir sws-editor exec playwright install chromium
# oppure un Chromium di sistema:
#   SWS_E2E_CHROMIUM=/usr/bin/chromium ./scripts/check_soft_edge.sh
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-soft-edge.$$"
APORT="${APORT:-8655}"

[ -x "$BIN" ]                   || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index-admin.html" ] || { echo "manca $DIST — esegui: pnpm --dir sws-editor build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
cleanup() {
  [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# IDE-only (nessun --viewer-port): qui interessa l'editor.
"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$DIST" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"

su=0
for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$APORT/health"; then su=1; break; fi
  sleep 0.5
done
# Un runtime che non si alza deve dirlo. La guardia gemella `check_viewer_layout.sh`
# usciva muta quando il runtime moriva all'avvio, e per un giorno è sembrato un
# fallimento della misura invece che dell'ambiente.
if [ "$su" -ne 1 ]; then
  echo "✗ il runtime di prova non risponde su :$APORT dopo 20s — non è la misura che fallisce, è l'avvio" >&2
  echo "  ultime righe di $WORK/rt.log:" >&2
  tail -20 "$WORK/rt.log" >&2 || true
  exit 1
fi

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"soft-edge-test"}' > /dev/null
curl -sf -X POST "$API/projects/soft-edge-test/open" > /dev/null

# Due rettangoli identici sulla stessa riga: la gabbia dell'unione è larga 420
# (da x=100 a x=520), numero che il measure usa per la prova di gruppo.
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id": "pagina-1", "name": "Pagina 1", "width": 1280, "height": 800,
  "objects": [
    {"id":"rect_a","type":"rect","x":100,"y":100,"width":120,"height":80,"fill":"#3b82f6"},
    {"id":"rect_b","type":"rect","x":400,"y":100,"width":120,"height":80,"fill":"#ef4444"}
  ]
}' > /dev/null

echo "== misura del limite morbido al bordo pagina =="
ADMIN="$API" IDE="http://localhost:$APORT" PAGE_NAME="Pagina 1" PAGE_W=1280 \
  node "$REPO/sws-editor/scripts/soft_edge_measure.mjs"
