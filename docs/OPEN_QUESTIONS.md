# SWS — Open Architectural Questions

> Decisions that came up during development but are **not for Claude Code to settle in a vibecode session**. The maintainer reviews and decides these out-of-band.
>
> When Claude Code encounters one of these, it should: pick the documented PoC default, add a `// TODO(open-question):` comment in code referencing the question number here, and continue.

---

## Q1 — Python embedding strategy

**Context**: User scripts in projects must be sandboxed and executed by the runtime. `sws-pyscript` is the responsible crate.

**Options**:
- **A** — Embed CPython in the Rust binary via `pyo3`, run scripts in-process with RestrictedPython. Smaller footprint, shared memory with the runtime, but a script crash could affect the runtime.
- **B** — Run a separate Python worker process, communicate via gRPC or stdin/stdout. Stronger isolation, larger footprint, more moving parts.

**Default for PoC**: A (PyO3 + RestrictedPython).

**Decided**: A (PyO3 + RestrictedPython) is now fully live. `sws-pyscript::Engine`:
- runs scripts on `tokio::task::spawn_blocking` wrapped in `tokio::time::timeout`
  (5 s default, override via `SWS_SCRIPT_TIMEOUT_MS`);
- compiles user source through `RestrictedPython.compile_restricted` when the
  package is importable in the Python environment used by PyO3 — falls back to
  plain `compile` with a startup warning if `pip install RestrictedPython` was
  never run, so dev boxes don't break;
- redirects `sys.stdout` / `sys.stderr` per-call into `io.StringIO`, captures
  the strings, and returns them in `ExecOutput { stdout, stderr, sandboxed }`;
- `/api/script/exec` echoes these back; the editor logs them to the browser
  console (`[script stdout]` / `[script stderr]`).
- `Engine::execute_with_args(code, args)` injects per-call argument bindings
  into the Python globals (bool/int/float/str). Used by the new project-level
  function feature: `POST /api/script/run/:name` looks up a `FunctionDef`
  by name in `AppState.functions` and runs its `code` with the caller's
  argument overrides. Synoptic objects' `on_press_fn` / `on_release_fn`
  reference these functions instead of carrying inline code.

Still pending (Phase 2 polish):
- Pre-flight AST whitelist for the unsandboxed mode so it's at least
  "no imports, no exec/eval" even without RestrictedPython.
- Surfacing script output back into the editor UI (a panel, not just the
  console).
- Preemption of blocking C extensions: the `sys.settrace` approach (2026-05-16)
  covers pure-Python infinite loops. C-extension blocking calls (e.g., `time.sleep`)
  still require the Tokio-level backstop. A SIGALRM-based approach could cover
  those too, but it's per-process (not per-thread) and risks corrupting the GIL.
- `into_py` deprecation in PyO3 0.23 — migrate to `IntoPyObject` before 0.24.

---

## Q2 — Sparkplug B implementation

**Context**: No mature Rust Sparkplug B library exists. `sws-plugin-mqtt` will need encoding support.

**Options**:
- **A** — Contribute to `sparkplug-rs` upstream (community win, slower, depends on maintainer responsiveness).
- **B** — Fork or write our own, vendor it.
- **C** — Implement Sparkplug encoding manually using `prost` (Protobuf) on top of `rumqttc`. Sparkplug is just Protobuf-over-MQTT with conventions.

**Default for PoC**: pick C (manual Protobuf) for the simplest happy-path demo. Revisit if/when Sparkplug becomes a serious product feature.

**Decided**: **C (manual Protobuf with `prost`)**. Implemented in T-08 (`sws-plugin-mqtt`):
struct Protobuf scritte a mano, encode/decode NBIRTH/NDATA/DBIRTH/DDATA, SCADA Host STATE
birth/LWT, NCMD write-back. Nessuna dipendenza esterna oltre a `prost`.

---

## Q3 — Plugin ABI strategy

**Context**: Communication and storage plugins are loaded as `.so` files. Rust ABI is unstable across compiler versions.

**Options**:
- **A** — Manual stable C ABI: `extern "C"`, `#[repr(C)]`, vtable structs. Maximum portability, more boilerplate.
- **B** — Use `abi_stable` crate. Less boilerplate, but adds a dependency and locks plugins to the same `abi_stable` version.

**Default for PoC**: pick A (manual C ABI). `sws-plugin-api` bootstrap already sketches the C ABI surface (`SwsPluginManifest`, `TagValue`, `PluginKind`, `TagQuality`). Revisit if surface grows enough that boilerplate becomes painful.

**Decided**: **Compiled-in workspace crates (nessun dynamic loading nel PoC)**. Ogni
plugin è un crate del workspace (`sws-plugin-modbus`, `sws-plugin-opcua`, `sws-plugin-mqtt`,
`sws-plugin-ha`, `sws-plugin-s7`, `sws-plugin-enip`) compilato direttamente nel binario
`sws-runtime`. Il dynamic `.so` è stato deferito al product phase. `sws-plugin-api` esiste
solo come skeleton della futura ABI C — non definisce trait condivisi (verificato 2026-08-07,
vedi nota sotto).

**Nota (2026-08-07)**: verificato lo stato reale dello skeleton prima che qualcuno ci lavori
sopra. `sws-plugin-api/src/lib.rs` è 45 righe: solo quattro struct `#[repr(C)]`
(`SwsPluginManifest`, `PluginKind`, `TagQuality`, `TagValue`) più un commento di modulo con
`TODO: finalize ABI, write dlopen-based loader, add example plugin crate.` — nessun trait,
nessun loader. È dichiarato come path-dependency in tre `Cargo.toml` (`sws-plugin-modbus`,
`sws-plugin-opcua`, `sws-plugin-mqtt`) ma **mai importato** in nessuno dei tre (`grep -rn "use
sws_plugin_api"` → zero risultati nel workspace); `sws-plugin-modbus/src/lib.rs:2` lo conferma
esplicitamente: `// sws-plugin-api is deferred until third-party plugin support is needed.`
Promemoria per quando si affronterà il dynamic loading in product phase: decidere se
completare lo skeleton (loader dlopen + crate plugin di esempio) o rimuoverlo insieme alle
path-dependency Cargo oggi inutilizzate nei tre plugin.

**Nota (2026-08-21)**: deciso dal maintainer — **rimosso tutto** (crate + 3 path-dependency
morte). La storia git conserva lo sketch; il dynamic loading in product phase ripartirà dal
design giusto, non da uno sketch vecchio.

---

## Q4 — Frontend state management

**Context**: WebEditor needs shared state across components (current project, selected object, tag list, WSS connection state). Tracked also in `docs/adr/0001-state-management.md`.

**Options**: Zustand (small, ergonomic), Redux Toolkit (mature, heavy), Jotai (atomic, modern).

**Default for PoC**: Zustand. Simple, idiomatic with React, easy to swap if needed. Bootstrap installed it and `src/store/index.ts` uses it.

**Decided**: **Zustand** (confermato). In uso attraverso tutti i task T-01…T-21 senza
problemi. Lo store (`src/store/index.ts`) è cresciuto significativamente e rimane gestibile.
Migrazione a RTK deferita al product phase se necessario. ADR 0001 chiusa come "decided".

---

## Q5 — i18n scaffolding

**Context**: Final product wants multi-language support. PoC is English-only. The bootstrap already set up `i18next` + `react-i18next` because the design rounds asked for it.

**Status update**: contrary to the original "defer i18n to later" plan, i18n is **already wired** at bootstrap with English-only resources. This is fine — it costs little and avoids a retrofit later. The compromise: only English locale exists, no translation pipeline.

**Default for PoC**: keep current setup, English only. Add other languages only on demand.

**Decided**: implicitly accepted at bootstrap.

---

## Q6 — Symbol library packaging

**Context**: System symbol library (pumps, valves, motors) shipped with the runtime.

**Options**:
- **A** — Embedded in the runtime binary.
- **B** — Separate `sws-symbols/` folder shipped with the container, hot-reloadable.
- **C** — Separate repo, versioned independently.

**Default for PoC**: B (separate folder in container). Easy to update without rebuilding the binary.

**Decided**: **A (embedded nel binario)**, ma non nel modo descritto qui inizialmente — corretto
dopo averlo verificato nel sorgente invece di ricopiare la frase originale (Q15, seguito
all'analisi `symbol`→LVGL, 2026-08-08). Solo le **3 faceplate predefinite**
(`motor_basic`/`valve_basic`/`tank_level`) sono incluse via `include_str!()`, e sono in
`sws-web` (`router.rs`). I **simboli veri e propri non passano mai dal binario Rust**: vivono
interamente lato editor, in `sws-editor/src/symbols/library.tsx` — **16** disegnati a mano come
JSX/SVG inline (`kind: "builtin"`, davvero ricolorabili per stato — 17 era un errore di conteggio,
corretto il 2026-08-11 durante il porting LVGL, vedi Q14 seguito 14) più **12** file `.svg`
statici serviti da `sws-editor/public/symbols/` (`kind: "vendored"`, mai ricolorati — solo un
pallino di stato sovrapposto), per un totale di **28**, non 22. Il backend non ha alcuna
conoscenza semantica dei simboli: sul synottico persiste solo `symbol_id` (stringa opaca),
la risoluzione kind/path è un lookup lato editor. Un'eventuale cartella `sws-symbols/` separata
con symbol pack aggiuntivi resta un'opzione post-PoC.

---

## Q7 — LICENSE file content

**Context**: Bootstrap attempted to write the full AGPL-3.0 text to `LICENSE` but Anthropic's content filter blocked the output.

**Options**:
- **A** — Manually paste the full text from `https://www.gnu.org/licenses/agpl-3.0.txt`.
- **B** — Short LICENSE file with SPDX identifier + link, plus full text accessible from CI artifacts (some projects do this, though it's unusual for AGPL).
- **C** — Use a `LICENSE` symlink to `LICENSES/AGPL-3.0-only.txt` and put the actual text under the SPDX-recommended directory structure.

**Decided**: A. The maintainer added the full AGPL-3.0 text (661 lines, standard preamble + terms + tail) at `LICENSE` out of band; verified 2026-05-12.

---

## Q8 — Isolamento runtime ↔ IDE

**Context**: La spec long-term prevede **due container separati** (`sws-runtime` + `sws-editor`) che
condividono la cartella progetto. Il PoC li ha **collassati in un unico processo**: `router::build`
costruisce `runtime_app` (viewer 8443, `optional_auth`) e `admin_app` (IDE 8444, `require_auth`) dallo
**stesso `AppState`** (`state.clone()`), stesso processo e stesso runtime Tokio. L'isolamento è solo a
livello di **porta + auth**, non di processo. Conseguenza: operazioni IDE (config edit, `/api/script/exec`
ad-hoc, upload/delete progetto, `package.sh`, reload config) girano nello stesso spazio dell'acquisizione
dati live + HMI operatore; uno script fuori controllo o un panic di plugin può degradarla. Superficie
d'attacco ampia sul dispositivo di campo (peggio in no-auth).

**Options / roadmap** (dal quick-win al product-phase):
- **A — Modalità runtime "operator-only" (`--no-admin` / `--admin-port 0`)**: non bindare affatto
  `admin_app`; sul dispositivo gira solo il viewer + API minima. Riusa i due router già separati.
- **B — Gating endpoint pericolosi**: in operator-only (o sempre in no-auth) disabilitare
  `/api/script/exec`, project upload/delete/import, package build. Difesa in profondità.
- **C — Reload config granulare** (per-source, validate-before-apply) invece del riavvio di tutti i supervisor.
- **D — Audit log reale** (`sws-audit`, oggi stub): append-only + hash-chain SHA-256/HMAC, cablato su
  auth/tag-write/modifiche progetto/esecuzioni script.
- **E — (product) Split in due processi** (engine vs web-admin) come da spec.
- **F — (product) Python out-of-process** (Q1 opzione B): worker isolato via IPC.

**Default for PoC**: implementare **A + B** (massimo isolamento pratico con poco codice) e **D**
(chiude il gap compliance più vistoso). C/E/F deferiti al product phase.

**Decided**: A+B+D in lavorazione (2026-07-26). E/F = product phase. **C anticipata al PoC**
(2026-08-21, maintainer): reload config granulare per-sorgente con validate-before-apply,
invece del riavvio di tutti i supervisor a ogni salvataggio.

**Nota d'implementazione C (2026-08-21)**: il grosso esisteva già — `SourceSupervisor::reload`
fa il diff per-sorgente (riavvia solo config cambiate) da tempo. Aggiunti i pezzi mancanti:
validate-before-apply sul `PUT /api/project/sources` (id duplicati o vuoti → 400 chiaro PRIMA
di persistere; prima un id duplicato faceva sparire una sorgente in silenzio) e
`resolve_mqtt_client_ids` sul reload post-salvataggio (unico percorso che ne era privo: i
client MQTT si connettevano col client_id base fino alla riapertura del progetto).

**Nota correlata (2026-07-27)**: il gruppo `project_lifecycle` in `router.rs` è **pre-auth** per
necessità — la WelcomeScreen deve poter creare/aprire il primo progetto quando nessuna sessione
esiste. Con la scelta della cartella di destinazione quel gruppo espone anche `GET /api/fs/browse-dirs`
e `POST /api/fs/mkdir`: navigazione del filesystem del dispositivo e creazione cartelle **senza
autenticazione e senza whitelist di radici**. È coerente con la postura PoC/LAN-fidata e non aggiunge
una classe di capacità nuova (`POST /api/projects` con `parent_path` fa già `create_dir_all` su un
percorso arbitrario), ma **tutta questa superficie va chiusa quando il PoC diventa prodotto**: o
autenticando il gruppo dopo il primo bootstrap, o confinando `/api/fs/*` a un insieme di radici
consentite. Da affrontare insieme a E.

---

## Q9 — Le `PUT /api/project/*` accettano e scartano in silenzio i campi sconosciuti

**Context**: emerso il 2026-07-29 provando il layout del viewer. Ho mandato
`PUT /api/project/page-layout` con `width` e `height`: risposta `204 No Content`, campi scartati —
`PageLayoutConfig` non li ha, in modalità *fisso* le dimensioni vengono dal synoptic. Nessun errore,
nessun avviso: la chiamata sembra riuscita e non fa quello che chi la scrive crede. Vale per tutte le
`PUT` del progetto, perché serde per default ignora i campi extra. Lo stesso meccanismo ha un lato
utile — è quello che permette a un `project.yaml` scritto da un binario più nuovo di aprirsi su uno
più vecchio (vedi `deserialize_sources_tolerant`) — quindi non è ovvio che la risposta sia "rifiutare
sempre".

**Options**:
1. `#[serde(deny_unknown_fields)]` sui payload delle API di scrittura, tolleranza mantenuta solo
   nella deserializzazione del progetto da disco. Distingue i due casi: un client che sbaglia va
   corretto, un file scritto da una versione futura no.
2. Accettare ma **rispondere con la lista dei campi ignorati** (header o corpo), così la UI può
   segnalarlo senza rompere i client esistenti.
3. Lasciare com'è e documentare campo per campo. Costa zero ora e continua a costare ogni volta che
   qualcuno perde tempo su una chiamata "riuscita".

**Default for PoC**: opzione 3, non per scelta ma per inerzia — è lo stato attuale.

**Decided** (2026-08-21, maintainer): **opzione 1** — `deny_unknown_fields` sui payload delle
API di scrittura; la tolleranza resta solo nella deserializzazione del progetto da disco.

**Nota d'implementazione (2026-08-21)** — inventario completo di 49 endpoint di scrittura:
- **31 struct solo-API** ora hanno `deny_unknown_fields` (tutte le `*Body`/`*Request` di
  sws-web + `CreateUser`/`UserPatch`/`ChangePassword` di sws-auth); `git/commit` è passato da
  `serde_json::Value` a `GitCommitBody` tipizzata.
- **Il caso storico** (`PUT page-layout` con `width`/`height`) è chiuso con un **DTO dedicato**
  `PageLayoutBody` (+ test): l'attributo non può stare su `PageLayoutConfig`, che è anche la
  struct di `project.yaml`.
- **Esclusi di proposito**: le struct condivise col disco (`TagDef`, `SourceDef`, `AlarmDef`,
  `SynopticPage`/`SynopticObject`, ecc.) — l'attributo violerebbe la clausola "tolleranza su
  disco"; servirebbero DTO speculari dell'intero modello (169 campi solo per SynopticObject),
  duplicazione da product-phase, non da PoC. Esclusi anche i payload riusati IDE↔device
  cross-versione (`Credentials`, `ClientIdOverrideBody`) e quelli con client esterni non
  aggiornabili in lockstep (`WriteTagBody`: lvgl-viewer, script demo Python, esempi curl del
  manuale) — lì un device vecchio rifiuterebbe un campo aggiunto da un client nuovo.

---

## Q10 — Una sorgente non parsabile viene scartata in silenzio, e il salvataggio successivo la cancella

**Context**: emerso il 2026-07-29 scrivendo un fixture di test. `Project::load` usa
`deserialize_sources_tolerant`, che salta le sorgenti con `kind` sconosciuto **o con un campo
obbligatorio mancante** e prosegue con un warning nel log. La tolleranza è voluta e serve
(forward-compat: un progetto scritto da un binario più nuovo si apre su uno più vecchio). Il problema
è quello che viene dopo: il progetto in memoria non ha più quella sorgente, e la prima `PUT` che
riscrive `project.yaml` la **elimina dal disco**. Un errore di battitura in un campo, o l'apertura con
un binario più vecchio, e la sorgente sparisce senza che nessuno l'abbia chiesto — la stessa forma
della perdita di dati di `saveAll` corretta il 2026-07-28.

**Options**:
1. Conservare le voci non parsate come `serde_json::Value` opaco e riscriverle intatte al salvataggio.
   Costa un campo in più nel modello, ma nessuna sorgente viene mai perduta.
2. Rifiutare l'apertura del progetto se una sorgente non è parsabile. Onesto ma butta via la
   forward-compat, che è il motivo per cui la tolleranza esiste.
3. Aprire in sola lettura quando qualcosa è stato scartato, e chiedere conferma esplicita prima del
   primo salvataggio.

**Default for PoC**: comportamento attuale (opzione implicita: si scarta e si perde al salvataggio).

**Decided** (2026-08-21, maintainer): **opzione 1** — le voci non parsate si conservano come
`serde_json::Value` opaco e si riscrivono intatte al salvataggio; nessuna sorgente viene perduta.

**Nota d'implementazione (2026-08-21)**: la garanzia era già in gran parte nel codice —
`merge_preserved` in `router.rs` (nato dalle perdite di dati del 2026-07-28) rimette nel YAML
salvato le sorgenti non parsabili e le chiavi di primo livello sconosciute, ripescandole dal
testo grezzo su disco invece che da un campo opaco nel modello (stessa garanzia, zero campi in
più). Restavano DUE percorsi che la bypassavano, chiusi in Fase B: l'**import del bundle**
(il project.yaml dello ZIP passava dalla struct tipizzata e perdeva le voci sconosciute — ora
passa da `merge_preserved` col testo grezzo del bundle) e **`POST /api/project/migrate`**
(load+save diretto — ora delega a `patch_project` no-op, che preserva).

---

## Q11 — Estendere `BrandColors` con `secondary`/`accent`, o tenerli solo nell'artwork?

**Context**: emerso il 2026-08-01 applicando la palette KATODO al brand "sws" (arancio primario
`#DD5D21`, ma anche oro `#D9B200` e azzurro `#7EB5E1` nel brief originale, vedi
`docs/branding/BRAND_SWS.md`). Lo schema `BrandColors` in `sws-editor/src/branding/index.ts` ha oggi
10 campi e nessuno slot per un secondo o terzo colore di brand — solo `primary`/`primaryHover`/
`onPrimary` sono configurabili per-brand.

**Options**:
1. Aggiungere `secondary`/`accent` a `BrandColors` e ai relativi `CSS_VARS`, disponibili come
   `var(--brand-secondary)`/`var(--brand-accent)` per chi li vuole usare nella UI.
2. Lasciarli solo come colori dell'artwork del logo (SVG), senza diventare token CSS — nessuna UI
   dell'app li userebbe mai per scelta.
3. Aggiungerli solo quando un componente reale ne avrà bisogno (YAGNI) — per ora oro e azzurro
   restano descritti nel brief ma non nel codice.

**Default for PoC**: opzione 3 — nessuna estensione dello schema in questo giro.

**Decided** (2026-08-21, maintainer): **opzione 1** — aggiungere `secondary`/`accent` a
`BrandColors` e ai `CSS_VARS` (`var(--brand-secondary)`/`var(--brand-accent)`).

---

## Q12 — I neutri di `theme.ts` restano condivisi fra tutti i brand, o diventano override per-brand?

**Context**: emerso il 2026-08-01 nello stesso lavoro di Q11. `BrandColors` porta anche 7 campi
neutri (`bg/surface/surface2/border/text/text2/textMuted`), ma `theme.ts` li sovrascrive sempre dopo
`applyBranding()` con `DARK_NEUTRALS`/`LIGHT_NEUTRALS` **condivisi fra tutti i brand** (commento
esplicito nel codice: "il tema controlla i neutri... il branding controlla l'accento"). Impostare lo
sfondo "sws" al grafite `#2B2B2B` del brief non avrebbe quindi alcun effetto oggi — servirebbe
toccare i neutri condivisi, cambiando anche pixsys/acme/giorgino-giorgetti.

**Options**:
1. Tenere il design attuale: neutri condivisi, solo l'accento è per-brand. Più semplice, meno
   probabilità che un brand rompa il contrasto WCAG calcolato per gli altri.
   `theme.ts:readableOn()`.
2. Permettere a un brand di override opzionale dei neutri (fallback ai valori condivisi se assente),
   così "sws" può avere davvero uno sfondo grafite senza toccare gli altri brand.

**Default for PoC**: opzione 1 — nessun cambiamento, i campi neutri di `brand.json` restano di fatto
inerti (ereditati da `theme.ts`).

**Decided** (2026-08-21, maintainer): **opzione 2** — override opzionale dei neutri per-brand,
con fallback ai valori condivisi quando il brand non li definisce.

---

## Q13 — Come arrivano davvero gli sfondi di boot su un pannello Pixsys reale?

**Context**: emerso il 2026-08-01 preparando lo scaffold per gli export PNG del brief (6 risoluzioni,
`docs/branding/boot-backgrounds/`). Sono pensati per il boot splash **OS-level** del pannello Pixsys,
ma nessun meccanismo del genere esiste oggi in questo repo — verificato con grep su `docs/`,
`deploy/`, `scripts/`, `sws-editor/src/`: nessun riferimento a psplash o equivalente. Il kiosk SWS
(`sws-kiosk`) apre solo una URL fullscreen dopo che il sistema è già partito; non gestisce lo splash
di boot.

**Options**:
1. Consegna manuale al maintainer, che li carica con lo strumento di configurazione Pixsys — nessuna
   integrazione in questo repo, mai.
2. Se Yocto/Pixsys espone una recipe per il boot splash, documentarla in `docs/YOCTO_CROSSCOMPILE.md`
   e versionare gli asset finali lì invece che in `docs/branding/`.

**Default for PoC**: opzione 1 — richiede la conoscenza del maintainer sul tooling Pixsys reale, non
deducibile dal codice.

**Decided**: not yet — il maintainer ha scelto (2026-08-21) di **rimandare**: la domanda resta
aperta finché non avrà il pannello sotto mano per verificare il meccanismo reale.

---

## Q14 — Binding Rust↔LVGL e sequenza dei backend di output

**Context**: emerso il 2026-08-07 avviando il motore di rendering LVGL (`sws-lvgl-viewer`,
`docs/adr/0002-lvgl-rendering-engine.md`). Il crate ufficiale `lvgl` (`lvgl/lv_binding_rust` su
crates.io, v0.6.2) offre binding Rust *safe* ma risulta fermo a **LVGL 8.x**, mentre i driver
Linux moderni e ufficialmente mantenuti (DRM/KMS, Wayland, oltre a fbdev e al simulatore SDL2)
sono documentati sull'ecosistema **LVGL v9** (`lv_port_linux`). Non è chiaro se il binding v8
regga quando si arriverà davvero a Wayland/DRM su hardware reale (Fase 4 del piano), né se nel
frattempo emergano alternative più mature (es. binding community diversi, o bindgen custom
contro i sorgenti C di LVGL v9).

**Options**:
1. Restare sul crate ufficiale `lvgl` (v8.x) anche per i backend reali (fbdev/DRM/Wayland),
   accettando l'eventuale gap di feature/driver rispetto a v9.
2. Migrare a bindgen custom contro sorgenti C di LVGL v9 vendorizzati, seguendo `lv_port_linux`
   per i driver — più lavoro FFI, ma allineato ai driver Linux ufficiali oggi mantenuti.
3. Rivalutare da capo quando si arriva alla Fase 4 (framebuffer/DRM/Wayland reali), sulla base
   di come si sarà comportato il binding v8 nell'MVP su simulatore SDL2 (Fase 2).

**Default for PoC**: opzione 3 — si parte con il crate ufficiale `lvgl` (v8.x) per l'MVP,
rimandando la decisione vera a quando serve davvero un driver Wayland/DRM su device reale.

**Decided**: not yet — ma vedi l'aggiornamento sotto, che rende l'opzione 1 (restare su v8 anche
per i backend reali) più rischiosa del previsto e sposta il peso verso l'opzione 2.

---

**Aggiornamento 2026-08-07 (notte) — bug bloccante confermato in `Display::register()`**

Durante l'MVP (Fase 2, sessione notturna in autonomia) si è tentato di renderizzare un frame su
un buffer in memoria (niente SDL2: `libsdl2-dev` non installabile senza sudo su questo dev
server, bloccato da policy — vedi `.claude/settings.json` `deny: ["Bash(sudo *)"]` — e comunque
inutile su un server headless senza display). Il primo `lvgl::task_handler()` dopo la creazione
dei widget causa un **segfault sistematico e deterministico**, riprodotto:
- indipendentemente dal contenuto della pagina (crasha anche con zero widget, solo schermo);
- indipendentemente dalla risoluzione (crasha identico a 800×480 e a 240×240, la risoluzione
  esatta dell'esempio ufficiale `button_click.rs`);
- indipendentemente dal thread (stesso crash su thread dedicato con stack 64 MB e su main thread);
- indipendentemente dal timing (crasha anche chiamando `task_handler()` immediatamente dopo
  `Display::register()`, senza codice intermedio);
- indipendentemente dalla config LVGL (stesso crash con la config vendorizzata di default,
  `LV_MEM_SIZE` 48 KB, e con la config reale degli esempi ufficiali, `LV_MEM_SIZE` 1 MB).

**Root cause, confermata via `coredumpctl debug -A "-batch -ex bt -ex quit"` (backtrace GDB
completo)**: il crash è dentro `lv_color_fill()` (`lv_color.c:61`), chiamato con un puntatore
spazzatura (`buf=0xf7bef7bef7bef7be`) e un conteggio pixel assurdo (`px_num=4156487598`, ~4
miliardi). Risalendo lo stack: `Display::register()` (in `lvgl-0.6.2/src/display.rs:37-51`)
crea un `DisplayDriver<N>` **locale alla propria function body** (`let mut display_diver = ...`),
che possiede il buffer di draw (`_buffer: DrawBuffer<N>`, un array `[MaybeUninit<lv_color_t>; N]`
**inline**, non dietro un puntatore stabile). `DrawBuffer::get_ptr()` (righe 157-178) prende
l'indirizzo di quell'array e lo passa a `lv_disp_draw_buf_init()`, che LVGL C-side memorizza
dentro lo stato globale del display (`disp_drv.draw_buf`). Quando `Display::register()` ritorna,
`display_diver` — e con esso l'intero buffer — **viene distrutto** (fine dello scope): LVGL resta
con un puntatore pendente verso uno stack frame non più valido. Il codice stesso lo ammette:
`DrawBuffer::get_ptr()` ha un commento `// TODO: needs to be 'static somehow` seguito da una nota
sul motivo per cui non è banale risolverlo (`lv_disp_buf_t` contiene un puntatore raw, non può
stare dentro una `static`). **`Display::register_raw()` (l'API unsafe "di riserva") ha lo
stesso identico difetto** — chiama `DisplayDriver::new_raw()` ma tiene il risultato in una
variabile locale altrettanto effimera prima di passarla a `disp_drv_register()`. `DisplayDriver`
è inoltre `pub(crate)`: non è possibile, dall'esterno del crate, tenerne in vita un'istanza più a
lungo, né intervenire nella sua allocazione. L'esempio ufficiale `button_click.rs` "funziona"
solo perché chiama `task_handler()` nello stesso stack frame di `main()`, subito dopo
`Display::register()` — un caso fortunato di undefined behavior che non sopravvive a un solo
livello di indirection in più (nel nostro caso: `main → run → interpret_page`), non una garanzia
del design.

**Conclusione**: `lvgl` 0.6.2 non ha, ad oggi, **nessuna via pubblica sicura** per registrare un
display che sopravviva oltre la singola chiamata di `register()`/`register_raw()`. Non è un
errore nostro, non è una questione di config/risoluzione/thread — è un bug strutturale nel
crate. `sws-lvgl-viewer` (branch `feature/lvgl-2-render-engine`) si ferma quindi subito dopo la
creazione dei widget (verificata corretta e completa: 11/18 oggetti supportati creati con
successo su `examples/templates/demo-items` "Page 1", 7 correttamente segnalati come non ancora
supportati) e non tenta il redraw.

**Opzioni per sbloccare l'export immagine, valutate col maintainer il 2026-08-08**:
1. **Bypassare il modulo `Display` del crate** scrivendo un piccolo shim che chiama
   `lv_disp_drv_register` direttamente su storage `'static`, usando solo `lvgl-sys` (i bindgen
   raw, che non hanno questo problema — il bug è tutto nel layer Rust `Display`/`DrawBuffer`).
   **Scelta dal maintainer** — implementato come Rust puro (`Box::leak`, niente file `.c`
   separato: stesso identico effetto — storage a vita di programma anziché locale alla
   funzione — ottenuto con un meccanismo 100% safe di Rust, senza bisogno di un secondo
   linguaggio/toolchain). Vedi sotto per l'esito.
2. Vendorizzare/patchare `lvgl` con il fix minimo — scartata (il maintainer ha preferito il
   bypass, non fidarsi di un patch su codice che non conosciamo a fondo).
3. Cambiare binding (es. `rlvgl`) — scartata, maturità ignota.
4. Aprire una issue upstream e rimandare — scartata, si è proceduto subito.

**Aggiornamento 2026-08-08 — risolto, con un secondo bug scoperto e risolto nel processo**

Lo shim (`src/lvgl_display.rs`, nuovo modulo) funziona: `task_handler()` non crasha più, i
widget si vedono. Ma appena collegata una finestra SDL2 per la verifica visiva interattiva
(scelta del maintainer, `libsdl2-dev` installato appositamente sul dev server), è comparso un
**secondo bug, indipendente dal primo**: `lvgl-sys` 0.6.2 include una propria reimplementazione
di `strcmp`/`strncmp` in Rust (`src/string_impl.rs`, pensata per target senza libc), esportata
senza guardia (`#[no_mangle]`, incondizionata in `lib.rs`: `mod string_impl;`, nessun `#[cfg]`).
Su un binario `std` normale come questo, **questi simboli sostituiscono quelli della libc di
sistema per l'intero processo** — non solo per LVGL. La sua `strncmp` faceva
`slice::from_raw_parts(ptr, n)` **prima** di confrontare un solo byte, e `strcmp` la chiama con
`n = usize::MAX` — crasha per qualunque puntatore/lunghezza non banale. Confermato via
`coredumpctl debug -A "-batch -ex bt -ex quit"`: il crash avveniva dentro `sdl2::init()` →
`libSDL2.so` → `libdbus-1.so` (D-Bus, chiamato da SDL2 durante l'inizializzazione) →
`lvgl-sys::string_impl::strcmp` — cioè **SDL2, non LVGL**, chiamando la normale `strcmp` di
sistema, si è ritrovato quella difettosa iniettata da `lvgl-sys`. Non c'era una feature per
disattivare `string_impl` — nessuna via se non vendorizzare.

**Scelta del maintainer**: vendorizzare `lvgl-sys` 0.6.2 (~21 MB, `vendor/lvgl-sys-0.6.2/` nel
crate `sws-lvgl-viewer`, referenziato via `[patch.crates-io]` in `Cargo.toml`) con la sola
`strncmp` corretta — scansione byte-per-byte incrementale via puntatore raw (stesso stile già
usato correttamente da `strncpy`/`strnlen` nello stesso file), invece di materializzare uno
slice dell'intera lunghezza richiesta in anticipo. Patch isolata a una funzione, commentata nel
file con riferimento a questa voce.

**Risultato**: entrambi i fix confermati funzionanti end-to-end. Finestra SDL2 aperta,
screenshot catturati (`import` via X11 — nota: serve l'ID finestra specifico via `xwininfo`,
`-window root` fallisce sotto XWayland/Wayland) mostrando sfondo, rettangolo, testo, bottone,
LED e slider tutti renderizzati correttamente con colori/posizioni/stato corretti, dal vivo,
contro un runtime `sws-web` reale. `sws-lvgl-viewer` ora gira come loop interattivo (~60fps,
chiudibile con Esc o dalla finestra) invece che come comando one-shot senza output visivo.

**Decided**: **risolto** (entrambi i bug). La domanda originale di Q14 (binding v8 vs bindgen
custom su v9, rilevante quando si arriverà a Wayland/DRM reali — Fase 4) resta aperta, ma non è
più bloccante per lo sviluppo/la verifica del motore su desktop: **Default for PoC** aggiornato
a opzione 1 (crate ufficiale `lvgl` v8.x, ora con lo shim di registrazione display e
`lvgl-sys` patchato) — si rivaluta v9/bindgen custom solo se/quando i driver DRM/Wayland
ufficiali del binding v8 si rivelano insufficienti su hardware reale.

Nota collegata: questa voce copre anche la domanda "quando/se estrarre un crate `sws-engine`
puro da `sws-web`" per un ipotetico target LVGL headless che bypassi interamente il layer
HTTP/WS (Opzione B di ADR 0002) — oggi non giustificato, ma da tenere presente se emergono
requisiti di deployment realmente headless.

---

**Aggiornamento 2026-08-08 (seguito) — dai due limiti noti a motore interattivo con 9 widget**

Dopo la verifica del maintainer su `lvgl-01` (screenshot statico confermato corretto), erano
emersi due limiti: **(a)** bottoni/slider non rispondevano al click (nessun input device
registrato) e **(b)** i valori non si aggiornavano dal vivo (i widget venivano creati una sola
volta dallo snapshot iniziale, `/ws/tags` non veniva più consultato dopo l'avvio). Il maintainer
ha chiesto di proseguire in autonomia sui primi 4 punti di una roadmap proposta (live updates,
interattività, più widget, verifica backend Wayland), escludendo solo i container. Stato finale:

1. **Live updates (risolto il limite b)** — `client::spawn_tag_subscription` tiene la
   connessione `/ws/tags` aperta per tutta la durata della finestra (task `tokio::spawn` in
   background, stato condiviso `Arc<Mutex<TagSnapshot>>`), invece di chiuderla dopo lo snapshot
   iniziale. I widget tag-dipendenti (`LiveBinding`/`update_bindings` in `lvgl_render.rs`) non
   vengono più ricreati: i loro `Style` vengono mutati sul posto e "rinfrescati" con
   `lv_obj_refresh_style` — necessario perché LVGL cache lo stile calcolato per oggetto, mutare
   le proprietà di uno `Style` già assegnato non basta da solo (bug facile da non notare: il
   colore vecchio resta a schermo senza errori/warning).

2. **Più widget** — aggiunti `checkbox`, `progress_bar`, `radio`, `ellipse` (9 tipi supportati in
   totale). `progress_bar` riusa `Bar` come lo `slider` (entrambi passano da `init_bar_like`,
   `lv_bar_set_range`/`set_value` — LVGL non ha setter dedicati per lo slider, conferma dai
   binding reali). `checkbox`/`radio` condividono `Checkbox`: **LVGL non ha un widget radio
   nativo**, un radio SWS è disegnato come una checkbox quadrata (non tonda) — stessa
   approssimazione dichiarata nel brief originale ("non pixel-perfect ma accettabile").
   `ellipse` è un `lv_obj` figlio con `radius` al massimo (`LV_RADIUS_CIRCLE`) — cerchio perfetto
   se `width == height`, altrimenti una "pillola" stadium-shaped.

   **Bug scoperto durante la verifica (non una regressione di questa fase — preesistente fin dal
   widget LED originale, mai notato perché nessuno aveva controllato il colore pixel-per-pixel)**:
   `on_color`/`off_color` del LED, configurati nel synottico, venivano **silenziosamente
   ignorati** — il LED renderizzava sempre nel colore primario del tema (blu). Causa: `lv_led`
   (a differenza di quasi tutti gli altri widget LVGL) **non legge lo `Style` `bg_color`** per il
   proprio colore — tiene un campo interno `color` impostabile solo con `lv_led_set_color()`,
   inizializzato al colore primario del tema se mai chiamato (confermato nel sorgente C,
   `lv_led.c`: l'evento `LV_EVENT_DRAW_MAIN` mixa `led->color` con nero in base alla *luminosità*
   letta dallo `Style`, ma l'**hue** viene sempre da `led->color`, mai dallo `Style` stesso — un
   dettaglio dell'API facile da assumere sbagliato per analogia con gli altri widget). Fix:
   `render_led`/`update_bindings` chiamano `lv_led_set_color()` via FFI diretta invece di passare
   per lo `Style` — stesso principio delle altre chiamate dirette a `lvgl-sys` già presenti nel
   file per setter non esposti dal binding safe.

3. **Verifica backend Wayland nativo** — confermato che `sws-lvgl-viewer` gira su Wayland nativo
   (non XWayland): con `SDL_VIDEODRIVER=wayland`, `xwininfo -root -tree` non mostra la finestra
   nell'albero X11 (assenza = prova di Wayland nativo, non serve altro). Rilevante per la Fase 4
   (framebuffer/DRM/Wayland reali su device Pixsys) — SDL2 stesso sa già parlare Wayland diretto,
   non solo tramite compatibilità X11.

4. **Interattività (risolto il limite a)** — nuovo modulo `lvgl_indev.rs`: input device puntatore
   registrato con lo stesso pattern del display (`lvgl_display.rs` — `_lv_indev_drv_t` ha un
   `Default` zero-safe generato da bindgen, storage `'static` via `Box::leak`).
   `lv_indev_drv_register` si aggancia da solo al display di default (verificato nel sorgente C,
   non assunto), quindi va chiamato dopo `lvgl_display::init_display`. Il loop SDL2 traduce
   `MouseButtonDown`/`Up`/`Motion` in stato puntatore prima di ogni `task_handler()`. Bottone,
   checkbox/radio e slider registrano callback FFI (`lv_obj_add_event_cb` su
   `LV_EVENT_CLICKED`/`LV_EVENT_VALUE_CHANGED`, entrambi verificati nel sorgente C — non assunti
   dal nome) che accodano una `TagCommand` su un canale `mpsc` — **niente I/O di rete dentro la
   callback sincrona FFI**: il loop principale drena la coda dopo `task_handler()` e gira ogni
   scrittura a un task async sul runtime tokio del processo (`client::put_tag`,
   `PUT /api/tags/:id`, stesso endpoint del bottone web).

   **Scelta di design**: il bottone scrive `write_value` (default `true`) sul proprio tag al
   click — stessa identica semantica del bottone web (`SvgCanvas.tsx`:
   `onWriteTag(obj.tag, obj.write_value ?? true)`), non un contatore o altro comportamento
   inventato apposta per LVGL. Preferito per coerenza con un pattern già scritto e capito, non
   per mancanza di alternative — un sistema di azioni più ricco (script, azioni multiple) non
   esiste nemmeno lato web oggi, quindi non c'è nulla da "recuperare": se un giorno il bottone web
   guadagna un sistema di azioni più ricco, andrà valutato se/come portarlo anche qui.

   **Bug potenziale individuato e corretto in fase di progettazione (non durante testing — la
   presenza è stata dedotta *prima* di scriverlo, poi confermata efficace)**: `update_bindings`
   scrive incondizionatamente il valore letto dal tag su slider/progress_bar a ogni frame. Senza
   guardia, durante un drag questo avrebbe fatto "combattere" lo slider con l'utente per tutta la
   durata del gesto (il valore nel tag resta quello vecchio finché non arriva il round-trip
   scrittura+delta WS, tipicamente più lento di un frame). Fix: `update_bindings` salta
   l'aggiornamento tag-driven quando il widget è in stato `LV_STATE_PRESSED` (drag in corso) —
   no-op innocuo su `progress_bar`, che condivide il binding ma non entra mai in quello stato in
   uso normale (nessuna callback registrata lì).

   **Limite noto accettato, non risolto**: lo stesso tipo di "combattimento" è teoricamente
   possibile — ma per una finestra molto più breve, un solo click discreto invece di un drag
   sostenuto — su checkbox/radio: `update_bindings` potrebbe riscrivere per un frame o due lo
   stato appena cambiato dal click, prima che il delta WS di ritorno lo confermi. Non osservato
   nella verifica (round-trip locale troppo veloce per notarlo), ma non specificamente protetto
   come per lo slider — proporzione giudicata accettabile per un PoC (finestra di rischio
   piccola, autocorrettiva, nessun guard equivalente a buon mercato: `LV_STATE_PRESSED` si
   azzera già nello stesso evento che fa il toggle, prima che il round-trip parta).

   **Verificato end-to-end, non solo a compilazione**: click/drag sintetici via X11 XTest
   (`python-xlib`, ambiente headless senza mouse fisico) su bottone/checkbox/radio/slider —
   ognuno scrive correttamente il tag atteso sul backend (confermato via
   `GET /api/tags/:id`), il readout si aggiorna dal vivo sullo stesso schermo (screenshot
   prima/dopo), un widget non interattivo (LED) resta inerte al click. Nessun crash/warning/
   coredump durante l'intera sessione di test.

**Decided**: risolti entrambi i limiti (a) e (b). Motore LVGL ora supporta 9 tipi widget, tutti
con aggiornamento live, 4 dei quali interattivi (bottone/checkbox/radio/slider). Limite ancora
aperto e nel roadmap: nessun elemento del catalogo widget web attuale gestisce script/azioni
multiple sul click — se/quando servirà, la domanda "quale sistema di azioni" va posta di nuovo
qui, non decisa implicitamente estendendo `write_value`.

---

**Aggiornamento 2026-08-08 (seguito 2) — line e gauge, 11 tipi supportati**

Proseguendo verso la parità col catalogo web (nota lasciata nel template `lvgl-demo`: "prossimi
tipi... gauge, trend, table, alarm_viewer, symbol"), aggiunti `line` (`lv_line`) e `gauge`
(`lv_meter`) — entrambi scelti perché LVGL ha un widget nativo diretto, a differenza di
`trend`/`table`/`alarm_viewer`/`symbol` che richiederebbero disegno custom o composizione di più
widget (deliberatamente rimandati, non è un "prossimo passo" ovvio quanto questi due).

- **`line`**: dettaglio non ovvio scoperto leggendo il sorgente C (`lv_line.c`, ramo
  `LV_EVENT_DRAW_MAIN`) prima di scrivere il codice, non dopo un bug — i punti passati a
  `lv_line_set_points` sono **relativi alla posizione dell'oggetto stesso**
  (`point.x + area.x1`), non assoluti sullo schermo come praticamente tutto il resto di questo
  file. Assumerli assoluti per analogia con gli altri widget avrebbe piazzato la linea nel posto
  sbagliato. Stesso avvertimento di `lv_led_set_color`/Q14 sopra: le API LVGL non sono uniformi
  tra loro, ogni widget nuovo va verificato nel sorgente, non dedotto per analogia. L'array di
  punti deve restare vivo quanto il widget (dichiarato esplicitamente in `lv_line.h`) —
  `Box::leak`, stesso principio già in uso per il display/indev.
- **`gauge`**: scala 270° (`lv_meter_set_scale_range` con `rotation=135`, l'offset dalle ore 3 in
  senso orario — verificato in `lv_meter.h`) per lo stesso aspetto "varco in basso" del gauge
  web. Ago e arco seguono il tag dal vivo. **Semplificazione dichiarata**: l'arco non ricolora
  per soglia superata come nel web (`thresholdColor` a ogni frame) — `lv_meter` non espone un
  setter per il colore di un indicatore già creato (solo per il suo valore), quindi il colore
  resta quello scelto alla creazione. Non un bug, un limite dell'API a monte accettato per non
  dover rimuovere/ricreare l'indicatore a ogni cambio soglia.

Template `lvgl-demo` esteso con entrambi (25 oggetti totali): il gauge riusa `lvgl_demo.value`,
lo stesso tag di slider/progress_bar/testo formattato — trascinare lo slider muove in tempo
reale anche ago/arco/valore del gauge, verificato con drag sintetico via X11 XTest (screenshot
prima/dopo). Nessun nuovo bug scoperto in questa fase.

---

**Aggiornamento 2026-08-08 (seguito 3) — state_lamp e table, 13 tipi supportati**

Il maintainer ha detto solo "vai avanti" dopo il resoconto di line/gauge (che segnalava
esplicitamente trend/table/alarm_viewer/symbol/state_lamp come più impegnativi) — letto come
autorizzazione a proseguire su quel fronte, non su tutti e cinque insieme: aggiunti solo
`state_lamp` e `table`, che hanno un widget LVGL diretto o quasi-diretto; `trend`/`alarm_viewer`
(nuovi client per storico/allarmi, non solo tag) e `symbol` (SVG→LVGL, una vera domanda
architetturale) restano deliberatamente non tentati.

- **`state_lamp`**: stesso modello dati di `text_list` (`value`→`label`→`color`, con match per
  range o uguaglianza — `match_text_list_entry`, portato da `matchTextListEntry()` di
  `SvgCanvas.tsx`). Il cerchio è un `lv_obj` normale con `radius` massimo — **non** `lv_led` —
  quindi legge `bg_color` dallo `Style` senza le sorprese già documentate sopra per il LED: è
  proprio `lv_led` l'eccezione nell'API LVGL, non il comportamento di default.
- **`table`**: righe statiche da `table_rows` (non un datagrid dinamico, stessa scelta della
  versione web — niente sort/pagine). `lv_table` ha un binding safe più completo del solito
  (`Table::create`/`set_cell_value`/`set_row_cnt`/`set_col_cnt` già esposti, solo
  `set_col_width`/`add_cell_ctrl` via `lvgl-sys` diretto). **Percorso non banale per arrivarci**,
  utile da registrare per il prossimo widget con celle/testo vincolato in spazio: `lv_table` va
  a capo dentro la cella se il testo non entra nella larghezza di colonna richiesta (non
  documentato esplicitamente nell'header, scoperto per tentativi con "VALORE"/"Toggle" prima di
  leggere `lv_table.c`); `LV_TABLE_CELL_CTRL_TEXT_CROP` fissa l'altezza riga a una singola riga
  ma **da solo non impedisce l'andare a capo del testo** dentro quello spazio fisso — verificato
  con screenshot (colonna da 45px, "OK"/"UNC" spezzati una lettera per riga anche con crop
  attivo), non assunto dal nome della flag. La combinazione che funziona: crop + contenuto
  garantito corto (colonna qualità a una lettera — "G"/"B"/"U" — invece di un'abbreviazione a
  2-3 lettere). Verificato anche che `lv_table_set_cell_value` preserva il control-byte della
  cella tra una scrittura e l'altra (letto nel sorgente C prima di assumerlo, dato che
  `update_table_data_cells` lo richiama a ogni frame) — se non lo preservasse, il crop
  sparirebbe al primo aggiornamento live.

Template `lvgl-demo` esteso con entrambi (28 oggetti totali), riusando tag già esistenti — nessun
tag nuovo: `table_rows` legge `lvgl_demo.led_on`/`toggle`/`value`, `state_lamp` legge
`lvgl_demo.led_on` (stesso tag del LED). Verificato dal vivo scrivendo `lvgl_demo.led_on` via
REST: LED, state_lamp e la riga tabella corrispondente si aggiornano insieme, ognuno con una
resa completamente diversa dello stesso valore — buona controprova che l'architettura
tag→widget regge con implementazioni eterogenee, non solo con lo stesso tipo di widget ripetuto.

---

**Aggiornamento 2026-08-08 (seguito 4) — multi-pagina, risoluzione 1280x800, e un crash serio
trovato e risolto durante la verifica**

Richiesta del maintainer: adattare il demo a uno schermo 1280×800 (da provare anche su un
dispositivo reale, `tc620-a-p3-c6-07aff9.local`) e gestire più pagine. Due parti distinte:

**Risoluzione dinamica**: `HOR_RES`/`VER_RES` restano come default, ma la risoluzione vera è
quella della **prima pagina caricata in sessione** (`resolve_resolution`, legge `width`/`height`
dalla pagina). Il vincolo originale che li rendeva costanti a compile-time (commento su
`DrawBuffer<const N>`) non esisteva più da quando `lvgl_display.rs` registra il display a
runtime — semplicemente non era mai stato rivisto. Le pagine raggiunte per navigazione ereditano
la risoluzione della prima: un pannello fisico non cambia risoluzione a ogni cambio pagina.

**navbutton**: nuovo tipo, manda l'id della pagina di destinazione su un canale dedicato
(`nav_tx`, separato da `tag_tx` — stesso principio di canali separati per compiti diversi già
usato per le scritture tag). Scoperta non ovvia verificata prima di scrivere codice: `target_page`
punta all'**id interno** della pagina (`SvgCanvas.tsx`, lo store dell'editor — la navigazione web
è un lookup client-side in `pages.find(p => p.id === ...)`), **non** al nome file usato da
`GET /api/synoptics/:name` (`sws-web/src/router.rs`, `get_synoptic`: risolve per nome file via
`safe_filename`). I due valori spesso coincidono per abitudine ma non sono garantiti uguali.
`client::resolve_page_by_id` elenca le pagine del progetto (`GET /api/synoptics`, solo nomi file)
e le legge una per una finché non trova quella con l'id giusto, con fallback su nome file diretto
se nessuna corrisponde — O(n) pagine per ogni navigazione, accettabile per un progetto con poche
pagine, non scalerebbe a centinaia.

**Il crash**: la prima implementazione di "ricarica pagina" puliva lo schermo attivo
(`lv_obj_clean`) e ricreava i widget sopra. Funzionava al primo giro, ma la verifica dal vivo
(non solo compilazione — proprio la disciplina che ha già pagato più volte in questo filone) ha
trovato, su navigazioni ripetute con il catalogo widget completo: un **crash SIGSEGV**
riproducibile (backtrace GDB completo: `_lv_obj_style_apply_color_filter` su un puntatore non più
valido, dentro `draw_ticks_and_labels` — il ridisegno delle etichette numeriche di un
`gauge`/`lv_meter` — durante `_lv_disp_refr_timer`) e, separatamente, un **artefatto visivo**
(testo con un pattern a righe sopra, non solo un fotogramma sporco o in ritardo).

Bisezione sistematica per isolare il trigger, oltre 10 pagine di prova create ad-hoc:
- 2 gauge simultanei sulla stessa pagina (nessuna navigazione): stabile.
- Navigazione tra pagine senza gauge: stabile.
- Navigazione verso una pagina con un gauge nuovo (nessun gauge prima): stabile.
- Navigazione gauge→gauge con solo bottone di navigazione: stabile su più andate e ritorni.
- Stesso test con `state_lamp` aggiunto, poi anche `checkbox`: ancora stabile.
- Pagina 1 reale (29 oggetti) → pagina di prova minimale: stabile.
- Pagina 1 reale → pagina 2 reale (i file originali): **qui il crash tornava** — ma in modo
  **non deterministico all'interno della stessa sessione di test**, il che ha inizialmente
  fatto sembrare risolutivo un cambio nel frattempo (v. sotto) che invece non lo era da solo.

Questa non-determinismo — oltre alla natura stessa del sintomo (un puntatore che punta a
memoria plausibile ma con contenuto sbagliato, non un indirizzo assurdo come nel bug originale
di `Display::register()`, Q14 sopra) — è la firma tipica di una corruzione di memoria con
manifestazione ritardata, non di un bug deterministico isolabile a una singola riga letta a
mente fredda. Non è stato possibile isolare il meccanismo esatto con la stessa certezza degli
altri bug documentati in questa voce (lì un backtrace GDB indicava una riga precisa con una causa
leggibile nel sorgente C; qui il backtrace indica solo *dove* esplode, non *perché* la memoria
lì è già sbagliata).

Nel mezzo dell'indagine, disabilitato anche `LV_USE_MEM_MONITOR` (per tutt'altro motivo: puliva
un overlay "kB used" sempre visibile in basso a sinistra, ora che il demo è un multi-pagina
vero). Per una decina di test successivi il crash non si è più presentato, facendo sembrare
quello la causa — smentito poco dopo da un artefatto di corruzione testo osservato **con
`LV_USE_MEM_MONITOR` già spento**, poi da un crash "schermo bianco, processo vivo ma non
risponde ai click" con un `lv_obj_invalidate` esplicito aggiunto come tentativo (anch'esso non
risolutivo da solo).

**Soluzione**: invece di continuare a rincorrere sintomi su un pattern (`lv_obj_clean` + ricrea
sullo schermo attivo) mai confermato sicuro per un caso complesso come questo, sostituito con il
pattern **standard e testato di LVGL per il cambio schermo**: `lv_obj_create(NULL)` (schermo
nuovo, indipendente) → popolato con i widget della pagina → `lv_disp_load_scr` (la funzione
dietro la macro `lv_scr_load`, non esposta dal binding perché `static inline` nell'header C,
reimplementata a mano chiamando `lv_disp_load_scr` direttamente — verificato leggendo
`lv_disp.c`, non assunto) → `lv_obj_del` dello schermo precedente. Schermo vecchio e nuovo
restano alberi completamente separati fino allo scambio, invece di mutare in-place quello
attivo. Verificato stabile su 14+ navigazioni consecutive, incluse raffiche rapide (8 click in
successione, tutti registrati correttamente) — nessun crash, nessuna corruzione visiva,
interattività (click checkbox, drag slider) confermata funzionante su schermi appena caricati.

**Perché documentarlo comunque come aperto invece che "risolto" secco**: il meccanismo esatto
del bug originale non è stato isolato con certezza (a differenza degli altri tre bug in questa
voce, tutti tracciati a una riga di codice precisa con una spiegazione leggibile). È possibile
che il nuovo pattern eviti semplicemente la classe di problema senza che se ne capisca il motivo
esatto — accettabile per procedere (è il pattern che LVGL stesso raccomanda e usa nei propri
esempi), ma se dovesse ripresentarsi in una forma diversa altrove, vale la pena ricontrollare
questa voce prima di aprire un'indagine da zero.

**Decided**: multi-pagina implementata e verificata stabile con il pattern `lv_disp_load_scr`.
Non ancora provato su hardware reale (il maintainer lo farà su `tc620-a-p3-c6-07aff9.local`).

---

**Aggiornamento 2026-08-08 (seguito 5) — indicatore "L" nella palette + verifica compatibilità
nomi campo web↔LVGL**

Richiesta del maintainer: nella palette oggetti dell'editor, per un progetto "web", marcare con
un piccolo badge "L" (angolo in basso a destra dell'icona) i tipi che hanno anche una controparte
LVGL — l'inverso del filtro già esistente per i progetti LVGL (che invece nasconde del tutto i
tipi non supportati). E: verificare che lo YAML usi gli stessi nomi di oggetti/proprietà tra web
e LVGL, così un progetto che usa solo tipi con controparte LVGL sia convertibile tra i due target
senza dover riscrivere lo YAML — solo `project.yaml`'s `target.kind`.

**Badge implementato** (`LeftPanel.tsx`, `PaletteGroupAccordion`): badge assoluto sovrapposto
all'icona, mostrato quando `!isLvgl && LVGL_SUPPORTED_TYPES.has(type)` — cioè mai per progetti
LVGL (dove la palette è già filtrata, il badge sarebbe ridondante). Verificato con uno screenshot
reale in un browser vero (Playwright headless — Chromium coi flag GUI classici non apriva una
finestra visibile in questo ambiente, causa confinamento snap; ha bloccato anche la scrittura
dello screenshot fuori da `$HOME`, aggirato scrivendo lì e poi copiando), non solo letto il
codice: sulla palette "web" `Rettangolo/Ellisse/Linea/Testo/Bottone/Nav pagina/Checkbox/Radio/
Slider/Gauge/LED/...` mostrano il badge, `Immagine/Setpoint/Lingua ▾/Lingua btn/...` no —
esattamente l'insieme atteso. Sulla palette di un progetto LVGL, confermato nessun badge e
filtro invariato (nessuna regressione).

**Verifica compatibilità nomi**: confronto sistematico campo per campo tra
`sws-web/src/synoptic.rs` (`SynopticObject`, ~150 campi, schema autoritativo) e
`sws-lvgl-viewer/src/model.rs` per tutti i 14 tipi oggi supportati da LVGL. **Ogni campo che il
motore LVGL legge esiste con lo stesso nome nello schema web** (`tag`, `fill`, `x`/`y`,
`width`/`height`, `label`, `write_value`, `on_value`/`on_color`/`off_color`,
`min`/`max`/`unit`, `x2`/`y2`/`stroke_width`, `warn_low`/`warn_high`/`alarm_low`/`alarm_high`,
`text_list_entries`/`text_list_default`/`text_list_default_color`, `table_rows`,
`target_page`), incluse le sotto-strutture (`TextListEntry`/`TableRow` in Rust ricalcano
esattamente le interfacce TS omonime). Un file YAML per uno di questi tipi è quindi
sintatticamente portabile tra i due target: cambiare `target.kind` non fa perdere né rinominare
nessun campo — non era mai stato verificato sistematicamente prima d'ora, solo tenuto allineato
per costruzione via ADR 0002 ("duplicazione accettata").

**Ma non è portabilità comportamentale completa** — differenza importante da non nascondere:
alcuni campi esistono su entrambi i lati ma LVGL non li **onora** ancora, quindi un progetto che
li usa avrebbe un comportamento diverso spostandosi da web a LVGL, anche restando nei 14 tipi
"con controparte":
- ~~`checkbox`/`radio`: `checked_value`/`unchecked_value` ignorati (solo booleano puro)~~ —
  **risolto**, vedi aggiornamento "seguito 6" sotto.
- `button`/`navbutton`: script `on_press_fn`/`on_release_fn` non sono supportati da LVGL (solo
  `write_value` sul click) — già annotato nell'aggiornamento precedente di questa voce.
- ~~`line`: `stroke_dasharray` non supportato~~ — **non era un gap reale**, vedi correzione
  nell'aggiornamento "seguito 6" sotto: il campo appartiene a `pipe`, non a `line`.
- `gauge`: l'arco non ricolora per soglia superata dal vivo come nel web — già annotato sopra.
- `pipe`: tipo intero non supportato da LVGL (routing/gradient/fill-level/marker) — non è nella
  lista `SUPPORTED_TYPES`, già implicito prima d'ora ma reso esplicito qui perché è lui, non
  `line`, a usare `stroke_dasharray`.

Nessuno di questi è un problema di **nomi** (motivo per cui la verifica richiesta è comunque
soddisfatta) — sono limiti dell'implementazione LVGL di quel tipo, già in gran parte documentati
sopra in questa voce caso per caso.

**Decided**: nomi campo verificati compatibili per costruzione. Badge implementato e verificato
in browser. `checked_value`/`unchecked_value` chiuso. Gap restanti (`on_press_fn`, arco soglia,
`pipe` intero) non richiesti esplicitamente, restano aperti finché non emerge un progetto reale
che li usa.

**Aggiornamento 2026-08-08 (seguito 6) — `checked_value`/`unchecked_value` chiuso, e una
correzione sul gap `line`**

`checkbox`/`radio` ora onorano `checked_value`/`unchecked_value` invece di un booleano fisso:
`model.rs` (`SynopticObject`) ha due nuovi campi `Option<serde_json::Value>`; il confronto
"checked" (`checkbox_is_checked` in `lvgl_render.rs`) usa uguaglianza per stringa contro
`checked_value` (default `true`, come `SvgCanvas.tsx`: `String(tv.value) === String(checkedVal)`),
non `tag_value_as_bool` — sia alla creazione sia a ogni frame in `update_bindings` (il tag può
cambiare da un'altra sorgente, non solo dal click). Il click (`sws_checkbox_toggled_cb`) ora legge
lo stato CHECKED nativo di LVGL (già aggiornato da LVGL stesso prima dell'evento, come annotato
sopra) e scrive `checked_value` o `unchecked_value` — precalcolati in `TagValue` alla creazione
del widget (`CheckboxToggleCtx`, nuovo contesto FFI, stesso principio di `ButtonClickCtx` per il
bottone) via `serde_json::from_value::<TagValue>`, non un `TagValue::Bool` inventato. `radio`
eredita il comportamento gratis (`render_radio` delega a `render_checkbox`). Verificato end-to-end
sull'istanza isolata `.run-12`: aggiunto un terzo widget al template demo (`cb3` in "LVGL Demo
Pagina 2", tag `lvgl_demo.mode` nuovo, `checked_value: "ON"` / `unchecked_value: "OFF"`, stringa
non booleano) — click sintetico via XTest ha scritto `"ON"`/`"OFF"` esatti sul tag (confermato via
`GET /api/tags/lvgl_demo.mode`), non `true`/`false`; il checkbox preesistente `cb2` (nessun
`checked_value` impostato, quindi default booleano) continua a scrivere `true`/`false` come prima
— nessuna regressione sul caso comune.

**Correzione**: il gap "`line`: `stroke_dasharray` non supportato" annotato in "seguito 5" era
sbagliato — verificato rileggendo `SvgCanvas.tsx` riga per riga invece di fidarsi della nota
precedente. Il blocco che renderizza `obj.type === "line"` (riga ~2293) non legge mai
`obj.stroke_dasharray`: usa solo `stroke`/`stroke_width`, sempre un tratto pieno. L'unico punto
del file che legge `obj.stroke_dasharray` è il blocco `pipe` (riga ~2366,
`pipeStyle === "wire" ? (obj.stroke_dasharray ?? "6,3") : ...`), confermato anche dal commento
JSDoc in `types/index.ts` riga 361 ("SVG stroke-dasharray value applied to **the pipe body**") —
il campo è documentato come specifico di `pipe` fin dalla sua definizione, non generico. La linea
LVGL (sempre piena) è quindi **già** comportamentalmente equivalente alla linea web — non c'era
nulla da chiudere. Il gap vero è che `pipe` (un tipo composito con routing/gradient/fill-level/
marker, complessità paragonabile a `trend`/`alarm_viewer`) non è affatto implementato in LVGL —
fatto già vero prima (assente da `SUPPORTED_TYPES`) ma non reso esplicito come "il tipo a cui
appartiene `stroke_dasharray`". Non aggiunto alla lista dei 5 passi in corso: nessuna richiesta
esplicita del maintainer per `pipe`, e la sua complessità meriterebbe una propria valutazione di
fattibilità separata, non un'aggiunta rapida per analogia col nome del campo.

**Decided**: `checked_value`/`unchecked_value` risolto e verificato. Il gap `line`/dasharray
rimosso perché non reale; `pipe` intero resta esplicitamente fuori scope, non deciso quando
affrontarlo.

**Aggiornamento 2026-08-08 (seguito 7) — `trend`, 15 tipi supportati**

Terzo dei "prossimi 5 step": `trend` implementato su `lv_chart`, non semplice come i tipi
precedenti — a differenza di tutti gli altri widget, non basta leggere `/ws/tags` (quello è
sempre e solo il valore *corrente*): serve interrogare periodicamente lo storico
(`GET /api/history/:tag`, lo stesso endpoint REST già usato da `TrendCanvas.tsx`, disponibile
sulla porta viewer anonymous-readable — nessuna modifica al runtime, stesso principio di ADR
0002). Decisioni non ovvie, verificate leggendo il sorgente C prima di scrivere il codice:

- **`LV_CHART_TYPE_SCATTER`, non `LINE`**: in modalità `LINE` la X di un punto è solo il suo
  indice nell'array (spaziatura uniforme finta); `SCATTER` accetta una X esplicita per punto
  (`lv_chart_set_value_by_id2`), quindi il grafico riflette il vero istante di ogni campione
  invece di far sembrare uniformemente distribuiti campioni che potrebbero non esserlo (gap del
  tag, deadband dello storico). Costa solo una chiamata diversa, nessuna ragione per non farlo
  bene.
- **Coordinate X in secondi-dall'inizio-finestra, non Unix ms assoluti**: `lv_coord_t` è un
  `i16` (`LV_USE_LARGE_COORD` disattivato in `lv_conf.h`, verificato nei bindgen bindings —
  `pub type lv_coord_t = i16`), un Unix ms reale (13 cifre) ci trabocca enormemente. Da qui anche
  il clamp di `window_s` a `i16::MAX` secondi (~9h, ben oltre qualunque finestra trend sensata per
  un pannello).
- **`point_cnt` è una proprietà dell'intero `lv_chart_t`, non per-serie** (verificato in
  `lv_chart.c`): due tag con densità di campionamento diversa nella stessa finestra hanno numeri
  di campioni diversi, ma `lv_chart_set_point_count` ridimensiona gli array di **ogni** serie sul
  chart. Chiamarlo dentro un giro per-serie farebbe sì che l'ultima serie processata sovrascriva
  silenziosamente il conteggio delle precedenti. Soluzione: tenere l'ultimo `Vec<HistorySample>`
  visto per ciascuna serie (`TrendSeriesBinding::last_samples`), calcolare `point_count` come il
  massimo su tutte le serie, e riscriverle **tutte** insieme quando una qualunque cambia (non solo
  quella cambiata) — i punti mancanti di una serie più corta prendono `LV_CHART_POINT_NONE` invece
  di mostrare l'ultimo valore stantio in quegli slot.
- **Poller REST separato da `/ws/tags`, non riuso di `SharedTagSnapshot`**: lo storico non è un
  delta live, va interrogato a intervalli (`client::spawn_history_poller`, un task per serie,
  poll ogni 2s — stesso `pollMs` di default di `TrendCanvas.tsx`, incluso il backfill OPC-UA solo
  al primo giro, non a ogni poll). Il chart si aggiorna solo quando il poller produce una versione
  nuova (`SharedHistory = Arc<Mutex<(u64, Vec<HistorySample>)>>`, contatore di versione), non a
  ogni frame: un `lv_chart_refresh` a 60fps su dati che cambiano ogni 2s sprecherebbe redraw veri
  su un pannello embedded, non solo cicli CPU astratti — la stessa attenzione data al costo delle
  operazioni non vale solo per le chiamate FFI singole ma anche per la cadenza con cui si
  ripetono.

**Limite noto, accettato consapevolmente**: il poller non ha un modo per essere fermato — vive
quanto il task tokio lo lascia vivo, cioè quanto il processo. Se il maintainer naviga più volte
sulla stessa pagina con un trend, ogni visita apre nuovi task di polling e i vecchi non vengono
mai fermati (continuano a fare I/O di rete verso il runtime per sempre, non solo a occupare
memoria inerte come gli `Style`/i contesti `Box::leak` già accettati per lo stesso motivo altrove
in questo file). Accettabile per una sessione di test su un progetto demo con poche pagine; da
rivedere se/quando questo motore andrà oltre il PoC.

**Gap MVP dichiarati** (nomi compatibili, comportamento parziale — stesso principio delle voci
precedenti in questa domanda): di `trend_series_styles` solo `color` è onorato — `width`/`dash`/
`fill`/`fill_opacity`/`smooth` esistono nello schema web ma LVGL disegna sempre una linea sottile
piena, senza riempimento. Pan ◀/▶, drag-to-zoom e il modal "espandi" di `TrendCanvas.tsx` non
hanno equivalente: la finestra è sempre quella live (`now - window_s` → `now`), non naviga
indietro nel tempo.

**Verificato end-to-end** su `.run-12`: nuovo widget `tr1` sulla pagina 1 del template demo,
stesso tag dello slider `s1` (`lvgl_demo.value`) così trascinarlo anima anche il trend, finestra
30s, `y_min`/`y_max` assenti apposta per esercitare anche l'autofit. Scritti valori diretti via
`PUT /api/tags` con ritardi (simula un drag) e confermato via screenshot: punti plottati alla X
corretta (vicino al bordo destro appena scritti, verso sinistra man mano che invecchiano),
autofit Y che segue il range effettivo, sincronia con slider/gauge/progress_bar/text/table sullo
stesso tag, e — verifica non pianificata ma istruttiva — i punti sono correttamente scomparsi del
tutto quando, per il tempo reale trascorso tra un controllo e l'altro (~75s, molto più dei ~9s
stimati: i round-trip screenshot-e-analisi costano tempo reale non trascurabile), sono usciti
dalla finestra di 30s — comportamento corretto della finestra scorrevole, non un bug, ma un
promemoria a non fidarsi delle proprie stime di tempo trascorso quando si verifica dal vivo.
Multi-serie verificato separatamente (`extra_tags` con un secondo tag booleano, numero di
campioni volutamente diverso dalla prima serie, colori distinti da `trend_series_styles`): nessuna
corruzione tra le due serie, punti mancanti gestiti correttamente, colori rispettati — solo su una
copia isolata del progetto di test, non nel template spedito (un tag booleano come seconda serie
non è un buon esempio per la demo reale). Palette editor (`LeftPanel.tsx`) aggiornata: `trend`
mancava da `LVGL_SUPPORTED_TYPES` (badge "L" + filtro palette progetti LVGL), corretto nello
stesso giro.

**Decided**: `trend` implementato come MVP (dati corretti e in tempo, styling/navigazione
temporale parziali, dichiarati sopra). Restano dalla lista dei 5 passi: `alarm_viewer` (serve un
client allarmi, non solo storico tag) e `symbol` (domanda architetturale SVG→LVGL, non ancora
scritta come sua voce).

**Aggiornamento 2026-08-20 — gap nuovo, non un porting mancato: formattazione data/ora asse X**

Il lato web (`TrendCanvas.tsx`) ha guadagnato una configurazione completa per data/ora
sull'asse X e sul tooltip (ordine giorno/mese/anno, separatore, 12h/24h, secondi, anno, due
righe — vedi CHANGELOG). Il lato LVGL **non disegna alcuna etichetta testuale sull'asse X**
(coordinate numeriche pure, secondi-dall'inizio-finestra, per il vincolo `i16` di `lv_coord_t`
descritto sopra): non c'è nulla da parametrizzare, servirebbe costruire da zero un rendering di
testo sull'asse che oggi non esiste. Non tentato in questa sessione — resta un gap dichiarato,
non un'omissione silenziosa.

**Aggiornamento 2026-08-20 (seguito) — scale Y indipendenti per traccia, stesso gap confermato**

Fase 2 del piano Trend: il lato web ha guadagnato `trend_series_styles[].own_scale` — una
traccia con valori di ordine di grandezza molto diverso dalle altre (l'esempio concreto:
tensione ~230V insieme a potenza 0-12kW) ottiene una scala verticale indipendente, con la
propria colonna di etichette colorate a sinistra, invece di essere schiacciata contro l'asse
condiviso. Il lato LVGL usa un solo asse Y nativo (`lv_chart_set_range` su `AXIS_PRIMARY_Y`),
mai l'asse secondario di `lv_chart` — implementarlo lì richiederebbe o l'asse nativo secondario
(mai usato oggi, comportamento non verificato per multi-serie) o un disegno custom delle
etichette, in entrambi i casi lavoro nuovo non tentato in questa sessione.

**Aggiornamento 2026-08-08 (seguito 8) — `alarm_viewer`, 16 tipi supportati**

Quarto dei "prossimi 5 step": `alarm_viewer` (solo modalità `"list"`, il default web — `"banner"`
e `"table"` segnalati come non supportati invece di renderizzare qualcosa di diverso da quanto
configurato, stesso principio già usato per `alarm_viewer_mode` quanto per `trend`). A differenza
di `trend` (storico via polling REST), gli allarmi hanno già un canale push vero
(`/ws/alarms`, stessa porta viewer anonymous-readable di `/ws/tags`) — più semplice da consumare,
ma con un protocollo diverso scoperto leggendo `handle_alarms_ws` in `sws-web/src/router.rs`
prima di assumerlo uguale a `/ws/tags`: **ogni** messaggio, dal primo (lo snapshot iniziale)
all'ultimo, è un singolo `AlarmState` "nudo" senza involucro `{type: snapshot/delta}` — "upsert
per id" è già il trattamento corretto per ogni messaggio, quindi `client::spawn_alarm_subscription`
non blocca in attesa di nulla di speciale (a differenza di `spawn_tag_subscription`), semplicemente
comincia ad aggiornare `SharedAlarms` dal primo messaggio che arriva.

Righe a slot fisso (`alarm_viewer_max_rows`, default 5): create una volta, il contenuto di
ciascuna riassegnato a ogni frame in base a quali allarmi sono attivi in quel momento (stesso
principio delle celle di `table`) — non un widget ricreato per ogni allarme. Filtro (solo attivi,
`alarm_viewer_id_prefix`/`alarm_viewer_severities` opzionali) e ordinamento (più recente prima,
tagliato a `max_rows`) portati 1:1 da `AlarmViewerWidget` in `SvgCanvas.tsx`. Pulsante ACK per
riga: **non** un contesto fisso `Box::leak`-ato una volta come tutti gli altri pulsanti di questo
motore (bottone, checkbox/radio, navbutton) — l'id allarme associato a uno slot riga cambia da un
frame all'altro (stesso motivo per cui le righe sono slot fissi, non widget ricreati), quindi il
contesto della callback (`AlarmAckCtx`) porta un `RefCell<String>` che `update_alarm_viewer`
riscrive ogni frame e la callback legge solo al momento del click — sicuro perché il motore è
single-thread (le callback LVGL sparano sincrone dentro `task_handler()`, mai in parallelo con
`update_bindings`). `POST /api/alarms/:id/ack` senza header `Authorization`: stesso principio già
osservato per `PUT /api/tags/:id` dai click checkbox/slider, non una nuova eccezione.

**Due bug di layout trovati e risolti durante la verifica dal vivo** (non a compilazione), entrambi
sintomi dello stesso problema di fondo — aver assunto che le coordinate assolute dei figli
partissero da (0,0) del contenitore:
1. Il pulsante ACK, posizionato assumendo tutta la `width` dichiarata disponibile a partire da
   x=0, risultava tagliato dal bordo destro del contenitore — il tema di default applica un
   padding interno non nullo ai container che non avevo considerato. Risolto azzerando
   esplicitamente `pad_left`/`pad_right`/`pad_top`/`pad_bottom` sul contenitore stesso (uno `Style`
   dedicato), invece di indovinare il valore del padding del tema per compensarlo nella matematica
   di posizionamento.
2. Etichette/pulsante di riga incollati al bordo superiore della propria banda invece che centrati
   verticalmente (il pallino colorato lo era già, dalla prima versione — l'incoerenza è saltata
   all'occhio proprio nello screenshot di verifica): risolto centrando ogni elemento nella propria
   `row_h` in base alla propria altezza dichiarata, non solo il pallino.
Nessuno dei due impediva la funzionalità (i dati erano già corretti, i click funzionavano) — pura
verifica visiva, non individuabile da `cargo check` né da un test che avesse controllato solo lo
stato REST.

**Verificato end-to-end** su `.run-12`: due allarmi demo aggiunti a `project.yaml`
(`lvgl_demo.value_warning` sopra 70, `lvgl_demo.value_critical` sopra 90, entrambi su
`lvgl_demo.value` — stesso tag di slider/gauge/trend, per una storia dimostrativa coerente:
trascinare lo slider oltre soglia fa comparire un allarme vero). Scritto il tag oltre 70 via
`PUT /api/tags`: l'allarme è comparso nella finestra LVGL (via `/ws/alarms`, nessun riavvio del
processo) con pallino giallo, età relativa, messaggio troncato con "…", pulsante ACK. Click
sintetico XTest sul pulsante → confermato via `GET /api/alarms` che `acknowledged` è diventato
`true` e il pulsante è sparito dalla riga (mentre l'allarme restava visibile, ancora attivo — non
confuso con "chiuso"). Scritto poi oltre 90: comparso un secondo allarme con pallino rosso, **sopra**
il primo (più recente, ordinamento per `activated_at_ms` decrescente confermato) e col proprio
pulsante ACK indipendente (non ancora cliccato) mentre il primo restava senza pulsante (già acked
in precedenza) — la riassegnazione delle righe a ogni frame in base allo stato attuale funziona
senza confondere gli slot. Palette editor aggiornata (`alarm_viewer` mancava da
`LVGL_SUPPORTED_TYPES`).

**Gap MVP dichiarati**: modalità `"banner"`/`"table"` non renderizzate (segnalate come non
supportate). Niente scroll per righe oltre `max_rows` (stesso `slice()` del web, ma senza un
contenitore scrollabile in questo giro). Nessun controllo di ruolo sull'ACK (`canAck` lato web
controlla `authRole`): questo client non ha mai avuto un concetto di sessione — stessa scelta già
fatta implicitamente per tutte le altre scritture (tag via checkbox/slider), non una nuova
eccezione per gli allarmi. Timestamp relativo ("Ns fa"/"Nm fa") invece di ora assoluta
(`toLocaleTimeString`): niente fuso orario affidabile senza una dipendenza `chrono`/`time` in più
per un dettaglio cosmetico, e un'età relativa è arguibilmente più utile su un pannello embedded
comunque.

**Decided**: `alarm_viewer` implementato come MVP (solo modalità lista, gap dichiarati sopra).
Resta un solo punto dalla lista dei 5 passi: `symbol` (domanda architetturale SVG→LVGL, ancora da
scrivere come sua voce in questo documento).

**Aggiornamento 2026-08-09 (seguito 9) — deploy Pixsys reale: Fase 4 (framebuffer/DRM/Wayland)
iniziata, non chiusa**

Su richiesta esplicita del maintainer ("lo scopo iniziale era proprio di non usare browser nei
dispositivi dove non è disponibile... per motivi di risorse non posso nemmeno nasconderlo dentro
ad un viewer"), affrontata la Fase 4 già prevista dal piano originale di questo filone
(`docs/plans/2026-08-07-lvgl-engine.md`): sostituire Chromium-on-Weston con `sws-lvgl-viewer` sui
Pixsys reali, per liberare le risorse che il browser consuma oggi. Vincolo esplicito del
maintainer, centrale per come è stato affrontato: LVGL deve restare un **companion opzionale** di
`sws-runtime`, mai un fork — tutto ciò che esiste per la versione web (runtime, deploy Yocto,
container) deve continuare a funzionare esattamente come oggi (vedi memoria
`feedback_lvgl_deploy_unified`). Concretamente: `scripts/yocto/build.sh` guadagna un flag
`--with-lvgl` (default off, comportamento di default byte-per-byte invariato), un nuovo
`deploy/yocto/sws-lvgl-viewer.service` affianca `sws-kiosk.service` come companion opt-in non
auto-abilitato da `install.sh` (che resta intoccato), e `Containerfile.aarch64` copia l'intera
`bin/` invece del solo `sws-runtime` per nome, così la stessa immagine può contenere anche
`sws-lvgl-viewer` senza un `COPY` condizionale — dettagli completi in
`docs/DEPLOY_CONTAINER_AARCH64.md` §4.

**Verifica su hardware reale** (`tc620-a-p3-c6-07aff9.local`, TC620, Pixsys OS 2.0.2, kernel
6.12.19 PREEMPT_RT, aarch64) **parziale, non completa** — onestamente, non spacciata per riuscita:
- **Confermato di persona**: podman rootless su questo device può accedere al socket Wayland reale
  dell'host (`/run/user/1000/wayland-1`) da dentro un container, ma **solo** con `--userns=keep-id`
  — senza, "Permission denied" perché rootless podman rimappa gli UID in un namespace separato per
  default, indipendentemente dal fatto che `--user` dentro il container combaci numericamente con
  l'UID host. Il maintainer aveva segnalato che "il container può accedere a Wayland ma non
  ricordo come" — questo è il "come". Provato con l'immagine `sws-runtime` esistente (nessun
  binario LVGL coinvolto, solo la meccanica del socket), non distruttivo: container usa e getta
  (`--rm`), il container `sws-runtime` reale in esecuzione da 39 ore sul device non è stato toccato
  (verificato prima e dopo).
- **Non verificato**: il rendering LVGL vero. Produrre un `sws-lvgl-viewer` aarch64 richiede l'SDK
  Yocto Pixsys (`scripts/yocto/build.sh --with-lvgl`) — non installato né sulla macchina usata per
  questa sessione né sul device stesso (nessun toolchain di compilazione a bordo, solo runtime:
  niente `cargo`/`rustc`/`gcc`/`pkg-config`). Bloccante reale, non aggirato: serve una macchina con
  l'SDK installato per completare questo passo.
- **`WAYLAND_DISPLAY` non è `wayland-0`** su questo device (era `wayland-1`) — sia il nuovo
  `sws-lvgl-viewer.service` sia il preesistente `sws-kiosk.service` avevano quel valore hardcoded,
  mai verificato su hardware reale finché nessuno dei due cross-compila/gira lì. Da leggere
  `/run/user/1000/wayland-*` a runtime invece di assumere un nome fisso, prossima volta.
- **Numeri reali del device** (rilevanti per il "per motivi di risorse" del maintainer, mai
  documentati altrove prima d'ora): 1.9 GB RAM totale, ~200 MB liberi con Chromium+sws-runtime già
  in esecuzione; `/` (rootfs) al 100% pieno, `/data` (dove vive podman) con 8.3 GB liberi su 10 GB.
  Un budget stretto per un motore browser completo — sostanzia concretamente la motivazione
  originale, non solo in astratto.

**Decided**: pattern "companion opzionale" implementato e committato
(`feature/lvgl-pixsys-deploy`); accesso container-Wayland verificato su hardware reale con
`--userns=keep-id`. Rendering LVGL reale resta da verificare — richiede una cross-compilazione con
l'SDK Yocto, non eseguibile in questa sessione.

**Aggiornamento 2026-08-09 (seguito 10) — pivot al percorso container generico aarch64**

Richiesta esplicita del maintainer, subito dopo il seguito 9: preferire per ora il percorso
**generico aarch64** (nessun SDK/toolchain Pixsys, build sotto emulazione QEMU) invece di quello
SDK-tuned appena descritto — "il build per i prodotti pixsys per ora vorrei farlo come generic
arch64 senza usare il toolkit, preferisco che il container per ora sia generico e non legato ai
prodotti pixsys". Non cambia l'architettura del seguito 9 (companion opzionale, mai un fork):
cambia solo *quale* dei percorsi di build già esistenti nel repo viene esteso per primo con
`--with-lvgl`.

Esteso lo stesso pattern non-regressivo a `scripts/build_container_aarch64_generic.sh
--with-lvgl` (default off): builda `sws-lvgl-viewer` dentro il container builder QEMU-emulato
esistente, con un nuovo layer dedicato,
`deploy/container/Containerfile.aarch64-generic-lvgl.builder` (clang/libclang/libsdl2-dev,
separato dal builder condiviso così il percorso `sws-runtime`-only non si appesantisce per una
dipendenza che non usa).

**Bloccato al momento di eseguirlo, non solo di scriverlo**: questo percorso richiede root
(rootless podman + crun + emulazione QEMU non attraversa lo user namespace — verificato
2026-08-01 per il solo `sws-runtime`, stesso vincolo qui) e `sudo` è negato dalla policy dei
permessi di questo progetto. Diversamente dai blocchi sudo precedenti (sempre un prompt
interattivo negato dal maintainer), stavolta una probe non interattiva (`sudo -n true`) è stata
negata direttamente dal sistema di permessi — conferma che il blocco è a livello di policy, non
di conferma estemporanea. Il maintainer ha scelto di lanciare lui stesso
`sudo ./scripts/build_container_aarch64_generic.sh --with-lvgl --push` su questa macchina quando
conveniente, invece di concedere un'eccezione. Rischio aggiuntivo non ancora verificato in nessuna
direzione, segnalato onestamente in `docs/HOWTO.md`: bindgen/`libclang` (usato per compilare
`lvgl-sys`) sotto emulazione QEMU è un'incognita che il solo `sws-runtime` non incontra mai su
questo percorso.

`docs/HOWTO.md` cap. 1 aggiornato di conseguenza: percorso generico ora primario (Passo 0),
percorso SDK preservato come alternativa in un blocco ripiegabile, riferimenti immagine corretti
da `latest-arm64` a `latest-arm64-generic` (il tag nudo resta quello SDK-based,
`install-container.sh --pull` senza argomento sceglie quello per default — va sempre passato il
riferimento esplicito).

**Decided**: percorso generico preferito "per ora" (parole del maintainer) rispetto a quello
SDK-tuned. Non è una chiusura di Q14 — resta un'esecuzione mancante: il maintainer lancerà lui
stesso la build reale quando conveniente.

**Aggiornamento 2026-08-09 (seguito 11) — la build reale è riuscita, rischio bindgen/QEMU chiuso**

Il maintainer ha lanciato `sudo ./scripts/build_container_aarch64_generic.sh --with-lvgl --push`.
**Riuscita senza incidenti**: bindgen contro `libclang` (necessario per compilare `lvgl-sys`,
l'incognita segnalata nel seguito 10 e in `docs/HOWTO.md`) sotto emulazione QEMU si comporta come
il resto della toolchain Rust — nessun crash, nessun workaround necessario. Il timore era
ipotetico fin dall'inizio (mai riprodotto un problema concreto, solo segnalato come rischio non
escluso) e si è rivelato infondato.

Verificato di persona, non solo dal log "done" dello script:
- `sws-lvgl-viewer` prodotto (`crates/sws-lvgl-viewer/target-container-aarch64-generic/release/`)
  è un ELF aarch64 valido (`file` conferma "ARM aarch64", 18493080 byte), di proprietà `max_xxv`
  (il `trap restore_ownership` ha funzionato anche con questo target aggiuntivo).
- L'immagine pubblicata (`ghcr.io/soligolab/sws-runtime:2026.7.0-arm64-generic` e i tag gemelli
  `<sha>`/`latest`) contiene **davvero** entrambi i binari sotto `/usr/local/bin/` — non assunto
  dal `Containerfile`, ma ispezionato estraendo i layer dell'archivio `.tar.gz` salvato in locale
  (`dist/sws-runtime-2026.7.0-aarch64-generic-image.tar.gz`, 71 MB) e cercando il path in ciascun
  layer: trovato in due formati (`*.tar` e `*/layer.tar`, duplicazione attesa di `podman save` fra
  formato docker-archive e OCI, non un bug).

**Un bug proprio dello script scoperto e corretto da questo stesso run** (non del cross-compile):
`podman login --get-login`/`podman push`, girando anch'essi sotto `sudo` (necessario per la build
QEMU, vedi seguito precedente), interrogavano l'auth store di **root**, separato da quello
rootless di `$SUDO_USER` — un `podman login` fatto correttamente da utente normale prima di
lanciare lo script risultava invisibile ("nessun login su ghcr.io" nonostante un login valido).
Il maintainer non voleva ripetere il login come root (credenziali duplicate da gestire). Corretto
in `scripts/build_container_aarch64_generic.sh`: `podman login`/`push` ora puntano esplicitamente
all'`auth.json` di `$SUDO_USER` via `--authfile`, cercato negli stessi due percorsi che userebbe
podman di default (`/run/user/<uid>/containers/auth.json`, poi
`~/.config/containers/auth.json`) — nessun secondo login richiesto.

**Decided**: percorso generico aarch64 con `--with-lvgl` **funzionante end-to-end fino alla
pubblicazione dell'immagine**. Resta da verificare solo l'ultimo miglio, il rendering LVGL vero su
schermo — richiede il test su hardware reale (`tc620-a-p3-c6-07aff9.local`), non ancora ripetuto
con questo binario. Il percorso SDK Pixsys-tuned (Q14, corpo principale) resta comunque la scelta
giusta quando servirà davvero il tuning cortex-a35 — questo seguito non lo invalida, risolve solo
il piano B "per ora" preferito dal maintainer.

**Aggiornamento 2026-08-10 (seguito 12) — l'ultimo miglio: SIGSEGV Wayland, backend DRM diretto,
touch reale, primi fix visivi su schermo fisico**

*Consolidato in questa forma strutturata durante una sessione di lavoro autonomo successiva —
prima viveva solo sparso fra `STATUS.md` e i messaggi dei commit elencati sotto, mai scritto come
seguito di Q14. Nessun fatto nuovo, solo messo in un unico posto.*

Il test su hardware reale rimasto in sospeso dal seguito 11 ha aperto una catena di bug, tutti
**upstream (SDL2, driver kernel) o di ambiente (librerie mancanti), non nel codice di questo
progetto** — isolati uno alla volta con log diagnostici temporanei e strumenti esterni
(`coredumpctl`, `dmesg`, `modetest`), poi rimossi una volta capito il punto esatto:

1. **SIGSEGV su Wayland nativo** (`2175e39`, `e4c8d84`, `94fee67`, `d1f1901`): `sws-lvgl-viewer`
   crashava sempre (exit 139) dentro `SDL_CreateRenderer`, identico col renderer accelerato e
   forzato a software — root cause upstream, non nostra: SDL2 crea sempre una `wl_egl_window`+
   `EGLSurface` alla creazione finestra su Wayland "anche senza richiedere OpenGL"
   (`libsdl-org/SDL#4650`, `#5386`), e il container non aveva alcuna libreria EGL/GLES. Sostituire
   `Canvas`/`Renderer` con la `Surface` diretta di SDL2 (blit software puro) non bastava: stesso
   bug più a monte, confermato bisezionando anche le chiamate del blit. `SDL_VIDEODRIVER=x11` (via
   XWayland, che Weston 13 su questo device avvia on-demand) elimina il crash e lo sostituisce con
   un errore X11 pulito (decorazioni finestra del window manager, mai viste sotto Wayland nativo) —
   risolto aggiungendo `.borderless()` al builder finestra.
2. **Libreria EGL/GLES assente, poi dispatch loader assente** (`6597145`, `05fcc11`, `bbfe1ae`):
   installato Mesa software (`libegl-mesa0`/`libgles2`/`libgl1-mesa-dri`/`libwayland-egl1`) come
   ipotesi per il SIGSEGV — non richiede una GPU reale, coerente con l'assenza di driver
   Mali/Rockchip su questo container. Nel frattempo scoperto che il device ha già un percorso
   Pixsys nativo (`pixsys-launcher`/`pixsys-splash`, in conflitto sistemico con `weston.service`)
   che pilota lo schermo senza compositor, verosimilmente via DRM diretto — replicato con
   `SDL_VIDEODRIVER=kmsdrm` (mai provato finora): con Weston fermo, nessun SIGSEGV (i bug
   Wayland/X11 di SDL2 non toccano kmsdrm), primo errore reale "EGL not initialized" da `libgbm1`
   mancante, poi ancora da `libegl1` mancante (il dispatch loader generico, pacchetto separato da
   `libegl-mesa0` che è solo l'implementazione vendor — stessa separazione classica Debian/Ubuntu
   di `libgl1`/`libgl1-mesa-dri`).
3. **Schermo nero su kmsdrm nonostante nessun errore** (`0fefcd9`): verificato via
   `/sys/kernel/debug/dri/1/state` che il piano DRM attivo è allocato correttamente (formato XR24
   1280×800) — la pipeline KMS funziona, il contenuto scritto sembrava vuoto. Isolato con
   `modetest` (puro `libdrm`, nessun codice del progetto): il pattern di test si vede con l'API
   legacy (`drmModeSetCrtc`) ma **non** con quella atomica (`modetest -a`) — **bug del driver
   kernel Rockchip (`Tainted: OOT_MODULE`) sul percorso atomico**, non di questo progetto né di
   SDL2/LVGL. SDL2 e il driver `drm.c` già vendorizzato in `lvgl-sys` usano entrambi solo l'API
   atomica, quindi nessuno dei due poteva funzionare su questo hardware così com'è.
4. **Backend `--backend drm` — rendering diretto via API DRM legacy** (`ddc4739`): nuovo modulo
   `src/drm_display.rs`, alternativa a SDL2 (rimasto il default). Apre il device, trova
   connettore/CRTC, crea un dumb buffer XRGB8888 e lo aggancia con `drmModeSetCrtc` (API legacy,
   non quella atomica rotta sul kernel di questo device) — bindgen contro `libdrm-dev` invece di
   FFI scritta a mano o della crate wrapper `drm` (API cambiata più volte fra versioni). **Primo
   rendering LVGL visibile su schermo fisico in tutto questo filone di lavoro** (`b509b63`).
5. **Touch reale** (`b509b63`): nuovo modulo `src/touch_indev.rs`, legge evdev grezzo da un device
   già calibrato/filtrato da `tslib` (`ts-uinput.service`, già attivo sul device — niente bisogno
   di linkare `tslib` direttamente). Calibrazione dinamica via `EVIOCGABS` invece di costanti
   fisse. Nuovo flag `--touch-device` (vuoto = nessun input, solo rendering). Ripristinata anche la
   gestione tag/navigazione/allarmi in `run_drm`, persa nella prima stesura quando "nessun input"
   sembrava vero.
6. **Primi fix visivi trovati sul primo test vero su schermo fisico** (`8b2c911`, 2026-08-10): mai
   emersi prima perché mai visti su un display reale. `render_gauge`: `lv_meter` non forza una
   forma circolare da solo, segue fedelmente un box non quadrato — corretto forzando un quadrato
   (lato minore) centrato nel box originale. `render_slider`: `lv_slider` disegna la traccia grande
   quanto l'intero oggetto (nessun padding) — un box alto 44px dava una traccia "grassa"; risolto
   rendendo l'oggetto visivamente sottile (16px) ma con l'area di click estesa via
   `lv_obj_set_ext_click_area` fino a coprire l'intero box originale, tocco preciso quanto prima —
   importante ora che il touch è reale, non solo mouse SDL2.

**Decided**: il percorso container generico aarch64 con `--with-lvgl` e backend `--backend drm`
**funziona end-to-end su hardware Pixsys reale**, touch incluso — verificato di persona
(`tc620-a-p3-c6-07aff9.local`), non solo dedotto dai log. Nessuna delle correzioni sopra è
specifica al percorso SDK Pixsys-tuned: si applicano identiche a entrambi i Containerfile.

**Aggiornamento 2026-08-11 (seguito 13) — 21 tipi supportati: `text_list`, `bar_chart`,
`sparkline`, `alarm_banner`, `faceplate`**

Richiesta esplicita del maintainer, in autonomia su un nuovo branch (`feature/lvgl-widgets-3`):
"completare il porting dei widget da web a LVGL". Prima di scrivere codice, confronto sistematico
fra i 32 tipi del catalogo web (`sws-editor/src/types/index.ts`, `SynopticObjectType`) e i 16 già
supportati — 16 tipi mancanti, di cui **5 implementati in questo giro**, gli altri **11
deliberatamente rimandati** (dettagli sotto, non un elenco a caso).

- **`text_list`**: sottoinsieme di `state_lamp` già scritto (stessa `match_text_list_entry` contro
  `text_list_entries`) — solo l'etichetta, senza il cerchio colorato. Nessun campo nuovo nel
  modello, il più semplice dei cinque.
- **`bar_chart`**: una `lv_bar` per serie, colore dell'indicatore via `Style` su `Part::Indicator`
  (mai usato prima in questo file — verificato che l'enum `Part` del crate `lvgl` lo espone prima
  di usarlo). Solo l'orientamento `"vertical"` (il default web) è disegnato — `"horizontal"`
  segnalato come non supportato, stesso principio di `alarm_viewer_mode`. **Bug trovato e corretto
  durante la verifica visiva, non a compilazione**: `lv_bar.c` decide il riempimento orizzontale/
  verticale confrontando le dimensioni del widget stesso (`hor = barw >= barh`, verificato nel
  sorgente prima di scrivere il codice) — con poche serie e un box abbastanza largo,
  `slot_w * (1 - gap)` restava comunque più largo che alto, e le barre si riempivano da sinistra
  invece che dal basso nonostante l'orientamento `"vertical"` dichiarato (visto letteralmente sullo
  screenshot: due barre "a pillola" riempite orizzontalmente). Fix: `bar_w` è ora anche clampato a
  `< plot_h`, garantendo il riempimento verticale indipendentemente da quante serie/quanto gap
  sceglie il synottico, non solo nel caso comune.
- **`sparkline`**: stesso principio del `trend` (poller REST in background via
  `client::spawn_history_poller`, la storia non è un delta live), ma una sola serie, sempre autofit
  (il tipo non ha `y_min`/`y_max` nello schema) e senza griglia/assi
  (`lv_chart_set_div_line_count(0, 0)` + `Style` che azzera sfondo/bordo/padding del tema di
  default — il web non ne ha uno per questo widget). Verificato dal vivo scrivendo una sequenza di
  valori distinti su `lvgl_demo.value` con un secondo di ritardo fra uno e l'altro: il grafico
  mostra la spezzata corretta, non solo un punto fermo.
- **`alarm_banner`**: riquadro compatto per un solo allarme (il più recente fra quelli attivi),
  stesso `SharedAlarms`/filtro severità-prefix di `alarm_viewer` ma un solo slot invece di
  `max_rows` — niente ACK (il web non lo prevede neppure lì, è puramente informativo). Verificato
  dal vivo portando `lvgl_demo.value` sopra soglia: il riquadro passa da "Nessun allarme attivo" al
  messaggio/pallino colorato corretto.
- **`faceplate`**: **non bloccato dal vincolo che ferma `symbol`/Q15** — `FaceplateDef.objects` è
  `Vec<serde_json::Value>` di oggetti già ordinari, nessun SVG. Implementato esattamente come
  previsto in Q15 stessa ("ricorrendo nello stesso dispatcher già scritto per gli altri tipi"): il
  match `obj_type → render_*` del loop principale è stato estratto in `dispatch_render` (prima
  inline dentro `render_page_objects`), così `render_faceplate` può richiamarlo per ciascun figlio
  senza duplicare la logica. Nuovo `client::fetch_faceplate` (`GET /api/faceplates/:id`, stesso
  endpoint anonymous-readable già usato dall'editor, verificato anche nel gruppo di route viewer
  prima di assumerlo) recupera la definizione **in modo bloccante** (`rt_handle.block_on`) durante
  il rendering della pagina — non in background come i poller: la definizione serve prima di poter
  creare i widget dei figli, non è un dato che possa arrivare più tardi. Sostituzione `{param}` sui
  campi `tag`/`label`/`text` (sottoinsieme di quanto fa `substituteParams` in `SvgCanvas.tsx` — solo
  i campi che il modello di questo motore conosce), coordinate traslate all'origine dell'istanza.
  **Niente faceplate dentro faceplate** (un figlio di tipo `"faceplate"` viene scartato come
  qualunque tipo non supportato): evita ricorsione illimitata per un caso d'uso che né il web né
  questo motore hanno mai previsto, non una limitazione imposta per pigrizia. Verificato dal vivo
  con un'istanza di `motor_basic` (il faceplate built-in esistente): titolo/etichette/LED
  renderizzati nella posizione corretta. **Osservazione, non un bug di questo motore**: il campo
  "Speed:" mostra testo malformato — `motor_basic.yaml` usa `format: "%.0f rpm"` (sintassi printf),
  ma `format_value` di questo motore (come il resto dello schema web) si aspetta `"{value:.0f}
  rpm"` — un bug preesistente nel contenuto del faceplate built-in, non toccato in questo giro
  (fuori scope: contenuto condiviso con la versione web, non specifico di LVGL).

**21 tipi supportati in totale** (16 + questi 5). Palette editor (`LeftPanel.tsx`) aggiornata.
Template `lvgl-demo` esteso: `alarm_banner` su Pagina 1 (unico spazio libero reale rimasto dopo
aver riscoperto quanto spazio verticale occupa davvero `tb1`/tabella — un primo tentativo di
piazzare tutti e cinque su Pagina 1 si è sovrapposto silenziosamente alla tabella, corretto
spostando gli altri quattro su Pagina 2, che ha spazio libero abbondante), `text_list`/
`bar_chart`/`sparkline`/`faceplate` su Pagina 2. Verificato end-to-end con screenshot X11 (non solo
compilazione): tutti e cinque renderizzano, si aggiornano dal vivo scrivendo i tag corrispondenti
via REST, nessun crash.

**Deliberatamente non affrontati in questo giro, con la ragione specifica per ciascuno** (non
"tempo finito", una valutazione per tipo):
- **`symbol`**: bloccato da Q15 — non è una decisione che spetta a una sessione vibecode, per
  istruzione esplicita del progetto (`CLAUDE.md`/`docs/OPEN_QUESTIONS.md`).
- **`image`**: stesso genere di vincolo di `symbol` — `obj.src` è un URL a contenuto raster/SVG
  arbitrario non noto in anticipo, e questo motore non ha (ancora) alcuna pipeline di decodifica
  immagine configurata (nessun decoder `lv_img` linkato). Non tentato con un'implementazione
  parziale/rotta.
- **`grid`**: **non un widget foglia come tutti gli altri di questo motore** — `GridCell`/
  `SubGrid` in `types/index.ts` sono un vero contenitore ricorsivo (sotto-celle annidate a
  profondità arbitraria, ciascuna con un `child: SynopticObject` proprio) che il dispatcher attuale
  (un ciclo piatto su `page.objects`) non può rendere senza un cambio architetturale — i figli di
  un `grid` non compaiono affatto come oggetti di primo livello nello schema, a differenza dei
  figli di un `faceplate`. Rimandato esplicitamente, non un'omissione.
- **`pipe`**: già segnalato in Q14 (seguito 6) come tipo composito (routing/gradient/fill-level/
  marker) di complessità paragonabile a `trend`/`alarm_viewer` — non affrontato lì, non affrontato
  qui, stessa valutazione.
- **`recipe_panel`**: richiederebbe un client REST dedicato per liste ricette + applicazione
  (`GET`/`POST /api/recipes/*`), un sottosistema a sé quanto `trend`/`alarm_viewer`, non una piccola
  estensione — buon candidato per un prossimo giro mirato, non per essere infilato insieme ad altri
  cinque tipi più piccoli.
- **`alarm_bell`**: nel web è un pannello con dropdown a più viste (attivi/storico/ack/shelve) —
  complessità sproporzionata rispetto al valore per un pannello embedded, mentre `alarm_viewer`/
  `alarm_banner` coprono già i casi d'uso principali (lista e riepilogo compatto).
- **`setpoint`**: l'unico dei tipi rimanenti che richiederebbe un pattern di interazione mai usato
  in questo motore — inserimento testo/numerico (`lv_textarea` + `lv_keyboard` a schermo, gestione
  del focus) invece della manipolazione diretta (click/drag) di bottone/checkbox/slider già
  implementati. Territorio nuovo, non una piccola variazione di un pattern esistente.
- **`xy_plot`**: a differenza di `trend`/`sparkline` (storico via poller REST), servirebbe un
  campionamento locale delle posizioni **live** di due tag con un buffer a scorrimento temporale
  proprio (`xy_trail_s`) — un meccanismo nuovo, non un riuso di `spawn_history_poller`.
- **`pie_chart`**: **LVGL 8.x non ha un widget torta/donut nativo**. Un donut sarebbe
  approssimabile componendo più `lv_arc` (uno per spicchio, ciascuno con il proprio intervallo
  angolare e colore — `lv_arc_set_angles` accetta un intervallo per widget, verificato come
  possibile ma non tentato), una vera "pie" (piena fino al centro, non un anello) richiederebbe
  disegno custom su `lv_canvas`. Rimandato: nessuno dei due percorsi è un riuso diretto di
  primitive già in uso in questo motore.
- **`lang_selector`/`lang_button`**: **concetto client-side puro** — `useAppStore.getState().
  projectLang` in `SvgCanvas.tsx` è stato Zustand del browser, senza equivalente lato server/REST.
  Questo motore non ha mai avuto un concetto di "sessione UI" (a differenza del browser, un
  processo per dispositivo) — implementarlo richiede prima di capire come si vorrebbe rappresentare
  la lingua corrente per un client headless, una domanda a sé non posta qui.

**Decided**: 21/32 tipi supportati. Gli 11 rimanenti restano fuori con motivazioni specifiche per
ciascuno (sopra), non un debito generico — `symbol`/`image` bloccati architetturalmente, `grid`
richiede un cambio del dispatcher, gli altri otto sono possibili ma ciascuno aprirebbe un fronte di
lavoro a sé (nuovo sottosistema REST, nuovo pattern di interazione, o un widget LVGL che non esiste
nativamente).

**Aggiornamento 2026-08-11 (seguito 14) — 29/32 tipi supportati: `symbol` (Q15, opzione B),
`grid`, `pipe`, `alarm_bell`, `recipe_panel`, `setpoint`, `xy_plot`, `pie_chart`**

Richiesta esplicita del maintainer: "riesci a completare anche gli altri?" — tutti gli 11 tipi
rimasti dal seguito 13 tranne `image` e `lang_selector`/`lang_button`, che restano fuori per gli
stessi motivi già scritti sopra (nessuna pipeline di decodifica immagine; concetto client-side
puro senza equivalente server). Prima di procedere, chiesta al maintainer la decisione
architetturale che Q15 esplicitamente riserva a lui (non a una sessione vibecode): **opzione B**,
i soli 17(16) simboli builtin riscritti a mano su primitive LVGL native — vedi "Decided" in Q15
qui sotto.

- **`symbol`**: LVGL 8.x non ha un canale di disegno vettoriale arbitrario fuori da un
  `lv_canvas` (verificato in `lv_canvas.h` prima di scegliere questo approccio: espone solo
  `draw_rect`/`draw_polygon`/`draw_arc`/`draw_line`/`draw_text`, non un path SVG generico). Ogni
  simbolo web (`<path>`/`<circle>`/`<rect>` arbitrari in uno spazio 100×100) è quindi
  **semplificato** a 2-4 primitive canvas — forma essenziale fedele, etichette (PI/TT/FT/LT/CMP),
  animazioni di rotazione e dettagli decorativi minori omessi, stesso principio già usato per
  `ellipse`≈rettangolo arrotondato e `radio`≈checkbox. Buffer canvas `LV_IMG_CF_TRUE_COLOR_ALPHA`
  (3 byte/pixel a `LV_COLOR_DEPTH=16` — macro function-like `LV_IMG_PX_SIZE_ALPHA_BYTE` non
  valutabile da bindgen, calcolata a mano come per `DRM_IOCTL_*` nel backend DRM di Q14):
  serve l'alfa perché gli angoli del canvas quadrato fuori dalla forma devono restare trasparenti
  sullo sfondo pagina, non un rettangolo pieno. Ridisegnato solo quando lo stato
  (`off`/`on`/`alarm`, `resolve_symbol_state` — stessa logica di `truthy()`/`state` in
  `SvgCanvas.tsx`) cambia davvero, non a ogni frame.

  **Bug trovato e corretto durante la verifica visiva, non a compilazione**: alcune forme
  "contenitore" (corpo del `tank`, telaio del `fan`, vasca del `level_sensor`, vessel di
  `mixer`/`agitator`) usavano lo stesso colore dello sfondo pagina (`#0f172a`, lo sfondo di questo
  motore ovunque) — il web li disegna sempre con uno `stroke` chiaro che li rende visibili anche
  su sfondo scuro, ma le funzioni `lv_canvas_draw_rect`/`draw_polygon` di questo motore non hanno
  un bordo impostato. Visto letteralmente sullo screenshot: il corpo del tank spariva, restava
  visibile solo il liquido colorato sopra, sospeso a mezz'aria. Corretto usando un colore
  "pannello" più chiaro (`#1e293b`, lo stesso già usato per i container di `alarm_viewer`/
  `alarm_banner`/`recipe_panel` in questo file) per le 5 forme contenitore coinvolte, invece di
  aggiungere un bordo a ogni chiamata di disegno (fix più piccolo, stesso risultato visivo).

  **Solo i 16 builtin** (non 17 come scritto per errore in una nota precedente di questa voce —
  contati di nuovo da `sws-editor/src/symbols/library.tsx`, `grep -c 'kind: "builtin"'` dà 17 ma
  una riga è il commento di modulo, non un'entry reale). I 12 simboli "vendored" (file `.svg`
  statici) e i `custom_symbols` restano non supportati — `render_symbol` rifiuta esplicitamente
  un `symbol_id` che inizia per `"custom:"`, coerente con l'opzione B decisa.

- **`grid`**: **unico tipo di questo motore i cui figli non compaiono affatto in `page.objects`**
  — a differenza di `faceplate` (che riusa `dispatch_render` sugli stessi oggetti di primo
  livello, solo con parametri sostituiti), le celle e le loro sotto-suddivisioni
  (`GridCell`/`SubGrid`, ricorsione senza limite di profondità dichiarato nello schema) sono
  annidate dentro il campo `grid_cells` dell'oggetto grid stesso. Geometria: colonne/righe di
  larghezza fissa (`col_widths`/`row_heights`, il resto diviso in parti uguali, stessa logica di
  `SvgCanvas.tsx`), `rowspan`/`colspan` sommano le celle coperte. Ogni cella/sotto-cella disegna
  il proprio `bg_color` (rispettando `visible`/`visible_tag`) poi ricorre nel proprio `child` (via
  `dispatch_render`, coordinate traslate) o nella propria `sub` (split 1×2/2×1 per `ratio`,
  ricorsivo). Niente `grid` dentro `grid` (stesso principio di faceplate-dentro-faceplate).
  `on_press_fn`/`on_release_fn` per cella non hanno equivalente — questo motore non esegue script
  lato client per nessun widget, stessa scelta già presa per `button`/`navbutton`. Verificato dal
  vivo con una griglia 2×2 (una cella `text` col valore live, una `led` live, una riga intera
  suddivisa in `sub` 1×2 con un `text` statico e una `checkbox` interattiva): tutte le celle si
  posizionano correttamente, i binding live (`text`/`led`) dentro le celle si aggiornano come
  qualunque altro widget di primo livello.

- **`pipe`**: solo routing `"straight"` (segmenti diretti fra i waypoint) —
  `"orthogonal"`/`"diagonal"`/`"bezier"` segnalati come non supportati, stesso principio di
  `alarm_viewer_mode`. Riusa il pattern di `render_line` (array di punti relativi all'origine,
  `Box::leak`-ato) esteso a N punti invece di 2. **Semplificazioni dichiarate**: nessun gradient
  `"tube"`, nessun marker di inizio/fine, nessuna etichetta al midpoint, e soprattutto **il
  riempimento non è un livello progressivo ma un cambio di colore statico**, deciso una volta alla
  creazione dal valore corrente di `fill_level`/`fill_level_tag` (non segue il tag dal vivo, a
  differenza di quasi tutti gli altri widget — stesso principio già accettato per l'arco soglia
  del `gauge`). Un vero riempimento progressivo richiederebbe disegnare la pipe su un `lv_canvas`
  invece che con `lv_line`, non tentato in questo giro. Verificato dal vivo con un percorso a 4
  waypoint (routing a gradini): la linea segue esattamente i waypoint dichiarati, il colore passa
  da grigio (stroke) a blu (fill_color) quando il tag di riempimento supera la soglia.

- **`alarm_bell`**: badge con conteggio degli allarmi attivi (filtrati come `alarm_viewer`) + un
  pannello a comparsa con l'elenco messaggi al click. **Semplificazione dichiarata rispetto al
  web**: `AlarmBellPanel` in `SvgCanvas.tsx` ha viste multiple (attivi/storico/ack/shelve) — qui
  solo "attivi", sola lettura (niente ACK dal pannello: per quello c'è già `alarm_viewer`). Righe
  del pannello aggiornate solo quando il conteggio cambia davvero (il pannello è quasi sempre
  nascosto, non vale la pena riscrivere `row_ptrs.len()` label a ogni frame).

- **`recipe_panel`**: elenco statico di ricette (`GET /api/recipes`, nuovo `client::fetch_recipes`
  — chiamata bloccante una sola volta come `render_faceplate`, stesso endpoint anonymous-readable
  già usato dall'editor) con un pulsante "Applica" per riga che spara `POST /api/recipes/:id/apply`
  (nuovo `client::apply_recipe`) **in background al click, senza passare da un canale mpsc**: a
  differenza di tutte le altre callback di questo file, chiama direttamente
  `rt_handle.spawn(...)` (la stessa API già usata da `client::spawn_history_poller` per i poller)
  invece di accodare un comando che il loop principale gira poi a un task async — più semplice,
  ed evita di dover aggiungere una nuova coppia di canali mpsc dedicata (mirror di `ack_tx`/
  `ack_rx`) replicata in entrambi `run_window`/`run_drm` in `main.rs`. **Gap dichiarato**: lista
  non aggiornata se le ricette cambiano mentre la pagina è aperta; nessun riscontro visivo del
  successo/fallimento dell'apply (fire-and-forget, stesso principio del bottone/checkbox che non
  mostrano se la `PUT /api/tags` è andata a buon fine).

- **`setpoint`**: label col valore corrente + pulsante che apre un overlay a schermo intero con
  `lv_textarea` + `lv_keyboard` in modalità `LV_KEYBOARD_MODE_NUMBER`. **Primo pattern di
  interazione a inserimento testo di questo motore** — tutti gli altri widget interattivi
  (bottone/checkbox/slider) sono manipolazione diretta, non richiedono un tastierino a schermo.
  `lv_keyboard_set_textarea` collega tastiera e campo: i tasti scrivono direttamente nella
  textarea assegnata, nessun `lv_group`/focus esplicito necessario per l'uso touch (verificato in
  `lv_keyboard.c` prima di assumerlo — il gruppo serve per la navigazione da encoder/tastiera
  fisica, non per il tocco diretto sui tasti). Un valore non numerico digitato non scrive nulla
  (l'operatore la corregge), stesso principio del `setpointDraft` web. Verificato dal vivo che il
  valore mostrato segue il tag quando cambia da un'altra sorgente (`LiveKind::Setpoint`); il ciclo
  completo apri-tastiera→digita→OK→scrittura non è stato testato con click sintetici in questo
  giro (nessun harness XTest predisposto in questa sessione) — il meccanismo ricalca però
  esattamente il pattern collaudato di `AlarmAckCtx`/`RecipeApplyCtx`, non territorio nuovo sul
  lato callback.

- **`xy_plot`**: punto+scia live contro due tag (traiettoria/posizione, **non tempo** — a
  differenza di `trend`/`sparkline`, l'asse X è il valore del tag `tag`, non il tempo).
  Campionamento locale dal `TagSnapshot` di ogni frame (nessun poller REST: i valori sono già lì),
  throttled a un campione ogni ~200ms per non riempire inutilmente i 64 punti del chart a 60fps.
  Range fisso quando `xy_x_min`/`xy_x_max` (risp. Y) sono entrambi impostati nel synottico,
  altrimenti autofit sulla scia corrente. Verificato dal vivo: il punto si posiziona
  correttamente alle coordinate (valore tag X, valore tag Y) dentro il range dichiarato.

- **`pie_chart`**: solo modalità `"donut"` — **LVGL 8.x non ha un widget torta/donut nativo**
  (verificato prima di scrivere il codice). Un anello reale è ottenuto componendo un
  `lv_canvas_draw_arc` per spicchio (spessore fisso `raggio × (1 - inner_ratio)`, angoli
  proporzionali al valore di ciascun tag sul totale, offset -90° così il primo spicchio parte
  dalle ore 12 come il donut web). `"pie"` pieno fino al centro segnalato come non supportato:
  richiederebbe disegno custom oltre le primitive canvas disponibili (nessun settore pieno
  nativo). Nessuno spicchio disegnato quando il totale dei valori è 0 (un arco di ampiezza 0
  sarebbe comunque invisibile) — verificato che questo non è un bug ma il comportamento atteso:
  scrivendo valori non-zero sui tag delle serie l'anello compare immediatamente con le proporzioni
  corrette. Ridisegnato solo quando i valori cambiano davvero (`last_values`), non a ogni frame.

**Verificato end-to-end** su una terza pagina del template `lvgl-demo` con tutti e otto i tipi
insieme (23 oggetti totali sulla pagina, incluso il titolo e le didascalie): nessun errore nel
riepilogo "widget creati" del binario, nessun crash durante la sessione di verifica, screenshot
X11 prima e dopo aver scritto valori non-zero sui tag coinvolti — confermato che gauge/pie_chart/
grid/xy_plot/pipe rispondono tutti correttamente allo stesso cambiamento di tag condiviso
(`lvgl_demo.value`/`value2`/`led_on`), non solo isolatamente.

**Decided**: 29/32 tipi supportati in questo giro. **Correzione** (vedi seguito 15 sotto):
`lang_selector`/`lang_button` non erano affatto inerti — la mia ricerca era stata troppo
superficiale (cercato solo dentro `SvgCanvas.tsx`, mai guardato `RuntimeView.tsx` né
`src/i18n/projectI18n.ts`). Il maintainer l'ha notato ("lato web mi sembrava funzionassero") e ho
verificato meglio prima di procedere. Restano fuori solo `image` (stesso vincolo architetturale di
`symbol`, nessuna pipeline di decodifica).

**Aggiornamento 2026-08-11 (seguito 15) — 31/32 tipi supportati: `lang_button`/`lang_selector`,
correzione di un errore di analisi precedente**

Il maintainer ha corretto un mio errore: avevo scritto (seguito 14) che `lang_selector`/
`lang_button` fossero "inerti anche lato web" perché la mia ricerca (`grep` solo su
`projectLang`/`languages.entries`/`resolveText` dentro `SvgCanvas.tsx`) non aveva trovato nessun
consumo del valore. **Sbagliato**: `RuntimeView.tsx` (il viewer operatore, non l'editor — motivo
per cui `SvgCanvas.tsx` da solo non bastava) importa `localizeObjects`/`effectiveProjectLang` da
un intero modulo che non avevo mai aperto, `src/i18n/projectI18n.ts` (T-40). Il sistema reale:
`project.languages` (`LanguageTable{default, langs, entries: LangEntry{key, values}}`) mappa
token `{{key}}` → traduzioni per codice lingua; i campi testo degli oggetti (`label`/`text`/
`unit`/`text_list_default`/label dentro `table_rows`/`text_list_entries`, elenco esatto in
`TEXT_FIELDS` di `projectI18n.ts`) possono contenere questi token; `RuntimeView.tsx` li risolve
nella lingua corrente (`effectiveProjectLang`, preferenza salvata in `localStorage` → default
della tabella) prima di renderizzare. `lang_button`/`lang_selector` chiamano
`setProjectLang(code)`, che aggiorna sia `localStorage` sia lo store Zustand, facendo
ri-renderizzare `RuntimeView` con la nuova lingua.

**Implementazione LVGL**:
- Nuovo `client::fetch_languages` (`GET /api/project`, deserializzato in un wrapper minimo con
  solo il campo `languages` — l'endpoint restituisce l'intero `Project`, ~30 campi non
  pertinenti, ignorati da serde senza bisogno di dichiararli, stesso principio di tolleranza già
  spiegato in cima a `model.rs`), chiamato una sola volta all'avvio. Non fatale se fallisce (un
  progetto senza T-40 configurato, la maggioranza, non ha nulla da tradurre):
  `LanguageTable::default()` (entries vuoto) rende `resolve_msg`/`localize_object` no-op a costo
  quasi zero.
- **Lingua corrente come stato process-wide** (`SharedLang = Arc<Mutex<String>>`), non
  `localStorage`: questo motore non ha mai avuto un concetto di sessione per-tab come il browser
  (un processo per dispositivo, non un browser con più tab). Inizializzata al `default` della
  tabella, mutata dal click su `lang_button`/`lang_selector`.
- `resolve_msg`/`localize_object` portano `resolveMsg`/`localizeObject` di `projectI18n.ts` 1:1
  (stesso regex `{{key}}`, stesso fallback lingua-corrente → default-tabella → token grezzo).
  **Applicati dentro `dispatch_render`** (non con un pre-processing separato su `page.objects`
  prima del loop): è l'unico punto per cui passano davvero tutti gli oggetti — di primo livello,
  figli di `faceplate`, figli di `grid` — senza ripetere la stessa logica in tre posti diversi e
  rischiare che uno dei tre resti disallineato. Ha richiesto aggiungere `lang_table`/`shared_lang`
  a **sei firme** (`interpret_page`, `render_page_objects`, `dispatch_render`, `render_faceplate`,
  `render_grid`, `render_grid_slot`) — meccanico ma non evitabile, dato che la localizzazione deve
  raggiungere ogni punto che crea un oggetto, non solo il loop principale.
- **Cambio lingua = ricarica pagina**, riusando `nav_tx` con l'id della pagina **corrente** invece
  di una coda dedicata: un `lang_button` è a tutti gli effetti un `navbutton` verso se stesso.
  Questo motore non ha un concetto di re-render reattivo come React (i widget si creano una volta
  sola), quindi il modo per far ripassare tutti gli oggetti da `resolve_msg` con la lingua nuova è
  lo stesso identico meccanismo già collaudato per la navigazione fra pagine — nessun canale
  nuovo, nessuna logica di reload dedicata in `main.rs`.
- `lang_button`: bottone evidenziato (`#3b82f6`, stesso blu "active" del web) se `target_lang`
  combacia con la lingua corrente, altrimenti tinta neutra esplicita (`#334155`) — non lo stato
  di default del tema. **Bug trovato e corretto durante la verifica visiva**: il tema di default
  di LVGL colora già i bottoni in un blu molto simile a `#3b82f6` — senza uno stile esplicito
  anche per lo stato *inattivo*, i due bottoni (IT/EN) risultavano visivamente indistinguibili
  nonostante il colore fosse applicato correttamente solo a quello giusto (verificabile solo
  guardando lo schermo, non dal codice).
- `lang_selector`: `lv_dropdown` con `languages.langs` come opzioni (`\n`-separate, convenzione
  LVGL standard verificata in `lv_dropdown.h`), selezione iniziale sulla lingua corrente. Fedele
  al `<select>` nativo del web — a differenza di `alarm_bell`/altri pannelli di questo motore, qui
  LVGL ha un widget diretto, nessuna semplificazione necessaria.

**Verificato con un vero click sintetico** (a differenza di `setpoint`/`alarm_bell` nel seguito
14, dove non c'era ancora `python-xlib` disponibile — installato in questo giro via `pip install
--user --break-system-packages python-xlib`, nessun `sudo`): screenshot prima del click ("Ciao
operatore"/"Motore", IT evidenziato, dropdown su "it"), click XTest sul bottone EN, screenshot
dopo — testo ricaricato in "Hello operator"/"Motor", EN evidenziato, dropdown su "en". Il ciclo
completo click→cambio `SharedLang`→`nav_tx`→ricarica pagina→`resolve_msg` con la lingua nuova
funziona end-to-end, non solo per lettura del codice.

**Decided**: 31/32 tipi supportati. Resta fuori solo `image` (nessuna pipeline di decodifica
immagine configurata in questo motore — genuinamente bloccato, non un errore di analisi come
`lang_selector`/`lang_button` si sono rivelati essere).

---

## Q15 — Simboli SVG (`symbol`) su LVGL: nessun renderer SVG disponibile

**Context**: quinto e ultimo dei "prossimi 5 step" proposti dopo Q14 ("procedi con i prossimi 5
step") — esplicitamente scoping come *analisi*, non implementazione: "una vera domanda
architetturale... non ancora posta in `docs/OPEN_QUESTIONS.md`". A differenza dei quattro widget
precedenti (checkbox/line/trend/alarm_viewer, tutti risolvibili componendo primitive LVGL già
disponibili — `lv_chart`, `lv_btn`, `lv_obj` colorato, ecc.), `symbol` porta contenuto SVG
arbitrario, e **LVGL 8.x (la versione vendorizzata in questo motore, vedi Q14) non ha alcun
renderer SVG integrato** — quel supporto arriva solo in LVGL 9.x, ed è comunque parziale. Questa
non è una lacuna di implementazione ma un vincolo della libreria stessa: non si risolve scrivendo
più codice nello stile già usato per gli altri widget.

**Cosa c'è davvero da rendere** (verificato leggendo `sws-editor/src/canvas/SvgCanvas.tsx` e
`sws-editor/src/symbols/library.tsx`, non assunto dal nome del tipo):
- **17 simboli "builtin"** (pompa, valvola, motore, serbatoio, ventola...): JSX/SVG scritti a
  mano, poche forme geometriche semplici per simbolo (cerchi/path/rettangoli in uno spazio
  100×100), **davvero ricolorati** in base allo stato derivato da `state_tag`/`alarm_tag`
  (off/on/allarme passano colori diversi dentro il rendering).
- **12 simboli "vendored"**: file `.svg` statici serviti da `sws-editor/public/symbols/`,
  complessità variabile (es. `filter.svg` usa un `<pattern>` per il tratteggio), **mai
  ricolorati** — solo un pallino di stato sovrapposto in un angolo.
- **`custom_symbols`**: SVG arbitrario fornito dal progetto via URL esterno (`ProjectInfo.
  custom_symbols`, nessun upload — solo un campo testo con l'URL), quindi contenuto **non
  conosciuto in anticipo**, impossibile da portare a mano caso per caso.
- **`faceplate`** è un problema *diverso e molto più semplice*, da non confondere con `symbol`:
  è un template composito di oggetti già ordinari (rect/text/led...) con sostituzione parametri
  (`FaceplateDef{objects}` in `synoptic.rs`), non contiene SVG proprio — probabilmente
  supportabile quasi gratis ricorrendo nello stesso dispatcher già scritto per gli altri tipi,
  un follow-up separato e nettamente più piccolo di questa domanda (non affrontato qui: fuori
  dallo scope dei "5 passi" originali, che nominavano solo `symbol`). **Implementato il
  2026-08-11** esattamente come previsto qui — vedi Q14 seguito 13. Questa voce (Q15) resta
  aperta solo per `symbol`, non più per `faceplate`.

**Options**:
- **A — Rasterizzazione offline/build-time**: convertire ogni SVG (i 29 built-in/vendored; i
  `custom_symbols` per natura non si possono precompilare) in bitmap `lv_img_dsc_t` a poche
  risoluzioni fisse. `lv_img_set_recolor` di LVGL applica una tinta uniforme (blend) sopra
  l'intera bitmap — approssimerebbe la ricolorazione per stato dei builtin solo se la sorgente
  fosse monocromatica (come un'icona font), perdendo la possibilità di colori diversi per forma
  interna che i builtin oggi hanno. Non copre affatto `custom_symbols` (contenuto ignoto a
  build-time).
- **B — Riscrittura a mano dei soli builtin su primitive LVGL native**: stesso approccio già
  usato per `ellipse` (approssimata con un `lv_obj` arrotondato) e `radio` (approssimato con
  `checkbox`) — fattibile per i 17 builtin (poche forme semplici, sorgente sotto controllo),
  **non estendibile** agli 12 vendored (SVG arbitrario, complessità variabile e sconosciuta in
  anticipo) né ai `custom_symbols` (contenuto del progetto, non del codice). Copertura parziale
  ma onesta: i tipi non copribili resterebbero esplicitamente non supportati, non approssimati
  male.
- **C — Rasterizzazione a runtime con una crate Rust per SVG** (es. `resvg`+`tiny-skia`, maturi
  e mantenuti): unico approccio che copre uniformemente tutti e tre i casi (builtin — se anche
  loro venissero serializzati come vero SVG invece di JSX —, vendored, custom), decodificando e
  disegnando in un buffer RGBA passato a LVGL come immagine grezza. Costo reale: una dipendenza
  nuova e non piccola, una pipeline di decodifica/rasterizzazione con le sue implicazioni di
  memoria/prestazioni su hardware embedded (il target dichiarato di questo motore), e va
  verificato se `resvg` copre davvero il sottoinsieme SVG usato nei file vendored esistenti
  (pattern, eventuali gradienti) prima di contarci.
- **D — Non supportato per ora** (stato di fatto attuale: `symbol` semplicemente assente da
  `SUPPORTED_TYPES`, oggetto silenziosamente saltato). Più onesto di un'approssimazione a metà,
  ma lascia un buco reale nella promessa "stesso YAML, portabile tra i target" per qualunque
  progetto che usi simboli di sistema — probabile per una demo SCADA/industriale tipica (pompe,
  valvole, serbatoi sono contenuto di dominio comune).

**Default for PoC**: **D** resta lo stato di fatto finché il maintainer non sceglie diversamente
— coerente con l'istruzione di non decidere le domande architetturali in sessione. Se/quando si
deciderà di procedere, l'opzione più in linea con lo spirito "MVP dichiarato, non finto" già
seguito per gli altri widget di questo filone sarebbe **B** applicata solo ai 17 builtin (stesso
schema di `ellipse`/`radio`: copertura parziale ma vera, gap espliciti per vendored/custom nel
badge "L" dell'editor e in `docs/OPEN_QUESTIONS.md`), rimandando **C** a quando/se emergerà un
bisogno reale di simboli vendored/custom su un progetto LVGL concreto — ma questa è una
raccomandazione, non una decisione presa qui.

**Decided (2026-08-11)**: **B** — riscrittura a mano dei soli 16 simboli builtin (contati di
nuovo da `library.tsx`: 17 era un errore di conteggio in una nota precedente) su primitive LVGL
native, stesso schema di `ellipse`/`radio`. I 12 simboli "vendored" e i `custom_symbols`
restano esplicitamente non supportati (copertura parziale ma vera, non un'approssimazione a
metà) — nessuna decisione presa su C (rasterizzazione runtime) per quei due casi, resta
un'opzione futura se emergerà un bisogno reale. Implementato: 16/16 builtin renderizzati su
`lv_canvas`, verificato dal vivo — vedi Q14 seguito 14 per il dettaglio tecnico completo.

---

## Q16 — Widget `image` su LVGL: nessun decoder raster compilato, e il catalogo bundle è SVG

**Context**: emerso durante una sessione di lavoro autonomo mirata a chiudere il gap "`image` è
l'unico widget rimasto non supportato in LVGL" (31/32 tipi, per il lavoro fatto su `sws-lvgl-viewer`
in sessioni precedenti). Un'analisi preliminare (non ancora un'implementazione) lo classificava
come "caso semplice": `obj.src` nel motore web è un URL raster, e LVGL ha supporto nativo `lv_img`
— sembrava non servire un renderer SVG come per `symbol` (Q15). Verificando il codice prima di
scrivere qualunque riga, il quadro è diverso.

**Cosa c'è davvero da rendere** (verificato, non assunto dal tipo dichiarato):
- Il pannello proprietà di `image` (`EditorShell.tsx:2788-2812`) è un campo testo libero
  ("https://… o /images/…") più un bottone "Sfoglia immagini" che apre `ImageBrowser.tsx` — il
  quale legge `/images/catalog.json`, un catalogo di icone bundlate nel frontend
  (`sws-editor/public/images/{mdi,tabler,equinor,electrical}/*.svg`). **Tutte le voci del catalogo
  sono file `.svg`**, non raster — lo stesso identico problema di `symbol`/Q15 (LVGL 8.x non ha
  renderer SVG), non un caso a parte.
- Il campo resta comunque testo libero: un utente può incollarci un URL PNG/JPG esterno, che
  quello sì sarebbe un caso "raster puro" risolvibile con un decoder nativo — ma non è il percorso
  che l'UI stessa incoraggia (il bottone porta al catalogo SVG).
- Verificato nel `lv_conf.h` di progetto (`sws-lvgl-viewer/lv_conf/lv_conf.h`, non solo il
  template vendorizzato): `LV_USE_PNG 0`, `LV_USE_SJPG 0`, `LV_USE_GIF 0` — **nessun decoder
  immagine è compilato nella LVGL vendorizzata usata da questo motore**, quindi nemmeno il caso
  raster funziona oggi senza toccare la configurazione di build C e aggiungere una dipendenza
  nativa (`libpng`/libjpeg equivalente) al toolchain di cross-compilazione (sia generic via QEMU
  sia SDK Yocto) — un cambio che va verificato con una build reale prima di contarci, non
  eseguibile senza `sudo` (bloccato dalla policy permessi di questa sessione) né senza il
  maintainer.

**Options**:
- **A — Abilitare `LV_USE_PNG`/`LV_USE_SJPG`, coprire solo URL raster espliciti**: risolve il
  sottoinsieme "utente incolla un URL PNG/JPG esterno", richiede scaricare i byte via HTTP lato
  `sws-lvgl-viewer` e scriverli in un file temporaneo (LVGL legge da filesystem, non da URL),
  aggiunge una dipendenza C nativa al build — da verificare su entrambe le pipeline
  (generic/SDK). **Non copre affatto il catalogo SVG bundlato**, cioè il percorso che l'editor
  stesso propone di default via "Sfoglia immagini".
- **B — Come Q15, opzione C**: rasterizzazione a runtime via crate Rust (`resvg`+`tiny-skia`) —
  unica opzione che copre sia il catalogo SVG bundlato sia URL SVG/raster esterni in modo
  uniforme. Stessi costi già descritti in Q15 (dipendenza nuova, pipeline di decodifica,
  implicazioni memoria/prestazioni su hardware embedded) — se mai si decidesse di percorrerla, ha
  senso farlo **una volta sola per entrambi i widget** (`symbol` e `image` condividono lo stesso
  problema di fondo), non due implementazioni separate.
- **C — Non supportato per ora** (stato di fatto): `image` resta assente da `SUPPORTED_TYPES` in
  `sws-lvgl-viewer`, oggetto silenziosamente saltato — coerente con come già si comporta `symbol`.

**Default for PoC**: **C** — nessuna implementazione fatta in questa sessione. Il problema è
sostanzialmente lo stesso di Q15 (mancanza di un renderer SVG in LVGL 8.x), non un gap separato
più semplice come inizialmente ipotizzato: non ha senso decidere/implementare una soluzione
parziale (opzione A, che lascerebbe comunque "muto" il catalogo icone bundlato) senza prima
sapere se/quando si affronta Q15 nel suo complesso — le due domande vanno probabilmente risolte
insieme, con la stessa scelta di rasterizzazione.

**Decided**: not yet.

---

## Adding new questions

When Claude Code adds a new question, follow the format above:
1. **Context** — why this came up.
2. **Options** — at least 2, briefly described.
3. **Default for PoC** — what we're doing for now.
4. **Decided** — left as `not yet` until the maintainer fills it in.

## Q17 — `apply_recipe` scrive i tag senza contesto utente: la soglia `write_min_role` non si applica

**Context**: emerso il 2026-08-22 implementando F3.1 (piano SCADA-widgets). Le scritture via
REST (`PUT /api/tags/:id`) e WS onorano `TagDef.write_min_role`; `POST /api/recipes/:id/apply`
invece non ha `Extension<AuthUser>` (deve funzionare anche per il viewer anonimo/kiosk) e scrive
i setpoint della ricetta senza controllo per-tag. Un Operator — o un anonimo, dove il viewer lo
permette — può quindi scrivere via ricetta un tag protetto Admin.

**Options**:
1. Aggiungere l'utente opzionale all'endpoint (optional_auth) e applicare la soglia per-tag:
   anonimo = sotto Viewer, ricette con tag protetti falliscono con elenco chiaro.
2. Soglia di ruolo a livello di RICETTA (`RecipeDef.min_role`), più grossolana ma più semplice
   da capire per l'operatore.
3. Lasciare com'è e documentare: le ricette sono già un'azione deliberata di supervisione.

**Default for PoC**: opzione 3 (stato attuale), da rivedere insieme alla Q8-E.

**Decided**: not yet.

## Q18 — Colori del testo dai token di tema su pagine con sfondo scelto a mano

**Context**: emerso il 2026-08-23 misurando F7.4 (testo multiriga). Un oggetto `text` senza
`color`/`fill` esplicito usa il token di tema `--brand-text`, che segue il tema **dell'app**
(chiaro/scuro/sistema). Lo sfondo della PAGINA invece è un colore scelto dal progettista
(`page.background` / `background_dark`). Con tema chiaro e sfondo pagina scuro — la
combinazione del progetto di prova — il testo predefinito è scuro su scuro: praticamente
invisibile. Vale per tutti i tipi che usano quei token come default (testo, tabella, gauge,
etichette dei chart), non solo per il testo multiriga appena aggiunto: nessuna regressione,
un difetto di impostazione che nessuno aveva ancora misurato.

**Options**:
1. Il colore predefinito del testo si ricava dallo sfondo pagina effettivo (chiaro→testo
   scuro, scuro→testo chiaro), ignorando il tema dell'app per gli oggetti del sinottico.
   Coerente col fatto che un sinottico è un disegno, non una UI di sistema.
2. Il sinottico ha un suo "tema pagina" dichiarato (chiaro/scuro) da cui derivano tutti i
   token degli oggetti; il tema dell'app resta per la chrome dell'IDE/viewer.
3. Avviso nell'editor quando il contrasto fra colore risolto e sfondo pagina è sotto soglia
   (nessun cambio di comportamento, solo un segnale al progettista).
4. Lasciare com'è: chi mette uno sfondo pagina personalizzato imposta anche i colori.

**Default for PoC**: opzione 4 (stato attuale).

**Decided**: not yet.

---

## Q19 — Il backend DRM del viewer LVGL apre i device a mano, mentre PixsysOS li distribuisce con `seatd`

**Context**: misurato su `wp630-a-p3-07a077.local` il 2026-08-24, indagando perché l'utente `user`
non riesce ad aprire `/dev/dri/card*` né `/dev/input/*`.

Non è una svista di permessi da correggere: è il disegno dell'OS. PixsysOS fa girare **`seatd`**
(`/run/seatd.sock`), e Weston — che gira come `User=user`, **fuori** dai gruppi `video` e `input` —
ottiene da lì i descrittori di `card1`, `renderD128` e dei device di input. Le sessioni di `user`
non sono nemmeno agganciate a un seat (`loginctl` mostra seat `-`), quindi neanche le ACL `uaccess`
di logind entrano in gioco: passa tutto da seatd.

Il nostro `--backend drm` (`src/drm_display.rs`) invece fa `open()` diretto su `/dev/dri/cardN`.
Due conseguenze:

1. **Non ha i permessi**, e allargare i gruppi (`usermod -aG video,input user`) sarebbe aggirare il
   meccanismo previsto invece di usarlo.
2. **Non convive con Weston comunque**: c'è un solo DRM master per seat, e ce l'ha Weston. Anche coi
   permessi, servirebbe fermare il compositore.

Sul percorso **SDL2/Wayland** il problema non esiste: gli eventi li consegna Weston, che legge il
touch già calibrato da `/dev/input/ts_uinput`. È la ragione per cui quel percorso va provato per
primo.

**Options**:
1. **Usare `libseat`** nel viewer per chiedere i device a seatd, come fa Weston. È il meccanismo
   previsto e non richiede modifiche all'OS né ai gruppi. Costo: una dipendenza nuova e la gestione
   del protocollo di attivazione/disattivazione del seat.
2. **Restare su SDL2/Wayland** e considerare il backend DRM uno strumento da banco, da usare solo
   con Weston fermo e permessi concessi a mano. È lo stato attuale di fatto.
3. **Chiedere a Pixsys** di aggiungere `user` ai gruppi `video`/`input` nell'immagine. Semplice, ma
   contraddice il disegno dell'OS e va contro il motivo per cui seatd esiste.
4. **Chiedere a Pixsys** perché i device di input non hanno il tag udev `uaccess` mentre
   `/dev/dri/card1` ce l'ha (`TAGS=:master-of-seat:uaccess:seat:`). Potrebbe essere voluto — ci
   pensa seatd — oppure una svista delle regole udev. Non cambia nulla per noi finché usiamo
   Wayland.

**Default for PoC**: opzione 2 — il percorso normale sul pannello è SDL2/Wayland, e il backend DRM
resta quello che ha salvato la situazione sul TC620 quando SDL2 dava schermo nero.

**Decided**: not yet.

---

## Q20 — Il viewer LVGL non si accorge che il progetto è cambiato

**Stato**: aperta. Emersa il 2026-08-24, segnalata indirettamente dal maintainer.

Il maintainer ha modificato un'ellisse da 100x80 a 100x100 e sul pannello continuava a vederla
ovale. Non era un difetto di rendering: **il viewer scarica la pagina una volta sola**, all'avvio o
quando si naviga altrove (`main.rs:147`, poi `fetch_page` nei rami di navigazione). Restando fermo
sulla stessa pagina, una modifica al progetto non arriva mai: bisogna riavviare il viewer.

Il viewer web non ha questo problema — ricarica e ridisegna. Sul pannello invece il ciclo
"modifico nell'IDE → deploy → guardo" è rotto a metà, e il sintomo (una pagina vecchia che sembra
giusta) è peggio di un errore, perché non si distingue da un difetto di rendering. È costato una
diagnosi sbagliata in questa sessione.

Opzioni, non decise:

1. **Polling del fingerprint.** `GET /api/project/fingerprint` esiste già (SHA256 di project.yaml +
   sinottici, T-24): il viewer lo interroga ogni N secondi e si ridisegna quando cambia. Semplice,
   una richiesta leggera, ma introduce polling su un dispositivo dove ogni ciclo costa.
2. **Notifica dal runtime.** Il viewer è già connesso al WebSocket dei tag: aggiungere un messaggio
   "progetto cambiato" e ridisegnare. Nessun polling, ma allarga il protocollo WS.
3. **Riavvio del viewer al deploy.** Il runtime riavvia `sws-lvgl-viewer.service` quando un import
   va a buon fine. Brutale ma banale, e su un pannello un lampo di riavvio è accettabile.
4. **Niente**, e si dichiara che sul pannello serve un riavvio manuale — a patto di scriverlo dove
   qualcuno lo legga, perché oggi non è scritto da nessuna parte.

Da valutare anche cosa fare degli **oggetti già creati**: `render_page_objects` fa `lv_obj_clean` e
ricostruisce, quindi un ridisegno è già supportato (lo fa la navigazione); il costo è perdere lo
stato locale dei widget, che però è quello che si vuole dopo una modifica di progetto.

---

## Q21 — Due superfici Python nel progetto, in due punti lontani dell'interfaccia

**Stato**: aperta. Domanda del maintainer, 2026-08-24: «gli script python sarebbe bello fossero
parte del progetto e visibili nelle funzioni dell'IDE, cosa manca perché sia così?».

Risposta di fatto: **non manca niente**, sono già entrambe parte del progetto e già entrambe
modificabili — ma stanno in due posti diversi, e la domanda nasce da lì.

| | **Funzioni** (`functions`) | **Script** (`global_scripts`) |
|---|---|---|
| Campi | `id, name, description, code, params` | `id, trigger, code, enabled` |
| Chi le avvia | un oggetto, con `on_press_fn` | un trigger: Startup / Interval / Cron / TagChange |
| Dove si modificano | editor, `FunctionEditor.tsx` a schermo intero | Configurazione → Script, `GlobalScriptsTab` |

Entrambe stanno in `project.yaml`, viaggiano nel bundle, compaiono nella ricerca per tag
(`tagUsage.ts` le scandaglia tutt'e due) e si ricaricano a caldo al salvataggio.

La distinzione è reale — una funzione non ha trigger, aspetta di essere chiamata — quindi fonderle
in un unico tipo sarebbe sbagliato. La domanda aperta è solo **dove mostrarle**:

1. Lasciarle dove sono e aggiungere un rimando reciproco («queste sono le funzioni chiamate dagli
   oggetti; per gli script a tempo vedi Configurazione → Script»). Costo quasi nullo.
2. Una sezione "Python" unica che elenca entrambe, distinte da un'etichetta di trigger, in un unico
   punto dell'IDE.
3. Spostare le Funzioni in Configurazione accanto agli Script, lasciando nell'editor solo la scelta
   della funzione da chiamare.

Tocca la struttura del menu, quindi è una decisione del maintainer, non un dettaglio realizzativo.
