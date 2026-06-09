# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).

**Last session**: 2026-06-09 — TLS opzionale (branch `feat/tls-optional`).

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

**Branch corrente**: `feat/split-runtime-editor-scripts` (pushato, pronto per squash merge).

---

## Remaining tasks

> Unica traccia del lavoro ancora aperto. Aggiorna man mano che gli item si chiudono.

- [x] **TLS opzionale** (feature) — ✅ fatto su `feat/tls-optional` (HTTP default + genera/carica/disabilita TLS da ConfigView). Resta solo lo squash merge + verifica browser. Dettagli nel blocco "Last session".
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
