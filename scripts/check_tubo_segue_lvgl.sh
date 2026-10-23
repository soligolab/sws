#!/usr/bin/env bash
#
# Un tubo agganciato a un oggetto che una variabile sposta: lo segue DAL VIVO,
# sul motore LVGL?
#
# Perché esiste. Fino al 22-10-2026 no, e in due modi diversi:
#
#   1. Il percorso si calcolava sulla lista di oggetti GREZZA, mentre ogni
#      oggetto veniva disegnato alla posizione risolta dai suoi binding. Con un
#      `bindings.x` su una pompa, il tubo nasceva staccato già al primo
#      fotogramma — nessun tag doveva nemmeno cambiare.
#   2. Il percorso si calcolava **una volta sola**, al caricamento della pagina
#      (`percorso_tubo` aveva una sola chiamata viva, dentro `interpret_page`).
#      Dopo quella, la geometria del tubo era morta fino alla navigazione
#      successiva.
#
# Questa guardia misura il secondo, che contiene il primo: il valore cambia
# MENTRE il viewer lavora, e la fotografia dice dov'è finito il tubo.
#
# Due tubi, perché i due disegni sono due strade diverse dentro `render_pipe`:
# `flat` è una `lv_line` (si ridisegna coi punti), `metallo` è un canvas
# rasterizzato con resvg il cui pixmap ha la misura della creazione — se un
# capo esce dal riquadro va riallocato, ed è il pezzo che può rompersi in
# silenzio disegnando un tubo tagliato.
#
# Uso:
#   cargo build -p sws-runtime -p sws-lvgl-viewer
#   cd sws-editor && pnpm build
#   ./scripts/check_tubo_segue_lvgl.sh
#
# Runtime scratch dichiarato (porte 8690/8691, dir temporanea), terminato dal trap.
# Piano: docs/plans/2026-10-21-tubo-che-segue-gli-oggetti.md
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
DIST="sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-tubo-segue.$$"
AP="${APORT:-8690}"
VP="${VPORT:-8691}"

[ -x "$BIN" ]  || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -x "$LVGL" ] || { echo "manca $LVGL — esegui: cargo build -p sws-lvgl-viewer" >&2; exit 1; }
[ -d "$DIST/symbols/lib" ] || { echo "manca $DIST — esegui: cd sws-editor && pnpm build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
trap '[ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null; rm -rf "$WORK"' EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "examples/templates" --www "$DIST" --viewer-port "$VP" --senza-autenticazione --admin-port "$AP" \
  > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
su=0
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$AP/health" && { su=1; break; }; sleep 0.5; done
if [ "$su" -ne 1 ]; then
  echo "✗ il runtime di prova non risponde su :$AP — non è la misura che fallisce, è l'avvio" >&2
  tail -20 "$WORK/rt.log" >&2; exit 1
fi

API="http://localhost:$AP/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"tubo-segue"}' > /dev/null
curl -sf -X POST "$API/projects/tubo-segue/open" > /dev/null
curl -sf -X PUT "$API/project/tags" -H 'Content-Type: application/json' -d '[
  {"id":"mov","description":"la x del blocco che si sposta"}
]' > /dev/null
# Posizione di partenza: il blocco accanto al fisso, i tubi corti.
curl -sf -X PUT "$API/tags/mov" -H 'Content-Type: application/json' -d '{"value": 100}' > /dev/null

# Due righe uguali, un disegno per riga. Il capo sinistro è fermo, il destro
# segue `mov`. Il magenta non compare altrove nella pagina: è il colore che
# dice «questo pixel è il tubo piatto».
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id":"pagina-1","name":"Pagina 1","width":800,"height":480,"background":"#101820",
  "objects":[
    {"id":"fisso","type":"rect","x":20,"y":200,"width":40,"height":60,"fill":"#334155"},
    {"id":"blocco","type":"rect","x":100,"y":200,"width":60,"height":60,"fill":"#22c55e",
     "bindings":{"x":"mov"}},
    {"id":"tubo_flat","type":"pipe","x":60,"y":200,"width":40,"height":60,
     "from_obj_id":"fisso","from_port":"right","to_obj_id":"blocco","to_port":"left",
     "pipe_style":"flat","stroke":"#ff00ff","stroke_width":14},

    {"id":"fisso2","type":"rect","x":20,"y":340,"width":40,"height":60,"fill":"#334155"},
    {"id":"blocco2","type":"rect","x":100,"y":340,"width":60,"height":60,"fill":"#22c55e",
     "bindings":{"x":"mov"}},
    {"id":"tubo_metallo","type":"pipe","x":60,"y":340,"width":40,"height":60,
     "from_obj_id":"fisso2","from_port":"right","to_obj_id":"blocco2","to_port":"left",
     "pipe_style":"metallo","stroke_width":18}
  ]}' > /dev/null

echo "== il blocco si sposta A PAGINA GIA' APERTA, e i tubi lo seguono =="
# `--cambia-tag` cambia il valore a meta' dell'istantanea, con la pagina gia'
# disegnata: e' l'unico modo di misurare `update_bindings`, perche' il tempo di
# `--istantanea` e' simulato e 4 secondi di LVGL costano un decimo di secondo di
# orologio — scrivere il tag da qui con un `curl` arriverebbe sempre tardi.
#
# Se il tubo fosse ancora geometria congelata al caricamento, la fotografia lo
# troverebbe dov'era a mov=100 mentre il blocco e' gia' a 600.
if ! timeout 40 "$LVGL" --base-url "http://localhost:$VP" --page "Pagina 1" \
  --istantanea "$WORK/p.ppm" --istantanea-ms 4000 --cambia-tag "mov=600" > "$WORK/lvgl.log" 2>&1; then
  echo "  ✗ il viewer non ha finito entro 40 s (o e' uscito con errore)"; tail -20 "$WORK/lvgl.log"; exit 1
fi
grep -E "cambio tag|creati correttamente" "$WORK/lvgl.log" | sed 's/^/  /'
[ -f "$WORK/p.ppm" ] || { echo "  ✗ nessuna istantanea"; tail -20 "$WORK/lvgl.log"; exit 1; }

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
magenta = (0xff, 0x00, 0xff)
verde = (0x22, 0xc5, 0x5e)

# Il blocco è partito da x=100 e deve stare a x=600..660: è la premessa, non
# la tesi. Se fallisce questa, il binding non è arrivato e il resto non si
# può leggere.
ok(vicino(pixel(630, 230), verde), "premessa: il blocco si è spostato a x=600 (binding vivo)")
# Sopra la fascia del tubo (che ora passa di li'): a y=210 c'e' solo il blocco,
# e il blocco non c'e' piu'.
ok(vicino(pixel(130, 210), fondo), "premessa: dove il blocco stava a t=0 ora c'è il fondo")

# La tesi, riga per riga.
ok(vicino(pixel(400, 230), magenta), "tubo flat: il corpo arriva a metà strada (x=400)")
ok(vicino(pixel(590, 230), magenta), "tubo flat: e tocca il blocco (x=590)")
ok(vicino(pixel(700, 230), fondo),  "tubo flat: e si ferma lì, non lo supera (x=700)")

# Il metallo non ha un colore dichiarato: il disegno viene dal materiale dello
# stile. Si guarda che NON sia fondo, cioè che il canvas 2.5D sia stato
# riallocato e ridisegnato fin lì invece di restare largo quanto a t=0.
ok(not vicino(pixel(400, 370), fondo), "tubo metallo: il canvas 2.5D arriva a x=400")
ok(not vicino(pixel(560, 370), fondo), "tubo metallo: e arriva fino al blocco (x=560)")
ok(vicino(pixel(720, 370), fondo),     "tubo metallo: e si ferma lì (x=720)")
sys.exit(male)
PY
esito=$?
[ "$esito" -eq 0 ] && echo -e "\033[32mil tubo segue l'oggetto che una variabile sposta, su tutti e due i disegni.\033[0m"
exit "$esito"
