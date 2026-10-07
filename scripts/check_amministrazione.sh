#!/usr/bin/env bash
#
# Ogni rotta della console di amministrazione passa dalla sua guardia.
#
# PERCHÉ ESISTE
#
# `amministrazione.rs` espone cose che cambiano la piattaforma: approvare
# un'azienda, promuovere un amministratore, scrivere la configurazione della
# posta. Sono protette perché il router applica due livelli al gruppo —
# `require_auth` e `require_amministratore_piattaforma` — e non perché le
# singole funzioni controllino qualcosa.
#
# È una protezione che vive in un punto solo, lontano dalle funzioni che
# protegge. Basta che qualcuno, aggiungendo una rotta, la registri «al volo»
# nel gruppo sbagliato — o che un giorno il gruppo venga spezzato in due —
# perché la protezione sparisca senza che niente si rompa: la rotta continua a
# funzionare, solo che risponde a tutti. È il tipo di difetto che non si nota
# finché non è un incidente.
#
# Questa guardia ricollega le due cose: elenca le rotte dichiarate nel modulo e
# verifica che il router le prenda tutte insieme, dietro le due guardie.
#
# Uso: ./scripts/check_amministrazione.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
MOD=sws-runtime/crates/sws-web/src/amministrazione.rs
ROUTER=sws-runtime/crates/sws-web/src/router.rs

fatti=0; passati=0
esito() {
    fatti=$((fatti + 1))
    if [ "$1" = ok ]; then passati=$((passati + 1)); echo -e "  \033[32m✓\033[0m $2";
    else echo -e "  \033[31m✗\033[0m $2"; fi
}

echo "── La console di amministrazione ──"

[ -f "$MOD" ] || { echo "  manca $MOD"; exit 1; }

# 1. ogni rotta del modulo sta sotto il prefisso: è ciò che la rende
#    riconoscibile a colpo d'occhio e separabile quando traslocherà nel gateway.
mapfile -t ROTTE < <(grep -oE '"/[^"]*"' "$MOD" | tr -d '"' | grep -E '^/api/' | sort -u)
fuori=()
for r in "${ROTTE[@]:-}"; do
    case "$r" in /api/amministrazione/*) ;; *) fuori+=("$r") ;; esac
done
if [ "${#ROTTE[@]}" -eq 0 ]; then
    esito ko "nessuna rotta trovata in amministrazione.rs: la guardia non sta leggendo niente"
elif [ "${#fuori[@]}" -eq 0 ]; then
    esito ok "tutte e ${#ROTTE[@]} le rotte stanno sotto /api/amministrazione/"
else
    esito ko "rotte fuori dal prefisso: ${fuori[*]}"
fi

# 2. il router monta il gruppo con TUTTE E DUE le guardie
blocco=$(awk '/let amministrazione = crate::amministrazione::rotte\(\)/ {dentro=1}
              dentro {print}
              dentro && /;[[:space:]]*$/ {exit}' "$ROUTER")
if [ -z "$blocco" ]; then
    esito ko "il router non monta più \`amministrazione::rotte()\`: le rotte esistono e non sono protette"
else
    manca=()
    echo "$blocco" | grep -q "require_amministratore_piattaforma" || manca+=("require_amministratore_piattaforma")
    echo "$blocco" | grep -q "require_auth" || manca+=("require_auth")
    if [ "${#manca[@]}" -eq 0 ]; then
        esito ok "il gruppo è dietro require_auth e require_amministratore_piattaforma"
    else
        esito ko "guardie mancanti sul gruppo: ${manca[*]}"
    fi
fi

# 3. nessuna di quelle rotte è registrata altrove: una seconda registrazione,
#    fuori dal gruppo, la esporrebbe senza togliere la prima — quindi non si
#    noterebbe provando che la console funziona.
doppie=()
for r in "${ROTTE[@]:-}"; do
    n=$(grep -c -F "\"$r\"" "$ROUTER")
    [ "$n" -gt 0 ] && doppie+=("$r")
done
if [ "${#doppie[@]}" -eq 0 ]; then
    esito ok "nessuna rotta della console è registrata anche nel router"
else
    esito ko "registrate due volte, una delle quali fuori dal gruppo: ${doppie[*]}"
fi

echo
if [ "$passati" -eq "$fatti" ]; then
    echo -e "\033[32mamministrazione: $passati/$fatti, la console è protetta.\033[0m"
    exit 0
else
    echo -e "\033[31mamministrazione: $((fatti - passati)) controlli su $fatti falliti.\033[0m"
    exit 1
fi
