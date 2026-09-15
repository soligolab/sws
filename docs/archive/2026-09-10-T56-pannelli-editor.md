# T-56 — I due pannelli dell'editor: una vista per volta a sinistra, sezioni canoniche a destra

*Piano scritto il 2026-09-10 su richiesta del maintainer: «rivedere un po' tutto lo stile grafico
del menù laterale sinistro e destro, non è molto chiara la divisione pagine/oggetti… si fondono un
po' tutte le sezioni, e a destra le proprietà andrebbero riorganizzate in modo più ordinato».
Decisioni prese lo stesso giorno: **una vista per volta** a sinistra, **sezioni canoniche** a
destra, **struttura e stile insieme**. Non ancora realizzato.*

## Contesto: perché le sezioni si fondono

Non è un'impressione, è la somma di scelte prese in momenti diversi. Misurato sul codice:

- **A sinistra sette fisarmoniche in colonna** (`LeftPanel.tsx`): Pagine, Oggetti (palette),
  Oggetti pagina, Funzioni, Tag, Sorgenti, Cronologia. Tutte con la **stessa** intestazione
  (`S.sectionHead`, L25-39), che ignora perfino il proprio parametro `open`: aperta e chiusa si
  distinguono solo per la freccia. L'unico separatore vero in tutto il pannello è il `borderTop`
  della Cronologia (L1780). Nessuna ricorda se era aperta: si riparte dai default a ogni
  montaggio, e i default aprono Pagine, Oggetti e Cronologia insieme.
- **La palette ha una terza intestazione ancora diversa** (L551-559: 10 px, `letterSpacing` 0,5,
  colore per gruppo) annidata dentro la seconda. Tre livelli visivi in venti pixel.
- **A destra il pannello proprietà non ha sezioni per due terzi della sua altezza**: per un `rect`
  sono ~14 controlli sciolti, per un `text` ~20, poi in fondo 7 sezioni pieghevoli (Trasformazione,
  Layer e visibilità, Indicatore qualità, Sicurezza, Movimento, Eventi, Binding attivi). I
  raggruppamenti in mezzo sono micro-titoli in linea, ripetuti verbatim in dieci punti
  (`SFONDO`, `TRACCE`, `GRIGLIA`, `STATI`, `PARAMETRI`…).
- **I due pannelli non condividono niente**: `S.sectionHead` a sinistra e `CollapsibleSection` a
  destra hanno colore, spaziatura, `letterSpacing`, glifo della freccia e comportamento diversi;
  a destra lo stato aperto si ricorda (`localStorage`), a sinistra no. Tre dimensioni di testo per
  righe dello stesso rango (10, 11, 12 px). Nessuna scala di spaziature: sono numeri scritti a mano
  in ogni riga.
- **Selezione multipla e multi-tipo hanno una loro lista di sezioni** (`CrossTypeProps` L1873-2036:
  POSIZIONE, ASPETTO, TRASFORMAZIONE, VISIBILITÀ, TAG, INDICATORE QUALITÀ, EVENTI) che nomina le
  stesse cose dell'oggetto singolo in modo diverso e non pieghevole.

## Le due regole che il lavoro non può violare

Da `CLAUDE.md`, «Regole UI dell'editor»:

1. **WYSIWYG obbligatorio** — riguarda il canvas, non i pannelli: qui vale solo come divieto di
   sostituire un rendering con un'anteprima semplificata. Nessun rischio in questo lavoro.
2. **Una sezione per dato** — è il vincolo vero. Riordinare **non** significa aggiungere scorciatoie:
   se `fill` finisce in «Aspetto», non può ricomparire in cima come «colore rapido». Le sezioni si
   possono rinominare, riordinare, unire; un campo resta in un posto solo.

## Cosa si fa

### 1. Una scala condivisa, e un solo posto dove vive

Nuovo `src/editor/stilePannelli.ts`: token di spaziatura (4/6/8/12), dimensioni testo
(`titoloSezione` 11, `etichetta` 11, `riga` 12, `nota` 10), altezze di riga, e **due componenti
condivisi** usati da entrambi i pannelli:

- `IntestazioneSezione` — un `<button>` (non un `div`: a destra è già accessibile, a sinistra no),
  con icona, testo, contatore opzionale, badge opzionale, freccia coerente, e **stato ricordato**
  in `localStorage` con una chiave per sezione.
- `RigaProprietà` — etichetta a sinistra e controllo a destra, con la stessa spaziatura ovunque:
  oggi ogni `field()` la ridefinisce.

I colori restano i token `--brand-*` esistenti (`theme.ts`, `branding/index.ts`). I ~25 colori
scritti a mano nei due pannelli (il verde acqua della Cronologia, i badge delle sorgenti, gli
accenti della palette) diventano token o si giustificano in un commento.

### 2. Sinistra: una vista per volta

Una **barra di icone verticale** larga ~40 px sul bordo sinistro, sempre visibile, con sei viste;
la vista scelta occupa **tutta l'altezza** del pannello. Fine della colonna che si allunga.

| Icona | Vista | Contenuto di oggi |
|---|---|---|
| 📄 | Pagine | `PagesSection` |
| ➕ | Oggetti | `ObjectPalette` (i suoi gruppi restano fisarmoniche, ma sono le uniche nel pannello) |
| 🗂 | Struttura | `ObjectsSection` (albero, gruppi, filtro, ricerca fra le pagine) |
| 🏷 | Tag | `TagsSection` |
| 🔌 | Sorgenti | `SourcesSection` |
| ƒ | Funzioni | `FunctionsSection` |

- La vista attiva si ricorda (`localStorage`, `sws.leftPanel.vista`).
- La Cronologia **non entra**: esce dal pannello per T-55, che va fatto prima o insieme.
- La larghezza del pannello resta regolabile com'è (160-480, `sws.leftPanelWidth`); la barra di
  icone è fuori dal ridimensionamento.
- Ogni vista ha una sola intestazione, con il conteggio dove serve («Struttura (12)»).

### 3. Destra: sezioni canoniche, ordine fisso

Ogni oggetto, qualunque tipo, mostra le stesse sezioni **nello stesso ordine**; quelle che non si
applicano al tipo non compaiono. Niente più controlli sciolti sopra le sezioni.

| # | Sezione | Contenuto | Default |
|---|---|---|---|
| 1 | Identità | nome, tipo · id, blocco | aperta |
| 2 | Posizione e dimensioni | x, y, w, h, ancoraggio | aperta |
| 3 | Aspetto | colore, bordo, spessore, raggio, sfumatura, sfondo, stile specifico del tipo | aperta |
| 4 | Testo | tutto il blocco testo (per i tipi che ne hanno) | chiusa |
| 5 | Dato | tag primario, formato, scala, min/max — solo per i tipi che usano un dato | aperta |
| 6 | Stati / Tracce / Parametri | la sezione «grande» del tipo (symbol, trend, faceplate, grid) | aperta |
| 7 | Movimento su percorso | com'è oggi (F6.10) | chiusa |
| 8 | Trasformazione | com'è oggi | chiusa |
| 9 | Layer e visibilità | com'è oggi | chiusa |
| 10 | Eventi | com'è oggi | chiusa |
| 11 | Sicurezza | com'è oggi | chiusa |
| 12 | Qualità | indicatore qualità + «tag di stato» per i tipi non primari | chiusa |
| 13 | Binding attivi | com'è oggi, con il contatore | chiusa |
| — | Elimina oggetto | in fondo, staccato | — |

- **`CrossTypeProps` e `MultiSelectionProps` usano le stesse sezioni e gli stessi nomi**, mostrando
  solo ciò che è comune alla selezione: oggi sono una seconda tassonomia.
- Le sezioni ricordano aperta/chiusa per **tipo di oggetto** (`sws.props.<tipo>.<sezione>`): chi
  lavora sui trend tiene aperte Tracce e Dato senza riaprirle ogni volta.
- I micro-titoli in linea spariscono: o diventano una sezione, o restano come sotto-titolo dentro
  la loro sezione, con lo stile della scala nuova.
- Il titolo «PROPRIETÀ», oggi scritto tre volte a mano, diventa una costante con la sua chiave i18n.

### 4. Stringhe

Tutte quelle toccate passano a i18n (it **e** en: il test di parità è già in `tests/i18nParita.test.ts`).
Oggi sono fisse in italiano: «PROPRIETÀ», «CRONOLOGIA», «Stato iniziale», «▶ CORRENTE», «↶ Annulla»,
«↷ Rifai», «TAG (n)», «FORMATO DATA/ORA», «GRIGLIA», i cinque titoli di `MultiSelectionProps`, i
sette di `CrossTypeProps`, «Trascina per ridimensionare».

## Come procedere, in tre passi mergiabili separatamente

1. **Fondamenta** — `stilePannelli.ts` con la scala e i due componenti condivisi; `LeftPanel` e
   `EditorShell` li adottano **senza spostare niente**. Diff grande, comportamento invariato: si
   verifica che nulla sia cambiato guardando le due schermate prima e dopo.
2. **Sinistra** — barra delle viste, una vista per volta, stato ricordato. Dipende da T-55
   (Cronologia fuori).
3. **Destra** — sezioni canoniche, `CrossTypeProps`/`MultiSelectionProps` allineati, memoria per
   tipo. È il passo più lungo: `ObjectProps` è una catena di ~65 rami e va riordinata senza perdere
   un campo. Rete di sicurezza: un test che, per ogni tipo della palette, monta il pannello e
   verifica che l'insieme dei campi resi sia **identico** a prima (elenco catturato al passo 1).

## Verifica

- `pnpm test`, `pnpm lint`, `pnpm build`, `npx tsc --noEmit`; `./scripts/check_static.sh` (le
  guardie `check_lvgl_parity` e `check_wysiwyg` toccano il pannello proprietà).
- Il test nuovo «nessun campo perso»: per ognuno dei 35 tipi, l'insieme delle etichette rese prima
  e dopo il riordino coincide.
- A mano, con `./scripts/start_editor.sh`: (1) le sei viste a sinistra si aprono e la scelta
  sopravvive al ricaricamento; (2) su `rect`, `text`, `trend`, `symbol`, `grid` le sezioni sono
  quelle della tabella, nell'ordine, e ogni campo che c'era prima c'è ancora una volta sola;
  (3) selezione multipla e multi-tipo mostrano gli stessi nomi di sezione; (4) tema chiaro e scuro,
  entrambi leggibili; (5) larghezze dei pannelli ancora regolabili e ricordate.

## Rischi

- **`ObjectProps` è enorme** (~2 700 righe): il riordino va fatto a piccoli passi verificabili, non
  in un colpo solo. Il test «nessun campo perso» è la condizione per fidarsi.
- **Una vista per volta costa un clic**: chi guarda insieme l'albero degli oggetti e la palette oggi
  li ha entrambi sott'occhio. Da provare sul campo prima di dichiararlo un miglioramento; se dà
  fastidio, la seconda opzione (due zone fisse) resta a portata.
- **Le memorie per sezione si moltiplicano** (`sws.props.<tipo>.<sezione>`): vanno tutte sotto un
  prefisso unico, così un giorno si azzerano insieme.
