#!/usr/bin/env bash
#
# T-52 — «fuori pagina» è una definizione sola, scritta due volte.
#
# La domanda «questo oggetto sta fuori dal foglio?» serve in quattro posti che
# non si conoscono fra loro: il canvas del browser, il gate del viewer web, il
# motore LVGL e il validatore. Le implementazioni sono **due** — una in
# TypeScript (`sws-editor/src/pageLayout.ts`) e una in Rust
# (`sws-core/src/geometry.rs`) — e due implementazioni della stessa regola
# divergono, prima o poi, in silenzio: l'editor mostrerebbe grigio un oggetto
# che il pannello disegna, o viceversa.
#
# Tre presidi, e questa guardia ne è due:
#   1. la matematica sta in un posto per linguaggio (non qui);
#   2. la **stessa tabella di casi** è dichiarata come dato in entrambi, e qui
#      si confronta riga per riga;
#   3. i due crate Rust devono **chiamare** `is_off_page`, non riscriverlo: si
#      verifica che nessuno confronti i bordi per conto suo.
#
# Precedente da cui questa nasce: `sws-editor/tests/textOnBackground.test.ts` e
# i test Q18 in `lvgl_render.rs` sono già una tabella duplicata fra i due
# linguaggi, tenuta allineata **solo da una frase in prosa** («Se qui si cambia
# una soglia, va cambiata anche là»). Nessuna guardia la copre; ora il modello
# per coprirla esiste.
#
# Uso:  ./scripts/check_off_page.sh     (esce != 0 se le due tabelle divergono)
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import re, sys

root = sys.argv[1]
RS = f"{root}/sws-runtime/crates/sws-core/src/geometry.rs"
TS = f"{root}/sws-editor/src/pageLayout.ts"

def estrai(path, pattern, cosa):
    testo = open(path).read()
    m = re.search(pattern, testo, re.S)
    if not m:
        print(f"  \033[31m✗\033[0m non trovo {cosa} in {path}")
        print( "      La forma della dichiarazione è cambiata: questo controllo non")
        print( "      sta più guardando niente, e va aggiornato — non è che la")
        print( "      tabella sia sparita.")
        sys.exit(1)
    return m.group(1)

# Le righe sono tuple/array di nove campi: nome, tipo, x, y, w, h, pw, ph,
# atteso. Si normalizzano i numeri (1280 e 1280.0 sono lo stesso caso) e le
# virgolette, così il confronto è sul contenuto e non sulla sintassi dei due
# linguaggi.
def righe(testo, virgolette):
    fuori = []
    for riga in re.findall(r'[\(\[]([^()\[\]]*?)[\)\]]\s*,', testo):
        campi = [c.strip() for c in riga.split(",")]
        if len(campi) != 9:
            continue
        nome = campi[0].strip(virgolette)
        tipo = campi[1].strip(virgolette)
        try:
            numeri = [f"{float(c):g}" for c in campi[2:8]]
        except ValueError:
            continue
        fuori.append(" ".join([nome, tipo, *numeri, campi[8]]))
    return fuori

rs = righe(estrai(RS, r'pub const CASI_FUORI_PAGINA: &\[\([^\]]*?\)\] = &\[(.*?)\n\];', "CASI_FUORI_PAGINA (Rust)"), '"')
ts = righe(estrai(TS, r'export const CASI_FUORI_PAGINA:[^=]*= \[(.*?)\n\];', "CASI_FUORI_PAGINA (TypeScript)"), '"\'')

if not rs or not ts:
    print(f"  \033[31m✗\033[0m tabella vuota dopo l'estrazione (Rust {len(rs)}, TypeScript {len(ts)})")
    print( "      Una tabella vuota non è un accordo: la guardia passerebbe senza")
    print( "      aver confrontato niente.")
    sys.exit(1)

male = False
for r in rs:
    if r not in ts:
        print(f"  \033[31m✗\033[0m solo in Rust:       {r}")
        male = True
for t in ts:
    if t not in rs:
        print(f"  \033[31m✗\033[0m solo in TypeScript: {t}")
        male = True
if male:
    print()
    print("      Le due tabelle non dicono la stessa cosa, quindi le due")
    print("      implementazioni del fuori pagina non la dicono più: l'editor")
    print("      mostrerebbe grigio un oggetto che il pannello disegna, o il")
    print("      contrario. Allinea i casi in geometry.rs e in pageLayout.ts.")
    sys.exit(1)

# Presidio 3: i due crate chiamano la definizione, non la riscrivono.
for crate, file in (("sws-web", "synoptic.rs"), ("sws-lvgl-viewer", "model.rs")):
    path = f"{root}/sws-runtime/crates/{crate}/src/{file}"
    testo = open(path).read()
    if "sws_core::is_off_page" not in testo:
        print(f"  \033[31m✗\033[0m {crate}/{file} non chiama sws_core::is_off_page")
        print( "      Se il fuori pagina è stato riscritto qui dentro, le definizioni")
        print( "      tornano a essere tre e questa guardia non le vede più.")
        sys.exit(1)

print(f"  \033[32m✓\033[0m fuori pagina: {len(rs)} casi identici fra geometry.rs e pageLayout.ts,")
print( "    e i due crate chiamano la definizione invece di riscriverla")
PY
