#!/usr/bin/env bash
#
# Lancia tutte le guardie che NON richiedono uno stack in ascolto.
#
# PERCHÉ ESISTE
#
# Le guardie sono diciannove e nessuno le lanciava tutte: a fine sessione se ne
# ricordavano sei, per nome, a memoria. Una guardia che non viene lanciata è
# codice morto che dà l'illusione di una rete di sicurezza — peggio del non
# averla, perché ci si fida.
#
# Sei girano su file fermi (YAML, sorgenti, tabelle) e finiscono in pochi
# secondi: sono queste. Le altre tredici vogliono un runtime in ascolto, podman
# o un dispositivo, e restano da lanciare a mano quando lo stack c'è —
# `scripts/README.md` dice quale serve quando.
#
# LA PARTE CHE SI MANTIENE DA SOLA
#
# I due elenchi qui sotto coprono per forza tutti i `check_*.sh` presenti: se ne
# compare uno nuovo che non è in nessuno dei due, questo script **fallisce**.
# Così una guardia nuova non può restare fuori in silenzio — chi la scrive deve
# dire a quale gruppo appartiene. È la stessa idea delle guardie stesse.
#
# Uso:  ./scripts/check_static.sh     (esce != 0 se una qualsiasi fallisce)
set -uo pipefail
cd "$(dirname "$0")/.."

# Girano su file fermi: nessuna porta in ascolto, nessun dispositivo.
STATICHE=(
    check_lvgl_symbols      # tabella simboli vendored: viewer contro editor
    check_lvgl_types        # badge «L» della palette contro il motore
    check_lvgl_parity       # campi del modello contro quelli disegnati
    check_vendor_patches    # le patch al sorgente vendored sono ancora applicate
    check_templates         # tutti i template contro il runtime
    check_demo_templates    # i due gemelli "Demo Items" fra loro
    check_systemd_units     # trappole note nelle unit che spediamo
    check_synoptic_schema   # il vocabolario dato all'assistente IA contro le sue fonti
)

# Vogliono uno stack in ascolto, podman o un dispositivo: a mano, non qui.
# (Elencate perché il controllo di copertura sotto possa vederle.)
CON_STACK=(
    check_ack_reason check_database_mgmt check_deploy_preserve check_discover
    check_e2e check_f7 check_f76 check_f8 check_multiselect_drag
    check_project_write_safety check_spa_autoreload check_viewer_layout
    check_wysiwyg check_no_admin
)

# ── nessuna guardia resta fuori in silenzio ───────────────────────────────────
note=""
for f in scripts/check_*.sh; do
    n="$(basename "$f" .sh)"
    [ "$n" = "check_static" ] && continue
    if ! printf '%s\n' "${STATICHE[@]}" "${CON_STACK[@]}" | grep -qx "$n"; then
        note="$note $n"
    fi
done
if [ -n "$note" ]; then
    echo -e "\033[31m✗\033[0m guardie non classificate:$note"
    echo "    Aggiungile a STATICHE o a CON_STACK in $0 — una guardia che nessuno"
    echo "    lancia è codice morto che dà l'illusione di una rete di sicurezza."
    exit 1
fi

# ── e ora lanciale ────────────────────────────────────────────────────────────
falliti=()
for n in "${STATICHE[@]}"; do
    printf '\033[1m── %s ──\033[0m\n' "$n"
    if "./scripts/$n.sh"; then
        echo
    else
        echo -e "\033[31m   ($n è uscito con $?)\033[0m\n"
        falliti+=("$n")
    fi
done

echo "════════════════════════════════════════════════════════════════════"
if [ ${#falliti[@]} -gt 0 ]; then
    echo -e "\033[31m${#falliti[@]} guardie su ${#STATICHE[@]} fallite: ${falliti[*]}\033[0m"
    exit 1
fi
echo -e "\033[32mtutte e ${#STATICHE[@]} le guardie statiche verdi.\033[0m"
echo "    (le altre ${#CON_STACK[@]} vogliono uno stack in ascolto — vedi scripts/README.md)"
