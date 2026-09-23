#!/usr/bin/env bash
# I segreti di progetto, provati su runtime veri (sotto-passo 2h del piano
# `docs/plans/2026-09-21-sessione-stabilizzazione.md`).
#
# PERCHÉ ESISTE, ACCANTO A `check_segreti.sh`
#
# La guardia statica legge il codice: dice che ogni campo segreto è nella
# tabella, che `project.yaml` si scrive da un posto solo, che nessun log
# interpola un token. Sono le quattro classi di difetto che si vedono
# *guardando i sorgenti*.
#
# Non può dire se il file sul disco contiene davvero il token, se ha davvero i
# permessi 0600, se l'export lo porta via o se il deploy lo consegna. Quelle
# cose si vedono solo facendole, con due runtime accesi: è il collaudo che il
# piano chiamava 2h, e scriverlo come guardia invece che farlo a mano una volta
# significa che varrà ancora fra sei mesi, quando qualcuno toccherà
# `build_export_zip` per un'altra ragione.
#
# I sette casi qui sotto sono quelli elencati dal piano, più due che il piano
# dà per scontati e che il collaudo del 23-09-2026 ha voluto vedere: il token
# non deve comparire in **nessun** file dell'export (non basta che manchi
# `secrets.yaml`), e un secondo deploy da una sorgente senza segreti non deve
# svuotare il dispositivo.
#
# PROVATA ROSSA (23-09-2026), perché una guardia nata verde non ha ancora
# dimostrato di guardare qualcosa. Due falsificazioni, una per volta, sul
# codice vero: `scrivi_atomico_0600` portato a `0o644` → cade il caso 2;
# l'export che include sempre i segreti → cadono i due controlli del caso 4.
#
# La prima ha mostrato una cosa che vale la pena sapere: **il caso 6 è rimasto
# verde** con i permessi rotti, perché il file che arriva col deploy lo scrive
# `upload_project_zip`, non `scrivi_atomico_0600`. Sono due strade di scrittura
# diverse, e possono divergere senza che nessuna delle due se ne accorga: per
# questo i permessi si controllano due volte, di qua e di là.
#
# Uso:  ./scripts/check_segreti_e2e.sh     (esce != 0 se un caso cade)
#       Vuole il binario di debug già costruito: cargo build -p sws-runtime
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
SCR="${TMPDIR:-/tmp}/sws-check-segreti-e2e"
SRC_PORT=8581
TGT_PORT=8583
# Riconoscibile a colpo d'occhio in un grep, e palesemente non valido: se
# finisse davvero in una richiesta a Telegram, quella richiesta fallisce.
TOKEN="7777777777:AAH-TOKEN-FINTO-DELLA-GUARDIA-NON-VALIDO"
TOKEN_VECCHIO="1111111111:AAH-TOKEN-IN-CHIARO-DA-MIGRARE"

if [ ! -x "$BIN" ]; then
  echo "  ✗ manca $BIN — esegui prima: cargo build -p sws-runtime"
  exit 1
fi

rm -rf "$SCR"; mkdir -p "$SCR"/src/{config,projects} "$SCR"/tgt/{config,projects}

start() {  # $1=dir $2=porta [$3=porta viewer]
  "$BIN" --config "$SCR/$1/config" --projects-root "$SCR/$1/projects" \
    --templates-root "$REPO/examples/templates" --admin-port "$2" ${3:+--viewer-port "$3"} \
    > "$SCR/$1.log" 2>&1 &
  echo $!
}

ESITO=0
ok() { echo -e "  \033[32m✓\033[0m $1"; }
ko() { echo -e "  \033[31m✗\033[0m $1"; ESITO=1; }

# ── Il progetto «vecchio»: token in chiaro dentro project.yaml, come lo
#    scriveva il runtime prima del 22-09-2026. Va preparato PRIMA di accendere
#    il runtime, perché è l'apertura che deve migrarlo.
mkdir -p "$SCR/src/projects/eredita"
cat > "$SCR/src/projects/eredita/project.yaml" <<EOF
meta:
  name: eredita
  version: "1"
notifications:
  telegram:
    bot_token: "$TOKEN_VECCHIO"
    chat_ids: ["-100123"]
tags: []
sources: []
EOF

SRC_PID=$(start src "$SRC_PORT"); TGT_PID=$(start tgt "$TGT_PORT" "$((TGT_PORT + 1))")
trap 'kill -TERM "$SRC_PID" "$TGT_PID" 2>/dev/null' EXIT
sleep 8

S="http://localhost:$SRC_PORT/api"
T="http://localhost:$TGT_PORT/api"
PROG="$SCR/src/projects/segreti"

echo -e "\033[1mI segreti di progetto, su due runtime veri\033[0m"
echo
echo "=== preparazione: un progetto per lato, e un token salvato dall'API ==="
for pair in "$S src" "$T tgt"; do
  set -- $pair
  curl -s -X POST "$1/projects" -H 'Content-Type: application/json' -d '{"name":"segreti"}' >/dev/null
  curl -s -X POST "$1/projects/segreti/open" >/dev/null
done

COD=$(curl -s -o "$SCR/put.out" -w '%{http_code}' -X PUT "$S/project/notifications" \
  -H 'Content-Type: application/json' \
  -d "{\"telegram\":{\"bot_token\":\"$TOKEN\",\"chat_ids\":[\"-100999\"]}}")
echo "  PUT /api/project/notifications → $COD"
[ "$COD" = "204" ] || [ "$COD" = "200" ] || ko "il salvataggio del token è fallito ($COD): $(head -c 200 "$SCR/put.out")"

echo
echo "=== 1. il token è in secrets.yaml, non in project.yaml ==="
if grep -q "$TOKEN" "$PROG/project.yaml" 2>/dev/null; then
  ko "project.yaml contiene il token in chiaro"
  grep -n "bot_token" "$PROG/project.yaml" | sed 's/^/      /'
else
  ok "project.yaml non contiene il token"
fi
if [ -f "$PROG/secrets.yaml" ] && grep -q "$TOKEN" "$PROG/secrets.yaml"; then
  ok "secrets.yaml contiene il token"
else
  ko "secrets.yaml manca o non contiene il token"
fi

echo
echo "=== 2. secrets.yaml è 0600 — nessuno lo legge se non il proprietario ==="
MODO=$(stat -c %a "$PROG/secrets.yaml" 2>/dev/null || echo "?")
[ "$MODO" = "600" ] && ok "permessi $MODO" || ko "permessi $MODO, attesi 600"

echo
echo "=== 3. la GET del progetto maschera il token ==="
curl -s "$S/project" -o "$SCR/get-project.json"
if grep -q "$TOKEN" "$SCR/get-project.json"; then
  ko "GET /api/project restituisce il token in chiaro al browser"
else
  ok "GET /api/project non contiene il token"
fi

echo
echo "=== 3b. il giro leggi-modifica-riscrivi non perde la credenziale ==="
# Quello che fa l'IDE ogni volta che qualcuno cambia un'etichetta: GET,
# ritocca, PUT. Perché regga, la GET deve mandare il **segnaposto** e non un
# campo assente — l'IDE non può rimandare indietro quello che non ha ricevuto,
# e il ripristino del 2f non avrebbe niente da riconoscere. Misurato il
# 23-09-2026: rinominare un datastore ODBC ne cancellava la stringa di
# connessione, perché `get_project` leggeva `project.yaml` senza rimettere i
# segreti e la maschera non trovava niente da mascherare.
curl -s -X PUT "$S/project/datastores" -H 'Content-Type: application/json' -d '[
 {"id":"odbc1","label":"Gestionale","backend":{"kind":"odbc","connection_string":"DSN=x;PWD=SEGRETO-ODBC","table":"t","col_tag":"a","col_value":"b","col_ts":"c"}}
]' -o /dev/null
VISTO=$(curl -s "$S/project" | python3 -c "import sys,json;print(json.load(sys.stdin)['datastores'][0]['backend'].get('connection_string'))" 2>/dev/null)
[ "$VISTO" = "********" ] && ok "la GET manda il segnaposto (non il valore, non il vuoto)"                           || ko "la GET manda «$VISTO»: l'IDE non ha niente da rimandare indietro"
RISALVA=$(curl -s "$S/project" | python3 -c "
import sys,json
d=json.load(sys.stdin)['datastores']; d[0]['label']='Rinominato'; print(json.dumps(d))")
curl -s -X PUT "$S/project/datastores" -H 'Content-Type: application/json' -d "$RISALVA" -o /dev/null
if grep -q "SEGRETO-ODBC" "$PROG/secrets.yaml" 2>/dev/null; then
  ok "dopo aver rinominato, la stringa di connessione è ancora lì"
else
  ko "rinominare il datastore ha cancellato la sua stringa di connessione"
fi
# Ripulito, o il caso 4 troverebbe anche questo segreto da cercare.
curl -s -X PUT "$S/project/datastores" -H 'Content-Type: application/json' -d '[]' -o /dev/null

echo
echo "=== 4. l'export normale non porta via niente ==="
curl -s "$S/project/export" -o "$SCR/export.zip"
if unzip -l "$SCR/export.zip" 2>/dev/null | grep -q "secrets.yaml"; then
  ko "l'export contiene secrets.yaml senza che nessuno l'abbia chiesto"
else
  ok "l'export non contiene secrets.yaml"
fi
# Non basta: il token potrebbe essere rimasto in project.yaml dentro lo zip, o
# in un file di backup finito nel bundle. Si guarda dentro, tutti i file.
if unzip -p "$SCR/export.zip" '*' 2>/dev/null | grep -q "$TOKEN"; then
  ko "il token compare DENTRO un file dell'export"
  unzip -l "$SCR/export.zip" | sed 's/^/      /' | head -20
else
  ok "nessun file dell'export contiene il token"
fi

echo
echo "=== 5. l'export con ?segreti=1 lo porta, perché glielo si è chiesto ==="
curl -s "$S/project/export?segreti=1" -o "$SCR/export-con.zip"
if unzip -p "$SCR/export-con.zip" 'secrets.yaml' 2>/dev/null | grep -q "$TOKEN"; then
  ok "l'export esplicito contiene secrets.yaml col token"
else
  ko "l'export con ?segreti=1 non porta il token"
  unzip -l "$SCR/export-con.zip" | sed 's/^/      /' | head -20
fi

echo
echo "=== 6. il deploy consegna il segreto al dispositivo, 0600 ==="
curl -s -X POST "$S/remote/connect" -H 'Content-Type: application/json' \
  -d "{\"url\":\"http://localhost:$TGT_PORT\",\"username\":\"\",\"password\":\"\"}" >/dev/null
curl -s -N -X POST "$S/remote/deploy" > "$SCR/deploy.out" 2>&1
TGT_SEC="$SCR/tgt/projects/segreti/secrets.yaml"
if [ -f "$TGT_SEC" ] && grep -q "$TOKEN" "$TGT_SEC"; then
  MODO_T=$(stat -c %a "$TGT_SEC")
  [ "$MODO_T" = "600" ] && ok "il dispositivo ha il token, permessi $MODO_T" \
                        || ko "il dispositivo ha il token ma con permessi $MODO_T, attesi 600"
else
  ko "il token non è arrivato sul dispositivo"
  tail -5 "$SCR/deploy.out" | sed 's/^/      /'
fi
if grep -q "$TOKEN" "$SCR/tgt/projects/segreti/project.yaml" 2>/dev/null; then
  ko "sul dispositivo il token è finito in project.yaml"
else
  ok "sul dispositivo project.yaml non contiene il token"
fi

echo
echo "=== 7. un deploy senza segreti non svuota il dispositivo ==="
# Il caso dichiarato nel piano: «se lo zip non lo porta, il dispositivo tiene
# il suo». Succede davvero quando si ridistribuisce un progetto da una
# postazione che i segreti non li ha — e cancellarli spegnerebbe le notifiche
# di un impianto che funzionava.
curl -s -X PUT "$S/project/notifications" -H 'Content-Type: application/json' -d '{}' >/dev/null
rm -f "$PROG/secrets.yaml"
curl -s -N -X POST "$S/remote/deploy" > "$SCR/deploy2.out" 2>&1
if grep -q "$TOKEN" "$TGT_SEC" 2>/dev/null; then
  ok "il dispositivo ha tenuto il suo token"
else
  ko "un deploy senza segreti ha cancellato quello del dispositivo"
  tail -5 "$SCR/deploy2.out" | sed 's/^/      /'
fi

echo
echo "=== 8. un progetto vecchio si migra da solo, con il backup prima ==="
curl -s -X POST "$S/projects/eredita/open" >/dev/null
sleep 2
ERED="$SCR/src/projects/eredita"
if grep -q "$TOKEN_VECCHIO" "$ERED/project.yaml" 2>/dev/null; then
  ko "project.yaml ha ancora il token in chiaro: la migrazione non è avvenuta"
elif [ -f "$ERED/secrets.yaml" ] && grep -q "$TOKEN_VECCHIO" "$ERED/secrets.yaml"; then
  ok "il token è stato spostato in secrets.yaml"
else
  ko "il token è sparito da project.yaml ma non è in secrets.yaml — è stato perso"
fi
if [ -d "$ERED/backups" ] && [ -n "$(ls -A "$ERED/backups" 2>/dev/null)" ]; then
  ok "il backup c'è: $(ls "$ERED/backups" | head -1)"
else
  ko "nessun backup prima della migrazione — il progetto originale non è recuperabile"
fi

echo
echo "=== 9. riaprendolo non rimigra (e non fa un secondo backup) ==="
N_BACKUP=$(ls -A "$ERED/backups" 2>/dev/null | wc -l)
curl -s -X POST "$S/projects/eredita/open" >/dev/null
sleep 2
N_BACKUP2=$(ls -A "$ERED/backups" 2>/dev/null | wc -l)
if [ "$N_BACKUP" = "$N_BACKUP2" ]; then
  ok "backup ancora $N_BACKUP2: la migrazione non si ripete"
else
  ko "seconda migrazione alla riapertura ($N_BACKUP → $N_BACKUP2 backup)"
fi

echo
echo "=== 9b. salvare una sezione non cancella i segreti delle altre ==="
# Il difetto trovato il 23-09-2026 sul progetto di prova, e il peggiore del
# Passo 2: `patch_project_se` caricava `project.yaml` senza applicare
# `secrets.yaml`, quindi `estrai` vedeva solo il segreto appena arrivato e
# riscriveva il file con quello. Configurare un database con password
# cancellava il token Telegram. Intermittente per giunta: un salvataggio che
# non porta credenziali lasciava la mappa vuota e non scriveva niente, quindi
# passava inosservato finché le sezioni con segreti erano una sola.
# Il caso 8 ha reso attivo l'altro progetto: si torna su questo, o i PUT qui
# sotto finirebbero in `eredita` e il controllo proverebbe il contrario di
# quello che dice.
curl -s -X POST "$S/projects/segreti/open" -o /dev/null
# Il token è stato tolto dal caso 7: si rimette, perché qui la domanda è se
# DUE credenziali di sezioni diverse convivono.
curl -s -X PUT "$S/project/notifications" -H 'Content-Type: application/json' \
  -d "{\"telegram\":{\"bot_token\":\"$TOKEN\",\"chat_ids\":[\"-100999\"]}}" -o /dev/null
COD=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$S/project/datastores" -H 'Content-Type: application/json' -d '[
 {"id":"gestionale","label":"Gestionale","backend":{"kind":"odbc","connection_string":"DSN=x;UID=sws;PWD=PASSWORD-DEL-DATABASE","table":"t","col_tag":"tag_id","col_value":"value","col_ts":"ts_ms"}}
]')
[ "$COD" = "204" ] || ko "il salvataggio del datastore è fallito ($COD): il caso qui sotto non prova niente"
N_SEG=$(grep -c . "$PROG/secrets.yaml" 2>/dev/null || echo 0)
if grep -q "$TOKEN" "$PROG/secrets.yaml" 2>/dev/null && grep -q "PASSWORD-DEL-DATABASE" "$PROG/secrets.yaml"; then
  ok "le due credenziali convivono ($N_SEG righe in secrets.yaml)"
else
  ko "salvare i datastore ha cancellato il token delle notifiche"
  sed 's/^/      /' "$PROG/secrets.yaml" 2>/dev/null
fi

echo
echo "=== 9c. togliere l'ultima credenziale la toglie anche dal disco ==="
# L'altra faccia: la scrittura era condizionata a «la mappa non è vuota»,
# quindi l'ultimo segreto rimosso dall'IDE restava sul disco per sempre.
curl -s -X PUT "$S/project/datastores" -H 'Content-Type: application/json' -d '[]' -o /dev/null
curl -s -X PUT "$S/project/notifications" -H 'Content-Type: application/json' -d '{}' -o /dev/null
if [ -f "$PROG/secrets.yaml" ] && grep -q . "$PROG/secrets.yaml"; then
  ko "secrets.yaml contiene ancora qualcosa dopo aver tolto tutte le credenziali"
  sed 's/^/      /' "$PROG/secrets.yaml"
else
  ok "secrets.yaml è sparito insieme all'ultima credenziale"
fi
# Rimesso com'era, per i casi che seguono.
curl -s -X PUT "$S/project/notifications" -H 'Content-Type: application/json' \
  -d "{\"telegram\":{\"bot_token\":\"$TOKEN\",\"chat_ids\":[\"-100999\"]}}" -o /dev/null

echo
echo "=== 10. il runtime dichiara di saper leggere secrets.yaml ==="
# È la capacità su cui il deploy decide se mandare le credenziali. Se sparisce
# dal `/api/system`, ogni deploy verso un dispositivo sano smette di portarle
# e nessun test unitario se ne accorge: la domanda si fa al runtime vero.
CAP=$(curl -s "$T/system" | python3 -c "import sys,json;print(json.load(sys.stdin).get('segreti_separati'))" 2>/dev/null)
[ "$CAP" = "True" ] && ok "il dispositivo dichiara segreti_separati"                     || ko "il dispositivo non dichiara la capacità (vale $CAP): nessun deploy gli manderebbe più i segreti"

echo
echo "=== 11. nessun token nei log dei due runtime ==="
PERDITE=0
for L in "$SCR/src.log" "$SCR/tgt.log"; do
  if grep -q -e "$TOKEN" -e "$TOKEN_VECCHIO" "$L" 2>/dev/null; then
    ko "$(basename "$L") contiene un token"
    grep -n -e "$TOKEN" -e "$TOKEN_VECCHIO" "$L" | head -3 | cut -c1-160 | sed 's/^/      /'
    PERDITE=1
  fi
done
[ "$PERDITE" = "0" ] && ok "i log dei due runtime non nominano nessun token"

echo
if [ "$ESITO" = "0" ]; then
  echo -e "\033[32msegreti dal vivo: tutti i casi verdi.\033[0m"
else
  echo -e "\033[31msegreti dal vivo: almeno un caso rosso — i file stanno in $SCR\033[0m"
  trap - EXIT
  kill -TERM "$SRC_PID" "$TGT_PID" 2>/dev/null
fi
exit "$ESITO"
