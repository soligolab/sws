# La 3D viva nel viewer web, solo per i dispositivi grossi

> Seme del 20-11-2026, dal maintainer, guardando three.js: «sarebbe usabile per i prodotti più grossi (quindi no LVGL
> e no TY) per mostrare il 3D per esempio di una stanza estendendo il generatore di planimetrie?».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita e dedicata**, per sviscerarne
> tutti i dettagli.

## L'idea
Una pagina del viewer web mostra la stanza o il capannone in 3D, vivo: la camera si gira col mouse o col dito, e la
scena segue i dati. Una zona si colora con lo stato dei suoi tag o di un allarme, una macchina cambia colore, un clic
su un oggetto apre il suo faceplate. Solo sui dispositivi che hanno un browser vero e la forza per farlo: PC, PC
industriali, il viewer nel cloud. Niente LVGL e niente TY.

Oggi la 3D c'è solo nell'IDE, e finisce in un'immagine.

## Cosa c'è nel codice (misurato il 20-11-2026)
- **three.js è già nell'IDE**: 0.170.0, in un pezzo suo caricato solo quando si apre la vista 3D di una planimetria
  (`import()` dinamico in `sws-editor/src/planimetrie/Vista3D.tsx`), 172 KB compressi. Licenza MIT.
- **La scena è già fatta di dati**: `planimetrie/scena.ts` costruisce muri, aperture, aree e blocchi come elenchi di
  forme; `Vista3D.tsx` li traduce in mesh. Il viewer potrebbe usare la stessa costruzione.
- **Il modello** sta in `planimetrie/<id>.yaml` nel progetto (`sws-editor/src/planimetrie/modello.ts`; lato server
  `sws-web/src/floor_plan.rs` e `planimetrie.rs`): viaggia già con deploy, backup ed export.
- **La scelta di allora**: il piano archiviato
  [planimetrie 3D](../../archive/2026-10-25-planimetrie-3d.md) (decisione 1 del 28-10-2026) dice «niente scena viva a
  runtime: web e LVGL ricevono la stessa immagine, zero peso». Questo seme la rimette in discussione, solo per il web.
- **Il progetto sa già per cosa è fatto**: `project.target.kind` è `web` o LVGL (`ProjectTargetKind` in
  `sws-core/src/project.rs`). Un progetto LVGL non vedrebbe nemmeno l'oggetto.
- **Il precedente delle cose solo web**: tre azioni dei pulsanti sono solo web, e il pannello LVGL le salta (T-59, il
  referto di compatibilità che deve dirlo).
- **Il rischio delle prestazioni è vero**: il 09-11-2026 una pagina di Montagna teneva il browser del WP630 al 96 % di
  un core (regola «un'anomalia che rovina l'uso passa davanti», `CLAUDE.md`). Un pannello col browser non è un PC.

## Le domande per la sessione di plan
1. **Che cos'è in pagina**: un oggetto nuovo («Scena 3D», legato a una planimetria) o una pagina intera in 3D?
2. **Cosa si lega ai dati**: colore e visibilità di aree e blocchi, allarmi, valori scritti sulla scena, clic che
   apre un faceplate o cambia pagina. Con gli stessi legami (`bindings`) degli altri oggetti?
3. **Gli oggetti 2D sopra la 3D**: restano possibili, e come stanno fermi quando la camera si muove?
4. **Su quali dispositivi**: chi decide se un dispositivo è «grosso»? Il target del progetto, una scelta per pagina, o
   una misura sul dispositivo (WebGL presente, fotogrammi al secondo)? E sul WP630 col browser?
5. **Il ripiego**: dove la 3D non c'è (LVGL, browser senza WebGL) si mostra il PNG di oggi, generato dalla stessa
   planimetria?
6. **WYSIWYG** (regole UI dell'editor): in modifica l'oggetto si vede come in esecuzione; con la camera salvata o
   libera?
7. **Il peso**: three.js solo nelle pagine che hanno l'oggetto; misure di memoria e CPU su un PC industriale e nel
   cloud.
8. **L'ordine**: prima l'editor di planimetrie completo (seme
   [planimetrie 3D, da bozza a strumento](2026-11-12-planimetrie-3d-complete.md)), poi la 3D viva? Senza una pianta
   fatta bene, la 3D viva mostra poco.
