#!/usr/bin/env bash
#
# Chi fa nascere un progetto guarda la quota. Tutti e due.
#
# PERCHÉ ESISTE
#
# Sono **due** le strade che fanno nascere un progetto, `create_project` e
# `upload_project_zip`, ed è esattamente la coppia su cui la correzione Q46 ne
# sistemò una e dimenticò l'altra per un mese: il confinamento del percorso
# arrivò su `create_project` e non sull'upload, e nessuno se ne accorse finché
# non lo si andò a cercare (vedi `check_confinamento.sh`).
#
# La quota di spazio ha la stessa forma: una regola che vale per chi crea un
# progetto, e due posti dove crearlo. Metterla in uno solo vorrebbe dire che
# il limite si aggira caricando uno zip.
#
# COSA VERIFICA
#
#   Ogni funzione di `projects.rs` che **crea** un progetto — quelle che
#   nominano `known_projects.touch` con una chiave nuova — nomina anche
#   `rifiuta_se_piena`.
#
# Uso: ./scripts/check_quota_progetti.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
F=sws-runtime/crates/sws-web/src/projects.rs

echo "── Chi fa nascere un progetto guarda la quota ──"
[ -f "$F" ] || { echo "  manca $F"; exit 1; }

# Le due funzioni sono dichiarate per nome: un elenco che si verifica da sé,
# come `check_rotte_preauth`. Se ne nasce una terza va aggiunta qui, ed è
# proprio il momento in cui ci si ricorda che deve guardare la quota.
CREANO=(create_project upload_project_zip)

mancanti=()
for fn in "${CREANO[@]}"; do
    corpo=$(awk -v fn="$fn" '
        $0 ~ "^(pub )?(async )?fn " fn "\\(" { dentro = 1 }
        dentro { print }
        dentro && /^\}/ { exit }
    ' "$F")
    if [ -z "$corpo" ]; then
        mancanti+=("$fn (non trovata: rinominata?)")
    elif ! echo "$corpo" | grep -q "rifiuta_se_piena("; then
        mancanti+=("$fn")
    fi
done

# E nessun'altra funzione crea progetti di nascosto: chi chiama `touch` sul
# registro o sta nell'elenco, o sta spostando qualcosa che esiste già.
altre=$(awk '
    /^(pub |pub\(crate\) )?(async )?fn [a-z_]+/ {
        nome = $0; sub(/^.*fn /, "", nome); sub(/[(<].*$/, "", nome);
    }
    /known_projects\.touch\(/ { print nome }
' "$F" | sort -u)
NOTE=(create_project upload_project_zip open_project rename_project duplicate_project)
for a in $altre; do
    conosciuta=0
    for n in "${NOTE[@]}"; do [ "$a" = "$n" ] && conosciuta=1; done
    [ "$conosciuta" -eq 1 ] || mancanti+=("$a (registra un progetto e non è dichiarata qui)")
done

if [ "${#mancanti[@]}" -eq 0 ]; then
    echo -e "  \033[32m✓\033[0m tutte e ${#CREANO[@]} le strade che creano un progetto guardano la quota"
    echo
    echo -e "\033[32mquota: non si aggira da nessuna delle due porte.\033[0m"
    exit 0
else
    for m in "${mancanti[@]}"; do
        echo -e "  \033[31m✗\033[0m $m"
    done
    echo
    echo "      Un progetto nuovo è ciò che fa crescere lo spazio: chi lo crea"
    echo "      chiama \`rifiuta_se_piena\` prima di scrivere. Una sola delle due"
    echo "      porte controllata vuol dire che il limite si aggira dall'altra —"
    echo "      è la stessa coppia su cui Q46 dimenticò l'upload per un mese."
    echo
    echo -e "\033[31mquota: una porta non la guarda.\033[0m"
    exit 1
fi
