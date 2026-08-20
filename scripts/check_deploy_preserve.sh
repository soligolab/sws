#!/usr/bin/env bash
# Il deploy conserva il database del dispositivo?
#
# Due runtime veri: SORGENTE (l'IDE) e TARGET (il dispositivo). Sul target si
# crea lo stesso progetto, gli si mette dentro uno storico riconoscibile e un
# users.yaml proprio, poi si fa il deploy dalla sorgente e si guarda cosa
# sopravvive. Lo storico è l'unica cosa in un progetto che non si può ricreare.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
SCR="${TMPDIR:-/tmp}/sws-check-deploy-preserve"
SRC_PORT=8571
TGT_PORT=8573
rm -rf "$SCR"; mkdir -p "$SCR"/src/{config,projects} "$SCR"/tgt/{config,projects}

start() {  # $1=dir $2=porta
  "$BIN" --config "$SCR/$1/config" --projects-root "$SCR/$1/projects" \
    --templates-root "$REPO/examples/templates" --admin-port "$2" \
    > "$SCR/$1.log" 2>&1 &
  echo $!
}
SRC_PID=$(start src "$SRC_PORT"); TGT_PID=$(start tgt "$TGT_PORT")
trap 'kill -TERM "$SRC_PID" "$TGT_PID" 2>/dev/null' EXIT
sleep 8

S="http://localhost:$SRC_PORT/api"
T="http://localhost:$TGT_PORT/api"

echo "=== preparazione ==="
# Stesso nome sui due lati: è il caso del maintainer, ridistribuire un progetto.
for pair in "$S src" "$T tgt"; do
  set -- $pair
  curl -s -X POST "$1/projects" -H 'Content-Type: application/json' -d '{"name":"impianto"}' >/dev/null
  curl -s -X POST "$1/projects/impianto/open" >/dev/null
done

# Storico riconoscibile sul TARGET (quello che il deploy non deve toccare).
TGT_DB="$SCR/tgt/projects/impianto/history/historian.db"
mkdir -p "$(dirname "$TGT_DB")"
python3 - "$TGT_DB" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS samples (tag TEXT, ts_ms INTEGER, value REAL, quality INTEGER)")
c.executemany("INSERT INTO samples VALUES (?,?,?,?)",
              [("temperatura", 1700000000000 + i * 1000, 20.0 + i, 0) for i in range(500)])
c.commit()
print(f"  storico sul target: {c.execute('SELECT COUNT(*) FROM samples').fetchone()[0]} campioni")
PY
# Backup, ricette e utenti locali del dispositivo.
mkdir -p "$SCR/tgt/projects/impianto/backups/2026-01-01T00-00-00Z" "$SCR/tgt/projects/impianto/recipes"
echo "ricetta: locale" > "$SCR/tgt/projects/impianto/recipes/mia.yaml"
cat > "$SCR/tgt/projects/impianto/users.yaml" <<'EOF'
users:
  - username: operatore_dispositivo
    password_hash: "$argon2id$v=19$m=19456,t=2,p=1$finto$finto"
    role: Operator
EOF
# Utente diverso nel progetto della SORGENTE → deve produrre l'avviso.
cat > "$SCR/src/projects/impianto/users.yaml" <<'EOF'
users:
  - username: admin_ide
    password_hash: "$argon2id$v=19$m=19456,t=2,p=1$finto$finto"
    role: Admin
EOF
# Una pagina in più sulla sorgente, per vedere che il progetto si aggiorna davvero.
curl -s -o /dev/null -w "  PUT synoptics=%{http_code}\n" -X PUT "$S/synoptics/Pagina%20Nuova" \
  -H 'Content-Type: application/json' \
  -d '{"id":"pagina-nuova","name":"Pagina Nuova","objects":[]}'

echo "=== stato del target PRIMA del deploy ==="
before_samples=$(python3 -c "
import sqlite3;print(sqlite3.connect('$TGT_DB').execute('SELECT COUNT(*) FROM samples').fetchone()[0])")
echo "  campioni: $before_samples"
echo "  users.yaml: $(grep -c username "$SCR/tgt/projects/impianto/users.yaml") utente(i) → $(grep username "$SCR/tgt/projects/impianto/users.yaml" | sed 's/.*: //')"
echo "  contenuto cartella: $(ls -A "$SCR/tgt/projects/impianto" | tr '\n' ' ')"

echo "  pagine sulla sorgente: $(ls "$SCR/src/projects/impianto/synoptics/" 2>/dev/null | tr '\n' ' ')"
echo "  /api/auth/users sul target (serve all'avviso): $(curl -s -o /dev/null -w '%{http_code}' "$T/auth/users") → $(curl -s "$T/auth/users" | head -c 120)"

echo "=== connetti la sorgente al target e deploya ==="
curl -s -X POST "$S/remote/connect" -H 'Content-Type: application/json' \
  -d "{\"url\":\"http://localhost:$TGT_PORT\",\"username\":\"\",\"password\":\"\"}" | head -c 200; echo
curl -s -N -X POST "$S/remote/deploy" 2>&1 | sed 's/^/  /'

echo "=== stato del target DOPO il deploy ==="
if [ -f "$TGT_DB" ]; then
  after_samples=$(python3 -c "
import sqlite3;print(sqlite3.connect('$TGT_DB').execute('SELECT COUNT(*) FROM samples').fetchone()[0])")
else
  after_samples="DB ASSENTE"
fi
echo "  campioni: $after_samples   (prima: $before_samples)"
echo "  users.yaml: $(grep username "$SCR/tgt/projects/impianto/users.yaml" 2>/dev/null | sed 's/.*: //' || echo ASSENTE)"
echo "  ricette: $(cat "$SCR/tgt/projects/impianto/recipes/mia.yaml" 2>/dev/null || echo ASSENTI)"
echo "  backups presente: $([ -d "$SCR/tgt/projects/impianto/backups" ] && echo sì || echo NO)"
echo "  pagine sul target: $(ls "$SCR/tgt/projects/impianto/synoptics/" 2>/dev/null | tr '\n' ' ')"
echo
echo "=== esito ==="
[ "$after_samples" = "$before_samples" ] && echo "  ✓ storico conservato" || echo "  ✗ STORICO PERDUTO ($before_samples → $after_samples)"
grep -q operatore_dispositivo "$SCR/tgt/projects/impianto/users.yaml" 2>/dev/null \
  && echo "  ✓ utenti del dispositivo conservati" || echo "  ✗ utenti del dispositivo sovrascritti"
ls "$SCR/tgt/projects/impianto/synoptics/" 2>/dev/null | grep -qi "nuova" \
  && echo "  ✓ pagine aggiornate dal deploy" || echo "  ✗ pagine NON aggiornate"

echo "=== 2. utenti: dispositivo con account + connessione senza credenziali → deve rifiutare ==="
echo -n "  risposta: "; curl -s -X POST "$S/remote/users" | head -c 200; echo
grep -q operatore_dispositivo "$SCR/tgt/projects/impianto/users.yaml" 2>/dev/null \
  && echo "  ✓ nulla è stato cambiato sul dispositivo" || echo "  ✗ account del dispositivo alterati"

echo "=== 3. rifiuto di una lista vuota (lascerebbe il dispositivo senza account) ==="
cp "$SCR/src/projects/impianto/users.yaml" "$SCR/src/users.yaml.bak"
printf 'users: []\n' > "$SCR/src/projects/impianto/users.yaml"
echo -n "  risposta: "; curl -s -X POST "$S/remote/users" | head -c 160; echo
before=$(grep -c username "$SCR/tgt/projects/impianto/users.yaml" 2>/dev/null || echo 0)
[ "$before" -gt 0 ] && echo "  ✓ il dispositivo ha ancora i suoi account ($before)" || echo "  ✗ account persi"
cp "$SCR/src/users.yaml.bak" "$SCR/src/projects/impianto/users.yaml"

echo "=== 4. percorso felice: dispositivo senza account → invio consentito ==="
# Si toglie users.yaml dal target e si riapre il progetto: il runtime torna in
# no-auth, che è la condizione in cui il pulsante serve davvero (primo
# allineamento di un dispositivo nuovo).
rm -f "$SCR/tgt/projects/impianto/users.yaml"
curl -s -X POST "$T/projects/impianto/open" >/dev/null; sleep 1
echo -n "  invio: "; curl -s -X POST "$S/remote/users" | head -c 200; echo
echo "  users.yaml sul target ora: $(grep username "$SCR/tgt/projects/impianto/users.yaml" 2>/dev/null | sed 's/.*: //' | tr '\n' ' ')"
grep -q admin_ide "$SCR/tgt/projects/impianto/users.yaml" 2>/dev/null \
  && echo "  ✓ utenti allineati su richiesta esplicita" || echo "  ✗ allineamento non avvenuto"
