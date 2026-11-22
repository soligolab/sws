#!/usr/bin/env bash
# The product version: read it, check it, set it.
#
# Since 22-11-2026 (plan docs/plans/2026-11-22-dev-rc-release-e-portale-di-sviluppo.md,
# part 1) the version of SWS lives in ONE file, `VERSION` at the repo root:
# `2.27.0-dev.3`, `2.26.0-rc.27`, `2.26.0`. It reaches the runtime from outside
# the binary (`SWS_VERSION`: the image's ENV, the Tiny TY launch scripts, the
# native start scripts), so a new `-dev.N` or `-rc.N` no longer recompiles every
# `sws-*` crate. The other files follow it:
#   - sws-editor/package.json      the full version (the SPA shows it);
#   - the three Cargo.toml          only the release number (`2.27.0`): cargo
#     hashes the package version into each crate, so it changes only when the
#     release changes.
#
# Usage:
#   scripts/versione.sh                 print the version (from VERSION)
#   scripts/versione.sh --base          print the release number (2.27.0-dev.3 → 2.27.0)
#   scripts/versione.sh --controlla     exit 1, saying why, if the files disagree
#   scripts/versione.sh --imposta X     write X into VERSION and the files that follow it
#                                       (then `cargo check` to update Cargo.lock)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$REPO/VERSION"
CARGO_FILES=(
    "$REPO/sws-runtime/Cargo.toml"
    "$REPO/sws-runtime/crates/sws-kiosk/Cargo.toml"
    "$REPO/sws-runtime/crates/sws-lvgl-viewer/Cargo.toml"
)
PACKAGE="$REPO/sws-editor/package.json"
FORMA='^[0-9]+\.[0-9]+\.[0-9]+(-(dev|rc)\.[0-9]+)?$'

leggi()  { tr -d '[:space:]' < "$FILE"; }
base()   { printf '%s\n' "${1%%-*}"; }
cargo_v() { grep -m1 -oP '^version\s*=\s*"\K[^"]+' "$1"; }
pkg_v()  { grep -m1 -oP '"version"\s*:\s*"\K[^"]+' "$PACKAGE"; }

controlla() {
    local v b rossi=0 f
    [ -f "$FILE" ] || { echo "manca $FILE"; return 1; }
    v="$(leggi)"
    [[ "$v" =~ $FORMA ]] || { echo "VERSION dice «$v»: non è X.Y.Z, X.Y.Z-dev.N o X.Y.Z-rc.N"; return 1; }
    b="$(base "$v")"
    for f in "${CARGO_FILES[@]}"; do
        [ "$(cargo_v "$f")" = "$b" ] || { echo "${f#"$REPO"/} dice $(cargo_v "$f"), deve dire $b (il numero della release di $v)"; rossi=1; }
    done
    [ "$(pkg_v)" = "$v" ] || { echo "sws-editor/package.json dice $(pkg_v), deve dire $v"; rossi=1; }
    return "$rossi"
}

case "${1:-}" in
    "")          leggi; echo ;;
    --base)      base "$(leggi)" ;;
    --controlla) controlla ;;
    --imposta)
        v="${2:-}"
        [[ "$v" =~ $FORMA ]] || { echo "ERRORE: «$v» non è X.Y.Z, X.Y.Z-dev.N o X.Y.Z-rc.N" >&2; exit 2; }
        printf '%s\n' "$v" > "$FILE"
        b="$(base "$v")"
        for f in "${CARGO_FILES[@]}"; do sed -i -E "0,/^version\s*=\s*\"[^\"]+\"/s//version = \"$b\"/" "$f"; done
        sed -i -E "0,/\"version\"\s*:\s*\"[^\"]+\"/s//\"version\": \"$v\"/" "$PACKAGE"
        controlla
        echo "versione: $v (Cargo.toml: $b). Ora \`cargo check\` per aggiornare Cargo.lock se il numero della release è cambiato."
        ;;
    -h|--help)   sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
    *)           echo "ERRORE: argomento sconosciuto «$1» (--help)" >&2; exit 2 ;;
esac
