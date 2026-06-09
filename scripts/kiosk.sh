#!/usr/bin/env bash
#
# Production kiosk launcher — starts the SWS runtime and opens the SPA in a
# native WebKitGTK window (no browser, no desktop environment required).
#
# Requirements:
#   - A Wayland compositor running and WAYLAND_DISPLAY set (weston, cage,
#     labwc, or the compositor provided by your display manager).
#   - Both sws-runtime and sws-kiosk binaries must be pre-built (see below).
#
# Build once:
#   cd sws-runtime && cargo build --release -p sws-runtime
#   cd sws-runtime && cargo build --release --manifest-path crates/sws-kiosk/Cargo.toml
#
# Usage:
#   WAYLAND_DISPLAY=wayland-0 ./scripts/kiosk.sh
#   WAYLAND_DISPLAY=wayland-0 ./scripts/kiosk.sh --windowed   # for testing
#
# Environment overrides (same as start_runtime.sh):
#   SWS_ADMIN_USER / SWS_ADMIN_PASSWORD
#   SWS_HISTORIAN_DB
#   PROJECTS_ROOT / TEMPLATES_ROOT (override paths below)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"
CONFIG_DIR="$RUN_DIR/config"
PROJECTS_ROOT="${PROJECTS_ROOT:-$RUN_DIR/projects}"
TEMPLATES_ROOT="${TEMPLATES_ROOT:-$REPO_ROOT/examples/templates}"
LOG_DIR="$RUN_DIR/logs"
BINARY_DIR="$REPO_ROOT/sws-runtime/target/release"

# Fallback to debug binaries if release not built.
if [ ! -x "$BINARY_DIR/sws-runtime" ]; then
  BINARY_DIR="$REPO_ROOT/sws-runtime/target/debug"
fi

if [ ! -x "$BINARY_DIR/sws-runtime" ] || [ ! -x "$BINARY_DIR/sws-kiosk" ]; then
  echo "[kiosk] ERROR: binaries not found in $BINARY_DIR" >&2
  echo "[kiosk] Run: cd sws-runtime && cargo build --release -p sws-runtime" >&2
  echo "[kiosk]      cd sws-runtime && cargo build --release --manifest-path crates/sws-kiosk/Cargo.toml" >&2
  exit 1
fi

: "${SWS_ADMIN_USER:=admin}"
: "${SWS_ADMIN_PASSWORD:=admin}"
export SWS_ADMIN_USER SWS_ADMIN_PASSWORD

: "${SWS_HISTORIAN_DB:=$RUN_DIR/historian.db}"
export SWS_HISTORIAN_DB

mkdir -p "$CONFIG_DIR" "$PROJECTS_ROOT" "$LOG_DIR"

# Parse optional --windowed flag (pass-through to sws-kiosk)
KIOSK_EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --windowed) KIOSK_EXTRA_ARGS+=("--windowed") ;;
    *) echo "[kiosk] unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "[kiosk] starting runtime in background; logs → $LOG_DIR/runtime.log"
"$BINARY_DIR/sws-runtime" \
  --config "$CONFIG_DIR" \
  --projects-root "$PROJECTS_ROOT" \
  --templates-root "$TEMPLATES_ROOT" \
  > "$LOG_DIR/runtime.log" 2>&1 &
RUNTIME_PID=$!

cleanup() {
  echo
  echo "[kiosk] stopping runtime (pid $RUNTIME_PID)…"
  kill "$RUNTIME_PID" 2>/dev/null || true
  wait "$RUNTIME_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[kiosk] waiting for https://localhost:8443/health…"
READY=0
for _ in $(seq 1 60); do
  if curl -sk --max-time 1 https://localhost:8443/health >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  echo "[kiosk] ERROR: runtime did not become ready in 30 s" >&2
  exit 1
fi

echo "[kiosk] runtime up (pid $RUNTIME_PID)"
echo "[kiosk] launching sws-kiosk…"
exec "$BINARY_DIR/sws-kiosk" \
  "https://localhost:8443" \
  --allow-insecure-tls \
  "${KIOSK_EXTRA_ARGS[@]+"${KIOSK_EXTRA_ARGS[@]}"}"
