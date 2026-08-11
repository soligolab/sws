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
#   ./scripts/yocto/build.sh --with-lvgl # also cross-compile sws-lvgl-viewer
#
# Output: sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime
#         (or debug/ for debug)
#         with --with-lvgl, also:
#         sws-runtime/crates/sws-lvgl-viewer/target/aarch64-unknown-linux-gnu/release/sws-lvgl-viewer
#
# --with-lvgl is opt-in and separate from the sws-runtime build on purpose:
# sws-lvgl-viewer links against system SDL2 (see its Cargo.toml), which needs
# libsdl2-dev present in the Pixsys sysroot — unverified as of this writing.
# Without the flag, this script's behavior (including exit-on-failure via
# `set -euo pipefail`) is byte-for-byte what it was before this crate existed;
# a missing/broken SDL2 dev package on the sysroot must never break the
# sws-runtime build that everything else depends on.
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
WITH_LVGL=0
for arg in "$@"; do
  case "$arg" in
    debug)       PROFILE="debug" ;;
    release)     PROFILE="release" ;;
    --no-spa)    BUILD_SPA=0 ;;
    --with-lvgl) WITH_LVGL=1 ;;
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

# pyo3-build-config still needs a *host* Python to run its build script.
# Debian dev box has python3 but not /usr/bin/python (the default pyo3 path).
# Point it at python3 explicitly to avoid "No such file or directory" errors.
if [ -z "${PYO3_PYTHON:-}" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYO3_PYTHON="$(command -v python3)"
    export PYO3_PYTHON
  else
    echo "[build] ERROR: no host python3 on PATH (needed by pyo3-build-config)." >&2
    exit 1
  fi
fi

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

# ── Optional: sws-lvgl-viewer (--with-lvgl) ─────────────────────────────────
#
# Excluded from the sws-runtime workspace (see its own Cargo.toml comment),
# so it needs its own `cargo build` invocation — and it MUST run with that
# crate's directory as cwd, not via --manifest-path from elsewhere: it has a
# local .cargo/config.toml that points DEP_LV_CONFIG_PATH at lv_conf/
# relative to the current directory, and cargo's config discovery walks up
# from cwd, not from the manifest path.

if [ "$WITH_LVGL" -eq 1 ]; then
  LVGL_CRATE_DIR="$REPO_ROOT/sws-runtime/crates/sws-lvgl-viewer"
  LVGL_CARGO_FLAGS=( --target "$TARGET_TRIPLE" )
  case "$PROFILE" in
    release) LVGL_CARGO_FLAGS+=( --release ) ;;
    debug)   : ;;
  esac
  echo "[build] cargo build (sws-lvgl-viewer) ${LVGL_CARGO_FLAGS[*]}"
  (cd "$LVGL_CRATE_DIR" && cargo build "${LVGL_CARGO_FLAGS[@]}")
else
  echo "[build] skipping sws-lvgl-viewer (pass --with-lvgl to cross-compile it too)"
fi

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

if [ "$WITH_LVGL" -eq 1 ]; then
  LVGL_BIN="$LVGL_CRATE_DIR/target/$TARGET_TRIPLE/$PROFILE/sws-lvgl-viewer"
  if [ -f "$LVGL_BIN" ]; then
    LVGL_SIZE_HUMAN="$(du -h "$LVGL_BIN" | awk '{print $1}')"
    echo "[build] lvgl   : $LVGL_BIN  ($LVGL_SIZE_HUMAN)"
    echo "[build] lvgl   : $(file -b "$LVGL_BIN" 2>/dev/null | head -1)"
  else
    echo "[build] ERROR: expected sws-lvgl-viewer binary not found at $LVGL_BIN" >&2
    exit 1
  fi
fi
