# Piano: bugfix pagine, oggetti allarme piazzabili, DataTable condiviso, Trend avanzato

## Contesto

Oggi due elementi allarme sono "chrome" fissa e globale, non oggetti di pagina:
- il bottone campanella in alto a destra (`AlarmPanel` in `sws-editor/src/runtime-view/RuntimeView.tsx:104-347`, dropdown con tab attivi/storico, ack/shelve);
- la barra allarmi in alto (`sws-editor/src/components/AlarmBanner.tsx`, montata in `App.tsx:621` e `viewer/RuntimeViewer.tsx:172`).

Il maintainer vuole poterli piazzare come normali oggetti SCADA, pagina per pagina (stesso pattern già usato da `navbutton`), per poter decidere dove metterli (es. barra allarmi in fondo a una pagina dedicata). Serve inoltre una vista tabellare degli allarmi con sort/filtro colonna, estesa poi a tutti gli oggetti "tabella" (incluse le Recipes, che oggi vivono in `ConfigView.tsx`, non come oggetto canvas). Infine il Trend (canvas 2D custom, nessuna libreria di charting, `sws-editor/src/canvas/TrendCanvas.tsx` + `TrendExpanded.tsx`) va potenziato con zoom via drag anche in modalità inline, stile per-traccia (spessore, pattern tratto), riempimento area, e uno switch linee fedeli/arrotondate.

**In più, durante questa sessione di pianificazione è emerso un bug reale e prioritario** sul progetto "Sandokan" del maintainer: cancellare pagine non persiste al salvataggio/reload. Va risolto **prima** delle feature nuove (T-41, vedi sotto) perché causa perdita di modifiche percepita dall'utente e potenzialmente pagine stantie nel deploy.

Decisioni già prese con il maintainer sulle feature (non da rimettere in discussione):
1. **Rimpiazzo pieno della chrome fissa** allarmi, nessuna migrazione automatica — si rimuove il vecchio bottone/barra fissi solo dopo aver piazzato manualmente i nuovi oggetti sulle pagine che servono.
2. Per la tabella allarmi (item 3 originale): **estendere `alarm_viewer` esistente** con una nuova modalità, non creare un nuovo tipo oggetto.
3. Per il sort/filtro generico (item 4 originale): **un componente `DataTable` condiviso**, riusato sia nel nuovo alarm_viewer "table mode" sia nella lista Recipes di `ConfigView.tsx`.

Nessuna delle task feature (T-42…T-48) richiede modifiche al backend Rust oltre a quanto già esposto da `GET/POST /api/alarms*`, `/ws/alarms`, `/api/history/:tag*`, `/api/recipes*`. Il bugfix T-41 invece tocca sia frontend che backend Rust (vedi sotto).

Numerazione: l'ultima task nella storia è T-40, si parte quindi da **T-41**.

---

## T-41 — BUGFIX PRIORITARIO: pagine cancellate/rinominate riappaiono dopo save + reload

**Sintomo riportato**: progetto "Sandokan", 3 pagine. Elimini la prima e l'ultima (resta solo quella centrale), il deploy sembra ok subito dopo. Ma se poi salvi, esci e riapri il progetto, le 3 pagine sono di nuovo tutte presenti — la cancellazione non viene persistita.

**Root cause confermata per lettura del codice** (nessuna riproduzione live necessaria, la causa è chiara e già osservabile su disco):

1. `deletePage` (`sws-editor/src/store/index.ts:792-803`) è **puramente in-memory**: fa solo `pages.filter(p => p.id !== id)` sullo store Zustand, nessuna chiamata API.
2. Il salvataggio (`saveAll()`, `store/index.ts:1625-1687`, riga 1660: `state.pages.map(p => api.saveSynoptic(p))`) fa **solo upsert**: `PUT /api/synoptics/:name` (`client.ts:381-386`) per ogni pagina ancora presente nell'array corrente. Non esiste nessuna `deleteSynoptic`/`removeSynoptic` in `client.ts`.
3. Sul backend (`sws-runtime/crates/sws-web/src/router.rs`), il file YAML per pagina viene scritto in `synoptics/<safe_filename(name)>.yaml`. **Non esiste una route `DELETE /api/synoptics/:name`** — a differenza di `faceplates` (riga 307, `.delete(delete_faceplate)`) e `recipes` (riga 311, `.delete(delete_recipe)`), che invece l'hanno.
4. Ogni ricarica pagine (apertura progetto in editor `App.tsx:275-282`, viewer runtime `RuntimeViewer.tsx:77-79/133-135`, `MainMenu.tsx:66-68`, `ConfigView.tsx:8517-8518`, `LeftPanel.tsx:171-172`) ricostruisce l'array di pagine leggendo `list_synoptics` (`router.rs:2620-2649`), che **enumera tutti i file `*.yaml` presenti nella cartella `synoptics/`** — non un manifest salvato. Il file orfano della pagina "cancellata" non viene mai rimosso dal disco, quindi reincompare a ogni load.
5. **Prova diretta su disco**, cartella del progetto Sandokan (copia editor):
   ```
   .run-editor/projects/Sandokan/synoptics/
     Sandokan.yaml            <- pagina superstite, riscritta dall'ultimo save
     Page 2.yaml               <- orfana, mai cancellata dal disco
     Sandokan (copia).yaml    <- orfana, mai cancellata dal disco
   ```
   Confermato che esistono due copie separate del progetto (`.run-editor/projects/<nome>` per l'editor, `.run/projects/<nome>` per il runtime deployato) — spiega perché "il deploy sembra ok subito dopo": è inconclusivo per sola lettura statica se lo zip di deploy (`build_project_zip` → `load_all_synoptics`, `router.rs:2158-2178/2278-2298`) escluda davvero i file orfani o se il maintainer abbia solo controllato la vista editor subito dopo — **da verificare riproducendo**, ma non cambia la diagnosi principale.
6. **Bug gemello trovato per lo stesso motivo**: `renamePage` (`store/index.ts:805-808`) è anch'esso solo in-memory; dato che il nome file deriva da `safe_filename(page.name)`, rinominare una pagina e salvare crea un NUOVO file col nome nuovo lasciando quello vecchio orfano sul disco — stessa causa, stesso fix la risolve.

**Fix proposto** (minimo, coerente con lo stile del progetto — nessuna astrazione in più):

1. **Backend** (`sws-runtime/crates/sws-web/src/router.rs`): aggiungere route `DELETE /api/synoptics/:name` + handler `delete_synoptic`, sul modello di `delete_faceplate`/`delete_recipe` (righe ~3054-3070/3130-3150 circa, stesso pattern: risolvi path via `safe_filename`, `tokio::fs::remove_file`, 404 se non esiste, 204/200 su successo). Registrare la route vicino alle altre `synoptics` (riga ~273/300-301/514-515).
2. **Frontend API** (`sws-editor/src/api/client.ts`): nuova funzione `deleteSynoptic(name: string)` che chiama `DELETE /api/synoptics/:name`, mirror di `deleteFaceplate`/`deleteRecipe` già presenti.
3. **Store** (`sws-editor/src/store/index.ts`):
   - Tenere uno snapshot dei nomi pagina "noti come persistiti su disco" al momento dell'apertura progetto (popolato quando le pagine vengono caricate, es. in `App.tsx:275-282` dopo `list_synoptics`+`getSynoptic`) — es. nuovo campo di stato `persistedPageNames: string[]`.
   - In `saveAll()` (righe 1625-1687), prima/dopo l'upsert delle pagine superstiti: calcolare `persistedPageNames.filter(n => !currentPages.some(p => p.name === n))` → per ciascun nome mancante chiamare `api.deleteSynoptic(name)`. Dopo un save riuscito, aggiornare `persistedPageNames` con i nomi correnti.
   - Questo copre sia la cancellazione pagina sia il rename (rename = vecchio nome scompare dall'elenco corrente → trattato come "da cancellare", nuovo nome viene comunque upsertato dal passo esistente).
4. **Verifica manuale del deploy**: dopo il fix, ripetere lo scenario riportato (cancella prima/ultima pagina di un progetto a 3 pagine, salva, esci, riapri) e controllare anche il contenuto effettivo dello zip di deploy generato, non solo la vista editor — per chiudere il punto 5 sopra rimasto inconclusivo.
5. **Pulizia dati esistenti**: il progetto Sandokan reale ha già file orfani su disco (`Page 2.yaml`, `Sandokan (copia).yaml` in `.run-editor/projects/Sandokan/synoptics/`) — vanno rimossi manualmente una volta capito quali pagine il maintainer vuole davvero tenere, il fix del codice non pulisce retroattivamente ciò che è già orfano.

**File coinvolti**: `sws-runtime/crates/sws-web/src/router.rs`, `sws-editor/src/api/client.ts`, `sws-editor/src/store/index.ts`.

**Dipendenze**: nessuna — va fatto per primo, prima di qualunque feature sotto, perché è una perdita di dati percepita, non solo un difetto estetico.

---

## T-42 — `alarm_bell`: oggetto piazzabile campanella + dropdown

**Obiettivo**: sostituire `AlarmPanel` fisso con un `SynopticObject` normale che apre lo stesso dropdown (lista attivi, ack, shelve/unshelve, tab storico).

**Nuovi campi** (`sws-editor/src/types/index.ts`, vicino a `alarm_viewer` linea 359+):
```ts
alarm_bell_id_prefix?: string;
alarm_bell_severities?: AlarmSeverity[];
alarm_bell_show_history?: boolean;   // default true
alarm_bell_show_shelve?: boolean;    // default true
```
Riusa `x/y/width/height/fill` generici. Niente `label`/`write_value`/`button_action`: il click è fisso (apri dropdown), va detto esplicitamente nel property panel che non c'è azione configurabile.

**File**:
1. Nuovo `sws-editor/src/components/AlarmBellPanel.tsx` — estrae il corpo di `AlarmPanel` (`RuntimeView.tsx:104-347`) in `AlarmBellPanel({ idPrefix, allowedSev, showHistory, showShelve, badgeFill })`, mantenendo `useAlarmStream`, ack/shelve/unshelve, embed di `AlarmHistory`. Rimuove il wrapper `position:fixed` e il prop `bellTop`.
2. `SvgCanvas.tsx` — nuovo branch `obj.type === "alarm_bell"` (pattern gemello di `alarm_viewer`, vedi riga ~3455-3481): in edit mode placeholder statico, in view mode il widget reale.
   - **Punto delicato**: nessun oggetto oggi fa overflow fuori dal proprio `foreignObject`. Non renderizzare il dropdown dentro il foreignObject: tenere un `ref` sul bottone e al click fare `createPortal` del dropdown in `document.body`, posizionato via `button.getBoundingClientRect()` (`position:fixed; top:rect.bottom+4; left:rect.left`) — funziona indipendentemente da zoom/pan canvas. Se risulta più laborioso del previsto, fallback: pannello ad angolo fisso come oggi.
3. `LeftPanel.tsx:485-524` — nuova entry nel gruppo "Display" + chiavi i18n `editor.palette.item.alarm_bell` in `en.json`/`it.json`.
4. `EditorShell.tsx`:
   - `handleAddObject` (~riga 499) → `case "alarm_bell": addObject({ type, x, y, width:130, height:34 })`.
   - `ObjectProps` (~riga 1943, vicino al blocco `alarm_viewer` a 2777) → nuovo blocco proprietà: prefix, severità multi-select, checkbox show_history/show_shelve, color picker.

**Dipendenze**: nessuna (ma consigliato fare T-41 prima, sempre).

---

## T-43 — `alarm_banner`: oggetto piazzabile barra allarmi

**Obiettivo**: sostituire la barra fissa (`AlarmBanner.tsx`) con un oggetto piazzabile.

**Nuovi campi**:
```ts
alarm_banner_id_prefix?: string;
alarm_banner_severities?: AlarmSeverity[];
```
Riusa `x/y/width/height` (default 600×32, come la strip attuale). Il concetto `overlay` (`AlarmBanner.tsx:46`, usato oggi per la modalità "viewer a schermo pieno") non serve più: un oggetto piazzato non ha "overlay vs inline".

**File**:
1. `AlarmBanner.tsx` — refactor da `AlarmBanner({overlay})` a `AlarmBanner({width, height, idPrefix, allowedSev})`, togliendo il branch `position:fixed`/`overlay`, mantenendo sort per priorità ISA, blink, bottone ACK.
2. `SvgCanvas.tsx` — nuovo branch `obj.type === "alarm_banner"`: foreignObject normale (nessun portal necessario, il contenuto sta nel proprio box, come `AlarmViewerWidget`).
3. `LeftPanel.tsx` + i18n — stesso pattern di T-42.
4. `EditorShell.tsx` — `handleAddObject` case + blocco proprietà (prefix, severità).

**Nota apertura**: `alarm_viewer` ha già una modalità `"banner"` (`SvgCanvas.tsx:1922`, ticker passivo, senza ACK/blink/sort priorità) — `alarm_banner` nasce come oggetto separato perché è materialmente più interattivo (ack, blink, sort ISA) rispetto a quel ticker. Se preferisci evitare un terzo tipo oggetto "allarme-simile", l'alternativa è potenziare la modalità `"banner"` di `alarm_viewer` con ack/blink/sort e non fare T-43 affatto — da confermare prima di implementare, non deciso qui.

**Dipendenze**: nessuna (ma implementare dopo T-42 aiuta a riusare l'esperienza sul dropdown/portal, non è un blocco).

---

## T-44 — Componente `DataTable` condiviso + lista Recipes

**Obiettivo**: un componente tabella tipizzato, sortabile, filtrabile per colonna, usato subito nella lista Recipes.

**Nuovo file** `sws-editor/src/components/DataTable.tsx`:
```ts
export interface DataTableColumn<T> {
  key: string;
  header: string;
  accessor: (row: T) => string | number | boolean | null | undefined;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;        // default true
  filterable?: boolean;      // default true
  filterType?: "text" | "select";  // default "text"
  filterOptions?: { value: string; label: string }[];
  width?: number | string;
  align?: "left" | "center" | "right";
}
export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  maxHeight?: number | string;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string;
  compact?: boolean;   // per uso embedded nel canvas
}
```
Implementazione: `<table>` semplice + stili inline (niente framework CSS in questo codebase). Stato locale sort (asc/desc, terzo click su altra colonna resetta) + filtri per colonna. Riga filtro sotto l'header (`<input>` testo o `<select>`). Pipeline `useMemo`: filtra → ordina → renderizza. Nessuna virtualizzazione/paginazione: liste allarmi/recipes sono piccole (coerente con `AlarmHistory.tsx` che già pagina a 50).

**Integrazione Recipes** (`sws-editor/src/config/ConfigView.tsx`, `RecipesTab` ~riga 6321): sostituire la lista `.map()` a sinistra (~6418-6438) con `<DataTable<RecipeSummary> columns={...} rows={recipes} rowKey={r=>r.id} onRowClick={...} selectedRowKey={selected?.id} compact />`. Colonne: `name` (sort+filtro testo), `id` (sort+filtro testo), `setpoints_count` (sort, no filtro, allineato a destra). L'editor dei setpoint a destra (righe ~6463-6508, form di editing inline tag/valore) resta com'è — non è un dataset da navigare, `DataTable` non è adatto lì.

**Fuori scope (deciso)**: l'oggetto `table` statico (righe `TableRow[]` label/tag/format, `SvgCanvas.tsx:3031+`) resta escluso — è un readout SVG nativo a design-time, non un dataset che l'operatore sfoglia; convertirlo a `DataTable` sarebbe un refactor grosso e visivamente invasivo per un beneficio dubbio.

**Dipendenze**: nessuna (base per T-45).

---

## T-45 — Modalità "table" su `alarm_viewer`

**Obiettivo**: usare `DataTable` dentro `alarm_viewer` per la vista estesa con sort/filtro.

**Modifica campo** (`types/index.ts:366`): `alarm_viewer_mode?: "list" | "banner"` → `"list" | "banner" | "table"`. Nessun altro campo nuovo — riusa `alarm_viewer_max_rows/id_prefix/severities/show_ack/show_ts/show_empty/bg_color`.

**Scope tagliato per questo PoC**: solo sort+filtro+ACK, **niente shelve inline** in tabella (richiederebbe un popover multi-campo per riga, sproporzionato rispetto alla richiesta — eventuale estensione futura).

**File**:
1. `SvgCanvas.tsx`, dentro `AlarmViewerWidget` (1864-1970): branch `mode === "table"` → `<DataTable<AlarmState> columns={...} rows={filtered} rowKey={a=>a.def.id} compact maxHeight={height} />`. Colonne: severità (pallino, sort per rank numerico), id (sort+filtro), messaggio (sort+filtro), timestamp attivazione (sort, formattato), stato ack/bottone ACK (render, non filtrabile). Il filtro prefix/severità esistente (righe 1875-1881) resta il filtro "di progetto" a design-time; i filtri di `DataTable` sono filtri runtime aggiuntivi che l'operatore usa al volo — sono due concetti diversi, entrambi legittimi.
2. `EditorShell.tsx:2778-2797` — terza `<option>` "table" nel select modalità.

**Dipendenze**: richiede T-44.

---

## T-46 — Rimozione vecchia chrome allarmi (ultimo step alarm, con gate manuale)

**Obiettivo**: eliminare bottone/barra fissi ora che esistono i sostituti piazzabili.

**Gate prima di iniziare**: verificare che `alarm_bell`/`alarm_banner` siano stati piazzati manualmente sulle pagine giuste dei progetti reali in uso, e che funzionino end-to-end (ack/shelve/storico) in un runtime avviato — non solo controllati nell'editor.

**File**:
1. `App.tsx` — rimuovi import e mount `<AlarmBanner />` (riga 4, 621).
2. `viewer/RuntimeViewer.tsx` — rimuovi import e mount `<AlarmBanner overlay={hideChrome} />` (riga 11, 172). **Non toccare** `hideChrome`/`hide_viewer_chrome`: serve ancora per la nav bar multipagina (`RuntimeView.tsx:597`).
3. `runtime-view/RuntimeView.tsx` — rimuovi la funzione `AlarmPanel` (104-347) e il suo mount (riga 723). Stessa cautela su `hideChrome` (riga 476, usato a 597).
4. `components/AlarmBanner.tsx` — se T-43 ha già rinominato/refactorato in-place il file per l'uso come oggetto, non c'è nulla da cancellare qui; altrimenti eliminare il vecchio file separato.
5. `AlarmHistory.tsx` resta: usato sia dal vecchio `AlarmPanel` (ora rimosso) sia dal nuovo `AlarmBellPanel` di T-42.

**Dipendenze**: richiede T-42 e T-43 completate + il gate manuale sopra.

---

## T-47 — Trend: stile per-traccia, dash, riempimento area, smoothing

**Obiettivo**: item 5b/5c/5d della richiesta originale.

**Nuovo campo** (`types/index.ts`, vicino a `line_color`/`extra_tags`, righe 198-208):
```ts
export interface TrendSeriesStyle {
  color?: string;
  width?: number;                          // px, default 1.5
  dash?: "solid" | "dashed" | "dotted";
  fill?: boolean;
  fill_opacity?: number;                    // 0..1, default 0.15
  smooth?: boolean;                         // default false
}
trend_series_styles?: TrendSeriesStyle[];   // indice 0 = obj.tag, i = extra_tags[i-1]
```
`line_color` resta come fallback legacy per il colore della serie 0 se `trend_series_styles[0].color` non è impostato — progetti esistenti non cambiano aspetto senza migrazione.

**File**:
1. `TrendCanvas.tsx`:
   - Nuovo prop `seriesStyles?: TrendSeriesStyle[]`.
   - Loop di stroke per serie (riga ~245, dove oggi `ctx.lineWidth = 1.5` è fisso): risolvere `color`/`width` da `seriesStyles[idx]` con fallback a `PALETTE`, `ctx.setLineDash(...)` prima di `stroke()` (mappa solid→`[]`, dashed→`[6,3]`, dotted→`[1,3]`; oggi solo `[3,3]` è usato per il crosshair a riga 283, da non confondere).
   - Riempimento: quando `fill` attivo, path chiuso per ogni run continuo di punti (stessa logica "penna si alza sui null" già usata per lo stroke), chiuso in basso sulla baseline del plot; `fillStyle`/`globalAlpha = fill_opacity ?? 0.15`.
   - Smoothing: quando `smooth` attivo, sostituire `lineTo` con `quadraticCurveTo` a midpoint tra punti consecutivi (arrotondamento cosmetico, non resampling — non altera i valori registrati, solo il modo in cui vengono collegati visivamente).
2. `TrendExpanded.tsx` — passare `seriesStyles` al suo `TrendCanvas` interno (riga ~236); il proprio `PALETTE`/`colors` locale (124-125) resta come fallback finale sotto `seriesStyles`.
3. `SvgCanvas.tsx` — passare `seriesStyles={obj.trend_series_styles}` sia alla `<TrendCanvas>` inline (~3150) sia al `<TrendExpandedModal>` (~1098-1106).
4. `EditorShell.tsx` — rifare il pannello proprietà Trend (2466-2522): da riga singola `line_color` + lista tag-only `extra_tags`, a una lista "SERIE" con una riga per indice (0 = `obj.tag`, 1..N = `extra_tags`), ciascuna con: tag, swatch colore, spessore (numero), dash (select), checkbox fill + opacità, checkbox smooth. Mantenere i bottoni add/remove-tag esistenti per la parte extra_tags.

**Dipendenze**: nessuna, ma va fatto prima di T-48 per lasciare gli interni del draw-effect di `TrendCanvas.tsx` stabili prima di aggiungerci lo stato di drag-zoom.

---

## T-48 — Trend: zoom via drag-select (inline + modale)

**Obiettivo**: item 5a della richiesta originale — selezionare un intervallo temporale disegnando un'area sul grafico, sia nel canvas inline compatto sia nel modale espanso.

**Design**:
- `TrendCanvas.tsx`: nuovo stato locale di drag-select + prop `onRangeSelect?: (fromMs:number, toMs:number) => void`. `onMouseDown` registra lo start-x; l'`onMouseMove` esistente (365-368) estende per aggiornare l'end-x durante il drag; `onMouseUp` — se `|deltaX| > 8px`, converte screen-x → timestamp riusando la stessa math di `tMin/tSpan/plotW/PAD_LEFT` già calcolata nel draw effect (va estratta in un helper condiviso per evitare disallineamenti) e chiama `onRangeSelect`; sotto la soglia, resta un click normale (comportamento hover di oggi). Disegnare un rettangolo di selezione semi-trasparente durante il drag, stesso punto del blocco crosshair esistente (280-342).
  `e.stopPropagation()` in `onMouseDown` come sicurezza contro il `<g onMouseDown>` del wrapper SVG (`SvgCanvas.tsx:1976-1989`) — oggi non c'è conflitto reale perché in edit mode il Trend mostra solo un placeholder statico (3131-3146) e il canvas vero (quindi anche il drag-zoom) esiste solo nel viewer runtime, dove non c'è selezione oggetti; ma costa nulla e protegge da eventuali modifiche futura.
- **Dove vive il range zoomato?** Non sul `SynopticObject` (è un campo di progetto, non ha senso mutarlo da un drag runtime, e romperebbe l'undo history). Stato locale in `SvgCanvas.tsx`: `useState<Record<string,{fromMs,toMs}|null>>` per id oggetto. Quando impostato, la `TrendCanvas` inline passa da modalità `windowS` a `fromMs/toMs` espliciti (già supportato oggi solo dal modale, righe 76-77/115-118 — va solo collegato anche al caso inline). Bottone "⟲ reset zoom" stesso angolo del bottone CSV esistente (372-393).
- `TrendExpanded.tsx` — nuovo valore `"custom"` per `RangePreset`, stato `customRange` impostato dallo stesso `onRangeSelect`; i bottoni pan (riga 105) vanno disabilitati anche per `preset === "custom"`, come già avviene per "all".

**File**: `TrendCanvas.tsx`, `TrendExpanded.tsx`, `SvgCanvas.tsx` (nuovo stato `trendZoom` + plumbing sia sulla call inline ~3150 sia sul modale ~1098).

**Dipendenze**: nessuna obbligatoria, ma va dopo T-47 per ridurre attrito nello stesso file.

---

## Ordine consigliato

```
T-41 (BUGFIX pagine — fare SEMPRE per primo)
       │
       ▼
T-42 (alarm_bell)  ─┐
T-43 (alarm_banner) ─┼──> T-46 (rimozione vecchia chrome — gate manuale)
T-44 (DataTable + Recipes) ──> T-45 (alarm_viewer table mode)
T-47 (trend stile per-traccia) ──> T-48 (trend drag-to-zoom)
```
Uniche dipendenze dure: T-41 non blocca le altre tecnicamente ma va risolto per primo per priorità (perdita dati); T-45 richiede T-44; T-46 richiede T-42 + T-43 + gate manuale. Il resto è liberamente riordinabile/interlacciabile su sessioni separate — il blocco DataTable/Recipes e il blocco Trend sono completamente indipendenti dal lavoro sugli allarmi.

## Rischi/ambiguità aperte da riconfermare prima di implementare

1. **T-41 punto 5 (deploy zip)**: inconclusivo per sola lettura statica se lo zip di deploy contenga già oggi i file orfani o no — da riprodurre e verificare col progetto Sandokan reale prima di dichiarare il fix completo.
2. **T-43 vs modalità "banner" di `alarm_viewer`**: possibile sovrapposizione di catalogo (vedi nota in T-43) — decidere se tenere `alarm_banner` separato o assorbire in `alarm_viewer`.
3. **Portale per il dropdown di `alarm_bell` (T-42)**: nessun precedente in questo codebase di popover che esce dal proprio `foreignObject`; è un unknown tecnico, budget tempo extra nella sessione.
4. **Rimozione `AlarmBanner.tsx` (T-46)**: dipende da come T-43 rinomina/struttura il file — riconciliare naming quando si arriva a T-46.

## Verifica end-to-end

**T-41 (bugfix)**: riprodurre esattamente lo scenario riportato (progetto a 3 pagine, cancella prima e ultima, salva, esci, riapri) e confermare che restino solo la pagina centrale — sia in editor che nello zip di deploy generato. Verificare anche lo scenario rename (rinomina una pagina, salva, riapri: non deve restare il file col nome vecchio). Pulire manualmente i file orfani già presenti in `.run-editor/projects/Sandokan/synoptics/`.

**Per le altre task**:
- `cargo check` + `pnpm build` verdi.
- Editor: aggiungere il nuovo oggetto dalla palette, verificare property panel e default.
- Runtime: avviare `./scripts/start_runtime.sh`, aprire il progetto, verificare comportamento live (ack/shelve reali, sort/filtro DataTable, drag-zoom sul Trend) — non solo controllo statico nell'editor.
- Per T-46: eseguire il gate manuale descritto (oggetti piazzati e verificati) prima di rimuovere la vecchia chrome.
