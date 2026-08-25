#!/usr/bin/env bash
#
# Verifica che le correzioni in `patches/` siano ancora applicate al codice
# vendorizzato.
#
# PERCHÉ ESISTE
#
# Le librerie C di questo progetto (LVGL in testa) sono vendorizzate e tracciate
# da git. Quando una di esse ha un difetto, la correzione va applicata al codice
# vendorizzato — ma una re-importazione della libreria la cancella **senza dire
# niente**, e il difetto torna esattamente com'era. Quello di Q22 è costato due
# giorni: un crash non deterministico che sembrava specifico di un widget.
#
# Una patch che scade in silenzio è peggio della toppa che sostituisce, perché
# dà l'impressione che il problema sia chiuso. Questo script è ciò che le
# impedisce di scadere in silenzio: se una correzione non c'è più, **fallisce**,
# e dice quale e come rimetterla.
#
# Uso:
#   ./scripts/check_vendor_patches.sh          verifica (esce != 0 se manca qualcosa)
#   ./scripts/check_vendor_patches.sh --apply  riapplica le patch mancanti
#
# Da lanciare dopo ogni aggiornamento di una dipendenza vendorizzata, e prima di
# pubblicare un'immagine.
set -euo pipefail

cd "$(dirname "$0")/.."
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Ogni voce: <patch> | <file toccato> | <frammento che deve esserci se è applicata>
#
# Il frammento è il modo più diretto di dire "la correzione c'è": non dipende dai
# numeri di riga, che si spostano a ogni aggiornamento, e non richiede di tenere
# una copia del sorgente originale.
LVGL_CHART="sws-runtime/crates/sws-lvgl-viewer/vendor/lvgl-sys-0.6.2/vendor/lvgl/src/extra/widgets/chart/lv_chart.c"
PATCHES=(
  "patches/lvgl/0001-init-x_ext_buf_assigned.patch|$LVGL_CHART|ser->x_ext_buf_assigned = false;"
)

# Invalida la compilazione di lvgl-sys, che altrimenti riuserebbe gli oggetti C
# compilati prima della patch. Si tolgono le directory di build del crate per
# ogni target: `cargo clean -p` vorrebbe l'ambiente SDK giusto per il target
# cross, e qui non lo si può assumere.
invalidate_lvgl_build() {
  local base="sws-runtime/crates/sws-lvgl-viewer/target"
  local n=0
  [ -d "$base" ] || return 0
  while IFS= read -r d; do
    rm -rf "$d"
    n=$((n + 1))
  done < <(find "$base" -maxdepth 3 -type d -name 'lvgl-sys-*' 2>/dev/null)
  [ "$n" -gt 0 ] && printf '      (invalidati %d artefatti di lvgl-sys: senza questo cargo riuserebbe la libreria vecchia)\n' "$n"
  return 0
}

fail=0
applied=0
for entry in "${PATCHES[@]}"; do
  IFS='|' read -r patch target needle <<< "$entry"
  name="$(basename "$patch")"

  if [ ! -f "$patch" ]; then
    printf '  \033[31m✗\033[0m %s — la patch stessa non esiste\n' "$name"
    fail=1
    continue
  fi
  if [ ! -f "$target" ]; then
    printf '  \033[31m✗\033[0m %s — il file da correggere non esiste: %s\n' "$name" "$target"
    printf '      La libreria è stata spostata o rimossa: la patch va rifatta, non riapplicata.\n'
    fail=1
    continue
  fi

  if grep -qF -- "$needle" "$target"; then
    printf '  \033[32m✓\033[0m %s — applicata\n' "$name"
    continue
  fi

  if [ "$APPLY" -eq 1 ]; then
    if git apply "$patch" 2>/dev/null; then
      printf '  \033[33m→\033[0m %s — riapplicata adesso\n' "$name"
      applied=$((applied + 1))
      # Cargo NON si accorge da solo di questa modifica.
      #
      # Il build.rs di lvgl-sys dichiara `rerun-if-changed` solo per lv_conf.h
      # e lv_drv_conf.h — NON per i sorgenti C vendorizzati. Toccare lv_chart.c
      # non fa ricompilare niente: si ottiene un binario con la libreria
      # vecchia, identico a prima, senza un solo avviso.
      #
      # È il difetto che ha nascosto la correzione di Q22 per un giro di
      # deploy: patch applicata, ricompilato, crash identico — e la conclusione
      # sbagliata a portata di mano era "la patch non serve".
      invalidate_lvgl_build
    else
      printf '  \033[31m✗\033[0m %s — NON si applica più su questo sorgente\n' "$name"
      printf '      Il codice a monte è cambiato attorno alla correzione. Va rifatta a mano:\n'
      printf '      leggi la patch, ritrova il punto in %s e riscrivila.\n' "$target"
      fail=1
    fi
  else
    printf '  \033[31m✗\033[0m %s — NON applicata\n' "$name"
    printf '      Il difetto che correggeva è tornato. Riapplica con:\n'
    printf '        ./scripts/check_vendor_patches.sh --apply\n'
    fail=1
  fi
done

echo
if [ "$fail" -ne 0 ]; then
  printf '\033[31mVerifica delle patch fallita.\033[0m Non pubblicare immagini finché non è a posto.\n'
  exit 1
fi
if [ "$applied" -gt 0 ]; then
  printf '\033[33m%d patch riapplicate.\033[0m Ricompila e riprova sul dispositivo prima di fidarti.\n' "$applied"
  exit 0
fi
printf '\033[32mTutte le patch al codice vendorizzato sono applicate.\033[0m\n'
