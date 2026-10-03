#!/usr/bin/env bash
#
# Pota la cache incrementale di cargo: le cartelle di `*/incremental/` non toccate
# da N giorni (default 2), nei tre target del repo.
#
# PERCHÉ ESISTE
#
# Cargo non pulisce mai `target/`. Il 03-10-2026, sul PC di casa del maintainer,
# `sws-runtime/target` pesava 155 GB con il disco al 97 %: 94 GB erano la sola cache
# incrementale (1 790 cartelle, una per crate × variante di compilazione), e 81 di
# quei 94 non venivano toccati da più di due giorni. È pura cache: toglierla costa
# al massimo una ricompilazione dei crate del workspace, mai delle dipendenze, che
# stanno in `deps/` e qui non si toccano.
#
# `clean_disk_space.sh` resta l'accetta per le emergenze (cancella tutto
# `target/debug`); questo è il giro di tutti i giorni, chiamato da
# `/finalizza-giornata` dopo il push. Piano: docs/archive/2026-09-29-pulizia-disco-periodica.md
#
# Cosa NON tocca mai: `deps/`, `build/`, `.fingerprint/`, la cross-build
# `target/aarch64-*` (ricompilarla costa decine di minuti e un container).
# Un target con una compilazione in corso (il lock `.cargo-lock` di cargo è
# preso) si salta e lo si dice.
#
# Uso:
#   ./scripts/pota_incremental.sh                  dice cosa toglierebbe
#   ./scripts/pota_incremental.sh --esegui         toglie
#   ./scripts/pota_incremental.sh --giorni 5 ...   soglia diversa
#
# SWS_POTA_RADICE: radice del repo, per il test (tests/shell/pota-incremental.sh).
set -uo pipefail
RADICE="${SWS_POTA_RADICE:-$(cd "$(dirname "$0")/.." && pwd)}"

GIORNI=2
ESEGUI=0
while [ $# -gt 0 ]; do
    case "$1" in
        --giorni) GIORNI="$2"; shift 2 ;;
        --esegui) ESEGUI=1; shift ;;
        -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "argomento sconosciuto: $1 (usa --help)" >&2; exit 2 ;;
    esac
done
case "$GIORNI" in ''|*[!0-9]*) echo "--giorni vuole un numero intero" >&2; exit 2 ;; esac

TARGET=(
    "$RADICE/sws-runtime/target"
    "$RADICE/sws-runtime/crates/sws-kiosk/target"
    "$RADICE/sws-runtime/crates/sws-lvgl-viewer/target"
)
MINUTI=$(( GIORNI * 1440 ))

kb() { du -sk "$@" 2>/dev/null | awk '{s+=$1} END {print s+0}'; }
umano() { awk -v k="$1" 'BEGIN { if (k >= 1048576) printf "%.1f GB", k/1048576; else printf "%.0f MB", k/1024 }'; }

totale_kb=0
cartelle=0
for t in "${TARGET[@]}"; do
    # Solo i profili dell'host: `target/debug` e `target/release`. La cross-build
    # sta in `target/aarch64-unknown-linux-gnu/…` e non compare qui per costruzione.
    for profilo in debug release; do
        inc="$t/$profilo/incremental"
        [ -d "$inc" ] || continue
        if [ -e "$t/$profilo/.cargo-lock" ] && ! flock -n "$t/$profilo/.cargo-lock" true 2>/dev/null; then
            echo "  salto ${inc#"$RADICE"/}: una compilazione è in corso"
            continue
        fi
        mapfile -t vecchie < <(find "$inc" -mindepth 1 -maxdepth 1 -type d -mmin +"$MINUTI" 2>/dev/null)
        [ "${#vecchie[@]}" -gt 0 ] || continue
        k=$(kb "${vecchie[@]}")
        totale_kb=$(( totale_kb + k ))
        cartelle=$(( cartelle + ${#vecchie[@]} ))
        echo "  ${inc#"$RADICE"/}: ${#vecchie[@]} cartelle, $(umano "$k")"
        if [ "$ESEGUI" -eq 1 ]; then
            rm -rf -- "${vecchie[@]}"
        fi
    done
done

if [ "$cartelle" -eq 0 ]; then
    echo "cache incrementale: niente di più vecchio di $GIORNI giorni."
elif [ "$ESEGUI" -eq 1 ]; then
    echo "cache incrementale: tolte $cartelle cartelle più vecchie di $GIORNI giorni, liberati $(umano "$totale_kb")."
else
    echo "cache incrementale: $cartelle cartelle più vecchie di $GIORNI giorni, $(umano "$totale_kb") — rilancia con --esegui per toglierle."
fi
