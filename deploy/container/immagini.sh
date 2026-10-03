#!/usr/bin/env bash
#
# Le immagini del runtime sul pannello, dopo un aggiornamento (03-10-2026, piano
# docs/archive/2026-10-03-pulizia-immagini-dopo-aggiornamento.md).
#
# Gira sull'HOST come utente del servizio, lanciato dal runtime con un servizio
# transitorio sul bus utente (come `install-container.sh --solo-unita`): dentro il
# container podman non c'è, e l'ID dell'immagine che gira si legge solo da qui.
# Scrive soltanto nella cartella config del runtime e, per `ritorna`, nei quadlet
# dell'utente e nei progetti — mai file di sistema.
#
#   immagini.sh stato    <config-host>
#       Registra l'immagine che gira. Se è diversa da quella registrata l'ultima
#       volta, quella diventa la «precedente»: così ci si accorge di un
#       aggiornamento da qualunque canale (registro o archivio). Scrive
#       <config>/immagini.json per il runtime.
#   immagini.sh pulisci  <config-host>
#       Toglie le immagini SWS che non sono né quella che gira né la precedente
#       né usate da un container, e l'istantanea dei dati. Esito in immagini.json.
#   immagini.sh ritorna  <config-host> <versione-scartata>
#       Torna alla precedente: ferma viewer e runtime, rimette config e progetti
#       dall'istantanea (se c'è), riporta l'immagine nel quadlet, riavvia.
#       Esito in <config>/ritorno.json.
#
# SWS_IMMAGINI_UNIT_DIR: cartella dei quadlet, per il test (tests/shell/immagini.sh).
set -uo pipefail

CMD="${1:-}"
CONF="${2:-}"
[ -n "$CMD" ] && [ -d "$CONF" ] || { echo "uso: $0 stato|pulisci|ritorna <cartella-config> [versione]" >&2; exit 2; }
CONF="${CONF%/}"
UNIT_DIR="${SWS_IMMAGINI_UNIT_DIR:-$HOME/.config/containers/systemd}"
QR="$UNIT_DIR/sws-runtime.container"
QV="$UNIT_DIR/sws-lvgl-viewer.container"
ETICHETTA="org.opencontainers.image.source=https://github.com/soligolab/sws"
STATO="$CONF/immagini.stato"
JSON="$CONF/immagini.json"
ISTA="$CONF/istantanea"

ora_ms() { echo $(( $(date +%s) * 1000 )); }
# Una stringa JSON: solo virgolette e barre vanno protette nei nomi d'immagine.
js() { local s="${1//\\/\\\\}"; printf '"%s"' "${s//\"/\\\"}"; }

attuale_id() { podman inspect sws-runtime --format '{{.Image}}' 2>/dev/null; }
# Gli ID (completi) delle immagini SWS, anche quelle rimaste senza nome.
immagini_sws() { podman images -a --no-trunc --filter "label=$ETICHETTA" --format '{{.ID}}' 2>/dev/null | sed 's/^sha256://' | sort -u; }
in_uso() { podman ps -a --format '{{.ImageID}}' 2>/dev/null; }
usata() {  # usata <id>: un container la usa?
    local id="$1" u
    for u in $(in_uso); do
        case "$id" in "$u"*) return 0 ;; esac
    done
    return 1
}
nomi() { podman image inspect "$1" --format '{{range .RepoTags}}{{.}} {{end}}' 2>/dev/null | sed 's/ *$//'; }
versione() { podman image inspect "$1" --format '{{index .Labels "org.opencontainers.image.version"}}' 2>/dev/null; }
byte() { podman image inspect "$1" --format '{{.Size}}' 2>/dev/null || echo 0; }
creata() { podman image inspect "$1" --format '{{.Created.Unix}}' 2>/dev/null || echo 0; }

leggi_stato() {
    S_ATTUALE=""; S_PRECEDENTE=""
    [ -f "$STATO" ] || return 0
    S_ATTUALE="$(sed -n 's/^attuale=//p' "$STATO")"
    S_PRECEDENTE="$(sed -n 's/^precedente=//p' "$STATO")"
}
scrivi_stato() { printf 'attuale=%s\nprecedente=%s\n' "$1" "$2" > "$STATO.tmp" && mv "$STATO.tmp" "$STATO"; }

descrivi() {  # descrivi <id>: l'oggetto JSON di un'immagine (o null)
    local id="$1"
    if [ -z "$id" ] || ! podman image exists "$id" 2>/dev/null; then echo null; return; fi
    printf '{"id":%s,"nomi":%s,"versione":%s,"byte":%s}' \
        "$(js "$id")" "$(js "$(nomi "$id")")" "$(js "$(versione "$id")")" "$(byte "$id")"
}

# Le immagini condividono gli strati: la somma delle loro dimensioni conta lo
# stesso spazio più volte (sul TC620, 3,78 GB contro gli 863 MB veri). Prima
# della pulizia si dice quante se ne toglierebbero; dopo, quanto spazio si è
# liberato davvero sul disco di podman.
libero() { df -B1 --output=avail "$(podman info --format '{{.Store.GraphRoot}}' 2>/dev/null || echo /)" 2>/dev/null | tail -1 | tr -d ' '; }

scrivi_json() {  # scrivi_json <attuale> <precedente> <pulizia-json>
    local att="$1" prec="$2" pul="$3" n=0 id
    for id in $(immagini_sws); do
        [ "$id" = "$att" ] || [ "$id" = "$prec" ] || usata "$id" || n=$(( n + 1 ))
    done
    printf '{"quando_ms":%s,"attuale":%s,"precedente":%s,"da_togliere":%s,"pulizia":%s}\n' \
        "$(ora_ms)" "$(descrivi "$att")" "$(descrivi "$prec")" "$n" "$pul" > "$JSON.tmp" && mv "$JSON.tmp" "$JSON"
}

cmd_stato() {
    local att; att="$(attuale_id)"
    [ -n "$att" ] || { echo "nessun container sws-runtime" >&2; exit 1; }
    leggi_stato
    local prec="$S_PRECEDENTE"
    if [ -n "$S_ATTUALE" ] && [ "$S_ATTUALE" != "$att" ]; then
        prec="$S_ATTUALE"                       # aggiornato: quella di prima è la precedente
    elif [ -z "$S_ATTUALE" ]; then
        # Prima volta: la precedente è la più recente fra le altre SWS.
        local id best="" t bt=0
        for id in $(immagini_sws); do
            [ "$id" = "$att" ] && continue
            t="$(creata "$id")"
            [ "$t" -gt "$bt" ] && { bt="$t"; best="$id"; }
        done
        prec="$best"
    fi
    # Una precedente sparita (tolta a mano) non è più una via di ritorno.
    [ -n "$prec" ] && ! podman image exists "$prec" 2>/dev/null && prec=""
    scrivi_stato "$att" "$prec"
    scrivi_json "$att" "$prec" null
    echo "stato: attuale $att, precedente ${prec:-nessuna}"
}

cmd_pulisci() {
    local att; att="$(attuale_id)"
    leggi_stato
    local prec="$S_PRECEDENTE" id tolte="" n=0 b prima dopo lib
    [ "$S_ATTUALE" = "$att" ] || prec="$S_ATTUALE"
    prima="$(libero)"
    for id in $(immagini_sws); do
        [ "$id" = "$att" ] || [ "$id" = "$prec" ] && continue
        usata "$id" && continue
        b="$(byte "$id")"
        local nm; nm="$(nomi "$id")"
        if podman rmi -f "$id" >/dev/null 2>&1; then
            n=$(( n + 1 ))
            tolte="$tolte${tolte:+,}{\"id\":$(js "$id"),\"nomi\":$(js "$nm"),\"byte\":$b}"
            echo "tolta $id ($nm)"
        fi
    done
    local ista=false
    if [ -d "$ISTA" ]; then rm -rf "$ISTA" && ista=true; fi
    dopo="$(libero)"
    lib=$(( ${dopo:-0} - ${prima:-0} )); [ "$lib" -lt 0 ] && lib=0
    scrivi_stato "$att" "$prec"
    scrivi_json "$att" "$prec" "{\"quando_ms\":$(ora_ms),\"tolte\":[$tolte],\"liberati_byte\":$lib,\"istantanea_tolta\":$ista}"
    echo "pulizia: $n immagini tolte, $lib byte; istantanea tolta: $ista"
}

# Rimette <da>/* in <a>/, entrata per entrata. Per ogni database si tolgono
# prima i -wal/-shm della versione nuova: applicati al file vecchio lo
# corromperebbero.
rimetti() {
    local da="$1" a="$2" e nome f
    mkdir -p "$a"
    for e in "$da"/* "$da"/.[!.]*; do
        [ -e "$e" ] || continue
        nome="$(basename "$e")"
        if [ -d "$e" ] && [ -d "$a/$nome" ] && [ "$nome" != history ]; then
            rimetti "$e" "$a/$nome"
            continue
        fi
        if [ "$nome" = history ] && [ -d "$a/history" ]; then
            # Lo storico: si sostituiscono i database dell'istantanea, gli altri
            # file (le copie «prima della pulizia») restano.
            for f in "$e"/*; do
                [ -e "$f" ] || continue
                rm -f "$a/history/$(basename "$f")" "$a/history/$(basename "$f")-wal" "$a/history/$(basename "$f")-shm"
                cp -a "$f" "$a/history/"
            done
            continue
        fi
        rm -rf "${a:?}/$nome" "$a/$nome-wal" "$a/$nome-shm"
        cp -a "$e" "$a/$nome"
    done
}

progetti_host() { sed -n 's/^Volume=\(.*\):\/var\/sws\/projects.*$/\1/p' "$QR" | head -1; }

cmd_ritorna() {
    local scartata="${3:-}" att prec img nuovo dati=false
    att="$(attuale_id)"
    leggi_stato
    prec="$S_PRECEDENTE"
    [ "$S_ATTUALE" = "$att" ] || prec="$S_ATTUALE"
    if [ -z "$prec" ] || ! podman image exists "$prec" 2>/dev/null; then
        printf '{"quando_ms":%s,"esito":"non_riuscito","motivo":"nessuna immagine precedente sul pannello","scartata":%s}\n' \
            "$(ora_ms)" "$(js "$scartata")" > "$CONF/ritorno.json"
        echo "ritorno impossibile: nessuna immagine precedente" >&2
        exit 1
    fi
    echo "==> fermo viewer e runtime"
    systemctl --user stop sws-lvgl-viewer.service sws-runtime.service || true

    if [ -d "$ISTA/config" ]; then
        echo "==> rimetto config e progetti dall'istantanea"
        rimetti "$ISTA/config" "$CONF"
        local ph; ph="$(progetti_host)"
        if [ -n "$ph" ] && [ -d "$ISTA/projects" ]; then
            rimetti "$ISTA/projects" "$ph"
        fi
        dati=true
    else
        echo "    nessuna istantanea: riporto solo l'immagine"
    fi

    img="$(sed -n 's/^Image=//p' "$QR" | head -1)"
    nuovo="$(nomi "$prec" | tr ' ' '\n' | grep '^localhost/' | head -1)"
    if [ -n "$nuovo" ]; then
        # Da archivio: il quadlet punta al nome della precedente.
        echo "==> quadlet: Image=$nuovo"
        for q in "$QR" "$QV"; do
            [ -f "$q" ] || continue
            sed -i "s|^Image=.*|Image=$nuovo|; s|^Environment=SWS_IMAGE=.*|Environment=SWS_IMAGE=$nuovo|" "$q"
        done
    else
        # Dal registro: il nome del canale torna sulla precedente.
        echo "==> podman tag $prec $img"
        podman tag "$prec" "$img"
    fi
    # Ora gira la precedente; quella scartata resta come «precedente» finché
    # qualcuno non pulisce.
    scrivi_stato "$prec" "$att"
    printf '{"quando_ms":%s,"esito":"riuscito","scartata":%s,"dati":%s}\n' \
        "$(ora_ms)" "$(js "$scartata")" "$dati" > "$CONF/ritorno.json"
    systemctl --user daemon-reload
    echo "==> riavvio il runtime"
    systemctl --user start sws-runtime.service
    echo "==> fatto."
}

case "$CMD" in
    stato)   cmd_stato ;;
    pulisci) cmd_pulisci ;;
    ritorna) cmd_ritorna "$@" ;;
    *) echo "comando sconosciuto: $CMD" >&2; exit 2 ;;
esac
