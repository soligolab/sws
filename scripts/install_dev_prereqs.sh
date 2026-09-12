#!/usr/bin/env bash
#
# Prerequisiti nativi per compilare sws-runtime (workspace intero — sws-lvgl-viewer
# incluso, è nel workspace dal 2026-08-25 — e sws-pyscript). Richiede sudo.
#
# PERCHÉ ESISTE
#
# `docs/YOCTO_CROSSCOMPILE.md` punto 6 elenca già clang/libclang-dev/libsdl2-dev/
# libfreetype-dev come obbligatori, ma il 2026-09-12, su una macchina appena
# passata da Ubuntu a 26.04.1 LTS, sono stati scoperti mancanti uno alla volta
# con build fallite in sequenza (libsdl2-dev, poi libfreetype-dev, poi — causa
# diversa ma stesso sintomo — python3-dev) invece di leggere prima quel
# documento. Questo script raccoglie la lista in un posto solo, verificabile
# prima di iniziare a compilare invece che dopo.
#
# Un avanzamento di versione del sistema operativo toglie gli header/symlink
# "-dev", lasciando installate solo le librerie runtime — l'errore che ne
# segue è tardivo e indiretto (fallisce il link o la compilazione C dentro
# `cargo build`, non l'installazione di un pacchetto), quindi vale la pena
# rilanciare questo script dopo ogni avanzamento di versione, anche se sembra
# funzionare ancora tutto: il buco non si vede finché non si ricompila da zero.
#
# Uso: ./scripts/install_dev_prereqs.sh

set -euo pipefail

PACCHETTI=(
  clang            # bindgen (lvgl-sys, sws-lvgl-viewer/build.rs) carica libclang
  libclang-dev
  libsdl2-dev      # finestra di sviluppo desktop del viewer LVGL — non serve sul pannello, che usa DRM
  libfreetype-dev  # LV_USE_FREETYPE in lv_conf.h (lv_freetype.c vuole ft2build.h)
  python3-dev      # pyo3 (sws-pyscript) — metapacchetto: segue sempre la versione di `python3` di sistema
)

echo "Verifico ${#PACCHETTI[@]} pacchetti: ${PACCHETTI[*]}"

mancanti=()
for p in "${PACCHETTI[@]}"; do
  dpkg -s "$p" >/dev/null 2>&1 || mancanti+=("$p")
done

if [ ${#mancanti[@]} -eq 0 ]; then
  echo "✓ già tutti installati, niente da fare."
  exit 0
fi

echo "Mancano: ${mancanti[*]}"
echo "Installo con sudo — verrà chiesta la password se non già in cache."
sudo apt-get update
sudo apt-get install -y "${mancanti[@]}"
echo "✓ installati: ${mancanti[*]}"
