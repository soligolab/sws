# L'editor dei simboli, fase 2 — tre sessioni, la prima nel dettaglio

> Piano del 19-11-2026, sessione di plan col maintainer dopo il collaudo della fase 1 («l'editor è estremamente
> scarno: non so come definire i punti di aggancio per i pipe»). Primo passo dell'esecuzione: copiarlo in
> `docs/plans/2026-11-19-editor-dei-simboli-fase-2.md`, riga in `docs/plans/README.md`, e aggiornare la tabella delle
> fasi di `docs/plans/2026-11-18-editor-dei-simboli.md` (che resta il piano di fondo). Codice nuovo in inglese.

## Prima, a parte: la schermata d'abbinamento del pannello (segnalata durante il piano)
Sul WP630 appena installato, `sws-editor/src/components/AbbinamentoScreen.tsx`: il **QR è minuscolo** (`QrCode size=132`
dentro una riga flex accanto a un paragrafo lungo, senza `flexShrink: 0`: il testo lo schiaccia) e **il codice va su due
righe** (26 px monospazio con `letterSpacing: 2` in una scheda di 420). Correzione: il QR sopra il testo, centrato, più
grande (circa 200 px) e non restringibile; il codice su una riga (`white-space: nowrap`, corpo che si adatta alla
larghezza). Ramo `fix/abbinamento-qr` da `main`, un test che il QR non si restringa; si vede col runtime locale senza
utenti. Arriva sui pannelli con la rc.22.

## Contesto
La fase 1 (squash `8b7bb6a30`) ha esteso le descrizioni dei simboli del progetto (`prj:`) invece di creare il formato
`sym:` del piano. Misurato oggi (tre esplorazioni):
- **Bocche dei tubi**: nei `prj:` non sono dati, il compilatore le ricava dalle flange sul bordo
  (`Costruzione::porte`, `sws-core/src/simboli_prj.rs:776-898`, nomi posizionali `n-left`, `n-right-2`). L'editor non
  le mostra, non le crea, e le operazioni che le generano (`flangia`, `tronchetto`, `bocca`) non sono selezionabili
  (`DRAWS`, `symbols/editor/model.ts:39`): spostare o cancellare una flangia lascia una bocca fantasma, cambiare la
  misura le fa sparire, aggiungere una flangia le rinumera. I tubi agganciati ricadono al centro in silenzio. Un
  simbolo nuovo non ne ha nessuna. Web e LVGL leggono già `ports` dal manifesto compilato: lì non serve niente.
- **Strumenti**: quattro (seleziona, rettangolo, ellisse, linea), angoli soli per ridimensionare, niente zoom, niente
  selezione a riquadro, niente copia/incolla, griglia solo disegnata, nessun allineamento, rotazione, colore del
  contorno, trasparenza. Il disegno nell'editor è fermo (`SimboloLibSvg` con valori fissi).
- «+ Nuovo simbolo» sta in fondo a Strumenti ▸ Simboli ▸ «Del progetto», chiuso.

**Decisioni del maintainer (19-11-2026):**
1. Si continua sulle **descrizioni `prj:`**; il formato `sym:` si decide quando servono le foto (fase 3 del piano).
2. **Le bocche diventano esplicite all'apertura**, con lo stesso nome: i tubi già collegati restano dove sono; da lì si
   spostano, si aggiungono, si cancellano.
3. Tre sessioni, in quest'ordine:
   - **sessione 1** (sotto, nel dettaglio): bocche, strumenti di disegno, vista esplosa, anteprima degli ingressi,
     «+ Nuovo simbolo» in vista;
   - **sessione 2**: **animazioni agganciate ai tag**, tutte e quattro le famiglie — rotazione (continua mentre un tag
     è vero, o all'angolo di un valore), colore/accensione/visibilità/lampeggio, movimento fra due posizioni e
     riempimento in qualunque forma, vibrazione e pulsazione — su una forma o un gruppo scelto nell'editor, su web e
     LVGL, misurate sul TY570; in pagina la sezione «Ingressi» (tag o valore fisso). **Comincia con una sessione di
     plan approfondita**: formato dei pezzi, valutatore condiviso, motori, budget del pannello. Fra le domande: **i
     gruppi**. Dalla sessione 1 uno strato si raggruppa (⧉), ma solo nell'editor e finché l'IDE è aperto; per
     animarlo il gruppo diventa un dato del simbolo, e si decide se resta lo strato o un insieme di forme scelte;
   - **sessione 3**: **importa SVG esploso** (gruppi e trasformazioni appiattiti, colori in `#rrggbb`, gradienti
     approssimati coi veli, `evenodd`/`clipPath`/`mask` lasciati con un avviso) ed **esporta/importa il simbolo** come
     file; allineare lo schema dell'assistente (`schema_simbolo`, `ai/tools.rs:1306`, dice ancora «niente colori
     liberi») al compilatore.
4. **Vista esplosa radiale**: ogni forma si allontana dal centro nella sua direzione, un cursore regola quanto; si
   seleziona e si modifica una per volta; le modifiche valgono per il simbolo vero, uscendo tutto torna al suo posto.
5. «+ Nuovo simbolo» **in testa al ramo Simboli**.

## Sessione 1 — l'editor si usa (ramo `feat/symbol-editor-tools` da `main`)

### 1. Le bocche dei tubi
- **Rust, `simboli_prj.rs`**: `explicit_ports(&Descrizione) -> Descrizione` — espande le scorciatoie
  (`flangia_v/o`, `tubo_o/v`, via `espandi` :514-553) lasciando solo le `forma`, toglie `flangia`/`tronchetto`, e
  aggiunge un `bocca {x, y, side, d, id}` per ogni bocca che il compilatore ricavava, **con lo stesso id**. Rotta
  `POST /api/symbols/explicit-ports` (in `simboli_progetto.rs`, accanto a `compila`). Test sull'intera libreria
  (`simboli-descrizioni.json`): per ognuno dei 92 simboli con bocche, prima e dopo stessi id, coordinate, lati,
  diametri; il disegno compilato uguale (stesse forme).
- **Apertura** (`symbols/editor/open.ts`): variante, copia o simbolo nuovo passano da `explicit-ports` se hanno
  operazioni di registrazione; da lì in poi le bocche sono solo `bocca`.
- **Editor**: le bocche si vedono sempre (cerchio col diametro e la freccia del lato); strumento «Bocca»: un clic
  vicino al bordo crea una bocca sul bordo più vicino (lato da lì, diametro dall'ultima o 10, id `p1`, `p2`…);
  selezionata, il pannello «Pezzo» ne mostra id, lato, diametro, x/y; si trascina (resta sul bordo se lo era); Canc la
  toglie. In «Struttura» l'elenco «Attacchi dei tubi» con, per ognuna, quanti tubi del progetto ci sono agganciati.
- **Al salvataggio**: se sparisce o cambia nome una bocca con tubi agganciati, una conferma dice quanti e dove
  finiranno (al centro); la rinomina propone di aggiornare anche i tubi.
- **Misura**: cambiando larghezza o altezza, la casella «scala il disegno» (accesa) scala forme, parti e bocche; spenta
  si comporta come oggi.
- **Validatore** (`sws-web/src/validate.rs:2236-2287`): un tubo su un `lib:` che ha una variante nel progetto si
  controlla con le bocche della variante, non della libreria.

### 2. Gli strumenti di disegno (`symbols/editor/SymbolEditor.tsx`, funzioni pure in `model.ts`)
- **Vista**: zoom con la rotella e coi pulsanti (+, −, adatta), spostamento con spazio+trascina o tasto centrale.
- **Selezione**: a riquadro, Ctrl+A, Maiusc che aggiunge e toglie (senza doppioni), Alt+clic che passa alla forma sotto.
- **Copia/incolla** (Ctrl+C/V/X) dentro l'editor, anche fra simboli aperti uno dopo l'altro nella stessa sessione.
- **Griglia e calamita**: griglia accendibile con passo 5/10/20 e aggancio; calamita su bordi e centri delle altre
  forme e sul bordo del simbolo, con le guide.
- **Allinea e distribuisci** una selezione multipla (sei allineamenti, due distribuzioni).
- **Ruota di 90° e specchia** orizzontale/verticale, scritti nella geometria (il formato non ha `transform`):
  `transformOp`/`transformPath` (`model.ts:75-170`) guadagnano rotazione a 90° e specchio (archi compresi, `H`/`V`
  riscritti in `L`).
- **Forme**: cerchio; polilinea/poligono a clic (doppio clic chiude: chiusa → `forma path`, aperta → `tratto`); il `d`
  di un tracciato modificabile come testo nel «Pezzo». (Modifica dei nodi col mouse: dopo.)
- **Pezzo**: colore del contorno di una `forma`, «nessun riempimento» (oggi un `fill:none` si legge come «colore dello
  stato», `model.ts:264-270`: si corregge), trasparenza di riempimento e contorno, tratteggio, estremità.
- **Strati**: nascondi/blocca (solo nell'editor), «sposta nello strato…».

### 3. La vista esplosa
Interruttore nella barra e un cursore (0–2× la misura): ogni elemento disegnato (`[data-op]` della compilazione con
traccia) riceve una traslazione `(centro_forma − centro_simbolo) · k`; riquadri di selezione e trascinamenti usano le
posizioni spostate e scrivono le modifiche sulla geometria vera. Funzione pura `explodedOffsets(boxes, centre, k)` in
`model.ts`, con test.

### 4. L'anteprima degli ingressi
Una sezione «Prova» nella barra di destra con un controllo per ogni ingresso del simbolo: stato (spento/acceso/
allarme), livello (cursore), girante (gira/ferma), lancetta, leva, spia — passati a `SimboloLibSvg` al posto dei valori
fissi. Spenta di default, come «Anteprima effetti».

### 5. «+ Nuovo simbolo» in testa
`editor/LeftPanel.tsx` (`RamoSimboli` :1040): il pulsante in cima al ramo Simboli, sempre visibile.

### Test e documenti
- Rust: `explicit_ports` su tutta la libreria; il validatore con la variante.
- Vitest (`symbolEditorModel.test.ts`, `symbolEditor.test.tsx`): rotazione/specchio di rect, ellisse, tracciati con
  archi; allinea/distribuisci; offsets della vista esplosa; bocca creata sul bordo, trascinata, tolta; avviso dei tubi;
  scala del disegno; zoom e riquadro (riduttore puro); anteprima che passa i valori.
- Manuale (capitolo dei simboli: le bocche e gli strumenti), CHANGELOG, voci di collaudo, `NOVITA.yaml` al rilascio.
- CasaDomotica: un simbolo del progetto con bocche esplicite e un tubo agganciato (regola di `CLAUDE.md`).

## Verifica (sessione 1)
1. Definition of done e i controlli della CI; `check_simboli_lvgl.sh` invariato (le bocche arrivano dal manifesto).
2. IDE 8460: una pompa di libreria aperta nell'editor mostra le sue bocche col nome di prima; il tubo già agganciato
   resta agganciato dopo il salvataggio; una bocca nuova su un simbolo nuovo, poi un tubo agganciato lì in pagina, sul
   web e sul TY570; spostare la bocca sposta il capo del tubo.
3. Strumenti, vista esplosa e anteprima provati a mano dal maintainer (`/test-changes`).
