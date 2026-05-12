# SWS — Current Status

> This file is the **session-to-session memory** for Claude Code. Update it at the end of every session before stopping work. Read it at the start of every session before touching code.

**Last session**: 2026-05-12 (Phase 1 — object palette completata; in attesa: tag dropdown, tipo variabile, MQTT)
**Current phase**: Phase 1 in progress
**Last commit**: feat(types): extend SynopticObject and Rust struct with new SCADA object fields

---

## What's working

- Monorepo scaffold (`sws-runtime/` Rust workspace + `sws-editor/` Vite+React)
- All Phase 1 community files (README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, `.gitignore`, ADR 0001)
- GitHub Actions CI (DCO, lint, build, test, audit, SBOM, multi-arch container build)
- GitLab CI mirror pipeline
- Rust workspace: `cargo check --workspace` passes
  - 10 library crates (`sws-core`, `sws-web`, `sws-auth`, `sws-historian`, `sws-audit`, `sws-pyscript`, `sws-plugin-api`, `sws-plugin-modbus`, `sws-plugin-opcua`, `sws-plugin-mqtt`)
  - Bin crate `sws-runtime` with working `/health`, `/metrics` (placeholder), self-signed TLS via rcgen, HTTPS on `0.0.0.0:8443`, graceful shutdown
- Rust Dockerfile (multi-stage, debian-bookworm-slim, non-root user, healthcheck)
- TypeScript editor: `pnpm install`, `pnpm type-check`, `pnpm build` all pass
  - App shell (header, alarm banner, mode toggle), `EditorShell`, `RuntimeView`, `SvgCanvas`, Zustand store, tag stream hook stub, i18n English baseline
- Editor Dockerfile (multi-stage, nginx:alpine serving SPA + reverse-proxying `/api` and `/ws` to runtime)
- `.claude/settings.json` configured with project-scoped permissions (`acceptEdits` default, allow list for cargo/pnpm/git/filesystem, ask for push/publish, deny for secrets/sudo/ssh)
- **sws-core tag engine**: `TagId`, `TagValue` (Bool/Int/Float/Str), `TagQuality`, `TagState`, `TagUpdate`, `TagDb` (Arc<RwLock<HashMap>> + tokio broadcast). `cargo test -p sws-core` passes (2 tests).
- **sws-web router**: `GET /api/tags` (JSON snapshot), `GET /api/tags/:id` (single tag or 404), `GET /ws/tags` (WebSocket stream — snapshot on connect + live updates). `TagDb` passed as Axum state.
- **sws-runtime**: creates `Arc<TagDb>`, loads `project.yaml`, hands DB to `sws_web::router::build()`.
- **sws-core project loader**: `Project::load(dir)` parses `project.yaml`; `populate_tags()` seeds TagDb with `Float(0.0)/Uncertain` for every defined tag. Missing file → warning, empty DB.
- **sws-core project format**: `sources` list with `kind: modbus_tcp` entries; each maps holding registers to tag IDs via `address` + `scale`.
- **sws-plugin-modbus**: `run(cfg, db)` polls holding registers at `poll_interval_ms`, writes `Float(raw * scale) / Good` into TagDb, marks tags `Bad` on error, reconnects after 5 s.
- **sws-core TagValue**: `#[serde(untagged)]` — serializes as native JSON (42.5, true, "hello") instead of `{"Float": 42.5}`.
- **sws-editor IDE (complete object palette)**:
  - Objects: rect, ellipse, line, text, button (write tag), navbutton (page nav), image (stub)
  - Drag-to-move all objects; lines preserve endpoint delta during drag
  - Delete key / button; Backspace supported too
  - Properties panel: per-type fields (fill, stroke, stroke_width, x2/y2 for line, target_page for navbutton, label/write_value for button)
  - Page properties when nothing selected: name, background color
- **Canvas grid**: SVG pattern grid with configurable size (Off/5/10/20/40 px), snap-to-grid toggle
- **LeftPanel (project tree sidebar)**:
  - Pages section: click to switch, add/delete
  - Objects palette: all object types with add buttons
  - Tags section: shows all defined tags with quality dot and live value
  - Sources section: shows Modbus TCP connections and register mappings (read-only)
  - Grid/snap settings, Save button
- **sws-web `GET /api/project`**: returns full project JSON (meta + tags + sources)
- **RuntimeView page nav tabs**: operator tab bar when multiple pages exist, click to switch
- **Navbutton**: navigates to target page in view mode via `onNavigate` callback
- **Page background**: configurable per page, applied to canvas SVG background

- **ConfigView** (mode "Configurazione" in header):
  - Tab *Variabili*: CRUD tabella tag (ID + descrizione), valore live se runtime attivo, PUT /api/project/tags
  - Tab *Protocolli*: CRUD sorgenti Modbus TCP, ogni sorgente mostra host/port/unit_id/poll_interval con mappatura registri inline (tag → indirizzo → scala × float), PUT /api/project/sources
  - Pulsanti OPC-UA e MQTT presenti ma disabilitati (prossimamente)
- **sws-web**: `PUT /api/project/tags` e `PUT /api/project/sources` — leggono project.yaml, aggiornano il campo, riscrivono; creano la directory se mancante
- **store**: `updateProjectTags`, `updateProjectSources` per aggiornamento ottimistico dopo salvataggio
- **App.tsx**: terza modalità "Configurazione" nel header
- **sws-editor: object palette estesa** — 7 nuovi tipi SCADA ispirati ad atvise:
  - `gauge`: arco 270° con needle SVG, soglie cromatiche (warn/alarm), tick marks, qualità dot
  - `slider`: `<input type="range">` in view mode, SVG statico in edit mode
  - `checkbox`: div + checkmark SVG in view mode, box SVG in edit mode; on/off value configurabili
  - `radio`: radio HTML in view mode, cerchi SVG in edit mode; lista opzioni editabile
  - `led`: cerchi concentrici con glow ring on/off, colori configurabili
  - `progress_bar`: rettangolo riempito con marcatori soglia, valore opzionale
  - `table`: righe dati con tag/etichetta/formato editabili, zebra-shading, qualità dot
- **LeftPanel**: tutti i 7 nuovi tipi in palette
- **EditorShell**: defaults per ogni tipo in `handleAddObject`; `ObjectProps` esteso con sezioni per-tipo; `RadioOptionsEditor` e `TableRowsEditor` sub-component

## What's in progress

> **HANDOFF NOTE — 2026-05-12**
> Sessione interrotta mentre si stava per implementare tre funzionalità nuove.
> Il codice è pulito e committato. La prossima sessione riprende da zero con questo blocco:

### Tre feature da implementare (riprendi da qui)

#### 1. Tag dropdown nell'editor degli oggetti
In `sws-editor/src/editor/EditorShell.tsx`, nel componente `ObjectProps`,
i campi "Tag" sono attualmente `<input type="text">`. Sostituirli con un ibrido
`<input list="taglist"> + <datalist>` che suggerisca i tag definiti nel progetto.
I tag vengono da `useAppStore(s => s.project?.tags ?? [])`.
Farlo in un helper `TagInput` riusabile (import da `@/store` e uso in `ObjectProps`).
Anche nel `ModbusSourceCard` (registro → tag) e nel futuro `MqttTopicCard`.

#### 2. Tipo variabile (TagDef)
Aggiungere un campo `data_type: "bool" | "int" | "float" | "string"` a `TagDef`:
- **Rust** `sws-runtime/crates/sws-core/src/project.rs`: aggiungere `#[serde(default = "default_data_type")] pub data_type: String` (default `"float"`)
- Nella `populate_tags()`: usare `data_type` per scegliere il `TagValue` iniziale corretto (Bool/Int/Float/Str)
- **TypeScript** `sws-editor/src/types/index.ts`: `TagDef { id, description, data_type?: "bool"|"int"|"float"|"string" }`
- **ConfigView** `sws-editor/src/config/ConfigView.tsx` `TagsTab`: aggiungere colonna "Tipo" con `<select>` (Bool/Int/Float/Stringa) accanto a ID e Descrizione
- **PUT /api/project/tags** (`router.rs`): già generico, nessuna modifica server necessaria

#### 3. Plugin MQTT
**Backend** (`sws-runtime/crates/sws-plugin-mqtt/src/lib.rs`):
- Struttura config già scaffoldata, dipendenze `rumqttc = "0.24"` già in workspace
- Implementare `pub async fn run(cfg: MqttConfig, db: Arc<TagDb>)` con `rumqttc::AsyncClient`
- Config MQTT: `id, host, port (default 1883), client_id, topics: Vec<TopicMapping>`
- `TopicMapping { tag, topic, json_path? }` — se `json_path` è presente, parsare il payload JSON e estrarre il campo (es. `"temperature"` da `{"temperature": 42.5}`)
- Riconnessione automatica con backoff (come Modbus, già implementato lì come riferimento)
- Aggiungere `MqttConfig` e `MqttSource` a `sws-core/src/project.rs` (nuovo variant `SourceDef::Mqtt`)
- Aggiungere match arm `SourceDef::Mqtt(cfg)` in `sws-runtime/crates/sws-runtime/src/main.rs`

**Frontend** (`sws-editor/src/`):
- `types/index.ts`: aggiungere `MqttSource { kind: "mqtt", id, host, port, client_id, topics: TopicMapping[] }` e `TopicMapping { tag, topic, json_path? }` + aggiornare `SourceDef = ModbusTcpSource | MqttSource`
- `config/ConfigView.tsx`: aggiungere `MqttSourceCard` (simile a `ModbusSourceCard`) con host/port/client_id e tabella topic↔tag. Attivare il pulsante "Aggiungi MQTT" (era disabilitato).
- `LeftPanel.tsx` `SourcesSection`: aggiungere rendering per `kind === "mqtt"`

## Next session should (vecchia lista)

Pick one of these as the next focused work block (each fits 3-4 hours):

1. **Auth skeleton** in `sws-auth`:
   - Argon2id password hash/verify
   - Session token (UUID, stored in memory map)
   - Single admin user seeded from `SWS_ADMIN_PASSWORD` env var
2. **Alarm engine stub** in `sws-core`: alarm conditions on tags, alarm list in editor and runtime
3. **Historian stub**: ring-buffer in `sws-historian`, exposed as `GET /api/history/:tag?from=&to=`
4. **Hot-reload per nuovi tag**: dopo `PUT /api/project/tags`, seedare i nuovi tag nel TagDb senza restart

## Blockers / questions for the maintainer

- See `docs/OPEN_QUESTIONS.md` Q1 (Python embedding), Q2 (Sparkplug B), Q4 (state management) — all using defaults, revisit when their phase begins.

## Notes

- PyO3 was bumped from 0.21 (spec) to 0.23 because the system Python is 3.13 — recorded in CHANGELOG under `[Unreleased]`.
- `axum-server 0.6.0` was removed from the dependency list due to a hyper-util compatibility bug at the time of bootstrap; replaced with a direct `tokio-rustls + hyper-util` accept loop in `sws-runtime/src/main.rs`. Revisit if axum-server publishes a fix.
- `async-opcua` version corrected from spec's `0.12` (which doesn't exist on crates.io) to actual latest `0.18`.
- `pnpm` is installed in `~/.local/bin/pnpm` on the maintainer's machine (npm global prefix). The `.claude/settings.json` allow list covers both `pnpm *` and `~/.local/bin/pnpm *` to match either invocation.
- React 19 + Vite 6 + Vitest 3 + i18next 24 — all current stable as of bootstrap.
- `tsconfig.json` uses `skipLibCheck: true` because `react-i18next@15` ships with broken type declarations referencing nonexistent i18next exports. This is a known upstream issue; our own code remains strictly type-checked.
- `TagQuality` / `TagValue` in `sws-plugin-api` are `#[repr(C)]` FFI types (flat, f64-only). The types in `sws-core` are idiomatic Rust enums — separate concerns, no conflict.
