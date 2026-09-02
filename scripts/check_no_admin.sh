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
for r in "POST /api/script/exec" "GET /api/fs/browse-dirs" "PUT /api/project/tags" \
         "GET /api/logs" "GET /api/discover" "GET /api/schema/synoptic" \
         "GET /api/audit" "POST /api/projects/pippo/duplicate"; do
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
