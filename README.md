# Soligo Web SCADA (SWS)

[![CI](https://github.com/soligolab/sws/actions/workflows/ci.yml/badge.svg)](https://github.com/soligolab/sws/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Container: GHCR](https://img.shields.io/badge/Container-GHCR-green.svg)](https://github.com/orgs/soligolab/packages)

An open-source, web-based SCADA platform for embedded industrial hardware. SWS runs on ARM64
devices (Rockchip PX30, RK3399) and targets CRA-compliant deployments with soft real-time
tag streaming, a browser-based WYSIWYG editor, and a vendorneutral plugin architecture.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌─────────────┐   ┌──────────────────────────────────┐ │
│  │ sws-editor  │   │  Operator View (runtime-view)    │ │
│  │ WYSIWYG     │   │  live WSS tag streaming          │ │
│  └──────┬──────┘   └───────────────┬──────────────────┘ │
│         │ HTTPS REST / WSS         │                    │
└─────────┼──────────────────────────┼────────────────────┘
          │                          │
┌─────────┴──────────────────────────┴────────────────────┐
│  sws-runtime (Rust binary, port 8443)                   │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │ sws-core │  │ sws-auth │  │ sws-historian (SQLite)  │ │
│  │ tag DB   │  │ RBAC+ABAC│  └────────────────────────┘ │
│  └────┬─────┘  └──────────┘  ┌────────────────────────┐ │
│       │  plugin C ABI        │ sws-audit (hash-chain)  │ │
│  ┌────┴──────────────────┐   └────────────────────────┘ │
│  │ Modbus │ OPC-UA │ MQTT │                             │ │
│  └──────────────────────┘                               │
└─────────────────────────────────────────────────────────┘
```

**Monorepo layout:**

| Directory | Language | Purpose |
|---|---|---|
| [`sws-runtime/`](sws-runtime/) | Rust | Tag engine, comm plugins, HTTPS/WSS server |
| [`sws-editor/`](sws-editor/) | TypeScript + React | WYSIWYG synoptic editor + operator view |

---

## Quickstart

Requires [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/) with Compose.

```bash
git clone https://github.com/soligolab/sws.git
cd sws

# Set a strong admin password — required, no default credentials
export SWS_ADMIN_PASSWORD=changeme

docker compose up
```

- Editor: `https://localhost:8444`
- Runtime API / metrics: `https://localhost:8443` / `http://localhost:9090`

Self-signed TLS certificates are generated automatically on first run.

---

## Development

### Runtime (Rust ≥ 1.75)

```bash
cd sws-runtime
cargo check --workspace
cargo test --workspace
cargo run -- --config /path/to/config.yaml --project /path/to/project/
```

### Editor (Node 20 + pnpm)

```bash
cd sws-editor
pnpm install
pnpm dev
```

---

## Documentation

**[📖 Manuale Utente SWS](docs/manual/MAIN.md)** — guida completa con screenshot.

| Sezione | Link |
|---------|------|
| Quick Start | [docs/manual/02_quickstart.md](docs/manual/02_quickstart.md) |
| Widget Reference | [docs/manual/05_widget_reference.md](docs/manual/05_widget_reference.md) |
| Protocolli | [docs/manual/06_protocols.md](docs/manual/06_protocols.md) |
| API Reference | [docs/manual/13_api_reference.md](docs/manual/13_api_reference.md) |
| Deployment | [docs/manual/10_deployment.md](docs/manual/10_deployment.md) |

Architectural Decision Records are in [`docs/adr/`](docs/adr/).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributors must sign off commits with
`git commit -s` (DCO). Please read our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Security

Report vulnerabilities via GitHub Security Advisories or `security@soligolab.example`.
See [SECURITY.md](SECURITY.md) for the full disclosure policy.

---

## License

[GNU Affero General Public License v3.0](LICENSE) — © Soligo Lab
