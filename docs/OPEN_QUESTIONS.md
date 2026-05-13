# SWS — Open Architectural Questions

> Decisions that came up during development but are **not for Claude Code to settle in a vibecode session**. The maintainer reviews and decides these out-of-band.
>
> When Claude Code encounters one of these, it should: pick the documented PoC default, add a `// TODO(open-question):` comment in code referencing the question number here, and continue.

---

## Q1 — Python embedding strategy

**Context**: User scripts in projects must be sandboxed and executed by the runtime. `sws-pyscript` is the responsible crate.

**Options**:
- **A** — Embed CPython in the Rust binary via `pyo3`, run scripts in-process with RestrictedPython. Smaller footprint, shared memory with the runtime, but a script crash could affect the runtime.
- **B** — Run a separate Python worker process, communicate via gRPC or stdin/stdout. Stronger isolation, larger footprint, more moving parts.

**Default for PoC**: A (PyO3 + RestrictedPython).

**Decided**: A (PyO3 + RestrictedPython) is now fully live. `sws-pyscript::Engine`:
- runs scripts on `tokio::task::spawn_blocking` wrapped in `tokio::time::timeout`
  (5 s default, override via `SWS_SCRIPT_TIMEOUT_MS`);
- compiles user source through `RestrictedPython.compile_restricted` when the
  package is importable in the Python environment used by PyO3 — falls back to
  plain `compile` with a startup warning if `pip install RestrictedPython` was
  never run, so dev boxes don't break;
- redirects `sys.stdout` / `sys.stderr` per-call into `io.StringIO`, captures
  the strings, and returns them in `ExecOutput { stdout, stderr, sandboxed }`;
- `/api/script/exec` echoes these back; the editor logs them to the browser
  console (`[script stdout]` / `[script stderr]`).
- `Engine::execute_with_args(code, args)` injects per-call argument bindings
  into the Python globals (bool/int/float/str). Used by the new project-level
  function feature: `POST /api/script/run/:name` looks up a `FunctionDef`
  by name in `AppState.functions` and runs its `code` with the caller's
  argument overrides. Synoptic objects' `on_press_fn` / `on_release_fn`
  reference these functions instead of carrying inline code.

Still pending (Phase 2 polish):
- Pre-flight AST whitelist for the unsandboxed mode so it's at least
  "no imports, no exec/eval" even without RestrictedPython.
- Surfacing script output back into the editor UI (a panel, not just the
  console).
- Real preemption: tokio's timeout drops the future but the Python thread
  keeps running until it yields. PyO3's `Python::check_signals` + a signal
  thread would let us interrupt mid-execution.
- `into_py` deprecation in PyO3 0.23 — migrate to `IntoPyObject` before 0.24.

---

## Q2 — Sparkplug B implementation

**Context**: No mature Rust Sparkplug B library exists. `sws-plugin-mqtt` will need encoding support.

**Options**:
- **A** — Contribute to `sparkplug-rs` upstream (community win, slower, depends on maintainer responsiveness).
- **B** — Fork or write our own, vendor it.
- **C** — Implement Sparkplug encoding manually using `prost` (Protobuf) on top of `rumqttc`. Sparkplug is just Protobuf-over-MQTT with conventions.

**Default for PoC**: pick C (manual Protobuf) for the simplest happy-path demo. Revisit if/when Sparkplug becomes a serious product feature.

**Decided**: not yet. No code touches this area until Phase 3.

---

## Q3 — Plugin ABI strategy

**Context**: Communication and storage plugins are loaded as `.so` files. Rust ABI is unstable across compiler versions.

**Options**:
- **A** — Manual stable C ABI: `extern "C"`, `#[repr(C)]`, vtable structs. Maximum portability, more boilerplate.
- **B** — Use `abi_stable` crate. Less boilerplate, but adds a dependency and locks plugins to the same `abi_stable` version.

**Default for PoC**: pick A (manual C ABI). `sws-plugin-api` bootstrap already sketches the C ABI surface (`SwsPluginManifest`, `TagValue`, `PluginKind`, `TagQuality`). Revisit if surface grows enough that boilerplate becomes painful.

**Decided**: not yet. Bootstrap shape committed; loader/linker still to write.

---

## Q4 — Frontend state management

**Context**: WebEditor needs shared state across components (current project, selected object, tag list, WSS connection state). Tracked also in `docs/adr/0001-state-management.md`.

**Options**: Zustand (small, ergonomic), Redux Toolkit (mature, heavy), Jotai (atomic, modern).

**Default for PoC**: Zustand. Simple, idiomatic with React, easy to swap if needed. Bootstrap installed it and `src/store/index.ts` uses it.

**Decided**: not yet. Revisit before Milestone 1 freeze (when multi-user CRDT editing is on the table).

---

## Q5 — i18n scaffolding

**Context**: Final product wants multi-language support. PoC is English-only. The bootstrap already set up `i18next` + `react-i18next` because the design rounds asked for it.

**Status update**: contrary to the original "defer i18n to later" plan, i18n is **already wired** at bootstrap with English-only resources. This is fine — it costs little and avoids a retrofit later. The compromise: only English locale exists, no translation pipeline.

**Default for PoC**: keep current setup, English only. Add other languages only on demand.

**Decided**: implicitly accepted at bootstrap.

---

## Q6 — Symbol library packaging

**Context**: System symbol library (pumps, valves, motors) shipped with the runtime.

**Options**:
- **A** — Embedded in the runtime binary.
- **B** — Separate `sws-symbols/` folder shipped with the container, hot-reloadable.
- **C** — Separate repo, versioned independently.

**Default for PoC**: B (separate folder in container). Easy to update without rebuilding the binary.

**Decided**: not yet. No symbol library content exists yet; this becomes real in Phase 2-3.

---

## Q7 — LICENSE file content

**Context**: Bootstrap attempted to write the full AGPL-3.0 text to `LICENSE` but Anthropic's content filter blocked the output.

**Options**:
- **A** — Manually paste the full text from `https://www.gnu.org/licenses/agpl-3.0.txt`.
- **B** — Short LICENSE file with SPDX identifier + link, plus full text accessible from CI artifacts (some projects do this, though it's unusual for AGPL).
- **C** — Use a `LICENSE` symlink to `LICENSES/AGPL-3.0-only.txt` and put the actual text under the SPDX-recommended directory structure.

**Decided**: A. The maintainer added the full AGPL-3.0 text (661 lines, standard preamble + terms + tail) at `LICENSE` out of band; verified 2026-05-12.

---

## Adding new questions

When Claude Code adds a new question, follow the format above:
1. **Context** — why this came up.
2. **Options** — at least 2, briefly described.
3. **Default for PoC** — what we're doing for now.
4. **Decided** — left as `not yet` until the maintainer fills it in.
