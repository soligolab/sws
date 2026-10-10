#!/usr/bin/env bash
#
# L'identità delegata la scrive il gateway, mai il browser.
#
# `gateway/inoltro.rs` butta via `x-sws-utente` e `x-sws-gateway` prima di
# rigirare una richiesta al container del progetto, e poi ci mette le proprie.
# Se quel filtro sparisse, chiunque potrebbe mandare al gateway
# `x-sws-utente: qualcun-altro@esempio.it` e il container ci crederebbe — il
# segreto non lo fermerebbe, perché il segreto giusto lo aggiungiamo noi nella
# stessa richiesta.
#
# Provato rosso il 09-10-2026 togliendo "x-sws-utente" da DA_TOGLIERE_ANDANDO
# e, separatamente, togliendo la chiamata a `da_saltare` da `inoltra_http`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

F=sws-runtime/crates/sws-web/src/gateway/inoltro.rs
esito=0

[ -f "$F" ] || { echo "✗ manca $F"; exit 1; }

# 1. Le due intestazioni sono nell'elenco di quelle da togliere andando.
elenco=$(sed -n '/const DA_TOGLIERE_ANDANDO/,/;/p' "$F")
for h in x-sws-gateway x-sws-utente; do
    if ! grep -q "\"$h\"" <<<"$elenco"; then
        echo "✗ $h non è in DA_TOGLIERE_ANDANDO: il browser potrebbe dichiararsi chi vuole"
        esito=1
    fi
done

# 2. `inoltra_http` filtra davvero, invece di copiare tutto.
corpo=$(sed -n '/pub async fn inoltra_http/,/^}/p' "$F")
if ! grep -q "da_saltare(nome.as_str(), true)" <<<"$corpo"; then
    echo "✗ inoltra_http non filtra le intestazioni in andata (da_saltare(.., true))"
    esito=1
fi

# 3. E aggiunge le proprie: senza, il container rifiuterebbe tutto.
if ! grep -q "identita(segreto, utente)" <<<"$corpo"; then
    echo "✗ inoltra_http non aggiunge l'identità del gateway"
    esito=1
fi

[ "$esito" -eq 0 ] && echo "✓ inoltro: l'identità la scrive il gateway, non il browser"
exit "$esito"
