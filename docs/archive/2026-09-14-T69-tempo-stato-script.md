# T-69 — dare tempo e stato agli script Python di progetto

## Contesto

Il maintainer aveva chiesto all'assistente IA una rampa ciclica 0→100→0 a periodo di decimi di
secondo; l'assistente si è fermato elencando otto limiti. Nella sessione dell'11-09-2026 li ho
riverificati tutti nel codice (sette reggevano, uno no — il passaggio parametri esiste già, va
solo trovato) e la nota è rimasta in `STATUS.md` come lavoro da riprendere. Oggi (14-09-2026) il
maintainer ha chiesto di affrontarla per intero: **tutti e sei i miglioramenti elencati**, non
solo i due a resa più alta.

Il blocco vero, dietro a tutto: **dentro uno script Python di progetto non esiste un orologio**.
L'unica API oggi è `tags.read`/`tags.write`/`send_telegram` (`sws-pyscript/src/lib.rs`). Una
logica che deve muoversi nel tempo reale (rampa, onda) può solo avanzare di un passo fisso a ogni
invocazione — la cadenza reale la decide chi la chiama, non lo script. Il template
`examples/templates/demo-items-web/project.yaml` (`global_scripts` → `demo-sim`) è la prova
vivente del costo di aggirare questo limite oggi: un contatore-tag fatto apposta, una tabella
trigonometrica a 32 punti scritta a mano perché `import math` è vietato in RestrictedPython, e un
commento che lo spiega.

**Scoperto durante l'esplorazione, non in `docs/OPEN_QUESTIONS.md`**: `send_telegram(...)`
chiamato da uno script solleva sempre `NameError`. È registrato nei globals esterni di
`run_in_python` (`lib.rs:573`) ma **non** copiato dentro `__sws_globals__`, il dizionario contro
cui il codice utente gira davvero (`lib.rs:145-157`) — bug pre-esistente, stesso file, stesso
pattern di correzione dell'orologio nuovo. **Il maintainer ha confermato di sistemarlo insieme**
(Fase A).

## Le cinque fasi — un ramo alla volta, chiudi-mergia-elimina prima di aprire la successiva

Il maintainer ha scelto di affrontarle tutte in questa sessione. Cinque rami separati in
sequenza, per la regola «Un ramo alla volta» di `CLAUDE.md` — ognuno chiuso (test, conferma,
squash-merge, verifica `main^{tree}` == `<ramo>^{tree}`, `git branch -D`) prima di aprire il
successivo. Se il tempo/contesto finisce a metà, fermarsi a una fase chiusa è un punto pulito;
annotare in `STATUS.md` quali fasi restano.

### Fase A — orologio + stato ritenuto per script (branch `feat/T69-orologio-stato-script`)

La più piccola, e quella che sblocca davvero il caso della rampa.

**Bindings nuovi**, seguendo l'ESATTO pattern di `tags` (non quello rotto di `send_telegram`):
`now_ms()` (epoch wall-clock, `SystemTime::now()`), `uptime_ms()` e `delta_ms()` — più un oggetto
`state` con `state.get(key, default=None)` / `state.set(key, value)` per ricordare piccole cose
(es. la direzione di una rampa) senza sporcare l'elenco tag.

**Design, verificato sul codice**:
- `Engine` (`lib.rs:310-319`) è già `Clone` + interior-mutable per `telegram_tx`
  (`Arc<Mutex<Option<...>>>`) — stesso pattern per un nuovo
  `Arc<Mutex<HashMap<String, ScriptState>>>`, dove
  `ScriptState { first_seen: Instant, last_invocation: Option<Instant>, scratch: HashMap<String, serde_json::Value> }`.
- La mappa è chiavata per **identità** (id dello script globale, o nome della funzione) — non un
  solo campo sull'`Engine`. Necessario perché lo `Engine` condiviso (`AppState.py`, un solo
  `PyEngine::new` in `main.rs:394`) serve **tutte** le funzioni/handler; senza chiave per nome,
  `delta_ms()` di una funzione rifletterebbe l'ultima chiamata di una funzione qualunque. Gli
  script globali hanno invece un `Engine` proprio ciascuno (`global_scripts.rs:41`, un
  `PyEngine::new` per script abilitato) — la stessa mappa funziona identica in entrambi i casi,
  con una sola voce per gli script globali.
- `execute`/`execute_with_args` (`lib.rs:374,382`) guadagnano un parametro `identity: &str`.
  Le due chiamate esistenti hanno già il nome a portata di mano: `run_function` in
  `sws-web/src/router.rs:4371` (variabile `name`) ed `exec_once` in
  `sws-web/src/global_scripts.rs:220-221` (parametro `id`).
- `uptime_ms()` = tempo dalla prima invocazione vista per QUELLA identità (`first_seen`), non
  dall'avvio del processo — evita di dover far viaggiare un orologio unico di processo dentro
  ogni `Engine`, e resta comunque un numero utile e ben definito.
- `delta_ms()` alla prima invocazione (nessun "prima" con cui confrontare): **restituisce 0**
  (deciso dal maintainer) — una rampa scritta come `pos += delta_ms/periodo` resta ferma al primo
  giro invece di saltare, senza bisogno di un controllo esplicito nello script.
- Bindaggio nel sandbox: il bug di `send_telegram` insegna dove NON sbagliare. I nuovi nomi
  vanno aggiunti (a) ai globals esterni in `run_in_python` (`lib.rs:567-577`), (b) dentro
  **entrambi** i rami di `__sws_globals__` in `HARNESS` (`lib.rs:145-151` sandboxed, `:157` non
  sandboxed) — è il passo che manca a `send_telegram` oggi — e (c) alla lista `__sws_forniti__`
  di `CHECK_HARNESS` (`lib.rs:716`), altrimenti `Engine::check` li segnala come nomi sconosciuti.
- **Fix del bug `send_telegram`**: stessa correzione (b) applicata al binding esistente.

**Verifica**: nuovi test in `sws-pyscript` (uno script che legge `now_ms()`/`uptime_ms()`/
`delta_ms()`/`state.get`/`state.set` due volte di fila e verifica che `delta_ms` sul secondo giro
sia coerente con l'attesa; uno che chiama `send_telegram` e verifica che non sollevi più
`NameError`). `cargo test -p sws-pyscript`, poi gate pieno (`cargo check/test/clippy/fmt
--workspace`, `./scripts/check_static.sh`).

### Fase B — `interval_ms` sui trigger degli script globali (branch annidato o nuovo, a scelta al momento)

`ScriptTrigger::Interval` (`sws-core/src/project.rs:838-853`) ha solo `interval_s: u64`, letto in
un solo punto (`global_scripts.rs:80-81`, `Duration::from_secs(interval_s.max(1))`).

- Campo nuovo **additivo**: `interval_ms: Option<u64>`, che quando presente **vince** su
  `interval_s` — stesso pattern già usato in questo codice per campi opzionali nuovi (es.
  `write_data_type` accanto a `data_type`), zero rotture sui template esistenti.
- `global_scripts.rs`: `interval_ms.map(Duration::from_millis).unwrap_or_else(|| Duration::from_secs(interval_s.max(1)))`,
  con un pavimento anche per `interval_ms` (proporre 50ms in fase di implementazione — sotto
  quella soglia l'overhead di `spawn_blocking`+GIL rende la cadenza comunque inaffidabile,
  verificare/misurare prima di fissare il numero).
- `validate.rs:597-603` (oggi rifiuta `interval_s == 0`): stessa guardia per `interval_ms == 0`
  quando presente.
- Editor: `sws-editor/src/types/index.ts:1589` (union del trigger), `ConfigView.tsx` righe
  ~6989/7181/7189/7198-7199 (stringa di riepilogo, default, label, input) — aggiungere un secondo
  campo numerico opzionale "millisecondi (ha priorità)".
- **Lezione di ieri**: aggiornare anche la descrizione dello schema per l'assistente IA
  (`sws-web/src/ai/tools.rs:623`) e rilanciare `check_static.sh` (contiene la guardia
  `check_synoptic_schema` che ieri è stata trovata rossa per uno scarto dimenticato).

### Fase C — funzioni di progetto chiamabili da uno script globale (branch nuovo)

Oggi le funzioni (`FunctionDef`, `sws-core/src/project.rs:771-784`) si eseguono in un solo modo:
`POST /api/script/run/:name` → `run_function` (`router.rs:4349-4400`) → `s.functions` (mappa in
memoria) → `s.py.execute_with_args`. Nessun trigger proprio, e uno script globale non può
chiamarle: `GlobalScriptSupervisor::start` (`global_scripts.rs:24-56`) non riceve mai
`s.functions`, solo `db`/`bus`.

**Scelta di disegno** (da confermare a voce prima di scrivere, non una domanda a risposta
multipla): **non** dare un trigger proprio a `FunctionDef` — duplicherebbe la macchina di
scheduling già in `ScriptTrigger`. Invece, un nuovo binding sandbox `functions.run(name, **kwargs)`
che uno script globale può chiamare per eseguire una funzione **in-process**: chi vuole una
funzione a orario scrive uno script globale di una riga che la richiama sul trigger che vuole.

- Nuovo `#[pyclass] struct FunctionsApi { registry: FunctionsRegistry, engine: Engine, handle: Handle }`,
  stesso schema sync→async di `TagApi::read/write` (`lib.rs:222-224`, `py.detach(|| self.handle.block_on(...))`).
  `run()` cerca il codice per nome nel registro (stesso lookup di `run_function`), poi lo esegue
  con `engine.execute_with_args(code, args, identity=&format!("fn:{name}"))` — stessa identità
  chiave della Fase A, così una funzione richiamata da più punti mantiene il proprio stato
  ritenuto/`delta_ms` a prescindere da chi la invoca.
- Plumbing: `GlobalScriptSupervisor::start` guadagna un parametro `functions: FunctionsRegistry`;
  i due call site che già tengono `&AppState` (`projects.rs:109`, `router.rs:6389`) passano
  `s.functions.clone()` — nessun nuovo stato da inventare, solo da far viaggiare.
- Bindaggio nel sandbox degli script globali: stesso trattamento (a)/(b)/(c) della Fase A per il
  nome `functions`.

**Bundle nello stesso ramo — Fase E** (piccola, stessa area): far trovare la documentazione del
passaggio parametri, che **funziona già** (`__sws_args__` iniettato come globals,
`RunBody`/`on_press_args`) ma non si scopre. Un paragrafo in `docs/HOWTO.md` con un esempio
concreto (funzione con `params[]` + come arrivano allo script), più una riga nel pannello
Funzioni dell'editor vicino all'editor dei parametri.

### Fase D — tipo di tag «generatore» nativo (branch nuovo, la più grande)

`TagDef` (`sws-core/src/project.rs:17-105`) è una struct piatta senza discriminante di "kind" —
`expression: Option<String>` ci sta esattamente come ci starebbe un nuovo
`generator: Option<GeneratorSpec>`, stesso trattamento di campo opzionale.

`GeneratorSpec { shape: String ("ramp"|"triangle"|"square"), period_ms: u64, min: f64, max: f64, enabled: bool (default true) }`
— **abilitazione come bool semplice per questa prima versione**, non un riferimento a un altro
tag: aggiungere quella dipendenza dinamica è complessità in più, fuori scope per ora, da
dichiarare esplicitamente nel commento del campo.

**Perché è un ramo a sé e il più grande**: il valore di un generatore è funzione **pura** del
tempo e del periodo (`fase = (now_ms % period_ms) / period_ms`, poi la forma d'onda) — non ha
bisogno di uno stato ricordato tra un giro e l'altro (proprietà migliore del contatore-tag fatto
a mano nel template demo, e corretto anche dopo un riavvio). Ma questo significa un **ciclo di
valutazione nuovo**, a tempo e non a evento: il loop dei tag derivati (`expression`) vive in
`sws-runtime/src/main.rs:706-762` e reagisce ai cambi di `TagDb` — architettura sbagliata per
qualcosa che deve ticchettare da solo. Serve un supervisor nuovo (stessa famiglia di
`GlobalScriptSupervisor`/il loop `Interval` in `global_scripts.rs:80-90`, ma senza Python:
un tick fisso — proporre 100ms indipendentemente dal periodo del generatore, per un'onda liscia
anche a periodi brevi — che ricalcola e scrive ogni tag con `generator.is_some()`).

Punti da chiudere in fase di implementazione (non ora): dove vive esattamente il nuovo
supervisor (modulo dedicato o accanto al loop dei derivati in `main.rs`), il mirror TS in
`sws-editor/src/types/index.ts`, la terza icona di attivazione nella riga dei tag di
`ConfigView.tsx` (stesso pattern delle due esistenti, λ per `expression` linea ~822-834 e ⚙ per i
campi F1 linea ~835-846), l'estensione di `is_derived()`/le guardie di scrittura
(`validate.rs:905`) a un analogo `is_generated()` (un tag generato non deve essere scrivibile,
stessa logica dei tag calcolati), e l'aggiornamento dello schema IA.

### Sequenza e verifica di ognuna

Per ogni fase: rilettura rapida del disegno con il maintainer prima di scrivere codice (può
essere emerso qualcosa nella fase precedente che lo cambia — vedi il quasi-incidente di ieri sul
`min_role`), poi il ciclo pieno di `CLAUDE.md` — branch, implementa, `cargo check`/`test`/
`clippy`/`fmt` + `pnpm build`/`test` + **`./scripts/check_static.sh`** (nella definition of done
dal 14-09) + conferma esplicita del maintainer, squash-merge, verifica `main^{tree}` ==
`<ramo>^{tree}`, `git branch -D`, `STATUS.md`, `CHANGELOG.md`. Push solo su richiesta esplicita.

## File coinvolti, per fase

- **A**: `sws-runtime/crates/sws-pyscript/src/lib.rs` (unico file di sostanza), più i suoi test.
- **B**: `sws-core/src/project.rs`, `sws-web/src/global_scripts.rs`, `sws-web/src/validate.rs`,
  `sws-web/src/ai/tools.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/config/ConfigView.tsx`.
- **C** (+ E): `sws-pyscript/src/lib.rs` (nuovo `FunctionsApi`), `sws-web/src/global_scripts.rs`,
  `sws-web/src/projects.rs:109`, `sws-web/src/router.rs:6389`, `docs/HOWTO.md`,
  `sws-editor/src/config/ConfigView.tsx` (pannello Funzioni).
- **D**: `sws-core/src/project.rs`, un modulo nuovo per il supervisor a tempo (nome da decidere),
  `sws-runtime/src/main.rs` (avvio/arresto insieme al resto dei servizi di progetto),
  `sws-web/src/validate.rs`, `sws-editor/src/types/index.ts`, `ConfigView.tsx`,
  `sws-web/src/ai/tools.rs`.

## Cosa NON fare in questa sessione

- Non dare a `FunctionDef` un trigger proprio (Fase C sceglie `functions.run()` da script invece).
- Non far dipendere l'abilitazione del generatore (Fase D) da un altro tag — bool semplice,
  dichiarato come semplificazione.
- Non aggiornare i template esistenti per usare le funzioni nuove (rampa nativa, `functions.run`,
  ecc.) — è lavoro del piano `docs/plans/2026-09-14-revisione-template.md`, non di questo.
- Se emerge una decisione architetturale non prevista qui: non deciderla, annotarla in
  `docs/OPEN_QUESTIONS.md` e proseguire con il default dichiarato.
