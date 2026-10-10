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
#                                              # tag latest-<arch>, con <arch>
#                                              # dedotta qui da `uname -m`
#   ./install-container.sh --pull REF          # ...da un riferimento specifico
#   ./install-container.sh --pull-only         # procura l'immagine ed esce
#   ./install-container.sh --image ARCHIVIO    # da archivio: dispositivi senza rete
#   ./install-container.sh --bridge            # rete bridge: NIENTE discovery mDNS
#   ./install-container.sh --pull \
#       --tunnel wss://tunnel.soligo.net/tunnel/v1 \
#       --tunnel-nome tc620-reparto-nord \
#       --tunnel-token <token>                 # il pannello chiama il cloud: da li'
#                                              # l'IDE lo raggiunge anche dietro NAT.
#                                              # Tutti e tre o nessuno.
#   ./install-container.sh --data /altro/path  # directory dati alternativa
#   ./install-container.sh --migrate-volumes   # recupera i dati dai volumi nominati
#                                              # delle installazioni pre-2026-07-28
#   ./install-container.sh --no-autostart      # solo podman run, nessuna unit
#   ./install-container.sh --solo-unita        # riscrive SOLO i quadlet da questi
#                                              # template, con l'immagine, i dati e la
#                                              # rete di quelli già installati, e
#                                              # riavvia: nessun pull, nessun container
#                                              # rifatto (02-10-2026, lo usa il runtime)
#   ./install-container.sh --uninstall         # rimuove servizio e container
#   ./install-container.sh --uninstall --purge # ...e anche i dati (!)
#
# Prerequisiti: podman >= 4.4 (quadlet), mappature subuid/subgid per l'utente
# corrente, ~1 GB liberi nello storage di podman. Con --pull, rete verso il
# registry: l'immagine è pubblica, quindi nessuna credenziale.

set -euo pipefail
# Lanciato dal runtime con un servizio transitorio (`--solo-unita`, 02-10-2026)
# l'ambiente può non avere USER, e con `set -u` il linger fallirebbe per quello.
USER="${USER:-$(id -un)}"

# Ripiego per il caso "nessuna immagine indicata, uso quella già presente".
# Con --image il riferimento vero si legge da `podman load`, con --pull è
# REGISTRY_REF: questo valore serve solo quando non si procura niente.
TAG="localhost/sws-runtime:latest"
TAG_EXPLICIT=0
# Tag MOBILE di proposito: `--pull` senza argomenti prende l'ultima pubblicata.
# Non rende gli aggiornamenti automatici — il pull resta un comando che qualcuno
# deve dare. Evita invece il caso in cui un default pinnato non viene aggiornato
# a una release e i dispositivi restano indietro senza che nessuno se ne accorga.
# Per inchiodare una versione: `--pull ghcr.io/soligolab/sws-runtime:2026.7.0-arm64`.
#
# Il TAG però non è cablato qui: il suffisso di architettura si compone al passo
# 0 da `uname -m`. Era `latest-arm64` fisso, e su un dispositivo x86_64 scaricava
# un'immagine che non parte — con l'installazione lanciata dall'IDE il dispositivo
# non è quasi mai la macchina da cui si installa, quindi indovinare non va bene.
# Il tunnel verso il cloud (10-10-2026). Vuoti = nessun tunnel, che resta il
# default: un pannello che lavora da solo in impianto non deve chiamare niente.
TUNNEL_URL=""
TUNNEL_NOME=""
TUNNEL_TOKEN=""

REGISTRY_IMAGE="ghcr.io/soligolab/sws-runtime"
REGISTRY_REF=""
REGISTRY_REF_EXPLICIT=0
NAME="sws-runtime"
DATA="/data/user/sws"
UNIT_DIR="$HOME/.config/containers/systemd"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SRC="$SRC_DIR/sws-runtime.container"

# Q25 — commutazione fra motore web e motore LVGL.
#
# La commutazione web/LVGL non installa più niente sull'host (29-09-2026, Fase 4
# del piano dell'aggiornamento): la fa il runtime, via D-Bus, da dentro il
# container. Restano i nomi dei tre pezzi di prima (`sws-display.path`,
# `.service` e lo script), perché l'installer li **toglie** se li trova.
USER_UNIT_DIR="$HOME/.config/systemd/user"
DISPLAY_UNITS_VECCHIE=(sws-display.path sws-display.service)
VIEWER_UNIT_SRC="$SRC_DIR/sws-lvgl-viewer.container"
# L'immagine di boot non installa più niente sull'host (24-09-2026): la chiede
# il runtime al launcher via D-Bus, da dentro il container. Il quadlet monta
# `/run/dbus/system_bus_socket` e dichiara `SWS_HOST_CONFIG_DIR`; le tre cose
# che stavano qui esistevano solo perché un container non parla col bus.
# Dove stava lo script della commutazione vecchia, per toglierlo.
APPLY_DST_DIR="/data/user/sws-container"

IMAGE_ARCHIVE=""
PULL=0
# `--pull-only` procura l'immagine e basta. Esiste per rendere sicura
# l'installazione pulita lanciata dall'IDE: il purge cancella i dati, e se
# l'immagine si scoprisse irraggiungibile DOPO, il dispositivo resterebbe senza
# dati e senza runtime. Procurandola prima, quando si cancella è già in casa.
PULL_ONLY=0
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
# `--solo-unita` (02-10-2026): i quadlet viaggiano dentro l'immagine, e il
# runtime, quando quelli installati sono più vecchi, copia questo script coi
# template nella cartella config e lo fa girare sull'host con un'unità
# transitoria sul bus utente. Riscrive solo il passo 5 — piano
# docs/archive/2026-10-02-quadlet-che-viaggia.md.
SOLO_UNITA=0
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
            if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then REGISTRY_REF="$2"; REGISTRY_REF_EXPLICIT=1; shift 2; else shift; fi
            ;;
        # Procura l'immagine ed esce, senza toccare il servizio in esecuzione.
        # Accetta lo stesso riferimento opzionale di --pull.
        --pull-only)
            PULL=1; PULL_ONLY=1
            if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then REGISTRY_REF="$2"; REGISTRY_REF_EXPLICIT=1; shift 2; else shift; fi
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
        # Il tunnel verso il cloud: o tutti e tre o nessuno (vedi il controllo
        # più sotto). Si scrivono come Environment= nel quadlet, non come
        # argomenti: aggiungere a Exec= vorrebbe dire riscrivere per intero la
        # riga di avvio dell'immagine.
        --tunnel)        TUNNEL_URL="$2";   shift 2 ;;
        --tunnel-nome)   TUNNEL_NOME="$2";  shift 2 ;;
        --tunnel-token)  TUNNEL_TOKEN="$2"; shift 2 ;;
        # Accettata per compatibilità: era la flag da passare quando il default
        # era la rete bridge. Ora non cambia niente, ma non deve dare errore a
        # chi la ha nelle dita o in uno script.
        --host-network)  HOST_NETWORK=1; shift ;;
        --no-autostart)  AUTOSTART=0; shift ;;
        --solo-unita)    SOLO_UNITA=1; shift ;;
        --uninstall)     UNINSTALL=1; shift ;;
        --purge)         PURGE=1; shift ;;
        *) echo "Flag non riconosciuta: $1" >&2; exit 1 ;;
    esac
done

command -v podman >/dev/null || { echo "ERRORE: podman non installato." >&2; exit 1; }

# Il tunnel: o tutti e tre o nessuno, e si rifiuta QUI invece di scrivere un
# quadlet che poi non parte. Il runtime fa lo stesso controllo all'avvio — ma
# scoprirlo da un servizio che non parte, su un pannello appena installato, e'
# molto peggio che leggerlo adesso.
n_tunnel=0
for v in "$TUNNEL_URL" "$TUNNEL_NOME" "$TUNNEL_TOKEN"; do [ -n "$v" ] && n_tunnel=$((n_tunnel + 1)); done
if [ "$n_tunnel" -ne 0 ] && [ "$n_tunnel" -ne 3 ]; then
    echo "ERRORE: il tunnel vuole --tunnel, --tunnel-nome e --tunnel-token insieme." >&2
    echo "        Con uno solo il pannello non si collega a niente e il runtime non parte." >&2
    exit 1
fi
if [ -n "$TUNNEL_TOKEN" ] && [ "${#TUNNEL_TOKEN}" -lt 16 ]; then
    echo "ERRORE: --tunnel-token e' piu corto di 16 caratteri: non e' un segreto." >&2
    echo "        Generane uno: head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'" >&2
    exit 1
fi

# ── Disinstallazione ──────────────────────────────────────────────────────────
if [ "$UNINSTALL" -eq 1 ]; then
    echo "==> rimozione servizio e container"
    systemctl --user disable --now "$NAME" 2>/dev/null || true
    rm -f "$UNIT_DIR/$NAME.container"
    # Anche il viewer: restava installato, e un `daemon-reload` lo rigenerava
    # puntato a un runtime che non c'era più (trovato il 02-10-2026).
    systemctl --user stop sws-lvgl-viewer.service 2>/dev/null || true
    rm -f "$UNIT_DIR/sws-lvgl-viewer.container"
    podman rm -f sws-lvgl-viewer >/dev/null 2>&1 || true
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

# ── Solo le unità: i parametri vengono dai quadlet già installati ─────────────
# Chi chiama (il runtime) non conosce il percorso dati sull'host né la rete con
# cui il pannello fu installato: li sa il quadlet che c'è adesso. Senza quel
# file non c'è niente da riscrivere — serve un'installazione completa.
if [ "$SOLO_UNITA" -eq 1 ]; then
    ESISTENTE="$UNIT_DIR/$NAME.container"
    [ -f "$ESISTENTE" ] || {
        echo "ERRORE: --solo-unita senza $ESISTENTE: qui serve un'installazione completa." >&2
        exit 1; }
    TAG="$(sed -n 's/^Image=//p' "$ESISTENTE" | head -1)"
    TAG_EXPLICIT=1
    VECCHI_DATI="$(sed -n 's|^Volume=\(.*\)/config:/var/sws/config.*|\1|p' "$ESISTENTE" | head -1)"
    [ -n "$VECCHI_DATI" ] && DATA="$VECCHI_DATI"
    if grep -q '^Network=host' "$ESISTENTE"; then HOST_NETWORK=1; else HOST_NETWORK=0; fi
    echo "==> solo le unità: immagine $TAG, dati $DATA, rete $([ "$HOST_NETWORK" -eq 1 ] && echo host || echo bridge)"
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
# Prerequisiti del rootless, verificati PRIMA di toccare qualcosa (2026-09-09).
# Erano solo dichiarati nel commento in testa: con podman < 4.4 il passo quadlet
# falliva a metà, e senza subuid/subgid `podman run` moriva con un messaggio
# sulle mappature che non dice cosa fare. Gli stessi controlli, con gli stessi
# rimedi, li fa prima l'editor via ssh (sonda-dispositivo.sh, Q52): qui sono la
# rete di sicurezza per chi installa a mano. Qui e non prima perché --uninstall
# esce sopra e deve funzionare anche con un podman vecchio.
PODMAN_VER="$(podman version --format '{{.Client.Version}}' 2>/dev/null || podman --version 2>/dev/null | awk '{print $3}')"
PODMAN_MAJ="${PODMAN_VER%%.*}"; PODMAN_MIN="${PODMAN_VER#*.}"; PODMAN_MIN="${PODMAN_MIN%%[!0-9]*}"
case "$PODMAN_MAJ" in ''|*[!0-9]*) PODMAN_MAJ=0 ;; esac
case "$PODMAN_MIN" in ''|*[!0-9]*) PODMAN_MIN=0 ;; esac
if [ "$PODMAN_MAJ" -lt 4 ] || { [ "$PODMAN_MAJ" -eq 4 ] && [ "$PODMAN_MIN" -lt 4 ]; }; then
    if [ "$AUTOSTART" -eq 1 ]; then
        echo "ERRORE: podman ${PODMAN_VER:-?}: serve >= 4.4 (quadlet, per l'avvio automatico)." >&2
        echo "        Aggiorna podman dal gestore pacchetti del sistema, oppure --no-autostart" >&2
        echo "        (solo podman run, nessuna unit: il container non riparte al riavvio)." >&2
        echo "        Nessuna modifica effettuata." >&2
        exit 1
    fi
    # Con --no-autostart la unit quadlet non si scrive: un podman vecchio basta
    # per `podman run`, e chi lo chiede sa cosa perde (es. la macchina di
    # sviluppo, Debian 12 con podman 4.3).
    echo "NOTA: podman ${PODMAN_VER:-?} < 4.4: senza quadlet, --no-autostart è l'unica strada ed è quella scelta."
fi
# `grep -qs` sui due file, per nome utente o per uid: una funzione, perché la
# catena di && e || a mano si legge male e in shell hanno la stessa precedenza.
ha_mappatura() { grep -qs "^$(id -un):" "$1" || grep -qs "^$(id -u):" "$1"; }
if ! ha_mappatura /etc/subuid || ! ha_mappatura /etc/subgid; then
    echo "ERRORE: mancano le mappature subuid/subgid per $(id -un): podman senza root non può partire." >&2
    echo "        Da un amministratore:" >&2
    echo "          sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $(id -un)" >&2
    echo "          podman system migrate" >&2
    echo "        Nessuna modifica effettuata." >&2
    exit 1
fi
# L'architettura la sa il dispositivo, non chi lancia l'installazione: dall'IDE
# si installa su macchine diverse da quella di sviluppo. Qui e non prima perché
# --uninstall esce sopra e non deve mai pretendere un'architettura nota.
if [ "$PULL" -eq 1 ] && [ "$REGISTRY_REF_EXPLICIT" -eq 0 ]; then
    case "$(uname -m)" in
        aarch64|arm64) REGISTRY_REF="$REGISTRY_IMAGE:latest-arm64" ;;
        x86_64|amd64)  REGISTRY_REF="$REGISTRY_IMAGE:latest-amd64" ;;
        *)
            # Caso reale: userspace a 32 bit su SoC aarch64 dà `armv7l`. Con il
            # vecchio default cablato si scaricava un'immagine inavviabile e la
            # diagnosi partiva dalla parte sbagliata.
            echo "ERRORE: architettura $(uname -m) non riconosciuta." >&2
            echo "        Sono pubblicate solo latest-arm64 e latest-amd64." >&2
            echo "        Passa il riferimento per esteso (--pull <registry>:<tag>)" >&2
            echo "        oppure installa da archivio (--image <file>)." >&2
            echo "        Nessuna modifica effettuata." >&2
            exit 1
            ;;
    esac
fi
# --pull-only non installa niente, quindi la unit non le serve: pretenderla
# farebbe fallire il passo che deve solo procurare l'immagine.
if [ "$AUTOSTART" -eq 1 ] && [ "$PULL_ONLY" -eq 0 ] && [ ! -f "$UNIT_SRC" ]; then
    echo "ERRORE: manca la unit quadlet $UNIT_SRC" >&2
    echo "        Copiala accanto a questo script (sta in deploy/container/)," >&2
    echo "        oppure passa --no-autostart per installare senza avvio al boot." >&2
    echo "        Nessuna modifica effettuata: il runtime in esecuzione non è stato toccato." >&2
    exit 1
fi

# ── 1. Directory dati ─────────────────────────────────────────────────────────
# Saltata con --pull-only: chi sta solo procurando un'immagine non si aspetta
# che gli venga creata una gerarchia di cartelle sul dispositivo, e quando
# --pull-only precede un purge sarebbero comunque cancellate un attimo dopo.
if [ "$PULL_ONLY" -eq 0 ]; then
echo "==> [1/6] directory dati $DATA"
for d in projects config logs viewer; do
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
fi   # fine del blocco saltato da --pull-only

# ── 1.5 Spazio disco disponibile ──────────────────────────────────────────────
# Un dispositivo con lo storage quasi pieno fa fallire `podman load`/`pull` con
# una cascata di errori di formato immagine fuorvianti ("no space left on
# device" annegato in mezzo a tentativi oci/dir che falliscono comunque per
# altri motivi, indipendentemente dallo spazio) — visto dal vivo il 2026-08-20
# su un TC620 con 18 immagini vecchie accumulate in poche settimane (~500MB
# l'una, solo quella in uso dal container serviva davvero). Controllato PRIMA
# di scaricare/caricare, con un messaggio che dice subito cosa fare.
if [ "$PULL" -eq 1 ] || [ -n "$IMAGE_ARCHIVE" ]; then
    STORAGE_ROOT="$(podman info --format '{{.Store.GraphRoot}}' 2>/dev/null || echo "$HOME")"
    AVAIL_KB="$(df -Pk "$STORAGE_ROOT" 2>/dev/null | awk 'NR==2{print $4}')"
    if [ -n "$IMAGE_ARCHIVE" ]; then
        ARCHIVE_KB=$(( $(stat -c%s "$IMAGE_ARCHIVE" 2>/dev/null || stat -f%z "$IMAGE_ARCHIVE" 2>/dev/null || echo 0) / 1024 ))
        # x3: l'archivio compresso da caricare, più i layer estratti nello
        # storage finale — stima prudente, non un calcolo esatto (podman non
        # lo espone prima di provare a caricare per davvero).
        NEEDED_KB=$(( ARCHIVE_KB * 3 ))
    else
        # --pull: la dimensione non si conosce finché non si scarica. Minimo
        # prudente basato sulla dimensione tipica delle immagini pubblicate
        # (~500MB) più lo stesso margine di estrazione.
        NEEDED_KB=$(( 500 * 1024 * 3 ))
    fi
    if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -gt 0 ] && [ "$AVAIL_KB" -lt "$NEEDED_KB" ]; then
        echo "ERRORE: spazio insufficiente su $STORAGE_ROOT." >&2
        echo "        Liberi: $((AVAIL_KB / 1024)) MB — ne servono almeno $((NEEDED_KB / 1024)) MB." >&2
        echo "        Immagini podman vecchie sono la causa più comune: elenca con" >&2
        echo "        'podman images' e libera con 'podman image prune -a -f'" >&2
        echo "        (rimuove tutto ciò che non è usato da un container in esecuzione)." >&2
        echo "        Nessuna modifica effettuata: il runtime in esecuzione non è stato toccato." >&2
        exit 1
    fi
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

# --pull-only si ferma qui: l'immagine è sul dispositivo e il servizio in
# esecuzione non è stato toccato. Chi chiama può ora cancellare i dati sapendo
# che l'installazione successiva non dipende più dalla rete.
if [ "$PULL_ONLY" -eq 1 ]; then
    echo "==> immagine procurata. Niente altro toccato (--pull-only)."
    exit 0
fi

# ── 3. La SPA è dentro l'immagine ─────────────────────────────────────────────
# Controllata qui e non data per scontata: un'immagine costruita senza il layer
# www risponderebbe alle API servendo però una interfaccia vuota, e dal browser
# quella diagnosi è tutt'altro che ovvia (già costata tempo quando la SPA
# viaggiava a parte e il bind mount restava vuoto).
if [ "$SOLO_UNITA" -eq 1 ]; then
    echo "==> [3-4/6] solo le unità: immagine e container restano quelli che girano"
else
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
fi

# ── 5. Avvio ──────────────────────────────────────────────────────────────────
# Nessun mount per www: la SPA è contenuto dell'immagine, e montarci sopra una
# directory dell'host la nasconderebbe — è esattamente come si otterrebbe una
# interfaccia vuota senza capire perché.
MOUNTS=(
    -v "$DATA/config:/var/sws/config"
    -v "$DATA/projects:/var/sws/projects"
    -v "$DATA/logs:/var/sws/logs"
)
# Numero di serie e modello della scheda (sorgente «host»): sull'host stanno nel
# device-tree, che podman non espone al container. Sola lettura, e solo se c'è
# (non esiste su x86): un mount con la sorgente mancante fa fallire l'avvio.
DEVICETREE=/sys/firmware/devicetree/base
if [ -d "$DEVICETREE" ]; then
    MOUNTS+=(-v "$DEVICETREE:/host/devicetree:ro")
fi

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
    # Aggiornamento del runtime (27-09-2026): il runtime deve sapere che
    # immagine esegue, il bus utente è quello dell'utente vero, e un'immagine
    # da archivio non ha un registry da seguire.
    sed -i "s|^Environment=SWS_IMAGE=.*|Environment=SWS_IMAGE=$TAG|" "$UNIT_DIR/$NAME.container"
    sed -i "s|/run/user/1000/bus|/run/user/$(id -u)/bus|g" "$UNIT_DIR/$NAME.container"
    # Il tunnel: si tolgono i commenti alle tre righe e ci si mettono i valori.
    # `|` come separatore di sed perché l'URL contiene `/`.
    if [ -n "$TUNNEL_URL" ]; then
        sed -i "s|^#Environment=SWS_TUNNEL_URL=.*|Environment=SWS_TUNNEL_URL=$TUNNEL_URL|" "$UNIT_DIR/$NAME.container"
        sed -i "s|^#Environment=SWS_TUNNEL_NOME=.*|Environment=SWS_TUNNEL_NOME=$TUNNEL_NOME|" "$UNIT_DIR/$NAME.container"
        sed -i "s|^#Environment=SWS_TUNNEL_TOKEN=.*|Environment=SWS_TUNNEL_TOKEN=$TUNNEL_TOKEN|" "$UNIT_DIR/$NAME.container"
        # Il token è nel file, e il file lo legge chi legge la home: 600.
        chmod 600 "$UNIT_DIR/$NAME.container"
        echo "    tunnel: questo pannello chiamerà $TUNNEL_URL come «$TUNNEL_NOME»"
    fi
    case "$TAG" in
        localhost/*)
            sed -i "s|^AutoUpdate=|#AutoUpdate=|" "$UNIT_DIR/$NAME.container"
            echo "    immagine da archivio: aggiornamento automatico spento (si aggiorna dall'IDE con un archivio)" ;;
        *)  echo "    aggiornamento: canale ${TAG##*:} (lo avvia il runtime su richiesta di un Admin)" ;;
    esac
    if [ "${PODMAN_MAJ:-0}" -lt 5 ] 2>/dev/null; then
        sed -i "s|^Notify=healthy|#Notify=healthy|" "$UNIT_DIR/$NAME.container"
        sed -i "s|^Timezone=local|#Timezone=local|" "$UNIT_DIR/$NAME.container"
        echo "    podman ${PODMAN_VER:-?} < 5: Notify=healthy e Timezone tolti — l'aggiornamento non torna indietro da solo, e la finestra è in UTC" >&2
    fi
    # La unit ha /data/user/sws hardcoded: riscrivere i mount se --data diverso.
    if [ "$DATA" != "/data/user/sws" ]; then
        sed -i "s|^Volume=/data/user/sws/|Volume=$DATA/|" "$UNIT_DIR/$NAME.container"
        echo "    mount riscritti su $DATA"
    fi
    if [ -d "$DEVICETREE" ] && ! grep -q "/host/devicetree" "$UNIT_DIR/$NAME.container"; then
        sed -i "/^Volume=.*:\/var\/sws\/logs\$/a Volume=$DEVICETREE:/host/devicetree:ro" "$UNIT_DIR/$NAME.container"
        echo "    mount del device-tree (seriale/modello della scheda) aggiunto"
    fi

    # Senza linger i servizi utente muoiono al logout e non partono al boot:
    # è esattamente il motivo per cui il container non tornava su dopo un reboot.
    #
    # Q45 (misurato il 13-09-2026 sul TC620, Pixsys OS 2.1.1): `enable-linger`
    # per il PROPRIO utente non richiede alcun permesso speciale, con o senza
    # `sudo`. La causa non è una regola polkit di Pixsys: systemd distingue
    # `org.freedesktop.login1.set-self-linger` (il proprio linger — `allow_any:
    # yes` di default in `org.freedesktop.login1.policy`, nessun privilegio) da
    # `set-linger` (il linger di un ALTRO utente — quello sì riservato a root).
    # Verificato disattivando e riattivando il linger come `user`, senza sudo,
    # entrambe le direzioni riuscite. Non è quindi un limite dell'utente finale
    # come temeva la scheda originale: se questo passo fallisce oggi è un
    # sintomo di qualcos'altro di rotto sul dispositivo (systemd/polkit troppo
    # vecchio o diversamente configurato), non un ostacolo da aggirare con un
    # avviso — da qui in poi l'installazione si ferma invece di proseguire a
    # metà verso un container che non sopravviverebbe al primo reboot.
    if loginctl show-user "$USER" 2>/dev/null | grep -q "Linger=yes"; then
        echo "    linger già attivo"
    elif loginctl enable-linger "$USER" 2>/dev/null; then
        echo "    linger abilitato"
    else
        echo "ERRORE: non sono riuscito ad abilitare il linger per $USER." >&2
        echo "        Su un Pixsys OS aggiornato questo comando riesce senza sudo" >&2
        echo "        (systemd distingue il linger del proprio utente da quello di" >&2
        echo "        un altro, verificato il 13-09-2026) — un fallimento qui indica" >&2
        echo "        systemd/polkit più vecchi o configurati diversamente sul" >&2
        echo "        dispositivo, non un permesso mancante da aggirare." >&2
        echo "        Senza linger il container NON riparte dopo il reboot: si ferma" >&2
        echo "        qui invece di installare un dispositivo che si romperebbe al" >&2
        echo "        primo riavvio." >&2
        exit 1
    fi

    # ── Q25: commutazione web/LVGL comandata dal progetto ───────────────────
    #
    # Si installa sempre, anche su un dispositivo che userà solo il web: un
    # progetto LVGL può arrivare domani, e allora il pannello lo mostra da sé.
    # Il costo di averla installata e inerte è nullo — `sws-lvgl-viewer` non ha
    # `WantedBy=`, quindi non parte finché non è il runtime a chiederlo.
    #
    # Mancano i sorgenti? Non è un motivo per far fallire l'installazione del
    # runtime, che è la cosa importante: si avvisa e si va avanti. Chi copia
    # solo `install-container.sh` e la unit del runtime — cosa che il README ha
    # sempre permesso — deve continuare a ottenere un dispositivo funzionante.
    if [ -f "$VIEWER_UNIT_SRC" ]; then
        install -m 0644 "$VIEWER_UNIT_SRC" "$UNIT_DIR/sws-lvgl-viewer.container"
        sed -i "s|^Image=.*|Image=$TAG|" "$UNIT_DIR/sws-lvgl-viewer.container"
        case "$TAG" in localhost/*) sed -i "s|^AutoUpdate=|#AutoUpdate=|" "$UNIT_DIR/sws-lvgl-viewer.container" ;; esac
        [ "$DATA" != "/data/user/sws" ] && \
            sed -i "s|^Volume=/data/user/sws/|Volume=$DATA/|" "$UNIT_DIR/sws-lvgl-viewer.container"

        echo "    viewer LVGL installato (lo avvia il runtime quando il progetto lo chiede)"
        INSTALL_DISPLAY=1

    else
        echo "    NOTA: quadlet del viewer LVGL assente, salto quel pezzo." >&2
        echo "          Il runtime funziona lo stesso; un progetto LVGL non andrà a schermo." >&2
        INSTALL_DISPLAY=0
    fi

    # La commutazione vecchia sull'host (fino al 29-09-2026): via, se c'è.
    # Finché restava, era inerte (il runtime non scrive più `display-target`),
    # ma un pezzo che non fa niente sull'host è un pezzo che un giorno confonde.
    VECCHIA=0
    for u in "${DISPLAY_UNITS_VECCHIE[@]}"; do
        if [ -f "$USER_UNIT_DIR/$u" ]; then
            systemctl --user disable --now "$u" >/dev/null 2>&1 || true
            rm -f "$USER_UNIT_DIR/$u"
            VECCHIA=1
        fi
    done
    [ -f "$APPLY_DST_DIR/sws-display-apply.sh" ] && { rm -f "$APPLY_DST_DIR/sws-display-apply.sh"; VECCHIA=1; }
    rm -f "$DATA/config/display-target"
    [ "$VECCHIA" -eq 1 ] && echo "    commutazione web/LVGL sull'host tolta: ora la fa il runtime"

    systemctl --user daemon-reload
    if [ "$SOLO_UNITA" -eq 1 ]; then
        # Il runtime gira ancora (è lui che ha chiesto): va riavviato perché le
        # righe nuove del quadlet valgono solo per un container ricreato.
        systemctl --user restart "$NAME"
    else
        systemctl --user start "$NAME"
    fi

    # Il companion LVGL, se sta girando, va RIAVVIATO: il suo quadlet punta
    # all'immagine appena sostituita, ma un container già avviato continua con
    # quella vecchia finché qualcuno non lo ferma.
    #
    # Misurato sul WP630 il 2026-09-08: dopo l'aggiornamento il runtime girava
    # sull'immagine nuova e `sws-lvgl-viewer` su quella di due ore prima —
    # due versioni diverse sullo stesso pannello, e niente lo diceva. In più il
    # viewer aveva perso il WebSocket quando il runtime è stato sostituito e non
    # riconnetteva: lo schermo mostrava un fotogramma congelato, con la
    # retroilluminazione accesa. Un'ora di diagnosi.
    #
    # Solo se era già attivo: se il progetto non è LVGL non deve partire ora —
    # chi decide è il runtime, all'avvio.
    if systemctl --user is-active --quiet sws-lvgl-viewer.service 2>/dev/null; then
        if systemctl --user restart sws-lvgl-viewer.service 2>/dev/null; then
            echo "        companion LVGL riavviato sull'immagine nuova"
        else
            echo "    ATTENZIONE: companion LVGL non riavviato — resta sull'immagine" >&2
            echo "                precedente. Sul dispositivo, come utente user:" >&2
            echo "                systemctl --user restart sws-lvgl-viewer.service" >&2
        fi
    fi

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

# ── Il browser del pannello Pixsys punta al viewer SWS ────────────────────────
#
# `chromium-start main-app` legge l'URL da D-Bus, quindi è lì che va scritto.
# Senza, il pannello mostra la pagina di configurazione (9443): è il valore di
# fabbrica, e un factory reset ce lo riporta.
#
# STA QUI, PRIMA DELL'ATTESA, e non dentro il ramo «/health ha risposto» dove
# stava: l'indirizzo a cui puntare il browser non dipende dal fatto che il
# runtime abbia risposto entro trenta secondi. Nel ramo vecchio, qualunque
# intoppo nell'attesa si portava via anche questo — senza dirlo.
#
# E NON E' PIU' MUTO: prima era un `if` senza `else` con gli errori buttati in
# /dev/null, quindi un SetUrl rifiutato (permessi, utente sbagliato, D-Bus
# assente) era indistinguibile da un successo. Il 2026-09-07 il maintainer ha
# installato il container e ha trovato il pannello ancora su Cockpit: GetUrl
# rispondeva 9443, cioè il valore di fabbrica — la chiamata non era mai andata
# a buon fine, e nel log dell'installazione non c'era una riga a dirlo.
URL_VIEWER="http://127.0.0.1:8443"
if ! command -v busctl >/dev/null 2>&1; then
    echo "    browser del pannello: busctl assente, non è un dispositivo Pixsys — salto"
elif ERR_URL="$(busctl --system call net.pixsys.Config1 /net/pixsys/Config1/WebBrowser/MainApp \
        net.pixsys.Config1.WebBrowser SetUrl s "$URL_VIEWER" 2>&1)"; then
    echo "    browser del pannello puntato su $URL_VIEWER"
else
    echo "    ATTENZIONE: non ho potuto puntare il browser del pannello su $URL_VIEWER" >&2
    echo "                ${ERR_URL:-(nessun messaggio)}" >&2
    echo "                Il runtime funziona e resta raggiungibile dalla rete, ma sullo" >&2
    echo "                schermo del pannello resta la pagina di prima. Sul dispositivo:" >&2
    echo "                busctl --system call net.pixsys.Config1 \\" >&2
    echo "                    /net/pixsys/Config1/WebBrowser/MainApp \\" >&2
    echo "                    net.pixsys.Config1.WebBrowser SetUrl s \"$URL_VIEWER\"" >&2
fi

for i in $(seq 1 30); do
    # Anche HTTPS: il container parte in HTTP finché non c'è un certificato in
    # config/, ma su un aggiornamento sopra una config che il TLS ce l'ha già
    # riparte in HTTPS — e un controllo solo-HTTP fallirebbe per trenta secondi
    # per poi dichiarare «il runtime non risponde» su un'installazione riuscita.
    # Stesso ragionamento (e stesso ordine) dell'health check in packaging.rs.
    if curl -fs --max-time 2 http://localhost:8443/health >/dev/null 2>&1 \
       || curl -sk --max-time 2 https://localhost:8443/health >/dev/null 2>&1; then
        echo "    /health ok dopo ${i}s"

        # Ricaricare il browser, altrimenti l'URL nuovo non lo vede nessuno.
        #
        # `chromium-start main-app` legge l'URL da D-Bus **all'avvio**: se il
        # browser sta già girando — e dopo un factory reset gira, sulla pagina
        # di configurazione — resta lì, e l'installazione sembra non aver
        # funzionato mentre e' perfettamente riuscita. Vale anche per gli
        # aggiornamenti: una SPA già caricata resta quella finché il browser non
        # riparte (docs/TEST_SETUPS.md).
        #
        # L'URL l'ha impostato la sezione prima dell'attesa; il ricaricamento
        # sta qui, nel ramo del successo, di proposito: si ricarica quando c'è
        # qualcosa da mostrare, altrimenti il pannello sbatte su un errore.
        #
        # E solo se il browser è GIÀ attivo: tenendo premuto STOP all'accensione
        # il launcher apre Cockpit su `chromium@wp-control.service` e non
        # raggiunge mai `desktop.target`. Avviare noi `main-app` coprirebbe la
        # via di fuga con cui si sistema un dispositivo mal configurato: chi
        # decide è il launcher. Niente sudo, lo concede la regola polkit
        # 17-chromium.rules (la stessa che concede al runtime la commutazione).
        if systemctl is-active --quiet chromium@main-app.service 2>/dev/null; then
            if systemctl restart chromium@main-app.service 2>/dev/null; then
                echo "    browser del pannello ricaricato sul nuovo URL"
            else
                echo "    ATTENZIONE: URL impostato ma browser non ricaricato — il pannello" >&2
                echo "                mostra ancora la pagina di prima. Sul dispositivo:" >&2
                echo "                systemctl restart chromium@main-app.service" >&2
            fi
        else
            # Non si indovina la causa. La prima stesura scriveva «(modalità
            # configurazione?)» e il 2026-09-08 ha sviato: il browser era
            # inattivo perché il progetto è LVGL e PixsysOS 2.1.0 lo tiene
            # DISABILITATO apposta — configurazione giusta, non un guasto. Un
            # messaggio che tira a indovinare manda a cercare dalla parte
            # sbagliata, e costa più del silenzio.
            if curl -fs --max-time 2 http://localhost:8443/api/system 2>/dev/null | grep -q '"voluto":"lvgl"'; then
                echo "    browser del pannello non attivo: giusto così, il progetto è LVGL"
                echo "                (lo schermo lo prende sws-lvgl-viewer)"
            else
                echo "    browser del pannello non attivo: non lo tocco." >&2
                echo "                Se lo schermo resta nero, sul dispositivo COME UTENTE user:" >&2
                echo "                  systemctl status desktop.target" >&2
                echo "                  systemctl --user status sws-lvgl-viewer" >&2
            fi
        fi

        # Com'è andata la commutazione dello schermo: la fa il runtime (Fase 4),
        # e la dice in `/api/system`. Si aspetta un poco, perché il runtime
        # attende che il launcher si decida.
        ESITO=""
        for _ in $(seq 1 15); do
            ESITO="$(curl -fs --max-time 2 http://localhost:8443/api/system 2>/dev/null \
                | python3 -c 'import json,sys; d=json.load(sys.stdin).get("display") or {}; m=d.get("messaggio"); print(d.get("esito","") + (" — " + m if m else ""))' 2>/dev/null || true)"
            case "$ESITO" in "") sleep 2 ;; *) break ;; esac
        done
        case "$ESITO" in
            "") echo "    commutazione web/LVGL: il runtime non ha ancora detto niente (vedi Configurazione → Istanza → Device → Connessione)" ;;
            web*|lvgl*) echo "    commutazione web/LVGL: $ESITO" ;;
            *) echo "    ATTENZIONE: commutazione web/LVGL: $ESITO" >&2 ;;
        esac
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
