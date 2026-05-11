# Claude Code — Setup for SWS

> How to configure Claude Code to minimize permission prompts during the SWS vibecode sessions, without giving up safety.
>
> **TL;DR**: for this project, run Claude Code in **`acceptEdits` mode** with the project-scoped `.claude/settings.json` already in the repo. Optionally use a **Podman devcontainer** with `--dangerously-skip-permissions` for the most autonomous flow when you want zero friction.

---

## Why this matters for SWS

The SWS project is being built in vibecode mode with short evening sessions (3-4 hour blocks, sparse cadence). Every permission prompt that interrupts the flow is a cognitive tax — multiply by hundreds of prompts and you lose a meaningful fraction of each session.

Claude Code's defaults are conservative because they need to work for *every* project. SWS has well-defined boundaries (one repo, known toolchain) so we can safely widen the auto-approved surface a lot.

---

## The three modes (pick one per session)

### Mode A — `acceptEdits` (default for this project)

**What it does**: auto-approves all file edits within the repo and all bash commands matching the `allow` list in `.claude/settings.json`. Prompts only on commands in the `ask` list (push, publish, hard reset) or commands not matching any rule.

**When to use**: 95% of sessions. Good balance between speed and safety. The maintainer still reviews every Git commit before it lands.

**How to activate**:
- Already configured as `defaultMode` in `.claude/settings.json` — Claude Code starts in this mode automatically when opening the repo.
- Manual override: `Shift+Tab` during a session, or start with `claude --permission-mode acceptEdits`.

**Daily friction**: low. You'll see prompts occasionally for new commands. When that happens, **add them to `.claude/settings.json` `allow` list right then** so they don't ask again. The settings file is meant to grow over time.

### Mode B — `auto` mode (Claude Code v2.1.111+)

**What it does**: classifier auto-approves read-only operations and file edits, sends ambiguous bash commands through a safety check that aligns the action with your intent. Falls back to prompting after consecutive blocks.

**When to use**: when even `acceptEdits` is too chatty for you and you want Claude Code to make more judgment calls. Good for exploratory sessions where you don't know exactly what commands will run.

**How to activate**: `Shift+Tab` cycles through modes, or `claude --permission-mode auto`.

**Daily friction**: lowest among "safe" modes. Trade-off: you have less precise control over what gets approved.

### Mode C — Devcontainer with `--dangerously-skip-permissions`

**What it does**: Claude Code skips every permission check. Inside a Podman container with no host filesystem access, no SSH keys mounted, no credentials, this is safe — the container itself is the safety boundary.

**When to use**:
- When you want **zero prompts** for a focused refactor or feature spike.
- When the work is well-defined and you trust Claude Code to drive autonomously for the duration.
- Multi-hour solo sessions where interruptions break flow.

**Setup**: see [§ Devcontainer setup](#devcontainer-setup) below.

**Daily friction**: zero, but you must trust the container boundary. Don't mount your `~/.ssh`, `~/.gitconfig` with credentials, or any other host secret into it.

---

## Project settings.json explained

The committed `.claude/settings.json` covers the SWS tech stack:

| Category | Allow pattern | Why |
|---|---|---|
| Rust build | `cargo *`, including `cd sws-runtime && cargo *` | Workspace-wide builds, tests, lint, audit |
| Node build | `pnpm *`, `~/.local/bin/pnpm *`, `npm *`, `node *` | Editor dev/build/test/typecheck |
| Git read-only | `git status*`, `git log*`, `git diff*`, `git show*`, `git branch*` | Frequent introspection, no mutation |
| Git mutation (safe) | `git add*`, `git commit -s*`, `git restore*`, `git stash*`, `git switch*`, `git checkout*`, `git fetch*`, `git pull*`, `git rebase*`, `git tag*` | Daily local-only Git ops |
| Filesystem read | `ls*`, `cat*`, `head*`, `tail*`, `grep*`, `rg*`, `find*`, `wc*`, etc. | All standard introspection |
| Filesystem write (limited) | `mkdir -p*`, `touch*`, `cp*`, `mv*` | Scaffold and reorganize files |
| Containers | `podman build*`, `podman run*`, `podman compose*`, `docker compose*` | Build and run SWS containers locally |
| HTTP smoke tests | `curl -fk*`, `curl -fsk*`, `curl -fI*` | Hit `/health` and similar local endpoints |
| Project scripts | `./scripts/*` | Any helper script you add under `scripts/` |
| Repo file ops | `Read(./**)`, `Edit(./**)`, `Write(./**)` | Full access to repo contents |
| Doc lookups | `WebFetch(domain:docs.rs)`, `crates.io`, `vitejs.dev`, `react.dev`, `tokio.rs`, `mqtt.org`, OPC Foundation, Eclipse, etc. | API docs Claude Code will reference |

### What still prompts (the `ask` list)

These require explicit confirmation because they have external or destructive impact:

- `git push*` — pushes to remote
- `git reset --hard*`, `git clean *`, `git rebase -i*` — destructive local ops
- `cargo publish*`, `pnpm publish*`, `npm publish*` — publishes to registries
- `podman push*`, `docker push*` — push container images

### What is blocked outright (the `deny` list)

Hard denies that override allow rules even by accident:

- `Read(./.env*)`, `Read(./**/*.pem)`, `Read(./**/*.key)`, `Read(./**/*.crt)`, anything under `secrets/` or `credentials.*` — CRA-aligned: keys and certs are never read into Claude Code's context
- `rm -rf /*`, `rm -rf ~*`, `sudo *` — catastrophic shell ops
- `curl * | sh*`, `wget * | sh*` — pipe-to-shell anti-pattern
- `ssh *`, `scp *`, `rsync *` — no remote shell or transfer from inside Claude Code; if you need remote work, do it manually

---

## How to grow the settings over time

The `allow` list is **expected to grow**. The intended workflow:

1. Claude Code asks for permission on some new command (say, `cargo install cargo-cyclonedx`).
2. You decide: is this safe and recurring?
3. If yes: open `.claude/settings.json`, add `"Bash(cargo install *)"` to `allow`, save.
4. Claude Code reloads settings; future runs auto-approve.

After a few weeks the file will reflect the actual rhythm of the project — far better than guessing upfront.

**Anti-pattern to avoid**: blanket `"Bash(*)"`. That's effectively `bypassPermissions` without the container safety net. The whole point of `allow` rules is **specificity**.

---

## Personal vs project settings

| File | Scope | Committed to Git? | Use for |
|---|---|---|---|
| `.claude/settings.json` | This repo, shared with future contributors | **Yes** | Patterns that any SWS contributor benefits from |
| `.claude/settings.local.json` | This repo, only you | **No** (auto-gitignored by Claude Code) | Your personal experiments, paths specific to your machine |
| `~/.claude/settings.json` | All your projects | N/A | Cross-project habits (e.g. `git status` everywhere) |

**Rule of thumb**: if a permission is useful for *any* contributor working on SWS, put it in the committed `.claude/settings.json`. If it's personal (an absolute path on your laptop, a personal tool), use `.claude/settings.local.json`.

---

## Devcontainer setup

For Mode C — zero-friction autonomous sessions inside an isolated container.

### Goals

- Claude Code runs inside Podman, sees only the repo.
- No host SSH keys, no `~/.gitconfig` credentials, no host `$HOME` exposure.
- Claude Code runs with `--dangerously-skip-permissions` safely because the **container is the boundary**.
- Network is restricted to the domains the project actually needs (crates.io, npm, docs sites).
- You can push commits to GitHub only from the host, not from inside the container.

### Suggested layout

```
sws/
├── .devcontainer/
│   ├── Containerfile             # the Claude Code dev image
│   ├── compose.yaml              # podman-compose with the dev container
│   └── README.md                 # how to enter the container
└── .claude/
    └── settings.json             # used when Claude Code runs on the host
```

### `.devcontainer/Containerfile` (sketch)

```dockerfile
FROM debian:bookworm-slim

# Toolchain for both stacks
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl git ca-certificates pkg-config \
    libssl-dev libpython3.11 python3 \
    && rm -rf /var/lib/apt/lists/*

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain 1.75 --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Node + pnpm
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && npm install -g pnpm@9

# Claude Code (installed via npm, see official install docs)
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /workspace
```

### `.devcontainer/compose.yaml` (sketch)

```yaml
services:
  sws-dev:
    build:
      context: .
      dockerfile: Containerfile
    volumes:
      # Mount only the repo, not your $HOME
      - ../:/workspace:Z
    working_dir: /workspace
    # Network policy: outbound only to allowed domains (configured at firewall/proxy
    # level, or rely on Claude Code's WebFetch allow list)
    tty: true
    stdin_open: true
    environment:
      # Pass through your Claude Code token, not your SSH keys or git credentials
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
```

### Workflow inside the container

```bash
# From the host
podman-compose -f .devcontainer/compose.yaml run --rm sws-dev bash

# Inside the container
cd /workspace
claude --dangerously-skip-permissions
```

Claude Code now operates autonomously. When you exit and want to push commits, do `git push` from the **host**, where your SSH keys live.

### Trade-offs of the devcontainer

| Pro | Con |
|---|---|
| Zero prompts, max autonomy | Slower file IO compared to host (especially on macOS) |
| Tight blast radius | Initial setup time |
| Reproducible environment | Bind-mount permissions on SELinux systems need `:Z` (handled in compose above) |
| Network can be locked down | You can't `git push` from inside (by design) |
| No accidental access to host secrets | Some IDE integrations don't work inside containers |

For SWS specifically, the container approach **shines for big refactors and protocol implementation phases** (week-long pushes on OPC-UA or MQTT), and is **overkill for small evening sessions** where `acceptEdits` is enough.

---

## Recommended posture by session type

| Session type | Mode | Why |
|---|---|---|
| Quick fix, 30-60 min | `acceptEdits` on host | Fast start, you already know what you'll touch |
| Normal feature work, 2-4 h | `acceptEdits` on host | Default, balanced |
| Big refactor, 4+ h | `auto` mode or devcontainer | Less interruption |
| Protocol implementation (OPC-UA, MQTT) | Devcontainer with `--dangerously-skip-permissions` | Lots of trial-and-error, isolated network is fine |
| Anything touching CRA-sensitive code (audit log, auth) | `acceptEdits` on host, review each change | Higher attention warranted |
| Release prep, signing, publishing | `default` mode (more prompts) | You want to see every step |

---

## When something blocks you

If Claude Code keeps prompting for a command you trust:

1. Note the exact command pattern.
2. Open `.claude/settings.json`.
3. Add the most **specific** allow rule that covers it (avoid `Bash(*)` at all costs).
4. Save. Next time it auto-approves.

If a rule is too broad and you want it narrower without losing it:

1. Move it from `allow` to `ask` to keep being prompted.
2. Refine the pattern over time.

If something keeps getting denied that you need:

1. Check the `deny` list — deny rules win over allow.
2. If it's a credential file pattern, ask yourself why Claude Code needs to read it. Usually the answer is "it doesn't" and the deny rule is correct.

---

*End of Claude Code setup notes.*
