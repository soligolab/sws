#!/usr/bin/env bash
#
# Build the aarch64 container image for the SWS runtime and save it as a
# transferable archive.
#
#   dist/sws-runtime-<version>-aarch64-image.tar.gz   binario + template (~59 MB)
#   dist/sws-www-<version>.tar.gz                     la SPA          (~3 MB)
#
# The image does NOT compile anything: it wraps the binary produced by the
# Pixsys Yocto cross-compile (scripts/yocto/build.sh). Compiling Rust inside
# an emulated arm64 image would take hours; this takes seconds.
#
# The SPA travels separately and lives in a bind mount on the device, so a
# frontend-only change does not require rebuilding and shipping 59 MB.
#
# On the device (see deploy/container/install-container.sh):
#   ./install-container.sh --image sws-runtime-<version>-aarch64-image.tar.gz \
#                          --www   sws-www-<version>.tar.gz
#   ./install-container.sh --www-only sws-www-<version>.tar.gz   # solo frontend
#
# Usage:
#   ./scripts/build_container.sh              # cross-build + image + archive
#   ./scripts/build_container.sh --no-rust    # reuse the existing aarch64 binary
#   ./scripts/build_container.sh --no-spa     # reuse the existing sws-editor/dist
#   ./scripts/build_container.sh --no-save    # build the image only, no archive
#   ./scripts/build_container.sh --out DIR    # output directory (default dist/)
#
# Requirements: the Pixsys Yocto SDK in /usr/local/oecore-x86_64/ (unless
#               --no-rust), podman, and network access to pull ubuntu:24.04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_RUST=1
BUILD_SPA=1
SAVE=1
OUT_DIR="$REPO/dist"
SDK_ENV="/usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux"
BIN="$REPO/sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime"
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

if [ "$BUILD_RUST" -eq 1 ] && [ ! -f "$SDK_ENV" ]; then
    echo "ERROR: Pixsys Yocto SDK not found ($SDK_ENV)." >&2
    echo "       Install it, or pass --no-rust to reuse an existing binary." >&2
    exit 1
fi

VERSION=$(cd "$REPO/sws-runtime" && cargo metadata --no-deps --format-version 1 \
    | python3 -c "import json,sys; pkgs=json.load(sys.stdin)['packages']; \
      print(next(p['version'] for p in pkgs if p['name']=='sws-runtime'))")
IMAGE="sws-runtime:${VERSION}"

echo "==> SWS runtime container image ${VERSION} (linux/arm64)"

# ── 1. Cross-compile ──────────────────────────────────────────────────────────
# In a subprocess on purpose: yocto/build.sh sources the SDK environment into
# its own shell, which would otherwise clobber PATH/pkg-config for the rest of
# this script. Same reasoning as scripts/build_deploy.sh.
if [ "$BUILD_RUST" -eq 1 ]; then
    if [ "$BUILD_SPA" -eq 1 ]; then
        echo "==> [1/4] cross-compile (binary + SPA)"
        bash "$REPO/scripts/yocto/build.sh" release
    else
        echo "==> [1/4] cross-compile (binary only)"
        bash "$REPO/scripts/yocto/build.sh" release --no-spa
    fi
else
    echo "==> [1/4] skipped (--no-rust)"
fi

[ -f "$BIN" ]                || { echo "ERROR: missing $BIN" >&2; exit 1; }
[ -f "$SPA_DIST/index.html" ] || { echo "ERROR: missing SPA at $SPA_DIST (drop --no-spa)" >&2; exit 1; }

# Guard against the classic mistake of feeding the host binary to an arm64
# image: it would build fine and fail only at `podman run` on the device.
if ! file "$BIN" | grep -q "ARM aarch64"; then
    echo "ERROR: $BIN is not an aarch64 binary:" >&2
    file "$BIN" >&2
    exit 1
fi

# ── 2. Stage the build context ────────────────────────────────────────────────
# A dedicated staging dir keeps the context at ~40 MB. Building from the repo
# root would tar up target/ and node_modules — gigabytes.
CTX="$OUT_DIR/container-context"
echo "==> [2/4] staging build context in $CTX"
rm -rf "$CTX"
mkdir -p "$CTX/bin" "$CTX/templates"
install -m 755 "$BIN" "$CTX/bin/sws-runtime"
cp -r "$REPO/examples/templates/." "$CTX/templates/"

# ── 3. Build the image ────────────────────────────────────────────────────────
# --format docker is required, not cosmetic: HEALTHCHECK has no place in the
# OCI image spec, so with the default (oci) podman drops it with a warning and
# `podman ps` would never report healthy.
echo "==> [3/4] podman build --platform linux/arm64 -t $IMAGE"
podman build --platform linux/arm64 --format docker \
    -t "$IMAGE" \
    -f "$REPO/deploy/container/Containerfile.aarch64" \
    "$CTX"
rm -rf "$CTX"

# ── 4. Save the transferable archive ──────────────────────────────────────────
# La SPA viaggia a parte, non dentro l'immagine: cambiarla non deve costringere
# a ricostruire e ritrasferire 59 MB. L'installer la srotola nel bind mount.
WWW_ARCHIVE="$OUT_DIR/sws-www-${VERSION}.tar.gz"
echo "==> [3b/4] archivio SPA → $WWW_ARCHIVE"
mkdir -p "$OUT_DIR"
tar czf "$WWW_ARCHIVE" -C "$SPA_DIST" .
echo "    $(du -h "$WWW_ARCHIVE" | cut -f1)  $WWW_ARCHIVE"

if [ "$SAVE" -eq 1 ]; then
    ARCHIVE="$OUT_DIR/sws-runtime-${VERSION}-aarch64-image.tar"
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
