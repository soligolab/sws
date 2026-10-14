#!/usr/bin/env bash
#
# Dietro il gateway un progetto non si chiude.
#
# Il container di un progetto nasce con `--project /progetto` e non ne apre mai
# un altro: il container *e'* il progetto. Chiuderlo lo lascia acceso e vuoto, e
# chi rientra su quell'indirizzo trova «nessun progetto» su un progetto che
# esiste — successo il 12-10-2026 su /p/-/CasaDomotica/ dopo un logout, e la
# prima correzione sbagliava l'ordine: chiudeva e *poi* guardava se era il
# cloud, quindi non cambiava niente.
#
# Due lati, perche' uno solo non basta:
#  1. il server rifiuta, perche' il browser non e' l'unico che puo' chiamare;
#  2. il browser non chiama **prima** di aver visto che siamo nel cloud —
#     e si cerca `api.closeProject(`, non la parola: la prima stesura di questa
#     guardia trovava il nome dentro un commento e dava rosso su codice giusto;
#     l'ordine e' la parte che si sbaglia.
#
# Provata rossa il 12-10-2026 togliendo il controllo dal server, e invertendo
# le due righe in App.tsx.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

R=sws-runtime/crates/sws-web/src/projects.rs
A=sws-editor/src/App.tsx
esito=0

# ── 1. il server ────────────────────────────────────────────────────────────
corpo=$(sed -n '/pub async fn close_project/,/^}/p' "$R")
if ! grep -q "segreto_gateway.is_some()" <<<"$corpo"; then
    echo "✗ close_project non rifiuta dietro il gateway: il container resterebbe acceso e vuoto"
    esito=1
fi

# ── 2. il browser, e l'ORDINE ───────────────────────────────────────────────
for fn in executeClose executeLogout; do
    corpo=$(sed -n "/const $fn = async/,/^  };/p" "$A")
    guardia=$(grep -n "tornaAllaRadiceSeNelCloud\|nelCloud" <<<"$corpo" | head -1 | cut -d: -f1)
    chiusura=$(grep -n "api\.closeProject(" <<<"$corpo" | head -1 | cut -d: -f1)
    if [ -z "$guardia" ]; then
        echo "✗ $fn non guarda se siamo nel cloud"
        esito=1
    elif [ -n "$chiusura" ] && [ "$guardia" -gt "$chiusura" ]; then
        echo "✗ $fn chiama closeProject PRIMA di accorgersi del cloud: e' l'errore del 12-10"
        esito=1
    fi
done

[ "$esito" -eq 0 ] && echo "✓ nel cloud il progetto del container non si chiude (server e browser)"
exit "$esito"
