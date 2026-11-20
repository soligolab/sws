#!/usr/bin/env bash
#
# The animated pieces of a project symbol on the LVGL viewer (plan
# docs/plans/2026-11-19-animazioni-dei-simboli.md, session 2c).
#
# WHY IT EXISTS
#
# The rule of the pieces is shared and tested (`symbol-pieces.json`), but that
# the panel moves the pictures — `set_pos`, `img_opa`, the swap of a signal's
# colour, the window of a level growing from its side — only a photograph of
# the real engine says. Three copies of `tests/fixtures/simboli-prj/animated-pieces.json`
# with fixed values: still and at the start (a), everything on (b), the hidden
# entry of the signal (c). Five snapshots along a second for what moves in time.
#
# Usage:
#   cargo build -p sws-runtime -p sws-lvgl-viewer
#   (cd sws-editor && pnpm build)   # the library, served with --www
#   ./scripts/check_pezzi_lvgl.sh
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
DIST="sws-editor/dist"
FIXTURE="tests/fixtures/simboli-prj/animated-pieces.json"
WORK="${TMPDIR:-/tmp}/sws-pezzi-lvgl.$$"
AP="${APORT:-8748}"
VP="${VPORT:-8749}"

[ -x "$BIN" ]  || { echo "missing $BIN — run: cargo build -p sws-runtime" >&2; exit 1; }
[ -x "$LVGL" ] || { echo "missing $LVGL — run: cargo build -p sws-lvgl-viewer" >&2; exit 1; }
[ -d "$DIST" ] || { echo "missing $DIST — run: cd sws-editor && pnpm build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
trap '[ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null; rm -rf "$WORK"' EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "examples/templates" --www "$DIST" --senza-autenticazione \
  --viewer-port "$VP" --admin-port "$AP" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
su=0
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$AP/health" && { su=1; break; }; sleep 0.5; done
if [ "$su" -ne 1 ]; then
  echo "✗ the test runtime doesn't answer on :$AP — the start failed, not the measure" >&2
  tail -20 "$WORK/rt.log" >&2; exit 1
fi

API="http://localhost:$AP/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"pezzi"}' > /dev/null
curl -sf -X POST "$API/projects/pezzi/open" > /dev/null
python3 -c "import json, sys; print(json.dumps([json.load(open(sys.argv[1]))]))" "$FIXTURE" > "$WORK/simboli.json"
if ! curl -sf -X PUT "$API/project/simboli" -H 'Content-Type: application/json' --data @"$WORK/simboli.json" > /dev/null; then
  echo "✗ the runtime refuses $FIXTURE" >&2; exit 1
fi
sym() { # id x parts
  echo "{\"id\":\"$1\",\"type\":\"symbol\",\"symbol_id\":\"prj:animated-pieces\",\"x\":$2,\"y\":20,\"width\":240,\"height\":200,\"symbol_parts\":$3}"
}
A=$(sym a 20 '{"gate":{"value":0},"beacon":{"value":1},"tank":{"value":30},"motor":{"value":false},"glow":{"value":false},"fan":{"value":false}}')
B=$(sym b 280 '{"gate":{"value":1},"beacon":{"value":5},"tank":{"value":70},"motor":{"value":true},"glow":{"value":true},"fan":{"value":true}}')
C=$(sym c 540 '{"beacon":{"value":0}}')
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d "{
  \"id\":\"pagina-1\",\"name\":\"Pagina 1\",\"width\":800,\"height\":260,\"background\":\"#101820\",
  \"objects\":[$A,$B,$C]}" > /dev/null

echo "== five snapshots along a second =="
for i in 1 2 3 4 5; do
  "$LVGL" --base-url "http://localhost:$VP" --page "Pagina 1" \
    --istantanea "$WORK/p$i.ppm" --istantanea-ms $((300 + i * 130)) > "$WORK/lvgl$i.log" 2>&1
done
grep -m1 -E "creati correttamente" "$WORK/lvgl1.log" | sed 's/^/  /'
grep -m1 -E "^animations:" "$WORK/lvgl1.log" | sed 's/^/  /'

python3 - "$WORK" <<'PY'
import sys
work = sys.argv[1]
bad = 0
def ok(c, m):
    global bad
    print(("  \033[32m✓\033[0m " if c else "  \033[31m✗\033[0m ") + m)
    if not c: bad = 1

def read(p):
    d = open(p, "rb").read()
    head = d.split(b"\n", 3)
    w, h = map(int, head[1].split())
    return w, head[3]

shots = [read(f"{work}/p{i}.ppm") for i in range(1, 6)]
def px(n, x, y):
    w, b = shots[n]
    i = (y * w + x) * 3
    return b[i], b[i + 1], b[i + 2]

# The symbol is drawn at twice its size; object a at x=20, b at 280, c at 540, all at y=20.
def at(obj, ux, uy):
    return (obj + round(ux * 2), 20 + round(uy * 2))

A, B, C = 20, 280, 540
# The signal: green on a, red (or dim, blinking) on b, hidden on c.
r, g, bl = px(0, *at(A, 98, 78))
ok(g > 150 and r < 120, f"the signal of a takes the colour of its entry (green): {(r, g, bl)}")
reds = [px(n, *at(B, 98, 78))[0] for n in range(5)]
ok(max(reds) > 200 and min(reds) < 120, f"the signal of b is red and blinks: red channel {reds}")
hidden = px(0, *at(C, 98, 78))
ok(not (hidden[1] > 150 and hidden[0] < 120) and hidden[0] < 150, f"the signal of c is hidden: {hidden}")
# The slide: the gate of b went up by 32 px; where a's gate is, b has the background.
gate_a = px(0, *at(A, 98, 50))
gate_b = px(0, *at(B, 98, 50))
gate_b_up = px(0, *at(B, 98, 34))
ok(gate_a != gate_b and gate_b_up[0] > 50, f"the gate of b slid up: a {gate_a}, b {gate_b}, b 16 units higher {gate_b_up}")
# The level grows from the left: 30 % on a, 70 % on b, at 50 % of its window only b is full.
mid_a = px(0, *at(A, 44 + 16, 14))
mid_b = px(0, *at(B, 44 + 16, 14))
ok(mid_a != mid_b, f"the level fills from the left, 30 against 70 %: middle of the window a {mid_a}, b {mid_b}")
# The vibration: the left edge of b's motor moves; a's stays.
def left_edge(n, obj):
    y = 20 + 2 * 78
    for x in range(obj + 10, obj + 90):
        p = px(n, x, y)
        if p[0] > 140 and p[1] > 140:
            return x
    return None
edges_b = [left_edge(n, B) for n in range(5)]
edges_a = [left_edge(n, A) for n in range(5)]
ok(len(set(edges_b)) > 1, f"the motor of b vibrates: left edge {edges_b}")
ok(len(set(edges_a)) == 1, f"the motor of a stays: left edge {edges_a}")
# The pulse: the glow of b breathes, a's doesn't.
glow_b = [px(n, *at(B, 60, 78))[0] for n in range(5)]
glow_a = [px(n, *at(A, 60, 78))[0] for n in range(5)]
ok(max(glow_b) - min(glow_b) > 12, f"the glow of b breathes: {glow_b}")
ok(max(glow_a) - min(glow_a) < 4, f"the glow of a stays: {glow_a}")
print()
print("\033[32mpieces: the panel moves them as the shared rule says.\033[0m" if not bad
      else "\033[31mpieces: something doesn't move as it should.\033[0m")
sys.exit(bad)
PY
