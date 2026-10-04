# La configurazione dei protocolli come bus → dispositivi → tag

> **Seme — decisione** (04-10-2026). Richiesta del maintainer: «a livello grafico, parlo del modbus rtu come esempio
> ma vale un po' per tutti i protocolli, vorrei che la configurazione seguisse il concetto di bus + device: configuro
> quindi il bus e poi al suo interno aggiungo un nodo per id e al suo interno poi configuro i tag».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## L'idea

Tre livelli in Configurazione → Protocolli: il **bus** (la connessione: porta seriale e parametri di linea, oppure
indirizzo e porta), dentro i **dispositivi** (identificati dal loro indirizzo sul bus: lo `unit_id` Modbus, lo slot S7,
…), dentro i **tag** di ciascun dispositivo.

## Misurato il 04-10-2026

- `SourceDef` (`sws-core/src/project.rs` ≈ riga 504) ha otto tipi oltre S7: `ModbusTcp`, `ModbusRtu`, `OpcUaServer`,
  `Mqtt`, `OpcUaClient`, `HomeAssistant`, `EnIp`, `Host`. Ogni sorgente è **una connessione con un solo dispositivo**:
  Modbus ha un solo `unit_id` per sorgente, con `registers` dentro.
- **Il caso RTU è anche un difetto**: più slave sulla stessa linea RS-485 richiedono oggi più sorgenti, e ognuna apre la
  stessa porta seriale (`sws-plugin-modbus`, `run_rtu` → `tokio_serial::new(&cfg.device, …)`): la seconda non la ottiene,
  o due task si contendono la linea. Con bus → dispositivi la porta si apre una volta e i dispositivi si interrogano a
  turno. Lo stesso per un gateway Modbus TCP con più unit id dietro un indirizzo.
- Il supervisore (`sws-web/src/source_supervisor.rs`) ragiona per sorgente (un task per sorgente, riavvio, `owned_tags`):
  diventerebbe un task per bus.
- IDE: 19 file in `sws-editor/src/config/sorgenti/` (una card per tipo, più i modali di browse); l'albero della
  Configurazione mostra già una foglia per sorgente.
- Il motore Modbus della Fase 3 (04-10-2026) ha già il ciclo per mappatura e la riconnessione comune
  (`sws_core::riconnessione`): un bus con più dispositivi è un ciclo esterno su quelli.

## Come potrebbe mappare sui protocolli (da verificare nella sessione di plan)

| Protocollo | Bus | Dispositivo | Tag |
|---|---|---|---|
| Modbus RTU | porta seriale, baud, parità… | unit id (slave) | registri |
| Modbus TCP | host:porta (anche un gateway) | unit id | registri |
| S7 | rete (forse niente bus: un PLC = un indirizzo) | IP, rack, slot | DB/area/offset |
| EtherNet/IP | come S7 | IP, slot | tag CIP |
| OPC-UA client | server (endpoint, sicurezza) | — o cartelle/namespace | nodi |
| MQTT | broker | dispositivo = prefisso dei topic? | topic |
| HomeAssistant | istanza | area/dispositivo HA? | entità |

Per alcuni il terzo livello non esiste davvero (OPC-UA, Host): da decidere se la UI li mostra a due livelli o forza tre.

## Domande da cui partire

1. Il modello in `project.yaml` cambia (sorgente → bus con `devices: [...]`) o resta com'è e la UI raggruppa?
   Il caso RTU spinge per il primo: è il runtime che deve aprire la porta una volta.
2. Migrazione dei progetti esistenti: una sorgente di oggi = un bus con un dispositivo, convertita all'apertura (come lo
   storico compatto) o letta in tutti e due i formati?
3. Parametri per dispositivo: intervallo di polling, ordine dei byte (oggi sulla sorgente), timeout.
4. Diagnostica per dispositivo (risponde / non risponde) nell'albero.
5. Quali protocolli entrano nel primo giro (Modbus RTU + TCP di sicuro) e quali dopo.
