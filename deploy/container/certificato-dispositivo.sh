#!/usr/bin/env bash
#
# Dà al runtime SWS il certificato del dispositivo Pixsys, al posto di un autofirmato.
#
# PERCHÉ (24-10-2026, misura sul TC620, piano docs/archive/2026-10-23-c4-tls-di-default.md)
#
# Con un certificato autofirmato il kiosk del pannello mostra «La connessione non è privata»,
# e con `--incognito` lo rifarebbe a ogni avvio. PixsysOS però ha già un certificato del
# dispositivo, firmato dalla CA Pixsys di cui il browser si fida, con `127.0.0.1` fra i nomi:
# `/mnt/protected/ssl/<seriale>-chain.server.crt`. Servendo la 7443 con quello, il sinottico
# compare senza avviso.
#
# La chiave privata è `root:root 0600`, e il runtime gira in podman rootless come `user`:
# non la legge. PixsysPortal la usa perché gira come root. Finché PixsysOS non prevede un
# modo per le applicazioni utente (domanda aperta con chi lo sviluppa), questo passaggio
# OPZIONALE la copia una volta, con sudo — eccezione decisa dal maintainer il 24-10-2026.
#
# Si lancia COME `pixsys` (l'utente con sudo sui pannelli Pixsys), sul pannello:
#
#   ./certificato-dispositivo.sh               # dati in /data/user/sws (predefinito)
#   ./certificato-dispositivo.sh --data DIR    # un'altra cartella dati
#   ./certificato-dispositivo.sh --verifica    # dice cosa farebbe, senza toccare niente
#
# Cosa fa: copia catena e chiave in `<dati>/config/tls.crt` e `tls.key`, intestate al
# proprietario della cartella dati (l'utente con cui gira il runtime), la chiave in 0600;
# tiene una copia di quelli che c'erano; riavvia `sws-runtime` come quell'utente e controlla
# che la 7443 risponda in HTTPS con il certificato del dispositivo.
#
# Avvertenze:
# - la chiave del dispositivo è la stessa di PixsysPortal: dopo la copia sta anche fuori dalla
#   partizione protetta, leggibile dall'utente del runtime;
# - «Genera self-signed» o «Rimuovi» nell'IDE la sostituiscono o la tolgono: per tornare al
#   certificato del dispositivo basta rilanciare questo script.
set -euo pipefail

DATA="/data/user/sws"
VERIFICA=0
while [ $# -gt 0 ]; do
    case "$1" in
        --data) DATA="$2"; shift 2 ;;
        --verifica) VERIFICA=1; shift ;;
        -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
        *) echo "uso: $0 [--data DIR] [--verifica]" >&2; exit 2 ;;
    esac
done

SSL=/mnt/protected/ssl
if [ ! -r /proc/device-tree/serial-number ]; then
    echo "ERRORE: /proc/device-tree/serial-number non c'è: non è un pannello Pixsys." >&2
    exit 1
fi
SERIALE="$(tr -d '\0' < /proc/device-tree/serial-number | tr '[:upper:]' '[:lower:]')"
CATENA="$SSL/$SERIALE-chain.server.crt"
CHIAVE="$SSL/$SERIALE.server.key"
CONFIG="$DATA/config"

if [ ! -e "$CATENA" ]; then
    echo "ERRORE: $CATENA non c'è. Questo pannello non ha il certificato del dispositivo." >&2
    exit 1
fi
if [ ! -d "$CONFIG" ]; then
    echo "ERRORE: $CONFIG non c'è. Installare prima il runtime (install-container.sh)." >&2
    exit 1
fi

# Il proprietario della cartella dati è l'utente con cui gira il runtime rootless.
PROPRIETARIO="$(stat -c %U "$CONFIG")"
GRUPPO="$(stat -c %G "$CONFIG")"
UID_RUNTIME="$(stat -c %u "$CONFIG")"

echo "==> certificato del dispositivo"
echo "    seriale     : $SERIALE"
echo "    sorgente    : $CATENA"
openssl x509 -in "$CATENA" -noout -subject -enddate -ext subjectAltName 2>/dev/null | sed 's/^/    /'
echo "    destinazione: $CONFIG/tls.crt, tls.key (di $PROPRIETARIO:$GRUPPO)"

if [ "$VERIFICA" -eq 1 ]; then
    echo "==> --verifica: niente di toccato."
    exit 0
fi

ORA="$(date +%Y%m%d-%H%M%S)"
for f in tls.crt tls.key; do
    if [ -e "$CONFIG/$f" ]; then
        sudo cp -p "$CONFIG/$f" "$CONFIG/$f.prima-$ORA"
        echo "    copia di sicurezza: $CONFIG/$f.prima-$ORA"
    fi
done

sudo install -o "$PROPRIETARIO" -g "$GRUPPO" -m 0644 "$CATENA" "$CONFIG/tls.crt"
sudo install -o "$PROPRIETARIO" -g "$GRUPPO" -m 0600 "$CHIAVE" "$CONFIG/tls.key"
echo "==> copiati"

echo "==> riavvio sws-runtime come $PROPRIETARIO"
sudo -u "$PROPRIETARIO" XDG_RUNTIME_DIR="/run/user/$UID_RUNTIME" systemctl --user restart sws-runtime

ATTESO="$(openssl x509 -in "$CATENA" -noout -fingerprint -sha256 | cut -d= -f2)"
for _ in $(seq 1 30); do
    SERVITO="$(echo | openssl s_client -connect 127.0.0.1:7443 -servername localhost 2>/dev/null \
        | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || true)"
    if [ -n "$SERVITO" ]; then
        break
    fi
    sleep 2
done

if [ "$SERVITO" = "$ATTESO" ]; then
    echo "==> fatto: la 7443 risponde con il certificato del dispositivo."
    echo "    impronta SHA-256: $ATTESO"
    echo "    L'IDE la mostrerà come «nuova» al prossimo «Connetti»: è questa."
    exit 0
fi
echo "ERRORE: la 7443 non risponde con il certificato del dispositivo." >&2
echo "        atteso : $ATTESO" >&2
echo "        servito: ${SERVITO:-(nessuna risposta TLS)}" >&2
echo "        Log: sudo -u $PROPRIETARIO XDG_RUNTIME_DIR=/run/user/$UID_RUNTIME journalctl --user -u sws-runtime -n 50" >&2
exit 1
