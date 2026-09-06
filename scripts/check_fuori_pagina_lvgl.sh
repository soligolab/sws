#!/usr/bin/env bash
#
# T-52 — il «fuori pagina» sul motore LVGL, guardato davvero.
#
# PERCHÉ ESISTE
#
# Il piano di T-52 lo dice (rischio R13): il gate del fuori pagina su LVGL **non
# è verificabile a occhio**, perché LVGL ritaglia già da sé gli oggetti oltre il
# bordo dello screen. Provandolo si è visto che è ancora più vero di così:
# **disattivando il gate, i pixel sono identici**. Il piano diceva che senza il
# gate un oggetto a x = 66000 sarebbe rientrato per overflow di `i16`; non
# succede, perché il cast lì è da `f64` e in Rust `f64 as i16` satura (66000
# diventa 32767, non 464 — l'avvolgimento vale fra interi).
#
# Quindi questa guardia divide il lavoro in due, e conviene sapere quale metà
# fa cosa:
#
#   * **il riepilogo** («fuori pagina, non disegnati (3)») è l'unica asserzione
#     che distingue il gate acceso da quello spento. È lì che si accorge di una
#     regressione;
#   * **i pixel** provano che l'immagine è quella giusta — l'oggetto dentro c'è,
#     quello a cavallo del bordo c'è ed è ritagliato, quelli fuori non si vedono
#     — cioè che il gate non ha spento qualcosa di troppo. Da soli non
#     proverebbero il gate, e dirlo è meglio che lasciarlo credere.
#
# Come si guarda senza un pannello: `--istantanea` disegna la pagina col motore
# vero e salva un PPM. Si contano i pixel — non si giudica a occhio, e non serve
# nessun encoder.
#
# Uso:
#   cargo build -p sws-runtime -p sws-lvgl-viewer      # da sws-runtime/
#   ./scripts/check_fuori_pagina_lvgl.sh
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
WORK="${TMPDIR:-/tmp}/sws-fuori-pagina-lvgl.$$"
AP="${APORT:-8682}"
VP="${VPORT:-8683}"

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
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"fuoripagina"}' > /dev/null
curl -sf -X POST "$API/projects/fuoripagina/open" > /dev/null
# Cinque oggetti su una pagina 800x480: uno dentro, uno a cavallo del bordo
# destro (deve restare: si spegne solo ciò che è **interamente** fuori), e tre
# fuori in tre modi diversi — oltre il bordo, a coordinate negative, e oltre
# 32767, che è quello che senza il gate rientrerebbe dalla parte sbagliata.
curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d '{
  "id":"pagina-1","name":"Pagina 1","width":800,"height":480,"background":"#101820",
  "objects":[
    {"id":"dentro","type":"rect","x":100,"y":100,"width":200,"height":120,"fill":"#22c55e"},
    {"id":"a_cavallo","type":"rect","x":700,"y":300,"width":200,"height":120,"fill":"#f59e0b"},
    {"id":"fuori_dx","type":"rect","x":3000,"y":100,"width":200,"height":120,"fill":"#ef4444"},
    {"id":"fuori_neg","type":"rect","x":-500,"y":100,"width":200,"height":120,"fill":"#ef4444"},
    {"id":"overflow_i16","type":"rect","x":66000,"y":100,"width":200,"height":120,"fill":"#ef4444"}
  ]}' > /dev/null

echo "== il motore LVGL disegna la pagina =="
"$LVGL" --base-url "http://localhost:$VP" --page "Pagina 1" --istantanea "$WORK/p.ppm" \
  > "$WORK/lvgl.log" 2>&1
grep -E "creati correttamente|fuori pagina" "$WORK/lvgl.log" | sed 's/^/  /'

APPESO="$WORK/p.ppm" python3 - "$WORK/lvgl.log" <<'PY'
import os, sys, io
male = 0
log = open(sys.argv[1]).read()
def ok(c, m):
    global male
    print(("  \033[32m✓\033[0m " if c else "  \033[31m✗\033[0m ") + m)
    if not c: male = 1

ok("fuori pagina, non disegnati (3)" in log,
   "il riepilogo dichiara 3 oggetti saltati perché fuori pagina")
ok("dentro" in log and "a_cavallo" in log,
   "l'oggetto dentro e quello a cavallo del bordo sono stati creati")

d = open(os.environ["APPESO"], "rb").read()
testa = d.split(b"\n", 3)
w, h = map(int, testa[1].split())
px = testa[3]
def vicino(c, r, g, b, t=12):
    return abs(c[0]-r) <= t and abs(c[1]-g) <= t and abs(c[2]-b) <= t
verde = arancio = rosso = 0
for i in range(0, w*h*3, 3):
    c = px[i:i+3]
    if   vicino(c, 0x22, 0xc5, 0x5e): verde += 1
    elif vicino(c, 0xf5, 0x9e, 0x0b): arancio += 1
    elif vicino(c, 0xef, 0x44, 0x44): rosso += 1
print(f"  pixel: verde {verde}, arancio {arancio}, rosso {rosso}  (immagine {w}x{h})")

# I colori tornano quantizzati in RGB565 e i rettangoli hanno gli angoli
# smussati, quindi non si pretende il conto esatto: si pretende l'ordine di
# grandezza e, sul rosso, lo zero.
ok(verde > 20000, "l'oggetto dentro la pagina è disegnato (atteso ~24000 px, angoli smussati a parte)")
ok(4000 < arancio < verde, "quello a cavallo è disegnato e RITAGLIATO dal bordo (circa metà)")
ok(rosso == 0, "nessun pixel dei tre oggetti fuori pagina "
               "(vero anche col gate spento: qui si prova che non è stato spento nulla di troppo)")
sys.exit(male)
PY
esito=$?
[ $esito -eq 0 ] && echo -e "\n\033[32mTUTTO OK\033[0m"
exit $esito
