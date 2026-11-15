#!/usr/bin/env bash
# Takes Pixsys' `tyx_panelcontrol` off a Tiny TY, so that SWS works on a clean
# system (plan docs/archive/2026-11-14-funzioni-di-tyx-panelcontrol.md).
#
#   sudo ./remove-panelcontrol.sh             take it off (install.sh does it)
#   sudo ./remove-panelcontrol.sh --restore   put everything back as it was
#
# `tyx_panelcontrol` is more than the setup window: without a screen it keeps
# the UPS, the USB power, the clock and the Pixsys services. Each of them gets
# another owner here before the program goes:
#
#   UPS             the SWS runtime (`--power-fail-input`, set by its launcher)
#   USB power       sws-usb-power.service, below
#   clock           chrony started by the system, not by Pixsys' launcher
#   Device Finder   its own systemd unit, enabled if it was on
#   beep, light     the SWS viewer, which drives them already
#
# Everything touched is saved first in $BACKUP; --restore reads it back.
# Idempotent: on a device already clean it only checks its own pieces.
set -euo pipefail

PANELCONTROL=/data/tyx_panelcontrol
BACKUP=/var/lib/sws-pixsys-backup
ARCHIVE=$BACKUP/tyx_panelcontrol.tar.gz
RC_LOCAL=/etc/rc.local
# The marker in front of the rc.local lines taken out.
OFF='#sws-removed# '
USB_UNIT=/etc/systemd/system/sws-usb-power.service
CHRONY_CONF=/etc/chrony/chrony.conf
CHRONY_SOURCES=/etc/chrony/sources.d/sws.sources
# What Pixsys hooks into the system for its clock handling.
PIXSYS_CLOCK=(
    /etc/systemd/system/chrony.service.d/90-tyx-clock.conf
    /etc/systemd/system/chrony.service.d/95-tyx-mode.conf
    /etc/systemd/system/tyx-rtc-sync.service
    /etc/systemd/system/tyx-rtc-sync.timer
    /etc/systemd/system/tyx-chrony-estimate.service
    /etc/systemd/system/tyx-chrony-estimate.timer
    /etc/NetworkManager/dispatcher.d/20-tyx-chrony
)
PIXSYS_TIMERS=(tyx-rtc-sync.timer tyx-chrony-estimate.timer)

die() { echo "ERRORE: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "va lanciato come root: sudo $0 $*"

# ── Ripristino ────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--restore" ]; then
    [ -f "$ARCHIVE" ] || die "nessuna copia in $ARCHIVE: non c'è niente da rimettere"
    echo "==> Rimetto tyx_panelcontrol e i suoi agganci da $ARCHIVE"
    systemctl disable --now sws-usb-power.service 2>/dev/null || true
    rm -f "$USB_UNIT" "$CHRONY_SOURCES"
    tar xzpf "$ARCHIVE" -C /
    [ -d /var/lib/chrony ] && chown -R root:root /var/lib/chrony
    systemctl daemon-reload
    for t in "${PIXSYS_TIMERS[@]}"; do
        systemctl enable --now "$t" 2>/dev/null || true
    done
    systemctl enable chrony 2>/dev/null || true
    systemctl restart chrony 2>/dev/null || true
    echo "    fatto: tyx_panelcontrol riparte al prossimo riavvio (lo avvia rc.local)"
    exit 0
fi

# ── La copia ──────────────────────────────────────────────────────────────────
#
# Once, the first time: a second run must not overwrite Pixsys' files with
# ours.

uses_panelcontrol() {
    grep -v "^$OFF" "$RC_LOCAL" 2>/dev/null | grep -q "$PANELCONTROL/"
}

if [ ! -d "$PANELCONTROL" ] && ! uses_panelcontrol && [ ! -e "${PIXSYS_CLOCK[0]}" ]; then
    echo "    tyx_panelcontrol non c'è: il sistema è già pulito"
else
    if [ ! -f "$ARCHIVE" ]; then
        echo "==> Copia di tyx_panelcontrol e dei suoi agganci in $ARCHIVE"
        install -d -m 700 "$BACKUP"
        saved=()
        for f in "$PANELCONTROL" "$RC_LOCAL" "$CHRONY_CONF" "${PIXSYS_CLOCK[@]}"; do
            [ -e "$f" ] && saved+=("${f#/}")
        done
        tar czpf "$ARCHIVE.tmp" -C / "${saved[@]}"
        tar tzf "$ARCHIVE.tmp" >/dev/null || die "la copia non si rilegge: non tocco niente"
        mv "$ARCHIVE.tmp" "$ARCHIVE"
    fi

    # What its settings had on, read before the folder goes.
    startup="$PANELCONTROL/data/startup.ini"
    clock_mode="$(cat "$PANELCONTROL/data/chrony/clock-mode" 2>/dev/null || true)"
    device_finder="$(sed -n 's/^devicefinder *= *//p' "$startup" 2>/dev/null | head -n1 || true)"

    # ── I servizi che accendeva lui ───────────────────────────────────────────
    if [ "$device_finder" = 1 ] && systemctl cat devicefinder.service >/dev/null 2>&1; then
        echo "==> Device Finder: era acceso, ora lo avvia systemd"
        systemctl enable devicefinder.service 2>/dev/null || true
    fi

    # ── L'orologio ────────────────────────────────────────────────────────────
    #
    # Pixsys replaces chrony's start with its launcher, in `monitor` (measure,
    # never set) or `sync` mode. Here chrony is the system's again: running
    # means synchronising, and the control panel's NTP switch is timedated's.
    echo "==> Orologio: chrony torna quello di sistema"
    for t in "${PIXSYS_TIMERS[@]}"; do
        systemctl disable --now "$t" 2>/dev/null || true
    done
    rm -f "${PIXSYS_CLOCK[@]}"
    rmdir /etc/systemd/system/chrony.service.d 2>/dev/null || true
    cat > "$CHRONY_CONF" <<'CHRONY'
# Written by SWS (deploy/tiny-ty/remove-panelcontrol.sh). Pixsys' file is in
# /var/lib/sws-pixsys-backup.
sourcedir /etc/chrony/sources.d
driftfile /var/lib/chrony/chrony.drift
makestep 1.0 3
rtcsync
maxupdateskew 100.0
leapsectz right/UTC
CHRONY
    if [ ! -f "$CHRONY_SOURCES" ]; then
        install -d -m 755 "$(dirname "$CHRONY_SOURCES")"
        # The servers Pixsys had as fallback.
        cat > "$CHRONY_SOURCES" <<'SOURCES'
pool 0.ubuntu.pool.ntp.org iburst
pool 1.ubuntu.pool.ntp.org iburst
pool 2.ubuntu.pool.ntp.org iburst
pool ntp.ubuntu.com iburst
SOURCES
    fi
    systemctl daemon-reload
    # The mode it was in stays: `sync` is NTP on, `monitor` is NTP off. It is
    # changed from the control panel (Ora → NTP).
    # The chronyd that is running is still the one Pixsys' launcher started.
    systemctl try-restart chrony 2>/dev/null || true
    if [ "$clock_mode" = sync ]; then
        timedatectl set-ntp true || true
        echo "    NTP acceso, com'era (sync)"
    else
        timedatectl set-ntp false || true
        echo "    NTP spento, com'era (${clock_mode:-monitor}): si accende da Ora → NTP nel pannello di controllo"
    fi

    # ── rc.local ──────────────────────────────────────────────────────────────
    #
    # Pixsys' boot script prepares the hardware too (UPS pin, touch, serials):
    # it stays, minus the lines that call into the folder.
    if uses_panelcontrol; then
        echo "==> rc.local: tolgo le righe che avviano tyx_panelcontrol"
        new="$(mktemp)"
        sed "\|^$OFF|! { \|$PANELCONTROL/|s|^|$OFF| }" "$RC_LOCAL" > "$new"
        if bash -n "$new"; then
            cat "$new" > "$RC_LOCAL"
        else
            rm -f "$new"
            die "rc.local modificato non è uno script valido: lasciato com'era, tyx_panelcontrol resta"
        fi
        rm -f "$new"
    fi

    # ── Il programma ──────────────────────────────────────────────────────────
    # Matched on the executable path: the process renames itself.
    if pgrep -f "^$PANELCONTROL/tyx_panelcontrol" >/dev/null 2>&1; then
        echo "==> Fermo tyx_panelcontrol"
        pkill -f "^$PANELCONTROL/tyx_panelcontrol" || true
    fi
    if [ -d "$PANELCONTROL" ]; then
        echo "==> Tolgo $PANELCONTROL (la copia è in $ARCHIVE)"
        rm -rf "$PANELCONTROL"
    fi
fi

# ── La cartella di chrony ─────────────────────────────────────────────────────
#
# Pixsys' launcher left it to root; the system's chronyd runs as `_chrony` and
# could not save its drift file there ("chrony.drift.tmp: Permission denied",
# TY570, 15-11-2026). Outside the block above: devices already clean get it too.
if id _chrony >/dev/null 2>&1 && [ -d /var/lib/chrony ] \
    && [ "$(stat -c %U /var/lib/chrony)" != _chrony ]; then
    echo "==> Orologio: /var/lib/chrony passa a chrony, che ci salva la deriva"
    chown -R _chrony:_chrony /var/lib/chrony
fi

# ── I server NTP ──────────────────────────────────────────────────────────────
#
# The control panel writes chrony's sources (Time → NTP servers): the file is
# the runtime's user's, the folder stays root's.
if id sws >/dev/null 2>&1 && [ -d "$(dirname "$CHRONY_SOURCES")" ]; then
    # Never an empty file: chrony would be left without a source.
    [ -s "$CHRONY_SOURCES" ] || printf 'pool %s iburst\n' 0.ubuntu.pool.ntp.org \
        1.ubuntu.pool.ntp.org 2.ubuntu.pool.ntp.org ntp.ubuntu.com > "$CHRONY_SOURCES"
    chown sws:sws "$CHRONY_SOURCES"
    chmod 644 "$CHRONY_SOURCES"
fi

# ── L'alimentazione USB ───────────────────────────────────────────────────────
#
# rc.local switched it on through a script of the folder (GPIO116). Without
# power the Wi-Fi dongles never show up. `high` only when the pin is not an
# output yet: writing the direction again would drop the power for a moment.
if [ -d /sys/class/gpio ] && [ ! -f "$USB_UNIT" ]; then
    echo "==> USB: l'alimentazione la accende sws-usb-power.service"
    cat > "$USB_UNIT" <<'UNIT'
[Unit]
Description=SWS: USB port power on (Tiny TY, GPIO116)
After=rc-local.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'g=/sys/class/gpio; [ -d $g/gpio116 ] || echo 116 > $g/export; [ "$(cat $g/gpio116/direction)" = out ] || echo high > $g/gpio116/direction; echo 1 > $g/gpio116/value'

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now sws-usb-power.service
fi
