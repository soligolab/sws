# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [CalVer](https://calver.org/) (`YYYY.MM[.patch]`).

## [Unreleased]

### Added
- Monorepo scaffold: `sws-runtime/` (Rust workspace) and `sws-editor/` (Vite + React)
- Community files: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- GitHub Actions CI pipeline with DCO check, lint, build, test, SBOM, audit
- GitLab CI mirror pipeline
- Architectural Decision Record 0001: state management choice (pending)
- `sws-core`: in-memory `TagDb` (Arc<RwLock<HashMap>> + tokio broadcast), `TagValue` serializes as native JSON (`#[serde(untagged)]`)
- `sws-core`: YAML project loader (`project.yaml`) with Modbus TCP source mapping
- `sws-plugin-modbus`: Modbus TCP polling driver with reconnect loop, marks tags Bad on disconnect
- `sws-web`: REST API — `GET/PUT /api/tags/:id`, `GET /api/tags`, `GET/PUT /api/synoptics/:name`, `GET /api/synoptics`; WebSocket stream `GET /ws/tags`
- `sws-runtime`: HTTPS server on 0.0.0.0:8443 with self-signed TLS via rcgen, project loading, graceful shutdown
- `sws-editor`: full IDE shell — rect/text/button objects, drag-to-move, property panel, page tab bar, Save button (PUT synoptic), load synoptics on mount, quality indicator dots, tag write via button click in view mode
- `sws-editor`: complete object palette — ellipse, line (with endpoint drag), navbutton (page navigation)
- `sws-editor`: canvas SVG grid with configurable size and snap-to-grid
- `sws-editor`: LeftPanel project tree — pages, object palette, live tag browser with quality dots, protocol source viewer
- `sws-editor`: page properties panel (name, background color) when no object selected
- `sws-editor`: RuntimeView operator page-navigation tab bar
- `sws-web`: `GET /api/project` endpoint exposes full project JSON (meta + tags + sources)
- `sws-web`: SynopticObject extended with x2, y2, stroke, stroke_width, target_page; SynopticPage gains background field
- `sws-web`: `PUT /api/project/tags` and `PUT /api/project/sources` — update respective sections in project.yaml (creates file if absent)
- `sws-editor`: ConfigView with two tabs — Variabili (tag CRUD with live value column) and Protocolli (Modbus TCP CRUD with inline register mapping table)
- `sws-editor`: "Configurazione" mode added to header alongside Editor and Runtime
- `sws-editor`: 7 new synoptic object types — gauge (270° arc, threshold ticks, needle), slider (HTML range in view mode), checkbox (on/off value binding), radio (dynamic option list), LED (glow ring), progress_bar (threshold markers), table (per-row tag/format/label)
- `sws-editor`: LeftPanel palette updated with all new types; EditorShell with per-type defaults and property sections; RadioOptionsEditor and TableRowsEditor inline sub-components
- `sws-editor`: reusable `TagInput` component (text input + `<datalist>`) suggesting project-defined tag IDs; wired into all ObjectProps tag fields, TableRowsEditor rows, and ModbusSourceCard register mappings
- `sws-core`: `TagDef.data_type` field (`bool` / `int` / `float` / `string`, default `float`); `populate_tags()` seeds the matching `TagValue` variant at startup
- `sws-editor`: Variabili tab gains a "Tipo" column with a per-tag type selector (Bool/Int/Float/Stringa)
- `sws-plugin-mqtt`: subscribe loop using `rumqttc::AsyncClient` — exact-topic match, automatic 5 s reconnect, payload decoded as bool/int/float/string heuristically or via optional dot-separated `json_path`
- `sws-core`: `SourceDef::Mqtt` variant with `MqttConfig { id, host, port, client_id, topics }` and `TopicMapping { tag, topic, json_path? }`
- `sws-runtime`: spawns one MQTT task per `mqtt` source on startup, alongside Modbus
- `sws-editor`: `MqttSourceCard` in Protocolli tab (host/port/client_id + topic↔tag mapping table with TagInput dropdown and optional JSON path); LeftPanel SourcesSection renders MQTT topics; "+ Aggiungi MQTT" button activated, "+ MQTT (prossimamente)" placeholder removed
- `sws-core`: `TagWriteBus` — registry routing `(TagId, TagValue)` writes via mpsc to the plugin that owns the tag; `WriteError::{NoWriter, ChannelClosed}`; unit-tested
- `sws-plugin-modbus`: `run()` now also accepts the bus; `session()` selects between the poll ticker and the write receiver; writes apply inverse scale + range clamp, call `write_single_register`, and echo the new value into `TagDb` on success
- `sws-web`: `PUT /api/tags/:id` first tries the bus → `202 Accepted` if a plugin owns the tag, falls back to direct `TagDb` set for virtual tags (`204`), returns `503` if the plugin channel is closed
- `sws-core`: new `alarm` module — `AlarmDef`, `AlarmCondition::{Above, Below, BoolEquals}`, `AlarmSeverity::{Info, Warning, Critical}`, `AlarmState`, `AlarmDb` (storage + tokio broadcast). Unit-tested: fire/clear/ack-reset/bool conditions
- `sws-core`: `Project.alarms: Vec<AlarmDef>` (`#[serde(default)]`, backwards compatible with existing `project.yaml`)
- `sws-runtime`: builds an `AlarmDb`, loads it from `project.alarms`, and spawns an evaluator task that consumes `TagDb` broadcasts and re-evaluates the alarms watching each tag
- `sws-web`: `GET /api/alarms`, `POST /api/alarms/:id/ack`, and `WS /ws/alarms` (snapshot-then-stream, same shape as `/ws/tags`)
- `sws-editor`: `useAlarmStream` hook, alarms in Zustand store, live `AlarmBanner` showing active/unacknowledged counts, severity-coloured tint, most-recent unack message, inline ACK button
- `sws-core`: `TagDef::initial_value()` helper (shared by startup `populate_tags` and hot-reload), `TagDb::remove()` to evict orphan tags
- `sws-web`: tag hot-reload — `PUT /api/project/tags` now diffs the new list against the current `TagDb`: new tags get seeded, removed tags get evicted, existing tags keep their live state. No runtime restart needed for tag CRUD.
- `sws-web`: `PUT /api/project/alarms` with alarm hot-reload — full `AlarmDb::load` after persist. In-flight active alarms reset and are re-evaluated on the next tag update.
- `sws-editor`: ConfigView gains an "Allarmi" tab with CRUD over `AlarmDef` (id, tag with TagInput autocomplete, condition kind, threshold/bool, severity, message) and a live state column (ON / ACK / —). `SaveBar` notice now distinguishes hot-reload tabs ("modifiche applicate immediatamente") from the Protocolli tab (still requires restart for sources).
- `sws-historian`: in-memory `Historian` ring-buffer per tag (5000 samples PoC default) with `record()`, `query(from, to)` and `spawn_recorder()` that subscribes to `TagDb` broadcasts. Unit-tested: range query, ring drop, unknown tag.
- `sws-web`: `GET /api/history/:tag?from=&to=&limit=` returns `Vec<Sample>` (ts_ms + value + quality)
- `sws-runtime`: builds the Historian and starts its recorder alongside the alarm evaluator
- `sws-editor`: new `trend` SynopticObject — line chart in a `<foreignObject>` rendering an HTML canvas. Properties: `tag`, `window_s`, optional `y_min`/`y_max` (autofit when both zero), `line_color`. In edit mode shows a static placeholder; in runtime polls `/api/history` every 2 s and redraws. Added to LeftPanel palette and EditorShell defaults/property panel.
- `scripts/dev.sh`: one-stop local-dev launcher — creates writable `.run/{config,project,logs}` under the repo root, seeds an example `project.yaml` (two tags + one alarm), builds + starts the runtime, and launches the Vite dev server. Modes: `both` (default) / `runtime` / `editor`. Documented in `scripts/README.md`.
- `.gitignore`: ignore `/.run/` (local dev state — TLS cert, project, logs)
- `CLAUDE.md`: points to `scripts/dev.sh` so future sessions know how to bring the stack up

### Changed
- `sws-editor`: `tagStream` and `alarmStream` derive the WebSocket URL from `window.location` instead of hard-coding `wss://localhost:8443`. Same-origin URLs go through the Vite dev proxy (or production nginx), so a browser on a different LAN host no longer tries to talk to its own localhost. `VITE_RUNTIME_WS_URL` / `VITE_ALARMS_WS_URL` env overrides still honoured.
- `scripts/dev.sh`: Vite started with `--host 0.0.0.0` so the editor is reachable from other devices on the LAN. Info banner shows the host's first non-loopback IPv4 as `http://<lan-ip>:5173`. Remote browsers never see the runtime's self-signed cert — all traffic is proxied server-side by Vite (`secure: false`).

### Added (auth skeleton)
- `sws-auth`: real implementation. `hash_password`/`verify_password` (Argon2id with random salt, PHC-formatted hash). `AuthState` with single admin user seeded from constructor + in-memory `HashMap<token, username>` session registry. Unit tests cover hash roundtrip, malformed hash rejection, login/validate/logout flow, empty-password refusal.
- `sws-web`: `AppState.auth: Arc<AuthState>`. New routes: `POST /api/auth/login` (returns `{token, username}` on success, 401 otherwise), `POST /api/auth/logout` (idempotent), `GET /api/auth/whoami`. Tower middleware `require_auth` extracts the session token from either `Authorization: Bearer ...` or `?token=...` (the latter for browser WebSocket upgrades, which can't set custom headers) and refuses with 401 if invalid. Applied to every route under `/api/*` except `/api/auth/login` and to the WS endpoints. `/health` and `/metrics` stay open.
- `sws-runtime`: reads `SWS_ADMIN_USER` (default `admin`) and `SWS_ADMIN_PASSWORD` (required, no default — refuses to start without it) at startup. The clear-text password is hashed once and discarded.
- `sws-editor`: token + username persisted in `localStorage` (`sws.auth`) and hydrated at module load so refreshes survive. `api.client` adds `Authorization: Bearer ...` to every request and surfaces 401s as a typed `AuthError`. New `LoginScreen` component shown whenever `authToken` is null; `App` clears the session on `AuthError`. Header shows current user + "Esci" button.
- WS hooks (`tagStream`, `alarmStream`) build the URL with `?token=<session>` and replace the socket if the token changes (login/logout cycle).
- `scripts/dev.sh`: exports `PYO3_PYTHON=python3` (Debian Bookworm ships `python3` but not `python`, which pyo3-build-config defaults to) and `SWS_ADMIN_USER=admin` / `SWS_ADMIN_PASSWORD=admin` for local dev convenience. Production deployments must override these.
- `Cargo.toml` workspace: `argon2` upgraded to `features = ["std"]` so `OsRng` is available via `password_hash::rand_core::OsRng`. Added `uuid = { version = "1", features = ["v4"] }`.

### Added (text object + object list)
- `SynopticObject` gains an optional `name` field (human-friendly label) plus a full typography block for the `text` type: `text` (static content), `font_size`, `font_family`, `font_weight` (string or number), `font_style` (normal/italic), `text_anchor` (start/middle/end), `color`. Rendered by SvgCanvas via the matching SVG attributes; legacy use of `stroke_width` as fontSize is gone.
- Text rendering precedence: bound `tag` → `format` template (default `{value}`); otherwise the static `text` field; otherwise a "Testo" placeholder.
- EditorShell ObjectProps gains a "Nome" field at the top of every object, plus a dedicated text-styling block (size + alignment, font family, weight + style, colour).
- Zustand store: `duplicateObject(id)` clones an object with a fresh id, +20px offset, name suffix `(copia)`, and selects the copy.
- LeftPanel: new "OGGETTI PAGINA" accordion section listing every object on the current page. Click to select, double-click or ✎ to rename inline, ⧉ to duplicate, × to delete. Type prefix shown for quick scanning.
- Rust `SynopticObject`: matching fields added so trends/text/etc. survive YAML save-then-reload round-trips.

### Added (script sandboxing)
- `sws-pyscript::Engine` rewritten around a Python harness that compiles the user source, redirects `sys.stdout` / `sys.stderr` into in-memory `io.StringIO`, execs in a fresh globals dict with `tags` injected, then hands the captures back to Rust. New return type `ExecOutput { stdout, stderr, sandboxed }`.
- Wall-clock timeout per call (default 5 s, override via `SWS_SCRIPT_TIMEOUT_MS`). `tokio::time::timeout` drops the future on expiry — preemption mid-Python is left as a follow-up (needs `Python::check_signals` + a signal thread).
- RestrictedPython integration with graceful fallback. At engine startup we probe `import RestrictedPython`; if present, the harness compiles via `compile_restricted` with `safe_builtins`, blocking `import`, `exec`, dunder access etc. If absent, a warning is logged and the engine runs `compile()` unrestricted (so dev boxes don't break). Install with `pip install -r requirements.txt`.
- `POST /api/script/exec` response now includes `stdout`, `stderr` and `sandboxed` alongside `ok`/`error`. The editor's `RuntimeView` script dispatcher pipes them to `console.log` / `console.warn` so you can see `print(...)` and tracebacks from the browser devtools.
- `requirements.txt` at the repo root documenting the optional RestrictedPython dep.

### Added (source hot-reload)
- `sws-web::SourceSupervisor` (new module) owns a `HashMap<source_id, RunningSource>` mapping each `SourceDef` to a `JoinHandle` + `CancellationToken` + cached config JSON + owned-tag list. `reload(desired)` diffs the new list against the running set: stops sources whose id disappeared or whose JSON config changed, starts the rest. Stopping a source cancels its task, joins with a 2 s timeout, then releases its tag routes from `TagWriteBus`.
- `sws-plugin-modbus::run(cfg, db, bus, cancel)` and `sws-plugin-mqtt::run(cfg, db, cancel)` now take a `CancellationToken`. Both reconnect loops and inner sessions `select!` on `cancel.cancelled()` so cancellation lands within one network read / one poll cycle.
- `sws-core::TagWriteBus::unregister_many(ids)` to drop routes on plugin stop.
- `sws-web::AppState` gains `supervisor: Arc<SourceSupervisor>`. `PUT /api/project/sources` now persists then calls `supervisor.reload(new)` — no runtime restart for Modbus/MQTT config edits.
- `sws-runtime`: startup spawns plugins via the supervisor instead of bare `tokio::spawn`. Reload re-uses the same path. The plugin crates moved from `sws-runtime` deps to `sws-web` deps (the supervisor lives there now).
- ConfigView ProtocolsTab notice updated: "Le sorgenti vengono ricollegate in tempo reale al salvataggio (niente riavvio del runtime)."
- `tokio-util` added to the workspace dependencies (gives `CancellationToken`).

### Added (historian polish)
- `sws-historian::sqlite::SqliteStore` — bundled-SQLite (rusqlite) append-only log behind the in-memory ring buffer. Schema: `samples(tag TEXT, ts_ms INTEGER, value TEXT, quality TEXT)` with `WITHOUT ROWID` primary key on `(tag, ts_ms)` and an index on `ts_ms`. WAL mode + `synchronous=NORMAL` so writes don't block reads. All I/O via `tokio::task::spawn_blocking`.
- `Historian::with_sqlite(max_per_tag, store)` builds a historian backed by SQLite — restores up to `max_per_tag` most-recent samples per tag into RAM at startup, then write-through on every `record()`. RAM-only mode remains the default when no store is attached.
- `sws-runtime` reads `SWS_HISTORIAN_DB` at startup; if set to a writable path, opens the SQLite store and restores. `scripts/dev.sh` defaults it to `.run/historian.db` so trends survive a runtime restart during demos.
- `rusqlite = "0.32"` with `features = ["bundled"]` added to the workspace (no system SQLite dep — cc compiles the included source).
- `TrendCanvas` rewritten for multi-tag overlay + axes + tooltip:
  - Props: `tags: string[]` (was single `tag`). Each entry gets a colour — first uses the configured `lineColor`, rest pull from a 6-colour palette.
  - Right-edge Y-axis with 5 numeric ticks; bottom-edge X-axis with 4 HH:MM:SS ticks (local time). 4×4 grid divisions.
  - Top-left legend with colour swatches when >1 series.
  - Mouse hover: vertical crosshair, dots on the nearest sample of each series, floating tooltip box with the hover timestamp and per-series values.
  - X domain now bounded by the configured window (instead of the data's own span), so axes don't jump when a tag is briefly empty.
- `SynopticObject.extra_tags?: string[]` (Rust + TS) holds the additional series for the trend object. ObjectProps gains an "ALTRI TAG (OVERLAY)" repeater with TagInput autocomplete + remove × + "+ Aggiungi tag" button.

### Added (MQTT write path + multi-waveform driver)
- `TopicMapping.publish_topic: Option<String>` (Rust + TS). When set, the tag registers on `TagWriteBus`; a write — via `PUT /api/tags/:id`, an object's `on_press` script, a button, anywhere — is forwarded to the topic as a raw string payload (`true` / `42.5` / …). Subscribe and publish topics can be the same channel or different.
- `sws-plugin-mqtt::run(cfg, db, bus, cancel)`: new bus param. The session loop now `select!`s on cancel + write_rx + eventloop.poll, so an outbound write doesn't starve subscribe traffic and a long subscribe doesn't starve writes. `stringify(TagValue)` produces the payload.
- `SourceSupervisor` passes the bus to the MQTT plugin too (was Modbus-only before).
- ConfigView Protocolli tab: new "Topic out (publish, opz.)" column in `MqttSourceCard`, optional per row.
- `scripts/demo-driver.py` — multi-tag, multi-waveform driver. Each `--gen` is a `key=value` list with at least `tag=…`; `wave=` picks among `sin` / `cos` / `tri` / `saw` / `square` (with `duty`) / `random` / `step` (with `step_low` / `step_high` / `step_at`). All generators share one asyncio loop. Re-auths on 401.
- `scripts/dev.sh` pre-seed: added demo tags `cosine`, `triangle`, `ramp`, `noise` so the multi-waveform demo runs against the default project.yaml.

### Added (editor UX — undo/redo, multi-select, clipboard, align)
- Zustand store rewrite around three new concepts:
  - `past[]` / `future[]` snapshot stacks (deep-cloned `pages` snapshots, capped at 50). Every page-mutating action (`addObject`, `updateObject`, `addPage`, `deletePage`, …) pushes a snapshot before mutating, and clears `future`. `undo()` / `redo()` swap snapshots and clear the selection.
  - `selectedObjectIds: string[]` alongside the legacy `selectedObjectId`. New actions: `toggleSelection`, `selectMany`, `clearSelection`, `deleteSelection`, `duplicateSelection`. The properties panel auto-switches into a multi-select view at length > 1.
  - `clipboard: SynopticObject[]` cut/paste buffer with `copySelection` / `pasteClipboard`. Paste offsets +20 px and appends a "(incolla)" suffix to copied names.
- Multi-select on canvas: shift-click an object to toggle it into the selection (regular click still replaces). Drag is suppressed during a shift-click so the position doesn't snap to the cursor.
- Document-level keyboard shortcuts (registered via `useEffect` in EditorShell, ignored while typing in INPUT/TEXTAREA/SELECT):
  - `Ctrl/Cmd-Z` undo, `Ctrl/Cmd-Y` or `Ctrl/Cmd-Shift-Z` redo
  - `Ctrl/Cmd-C` copy, `Ctrl/Cmd-V` paste, `Ctrl/Cmd-D` duplicate
  - `Backspace` / `Delete` delete the selection
- New `MultiSelectionProps` panel (right sidebar when N > 1): alignment toolbar (left / center-x / right, top / middle-y / bottom), distribute (horizontal / vertical, ≥3 objects), plus inline Duplicate and Delete buttons.
- `alignSelection(mode: AlignMode)` action computes per-object deltas from the selection bounding box and applies them in a single history step; line endpoints (`x2`, `y2`) move along with the anchor.
- `LeftPanel` gains an "Annulla / Rifai" bar above the Save button, with buttons that auto-disable when the corresponding stack is empty.

### Added (auth polish: TTL, refresh, rate limit, RBAC roles)
- `sws-auth::Role` enum (`Viewer` < `Operator` < `Supervisor` < `Admin`, derive `Ord`) so middleware can `if user.role < required` cheaply.
- `AuthState::new(accounts, ttl, rate_limit, rate_window)`: multiple accounts seeded at startup, each with its own role. Login returns `LoginOk { token, username, role, expires_at_ms }`. `validate()` checks expiry AND slides the TTL on every hit (rolling refresh).
- Login rate limit per username: `record_failure` accumulates within `rate_window`; after `rate_limit` consecutive failures `login` returns `LoginError::RateLimited` (HTTP 429) until the window expires. Successful login resets the counter.
- `sws-runtime` reads `SWS_ADMIN_PASSWORD` (required), `SWS_SUPERVISOR_PASSWORD`, `SWS_OPERATOR_PASSWORD`, `SWS_VIEWER_PASSWORD` (optional). Tunables: `SWS_SESSION_TTL_SECS` (default 28800 = 8 h), `SWS_LOGIN_RATE_LIMIT` (5), `SWS_LOGIN_RATE_WINDOW_SECS` (60).
- `sws-web` router split into three role tiers, all behind `require_auth`:
  - **read** (Viewer+): `GET /api/tags`, `GET /api/alarms`, `GET /api/history/:tag`, `GET /api/project`, `GET /api/synoptics/*`, both WS streams, `whoami`/`logout`.
  - **operator** (Operator+): `PUT /api/tags/:id`, `POST /api/alarms/:id/ack`, `POST /api/script/exec`, `PUT /api/synoptics/:name`.
  - **admin** (Admin only): `PUT /api/project/{tags,sources,alarms}` (schema edits).
- `AuthUser` extension now carries `{username, role}`. `whoami` echoes the role; `LoginScreen` stores it, `api.client.ts` types it strictly.
- Editor header shows the current role as a small coloured badge (red Admin → blue Operator → grey Viewer); `localStorage` persists username+role so the badge survives reloads.
- `LoginScreen` distinguishes 401 (bad creds) from 429 (rate-limited) and shows different messages.
- `scripts/dev.sh` pre-seeds passwords for all four roles (`admin/supervisor/operator/viewer`) for local testing.

### Added (symbol library starter)
- New `symbol` SynopticObject type that renders one of five built-in SCADA symbols: **pump**, **valve**, **motor**, **tank**, **fan**.
- Library lives in `sws-editor/src/symbols/library.tsx`. Each entry exports a render function `(state, off, on, alarm) → JSX` drawing inside a 100×100 viewBox; the canvas scales to the object's width × height.
- State resolution: `alarm_tag` truthy → `alarm`, else `state_tag` truthy → `on`, else `off`. Per-object colour overrides (`state_off_color`, `state_on_color`, `state_alarm_color`) default to grey / green / red.
- Fan symbol uses a CSS `@keyframes sws-fan-spin` (registered in `index.html`) to rotate the rotor when in the `on` state.
- ObjectProps gains a "Simbolo" select, two TagInputs for state/alarm bindings, and three colour pickers for state overrides.
- LeftPanel palette adds a "+ Simbolo" button.
- Rust `SynopticObject` mirrors the new fields (`symbol_id`, `state_tag`, `alarm_tag`, `state_*_color`) so YAML save/reload preserves them.

### Added (reusable Python functions + expanded symbol library)

Object event handlers used to carry inline Python — same write-pump-on
snippet got copy-pasted into every button. They now reference a
project-level `FunctionDef` that lives in `project.yaml`. The symbol
palette doubles to 14 entries.

Project-level Python functions
- `sws-core::FunctionDef { id, name, description?, code, params: [{name, default?}] }`
  added to `Project.functions: Vec<FunctionDef>` with `#[serde(default)]`.
  Re-exported from `sws-core::lib`. Code body is capped at 64 KB.
- `sws-pyscript::Engine::execute_with_args(code, args)` extends the
  Python harness with a `__sws_args__` dict merged into globals. Names
  inside `args` become plain Python locals; values are coerced to
  bool/int/float/str. `execute(code)` now delegates with an empty dict.
- `sws-web` gains `AppState.functions: Arc<RwLock<HashMap<String, FunctionDef>>>`
  hot-swapped on every `PUT /api/project/functions` (Admin), so a rename
  takes effect for the next call without a restart. Validates param
  names against a Python identifier regex + keyword denylist; rejects
  duplicate function names; honours the 64 KB code cap (413 on overflow).
- `POST /api/script/run/:name` (Operator) accepts `{ args?: {...} }`,
  looks the function body up by name in the registry, then runs it
  through `Engine::execute_with_args`. Returns the same shape as
  `/api/script/exec`. 404 if the name is gone; otherwise 200 with
  stdout/stderr/sandboxed flags.

Object semantics (breaking — accepted, the PoC has few stored handlers)
- `SynopticObject.on_press` / `on_release` renamed to `on_press_fn` /
  `on_release_fn` to avoid silent inline-code → function-name
  reinterpretation. New companion fields `on_press_args` /
  `on_release_args` carry the per-binding parameter overrides.
- `SvgCanvas` dispatcher signature changed: `onScript(fn, args)`
  instead of `onScript(code)`.
- `RuntimeView.handleScript` now calls `api.runFunction(fn, args)`.
  `api.execScript(code)` stays available for ad-hoc tooling.

Editor UX
- Zustand store learns `selectedFunctionId` (mutually exclusive with
  object selection) plus `addFunction` / `duplicateFunction` /
  `updateFunction` / `renameFunction` / `deleteFunction` /
  `selectFunction`. `updateProjectFunctions(list)` replaces the
  whole list (used by the GET /api/project bootstrap).
- New `LeftPanel.FunctionsSection` accordion: lists every function,
  with inline rename (✎ / double-click), duplicate (⧉), and delete
  (×). Click a row to open its `FunctionEditor` in the right panel.
- `EditorShell.FunctionEditor` lets you edit name, description,
  params (name + default), and the Python body in a 220-line monospace
  textarea. "Salva funzioni" button calls `api.updateFunctions(...)`.
- `EditorShell.EventFunctionPicker` replaces the old EVENTI textareas
  on each object: two `<select>` dropdowns populated from
  `project.functions`, followed by an auto-generated form with one
  input per declared parameter, bound to `on_press_args` /
  `on_release_args`. Selecting a different function clears the
  arg overrides.

Symbol library
- Six new builtins (`compressor`, `level_sensor`, `flow_meter`,
  `pressure_indicator`, `breaker`, `mixer`) in
  `sws-editor/src/symbols/library.tsx`, each in 100×100 viewBox with
  the same `(state, off, on, alarm) → JSX` contract as the previous
  five.
- New `SymbolKind = "builtin" | "vendored"` flag. Vendored entries
  carry a `path` under `/symbols/` and are rendered via
  `<image href>` + a coloured 14×14 status badge in the top-right
  corner (so we don't tint the SVG itself — keeps CC-BY derivative-
  work concerns out of the picture).
- `sws-editor/public/symbols/` ships four CC0 1.0 SVGs authored for
  the project (`heat_exchanger`, `separator`, `reactor`, `filter`)
  plus `ATTRIBUTION.md` documenting the licence chain and the
  procedure for adding more (e.g. from Wikimedia Commons P&ID).

### Added (BL-003 — CodeMirror Python editor for FunctionDef bodies)
- `sws-editor` gains `PythonEditor` (`src/components/PythonEditor.tsx`): a CodeMirror 6 wrap with `@codemirror/lang-python`, one-dark theme, line numbers, history/undo, indent-with-tab, bracket matching, and a stable `forwardRef` API exposing `insertAtCursor(text)` + `focus()`. External `value` syncs are dispatched only on diff so the cursor doesn't jump while the user is typing.
- `src/editor/FunctionEditor.tsx` is a brand-new full-screen pane: header (name chip + "● modifiche non salvate" indicator + "Inserisci template…" snippet dropdown + Save + Close), 280 px left aside (name / description / params list), and a flex-1 right column hosting `PythonEditor`. Six built-in snippets: increment, toggle, conditional, reset_many, diagnostic, function skeleton.
- Dirty tracking via `JSON.stringify(fn)` snapshot at last persist; Save is disabled while clean. Errors from the server PUT surface in a red banner.
- `EditorShell` now branches at the top: when `selectedFunctionId` is set, it renders `<LeftPanel/> + <FunctionEditor/>` full-width, hiding the canvas + properties panel until the user clicks Close. The old inline FunctionEditor (~125 lines of textarea + sub-form) was removed.
- Bundle grew to 738 KB / 232 KB gzipped — accepted because the language pack + history extensions live in the same chunk.

### Added (BL-002 — MQTT auth, TLS, last-will, QoS, password masking)
- `MqttConfig` (sws-core) gains `username`, `password`, `password_env`, `keep_alive_secs`, `clean_session`, `qos`, `tls: MqttTlsConfig`, and `last_will: MqttLastWill`. `TopicMapping` gains a per-topic `qos` override. All fields are `#[serde(default, skip_serializing_if = …)]` so existing `project.yaml` files load unchanged.
- New types `MqttTlsConfig { enabled, ca_cert_path, insecure_skip_verify }` and `MqttLastWill { topic, payload, qos, retain }` exported from `sws-core::lib`.
- `sws-plugin-mqtt::run_session` resolves credentials in order `password_env > password > none`, calls `set_keep_alive` / `set_clean_session` / `set_credentials` / `set_last_will` on the `MqttOptions`, and wires `Transport::Tls(TlsConfiguration::Simple { ca, alpn: None, client_auth: None })` when TLS is enabled. **rumqttc 0.24 has no `Native` variant**, so a CA cert path is mandatory when TLS is on; otherwise the session refuses to start with an explanatory anyhow error. Subscribe loop and the publish-from-write path both honour the resolved QoS (per-topic > source-level fallback > AtMostOnce).
- `sws-web` masks MQTT passwords on `GET /api/project`: every `MqttSource.password` is replaced by the literal sentinel `"********"` before serialising. On `PUT /api/project/sources`, the runtime loads the previous project from disk and, for each incoming MQTT source whose password equals the sentinel, copies the old hash back in. Empty string clears the password; any other value overwrites.
- `MqttSourceCard` (ConfigView → Protocolli) reworked with collapsible sections: Autenticazione (username + password input with "lascia ******** per non modificare" hint + `password_env`), Connessione (keep_alive_secs / clean_session / default QoS), TLS (enabled + ca_cert_path + insecure_skip_verify with warning), Last Will (topic / payload / qos / retain). Topic table grows a per-row QoS column.

### Added (BL-001 — persistent multi-user store with admin CRUD)
- `sws-auth` rewritten on top of a persistent `UserStore` backed by `users.yaml` in the project directory. New constructor `AuthState::new_persistent(store_path, seed, ttl, rate_limit, rate_window)` loads the YAML if present, otherwise seeds from the existing env-var path and writes the file. Admin accounts seeded from env start with `must_change_password: false`; manually-created accounts default to `true`.
- New types: `UserSummary { username, role, must_change_password, created_at_ms, updated_at_ms }`, `UserPatch { role?, password?, must_change_password? }`, `CreateUser { username, password, role, must_change_password (default true) }`, `ChangePassword { old_password, new_password }`, `SessionInfo { username, role, must_change_password }`. `LoginOk` extended with `must_change_password`.
- New CRUD methods on `AuthState`: `list_users` / `create_user` / `update_user` / `delete_user` / `change_password`. Last-admin protection: `delete_user` and `update_user` (when demoting) refuse if the target is the only `Admin`. Self-delete is rejected at the router level with `cannot_delete_self`. `change_password` verifies the old hash and clears `must_change_password`. Every mutation persists via `flush_locked`.
- `sws-web` router gains:
  - `GET /api/auth/users`, `POST /api/auth/users`, `PUT /api/auth/users/:username`, `DELETE /api/auth/users/:username` — Admin only.
  - `POST /api/auth/change-password` — any authenticated session; bypasses the blocking middleware.
  - `whoami` now echoes `must_change_password`.
- New `require_password_changed` middleware in front of every non-self-service route: returns HTTP 403 with `{ "error": "password_change_required", "detail": "..." }` whenever the session user still has the flag.
- `AuthState::new_persistent` is now the only constructor `sws-runtime/main.rs` uses (the in-memory `AuthState::new` is retained for unit tests).
- `sws-editor`:
  - `api.client.ts` extended with `changePassword`, `listUsers`, `createUser`, `updateUser`, `deleteUser`, plus a `PasswordChangeRequiredError` typed error that the request helper raises whenever it sees a 403 with the sentinel envelope. `login` / `whoami` response types include `must_change_password`.
  - Zustand store: `mustChangePassword` flag persisted in `localStorage` alongside token+role; `setAuth(token, user, role, mustChangePassword?)` and `setMustChangePassword(flag)`. `clearAuth` resets it.
  - New `ChangePasswordScreen` component (`src/components/ChangePasswordScreen.tsx`): three-field form (old / new / confirm) with client-side checks (length, match, must differ). Renders in place of the App shell while `mustChangePassword === true`.
  - New "Utenti" tab in ConfigView (Admin only): per-row role select, "forza cambio pwd" toggle, inline reset-password field + button, "Elimina" with self-delete guard, plus a "+ Nuovo utente" form (username / password / role / "forza cambio al primo accesso" checkbox).
- Test coverage: 11 unit tests in `sws-auth` (incl. `create_update_delete_user`, `cant_delete_last_admin`, `cant_demote_last_admin`, `change_password_clears_flag`), 22 in the whole workspace.

### Added (PX30 deploy artefacts)
- `compose.yaml` at the repo root orchestrating `sws-runtime` + `sws-editor` containers with sensible defaults: mounts `.run/{config,project,db}` from the host, surfaces all auth/TTL/rate-limit/Python-timeout/historian env knobs, healthchecks both services, requires `SWS_ADMIN_PASSWORD` to be set in the environment.
- `scripts/build-images.sh` — multi-arch (`linux/amd64,linux/arm64`) build via `docker buildx`. `--push` to a registry or default to OCI archives under `.run/oci/` for offline transfer to the SBC. Documents the one-time `tonistiigi/binfmt` + `buildx create` setup.
- `docs/DEPLOY_PX30.md` — end-to-end recipe for getting SWS on a Rockchip PX30 (or any ARM64 SBC): prerequisites, image build, load on the board, seed project.yaml with a Modbus source, login, plus an optional systemd unit. Lists the known PX30-specific gotchas (missing `/usr/bin/python` on Debian Bookworm, clock skew on coldstart, fussy PLC source ports, OOM under heavy debug logging, SD card wear with historian persistence).

### Added (cross-cutting object properties)
- `SynopticObject` gains `z_index`, `visible`, `visible_tag`, `on_press`, `on_release` in both Rust (`sws-web/synoptic.rs`) and TypeScript (`sws-editor/src/types`). Trend fields (`window_s`, `y_min`, `y_max`, `line_color`) added to the Rust struct too — they were dropped on save before.
- `sws-editor/src/canvas/SvgCanvas.tsx`: objects sorted by `z_index` (ties by array order) before SVG render, so layering is declarative. `isObjectVisible()` evaluates `visible_tag` (truthy coercion for bool/number/string) and falls back to the static `visible !== false`. In runtime mode, hidden objects are not rendered; in edit mode they're shown at 35% opacity so the designer can still select them.
- `sws-editor` ObjectProps: every object now gets a "LIVELLO E VISIBILITÀ" section (z-index numeric input plus ▲/▼ buttons, "Visibile" checkbox, "Tag visibilità" with TagInput autocomplete) and an "EVENTI (PYTHON)" section (textareas for `on_press` and `on_release`).
- `sws-pyscript`: PyO3-backed `Engine` — `execute(code)` runs Python on `tokio::task::spawn_blocking`, exposing a `tags` global with `read(id) -> bool|int|float|str|None` and `write(id, value)` that routes via `TagWriteBus` (NoWriter → falls back to direct `TagDb` set, same as the HTTP write path). Errors surface as `Err(String)`.
- `sws-web`: `POST /api/script/exec` with `{code: string}` returning `{ok, error?}`. Engine wired into `AppState` from `sws-runtime/main.rs`.
- `sws-editor`: `api.execScript(code)`, and `RuntimeView` passes an `onScript` callback to `SvgCanvas`. The canvas dispatches `onMouseDown → on_press`, `onMouseUp → on_release` (view mode only — edit mode keeps drag/select behaviour).
- `docs/OPEN_QUESTIONS.md` Q1: partially decided. PyO3 + the API surface are live; **sandboxing remains open** (no RestrictedPython, no timeouts, no stdout capture). Acceptable while auth is missing and projects are maintainer-only.
