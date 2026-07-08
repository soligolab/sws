#!/usr/bin/env bash
#
# Build BOTH deployable SWS packages (editor + runtime) for the host arch and,
# when the Pixsys Yocto SDK is available, for aarch64 — into dist/.
#
#   sws-runtime-<version>-linux-<arch>.tar.gz  — device package (systemd installer)
#   sws-editor-<version>-linux-<arch>.tar.gz   — portable IDE (unpack & run)
#
# The binary (sws-runtime) and the SPA (sws-editor/dist) are built ONCE per
# arch and shared by both roles — the roles differ only in the bundled
# launcher/installer, not in the compiled artifacts.
#
# scripts/package.sh (invoked by the backend's T-28 /api/build/package endpoint)
# is deliberately left untouched; the short staging block below is duplicated
# from it so both packages get clean, symmetric names.
#
# Usage:
#   ./scripts/build_deploy.sh                 # host + aarch64 (if the SDK is present)
#   ./scripts/build_deploy.sh --host-only     # only the host arch
#   ./scripts/build_deploy.sh --aarch64-only  # only aarch64 (requires the SDK)
#   ./scripts/build_deploy.sh --no-rust       # reuse already-built binaries
#   ./scripts/build_deploy.sh --no-spa        # reuse existing sws-editor/dist
#   ./scripts/build_deploy.sh --out DIR       # output directory (default dist/)
#
# Requirements: cargo, pnpm, Python 3 (the runtime links libpython via PyO3).
#               For aarch64: the Pixsys Yocto SDK in /usr/local/oecore-x86_64/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_RUST=1
BUILD_SPA=1
BUILD_HOST=1
BUILD_ARM=1
OUT_DIR="$REPO/dist"
SDK_ENV="/usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux"

while [ $# -gt 0 ]; do
    case "$1" in
        --no-rust)      BUILD_RUST=0; shift ;;
        --no-spa)       BUILD_SPA=0;  shift ;;
        --host-only)    BUILD_ARM=0;  shift ;;
        --aarch64-only) BUILD_HOST=0; shift ;;
        --out)          OUT_DIR="$2"; shift 2 ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

# aarch64 requested but the SDK is missing: skip with a warning, unless it is
# the only target (then it's a hard error — nothing would be produced).
if [ "$BUILD_ARM" -eq 1 ] && [ ! -f "$SDK_ENV" ]; then
    if [ "$BUILD_HOST" -eq 0 ]; then
        echo "ERROR: --aarch64-only but SDK missing ($SDK_ENV). Install the Pixsys Yocto SDK." >&2
        exit 1
    fi
    echo "==> WARNING: Yocto SDK not found ($SDK_ENV) — skipping aarch64 packages." >&2
    BUILD_ARM=0
fi

# ── Resolve version / host arch ───────────────────────────────────────────────

VERSION=$(cd "$REPO/sws-runtime" && cargo metadata --no-deps --format-version 1 \
    | python3 -c "import json,sys; pkgs=json.load(sys.stdin)['packages']; \
      print(next(p['version'] for p in pkgs if p['name']=='sws-runtime'))")
HOST_ARCH="$(uname -m)"

echo "==> Building SWS deploy packages ${VERSION}  (host=${BUILD_HOST} aarch64=${BUILD_ARM})"
echo "    Output: $OUT_DIR"

# ── Build the SPA once (architecture-independent) ─────────────────────────────

if [ "$BUILD_SPA" -eq 1 ]; then
    echo "==> Building editor SPA..."
    (cd "$REPO/sws-editor" && pnpm build)
else
    echo "==> Skipping SPA build (--no-spa)"
fi
SPA_DIST="$REPO/sws-editor/dist"
[ -d "$SPA_DIST" ] || { echo "ERROR: SPA dist/ not found — run without --no-spa first."; exit 1; }

# ── Build the host binary (release) ───────────────────────────────────────────

HOST_BIN="$REPO/sws-runtime/target/release/sws-runtime"
if [ "$BUILD_HOST" -eq 1 ] && [ "$BUILD_RUST" -eq 1 ]; then
    echo "==> Building sws-runtime (release, host/${HOST_ARCH})..."
    cargo build --release --manifest-path "$REPO/sws-runtime/Cargo.toml" -p sws-runtime
fi

# ── Cross-build the aarch64 binary ────────────────────────────────────────────
#
# scripts/yocto/build.sh sources the SDK env INTO its own shell, so we invoke it
# as a subprocess to keep this shell's host toolchain uncontaminated. --no-spa
# because we already built the (arch-independent) SPA above.
ARM_BIN="$REPO/sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime"
if [ "$BUILD_ARM" -eq 1 ] && [ "$BUILD_RUST" -eq 1 ]; then
    echo "==> Cross-building sws-runtime (release, aarch64) via scripts/yocto/build.sh..."
    bash "$REPO/scripts/yocto/build.sh" release --no-spa
fi

mkdir -p "$OUT_DIR"

# ── Stage one package (common assets + per-role extras) ───────────────────────
#
# $1 = binary path   $2 = tarball/dir name   $3 = role
# role ∈ { runtime-generic | runtime-yocto | editor }
make_package() {
    local binary="$1" name="$2" role="$3"
    local stage="$OUT_DIR/$name"
    [ -f "$binary" ] || { echo "ERROR: binary not found: $binary"; exit 1; }

    echo "==> Staging $name ($role) ..."
    rm -rf "$stage"
    mkdir -p "$stage/bin" "$stage/www" "$stage/templates"

    install -m 755 "$binary" "$stage/bin/sws-runtime"
    cp -r "$SPA_DIST/." "$stage/www/"
    [ -d "$REPO/examples/templates" ] && cp -r "$REPO/examples/templates/." "$stage/templates/"

    case "$role" in
        runtime-generic)
            install -m 755 "$REPO/deploy/generic-linux/sws-runtime-launch.sh" "$stage/bin/sws-runtime-launch.sh"
            install -m 755 "$REPO/deploy/generic-linux/install.sh"            "$stage/install.sh"
            cp             "$REPO/deploy/generic-linux/sws-runtime.service"    "$stage/sws-runtime.service"
            ;;
        runtime-yocto)
            install -m 755 "$REPO/deploy/yocto/sws-runtime-launch.sh" "$stage/bin/sws-runtime-launch.sh"
            install -m 755 "$REPO/deploy/yocto/install.sh"            "$stage/install.sh"
            cp             "$REPO/deploy/yocto/sws-runtime.service"    "$stage/sws-runtime.service"
            ;;
        editor)
            install -m 755 "$REPO/deploy/editor/run-editor.sh" "$stage/run-editor.sh"
            cp             "$REPO/deploy/editor/README.md"     "$stage/README.md"
            ;;
        *) echo "ERROR: unknown role: $role"; exit 1 ;;
    esac

    (cd "$OUT_DIR" && tar czf "${name}.tar.gz" "$name")
    rm -rf "$stage"
}

if [ "$BUILD_HOST" -eq 1 ]; then
    make_package "$HOST_BIN" "sws-runtime-${VERSION}-linux-${HOST_ARCH}" runtime-generic
    make_package "$HOST_BIN" "sws-editor-${VERSION}-linux-${HOST_ARCH}"  editor
fi
if [ "$BUILD_ARM" -eq 1 ]; then
    make_package "$ARM_BIN" "sws-runtime-${VERSION}-linux-aarch64" runtime-yocto
    make_package "$ARM_BIN" "sws-editor-${VERSION}-linux-aarch64"  editor
fi

echo ""
echo "==> Done. Packages in $OUT_DIR:"
ls -1sh "$OUT_DIR"/sws-*-"${VERSION}"-linux-*.tar.gz 2>/dev/null || true
