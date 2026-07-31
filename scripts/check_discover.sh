#!/usr/bin/env bash
#
# check_discover.sh — "Cerca runtime" distingue i container e non fa doppioni?
#
# Verifica tre cose su `GET /api/discover`, tutte difficili da vedere a occhio:
#
#   1. un runtime in container si annuncia come tale (proprietà mDNS
#      `container`, col nome del motore) e uno nativo non annuncia niente;
#   2. lo stesso runtime compare UNA volta sola — senza deduplica ne comparivano
#      tre, perché mdns-sd consegna un `ServiceResolved` per ogni risposta;
#   3. l'indirizzo offerto è quello di rete e non `127.0.0.1`, che da un'altra
#      macchina non serve a niente. La prima risposta può portare solo il
#      loopback, quindi la voce va promossa quando ne arriva una migliore.
#
# I due casi girano in sequenza e non in parallelo di proposito: l'istanza mDNS
# prende il nome dall'hostname, quindi due runtime sulla stessa macchina si
# annuncerebbero con lo stesso nome e non sarebbero distinguibili.
#
# Porte 8543-8546: fuori dalle 8443/8444/8460 delle istanze di sviluppo, che
# questo script non deve toccare.
#
# Uso: ./scripts/check_discover.sh   (richiede il binario debug già compilato)

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
GIRI="${GIRI:-3}"

[ -x "$BIN" ] || { echo "ERRORE: manca $BIN — esegui prima 'cargo build -p sws-runtime'" >&2; exit 1; }

WORK=$(mktemp -d)
cleanup() {
    for p in "$WORK"/*.pid; do
        [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null
    done
    rm -rf "$WORK"
}
trap cleanup EXIT

fallimenti=0

# $1 etichetta  $2 porta viewer  $3 porta admin  $4 motore forzato (vuoto = nativo)
caso() {
    local label="$1" vp="$2" ap="$3" forced="$4"
    mkdir -p "$WORK/$label"/{config,projects}

    # SWS_CONTAINER_ENGINE forza il rilevamento: qui non siamo in un container,
    # e il punto è verificare la catena annuncio → discovery, non il rilevamento
    # (che ha i suoi test unitari in sws-runtime).
    if [ -n "$forced" ]; then
        export SWS_CONTAINER_ENGINE="$forced"
    else
        unset SWS_CONTAINER_ENGINE
    fi

    # --viewer-port è indispensabile: in modalità solo-IDE il runtime non si
    # annuncia affatto, e il test passerebbe per il motivo sbagliato.
    "$BIN" --config "$WORK/$label/config" --projects-root "$WORK/$label/projects" \
        --templates-root "$REPO/examples/templates" \
        --viewer-port "$vp" --admin-port "$ap" > "$WORK/$label.log" 2>&1 &
    echo $! > "$WORK/$label.pid"

    for _ in $(seq 1 40); do
        curl -sf -o /dev/null "http://localhost:$ap/health" && break
        sleep 0.5
    done
    sleep 2   # lascia uscire l'annuncio mDNS prima di interrogare

    local json
    json=$(curl -sf "http://localhost:$ap/api/discover")

    ATTESO="$forced" python3 - "$json" <<'PY'
import json, os, sys
atteso = os.environ["ATTESO"] or None
try:
    voci = json.loads(sys.argv[1])
except Exception:
    print("  ✗ risposta non interpretabile:", sys.argv[1][:200]); sys.exit(1)

if len(voci) != 1:
    print(f"  ✗ voci attese 1, trovate {len(voci)}:")
    for v in voci:
        print("      ", v["name"], v["admin_url"], v["container"])
    sys.exit(1)

v = voci[0]
esito = 0
if v["container"] != atteso:
    print(f"  ✗ container atteso {atteso!r}, trovato {v['container']!r}"); esito = 1
if "127.0.0.1" in v["admin_url"] or "[::1]" in v["admin_url"]:
    print(f"  ✗ indirizzo loopback offerto: {v['admin_url']}"); esito = 1
if esito == 0:
    print(f"  ✓ 1 voce · container={v['container']!r} · {v['admin_url']}")
sys.exit(esito)
PY
    local rc=$?
    [ $rc -ne 0 ] && fallimenti=$((fallimenti + 1))

    kill "$(cat "$WORK/$label.pid")" 2>/dev/null
    wait "$(cat "$WORK/$label.pid")" 2>/dev/null
    rm -f "$WORK/$label.pid"
    sleep 1
}

# Più giri perché il difetto dell'indirizzo era intermittente: con una sola
# esecuzione passava comunque due volte su tre.
for giro in $(seq 1 "$GIRI"); do
    echo "== giro $giro/$GIRI =="
    echo "runtime in container (podman):"
    caso container 8543 8544 podman
    echo "runtime nativo:"
    caso nativo 8545 8546 ""
done

echo
if [ "$fallimenti" -eq 0 ]; then
    echo "OK — $((GIRI * 2)) controlli su $((GIRI * 2))"
else
    echo "FALLITO — $fallimenti controlli su $((GIRI * 2))"
fi
exit "$fallimenti"
