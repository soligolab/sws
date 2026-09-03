# Claude Code Instructions

> Auto-loaded when this repo is opened. Process and pointers only — never duplicated context.
> The maintainer writes in Italian; reply in Italian.

## Hard rules

1. **Never `git push`** without an explicit instruction in the current session. Confirming that a feature works is *not* approval to push.
2. **Never commit directly to `main`**, except meta commits (`STATUS.md`, `CHANGELOG.md`, `CLAUDE.md`, `docs/**`) and the squash merges described below.
3. **Never resolve an item in `docs/OPEN_QUESTIONS.md`** — add to it instead.
4. **Never ask permission for commands allowed in `.claude/settings.json`** (cargo, pnpm, git, ls/cat/grep, mkdir, podman…). Just run them. If a safe, recurring command is denied, propose a specific allow rule — never `Bash(*)`.
5. **Never SSH into a test device without asking** — addresses change every session.
6. **`docs/CONTEXT.md` beats `docs/SWS_Project_Specification.md`** wherever they conflict, until the PoC graduates to a product. The spec is the long-term destination; CONTEXT.md is the short-term reality.

## Regole UI dell'editor (decise dal maintainer, 2026-08-23)

1. **WYSIWYG obbligatorio.** Il ramo edit-mode di ogni oggetto sinottico DEVE usare lo stesso
   rendering del runtime — pattern: contenuto reale + `pointerEvents:"none"` + hit-rect
   trasparente per selezione/drag (come gauge/symbol/faceplate/grid). I placeholder che
   divergono per contenuto o dimensioni sono bug, non scorciatoie. Dati live veri quando
   disponibili; widget con storico: una fetch al mount, niente polling in edit. Gli effetti
   runtime (blink, motion, flusso pipe, bordo allarme, stale) si previsualizzano col toggle
   "Anteprima effetti" della toolbar, spento di default.
2. **Una sezione per dato.** Mai due punti del pannello proprietà che scrivono lo stesso
   campo; se esistono variante semplice e avanzata, sopravvive solo quella completa. Il campo
   `tag` generico compare solo sui tipi che lo usano come dato primario; per gli altri vive
   nella sezione qualità come "Tag di stato (allarme/stale/qualità)".

## Session start

**First, run `./scripts/session_start.sh`.** It compares this machine with
origin, offers the right remedy for each common case (diverged `main`, tags left
on the pre-rewrite history, missing `node_modules`), and ends by printing where
the last session stopped. It never pushes, never deletes a branch, and never
resets over local commits that carry content origin doesn't have.

Then read, in order:

1. `docs/CONTEXT.md` — context, working mode, frozen architectural decisions, phase plan, task roadmap (T-xx).
2. `STATUS.md` — where the last session stopped, what's working, what to pick up.
3. `docs/OPEN_QUESTIONS.md` — deferred decisions, off-limits in a vibecode session.

Then state, in three short lines: what the last session ended with, what you plan to do now, any blockers. **Wait for the go-ahead before writing code.**

Read these only when the trigger applies:

| Trigger | File |
|---|---|
| Touching `scripts/yocto/` or `deploy/yocto/` | `docs/YOCTO_CROSSCOMPILE.md` |
| Deploying to or testing on a device | `docs/TEST_SETUPS.md` |
| A permission prompt looks wrong | `docs/CLAUDE_CODE_SETUP.md` |
| Maintainer asks "come faccio a…?" | `docs/HOWTO.md` — answer from it, and add a new numbered chapter if the answer isn't there yet |
| Running the local stack | `scripts/README.md` |

## Working mode

- **Proof of concept, not a product.** Ship the smallest thing that works — see `docs/CONTEXT.md` §1.
- **Solo maintainer, sparse sessions of 3-4h.** Lost context between sessions is risk #1, permission friction is #2. Plan work that fits one session and stop at clean points.
- **Local stack:**
  - `./scripts/start_runtime.sh` — device runtime: viewer 8443 + IDE/admin 8444 + HTTP companion 8080, auto-opens project `default`.
  - `./scripts/start_editor.sh` — dev-PC IDE: 8460 + HTTP companion 8090, no viewer. Deploy via ConfigView → Runtime → "Connetti" with the remote runtime URL.
  - First access: open `http://localhost:8080` (runtime) or `:8090` (editor) to accept the self-signed cert without leaving the app.

## Definition of done

`cargo check` green **and** `pnpm build` green **and** the maintainer has confirmed the feature works. All three, before anything reaches `main`.

## Git workflow per task

Every roadmap task (T-01…T-20 and beyond):

1. **Branch** from `main`: `git checkout main && git checkout -b feat/T-01-pid-symbols`
2. **Develop** — all intermediate commits stay on the branch.
3. **Verify** — meet the definition of done above.
4. **Squash merge**, only after the maintainer confirms it works:
   ```
   git checkout main
   git merge --squash feat/T-01-pid-symbols
   git commit -s -m "feat(T-01): ..."
   ```
5. **Don't delete the branch** — cleanup is the maintainer's call.
6. **Push only when told to**, and name the branch you're about to push before doing it.

All commits use `-s` (`Signed-off-by:` trailer).

## Plans

Planning-mode plans live in `~/.claude/plans/`, which is per-machine and doesn't travel with git. The maintainer works from two machines (office server, home PC): on 2026-07-30 an analysis written at home never made it to the office, while the code did. So if a plan covers work that continues in another session or on another machine, copy it to `docs/plans/<date>-<slug>.md` and commit it. Throwaways stay in the home dir.

## Session end — and whenever context is running low

Do this *before* you run out of room, not after:

1. `cargo check` / `pnpm build` green.
2. Update `STATUS.md` — what was done, what's next, anything left half-finished.
3. Update `CHANGELOG.md` under `[Unreleased]`.
4. Commit with `-s` and a clear message.
5. Anything architectural that surfaced → append to `docs/OPEN_QUESTIONS.md` rather than deciding it.