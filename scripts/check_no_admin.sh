#!/usr/bin/env bash
#
# `--no-admin` deve togliere l'IDE e **lasciare il deploy**.
#
# PERCHÉ ESISTE
#
# Fino al 2026-09-02 `--no-admin` non legava affatto la porta admin, e con quella
# si portava via il **Deploy**: `remote_deploy` va proprio lì, perché il ciclo di
# vita del progetto vive solo su quel router. Un dispositivo in operator-only non
# si poteva più aggiornare dall'editor, e l'unico segnale era una connessione
# rifiutata.
#
# Ora la porta resta e porta solo la gestione remota. Il rischio si è quindi
# spostato, e questa guardia difende i due versi:
#
#   1. una rotta dell'IDE che ricompare lì per distrazione — è la cosa che questa
#      modalità esiste per impedire;
#   2. una rotta del deploy che sparisce — e allora il dispositivo torna
#      inaggiornabile, senza che niente lo dica.
#
# Dal 2026-09-08 difende anche un terzo caso, scoperto sul campo: i **flussi
# WebSocket** `/ws/tags` e `/ws/alarms` non erano montati su questa porta. Non
# rompevano il deploy, quindi i primi due controlli restavano verdi, ma l'editor
# collegato al pannello non mostrava un solo valore vivo — e `remote_relay`
# ritentava per sempre, due volte al secondo, riempiendo il registro di 404. È il
# tipo di buco che si vede solo su un dispositivo vero: sullo stack di sviluppo
# la porta admin serve il router completo e le rotte ci sono.
#
# Il confronto è con un'istanza **normale** sullo stesso binario, non con un
# elenco scritto a mano: un elenco invecchia, e un 404 da solo non distingue
# «rotta assente» da «percorso che ho sbagliato a scrivere».
#
# Uso: ./scripts/check_no_admin.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
SCR="${TMPDIR:-/tmp}/sws-check-no-admin"
rm -rf "$SCR"; mkdir -p "$SCR"/{a,b}/{config,projects}

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

# Il binario linka libpython via PyO3: con pyenv il loader non la trova da sé.
if [ -z "${LD_LIBRARY_PATH:-}" ] && command -v python3 >/dev/null 2>&1; then
    LIBDIR="$(python3 -c 'import sysconfig;print(sysconfig.get_config_var("LIBDIR"))' 2>/dev/null || true)"
    [ -n "$LIBDIR" ] && export LD_LIBRARY_PATH="$LIBDIR"
fi

# Entrambe con `--www`: senza, la seconda non servirebbe la SPA comunque e la
# prova sulla SPA non dimostrerebbe niente. (Errore commesso e corretto durante
# la scrittura di questa guardia.)
WWW="$REPO/sws-editor/dist"
WWW_ARGS=()
[ -f "$WWW/index-admin.html" ] && WWW_ARGS=(--www "$WWW")

"$BIN" --config "$SCR/a/config" --projects-root "$SCR/a/projects" \
  --templates-root "$REPO/examples/templates" \
  --viewer-port 8596 --admin-port 8597 --no-admin \
  "${WWW_ARGS[@]}" > "$SCR/stretta.log" 2>&1 &
PA=$!
"$BIN" --config "$SCR/b/config" --projects-root "$SCR/b/projects" \
  --templates-root "$REPO/examples/templates" \
  --viewer-port 8598 --admin-port 8599 \
  "${WWW_ARGS[@]}" > "$SCR/normale.log" 2>&1 &
PB=$!
trap 'kill -TERM "$PA" "$PB" 2>/dev/null' EXIT

for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://localhost:8597/health" \
      && curl -sf -o /dev/null "http://localhost:8599/health" && break
    sleep 0.5
done

fatti=0; passati=0
esito() { fatti=$((fatti+1)); if [ "$1" = ok ]; then passati=$((passati+1)); echo "  ✓ $2"; else echo "  ✗ $2"; fi; }
codice() { curl -s -o /dev/null -w '%{http_code}' -m 5 -X "$1" \
             -H 'content-type: application/json' -d '{}' "http://localhost:$2$3"; }

echo "=== 1. le rotte che il deploy usa DEVONO esserci ==="
# Non si confronta con 200: senza un progetto aperto molte rispondono 503, che è
# la risposta giusta e prova che la rotta c'è. Un 404 invece significa assente.
for r in "GET /api/projects" "GET /api/system" "GET /api/project" \
         "GET /api/project/export" "GET /api/backups" "GET /api/auth/users"; do
    m=${r% *}; u=${r#* }
    c=$(codice "$m" 8597 "$u")
    [ "$c" != "404" ] && esito ok "$u risponde ($c), non 404" \
                      || esito no "$u è SPARITA: il dispositivo non si aggiorna più dall'editor"
done

echo "=== 2. le rotte dell'IDE NON devono esserci — e il confronto lo dimostra ==="
# Ogni percorso si prova su **entrambe**: deve essere 404 sulla stretta e
# qualcosa-di-diverso-da-404 sulla normale. Il secondo controllo è quello che
# rende la prova onesta: senza, un percorso scritto male darebbe 404 da tutte
# due e la guardia sarebbe verde senza aver verificato nulla.
for r in "GET /api/build/packages" "GET /api/fs/browse-dirs" "PUT /api/project/tags" \
         "GET /api/logs" "GET /api/discover" "GET /api/schema/synoptic" \
         "GET /api/audit" "POST /api/projects/pippo/duplicate" \
         "GET /api/build/stato" "POST /api/device/probe" "GET /api/discover/dispositivi" \
         "GET /api/devices"; do
    m=${r% *}; u=${r#* }
    cs=$(codice "$m" 8597 "$u")
    cn=$(codice "$m" 8599 "$u")
    if [ "$cn" = "404" ]; then
        esito no "$u dà 404 anche sull'istanza normale: percorso sbagliato, prova inutile"
    elif [ "$cs" = "404" ]; then
        esito ok "$u assente sulla stretta (normale: $cn)"
    else
        esito no "$u è RAGGIUNGIBILE sulla stretta ($cs): l'IDE è rientrato"
    fi
done

echo "=== 2b. i flussi che l'editor collegato apre su QUESTA porta ==="
# L'handshake vero, non una GET: senza gli header di upgrade una rotta WebSocket
# risponde comunque diverso da 404, e la prova non distinguerebbe «c'è» da «non
# c'è». 101 = commutato, che è la sola risposta che dimostra la rotta viva.
ws() { curl -s -o /dev/null -w '%{http_code}' -m 5 \
         -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
         -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
         "http://localhost:$1$2"; }

for u in /ws/tags /ws/alarms; do
    c=$(ws 8597 "$u")
    [ "$c" = "101" ] && esito ok "$u commuta sulla porta di gestione ($c)" \
                     || esito no "$u NON c'è sulla porta di gestione ($c): l'editor collegato resta senza valori vivi e il relay ritenta all'infinito"
done

# `/ws/logs` è escluso di proposito: i log possono contenere segreti e su un
# dispositivo non stanno su nessuna delle due porte. Se un giorno servisse è una
# decisione da prendere, non da far scivolare dentro insieme ai tag — quindi qui
# si pretende che resti fuori.
c=$(ws 8597 /ws/logs)
[ "$c" = "404" ] && esito ok "/ws/logs resta fuori dalla porta di gestione (404)" \
                 || esito no "/ws/logs è comparso sulla porta di gestione ($c): decisione mai presa"

echo "=== 2c. il selettore di cartelle non esce dalla cartella dei progetti (Q46) ==="
# Sull'istanza NORMALE (8599) la rotta c'è: senza percorso elenca la radice,
# con un percorso fuori dalla radice risponde 400 e lo dice. Prima partiva da
# $HOME e accettava qualunque percorso assoluto — pre-auth.
c=$(codice GET 8599 "/api/fs/browse-dirs")
[ "$c" = "200" ] && esito ok "browse-dirs senza percorso elenca la radice (200)" \
                 || esito no "browse-dirs senza percorso: $c (atteso 200)"
c=$(codice GET 8599 "/api/fs/browse-dirs?path=/etc")
[ "$c" = "400" ] && esito ok "browse-dirs su /etc è rifiutato (400)" \
                 || esito no "browse-dirs su /etc: $c — il disco è di nuovo leggibile senza sessione"
c=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST -H 'content-type: application/json' \
      -d '{"parent":"/tmp","name":"sws_prova_q46"}' "http://localhost:8599/api/fs/mkdir")
[ "$c" = "400" ] && esito ok "mkdir fuori dalla radice è rifiutato (400)" \
                 || esito no "mkdir in /tmp: $c — si creano cartelle ovunque senza sessione"
rmdir /tmp/sws_prova_q46 2>/dev/null || true

echo "=== 2d. la sonda «questo dispositivo ha utenti?» funziona anche qui (T-57) ==="
# L'istanza stretta gira senza utenti: è la condizione di un pannello appena
# installato — nessun progetto, nessun `users.yaml`. Quando l'editor ci prova a
# collegarsi e il login fallisce, `senza_utenti` (remote.rs) chiede al
# dispositivo se pretende autenticazione, per non dare del bugiardo a chi ha
# digitato una password che non poteva servire.
#
# La rotta NON è scritta qui: si legge dal sorgente. È il punto della guardia —
# chiunque cambi la sonda in remote.rs la prova su questa porta senza saperlo.
# Fino al 2026-09-11 era `/api/auth/whoami`, che su `--no-admin` non è montata:
# 404, letto come «ha utenti», e un pannello vuoto rifiutava la connessione
# dicendo che l'utente non esisteva o la password era sbagliata. Segnalato dal
# maintainer al primo deploy dopo un'installazione pulita, misurato sul WP630.
SONDA=$(sed -n '/async fn senza_utenti/,/^}/p' "$REPO/sws-runtime/crates/sws-web/src/remote.rs" \
        | grep -o '{url}/[A-Za-z0-9/_-]*' | head -1 | sed 's/{url}//')
if [ -z "$SONDA" ]; then
    esito no "non trovo quale rotta sonda `senza_utenti` in remote.rs: la guardia non sta verificando niente"
else
    c=$(codice GET 8597 "$SONDA")
    if [ "$c" = "404" ]; then
        esito no "la sonda $SONDA non esiste sulla porta di gestione (404): l'editor non distingue «nessun utente» da «password sbagliata», e un pannello appena installato rifiuta la connessione"
    elif [ "$c" = "200" ]; then
        esito ok "la sonda $SONDA passa senza token su un'istanza senza utenti ($c)"
    else
        esito no "la sonda $SONDA risponde $c su un'istanza SENZA utenti: l'editor concluderà che ne ha"
    fi
    # Il fatto dichiarato, non dedotto dal codice di stato: è il campo su cui
    # `senza_utenti` decide quando la risposta si può leggere.
    if curl -s -m 5 "http://localhost:8597$SONDA" | grep -q '"auth_required":false'; then
        esito ok "e dichiara auth_required:false"
    else
        esito no "$SONDA non dichiara auth_required:false su un'istanza senza utenti"
    fi
    # L'altro verso: con utenti la stessa sonda deve chiudere. L'istanza normale
    # non ne ha, quindi qui si verifica solo che la rotta esista anche là — il
    # caso «con utenti» è coperto dai test di `niente_autenticazione`.
    cn=$(codice GET 8599 "$SONDA")
    [ "$cn" != "404" ] && esito ok "e c'è anche sul router completo ($cn)" \
                       || esito no "la sonda $SONDA non esiste sul router completo: l'editor collegato a un PC di sviluppo non la troverebbe"
fi

echo "=== 3. la SPA dell'IDE non viene servita ==="
if [ ${#WWW_ARGS[@]} -eq 0 ]; then
    echo "  – salto: manca $WWW/index-admin.html (cd sws-editor && pnpm build)"
else
    for u in /index-admin.html /index.html; do
        cs=$(codice GET 8597 "$u"); cn=$(codice GET 8599 "$u")
        if [ "$cn" != "200" ]; then
            esito no "$u non è servita nemmeno dall'istanza normale ($cn): prova inutile"
        elif [ "$cs" = "404" ]; then
            esito ok "$u non servita sulla stretta"
        else
            esito no "$u è servita sulla stretta ($cs): l'interfaccia è raggiungibile"
        fi
    done
fi

echo "=== 4. il viewer operatori resta intero ==="
for r in "GET /api/tags" "GET /api/alarms"; do
    m=${r% *}; u=${r#* }
    c=$(codice "$m" 8596 "$u")
    [ "$c" != "404" ] && esito ok "viewer: $u risponde ($c)" \
                      || esito no "viewer: $u è sparita — --no-admin ha toccato il viewer"
done

echo
if [ "$passati" = "$fatti" ]; then
    echo "tutte e $fatti le prove verdi."
else
    echo "$passati/$fatti verdi — vedi sopra." >&2
    exit 1
fi
