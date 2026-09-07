#!/usr/bin/env bash
#
# Q27 — il `data_type` dichiarato è un contratto sui percorsi di scrittura.
#
# Perché esiste: fino al 2026-09-06 `PUT /api/tags/:id` accettava un valore di
# qualunque tipo e lo conservava così com'era — una stringa su un tag `bool`
# passava (204) e arrivava fino al plugin, cioè al PLC. La politica decisa col
# maintainer è la coercizione senza perdita: Int→float, Float intero→int,
# "true"/"false" e stringhe numeriche convertite; tutto il resto 400 con un
# messaggio che nomina tag, tipo dichiarato e valore ricevuto.
#
# Qui si prova end-to-end sul percorso HTTP (il più battuto): i casi di
# rifiuto, e che la coercizione *scriva davvero il tipo giusto* — il GET deve
# restituire `true` (bool JSON), non la stringa "true" che era il difetto.
# I percorsi WS/ricette/script passano dallo stesso `coerce_for_write`,
# coperto dai unit test in sws-core.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_tipo_scrittura.sh
#
# Runtime scratch dichiarato (porta 8666, dir temporanea), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-tiposcrittura.$$"
APORT="${APORT:-8666}"

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done

API="http://localhost:$APORT/api"
# demo-items-web: sources vuote, quindi ogni scrittura cade sul TagDb — esiti
# deterministici. demo.cmd.enable è bool SENZA auto-reset (button si azzera da
# solo dopo un secondo e renderebbe il GET una corsa).
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"q27","template":"demo-items-web"}' > /dev/null
curl -sf -X POST "$API/projects/q27/open" > /dev/null

ROSSI=0
caso() { # caso <descrizione> <tag> <json valore> <status atteso> [frammento atteso nel body]
  local desc="$1" tag="$2" val="$3" atteso="$4" fram="${5:-}"
  local body status
  body="$(mktemp "$WORK/body.XXXX")"
  status="$(curl -s -o "$body" -w '%{http_code}' -X PUT "$API/tags/$tag" \
    -H 'Content-Type: application/json' -d "{\"value\":$val}")"
  if [ "$status" != "$atteso" ]; then
    echo "  ✗ $desc — atteso $atteso, ricevuto $status ($(cat "$body"))"; ROSSI=$((ROSSI+1)); return
  fi
  if [ -n "$fram" ] && ! grep -q "$fram" "$body"; then
    echo "  ✗ $desc — il body non nomina «$fram»: $(cat "$body")"; ROSSI=$((ROSSI+1)); return
  fi
  echo "  ✓ $desc"
}

echo "== rifiuti (perdita o ambiguità) =="
caso 'stringa non booleana su bool → 400 col motivo' demo.cmd.enable '"abc"'  400 'bool'
caso 'float con frazione su int → 400'               demo.sim.counter '7.5'   400 'int'
caso 'numero su string → 400'                        demo.cmd.select '42'     400 'string'

echo "== coercizioni senza perdita =="
caso 'il caso storico: "true" su bool → 204'         demo.cmd.enable '"true"' 204
caso 'int su float → 204'                            demo.cmd.slider '5'      204
caso 'float intero su int → 204'                     demo.sim.counter '7.0'   204
caso 'stringa legittima su string → 204'             demo.cmd.select '"auto"' 204

echo "== il valore scritto ha il tipo dichiarato (il difetto era proprio qui) =="
python3 - "$API" <<'PY' || ROSSI=$((ROSSI+1))
import json, sys, urllib.request
api = sys.argv[1]
attesi = {
    "demo.cmd.enable":  (bool,  True),   # non la stringa "true"
    "demo.cmd.slider":  (float, 5.0),    # l'int del JSON, promosso
    "demo.sim.counter": (int,   7),      # il 7.0, ridotto senza perdita
}
rossi = 0
for tag, (tipo, valore) in attesi.items():
    with urllib.request.urlopen(f"{api}/tags/{tag}") as r:
        v = json.load(r)["value"]
    # in Python bool è sottoclasse di int: il confronto va fatto sul tipo esatto
    if type(v) is not tipo or v != valore:
        print(f"  ✗ {tag}: atteso {tipo.__name__} {valore}, letto {type(v).__name__} {v!r}")
        rossi += 1
    else:
        print(f"  ✓ {tag} = {tipo.__name__} {valore}")
sys.exit(1 if rossi else 0)
PY

if [ "$ROSSI" -gt 0 ]; then echo "FALLITO — $ROSSI controlli rossi"; exit 1; fi
echo "tipo in scrittura: tutto verde."
