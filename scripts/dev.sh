#!/usr/bin/env bash
#
# Local dev launcher for SWS — starts the Rust runtime and the Vite editor
# pointing them at a writable directory under .run/ in the repo root.
#
# Defaults: runtime on https://localhost:8443, editor dev server on
# http://localhost:5173. The editor proxies /api → 8444 and /ws → 8444
# (see sws-editor/vite.config.ts).
#
# First-run gotcha: the runtime serves with a self-signed cert. Before
# the WebSocket streams work you must accept the cert once by visiting
# https://localhost:8443/health in the browser and clicking through the
# warning. Otherwise /ws/tags and /ws/alarms will fail to connect.
#
# Usage:
#   ./scripts/dev.sh          # build runtime + start both, follow logs
#   ./scripts/dev.sh runtime  # only the runtime
#   ./scripts/dev.sh editor   # only the editor
#
# Remote runtime (editor only):
#   VITE_RUNTIME_URL=https://px30.local:8444 ./scripts/dev.sh editor
#     → the Vite proxy + the SPA fetch/WS calls all target the remote
#       runtime instead of localhost:8443. Useful for editing a project
#       hosted on a device from a developer laptop.
#
# Ctrl-C kills both cleanly.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"
CONFIG_DIR="$RUN_DIR/config"
# Multi-project layout: projects live as subfolders of PROJECTS_ROOT, and the
# runtime can open/close them at runtime via /api/projects/*. There is no
# longer a hard-coded default "dev" project — on first run the WelcomeScreen
# lists the bundled templates so the user picks one.
PROJECTS_ROOT="$RUN_DIR/projects"
TEMPLATES_ROOT="$REPO_ROOT/examples/templates"
LOG_DIR="$RUN_DIR/logs"

# pyo3-build-config defaults to /usr/bin/python which isn't present on Debian
# Bookworm (only /usr/bin/python3). Point it at python3 explicitly so cargo
# build/check work out of the box.
if [ -z "${PYO3_PYTHON:-}" ] && command -v python3 >/dev/null 2>&1; then
  export PYO3_PYTHON=python3
fi

# Admin credentials for the runtime. Override via environment if you have
# something stronger; the default is fine for local dev only.
: "${SWS_ADMIN_USER:=admin}"
: "${SWS_ADMIN_PASSWORD:=admin}"
export SWS_ADMIN_USER SWS_ADMIN_PASSWORD

# Optional accounts for the other RBAC roles. Set non-empty to enable.
: "${SWS_SUPERVISOR_PASSWORD:=supervisor}"
: "${SWS_OPERATOR_PASSWORD:=operator}"
: "${SWS_VIEWER_PASSWORD:=viewer}"
export SWS_SUPERVISOR_PASSWORD SWS_OPERATOR_PASSWORD SWS_VIEWER_PASSWORD

# Historian SQLite global path — disabled. Each project now uses its own
# .history/historian.db via the per-project DatastoreConfig in project.yaml.
# Uncomment the two lines below only if you need a temporary shared historian.
# : "${SWS_HISTORIAN_DB:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.run/historian.db}"
# export SWS_HISTORIAN_DB

mkdir -p "$CONFIG_DIR" "$PROJECTS_ROOT" "$LOG_DIR"

# No default project on first run. The WelcomeScreen will list any subfolder
# of $PROJECTS_ROOT as a candidate project (so user-created projects survive
# across runs) and expose the bundled templates from $TEMPLATES_ROOT.
#
# A "Default" YAML used to be seeded here so dev.sh produced a working demo
# on a fresh clone; that's intentionally gone since 2026-05 (operator must
# create the project from a template). The heredoc is kept commented below
# only as documentation of the legacy fallback shape.

: <<'LEGACY_FALLBACK_YAML'

# Tags are the live data points the editor binds to.
# data_type: bool | int | float | string  (default: float)
tags:
  - id: counter
    description: Test counter (write via PUT /api/tags/counter)
    data_type: float
  - id: pump.running
    description: Demo bool flag
    data_type: bool
  - id: sine
    description: Demo sine wave (drive with scripts/demo-sine.py)
    data_type: float
  - id: cosine
    description: Demo cosine — for multi-tag trend (demo-driver.py)
    data_type: float
  - id: triangle
    description: Demo triangle (demo-driver.py)
    data_type: float
  - id: ramp
    description: Demo sawtooth ramp (demo-driver.py)
    data_type: float
  - id: noise
    description: Demo uniform noise (demo-driver.py)
    data_type: float

# No sources for dev. Write values manually with curl:
#   curl -k -X PUT https://localhost:8443/api/tags/counter \
#     -H 'Content-Type: application/json' -d '{"value": 42.5}'
sources: []

# Alarms watch tags. Once a tag's value satisfies the condition,
# the AlarmBanner in the editor highlights it.
alarms:
  - id: counter_high
    tag: counter
    condition: { kind: above, threshold: 50 }
    message: Counter sopra soglia (>50)
    severity: Warning
LEGACY_FALLBACK_YAML

# ── Cleanup of stale processes ───────────────────────────────────────────────
# Kill any sws-runtime or vite processes from a previous run of this repo.
# Uses REPO_ROOT-scoped patterns so we don't clobber unrelated processes.

stop_existing() {
  local killed=0

  # Kill any other dev.sh instances from this repo first so they don't
  # race with us or restart child processes we're about to kill.
  if pkill -TERM -f "$REPO_ROOT/scripts/dev.sh" 2>/dev/null; then
    sleep 0.5
    pkill -KILL -f "$REPO_ROOT/scripts/dev.sh" 2>/dev/null || true
    killed=1
  fi

  # Kill any lingering cargo build for this repo — it holds a file lock
  # that would cause the next build to block silently.
  if pkill -KILL -f "cargo build.*-p sws-runtime" 2>/dev/null; then
    echo "[cleanup] terminated lingering cargo build"
    killed=1
  fi

  # Kill debug and release runtime binaries.
  for variant in debug release; do
    if pgrep -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" >/dev/null 2>&1; then
      echo "[cleanup] stopping existing sws-runtime ($variant)…"
      pkill -TERM -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" 2>/dev/null || true
      local i
      for i in $(seq 1 6); do
        pgrep -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" >/dev/null 2>&1 || break
        sleep 0.5
      done
      pkill -KILL -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" 2>/dev/null || true
      killed=1
    fi
  done

  if pgrep -f "$REPO_ROOT/sws-editor.*vite" >/dev/null 2>&1; then
    echo "[cleanup] stopping existing vite dev server…"
    pkill -TERM -f "$REPO_ROOT/sws-editor.*vite" 2>/dev/null || true
    sleep 1
    pkill -KILL -f "$REPO_ROOT/sws-editor.*vite" 2>/dev/null || true
    killed=1
  fi

  # esbuild is a child of vite but sometimes lingers after vite is killed.
  if pgrep -f "$REPO_ROOT/sws-editor.*esbuild" >/dev/null 2>&1; then
    pkill -KILL -f "$REPO_ROOT/sws-editor.*esbuild" 2>/dev/null || true
    killed=1
  fi

  if [ "$killed" -eq 1 ]; then sleep 0.3; fi

  # Force-free the ports regardless of how the old process was started
  # (different terminal, different path, etc.). This is the safety net:
  # if pkill missed a process that holds 8443/8444, fuser will catch it.
  fuser -k 8443/tcp 8444/tcp 2>/dev/null || true
  sleep 0.3
}

# ── pnpm detection ───────────────────────────────────────────────────────────
# The maintainer's machine has pnpm only via corepack's shim; on a CI box it
# might be on PATH. Try the obvious candidates in order.

pick_pnpm() {
  if command -v pnpm >/dev/null 2>&1;       then echo pnpm; return; fi
  if command -v corepack >/dev/null 2>&1;   then echo "corepack pnpm"; return; fi
  local shim
  shim="$(ls -d "$HOME"/.nvm/versions/node/*/lib/node_modules/corepack/shims/pnpm 2>/dev/null | head -n1 || true)"
  if [ -n "$shim" ] && [ -x "$shim" ]; then echo "$shim"; return; fi
  echo ""
}

# ── Pieces ───────────────────────────────────────────────────────────────────

start_runtime() {
  echo "[runtime] building (cargo build)…"
  (cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime)

  WWW_DIST="$REPO_ROOT/sws-editor/dist"
  WWW_ARGS=()
  if [ -f "$WWW_DIST/index.html" ]; then
    WWW_ARGS=(--www "$WWW_DIST")
    echo "[runtime] serving SPA from $WWW_DIST"
  else
    echo "[runtime] WARNING: $WWW_DIST not found — ports 8443/8444 are API-only"
    echo "[runtime]   run 'cd sws-editor && pnpm build' to build the SPA"
  fi

  echo "[runtime] starting — synoptic https://localhost:8443  admin https://localhost:8444"
  echo "[runtime] config         = $CONFIG_DIR"
  echo "[runtime] projects_root  = $PROJECTS_ROOT"
  echo "[runtime] templates_root = $TEMPLATES_ROOT"
  exec "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
    --config "$CONFIG_DIR" \
    --projects-root "$PROJECTS_ROOT" \
    --templates-root "$TEMPLATES_ROOT" \
    "${WWW_ARGS[@]}"
}

start_editor() {
  local PNPM
  PNPM="$(pick_pnpm)"
  if [ -z "$PNPM" ]; then
    echo "[editor] ERROR: no pnpm found. Install via 'corepack enable' or pnpm CLI." >&2
    exit 1
  fi
  cd "$REPO_ROOT/sws-editor"
  if [ ! -d node_modules ]; then
    echo "[editor] installing deps with $PNPM install…"
    $PNPM install
  fi
  echo "[editor] starting Vite dev server on http://0.0.0.0:5173 (LAN-accessible)"
  # --host 0.0.0.0 binds to all interfaces so a phone/tablet on the same Wi-Fi
  # can hit http://<this-host>:5173. Vite proxies /api and /ws/* to the local
  # runtime, so remote browsers never need to accept the self-signed cert.
  exec $PNPM dev --host 0.0.0.0
}

# ── Modes ────────────────────────────────────────────────────────────────────

case "${1:-both}" in
  runtime)
    stop_existing
    start_runtime
    ;;
  editor)
    stop_existing
    start_editor
    ;;
  kiosk)
    stop_existing
    echo "[kiosk] building runtime + sws-kiosk…"
    (cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime)
    (cd "$REPO_ROOT/sws-runtime" && cargo build --manifest-path crates/sws-kiosk/Cargo.toml)

    # Serve the SPA from the pre-built dist/ if it exists; otherwise the kiosk
    # will get a 404 on / and show a white window. Run 'pnpm build' first if needed.
    WWW_DIST="$REPO_ROOT/sws-editor/dist"
    WWW_ARGS=()
    if [ -f "$WWW_DIST/index.html" ]; then
      WWW_ARGS=(--www "$WWW_DIST")
      echo "[kiosk] serving SPA from $WWW_DIST"
    else
      echo "[kiosk] WARNING: $WWW_DIST not found — run 'cd sws-editor && pnpm build' first or the kiosk will show a blank page" >&2
    fi

    echo "[kiosk] starting runtime in background; logs → $LOG_DIR/runtime.log"
    "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
      --config "$CONFIG_DIR" \
      --projects-root "$PROJECTS_ROOT" \
      --templates-root "$TEMPLATES_ROOT" \
      "${WWW_ARGS[@]}" \
      > "$LOG_DIR/runtime.log" 2>&1 &
    RUNTIME_PID=$!

    cleanup_kiosk() {
      if kill -0 "$RUNTIME_PID" 2>/dev/null; then
        echo "[runtime] stopping (pid $RUNTIME_PID)…"
        kill "$RUNTIME_PID" 2>/dev/null || true
        wait "$RUNTIME_PID" 2>/dev/null || true
      fi
    }
    trap cleanup_kiosk EXIT INT TERM

    echo "[kiosk] waiting for https://localhost:8443/health…"
    for _ in $(seq 1 30); do
      if curl -sk --max-time 1 https://localhost:8443/health >/dev/null 2>&1; then
        echo "[kiosk] runtime up (pid $RUNTIME_PID)"
        break
      fi
      sleep 0.5
    done

    echo "[kiosk] launching sws-kiosk (windowed for local test; remove --windowed for fullscreen)"
    # Strip every SNAP_* variable before exec: when Claude Code runs as a snap, these
    # propagate into WebKit's WebKitNetworkProcess which then loads libpthread from
    # /snap/core20/current/lib — incompatible with system glibc → white window.
    STRIP_SNAP=()
    while IFS= read -r v; do STRIP_SNAP+=("-u" "$v"); done \
      < <(printenv | grep -o '^SNAP[^=]*')
    exec env "${STRIP_SNAP[@]}" \
      "$REPO_ROOT/sws-runtime/crates/sws-kiosk/target/debug/sws-kiosk" \
      "https://localhost:8443" --allow-insecure-tls --windowed
    ;;
  both)
    stop_existing
    echo "[runtime] building (cargo build)…"
    (cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime)

    # Serve the pre-built SPA on both ports (8443 + 8444) when dist/ exists.
    # Without --www, the runtime returns 404 on GET / (API-only mode).
    WWW_DIST="$REPO_ROOT/sws-editor/dist"
    WWW_ARGS=()
    if [ -f "$WWW_DIST/index.html" ]; then
      WWW_ARGS=(--www "$WWW_DIST")
      echo "[runtime] serving SPA from $WWW_DIST (https://localhost:8443 + https://localhost:8444)"
    else
      echo "[runtime] WARNING: $WWW_DIST not found — ports 8443/8444 are API-only"
      echo "[runtime]   run 'cd sws-editor && pnpm build' to build the SPA"
    fi

    echo "[runtime] starting in background; logs → $LOG_DIR/runtime.log"
    "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
      --config "$CONFIG_DIR" \
      --projects-root "$PROJECTS_ROOT" \
      --templates-root "$TEMPLATES_ROOT" \
      "${WWW_ARGS[@]}" \
      > "$LOG_DIR/runtime.log" 2>&1 &
    RUNTIME_PID=$!

    # Kill the runtime on any exit (Ctrl-C in vite, vite crash, anything).
    cleanup() {
      if kill -0 "$RUNTIME_PID" 2>/dev/null; then
        echo
        echo "[runtime] stopping (pid $RUNTIME_PID)…"
        kill "$RUNTIME_PID" 2>/dev/null || true
        wait "$RUNTIME_PID" 2>/dev/null || true
      fi
    }
    trap cleanup EXIT INT TERM

    # Wait for both listeners to answer. 8443 typically binds first;
    # 8444 follows within milliseconds. If 8444 never answers after 8443 is
    # up it means the runtime exited (e.g. port already in use) — warn loudly.
    echo "[runtime] waiting for https://localhost:8443/health…"
    for _ in $(seq 1 30); do
      if curl -sk --max-time 1 https://localhost:8443/health >/dev/null 2>&1; then
        echo "[runtime] 8443 up (pid $RUNTIME_PID)"
        break
      fi
      sleep 0.5
    done

    echo "[runtime] waiting for https://localhost:8444/health…"
    admin_ok=0
    for _ in $(seq 1 10); do
      if curl -sk --max-time 1 https://localhost:8444/health >/dev/null 2>&1; then
        echo "[runtime] 8444 up"
        admin_ok=1
        break
      fi
      sleep 0.3
    done
    if [ "$admin_ok" -eq 0 ]; then
      echo "[runtime] WARNING: 8444 did not respond — admin/IDE port may be unavailable." >&2
      echo "[runtime]   Check $LOG_DIR/runtime.log for bind errors." >&2
    fi

    # Best-effort LAN IP for the info banner — first non-loopback v4.
    LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -z "$LAN_IP" ] && LAN_IP="<your-host-ip>"

    cat <<MSG

────────────────────────────────────────────────────────────────────
SWS dev environment ready.

Runtime viewer  : https://localhost:8443       ← operatori/kiosk (anonimo)
Admin IDE       : https://localhost:8444       ← editor canvas + ConfigView
Vite dev server : http://localhost:5173/index-admin.html  ← IDE con hot-reload
Vite (LAN)      : http://$LAN_IP:5173/index-admin.html   ← da altri dispositivi

TLS certificato self-signed generato ad ogni avvio con SAN:
  - localhost, 127.0.0.1, $LAN_IP
  Scarica il cert per importarlo nel browser (una volta sola):
    curl -k https://localhost:8443/cert -o sws.crt
    curl -k https://$LAN_IP:8443/cert -o sws.crt   ← da un altro dispositivo
  Firefox : about:preferences#privacy → Visualizza certificati → Importa
  Chrome  : Impostazioni → Sicurezza → Gestisci certificati → Importa
  File    : $CONFIG_DIR/tls.crt

Quick test write:
  curl -k -X PUT https://localhost:8443/api/tags/counter \\
    -H 'Content-Type: application/json' -d '{"value": 42.5}'

Logs:   tail -f $LOG_DIR/runtime.log
Stop:   Ctrl-C (kills both)
────────────────────────────────────────────────────────────────────

MSG

    start_editor
    ;;
  *)
    echo "usage: $0 [both|runtime|editor]" >&2
    exit 2
    ;;
esac
