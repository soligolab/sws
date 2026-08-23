#!/usr/bin/env bash
#
# F7.5 — il motivo della conferma di un allarme finisce nel journal?
#
# Perché esiste: il motivo NON entra nell'evento di storico (avrebbe richiesto
# una migrazione dello schema degli eventi) ma nel journal di audit, che è già
# il registro hash-chained di chi-ha-fatto-cosa. È una scelta di
# implementazione: qui si verifica che regga davvero end-to-end, altrimenti la
# funzione sembrerebbe presente e non registrerebbe niente.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_ack_reason.sh
#
# Runtime scratch dichiarato (porta 8662, dir temporanea), terminato dal trap.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-ackreason.$$"
APORT="${APORT:-8662}"

mkdir -p "$WORK"/{config,projects}
cleanup() { [ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "$REPO/examples/templates" --www "$REPO/sws-editor/dist" \
  --admin-port "$APORT" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$APORT/health" && break; sleep 0.5; done
curl -sf -o /dev/null "http://localhost:$APORT/health" || { echo "runtime non partito:"; tail -20 "$WORK/rt.log"; exit 1; }

API="http://localhost:$APORT/api"
curl -sf -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"ack-test"}' > /dev/null
curl -sf -X POST "$API/projects/ack-test/open" > /dev/null

fail=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }

# Un allarme su un tag interno, poi lo si fa scattare.
curl -sf -X PUT "$API/project/tags" -H 'Content-Type: application/json' \
  -d '[{"id":"t.press","description":"pressione"}]' > /dev/null
curl -sf -X PUT "$API/project/alarms" -H 'Content-Type: application/json' -d '[
  {"id":"AL_PRESS","tag":"t.press","message":"Pressione alta","severity":"Warning",
   "condition":{"kind":"above","threshold":10}}
]' > /dev/null || bad "PUT /api/project/alarms non accettato"
curl -sf -X PUT "$API/tags/t.press" -H 'Content-Type: application/json' -d '{"value": 42}' > /dev/null
sleep 2

state=$(curl -sf "$API/alarms" | python3 -c 'import json,sys; a=json.load(sys.stdin); print(next((x["isa_state"] for x in a if x["def"]["id"]=="AL_PRESS"), "assente"))')
[ "$state" != "assente" ] && ok "allarme presente (stato: $state)" || bad "allarme AL_PRESS non trovato"

# Conferma CON motivo.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/alarms/AL_PRESS/ack" \
  -H 'Content-Type: application/json' -d '{"by":"mario","reason":"guasto noto, intervento programmato"}')
[ "$code" = "204" ] && ok "ack con motivo accettato (204)" || bad "ack ha risposto $code"

# Il motivo deve comparire nel journal di audit.
if curl -sf "$API/audit?limit=50" | grep -q "guasto noto, intervento programmato"; then
  ok "motivo registrato nel journal di audit"
else
  bad "motivo NON presente in /api/audit"
  curl -sf "$API/audit?limit=10" | tail -c 600
fi
# …e l'azione deve essere identificabile, non solo il testo libero.
if curl -sf "$API/audit?limit=50" | grep -q '"alarm.ack"'; then
  ok "azione 'alarm.ack' nel journal"
else
  bad "nessuna voce alarm.ack nel journal"
fi

# Un ack senza motivo resta valido (campo opzionale).
code2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/alarms/AL_PRESS/ack" \
  -H 'Content-Type: application/json' -d '{"by":"mario"}')
[ "$code2" = "204" ] && ok "ack senza motivo ancora accettato (retro-compatibile)" || bad "ack senza motivo: $code2"

echo
[ "$fail" -eq 0 ] && echo "TUTTO OK" || { echo "$fail PROBLEMI"; exit 1; }
