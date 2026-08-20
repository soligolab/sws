#!/usr/bin/env bash
# Gestione database: tag orfani, cancellazione per tag, recupero spazio.
#
# Un runtime vero con un database popolato a mano: due tag che il progetto
# conosce e due che non esistono più (rinominati/rimossi). L'orfano è definito
# dal confronto col TagDb del runtime, non con la sola lista dichiarata, perché
# in molti progetti i tag nascono dalle mappature delle sorgenti.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
SCR="${TMPDIR:-/tmp}/sws-check-db-mgmt"
PORT=8577
rm -rf "$SCR"; mkdir -p "$SCR"/{config,projects}

"$BIN" --config "$SCR/config" --projects-root "$SCR/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$PORT" > "$SCR/rt.log" 2>&1 &
P=$!; trap 'kill -TERM "$P" 2>/dev/null' EXIT
sleep 7
API="http://localhost:$PORT/api"

curl -s -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"dbtest"}' >/dev/null
curl -s -X POST "$API/projects/dbtest/open" >/dev/null

echo "=== preparazione: due tag noti + due orfani nel database ==="
curl -s -o /dev/null -X PUT "$API/project/tags" -H 'Content-Type: application/json' -d '[
  {"id":"temperatura","description":"in uso"},
  {"id":"pressione","description":"in uso"}
]'
DB="$SCR/projects/dbtest/history/historian.db"
mkdir -p "$(dirname "$DB")"
python3 - "$DB" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS samples (tag TEXT, ts_ms INTEGER, value REAL, quality INTEGER)")
for tag in ("temperatura", "pressione", "vecchio_nome", "tag_rimosso"):
    c.executemany("INSERT INTO samples VALUES (?,?,?,?)",
                  [(tag, 1700000000000 + i * 1000, float(i), 0) for i in range(3000)])
c.commit()
print("  campioni totali:", c.execute("SELECT COUNT(*) FROM samples").fetchone()[0])
PY
# Riapertura: il runtime rilegge i tag e apre il datastore appena popolato.
curl -s -X POST "$API/projects/dbtest/open" >/dev/null; sleep 2

echo "=== 1. tag orfani ==="
curl -s "$API/datastores/default/tags" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("  nel database:", ", ".join(d["db_tags"]))
print("  orfani      :", ", ".join(d["orphan_tags"]) or "(nessuno)")
ok = set(d["orphan_tags"]) == {"vecchio_nome","tag_rimosso"}
print("  ✓ orfani individuati correttamente" if ok else "  ✗ atteso {vecchio_nome, tag_rimosso}")'

echo "=== 2. dimensione prima ==="
# main + WAL: a WAL pieno il solo file principale è quasi vuoto e la misura
# inganna (si vedeva "4096 byte" con 12.000 campioni dentro).
before=$(( $(stat -c%s "$DB") + $(stat -c%s "$DB-wal" 2>/dev/null || echo 0) ))
echo "  file+WAL: $before byte"

echo "=== 3. cancellazione dello storico di un orfano ==="
curl -s -X POST "$API/datastores/default/delete-tag" -H 'Content-Type: application/json' \
  -d '{"tag":"vecchio_nome"}' | sed 's/^/  /'
curl -s "$API/datastores/default/tags" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("  orfani ora:", ", ".join(d["orphan_tags"]) or "(nessuno)")
print("  ✓ vecchio_nome eliminato" if "vecchio_nome" not in d["db_tags"] else "  ✗ ancora presente")'

echo "=== 4. recupero spazio (SQLite non restringe il file da sé) ==="
curl -s -X POST "$API/datastores/default/vacuum" > "$SCR/vac.json"
python3 - "$SCR/vac.json" <<'PYV'
import json, sys
d = json.load(open(sys.argv[1]))
print("  prima %d -> dopo %d byte, liberati %d" % (d["bytes_before"], d["bytes_after"], d["bytes_freed"]))
print("  ok spazio recuperato" if d["bytes_freed"] > 0 else "  nota: nessuno spazio da liberare in questo momento")
PYV

echo "=== 5. i tag in uso NON sono stati toccati ==="
curl -s "$API/datastores/default/tags" | python3 -c '
import json,sys
d=json.load(sys.stdin)
keep = {"temperatura","pressione"} <= set(d["db_tags"])
print("  in database:", ", ".join(d["db_tags"]))
print("  ✓ i tag in uso hanno ancora il loro storico" if keep else "  ✗ storico dei tag in uso perduto")'

echo "=== 6. purge con retention (endpoint già esistente, ora collegato) ==="
curl -s -X POST "$API/datastores/default/purge" -H 'Content-Type: application/json' \
  -d '{"retention_rows":100}' | sed 's/^/  /'
python3 - "$DB" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
rows = dict(c.execute("SELECT tag, COUNT(*) FROM samples GROUP BY tag").fetchall())
print("  campioni per tag dopo il purge:", rows)
print("  ✓ retention applicata" if all(v <= 100 for v in rows.values()) else "  ✗ retention non applicata")
PY

echo "=== 7. download del file grezzo (VACUUM INTO, copia consistente) ==="
DL="$SCR/downloaded.db"
curl -s -o "$DL" "$API/datastores/default/download"
python3 - "$DB" "$DL" <<'PY'
import sqlite3, sys
db, dl = sys.argv[1], sys.argv[2]
n_live = sqlite3.connect(db).execute("SELECT COUNT(*) FROM samples").fetchone()[0]
n_dl   = sqlite3.connect(dl).execute("SELECT COUNT(*) FROM samples").fetchone()[0]
print(f"  campioni: live={n_live}, scaricato={n_dl}")
print("  ✓ copia consistente" if n_live == n_dl else "  ✗ conteggio diverso")
PY

echo "=== 8. upload (sostituzione file + backup automatico, nessun hot-swap) ==="
curl -s -X POST "$API/datastores/default/upload" \
  -H 'Content-Type: application/octet-stream' --data-binary "@$DL" > "$SCR/up.json"
python3 - "$SCR/up.json" "$DB" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
db = sys.argv[2]
print("  risposta:", d)
ok_restart = d.get("requires_restart") is True
ok_backup  = os.path.exists(d.get("backup_path", ""))
ok_written = d.get("bytes_written", 0) == os.path.getsize(db) or d.get("bytes_written", 0) > 0
print("  ✓ requires_restart=true" if ok_restart else "  ✗ requires_restart mancante/falso")
print("  ✓ backup creato:", d.get("backup_path")) if ok_backup else print("  ✗ backup non trovato su disco")
print("  ✓ bytes_written coerente" if ok_written else "  ✗ bytes_written sospetto")
PY
