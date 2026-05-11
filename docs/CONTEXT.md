# SWS — Project Context & Working Mode (Addendum)

> **Read this at the start of every Claude Code session before touching code.**
> This file is the working-mode reality check. The original `SWS_Project_Specification.md` describes the long-term *destination* (CRA-compliant industrial Web SCADA). This addendum describes the *current short-term reality*: a **proof-of-concept** to demonstrate that the idea is viable.
>
> Where this file and the spec disagree, **this file wins for now**.

**Last updated**: May 2026
**Maintainer**: Mauro Soligo (solo developer, side project)
**Working mode**: vibecode — Claude Code writes most of the code; the maintainer reviews, tests on hardware, makes architectural calls.
**Project stage**: **Proof of Concept**, not product.

---

## 1. What this project actually is right now

**SWS today = a PoC to answer one question: "Is the idea of a lightweight, web-based, plugin-extensible SCADA running in a container on cheap ARM industrial hardware actually viable?"**

The PoC succeeds if a single person can:

1. Spin up SWS on a Rockchip PX30 in a Podman container.
2. Load a project from a YAML folder.
3. See live data from a real PLC (Modbus TCP), a real OPC-UA server, and an MQTT/Sparkplug source.
4. Build a small synoptic in the WebEditor and watch values update live in a browser.
5. Show this to industry peers and have them say "yes, this could work as a product."

Anything beyond this is not the goal of the PoC. It can wait.

### What the PoC is NOT

- It is not a product. No customers, no SLAs, no support obligations.
- It is not 1.0. The CalVer milestones in the original spec are aspirational, not commitments.
- It is not CRA-certified. CRA is a *design influence* (see §4), not a deliverable.
- It is not feature-complete vs commercial SCADAs. Many things are deliberately left for later.

### Visibility policy

- Repo is **public but silent**: no announcements, no marketing, no community building until there is a working demo.
- README explicitly states "early proof-of-concept, not for production use."
- License (AGPL-3.0) and DCO are already in place to keep options open if the PoC succeeds.

---

## 2. Time and cadence reality

| Constraint | Value |
|---|---|
| Time budget | **4-6 h/week average**, with bursts up to 15 h on intense weeks and zero-weeks expected |
| Annual capacity | ~200-280 hours/year of human time |
| Session pattern | **Whenever a 3-4 hour focused block is available** — no fixed schedule |
| Team | **One person + Claude Code** |
| Hardware access | Maintainer-only (PX30, RK3399) |

### What this means for how Claude Code should work

- **Sessions are sparse and may be weeks apart.** Loss of context between sessions is the #1 risk.
- Every session must end with the codebase in a state the next session can resume cleanly. Update `STATUS.md` (see §6) before stopping work.
- **Each work block is 3-4 hours.** Plan tasks that fit one block. Don't start a 12-hour refactor.
- Code the maintainer can't read at midnight is technical debt, even if it's idiomatic Rust. Prefer simpler, well-commented code over clever code.
- **Permission friction is the second risk** after context loss. See `docs/CLAUDE_CODE_SETUP.md` — this project ships a tuned `.claude/settings.json` with `defaultMode: acceptEdits` so most operations don't prompt.
- "Done" for the PoC means: builds, runs on PX30 (where applicable), happy-path tested, `STATUS.md` updated.
- Premature optimization, gold-plating, feature creep, perfect test coverage → **all the enemy in PoC mode**. Ship working code, iterate.
- **No public promises.** No release dates announced externally until the thing actually exists.

---

## 3. Current bootstrap status

As of the last context update, the repository has been scaffolded with the following structure:

```
sws/
├── README.md, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, CHANGELOG.md
├── .github/workflows/ci.yml (DCO, lint, build, test, audit, SBOM, multi-arch container)
├── .gitlab-ci.yml (mirror pipeline)
├── .claude/settings.json (Claude Code permissions, project-scoped — see CLAUDE_CODE_SETUP.md)
├── docs/adr/0001-state-management.md (Zustand vs RTK, pending)
├── sws-runtime/ (Rust workspace, cargo check passes)
│   └── crates/ (sws-core, sws-web, sws-auth, sws-historian, sws-audit,
│                sws-pyscript, sws-plugin-api, sws-plugin-{modbus,opcua,mqtt},
│                sws-runtime [bin])
└── sws-editor/ (Vite + React + TypeScript, pnpm build passes)
    └── src/ (App, EditorShell, RuntimeView, SvgCanvas, store, tagStream, i18n)
```

Verified working at last bootstrap:
- `cd sws-runtime && cargo check --workspace` — passes
- `cd sws-editor && pnpm build` — passes
- `cd sws-editor && pnpm type-check` — passes

Still to do (was deferred during bootstrap):
- LICENSE file (AGPL-3.0 full text) — content-filter blocked the original write, add it manually or via short SPDX reference + URL
- Actual feature implementation — bootstrap created skeletons only, all crates have `// TODO:` placeholders

---

## 4. Honest milestone plan

Forget the CalVer dates from the original spec. Realistic plan based on actual time budget:

### Phase 0 — Scaffolding ✅ COMPLETE

Bootstrap done. Two-container monorepo structure, CI, Dockerfiles, healthcheck endpoint. `cargo check` and `pnpm build` both green.

### Phase 1 — Tag engine + Modbus TCP (next, ~60 h work)

- Centralized in-memory tag database with WSS streaming.
- Project loader: YAML files from a folder, hot reload on change.
- Modbus TCP plugin reading/writing real registers (`tokio-modbus`).
- Auth: single admin user, Argon2id password, session cookies.
- WebEditor: drag primitive on canvas, bind to tag, save synoptic YAML, see live value.
- **Exit criteria**: maintainer builds and demos "blink an LED on a real PLC from a browser tab" on PX30.

### Phase 2 — Historian + Alarms + RBAC (~50 h work)

- SQLite historian plugin: deadband + on-change + periodic.
- Alarm engine: definition, active list, acknowledge.
- Audit log v1: file-based, hash-chained (HMAC signing deferred).
- Trend chart in the editor (Canvas 2D).
- RBAC: Viewer / Operator / Supervisor / Admin roles.
- **Exit criteria**: a small real SCADA project (e.g. Mauro's solar plant monitoring) deployable end-to-end.

### Phase 3 — MQTT + Sparkplug B (~50 h work)

- `rumqttc` MQTT client plugin.
- Optional embedded `rumqttd` broker mode.
- Sparkplug B encoding/decoding (likely contributing to or forking `sparkplug-rs`, possibly hand-rolled with `prost` — see OPEN_QUESTIONS Q2).
- **Exit criteria**: SWS publishes tag changes as Sparkplug B; another SWS instance subscribes and receives them.

### Phase 4 — OPC-UA client + server (~80 h work)

- `async-opcua` integration: client plugin first, server plugin after.
- Tested against a real industrial PLC (Siemens / B&R / similar), not just simulators.
- **Exit criteria**: bidirectional OPC-UA tag exchange with at least one real PLC documented in the test report.

### Phase 5 — PoC public demo (~30 h work)

- Documentation site (Docusaurus) with operator manual, project format reference.
- Short demo video showing all three protocols feeding a live synoptic on PX30.
- "Soft launch" announcement, opening discussion for feedback.

### Realistic PoC-complete horizon

**12-18 months of calendar time** from bootstrap. The goal is **demo-able viability**, not 1.0. After that, the decision is "graduate to product" or "park the experiment." Either is fine.

Phases beyond PoC (WebEditor "complete" with animations + multi-user, S7, EtherNet/IP, OAuth/LDAP plugins, OTA updates with rollback, full CRA program) are post-PoC territory.

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
| Metrics | Prometheus exposition (placeholder for now) | `metrics`, `metrics-exporter-prometheus` |
| OPC-UA client + server | Pure-Rust | `async-opcua` 0.18 (FreeOpcUa, MPL-2.0) |
| Modbus TCP/RTU | Pure-Rust async | `tokio-modbus` 0.6 (slowtec, MIT/Apache-2.0) |
| MQTT client | Pure-Rust async | `rumqttc` 0.24 (Bytebeam, Apache-2.0) |
| MQTT broker (optional embedded) | Pure-Rust | `rumqttd` 0.19 (Bytebeam, Apache-2.0) |
| Sparkplug B | TBD — see OPEN_QUESTIONS Q2 | likely `prost` + manual encoding |
| Password hashing | Argon2id | `argon2` |
| User scripting | Embedded CPython sandboxed | `pyo3` 0.23 + RestrictedPython |
| Frontend | TypeScript + React 19 + Vite 6 | — |
| Frontend package manager | pnpm 9 | — |
| Frontend state mgmt | Zustand (provisional, ADR 0001 pending) | `zustand` |
| Graphic rendering | SVG (interactive) + Canvas 2D (trends) | — |
| Project format | YAML files in a folder, one synoptic per file | `serde_yaml` |
| Plugin loading | Dynamic `.so` via stable C ABI | `abi_stable` crate as fallback |
| Container base | `debian:bookworm-slim` | — |
| Architectures | `linux/arm64`, `linux/amd64` | — |
| Repository layout | **Monorepo** with `sws-runtime/` and `sws-editor/` subdirectories | — |
| License | AGPL-3.0 | LICENSE file pending |
| Contributor agreement | DCO (`Signed-off-by:` on every commit) | — |
| Branching | Trunk-based, short feature branches | — |
| Versioning | CalVer (`YYYY.MM[.patch]`), starting at `0.1.0-dev` | — |
| Reference hardware | Rockchip PX30, RK3399 | — |
| UI / docs language | English only | — |

If a session needs to revisit any of these, **stop and ask the maintainer first**. Don't refactor across architectural decisions in a vibecode session.

---

## 6. CRA scope for the PoC

The original spec lists a full CRA compliance program. For the PoC, **CRA is an architectural compass, not a deliverable**. We implement what's cheap and architecturally consequential; we defer what's heavy and process-driven.

### IN scope for PoC (do these now)

- **HTTPS/WSS only**, no plain HTTP. Self-signed cert auto-generated on first run. ✅ done at bootstrap
- **No default credentials**. First run forces admin password creation. (entrypoint.sh enforces `SWS_ADMIN_PASSWORD`) ✅ done at bootstrap
- **Argon2id** password hashing, never plain or weak hashes.
- **Non-root container user**, capabilities dropped where reasonable. ✅ done at bootstrap
- **Pinned dependencies** (`Cargo.lock`, `pnpm-lock.yaml` always committed).
- **CycloneDX SBOM** generated by CI on every build (cheap, automatic). ✅ done at bootstrap
- **Vulnerability scanning** in CI: `cargo-audit`, `npm audit`, `trivy`. Non-blocking warnings for now (we're a PoC, not blocking on every advisory). ✅ done at bootstrap
- **Audit log v1**: simple append-only file, structured JSON. Records auth events, tag writes, project changes.
- **Memory-safe Rust**: no `unsafe` without a `// SAFETY:` comment.
- **Secrets deny rules** in `.claude/settings.json` so Claude Code can never read `.env`, `*.pem`, `*.key`, etc. ✅ done

### OUT of scope for PoC (defer to product phase)

- HMAC-signed / hash-chained tamper-evident audit log.
- Public security advisory feed (RSS, mailing list).
- Formal vulnerability disclosure process with SLAs.
- Container signing with cosign.
- Automatic update with rollback.
- Let's Encrypt integration.
- Full ABAC zone-based permissions (basic RBAC is enough for PoC).
- OAuth2/OIDC, LDAP authentication plugins.
- 21 CFR Part 11 audit trail compatibility.

When in doubt: **CRA-friendly architecture yes, CRA-compliant process no.**

---

## 7. PoC scope per protocol

For each protocol, the PoC needs:

1. **Happy-path connection** to a real device.
2. **Read + write of basic tag types** (bool, int, float, string).
3. **One demo synoptic in the WebEditor** that visibly uses that protocol.

That's it. No need for:
- Edge cases, reconnection storms, partial failures (log them, move on).
- Full address space browsing (OPC-UA) — manual config is fine.
- Sparkplug birth/death/rebirth full state machine — basic publish/subscribe is enough.
- Modbus RTU (TCP only for PoC).
- TLS on Modbus or MQTT (HTTPS for the web side is enough; field protocols can be plain in PoC).

### Per-protocol exit criteria

| Protocol | "Done for PoC" means |
|---|---|
| **Modbus TCP** | Reads holding registers from a real PLC, writes to a coil, both visible in a browser synoptic |
| **OPC-UA client** | Subscribes to nodes on a real OPC-UA server, values stream to the browser |
| **OPC-UA server** | Exposes SWS internal tags as OPC-UA nodes, a third-party OPC-UA client can read them |
| **MQTT client** | Publishes tag changes and subscribes to commands on a broker |
| **Sparkplug B** | One SWS instance publishes Sparkplug-encoded data, another SWS subscribes and decodes |

Once each protocol hits "done for PoC", **stop iterating on it** and move to the next. Polishing is for the product phase.

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
- Comment generously, especially around protocol-specific quirks (OPC-UA security policies, Modbus byte order, Sparkplug payload schemas).
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

See `docs/OPEN_QUESTIONS.md` for the running list. **Don't decide these in a vibecode session** — bring them to the maintainer.

Current questions: Python embedding strategy, Sparkplug B implementation, plugin ABI strategy, frontend state management, i18n scaffolding, symbol library packaging.

---

## 10. Anti-patterns to actively avoid

Things that will hurt this PoC specifically. If Claude Code finds itself doing any of these, **stop and reconsider**.

- ❌ **Refactoring across architectural lines** without maintainer sign-off (e.g. "let me just switch from Axum to Actix because…").
- ❌ **Adding dependencies casually**. Each new crate is a CRA surface and a maintenance commitment. Use what's in §5 unless there's a strong reason.
- ❌ **Writing >500 lines without a `cargo check`**. Long unverified diffs are session-ending failures.
- ❌ **Implementing "edge cases" that aren't in PoC scope**. The happy path is enough. Log and move on.
- ❌ **Touching multiple subsystems in one commit**. PRs should be focused.
- ❌ **Skipping `STATUS.md` update at session end**. This is the single most important habit for vibecode continuity.
- ❌ **Implementing features not on the current phase plan**. If it's Phase 1, don't start MQTT work yet.
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
