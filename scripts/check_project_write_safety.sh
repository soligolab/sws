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

"$BIN" --config "$SCR/config" --projects-root "$SCR/projects" \
  --templates-root "$REPO/examples/templates" --admin-port "$PORT" > "$SCR/rt.log" 2>&1 &
P=$!; trap 'kill -TERM "$P" 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$PORT/health" && break; sleep 0.5; done
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

echo
echo "=== esito: $passati/$fatti ==="
[ "$passati" = "$fatti" ] || exit 1
