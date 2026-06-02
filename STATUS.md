# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).

**Last session**: 2026-06-02 — Revisione doc completa + T-22 + T-23.

- **Doc revision** (da piano in `.claude/plans/`): `docs/CONTEXT.md`, `OPEN_QUESTIONS.md`, `TEST_SETUPS.md`, `DEPLOY_PX30.md`, `YOCTO_CROSSCOMPILE.md`, `SWS_Project_Specification.md`, `adr/0001-state-management.md` — tutti aggiornati allo stato post T-01…T-21. Commit diretto su main.

- **T-22 — Dev UX** (`feat/T-22-dev-ux` → squash main):
  - Banner sessione TTL in `App.tsx`: compare dopo login se `session_ttl_secs > 0` (Admin/Supervisor); bottone "Disattiva" chiama `api.updateUser(authUser, { session_ttl_secs: 0 })`.
  - Pre-deploy TTL check in `ConfigView.tsx` `handleDeploy()`: se TTL = 0 → `window.confirm` per riabilitare (1 h) prima del deploy.
  - `scripts/dev.sh` riscritto con `--instance N`: porte VIEWER=8443+(N-1)×2, ADMIN=8444+(N-1)×2, VITE=5173+(N-1), data dir `.run-N/`. `stop_existing()` usa `fuser` per killare solo i processi sulle porte proprie.
  - `sws-runtime/src/main.rs`: CLI args `--viewer-port` (default 8443) e `--admin-port` (default 8444).

- **T-23 — Network discovery** (`feat/T-23-network-discovery` → squash main):
  - Runtime annuncia `_sws._tcp.local.` via mdns-sd al boot (proprietà: `admin_port`, `version`); ServiceDaemon tenuto vivo fino all'exit del processo.
  - `sws-web/src/discover.rs`: handler `GET /api/discover` (Supervisor+, porta 8444) — browse mDNS 2 s in `spawn_blocking`, restituisce `[{name, admin_url, viewer_url, version}]`.
  - Frontend: bottone "Cerca runtime" in `RuntimeConnectionTab` → lista cliccabile di device trovati → click popola il campo URL.

**Branch corrente**: main (tutti i commit squash-merged).

---

## Handoff prossima sessione

### Prossimi task dal piano workflow (T-24…T-26)

| ID | Titolo | Descrizione breve |
|----|--------|------------------|
| T-24 | Multi-device deploy | Deploy parallelo a N device (lista target, progress per-device, roll-back singolo) |
| T-25 | Remote log viewer | `GET /api/logs/stream` SSE dal runtime remoto → pannello live nell'IDE |
| T-26 | Dev.sh dual-instance smoke test | Verifica che `./scripts/dev.sh --instance 2` avvii sul secondo set di porte senza conflitti con l'istanza 1 |

### Verifica manuale T-22/T-23 da fare

```bash
# Avviare due istanze
./scripts/dev.sh --instance 1    # apre http://localhost:5173 (admin), viewer 8443
./scripts/dev.sh --instance 2    # apre http://localhost:5174, viewer 8445

# Verificare discovery (dal browser sull'istanza 1):
# Configurazione → tab Runtime → "Cerca runtime"
# → devono comparire entrambe le istanze

# Verificare TTL banner:
# Login → banner compare se session_ttl_secs > 0 → "Disattiva" → banner sparisce

# Verificare pre-deploy:
# Connettiti a istanza 2, clicca "Deploy" → se TTL=0 → confirm riabilitazione
```

### Debiti tecnici noti

- `sws-kiosk` non aggiornato per `--viewer-port` (usa ancora hardcoded `https://localhost:8443` nel wayland spawn). Fix triviale in main.rs se/quando si usa il kiosk su device multi-istanza.
- `stop_existing()` in `dev.sh` usa `fuser`; su macOS o sistemi senza `fuser` non funzionerà. Non prioritario (sviluppo su Linux).
- mDNS discovery non funzionerà attraverso subnet diverse (by design — mDNS è link-local). Se serve bridge inter-subnet, post-PoC.

---

## Feature set consegnato (PoC completo T-01…T-23)

| Area | Funzionalità |
|------|-------------|
| **Protocolli** | Modbus TCP+RTU, MQTT+Sparkplug B, OPC-UA client+server, HomeAssistant WS, Siemens S7, EtherNet/IP |
| **Editor canvas** | Tutti i widget, symbol picker (22 built-in + custom), faceplate, grid, undo/redo 200 step |
| **Auth/RBAC** | Argon2id, 4 ruoli, ABAC zone, session TTL configurabile per utente, audit log |
| **Allarmi** | ISA-18.2 state machine, multi-condizione, delay, inhibit, shelving, webhook, SMTP escalation |
| **Historian** | Ring-buffer + SQLite per-progetto, CSV export, trend interattivo |
| **Deploy** | Dual-port 8443/8444, `--instance N` dev.sh, mDNS discovery, deploy remoto via SCP/systemd, GitOps |
| **PWA** | Service worker, manifest, auto-rotate kiosk, mobile layout |
| **Infra** | Yocto cross-compile (aarch64), Prometheus `/metrics`, audit log, log JSONL rotato, backup auto |

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md` — Q2/Q3/Q4/Q6 ora decise. Nessuna questione aperta bloccante.
