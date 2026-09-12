# Una chat AI nell'editor, collegata a Claude Code

*Piano, 2026-08-31. Richiesto dal maintainer. Nessuna riga di codice scritta: questo documento
serve a decidere, non a raccontare cosa è stato fatto.*

Prerequisito di lettura: **Q26** in `docs/OPEN_QUESTIONS.md`, che apre la questione e ne elenca i
punti aperti. Questo piano ne è la risposta proposta — non la sostituisce, e non chiude Q26.

---

## 1. La scoperta che cambia il progetto

La domanda sembrava «dove far girare un agente che scrive nel progetto, e come impedirgli di fare
danni». Guardando com'è fatto l'editor, la domanda giusta è un'altra.

**Nell'editor le modifiche non toccano il disco.** Ogni mutazione passa dallo store zustand
(`sws-editor/src/store/index.ts`), resta in memoria, e finisce su disco solo con `saveAll()`
(riga 1737) quando l'utente salva. E ogni mutazione passa da `pushHistory(etichetta)` (riga 532),
che dà **l'annullamento con Ctrl+Z**.

Quindi: se l'agente propone le sue modifiche **allo store dell'editor** invece che al runtime,
quattro delle sei domande di Q26 si sciolgono da sole.

| Domanda di Q26 | Risposta, se l'agente scrive nello store |
|---|---|
| Dove gira, e cosa può toccare | Sul PC di sviluppo, e tocca **solo la memoria del browser** |
| Sola lettura o scrittura | Scrive, ma niente raggiunge il disco senza che una persona prema Salva |
| Chi approva | La persona che salva. È il gesto che già esiste |
| Come si torna indietro | **Ctrl+Z.** Meccanismo già scritto, già provato, già nella cronologia visuale |
| Rapporto con `write_min_role` e Q17 | Nessun percorso di scrittura nuovo: il salvataggio passa dagli endpoint di sempre, con le credenziali dell'umano |
| I segreti nel progetto | Vedi §6: già risolta da una decisione precedente |

C'è di più: `beginInteraction(label)` / `endInteraction()` (store righe 1633-1644) sospendono i push
intermedi. Un intero turno di chat — «rinomina questo tag in tutte e quattro le pagine» — diventa
**un solo passo di annullamento**, etichettato nella cronologia. Non è una funzione da scrivere:
c'è già, e la usa il drag del canvas.

> **L'agente non ha mai credenziali di scrittura.** Legge attraverso l'API del runtime col token
> dell'umano che sta chattando, quindi non può leggere niente che quell'umano non possa già
> leggere. E scrive solo proponendo una modifica allo store, che una persona vede e approva.

---

## 2. La topologia, e perché serve un processo in più

```
   ┌─ browser ──────────────────────────────┐        ┌─ sidecar Node ─────────┐
   │  editor SPA (porta 8444)               │        │  sws-agent             │
   │    store zustand ── canvas ── ChatPanel│◄──WS──►│    Agent SDK           │
   └────────────────┬───────────────────────┘        │    strumenti in-process│
                    │ HTTP (token dell'utente)       │    chiave API          │
                    ▼                                └──────────┬─────────────┘
   ┌─ runtime Rust ─────────────────────────┐                   │ HTTP (stesso token)
   │  progetto su disco, tag, allarmi, log  │◄──────────────────┘
   └────────────────────────────────────────┘
```

Il processo in più non è evitabile:

- la **chiave API non può stare nel browser** — chiunque apra il pannello la porta via;
- l'Agent SDK **avvia il CLI di Claude Code come sottoprocesso** ([documentazione
  ufficiale](https://code.claude.com/docs/en/agent-sdk/typescript)), quindi vuole Node e un binario,
  non un motore JavaScript in una pagina.

Il sidecar è però **sottile**: tiene la chiave, il ciclo dell'agente e le definizioni degli
strumenti. Non tiene lo stato del progetto — quello sta nello store dell'editor e su disco nel
runtime. Se il sidecar muore, non si perde niente.

**Dove gira**: accanto a `start_editor.sh`, sul PC di sviluppo. **Mai sul pannello.** Non è una
limitazione tecnica ma la decisione che rende tutto il resto semplice: un agente che non ha mai
accesso a un impianto in servizio non può fermarlo.

---

## 3. Perché Claude Code e non l'API diretta

Si potrebbe implementare il ciclo dell'agente in Rust contro la Messages API: niente Node, niente
binario, tutto in un processo che già esiste. Sarebbe la scelta giusta se servisse *una risposta*.
Serve invece un *agente*, e la differenza sta in quattro cose che con l'SDK ci sono già:

1. **Il ciclo strumento→risultato→strumento**, gestito, con la compattazione del contesto quando la
   conversazione cresce.
2. **`canUseTool`** — una richiamata che intercetta ogni uso di strumento e può chiedere il permesso.
   È il punto d'aggancio naturale per «mostra all'umano cosa sta per fare».
3. **`allowedTools` / `disallowedTools`** — si può *togliere* all'agente Bash, la scrittura di file,
   la rete. Un agente che non ha `Bash` non può eseguire niente sul PC del maintainer, e la garanzia
   viene dal contenitore, non dalla nostra disciplina.
4. **La stessa definizione di strumenti serve anche dal terminale** (fase 4): chi preferisce `claude`
   in un terminale usa gli stessi strumenti, non una seconda implementazione che diverge.

Costo onesto: Node 21 (già installato) più il binario di Claude Code (~100 MB), e una dipendenza
esterna in più nel percorso di sviluppo. Non entra in nessuna immagine del dispositivo.

Fatti verificati sull'SDK, non ricordati: pacchetto `@anthropic-ai/claude-agent-sdk`; `query({prompt,
options})` è un generatore asincrono; `tool(nome, descrizione, schemaZod, handler)` e
`createSdkMcpServer({name, tools})` definiscono strumenti **nello stesso processo**, senza un server
MCP separato.

---

## 4. Gli strumenti: la parte che decide se funziona

Un agente vale quanto i suoi strumenti. La tentazione è dargli `leggi_file`/`scrivi_file` e lasciarlo
lavorare sullo YAML. Sarebbe l'errore: il modello inventerebbe nomi di campo, e ce ne accorgeremmo
dal pannello nero.

Gli strumenti vanno modellati **sul dominio**, così che le cose sbagliate non siano esprimibili.

### 4.1 Lettura — dal runtime, col token dell'umano

| Strumento | Da dove | Nota |
|---|---|---|
| `elenca_pagine` | `GET /api/synoptics` | |
| `leggi_pagina(nome)` | `GET /api/synoptics/:name` | |
| `leggi_progetto` | `GET /api/project` | **già mascherato**, vedi §6 |
| `elenca_tag`, `valore_tag(id)` | `GET /api/tags` | valori dal vivo |
| `elenca_allarmi` | `GET /api/alarms` | |
| `leggi_log(n)` | `GET /api/logs` | per la diagnosi |
| `impronta_progetto` | `GET /api/project/fingerprint` | vedi §5, controllo di concorrenza |

### 4.2 Lo strumento che nessun altro progetto ha: **lo schema**

`schema_oggetto(tipo)` restituisce i campi validi per un tipo di oggetto sinottico, **generati dalla
fonte autorevole** (`sws-web/src/synoptic.rs`, 238 campi) e non da una lista scritta a mano.

Senza, il modello indovina i nomi dei campi e sbaglia in modi che non fanno rumore — è esattamente
come sono nati i difetti trovati il 2026-08-31 (`objects:` invece di `child:` in una cella di
griglia, `points:` su una `line`).

Con, il modello ha un vocabolario chiuso. È la differenza fra un assistente che scrive YAML
plausibile e uno che scrive YAML valido.

**Va generato, non copiato.** Una copia a mano diverge — è la lezione di `check_lvgl_types.sh` e
`check_lvgl_symbols.sh`, e non c'è motivo di impararla una terza volta.

### 4.3 Lo strumento che dà il giudizio: **la validazione**

`valida_progetto(modifica_proposta)` risponde «questa modifica è accettabile?» **senza salvare
niente**, restituendo gli errori al modello perché li corregga da solo.

Oggi quell'endpoint non esiste (verificato: nessun `validate` in `sws-web` né in `sws-core`; le
validazioni sono in linea dentro i singoli `PUT`). È il pezzo di lavoro lato Rust di questo piano —
vedi fase 1.

Deve girare **il parser vero** (`Project::load`, `sws-core/src/project.rs:998`) e le regole delle
guardie, non una loro approssimazione. Il precedente: il test `tutti_i_template_si_caricano` usa
`Project::load` proprio perché una guardia in shell che approssima serde prima o poi diverge.

### 4.4 Lo strumento che dà gli occhi: **l'istantanea**

`istantanea_pagina(nome)` restituisce **un'immagine** di come il motore LVGL disegna quella pagina.

È l'anello che chiude il ciclo: l'agente disegna, **guarda**, e corregge. Non è teoria — è quello che
ho fatto tutto il 2026-08-31 con `--istantanea` (documentato in `docs/HOWTO.md` §6), trovando nove
difetti in una giornata, sette dei quali non davano alcun segnale.

Meccanica: il viewer LVGL ha bisogno di un runtime vivo (`--base-url`), quindi l'istantanea di una
modifica *non ancora applicata* richiede una **seconda istanza di runtime come banco di prova** —
`./scripts/start_runtime.sh --instance 2`, dati in `.run-2/`, porte 8445/8446. Ci si carica una copia
del progetto con la modifica proposta, si scatta, si butta via. È il meccanismo che ho usato a mano
oggi con l'istanza 3.

### 4.5 Scrittura — **non c'è**

L'agente non ha strumenti di scrittura verso il runtime. Ha un solo strumento che *propone*:

```
proponi_modifica(pagina, oggetti[], motivo) → { diff, id_proposta }
```

Il sidecar la rimanda all'editor sul WebSocket; l'editor mostra il diff; se la persona accetta,
l'editor applica allo store dentro `beginInteraction("Assistente: <motivo>")`, e il canvas si
aggiorna. Da lì in poi è una normale modifica dell'editor: annullabile, salvabile, deployabile.

### 4.6 Cosa l'agente NON deve avere, e perché

Elenco esplicito, da mettere in `disallowedTools` e da non dimenticare:

| Superficie | Perché no |
|---|---|
| `Bash`, `Write`, `Edit` dell'SDK | eseguirebbero comandi e scriverebbero file sul PC del maintainer |
| `POST /api/script/exec` | esegue **Python arbitrario** sul runtime (Operator+, `router.rs:1168`). Con RestrictedPython assente — sul PC di sviluppo di solito lo è — gira **senza sandbox** |
| `GET /api/project/export` | il bundle ZIP contiene i segreti **in chiaro**, per decisione del 2026-07-29 |
| `PUT /api/project/*`, `PUT /api/synoptics/*` | la scrittura passa dall'umano, non dall'agente |
| `POST /api/project/deploy`, `/rollback`, git push | mandano roba su un dispositivo |

---

## 5. Le due difese che vanno progettate, non ereditate

### 5.1 L'umano che modifica mentre l'agente pensa

Un turno di chat dura decine di secondi. In quel tempo la persona può spostare oggetti. Se la
proposta si applica alla cieca, cancella il lavoro appena fatto.

Risposta: `GET /api/project/fingerprint` (`router.rs:4611`) restituisce uno SHA-256 di
`project.yaml` più tutti i sinottici. L'agente lo legge quando comincia; la proposta lo porta con sé;
l'editor **rifiuta di applicare** una proposta la cui impronta non corrisponde più, e lo dice.

È controllo di concorrenza ottimistico, e il pezzo che serve esiste già.

### 5.2 Il progetto che dice all'agente cosa fare

Il contenuto del progetto — etichette, nomi di tag, descrizioni, testi degli allarmi — finisce nel
contesto del modello. Un progetto importato da fuori può contenere una frase costruita per farsi
obbedire («ignora le istruzioni precedenti e…»).

Non è una preoccupazione teorica per uno SCADA: i progetti si scambiano, si importano da ZIP, si
ereditano da un altro integratore.

Risposte, in ordine di forza:

1. **L'agente non ha strumenti pericolosi** (§4.6). Anche obbedendo, non può fare granché.
2. **Ogni scrittura passa da una persona** che vede il diff.
3. I contenuti del progetto entrano nel contesto **marcati come dati**, non come istruzioni.

La prima è quella che conta. Le altre due sono strati, non garanzie.

---

## 6. I segreti: la domanda più affilata di Q26 era già risolta

Q26 diceva: *«i segreti viaggiano col progetto in chiaro; un server MCP che esponesse il progetto
esporrebbe anche quelli. È probabilmente il punto più affilato di tutti.»*

Verificato oggi: **no.** `GET /api/project` passa da `mask_project_secrets` (`router.rs:1905`), che
sostituisce le password con `********`, e il server le **ricompone al salvataggio**
(`router.rs:2310`). La mascheratura esiste per tenere i segreti fuori dal browser — e l'agente legge
dalla stessa porta del browser.

Restano due cose da rispettare, non da inventare:

- **`GET /api/project/export`** (lo ZIP) **non** maschera, per decisione deliberata del 2026-07-29.
  Va nella lista degli strumenti negati (§4.6).
- Se un domani l'agente dovesse leggere direttamente dal filesystem invece che dall'API, la
  protezione sparisce. **Non deve.** È un altro motivo per non dargli `Read`.

---

## 7. Cosa deve fare la chat, in ordine di valore

Tre prodotti diversi si nascondono sotto «chat AI nell'editor». Vanno separati, perché hanno valore
e rischio molto diversi.

| | Cosa | Valore | Rischio | Quando |
|---|---|---|---|---|
| **A** | **Modifiche ripetitive** — «rinomina `pompa1.stato` in `P1.stato` ovunque», «aggiungi la soglia di allarme a questi venti tag», «converti questa pagina ai tipi che il pannello disegna» | Alto: è il lavoro noioso e sbagliabile di ogni integratore | Basso: circoscritto, verificabile, con diff | **Prima** |
| **B** | **Diagnosi** — «perché questa pagina è nera?», «quale tag non è dichiarato?», «cosa dicono i log?» | Alto: è il costo dell'assistenza | Nullo: sola lettura | Quasi gratis con A |
| **C** | **Generazione** — «creami un sinottico per una stazione di pompaggio con tre pompe» | È la demo | Alto: molte superfici toccate insieme | **Ultima** |

Partire da **A** non è prudenza: è che A e B condividono tutti gli strumenti di lettura, e A obbliga a
costruire il diff e l'approvazione — cioè le fondamenta di C.

---

## 8. Le fasi

### Fase 1 — Il livello degli strumenti (senza nessuna chat)

Il grosso del lavoro, e produce valore anche se la chat non si facesse mai.

**Lato Rust:**
- `POST /api/project/validate` — valida un progetto o una pagina proposta **senza salvarla**.
  Restituisce errori strutturati (path del campo + messaggio), non un `anyhow` appiattito.
  Riusa `Project::load` e le regole delle guardie.
- `GET /api/schema/oggetto/:tipo` — i campi validi per un tipo, **generati** da `synoptic.rs`.
- *(da valutare)* estendere l'audit: oggi `project.change` registra la sezione e il conteggio, non
  cosa è cambiato; e `save_synoptic`, le funzioni, le lingue non sono auditate affatto. Non è
  richiesto da questo piano, ma se un agente entra nel giro diventa più urgente.

**Lato TypeScript:** un pacchetto `sws-agent-tools` con gli strumenti di §4 come normali funzioni
asincrone, con i loro test. Nessuna dipendenza dall'SDK: sono funzioni che parlano HTTP.

**Prova che la fase è finita**: uno script da riga di comando che, dati un runtime e una richiesta,
legge il progetto, propone una modifica, la valida e stampa il diff. Senza interfaccia.

### Fase 2 — Il sidecar e la chat

- `sws-agent`: processo Node, WebSocket verso l'editor, `query()` dell'SDK, gli strumenti della fase 1
  avvolti in `createSdkMcpServer`, `disallowedTools` di §4.6, chiave API da variabile d'ambiente.
- `scripts/start_agent.sh`, sullo stampo di `start_editor.sh`.
- `ChatPanel` nell'editor: si copia il pattern di `LogPanel`
  (`components/LogPanel.tsx`, aperto/chiuso da `App.tsx:70-80`, persistito in localStorage, voce nel
  menu ☰ a `MainMenu.tsx:188`). Se laterale invece che in basso, l'handle di ridimensionamento si
  copia tale e quale da `EditorShell.tsx:337-362`.
- Streaming dei messaggi, chiamate di strumento visibili, e il diff con **Applica / Scarta**.
- Applicazione dentro `beginInteraction("Assistente: …")`.
- Stringhe in `i18n/it.json` e `en.json` sotto `chat.*`, allineate riga per riga come il resto.

### Fase 3 — Gli occhi

`istantanea_pagina` con l'istanza di prova (§4.4). Da qui l'agente può verificare da solo quello che
ha disegnato, invece di dichiararlo fatto.

### Fase 4 — La porta del terminale

Gli stessi strumenti esposti come **server MCP autonomo**, così `claude` da terminale fa le stesse
cose. È la richiesta originale di Q26, e a questo punto costa poco: gli handler sono già scritti,
cambia l'involucro.

---

## 9. Cosa va deciso prima di cominciare

Non sono dettagli implementativi: cambiano cosa si costruisce.

1. **Confermi che la chat vive solo sul PC di sviluppo?** Tutto il piano poggia su questo. Se un
   domani deve girare anche sul pannello, va ripensato da capo, non esteso.
2. **Quale chiave API, e a carico di chi?** Una chiave Anthropic per il maintainer, o una per
   cliente? Cambia dove si configura e chi paga.
3. **Il punto A di §7 basta per il primo rilascio?** La mia proposta è sì, e che la generazione di
   pagine intere (C) aspetti di aver visto A funzionare su un progetto vero.
4. **L'audit va esteso adesso o dopo?** Oggi una modifica ai sinottici non lascia traccia. Con un
   agente nel giro, «chi ha cambiato questa pagina» diventa una domanda che qualcuno farà.
5. **La modalità senza utenti** (nessun `users.yaml` ⇒ tutto è Admin senza token,
   `router.rs:663-673`) è la configurazione normale sul PC di sviluppo. L'agente erediterebbe Admin.
   Va bene, dato che scrive solo nello store? La mia risposta è sì, ma va detta ad alta voce e non
   scoperta dopo.

---

## 10. Stima, onesta

| Fase | Lavoro | Sessioni da 3-4 h |
|---|---|---|
| 1 | endpoint di validazione + schema + strumenti TS con test | 2 |
| 2 | sidecar + pannello chat + diff/approvazione | 2-3 |
| 3 | istantanea con istanza di prova | 1 |
| 4 | server MCP autonomo | 0.5 |

Sei sessioni e mezzo per tutto; **due** per avere qualcosa che si può giudicare (fine fase 1, da riga
di comando). Se dopo la fase 1 la qualità delle proposte non convince, si è speso poco e si è
comunque guadagnato l'endpoint di validazione e lo schema generato, che servono da soli.

---

## 11. Il rischio che non si compra con niente

Un assistente che modifica progetti SCADA sbaglierà. Il piano lo dà per scontato e mette tre cose fra
l'errore e l'impianto: **il diff che una persona guarda**, **Ctrl+Z**, e **il fatto che l'agente non
sa parlare col dispositivo**.

Quello che nessuna di queste copre è la persona che smette di guardare il diff perché le prime
cinquanta volte era giusto. Non c'è una risposta tecnica. C'è però una scelta di prodotto: tenere le
proposte **piccole e leggibili**, e rifiutarsi di generare modifiche che nessuno rileggerebbe
davvero. È un'altra ragione per cominciare da A e non da C.

---

## 12. Un difetto del piano, trovato dopo averlo scritto

*Aggiunto il 2026-08-31, verificato di nuovo su `main` durante il trasloco su frodo.
Non è stato discusso col maintainer: la conversazione si è interrotta prima.*

Il §1 poggia su una frase troppo larga: «ogni mutazione passa da `pushHistory`, quindi Ctrl+Z è
gratis». **Vale solo per le pagine.**

- `pushHistory` fotografa **soltanto `pages`** (`store/index.ts:532` — `const { pages, past,
  pagesRev } = get()`), e un commento a `:685` lo dice a chiare lettere: *«undo only tracks page
  edits»*.
- Tag, sorgenti, allarmi e funzioni vivono in `project`, **fuori dalla history**.
- Peggio: quelle sezioni **non aspettano `saveAll()`**. `ConfigView` scrive sul runtime subito, col
  proprio Salva — `api.updateTags` a `:528` e `:4285`, `api.updateSources` a `:4281`,
  `api.updateAlarms` a `:4512`.

Conseguenza sul caso d'uso messo **per primo** in §7 («rinomina questo tag in tutte e quattro le
pagine»): tocca entrambe le metà del modello. La metà nelle pagine è annullabile e non arriva su
disco finché nessuno salva; la metà nei tag **non è annullabile e arriva su disco per prima**. Una
proposta accettata a metà, e l'annullamento che ne recupera solo un pezzo, è peggio di nessun
annullamento — perché sembra funzionare.

Tre vie, in ordine di costo:

1. **Restringere la fase 2 alle sole pagine.** L'agente propone modifiche a `pages` e nient'altro;
   tag e allarmi restano di mano umana. Costo zero, e il caso d'uso A va riscritto.
2. **Estendere `pushHistory` a `project`.** Snapshot dell'intero progetto invece delle sole pagine.
   È la soluzione giusta, ma tocca il cuore dello store e va misurata (il progetto è più grosso delle
   pagine, e la history tiene 200 passi).
3. **Far passare le scritture di `ConfigView` da `saveAll()`** usando `registerPendingSection`
   (`store:1726`), il meccanismo che già esiste e che `FunctionEditor.tsx:65` e
   `ConfigView.tsx:345` usano per il salvataggio differito. Rende il gesto «Salva» unico per tutto
   il progetto — cosa buona di per sé, agente o no.

**Va deciso prima della fase 2**, e diventa la sesta domanda del §9.
