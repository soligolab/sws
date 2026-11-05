#!/usr/bin/env bash
#
# ricarica.sh — mette una versione di SWS sul pannello di prova, da terminale.
#
# Fa quello che fa l'IDE in Configurazione → Istanza → Device → Installazione
# (`deploy_device_container` in sws-web/src/packaging.rs): copia in
# /tmp/sws-deploy i file di deploy/container/ che l'IDE spedisce, ci aggiunge
# l'archivio se l'immagine arriva da lì, e lancia install-container.sh.
#
# In più CONSERVA le scelte dell'installazione che c'è già — cartella dati,
# rete, cloud — leggendole dal quadlet come fa `--solo-unita`. L'IDE le chiede
# nel modulo; qui un modulo non c'è, e reinstallare senza ripeterle
# riaccenderebbe il cloud su un pannello installato con --senza-cloud.
#
# Uso:
#   ricarica.sh <utente@host> --stato                 # solo lettura: cosa gira adesso
#   ricarica.sh <utente@host> --versione 2.25.1       # immagine fissata, da ghcr.io
#   ricarica.sh <utente@host> --versione 2.26.0-rc.1
#   ricarica.sh <utente@host> --canale rc             # rc-<arch> | latest-<arch>
#   ricarica.sh <utente@host> --archivio dist/sws-runtime-2.25.1-aarch64-image.tar.gz
#
# Opzioni:
#   --con-openplc        passa --con-openplc all'installer
#   --prova              dice cosa lancerebbe sul pannello, senza copiare né installare
#   --qualunque-utente   installa anche se l'utente ssh non è `user`
#
# Uscita: 0 riuscito, 2 pannello non raggiungibile, 1 ogni altro errore.
#
# Per una release la strada normale NON è questa ma «Aggiorna ora» dall'IDE
# (HOWTO §19 e §21): tiene il canale e prende l'istantanea dei dati. Questo
# script reinstalla, e l'istantanea non la prende: dopo, «Torna alla …» non
# ha niente a cui tornare.
#
# Non fa mai ssh-copy-id né ssh-keygen -R: quelli li fa il maintainer
# (docs/TEST_SETUPS.md, «Procedura ricorrente del maintainer»). E usa
# StrictHostKeyChecking=accept-new, mai `no`: con `no` una chiave host CAMBIATA
# passa in silenzio se l'accesso è a chiave pubblica.

set -euo pipefail

REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
REGISTRY="ghcr.io/soligolab/sws-runtime"
REMOTE_DIR="/tmp/sws-deploy"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)

uso() { sed -n '15,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
errore() { echo "ERRORE: $*" >&2; exit 1; }

[ $# -ge 2 ] || { uso >&2; exit 1; }
TARGET="$1"; shift
case "$TARGET" in
    ?*@?*) ;;
    *) errore "il target va scritto utente@host (es. user@wp630-a-p3-07a077.local), trovato: $TARGET" ;;
esac
HOST="${TARGET#*@}"

AZIONE=""; VALORE=""; CON_OPENPLC=0; PROVA=0; QUALUNQUE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --stato)
            [ -z "$AZIONE" ] || errore "una sola fra --stato, --versione, --canale e --archivio"
            AZIONE=stato; shift ;;
        --versione|--canale|--archivio)
            [ -z "$AZIONE" ] || errore "una sola fra --stato, --versione, --canale e --archivio"
            [ $# -ge 2 ] || errore "$1 vuole un valore"
            AZIONE="${1#--}"; VALORE="$2"; shift 2 ;;
        --con-openplc)      CON_OPENPLC=1; shift ;;
        --prova)            PROVA=1; shift ;;
        --qualunque-utente) QUALUNQUE=1; shift ;;
        -h|--help)          uso; exit 0 ;;
        *) errore "argomento sconosciuto: $1" ;;
    esac
done
[ -n "$AZIONE" ] || errore "manca cosa fare: --stato, --versione, --canale o --archivio"

# ── Raggiungibilità ───────────────────────────────────────────────────────────
# Il messaggio di ssh dice già quale dei tre casi è: nome che non si risolve,
# chiave non installata, chiave host cambiata. Il rimedio lo dà il maintainer.
if ! err="$(ssh "${SSH_OPTS[@]}" "$TARGET" true 2>&1 >/dev/null)"; then
    echo "NON RAGGIUNGIBILE: ssh $TARGET"
    printf '    %s\n' "$err" | tail -3
    case "$err" in
        *"Could not resolve"*|*"Name or service not known"*)
            echo "    Il nome non si risolve: pannello spento, fuori rete, o mDNS muto."
            echo "    Il WP630 dell'ufficio si spegne la sera: dopo le 17:30 è normale." ;;
        *"IDENTIFICATION HAS CHANGED"*|*"Host key verification failed"*)
            echo "    La chiave host è cambiata (reset del pannello?). Tocca al maintainer:"
            echo "      ssh-keygen -f ~/.ssh/known_hosts -R $HOST"
            echo "      ssh-copy-id -i ~/.ssh/id_ed25519.pub $TARGET" ;;
        *"Permission denied"*)
            echo "    La chiave non è installata sul pannello. Tocca al maintainer:"
            echo "      ssh-copy-id -i ~/.ssh/id_ed25519.pub $TARGET" ;;
    esac
    exit 2
fi

# ── Sonda: cosa c'è sul pannello ──────────────────────────────────────────────
# Lo script viaggia su stdin (`sh -s`), come sonda-dispositivo.sh: nessun
# comando qui dentro deve leggere stdin, quindi `</dev/null` dove serve.
sonda() {
    ssh "${SSH_OPTS[@]}" "$TARGET" 'sh -s' <<'SONDA'
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
Q="$HOME/.config/containers/systemd/sws-runtime.container"
echo "utente=$(id -un)"
echo "arch=$(uname -m)"
if [ -f "$Q" ]; then echo "immagine=$(sed -n 's/^Image=//p' "$Q" | head -1)"; else echo "immagine="; fi
echo "versione=$(podman inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' sws-runtime 2>/dev/null </dev/null)"
echo "servizio=$(systemctl --user is-active sws-runtime 2>/dev/null </dev/null)"
if podman container exists openplc-runtime 2>/dev/null </dev/null; then echo "openplc=si"; else echo "openplc=no"; fi
if [ -f /etc/systemd/system/sws-runtime.service ]; then echo "nativo=si"; else echo "nativo=no"; fi
SONDA
}

STATO=""
val() { sed -n "/^$1=/{s/^$1=//p;q;}" <<<"$STATO"; }

canale_di() {
    case "$1" in
        "")              echo "nessun quadlet SWS per questo utente" ;;
        localhost/*)     echo "da archivio" ;;
        *:latest-*)      echo "canale stabile" ;;
        *:rc-*)          echo "canale di prova" ;;
        *)               echo "versione fissata" ;;
    esac
}

stampa_stato() {
    local img salute
    img="$(val immagine)"
    salute="$(curl -fsk --max-time 5 "https://$HOST:7443/health" 2>/dev/null || true)"
    echo "Target:     $TARGET"
    echo "Utente:     $(val utente)"
    echo "Arch:       $(val arch)"
    echo "Immagine:   ${img:--} ($(canale_di "$img"))"
    echo "Versione:   $(val versione)"
    echo "Servizio:   $(val servizio)"
    echo "OpenPLC:    $(val openplc)"
    [ "$(val nativo)" = no ] || echo "Nativo:     sì (/etc/systemd/system/sws-runtime.service)"
    echo "/health:    ${salute:-non risponde} (https://$HOST:7443)"
}

STATO="$(sonda)"

if [ "$AZIONE" = stato ]; then
    stampa_stato
    exit 0
fi

# ── Controlli prima di toccare il pannello ────────────────────────────────────
if [ "$(val utente)" != user ] && [ "$QUALUNQUE" -eq 0 ]; then
    errore "sui pannelli SWS gira come «user» (podman rootless); $(val utente) è un altro utente.
    Usa user@$HOST, oppure --qualunque-utente se su questa macchina l'utente giusto è davvero $(val utente)."
fi
if [ "$(val nativo)" = si ] && [ -z "$(val immagine)" ]; then
    errore "su $HOST c'è un'installazione NATIVA (binario + unit di sistema), non il container.
    Questo script non la tocca: il deploy nativo è scripts/yocto/deploy.sh, con pixsys e sudo."
fi
case "$(val arch)" in
    aarch64|arm64) SUFF=arm64; ARCH_ARCHIVIO=aarch64 ;;
    x86_64|amd64)  SUFF=amd64; ARCH_ARCHIVIO=x86_64 ;;
    *) errore "architettura non riconosciuta: $(val arch)" ;;
esac

# Il tag esiste in git ma l'immagine no: succede, e la versione non si può
# installare (CLAUDE.md, «Si tagga quando si costruisce»). Meglio saperlo qui
# che a metà installazione. Il registry elenca i tag senza credenziali.
verifica_tag() {
    local token tag
    token="$(curl -fsS --max-time 10 "https://ghcr.io/token?scope=repository:soligolab/sws-runtime:pull" 2>/dev/null \
        | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' || true)"
    if [ -z "$token" ]; then
        echo "    avviso: ghcr.io non risponde da qui, non posso verificare il tag $1: ci prova il pannello" >&2
        return 0
    fi
    tag="$(curl -fsS --max-time 15 -H "Authorization: Bearer $token" \
        "https://ghcr.io/v2/soligolab/sws-runtime/tags/list?n=1000" 2>/dev/null || true)"
    case "$tag" in
        *"\"$1\""*) return 0 ;;
    esac
    errore "il tag $1 non è su ghcr.io: la versione c'è in git ma la sua immagine non è mai stata costruita."
}

ARCHIVIO=""
case "$AZIONE" in
    versione)
        V="${VALORE#v}"
        [[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || errore "versione non valida: $VALORE"
        verifica_tag "$V-$SUFF"
        SORGENTE=(--pull "$REGISTRY:$V-$SUFF") ;;
    canale)
        case "$VALORE" in
            rc|prova)        T="rc-$SUFF" ;;
            latest|stabile)  T="latest-$SUFF" ;;
            *) errore "canale sconosciuto: $VALORE (rc oppure latest)" ;;
        esac
        SORGENTE=(--pull "$REGISTRY:$T") ;;
    archivio)
        [ -f "$VALORE" ] || errore "archivio non trovato: $VALORE"
        ARCHIVIO="$(basename "$VALORE")"
        [[ "$ARCHIVIO" =~ ^[A-Za-z0-9._-]+$ ]] || errore "nome d'archivio con caratteri non ammessi: $ARCHIVIO"
        case "$ARCHIVIO" in
            *-"$ARCH_ARCHIVIO"-image.tar.gz) ;;
            *) errore "$ARCHIVIO non è un'immagine $ARCH_ARCHIVIO, e il pannello è $(val arch)" ;;
        esac
        SORGENTE=(--image "$ARCHIVIO") ;;
esac
[ "$CON_OPENPLC" -eq 0 ] || SORGENTE+=(--con-openplc)

# I file da spedire sono quelli che l'IDE si porta dentro il binario: letti da
# lì, l'elenco non può divergere da quello dell'IDE.
mapfile -t FILE < <(grep -o 'include_str!("../../../../deploy/container/[^"]*")' \
    "$REPO/sws-runtime/crates/sws-web/src/packaging.rs" | sed 's|.*/||; s|")$||' | sort -u)
[ "${#FILE[@]}" -ge 2 ] || errore "non trovo l'elenco dei file di deploy in sws-web/src/packaging.rs"
PERCORSI=()
for f in "${FILE[@]}"; do
    [ -f "$REPO/deploy/container/$f" ] || errore "manca deploy/container/$f"
    PERCORSI+=("$REPO/deploy/container/$f")
done

echo "==> Prima:"
stampa_stato | sed 's/^/    /'

echo "==> Reinstallazione: nessuna istantanea dei dati, «Torna alla …» non sarà possibile."
[ "$AZIONE" != versione ] || echo "    --versione toglie il pannello dal suo canale: non vedrà più gli aggiornamenti."

if [ "$PROVA" -eq 0 ]; then
    echo "==> Copio ${#FILE[@]} file di deploy/container/ in $HOST:$REMOTE_DIR"
    ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p $REMOTE_DIR"
    scp -q "${SSH_OPTS[@]}" "${PERCORSI[@]}" "$TARGET:$REMOTE_DIR/"
    if [ -n "$ARCHIVIO" ]; then
        echo "==> Copio $ARCHIVIO ($(du -h "$VALORE" | cut -f1))"
        scp -q "${SSH_OPTS[@]}" "$VALORE" "$TARGET:$REMOTE_DIR/"
    fi
fi

# ── Installazione ─────────────────────────────────────────────────────────────
# Le scelte dell'installazione esistente si leggono SUL pannello, così il token
# di un tunnel configurato a mano non passa da questa macchina.
set +e
ssh "${SSH_OPTS[@]}" "$TARGET" sh -s -- "$PROVA" "$REMOTE_DIR" "${SORGENTE[@]}" <<'INSTALLA'
set -u
PROVA="$1"; DIR="$2"; shift 2
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
Q="$HOME/.config/containers/systemd/sws-runtime.container"
if [ -f "$Q" ]; then
    D="$(sed -n 's|^Volume=\(.*\)/config:/var/sws/config.*|\1|p' "$Q" | head -1)"
    if [ -n "$D" ] && [ "$D" != /data/user/sws ]; then set -- "$@" --data "$D"; fi
    grep -q '^Network=host' "$Q" || set -- "$@" --bridge
    if grep -q '^Environment=SWS_TUNNEL_URL=' "$Q"; then
        TU="$(sed -n 's/^Environment=SWS_TUNNEL_URL=//p' "$Q" | head -1)"
        TN="$(sed -n 's/^Environment=SWS_TUNNEL_NOME=//p' "$Q" | head -1)"
        TT="$(sed -n 's/^Environment=SWS_TUNNEL_TOKEN=//p' "$Q" | head -1)"
        if [ -z "$TU" ]; then set -- "$@" --senza-cloud
        elif [ -n "$TN" ]; then set -- "$@" --tunnel "$TU" --tunnel-nome "$TN" --tunnel-token "$TT"
        else set -- "$@" --tunnel "$TU"; fi
    fi
fi
echo "==> Sul pannello: ./install-container.sh $(printf '%s ' "$@" | sed 's/--tunnel-token [^ ]*/--tunnel-token ***/')"
[ "$PROVA" = 1 ] && { echo "    (--prova: non lancio niente)"; exit 0; }
cd "$DIR" && chmod +x install-container.sh && ./install-container.sh "$@" </dev/null
INSTALLA
rc=$?
set -e

[ "$PROVA" -eq 0 ] || exit 0
if [ "$rc" -ne 0 ]; then
    echo "INSTALLAZIONE NON RIUSCITA (exit $rc)." >&2
    [ -z "$ARCHIVIO" ] || echo "    L'archivio è rimasto in $HOST:$REMOTE_DIR/$ARCHIVIO (su alcuni pannelli /tmp è in RAM)." >&2
    exit 1
fi

# Come l'IDE: dopo `podman load` l'archivio non serve più, e sul TC620 /tmp è
# un tmpfs — 155 MB di RAM fino al riavvio.
[ -z "$ARCHIVIO" ] || ssh "${SSH_OPTS[@]}" "$TARGET" "rm -f -- $REMOTE_DIR/$ARCHIVIO"

STATO="$(sonda)"
echo "==> Dopo:"
stampa_stato | sed 's/^/    /'
if [ "$AZIONE" = versione ] && [ "$(val versione)" != "$V" ]; then
    echo "ATTENZIONE: il pannello dice $(val versione), non $V." >&2
    exit 1
fi
