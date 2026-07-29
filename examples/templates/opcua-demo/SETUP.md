# Setup — Template OPC-UA Demo

Questo template apre 5 nodi di un simulatore OPC-UA via `subscription_interval_ms = 500` e li espone in:
- **Page 1 (Live)** — 2 gauge (temperatura, pressione), stato macchina + LED ready, cycle time, simbolo pompa pilotato da `sim.machine_ready`, trend live multi-tag (temperatura + pressione, finestra 120 s).
- **Page 2 (Tabella nodi)** — riga per NodeId con valore corrente, hint su Euromap auto-detect e browse manuale.

## 1. Avvia un simulatore OPC-UA

### Opzione A — `node-opcua` server example (zero config)

```bash
npx -y node-opcua-server
```

Il server bind di default su `opc.tcp://localhost:4840`. Quasi tutti gli esempi di node-opcua espongono `ns=1;s=Temperature` e `ns=1;s=Pressure` come Variables under `ObjectsFolder`. Per i nodi Euromap 77 (`ns=2;s=CycleTime`, `ns=2;s=MachineState`, `ns=2;s=MachineReady`) probabilmente dovrai aggiungerli manualmente editando l'esempio (un fork minimal con quei 3 nodi è sufficiente).

### Opzione B — Prosys OPC UA Simulation Server (GUI)

Scarica dal sito Prosys (free per uso non commerciale). Endpoint default `opc.tcp://<host>:53530/OPCUA/SimulationServer`. Aggiorna `endpoint_url` in `project.yaml` se necessario.

I NodeId di Prosys cambiano fra release (`ns=3;s=...` o `ns=5;s=...`): usa **🔍 Sfoglia server** nell'editor (ConfigView → Protocolli → OPC-UA → bottone in card) per recuperarli e re-importarli, oppure **🤖 Rileva Euromap** se hai abilitato il modulo Euromap nel simulatore.

## 2. Apri il template

1. Avvia SWS: `./scripts/start_runtime.sh`
2. WelcomeScreen → "Crea nuovo da template" → **OPC-UA Demo (BL-005)** → dai un nome al progetto e crea.
3. Login se hai avviato con `SWS_ADMIN_USER`/`SWS_ADMIN_PASSWORD` (senza quelle variabili il
   runtime parte in no-auth e si entra diretti) → la sorgente OPC-UA `sim-opcua` parte sola.

## 3. Tipiche modifiche

- **Endpoint diverso** → ConfigView → Protocolli → card "OPC-UA: sim-opcua" → `Endpoint URL`.
- **Security policy ≠ None** → cambia il dropdown a `Basic256Sha256` (o altre). La prima connessione fallisce con cert rejected; trustta il cert SWS nel simulatore (per Prosys: `Certificates → Rejected → Trust`). Cert SWS persistito in `<project>/.opcua-pki/sim-opcua/`.
- **Autenticazione user/password** → ConfigView → toggle UsernamePassword, riempi i campi. Il `password_env` vince su `password` quando entrambi sono impostati (per tenere secret fuori dallo YAML).

## 4. Smoke-test rapido

- Page 1: i due gauge si muovono entro pochi secondi (subscription_interval_ms = 500). Il trend disegna sia temperatura che pressione (canale extra_tags).
- Page 2: i 5 valori in tabella aggiornano in tempo reale; se un nodo è offline il dot di qualità diventa rosso.
- Alarm: se `sim.temperature > 60` → banner "Warning"; se `sim.pressure > 8` → banner "Critical" (visibile dopo qualche minuto se il simulatore varia abbastanza).

## 5. Niente OPC-UA sotto mano?

Puoi comunque aprire il template — la sorgente fallirà la connessione e i tag rimarranno a "Bad" (puntini rossi). È utile come scaffold per copiare la struttura di un progetto OPC-UA reale.
