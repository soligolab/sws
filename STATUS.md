# SWS — Current Status

> This file is the **session-to-session memory** for Claude Code. Update it at the end of every session before stopping work. Read it at the start of every session before touching code.

**Last session**: 2026-05-13 (BL-003 + BL-002 + BL-001 autonomous block — CodeMirror editor, MQTT auth/TLS/QoS, persistent multi-user store)
**Current phase**: Phase 2. Backlog svuotato: editor Python a tutto schermo, MQTT con auth/TLS, gestione utenti multi-account.
**Last commit**: feat: BL-001 — persistent multi-user store with admin CRUD (in arrivo)

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
- **CodeMirror Python editor (BL-003)**: `PythonEditor` con `@codemirror/lang-python`, tema one-dark, line numbers, history/undo. `FunctionEditor` full-screen (header + aside parametri + editor): apre quando in LeftPanel si seleziona una function, snippet dropdown (increment/toggle/conditional/reset_many/diagnostic/skeleton), indicatore "modifiche non salvate", save bloccato finché clean.
- **MQTT esteso (BL-002)**: `MqttConfig` con `username/password/password_env` (env wins), `keep_alive_secs`, `clean_session`, `qos` (default 0), `tls: MqttTlsConfig { enabled, ca_cert_path, insecure_skip_verify }` — rumqttc 0.24 richiede `ca_cert_path` obbligatorio per TLS (no Native variant). `last_will: MqttLastWill { topic, payload, qos, retain }`. Per-topic `qos` opzionale. `MqttSourceCard` in ConfigView: sezioni Autenticazione / Connessione / TLS / Last Will, collassabili.
- **Password masking (BL-002)**: `GET /api/project` maschera le password MQTT come `"********"`; `PUT /api/project/sources` carica il project precedente dal disco e conserva la vecchia password se l'incoming contiene la sentinel.
- **Persistent user store (BL-001)**: `sws-auth` ora persiste in `users.yaml` (project dir). `AuthState::new_persistent(path, seed, ...)` carica esistenti o seeda dagli env. Admin seeded → `must_change_password: false`. Endpoint admin-only: `GET/POST /api/auth/users`, `PUT/DELETE /api/auth/users/:username`. Self-service: `POST /api/auth/change-password`. Middleware `require_password_changed` blocca tutto tranne whoami/logout/change-password con 403 + `{ error: "password_change_required" }`.
- **Frontend BL-001**: `ChangePasswordScreen` mostrato al posto dell'app quando `mustChangePassword === true`. Nuova tab *Utenti* in ConfigView (solo Admin) con tabella ruolo/forza-cambio-pwd/reset-pwd/elimina + form "+ Nuovo utente".
- **Test coverage**: 11 unit test in sws-auth (incl. last-admin protection, demote-last-admin protection, change-password clears flag, create/update/delete CRUD); 22 unit test totali nel workspace.

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

## Next session should

Pick one of these as the next focused work block (each fits 3-4 hours):

1. **Demo PX30 reale**: usa `scripts/build-images.sh` per le immagini multi-arch, segui `docs/DEPLOY_PX30.md` passo passo, prova sul Rockchip con un PLC vero. Documenta i bug che emergono — è l'exit criterion di Phase 1.
2. **Historian polish v2**: decimazione per range lunghi (>5000 samples), read-fallback a SQLite per range fuori dal ring buffer, prune periodica del db.
3. **Symbol library v2**: tilt/rotation, ulteriori simboli (compressor, heat exchanger, level sensor), packaging come asset cartella `sws-symbols/` (vs inline TSX).
4. **Selection rectangle**: drag su area vuota per selezione multipla rettangolare.
5. **Auth polish v2**: refresh token, cookie httponly oltre al Bearer, LDAP/OAuth plugin, UI per CRUD account multi-utente.
6. **Script preemption** (Q1 follow-up): `Python::check_signals` + thread di interrupt per davvero terminare gli script che superano il timeout.

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
