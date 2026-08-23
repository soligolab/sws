#!/usr/bin/env bash
#
# F7.6 — i campi nuovi di forma sopravvivono al round-trip e il canvas li usa?
#
# Perché esiste: ogni campo nuovo va specchiato in `sws-web/src/synoptic.rs` o
# viene scartato in silenzio al salvataggio (nessun errore, nessun log: il
# valore semplicemente non c'è più al ricarico). Qui si misura il round-trip
# PUT→GET e poi si leggono gli attributi SVG davvero prodotti dal canvas.
#
# Uso:
#   cargo build -p sws-runtime && pnpm --dir sws-editor build
#   ./scripts/check_f76.sh
#
# Runtime scratch dichiarato (porta 8658, dir temporanea), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-f76.$$"
APORT="${APORT:-8658}"

mkdir -p "$WORK"/{config,projects}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$DIST" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"f76-test"}' > /dev/null
curl -sf -X POST "$API/projects/f76-test/open" > /dev/null

curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id": "pagina-1", "name": "Pagina 1", "width": 1280, "height": 800,
  "objects": [
    {"id":"rect_fx","type":"rect","x":40,"y":40,"width":180,"height":100,"fill":"#3b82f6",
     "stroke":"#e2e8f0","stroke_width":2,"corner_radius":12,"stroke_dasharray":"6 3",
     "fill_gradient":"vertical"},
    {"id":"gauge_fx","type":"gauge","x":260,"y":40,"width":200,"height":170,"tag":"t.a",
     "min":0,"max":100,"gauge_ticks":5,"gauge_start_angle":-120,"gauge_end_angle":120,
     "gauge_sp_tag":"t.sp","gauge_sp_color":"#f59e0b",
     "gauge_zones":[{"from":0,"to":60,"color":"#22c55e"},{"from":60,"to":100,"color":"#ef4444"}]},
    {"id":"img_fx","type":"image","x":500,"y":40,"width":160,"height":120,
     "src":"/icon-192.svg","image_fit":"contain"},
    {"id":"led_sq","type":"led","x":700,"y":40,"width":24,"led_shape":"square","tag":"t.b"},
    {"id":"grid_fx","type":"grid","x":40,"y":250,"width":300,"height":200,
     "grid_rows":2,"grid_cols":2,"grid_gap":8,"grid_padding":6}
  ]
}' > /dev/null

echo "== misura F7.6 =="
ADMIN="$API" IDE="http://localhost:$APORT" PAGE_NAME="Pagina 1" \
  SHOT="${SHOT:-${TMPDIR:-/tmp}/sws-f76.png}" \
  node "$REPO/sws-editor/scripts/f76_measure.mjs"
