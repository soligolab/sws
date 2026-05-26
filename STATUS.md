# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).

**Last session**: 2026-05-26 (S-60) — T-05 Tag Manager CSV import/export. Backend: POST /api/project/tags/import-csv (CSV merge — aggiunge nuovi tag, aggiorna esistenti, ignora colonne sconosciute). Frontend: "Esporta CSV" (download tags.csv) + "Importa CSV" (modal con file picker + textarea, anteprima, feedback). pnpm build + cargo check verdi.
**Previous session**: 2026-05-26 (S-59) — T-03 Alarm ISA-18.2 + journal. Stato macchina a 4 stati (Normal/ActiveUnacked/ActiveAcked/NormalUnacked). AlarmEvent journal in-memory + SQLite (tabella alarm_events, append on event complete, query con filtri). GET /api/alarms/history (SQLite o fallback in-memory). AlarmBanner aggiornato: badge ISA con blink per ActiveUnacked, label stato, ACK con username. AlarmPanel: tab "Attivi" + "Storico" (AlarmHistory.tsx con paginazione). pnpm build + cargo check verdi.
**Previous session**: 2026-05-26 (S-58) — T-01 symbol picker + T-02 trend interattivo. Symbol: aggiunto `SymbolPickerModal` in EditorShell; clic "Simbolo" in palette apre galleria a scelta prima di inserire (no più default pump forzato). Trend: `TrendCanvas` esteso con `fromMs`/`toMs` (historical mode, nessun polling), `hiddenIndices`, dipendenze fixing; nuovo `TrendExpandedModal` (preset 1h/8h/24h/7d, pan ◀▶, toggle serie, ResizeObserver per canvas full-size); click ⤢ sul trend in RuntimeView apre il modal. pnpm build + cargo check verdi. Branch `task/S-58-T01-T02-symbols-trend` → squash-merged a main.
**Previous session**: 2026-05-25 (S-57) — Fix isolamento progetti + sinottici ha-pro completi. Fix race condition `open_project`/`close_project`: `supervisor.reload` spostato PRIMA di `db.clear` (stop plugin → poi clear, nessuna scrittura residua nel nuovo progetto). Fix historian leak: aggiunto `Historian::clear()`, chiamato in open/close project (il ring buffer in-memory era condiviso tra tutti i progetti). Completate 6 pagine sinottiche per il template `homeassistant-pro` (tutte le funzionalità SCADA: gauge, trend multi-tag, LED, write-back luci ON/OFF, pulsanti tapparelle SU/GIÙ, tabelle clima, KPI energetici). Sinottici copiati anche in `.run/projects/ha/synoptics/`. cargo build verde.
**Previous session**: 2026-05-24 (S-56) — Bug fix session. Fix `eval_expression` multi-line (AST harness: `ast.parse+__inject` per catturare l'ultima espressione anche in blocchi if/else multi-riga). Fix retry flood di tutti i plugin (HA, MQTT, Modbus TCP/RTU, OPC-UA): rimosso loop esterno di retry — ogni plugin viene chiamato una sola volta; riavvio solo su Save via `handle.is_finished()` in `source_supervisor`. Fix `logs/` scansionato come progetto: spostata dir log default da `projects_root/logs` a `projects_root/../logs`, aggiunto controllo `has_project_yaml` in `list_projects`. Fix `open_project` partial-state: load PRIMA, clear DOPO. Fix `create_project`: dopo copia template, aggiorna `meta.name` nel project.yaml copiato con il nome scelto dall'utente. Fix `dev.sh`: aggiunta `stop_existing()` con pkill TERM+KILL; fix `set -euo pipefail` bug `[ ] && sleep` → `if...fi`. Corretti `meta.name` nei progetti già creati (`.run/projects/test` e `.run/projects/ha`). cargo check + cargo build verdi.
**Previous session**: 2026-05-24 (S-55) — Template `homeassistant-pro` (showcase completo). Fix plugin HA: `parse_ha_state` ora mappa "home"→Bool(true), "not_home"→Bool(false), "open"→Bool(true), "closed"→Bool(false); `build_service_call` ora inverte correttamente `open_cover`→`close_cover` per Bool(false). Nuovo template 86 tag: FV 2 stringhe Solarman, batteria, rete, clima 5 stanze Zigbee, contatori cucina+pompa di calore (V+A+W+Hz), 14 sensori sicurezza, tapparelle motorizzate write-back (cover), 3 luci esterne write-back (switch), presenza persona, sole elevazione, 9 tag derivati Python, 13 allarmi dead-band, SQLite 365 giorni (20 tag storici). 3 file: `project.yaml` (86 tag), `template.yaml`, `SETUP.md`. cargo check verde.
**Previous session**: 2026-05-24 (S-54) — SQLite storico per progetto HomeAssistant. Fix hot-swap datastore registry: `registry` in `AppState` era `Option<Arc<...>>` immutabile → progetti aperti via WelcomeScreen non avviavano il recorder. Cambiato a `RegistryCell = Arc<RwLock<Option<Arc<DatastoreRegistry>>>>`. `open_project` ora inizializza il registry + spawna il recorder; `close_project` lo svuota. Template e progetto attivo aggiornati con `datastores:` SQLite + `datastore_id:` sugli 8 tag `history: true`. Verificato: SQLite `sws-history.db` riceve campioni Good da HA. cargo check + pnpm build verdi.
**Previous session**: 2026-05-23 (S-53) — Bug fix: derived tag evaluator feedback loop. Il task scriveva su TagDb via `db.set()`, che emetteva un broadcast, che il task stesso riceveva → loop geometrico → canale saturo → "lagged by N" continuo → runtime bloccato. Fix: guard che skippa l'intera valutazione quando tutti i tag cambiati nel batch sono essi stessi derivati; batch-drain `try_recv()` per collassare burst N→1 eval round; `Lagged` log abbassato da warn a debug. Un file modificato: `sws-runtime/src/main.rs`. cargo check verde.
**Previous session**: 2026-05-23 (S-52) — Bug fix: HA Demo template causava "Caricamento progetto…" su tutti i tab dato che i campi `kind: bool_true`/`bool_false` negli allarmi non erano riconosciuti da `AlarmCondition`. Fix: aggiunto `BoolTrue`/`BoolFalse` variant all'enum in sws-core/alarm.rs + evaluate/evaluate_clear aggiornati. Fix `get_project`: prima ritornava 404 silenzioso su parse error, ora 500 con messaggio. Store: aggiunto `projectLoadError` → ConfigView mostra errore in rosso invece di spinner infinito. Tipo `AlarmCondition` aggiornato in types/index.ts. cargo check + pnpm build verdi. Anche nella stessa sessione: cancel login button (LoginScreen.tsx), per-user session TTL configurabile (Users tab), HA entity browser 🔍.
**Previous session**: 2026-05-23 (S-51) — HA entity browser: pulsante 🔍 accanto a entity_id e attribute nella tabella entità del `HomeAssistantSourceCard`. Backend `POST /api/sources/ha/browse` (reqwest → GET /api/states HA → Vec<HaBrowsedEntity>); frontend `HaBrowseModal` con ricerca full-text, filtro dominio, espansione attributi. Fix: `deserialize_sources_tolerant` per forward-compat source kinds. cargo check + pnpm build verdi.
**Previous session**: 2026-05-23 (S-49) — Feature #10 Rotazione automatica pagine kiosk (SynopticPage.auto_rotate_skip, store autoRotate/autoRotateIntervalS con localStorage, useEffect+setInterval in RuntimeView, toolbar ▶/⏹, PageProps checkbox). Feature #12 IP allowlist per login (SWS_IP_ALLOWLIST env, CIDR check IPv4/IPv6 senza deps, Extension<SocketAddr> dal accept loop). Feature #3 Alarm shelving (ShelvedAlarm + shelve/unshelve/shelved_snapshot in AlarmDb, auto-scadenza, 3 rotte API, AlarmPanel con 🔧 form inline + sezione Soppressi + badge ⏸). cargo check + pnpm build verdi.
**Last commit**: vedi `git log -1`
**Current phase**: Phase 2 — sviluppo attivo PoC

---

## Handoff prossima sessione (in ufficio — PX30 + dispositivi Yocto)

### Contesto stato attuale (2026-05-25)

Due sessioni di bugfix (S-56/S-57) + template ha-pro completo (S-55/S-57).
Il runtime è stabile. Il binary deve essere ricompilato sull'ufficio/PX30 con `cargo build` o
lo script di cross-compile Yocto. I commit sono locali (non pushati su remote).

### Cosa fare prima di tutto

**Se lavori direttamente sul dev server via SSH**, il repo è aggiornato e il binary è già
compilato in `sws-runtime/target/debug/sws-runtime`. Basta `./scripts/dev.sh`.

**Se lavori sul PX30 o Yocto**, devi cross-compilare e deployare:
```bash
./scripts/yocto/build.sh release
./scripts/yocto/deploy.sh pixsys@192.168.1.59  # aggiorna IP se cambiato
```

### Task in ufficio suggeriti

1. **Smoke test progetto ha-pro** — apri il progetto `ha` (o crea da template `homeassistant-pro`):
   - Configura `HA_TOKEN=<il-tuo-token>` nell'env o nel dev.sh
   - Verifica che i 6 sinottici siano visibili e navigabili
   - Verifica che i tag HA arrivino live (alcuni saranno `Bad` se entity_id non corrisponde)
   - Verifica write-back: pulsanti luci ON/OFF e tapparelle SÙ/GIÙ

2. **Verifica isolamento progetti** — ora che il bug è fixato:
   - Apri MQTT demo → genera traffico
   - Crea progetto vuoto → verifica tag list vuota + nessun sample in `/api/history/...`

3. **Verifica RBAC su PX30** (S-37, in sospeso da settimane):
   - Hard reload browser (F12 → ricarica difficile)
   - Login Operator: deve vedere solo Runtime, no Editor
   - Login Supervisor: Runtime + ConfigView senza Users/Backups
   - Login Admin: tutto

4. **Adattamento entity_id** — il template usa gli entity_id dell'installazione di casa.
   Se l'ufficio ha HA, aggiorna `project.yaml` con i tuoi entity_id.
   Vedi `examples/templates/homeassistant-pro/SETUP.md` per la guida.

### Verifica RBAC su PX30 (S-37, da rifare con cache pulita)

### Verifica browser Operator su PX30 (S-37, da rifare con cache pulita)

**Stato attuale**: il maintainer ha provato dopo il redeploy e ha visto ancora il bottone "Editor" come Operator. **Causa quasi certa**: cache browser. Il bundle SPA servito dal device è `index-BPl7YtNj.js` (verificato con `curl -k https://192.168.1.59:8443/index.html | grep index-`), che è quello *post-RBAC* — l'hash è stato confermato cambiare con/senza canary string a controprova. Vite usa `index.html` non-hashed (servito sempre fresco dal runtime), ma il browser può tenerlo cachato e continuare a chiamare un vecchio `index-XXXX.js`.

**Cosa fare la prossima volta**:
1. Dal PC, aprire DevTools (F12) → tasto destro sul pulsante refresh → "Svuota cache e ricarica difficile" (o `Ctrl+Shift+Del` → "Immagini e file in cache" → Cancella).
2. Ricaricare `https://192.168.1.59:8443/`, login come Operator.
3. Verificare matrice:
   - Operator: solo bottone "Runtime"; no "Editor"/"Configurazione"; no side-menu.
   - Hard-reload: resta su Runtime.
   - DevTools console: `useAppStore.getState().setAppMode("edit")` → UI resta su Runtime.
   - Supervisor: tutti e tre i bottoni; ConfigView senza Users/Backups.
   - Admin: tutti e tre i bottoni; ConfigView con Users + Backups.

**Se anche dopo cache-purge l'Operator vede il bottone Editor**: è un bug reale e va investigato. Indizi da raccogliere:
- Cosa stampa `useAppStore.getState().authRole` in DevTools console subito dopo il login Operator (dovrebbe essere `"Operator"`).
- Cosa stampa `useAppStore.getState().appMode` (dovrebbe essere `"edit"` di default — è il pinning di `effectiveMode` che lo nasconde, non lo store).
- Screenshot dell'header così vediamo quale bottone effettivamente compare.

### Traccia A — Yocto cross-compile + deploy (S-36, ✅ chiusa)

Outcome:
- `./scripts/yocto/build.sh release` su dev server → 3m40s clean, 18 MB stripped PIE aarch64.
- `aarch64-pixsys-linux-readelf -d` NEEDED = `libpython3.12.so.1.0`, `libgcc_s.so.1`, `libm.so.6`, `libc.so.6`, `ld-linux-aarch64.so.1`. No OpenSSL, no sqlite (bundled), no GTK/WebKit.
- Install path **`/data/user/sws/`** (non `/opt/sws`): su Pixsys Yocto `/` è read-only squashfs/ubifs, `/data/user` è la partizione scrivibile. Cambio applicato a `deploy.sh`, `sws-runtime-launch.sh`, `sws-runtime.service`, `docs/YOCTO_CROSSCOMPILE.md`.
- Deploy `./scripts/yocto/deploy.sh pixsys@192.168.1.59` (PX30 `wp615-a-p2`) → systemd unit attivo, journal pulito, listener su 0.0.0.0:8443. Smoke test:
  - `curl -k https://192.168.1.59:8443/health` → `ok` ✅
  - `curl -k https://192.168.1.59:8443/` → 200 `text/html` (SPA servita) ✅
  - `curl -k https://192.168.1.59:8443/api/system` → 401 (auth richiesta, atteso) ✅
- `scripts/yocto/build.sh` patchato per esportare `PYO3_PYTHON=$(command -v python3)` (Debian dev server senza alias `/usr/bin/python`).
- `docs/YOCTO_CROSSCOMPILE.md` linkata da `CLAUDE.md`.

Debiti noti dal deploy (non-bloccanti, per fase prodotto):
- `sws-runtime.service` gira `User=root` per semplicità. Quando il path diventa "prodotto" → utente non-privilegiato + `CAP_NET_BIND_SERVICE` solo se la porta scende sotto 1024.
- Sul device manca `RestrictedPython` → script Python eseguono in modalità unsandboxed (warning evidente nel journal). Per device di test va bene; in prodotto: aggiungere `python3-restrictedpython` alla `IMAGE_INSTALL` di `meta-pixsys`.

### Traccia B — Diagnostica white-window di `sws-kiosk` (S-38, ✅ CHIUSA)

**Root cause** (S-38, 2026-05-22): quando Claude Code gira come snap (`SNAP=/snap/code/240`), le variabili `SNAP_*` si propagano nel subprocess `WebKitNetworkProcess` che WebKit lancia internamente. Quel processo trova `libpthread.so.0` da `/snap/core20/current/lib/` invece che dal sistema, causando un errore `GLIBC_PRIVATE` e il fallback a finestra bianca.

**Fix applicato in `scripts/dev.sh`** (kiosk mode):
1. Strip di tutte le variabili `SNAP_*` con `env -u` prima di exec-are il kiosk.
2. Path binario corretto: `sws-runtime/crates/sws-kiosk/target/debug/sws-kiosk` (crate escluso dal workspace, non nel workspace target).
3. Runtime in kiosk mode ora passa `--www sws-editor/dist` se la directory esiste (altrimenti warn).

**Per lanciare il kiosk in sviluppo**:
```bash
cd sws-editor && pnpm build   # una volta, se dist/ non esiste
./scripts/dev.sh kiosk        # avvia runtime + kiosk insieme
```

---

## Next steps — priorità

| ID | Task | Stima | Note |
|----|------|-------|------|
| A1 | **sws-kiosk test su PX30 fisico** (`./scripts/kiosk.sh`) | manuale | Richiede hardware + Wayland compositor (cage/weston). Build OK su desktop Ubuntu (S-38). |
| — | ~~**OPC-UA historical reads**~~ | ✅ done | Chiusa S-43 |
| 4.8 | ~~Grid: drag-to-range multi-cell~~ | ✅ done | Chiusa S-44 |
| — | ~~**Modbus RTU**~~ | ✅ done | Chiusa S-46 |
| — | ~~**OPC-UA server**~~ | ✅ done | Chiusa S-47 |
| — | ~~**Tag calcolati/derivati**~~ | ✅ done | Chiusa S-48 |
| — | ~~**Rotazione automatica pagine**~~ | ✅ done | Chiusa S-49 |
| — | ~~**IP allowlist**~~ | ✅ done | Chiusa S-49 |
| — | ~~**Alarm shelving**~~ | ✅ done | Chiusa S-49 |
| — | ~~**HomeAssistant plugin**~~ | ✅ done | Chiusa S-50 |
| — | ~~**HA entity browser**~~ | ✅ done | Chiusa S-51 |
| — | **Verifica RBAC su PX30** | manuale | Cache-purge browser (F12 → ricarica difficile) poi smoke Operator/Supervisor/Admin |
| 8.3 | LDAP / OAuth2 | ~4 h+ | Phase 3 — non ora |

---

## Feature set consegnato (Phase 2)

| Area | Funzionalità |
|------|-------------|
| **Progetto** | WelcomeScreen pre-auth, 4 template (demo-items, casa-locale, opcua-demo, grid-playground), create/open/close/rename/duplicate/delete, ZIP export/import, backup manuale + auto |
| **Auth** | Argon2id, RBAC 4 ruoli (Viewer/Operator/Supervisor/Admin), `users.yaml` per-progetto, `must_change_password`, re-auth modal, admin CRUD utenti |
| **Editor canvas** | rect, ellipse, line, text, button, navbutton, image, gauge, slider, checkbox, radio, led, progress\_bar, table, symbol (22 built-in + custom), grid (merge/split/sub-cell ricorsivo) |
| **Editor UX** | Palette categorizzata, groups + tree drag&drop + context menu, rulers + guide + snap, undo/redo (200 step), copy-paste cross-page, aspect-ratio resize, zoom/pan, multi-select, z-order, lock, history visuale |
| **Bindings** | Tag bind su fill/stroke/text/opacity/rotation/visibility/color + `transition_duration_ms`; `on_press`/`on_release` Python con CodeMirror editor + snippet |
| **Runtime view** | Tag WS bidirezionale, alarm panel + ACK, log panel (live + storico), script test panel, re-auth modal |
| **Protocolli** | Modbus TCP, MQTT (TLS/auth/QoS/last-will/browse), OPC-UA (subscribe/write/browse/Euromap auto-detect/security policies Basic256Sha256), HomeAssistant (WebSocket state_changed + call_service write-back) |
| **Backend** | Historian SQLite + ring-buffer, `/metrics` Prometheus, `/api/system`, backup auto, log JSONL rotato, alarm webhook, TagWriteBus |
| **Deploy** | `--www` SPA embed, `VITE_RUNTIME_URL` remoto, `--kiosk-browser`, CORS + multi-runtime WelcomeScreen, compose.yaml PX30, entrypoint.sh |
| **Qualità** | 53 unit test workspace, Playwright e2e (2 spec), TESTING_GUIDE, DEPLOY_PX30, OPCUA_SETUP |

---

## Bug / verifiche manuali pendenti

- **9.3** Fresh clone smoke: `rm -rf .run && ./scripts/dev.sh` → WelcomeScreen con 4 template, nessun progetto pre-aperto
- **9.4** Log JSONL: al primo restart verificare che `.run/logs/runtime-YYYY-MM-DD.jsonl` venga creato

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md`:
- **Q2** Sparkplug B (deferred Phase 3)
- **Q3** Plugin ABI (deferred)
- **Q4** Frontend state management (default Zustand, revisit prima di M1 freeze)
