#!/usr/bin/env bash
#
# Build SWS container images for `linux/arm64` (Rockchip / Raspberry Pi)
# and `linux/amd64` (developer laptops, x86 servers). Uses `docker buildx`
# under the hood so a cross-compile happens via QEMU on hosts that don't
# match the target architecture.
#
# Usage:
#     ./scripts/build-images.sh                      # both archs, local load
#     ./scripts/build-images.sh --push               # both archs, push to registry
#     ./scripts/build-images.sh --arch linux/arm64   # arm64 only
#     ./scripts/build-images.sh --registry ghcr.io/youruser
#
# Environment:
#     SWS_IMAGE_TAG (default: dev)
#
# Prereqs (once per dev machine):
#     docker buildx create --use --name sws-builder
#     docker run --privileged --rm tonistiigi/binfmt --install all
#
# Tested against Rockchip PX30 and Raspberry Pi 4 hosts running Podman 4.x
# (load the resulting OCI archives with `podman load`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${REGISTRY:-ghcr.io/soligolab}"
TAG="${SWS_IMAGE_TAG:-dev}"
ARCHS="linux/amd64,linux/arm64"
ACTION="--load"     # local docker daemon by default
EXTRA_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --push)         ACTION="--push"; shift ;;
    --arch)         ARCHS="$2"; shift 2 ;;
    --registry)     REGISTRY="$2"; shift 2 ;;
    --tag)          TAG="$2"; shift 2 ;;
    *)              EXTRA_ARGS+=("$1"); shift ;;
  esac
done

# `--load` only works for a single platform. When the user keeps the
# multi-arch default, fall back to building cache-only — the user can
# rerun with `--push` once they have a registry.
if [[ "$ACTION" == "--load" && "$ARCHS" == *","* ]]; then
  echo "[warn] --load is single-arch only; producing OCI archives under .run/oci/ instead."
  mkdir -p "$REPO_ROOT/.run/oci"
  RUNTIME_OUT="--output type=oci,dest=$REPO_ROOT/.run/oci/sws-runtime-$TAG.tar"
  EDITOR_OUT="--output type=oci,dest=$REPO_ROOT/.run/oci/sws-editor-$TAG.tar"
else
  RUNTIME_OUT="$ACTION"
  EDITOR_OUT="$ACTION"
fi

echo "[build] runtime → $REGISTRY/sws-runtime:$TAG ($ARCHS)"
docker buildx build \
  --platform "$ARCHS" \
  --tag "$REGISTRY/sws-runtime:$TAG" \
  $RUNTIME_OUT \
  "${EXTRA_ARGS[@]}" \
  -f "$REPO_ROOT/sws-runtime/docker/Dockerfile" \
  "$REPO_ROOT/sws-runtime"

echo "[build] editor → $REGISTRY/sws-editor:$TAG ($ARCHS)"
docker buildx build \
  --platform "$ARCHS" \
  --tag "$REGISTRY/sws-editor:$TAG" \
  $EDITOR_OUT \
  "${EXTRA_ARGS[@]}" \
  -f "$REPO_ROOT/sws-editor/docker/Dockerfile" \
  "$REPO_ROOT/sws-editor"

echo "[build] done."
if [[ "$ACTION" == "--push" ]]; then
  echo "       Images pushed to $REGISTRY."
elif [[ "$RUNTIME_OUT" == --output* ]]; then
  echo "       OCI archives written to $REPO_ROOT/.run/oci/."
  echo "       Transfer to the target and load with:"
  echo "           podman load -i sws-runtime-$TAG.tar"
  echo "           podman load -i sws-editor-$TAG.tar"
fi
