#!/usr/bin/env bash
# Banco di prova delle prestazioni del runtime (P5, onda 2, 17-10-2026; piano
# docs/plans/2026-10-17-onda-2-prestazioni-e-protezioni.md). Percorre la griglia
# tag × client con `sws-banco` e salva i risultati in docs/prestazioni/.
#
# Uso:
#   ./scripts/banco_prestazioni.sh x86
#       compila in release, avvia un runtime di prova (porte 8696/8697, cartelle
#       temporanee), misura e lo ferma sempre, anche se qualcosa va storto;
#   ./scripts/banco_prestazioni.sh tc620 <host> [progetto da riaprire]
#       la gestione del pannello è solo su 127.0.0.1:8444: la si raggiunge con un
#       tunnel SSH (utente `user`, a chiave), i client vanno diretti sul viewer
#       <host>:8443 come un browser. Serve l'admin dell'istanza in
#       SWS_BANCO_UTENTE / SWS_BANCO_PASSWORD. Alla fine riapre il progetto.
#
# Variabili: SWS_BANCO_TAG (default 100,1000,5000), SWS_BANCO_CLIENT (1,5,20),
# SWS_BANCO_DURATA (secondi per casella, default 60).
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${SWS_BANCO_TAG:-100,1000,5000}"
CLIENT="${SWS_BANCO_CLIENT:-1,5,20}"
DURATA="${SWS_BANCO_DURATA:-60}"
OGGI="$(date +%Y-%m-%d)"
mkdir -p docs/prestazioni

dove="${1:-}"
case "$dove" in
  x86)
    (cd sws-runtime && cargo build --release -p sws-runtime -p sws-banco)
    tmp="$(mktemp -d)"; mkdir -p "$tmp"/{config,projects}
    SWS_SCRIPT_SENZA_SANDBOX=1 sws-runtime/target/release/sws-runtime --config "$tmp/config" \
      --projects-root "$tmp/projects" --templates-root examples/templates \
      --viewer-port 8697 --admin-port 8696 --senza-autenticazione > "$tmp/rt.log" 2>&1 &
    pid=$!
    trap 'kill $pid 2>/dev/null; rm -rf "$tmp"' EXIT
    for _ in $(seq 1 60); do curl -sf -o /dev/null http://localhost:8696/health && break; sleep 0.5; done
    cpu="$(grep -m1 "model name" /proc/cpuinfo | cut -d: -f2 | xargs)"
    sws-runtime/target/release/sws-banco --gestione http://localhost:8696 --viewer http://localhost:8697 \
      --tag "$TAG" --client "$CLIENT" --durata "$DURATA" --macchina "x86 — $cpu" \
      --uscita "docs/prestazioni/$OGGI-x86.json"
    ;;
  tc620)
    host="${2:?serve host del pannello}"
    riapri="${3:-}"
    : "${SWS_BANCO_UTENTE:?serve SWS_BANCO_UTENTE, admin della istanza}" "${SWS_BANCO_PASSWORD:?serve SWS_BANCO_PASSWORD}"
    (cd sws-runtime && cargo build --release -p sws-banco)
    ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L 18444:127.0.0.1:8444 "user@$host" &
    tunnel=$!
    trap 'kill $tunnel 2>/dev/null' EXIT
    for _ in $(seq 1 20); do curl -sf -o /dev/null http://localhost:18444/health && break; sleep 0.5; done
    sws-runtime/target/release/sws-banco --gestione http://localhost:18444 --viewer "http://$host:8443" \
      --utente "$SWS_BANCO_UTENTE" --tag "$TAG" --client "$CLIENT" --durata "$DURATA" --macchina "TC620" \
      ${riapri:+--ripristina "$riapri"} --uscita "docs/prestazioni/$OGGI-tc620.json"
    ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
