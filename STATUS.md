# SWS — Current Status

> This file is the **session-to-session memory** for Claude Code. Update it at the end of every session before stopping work. Read it at the start of every session before touching code.

**Last session**: 2026-05-17 (sessione 18: arrow nudge + zoom/pan + object lock + LeftPanel filter)
**Current phase**: Phase 2. Demo working out-of-the-box su fresh clone, import/export progetto per backup/condivisione, pannello log live + persistenza su disco, gestione utenti multi-account.
**Last commit**: (vedi CHANGELOG [Unreleased] per i dettagli della sessione corrente)

### Cosa è andato online in queste sessioni (in ordine di commit)
- (sessione 2026-05-17, sessione 18) **Object lock** — campo `locked?: boolean` su `SynopticObject`. Se `true` in edit mode, l'oggetto ignora i click (non selezionabile né trascinabile). Toggle "Bloccato" nella sezione LAYER del pannello proprietà (checkbox ambra). Indicatore 🔒 in LeftPanel ObjectsSection accanto al tag del tipo.
- (sessione 2026-05-17, sessione 18) **LeftPanel object filter** — input "Filtra per nome / tipo…" in cima alla sezione "OGGETTI PAGINA". Filtra per `o.name`, `o.type` e `o.id` in real-time (case-insensitive). Messaggio "Nessun oggetto corrisponde al filtro." quando vuoto. Il titolo della sezione mostra il conteggio totale (non filtrato).
- (sessione 2026-05-17, sessione 18) **Canvas zoom + pan** — `SvgCanvas`: rotella → zoom centrato sul cursore (Ctrl + rotella); scroll mouse → pan verticale; Shift + scroll → pan orizzontale; Ctrl+0 → reset 100%. Click medio (button 1) + drag → pan libero. Tutti i contenuti del canvas sono dentro `<g transform="translate(panX,panY) scale(zoom)">`. Badge zoom percentuale visibile quando ≠ 100%. Il grid pattern usa un rect enorme (100 000×100 000) per coprire l'area panata. Handle resize e endpoint linea scalati inversamente (`size / zoom`) per restare invarianti allo zoom. Coordinate mouse → SVG user space tramite `toSvg(screenX, screenY)` = `(x - panX) / zoom`. Listener `wheel` aggiunto via `useEffect` con `{passive: false}` per poter chiamare `preventDefault`.
- (sessione 2026-05-17, sessione 18) **Arrow key nudge** — in edit mode con un oggetto selezionato, i tasti freccia muovono l'oggetto di 1 px (plain) o `gridSize` px (Shift+freccia). Le linee aggiornano anche `x2/y2` per preservare la forma. Nessuna azione se il focus è in un input o textarea.
- (sessione 2026-05-17, sessione 17, commit 5fe5665) **Line endpoint handles** — selezione di una linea mostra due cerchi bianchi/gialli sugli endpoint. Trascinare p1 aggiorna (x,y), p2 aggiorna (x2,y2). Snap-to-grid attivo. `ResizeState.startObj` esteso con x2/y2 opzionali.
- (sessione 2026-05-17, sessione 17, commit fa09ed9) **Z-order reorder + Ctrl+A** — `ZOrderBar` nel pannello proprietà (4 pulsanti ⬆⬆/↑/↓/⬇⬇). Shortcuts: Ctrl+]/[ avanti/indietro, Ctrl+Shift+]/[ primo/ultimo piano. Ctrl+A seleziona tutto. Store: `reorderObject(id, dir)` con pushHistory.
- (sessione 2026-05-17, sessione 17, commit 67ddb6d) **Visual resize handles** — selezionando un oggetto singolo (non linea, non griglia, non ruotato) compaiono 8 maniglie bianche/gialle agli angoli e ai punti medi dei lati. Trascinarle ridimensiona l'oggetto in tempo reale via `onMove`. Angoli cambiano posizione + dimensione; lati cambiano solo una dimensione. Minimo 4px, snap-to-grid attivo. `ResizeState` interface + `resizeRef` in SvgCanvas, strato SVG separato sopra tutti gli oggetti, mutuamente esclusivo con drag e selection-rect.
- (sessione 2026-05-17, sessione 17, commit f510dbf) **Context-sensitive properties panel** — il pannello destra mostra ora solo il livello rilevante: griglia senza cella → ObjectProps griglia; cella selezionata → GridCellEditor (chip col tipo del figlio + Taglia/Rimuovi + hint "clicca nel canvas"; nessuna cella → type picker + Aggiungi); figlio sub-selezionato → ObjectProps del figlio con breadcrumb `griglia › R,C › tipo`. `PanelBreadcrumb` component inline. `GridCellEditor` semplificato: rimosso ObjectProps annidato e prop `pages` ora inutilizzata.
- (sessione 2026-05-17, sessione 17) **Grid child mouse selection** — click su cella griglia seleziona la cella; secondo click su oggetto figlio sub-seleziona il figlio con highlight teal tratteggiato. Transparent overlay rect attivo solo quando `isCellSel`. `selectedCell` / `selectedCellChild` spostati nello Zustand store (erano `useState` locale in EditorShell). Keyboard handler aggiornato a `useAppStore.getState().selectedCell` per evitare stale closure. Props `selectedCellChild` / `onSelectCellChild` aggiunti a SvgCanvasProps e ObjProps, passati lungo la catena `SvgCanvas → SvgObject`. `selectObject` / `clearSelection` / `setCurrentPage` / `undo` / `redo` ora azzerano entrambi i nuovi campi.
- (sessione 2026-05-17, sessione 17) **LeftPanel collapsible object tree** — sezione "OGGETTI PAGINA" ora mostra un toggle ▶/▼ per gli oggetti griglia con celle che hanno figli. Click sul toggle espande/comprime i sotto-rami; ogni sotto-ramo mostra tipo + nome del figlio + coordinate cella (R,C). Click sul sotto-ramo seleziona la griglia, la cella e il figlio nel canvas. Selezionare un figlio via canvas auto-espande il branch nel tree (useEffect su `selectedCellChild.objectId`). Implementato con `expandedGrids: Set<string>` locale + `React.Fragment` per interleave righe principali e sub-righe.
- (sessione 2026-05-17, sessione 17, commit 75db313) **Multi-selection common properties panel** — quando 2+ oggetti sono selezionati il pannello destra mostra le proprietà comuni: stesso tipo → `ObjectProps` completo con valori pre-filled (vuoto con placeholder "(vari)" se misti); tipi diversi → `CrossTypeProps` con sezioni universali (POSIZIONE, ASPETTO, TRASFORMAZIONE, VISIBILITÀ, TAG, QUALITÀ, EVENTI). Modifica applica a tutti gli oggetti selezionati. Undo (Ctrl-Z) ripristina tutti gli oggetti in un solo step (singolo `pushHistory` in `updateObjects`).
- (sessione 2026-05-17, sessione 17, commit 963d3e0) **Design-reference borders** — in edit mode tutti gli oggetti hanno un bordo contenitore tratteggiato (`stroke="#475569"`, `strokeDasharray="4 3"`, `opacity=0.5`, `pointerEvents="none"`). Per la griglia, ogni cella ha il proprio border tratteggiato (giallo se selezionata, grigio altrimenti). Visibile solo nell'editor, mai a runtime.
- (sessione 2026-05-17, sessione 17) **GridCellEditor con ObjectProps completo** — il pannello di editing per il figlio di una cella ora usa `<ObjectProps>` completo (stesso componente usato per gli oggetti di pagina) invece dei campi limitati. Aggiunti `CELL_CHILD_TYPES`, `makeDefaultChild()`, type picker a dropdown e bottone "Aggiungi". La prop `pages` è passata tramite `GridCellEditor` per i navbutton.
- (sessione 2026-05-16, sessione 16) **Template bug fix** — DDS661 slug corretto da `contatore-rack-piano-superiore` a `contatore-rack-pianosuperiore` (4 topic in `project.yaml`). Nav home sovrapposto ai titoli di pagina in Page 3/4/5 spostato a x=155 w=55 con label "⌂".
- (sessione 2026-05-16, sessione 16) **Quality dot per-oggetto** — campo `quality_dot?: boolean` (default true, false nasconde il cerchio) + tre colori opzionali `quality_dot_good_color / bad / uncertain` su `SynopticObject`. `qualityColor()` e `QDot` in `SvgCanvas.tsx` aggiornati; tutti i 5 siti di render (rect/ellipse/text/progress_bar/gauge) aggiornati. Pannello "INDICATORE QUALITÀ" in `EditorShell.tsx` (checkbox + 3 color picker; appare solo se `obj.tag` è impostato). Round-trip YAML garantito da 4 nuovi optional field in `synoptic.rs`.
- (sessione 2026-05-16, sessione 16) **Project management nella WelcomeScreen** — elimina (DELETE + window.confirm, 409 se progetto aperto), rinomina (inline input nella card, Enter/Esc/onBlur), duplica (riga extra sotto la card con nome copia). Backend: `delete_project / rename_project / duplicate_project` in `projects.rs`; 3 nuove route nel router (+ import `delete` da axum::routing). Frontend: 3 nuovi metodi API in `client.ts`; WelcomeScreen aggiornata con `EditingState` + handler.
- (sessione 2026-05-16, sessione 15) **MQTT broker browse + quick-create variabili + layout responsive**. `Sfoglia broker` apre un modal che si connette al broker, sottoscrive `#` per 2–15 s e mostra i topic rilevati con anteprima payload e dropdown JSON path. Importazione massiva in un click. `＋` accanto a ogni TagInput in MQTT e Modbus apre `QuickCreateTagModal` (ID / descrizione / tipo); i tag creati vengono salvati insieme alle sorgenti al prossimo "Salva". Body della ConfigView ora usa tutta la larghezza disponibile (rimosso `maxWidth: 900`); colonna "Topic in" allargata. Backend: `browse()` in sws-plugin-mqtt + `POST /api/sources/mqtt/browse` (Operator+) in sws-web con risoluzione automatica della password mascherata dal project.yaml. `cargo check` + `pnpm build` verdi.
- (sessione 2026-05-16, blocco 4) **Template "Casa Locale"** — secondo template SWS, console di controllo domestica a 5 pagine su broker MQTT locale (192.168.1.6). Pagine: Panoramica (flusso energia + status sicurezza), Impianto Solare (PV + batteria + rete), Contatori Energia (3 DDS661 con gauge + tabella), Sicurezza (12 sensori Zigbee + 3 PIR perimetrali + presenza lux), Domotica (tapparelle Shelly con 3 pulsanti + PDC + ESPHome). Sorgenti: Zigbee2MQTT (16 topic), dds661 (17 topic), Solarman bridge HA (12 topic), Shelly (4 topic con publish_topic). 50+ tag, 6 allarmi. 8 nuove icone SVG Material Design Icons (Apache 2.0) scaricate come asset colorati in `public/symbols/`. Guide in `CREDITS.md` e `SETUP.md` (incl. automation HA per bridge Solarman → MQTT).
- `3631c37` BL-002 — MQTT auth/TLS/last-will/QoS + password masking
- `964e67b` BL-003 — CodeMirror Python editor full-screen per FunctionDef
- `dda777e` BL-001 — persistent multi-user store + admin CRUD + must_change_password gate
- `375c1cc` Runtime log panel (drawer in basso, filtri, highlight) + demo MQTT echo
- `e4a61f5` Fix `/api/auth/users` 404: App.tsx ora carica `/api/project` in tutte le modalità
- `b455f6b` Project import/export ZIP + seed `examples/demo/` in repo
- `05ffc74` Widget Image abilitato + simboli custom con tracking licenza
- (sessione 2026-05-14) Log persistence su disco — `runtime-YYYY-MM-DD.jsonl` rotato per data, retention 7 gg configurabile
- (sessione 2026-05-14) Fix critico salvataggio + multi-page UX polish + symbol rotation/flip
- (sessione 2026-05-15) Header dropdown menu (Salva/Esporta/Importa/Esci) + Grid dropdown + fix symbol hit-area + BindableInput z-index fix + Demo Page 3 Showcase completa
- (sessione 2026-05-15, blocco 2) Universal binding follow-up #8 — `transition_duration_ms` per-oggetto per animazione CSS dei prop bindati (fill/stroke/opacity/transform). UI in ObjectProps TRASFORMAZIONE + batch in MultiSelectionProps. Rust mirror per round-trip YAML.
- (sessione 2026-05-16, sessione 12) **`2581fee` Page dimensions + Grid layout object (Session 1)**. `SynopticPage.width/height` opzionali: il canvas editor mostra un bordo tratteggiato blu ai limiti della pagina. Nuovo tipo di oggetto `"grid"`: griglia N×M con per-cella bg_color/bg_image, visible/visible_tag, on_press_fn/on_release_fn, rowspan/colspan. Due-livelli di hit-test nel canvas: clic sulla cella seleziona la griglia + la cella, `GridCellEditor` compare nel pannello destra. Bordi togglable (`grid_show_borders`). `updatePageProps` estesa con width/height; nuova action `updateGridCell`. Rust `synoptic.rs` mirror completo.
- (sessione 2026-05-16, sessione 16) **Symbol library v2 — SymbolGallery + 5 nuovi builtin + 7 vendored**. `library.tsx`: 5 nuovi render functions builtin (heat_pump, temperature_sensor, boiler, agitator con CSS spin animation quando ON, cooling_tower). 7 nuovi entry vendored da SVG esistenti in `public/symbols/` (solar_panel, battery, transmission_tower, home_lightning, garage, window_open, roller_shade). Totale simboli: 22 (16 builtin + 6 vendored). `SYMBOL_LIST = Object.values(SYMBOLS)` esportato. `SymbolSelect` (dropdown plain) sostituito da `SymbolGallery`: griglia CSS 4 colonne, maxHeight 260px scrollabile, ogni tile mostra mini-preview SVG (builtin via render()) o `<img>` (vendored/custom), bordo blu quando selezionato, label 8px sotto. `pnpm build` verde.
- (sessione 2026-05-16, sessione 14) **Grid Session 2 — child objects + cut/paste**. `GridCell.child?: SynopticObject` aggiunto ai tipi. Canvas: ogni cella renderizza il figlio centrato nella cella (`(cellW-cw)/2, (cellH-ch)/2`); in edit mode `pointerEvents:none` (clic cade sulla cella), in runtime interattivo. Store: nuova action `setClipboard(objs)`. Editor: `selectedCellRef` per keyboard handler senza stale closure. Ctrl+X taglia il figlio dalla cella selezionata (o taglia gli oggetti di pagina se nessuna cella con figlio); Ctrl+V incolla il primo elemento del clipboard come figlio della cella selezionata (o incolla a livello pagina se nessuna cella selezionata). `GridCellEditor` mostra tipo del figlio + pulsante "Rimuovi" + hint Ctrl+V.
- (sessione 2026-05-16, blocco 3) **Script output toast** — quando un `on_press_fn` / `on_release_fn` produce stdout, stderr o un errore (incluso timeout), RuntimeView mostra una card toast bottom-right (max 4 visibili, auto-close 5 s successo / 10 s errore, × manuale). stdout bianco, stderr amber, errore rosso. Output silenzioso non genera toast.
- (sessione 2026-05-16, blocco 2) **Fix runtime panic Rustls CryptoProvider** — aggiungendo `reqwest` con feature `rustls-tls` veniva portato `hyper-rustls` che abilitava `aws-lc-rs` mentre `rcgen` abilitava `ring`. Rustls 0.23 panica se trova entrambi senza un provider esplicito. Fix: `rustls = { version = "0.23", features = ["ring"] }` nel workspace Cargo.toml + `rustls::crypto::ring::default_provider().install_default().ok()` all'inizio di `main()`.
- (sessione 2026-05-16, blocco 2) **Script preemption** — `sys.settrace` + `KillSwitch` PyO3 class + timer thread (`std::thread::spawn`). Infinite loops in Python scripts vengono interrotti al prossimo confine di bytecode dopo `SWS_SCRIPT_TIMEOUT_MS`. Il timer thread setta un `AtomicBool`; la trace function lo legge e lancia `KeyboardInterrupt`; il harness la cattura e la converte in stringa `TimeoutError`. Il Tokio-level timeout rimane come backstop per le C extension bloccanti. `sys.settrace(None)` in `finally` lascia il thread del pool in stato sano.
- (sessione 2026-05-16, blocco 2) **`RuntimeUnavailableError`** — `api/client.ts` distingue ora "runtime non avviato" da "password errata". `fetch()` wrappato in try/catch; 502/504 → `RuntimeUnavailableError`. `LoginScreen` mostra "Runtime non raggiungibile. Avvia ./scripts/dev.sh e riprova." invece del fuorviante "Credenziali non valide". Stesso in `ReAuthModal`.
- (sessione 2026-05-16) **Alarm webhook notifications** — `notify_url?: string` aggiunto ad `AlarmDef` (Rust + TS). Dispatcher task in `main.rs`: subscribe to `AlarmDb.subscribe()`, HTTP POST via `reqwest 0.12 rustls-tls` (5 s timeout, best-effort) su ogni transizione ACTIVE. Payload: `{id, message, severity, tag, ts_ms, value}`. UI in ConfigView: input URL sotto il campo messaggio. `reqwest` aggiunto a workspace Cargo.toml.
- (sessione 2026-05-16) **Re-auth modal** — quando il token scade mid-session viene mostrato un overlay modale "Sessione scaduta" che chiede solo la password (username pre-compilato). Su successo il nuovo token viene salvato e il lavoro in corso è preservato (Zustand store intatto). Su dismiss → logout + LoginScreen. Implementazione: `reAuthNeeded` store flag, evento DOM `sws:session-expired` da `api/client.ts` quando 401+TOKEN, listener in `App.tsx`, componente `ReAuthModal.tsx`.
- (sessione 2026-05-16) **dev.sh bug fix** — il ramo `both` non passava `--projects-root` e `--templates-root`; la WelcomeScreen vedeva sempre zero progetti e zero template.
- (sessione 2026-05-15, blocco 3) Pulizia demo — `examples/demo/synoptics/{Page 1..Page 4}.yaml` riscritte con id stabili `page1..page4` (prima random `mp2n48800ucav`, `mp472aq9q3yzc`). Ogni pagina ha un header coerente con due navbutton `◀ Precedente` / `Successiva ▶` per navigazione circolare (1↔2↔3↔4↔1) + titolo. `.run/project/synoptics/` rifresh completo (cancellati 5 file inclusi `Page 3.yaml` + `Page 3 – Showcase.yaml` duplicati con stesso id). Vecchi navbutton orfani rimossi da Page 1; p3_navbutton (widget showcase) ora punta correttamente a `page1`.
- (sessione 2026-05-15, blocco 7) **Multi-Project IDE — Phase A2 (upload ZIP)**. Backend: `POST /api/projects/upload` pre-auth in `projects.rs` (manifest.json per nome, `?name=` override, estrae ZIP in `projects_root/<name>/`, rollback su errore). Frontend: `api.uploadProjectZip()` + tab "Da ZIP" nella `NewProjectModal` con file picker, nome auto-filled dal filename, fallback al manifest.
- (sessione 2026-05-15, blocco 6) **Multi-Project IDE — Phase A1 frontend complete**. `NoProjectError` + API wrapping (`listProjects/createProject/openProject/closeProject/listTemplates`), `noActiveProject` in store, `WelcomeScreen` (lista + modal nuovo progetto + template gallery), mount flow `App.tsx` (503→WelcomeScreen, 401→LoginScreen, 200→app), "Chiudi progetto" nel MainMenu. `pnpm type-check` + `pnpm build` verdi.
- (sessione 2026-05-15, blocco 4) **Multi-Project IDE — Phase A1 foundations**. Piano completo in `/home/ut1/.claude/plans/prosegui-il-lavoro-quali-snoopy-muffin.md` (stima totale 6-8h, splittato A1+A2). Solo le fondamenta non-breaking sono in questa sessione: `examples/demo/` → `examples/templates/demo-items/` (git rename + `template.yaml`), `sws-core::TagDb::clear()`, `sws-auth::AuthState::{swap_store, clear, empty}` + `store_path: RwLock<Option<PathBuf>>`. Tutto il resto (AppState refactor, nuovi endpoint `/api/projects/*`, WelcomeScreen, MainMenu Apri/Chiudi, dev.sh migration a `.run/projects/dev/`, upload ZIP) rinviato.
- (sessione 2026-05-15, blocco 5) **Multi-Project IDE — Phase A1 backend complete**. Backend pronto end-to-end (frontend ancora vecchio, WelcomeScreen rinviata).
  - `AppState.project_dir` → `Arc<RwLock<Option<PathBuf>>>` con helper `active_dir(state)`. Tutti i ~10 handler che lo usavano (get_project, patch_project callsites, list_synoptics, save_synoptic, import/export ZIP, custom_symbols) ritornano 503 quando il progetto è chiuso.
  - Nuovi CLI args runtime: `--projects-root` (lista progetti), `--templates-root` (template gallery), `--project` ora opzionale (auto-open legacy).
  - Nuovi endpoint pre-auth montati nel layer "open": `GET/POST /api/projects`, `POST /api/projects/:name/open`, `POST /api/projects/close`, `GET /api/templates`. Tutti pre-auth — la WelcomeScreen pesca senza session token.
  - Nuovi moduli `sws-web::projects` (list/create/open/close + `safe_project_name`) e `sws-web::templates` (list + `copy_dir_all` recursive con skip-list).
  - `scripts/dev.sh` ora layout `.run/projects/dev/` (auto-migra `.run/project/` esistente al primo run). Lancia runtime con `--projects-root --templates-root --project` (l'ultimo per auto-open legacy).
  - 33 unit test workspace verdi (+3 nuovi).

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
- **Log file v2** — `GET /api/logs/files` lista i file JSONL storici con data e dimensione; `GET /api/logs/file?date=YYYY-MM-DD` legge e restituisce gli eventi di un file storico come `Vec<LogEvent>`. LogPanel aggiornato: dropdown date + pulsante "Carica", modalità storica (header ambra, sorgente statica), "← Live" per tornare al ring live. Tutti i filtri (livelli, cerca, target) funzionano anche sullo storico.
- **Fix dev.sh both-mode** — il ramo `both` non passava `--projects-root` e `--templates-root` al runtime; la WelcomeScreen vedeva sempre zero progetti e zero template. Fix: aggiunti i due flag al blocco di lancio in background.
- **Fix rename-page** — `save_synoptic` ora rimuove il file YAML stale quando una pagina viene rinominata (confronto per `id` interno, non per nome file).
- **Historian v2** (`sws-historian`): Ring-buffer in-memory (5000 samples × tag) + optional SQLite backing. `query()` falls back to SQLite for ranges older than the ring (prepends the gap). Uniform-stride decimation when result > 1000 samples (keeps first + last). `prune_older_than_ms()` deletes SQLite rows outside the retention window. Runtime spawns a 24 h prune task; retention controlled via `SWS_HISTORIAN_RETENTION_DAYS` (default 30). 7 unit tests in `sws-historian` (incl. decimation, ring-drop, SQLite-fallback shape).
- **GET /api/history/:tag**: query string `from`/`to`/`limit`; ritorna `Vec<Sample>` (ts_ms + value + quality).
- **Trend object** nell'editor: `<foreignObject>` con `<canvas>` 2D. Poll ogni 2 s, autofit Y, badge valore corrente, edit-mode placeholder statico per drag senza fetch. Property panel: tag, window_s, y_min/y_max (entrambi 0 → autofit), line_color.
- **Selection rectangle** (`SvgCanvas.tsx`): drag on empty canvas background (left-button, edit mode only) draws a blue dashed rect overlay and selects all objects whose bounding boxes intersect it. Lines use min/max of their two endpoints for the bbox. A `suppressClick` ref prevents the SVG `onClick` from deselecting immediately after a successful rect-selection. Wired via `onSelectMany` prop → `store.selectMany()` in `EditorShell.tsx`. Compatible with existing shift-click multi-select.
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
- **CodeMirror Python editor (BL-003)**: `PythonEditor` con `@codemirror/lang-python`, tema one-dark, line numbers, history/undo. `FunctionEditor` full-screen (header + aside parametri + editor): apre quando in LeftPanel si seleziona una function, snippet dropdown (increment/toggle/conditional/reset_many/diagnostic/skeleton), indicatore "modifiche non salvate", save bloccato finché clean.
- **MQTT esteso (BL-002)**: `MqttConfig` con `username/password/password_env` (env wins), `keep_alive_secs`, `clean_session`, `qos` (default 0), `tls: MqttTlsConfig { enabled, ca_cert_path, insecure_skip_verify }` — rumqttc 0.24 richiede `ca_cert_path` obbligatorio per TLS (no Native variant). `last_will: MqttLastWill { topic, payload, qos, retain }`. Per-topic `qos` opzionale. `MqttSourceCard` in ConfigView: sezioni Autenticazione / Connessione / TLS / Last Will, collassabili.
- **Password masking (BL-002)**: `GET /api/project` maschera le password MQTT come `"********"`; `PUT /api/project/sources` carica il project precedente dal disco e conserva la vecchia password se l'incoming contiene la sentinel.
- **Persistent user store (BL-001)**: `sws-auth` ora persiste in `users.yaml` (project dir). `AuthState::new_persistent(path, seed, ...)` carica esistenti o seeda dagli env. Admin seeded → `must_change_password: false`. Endpoint admin-only: `GET/POST /api/auth/users`, `PUT/DELETE /api/auth/users/:username`. Self-service: `POST /api/auth/change-password`. Middleware `require_password_changed` blocca tutto tranne whoami/logout/change-password con 403 + `{ error: "password_change_required" }`.
- **Frontend BL-001**: `ChangePasswordScreen` mostrato al posto dell'app quando `mustChangePassword === true`. Nuova tab *Utenti* in ConfigView (solo Admin) con tabella ruolo/forza-cambio-pwd/reset-pwd/elimina + form "+ Nuovo utente".
- **Test coverage**: 11 unit test in sws-auth (incl. last-admin protection, demote-last-admin protection, change-password clears flag, create/update/delete CRUD); 22 unit test totali nel workspace.
- **LogBus + pannello log**: `sws-core::LogBus` (ring 1000 + `tokio::broadcast`) + `sws-runtime/log_layer.rs` (custom `tracing_subscriber::Layer`) catturano ogni evento `tracing::info!/warn!/error!`. `GET /api/logs` per snapshot, `GET /ws/logs` per tail live — entrambi in `operator_routes` (Operator+). Pannello `LogPanel` come drawer in fondo all'editor (toggle "Log" nell'header, stato persistito in `localStorage`): timestamp ms, colore per livello, filtri checkbox per i 5 livelli (TRACE/DEBUG off di default), filtro substring sul target, ricerca full-text con `<mark>` di highlight, Pausa per congelare la vista, Cancella, auto-scroll che si stacca se l'utente scrolla su. Viewer vede solo un messaggio "permesso insufficiente". 24 unit test totali nel workspace (+2 per LogBus).
- **Demo MQTT round-trip**: `.run/project/project.yaml` ha due nuovi tag bool (`demo.button`, `demo.led`) mappati sul topic `sws/demo/echo` di `broker.freemqtt.com`. Pulsante "MQTT Echo" scrive `demo.button=true` → plugin pubblica → broker rimbalza → entrambi i tag ricevono il valore → la LED si accende. Niente bridging esterno, dimostra il publish/subscribe completo via MQTT 3.1.1.
- **Demo seedato nel repo**: `examples/demo/{project.yaml, synoptics/Page 1.yaml}` è uno snapshot versionato del progetto dev (5 tag, MQTT echo, alarm, 2 funzioni Python, synoptic con 11+ oggetti incl. buttons UP/DOWN, MQTT LED ON/OFF, slider, gauge, pump symbol). `scripts/dev.sh` lo copia in `.run/project/` solo se `project.yaml` non esiste, così un fresh clone parte con un editor pieno e i clone esistenti non vengono trampled.
- **Project import/export (Admin)**: due bottoni "Esporta" / "Importa" in header (solo Admin). Bundle ZIP `{manifest.json, project.yaml, synoptics/<page>.yaml}` con `format_version: "1.0"`. Le password MQTT sono **strippate** (mai esportate); le re-immetti in Configurazione → Protocolli dopo l'import. Replace mode con confirm dialog: synoptic orfani vengono eliminati. Hot-reload completo dopo import (TagDb diff, AlarmDb.load, supervisor.reload, functions registry swap) — niente restart. Endpoints `GET /api/project/export` + `PUT /api/project/import`, entrambi in `admin_routes` con `require_admin` + `require_password_changed` + `require_auth`.
- **Bug fix gauge hit-area**: il `<g>` del gauge non riceveva eventi pointer perché tutti i figli avevano `pointerEvents: "none"` (l'arco è geometria stroke-only, niente fill). Aggiunto `<rect fill="transparent">` come primo figlio → gauge ora selezionabile e draggabile da qualsiasi punto del bounding box. (`sws-editor/src/canvas/SvgCanvas.tsx`)
- **Widget Image abilitato**: il tipo `image` era segnato "Prossimamente" in LeftPanel ma il rendering era già funzionante. Rimosso il flag `disabled`. Properties panel ora mostra un campo "URL immagine" per impostare `src`. Supporta qualsiasi URL assoluto o path `/symbols/…`.
- **Simboli custom progetto (`PUT /api/project/custom-symbols`)**: nuovo endpoint REST (Rust) + campo `custom_symbols: Vec<CustomSymbol>` in `project.yaml`. Ogni simbolo ha `{ id, label, url, attribution: { author, source, license } }`. Viene incluso nel ZIP di export/import.
- **Tab "Risorse" in ConfigView**: elenco simboli già aggiunti con tabella url/licenza/autore + pulsante rimuovi. Form di aggiunta: URL SVG, etichetta, licenza (select CC0/CC-BY/Apache/MIT/BSD/PD), autore, fonte. L'id viene derivato automaticamente dall'etichetta. Salvataggio via `PUT /api/project/custom-symbols`.
- **SymbolSelect component**: il dropdown "Simbolo" in EditorShell ora include un gruppo `<optgroup>` "Simboli progetto" con i simboli custom. I simboli custom hanno `symbol_id` prefissato `custom:`. Canvas li renderizza come `<image href={url}>` con badge stato (stesso meccanismo dei simboli vendored).
- **SvgCanvas/RuntimeView**: `customSymbols` passato come prop sia all'editor sia alla view runtime — i simboli custom appaiono anche in modalità operatore.
- **Log persistence su file** (`sws-runtime/log_file.rs`): nuovo modulo che si sottoscrive a `LogBus` (broadcast `LogEvent`) e scrive ogni evento come riga JSONL in `<logs_dir>/runtime-YYYY-MM-DD.jsonl`. Rotazione per data UTC: alla prima riga di un nuovo giorno chiude il file precedente e apre quello nuovo. CLI `--logs <path>` (default: `<project>/../logs` — sibling del project dir, dev.sh già crea `.run/logs/`). Retention via `SWS_LOG_RETENTION_DAYS` (default 7); allo startup elimina i `runtime-*.jsonl` con data < cutoff (mantiene la giornata di cutoff). Errori del writer (disk full, dir non scrivibile, etc.) escono su `stderr` con `eprintln!` — mai via `tracing` — per evitare feedback loop attraverso `LogBus`. Subscribe sincrono prima di `tokio::spawn` per non perdere i primi eventi. Format file = identico a `GET /api/logs` (stesso `LogEvent` JSON), così `tail -f *.jsonl | jq .` mostra ciò che vede l'editor. Nessuna modifica frontend: i file servono per post-mortem dopo crash/restart e per container deploy dove podman/journald wrappano. Coabita con `dev.sh` che già redirige stdout in `.run/logs/runtime.log` (nome distinto, no collisione).
- **Test coverage**: workspace ora a 30 unit test (4 nuovi in `sws-runtime`: `date_from_ts_ms_is_deterministic`, `date_minus_days_handles_month_and_year_boundaries`, `prune_old_keeps_recent_and_removes_old`, `writer_appends_jsonl_lines`).
- **"Salva tutto" (sostituisce il vecchio "Salva")**: il bottone in `LeftPanel` ora persiste in parallelo OGNI synoptic page + (se Admin) tag, sources, alarms, funzioni Python, custom symbols. Prima salvava SOLO la pagina corrente — modifiche al `FunctionEditor` o ad altre pagine andavano perse se l'utente non passava dalla tab giusta di ConfigView. Feedback chip: "Salvataggio…" / "✓ Salvato" (2 s) / "❌ Errore — clicca per ritentare" con tooltip + banner dettaglio errori. Non-Admin (Operator+): salva solo le synoptic; gli endpoint admin-only vengono saltati silenziosamente.
- **Multi-page UX**: rinomina pagina via doppio click o icona ✎ con input inline (Enter/Esc), conferma su delete che ricorda l'undo (Ctrl-Z). Navbutton con `target_page` puntante a pagina eliminata → bordo rosso + chip warning "⚠ pagina inesistente" + opzione disabilitata nel select per non perdere l'id originale.
- **Symbol rotation + flip**: nuove proprietà `rotation` (deg), `flip_h`, `flip_v` sui simboli (built-in, vendored, custom). Slider -180/+180 + numeric + reset; checkbox flip h/v; trasformata SVG `rotate(R cx cy) scale(±1 ±1)` applicata solo al visual. Selection rect e status badge restano axis-aligned. Round-trip YAML garantito da `SynopticObject` Rust esteso.
- **Cross-cutting transform + bindings (Phase 1)**: `rotation/flip_h/flip_v/opacity` estesi a tutti i tipi visivi (rect/ellipse/text/image/gauge/led/progress_bar/table/button/navbutton/symbol); helper `applyTransform` + `resolveObject` in `SvgCanvas.tsx`; sezione "TRASFORMAZIONE" in ObjectProps panel; rotation/flip rimossi dal blocco symbol-specifico. Campo `bindings: Record<string,string>` aggiunto a TS `SynopticObject` e Rust mirror.
- **BindableInput component (Phase 2)**: toggle 🔗/🔓 su fill, stroke, text, color, label, rotation, opacity, src, on_color, off_color, min, max, unit e altri campi del pannello. Sezione "BINDING ATTIVI" in fondo al pannello per audit/rimozione rapida.
- **Demo Page 2 + Page 3 (Phase 3)**: Page 2 welcome fixa il navbutton orfano di Page 1 (id `mp472aq9q3yzc`). Page 3 "Demo Binding" con un widget per tipo agganciato a `demo.rotation`/`demo.opacity`; 2 slider per pilotarli. 4 nuovi tag in `examples/demo/project.yaml`.

## Backlog / reminders

> Reminders raccolti fuori sessione. Da promuovere a "Next session should" quando si pianifica il prossimo blocco di lavoro. Ogni voce ha un id stabile (`BL-NNN`) per riferimento.

> **2026-05-13 — BL-001, BL-002, BL-003 chiusi in blocco autonomo.** Si veda la sezione "What's working" sopra. Le descrizioni di backlog sotto restano come riferimento storico.

- **BL-001 ✅ DONE — Gestione utenti multi-account nella vista Configurazione (admin-only)**
  - **Goal**: in modalità *Configurazione*, un utente con ruolo `admin` deve poter vedere l'elenco degli account, crearne di nuovi, assegnare il ruolo (Viewer / Operator / Supervisor / Admin — i 4 ruoli RBAC esistenti) e forzare il cambio password al primo login del nuovo utente.
  - **Backend (`sws-auth` + `sws-web`)**:
    - Sostituire l'attuale singolo admin seeded da env con uno store utenti persistente (file su disco YAML/JSON nella project dir, oppure SQLite locale — decidere in OPEN_QUESTIONS se la scelta non è ovvia). L'admin seeded resta come bootstrap quando lo store è vuoto.
    - Modello `User { username, password_hash (Argon2id), role, must_change_password: bool, created_at, updated_at }`.
    - Endpoint (tutti gated da `role == admin` via middleware):
      - `GET /api/auth/users` — lista (senza hash).
      - `POST /api/auth/users` — crea con password iniziale + `must_change_password: true` di default.
      - `PUT /api/auth/users/:username` — aggiorna ruolo, reset `must_change_password`, reset password.
      - `DELETE /api/auth/users/:username` — rifiuta se è l'ultimo admin.
    - Endpoint self-service (qualsiasi utente loggato): `POST /api/auth/change-password` (old + new); pulisce `must_change_password` se vero.
    - Login: il `POST /api/auth/login` ritorna anche `must_change_password` nella risposta; finché è true, tutte le altre API rispondono 403 con un codice che il frontend riconosce.
  - **Frontend (`sws-editor`)**:
    - Nuova tab *Utenti* in `ConfigView`, visibile solo se `authUser.role === "admin"`.
    - Lista utenti con colonne: username, ruolo, "deve cambiare pw", azioni (modifica ruolo, forza cambio pw, reset pw, elimina).
    - Form "Nuovo utente": username, password iniziale, ruolo, checkbox "deve cambiare al primo login" (default on).
    - Schermata `ChangePasswordScreen` mostrata al posto dell'app se `authState.mustChangePassword === true` dopo il login.
  - **Test**:
    - Unit: hashing/verify, "ultimo admin non eliminabile", flag `must_change_password` resettato dopo change.
    - Integrazione: login → must_change_password → blocca API → change-password → sblocca.
  - **Out of scope** (volutamente non in BL-001): LDAP/OAuth, password policy (lunghezza/complessità), lockout dopo N tentativi falliti, 2FA, audit completo delle modifiche utente (basta audit-log v1 esistente). Vanno in BL successive se servono.

- **BL-002 ✅ DONE — Estendere la configurazione MQTT (Configurazione → Protocolli)**
  - **Motivo**: la `MqttConfig` attuale ([sws-runtime/crates/sws-core/src/project.rs:75-84](sws-runtime/crates/sws-core/src/project.rs#L75-L84)) espone solo `id / host / port / client_id / topics`. Manca tutto il resto, in particolare le credenziali — bloccante per provare broker pubblici con auth (es. https://freemqtt.com/en).
  - **Campi da aggiungere a `MqttConfig`** (tutti `#[serde(default, skip_serializing_if = ...)]` per restare retrocompatibili con i project.yaml esistenti):
    - `username: Option<String>` e `password: Option<String>` → `opts.set_credentials(u, p)` su `rumqttc::MqttOptions`.
    - `keep_alive_secs: Option<u16>` (default attuale hardcoded a 10, vedi [sws-plugin-mqtt/src/lib.rs:62](sws-runtime/crates/sws-plugin-mqtt/src/lib.rs#L62)).
    - `clean_session: Option<bool>` → `opts.set_clean_session(...)`.
    - `tls: Option<MqttTlsConfig>` con almeno `{ enabled: bool, ca_cert_path: Option<String>, insecure_skip_verify: bool }`. Quando `enabled`, port di default → 8883; usa `rumqttc::Transport::Tls`. Verificare il feature flag `rustls-tls` di `rumqttc` (probabilmente da aggiungere in `Cargo.toml` del plugin).
    - `last_will: Option<LastWill>` con `{ topic, payload, qos, retain }` → `opts.set_last_will(...)`.
    - `qos: Option<u8>` a livello sorgente (0/1/2) e/o `qos` per singolo `TopicMapping` → oggi è hardcoded `AtMostOnce` su subscribe (vedi [sws-plugin-mqtt/src/lib.rs:67](sws-runtime/crates/sws-plugin-mqtt/src/lib.rs#L67)) e probabilmente anche su publish. Mettere il default su `AtLeastOnce`.
  - **Sicurezza segreti**: la `password` finisce in `project.yaml` (sul disco, dentro `.run/`). Per il PoC è accettabile, ma:
    - Aggiungere supporto a `password_env: Option<String>` come alternativa: se valorizzato, leggere la password da quella env var a runtime invece che dal file. Permette di tenere il file pulito per la demo PX30.
    - Marcare `project.yaml` come file con segreti in `docs/CONTEXT.md` / `README` se non già fatto.
    - In `GET /api/project` mascherare le password (`"********"` o omettere il campo); il `PUT` deve gestire il "campo vuoto = lascia invariato" vs "campo nuovo = sovrascrivi".
  - **Frontend (`sws-editor` → `MqttSourceCard` in ConfigView)**:
    - Sezione "Autenticazione": username, password (input type=password, placeholder "lascia vuoto per non modificare" in edit), bottone "Mostra".
    - Sezione "Connessione": keep_alive_secs, clean_session, qos di default.
    - Sezione "TLS": enabled, ca_cert_path (textbox path lato server), insecure_skip_verify (con warning).
    - Sezione "Last Will": topic, payload, qos, retain (collassabile).
    - Sezione "Topic": colonna `qos` opzionale per ogni mapping.
  - **Test di accettazione**: configurare un broker freemqtt.com con utente+password, vedere arrivare valori in un tag, scrivere via `PUT /api/tags/:id` e vederli pubblicati. Annotare in `STATUS.md` come "verificato su broker pubblico".

- **BL-003 ✅ DONE — Editor Python decente per `on_press` / `on_release` e funzioni di progetto**
  - **Motivo**: oggi i campi di codice Python sono `<textarea>` minuscole nella properties panel — niente syntax highlighting, niente indentazione automatica, e l'utente segnala che il ritorno a capo non funziona bene. Vale per sia gli handler per-oggetto (`on_press`, `on_release`) sia le nuove funzioni Python a livello progetto (vedi commit "reusable Python functions + symbol library doubled").
  - **Obiettivo UX**:
    - **Per le funzioni di progetto**: aprire un editor a tutto schermo nello spazio principale di lavoro (al posto del canvas, come una vista alternativa) invece che dentro una proprietà laterale. Salvataggio esplicito + indicatore "modifiche non salvate".
    - **Per gli handler per-oggetto** (`on_press` / `on_release`): mantenere il campo nella properties panel come anteprima/riepilogo a 1-2 righe, ma con un pulsante "Apri editor" che apre lo stesso editor a tutto schermo (o un modal grande, almeno 600×400) sul singolo handler.
  - **Componente editor**:
    - Usare **CodeMirror 6** con `@codemirror/lang-python` (più leggero di Monaco; bundle ~120 KB vs ~3 MB per Monaco). Conferma in `pnpm-lock.yaml` che non c'è già Monaco da altre parti — se sì, riusarlo. Decisione minore, lascio aperto.
    - Funzionalità minime: syntax highlight Python, indentazione automatica (4 spazi), bracket matching, line numbers, find/replace, font monospace.
    - Tema chiaro/scuro coerente col resto dell'app.
  - **Template / snippet preconfigurati**: dropdown "Inserisci template…" sopra l'editor con esempi che usano l'API `tags.read` / `tags.write` esistente ([sws-runtime/crates/sws-pyscript/src/lib.rs](sws-runtime/crates/sws-pyscript/src/lib.rs)). Inserire come testo nel cursore, sovrascrive selezione. Set iniziale:
    - **Incremento tag**: `v = tags.read("counter") or 0\ntags.write("counter", v + 1)` ← l'esempio richiesto.
    - **Toggle booleano**: `tags.write("light", not (tags.read("light") or False))`.
    - **Scrittura condizionale**: leggi A, se sopra soglia scrivi B.
    - **Reset multi-tag**: scrivi 0 a una lista di tag.
    - **Print/log diagnostico**: `print(...)` (lo stdout va già al pannello browser console via [sws-pyscript ExecOutput](sws-runtime/crates/sws-pyscript/src/lib.rs), vedi OPEN_QUESTIONS Q1).
    - Per le funzioni di progetto, aggiungere anche un template "scheletro di funzione con parametri" (la firma del `FunctionDef` esistente — vedi `parameters` in [project.rs](sws-runtime/crates/sws-core/src/project.rs)).
  - **Bug del "ritorno a capo" da investigare**: la textarea attuale potrebbe avere un handler `onKeyDown` che intercetta Enter (es. per "salva al primo enter") — controllare prima di rimpiazzare il componente, perché lo stesso bug potrebbe esistere anche in altri campi multi-linea.
  - **Out of scope**: autocomplete dei nomi tag dentro il codice Python (sarebbe figo ma è LSP-grade, troppo lavoro per il PoC), linting Python lato client, debugger. Vanno in BL successive.

## Next session should — candidati aperti (Multi-Project IDE completo)

**Multi-Project IDE Phase A1+A2 completati** (sessione 2026-05-15, blocchi 5-7). Flusso completo: WelcomeScreen → crea (Vuoto / Da template / Da ZIP) → apri → login → app. "Chiudi progetto" riporta a WelcomeScreen. Build + cargo check verdi.

**Prossimi candidati** (scegli uno per la prossima sessione):

1. ✅ **Bug fix rename-page** — `save_synoptic` ora rimuove il file YAML stale dopo una rinomina. **DONE questa sessione.**
2. ✅ **Historian polish v2** — decimazione per range lunghi, read-fallback a SQLite, prune periodica. **DONE questa sessione.**
3. ✅ **Selection rectangle** — drag su area vuota per selezione multipla rettangolare (`SvgCanvas.tsx`). **DONE questa sessione.**
4. **Demo PX30** — build multi-arch + deploy su hardware fisico. Bloccante: serve hardware.
5. Qualsiasi altra voce dall'elenco "Altri candidati di backlog" in fondo al file.

---

## Backlog precedente — FOLLOW-UP UNIVERSAL BINDING (tutto chiuso)

Piano `docs/plans/2026-05-14_universal_binding.md` **completato** (Phases 1-4). Tutti i follow-up del piano sono chiusi:

1. ✅ **BindableInput su tutti i campi rimanenti** — copertura completa: x, y, width, height, x2, y2, font_family, gauge/progress_bar thresholds (warn_low/warn_high/alarm_low/alarm_high), slider (min/max/step), checkbox (label/checked_value/unchecked_value), radio (label), LED (label/on_value), trend (window_s/y_min/y_max/line_color), symbol state colors, z_index.
2. ✅ **MultiSelectionProps con binding** — sezione "BINDING RAPIDO" aggiunta: select prop + TagInput + pulsanti "Applica" / "Rimuovi" applicano o tolgono lo stesso binding su tutti gli oggetti selezionati in batch.
3. ✅ **Bug fix BindableInput in grid 2-colonne** — pulsante 🔗 non cliccabile su X/Y/W/H e altri campi in layout a 2 colonne. Causa: cella sorella (DOM order successivo, stesso stacking context) copriva il pulsante. Fix: `position: relative; zIndex: 1` sul button in BindableInput.tsx.
4. ✅ **Demo Page 4 "Fill Color"** — nuova pagina con 6 pulsanti colore preset (rosso/verde/blu/arancio/viola/teal) che scrivono un hex in `demo.fill_color`. Anteprima live: rect, ellipse, button, progress_bar con `bindings.fill = demo.fill_color`. Nota che il tag è condiviso con Page 3 (il rect lì cambia colore anch'esso). Nav da Page 3 → Page 4 aggiunta.
5. ✅ **Header dropdown Menu** — "☰ Menu" con Salva (+ feedback cromatico), Esporta, Importa, Esci; "Griglia ▾" con size + snap (edit mode only). `saveSerial/saveStatus/saveError` nel store Zustand. Old standalone Esci button + ProjectIO rimossi.
6. ✅ **Fix symbol hit-area** — `<rect fill="transparent">` come hit-area; simboli ora selezionabili.
7. ✅ **Demo Page 3 "Showcase"** — tutti i 15 tipi widget con bindings demo.*.
8. ✅ **Animation/interpolation** — campo per-oggetto `transition_duration_ms` (0..5000 ms, default 0). Quando > 0 i prop CSS-animabili bindati (fill/stroke/opacity/transform) interpolano linearmente con easing `ease-out`. Helper `transitionStyle(obj)` in `SvgCanvas.tsx`, spread su tutti gli SVG primitives + `applyTransform` wrap forzato quando duration > 0. UI: slider+numeric+reset in TRASFORMAZIONE di ObjectProps; sezione DURATA TRANSIZIONE in MultiSelectionProps per batch. Rust mirror `transition_duration_ms: Option<u64>` su `SynopticObject` (synoptic.rs) per round-trip YAML + export/import. Limitazioni v1: prop non-CSS-animabili (testo, font_size, src, x/y SVG attr, gauge needle, progress_bar width) restano discreti; rotation 360°→0° interpola attraverso 180°.

### Altri candidati di backlog (alternativa al piano sopra)

Stato di partenza per la prossima sessione:
- Branch `main` pulito (a meno del commit di questa sessione pending).
- **30 unit test** workspace verdi (`PYO3_PYTHON=python3 cargo test --manifest-path sws-runtime/Cargo.toml --workspace`).
- Frontend builda OK (`cd sws-editor && pnpm type-check && pnpm build`).
- `./scripts/dev.sh` parte. Demo seedato in `.run/project/`.
- **Da verificare al primo restart dev.sh**: in `.run/logs/` deve apparire `runtime-YYYY-MM-DD.jsonl` accanto al `runtime.log` (stdout redirect di dev.sh). Aprilo: deve contenere `{"ts_ms":…,"level":"INFO",…}` per ogni evento, identico a `GET /api/logs`.

Pick one of these as the next focused work block (each fits 3-4 hours):

1. **Demo PX30 reale**: usa `scripts/build-images.sh` per le immagini multi-arch, segui `docs/DEPLOY_PX30.md` passo passo, prova sul Rockchip con un PLC vero. Documenta i bug che emergono — è l'exit criterion di Phase 1. **Bloccante: serve hardware fisico.**
2. **Historian polish v2**: decimazione per range lunghi (>5000 samples), read-fallback a SQLite per range fuori dal ring buffer, prune periodica del db. Niente blocker, file di partenza `sws-runtime/crates/sws-historian/src/lib.rs`.
3. **Symbol library v2**: tilt/rotation, simboli aggiuntivi (compressor, heat exchanger, level sensor), packaging come asset cartella `sws-symbols/` (vs inline TSX in `sws-editor/src/symbols/library.tsx`).
4. **Selection rectangle**: drag su area vuota della SVG canvas per selezione multipla rettangolare. File principale: `sws-editor/src/canvas/SvgCanvas.tsx`. Convive con selectedObjectIds esistente.
5. **Auth polish v2**: refresh token, cookie httponly oltre al Bearer, LDAP/OAuth plugin. Lo schema utenti persistente è già pronto (BL-001).
6. **Script preemption** (OPEN_QUESTIONS Q1 follow-up): `Python::check_signals` + thread di interrupt per davvero terminare gli script che superano `SWS_SCRIPT_TIMEOUT_MS`. Oggi il timeout c'è ma è "best effort" — uno script con loop infinito non viene preempted.
7. **Multi-pagina synoptic UX**: oggi solo "Page 1" nella demo. Crea pagina 2/3 via LeftPanel, verifica che il navbutton funzioni, prova export → import (deve preservare tutte le pagine, replace mode garantisce la sincronia).
8. **Log file v2** (follow-up del task appena chiuso): (a) compressione gzip dei file ruotati (`runtime-YYYY-MM-DD.jsonl.gz`); (b) endpoint `GET /api/logs/files` per listare i file storici; (c) format-aware reader nel pannello log che pesca dal disco quando si scrolla oltre il ring buffer.

### Bug aperti / da verificare a mano
- ✅ **Rinomina pagina lascia dietro il vecchio file** — risolto: `save_synoptic` ora rimuove i `.yaml` stale con lo stesso `id` interno ma filename diverso. (commit `ff32e40`)
- Nessun altro noto al momento del commit. La fix del 404 utenti (`e4a61f5`) è stata validata via curl + via UI in Configurazione → Utenti.
- Da verificare a freddo: `rm -rf .run/project && ./scripts/dev.sh` deve seedare `examples/demo/` (test non eseguito per via del permission gate su `rm -rf`, ma il codice è una `if [ ! -f ... ]; then cp -r ...; fi` lineare).
- Da verificare al prossimo restart dev.sh: il writer log JSONL crea effettivamente `.run/logs/runtime-YYYY-MM-DD.jsonl` (unit test passano, ma il path live va confermato a vista). Test manuale di retention: `touch -d '2020-01-01' .run/logs/runtime-2020-01-01.jsonl; ./scripts/dev.sh` → file rimosso da `prune_old`.

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
