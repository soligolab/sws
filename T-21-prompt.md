Nuovo task SWS: separazione runtime / admin / editor in tre webserver distinti.

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Architettura attuale (da cambiare)
- Un solo webserver HTTPS su porta 8443 (sws-runtime/crates/sws-web/src/router.rs)
- Serve: API REST, WebSocket, sinottico live, editor SPA (--www flag), pannello admin/config
- Autenticazione: bearer token RBAC (Viewer/Operator/Supervisor/Admin)
- L'editor SPA (sws-editor/) ha una tab "Runtime View" che mostra sinottico live

### Obiettivo
Dividere in tre ambienti nettamente separati:

---

#### 0. Due modalità di deployment del runtime

**Modalità web** (default):
- Porta 8443 bindata a `0.0.0.0` — sinottico raggiungibile da rete
- Porta 8444 bindata a `0.0.0.0` — admin console raggiungibile da rete

**Modalità kiosk** (`--kiosk`):
- Porta 8443 bindata a `127.0.0.1` — solo sws-kiosk (GTK4 + WebKitGTK) sulla stessa macchina
- Porta 8444 bindata a `0.0.0.0` — admin console sempre raggiungibile da rete (laptop tecnico)
- sws-kiosk è un binario separato avviato da propria systemd unit (`sws-kiosk.service`) che dipende da `sws-runtime.service` ed esegue `sws-kiosk --url https://localhost:8443`
- Il modal login/logout funziona identicamente — WebKitGTK renderizza la stessa SPA web, nessun codice speciale

#### 1. Runtime webserver — porta 8443 (SOLO sinottico)
- Serve la Runtime SPA (nuovo bundle React minimale: sinottico + login modal)
- Accesso anonimo in sola lettura: GET /api/tags, GET /api/synoptics/*, WS /ws/tags, WS /ws/alarms
- Accesso autenticato (Operator+): scrittura tag, ACK allarmi, ricette
- Login: modal overlay sopra il sinottico (non redirect)
- Logout: invalida token → torna alla modalità read-only anonima
- NON espone: PUT /api/project/*, PUT /api/synoptics/*, /api/backups, /api/auth/users, /api/system/*, /api/projects
- I pulsanti nel canvas supportano una nuova proprietà `button_action: LoginModal | LogoutReturn | Navigate(url)` oltre agli esistenti on_press/on_release Python

#### 2. Admin webserver — porta 8444 (operazioni amministrative)
- Secondo Axum listener nello stesso processo runtime (condivide Arc<AppState>)
- Stessa TLS (stesso certificato rcgen)
- Serve la Admin SPA (nuovo bundle React minimale)
- Auth richiesta sempre: solo Admin e Supervisor (403 per Viewer e Operator)
- Espone: start/stop/reboot, backup/restore, log viewer, utenti, configurazione tag/sorgenti/allarmi, GitOps, WelcomeScreen progetti
- NON espone le route del sinottico live

#### 3. Editor — solo canvas editor (nessun runtime view)
- Rimuovere completamente la tab "Runtime View" (sws-editor/src/editor/EditorShell.tsx)
- L'editor rimane: canvas, properties panel, layers, pages, tags, sorgenti, allarmi, funzioni, ricette, backup, utenti
- Nella sezione "Connetti ad un altro dispositivo" (RemoteRuntimeModal in sws-editor/src/components/WelcomeScreen.tsx) aggiungere sezione "Deploy runtime":
  - Campo "Architettura target": linux/amd64 | linux/arm64
  - Campo "Indirizzo SSH": host:port (default :22), utente SSH, password SSH
  - Credenziali salvate in localStorage con chiave `sws.deploy.{host}`
  - Bottone "Deploy": chiama /api/deploy/remote (nuovo endpoint admin su porta 8444), che:
    1. Scarica il binario corretto da GitHub Releases
    2. Esegue SSH/SCP verso il dispositivo remoto
    3. Riporta stato e log in streaming

### File critici da modificare

**Rust backend:**
- sws-runtime/crates/sws-web/src/router.rs — split in runtime_router() + admin_router()
- sws-runtime/crates/sws-runtime/src/main.rs — secondo TcpListener 8444 + flag `--kiosk` (8443 → 127.0.0.1)
- sws-runtime/crates/sws-web/src/ — optional_auth middleware (no token → role=None, read-only)
- Nuovo endpoint POST /api/deploy/remote (admin only, porta 8444)
- deploy/yocto/sws-kiosk.service — nuova unit systemd per sws-kiosk

**Frontend:**
- sws-editor/src/editor/EditorShell.tsx — rimuovere tab RuntimeView
- sws-editor/src/components/WelcomeScreen.tsx — estendere RemoteRuntimeModal con sezione Deploy
- Nuovo sws-admin/ (mini-SPA Vite/React) — pannello admin embeddato su porta 8444
- Proprietà pulsante: aggiungere button_action enum (YAML schema + properties panel + renderer)

### Approccio PoC — fai la cosa più semplice che funziona
- Admin SPA: secondo Vite entry point nello stesso package sws-editor (condivide componenti)
- Secondo listener Axum: clona Arc<AppState>, stessa TLS
- optional_auth: non rifiuta richieste senza token, imposta role=None
- button_action: campo opzionale nel YAML Button; renderer runtime lo interpreta, Python non eseguito se LoginModal/LogoutReturn
- Deploy SSH: preferire tokio::process::Command con ssh/scp per evitare dipendenze nuove

### Modalità kiosk — dettaglio implementativo

Flag `--kiosk` in main.rs: cambia solo il binding di 8443 da `"0.0.0.0:8443"` a `"127.0.0.1:8443"`. Nessun'altra differenza funzionale.

Aggiungere `deploy/yocto/sws-kiosk.service`:
```ini
[Unit]
Description=SWS Kiosk Browser
After=sws-runtime.service graphical.target
Requires=sws-runtime.service

[Service]
Type=simple
User=pixsys
Environment=WAYLAND_DISPLAY=wayland-0
ExecStartPre=/bin/sleep 2
ExecStart=/data/user/sws/sws-kiosk --url https://localhost:8443
Restart=on-failure

[Install]
WantedBy=graphical.target
```

sws-runtime.service in modalità kiosk: aggiungere `--kiosk` a ExecStart (o via `runtime.env`).

### Workflow git — REGOLA FONDAMENTALE

**Tutto il lavoro avviene nel branch `feat/T-21-split-webservers`. Non si tocca `main` finché il maintainer non conferma che tutto funziona.**

```bash
# Prima sessione
git checkout main && git pull
git checkout -b feat/T-21-split-webservers
# Sessioni successive
git checkout feat/T-21-split-webservers
```

- Tutti i commit intermedi (anche wip, anche broken) vanno in questo branch.
- Mai commit diretti su main.
- Fine sessione: cargo check + pnpm build verdi (o commit wip: documentato in STATUS.md).
- Branch resta aperto tra sessioni fino a verifica completa del maintainer.

**Squash merge finale** — solo quando il maintainer dice "funziona tutto":
```bash
git checkout main
git merge --squash feat/T-21-split-webservers
git commit -s -m "feat(T-21): split runtime/admin/editor into separate webservers"
# NON cancellare il branch feat/T-21-split-webservers
```
`git merge --squash` compatta tutti i commit intermedi in uno solo su main.

### Sottotask (in ordine)
1. [ ] Split router.rs in runtime_router() + admin_router() (solo refactoring)
2. [ ] Secondo TcpListener 8444 in main.rs + flag --kiosk
3. [ ] optional_auth middleware per accesso anonimo read-only su porta 8443
4. [ ] Rimuovere RuntimeView tab dall'editor
5. [ ] button_action enum al tipo Button (YAML + properties panel + renderer)
6. [ ] sws-admin mini-SPA (Vite build separata, componenti estratti dall'editor)
7. [ ] Sezione Deploy in RemoteRuntimeModal + endpoint /api/deploy/remote
8. [ ] Unit systemd sws-kiosk.service

Inizia con i sottotask 1-3. Verifica con `cargo check` prima di procedere al frontend.

### Verifica end-to-end
- `curl -k https://localhost:8443/api/tags` → 200 senza token (anonimo read-only)
- `curl -k https://localhost:8444/health` → 200 (admin port attiva)
- `curl -k https://localhost:8443/api/backups` → 401/403 (non esposto su porta runtime)
- Browser 8443 → sinottico read-only senza login
- Browser 8444 → admin panel con login Admin/Supervisor
- Editor: tab RuntimeView assente
- Pulsante `button_action: LoginModal` → click apre modal login sul sinottico
- Runtime con `--kiosk`: porta 8443 non raggiungibile da rete esterna
- `cargo check` + `pnpm build` verdi
