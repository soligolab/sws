#!/usr/bin/env bash
#
# Build the x86_64 container image for the SWS runtime and save it as a
# transferable archive. Sibling of scripts/build_container.sh (aarch64):
# stesso flusso, nessun SDK di cross-compile — qui l'architettura di build e
# quella target coincidono, basta un `cargo build --release` nativo.
#
#   dist/sws-runtime-<version>-x86_64-image.tar.gz   binario + template (~XX MB)
#   dist/sws-www-<version>.tar.gz                    la SPA          (~3 MB)
#
# The image does NOT compile anything: it wraps a natively-built binary. The
# SPA travels separately and lives in a bind mount on the device, so a
# frontend-only change does not require rebuilding and shipping the image.
#
# On the device (see deploy/container/install-container.sh):
#   ./install-container.sh --image sws-runtime-<version>-x86_64-image.tar.gz \
#                          --www   sws-www-<version>.tar.gz
#   ./install-container.sh --www-only sws-www-<version>.tar.gz   # solo frontend
#
# Usage:
#   ./scripts/build_container_x86_64.sh              # build + image + archive
#   ./scripts/build_container_x86_64.sh --no-rust    # reuse the existing x86_64 binary
#   ./scripts/build_container_x86_64.sh --no-spa     # reuse the existing sws-editor/dist
#   ./scripts/build_container_x86_64.sh --no-save    # build the image only, no archive
#   ./scripts/build_container_x86_64.sh --out DIR    # output directory (default dist/)
#
# Requirements: Rust/cargo (nessun SDK speciale), podman, e rete verso
#               docker.io per la base image debian:bookworm-slim.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_RUST=1
BUILD_SPA=1
SAVE=1
OUT_DIR="$REPO/dist"
BIN="$REPO/sws-runtime/target/release/sws-runtime"
SPA_DIST="$REPO/sws-editor/dist"

while [ $# -gt 0 ]; do
    case "$1" in
        --no-rust) BUILD_RUST=0; shift ;;
        --no-spa)  BUILD_SPA=0;  shift ;;
        --no-save) SAVE=0;       shift ;;
        --out)     OUT_DIR="$2"; shift 2 ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

VERSION=$(cd "$REPO/sws-runtime" && cargo metadata --no-deps --format-version 1 \
    | python3 -c "import json,sys; pkgs=json.load(sys.stdin)['packages']; \
      print(next(p['version'] for p in pkgs if p['name']=='sws-runtime'))")
IMAGE="sws-runtime:${VERSION}"

echo "==> SWS runtime container image ${VERSION} (linux/amd64)"

# ── 1. Build ───────────────────────────────────────────────────────────────────
if [ "$BUILD_RUST" -eq 1 ]; then
    echo "==> [1/4] cargo build --release --bin sws-runtime"
    (cd "$REPO/sws-runtime" && cargo build --release --bin sws-runtime)
else
    echo "==> [1/4] skipped (--no-rust)"
fi

if [ "$BUILD_SPA" -eq 1 ]; then
    echo "==> [1b/4] pnpm build (SPA)"
    (cd "$REPO/sws-editor" && pnpm build)
else
    echo "==> [1b/4] skipped (--no-spa)"
fi

[ -f "$BIN" ]                || { echo "ERROR: missing $BIN" >&2; exit 1; }
[ -f "$SPA_DIST/index.html" ] || { echo "ERROR: missing SPA at $SPA_DIST (drop --no-spa)" >&2; exit 1; }

# Guard against the classic mistake of feeding a foreign-arch binary to an
# amd64 image — same principle as build_container.sh's aarch64 check.
if ! file "$BIN" | grep -q "x86-64"; then
    echo "ERROR: $BIN is not an x86_64 binary:" >&2
    file "$BIN" >&2
    exit 1
fi

# ── 2. Stage the build context ────────────────────────────────────────────────
CTX="$OUT_DIR/container-context"
echo "==> [2/4] staging build context in $CTX"
rm -rf "$CTX"
mkdir -p "$CTX/bin" "$CTX/templates"
install -m 755 "$BIN" "$CTX/bin/sws-runtime"
cp -r "$REPO/examples/templates/." "$CTX/templates/"

# ── 3. Build the image ────────────────────────────────────────────────────────
# --format docker è indispensabile, non cosmetico: HEALTHCHECK non esiste nella
# spec OCI, senza --format docker podman lo scarta con un warning silenzioso.
echo "==> [3/4] podman build --platform linux/amd64 -t $IMAGE"
podman build --platform linux/amd64 --format docker \
    -t "$IMAGE" \
    -f "$REPO/deploy/container/Containerfile.x86_64" \
    "$CTX"
rm -rf "$CTX"

# ── 4. Save the transferable archive ──────────────────────────────────────────
WWW_ARCHIVE="$OUT_DIR/sws-www-${VERSION}.tar.gz"
echo "==> [3b/4] archivio SPA → $WWW_ARCHIVE"
mkdir -p "$OUT_DIR"
tar czf "$WWW_ARCHIVE" -C "$SPA_DIST" .
echo "    $(du -h "$WWW_ARCHIVE" | cut -f1)  $WWW_ARCHIVE"

if [ "$SAVE" -eq 1 ]; then
    ARCHIVE="$OUT_DIR/sws-runtime-${VERSION}-x86_64-image.tar"
    echo "==> [4/4] podman save → ${ARCHIVE}.gz"
    mkdir -p "$OUT_DIR"
    rm -f "$ARCHIVE" "$ARCHIVE.gz"
    podman save -o "$ARCHIVE" "$IMAGE"
    gzip -f "$ARCHIVE"
    echo
    echo "    $(du -h "$ARCHIVE.gz" | cut -f1)  ${ARCHIVE}.gz"
else
    echo "==> [4/4] skipped (--no-save)"
fi

echo
echo "==> done. Image: $IMAGE"
