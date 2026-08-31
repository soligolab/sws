# T-50 — La chat IA nell'editor, fino al bottone MQTT

*Piano operativo per la sessione notturna del 2026-08-31/09-01. Sostituisce il §2, il §3 e il
§12 di `docs/plans/2026-08-31-chat-ai-nelleditor.md`; il resto di quel piano (gli strumenti, i
segreti, cosa l'agente non deve avere) resta valido e non viene ripetuto qui.*

---

## Contesto

Il maintainer vuole che un integratore possa scrivere in una chat *«metti un bottone che accende
e spegne la luce del salotto, è un device MQTT»* e ottenere il bottone in pagina, funzionante.

Oggi non si può, e non per mancanza di un modello: manca **il livello sotto**. L'editor non ha
un modo per dire «questa modifica è valida» senza salvarla, non ha uno schema leggibile da una
macchina di cosa può stare in un oggetto sinottico, e non ha un modo di applicare una modifica
che tocchi insieme le due metà del progetto — le pagine (nella history, salvate con Salva) e la
configurazione (fuori dalla history, scritta su disco subito da ConfigView). Quest'ultimo è il
difetto trovato ieri sera e scritto nel §12 del piano precedente: una proposta accettata a metà,
con un Ctrl+Z che ne recupera solo un pezzo, è peggio di nessun annullamento perché *sembra*
funzionare.

Il caso d'uso richiesto attraversa esattamente quella frattura: una sorgente MQTT, un tag, un
oggetto in pagina. Non è il caso più facile — è il caso che obbliga a chiudere la frattura.

### Quattro decisioni prese dal maintainer prima di cominciare

| | Decisione | Conseguenza |
|---|---|---|
| 1 | **Il ciclo dell'agente gira in Rust dentro `sws-runtime`** — non in un sidecar Node | Niente processo in più, niente binario `claude`, la chiave sta nella config del runtime |
| 2 | **Transazione dell'assistente** per il §12 | `HistoryEntry` porta anche uno snapshot di `project`; le sezioni toccate passano da `registerPendingSection` |
| 3 | **Chiave API fornita dal maintainer** | Si prova anche il modello vero; l'agente finto resta come test di regressione |
| 4 | **Branch `feat/T-50-chat-ai` + commit firmati + push del branch** | Nessun merge in `main`, nessuna decisione presa al posto del maintainer |

**Perché Rust e non il sidecar.** Il piano di ieri argomentava a favore del Claude Agent SDK per
quattro cose: il ciclo strumento→risultato, `canUseTool`, `disallowedTools`, e il riuso da
terminale. Guardando il codice, tre delle quattro cadono. `disallowedTools` serve a *togliere*
all'agente Bash/Read/Write — ma il §4.6 del piano stesso li toglie tutti, quindi si pagherebbe un
processo Node e 100 MB di binario per poi disabilitarne l'intera dotazione. `canUseTool` serve a
chiedere il permesso prima di uno strumento pericoloso — ma qui l'unico strumento che scrive è
`proponi_modifica`, che per costruzione finisce davanti a una persona. Il riuso da terminale è
la fase MCP, e un server MCP può avvolgere gli stessi endpoint HTTP qualunque sia il linguaggio.
Resta il ciclo, e il ciclo in Rust sono poche centinaia di righe.

In cambio si guadagna che **tutto esiste già**: `/ws/logs`, `/ws/tags`, `/ws/alarms` con
`ws_logs_handler` lato Rust e `ReconnectingWs` + `buildWsUrl` lato browser; `reqwest` è già
dipendenza di `sws-web`; `require_admin` è già il layer giusto. Un `/ws/ai` non inventa niente.
E la chat finisce dentro il prodotto invece che accanto ad esso.

---

## Il bersaglio, scritto per esteso

La sessione è finita quando questa frase, scritta nella chat dell'IDE, produce questo diff:

> «aggiungi alla pagina *Indicatori* un bottone che accende e spegne la luce del salotto —
> è su MQTT, broker 192.168.1.50, topic `casa/salotto/luce`»

```yaml
# project.yaml — sorgenti
+ - kind: mqtt
+   id: broker-casa
+   host: 192.168.1.50
+   port: 1883
+   topics:
+     - tag: luce.salotto
+       topic: casa/salotto/luce/stato
+       publish_topic: casa/salotto/luce/set

# project.yaml — tag
+ - id: luce.salotto
+   description: Luce del salotto
+   data_type: bool

# synoptics/Indicatori.yaml
+ - id: obj_<generato>
+   type: button
+   x: 40, y: 40, width: 120, height: 48
+   label: Luce salotto
+   tag: luce.salotto
+   button_mode: toggle
```

Tre cose vanno notate, perché guidano il progetto degli strumenti:

- **`publish_topic` è il campo che fa la differenza** fra una luce che si guarda e una che si
  accende (`TopicMapping`, `sws-core/src/project.rs:455`). Un modello che non lo conosce produce
  un bottone muto — e muto in silenzio, che è il modo peggiore.
- **`button_mode: toggle`** esiste (`types/index.ts:353`), ma il default è `write`. Il default
  sbagliato dà un bottone che accende e non spegne.
- **`write_value` su un tag `bool` deve essere un booleano**, non la stringa `'true'`. È
  esattamente l'errore trovato ieri nei modelli demo, ed è Q27: il server **non** lo fa
  rispettare. Qui la validazione deve dirlo, perché nessun altro lo dirà.

Nessuna delle tre si indovina. Tutte e tre si leggono da uno schema.

---

## Architettura

```
   ┌─ browser (IDE, 8460) ────────────────┐
   │  ChatPanel ──► /ws/ai ───────────────┼──┐
   │  store zustand ◄── applica proposta  │  │
   └──────────────────────────────────────┘  │
                                             ▼
   ┌─ sws-runtime (Rust) ─────────────────────────────────────┐
   │  ws_ai_handler        ciclo tool-use, streaming al browser│
   │  ai::client           reqwest ──HTTPS──► api.anthropic.com│
   │  ai::tools            gli strumenti = chiamate INTERNE    │
   │  validate / schema    endpoint nuovi, utili da soli       │
   │  chiave: <config_dir>/anthropic.key   (mai nel progetto)  │
   └───────────────────────────────────────────────────────────┘
```

Gli strumenti **non** fanno HTTP verso sé stessi: sono chiamate dirette alle funzioni che gli
handler già usano (`Project::load`, `active_dir`, `TagDb`). Un giro HTTP su localhost per parlare
con il proprio processo sarebbe latenza e una superficie in più senza guadagno.

Vale però la regola dei segreti del §6 del piano precedente: la lettura del progetto passa da
`mask_project_secrets` (`router.rs:1905`) **anche** per l'agente. Non è ereditata — va scritta,
perché l'agente legge dall'interno e la mascheratura oggi vive nell'handler HTTP.

---

## Fase A — Il livello che vale anche se la chat non si facesse (Rust)

Nessuna riga di IA. Tutto provabile con `cargo test` e `curl`.

### A1. `sws-core/src/validate.rs` — il giudice

Nuovo modulo. Una funzione:

```rust
pub fn validate(project: &Project, pages: &[SynopticPage]) -> Vec<Finding>
pub struct Finding { pub severity: Severity, pub path: String, pub message: String, pub hint: Option<String> }
```

`path` è un percorso puntato che il modello può usare per correggersi da solo
(`pages[Indicatori].objects[obj_7].write_value`), non un `anyhow` appiattito. `hint` è la frase
che dice *come* si aggiusta — è quella che chiude il ciclo di autocorrezione.

Regole della prima passata, **tutte già esistenti da qualche parte** e qui riunite:

| Regola | Da dove viene |
|---|---|
| id di sorgente vuoto o duplicato | `router.rs:2290`, oggi solo nel `PUT` |
| tag riferito da un oggetto e non dichiarato | `check_templates.sh` |
| `write_value` di tipo diverso dal `data_type` del tag | `check_templates.sh` (Q27) |
| tipo di oggetto sconosciuto | `SynopticObjectType` |
| ancoraggio pipe verso un oggetto inesistente | `check_templates.sh` |
| cella di griglia che non disegna niente (`objects:` invece di `child:`) | difetto trovato il 2026-08-31 |
| `points` su una `line` | difetto trovato il 2026-08-31 |
| porta sconosciuta su una pipe | `check_templates.sh` |
| **nuova**: mapping MQTT che scrive su un tag senza `publish_topic` | il bersaglio di stanotte |
| **nuova**: oggetto interattivo (`button`, `slider`, `setpoint`, `checkbox`) legato a un tag non scrivibile (con `expression`) | stesso genere |

Il parser è quello vero: si serializza in YAML e si rilegge con `serde_yaml::from_str::<Project>`,
la stessa cosa che fa `Project::load` (`project.rs:998` — è solo `read_to_string` + serde). Non
si approssima serde: è la lezione di `tutti_i_template_si_caricano`.

**Test**: un test Rust che fa girare `validate` su tutti i template di `examples/templates/` e
pretende zero `Finding` di severità errore — gemello di `tutti_i_template_si_caricano`. Più un
test per regola, nel verso rotto. Le regole che oggi vivono in `check_templates.sh` restano
dove sono: toglierle è un'altra sessione, e due controlli d'accordo non fanno male.

### A2. `POST /api/project/validate` — Admin

Corpo: `{ project?: Project, pages?: [SynopticPage] }`, entrambi opzionali (si valida quello che
arriva contro quello su disco per il resto). Risposta: `{ findings: [Finding] }`, sempre 200 —
un progetto non valido non è un errore HTTP, è una risposta con dentro dei rilievi.

**Non salva niente.** È l'unico endpoint di scrittura-apparente che non tocca il disco, e questo
va scritto nel commento sopra la route perché fra sei mesi sembrerà strano.

### A3. Lo schema, generato — `GET /api/schema/synoptic[?tipo=button]`

Tre pezzi, tutti derivati, nessuno copiato a mano:

1. **I campi.** `scripts/gen_synoptic_schema.py` legge `sws-web/src/synoptic.rs` (238 campi) ed
   emette `sws-web/src/synoptic_schema.rs`: nome, tipo Rust ridotto a `string|number|bool|any`,
   obbligatorio o no, e il **commento di documentazione del campo** — che è già scritto, in
   italiano e in inglese, ed è la cosa più utile che possiamo dare al modello.
2. **Gli esempi per tipo.** Sempre generati, ma da `examples/templates/**/synoptics/*.yaml`: per
   ogni tipo di oggetto, l'unione dei campi effettivamente usati nei progetti veri più due o tre
   snippet YAML reali. Non è «i campi validi per un button» (che nessuno ha mai scritto da
   nessuna parte) ma «i campi che un button ha, nei progetti che funzionano» — che è più onesto
   e si mantiene da solo.
3. **Gli enum.** `button_mode`, `blink_mode`, i `kind` di sorgente: estratti dalle union TS e
   dagli `#[serde(rename)]` Rust.

**Guardia `scripts/check_synoptic_schema.sh`**, classificata in `STATICHE` dentro
`check_static.sh` (altrimenti `check_static.sh` fallisce da solo — ci ha già preso una volta):
rigenera e confronta, fallisce se il file committato è vecchio. Stessa forma di
`check_lvgl_types.sh`.

### A4. `GET /api/schema/source[?kind=mqtt]`

Uguale, su `SourceDef` e le sue otto varianti. Serve per il bersaglio: senza, il modello non sa
che esiste `publish_topic`.

> **Punto di sosta 1.** `cargo check` + `cargo test` verdi, `check_static.sh` verde, e un
> `curl -X POST .../api/project/validate` che rifiuta un `write_value: "true"` su un tag `bool`
> dicendo dove e perché. Commit.

---

## Fase B — Il ciclo, e un agente finto per provarlo (Rust)

### B1. `sws-web/src/ai/mod.rs` — il client

`reqwest` verso `POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`,
streaming SSE. Modello **`claude-opus-5`** (1M di contesto, $5/$25 per MTok), `max_tokens: 16000`,
`thinking: {type: "adaptive"}` — su Opus 5 il pensiero è acceso di default e `budget_tokens` è
stato rimosso: passarlo dà 400. `output_config: {effort: "high"}`.

Due cose da non sbagliare, perché il modo in cui si rompono è silenzioso:

- **`stop_reason: "refusal"` arriva con HTTP 200.** Va controllato prima di leggere `content`,
  altrimenti la chat mostra una risposta vuota e nessuno capisce perché.
- **Le chiamate a strumento in parallelo tornano in un solo messaggio**, e i risultati vanno
  rimandati **tutti insieme in un solo messaggio utente**. Spezzarli insegna al modello a non
  farne più in parallelo, e non si vede: si vede solo che è lento.

**Caching del prompt**: lo schema generato è grosso e non cambia mai fra un turno e l'altro. Va
in `system` con `cache_control: {type: "ephemeral"}`, prima di tutto il resto, e il contenuto del
progetto — che cambia — **dopo**. Si verifica con `usage.cache_read_input_tokens`: se resta zero
fra due turni, qualcosa di volatile è finito nel prefisso.

**La chiave**: `<config_dir>/anthropic.key`, letta all'avvio, con `ANTHROPIC_API_KEY`
dell'ambiente che vince se presente. `*.key` è già in `.gitignore` (riga 20). La chiave **non
entra mai** nel progetto, non passa da `GET /api/project`, non finisce nei log — e il log del
turno registra i conteggi di token, mai il corpo della richiesta.

### B2. `sws-web/src/ai/tools.rs` — gli strumenti

Chiamate interne, non HTTP. Solo lettura, tranne l'ultimo:

| Strumento | Cosa fa |
|---|---|
| `elenca_pagine` | nomi e dimensioni delle pagine |
| `leggi_pagina(nome)` | gli oggetti di una pagina |
| `leggi_progetto` | progetto **mascherato** (`mask_project_secrets`) |
| `elenca_tag` | id, `data_type`, descrizione, unità |
| `schema_oggetto(tipo)` | A3 |
| `schema_sorgente(kind)` | A4 |
| `valida(proposta)` | A2, in-process |
| `proponi_modifica(motivo, project?, pages[])` | **non applica niente**: chiude il turno e manda la proposta al browser |

`proponi_modifica` chiama `valida` da sola prima di rispondere. Se ci sono errori li restituisce
al modello invece di inoltrarli, e il modello riprova — al massimo tre volte, poi la proposta va
al browser **con i rilievi in evidenza**, perché una proposta imperfetta guardata da una persona
è meglio di un giro infinito.

**Cosa non c'è, e resta scritto** (§4.6 del piano precedente, invariato): nessuna esecuzione di
Python, nessun `GET /api/project/export` (lo ZIP porta i segreti in chiaro, decisione del
2026-07-29), nessun `PUT` verso il progetto, nessun deploy, nessun accesso al filesystem.

### B3. `/ws/ai` — Admin

Nel router admin, accanto a `/ws/logs`. Messaggi JSON in entrambi i versi:

```
→ { t: "chiedi", testo, impronta }          impronta = GET /api/project/fingerprint
← { t: "testo", delta }                     streaming della risposta
← { t: "strumento", nome, stato }           così si vede cosa sta facendo
← { t: "proposta", id, motivo, diff, rilievi[], impronta }
← { t: "errore", messaggio }
```

L'impronta viaggia in entrambi i versi: l'agente la legge quando comincia, la proposta se la
porta dietro, e il browser **rifiuta di applicare** una proposta la cui impronta non corrisponde
più. È il controllo di concorrenza ottimistico del §5.1, e il pezzo che serve esiste già
(`router.rs:4611`).

### B4. L'agente finto

`SWS_AI_FAKE=<file.json>`: invece di chiamare il modello, `ws_ai_handler` rigioca una traccia
registrata di chiamate a strumenti e testo. La traccia del bersaglio (`tests/ai/luce-mqtt.json`)
si scrive a mano una volta.

Non è un ripiego per la mancanza della chiave — la chiave c'è. Serve perché **il pannello, il
diff, la transazione e Ctrl+Z si provano deterministicamente**, in un test che gira sempre e non
costa niente, mentre il modello vero cambia risposta ogni volta. Resta come regressione.

> **Punto di sosta 2.** `/ws/ai` in piedi, `SWS_AI_FAKE` che produce la proposta del bottone MQTT,
> vista con `websocat` o da un piccolo script. Nessuna interfaccia ancora. Commit.

---

## Fase C — Il pannello, e la transazione dell'assistente (TypeScript)

### C1. La transazione — `store/index.ts`

È il pezzo che chiude il §12, ed è chirurgico.

```ts
// Oggi:  HistoryEntry { pages, label, rev }
// Dopo:  HistoryEntry { pages, label, rev, project?: Project }
```

`project` viene valorizzato **solo** dalle voci spinte da una transazione dell'assistente; per
tutto il resto resta `undefined` e niente cambia. `undo`/`redo`/`jumpTo` (righe 1544-1621)
ripristinano `project` quando c'è. Il costo in memoria si paga solo quando l'assistente lavora.

Poi una sola azione nuova:

```ts
applyAiProposal(p: Proposta): void
  1. se p.impronta ≠ impronta corrente → rifiuta, dillo, non toccare niente
  2. beginInteraction(`Assistente: ${p.motivo}`)   // spinge la voce con lo snapshot di project
  3. muta pages e project in memoria (nessuna chiamata di rete)
  4. registerPendingSection("ai:tags" | "ai:sources" | "ai:alarms", () => api.updateX(...))
     — solo per le sezioni davvero toccate
  5. endInteraction()
```

Il punto 4 è quello che fa arrivare le due metà su disco **insieme**, allo stesso Salva:
`saveAll()` svuota `pendingSections` prima di scrivere le pagine (righe 1745-1751). Il
meccanismo esiste già e lo usano `FunctionEditor.tsx:65` e `ConfigView.tsx:345` — non si inventa
niente, si estende l'uso.

E il punto 1 è quello che impedisce all'assistente di cancellare quello che il maintainer ha
appena spostato mentre il modello pensava.

**Attenzione (trappola vera):** `saveAll()` **non** scrive `tags`/`sources`/`alarms` per una
ragione documentata nel codice — una copia in memoria più povera del disco cancellava dati, ed è
successo davvero (audit del 2026-07-28, `{"count": 0, "what": "tags"}` su un progetto con 16
variabili). La transazione non riapre quella ferita, perché non scrive la copia in memoria alla
cieca: parte da un `leggi_progetto` fresco dello stesso turno, e l'impronta rifiuta la proposta se
il disco è cambiato nel frattempo. Questo va scritto nel commento sopra `applyAiProposal`, non
solo qui.

### C2. `components/ChatPanel.tsx`

Si ricalca `LogPanel.tsx` (470 righe): stesso pattern di apertura/chiusura da `App.tsx:70-80`,
stessa persistenza in localStorage, voce nel menu ☰ a `MainMenu.tsx:188`. Se laterale invece che
in basso, la maniglia di ridimensionamento si copia da `EditorShell.tsx:337-362`.

Il flusso della connessione riusa `ReconnectingWs` + `buildWsUrl("/ws/ai", "VITE_AI_WS_URL")`,
come `logStream.ts`.

Contenuto: i messaggi in streaming, le chiamate a strumento visibili mentre accadono (è metà
della fiducia), e la proposta come **diff leggibile** — non YAML grezzo, ma tre elenchi: *tag
nuovi*, *sorgenti toccate*, *oggetti aggiunti in pagina*, con i rilievi della validazione se ce
ne sono. Due pulsanti: **Applica** e **Scarta**.

Stringhe in `i18n/it.json` e `en.json` sotto `chat.*`, allineate riga per riga (oggi 1145 righe
ciascuno, e restano uguali).

> **Punto di sosta 3.** `pnpm build` verde. Con `SWS_AI_FAKE` acceso: si apre la chat, si scrive
> qualsiasi cosa, arriva la proposta del bottone, si preme Applica, **il bottone compare sul
> canvas**, Ctrl+Z lo toglie *insieme* al tag e alla sorgente, Salva li scrive tutti e tre.
> Commit. Questo è il punto in cui il lavoro si può giudicare.

---

## Fase D — Il modello vero

Si spegne `SWS_AI_FAKE` e si mette la chiave. Il lavoro qui non è codice ma **il prompt di
sistema**, e va scritto con la stessa cura degli strumenti:

- chi è (assistente di progettazione SCADA dentro l'IDE SWS), cosa può e cosa non può;
- **la regola d'oro**: non indovinare mai un nome di campo — chiamare `schema_oggetto` /
  `schema_sorgente` prima di scrivere; validare prima di proporre;
- proposte **piccole**: un'intenzione per proposta. È la risposta di prodotto al rischio del §11
  del piano precedente — la persona che smette di guardare il diff perché le prime cinquanta
  volte era giusto;
- i contenuti del progetto entrano nel contesto **marcati come dati, non come istruzioni** (§5.2:
  un progetto importato da fuori può contenere una frase costruita per farsi obbedire).

Prove, in ordine: la frase del bersaglio; poi la stessa senza dire il broker (deve *chiedere*, non
inventare `localhost`); poi una pagina che esiste già e un tag che esiste già (deve riusarli, non
duplicarli); poi una richiesta impossibile (deve dire di no).

---

## File toccati

**Rust nuovi**: `sws-core/src/validate.rs`, `sws-web/src/ai/{mod,client,tools,prompt}.rs`,
`sws-web/src/synoptic_schema.rs` (generato).
**Rust modificati**: `sws-core/src/lib.rs`, `sws-web/src/router.rs` (tre route + `/ws/ai`),
`sws-web/src/lib.rs`.
**TS nuovi**: `components/ChatPanel.tsx`, `ws/aiStream.ts`, `types/ai.ts`.
**TS modificati**: `store/index.ts` (HistoryEntry + `applyAiProposal`), `App.tsx`,
`components/MainMenu.tsx`, `api/client.ts`, `i18n/{it,en}.json`.
**Script**: `scripts/gen_synoptic_schema.py`, `scripts/check_synoptic_schema.sh`,
`scripts/check_static.sh` (una riga in `STATICHE`).
**Docs**: `CHANGELOG.md` sotto `[Unreleased]`, `STATUS.md`, `docs/HOWTO.md` (come si accende la
chat e dove va la chiave).

## Verifica

1. `cd sws-runtime && cargo check --workspace --all-targets` e `cargo test --workspace` — verdi.
   (Su frodo `pnpm` esiste solo dentro `sws-editor/`, e `python3` è pyenv 3.11.2: le guardie vanno
   lanciate dalla shell del maintainer, non con `sudo`.)
2. `cd sws-editor && pnpm build` — verde.
3. `./scripts/check_static.sh` — otto guardie verdi (le sette di oggi più `check_synoptic_schema`).
4. `./scripts/start_editor.sh --instance 3` (istanza di prova, porta 8464, **dichiarata e
   terminata a fine sessione** — mai toccare le istanze del maintainer), progetto creato dal
   template `demo-items-web`, e il percorso del punto di sosta 3 con l'agente finto.
5. Con la chiave: le quattro prove della fase D.

## Rischi, detti prima

- **Il diff sul canvas può sembrare giusto e non esserlo sul pannello.** L'istantanea LVGL (fase 3
  del piano precedente) chiude questo anello, ed è fuori dal perimetro di stanotte. Nel frattempo
  il rilievo «tipo non disegnato dal motore LVGL» si può aggiungere a `validate` a costo quasi
  zero, riusando `LVGL_SUPPORTED_TYPES`: lo faccio se avanzo tempo.
- **`Finding` con `path` è un contratto**: se il modello impara a leggerlo e poi cambia forma, si
  rompe in silenzio. Il test sui template lo blocca.
- **La chiave incollata in chat va ruotata.** Preferisco leggerla da
  `.run-editor/config/anthropic.key` (`chmod 600`, già ignorato da git): scrivicela tu, io non la
  vedo passare.

## Cosa finisce in `docs/OPEN_QUESTIONS.md`, non deciso qui

- Se la chat debba un domani girare anche **sul dispositivo** (oggi: no, ed è la decisione che
  rende semplice tutto il resto).
- **Chi paga la chiave** su un'installazione cliente: una per maintainer, una per cliente, o
  nessuna e la chat non c'è.
- Se l'**audit** vada esteso ai sinottici ora che un agente entra nel giro — oggi
  `project.change` registra sezione e conteggio, e `save_synoptic` non è auditato affatto.
- Se `ConfigView` debba passare tutta da `saveAll()` (l'opzione 2 del §12, rimandata).
