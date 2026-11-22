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

# The version this install declares (22-11-2026): the package's VERSIONE file
# (`2.26.0-rc.27 (abc1234)`; the runtime keeps the first word). No longer
# compiled into the binary: sws_core::project::runtime_version.
if [ -f "$SWS_INSTALL/VERSIONE" ]; then
    SWS_VERSION="$(cut -d' ' -f1 "$SWS_INSTALL/VERSIONE")"
    export SWS_VERSION
fi

# The viewer drives the backlight here (schermo.rs, --retroilluminazione): the
# control panel only saves the brightness, and the viewer applies it.
export SWS_BACKLIGHT_BY_VIEWER=1

# No launcher of Pixsys here: the corner that reboots when held is watched by
# the viewer too, and the control panel saves which one and how.
export SWS_REBOOT_CORNER_BY_VIEWER=1
# So is the rotation: a portrait project and a device mounted upside down are
# turned by the viewer, which owns the framebuffer here.
export SWS_ROTATION_BY_VIEWER=1

# The boot image here is a raw framebuffer dump that Pixsys' rc.local copies
# to the screen (/data/plc/bootlogo.raw, linked to this file by install.sh).
export SWS_BOOT_IMAGE_RAW="$SWS_DATA/config/boot-image/bootlogo.raw"
# The NTP servers of the control panel: chrony's sources file, which the
# installer hands to this user (remove-panelcontrol.sh).
export SWS_NTP_SOURCES=/etc/chrony/sources.d/sws.sources
# The diagnostic export: the helper that reads the system's logs and writes
# on the USB stick, run through sudo (see install.sh).
# The path sudoers names, to the letter.
export SWS_DIAGNOSTICS_HELPER=/opt/sws/bin/sws-diagnostics

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

# The UPS: on the boards that have one rc.local makes GPIO36 an input, reading
# 1 while mains is present; on the others an output held at 1. The runtime
# watches it and reboots the device when it falls (`power_fail.rs`); Pixsys'
# tyx_panelcontrol did it before remove-panelcontrol.sh took it off.
# Not tested for here: at boot this runs before rc.local has exported the pin
# (TY570, 15-11-2026: the watch never started), and the runtime simply reads
# nothing until the file is there.
: "${SWS_POWER_FAIL_INPUT:=/sys/class/gpio/gpio36/value}"
export SWS_POWER_FAIL_INPUT

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
