#!/usr/bin/env bash
#
# Ogni azione di amministrazione dice CHI l'ha fatta.
#
# PERCHÉ ESISTE
#
# Il 07-10-2026 il maintainer ha provato l'invio della posta dalla console. Nel
# registro di audit la prova c'era, con l'esito, l'indirizzo e l'ora — e senza
# nessun nome. Così erano **tutte** le voci `amministrazione.*`: chi aveva
# reimpostato una password, chi aveva salvato la configurazione della posta,
# chi aveva sospeso un'azienda. Non scritto da nessuna parte.
#
# Il registro di audit esiste per attribuire, e la console è il posto dove si
# fanno le azioni che più vanno attribuite: sono quelle su **altre persone**.
# Una voce senza attore è una riga che racconta un fatto e nasconde l'unica
# cosa per cui la si andrà a rileggere.
#
# Nello stesso giro è saltato fuori che anche `auth.logout` era anonimo, e per
# il motivo di sempre: l'attore si cercava solo in `sws-auth`, cioè fra gli
# utenti del progetto, mentre su un'istanza IDE la sessione vive in
# `identita`. Una regola applicata a una strada e non all'altra.
#
# COSA VERIFICA
#
#   Nessuna chiamata a `s.audit.log(...)` in `amministrazione.rs` passa `None`
#   come attore.
#
# Uso: ./scripts/check_audit_attore.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
F=sws-runtime/crates/sws-web/src/amministrazione.rs

echo "── Chi ha fatto cosa, nel registro di amministrazione ──"
[ -f "$F" ] || { echo "  manca $F"; exit 1; }

# L'attore è il SECONDO argomento di `audit.log`: la riga dopo quella con il
# nome dell'azione. Si guarda lì, non in tutto il blocco, perché un `None`
# dentro il JSON dei dettagli è legittimo.
anonime=$(awk '
    /audit\.log\(/        { attesa = 2; next }
    attesa == 2           { azione = $0; gsub(/^[ \t]*|[ \t]*$/, "", azione); attesa = 1; next }
    attesa == 1 {
        attore = $0; gsub(/^[ \t]*|[ \t]*$/, "", attore);
        if (attore == "None,") print NR ": " azione;
        attesa = 0;
    }
' "$F")

totale=$(grep -c "audit\.log(" "$F")

if [ -z "$anonime" ]; then
    echo -e "  \033[32m✓\033[0m tutte e $totale le voci dicono chi ha agito"
    echo
    echo -e "\033[32mregistro: nessuna azione di amministrazione è anonima.\033[0m"
    exit 0
else
    while IFS= read -r r; do
        echo -e "  \033[31m✗\033[0m riga $r  \033[2m(attore: None)\033[0m"
    done <<< "$anonime"
    echo
    echo "      Il secondo argomento di \`audit.log\` è l'attore. Gli handler"
    echo "      di \`amministrazione.rs\` stanno dietro"
    echo "      \`require_amministratore_piattaforma\`, quindi l'\`AuthUser\` c'è"
    echo "      sempre: si estrae con \`Extension(chi): Extension<AuthUser>\` e"
    echo "      si passa \`Some(chi.username.clone())\`."
    echo
    echo -e "\033[31mregistro: un'azione di amministrazione non dice chi l'ha fatta.\033[0m"
    exit 1
fi
