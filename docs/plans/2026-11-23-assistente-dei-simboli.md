# L'assistente dei simboli: prima l'intervista, poi il disegno — e i nomi chiesti alla creazione

## Contesto
Collaudo della 2.26.0-rc.29 sul WP630 (23-11-2026), test 5 (effetti come proprietà): **superato**. Dal test sono
uscite due cose:

1. **Anomalia D** — «+ nuovo ingresso…» negli Effetti crea un ingresso senza chiederne il nome, e gli ingressi «si
   scambiano» fra gli effetti. Regola chiesta dal maintainer: *tutto quello che si crea chiede prima il nome*.
2. **Una funzione nuova** — «Disegno con l'IA» e «Genera foto» sono due sezioni isolate nella colonna del simbolo.
   Al loro posto: un pulsante **«Assistente IA»** che apre una chat laterale come nell'IDE. La chat prima fa
   un'intervista guidata che definisce il simbolo, poi lo genera in più passi. Parole del maintainer: «il risultato
   finale è che non ci sono più bottoni ma un assistente che prima aiuta a definire le caratteristiche del simbolo e
   poi si occupa di generarlo».

**Decisioni del maintainer (23-11-2026)**
- **Chat**: la chat dell'IDE (`ChatPanel` + `/ws/ai`) con un **ambito «simbolo»**, non una chat a parte.
- **Foto che varia in modo proporzionale** (il caso alba e tramonto): **a gradini**, cioè N foto su intervalli
  dell'ingresso con le voci del segnale. Il formato non cambia. La dissolvenza fra le foto diventa un seme.
- **Nomi**: si chiedono per **ciò a cui ci si riferisce**: ingressi, parti, gruppi, bocche, simboli. Rettangoli ed
  ellissi no; si nominano raggruppandoli.
- **Regola UI n. 3 in `CLAUDE.md`, per tutto l'IDE**: «ciò che si crea chiede prima il nome».

**Vincoli di questa giornata**
- Nel checkout lavora un'altra sessione (`feat/plx800-io`). Finché quel ramo non è chiuso non si apre nessun ramo e
  non si committa niente (regola «un ramo alla volta»).
- Il piano va in `docs/plans/2026-11-23-assistente-dei-simboli.md` e si committa su `main` con la registrazione del
  collaudo. La parte 1 entra nell'elenco della rc.30 in `STATUS.md`.
- Dopo l'approvazione il collaudo riprende dal **test 6/12**.

---

## Parte 1 — rc.30: i nomi alla creazione e l'anomalia D (correzione, ramo da `release/2.26`)

> **Superata (23-11-2026, pomeriggio)** dalla sezione D del piano comune
> `docs/plans/2026-11-23-correzioni-collaudo-rc30.md`, rivista dopo l'analisi avversaria. Fra le differenze, la
> decisione del maintainer: i nomi dei gruppi e la loro rinomina vanno in 2.27.0-dev, non in rc.30. Il testo qui sotto
> resta come storia; quando il piano va in `docs/plans/`, questa parte si riduce a un rimando.

Va con le anomalie A (tag calcolato Good da un ingresso Bad), B (Bad visibile solo su richiesta) e C (barra «progetto
cambiato» dopo un salvataggio dalla finestra), tutte in [`allegati/2026-11-23-collaudo-rc29-wp630-anomalie.md`](allegati/2026-11-23-collaudo-rc29-wp630-anomalie.md). Il ramo è
`fix/rc30-collaudo`, da `release/2.26` (piano comune [`2026-11-23-correzioni-collaudo-rc30.md`](2026-11-23-correzioni-collaudo-rc30.md)). Squash, poi `cherry-pick -x` in `main`.

**La causa dello «scambio»**, trovata nel codice:
- `addIngresso` (`symbols/editor/model.ts:1141`) mette ogni ingresso nuovo **in testa** a `ops`.
- `inputIds` li elenca nell'ordine di `ops`, quindi il più recente compare per primo.
- «Aggiungi effetto» (`FxProps.tsx:44`) prende in silenzio `ids[0]`: un effetto nuovo finisce sull'ingresso
  dell'effetto precedente.
- Anche i menu, «Prova» e «Ingressi» elencano gli ingressi dal più nuovo al più vecchio.

**Correzioni** (in `model.ts`, `FxProps.tsx` e `SymbolEditor.tsx`):
1. **Il nome si chiede** con `chiedi({titolo, iniziale, valida})` (`finestraAvviso/finestraAvviso.ts:206`). Il
   validatore è uno solo, `validId`, nuovo in `model.ts`: la regola del compilatore (2-30 caratteri `[a-z0-9-]`, niente
   `body`, `layer-*`, `fx-*`) più l'unicità contro le parti **e** gli ingressi. Si chiede in questi punti:
   - «+ nuovo ingresso…» e «Aggiungi effetto» quando non ci sono ingressi;
   - «Ingressi → Aggiungi»;
   - «Anima…» e «Cambia con un ingresso» (oggi `slide`, `signal`…);
   - Ctrl+G e «Raggruppa» (oggi `g1`…);
   - lo strumento Bocca (oggi `p1`…).
   
   Annulla non crea niente. Il nome proposto nel campo resta quello automatico di oggi.
2. **L'ordine diventa stabile**: `addIngresso` inserisce dopo l'ultimo `ingresso`, non in testa. «Aggiungi effetto»
   non sceglie più da sé: se ci sono ingressi apre il menu con «+ nuovo ingresso…».
3. **Difetti vicini, nella stessa zona**:
   - un `ingresso` non si rinomina né si cancella da «Ingressi», perché `renamePart` e `removeInput` gestiscono solo
     `parte`;
   - rinominare una parte non aggiorna `effetto.input`;
   - `freePartId` ignora gli id degli `ingresso`;
   - «Aggiungi» col tipo «Ingresso» crea una `parte kind:"input"` che il compilatore rifiuta. Deve creare un
     `ingresso`;
   - duplicare o incollare tiene il `group`: la copia entra nel gruppo dell'originale e ne prende gli effetti. Va dato
     un gruppo nuovo;
   - `groupOps` perde il secondo bagliore o la seconda fiamma: si avvisa prima di unire.
4. Il testo `symbolEditor.fx.oldRemoved` parla ancora del «pannello Pezzo», che non esiste più.
5. **Test vitest**:
   - in `tests/symbolInspector.test.tsx`, con `rispondi()`: il nome chiesto, Annulla, e due effetti con due ingressi
     nuovi che restano ciascuno sul suo;
   - in `tests/symbolEditorModel.test.ts`: l'ordine, rinomina e cancella di un `ingresso`, la parte rinominata che
     segue negli effetti, il duplicato con un gruppo nuovo.

**`CLAUDE.md`** — una terza regola in «Regole UI dell'editor»: «**Ciò che si crea chiede prima il nome**, quando quel
nome si usa altrove (id, tag, collegamenti). Annulla non crea niente. Il resto dell'IDE si allinea man mano.» Va in un
commit meta separato.

---

## Parte 2 — L'assistente dei simboli (funzione nuova: `main`, uscita come 2.27.0-dev)

### Come è fatto
- **Il pulsante «Assistente IA»** sta nella barra dell'editor dei simboli, sia dentro l'IDE sia nella finestra a
  parte. Apre una **colonna laterale** con `ChatPanel` (`components/ChatPanel.tsx:52`), collegata a
  `/ws/ai?conv=…&ambito=simbolo`. È una conversazione sua, separata da quella del progetto.
- **Spariscono le sezioni** `ai-draw` e `ai-photo` (`SymbolEditor.tsx:1479-1484`), cioè `AiPanel.tsx` e `AiPhoto.tsx`,
  con la rotta `/api/symbols/ai/interview` e `INTERVIEW_SYSTEM`. Restano le funzioni che la chat riusa: `draw()` in
  `ai/symbol_draw.rs` e la foto del simbolo in `strumenti_scopi.rs:412`. Restano anche le rotte
  `/api/symbols/ai` e `/photo` finché qualcuno le usa; se poi non le usa nessuno, si tolgono.
- **L'adattatore dell'editor**: un `EditorAi` per il simbolo (`ai/editor.ts:34`).
  - `diff` confronta la proposta col simbolo aperto.
  - `applica` mette la proposta nell'editor come un passo annullabile, tenendo nome, etichette e variante (come fa
    oggi `withOwnNames` in `AiPanel.tsx:52`).
  - `fotografa` restituisce l'anteprima del simbolo negli stati scelti.
  - Nella finestra a parte passa dal ponte dei simboli (`ponteSimboli.ts`).
- **Il simbolo aperto arriva al server**: `chiedi` porta un campo facoltativo `simbolo` con la descrizione attuale
  (`ws/aiStream.ts:142`, `types/ai.ts`). Il server tiene l'ultima nella conversazione, e lo strumento `leggi_simbolo`
  la restituisce.
- **Il server** (`ai/mod.rs`, `tools.rs`, `prompt.rs`, `strumenti_scopi.rs`):
  - con `ambito=simbolo`, `Opzioni` (`tools.rs:388`) sceglie un elenco di strumenti suo:
    - `fai_domande`, che c'è già;
    - `leggi_simbolo`, `scheda_simbolo`, `genera_foto_simbolo` e `varia_foto_simbolo`, nuovi;
    - `disegna_simbolo`, che c'è già e usa `draw()`;
    - `proponi_simbolo`, nuovo: la scheda «Proposta» con «Applica»;
  - un blocco di sistema in più, «Editor dei simboli», che contiene l'intervista qui sotto. Va aggiunto come
    `NO_SNAPSHOT` (`mod.rs:567`), così la cache del prompt fisso resta valida;
  - le guardie nel codice come per gli sfondi (`sfondi_in_questo_turno`, `mod.rs:578`): niente varianti prima che la
    foto base sia approvata, niente proposta nello stesso turno del disegno;
  - lo scopo che paga è «Simboli» per il disegno e «Sfondi» per le foto. Restano i tetti di spesa di oggi.

### L'intervista
La chat fa domande con `fai_domande`: al più 4 per scheda, con scelte cliccabili più una risposta libera.
- Un blocco che non serve si salta.
- Quello che la prima richiesta dice già non si richiede, come fa oggi la chat dell'IDE («La chat chiede prima di
  lavorare»).
- In ogni momento «fai tu» o «salta, genera subito» chiude l'intervista con le scelte proposte.

**0 — Da dove si parte**
- Se il simbolo ha già delle forme: «modifico questo simbolo o ne disegno uno nuovo?»
- «Hai una foto della macchina vera da usare come riferimento?» Si può allegare. Serve un modello che vede le
  immagini; se non le vede, la chat lo dice.

**1 — Che cos'è**
1. «Che cosa rappresenta?» Testo libero: stufa a pellet, pompa centrifuga, valvola a farfalla…
2. «In che impianto sta?» Domestico, HVAC, idrico, industriale, energia. Orienta lo stile e le proposte che seguono.
3. «Come lo vuoi?»
   - **Vettoriale (SVG)** nello stile della libreria, sobrio (ISA-101);
   - **Fotorealistico**, cioè una foto generata;
   - **Misto**: una foto sotto e parti vettoriali vive sopra (lancetta, livello, spia).
4. «Proporzioni?» Quadrato, orizzontale o verticale, con la misura proposta in unità (multipli di 10, al più 512).
5. Solo per il vettoriale: «I colori seguono lo stato (il corpo colorato da allarme, marcia, fermo) o sono colori
   suoi?»

**2 — Gli ingressi di controllo**
6. «Quali ingressi lo comandano?» La chat propone un elenco adatto al tipo. Per una stufa: `acceso` (sì/no),
   `potenza` (0-100 %), `allarme` (sì/no). Per ogni ingresso: **nome**, tipo (sì/no, numero con intervallo e unità,
   stati con il loro elenco).
7. Per ciascuno: «Che cosa cambia con questo ingresso?» Scelte possibili:
   - il colore del corpo;
   - una parte che si muove (gira, scorre, lancetta, livello);
   - la foto;
   - un effetto (fiamma, fumo, bagliore, bollicine);
   - un pezzo che compare o sparisce;
   - un lampeggio.

**3 — La foto** (solo per fotorealistico e misto)
8. «Descrivi l'aspetto»: materiale, colore, angolazione (frontale o tre quarti), stile (catalogo o render). La chat
   propone una descrizione da correggere.
9. «La foto cambia con un ingresso?»
   - **no**;
   - **acceso/spento**: due foto;
   - **per stati**: una foto per stato;
   - **a gradini**: da 3 a 5 foto su intervalli, come alba, giorno, tramonto, notte. Per ogni gradino: l'intervallo
     dell'ingresso e cosa cambia nella scena.
10. Poi **la foto base**: la chat la genera e la mostra con «Usa come base», «Rigenera» o «Cambia la descrizione».
    Solo dopo l'approvazione genera le varianti, come modifiche della base, e le mostra tutte insieme.

**4 — Le parti e i loro nomi**
11. «Queste sono le parti che propongo di riconoscere per nome», per esempio `corpo`, `fiamma`, `camino`, `vetro`,
    `targa`. Conferma, rinomina o togli. I nomi diventano gli id dei gruppi e delle parti (la regola dei nomi della
    parte 1).
12. «Si collega a dei tubi? Dove, e con che nome per ogni attacco?» Sinistra, destra, sopra, sotto: diventano le bocche.

**5 — Effetti e movimenti**
13. La chat propone gli abbinamenti fra parti e ingressi. Per esempio: «fiamma su `fiamma` quando `acceso` è vero,
    con l'intensità da `potenza` 0-100; fumo dal `camino` quando `acceso`; bagliore rosso sul `corpo` con `allarme`».
    Per ogni abbinamento: accetta, cambia o togli, più colore e soglia. La chat ricorda che sul pannello LVGL
    l'intensità va al più su 3 livelli.
14. I movimenti (rotore, scorrimento, livello, lancetta), se un ingresso li ha chiesti.

**6 — La scheda del simbolo**
15. Un riepilogo modificabile, cioè la **scheda**, e poi «Genero tutto o un passo alla volta?». È la riga «Come
    procedo?» che la scheda Domande ha già.

### La scheda e i compiti in cui si spezza il lavoro
La **scheda** (`scheda_simbolo`) è il risultato dell'intervista: un JSON con le parti seguenti, ed è l'unica cosa
che i passi successivi leggono.
- `nome`, `categoria`, `misura`, `stile`;
- `ingressi[]`, ognuno con id, tipo, intervallo, unità e stati;
- `foto`, con la descrizione e `varia_con` (ingresso, modo, gradini con intervallo e descrizione);
- `parti[]`, ognuna con nome, cosa rappresenta, ingresso e movimento;
- `bocche[]`;
- `effetti[]`.

Ogni compito è una chiamata con un prompt stretto, oppure è **codice senza modello**. Fra un compito e l'altro c'è un
punto di controllo nella chat.

| # | Compito | Chi lo fa | Riusa |
|---|---|---|---|
| T0 | intervista → scheda | modello della chat | `fai_domande`, scheda nuova |
| T1 | struttura: misura, ingressi, bocche, parti vuote coi nomi | **codice**, dalla scheda | `addIngresso`, `addPort`, gli op `parte` |
| T2a | foto base | modello «Sfondi» | `symbol_photo`, `DA_SIMBOLO`, `trim_border` |
| T2b | varianti a gradini, come modifiche della base | modello «Sfondi» | `immagini::edit` (`immagini.rs:361`, oggi solo per gli sfondi) |
| T2c | le foto messe nelle voci del segnale | **codice** | `SignalEntry.image`, intervalli `value_min`/`value_max` |
| T3 | il disegno vettoriale: forme raggruppate coi nomi della scheda, sopra la foto nel caso misto | modello «Simboli» | `draw()` con i suoi 3 tentativi e gli errori del compilatore |
| T4 | effetti e movimenti dalla scheda | **codice**, il modello solo se l'abbinamento è ambiguo | `addEffect`, `animateSelection` |
| T5 | verifica: compila, mostra gli stati (spento, acceso, 50 %), riporta i rilievi, «Applica» | codice e chat | `proponi_simbolo`, `fotografa` |

Perché si fa così: il modello disegna solo dove serve, cioè le forme e le foto. Struttura, nomi, effetti e foto per
gradino sono deterministici e non sbagliano il formato, che era il punto debole misurato coi modelli piccoli (vedi
l'archivio `2026-11-19-assistente-ia-simboli.md`).

**Il buco da chiudere nello schema** per T3 e T2c:
- `schema_simbolo` (`tools.rs:1423`) e `answer_schema` (`symbol_draw.rs:166`) non dicono che una voce del segnale può
  portare `image`;
- `keep_known_photos` (`symbol_draw.rs:571`) controlla solo gli `Op::Image`, non le foto dentro le voci.

### Decisioni del maintainer prima della sessione 1 (23-11-2026, sera)
- **La chat sta dove sta l'editor.** Nella finestra a parte ha il suo collegamento a `/ws/ai` con la stessa sessione;
  dentro l'IDE sta dentro l'IDE. L'adattatore è sempre quello locale (lo store della finestra in cui gira): **il ponte
  dei simboli non serve all'assistente**, e il punto «Nella finestra a parte passa dal ponte» qui sopra è superato.
- **Una conversazione per simbolo**: riaprendo lo stesso simbolo nella stessa sessione del browser la si ritrova;
  «Svuota» ricomincia; un altro simbolo ha la sua. Il canale verso `/ws/ai` diventa quindi un'istanza per
  conversazione, non più un singleton per finestra (`ws/aiStream.ts`): quella del progetto resta com'è.
- **«Genera foto» resta fino alla sessione 3**: la sessione 1 toglie solo «Disegno con l'IA» (la sezione `ai-draw`,
  `AiPanel.tsx`, e l'intervista `/api/symbols/ai/interview` se nessun altro la usa).
- **La regola UI 3** è in `CLAUDE.md`.
- **Sessione 1 fatta** (ramo `feat/symbol-assistant-chat`, 23-11 notte). Una scelta presa durante il lavoro: la rotta
  `/api/symbols/ai` **resta**, senza interfaccia, perché tutti i test di `draw()` (errori rimandati, tre tentativi,
  tetto, modello locale) passano da `editor()`, e la foto di riferimento oggi c'è solo lì. **Nella sessione 2**: la
  foto di riferimento entra nella chat (blocco 0 dell'intervista), i test passano a chiamare `draw()` direttamente, e la
  rotta si toglie. L'intervista vecchia (`/api/symbols/ai/interview`) è già tolta. Il parametro del socket, che il piano chiama
  `ambito=simbolo`, nel codice è **`scope=symbol`** (regola del codice in inglese).
- **Decisioni prima della sessione 2** (24-11-2026): la scheda si **corregge nella scheda** in chat, non scrivendo; i
  **movimenti li fa il modello che disegna** (strati `parte` coi nomi della scheda), il codice mette ingressi, bocche ed
  effetti; la foto si allega **in tutte e due le chat**.
- **Sessione 2 fatta** (ramo `feat/symbol-assistant-interview`, annidato sul primo). Nomi nel codice in inglese:
  `symbol_sheet`, `read_symbol`, `propose_symbol`, frame `symbol_proposal` e `symbol_sheet`, la scheda con chiavi
  inglesi (`inputs`, `parts`, `ports`, `effects`, `photo.varies_with`). **Rimandato alla sessione 3**: togliere
  `/api/symbols/ai` spostando i test di `draw()` (la foto di riferimento ora c'è nella chat, quindi la rotta non ha più
  niente di suo).
- **Sessioni 1 e 2 in `main`** con lo squash del 24-11-2026 (2.27.0-dev.3): i rami `feat/symbol-assistant-chat` e
  `feat/symbol-assistant-interview` sono eliminati. Le sessioni 3 e 4 partono da `main`.

### Sessioni (un ramo per sessione, annidati se il collaudo arriva dopo)
1. **`feat/symbol-assistant-chat`**:
   - il pulsante e la colonna con `ChatPanel`;
   - `ambito=simbolo`, `leggi_simbolo`, l'adattatore `EditorAi`, `proponi_simbolo` con «Applica»;
   - via le sezioni IA. Il disegno, per ora, è `disegna_simbolo` di oggi.
2. **`feat/symbol-assistant-interview`**: il blocco di sistema con l'intervista, `scheda_simbolo` e la sua scheda nella
   chat, T1 e T4 da codice.
3. **`feat/symbol-assistant-photos`**: T2a, T2b e T2c, con la guardia «base approvata prima delle varianti» e il buco
   dello schema chiuso.
4. **Chiusura**:
   - T5 con gli stati mostrati in chat;
   - da proporre al maintainer per CasaDomotica: la stufa rifatta con l'assistente (regola di `CLAUDE.md`, rivista il
     25-11-2026);
   - manuale, `NOVITA.yaml` e `CHANGELOG.md`;
   - il seme «dissolvenza fra le foto del simbolo» in `docs/plans/semi/`.

---

## Verifica
- **Ogni ramo**: `cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`. Le
  guardie che contano qui sono `check_i18n_parita`, `check_synoptic_schema` (lo schema dell'IA cambia) e
  `check_lvgl_parity`.
- **Test nuovi**:
  - vitest: il pannello della chat nell'editor dei simboli, l'adattatore `applica` come passo annullabile, i
    costruttori T1, T2c e T4 dalla scheda;
  - Rust: `ambito=simbolo` sceglie gli strumenti, `leggi_simbolo`, la guardia sulla foto base, `keep_known_photos`
    con le voci del segnale.
- **Prove dal vivo** sull'IDE di prova (`start_editor_develop.sh`), quando il checkout è libero:
  - la stufa dall'intervista fino ad «Applica», col modello in cloud dello scopo «Simboli» e FLUX o OpenAI per le foto;
  - un caso a gradini, una caldaia con la potenza su 4 gradini;
  - un caso solo vettoriale, una pompa con il rotore.
- **Collaudo** con `/test-changes`: la parte 1 sulla rc.30, la parte 2 sulla 2.27.0-dev.
