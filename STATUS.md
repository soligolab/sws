# SWS — Current Status

> This file is the **session-to-session memory** for Claude Code. Update it at the end of every session before stopping work. Read it at the start of every session before touching code.

**Last session**: 2026-05-10 (bootstrap)
**Current phase**: Phase 0 → Phase 1 transition (scaffolding complete, feature work begins)
**Last commit**: TBD — bootstrap not yet committed

---

## What's working

- Monorepo scaffold (`sws-runtime/` Rust workspace + `sws-editor/` Vite+React)
- All Phase 1 community files (README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, `.gitignore`, ADR 0001)
- GitHub Actions CI (DCO, lint, build, test, audit, SBOM, multi-arch container build)
- GitLab CI mirror pipeline
- Rust workspace: `cargo check --workspace` passes
  - 10 library crates (`sws-core`, `sws-web`, `sws-auth`, `sws-historian`, `sws-audit`, `sws-pyscript`, `sws-plugin-api`, `sws-plugin-modbus`, `sws-plugin-opcua`, `sws-plugin-mqtt`)
  - Bin crate `sws-runtime` with working `/health`, `/metrics` (placeholder), self-signed TLS via rcgen, HTTPS on `0.0.0.0:8443`, graceful shutdown
- Rust Dockerfile (multi-stage, debian-bookworm-slim, non-root user, healthcheck)
- TypeScript editor: `pnpm install`, `pnpm type-check`, `pnpm build` all pass
  - App shell (header, alarm banner, mode toggle), `EditorShell`, `RuntimeView`, `SvgCanvas`, Zustand store, tag stream hook stub, i18n English baseline
- Editor Dockerfile (multi-stage, nginx:alpine serving SPA + reverse-proxying `/api` and `/ws` to runtime)
- `.claude/settings.json` configured with project-scoped permissions (`acceptEdits` default, allow list for cargo/pnpm/git/filesystem, ask for push/publish, deny for secrets/sudo/ssh)

## What's in progress

- (nothing — bootstrap closed cleanly)

## Next session should

Pick one of these as the next focused work block (each fits 3-4 hours):

1. **Commit the bootstrap** with `Signed-off-by:` trailer. Three logical commits if you want clean history:
   - `chore: scaffold repository` (Phase 1 community files only)
   - `chore: scaffold rust workspace and vite project` (Phase 2 + 3 skeletons)
   - `feat(runtime): minimal axum server with /health and HTTPS` (bin crate)
2. **Add LICENSE** with AGPL-3.0 full text. Bootstrap content-filter blocked the original write — fetch the canonical text from the SPDX repo (`https://spdx.org/licenses/AGPL-3.0-only.html`) or the GNU site.
3. **Begin Phase 1 — Tag engine MVP** in `sws-core`:
   - Define `Tag`, `TagValue`, `TagQuality` types properly
   - Build the in-memory `TagDb` with `Arc<RwLock<HashMap<TagId, TagState>>>`
   - Add a broadcast channel for subscriptions
   - Write a basic unit test that sets a tag value and receives it via the subscription
4. **Wire `sws-web` to `sws-core`**:
   - Add a `/ws/tags` WebSocket endpoint that streams tag updates
   - Add a `/api/tags` REST endpoint for one-shot reads
   - Test from the browser by reaching it from `sws-editor` dev server (proxy already configured)

Recommend starting with #1 (commit the bootstrap) so future sessions have a clean Git baseline.

## Blockers / questions for the maintainer

- LICENSE file content — confirm AGPL-3.0 SPDX text is acceptable as full-text fallback (or wait until manual addition).
- See `docs/OPEN_QUESTIONS.md` Q1 (Python embedding), Q2 (Sparkplug B), Q4 (state management) — all currently using defaults, can be revisited when their phase begins.

## Notes

- PyO3 was bumped from 0.21 (spec) to 0.23 because the system Python is 3.13 — recorded in CHANGELOG under `[Unreleased]`.
- `axum-server 0.6.0` was removed from the dependency list due to a hyper-util compatibility bug at the time of bootstrap; replaced with a direct `tokio-rustls + hyper-util` accept loop in `sws-runtime/src/main.rs`. Revisit if axum-server publishes a fix.
- `async-opcua` version corrected from spec's `0.12` (which doesn't exist on crates.io) to actual latest `0.18`.
- `pnpm` is installed in `~/.local/bin/pnpm` on the maintainer's machine (npm global prefix). The `.claude/settings.json` allow list covers both `pnpm *` and `~/.local/bin/pnpm *` to match either invocation.
- React 19 + Vite 6 + Vitest 3 + i18next 24 — all current stable as of bootstrap.
- `tsconfig.json` uses `skipLibCheck: true` because `react-i18next@15` ships with broken type declarations referencing nonexistent i18next exports. This is a known upstream issue; our own code remains strictly type-checked.
