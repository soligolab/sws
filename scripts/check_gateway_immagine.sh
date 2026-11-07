#!/usr/bin/env bash
# Il quadlet del gateway del VPS nomina l'immagine due volte: `Image=`, quella
# del gateway, e `--gateway-immagine`, quella con cui il gateway crea i
# container dei progetti. Vanno cambiate insieme, e il commento accanto lo dice.
#
# Il 07-11-2026 la rc.3 e' andata sul VPS cambiando solo `Image=`: il gateway era
# nuovo, ma l'IDE di CasaDomotica e' rinato sulla rc.2. Il collaudo sul TC620 ha
# visto sparire tutte le correzioni del mattino senza un errore da nessuna parte.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

f=deploy/vps/quadlet/sws-gateway.container
printf '\033[1m── check_gateway_immagine ──\033[0m\n'
img=$(sed -n 's/^Image=\(.*\)$/\1/p' "$f")
prog=$(sed -n 's/^[[:space:]]*--gateway-immagine \([^ ]*\).*/\1/p' "$f")
if [ -z "$img" ] || [ -z "$prog" ]; then
    printf '  \033[31m✗\033[0m %s: manca Image= o --gateway-immagine\n' "$f"; exit 1
fi
if [ "$img" != "$prog" ]; then
    printf '  \033[31m✗\033[0m gateway su %s, progetti su %s: cambiale insieme\n' "$img" "$prog"; exit 1
fi
printf '  \033[32m✓\033[0m gateway e progetti sulla stessa immagine (%s)\n' "$img"
