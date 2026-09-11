#!/usr/bin/env bash
# Cambiare il motore di rendering dall'IDE arriva davvero fino al pannello?
#
# PERCHÉ ESISTE
#
# `target.kind` non è un campo decorativo: all'apertura e a ogni salvataggio il
# runtime scrive `web` o `lvgl` nel file `display-target`, e sul pannello
# `sws-display-apply.sh` commuta lo schermo fra browser e viewer LVGL. Prima di
# T-58 si cambiava editando `project.yaml` a mano, con una trappola: il runtime
# riscrive il file **dalla memoria** al primo salvataggio, quindi la modifica
# fatta a progetto aperto spariva senza dire niente.
#
# Questa guardia prova la catena intera — rotta → `project.yaml` →
# `display-target` — perché è esattamente dove un cablaggio dimenticato non si
# vede: la rotta risponde 204, il file su disco cambia, e il pannello continua
# a mostrare quello di prima.
#
# Uso:  ./scripts/check_target_progetto.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
SCR="${TMPDIR:-/tmp}/sws-check-target"
PORT=8577
rm -rf "$SCR"; mkdir -p "$SCR"/{config,projects}
"$BIN" --config "$SCR/config" --projects-root "$SCR/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$PORT" > "$SCR/log" 2>&1 &
PID=$!
trap 'kill -TERM "$PID" 2>/dev/null' EXIT
sleep 8

A="http://localhost:$PORT/api"
DT="$SCR/config/display-target"
ESITO=0
ok() { echo "  ✓ $1"; }
ko() { echo "  ✗ $1"; ESITO=1; }
kind() { grep -A 1 '^target:' "$SCR/projects/prova/project.yaml" 2>/dev/null | grep kind | sed 's/.*: *//'; }
motore() { tr -d '[:space:]' < "$DT" 2>/dev/null; }

echo "=== preparazione ==="
curl -s -X POST "$A/projects" -H 'Content-Type: application/json' -d '{"name":"prova"}' >/dev/null
curl -s -X POST "$A/projects/prova/open" >/dev/null; sleep 1
echo "  project.yaml: $(kind || echo '(nessun target)')   display-target: $(motore || echo ASSENTE)"

echo "=== 1. un progetto nuovo è web, e il file lo dice ==="
[ "$(motore)" = "web" ] && ok "display-target = web" || ko "display-target = '$(motore)' invece di web"
[ -z "$(kind)" ] && ok "project.yaml non ha un target esplicito (web è l'assenza del campo)" \
                 || ko "project.yaml ha kind='$(kind)': web dovrebbe essere assenza"

echo "=== 2. la rotta porta il progetto a LVGL ==="
COD=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$A/project/target" \
  -H 'Content-Type: application/json' -d '{"kind":"lvgl_wayland"}')
[ "$COD" = "204" ] && ok "PUT /api/project/target → 204" || ko "atteso 204, ricevuto $COD"
sleep 1
[ "$(kind)" = "lvgl_wayland" ] && ok "project.yaml: kind = lvgl_wayland" || ko "project.yaml: kind = '$(kind)'"
# È il punto che conta: senza la riscrittura di `display-target` la conversione
# resterebbe senza effetto fino a un salvataggio qualsiasi, e il pannello
# continuerebbe a mostrare il browser.
[ "$(motore)" = "lvgl" ] && ok "display-target è passato a lvgl — il pannello commuterà" \
                         || ko "display-target = '$(motore)': la conversione non arriva al pannello"

echo "=== 3. e riporta a web togliendo il campo ==="
COD=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$A/project/target" \
  -H 'Content-Type: application/json' -d 'null')
[ "$COD" = "204" ] && ok "PUT con corpo null → 204" || ko "atteso 204, ricevuto $COD"
sleep 1
[ -z "$(kind)" ] && ok "il campo target è sparito da project.yaml" || ko "kind = '$(kind)', doveva sparire"
[ "$(motore)" = "web" ] && ok "display-target è tornato a web" || ko "display-target = '$(motore)'"

echo "=== 4. un motore che non esiste è rifiutato, non scritto ==="
COD=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$A/project/target" \
  -H 'Content-Type: application/json' -d '{"kind":"lvgl_opengl"}')
[ "$COD" = "422" ] || [ "$COD" = "400" ] && ok "un kind sconosciuto è rifiutato ($COD)" || ko "accettato con $COD"
[ -z "$(kind)" ] && ok "e non ha toccato il progetto" || ko "il progetto è stato modificato: '$(kind)'"

echo "=== 5. un campo in più è rifiutato (Q9: payload solo-API) ==="
COD=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$A/project/target" \
  -H 'Content-Type: application/json' -d '{"kind":"lvgl_wayland","colore":"rosso"}')
[ "$COD" = "422" ] || [ "$COD" = "400" ] && ok "campo ignoto rifiutato ($COD)" || ko "accettato con $COD"

echo
[ "$ESITO" = 0 ] && echo "target del progetto: la catena regge." || echo "target del progetto: qualcosa non arriva."
exit "$ESITO"
