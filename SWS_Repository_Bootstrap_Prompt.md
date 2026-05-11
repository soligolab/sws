# SWS Repository Bootstrap Prompt

> Use this prompt with an AI coding assistant (Claude Code, Cursor, etc.) inside the freshly created `soligolab/sws-runtime` and `soligolab/sws-editor` repositories to scaffold the initial codebase. Run it once per repo, or split into phases.

---

## Project context

You are bootstrapping **Soligo Web SCADA (SWS)**, an open-source web-based SCADA platform for embedded industrial hardware. Read `SWS_Project_Specification.md` (committed at the repo root) for the full architectural background. The high-level facts you need to act on:

- **Two repositories**: `soligolab/sws-runtime` (Rust) and `soligolab/sws-editor` (TypeScript + React).
- **License**: AGPL-3.0. Add `LICENSE` file with the full GNU AGPL-3.0 text.
- **DCO required**: configure repo to require `Signed-off-by:` trailer on every commit.
- **Versioning**: CalVer (`YYYY.MM[.patch]`). Initialize at `0.1.0-dev` until first release.
- **Branching**: trunk-based, `main` is releasable, feature branches via PR.
- **CI**: GitHub Actions primary, with placeholder for GitLab CI mirror.
- **Container base**: `debian:bookworm-slim`. Multi-arch: `linux/arm64`, `linux/amd64`.
- **Target hardware**: Rockchip PX30 and RK3399 (ARM64 embedded).

---

## Phase 1 — Common files (apply to BOTH repositories)

Create the following files at the root of each repo, adapted as appropriate:

1. **`README.md`** — Project pitch, quickstart, architecture diagram link, license, contribution pointer. Include badges (CI status, license, container pulls). Mention the sister repository.
2. **`LICENSE`** — Full AGPL-3.0 text.
3. **`SECURITY.md`** — Vulnerability disclosure policy:
   - Private reporting via GitHub Security Advisories and `security@soligolab.example` (placeholder).
   - 90-day coordinated disclosure target.
   - Link to public advisory feed (placeholder URL).
4. **`CONTRIBUTING.md`** — Contributor guide:
   - DCO requirement: every commit must include `Signed-off-by: Name <email>` (use `git commit -s`).
   - Branch naming: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
   - PR template requirements: description, related issue, CHANGELOG update, tests passing.
   - Code review: at least one maintainer approval.
5. **`CODE_OF_CONDUCT.md`** — Use Contributor Covenant 2.1.
6. **`CHANGELOG.md`** — Keep-a-Changelog format, with `[Unreleased]` section.
7. **`.github/workflows/ci.yml`** — GitHub Actions:
   - Lint, build, test on every PR and push to `main`.
   - SBOM generation (CycloneDX) on every build, uploaded as artifact.
   - Vulnerability scan (`cargo-audit` for Rust, `npm audit` for Node, `trivy` for container image) — fail on HIGH or CRITICAL.
   - Multi-arch container build (`linux/arm64`, `linux/amd64`) on tags.
   - DCO check on PRs.
8. **`.github/PULL_REQUEST_TEMPLATE.md`** — Checklist for description, CHANGELOG entry, tests, DCO sign-off.
9. **`.github/ISSUE_TEMPLATE/`** — Bug report and feature request templates.
10. **`.gitlab-ci.yml`** — Minimal mirror pipeline that triggers same CI steps, for users mirroring to internal GitLab.
11. **`.gitignore`** — Standard for the language plus `.idea/`, `.vscode/` (except shared `.vscode/extensions.json`).
12. **`docs/`** — Folder placeholder; the documentation site will live separately (Docusaurus), but architectural decision records (ADRs) and design notes go here.

---

## Phase 2 — `sws-runtime` repository (Rust)

### 2.1 Workspace layout

Create a Cargo workspace:

```
sws-runtime/
├── Cargo.toml                  # workspace manifest
├── Cargo.lock
├── crates/
│   ├── sws-core/               # tag engine, project loader, hot reload
│   ├── sws-web/                # axum server, WSS streaming, REST API
│   ├── sws-auth/               # auth, RBAC+ABAC, session manager
│   ├── sws-historian/          # historian trait + SQLite default impl
│   ├── sws-audit/              # hash-chained audit log
│   ├── sws-pyscript/           # PyO3 + RestrictedPython sandbox
│   ├── sws-plugin-api/         # stable C ABI for comm and storage plugins
│   ├── sws-plugin-modbus/      # Modbus TCP/RTU plugin (tokio-modbus)
│   ├── sws-plugin-opcua/       # OPC-UA client+server plugin (async-opcua)
│   ├── sws-plugin-mqtt/        # MQTT client + optional embedded broker
│   └── sws-runtime/            # bin crate; wires everything together
├── docker/
│   ├── Dockerfile              # multi-stage, debian-bookworm-slim final
│   └── entrypoint.sh
├── tests/
│   └── integration/
└── benches/                    # criterion benchmarks for tag engine
```

### 2.2 Workspace Cargo.toml

- Set `resolver = "2"`.
- `[workspace.package]` block with shared metadata: license `AGPL-3.0-only`, edition `2021`, rust-version `1.75` minimum.
- `[workspace.dependencies]` with pinned versions of: `tokio`, `axum`, `tower`, `tower-http`, `tracing`, `tracing-subscriber`, `serde`, `serde_yaml`, `serde_json`, `rustls`, `argon2`, `tokio-modbus`, `async-opcua`, `rumqttc`, `rumqttd`, `pyo3`, `metrics`, `metrics-exporter-prometheus`, `cyclonedx-rs` (or use external `cargo-cyclonedx` for SBOM).

### 2.3 Initial code skeletons (do not implement business logic yet)

For each crate, create:
- `Cargo.toml` referencing the workspace dependencies.
- `src/lib.rs` with module declarations and a `// TODO:` comment stating the crate's responsibility (taken from §3.2 of the spec).
- An empty `tests/` folder with a placeholder doc test.

The bin crate `sws-runtime` should have a `main.rs` that:
- Parses CLI args (config path, project root path) using `clap`.
- Initializes `tracing` with JSON formatter.
- Sets up a placeholder Axum router with a `/health` endpoint returning 200 OK and a `/metrics` endpoint returning Prometheus exposition (empty for now).
- Auto-generates a self-signed TLS certificate on first run if none exists.
- Logs "SWS runtime starting" and parks on a Tokio signal handler.

### 2.4 Dockerfile

Multi-stage build:
- **Stage 1 (builder)**: `rust:1.75-bookworm`, build with `--release`, run `cargo cyclonedx --format json` to emit SBOM.
- **Stage 2 (runtime)**: `debian:bookworm-slim`, install `ca-certificates` and `libpython3.11` (for PyO3), create non-root user `sws`, copy binary and SBOM, expose ports `8443` (HTTPS) and `9090` (metrics), `USER sws`, healthcheck via `curl -fk https://localhost:8443/health`.

### 2.5 Plugin API (sws-plugin-api)

Define a stable C ABI for plugins:
- `extern "C"` `plugin_init`, `plugin_shutdown`, `plugin_describe` functions.
- `#[repr(C)]` structs for `PluginManifest`, `TagValue`, `TagQuality`.
- Use the `abi_stable` crate as a fallback if pure C ABI proves too restrictive.
- Document the contract with examples.

---

## Phase 3 — `sws-editor` repository (TypeScript + React)

### 3.1 Project setup

- **Bundler**: Vite with `@vitejs/plugin-react`.
- **Language**: TypeScript strict mode.
- **Linting**: ESLint with `@typescript-eslint`, Prettier.
- **Testing**: Vitest + Testing Library.
- **Routing**: TanStack Router (or React Router 6, decide in PR).
- **State management**: leave the choice as an open ADR (Zustand vs Redux Toolkit). Set up a placeholder slice/store and document the decision pending.

### 3.2 Layout

```
sws-editor/
├── package.json
├── pnpm-lock.yaml              # use pnpm
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
├── prettier.config.js
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/                    # REST client for runtime API
│   ├── ws/                     # WSS tag streaming client
│   ├── canvas/                 # SVG + Canvas rendering primitives
│   ├── editor/                 # WYSIWYG editor canvas, toolbox, properties panel
│   ├── runtime-view/           # operator view (read-only synoptic)
│   ├── components/             # reusable UI components (alarm banner, trend, etc.)
│   ├── i18n/                   # i18next setup, English locale
│   ├── store/                  # state management
│   └── types/                  # shared TypeScript types (mirroring runtime)
├── docker/
│   └── Dockerfile              # multi-stage: pnpm build + nginx:alpine final
└── tests/
```

### 3.3 Initial component scaffolding

- **App shell**: top header (logo, user, project selector, mode toggle Edit/View), left sidebar (synoptic tree), main canvas, right properties panel.
- **Canvas primitive**: an SVG-based component that renders a list of objects from a YAML synoptic file and supports drag, select, resize.
- **Tag binding panel**: text input with autocomplete from the runtime tag list (placeholder data initially).
- **Hello-World synoptic**: a YAML fixture loaded from disk that renders a rectangle and a numeric display bound to a fake tag.

### 3.4 Dockerfile

Multi-stage:
- **Stage 1**: `node:20-bookworm-slim`, run `pnpm install --frozen-lockfile && pnpm build`.
- **Stage 2**: `nginx:alpine`, copy built `dist/` into `/usr/share/nginx/html`, custom `nginx.conf` enforcing HTTPS-only with auto-generated certificate (mounted from runtime via shared volume), reverse-proxying `/api` and `/ws` to the runtime container.

---

## Phase 4 — Compose orchestration

In a separate `soligolab/sws-deploy` repository (or in a `deploy/` folder of `sws-runtime`), provide a reference `compose.yaml`:

```yaml
services:
  runtime:
    image: ghcr.io/soligolab/sws-runtime:latest
    volumes:
      - ./projects:/var/sws/projects   # bind-mount user projects
      - sws-config:/var/sws/config     # certificates, keys, audit logs
    ports:
      - "8443:8443"
      - "9090:9090"
    restart: unless-stopped
  editor:
    image: ghcr.io/soligolab/sws-editor:latest
    volumes:
      - sws-config:/var/sws/config:ro
    ports:
      - "8444:8443"
    depends_on: [runtime]
    restart: unless-stopped
volumes:
  sws-config:
```

---

## Phase 5 — Documentation site

Outside the code repos, create a `soligolab/sws-docs` repository with **Docusaurus 3** (or Mintlify if preferred). Initial sections:

1. **Getting started** — installation on Podman, first project.
2. **Architecture overview** — extracted from this spec.
3. **Project format reference** — every YAML schema documented.
4. **Plugin development guide** — comm plugin and storage plugin tutorials.
5. **Operator manual** — login, navigation, alarms, recipes.
6. **Security advisory feed** — RSS endpoint.

---

## Phase 6 — First commits to make

1. Empty repo, then PR #1: `chore: scaffold repository` — adds Phase 1 files.
2. PR #2: `chore: scaffold rust workspace` (runtime) / `chore: scaffold vite project` (editor) — adds Phase 2/3 layout with empty crates/components.
3. PR #3: `feat: minimal axum server with /health and /metrics` (runtime) / `feat: app shell with placeholder canvas` (editor).
4. PR #4: `chore: dockerfile and ci pipeline` — multi-arch build and SBOM generation.

Each PR must:
- Be small and reviewable.
- Update `CHANGELOG.md` under `[Unreleased]`.
- Pass the full CI pipeline (lint, build, test, security scan).
- Carry `Signed-off-by:` trailers.

---

## Constraints to honor at every step

- **Memory safety**: no `unsafe` blocks in Rust code without an accompanying `// SAFETY:` comment justifying invariants.
- **No plain HTTP**: HTTPS-only from day one. Even local dev uses self-signed.
- **No default credentials**: enforce admin password set on first run.
- **Pinned dependencies**: `Cargo.lock` and `pnpm-lock.yaml` always committed.
- **CRA traceability**: the `SECURITY.md` and SBOM artifacts must be present on every release.
- **English-only** source, comments, documentation, UI strings (with i18n scaffolding for future translations).
- **DCO**: every commit `Signed-off-by:`.

---

When you finish each phase, output:
1. A summary of files created.
2. A list of follow-up TODOs that were marked in code.
3. The next recommended PR title and scope.
