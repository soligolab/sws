#!/usr/bin/env sh
#
# Launch wrapper for sws-lvgl-viewer on Pixsys Yocto devices. Installed at
# /data/user/sws/sws-lvgl-viewer-launch.sh, invoked by sws-lvgl-viewer.service.
#
# Companion to sws-runtime, not a replacement — mirrors sws-runtime-launch.sh
# (sources an .env file, sane-ish defaults, exec's the real binary), same
# reasoning: edit /data/user/sws/lvgl-viewer.env on the device instead of the
# systemd unit or this script.
#
# Unlike sws-runtime-launch.sh there is no safe default for SWS_LVGL_PAGE —
# guessing a page name wrong would just show a blank/wrong screen with no
# obvious error, worse than refusing to start. It must be set explicitly.

set -eu

SWS_HOME="/data/user/sws"

if [ -f "$SWS_HOME/lvgl-viewer.env" ]; then
    # shellcheck disable=SC1091
    . "$SWS_HOME/lvgl-viewer.env"
fi

: "${SWS_LVGL_BASE_URL:=https://localhost:8443}"

if [ -z "${SWS_LVGL_PAGE:-}" ]; then
    echo "sws-lvgl-viewer-launch.sh: SWS_LVGL_PAGE is not set." >&2
    echo "Create $SWS_HOME/lvgl-viewer.env with:" >&2
    echo "  SWS_LVGL_PAGE=\"<nome pagina iniziale del progetto>\"" >&2
    exit 1
fi

# x11, cioè XWayland — NON il backend Wayland nativo di SDL2.
#
# Questa riga diceva `wayland` fino al 2026-08-24, ed era la configurazione
# sbagliata: misurato su wp630-a-p3-07a077.local, il backend Wayland nativo di
# SDL2 fa **SIGSEGV entro tre secondi** dall'apertura della finestra, sempre.
# Non è colpa del motore LVGL — con `SDL_VIDEODRIVER=dummy` lo stesso binario
# gira a ~30 fps — ed è la stessa classe di bug già vista sul TC620, dove SDL2
# su Wayland nativo dava schermo nero. XWayland invece regge.
#
# `SDL_VIDEODRIVER` va comunque impostata esplicitamente: senza, SDL2 sonda i
# backend nel proprio ordine, che non garantisce quale scelga.
#
# DISPLAY serve perché XWayland è un server X: Weston lo avvia se ha
# `xwayland=true` in weston.ini (verificato presente su questi pannelli).
export SDL_VIDEODRIVER=x11
: "${DISPLAY:=:0}"
export DISPLAY

exec "$SWS_HOME/sws-lvgl-viewer" \
    --base-url "$SWS_LVGL_BASE_URL" \
    --page     "$SWS_LVGL_PAGE"
