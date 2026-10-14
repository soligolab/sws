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
# Questa guardia prova la catena intera su **due runtime veri**:
#
#   - su un IDE (`--admin-port` senza `--viewer-port`) gli utenti del progetto
#     governano il dispositivo, non l'editor: creare un Operator non deve
#     chiudere niente. Dal 06-10-2026 all'IDE si entra con le credenziali
#     dell'installazione, e sono quelle che devono continuare a funzionare;
#   - su un dispositivo (`--viewer-port` presente) dall'11-10-2026 il primo
#     account non si crea più dall'API: un pannello senza utenti è «da
#     abbinare», non lascia entrare nessuno, e il primo account (un Admin del
#     dispositivo) nasce dal codice di abbinamento. La regola «il primo utente
#     di un dispositivo dev'essere un Admin» (409, `primo_utente_non_amministratore`)
#     resta nel codice e nei test di `router.rs`, ma da qui non si raggiunge più:
#     quando un utente si può creare, l'Admin c'è già.
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

. "$REPO/scripts/accesso_guardie.sh"

prepara() { # $1 = porta, $2 = token
  curl -s -X POST "http://localhost:$1/api/projects" -H "Authorization: Bearer $2" \
    -H 'Content-Type: application/json' -d '{"name":"prova"}' >/dev/null
  curl -s -X POST "http://localhost:$1/api/projects/prova/open" -H "Authorization: Bearer $2" >/dev/null
  sleep 1
}
crea() { # $1 = porta, $2 = utente, $3 = ruolo, $4 = token (facoltativo) → codice HTTP
  curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$1/api/auth/users" \
    ${4:+-H "Authorization: Bearer $4"} -H 'Content-Type: application/json' \
    -d "{\"username\":\"$2\",\"password\":\"segretissima\",\"role\":\"$3\"}"
}
elenca() { # $1 = porta, $2 = token (facoltativo) → codice HTTP di una GET
  curl -s -o /dev/null -w '%{http_code}' ${2:+-H "Authorization: Bearer $2"} \
    "http://localhost:$1/api/auth/users"
}

TOK_IDE=$(primo_amministratore_ide "$PORT_IDE" "$SCR/log-ide") || ko "IDE: niente primo amministratore"
prepara "$PORT_IDE" "$TOK_IDE"

echo "=== 1. IDE: il primo utente del progetto è un Operator, e va bene ==="
COD=$(crea "$PORT_IDE" user Operator "$TOK_IDE")
[ "$COD" = "201" ] && ok "POST /api/auth/users → 201" || ko "atteso 201, ricevuto $COD"
[ -f "$SCR/ide/projects/prova/users.yaml" ] && ok "users.yaml scritto: viaggerà col deploy" \
  || ko "users.yaml non è stato scritto"

echo "=== 2. IDE: e la richiesta SUCCESSIVA continua a funzionare ==="
# È il punto del guasto. Prima del 14-09-2026 qui si otteneva 401, l'editor
# mostrava «Sessione scaduta», e il progetto diventava irraggiungibile perché
# l'unico account era un Operator — che l'IDE non ammette.
COD=$(elenca "$PORT_IDE" "$TOK_IDE")
[ "$COD" = "200" ] && ok "GET /api/auth/users con la sessione dell'IDE → 200: l'IDE non si è chiuso fuori" \
  || ko "ricevuto $COD: l'IDE si è chiuso fuori da solo"

echo "=== 3. Dispositivo nuovo: in attesa di abbinamento, non entra nessuno ==="
COD=$(elenca "$PORT_DEV")
[ "$COD" = "401" ] && ok "GET senza token → 401" || ko "ricevuto $COD: un pannello senza utenti è aperto"
COD=$(crea "$PORT_DEV" user Operator)
[ "$COD" = "401" ] && ok "e il primo utente non si crea dall'API (401)" || ko "ricevuto $COD"

echo "=== 4. Dispositivo: abbinato, nasce l'Admin e da lì in poi si entra col login ==="
TOK_DEV=$(abbina_pannello "$PORT_DEV" "$SCR/dev/config" capo segretissima) \
  && ok "abbinamento col codice: nato l'Admin del dispositivo" || ko "abbinamento rifiutato"
prepara "$PORT_DEV" "$TOK_DEV"
COD=$(crea "$PORT_DEV" user Operator "$TOK_DEV")
[ "$COD" = "201" ] && ok "con la sua sessione si crea un Operator → 201" || ko "atteso 201, ricevuto $COD"
COD=$(elenca "$PORT_DEV")
[ "$COD" = "401" ] && ok "GET senza token → 401: sul dispositivo l'autenticazione è accesa" \
  || ko "ricevuto $COD: il dispositivo non chiede il login"
COD=$(crea "$PORT_DEV" altro Operator)
[ "$COD" = "401" ] && ok "e creare utenti senza token resta vietato" || ko "ricevuto $COD"

echo
[ "$ESITO" = 0 ] \
  && echo "primo utente: l'IDE resta aperto, il dispositivo nasce amministrabile." \
  || echo "primo utente: la catena è rotta — vedi $SCR/log-ide e $SCR/log-dev."
exit "$ESITO"
