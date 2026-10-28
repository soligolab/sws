#!/usr/bin/env bash
#
# Lo schema http/https non si scrive a mano: lo decide il certificato.
#
# Perché. Il runtime parla in chiaro finché non esiste `config/tls.crt` e in TLS
# appena c'è (`sws-runtime/src/main.rs`, avvio del listener). Accendere il TLS è
# una cosa che si fa **oggi**, con un pulsante: la card «Certificato TLS» della
# scheda Device. Ma lo schema era scritto a mano in quattro posti che non si
# parlano, e nessuno dei quattro lo rileggeva dal certificato.
#
# Cosa succedeva, misurato il 23-10-2026 per la voce C4 del piano CRA:
#
#   1. Il controllo di salute delle due immagini chiedeva solo `http://`. Il
#      quadlet del runtime ha `Notify=healthy`: il servizio risulta avviato solo
#      quando quel comando passa. Chi accendeva il TLS non vedeva niente di
#      strano subito — `system_reboot` è un `exec()` in posto e systemd non vede
#      nessun riavvio — ma al primo riavvio vero l'unità non diventava mai sana,
#      e con `Restart=always`/`RestartSec=5` il pannello ripartiva ogni cinque
#      secondi. Un aggiornamento sarebbe tornato indietro da solo.
#   2. Il browser del pannello veniva puntato su `http://127.0.0.1:7443`, cioè
#      contro una porta che parla TLS: schermo su una pagina di errore.
#   3. L'installer stampava indirizzi in chiaro e due sonde su tre erano mute.
#   4. Il viewer LVGL sapeva ripiegare sulla porta dell'altra generazione ma non
#      sull'altro schema — e il suo quadlet, che dice `http://`, si riscrive solo
#      quando un operatore lo conferma.
#
# Nessuno di questi quattro cambia il comportamento di un pannello in chiaro:
# questa guardia tiene fermo che restino tutti e quattro capaci dei due casi.
#
# Uso: ./scripts/check_schema_tls.sh   (statica, nessuno stack)
set -uo pipefail
# Nota del 28-10-2026: le prove di contenuto qui sotto usano il confronto di
# bash (`case`), non `echo … | grep -q`. Quella forma, sotto `set -o pipefail`,
# e' **non deterministica**: `grep -q` esce al primo riscontro, `echo` si becca
# un SIGPIPE, e lo stato della pipeline diventa 141 — cioe' «non trovato» —
# anche quando il riscontro c'e'. Dipende da chi arriva prima, quindi la
# guardia fallisce una volta si' e una no. Successo su `check_quota_progetti`
# lo stesso giorno, due corse di fila che accusavano campi diversi.
cd "$(dirname "$0")/.."

male=0
ok() { if [ "$1" = 1 ]; then printf '  \033[32m✓\033[0m %s\n' "$2"; else printf '  \033[31m✗\033[0m %s\n' "$2"; male=1; fi; }

echo "== lo schema lo decide il certificato, non una costante =="

# ── 1. Il controllo di salute delle due immagini ────────────────────────────
for cf in deploy/container/Containerfile.aarch64 deploy/container/Containerfile.x86_64; do
    [ -f "$cf" ] || { ok 0 "manca $cf"; continue; }
    hc=$(sed -n '/^HEALTHCHECK/,/exit 1/p' "$cf")
    [ -n "$hc" ] || { ok 0 "$(basename "$cf"): nessun HEALTHCHECK — con Notify=healthy il servizio non si avvia più"; continue; }
    manca=""
    for p in 7443 7444 8444; do
        case "$hc" in *"https://localhost:$p/health"*) ;; *) manca="$manca https:$p" ;; esac
        case "$hc" in *"http://localhost:$p/health"*)  ;; *) manca="$manca http:$p"  ;; esac
    done
    if [ -n "$manca" ]; then
        ok 0 "$(basename "$cf"): il controllo di salute non prova$manca — con Notify=healthy il pannello entra in ciclo di riavvio"
    else
        ok 1 "$(basename "$cf"): il controllo di salute prova tutti e due gli schemi su tutte e tre le porte"
    fi
    # Senza `-k` un autofirmato fa fallire la sonda https, e torniamo al punto 1.
    case "$hc" in
        *'-fsk https'*) ok 1 "$(basename "$cf"): le sonde https usano -k (il certificato del pannello è autofirmato)" ;;
        *)              ok 0 "$(basename "$cf"): una sonda https senza -k rifiuta il certificato autofirmato del pannello" ;;
    esac
done

# ── 2. Il browser del pannello ──────────────────────────────────────────────
D=sws-runtime/crates/sws-web/src/display_target.rs
if grep -q 'config_dir.join("tls.crt").exists()' "$D"; then
    ok 1 "display_target: lo schema del browser viene dal certificato"
else
    ok 0 "display_target: lo schema del browser non guarda più tls.crt — su un pannello con TLS lo schermo resta su una pagina di errore"
fi
if grep -n 'SWS_VIEWER_URL' "$D" | grep -q 'http://'; then
    ok 0 "display_target: lo schema è tornato cablato nel ripiego di SWS_VIEWER_URL"
else
    ok 1 "display_target: nessuno schema cablato nel ripiego di SWS_VIEWER_URL"
fi

# ── 3. L'installer del container ────────────────────────────────────────────
I=deploy/container/install-container.sh
if grep -q 'if \[ -f "\$DATA/config/tls.crt" \]; then SCHEMA=https' "$I"; then
    ok 1 "install-container.sh: lo schema viene dal certificato sul disco"
else
    ok 0 "install-container.sh: lo schema non viene più da \$DATA/config/tls.crt"
fi
# Nessuna sonda deve tornare a conoscere un solo schema.
nude=$(grep -n 'curl .*http://localhost:74' "$I" | grep -v '^\s*#' || true)
if [ -n "$nude" ]; then
    ok 0 "install-container.sh: sonda con lo schema cablato — $(echo "$nude" | head -1)"
else
    ok 1 "install-container.sh: nessuna sonda con lo schema cablato (passano tutte da sonda())"
fi
grep -q '\$SCHEMA://\$a:7443' "$I" \
  && ok 1 "install-container.sh: gli indirizzi stampati seguono lo schema vero" \
  || ok 0 "install-container.sh: gli indirizzi stampati sono tornati cablati"

# ── 4. Il ripiego del viewer LVGL ───────────────────────────────────────────
V=sws-runtime/crates/sws-lvgl-viewer/src/main.rs
if grep -q 'fn ripieghi_di' "$V" && sed -n '/fn ripieghi_di/,/^}/p' "$V" | grep -q 'altro_schema'; then
    ok 1 "viewer LVGL: il ripiego prova anche l'altro schema, non solo l'altra porta"
else
    ok 0 "viewer LVGL: il ripiego non prova più l'altro schema — un pannello col quadlet vecchio e il TLS acceso resta nero"
fi

[ "$male" -eq 0 ] && echo -e "\033[32mi quattro punti sanno stare in chiaro e in TLS.\033[0m"
exit "$male"
