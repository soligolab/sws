#!/usr/bin/env bash
#
# Installa sul launcher Pixsys l'immagine di boot che il progetto abilita (T-72 F5).
#
# COSA FA
#
# Legge la richiesta che il runtime ha scritto in `boot-image/` — `trigger` (lo
# SHA-256 del PNG, o `none`) e `boot.png` — e la porta al launcher del pannello
# via D-Bus (`net.pixsys.Config1.Launcher.SetBackgroundImage`). Poi scrive
# `boot-image/status`: è il **primo file scritto dall'host che il runtime
# legge**, ed è ciò che l'IDE mostra nella scheda Runtime.
#
# PERCHÉ UNO SCRIPT E NON UNA CHIAMATA DAL RUNTIME
#
# Come per `sws-display-apply.sh`: il runtime gira in un container rootless e non
# può parlare col D-Bus dell'host. Scrive cosa vuole; questo lo applica.
#
# LE TRE COSE CHE NON SONO OVVIE (misurate sul WP630 il 2026-09-19, PixsysOS 2.1.1)
#
# 1. **Percorso.** `SetBackgroundImage` è pensato per un percorso *relativo al
#    mount USB* (`/run/media`). Con un percorso assoluto funziona lo stesso, ma
#    per un difetto: `PathBuf::push` di Rust, con un assoluto, sostituisce tutto
#    invece di concatenare. È comportamento non voluto — se Pixsys normalizza
#    l'input, la via assoluta smette di funzionare senza preavviso. Quindi: se
#    `/run/media` è scrivibile si copia lì e si passa il relativo; altrimenti si
#    ripiega sull'assoluto e **lo si dice** in `status` (`percorso=assoluto`).
#    Sul WP630 `/run/media` è di root, `user` non ci scrive: lì il ripiego è il
#    caso normale, non l'eccezione.
# 2. **Il nome del file resta.** Il launcher copia in
#    `/etc/pixsys/pixsys-launcher/assets/<nome originale>` e lo scrive nel TOML.
#    Per questo il PNG si chiama sempre `boot.png`, e la verifica confronta
#    `GetBackgroundImage` (che restituisce solo il nome del file) con quello.
# 3. **Non ha effetto immediato**: il launcher legge il TOML all'avvio. Questo
#    script NON riavvia niente — l'immagine compare al prossimo avvio del
#    pannello, e `status` lo dice.
#
# `none` NON è «ripristina l'originale»: è «il progetto non ha niente da
# installare», e non si tocca l'immagine che il dispositivo ha già. Il ripristino
# (`ResetBackgroundImage`) sarà un'azione esplicita.
#
# Uso:
#   sws-boot-image-apply.sh              applica la richiesta corrente
#   sws-boot-image-apply.sh --dry-run    dice cosa farebbe (solo letture D-Bus)
#   sws-boot-image-apply.sh --force      reinstalla anche se lo SHA è già applicato
set -euo pipefail

DIR="${SWS_BOOT_IMAGE_DIR:-/data/user/sws/config/boot-image}"
MEDIA="${SWS_MEDIA_DIR:-/run/media}"
BUSCTL="${SWS_BUSCTL:-busctl}"
TRIGGER="$DIR/trigger"
PNG="$DIR/boot.png"
STATO="$DIR/status"
APPLICATO="$DIR/applied"
DRY=0
FORCE=0
for a in "$@"; do
    case "$a" in
        --dry-run) DRY=1 ;;
        --force)   FORCE=1 ;;
        *) echo "uso: $0 [--dry-run] [--force]" >&2; exit 2 ;;
    esac
done

log() { printf '[sws-boot-image] %s\n' "$*"; }

# Scrive `status` in modo atomico: il runtime lo legge quando vuole, e un file
# a metà darebbe uno stato inventato.
#   scrivi_stato <esito> [sha256] [percorso] [messaggio]
scrivi_stato() {
    [ "$DRY" = 1 ] && { log "farei: status esito=$1 ${2:+sha256=$2} ${3:+percorso=$3} ${4:+($4)}"; return 0; }
    mkdir -p "$DIR"
    local tmp
    tmp="$(mktemp "$DIR/.status.XXXXXX")"
    {
        printf 'esito=%s\n' "$1"
        printf 'sha256=%s\n' "${2:-}"
        printf 'quando=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'percorso=%s\n' "${3:-}"
        printf 'messaggio=%s\n' "${4:-}"
    } > "$tmp"
    chmod 0644 "$tmp"
    mv -f "$tmp" "$STATO"
}

launcher() {
    "$BUSCTL" --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
        net.pixsys.Config1.Launcher "$@"
}

[ -f "$TRIGGER" ] || { log "nessuna richiesta del runtime: niente da fare"; exit 0; }
voluto="$(tr -d '[:space:]' < "$TRIGGER")"

if [ "$voluto" = "none" ]; then
    scrivi_stato nessuna_immagine "" "" "il progetto non abilita nessuna immagine di boot: non tocco quella del dispositivo"
    log "il progetto non abilita nessuna immagine di boot"
    exit 0
fi

# Già installata? Lo SHA applicato è ricordato a parte: il file `status` lo scrive
# anche in caso di errore, e non basta a dire «questo l'ho già fatto».
if [ "$FORCE" = 0 ] && [ -f "$APPLICATO" ] && [ "$(tr -d '[:space:]' < "$APPLICATO")" = "$voluto" ]; then
    log "immagine ${voluto:0:12} già installata: niente da fare"
    exit 0
fi

if [ ! -f "$PNG" ]; then
    scrivi_stato errore "$voluto" "" "manca $PNG"
    log "ERRORE: manca $PNG"
    exit 0
fi
sha_file="$(sha256sum "$PNG" | cut -d' ' -f1)"
if [ "$sha_file" != "$voluto" ]; then
    # Il runtime scrive il PNG **prima** del trigger, quindi non dovrebbe capitare;
    # se capita, il prossimo scatto (l'altro file sta per cambiare) rimette a posto.
    scrivi_stato errore "$voluto" "" "boot.png ($sha_file) non è quello richiesto ($voluto)"
    log "ERRORE: boot.png non corrisponde alla richiesta"
    exit 0
fi

# Questo dispositivo ha il launcher Pixsys? Lo si accerta con una LETTURA:
# provare con `Set` vorrebbe dire scoprirlo scrivendo.
if ! command -v "$BUSCTL" >/dev/null 2>&1 || ! launcher GetBackgroundImage >/dev/null 2>&1; then
    scrivi_stato non_supportato "$voluto" "" "questo dispositivo non espone net.pixsys.Config1.Launcher"
    log "non supportato: nessun launcher Pixsys su questo dispositivo"
    exit 0
fi

percorso=assoluto
arg="$PNG"
if [ -d "$MEDIA" ] && [ -w "$MEDIA" ]; then
    if [ "$DRY" = 1 ]; then
        log "farei: copia in $MEDIA/sws-boot/boot.png e passo il percorso relativo"
        percorso=relativo; arg="sws-boot/boot.png"
    elif mkdir -p "$MEDIA/sws-boot" && cp -f "$PNG" "$MEDIA/sws-boot/boot.png"; then
        percorso=relativo; arg="sws-boot/boot.png"
    fi
fi

if [ "$DRY" = 1 ]; then
    log "farei: SetBackgroundImage s \"$arg\" (percorso $percorso), poi GetBackgroundImage"
    exit 0
fi

if ! err="$(launcher SetBackgroundImage s "$arg" 2>&1)"; then
    scrivi_stato errore "$voluto" "$percorso" "SetBackgroundImage fallita: $err"
    log "ERRORE: SetBackgroundImage fallita: $err"
    exit 0
fi

# Verifica: GetBackgroundImage restituisce SOLO il nome del file (`s "boot.png"`).
letto="$(launcher GetBackgroundImage 2>/dev/null | sed -n 's/^s "\(.*\)"$/\1/p')"
if [ "$letto" != "boot.png" ]; then
    scrivi_stato errore "$voluto" "$percorso" "il launcher risponde «${letto:-nulla}» invece di boot.png"
    log "ERRORE: il launcher risponde '${letto:-}' invece di boot.png"
    exit 0
fi

printf '%s\n' "$voluto" > "$APPLICATO"
if [ "$percorso" = assoluto ]; then
    msg="compare al prossimo avvio del pannello (percorso assoluto: si appoggia a un comportamento non documentato del launcher)"
else
    msg="compare al prossimo avvio del pannello"
fi
scrivi_stato installato "$voluto" "$percorso" "$msg"
log "installata ${voluto:0:12} (percorso $percorso): $msg"
