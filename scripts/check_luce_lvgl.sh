#!/usr/bin/env bash
#
# Luminosità e opacità legata a un tag: il pannello LVGL le disegna come il web?
#
# Perché esiste: fino al 26-09-2026 su LVGL un'opacità legata a un tag era
# **ignorata** (i binding valevano solo alla creazione, e solo per la
# geometria) e la luminosità non esisteva. La logica pura ha i suoi test in
# `effects.rs`, con gli stessi numeri di `luce.test.ts` — ma che il filtro
# colore arrivi davvero ai pixel, e che il valore del tag arrivi davvero al
# filtro, lo dice solo una fotografia del motore vero.
#
# Quattro rettangoli grigi (#808080) su fondo scuro:
#   1. luminosità −50 statica           → circa #404040
#   2. luminosità +50 statica           → circa #bfbfbf
#   3. opacità legata al tag t.op=0.25  → 25 % di grigio sul fondo
#   4. luminosità legata a t.luce=−100  → nero
#
# Uso:
#   cargo build -p sws-runtime -p sws-lvgl-viewer
#   ./scripts/check_luce_lvgl.sh
#
# Runtime scratch dichiarato (porte 8686/8687, dir temporanea), terminato dal trap.
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
WORK="${TMPDIR:-/tmp}/sws-luce-lvgl.$$"
AP="${APORT:-8686}"
VP="${VPORT:-8687}"

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
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"luce"}' > /dev/null
curl -sf -X POST "$API/projects/luce/open" > /dev/null
curl -sf -X PUT "$API/project/tags" -H 'Content-Type: application/json' -d '[
  {"id":"t.op","data_type":"float"},{"id":"t.luce","data_type":"float"}]' > /dev/null
curl -sf -X PUT "$API/tags/t.op"   -H 'Content-Type: application/json' -d '{"value": 0.25}' > /dev/null
curl -sf -X PUT "$API/tags/t.luce" -H 'Content-Type: application/json' -d '{"value": -100}' > /dev/null
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id":"pagina-1","name":"Pagina 1","width":800,"height":480,"background":"#101820",
  "objects":[
    {"id":"scuro","type":"rect","x":20,"y":20,"width":160,"height":120,"fill":"#808080","brightness":-50},
    {"id":"chiaro","type":"rect","x":220,"y":20,"width":160,"height":120,"fill":"#808080","brightness":50},
    {"id":"trasparente","type":"rect","x":420,"y":20,"width":160,"height":120,"fill":"#808080",
     "bindings":{"opacity":{"tag":"t.op","in_min":0,"in_max":1,"out_min":0,"out_max":1}}},
    {"id":"spento","type":"rect","x":620,"y":20,"width":160,"height":120,"fill":"#808080",
     "bindings":{"brightness":"t.luce"}}
  ]}' > /dev/null

echo "== il motore LVGL disegna la pagina =="
"$LVGL" --base-url "http://localhost:$VP" --page "Pagina 1" --istantanea "$WORK/p.ppm" \
  > "$WORK/lvgl.log" 2>&1
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
def centro(x, y):
    i = (y * w + x) * 3
    return tuple(px[i:i+3])
def vicino(c, atteso, t=14):
    return all(abs(a - b) <= t for a, b in zip(c, atteso))
fondo = (0x10, 0x18, 0x20)
casi = [
    ("luminosità −50 scurisce verso il nero", (100, 80), (64, 64, 64)),
    ("luminosità +50 schiarisce verso il bianco", (300, 80), (191, 191, 191)),
    ("opacità legata al tag (0,25) lascia vedere il fondo",
     (500, 80), tuple(round(0.25 * 128 + 0.75 * f) for f in fondo)),
    ("luminosità legata al tag (−100) arriva al nero", (700, 80), (0, 0, 0)),
]
for nome, (x, y), atteso in casi:
    c = centro(x, y)
    ok(vicino(c, atteso), f"{nome}: pixel {c}, atteso ~{atteso}")
sys.exit(male)
PY
esito=$?
[ $esito -eq 0 ] && echo -e "\n\033[32mTUTTO OK\033[0m"
exit $esito
