# T-52 — Il limite della pagina è morbido, non una gabbia

> Da copiare in `docs/plans/2026-09-04-limite-pagina-morbido.md` al primo commit:
> il lavoro dura più di una sessione e il maintainer alterna due macchine.
>
> **Sul numero**: era T-51 fino al 2026-09-04, poi il maintainer ha assegnato
> T-51 alla fase 3 «gli occhi» della chat (ramo `feat/T51-fase3-occhi`, che
> esisteva già con quel nome) e questo lavoro è diventato **T-52**.

## Context

Richiesta registrata dal maintainer il 2026-09-01 in `STATUS.md:487-503`
(commit `582408b`), marcata «Non deciso e non progettato: va affrontato in
modalità piano». Nessun `T-xx` né `Q-xx` assegnato, nessun piano, niente in
`CHANGELOG.md`: mai implementata. Tre comportamenti dell'editor sinottico che
sono la stessa idea vista da tre lati.

1. **Il fill dello sfondo pagina invade tutta l'area dell'editor**, ignorando il
   rettangolo tratteggiato che segna il bordo. Deve fermarsi al bordo.
2. **Gli oggetti sono confinati rigidamente nella pagina.** Devono essere
   *trattenuti* al bordo — aggancio morbido — ma poter **uscire** se si
   trascina con decisione.
3. **Un oggetto fuori pagina è ignorato e disabilitato a runtime, ma resta nel
   progetto.** È il modo di togliere qualcosa dalla grafica temporaneamente
   senza cancellarlo.

Esito atteso: il bordo pagina diventa un limite *leggibile* (il colore dice
dove finisce il foglio) e *morbido* (trattiene ma non imprigiona), e il fuori
pagina diventa un parcheggio con un significato preciso, uguale in editor, nel
viewer web, sul pannello LVGL e per il validatore.

L'analisi ha scoperto **undici questioni preesistenti** negli stessi file, tutte
verificate su codice: una entra nel lavoro (F5, il colore che dipinge anche il
letterbox nel viewer `ratio` — correggere solo l'editor violerebbe la regola UI
n. 1 con la nostra stessa correzione), tre diventano un branch di manutenzione
successivo, cinque diventano `Q35`-`Q39`. Sono raccolte e destinate nella
sezione **Questioni fuori scope** in coda.

### Decisioni prese dal maintainer (2026-09-04)

| Tema | Decisione |
|---|---|
| Stato «fuori pagina» | **Implicito nelle coordinate.** Nessun campo nuovo nel modello. Una funzione condivisa, quattro chiamanti. Il flag esplicito `disabled` va in `OPEN_QUESTIONS.md`, non nel codice. |
| Soglia | **Bounding box interamente fuori**: nessuna intersezione con il rettangolo pagina. Un oggetto a cavallo del bordo resta attivo. |
| Superamento dell'aggancio | **Resistenza per distanza** (~24 px schermo oltre il bordo), nessun tasto modificatore: «trascinare con decisione» funziona letteralmente. |
| Resa in editor | **Grigio + attenuato**, riusando il trattamento già presente: `filter: grayscale(0.9)` + `opacity: 0.55`. |

### Vincoli da non rompere

- `overflow: visible` sull'`<svg>` radice ([SvgCanvas.tsx:1448-1451](../../sws-editor/src/canvas/SvgCanvas.tsx#L1448-L1451))
  è un fix documentato (`STATUS.md:1765`: l'ultimo pixel degli oggetti a filo
  veniva tagliato) **ed è il presupposto per vedere gli oggetti fuori pagina**.
  Risolvere il punto 1 con un `clipPath` sulla radice romperebbe il punto 3.
- `--synoptic-text` (riga 1447) deriva dalla *prop* `background`, non dalla
  proprietà CSS: non si tocca, o si riapre Q18 (testo scuro su scuro).
- `SvgCanvas.tsx` è un componente unico per editor **e** viewer, distinto da
  `onMove`. Ogni novità va cancellata dal ramo viewer e dalle miniature
  (`LeftPanel.tsx:268`, che monta il canvas in ramo viewer **senza** prop
  `background`).
- **Regola unica per i tre punti**: pagina in modalità fluida (`width`/`height`
  assenti) ⇒ nessun bordo ⇒ nessun fill limitato, nessuna resistenza, nessun
  oggetto fuori pagina.

## Stato di partenza del codice

| Cosa | Dove | Nota |
|---|---|---|
| Sfondo pagina | `SvgCanvas.tsx:1436` | CSS `background` sul nodo `<svg>`, che in editor è 100%×100% ⇒ invade il viewport. Origine del punto 1. |
| Bordo pagina | `SvgCanvas.tsx:1491-1498` | `<rect fill="none" strokeDasharray="6 3">`, solo edit mode. |
| Griglia | `SvgCanvas.tsx:1469-1478`, `1489` | `<pattern>` + rect `-50000..50000`, solo se `onMove && snapEnabled && gridSize > 0`. |
| Zoom/pan | `SvgCanvas.tsx:1488` | trasformazione SVG su un `<g>`, non scroll DOM. |
| Snap ai bordi pagina | `SvgCanvas.tsx` drag ~1177-1185, resize ~1069-1082 | **già implementato**, soglia `8/zoom`. Manca la resistenza, non lo snap. |
| Clamp rigido | `pageLayout.ts:99-108`, chiamato a `SvgCanvas.tsx:1209` (drag) e `1125` (resize) | Salta `line` (dx2/dy2) e `pipe` (startPoints); no-op in fluido. Solo 2 chiamanti. |
| bbox oggetto | `SvgCanvas.tsx:838-853` `objBBox` | Closure che **non cattura nulla**: già pura, 6 chiamate. |
| Trattamenti visivi | `SvgCanvas.tsx:1539-1546` `gStyle` | Unico punto d'innesto: `opacity .35` (hidden in editor), `.45 + pointerEvents none` (role), `grayscale(.9) + .55` (stale/Bad). |
| Gate rendering | `SvgCanvas.tsx:1504-1515` | `isObjectVisible`, `if (!visible && !inEdit) return null`, gate `min_role`. |

Tre scoperte dell'analisi che cambiano il perimetro:

- **Gli oggetti fuori pagina sono già raggiungibili oggi**: le frecce
  (`EditorShell.tsx:474-490`) e i campi x/y del pannello non clampano, e basta
  rimpicciolire `width` della pagina. Il punto 3 ha quindi effetto **immediato
  sui progetti esistenti**, anche senza il punto 2 → vedi rischio R8.
- **Difetto preesistente nel resize** (`SvgCanvas.tsx:1125`): con la maniglia
  destra oltre `pageWidth`, `clampToPage` restituisce `x = pageW - w`, quindi
  **il bordo sinistro si sposta a sinistra** mentre si allarga (x=1000 w=200 su
  pagina 1280, w→400 ⇒ x=880). Il punto 2 lo corregge togliendo quel clamp.
- **Divergenza d'ordine sui binding**: il web risolve i binding *dentro*
  `SvgObject` (~:2857), cioè **dopo** il gate di pagina; LVGL fa
  `apply_bindings` + `punti_ancorati` **prima** di `is_visible` (:6117-6138).
  Il gate va sulle coordinate **scritte**, e in LVGL va **anticipato**.

---

## Punto 1 — il riempimento si ferma al bordo pagina

Il colore pagina passa da proprietà CSS sul nodo `<svg>` (spazio schermo,
incontenibile) a `<rect>` dentro il `<g>` trasformato (spazio pagina, che
pan/zoom trasformano con tutto il resto). Sull'`<svg>` resta un **desk** neutro.

**1a. Token del desk** — `sws-editor/src/theme.ts`, pattern di
`--brand-text-subtle`/`--brand-danger`: variabile solo-tema, **fuori** da
`BrandColors` (nessun override per-brand).

```ts
const VAR_CANVAS_DESK = "--brand-canvas-desk";   // accanto a VAR_TEXT_SUBTLE (:32)
const DARK_DESK  = "#0a0f1a";  // più scuro del bg app (#0f172a): il foglio galleggia
const LIGHT_DESK = "#e2e8f0";  // grigio da tavolo (bg app è #f8fafc)
```
+ una riga in `applyAppearance` (:216, blocco neutri). Non riusare
`--brand-bg` (il wrapper canvas non ha sfondo ⇒ desk indistinguibile dalla
chrome) né `--brand-surface-2` (`#f1f5f9`, indistinguibile da pagina bianca).

**1b. Rect di riempimento** — `SvgCanvas.tsx`:

```ts
// Un fill SVG non è un background CSS: gradienti e url() non si dipingono.
// Sono già fuori portata di LVGL e del selettore colore, ma un YAML scritto
// a mano può averli: in quel caso si resta al comportamento di prima invece
// di lasciare il buco del desk.
const paintableFill = !!background && !/(gradient|url)\s*\(/i.test(background);
// Editor: il desk attorno al foglio. Viewer in "ratio": le bande del
// letterbox, che oggi prendono il colore della pagina (F5). In "fixed" il
// nodo <svg> ha già le misure del foglio e non c'è nulla attorno da dipingere;
// in "fluid" non esiste un foglio.
const pageFillOn = !!pageWidth && !!pageHeight && paintableFill
                   && (!!onMove || sizeMode === "ratio");
```
- riga 1436: `background: pageFillOn ? (onMove ? "var(--brand-canvas-desk, #0a0f1a)" : "var(--brand-bg, #0f172a)") : background`
- riga 1447 (`--synoptic-text`) e 1451 (`overflow`): **non si toccano**.
- dentro il `<g>` (1488), **prima** del rect griglia — altrimenti la griglia
  sparisce dentro la pagina:
  ```tsx
  {pageFillOn && <rect x={0} y={0} width={pageWidth} height={pageHeight}
                       fill={background} pointerEvents="none" />}
  ```
- griglia (1489) e bordo tratteggiato (1491-1498): invariati. La griglia resta
  su `-50000..50000` di proposito: il desk è area di lavoro, non fuori-scena.

**1c. Il gemello nel viewer — dentro lo scope** (deciso il 2026-09-04, F5). Lo
stesso difetto esiste nel viewer web in `size_mode: ratio`
(`SvgCanvas.tsx:1434`): l'`<svg>` è 100%×100% con `viewBox` e
`preserveAspectRatio`, il contenuto va in letterbox ma il `background` CSS
**dipinge anche le bande**. Correggere solo l'editor violerebbe la regola UI
n. 1 con la nostra stessa correzione.

Il rect di fill **funziona identico nei due rami**: sta dentro il `<g>` di
riga 1488, che nel viewer esiste con trasformazione identità (zoom/pan sono
solo in editor), e le sue coordinate `0,0,W,H` sono quelle che il `viewBox`
mappa. Griglia e tratteggio restano `onMove &&`, quindi nel viewer compare il
solo fill.

**Colore delle bande: `--brand-bg`**, non il desk dell'editor. Il desk è
un'affordance di *editing* — dice «qui puoi lavorare, ma non è il foglio»; nel
viewer non c'è niente da lavorare, e le bande devono sparire nella chrome
dell'app invece di sembrare un secondo foglio. Scelta minima e reversibile: **da
confermare a schermo** nel caso 3.35, è l'unico punto del piano dove decido un
colore senza averlo mostrato.

**1d. LVGL non ha questo problema** — verificato: il display LVGL è creato alla
risoluzione della **pagina**, non dello schermo (`lvgl_render.rs:56-60`,
`:6000-6001`), quindi `apply_bg_color` sullo screen copre esattamente il
foglio. Il punto 1 non ha alcun corrispettivo Rust. Cosa accade *attorno* alla
pagina sul pannello è però indefinito → **F3**, **F4**.

---

## Punto 2 — resistenza per distanza

**2a. Funzioni pure** — `sws-editor/src/pageLayout.ts`, accanto a `clampToPage`:

```ts
/** Quanto il puntatore deve superare il bordo perché l'oggetto si sganci, in
 *  pixel SCHERMO: il chiamante divide per lo zoom, così la sensazione al tatto
 *  è identica al 25% e al 400%. */
export const PAGE_EDGE_RESIST_PX = 24;

/** Un asse del limite morbido. `candidate` è la posizione dopo lo snap,
 *  `pointer` quella grezza: la soglia si misura sul PUNTATORE, non sulla
 *  posizione snappata, che la griglia può spostare di mezzo passo. */
export function softEdgeAxis(
  candidate: number, pointer: number, size: number,
  pageSize: number | undefined, resist: number, freed: boolean,
): { pos: number; freed: boolean } {
  if (!pageSize || freed) return { pos: candidate, freed };
  const max = Math.max(0, pageSize - size);                     // come clampToPage
  const over = pointer < 0 ? -pointer : pointer > max ? pointer - max : 0;
  if (over > resist) return { pos: candidate, freed: true };    // sganciato
  return { pos: Math.min(Math.max(candidate, 0), max), freed: false }; // trattenuto
}

export function softClampToPage(
  cand: { x: number; y: number }, pointer: { x: number; y: number },
  w: number, h: number, pageW: number | undefined, pageH: number | undefined,
  resist: number, freed: { x: boolean; y: boolean },
): { x: number; y: number; freed: { x: boolean; y: boolean } }
```
Assi **indipendenti**: sganciato in X e trattenuto in Y ⇒ l'oggetto scivola
lungo il bordo inferiore mentre esce a destra. `clampToPage` resta senza
chiamanti dopo 2c/2d → **si cancella** nello stesso commit, portando la sua
motivazione (no-op in fluido) nel commento di `softEdgeAxis`.

**2b. Stato in `DragState`** (`SvgCanvas.tsx:115-131`) — una gabbia sola per
tutto ciò che si trascina:

```ts
/** Rettangolo su cui si misura il limite morbido: la bbox di TUTTO ciò che si
 *  trascina — oggetto, linea, pipe, o l'unione della multi-selezione — come
 *  scostamento dall'origine del trascinamento più le dimensioni. Una gabbia
 *  sola per il gruppo, altrimenti trattenere ogni seguace lo deformerebbe. */
cage: { offX: number; offY: number; w: number; h: number };
/** Assi già sganciati in questo trascinamento: sganciato resta sganciato
 *  fino al rilascio. */
freedX: boolean; freedY: boolean;
```
In `startDrag` (1314-1359): unione di `objBBox(anchor)` e degli `objBBox` dei
seguaci; `offX/offY` **relativi all'origine che usa la matematica del drag** —
`obj.x/obj.y` in generale, `points[0]` per le pipe (`ds.offsetX` è già
calcolato lì, :1336-1338). Inizializzazione:
```ts
// La gabbia trattiene solo ciò che era dentro: un oggetto già fuori non deve
// essere risucchiato al primo movimento del mouse.
ds.freedX = bb.x1 < 0 || bb.x1 > Math.max(0, (pageWidth ?? 0) - cageW);
```

**2c. Innesto** — sostituisce `SvgCanvas.tsx:1207-1212`, **dopo** tutta la
cascata di snap e `setSnapLines`: lo snap propone, il limite morbido dispone.
Nessun caso speciale per `line`/`pipe` (la gabbia è una bbox, non `w`/`h`):

```ts
const c = dragRef.current.cage;
const soft = softClampToPage(
  { x: newX + c.offX, y: newY + c.offY },
  { x: rawX + c.offX, y: rawY + c.offY },
  c.w, c.h, pageWidth, pageHeight, PAGE_EDGE_RESIST_PX / z,
  { x: dragRef.current.freedX, y: dragRef.current.freedY },
);
newX = soft.x - c.offX; newY = soft.y - c.offY;
dragRef.current.freedX = soft.freed.x; dragRef.current.freedY = soft.freed.y;
```
Il magnete bordo pagina (`8/z`) resta e collabora: lo snap rende *facile*
appoggiarsi al bordo, la resistenza rende *difficile* oltrepassarlo.
**Rientro**: l'asse sganciato resta sganciato fino al `mouseup` (`endDrag`
:1256 azzera `dragRef`). Rearmare a metà gesto farebbe comportare la seconda
metà del trascinamento diversamente dalla prima. Il rearm «quando la bbox è di
nuovo interamente dentro» è una riga, da valutare dopo averlo provato (R7).
**Gruppo** (1226-1239): invariato — il delta rigido parte da un'ancora
trattenuta sulla gabbia dell'unione, quindi il gruppo esce senza deformarsi.

**2d. Resize** (`SvgCanvas.tsx:1125`): si **toglie** il clamp →
`onMove(objId, { x, y, width, height })`. Il magnete a `0/pageW/2/pageW`
(1077-1078) è già il trattenimento morbido di un bordo, e il clamp odierno è il
difetto descritto sopra. Resistenza anche in resize è aggiungibile poi con la
stessa `softEdgeAxis` sul bordo trascinato; non serve alla richiesta.

**2e. Polish opzionale (~20 min)**: mentre un asse è trattenuto, disegnare il
tratteggio pagina `strokeWidth={2}` pieno — dice «ti sto trattenendo» invece di
far sembrare il canvas incantato. Costa uno `setState` per mousemove, che c'è
già (`setSnapLines`).

---

## Punto 3 — `isOffPage`, una definizione e quattro chiamanti

**3a. La definizione** (da copiare identica in Rust), a intervalli **chiusi** —
non l'intersezione stretta del rettangolo di selezione (:1103):

```ts
export function isOffPage(obj: GeomObj, pageW?: number, pageH?: number): boolean {
  if (!pageW || !pageH) return false;                  // fluido: niente è fuori
  if (obj.from_obj_id || obj.to_obj_id) return false;  // pipe agganciata: sta dove stanno i capi
  const bb = objectBBox(obj);
  return bb.x2 < 0 || bb.y2 < 0 || bb.x1 > pageW || bb.y1 > pageH;
}
```
Chiuso e non stretto perché una bbox di area zero (linea verticale su x=0,
oggetto senza `width`) col test stretto risulterebbe **fuori** e verrebbe
cancellata dal runtime; «a filo del bordo» resta dentro, che è anche la lettura
conservativa giusta. Le pipe agganciate sono escluse perché una pipe con
`points` vuoti e due capi agganciati vive nel file come `[(0,0),(0,0)]` (LVGL
`punti_ancorati` :1470-1478): per parcheggiarla si staccano i capi.

**3b. Casa in TS** — `pageLayout.ts`:
```ts
export interface BBox { x1: number; y1: number; x2: number; y2: number }
type GeomObj = Pick<SynopticObject,
  "type"|"x"|"y"|"width"|"height"|"x2"|"y2"|"points"|"from_obj_id"|"to_obj_id">;
export function objectBBox(obj: GeomObj): BBox   // il corpo di objBBox, invariato
```
In `SvgCanvas.tsx`: cancellare la closure 838-853 e
`import { objectBBox as objBBox } from "@/pageLayout"` — **le 6 chiamate non si
toccano**. Mantenere `width ?? 0` come oggi e scriverlo nel commento: il render
usa `?? 100`/`?? 50` (1516-1517), quindi un oggetto senza `width` a `x = -60` è
«fuori» per la bbox pur essendo disegnato a metà. Editor e runtime concordano
(grigio *e* nascosto); la divergenza è solo con l'occhio. Stessa scelta in Rust
con `unwrap_or(0.0)`.

**3c. Gemello Rust** — nuovo `sws-runtime/crates/sws-core/src/geometry.rs`:
`sws-core` è già la casa di `PageLayoutConfig`/`PageSizeMode` e **entrambi** i
crate ne dipendono. Firma numerica, per non accoppiare i due mirror di struct
(ADR 0002):
```rust
pub struct BBox { pub x1: f64, pub y1: f64, pub x2: f64, pub y2: f64 }
pub fn bbox_of(obj_type: &str, x: f64, y: f64, w: f64, h: f64,
               x2: Option<f64>, y2: Option<f64>, points: &[(f64, f64)]) -> BBox;
/// «Fuori pagina»: la bbox non tocca affatto il rettangolo pagina. Le quattro
/// disuguaglianze sono la definizione, e sono le stesse di `isOffPage` in
/// sws-editor/src/pageLayout.ts.
pub fn is_off_page(bb: &BBox, page_w: Option<f64>, page_h: Option<f64>) -> bool;
```
Più due adattatori sottili che non ridefiniscono niente:
`impl SynopticObject { fn bbox(&self); fn is_off_page(&self, page: &SynopticPage) }`
in `sws-web/src/synoptic.rs` (il mirror autorevole) e lo stesso in
`sws-lvgl-viewer/src/model.rs`.

**Come si evita la divergenza**: quattro chiamanti, **due** implementazioni,
**una** tabella di verità duplicata. Tre presidi:
1. la matematica sta in `sws-core::geometry` e in `pageLayout.ts`, nessun
   confronto sui bordi altrove;
2. la **stessa tabella** di ~12 casi (dentro, a filo, un pixel fuori,
   interamente fuori, area zero, oggetto più grande della pagina, fluido, pipe
   agganciata) in `sws-editor/src/pageLayout.test.ts` e in `geometry.rs`
   `#[cfg(test)]`;
3. `scripts/check_off_page.sh` statico: estrae le due tabelle, normalizza,
   `diff`; e verifica che i due crate **chiamino** `is_off_page` senza
   reimplementarlo. **Da registrare in `STATICHE` in `check_static.sh:29-39`**
   (meccanismo di copertura obbligatoria a `:51-64`: una guardia non
   classificata fa uscire `check_static.sh` con 1) e nella tabella di
   `scripts/README.md:227-266`.

   **Forma dei delimitatori** — verificato che nel repo **non esistono
   commenti-sentinella**: i delimitatori sono sempre le dichiarazioni stesse,
   `awk '/^pub const VENDORED/{f=1; next} f&&/^\];/{exit} f'`
   (`check_lvgl_symbols.sh:35-39`). Quindi la tabella va dichiarata come dato
   estraibile — `pub const CASI_FUORI_PAGINA: &[(…)]` in Rust e
   `export const CASI_FUORI_PAGINA = [...]` in TS — e la guardia deve trattare
   «non trovo più la dichiarazione» come errore esplicito, come fa
   `check_lvgl_types.sh:37-44`.

   **Precedente scoperto, e candidato a riusare la stessa guardia**: la coppia
   `sws-editor/tests/textOnBackground.test.ts` ↔ i test Q18 in
   `lvgl_render.rs:7284-7290` è già una tabella duplicata fra i due linguaggi,
   tenuta allineata **solo da una frase in prosa** («Se qui si cambia una
   soglia, va cambiata anche là»); nessuna guardia la copre. Vedi **F9**.

**3d. Punti d'innesto**

| Dove | File:riga | Cosa |
|---|---|---|
| Gate runtime web | `SvgCanvas.tsx:1510`, dopo `if (!visible && !inEdit) return null;` | `if (!inEdit && isOffPage(obj, pageWidth, pageHeight)) return null;` |
| Resa in editor | `SvgCanvas.tsx:1543` | `const offPage = inEdit && isOffPage(...)` → `if (grayed || offPage) { st.filter = "grayscale(0.9)"; st.opacity = 0.55; }` |
| LVGL | `lvgl_render.rs`, dopo il destructuring id/type (~:6117) e **prima** di `apply_bindings`/`punti_ancorati` | `if obj.is_off_page(page) { summary.skipped_off_page.push(id.into()); continue; }` + campo in `RenderSummary` (:71-74) e nella sua stampa |
| Validatore | `validate.rs:559-563`, il `for o in &p.objects` che chiama `controlla_oggetto` (definita a `:616`) | `if o.is_off_page(p) { continue; }` prima della chiamata |

**Il gate LVGL è quasi un no-op visivo, e va fatto comunque.** Verificato: gli
oggetti sono widget figli dello screen, e lo screen è grande come la pagina,
quindi LVGL **già** ritaglia un oggetto a `x: 2000` su pagina 1280 — senza
alcun controllo nostro. Le ragioni per aggiungerlo restano tre, e la prima è
sostanziale:
- **`set_pos_size` castra a `i16`** (`lvgl_render.rs:977-985`,
  `obj.x.unwrap_or(0.0).round() as i16`, nessun clamp): un oggetto parcheggiato
  molto lontano **rientra per overflow** (x = 66000 → 464 → dentro la pagina).
  Improbabile a mano, non improbabile via script o import;
- non si creano widget che non si vedranno (i pannelli sono lenti);
- `RenderSummary` (`:71-74`) diventa diagnostico: «N oggetti saltati perché
  fuori pagina» è la riga che spiega una pagina vuota senza aprire l'editor.

Note che contano:
- il grigio in editor **non** passa da `fxOn`/`previewEffects`: «fuori pagina»
  è un fatto strutturale, non un effetto runtime, e va **dopo** il ramo
  `!visible && inEdit` così vince sull'opacità 0.35;
- il gate del web sta nel ciclo di **pagina**: figli di faceplate e celle di
  griglia hanno coordinate **locali** e non devono mai passare da `isOffPage`.
  Metterlo dentro `SvgObject` è l'errore da non fare;
- **si misura sulle coordinate scritte, non su quelle risolte dai binding**:
  parcheggiare è un gesto di progetto, non uno stato del vivo. Sul web viene
  gratis; su LVGL il controllo va **anticipato** a prima di `apply_bindings`,
  altrimenti un `x` legato a un tag disabilita l'oggetto sul pannello e non nel
  browser;
- nel validatore restano attivi **id duplicati** (:549-557 — un id doppio rompe
  l'ancoraggio delle pipe, fuori pagina o no) e `unknown_fields`. Si spegne solo
  il pacco semantico per-oggetto: tag inesistenti, `target_page` che non
  risolve, funzioni mancanti;
- `collectTagIds.ts` **non si tocca**: gli oggetti parcheggiati continuano a
  sottoscrivere i loro tag. Innocuo; sganciare la sottoscrizione è un secondo
  comportamento da decidere a parte.

**3e. Domanda aperta e non-silenzio**
- `docs/OPEN_QUESTIONS.md` → **Q35 — «fuori pagina» implicito nelle coordinate
  o campo `disabled` esplicito?**, nel formato di :1784-1790 (Context /
  Options / Default for PoC = implicito / **Decided: not yet**). Nel codice
  `// TODO(open-question): Q35` sopra `isOffPage` e sopra il gemello Rust.
- **Contromisura al rischio R8**, da confermare col maintainer perché aggiunge
  un comportamento: **un** `Finding::warn` a livello **pagina** più una riga in
  `PageProps` (`EditorShell.tsx:1373`) sotto i campi dimensioni quando `n > 0`.
  Rispetta la lettera di «nessun rilievo per-oggetto» e chiude la buca.
  Firma verificata (`validate.rs:64-72`): `Finding::warn(path, message, hint)`,
  `hint` sempre presente. Il `path` di pagina usa il **`name`**, non l'`id` —
  `format!("pages[{}]", p.name)`. Modello da imitare: il rilievo sui nomi di
  pagina duplicati, `validate.rs:538-543`, che sta nel primo ciclo
  `for p in pages` (`:537-545`), separato da quello che scende negli oggetti.
  Nota: **il validatore oggi non guarda nessuna geometria** — `page.width` e
  `page.height` non sono mai letti da `validate.rs` — quindi questo sarebbe il
  primo rilievo geometrico del progetto. Vedi **F10**.

---

## Ordine di lavoro — cinque sessioni, ognuna un commit sensato da sola

Branch: `git checkout main && git checkout -b feat/T-52-limite-pagina-morbido`.

**A — punto 1, editor + viewer `ratio` (~2 h).** Token in `theme.ts`;
`paintableFill`/`pageFillOn` + rect + desk + bande in `SvgCanvas.tsx`.
Verifica: `pnpm --dir sws-editor build`, `pnpm --dir sws-editor test`,
`./scripts/check_viewer_layout.sh` e `./scripts/check_wysiwyg.sh` (i giudici di
F5). A mano: pagina 1280×800 sfondo `#123a5f` → colore dentro il tratteggio,
desk fuori; pan e zoom → il fill resta solidale al foglio; griglia accesa →
linee visibili **anche dentro** la pagina; toggle chiaro/scuro; pagina fluida →
come prima; viewer in `ratio` → le bande non sono più del colore pagina
(**confermare il colore a schermo**, 1c); viewer in `fixed` a fitScale 1 e < 1
→ invariati; miniatura LeftPanel → invariata. **Arresto pulito**, indipendente.

**B — punto 2 (~3 h).** `PAGE_EDGE_RESIST_PX` + `softEdgeAxis` +
`softClampToPage` + `pageLayout.test.ts`; `cage`/`freedX`/`freedY` in
`DragState` e `startDrag`; sostituzione in `handleMouseMove`; resize senza
clamp; cancellazione di `clampToPage`.
Verifica: build + `pnpm test` (tutta la logica è provabile a tavolino) +
`./scripts/check_multiselect_drag.sh` (misura proprio il drag di gruppo che
tocchiamo). A mano: casi 3.36-3.41. **Arresto pulito.**

**C — punto 3, lato TS (~2 h).** `objectBBox`/`isOffPage` + tabella di verità;
`SvgCanvas` importa `objectBBox as objBBox`; gate viewer + `gStyle`.
Verifica: build + test. A mano: 3.37, 3.42. **Arresto pulito con divergenza
dichiarata**: il browser salta gli oggetti fuori pagina, LVGL e validatore no —
un rigo in STATUS se la sessione finisce qui.

**D — punto 3, lato Rust (~3 h).** `sws-core/src/geometry.rs` + `pub mod` +
test; `impl` in `synoptic.rs` + skip nel validatore + test (fuori pagina con
tag inesistente → zero rilievi; lo stesso dentro → uno); `impl` in `model.rs` +
gate + `RenderSummary`; `check_off_page.sh` + registrazione in
`check_static.sh` **e** in `scripts/README.md:227-266`. Nello stesso passaggio,
costo cinque minuti in un file che stiamo già toccando: il commento **«gap
dichiarato»** accanto a `min_role`/`min_role_effect` in `model.rs:455-456`,
che la policy del modulo (`:14-24`) prescrive e che oggi manca (F1).
Verifica: da `sws-runtime/`, `cargo check --workspace --all-targets`,
`cargo test --workspace` (base 318 passati), `./scripts/check_static.sh`
(7 verdi + la nuova), `./scripts/check_lvgl_parity.sh` (nessun campo nuovo:
deve restare verde, e lo dimostra). **Arresto pulito.**

**E — documenti (~1 h).** `OPEN_QUESTIONS.md`: **cinque** voci nuove, tutte
`Decided: not yet` (l'ultima esistente è Q34, quindi Q35-Q39) —
**Q35** «fuori pagina» implicito o campo `disabled` (§3e);
**Q36** `min_role` inerte sul pannello LVGL (F1);
**Q37** cosa c'è attorno alla pagina quando il foglio non riempie lo schermo, e
LVGL che taglia dove il browser rimpicciolisce (F3+F4);
**Q38** `size_mode: ratio` senza dimensioni esplicite (F7);
**Q39** aprire o no la famiglia dei rilievi geometrici nel validatore (F10).
Poi `TESTING_GUIDE.md`
sottosezione 3.31-3.45; `docs/manual/04_editor_guide.md` un paragrafo «Il
limite della pagina» dopo LAYOUT (:107); `CHANGELOG.md` sotto `[Unreleased]`;
`STATUS.md` — sostituire il blocco :487-503 con l'esito. Se le schermate del
manuale mostrano il canvas, rilanciare `e2e/screenshots.spec.ts`: il desk le
cambia. Squash merge su `main` **solo dopo conferma del maintainer**; nessun
push senza istruzione esplicita.

## Rischi

| # | Rischio | Presidio |
|---|---|---|
| R1 | Griglia invisibile dentro la pagina se il fill finisce dopo il rect griglia | ordine dentro il `<g>`; caso 3.32 lo vede a occhio |
| R2 | Sfondo non-colore (gradiente, `url()`) ⇒ pagina trasparente sul desk | guardia `paintableFill` |
| R3 | `--synoptic-text` derivato dal desk ⇒ riapre Q18 (testo scuro su scuro) | la riga 1447 non si tocca |
| R4 | `clipPath` sull'`<svg>` radice ⇒ taglia l'ultimo pixel (STATUS:1765) **e** nasconde gli oggetti fuori pagina | il punto 1 non introduce alcun clip |
| R5 | Desk che perde nel viewer o nelle miniature | `pageFillOn` dipende da `onMove`; `check_viewer_layout.sh`, `check_wysiwyg.sh` |
| R6 | Drag di gruppo: la gabbia unione è la parte con più aritmetica | `check_multiselect_drag.sh` esiste perché questo pezzo ha già fallito due volte |
| R7 | «Sganciato resta sganciato»: chi esce e rientra nella stessa gesta non ritrova il trattenimento | scelta deliberata, da provare a mano prima di chiudere; rearm è una riga |
| R8 | **Disabilitazione silenziosa di progetti esistenti**: oggetti già fuori pagina oggi spariscono da viewer e pannello al primo aggiornamento | 3e (warn di pagina + riga in `PageProps`) + note di rilascio. È l'unico rischio che tocca dati di qualcuno |
| R9 | Grigio ambiguo: ora ha tre cause (stale, qualità Bad, fuori pagina) con la stessa resa | `<title>`/badge in LeftPanel o riga in `ObjectProps`; opzionale |
| R10 | Su LVGL il controllo dopo `apply_bindings` ⇒ pannello e browser divergono su ogni `x`/`y` legato a un tag | l'ordine delle righe è la semantica: anticiparlo |
| R11 | Figli di faceplate/griglia hanno coordinate locali | il gate resta al livello pagina |
| R12 | `width` assente: bbox `?? 0` vs render `?? 100`/`?? 50` | divergenza dichiarata nel commento, identica in Rust |
| R13 | Il gate LVGL non è verificabile a occhio (LVGL già ritagliava): un errore lì si nota solo dal `RenderSummary` | caso 3.43 va fatto con un oggetto a coordinate **negative** e uno oltre 32767, non solo «un po' fuori» |

Le questioni **preesistenti e fuori scope** affiorate durante l'analisi sono
raccolte, verificate e valutate nella sezione seguente.

## Verifica end-to-end — casi per `docs/TESTING_GUIDE.md`

Nuova sottosezione in coda alla §3 (dopo 3.30), così non si rinumera nulla:
**`### Limite pagina — bordo morbido`**

- **3.31** Pagina 1280×800: il colore riempie **solo** il rettangolo
  tratteggiato, fuori c'è il desk. Pan e zoom → il fill resta solidale al foglio.
- **3.32** Snap acceso: la griglia si vede **sia** sopra il fill **sia** sul desk.
- **3.33** Toggle chiaro/scuro: il desk segue il tema, il fill segue
  `background`/`background_dark`.
- **3.34** Pagina fluida: nessun tratteggio, nessun desk, colore su tutto — come prima.
- **3.35** Stessa pagina nel viewer. In `fisso` (a scala 1 e ridotto):
  identico a prima. In `solo proporzioni`: le bande del letterbox **non** sono
  più del colore pagina — il foglio si stacca dallo sfondo dell'app.
  **Confermare il colore delle bande a schermo.**
- **3.36** Trascina verso il bordo destro: si incolla mentre il cursore lo
  supera; **~24 px schermo** oltre, si sgancia e segue il mouse. Ripeti al 400%
  e al 25%: stessa sensazione.
- **3.37** Rilascia interamente fuori: grigio e attenuato, ancora selezionabile
  e trascinabile, il pannello mostra le x/y vere.
- **3.38** Riprendi un oggetto fuori pagina: **nessuno scatto** alla presa;
  rientra e si rilascia dove si vuole, anche a cavallo del bordo.
- **3.39** Multi-selezione verso il bordo: si trattiene come un blocco ed esce
  **senza deformarsi**.
- **3.40** `line` e `pipe`: stesso trattenimento. Una pipe con
  `from_obj_id`/`to_obj_id` **non** diventa mai fuori pagina.
- **3.41** Maniglia destra oltre il bordo: l'oggetto cresce e il suo **bordo
  sinistro non si muove** (era il difetto).
- **3.42** Viewer: l'oggetto interamente fuori **non compare**, né nella
  miniatura del LeftPanel; quello a cavallo compare, tagliato dal riquadro.
- **3.43** Stessa pagina sul pannello LVGL: fuori assente, a cavallo presente.
  Confronto a schermo col browser.
- **3.44** `POST /api/validate`: un oggetto fuori pagina con `tag` inesistente
  **non** genera rilievi; riportalo dentro → il rilievo ricompare.
- **3.45** Pagina da 1280 a 800 con un oggetto a x=900: grigio in editor,
  assente a runtime; se implementato 3e, avviso di pagina «N oggetti fuori pagina».

## Questioni fuori scope, verificate durante l'analisi

Nessuna di queste è la richiesta del maintainer. Sono difetti e divergenze
**preesistenti** che l'analisi del bordo pagina ha scoperto perché tocca gli
stessi file. Ognuna è verificata su codice, non supposta. La destinazione di
ciascuna è stata decisa dal maintainer il 2026-09-04 — vedi la tabella in
coda alla sezione.

### F1 — `min_role` / `min_role_effect` è inerte sul pannello LVGL
**Fatto.** `grep` su tutto `sws-lvgl-viewer/src/` dà **due sole righe** con
`min_role`: le dichiarazioni di campo a `model.rs:455-456`. `lvgl_render.rs`
(7000+ righe) non le menziona mai, e nel crate non esiste alcun concetto di
ruolo. Non c'è nemmeno il commento «gap dichiarato» che la policy del modulo
(`model.rs:14-24`) prescrive per i campi conosciuti-e-non-resi (presente invece
a `:181`, `:567`, `:610`).
**Cosa succede oggi.** Un oggetto `min_role: Admin` viene disegnato normalmente
sul pannello, senza attenuazione, con i suoi handler di tocco registrati.
Nessun filtro compensa: `get_synoptic` (`router.rs:3402-3424`) serializza tutti
gli oggetti e filtra solo per **zona di pagina** (`:3412`), e il client LVGL è
anonimo per costruzione (`client.rs:690-693`, `put_tag` non manda
`Authorization`). L'esito dipende dalla modalità auth:
- runtime **senza utenti definiti** → `optional_auth` inietta un `Role::Admin`
  sintetico (`router.rs:956-963`) → l'oggetto è visibile **e operabile**;
- runtime **con utenti** → `Role::Viewer` anonimo (`:991`) → `require_operator`
  (`:766`) respinge **tutte** le scritture del pannello, non solo quelle sotto
  `min_role`, e il fallimento è muto per l'operatore (solo un `eprintln!`,
  `main.rs:629-633`).

L'unico enforcement reale è **per-tag**: `tag_write_allowed`
(`router.rs:168-177`) applica `TagDef.write_min_role`. È la divisione già
dichiarata in `sws-core/src/project.rs:79` — *«è l'enforcement che il server
può davvero garantire — il min_role degli oggetti è UX»*. Quindi non è un buco
di sicurezza: è una **UX di sicurezza che sul pannello non esiste**, mentre nel
browser esiste (`SvgCanvas.tsx:1511-1515` e `:1541`). Il sospetto era già
scritto in `docs/plans/2026-08-21-scada-widgets.md:122-126` («il viewer LVGL ha
il concetto di ruolo? verificare») e la verifica non era mai stata fatta.
**Decisione: `Q36` in `OPEN_QUESTIONS.md`** (il lavoro vero è più grosso di
T-52: serve un concetto di sessione nel client LVGL, oggi anonimo per
costruzione, o almeno un ruolo da configurazione del pannello) **+ subito il
commento «gap dichiarato» accanto a `model.rs:455-456`**, in sessione D, che è
la cosa che l'analisi cercava e non ha trovato.

### F2 — Il backend DRM va in panic quando pagina e display non coincidono
**Fatto.** `main.rs:600-604` si limita a stampare un avviso, poi allocca
`frame_buf` della dimensione **pagina** (`:612`) e lo passa a
`drm.flush_rgb888` (`:667`), che itera sulle dimensioni del **display**:
`drm_display.rs:264-267` fa `row_bytes_src = self.width*3` e
`for y in 0..self.height` con lo slice `rgb888[y*row..(y+1)*row]`. Pagina
800×480 su display 1280×800 ⇒ buffer 1 152 000 byte, slice fino a 3 072 000 ⇒
**panic da indice fuori range**.
**Mitigazione esistente**: quel backend è già rifiutato a priori sui pannelli
PixsysOS da `drm_backend_blocker` (`main.rs:585-598`, Q19). Resta raggiungibile
su hardware non-Pixsys e in test.
**Decisione: branch di manutenzione dopo T-52**, commit 1 — trasformare
l'avviso in un errore netto, o ritagliare/centrare il blit come fa SDL2.

### F3 — Sul pannello, la cornice fuori pagina non viene mai dipinta
**Fatto.** Backend SDL2 (il default sui pannelli): finestra
`.fullscreen_desktop()` (`main.rs:752-767`), quindi può essere più grande della
pagina; `page_offset` centra (`:208-212`) e il loop di presentazione
(`:965-1000`) fa **solo** il `blit` del rettangolo pagina —
`grep "fill_rect\|clear()\|set_draw_color"` su `main.rs`: **zero risultati**.
La cornice attorno non è né riempita col colore pagina né azzerata per frame:
il suo contenuto non è definito da noi.
**Perché è nel tema.** È esattamente la domanda del punto 1 posta sul
dispositivo: se in editor mettiamo un desk neutro attorno al foglio, cosa c'è
attorno al foglio sul pannello? Oggi: quel che capita.
**Decisione: `Q37`**, insieme a F4 — «cosa c'è attorno alla pagina quando il
foglio non riempie lo schermo» è una decisione di prodotto, non un fix.

### F4 — LVGL taglia dove il browser rimpicciolisce
**Fatto.** Nel viewer web, `size_mode: fixed` con pagina più grande dello
spazio disponibile **riduce** mantenendo le proporzioni (`viewerFitScale`,
`pageLayout.ts:76-84`, cap a 1; motivazione a `SvgCanvas.tsx:1419-1423`: sul
WP620 le barre rubavano 90 px). In LVGL non esiste **nessuno** scale factor —
verificato: nessun `lv_disp_set_zoom`, nessuna trasformazione — e una pagina
più grande dello schermo viene **tagliata**, con un avviso a console
(`main.rs:791-796`: «quello che avanza NON si vede»).
**Impatto.** Lo stesso progetto sullo stesso dispositivo si vede intero nel
browser e mutilato sul pannello. È una divergenza WYSIWYG di prima grandezza,
molto più visibile del bordo pagina.
**Decisione: `Q37`**, insieme a F3. Non si risolve in una sessione:
implicherebbe scaling in LVGL, che è per-widget e non per-screen.

### F5 — Nel viewer web in `ratio`, il colore pagina dipinge anche il letterbox
**Fatto.** `SvgCanvas.tsx:1434`, ramo `ratio`: `{ width: "100%",
height: "100%", viewBox, preserveAspectRatio: "xMidYMid meet" }`. Il contenuto
va in letterbox, ma `style={{ background }}` (`:1436`) è sul nodo `<svg>`, che
è 100%×100% ⇒ **le bande prendono il colore della pagina**. In `fixed` il nodo
ha le misure della pagina e il problema non c'è; in `fluid` non si applica.
**Impatto.** È **lo stesso difetto del punto 1**, in un altro ramo dello stesso
componente. Se lo correggiamo solo in editor, l'editor mostra il foglio con un
bordo netto e il viewer in `ratio` continua a spalmare il colore fino ai bordi
dello schermo: la regola UI n. 1 del maintainer (WYSIWYG obbligatorio) sarebbe
violata dalla nostra stessa correzione.
**Costo.** Piccolo: `pageFillOn` perde la condizione `!!onMove` e guadagna
`sizeMode === "ratio" || !!onMove`, il rect di fill vale anche nel ramo viewer,
e il desk delle bande diventa una scelta (nero? `--brand-canvas-desk`?). Il
rischio è concentrato in `check_viewer_layout.sh` / `check_wysiwyg.sh`, che
esistono per questo.
**Decisione: dentro il punto 1**, sessione A. È l'unica delle undici che entra
in T-52; il dettaglio progettuale è in §1c.

### F6 — Il nudge con le frecce non muove le pipe
**Fatto.** `EditorShell.tsx:483-489`: il patch è `{ x, y }`, e c'è un solo caso
speciale, `if (obj.type === "line") { patch.x2 = …; patch.y2 = … }`. Le `pipe`
disegnano dai `points`, che non vengono toccati ⇒ **premere una freccia con una
pipe selezionata non la muove** (le cambia `x/y`, che per lei non sono la
geometria). Nessun clamp, in nessun ramo.
**Perché è affiorato.** È il gemello del caso già gestito nel drag, dove
`clampToPage` viene saltato proprio per `dx2/dy2` e `startPoints`. Con
`objectBBox` esportata (punto 3b) il fix diventa banale, ma resta un cambio di
comportamento non richiesto.
**Decisione: branch di manutenzione dopo T-52**, commit 2 — così riusa
`objectBBox`. Non nel branch T-52.

### F7 — In `ratio` senza width/height, l'editor zooma su un rettangolo che non disegna
**Fatto.** `editorFitSize()` (`pageLayout.ts:51-65`) ricade sulla risoluzione di
riferimento quando la pagina non ha dimensioni proprie ma la modalità è
`ratio`; `EditorShell.tsx:742-743` però passa a `SvgCanvas`
`pageWidth={currentPage?.width}` **grezzo**. Quindi «adatta pagina» inquadra
1920×1080 mentre il tratteggio non viene disegnato (la condizione a
`SvgCanvas.tsx:1492` richiede `pageWidth && pageHeight`).
**Impatto sul nostro lavoro.** In quella configurazione il punto 1 non limita
niente, il punto 2 non trattiene niente e il punto 3 non disabilita niente —
coerentemente con la regola «nessun bordo ⇒ nessun limite», ma per un motivo
sbagliato: il bordo *esiste*, semplicemente non arriva al canvas.
**Decisione: `Q38`**, non fix silenzioso. Passare `fitPageSize` come bordi
cambierebbe in un colpo fill, resistenza e off-page per tutti i progetti in
`ratio` senza dimensioni esplicite: è una decisione, non una correzione.

### F8 — La miniatura delle pagine ignora il tema
**Fatto.** `LeftPanel.tsx:257-273`: il colore sta sul `<div>` contenitore come
`background: p.background || "var(--brand-bg, #0f172a)"`, e a `SvgCanvas`
**non** viene passata la prop `background`. Quindi la miniatura usa il campo
grezzo, senza `resolvePageBackground()`: con tema scuro e pagina che dichiara
`background_dark`, la miniatura mostra il colore **chiaro**. E il fallback è la
chrome dell'app invece del colore pagina.
**Impatto.** Nessuno sul punto 1 (`pageFillOn` è falso lì, il ramo è viewer),
ma è la stessa incoerenza di tema che il punto 1 va a sistemare nel canvas.
**Decisione: branch di manutenzione dopo T-52**, commit 3 — passare
`resolvePageBackground(p.background, p.background_dark, themeMode)`.

### F9 — Esiste già una tabella di test duplicata TS↔Rust senza guardia
**Fatto.** `lvgl_render.rs:7284-7290` dichiara che i suoi casi Q18 sono «gli
STESSI di `tests/textOnBackground.test.ts`» e chiude con «Se qui si cambia una
soglia, va cambiata anche là». Verificato che i casi coincidono ancora. Ma
`grep -rn "textOnBackground" scripts/ docs/` → **zero**: l'allineamento è
garantito solo dalla prosa. Il repo ha tre guardie che confrontano letterali
TS↔Rust (`check_lvgl_symbols.sh`, `check_lvgl_types.sh`,
`check_lvgl_parity.sh`) ma **nessuna** su tabelle di casi di test.
**Impatto.** Se creiamo `check_off_page.sh` (punto 3c), il pattern esiste e
questa coppia diventa coprbile quasi gratis.
**Decisione: nota nel commit di `check_off_page.sh`** (sessione D), ed
estensione della guardia alla coppia Q18 in un secondo momento. Non allargare
la sessione D per questo.

### F10 — Il validatore non guarda nessuna geometria
**Fatto.** Verificato con `grep` su tutto `validate.rs`: le sole occorrenze di
`x`/`y`/`width`/`height` fuori dai test sono path di filesystem e la riga 799
(semantica dei `points` di una `line`). `SynopticPage.width`/`height` sono
dichiarati (`synoptic.rs:19-20`) e **mai letti** dal validatore: nessun rilievo
su oggetti di dimensione nulla o negativa, su sovrapposizioni, su oggetti fuori
pagina. Il modulo dichiara il proprio confine a `:26-30` («Non dice se una
pagina è bella…»).
**Impatto.** Il warn di 3e sarebbe il **primo** rilievo geometrico del
progetto, e apre la porta a una famiglia («oggetto di larghezza 0», «due
oggetti sovrapposti al pixel», «testo che esce dal suo box»).
**Decisione: `Q39`** per la famiglia — si registra invece di inaugurarla per
inerzia. Il warn di 3e resta da approvare a parte (è l'unico punto del piano
che aggiunge un rilievo).

### F11 — In editor un oggetto sotto `min_role` non è attenuato
**Fatto.** `SvgCanvas.tsx:1541`: il ramo è `if (!inEdit && !roleOk)`, quindi
l'attenuazione role-based esiste solo a runtime. In editor il progettista vede
l'oggetto pieno.
**Valutazione.** Probabilmente deliberato — in editor si progetta, non si
esercita un ruolo — e comunque coerente con la scelta che facciamo al punto 3d
(il grigio «fuori pagina» invece **si vede sempre**, perché è strutturale e non
un effetto runtime). Lo registro solo perché il confronto fra le due scelte
nello stesso `gStyle` va spiegato in un commento, o la prossima lettura lo
prenderà per un'incoerenza.
**Decisione: solo un commento** nel codice, contestuale a §3d (sessione C).

### Destinazione decisa (2026-09-04)

| # | Questione | Dove finisce |
|---|---|---|
| F5 | Letterbox colorato nel viewer `ratio` | **dentro il punto 1**, sessione A (§1c) |
| F1 | `min_role` inerte in LVGL | **Q36** in `OPEN_QUESTIONS.md` (sessione E) + il commento «gap dichiarato» in `model.rs:455-456` già in sessione D |
| F3+F4 | Cosa c'è attorno alla pagina sul pannello; LVGL taglia dove il web riduce | **Q37** (una voce sola: sono la stessa domanda) |
| F7 | `ratio` senza dimensioni: il bordo non arriva al canvas | **Q38** |
| F10 | Famiglia dei rilievi geometrici nel validatore | **Q39** |
| F2, F6, F8 | Panic DRM; frecce che non muovono le pipe; miniatura che ignora il tema | **branch di manutenzione dopo T-52**, sotto |
| F9 | Tabella Q18 duplicata senza guardia | nota nel commit di `check_off_page.sh` (sessione D) |
| F11 | `min_role` non attenuato in editor | commento nel codice, contestuale a §3d (sessione C) |

### Dopo T-52 — branch di manutenzione `fix/editor-pannello-minori`

Da aprire **quando T-52 è su `main`**, non prima: F6 riusa `objectBBox`
esportata dal punto 3b, e nessuna delle tre deve inquinare la verifica del
bordo pagina. Tre commit distinti, ognuno provabile da solo.

1. **F2 — panic DRM.** `main.rs:600-604` + `drm_display.rs:264-267`.
   L'avviso diventa un errore netto all'avvio, oppure il blit si ritaglia e si
   centra come già fa SDL2 (`main.rs:208-212`, `:984-991`). Un panic è la
   peggior diagnostica su un dispositivo senza console. Test: avviare
   `--backend drm` con pagina 800×480 su display di misura diversa.
2. **F6 — frecce e pipe.** `EditorShell.tsx:483-489`: al patch `{x, y}` va
   aggiunto il ramo `points` (traslazione di tutti i waypoint) accanto a quello
   `line` già presente. Test: selezionare una pipe, premere una freccia, la
   pipe si muove; con Shift si muove di un passo di griglia.
3. **F8 — miniatura e tema.** `LeftPanel.tsx:257-273`: passare
   `background={resolvePageBackground(p.background, p.background_dark, themeMode)}`
   a `SvgCanvas` invece di lasciare il colore grezzo sul `<div>`. Test: pagina
   con `background_dark` diverso, toggle del tema, la miniatura segue.

## File critici

- `sws-editor/src/canvas/SvgCanvas.tsx` — 1436, 1488-1498, 1207-1212, 1125, 838-853, 1504-1515, 1539-1546, 115-131, 1314-1359
- `sws-editor/src/pageLayout.ts` — nuove `softEdgeAxis`/`softClampToPage`/`objectBBox`/`isOffPage`, via `clampToPage`
- `sws-editor/src/theme.ts` — token desk
- `sws-runtime/crates/sws-core/src/geometry.rs` (nuovo) + `lib.rs`
- `sws-runtime/crates/sws-web/src/{synoptic.rs,validate.rs}`
- `sws-runtime/crates/sws-lvgl-viewer/src/{model.rs,lvgl_render.rs}`
- `scripts/check_off_page.sh` (nuovo) + `scripts/check_static.sh`
- `docs/{OPEN_QUESTIONS.md,TESTING_GUIDE.md,manual/04_editor_guide.md}`, `STATUS.md`, `CHANGELOG.md`
