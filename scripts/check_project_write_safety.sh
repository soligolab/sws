#!/usr/bin/env bash
#
# Un salvataggio non deve mai peggiorare il project.yaml su disco.
#
# Perché esiste: `patch_project` sta sotto ogni PUT /api/project/* e riscriveva il
# file per intero. Se il caricamento falliva, scriveva un progetto VUOTO — quindi
# un project.yaml illeggibile sopravviveva all'apertura e veniva azzerato dal
# primo salvataggio in qualunque tab. E le sorgenti che la versione corrente non
# sa leggere (tolleranza voluta, forward-compat) venivano cancellate dalla prima
# riscrittura.
#
# È la terza volta in tre giorni che compare la stessa forma: uno stato in memoria
# più povero del disco che finisce per sovrascriverlo.
#
# Uso: ./scripts/check_project_write_safety.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/sws-runtime/target/debug/sws-runtime"
SCR="${TMPDIR:-/tmp}/sws-check-write-safety"
PORT=8581
rm -rf "$SCR"; mkdir -p "$SCR"/{config,projects}

[ -x "$BIN" ] || { echo "manca $BIN — esegui: cargo build -p sws-runtime" >&2; exit 1; }

# Su pyenv il binario Python e uno shim che non espone le shared libs, quindi il
# runtime muore all'avvio con «libpython3.11.so.1.0: cannot open shared object
# file». Prima questa guardia non lo faceva, e il guasto arrivava travestito:
# ogni curl tornava `000`, il caso 4 diceva «creazione bloccata: il rifiuto e
# troppo largo» e il caso 5 dichiarava «salvataggio rifiutato (000)» come un
# **successo** — cioe' la guardia mostrava verdetti sul comportamento del
# runtime senza che il runtime fosse mai partito. Stessa toppa di
# start_runtime.sh, piu' un controllo che il processo sia vivo davvero.
if [[ "$(command -v python3)" == *".pyenv/shims"* ]]; then
  pv="$(pyenv version 2>/dev/null | awk '{print $1}')"
  [ -n "$pv" ] && export LD_LIBRARY_PATH="$HOME/.pyenv/versions/$pv/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

"$BIN" --config "$SCR/config" --projects-root "$SCR/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$PORT" > "$SCR/rt.log" 2>&1 &
P=$!; trap 'kill -TERM "$P" 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$PORT/health" && break; sleep 0.5; done
# Se non risponde, si ferma qui dicendo perche'. Una guardia che prosegue con un
# runtime morto non da' un rosso utile: da' cinque rossi che parlano di
# «rifiuti troppo larghi» e mandano a cercare il difetto nel posto sbagliato.
if ! curl -sf -o /dev/null "http://localhost:$PORT/health"; then
  echo "il runtime di prova non risponde su :$PORT — nessuna prova e attendibile." >&2
  echo "ultime righe di $SCR/rt.log:" >&2
  tail -5 "$SCR/rt.log" >&2
  exit 1
fi
API="http://localhost:$PORT/api"

fatti=0; passati=0
# Quale progetto sta ricevendo le PUT? Senza questo controllo un'apertura fallita
# fa scrivere sul progetto precedente e il test misura il file sbagliato — è
# successo davvero, il caso 2 modificava p1.
attivo() { curl -s "$API/project" | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["meta"]["name"])
except Exception: print("(nessuno)")'; }
esito() { fatti=$((fatti+1)); if [ "$1" = ok ]; then passati=$((passati+1)); echo "  ✓ $2"; else echo "  ✗ $2"; fi; }

# ── 1. sorgente di un protocollo sconosciuto ────────────────────────────────
echo "=== 1. una sorgente che questa versione non sa leggere sopravvive a un salvataggio ==="
mkdir -p "$SCR/projects/p1"
cat > "$SCR/projects/p1/project.yaml" <<'EOF'
meta:
  name: p1
  version: 0.1.0
tags: []
sources:
  - kind: mqtt
    name: broker
    url: mqtt://localhost:1883
    topics: []
  - kind: protocollo_del_futuro
    name: misterioso
    parametro_ignoto: 42
EOF
curl -s -X POST "$API/projects/p1/open" >/dev/null; sleep 1
echo "  progetto attivo: $(attivo)"
curl -s -o /dev/null -X PUT "$API/project/tags" -H 'Content-Type: application/json' \
  -d '[{"id":"nuovo_tag","description":"aggiunto dalla tab Variabili"}]'
sleep 0.5
if grep -q "protocollo_del_futuro" "$SCR/projects/p1/project.yaml"; then
  esito ok "sorgente sconosciuta conservata"
else
  esito no "SORGENTE SCONOSCIUTA PERDUTA — il salvataggio l'ha cancellata"
fi
grep -q "nuovo_tag" "$SCR/projects/p1/project.yaml" \
  && esito ok "il tag nuovo è stato scritto (la patch funziona)" \
  || esito no "il tag nuovo non è stato scritto"
echo "  sorgenti nel file: $(grep -c 'kind:' "$SCR/projects/p1/project.yaml")"

# ── 2. project.yaml corrotto ─────────────────────────────────────────────────
echo "=== 2. un project.yaml illeggibile non viene sovrascritto ==="
mkdir -p "$SCR/projects/p2"
printf 'meta:\n  name: p2\n  version: 0.1.0\nalarms:\n  - questo non e un allarme valido: [\n' \
  > "$SCR/projects/p2/project.yaml"
prima=$(sha256sum "$SCR/projects/p2/project.yaml" | cut -d' ' -f1)
curl -s -o /dev/null -w "  apertura p2: %{http_code} (un progetto illeggibile puo non aprirsi)\n" -X POST "$API/projects/p2/open"; sleep 1
att=$(attivo); echo "  progetto attivo: $att"
if [ "$att" != "p2" ]; then
  esito ok "p2 non e diventato attivo: il runtime non ha aperto un progetto illeggibile"
  echo "  (la PUT andrebbe su \"$att\": il caso si verifica dall'esito 1, non da qui)"
fi
code=$(curl -s -o "$SCR/resp2.txt" -w '%{http_code}' -X PUT "$API/project/tags" \
  -H 'Content-Type: application/json' -d '[{"id":"x"}]')
dopo=$(sha256sum "$SCR/projects/p2/project.yaml" | cut -d' ' -f1)
echo "  risposta: $code — $(head -c 130 "$SCR/resp2.txt")"
[ "$prima" = "$dopo" ] \
  && esito ok "il file illeggibile e intatto byte per byte" \
  || esito no "FILE MODIFICATO nonostante non fosse caricabile"
# Il rifiuto si prova aprendo p2 a mano come progetto attivo: si punta l'attivo
# su p2 scrivendo il marker e riavviando la lettura tramite una PUT diretta.
if [ "$att" = "p2" ]; then
  [ "$code" != "204" ] \
    && esito ok "il salvataggio su progetto illeggibile e stato rifiutato ($code)" \
    || esito no "il salvataggio ha risposto 204 pur non avendo letto il progetto"
fi

# ── 3. chiave di primo livello sconosciuta ──────────────────────────────────
echo "=== 3. una chiave di primo livello sconosciuta sopravvive ==="
mkdir -p "$SCR/projects/p3"
cat > "$SCR/projects/p3/project.yaml" <<'EOF'
meta:
  name: p3
  version: 0.1.0
tags: []
impostazioni_di_una_versione_futura:
  qualcosa: vero
  soglia: 7
EOF
curl -s -X POST "$API/projects/p3/open" >/dev/null; sleep 1
curl -s -o /dev/null -X PUT "$API/project/tags" -H 'Content-Type: application/json' -d '[{"id":"t3"}]'
sleep 0.5
grep -q "impostazioni_di_una_versione_futura" "$SCR/projects/p3/project.yaml" \
  && esito ok "chiave sconosciuta conservata" \
  || esito no "CHIAVE SCONOSCIUTA PERDUTA"
grep -q "soglia: 7" "$SCR/projects/p3/project.yaml" \
  && esito ok "contenuto della chiave conservato" \
  || esito no "contenuto della chiave perduto"

# ── 4. progetto nuovo senza project.yaml ────────────────────────────────────
echo "=== 4. un progetto senza project.yaml viene creato (caso legittimo) ==="
curl -s -X POST "$API/projects" -H 'Content-Type: application/json' -d '{"name":"p4"}' >/dev/null
curl -s -X POST "$API/projects/p4/open" >/dev/null; sleep 1
rm -f "$SCR/projects/p4/project.yaml"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/project/tags" \
  -H 'Content-Type: application/json' -d '[{"id":"t4"}]')
[ "$code" = "204" ] && [ -f "$SCR/projects/p4/project.yaml" ] \
  && esito ok "creato ($code) — il caso legittimo non è regredito" \
  || esito no "creazione bloccata ($code): il rifiuto è troppo largo"

# ── 5. il rifiuto vero: progetto illeggibile aperto al BOOT ─────────────────
# L'API si rifiuta di aprire un progetto illeggibile (500), quindi da lì il caso
# non si raggiunge. L'auto-apertura al boot invece lo accetta con un avviso nel
# log ("project.yaml not found or invalid — starting with empty tag database") e
# lo rende attivo: è quella la strada per cui un salvataggio poteva azzerarlo.
echo "=== 5. progetto illeggibile aperto al boot: il salvataggio deve essere rifiutato ==="
PORT2=8582
mkdir -p "$SCR/config2"
prima5=$(sha256sum "$SCR/projects/p2/project.yaml" | cut -d' ' -f1)
"$BIN" --config "$SCR/config2" --projects-root "$SCR/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$PORT2" \
  --project "$SCR/projects/p2" > "$SCR/rt2.log" 2>&1 &
P2=$!; trap 'kill -TERM "$P" "$P2" 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$PORT2/health" && break; sleep 0.5; done
API2="http://localhost:$PORT2/api"
grep -q "not found or invalid" "$SCR/rt2.log" \
  && echo "  il runtime ha avvisato e ha comunque reso attivo p2 (come previsto)" \
  || echo "  (avviso di caricamento non trovato nel log)"
code5=$(curl -s -o "$SCR/resp5.txt" -w '%{http_code}' -X PUT "$API2/project/tags" \
  -H 'Content-Type: application/json' -d '[{"id":"y"}]')
dopo5=$(sha256sum "$SCR/projects/p2/project.yaml" | cut -d' ' -f1)
echo "  risposta: $code5 — $(head -c 150 "$SCR/resp5.txt")"
[ "$code5" != "204" ] \
  && esito ok "salvataggio rifiutato ($code5) su progetto non caricabile" \
  || esito no "SALVATAGGIO ACCETTATO: il progetto illeggibile e stato sovrascritto"
[ "$prima5" = "$dopo5" ] \
  && esito ok "file intatto byte per byte dopo il tentativo" \
  || esito no "FILE MODIFICATO: e la perdita di dati che il fix doveva impedire"

# ── 6. Q30: due salvataggi concorrenti non si mangiano a vicenda ────────────
#
# Stessa tesi delle cinque prove sopra — un salvataggio non deve peggiorare il
# file su disco — ma la causa è la concorrenza invece del contenuto. Ogni
# `PUT /api/project/*` fa leggi-modifica-scrivi, quindi due in volo insieme
# partono dallo stesso file e l'ultima cancella la modifica dell'altra: nessun
# errore, il salvataggio riesce, e una delle due modifiche non c'è più.
#
# **Perché venti giri e non due.** La finestra della corsa è di millisecondi:
# due salvataggi lanciati a mano non collidono quasi mai, ed è per questo che il
# difetto è arrivato fino alla 2.5.0 pur essendo sistematico. Venti giri di due
# richieste parallele lo colpiscono ogni volta.
#
# **Perché guarda l'ULTIMO giro e non «le sezioni non sono vuote».** La prima
# stesura di questa prova controllava che tags e sources fossero entrambe
# popolate, e passava anche col lock disattivato: le sezioni restano piene per
# via dei giri precedenti. Guardando il numero d'ordine invece si vede che era
# sopravvissuto `sonda.tag14` mentre le sorgenti erano al giro 20 — la corsa
# c'era, era l'asserzione a non vederla. Provato in entrambi i versi:
# disattivando il lock in `patch_project`, questo caso diventa rosso.
GIRI=20
curl -s -o /dev/null -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"conc"}'
curl -s -o /dev/null -X POST "$API/projects/conc/open"
if [ "$(attivo)" != "conc" ]; then
  esito no "il progetto conc non e attivo: la prova 6 misurerebbe il file sbagliato"
else
  for i in $(seq 1 $GIRI); do
    curl -s -o /dev/null -X PUT "$API/project/tags" -H 'Content-Type: application/json' \
      -d "[{\"id\":\"conc.tag$i\"}]" &
    a=$!
    curl -s -o /dev/null -X PUT "$API/project/sources" -H 'Content-Type: application/json' \
      -d "[{\"kind\":\"mqtt\",\"id\":\"conc-src$i\",\"host\":\"127.0.0.1\",\"port\":1883,\"topics\":[]}]" &
    b=$!
    # `wait` NUDO qui appende per sempre: aspetterebbe **tutti** i figli in
    # background, e fra questi c'e' il runtime di prova ($P), che non esce mai.
    # Preso in faccia scrivendo questo caso: la guardia restava piantata senza
    # dire niente. Si aspettano i due curl per PID, e nient'altro.
    wait "$a" "$b"
  done
  esito6="$(curl -s "$API/project" | GIRI=$GIRI python3 -c '
import json, os, sys
n = int(os.environ["GIRI"]); p = json.load(sys.stdin)
t = [x["id"] for x in p.get("tags") or []]
s = [x.get("id") for x in p.get("sources") or []]
if t == [f"conc.tag{n}"] and s == [f"conc-src{n}"]:
    print("ok")
else:
    print(f"no|atteso conc.tag{n} + conc-src{n}, trovato {t} + {s}")
')"
  case "$esito6" in
    ok) esito ok "$GIRI giri di salvataggi paralleli: nessuno perso" ;;
    *)  esito no "SALVATAGGIO PERSO — ${esito6#no|}" ;;
  esac
fi

echo
echo "=== esito: $passati/$fatti ==="
[ "$passati" = "$fatti" ] || exit 1
