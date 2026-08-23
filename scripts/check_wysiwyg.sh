#!/usr/bin/env bash
#
# Gli oggetti convertiti al pattern WYSIWYG restano selezionabili? Lo slider
# sta dentro il box? Un trend legacy migra a trend_tags al salvataggio?
#
# Perché esiste: la regola WYSIWYG di CLAUDE.md sostituisce i placeholder col
# rendering runtime sotto `pointerEvents:none`. Senza un hit-rect sopra il
# contenuto, un oggetto NON selezionato e senza sfondo non si può più
# selezionare col mouse — succeduto davvero il 2026-08-23 a setpoint, checkbox,
# radio e sparkline, e invisibile leggendo il codice. Qui si misura.
#
# Uso:
#   cargo build -p sws-runtime && pnpm --dir sws-editor build
#   ./scripts/check_wysiwyg.sh
#
# Richiede il browser di Playwright:
#   pnpm --dir sws-editor exec playwright install chromium
#
# Runtime scratch dichiarato (porta 8657, dir temporanea), terminato dal trap:
# non tocca le istanze del maintainer.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-wysiwyg.$$"
APORT="${APORT:-8657}"

mkdir -p "$WORK"/{config,projects}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$DIST" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"wysiwyg-test"}' > /dev/null
curl -sf -X POST "$API/projects/wysiwyg-test/open" > /dev/null

# Pagina con un esemplare di ogni tipo toccato + un trend in formato LEGACY.
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id": "pagina-1", "name": "Pagina 1", "width": 1280, "height": 800,
  "objects": [
    {"id":"sp1","type":"setpoint","x":40,"y":40,"width":160,"height":60,"tag":"t.a","label":"Setpoint","decimals":1},
    {"id":"cb1","type":"checkbox","x":230,"y":40,"width":180,"height":32,"tag":"t.b","label":"Abilita"},
    {"id":"rd1","type":"radio","x":230,"y":90,"width":180,"height":80,"tag":"t.c","label":"Modo",
      "options":[{"label":"Auto","value":1},{"label":"Man","value":2}]},
    {"id":"sk1","type":"sparkline","x":440,"y":40,"width":160,"height":60,"tag":"t.a"},
    {"id":"sl1","type":"slider","x":40,"y":130,"width":200,"height":50,"tag":"t.a","label":"Portata","min":0,"max":100},
    {"id":"av1","type":"alarm_viewer","x":640,"y":40,"width":320,"height":140},
    {"id":"ab1","type":"alarm_bell","x":990,"y":40,"width":130,"height":34},
    {"id":"abn1","type":"alarm_banner","x":640,"y":200,"width":480,"height":32},
    {"id":"rp1","type":"recipe_panel","x":40,"y":210,"width":260,"height":150},
    {"id":"ls1","type":"lang_selector","x":330,"y":210,"width":120,"height":32},
    {"id":"xy1","type":"xy_plot","x":330,"y":260,"width":200,"height":200,"tag":"t.a","y_tag":"t.b"},
    {"id":"tr1","type":"trend","x":640,"y":260,"width":420,"height":200,
      "tag":"t.a","extra_tags":["t.b"],"line_color":"#111111",
      "trend_series_styles":[{"width":2},{"own_scale":true,"color":"#f59e0b"}]}
  ]
}' > /dev/null

echo "== misura WYSIWYG =="
ADMIN="$API" IDE="http://localhost:$APORT" PAGE_NAME="Pagina 1" \
  SHOT="${SHOT:-${TMPDIR:-/tmp}/sws-wysiwyg.png}" \
  node "$REPO/sws-editor/scripts/wysiwyg_measure.mjs"
