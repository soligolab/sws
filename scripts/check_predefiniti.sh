#!/usr/bin/env bash
#
# I predefiniti dei campi: una tabella, e i motori che non la contraddicono.
#
# PERCHÉ ESISTE
#
# Il 30-09-2026 un `data_log` era scuro nell'editor e bianco sul pannello LVGL:
# il file non diceva lo sfondo, il web ripiegava su #0f172a e LVGL non leggeva il
# campo affatto. Fuori dai colori non c'era una tabella dei predefiniti: ogni
# ripiego era un letterale nel ramo di ciascun tipo, e niente controllava che due
# letterali dicessero la stessa cosa.
#
# Da allora la tabella è `tests/fixtures/predefiniti-campi.json` (i colori stanno
# in `colori-predefiniti.json`, con la loro guardia `check_colori.sh`), e i valori
# fissi si scrivono NEL FILE alla creazione e all'apertura. Questa guardia
# verifica i pezzi che un test unitario non vede:
#
#   1. `riempiPredefinitiOggetti` è nella catena di apertura (`setPages`) e
#      `oggettoNuovo` passa da `riempiPredefiniti`: senza, la tabella esiste e
#      nessuno la scrive nei file;
#   2. ogni ripiego `obj.<campo> ?? <letterale>` nel ramo web di un tipo coincide
#      col valore fisso della tabella per quel tipo. Un file vecchio non ancora
#      riaperto si disegna col ripiego: se il ripiego dice altro, l'oggetto cambia
#      aspetto al primo salvataggio.
#
# COSA NON DICE (ancora)
#
# Il pannello LVGL: i suoi ripieghi sono sparsi in funzioni per tipo che un grep
# non sa attribuire. Le divergenze note sono le fasi 2 e 3 del piano
# `docs/plans/2026-09-30-predefiniti-espliciti.md`.
#
# Uso: ./scripts/check_predefiniti.sh
set -uo pipefail
cd "$(dirname "$0")/.."

exec python3 - <<'PY'
import json, re, sys

ESITO = 0
def ok(m):  print("  \033[32m✓\033[0m " + m)
def ko(m):
    global ESITO
    print("  \033[31m✗\033[0m " + m); ESITO = 1

tab = json.load(open("tests/fixtures/predefiniti-campi.json"))["campi"]
store = open("sws-editor/src/store/index.ts").read()
nuovi = open("sws-editor/src/editor/oggettiNuovi.ts").read()
svg = open("sws-editor/src/canvas/SvgCanvas.tsx").read().split("\n")

print("\n\033[1mPredefiniti dei campi: una tabella, e i motori che non la contraddicono\033[0m")

print("=== 1. la tabella si scrive davvero nei file ===")
if re.search(r"riempiPredefinitiOggetti\(", store):
    ok("setPages riempie i predefiniti all'apertura")
else:
    ko("store/index.ts non chiama riempiPredefinitiOggetti: i progetti vecchi restano muti")
if re.search(r"riempiPredefiniti\(", nuovi):
    ok("oggettoNuovo passa da riempiPredefiniti")
else:
    ko("oggettiNuovi.ts non chiama riempiPredefiniti: gli oggetti nuovi nascono senza")

print("=== 2. i ripieghi del web dicono il valore della tabella ===")
tipo = None
trovati = 0
for n, riga in enumerate(svg, 1):
    m = re.search(r'obj\.type === "([a-z_]+)"', riga)
    if m:
        tipo = m.group(1)
    for m in re.finditer(r'obj\.([a-z_]+) \?\? (-?[0-9.]+|"[^"]*")', riga):
        campo, lett = m.group(1), m.group(2)
        r = tab.get(tipo or "", {}).get(campo)
        if not r or "valore" not in r:
            continue
        trovati += 1
        atteso = r["valore"]
        valore = json.loads(lett)
        if valore != atteso:
            ko(f"SvgCanvas.tsx:{n} {tipo}.{campo}: ripiego {lett}, tabella {json.dumps(atteso)}")
if ESITO == 0:
    ok(f"{trovati} ripieghi confrontati, tutti uguali alla tabella")

print()
if ESITO:
    print("\033[31mpredefiniti: la tabella e i motori non dicono la stessa cosa.\033[0m")
else:
    print("\033[32mpredefiniti: una tabella, e nessun motore la contraddice.\033[0m")
sys.exit(ESITO)
PY
