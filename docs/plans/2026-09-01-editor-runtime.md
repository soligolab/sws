# Editor e runtime: dire quel che è vero, dove si guarda

*2026-09-01, frodo. Il piano precedente (chiave API dall'IDE + finestre staccate) è **implementato
per due terzi** e vive in fondo a questo file, §Appendice: la chat staccata non è fatta e `STATUS.md`
la cita puntando qui, quindi il suo disegno non va perso.*

---

## Contesto

Il maintainer, rileggendo le osservazioni sulla divisione editor/runtime, ha visto una situazione
ibrida e ha detto: «quando abbiamo diviso editor e runtime la mia idea era di avere **due programmi
distinti**, non un binario uguale con un parametro di avvio differente». Poi ha chiesto i fatti, e in
particolare se l'editor lavori in locale o nella cartella del dispositivo.

**Cosa dicono i fatti** (verificato oggi; i riferimenti puntuali sono nella §6 e nell'ADR da
scrivere):

1. Un solo eseguibile server, `sws-runtime`. I due pacchetti distribuiti contengono **lo stesso
   binario** e differiscono solo per il launcher.
2. `--viewer-port` assente cambia **solo socket e cosmetica**: listener viewer, mDNS, le due opzioni
   kiosk, la riga «viewer» nella pagina del certificato, e `AppState.ide_only`. Quel flag gatea
   **una cosa sola in tutto il binario**: le tre rotte `/api/ai/config`.
3. **Tutto il motore gira anche in modalità editor**, senza alcun gate: driver delle sorgenti,
   valutatore allarmi, historian e recorder, tag derivati Python, cron degli script globali,
   notifiche email + Telegram, auto-backup, audit. Misurato nei log di un'istanza editor reale
   (`source supervisor reload complete`, `historian: SQLite store opened`, `datastore: backend
   initialized`). Limite della misura: il progetto di prova ha 0 sorgenti, quindi una connessione
   PLC vera da un'istanza editor **non è stata osservata**.
4. **Dove vive il progetto: dipende dalla porta da cui si entra.** Sulla 8444 di un dispositivo si
   modifica il progetto dell'impianto **in presa diretta**, e il Salva fa hot-reload (sorgenti,
   allarmi, tag) senza riavvio né conferma. Con `start_editor.sh` o il pacchetto portabile si
   modifica una cartella locale, e il dispositivo ne ha una copia sincronizzata **solo a bundle
   interi** (push `/api/remote/deploy`, pull `/api/remote/project/export`; nessun endpoint scrive un
   singolo file di progetto sul device).
5. **Nessuno ha mai deciso il binario unico.** Nessun ADR, nessuna riga fra le decisioni congelate.
   Nasce da T-21 come conseguenza di due `TcpListener` nello stesso processo; `--viewer-port` diventa
   opzionale il 2026-07-31 con motivazione scritta «eliminare i conflitti di porta in sviluppo»; la
   frase «editor e runtime sono lo stesso binario» compare per la prima volta in un changelog di
   *packaging*. La spec prevede due repo e due container. L'unico documento che valuta la cosa è
   **Q8**, che la chiama *gap* e rinvia lo split di processo (E) al product phase.

**Le due decisioni prese dal maintainer oggi**, che definiscono l'ambito di questo piano:

- **Solo disambiguare e documentare.** Nessun cambio di comportamento del motore, nessuno split,
  nessun secondo binario. Le vie 2/3/4 valutate restano sul tavolo e vanno registrate in Q8, non
  eseguite.
- **L'IDE sul dispositivo resta com'è, ma lo dice.** Modificare l'impianto in servizio dalla 8444
  continua a essere possibile e normale — serve in messa in servizio e in assistenza — ma smette di
  essere indistinguibile dal modificare una copia locale.

**L'esito atteso**: chi apre l'IDE sa su cosa sta scrivendo; chi apre i documenti trova scritto
com'è fatto il prodotto e perché; e la prossima sessione non ri-deriva questi fatti da zero.

---

## Cosa NON entra

- **Niente `--design-only`, niente motore spento in modalità editor.** È la via 2, scartata oggi per
  il PoC. Va *registrata* in Q8 con quel che si è misurato, non implementata.
- **Niente secondo binario, niente cargo feature, niente divisione di `router.rs`.** Via 3.
- **Niente split di processo.** Q8-E, product phase.
- **Q8 non si chiude** (regola in `CLAUDE.md`): si aggiunge.
- **Non si cancella `compose.yaml` né `sws-editor/docker/`.** Sono la forma della spec, non
  toccati da maggio 2026, e già segnalati dal README come non raccomandati. Si marcano; eliminarli è
  una scelta del maintainer.
- Nessuna dipendenza nuova. Nessuna guardia statica nuova: non avrebbe cosa guardare, e
  `check_static.sh` obbligherebbe a classificarla (fallisce se un `check_*.sh` non è in nessuno dei
  due elenchi).

---

## 1. Il runtime dichiara di servire un impianto — l'unico codice del piano

Oggi **niente nel prodotto pubblica la modalità**. La SPA la deduce in due modi, entrambi indiretti:
un 404 su `/api/ai/config` (`sws-editor/src/config/ConfigView.tsx:5236-5260`) e una convenzione sulle
porte (`sws-editor/src/runtimeUrl.ts:20-38`, che nel proprio commento dichiara di essere una
convenzione e non un dato). Una deduzione non basta per un avviso: se sbaglia, mente.

**Lato Rust** — `sws-runtime/crates/sws-web/src/system.rs`:

- `SystemStatus` (riga 16) prende un campo `mode: &'static str` con valori `"ide"` / `"runtime"`.
  **Il nome dice il fatto, non la conclusione**: `"runtime"` significa «questa istanza ha un viewer
  operatori», e l'avviso lo deriva la UI. Un campo chiamato `serves_plant` incorporerebbe nell'API
  un giudizio che può cambiare; `mode` no.
- Il valore viene da `AppState.ide_only`, che già lo sa (`router.rs:87`, assegnato a `:203`,
  calcolato in `main.rs:814` come `args.viewer_port.is_none()`). **Nessuna condizione nuova**: si
  pubblica una condizione che esiste già e che oggi ha un solo lettore.
- `compute_system_status` (riga 39) lo prende **come parametro**, non lo si sovrascrive
  nell'handler: così il compilatore impedisce a un chiamante futuro di dimenticarlo, e nessun
  percorso restituisce un campo che mente. Costa tre call-site nei test (`:389`, `:406`, `:445`);
  il chiamante di produzione è uno solo (`:103`).
- `/api/system` è già registrata su **entrambi** i router (`router.rs:321` admin, `:611` viewer),
  tier Operator, e la SPA la interroga già: nessuna rotta nuova, nessun tier nuovo.

**Il regalo che viene gratis**: `/api/remote/system` (`router.rs:354`) proxa il `/api/system` **del
dispositivo collegato**. Con questo campo l'IDE viene a sapere anche la modalità del device — e
«collegare un editor a un altro editor», oggi possibile e silenzioso, diventa una cosa che si può
dire. Nessuna riga in più lato server: è lo stesso JSON rilanciato.

**Lato SPA**:

- `SystemStatus` in `sws-editor/src/api/client.ts:174-190` — il campo gemello.
- `RuntimeCtrl` (`sws-editor/src/components/RuntimeCtrl.tsx`) è il posto giusto e non per comodità:
  sta nell'header dell'IDE (`App.tsx:562`), **già** interroga `/api/system` in polling (`:29`, `:61`),
  e ha **già** il precedente di un avviso condizionale in header — il pulsante «Aggiorna progetto»
  che compare solo se `project_needs_update`. Si aggiunge un marcatore che appare solo con
  `mode === "runtime"`, col titolo che dice la conseguenza vera: *il Salva scrive il progetto
  dell'impianto e ne ricarica sorgenti e allarmi, senza riavvio.*
- Una `MetricCard` «Modalità» nella scheda Stato di `ConfigView` (accanto alle altre, `~:5514`):
  due righe, ed è dove si va a guardare quando qualcosa non torna.

**Il punto delicato — non creare due punti che dicono la stessa cosa** (regola UI n. 2 in
`CLAUDE.md`): la sezione Assistente di ConfigView oggi *spiega* la modalità partendo dal 404. Dopo
questo cambiamento la spiegazione viene dal campo, e il 404 resta a fare la sola cosa che gli
compete: disabilitare i controlli di un endpoint che lì non esiste. Un dato, una fonte.

**Testi**: chiavi nuove in `sws-editor/src/i18n/it.json` **e** `en.json`. **Da evitare il gruppo
`header.mode`, che esiste già** e significa un'altra cosa (editor/configurazione).

---

## 2. L'ADR che non è mai stato scritto

`docs/adr/0003-editor-runtime-same-binary.md`, nella forma di `0002` (`# ADR NNNN — …`, poi
**Status** / **Date** / **Decided** / **Deciders**, poi Context).

Deve dire quattro cose, e la terza è quella che oggi non è scritta in nessun posto:

1. **Com'è fatto**: un binario, il ruolo scelto da `--viewer-port`, i due pacchetti che condividono
   l'eseguibile, e i sette punti in cui il flag cambia qualcosa.
2. **Cosa questo comporta**: in modalità editor il motore gira per intero. Con l'elenco, e con il
   limite della misura dichiarato (0 sorgenti nel progetto di prova).
3. **Che non è stato deciso**: la cronologia in tre tappe (T-21 → `--viewer-port` opzionale il
   2026-07-31 con la motivazione «conflitti di porta» → T-37 packaging), e che la spec dice un'altra
   cosa. Un ADR che registra a posteriori una situazione emersa deve dirlo, altrimenti riscrive la
   storia in una decisione che nessuno ha preso.
4. **Cosa si decide adesso**: si tiene per il PoC, e si rende visibile (§1). Le vie alternative con
   il loro costo stanno in Q8, non qui.

Più **una riga nella tabella «Frozen architectural decisions»** di `docs/CONTEXT.md` §5 (righe
190-215), nella forma delle altre: `| Editor / runtime | **Same binary**, role selected by
`--viewer-port` (PoC; two processes = Q8-E, product phase) | — |`. Oggi quella tabella ha 24 righe e
**nessuna** parla della divisione fra i due programmi: è il primo posto in cui un lettore la
cercherebbe.

---

## 3. I documenti che dicono il falso

Tre correzioni, tutte verificate:

- **`docs/CONTEXT.md` §9** (riga ~325): «*Remaining undecided questions: none of the original Q1-Q7
  are open (all decided)*». Siamo a Q31 e Q8 ha rami aperti. Chi legge solo CONTEXT.md conclude che
  non c'è niente di aperto proprio sull'argomento di questo piano.
- **`STATUS.md` righe 49-52**: dice che Q31 non è implementata e che «il maintainer ha **deciso** la
  via: far leggere gli strumenti dal runtime remoto». Entrambe le metà sono superate — il fix è nel
  commit `8c34b23`, e quella via era basata su una premessa sbagliata (mia). Il commit ha aggiornato
  CHANGELOG e OPEN_QUESTIONS ma **non** STATUS.
- **`scripts/README.md`**: ha l'unico diagramma esistente del rapporto fra i due script, e dice le
  porte ma non **dove vive il progetto** — che è la domanda che il maintainer ha posto oggi. Si
  aggiunge quella riga ai due rami del diagramma, e la frase che sulla 8444 di un dispositivo si
  modifica l'impianto in servizio.

E il percorso compose, che **non è "sconsigliato": è rotto**. Verificato:
`sws-runtime/docker/Dockerfile:39` è `CMD ["sws-runtime"]` senza `--viewer-port`, e
`docker/entrypoint.sh` finisce con `exec "$@"` senza aggiungere flag. Quel container parte quindi in
**modalità IDE-only** e ascolta solo sulla 8444 (default di `--admin-port`), mentre `compose.yaml:30`
mappa `8443:8443` e l'healthcheck fa `curl https://localhost:8443/health`: **nessuno in ascolto**,
healthcheck che non può passare, e l'nginx dell'editor che proxa a `runtime:8443` nel vuoto. Ultimo
tocco: 2026-05-18.

Questo cambia la natura del residuo: non è una forma alternativa meno raccomandata, è una via che non
parte. E ha una conseguenza che va sistemata nella **stessa** passata: `README.md:96-105` indica il
compose come risposta a «voglio l'editor su Windows» — cioè **consiglia una cosa che non funziona**.
La risposta va sostituita (WSL2 con `start_editor.sh`, o il pacchetto editor portabile) prima o
insieme alla marcatura.

Marcare o cancellare i tre file (`compose.yaml`, `sws-editor/docker/Dockerfile`,
`sws-runtime/docker/Dockerfile`) **è una scelta del maintainer**: sono la sola traccia in repo della
forma prevista dalla spec, e vale la pena decidere se tenerla come documento o togliere un percorso
che promette di partire e non parte. Il piano propone di marcarli con la ragione scritta e di
correggere il README; la cancellazione la si fa solo su un sì.

---

## 4. I due percorsi morti

Entrambi promettono qualcosa che non fanno, ed entrambi riguardano proprio la confusione
editor/runtime. **Sono cancellazioni di codice: chiedere prima di eseguirle.**

- **La scheda «Connetti runtime remoto» della WelcomeScreen**
  (`sws-editor/src/components/WelcomeScreen.tsx:998`, bottoni a `:1213` e `:1223`) scrive
  `localStorage sws.runtimeBaseUrl` e ricarica — ma `admin-main.tsx:12` chiama
  `setForceLocalApi(true)`, quindi nell'IDE quell'impostazione è **ignorata** e il pannello continua a
  dire «runtime locale» qualunque cosa si inserisca. Proposta: togliere la scheda e i due bottoni.
  **Da non toccare** `setRuntimeBaseUrl`/`getBaseUrl` in `api/client.ts:69-99`: restano usate dalla
  variabile `VITE_RUNTIME_URL` e dal viewer, che *non* forza same-origin (`main.tsx` non chiama
  `setForceLocalApi`).
- **Il badge nell'header di `App.tsx:499-528`** (quello che dovrebbe mostrare il runtime remoto a cui
  la SPA punta) è morto per la stessa ragione: legge `getBaseUrl()`, che con `_forceLocalApi` esce
  sempre con `""`. Va via insieme alla scheda, altrimenti resta un indicatore che non può accendersi.
- **`sws-editor/src/admin/AdminApp.tsx`** (225 righe) non è importato da nessun entry point (i tre
  sono `main.tsx`, `admin-main.tsx`, `log-main.tsx`). Proposta: eliminarlo. Nota: il commento in
  `api/client.ts:65` cita «AdminApp» come ragione di `_forceLocalApi` — va riscritto, perché la
  ragione vera oggi è `admin-main.tsx`.
- **Da NON toccare**: `DeploySection`, che vive nello stesso modale della scheda «Connetti» ed è viva
  (installazione via SCP); e `VITE_RUNTIME_URL`, che agisce a build-time e serve in sviluppo.

---

## 5. Q32, e cosa si aggiunge a Q8

**`docs/OPEN_QUESTIONS.md`, aggiunta a Q8** (righe 168-213), senza toccare il suo `Decided`.
Q8 oggi descrive il gap sul **dispositivo** (IDE e acquisizione nello stesso processo); gli manca il
verso opposto, cioè che l'**editor** è un motore completo sul PC di sviluppo. Da registrare:

- i fatti misurati oggi, e che `ide_only` ha un solo lettore;
- **che la via «editor senza motore» costa meno di quanto sembri**, perché il motore è quasi tutto
  *reattivo*: valutatore allarmi, tag derivati, dispatcher webhook e i due recorder si svegliano solo
  su `TagDb::subscribe()` e senza driver non fanno nulla. Gli unici pezzi che agiscono per conto
  proprio sono tre: `SourceSupervisor`, `start_project_services` (cron, notifiche, Telegram) e il
  loop di auto-backup. Un gate dentro `SourceSupervisor::reload` coprirebbe **tutti** i cinque
  percorsi di reload esistenti in una volta;
- che lo spegnimento e la riaccensione deliberata **esistono già**: `POST /api/system/stop` e
  `/start`, col pulsante già nell'header dell'IDE. Quindi quella via non dovrebbe inventare né
  endpoint né UI;
- **la perdita che il relay non copre**: le letture di storico (`/api/history/*` da `SvgCanvas`,
  `TrendCanvas`, `TrendExpanded`) sono same-origin e restano locali anche con un dispositivo
  collegato, perché il relay ammette solo `tags|alarms|logs`. Un editor senza motore non avrebbe più
  storico da mostrare, e mostrare quello del dispositivo sarebbe un lavoro a sé;
- i costi delle vie 3 e 4, e il perché di questo ordine: le rotte esclusive dell'editor sono ~25 su
  186, quelle esclusive del runtime **zero** (il viewer è un sottoinsieme), quindi due binari oggi
  darebbero due nomi per lo stesso programma. Il costo vero della via 3 sta fuori da Rust —
  `build_deploy.sh`, i service/quadlet/Containerfile/installer, e due guardie da riscrivere.

**Una domanda nuova che è emersa dall'analisi e non c'entra con questo piano**, da registrare e non
risolvere: `POST /api/system/stop` viene **annullato in silenzio** dal salvataggio della sezione
Sorgenti, perché `PUT /api/project/sources` (`router.rs:2376`) chiama `supervisor.reload` senza
sapere che qualcuno aveva fermato l'acquisizione. Chi ferma l'impianto per lavorare e poi salva lo
riavvia senza volerlo.

**Q32 — «dove deve vivere il progetto che si sta modificando?»**, nel formato del file (Context /
Options / Default for PoC / `Decided: not yet`). Non è mai stata posta come domanda: la risposta di
fatto è sepolta in un aggiornamento di Q31. Le opzioni sono le tre porte descritte nel Contesto, e la
domanda vera è quale sia la *normale* e quale l'eccezione. La decisione presa oggi («resta, ma lo
dice») risponde alla metà UI, non a questa.

---

## 6. Ordine di lavoro

1. **§1, il campo `mode` e il badge** — è l'unico codice, è piccolo, e senza di esso i documenti
   descriverebbero una cosa che l'utente continua a non vedere.
2. **§2, ADR + riga in CONTEXT.md** — la parte che porta il valore più a lungo.
3. **§3, le correzioni ai documenti** — indipendenti. Dentro qui, con priorità sua:
   **la risposta su Windows nel `README.md`**, che oggi rimanda a un percorso che non parte.
4. **§5, Q32, l'aggiunta a Q8 e la nota sullo `system/stop` annullato dal Salva** — chiude la
   sessione lasciando la traccia.
5. **§4, i percorsi morti e i tre file del compose** — per ultimo, e **solo dopo un sì**: è l'unico
   pezzo che cancella. Si può tagliare senza conseguenze per il resto.

Prima di cominciare: **copiare questo file in `docs/plans/2026-09-01-editor-runtime.md` e
committarlo** (regola in `CLAUDE.md`: i piani in `~/.claude/plans/` non viaggiano con git, e il
maintainer lavora da due macchine). Aggiornare poi il rimando di `STATUS.md` righe 53-56, che oggi
punta a `~/.claude/plans/` per il disegno della chat staccata: dopo la copia quel disegno è in repo,
nell'Appendice qui sotto.

---

## 7. Verifica

```bash
cd /home/pixsys/sws/sws-runtime && cargo check --workspace --all-targets && cargo test --workspace
cd ../sws-editor && pnpm vitest run && pnpm build
cd .. && ./scripts/check_static.sh
```

Riferimenti da non far scendere: **362 test Rust**, **108 test editor**, **8 guardie**.

Il test nuovo in `system.rs` va provato **nel verso rotto**: un'istanza con viewer che dichiara
`mode: "ide"` è precisamente il difetto che renderebbe l'avviso una bugia, ed è quello che il test
deve impedire.

A mano, ed è la prova che conta perché mette i due casi uno accanto all'altro sulla stessa macchina:

```bash
./scripts/start_editor.sh  --instance 3     # IDE 8464, nessun viewer
./scripts/start_runtime.sh --instance 2     # viewer 8445 + IDE/admin 8446
curl -s localhost:8464/api/system | grep -o '"mode":"[a-z]*"'   # → "ide"
curl -s localhost:8446/api/system | grep -o '"mode":"[a-z]*"'   # → "runtime"
```

Poi nel browser: sull'IDE **8464** il marcatore non c'è; sull'IDE **8446** c'è, e il suo titolo dice
che il Salva scrive il progetto dell'impianto. Terza prova, quella che smaschera un badge cablato al
posto sbagliato: dall'IDE **8464** collegare il runtime **8446** — il marcatore deve restare
**spento**, perché parla dell'istanza che serve la SPA e non del collegamento, mentre la scheda
Runtime (che legge `/api/remote/system`) deve dire che il dispositivo collegato è in modalità
`runtime`. È anche la prova del regalo di §1: collegare invece l'editor 8464 a un altro *editor*
deve farlo dire.

---
---

# Appendice — piano del 2026-09-01, §4: la chat staccata (non implementata)

*Conservato perché `STATUS.md` riga 53-56 lo cita come unica sede del disegno. §1-§3 (chiave API
dall'IDE, log staccati) e §6-§7 di quel piano sono fatti e mergiati; questa parte no.*

### Il fatto che decide il disegno

**La conversazione vive nel WebSocket, lato server**: `sws-web/src/ai/mod.rs` —
`let mut messaggi: Vec<Value> = Vec::new()`, locale a `sessione()`. Una seconda finestra apre un
secondo socket, quindi **una seconda conversazione vuota**. Staccare la chat non è «mostrarla anche
altrove»: è una **consegna**, e quando passa nella finestra nuova la conversazione ricomincia — cosa
da dire, non da scoprire.

L'altra metà: `applyAiProposal` (`store/index.ts`) deve girare **nella finestra dell'editor**, perché
scrive `pages`, `project`, `currentPageId`, azzera la selezione, fa `pushHistoryUnconditional` e
registra le `pendingSections` — che sono **closure**, quindi non serializzabili e non attraversano
nessun canale.

### Il canale: `BroadcastChannel`, non `window.opener`

Nome `"sws.chat.ponte.v1"`, modulo `sws-editor/src/ai/ponte.ts` (solo protocollo e trasporto).
`window.opener` è da scartare: è `null` in due dei casi che il ciclo di vita deve coprire (finestra
riaperta da segnalibro; editor chiuso e riaperto) e obbligherebbe a validare l'origin a mano.

Il prezzo di `BroadcastChannel` è che è un broadcast: due schede dell'IDE applicherebbero entrambe la
stessa proposta. Si paga con l'**indirizzamento** — ogni messaggio porta `da`, le risposte portano
`a`, chi riceve scarta ciò che non è per sé; la chat nasce legata via `#e=<idEditore>` nell'URL.
**La versione sta nel nome del canale**: un editor v2 e una chat v1 non si sentono affatto, invece di
fraintendersi. Regola d'oro nel commento in testa: **sul ponte passa solo ciò che
`structuredClone` accetta** — ed è la ragione per cui le `pendingSections` non lo attraversano.

### Chi calcola il diff, chi applica

**La finestra staccata manda la proposta grezza; l'editor calcola il diff e applica.** L'alternativa
(mandare uno snapshot alla finestra staccata) si scarta per una ragione sufficiente: il diff deve
confrontare la proposta con `project`/`pages` **dell'editor nel momento in cui la proposta arriva**;
contro uno specchio di età ignota si mostrerebbe un diff diverso da ciò che verrà applicato.

- `riassumi()` si sposta da `ChatPanel.tsx` a un modulo puro `src/ai/riassunto.ts`.
- Nasce `src/ai/editor.ts` con due implementazioni della stessa interfaccia (`diff`, `applica`):
  `editorLocale` e `editorViaPonte`. `ChatPanel` prende una prop `editor` con default locale — **nel
  pannello dell'IDE non cambia niente**.
- Il diff diventa **asincrono**: `diff: VoceDiff[] | null` più `diffErrore?`, e resta **congelato**
  dopo il calcolo.
- `applica` rimanda la proposta **intera**, non un id: l'editor non tiene stato per proposta e la
  cosa regge anche se è stato ricaricato. La guardia vera resta l'impronta.

### La consegna, e i modi in cui va storta

Stacca → `apriFinestra("/index-chat.html#e=<id>", "sws-chat")` → **solo se riesce**:
`chiudiAiStream()`, pannello chiuso, `staccata = true`. Se il popup è **bloccato**, il pannello resta
aperto, il socket **non** si chiude, e la conversazione mostra una riga rossa. Mai
`window.location.assign`: qui c'è lavoro non salvato.

| Caso | Cosa vede l'utente |
|---|---|
| Editor risponde, progetto aperto | pallino verde, titolo col nome del progetto |
| Editor risponde, **nessun progetto** | banner e compositore disabilitato |
| Editor non risponde | banner rosso; si legge, **Applica disabilitato** col motivo |
| Editor chiuso mentre la chat è staccata | banner su `pagehide`; se il browser non lo manda, `applica` scade e la riga dice **«nessuna conferma dall'editor: la proposta potrebbe non essere stata applicata, controlla il canvas»** — un timeout non dimostra la non-applicazione |
| Editor ricaricato | manda `editore-pronto`, la chat si rilega; ogni chat viva risponde, così l'editor riparte **già** con `staccata = true` |

**Niente «riattacca»**: il server non sa trasferire una conversazione.

### Il terzo entry point

`index-chat.html` + `src/chat-main.tsx` + una riga in `vite.config.ts`. L'URL deve essere
**esattamente** `/index-chat.html`: `/chat` cadrebbe nel fallback SPA. `chat-main.tsx` chiama
**`setForceLocalApi(true)` per primo**. Auth già idratata da `localStorage sws.auth`; se manca, non
una seconda `LoginScreen` ma due righe che dicono di accedere nella finestra dell'editor.
`src/apriFinestra.ts` e `sorvegliaChiusura` esistono già (fatti col pezzo dei log).

### I test, e il verso rotto

jsdom non implementa `BroadcastChannel`, **ma vitest espone il globale di Node**, e due canali nello
stesso processo si parlano davvero: **il ponte si prova con l'oggetto vero**. Va invece stubbata
`window.open`, che in jsdom lancia e ritorna `undefined` — da trattare come «bloccata».

1. **Indirizzamento**: due handler montati, una richiesta per uno solo → `applyAiProposal` chiamata
   **una** volta. Rotto: senza il controllo su `a`, due.
2. **Impronta non corrispondente** → `ok:false` **e `pages`/`project` invariati**.
3. **`diff` che rifiuta** → la riga dice che il diff non è disponibile e **non** mostra «nessuna
   modifica». È il difetto più pericoloso del pezzo.
4. **Popup bloccato** → `bloccata: true` **e `window.location.assign` non chiamata** (spia).
