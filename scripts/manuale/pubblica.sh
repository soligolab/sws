#!/usr/bin/env bash
# Pubblica il manuale su sws.soligo.net/manuale/ (piano manuale pubblico, M2, 12-11-2026).
# Genera il sito (genera_sito.sh), lo copia sul VPS accanto al vecchio e scambia le cartelle in un colpo,
# così nessuno vede un sito a metà; poi copia configurazione e robots.txt. Si lancia a ogni release,
# a sé e non dentro build_containers_all.sh (HOWTO §5). nginx legge i file a ogni richiesta: non serve
# riavviarlo, salvo che sia cambiata nginx.conf (allora lo si dice).
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
cambiata=0; cmp -s /tmp/nginx.conf $M/nginx.conf || cambiata=1
mv /tmp/nginx.conf $M/nginx.conf; mv /tmp/robots.txt $M/robots.txt; rm -f /tmp/manuale-sito.tgz
if [ $cambiata = 1 ] && systemctl --user is-active -q sws-manuale; then systemctl --user restart sws-manuale; echo "nginx.conf cambiata: sws-manuale riavviato"; fi
echo "pubblicate $(find $M/sito -name "*.html" | wc -l) pagine"'
rm -f "$ARCHIVIO"
