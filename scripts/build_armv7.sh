#!/usr/bin/env bash
#
# Cross-compila runtime e viewer LVGL per armv7 (Tiny TY: RV1106, Ubuntu 22.04
# armhf, glibc 2.35, Python 3.10). Solo i binari, niente immagine: sui Tiny TY
# non c'è podman. Piano docs/plans/2026-10-30-sws-lvgl-sul-tiny-ty.md, passo 1.
#
# Il builder è deploy/container/Containerfile.armv7-cross.builder; le cartelle
# di lavoro stanno nel repo e in .gitignore, separate da quelle aarch64.
#
# Uso:
#   ./scripts/build_armv7.sh              # runtime + viewer
#   ./scripts/build_armv7.sh --no-lvgl    # solo il runtime
#
# Esce in dist/armv7/: sws-runtime e sws-lvgl-viewer.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_TRIPLE="armv7-unknown-linux-gnueabihf"
BUILDER_IMAGE="sws-runtime-builder:armv7-cross"
WITH_LVGL=1

while [ $# -gt 0 ]; do
    case "$1" in
        --no-lvgl) WITH_LVGL=0; shift ;;
        -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
        *) echo "argomento sconosciuto: $1" >&2; exit 2 ;;
    esac
done

[ -e /proc/sys/fs/binfmt_misc/qemu-arm ] || {
    echo "ERRORE: manca qemu-arm in binfmt_misc: serve per l'apt-get del sysroot armhf." >&2
    exit 1
}

echo "==> [1/4] immagine builder $BUILDER_IMAGE (x86_64 → armv7, Ubuntu 22.04)"
podman build --platform linux/amd64 --network host -t "$BUILDER_IMAGE" \
    -f "$REPO/deploy/container/Containerfile.armv7-cross.builder" \
    "$REPO/deploy/container"

if [ "$WITH_LVGL" -eq 1 ]; then
    echo "==> [2/4] verifica delle patch al codice vendorizzato"
    "$REPO/scripts/check_vendor_patches.sh"
fi

echo "==> [3/4] cargo build --release --target $TARGET_TRIPLE -p sws-runtime"
podman run --rm --network host \
    -v "$REPO":/src:Z \
    -w /src/sws-runtime \
    -e CARGO_HOME=/src/.cargo-container-armv7-cross \
    -e CARGO_TARGET_DIR=/src/sws-runtime/target-container-armv7-cross \
    "$BUILDER_IMAGE" \
    cargo build --release --target "$TARGET_TRIPLE" -p sws-runtime

if [ "$WITH_LVGL" -eq 1 ]; then
    # Dalla cartella del crate: il suo .cargo/config.toml dà DEP_LV_CONFIG_PATH.
    echo "==> [4/4] cargo build --release --target $TARGET_TRIPLE (sws-lvgl-viewer)"
    podman run --rm --network host \
        -v "$REPO":/src:Z \
        -w /src/sws-runtime/crates/sws-lvgl-viewer \
        -e CARGO_HOME=/src/.cargo-container-armv7-cross \
        -e CARGO_TARGET_DIR=/src/sws-runtime/crates/sws-lvgl-viewer/target-container-armv7-cross \
        "$BUILDER_IMAGE" \
        cargo build --release --target "$TARGET_TRIPLE"
fi

OUT="$REPO/dist/armv7"
mkdir -p "$OUT"
install -m 755 "$REPO/sws-runtime/target-container-armv7-cross/$TARGET_TRIPLE/release/sws-runtime" "$OUT/"
[ "$WITH_LVGL" -eq 0 ] || install -m 755 \
    "$REPO/sws-runtime/crates/sws-lvgl-viewer/target-container-armv7-cross/$TARGET_TRIPLE/release/sws-lvgl-viewer" "$OUT/"
file "$OUT"/*
