#!/usr/bin/env bash
#
# «Gli occhi»: il runtime sa fotografare una pagina come la disegna LVGL?
#
# Prova la catena intera — copia del progetto, runtime usa e getta, viewer
# LVGL, PPM, PNG — e verifica che dentro l'immagine ci sia davvero quello che
# c'era scritto nel progetto.
#
# # Perché una guardia e non un test normale
#
# Il test end-to-end vuole `sws-lvgl-viewer` **compilato**, e `cargo test` non
# lo compila: è un altro binario del workspace. Marcarlo `#[ignore]` e lanciarlo
# da qui è l'unico modo onesto — l'alternativa, un test che si salta da sé
# quando il prerequisito manca, è verde e cieco, e in questo progetto è già
# capitato (un test su RestrictedPython che «passava» senza provare niente).
#
# Sta fra le guardie CON_STACK di `check_static.sh`: non serve rete né un
# dispositivo, ma serve compilare due binari, e sono minuti.
#
# Uso: ./scripts/check_istantanea.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO/sws-runtime" || exit 1

# Su pyenv il runtime non parte senza questo, e il fallimento arriverebbe
# travestito da «il runtime di prova non risponde». Stessa toppa di
# start_runtime.sh e di check_project_write_safety.sh.
if [[ "$(command -v python3)" == *".pyenv/shims"* ]]; then
  pv="$(pyenv version 2>/dev/null | awk '{print $1}')"
  [ -n "$pv" ] && export LD_LIBRARY_PATH="$HOME/.pyenv/versions/$pv/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

echo "=== 1. i due binari che servono ==="
if ! cargo build -p sws-runtime -p sws-lvgl-viewer 2>&1 | tail -3; then
  echo "  ✗ la compilazione è fallita" >&2
  exit 1
fi
for b in sws-runtime sws-lvgl-viewer; do
  if [ -x "target/debug/$b" ]; then
    echo "  ✓ target/debug/$b"
  else
    echo "  ✗ manca target/debug/$b" >&2
    exit 1
  fi
done

echo
echo "=== 2. la catena intera, dal progetto al PNG ==="
# `--include-ignored` perché il test end-to-end è marcato `#[ignore]`: vuole
# esattamente i binari che abbiamo appena costruito.
#
# L'uscita va in un file e non in una pipe verso `tail`: in una pipe il codice
# d'uscita che si legge è quello di `tail`, che riesce sempre — e la guardia
# sarebbe verde su test rossi.
LOG="${TMPDIR:-/tmp}/sws-check-istantanea.log"
if cargo test -p sws-web istantanea -- --include-ignored > "$LOG" 2>&1; then
  tail -12 "$LOG"
else
  tail -25 "$LOG" >&2
  echo "  ✗ i test dell'istantanea sono rossi (uscita completa in $LOG)" >&2
  exit 1
fi

echo
echo -e "\033[32m✓ gli occhi funzionano: la pagina scritta nel progetto si vede nel PNG.\033[0m"
