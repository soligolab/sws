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
#   E dal 23-10-2026, **le sei operazioni che cambiano un certificato lasciano
#   traccia, con un nome**. Cinque su sei non la lasciavano: c'era solo un
#   `tracing::info!`, che non è il registro che si va a rileggere. È la
#   decisione 7 del piano `docs/archive/2026-10-15-certificati-in-un-posto-solo.md`,
#   e chiude il requisito CRA di tracciabilità sui certificati.
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

male=0

# ── Le sei operazioni che cambiano un certificato ───────────────────────────
#
# Ognuna deve scrivere la sua voce E dire chi: `Some(user.username`. Si cerca
# nei due file che le ospitano, non in tutto il repo, così la guardia non passa
# per un nome che compare in un commento altrove.
cert_ok() { # cert_ok <evento> <file>
    if grep -A 2 "\"$1\"" "$2" | grep -q "Some(user.username"; then
        echo -e "  \033[32m✓\033[0m $1 lascia traccia, con un nome"
    else
        echo -e "  \033[31m✗\033[0m $1: manca dal registro, o non dice chi — $2"
        male=1
    fi
}
echo
echo "── Le sei operazioni che cambiano un certificato ──"
S=sws-runtime/crates/sws-web/src/system.rs
R=sws-runtime/crates/sws-web/src/router.rs
M=sws-runtime/crates/sws-web/src/remote.rs
cert_ok tls.generate       "$S"
cert_ok tls.upload         "$S"
cert_ok tls.remove         "$S"
cert_ok opcua.cert_trust   "$R"
cert_ok opcua.cert_delete  "$R"
# La sesta c'era già dal 2026: il «dimentica» dell'impronta di un dispositivo.
cert_ok device.cert_forget "$M"
# La settima (25-10-2026): il «dimentica» della vista dei certificati, che
# toglie una riga dagli archivi delle impronte (dispositivi e broker MQTT).
cert_ok cert.forget        "$R"
# L'ottava era `tls.choice`, la risposta alla proposta dell'HTTPS col
# certificato del dispositivo. **Ritirata il 26-10-2026** insieme a quella
# strada: non c'e' piu' una scelta da registrare, perche' non c'e' piu' una
# proposta. Dove il browser del pannello si fida l'HTTPS si accende da se'
# (`fiducia-browser`), e quel che resta da tracciare — generare, caricare,
# togliere un certificato — e' gia' nelle sette righe qui sopra.
# E le remote, nate insieme alle rotte `/api/remote/system/tls`: cambiano un
# certificato anche loro, su un'altra macchina. Passano tutte da `inoltra_tls`,
# che l'attore lo scrive in un posto solo: qui si controlla che il nome
# dell'evento arrivi fin lì e che quel posto solo dica ancora chi.
for e in remote.tls_generate remote.tls_upload remote.tls_remove; do
    grep -q "\"$e\"" "$M" \
      && echo -e "  \033[32m✓\033[0m $e arriva a inoltra_tls" \
      || { echo -e "  \033[31m✗\033[0m $e: nessun chiamante lo dichiara — $M"; male=1; }
done
if sed -n '/^async fn inoltra_tls(/,/^}/p' "$M" | grep -A 2 "audit.log(" | grep -q "Some(user.username"; then
    echo -e "  \033[32m✓\033[0m inoltra_tls scrive l'attore per tutte e tre"
else
    echo -e "  \033[31m✗\033[0m inoltra_tls non scrive più l'attore: le tre voci remote diventano anonime insieme"
    male=1
fi

if [ -z "$anonime" ] && [ "$male" -eq 0 ]; then
    echo
    echo -e "  \033[32m✓\033[0m tutte e $totale le voci di amministrazione dicono chi ha agito"
    echo
    echo -e "\033[32mregistro: nessuna azione di amministrazione è anonima, e i certificati lasciano traccia.\033[0m"
    exit 0
elif [ -z "$anonime" ]; then
    echo
    echo -e "\033[31mregistro: un'operazione sui certificati non lascia traccia.\033[0m"
    exit 1
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
