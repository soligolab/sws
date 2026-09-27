# Pannello destro a un livello, trasparenza/luminosità/fade, polilinea e poligoni, rotazione LVGL

**Stato: approvato il 26-09-2026. Fasi A, B, C, D fatte sui quattro rami annidati, da collaudare.**

## Context

Il maintainer, provando il pannello destro dopo R4 (25-09): «è ancora molto confuso, per i bottoni non
trovo il menù in cui ci sia il tag da associare»; aprendo un ramo ci sono «molti sottolivelli», da portare a
un livello solo. Misurato: il tag del bottone sta in *Dati e collegamenti → Dato → Tag*, lontano da Modalità
e Valore (in *Bottone → Parametri*), mentre per 12 tipi il Tag è già in Parametri; i livelli sono ramo →
sezione → campo, con un terzo livello apribile nel tubo (6 sottosezioni) e nel movimento su percorso.

Insieme parte il seme `docs/archive/2026-09-25-trasparenza-luminosita-e-forme.md`. Misurato: `opacity` esiste
già (0–1, legabile col 🔗 via `bindings`) ma solo 14 tipi su 36 la applicano; su LVGL `bindings.opacity` è
ignorato (i binding valgono solo alla creazione e solo per la geometria); la luminosità non esiste; il
lampeggio è acceso/spento. Nessuna polilinea né generatore di poligoni; su LVGL la rotazione statica non è
implementata per nessun tipo e `lv_canvas_draw_polygon` si blocca sui poligoni concavi.

Tutte le scelte sotto sono del maintainer (26-09-2026, cinque giri di domande); nessuna è stata supposta.

## Primo passo all'approvazione

Scrivere questo piano in `docs/archive/2026-09-26-pannello-luce-forme.md` (regola: i piani vivono in git),
aggiornare il seme del 25-09 con un rimando e la riga in `docs/plans/README.md` («piano a fasi, in corso»).

## Rami — quattro, annidati, collaudo unico alla fine (scelta del maintainer)

`main` → `feat/pannello-un-livello` → `feat/luce-e-fade` → `feat/polilinea-poligoni` → `feat/rotazione-lvgl`.
Uno squash del ramo in cima dopo l'ok; poi controllo alberi ed eliminazione dei quattro. L'editor si rilancia
io (`start_editor_develop.sh`) dopo ogni cambio di codice, per tutta la sessione.

---

## Fase A — Pannello destro a un livello (`feat/pannello-un-livello`)

File: `sws-editor/src/editor/EditorShell.tsx` (`PannelloDestro` 1305-1426, `CollapsibleSection` 1522-1602,
`GRUPPI_PROPRIETA` 1142, `ObjectProps` 2563-5399), `stilePannelli.tsx`, i18n, test.

1. **Via le sezioni.** Dentro un ramo le sezioni con `gruppo` diventano **sottotitoli non cliccabili**
   (`SottoTitolo`, 2357); l'apertura/chiusura passa al **ramo**. Resta l'ordine di `ORDINE_SEZIONI` e
   l'auto-registrazione (niente tabella che ripeta il JSX, decisione R4).
2. **Rami: uno aperto + appuntati 📌** — lo stato `Fisarmonica` passa da sezione a ramo; chiavi
   `localStorage` nuove (`sws.pannelli.destra.ramo`, `…ramiAppuntati`). Selezionando un oggetto resta aperto
   **l'ultimo ramo usato** se l'oggetto ce l'ha, altrimenti `gruppoAffine`.
3. **Ramo del tipo sempre presente**, anche per rect/ellipse/line/text/image. Ci va **solo lo specifico**:
   raggio angoli (rect), estremi X2/Y2 (line), sorgente/adattamento (image), il testo (text); colore e
   bordo restano in *Posizione e aspetto*.
4. **Tag primario nel ramo del tipo per tutti i tipi** che oggi lo hanno in *Dato* (bottone compreso, accanto
   a Modalità comando e Valore scrittura; testo, forme, …). In *Dati e collegamenti* restano Binding attivi,
   Indicatore qualità e il «Tag di stato» dei tipi che non usano il tag come dato (regola UI 2 invariata:
   un solo punto scrive `obj.tag`).
5. **Terzo livello, deciso caso per caso**: diventano sottotitoli fissi *Riempimento fluido*, *Marcatori
   estremità*, *Etichetta*, *Aggancio a oggetti*, *Punti (waypoint)* del tubo e *Coordinate* del movimento;
   **resta apribile** solo *Stato e allarme* del tubo.
6. Pagina, multiselezione, editor di cella: invariati (non hanno la fisarmonica).
7. **Test**: riscrivere `tests/pannelloDestro.test.tsx` per l'accordion a livello di ramo; nell'inventario
   `tests/fixtures/campiPannelloProprieta.json` cambiano le `sezioni`, **i `campi` no** (è la prova che nessun
   campo si perde, vincolo di R4); nuovo test: nessun tipo mostra due volte l'etichetta «Tag» (regola 2
   finora senza guardia).

## Fase B — Trasparenza, luminosità, fade (`feat/luce-e-fade`)

1. **Opacità su tutti i 36 tipi.** Web: applicarla una volta sola sul `<g>` per oggetto (`SvgCanvas.tsx`
   ~1869) invece che nei 14 rami che chiamano `applyTransform`, tenendo separati il `<g>` esterno (animazioni
   di lampeggio) e quello interno (opacità di progetto), come oggi. Pannello: *Opacità* (`BindableInput`,
   🔗) per ogni tipo in *Posizione e aspetto*, non solo per `SUPPORTS_TRANSFORM`.
2. **Luminosità**, campo comune nuovo `brightness` **−100…+100 %** (0 = com'è; negativo verso il nero,
   positivo verso il bianco), **filtro su tutto l'oggetto** (immagini e simboli compresi), legabile col 🔗.
   - Web: filtro SVG `feComponentTransfer` lineare per oggetto (verso il nero: moltiplica; verso il bianco:
     `slope=1-k, intercept=k`) — stessa formula del motore LVGL.
   - LVGL: il filtro colore per oggetto già usato per il grigio (`lvgl_render.rs` 1966-2020, 9870-9885) va
     **combinato** in un solo callback con il grigio (uno slot per oggetto), con `lv_color_lighten/darken`.
3. **Parità piena LVGL dei valori legati**: opacità e luminosità seguono il tag in tempo reale (scala lineare
   compresa) — estendere `apply_bindings`/`LiveKind::Effects` (`lvgl_render.rs` 1558-1600, `effects.rs`),
   logica pura testabile in `effects.rs`. Le **espressioni** su LVGL restano non valutate come oggi: il
   pannello lo dichiara (regola dei tipi non supportati).
4. **Lampeggio sfumato**: `blink_style: "step" | "fade"` (default `step`, i progetti esistenti non cambiano)
   e `blink_fade_depth` (default **−60 %**, campo nel pannello). Il fade fa **respirare la luminosità** fra 0 e
   la profondità, con la stessa velocità (`blink_rate_ms`) e le stesse condizioni (sempre / su tag / su
   allarme). Il tag che abilita il lampeggio è **il «su tag» esistente** (`blink_tag`: lampeggia finché è
   vero), valido anche per lo sfumato — chiarito dal maintainer, nessun tag nuovo. Web: animazione CSS `filter: brightness()` sul `<g>` esterno (verso il nero = moltiplicare, pari
   a LVGL); LVGL: in `update_effects` a ogni frame. Rispetta «Anteprima effetti» e `prefers-reduced-motion`.
5. Dove si dichiara ogni campo nuovo: `types/index.ts`, `sws-web/src/synoptic.rs` (con `///`, altrimenti il
   salvataggio lo perde), `sws-lvgl-viewer/src/model.rs` (`check_lvgl_parity.sh`), rigenerare
   `synoptic_schema.rs` (`scripts/gen_synoptic_schema.py`, `check_synoptic_schema.sh`), i18n, inventario.

## Fase C — Polilinea e poligoni (`feat/polilinea-poligoni`)

Due tipi nuovi nel gruppo *Forme*, aspetto **come il rettangolo** (riempimento, bordo colore/spessore/
tratteggio, opacità, luminosità, rotazione); la polilinea aperta ha solo il tratto.

1. **`polyline`**: `points[]`, `closed` (chiusa = riempibile). **Creazione per clic**: dalla palette si entra in
   modalità disegno, ogni clic aggiunge un punto, doppio clic o Invio finisce, Esc annulla. Modifica come il
   percorso di movimento: generalizzare `canvas/percorsoMovimento.ts` (trascina, dividi segmento, aggiungi in
   coda, Canc sul punto) invece di rifarlo.
2. **`polygon`**: box `x,y,w,h`, `sides` 3–24, `star` + `star_inner` (default **50 %**). Vertici calcolati
   da una funzione pura condivisa TS/Rust, ruotati di `rotation` (parità senza trasformazioni LVGL).
3. **LVGL**: polilinea aperta → `lv_line` come il tubo (`origine_polilinea`); chiusa/riempita e stella →
   **triangolazione** (ventaglio dal centro per la stella; ear clipping per la polilinea chiusa, che può
   essere concava) prima di `lv_canvas_draw_polygon`, che sui concavi non ritorna mai.
4. I venti punti di un tipo nuovo (elenco della ricognizione): palette, `LVGL_SUPPORTED_TYPES`/`SUPPORTED_
   TYPES`, `oggettiNuovi.ts`, `SvgCanvas`, pannello, `objectBBox`/`translateObject` + `bbox_of` in
   `sws-core/geometry.rs`, validatore (l'hint «per una spezzata serve una `pipe`» diventa `polyline`),
   schema IA, i18n, inventario, colori predefiniti, manuale widget.
5. Correggere di passaggio duplica/incolla/allinea, che oggi spostano solo `x/y/x2/y2` e non `points`
   (difetto già vivo sul tubo).
6. Guardia: un caso a tempo sul viewer LVGL per stella e polilinea chiusa concava (estendendo
   `check_simboli_lvgl.sh`), così un blocco da poligono concavo si vede invece di dare schermo nero.

## Fase D — Rotazione statica su LVGL per tutti (`feat/rotazione-lvgl`)

`lv_obj_set_style_transform_angle` (decimi di grado) con perno al centro per i tipi che ruotano sul web
(`SUPPORTS_TRANSFORM` + i nuovi), riusando `angolo_rotazione` (`lvgl_render.rs` 8357). Da verificare tipo per
tipo che il widget si ridisegni ruotato (canvas, lv_line, testo) e il costo di composizione; `flip_h/v` su
LVGL resta fuori (non richiesto) e va annotato come seme.

---

## Verifica (per ogni fase, e tutta insieme a fine catena)

- `cargo check`, `cargo test -p sws-web -p sws-lvgl-viewer`, `pnpm build`, `pnpm vitest run`,
  `./scripts/check_static.sh` (parità LVGL, tipi, schema IA, i18n, colori, manuale).
- Con stack: `check_wysiwyg.sh`, `check_simboli_lvgl.sh` esteso, `check_istantanea.sh` (fotografia LVGL: si
  usa per confrontare a pixel opacità, luminosità, fade, poligoni e rotazione fra web e LVGL), e le e2e.
- Runtime di scarto dichiarati e terminati; l'editor del maintainer rilanciato da me dopo ogni cambio.
- Collaudo del maintainer a fine catena: pannello (bottone: tag in *Bottone*, rami uno + 📌, sottotitoli),
  opacità legata a una waveform su un tipo prima escluso, luminosità ±, fade, polilinea disegnata a clic,
  esagono/stella ruotati, stessi risultati su un pannello LVGL.
