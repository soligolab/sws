#!/usr/bin/env bash
#
# Il badge «L» della palette dice il vero?
#
# PERCHÉ ESISTE
#
# L'IDE marca con una «L» i tipi di oggetto che il pannello LVGL sa disegnare.
# Quell'elenco — `LVGL_SUPPORTED_TYPES` in `sws-editor/src/editor/LeftPanel.tsx`
# — è una copia **a mano** di `SUPPORTED_TYPES` in `lvgl_render.rs`, e nessuno
# li teneva d'accordo.
#
# Quando divergono, il badge mente in uno dei due modi, entrambi silenziosi:
#
#   * dice «L» su un tipo che il pannello NON disegna → il progettista lo mette
#     in pagina, sul dispositivo non compare, e dà la colpa al dispositivo;
#   * tace su un tipo che il pannello disegna → il progettista lo evita per
#     niente, e usa un ripiego peggiore.
#
# È lo stesso schema di `check_lvgl_symbols.sh`, e nasce dalla stessa causa: due
# elenchi copiati a mano si disallineano, e il modo in cui si rompono non fa
# rumore. Il precedente concreto: quando `image`, `kpi_tile`, `data_log` e
# `alarm_history` sono entrati nel motore, la palette è stata aggiornata a mano
# — e sarebbe potuto non succedere.
#
# Uso:  ./scripts/check_lvgl_types.sh     (esce != 0 se i due elenchi divergono)
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import re, sys

root = sys.argv[1]
RS  = f"{root}/sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs"
TSX = f"{root}/sws-editor/src/editor/LeftPanel.tsx"

def estrai(path, pattern, cosa):
    testo = open(path).read()
    m = re.search(pattern, testo, re.S)
    if not m:
        print(f"  \033[31m✗\033[0m non trovo {cosa} in {path}")
        print( "      La forma della dichiarazione è cambiata: questo controllo non")
        print( "      sta più guardando niente, e va aggiornato — non è che i tipi")
        print( "      siano spariti.")
        sys.exit(1)
    return set(re.findall(r'"([a-z_]+)"', m.group(1)))

motore  = estrai(RS,  r'const SUPPORTED_TYPES: &\[&str\] = &\[(.*?)\];', "SUPPORTED_TYPES")
palette = estrai(TSX, r'const LVGL_SUPPORTED_TYPES = new Set<SynopticObject\["type"\]>\(\[(.*?)\]\)',
                 "LVGL_SUPPORTED_TYPES")

print("\033[1mIl badge «L» della palette contro il motore LVGL\033[0m\n")

solo_motore  = sorted(motore - palette)
solo_palette = sorted(palette - motore)
fail = False

if solo_motore:
    print(f"  \033[31m✗\033[0m il motore disegna {len(solo_motore)} tipi che la palette non segna → {solo_motore}")
    print( "      Il progettista li evita credendoli non supportati.")
    print(f"      Aggiungili a LVGL_SUPPORTED_TYPES in {TSX.split('/')[-1]}")
    fail = True

if solo_palette:
    print(f"  \033[31m✗\033[0m la palette segna {len(solo_palette)} tipi che il motore NON disegna → {solo_palette}")
    print( "      Il badge mente: messi in pagina, sul dispositivo non compaiono.")
    fail = True

if fail:
    print()
    print("\033[31mI due elenchi divergono.\033[0m")
    sys.exit(1)

print(f"  \033[32m✓\033[0m {len(motore)} tipi, identici da entrambe le parti")
print()
print("\033[32mIl badge «L» dice il vero.\033[0m")
PY
