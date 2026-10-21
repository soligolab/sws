#!/usr/bin/env bash
#
# Le icone del menù Strumenti: una per tipo, nostre, senza emoji.
#
# PERCHÉ ESISTE
#
# Fino al 14-10-2026 le icone della palette erano 9 emoji e 29 glifi Unicode
# scritti accanto a ogni voce: a 13 px su Linux metà erano quadratini, e due
# tipi (`data_log`, `text_list`) avevano lo stesso `≣`. Ora sono SVG nostri in
# `sws-editor/src/editor/iconeStrumenti.ts` (piano
# docs/archive/2026-10-14-strumenti-simboli-comandi.md, ramo 1). Un tipo nuovo
# aggiunto a `PALETTE_GROUPS` senza icona apparirebbe con un buco al posto
# dell'icona, e nessun test di build se ne accorge: questa guardia sì.
#
#   1. ogni tipo di `PALETTE_GROUPS` (LeftPanel.tsx) ha la sua voce in
#      `ICONE_STRUMENTI`, e nessuna icona è orfana;
#   2. nessuna icona è un doppione di un'altra;
#   3. nelle icone niente emoji né colori cablati: il colore è `currentColor`
#      (quello del gruppo), il resto è tratto.
#
# Uso:  ./scripts/check_icone_strumenti.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - <<'PY'
import re, sys
pal = open("sws-editor/src/editor/LeftPanel.tsx", encoding="utf-8").read()
ico = open("sws-editor/src/editor/iconeStrumenti.ts", encoding="utf-8").read()

blocco = re.search(r"export const PALETTE_GROUPS: PaletteGroup\[\] = \[(.*?)\n\];", pal, re.S)
if not blocco:
    print("✗ PALETTE_GROUPS non trovato in LeftPanel.tsx"); sys.exit(1)
tipi = re.findall(r'\{ type: "([a-z_]+)" \}', blocco.group(1))

tab = re.search(r"export const ICONE_STRUMENTI[^=]*= \{(.*?)\n\};", ico, re.S)
if not tab:
    print("✗ ICONE_STRUMENTI non trovato in iconeStrumenti.ts"); sys.exit(1)
icone = dict(re.findall(r"^\s+([a-z_]+): '([^']*)',", tab.group(1), re.M))

errori = []
if len(tipi) != len(set(tipi)):
    errori.append("un tipo compare due volte in PALETTE_GROUPS")
for t in tipi:
    if t not in icone: errori.append(f"{t}: nella palette ma senza icona")
for t in icone:
    if t not in tipi: errori.append(f"{t}: icona senza voce nella palette")
visti = {}
for t, svg in icone.items():
    if svg in visti: errori.append(f"{t}: stessa icona di {visti[svg]}")
    visti[svg] = t
    if re.search(r"[\U0001F000-\U0001FFFF☀-➿]", svg): errori.append(f"{t}: emoji nell'icona")
    if re.search(r"#[0-9a-fA-F]{3,8}\b|rgb\(", svg): errori.append(f"{t}: colore cablato (usa currentColor)")

if errori:
    for e in errori: print(f"✗ {e}")
    sys.exit(1)
print(f"✓ {len(tipi)} tipi nella palette, {len(icone)} icone: una per tipo, nessun doppione, niente emoji né colori")
PY
