# Archive — Office dev-server line (2026-05-10 → 2026-05-21)

> **Why this file exists.** The office dev-server and the home machine drifted into **two unrelated
> git histories** (no common ancestor — different root commits). On 2026-06-09 we adopted the home
> line as the official `main` (it is a content-superset of the office work). The office line's full
> 151-commit history is preserved on branch **`archive/office-line-2026-05-21`** and tag
> **`archive/office-2026-05-21`** (tip `4d93de8`). This document is the human-readable task index of
> that line, kept on the official branch so we can later confirm nothing was lost.

## How to use the archive

```bash
git checkout archive/office-line-2026-05-21          # full office history
git diff archive/office-line-2026-05-21 main -- <file>   # compare a suspect file vs official
```

## Status of office work vs the official (home) line

- **No office file is absent from home.** No pure office-only file exists.
- Office signature infra is **fully absorbed** into home: `scripts/yocto` & `sws-kiosk` byte-identical;
  `deploy/yocto` and `docs/YOCTO_CROSSCOMPILE.md` extended by home; `router.rs` +1899 lines in home
  (RBAC + new endpoints); `/data/user/sws` install path present in more home files.
- Remaining office-only *lines* sit in files the home line **also rewrote heavily** — divergent
  implementations, not obviously-missing features. Compare these **semantically** (not by line-diff)
  in a later pass: `sws-editor/src/config/ConfigView.tsx`, `sws-runtime/crates/sws-core/src/alarm.rs`,
  `sws-editor/src/runtime-view/RuntimeView.tsx`, `sws-editor/src/canvas/SvgCanvas.tsx`,
  `sws-editor/src/components/WelcomeScreen.tsx`, `App.tsx`, `EditorShell.tsx`, `types/index.ts`.
- **Re-evaluation action (later session):** for each suspect file, diff `archive/office-line-2026-05-21`
  vs `main`, confirm the office behavior exists in the home implementation, and re-implement only
  genuine gaps. Given the superset relationship, expected gaps are minimal.

## Recovered office task list (feat/fix, newest → oldest)

- **05-21** feat(rbac) Operator/Viewer restricted to runtime-only (UI + API) — *absorbed in home*
- **05-21** feat(yocto) install path → `/data/user/sws`, deploy verified on PX30 — *absorbed*
- **05-20/21** feat(yocto) end-to-end cross build for sws-runtime + scaffold + docs — *absorbed (scripts/yocto identical)*
- **05-19/20** feat/fix(kiosk) sws-kiosk WebKitGTK crate + `--kiosk-wayland`, window-size & GTK/glib fixes — *absorbed (sws-kiosk identical)*
- **05-19** fix(auth) WelcomeScreen on startup, GET /api/project pre-auth, logout closes project
- **05-19** feat(templates) refresh standards, +2 templates (opcua/grid), remove default project
- **05-19** feat(BL-005) OPC-UA client plugin — phase 4 (browse, writes, security policies, Euromap, reverse browse)
- **05-19** feat(6.4) bidirectional `/ws/tags` — operator writes over socket
- **05-19** feat(7.2) automatic project backups + restore (admin)
- **05-19** feat aspect-ratio resize + Prometheus counters + script test panel; single-page YAML export/import; `/metrics` endpoint + system-status unit tests
- **05-19** feat(S-27) UX bundle — tree drag&drop, context menu, canvas rulers
- **05-18** feat(ARCH-004) multi-runtime WelcomeScreen (CORS + dynamic baseUrl)
- **05-18** feat(ARCH-003) kiosk-mode browser spawn (`--kiosk-browser`)
- **05-18** feat(S-23) grid object — drag-resize/merge/split, sub-cell recursion, breadcrumb chips
- **05-18** feat(ARCH-001/002, S-22) single-binary deploy + UX bundle; cross-view nav + categorized palette + system-status tab
- **05-17** feat undo/redo history panel, object groups, lock, zoom/pan, nudge, z-order, line handles, resize handles, multi-select batch props, 6 editor improvements
- **05-16** feat project mgmt (delete/rename/dup), design-reference overlay, quality dot, symbol library v2, MQTT browse UI+endpoint, "Casa Locale" template, grid session 2 (child/cut-paste), page dims + grid layout, alarm webhook notifications, re-auth modal, script preemption; fix Rustls 0.23 CryptoProvider conflict
- **05-15** feat log file v2 (JSONL browser), historian v2 (decimation + SQLite fallback + prune) + selection rect, Multi-Project IDE Phase A1/A2, animation/interpolation, header dropdown menus
- **05-14** feat BindableInput (cross-cutting transform + universal binding model, full coverage), symbol rotation/flip, log panel structured fields + persistence (JSONL daily), image widget + custom symbols w/ license tracking
- **05-13** feat project import/export (ZIP), runtime log panel + MQTT echo, BL-001 multi-user store + admin CRUD, BL-002 MQTT auth/TLS/LWT/QoS, BL-003 CodeMirror Python editor, reusable Python functions, symbol library, 4-role RBAC + auth polish, editor UX (undo/redo/clipboard/align), historian SQLite + trend
- **05-12** feat source hot-reload supervisor, script sandbox (timeout/stdout/RestrictedPython), rich text object, auth skeleton (Argon2id/session/Bearer), z-index/visibility/Python handlers, LAN dev server + Vite WS proxy, historian ring-buffer + trend, tag/alarm hot-reload + Allarmi tab, alarm engine stub, Modbus write path (TagWriteBus), tag autocomplete/data_type/MQTT subscriber
- **05-11** feat object palette (gauge/slider/checkbox/radio/LED/progress/table), tag + Modbus TCP CRUD, canvas grid + project tree + runtime nav, synoptic persistence + tag write + button + quality indicator, working IDE, Modbus TCP polling driver, YAML loader → TagDb, TagDb↔REST/WS wiring

Office session handoffs **S-16 … S-37** are recorded in the archived `STATUS.md` / `CHANGELOG.md`
(visible via `git show archive/office-line-2026-05-21:STATUS.md`).
