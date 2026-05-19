# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.

**Last session**: 2026-05-19 (S-32) — sws-kiosk: nuovo crate WebKitGTK (Step 1+2), --kiosk-wayland in runtime, kiosk mode in dev.sh, scripts/kiosk.sh
**Last commit**: `2a2174b fix(auth): WelcomeScreen on startup — GET /api/project pre-auth + logout closes project`
**Current phase**: Phase 2 — sviluppo attivo PoC

---

## Handoff prossima sessione

1. Installa GTK4 + WebKit sul dev box: `sudo apt install libgtk-4-dev libwebkitgtk-6.0-dev`
2. Verifica build sws-kiosk: `cd sws-runtime && cargo build --manifest-path crates/sws-kiosk/Cargo.toml`
3. Test kiosk locale: `./scripts/dev.sh kiosk` (apre una finestra WebKit con il runtime)
4. Scegli un task dalla tabella "Next steps" qui sotto.

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
