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

### Added (cross-cutting object properties)
- `SynopticObject` gains `z_index`, `visible`, `visible_tag`, `on_press`, `on_release` in both Rust (`sws-web/synoptic.rs`) and TypeScript (`sws-editor/src/types`). Trend fields (`window_s`, `y_min`, `y_max`, `line_color`) added to the Rust struct too — they were dropped on save before.
- `sws-editor/src/canvas/SvgCanvas.tsx`: objects sorted by `z_index` (ties by array order) before SVG render, so layering is declarative. `isObjectVisible()` evaluates `visible_tag` (truthy coercion for bool/number/string) and falls back to the static `visible !== false`. In runtime mode, hidden objects are not rendered; in edit mode they're shown at 35% opacity so the designer can still select them.
- `sws-editor` ObjectProps: every object now gets a "LIVELLO E VISIBILITÀ" section (z-index numeric input plus ▲/▼ buttons, "Visibile" checkbox, "Tag visibilità" with TagInput autocomplete) and an "EVENTI (PYTHON)" section (textareas for `on_press` and `on_release`).
- `sws-pyscript`: PyO3-backed `Engine` — `execute(code)` runs Python on `tokio::task::spawn_blocking`, exposing a `tags` global with `read(id) -> bool|int|float|str|None` and `write(id, value)` that routes via `TagWriteBus` (NoWriter → falls back to direct `TagDb` set, same as the HTTP write path). Errors surface as `Err(String)`.
- `sws-web`: `POST /api/script/exec` with `{code: string}` returning `{ok, error?}`. Engine wired into `AppState` from `sws-runtime/main.rs`.
- `sws-editor`: `api.execScript(code)`, and `RuntimeView` passes an `onScript` callback to `SvgCanvas`. The canvas dispatches `onMouseDown → on_press`, `onMouseUp → on_release` (view mode only — edit mode keeps drag/select behaviour).
- `docs/OPEN_QUESTIONS.md` Q1: partially decided. PyO3 + the API surface are live; **sandboxing remains open** (no RestrictedPython, no timeouts, no stdout capture). Acceptable while auth is missing and projects are maintainer-only.
