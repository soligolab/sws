#!/usr/bin/env sh
#
# Backlight and buzzer writable by the SWS viewer, which runs as `sws` in the
# `video` group. Run as root before the viewer (`ExecStartPre=+` in
# sws-lvgl-viewer.service), at every start.
#
# Why not only the udev rule (99-sws-tiny-ty.rules): on the TY570 `rc.local`
# exports pwm0 at boot, as root, and the channel files (`period`,
# `duty_cycle`, `enable`) stay root 644 — the rule never saw that channel
# appear (13-11-2026: «Permission denied» on duty_cycle, no beep). Exporting
# and fixing the group here works whichever comes first, rc.local or SWS.

set -u

BACKLIGHT=/sys/class/backlight/backlight/brightness
CHIP=/sys/class/pwm/pwmchip3

if [ -e "$BACKLIGHT" ]; then
    chgrp video "$BACKLIGHT" && chmod g+w "$BACKLIGHT"
fi

if [ -d "$CHIP" ]; then
    [ -d "$CHIP/pwm0" ] || echo 0 > "$CHIP/export" 2>/dev/null || true
    for f in export unexport pwm0/period pwm0/duty_cycle pwm0/enable pwm0/polarity; do
        [ -e "$CHIP/$f" ] && chgrp video "$CHIP/$f" && chmod g+w "$CHIP/$f"
    done
fi

exit 0
