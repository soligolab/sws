#!/usr/bin/env bash
#
# Installa SWS (runtime + viewer LVGL) su un Tiny TY: RV1106, armv7, Ubuntu
# 22.04 armhf, niente podman. Piano docs/archive/2026-10-30-sws-lvgl-sul-tiny-ty.md,
# passo 3. Il pacchetto lo prepara scripts/pacchetto_tiny_ty.sh.
#
# Uso, come root, dalla cartella del pacchetto scompattato:
#   sudo ./install.sh              # installa o aggiorna
#   sudo ./install.sh --chiave id_ed25519.pub   # e aggiunge una chiave SSH a pixsys
#   sudo ./install.sh --uninstall  # toglie programmi e servizi, i dati restano
#
# Un solo comando per un TY nuovo (maintainer, 14-11-2026): prima prepara il
# dispositivo con prepara-dispositivo.sh --applica (nome mDNS, avahi, chiavi
# SSH, IPv4 al riavvio), poi installa SWS. Gli altri argomenti (--modello,
# --chiave, --utente) vanno a prepara-dispositivo.sh. Rilanciarlo per un
# aggiornamento non cambia niente di quello che è già a posto.
#
# Dove va cosa:
#   /opt/sws/          programmi, pagine web, template, RestrictedPython
#   /var/lib/sws/      progetti, configurazione, dati del viewer (utente sws)
#   /etc/sws/          runtime.env e viewer.env, mai sovrascritti
#   /etc/systemd/system/sws-runtime.service, sws-lvgl-viewer.service,
#                      sws-usb-power.service
#   /etc/udev/rules.d/99-sws-tiny-ty.rules
#   /etc/sudoers.d/50-sws-clock  (solo con il chrony di Pixsys, vedi sotto)

set -euo pipefail

INSTALL_DIR=/opt/sws
DATA_DIR=/var/lib/sws
CONF_DIR=/etc/sws
UTENTE=sws
SERVIZI=(sws-runtime sws-lvgl-viewer)
REGOLA=/etc/udev/rules.d/99-sws-tiny-ty.rules
# Control panel permissions: one file per polkit generation (see the files).
POLKIT_PKLA=/etc/polkit-1/localauthority/50-local.d/50-sws-control-panel.pkla
POLKIT_RULES=/etc/polkit-1/rules.d/50-sws-control-panel.rules
# The rule of 14-11-2026 for Pixsys' chrony launcher: gone with the launcher
# (remove-panelcontrol.sh), removed from a device that still has it.
SUDOERS_CLOCK=/etc/sudoers.d/50-sws-clock
# The diagnostic export of the control panel: see sws-diagnostics.
SUDOERS_DIAGNOSTICS=/etc/sudoers.d/50-sws-diagnostics
# Pixsys' setup program, which starts SWS as its "External program" (16-11-2026).
PANELCONTROL=/data/tyx_panelcontrol
STARTUP_INI=$PANELCONTROL/data/startup.ini
USB_UNIT=/etc/systemd/system/sws-usb-power.service

QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ERRORE: $*" >&2; exit 1; }

# The control panel's initial PIN, as the runtime computes it
# (`control_panel/pin.rs`): the low six hex digits of the MAC of eth0, then
# ethernet0, then the first physical card in name order. Empty if none.
initial_pin() {
    local c
    for c in eth0 ethernet0 $(LC_ALL=C ls /sys/class/net 2>/dev/null); do
        [ -r "/sys/class/net/$c/address" ] || continue
        case "$c" in eth0|ethernet0) ;; *) [ -e "/sys/class/net/$c/device" ] || continue ;; esac
        local hex
        hex="$(tr -d ':\n' < "/sys/class/net/$c/address" | tr '[:upper:]' '[:lower:]')"
        [ ${#hex} -eq 12 ] && [ "$hex" != 000000000000 ] && { echo "${hex:6}"; return; }
    done
}
[ "$(id -u)" -eq 0 ] || die "va lanciato come root: sudo $0 $*"

# ── firewalld (Pixsys OS 2.2.0, 26-11-2026) ───────────────────────────────────
# The system runs firewalld, and the Pixsys zone opens its own services but not
# the ports of SWS: from the network the panel did not answer ("No route to
# host"). Open 7443 and 7444 in the zones with a network card (or in the default
# zone), at once and permanently, without `--reload`. Without firewalld, do
# nothing; without the permission, show the command and continue.
SWS_FIREWALL_PORTS="7443/tcp 7444/tcp"
firewall_sws_zones() {
    local z
    z="$(firewall-cmd --get-active-zones 2>/dev/null | awk '/^[^ \t]/{z=$1} /interfaces:/{print z}')"
    [ -n "$z" ] || z="$(firewall-cmd --get-default-zone 2>/dev/null)"
    echo "$z"
}
firewall_running() {
    command -v firewall-cmd >/dev/null 2>&1 && [ "$(firewall-cmd --state 2>/dev/null)" = running ]
}
open_firewall_ports() {
    firewall_running || return 0
    local zone port
    for zone in $(firewall_sws_zones); do
        for port in $SWS_FIREWALL_PORTS; do
            firewall-cmd --zone="$zone" --query-port="$port" >/dev/null 2>&1 && continue
            if firewall-cmd --zone="$zone" --add-port="$port" >/dev/null 2>&1 \
               && firewall-cmd --permanent --zone="$zone" --add-port="$port" >/dev/null 2>&1; then
                echo "    firewall: $port open in zone $zone"
            else
                echo "    WARNING: firewalld does not let this user open $port in zone $zone." >&2
                echo "    As root: firewall-cmd --permanent --zone=$zone --add-port=$port && firewall-cmd --reload" >&2
            fi
        done
    done
}
close_firewall_ports() {
    firewall_running || return 0
    local zone port
    for zone in $(firewall-cmd --get-zones 2>/dev/null); do
        for port in $SWS_FIREWALL_PORTS; do
            firewall-cmd --zone="$zone" --remove-port="$port" >/dev/null 2>&1 || true
            firewall-cmd --permanent --zone="$zone" --remove-port="$port" >/dev/null 2>&1 || true
        done
    done
    echo "    firewall: the ports of SWS are closed"
}

# ── Disinstallazione ──────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    close_firewall_ports
    for s in "${SERVIZI[@]}"; do
        systemctl disable --now "$s" 2>/dev/null || true
        rm -f "/etc/systemd/system/$s.service"
    done
    # The USB power is rc.local's again, through tyx_panelcontrol's folder.
    if [ -d "$PANELCONTROL" ]; then
        systemctl disable sws-usb-power.service 2>/dev/null || true
        rm -f "$USB_UNIT"
    fi
    systemctl daemon-reload
    rm -f "$REGOLA" "$POLKIT_PKLA" "$POLKIT_RULES" "$SUDOERS_CLOCK" "$SUDOERS_DIAGNOSTICS"
    rm -rf "$INSTALL_DIR"
    # The boot logo as it was: ours is a link into the data that stay.
    if [ -L /data/plc/bootlogo.raw ]; then
        rm -f /data/plc/bootlogo.raw
        [ -f /var/lib/sws-pixsys-backup/bootlogo.raw ] &&
            mv /var/lib/sws-pixsys-backup/bootlogo.raw /data/plc/bootlogo.raw
    fi
    # Pixsys' panelcontrol back where it was, if this installer took it off.
    if [ -f /var/lib/sws-pixsys-backup/tyx_panelcontrol.tar.gz ]; then
        "$QUI/remove-panelcontrol.sh" --restore | sed 's/^/    /' || true
    fi
    echo "==> SWS tolto. Dati e configurazione restano:"
    echo "    $DATA_DIR e $CONF_DIR (sudo rm -rf $DATA_DIR $CONF_DIR per cancellarli)"
    echo "    l'utente $UTENTE (sudo userdel $UTENTE)"
    exit 0
fi

# ── Controlli prima di toccare qualcosa ───────────────────────────────────────

case "$(uname -m)" in
    armv7l|armv7*) ;;
    *) die "questo pacchetto è per armv7 (Tiny TY), la macchina è $(uname -m)" ;;
esac

for f in bin/sws-runtime bin/sws-lvgl-viewer www/index.html \
         sws-runtime.service sws-lvgl-viewer.service 99-sws-tiny-ty.rules \
         50-sws-control-panel.pkla 50-sws-control-panel.rules prepara-dispositivo.sh \
         remove-panelcontrol.sh sws-usb-power.service bin/sws-start; do
    [ -e "$QUI/$f" ] || die "manca $f: lancialo dalla cartella del pacchetto scompattato"
done

# Le librerie che i due programmi chiedono e il sistema non ha: meglio saperlo
# adesso che da un servizio che riparte ogni 5 secondi.
mancano="$(ldd "$QUI/bin/sws-runtime" "$QUI/bin/sws-lvgl-viewer" 2>/dev/null \
    | awk '/not found/ {print $1}' | sort -u | tr '\n' ' ')"
if [ -n "$mancano" ]; then
    die "mancano librerie di sistema: $mancano
    su Ubuntu 22.04: sudo apt install libpython3.10 libfreetype6 libdrm2 libsdl2-2.0-0
    (SDL2 il viewer lo collega anche col backend DRM, che non lo usa)"
fi
[ -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf ] || \
    echo "    attenzione: manca fonts-dejavu-core, il viewer ripiega su Montserrat (niente accenti)"

# ── L'utente ──────────────────────────────────────────────────────────────────

if ! id "$UTENTE" >/dev/null 2>&1; then
    echo "==> Creo l'utente di sistema $UTENTE"
    useradd --system --home-dir "$DATA_DIR" --no-create-home \
        --shell /usr/sbin/nologin "$UTENTE"
fi
# I gruppi li danno anche le unit (SupplementaryGroups); qui servono a chi
# lancia i programmi a mano come `sws` per una prova.
for g in video input dialout; do
    getent group "$g" >/dev/null && usermod -aG "$g" "$UTENTE"
done

# ── I file ────────────────────────────────────────────────────────────────────

echo "==> Programmi in $INSTALL_DIR"
for s in "${SERVIZI[@]}"; do
    systemctl stop "$s" 2>/dev/null || true
done
mkdir -p "$INSTALL_DIR/bin"
install -m 755 "$QUI/bin/sws-runtime"                 "$INSTALL_DIR/bin/"
install -m 755 "$QUI/bin/sws-lvgl-viewer"             "$INSTALL_DIR/bin/"
install -m 755 "$QUI/bin/sws-runtime-launch.sh"       "$INSTALL_DIR/bin/"
install -m 755 "$QUI/bin/sws-lvgl-viewer-launch.sh"   "$INSTALL_DIR/bin/"
install -m 755 "$QUI/bin/sws-hw-access.sh"            "$INSTALL_DIR/bin/"
install -m 755 "$QUI/bin/sws-start"                   "$INSTALL_DIR/bin/"
# Run as root through sudo: root's, and in a folder only root writes.
[ -f "$QUI/bin/sws-diagnostics" ] && install -m 755 -o root -g root "$QUI/bin/sws-diagnostics" "$INSTALL_DIR/bin/"
for d in www templates catalogo; do
    rm -rf "${INSTALL_DIR:?}/$d"
    [ -d "$QUI/$d" ] && cp -r "$QUI/$d" "$INSTALL_DIR/$d"
done
[ -f "$QUI/VERSIONE" ] && install -m 644 "$QUI/VERSIONE" "$INSTALL_DIR/"
# I font di SWS (emoji, segmenti, matrice di punti): il viewer li cerca in
# /etc/sws/fonts, come nell'immagine. Sono del prodotto, si riscrivono.
mkdir -p "$CONF_DIR/fonts"
cp "$QUI"/fonts/* "$CONF_DIR/fonts/"

# RestrictedPython: una ruota pura Python, cioè uno zip. Sul dispositivo non
# c'è pip, e non serve: la si apre con lo zipfile della libreria standard.
echo "==> RestrictedPython in $INSTALL_DIR/python"
rm -rf "$INSTALL_DIR/python"
mkdir -p "$INSTALL_DIR/python"
ruota="$(ls "$QUI"/python/*.whl 2>/dev/null | head -n1 || true)"
[ -n "$ruota" ] || die "manca la ruota di RestrictedPython in python/: senza, gli script non partono"
python3 -m zipfile -e "$ruota" "$INSTALL_DIR/python"
PYTHONPATH="$INSTALL_DIR/python" python3 -c "import RestrictedPython" \
    || die "RestrictedPython estratto ma non importabile con $(python3 --version)"

echo "==> Dati in $DATA_DIR"
mkdir -p "$DATA_DIR/config" "$DATA_DIR/projects" "$DATA_DIR/viewer"
chown -R "$UTENTE:$UTENTE" "$DATA_DIR"

mkdir -p "$CONF_DIR"
if [ ! -f "$CONF_DIR/runtime.env" ]; then
    cat > "$CONF_DIR/runtime.env" <<'FINE'
# Opzioni del runtime SWS, lette da /opt/sws/bin/sws-runtime-launch.sh.
# Dopo una modifica: sudo systemctl restart sws-runtime
#
# Niente utenti qui: il pannello mostra il codice di abbinamento, e gli utenti
# arrivano col primo deploy dall'IDE.
#
# L'IDE completo sul dispositivo, per la messa in servizio (costa RAM):
# SWS_ENABLE_IDE=1
FINE
fi
# The cloud: the waiting tunnel (the panel calls the gateway and waits there
# with its pairing code) and the IDE address the pairing QR points to. Added
# only when the key is missing, so an existing file is completed, never
# rewritten; an empty value turns either off.
for kv in \
    "SWS_TUNNEL_URL=wss://tunnel.soligo.net/tunnel/v1" \
    "SWS_CLOUD_URL=https://sws.soligo.net"; do
    if ! grep -q "^${kv%%=*}=" "$CONF_DIR/runtime.env"; then
        printf '\n%s\n' "$kv" >> "$CONF_DIR/runtime.env"
        echo "    runtime.env: $kv"
    fi
done
if [ ! -f "$CONF_DIR/viewer.env" ]; then
    cat > "$CONF_DIR/viewer.env" <<'FINE'
# Opzioni del viewer LVGL, lette da /opt/sws/bin/sws-lvgl-viewer-launch.sh.
# Vuote, il lanciatore le cerca da sé; il journal dice cosa ha trovato:
#   journalctl -u sws-lvgl-viewer | grep 'viewer: schermo'
# Dopo una modifica: sudo systemctl restart sws-lvgl-viewer
#
# SWS_DRM_CARD=/dev/dri/card0
# SWS_TOUCH=/dev/input/by-path/...-event
# SWS_BASE_URL=http://127.0.0.1:7443
#
# Luce e cicalino che SWS regola secondo il progetto (vuoto = SWS non li tocca):
# SWS_RETROILLUMINAZIONE=/sys/class/backlight/backlight
# SWS_CICALINO=/sys/class/pwm/pwmchip3
FINE
fi

echo "==> Regola udev per luce e cicalino"
mkdir -p "$(dirname "$REGOLA")"
install -m 644 "$QUI/99-sws-tiny-ty.rules" "$REGOLA"
udevadm control --reload
udevadm trigger --action=add --subsystem-match=backlight --subsystem-match=pwm || true

# Control panel: the runtime may change network, time and power from the
# screen. Both files go in; each polkit reads only its own kind.
install -d -m 755 "$(dirname "$POLKIT_PKLA")" "$(dirname "$POLKIT_RULES")"
install -m 644 "$QUI/50-sws-control-panel.pkla" "$POLKIT_PKLA"
install -m 644 "$QUI/50-sws-control-panel.rules" "$POLKIT_RULES"

rm -f "$SUDOERS_CLOCK"

# The diagnostic export: the runtime's user may run the helper as root, with
# these three arguments and no other. Checked before it goes in: a broken file
# in sudoers.d locks sudo for everyone.
if [ -x "$INSTALL_DIR/bin/sws-diagnostics" ]; then
    tmp="$(mktemp)"
    for cmd in journal dmesg check-usb to-usb; do
        echo "sws ALL=(root) NOPASSWD: $INSTALL_DIR/bin/sws-diagnostics $cmd"
    done > "$tmp"
    if visudo -cf "$tmp" >/dev/null; then
        install -m 440 -o root -g root "$tmp" "$SUDOERS_DIAGNOSTICS"
    else
        echo "    ATTENZIONE: regola sudoers della diagnostica non valida, non installata" >&2
    fi
    rm -f "$tmp"
fi

# ── Firmware Wi-Fi ────────────────────────────────────────────────────────────
#
# Pixsys' kernel has the `rtl8xxxu` and `rtl8192cu` drivers but not all their
# firmware: RTL8723BU, RTL8192EU and RTL8723AU dongles were read and never
# became a Wi-Fi card (TY570, 15-11-2026). The files come from linux-firmware,
# redistributable (LICENCE.rtlwifi_firmware.txt, next to them). Only the
# missing ones are added: a file of the system is never replaced.
if [ -d "$QUI/firmware/rtlwifi" ]; then
    install -d -m 755 /lib/firmware/rtlwifi
    added=0
    for f in "$QUI"/firmware/rtlwifi/*.bin; do
        if [ ! -e "/lib/firmware/rtlwifi/$(basename "$f")" ]; then
            install -m 644 "$f" /lib/firmware/rtlwifi/
            added=$((added + 1))
        fi
    done
    [ "$added" -gt 0 ] && echo "==> Firmware Wi-Fi: aggiunti $added file in /lib/firmware/rtlwifi"
    install -m 644 "$QUI/firmware/LICENCE.rtlwifi_firmware.txt" /lib/firmware/rtlwifi/ 2>/dev/null || true
fi

# ── L'immagine di avvio ───────────────────────────────────────────────────────
#
# Pixsys' rc.local copies /data/plc/bootlogo.raw to the screen early in the
# boot. That name becomes a link to the file the runtime writes from the
# project's boot page (SWS_BOOT_IMAGE_RAW in its launcher). A logo already
# there is kept aside, and --uninstall puts it back.
BOOT_LOGO=/data/plc/bootlogo.raw
BOOT_LOGO_SWS="$DATA_DIR/config/boot-image/bootlogo.raw"
BOOT_LOGO_KEPT=/var/lib/sws-pixsys-backup/bootlogo.raw
if [ -d "$(dirname "$BOOT_LOGO")" ] && [ "$(readlink "$BOOT_LOGO" 2>/dev/null)" != "$BOOT_LOGO_SWS" ]; then
    echo "==> Immagine di avvio: $BOOT_LOGO diventa quella del progetto"
    if [ -f "$BOOT_LOGO" ] && [ ! -L "$BOOT_LOGO" ] && [ ! -e "$BOOT_LOGO_KEPT" ]; then
        install -d -m 700 "$(dirname "$BOOT_LOGO_KEPT")"
        mv "$BOOT_LOGO" "$BOOT_LOGO_KEPT"
    fi
    ln -sfn "$BOOT_LOGO_SWS" "$BOOT_LOGO"
fi

# ── tyx_panelcontrol resta ────────────────────────────────────────────────────
#
# Pixsys' setup program stays and starts SWS as its "External program"
# (/opt/sws/bin/sws-start), which then stops it: usable at power-on, then SWS
# is in charge (maintainer, 16-11-2026; until then remove-panelcontrol.sh took
# it off at install). The USB power goes to a unit of ours, so that it stays
# on whoever owns the folder; the UPS to the runtime, beep and light to the
# viewer, as soon as tyx_panelcontrol is gone.
echo "==> USB: l'alimentazione la tiene accesa sws-usb-power.service"
install -m 644 "$QUI/sws-usb-power.service" "$USB_UNIT"
systemctl daemon-reload
systemctl enable sws-usb-power.service
systemctl start sws-usb-power.service || true

# ── Il dispositivo ────────────────────────────────────────────────────────────
#
# Nome in rete, avahi, chiavi SSH e IPv4 al riavvio: le correzioni del sistema
# Pixsys che SWS dà per scontate. Prima dei servizi, così il runtime si annuncia
# col nome nuovo. Una preparazione che non riesce (per esempio avahi senza
# internet) non ferma l'installazione: lo dice, e si può rilanciare a parte.
echo "==> Preparazione del dispositivo (prepara-dispositivo.sh --applica)"
if ! "$QUI/prepara-dispositivo.sh" --applica "$@" 2>&1 | sed 's/^/    /'; then
    echo "    attenzione: la preparazione non è finita; rilanciala con"
    echo "    sudo $QUI/prepara-dispositivo.sh --applica"
fi

echo "==> Servizi"
for s in "${SERVIZI[@]}"; do
    install -m 644 "$QUI/$s.service" "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
if [ -x "$PANELCONTROL/tyx_panelcontrol" ]; then
    # Not at boot by themselves: tyx_panelcontrol starts them through
    # sws-start. Now, the same way, so that SWS is up right after the install.
    for s in "${SERVIZI[@]}"; do
        systemctl disable "$s" 2>/dev/null || true
    done
    "$INSTALL_DIR/bin/sws-start"
else
    # No Pixsys program (taken off by an older install): systemd starts them.
    for s in "${SERVIZI[@]}"; do
        systemctl enable "$s"
        systemctl restart "$s"
    done
fi

echo "==> Firewall"
open_firewall_ports

# ── Com'è andata ──────────────────────────────────────────────────────────────

sleep 3
if curl -sf http://127.0.0.1:7443/health >/dev/null 2>&1 \
    || curl -skf https://127.0.0.1:7443/health >/dev/null 2>&1; then
    echo "==> Runtime: risponde"
else
    echo "    Il runtime non risponde ancora: journalctl -u sws-runtime -n 30"
fi
for s in "${SERVIZI[@]}"; do
    printf '    %-16s %s\n' "$s" "$(systemctl is-active "$s" || true)"
done
indirizzi="$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); printf "%s ", a[1]}' || true)"
echo ""
echo "==> Fatto. Dall'IDE: Configurazione → Istanza → Device → Connessione → «Connetti»"
# The mDNS name first, when avahi publishes it (prepara-dispositivo.sh).
if systemctl is-active --quiet avahi-daemon 2>/dev/null; then
    echo "    http://$(hostname).local:7444   (il codice di abbinamento è sullo schermo del pannello)"
fi
for a in ${indirizzi:-localhost}; do
    echo "    http://$a:7444   (il codice di abbinamento è sullo schermo del pannello)"
done
echo "    Log: journalctl -u sws-runtime -u sws-lvgl-viewer -f"
if [ -x "$PANELCONTROL/tyx_panelcontrol" ] && [ -f "$STARTUP_INI" ]; then
    # sws-start has stopped tyx_panelcontrol just above: it cannot write over
    # its file now, and reads it again at the next boot. Its on-screen keyboard
    # makes typing the path a chore (maintainer, 16-11-2026), so it is set here.
    echo ""
    if grep -qx "external_path=$INSTALL_DIR/bin/sws-start" "$STARTUP_INI" \
        && grep -qx 'external=1' "$STARTUP_INI"; then
        echo "==> Avvio: tyx_panelcontrol avvia SWS a ogni accensione (Programma esterno)"
    elif pgrep -f "^$PANELCONTROL/tyx_panelcontrol" >/dev/null 2>&1; then
        echo "==> Avvio: tyx_panelcontrol è ancora acceso, il Programma esterno non si tocca."
        echo "    In Avvio → Programma esterno: $INSTALL_DIR/bin/sws-start"
    else
        [ -e "$STARTUP_INI.sws-bak" ] || cp -p "$STARTUP_INI" "$STARTUP_INI.sws-bak"
        sed -i -e "s|^external_path=.*|external_path=$INSTALL_DIR/bin/sws-start|" \
            -e 's|^external=.*|external=1|' "$STARTUP_INI"
        grep -q '^external_path=' "$STARTUP_INI" \
            || sed -i "/^\[services\]/a external_path=$INSTALL_DIR/bin/sws-start" "$STARTUP_INI"
        grep -q '^external=' "$STARTUP_INI" || sed -i '/^\[services\]/a external=1' "$STARTUP_INI"
        sync
        echo "==> Avvio: Programma esterno di tyx_panelcontrol = $INSTALL_DIR/bin/sws-start"
        echo "    (il file com'era: $STARTUP_INI.sws-bak)"
    fi
fi
pin="$(initial_pin)"
echo ""
if [ -n "$pin" ]; then
    echo "==> Pannello di controllo del dispositivo: PIN iniziale $pin"
    echo "    (le ultime 6 cifre del MAC; vale finché il progetto non ne imposta uno suo)"
    echo "    Si apre tenendo premuto 5 s l'angolo in alto a destra, o all'avvio di SWS."
else
    echo "    Nessuna scheda di rete con un MAC: il PIN iniziale del pannello di controllo non c'è."
fi
