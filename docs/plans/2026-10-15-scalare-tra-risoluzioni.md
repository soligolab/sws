# Piano — portare un progetto da una risoluzione a un'altra

> Nato come seme il 15-10-2026 (CasaDomotica da Full HD a 1280×800); la sessione di plan dello stesso giorno l'ha
> trasformato in questo piano, approvato dal maintainer. Ramo `feat/scala-risoluzione`, annidato su `feat/cornici`.

## Context

CasaDomotica, passata da 1920×1080 a 1280×800, ha lasciato
la barra di navigazione di «Finestre e porte» a `y: 1030`, larga 1900, fuori pagina. Oggi cambiare la misura di una
pagina scrive solo `width`/`height` (`EditorShell.tsx`, preset in `getDevicePresets`): gli oggetti restano dove
sono, quelli oltre il nuovo bordo diventano «fuori pagina» (T-52) e il resto va riposizionato a mano.

Il maintainer vuole una conversione che riporti posizioni e misure nella risoluzione nuova (15-10-2026).

Le sue scelte:
- **uniforme e centrata**: un fattore solo, il minore fra i due assi (0,667 da 1920×1080 a 1280×800). Nessun simbolo
  deformato; il disegno si centra e lascia una fascia libera;
- **testi, spessori e raggi seguono la scala, con un minimo**: testo almeno 9 px, spessori almeno 1 px;
- **tutto il progetto in un dialogo**, con la scelta delle pagine e delle cornici, e un annulla solo;
- **ramo annidato su `feat/cornici`**: anche le cornici hanno misure da convertire.

È una conversione dei file fatta dall'editor. Runtime e LVGL non cambiano: leggono le pagine convertite come
qualunque altra.

## Il modello della trasformazione

Da una pagina `W×H` a `W'×H'`:
- `f = min(W'/W, H'/H)`;
- `dx = (W' − W·f) / 2` e `dy = (H' − H·f) / 2`;
- un punto va in `(x·f + dx, y·f + dy)`;
- una misura va in `misura·f`.

Una **cornice** non si centra in verticale, perché le fasce devono restare attaccate ai bordi:
- la testata e gli oggetti che stanno in testata si ancorano in alto: `y·f`;
- il piede e i suoi oggetti si ancorano in basso: `H' − (H − y)·f`;
- le altezze delle due fasce si moltiplicano per `f`;
- in orizzontale si centra come per le pagine.

Campi trasformati, uno per tipo di geometria:
- **punti**: `x/y`, `x2/y2` (linee), `points` (tubi, polilinee), `motion_path`;
- **misure**: `width/height`, `col_widths/row_heights` (griglie), e dentro le celle delle griglie `child` e le
  sotto-celle (solo le misure, perché le coordinate sono relative alla cella);
- **grandezze in pixel non posizionali**:
  - `font_size`, `table_font_size` (minimo 9);
  - `stroke_width`, `spark_stroke_width`, `symbol_outline_width` (minimo 1);
  - `corner_radius`, `grid_gap`, `grid_padding`, `nav_gap`, `nav_btn_size`, `bar_gap`, `marker_size`,
    `pie_explode_px`, `pipe_label_offset`.

Restano come sono:
- **tempi, valori, angoli, scale di valore**: `min/max`, soglie, `rotation`, `gauge_*_angle`, `pie_inner_ratio`,
  `star_inner`, `opacity`;
- **i figli di un faceplate**: con `faceplate_scale` seguono il riquadro da soli, senza restano alla loro misura
  nativa;
- **gli oggetti parcheggiati fuori pagina**: si trasformano come gli altri, così restano fuori nello stesso modo.

**Guardia contro i campi dimenticati**: un test elenca tutti i campi numerici di `SynopticObject` in
`types/index.ts` e pretende che ognuno sia classificato «scala» o «non scala». Così un campo in pixel aggiunto domani
non sfugge in silenzio.

## Cosa si scrive

1. **`sws-editor/src/scala/scalaPagina.ts`** (nuovo), funzioni pure:
   - `fattore(da, a)` → `{ f, dx, dy }`;
   - `scalaOggetto(obj, t, minimi)`: ricorsivo nelle celle delle griglie, riusa lo schema per tipo di
     `translateObject` (`src/pageLayout.ts`) per linee, tubi e polilinee;
   - `scalaPagina(page, a)` e `scalaCornice(page, a)` per la pagina-cornice, con fasce e ancoraggi;
   - le tabelle `CAMPI_SCALATI` e `CAMPI_FISSI`.
2. **Store** (`src/store/index.ts`): l'azione `scalaProgetto(ids, a)` applica tutto con un solo `pushHistory`
   («history.scalaProgetto»), e ogni pagina prende misure e oggetti nuovi. Se `page_layout.default_width/height`
   era la misura vecchia, diventa la nuova (via `salvaLayout`/`updateProjectPageLayout`, preservando gli altri
   campi). Il salvataggio resta quello normale, con il pallino «non salvato».
3. **Dialogo `src/scala/DialogoRisoluzione.tsx`**: si apre da Impostazioni progetto → formato (vicino a
   «Applica a tutte le pagine», `EditorShell.tsx` ~2190) con il pulsante «Cambia risoluzione del progetto…».
   - «Da»: la misura più frequente fra le pagine.
   - «A»: lo stesso elenco di preset del pannello pagina (`getDevicePresets`, `STANDARD_DEVICE_PRESETS`) oppure
     larghezza e altezza.
   - L'elenco delle pagine, delle cornici e delle immagini di boot con la loro misura: spuntate quelle che hanno
     la misura «Da».
   - Una riga d'anteprima: «fattore 0,667 — fascia libera di 40 px sopra e sotto».
   - Pulsante «Converti».
4. **i18n** it/en; **manuale** (capitolo dell'editor, formato pagina); **CHANGELOG** e **NOVITA**. La riga in
   `docs/plans/README.md` passa da seme a piano.

## Verifica

- **vitest** su `scalaPagina.ts`:
  - fattore e centratura (1920×1080→1280×800: f=0,6667, dy=40);
  - rettangolo, linea, tubo con punti, testo con minimo, griglia con celle, `motion_path`;
  - cornice con testata e piede ancorati;
  - il test-guardia sui campi numerici.
- `pnpm build`, `cargo check`, `./scripts/check_static.sh`.
- **Dal vivo**, con un runtime di prova poi fermato e la demo web a 1280×800:
  - converto il progetto a 800×480 dal dialogo (Playwright);
  - screenshot di IDE, viewer web e istantanea LVGL della stessa pagina;
  - annullo e verifico che tutto torni com'era.
- **Prova del maintainer su CasaDomotica**: Da 1920×1080 → A 1280×800, solo le pagine rimaste alla misura vecchia.

## Stato (15-10-2026, sera)

Fatto sul ramo: funzioni pure e test (`e57026f6`), azione di store `scalaProgetto`, dialogo «Cambia risoluzione del
progetto…», i18n, manuale (`04_editor_guide.md`), CHANGELOG e NOVITÀ. Provato dal vivo sulla demo web, 1280×800 →
800×480: anteprima corretta (fattore 0,600, 16 px liberi ai lati), annulla con un passo, IDE, viewer web e LVGL
uguali dopo il salvataggio. Il predefinito `page_layout.default_*` si aggiorna se era la misura «Da» (via
`salvaLayout`, va subito sul server e **non** torna indietro con l'annulla).

**Limite noto**: un oggetto senza `font_size` usa il corpo predefinito del suo tipo, che non si scala (visto sul
bottone «Avvia (chiede conferma)» della demo: testo più largo del riquadro). Rimedio possibile, da decidere: scrivere
nel file il predefinito del tipo moltiplicato per il fattore, con una tabella dei corpi predefiniti condivisa fra i
due motori.

Resta la prova del maintainer su CasaDomotica.
