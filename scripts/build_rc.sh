#!/usr/bin/env bash
#
# The build of an rc or a release: the three products of SWS side by side.
#
# Part 2 of the plan docs/plans/2026-11-22-dev-rc-release-e-portale-di-sviluppo.md
# (22-11-2026). An rc is what gets collaudata before a release, so it is built
# with the release profile (thin LTO, one codegen unit: what the PX30 will run)
# and always for all three products:
#   arm64    the panel image (build_container.sh)
#   amd64    the cloud gateway and the PC image (build_container_x86_64.sh)
#   tiny-ty  the Tiny TY package, armv7 (pacchetto_tiny_ty.sh)
# The SPA and the vendored-patch check are done once, then the three legs run in
# parallel, each with its own log in tmp/. A leg whose Rust has not changed
# since its last build reuses its binaries (the version is not compiled in since
# part 1), so an rc that changes only the IDE takes minutes.
#
# The version is the `VERSION` file (scripts/versione.sh). It must be an rc or a
# release: a -dev goes through build_dev.sh. With --push the commit must be on
# release/X.Y and carry the version's tag (scripts/lib_build.sh), and each
# moving tag (rc-*, latest-*, dev-*) moves only if this version is the newest of
# its channel.
#
# Usage:
#   ./scripts/build_rc.sh                 build the three, archives in dist/
#   ./scripts/build_rc.sh --push          ...and publish the images
#   ./scripts/build_rc.sh --solo arm64    one leg (repeatable: --solo arm64 --solo amd64)
#   ./scripts/build_rc.sh --no-save       no image archives in dist/
# Environment: SWS_FORZA_RUST=1 recompiles the Rust even if unchanged.
#
# The Tiny TY package is published afterwards, as before:
#   ./scripts/publish_tiny_ty_package.sh dist/sws-<versione>-tiny-ty-armv7.tar.gz
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib_build.sh
. "$SCRIPT_DIR/lib_build.sh"

PUSH=(); SAVE=(); SOLO=()
while [ $# -gt 0 ]; do
    case "$1" in
        --push)    PUSH=(--push); shift ;;
        --no-save) SAVE=(--no-save); shift ;;
        --solo)    SOLO+=("$2"); shift 2 ;;
        -h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "argomento sconosciuto: $1 (--help)" >&2; exit 2 ;;
    esac
done
[ ${#SOLO[@]} -gt 0 ] || SOLO=(arm64 amd64 tiny-ty)

"$REPO/scripts/versione.sh" --controlla
VERSIONE="$("$REPO/scripts/versione.sh")"
case "$VERSIONE" in
    *-dev.*) echo "ERRORE: $VERSIONE è una dev: si costruisce con scripts/build_dev.sh." >&2; exit 1 ;;
esac
if [ ${#PUSH[@]} -gt 0 ]; then controlla_pubblicazione "$VERSIONE"; fi

echo "==> $VERSIONE — rc/release, profilo release: ${SOLO[*]}"
T0="$(date +%s)"
echo "==> SPA (una volta per tutte le gambe)"
[ -d "$REPO/sws-editor/node_modules" ] || (cd "$REPO/sws-editor" && pnpm install)
(cd "$REPO/sws-editor" && pnpm build > "$REPO/tmp/build-$VERSIONE-spa.log" 2>&1) \
    || { echo "ERRORE: pnpm build (tmp/build-$VERSIONE-spa.log)" >&2; exit 1; }
"$REPO/scripts/check_vendor_patches.sh" >/dev/null || {
    echo "ERRORE: patch al codice vendorizzato mancanti: ./scripts/check_vendor_patches.sh --apply" >&2; exit 1; }

GAMBE=()
for g in "${SOLO[@]}"; do
    case "$g" in
        arm64)   GAMBE+=(arm64   "scripts/build_container.sh --no-spa ${PUSH[*]-} ${SAVE[*]-}") ;;
        amd64)   GAMBE+=(amd64   "scripts/build_container_x86_64.sh --no-spa ${PUSH[*]-} ${SAVE[*]-}") ;;
        tiny-ty) GAMBE+=(tiny-ty "scripts/pacchetto_tiny_ty.sh --no-spa") ;;
        *) echo "ERRORE: gamba sconosciuta «$g» (arm64, amd64, tiny-ty)" >&2; exit 2 ;;
    esac
done
esito=0
esegui_gambe "$VERSIONE" "${GAMBE[@]}" || esito=1
T1="$(date +%s)"
echo "==> $VERSIONE: $(( (T1 - T0) / 60 )) min $(( (T1 - T0) % 60 )) s in tutto"
[ "$esito" -eq 0 ] || { echo "ERRORE: una gamba è fallita, guarda il suo log." >&2; exit 1; }
