# SWS — Project Context & Working Mode (Addendum)

> **Read this at the start of every Claude Code session before touching code.**
> This file is the working-mode reality check. The original `SWS_Project_Specification.md`
> describes the long-term *destination* (CRA-compliant industrial Web SCADA). This addendum
> describes the *current short-term reality*.
>
> Where this file and the spec disagree, **this file wins for now**.

**Last updated**: June 2026
**Maintainer**: Mauro Soligo (solo developer, side project)
**Working mode**: vibecode — Claude Code writes most of the code; the maintainer reviews, tests on hardware, makes architectural calls.
**Project stage**: **Proof of Concept — core functionality complete (T-01…T-21).** Currently in workflow refinement phase (T-22…T-26) before a soft-launch demo.

---

## 1. What this project actually is right now

**SWS today = a functionally complete PoC of a lightweight, web-based, plugin-extensible SCADA running on cheap ARM industrial hardware.**

The original PoC success criteria have been met:

1. ✅ SWS runs natively on Rockchip PX30 (Yocto cross-compiled binary).
2. ✅ Projects are loaded from YAML folders with hot-reload.
3. ✅ Live data from real PLCs: Modbus TCP, OPC-UA, MQTT/Sparkplug B, HomeAssistant.
4. ✅ Synoptics are built in the WebEditor and values update live in the browser.
5. ✅ The architecture has been shown to industry peers informally.

The current focus is on refining the **development and deployment workflow** (T-22…T-26)
before the Phase 5 public demo.

### What the PoC is NOT

- It is not a product. No customers, no SLAs, no support obligations.
- It is not 1.0. The CalVer milestones in the original spec are aspirational, not commitments.
- It is not CRA-certified. CRA is a *design influence* (see §6), not a deliverable.
- It is not feature-complete vs commercial SCADAs — many things are deliberately deferred.

### Visibility policy

- Repo is **public but silent**: no announcements, no marketing, no community building until the public demo (Phase 5).
- README explicitly states "early proof-of-concept, not for production use."
- License (AGPL-3.0) and DCO are already in place.

---

## 2. Time and cadence reality

| Constraint | Value |
|---|---|
| Time budget | **4-6 h/week average**, with bursts up to 15 h on intense weeks and zero-weeks expected |
| Annual capacity | ~200-280 hours/year of human time |
| Session pattern | **Whenever a 3-4 hour focused block is available** — no fixed schedule |
| Team | **One person + Claude Code** |
| Hardware access | Maintainer-only (PX30, RK3399, RK3588) |

### What this means for how Claude Code should work

- **Sessions are sparse and may be weeks apart.** Loss of context between sessions is the #1 risk.
- Every session must end with the codebase in a state the next session can resume cleanly. Update `STATUS.md` (see §8) before stopping work.
- **Each work block is 3-4 hours.** Plan tasks that fit one block. Don't start a 12-hour refactor.
- Code the maintainer can't read at midnight is technical debt, even if it's idiomatic Rust. Prefer simpler, well-commented code over clever code.
- **Permission friction is the second risk** after context loss. See `docs/CLAUDE_CODE_SETUP.md` — this project ships a tuned `.claude/settings.json` with `defaultMode: acceptEdits` so most operations don't prompt.
- "Done" for the PoC means: builds, runs on PX30 (where applicable), happy-path tested, `STATUS.md` updated.
- Premature optimization, gold-plating, feature creep, perfect test coverage → **all the enemy in PoC mode**. Ship working code, iterate.
- **No public promises.** No release dates announced externally until the thing actually exists.

---

## 3. Current state (as of June 2026)

The repository is fully functional. All workspace crates build (`cargo check --workspace` green), the SPA builds (`pnpm build` green), and 53+ unit tests pass.

### Crate structure

```
sws-runtime/crates/
  sws-core           — shared types (TagValue, AlarmDef, ProjectMeta, …)
  sws-auth           — Argon2id, RBAC 4 roles, session tokens
  sws-historian      — in-memory ring buffer + SQLite persistence
  sws-pyscript       — PyO3 + RestrictedPython sandbox, global script supervisor
  sws-audit          — append-only audit log (auth events, tag writes, project changes)
  sws-web            — Axum router (dual-port 8443+8444), all HTTP/WS handlers
  sws-plugin-modbus  — Modbus TCP + RTU (tokio-modbus)
  sws-plugin-opcua   — OPC-UA client + server (async-opcua)
  sws-plugin-mqtt    — MQTT client + Sparkplug B encode/decode (rumqttc + prost)
  sws-plugin-ha      — HomeAssistant WebSocket (state_changed + call_service)
  sws-plugin-s7      — Siemens S7 (pure-Rust s7 crate, tokio bridge)
  sws-plugin-enip    — EtherNet/IP (rseip, ControlLogix symbolic tag access)
  sws-runtime        — binary entry point, dual-port TLS server (8443 + 8444)
```

### Editor (sws-editor)

React + TypeScript + Vite 6 SPA. Two entry points:
- `index.html` → `src/main.tsx` → `RuntimeViewer` (operator UI, ~24 kB)
- `index-admin.html` → `src/admin-main.tsx` → `App` (full IDE, ~310 kB)

### Dual-port architecture (T-21)

| Port | Role | Auth | SPA |
|------|------|------|-----|
| **8443** | Viewer (operators) | Optional (`optional_auth`) | `dist/index.html` |
| **8444** | Admin IDE | Required | `dist/index-admin.html` |

Project lifecycle routes (`upload`, `delete`, `open`) exist **only on 8444**.

### Dev workflow

```bash
# Sul dispositivo (viewer + IDE remoto):
./scripts/start_runtime.sh   # viewer 8443 + IDE/admin 8444

# Sul PC sviluppatore (IDE locale, no viewer):
./scripts/start_editor.sh    # solo IDE 8444
# → ConfigView → Runtime → "Connetti" per deployare su dispositivo remoto
```

TLS cert is persistent between restarts (`.run/tls.crt` + `.run/tls.key`).

---

## 4. Phase plan — current status

### Phase 0 — Scaffolding ✅ COMPLETE
Bootstrap done. Monorepo structure, CI, Dockerfiles, healthcheck, `cargo check` and `pnpm build` green.

### Phase 1 — Tag engine + Modbus TCP ✅ COMPLETE
Centralized in-memory tag DB, WebSocket streaming, project YAML loader, Modbus TCP plugin,
Argon2id auth, WebEditor drag-and-drop canvas, tag binding on synoptic objects.

### Phase 2 — Historian + Alarms + RBAC ✅ COMPLETE
SQLite historian (deadband/on-change/periodic), ISA-18.2 alarm state machine (4-state,
ACK, shelving, delay, inhibit, journal), ABAC zone-based access control, audit log v1,
trend chart (Canvas 2D with pan/zoom).

### Phase 3 — MQTT + Sparkplug B ✅ COMPLETE
`rumqttc` MQTT client plugin (TLS/auth/QoS/last-will/browse), Sparkplug B encode/decode
with manual Protobuf structs (prost), SCADA Host STATE, NCMD write-back. _(T-08)_

### Phase 4 — OPC-UA client + server ✅ COMPLETE
`async-opcua` 0.18 client (subscribe/write/browse/Euromap auto-detect, security policies
Basic256Sha256) + server (exposes SWS tags as OPC-UA nodes). _(S-62/63)_

### Phase 5 — PoC public demo 🔲 QUASI COMPLETA
Workflow refinement (T-22…T-26) + documentazione fatti. Stato item (riconciliato 2026-07-26):
- ✅ Two-terminal dev simulation — `start_runtime.sh --instance N` / `start_editor.sh --instance N`.
- ✅ Network discovery (mDNS) — `sws-web/src/discover.rs` + `GET /api/discover` (`_sws._tcp.local.`).
- ✅ Multi-device management dall'IDE — ConfigView `DevicesTab` + `POST /api/deploy/device`.
- ✅ Runtime standalone packaging — `deploy/generic-linux/` (`install.sh`, `sws-runtime.service`, launch wrapper) + `scripts/build_deploy.sh` (T-37).
- ✅ Manuale utente — 16 capitoli markdown in `docs/manual/`. Il "sito Docusaurus" originario è **superato** da questo manuale per il PoC (rivalutabile al product phase).
- 🔲 Short demo video — **unico residuo**, task del maintainer (fuori dallo scope di Claude Code).

Oltre alla demo, migliorie architetturali identificate 2026-07-26 (isolamento runtime↔IDE):
vedi `OPEN_QUESTIONS.md` Q8. In lavorazione: modalità runtime `--no-admin` (operator-only) +
gating endpoint pericolosi + audit log reale (`sws-audit`).

### Realistic PoC-complete horizon
Phase 5 is the last PoC phase. After the demo the decision is "graduate to product" or "park the experiment." Either is fine.

### Features implemented beyond the original plan
The following were not in the original Phase 1-4 plan but were implemented during the PoC:

| Feature | Task/Session |
|---------|-------------|
| Siemens S7 plugin | T-07 (S-62) |
| EtherNet/IP plugin | T-07 (S-62) |
| HomeAssistant plugin | T-09 (S-50/51) |
| Recipe Manager | T-11 (S-67) |
| Alarm shelving | S-49 |
| SMTP notifications | T-13 (S-67) |
| GitOps (git pull/rollback per project) | T-20 (S-68) |
| PWA (Progressive Web App) | T-19 (S-49) |
| Symbol picker gallery (22 built-in SVG) | T-01 (S-58) |
| Faceplate system (motor/valve/tank) | T-04 (S-66) |
| Global script scheduler (cron/interval/startup/tag-change) | T-09 (S-61) |
| CSV tag import/export | T-05 (S-60) |
| Per-device IP allowlist | S-49 |
| Split webserver 8443/8444 + admin SPA | T-21 |
| Remote deploy from IDE | T-21 (S-70) |
| Persistent TLS cert | T-21 fix |

---

## 5. Frozen architectural decisions

These were settled in the spec design rounds and confirmed at bootstrap. **Not up for debate** without strong reason. Listed here for quick reference at session start.

| Decision | Choice | Crate / library |
|---|---|---|
| Backend language | Rust (stable, edition 2021, MSRV 1.75) | — |
| Async runtime | Tokio | `tokio` |
| HTTP/WS server | Axum + Tower + hyper-util TLS loop | `axum`, `tower`, `tower-http`, `hyper-util` |
| TLS | rustls (no OpenSSL), self-signed via rcgen | `rustls`, `tokio-rustls`, `rcgen`, `rustls-pemfile` |
| Logging | Structured JSON | `tracing` + `tracing-subscriber` |
| Metrics | Prometheus exposition | `metrics`, `metrics-exporter-prometheus` |
| OPC-UA client + server | Pure-Rust | `async-opcua` 0.18 (FreeOpcUa, MPL-2.0) |
| Modbus TCP/RTU | Pure-Rust async | `tokio-modbus` 0.6 (slowtec, MIT/Apache-2.0) |
| MQTT client | Pure-Rust async | `rumqttc` 0.24 (Bytebeam, Apache-2.0) |
| MQTT broker (optional embedded) | Pure-Rust | `rumqttd` 0.19 (Bytebeam, Apache-2.0) |
| Sparkplug B | Manual Protobuf with `prost` (option C, decided T-08) | `prost` |
| Password hashing | Argon2id | `argon2` |
| User scripting | Embedded CPython sandboxed | `pyo3` 0.23 + RestrictedPython |
| Frontend | TypeScript + React 19 + Vite 6 | — |
| Frontend package manager | pnpm 9 | — |
| Frontend state mgmt | Zustand (decided — ADR 0001 accepted) | `zustand` |
| Graphic rendering | SVG (interactive) + Canvas 2D (trends) | — |
| Project format | YAML files in a folder, one synoptic per file | `serde_yaml` |
| Plugin loading | **Compiled-in workspace crates** (no dynamic .so in PoC; revisit product phase) | — |
| Container base | `debian:bookworm-slim` (container path legacy; Yocto native binary is preferred) | — |
| Architectures | `linux/arm64` (Yocto native binary — preferred); `linux/amd64` (dev) | — |
| Repository layout | **Monorepo** with `sws-runtime/` and `sws-editor/` subdirectories | — |
| License | AGPL-3.0 (full text in `LICENSE`, verified 2026-05-12) | — |
| Contributor agreement | DCO (`Signed-off-by:` on every commit) | — |
| Branching | `feat/T-XX-short-desc` branches → squash merge to main | — |
| Versioning | SemVer `MAJOR.MINOR.PATCH` dal 2026-08-11 (`2.0.0`); CalVer `YYYY.M.PATCH` prima (`2026.7.0` → `0.1.0-dev`) | — |
| Reference hardware | Rockchip PX30, RK3399, RK3588 | — |
| UI language | **Italian** (pragmatic choice for the PoC — only Italian users in scope now) | — |
| Docs/code language | English | — |

> **Nota sul formato CalVer** (2026-07-31, alla prima release): la riga diceva `YYYY.MM[.patch]`, ma
> Cargo non lo accetta — `2026.07` è rifiutato perché lo zero iniziale nel minor non è SemVer valido,
> e `2026.7` perché la patch non è opzionale. Il formato reale è quindi **`YYYY.M.PATCH`**, mese
> senza padding e patch obbligatoria. La decisione (CalVer) non cambia, cambia solo la forma che il
> toolchain permette di scrivere. Il confronto fra versioni resta numerico, quindi `2026.7.0` precede
> correttamente `2026.10.0` — è solo l'ordinamento alfabetico dei tag che sembra sbagliato.

> **Nota sul passaggio a SemVer** (2026-08-11, release `2.0.0`): il maintainer ha scelto di
> abbandonare CalVer a favore di Semantic Versioning puro (`MAJOR.MINOR.PATCH`) in occasione del
> merge del motore di rendering **LVGL** su `main` — un cambiamento abbastanza grande da
> giustificare un major bump esplicito (`2`) invece del prossimo numero di mese in sequenza. Non
> una rinumerazione retroattiva: le release precedenti (`2026.7.0` e prima) restano CalVer così
> come sono. Vedi `CHANGELOG.md` per il dettaglio.

If a session needs to revisit any of these, **stop and ask the maintainer first**. Don't refactor across architectural decisions in a vibecode session.

---

## 6. CRA scope for the PoC

The original spec lists a full CRA compliance program. For the PoC, **CRA is an architectural compass, not a deliverable**. We implement what's cheap and architecturally consequential; we defer what's heavy and process-driven.

### IN scope for PoC (done or doing)

- **HTTPS/WSS only**, no plain HTTP. Self-signed cert auto-generated on first run. ✅
- **No default credentials**. First run forces admin password creation. ✅
- **Argon2id** password hashing, never plain or weak hashes. ✅
- **Non-root container user**, capabilities dropped where reasonable. ✅
- **Pinned dependencies** (`Cargo.lock`, `pnpm-lock.yaml` always committed). ✅
- **CycloneDX SBOM** generated by CI on every build. ✅
- **Vulnerability scanning** in CI: `cargo-audit`, `npm audit`, `trivy`. ✅
- **Audit log v1**: append-only file, structured JSON. Records auth events, tag writes, project changes. ✅
- **Memory-safe Rust**: no `unsafe` without a `// SAFETY:` comment. ✅
- **Secrets deny rules** in `.claude/settings.json`. ✅
- **ABAC zone-based permissions** (T-14): per-synoptic zone access control. ✅

### OUT of scope for PoC (defer to product phase)

- HMAC-signed / hash-chained tamper-evident audit log.
- Public security advisory feed (RSS, mailing list).
- Formal vulnerability disclosure process with SLAs.
- Container signing with cosign.
- Automatic update with rollback.
- Let's Encrypt integration.
- OAuth2/OIDC, LDAP authentication plugins.
- 21 CFR Part 11 audit trail compatibility.

When in doubt: **CRA-friendly architecture yes, CRA-compliant process no.**

---

## 7. PoC scope per protocol — final status

| Protocol | Status | Task/Session |
|----------|--------|-------------|
| **Modbus TCP** | ✅ DONE — read/write, hot-reload, demo synoptic | Phase 1 |
| **Modbus RTU** | ✅ DONE — serial port, same driver as TCP | S-46 |
| **OPC-UA client** | ✅ DONE — subscribe/write/browse, security policies, Euromap | S-62/63 |
| **OPC-UA server** | ✅ DONE — SWS tags exposed as OPC-UA nodes | S-63 |
| **MQTT client** | ✅ DONE — TLS/auth/QoS/LWT, browse, Sparkplug B | T-08 (S-65) |
| **Sparkplug B** | ✅ DONE — NBIRTH/NDATA/DBIRTH/DDATA, NCMD write-back, SCADA Host STATE | T-08 |
| **HomeAssistant** | ✅ DONE — WebSocket state_changed + call_service write-back, entity browser | T-09 (S-50/51) |
| **Siemens S7** | ✅ DONE — DB/M/I/Q areas, BOOL/BYTE/INT/WORD/DINT/REAL | T-07 (S-62) |
| **EtherNet/IP** | ✅ DONE — ControlLogix symbolic tag access | T-07 (S-62) |

All "done for PoC" criteria met for every protocol. No further protocol work planned unless the maintainer requests it.

---

## 8. Session protocol — how to actually work

This is the operational rhythm Claude Code should follow.

### At the start of every session

1. Read this file (`docs/CONTEXT.md`).
2. Read `STATUS.md` at repo root.
3. Read the last entry in `CHANGELOG.md` under `[Unreleased]`.
4. Run `git status` and `git log --oneline -10` to understand what changed since last time.
5. State explicitly to the maintainer: "Last session ended with X. Current goal is Y. I plan to do Z in this session."

### During the session

- Keep changes scoped to **one logical unit** (one PR worth of work).
- Run tests and `cargo check` / `pnpm build` frequently.
- If something doesn't fit in the current 3-4 hour block, **stop at a clean point**, don't try to push through.
- **Use the approved tools without re-asking**. The `.claude/settings.json` exists so you don't have to interrupt the maintainer for routine commands. If you find yourself about to ask permission for a `cargo`/`pnpm`/`git` command, check the allow list first — it's almost certainly already approved.
- **When you do encounter a new command that gets denied**: stop, propose adding it to `.claude/settings.json` as a specific allow rule (not `Bash(*)`), and continue.

### At the end of every session

1. Ensure CI would pass (lint, build, test).
2. Update `STATUS.md` with what was done, what's pending, what the next session should pick up.
3. Update `CHANGELOG.md` under `[Unreleased]`.
4. Commit with a clear message, `Signed-off-by:` trailer.
   - **Do not push** unless explicitly told. The `ask` rules deliberately require confirmation for `git push`.
5. If the session uncovered architectural questions, write them in `docs/OPEN_QUESTIONS.md` for the maintainer to decide later.

---

## 9. Open architectural questions

See `docs/OPEN_QUESTIONS.md` for the full running list. **Don't decide these in a vibecode session** — bring them to the maintainer.

Remaining undecided questions: none of the original Q1-Q7 are open (all decided). New questions should be added when they arise.

---

## 10. Anti-patterns to actively avoid

Things that will hurt this PoC specifically. If Claude Code finds itself doing any of these, **stop and reconsider**.

- ❌ **Refactoring across architectural lines** without maintainer sign-off.
- ❌ **Adding dependencies casually**. Each new crate is a CRA surface and a maintenance commitment. Use what's in §5 unless there's a strong reason.
- ❌ **Writing >500 lines without a `cargo check`**. Long unverified diffs are session-ending failures.
- ❌ **Implementing "edge cases" that aren't in PoC scope**. The happy path is enough. Log and move on.
- ❌ **Touching multiple subsystems in one commit**. PRs should be focused.
- ❌ **Skipping `STATUS.md` update at session end**. This is the single most important habit for vibecode continuity.
- ❌ **Pretending the PoC is more than it is**. README, comments, commit messages should be honest about the stage.
- ❌ **Asking permission for an already-allowed command**. Read `.claude/settings.json` first; if a rule covers it, just run it.
- ❌ **Proposing `Bash(*)` as an allow rule** to dodge prompts. Use specific patterns; that's the whole point.

---

## 11. When the PoC succeeds

If the PoC demonstrates viability and the project transitions to "product":

- This file gets archived as `docs/history/CONTEXT-PoC-phase.md`.
- The original `SWS_Project_Specification.md` becomes the active reference.
- The full CRA program kicks in (HMAC audit, advisory feed, container signing, etc.).
- A proper announcement, contributor onboarding, and roadmap with real dates can happen.
- `.claude/settings.json` is reviewed and probably tightened (less `acceptEdits`, more `ask` rules around production-sensitive code).

Until then: **stay in PoC mode, ship working code, learn fast.**

---

*End of working-mode addendum.*
