# Il pannello proprietà ordinato per frequenza, con i tag tutti insieme

**Stato:** piano d'esecuzione, **fatto in codice e in attesa del giudizio del maintainer** sul ramo
`feat/pannello-proprieta-frequenza`, annidato su `feat/ide-stile-vscode` (vedi «Il ramo cambia»). Fasi 0-5 fatte il
01-11-2026 — vedi «Com'è andata» in fondo.

## Da dove nasce

Il maintainer, 01-11-2026, guardando il pannello destro:

> «le voci sono organizzate in modo strano e quando edito un oggetto mi trovo a dover navigare tra tutte le schede
> per le configurazioni più classiche, è poco ergonomico ma non ho idea di come riorganizzare»

E dopo aver visto la proposta:

> «vorrei che i campi dei tag associati a funzioni (dati in ingresso e uscita) fossero tutti vicini per quello che
> è possibile»

La tavola di confronto è in `sws/tmp/pannello-destro/tavola.png`, scratch e non versionata. Il maintainer l'ha
approvata.

## Cosa c'è oggi (misurato il 01-11-2026 su demo-items-web)

**I rami** sono `GRUPPI_PROPRIETA` in `sws-editor/src/editor/EditorShell.tsx`:
- tipo 🎛;
- aspetto 📐 «Posizione e aspetto»;
- dati 🔗 «Dati e collegamenti»;
- interazione ⚡ «Animazione e interazione».

**Dove finiscono le sezioni** (tabella `ORDINE_SEZIONI`):
- `parametri`, `testo`, `forma` e `dato` stanno in «tipo»;
- `identita`, `aspetto`, `transform` e `layer` stanno in «aspetto»;
- `bindings` e `quality` stanno in «dati»;
- `motion`, `events` e `security` stanno in «interazione».

**Cosa non va:**
- **Le categorie sono tecniche, non d'uso.**
  - Un bottone «normale» chiede 3 rami su 4:
    - tag, etichetta e comando sono in «tipo»;
    - il colore è in «aspetto»;
    - ruolo e conferma sono in «interazione».
  - Lo slider ha l'opposto: circa 35 campi in una sola «Parametri», con colori, comportamento e dati mescolati.
- **«Dati e collegamenti» è quasi sempre vuoto:** contiene solo l'indicatore di qualità e l'elenco dei binding.
- **Su slider e gauge la sezione «Dato» è vuota:** il tag sta in «Parametri».
- **I tag sono sparsi.** Il simbolo è l'esempio peggiore:

  | Tag | Dove sta |
  |---|---|
  | stato, allarme, comando | in testa a Parametri |
  | rotazione, lampeggio, livello | più in basso, fra i colori |
  | tag di stato per la qualità, `blink_tag` | Indicatore qualità, ramo dati |
  | `visible_tag` | Layer |
  | `motion_tag` | Movimento, ramo interazione |

- **Gli altri tipi sparsi allo stesso modo:**
  - lo slider ha `slider_pv_tag` in fondo;
  - il gauge ha `gauge_sp_tag` in «Secondo indicatore»;
  - il tubo ha livello, stato, allarme, etichetta e flusso alternati agli stili;
  - il bottone ha «Al clic, assegna» in Parametri.

## La forma decisa (01-11-2026)

Quattro rami, ordinati per frequenza d'uso.

| ramo | contenuto |
|---|---|
| 🎛 **&lt;Tipo&gt;: la funzione** | **Collegamenti** (in testa), Scala, Testo, Comando, Accesso |
| 🎨 **Aspetto** | tutti i colori, stile, traccia, tacche, font e corpi, sfondo, opacità, luminosità |
| 📐 **Posizione** | nome, X Y W H, layer e visibilità, rotazione e rifletti, movimento su percorso |
| ⚙ **Avanzate** | indicatore qualità, stale, lampeggio di qualità, eventi verso funzioni, durata transizione |

**Il primo ramo, sezione per sezione:**
- **Scala:** min, max, step, unità e decimali.
- **Testo:** etichetta e formato.
- **Comando:** modalità, valore, azione, solo lettura, scrittura al rilascio, molla, deadband.
- **Accesso:** ruolo minimo, conferma, messaggio, password.

**La sezione «Collegamenti»** è la richiesta del maintainer: tutti i tag dell'oggetto vicini.
- **Ingressi (lettura):**
  - tag principale, PV, setpoint;
  - stato, allarme;
  - livello, flusso, etichetta del tubo;
  - rotazione, lampeggio;
  - tag di stato per la qualità;
  - visibilità, movimento.
- **Uscite (scrittura):** tag comando, scritture «Al clic, assegna».
- **I 🔗 sui singoli campi** restano accanto al campo che pilotano. In «Collegamenti» compare il loro elenco, solo
  in lettura: un clic porta al campo e al suo ramo. Oggi quell'elenco è «Binding attivi», nel ramo dati.
- **I parametri delle funzioni negli eventi** restano con l'evento: staccati dalla funzione non si capiscono.

**Il ramo «Dati e collegamenti» sparisce.**

**Le regole che restano:**
- **Ogni campo in un punto solo** (regola UI n. 2 del CLAUDE.md): i campi si spostano, non si duplicano.
- **Vale per tutte e due le disposizioni,** «Classica» e «Stile VS Code», che condividono `GRUPPI_PROPRIETA`.
- **Le pagine di boot** tengono solo funzione (senza Collegamenti) e aspetto/posizione, come `GRUPPI_BOOT` oggi.

## Rivista da UI designer (01-11-2026), e approvata

La forma qui sopra è stata rivista lo stesso giorno, e il maintainer ha approvato le correzioni («Sì, mi sembra
sensato, procedi»). **Dove questa sezione contraddice quella sopra, vale questa.**

1. **Tre rami, non quattro:** 🎛 **Funzione**, 🎨 **Aspetto**, ✨ **Comportamento**.
   - **Spariscono «Posizione» e «Avanzate».** Un cassetto «Avanzate» non lo apre nessuno, perché nessuno sa cosa
     sia «avanzato».
   - **Comportamento** tiene eventi verso funzioni, movimento su percorso e durata della transizione.
2. **Una striscia fissa in testa alla colonna**, sempre visibile e fuori dai rami, come in Figma: nome, tipo/id,
   X Y W H.
   - Il resto della posizione va in Aspetto, nelle sezioni chiuse: layer, z-index, bloccato, rotazione, rifletti.
   - X, Y, W e H si cambiano quasi sempre trascinando: non meritano un ramo.
3. **L'indicatore di qualità va in «Collegamenti»,** accanto al suo tag: colori buono/incerto/errore, bordo su
   allarme, valore Bad in grigio, stale. La norma ISA-101 tratta la salute del dato come essenziale, non avanzata.
4. **I colori che dipendono da un dato stanno nella Funzione;** quelli fissi stanno in Aspetto. Quindi la
   mappatura stato→colore (acceso, spento, allarme del simbolo; colore a soglia del testo; bande e zone colorate)
   sta vicino al tag di stato che la comanda.
5. **In «Collegamenti» si vedono solo i tag collegati.**
   - Il pulsante **«+ Collega…»** elenca le funzioni libere del tipo: rotazione, lampeggio, livello, visibilità…
   - Ogni riga mostra:
     - **la direzione**, ← per l'ingresso e → per l'uscita;
     - **l'effetto scritto**, per esempio «Visibilità ← plant.mode»;
     - **il valore live** (regola WYSIWYG: dati veri quando ci sono, una lettura e niente polling in edit).
   - Il tag principale del tipo, se ce l'ha, c'è sempre, anche vuoto.
6. **Dove un tag è stato tolto dalla sua sezione**, per esempio la visibilità da Layer, resta una riga in sola
   lettura, «comandata da un tag», con il rimando a Collegamenti. Non scrive il campo, quindi la regola UI n. 2
   tiene.
7. **Il filtro «Filtra proprietà» non è più facoltativo.**
   - Sta in testa alla colonna e cerca in tutti e tre i rami.
   - È la promessa dello stile VS Code: «trovo tutto cercando», come nelle Impostazioni di VS Code.

### Come si giudica: tre compiti misurati

Tre compiti, prima e dopo, contando i rami aperti e lo scorrimento:
- **Bottone:** scrive con conferma.
- **Slider:** con il valore misurato (PV).
- **Simbolo:** con stato, allarme e rotazione.

La tavola li mostra **insieme allo stile VS Code**: il maintainer vuole valutare le due cose insieme («per vedere
se è tutto coerente e funzionale»).

### Il ramo cambia

**Il ramo sarà annidato su `feat/ide-stile-vscode`** (opzione 2 di «Un ramo alla volta»), non aperto dopo: lo
stile VS Code non si chiude prima, perché si valuta insieme a questo lavoro. Stessi file (`EditorShell.tsx`), e
rientrano insieme.

## Il lavoro grosso

**Spezzare la «Parametri» di ognuno dei 33 tipi** di `TIPI_CON_PARAMETRI` fra Collegamenti, Scala/Testo/Comando e
Aspetto. Oggi la sezione è il pezzo più piccolo che si sposta; servirà un'unità più fine, sezioni per tipo con il
loro `gruppo`.

**Il resto:**
- **Tabelle e voci:** `ORDINE_SEZIONI`, `GRUPPI_PROPRIETA`, `ramoEffettivo` e le chiavi ricordate in localStorage
  (un ramo salvato che non esiste più deve ricadere sul primo).
- **Icone:** `iconeAttivita.ts`, con «dati» che esce e «posizione» e «avanzate» che entrano.
- **i18n, test e manuale:** i18n it/en; i test del pannello destro, `campoNumero.test.tsx` (cerca «Min» nei rami) e
  il gemello `check_synoptic_schema`, se tocca gli esempi; il capitolo `docs/manual/04_editor_guide.md`.

**Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita**, in Plan mode. Serve a
decidere tipo per tipo dove va ogni campo, l'ordine dei rami di uscita e il modo di farlo a fasi senza lasciare
`main` a metà. Gli oggetti di prova sono quelli di `demo-items-web` (bottone, slider, gauge, simbolo, tubo, testo),
e lo script d'inventario è in `sws/tmp/pannello-destro/`.

## CasaDomotica

Riguarda l'IDE, non il progetto: la regola non si applica.

## Il piano di dettaglio (sessione di plan del 01-11-2026, approvato)

### Il ramo

`feat/pannello-proprieta-frequenza`, **annidato** su `feat/ide-stile-vscode` (opzione 2 di «Un ramo alla volta»,
stessi file). Rientra passando da lì, e lo squash dei rami in attesa avviene tutto insieme dopo l'ok.

### Cosa c'è oggi (misurato)

**Le sezioni e i rami:**
- `ObjectProps` (`src/editor/EditorShell.tsx:3098`) disegna sezioni sorelle (`CollapsibleSection`, `:1989`), ognuna
  con un `gruppo`.
- Dentro un ramo, `PannelloDestro` (`:1714`) le ordina con `order` tramite `Fisarmonica.registra` e
  `ORDINE_SEZIONI`. Per questo **una sezione deve essere figlia diretta della colonna**, non annidata.

**La sezione «Parametri»** (`:3972`) è un unico blocco con 33 rami `obj.type === "…"`, da circa la riga 3974 alla
5800. I campi passano da `field()` (246 usi), `RigaProprieta` (12) e `<div style={LABEL}>` a mano (128).

**I tag:**
- sono `TagInput` sparsi;
- `visible_tag` (Layer) e `motion_tag` (Movimento) stanno fuori da Parametri;
- `blink_tag` e il «Tag di stato» stanno nella qualità (`:6197`);
- `obj.bindings` (i 🔗 di `BindableInput`) è elencato in «Binding attivi» (`:6283`).

**I valori live** sono in `useAppStore(s => s.tagValues)`, già usati da `AlberoTagLive`/`RigaTagLive`.

**Le reti di sicurezza:**
- `tests/pannelloProprieta.test.tsx`, con l'inventario per tipo `tests/fixtures/campiPannelloProprieta.json` e la
  guardia «regola UI 2» sul tag;
- `tests/pannelloDestro.test.tsx`;
- `tests/campoNumero.test.tsx`.

### Le fasi (ognuna verde e committata, con istantanee al maintainer)

#### 0. La misura «prima»

Tavola in `sws/tmp/pannello-destro/` con i tre compiti, contando rami aperti e scorrimento:
- **bottone:** scrive con conferma;
- **slider:** con il valore misurato (PV);
- **simbolo:** con stato, allarme e rotazione.

Gli strumenti ci sono già: `vetrina.sh` (runtime di prova sulla porta 8658) e `foto.cjs`, con `demo-items-web`.

#### 1. I tre rami e la striscia fissa

**I rami.** `GRUPPI_PROPRIETA` diventa `funzione` 🎛 (titolo: il nome del tipo), `aspetto` 🎨 e `comportamento` ✨.
`GRUPPI_BOOT` diventa `[funzione, aspetto]`. `ORDINE_SEZIONI` è riscritto così:

| ramo | sezioni, in ordine |
|---|---|
| funzione | collegamenti, qualita, scala, testo, stati, comando, accesso, serie, parametri (residuo, finché la fase 3 lo svuota) |
| aspetto | colori, stile, forma, aspetto, layer, transform |
| comportamento | events, motion |

**Gli spostamenti di sezione:**
- `security` va in funzione e si chiama «Accesso»;
- `quality` va in funzione;
- `bindings` confluisce in Collegamenti (fase 2);
- `transform` e `layer` vanno in aspetto.

**La memoria.** Una chiave salvata con un ramo che non esiste più ricade:
- `tipo` → `funzione`;
- `dati` → `funzione`;
- `interazione` → `comportamento`.

Si legge una volta in `ramoEffettivo`; vale anche per i 📌 della Classica.

**La striscia fissa.** La sezione `identita` esce dai rami e diventa una striscia `position: sticky` in testa alla
colonna, con `order: 0`, in tutte e due le disposizioni:
- nome, tipo/id, X Y W H compatti;
- il campo del filtro (fase 4);
- 🗑 «Elimina oggetto», con l'annulla che già c'è. Oggi il bottone è in fondo al ramo aspetto.

**Le icone.** In `iconeAttivita.ts`: `tipo` → `funzione`, `dati` e `interazione` escono, `comportamento` entra.
Colori controllati dal test di contrasto.

**i18n:** `props.gruppo*` e `props.att.*`.

#### 2. «Collegamenti»

**Una tabella dichiarativa.** Nuovo file `src/editor/proprieta/slotTag.ts`, con
`SLOT_TAG: Record<tipo, SlotTag[]>`. Ogni slot dichiara:
- `campo`;
- `effetto`: la chiave i18n, per esempio «Valore misurato», «Rotazione», «Visibilità»;
- `verso`: `"in"` o `"out"`;
- `principale?`;
- `tipoSuggerito?`.

È la sola fonte dei tag di un oggetto. Valori comuni a tutti i tipi: `visible_tag` ← Visibilità, `motion_tag` ←
Posizione su percorso, `blink_tag` ← Lampeggio, il tag di stato per la qualità (`tag` dove non è il dato primario,
la lista che oggi sta in `:6207`).

**La sezione generica** è `CollegamentiSection`, nello stesso file o in `proprieta/Collegamenti.tsx`.
- **Ingressi e Uscite**, ognuno con le sue righe: freccia ← o →, effetto scritto, `TagInput`, valore live da
  `tagValues` con qualità, ✕ per scollegare (che scrive `undefined`).
- **Il tag principale** c'è sempre, anche vuoto. Gli altri slot si vedono solo se valorizzati.
- **«+ Collega…»** elenca gli slot liberi. Lo slot scelto compare vuoto, con stato locale e senza scrivere `""`.
- **Le assegnazioni «Al clic, assegna»** (`EditorAssegnazioni`) stanno nelle Uscite, con il tag comando.
- **I 🔗 di `BindableInput`** compaiono come righe in sola lettura, «proprietà ← tag/espressione», con ✕ per
  togliere (come oggi in «Binding attivi», che sparisce). Un clic porta al campo: apre il suo ramo, `scrollIntoView`
  e un breve lampo. Serve `data-campo={propName}` su `BindableInput`.
- **I tag in lista** (linee del trend, serie di barre e torte, coppie XY, righe di tabella) restano nella sezione
  «Serie» della Funzione, perché tag, etichetta e colore vanno insieme. In Collegamenti c'è una riga di riepilogo,
  «Serie: N tag», che porta lì.
- **I parametri delle funzioni negli eventi** restano con l'evento.

**Togliere i duplicati.** Dove un `TagInput` di slot stava altrove (Layer, Movimento, qualità, i rami per tipo) lo
si toglie. Al suo posto, dove serve contesto, una riga in sola lettura «comandata da un tag → Collegamenti».

**La qualità** (indicatore, colori Good/Uncertain/Bad, bordo su allarme, Bad → grigio, stale) diventa la sezione
`qualita`, subito sotto Collegamenti. Si vede solo se c'è almeno un tag d'ingresso, con lo stesso messaggio di oggi
quando manca.

#### 3. Spezzare «Parametri», a famiglie

**Il pattern.** Ogni ramo `obj.type === "X" && (…)` diventa una funzione `partiX(h): PartiTipo`, con
`PartiTipo = Partial<Record<"scala"|"testo"|"stati"|"comando"|"serie"|"colori"|"stile"|…, ReactNode>>`.
- `h` è l'oggetto degli aiutanti: `obj`, `onChange`, `t`, `field`, `numInput`, `textInput`, `colorInput`,
  `sezioneComando`, `langKeys`.
- `ObjectProps` disegna una `CollapsibleSection` per chiave presente, con il suo `gruppo`. Così le sezioni restano
  figlie dirette e l'ordine lo dà `ORDINE_SEZIONI`.
- Le funzioni vanno in `src/editor/proprieta/<famiglia>.tsx`. È anche il primo pezzo del seme
  `2026-09-22-riorganizzare-i-file-dell-editor.md` per `EditorShell`; lo si annota lì.

**Le regole di smistamento:**
- tag → Collegamenti;
- min, max, step, unità, decimali → **Scala**;
- etichetta, formato, token → **Testo** (il selettore token esce da «Dato», che sparisce);
- colori o soglie che dipendono da un valore → **Stati** (Funzione);
- colori fissi, font, corpi, traccia, tacche → **Colori** e **Stile** (Aspetto);
- modalità e valore di scrittura, solo lettura, molla, deadband, azione → **Comando**.

Ogni campo resta in un punto solo.

**Le famiglie, un commit ciascuna**, con il diff dell'inventario rivisto:

| famiglia | tipi |
|---|---|
| a | button, navbutton, page_navigator, checkbox, radio, setpoint, slider, lang_button, lang_selector |
| b | gauge, progress_bar, led, state_lamp, kpi_tile, clock, sparkline, text_list |
| c | trend, xy_plot, bar_chart, pie_chart, table, data_log, grid |
| d | alarm_viewer, alarm_history, alarm_bell, alarm_banner, recipe_panel |
| e | symbol, pipe, faceplate, image |
| f | text, forme (`forma` resta in Aspetto) |

**Alla fine «Parametri» non esiste più.** Il `<div style={LABEL}>` a mano passa a `field()`/`RigaProprieta` dove è
l'etichetta di un campo: serve al filtro e all'inventario.

#### 4. Il filtro «Filtra proprietà»

- Sta nella striscia fissa.
- **Con testo:**
  - tutti i rami si aprono in un'unica colonna, con il titolo del ramo come separatore anche in stile VS Code;
  - le righe che non corrispondono si nascondono;
  - le sezioni rimaste vuote spariscono.
- **Come si fa:** un contesto `FiltroProprieta`, e un passo DOM in `useLayoutEffect` su `[data-riga-proprieta]`.
  L'attributo, con il testo dell'etichetta, lo mettono `field()` e `RigaProprieta`; anche le righe di Collegamenti
  ci passano.
- Esc svuota; il testo non si ricorda fra un oggetto e l'altro.

#### 5. Chiusura

- **La tavola «dopo»** con i tre compiti, accanto al «prima», insieme allo stile VS Code.
- **La documentazione:**
  - il manuale `docs/manual/04_editor_guide.md` (pannello proprietà);
  - `CHANGELOG` `[Unreleased]`;
  - `NOVITA.yaml` nel blocco dopo 2.23.8, in it e en.
- **CasaDomotica:** la regola non si applica (è l'IDE).
- **I piani:**
  - `docs/plans/2026-11-01-pannello-proprieta-per-frequenza.md` e `2026-10-31-ide-stile-vscode.md` vanno in archivio
    dopo l'ok;
  - il seme di riorganizzazione dei file prende nota della cartella `proprieta/`.

### Test

**`pannelloProprieta.test.tsx`:**
- l'inventario gira i tre rami nuovi più la striscia;
- conta anche le voci del menu «+ Collega…» come campi, perché senza tag gli slot non si vedono;
- la fixture si rigenera **una volta per fase**, con il diff letto riga per riga: una voce sparita senza un nuovo
  posto è un guasto;
- la guardia «regola UI 2» si allarga **a ogni campo di `SLOT_TAG`**: al più un punto scrivibile per tipo.

**Nuovo `collegamenti.test.tsx`:**
- slot vuoti nascosti, il principale sempre presente;
- «+ Collega…» aggiunge senza scrivere `""`;
- ✕ scollega;
- il valore live da `tagValues`;
- il clic su un 🔗 apre il ramo del campo;
- la qualità compare solo con un ingresso.

**`pannelloDestro.test.tsx`:**
- tre rami;
- la memoria vecchia (`tipo`, `dati`, `interazione`) ricade sul ramo giusto;
- la striscia c'è in tutte e due le disposizioni;
- il filtro apre tutto e nasconde il resto.

**`campoNumero.test.tsx`:** il «Min» dello slider ora sta in Scala; il test già gira tutti i rami.

**`barraAttivita.test.tsx`:** le icone nuove passano il contrasto.

### Verifica

- **Definition of done:** `pnpm exec vitest run`, `pnpm build`, `./scripts/check_static.sh` (i18n, icone,
  documenti), `cargo check`, `cargo test` (invariato).
- **Dal vivo, ad ogni fase:** istantanee Playwright in `sws/tmp/pannello-destro/` mandate al maintainer. **Nessuna
  build d'immagine** finché il risultato, stile più pannello, non gli piace. Dopo: una build amd64 sul VPS e la
  prova su CasaDomotica.

## Com'è andata (01-11-2026)

| fase | commit | cosa |
|---|---|---|
| 1 | `8a854dd6` | tre rami, striscia fissa, cestino nella striscia, ordine dei livelli in Layer, rami ricordati migrati |
| 2 | `87874d51` | Collegamenti da `slotTag.ts`, tag sparsi tolti, Binding attivi e «Tag di stato» confluiti, lampeggio nel comportamento |
| 3 | `fc0b6fa2`, `46ff3e01`, `d623f07e` | `metti()`/`SEZIONI_TIPO`: Parametri divisa in Scala, Testo, Stati, Comando, Serie, Filtro, Colori, Stile |
| 4 | `7836a691` | «Filtra proprietà» sul DOM disegnato, con gli alias (chi cerca «tag» trova Collegamenti) |
| 5 | questo commit | manuale, CHANGELOG, tavola |

**Le misure** (`sws/tmp/pannello-destro/misura.sh prima|dopo`, colonna di 900 px):

| compito | prima | dopo |
|---|---|---|
| bottone che scrive con conferma | 3 rami, 0 px | 2 rami (Aspetto solo per il colore), 141 px |
| slider con il PV | 1 ramo, 308 px | 1 ramo, 80 px |
| simbolo con stato, allarme e rotazione | 1 ramo, 220 px | 1 ramo, 0 px |

**Scostamenti dal piano di dettaglio:**
- **le funzioni per tipo non sono state spostate in file `proprieta/<famiglia>.tsx`**: restano in `ObjectProps` come
  istruzioni `if (obj.type === …) { metti(…) }`, che è il passo che serviva; lo spostamento in file resta al seme
  `2026-09-22-riorganizzare-i-file-dell-editor.md`;
- **il `<div style={LABEL}>` a mano non è stato convertito**: il filtro lavora sui blocchi disegnati e sul testo che
  si legge, e non ne ha avuto bisogno;
- **in più**: la sezione **Filtro** (quali allarmi, quali ricette) e **Opacità e sfondo** (il resto della vecchia
  Aspetto).

**Da guardare al giudizio:**
- l'Indicatore qualità sta subito sotto Collegamenti come deciso, e su un oggetto con tag sono quattro righe
  prima del Testo;
- `NOVITA.yaml` non ha ancora la voce: il blocco 2.23.8 era stato giudicato pieno già per lo stile VS Code, e le due
  cose vanno descritte insieme quando si decide il blocco.
