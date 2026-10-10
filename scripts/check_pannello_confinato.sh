#!/usr/bin/env bash
#
# Un pannello di un'altra azienda non si raggiunge, e non si vede nemmeno.
#
# Il tunnel espone i pannelli su `/dev/<pannello>/…`. Senza il legame con
# l'azienda, chiunque sia entrato nel gateway raggiungerebbe il pannello di
# qualunque cliente — e il pannello e' la macchina che governa un impianto,
# non un elenco di nomi. La guardia verifica tre cose, perche' sono tre modi
# diversi di perdere lo stesso confine:
#
#  1. `inoltra` chiede il permesso prima di aprire lo stream;
#  2. anche l'elenco `/api/pannelli` lo chiede — un elenco che dice piu' di
#     quanto si puo' toccare insegna i nomi degli altri;
#  3. il permesso si appoggia a `appartenenze_di`, cioe' alla stessa regola
#     che filtra i progetti, invece di una seconda copia che resterebbe
#     indietro.
#
# Provata rossa il 09-10-2026 togliendo il controllo da `inoltra`, e
# separatamente da `collegati`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

F=sws-runtime/crates/sws-web/src/tunnel/gateway.rs
esito=0
[ -f "$F" ] || { echo "✗ manca $F"; exit 1; }

corpo_di() { sed -n "/pub async fn $1/,/^}/p" "$F"; }

if ! corpo_di inoltra | grep -q "puo_parlargli("; then
    echo "✗ inoltra non verifica l'azienda: un pannello di un altro cliente sarebbe raggiungibile"
    esito=1
fi

if ! corpo_di collegati | grep -q "puo_parlargli("; then
    echo "✗ l'elenco dei pannelli non e' filtrato: mostrerebbe i nomi degli altri clienti"
    esito=1
fi

corpo_permesso=$(sed -n '/async fn puo_parlargli/,/^}/p' "$F")
if ! grep -q "appartenenze_di" <<<"$corpo_permesso"; then
    echo "✗ puo_parlargli non usa appartenenze_di: e' una seconda regola da tenere d'accordo"
    esito=1
fi
# La stessa funzione che decide la visibilita' dei progetti, non un confronto
# scritto a mano: quello non saprebbe dell'azienda implicita, e un pannello li'
# dentro sarebbe invisibile a tutti tranne che alla piattaforma.
if ! grep -q "projects::visibilita(" <<<"$corpo_permesso"; then
    echo "✗ puo_parlargli non usa projects::visibilita: l'azienda implicita verrebbe trattata a parte"
    esito=1
fi

# Un pannello senza azienda non deve diventare «di tutti».
if ! grep -q "d.azienda.trim().is_empty()" "$F"; then
    echo "✗ un pannello senza azienda non viene scartato: diventerebbe raggiungibile da chiunque"
    esito=1
fi

[ "$esito" -eq 0 ] && echo "✓ tunnel: un pannello di un'altra azienda non si raggiunge e non si vede"
exit "$esito"
