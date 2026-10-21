#!/usr/bin/env bash
#
# Quello che il viewer LVGL deve ricordare passa da `cartella_stato()`.
#
# PERCHÉ ESISTE
#
# Dentro il container, `$HOME` **non è montato**: il quadlet monta
# `/data/user/sws/viewer` su `/var/sws/viewer` e dichiara `SWS_VIEWER_DATA`
# (`deploy/container/sws-lvgl-viewer.container`). `cartella_stato()`
# (`sws-lvgl-viewer/src/main.rs`) legge quella variabile e ripiega su
# `$HOME/.config/sws` solo fuori dal container. Chi compone `$HOME` a mano
# scrive quindi in una cartella che il riavvio del container butta via, e il
# dato sparisce **in silenzio**: nessun errore, nessun log, solo una cosa che
# ogni mattina ricomincia da capo.
#
# È successo tre volte. Il 02-10-2026 per la sessione dell'utente e per lo stato
# dell'aggiornamento, che da allora passano da `cartella_stato()`. Il 21-10-2026
# per altre due, trovate rimisurando i piani:
#
#   - le **impronte TLS** (`tls.rs`): la fiducia al primo contatto si rifaceva a
#     ogni riavvio, cioè non proteggeva da niente — un certificato cambiato non
#     aveva nessuna impronta vecchia con cui stonare;
#   - la **lingua scelta** (`client.rs`): un operatore se la ritrovava cambiata
#     ogni mattina, che è esattamente la cosa che il commento sopra quella
#     funzione dichiara di voler evitare.
#
# Nessuna guardia vedeva questa classe di difetto, e non si vede né in
# `cargo check` né in un test: fuori dal container i due percorsi coincidono,
# quindi in sviluppo funziona tutto.
#
# COSA CONTROLLA
#
# Nel crate del viewer, `std::env::var_os("HOME")` compare **solo** dentro
# `cartella_da`/`cartella_stato` (`main.rs`). Ogni altra occorrenza è un
# percorso che il container perde.
#
# Uso: ./scripts/check_stato_viewer.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CRATE="sws-runtime/crates/sws-lvgl-viewer/src"
echo -e "\033[1mLo stato del viewer LVGL passa da cartella_stato()\033[0m"

# `main.rs` è l'unico file che può nominare HOME: è dove la regola vive.
FUORI="$(grep -rn 'var_os("HOME")' "$CRATE" --include='*.rs' | grep -v "^$CRATE/main.rs:" || true)"

if [ -n "$FUORI" ]; then
    echo -e "  \033[31m✗\033[0m qualcuno compone \$HOME a mano invece di usare cartella_stato():"
    echo "$FUORI" | sed 's/^/      /'
    echo "      Dentro il container \$HOME non è montato: quel file sparisce a ogni riavvio."
    echo "      Usa \`crate::cartella_stato()?.join(\"<nome>\")\`."
    exit 1
fi

# E in `main.rs` deve stare solo nelle due funzioni della regola: un terzo uso
# lì dentro sarebbe la stessa cosa, scritta nel file giusto.
QUANTI="$(grep -c 'var_os("HOME")' "$CRATE/main.rs" || true)"
if [ "$QUANTI" -gt 1 ]; then
    echo -e "  \033[31m✗\033[0m main.rs nomina HOME $QUANTI volte: la regola ne vuole una, dentro cartella_stato()."
    grep -n 'var_os("HOME")' "$CRATE/main.rs" | sed 's/^/      /'
    exit 1
fi

echo -e "  \033[32m✓\033[0m solo cartella_stato() guarda \$HOME; tutto il resto passa di lì"
