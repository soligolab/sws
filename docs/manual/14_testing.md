← [Indice](MAIN.md) | [← API](13_api_reference.md) | [Successivo → Multilingua](15_multilingua.md) →

---

# 14 — Test e Diagnostica

> Come si verifica che SWS funzioni e come si cerca un guasto: smoke test, test E2E, simulatori di protocollo,
> diagnosi. Per chi sviluppa SWS o lo mette in servizio. Gli esempi usano lo stack locale di `start_runtime.sh`.
>
> Misurato sul codice il 20-10-2026.

Questa guida descrive come verificare il corretto funzionamento di SWS
e diagnosticare i problemi più comuni.

---

## Smoke test rapido

Prima di qualsiasi test approfondito, verifica che il runtime risponda:

```bash
# Avvia il runtime con un Admin (senza utenti il runtime è chiuso e chiede l'abbinamento)
SWS_ADMIN_USER=admin SWS_ADMIN_PASSWORD='una-password-di-prova' ./scripts/start_runtime.sh

# Health check (HTTP di default; con TLS attivo usa https:// + -k): è aperto a tutti
curl http://localhost:8443/health
# → ok

# Metriche Prometheus: dal 15-10-2026 vogliono una sessione, o il token statico SWS_METRICS_TOKEN
curl -k -H "Authorization: Bearer $SWS_METRICS_TOKEN" https://localhost:8443/metrics | head -5
# → # HELP sws_uptime_seconds ...
# → sws_uptime_seconds 42.1

# Tag snapshot: senza token si è Viewer anonimo, se il progetto ha utenti
curl -k https://localhost:8443/api/tags
# → {"counter": {"value": 0, "quality": "Good", ...}, ...}
# Un runtime senza utenti risponde invece 401 «abbinamento_richiesto» (capitolo 09)
```

---

## Verifica login e ruoli

```bash
# Login come admin
TOKEN=$(curl -sk -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$SWS_ADMIN_PASSWORD\"}" | jq -r .token)

echo "Token: $TOKEN"

# Il progetto aperto (qualunque utente autenticato)
curl -k -H "Authorization: Bearer $TOKEN" https://localhost:8444/api/project | jq '.meta'
```

---

## Test tag write/read

```bash
# Scrivi un valore (triggera l'allarme counter_high se > 50)
curl -k -X PUT https://localhost:8443/api/tags/counter \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value": 99}'

# Leggi il valore scritto
curl -k https://localhost:8443/api/tags/counter
# → {"value": 99, "quality": "Good", ...}

# Verifica allarme attivo
curl -k https://localhost:8443/api/alarms | jq '.counter_high.isa_state'
# → "active_unacked"

# ACK allarme
curl -k -X POST https://localhost:8443/api/alarms/counter_high/ack \
  -H "Authorization: Bearer $TOKEN"
```

---

## Test historian

```bash
# Scrivi N valori per popolare lo storico
for i in $(seq 1 10); do
  curl -sk -X PUT https://localhost:8443/api/tags/counter \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"value\": $i}" > /dev/null
  sleep 0.5
done

# Leggi storico
curl -k "https://localhost:8443/api/history/counter?limit=20" | jq '.[0]'
# → {"ts_ms": ..., "value": 1, "quality": "Good"}

# Statistiche
curl -k "https://localhost:8443/api/history/counter/stats" | jq .
```

---

## Playwright E2E

La suite di test E2E automatizzata verifica il golden path del editor.

### Prerequisiti

```bash
# Il runtime deve essere in esecuzione (serve la SPA su :8444)
./scripts/start_runtime.sh &

# Prima esecuzione: installa Chromium (~150 MB)
cd sws-editor && npx playwright install chromium
```

### Esecuzione

```bash
cd sws-editor

# Headless (CI)
pnpm test:e2e

# Con UI di debug
pnpm test:e2e:ui
```

### Test inclusi

| Spec | Cosa verifica |
|------|--------------|
| `e2e/editor.spec.ts` | Golden path: login, apertura progetto, aggiunta oggetto, salva + reload |
| `e2e/import-tags.spec.ts` | Regressione issue #2: export → progetto vuoto → import ZIP, i tag compaiono |
| `e2e/lang-table.spec.ts` | T-40: tabella delle lingue e risoluzione dei token `{{chiave}}` nel viewer |
| `e2e/bugcheck.spec.ts` | Regressioni: un clic su un oggetto non svuota la pagina, un progetto nuovo ha il canvas vuoto |
| `e2e/chat-ai.spec.ts` | T-50: si chiede un bottone MQTT in chat, si applica la proposta, si annulla, si salva |
| `e2e/screenshots.spec.ts` | Cattura gli screenshot del manuale |

`editor.spec.ts` vuole un runtime avviato con `SWS_ADMIN_USER`/`SWS_ADMIN_PASSWORD` (vedi l'intestazione dello spec).

### Screenshot automatici (per la documentazione)

```bash
cd sws-editor
npx playwright test e2e/screenshots.spec.ts --project=chromium
```

Genera gli screenshot in `docs/manual/screenshots/`.
Richiede un runtime in esecuzione che serva la SPA su `https://localhost:8444` (avvialo con
`./scripts/start_runtime.sh`); apri un progetto con contenuti per immagini significative.

### Artefatti test

Disponibili in `sws-editor/test-results/` e `playwright-report/` (gitignored):
- Screenshot su fallimento
- Trace zip (analizzabile con `npx playwright show-trace`)
- HTML report

---

## Test protocollo Modbus

Con un simulatore Modbus (es. `pymodbus`):

```bash
# Installa pymodbus (l'esempio usa l'API della serie 2.x: `pymodbus.server.sync`)
pip install 'pymodbus<3'

# Avvia server simulato su porta 502
python3 -c "
from pymodbus.server.sync import StartTcpServer
from pymodbus.datastore import ModbusSlaveContext, ModbusServerContext
from pymodbus.datastore import ModbusSequentialDataBlock
store = ModbusSlaveContext(hr=ModbusSequentialDataBlock(0, [100, 200, 300]))
context = ModbusServerContext(slaves=store, single=True)
StartTcpServer(context, address=('localhost', 502))
"
```

Configura una sorgente Modbus in **Configurazione → Progetto → Protocolli → + Aggiungi Modbus TCP**:
- Host: `localhost`, Port: `502`, Unit ID: `1`
- Register: `tag=test.valore, address=0, scale=0.1`

Verifica: `curl -k https://localhost:8443/api/tags/test.valore`
Atteso: `{"value": 10.0, ...}` (100 × 0.1)

---

## Test protocollo MQTT

Con un broker Mosquitto locale:

```bash
# Avvia broker
mosquitto -v &

# Pubblica un valore
mosquitto_pub -t "impianto/pressione" -m "9.8"
```

Configura la sorgente MQTT in **Configurazione → Progetto → Protocolli → + Aggiungi MQTT**:
- Host: `localhost`, Port: `1883`
- Topic: `impianto/pressione`, Tag: `mqtt.pressione`

Verifica: `curl -k https://localhost:8443/api/tags/mqtt.pressione`

---

## Generazione segnali demo

Lo script `demo-driver.py` genera forme d'onda sui tag:

```bash
# Singola sinusoide
./scripts/demo-sine.py

# Multi-waveform
./scripts/demo-driver.py \
  --gen 'tag=sine,wave=sin,period=10,amp=50,offset=50' \
  --gen 'tag=cosine,wave=cos,period=8' \
  --gen 'tag=ramp,wave=saw,period=20' \
  --gen 'tag=noise,wave=random,amp=10,offset=50'
```

Forme d'onda disponibili: `sin`, `cos`, `tri`, `saw`, `square`, `random`, `step`.

---

## Diagnostica comune

### Il log del pannello, dall'IDE

Con l'IDE collegato a un dispositivo (Configurazione → Istanza → Device → Connessione), le righe del runtime del
pannello compaiono **dal vivo** nel cassetto log dell'IDE (☰ Menu → Log), in ordine con quelle dell'IDE, col nome
del dispositivo registrato davanti al target (o l'host, se non è registrato): scrivi quel nome nel filtro per tag per
vederle da sole. Arrivano **da INFO in su**, solo a un Admin, e finiscono anche nell'esportazione del log. Un pannello
con una versione di prima del 18-10-2026 non le manda: va aggiornato.

**Il DEBUG del dispositivo**, solo per l'**amministratore di piattaforma**: la casella «DEBUG dispositivo» nel cassetto
log. Finché è accesa, il pannello produce anche il DEBUG dei moduli di SWS (le librerie restano al livello di base) e
lo manda all'IDE; spegnendola, o chiudendo l'IDE, torna a INFO. Il DEBUG non finisce nel file di log del pannello.

### Il runtime non parte

```bash
# Controlla la porta occupata
ss -tlnp | grep -E "8443|8444"

# Log del runtime: un file JSONL al giorno
tail -f .run/logs/runtime-$(date +%F).jsonl
# oppure per systemd (binario nativo):
journalctl -u sws-runtime -f
# oppure per il container sul pannello:
podman logs -f sws-runtime
```

### Il frontend non carica

```bash
# La SPA è servita dal runtime sulla porta admin
curl -sk https://localhost:8444/ | head -5

# Health del runtime
curl -sk https://localhost:8444/health

# In dev con hot-reload (pnpm dev), il dev server Vite è su :5173
curl -s http://localhost:5173/ | head -5
```

### Certificato non accettato

Il browser mostra "ERR_CERT_AUTHORITY_INVALID" — è normale per certificati self-signed.
Soluzione:
1. Firefox: **Avanzate → Accetta il rischio e continua**
2. Chrome: digita `thisisunsafe` sulla pagina di warning
3. oppure: scarica il cert e aggiungilo alle CA fidate:
   ```bash
   curl -k https://localhost:8443/cert -o sws.crt
   # Firefox: Impostazioni → Certificati → Importa
   # Chrome: chrome://settings/certificates → Autorità
   ```

### Tag non si aggiorna

1. Verifica lo stato della sorgente: nell'albero di **Configurazione → Progetto → Protocolli** e nella sua card
2. Controlla il log: `tail -f .run/logs/runtime-$(date +%F).jsonl | grep '"ERROR"'`
3. Verifica connectivity alla sorgente:
   ```bash
   curl -k https://localhost:8443/api/tags/<id>  # quality deve essere "Good"
   ```

### Allarme non scatta

1. Verifica il valore del tag: `curl -k https://localhost:8443/api/tags/<tag>`
2. Verifica la condizione definita: **Configurazione → Progetto → Allarmi → [allarme]**
3. Controlla `on_delay_s` (potrebbe richiedere tempo prima dell'attivazione)

---

## Unità test Rust

```bash
cd sws-runtime
cargo test --workspace        # tutti i test
cargo test --package sws-auth # solo un crate
```

Nel workspace ci sono circa 1.800 test (`#[test]` e `#[tokio::test]`, contati il 20-10-2026), in tutti i crate.
Il frontend ha i suoi con Vitest: `cd sws-editor && pnpm test`.

---

← [Indice](MAIN.md) | [← API](13_api_reference.md) | [Successivo → Multilingua](15_multilingua.md) →
