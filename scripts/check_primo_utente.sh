#!/usr/bin/env bash
# Definire il primo utente chiude fuori chi lo sta definendo?
#
# PERCHÉ ESISTE
#
# Il 14-09-2026, nell'IDE, creare il primo utente di un progetto (`user`,
# Operator) rispondeva 201 e **subito dopo** l'editor diceva «Sessione scaduta»
# lasciando il progetto inaccessibile. Nessun pezzo era rotto da solo:
# l'autenticazione si accende nell'istante in cui `users.yaml` viene scritto,
# il token che l'editor porta in modalità senza utenti è un sentinella che il
# server non ha mai emesso, e l'unico account esistente era un Operator, che
# l'IDE non ammette. Rotto era il punto in cui i pezzi si incontrano — ed è
# l'unico posto che nessun test unitario guardava.
#
# Questa guardia prova la catena intera su **due runtime veri**, perché la
# correzione è asimmetrica e una regola sola non basta:
#
#   - su un IDE (`--admin-port` senza `--viewer-port`) gli utenti governano il
#     dispositivo, non l'editor: creare un Operator non deve chiudere niente;
#   - su un dispositivo (`--viewer-port` presente) l'autenticazione si accende
#     davvero, quindi il primo account dev'essere un Admin o il pannello nasce
#     senza nessuno in grado di amministrarlo.
#
# Uso:  ./scripts/check_primo_utente.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
SCR="${TMPDIR:-/tmp}/sws-check-primo-utente"
PORT_IDE=8578
PORT_DEV=8579
PORT_VIEWER=8580

[ -x "$BIN" ] || { echo "manca $BIN — compila con: cd sws-runtime && cargo build"; exit 2; }

rm -rf "$SCR"; mkdir -p "$SCR"/ide/{config,projects} "$SCR"/dev/{config,projects}

"$BIN" --config "$SCR/ide/config" --projects-root "$SCR/ide/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$PORT_IDE" \
  > "$SCR/log-ide" 2>&1 &
PID_IDE=$!
"$BIN" --config "$SCR/dev/config" --projects-root "$SCR/dev/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$PORT_DEV" \
  --viewer-port "$PORT_VIEWER" > "$SCR/log-dev" 2>&1 &
PID_DEV=$!
trap 'kill -TERM "$PID_IDE" "$PID_DEV" 2>/dev/null' EXIT
sleep 8

ESITO=0
ok() { echo "  ✓ $1"; }
ko() { echo "  ✗ $1"; ESITO=1; }

prepara() { # $1 = porta
  curl -s -X POST "http://localhost:$1/api/projects" \
    -H 'Content-Type: application/json' -d '{"name":"prova"}' >/dev/null
  curl -s -X POST "http://localhost:$1/api/projects/prova/open" >/dev/null
  sleep 1
}
crea() { # $1 = porta, $2 = utente, $3 = ruolo → stampa il codice HTTP
  curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$1/api/auth/users" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$2\",\"password\":\"segretissima\",\"role\":\"$3\"}"
}
elenca() { # $1 = porta → codice HTTP di una GET **senza token**
  curl -s -o /dev/null -w '%{http_code}' "http://localhost:$1/api/auth/users"
}

prepara "$PORT_IDE"
prepara "$PORT_DEV"

echo "=== 1. IDE: il primo utente è un Operator, e va bene ==="
COD=$(crea "$PORT_IDE" user Operator)
[ "$COD" = "201" ] && ok "POST /api/auth/users → 201" || ko "atteso 201, ricevuto $COD"
[ -f "$SCR/ide/projects/prova/users.yaml" ] && ok "users.yaml scritto: viaggerà col deploy" \
  || ko "users.yaml non è stato scritto"

echo "=== 2. IDE: e la richiesta SUCCESSIVA continua a funzionare ==="
# È il punto del guasto. Prima del 14-09-2026 qui si otteneva 401, l'editor
# mostrava «Sessione scaduta», e il progetto diventava irraggiungibile perché
# l'unico account era un Operator — che l'IDE non ammette.
COD=$(elenca "$PORT_IDE")
[ "$COD" = "200" ] && ok "GET /api/auth/users senza token → 200: l'IDE non si è chiuso fuori" \
  || ko "ricevuto $COD: l'IDE si è chiuso fuori da solo"

echo "=== 3. Dispositivo: un primo utente non-Admin è rifiutato ==="
COD=$(crea "$PORT_DEV" user Operator)
[ "$COD" = "409" ] && ok "POST con ruolo Operator → 409" || ko "atteso 409, ricevuto $COD"
[ ! -f "$SCR/dev/projects/prova/users.yaml" ] \
  && ok "e non ha scritto users.yaml: il rifiuto è davvero un rifiuto" \
  || ko "users.yaml è stato scritto lo stesso"
COD=$(elenca "$PORT_DEV")
[ "$COD" = "200" ] && ok "il dispositivo è ancora aperto, come prima del tentativo" \
  || ko "ricevuto $COD: il tentativo rifiutato ha comunque acceso l'autenticazione"

echo "=== 4. Dispositivo: con un Admin si può, e da lì in poi si entra col login ==="
COD=$(crea "$PORT_DEV" capo Admin)
[ "$COD" = "201" ] && ok "POST con ruolo Admin → 201" || ko "atteso 201, ricevuto $COD"
COD=$(elenca "$PORT_DEV")
[ "$COD" = "401" ] && ok "GET senza token → 401: sul dispositivo l'autenticazione è accesa" \
  || ko "ricevuto $COD: il dispositivo non chiede il login"
COD=$(crea "$PORT_DEV" user Operator)
[ "$COD" = "401" ] && ok "e ora anche creare utenti vuole un token" || ko "ricevuto $COD"

echo
[ "$ESITO" = 0 ] \
  && echo "primo utente: l'IDE resta aperto, il dispositivo nasce amministrabile." \
  || echo "primo utente: la catena è rotta — vedi $SCR/log-ide e $SCR/log-dev."
exit "$ESITO"
