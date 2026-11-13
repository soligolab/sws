#!/usr/bin/env bash
#
# Installa SWS (runtime + viewer LVGL) su un Tiny TY: RV1106, armv7, Ubuntu
# 22.04 armhf, niente podman. Piano docs/plans/2026-10-30-sws-lvgl-sul-tiny-ty.md,
# passo 3. Il pacchetto lo prepara scripts/pacchetto_tiny_ty.sh.
#
# Uso, come root, dalla cartella del pacchetto scompattato:
#   sudo ./install.sh              # installa o aggiorna
#   sudo ./install.sh --uninstall  # toglie programmi e servizi, i dati restano
#
# Dove va cosa:
#   /opt/sws/          programmi, pagine web, template, RestrictedPython
#   /var/lib/sws/      progetti, configurazione, dati del viewer (utente sws)
#   /etc/sws/          runtime.env e viewer.env, mai sovrascritti
#   /etc/systemd/system/sws-runtime.service, sws-lvgl-viewer.service
#   /etc/udev/rules.d/99-sws-tiny-ty.rules

set -euo pipefail

INSTALL_DIR=/opt/sws
DATA_DIR=/var/lib/sws
CONF_DIR=/etc/sws
UTENTE=sws
SERVIZI=(sws-runtime sws-lvgl-viewer)
REGOLA=/etc/udev/rules.d/99-sws-tiny-ty.rules

QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ERRORE: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "va lanciato come root: sudo $0 $*"

# ── Disinstallazione ──────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    for s in "${SERVIZI[@]}"; do
        systemctl disable --now "$s" 2>/dev/null || true
        rm -f "/etc/systemd/system/$s.service"
    done
    systemctl daemon-reload
    rm -f "$REGOLA"
    rm -rf "$INSTALL_DIR"
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
         sws-runtime.service sws-lvgl-viewer.service 99-sws-tiny-ty.rules; do
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
mkdir -p "$(dirname "$REGOLA")"
install -m 644 "$QUI/99-sws-tiny-ty.rules" "$REGOLA"
udevadm control --reload
udevadm trigger --action=add --subsystem-match=backlight --subsystem-match=pwm || true

echo "==> Servizi"
for s in "${SERVIZI[@]}"; do
    install -m 644 "$QUI/$s.service" "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
for s in "${SERVIZI[@]}"; do
    systemctl enable "$s"
    systemctl restart "$s"
done

# ── Chi tiene lo schermo ──────────────────────────────────────────────────────
#
# `tyx_panelcontrol` di Pixsys gestisce schermo, luce, cicalino, UPS e i servizi
# del PLC. Con lui acceso SWS e lui si contendono il DRM. Decisione del
# 12-11-2026: SWS gestisce luce e cicalino, ma come spegnerlo senza perdere il
# resto è una domanda aperta per Pixsys. Quindi qui non si tocca: si dice.
# Matched on the executable path: the process renames itself (comm is
# `tyx-pc-gui`), so `pgrep -x tyx_panelcontrol` never finds it.
if pgrep -f '^/data/tyx_panelcontrol/tyx_panelcontrol' >/dev/null 2>&1; then
    echo ""
    echo "    ATTENZIONE: tyx_panelcontrol è acceso e tiene lo schermo."
    echo "    Il viewer di SWS non lo vedrà finché lui gira (rc.local lo avvia al boot)."
fi

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
    echo "    http://$(hostname).local:7444   (the pairing code is on the panel screen)"
fi
for a in ${indirizzi:-localhost}; do
    echo "    http://$a:7444   (il codice di abbinamento è sullo schermo del pannello)"
done
echo "    Log: journalctl -u sws-runtime -u sws-lvgl-viewer -f"
