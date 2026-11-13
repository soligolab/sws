#!/usr/bin/env sh
#
# Avvio del viewer LVGL sul Tiny TY, chiamato da sws-lvgl-viewer.service.
# Installato da deploy/tiny-ty/install.sh in /opt/sws/bin/.
#
# Tre cose che sui pannelli PixsysOS sono fisse e qui vanno cercate, perché la
# famiglia Tiny TY ha sei modelli (capacitivi e resistivi, 800×480 e 1024×600)
# e nessuno crea per noi i link /dev/input/ts:
#   - la scheda DRM: la prima con un connettore collegato;
#   - il touch: il dispositivo di input che si chiama come un touch, preso dal
#     suo percorso stabile in /dev/input/by-path (il numero di eventN cambia
#     fra due avvii);
#   - lo schema verso il runtime: `http` finché il runtime non ha un
#     certificato, come decide lui stesso all'avvio (`tls.crt`). Viewer e
#     runtime stanno sulla stessa macchina, e con un core solo il TLS in locale
#     è un costo senza niente in cambio.
#
# Ognuna si fissa a mano in /etc/sws/viewer.env (SWS_DRM_CARD, SWS_TOUCH,
# SWS_BASE_URL): quello che c'è lì vince sempre.
#
# In più luce e cicalino (13-11-2026), che il viewer regola secondo il progetto
# (`pannello`: luce, riposo, beep al tocco). Misurati sul TY570 il 12-11; si
# cambiano con SWS_RETROILLUMINAZIONE e SWS_CICALINO, e un valore vuoto li
# spegne (`SWS_CICALINO=` = niente beep da SWS).

set -eu

SWS_INSTALL=/opt/sws
SWS_DATA=/var/lib/sws

if [ -f /etc/sws/viewer.env ]; then
    # shellcheck disable=SC1091
    . /etc/sws/viewer.env
fi

# ── La scheda DRM ─────────────────────────────────────────────────────────────
if [ -z "${SWS_DRM_CARD:-}" ]; then
    for stato in /sys/class/drm/card*-*/status; do
        [ -r "$stato" ] || continue
        if [ "$(cat "$stato")" = "connected" ]; then
            # /sys/class/drm/card0-DSI-1/status → card0
            scheda="${stato#/sys/class/drm/}"
            SWS_DRM_CARD="/dev/dri/${scheda%%-*}"
            break
        fi
    done
fi
: "${SWS_DRM_CARD:=/dev/dri/card0}"

# ── Il touch ──────────────────────────────────────────────────────────────────
# I nomi visti: ILITEK sul capacitivo del TY570 (30-10-2026), TSC2007 sui
# resistivi. `auto` lascia scegliere al viewer fra /dev/input/ts_uinput e
# /dev/input/ts, se qualcuno li ha creati.
if [ -z "${SWS_TOUCH:-}" ]; then
    # Capacitive controllers first: the TY570 loads the TSC2007 driver too,
    # with no resistive panel behind it, and its by-path link sorts before the
    # ILITEK one (13-11-2026: the launcher picked it and the touch was dead).
    resistive=""
    for link in /dev/input/by-path/*-event*; do
        [ -e "$link" ] || continue
        ev="$(basename "$(readlink -f "$link")")"
        nome="$(cat "/sys/class/input/$ev/device/name" 2>/dev/null || true)"
        case "$(echo "$nome" | tr '[:upper:]' '[:lower:]')" in
            *ilitek*|*goodix*|*ft5x*)
                SWS_TOUCH="$link"
                break ;;
            *tsc2007*|*touch*|*_ts*)
                [ -n "$resistive" ] || resistive="$link" ;;
        esac
    done
    [ -n "${SWS_TOUCH:-}" ] || SWS_TOUCH="$resistive"
fi
: "${SWS_TOUCH:=auto}"

# ── Lo schema verso il runtime ────────────────────────────────────────────────
if [ -z "${SWS_BASE_URL:-}" ]; then
    if [ -f "$SWS_DATA/config/tls.crt" ]; then
        SWS_BASE_URL=https://127.0.0.1:7443
    else
        SWS_BASE_URL=http://127.0.0.1:7443
    fi
fi

# ── Luce e cicalino ──────────────────────────────────────────────────────────
# `=` e non `:=`: un valore vuoto scritto in viewer.env vuol dire «no».
: "${SWS_RETROILLUMINAZIONE=/sys/class/backlight/backlight}"
: "${SWS_CICALINO=/sys/class/pwm/pwmchip3}"
set --
[ -n "$SWS_RETROILLUMINAZIONE" ] && [ -d "$SWS_RETROILLUMINAZIONE" ] && \
    set -- "$@" --retroilluminazione "$SWS_RETROILLUMINAZIONE"
[ -n "$SWS_CICALINO" ] && [ -d "$SWS_CICALINO" ] && \
    set -- "$@" --cicalino "$SWS_CICALINO"

echo "[sws] viewer: schermo $SWS_DRM_CARD, touch $SWS_TOUCH, runtime $SWS_BASE_URL, $*" >&2

exec "$SWS_INSTALL/bin/sws-lvgl-viewer" \
    --backend      drm \
    --drm-card     "$SWS_DRM_CARD" \
    --touch-device "$SWS_TOUCH" \
    --base-url     "$SWS_BASE_URL" \
    "$@"
