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

# SDL2's own Wayland backend (verified native, not XWayland — see
# docs/OPEN_QUESTIONS.md Q14) needs SDL_VIDEODRIVER set explicitly: without
# it, SDL2 probes backends in its own default order, which is not guaranteed
# to pick Wayland first on every build even when it's available.
export SDL_VIDEODRIVER=wayland

exec "$SWS_HOME/sws-lvgl-viewer" \
    --base-url "$SWS_LVGL_BASE_URL" \
    --page     "$SWS_LVGL_PAGE"
