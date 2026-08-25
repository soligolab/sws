# Soligo Web SCADA (SWS)

[![CI](https://github.com/soligolab/sws/actions/workflows/ci.yml/badge.svg)](https://github.com/soligolab/sws/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Container: GHCR](https://img.shields.io/badge/Container-GHCR-green.svg)](https://github.com/soligolab/sws/pkgs/container/sws-runtime)

**SWS is an open-source, web-based SCADA platform for industrial embedded hardware.** A single
Rust binary talks to real PLCs and field devices over a vendor-neutral protocol layer, holds a
live in-memory tag database, and serves both a browser-based WYSIWYG synoptic editor and an
operator viewer — no separate engineering software, no per-seat license. The reference target is
the **Pixsys** line of industrial Rockchip HMI/edge panels (PX30, RK3399, RK3588), alongside
generic Linux and x86_64 hosts for development and evaluation.

> **Status: proof of concept.** This repository is an exploratory PoC, not yet a product. The
> long-term destination is described in [`docs/SWS_Project_Specification.md`](docs/SWS_Project_Specification.md);
> the short-term reality and working mode are in [`docs/CONTEXT.md`](docs/CONTEXT.md). Where they
> conflict, `CONTEXT.md` wins until the PoC graduates.

---

## Key features

**Editor**
- Browser-based WYSIWYG synoptic canvas, 32 widget types (gauges, trends, alarm banners, bar/pie
  charts, tables, symbols, pipes, faceplates, and more)
- Parametric faceplates (motor, valve, tank level) for reusable equipment components
- Built-in SCADA symbol gallery, drag-and-drop tag binding, live preview while editing
- Projects are plain YAML files in a folder — git-friendly, human-readable, diffable

**Protocols**
- Modbus TCP + RTU, OPC-UA client and server, MQTT with Sparkplug B, Siemens S7, EtherNet/IP
  (ControlLogix symbolic tags), Home Assistant

**Runtime**
- Live tag database with soft real-time streaming
- ISA-18.2 alarm engine (4-state, acknowledge, shelving, delay, inhibit, journal)
- SQLite-backed historian with deadband/on-change/periodic sampling and interactive trend charts
- Recipe manager (ISA-88-style setpoint sets), sandboxed Python scripting (cron/interval/
  startup/tag-change triggers), SMTP notifications, GitOps (per-project git pull/rollback)

**Operations**
- Multi-device management and remote deploy from the IDE, mDNS discovery on the LAN
- Optional authentication (RBAC + ABAC zone permissions) and optional TLS — both off by default
  in the PoC, both one click away
- Append-only audit log, installable PWA

**Two rendering engines**
- **HTML/Web** (production): SVG + Canvas 2D in a browser, the full widget catalog
- **LVGL** (proof-of-concept companion): native embedded rendering with no browser engine at all,
  for panels that can't or shouldn't run a browser

  See [HTML vs LVGL rendering engines](#html-vs-lvgl-rendering-engines) below for the trade-offs.

---

## Installation

### Prerequisites

| Tool | Minimum version | Install |
|------|-----------------|---------|
| Rust | 1.75 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 20 | [nodejs.org/download](https://nodejs.org/en/download) |
| pnpm | 9 | `npm install -g pnpm` |
| Python | 3.10+ | usually already present on Linux |
| clang + libclang | any | `sudo apt install clang libclang-dev` |
| SDL2 (dev) | 2.x | `sudo apt install libsdl2-dev` |

The last two are **not optional**: `sws-lvgl-viewer` is part of the workspace,
builds LVGL from C source through bindgen and links SDL2, so `cargo check
--workspace` needs both. It was excluded until 2026-08-25 — which meant the
crate where most defects turned up was the one crate neither CI nor `cargo
check` ever looked at.

```bash
git clone https://github.com/soligolab/sws.git
cd sws
cd sws-editor && pnpm install && cd ..   # frontend deps, first time only
```

### 1. Running the editor on a Linux server

The editor is the IDE only — no operator viewer, meant for a developer or engineering machine
that then deploys to remote runtimes:

```bash
./scripts/start_editor.sh        # IDE on http://localhost:8460 + HTTP companion on :8090
```

Run several instances side by side on the same machine with `--instance N` (e.g. `--instance 2`
→ ports 8462/8091, its own `.run-editor-2/` data directory). See
[scripts/README.md](scripts/README.md) for the full reference.

**Running it on Windows.** SWS has no native Windows app — it's web-based and Linux-first by
design (see `docs/SWS_Project_Specification.md`). If you want the editor on a Windows machine
acting as a server, the `editor` service in [`compose.yaml`](compose.yaml) is a plain Linux
container and runs fine under **Docker Desktop with the WSL2 backend**:

```powershell
$env:SWS_ADMIN_PASSWORD="changeme"
docker compose up
```

This path isn't part of the maintainer's regular workflow and hasn't been verified on real
hardware — treat it as a reasonable starting point, not a supported deployment.

### 2. Installing the runtime on remote devices

Three ways to get `sws-runtime` onto a device, in order of how the maintainer actually uses them:

**a) tar.gz / generic Linux installer** — for any x86_64 or generic ARM64 Linux host with
systemd:

```bash
./scripts/package.sh                       # → dist/sws-<version>-linux-<arch>.tar.gz
scp dist/sws-<version>-linux-<arch>.tar.gz user@<device-ip>:/tmp/

# on the device
cd /tmp && tar xzf sws-<version>-linux-<arch>.tar.gz
cd sws-<version>-linux-<arch>
sudo ./install.sh
sudo systemctl enable --now sws-runtime
```

Installs a read-only binary+assets tree at `/opt/sws/`, persistent data at `/var/lib/sws/`, and
credentials in `/etc/sws/runtime.env`. Update by repeating the same steps with a new tarball;
uninstall with `sudo ./install.sh --uninstall` (data is kept unless you also `rm -rf
/var/lib/sws /etc/sws`). Full walkthrough: [docs/manual/10_deployment.md](docs/manual/10_deployment.md).

**b) Container (podman, rootless)** — the runtime ships as a self-contained, publicly readable
image (binary + templates + SPA, no credentials needed to pull):

```bash
# on the device
./deploy/container/install-container.sh --pull   # ghcr.io/soligolab/sws-runtime:latest-<arch>
```

Detects the device architecture (`arm64` for Pixsys/Rockchip panels, `x86_64` for generic
hosts) and installs a systemd-managed podman quadlet with no `sudo` required. Data lives at
`/data/user/sws/{projects,config,logs}`. The full procedure — cross-compile, publish, install,
update — is in [docs/DEPLOY_CONTAINER_AARCH64.md](docs/DEPLOY_CONTAINER_AARCH64.md) and
[docs/DEPLOY_CONTAINER_X86_64.md](docs/DEPLOY_CONTAINER_X86_64.md). For a device that can't
reach the registry, the same install can be pushed from the IDE over SSH (*ConfigView → Runtime
→ Installa su dispositivo*), which copies the archive instead of pulling.

**c) Yocto cross-compile** — the preferred path for Pixsys hardware (PX30, RK3399, RK3588):
produces a native `aarch64` binary, no container involved.

```bash
./scripts/yocto/build.sh                 # cross-compile with the Pixsys Yocto SDK
./scripts/yocto/deploy.sh <device-ip>    # scp binary + assets, restart the systemd service
```

Full flow, SDK setup, and device layout: [docs/YOCTO_CROSSCOMPILE.md](docs/YOCTO_CROSSCOMPILE.md).

A [`compose.yaml`](compose.yaml) also exists (runtime + editor, two containers), but that path
predates no-auth mode and still requires `SWS_ADMIN_PASSWORD` — useful for a quick local
evaluation, not the current recommended flow for a real device.

### 3. Connecting the editor to a remote runtime

From the standalone editor (or from any runtime's own admin IDE): **Configurazione → Runtime →
Connetti**, enter the remote runtime's URL, username and password (e.g.
`https://192.168.1.50:8444`). This does two things at once:

- enables **Deploy** — pushing the open project to that runtime;
- opens a **live relay** of that runtime's tags and alarms over WebSocket, so you can watch real
  values while you edit. The remote credential/token stays in the local editor process — it is
  never sent to the browser.

Devices on the same LAN are also auto-discoverable via mDNS from the multi-device dashboard
(*ConfigView → Device*), no manual IP entry needed.

### 4. Certificate management

TLS is **opt-in**; SWS starts in plain HTTP by default (fine for `localhost`, which browsers
already treat as a secure context). Activate it from **Configurazione → Stato → Certificato
TLS**:

- **Genera self-signed** — creates `tls.crt`/`tls.key` (SAN: `localhost`, `127.0.0.1`, the LAN
  IP) and restarts in HTTPS.
- **Carica cert+key** — upload a CA-signed PEM certificate instead.
- **Disabilita TLS** — removes the certificate and returns to plain HTTP.

Once TLS is active, accept the self-signed certificate on first access without leaving the app:
open the plain-HTTP companion port (`:8080` for the runtime, `:8090` for the standalone editor)
— it serves a guided acceptance page. To trust the certificate elsewhere on the LAN:

```bash
curl -k https://<device-ip>:8443/cert -o sws.crt
```

### 5. Deploying a project

- **From the IDE**, connected to a remote runtime as above: the multi-device dashboard
  (*ConfigView → Device*) deploys to one or many devices at once.
- **Package builder** (*ConfigView → Runtime*, or `./scripts/package.sh` from the CLI) builds a
  distributable tarball — see [docs/manual/11_packaging_deploy.md](docs/manual/11_packaging_deploy.md).
- **GitOps** — a project folder can be a git repository; pull and roll back per project from the
  IDE — see [docs/manual/12_gitops.md](docs/manual/12_gitops.md).

### 6. Viewing remote logs and variables

Once the editor is connected to a remote runtime (§3), **ConfigView → Runtime** streams that
device's logs live over WebSocket, and **ConfigView → Variabili** (or the operator viewer itself)
shows live tag values via the same snapshot-plus-delta WebSocket protocol the runtime uses
internally.

### 7. Viewing the web page

- **Operator viewer**: `http://<device-ip>:8443` (or `https://` once TLS is enabled) — read-only,
  optimized for touchscreens, always shows the alarm banner.
- **Kiosk mode**, fullscreen auto-start on a panel: `./scripts/kiosk.sh --url
  https://localhost:8443 --fullscreen` (`sws-kiosk`, a GTK4+WebKitGTK wrapper — requires those
  libraries on the host; Pixsys devices instead run an external Chromium-on-Weston process).
- **PWA**: install the viewer straight from the browser's install prompt for an app-like,
  offline-tolerant shell.

---

## HTML vs LVGL rendering engines

SWS can render the same YAML synoptic project two different ways. Both consume the exact same
tag database over the exact same REST/WebSocket API — only the rendering path and the widget
catalog differ.

| | HTML / Web | LVGL |
|---|---|---|
| Maturity | Production-grade, the default since day one | Proof-of-concept companion engine, opt-in |
| Rendering | SVG + Canvas 2D inside a browser engine | Native LVGL widgets, no browser at all |
| Runs via | Any modern browser, or `sws-kiosk` (GTK4+WebKitGTK fullscreen wrapper) | `sws-lvgl-viewer` — SDL2 desktop simulator, Linux framebuffer, DRM/KMS, or a native Wayland client |
| Widget coverage | Full catalog — all 32 object types | 31 of 32 types today: rect, text, button, led, slider, progress_bar, checkbox, radio, ellipse, line, gauge, state_lamp, table, navbutton, trend, alarm_viewer, text_list, bar_chart, sparkline, alarm_banner, faceplate, symbol (16 built-in icons only, hand-drawn on an `lv_canvas` — see below), grid, pipe, alarm_bell, recipe_panel, setpoint, xy_plot, pie_chart (donut mode only), lang_button, lang_selector (project-content translation, `{{token}}` placeholders resolved per-language — a language switch reloads the current page) |
| Known gaps | none | no `image` rendering (no image-decode pipeline configured); `symbol` covers only the 16 hand-drawn built-ins, not the 12 vendored SVG files or custom symbols; `pie_chart` only draws a donut ring, not a filled pie; `pipe` only supports straight routing and a static (non-live) fill color; `radio` is approximated with a square checkbox (LVGL has no native radio widget); Rust↔LVGL binding is pinned to LVGL 8.x pending validation of v9/DRM parity on real hardware |
| Footprint | Needs a full browser engine — heavier RAM/CPU; excluded from the Yocto/Pixsys cross-compile sysroot (GTK4/WebKitGTK aren't available there) | Lightweight, no browser engine; scripting stays server-side so the viewer binary needs no embedded Python |
| Deployment | Always-on, the primary path | Optional systemd companion service, gated by a `--with-lvgl` build flag (default off) — never a fork of the runtime |

**When to use which**: default to HTML/Web — it's the complete, battle-tested path. Reach for
LVGL only when the target device genuinely can't host a browser engine and the synoptic only
needs the 31 widget types LVGL currently supports.

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
| [`deploy/`](deploy/) | — | Generic-Linux installer + systemd unit, container quadlets, Yocto assets |
| [`examples/`](examples/) | — | Project templates and sample synoptics |
| [`docs/`](docs/) | Markdown | Context, ADRs, and the [user manual](docs/manual/MAIN.md) |

**Rust crates** (under [`sws-runtime/crates/`](sws-runtime/crates/)):
`sws-core` (tag engine) · `sws-web` (Axum server) · `sws-auth` (RBAC/ABAC) ·
`sws-historian` (trends) · `sws-audit` (hash-chain log) · `sws-pyscript` (Python scripting) ·
`sws-kiosk` (WebKitGTK viewer) · `sws-lvgl-viewer` (embedded LVGL viewer) ·
`sws-plugin-api` + plugins `modbus`, `opcua`, `mqtt`, `s7`, `enip`, `homeassistant`.

**Protocol layer**: `sws-web` is the only crate that exposes anything externally — a dual-port
Axum router (8443/8444). The core crates (`sws-core`, `sws-historian`, `sws-pyscript`,
`sws-auth`, `sws-audit`, and every `sws-plugin-*`) have no dependency on it; they publish to and
read from a shared `TagDb` over `tokio::sync::broadcast` channels. The REST surface
(`/api/project*`, `/api/synoptics/:name`, `/api/tags*`, `/api/alarms*`, `/api/history/:tag`,
`/api/recipes/*`, `/api/script/exec`, `/api/deploy/*`, `/api/discover`, …) and the WebSocket
endpoints (`/ws/tags`, `/ws/alarms`, `/ws/logs`) are consumed identically by the browser SPA,
`sws-kiosk`, and `sws-lvgl-viewer` — the LVGL engine is a separate Rust binary that talks to
`sws-web` purely as a REST/WS client, with zero changes required in the runtime itself (see
[docs/adr/0002-lvgl-rendering-engine.md](docs/adr/0002-lvgl-rendering-engine.md)). Protocol
availability (Modbus, OPC-UA, MQTT, S7, EtherNet/IP, Home Assistant) is therefore identical
regardless of which renderer is attached — only the widget catalog differs.

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
