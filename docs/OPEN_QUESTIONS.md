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
interamente lato editor, in `sws-editor/src/symbols/library.tsx` — **17** disegnati a mano come
JSX/SVG inline (`kind: "builtin"`, davvero ricolorabili per stato) più **12** file `.svg`
statici serviti da `sws-editor/public/symbols/` (`kind: "vendored"`, mai ricolorati — solo un
pallino di stato sovrapposto), per un totale di **29**, non 22. Il backend non ha alcuna
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

**Decided**: A+B+D in lavorazione (2026-07-26). C/E/F = product phase.

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

**Decided**: not yet.

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

**Decided**: not yet.

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

**Decided**: not yet.

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

**Decided**: not yet.

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

**Decided**: not yet.

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

---

## Q15 — Simboli SVG (`symbol`/`faceplate`) su LVGL: nessun renderer SVG disponibile

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
  dallo scope dei "5 passi" originali, che nominavano solo `symbol`).

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

**Decided**: not yet.

---

## Adding new questions

When Claude Code adds a new question, follow the format above:
1. **Context** — why this came up.
2. **Options** — at least 2, briefly described.
3. **Default for PoC** — what we're doing for now.
4. **Decided** — left as `not yet` until the maintainer fills it in.
