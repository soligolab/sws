# SWS — Current Status

> This file is the **session-to-session memory** for Claude Code. Update it at the end of every session before stopping work. Read it at the start of every session before touching code.

**Last session**: 2026-05-12 (script sandbox + hot-reload sorgenti — supervisor con cancellation)
**Current phase**: Phase 2 quasi conclusa. Riprende domani con #3 historian polish.
**Last commit**: feat: script sandbox — timeout, stdout/stderr, optional RestrictedPython

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
- **TagInput component** (`sws-editor/src/components/TagInput.tsx`): `<input list>` + `<datalist>` con autocomplete dei tag definiti nel progetto. Usato in `ObjectProps` (tutti i campi Tag), `TableRowsEditor` (righe tabella), `ModbusSourceCard` (mapping registri), `MqttSourceCard` (mapping topic).
- **TagDef.data_type**: nuovo campo `"bool" | "int" | "float" | "string"` (default `"float"`) in Rust `TagDef` e TS `TagDef`. `populate_tags()` semina il `TagValue` iniziale corretto. ConfigView Variabili: nuova colonna "Tipo" con select.
- **sws-plugin-mqtt**: subscribe loop con `rumqttc::AsyncClient`, exact-topic match, riconnessione 5 s, decoding payload euristico (bool/int/float/string) o via `json_path` dot-separated.
- **SourceDef::Mqtt** variant in `sws-core` con `MqttConfig { id, host, port (def 1883), client_id, topics }` e `TopicMapping { tag, topic, json_path? }`. `sws-runtime/main.rs` spawn task MQTT per ogni `mqtt` source.
- **MqttSourceCard** in ConfigView (host/port/client_id + tabella topic↔tag con TagInput e JSON path opz.). `LeftPanel` SourcesSection renderizza anche MQTT. Pulsante "+ Aggiungi MQTT" attivo.
- **TagWriteBus** (`sws-core`): registry mpsc tag→plugin. `PUT /api/tags/:id` instrada al plugin owner; fallback diretto a TagDb per tag virtuali. Modbus plugin scrive `write_single_register` con scala inversa + clamp u16. Test unitari coprono routing e NoWriter.
- **Alarm engine** (`sws-core/alarm.rs`): `AlarmDef` + `AlarmCondition::{Above, Below, BoolEquals}` + `AlarmSeverity` + `AlarmDb` con broadcast. Evaluator task in `sws-runtime` consuma il broadcast TagDb e re-valuta gli alarm. `GET /api/alarms`, `POST /api/alarms/:id/ack`, `WS /ws/alarms`. Configurato via `project.yaml`: campo `alarms: [...]` (backwards compatible).
- **AlarmBanner live**: hook `useAlarmStream` (snapshot HTTP + WS), badge active/unack, tinta per severità, messaggio più recente, pulsante ACK inline.
- **Hot-reload tag**: `PUT /api/project/tags` esegue diff con `TagDb` corrente — seed nuovi, evict orfani, valori esistenti preservati. Niente restart per CRUD variabili.
- **Hot-reload alarm**: `PUT /api/project/alarms` invoca `AlarmDb::load` completo dopo il persist. In-flight active alarms si resettano; il prossimo update li rivaluta.
- **ConfigView tab "Allarmi"**: CRUD `AlarmDef` con TagInput autocomplete, select condizione (above/below/bool_equals), soglia o bool, severità, messaggio, e colonna stato live (ON / ACK / —).
- **LICENSE**: file AGPL-3.0 completo già presente in repo, Q7 in OPEN_QUESTIONS marcato come deciso.
- **Historian** (`sws-historian`): `Historian` ring-buffer in-memory (5000 samples × tag), `record()`/`query(from,to)`/`spawn_recorder(tag_db)`. SQLite stays a stub. Unit-tested.
- **GET /api/history/:tag**: query string `from`/`to`/`limit`; ritorna `Vec<Sample>` (ts_ms + value + quality).
- **Trend object** nell'editor: `<foreignObject>` con `<canvas>` 2D. Poll ogni 2 s, autofit Y, badge valore corrente, edit-mode placeholder statico per drag senza fetch. Property panel: tag, window_s, y_min/y_max (entrambi 0 → autofit), line_color.
- **Z-index / visibility cross-cutting**: ogni `SynopticObject` ha `z_index` (sort prima del render, ties per ordine array), `visible` statico e `visible_tag` (override truthy via tag). UI nella properties panel con pulsanti ▲/▼ per bump del z-index e TagInput per il binding visibilità.
- **Event handler Python**: campi `on_press` e `on_release` su ogni oggetto. `sws-pyscript::Engine` con PyO3 0.23, esegue gli script in `spawn_blocking`. Bindings: `tags.read(id) -> bool|int|float|str|None`, `tags.write(id, value)` (routing via TagWriteBus → fallback TagDb). `POST /api/script/exec` dal `RuntimeView` su mousedown/mouseup. **Sandboxing rinviato** (Q1 OPEN_QUESTIONS).
- **Bug fix**: Rust `SynopticObject` non aveva `window_s/y_min/y_max/line_color` per il trend — venivano persi al salvataggio. Aggiunti.
- **Auth skeleton** (`sws-auth` + `sws-web`): Argon2id hash/verify, in-memory session map `token → username`, `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/whoami`. Middleware `require_auth` su tutti gli `/api/*` (eccetto login) e su `/ws/*` (token via `?token=...` per il WS upgrade). Admin credenziali seeded da `SWS_ADMIN_USER` / `SWS_ADMIN_PASSWORD` env (runtime rifiuta lo start con password vuota).
- **Frontend auth**: store `authToken/authUser` con persistenza `localStorage`, `LoginScreen` mostrato senza token, `Authorization: Bearer` automatico su tutte le richieste, WS riapre con nuovo `?token=...` se cambia il token (login/logout), header con "Esci".
- **dev.sh**: esporta `PYO3_PYTHON=python3` (Debian non ha `/usr/bin/python` di default → pyo3-build-config falliva) e `SWS_ADMIN_USER=admin` / `SWS_ADMIN_PASSWORD=admin` per dev locale.
- **Text object esteso**: campo `text` statico, `font_size`, `font_family`, `font_weight` (string o number), `font_style`, `text_anchor` (start/middle/end), `color`. Precedenza render: tag+format vince sul testo statico. UI in ObjectProps con select per peso/stile/anchor + color picker.
- **Campo `name` su ogni oggetto**: alias human-friendly distinto dall'id auto-generato. Mostrato nella nuova `ObjectsSection` del LeftPanel.
- **ObjectsSection (LeftPanel)**: lista oggetti pagina corrente con click per selezionare, ✎/doubleclick per rinominare inline, ⧉ per duplicare (clone con `(copia)`, offset +20px, selezionato), × per eliminare.
- **Bug fix**: il vecchio rendering text usava `stroke_width` come fontSize (misuso storico) — ora usa `font_size` con default 14. Aggiunti i campi mancanti al Rust `SynopticObject` per sopravvivere al round-trip YAML.

## Next session should

Pick one of these as the next focused work block (each fits 3-4 hours):

> Sessione interrotta a fine #2. Si riprende domani da #3 in questo ordine.

1. **Historian polish**: persistenza su SQLite (`sws-historian::sqlite`), decimazione per range lunghi, axis labels e tooltip nel TrendCanvas.
2. **MQTT write path + demo-driver multi-waveform**: publish on tag-write tramite TagWriteBus; estendere `demo-sine.py` a multiple forme d'onda.
3. **Editor UX polish**: undo/redo, multi-select, copy/paste, allineamento oggetti.
4. **Auth polish**: session TTL, refresh, rate limit, RBAC ruoli, cookie httponly.
5. **Symbol library starter**: cartella `sws-symbols/`, oggetto `symbol` che referenzia SVG di pompe/valvole/motori con stile guidato da tag.
6. **Demo PX30**: container ARM64, deploy effettivo su Rockchip, gotcha hardware/network documentati.

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
