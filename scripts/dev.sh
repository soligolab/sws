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
# Ctrl-C kills both cleanly.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"
CONFIG_DIR="$RUN_DIR/config"
PROJECT_DIR="$RUN_DIR/project"
LOG_DIR="$RUN_DIR/logs"

mkdir -p "$CONFIG_DIR" "$PROJECT_DIR" "$LOG_DIR"

# ── Seed an example project.yaml if there is none ────────────────────────────

if [ ! -f "$PROJECT_DIR/project.yaml" ]; then
  cat > "$PROJECT_DIR/project.yaml" <<'YAML'
meta:
  name: dev
  version: "0.1.0"

# Tags are the live data points the editor binds to.
# data_type: bool | int | float | string  (default: float)
tags:
  - id: counter
    description: Test counter (write via PUT /api/tags/counter)
    data_type: float
  - id: pump.running
    description: Demo bool flag
    data_type: bool

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
YAML
  echo "seeded $PROJECT_DIR/project.yaml"
fi

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
  echo "[runtime] config  = $CONFIG_DIR"
  echo "[runtime] project = $PROJECT_DIR"
  exec "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
    --config "$CONFIG_DIR" \
    --project "$PROJECT_DIR"
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
  echo "[editor] starting Vite dev server on http://localhost:5173"
  exec $PNPM dev
}

# ── Modes ────────────────────────────────────────────────────────────────────

case "${1:-both}" in
  runtime) start_runtime ;;
  editor)  start_editor  ;;
  both)
    echo "[runtime] building (cargo build)…"
    (cd "$REPO_ROOT/sws-runtime" && cargo build --quiet -p sws-runtime)

    echo "[runtime] starting in background; logs → $LOG_DIR/runtime.log"
    "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
      --config "$CONFIG_DIR" \
      --project "$PROJECT_DIR" \
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

    cat <<MSG

────────────────────────────────────────────────────────────────────
SWS dev environment ready.

Runtime : https://localhost:8443        (self-signed cert!)
Editor  : http://localhost:5173         (after Vite finishes booting)

First time only: open https://localhost:8443/health in the browser
and accept the self-signed certificate, otherwise the WebSocket
streams (/ws/tags, /ws/alarms) will fail to connect.

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
