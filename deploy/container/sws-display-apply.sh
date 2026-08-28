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
# La unit che il launcher Pixsys avvia quando si tiene premuto STOP: mostra
# Cockpit sulla 9443. **Non va mai toccata** — è la via con cui si sistema un
# dispositivo mal configurato.
CONFIG_UNIT="${SWS_CONFIG_UNIT:-chromium@wp-control.service}"
# Il target che il launcher avvia in modalità normale, e **solo** in quella.
DESKTOP_UNIT="${SWS_DESKTOP_UNIT:-desktop.target}"
# Quanto aspettare che il launcher si sia deciso, prima di rinunciare.
ATTESA_MAX_S="${SWS_DISPLAY_WAIT_S:-60}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

log() { printf '[sws-display] %s\n' "$*"; }

# Il browser è una unit di **sistema**, il viewer una unit **utente**: due
# comandi diversi, e confonderli dà "unit not found" invece di un errore che si
# capisce. L'utente `user` può comandare la unit di sistema senza sudo —
# verificato sul WP630 il 2026-08-27, polkit lo consente.
#
# `"$@"` e non `"$1"`: i verbi possono essere più di una parola (`disable
# --now`), e con un solo argomento quotato systemctl riceve `disable --now`
# come **una** parola e risponde `Unknown command verb`. Il caso è sfuggito
# alla prova in secco, che la riga la stampa e basta: il dry-run mostrava il
# comando giusto e l'esecuzione vera falliva.
browser() { [ "$DRY" = 1 ] && { log "farei: systemctl $* $BROWSER_UNIT"; return 0; }; systemctl "$@" "$BROWSER_UNIT"; }
viewer()  { [ "$DRY" = 1 ] && { log "farei: systemctl --user $* $VIEWER_UNIT"; return 0; }; systemctl --user "$@" "$VIEWER_UNIT"; }

browser_attivo() { systemctl is-active --quiet "$BROWSER_UNIT"; }

# ── Accendere e spegnere il browser del pannello ─────────────────────────────
#
# La via giusta è **D-Bus**: `net.pixsys.Config1.WebBrowser.SetEnabled` dice al
# launcher Pixsys se abilitare il browser, e il launcher lo rilegge a ogni
# avvio. È una *politica*, non un comando: sopravvive al riavvio perché è il
# launcher stesso a rispettarla.
#
# Disponibile da **PixsysOS 2.1.0**. Sui firmware precedenti il metodo non
# esiste (`Unknown method` — misurato sul WP630 il 2026-08-28), e si ripiega su
# `systemctl disable/enable`, che la regola polkit `17-chromium.rules` concede
# all'utente.
#
# **Il ripiego è temporaneo e va tolto** quando 2.1.0 sarà su tutti i prodotti:
# è marcato `RIPIEGO` qui sotto perché si trovi cercando quella parola.
pixsys_browser() {
    busctl --system call net.pixsys.Config1 /net/pixsys/Config1/WebBrowser/MainApp \
        net.pixsys.Config1.WebBrowser "$@" >/dev/null 2>&1
}

# `SetEnabled` c'è su questo firmware?
#
# Si accerta con `GetEnabled`, che è una lettura e non cambia niente: provare
# direttamente con `SetEnabled` vorrebbe dire scoprirlo scrivendo.
politica_browser_disponibile() {
    command -v busctl >/dev/null 2>&1 && pixsys_browser GetEnabled
}

# Il browser non deve occupare lo schermo.
#
# Due passi distinti, e servono entrambi: la politica vale **dal prossimo
# avvio**, perché è il launcher a leggerla; per *questa* sessione il browser va
# comunque fermato.
browser_spegni() {
    if politica_browser_disponibile; then
        if [ "$DRY" = 1 ]; then
            log "farei: SetEnabled=false via D-Bus, poi stop del browser"
            return 0
        fi
        pixsys_browser SetEnabled b false \
            && log "browser disabilitato via D-Bus (il launcher lo rispetterà al prossimo avvio)" \
            || log "SetEnabled fallita: il browser potrebbe tornare al riavvio"
        browser stop
    else
        # RIPIEGO (PixsysOS < 2.1.0) — togliere quando 2.1.0 è ovunque.
        #
        # `disable --now` e non `stop`: senza `disable`, il symlink in
        # `desktop.target.wants` resta e al riavvio il browser torna su sotto la
        # finestra LVGL — un'intermittenza che si vede solo al riavvio.
        log "SetEnabled non disponibile (PixsysOS < 2.1.0): ripiego su systemctl disable"
        browser disable --now
    fi
}

# Il browser deve tornare a occupare lo schermo.
browser_accendi() {
    if politica_browser_disponibile; then
        if [ "$DRY" = 1 ]; then
            log "farei: SetEnabled=true via D-Bus, poi start del browser"
            return 0
        fi
        pixsys_browser SetEnabled b true \
            && log "browser riabilitato via D-Bus" \
            || log "SetEnabled fallita: il browser potrebbe non tornare al riavvio"
        browser start
    else
        # RIPIEGO (PixsysOS < 2.1.0) — togliere quando 2.1.0 è ovunque.
        log "SetEnabled non disponibile (PixsysOS < 2.1.0): ripiego su systemctl enable"
        browser enable --now
    fi
}

# Punta il browser Pixsys al viewer SWS.
#
# `chromium-start main-app` legge l'URL da D-Bus (`net.pixsys.Config1`) a ogni
# avvio, quindi è lì che va scritto e non in un file nostro. Polkit lo consente
# a chiunque (`net.pixsys.Config1.WebBrowser.MainApp`), niente sudo.
#
# Un fallimento non è fatale: il browser parte comunque, sulla pagina di prima.
# Peggio sarebbe non avviarlo affatto per un URL non impostato.
imposta_url_sws() {
    local url="${SWS_VIEWER_URL:-http://127.0.0.1:8443}"
    if [ "$DRY" = 1 ]; then
        log "farei: SetUrl del browser Pixsys a $url"
        return 0
    fi
    if busctl --system call net.pixsys.Config1 /net/pixsys/Config1/WebBrowser/MainApp \
        net.pixsys.Config1.WebBrowser SetUrl s "$url" >/dev/null 2>&1; then
        log "browser Pixsys puntato su $url"
    else
        log "non ho potuto impostare l'URL del browser: resta quello di prima"
    fi
}

# ── Il launcher Pixsys ha la precedenza ──────────────────────────────────────
#
# Tenendo premuta l'icona STOP durante l'avvio (angolo in alto a destra, per più
# di 10 s) il launcher apre Cockpit sulla 9443: è il modo con cui si sistema un
# dispositivo mal configurato — rete sbagliata, indirizzo irraggiungibile,
# applicazione che non parte.
#
# In quella modalità il launcher avvia **solo** `chromium@wp-control.service` e
# **non** raggiunge mai `desktop.target`. È questa la differenza che si osserva
# qui sotto, e regge perché è il launcher stesso a decidere quale unit avviare.
#
# Prima di questo controllo prendevamo lo schermo comunque, e la via di fuga
# era irraggiungibile: si teneva premuto STOP, compariva Cockpit, e un istante
# dopo la finestra LVGL ci finiva sopra.

in_configurazione() { systemctl is-active --quiet "$CONFIG_UNIT"; }
in_modalita_normale() { systemctl is-active --quiet "$DESKTOP_UNIT"; }

# Attende che il launcher si sia deciso.
#
# Serve perché al boot c'è una corsa: la sessione utente (che avvia questo
# script) può partire prima che `desktop.target` sia salito. Guardare una volta
# sola scambierebbe un avvio lento per una modalità configurazione, e il
# pannello resterebbe sul browser senza che nessuno l'abbia chiesto.
#
# Restituisce: 0 = modalità normale, 1 = configurazione, 2 = non si è capito.
attendi_decisione() {
    local i=0
    while [ "$i" -lt "$ATTESA_MAX_S" ]; do
        in_configurazione && return 1
        in_modalita_normale && return 0
        i=$((i + 1))
        sleep 1
    done
    return 2
}

case "$(attendi_decisione; echo $?)" in
    1)
        log "il launcher è in modalità configurazione ($CONFIG_UNIT attivo)"
        log "  lo schermo resta a Cockpit sulla 9443: non lo tocco."
        log "  il runtime SWS continua a girare — impianto, storico e allarmi non si fermano."
        exit 0
        ;;
    2)
        # Né l'una né l'altra dopo l'attesa. Non si tocca lo schermo: prendere
        # lo schermo "nel dubbio" è esattamente il difetto che questo controllo
        # esiste per correggere.
        log "ATTENZIONE: dopo ${ATTESA_MAX_S}s né $DESKTOP_UNIT né $CONFIG_UNIT sono attivi."
        log "  Non commuto niente. Se il pannello resta sulla schermata sbagliata,"
        log "  guarda: systemctl status $DESKTOP_UNIT"
        exit 0
        ;;
esac

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
        # Solo `chromium@main-app`: `chromium@wp-control` è la via alla
        # configurazione e non si tocca mai.
        browser_spegni
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
        # L'URL prima dello start: `chromium-start` lo legge da D-Bus a ogni
        # avvio, quindi impostarlo dopo vorrebbe dire un browser che parte sulla
        # pagina vecchia e ci resta fino al riavvio successivo.
        imposta_url_sws
        browser_accendi || log "l'accensione del browser ha restituito errore"
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
