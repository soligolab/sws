#!/usr/bin/env bash
#
# Lancia **tutte** le guardie, comprese quelle che vogliono uno stack acceso.
#
# PERCHÉ ESISTE
#
# `check_static.sh` lancia le guardie che girano su file fermi, ed è il gate di
# fine sessione. Le altre — quelle che avviano un runtime e guidano un browser —
# non le lancia nessuno: costano minuti, vogliono il binario di debug e la SPA
# costruita, e si finisce per lanciarne una o due, quelle che c'entrano col
# lavoro del giorno.
#
# Il 2026-09-05 ne sono state lanciate tutte, per la prima volta da mesi, e ne
# sono uscite **tre che non potevano passare in nessun checkout**:
#
#   * `check_viewer_layout` e `check_spa_autoreload` e `check_e2e` creavano un
#     progetto dal template `demo-items`, rinominato in due gemelli mesi prima;
#   * `check_discover` pretendeva di essere l'unico SWS sulla rete, e in ufficio
#     c'è un pannello vero che si annuncia.
#
# Nessuna di quelle rotture riguardava ciò che le guardie misurano, e nessuna
# aveva lasciato traccia: una rete di sicurezza che non può scattare non si
# distingue da una che non ha mai avuto motivo di scattare. Questo script è ciò
# che rende visibile la differenza.
#
# Non si chiama `check_*` di proposito: `check_static.sh` pretende che ogni
# `scripts/check_*.sh` sia classificato in uno dei suoi due elenchi, e un file
# che li lancia tutti finirebbe per lanciare se stesso.
#
# Uso:
#   cargo build -p sws-runtime      # da sws-runtime/
#   cd sws-editor && pnpm build
#   ./scripts/verifica_completa.sh              tutte
#   ./scripts/verifica_completa.sh --solo-stack solo quelle che vogliono lo stack
#
# Dura parecchi minuti. Serve un browser di Playwright (o SWS_E2E_CHROMIUM).
set -uo pipefail
cd "$(dirname "$0")/.."

SOLO_STACK=0
[ "${1:-}" = "--solo-stack" ] && SOLO_STACK=1

# Gli elenchi si leggono da `check_static.sh`: è lui la fonte, e lui fallisce se
# una guardia nuova non è classificata. Copiarli qui vorrebbe dire avere due
# elenchi che divergono — esattamente il difetto che metà delle guardie di
# questo repo esiste per impedire.
leggi_elenco() {
    # `tr` prima del filtro: `CON_STACK` mette più nomi sulla stessa riga, e
    # leggerne solo il primo faceva sembrare che le guardie con stack fossero
    # quattro invece di sedici — un errore che si nasconde bene, perché lo
    # script gira lo stesso e dichiara «tutte verdi» avendone saltate dodici.
    awk -v nome="$1" '$0 ~ "^"nome"=\\(" {f=1; next} f && /^\)/ {exit} f {print}' \
        scripts/check_static.sh | tr ' \t' '\n\n' | grep -E '^check_[a-z_0-9]+$' || true
}
mapfile -t STATICHE  < <(leggi_elenco STATICHE)
mapfile -t CON_STACK < <(leggi_elenco CON_STACK)

if [ ${#STATICHE[@]} -eq 0 ] || [ ${#CON_STACK[@]} -eq 0 ]; then
    echo -e "\033[31m✗\033[0m non riesco a leggere gli elenchi da scripts/check_static.sh"
    echo "    La forma delle dichiarazioni è cambiata: questo script non sta più"
    echo "    guardando niente, e va aggiornato — non è che le guardie siano sparite."
    exit 1
fi

DA_LANCIARE=()
[ "$SOLO_STACK" -eq 0 ] && DA_LANCIARE+=("${STATICHE[@]}")
DA_LANCIARE+=("${CON_STACK[@]}")

BIN="sws-runtime/target/debug/sws-runtime"
DIST="sws-editor/dist"
[ -x "$BIN" ]                   || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }
[ -f "$DIST/index-admin.html" ] || { echo "manca $DIST — esegui: cd sws-editor && pnpm build" >&2; exit 1; }

echo "════════════════════════════════════════════════════════════════════"
echo "  ${#DA_LANCIARE[@]} guardie — dura minuti, non secondi"
echo "════════════════════════════════════════════════════════════════════"

esiti=()
falliti=()
for n in "${DA_LANCIARE[@]}"; do
    printf '\n\033[1m── %s ──\033[0m\n' "$n"
    inizio=$SECONDS
    if timeout 1800 "./scripts/$n.sh" > "/tmp/$n.$$.log" 2>&1; then
        durata=$((SECONDS - inizio))
        printf '\033[32m   ✓\033[0m %ss\n' "$durata"
        esiti+=("✓ $n (${durata}s)")
    else
        rc=$?
        durata=$((SECONDS - inizio))
        printf '\033[31m   ✗ uscita %s dopo %ss\033[0m\n' "$rc" "$durata"
        # Le ultime righe sùbito, perché con venticinque guardie il log di
        # quella caduta finisce fuori schermo prima che si arrivi in fondo.
        tail -12 "/tmp/$n.$$.log" | sed 's/^/      /'
        esiti+=("✗ $n (uscita $rc)")
        falliti+=("$n")
    fi
    rm -f "/tmp/$n.$$.log"
done

echo
echo "════════════════════════════════════════════════════════════════════"
for e in "${esiti[@]}"; do echo "  $e"; done
echo "════════════════════════════════════════════════════════════════════"
if [ ${#falliti[@]} -gt 0 ]; then
    echo -e "\033[31m${#falliti[@]} su ${#DA_LANCIARE[@]} fallite: ${falliti[*]}\033[0m"
    exit 1
fi
echo -e "\033[32mtutte e ${#DA_LANCIARE[@]} verdi.\033[0m"
