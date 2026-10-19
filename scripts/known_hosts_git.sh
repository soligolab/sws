#!/usr/bin/env bash
#
# Rigenera deploy/container/ssh_known_hosts: le chiavi pubbliche ufficiali di
# GitHub, GitLab e Bitbucket, che l'immagine installa in /etc/ssh/ssh_known_hosts
# perché il git dei progetti si fidi di loro senza «fiducia al primo contatto»
# (piano docs/archive/2026-10-15-git-nel-cloud.md).
#
# Le fonti sono autenticate da HTTPS, non da un primo contatto:
#   - GitHub:    https://api.github.com/meta (campo ssh_keys)
#   - Bitbucket: https://bitbucket.org/site/ssh
#   - GitLab:    non pubblica le chiavi intere, solo le impronte
#                (https://docs.gitlab.com/user/gitlab_com/): si fa lo scan e lo si
#                accetta SOLO se ogni impronta è fra quelle pubblicate.
#
# Uso: ./scripts/known_hosts_git.sh   (poi rivedere il diff e committare)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=deploy/container/ssh_known_hosts
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

curl -fsS https://api.github.com/meta \
  | python3 -c "import json,sys; print('\n'.join('github.com '+k for k in json.load(sys.stdin)['ssh_keys']))" > "$tmp/github"
curl -fsS https://bitbucket.org/site/ssh > "$tmp/bitbucket"
ssh-keyscan -T 10 gitlab.com 2>/dev/null | grep -v '^#' > "$tmp/gitlab"
pubblicate=$(curl -fsS https://docs.gitlab.com/user/gitlab_com/ | grep -o 'SHA256:[A-Za-z0-9+/]\{43\}' | sort -u)
[ -n "$pubblicate" ] || { echo "impronte GitLab non trovate nella documentazione" >&2; exit 1; }
while read -r riga; do
  imp=$(echo "$riga" | ssh-keygen -lf - | awk '{print $2}')
  echo "$pubblicate" | grep -qx "$imp" || { echo "gitlab.com: impronta $imp NON pubblicata — non la scrivo" >&2; exit 1; }
done < "$tmp/gitlab"

for f in github gitlab bitbucket; do
  [ -s "$tmp/$f" ] || { echo "nessuna chiave per $f" >&2; exit 1; }
done
{
  echo "# Chiavi SSH ufficiali dei servizi git, per /etc/ssh/ssh_known_hosts dell'immagine."
  echo "# Generato da scripts/known_hosts_git.sh il $(date -u +%F) — non modificare a mano."
  sort "$tmp/github"; sort "$tmp/gitlab"; sort "$tmp/bitbucket"
} > "$OUT"
echo "scritto $OUT:"; ssh-keygen -lf "$OUT"
