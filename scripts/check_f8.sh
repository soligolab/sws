#!/usr/bin/env bash
#
# F8.1 — ridimensionando un oggetto, il bordo trascinato si aggancia ai bordi
# degli altri oggetti (come già faceva lo spostamento)?
#
# Perché esiste: lo snap durante il resize usava solo la griglia, quindi
# allineare il bordo di un oggetto a quello di un vicino restava un lavoro a
# occhio anche con lo snap attivo. La misura si fa con lo snap alla griglia
# SPENTO: se il bordo finisce esattamente su quello del vicino, il merito è del
# nuovo aggancio e non della griglia.
#
# Uso:
#   cargo build -p sws-runtime && pnpm --dir sws-editor build
#   ./scripts/check_f8.sh
#
# Runtime scratch dichiarato (porta 8659, dir temporanea), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-f8.$$"
APORT="${APORT:-8659}"

mkdir -p "$WORK"/{config,projects}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$DIST" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done
curl -sf -o /dev/null "http://localhost:$APORT/health" || { echo "runtime non partito:"; tail -20 "$WORK/rt.log"; exit 1; }

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"f8-test"}' > /dev/null
curl -sf -X POST "$API/projects/f8-test/open" > /dev/null

# A finisce a 200, B comincia a 260: 60px di distanza, più della tolleranza di
# aggancio (8px), così il test misura un aggancio e non una coincidenza.
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id": "pagina-1", "name": "Pagina 1", "width": 1280, "height": 800,
  "objects": [
    {"id":"a","type":"rect","x":100,"y":100,"width":100,"height":60,"fill":"#3b82f6"},
    {"id":"b","type":"rect","x":260,"y":100,"width":120,"height":60,"fill":"#ef4444"}
  ]
}' > /dev/null

echo "== misura F8.1 (snap in resize) =="
ADMIN="$API" IDE="http://localhost:$APORT" PAGE_NAME="Pagina 1" \
  node "$REPO/sws-editor/scripts/resize_snap_measure.mjs"
