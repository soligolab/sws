#!/usr/bin/env bash
#
# Prepara un Tiny TY per la rete: il nome pubblicato via mDNS (avahi) e
# l'accesso SSH con chiave. Piano docs/plans/2026-10-30-sws-lvgl-sul-tiny-ty.md,
# «Nome in rete e chiavi SSH» (13-11-2026).
#
# È pensato per due mani: lo sviluppatore del Tiny TY, che può metterlo
# nell'immagine del sistema, oppure noi in installazione. Non dipende da SWS:
# si può lanciare anche su un dispositivo dove SWS non c'è.
#
# Every manual change to the TY system goes in here, the same day; the reason
# for each one is an open point in ty570-1ad-p1.md, next to this script.
#
# Uso, come root:
#   sudo ./prepara-dispositivo.sh                      # DIAGNOSI: legge e stampa, non cambia niente
#   sudo ./prepara-dispositivo.sh --applica            # nome + avahi + permessi SSH + IPv4 at boot
#   sudo ./prepara-dispositivo.sh --applica --modello ty570-1ad-p1
#   sudo ./prepara-dispositivo.sh --applica --chiave id_ed25519.pub [--utente pixsys]
#
# Il nome segue quello dei pannelli PixsysOS (tc620-a-p3-c6-07aff9,
# wp630-a-p3-07a077): codice del modello in minuscolo, poi le ultime tre coppie
# del MAC di eth0. Per un TY570-1AD-P1 con MAC ..:12:34:56 → ty570-1ad-p1-123456,
# raggiungibile come ty570-1ad-p1-123456.local.
#
# DA VERIFICARE in ufficio (13-11-2026, scritto senza il dispositivo):
#   - il modello: --modello, poi Device_Name in /etc/device.info (Pixsys, as
#     read by its rc.local), then /proc/device-tree/model;
#   - se avahi-daemon c'è già, e quanta RAM costa;
#   - perché ssh-copy-id non riesce: la diagnosi stampa i sospetti abituali.

set -euo pipefail

APPLICA=0
MODELLO=""
CHIAVE=""
UTENTE="pixsys"
IFACE="eth0"

while [ $# -gt 0 ]; do
    case "$1" in
        --applica) APPLICA=1; shift ;;
        --modello) MODELLO="$2"; shift 2 ;;
        --chiave)  CHIAVE="$2"; shift 2 ;;
        --utente)  UTENTE="$2"; shift 2 ;;
        --iface)   IFACE="$2"; shift 2 ;;
        -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
        *) echo "argomento sconosciuto: $1" >&2; exit 2 ;;
    esac
done

[ "$(id -u)" -eq 0 ] || { echo "va lanciato come root: sudo $0" >&2; exit 1; }

titolo() { printf '\n== %s ==\n' "$1"; }
fai() {
    # In diagnosi stampa il comando; con --applica lo esegue.
    if [ "$APPLICA" -eq 1 ]; then echo "  + $*"; "$@"; else echo "  (con --applica) $*"; fi
}

# ── 1. Il nome ────────────────────────────────────────────────────────────────

titolo "Nome in rete"

# Pixsys writes the order code (TY570-1AD-P1) and the serial number here; its
# own rc.local picks the touch firmware from Device_Name.
if [ -r /etc/device.info ]; then
    info_name="$(sed -n 's/^Device_Name *= *//p' /etc/device.info | tr -d '\r ' | head -n1)"
    info_serial="$(sed -n 's/^Serial number *= *//p' /etc/device.info | tr -d '\r ' | head -n1)"
    echo "  /etc/device.info: model «${info_name}», serial «${info_serial}»"
    [ -z "$MODELLO" ] && [ -n "$info_name" ] && MODELLO="$info_name"
fi
if [ -z "$MODELLO" ] && [ -r /proc/device-tree/model ]; then
    # Il device tree chiude la stringa con un NUL.
    dt="$(tr -d '\0' < /proc/device-tree/model)"
    echo "  /proc/device-tree/model: «$dt»"
    # Usabile solo se somiglia a un codice Pixsys (TY570-1AD-P1 e simili).
    if echo "$dt" | grep -qiE '^ty[0-9]{3}(-[a-z0-9]+)*$'; then MODELLO="$dt"; fi
fi
MODELLO="$(echo "$MODELLO" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\n' '-')"

mac="$(cat "/sys/class/net/$IFACE/address" 2>/dev/null || true)"
echo "  MAC di $IFACE: ${mac:-non trovato}"
suffisso="$(echo "$mac" | tr -d ':' | tr '[:upper:]' '[:lower:]' | tail -c 7)"

echo "  nome attuale: $(hostname)"
if [ -n "$MODELLO" ] && [ ${#suffisso} -eq 6 ]; then
    NOME="$MODELLO-$suffisso"
    echo "  nome voluto:  $NOME  (→ $NOME.local)"
else
    NOME=""
    missing=""
    [ -n "$MODELLO" ] || missing="the model (--modello ty570-1ad-p1)"
    [ ${#suffisso} -eq 6 ] || missing="${missing:+$missing and }the MAC of $IFACE"
    echo "  nome voluto:  NON CALCOLABILE — missing $missing"
fi

if command -v avahi-daemon >/dev/null 2>&1 || [ -x /usr/sbin/avahi-daemon ]; then
    echo "  avahi-daemon: installato, $(systemctl is-active avahi-daemon || true)"
    pid="$(pgrep -x avahi-daemon | head -n1 || true)"
    [ -n "$pid" ] && echo "  avahi-daemon RSS: $(ps -o rss= -p "$pid") kB"
    AVAHI=1
else
    echo "  avahi-daemon: NON installato"
    AVAHI=0
fi

if [ -n "$NOME" ] && [ "$(hostname)" != "$NOME" ]; then
    fai hostnamectl set-hostname "$NOME"
    # Ubuntu risolve il proprio nome da /etc/hosts (127.0.1.1): senza, sudo
    # rallenta di qualche secondo a ogni comando.
    if grep -q '^127\.0\.1\.1' /etc/hosts; then
        # Riscritto sul posto, non con `sed -i` (che rinomina): /etc/hosts può
        # essere un file montato, e un rename lì fallisce.
        fai sh -c "h=\$(sed 's/^127\.0\.1\.1.*/127.0.1.1\t$NOME/' /etc/hosts) && printf '%s\n' \"\$h\" > /etc/hosts"
    else
        fai sh -c "printf '127.0.1.1\t%s\n' '$NOME' >> /etc/hosts"
    fi
fi
if [ "$AVAHI" -eq 0 ]; then
    # The Pixsys image ships with empty package lists (/var/lib/apt/lists).
    fai apt-get update
    fai env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends avahi-daemon
fi
fai systemctl enable --now avahi-daemon
# Avahi rilegge il nome della macchina solo all'avvio.
[ -n "$NOME" ] && fai systemctl restart avahi-daemon

# ── 2. SSH con chiave ─────────────────────────────────────────────────────────

titolo "SSH con chiave per l'utente $UTENTE"

home="$(getent passwd "$UTENTE" | cut -d: -f6 || true)"
if [ -z "$home" ]; then
    echo "  utente $UTENTE inesistente"
else
    echo "  home: $home"
    stat -c '  %n  %U:%G %a' "$home" "$home/.ssh" "$home/.ssh/authorized_keys" 2>/dev/null || true
    # I sospetti abituali, in ordine di frequenza.
    [ "$(stat -c %U "$home")" = "$UTENTE" ] || echo "  ✗ la home non è di $UTENTE: con StrictModes sshd ignora le chiavi"
    [ $(( 0$(stat -c %a "$home") & 022 )) -eq 0 ] || echo "  ✗ la home è scrivibile dal gruppo o da altri: con StrictModes sshd ignora le chiavi"
    echo "  file system della home: $(findmnt -no FSTYPE,OPTIONS -T "$home" 2>/dev/null || echo '?')"
    findmnt -no OPTIONS -T "$home" 2>/dev/null | grep -qw ro && echo "  ✗ la home è in sola lettura: ssh-copy-id non può scrivere"
    findmnt -no FSTYPE -T "$home" 2>/dev/null | grep -qE 'overlay|tmpfs' && \
        echo "  ⚠ la home è su overlay/tmpfs: una chiave copiata può sparire al riavvio"
    command -v ssh-keygen >/dev/null || echo "  ⚠ ssh-keygen assente"
fi

if command -v sshd >/dev/null; then
    echo "  sshd -T:"
    sshd -T 2>/dev/null | grep -E '^(pubkeyauthentication|authorizedkeysfile|strictmodes|passwordauthentication|permitrootlogin|usepam) ' \
        | sed 's/^/    /' || echo "    (sshd -T non riesce)"
    echo "  ultimi rifiuti nel journal:"
    journalctl -u ssh -u sshd --no-pager -n 200 2>/dev/null \
        | grep -iE 'refused|bad ownership|bad modes|authorized_keys|publickey' | tail -n 5 | sed 's/^/    /' || true
else
    echo "  ✗ sshd non trovato"
fi

if [ -n "$home" ]; then
    fai install -d -m 700 -o "$UTENTE" -g "$(id -gn "$UTENTE")" "$home/.ssh"
    fai chmod go-w "$home"
    fai chown "$UTENTE" "$home"
    if [ -n "$CHIAVE" ]; then
        [ -r "$CHIAVE" ] || { echo "  chiave $CHIAVE non leggibile" >&2; exit 1; }
        if ! grep -qF "$(cut -d' ' -f2 "$CHIAVE")" "$home/.ssh/authorized_keys" 2>/dev/null; then
            fai sh -c "cat '$CHIAVE' >> '$home/.ssh/authorized_keys'"
        else
            echo "  la chiave c'è già"
        fi
    fi
    [ -e "$home/.ssh/authorized_keys" ] || [ "$APPLICA" -eq 0 ] || touch "$home/.ssh/authorized_keys"
    fai chown "$UTENTE:$(id -gn "$UTENTE")" "$home/.ssh/authorized_keys"
    fai chmod 600 "$home/.ssh/authorized_keys"
fi
# Le chiavi accese esplicitamente, in un file a parte: sshd_config di Ubuntu
# 22.04 include sshd_config.d/, e così non si tocca il file del sistema.
if [ -d /etc/ssh/sshd_config.d ]; then
    if ! [ -f /etc/ssh/sshd_config.d/50-sws.conf ]; then
        fai sh -c "printf 'PubkeyAuthentication yes\n' > /etc/ssh/sshd_config.d/50-sws.conf"
    fi
    fai sshd -t
    fai systemctl reload ssh
fi

# ── 3. IPv4 on eth0 at every boot ─────────────────────────────────────────────
# Pixsys' udev rule 70-persistent-mac.rules runs /data/if_configure.sh, which
# sets the MAC and brings eth0 *up* before NetworkManager starts. When it wins
# the race, NetworkManager adopts the link as external configuration
# (connection-assumed, a volatile profile with ipv4.method=disabled) and never
# runs DHCP: the device comes back with IPv6 only. Seen on the TY570 on
# 13-11-2026; keep-configuration=no held over three reboots.
# Point 10 in ty570-1ad-p1.md.

titolo "IPv4 on $IFACE at boot"

NM_CONF=/etc/NetworkManager/conf.d/50-sws-$IFACE.conf
if ! command -v NetworkManager >/dev/null 2>&1; then
    echo "  NetworkManager not installed: nothing to do"
else
    echo "  NetworkManager $(NetworkManager --version)"
    echo "  active on $IFACE: $(nmcli -g NAME,UUID,TYPE connection show --active 2>/dev/null | grep -F "$IFACE" || echo none)"
    journalctl -b -u NetworkManager --no-pager 2>/dev/null | grep -q "($IFACE).*connection-assumed" \
        && echo "  ✗ at this boot NetworkManager adopted $IFACE as found, without DHCP"
    if [ -f "$NM_CONF" ]; then
        echo "  $NM_CONF already there"
    else
        fai sh -c "printf '%s\n' '# SWS: do not adopt the configuration found on $IFACE at boot (prepara-dispositivo.sh).' \
            '[device-sws-$IFACE]' 'match-device=interface-name:$IFACE' 'keep-configuration=no' > '$NM_CONF'"
        # Read at the next start of NetworkManager: the running link is left alone.
        echo "  takes effect at the next reboot"
    fi
fi

titolo "Fatto"
if [ "$APPLICA" -eq 0 ]; then
    echo "  Era una diagnosi: niente è cambiato. Per applicare: sudo $0 --applica [--modello ...] [--chiave ...]"
else
    echo "  Prova da un'altra macchina: ping ${NOME:-$(hostname)}.local  e  ssh $UTENTE@${NOME:-$(hostname)}.local"
fi
