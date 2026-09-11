# T-53 — i waypoint del percorso di movimento si modificano sul canvas

Ramo `feat/T-53-waypoint-sul-canvas`, da `main`.

## Contesto

`motion_path` (F6.10) è la polilinea lungo cui un oggetto si muove al variare di un tag. Oggi
esiste solo come **tabella di coordinate** nel pannello proprietà: sul disegno si vede un crocino
soltanto per la riga che si sta scrivendo, e i punti si aggiungono unicamente con la cattura ＋.
Disegnare un percorso significa immaginarlo e batterlo a macchina.

Richiesta del maintainer (STATUS, T-53): il percorso si vede e si modifica **sul disegno**, e la
tabella smette di occupare spazio. Cinque punti: tracciato visibile di default, crocini
trascinabili, Canc elimina il crocino selezionato, un segmento si può dividere o allungare,
tabella chiusa di default.

Due scelte confermate dal maintainer l'11-09-2026: i comandi «Dividi qui»/«Aggiungi in coda»
stanno in una **barretta mobile sul canvas**, e la **cattura ＋ resta** com'è (serve a posare in
fretta molti punti di fila; le maniglie nuove si fanno da parte mentre è attiva).

> Nota onesta: proponendo la barretta mobile avevo citato come precedente le azioni delle celle di
> griglia (`CellRangeMergeActions`), che invece sono rese **nel pannello** (`EditorShell.tsx:985`).
> Sul canvas una barretta così non c'è ancora. Il precedente vero è tecnico: `foreignObject` e
> maniglie con dimensioni divise per lo zoom sono già idiomi di `SvgCanvas.tsx`.

## Passo 0 — quello che è rimasto in sospeso

1. `git push origin main` (tre commit, fast-forward: `1d3f3997..e6ff656e`).
2. `git branch -D feat/T-56-pannello-destro` **dopo** il push, annotando la punta in `STATUS.md`
   accanto alle altre. Resta solo `backup/main-pre-riscrittura-2026-09-09`.
3. Ramo nuovo da `main`.

## Passo 1 — le decisioni pure, in un modulo a parte

Nuovo `sws-editor/src/canvas/percorsoMovimento.ts`: niente React, niente SVG, tutto provabile.

- `puntiMovimento(obj): {x,y}[]` — lettura **difensiva**. Il viewer LVGL accetta due forme
  (`lvgl_render.rs:5258-5276`, «perché è quello che si trova nei progetti veri»): l'editor scrive
  `[{x,y}]` ma un progetto vecchio può avere `[[x,y]]`. Senza questa normalizzazione le maniglie
  disegnano `NaN` su quei progetti.
- `dividiSegmento(punti, indice, punto)` — inserisce `punto` fra `indice` e `indice+1` (`splice`,
  non `push`: l'ordine dell'array **è** l'ordine logico da `motion_min` a `motion_max`).
- `aggiungiInCoda(punti, fallback)` — la stessa regola di oggi (`EditorShell.tsx:4538`): ultimo
  punto + 50 in x, o l'angolo dell'oggetto se l'array è vuoto.
- `eliminaWaypoint(punti, indice)` — e restituisce `undefined` quando non resta niente, perché è
  ciò che fa oggi la tabella (`EditorShell.tsx:4481`) e un `motion_path: []` salvato sarebbe
  rumore che il runtime scarta comunque.
- `cosaCancella(waypointSelezionato, idsSelezionati)` → `"waypoint" | "oggetti" | null`. È la
  **precedenza del tasto Canc**, e sta qui perché è una decisione, non una riga di handler.

Test: `sws-editor/tests/percorsoMovimento.test.ts`. Oggi non esiste **nessun** test su motion path
né sui waypoint delle pipe — questo modulo è l'occasione per avere la prima rete.

## Passo 2 — lo stato, effimero

In `sws-editor/src/store/index.ts`, accanto a `previewEffects`/`motionMarker` (L420-430,
implementazioni L1298-1303), tre valori **non persistiti e fuori dalla history**:

- `mostraTracciato: boolean`, **default `true`**;
- `waypointSelezionato: { objectId, index } | null`;
- `segmentoSelezionato: { objectId, index, punto } | null` — `punto` è dove si è cliccato, serve a
  «Dividi qui».

Effimeri di proposito: un campo persistito sull'oggetto farebbe scattare
`check_synoptic_schema.sh` e `check_lvgl_parity.sh`, e non è un dato del progetto — è una
preferenza di vista, come «Anteprima effetti». Gli ultimi due si azzerano al cambio di selezione e
di pagina, dove già si azzerano `selectedCell`/`selectedCellChild` (L880-882).

## Passo 3 — il tracciato sul canvas

`sws-editor/src/canvas/SvgCanvas.tsx`, overlay nuovo **dopo** `</g>` (L1818) e dentro il gruppo
zoom+pan (aperto L1603, chiuso L2276): lì le coordinate sono già quelle di pagina.

Condizioni: edit mode (`onMove`), **selezione singola**, `mostraTracciato`, almeno un punto.
**Non** legato ad «Anteprima effetti** — il tracciato è un ausilio di disegno, non un effetto di
runtime — né a `motion_tag`: la geometria esiste prima del tag che la percorre. (Oggi la sezione
del pannello nasconde tutto dietro `obj.motion_tag &&`: va allentato, altrimenti non si può
disegnare un percorso prima di scegliere il tag.)

Sul modello delle maniglie delle pipe (L1878-1908), che fanno già metà del lavoro:

- **polilinea** del percorso, tratteggiata, `pointerEvents: "none"`;
- **una linea-bersaglio per segmento**, `stroke="transparent"` e `strokeWidth={10 / viewT.zoom}`,
  `cursor: "pointer"` → seleziona il segmento e memorizza il punto cliccato (`toSvg`, L874-877,
  più `snap`, L879);
- **un crocino per waypoint**, `r = 5 / viewT.zoom` come le pipe (il crocino attuale a L1820-1829
  usa misure fisse in unità pagina e rimpicciolisce allo zoom out: si uniforma);
- il waypoint selezionato si distingue, ed è quello che Canc elimina;
- **barretta mobile** al punto medio del segmento scelto, in SVG puro (`rect` + `text` con
  `fontSize={11 / viewT.zoom}`) invece che in `foreignObject`: stesso idioma delle maniglie, niente
  puzzle di scala annidata, e `SvgCanvas` restituisce direttamente l'`<svg>` (L1514) quindi un
  overlay HTML richiederebbe di avvolgere la radice del componente.

**Drag**: si riusa esattamente lo schema delle pipe — `resizeRef` con `handle: "mwp-N"`, ramo
gemello in `handleMouseMove` (L1043-1072) che scrive `motion_path`. Obbligatorio aprire
`openInteraction(...)` in `onMouseDown` e lasciar chiudere a `endDrag` (L1310): `updateObject`
pusha una voce di history a ogni chiamata, e senza il bracket **ogni pixel di trascinamento
diventa un passo di annulla**.

**Convivenza con la cattura ＋**: mentre `capturePathTarget` è attivo l'intero overlay diventa
`pointerEvents: "none"`. Senza, intercetterebbe i click che devono posare i punti — il layer
oggetti è già reso inerte per lo stesso motivo (L1626).

## Passo 4 — il tasto Canc

`EditorShell.tsx:417-425`: l'handler è a livello di `document` e su Canc cancella gli oggetti
selezionati. Con un waypoint selezionato **l'oggetto è selezionato anche lui**, quindi oggi si
porterebbe via tutto l'oggetto. Il ramo nuovo consulta `cosaCancella(...)` prima di quello
esistente: `"waypoint"` → togli il punto e azzera la selezione del waypoint; `"oggetti"` →
comportamento di sempre.

## Passo 5 — il pannello

Sezione MOVIMENTO (`EditorShell.tsx:4453-4547`):

- casella **«Mostra tracciato»** in testa, legata allo stato dello store;
- la **tabella delle coordinate** entra in una `CollapsibleSection` annidata con
  `defaultOpen={false}` e un `hint` (il meccanismo c'è già, L1398-1401) — resta la via per
  correggere un punto digitando le cifre, ma non occupa più spazio a chi non la usa;
- la cattura ＋ resta dov'è;
- i pulsanti «Dividi»/«Aggiungi» **non** vanno qui: stanno sulla barretta del canvas.

Chiavi i18n nuove in **entrambe** le lingue (`tests/i18nParita.test.ts` lo impone):
`props.motionShowTrack`, `props.motionSplitHere`, `props.motionAppend`, `props.motionCoordinates`,
`props.motionCoordinatesHint`.

## Verifica

`npx tsc --noEmit`, `npx eslint src tests`, `npx vitest run`, `pnpm build`,
`./scripts/check_static.sh`. Attenzione a `check_wysiwyg.sh` (Playwright): verifica che gli
oggetti restino selezionabili, e il nuovo overlay non deve rubargli i click fuori dal tracciato.

A mano, con `./scripts/start_editor.sh`, su un oggetto con `motion_path`:

1. Selezionandolo si vedono crocini e linea, nell'ordine dei punti, **senza** «Anteprima effetti».
2. Trascinando un crocino la tabella si aggiorna; un annulla solo riporta il punto dov'era —
   non a metà del trascinamento.
3. Selezionando un crocino e premendo Canc sparisce **il crocino**, non l'oggetto.
4. Selezionando un segmento compaiono «Dividi qui» e «Aggiungi in coda», e fanno quello che
   dicono; il punto diviso finisce **fra** i due, non in fondo.
5. Con la ＋ attiva i click posano punti come prima e le maniglie non danno fastidio; Esc esce.
6. Togliendo tutti i punti, `motion_path` sparisce dal progetto invece di restare `[]`.
7. Zoom al 25 % e al 400 %: crocini e barretta restano della stessa dimensione a schermo.
8. Pagina bloccata: niente si muove.

## Rischi dichiarati

- **La history**: è la trappola più facile. Senza il bracket `openInteraction`/`endDrag` il
  trascinamento riempie la cronologia di un passo per pixel, e non si vede finché non si prova ad
  annullare.
- **Progetti con `motion_path` in forma `[[x,y]]`**: esistono, il viewer li accetta, l'editor no.
  Se `puntiMovimento` non normalizza, le maniglie escono a `NaN` proprio sui progetti vecchi.
- **L'overlay che ruba i click**: le linee-bersaglio sono spesse 10 px schermo; sopra un oggetto
  piccolo coprirebbero il suo hit-rect. Vanno disegnate solo dove passa il tracciato e rese inerti
  in cattura; `check_wysiwyg.sh` è la rete.
- **«Anteprima effetti» accesa**: l'oggetto si muove lungo `offset-path` e non è più dove dicono
  `obj.x/obj.y` (L1745-1754). Le maniglie stanno nell'overlay e usano coordinate di pagina, quindi
  non si muovono con lui — ed è giusto così: si sta modificando il percorso, non l'oggetto.

---

## Esito — 2026-09-11

**Fatto e confermato dal maintainer** («funziona come mi aspettavo»). Tutti e cinque i punti della
richiesta, con le due scelte confermate in corso d'opera: barretta mobile sul canvas, e cattura ＋
che resta.

Due difetti trovati dal maintainer al primo uso, corretti subito:

1. **Il tracciato spariva durante la cattura ＋.** Il piano diceva «l'overlay diventa
   `pointerEvents: "none"`»; nel codice era finito `!captureTarget` nella condizione, cioè non si
   disegnava affatto — e si posavano punti alla cieca proprio quando serviva vederli. Scarto fra
   quello che il piano diceva e quello che ho scritto, non fra il piano e la realtà.
2. **Rilasciando un crocino si perdeva la selezione.** Rilasciando lontano dall'elemento
   trascinato il `mouseup` cade sullo sfondo, quindi il `click` risale all'`<svg>` e `onSelect(null)`
   deseleziona l'oggetto: l'overlay spariva e il pannello saltava alle proprietà di pagina.
   `suppressClick` si alzava **solo** per la selezione a rettangolo. **Era un difetto più vecchio
   di T-53** — vale anche per i waypoint delle pipe e per le maniglie di ridimensionamento — che i
   crocini hanno solo reso facile da incontrare, perché trascinandoli si finisce quasi sempre
   lontano dal punto di partenza.

### Quello che questo lavoro ha lasciato come debito

L'anello non coperto dichiarato nel commit: **che l'handler della tastiera chiami
`cancellaWaypointScelto()`**. La funzione è provata contro lo store vero, il suo unico punto di
chiamata no — servirebbe montare `EditorShell`. Verificato a mano dal maintainer insieme al resto.

È la stessa forma di lacuna che lo stesso giorno aveva lasciato passare il `Provider` dei gruppi
del pannello destro: test che provano le due metà e nessuno il punto in cui si incontrano.
