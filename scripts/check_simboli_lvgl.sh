#!/usr/bin/env bash
#
# Ogni simbolo della libreria si disegna sul motore LVGL — e finisce.
#
# PERCHÉ ESISTE
#
# Il 2026-09-06 il simbolo `boiler`, da solo su una pagina, **bloccava il viewer
# LVGL per sempre**: nessun errore, nessun log, il processo semplicemente non
# arrivava mai a disegnare. Su un pannello significa schermo nero e un tecnico
# che cerca la causa nel posto sbagliato.
#
# La causa: la sua fiamma era un poligono a cinque punti **concavo**, e
# `lv_canvas_draw_polygon` di LVGL 8 lavora solo su poligoni convessi — su uno
# concavo non termina. Un simbolo su quaranta, e per attribuirglielo sono serviti
# una bisezione e un cronometro.
#
# Nessun test poteva accorgersene: un blocco non fallisce, **aspetta**. Serve un
# limite di tempo, ed è quello che fa questa guardia — un simbolo alla volta,
# così quando cade si sa quale.
#
# Uso:
#   cargo build -p sws-runtime -p sws-lvgl-viewer
#   cd sws-editor && pnpm build
#   ./scripts/check_simboli_lvgl.sh
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
LVGL="sws-runtime/target/debug/sws-lvgl-viewer"
DIST="sws-editor/dist"
WORK="${TMPDIR:-/tmp}/sws-simboli-lvgl.$$"
AP="${APORT:-8717}"
VP="${VPORT:-8718}"
LIMITE="${LIMITE:-20}"   # secondi per simbolo: uno sano ci mette ~0,1 s

[ -x "$BIN" ]  || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -x "$LVGL" ] || { echo "manca $LVGL — esegui: cargo build -p sws-lvgl-viewer" >&2; exit 1; }
# I simboli *vendored* sono file SVG serviti dal runtime: senza `--www` non si
# scaricano e la prova direbbe di no per il motivo sbagliato.
[ -f "$DIST/symbols/reactor.svg" ] || { echo "manca $DIST/symbols — esegui: cd sws-editor && pnpm build" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
trap '[ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null; rm -rf "$WORK"' EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "examples/templates" --www "$DIST" \
  --viewer-port "$VP" --admin-port "$AP" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
su=0
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$AP/health" && { su=1; break; }; sleep 0.5; done
if [ "$su" -ne 1 ]; then
  echo "✗ il runtime di prova non risponde su :$AP — non è la misura che fallisce, è l'avvio" >&2
  tail -20 "$WORK/rt.log" >&2; exit 1
fi

API="http://localhost:$AP/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"simboli"}' > /dev/null
curl -sf -X POST "$API/projects/simboli/open" > /dev/null

# L'elenco viene dalla libreria dell'editor: è quello che la palette offre
# davvero, ed è la stessa fonte che usa `check_lvgl_symbols.sh`.
mapfile -t SIMBOLI < <(grep -oE 'id: "[a-z_0-9]+"' sws-editor/src/symbols/library.tsx | sed 's/id: "//; s/"//')
if [ "${#SIMBOLI[@]}" -lt 10 ]; then
  echo "✗ letti solo ${#SIMBOLI[@]} simboli da sws-editor/src/symbols/library.tsx" >&2
  echo "  La forma delle voci è cambiata: questo controllo non sta più guardando niente." >&2
  exit 1
fi

# I simboli che il motore LVGL **non sa disegnare**: li rende come un riquadro
# rosso d'errore, e sul pannello si vedono così mentre nel browser sono giusti.
#
# Sono un gap dichiarato, non un difetto muto: Q15 aveva deciso di riscrivere a
# mano i simboli che esistevano allora (sedici), e questi tredici sono la serie
# valvole/processo aggiunta dopo, mai portata. L'elenco sta qui perché la
# guardia possa distinguere «lo sapevamo» da «ne è comparso un altro»: un
# simbolo nuovo che non arriva sul pannello fa fallire, invece di scivolare in
# un elenco che cresce da solo.
IGNOTI_NOTI=(
  valve_motorized valve_pneumatic check_valve valve_3way relief_valve
  strainer blower silo conveyor cyclone column furnace chiller
)

echo "== ${#SIMBOLI[@]} simboli, uno alla volta, limite ${LIMITE}s ciascuno =="
bloccati=(); vuoti=(); ignoti_nuovi=(); ignoti_visti=()
for s in "${SIMBOLI[@]}"; do
  curl -sf -X PUT "$API/synoptics/Pagina%201" -H 'Content-Type: application/json' -d "{
    \"id\":\"pagina-1\",\"name\":\"Pagina 1\",\"width\":200,\"height\":200,\"background\":\"#101820\",
    \"objects\":[{\"id\":\"s\",\"type\":\"symbol\",\"x\":50,\"y\":50,\"width\":100,\"height\":100,\"symbol_id\":\"$s\"}]}" > /dev/null
  if ! timeout "$LIMITE" "$LVGL" --base-url "http://localhost:$VP" --page "Pagina 1" \
        --istantanea "$WORK/s.ppm" > "$WORK/s.log" 2>&1; then
    printf '  \033[31m✗\033[0m %-22s non ha finito entro %ss\n' "$s" "$LIMITE"
    bloccati+=("$s")
    continue
  fi
  # Ha disegnato qualcosa? Un simbolo che non lascia un pixel è un altro
  # difetto, e senza questo controllo passerebbe per sano.
  n=$(python3 - "$WORK/s.ppm" <<'PY'
import sys, io
d = io.open(sys.argv[1], "rb").read(); t = d.split(b"\n", 3)
w, h = map(int, t[1].split()); px = t[3]
sf = (0x10, 0x18, 0x20)
print(sum(1 for i in range(0, w*h*3, 3)
          if abs(px[i]-sf[0]) > 6 or abs(px[i+1]-sf[1]) > 6 or abs(px[i+2]-sf[2]) > 6))
PY
)
  if [ "$n" -lt 50 ]; then
    printf '  \033[31m✗\033[0m %-22s disegnato ma vuoto (%s px)\n' "$s" "$n"
    vuoti+=("$s")
    continue
  fi
  # Riquadro rosso d'errore = il motore non conosce questo `symbol_id`.
  rosso=$(python3 - "$WORK/s.ppm" <<'PY'
import sys, io
d = io.open(sys.argv[1], "rb").read(); t = d.split(b"\n", 3)
w, h = map(int, t[1].split()); px = t[3]
print(sum(1 for i in range(0, w*h*3, 3)
          if abs(px[i]-0x7f) <= 10 and abs(px[i+1]-0x1d) <= 10 and abs(px[i+2]-0x1d) <= 10))
PY
)
  if [ "$rosso" -gt 500 ]; then
    if printf '%s\n' "${IGNOTI_NOTI[@]}" | grep -qx "$s"; then
      ignoti_visti+=("$s")
    else
      printf '  \033[31m✗\033[0m %-22s il motore non lo conosce (riquadro rosso), e non è nell'"'"'elenco noto\n' "$s"
      ignoti_nuovi+=("$s")
    fi
  fi
done

echo
if [ "${#bloccati[@]}" -gt 0 ]; then
  echo -e "\033[31m${#bloccati[@]} simboli bloccano il viewer: ${bloccati[*]}\033[0m"
  echo "    Un blocco qui vuol dire schermo nero sul pannello, senza nessun errore."
  echo "    Causa nota: un poligono **concavo** passato a sym_polygon —"
  echo "    lv_canvas_draw_polygon di LVGL 8 vuole poligoni convessi e su uno"
  echo "    concavo non termina. Si spezza in triangoli, come fa già \`boiler\`."
fi
[ "${#vuoti[@]}" -gt 0 ] && echo -e "\033[31m${#vuoti[@]} simboli non disegnano niente: ${vuoti[*]}\033[0m"
if [ "${#ignoti_nuovi[@]}" -gt 0 ]; then
  echo -e "\033[31m${#ignoti_nuovi[@]} simboli NUOVI che il pannello non sa disegnare: ${ignoti_nuovi[*]}\033[0m"
  echo "    Nel browser si vedono, sul pannello sono un riquadro rosso: è una"
  echo "    divergenza WYSIWYG, e chi disegna non ha modo di accorgersene."
  echo "    O si implementa il simbolo in \`disegna_simbolo\` (lvgl_render.rs), o"
  echo "    si aggiunge a IGNOTI_NOTI in questo script — ma allora **con una riga**"
  echo "    in Q15, perché un elenco che cresce in silenzio non è un gap dichiarato."
fi
# Chi era nell'elenco e adesso si disegna: bene, ma l'elenco va accorciato, o
# tornerà a mentire come tutti gli elenchi che nessuno rilegge.
for noto in "${IGNOTI_NOTI[@]}"; do
  if ! printf '%s\n' "${ignoti_visti[@]}" | grep -qx "$noto"; then
    echo -e "\033[33m•\033[0m $noto è in IGNOTI_NOTI ma adesso si disegna: toglilo dall'elenco"
  fi
done
if [ "${#bloccati[@]}" -eq 0 ] && [ "${#vuoti[@]}" -eq 0 ] && [ "${#ignoti_nuovi[@]}" -eq 0 ]; then
  echo -e "\033[32mtutti e ${#SIMBOLI[@]} i simboli si disegnano e finiscono\033[0m — ${#ignoti_visti[@]} come riquadro d'errore, gap noto (Q15)."
  exit 0
fi
exit 1
