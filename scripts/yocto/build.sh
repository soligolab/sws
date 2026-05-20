#!/usr/bin/env bash
#
# Cross-compile sws-runtime for Pixsys Yocto devices (aarch64 / cortex-a35).
# Same binary covers PX30, RK3399 and RK3588 (cortex-a35 is the ARMv8
# baseline of the trio; the others are upward compatible).
#
# Prereqs on the dev box (one-off):
#   1. SDK installed at /usr/local/oecore-x86_64/  (the sourceable env script
#      $SDK_ENV must exist — see below)
#   2. rustup target add aarch64-unknown-linux-gnu
#   3. pnpm available (corepack or shim); only required when --www embedding
#      is enabled (default)
#
# Usage:
#   ./scripts/yocto/build.sh             # release build, embeds SPA dist
#   ./scripts/yocto/build.sh --no-spa    # skip pnpm build of sws-editor
#   ./scripts/yocto/build.sh debug       # cargo build without --release
#
# Output: sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime
#         (or debug/ for debug)
#
# The Vite dist (when built) is at sws-editor/dist/ on the dev box. The
# deploy script picks both up.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LINKER_WRAPPER="$REPO_ROOT/scripts/yocto/yocto-linker.sh"
SDK_ENV="/usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux"
TARGET_TRIPLE="aarch64-unknown-linux-gnu"

PROFILE="release"
BUILD_SPA=1
for arg in "$@"; do
  case "$arg" in
    debug)    PROFILE="debug" ;;
    release)  PROFILE="release" ;;
    --no-spa) BUILD_SPA=0 ;;
    *) echo "[build] unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# ── Prerequisites ────────────────────────────────────────────────────────────

if [ ! -f "$SDK_ENV" ]; then
  echo "[build] ERROR: SDK env script not found at $SDK_ENV" >&2
  echo "[build] Install the Pixsys Yocto SDK first." >&2
  exit 1
fi

if [ ! -x "$LINKER_WRAPPER" ]; then
  echo "[build] ERROR: linker wrapper missing or not executable: $LINKER_WRAPPER" >&2
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -qx "$TARGET_TRIPLE"; then
  echo "[build] installing Rust target $TARGET_TRIPLE…"
  rustup target add "$TARGET_TRIPLE"
fi

# ── Source SDK env (in a subshell — see comment below) ───────────────────────
#
# We deliberately source the SDK inside the same shell so cargo inherits all
# the cross-compile env (PKG_CONFIG_*, AR, CC for cc-rs, etc.). Side effect:
# the SDK overrides PATH and pkg-config. That's fine for this script — it
# only does cross builds.
#
# If you ever need to run host-native cargo from this same shell afterwards,
# open a new terminal — undoing the SDK env in-place is brittle.

# shellcheck disable=SC1090
. "$SDK_ENV"

# Sanity check the cross compiler is reachable.
if ! command -v aarch64-pixsys-linux-gcc >/dev/null 2>&1; then
  echo "[build] ERROR: aarch64-pixsys-linux-gcc not on PATH after sourcing SDK env." >&2
  exit 1
fi

# ── Cargo env ────────────────────────────────────────────────────────────────
#
# CARGO_TARGET_*_LINKER replaces the linker for the target triple with our
# wrapper, which invokes aarch64-pixsys-linux-gcc with the right sysroot
# and cortex-a35 flags. This is the same trick test-kit uses.
#
# PyO3 needs explicit cross hints — it cannot guess libpython location from
# the SDK env alone. Sysroot was verified to contain libpython3.12.so +
# Python.h on 2026-05-20.

export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="$LINKER_WRAPPER"
export PYO3_CROSS_LIB_DIR="$OECORE_TARGET_SYSROOT/usr/lib"
export PYO3_CROSS_PYTHON_VERSION="3.12"

# cc-rs (used by rusqlite/bundled, ring, etc.) will pick up $CC/$CXX from the
# SDK env. No extra config needed.

# ── Optional: build the SPA so the runtime can embed it via --www ────────────

if [ "$BUILD_SPA" -eq 1 ]; then
  if [ ! -d "$REPO_ROOT/sws-editor/node_modules" ]; then
    echo "[build] installing sws-editor deps (first run)…"
    (cd "$REPO_ROOT/sws-editor" && pnpm install)
  fi
  echo "[build] building SPA bundle (pnpm build)…"
  (cd "$REPO_ROOT/sws-editor" && pnpm build)
else
  echo "[build] skipping SPA build (--no-spa)"
fi

# ── Cargo build ──────────────────────────────────────────────────────────────

CARGO_FLAGS=( --target "$TARGET_TRIPLE" -p sws-runtime )
case "$PROFILE" in
  release) CARGO_FLAGS+=( --release ) ;;
  debug)   : ;;
esac

echo "[build] cargo build ${CARGO_FLAGS[*]}"
(cd "$REPO_ROOT/sws-runtime" && cargo build "${CARGO_FLAGS[@]}")

# ── Report ───────────────────────────────────────────────────────────────────

BIN="$REPO_ROOT/sws-runtime/target/$TARGET_TRIPLE/$PROFILE/sws-runtime"
if [ -f "$BIN" ]; then
  SIZE_HUMAN="$(du -h "$BIN" | awk '{print $1}')"
  echo
  echo "[build] done."
  echo "[build] binary : $BIN  ($SIZE_HUMAN)"
  echo "[build] file   : $(file -b "$BIN" 2>/dev/null | head -1)"
  echo "[build] SPA    : $REPO_ROOT/sws-editor/dist  (deploy together)"
else
  echo "[build] ERROR: expected binary not found at $BIN" >&2
  exit 1
fi
