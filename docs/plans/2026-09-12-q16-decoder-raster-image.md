# Q16 — Decoder raster per il widget `image` su LVGL

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q16) il 2026-09-12. Non ancora riverificato nel
> codice per questa sessione — la domanda risale al 2026-08-25/2026-09-06: rileggere la
> scheda originale e ricontrollare `lv_conf.h` prima di iniziare, un piano di settimane fa
> non è garantito accurato.

## Contesto

Il widget `image` su LVGL ha due metà, e solo una è fatta:

- **Metà SVG** (catalogo icone bundlato, `symbol_id`/URL SVG): **fatta e rilasciata in 2.3.0**
  — `resvg`+`tiny-skia`, rasterizzazione a runtime, stessa soluzione di Q15. Verificato che sia
  in `Cargo.toml` del viewer con un commento che lo dichiara.
- **Metà raster** (un URL che punta a un PNG/JPEG vero, che il campo testo libero del widget
  permette comunque): **ancora assente**. `lv_conf.h` aveva `LV_USE_PNG/BMP/SJPG/GIF` a 0
  l'ultima volta che è stato controllato (2026-09-06) — nessun decoder raster compilato nella
  LVGL vendorizzata.

## Cosa deciso, cosa resta

**Deciso**: nessuna decisione definitiva sulla metà raster — il default PoC era "non
supportato" (opzione C nella scheda originale), in attesa di un bisogno reale.

**Opzioni della scheda originale**:
1. Abilitare `LV_USE_PNG`/`LV_USE_SJPG` nel build C, scaricare i byte via HTTP lato viewer e
   scriverli in un file temporaneo (LVGL legge da filesystem). Aggiunge una dipendenza C nativa
   al build (verificare su entrambe le pipeline: generic/SDK, e ora anche il cross-build Q53).
2. Non supportato per ora (stato di fatto) — coerente con `symbol`/Q15 per i casi non coperti.

## Prima di scrivere codice

1. Rileggere `lv_conf.h` attuale (`sws-lvgl-viewer/lv_conf/lv_conf.h`) per confermare che
   `LV_USE_PNG`/`SJPG`/`BMP`/`GIF` siano ancora a 0 — potrebbe essere cambiato nel frattempo.
2. Chiedere al maintainer se è emerso un bisogno reale (un progetto con immagini raster vere,
   non solo il catalogo SVG) che giustifichi il costo di una dipendenza C nuova nel build.
3. Se sì: misurare il costo (dimensione binario, tempo di build sulle pipeline container) prima
   di committare, come fatto per `resvg` in Q15/Q16-SVG.

## File coinvolti (di massima)

`sws-lvgl-viewer/lv_conf/lv_conf.h`, `sws-lvgl-viewer/src/svg_assets.rs` (o un modulo affine per
il raster), eventualmente i Containerfile del cross-build (Q53) se serve una libreria C in più
nell'immagine builder.

## Verifica

`cargo check`/`test` sul viewer, una pagina di prova con un `image` che punta a un PNG vero,
confronto browser vs istantanea LVGL.
