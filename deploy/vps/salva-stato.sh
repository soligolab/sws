#!/bin/bash
# Archivio datato dello STATO della macchina: certificati e dati di Portainer.
# NON la configurazione: quella sta in git, nel repo SWS sotto deploy/vps/.
#
# Perche solo lo stato: acme.json contiene la chiave privata dei certificati e
# il database di Portainer le credenziali, quindi in git non ci possono andare.
# Ma valgono poco: i certificati si riottengono in trenta secondi e Portainer
# ha un utente e due impostazioni. Il valore vero e la configurazione.
set -euo pipefail
DEST=~/sws-vps/archivi
NOME="stato-$(date +%Y-%m-%d).tar.gz"
tar czf "$DEST/$NOME" -C ~/sws-vps acme-json-copia portainer-dati 2>/dev/null || {
  cp ~/sws-vps/traefik/acme.json ~/sws-vps/acme-json-copia
  tar czf "$DEST/$NOME" -C ~/sws-vps acme-json-copia portainer-dati
  rm -f ~/sws-vps/acme-json-copia
}
chmod 600 "$DEST/$NOME"
# tiene 14 giorni
find "$DEST" -name "stato-*.tar.gz" -mtime +14 -delete
echo "$(date -Is) salvato $NOME ($(du -h "$DEST/$NOME" | cut -f1))"
