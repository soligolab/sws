# Immagine di boot: oggetti non statici «congelati» in una foto

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **decisione**.

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## L'idea

Una pagina di boot ammette solo sette oggetti vettoriali statici (`BOOT_TYPES`: rect, ellipse, line, pipe, text,
image, symbol). Il maintainer ha rimandato a una seconda fase i widget «congelati»: un trend, un indicatore, una
tabella fotografati con i dati di un momento, per un'immagine di boot che assomigli all'interfaccia.

## Cosa è stato misurato (18-09-2026)

Il canvas è un solo `<svg>`, ma metà della palette è `<foreignObject>` o `<canvas>` (testo con `text_wrap`,
slider, setpoint, checkbox, radio, tabella, trend, text_list, data_log, kpi_tile, sparkline, allarmi, ricette): il
rasterizzatore attuale (`sws-editor/src/boot/rasterizza.ts`, che serializza l'SVG e lo disegna in un
`<canvas>`) **non li rende**, perché un SVG caricato in un `<img>` non porta con sé `<foreignObject>` in modo
affidabile né i `<canvas>`.

## Opzioni visibili

- **Rasterizzare la pagina con il DOM** (`html-to-image`-like o `getDisplayMedia`/`drawWindow`): fedele ma
  aggiunge una dipendenza, e il progetto tratta le dipendenze come una superficie CRA.
- **Un widget «foto»**: un oggetto che, al salvataggio, si trasforma in `image` con la resa del momento.
- **Restare sul vettoriale statico**: la scelta di adesso, dichiarata.

Da decidere quanto valga la fedeltà rispetto a una dipendenza in più.

