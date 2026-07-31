#!/usr/bin/env bash
#
# Installa il runtime SWS come container podman gestito da systemd, da
# eseguire SUL DISPOSITIVO come utente normale (nessun sudo, podman rootless).
#
# Fa quello che altrimenti sono sei comandi da ricordare a memoria: prepara la
# directory dati, procura l'immagine, installa l'unit quadlet, abilita il linger
# (senza cui un container rootless non riparte dopo il reboot) e avvia il
# servizio.
#
# I dati stanno in bind mount su un percorso esplicito dell'host
# (/data/user/sws per default), non in volumi nominati: restano visibili e
# copiabili senza passare da `podman volume inspect`, e /data è la partizione
# scrivibile sui device Pixsys — stessa collocazione dell'installazione nativa.
#
#   /data/user/sws/projects   progetti (dati utente)
#   /data/user/sws/config     certificati TLS, registro progetti
#   /data/user/sws/logs       log JSONL rotati
#
# La SPA NON è più fra questi: dal 2026-07-30 sta dentro l'immagine, quindi
# arriva e si aggiorna con essa. Una /data/user/sws/www lasciata da
# un'installazione precedente non serve più (e non viene toccata).
#
# Uso:
#   ./install-container.sh --pull              # dal registry: la strada normale
#   ./install-container.sh --pull REF          # ...da un riferimento specifico
#   ./install-container.sh --image ARCHIVIO    # da archivio: dispositivi senza rete
#   ./install-container.sh --bridge            # rete bridge: NIENTE discovery mDNS
#   ./install-container.sh --data /altro/path  # directory dati alternativa
#   ./install-container.sh --migrate-volumes   # recupera i dati dai volumi nominati
#                                              # delle installazioni pre-2026-07-28
#   ./install-container.sh --no-autostart      # solo podman run, nessuna unit
#   ./install-container.sh --uninstall         # rimuove servizio e container
#   ./install-container.sh --uninstall --purge # ...e anche i dati (!)
#
# Prerequisiti: podman >= 4.4 (quadlet), mappature subuid/subgid per l'utente
# corrente, ~1 GB liberi nello storage di podman. Con --pull, rete verso il
# registry: l'immagine è pubblica, quindi nessuna credenziale.

set -euo pipefail

# Ripiego per il caso "nessuna immagine indicata, uso quella già presente".
# Con --image il riferimento vero si legge da `podman load`, con --pull è
# REGISTRY_REF: questo valore serve solo quando non si procura niente.
TAG="localhost/sws-runtime:latest"
TAG_EXPLICIT=0
# Tag MOBILE di proposito: `--pull` senza argomenti prende l'ultima pubblicata.
# Non rende gli aggiornamenti automatici — il pull resta un comando che qualcuno
# deve dare. Evita invece il caso in cui un default pinnato non viene aggiornato
# a una release e i dispositivi restano indietro senza che nessuno se ne accorga.
# Per inchiodare una versione: `--pull ghcr.io/soligolab/sws-runtime:2026.07-arm64`.
REGISTRY_REF="ghcr.io/soligolab/sws-runtime:latest-arm64"
NAME="sws-runtime"
DATA="/data/user/sws"
UNIT_DIR="$HOME/.config/containers/systemd"
UNIT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sws-runtime.container"

IMAGE_ARCHIVE=""
PULL=0
# La migrazione dai volumi nominati (layout pre-2026-07-28) è opt-in, e non più
# automatica quando la cartella dati è vuota. Automatica faceva danni: dopo un
# `--uninstall --purge` la cartella È vuota per definizione, quindi la
# reinstallazione ripescava i dati che il purge aveva appena eliminato. Visto
# dal vivo il 2026-07-30, con un progetto di due giorni prima tornato in servizio
# su un dispositivo che doveva essere pulito.
MIGRATE_VOLUMES=0
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
        # --pull accetta un riferimento opzionale: senza, il default pubblico.
        # Il `case` distingue un argomento da un'altra flag guardando il primo
        # carattere, così `--pull --bridge` non ingoia `--bridge` come immagine.
        --pull)
            PULL=1
            if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then REGISTRY_REF="$2"; shift 2; else shift; fi
            ;;
        --migrate-volumes) MIGRATE_VOLUMES=1; shift ;;
        # La SPA è nell'immagine dal 2026-07-30. Queste due flag non fanno più
        # niente: fallire dicendolo è meglio di un no-op silenzioso, che
        # lascerebbe credere di aver aggiornato il frontend.
        --www|--www-only)
            echo "ERRORE: $1 non esiste più — la SPA è dentro l'immagine dal 2026-07-30." >&2
            echo "        Per aggiornare il frontend si aggiorna l'immagine:" >&2
            echo "          ./install-container.sh --pull" >&2
            echo "        L'archivio sws-www-*.tar.gz non viene più prodotto dalla build." >&2
            exit 1
            ;;
        --data)          DATA="$2"; shift 2 ;;
        --tag)           TAG="$2"; TAG_EXPLICIT=1; shift 2 ;;
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

# ── 0. Validazione degli input ────────────────────────────────────────────────
# Tutto ciò che può far fallire l'installazione va controllato PRIMA di fermare
# il servizio. Succedeva il contrario: il passo 4 rimuoveva il container e solo
# il passo 5 si accorgeva che mancava la unit quadlet, lasciando il dispositivo
# senza runtime e senza modo di ripartire. Visto dal vivo il 2026-07-29.
if [ "$PULL" -eq 1 ] && [ -n "$IMAGE_ARCHIVE" ]; then
    echo "ERRORE: --pull e --image insieme non hanno senso: scegli da dove arriva l'immagine." >&2
    exit 1
fi
if [ -n "$IMAGE_ARCHIVE" ] && [ ! -f "$IMAGE_ARCHIVE" ]; then
    echo "ERRORE: archivio immagine non trovato: $IMAGE_ARCHIVE" >&2; exit 1
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
for d in projects config logs; do
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

# La www di un'installazione precedente non serve più (la SPA è nell'immagine).
# Segnalata e non cancellata: è roba dell'utente sul suo disco, e cancellare a
# sorpresa non è mai il comportamento giusto di un installer.
if [ -d "$DATA/www" ]; then
    echo "    www (non più usata: la SPA è nell'immagine — la lascio dov'è)"
fi

# Migrazione dai volumi nominati del layout pre-2026-07-28: solo su richiesta
# esplicita. Automatica era una trappola — la condizione "cartella vuota" è
# esattamente lo stato in cui `--uninstall --purge` lascia il dispositivo,
# quindi una reinstallazione dopo un purge resuscitava i dati appena eliminati.
if [ "$MIGRATE_VOLUMES" -eq 1 ]; then
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
elif podman volume exists sws-projects 2>/dev/null; then
    echo "    NOTA: esistono ancora i volumi nominati di un'installazione precedente."
    echo "          Se i progetti sembrano spariti: --migrate-volumes li recupera."
fi

# ── 2. Immagine ───────────────────────────────────────────────────────────────
# Prima di toccare il servizio in esecuzione: se l'immagine non si procura, il
# dispositivo deve restare esattamente com'era.
if [ "$PULL" -eq 1 ]; then
    echo "==> [2/6] scarico $REGISTRY_REF"
    podman pull "$REGISTRY_REF" || {
        echo "ERRORE: pull fallito. Il runtime in esecuzione non è stato toccato." >&2
        echo "        L'immagine è pubblica: se la rete verso il registry non c'è," >&2
        echo "        usa --image <archivio> sul percorso offline." >&2
        exit 1; }
    TAG="$REGISTRY_REF"
elif [ -n "$IMAGE_ARCHIVE" ]; then
    echo "==> [2/6] carico l'immagine da $IMAGE_ARCHIVE"
    # Il riferimento si legge da `podman load`, non si indovina. Prima era
    # cablato a `localhost/sws-runtime:0.1.0-dev`: alla prima release con un
    # numero diverso l'installazione offline sarebbe morta su "immagine
    # assente" davanti a un archivio perfettamente valido, e il messaggio
    # avrebbe mandato a cercare il problema dalla parte sbagliata.
    LOAD_OUT=$(podman load -i "$IMAGE_ARCHIVE")
    echo "$LOAD_OUT" | tail -1
    LOADED=$(echo "$LOAD_OUT" | sed -n 's/^Loaded image: *//p' | tail -1)
    if [ "$TAG_EXPLICIT" -eq 1 ]; then
        : # --tag esplicito: vince su quello che dice l'archivio.
    elif [ -n "$LOADED" ]; then
        TAG="$LOADED"
    else
        echo "    NOTA: nome dell'immagine non riconosciuto nell'output di podman load," >&2
        echo "          uso $TAG. Se non combacia, passa --tag <riferimento>." >&2
    fi
else
    echo "==> [2/6] nessuna immagine indicata, uso quella già presente"
fi
podman image exists "$TAG" || {
    echo "ERRORE: immagine $TAG assente. Passa --pull, --image <archivio> o --tag <altro>." >&2
    exit 1
}
echo "    immagine: $TAG"

# ── 3. La SPA è dentro l'immagine ─────────────────────────────────────────────
# Controllata qui e non data per scontata: un'immagine costruita senza il layer
# www risponderebbe alle API servendo però una interfaccia vuota, e dal browser
# quella diagnosi è tutt'altro che ovvia (già costata tempo quando la SPA
# viaggiava a parte e il bind mount restava vuoto).
echo "==> [3/6] verifico che l'immagine contenga la SPA"
if podman run --rm --entrypoint /usr/bin/test "$TAG" -f /var/sws/www/index.html 2>/dev/null; then
    echo "    /var/sws/www/index.html presente"
else
    echo "ERRORE: l'immagine $TAG non contiene /var/sws/www/index.html." >&2
    echo "        È stata costruita prima del 2026-07-30, quando la SPA viaggiava a parte?" >&2
    echo "        Ricostruiscila con scripts/build_container.sh. Nessuna modifica effettuata." >&2
    exit 1
fi

# ── 4. Container preesistente ─────────────────────────────────────────────────
# Va rimosso comunque: un container creato da un'immagine precedente continua a
# usare quella, anche dopo `podman load` dello stesso tag.
echo "==> [4/6] rimuovo il container precedente, se c'è"
systemctl --user stop "$NAME" 2>/dev/null || true
podman rm -f "$NAME" >/dev/null 2>&1 || true

# ── 5. Avvio ──────────────────────────────────────────────────────────────────
# Nessun mount per www: la SPA è contenuto dell'immagine, e montarci sopra una
# directory dell'host la nasconderebbe — è esattamente come si otterrebbe una
# interfaccia vuota senza capire perché.
MOUNTS=(
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
        echo "    dati     : $DATA"
        echo "    immagine : $TAG"
        [ "$AUTOSTART" -eq 1 ] && echo "    stato    : systemctl --user status $NAME"
        echo "==> fatto."
        exit 0
    fi
    sleep 1
done

echo "ERRORE: il runtime non risponde su :8443 dopo 30s." >&2
echo "        Log:  podman logs $NAME" >&2
[ "$AUTOSTART" -eq 1 ] && echo "              journalctl --user -u $NAME -n 50" >&2
exit 1
