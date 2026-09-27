# Lo specchio (`flip_h` / `flip_v`) sul pannello LVGL — seme

**Stato: seme — decisione.** Annotato il 26-09-2026 chiudendo la Fase D del piano
[`2026-09-26-pannello-luce-forme.md`](../archive/2026-09-26-pannello-luce-forme.md), che l'aveva escluso di proposito
(«non richiesto, da annotare come seme»).

> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in plan mode e
> senza scrivere codice, per sviscerarne ogni dettaglio.** Le misure qui sotto sono del 26-09-2026.

## Cosa si è visto

- Sul web lo specchio c'è per i 14 tipi di `SUPPORTS_TRANSFORM` (`applyTransform` in `SvgCanvas.tsx`:
  `scale(-1, 1)` / `scale(1, -1)` attorno al centro) e per il `polygon` (nei vertici).
- Su LVGL `flip_h`/`flip_v` sono nel modello (`model.rs`) ma **nessuno li legge**, come la rotazione fino
  al 26-09. La rotazione statica ora c'è (`apply_rotation_from`, layer di trasformazione di LVGL 8.3); il
  `polygon` e la polilinea specchiano già, perché lo fanno i vertici.
- LVGL 8.3 non ha uno specchio di stile: `transform_zoom` non accetta valori negativi. Le strade visibili
  oggi: specchiare le coordinate dei widget semplici (rect, ellipse), rasterizzare in un canvas e
  specchiare il buffer, o rinunciare per i widget con testo (un'etichetta specchiata è illeggibile, e
  forse nessuno la vuole davvero).

## Da decidere

1. Quali tipi hanno bisogno davvero dello specchio su un pannello (simboli e immagini sì, testi forse no)?
2. Con quale tecnica per ciascuno, e con quale guardia fotografica (come `check_forme_lvgl.sh`).
