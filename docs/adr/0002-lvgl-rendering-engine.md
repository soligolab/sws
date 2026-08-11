# ADR 0002 — LVGL Rendering Engine as a Separate Client

**Status**: Accepted
**Date**: 2026-08-07
**Decided**: 2026-08-07
**Deciders**: Soligo Lab maintainers

## Context

New requirement: generate the SCADA UI in LVGL for embedded targets that draw directly to a
Linux framebuffer or as a Wayland client, instead of (or in addition to) the existing
browser-based web renderer. Motivation: `sws-kiosk` (the current native "viewer" binary) is a
GTK4+WebKitGTK wrapper around a full browser engine, and is excluded from the Yocto/Pixsys
cross-compile because GTK4/WebKitGTK aren't in that sysroot — on real Pixsys devices, an
external Chromium-on-Weston process is used instead, entirely outside SWS's control. LVGL
removes the need for a browser engine altogether and has first-class official Linux backends
for fbdev, DRM/KMS, Wayland, and an SDL2 desktop simulator (see `lv_port_linux`).

The maintainer's longer-term intent is a project-creation wizard that lets a project target
either "Web" or "LVGL" (with HW parameters for the latter — framebuffer/DRM vs Wayland today,
ESP32 in the future), after which the editor exposes only the widget subset supported by that
target. This ADR only covers the rendering-engine architecture; the wizard/UX work is a
separate, later phase (see `docs/plans/2026-08-07-lvgl-engine.md`).

Repo survey findings that shaped this decision:
- No prior LVGL/framebuffer/ESP32 code or docs exist anywhere in the repo — clean slate.
- The runtime's core crates (`sws-core`, `sws-historian`, `sws-pyscript`, `sws-auth`,
  `sws-audit`, the `sws-plugin-*` protocol drivers) have no dependency on `axum`/the web layer —
  they communicate over `tokio::sync::broadcast` channels and shared types. The only crate that
  wires everything together and exposes it externally is `sws-web` (dual-port Axum router).
- The backend never renders anything today. It only serves the `SynopticObject`/`SynopticPage`
  JSON schema (REST, `sws-web/src/synoptic.rs`) and tag/alarm value streams (WebSocket,
  snapshot + delta, `/ws/tags` and `/ws/alarms` in `sws-web/src/router.rs`). All widget
  interpretation lives client-side, in TypeScript (`sws-editor/src/canvas/SvgCanvas.tsx`).
- Protocol drivers already run independently of any renderer (`SourceSupervisor` inside
  `sws-web`, but with no rendering dependency) — any renderer, web or LVGL, consumes the same
  `TagDb` the same way.

## Options

### Option A — LVGL viewer as a new WS/REST client process

A new binary (`sws-lvgl-viewer`, own crate) that connects to the existing `sws-web` server
exactly like the browser or `sws-kiosk` do today: WebSocket on `/ws/tags` + `/ws/alarms`, REST
on `/api/project` + `/api/synoptics/:name`. It reimplements the widget-interpretation logic
that `SvgCanvas.tsx` does today, but targeting LVGL widgets for a deliberately smaller subset
of `SynopticObjectType`.

- Zero changes to the existing runtime/web layer required to get started.
- Reuses an already-designed, already-working sync protocol (snapshot + delta).
- Mirrors an existing, understood lifecycle pattern (`sws-kiosk`, spawned via
  `--kiosk-wayland` once `/health` responds, in
  `sws-runtime/crates/sws-runtime/src/main.rs`).
- Stays lightweight: no PyO3/libpython needed in this binary (scripting stays server-side),
  which also means a much smaller container image down the line.
- Downside: two independent implementations of "interpret a `SynopticObject`" to keep in sync
  (TS for web, Rust for LVGL) — a new axis of duplication that doesn't exist anywhere else in
  the codebase today.

### Option B — LVGL engine linked directly into a new binary, bypassing `sws-web`

A new binary links `sws-core`/`sws-historian`/`sws-pyscript`/the protocol plugin crates
directly, without going through `sws-web`'s HTTP/WS layer at all.

- Removes one network hop and the WS protocol entirely for a headless target.
- Requires extracting orchestration that today only exists inside `sws-web`
  (`SourceSupervisor`, global script supervisor, notifications) into a shared crate — a
  refactor of the existing, working runtime.
- Higher blast radius on a PoC with maintainer-reviewed "frozen" decisions and a single
  maintainer; not justified before the rendering approach itself is even proven.

## Decision

**Accepted: Option A.** `sws-lvgl-viewer` is a new, separate Rust binary crate
(`sws-runtime/crates/sws-lvgl-viewer`) that talks to the existing `sws-web` runtime as a
WS/REST client. No changes to `sws-core`/`sws-web`/the protocol plugins are needed to build the
first working version of this engine.

This can be revisited (moving toward Option B, or a hybrid) once/if a fully headless,
`sws-web`-independent deployment becomes a real requirement — tracked as a sub-question in
`docs/OPEN_QUESTIONS.md` Q14, not decided now.

Binding strategy (which Rust↔LVGL binding, which LVGL major version) and display backend
sequencing (SDL2 simulator first, then fbdev/DRM, then Wayland) are also tracked in Q14 rather
than fixed here, since they are implementation details that may need to change as real hardware
testing happens — this ADR fixes the *architecture* (separate client, existing runtime
untouched), not those lower-level choices.

## Consequences

- `sws-runtime/crates/sws-lvgl-viewer` exists as a new workspace member, excluded from the
  default `cargo check --workspace` run (like `sws-kiosk`) because it depends on a C toolchain
  (bindgen/libclang, later SDL2/DRM/Wayland dev headers) not guaranteed present in every dev
  environment. Build explicitly via `--manifest-path`.
- No modifications to `sws-web`, `sws-core`, or any protocol plugin crate are required or
  expected as part of building the LVGL engine itself — those crates' contracts (REST schema,
  WS snapshot+delta protocol) are treated as a stable interface to consume, not to change for
  this purpose.
- The widget-interpretation logic in `sws-editor/src/canvas/SvgCanvas.tsx` becomes the
  reference implementation to port from (not to import — TypeScript and Rust don't share code
  here), for the subset of `SynopticObjectType` the LVGL engine supports.
- Protocol availability is automatically identical between Web and LVGL projects — no
  protocol-side work is implied by "LVGL support" for any given source type (Modbus, OPC-UA,
  MQTT, S7, EtherNet/IP, HomeAssistant); only the *widget* catalog differs per target.
