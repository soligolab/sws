# Le planimetrie 3D, da bozza a strumento

> **Seme — decisione.** Nato il 12-11-2026, richiesta del maintainer: «riprendere il generatore di planimetrie 3d per
> completarlo, ora è poco più di una bozza». **Quando questo lavoro comincerà, il primo passo è una sessione di plan
> approfondita e dedicata** per sviscerarne tutti i dettagli: qui ci sono solo l'idea e le misure di oggi.

## L'idea

Il generatore di planimetrie è nato col piano archiviato
[Planimetrie: la pianta si disegna nell'IDE, la vista 3D diventa lo sfondo](../../archive/2026-10-25-planimetrie-3d.md).
I rami 1 e 2 sono fatti, il 3 (CasaDomotica) no. Per il maintainer oggi è «poco più di una bozza». Va reso uno
strumento con cui si disegna davvero la pianta di una casa o di un capannone, e se ne ricava uno sfondo che regge il
confronto con una foto.

## Le misure di oggi (12-11-2026)

- **Il codice.** L'editor sta in `sws-editor/src/planimetrie/` (`PlanimetriaEditor.tsx`, `Vista3D.tsx`, `modello.ts`,
  `scena.ts`): 1 299 righe in tutto. three.js 0.170.0 è in un pezzo suo, mai precaricato, 172 KB gzip.
- **Il modello.** `planimetrie/<id>.yaml` nel progetto; viaggia con export, deploy, backup e git.
- **Il risultato.** Un PNG fra le immagini del progetto (`planimetria-<id>.png`), che la pagina usa come sfondo
  (`sfondo_immagine`, composto da `sfondo_area` in `sws-runtime/crates/sws-web/src/cornici.rs`).
- **Quello che il piano archiviato aveva lasciato fuori di proposito:**
  - la scena 3D viva a runtime;
  - gli oggetti del sinottico proiettati dalla scena;
  - l'import di formati esterni (IFC, DXF);
  - più piani in una sola planimetria;
  - texture e materiali (solo colori pieni).
- **Mai fatto:** la planimetria vera di CasaDomotica (ramo 3) e la prova su un pannello LVGL. È anche il punto 4
  del piano [CasaDomotica col maintainer](../2026-11-10-casadomotica-col-maintainer.md).

## Da decidere nella sessione di plan

- **Cosa manca per dirlo «completo».** Va fatto un giro sull'editor di oggi col maintainer, elencando quello che non
  sa fare: arredi, quote, scale, più piani, materiali, luce, stile della resa.
- **Quali delle esclusioni del piano archiviato rientrano.**
- **Dove deve arrivare il risultato:** solo il web, o anche LVGL e i pannelli piccoli (peso dell'immagine,
  risoluzione).
- **Il collaudo:** la casa del maintainer come caso vero.
