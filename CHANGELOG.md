# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [CalVer](https://calver.org/) (`YYYY.MM[.patch]`).

## [Unreleased]

### Added
- **Yocto cross-compile scaffolding for sws-runtime — WIP** (`scripts/yocto/yocto-linker.sh`, `scripts/yocto/build.sh`, `scripts/yocto/deploy.sh`, `deploy/yocto/sws-runtime.service`, `deploy/yocto/sws-runtime-launch.sh`, `sws-runtime/Cargo.toml`). Imported the test-kit pattern (`/home/ut1/GitPixsys/test-kit`): linker wrapper that calls `aarch64-pixsys-linux-gcc` of the Pixsys Yocto SDK with `--sysroot=...cortexa35-pixsys-linux` and `-mcpu=cortex-a35+crc+crypto -mbranch-protection=standard`, plus a `build.sh` that sources `environment-setup-cortexa35-pixsys-linux`, sets `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER` + `PYO3_CROSS_LIB_DIR` + `PYO3_CROSS_PYTHON_VERSION=3.12`, builds the SPA via `pnpm build` and finally `cargo build --target aarch64-unknown-linux-gnu --release -p sws-runtime`. Sysroot survey verified Python 3.12 + headers, sqlite3, openssl3, wayland-client, glibc 2.39 all present — and confirmed GTK4 + WebKitGTK6 are absent, so `sws-kiosk` is deliberately out of scope (browser remoto in LAN is the device-side UI for now). Workspace `[profile.release]` gets `lto = "thin"`, `strip = "symbols"`, `codegen-units = 1`, `opt-level = 3` to mirror test-kit's binary footprint. Systemd unit + launch wrapper deploy under `/opt/sws/` with first-install-only `runtime.env` to keep per-device password overrides outside redeploys. **Status**: scripts written, `deploy.sh` not yet chmod +x / syntax-checked; `docs/YOCTO_CROSSCOMPILE.md` not yet written; end-to-end build + device deploy not yet run. Resume from STATUS.md Traccia A.

- **`docs/TEST_SETUPS.md` + diagnostic load-failed logging in sws-kiosk** (`docs/TEST_SETUPS.md`, `STATUS.md`, `CLAUDE.md`, `sws-runtime/crates/sws-kiosk/src/main.rs`). New doc enumerates the three actual test environments — home Ubuntu desktop (the only place with a real GTK display), this headless dev server (browser tests from maintainer's PC over LAN), and the office Yocto devices (PX30/RK3399/RK3588) — and codifies that device addresses change per session, that the maintainer runs `ssh-copy-id`/`ssh-keygen -R` manually, and that the agent must ask before SSH-ing. `STATUS.md` handoff replaced with a layered diagnostic procedure (`/health` → root `200` → Firefox visual check → kiosk) so a "white window" can be attributed correctly instead of blamed on the cert (`--allow-insecure-tls` is already default `true` and wired to `TLSErrorsPolicy::Ignore`). `sws-kiosk` now also connects `load-failed` and `load-failed-with-tls-errors` signals and prints to stderr, so the next white-window event has a concrete error string to work from. Signal signatures verified against `webkit6` 0.6.1 source; workspace `cargo check` green. Kiosk crate build deferred — this dev server lacks `libgtk-4-dev` / `libwebkitgtk-6.0-dev` (tracked task A1).

- **Two new templates + standards refresh of the existing two — startup now opens the WelcomeScreen** (`examples/templates/opcua-demo/`, `examples/templates/grid-playground/`, `examples/templates/demo-items/*`, `examples/templates/casa-locale/*`, `scripts/dev.sh`).
  - New **`opcua-demo`** template (2 pages, 5 tags, 2 alarms): `OpcUaClient` source pointing at `opc.tcp://localhost:4840` with both `ns=1` simulated nodes (Temperature, Pressure) and `ns=2` Euromap-77 canonical nodes (CycleTime, MachineState, MachineReady). Page 1 = gauge × 2 + Trend with `extra_tags` + symbol pump bound to `sim.machine_ready`; Page 2 = NodeId/Tag/Value table with hint banners pointing at the 🔍 Sfoglia server / 🤖 Rileva Euromap buttons. SETUP.md ships next to the project covering simulator recipes (`node-opcua`, Prosys) and the Basic256Sha256 trust handshake gotcha.
  - New **`grid-playground`** template (2 pages, 6 tags, 1 alarm, 3 functions): one `grid` object 4×4 (760×600) with `grid_show_borders: true` whose `grid_cells` array exercises every supported feature — direct `child` of various types (rect, ellipse, text, gauge, led, symbol, button, slider, progress_bar, trend), one merge cell via `colspan: 2`, several cells with `sub` splits, and one cell with **4 levels of `sub` nesting** (cols → rows → cols → rows, leaves are rect/text/ellipse/led). Page 2 is a controls panel that writes `demo.fill_color` / `counter` to demonstrate per-binding `transition_duration_ms` and alarm triggering. No external sources — fully runnable offline.
  - **`demo-items`** + **`casa-locale`** refresh: explicit `width:` / `height:` on every page; navigation headers (nav buttons + title + subtitle) gathered into a `g_nav` (and `g_header` where header is distinct) **group** with `locked: true` so the operator can't drag them around by accident in editor mode; `transition_duration_ms` added to the bound gauge, symbol, and bindable rect/ellipse in `demo-items`. Both templates bumped to `version: 0.2.0`; demo-items `meta.name` corrected from `dev` to `demo-items`; template descriptions updated.
  - **`scripts/dev.sh` no longer seeds a default `dev` project** and no longer passes `--project` to the runtime. Both modes (`runtime`, `both`) now boot with `--projects-root` + `--templates-root` only; the runtime starts with no active project, the WelcomeScreen lists candidates from `$PROJECTS_ROOT` (empty on fresh clone) and the bundled templates from `$TEMPLATES_ROOT`. The legacy heredoc YAML fallback is retained inside a `: <<'LEGACY_FALLBACK_YAML'` block as documentation of the old shape but is no longer executed. Existing `.run/projects/dev/` removed locally.
  - Validation: workspace `cargo check` + `pnpm build` green; per-template smoke (`Project::load` + HTTP `GET /api/synoptics/:name` on every page) → 4/4 projects load (76 tags / 10 alarms / 5 functions cumulative), 13/13 pages return 200 with object counts {17, 8, 48, 21, 91, 47, 26, 59, 66, 15, 30, 5, 17}.

- **BL-005 complete — security policies, Euromap auto-detect, reverse browse** (`sws-plugin-opcua/src/lib.rs`, `sws-web/router.rs`, `sws-web/source_supervisor.rs`, `sws-web/projects.rs`, `sws-runtime/main.rs`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/api/client.ts`, `sws-editor/src/types/index.ts`, `docs/OPCUA_SETUP.md`) — closes the OPC-UA backlog entirely.
  - **BL-005c — Security policies > None**: `parse_security_policy()` maps the YAML string onto `opcua::crypto::SecurityPolicy` (None, Basic128Rsa15, Basic256, Basic256Sha256, Aes128Sha256RsaOaep, Aes256Sha256RsaPss). Unknowns fall back to None with a warning. Every non-None pairs with `MessageSecurityMode::SignAndEncrypt`. New `build_client_builder()` helper centralises `create_sample_keypair(true)` + `trust_server_certs(true)` + `pki_dir(path)`. Cert + key persist under `<project>/.opcua-pki/<source-id>/` so reconnects reuse the identity and each source has distinct credentials. `SourceSupervisor::set_pki_root()` is called from both the WelcomeScreen `open_project` flow and the legacy `--project` auto-open path. ConfigView `security_policy` dropdown enables every option (Basic256Sha256 marked "raccomandato").
  - **BL-005b — Euromap 77 / 83 auto-discovery**: new `detect_euromap()` walks the address space BFS (capped at 500 nodes / 4 levels under ObjectsFolder), matches Variable `browse_name` (case-insensitive) against an 11-entry dictionary covering EM77 IM (MachineState, ActiveErrors, CycleTime, InjectionTime, MeltTemperature, ClampingForce, ProductionActiveParts, ProductionActiveDefectiveParts) and EM83 TCU (TbcActualTemperature, TbcSetTemperature, TbcState). Returns `{ nodes_scanned, truncated, variables: [{spec, canonical_name, suggested_tag_suffix, description, node_id, …}] }`. New `POST /api/sources/opcua/detect-euromap` (Operator+) handler with masked-password sentinel resolution. ConfigView gains a "🤖 Rileva Euromap" button on `OpcUaSourceCard` → opens `OpcUaEuromapModal` (auto-scan on open, pre-selects every non-imported match, "Auto-crea tag SWS suggeriti" toggle that creates `<source-id>.<suffix>` tags in the same save).
  - **Reverse browse**: `browse_one_level()` accepts a `BrowseDir` parameter (`Forward` | `Inverse` | `Both`). `POST /api/sources/opcua/browse` accepts optional `direction` and `security_policy` fields. Forward stays the UI default; inverse/both are useful for inspector tooling.
  - Tests: `parse_security_policy_known_values`, `security_mode_pairs_none_with_none_and_else_signencrypt`, `euromap_dictionary_is_consistent` (no empty fields, no duplicate spec+suffix). `sws-plugin-opcua` 5 → 8; workspace **50 → 53**.
  - `docs/OPCUA_SETUP.md` status banner updated to "BL-005 complete"; new sections on security policies (mode table + cert handshake gotcha — most servers reject the cert on first connect and need an operator-side trust) and Euromap detection; deferred list trimmed to vendor-curated trust list, historical reads, and reverse-connect mode.

- **OPC-UA writes + server browse — BL-005 step 3+4** (`sws-plugin-opcua`, `sws-web/router.rs`, `sws-web/source_supervisor.rs`, `sws-editor/src/api/client.ts`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/types/index.ts`, `docs/OPCUA_SETUP.md`) — closes the operator-facing OPC-UA demo.
  - **Step 4 — Writes via TagWriteBus**: `sws-plugin-opcua::run` now takes `&Arc<TagWriteBus>`. For each configured node the plugin registers an mpsc sender on the bus; a writer task converts TagValue → Variant (Bool→Boolean, Int→Int64, Float→Double, Str→String) and calls `session.write(&[WriteValue { node_id, attribute_id: Value, value }])`. Good results are echoed into `TagDb` immediately so the UI doesn't wait for the next subscription publish. On session exit the writer is aborted and `bus.unregister_many()` releases the routes; reconnects re-register cleanly. `source_supervisor` passes `bus` to the plugin.
  - **Step 3 — Server browse**: new `browse_one_level(cfg, parent_node_id)` helper opens a temporary session, browses Forward + HierarchicalReferences under the requested NodeId (or `ObjectsFolder` when `None`), returns a flat `Vec<BrowsedNode>` { node_id, browse_name, display_name, node_class }, then closes the session. New `POST /api/sources/opcua/browse` (Operator+) handler with the masked-password sentinel resolution pattern shared with MQTT browse. ConfigView `OpcUaSourceCard` gains a "🔍 Sfoglia server" button that opens a lazy-loading tree modal — `Object` folders expand on click, `Variable` rows have a checkbox, already-imported rows are greyed out to prevent double-add. Selection imports with `display_name` pre-filled as description.
  - 2 new unit tests (`tag_value_to_variant_roundtrip_*`) bring `sws-plugin-opcua` to 5 passing; workspace stays green at **50 unit tests**.
  - `docs/OPCUA_SETUP.md` rewritten with "Writes back to the server" + "Browse the server" sections; the deferred list now only mentions security policies > None, Euromap (BL-005b), and reverse browse.

- **OPC-UA client plugin — Phase 4 step 1+2 (BL-005)** (`sws-core/project.rs`, `sws-plugin-opcua`, `sws-web/source_supervisor.rs`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/types/index.ts`, `docs/OPCUA_SETUP.md`) — first slice of the industrial demo.
  - New `SourceDef::OpcUaClient(OpcUaClientConfig)` variant: `id`, `endpoint_url`, `security_policy` (only `None` wired, others stored for forward-compat), `auth` (`Anonymous` | `UsernamePassword` with `password` or `password_env` — env wins so secrets stay out of YAML), `subscription_interval_ms`, `Vec<OpcUaNodeMapping>` ({ tag, node_id, description? }). NodeIds in standard OPC-UA string form (`ns=2;s=Machine.X` or `ns=0;i=2253`).
  - `sws-plugin-opcua` upgraded from placeholder to real `run(cfg, db)`: `ClientBuilder` + `connect_to_endpoint_directly` + `DataChangeCallback`. Synchronous callback ships `(NodeId, DataValue)` over an unbounded mpsc channel; a tokio dispatcher drains it into `TagDb` so the OPC-UA worker never awaits async writes. Value mapping handles bool / all integer widths / float / double / string / LocalizedText. Unsupported variants land with `TagQuality::Uncertain`. On disconnect every mapped tag is flipped `Bad` until the next callback arrives after reconnect (5 s loop). 3 new unit tests for the variant → TagValue mapping.
  - `sws-web::source_supervisor` dispatches the new variant; `async-opcua` workspace dep gains the `client` feature; `futures-util` workspace dep also picked up here.
  - **ConfigView**: new `OpcUaSourceCard` with endpoint URL, security policy picker (only None active in PoC), subscription interval, anonymous / username+password auth toggle (password + password_env), node table with TagInput + quick-create. New "+ Aggiungi OPC-UA" button replacing the "prossimamente" placeholder. LeftPanel SOURCES section gets a green `OPC-UA` pill alongside `MQTT` / `MBUS`.
  - `docs/OPCUA_SETUP.md`: full setup guide — YAML shape, auth options, NodeId formats, value-type / quality mapping, two simulator recipes (`node-opcua`, Prosys Simulation Server), smoke-test recipe, explicit list of what's NOT in step 1+2 (writes back to server, browse, security policies > `None`, Euromap companion-spec discovery — all tracked as follow-ups).

- **Bidirectional `/ws/tags` — operator writes over the socket (task 6.4)** (`sws-web/router.rs`, `sws-editor/src/ws/tagStream.ts`, `sws-editor/src/runtime-view/RuntimeView.tsx`) — the existing send-only WS now also accepts `{"type":"write","tag":...,"value":...,"req_id":?}` frames. Role-gated at Operator+ (mirrors HTTP `PUT /api/tags/:id`), routed through `TagWriteBus` with fallback to direct `TagDb.set()` for virtual tags. Server replies with a `WriteAck` frame on the same socket echoing the optional `req_id`. Backend: handler now splits the socket via `futures-util` Sink/Stream traits and runs three tasks (forwarder serialises every outbound frame through an mpsc queue, broadcast subscriber, inbound dispatcher). Frontend: new `tryTagWriteWs(tag, value)` helper; `RuntimeView.handleWriteTag` prefers WS, falls back to `api.writeTag()` only when the socket isn't open yet (first paint can race the upgrade).

- **Playwright e2e — login → add rect → save → reload (task 9.1)** (`sws-editor/playwright.config.ts`, `sws-editor/e2e/editor.spec.ts`, `scripts/README.md`). `@playwright/test` dev-dep + two specs: the golden path (add a rect, save, reload, confirm rect survived) and a negative login form path. Config keys: chromium project, `baseURL: https://localhost:5173`, `ignoreHTTPSErrors: true`, `trace: retain-on-failure`. **No `webServer` config** — replicating dev.sh's cert / seed / env bootstrap inside Playwright would be more brittle than asking the operator to run dev.sh first. `pnpm test:e2e` + `pnpm test:e2e:ui` scripts. Artefacts (`test-results/`, `playwright-report/`, `.playwright/`) gitignored. `scripts/README.md` documents the run sequence.

- **Automatic project backups + restore (task 7.2)** (`sws-web/backups.rs`, `sws-runtime/main.rs`, `api/client.ts`, `config/ConfigView.tsx`) — point-in-time snapshots of the project files under `<project>/.bak/<UTC-timestamp>/` covering `project.yaml`, `synoptics/`, and `users.yaml`. Two trigger paths:
  - Background loop fired by the runtime when started with `--auto-backup-interval-minutes N` (default 0 = disabled). `--auto-backup-retention K` caps the retained count (default 20); older snapshots are pruned after each tick. First tick is skipped so the process doesn't snapshot on startup before any work happens. Snapshot I/O runs under `spawn_blocking` so it never starves the runtime's tasks. Skipped silently when no project is open.
  - Admin REST: `GET/POST /api/backups`, `DELETE /api/backups/:name`, `POST /api/backups/:name/restore`. Path param sanitised by `safe_backup_name` against `..`/`/`/length.
  - `ConfigView` gains a "Backup" tab (admin-only) with a newest-first table (name, created at, size) and **Backup adesso** / **Aggiorna** / **Ripristina** / **Elimina** buttons. Restore reloads the project + pages so the editor reflects the snapshot state immediately.
  - 4 new unit tests (sws-web 8 → 12): roundtrip, list sort order, prune behaviour, traversal rejection.

- **Aspect-ratio resize, Prometheus counters, live script test panel** (sessione 26 follow-up).
  - **1.5 Shift + corner drag preserves aspect ratio** (`canvas/SvgCanvas.tsx`): when `shiftKey` is held during a corner handle drag (`tl/tr/bl/br`), the resize locks `startObj.width / startObj.height`. Driver axis is whichever moved more (in width-equivalent units, `dySigned * aspect`); the other axis is derived. Mid-edge handles ignore Shift (only one dim is meaningful). Anchor preserved: `l` handles still move `x` inward from the right, `t` handles still move `y` from the bottom. Documented in `ShortcutHelp`.
  - **3.4b Prometheus counters** (`sws-web/router.rs`, `sws-runtime/main.rs`, `sws-web/metrics.rs`):
    - `sws_script_exec_total{endpoint,status}` — bumped from `exec_script` and `run_function`.
    - `sws_alarm_transitions_total{direction,severity}` — bumped in the alarm webhook dispatcher (the single spot every alarm transition flows through), on both `activated` and `recovered` directions.
    - `sws_http_requests_total{path,method,status}` — new `track_http_metrics` middleware extracts the `MatchedPath` template (bounded cardinality, not raw URI) and emits on every response. `/metrics` + `/health` excluded so scrape traffic doesn't dominate.
    - `sws-runtime` crate gains the `metrics` workspace dep.
  - **6.3 Live script test panel** (`runtime-view/RuntimeView.tsx`): new floating 🧪 button bottom-left, visible only when the project defines functions. Opens a small dialog with a function picker, one editable input per declared param (empty falls back to default), Description preview, and a Run button. Reuses the existing `handleScript` dispatcher so output flows to the toast surface and the new `sws_script_exec_total` counter increments. Type coercion mirrors the declared param default's type (`bool`/`number`/`string`). Per-function overrides held in component state — operator can iterate on a single function without retyping.

- **S-27 UX bundle: tree drag&drop + context menu + canvas rulers** (`editor/LeftPanel.tsx`, `canvas/SvgCanvas.tsx`, `store/index.ts`) — three independent UX tasks closed together because they touch overlapping files.
  - **Drag & drop nel tree LeftPanel** (task 1.3): every object row is `draggable`. Drop above/below a sibling reorders within the same group; drop on a group header inserts as last member of that group; drop on the new "⤓ Trascina qui per rimuovere dal gruppo" zone (only visible during a drag) moves the object to the ungrouped tail. Group rows are also draggable for reordering the group list. Blue 2 px indicator bar / inset box telegraphs the landing spot during hover. Store gains `moveObjectAdjacent(objId, targetId, before|after)`, `moveObjectToGroupEnd(objId, groupId|null)`, `moveGroupAdjacent(groupId, targetGroupId|null, place)`. `moveObjectToGroup` now pushes a history entry (was silent).
  - **Context menu** (task 1.4): right-click on an object/group row opens a floating menu pinned to the click position (clamped to the viewport). For objects: Rinomina · Duplica · Sposta in gruppo → (submenu listing every group + "⤓ Senza gruppo") · Raggruppa selezione (only when 2+ objects selected and the right-clicked row is part of the selection) · Elimina. For groups: Rinomina gruppo · Separa gruppo. Auto-closes on click outside or Esc.
  - **Canvas rulers + guide lines** (task 4.2, `canvas/SvgCanvas.tsx`): edit mode now renders 20 px ruler strips along the top and left edges, with adaptive 1/2/5 tick spacing that keeps labels ≥ 50 screen-px apart regardless of zoom. Click-and-drag on a ruler spawns a new guide line on the orthogonal axis. Dragging an existing guide repositions it; releasing with the cursor back over the ruler (line turns red) deletes it. Guides are persisted per-page in `localStorage["sws.canvas.guides.<pageId>"]` — deliberately not in `project.yaml`, since they're an editor convenience, not part of the published synoptic. Object-drag snap pipeline now includes vertical/horizontal guide positions alongside object-edge and page-border candidates (same `8 / zoom` threshold). Corner square `⟂` toggles ruler visibility (state persisted in `sws.canvas.showRulers`); when hidden a small ⟂ icon at the top-left brings them back.

- **Single-page YAML export + import** (`task 7.1+7.3`, `sws-web/router.rs`, `api/client.ts`, `editor/LeftPanel.tsx`) — backup or share an individual synoptic without exporting the whole project ZIP.
  - Backend: `GET /api/synoptics/:name/export` (Viewer+) returns the file as raw YAML with `Content-Disposition: attachment` (Content-Type `application/x-yaml; charset=utf-8`). `POST /api/synoptics/import` (Operator+) accepts raw YAML in the body, allocates a fresh page id (`imported-<unix_ms>`), and resolves filename collisions by appending " (2)", " (3)", … to the page name. Returns `{ id, name, filename }` so the editor can navigate to the import.
  - Frontend: `api.exportSynopticYaml(name)` / `api.importSynopticYaml(yamlText)`. PagesSection rows gain a `⬇` button next to ⧉ for download; PagesSection footer gains a `⬆ YAML` button that opens a file picker. After import the project is reloaded, pages are re-fetched, and the new page becomes current.

- **Real `/metrics` Prometheus endpoint + system status unit tests** (`task 3.4 + 9.2`, `sws-web/metrics.rs`, `sws-web/system.rs`).
  - `sws-web::metrics` installs a process-global `PrometheusHandle` on first call (`OnceLock`-gated, idempotent across tests that rebuild the router). `GET /metrics` now renders Prometheus text exposition v0.0.4 with live gauges sampled per scrape: `sws_uptime_seconds`, `sws_tag_count`, `sws_alarm_active_count`, `sws_alarm_total`, `sws_cpu_usage_pct`, `sws_memory_used_bytes`/`sws_memory_total_bytes`, `sws_disk_used_bytes`/`sws_disk_total_bytes`. No background ticker — cost paid only on actual scrape.
  - `sws-web::system` extracted a pure `compute_system_status(db, alarms, project_dir, started_at)` helper from the handler so unit tests can call it without spinning up the full `AppState` (which needs PyO3 + Python).
  - Tests (sws-web 3 → 8): `compute_system_status_reflects_inputs`, `compute_system_status_no_project_is_none`, `alarm_active_count_includes_only_active`, `install_recorder_is_idempotent`, `render_includes_emitted_gauges`. Workspace `cargo test --workspace` stays green (41 unit tests).

- **Multi-runtime WelcomeScreen** (`ARCH-004`, `sws-web/router.rs`, `api/client.ts`, `ws/wsUrl.ts`, `components/WelcomeScreen.tsx`, `App.tsx`) — same SPA bundle can now connect to any runtime URL (laptop ↔ PX30) without rebuilding.
  - `api/client.ts`: replaced the `const BASE_URL` with a `getBaseUrl()` function that reads `localStorage["sws.runtimeBaseUrl"]` first, then `VITE_RUNTIME_URL`, then falls back to same-origin. Exported `getRuntimeBaseUrl()` and `setRuntimeBaseUrl(url|null)` for the UI.
  - `ws/wsUrl.ts`: uses the same resolution via `getRuntimeBaseUrl()` so WS streams follow the active runtime origin.
  - `WelcomeScreen`: new "📡 Connetti a runtime remoto…" link in the footer opens a `RemoteRuntimeModal` with URL input + `GET /health` test button + Connetti. On Connect: persist the URL in localStorage and `window.location.reload()` (clean reset of auth, project state, WS sockets). The same modal exposes "↺ Torna al locale" when a remote runtime is already set.
  - `App.tsx`: new header pill `📡 host:port` shown whenever the SPA is targeting a non-default runtime; click → confirm + disconnect (clears localStorage + reload).
  - **CORS** (`sws-web/router.rs`): added `CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)` at the outermost layer. Required for the cross-origin laptop→PX30 case (browser blocks preflight otherwise). Bearer-token auth unaffected — `Allow-Credentials` stays default-false, no cookies. Permissive wildcard is CRA-non-compliant; tighten to an allowlist when the PoC graduates.
  - First-connect gotcha documented in the modal error message: if the remote runtime uses its first-run self-signed cert and the browser has never accepted it, the fetch fails with `TypeError: Failed to fetch` (no informative status). The modal tells the user to open `<URL>/health` in a new tab once to click through the cert warning.

- **Kiosk-mode browser spawn** (`ARCH-003`, `sws-runtime/main.rs`, `docker/entrypoint.sh`, `docs/DEPLOY_PX30.md`) — new CLI arg `--kiosk-browser <shell-cmd>`. After the HTTPS listener is up and `/health` answers OK, the runtime spawns the command (fire-and-forget; child inherits stdio; child death does not stop the runtime). Uses `reqwest` (already in deps) with `danger_accept_invalid_certs(true)` to tolerate the self-signed cert during a 5-second poll (50× 100 ms), then `tokio::process::Command::new("sh").arg("-c").arg(cmd).spawn()`. Stock SWS container does not bundle a browser — operator installs chromium/epiphany/firefox/cage on the host or in a derived image. DEPLOY_PX30 §4c documents the recipe with `chromium --kiosk --no-sandbox --app=URL` as the canonical example.

- **Panel breadcrumb chips are clickable** (`editor/EditorShell.tsx`) — when a grid cell or sub-cell is selected, the canvas covered every pixel of the grid with cells so the user had no canvas-side way to reach the grid's general properties (`grid_rows`, `grid_cols`, position, etc.). `PanelBreadcrumb` now accepts `string | { label, onClick? }` parts: every non-leaf chip with `onClick` becomes a small blue dotted-underline button that clears the matching cell/sub-cell/range state and steps "up" one level. From a cell editor, click the grid label to deselect the cell and see the grid's full `ObjectProps`.

- **Sub-slot auto-select of the parent grid** (`canvas/SvgCanvas.tsx`) — clicking a sub-slot (or its child overlay) was only setting `selectedSubCell`; `selectedObjectId` stayed null and the panel kept showing page properties despite the visual highlight. Both onMouseDown handlers in `renderSubArea` now call `p.onSelect(gridObjId, false)` before `p.onSelectSubCell(...)`. Order matters because `selectObject` clears `selectedSubCell`, so the grid select has to fire first.

- **ObjectProps panel — accordion redesign** (`editor/EditorShell.tsx`) — typical right-side panel was ~900-1100 px tall with ~13 always-expanded sections. New `CollapsibleSection` helper (chevron header + body, state persisted per section via `sws.objprops.<key>` in localStorage) wraps the advanced sections. Always-visible top: Identità (now a compact name + `[type · id]` chip row, ~30 px reclaimed), Posizione, Aspetto + type-specific blocks, Tag. Collapsed by default: Trasformazione, Layer e Visibilità, Indicatore qualità (now always present with a "Imposta un tag…" hint instead of vanishing), Eventi (badge with function count), Binding attivi (badge with count). Dropped redundant `<input type="range">` siblings from rotation/opacity/transition rows (number input + reset button are enough). Typical rect with tag + 1 event: ~480 px collapsed, ~900 px fully expanded.

- **Grid sub-cell recursion** (`types/index.ts`, `canvas/SvgCanvas.tsx`, `store/index.ts`, `editor/EditorShell.tsx`) — `SubCellEntry.sub?: SubGrid` is now allowed, so a slot inside a split cell can be split further (no depth limit). `selectedSubCell` switches from `slot: "a" | "b"` to `path: ("a" | "b")[]`. Two new tree-traversal helpers `updateSubGridAtPath` / `updateSubCellEntryAtPath` produce immutable updates. `splitCell` / `joinSplitCell` / `resizeSubBorder` gain an optional `path` argument. New `updateSubCellAt` action patches sub-cell entry fields. The canvas render goes recursive via a new `renderSubArea` walker; the SvgCanvas-level border-handle emitter walks the tree to emit one 6 px corridor per nested SubGrid. Sub-cell panel branch shows split/join buttons scoped to the entry's path. `resolveSubCellEntry` returns an empty `{}` (not `null`) for valid-but-unmaterialised slots so freshly-split slots are immediately editable. Children inside sub-cells gain a clickable transparent overlay + a teal-dashed selection rect (mirrors regular cell-child UX).

- **Grid object: drag-resize column/row borders + internal snap** (S-23, `canvas/SvgCanvas.tsx`, `store/index.ts`) — when a `grid` object is selected in edit mode, the canvas renders 6 px transparent corridors centred on every interior column/row border. Dragging adjusts the two adjacent track sizes (clamp ≥ 8 px each) while keeping the grid's total span constant. Snap targets are the cumulative positions of the other interior borders of the same grid (threshold `8/zoom px`); cyan snap line reuses the existing `setSnapLines`. Coalesced into one undo entry per drag via the S-22 `openInteraction` bracket.

- **Grid object: shift+click multi-cell selection + merge** (S-23, `canvas/SvgCanvas.tsx`, `store/index.ts`, `editor/EditorShell.tsx`) — store gains `selectedCellRange: { objectId, r1, c1, r2, c2 } | null` (normalised). Shift+click on a second cell of the already-selected grid extends the range; a teal-dashed overlay highlights the union. New `mergeCellRange` action sets `rowspan/colspan` on the top-left origin and drops the other cell entries; validates that pre-existing merges inside the range don't extend beyond it. `unmergeCell` reverts. Panel shows `CellRangeMergeActions` (Unisci celle / Annulla selezione) and `CellStructureActions` (Annulla unione) toolbars when applicable.

- **Grid object: local cell split (1×2 / 2×1)** (S-23, `types/index.ts`, `canvas/SvgCanvas.tsx`, `store/index.ts`, `editor/EditorShell.tsx`) — `GridCell` gains `sub?: SubGrid { orientation: "rows" | "cols", ratio: number, a?: SubCellEntry, b?: SubCellEntry }`. New panel buttons "⬓ Dividi orizzontalmente" / "⬔ Dividi verticalmente" appear on a single unmerged, unsplit cell. `splitCell` action migrates any existing `cell.child` into `sub.a.child`. The renderer detects `cellDef.sub` and draws two sub-slots inside the cell (with their own `bg_color`, `bg_image`, centred child object); a dashed divider line + a 6 px drag corridor on the divider let the user adjust `sub.ratio` (clamped). `joinSplitCell` removes the split and lifts `sub.a.child` (or `sub.b.child`) back to cell level. Selecting a sub-slot opens a dedicated panel for its `bg_color` + `child` (full `ObjectProps`). Recursion into sub-cells intentionally disabled (KISS — the `sub` field naming leaves the door open).

- **Runtime serves the SPA — single-binary deployment** (`ARCH-001`, `sws-web/router.rs`, `sws-runtime/main.rs`, `Cargo.toml`, `compose.yaml`, `docs/DEPLOY_PX30.md`) — new CLI arg `--www <path>`. When set, the runtime mounts `tower_http::ServeDir` as a fallback service so any path not matched by the API/WS routes is served as static. 404s inside ServeDir fall back to `index.html` so the SPA's client-side routing survives a refresh. `tower-http` workspace dep gains the `fs` feature. `compose.yaml` ships commented-out single-container variant; `docs/DEPLOY_PX30.md` documents the alternative deployment shape (no separate Nginx container needed).

- **Configurable runtime URL for the editor** (`ARCH-002`, `vite.config.ts`, `ws/wsUrl.ts`, `ws/tagStream.ts`, `ws/alarmStream.ts`, `ws/logStream.ts`, `scripts/dev.sh`, `scripts/README.md`) — `VITE_RUNTIME_URL=https://px30.local:8443` now influences the Vite proxy target, the `api/client.ts` BASE_URL prefix and the WS URL derivation (with `http→ws` scheme swap). Three previously-duplicated WS URL builders are consolidated into a single `ws/wsUrl.ts` helper. Per-stream overrides (`VITE_RUNTIME_WS_URL`, etc.) remain available for advanced setups.

- **Alarm panel with per-row ACK in RuntimeView** (`6.1`, `runtime-view/RuntimeView.tsx`) — new floating top-right `AlarmPanel` component with a 🔔 toggle button. Badge shows total active count (red border when there are unacked alarms, amber when all acked). Click reveals a dropdown listing every active alarm with severity dot, id, message, and an individual ACK button. A bulk "ACK tutti" button appears when 2+ unacked alarms are present. Live updates via the shared `useAlarmStream` WS singleton.

- **Log export download** (`6.2`, `components/LogPanel.tsx`) — new "⬇ Scarica" button in the LogPanel header writes the currently visible (filtered) events to a `sws-logs-YYYY-MM-DD.jsonl` blob and triggers a browser download. Works in both live mode (date = today) and historical mode (date = the loaded file's date). Disabled when there are no rows to export.

### Changed
- **Drag/resize undo collapses to one entry per gesture** (`4.1`, `store/index.ts`, `canvas/SvgCanvas.tsx`) — added `beginInteraction(label)` / `endInteraction()` store actions that bracket a drag or resize. While an interaction is open, `updateObject` / `updateObjects` skip their per-mutation `pushHistory` call; the bracket captures a single labeled snapshot at the start. Without this, a 200 px drag created 200 redundant undo entries.

- **Copy-paste honours source page** (`4.3`, `store/index.ts`, `editor/EditorShell.tsx`) — `copySelection` now records the source page id alongside the clipboard. `pasteClipboard` reads it: same-page paste keeps the historical `+20 px` offset and preserves `group_id`; cross-page paste lands at the original coordinates and strips `group_id` (groups are per-page, so cross-page references would dangle). `setClipboard(objs, sourcePageId?)` signature extended; all call sites updated. ShortcutHelp annotated "(anche cross-page)".

- **Snap-to-page-border during drag** (`4.4`, `canvas/SvgCanvas.tsx`) — extracted the snap candidate test into `trySnapX` / `trySnapY` helpers. After the object-edge pass, when no nearby object caught the drag, the page's left/center/right (and top/middle/bottom) edges become snap targets at the same threshold. Grid snap remains the last-resort default.

### Fixed
- **alarm.rs unit-test `def()` helper missing `notify_url`** (`sws-core/src/alarm.rs`) — pre-existing test compile failure on origin/main left over from commit `524cc61` (alarm webhook field) — the helper was not updated alongside the public struct, breaking `cargo test -p sws-core`. Added `notify_url: None` and the workspace test suite is green again.

- **Store-based cross-view navigation** (`store/index.ts`, `App.tsx`, `ConfigView.tsx`, `LeftPanel.tsx`) — `appMode` and `configTab` moved from local `useState` to Zustand store. Exported types `AppMode` and `AppConfigTab`. New `navigateToConfig(tab)` action sets both `appMode: "config"` and `configTab` atomically. `SourcesSection` rewritten as a list of clickable source rows with type badge (MQTT/MBUS) and click → `navigateToConfig("protocols")`. ConfigView reads `configTab` from the store as initial state and syncs via `useEffect` when an external navigation occurs.

- **Categorized object palette with icons** (`LeftPanel.tsx`) — the flat `OBJECT_TYPES` array and old `ObjectPalette` component replaced with `PALETTE_GROUPS` (5 accordion categories: Forme, Controlli, Display, SCADA, Layout) and a `PaletteGroupAccordion` component. Each widget type has a colored Unicode icon and label; "Forme" opens by default. Layout unchanged for `EditorShell` (`onAdd` prop untouched).

- **System status tab + backend endpoint** (`sws-runtime`, `ConfigView.tsx`, `api/client.ts`) — `sysinfo = "0.30"` added to workspace. `started_at: std::time::Instant` added to `AppState`. New `sws-web/src/system.rs` with `SystemStatus` struct and `get_system_status` handler. Route `GET /api/system` registered in `operator_routes`. Frontend: `getSystemStatus()` in `api/client.ts`; new tab `"Stato"` in ConfigView with `SystemTab` component — polls every 10 s, shows runtime version, active project, uptime (formatted `Xh Ym`), tag count, sources, active alarms, historian samples, CPU%/RAM/disk progress bars.

- **Visual undo/redo history panel** (`store/index.ts`, `LeftPanel.tsx`) — `HistoryEntry { pages, label }` replaces `SynopticPage[][]` for the `past`/`future` stacks. `HISTORY_LIMIT` raised to 200. `pushHistory(label)` now stores a human-readable action label for each snapshot; all 17+ call sites updated with contextual labels (e.g. `"Aggiungi rect"`, `"Elimina selezione"`, `"Allinea (left)"`). New `jumpToPast(index)` and `jumpToFuture(index)` actions for direct jump to any history step. `undo()` and `redo()` preserve the label when moving entries between stacks. `HistorySection` in LeftPanel replaces `UndoRedoBar`: a scrollable chronological list showing "Stato iniziale", clickable past entries, a "▶ CORRENTE" marker row, and greyed/italic future entries (clickable for redo). Auto-scrolls to the current row on every history change. The ↶/↷ buttons remain at the bottom.

- **User-defined object groups** (`types/index.ts`, `store/index.ts`, `LeftPanel.tsx`, `EditorShell.tsx`, `synoptic.rs`) — `ObjectGroup { id, name }` in types; `group_id?: string` on `SynopticObject`; `groups?: ObjectGroup[]` on `SynopticPage`. Store adds `groupObjects(ids, name?)`, `ungroupObjects(groupId)`, `renameGroup(groupId, name)`, `moveObjectToGroup(objId, groupId|null)`. `ObjectsSection` in LeftPanel rewritten with `buildTree()` that renders a hierarchical tree: collapsible 📁 folder rows (▶/▼ toggle) with member count, click on folder → multi-selects all members in canvas, double-click name → inline rename, ⊔ button to ungroup. A "+ Raggruppa selezionati (N)" button appears above the list whenever 2+ objects are selected. Groups auto-expand when a member is selected. `Ctrl+G` shortcut added (`EditorShell.tsx`) + entry in ShortcutHelp. Rust `synoptic.rs`: `locked` and `group_id` on `SynopticObject`, `groups` on `SynopticPage` — all persisted to YAML.

- **Mouse position display** (`SvgCanvas.tsx`) — in edit mode, the bottom-left corner of the canvas shows `X:NNN Y:NNN` in SVG user-space coordinates, updated live on every `mousemove`.

- **Zoom to fit** (`SvgCanvas.tsx`) — `Ctrl+Shift+0` and the `⊡` button in the top-right corner of the canvas compute the bounding box of all page objects and set zoom + pan to fit them in view with ~40 px of margin. Resets to 100% when the page is empty. (Ctrl+0 continues to reset to 100% without fitting.)

- **Page reorder + duplicate** (`LeftPanel.tsx`, `store/index.ts`) — each page row in the LeftPanel now shows ↑/↓ buttons to move the page up or down in the list (visible only when applicable) and a ⧉ button to duplicate the page. Store: new `reorderPage(id, dir)` and `duplicatePage(id)` actions (both push undo history). The duplicate appears immediately after the original and becomes the active page.

- **Object edge snapping** (`SvgCanvas.tsx`) — when dragging an object, the canvas scans all other objects' bounding boxes (left/center/right on X; top/middle/bottom on Y). If any edge on the dragged object (its own left, center, or right) falls within `8/zoom` px of another object's reference edge, it snaps to that edge. Object-edge snap takes priority over grid snap. Snap guide lines (cyan, 1 px) are shown along the active snap axis and cleared on `mouseup`. Works with all non-line object types.

- **Keyboard shortcut help** (`EditorShell.tsx`) — pressing `?` anywhere (outside an input field) toggles a modal overlay listing all keyboard shortcuts, grouped by category: canvas navigation, selection, editing, z-order. Click outside or ×  to close.

- **Object lock** (`SynopticObject.locked`, `SvgCanvas.tsx`, `EditorShell.tsx`, `LeftPanel.tsx`) — a new `locked?: boolean` field on every `SynopticObject`. When `true` in edit mode the object's `handleMouseDown` returns early — it cannot be clicked, selected, or dragged. A "Bloccato" checkbox (amber accent) appears in the LAYER section of the properties panel. A 🔒 emoji indicator appears in the LeftPanel object list next to the type tag.

- **LeftPanel object filter** (`LeftPanel.tsx`) — a live text filter input above the objects list in the "OGGETTI PAGINA" section. Filters by `name`, `type`, and `id` (case-insensitive substring). The section title always shows the total count. An appropriate empty-state message is shown when the filter matches nothing.

- **Canvas zoom + pan** (`SvgCanvas.tsx`) — full non-destructive zoom/pan for the edit canvas:
  - `Ctrl + scroll wheel`: zoom in/out, centred on the cursor position.
  - `Scroll wheel` (no modifier): vertical pan; `Shift + scroll`: horizontal pan.
  - `Ctrl + 0`: reset to 100% zoom, origin pan.
  - `Middle-click drag` (button 1): free-form pan.
  - All canvas objects live inside `<g transform="translate(panX,panY) scale(zoom)">`. The grid background uses a 100 000 × 100 000 px rect to stay visible while panning.
  - Resize handles and line endpoint handles are scaled by `1/zoom` so they stay pixel-constant on screen.
  - Mouse → SVG user-space via `toSvg(screenX, screenY) = (x − panX) / zoom`; all drag/resize logic updated.
  - A zoom percentage badge is shown in the bottom-right corner when zoom ≠ 100%.
  - The wheel listener is attached via `useEffect` with `{ passive: false }` to allow `preventDefault`.

- **Arrow key nudge** (`EditorShell.tsx`) — in edit mode with a single object selected, the arrow keys move it by 1 px (plain) or by `gridSize` px (`Shift + arrow`). Line objects also update `x2`/`y2` to keep their shape. The handler skips when focus is inside an `<input>` or `<textarea>`.

- **Line endpoint drag handles** (`SvgCanvas.tsx`) — when a line is selected in edit mode, two circles (r=5, white/yellow border) appear at its two endpoints. Dragging p1 updates (x, y); dragging p2 updates (x2, y2). Snap-to-grid applies. `ResizeState.startObj` extended with optional `x2`/`y2` fields; `handleMouseMove` dispatches to the p1/p2 branch before the box-handle branch.

- **Z-order reorder + Ctrl+A select-all** (`EditorShell.tsx`, `store/index.ts`):
  - `ZOrderBar` component in the properties panel (4 buttons: ⬆⬆ primo piano / ↑ avanti / ↓ indietro / ⬇⬇ sfondo). Hidden when only 1 object on the page.
  - Keyboard: `Ctrl+]` → forward, `Ctrl+Shift+]` → front, `Ctrl+[` → backward, `Ctrl+Shift+[` → back.
  - `Ctrl+A` selects all objects on the current page.
  - New store action `reorderObject(id, dir)` with `pushHistory`, splices the object in the `page.objects` array (render order = array order, last = on top).

- **Visual resize handles** (`SvgCanvas.tsx`) — when a single non-line, non-grid, non-rotated object is selected in edit mode, 8 white/yellow squares (8 × 8 px) appear at the bounding-box corners and edge midpoints. Dragging a handle resizes the object in real time via `onMove`: corner handles change both dimensions and position; edge handles change only one dimension. Minimum enforced at 4 px; snap-to-grid applies. Implemented via a new `ResizeState` / `resizeRef` alongside the existing `DragState` — mutually exclusive, no changes in `EditorShell` or the store.

- **Context-sensitive properties panel** (`EditorShell.tsx`) — the right-side panel now shows exactly one level of detail based on what is selected, instead of stacking all levels simultaneously:
  - Grid selected (no cell) → `ObjectProps` for the grid object.
  - Cell selected (no child sub-selected) → `GridCellEditor` for the cell; if a child exists a labelled chip shows its type/name plus ✂ Taglia / ✕ Rimuovi buttons and a hint "clicca nel canvas per modificarne le proprietà".
  - Child sub-selected → `ObjectProps` for the child directly, headed by a `PanelBreadcrumb` showing `griglia › R,C › tipo`.
  - `PanelBreadcrumb`: lightweight inline component (›-separated parts, last part highlighted).
  - `GridCellEditor`: removed the embedded `ObjectProps` and the now-unused `pages` prop.

- **Grid child mouse selection** (`SvgCanvas.tsx`, `store/index.ts`, `EditorShell.tsx`):
  - First click on a grid object selects the cell (yellow dashed highlight, as before).
  - Second click on the embedded child object — when its cell is already selected — sub-selects the child with a teal dashed highlight (`stroke="#0d9488"`).
  - Implemented with a transparent overlay `<rect>` that is only rendered when `isCellSel` is true, so the first click always falls through to the cell hit area.
  - `selectedCell` / `selectedCellChild` migrated from local `useState` in `EditorShell` to the Zustand store. Both fields are cleared in `selectObject`, `clearSelection`, `setCurrentPage`, `undo`, and `redo`. `setSelectedCell` resets `selectedCellChild` whenever the cell identity changes.
  - Keyboard handler (Ctrl+X / Ctrl+V) updated to `useAppStore.getState().selectedCell` (no stale-closure risk, no need for the old `useRef` / `useEffect` pattern).
  - `SvgCanvasProps` and `ObjProps` extended with `selectedCellChild?` / `onSelectCellChild?`; threaded through `SvgObject`.

- **LeftPanel collapsible object tree** (`LeftPanel.tsx`):
  - Each grid object row now shows a `▶/▼` expand toggle (only if the grid has cells with children).
  - Clicking the toggle reveals indented sub-rows, one per cell that has a child object. Each sub-row shows the child's type tag, name, and cell coordinates (R,C).
  - Clicking a sub-row simultaneously selects the parent grid, the cell, and the child (canvas teal highlight + panel `GridCellEditor`).
  - Selecting a child via the canvas auto-expands the grid branch in the tree (a `useEffect` on `selectedCellChild?.objectId` adds the parent id to `expandedGrids`).
  - Selection highlight: teal text `#5eead4` + dark teal background `#0f2922` when the sub-row matches the active `selectedCellChild`.

- **Multi-selection common properties panel** (`EditorShell.tsx`, `store/index.ts`) — when 2+ objects are selected the right panel now shows editable properties instead of only alignment/distribution tools:
  - Same type (e.g. 5 gauges): full `ObjectProps` panel pre-filled with identical values; mixed values show empty + placeholder "(vari)". Any edit applies to all selected objects.
  - Mixed types (e.g. rect + button): `CrossTypeProps` panel with universal sections: POSIZIONE, ASPETTO, TRASFORMAZIONE, VISIBILITÀ, TAG, QUALITÀ, EVENTI.
  - Undo (Ctrl-Z) restores all objects at once via a single `pushHistory` call in the new `updateObjects` store action.

- **Design-reference borders** (`SvgCanvas.tsx`) — in edit mode every object and every grid cell gets a dashed editorial bounding-box overlay (`stroke="#475569"`, `strokeDasharray="4 3"`, `opacity=0.5`, `pointerEvents="none"`). For grid cells the border turns yellow when the cell is selected. These borders are purely editorial — never rendered at runtime.

- **Full child `ObjectProps` in `GridCellEditor`** (`EditorShell.tsx`) — the editing panel for a grid cell child now embeds the complete `<ObjectProps>` component (same as for page-level objects) instead of the previous minimal set. Added `CELL_CHILD_TYPES`, `makeDefaultChild()`, a type dropdown, and an "Aggiungi" button for inserting a new child. The `pages` prop is threaded through `GridCellEditor` for navbutton target selection.

- **Project management from WelcomeScreen** — each project card now shows three icon buttons (✎ rename, ⧉ duplicate, ✕ delete):
  - **Rename**: click ✎ to replace the project name with an inline `<input>`; Enter/Esc/blur confirms or cancels. Backend: `POST /api/projects/:name/rename` (`{ new_name }`) in `sws-web/src/projects.rs`; updates the active project dir pointer if the project was open.
  - **Duplicate**: click ⧉ to reveal a "Nome copia:" row below the card with a text input and ✓/✗ buttons. Backend: `POST /api/projects/:name/duplicate` uses `copy_dir_all` into a new folder; 409 on conflict.
  - **Delete**: click ✕ for `window.confirm`; backend `DELETE /api/projects/:name` returns 409 if the project is currently open. Directory is removed on success.
  - New `axum::routing::delete` import in `router.rs`; all three routes added to the pre-auth `project_lifecycle` layer. New `deleteProject / renameProject / duplicateProject` methods in `api/client.ts`.

- **Quality dot — per-object visibility toggle and custom colours** — `SynopticObject` gains four optional fields:
  - `quality_dot?: boolean` — when `false` the quality-state circle is not rendered (useful for decorative objects or wherever the dot would overlap the widget content). Default: `true` (unchanged behaviour).
  - `quality_dot_good_color?`, `quality_dot_bad_color?`, `quality_dot_uncertain_color?` — override the global defaults (`#22c55e` / `#ef4444` / `#eab308`) per object.
  - `SvgCanvas.tsx`: `qualityColor()` updated to accept optional overrides; `QDot` component extended with three optional colour props; all five render sites (rect/ellipse/text/progress_bar/gauge) now guard with `obj.quality_dot !== false` and pass the colour props.
  - `EditorShell.tsx`: new "INDICATORE QUALITÀ" panel section (shown only when `obj.tag` is set) with a checkbox for visibility and three `<input type="color">` pickers that appear when the checkbox is on. Empty value → placeholder shows global default.
  - `synoptic.rs` (Rust): four new `Option<…>` fields with `skip_serializing_if = "Option::is_none"` for lossless YAML round-trip.

- **Template "Casa Locale" — bug fixes**:
  - DDS661 "Rack Piano Superiore" topic slug corrected from `contatore-rack-piano-superiore` to `contatore-rack-pianosuperiore` (4 topic references in `project.yaml`). The slug was mismatched with the actual device name published by the dds661 tool.
  - Navigation home button ("⌂") moved from `x=340 w=130` to `x=155 w=55` on pages 3, 4, 5 — it was overlapping the centred page title text.

- **Symbol library v2** — visual gallery replaces plain dropdown; 5 new builtin symbols; 7 vendored symbols registered:
  - `SymbolGallery` component: 4-column CSS grid, `maxHeight: 260px` scrollable, each tile shows a 44×38 mini-preview (inline SVG for builtins, `<img>` for vendored/custom), blue border on selection, 8 px label below. Replaces `SymbolSelect` (`<select>`) throughout the ObjectProps panel.
  - New builtin symbols (hand-rolled JSX, 100×100 viewBox): `heat_pump` (hot/cold coil sections + compressor), `temperature_sensor` (stub + circular body + TT tag bubble), `boiler` (steam outlet + vessel + flame), `agitator` (vessel + side motor + shaft + cross impeller; CSS `animation: spin 1s linear infinite` when state=on), `cooling_tower` (trapezoid + fan disk + packing lines + water drops).
  - New vendored entries from existing `public/symbols/` SVGs: `solar_panel`, `battery`, `transmission_tower`, `home_lightning`, `garage`, `window_open`, `roller_shade`.
  - `SYMBOL_LIST = Object.values(SYMBOLS)` exported from `library.tsx` — SymbolGallery imports it instead of maintaining its own list.
  - Total library: 22 symbols (15 builtin + 7 vendored); custom project symbols still appear after library entries.

- **MQTT broker browsing** — "Sfoglia broker" button in each MQTT source card opens a modal that connects ephemerally to the broker, subscribes to `#` for a configurable duration (2–15 s, default 8 s), and lists all observed topics. Each row shows the topic name, a truncated payload preview, and a JSON path dropdown (auto-populated from top-level keys if the payload is valid JSON). Selected topics can be imported as new mapping rows in one click. Backend: new `pub async fn browse()` in `sws-plugin-mqtt` + `POST /api/sources/mqtt/browse` endpoint (Operator+) in `sws-web`. Masked passwords are resolved from the saved project when a `source_id` is provided.
- **Quick-create variable in protocol config** — a "＋" button next to every tag field in MQTT topic mappings and Modbus register mappings opens a `QuickCreateTagModal` (ID, description, type). Created tags are accumulated as `pendingTags` in `ProtocolsTab` and saved (merged with existing tags) on the next "Salva" click. A banner lists pending-tag IDs before save.
- **Responsive layout in Configurazione** — `ConfigView` body no longer caps at `maxWidth: 900`. The entire tab (including protocol cards and topic/register tables) uses the full available width. The "Topic in (subscribe)" column is widened from 26% to 32%; QoS column narrowed to 6% to compensate.

- **Template "Casa Locale"** (`examples/templates/casa-locale/`) — second SWS template: a 5-page home control console for a local MQTT broker. Pages: Panoramica (energy flow + security overview), Impianto Solare (PV gauges + battery SOC + grid exchange), Contatori Energia (3 DDS661 energy meters with gauges and measurement tables), Sicurezza (12 Zigbee door/window sensors + 3 perimeter PIRs + lux), Domotica (4 Shelly roller shutter controllers + heat pump monitoring + ESPHome placeholders). 50+ tags, 4 MQTT sources (Zigbee2MQTT, dds661, Solarman HA bridge, Shelly), 6 alarms. `SETUP.md` includes the HA automation YAML for the Solarman→MQTT bridge. `CREDITS.md` lists all data sources.
- **8 new SVG icons** (`sws-editor/public/symbols/`) — Material Design Icons (Apache 2.0 / Pictogrammers): `solar-panel.svg`, `solar-power-variant.svg`, `battery-charging-high.svg`, `transmission-tower.svg`, `home-lightning-bolt.svg`, `garage-open-variant.svg`, `window-open-variant.svg`, `roller-shade.svg`. All pre-colored for dark-background dashboards. `ATTRIBUTION.md` updated.

- **Page dimensions** — `SynopticPage` gains optional `width` and `height` fields. When set, the editor canvas renders a dashed blue boundary rect at `(0,0,width,height)` in SVG space. The `PageProps` right-panel now exposes two number inputs (Larghezza/Altezza) with empty = fluid. Both fields are persisted in YAML via the Rust `SynopticPage` mirror.

- **Grid layout object** (type `"grid"`, Session 1) — A new object type for designing tabular layouts:
  - Configurable rows/columns (`grid_rows`, `grid_cols`), optional per-column widths and per-row heights.
  - Per-cell properties: `bg_color`, `bg_image` (URL), static `visible`, tag-driven `visible_tag`, `on_press_fn` / `on_release_fn` Python hook bindings, `rowspan` / `colspan` for cell merging.
  - `grid_show_borders` (default true) — when false the grid is invisible at runtime (no borders/background) while children remain visible. Useful as a layout-only container.
  - Two-level hit-testing in the canvas: clicking anywhere on the grid selects it; clicking inside a cell selects both the grid and the cell, revealing a `GridCellEditor` section in the right-side properties panel.
  - `GridCellEditor` panel: bg color, bg image URL, visibility (static + tag), on_press/on_release function pickers, rowspan/colspan.
  - Object palette button: "+ Griglia" in LeftPanel.
  - `store/index.ts`: `updateGridCell(pageId, objectId, cell)` upserts a cell by `{row, col}` in `grid_cells`; `updatePageProps` extended to include `width`/`height`.
  - Rust `synoptic.rs` mirrors all new fields (`grid_rows`, `grid_cols`, `col_widths`, `row_heights`, `grid_cells`, `grid_show_borders`, `grid_border_color`) as `Option<Value>` for round-trip YAML persistence.
  - Session 2: `GridCell.child?: SynopticObject` — an inline object rendered centered in its cell. In edit mode the child is non-interactive (`pointerEvents: none`); in runtime mode it is fully interactive (tag writes, script calls, navigation). Cut/paste workflow: Ctrl+X on a selected cell with a child cuts the child to the clipboard; Ctrl+V when a cell is selected pastes the first clipboard item as the cell child. Both operations also work in reverse (Ctrl+X page object → Ctrl+V into cell, and vice versa). `GridCellEditor` displays child type + a "Rimuovi" button and a paste hint when no child is present. New store action `setClipboard(objs)` to set the clipboard directly without going through a selection.

- **Script output toast** (`RuntimeView`) — when an `on_press_fn` / `on_release_fn` produces stdout, stderr, or fails (including timeout), a card toast appears bottom-right over the canvas. Auto-closes after 5 s (success) or 10 s (error). Manual × dismiss. Stacks up to 4 cards. stdout in white, stderr in amber, errors in red. Silent success (no output) generates no toast.

- **Script preemption** (`sws-pyscript`) — Python infinite loops are now interrupted at runtime:
  - New `KillSwitch` PyO3 class (`is_set()` → `AtomicBool::load`) injected as `__sws_kill_switch__` into every script run.
  - `sys.settrace` installs a per-bytecode-boundary trace function that calls `is_set()`. Cost: one atomic load per Python call/line/return event.
  - A `std::thread::spawn` timer thread flips the switch after `SWS_SCRIPT_TIMEOUT_MS`.
  - On detection, `KeyboardInterrupt` is raised; the inner `except KeyboardInterrupt` clause in the harness turns it into a clean `TimeoutError: script exceeded the configured timeout` error string.
  - `sys.settrace(None)` in a `finally` block ensures the trace is always cleared on exit, leaving the `spawn_blocking` pool thread in a sane state.
  - Limitation: blocking C extensions (`time.sleep`, network I/O in C code) are not preempted by the trace. The existing Tokio-level `timeout` remains as the hard backstop for those cases.

- **`RuntimeUnavailableError`** (`api/client.ts`) — distinguishes "runtime not running" from "wrong password":
  - `request()` now wraps `fetch()` in a try/catch; a network error (`TypeError: Failed to fetch`) or a 502/504 gateway response throws `RuntimeUnavailableError` instead of propagating raw.
  - `LoginScreen` shows "Runtime non raggiungibile. Avvia ./scripts/dev.sh e riprova." instead of "Credenziali non valide." when the runtime is unreachable.
  - `ReAuthModal` shows "Runtime non raggiungibile." for the same case.

- **Re-auth modal** — when the Bearer token expires mid-session a modal overlay "Sessione scaduta" appears over the editor instead of redirecting to the full login screen. The user re-enters only their password (username pre-filled from the store). On success the new token is stored and the editor state is preserved. On dismiss the session is cleared and the normal LoginScreen is shown.
  - `api/client.ts`: fires `sws:session-expired` CustomEvent when a request returns 401 and a token was present.
  - `store/index.ts`: new `reAuthNeeded: boolean` flag and `setReAuthNeeded()` action.
  - `App.tsx`: listens for the event and sets `reAuthNeeded`; renders `<ReAuthModal>` overlay.
  - New `components/ReAuthModal.tsx`.

- **Alarm webhook notifications** — `AlarmDef` gains `notify_url?: string`. When an alarm transitions to ACTIVE and `notify_url` is set, a best-effort HTTP POST is fired within 5 s (reqwest 0.12, rustls-tls). Payload: `{id, message, severity, tag, ts_ms, value}`. Errors are logged as warnings (never fatal). UI: `ConfigView` shows a URL input below the message field in the alarm table row.
  - `reqwest 0.12` added to workspace and `sws-runtime` Cargo.toml (rustls-tls + json features).
  - Alarm webhook dispatcher task spawned in `sws-runtime/main.rs` (subscribes to `AlarmDb.subscribe()` broadcast).

- **Log file v2** — historical log browser in the log panel:
  - `GET /api/logs/files` (Operator+): lists `runtime-YYYY-MM-DD.jsonl` files in `logs_dir` sorted newest-first with `size_bytes`.
  - `GET /api/logs/file?date=YYYY-MM-DD` (Operator+): reads a historical JSONL file and returns `Vec<LogEvent>`.
  - `AppState` gains `logs_dir: Arc<PathBuf>`; passed from `main.rs`.
  - `LogPanel` updated: when log files exist a date dropdown + "Carica" button appear. Loading a file enters "hist mode" (amber header, static source). "← Live" returns to the ring buffer and refreshes the file list. All filters (levels, search, target) apply to historical data.

- **Historian v2** (`sws-historian`):
  - SQLite fallback for `query()`: when `from_ms` precedes the oldest in-memory sample, the missing range is fetched from SQLite (`store.query_range()`) and prepended — trend widget can now scroll back beyond the ring-buffer window.
  - Uniform-stride decimation: when a query returns > 1 000 samples the result is thinned to exactly 1 000 points (first and last always preserved) to keep trend rendering fast for wide time windows.
  - `Historian::prune_older_than_ms(cutoff_ms)`: deletes SQLite rows outside the retention window (no-op when no store is attached). 7 unit tests in `sws-historian`.
  - Runtime prune task in `sws-runtime/main.rs`: spawned after the recorder, runs once at startup then every 24 h. Retention controlled via `SWS_HISTORIAN_RETENTION_DAYS` (default 30).
- **Selection rectangle** (`SvgCanvas.tsx`):
  - Drag on empty canvas background (left-button, edit mode only) draws a blue dashed selection rect overlay.
  - On release, all objects whose bounding boxes intersect the rect are selected (`onSelectMany`). Lines use the AABB of their two endpoints.
  - A `suppressClick` ref prevents the SVG `onClick` from deselecting immediately after a successful rect-selection completes.
  - Wired via `onSelectMany` prop → `store.selectMany()` in `EditorShell.tsx`. Compatible with existing shift-click multi-select flow.

- **Multi-Project IDE — Phase A2 (upload ZIP)**:
  - Backend: `POST /api/projects/upload` (pre-auth). Accetta body `application/zip`, legge `manifest.json` per il nome (sovrascrivibile con `?name=`), estrae il contenuto in `projects_root/<name>/`. Rifiuta path traversal. Rollback su errore. 201 `{"name"}` o 409.
  - Frontend: `api.uploadProjectZip(file, name?)` + terzo tab "Da ZIP" nella `NewProjectModal` (file picker, nome auto-filled, fallback al manifest).

- **Multi-project IDE — Phase A1 frontend complete**:
  - `NoProjectError` in `api/client.ts`: 503 dal runtime (nessun progetto aperto) diventa un errore tipizzato che il mount flow di `App.tsx` gestisce in modo dedicato.
  - Nuovi metodi API in `api/client.ts`: `listProjects()`, `createProject()`, `openProject()`, `closeProject()`, `listTemplates()`. Tutti pre-auth (nessun token richiesto).
  - Nuovi tipi `ProjectListEntry` e `TemplateEntry` in `types/index.ts`.
  - `noActiveProject: boolean` nello store Zustand + `setNoActiveProject()`.
  - `WelcomeScreen` (`components/WelcomeScreen.tsx`): lista dei progetti con ultima modifica, click per aprire, modal "+ Nuovo progetto" con due tab (Vuoto / Da template — la seconda mostra i template da `GET /api/templates`). Dopo `openProject()` il backend invalida tutte le sessioni → l'utente viene mandato alla LoginScreen.
  - `App.tsx` mount flow aggiornato: al boot chiama `GET /api/project` — 503 → WelcomeScreen (clearAuth), 401 → LoginScreen, 200 → app normale. Compatibile con `--project` legacy (il progetto è già aperto al boot, comportamento invariato).
  - `MainMenu` aggiornato: nuovi item "Chiudi progetto" (chiama `/api/projects/close` + redirect a WelcomeScreen) e separatore sopra "Esci".

- **Multi-project IDE — Phase A1 backend complete (frontend ancora vecchio, UI welcome rinviata)**:
  - `sws-runtime` nuovi CLI args: `--projects-root <dir>` (default `/var/sws/projects`), `--templates-root <dir>` (default `/var/sws/templates`). Il flag legacy `--project <path>` ora è opzionale: quando valorizzato fa auto-open di quel progetto al boot (backwards compat per dev.sh e container operator).
  - `AppState.project_dir` da `Arc<PathBuf>` immutabile a `Arc<RwLock<Option<PathBuf>>>` (nuovo type alias `ActiveProjectDir`). Helper `active_dir(state) -> Result<PathBuf, StatusCode>` usato in tutti i handler che leggevano `state.project_dir`: returnano 503 SERVICE_UNAVAILABLE quando nessun progetto è attivo.
  - Nuovi endpoint pre-auth (montati nel layer "open" insieme a `/health` e `/api/auth/login`):
    - `GET /api/projects` → lista cartelle in `projects_root` con `project.yaml` dentro (per la WelcomeScreen).
    - `POST /api/projects` body `{ name, template? }` → crea cartella sotto `projects_root`. Se `template` è valorizzato copia ricorsivamente da `templates_root/<id>/`, altrimenti scrive un `project.yaml` minimo. 409 se esiste già, 400 su nomi invalidi.
    - `POST /api/projects/:name/open` → switch progetto in-process: TagDb.clear + populate, AlarmDb.load, supervisor.reload, functions registry swap, AuthState.swap_store. Tutti i token correnti vengono invalidati (force re-login).
    - `POST /api/projects/close` → libera tutto: TagDb.clear, AlarmDb load([]), supervisor.reload([]), functions clear, AuthState.clear.
    - `GET /api/templates` → lista subfolders di `templates_root` con metadata da `<dir>/template.yaml` (id + label + description).
  - Nuovi moduli `sws-web/src/projects.rs` e `sws-web/src/templates.rs` + helper `copy_dir_all` (skip-list per `template.yaml`) + `safe_project_name` (rifiuta vuoti, `.`, `/`, `\\`, traversal, >64 chars).
  - `sws-auth::AuthState` esteso con `swap_store`, `clear`, `empty` per supportare lo switch project senza ricreare l'Arc.
  - `sws-core::TagDb::clear()` per resettare i tag a sufficienza.
  - `scripts/dev.sh` migrazione automatica `.run/project/` → `.run/projects/dev/` + nuovi flag `--projects-root` / `--templates-root` al runtime. L'auto-open su `dev` resta (backwards compat per il workflow esistente).
  - 33 unit test workspace (3 nuovi: 2 per `safe_project_name`, 1 per `copy_dir_all`).
  - **Frontend ancora invariato**: usa le rotte legacy. La WelcomeScreen + entry "Apri/Chiudi progetto" nel MainMenu arrivano nella prossima sessione (Phase A1 completion). Upload ZIP da PC in Phase A2.

### Changed
- **Multi-project IDE — Phase A1 foundations (prep, niente UI nuova ancora)**:
  - `examples/demo/` → `examples/templates/demo-items/` (git rename). Aggiunto `template.yaml` con `{ id, label, description }` per la futura template gallery.
  - `examples/README.md` riscritto per documentare la nuova convenzione `examples/templates/<id>/`.
  - `scripts/dev.sh` aggiornato per seedare da `examples/templates/demo-items/` (escludendo `template.yaml`). Layout `.run/project/` invariato — la migrazione `.run/projects/dev/` arriva nella prossima sessione insieme alla welcome screen.
  - `sws-core::TagDb` — nuovo metodo `clear()` per svuotare tutti i tag (usato dal project switch su `open`/`close`).
  - `sws-auth::AuthState` — esteso per supportare project switching:
    - `store_path: Option<PathBuf>` → `RwLock<Option<PathBuf>>` per swap in-place.
    - Nuovo `swap_store(new_path, seed)` che retarget il `users.yaml` su un altro progetto, invalida tutte le session correnti (force re-login), e ricarica utenti.
    - Nuovo `clear()` per chiudere lo stato auth quando nessun progetto è attivo.
    - Nuovo `empty()` costruttore per AppState in "no active project" mode.
  - Nessuna API esposta cambiata in questa sessione — l'integrazione con `AppState` / nuovi endpoint `/api/projects/*` / `WelcomeScreen` segue nelle sessioni successive.

### Changed
- Demo `examples/demo/synoptics/{Page 1..Page 4}.yaml` riscritte con id stabili (`page1`/`page2`/`page3`/`page4`) e header di navigazione uniforme: ogni pagina ha due `navbutton` `◀ Precedente` / `Successiva ▶` in cima con `target_page` che realizza nav circolare (1↔2↔3↔4↔1) + un `text` con titolo pagina. Risolve il problema della Page 3 duplicata (`Page 3.yaml` + `Page 3 – Showcase.yaml` con stesso id) e dei navbutton orfani che puntavano a id random non più esistenti. Il widget `p3_navbutton` (showcase del tipo navbutton) ora punta correttamente a `page1`.

### Added
- `sws-editor`: **animazione opzionale dei binding** — nuovo campo per-oggetto `transition_duration_ms` (0..5000 ms, default 0 = disattivata). Quando > 0, le modifiche bindate ai prop CSS-animabili (`fill`, `stroke`, `opacity`, `transform`/rotation) interpolano linearmente con easing `ease-out` invece di fare il "jump" istantaneo. Slider + numeric + reset nella sezione TRASFORMAZIONE di ObjectProps, sezione "DURATA TRANSIZIONE" in `MultiSelectionProps` per applicarla in batch su più oggetti selezionati. Rust mirror `transition_duration_ms: Option<u64>` su `SynopticObject` (serde, `skip_serializing_if`). Limitazioni v1: prop non-CSS-animabili (testo, font_size, src image, x/y come attributi SVG raw, gauge needle angle, progress_bar width) restano discreti; rotation 360°→0° interpola attraverso 180° (no shortest-path).
- `sws-editor`: menu a tendina **"☰ Menu"** nell'header (sempre visibile) — Salva tutto (solo edit, con feedback cromatico: grigio/verde/rosso a seconda dello stato), Esporta progetto, Importa progetto (Admin), Esci. Lo stato del salvataggio (`saveSerial`/`saveStatus`/`saveError`) è spostato nel Zustand store così il pulsante riflette la risposta senza prop drilling.
- `sws-editor`: menu a tendina **"Griglia"** nell'header (solo modalità edit) — selettore dimensione (Off/5/10/20/40 px) e checkbox snap. Sostituisce le impostazioni griglia che erano nel fondo del LeftPanel.
- Demo: **Page 3 "Showcase"** completa con un esemplare di ogni tipo di widget (rect, ellipse, line, text, button, navbutton, led, progress_bar, gauge, slider, checkbox, radio, table, symbol, image) e tag demo.* multipli (`demo.visible`, `demo.on`, `demo.value`, `demo.color`, `demo.font_size`, `demo.min`, `demo.max`) aggiornati in `examples/demo/project.yaml`. Ogni widget ha bindings su almeno rotation, opacity e una proprietà tipo-specifica.

### Fixed
- `sws-editor`: oggetti `symbol` non selezionabili nell'area di lavoro quando aggiunti dal pannello sinistro. Causa: `<g>` SVG non genera un bounding box per pointer events e tutti i figli visivi avevano `pointerEvents: "none"`. Fix: rimosso `onMouseDown` dal `<g>`, aggiunto `<rect fill="transparent">` come hit-area con le stesse dimensioni del bounding box (stesso pattern già usato per il gauge). Ora i simboli sono selezionabili, draggabili e ridimensionabili da qualsiasi punto del bounding box.
- `sws-editor` `BindableInput`: il pulsante 🔗/🔓 non era cliccabile nelle celle strette di layout a 2 colonne (es. X/Y/W/H). Causa: la cella sorella (successiva nel DOM, stesso stacking context statico) copriva l'eventuale overflow del pulsante intercettandone i click. Fix: `position: relative; zIndex: 1` sul button — crea un positioned element con z-index > 0 che sovrasta le celle statiche adiacenti.

### Fixed (previous session)
- `sws-editor`: il bottone "Salva" del LeftPanel salvava SOLO la pagina synoptic corrente, ignorando tag/sources/alarms/funzioni Python/custom_symbols + tutte le altre pagine. Modifiche fatte nel `FunctionEditor` o nelle altre pagine andavano perse silenziosamente se l'utente cliccava "Salva" senza essere passato dalla tab specifica di ConfigView / dal bottone "Salva funzioni". Ora "Salva tutto" persiste in parallelo: ogni `SynopticPage` + (se Admin) `PUT /api/project/{tags,sources,alarms,functions,custom-symbols}` via `Promise.allSettled` con feedback chip "Salvataggio…" / "✓ Salvato" / "❌ Errore — clicca per ritentare" + tooltip con il dettaglio dell'errore.

### Added
- `sws-editor`: cross-cutting `rotation/flip_h/flip_v/opacity` su rect, ellipse, text, image, gauge, led, progress_bar, table, button, navbutton, symbol. Sezione "TRASFORMAZIONE" nell'ObjectProps panel (slider + numeric + reset per rotazione/opacità, checkbox flip). `applyTransform` helper in `SvgCanvas`; selection rect e quality dot restano axis-aligned.
- `sws-editor`: `bindings: Record<string, string>` su `SynopticObject` — mappa generica prop→tag per binding live a runtime. `resolveObject` in `SvgCanvas` sovrascrive i valori statici con il valore live del tag al momento del render.
- `sws-runtime`: campi `opacity` e `bindings` su `SynopticObject` Rust (serde round-trip, skip_serializing_if per compattezza YAML).
- `sws-editor`: componente `BindableInput` — toggle 🔗/🔓 accanto a ogni campo del pannello proprietà. Click sul lucchetto aperto mostra un `TagInput` per associare la proprietà a un tag live; il lucchetto chiuso rimuove il binding. Sezione "BINDING ATTIVI" in fondo al pannello mostra tutti i binding attivi del widget con pulsante × per rimozione rapida.
- Demo: Page 2 welcome (id `mp472aq9q3yzc` — fixa il navbutton orfano in Page 1) + Page 3 "Demo Binding" (oggetti rect/ellipse/text/button/navbutton/led/gauge/progress_bar/image/symbol/table con `bindings.rotation=demo.rotation` e `bindings.opacity=demo.opacity`; 2 slider per pilotarli). 4 nuovi tag: `demo.rotation`, `demo.opacity`, `demo.label`, `demo.fill_color`.
- `sws-editor`: `BindableInput` copertura completa — tutti i campi rimanenti ora hanno il toggle, inclusi x/y/width/height/x2/y2, font_family, soglie gauge e progress_bar (warn_low/warn_high/alarm_low/alarm_high), slider min/max/step, checkbox/radio/LED label, trend (window_s/y_min/y_max/line_color), colori stato symbol, z_index.
- `sws-editor`: sezione "BINDING RAPIDO" in `MultiSelectionProps` — select prop + TagInput + "Applica"/"Rimuovi" per applicare o togliere lo stesso prop→tag binding a tutti gli oggetti multi-selezionati in un click.
- Demo `Page 4` — "Fill Color": 6 pulsanti preset (rosso/verde/blu/arancio/viola/teal) che scrivono un hex string in `demo.fill_color`; rect/ellipse/button/progress_bar con `bindings.fill = demo.fill_color`; nav da Page 3 → Page 4.

### Fixed
- `sws-editor` `BindableInput`: il pulsante 🔗/🔓 non era cliccabile nelle celle strette di layout a 2 colonne (es. X/Y/W/H). Causa: la cella sorella (successiva nel DOM, stesso stacking context statico) copriva l'eventuale overflow del pulsante intercettandone i click. Fix: `position: relative; zIndex: 1` sul button — crea un positioned element con z-index > 0 che sovrasta le celle statiche adiacenti.
- `sws-editor`: rotation + flip per gli oggetti `symbol`. Sezione properties con slider -180°/+180° + numeric input + reset, checkbox flip orizzontale/verticale. Trasform SVG applicata solo al visual del simbolo (selection rect e status badge restano axis-aligned per leggibilità). Persistenza YAML round-trip garantita dai nuovi campi `rotation/flip_h/flip_v` sul `SynopticObject` Rust.
- `sws-editor`: rinomina pagine — doppio click sul nome o icona ✎ apre input inline; Enter conferma, Esc annulla. Conferma sul × delete con messaggio "annullabile con Ctrl-Z" che richiama l'undo già esistente.
- `sws-editor`: navbutton con `target_page` puntante a pagina eliminata → bordo rosso del select + chip warning "⚠ pagina inesistente: <id>" + testo esplicativo. Prima sparivano silenziosamente; ora sono visibili e correggibili.

### Fixed (continued)
- `sws-runtime`: pannello log sempre vuoto da quando è stato introdotto. `EnvFilter::from_default_env()` con `RUST_LOG` non settata torna un filtro vuoto che rifiuta TUTTI gli eventi → niente arrivava al `LogBus`, niente al pannello, niente sul disco (anche il `stdout` capture di `dev.sh` era 0 byte e nessuno lo notava). Fix: fallback a `EnvFilter::new("info")` quando l'env var manca. Override via `RUST_LOG=debug` etc. continua a funzionare.
- `sws-editor`: il pannello log mostrava solo `target` e `message`, scartando i `fields` strutturati (es. la riga "MQTT publish" perdeva `tag`, `topic`, `payload`). Ora i fields appaiono come chip `key=value` inline dopo il messaggio; sono inclusi anche nella ricerca testuale.
- `sws-plugin-mqtt`: aggiunto `debug!` su match in entrata con `tag/topic/value` → con `RUST_LOG=sws_plugin_mqtt=debug,info` (o `RUST_LOG=debug`) si vede ogni payload ricevuto, non solo quelli pubblicati. Topic non mappati restano a livello `trace` per non spammare.

### Added
- `sws-runtime`: persistenza log su file con rotazione giornaliera. Nuovo modulo `log_file` che si sottoscrive a `LogBus` (broadcast) e scrive ogni evento come riga JSONL in `<logs_dir>/runtime-YYYY-MM-DD.jsonl`. La directory default è `<project>/../logs` (sibling del project dir), override via flag CLI `--logs <path>`. Retention configurabile via `SWS_LOG_RETENTION_DAYS` (default 7 giorni); i file più vecchi del cutoff vengono eliminati allo startup. Formato file = identico al wire format di `GET /api/logs` / `WS /ws/logs`, così `cat runtime-*.jsonl | jq .` mostra lo stesso shape che vede il pannello log dell'editor. Errori del writer escono su stderr per evitare feedback loop attraverso il subscriber tracing. Una nuova dipendenza workspace (`time` 0.3, già presente come transitive). 4 unit test (date_from_ts_ms, date_minus_days con leap year + year boundary, prune_old, writer end-to-end via TestDir helper RAII).
- `sws-editor`: widget `image` abilitato in palette — campo URL in properties panel, rendering `<image>` SVG già funzionante
- `sws-editor`: tab "Risorse" in ConfigView — aggiunta/rimozione simboli SVG custom con registrazione obbligatoria licenza (CC0/CC-BY/Apache-2.0/MIT/BSD/Public domain), autore e fonte
- `sws-core`: tipo `CustomSymbol { id, label, url, attribution }` + campo `custom_symbols` in `Project`; incluso in export/import ZIP
- `sws-web`: `PUT /api/project/custom-symbols` (Admin-only) — persiste in `project.yaml`
- `sws-editor`: `SymbolSelect` component con gruppo `<optgroup>` "Simboli progetto" che mostra i simboli custom accanto ai 15 built-in
- `sws-editor`: `SvgCanvas` accetta prop `customSymbols`; simboli con `symbol_id: "custom:<id>"` renderizzati come `<image href>` con badge stato

### Fixed
- `sws-editor`: gauge non selezionabile/draggabile — aggiunto `<rect fill="transparent">` come hit-area nel bounding box del gauge (il `<g>` SVG non riceve eventi se tutti i figli hanno `pointerEvents: none`)


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

### Added (project import/export + seeded demo)

Round-trip a complete SWS project as a single ZIP from the editor —
backups, sharing demos, snapshotting. Plus the dev project ships in the
repo so a fresh clone starts with a working canvas.

Demo seed
- New `examples/demo/{project.yaml, synoptics/Page 1.yaml}` — versioned snapshot of the dev project (5 tags incl. `demo.button` / `demo.led`, MQTT echo on broker.freemqtt.com, alarm, two Python functions, 11+ canvas objects: counter buttons, MQTT LED ON/OFF, slider, gauge, pump symbol).
- `scripts/dev.sh` copies `examples/demo/` into `.run/project/` only when `project.yaml` is missing. Subsequent runs keep maintainer edits. The inline heredoc remains as a last-resort fallback when `examples/demo/` is absent (e.g., shallow checkout).
- `examples/README.md` documents the seed contract and the recommended workflow for refreshing the snapshot from the editor.

Backend (sws-web)
- New `zip = "2"` dep (default features off — no flate2/miniz). Files inside the bundle use `CompressionMethod::Stored` since a project is a handful of small YAML files where compression saves nothing.
- Two new routes in `admin_routes`:
  - `GET /api/project/export` → `export_project_zip` builds a ZIP in memory: `manifest.json` + `project.yaml` (MQTT passwords stripped to `None`) + `synoptics/<safe_filename(name)>.yaml` per page. Response carries `Content-Type: application/zip` and `Content-Disposition: attachment; filename="sws-project-<name>-<utc>.zip"`. `users.yaml` is **never** included.
  - `PUT /api/project/import` → `import_project_zip` parses the ZIP from the raw request body, validates `format_version`, replaces `project.yaml` and synoptics on disk (replace mode — orphans deleted), and hot-reloads in sequence (TagDb diff, AlarmDb.load, supervisor.reload, functions registry swap). Defensive: any leftover `"********"` password sentinel is scrubbed to `None`.
- Self-rolled `unix_to_ymdhm` for the export filename so we don't pull in `chrono` just for `YYYY-MM-DDTHH-MM`.

Frontend (sws-editor)
- `api.exportProjectZip()` returns the raw `Response` so the caller can read `Content-Disposition` before turning the body into a Blob.
- `api.importProjectZip(file: Blob)` PUTs the raw ZIP bytes.
- New `src/components/ProjectIO.tsx`: header buttons "Esporta" / "Importa" + a hidden `<input type="file" accept=".zip">`. Admin-only — renders `null` for other roles. Confirm dialog before import warns about destructive replace + missing MQTT passwords. After import, refreshes project + synoptics from the server so the UI shows the new state.
- App.tsx wires `<ProjectIO />` between the mode tabs and the "Log" button.

### Added (runtime log panel + MQTT echo demo)

Live runtime logs in the editor: every `tracing::{info,warn,error}!` event is
captured into an in-memory ring + broadcast and streamed to a bottom-drawer
panel in the editor.

Backend
- New `sws-core::logbus` module: `LogBus` (1000-entry `VecDeque` + `tokio::sync::broadcast::Sender`), `LogEvent { ts_ms, level, target, message, fields }`, `DEFAULT_LOG_CAPACITY = 1000`. Two unit tests cover ring eviction and live broadcast.
- New `sws-runtime/log_layer.rs`: `LogBusLayer` impl of `tracing_subscriber::Layer` with a `FieldVisitor` that splits the message from structured fields (bool/i64/u64/f64/str/debug). The fmt-to-stdout JSON layer continues to run in parallel — both subscribers see every event.
- `sws-runtime/main.rs` constructs `Arc<LogBus>` before subscriber init, composes `registry().with(env_filter).with(fmt::layer().json()).with(LogBusLayer::new(...))`, and threads the bus into `sws_web::router::build(...)`.
- `sws-web::AppState.logs: Arc<LogBus>`. New routes `GET /api/logs` (snapshot) and `GET /ws/logs` (snapshot-then-tail) sit in `operator_routes` so Viewer is gated out. The WS handler swallows `RecvError::Lagged` silently to avoid "log about logs" feedback loops.

Frontend
- New `LogEvent` + `LogLevel` types in `src/types/index.ts`. `api.client.getLogs()` and a new `src/ws/logStream.ts` (mirrors `alarmStream.ts`) drain `/api/logs` then attach a WS to `/ws/logs?token=…`. The hook is a no-op for Viewer / unauthenticated states so no socket gets opened.
- Zustand store gains `logs: LogEvent[]` (capped at 2000 client-side) plus `setLogs` / `appendLog` / `clearLogs`.
- New `src/components/LogPanel.tsx`: bottom drawer, 240 px high, fixed-flex layout. Header bar with Pausa (freezes a snapshot for inspection), Cancella, free-text search (case-insensitive, regex-escaped `<mark>` highlight of matches), target substring filter, and 5 colour-coded level toggles (TRACE/DEBUG off by default — too chatty for the PoC). List uses monospace cells (timestamp / level / target / message), auto-scrolls to bottom unless the user scrolls up, and falls back to either "nessun log" or "permesso insufficiente" empty states.
- `App.tsx` adds a "Log" toggle button next to the mode tabs (open/closed state persisted in `localStorage` as `sws.logPanel.open`) and renders the panel below `<main>`. `useLogStream()` is mounted at the App level so the snapshot survives mode switches.

Demo project — MQTT round-trip
- `.run/project/project.yaml` gains two bool tags (`demo.button`, `demo.led`) and two new MQTT topic mappings on `sws/demo/echo` (publish on the button tag, subscribe on both). Pressing the button writes `demo.button=true` → rumqttc publishes → broker.freemqtt.com echoes → both tags receive `true` → LED lights up. No external bridge required.
- `.run/project/synoptics/Page 1.yaml` gets a "MQTT Echo" button + a green LED indicator placed next to the existing slider.

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
