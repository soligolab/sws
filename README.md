# Soligo Web SCADA (SWS)

[![CI](https://github.com/soligolab/sws/actions/workflows/ci.yml/badge.svg)](https://github.com/soligolab/sws/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Container: GHCR](https://img.shields.io/badge/Container-GHCR-green.svg)](https://github.com/soligolab/sws/pkgs/container/sws-runtime)

An open-source, web-based SCADA platform for embedded industrial hardware. SWS runs on ARM64
devices (Rockchip PX30, RK3399) as well as generic Linux, with soft real-time tag streaming, a
browser-based WYSIWYG synoptic editor, a vendor-neutral comm-plugin architecture, and a path
toward CRA-compliant deployments.

> **Status: proof of concept.** This repository is an exploratory PoC, not yet a product. The
> long-term destination is described in [`docs/SWS_Project_Specification.md`](docs/SWS_Project_Specification.md);
> the short-term reality and working mode are in [`docs/CONTEXT.md`](docs/CONTEXT.md). Where they
> conflict, `CONTEXT.md` wins until the PoC graduates.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                      │
│  ┌──────────────────────┐   ┌──────────────────────────────┐ │
│  │ Admin IDE / editor   │   │  Operator viewer             │ │
│  │ WYSIWYG synoptics    │   │  live tag streaming (WS)     │ │
│  └──────────┬───────────┘   └───────────────┬──────────────┘ │
│       REST / WS :8444 (or :8460)      REST / WS :8443         │
└─────────────┼─────────────────────────────┼──────────────────┘
              │                             │
┌─────────────┴─────────────────────────────┴──────────────────┐
│  sws-runtime (single Rust binary)                            │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────────┐  │
│  │ sws-core │  │ sws-auth │  │ sws-historian (ring+SQLite)│  │
│  │ tag DB   │  │ RBAC+ABAC│  └────────────────────────────┘  │
│  └────┬─────┘  └──────────┘  ┌────────────────────────────┐  │
│       │   plugin C ABI       │ sws-audit (hash-chain log) │  │
│  ┌────┴────────────────────┐ └────────────────────────────┘  │
│  │ Modbus · OPC-UA · MQTT  │                                 │
│  │ S7 · EtherNet/IP · HA   │                                 │
│  └─────────────────────────┘                                 │
└──────────────────────────────────────────────────────────────┘
```

The runtime is **single-binary, mono-project**: one `sws-runtime` process serves the operator
viewer, the admin IDE, and all comm plugins, and auto-opens the last active project on boot.

**Ports:**

| Port | Role | Notes |
|------|------|-------|
| `8443` | Operator viewer (RuntimeViewer SPA) | started by `start_runtime.sh` |
| `8444` | Admin IDE + full admin API | started by `start_runtime.sh` |
| `8460` | Standalone editor IDE (no viewer) | started by `start_editor.sh` on a dev PC |
| `8080` / `8090` | HTTP companion (TLS-cert acceptance helper) | only when TLS is enabled |

**Auth & TLS are both optional by default (PoC).** A project without a `users.yaml` runs in
**no-auth mode** — all routes are open, no login screen. The runtime starts in **plain HTTP**
unless a TLS certificate is present; HTTPS is enabled on demand from
*Configurazione → Stato → Certificato TLS*.

**Monorepo layout:**

| Directory | Language | Purpose |
|---|---|---|
| [`sws-runtime/`](sws-runtime/) | Rust | Cargo workspace: runtime binary + all crates (see below) |
| [`sws-editor/`](sws-editor/) | TypeScript + React | WYSIWYG synoptic editor + operator viewer SPA |
| [`scripts/`](scripts/) | Bash | Dev launchers, packaging, kiosk, container builds |
| [`deploy/`](deploy/) | — | Generic-Linux installer + systemd unit, Yocto assets |
| [`examples/`](examples/) | — | Project templates and sample synoptics |
| [`docs/`](docs/) | Markdown | Context, ADRs, and the [user manual](docs/manual/MAIN.md) |

**Rust crates** (under [`sws-runtime/crates/`](sws-runtime/crates/)):
`sws-core` (tag engine) · `sws-web` (Axum server) · `sws-auth` (RBAC/ABAC) ·
`sws-historian` (trends) · `sws-audit` (hash-chain log) · `sws-pyscript` (Python scripting) ·
`sws-kiosk` (Wayland viewer) · `sws-plugin-api` + plugins `modbus`, `opcua`, `mqtt`, `s7`,
`enip`, `homeassistant`.

---

## Quickstart (local dev)

Prerequisites: Rust ≥ 1.75, Node 20 + pnpm 9, Python 3.10+.

```bash
git clone https://github.com/soligolab/sws.git
cd sws

# Runtime on this device: viewer 8443 + admin IDE 8444 (+ HTTP companion 8080).
# Builds the backend and the SPA if stale, then auto-opens the last project.
./scripts/start_runtime.sh
```

- Operator viewer: `http://localhost:8443` (or `https://` once TLS is enabled)
- Admin IDE: `http://localhost:8444`

No credentials are required in the default no-auth PoC mode — open the IDE and start building.

To run **only the editor** on a developer PC (no viewer) and deploy to a remote runtime over the
network, use `./scripts/start_editor.sh` (IDE on `8460`) and connect to the runtime from
*ConfigView → Runtime → Connetti*.

See [`scripts/README.md`](scripts/README.md) for the full launcher reference.

### Containers

The runtime ships as a published **arm64** image for Pixsys OS / Rockchip panels. It is
self-contained — binary, templates and the SPA — and the package is public, so devices need no
credentials:

```bash
# on the device (podman rootless, no sudo)
./install-container.sh --pull        # ghcr.io/soligolab/sws-runtime:latest-arm64
```

The full procedure — cross-compile, publish, install and update — is in
[docs/DEPLOY_CONTAINER_AARCH64.md](docs/DEPLOY_CONTAINER_AARCH64.md). The `-arm64` tag suffix is
deliberate: the image is not a multi-arch manifest list.

An **x86_64** twin exists for developer machines and generic amd64 hosts — same installer, same
experience, same `ubuntu:24.04` base. Its binary is compiled inside a builder image rather than on
the host, so the result does not depend on the machine that builds it: see
[docs/DEPLOY_CONTAINER_X86_64.md](docs/DEPLOY_CONTAINER_X86_64.md). Either image can also be
installed straight from the IDE over SSH (*ConfigView → Runtime → Installa su dispositivo*), which
copies the archive instead of pulling — the fallback for a device that cannot reach the registry.

A [`compose.yaml`](compose.yaml) also exists, but that path predates no-auth mode and still expects
`SWS_ADMIN_PASSWORD`; prefer the scripts above for the current PoC workflow.

---

## Development

### Runtime (Rust)

```bash
cd sws-runtime
cargo check --workspace
cargo test  --workspace
```

### Editor (Node + pnpm)

```bash
cd sws-editor
pnpm install
pnpm build      # production SPA into dist/ (served by the runtime)
pnpm dev        # Vite dev server with hot reload (optional)
pnpm test:e2e   # Playwright end-to-end tests (needs a running runtime)
```

---

## Documentation

**[📖 Manuale Utente SWS](docs/manual/MAIN.md)** — full guide (Italian) with screenshots.

| Section | Link |
|---------|------|
| Quick Start | [docs/manual/02_quickstart.md](docs/manual/02_quickstart.md) |
| Editor guide | [docs/manual/04_editor_guide.md](docs/manual/04_editor_guide.md) |
| Widget reference | [docs/manual/05_widget_reference.md](docs/manual/05_widget_reference.md) |
| Protocols | [docs/manual/06_protocols.md](docs/manual/06_protocols.md) |
| Deployment | [docs/manual/10_deployment.md](docs/manual/10_deployment.md) |
| API reference | [docs/manual/13_api_reference.md](docs/manual/13_api_reference.md) |

Architectural Decision Records are in [`docs/adr/`](docs/adr/). Session state and the open task
list live in [`STATUS.md`](STATUS.md); change history in [`CHANGELOG.md`](CHANGELOG.md).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributors must sign off commits with
`git commit -s` (DCO). Please read our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Security

Report vulnerabilities via GitHub Security Advisories or `security@soligolab.example`.
See [SECURITY.md](SECURITY.md) for the full disclosure policy.

> ⚠️ In no-auth + plain-HTTP mode (the PoC default) the IDE and admin API are fully open and
> unencrypted. Enable authentication and TLS before exposing a runtime on an untrusted network.

---

## License

[GNU Affero General Public License v3.0](LICENSE) — © Soligo Lab
