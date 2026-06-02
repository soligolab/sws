#!/usr/bin/env bash
#
# Build a generic Linux x86_64 release tarball for sws-runtime.
#
# Output: dist/sws-<version>-linux-<arch>.tar.gz
#
# Usage:
#   ./scripts/package.sh              # full build (Rust + SPA)
#   ./scripts/package.sh --no-spa     # skip pnpm build (reuse existing dist/)
#   ./scripts/package.sh --no-rust    # skip cargo build (reuse existing binary)
#
# Requirements:
#   - cargo (Rust stable)
#   - pnpm  (for the editor SPA)
#   - Python 3 on the target machine (runtime links libpython via PyO3)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_RUST=1
BUILD_SPA=1

for arg in "$@"; do
    case "$arg" in
        --no-rust) BUILD_RUST=0 ;;
        --no-spa)  BUILD_SPA=0  ;;
        *) echo "Unknown flag: $arg" >&2; exit 1 ;;
    esac
done

# ── Resolve version ───────────────────────────────────────────────────────────

VERSION=$(cd "$REPO/sws-runtime" && cargo metadata --no-deps --format-version 1 \
    | python3 -c "import json,sys; pkgs=json.load(sys.stdin)['packages']; \
      print(next(p['version'] for p in pkgs if p['name']=='sws-runtime'))")
ARCH="$(uname -m)"
TARNAME="sws-${VERSION}-linux-${ARCH}"
DIST="$REPO/dist"
STAGE="$DIST/$TARNAME"

echo "==> Packaging sws ${VERSION} for linux/${ARCH}"

# ── Build Rust runtime ────────────────────────────────────────────────────────

if [ "$BUILD_RUST" -eq 1 ]; then
    echo "==> Building sws-runtime (release)..."
    cargo build --release \
        --manifest-path "$REPO/sws-runtime/Cargo.toml" \
        -p sws-runtime
else
    echo "==> Skipping Rust build (--no-rust)"
fi

BINARY="$REPO/sws-runtime/target/release/sws-runtime"
[ -f "$BINARY" ] || { echo "ERROR: binary not found at $BINARY — run without --no-rust first."; exit 1; }

# ── Build editor SPA ──────────────────────────────────────────────────────────

if [ "$BUILD_SPA" -eq 1 ]; then
    echo "==> Building editor SPA..."
    (cd "$REPO/sws-editor" && pnpm build)
else
    echo "==> Skipping SPA build (--no-spa)"
fi

SPA_DIST="$REPO/sws-editor/dist"
[ -d "$SPA_DIST" ] || { echo "ERROR: SPA dist/ not found — run without --no-spa first."; exit 1; }

# ── Stage tarball contents ────────────────────────────────────────────────────

echo "==> Staging $STAGE ..."
rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/www" "$STAGE/templates"

# Binary + launch wrapper
install -m 755 "$BINARY"                                               "$STAGE/bin/sws-runtime"
install -m 755 "$REPO/deploy/generic-linux/sws-runtime-launch.sh"     "$STAGE/bin/sws-runtime-launch.sh"

# Web assets (editor SPA)
cp -r "$SPA_DIST/." "$STAGE/www/"

# Example project templates
if [ -d "$REPO/examples/templates" ]; then
    cp -r "$REPO/examples/templates/." "$STAGE/templates/"
fi

# Installer scripts
install -m 755 "$REPO/deploy/generic-linux/install.sh"          "$STAGE/install.sh"
cp            "$REPO/deploy/generic-linux/sws-runtime.service"  "$STAGE/sws-runtime.service"

# ── Create tarball ────────────────────────────────────────────────────────────

echo "==> Creating dist/${TARNAME}.tar.gz ..."
mkdir -p "$DIST"
(cd "$DIST" && tar czf "${TARNAME}.tar.gz" "$TARNAME")
rm -rf "$STAGE"

SIZE=$(du -sh "$DIST/${TARNAME}.tar.gz" | cut -f1)
echo ""
echo "==> Done: dist/${TARNAME}.tar.gz  (${SIZE})"
echo ""
echo "    Install on target:"
echo "      scp dist/${TARNAME}.tar.gz user@target:~/"
echo "      ssh user@target 'tar xzf ${TARNAME}.tar.gz && sudo ./${TARNAME}/install.sh'"
echo ""
echo "    Or install locally:"
echo "      tar xzf dist/${TARNAME}.tar.gz && sudo ./dist/${TARNAME}/install.sh"
