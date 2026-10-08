#!/usr/bin/env bash
#
# Chi riceve l'indirizzo di un progetto passa dal risolutore. Tutti.
#
# PERCHÉ ESISTE
#
# Fino al 07-10-2026 ogni rotta che nominava un progetto lo risolveva per
# conto suo: `safe_project_name`, poi il registro, poi la cartella. Tre righe
# ripetute in quattro posti, e **in nessuno dei quattro** si guardava a quale
# azienda appartenesse. Il filtro per appartenenza viveva solo nell'**elenco**
# — e un elenco non è una guardia: chi conosceva il nome di un progetto di
# un'altra azienda lo apriva, lo rinominava e lo cancellava lo stesso.
#
# `risolvi_progetto` è l'unico punto da cui si risale da un indirizzo a una
# cartella, e lo è di proposito: ci sta dentro la verifica di appartenenza, e
# una rotta nuova che se lo saltasse riaprirebbe il buco in silenzio. Questa
# guardia è ciò che rende quel «tutti» una regola invece di una buona
# abitudine — stessa idea di `check_confinamento.sh`, che nasce dal caso
# gemello: la correzione Q46 applicata a `create_project` e dimenticata su
# `upload_project_zip` per un mese.
#
# COSA VERIFICA
#
#   Ogni funzione di `projects.rs` che estrae `Path<(String, String)>` — cioè
#   che riceve un indirizzo `<azienda>/<nome>` — nomina `risolvi_progetto(`.
#
# Uso: ./scripts/check_indirizzo_progetto.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
F=sws-runtime/crates/sws-web/src/projects.rs

echo "── L'indirizzo di un progetto passa dal risolutore ──"
[ -f "$F" ] || { echo "  manca $F"; exit 1; }

mancanti=$(awk '
    /^(pub |pub\(crate\) )?(async )?fn [a-z_]+/ {
        if (nome != "" && prende && !risolve) print nome;
        nome = $0; sub(/^.*fn /, "", nome); sub(/[(<].*$/, "", nome);
        prende = 0; risolve = 0;
    }
    # La firma: `Path((azienda, nome)): Path<(String, String)>`.
    /Path<\(String, String\)>/ { prende = 1 }
    # Una CHIAMATA, con la parentesi: una menzione in un commento non basta.
    # `check_confinamento` ha imparato questa lezione da sola, il 06-10-2026,
    # restando verde con il buco rimesso perche sopra c era il commento.
    /risolvi_progetto\(/       { risolve = 1 }
    END { if (nome != "" && prende && !risolve) print nome }
' "$F")

if [ -z "$mancanti" ]; then
    n=$(grep -c "risolvi_progetto(" "$F")
    echo -e "  \033[32m✓\033[0m ogni rotta che riceve un indirizzo lo risolve ($n riferimenti)"
    echo
    echo -e "\033[32mindirizzo: nessun progetto si raggiunge senza verificare l'azienda.\033[0m"
    exit 0
else
    for f in $mancanti; do
        echo -e "  \033[31m✗\033[0m \`$f\` riceve un indirizzo e non chiama \`risolvi_progetto\`"
    done
    echo
    echo "      Un indirizzo che arriva da fuori va passato a"
    echo "      \`risolvi_progetto\`, che verifica l'appartenenza all'azienda"
    echo "      e risponde 404 — non 403 — a chi non ne fa parte. Risolverlo"
    echo "      a mano salta quella verifica, ed è il buco che il risolutore"
    echo "      è nato per chiudere."
    echo
    echo -e "\033[31mindirizzo: un progetto si raggiunge senza verificare l'azienda.\033[0m"
    exit 1
fi
