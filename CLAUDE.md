# Claude Code Instructions

> Auto-loaded by Claude Code when this repository is opened. Keep this file short — its job is to point at the real context, not duplicate it.

## Before doing anything

1. Read `docs/CONTEXT.md` — project context, working mode, frozen architectural decisions, phase plan.
2. Read `STATUS.md` (this directory) — current state, what's working, what the next session should pick up.
3. Read `docs/OPEN_QUESTIONS.md` — deferred architectural decisions; don't try to settle them in a vibecode session.
4. Read `docs/CLAUDE_CODE_SETUP.md` if a permission prompt is confusing — that file explains the `.claude/settings.json` rules.
5. Read `docs/TEST_SETUPS.md` — where the maintainer actually runs SWS (home Ubuntu desktop, this headless dev server, office Yocto devices). Device addresses change per session — always ask before SSH-ing.
6. Read `docs/YOCTO_CROSSCOMPILE.md` if you're touching the Yocto cross-build / deploy flow (`scripts/yocto/`, `deploy/yocto/`).

Then state to the maintainer:
- What the previous session ended with
- What you plan to do in this session
- Any blockers identified

## Working mode reminders

- This is a **proof of concept**, not a product. Ship the smallest thing that works. See `docs/CONTEXT.md` §1.
- **Local dev**: `./scripts/dev.sh` from repo root starts the runtime + Vite editor with a writable `.run/` directory (cert + project.yaml seeded). Browser must accept the self-signed cert once at `https://localhost:8443/health`. Details in `scripts/README.md`.
- **Vibecode + solo maintainer + sparse sessions**. Loss of context between sessions is the #1 risk; permission friction is #2.
- **`.claude/settings.json` covers the routine commands** (cargo, pnpm, git, ls/cat/grep, mkdir, podman, etc.). Don't ask permission for them — just run them. If a command is denied and it's clearly safe and recurring, propose adding a specific allow rule (never `Bash(*)`).
- **Sessions are 3-4 hours.** Plan tasks that fit. Stop at clean points.
- **Do not push** to remote without explicit instruction. The `ask` rules deliberately gate `git push`.

## At the end of every session

1. Ensure CI would pass (`cargo check` / `pnpm build` green).
2. Update `STATUS.md` (what was done, what's next).
3. Update `CHANGELOG.md` under `[Unreleased]`.
4. Commit with a clear message and `Signed-off-by:` trailer (`git commit -s`).
5. If anything architectural came up, add it to `docs/OPEN_QUESTIONS.md` rather than deciding it.

## Long-term destination vs. short-term reality

- `docs/SWS_Project_Specification.md` describes the **long-term destination** (CRA-compliant industrial Web SCADA).
- `docs/CONTEXT.md` describes the **short-term reality** (PoC, exploratory, solo).
- **Where they conflict, `CONTEXT.md` wins until the PoC graduates to product.**
