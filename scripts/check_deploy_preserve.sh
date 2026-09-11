#!/usr/bin/env bash
# Che cosa sopravvive a un deploy sul dispositivo?
#
# Due runtime veri: SORGENTE (l'IDE) e TARGET (il dispositivo). Sul target si
# crea lo stesso progetto, gli si mette dentro uno storico riconoscibile, una
# ricetta, un backup e un users.yaml proprio, poi si deploya dalla sorgente e si
# guarda cosa resta.
#
# Invariante, dall'11-09-2026: **storico, backup e ricette sopravvivono, gli
# utenti no.** Gli utenti appartengono al progetto e viaggiano col deploy come
# le pagine; lo storico è l'unica cosa in un progetto che non si può ricreare.
# L'asserzione sugli utenti è stata **rovesciata di proposito** quel giorno
# (prima pretendeva «utenti del dispositivo conservati»): chi la rilegge fra un
# mese non sta guardando una regressione. La casella «Sostituisci anche gli
# utenti» spenta è il caso 5.
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
TGT_USERS="$SCR/tgt/projects/impianto/users.yaml"
SRC_USERS="$SCR/src/projects/impianto/users.yaml"
ESITO=0
ok()   { echo "  ✓ $1"; }
ko()   { echo "  ✗ $1"; ESITO=1; }
# `users.yaml` scritto **solo su disco**: il runtime ha già aperto il progetto e
# tiene gli account in memoria, quindi resta in no-auth e accetta il deploy
# senza credenziali. Serve a provare la sola meccanica dei file. Quando invece
# il dispositivo deve *dichiarare* i suoi utenti (casi 6 e 7) si passa dalla sua
# API e ci si connette con quelle credenziali.
utente_su_disco() {  # $1=file $2=username $3=ruolo
  cat > "$1" <<EOF
users:
  - username: $2
    password_hash: "\$argon2id\$v=19\$m=19456,t=2,p=1\$finto\$finto"
    role: $3
EOF
}

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
utente_su_disco "$TGT_USERS" operatore_dispositivo Operator
# Utente diverso nel progetto della SORGENTE: è quello che deve arrivare.
utente_su_disco "$SRC_USERS" admin_ide Admin
# Una pagina in più sulla sorgente, per vedere che il progetto si aggiorna davvero.
curl -s -o /dev/null -w "  PUT synoptics=%{http_code}\n" -X PUT "$S/synoptics/Pagina%20Nuova" \
  -H 'Content-Type: application/json' \
  -d '{"id":"pagina-nuova","name":"Pagina Nuova","objects":[]}'

echo "=== stato del target PRIMA del deploy ==="
before_samples=$(python3 -c "
import sqlite3;print(sqlite3.connect('$TGT_DB').execute('SELECT COUNT(*) FROM samples').fetchone()[0])")
echo "  campioni: $before_samples"
echo "  users.yaml: $(grep username "$TGT_USERS" | sed 's/.*: //')"
echo "  contenuto cartella: $(ls -A "$SCR/tgt/projects/impianto" | tr '\n' ' ')"
echo "  pagine sulla sorgente: $(ls "$SCR/src/projects/impianto/synoptics/" 2>/dev/null | tr '\n' ' ')"

echo "=== 1. deploy con le impostazioni di default (la casella è accesa) ==="
curl -s -X POST "$S/remote/connect" -H 'Content-Type: application/json' \
  -d "{\"url\":\"http://localhost:$TGT_PORT\",\"username\":\"\",\"password\":\"\"}" | head -c 200; echo
# Nessun corpo: `Option<Json<DeployBody>>` vale «default», cioè sostituisci.
curl -s -N -X POST "$S/remote/deploy" 2>&1 | sed 's/^/  /'

echo "=== stato del target DOPO il deploy ==="
if [ -f "$TGT_DB" ]; then
  after_samples=$(python3 -c "
import sqlite3;print(sqlite3.connect('$TGT_DB').execute('SELECT COUNT(*) FROM samples').fetchone()[0])")
else
  after_samples="DB ASSENTE"
fi
echo "  campioni: $after_samples   (prima: $before_samples)"
echo "  users.yaml: $(grep username "$TGT_USERS" 2>/dev/null | sed 's/.*: //' || echo ASSENTE)"
echo "  ricette: $(cat "$SCR/tgt/projects/impianto/recipes/mia.yaml" 2>/dev/null || echo ASSENTI)"
echo "  backups presente: $([ -d "$SCR/tgt/projects/impianto/backups" ] && echo sì || echo NO)"
echo "  pagine sul target: $(ls "$SCR/tgt/projects/impianto/synoptics/" 2>/dev/null | tr '\n' ' ')"
echo
echo "=== esito del caso 1 ==="
[ "$after_samples" = "$before_samples" ] && ok "storico conservato" || ko "STORICO PERDUTO ($before_samples → $after_samples)"
[ -s "$SCR/tgt/projects/impianto/recipes/mia.yaml" ] && ok "ricette conservate" || ko "ricette perse"
[ -d "$SCR/tgt/projects/impianto/backups" ] && ok "backup conservati" || ko "backup persi"
grep -q admin_ide "$TGT_USERS" 2>/dev/null \
  && ok "utenti del progetto arrivati sul dispositivo" || ko "gli utenti del progetto NON sono arrivati"
grep -q operatore_dispositivo "$TGT_USERS" 2>/dev/null \
  && ko "l'account del dispositivo è sopravvissuto (doveva essere sostituito)" \
  || ok "l'account solo-dispositivo è stato sostituito"
ls "$SCR/tgt/projects/impianto/synoptics/" 2>/dev/null | grep -qi "nuova" \
  && ok "pagine aggiornate dal deploy" || ko "pagine NON aggiornate"

echo "=== 2. utenti: dispositivo con account + connessione senza credenziali → deve rifiutare ==="
# Si rimette un account solo-dispositivo (il caso 1 l'ha giustamente sostituito).
utente_su_disco "$TGT_USERS" operatore_dispositivo Operator
echo -n "  risposta: "; curl -s -X POST "$S/remote/users" | head -c 200; echo
grep -q operatore_dispositivo "$TGT_USERS" 2>/dev/null \
  && ok "nulla è stato cambiato sul dispositivo" || ko "account del dispositivo alterati"

echo "=== 3. rifiuto di una lista vuota (lascerebbe il dispositivo senza account) ==="
cp "$SRC_USERS" "$SCR/src/users.yaml.bak"
printf 'users: []\n' > "$SRC_USERS"
echo -n "  risposta: "; curl -s -X POST "$S/remote/users" | head -c 160; echo
rimasti=$(grep -c username "$TGT_USERS" 2>/dev/null || echo 0)
[ "$rimasti" -gt 0 ] && ok "il dispositivo ha ancora i suoi account ($rimasti)" || ko "account persi"
cp "$SCR/src/users.yaml.bak" "$SRC_USERS"

echo "=== 4. percorso felice: dispositivo senza account → invio consentito ==="
# Si toglie users.yaml dal target e si riapre il progetto: il runtime torna in
# no-auth, che è la condizione in cui il pulsante serve davvero (primo
# allineamento di un dispositivo nuovo).
rm -f "$TGT_USERS"
curl -s -X POST "$T/projects/impianto/open" >/dev/null; sleep 1
echo -n "  invio: "; curl -s -X POST "$S/remote/users" | head -c 200; echo
echo "  users.yaml sul target ora: $(grep username "$TGT_USERS" 2>/dev/null | sed 's/.*: //' | tr '\n' ' ')"
grep -q admin_ide "$TGT_USERS" 2>/dev/null \
  && ok "utenti allineati su richiesta esplicita" || ko "allineamento non avvenuto"

echo "=== 5. casella «Sostituisci anche gli utenti» spenta → account intatti ==="
# Si riparte da un dispositivo pulito e in no-auth, con un account suo su disco.
rm -f "$TGT_USERS"
curl -s -X POST "$T/projects/impianto/open" >/dev/null; sleep 1
utente_su_disco "$TGT_USERS" operatore_dispositivo Operator
curl -s -N -X POST "$S/remote/deploy" -H 'Content-Type: application/json' \
  -d '{"replace_users":false}' 2>&1 | tail -3 | sed 's/^/  /'
grep -q operatore_dispositivo "$TGT_USERS" 2>/dev/null \
  && ok "con la casella spenta l'account del dispositivo resta" || ko "account sostituito a casella spenta"
grep -q admin_ide "$TGT_USERS" 2>/dev/null \
  && ko "gli utenti del progetto sono arrivati lo stesso" || ok "gli utenti del progetto non sono arrivati"

echo "=== 6. progetto senza utenti, senza conferma → 428 e niente toccato ==="
# Qui il dispositivo deve **dichiarare** i suoi utenti, quindi l'account si crea
# dalla sua API (entra in memoria) e la sorgente si riconnette con quelle
# credenziali: è la situazione vera di un pannello in servizio.
rm -f "$TGT_USERS"
curl -s -X POST "$T/projects/impianto/open" >/dev/null; sleep 1
curl -s -o /dev/null -w "  crea admin sul dispositivo: %{http_code}\n" -X POST "$T/auth/users" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin_dispositivo","password":"Segreta-12345","role":"Admin","must_change_password":false}'
echo -n "  riconnessione con le credenziali del dispositivo: "
curl -s -X POST "$S/remote/connect" -H 'Content-Type: application/json' \
  -d "{\"url\":\"http://localhost:$TGT_PORT\",\"username\":\"admin_dispositivo\",\"password\":\"Segreta-12345\"}" | head -c 200; echo
# Il progetto della sorgente perde gli utenti: il bundle non avrà l'entry.
rm -f "$SRC_USERS"
COD=$(curl -s -o "$SCR/resp428.json" -w '%{http_code}' -X POST "$S/remote/deploy" \
  -H 'Content-Type: application/json' -d '{}')
echo "  HTTP $COD — $(head -c 200 "$SCR/resp428.json")"
[ "$COD" = "428" ] && ok "il server si è fermato e ha chiesto conferma" || ko "atteso 428, ricevuto $COD"
grep -q '"conferma":"utenti-vuoti"' "$SCR/resp428.json" && ok "motivo dichiarato nel corpo" || ko "corpo del 428 senza motivo"
grep -q admin_dispositivo "$SCR/resp428.json" && ok "l'elenco degli account che sparirebbero è nel corpo" || ko "elenco assente dal 428"
grep -q admin_dispositivo "$TGT_USERS" 2>/dev/null \
  && ok "users.yaml del dispositivo immutato" || ko "users.yaml toccato malgrado il 428"

echo "=== 7. con la conferma → gli account spariscono e il pannello resta aperto ==="
curl -s -N -X POST "$S/remote/deploy" -H 'Content-Type: application/json' \
  -d '{"confirm_no_users":true}' 2>&1 | tail -4 | sed 's/^/  /'
[ -f "$TGT_USERS" ] && ko "users.yaml ancora presente sul dispositivo" || ok "users.yaml rimosso dal dispositivo"
SYS=$(curl -s "$T/system")
echo "  /api/system: $(echo "$SYS" | tr ',' '\n' | grep -i auth_required)"
echo "$SYS" | grep -q '"auth_required":false' \
  && ok "il dispositivo dichiara di essere senza password (conseguenza accettata)" \
  || ko "auth_required non è false: lo stato dichiarato non combacia"

echo
[ "$ESITO" = 0 ] && echo "=== TUTTO VERDE ===" || echo "=== CI SONO ASSERZIONI ROSSE ==="
exit "$ESITO"
