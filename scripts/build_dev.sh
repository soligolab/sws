#!/usr/bin/env bash
#
# The build of a dev version (X.Y.Z-dev.N): the everyday one.
#
# Part 2 of the plan docs/plans/2026-11-22-dev-rc-release-e-portale-di-sviluppo.md
# (22-11-2026). The maintainer: «introdurre la dev e usare i multicore per rust,
# le performance e bugfix le sistemiamo nelle rc». So a dev:
#   - is built with the `dev-image` cargo profile (no LTO, 16 codegen units,
#     incremental): all the cores, minutes instead of a quarter of an hour;
#   - builds only amd64 by default (the cloud gateway), arm64 and the Tiny TY
#     when a panel is to try it;
#   - reuses the binaries when the Rust has not changed since the last dev
#     (the version is not compiled in), so a dev that changes only the IDE is
#     the SPA plus the image.
# Performance is NOT what a dev is for: that is measured on the rc.
#
# The version is the `VERSION` file and must be a -dev
# (`scripts/versione.sh --imposta 2.27.0-dev.N`). With --push the commit must be
# on main and carry the version's tag (SWS_BUILD_FUORI_RAMO=1 for a branch to be
# collaudato before the squash); the moving tag is dev-<arch>.
#
# Usage:
#   ./scripts/build_dev.sh                    amd64
#   ./scripts/build_dev.sh --arm64            amd64 and arm64
#   ./scripts/build_dev.sh --tiny-ty          amd64 and the Tiny TY package
#   ./scripts/build_dev.sh --tutte            all three
#   ./scripts/build_dev.sh --solo arm64       only that leg
#   ./scripts/build_dev.sh --push             publish the images (dev-<arch>)
#   ./scripts/build_dev.sh --save             also the image archives in dist/ (off by default)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib_build.sh
. "$SCRIPT_DIR/lib_build.sh"

PUSH=(); SAVE=(--no-save); GAMBE_SCELTE=(amd64); SOLO=0
while [ $# -gt 0 ]; do
    case "$1" in
        --push)    PUSH=(--push); shift ;;
        --save)    SAVE=(); shift ;;
        --arm64)   GAMBE_SCELTE+=(arm64); shift ;;
        --tiny-ty) GAMBE_SCELTE+=(tiny-ty); shift ;;
        --tutte)   GAMBE_SCELTE=(amd64 arm64 tiny-ty); shift ;;
        --solo)    [ "$SOLO" -eq 1 ] || GAMBE_SCELTE=(); SOLO=1; GAMBE_SCELTE+=("$2"); shift 2 ;;
        -h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "argomento sconosciuto: $1 (--help)" >&2; exit 2 ;;
    esac
done

"$REPO/scripts/versione.sh" --controlla
VERSIONE="$("$REPO/scripts/versione.sh")"
case "$VERSIONE" in
    *-dev.*) ;;
    *) echo "ERRORE: $VERSIONE non è una dev: rc e release si costruiscono con scripts/build_rc.sh." >&2; exit 1 ;;
esac
if [ ${#PUSH[@]} -gt 0 ]; then controlla_pubblicazione "$VERSIONE"; fi

echo "==> $VERSIONE — dev, profilo dev-image: ${GAMBE_SCELTE[*]}"
T0="$(date +%s)"
echo "==> SPA"
[ -d "$REPO/sws-editor/node_modules" ] || (cd "$REPO/sws-editor" && pnpm install)
(cd "$REPO/sws-editor" && pnpm build > "$REPO/tmp/build-$VERSIONE-spa.log" 2>&1) \
    || { echo "ERRORE: pnpm build (tmp/build-$VERSIONE-spa.log)" >&2; exit 1; }
"$REPO/scripts/check_vendor_patches.sh" >/dev/null || {
    echo "ERRORE: patch al codice vendorizzato mancanti: ./scripts/check_vendor_patches.sh --apply" >&2; exit 1; }

GAMBE=()
for g in "${GAMBE_SCELTE[@]}"; do
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
