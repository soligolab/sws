# ADR 0003 — Editor and Runtime Are the Same Binary

**Status**: Accepted (PoC) — records a situation that was never deliberately decided
**Date**: 2026-09-02
**Decided**: 2026-09-02
**Deciders**: Soligo Lab maintainers

> **Questo ADR registra a posteriori.** A differenza di 0001 e 0002, che documentano scelte fatte
> in una sessione di progettazione, qui la situazione è **emersa** e nessun documento la propone,
> la motiva o la registra. Dirlo è parte del contenuto: senza questa avvertenza l'ADR
> trasformerebbe in decisione una cosa che nessuno ha scelto, e chi lo leggesse fra un anno
> crederebbe che ci fosse un ragionamento dietro.

## Context

Il 2026-09-02 il maintainer, rileggendo delle osservazioni sulla divisione editor/runtime, l'ha
trovata ibrida e ha detto: «quando abbiamo diviso editor e runtime la mia idea era di avere **due
programmi distinti**, non un binario uguale con un parametro di avvio differente». Poi ha chiesto
i fatti, e in particolare se l'editor lavori in locale o direttamente nella cartella del
dispositivo. Le risposte, misurate.

### 1. Com'è fatto

**Un solo eseguibile server**: `sws-runtime` (`crates/sws-runtime/src/main.rs`). Gli altri due
`[[bin]]` del repo sono `sws-kiosk` (finestra GTK/WebKit, escluso dal workspace) e
`sws-lvgl-viewer`; nessuno dei due è un editor.

I due pacchetti distribuiti da `scripts/build_deploy.sh` — `sws-runtime-<v>-linux-<arch>.tar.gz`
e `sws-editor-<v>-linux-<arch>.tar.gz` — contengono **lo stesso eseguibile**. Lo script lo dice di
suo pugno: «*the roles differ only in the bundled launcher/installer, not in the compiled
artifacts*». Il pacchetto editor porta `deploy/editor/run-editor.sh` (che non passa
`--viewer-port`), quello runtime porta l'installer systemd.

Il ruolo è scelto da **`--viewer-port`**, e la sua assenza cambia esattamente questo:

| Effetto | Dove |
|---|---|
| il listener del viewer non viene aperto | `main.rs:848` |
| `AppState.ide_only = true` | `main.rs:814` → `router.rs:203` |
| mDNS non annuncia il servizio | `main.rs:936` |
| `--kiosk-browser` ignorato | `main.rs:943` |
| `--kiosk-wayland` ignorato | `main.rs:975` |
| la pagina di accettazione del certificato nasconde la riga «viewer» | `main.rs:896` |
| `--no-admin` diventa una combinazione vietata | `main.rs:866` |

Sono socket e cosmetica. **`ide_only` gateava una cosa sola in tutto il binario** — le tre rotte
`/api/ai/config` (`ai/config_api.rs`) — finché questo ADR non ha portato il campo `mode` in
`GET /api/system` (vedi Decision).

### 2. Cosa questo comporta: in modalità editor il motore gira per intero

Nessuno dei servizi di runtime è condizionato a `viewer_port`. Un'istanza «editor» riapre da sé
l'ultimo progetto attivo dal marker `<projects_root>/.active-project` (`main.rs:424-455`, ed è il
caso di `start_editor.sh`, che non passa `--project`) e da lì avvia, identici al dispositivo:

- il supervisore delle sorgenti — `supervisor.reload(project.sources)` in `projects.rs`, cioè i
  driver Modbus / OPC-UA / MQTT / S7 / EtherNet-IP / HomeAssistant;
- il valutatore allarmi, l'historian e il suo recorder, i tag derivati in Python;
- `GlobalScriptSupervisor` con lo scheduling cron, il `NotificationSupervisor` (email +
  escalation), il sender Telegram (`projects::start_project_services`);
- il loop di auto-backup (tick 60 s), l'audit log, il recorder Prometheus.

**Misurato**, non dedotto: nei log di un'istanza `start_editor.sh` reale compaiono `source
supervisor reload complete`, `historian: SQLite store opened`, `datastore: backend initialized`,
`historian: swapped to project SQLite`.

**Limite della misura, da non nascondere**: il progetto di prova aveva 0 sorgenti, quindi la riga
diceva `started: 0`. Che la macchina parta è certo; **una connessione a un PLC vero da un'istanza
editor non è stata osservata**. La conclusione «l'editor parlerebbe coi PLC del progetto che apre»
segue dal fatto che la chiamata è la stessa che fa il dispositivo, senza gate — non da una prova.

### 3. Dove vive il progetto

Il server non tiene nessun `Project` in memoria: `AppState.project_dir` è solo un `PathBuf`, e
`GET /api/project` fa `Project::load` a ogni richiesta. La copia di lavoro è nel browser (zustand);
il Salva è un fan-out di PUT che riscrive `project.yaml` e `synoptics/*.yaml` **sul filesystem del
processo a cui la SPA è collegata**. Da lì seguono due porte, e la differenza è grossa:

- **Porta admin di un dispositivo** (`start_runtime.sh`, e *tutti* i deploy: yocto,
  generic-linux, container). Si modifica il progetto dell'impianto **in presa diretta**, e il
  Salva fa hot-reload: `supervisor.reload` sulle sorgenti nuove, `alarms.load`, tag aggiunti e
  rimossi. Nessun riavvio, nessuna conferma.
- **Editor su un PC** (`start_editor.sh`, pacchetto portabile). Cartella locale e separata
  (`.run-editor/projects/<nome>`, o `./data/projects/`). Il dispositivo ne ha una **copia**, e si
  sincronizza solo a **bundle interi**: push `POST /api/remote/deploy`, pull
  `GET /api/remote/project/export`. Non esiste alcun endpoint che scriva un singolo file di
  progetto sul dispositivo.

### 4. Che non è stato deciso

Nessun ADR prima di questo. Nessuna riga nella tabella «Frozen architectural decisions» di
`docs/CONTEXT.md` §5, che ne ha 24 e non parlava della divisione fra i due programmi. La cosa
emerge in tre tappe, tutte presentate come conseguenze operative:

1. **T-21** (release `2026.7.0`): «*Two `TcpListener` nello stesso processo condividono `AppState`
   e TLS*». Nasce la separazione porta + auth, non due programmi.
2. **2026-07-31**, nascita di `start_editor.sh`: `--viewer-port` diventa `Option<u16>`. La
   motivazione scritta accanto a quel cambiamento è **«eliminare i conflitti di porta quando
   editor e runtime girano sulla stessa macchina di sviluppo»** — comodità di sviluppo, non
   architettura.
3. **T-37**, packaging: compare per la prima volta la frase «*editor e runtime sono lo stesso
   binario `sws-runtime`: differiscono solo per il launcher/installer incluso*». In un changelog
   di *packaging*.

E la spec dice un'altra cosa. `docs/SWS_Project_Specification.md` §3.1 prevede **due repository e
due immagini container** che «*share the same project folder*». L'unica implementazione di quella
forma — `compose.yaml` + due Dockerfile — non ha mai funzionato ed è stata cancellata il
2026-09-02 (vedi il commit `chore: via il percorso container legacy`); fra l'altro il servizio che
si chiamava `editor` serviva il bundle del **viewer**.

L'unico documento che valutava la situazione è `docs/OPEN_QUESTIONS.md` **Q8**, che la chiama
*gap*: «*Il PoC li ha collassati in un unico processo […] L'isolamento è solo a livello di porta +
auth, non di processo*», con lo split in due processi (opzione E) **rinviato al product phase**.
Q8 però descrive il gap sul **dispositivo**; il verso opposto — che l'editor è un motore completo
sul PC di sviluppo — è stato aggiunto lì il 2026-09-02.

## Options

1. **Tenere il binario unico e rendere visibile la modalità.** Nessun cambio di comportamento del
   motore; l'istanza dichiara il proprio ruolo e l'IDE lo mostra.
2. **L'editor smette di essere un motore** (`--design-only`): niente driver, cron, notifiche,
   historian, auto-backup. Costa meno di quanto sembri — il motore è quasi tutto *reattivo*, e un
   gate dentro `SourceSupervisor::reload` coprirebbe tutti i percorsi di reload in una volta — ma
   fa perdere lo storico nell'editor, che il relay verso il dispositivo non copre.
3. **Due eseguibili veri** dallo stesso workspace, con `sws-web` condiviso. Le rotte esclusive
   dell'editor sono ~25 su 186; quelle esclusive del runtime **zero** (il viewer è un
   sottoinsieme). Oggi darebbe due nomi per lo stesso programma; il costo vero sta fuori da Rust
   (`build_deploy.sh`, service/quadlet/installer, guardie).
4. **Q8-E, split di processo** (engine vs web-admin). Product phase.

Costi e dettagli delle opzioni 2-4 sono in Q8, dove vanno tenuti aggiornati.

## Decision

**Opzione 1, per il PoC.** Si tiene un binario con due modalità, e la modalità smette di essere
invisibile: `GET /api/system` porta `mode` (`"ide"` / `"runtime"`), derivato da `AppState.ide_only`,
e l'IDE lo mostra in tre punti — un marcatore in testata quando l'istanza serve un impianto, una
card «Modalità» nella scheda Stato (che con un dispositivo collegato dice **la sua** modalità), e
la sezione Assistente, che non deduce più la modalità da un 404.

**Va registrato che questa non è la preferenza del maintainer.** Ha detto di volere due programmi
distinti, e la ragione per cui non si fa adesso è che la cosa che dà fastidio è di comportamento,
non di nome: due eseguibili oggi sarebbero due copie della stessa cosa, e l'editor continuerebbe a
connettersi ai PLC dal PC di sviluppo. L'opzione 2 è il pezzo che nessun'altra sostituisce, e
quando si riprenderà l'argomento è da lì che conviene partire — non dal packaging.

**Non deciso qui**: dove *debba* vivere il progetto che si modifica, cioè quale delle due porte sia
la via normale e quale l'eccezione. È `docs/OPEN_QUESTIONS.md` **Q32**.

## Consequences

- **Chi apre l'IDE sa su cosa sta scrivendo.** Prima nulla nella UI distingueva «modifico
  l'impianto in servizio» da «modifico una copia locale».
- Il marcatore sta **fuori dal gate di ruolo** del resto di `RuntimeCtrl`: salvare un sinottico è
  tier Supervisor, quindi un Supervisor può scrivere sull'impianto senza poter configurare, ed è
  esattamente la persona che l'avviso deve raggiungere.
- `ide_only` smette di essere un campo con un solo lettore e comincia a significare qualcosa
  nell'API. Chi aggiungerà un comportamento specifico dell'editor ha già dove appenderlo.
- **Resta vero che l'editor è un motore.** Chi apre nell'editor un progetto con sorgenti reali fa
  partire connessioni reali, e con allarmi configurati fa partire notifiche reali. Questo ADR lo
  scrive; non lo cambia.
- `mode` è **opzionale** lato SPA: `/api/remote/system` può rilanciare la risposta di un runtime
  più vecchio, e in quel caso la UI non afferma niente invece di indovinare.
- Un effetto collaterale utile: siccome quella scheda interroga il dispositivo collegato,
  «collegare un editor a un altro editor» — prima possibile e silenzioso — ora si vede.
