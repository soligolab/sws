# Sfondi di pagina pesanti: avvisare, e quanti precaricarne

**Seme, nato il 13-11-2026** sul TY570. Richiesta del maintainer: «avvisare se si usano pagine con sfondi ad alta
risoluzione e far scegliere quanti sfondi precaricare».

**Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata per sviscerarne i dettagli.**

## Com'è oggi (13-11-2026)

- Sul Tiny TY (un core Cortex-A7) aprire una pagina con uno sfondo JPEG 1024×600 costava **1,6 s**: scaricare,
  decodificare (via resvg, il raster avvolto in un SVG), scalare e convertire nel formato di LVGL. Le pagine senza
  sfondo si aprono in 0,13-0,16 s. Misura dal log del viewer (`[sfondo] … pronto in N ms`).
- Dal commit `eedd8958` il viewer LVGL tiene in memoria gli **ultimi due** sfondi decodificati
  (`svg_assets::SFONDI`, `SFONDI_MAX = 2`): dalla seconda visita la pagina è immediata. Costo: 2,4 MB per sfondo a
  1024×600 (32 bit), anche mentre si guarda un'altra pagina. La prima visita resta lenta. Un deploy svuota la cache.
- Lo sfondo vive in `sfondo_immagine` della pagina (e `bg_image` di un rettangolo); il tetto è `MAX_SIDE_SFONDO`
  (4096 px per lato) in `svg_raster.rs`.

> **14-11-2026**: il punto «decodificare il JPEG direttamente alla misura giusta» è diventato il piano
> [sfondi alla misura](../../archive/2026-11-14-sfondi-alla-misura.md). Qui restano l'avviso e il precarico.

## L'idea

- **Avvisare nell'IDE** quando una pagina ha uno sfondo «pesante» per il pannello di destinazione: risoluzione più
  grande dello schermo (si scala a ogni apertura), formato costoso, troppi sfondi diversi nel progetto per la RAM del
  pannello. Dove: validazione del progetto (come gli altri avvisi), o accanto al campo dello sfondo.
- **Far scegliere quanti sfondi tenere/precaricare**, nel progetto (accanto a `pannello.fps`, luce e riposo): 0 = nessuna
  cache, N = gli ultimi N, «tutti all'avvio» = precarico (aperture sempre immediate, RAM per tutti).

## Da decidere nella sessione di plan

- Le soglie dell'avviso: per modello di pannello (RAM, CPU) o fisse; cosa dire e cosa proporre (ridimensionare
  l'immagine all'upload alla misura della pagina?).
- Il precarico: all'avvio (avvio più lungo) o in sottofondo dopo la prima pagina; e il web, che ha la cache del browser.
- Se convenga decodificare il JPEG direttamente alla misura giusta invece di passare da resvg (la prima apertura).

## Aggiunta del 19-11-2026 (libreria immagini)

Gli **oggetti Immagine** sul pannello non hanno le varianti alla misura degli sfondi di pagina (`sized_image` le
prepara solo per `sfondo_immagine`): il file intero si decodifica e si scala a ogni visita della pagina. Dal
19-11-2026 la libreria propone di ottimizzare all'upload (lato lungo 1920 px), che limita il danno ma non lo toglie:
una foto da 1920 px in un riquadro da 240 resta otto volte più grande del necessario. Quando si riprende questo seme,
valutare la variante alla misura anche per gli oggetti Immagine (con `contain` e la trasparenza, che oggi il JPEG
alla misura non tiene).
