# Correzioni dei collaudi del 23-11-2026 — la 2.26.0-rc.30

> **Ramo unico** `fix/rc30-collaudo` da `release/2.26` (rc.29, 02f6de07), condiviso da due sessioni (decisione del
> maintainer del 23-11-2026: «un ramo unico su cui lavoriamo tutti e 3, voi due coordinatevi»). Alla fine: squash in
> `release/2.26`, versione 2.26.0-rc.30, tag, `build_rc.sh --push` (arm64, amd64, Tiny TY) e riporto in `main` con
> `git cherry-pick`. Istruzione del maintainer delle 19:45: «prepara un fix di tutte le immagini con anche quello che è
> emerso nell'altra sessione e pubblica l'ennesima rc».
>
> Due collaudi, due pezzi:
> - **WP630** (rc.29, progetto `tiny-ty`, IDE nel cloud): anomalie **A–E** e il doppio deploy col 409 (**2**), sessione
>   del WP630;
> - **PLX800** (2.27.0-dev.0 da archivio, abbinato dal cloud): anomalie **1, 3, 4, 5, 6, 7**, sessione del PLX800.
>
> Il codice nuovo nasce in inglese (regola del 13-11-2026); i nomi esistenti non si traducono di passaggio.

## Decisioni prese senza il maintainer (sera del 23-11-2026)

Il maintainer è andato via chiedendo la rc. Le domande ancora aperte di questo piano si chiudono con l'opzione **più
stretta che corregge il difetto senza cambiare il modello**, e restano scritte qui perché le si possa rivedere:

| | Domanda | Scelta per la rc.30 | Cosa resta da decidere |
|---|---|---|---|
| 1 | Rotazione: (a) dovuta, (b) mai con un PLC acceso, (c) mai senza schermo | **(a) solo al deploy**: se il progetto fa girare lo schermo, il deploy si ferma con una conferma 428 `rotate-screen` che dice del riavvio e dei PLC; «no» non tocca niente. Il resto del comportamento (avvio, salvataggio sul pannello, «Capovolto») non cambia | (b) e (c): serve sapere da dentro il container se un runtime PLC è acceso, e cosa risponde `HasDisplayCapabilities` su un PLX800 senza monitor |
| 3 | Un pannello abbinato dal cloud deve avere un Admin del dispositivo? | **No, per ora**: il deploy dalla rete locale verso un pannello che dopo la chiusura del progetto resterebbe senza account si ferma **prima** di toccare niente, e dice di farlo dal cloud. Decide il pannello: `close_locks_out` in `/api/system` (sessione di un utente del progetto, e dopo la chiusura né un Admin del dispositivo né la firma del gateway); il deploy dal cloud continua | il deploy «sostituisci progetto» in un'operazione sola sul pannello; l'Admin del dispositivo per i pannelli abbinati dal cloud |
| 6 | Finestra di manutenzione per provare il launcher del PLX800 | **Rimandata**: serve il PLX800 e il via del maintainer | tutta |
| 7 | Una riga di registro per scrittura o raggruppate | **Una riga per la prima scrittura di un tag**, le seguenti dello stesso tag nel secondo dopo in una riga con l'ultimo valore; al massimo 20 righe al secondo per socket (`ws_audit.rs`) | il raggruppamento degli slider, se il registro cresce troppo |
| A1, C2, D2, D3 | (pezzo del WP630) | l'opzione consigliata nel pezzo | — |


---

## La revisione prima della rc.30 (23-11-2026 sera)

Una revisione a più agenti del commit della parte PLX800 (`693a7398`), con una verifica avversaria per ogni rilievo, ha
trovato due difetti veri, corretti prima della rc: la domanda sulla sessione andava a `/api/auth/whoami`, che sulla porta
di gestione dei pannelli (`deploy_only_app`) non c'è — la 3 non sarebbe mai scattata e la guardia
`ogni_chiamata_dell_ide_ha_la_sua_rotta_sul_dispositivo` era rossa — e avrebbe fermato anche il deploy dal cloud di un
pannello abbinato dal cloud, che oggi funziona; e il testo della rotazione prometteva che i PLC ripartono. Una terza cosa
è diventata codice: il registro delle scritture dal socket ora raggruppa e ha un tetto (il banco delle prestazioni
scrive migliaia di valori al secondo dal socket, e sul pannello `audit.jsonl` non si pota mai).

Restano, piccoli, per dopo la rc:
- `/api/system?screen_rotation=1` non dice la rotazione già chiesta e in attesa (`rotation_attempt`, 10 minuti): un
  secondo deploy in quei minuti chiede di nuovo;
- pagina Utenti: il salvataggio all'uscita da un campo spegne la tabella mentre il fuoco arriva al campo dopo (stesso
  schema del nome visualizzato, di prima);
- `cfg.deployProjectSession` non ha una via d'uscita per un pannello con utenti del progetto, senza Admin del
  dispositivo e senza cloud;
- di prima: il socket dei tag non rifiuta le scritture sui tag calcolati come fa la REST (T-69); sul pannello
  `audit.jsonl` non si pota e si legge intero all'avvio.

## Pezzo 1 — Correzioni della rc.30 — la parte del collaudo sul WP630 (A, B, C, D, E)

> Pezzo del piano comune `docs/plans/2026-11-23-correzioni-collaudo-rc30.md`, ramo unico `fix/rc30-collaudo` da
> `release/2.26` (decisione del maintainer del 23-11-2026: «un ramo unico su cui lavoriamo tutti e 3»). Le anomalie 1-6
> sono nel pezzo della sessione PLX800.
>
> Da dove viene: collaudo della 2.26.0-rc.29 sul WP630 (`user@wp630-a-p3-07a077.local`, progetto `tiny-ty`, IDE nel
> cloud), 23-11-2026. Ogni anomalia è stata analizzata in sola lettura sul codice di `origin/release/2.26` (02f6de07,
> cioè la rc.29), da un agente per anomalia e da un secondo agente che doveva smontarne la diagnosi. Le diagnosi hanno
> retto tutte; i progetti qui sotto sono quelli **dopo** la revisione avversaria.
>
> Il codice nuovo nasce in inglese (regola del 13-11-2026); i nomi esistenti non si traducono di passaggio.

### Riepilogo

| | Anomalia | Gravità | Dove | Domande aperte |
|---|---|---|---|---|
| A | Un tag calcolato da un ingresso Bad risulta Good | dato falso mostrato come buono | runtime (Rust) | A1, A2 |
| B | Il Bad si vede solo sugli oggetti che lo chiedono | dato falso mostrato come buono | viewer web + LVGL | B1-B4 |
| C | Barra «progetto cambiato» dopo un salvataggio dalla finestra dei simboli | falso allarme; nasconde una perdita di simboli | IDE | C1, C2 |
| D | «+ nuovo ingresso…» non chiede il nome, gli ingressi si scambiano fra gli effetti | effetti collegati all'ingresso sbagliato | editor dei simboli | D1-D3 |
| E | L'editor dei simboli si ferma con «e.find is not a function» | modifiche perse | editor dei simboli | nessuna |

Ordine di lavoro proposto: **E** (piccola, chiude un arresto), **D** (stessa zona), **C**, **A**, **B** (B dopo A: A
aumenta gli oggetti Bad, e il collaudo di B va fatto con A dentro).

**Decisioni del maintainer (23-11-2026)**, tutte sull'opzione consigliata:
- **B1**: nella rc.30 l'avviso del trend e la linea interrotta; il Bad di default in 2.27.0-dev, con un piano aperto
  subito.
- **A2**: un derivato con un ingresso mai arrivato resta «mai ricevuto»; un ingresso Bad lo fa comunque Bad.
- **C1**: la perdita di simboli con la finestra aperta si corregge nella rc.30.
- **D1**: i nomi dei gruppi e «Rinomina gruppo» insieme in 2.27.0-dev; nella rc.30 il gruppo creato da «Aggiungi
  effetto» prende un nome automatico dall'effetto.

Restano aperte, con la consigliata indicata: A1, C2, D2, D3 (per la rc.30) e B2-B4 (per il piano della 2.27).

---

### A. Un tag calcolato da un ingresso Bad risulta Good

**Visto**: `ty.eth0_rx_bps` 0.0 Bad (la metrica sul WP630 non esiste), `ty.eth0_rx_kbs = round(tags['ty.eth0_rx_bps'] /
1024, 1)` 0.0 **Good**. Allarmi, storico, MQTT e viewer si fidano del valore inventato.

**Causa**: il valutatore dei derivati (`sws-runtime/src/main.rs` 998-1116) passa all'espressione solo i valori
(1066-1074) e, se la valutazione riesce, scrive sempre `set_tipizzato(id, value, TagQuality::Good)` (1091). Solo un
errore di valutazione marca Bad (18-11-2026). Lo stesso difetto all'avvio: un derivato calcolato sugli zeri della
semina («mai ricevuto», Uncertain con ts 0) esce Good.

**Correzione (rc.30)**
1. **La regola**: la qualità del derivato è la **peggiore** fra quelle dei tag che l'espressione legge
   (`expression_reads`), con pesi espliciti Good < Uncertain < Bad. `TagQuality::severity()`/`worst()` in sws-core,
   usata anche da `riepiloga`; **niente `derive(Ord)`**, perché l'ordine di dichiarazione mette Uncertain sopra Bad.
   - Escluso l'id del derivato stesso (il suo valore precedente è stato, non ingresso).
   - Un nome non dichiarato non conta per la qualità: un `warn` nel log una volta per coppia (derivato, nome).
     `tags['x']` su un nome assente resta errore → Bad come oggi.
   - Espressione senza letture (costante) → Good. Scansione impossibile (`reads` None: `tags[k]`, `tags.values()`) →
     Good come oggi, limite dichiarato nel manuale.
   - Un percorso prende la qualità della foglia, una radice (`tags['sala']['temperatura']`) quella della radice: si
     scrive nel manuale che conviene `tags['sala.temperatura']`.
   - Un errore di valutazione resta com'è: Bad, ultimo valore tenuto.
   - Il valore saturato resta Uncertain, un Bad resta Bad (`set_tipizzato`).
2. **Mai ricevuto all'avvio** — vedi la domanda A2; consigliata: se un ingresso è Bad si scrive Bad; altrimenti, finché
   il derivato è «mai ricevuto» e almeno un ingresso lo è ancora, **non si scrive niente** (niente campioni spazzatura
   nello storico, che non filtra per qualità).
3. **La scansione salta i commenti** (`#` fuori dalle stringhe, f-string comprese): oggi un `tags['x']` in un commento
   diventa un ingresso, e con la regola nuova renderebbe Bad un derivato per sempre.
4. **Il giro completo**: valuta tutte le espressioni (costanti comprese, oggi mai valutate) quando il registro dei
   derivati cambia rispetto al giro precedente (primo risveglio, deploy, salvataggio, espressione modificata) e dopo un
   `Lagged` (oggi perde transizioni in silenzio). Senza toccare `projects.rs`.
5. **Forma del codice**: una funzione pura `derived_quality(...)` e il corpo del giro estratto in
   `run_derived_round(...)` in sws-pyscript, provabile con un `TagDb` vero; in `main.rs` restano il ciclo, il `Lagged`
   e il confronto del registro. Qualità calcolate prima di consegnare lo snapshot a Python, senza clonare (il giro da
   100 ms del TY570). Il commento superato di `main.rs` 984-997 si aggiorna.

**Cambiamenti visibili** (vanno nelle Novità): i derivati con un ingresso Bad o Uncertain diventano Bad o Uncertain
(pallino, grigio dove richiesto, `/api/tags`, MQTT `null`); i loro allarmi si fermano durante il guasto; un
`'offline' if not tags['plc.disponibile'] else …` esce Bad anche quando dice il vero (vedi A1); le variabili di memoria
usate come parametri, che si perdono al riavvio, rendono non Good i derivati finché qualcuno non le riscrive.

**Test** (sws-pyscript `mod tests_expressions`, sws-core): il caso del WP630; la peggiore vince; `worst(Uncertain, Bad)
== Bad` nei due ordini; ritorno a Good a valore identico; avvio con ingressi parziali (secondo A2); il proprio valore
non è ingresso; nome non dichiarato neutro e loggato una volta; costante Good; commenti ignorati (con `#` in una
stringa); radice e foglia; catena derivato→derivato; giro completo al cambio di registro e dopo `Lagged`
(`TagDb::new(4)`); derivato che legge sé stesso senza rimbalzi; ogni derivato dei template Good con ingressi Good;
allarme su un derivato Bad che non scatta. I test D6 di `riepiloga` restano verdi.

**Collaudo**: `ty.eth0_rx_kbs` 0.0 Bad sia dopo un deploy sia dopo un riavvio; un derivato su un tag MQTT: broker
fermo → Bad, riavviato → Good; all'avvio con Home Assistant nessun campione spazzatura nel trend.

**Fuori dalla rc.30 (semi)**: tracciamento esatto delle letture (vedi A1); OPC UA server che pubblica tutto Good;
qualità negli script (`tags.read`/`tags.write`); timestamp «adesso» dei derivati con ingressi fermi (lo stale non
scatta mai); ping-pong fra due derivati che si leggono a vicenda; allarme con ritardo che scade sull'ultimo Good.

**Domande**
- **A1** — Un'espressione con un `if` che nomina più tag: la qualità dipende da **tutti i tag nominati** (statica:
  correzione piccola, ma `'offline' if not tags['plc.disponibile'] else …` esce Bad) o **solo da quelli letti davvero**
  in quel calcolo (esatta: tocca il dict della sandbox Python, in una rc)? *Consigliata: statica in rc.30, con la
  scansione senza commenti; l'esatta in un seme.* Prima di chiudere, guardare se CasaDomotica ha espressioni
  condizionali.
- **A2** — Un derivato con un ingresso mai arrivato, all'avvio: (a) Uncertain col valore calcolato sugli zeri della
  semina; (b) resta «mai ricevuto» finché tutti gli ingressi sono arrivati, ma un ingresso Bad lo fa comunque Bad.
  *Consigliata la (b)*: coerente con la decisione del 12-11-2026, e niente campioni falsi nello storico a ogni avvio.

---

### B. Il Bad si vede solo sugli oggetti che lo chiedono

**Visto**: sulla pagina SystemInfo eth0 a 0.0 e il grafico della temperatura vuoto, nessuna segnalazione. eth0 è A;
questa è la parte di presentazione.

**Causa**: decisione del 21-08-2026 (`docs/archive/2026-08-21-scada-widgets.md`): il grigio Bad (`bad_value_style:
gray`) è opt-in per oggetto, «perché le pagine esistenti non si riempiano di pallini a sorpresa». Stato oggi:
- web: grigio e stale opt-in (`SvgCanvas.tsx` 2181-2341); il pallino di qualità è di default su 9 tipi, ma sta
  **dentro** il gruppo che il grigio filtra, quindi quando l'oggetto è grigio il pallino rosso sparisce;
- LVGL: grigio e stale opt-in, pallino solo con `quality_dot: true` (diverso dal web), escluso di proposito
  dall'attenuazione; niente ⌛;
- figli di faceplate, celle di griglia, `FaceplatePopup`: nessun effetto F4 su nessuno dei due motori;
- **trend**: nessuna lettura della qualità. Lo storico si chiede con `ancora: true`, che ripete e prolunga l'ultimo
  valore: un tag Bad appare come **linea piatta a 0.0 disegnata come valida**; «In attesa di campioni…» solo se non c'è
  nessun campione. Nei secchi (finestra > 15 min) la qualità si perde (`aggregate_samples`, il web la forza a Good).

**Correzione in rc.30 (consigliata, non cambia l'aspetto dei dati buoni)**
1. **Avviso di qualità nel trend, dalla qualità live**, sui due motori: la traccia Bad marcata nella legenda, il badge
   del valore corrente con il testo di sistema al posto del numero; se nessuna traccia ha campioni Good disegnabili, al
   centro «Dato non valido» / «Invalid data» (chiave nuova `trend_bad_quality` nelle tre copie dei testi di sistema e
   in `tests/fixtures/testi-sistema.json`). La condizione «In attesa» si calcola sui campioni disegnabili. Colore neutro,
   non rosso. Web: il ramo trend passa a `TrendCanvas` la qualità live; LVGL: `update_bindings` passa la snapshot ad
   `aggiorna_trend`.
2. **Linea interrotta sui campioni grezzi Bad** (finestra ≤ 15 min): `buildRuns` (`TrendCanvas.tsx` 80-92) chiude il
   tratto anche su Bad; LVGL `dati_trend` mette `v = None`. Uncertain resta disegnato. I secchi non si toccano in rc.
3. In edit restano le sinusoidi demo; l'avviso segue la scelta B3.

**In 2.27.0-dev, con un piano da aprire subito (non un seme — regola del 09-11-2026)**: il default attivo
(`bad_value_style` assente = segnala, `"none"` per spegnerlo), segno a piena intensità **fuori** dal gruppo filtrato
(come già LVGL), posizione da `objBBox`, esclusi i tipi a più tag (trend, xy_plot, bar/pie_chart, table, data_log,
alarm_*), effetti portati ai figli di faceplate/griglia/popup con un helper unico (che riceva da fuori edit e anteprima,
non l'`isEditMode={false}` del figlio), un binding LVGL di sola qualità (senza lock degli allarmi), secchi del trend con
il conteggio dei Bad, fixture di parità condivisa, misure di CPU su WP630 e Tiny TY prima del merge.

**Test rc.30**: vitest `TrendCanvas` — serie ancorata tutta Bad con tag live Bad → avviso (non un grafico vuoto senza
testo); finestra a secchi con tag live Bad → avviso; due tracce, una Bad → la Good resta a colori; `buildRuns` esteso.
cargo — `dati_trend` mappa Bad in `None`; scena con traccia Bad contiene il testo nuovo.

**Domande**
- **B1** — Dove esce: (a) in rc.30 l'avviso del trend e la linea interrotta, il default attivo in 2.27.0-dev con un
  piano aperto subito *(consigliata: il default cambia l'aspetto di tutti i progetti in campo al primo aggiornamento e
  va misurato su due motori)*; (b) tutto in rc.30; (c) tutto in 2.27.0-dev.
- **B2** — Per la 2.27, il default: (a) attivo nei motori, opt-out `"none"` per oggetto *(consigliata)*; (b) un
  interruttore di progetto; (c) l'IDE scrive il default nel file al salvataggio (i pannelli non cambiano finché non si
  rimanda il progetto, ma i figli dei faceplate restano scoperti); (d) resta opt-in.
- **B3** — Aspetto: (a) il grigio di oggi più un «?» a piena intensità fuori dal grigio *(consigliata)*; (b) solo un
  segno o un contorno di colore riservato, senza attenuare; (c) valore sostituito da «????»/«—».
- **B4** — Minori, per il piano della 2.27: Uncertain resta il solo pallino giallo? Parità del pallino: LVGL di default
  sui 9 tipi come il web? Il led e la tabella rossi per il Bad (oggi rosso = allarme) si allineano al segno scelto?

---

### C. Barra «progetto cambiato» dopo un salvataggio dalla finestra dei simboli

**Visto** (test 3): a ogni Salva dalla finestra dei simboli l'IDE mostra la barra marrone «The project on the runtime
changed…». Il maintainer: basta l'indicazione «non salvato».

**Causa**: la finestra è un'altra pagina col suo client; `writeSymbols` (`open.ts` 169-181) fa la PUT da lì, e il
segnale «scrittura nostra» esce sul `window` della finestra. L'IDE riceve `saved` (`ponteSimboli.ts` 80-83) ma non dice
niente al sorvegliante dell'impronta, e `lastLocalSaveAt` scatta solo su `saveStatus === "ok"`: al tick dopo (≤ 3 s) la
barra. Circa un salvataggio su cinque la scampa per caso, assorbito dal battito del lock.

**Principio**: l'IDE rifissa la baseline **solo** per le scritture che ha già portato nel suo stato. Una scrittura che
lo lascia indietro deve continuare a dare la barra.

**Correzione (rc.30)**
1. `projectWatcher.ts` esporta `rebaselineProjectWatcher(source)`; `ponteSimboli.ts`, lato IDE, la chiama su `saved`.
2. **Le foto**: `uploadProjectImage` emette il segnale di scrittura nostra (oggi è una fetch grezza: anche dentro l'IDE
   una foto caricata dà la barra); `SCRITTURE_SUL_PROGETTO` include `symbols/ai/photo`. Messaggio nuovo `wrote` dalla
   finestra all'IDE, **solo** per `/api/project/images/<nome>` (non `/rename`) e `/api/symbols/ai/photo`: l'IDE chiama
   `dimenticaImmagine` e poi rifissa. Simboli, pagine e rinomina non si inoltrano: un percorso dimenticato dà una barra
   in più, mai un avviso perso.
3. **Il battito del lock** esce dalla regex delle scritture nostre (come già sul server): oggi apre un buco di circa
   3 s ogni 15 in cui un cambio esterno vero viene assorbito.
4. **Identità del progetto e lista vecchia** (vedi C1): i messaggi del ponte portano il riferimento del progetto; se
   l'IDE ha cambiato progetto, la finestra rifiuta il salvataggio e lo dice (oggi sostituirebbe **tutti** i simboli del
   progetto nuovo). La risposta `version` porta i simboli correnti dell'IDE e la finestra scrive con
   `rebaseSymbols(base, next, current)`: applica solo gli slug che ha toccato lei; se lo stesso slug è cambiato anche
   nell'IDE, rifiuta con un messaggio.
5. Una funzione per scollegare la finestra (canale, ascoltatori, `writeHooks`), usata da `pagehide` e dai test.
6. `App.tsx`: solo il commento (il polling è a 3 s). La finestra dei 20 s resta come rete; la sua rimozione va come riga
   nel seme `docs/plans/semi/2026-10-21-due-editor-sullo-stesso-progetto.md`.

**Interazione con la 2 (doppio deploy)**: C non tocca `saveAll` né il deploy automatico; chiede solo che `saveAll`
continui a mettere `saveStatus` a `"ok"` quando riesce. I due fix non si toccano a runtime (il deploy non cambia
l'impronta locale).

**Test**: da capo a fondo con timer veri — `saved` più impronta cambiata → nessuna barra; un cambio dopo senza messaggi
→ barra; `saved`/`wrote` per un altro IDE → niente; `wrote` su un'immagine → `dimenticaImmagine` e una rifissa;
`scrittureNostre` (upload 200 sì, 409/500 no; lock no; ripristino backup no, con il perché); `rebaseSymbols` con i
conflitti; due finestre su due simboli → nessuna perdita; progetto diverso → rifiuto, nessuna PUT. Il test
`ponteSimboli.test.ts` 32-35 («the window writes on its version») fissa oggi il comportamento che perde simboli: va
riscritto.

**Collaudo**: Salva / Salva come / Ripristina dalla finestra → nessuna barra; foto e «Genera foto» nella finestra →
niente barra e canvas aggiornato; seconda scheda sullo stesso progetto → lì la barra compare; due finestre → tutti e due
i cambi restano; ripristino di un backup → la barra compare (è giusta: `BackupsTab` ricarica solo i sinottici).

**Domande**
- **C1** — La perdita di simboli con la finestra aperta (due finestre su due simboli, «aggiorna dalla libreria» o una
  proposta dell'IA nell'IDE mentre la finestra è aperta: al Salva della finestra quei simboli spariscono in silenzio)
  entra in rc.30 (punto 4)? *Consigliato sì*: stessi messaggi, stesso file, perdita silenziosa.
- **C2** — «Rinomina» si toglie dalla libreria immagini **dentro la finestra dei simboli** (resta nella libreria
  dell'IDE)? *Consigliato sì*: riscrive su disco le pagine prese dall'IDE all'apertura della finestra, modifiche non
  salvate comprese, senza controllo di versione.

---

### D. «+ nuovo ingresso…» non chiede il nome, gli ingressi si scambiano fra gli effetti

**Visto** (test 5): gli effetti funzionano, ma un ingresso nuovo non chiede il nome e gli effetti si scambiano gli
ingressi. Regola chiesta dal maintainer: ciò che si crea chiede prima il nome.

**Causa**: `addIngresso` (`model.ts` 1141-1146) mette l'ingresso nuovo in testa a `ops`; `inputIds` elenca per primo il
più recente; «Aggiungi effetto» (`FxProps.tsx` 43-45) prende in silenzio `ids[0]`. A runtime web e LVGL trovano
l'ingresso per id: compilatore e motori non si toccano. Concause: `renamePart`/`removeInput` non gestiscono `ingresso`;
`freePartId` non conta gli ingressi; «Aggiungi → Ingresso» crea una `parte kind:"input"` che il compilatore rifiuta;
duplica/incolla tengono `group`; `groupOps` scarta il secondo bagliore o fiamma; **la tastiera dell'editor non arriva
alle finestre di avviso** (`SymbolEditor.tsx` 843: Invio ed Esc non funzionano nel campo di `chiedi` — già oggi in
«Salva come» — ed Esc/Canc agiscono sul disegno sotto la finestra).

**Correzione (rc.30)**
1. **Un validatore solo** in `model.ts`: `normalizeId` (trim e minuscole, come fanno già i campi di bocche e ingressi)
   e `idProblem(id, ns, taken)` con la regola del compilatore `^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$`; per ingressi e parti
   vietati `body`, `layer-*`, `fx-*` e `state` (già l'ingresso del corpo), unico fra parti e ingressi; per le bocche
   unico fra le bocche. Sostituisce la regex di `addIngresso` e `validPortId`, che oggi accettano `-in`. Fixture
   condivisa `tests/fixtures/symbol-ids.json`, letta da vitest e da un cargo test su `nome_ammesso`.
2. **Il modello riceve il nome**: `addIngresso(d, id)` inserisce in fondo alla serie di ingressi in testa (ordine di
   nascita); `addInput` col tipo ingresso crea un `ingresso`; `animateSelection` con il predicato
   `animateCreatesPart` (si chiede solo se nasce davvero una parte); `addPort(d, x, y, id)`; `freePartId` conta gli
   ingressi; nome proposto dall'i18n («acceso»/«on», poi -2, -3).
3. **Rinomina e rimozione**: `renameInput` per parti e ingressi, che riscrive ogni `effetto.input`; `removeInput` toglie
   un `ingresso`; gli effetti che seguivano un id tolto si tolgono nello stesso commit, dopo una conferma che li elenca
   (D2) — anche per «Togli animazione» e per gli strati vuoti che `animateSelection` toglie. Il campo Nome di
   «Ingressi» con stato locale ed errore in linea. `partOrigin` segna gli id nuovi, così un ingresso nuovo col nome di
   una parte appena rinominata non le ruba il collegamento in pagina.
4. **Le domande** (`askName` → `chiedi` con `valida`): «+ nuovo ingresso…» e «Aggiungi effetto» senza ingressi;
   «Aggiungi effetto» con ingressi → `scegli` fra gli ingressi (etichettati tipo · id) più «+ nuovo ingresso…»; la
   tendina dell'ingresso di un effetto; «Ingressi → Aggiungi»; «Anima…» e «Cambia con un ingresso» solo se nasce una
   parte; lo strumento Bocca (domanda al pointerup). Annulla non crea niente. Guardia: se il disegno cambia mentre la
   domanda è aperta (l'IA committa in modo asincrono), non si crea niente.
5. **Tastiera**: in testa all'ascoltatore di `SymbolEditor` `if (richiestaAperta()) return;`.
6. **Gruppi** (D1 deciso: nomi e rinomina dei gruppi in 2.27.0-dev): Ctrl+G e «Raggruppa» non chiedono il nome in
   rc.30; il gruppo creato da «Aggiungi effetto» prende un nome automatico dall'effetto (`fiamma`, `bagliore`…, poi
   -2, -3) invece di `g1`. Prima di unire, `groupPlan` dice quali bagliori o fiamme si perderebbero e si chiede conferma.
   Duplica/incolla in rc.30: la copia di un gruppo intero va in un gruppo nuovo **senza** effetti; la copia di una
   parte resta fuori dai gruppi (copiare gli effetti è funzione nuova, 2.27-dev).
7. **i18n**: `props.parte.input` («Ingresso {{id}} (tag)» / «Input {{id}} (tag)», oggi in «Collegamenti» compare la
   chiave grezza); `symbolEditor.fx.oldRemoved` senza il «pannello Pezzo»; le chiavi nuove delle domande.

**Test**: la fixture degli id; `addIngresso` in fondo alla serie; rinomina e cancella di un ingresso; parte rinominata
seguita dagli effetti; effetti tolti in un passo con l'ingresso; nome chiesto, Annulla, due effetti con due ingressi
nuovi che restano ciascuno sul suo; bocca con Annulla; «Anima…» che chiede solo quando serve; disegno cambiato durante
la domanda; con `FinestraAvviso` montata Invio/Esc nel campo di «Salva come» funzionano ed Esc su «Chiudere l'editor?»
non accoda un'altra domanda; Canc non cancella sotto una finestra aperta; «Collegamenti» mostra «Ingresso acceso (tag)».
Diventano rossi, e si riscrivono nello stesso commit: `symbolInspector.test.tsx` 54-71, `symbolEditor.test.tsx`
216-250, 444-455, 474-497.

**Domande**
- **D1** — I gruppi: in rc.30 si chiede il nome dei gruppi (Ctrl+G, «Raggruppa», «Aggiungi effetto» su forme sciolte)
  insieme a una «rinomina gruppo», oppure nomi e rinomina dei gruppi vanno insieme in 2.27-dev e in rc.30 il gruppo
  creato da «Aggiungi effetto» prende un nome automatico dall'effetto? *Consigliato: 2.27-dev* — oggi un nome sbagliato
  si corregge solo sciogliendo il gruppo, che toglie gli effetti; e il primo effetto su forme sciolte aprirebbe tre
  finestre in fila.
- **D2** — Si toglie un ingresso (o una parte, o «Togli animazione») che degli effetti seguono: (a) conferma che li
  elenca e li toglie *(consigliata)*; (b) rifiuto finché non si spostano; (c) come oggi, l'effetto resta orfano e il
  simbolo non si salva.
- **D3** — «Aggiungi effetto» con selezionata **una parte sola** di un gruppo (oggi l'effetto va su tutto il gruppo,
  sostituisce in silenzio una fiamma e nel pannello non si vede): (a) menu spento con la nota «seleziona tutto il
  gruppo» *(consigliata)*; (b) le forme scelte in un gruppo nuovo; (c) su tutto il gruppo, ma detto.

**La regola n. 3 di `CLAUDE.md`** (commit meta su `main`): «Ciò che si crea e poi si richiama per nome — ingressi,
parti, gruppi, bocche, simboli, pagine… — chiede prima il nome; Annulla non crea niente. Fanno eccezione le forme
semplici (rettangoli, ellissi), il corpo, gli strati statici e le copie (duplica e incolla prendono un nome
automatico). Il resto dell'IDE si allinea man mano.» L'inventario dei punti dell'IDE che oggi non chiedono (pagine,
cornici, faceplate, funzioni e loro parametri `argN`, script, gruppi del sinottico, tag, allarmi, sorgenti, datastore,
tipi, report, reperibili, import di simboli) va in un seme.

**Fuori dalla rc.30 (semi)**: «Salva come» che non controlla i collegamenti in pagina; rinomine che aggiornano solo la
pagina corrente; stato di vista legato all'id (nascosto, bloccato, valori di Prova); l'inventario della regola n. 3.

---

### E. L'editor dei simboli si ferma con «e.find is not a function»

**Visto** (test 6): dopo foto, ellisse, «Ritaglia con la forma», «Togli ritaglio», «Riempi il riquadro», a un certo
punto la rete di sicurezza ha fermato l'editor; modifiche non salvate perse. «Non ho capito cosa ho fatto.»

**Causa** (tre ricerche indipendenti, tre verifiche avversarie, confermata a mano): «Togli ritaglio» (`unclipPhoto`,
`model.ts` 1204) rimette la forma con `extra: { fill: "none" }`, un **oggetto**, mentre tutto il resto scrive coppie.
Il compilatore accetta anche l'oggetto, quindi niente errori e il Salva funziona. Appena la forma diventa l'unica
selezione, «Selezione» chiama `fillOf` (`SymbolEditor.tsx` 1629 → `model.ts` 375): `.find` su un oggetto. Nel bundle è
proprio `(e=t.extra)==null?void 0:e.find(...)`. La forma rimessa sta sopra la foto e senza riempimento è quasi
invisibile: un clic sulla foto dentro il suo contorno la seleziona. L'oggetto sopravvive al Salva nello store dell'IDE
(passa anche dal ponte) e sparisce solo ricaricando il progetto dal server: per questo sembra irriproducibile.

**Correzione (rc.30)**
1. `unclipPhoto` scrive `extra: [["fill", "none"]]` (e `mat: null`), meglio con un costruttore tipizzato delle forme
   (`geo`/`extra` come `Pairs`) usato anche da `newRect`/`newEllipse`/`newPath`, così `tsc` ferma l'errore.
2. Normalizzare `geo`/`extra` in coppie dove una descrizione entra nell'editor: apertura del draft, `readSymbolFile` e
   `readSymbolZip`, risultati dell'IA. Il formato Rust ammette per contratto la forma a oggetto: un `.swsym` scritto
   così, o esportato dopo un «Togli ritaglio» della rc.29, rompe allo stesso modo (anche Ruota/Specchia su un path).
3. `clipPhoto` conserva della forma anche colore, `extra` e `group`, così «Togli ritaglio» rende la forma di prima.

**Test**: «Togli ritaglio» rende coppie e `fillOf` → `{ none: true }`; render dell'ispettore con la forma rimessa
selezionata da sola, senza `symbol-editor-crashed`; `readSymbolFile` con `geo`/`extra` a oggetto → coppie, e
Ruota/Specchia senza eccezioni.

**Difetto a margine, stesso giro**: `matrixOp` (`model.ts` ~696) non tratta `image`, quindi Ruota/Specchia su una foto
non fa niente. Correzione piccola, nella stessa zona: in rc.30.

---

## Pezzo 2 — Correzioni della rc.30 — la parte dal collaudo del PLX800 (sessione sws-9b)

Pezzo per il piano comune `docs/plans/2026-11-23-correzioni-collaudo-rc30.md`: le anomalie **1, 3, 4, 5, 6, 7**.
La **2** (doppio deploy col 409) sta nella parte di sws-39 insieme alla sua C, per accordo del 23-11.
Tutte ci sono già nella 2.26 (`origin/release/2.26`), salvo dove è detto. Le cause con file e righe sono qui sotto
(l'analisi grezza degli agenti è rimasta nella cartella di lavoro di elitedesk, non conservata).

Il caso che le ha fatte uscire, 23-11-2026: PLX800 (`plx800-a-p3-l2-a2-0891bc`, PixsysOS 2.1.3, LogicLab e CODESYS
installati, nessuno schermo collegato), SWS 2.27.0-dev.0 installato da archivio, **abbinato dal cloud** senza utenti,
primo deploy dal cloud (rc.29) del progetto `tiny-ty`, poi un deploy dall'IDE locale in rete locale.

---

### 1. La rotazione dello schermo riavvia il dispositivo senza avviso

**Visto.** Al deploy di `tiny-ty` (`orientation: portrait`, fatto per il TY570) il PLX800 si è riavviato da solo:
log `control panel: rotating the screen, the panel restarts` (current 0, wanted 1), circa un minuto offline, LogicLab e
CODESYS fermati. Al deploy successivo di un progetto orizzontale si è riavviato di nuovo per tornare a 0.

**Causa.** `enforce_rotation` (`sws-web/src/control_panel/mod.rs:460`) chiama `SetRotation` di PixsysOS quando
l'orientamento del progetto (+ capovolgimento) differisce da quello di sistema; PixsysOS applica riavviando.
`rotation_by_system()` (`control_panel/dbus.rs:182`) guarda solo che `GetRotation` risponda: niente controllo di uno
schermo presente (`HasDisplayCapabilities` c'è già in `dbus.rs:273` ma alimenta solo `capabilities.display`), niente
controllo dei runtime PLC attivi. Non parte solo al deploy: `enforce_project` gira all'avvio (`main.rs:1662`), a ogni
`signal_project_changed` (`router.rs:9901`, cioè a ogni modifica salvata), al PUT del pannello di controllo
(`router.rs:12695`) e al tocco «Capovolto di 180°» (`mod.rs:1114`).

**Nessuno lo dice prima.** Nessuna conferma 428 al deploy (`remote.rs` precheck 3262-3431, `conferme428.ts`), niente
nel registro del deploy né nella risposta di `/open`; il runtime prepara `flipped_restarts` per il pannello di
controllo (`mod.rs:1026`) ma nessun client lo legge; `orientationHelp` e il manuale tacciono. La decisione del
15-11-2026 («il riavvio non è un problema», `docs/archive/2026-11-15-rotazione-dello-schermo.md`) era per i pannelli
HMI e diceva essa stessa che chi usa il prodotto deve saperlo; il collaudo della rotazione sul TC620 è ancora aperto
(`COLLAUDI_IN_SOSPESO.md:553`): il PLX800 è stato il primo caso reale.

**Decisione del maintainer.** Quale delle tre, o quale combinazione:
- (a) rotazione **dovuta** invece che automatica: si annota, si mostra nello stato e nel pannello di controllo, si
  applica solo con una conferma esplicita (al deploy una 428 `ruota-schermo`, nel pannello di controllo un pulsante);
- (b) **mai un riavvio da solo con un runtime PLC attivo** (`logiclab.service`, `codesyscontrol`, OpenPLC): resta
  dovuta e lo si dice;
- (c) **niente rotazione di sistema senza uno schermo**: prima misurare cosa risponde `HasDisplayCapabilities` sul
  PLX800 senza monitor (Weston e Chromium girano lo stesso).

**Proposta tecnica.** (a)+(b) insieme: `enforce_rotation` non chiama più `SetRotation` da solo; scrive la rotazione
dovuta in `control_panel.json` e la espone (`/api/system` o `/api/control-panel/display`: `{by_system, current,
wanted, plc_running}`); `remote_deploy` aggiunge il precheck 428 `ruota-schermo` (`confirm_rotation` in `DeployBody`)
quando `wanted != current`, con il testo «il dispositivo si riavvia per girare lo schermo, circa un minuto; sui
controllori si fermano anche i PLC»; il pannello di controllo mostra la rotazione dovuta con il pulsante che la applica;
`flipped_restarts` finalmente letto da `ControlPanel.tsx` e dal viewer LVGL. `enforce_project` sotto `!ide_only`,
come `display_target`. Manuale (04 «Orientamento», T11) e voce di NOVITA.

**Prova.** Sul PLX800: deploy di un progetto verticale → conferma con l'avviso, «no» non riavvia; «sì» riavvia una
volta. Con LogicLab attivo → nessun riavvio automatico, rotazione dovuta visibile. Sul TC620 il collaudo aperto.

---

### 3. Un deploy dall'IDE in rete locale lascia chiuso e senza progetto un pannello abbinato dal cloud

**Visto.** IDE locale collegato al PLX800 con l'`admin` del progetto `tiny-ty`, deploy di un progetto nuovo: il
pannello ha chiuso `tiny-ty`, poi «✗ Upload fallito: 401», ed è rimasto **senza progetto e chiuso in rete locale**
(`abbinato_cloud_senza_utenti: true`). Recuperato solo con un deploy dal cloud.

**Causa.** Il task di `remote_deploy` fa close → DELETE → upload → open con lo stesso token. `close_project` chiama
`auth.chiudi()` (`projects.rs:1863-1864`, `1916`): le sessioni degli utenti del progetto non valgono più (decisione del
22-10-2026, `docs/archive/2026-10-22-sessione-che-non-sopravvive-al-deploy.md`). Un pannello abbinato **dal cloud** non
ha l'Admin del dispositivo (`utenti_dispositivo.yaml` nasce solo dall'abbinamento in rete locale col codice,
`abbinamento.rs`), quindi dopo il close la fonte diventa «in attesa» e dalla rete locale tutto prende 401: DELETE (solo
un ⚠) e upload (✗, uscita). Nessun ripristino del progetto chiuso. Dal cloud funziona perché il gateway firma le
richieste. Il nome del progetto e «Sostituisci anche gli utenti» non c'entrano: **qualunque** deploy dalla rete locale
con un utente del progetto, su un pannello senza Admin del dispositivo, muore dopo il close. Le guardie e2e non lo
vedono perché si collegano con l'Admin del dispositivo. Seme collegato: `semi/2026-11-07-credenziali-cra.md` §1.

**Difetto latente nello stesso punto.** Con un nome diverso e `replace_users=false` il progetto vecchio se ne va con i
suoi `users.yaml` e il nuovo arriva senza utenti: anche dal cloud il pannello resterebbe senza account. Il precheck non
lo ferma perché `serve_conferma` vale solo con `replace_users=true` (`remote.rs:3158-3164`) e `serve_admin` solo con il
pannello già in attesa; e `GET /api/auth/users` elenca solo gli utenti del progetto attivo (`router.rs:3829`).

**Proposta tecnica.**
- Sul pannello un'operazione unica **«sostituisci progetto»**: autenticata una volta all'ingresso, fa close, delete,
  estrazione e open sotto `project_switch_lock`; se qualcosa fallisce riapre il progetto di prima. In alternativa:
  upload in una cartella nuova, poi una chiamata sola che chiude, cancella e apre. Stesso trattamento per
  `delete_remote_project` (`remote.rs:3766`).
- Precheck prima di toccare qualunque cosa: se il deploy porta via gli unici account (progetto di nome diverso, o
  `replace_users=false` con il pannello senza Admin del dispositivo), o si forzano gli utenti del progetto nuovo (se ha
  un Admin, come al primo deploy) o ci si ferma con 428 `serve-admin`. Il pannello dice quanti Admin del dispositivo ha
  (un campo in `/api/abbinamento` o `/api/auth/users`).
- Domanda al maintainer: un pannello abbinato dal cloud deve avere anche un Admin del dispositivo (creato
  all'abbinamento, o al primo deploy)? Oggi il modello dice «gli utenti arrivano col primo progetto».

**Prova.** PLX800 abbinato dal cloud, IDE locale con l'utente del progetto: deploy di un progetto con altro nome →
riesce, oppure si ferma prima di toccare il pannello; un upload fallito apposta → il progetto di prima torna aperto.

---

### 4. La pagina Utenti: nessun segnale di salvataggio, il campo Zone non si scrive

**Visto.** Il maintainer non trovava come salvare «Nome visualizzato» e «Scadenza sessione»: ogni campo si salva da sé
(nome all'uscita dal campo, il resto alla scelta), ma l'unico indizio è la colonna «Aggiornato».

**Causa e difetto vero.** `sws-editor/src/config/schede/UsersTab.tsx`: `onPatch` a ogni cambio senza conferma visiva.
Il campo **Zone** (`allowed_zones`, righe ~255-268) salva **a ogni tasto**, mette `busy` (campo disabilitato) e il valore
torna dal server già diviso e ripulito: la virgola sparisce appena scritta, quindi «zona1, zona2» si può solo incollare.
Dal codice, non ancora provato a schermo.

**Proposta.** Zone con stato locale e salvataggio all'uscita dal campo o con Invio (come il nome); un segnale «Salvato»
per riga (o un breve evidenziato della colonna «Aggiornato»); un test vitest che scrive «a, b» carattere per carattere.

---

### 5. Testi superati: il log «no-auth mode» e la conferma «senza password a chiunque»

**Visto.** Sul PLX800 a ogni avvio: `no users defined — starting in no-auth mode (all routes open)`, mentre la 7444
rispondeva 401 e la 7443 dava il Viewer anonimo come da manuale (`09_auth_rbac.md` §7).

**Causa.** `sws-auth/src/lib.rs:463` e `:574` (del 14-06-2026, prima che il no-auth sparisse l'11-10-2026) guardano un
solo archivio: qui quello dell'Admin del dispositivo, vuoto. La decisione su chi entra è di `fonte_auth_corrente`
(`router.rs:2826-2834`). Stesso giro: `cfg.deployNoUsersConfirm` (it/en.json, riga ~1885) promette ancora un pannello
«accessibile SENZA PASSWORD a chiunque», mentre oggi resta chiuso finché non lo si abbina.

**Proposta.** Le due righe dicono solo il fatto, in inglese, col percorso (`user store empty`); in `main.rs:1577` una
riga sullo stato vero per ogni fonte (oggi c'è solo per «in attesa»); il testo della conferma corretto in it/en con la
voce di NOVITA; i commenti fermi al no-auth (`lib.rs:346-348`, `:625-626`, `:1274-1275`; `router.rs:1471-1473`, `:1590`;
`system.rs:163-165`; `projects.rs:3276-3280`; `conferme428.ts:124-125`; `client.ts:3217-3219`). Nessun cambio di
comportamento.

---

### 6. Sul PLX800, dopo il riavvio da rotazione, i servizi PLC non sono partiti

**Visto.** All'avvio delle 14:25 `pixsys-launcher.service` è uscito con codice 1 subito dopo «Starting desktop unit»
(dopo `Failed to init Video driver: KMSDRM not available`). Ha `OnSuccess=plc.target`: fallito lui, `plc.target` non è
partito, e con lui **LogicLab, atvise e il bridge del modulo I/O** (`qmb800-shm-bridge`). Al mattino giravano. Il
bridge l'ha riacceso il maintainer a mano alle 15:27.

**Sospetto, non provato.** Prima di quel riavvio SWS aveva cambiato due cose del launcher: l'immagine di avvio
(`/etc/pixsys/pixsys-launcher/assets/boot.png`, quella di `tiny-ty`, 1080×1920 verticale, 14:08:49, via
`sws_web::boot_image` «chiedo al launcher → installato») e la rotazione in `/etc/pixsys/pixsys-launcher.toml`
(14:25:03). Il «KMSDRM not available» c'era con ogni probabilità anche al mattino, quando funzionava.

**Prima di correggere, una prova sul PLX800** (col via del maintainer, in una finestra di manutenzione):
1. rimettere l'immagine originale (togliere il file dal livello `upper` dell'overlay di `/etc`, che riscopre quella di
   fabbrica) e riavviare: il launcher finisce bene?
2. rimettere l'immagine verticale di SWS e riavviare; poi con rotazione `Right`;
3. se è l'immagine: chiedere a Pixsys cosa accetta il launcher (misura, formato) e farlo rispettare a
   `sws_web::boot_image` prima di installare; se è la rotazione, rientra nella 1.

**Indipendente dalla causa.** Un'azione di SWS che può lasciare spento il PLC va detta prima (rientra nella conferma
della 1) e, dopo il riavvio, SWS dovrebbe accorgersi che `plc.target` non è attivo e dirlo nello stato.

---

### 7. Le scritture dal viewer non finiscono nel registro delle azioni

**Visto.** Collaudo del 23-11, test 5: una decina di comandi a OUT0–7 e al LED A1 dalla pagina del PLX800 (`admin`):
nell'`audit.jsonl` del pannello solo i login, nessun `tag.write`.

**Causa.** Il registro lo scrive solo la scrittura REST (`router.rs:4302`, `tag.write`, con i rifiuti
`tag.write_denied` / `_rejected_*`). Il viewer scrive dal WebSocket (`router.rs:10204`, `InboundMsg::Write`): controlla
la soglia del tag e manda al bus, senza audit. Il manuale dice il contrario: `03_architecture.md:250` e
`17_sicurezza.md:114` («scritture di tag … finiscono in un audit log»). È un buco di tracciabilità che pesa anche per il
CRA. Non era nell'elenco delle anomalie del mio collaudo fino al test 5.

**Decisione del maintainer.** Una riga per ogni scrittura (come la REST) o raggruppate: uno slider trascinato manda
decine di scritture al secondo e riempirebbe il registro. Proposta: ogni scrittura accettata e ogni rifiuto, ma le
scritture consecutive dello stesso utente sullo stesso tag entro 1 s diventano una riga sola con il primo e l'ultimo
valore.

**Proposta tecnica.** `s.audit.log("tag.write", …)` nel ramo WebSocket con lo stesso dettaglio della REST (tag, valore,
utente, ruolo, origine `ws`), più `tag.write_denied` sui rifiuti; un test che una scrittura WS produce la riga; il
manuale resta vero.

---

### In ordine

1 e 6 insieme (rotazione e launcher: la prova del 6 dice quanto della 1 serve), poi 3 (il più rischioso), poi 7, 5 e 4.
Le decisioni da chiedere al maintainer sono quattro: 1 (a/b/c), 3 (Admin del dispositivo per i pannelli abbinati dal
cloud), 6 (la finestra di manutenzione per la prova), 7 (una riga per scrittura o raggruppate).
