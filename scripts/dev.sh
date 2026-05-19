#!/usr/bin/env bash
#
# Local dev launcher for SWS — starts the Rust runtime and the Vite editor
# pointing them at a writable directory under .run/ in the repo root.
#
# Defaults: runtime on https://localhost:8443, editor dev server on
# http://localhost:5173. The editor proxies /api → 8443 and /ws → 8443
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
#   VITE_RUNTIME_URL=https://px30.local:8443 ./scripts/dev.sh editor
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

# Historian SQLite persistence path. Set to empty to disable (RAM only).
: "${SWS_HISTORIAN_DB:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.run/historian.db}"
export SWS_HISTORIAN_DB

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
  (cd "$REPO_ROOT/sws-runtime" && cargo build --quiet -p sws-runtime)
  echo "[runtime] starting on https://localhost:8443"
  echo "[runtime] config         = $CONFIG_DIR"
  echo "[runtime] projects_root  = $PROJECTS_ROOT"
  echo "[runtime] templates_root = $TEMPLATES_ROOT"
  echo "[runtime] auto-open      = (none — WelcomeScreen picks the project)"
  exec "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
    --config "$CONFIG_DIR" \
    --projects-root "$PROJECTS_ROOT" \
    --templates-root "$TEMPLATES_ROOT"
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
  runtime) start_runtime ;;
  editor)  start_editor  ;;
  kiosk)
    echo "[kiosk] building runtime + sws-kiosk…"
    (cd "$REPO_ROOT/sws-runtime" && cargo build --quiet -p sws-runtime -p sws-kiosk)

    echo "[kiosk] starting runtime in background; logs → $LOG_DIR/runtime.log"
    "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
      --config "$CONFIG_DIR" \
      --projects-root "$PROJECTS_ROOT" \
      --templates-root "$TEMPLATES_ROOT" \
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
    exec "$REPO_ROOT/sws-runtime/target/debug/sws-kiosk" \
      "https://localhost:8443" --allow-insecure-tls --windowed
    ;;
  both)
    echo "[runtime] building (cargo build)…"
    (cd "$REPO_ROOT/sws-runtime" && cargo build --quiet -p sws-runtime)

    echo "[runtime] starting in background; logs → $LOG_DIR/runtime.log"
    "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
      --config "$CONFIG_DIR" \
      --projects-root "$PROJECTS_ROOT" \
      --templates-root "$TEMPLATES_ROOT" \
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

    # Wait for /health to answer (self-signed → -k).
    echo "[runtime] waiting for https://localhost:8443/health…"
    for _ in $(seq 1 30); do
      if curl -sk --max-time 1 https://localhost:8443/health >/dev/null 2>&1; then
        echo "[runtime] up (pid $RUNTIME_PID)"
        break
      fi
      sleep 0.5
    done

    # Best-effort LAN IP for the info banner — first non-loopback v4.
    LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -z "$LAN_IP" ] && LAN_IP="<your-host-ip>"

    cat <<MSG

────────────────────────────────────────────────────────────────────
SWS dev environment ready.

Runtime (HTTPS) : https://localhost:8443     (loopback only)
Editor  (local) : http://localhost:5173
Editor  (LAN)   : http://$LAN_IP:5173        ← open this from your phone/tablet

The editor's Vite dev server proxies /api and /ws/* to the runtime,
so the remote browser never talks to port 8443 directly — no need
to accept the self-signed certificate from the remote device.

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
