#!/usr/bin/env bash
#
# Trascinando una multi-selezione si muovono TUTTI gli oggetti selezionati?
#
# Perché esiste: il maintainer ha segnalato due volte che se ne muove uno solo, e
# un primo tentativo di fix non ha risolto. Leggere il codice non ha trovato la
# causa — la logica sembra corretta — quindi qui si misura invece di dedurre.
#
# Uso:
#   pnpm --dir sws-editor build
#   ./scripts/check_multiselect_drag.sh
#
# Richiede il browser di Playwright:
#   pnpm --dir sws-editor exec playwright install chromium
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-multiselect-drag.$$"
APORT="${APORT:-8654}"

[ -x "$BIN" ]              || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
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

for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$APORT/health" && break
  sleep 0.5
done

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"drag-test"}' > /dev/null
curl -sf -X POST "$API/projects/drag-test/open" > /dev/null

# Due rettangoli ben distanziati: il caso più semplice possibile, così un
# fallimento non si può attribuire a linee, pipe o griglie.
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id": "pagina-1", "name": "Pagina 1", "width": 1280, "height": 800,
  "objects": [
    {"id":"rect_a","type":"rect","x":100,"y":100,"width":120,"height":80,"fill":"#3b82f6"},
    {"id":"rect_b","type":"rect","x":400,"y":300,"width":120,"height":80,"fill":"#ef4444"}
  ]
}' > /dev/null

echo "== misura del drag multi-selezione =="
ADMIN="$API" IDE="http://localhost:$APORT" PAGE_NAME="Pagina 1" \
  node "$REPO/sws-editor/scripts/multiselect_drag_measure.mjs"
