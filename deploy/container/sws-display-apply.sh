#!/usr/bin/env bash
#
# Manda a schermo il motore che il progetto chiede (Q25).
#
# COSA FA
#
# Legge `display-target` — il file in cui il runtime scrive `web` o `lvgl`,
# derivandolo da `target.kind` del progetto — e fa in modo che a schermo ci sia
# quello, e **solo** quello.
#
# PERCHÉ ESISTE UNO SCRIPT E NON UNA RIGA DI UNIT
#
# Il runtime gira in un container rootless e non può parlare col systemd
# dell'host, dove vivono il browser (`chromium@main-app.service`, unit dell'OS
# Pixsys) e il container del viewer. Quindi il runtime scrive cosa vuole, e
# questo script — che sull'host ci sta — lo applica.
#
# UNA COSA CHE NON È OVVIA
#
# Prima che questo esistesse, browser e viewer LVGL non si escludevano affatto:
# si **sovrapponevano**. Erano due finestre sullo stesso compositore Weston, e
# quella del viewer stava sopra. Non c'era un meccanismo di esclusione da
# migliorare — non ce n'era proprio uno.
#
# Uso:
#   sws-display-apply.sh              applica ciò che dice il file
#   sws-display-apply.sh --dry-run    dice cosa farebbe, senza toccare niente
set -euo pipefail

FILE="${SWS_DISPLAY_TARGET_FILE:-/data/user/sws/config/display-target}"
BROWSER_UNIT="${SWS_BROWSER_UNIT:-chromium@main-app.service}"
VIEWER_UNIT="${SWS_VIEWER_UNIT:-sws-lvgl-viewer.service}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

log() { printf '[sws-display] %s\n' "$*"; }

# Il browser è una unit di **sistema**, il viewer una unit **utente**: due
# comandi diversi, e confonderli dà "unit not found" invece di un errore che si
# capisce. L'utente `user` può comandare la unit di sistema senza sudo —
# verificato sul WP630 il 2026-08-27, polkit lo consente.
browser() { [ "$DRY" = 1 ] && { log "farei: systemctl $1 $BROWSER_UNIT"; return 0; }; systemctl "$1" "$BROWSER_UNIT"; }
viewer()  { [ "$DRY" = 1 ] && { log "farei: systemctl --user $1 $VIEWER_UNIT"; return 0; }; systemctl --user "$1" "$VIEWER_UNIT"; }

browser_attivo() { systemctl is-active --quiet "$BROWSER_UNIT"; }

if [ ! -f "$FILE" ]; then
    # Nessun file: nessun progetto ha ancora detto la sua. Non si tocca niente —
    # spegnere qualcosa "perché non so" lascerebbe uno schermo nero senza che
    # nessuno l'abbia chiesto.
    log "$FILE non esiste ancora: nessuna commutazione, lascio lo schermo com'è"
    exit 0
fi

VOLUTO="$(tr -d '[:space:]' < "$FILE")"

case "$VOLUTO" in
    lvgl)
        log "il progetto chiede LVGL"
        browser stop
        viewer start
        ;;
    web)
        log "il progetto chiede il web"
        viewer stop
        # `|| true` non è distrazione: con `set -e` un `systemctl start` che
        # fallisce **termina lo script**, e il ripiego qui sotto — cioè
        # l'unica ragione per cui questo blocco esiste — non verrebbe mai
        # eseguito. Trovato provando il caso di guasto sul WP630 il
        # 2026-08-27: senza questo, il caso da coprire era esattamente quello
        # che non veniva coperto.
        browser start || log "lo start del browser ha restituito errore"
        # Si dà al browser un istante per fallire davvero: `systemctl start`
        # torna quando il servizio è partito, non quando è stabile.
        sleep 2
        if [ "$DRY" = 0 ] && ! browser_attivo; then
            log "ATTENZIONE: il browser non è attivo dopo lo start — ripiego su LVGL"
            log "  il progetto chiedeva 'web': quello che vedi a schermo NON è quello che ha chiesto."
            log "  causa da cercare in: systemctl status $BROWSER_UNIT"
            viewer start
        fi
        ;;
    *)
        # Un valore che non si riconosce non è un motivo per spegnere lo
        # schermo: si dice e si lascia com'è. Il caso tipico è un file scritto a
        # mano male, o una versione futura del runtime che scrive un valore
        # nuovo a un dispositivo con questo script vecchio.
        log "valore non riconosciuto in $FILE: '$VOLUTO' (attesi 'web' o 'lvgl')"
        log "  lascio lo schermo com'è"
        exit 0
        ;;
esac

log "fatto: $VOLUTO"
