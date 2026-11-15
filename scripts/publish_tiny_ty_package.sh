#!/usr/bin/env bash
# Publishes the package of the Tiny TY on the VPS, where the install guide of
# sws.soligo.net points (decision of the maintainer, 15-11-2026: «dal VPS, a ogni
# rc, insieme alle immagini»).
#
#   scripts/publish_tiny_ty_package.sh [dist/sws-<version>-tiny-ty-armv7.tar.gz]
#
# Without an argument it takes the newest package in `dist/`. It copies the
# package to `~/sws-vps/download/tiny-ty/` on the VPS (host `sws-vps` of
# `~/.ssh/config`), writes its checksum, and points `latest.tar.gz` and
# `latest.txt` at it. The last KEEP packages stay; the older ones go.
#
# The page `/download/tiny-ty/` is served by the container `sws-manuale`
# (`deploy/vps/quadlet/sws-manuale.container`): nothing to restart here.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${SWS_VPS_HOST:-sws-vps}"
DEST='~/sws-vps/download/tiny-ty'
KEEP=5

PKG="${1:-$(ls -t "$REPO"/dist/sws-*-tiny-ty-armv7.tar.gz 2>/dev/null | head -n1)}"
[ -n "$PKG" ] && [ -f "$PKG" ] || { echo "ERROR: no package: run scripts/pacchetto_tiny_ty.sh first" >&2; exit 1; }
NAME="$(basename "$PKG")"
case "$NAME" in sws-*-tiny-ty-armv7.tar.gz) ;; *) echo "ERROR: $NAME is not a Tiny TY package" >&2; exit 1 ;; esac

# The package must open and hold what the installer needs, before it goes anywhere.
# (The list first: `grep -q` closing the pipe would make `tar` fail under pipefail.)
LIST="$(tar tzf "$PKG")"
grep -q '/install\.sh$' <<<"$LIST" || { echo "ERROR: $NAME has no install.sh" >&2; exit 1; }
SUM="$(sha256sum "$PKG" | cut -d' ' -f1)"
echo "==> $NAME  sha256 $SUM"

ssh -o IdentitiesOnly=yes "$HOST" "mkdir -p $DEST"
# Under a name that is not the final one: a download in the middle of the copy
# never gets half a package.
scp -q "$PKG" "$HOST:$DEST/$NAME.part"
ssh -o IdentitiesOnly=yes "$HOST" "set -e; cd $DEST
  mv '$NAME.part' '$NAME'
  ln -sfn '$NAME' latest.tar.gz.new && mv -Tf latest.tar.gz.new latest.tar.gz
  # The checksum names the file latest.tar.gz: that is what the guide downloads.
  printf '%s  latest.tar.gz\n' '$SUM' > latest.tar.gz.sha256
  printf '%s\n' '$NAME' > latest.txt
  chmod 644 '$NAME' latest.tar.gz.sha256 latest.txt
  # The newest KEEP stay, and always the one latest points at.
  ls -t sws-*-tiny-ty-armv7.tar.gz | tail -n +$((KEEP + 1)) | grep -vx '$NAME' | xargs -r rm -f
  ls -l"
echo "==> published: https://sws.soligo.net/download/tiny-ty/latest.tar.gz"
