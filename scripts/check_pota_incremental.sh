#!/usr/bin/env bash
#
# La potatura della cache incrementale toglie solo quello che deve.
#
# PERCHÉ ESISTE
#
# `scripts/pota_incremental.sh` gira da solo a ogni `/finalizza-giornata`, dopo il
# push: una pulizia dentro un rituale è una pulizia che nessuno guarda più, e se
# sbaglia sbaglia in silenzio ogni sera (docs/plans/2026-09-29-pulizia-disco-periodica.md,
# «Rischi»). Questa guardia la fa girare su un repo finto e controlla che tocchi
# solo le cartelle incrementali vecchie — mai `deps/`, mai la cross-build
# `aarch64`, mai un target con una compilazione in corso.
#
# Uso: ./scripts/check_pota_incremental.sh
set -uo pipefail
cd "$(dirname "$0")/.."

echo
printf '\033[1mLa potatura della cache incrementale\033[0m\n'
if bash tests/shell/pota-incremental.sh; then
    echo
    printf '\033[32mpota_incremental: toglie solo la cache vecchia.\033[0m\n'
else
    echo
    printf '\033[31mpota_incremental: tocca quello che non deve, o non toglie quello che deve.\033[0m\n'
    exit 1
fi
