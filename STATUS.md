# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).

**Last session**: 2026-05-21 (S-36) — Yocto cross-compile end-to-end green sul dev server in ufficio
**Last commit**: vedi `git log -1`
**Current phase**: Phase 2 — sviluppo attivo PoC

---

## Handoff prossima sessione

**Due tracce aperte. Scegli quale riprendere per prima.**

### Traccia A — Yocto cross-compile (S-36, build verde, deploy device pendente)

Build host-side completato e verificato:
- `./scripts/yocto/build.sh release` → 3m40s clean, 18 MB stripped PIE aarch64.
- `aarch64-pixsys-linux-readelf -d` NEEDED = `libpython3.12.so.1.0`, `libgcc_s.so.1`, `libm.so.6`, `libc.so.6`, `ld-linux-aarch64.so.1`. No OpenSSL, no sqlite (bundled), no GTK/WebKit.
- `scripts/yocto/deploy.sh` ora `+x` e syntax-checked.
- `scripts/yocto/build.sh` aggiornato: auto-export `PYO3_PYTHON=$(command -v python3)` (Debian non ha l'alias `/usr/bin/python` e pyo3-build-config lo richiede anche in cross mode).
- `docs/YOCTO_CROSSCOMPILE.md` scritta + linkata da `CLAUDE.md`.

**Da fare alla ripresa**:
1. **Test end-to-end su device fisico Yocto in ufficio**. Prima chiedere al maintainer device + IP + conferma `ssh-copy-id pixsys@<host>` (vedi memoria `feedback-yocto-device-access`). Poi:
   ```
   ./scripts/yocto/deploy.sh pixsys@<host>
   curl -k https://<host>:8443/health     # atteso: ok
   ```
   Se /health silenzia: `ssh pixsys@<host> 'sudo journalctl -u sws-runtime.service -n 200 --no-pager'`.
2. Smoke test SPA dal browser del PC maintainer: `https://<host>:8443/`, accettare cert self-signed, login con `admin/admin` (default in `runtime.env`), creare un progetto vuoto da template, vedere `/api/system` rispondere.
3. Aggiornare STATUS + CHANGELOG con outcome del deploy reale, commit `-s`.

Nota su una potenziale insidia futura: `sws-runtime.service` oggi gira `User=root` (semplifica scrittura `/opt/sws/`); è un debito CRA — vedi note in deploy/yocto/sws-runtime.service.

### Traccia B — Diagnostica white-window di `sws-kiosk` (S-34, ancora pendente)

Va eseguita **a casa** (l'unico setup con display GTK reale, vedi TEST_SETUPS.md §1).

Lo scopo è capire se la finestra bianca era davvero il cert (probabile NO: `--allow-insecure-tls` è `default_value_t = true` e collegato a `TLSErrorsPolicy::Ignore`) o qualcos'altro. Eseguire i passi nell'ordine e fermarsi al primo che fallisce.

1. **Runtime acceso e /health risponde**

   ```
   ./scripts/dev.sh runtime              # in un terminale
   curl -k https://localhost:8443/health # in un altro
   ```
   Atteso: `ok`. Se non risponde → il runtime non parte; guardare i log.

2. **SPA servita su `/`**

   ```
   curl -kI https://localhost:8443/
   ```
   Atteso: `200 OK` con `Content-Type: text/html`. Se è `404` o vuoto → il runtime **non ha la SPA embedded** in build dev: in quel caso o lo si avvia con `--www <path-a-dist>`, oppure il kiosk va puntato al Vite dev server (`http://localhost:5173`).

3. **Verifica visiva con browser di sistema** (Firefox o Chrome)

   Aprire `https://localhost:8443/`, accettare il cert self-signed una volta. Deve apparire la WelcomeScreen. Se Firefox è bianco/errore → il problema è lato runtime/SPA build, **non lato kiosk** — fermarsi e diagnosticare quello.

4. **Solo se 1-3 OK, lanciare il kiosk**

   ```
   cd sws-runtime
   cargo build --manifest-path crates/sws-kiosk/Cargo.toml
   cd ..
   ./sws-runtime/crates/sws-kiosk/target/debug/sws-kiosk \
     https://localhost:8443 --windowed
   ```
   (`--allow-insecure-tls` è già default `true`, lo si può omettere.)

5. **Se il kiosk resta bianco mentre Firefox funziona**

   Guardare `stderr` del processo `sws-kiosk` per gli eventuali messaggi `[sws-kiosk] load-failed …` aggiunti in questa sessione (vedi `sws-runtime/crates/sws-kiosk/src/main.rs`). Se compaiono, riportarli nella prossima sessione.

6. Se tutto va: provare `./scripts/dev.sh kiosk` (avvia runtime + kiosk insieme) e scegliere il prossimo task dalla tabella qui sotto.

---

## Next steps — priorità

| ID | Task | Stima | Note |
|----|------|-------|------|
| A1 | **sws-kiosk GTK4+WebKit** — build + test su dev box | ~30 min | Crate pronto; manca `sudo apt install libgtk-4-dev libwebkitgtk-6.0-dev` sul dev box |
| A1b | **sws-kiosk Step 3** — test su PX30 fisico (`./scripts/kiosk.sh`) | manuale | Richiede hardware + Wayland compositor (cage/weston) |
| 6.4-bis | **WS auto-reconnect con backoff esponenziale** | ~1.5 h | TODO aperto in `sws-editor/src/ws/tagStream.ts`; oggi single-attempt |
| — | **Vite bundle splitting** | ~1 h | Chunk principale 900 KB (273 KB gzip). `manualChunks` per codemirror / react / runtime |
| 8.2 | **Lockout dopo N tentativi falliti** | ~1 h | Protezione brute-force login; contatore in `sws-auth` |
| — | **OPC-UA trust list UI** | ~2 h | Oggi `trust_server_certs(true)` globale. UI per accettare/rifiutare cert per-source |
| 8.1 | **Refresh token + httponly cookie** | ~2 h | Oggi solo Bearer + localStorage |
| — | **OPC-UA historical reads** | ~3 h | `HistoryRead` service per backfill grafico Trend al primo open |
| 2.3 | Deep-link ConfigView tabs | ~30 min | Bassa priorità |
| 4.8 | Grid: drag-to-range multi-cell | ~1.5 h | Oggi solo shift+click; bassa priorità |
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
| **Protocolli** | Modbus TCP, MQTT (TLS/auth/QoS/last-will/browse), OPC-UA (subscribe/write/browse/Euromap auto-detect/security policies Basic256Sha256) |
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
