← [Indice](MAIN.md) | [← API](13_api_reference.md)

---

# 14 — Test e Diagnostica

Questa guida descrive come verificare il corretto funzionamento di SWS
e diagnosticare i problemi più comuni.

---

## Smoke test rapido

Prima di qualsiasi test approfondito, verifica che il runtime risponda:

```bash
# Avvia in dev
./scripts/dev.sh both

# Health check
curl -k https://localhost:8443/health
# → ok

# Metriche Prometheus
curl -k https://localhost:8443/metrics | head -5
# → # HELP sws_uptime_seconds ...
# → sws_uptime_seconds 42.1

# Tag snapshot (senza auth — viewer anonimo)
curl -k https://localhost:8443/api/tags
# → {"counter": {"value": 0, "quality": "Good", ...}, ...}
```

---

## Verifica login e ruoli

```bash
# Login come admin
TOKEN=$(curl -sk -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

echo "Token: $TOKEN"

# Verifica accesso progetto (Admin only)
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
# Il runtime deve essere in esecuzione
./scripts/dev.sh both &

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

### Test inclusi (`e2e/editor.spec.ts`)

| Test | Cosa verifica |
|------|--------------|
| Login → editor | Autenticazione e caricamento progetto |
| Aggiungi rettangolo | Aggiunta oggetto dalla palette |
| Salva e ricarica | Persistenza oggetto dopo save + reload |

### Screenshot automatici (per la documentazione)

```bash
cd sws-editor
npx playwright test e2e/screenshots.spec.ts
```

Genera 10 screenshot in `docs/manual/screenshots/`.
Richiede il runtime in esecuzione su `http://localhost:5173`.

### Artefatti test

Disponibili in `sws-editor/test-results/` e `playwright-report/` (gitignored):
- Screenshot su fallimento
- Trace zip (analizzabile con `npx playwright show-trace`)
- HTML report

---

## Test protocollo Modbus

Con un simulatore Modbus (es. `pymodbus`):

```bash
# Installa pymodbus
pip install pymodbus

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

Configura una sorgente Modbus in **Configurazione → Protocolli → + Aggiungi Modbus TCP**:
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

Configura la sorgente MQTT in **Configurazione → Protocolli → + Aggiungi MQTT**:
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

### Il runtime non parte

```bash
# Controlla la porta occupata
ss -tlnp | grep -E "8443|8444"

# Log del runtime
tail -f .run/logs/runtime.log
# oppure per systemd:
journalctl -u sws-runtime -f
```

### Il frontend non carica

```bash
# Verifica Vite
curl -s http://localhost:5173/ | head -5

# Verifica proxy a 8444
curl -sk https://localhost:8444/health
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

1. Verifica stato connessione: **Configurazione → Stato**
2. Controlla il log: `tail -f .run/logs/runtime.log | grep ERROR`
3. Verifica connectivity alla sorgente:
   ```bash
   curl -k https://localhost:8443/api/tags/<id>  # quality deve essere "Good"
   ```

### Allarme non scatta

1. Verifica il valore del tag: `curl -k https://localhost:8443/api/tags/<tag>`
2. Verifica la condizione definita: **Configurazione → Allarmi → [allarme]**
3. Controlla `on_delay_s` (potrebbe richiedere tempo prima dell'attivazione)

---

## Unità test Rust

```bash
cd sws-runtime
cargo test --workspace        # tutti i test
cargo test --package sws-auth # solo un crate
```

Copertura attuale: 53+ test unitari su sws-auth, sws-historian, sws-core.

---

← [Indice](MAIN.md) | [← API](13_api_reference.md)
