#!/usr/bin/env bash
# (con podman) Il sito del manuale si genera senza link rotti (piano manuale pubblico, M1, 12-11-2026).
# mkdocs --strict fallisce su un link o un'àncora che non porta da nessuna parte; i link verso capitoli
# non pubblicati e verso il repo li riscrive prima scripts/manuale/prepara.py.
set -uo pipefail
cd "$(dirname "$0")/.."
if ./scripts/manuale/genera_sito.sh; then
    printf '\033[32mil sito del manuale si genera senza link rotti.\033[0m\n'
else
    printf '\033[31mil sito del manuale non si genera: vedi sopra.\033[0m\n'; exit 1
fi
