#!/bin/sh
#
# Rende fidato il certificato del runtime nell'archivio del browser del
# pannello — e lo toglie quando il certificato sparisce.
#
# PERCHE' ESISTE. Il kiosk del pannello apre `https://127.0.0.1:7443`. Con un
# certificato autofirmato Chromium mostra «La connessione non e' privata» al
# posto del sinottico, a ogni avvio. Fino al 26-10-2026 si evitava usando il
# certificato del dispositivo Pixsys, di cui il browser si fida gia': ma la
# chiave privata e' `root:root 0600` e si copiava con `sudo`.
#
# Il 26-10-2026 chi sviluppa PixsysOS ha detto che quella chiave sul
# filesystem e' **gia' un errore** e potrebbe essere rimossa, e ha indicato la
# strada prevista: rendere fidato il proprio certificato nell'archivio NSS
# dell'utente. Provata sul WP630 lo stesso giorno, funziona, e non serve
# nessun privilegio.
#
# COSA FA, ESATTAMENTE. Importa `<config>/tls.crt` come **peer fidato**
# (`-t "P,,"`), non come CA. La differenza conta: una CA sul disco potrebbe
# firmare qualunque nome, un peer fidato vale per se stesso e basta. Quindi
# anche se l'archivio finisse in mano a qualcuno, non ci sarebbe dentro niente
# capace di impersonare altri siti.
#
# Idempotente: toglie sempre la voce precedente prima di scrivere la nuova,
# altrimenti `certutil` accumula omonimi e non si sa piu' quale vale.
#
# Si lancia come l'utente del kiosk (`user`), MAI con sudo: l'archivio e' suo,
# e scriverci da root lo lascerebbe con i permessi sbagliati.
#
# Uso:
#   fiducia-browser.sh <cartella-config>     # importa, o toglie se tls.crt non c'e'
#   fiducia-browser.sh <cartella-config> --verifica   # dice cosa farebbe
set -eu

CONFIG="${1:-}"
MODO="${2:-}"
NOME="SWS pannello"
NSSDB="${SWS_NSSDB:-$HOME/.pki/nssdb}"

if [ -z "$CONFIG" ]; then
    echo "uso: $0 <cartella-config> [--verifica]" >&2
    exit 2
fi

CERT="$CONFIG/tls.crt"

if ! command -v certutil >/dev/null 2>&1; then
    echo "certutil non c'e': su questo dispositivo la fiducia del browser non si puo' installare" >&2
    exit 3
fi

# L'archivio puo' non esistere ancora: su un sistema appena fatto nasce al
# primo avvio del browser. Crearlo vuoto e' sicuro e non tocca niente d'altro.
if [ ! -d "$NSSDB" ]; then
    mkdir -p "$NSSDB"
    certutil -N -d "sql:$NSSDB" --empty-password >/dev/null 2>&1 || true
fi

if [ "$MODO" = "--verifica" ]; then
    echo "archivio   $NSSDB"
    echo "certificato $CERT $([ -r "$CERT" ] && echo '(c e)' || echo '(non c e: lo toglierei)')"
    echo "nome       $NOME"
    echo "--- che cosa c'e' adesso ---"
    certutil -L -d "sql:$NSSDB" 2>/dev/null || echo "(archivio illeggibile)"
    exit 0
fi

# Si toglie sempre la voce di prima, anche quando si sta per riscriverla: e'
# l'unico modo di non ritrovarsi due certificati con lo stesso nome. Il
# fallimento non conta — vuol dire solo che non c'era.
certutil -D -d "sql:$NSSDB" -n "$NOME" >/dev/null 2>&1 || true

if [ ! -r "$CERT" ]; then
    echo "nessun tls.crt: tolta la fiducia, il pannello torna in chiaro"
    exit 0
fi

certutil -A -d "sql:$NSSDB" -n "$NOME" -t "P,," -i "$CERT"
echo "certificato del runtime reso fidato nell'archivio di $(id -un) ($NSSDB)"
