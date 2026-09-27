#!/usr/bin/env bash
#
# Polilinea e poligono sul pannello LVGL: si disegnano, e i concavi non lo
# bloccano? E un oggetto ruotato gira anche sul pannello?
#
# Perché esiste: `lv_canvas_draw_polygon` di LVGL 8 su un poligono concavo non
# ritorna mai — schermo nero e nessun log, il caso della fiamma del simbolo
# `boiler`. Una stella e una polilinea chiusa qualunque sono concave. Per
# questo il 26-09-2026 polilinea e poligono si disegnano come SVG rasterizzato
# (resvg, `svg_forma` in `lvgl_render.rs`): questa guardia dice che il viewer
# finisce la fotografia entro un tempo limite, che le forme ci sono, e che gli
# incavi restano incavi (il fondo si vede fra le punte della stella).
#
# Uso:
#   cargo build -p sws-runtime -p sws-lvgl-viewer
#   ./scripts/check_forme_lvgl.sh
#
# Runtime scratch dichiarato (porte 8688/8689, dir temporanea), terminato dal trap.
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
WORK="${TMPDIR:-/tmp}/sws-forme-lvgl.$$"
AP="${APORT:-8688}"
VP="${VPORT:-8689}"

[ -x "$BIN" ]  || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -x "$LVGL" ] || { echo "manca $LVGL — esegui: cargo build -p sws-lvgl-viewer" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
trap '[ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null; rm -rf "$WORK"' EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "examples/templates" --viewer-port "$VP" --admin-port "$AP" \
  > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
su=0
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$AP/health" && { su=1; break; }; sleep 0.5; done
if [ "$su" -ne 1 ]; then
  echo "✗ il runtime di prova non risponde su :$AP — non è la misura che fallisce, è l'avvio" >&2
  tail -20 "$WORK/rt.log" >&2; exit 1
fi

API="http://localhost:$AP/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"forme"}' > /dev/null
curl -sf -X POST "$API/projects/forme/open" > /dev/null
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id":"pagina-1","name":"Pagina 1","width":800,"height":480,"background":"#101820",
  "objects":[
    {"id":"esagono","type":"polygon","x":20,"y":20,"width":160,"height":160,"sides":6,"fill":"#22c55e"},
    {"id":"stella","type":"polygon","x":220,"y":20,"width":160,"height":160,"sides":5,"star":true,"star_inner":40,"fill":"#f59e0b"},
    {"id":"freccia","type":"polyline","x":420,"y":20,"closed":true,"fill":"#3b82f6",
     "points":[{"x":420,"y":20},{"x":580,"y":100},{"x":420,"y":180},{"x":470,"y":100}]},
    {"id":"zigzag","type":"polyline","x":620,"y":40,"stroke":"#ef4444","stroke_width":6,
     "points":[{"x":620,"y":160},{"x":660,"y":40},{"x":700,"y":160},{"x":740,"y":40},{"x":780,"y":160}]},
    {"id":"ruotato","type":"rect","x":300,"y":300,"width":200,"height":40,"rotation":90,"fill":"#a855f7"}
  ]}' > /dev/null

echo "== il motore LVGL disegna la pagina, e finisce =="
# Il tempo limite È la prova del concavo: un `lv_canvas_draw_polygon` bloccato
# non restituirebbe mai la fotografia.
if ! timeout 30 "$LVGL" --base-url "http://localhost:$VP" --page "Pagina 1" --istantanea "$WORK/p.ppm" \
  > "$WORK/lvgl.log" 2>&1; then
  echo "  ✗ il viewer non ha finito entro 30 s (o è uscito con errore)"; tail -20 "$WORK/lvgl.log"; exit 1
fi
grep -E "creati correttamente" "$WORK/lvgl.log" | sed 's/^/  /'

python3 - "$WORK/p.ppm" <<'PY'
import sys
male = 0
def ok(c, m):
    global male
    print(("  \033[32m✓\033[0m " if c else "  \033[31m✗\033[0m ") + m)
    if not c: male = 1
d = open(sys.argv[1], "rb").read()
testa = d.split(b"\n", 3)
w, h = map(int, testa[1].split())
px = testa[3]
def pixel(x, y):
    i = (y * w + x) * 3
    return tuple(px[i:i+3])
def vicino(c, atteso, t=24):
    return all(abs(a - b) <= t for a, b in zip(c, atteso))
fondo = (0x10, 0x18, 0x20)
casi = [
    ("esagono pieno al centro", (100, 100), (0x22, 0xc5, 0x5e)),
    ("stella piena al centro", (300, 100), (0xf5, 0x9e, 0x0b)),
    # Stella centrata in (300, 100), raggio 80, interno 40 % = 32. Le punte
    # stanno a −90°, −18°, 54°…; l'incavo fra le prime due a −54°, dove il
    # bordo è a raggio 32: a raggio 60 su quella direzione c'è il fondo.
    ("fra due punte della stella si vede il fondo (incavo)", (335, 52), fondo),
    ("freccia chiusa piena", (500, 100), (0x3b, 0x82, 0xf6)),
    ("nella tacca concava della freccia si vede il fondo", (440, 100), fondo),
    ("zigzag aperto: il tratto c'è", (640, 100), (0xef, 0x44, 0x44)),
    ("zigzag aperto: nessun riempimento", (660, 130), fondo),
    # Rettangolo 200×40 centrato in (400, 320), ruotato di 90°: diventa una
    # barra verticale. Sotto il centro c'è, a destra no — da dritto sarebbe
    # il contrario (rotazione statica su LVGL, Fase D del 26-09-2026).
    ("rettangolo ruotato di 90°: la barra è verticale", (400, 390), (0xa8, 0x55, 0xf7)),
    ("rettangolo ruotato di 90°: a destra del centro c'è il fondo", (480, 320), fondo),
]
for nome, (x, y), atteso in casi:
    c = pixel(x, y)
    ok(vicino(c, atteso), f"{nome}: pixel {c}, atteso ~{atteso}")
sys.exit(male)
PY
esito=$?
[ $esito -eq 0 ] && echo -e "\n\033[32mTUTTO OK\033[0m"
exit $esito
