#!/usr/bin/env bash
#
# Chi riceve un percorso da fuori passa dal confinamento. Tutti.
#
# PERCHÉ ESISTE
#
# Q46 (09-09-2026) ha chiuso un buco in `create_project`: accettava qualunque
# `parent_path` assoluto e ci faceva `create_dir_all`, cioè lasciava
# materializzare alberi di directory ovunque il processo potesse scrivere, e
# depositarci dentro un progetto. La correzione fu `dentro_radice`.
#
# **La stessa riga, in `upload_project_zip`, è rimasta lì un mese.** Nessuno
# l'aveva collegata: la correzione era stata pensata come «sistemare
# `create_project`», non come «nessun percorso da fuori entra senza
# confinamento». Ed era su una rotta per giunta pre-auth fino al 06-10-2026.
#
# Una regola che vale per due funzioni e viene applicata a una non è una
# regola: è una coincidenza. Questa guardia la rende una regola.
#
# COSA VERIFICA
#
#   Ogni funzione di `projects.rs` che nomina `parent_path` nomina anche
#   `dentro_radice` o `dentro_radice_nuovo`.
#
# Uso: ./scripts/check_confinamento.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
F=sws-runtime/crates/sws-web/src/projects.rs

echo "── Confinamento dei percorsi che arrivano da fuori ──"
[ -f "$F" ] || { echo "  manca $F"; exit 1; }

# Divide il file in funzioni (una `fn` a indentazione zero apre un blocco) e,
# per ciascuna, guarda se nomina `parent_path` e se nomina il confinamento.
mancanti=$(awk '
    /^(pub |pub\(crate\) )?(async )?fn [a-z_]+/ {
        if (nome != "" && usa_parent && !usa_guardia) print nome;
        nome = $0; sub(/^.*fn /, "", nome); sub(/[(<].*$/, "", nome);
        usa_parent = 0; usa_guardia = 0;
    }
    # Solo gli USI del campo (q.parent_path, req.parent_path), non la sua
    # dichiarazione nelle struct ne le menzioni nei commenti: la prima stesura
    # di questa guardia le contava tutte e le attribuiva alla funzione
    # precedente, producendo sei falsi positivi. Una guardia che segnala a
    # vuoto si impara a ignorare, ed e peggio di nessuna guardia.
    /\.parent_path/          { usa_parent = 1 }
    # Una CHIAMATA, non una menzione: con la parentesi aperta. La prima
    # stesura cercava la sola parola, e un commento che la nominava bastava a
    # far passare il controllo: la prova rossa resto verde col buco rimesso,
    # perche sopra di esso stava il commento che spiegava la correzione.
    /dentro_radice(_nuovo)?\(/ { usa_guardia = 1 }
    END { if (nome != "" && usa_parent && !usa_guardia) print nome }
' "$F")

if [ -z "$mancanti" ]; then
    n=$(grep -cE "dentro_radice(_nuovo)?\(" "$F")
    echo -e "  \033[32m✓\033[0m ogni funzione che riceve un percorso lo confina ($n riferimenti)"
    echo
    echo -e "\033[32mconfinamento: nessun percorso entra senza controllo.\033[0m"
    exit 0
else
    for f in $mancanti; do
        echo -e "  \033[31m✗\033[0m \`$f\` riceve un \`parent_path\` e non lo confina"
    done
    echo
    echo "      Un percorso che arriva da fuori va passato a \`dentro_radice\`"
    echo "      (il genitore deve esistere) o \`dentro_radice_nuovo\` (una sola"
    echo "      cartella nuova sotto un genitore esistente). È la correzione"
    echo "      Q46, e vale per tutti — non solo per chi l'ha ricevuta allora."
    echo
    echo -e "\033[31mconfinamento: un percorso entra senza controllo.\033[0m"
    exit 1
fi
