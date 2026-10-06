#!/usr/bin/env bash
#
# Le rotte raggiungibili SENZA credenziali sono una lista bianca, non una
# conseguenza.
#
# PERCHÉ ESISTE
#
# Fino al 06-10-2026 il router completo lasciava pre-auth tutto il ciclo di
# vita del progetto: creare, aprire, rinominare, cancellare e caricare un
# progetto, più `/api/fs/browse-dirs` e `/api/fs/mkdir`, che navigano il
# filesystem. Non era una svista: la WelcomeScreen chiamava quelle rotte prima
# che un token potesse esistere, perché su un IDE non c'era nessun login da
# superare. Il prezzo era scritto in un commento e nessuno lo rileggeva.
#
# Con l'archivio delle identità quel vincolo è caduto e il gruppo è passato
# dietro `require_auth`. Ma una cosa spostata una volta torna indietro da sola:
# basta un endpoint nuovo che "serve prima del login", aggiunto in fretta nel
# gruppo sbagliato, e il buco si riapre senza che nessuno lo decida.
#
# COSA VERIFICA
#
#   1. il gruppo `open` del router completo contiene SOLO le rotte dichiarate
#      qui sotto;
#   2. le rotte del ciclo di vita del progetto NON sono nel gruppo `open`;
#   3. `/api/fs/browse-dirs` e `/api/fs/mkdir` non sono pre-auth.
#
# Uso: ./scripts/check_rotte_preauth.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROUTER=sws-runtime/crates/sws-web/src/router.rs

fatti=0; passati=0
esito() {
    fatti=$((fatti + 1))
    if [ "$1" = ok ]; then passati=$((passati + 1)); echo -e "  \033[32m✓\033[0m $2";
    else echo -e "  \033[31m✗\033[0m $2"; fi
}

# ── La lista bianca ──────────────────────────────────────────────────────────
#
# Ogni voce è una rotta che DEVE poter essere chiamata senza credenziali, con
# il motivo. Aggiungerne una è una decisione: si scrive qui, e il perché si
# scrive accanto.
#
#   /health                              sonda di vita, nessun dato
#   /metrics                             sonda Prometheus. ⚠ ESPONE dati di
#                                        esercizio senza credenziali: è un
#                                        residuo da decidere (autenticarla o
#                                        confinarla su loopback), non una
#                                        scelta presa
#   /cert                                il certificato è la chiave PUBBLICA
#   /sw.js                               service worker che si disinstalla
#   /api/auth/login                      senza, non si entra
#   /api/identita/stato                  dice QUALE schermata mostrare, e a
#                                        quel punto nessun token esiste
#   /api/identita/primo-amministratore   protetta dal codice stampato
#                                        all'avvio; si chiude da sé appena un
#                                        utente esiste
ATTESE=(
    "/health"
    "/metrics"
    "/cert"
    "/sw.js"
    "/api/auth/login"
    "/api/identita/stato"
    "/api/identita/primo-amministratore"
)

echo "── Rotte raggiungibili senza credenziali ──"

# Il gruppo `open` del router completo: dalla riga `let open = Router::new()`
# fino al `;` che la chiude.
blocco_open() {
    awk '/let open = Router::new\(\)/ {dentro=1}
         dentro {print}
         dentro && /;[[:space:]]*$/ {exit}' "$ROUTER"
}

# Si estraggono TUTTE le stringhe che cominciano con `/`, non i soli
# `.route("…")` su una riga: axum permette di scrivere la rotta sulla riga
# dopo, ed è proprio la forma che userebbe chi aggiunge un percorso lungo. Una
# guardia cieca su quella forma sarebbe peggio di nessuna guardia — la prima
# stesura di questo script lo era, e non vedeva
# `/api/identita/primo-amministratore`.
mapfile -t TROVATE < <(blocco_open | grep -oE '"/[^"]*"' | tr -d '"' | sort -u)

if [ "${#TROVATE[@]}" -eq 0 ]; then
    esito ko "lettura del gruppo \`open\` fallita: il router è cambiato, aggiorna questa guardia"
else
    intruse=()
    for r in "${TROVATE[@]}"; do
        trovata=0
        for a in "${ATTESE[@]}"; do [ "$r" = "$a" ] && trovata=1 && break; done
        [ "$trovata" -eq 0 ] && intruse+=("$r")
    done
    if [ "${#intruse[@]}" -eq 0 ]; then
        esito ok "il gruppo \`open\` ha solo le ${#TROVATE[@]} rotte dichiarate"
    else
        esito ko "rotte pre-auth non dichiarate: ${intruse[*]}"
        echo "      Se davvero devono stare senza credenziali, aggiungile alla lista"
        echo "      bianca in questa guardia **con il motivo**. Se no, spostale dietro"
        echo "      \`require_auth\`."
    fi
fi

# 2. il ciclo di vita del progetto non deve tornare pre-auth
CICLO=("/api/projects" "/api/projects/:name/open" "/api/projects/:name/rename" "/api/projects/:name/duplicate" "/api/projects/close" "/api/projects/upload")
rientrate=()
for r in "${CICLO[@]}"; do
    for t in "${TROVATE[@]:-}"; do [ "$r" = "$t" ] && rientrate+=("$r"); done
done
if [ "${#rientrate[@]}" -eq 0 ]; then
    esito ok "il ciclo di vita del progetto è dietro l'autenticazione"
else
    esito ko "tornate pre-auth: ${rientrate[*]} — creare e cancellare progetti senza credenziali"
fi

# 3. il filesystem non si naviga senza credenziali
fs_aperte=()
for t in "${TROVATE[@]:-}"; do
    case "$t" in /api/fs/*) fs_aperte+=("$t") ;; esac
done
if [ "${#fs_aperte[@]}" -eq 0 ]; then
    esito ok "nessuna rotta \`/api/fs/*\` è pre-auth"
else
    esito ko "filesystem navigabile senza credenziali: ${fs_aperte[*]}"
fi

echo
if [ "$passati" -eq "$fatti" ]; then
    echo -e "\033[32mrotte pre-auth: $passati/$fatti, solo quelle dichiarate.\033[0m"
    exit 0
else
    echo -e "\033[31mrotte pre-auth: $((fatti - passati)) controlli su $fatti falliti.\033[0m"
    exit 1
fi
