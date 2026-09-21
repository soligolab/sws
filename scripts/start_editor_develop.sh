#!/usr/bin/env bash
#
# Avvia l'IDE SWS per **sviluppare**: identico a `start_editor.sh` in tutto,
# tranne che i progetti stanno dentro il checkout (`.run-editor/projects`) invece
# che in `~/sws_projects`.
#
# PERCHÉ ESISTONO DUE SCRIPT
#
# Fino al 18-09-2026 ce n'era uno solo, e imponeva la radice dentro il checkout.
# Comodo per sviluppare — i progetti di prova stanno accanto al codice e se ne
# vanno con la cartella `.run-*` — ma vuol dire che chi lancia `start_editor.sh`
# non vede mai il comportamento che vedrebbe un cliente, e infatti il maintainer
# si è visto proporre `/home/ut1/sws/.run-editor/projects` alla creazione di un
# progetto, ricordando di aver deciso il contrario. Le due esigenze sono
# entrambe legittime e sono due script, non un `if`:
#
#   ./scripts/start_editor.sh            corsa di produzione — come il cliente
#   ./scripts/start_editor_develop.sh    corsa di sviluppo — progetti nel repo
#
# **Non c'è logica duplicata**: questo file imposta una variabile d'ambiente e
# lascia fare all'altro. Due copie che differiscono per una riga divergono in un
# mese; una riga e un `exec` no.
#
# Uso: gli stessi argomenti di `start_editor.sh`.
#   ./scripts/start_editor_develop.sh
#   ./scripts/start_editor_develop.sh --instance 2 --no-spa
#
# Per lavorare sui progetti veri (fuori dal repo) senza cambiare script:
#   SWS_PROJECTS_ROOT=~/sws_projects ./scripts/start_editor_develop.sh
#
# Se `SWS_PROJECTS_ROOT` è già impostata, vince la tua: questo script non
# scavalca una scelta esplicita, la completa quando manca.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# La stessa regola per l'istanza che usa `start_editor.sh`: istanza 1 →
# `.run-editor`, le altre → `.run-editor-N`. Serve leggerla anche qui perché la
# radice dei progetti dipende dall'istanza, e l'ambiente si prepara prima di
# passare la mano.
INSTANCE=1
for ((i = 1; i <= $#; i++)); do
  if [ "${!i}" = "--instance" ]; then
    j=$((i + 1))
    [ "$j" -le "$#" ] && INSTANCE="${!j}"
  fi
done

if [ "$INSTANCE" -eq 1 ]; then
  RUN_DIR="$REPO_ROOT/.run-editor"
else
  RUN_DIR="$REPO_ROOT/.run-editor-$INSTANCE"
fi

export SWS_PROJECTS_ROOT="${SWS_PROJECTS_ROOT:-$RUN_DIR/projects}"
mkdir -p "$SWS_PROJECTS_ROOT"

echo "[develop] progetti in $SWS_PROJECTS_ROOT"
echo "[develop]   radice di SVILUPPO, dentro il checkout — non il default"
echo "[develop]   del runtime (~/sws_projects). Per la corsa di produzione:"
echo "[develop]   ./scripts/start_editor.sh"

exec "$REPO_ROOT/scripts/start_editor.sh" "$@"
