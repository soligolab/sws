#!/usr/bin/env bash
# Pubblica il manuale su sws.soligo.net/manuale/ (piano manuale pubblico, M2, 12-11-2026).
# Genera il sito (genera_sito.sh), lo copia sul VPS accanto al vecchio e scambia le cartelle in un colpo,
# così nessuno vede un sito a metà; poi copia configurazione e robots.txt. Si lancia a ogni release,
# a sé e non dentro build_containers_all.sh (HOWTO §5).
# sws-manuale is always restarted at the end (18-11-2026): its bind mounts hold on to the inodes they
# found at start, so after the swap nginx kept serving the old folder, already deleted (403 on
# /manuale/, 404 on every page), and the old nginx.conf and robots.txt too. A restart takes a second.
# Uso: ./scripts/manuale/pubblica.sh [utente@host]   (predefinito debian@37.187.181.142)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VPS="${1:-debian@37.187.181.142}"
"$REPO/scripts/manuale/genera_sito.sh"
ARCHIVIO="$REPO/tmp/manuale-sito.tgz"
tar czf "$ARCHIVIO" -C "$REPO/tmp/manuale-sito" .
scp -q "$ARCHIVIO" "$REPO/deploy/vps/manuale/nginx.conf" "$REPO/deploy/vps/manuale/robots.txt" "$VPS:/tmp/"
ssh -o BatchMode=yes "$VPS" 'set -e
M=~/sws-vps/manuale; mkdir -p $M
rm -rf $M/sito.nuovo && mkdir $M/sito.nuovo && tar xzf /tmp/manuale-sito.tgz -C $M/sito.nuovo
[ -d $M/sito ] && mv $M/sito $M/sito.vecchio; mv $M/sito.nuovo $M/sito; rm -rf $M/sito.vecchio
mv /tmp/nginx.conf $M/nginx.conf; mv /tmp/robots.txt $M/robots.txt; rm -f /tmp/manuale-sito.tgz
systemctl --user restart sws-manuale && echo "sws-manuale restarted on the new folder"
echo "pubblicate $(find $M/sito -name "*.html" | wc -l) pagine"'
rm -f "$ARCHIVIO"
# What a visitor gets, not what was copied: the 18-11-2026 publication printed «pubblicate 28 pagine»
# and the site answered 403.
sleep 2
for page in manuale/ manuale/17_sicurezza.html robots.txt; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://sws.soligo.net/$page" || true)"
    [ "$code" = 200 ] || { echo "ERROR: https://sws.soligo.net/$page answers $code" >&2; exit 1; }
done
echo "the site answers 200"
