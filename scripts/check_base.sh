#!/usr/bin/env bash
#
# The runtime image starts from the SWS base image, pinned by digest.
#
# Plan docs/plans/2026-11-27-immagine-base-del-sistema.md. Before 2.28.0-dev.6
# each runtime build ran `apt-get install`: a build from another machine, or
# after a `podman system prune`, gave new system layers, and every panel
# downloaded 388 MB again (2.27.0 against 2.28.0-dev.5, measured on ghcr.io on
# 27-11-2026: even the Ubuntu layer had another digest). This guard keeps the
# three rules that prevent it:
#   1. the runtime Containerfiles have no `apt-get` and start FROM ${BASE};
#   2. deploy/container/BASE has a sws-base with a digest for each architecture;
#   3. the base Containerfiles start from Ubuntu pinned by digest.
# A base older than 90 days gives a warning, not an error (decision 3).
#
# The guard also tests itself: a copy with an `apt-get`, and a BASE without a
# digest, must make it red.
#
# Use: ./scripts/check_base.sh   (static, no stack)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bad=0
ok()   { if [ "$1" = 1 ]; then printf '  \033[32m✓\033[0m %s\n' "$2"; else printf '  \033[31m✗\033[0m %s\n' "$2"; bad=1; fi; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

DIGEST='@sha256:[0-9a-f]{64}$'

# Rule 1 on one runtime Containerfile. Prints the faults, returns 1 if any.
runtime_faults() {
    local cf="$1" f=0 first
    if grep -qE '^[^#]*apt-get' "$cf"; then echo "has apt-get: the system packages go in Containerfile.base.*"; f=1; fi
    first=$(grep -E '^[[:space:]]*FROM[[:space:]]' "$cf" | head -1 | tr -s ' ')
    case "$first" in
        'FROM ${BASE}'|'FROM $BASE') ;;
        *) echo "starts with «$first», not FROM \${BASE}"; f=1 ;;
    esac
    grep -qE '^ARG BASE[[:space:]]*$' "$cf" || { echo "no «ARG BASE» without a default"; f=1; }
    return $f
}

# Rule 2 on a BASE file.
base_faults() {
    local file="$1" f=0 arch ref
    for arch in arm64 amd64; do
        ref=$(awk -v a="$arch" '$1 == a { print $2 }' "$file")
        if [ -z "$ref" ]; then echo "no line for $arch"; f=1; continue; fi
        [[ "$ref" =~ ^ghcr\.io/soligolab/sws-base:20[0-9]{2}\.[0-9]{2}\.[0-9]+-$arch$DIGEST ]] \
            || { echo "$arch: «$ref» is not ghcr.io/soligolab/sws-base:AAAA.MM.N-$arch@sha256:<64 hex>"; f=1; }
    done
    return $f
}

printf '\033[1m── check_base ──\033[0m\n'

for cf in deploy/container/Containerfile.aarch64 deploy/container/Containerfile.x86_64; do
    if out=$(runtime_faults "$cf"); then
        ok 1 "$(basename "$cf"): FROM \${BASE}, no apt-get"
    else
        while read -r l; do ok 0 "$(basename "$cf"): $l"; done <<< "$out"
    fi
done

if out=$(base_faults deploy/container/BASE); then
    ok 1 "BASE: a sws-base with a digest for arm64 and amd64"
else
    while read -r l; do ok 0 "BASE: $l"; done <<< "$out"
fi

for cf in deploy/container/Containerfile.base.aarch64 deploy/container/Containerfile.base.x86_64; do
    if [ ! -f "$cf" ]; then ok 0 "missing $cf"; continue; fi
    from=$(grep -E '^FROM[[:space:]]' "$cf" | head -1 | awk '{print $2}')
    [[ "$from" =~ ^docker\.io/library/ubuntu:[0-9.]+$DIGEST ]] \
        && ok 1 "$(basename "$cf"): Ubuntu pinned by digest" \
        || ok 0 "$(basename "$cf"): FROM «$from» is not ubuntu pinned by digest"
done

# The age of the base: the date of the last commit that changed BASE.
when=$(git log -1 --format=%ct -- deploy/container/BASE 2>/dev/null)
if [ -n "$when" ]; then
    days=$(( ( $(date +%s) - when ) / 86400 ))
    [ "$days" -gt 90 ] && warn "the base is $days days old: consider a new one for Ubuntu's security fixes (docs/HOWTO.md §36)"
fi

# The guard tests itself.
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
{ cat deploy/container/Containerfile.aarch64; echo 'RUN apt-get update'; } > "$tmp/cf"
runtime_faults "$tmp/cf" >/dev/null && ok 0 "self-test: an apt-get in the runtime Containerfile is not seen"
sed 's/^FROM \${BASE}$/FROM docker.io\/library\/ubuntu:24.04/' deploy/container/Containerfile.aarch64 > "$tmp/cf2"
runtime_faults "$tmp/cf2" >/dev/null && ok 0 "self-test: a runtime FROM ubuntu is not seen"
sed 's/@sha256:[0-9a-f]*//' deploy/container/BASE > "$tmp/base"
base_faults "$tmp/base" >/dev/null && ok 0 "self-test: a BASE without a digest is not seen"
[ "$bad" = 0 ] && ok 1 "self-test: an apt-get, a FROM ubuntu and a BASE without a digest make the guard red"

exit $bad
