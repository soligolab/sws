#!/usr/bin/env bash
# Il sito del manuale (piano manuale pubblico, M1, 12-11-2026): docs/manual → sws/tmp/manuale-sito/.
# mkdocs-material in podman, a versione fissa: niente da installare sulla macchina.
# Uso: ./scripts/manuale/genera_sito.sh   (esce non zero se mkdocs trova un link rotto: --strict)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IMMAGINE="docker.io/squidfunk/mkdocs-material:9.5.39"
LAVORO="$REPO/tmp/manuale-lavoro"
USCITA="$REPO/tmp/manuale-sito"
python3 -I "$REPO/scripts/manuale/prepara.py" "$REPO/docs/manual" "$REPO/scripts/manuale/capitoli_pubblici.txt" "$LAVORO"
rm -rf "$USCITA"
SUPPRESS_BOLTDB_WARNING=1 podman run --rm --userns=keep-id -v "$LAVORO:/docs:Z" "$IMMAGINE" build --strict --quiet
mv "$LAVORO/site" "$USCITA"
echo "sito in $USCITA ($(find "$USCITA" -name '*.html' | wc -l) pagine)"
