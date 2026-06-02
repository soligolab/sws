# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).

**Last session**: 2026-06-02 — T-24 (fingerprint + device dashboard), T-25 (remote logs), T-26 (git commit/push).

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

**Branch corrente**: main (tutti i commit squash-merged).

---

## Handoff prossima sessione

### Verifica manuale T-24/T-25/T-26 da fare

```bash
# Avviare runtime locale
./scripts/dev.sh

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

### Debiti tecnici noti

- `sws-kiosk` non aggiornato per `--viewer-port` (usa ancora hardcoded `https://localhost:8443` nel wayland spawn). Fix triviale in main.rs se/quando si usa il kiosk su device multi-istanza.
- `stop_existing()` in `dev.sh` usa `fuser`; su macOS o sistemi senza `fuser` non funzionerà. Non prioritario (sviluppo su Linux).
- mDNS discovery non funzionerà attraverso subnet diverse (by design — mDNS è link-local). Se serve bridge inter-subnet, post-PoC.

---

## Feature set consegnato (PoC completo T-01…T-26)

| Area | Funzionalità |
|------|-------------|
| **Protocolli** | Modbus TCP+RTU, MQTT+Sparkplug B, OPC-UA client+server, HomeAssistant WS, Siemens S7, EtherNet/IP |
| **Editor canvas** | Tutti i widget, symbol picker (22 built-in + custom), faceplate, grid, undo/redo 200 step |
| **Auth/RBAC** | Argon2id, 4 ruoli, ABAC zone, session TTL configurabile per utente, audit log |
| **Allarmi** | ISA-18.2 state machine, multi-condizione, delay, inhibit, shelving, webhook, SMTP escalation |
| **Historian** | Ring-buffer + SQLite per-progetto, CSV export, trend interattivo |
| **Deploy** | Dual-port 8443/8444, `--instance N` dev.sh, mDNS discovery, deploy remoto via SCP/systemd, GitOps (pull/rollback/commit/push) |
| **Observability** | Project fingerprint SHA256, device dashboard multi-runtime, remote log viewer live |
| **PWA** | Service worker, manifest, auto-rotate kiosk, mobile layout |
| **Infra** | Yocto cross-compile (aarch64), Prometheus `/metrics`, audit log, log JSONL rotato, backup auto |

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md` — Q2/Q3/Q4/Q6 ora decise. Nessuna questione aperta bloccante.
