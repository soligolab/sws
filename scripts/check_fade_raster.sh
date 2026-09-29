#!/usr/bin/env bash
#
# Il lampeggio sfumato si vede anche sugli oggetti disegnati come immagine?
#
# PERCHÉ ESISTE
#
# Il 29-09-2026, collaudando l'avviso di aggiornamento sul WP630, il maintainer
# nota che «un oggetto polilinea che aveva il fade abilitato... si è fermato ed
# è acceso fisso». Non era una regressione: il fade su quegli oggetti non aveva
# **mai** funzionato. LVGL ha due strade per alterare i colori — il
# `color_filter_cb` dello stile, che tocca ciò che disegna lui (rect, bordi,
# testo), e `img_recolor`, che tocca i pixel di un'immagine — e il viewer
# percorreva solo la prima. Polilinee, poligoni, simboli e path sono bitmap SVG
# rasterizzate, quindi restavano accesi fissi. Il blink **a scatti** invece si
# vedeva, perché passa dall'opacità dell'oggetto: è per questo che il difetto è
# rimasto invisibile tanto a lungo — «il lampeggio funziona» era vero per metà.
#
# I test di `effects.rs` provano la matematica del recolor, compresa
# l'equivalenza col filtro. Ma che il recolor arrivi **ai pixel**, e su un
# oggetto raster, lo dice solo una fotografia del motore vero: è la stessa
# ragione per cui esiste `check_luce_lvgl.sh`, di cui questa guardia è la
# sorella.
#
# COME MISURA
#
# Il respiro segue l'orologio comune, quindi la fase di uno scatto non si può
# decidere: si prendono **cinque** istantanee lungo un periodo e si guarda
# l'escursione del colore. Un oggetto che respira la mostra, uno fermo no —
# e nessuna delle due cose dipende dal momento in cui parte la prova.
#
# Uso:
#   cargo build -p sws-runtime -p sws-lvgl-viewer
#   ./scripts/check_fade_raster.sh
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
WORK="${TMPDIR:-/tmp}/sws-fade-raster.$$"
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
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"fade"}' > /dev/null
curl -sf -X POST "$API/projects/fade/open" > /dev/null
# Periodo corto (1 s) così cinque scatti coprono il giro intero.
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id":"pagina-1","name":"Pagina 1","width":800,"height":480,"background":"#101820",
  "objects":[
    {"id":"raster","type":"polyline","x":40,"y":40,"stroke":"#ff0000","stroke_width":40,
     "closed":false,"blink_mode":"always","blink_rate_ms":1000,"blink_style":"fade",
     "points":[{"x":40,"y":60},{"x":260,"y":60}]},
    {"id":"nativo","type":"rect","x":40,"y":140,"width":220,"height":60,"fill":"#ff0000",
     "blink_mode":"always","blink_rate_ms":1000,"blink_style":"fade"},
    {"id":"fermo","type":"rect","x":40,"y":260,"width":220,"height":60,"fill":"#ff0000"}
  ]}' > /dev/null

echo "== cinque istantanee lungo un periodo di respiro =="
for i in 1 2 3 4 5; do
  "$LVGL" --base-url "http://localhost:$VP" --page "Pagina 1" \
    --istantanea "$WORK/p$i.ppm" --istantanea-ms $((200 + i * 220)) > "$WORK/lvgl$i.log" 2>&1
done
grep -m1 -E "creati correttamente" "$WORK/lvgl1.log" | sed 's/^/  /'

python3 - "$WORK" <<'PY'
import sys
work = sys.argv[1]
male = 0
def ok(c, m):
    global male
    print(("  \033[32m✓\033[0m " if c else "  \033[31m✗\033[0m ") + m)
    if not c: male = 1

def leggi(p):
    d = open(p, "rb").read()
    testa = d.split(b"\n", 3)
    w, h = map(int, testa[1].split())
    return w, testa[3]

def rosso_medio(px, w, x0, y0, x1, y1):
    s = n = 0
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            s += px[(y * w + x) * 3]; n += 1
    return s / n

# La polilinea è spessa 40 px centrata su y=60; il rect nativo e quello fermo
# sono riquadri pieni. Si guarda il canale rosso: gli oggetti sono #ff0000 su
# fondo scuro, e il respiro lo scurisce.
aree = {
    "raster": (60, 45, 250, 75),
    "nativo": (50, 150, 250, 190),
    "fermo":  (50, 270, 250, 310),
}
serie = {k: [] for k in aree}
for i in range(1, 6):
    w, px = leggi(f"{work}/p{i}.ppm")
    for k, (x0, y0, x1, y1) in aree.items():
        serie[k].append(rosso_medio(px, w, x0, y0, x1, y1))

for k in ("raster", "nativo", "fermo"):
    v = serie[k]
    print(f"    {k:8} {' '.join(f'{x:6.1f}' for x in v)}   escursione {max(v)-min(v):5.1f}")

esc = {k: max(v) - min(v) for k, v in serie.items()}
# Soglia larga: basta provare che si muove, non di quanto. Il respiro di
# default scende al 40 %, quindi l'escursione vera è molto sopra.
ok(esc["raster"] > 12, f"la polilinea col fade respira (escursione {esc['raster']:.1f})")
ok(esc["nativo"] > 12, f"il rect col fade respira (escursione {esc['nativo']:.1f})")
ok(esc["fermo"] < 6, f"l'oggetto senza effetti resta fermo (escursione {esc['fermo']:.1f})")
print()
print("\033[32mfade: si vede anche sugli oggetti raster.\033[0m" if not male
      else "\033[31mfade: qualcosa non si muove come dovrebbe.\033[0m")
sys.exit(male)
PY
