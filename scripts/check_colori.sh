#!/usr/bin/env bash
#
# I colori predefiniti sono una tabella sola: nessuno è tornato a scriverli a mano?
#
# PERCHÉ ESISTE
#
# Fino al 21-09-2026 il colore di un oggetto senza colore viveva in quattro
# posti che non si conoscevano: la creazione (`handleAddObject`), il canvas
# (`SvgCanvas.tsx`), il pannello proprietà (`colorInput(key, fallback)`) e il
# pannello LVGL (`unwrap_or("#…")`). Un Testo nasceva bianco sul canvas e nero
# nel pannello, perché la creazione scriveva stringhe CSS `var(--brand-text,
# #e2e8f0)` che `<input type="color">` sanifica a #000000 e che LVGL scarta.
#
# Ora la fonte è `tests/fixtures/colori-predefiniti.json`, specchiata in
# `sws-editor/src/coloriPredefiniti.ts` e in `lvgl_render.rs` e confrontata dai
# test. Ma i test non fanno parte della definition of done: questa guardia
# porta dentro `check_static.sh` le quattro regole che tengono la tabella
# unica, senza eseguire niente:
#
#   1. la creazione (`oggettiNuovi.ts`) non contiene `var(--`: i colori fissi
#      vengono da `predefinito()`, quelli automatici non si scrivono;
#   2. nessuna chiamata `colorInput(…)` del pannello porta un ripiego: il
#      secondo argomento non esiste più, il ripiego è della tabella;
#   3. ogni `<input type="color"` di `EditorShell.tsx` riceve un `value` che
#      passa da `estraiHex(` o da `CampoColore` — mai un campo grezzo, che può
#      essere un `var(…)` di un progetto vecchio; le eccezioni si dichiarano
#      qui con il motivo;
#   4. i template del parco non contengono `var(--`: sono progetti, e un
#      progetto contiene hex;
#   5. il modulo TS e la fixture hanno le stesse voci;
#   6. trend e xy_plot non hanno un ripiego `#hex` scritto a mano per
#      `bgColor`/`axisColor`/`gridColor`/`lineColor` e nessun `var(--brand-…)`
#      come default di `line_color` (i ripieghi vengono dalla tabella; la
#      cornice del trend è la costante dichiarata `TREND_FRAME_DEFAULT`).
#
# Uso:  ./scripts/check_colori.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$PWD" <<'PY'
import glob, json, re, sys

root = sys.argv[1]
CREAZIONE = f"{root}/sws-editor/src/editor/oggettiNuovi.ts"
SHELL = f"{root}/sws-editor/src/editor/EditorShell.tsx"
MODULO = f"{root}/sws-editor/src/coloriPredefiniti.ts"
FIXTURE = f"{root}/tests/fixtures/colori-predefiniti.json"

fatti = passati = 0
def esito(ok, msg):
    global fatti, passati
    fatti += 1
    if ok: passati += 1
    segno = "\033[32m✓" if ok else "\033[31m✗"
    print(f"  {segno}\033[0m {msg}")

def righe(p):
    return open(p, encoding="utf-8").read().split("\n")

print("=== 1. la creazione non scrive variabili CSS nel progetto ===")
cattive = [i + 1 for i, r in enumerate(righe(CREAZIONE)) if "var(--" in r]
esito(not cattive, f"oggettiNuovi.ts senza `var(--`" + (f" — righe {cattive}" if cattive else ""))

print("=== 2. il pannello non passa ripieghi: il ripiego è della tabella ===")
con_ripiego = [i + 1 for i, r in enumerate(righe(SHELL)) if re.search(r'colorInput\("\w+",', r)]
esito(not con_ripiego, "nessun `colorInput(chiave, ripiego)` in EditorShell.tsx" + (f" — righe {con_ripiego}" if con_ripiego else ""))

print("=== 3. ogni swatch riceve sei cifre hex ===")
# Un `<input type="color"` può avere il `value=` sulla stessa riga o nelle
# successive: si guarda fino alla chiusura `/>` o `>`.
rs = righe(SHELL)
problemi = []
n_swatch = 0
for i, r in enumerate(rs):
    if 'type="color"' not in r:
        continue
    n_swatch += 1
    # Il tag comincia alla riga con `<input` (la stessa, o una sopra) e finisce
    # alla prima `/>`: solo quel testo, così il `value=` è il suo e non quello
    # del campo accanto.
    inizio = i
    while inizio > 0 and "<input" not in rs[inizio]:
        inizio -= 1
    blocco = ""
    for j in range(inizio, min(len(rs), i + 10)):
        blocco += rs[j] + "\n"
        if j >= i and "/>" in rs[j]:
            break
    if "<input" in rs[inizio]:
        blocco = blocco[blocco.index("<input"):]
    m = re.search(r"value=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}", blocco)
    valore = m.group(1) if m else ""
    ok = ("estraiHex(" in valore) or ("perSwatch" in valore)
    # Eccezioni con il motivo: valori che non possono essere altro che hex.
    if re.fullmatch(r'\s*(background|background_dark \|\| background)\s*', valore):
        ok = True  # lo sfondo pagina: il campo di testo accanto accetta hex e il colore lo scrive l'utente
    if not ok:
        problemi.append(f"riga {i + 1}: value={{{valore.strip()[:60]}}}")
esito(n_swatch > 0, f"{n_swatch} swatch trovati in EditorShell.tsx")
esito(not problemi, "ogni swatch passa da estraiHex()/CampoColore" + ("".join("\n      " + p for p in problemi)))
campo = open(f"{root}/sws-editor/src/editor/CampoColore.tsx", encoding="utf-8").read()
esito('value={mixed ? "#808080" : perSwatch}' in campo, "CampoColore: lo swatch riceve `perSwatch` (estraiHex, mai il valore grezzo)")

print("=== 3b. un campo colore dell'oggetto passa dal controllo condiviso ===")
# La regola del maintainer, 23-09-2026: «il selettore colore deve essere
# definito una volta e usato ovunque serva sempre uguale». Il difetto che l'ha
# fatta nascere: lo sfondo dell'elenco allarmi mostrava solo lo swatch, mentre
# il gauge mostrava anche l'esadecimale — due controlli diversi per la stessa
# cosa, e chi li usa non capisce perché.
#
# Il confine è `obj.<campo>`: un campo dell'oggetto sinottico si scrive con
# `colorInput`, che monta `CampoColore`. Gli swatch dentro le righe di un
# elenco (serie di un grafico, fette di torta, zone di un gauge, celle, voci di
# text_list, parametri di faceplate) restano fuori: stanno in una riga con
# altre colonne, dove un campo di testo accanto non entrerebbe. Sono elencati
# qui sotto perché siano una scelta visibile e non una dimenticanza — e il
# giorno che il pannello avrà spazio, si convertono anche quelli.
ELENCHI_AMMESSI = 14  # swatch dentro righe di elenco, contati il 23-09-2026
nudi_su_obj = []
n_elenco = 0
for i, r in enumerate(rs):
    if 'type="color"' not in r:
        continue
    inizio = i
    while inizio > 0 and "<input" not in rs[inizio]:
        inizio -= 1
    blocco = ""
    for j in range(inizio, min(len(rs), i + 12)):
        blocco += rs[j] + "\n"
        if j >= i and "/>" in rs[j]:
            break
    m = re.search(r"value=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}", blocco)
    valore = m.group(1) if m else ""
    if "obj." in valore:
        nudi_su_obj.append(f"riga {inizio + 1}: value={{{valore.strip()[:60]}}}")
    else:
        n_elenco += 1
esito(
    not nudi_su_obj,
    "nessun campo `obj.*` disegna uno swatch a mano invece di `colorInput`"
    + ("".join("\n      " + x for x in nudi_su_obj)),
)
esito(
    n_elenco <= ELENCHI_AMMESSI,
    f"{n_elenco} swatch dentro righe di elenco (tetto dichiarato: {ELENCHI_AMMESSI})",
)

print("=== 4. i template del parco sono progetti: hex, non variabili ===")
tpl = sorted(glob.glob(f"{root}/examples/templates/**/*.yaml", recursive=True))
sporchi = [t.replace(root + "/", "") for t in tpl if "var(--" in open(t, encoding="utf-8").read()]
esito(tpl and not sporchi, f"{len(tpl)} file YAML senza `var(--`" + (f" — {sporchi}" if sporchi else ""))

print("=== 5. il modulo TS e la fixture hanno le stesse voci (i test le confrontano valore per valore) ===")
fx = json.load(open(FIXTURE, encoding="utf-8"))
mod = open(MODULO, encoding="utf-8").read()
mancanti = []
for tipo, campi in fx["predefiniti"].items():
    for campo_, reg in campi.items():
        val = reg.get("hex") or reg.get("auto")
        if not re.search(rf'\b{re.escape(campo_)}:\s*\{{\s*(hex|auto):\s*"{re.escape(val)}"', mod):
            mancanti.append(f"{tipo}.{campo_} = {val}")
esito(not mancanti, "ogni voce della fixture compare in coloriPredefiniti.ts" + ("".join("\n      " + m for m in mancanti)))

print("=== 6. trend / xy_plot: i ripieghi dei colori vengono dalla tabella ===")
GRAFICI = [f"{root}/sws-editor/src/canvas/TrendCanvas.tsx", f"{root}/sws-editor/src/canvas/XyPlotCanvas.tsx"]
sfusi = []
for g in GRAFICI:
    for i, r in enumerate(righe(g)):
        if re.search(r'\b(bgColor|axisColor|gridColor|lineColor)\s*\?\?\s*"#', r):
            sfusi.append(f"{g.split('/')[-1]}:{i + 1}")
svg = "\n".join(righe(f"{root}/sws-editor/src/canvas/SvgCanvas.tsx"))
if re.search(r'line_color\s*\?\?\s*"var\(', svg):
    sfusi.append("SvgCanvas.tsx: line_color ?? var(…)")
esito(not sfusi, "nessun ripiego #hex/var(…) scritto a mano in trend/xy_plot" + ("".join("\n      " + m for m in sfusi)))

print()
if passati == fatti:
    print(f"\033[32mcolori predefiniti: una tabella, {passati}/{fatti} controlli verdi.\033[0m")
    sys.exit(0)
print(f"\033[31m{fatti - passati} controlli rossi su {fatti}.\033[0m")
sys.exit(1)
PY
