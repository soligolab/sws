# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).

**Last session**: 2026-06-20 — Bugfix vari + pulizia branch. Tutto su `main`, solo `main` rimane localmente.

- **Sessione 2026-06-20 — Bugfix vari + pulizia branch**:
  - **Grid paste/cut in sub-celle**: `EditorShell.tsx` — Ctrl+V e Ctrl+X ora gestiscono anche `selectedSubCell` (prima funzionavano solo sulla cella top-level). Usa `resolveSubCellEntry` + `updateSubCellAt`.
  - **TagInput — pulsante ▾ esterno funzionante + filtro**: riscrittura completa del componente, rimosso `onBlur+setTimeout` (causava chiusura immediata per race con `autoFocus`), sostituito con click-outside pattern (`document.addEventListener("mousedown", ...)`). Aggiunto campo filtro nel dropdown. Rimosso `<datalist>` nativo (eliminata freccia interna). Fix applicato a tutti gli usi di `TagInput` nel codebase.
  - **"Valore live" in Configurazione → Variabili si aggiorna**: due fix: (1) aggiunto `useTagStream()` in `App.tsx` (l'hook WebSocket `/ws/tags` non era chiamato nell'IDE SPA); (2) fix `tagStream.ts` — `getStream()` ora ricrea il WebSocket quando cambia `remoteConnected` (URL diverso) e invia `{"type":"subscribe","tags":["*"]}` all'apertura (relay `/ws/remote/tags` ne aveva bisogno, il locale no ma non fa male).
  - **Auto-deploy al salvataggio**: quando `remoteConnected`, ogni salvataggio riuscito (Ctrl+S) fa `POST /api/remote/deploy` in background. Pulsante "Deploy" in App.tsx mostra lo stato: "⟳ Sync…" / "✓ Synced" / "✗ Sync err"; torna a idle dopo 3 s. Campo `remoteDeployStatus` aggiunto allo store Zustand.
  - **Pulizia branch locale**: eliminati tutti i 17 branch locali — erano tutti già mergiati su `main` (squash precedenti). Rimane solo `main`. Note: `origin/feat/pyenv-support` (15 righe in `start_runtime.sh` per supporto pyenv LD_LIBRARY_PATH) è ancora nel remote non mergiato — decidere se integrare.
  - `cargo check` + `pnpm build` **verdi**.

- **T-34 — Runtime mono-progetto, versionamento progetto, no-auth fix** (commesso su `main` non testato; il test verrà completato a casa):
  - **Causa del "login ancora richiesto"**: NON era il repo (i commit no-auth c'erano). Il `dist/` del frontend era stantio (9 giu, pre-no-auth) perché gli script ricompilano il backend ma **non** il frontend. Fix: `pnpm build` rigenerato + **hardening** di `start_editor.sh`/`start_runtime.sh` (ora ricostruiscono `dist/` se mancante o più vecchio dei sorgenti). "admin" non funzionava perché in no-auth non esiste alcun utente.
  - **Runtime mono-progetto** (`main.rs`, `projects.rs`): auto-apertura risolta in ordine `--project` → marker persistente `.active-project` (scritto a ogni open, **non più consumato**) → `.last-opened` legacy → unico progetto presente (`single_project_dir`). Rimosso l'hardcoding di `default` dagli script. Marker ripulito su delete.
  - **Versionamento progetto** (`sws-core/project.rs`): campo `saved_by` + `runtime_version()`/`needs_update()`/`stamp_and_serialize()`/`save_to()`; tutti i writer di `project.yaml` instradati attraverso lo stamp. `/api/system` espone `project_saved_by` + `project_needs_update`; nuovo `POST /api/project/migrate` (re-save). Banner "⚠ Aggiorna progetto" in `App.tsx` (RuntimeCtrl). ⚠️ Tutti i crate condividono `0.1.0-dev` → il warning scatta solo quando si bumpa la versione del workspace.
  - **Deploy sovrascrive tutto** (`remote.rs`): `remote_deploy` ora cancella **tutti** i progetti remoti prima dell'upload (coerente col mono-progetto).
  - **Elimina progetto sul runtime** (`remote.rs`, `router.rs`, `ConfigView.tsx`, `client.ts`): nuovo relay `POST /api/remote/project/delete` (risolve il progetto attivo da `/api/system` del target, close+delete) + bottone rosso nel tab Runtime→Connetti.
  - `cargo check -p sws-runtime` + `pnpm build` **verdi**.
  - **Da fare a casa**: test end-to-end (vedi sezione "Verifica T-34" sotto). Se ok, nessuno squash necessario (già su main); altrimenti correggere e ricommittare.

- **Server-side deploy relay + no-auth frontend + WebSocket remote bridge** (branch `feat/websocket-remote-bridge`, pronto per squash merge su main):
  - Backend (`sws-web`): `remote.rs` — `POST/DELETE /api/remote/connect` (autentica contro il runtime remoto, salva token in AppState), `GET /api/remote/status`. `remote_relay.rs` — `GET /ws/remote/{tags,alarms,logs}` pipe bidirezionale tokio-tungstenite con `AcceptAnyCert` rustls verifier per target `wss://`. Tutto Admin-only via `system_ctrl_routes`.
  - Frontend: `api/client.ts` — `remoteConnect / remoteDisconnect / remoteStatus`. Store Zustand — `remoteConnected`, `remoteUrl`, `setRemoteConnected`. `wsUrl.ts` — quando `remoteConnected`, `buildWsUrl()` restituisce `/ws/remote/{sub}` (relay) invece dell'URL diretto.
  - `RuntimeConnectionTab`: `handleConnect()` usa `api.remoteConnect()` (server-side relay), polling `remoteStatus` ogni 5 s, pannello variabili live via `/ws/remote/tags` (max 50 tag, delta 50 ms).

- **Fix architettura auth (stessa sessione, stesso branch):**
  - **Script puliti**: rimosso da `start_runtime.sh` e `start_editor.sh` il blocco `SWS_ADMIN_*` e `SWS_SUPERVISOR/OPERATOR/VIEWER_PASSWORD`. Gli script ora sono solo build + avvio.
  - **No-auth mode**: `require_auth` in `router.rs` ora verifica `auth.has_users()` — se non ci sono utenti (nessun progetto, o progetto senza `users.yaml`) tutte le route sono aperte senza token.
  - **`sws-auth`**: rimosso `bail!` in `new_persistent()` e `swap_store()` quando `users` è vuoto (era `"no users available — set SWS_ADMIN_PASSWORD"`). Un progetto senza utenti è uno stato valido (no-auth mode). Aggiunto metodo pubblico `has_users()`.
  - **`connect_remote` credenziali opzionali**: `ConnectBody.username/password` → `Option<String>`. Se vuoti: relay senza token (per runtime in no-auth mode). `run_relay()` omette `?token=` se token è vuoto.
  - **Fix `RT_CONN_KEY` bug**: `status` ora parte sempre come `"idle"` (non da localStorage). Mount effect pulisce la chiave legacy e sincronizza dal server. Rimosso `localStorage.setItem(RT_CONN_KEY, "1")` da `handleConnect`.
  - **Form credenziali opzionali**: campi Utente/Password con placeholder "opzionale" + default vuoto.
  - `cargo check` + `cargo test -p sws-auth` (11 test OK, corretti anche 5 test stantii con `allowed_zones`) + `pnpm build` verdi.
  - **Fix no-auth frontend (stessa sessione):** `App.tsx` — dopo apertura progetto in no-auth mode, il frontend mostrava LoginScreen perché `clearAuth()` svuotava `authToken` e non c'era modo di ottenerlo. Fix: `onProjectOpened` ora chiama `whoami()` first; se risponde 200 (no-auth: admin sintetico) setta token sentinella `"no-auth"` che il backend ignora. Stesso fix al bootstrap iniziale (`getProject().then()`). `pnpm build` verde.
  - **Deploy relay**: `POST /api/remote/deploy` — backend locale esporta ZIP, carica sul target via reqwest AcceptAnyCert, gestisce conflitto 409, attiva progetto. Frontend `RuntimeConnectionTab.handleDeploy` ora legge flusso streaming da `/api/remote/deploy` (nessun fetch diretto browser→remote). Risolve "Failed to fetch" per certificati self-signed.
  - **No-auth mode frontend**: `App.tsx` — `bootstrapping` flag (no flash iniziale), `onProjectOpened` chiama `whoami()` prima di `setNoActiveProject(false)` (no LoginScreen flash), token sentinella `"no-auth"`.
  - **Da fare**: squash merge in `main` + test end-to-end con due istanze locali (runtime su 8444 + editor su 8460).

- **TLS opzionale — HTTP di default, HTTPS su richiesta** (branch `feat/tls-optional`):
  - Il runtime parte in **HTTP plain** se manca `config/tls.crt`; la **presenza** del cert all'avvio determina la modalità (accept loop su `Option<TlsAcceptor>`, percorso plain con `serve_connection_with_upgrades` → i WebSocket funzionano anche in HTTP). Nessun flag `--no-tls`.
  - Endpoint admin (solo admin app, `require_admin`): `GET /api/system/tls` (stato), `POST /api/system/tls/generate` (self-signed rcgen + reboot), `PUT /api/system/tls` (carica cert+key PEM, validati con `with_single_cert` prima di scrivere, + reboot), `DELETE /api/system/tls` (rimuove + reboot). Switch via riavvio (`system_reboot` ri-exec con stesso argv, riapre il progetto).
  - UI: `ConfigView → Stato → Certificato TLS` (Admin): genera self-signed / carica cert+key (file o paste PEM) / disabilita.
  - Script: `--http-port` ora condizionale alla presenza del cert (companion off in modalità HTTP).
  - **Base**: il grosso era già stato implementato a casa (commit `1ede756`, cherry-pick su main attuale); in questa sessione aggiunto **upload cert+key** (PUT + validazione + UI), test unitari `validate_cert_key`, fix test stantii in `system.rs`, doc aggiornati (scripts/README, manual/10_deployment).
  - **Verificato**: `cargo test -p sws-web` verde (15), `pnpm build` verde, avvio live HTTP-default (`/health` http 200, https ko) e HTTPS con cert presente (`/health` https 200, http ko), gating admin su `/api/system/tls`.
  - **Da fare**: squash merge in `main` quando il maintainer conferma; verifica browser end-to-end (genera → riconnetti su https → carica cert CA → disabilita). Nota: su questo dev server `.run/config/` può avere già `tls.*` → parte in HTTPS; per testare HTTP `rm .run/config/tls.{crt,key}`.

- **Split dev.sh → start_runtime.sh + start_editor.sh** (branch `feat/split-runtime-editor-scripts`):
  - `scripts/dev.sh` eliminato.
  - `scripts/start_runtime.sh` — runtime su dispositivo: viewer 8443 + IDE 8444 + HTTP companion 8080, auto-apre progetto `default`.
  - `scripts/start_editor.sh` — IDE locale su 8460 + HTTP companion 8090 senza viewer; porte separate dal runtime per coesistere sulla stessa macchina.
  - Rust `main.rs`: `--viewer-port` ora è `Option<u16>`; `--http-port Option<u16>` aggiunto per il companion server.
  - **HTTP companion server**: pagina plain HTTP (no cert) che guida all'accettazione del certificato TLS. Opzione A: copia URL `/health` da incollare nella barra del browser; polling JS rilevea accettazione e reindirizza. Opzione B: download `sws.crt` da route `/cert` (MIME `application/x-x509-ca-cert`) per installazione permanente.
  - Fix OOM: `cargo build -j 1` in entrambi gli script (pyo3 + linking esaurisce la RAM quando il runtime è già in esecuzione).
  - Docs aggiornati: CLAUDE.md, scripts/README.md, docs/CONTEXT.md, docs/TEST_SETUPS.md, kiosk.sh.
  - **Prossimo passo urgente**: implementare `--no-tls` sul binario Rust per `start_editor.sh`. `localhost` è sempre un "secure context" nei browser moderni — non serve TLS, eliminando il problema del certificato lato editor completamente.

- **T-29…T-33 — 5 nuovi widget canvas** (squash unico su main):
  - **T-31 Text List**: mappa valore → etichetta testuale (lookup-table). Pannello: voci val/label/colore, testo default, font, allineamento.
  - **T-29 Bar Chart**: SVG puro, verticale/orizzontale, n serie multi-tag, linee soglia warn/alarm.
  - **T-33 Pie/Donut Chart**: SVG con path archi, modalità pie/donut, raggio interno, percentuali, legenda, testo/tag centro donut.
  - **T-32 Sparkline**: mini-trend senza assi in foreignObject SVG, finestra mobile live, fill area, mostra ultimo valore.
  - **T-30 Alarm Viewer**: lista/banner allarmi attivi embedded nel sinottico, filtro prefisso/severità, ACK inline (Operator+), banner ticker CSS.
  - Tutti: palette LeftPanel gruppo Display, default palette, pannello proprietà EditorShell. Nessuna modifica backend.

- **T-28 — IDE Package Builder + SSH Device Deployer** (`feat/T-28-ide-package-deploy` → squash main):
  - Backend: `packaging.rs` con 3 endpoint Admin: `POST /api/build/package` (streaming), `GET /api/build/packages`, `POST /api/deploy/device` (streaming SCP+SSH).
  - AppState: `+build_running` (mutex build unica), `+repo_root` (Some se `scripts/package.sh` esiste vicino al CWD, None su device deployati).
  - Frontend: due nuove sezioni in RuntimeConnectionTab — "Pacchetto runtime" (3 pulsanti build + log + lista tarball) e "Installa su dispositivo" (form SSH + log deploy streaming).

- **T-27 — Generic Linux packaging** (`feat/T-27-generic-linux-package` → squash main):
  - `scripts/package.sh`: build tarball `sws-<version>-linux-<arch>.tar.gz` (flags: `--no-rust`, `--no-spa`).
  - `deploy/generic-linux/install.sh`: installa in `/opt/sws/` (binario+assets), `/var/lib/sws/` (dati), `/etc/sws/runtime.env` (credenziali, solo primo install). Supporta upgrade e `--uninstall`. Fa health-check dopo start.
  - `deploy/generic-linux/sws-runtime-launch.sh` + `sws-runtime.service`: avvio systemd per Linux generico.
  - **Note**: il commit T-27 ha assorbito anche una feature "pipe/tubazione" (SvgCanvas, EditorShell, LeftPanel, types) che era nel working tree da una sessione precedente. Funziona e non rompe nulla.

- **T-26 — Git commit/push** (`feat/T-26-git-commit-push` → squash main):
  - `git_deploy.rs`: `commit()`, `push()`, `unpushed_count()` aggiunti a `GitDeploy`; `GitStatus.unpushed_commits` aggiornato in ogni `status()`.
  - Nuove route: `POST /api/project/git/commit` (Supervisor+), `POST /api/project/git/push` (Admin).
  - Frontend: form inline commit + bottone "↑ Push (N)" in `GitOpsPanel`.

- **T-24 — Project Fingerprint + Device Dashboard** (`feat/T-24-fingerprint-dashboard` → squash main):
  - `GET /api/project/fingerprint` su entrambe le porte (8443/8444): SHA256 di `project.yaml` + `synoptics/*.yaml` ordinati per nome, codifica hex manuale.
  - `sha2 = "0.10"` aggiunto al workspace e `sws-web/Cargo.toml`.
  - Nuovo tab "Device" (Admin) in `ConfigView`: lista device salvata in localStorage (`sws.saved-devices`), auto-refresh 30 s, ping `/health` + fetch fingerprint, confronto con fingerprint locale.
  - `deployToTarget()` estratto come funzione standalone riusata da `RuntimeConnectionTab` e `DevicesTab`.
  - `AppConfigTab` e `ConfigTab` aggiornati per includere `"devices"`.

- **T-25 — Remote log viewer** (`feat/T-25-remote-logs` → squash main):
  - In `RuntimeConnectionTab` (quando connesso): login → `GET /api/logs` → mostra log colorati per livello.
  - Bottone "Aggiorna" + toggle "● Live" (poll ogni 5 s); auto-stop alla disconnessione.
  - Box scrollabile max 200 px, timestamp HH:MM:SS, colori INFO/WARN/ERROR/DEBUG.

**Branch corrente**: `main` — tutti i branch locali eliminati (erano tutti già mergiati). Solo `origin/feat/pyenv-support` rimane nel remote, non critico.

---

## Remaining tasks

> Unica traccia del lavoro ancora aperto. Aggiorna man mano che gli item si chiudono.

- [ ] **Verifica manuale T-34** (PRIORITÀ — da fare a casa) — riprendere da qui. Comandi sotto.
- [x] **TLS opzionale** — ✅ in main.
- [ ] **`origin/feat/pyenv-support`** — 15 righe in `start_runtime.sh` per supporto pyenv (`LD_LIBRARY_PATH` auto-patch). Non critico, da valutare se integrare.
- [ ] **Verifica manuale T-27** — packaging tarball + installer. Comandi sotto.
- [ ] **Verifica manuale T-24/T-25/T-26** — fingerprint/device dashboard, remote logs, git commit/push. Comandi sotto.
- [ ] **Debito: `sws-kiosk` non rispetta `--viewer-port`** (hardcoded `https://localhost:8443` nel wayland spawn). Fix triviale in `main.rs` se/quando si usa il kiosk su device multi-istanza.
- [ ] **Debito: `stop_existing()` in `scripts/start_runtime.sh` usa `fuser`** — su macOS o sistemi senza `fuser` non funziona. Non prioritario (sviluppo su Linux).
- [ ] **Debito: mDNS discovery non attraversa subnet diverse** (by design — link-local). Bridge inter-subnet solo post-PoC.

### TLS opzionale — dettaglio approccio (da progettare in Plan Mode)

- Default: HTTP plain su tutte le porte (nessuna generazione cert automatica)
- Se l'utente carica/genera un cert in Configurazione → il processo si riavvia (o ricarica) in TLS
- `start_editor.sh` e `start_runtime.sh` semplificati: nessun HTTP companion server necessario per il primo accesso
- Il runtime su dispositivo LAN potrà comunque usare TLS configurandolo esplicitamente

### Verifica manuale T-34 da fare (riprendere da qui)

```bash
# 1. no-auth: l'editor non deve chiedere login creando un progetto
./scripts/start_editor.sh          # ricompila backend + rigenera dist se stantio
# → browser http://<host>:8460, hard refresh (Ctrl-Shift-R), crea progetto → nessun login
grep -rl "no-auth" sws-editor/dist/assets/*.js   # deve trovare la stringa

# 2. auto-open mono-progetto: con UN solo progetto in projects-root
./scripts/start_runtime.sh         # riavvio → deve riaprire quel progetto da solo
#    (log "auto-opening …"; /api/system riporta active_project non-null)

# 3. versione: salvare un progetto → project.yaml contiene `saved_by: 0.1.0-dev`
#    Per testare il banner "Aggiorna": editare a mano saved_by (es. "0.0.1") nel
#    project.yaml e riaprire → header IDE mostra "⚠ Aggiorna progetto" → click → re-save.

# 4. deploy overwrite: con un progetto diverso già sul runtime, deploy dall'IDE
#    (ConfigView → Runtime → Connetti → Deploy) → sul runtime resta solo il deployato.

# 5. elimina remoto: ConfigView → Runtime → Connetti → "Elimina progetto sul runtime"
#    → /api/system del runtime riporta active_project: null.
```

### Verifica manuale T-27 da fare

```bash
# Build tarball completo (richiede ~5 min per cargo + pnpm)
./scripts/package.sh

# Verifica struttura
tar tzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz | head -10

# Test installer in locale (o su VM)
tar xzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz
sudo ./sws-0.1.0-dev-linux-x86_64/install.sh
# → apri https://localhost:8443 e https://localhost:8444
```

### Verifica manuale T-24/T-25/T-26 da fare

```bash
# Avviare runtime locale (viewer 8443 + IDE/admin 8444)
./scripts/start_runtime.sh

# T-26: Configurazione → Runtime → connettiti → sezione "GitOps"
# → "💾 Commit" → scrivi messaggio → Salva
# → "↑ Push (N)" → confirm → mostra output git push

# T-24: Configurazione → tab "Device"
# → aggiungi device (URL del runtime locale: https://localhost:8444, admin/admin)
# → "Aggiorna" → mostra stato online + firma SHA256
# → "Connetti" → l'IDE si connette a quel runtime

# T-25: Configurazione → Runtime → connettiti
# → sezione "Log remoti" → "Aggiorna" → lista log
# → "● Live" → aggiornamento automatico ogni 5 s

# Smoke fingerprint:
TOKEN=$(curl -sk -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | jq -r .token)
curl -sk -H "Authorization: Bearer $TOKEN" https://localhost:8444/api/project/fingerprint
# → {"sha256":"...","computed_at_ms":...}
```

---

## Feature set consegnato (PoC completo T-01…T-27)

| Area | Funzionalità |
|------|-------------|
| **Protocolli** | Modbus TCP+RTU, MQTT+Sparkplug B, OPC-UA client+server, HomeAssistant WS, Siemens S7, EtherNet/IP |
| **Editor canvas** | Tutti i widget, symbol picker (22 built-in + custom), faceplate, grid, undo/redo 200 step |
| **Auth/RBAC** | Argon2id, 4 ruoli, ABAC zone, session TTL configurabile per utente, audit log |
| **Allarmi** | ISA-18.2 state machine, multi-condizione, delay, inhibit, shelving, webhook, SMTP escalation |
| **Historian** | Ring-buffer + SQLite per-progetto, CSV export, trend interattivo |
| **Deploy** | Dual-port 8443/8444, `--instance N` (start_runtime.sh), mDNS discovery, deploy remoto via SCP/systemd, GitOps (pull/rollback/commit/push) |
| **Observability** | Project fingerprint SHA256, device dashboard multi-runtime, remote log viewer live |
| **Canvas** | Pipe/tubazione multi-waypoint (flat/tube/wire), SVG path animato, drag waypoint |
| **Widget avanzati** | Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline |
| **Packaging** | `scripts/package.sh` → tarball `.tar.gz`; `deploy/generic-linux/install.sh` → systemd |
| **IDE deploy** | Build tarball + deploy SSH su device direttamente da Configurazione → Runtime |
| **PWA** | Service worker, manifest, auto-rotate kiosk, mobile layout |
| **Infra** | Yocto cross-compile (aarch64), Prometheus `/metrics`, audit log, log JSONL rotato, backup auto |

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md` — Q2/Q3/Q4/Q6 ora decise. Nessuna questione aperta bloccante.
