# Editor coerente: tracce Trend unificate, fine dei doppioni, WYSIWYG per tutti gli oggetti

> Sostituisce il piano precedente (tab Variabili, completato). Specifiche definite con il
> maintainer in 3 tornate di domande (2026-08-23). Le regole permanenti che ne derivano vanno
> scritte in CLAUDE.md (parte della consegna).

## Contesto

Tre problemi segnalati dal maintainer + audit completo che li ha quantificati:
1. **Trend**: campo "Tag" e sezione "ALTRI TAG (OVERLAY)" sono due sezioni per lo stesso dato,
   e solo la seconda ha le proprietà avanzate. L'audit ha trovato anche 3 bug reali:
   B1 disallineamento stili quando un tag è vuoto (`filter(Boolean)` sui tag ma non sugli
   stili — SvgCanvas:4170/1252); B2 il "×" su una traccia non fa lo splice degli stili
   (EditorShell:3042); B3 `trend_series_styles[0].color` vince su `line_color` ma non è
   esposto in UI.
2. **Doppioni su altri oggetti**: "Tag" letteralmente duplicato su kpi_tile/data_log/sparkline;
   "Tag" generico mai letto dal rendering su bar/pie/table/symbol/alarm_*/recipe_panel/grid/
   faceplate/image/lang_* (ma alimenta le feature F4: bordo allarme, stale, Bad→grigio, QDot);
   `fill` vs `bg_color` sovrapposti su rect/button/navbutton/lang_button; colori stato del
   symbol doppi rispetto a `symbol_states`.
3. **Anteprime non fedeli**: trend = rettangolo senza assi/scale, setpoint senza il pulsante ⌨
   e con larghezze diverse, slider al 50% fisso e PIÙ ALTO a runtime (+20px label), radio con
   layout diverso, bar/pie/data_log/alarm_* placeholder puri, image senza src invisibile e
   non selezionabile, effetti globali (blink/motion/bordo allarme/stale) mai visibili in
   editor. Pattern fedele già collaudato: contenuto reale + pointerEvents:none + hit-rect
   (gauge SvgCanvas:3527, symbol:4921, faceplate:5301, grid:5035; i figli delle celle grid
   sono GIÀ renderizzati con isEditMode={false} → la ricetta esiste).

## Decisioni del maintainer (vincolanti)

| Tema | Decisione |
|---|---|
| Tracce trend | **Migrazione schema, taglio netto**: nuovo `trend_tags[]`, i campi vecchi rimossi al primo salvataggio; i runtime/LVGL vecchi mostreranno trend vuoti finché non aggiornati (accettato) |
| Forma traccia | `{tag, label?, color?, width?, dash?, fill?, fill_opacity?, smooth?, own_scale?, hidden?}` — **con label opzionale** (legenda/tooltip mostrano label, fallback id) |
| Sezione TRACCE | Unica, **in cima** alla configurazione del trend |
| WYSIWYG | Anteprima = rendering runtime (il problema è il DISEGNO: assi/scale/pulsanti visibili); dati live veri quando il runtime gira; trend/data_log: fetch una tantum, niente polling in edit |
| Trend senza dati | Chrome completo (assi/griglia/scale/legenda/soglie) + curva sinusoidale demo per traccia, attenuata con watermark "demo" |
| Setpoint | Anteprima = runtime (incluso ⌨); fix bug `decimals` mai applicato |
| Slider | **Runtime contenuto nel box** dichiarato (label inclusa): il box disegnato è l'ingombro vero; i deployati con label si compattano leggermente |
| Ampiezza | Tutti i tipi "divergenti" + i "simili" se banali |
| Effetti globali | **Toggle in toolbar "Anteprima effetti"** (spento di default): blink, motion, bordo allarme, stale, Bad→grigio applicati in edit quando attivo |
| Tag generico | Sezione **"Tag di stato (allarme/stale/qualità)"** dentro la sezione qualità per i tipi non-primari; via dall'alto su bar/pie/table/symbol e dai 9 tipi rumore; kpi/data_log/sparkline tengono SOLO la copia nella loro sezione |
| Waypoint | Nel pannello "MOVIMENTO SU PERCORSO", pulsante **"+" di cattura**: click sul canvas → appende le coordinate (in coordinate pagina, rispettando zoom/pan) |
| CLAUDE.md | Registrare ENTRAMBE le regole permanenti (WYSIWYG + niente sezioni doppie) |

## Implementazione

### A. Migrazione `trend_tags[]` (taglio netto)
1. `types/index.ts`: `TrendTrace` (forma sopra) + `SynopticObject.trend_tags?: TrendTrace[]`;
   i campi legacy (`extra_tags`, `trend_series_styles`, `line_color`, e `tag` SOLO per trend)
   restano nel tipo ma deprecati a commento.
2. Helper `normalizeTrendObject(obj)` (nuovo modulo `canvas/trendModel.ts`): se `trend_tags`
   assente lo costruisce da tag+extra_tags+styles+line_color (styles[0]=tag principale,
   colore da styles[0].color ?? line_color) e RIMUOVE i campi legacy. Applicato:
   - nello store al caricamento pagine (`setPages`) → ogni oggetto trend è normalizzato in
     memoria; il primo salvataggio scrive solo il nuovo formato (taglio netto);
   - in `collectTagIds` (legge trend_tags, con fallback legacy per sicurezza);
   - nell'import pagina/bundle (passa dallo store, già coperto).
3. `TrendCanvas`/`TrendExpanded`/`SvgCanvas` branch trend: `tags`/`seriesStyles`/`labels`
   derivati SOLO da `trend_tags` (fix B1: coppie filtrate insieme). Legenda/tooltip usano
   `label ?? tag`.
4. Pannello: sezione "TRACCE" unica IN CIMA (subito dopo il nome oggetto): righe con
   tag (TagInput) + label + colore + spessore + dash + fill(+opacità) + smooth + scala
   propria + nascondi; "+ Aggiungi traccia"; "×" con splice corretto (fix B2). `line_color`
   sparisce dal pannello (fix B3). Il resto della config trend segue sotto (finestra, assi,
   soglie, data/ora…).
5. Mirror Rust `synoptic.rs`: `trend_tags: Option<Value>`. LVGL `model.rs`: NON toccato
   (F9 lo aggiornerà; fino ad allora trend LVGL vuoto — accettato e annotato in STATUS).
6. Pagine demo CasaMauro: dopo il deploy della feature, il maintainer riapre e risalva —
   la migrazione è automatica al load.

### B. Doppioni
1. Lista di esclusione del Tag generico (EditorShell:2334): aggiungere kpi_tile, data_log,
   sparkline (tengono la copia locale), bar_chart, pie_chart, table, symbol, alarm_viewer,
   alarm_bell, alarm_banner, recipe_panel, grid, faceplate, image, lang_button, lang_selector.
2. Nuovo campo "Tag di stato (allarme/stale/qualità)" DENTRO la sezione qualità universale
   (accanto a show_alarm_state/stale/bad_value_style): scrive `obj.tag`, visibile solo per i
   tipi esclusi al punto 1 (per gli altri obj.tag resta il campo primario di sempre).
3. `bg_color` nascosto nel pannello SFONDO per rect/button/navbutton/lang_button (resta
   bg_image): il colore è `fill`. I valori bg_color esistenti continuano a funzionare da
   fallback nel rendering (nessun cambio runtime).
4. Symbol: quando `symbol_states` è popolato, i 3 colori legacy si disattivano visivamente
   (opacity + hint "gli stati N hanno la precedenza").
5. Setpoint: applicare `decimals` al valore mostrato (bug).

### C. WYSIWYG (pattern unico: contenuto runtime + hit-rect)
Per ogni tipo divergente/simile, il ramo `isEditMode` viene sostituito dal rendering runtime
avvolto nel pattern gauge/symbol (pointerEvents none + rect trasparente con handleMouseDown):
- **trend**: TrendCanvas reale in edit — storico UNA fetch al mount se runtime raggiungibile,
  altrimenti (o senza campioni) curva demo sinusoidale per traccia con watermark "demo";
  niente polling; pulsante ⤢ nascosto. Nuova prop `editPreview` su TrendCanvas.
- **bar_chart / pie_chart**: usare il ramo runtime anche in edit (è SVG puro su tagValues).
- **data_log**: DataLogWidget reale con load al mount, refresh solo manuale.
- **kpi_tile**: sparkline reale + badge delta (fetch stats una tantum).
- **slider**: layout runtime CONTENUTO nel box (modifica runtime: label dentro l'altezza
  dichiarata) e stesso rendering in edit (valore live, fill rispettato, read_only visibile).
- **setpoint**: rendering runtime in edit (input disabled, ⌨ visibile), decimals applicati.
- **radio / lang_selector / checkbox**: foreignObject runtime con input `disabled`.
- **alarm_viewer / alarm_bell / alarm_banner / recipe_panel**: componenti reali (gli allarmi
  live sono già nello store), pointer none; rispettare alarm_viewer_bg_color in edit.
- **sparkline**: widget reale (già backfill una tantum), bgLayer coerente.
- **xy_plot**: ramo runtime con pointer none (punto live).
- **image senza src**: placeholder tratteggiato selezionabile ("🖼 nessuna immagine") +
  aggiungere image (e gli altri box-like mancanti: xy_plot, bar, pie, sparkline, kpi_tile,
  data_log, alarm_*, recipe_panel, faceplate, setpoint, text_list, state_lamp, lang_*) a
  BOX_TYPES per i campi W/H.
- **faceplate**: figli con `isEditMode={false}` (come già fanno le celle grid) e bgLayer
  dentro il transform (fix scaling in edit); resta l'etichetta arancione della definizione.
- **pipe**: flusso animato visibile sotto il toggle effetti.
- **Toggle "Anteprima effetti"** in EditorToolbar (stato nello store, non persistito):
  quando attivo, il wrapper applica anche in edit blink/motion/bordo allarme/stale/gray/QDot
  (min_role resta sempre visibile normale in edit). Icona ▶/⏸ con tooltip.

### D. Cattura waypoint "+" (MOVIMENTO SU PERCORSO)
- EditorShell: stato `capturingPathFor: objectId | null`; pulsante "+" accanto alla textarea
  waypoint → attiva la cattura (bottone evidenziato, hint "clicca sul canvas; Esc per finire").
- SvgCanvas: nuova prop `onCanvasPick?: (pt: {x,y}) => void` — quando attiva, il click sul
  canvas (convertito in coordinate pagina via viewT zoom/pan, con snap alla griglia se attivo)
  NON seleziona ma chiama il callback; cursore crosshair; Esc disattiva.
- Ogni click appende un punto a `motion_path` dell'oggetto in cattura; la textarea resta
  editabile a mano come oggi.

### E. CLAUDE.md — regole permanenti (nuova sezione "Regole UI dell'editor")
1. **WYSIWYG obbligatorio**: il ramo edit-mode di ogni oggetto DEVE usare il rendering
   runtime (pattern: contenuto reale + pointerEvents:none + hit-rect trasparente). I
   placeholder divergenti sono bug. Gli effetti runtime (animazioni, blink, motion) si
   previsualizzano col toggle "Anteprima effetti".
2. **Una sezione per dato**: mai due punti del pannello che scrivono lo stesso campo; se un
   campo ha varianti semplice+avanzata, esiste solo la sezione completa. Il campo `tag`
   generico compare solo sui tipi che lo usano come dato primario; per gli altri vive nella
   sezione "Tag di stato".

## File critici
- `sws-editor/src/types/index.ts` (TrendTrace), `canvas/trendModel.ts` (nuovo: normalize),
  `store/index.ts` (normalizzazione al setPages), `canvas/TrendCanvas.tsx` (+labels,
  editPreview, demo data), `canvas/TrendExpanded.tsx`, `canvas/SvgCanvas.tsx` (branch trend
  + tutti i rami edit riscritti + onCanvasPick + toggle effetti nel wrapper),
  `editor/EditorShell.tsx` (sezione TRACCE, esclusioni tag, Tag di stato, BOX_TYPES, cattura
  waypoint), `editor/EditorToolbar.tsx` (toggle effetti), `runtime-view/collectTagIds.ts`,
  `sws-runtime/crates/sws-web/src/synoptic.rs` (trend_tags mirror), i18n it/en, `CLAUDE.md`.

## Branch
Sul capo corrente `feat/scada-f6` (un solo capo da testare).

## Verifica
1. `pnpm type-check`/`build` + vitest (aggiungere test unit per normalizeTrendObject:
   migrazione legacy→nuovo, idempotenza, campi legacy rimossi).
2. Migrazione live: CasaMauro ha trend legacy (pagina 1 + demo F5) → aprire nell'editor,
   verificare tracce migrate col GET, salvare, GET di nuovo → solo trend_tags su disco.
3. Screenshot Playwright: trend in edit con assi/griglia/demo, setpoint con ⌨, slider
   contenuto nel box, bar/pie reali, radio fedele, image placeholder selezionabile,
   toggle effetti con blink attivo, cattura waypoint (3 click → 3 punti in textarea).
4. Round-trip campi nuovi (trend_tags) via PUT/GET synoptic.
