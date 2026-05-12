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
