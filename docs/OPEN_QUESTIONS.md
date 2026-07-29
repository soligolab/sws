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
ma il suo ruolo attuale è solo definire i trait condivisi tra i crate.

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

**Decided**: **A (embedded nel binario)**. I 22 simboli SVG built-in e le 3 faceplate
predefinite (`motor_basic`, `valve_basic`, `tank_level`) sono inclusi via `include_str!()`
in `sws-web`. Un'eventuale cartella `sws-symbols/` separata con symbol pack aggiuntivi
rimane un'opzione post-PoC.

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

## Adding new questions

When Claude Code adds a new question, follow the format above:
1. **Context** — why this came up.
2. **Options** — at least 2, briefly described.
3. **Default for PoC** — what we're doing for now.
4. **Decided** — left as `not yet` until the maintainer fills it in.
