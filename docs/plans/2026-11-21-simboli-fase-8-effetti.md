# Editor dei simboli, fase 8 — gli effetti — piano

> Sessione di plan del 21-11-2026 (sera), gruppo 2, ultimo dopo la [fase 3](2026-11-21-simboli-fase-3-foto.md), la
> [fase 7](2026-11-21-simboli-fase-7-libreria-aziendale.md) e [P6](2026-11-21-p6-2fa-e-ldap.md). Piano madre:
> [editor dei simboli](2026-11-18-editor-dei-simboli.md), decisione 8 del 18-11: «effetti difficili in una fase loro,
> dopo».

Rami, uno per effetto, in quest'ordine (dal più economico sul pannello): **`feat/symbol-fx-glow`**,
**`feat/symbol-fx-bubbles`**, **`feat/symbol-fx-smoke`**, **`feat/symbol-fx-flame`**.

## Decisione del maintainer (21-11-2026)
Tutti e quattro: **bagliore (neon)**, **bollicine**, **fumo/vapore**, **fiamma**. La sfocatura, che era nell'elenco del
18-11, non è stata scelta: resta nel piano madre.

## Cosa si fa
- **Formato**: `kind` di parte nuovi nella descrizione `prj:` (`glow`, `bubbles`, `smoke`, `flame`), con geo (area,
  colore, intensità o velocità) e il collegamento all'ingresso come le parti di oggi (acceso/spento o per valore).
  Specchi: tipi TS, schema generato, valutatore condiviso con le sue fixture.
- **Web**: filtri SVG (`feGaussianBlur` per il bagliore), forme animate per bolle, fumo e fiamma. Animati solo con
  `!isEditMode || previewEffects` («Anteprima effetti» della toolbar) e rispettando `prefers-reduced-motion`.
- **LVGL**: il bagliore è uno strato già sfocato da resvg, mostrato o nascosto; le bolle sono pochi `lv_obj` con
  `lv_anim`; fumo e fiamma sono fotogrammi pre-disegnati, nel budget dei fotogrammi di `simbolo_lib.rs`.
- **Editor**: ogni effetto nel menù delle parti, con i suoi parametri e l'anteprima nella scheda Prova.
- **CasaDomotica**: la caldaia con la fiamma, il camino col fumo.

## Verifica
Per ogni ramo la definition of done di `CLAUDE.md`, `check_lvgl_parity` e una misura sul TY570 (tempo per fotogramma e
memoria, `SWS_TEMPI_LOG=1`, `VmRSS`; SSH solo chiedendo), poi `/test-changes`.
