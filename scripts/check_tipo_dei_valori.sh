#!/usr/bin/env bash
#
# Un valore che entra in TagDb passa dal tipo dichiarato del tag. Tutti.
#
# PERCHÉ ESISTE
#
# L'08-10-2026 il maintainer ha definito un tag `u8` con 0 decimali, gli ha
# messo un generatore a rampa 0..100, e nella colonna «Live value» ha letto
# `41.333333333333336`.
#
# La conversione esisteva già, in **due** versioni — `coerce_for_write` per le
# scritture utente (rifiuta ciò che perde informazione) e `ingest` per i valori
# che arrivano dal campo (arrotonda e satura) — ed erano applicate ovunque:
# API, WebSocket, ricette, script Python, plugin. Ovunque tranne due posti, i
# **generatori d'onda** e i **tag derivati**, che scrivevano con `set` diretto.
#
# Due strade su quattro. È la stessa forma di Q46 (`check_confinamento`) e del
# cambio password del 07-10: una regola applicata a una strada e dimenticata su
# un'altra non è una regola, è una coincidenza. Questa guardia la rende regola.
#
# COSA VERIFICA
#
#   Ogni funzione (fuori dai test) che chiama `db.set(...)` nomina anche uno
#   dei modi leciti di arrivarci: `coerce_for_write`, `set_tipizzato`,
#   `ingest`, o la semina dei valori iniziali di progetto.
#
# Uso: ./scripts/check_tipo_dei_valori.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "── Un valore entra in TagDb col tipo del tag ──"

# Non si raggruppa per FUNZIONE, si guarda una finestra di righe.
#
# La prima stesura di questa guardia raggruppava per funzione, come fa
# `check_confinamento`. Qui non funziona: i due supervisori stanno dentro
# `async fn main()`, che e lunga un migliaio di righe e da qualche altra parte
# nomina `coerce_for_write` — il controllo risultava soddisfatto a vuoto. La
# prova rossa l'ha mostrato subito: rimesso il difetto, verde.
#
# Una conversione che vale per una scrittura sta **vicino** a quella
# scrittura: 40 righe sopra bastano per tutti i percorsi leciti di oggi (il
# piu lontano, `write_tag`, ne ha 31) e non bastano a farsi coprire da una
# conversione che riguarda altro.
FINESTRA=40

mancanti=$(
  find sws-runtime/crates -name '*.rs' -not -name 'tests.rs' -not -path '*/target/*' -print0 \
  | xargs -0 awk -v finestra="$FINESTRA" '
      FNR == 1 { nei_test = 0; delete visto }
      /^#\[cfg\(test\)\]|^mod tests|^[[:space:]]+mod tests/ { nei_test = 1 }
      nei_test { next }
      /coerce_for_write|set_tipizzato|\.ingest\(|initial_value\(|valore_iniziale\(/ {
          ultima_conversione = FNR
      }
      # La chiamata, non la definizione dentro TagDb e non un commento.
      /(^|[^_[:alnum:]])db\.set\(/ {
          riga = $0; sub(/^[[:space:]]+/, "", riga);
          if (riga ~ /^\/\//) next;
          if (FNR - ultima_conversione > finestra || ultima_conversione == 0)
              print FILENAME ":" FNR;
      }
  '
)

if [ -z "$mancanti" ]; then
    n=$(grep -rc "set_tipizzato\|coerce_for_write" --include=*.rs sws-runtime/crates 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
    echo -e "  \033[32m✓\033[0m ogni scrittura nomina il modo con cui rispetta il tipo ($n riferimenti)"
    echo
    echo -e "\033[32mtipi: nessun valore entra in TagDb scavalcando il tipo dichiarato.\033[0m"
    exit 0
else
    while IFS= read -r r; do
        echo -e "  \033[31m✗\033[0m $r"
    done <<< "$mancanti"
    echo
    echo "      Un valore che entra in TagDb deve passare dal tipo dichiarato:"
    echo "      \`ingest\` se arriva dal campo (scala raw→eng + arrotonda),"
    echo "      \`set_tipizzato\` se è prodotto in casa (generatore, espressione:"
    echo "      già in unità ingegneristiche), \`coerce_for_write\` se è una"
    echo "      scrittura dell'utente (rifiuta ciò che perde informazione)."
    echo
    echo -e "\033[31mtipi: un valore entra in TagDb scavalcando il tipo dichiarato.\033[0m"
    exit 1
fi
