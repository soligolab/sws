#!/usr/bin/env bash
#
# Installa il runtime SWS come container podman gestito da systemd, da
# eseguire SUL DISPOSITIVO come utente normale (nessun sudo, podman rootless).
#
# Fa quello che altrimenti sono sei comandi da ricordare a memoria: prepara la
# directory dati, carica l'immagine, srotola la SPA, installa l'unit quadlet,
# abilita il linger (senza cui un container rootless non riparte dopo il
# reboot) e avvia il servizio.
#
# I dati stanno in bind mount su un percorso esplicito dell'host
# (/data/user/sws per default), non in volumi nominati: restano visibili e
# copiabili senza passare da `podman volume inspect`, e /data è la partizione
# scrivibile sui device Pixsys — stessa collocazione dell'installazione nativa.
#
#   /data/user/sws/projects   progetti (dati utente)
#   /data/user/sws/config     certificati TLS, registro progetti
#   /data/user/sws/logs       log JSONL rotati
#   /data/user/sws/www        SPA — aggiornabile senza ricostruire l'immagine
#
# Uso:
#   ./install-container.sh --image sws-runtime-<ver>-aarch64-image.tar.gz \
#                          --www   sws-www-<ver>.tar.gz
#   ./install-container.sh --www-only sws-www-<ver>.tar.gz   # solo frontend, ~3 MB
#   ./install-container.sh --bridge            # rete bridge: NIENTE discovery mDNS
#   ./install-container.sh --data /altro/path  # directory dati alternativa
#   ./install-container.sh --no-autostart      # solo podman run, nessuna unit
#   ./install-container.sh --uninstall         # rimuove servizio e container
#   ./install-container.sh --uninstall --purge # ...e anche i dati (!)
#
# Prerequisiti: podman >= 4.4 (quadlet), mappature subuid/subgid per l'utente
# corrente, ~1 GB liberi nello storage di podman.

set -euo pipefail

TAG="localhost/sws-runtime:0.1.0-dev"
NAME="sws-runtime"
DATA="/data/user/sws"
UNIT_DIR="$HOME/.config/containers/systemd"
UNIT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sws-runtime.container"

IMAGE_ARCHIVE=""
WWW_ARCHIVE=""
WWW_ONLY=0
# Rete host per default. Sulla rete rootless di podman il multicast mDNS non
# esce dal container, quindi "Cerca runtime" nell'IDE non trova mai il
# dispositivo: chi installa senza flag deve ottenere la configurazione che
# funziona, non quella che va poi corretta. Verificato sul dispositivo il
# 2026-07-30: in bridge `/api/discover` risponde `[]`, in host network trova il
# runtime con l'URL corretto.
HOST_NETWORK=1
AUTOSTART=1
UNINSTALL=0
PURGE=0

while [ $# -gt 0 ]; do
    case "$1" in
        --image)         IMAGE_ARCHIVE="$2"; shift 2 ;;
        --www)           WWW_ARCHIVE="$2"; shift 2 ;;
        --www-only)      WWW_ARCHIVE="$2"; WWW_ONLY=1; shift 2 ;;
        --data)          DATA="$2"; shift 2 ;;
        --tag)           TAG="$2"; shift 2 ;;
        --bridge)        HOST_NETWORK=0; shift ;;
        # Accettata per compatibilità: era la flag da passare quando il default
        # era la rete bridge. Ora non cambia niente, ma non deve dare errore a
        # chi la ha nelle dita o in uno script.
        --host-network)  HOST_NETWORK=1; shift ;;
        --no-autostart)  AUTOSTART=0; shift ;;
        --uninstall)     UNINSTALL=1; shift ;;
        --purge)         PURGE=1; shift ;;
        *) echo "Flag non riconosciuta: $1" >&2; exit 1 ;;
    esac
done

command -v podman >/dev/null || { echo "ERRORE: podman non installato." >&2; exit 1; }

# ── Disinstallazione ──────────────────────────────────────────────────────────
if [ "$UNINSTALL" -eq 1 ]; then
    echo "==> rimozione servizio e container"
    systemctl --user disable --now "$NAME" 2>/dev/null || true
    rm -f "$UNIT_DIR/$NAME.container"
    systemctl --user daemon-reload 2>/dev/null || true
    podman rm -f "$NAME" >/dev/null 2>&1 || true
    if [ "$PURGE" -eq 1 ]; then
        echo "==> rimozione dati in $DATA (progetti compresi)"
        rm -rf "$DATA"
    else
        echo "    dati conservati in $DATA (--purge per cancellarli)"
    fi
    echo "==> fatto."
    exit 0
fi

# ── Aggiornamento della sola SPA ──────────────────────────────────────────────
# Il percorso veloce: la SPA è un bind mount, quindi basta sostituire i file.
# Il runtime serve i file statici a ogni richiesta, non li tiene in memoria:
# non serve nemmeno riavviare il container, basta ricaricare la pagina.
if [ "$WWW_ONLY" -eq 1 ]; then
    [ -f "$WWW_ARCHIVE" ] || { echo "ERRORE: archivio SPA non trovato: $WWW_ARCHIVE" >&2; exit 1; }
    echo "==> aggiorno solo la SPA in $DATA/www"
    mkdir -p "$DATA/www"
    # Prima si srotola a fianco e si valida: se il tar è troncato non si resta
    # con una SPA mutilata.
    rm -rf "$DATA/.www-new"
    mkdir -p "$DATA/.www-new"
    tar xzf "$WWW_ARCHIVE" -C "$DATA/.www-new"
    [ -f "$DATA/.www-new/index.html" ] || {
        echo "ERRORE: l'archivio non contiene index.html — SPA lasciata invariata." >&2
        rm -rf "$DATA/.www-new"; exit 1; }
    # Si sostituisce il CONTENUTO, non la directory: `mv` della directory
    # montata romperebbe il bind mount, perché il container ne tiene l'inode e
    # continuerebbe a vedere quella vecchia (spostata) → 404 su tutta la SPA.
    # Verificato sul dispositivo: era esattamente quello che succedeva.
    find "$DATA/www" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$DATA/.www-new/." "$DATA/www/"
    rm -rf "$DATA/.www-new"
    echo "    fatto — ricarica la pagina nel browser (niente riavvio necessario)."
    exit 0
fi

# ── 0. Validazione degli input ────────────────────────────────────────────────
# Tutto ciò che può far fallire l'installazione va controllato PRIMA di fermare
# il servizio. Succedeva il contrario: il passo 4 rimuoveva il container e solo
# il passo 5 si accorgeva che mancava la unit quadlet, lasciando il dispositivo
# senza runtime e senza modo di ripartire. Visto dal vivo il 2026-07-29.
if [ -n "$IMAGE_ARCHIVE" ] && [ ! -f "$IMAGE_ARCHIVE" ]; then
    echo "ERRORE: archivio immagine non trovato: $IMAGE_ARCHIVE" >&2; exit 1
fi
if [ -n "$WWW_ARCHIVE" ] && [ ! -f "$WWW_ARCHIVE" ]; then
    echo "ERRORE: archivio SPA non trovato: $WWW_ARCHIVE" >&2; exit 1
fi
if [ "$AUTOSTART" -eq 1 ] && [ ! -f "$UNIT_SRC" ]; then
    echo "ERRORE: manca la unit quadlet $UNIT_SRC" >&2
    echo "        Copiala accanto a questo script (sta in deploy/container/)," >&2
    echo "        oppure passa --no-autostart per installare senza avvio al boot." >&2
    echo "        Nessuna modifica effettuata: il runtime in esecuzione non è stato toccato." >&2
    exit 1
fi

# ── 1. Directory dati ─────────────────────────────────────────────────────────
echo "==> [1/6] directory dati $DATA"
for d in projects config logs www; do
    if [ -d "$DATA/$d" ]; then
        echo "    $d (già presente, contenuto conservato)"
    else
        mkdir -p "$DATA/$d" || {
            echo "ERRORE: non posso creare $DATA/$d — permessi?" >&2
            echo "        Su Pixsys OS usare un percorso sotto /data/user/, di proprietà dell'utente." >&2
            exit 1; }
        echo "    $d (creata)"
    fi
done

# Migrazione dai volumi nominati della versione precedente: senza questo, dopo
# l'aggiornamento il runtime partirebbe con i progetti "spariti" (in realtà
# ancora nel vecchio volume, ma non più montati).
for pair in "sws-projects:projects" "sws-config:config" "sws-logs:logs"; do
    vol="${pair%%:*}"; sub="${pair##*:}"
    if podman volume exists "$vol" 2>/dev/null && [ -z "$(ls -A "$DATA/$sub" 2>/dev/null)" ]; then
        src="$(podman volume inspect "$vol" --format '{{.Mountpoint}}' 2>/dev/null || true)"
        if [ -n "$src" ] && [ -n "$(ls -A "$src" 2>/dev/null)" ]; then
            echo "    migrazione dal volume $vol → $DATA/$sub"
            cp -a "$src/." "$DATA/$sub/"
        fi
    fi
done

# ── 2. Immagine ───────────────────────────────────────────────────────────────
if [ -n "$IMAGE_ARCHIVE" ]; then
    [ -f "$IMAGE_ARCHIVE" ] || { echo "ERRORE: archivio non trovato: $IMAGE_ARCHIVE" >&2; exit 1; }
    echo "==> [2/6] carico l'immagine da $IMAGE_ARCHIVE"
    podman load -i "$IMAGE_ARCHIVE" | tail -1
else
    echo "==> [2/6] nessun archivio immagine indicato, uso quella già presente"
fi
podman image exists "$TAG" || {
    echo "ERRORE: immagine $TAG assente. Passa --image <archivio> o --tag <altro>." >&2
    exit 1
}

# ── 3. SPA ────────────────────────────────────────────────────────────────────
if [ -n "$WWW_ARCHIVE" ]; then
    [ -f "$WWW_ARCHIVE" ] || { echo "ERRORE: archivio SPA non trovato: $WWW_ARCHIVE" >&2; exit 1; }
    echo "==> [3/6] srotolo la SPA in $DATA/www"
    rm -rf "$DATA/www"; mkdir -p "$DATA/www"
    tar xzf "$WWW_ARCHIVE" -C "$DATA/www"
else
    echo "==> [3/6] nessun archivio SPA indicato, uso quella già in $DATA/www"
fi
# La SPA non è nell'immagine: senza questi file il runtime risponde alle API ma
# non serve nessuna interfaccia, e la diagnosi dal browser è tutt'altro che ovvia.
[ -f "$DATA/www/index.html" ] || {
    echo "ERRORE: $DATA/www non contiene index.html." >&2
    echo "        Passa --www sws-www-<ver>.tar.gz: la SPA non è dentro l'immagine." >&2
    exit 1; }

# ── 4. Container preesistente ─────────────────────────────────────────────────
# Va rimosso comunque: un container creato da un'immagine precedente continua a
# usare quella, anche dopo `podman load` dello stesso tag.
echo "==> [4/6] rimuovo il container precedente, se c'è"
systemctl --user stop "$NAME" 2>/dev/null || true
podman rm -f "$NAME" >/dev/null 2>&1 || true

# ── 5. Avvio ──────────────────────────────────────────────────────────────────
MOUNTS=(
    -v "$DATA/www:/var/sws/www"
    -v "$DATA/config:/var/sws/config"
    -v "$DATA/projects:/var/sws/projects"
    -v "$DATA/logs:/var/sws/logs"
)

if [ "$AUTOSTART" -eq 1 ]; then
    echo "==> [5/6] unit quadlet + linger"
    mkdir -p "$UNIT_DIR"
    # Già validato al passo 0, prima di fermare il servizio: qui resta come rete.
    [ -f "$UNIT_SRC" ] || { echo "ERRORE: manca $UNIT_SRC" >&2; exit 1; }

    if [ "$HOST_NETWORK" -eq 1 ]; then
        # PublishPort è incompatibile con Network=host: le porte sono già quelle
        # dell'host. Commentate, non rimosse, così si vede cosa è cambiato.
        sed -e 's/^PublishPort=/#PublishPort=/' \
            -e 's/^ContainerName=/Network=host\nContainerName=/' \
            "$UNIT_SRC" > "$UNIT_DIR/$NAME.container"
        echo "    Network=host (default — il multicast mDNS raggiunge la LAN)"
    else
        install -m 0644 "$UNIT_SRC" "$UNIT_DIR/$NAME.container"
        echo "    rete bridge (--bridge): porte pubblicate 8443/8444, ma"
        echo "    ATTENZIONE: \"Cerca runtime\" nell'IDE non troverà questo dispositivo." >&2
        echo "               Collegarsi a mano con http://<ip>:8444." >&2
    fi
    sed -i "s|^Image=.*|Image=$TAG|" "$UNIT_DIR/$NAME.container"
    # La unit ha /data/user/sws hardcoded: riscrivere i mount se --data diverso.
    if [ "$DATA" != "/data/user/sws" ]; then
        sed -i "s|^Volume=/data/user/sws/|Volume=$DATA/|" "$UNIT_DIR/$NAME.container"
        echo "    mount riscritti su $DATA"
    fi

    # Senza linger i servizi utente muoiono al logout e non partono al boot:
    # è esattamente il motivo per cui il container non tornava su dopo un reboot.
    if loginctl show-user "$USER" 2>/dev/null | grep -q "Linger=yes"; then
        echo "    linger già attivo"
    elif loginctl enable-linger "$USER" 2>/dev/null; then
        echo "    linger abilitato"
    else
        echo "    ATTENZIONE: non ho potuto abilitare il linger (serve un permesso)." >&2
        echo "                Esegui:  sudo loginctl enable-linger $USER" >&2
        echo "                Senza, il container NON riparte dopo il reboot." >&2
    fi

    systemctl --user daemon-reload
    systemctl --user start "$NAME"
else
    echo "==> [5/6] avvio diretto (--no-autostart: non riparte dopo il reboot)"
    PORTS=(-p 8443:8443 -p 8444:8444)
    [ "$HOST_NETWORK" -eq 1 ] && PORTS=(--network host)
    podman run -d --name "$NAME" "${PORTS[@]}" "${MOUNTS[@]}" \
        --restart=unless-stopped "$TAG" >/dev/null
fi

# ── 6. Verifica ───────────────────────────────────────────────────────────────
echo "==> [6/6] attendo che risponda"

# NON usare `hostname -I`: è un'opzione di net-tools e non esiste dove
# /usr/bin/hostname è quello di coreutils (Pixsys OS, per esempio). Con
# `set -euo pipefail` la sostituzione fallita fa abortire lo script proprio
# qui, a installazione già riuscita. `ip` c'è su qualunque Linux recente, e
# per di più elenca TUTTI gli indirizzi: questi device ne hanno spesso più di
# uno e indovinare "il primo" è fuorviante.
lan_ips() {
    ip -4 -o addr show scope global 2>/dev/null \
        | awk '{split($4,a,"/"); printf "%s ", a[1]}' || true
}
IPS="$(lan_ips)"
IPS="${IPS% }"
[ -n "$IPS" ] || IPS="localhost"

for i in $(seq 1 30); do
    if curl -fs --max-time 2 http://localhost:8443/health >/dev/null 2>&1; then
        echo "    /health ok dopo ${i}s"
        echo
        for a in $IPS; do
            echo "    viewer : http://$a:8443     IDE : http://$a:8444"
        done
        echo "    dati   : $DATA"
        [ "$AUTOSTART" -eq 1 ] && echo "    stato  : systemctl --user status $NAME"
        echo "==> fatto."
        exit 0
    fi
    sleep 1
done

echo "ERRORE: il runtime non risponde su :8443 dopo 30s." >&2
echo "        Log:  podman logs $NAME" >&2
[ "$AUTOSTART" -eq 1 ] && echo "              journalctl --user -u $NAME -n 50" >&2
exit 1
