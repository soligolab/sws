# shellcheck shell=bash
# What the three image builds (build_container.sh, build_container_x86_64.sh,
# build_armv7.sh) share since 22-11-2026: part 2 of the plan
# docs/plans/2026-11-22-dev-rc-release-e-portale-di-sviluppo.md.
#
#   profilo_cargo VERSION          dev-image for a -dev, release for rc and release
#   impronta_rust GAMBA PROFILO BUILDER
#                                  a hash of everything the Rust build depends on
#   rust_aggiornato FILE IMPRONTA  true when FILE holds IMPRONTA (nothing to compile)
#   segna_rust FILE IMPRONTA       write it, after a build that succeeded
#   controlla_pubblicazione VERSION
#                                  refuse a push from the wrong branch or an untagged HEAD
#   tag_mobili VERSION ARCH        the moving tags (rc-arm64, dev-amd64…) this push moves
#
# Sourced, not run. Needs $REPO.

# The profile comes from the version and from nothing else: an rc or a release
# built with the light profile would be collaudata with performance it does not
# have on the PX30.
profilo_cargo() {
    case "$1" in
        *-dev.*) echo "dev-image" ;;
        *)       echo "release" ;;
    esac
}

# Everything the binaries depend on, cheaply: the tree hash of sws-runtime at
# HEAD (sources, Cargo.toml, Cargo.lock, vendored code, .cargo/config.toml), the
# builder's Containerfile (toolchain, sysroot), and — on a dirty tree, which is
# allowed without --push — the uncommitted changes and untracked files under
# sws-runtime. The version is not in it: since part 1 it is read at start-up
# (SWS_VERSION), so a new -dev.N or -rc.N with the same Rust reuses the binaries.
impronta_rust() {
    local gamba="$1" profilo="$2" builder="$3"
    {
        echo "$gamba $profilo"
        git -C "$REPO" rev-parse HEAD:sws-runtime
        sha256sum < "$builder"
        git -C "$REPO" diff HEAD -- sws-runtime
        git -C "$REPO" ls-files -o --exclude-standard -- sws-runtime \
            | while read -r f; do echo "$f"; sha256sum < "$REPO/$f"; done
    } | sha256sum | cut -c1-16
}

rust_aggiornato() { [ -f "$1" ] && [ "$(cat "$1")" = "$2" ]; }
segna_rust()      { printf '%s\n' "$2" > "$1"; }

# A push publishes an image others install: it must come from the right branch
# and from a commit that carries the version's tag (the tag is what makes the
# image traceable, and check_release_coerente.sh wants it on origin).
#   -dev        from main;
#   -rc, final  from release/X.Y, X.Y being the version's.
# SWS_BUILD_FUORI_RAMO=1 lets a build go from another branch — the first dev of
# a branch not merged yet, to be collaudata before the squash — and says so.
controlla_pubblicazione() {
    local v="$1" ramo atteso
    ramo="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
    case "$v" in
        *-dev.*) atteso="main" ;;
        *)       atteso="release/$(echo "$v" | cut -d. -f1,2)" ;;
    esac
    if [ "$ramo" != "$atteso" ]; then
        if [ "${SWS_BUILD_FUORI_RAMO:-0}" = "1" ]; then
            echo "    avviso: $v si pubblica da $ramo, non da $atteso (SWS_BUILD_FUORI_RAMO=1)" >&2
        else
            echo "ERRORE: $v si pubblica da $atteso, e questo è $ramo." >&2
            echo "        (una dev da un ramo da collaudare prima dello squash: SWS_BUILD_FUORI_RAMO=1)" >&2
            return 1
        fi
    fi
    if ! git -C "$REPO" tag --points-at HEAD | grep -qx "$v"; then
        echo "ERRORE: HEAD non porta il tag $v: git tag $v, poi la build (HOWTO §19)." >&2
        return 1
    fi
}

# The moving tags of a channel must point at the newest version it admits, or a
# panel reads «newer version available» and its update pulls an older image.
# The registry decides (scripts/registro.py): an rc of 2.26 built after a dev of
# 2.27 moves rc-<arch> but not dev-<arch>. A registry that does not answer moves
# nothing, rather than moving blindly.
tag_mobili() {
    local v="$1" arch="$2" canali=() c tags
    case "$v" in
        *-dev.*) canali=(dev) ;;
        *-rc.*)  canali=(rc dev) ;;
        *)       canali=(stabile rc dev) ;;
    esac
    tags="$(python3 "$REPO/scripts/registro.py" tags)" || { echo "    avviso: registry illeggibile, nessun tag mobile spostato" >&2; return 0; }
    for c in "${canali[@]}"; do
        if python3 -c "
import sys; sys.path.insert(0, '$REPO/scripts'); import registro as r
sys.exit(0 if r.piu_nuova('$v', '$arch', '$c', sys.stdin.read().split()) else 1)" <<<"$tags"; then
            case "$c" in
                stabile) echo "latest-$arch" ;;
                *)       echo "$c-$arch" ;;
            esac
        else
            echo "    $c-$arch resta dov'è: nel registry c'è una versione più nuova di $v" >&2
        fi
    done
}

# The aarch64 builder's first stage (the arm64 sysroot) had no name: the final
# builder copies from it without descending from it, so it stayed «dangling» and
# `podman image prune` removed it — the next build redid 19 minutes of apt
# (seen again on 22-11-2026, rc.26). Building that stage with a name keeps it.
nomina_stadio_sysroot() {
    local containerfile="$1" nome="$2" piattaforma="$3"
    podman build --platform "$piattaforma" --network host --target sysroot -t "$nome" \
        -f "$containerfile" "$(dirname "$containerfile")"
}

# Run the legs of a build side by side (22-11-2026). Each leg is a name and a
# command; each writes its own log, tmp/build-<version>-<leg>.log. A leg that
# fails does not stop the others — their work is still good, and the next run
# reuses it — but the function returns 1, and the caller moves nothing more.
# Measured on 22-11-2026 (rc.26, 4 cores): arm64 and the Tiny TY together cost
# each other little, because most of a Rust build is the single-core link.
esegui_gambe() {
    local versione="$1"; shift
    local nomi=() pid=() inizio=() log n i esito=0 fine
    mkdir -p "$REPO/tmp"
    while [ $# -ge 2 ]; do
        n="$1"; log="$REPO/tmp/build-$versione-$n.log"
        echo "==> $n: $2"
        echo "    log: tmp/build-$versione-$n.log"
        ( cd "$REPO" && eval "$2" ) > "$log" 2>&1 &
        nomi+=("$n"); pid+=("$!"); inizio+=("$(date +%s)")
        shift 2
    done
    for i in "${!pid[@]}"; do
        if wait "${pid[$i]}"; then r="ok"; else r="FALLITA"; esito=1; fi
        fine="$(date +%s)"
        printf '    %-8s %-8s %3d min %02d s   (tmp/build-%s-%s.log)\n' "${nomi[$i]}" "$r" \
            $(( (fine - inizio[i]) / 60 )) $(( (fine - inizio[i]) % 60 )) "$versione" "${nomi[$i]}"
    done
    return "$esito"
}
