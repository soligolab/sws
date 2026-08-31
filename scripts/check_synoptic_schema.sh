#!/usr/bin/env bash
#
# Lo schema generato dice ancora il vero?
#
# PERCHÉ ESISTE
#
# `sws-web/src/synoptic_schema.rs` è generato da `gen_synoptic_schema.py` a
# partire da quattro fonti: il mirror autorevole degli oggetti, la union dei
# tipi in TypeScript, il modello delle sorgenti, e i template. È il vocabolario
# che diamo all'assistente IA dell'editor.
#
# Se il file committato è più vecchio delle sue fonti, il modello riceve un
# vocabolario sbagliato e il modo in cui si rompe è il peggiore che conosciamo:
# scrive un campo che non esiste più, serde lo scarta in silenzio, e l'oggetto
# si disegna storto sul pannello settimane dopo. È lo stesso difetto che hanno
# `check_lvgl_types.sh` e `check_lvgl_symbols.sh`, con la stessa causa — due
# elenchi che devono restare d'accordo.
#
# COSA FA
#
# Rigenera in memoria e confronta con quello su disco. Nessuna euristica: o
# sono identici, o il file è vecchio.
#
# Uso:  ./scripts/check_synoptic_schema.sh    (esce != 0 se il file è vecchio)
set -uo pipefail
cd "$(dirname "$0")/.."

FILE="sws-runtime/crates/sws-web/src/synoptic_schema.rs"

if [ ! -f "$FILE" ]; then
    echo -e "  \033[31m✗\033[0m $FILE non esiste — lancia ./scripts/gen_synoptic_schema.py"
    exit 1
fi

ATTESO="$(mktemp)"
trap 'rm -f "$ATTESO"' EXIT

if ! python3 scripts/gen_synoptic_schema.py --stdout > "$ATTESO"; then
    echo -e "  \033[31m✗\033[0m il generatore è uscito con errore (sopra il motivo)"
    exit 1
fi

if diff -q "$FILE" "$ATTESO" >/dev/null; then
    campi=$(grep -c 'Field { name:' "$FILE")
    tipi=$(sed -n '/pub const OBJECT_TYPES/,/^\];/p' "$FILE" | grep -c '^    "')
    echo -e "  \033[32m✓\033[0m schema aggiornato: $campi campi documentati, $tipi tipi di oggetto"
    exit 0
fi

echo -e "  \033[31m✗\033[0m $FILE è più vecchio delle sue fonti."
echo "      Rigeneralo:  ./scripts/gen_synoptic_schema.py"
echo
diff -u "$FILE" "$ATTESO" | head -40
echo
echo "      (differenze troncate a 40 righe)"
exit 1
