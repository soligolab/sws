# Soligo Web SCADA (SWS) — Project Specification

**Document version:** 1.0 (initial draft)
**Date:** May 2026
**Owner:** Mauro Soligo (Soligo Lab)
**Status:** Draft for team review
**Audience:** Internal development team, contributors, stakeholders

---

## 1. Executive Summary

Soligo Web SCADA (SWS) is an open-source, web-based SCADA platform designed from the ground up to run on embedded industrial hardware inside an OCI container, with a strong focus on EU Cyber Resilience Act (CRA) compliance, plugin extensibility, and a modern WYSIWYG web editor.

### What SWS is not

SWS is not a vertical solution targeting a specific industrial sector, nor a heavyweight server-class SCADA requiring Windows-only IDEs. It is intentionally lightweight, vendor-neutral, and Linux-first.

### What SWS is

A general-purpose Web SCADA composed of:
- A **runtime** (single Rust binary, containerized) that loads user projects, talks to PLCs/devices via pluggable communication drivers, exposes a real-time web view, and stores history.
- A **WebEditor** (browser-based WYSIWYG application) that lets engineers design synoptics, configure tags, alarms, recipes, and users — with live preview and multi-user editing.
- A **plugin system** for communication protocols (OPC-UA client/server, Modbus TCP/RTU, MQTT, S7, EtherNet/IP) and storage backends (SQLite, InfluxDB, PostgreSQL).
- A **Git-friendly project format** (open folder of YAML files + assets + Python scripts) editable both from the WebEditor and from a future VSCode plugin.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Run smoothly on embedded ARM hardware (Rockchip PX30, RK3399 as reference targets) within a Podman/Docker container.
- Be CRA-ready: secure-by-default, SBOM, vulnerability scanning, signed audit trail, principle of least privilege.
- Support 1,000–5,000 tags per instance with soft real-time latency (≤ 100 ms tag update).
- Provide a complete WYSIWYG editor experience comparable to commercial SCADAs (animations, faceplates, scripting, live preview, multi-user editing).
- Be vendor-neutral and protocol-agnostic via a stable plugin API.
- Be auditable and Git-friendly: project files are human-readable YAML, diff-able, mergeable.
- Be a credible open-source alternative (AGPL-3.0) for industrial automation in the EU market.

### 2.2 Non-Goals (for v1.x)

- Hard real-time control (SWS is supervisory, not a PLC replacement).
- Out-of-the-box certification (OPC Foundation, IEC 62443) — these are roadmap items beyond 1.0.
- Native Windows desktop app (web-only by design).
- Cluster / high-availability runtime (single-instance focus first).

---

## 3. Architecture Overview

### 3.1 Component split

SWS is split across two repositories and two container images orchestrated together:

| Component | Repository | Container | Language |
|---|---|---|---|
| Runtime | `soligolab/sws-runtime` | `sws-runtime` | Rust |
| WebEditor | `soligolab/sws-editor` | `sws-editor` | TypeScript + React |

The two containers run side-by-side via `podman-compose` (or `docker-compose`). The runtime exposes the live SCADA view to operator browsers; the editor exposes the design-time WYSIWYG to engineers. Both share the same project folder (bind-mounted from the host by default).

### 3.2 Runtime architecture (high level)

```
┌─────────────────────────────────────────────────────────┐
│                    sws-runtime (Rust)                   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Comm Plugins │  │  Tag Engine  │  │ Web Frontend │   │
│  │ (OPC-UA,     │◄─►│ (in-memory  │◄─►│  (HTTPS/WSS)│   │
│  │  Modbus,     │  │  central     │  │   served by  │   │
│  │  MQTT, S7…)  │  │  tag DB)     │  │   axum)      │   │
│  └──────────────┘  └──────┬───────┘  └──────────────┘   │
│                           │                             │
│  ┌──────────────┐  ┌──────▼───────┐  ┌──────────────┐   │
│  │ Python       │  │ Historian    │  │ Audit Log    │   │
│  │ Sandbox      │  │ Plugin       │  │ (signed,     │   │
│  │(RestrictedPy)│  │ (SQLite/     │  │  hash-chain) │   │
│  │              │  │  Influx/PG)  │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Communication model

- **Internal data model**: a single centralized **tag database** in memory. All comm plugins read/write tags. All graphic objects subscribe to tags. Tag updates flow over WebSocket Secure (WSS) to connected browsers.
- **External communication**: also exposed natively over MQTT (with optional Sparkplug B encoding) for integration with broader IT/OT stacks.

### 3.4 Plugin architecture

Plugins (communication drivers, storage backends, authentication providers) are loaded as **dynamic shared libraries** (`.so` on Linux). To avoid Rust ABI instability, the plugin interface is defined through a **stable C ABI** (using `#[repr(C)]` and `extern "C"` boundaries), or via the `abi_stable` crate. WebAssembly-based plugins are kept as a roadmap option for untrusted/third-party extensions.

---

## 4. Technology Stack

### 4.1 Runtime (sws-runtime)

| Concern | Choice | Rationale |
|---|---|---|
| Language | **Rust (stable)** | Memory safety (CRA), small static binaries, low footprint, mature async ecosystem |
| Async runtime | **Tokio** | Industry standard, required by chosen libraries |
| HTTP / WebSocket server | **Axum** + **Tower** | Modern, well-maintained, integrates with Tokio |
| OPC-UA client/server | **`async-opcua`** (FreeOpcUa, MPL-2.0) | Pure-Rust, actively maintained, both client and server |
| Modbus TCP/RTU | **`tokio-modbus`** (slowtec, MIT/Apache-2.0) | Pure-Rust, async, client and server, TCP and RTU |
| MQTT client | **`rumqttc`** (Bytebeam, Apache-2.0) | Pure-Rust, MQTT 3.1.1 and 5.0, TLS |
| MQTT broker (optional) | **`rumqttd`** (Bytebeam, Apache-2.0) | Embeddable as a library inside the runtime |
| Sparkplug B | Built on top of `rumqttc`/`rumqttd` | May require contributing to `sparkplug-rs` or forking |
| Python sandbox | **RestrictedPython** via embedded CPython (PyO3) | User-supplied scripts isolated with capability whitelist |
| TLS | **`rustls`** | Pure-Rust, no OpenSSL FFI, CRA-friendly |
| Logging | **`tracing`** + JSON formatter | Structured logging for observability |
| Metrics | **Prometheus exposition** via `metrics` crate | Standard for container orchestration |
| Storage (historian) | Plugin-based: **SQLite** (default), **InfluxDB**, **PostgreSQL** | Configurable per project |

### 4.2 WebEditor (sws-editor)

| Concern | Choice | Rationale |
|---|---|---|
| Language / framework | **TypeScript + React** | Team familiarity, largest ecosystem, mature WYSIWYG component libraries |
| Build tooling | **Vite** | Fast dev experience, modern bundling |
| Graphic rendering | **SVG** (interactive symbols) + **Canvas 2D** (trends, heatmaps) | Best balance of interactivity and performance on embedded targets |
| State management | TBD (likely **Zustand** or **Redux Toolkit**) | Decided in design phase |
| Real-time link to runtime | **WSS** (WebSocket Secure) for tag streaming, REST for project I/O | Aligns with runtime |

### 4.3 Container & deployment

- **Base image**: `debian:bookworm-slim` (compatibility, ~80 MB; balances CRA attack surface and ease of debugging)
- **Architectures**: `linux/arm64` and `linux/amd64` (multi-arch manifest)
- **Orchestration**: `podman-compose` (also Docker Compose compatible) for runtime + editor + optional broker/DB
- **Persistence**: project folder bind-mounted from host by default; volume-based mode also supported

---

## 5. CRA Compliance Strategy

The Cyber Resilience Act (Regulation EU 2024/2847, full applicability December 2027) imposes essential cybersecurity requirements on products with digital elements. SWS is designed to meet them by default.

### 5.1 Secure-by-default

- **HTTPS/WSS only**: HTTP plain is never exposed. A self-signed certificate is auto-generated on first start; users may upload a custom certificate (Let's Encrypt support is on the roadmap).
- **No default credentials**: first-run wizard forces creation of an admin user with strong password (Argon2id hash).
- **Principle of least privilege**: container runs as non-root user; capabilities dropped; read-only root filesystem where possible.

### 5.2 Authentication & authorization

- **Local user store** (default): users defined in project YAML with Argon2id hashed passwords. Pluggable backend allows OAuth2/OIDC and LDAP in v1.x roadmap.
- **RBAC + ABAC**: roles (Viewer, Operator, Supervisor, Admin) plus area/zone-based attribute permissions, aligned with ISA-101 zones.
- **Session management**: configurable session timeout, max concurrent sessions per project, per-user.

### 5.3 Audit trail

- **Tamper-evident audit log**: append-only log of security-relevant events (login, logout, tag writes, project modifications, alarm acknowledgments, configuration changes), with hash-chain (each record includes hash of the previous record) and HMAC signature using a project-local key.
- Compatible with FDA 21 CFR Part 11 audit trail requirements.
- Exportable to file, syslog, or remote endpoint via a dedicated plugin.

### 5.4 Software supply chain

- **CycloneDX SBOM** generated automatically by CI on every build (both Rust crates and npm packages).
- **Vulnerability scanning** as a CI gate: `cargo-audit` (Rust), `npm audit` (frontend), `trivy` (container image). Builds with high-severity vulnerabilities fail.
- **Container signing** with `cosign` planned for v1.1.
- **Pinned dependencies**: `Cargo.lock` and `package-lock.json` always committed; renovate/dependabot keep them current with reviewed PRs.

### 5.5 Vulnerability disclosure

- A `SECURITY.md` policy documents how to report vulnerabilities (private email + GitHub Security Advisories).
- A public **security advisories feed** (RSS + mailing list) notifies users of patched vulnerabilities and required updates.
- 90-day coordinated disclosure target.

### 5.6 Updates

- Manual container update as v1.0 default (operators pull a new image and restart). Image signature verification documented in operator manual.
- Automatic update with rollback is on the roadmap (v1.x).

### 5.7 User script sandboxing

- Python scripts authored by project users are executed via **RestrictedPython** with a strict capability whitelist (no `import` of arbitrary modules, no filesystem access beyond a per-script sandbox folder, no network access except via approved tag/MQTT APIs).
- CPU and memory limits per script execution.

---

## 6. Project Format (User Projects)

A SWS project is a regular folder, designed to live in Git.

```
my_project/
├── project.yaml           # project metadata, settings, sessions limits
├── tags/
│   └── tags.yaml          # tag definitions (name, type, scaling, history config)
├── users.yaml             # users, roles, hashed passwords
├── permissions.yaml       # RBAC + ABAC zones
├── synoptics/
│   ├── overview.yaml      # one synoptic page = one YAML file
│   ├── boiler.yaml
│   └── lines.yaml
├── alarms/
│   └── alarms.yaml        # alarm definitions, priorities, areas
├── scripts/
│   ├── on_startup.py      # Python scripts (sandboxed)
│   └── transformations.py
├── symbols/               # user symbol library (SVG + binding metadata)
│   └── ...
├── recipes/               # recipe sets
│   └── ...
└── assets/                # images, fonts, custom resources
    └── ...
```

- **Format**: YAML (human-readable, Git-diff-friendly).
- **System symbol library**: shipped with the runtime, available to all projects (pumps, valves, motors, faceplates).
- **User symbol library**: per-project, defined in `symbols/`, overrides system symbols by name.
- **Hot reload**: when project files change (via WebEditor save or filesystem touch), the runtime reloads graphics and bindings without container restart. Python scripts are reloaded but with a brief reinitialization.
- **Multi-project**: a single runtime instance hosts multiple projects (one per top-level subfolder of the bind-mounted root).

---

## 7. Graphic Object Catalog

The WebEditor and runtime ship with a graphic object library, prioritized by industrial relevance and implementation order. See **Annex A** for the full prioritized list (six tiers, from primitives to optional advanced widgets).

In summary:
- **Tier 1** — Primitives, dynamic numeric/text displays, buttons, status LEDs, the tag binding engine itself.
- **Tier 2** — Alarm banner & list, numeric input, bargraphs, tank-level indicators, mode selectors, communication status indicators.
- **Tier 3** — P&ID symbol library (pumps, valves, motors), animated piping, faceplates, analog gauges, real-time trend.
- **Tier 4** — Historical trend, alarm history, data tables, event log.
- **Tier 5** — Header/footer, navigation, login, sliders, checkboxes/radios.
- **Tier 6** — Recipes, report viewer, KPI dashboards, geographic maps, IP camera viewer, dynamic QR codes, optional 3D/isometric viewer.

Symbols are implemented as **parametric, reusable components** (analogous to UDTs in Ignition or Faceplates in WinCC Unified) — single biggest architectural investment for long-term scalability.

---

## 8. Roadmap & Milestones

### 8.1 Version scheme

**Calendar versioning**: `YYYY.MM[.patch]`. First public release target: `2026.08` (3 months from project kickoff).

### 8.2 Milestones

#### M1 — Foundations (kickoff + 1 month)
- Two repositories created; CI/CD on GitHub Actions + GitLab mirror set up.
- Project skeleton: workspace, Cargo, Vite, Dockerfiles, multi-arch build.
- Tag engine MVP (in-memory, Tokio-based, WSS streaming).
- HTTPS/WSS with auto-generated certificate.
- Static authentication (admin user + password) + minimal RBAC.
- WebEditor "hello world": loads project, lists tags, displays one synoptic with primitives.

#### M2 — First protocol & MVP runtime (kickoff + 2 months)
- Modbus TCP plugin (read/write coils, registers).
- Tag historian on SQLite (deadband + on-change + periodic).
- Alarm engine (definition + active list + acknowledgment).
- WebEditor: drag-and-drop primitives, tag binding, save/load, hot reload.
- Audit log v1 (file-based, hash-chained but not yet HMAC-signed).
- SBOM generation in CI.

#### M3 — First public release (kickoff + 3 months) — **`2026.08`**
- All M1 + M2 features hardened.
- Documentation site (Docusaurus) live with getting-started, operator guide, project format reference.
- Public AGPL-3.0 release, DCO required on PRs.
- Reference deployment on PX30 + RK3399 documented and benchmarked.
- Vulnerability disclosure policy and security advisory feed online.

#### M4 — OPC-UA + MQTT (release `2026.11`)
- OPC-UA client plugin (`async-opcua`).
- OPC-UA server plugin (expose internal tags as OPC-UA address space).
- MQTT client plugin + embedded `rumqttd` broker option.
- Sparkplug B support (encoding/decoding on top of MQTT).
- WebEditor: faceplate system, system symbol library (pumps, valves, motors).

#### M5 — Editor "complete" + advanced security (release `2027.02`)
- WebEditor: animations, visual scripting blocks, multi-user editing with CRDT-based conflict resolution, undo/redo, layer management.
- HMAC-signed audit log (FDA 21 CFR Part 11 compatible).
- ABAC zone-based permissions.
- VSCode plugin (community-supported, formal release).

#### M6 — More protocols + ecosystem (release `2027.05`)
- Modbus RTU plugin.
- S7 (Siemens) plugin.
- EtherNet/IP plugin.
- InfluxDB and PostgreSQL historian plugins.
- Recipe manager and report viewer.

#### M7+ — Ongoing
- WebAssembly plugin runtime (untrusted plugins).
- Cosign container signing + automatic update with rollback.
- OAuth2/OIDC and LDAP authentication plugins.
- Marketplace/registry for community symbols and plugins.

---

## 9. Governance & Contribution

- **License**: AGPL-3.0 for the initial public release. The author reserves the right to relicense in the future.
- **Contributor agreement**: DCO (Developer Certificate of Origin) — every commit must carry a `Signed-off-by:` trailer. This is the lightweight protection that preserves future relicensing options if all contributors sign off.
- **Branching**: trunk-based development. `main` is always releasable; feature branches are short-lived and merged via PR with required CI checks.
- **Commit style**: free-form, but each PR must update the `CHANGELOG.md` under the `[Unreleased]` section. CalVer versions are tagged from `main`.
- **Code review**: every PR requires at least one approving review from a maintainer.
- **CI/CD**: primary CI on GitHub Actions; mirrored to GitLab CI for internal pipelines (Pixsys / Soligo Lab).

---

## 10. Open Questions / Decisions Pending

1. State management library for the WebEditor (Zustand vs Redux Toolkit vs Jotai).
2. Exact Python embedding strategy: embedded CPython via PyO3 vs out-of-process Python worker via gRPC. Trade-off: footprint vs isolation strength.
3. Sparkplug B implementation: contribute to existing `sparkplug-rs` crate or implement from scratch.
4. Symbol library distribution model: in-repo vs separate `sws-symbols` repo + versioning.
5. Internationalization: full i18n scaffolding from day one (recommended) or English-only for v1.0 with i18n added in v1.x.

---

## Annex A — Graphic Object Catalog (Prioritized)

### Priority 1 — Foundations
- **Graphic primitives**: rectangles, ellipses, lines, polylines, text, SVG/PNG images, with dynamic properties (color, visibility, position, rotation) bindable to tags.
- **Numeric / alphanumeric display**: formatted tag value rendering (decimals, units, prefix/suffix), with data-quality awareness (good/stale/error).
- **Dynamic label**: text driven by a tag or condition, multi-language ready.
- **Button**: momentary, latching, pulse; optional confirmation; permission-aware.
- **Status LED**: boolean or multi-state indicator with color/blink animation.
- **Tag and binding engine** (architectural, not a visual): glue between graphics and datasource.

### Priority 2 — Operational essentials
- **Alarm banner and active alarm list** (ISA-18.2 compliant).
- **Numeric input field** with min/max validation and write confirmation.
- **Horizontal/vertical bargraph** with scale and threshold colors.
- **Tank/level indicator**.
- **Combo box / selector** for predefined values.
- **Auto/Manual switch** for control loops.
- **Communication status indicator** (PLC link state, tag quality).

### Priority 3 — Process visualization
- **P&ID symbol library**: pumps, valves (on/off and modulating), motors, fans, heat exchangers, tanks — as parametric reusable components.
- **Animated piping** with flow color/animation by state.
- **Faceplate / popup** for motor, valve, PID loop, drive.
- **Analog gauge** (dial or arc).
- **Real-time trend** with multiple pens, auto-scale, pause.

### Priority 4 — History and diagnostics
- **Historical trend** with zoom, pan, cursors, CSV export.
- **Alarm history** with filters by time and area.
- **Data table / datagrid**.
- **Event log** with audit-trail integration.

### Priority 5 — Navigation and UX
- **System header/footer** (user, time, shift, prio alarm, comm state).
- **Navigation menu** (tabs, sidebar, breadcrumb), touch-sized.
- **Login/logout** with session timeout.
- **Slider** for continuous setpoints.
- **Checkbox / radio button**.

### Priority 6 — Advanced / optional
- **Recipe manager**.
- **Report viewer** (PDF/HTML, on-demand or scheduled).
- **KPI dashboard** (heatmaps, OEE cards).
- **Geographic map** (distributed SCADA).
- **IP camera viewer** (RTSP/WebRTC).
- **Dynamic QR code** (manuals, deep-links).
- **3D / isometric viewer** (evaluate cost on embedded).

---

## Annex B — Reference Hardware & Performance Targets

| Parameter | Target |
|---|---|
| Reference SoC (development) | Rockchip PX30 (Cortex-A35, 4 cores, 1.5 GHz), Rockchip RK3399 (2× A72 + 4× A53) |
| Architecture | `arm64` (with `amd64` for desktop dev) |
| Container memory budget | ≤ 512 MB at idle, ≤ 1 GB under load with 2,000 tags |
| Tag count | 1,000–5,000 per instance |
| Tag update latency (PLC → browser) | ≤ 100 ms (soft real-time) |
| Concurrent browser sessions | Configurable, default 10 |
| Cold start time (runtime container) | ≤ 5 s |
| Hot reload time (project save → live) | ≤ 1 s for graphics, ≤ 3 s with script reload |

---

*End of specification.*
