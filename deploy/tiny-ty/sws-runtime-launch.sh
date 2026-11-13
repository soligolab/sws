#!/usr/bin/env sh
#
# Avvio del runtime sul Tiny TY, chiamato da sws-runtime.service.
# Installato da deploy/tiny-ty/install.sh in /opt/sws/bin/.
#
# Diverso da deploy/generic-linux/sws-runtime-launch.sh in due punti:
#   - niente credenziali di partenza: un pannello senza utenti mostra il codice
#     di abbinamento (`abbinamento.rs`) e gli utenti arrivano col primo deploy
#     dall'IDE. È la stessa strada dei pannelli in container, provata sul Tiny
#     TY il 12-11-2026;
#   - RestrictedPython viene da /opt/sws/python, dove l'installatore estrae la
#     ruota che il pacchetto porta con sé: sul dispositivo non c'è pip, e senza
#     sandbox gli script non partono (CRA, onda 1).

set -eu

SWS_INSTALL=/opt/sws
SWS_DATA=/var/lib/sws

# Le opzioni di questa installazione (righe chiave=valore), se ci sono.
if [ -f /etc/sws/runtime.env ]; then
    # Exported as a whole: the runtime reads its SWS_* options (tunnel, cloud
    # address) from the environment, and a plain assignment would stay here.
    set -a
    # shellcheck disable=SC1091
    . /etc/sws/runtime.env
    set +a
fi

# PyO3 avvia l'interprete di sistema (python3.10), che legge PYTHONPATH.
PYTHONPATH="$SWS_INSTALL/python${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONPATH

# Come sui pannelli: niente IDE sul dispositivo, la porta 7444 serve solo la
# gestione remota (deploy, backup, utenti). `SWS_ENABLE_IDE=1` in runtime.env
# la riapre per la messa in servizio — su 256 MB, con giudizio.
NO_ADMIN=--no-admin
case "${SWS_ENABLE_IDE:-}" in
    1|true|yes|on) NO_ADMIN=
        echo "[sws] SWS_ENABLE_IDE: IDE COMPLETO abilitato su questo dispositivo" >&2 ;;
esac

# shellcheck disable=SC2086  # $NO_ADMIN vuoto non deve diventare un argomento
exec "$SWS_INSTALL/bin/sws-runtime" \
    --config         "$SWS_DATA/config" \
    --projects-root  "$SWS_DATA/projects" \
    --templates-root "$SWS_INSTALL/templates" \
    --catalog-root   "$SWS_INSTALL/catalogo/dispositivi" \
    --www            "$SWS_INSTALL/www" \
    --viewer-port    7443 \
    --admin-port     7444 \
    $NO_ADMIN
