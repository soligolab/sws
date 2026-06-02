#!/usr/bin/env bash
#
# Local dev launcher for SWS — starts the Rust runtime and the Vite editor
# pointing them at a writable directory under .run/ in the repo root.
#
# Defaults: runtime on https://localhost:8443 (viewer) + https://localhost:8444
# (admin), Vite editor dev server on http://localhost:5173 (proxy → 8444).
#
# Usage:
#   ./scripts/dev.sh                   # instance 1 (default): ports 8443/8444, Vite 5173
#   ./scripts/dev.sh --instance 2      # instance 2: ports 8445/8446, Vite 5174, .run-2/
#   ./scripts/dev.sh runtime           # only the runtime (any mode)
#   ./scripts/dev.sh editor            # only the Vite editor
#
# Multi-instance test (simulating two separate devices):
#   Terminal 1:  ./scripts/dev.sh
#   Terminal 2:  ./scripts/dev.sh --instance 2 runtime
#
#   Instance 2 starts the runtime only (no Vite), simulating a remote device.
#   From the IDE on instance 1, connect to https://<LAN-IP>:8446 for deploy.
#
# Remote runtime (editor only):
#   VITE_RUNTIME_URL=https://px30.local:8444 ./scripts/dev.sh editor
#
# Ctrl-C kills both cleanly.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse --instance N before the mode argument ──────────────────────────────
INSTANCE=1
args_remaining=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance)
      INSTANCE="$2"
      shift 2
      ;;
    *)
      args_remaining+=("$1")
      shift
      ;;
  esac
done
# Restore remaining args as positional
set -- "${args_remaining[@]+"${args_remaining[@]}"}"

# ── Derive per-instance ports and data directories ───────────────────────────
# Instance 1: viewer=8443, admin=8444, vite=5173, data=.run/
# Instance N: viewer=8443+(N-1)*2, admin=8444+(N-1)*2, vite=5173+(N-1), data=.run-N/
VIEWER_PORT=$((8443 + (INSTANCE - 1) * 2))
ADMIN_PORT=$((8444 + (INSTANCE - 1) * 2))
VITE_PORT=$((5173 + (INSTANCE - 1)))

if [ "$INSTANCE" -eq 1 ]; then
  RUN_DIR="$REPO_ROOT/.run"
else
  RUN_DIR="$REPO_ROOT/.run-$INSTANCE"
fi

CONFIG_DIR="$RUN_DIR/config"
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

mkdir -p "$CONFIG_DIR" "$PROJECTS_ROOT" "$LOG_DIR"

: <<'LEGACY_FALLBACK_YAML'
tags:
  - id: counter
    description: Test counter (write via PUT /api/tags/counter)
    data_type: float
LEGACY_FALLBACK_YAML

# ── Cleanup of stale processes ───────────────────────────────────────────────
# Kill only the processes holding THIS instance's ports. Other instances
# on different ports are left untouched.

stop_existing() {
  local killed=0

  # Kill any lingering cargo build for this repo — it holds a file lock
  # that would cause the next build to block silently.
  if pkill -KILL -f "cargo build.*-p sws-runtime" 2>/dev/null; then
    echo "[cleanup] terminated lingering cargo build"
    killed=1
  fi

  # Kill runtime binaries (debug and release) that hold our viewer/admin ports.
  for variant in debug release; do
    if pgrep -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" >/dev/null 2>&1; then
      # Check if this binary actually holds our ports before killing it.
      if fuser "${VIEWER_PORT}/tcp" "${ADMIN_PORT}/tcp" >/dev/null 2>&1; then
        echo "[cleanup] stopping existing sws-runtime ($variant) on ports $VIEWER_PORT/$ADMIN_PORT…"
        pkill -TERM -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" 2>/dev/null || true
        local i
        for i in $(seq 1 6); do
          pgrep -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" >/dev/null 2>&1 || break
          sleep 0.5
        done
        pkill -KILL -f "$REPO_ROOT/sws-runtime/target/$variant/sws-runtime" 2>/dev/null || true
        killed=1
      fi
    fi
  done

  # Kill Vite dev server on our specific port.
  if fuser "${VITE_PORT}/tcp" >/dev/null 2>&1; then
    echo "[cleanup] stopping vite dev server on port $VITE_PORT…"
    fuser -k "${VITE_PORT}/tcp" 2>/dev/null || true
    sleep 0.5
    killed=1
  fi

  if [ "$killed" -eq 1 ]; then sleep 0.3; fi

  # Force-free our specific ports as safety net.
  fuser -k "${VIEWER_PORT}/tcp" "${ADMIN_PORT}/tcp" 2>/dev/null || true
  sleep 0.3
}

# ── pnpm detection ───────────────────────────────────────────────────────────
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
    echo "[runtime] WARNING: $WWW_DIST not found — ports $VIEWER_PORT/$ADMIN_PORT are API-only"
    echo "[runtime]   run 'cd sws-editor && pnpm build' to build the SPA"
  fi

  echo "[runtime] starting — viewer https://localhost:$VIEWER_PORT  admin https://localhost:$ADMIN_PORT"
  echo "[runtime] config         = $CONFIG_DIR"
  echo "[runtime] projects_root  = $PROJECTS_ROOT"
  exec "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
    --config "$CONFIG_DIR" \
    --projects-root "$PROJECTS_ROOT" \
    --templates-root "$TEMPLATES_ROOT" \
    --viewer-port "$VIEWER_PORT" \
    --admin-port "$ADMIN_PORT" \
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
  echo "[editor] starting Vite dev server on http://0.0.0.0:$VITE_PORT (proxy → https://localhost:$ADMIN_PORT)"
  # VITE_RUNTIME_URL selects the proxy target for /api and /ws/*.
  # Override from shell if connecting to a remote runtime.
  : "${VITE_RUNTIME_URL:=https://localhost:$ADMIN_PORT}"
  export VITE_RUNTIME_URL
  exec $PNPM dev --host 0.0.0.0 --port "$VITE_PORT"
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
      --viewer-port "$VIEWER_PORT" \
      --admin-port "$ADMIN_PORT" \
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

    echo "[kiosk] waiting for https://localhost:$VIEWER_PORT/health…"
    for _ in $(seq 1 30); do
      if curl -sk --max-time 1 "https://localhost:$VIEWER_PORT/health" >/dev/null 2>&1; then
        echo "[kiosk] runtime up (pid $RUNTIME_PID)"
        break
      fi
      sleep 0.5
    done

    echo "[kiosk] launching sws-kiosk (windowed for local test; remove --windowed for fullscreen)"
    STRIP_SNAP=()
    while IFS= read -r v; do STRIP_SNAP+=("-u" "$v"); done \
      < <(printenv | grep -o '^SNAP[^=]*')
    exec env "${STRIP_SNAP[@]}" \
      "$REPO_ROOT/sws-runtime/crates/sws-kiosk/target/debug/sws-kiosk" \
      "https://localhost:$VIEWER_PORT" --allow-insecure-tls --windowed
    ;;
  both)
    stop_existing
    echo "[runtime] building (cargo build)…"
    (cd "$REPO_ROOT/sws-runtime" && cargo build -p sws-runtime)

    WWW_DIST="$REPO_ROOT/sws-editor/dist"
    WWW_ARGS=()
    if [ -f "$WWW_DIST/index.html" ]; then
      WWW_ARGS=(--www "$WWW_DIST")
      echo "[runtime] serving SPA from $WWW_DIST (https://localhost:$VIEWER_PORT + https://localhost:$ADMIN_PORT)"
    else
      echo "[runtime] WARNING: $WWW_DIST not found — ports $VIEWER_PORT/$ADMIN_PORT are API-only"
      echo "[runtime]   run 'cd sws-editor && pnpm build' to build the SPA"
    fi

    echo "[runtime] starting in background; logs → $LOG_DIR/runtime.log"
    "$REPO_ROOT/sws-runtime/target/debug/sws-runtime" \
      --config "$CONFIG_DIR" \
      --projects-root "$PROJECTS_ROOT" \
      --templates-root "$TEMPLATES_ROOT" \
      --viewer-port "$VIEWER_PORT" \
      --admin-port "$ADMIN_PORT" \
      "${WWW_ARGS[@]}" \
      > "$LOG_DIR/runtime.log" 2>&1 &
    RUNTIME_PID=$!

    cleanup() {
      if kill -0 "$RUNTIME_PID" 2>/dev/null; then
        echo
        echo "[runtime] stopping (pid $RUNTIME_PID)…"
        kill "$RUNTIME_PID" 2>/dev/null || true
        wait "$RUNTIME_PID" 2>/dev/null || true
      fi
    }
    trap cleanup EXIT INT TERM

    echo "[runtime] waiting for https://localhost:$VIEWER_PORT/health…"
    for _ in $(seq 1 30); do
      if curl -sk --max-time 1 "https://localhost:$VIEWER_PORT/health" >/dev/null 2>&1; then
        echo "[runtime] ${VIEWER_PORT} up (pid $RUNTIME_PID)"
        break
      fi
      sleep 0.5
    done

    echo "[runtime] waiting for https://localhost:$ADMIN_PORT/health…"
    admin_ok=0
    for _ in $(seq 1 10); do
      if curl -sk --max-time 1 "https://localhost:$ADMIN_PORT/health" >/dev/null 2>&1; then
        echo "[runtime] ${ADMIN_PORT} up"
        admin_ok=1
        break
      fi
      sleep 0.3
    done
    if [ "$admin_ok" -eq 0 ]; then
      echo "[runtime] WARNING: ${ADMIN_PORT} did not respond — admin/IDE port may be unavailable." >&2
      echo "[runtime]   Check $LOG_DIR/runtime.log for bind errors." >&2
    fi

    # Best-effort LAN IP for the info banner — first non-loopback v4.
    LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -z "$LAN_IP" ] && LAN_IP="<your-host-ip>"

    INST_LABEL=""
    [ "$INSTANCE" -ne 1 ] && INST_LABEL=" (istanza $INSTANCE)"

    cat <<MSG

────────────────────────────────────────────────────────────────────
SWS dev environment ready$INST_LABEL.

Runtime viewer  : https://localhost:$VIEWER_PORT       ← operatori/kiosk (anonimo)
Admin IDE       : https://localhost:$ADMIN_PORT       ← editor canvas + ConfigView
Vite dev server : http://localhost:$VITE_PORT/index-admin.html  ← IDE con hot-reload
Vite (LAN)      : http://$LAN_IP:$VITE_PORT/index-admin.html   ← da altri dispositivi

TLS cert persistente in: $CONFIG_DIR/tls.crt
  curl -k https://localhost:$VIEWER_PORT/cert -o sws.crt
  curl -k https://$LAN_IP:$VIEWER_PORT/cert -o sws.crt   ← da un altro dispositivo

Multi-instance: ./scripts/dev.sh --instance 2 runtime
  → runtime separato su porte $((VIEWER_PORT + 2))/$((ADMIN_PORT + 2)), dati in .run-2/

Logs:   tail -f $LOG_DIR/runtime.log
Stop:   Ctrl-C (kills both)
────────────────────────────────────────────────────────────────────

MSG

    start_editor
    ;;
  *)
    echo "usage: $0 [--instance N] [both|runtime|editor|kiosk]" >&2
    exit 2
    ;;
esac
