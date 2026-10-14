#!/usr/bin/env bash
#
# La libreria di simboli SCADA è quella che esce dal generatore, e rispetta il formato?
#
# PERCHÉ ESISTE
#
# Gli SVG di `sws-editor/public/symbols/lib/` e il loro `manifest.json` sono un
# prodotto di `scripts/simboli/genera.py`: palette dei materiali, veli, contorno
# e geometria delle parti vive stanno lì, in un punto solo (decisione 14 del
# piano docs/archive/2026-10-14-libreria-simboli-scada.md). Un ritocco a mano in
# Inkscape funziona sul web e rompe in silenzio quello che il motore si aspetta:
# un materiale senza `data-mat` non si ritinge più, un velo senza `opacity="1"`
# non segue il volume, un `<text>` sul pannello non si vede (resvg senza font),
# un filtro lo rende trasparente.
#
# COSA PRETENDE (lo verifica `genera.py --controlla`)
#
#   1. rigenerare dà esattamente i file committati, manifesto compreso;
#   2. nessun elemento vietato: text, style, script, image, filtri, animate;
#   3. ogni colore pieno o di tratto viene da un materiale della tabella, e
#      i veli usano solo bianco e nero;
#   4. ogni velo nasce con opacity="1" (l'opacità è del volume);
#   5. ogni simbolo ha lo strato `body`, e le parti del manifesto esistono;
#   6. viewBox multiplo di 10 e non oltre i 512 del pannello;
#   7. `replaces` nomina un builtin vero, e nessun builtin è sostituito due volte;
#   8. ogni etichetta è in it.json e en.json, uguale a quella del generatore.
#
# Uso:  ./scripts/check_libreria_simboli.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 scripts/simboli/genera.py --controlla
