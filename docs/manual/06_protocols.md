← [Indice](MAIN.md) | [← Widget](05_widget_reference.md) | [Successivo → Allarmi](07_alarms.md) →

---

# 06 — Protocolli di Comunicazione

SWS si connette ai dispositivi industriali tramite plugin di protocollo configurabili.
Ogni sorgente dati è definita nel `project.yaml` e configurabile dall'interfaccia
**Configurazione → Protocolli**.

---

## Modbus TCP

Connessione a PLC con interfaccia Ethernet tramite protocollo Modbus TCP (porta 502 default).

### Configurazione YAML

```yaml
sources:
  - kind: modbus_tcp
    id: plc1
    host: "192.168.1.100"
    port: 502
    unit_id: 1
    poll_interval_ms: 500
    registers:
      - tag: plc1.pressione
        address: 0          # Holding register (40001 in notazione Modicon = indirizzo 0)
        scale: 0.1          # Moltiplica il valore grezzo
      - tag: plc1.temperatura
        address: 10
        scale: 0.01
      - tag: plc1.valvola
        address: 100
        scale: 1
```

### Parametri

| Parametro | Descrizione | Default |
|-----------|-------------|---------|
| `host` | IP o hostname del PLC | — |
| `port` | Porta TCP | `502` |
| `unit_id` | Indirizzo Modbus (1-247) | `1` |
| `poll_interval_ms` | Intervallo polling | `500` |
| `registers[]` | Array di mapping registro→tag | — |

### Mapping registri

| Campo | Descrizione |
|-------|-------------|
| `tag` | ID tag SWS |
| `address` | Indirizzo registro holding (0-based) |
| `scale` | Fattore moltiplicativo: valore_tag = valore_raw × scale |

**Note**: SWS legge i Holding Registers (FC3). La notazione Modicon (`40001` = address 0, `40011` = address 10) richiede di sottrarre 40001.

---

## Modbus RTU

Connessione seriale RS-485/RS-232. Richiede un convertitore USB→RS485 o una porta seriale nativa.

### Configurazione YAML

```yaml
sources:
  - kind: modbus_rtu
    id: plc_seriale
    device: "/dev/ttyUSB0"    # o /dev/ttyS0 per porta seriale nativa
    baud_rate: 9600
    parity: "N"               # N=nessuna, E=pari, O=dispari
    data_bits: 8
    stop_bits: 1
    unit_id: 1
    poll_interval_ms: 1000
    registers:
      - tag: plc_seriale.livello
        address: 0
        scale: 0.1
```

### Parametri seriali

| Parametro | Valori | Default |
|-----------|--------|---------|
| `device` | `/dev/ttyUSB0`, `/dev/ttyS0`, ecc. | — |
| `baud_rate` | 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200 | `9600` |
| `parity` | `"N"`, `"E"`, `"O"` | `"N"` |
| `data_bits` | `7`, `8` | `8` |
| `stop_bits` | `1`, `2` | `1` |

---

## MQTT

Client MQTT per broker standard (Mosquitto, EMQX, HiveMQ, AWS IoT, ecc.).
Supporta MQTT 3.1.1 con TLS e autenticazione.

### Configurazione YAML

```yaml
sources:
  - kind: mqtt
    id: broker1
    host: "192.168.1.50"
    port: 1883
    client_id: "sws-runtime-1"
    topics:
      - tag: sensore.temperatura
        topic: "impianto/sensori/temp"
      - tag: sensore.umidita
        topic: "impianto/sensori/umidita"
        json_path: "sensors.humidity"     # estrae un campo JSON dal payload
      - tag: attuatore.valvola
        topic: "impianto/attuatori/valvola/stato"
        publish_topic: "impianto/attuatori/valvola/cmd"   # topic di scrittura
```

### Autenticazione

```yaml
sources:
  - kind: mqtt
    # ...
    username: "sws"
    password: "secret"           # non raccomandato in produzione
    password_env: "SWS_MQTT_PWD" # preferibile — usa variabile d'ambiente
```

### TLS

```yaml
    tls:
      enabled: true
      ca_cert_path: "/etc/sws/mqtt-ca.crt"
```

### Sparkplug B

Per ambienti con host SCADA Sparkplug B:

```yaml
    sparkplug:
      group_id: "Impianto1"
      host_id: "SWSHost"
      metrics:
        - metric_name: "Temperatura"
          tag: "sensore.temperatura"
          writable: false
        - metric_name: "Valvola"
          tag: "attuatore.valvola"
          writable: true
```

In modalità Sparkplug B, i `topics` normali vengono ignorati. SWS gestisce
automaticamente NBIRTH, NDATA, NCMD e il protocollo STATE.

### Parametri

| Parametro | Descrizione |
|-----------|-------------|
| `host, port` | Indirizzo broker |
| `client_id` | ID client univoco |
| `keep_alive_secs` | Heartbeat (default 60) |
| `clean_session` | Sessione pulita a ogni riconnessione (default true) |
| `qos` | Quality of Service 0/1/2 (default 0) |
| `last_will` | Messaggio LWT `{topic, payload, qos, retain}` |

### Scrittura verso il broker

Quando un tag ha un `publish_topic`, SWS pubblica il valore sul topic ogni volta
che il tag viene scritto tramite `PUT /api/tags/:id` o da un pulsante del sinottico.

---

## OPC-UA

Client OPC-UA con support per sottoscrizioni, scrittura, browse e security policies.

### Configurazione YAML

```yaml
sources:
  - kind: opcua_client
    id: macchina1
    endpoint_url: "opc.tcp://192.168.1.100:4840"
    security_policy: "None"
    auth:
      kind: anonymous
    subscription_interval_ms: 500
    nodes:
      - tag: macchina1.ciclo
        node_id: "ns=2;s=Machine.CycleTime"
        description: "Tempo di ciclo (s)"
      - tag: macchina1.pezzi
        node_id: "ns=2;i=1001"
```

### Autenticazione

```yaml
auth:
  kind: anonymous

# oppure:
auth:
  kind: username_password
  username: "operator"
  password_env: "SWS_OPCUA_PWD"   # raccomandato
```

### Security Policies

| Valore | Policy | Modalità |
|--------|--------|---------|
| `None` | Plaintext | Nessuna |
| `Basic128Rsa15` | Basic128Rsa15 (deprecato) | SignAndEncrypt |
| `Basic256` | Basic256 | SignAndEncrypt |
| `Basic256Sha256` | Basic256Sha256 (**raccomandato**) | SignAndEncrypt |
| `Aes128Sha256RsaOaep` | AES128-SHA256 | SignAndEncrypt |
| `Aes256Sha256RsaPss` | AES256-SHA256 | SignAndEncrypt |

Per policy non-None, SWS genera automaticamente un certificato client self-signed
in `<progetto>/.opcua-pki/<source-id>/`. Il server mostrerà il cert nella lista
"certificati non attendibili" al primo collegamento — approvarlo dall'interfaccia
del server OPC-UA.

### Formato NodeId

| Forma | Descrizione |
|-------|-------------|
| `ns=2;s=Machine.CycleTime` | Stringa in namespace 2 |
| `ns=2;i=1001` | Numerico in namespace 2 |
| `ns=0;i=2253` | Numerico nel namespace 0 (nodi standard) |

### Browse automatico

In **Configurazione → Protocolli → OPC-UA → Browse**, SWS può esplorare la struttura
ad albero del server OPC-UA e aggiungere nodi con un click.

### Euromap 77/83

SWS rileva automaticamente variabili Euromap (iniezione, estrusione) scansionando
i nodi del server. L'auto-detect è disponibile dal pannello Browse.

### Server OPC-UA

SWS può esporre i propri tag come nodi OPC-UA verso sistemi upstream:

```yaml
sources:
  - kind: opcua_server
    id: sws_server
    port: 4840
    namespace_uri: "urn:soligolab:sws"
    nodes:
      - tag: pressione
        node_id: "Pressione"   # opzionale; default = tag id
      - tag: temperatura
```

---

## Siemens S7

Connessione a PLC Siemens S7-300/400/1200/1500 tramite protocollo S7 nativo.

### Configurazione YAML

```yaml
sources:
  - kind: s7
    id: siemens1
    ip: "192.168.1.101"
    rack: 0
    slot: 1
    poll_interval_ms: 200
    tags:
      - tag: siemens1.pressione
        area: db          # db, m (merker), i (input), q (output)
        db_num: 10        # numero DB (solo per area = db)
        byte_offset: 0    # offset byte nell'area
        bit_offset: 0     # offset bit (solo per bool)
        data_type: real   # bool, byte, int, word, dint, real
        writable: false
      - tag: siemens1.valvola
        area: m
        db_num: 0
        byte_offset: 0
        bit_offset: 3
        data_type: bool
        writable: true
```

### Aree di memoria

| Area | Descrizione |
|------|-------------|
| `db` | Data Block (richiede `db_num`) |
| `m` | Merker (memorie interne) |
| `i` | Input digitali |
| `q` | Output digitali |

### Tipi di dato

| Tipo | Dimensione | Note |
|------|-----------|------|
| `bool` | 1 bit | richiede `bit_offset` |
| `byte` | 1 byte | unsigned 0-255 |
| `int` | 2 byte | signed -32768..32767 |
| `word` | 2 byte | unsigned 0-65535 |
| `dint` | 4 byte | double int signed |
| `real` | 4 byte | IEEE 754 float |

### Rack e slot

I valori dipendono dall'hardware:
- S7-1200/1500: rack=0, slot=1
- S7-300 con CPU standard: rack=0, slot=2
- S7-400: variabile — consultare la configurazione HW in STEP 7

---

## EtherNet/IP

Connessione a PLC Allen-Bradley (Rockwell) ControlLogix / CompactLogix tramite EtherNet/IP.

### Configurazione YAML

```yaml
sources:
  - kind: en_ip
    id: ab1
    ip: "192.168.1.102"
    slot: 0
    poll_interval_ms: 250
    tags:
      - tag: ab1.portata
        plc_tag: "Flow_Rate"          # nome del tag simbolico nel PLC
        data_type: real
        writable: false
      - tag: ab1.set_point
        plc_tag: "Setpoint_Temp"
        data_type: real
        writable: true
```

### Tipi di dato supportati

`bool`, `sint`, `int`, `dint`, `lint`, `real`

---

## HomeAssistant

Integrazione con HomeAssistant tramite WebSocket API.
Supporta lettura di stati entità e scrittura tramite call_service.

### Configurazione YAML

```yaml
sources:
  - kind: homeassistant
    id: ha1
    url: "http://homeassistant.local:8123"
    token_env: "HA_TOKEN"   # Long-lived access token
    entities:
      - tag: ha1.riscaldamento
        entity_id: "switch.riscaldamento"
        attribute: "state"            # opzionale; default "state"
      - tag: ha1.temp_salone
        entity_id: "sensor.temperatura_salone"
      - tag: ha1.valvola_cucina
        entity_id: "valve.cucina"
        write_domain: "valve"         # dominio per call_service
        write_service: "set_valve_position"
```

### Token di accesso

Genera un **Long-lived access token** in HomeAssistant:
**Profilo → Sicurezza → Token di accesso di lunga durata → Crea token**

Imposta la variabile d'ambiente prima di avviare il runtime:
```bash
export HA_TOKEN="eyJh..."
./scripts/start_runtime.sh
```

---

## Configurazione tramite UI

Tutte le sorgenti possono essere configurate senza editare YAML:

1. **Configurazione → Protocolli → + Aggiungi [tipo]**
2. Compila i campi del form
3. **Salva** → il runtime ricarica la configurazione automaticamente

Il runtime effettua un tentativo di connessione immediato dopo il salvataggio.
Lo stato (connesso / errore) è visibile in **Configurazione → Stato**.

---

← [Indice](MAIN.md) | [← Widget](05_widget_reference.md) | [Successivo → Allarmi](07_alarms.md) →
