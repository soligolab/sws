#!/bin/bash
# Copia giornaliera dei DATI del servizio: account (identita.db, audit, posta,
# pannelli) e progetti. Tiene 30 giorni. Decisione del maintainer del
# 10-11-2026, scritta anche nell'informativa privacy («copie automatiche
# giornaliere, conservate 30 giorni»): fino a quel giorno `salva-stato.sh`
# salvava solo certificati e Portainer, e gli utenti esistevano in un posto solo.
#
# Come lavora, e perche:
# - una cartella per giorno, `backup-dati/AAAA-MM-GG/`. I file che non sono
#   cambiati dal giorno prima sono **link fisici** a quelli di ieri
#   (`rsync --link-dest`): trenta giorni costano poco piu' di uno, anche con i
#   522 MB di storico vecchio di CasaDomotica che non cambia mai;
# - i database SQLite **vivi** (quelli con accanto un `-wal`) non si copiano col
#   file: una copia del file mentre il runtime scrive puo' essere incoerente, e
#   le ultime scritture stanno nel `-wal`. Si copiano con l'API di backup di
#   SQLite (python3), che legge un'istantanea coerente senza fermare nessuno;
# - si scrive in `AAAA-MM-GG.parziale` e si rinomina alla fine: una copia
#   interrotta non diventa mai la base di quella dopo;
# - via le cartelle piu' vecchie di 30 giorni, per nome (la data e' nel nome).
#
# La seconda copia su un server remoto e' un seme:
# docs/plans/semi/2026-11-10-backup-su-un-secondo-server.md.
set -euo pipefail
BASE=~/sws-vps
DEST=$BASE/backup-dati
GIORNI=30
OGGI=$(date -u +%Y-%m-%d)
mkdir -p "$DEST"; chmod 700 "$DEST"
LAVORO="$DEST/$OGGI.parziale"
rm -rf "$LAVORO"

ULTIMO=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' ! -name "$OGGI" | sort | tail -1)
LINK=()
[ -n "$ULTIMO" ] && LINK=(--link-dest="$ULTIMO")

rsync -a "${LINK[@]}" --exclude='*.db-wal' --exclude='*.db-shm' \
  "$BASE/gateway-config" "$BASE/progetti" "$LAVORO/"

# I database vivi: un'istantanea coerente al posto del file copiato.
VIVI=0
while IFS= read -r -d '' wal; do
  db="${wal%-wal}"
  rel="${db#$BASE/}"
  dst="$LAVORO/$rel"
  rm -f "$dst"
  python3 - "$db" "$dst" <<'PY'
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True, timeout=30)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close(); src.close()
PY
  VIVI=$((VIVI + 1))
done < <(find "$BASE/gateway-config" "$BASE/progetti" -name '*.db-wal' -print0)

FINALE="$DEST/$OGGI"
rm -rf "$FINALE"
mv "$LAVORO" "$FINALE"

# Trenta giorni, contati sul nome della cartella.
LIMITE=$(date -u -d "-$GIORNI days" +%Y-%m-%d)
for d in "$DEST"/20??-??-??; do
  [ -d "$d" ] || continue
  [[ "$(basename "$d")" < "$LIMITE" ]] && rm -rf "$d"
done

TOT=$(du -sh "$DEST" | cut -f1)
NUOVO=$(du -sh "$FINALE" | cut -f1)
echo "$(date -Is) copia $OGGI fatta: $VIVI database vivi, $(ls -d "$DEST"/20??-??-?? | wc -l) giorni tenuti, oggi $NUOVO apparente, tutto $TOT su disco"
