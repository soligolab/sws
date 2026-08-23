#!/usr/bin/env bash
#
# Lotto 3 (F7.1-F7.4) — i campi nuovi di tabella, bar chart, pie e testo
# sopravvivono al round-trip e il canvas li usa davvero?
#
# Perché esiste: come per F7.6, ogni campo non specchiato in
# `sws-web/src/synoptic.rs` sparisce in silenzio al salvataggio. Qui, oltre al
# round-trip, si leggono gli effetti nel DOM: il testo che va a capo, la barra
# negativa sotto lo zero, la fetta "resto" del pie, la tabella HTML con le
# colonne scelte.
#
# Uso:
#   cargo build -p sws-runtime && pnpm --dir sws-editor build
#   ./scripts/check_f7.sh
#
# Runtime scratch dichiarato (porta 8660, dir temporanea), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
DIST="$REPO/sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-f7.$$"
APORT="${APORT:-8660}"

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
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"f7-test"}' > /dev/null
curl -sf -X POST "$API/projects/f7-test/open" > /dev/null

# Servono valori NOTI (compreso un negativo) per poter affermare qualcosa sulle
# barre e sulle fette: prima le definizioni (PUT /api/project/tags), poi i
# valori uno per uno (PUT /api/tags/:id, la stessa strada dei controlli).
curl -sf -X PUT "$API/project/tags" -H 'Content-Type: application/json' -d '[
  {"id":"t.neg","description":"negativo"},
  {"id":"t.pos","description":"positivo"},
  {"id":"t.a","description":"a"},
  {"id":"t.b","description":"b"},
  {"id":"t.c","description":"c piccola"},
  {"id":"t.d","description":"d piccola"},
  {"id":"t.p","description":"pressione"}
]' > /dev/null
for pair in "t.neg=-40" "t.pos=80" "t.a=50" "t.b=45" "t.c=3" "t.d=2" "t.p=7.5"; do
  id="${pair%%=*}"; val="${pair#*=}"
  curl -sf -X PUT "$API/tags/$id" -H 'Content-Type: application/json' -d "{\"value\": $val}" > /dev/null \
    || echo "  (valore $id non impostato)"
done

curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id": "pagina-1", "name": "Pagina 1", "width": 1280, "height": 800,
  "objects": [
    {"id":"txt_wrap","type":"text","x":40,"y":40,"width":200,"height":90,
     "text":"Riga uno molto lunga che deve andare a capo dentro il box dichiarato",
     "text_wrap":true,"text_valign":"middle","line_height":1.6,"font_size":13},
    {"id":"bar_neg","type":"bar_chart","x":280,"y":40,"width":280,"height":200,
     "bar_ticks":5,"bar_show_legend":true,"decimals":1,
     "bar_series":[{"tag":"t.neg","label":"giù","color":"#ef4444"},{"tag":"t.pos","label":"su","color":"#22c55e"}]},
    {"id":"bar_stk","type":"bar_chart","x":600,"y":40,"width":200,"height":200,
     "bar_mode":"stacked","bar_show_legend":true,
     "bar_series":[{"tag":"t.a","label":"A","color":"#3b82f6"},{"tag":"t.b","label":"B","color":"#f59e0b"}]},
    {"id":"pie_grp","type":"pie_chart","x":840,"y":40,"width":240,"height":240,
     "pie_mode":"donut","pie_hole_color":"#ffffff","pie_show_labels":true,"pie_show_legend":true,
     "pie_label_mode":"value_percent","pie_group_below_pct":10,"pie_group_label":"resto",
     "pie_explode_px":8,"unit":" kW","decimals":0,
     "pie_slices":[{"tag":"t.a","label":"uno"},{"tag":"t.b","label":"due"},{"tag":"t.c","label":"tre"},{"tag":"t.d","label":"quattro"}]},
    {"id":"av","type":"alarm_viewer","x":500,"y":300,"width":360,"height":150,
     "alarm_viewer_mode":"table","alarm_viewer_show_ack_all":true,
     "alarm_viewer_show_shelve":true,"alarm_shelve_minutes":30},
    {"id":"ah","type":"alarm_history","x":880,"y":300,"width":380,"height":180,
     "alarm_history_id":"AL_TEST"},
    {"id":"tbl","type":"table","x":40,"y":300,"width":420,"height":160,
     "table_columns":["label","value","unit","quality"],
     "table_sortable":true,"table_filterable":true,"table_font_size":12,"table_label_header":"SEGNALI",
     "table_rows":[
       {"label":"Pressione","tag":"t.p","unit":"bar","decimals":2,"writable":true,"warn_high":7,"alarm_high":9},
       {"label":"Portata","tag":"t.a","unit":"l/min","decimals":1}
     ]}
  ]
}' > /dev/null

echo "== misura Lotto 3 (F7.1-F7.4) =="
ADMIN="$API" IDE="http://localhost:$APORT" PAGE_NAME="Pagina 1" \
  SHOT="${SHOT:-${TMPDIR:-/tmp}/sws-f7.png}" \
  node "$REPO/sws-editor/scripts/f7_widgets_measure.mjs"
