#!/usr/bin/env bash
#
# Il capitolo dei widget nomina tutti i tipi che la palette offre?
#
# PERCHÉ ESISTE
#
# `docs/manual/05_widget_reference.md` si presenta come «elenco completo di
# tutti i widget disponibili nella palette dell'editor». Il 2026-09-06 ne
# nominava **24 su 35**: mancavano setpoint, i due widget per la lingua, la spia
# di stato, il riquadro KPI, il grafico X-Y, il registro dati, i tre widget
# degli allarmi e il pannello ricette — cioè un terzo della palette, e proprio i
# tipi aggiunti più di recente, quelli su cui la documentazione serve di più.
#
# Nessuno se n'era accorto perché aggiungere un widget e documentarlo sono due
# gesti separati, e il secondo non è preteso da niente. Questa guardia lo
# pretende: un tipo nuovo nel motore, senza una riga nel manuale, la fa
# fallire.
#
# **Non pretende una voce ben scritta** — non saprebbe giudicarla. Pretende che
# il nome del tipo compaia. È il minimo che si può verificare a macchina, ed è
# molto meglio di niente: la lacuna che ha trovato era esattamente «il nome non
# c'è da nessuna parte».
#
# Uso:  ./scripts/check_manuale_widget.sh
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import re, sys

root = sys.argv[1]
RS  = f"{root}/sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs"
DOC = f"{root}/docs/manual/05_widget_reference.md"

testo = open(RS).read()
m = re.search(r'const SUPPORTED_TYPES: &\[&str\] = &\[(.*?)\];', testo, re.S)
if not m:
    print("  \033[31m✗\033[0m non trovo SUPPORTED_TYPES in lvgl_render.rs")
    print("      La forma della dichiarazione è cambiata: questo controllo non sta più")
    print("      guardando niente, e va aggiornato — non è che i tipi siano spariti.")
    sys.exit(1)
tipi = sorted(set(re.findall(r'"([a-z_0-9]+)"', m.group(1))))
if not tipi:
    print("  \033[31m✗\033[0m elenco dei tipi vuoto dopo l'estrazione: la guardia non confronterebbe niente")
    sys.exit(1)

doc = open(DOC).read()
# Si cerca il tipo scritto **come codice**, `così`: cercarlo come parola nuda
# darebbe per documentato un `table` che compare nella parola «tabella».
citati = set(re.findall(r'`([a-z_0-9]+)`', doc))
manca = [t for t in tipi if t not in citati]

if manca:
    print(f"  \033[31m✗\033[0m {len(manca)} tipi su {len(tipi)} non sono nominati in docs/manual/05_widget_reference.md:")
    for t in manca:
        print(f"      {t}")
    print()
    print("      Quel capitolo si presenta come «elenco completo di tutti i widget")
    print("      disponibili nella palette»: se un tipo non c'è, il capitolo mente a chi")
    print("      lo legge per sapere cosa può usare. Lo schema del runtime dà campi ed")
    print("      esempio già pronti: GET /api/schema/synoptic?tipo=<tipo>")
    sys.exit(1)

print(f"  \033[32m✓\033[0m manuale dei widget: tutti e {len(tipi)} i tipi del motore sono documentati")
PY
