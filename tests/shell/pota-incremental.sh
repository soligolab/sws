#!/usr/bin/env bash
#
# `scripts/pota_incremental.sh` su un repo finto (03-10-2026).
#
# Tre target con cartelle incrementali vecchie e nuove, più quello che non va mai
# toccato: `deps/` vecchia, una cross-build `aarch64` vecchia, un target con una
# compilazione in corso (lock di cargo preso). Si controlla che spariscano solo le
# cartelle incrementali vecchie dei target liberi.
#
# Lo lancia scripts/check_pota_incremental.sh. Uso diretto: tests/shell/pota-incremental.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

vecchia() { mkdir -p "$1"; touch -d '5 days ago' "$1"; }
nuova()   { mkdir -p "$1"; }

R="$T/sws-runtime/target"
K="$T/sws-runtime/crates/sws-kiosk/target"
V="$T/sws-runtime/crates/sws-lvgl-viewer/target"
vecchia "$R/debug/incremental/sws_web-vecchia"
nuova   "$R/debug/incremental/sws_web-nuova"
vecchia "$R/release/incremental/sws_core-vecchia"
vecchia "$R/debug/deps/libvecchia"
touch -d '5 days ago' "$R/debug/deps"
vecchia "$R/aarch64-unknown-linux-gnu/release/incremental/sws_web-cross"
vecchia "$K/debug/incremental/sws_kiosk-vecchia"
vecchia "$V/debug/incremental/sws_lvgl_viewer-occupata"
touch "$V/debug/.cargo-lock"

esci=0
prova() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; esci=1; fi; }

# Il lock di cargo preso per tutta la corsa, come durante una compilazione.
exec 9>"$V/debug/.cargo-lock"
flock 9

SWS_POTA_RADICE="$T" bash "$REPO/scripts/pota_incremental.sh" > "$T/anteprima.log"
prova "senza --esegui non toglie niente"            "[ -d '$R/debug/incremental/sws_web-vecchia' ]"
prova "l'anteprima dice cosa toglierebbe"           "grep -q 'rilancia con --esegui' '$T/anteprima.log'"

SWS_POTA_RADICE="$T" bash "$REPO/scripts/pota_incremental.sh" --esegui > "$T/uscita.log"
prova "tolta l'incrementale vecchia (debug)"        "[ ! -e '$R/debug/incremental/sws_web-vecchia' ]"
prova "tolta l'incrementale vecchia (release)"      "[ ! -e '$R/release/incremental/sws_core-vecchia' ]"
prova "tolta l'incrementale vecchia (kiosk)"        "[ ! -e '$K/debug/incremental/sws_kiosk-vecchia' ]"
prova "resta l'incrementale nuova"                  "[ -d '$R/debug/incremental/sws_web-nuova' ]"
prova "resta deps/, anche vecchia"                  "[ -d '$R/debug/deps/libvecchia' ]"
prova "resta la cross-build aarch64"                "[ -d '$R/aarch64-unknown-linux-gnu/release/incremental/sws_web-cross' ]"
prova "salta il target con una compilazione in corso" "[ -d '$V/debug/incremental/sws_lvgl_viewer-occupata' ] && grep -q 'compilazione è in corso' '$T/uscita.log'"
prova "dice quanto ha tolto"                        "grep -q 'tolte 3 cartelle' '$T/uscita.log'"

if [ "$esci" -ne 0 ]; then
    echo "  uscita dello script:"; sed 's/^/      /' "$T/uscita.log"
fi
exit "$esci"
