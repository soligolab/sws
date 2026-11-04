# L'assistente disegna i simboli del progetto e compone il sinottico intero

> **Stato: piano d'esecuzione — in corso** sul ramo `feat/assistente-sinottici`, dal 03-11-2026. Nato come seme lo stesso
> giorno («va migliorato l'assistente IA per poter generare oggetti grafici svg per adattarsi al progetto al di là della
> libreria standard»), preso in mano dopo la sessione di plan del 03-11-2026: «il cliente medio vuole usare
> l'assistente per creare i sinottici e tutti gli oggetti grafici specifici per il suo caso d'uso, sia nell'industria
> che nella domotica casalinga e residenziale». Il testo del seme è nella storia git di questo file.

## Contesto

Il maintainer riferisce che il cliente medio, in fabbrica come in casa, ormai vuole che sia l'assistente a creare i
sinottici e gli oggetti grafici del suo caso d'uso. Il seme `docs/plans/2026-11-03-assistente-genera-simboli-e-sinottici.md`
diventa un piano d'esecuzione.

**Obiettivo**: da un prompt semplice («il sinottico di un impianto di tubi d'acciaio», «la planimetria di casa mia con
luci, tapparelle e clima») l'assistente:
1. propone un piano della pagina;
2. disegna i simboli che la libreria non ha, conformi come quelli di libreria (bocche per i tubi, parti vive, stile del
   progetto, LVGL);
3. propone tipi e istanze delle macchine nuove;
4. compone la pagina, che l'utente vede come diff e accetta.

**Scelte del maintainer (03-11-2026)**:
- **Formato dei simboli: tutti e due.**
  - La via normale è una **descrizione stretta** che SWS compila in Rust nello stesso SVG di `genera.py`.
  - L'**SVG libero** resta per ciò che la descrizione non sa fare, validato e senza parti vive.
- **Variabili**: l'assistente si lega a quelle esistenti e per le macchine nuove propone **tipi e istanze senza sorgente**.
- **Due banchi di prova dall'inizio**: i tubi d'acciaio (industria) e una planimetria d'appartamento (domotica).
- **Prove col modello vero**, con un tetto di spesa per conversazione e i resoconti in `sws/tmp/ai-misure/`.

## Cosa c'è oggi (misurato il 03-11-2026)

- **Assistente** (`sws-web/src/ai/`):
  - 13 strumenti; `MAX_GIRI` 14 (`mod.rs:43`); `MAX_TOKENS` 16000 (`client.rs:215`);
  - la cache c'è solo sul prompt di sistema, quindi la conversazione si paga intera a ogni giro; nessun tetto di spesa;
  - `istantanea_pagina` fotografa solo quello che c'è su disco, e la chat non mostra l'immagine;
  - `proponi_modifica` manda progetto e pagine interi;
  - il diff dell'editor (`ai/riassunto.ts`) e `applyAiProposal` (`store/index.ts:2569`) non vedono né `types` né
    `custom_symbols`.
- **Simboli di libreria**: 195 file, generati da `scripts/simboli/genera.py`. La classe `Simbolo` registra chiamate
  (statico, corpo, parte, forma, luce, riflesso, tratto, bocca, più flange e tronchetti), e SVG e voce del manifesto
  dipendono solo da quelle.
  - I due motori dividono gli strati sul formato testuale esatto: `libreria.ts:108` e `simbolo_lib.rs:122`.
  - Lo stile del progetto è applicato a testo, uguale byte per byte su web e LVGL (`applicaStile.ts`,
    `stile_simboli.rs`).
- **`CustomSymbol`** (`project.rs:1669`): un altro percorso di disegno. Niente bocche, parti o stile; LVGL lo rasterizza
  intero.
- **Planimetrie**: il modello esiste già, in metri (muri, aperture, aree, blocchi). Sta in
  `sws-editor/src/planimetrie/modello.ts` e su disco in `planimetrie/<id>.yaml` (`sws-web/src/planimetrie.rs`). Il
  browser lo rende (3D) in uno sfondo di pagina.
- **Libreria della casa**: le tapparelle (`roller-shutter`), le finestre e le porte **non hanno parti vive**, quindi
  una «tapparella al 60 %» oggi non si vede. È un buon caso per un simbolo generato.
- **Tubi**: l'instradamento ortogonale fra due bocche esiste già (`canvas/tubazioni.ts`, `sws-core/src/tubazioni.rs`).
  Un tubo agganciato alle due estremità e senza punti si instrada da sé.

## Il disegno

### I simboli del progetto: `prj:<slug>`, descrizione nel progetto, compilato al volo

- **`Project.simboli: Vec<DescrizioneSimbolo>`** sta dentro `project.yaml`, senza cartelle nuove. Così deploy, backup,
  zip, istantanea e impronta lo portano già.
  - SVG e voce del manifesto sono **derivati**, mai salvati.
  - Il modello non rimanda le descrizioni che ci sono già. Il server le tiene e aggiunge quelle nuove, col trucco di
    `validate::ricomponi_script`.
- **`sws-core/src/simboli_prj.rs`**: `compila(&Descrizione) -> (svg, SimboloLib)`. È il porto Rust delle emissioni di
  `Simbolo`, di `MATERIALI`, `VELI` e `CONTORNO`, e di `regole()`, con:
  - limiti: 300 operazioni, 32 KB;
  - grammatica di `path` in lista bianca;
  - geometria dentro il viewBox, viewBox ≤ 512 e multiplo di 10.

  Lo zucchero per il modello (`flangia_v/o`, `tubo_o/v`) si espande prima di compilare.
- **Parità con `genera.py` su tutti i 195 simboli**:
  - `genera.py --descrizioni` scrive la traccia di ogni simbolo in `tests/fixtures/simboli-descrizioni.json`, e
    `--controlla` verifica che la fixture sia aggiornata;
  - il test Rust compila tutte le descrizioni e confronta byte per byte con i file in `public/symbols/lib/`.

  Le due trappole note sono l'ordine degli attributi extra (serve una lista ordinata) e l'arrotondamento di
  `f"{v:.2f}"`.
- **Rotte** (sul modello di `custom-symbols`, `router.rs:474/6146`):
  - `GET /api/project/simboli/manifest.json` e `GET /api/project/simboli/<slug>.svg?v=` (gestione e viewer);
  - `POST /api/simboli/compila`, senza stato, per l'editor e l'anteprima della chat;
  - `PUT /api/project/simboli`, con `check_versione_progetto`.
- **I due motori leggono un manifesto unito**, scelto dal prefisso:
  - **web** (`symbols/lib/libreria.ts`): uno strato del progetto sopra la libreria. Di lì passano da soli
    `useSimboloLib`, `bocchePer`, Collegamenti e il canvas. La palette ha un gruppo «Simboli del progetto»;
  - **LVGL** (`simbolo_lib.rs`): `manifesto()` unisce i due manifesti, `svg_simbolo` sceglie l'URL dal prefisso, e
    `lvgl_render.rs:13030` accetta `prj:`;
  - **validatore** (`validate.rs:1652`, `:1951`): un `prj:` che non esiste è un errore, e le bocche si controllano su
    quelle compilate.
- **SVG libero** (via secondaria, ultima fase): resta `custom:`, con due campi facoltativi nuovi, `view_box` e `ports`,
  che leggono `bocchePer`, `ancora_di` e il validatore. Si valida con `svg_ostile`, i vietati di `genera.py`, i limiti
  di dimensione e la tavola LVGL.

### Il flusso della conversazione: bozze sul server, una sola proposta

La proposta applicata vive in memoria fino a «Salva», ma l'assistente legge dal disco. Una seconda proposta
perderebbe i simboli della prima, quindi i passi intermedi sono **bozze tenute dal server per la conversazione**, non
proposte.

1. **Inventario**: `cerca_simboli`, le variabili e i tipi che ci sono.
2. **Piano della pagina**, scritto in chat: le macchine, ognuna «di libreria» o «nuova», più i tipi e le istanze.
   **L'assistente si ferma e aspetta la conferma.**
3. **Bozze dei simboli** con `bozza_simbolo`, anche più d'una nello stesso giro. Ogni bozza arriva in chat come
   miniatura.
4. **La pagina**, alla risoluzione del progetto: `valida`, poi `istantanea_pagina` con la pagina non applicata e le
   bozze, poi le correzioni.
5. **Una proposta sola**, con simboli, tipi, istanze e pagina. L'intenzione unica è la pagina, e il diff la divide in
   sezioni.

### Strumenti (aggiunti in coda, per non spostare la cache; l'elenco resta lo stesso per tutta la conversazione)

- **`cerca_simboli {testo?, famiglia?, kind?, con_parti?, con_bocche?}`** restituisce id, etichetta it/en, kind,
  viewBox, parti e bocche. Il catalogo lo genera `gen_synoptic_schema.py` dal manifesto e dalle etichette, più i
  simboli del progetto. È di sola lettura, quindi anche su MCP.
- **`schema_simbolo`** dà il formato della descrizione, i materiali, i veli e le regole di disegno: vista ortogonale,
  luce dall'alto a sinistra, tubo 8 / tronchetto 10 / flangia sul bordo con l'asse su un multiplo di 10, ingresso a
  sinistra. In più, tre esempi presi dalla fixture: pompa centrifuga, serbatoio verticale, valvola a sfera. Di sola
  lettura, anche su MCP.
- **`bozza_simbolo {descrizione | svg+view_box+ports}`** compila, valida e tiene la bozza nel banco della conversazione.
  Restituisce rilievi, bocche e parti, e manda alla chat `{t:"simbolo", slug, label, svg}`.
- **`istantanea_pagina`** guadagna `pagina` (una pagina intera non applicata) e include sempre le bozze. In
  `istantanea.rs`, dopo `copia_progetto`, scrive simboli, tipi e pagina nella copia. Senza pagina, con delle bozze,
  fotografa una **tavola dei simboli**.
- **`proponi_modifica`** guadagna `simboli: [slug]` (di default, le bozze usate dalla pagina) e porta tipi e istanze.
  Anche `valida` vede le bozze.
- **Rilievi di impaginazione nuovi** in `semantic`: due simboli che si sovrappongono, un tubo instradato che attraversa
  un oggetto che non è un suo capo. Costano poco, e al posto di uno strumento di layout.
- **Prompt** (`prompt.rs`): una sezione «Quando ti chiedono un sinottico intero», con i cinque passi sopra e queste
  regole:
  - tipi nuovi per le macchine nuove;
  - istanze senza sorgente;
  - mai `symbol_style` sul singolo oggetto;
  - al massimo 60 oggetti.

## Le fasi

Ramo `feat/assistente-sinottici`, una fase per commit, e ogni fase verde sulla definition of done.

| Fase | Cosa | File principali |
|---|---|---|
| **F0 — Costi e tetto** | Vale anche da sola: l'assistente di oggi costa meno. Vedi sotto | `ai/client.rs`, `ai/mod.rs`, `components/ChatPanel.tsx` |
| **F1 — Compilatore e parità** | La descrizione e il compilatore Rust; `genera.py --descrizioni`; il test byte per byte sui 195 simboli; i test sulle regole | `scripts/simboli/genera.py`, `sws-core/src/simboli_prj.rs`, `tests/fixtures/simboli-descrizioni.json` |
| **F2 — `prj:` nel progetto e nei motori** | `Project.simboli`, le rotte, i due motori e il validatore (vedi sopra); store e Salva con la sezione `simboli`; un simbolo scritto a mano (gabbia di laminazione: un rotore, due flange) come caso di test. `check_simboli_lvgl.sh --progetto <dir>` | `project.rs`, `router.rs`, `libreria.ts`, `simbolo_lib.rs`, `lvgl_render.rs`, `validate.rs`, `store/index.ts` |
| **F3 — Strumenti e bozze** | Gli strumenti, il banco delle bozze, l'istantanea della pagina non applicata, i rilievi di impaginazione, il prompt; l'agente finto impara `bozza_simbolo`, i tipi e le pagine intere | `ai/tools.rs`, `ai/mod.rs`, `ai/prompt.rs`, `istantanea.rs`, `validate.rs`, `gen_synoptic_schema.py` |
| **F4 — Editor** | Vedi sotto | `ai/riassunto.ts`, `store/index.ts`, `ChatPanel.tsx` |
| **F5 — Banco tubi d'acciaio** | Vedi sotto | `tests/fixtures/ai-bench/tubi-acciaio/`, `tests/ai/sinottico-tubi.json` |
| **F6 — Planimetria e banco casa** | Vedi sotto | `sws-web/src/planimetrie.rs`, `ai/tools.rs` |
| **F7 — SVG libero** (richiesta dal maintainer il 03-11-2026, non più facoltativa) | `bozza_simbolo` accetta SVG con view_box e bocche → `custom:` con bocche; validazione e tavola LVGL | `project.rs`, `router.rs`, `tubazioni.ts` |

**F0 — Costi e tetto**:
- cache automatica sull'intera richiesta, solo per Anthropic;
- `MAX_TOKENS` a 64000;
- una tabella dei prezzi per modello, e il costo nel frame `risorse`;
- il **tetto per conversazione**: `SWS_AI_TETTO_USD`, o un campo accanto alla chiave, 10 $ di default. Si controlla
  prima di ogni giro e manda il frame `tetto`;
- `MAX_GIRI` a 40 quando ci sono bozze;
- con `SWS_AI_MISURE=<dir>`, un resoconto JSON per conversazione;
- la chat mostra la spesa e il tetto.

**F4 — Editor**:
- il diff ha le sezioni Simboli (con miniatura), Tipi e Planimetrie;
- `applyAiProposal` registra `ai:types` prima di `ai:tags`, e poi `ai:simboli`;
- la chat mostra le miniature delle bozze e le istantanee (frame `immagine`);
- un bottone «Procedi» sotto il piano (facoltativo).

**F5 — Banco tubi d'acciaio**:
- un progetto vuoto a 1280×800, con cornice;
- di libreria: forno, rulliera, pompa, serbatoio, quadro, carroponte;
- nuovi: aspo svolgitore, raddrizzatrice, gabbia di formatura, saldatrice HF, sega volante;
- uno o due tipi;
- il copione finto e il test e2e;
- un test `#[ignore]` che misura col modello vero (vedi «Verifica»).

**F6 — Planimetria e banco casa**:
- l'assistente scrive una `Planimetria` nel **modello che esiste già**, in metri;
- un **disegno 2D in Rust** (`pianta_svg`: muri, porte con l'arco, finestre, aree, niente testo) diventa lo sfondo della
  pagina;
- uno strumento `pianta` dà le stanze e le finestre in pixel di pagina, per mettere luci, tapparelle e clima al posto
  giusto;
- simboli della casa di libreria, più una **tapparella `prj:` con parte `level`** generata;
- il progetto di prova ha già una quindicina di variabili in stile Home Assistant, per provare il legame con quelle che
  esistono.

## Rischi

- **Un runtime vecchio al deploy** non conosce `simboli` e mostra dei segnaposto. Serve un controllo di versione
  accanto a `simboli_mancanti` (`remote.rs:2549`).
- **La qualità del disegno è del modello.** Aiutano gli esempi dalla libreria, la tavola LVGL e il rifiuto simbolo per
  simbolo nel diff.
- **Costo e tempo** sono senza misure: la stima è di 3–6 $ e 15–30 minuti per pagina, da verificare in F5 prima di
  promettere il «prompt semplice».
- **Parità Python/Rust** sull'arrotondamento: la fixture lo dice dal primo giorno.

## In Appunti, a fine lavoro

- una libreria aziendale nel cloud (`prj:` condivisi fra progetti);
- un faceplate generato per tipo;
- le sorgenti dal catalogo dispositivi;
- uno strumento di impaginazione automatica con tubi che girano intorno agli ostacoli;
- un editor a mano delle descrizioni;
- `clear_tool_uses` lato server, se le misure lo chiedono.

## Verifica

- **Ogni fase**:
  - `cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`;
  - in F1, la parità sui 195 simboli;
  - in F2, il test LVGL su `dividi`/`prepara` del simbolo `prj:` e `check_simboli_lvgl.sh --progetto`;
  - in F3–F4, l'agente finto e l'e2e della chat.
- **Prove dal vivo** (IDE di prova dichiarato su porte libere, sempre terminato):
  - tre conversazioni per banco, con la chiave vera e il tetto;
  - resoconti, PNG finale e proposta in `sws/tmp/ai-misure/`: giri, token, costo, minuti, simboli nuovi e di libreria,
    correzioni, rilievi, giudizio del maintainer da 1 a 5;
  - poi si lavora sul prompt.
- **Collaudo del maintainer**:
  - accettare una pagina generata, salvarla, vederla nel viewer web e sul pannello LVGL;
  - collegare le istanze in Comunicazione.
- **All'avvio del ramo**: questo piano sostituisce il seme in `docs/plans/2026-11-03-assistente-genera-simboli-e-sinottici.md`,
  con la riga aggiornata in `docs/plans/README.md`. Prima di chiudere, la funzione va anche in CasaDomotica (regola del
  progetto di riferimento).

## Avanzamento

- **F0** (`6a702496`): tetto di spesa, cache su tutta la conversazione, 64000 token per turno, resoconti `SWS_AI_MISURE`.
- **F1** (`8c74764e`): `simboli_prj.rs`, parità byte per byte sui 195 simboli di `genera.py`.
- **F2** (`3f67d3d2`): `prj:` nel progetto, rotte, motori web e LVGL, validatore, avviso al deploy, guardia LVGL `--simboli`.
- **F3**: strumenti `cerca_simboli`, `schema_simbolo`, `bozza_simbolo`; banco delle bozze; istantanea di una pagina non
  proposta e tavola delle bozze; prompt del sinottico intero; avviso di due simboli che si coprono. **Scostamento dal
  piano**: l'avviso del tubo che attraversa un oggetto non c'è — il validatore ha gli id delle bocche di libreria ma
  non la loro geometria, e calcolare il percorso vorrebbe il manifesto a runtime. Per ora lo dice l'istantanea; se le
  misure di F5 mostrano tubi che passano sopra le macchine, si riprende.
- **F4**: la chat mostra le miniature delle bozze (frame `simbolo`) e le istantanee (frame `immagine`); il diff ha le
  voci tipo e simbolo e le miniature dei simboli della proposta; `applyAiProposal` registra `ai:types` prima di
  `ai:tags`, e `ai:simboli`. Il bottone «Procedi» sotto il piano non c'è (era facoltativo): si risponde scrivendo.
- **Revisione delle prime bozze col maintainer (03-11-2026)**, un punto alla volta:
  1. *dettaglio*: le bozze sono semplici quanto la libreria (mediana 16 operazioni). Decisione: **alzare la libreria**,
     seme [`2026-11-03-libreria-simboli-piu-ricca.md`](2026-11-03-libreria-simboli-piu-ricca.md); qui la regola di
     `schema_simbolo` dice «lo stesso livello della libreria» invece di «forme semplici»;
  2. *modello*: default Anthropic `claude-opus-5-5`; il banco si rifà con `kimi-k3.1-pro`;
  3. *formato*: **tutti e due** — vocabolario più largo (nel seme della libreria) e SVG libero (F7, ora richiesta).
  4. *revisione*: **la decide la persona** — dopo la tavola delle bozze l'assistente si ferma, la persona dice quali
     simboli rifare e come, e la pagina si compone solo dopo il suo via (prompt, punto 3 del giro).
  Strada facendo: il pannello LVGL tagliava i simboli a 500 px per lato (corretto, `e4842c02`).
