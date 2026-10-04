← [Indice](MAIN.md) | [← Widget](05_widget_reference.md) | [Successivo → Allarmi](07_alarms.md) →

---

# 06 — Protocolli di Comunicazione

SWS si connette ai dispositivi industriali tramite plugin di protocollo configurabili.
Ogni sorgente dati è definita nel `project.yaml` e configurabile dall'interfaccia
**Configurazione → Protocolli**.

---

## Modbus TCP

Connessione a PLC con interfaccia Ethernet tramite protocollo Modbus TCP (porta 502 default).

### Bus e dispositivi (dal 04-10-2026)

Una sorgente Modbus è un **bus**: per TCP un indirizzo, per RTU una porta seriale. Dentro ci sono i **dispositivi**
(`devices`), uno per unit id, e dentro ogni dispositivo le sue mappature. Un gateway Modbus TCP con più apparecchi
dietro, o una linea RS-485 con più slave, è **una** sorgente con più dispositivi: la connessione si apre una volta e i
dispositivi si interrogano a turno, ognuno col suo intervallo, ordine di parole/byte e timeout.

Nell'IDE: Configurazione → Protocolli → il bus → i suoi dispositivi, nell'albero a sinistra. La card del bus ha la
connessione, l'intervallo predefinito e l'elenco dei dispositivi («+ Aggiungi dispositivo» prende il primo unit id
libero); la card del dispositivo ha unit id, nome, ordine, intervallo (vuoto = quello del bus), timeout e mappature.

**Stato**: un pallino accanto al bus e a ogni dispositivo, nell'albero e nelle card — verde risponde, ambra risponde ma
qualche registro dà errore, rosso non risponde (il motivo nel tooltip), grigio non attivo (sorgente ferma, mai
collegata o non ancora salvata). È lo stato visto dal runtime con cui l'IDE parla.

**Il formato di prima** (`unit_id`, `ordine` e `registers` sulla sorgente, senza `devices`) si legge ancora come un bus
con un dispositivo; l'IDE lo riscrive nel formato nuovo alla prima modifica di un dispositivo. Con `devices` presenti, i
campi di prima sono ignorati (il validatore lo segnala).

### Il catalogo dei dispositivi

Dentro un bus, **«+ Dal catalogo…»** aggiunge un dispositivo completo e già configurato (tipo, variabile e
dispositivo si salvano subito, insieme alle altre modifiche aperte nei Protocolli): si sceglie il modello (con la
sua icona), l'unit id, il nome della variabile e i gruppi di registri da leggere. Nascono dei **tipi annidati** per il modello — un sotto-tipo per gruppo (`pixsys_mcm260x_9ad__ingressi`) e il tipo
della variabile con un membro per gruppo scelto, così le variabili si leggono `mcm260x_9ad.ingressi.di1`,
`mcm260x_9ad.diagnostica.errore_fram` — e, prima di queste righe, nascevano un **tipo** per il modello
(tutti i suoi registri, i bit delle word come membri vero/falso, unità e decimali), una **variabile** istanza di quel
tipo e il **dispositivo** del bus con le mappature, l'ordine dei byte e il timeout del modello. Un secondo dispositivo
dello stesso modello riusa il tipo. Tipo e variabile si salvano subito; il dispositivo si salva coi Protocolli.

**Eliminare un dispositivo** salvato chiede cosa fare delle sue variabili: «Dispositivo e variabili» toglie anche le
variabili che nessun altro mappa (e i tipi rimasti senza istanze); «Solo il dispositivo» le tiene, e un dispositivo nuovo
dello stesso modello le riprende dal catalogo scegliendo **«Riprendi …»** al posto di «Variabile nuova»: grafici,
allarmi e storico che le usano restano agganciati.

Oggi il catalogo ha i Pixsys ATR121/142/144/244, STR551/561/571, MCM260X nelle sei varianti (1AD, 2AD, 3AD, 4AD,
5AD, 9AD, ognuna coi suoi I/O), MCM280X, DRR245/460, dalla mappa dei registri
fornita da Pixsys — **da verificare sul manuale di ogni prodotto** (i decimali `Dec.P` in particolare: la scala
proposta è 0.1). I file stanno in `catalogo/dispositivi/` e si leggono a ogni apertura: correggerli o aggiungerne è
spiegato in `docs/HOWTO.md`, capitolo 22.

### Configurazione YAML

```yaml
sources:
  - kind: modbus_tcp
    id: gateway1
    host: "192.168.1.100"
    port: 502
    poll_interval_ms: 500      # predefinito per i dispositivi
    devices:
      - unit_id: 1
        nome: pompa
        registers:
          - tag: pompa.pressione
            address: 0          # Holding register (40001 in notazione Modicon = indirizzo 0)
            scale: 0.1          # Moltiplica il valore grezzo (tipi storici)
      - unit_id: 2
        nome: inverter
        ordine: cdab            # questo dispositivo mette la parola bassa prima
        poll_interval_ms: 200   # il suo intervallo
        timeout_ms: 1000        # default 3000
        registers:
          - tag: inverter.velocita
            address: 10
```

### Parametri

| Parametro | Descrizione | Default |
|-----------|-------------|---------|
| `host` | IP o hostname del PLC o del gateway | — |
| `port` | Porta TCP | `502` |
| `poll_interval_ms` | Intervallo di polling predefinito dei dispositivi | `1000` |
| `devices[]` | I dispositivi sul bus | — |

### Parametri del dispositivo

| Parametro | Descrizione | Default |
|-----------|-------------|---------|
| `unit_id` | Indirizzo Modbus (1-247), unico nel bus | `1` |
| `nome` | Etichetta libera | — |
| `modello` | Da dove viene il dispositivo (`marca/prodotto@versione`); lo riempirà il catalogo dei dispositivi noti | — |
| `ordine` | Ordine di parole/byte (vedi sotto) | `abcd` |
| `poll_interval_ms` | Intervallo di questo dispositivo | quello del bus |
| `timeout_ms` | Attesa massima di una risposta | `3000` |
| `registers[]` | Mappature registro→tag | — |

### Mapping registri

| Campo | Descrizione |
|-------|-------------|
| `tag` | ID tag SWS: un tag, una **foglia** (`m1.velocita`) o la **radice** di un'istanza (`m1`) |
| `area` | `holding` (default, FC3/FC6/FC16), `input` (FC4, sola lettura), `coil` (FC1/FC5/FC15, bit), `discrete` (FC2, bit, sola lettura) |
| `address` | Indirizzo di partenza (0-based) |
| `scale` | Per i tipi storici, o con un `formato`: valore_tag = valore_raw × scale |
| `formato` | Il tipo **sul filo** (`i16`, `u32`, `f32`…): decide registri e decodifica al posto del tipo del tag, e la scala si applica sempre — un `i16` × 0.1 dà −12.5 in un tag `f32` |
| `bit` | Un bit (0-15) del registro, letto come vero/falso; in scrittura il registro si legge, si cambia il bit e si riscrive. Più bit della stessa word sono una lettura sola |
| `sola_lettura` | La scrittura è rifiutata anche su un holding register |

E sul dispositivo: `ordine: abcd | cdab | badc | dcba` (default `abcd`), come il dispositivo mette i valori su più
registri — ABCD parola alta e byte alto prima, CDAB parole scambiate, BADC byte scambiati, DCBA tutto rovesciato.

**I registri vengono dal tipo** (dal 04-10-2026). Un tag dichiarato `i16` si legge con segno, un `u32`/`i32`/`f32`
occupa 2 registri, un `u64`/`i64`/`f64` 4, un `string(10)` 5 (due caratteri per registro), un `bool` 1. Mappando la
**radice** di un'istanza (un tipo struttura, Configurazione → Variabili → Tipi) si legge **un blocco**: i membri uno dopo
l'altro, nell'ordine dichiarato; sulle aree a bit ogni membro è un bit. Una scrittura su una foglia scrive solo i suoi
registri. La colonna «Registri» della card dice quanti ne legge ogni riga.

**Compatibilità**: un tag col tipo **storico** (`float`, `int`, `bool`, `string`, o senza tipo — il caso di tutti i
progetti fatti prima) si legge come sempre, un registro `u16` per la scala. Per leggere un `f32` su due registri si
dichiara il tag `f32`.

**Errori**: un registro che il dispositivo rifiuta (indirizzo che non esiste) marca Bad solo i suoi tag, gli altri
continuano; un dispositivo che non risponde marca Bad i suoi tag e diventa rosso, mentre gli altri del bus continuano;
una connessione persa, o nessun dispositivo che risponda per tre giri, marca Bad tutto e il bus riconnette da solo con
un'attesa crescente (1 → 30 s). La notazione Modicon (`40001` = address 0) richiede di sottrarre 40001.

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
    poll_interval_ms: 1000
    devices:                  # gli slave sulla linea: la porta si apre una volta sola
      - unit_id: 1
        registers:
          - tag: serbatoio.livello
            address: 0
            scale: 0.1
      - unit_id: 5
        nome: contatore
        registers:
          - tag: contatore.energia
            address: 100
```

**La porta seriale** si sceglie da una tendina con le porte **del dispositivo connesso**, viste dal suo runtime
(`GET /api/host/seriali`): i nomi delle prese Pixsys (`/dev/ttyCOM1` → `ttyS2` sul TC620), le UART, gli adattatori USB,
con accanto se il runtime la può aprire. Senza dispositivo connesso mostra quelle del PC e lo dice; «✎ Inserisci a
mano…» permette di scriverla comunque (pannello spento o non raggiungibile). Nel container il runtime vede solo le
porte che il servizio gli passa: serve la configurazione del servizio **quadlet 2** (dalla 2.12.0-rc.22), che il
pannello propone di aggiornare.

Gli slave sulla stessa linea vanno in **un** bus: due sorgenti RTU sulla stessa porta si contendono la linea (il
validatore lo segnala). I parametri del dispositivo sono quelli di Modbus TCP.

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
in `<progetto>/opcua-pki/<source-id>/`. Il server mostrerà il cert nella lista
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

## Host — le risorse di sistema come tag

La sorgente `host` legge le risorse del dispositivo su cui gira il runtime e le scrive nei tag, **in sola
lettura**. Serve a mostrare con indicatori e trend, o a usare in allarmi e script, CPU, memoria,
temperatura, disco, rete, nome e numero di serie. Non c'è nessun dispositivo da collegare: nel container
il runtime vede già `/proc` e `/sys/class/thermal` dell'host.

```yaml
sources:
  - kind: host
    id: host1
    poll_interval_ms: 2000
    metrics:
      - { tag: host.cpu_pct,       metric: cpu_pct }
      - { tag: host.temp_cpu,      metric: temp,          param: cpu-thermal }
      - { tag: host.disk_data_pct, metric: disk_used_pct, param: /var/sws/projects }
      - { tag: host.serial,        metric: serial_number }
```

| Metrica | `param` | Note |
|---|---|---|
| `cpu_pct`, `cpu_core_pct` | — / indice del core | 0-100 % |
| `load1`, `load5`, `load15` | — | load average |
| `mem_used_pct`, `mem_used_mb`, `mem_available_mb`, `mem_total_mb`, `swap_used_pct` | — | |
| `temp` | nome della zona (`cpu-thermal`, `gpu-thermal`, `<hwmon>/tempN`) | °C |
| `disk_used_pct`, `disk_free_gb` | mount point | nel container il `/` è un overlay: per i dati usare `/var/sws/projects` |
| `net_rx_bps`, `net_tx_bps` | interfaccia | byte/s |
| `uptime_s` | — | uptime dell'**host**, non del processo |
| `hostname`, `serial_number`, `model` | — | **testo**: il tag va dichiarato `data_type: string` |

Una metrica non disponibile (zona o mount sconosciuto, scheda senza seriale) lascia il tag con qualità
**Bad**. Il numero di serie e il modello vengono dal device-tree (ARM); nel container `install-container.sh`
monta `/sys/firmware/devicetree/base` in sola lettura su `/host/devicetree`. Su x86 il seriale viene dal DMI
(di solito leggibile solo da root) e il modello resta vuoto. Il template `host-monitor` è un punto di partenza.

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
