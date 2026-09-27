#!/usr/bin/env bash
#
# Lo storico ha una strada sola, e l'IDE non scrive e non manda niente?
#
# Perché esiste (26-09-2026): lo storico di CasaDomotica pesava 590 MB e il
# 93 % erano ripetizioni. Due registratori scrivevano nello stesso file — il
# registro dei datastore (solo `history: true`, con banda morta e intervallo)
# e il buffer in RAM dei grafici, che salvava **ogni** aggiornamento di
# **ogni** tag. E lo facevano anche nell'IDE, che in più accendeva le
# notifiche: aprire il progetto nell'editor mandava un Telegram vero alla chat
# dell'impianto. Qui lo stesso progetto gira due volte:
#
#   dispositivo (con --viewer-port): su disco solo il tag storicizzato, e solo
#     i valori che superano la banda morta; le notifiche partono;
#   IDE (senza --viewer-port): stesse scritture, zero righe, nessun evento
#     d'allarme, notifiche non avviate.
#
# Uso:
#   cargo build -p sws-runtime
#   ./scripts/check_ide_quieto.sh
#
# Runtime scratch dichiarati (porte 8690/8691, dir temporanea), terminati.
set -uo pipefail
cd "$(dirname "$0")/.."

BIN="sws-runtime/target/debug/sws-runtime"
WORK="${TMPDIR:-/tmp}/sws-ide-quieto.$$"
AP="${APORT:-8690}"
VP="${VPORT:-8691}"
[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "manca sqlite3" >&2; exit 1; }

PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT
male=0
ok() { echo -e "  \033[32m✓\033[0m $1"; }
ko() { echo -e "  \033[31m✗\033[0m $1"; male=1; }

semina() {
  local dir="$1"
  mkdir -p "$dir/config" "$dir/projects/quieto"
  cat > "$dir/projects/quieto/project.yaml" <<'YAML'
meta:
  name: quieto
  version: 0.1.0
tags:
  - { id: storico, data_type: float, history: true, history_deadband: 5.0 }
  - { id: nostorico, data_type: float }
sources: []
alarms:
  - id: alto
    tag: storico
    levels:
      - condition: { kind: above, threshold: 50.0 }
        severity: Warning
        message: "storico alto"
notifications:
  telegram:
    bot_token: "0000000000:TOKEN-FINTO-DELLA-GUARDIA"
    chat_ids: ["-100000"]
datastores:
  - { id: default, label: d, backend: { kind: sqlite, path: history/historian.db } }
YAML
}

# Una modalità: avvia, scrive, ferma, conta. $1 = etichetta, $2 = "dispositivo" | "ide"
giro() {
  local nome="$1" modo="$2" dir="$WORK/$1"
  semina "$dir"
  local extra=()
  [ "$modo" = "dispositivo" ] && extra=(--viewer-port "$VP")
  "$BIN" --config "$dir/config" --projects-root "$dir/projects" \
    --templates-root "examples/templates" --admin-port "$AP" "${extra[@]}" \
    --project "$dir/projects/quieto" > "$dir/rt.log" 2>&1 &
  PID=$!
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$AP/health" && break; sleep 0.5; done
  sleep 1
  local api="http://localhost:$AP/api"
  for v in 10 10 10 12 30 31 80; do
    curl -s -o /dev/null -X PUT "$api/tags/storico" -H 'Content-Type: application/json' -d "{\"value\": $v}"
    sleep 0.15
  done
  for v in 1 2 3 4 5; do
    curl -s -o /dev/null -X PUT "$api/tags/nostorico" -H 'Content-Type: application/json' -d "{\"value\": $v}"
    sleep 0.15
  done
  sleep 1.5
  kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; PID=""
  local db="$dir/projects/quieto/history/historian.db"
  if [ -f "$db" ]; then
    R_STORICO=$(sqlite3 "$db" "SELECT count(*) FROM samples WHERE tag='storico';")
    R_NOSTORICO=$(sqlite3 "$db" "SELECT count(*) FROM samples WHERE tag='nostorico';")
    R_ALLARMI=$(sqlite3 "$db" "SELECT count(*) FROM alarm_events;")
  else
    R_STORICO=0; R_NOSTORICO=0; R_ALLARMI=0
  fi
  LOG="$dir/rt.log"
}

echo "== dispositivo: una strada sola verso il disco =="
giro dispositivo dispositivo
[ "$R_NOSTORICO" = "0" ] && ok "il tag senza history non finisce su disco" \
                         || ko "il tag senza history ha $R_NOSTORICO righe su disco"
# 10 (primo) · 12 no (banda 5) · 30 sì · 31 no · 80 sì — i ripetuti 10 mai.
[ "$R_STORICO" = "3" ] && ok "il tag storicizzato ha 3 righe: 10, 30, 80 (banda morta rispettata)" \
                       || ko "il tag storicizzato ha $R_STORICO righe, attese 3 (10, 30, 80)"
[ "$R_ALLARMI" -ge 1 ] && ok "lo scatto dell'allarme è nello storico ($R_ALLARMI righe)" \
                       || ko "nessun evento d'allarme registrato sul dispositivo"
grep -q "notification supervisor started" "$LOG" && ok "le notifiche partono" \
                                                  || ko "sul dispositivo le notifiche non sono partite"

echo "== IDE: non registra e non manda niente =="
giro ide ide
[ "$R_STORICO" = "0" ] && [ "$R_NOSTORICO" = "0" ] && ok "nessun campione su disco" \
  || ko "l'IDE ha registrato $R_STORICO + $R_NOSTORICO campioni"
[ "$R_ALLARMI" = "0" ] && ok "nessun evento d'allarme su disco" \
                       || ko "l'IDE ha registrato $R_ALLARMI eventi d'allarme"
grep -q "notification supervisor started" "$LOG" && ko "nell'IDE le notifiche sono partite" \
                                                  || ok "le notifiche non partono"
grep -q "notifiche (Telegram, email, escalation) NON avviate" "$LOG" && ok "e il log lo dice" \
                                                                     || ko "il log non dice che le notifiche sono spente"
grep -qi "telegram message sent" "$LOG" && ko "l'IDE ha mandato un messaggio Telegram" \
                                         || ok "nessun messaggio Telegram"

echo
[ $male -eq 0 ] && echo -e "\033[32mstorico a una strada, IDE quieto: tutto verde.\033[0m"
exit $male
