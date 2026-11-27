#!/usr/bin/env bash
#
# Build the SWS base image: the operating system of the panels, without SWS.
#
# Plan docs/plans/2026-11-27-immagine-base-del-sistema.md, procedure in
# docs/HOWTO.md §36. The runtime image starts FROM this image, pinned by
# digest in deploy/container/BASE. A new base is a decision (security fixes,
# a library change), not a side effect of a build: so this script runs by hand,
# and its result enters BASE with a dedicated `chore(base)` commit.
#
# Use:
#   ./scripts/build_base.sh --version 2026.12.1 [--arm64|--amd64|--all] [--push]
#
# --version  AAAA.MM.N: the month the packages were taken, and a counter.
# --push     publish on ghcr.io and print the lines for deploy/container/BASE.
#            An existing version is never overwritten: old runtime images
#            must still find their base (decision 5 of the plan).
#
# The arm64 base runs `apt-get` under QEMU (binfmt qemu-aarch64): it takes
# minutes, not seconds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
REGISTRY="ghcr.io/soligolab/sws-base"

VERSION="" PUSH=0 ARCHES=()
while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:-}"; shift 2 ;;
        --arm64)   ARCHES+=(arm64); shift ;;
        --amd64)   ARCHES+=(amd64); shift ;;
        --all)     ARCHES=(arm64 amd64); shift ;;
        --push)    PUSH=1; shift ;;
        -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^#//; s/^ //'; exit 0 ;;
        *) echo "ERROR: unknown argument $1 (--help)" >&2; exit 2 ;;
    esac
done
[[ "$VERSION" =~ ^20[0-9]{2}\.(0[1-9]|1[0-2])\.[1-9][0-9]*$ ]] \
    || { echo "ERROR: --version AAAA.MM.N, e.g. $(date +%Y.%m).1" >&2; exit 2; }
[ ${#ARCHES[@]} -gt 0 ] || ARCHES=(arm64 amd64)

CTX="$(mktemp -d)"   # the base copies nothing: an empty context
trap 'rm -rf "$CTX"' EXIT
LINES=()
for arch in "${ARCHES[@]}"; do
    case "$arch" in
        arm64) file=aarch64 ;;
        amd64) file=x86_64 ;;
    esac
    tag="$REGISTRY:$VERSION-$arch"
    if [ "$PUSH" -eq 1 ] && podman manifest inspect "$tag" >/dev/null 2>&1; then
        echo "ERROR: $tag exists already on the registry: choose the next version" >&2
        exit 1
    fi
    echo "==> podman build --platform linux/$arch -t $tag"
    podman build --platform "linux/$arch" --format docker --network host \
        --build-arg "SWS_BASE_VERSION=$VERSION" \
        -t "$tag" -f "$REPO/deploy/container/Containerfile.base.$file" "$CTX"
    if [ "$PUSH" -eq 1 ]; then
        podman push --digestfile "$CTX/digest-$arch" "$tag"
        LINES+=("$arch $tag@$(cat "$CTX/digest-$arch")")
    fi
done

if [ "$PUSH" -eq 1 ]; then
    echo
    echo "Lines for deploy/container/BASE (then commit «chore(base): sws-base $VERSION — <reason>»):"
    printf '%s\n' "${LINES[@]}"
else
    echo
    echo "Built locally, not published (--push to publish)."
fi
