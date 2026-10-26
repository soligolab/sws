#!/usr/bin/env bash
#
# L'accesso dal pannello: la tastiera si vede, scrive, e se ne va.
#
# Perche' esiste. Il 23-10-2026 sul WP630 premere "Aggiorna ora" senza essere
# amministratore portava in un vicolo cieco, e il pannello restava inservibile.
# Erano TRE difetti sommati, e nessuno dei tre si vedeva leggendo il codice:
#
#   1. L'avviso stende un velo all'86% su tutto lo schermo. Sotto c'era la
#      tastiera: i tasti finivano a (24,28,41) su un fondo (0,8,16). Su un
#      monitor si intravedono; sul vetro di un pannello, no. Sembrava che la
#      tastiera non ci fosse.
#   2. La radice dell'avviso e' a schermo intero e nasce CLICCABILE: si mangiava
#      ogni tocco diretto ai tasti. Anche vedendola, non si poteva scrivere.
#   3. Chiudendo l'accesso la tastiera non veniva distrutta - si buttava via
#      solo la maniglia in Rust. Restava sullo schermo, a schermo intero e
#      cliccabile, e da li' in poi il pannello non rispondeva piu' a niente.
#
# La guardia rifa' i tre gesti con `--avviso-di-prova nuova` e `--tocca`, che
# esistono apposta per vedere questi avvisi senza aspettare un aggiornamento
# vero. Il bottone non e' cablato: si cerca per colore, cosi' se la fila cambia
# la guardia lo dice invece di toccare il vuoto.
#
# Uso:
#   cargo build -p sws-runtime -p sws-lvgl-viewer && cd sws-editor && pnpm build
#   ./scripts/check_accesso_lvgl.sh
#
# Runtime scratch dichiarato (porte 8696/8697, dir temporanea), chiuso dal trap.
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
DIST="sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-accesso-lvgl.$$"
AP="${APORT:-8696}"
VP="${VPORT:-8697}"

[ -x "$BIN" ]  || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -x "$LVGL" ] || { echo "manca $LVGL — esegui: cargo build -p sws-lvgl-viewer" >&2; exit 1; }
[ -d "$DIST/symbols/lib" ] || { echo "manca $DIST — esegui: cd sws-editor && pnpm build" >&2; exit 1; }

# **I binari devono essere piu' nuovi dei sorgenti.**
#
# Il 26-10-2026 questa guardia e' passata due volte di fila su eseguibili del
# giro precedente: la build era fallita, lei ha trovato quelli vecchi e li ha
# collaudati senza accorgersene. Un verde cosi' e' peggio di un rosso, perche'
# certifica una schermata che non esiste piu'.
vecchi="$(find sws-runtime/crates/sws-lvgl-viewer/src sws-runtime/crates/sws-core/src \
            -name '*.rs' -newer "$LVGL" 2>/dev/null | head -3)"
if [ -n "$vecchi" ]; then
  echo "✗ il binario e' piu' VECCHIO dei sorgenti: collauderesti il codice di prima." >&2
  echo "$vecchi" | sed 's/^/      /' >&2
  echo "    cd sws-runtime && cargo build -p sws-runtime -p sws-lvgl-viewer" >&2
  exit 1
fi

mkdir -p "$WORK"/{config,projects}
trap '[ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null; rm -rf "$WORK"' EXIT
cp -r examples/templates/demo-items-lvgl "$WORK/projects/demo"

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" --project "$WORK/projects/demo" \
  --templates-root "examples/templates" --www "$DIST" --viewer-port "$VP" --senza-autenticazione --admin-port "$AP" \
  > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
su=0
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$AP/health" && { su=1; break; }; sleep 0.5; done
if [ "$su" -ne 1 ]; then
  echo "✗ il runtime di prova non risponde su :$AP — non è la misura che fallisce, è l'avvio" >&2
  tail -20 "$WORK/rt.log" >&2; exit 1
fi

foto() {  # foto <nome> [tocchi]
  local nome="$1" tocchi="${2:-}"
  local args=(--base-url "http://localhost:$VP" --avviso-di-prova nuova
              --istantanea "$WORK/$nome.ppm" --istantanea-ms 14000)
  [ -n "$tocchi" ] && args+=(--tocca "$tocchi")
  timeout 60 "$LVGL" "${args[@]}" > "$WORK/$nome.log" 2>&1 \
    || { echo "  ✗ il viewer non ha finito ($nome)"; tail -10 "$WORK/$nome.log"; exit 1; }
}

echo "== l'accesso dal pannello: due campi, due pulsanti, si vede, scrive, se ne va =="
foto avviso
AGG="$(python3 - "$WORK/avviso.ppm" <<'PY'
import sys
d=open(sys.argv[1],'rb').read(); t=d.split(b"\n",3); w,h=map(int,t[1].split()); px=t[3]
def p(x,y):
    i=(y*w+x)*3; return tuple(px[i:i+3])
# Il pulsante principale e' l'unico blu acceso della fila.
best=None
for y in range(h//2, h):
    xs=[x for x in range(w) if p(x,y)[2] > 150 and p(x,y)[2] > p(x,y)[0]+80]
    if len(xs) > 80:
        best=((min(xs)+max(xs))//2, y); break
print(f"{best[0]},{best[1]}" if best else "")
PY
)"
if [ -z "$AGG" ]; then
  echo "  ✗ il pulsante «Aggiorna ora» non si trova: la fila è cambiata, la guardia non sa più dove toccare"; exit 1
fi
echo "  (pulsante «Aggiorna ora» trovato a $AGG)"

foto tastiera "$AGG"

# **Dove toccare si cerca, non si cabla.** Il 26-10-2026 la schermata e'
# passata da due pannelli in fila (prima l'utente, poi la password) a uno solo
# con i due campi insieme, e le coordinate di prima puntavano al vuoto: il
# controllo «scrive nel campo» diceva zero senza che niente fosse rotto.
LETTURA="$(python3 - "$WORK/tastiera.ppm" <<'PY'
import sys
d=open(sys.argv[1],'rb').read(); t=d.split(b"\n",3); w,h=map(int,t[1].split()); px=t[3]
def p(x,y):
    i=(y*w+x)*3; return tuple(px[i:i+3])
# Un tasto che SCRIVE. I tasti lettera hanno il fondo scuro (51,65,85); quelli
# chiari sono i speciali - backspace, ABC, le frecce, lo spazio, il OK. Cercare
# il chiaro, come faceva la prima stesura, trovava la freccia «sposta cursore»:
# premerla non scrive niente e il controllo diceva zero.
def scuro(c): return abs(c[0]-51)<12 and abs(c[1]-65)<12 and abs(c[2]-85)<12
cima=None
for y in range(h//2, h, 2):
    if sum(1 for x in range(0, w, 4) if scuro(p(x,y))) > 30:
        cima=y; break
tasto=None
if cima is not None:
    # Una riga di lettere, non l'ultima: a meta' fra la cima della tastiera e
    # il fondo, dove ci sono «a s d f g h j k l».
    y=(cima + h)//2
    xs=[x for x in range(0, w, 2) if scuro(p(x,y))]
    if len(xs) > 20:
        tasto=(xs[len(xs)//2], y)
# Il campo ATTIVO ha il bordo azzurro: e' l'unico modo di sapere dove si scrive.
def azzurro(c): return abs(c[0]-56)<30 and abs(c[1]-189)<30 and abs(c[2]-248)<30
ys=[y for y in range(0, h//2) if sum(1 for x in range(0, w, 3) if azzurro(p(x,y))) > 40]
campo=(min(ys), max(ys)) if ys else None
# I due pulsanti, cercati **per colore** nella fascia fra i campi e la
# tastiera. Dal 26-10-2026 sono due e stanno ai capi della colonna centrale:
# «Annulla» grigio a sinistra, «Accedi» blu a destra - lo stesso blu di
# «Aggiorna ora». Cercare il grigio solo nella meta' destra, come faceva la
# prima stesura, adesso non lo troverebbe piu'.
def grigio(c): return abs(c[0]-51)<14 and abs(c[1]-65)<14 and abs(c[2]-85)<14
def blu(c): return abs(c[0]-29)<20 and abs(c[1]-78)<20 and abs(c[2]-216)<25
def cerca(pred):
    if not campo: return None
    for y in range(h//2-10, campo[1], -3):
        xs=[x for x in range(0, w, 3) if pred(p(x,y))]
        if len(xs) > 30:
            return ((min(xs)+max(xs))//2, y)
    return None
btn=cerca(grigio)
acc=cerca(blu)
print(f"{tasto[0]},{tasto[1]}" if tasto else "-",
      f"{campo[0]},{campo[1]}" if campo else "-",
      f"{btn[0]},{btn[1]}" if btn else "-",
      f"{acc[0]},{acc[1]}" if acc else "-")
PY
)"
TASTO="$(echo "$LETTURA" | cut -d' ' -f1)"
CAMPO="$(echo "$LETTURA" | cut -d' ' -f2)"
ANNULLA="$(echo "$LETTURA" | cut -d' ' -f3)"
ACCEDI="$(echo "$LETTURA" | cut -d' ' -f4)"
if [ "$TASTO" = "-" ] || [ "$CAMPO" = "-" ] || [ "$ANNULLA" = "-" ]; then
  echo "  ✗ sulla schermata di accesso non trovo tasto/campo attivo/Annulla ($LETTURA): il disegno è cambiato"; exit 1
fi
# **«Accedi» deve esserci.** Fino al 26-10-2026 si confermava solo col ✓ della
# tastiera: l'unico pulsante visibile era quello che ti butta fuori. Se questo
# controllo diventa rosso, il pannello e' tornato in quello stato.
if [ "$ACCEDI" = "-" ]; then
  echo "  ✗ il pulsante «Accedi» non si trova: resta solo «Annulla», e si conferma solo col ✓ della tastiera"; exit 1
fi
if [ "${ACCEDI%%,*}" -le "${ANNULLA%%,*}" ]; then
  echo "  ✗ «Accedi» ($ACCEDI) non sta a destra di «Annulla» ($ANNULLA): conferma e rinuncia si sono scambiate di posto"; exit 1
fi
echo "  (tasto $TASTO · campo attivo righe $CAMPO · «Annulla» $ANNULLA · «Accedi» $ACCEDI)"

foto scritto  "$AGG;$TASTO"
foto chiusa   "$AGG;$ANNULLA"

python3 - "$WORK/tastiera.ppm" "$WORK/scritto.ppm" "$WORK/chiusa.ppm" "$CAMPO" <<'PY'
import sys
from collections import Counter
male = 0
def ok(c, m):
    global male
    print(("  \033[32m✓\033[0m " if c else "  \033[31m✗\033[0m ") + m)
    if not c: male = 1
def leggi(f):
    d=open(f,'rb').read(); t=d.split(b"\n",3); w,h=map(int,t[1].split()); return w,h,t[3]
def riga(f, y):
    w,h,px=leggi(f)
    return Counter(tuple(px[(y*w+x)*3:(y*w+x)*3+3]) for x in range(w))
def luminoso(c): return sum(c)
def contrasto(f, y):
    """Fra il colore più comune della riga dei tasti e il più chiaro: è quello
    che decide se un dito trova i tasti sul vetro di un pannello."""
    c = riga(f, y)
    fondo = c.most_common(1)[0][0]
    chiaro = max((col for col, n in c.items() if n > 20), key=luminoso)
    return fondo, chiaro, luminoso(chiaro) - luminoso(fondo)

fondo, chiaro, delta = contrasto(sys.argv[1], 543)
ok(delta > 150, f"la tastiera si vede: tasti {fondo}, scritte {chiaro}, stacco {delta} (prima era 17)")

# Dentro il campo ATTIVO - quello col bordo azzurro - dopo il tocco su un
# tasto ci dev'essere un segno. Le righe arrivano dalla lettura di sopra.
w,h,a = leggi(sys.argv[1]); _,_,b = leggi(sys.argv[2])
y0,y1 = (int(v) for v in sys.argv[4].split(","))
def px(buf,x,y): return tuple(buf[(y*w+x)*3:(y*w+x)*3+3])
diversi = sum(1 for x in range(20, w//2) for y in range(y0+4, y1-4) if px(a,x,y) != px(b,x,y))
ok(diversi > 10, f"premere un tasto scrive nel campo attivo (righe {y0}-{y1}, {diversi} pixel cambiati)")

# E dopo «Annulla» la tastiera non deve restare sullo schermo.
resta = any(abs(c[0]-49) < 12 and abs(c[1]-64) < 12 and abs(c[2]-82) < 12
            for c, n in riga(sys.argv[3], 543).items() if n > 100)
ok(not resta, "dopo «Annulla» la tastiera sparisce, e non resta a mangiarsi i tocchi")
sys.exit(male)
PY
esito=$?
[ "$esito" -eq 0 ] && echo -e "\033[32ml'accesso dal pannello si vede, scrive, e se ne va.\033[0m"
exit "$esito"
