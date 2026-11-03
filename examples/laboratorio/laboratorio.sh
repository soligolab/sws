#!/usr/bin/env bash
# Il laboratorio del tutorial (docs/manual/T01_laboratorio.md): OpenPLC Runtime v4
# con l'impianto di prova, e un broker MQTT (NanoMQ), in due container podman.
#
#   ./laboratorio.sh avvia    i due container (la prima volta scarica ~1 GB)
#   ./laboratorio.sh carica   compila l'impianto e lo carica su OpenPLC, in RUN
#   ./laboratorio.sh stato    cosa risponde, porta per porta
#   ./laboratorio.sh ascolta <topic>           stampa i messaggi MQTT (# per tutti)
#   ./laboratorio.sh pubblica <topic> <testo>  pubblica un messaggio MQTT
#   ./laboratorio.sh ferma    toglie i due container (il programma va ricaricato)
#
# Le porte sono quelle del pannello con OpenPLC (install-container.sh
# --con-openplc), così quello che si impara qui vale là: Modbus 1502, S7 10102,
# OPC UA 14840, e l'API di OpenPLC sulla 8443: la CLI dell'Editor la vuole lì,
# senza scelta. MQTT sulla 11883, per non litigare con un broker di casa.
#
# Il broker è NanoMQ e non Mosquitto: le immagini Alpine di Mosquitto (1.6, 2.0,
# 2.1) non aprivano nessun file di configurazione in podman rootless su questa
# macchina, nemmeno il loro (03-11-2026). NanoMQ parte anonimo sulla 1883 senza
# configurazione, e porta `nanomq_cli` per pubblicare e ascoltare.
set -euo pipefail

QUI="$(cd "$(dirname "$0")" && pwd)"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/sws-laboratorio"
IMG_PLC="ghcr.io/autonomy-logic/openplc-runtime:v4.3.1"
IMG_MQTT="docker.io/emqx/nanomq:0.25.7"
EDITOR_VER="4.3.2"
# L'Editor esiste per x86_64 e per ARM64 (un PC, o un Raspberry Pi 5).
case "$(uname -m)" in aarch64|arm64) EDITOR_ARCH="-ARM64" ;; *) EDITOR_ARCH="" ;; esac
EDITOR_URL="https://github.com/Autonomy-Logic/openplc-editor/releases/download/v${EDITOR_VER}/OpenPLC.Editor-${EDITOR_VER}${EDITOR_ARCH}.AppImage"
PLC="sws-lab-openplc"
MQTT="sws-lab-mqtt"
API_PORTA=8443
# Solo per il laboratorio: un OpenPLC appena nato dà l'admin al primo che lo
# chiede, e qui il primo siamo noi.
UTENTE="${OPENPLC_USER:-laboratorio}"
PASSWORD="${OPENPLC_PASSWORD:-laboratorio}"

c_api() { curl -sk --max-time 10 "https://127.0.0.1:${API_PORTA}/api/$1" "${@:2}"; }

avvia() {
    if ! podman container exists "$PLC"; then
        podman run -d --name "$PLC" \
            -p "${API_PORTA}:8443" -p 1502:502 -p 10102:102 -p 14840:4840 \
            "$IMG_PLC" >/dev/null
    else
        podman start "$PLC" >/dev/null
    fi
    if ! podman container exists "$MQTT"; then
        podman run -d --name "$MQTT" -p 11883:1883 "$IMG_MQTT" >/dev/null
    else
        podman start "$MQTT" >/dev/null
    fi
    # L'API di OpenPLC ci mette qualche secondo: prima genera il certificato.
    for _ in $(seq 1 60); do
        c_api version >/dev/null 2>&1 && break
        sleep 1
    done
    c_api version >/dev/null || { echo "OpenPLC non risponde sulla ${API_PORTA}: podman logs $PLC" >&2; exit 1; }
    # Il primo utente: senza, chiunque arrivi per primo diventa admin.
    c_api create-user -H 'Content-Type: application/json' \
        -d "{\"username\":\"$UTENTE\",\"password\":\"$PASSWORD\"}" >/dev/null || true
    echo "OpenPLC acceso (API https://127.0.0.1:${API_PORTA}, utente «$UTENTE»), broker MQTT su 127.0.0.1:11883."
    echo "Per caricare (o ricaricare) l'impianto: ./laboratorio.sh carica"
}

cli() {
    if [ ! -x "$CACHE/squashfs-root/open-plc-editor" ]; then
        mkdir -p "$CACHE"
        echo "Scarico l'Editor di OpenPLC ${EDITOR_VER} (serve la sua CLI per compilare)…" >&2
        curl -fL --progress-bar -o "$CACHE/editor.AppImage" "$EDITOR_URL"
        chmod +x "$CACHE/editor.AppImage"
        (cd "$CACHE" && ./editor.AppImage --appimage-extract >/dev/null)
    fi
    # Senza testa: niente display, e niente variabili che fanno di Electron un Node.
    env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE -u DISPLAY -u WAYLAND_DISPLAY \
        "$CACHE/squashfs-root/open-plc-editor" --cli --user-data "$CACHE/user-data" "$@"
}

carica() {
    # Si compila una copia: la build dell'Editor scrive dentro la cartella del
    # progetto, e quella nel repository resta pulita.
    rm -rf "$CACHE/progetti/impianto"
    mkdir -p "$CACHE/progetti"
    cp -r "$QUI/impianto" "$CACHE/progetti/impianto"
    OPENPLC_USER="$UTENTE" OPENPLC_PASSWORD="$PASSWORD" \
        cli upload "$CACHE/progetti/impianto" --host 127.0.0.1 \
        --target "OpenPLC Runtime v4" --yes --no-json
    stato
}

stato() {
    local tok
    tok=$(c_api login -H 'Content-Type: application/json' \
        -d "{\"username\":\"$UTENTE\",\"password\":\"$PASSWORD\"}" 2>/dev/null \
        | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')
    if [ -n "$tok" ]; then
        echo "OpenPLC: $(c_api status -H "Authorization: Bearer $tok")"
    else
        echo "OpenPLC: non risponde sulla ${API_PORTA} (./laboratorio.sh avvia)"
    fi
    for p in 1502 10102 14840 11883; do
        if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "  porta $p: aperta"; else echo "  porta $p: chiusa"; fi
    done
}

# Il client MQTT è quello dentro il container del broker: niente da installare.
ascolta() { podman exec "$MQTT" nanomq_cli sub -h 127.0.0.1 -p 1883 -t "${1:?topic}" 2>&1 | grep --line-buffered -v -e '^connect_cb' -e '^HEX' -e 'level=warning'; }
pubblica() { podman exec "$MQTT" nanomq_cli pub -h 127.0.0.1 -p 1883 -t "${1:?topic}" -m "${2:?testo}" >/dev/null 2>&1; }

ferma() {
    podman rm -f "$PLC" "$MQTT" >/dev/null 2>&1 || true
    echo "Laboratorio fermato."
}

case "${1:-}" in
    avvia) avvia ;;
    carica) carica ;;
    stato) stato ;;
    ascolta) ascolta "${2:-}" ;;
    pubblica) pubblica "${2:-}" "${3:-}" ;;
    ferma) ferma ;;
    *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
