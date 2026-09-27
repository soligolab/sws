#!/usr/bin/env bash
#
# Un allarme attivo e riconosciuto resta così quando il progetto si ricarica?
#
# Perché esiste (26-09-2026): ogni ricarica degli allarmi azzerava lo stato di
# tutti. Un deploy sul dispositivo fa chiudi → sostituisci i file → riapri, e
# a ogni «Invia ora» ogni allarme in corso «scattava» di nuovo: un Telegram
# per allarme sul telefono del maintainer, e nello storico una riga chiusa
# come interrotta più una nuova. Lo stesso salvando la scheda Allarmi. Qui un
# runtime vero (modalità dispositivo) fa scattare e riconoscere un allarme,
# poi salva gli allarmi e chiude e riapre il progetto: lo stato deve restare,
# e lo storico non deve avere righe in più.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_allarmi_ricarica.sh
#
# Runtime scratch dichiarato (porte 8692/8693, dir temporanea), terminato dal trap.
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-allarmi-ricarica.$$"
AP="${APORT:-8692}"
VP="${VPORT:-8693}"
[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "manca sqlite3" >&2; exit 1; }

mkdir -p "$WORK"/{config,projects/ricarica}
trap '[ -f "$WORK/rt.pid" ] && kill "$(cat "$WORK/rt.pid")" 2>/dev/null; rm -rf "$WORK"' EXIT
cat > "$WORK/projects/ricarica/project.yaml" <<'YAML'
meta:
  name: ricarica
  version: 0.1.0
tags:
  - { id: livello, data_type: float }
sources: []
alarms:
  - id: alto
    tag: livello
    levels:
      - condition: { kind: above, threshold: 50.0 }
        severity: Warning
        message: "livello alto"
datastores:
  - { id: default, label: d, backend: { kind: sqlite, path: history/historian.db } }
YAML

"$BIN" --config "$WORK/config" --projects-root "$WORK/projects" \
  --templates-root "examples/templates" --admin-port "$AP" --viewer-port "$VP" \
  --project "$WORK/projects/ricarica" > "$WORK/rt.log" 2>&1 &
echo $! > "$WORK/rt.pid"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$AP/health" && break; sleep 0.5; done
sleep 1
API="http://localhost:$AP/api"
DB="$WORK/projects/ricarica/history/historian.db"

male=0
ok() { echo -e "  \033[32m✓\033[0m $1"; }
ko() { echo -e "  \033[31m✗\033[0m $1"; male=1; }
stato() {  # stampa "attivo riconosciuto" dell'allarme `alto`
  curl -s "$API/alarms" | python3 -c '
import json,sys
a=[x for x in json.load(sys.stdin) if x["def"]["id"]=="alto"]
print(a[0]["active"], a[0]["acknowledged"]) if a else print("assente")'
}
righe() { sqlite3 "$DB" "SELECT count(*), coalesce(sum(interrotto),0) FROM alarm_events WHERE alarm_id='alto';"; }
scrivi() { curl -s -o /dev/null -X PUT "$API/tags/livello" -H 'Content-Type: application/json' -d "{\"value\": $1}"; }

echo "== l'allarme scatta e si riconosce =="
scrivi 80; sleep 0.5
curl -s -o /dev/null -X POST "$API/alarms/alto/ack" -H 'Content-Type: application/json' -d '{}'
sleep 0.5
[ "$(stato)" = "True True" ] && ok "attivo e riconosciuto" || ko "stato di partenza inatteso: $(stato)"
PRIMA=$(righe)

echo "== salvare la scheda Allarmi non lo fa riscattare =="
ALLARMI=$(curl -s "$API/project" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["alarms"]))')
curl -s -o /dev/null -X PUT "$API/project/alarms" -H 'Content-Type: application/json' -d "$ALLARMI"
scrivi 81; sleep 0.5
[ "$(stato)" = "True True" ] && ok "ancora attivo e riconosciuto" || ko "dopo il salvataggio: $(stato)"
[ "$(righe)" = "$PRIMA" ] && ok "storico invariato ($PRIMA)" || ko "storico cambiato: $PRIMA → $(righe)"

echo "== chiudere e riaprire (come un deploy) non lo fa riscattare =="
curl -s -o /dev/null -X POST "$API/projects/close"
curl -s -o /dev/null -X POST "$API/projects/ricarica/open"
sleep 1
scrivi 82; sleep 0.5
[ "$(stato)" = "True True" ] && ok "ancora attivo e riconosciuto" || ko "dopo chiudi/riapri: $(stato)"
[ "$(righe)" = "$PRIMA" ] && ok "storico invariato ($PRIMA): nessuna riga interrotta, nessuno scatto nuovo" \
                         || ko "storico cambiato: $PRIMA → $(righe)"

echo "== un allarme cambiato invece riparte (e scatta di nuovo, giustamente) =="
NUOVI=$(echo "$ALLARMI" | sed 's/50\.0/60.0/; s/"threshold": *50/"threshold": 60/')
curl -s -o /dev/null -X PUT "$API/project/alarms" -H 'Content-Type: application/json' -d "$NUOVI"
scrivi 83; sleep 0.5
[ "$(stato)" = "True False" ] && ok "soglia cambiata: riscatta, da riconoscere" || ko "dopo la modifica: $(stato)"

echo
[ $male -eq 0 ] && echo -e "\033[32mallarmi al ricaricamento: tutto verde.\033[0m"
exit $male
