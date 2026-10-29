← [Indice](MAIN.md) | [← Widget](05_widget_reference.md) | [Successivo → Allarmi](07_alarms.md) →

---

# 06 — Protocolli di Comunicazione

> Le sorgenti di dati del campo, protocollo per protocollo: la configurazione YAML, i parametri, la sicurezza. Per
> chi collega SWS a PLC, broker e server. Dove passano le connessioni e cosa aprire sul firewall sta nel
> [capitolo 18, §5.6](18_container_e_comunicazione.md#56-il-campo).
>
> Misurato sul codice il 20-10-2026.

SWS si connette ai dispositivi industriali tramite plugin di protocollo configurabili.
Ogni sorgente dati è definita nel `project.yaml` e configurabile dall'interfaccia
**Configurazione → Progetto → Protocolli**.

---

## Dove girano le sorgenti e le scoperte

Le sorgenti, le scoperte (sfoglia del broker MQTT, sfoglia OPC-UA, rilevamento Euromap, sfoglia di Home
Assistant), i certificati OPC-UA e la prova di un datastore **le fa chi vede l'impianto**:

- **IDE in locale, senza pannello collegato**: la macchina dell'IDE, come sempre.
- **Con un pannello collegato** (Configurazione → Istanza → Device): il pannello. L'IDE gli manda la richiesta
  con i segreti presi dal **proprio** progetto, quindi funziona anche se il progetto non è ancora stato
  distribuito.
- **Nel cloud**: le sorgenti **non partono** nel container del progetto, perché il VPS l'impianto non lo vede.
  Valori vivi, scoperte e comandi passano dal pannello collegato. Il pannello del progetto si ricorda: alla
  riapertura l'IDE si ricollega da solo, e «Disconnetti» lo fa dimenticare. Senza pannello, una scoperta lo
  dice invece di cercare a vuoto.

Un pannello con una versione precedente risponde «senza questa funzione: aggiornalo».

## Modbus TCP

Connessione a PLC con interfaccia Ethernet tramite protocollo Modbus TCP (porta 502 default).

### Bus e dispositivi (dal 04-10-2026)

Una sorgente Modbus è un **bus**: per TCP un indirizzo, per RTU una porta seriale. Dentro ci sono i **dispositivi**
(`devices`), uno per unit id, e dentro ogni dispositivo le sue mappature. Un gateway Modbus TCP con più apparecchi
dietro, o una linea RS-485 con più slave, è **una** sorgente con più dispositivi: la connessione si apre una volta e i
dispositivi si interrogano a turno, ognuno col suo intervallo, ordine di parole/byte e timeout.

Nell'IDE: Configurazione → Progetto → Protocolli → il bus → i suoi dispositivi, nell'albero a sinistra. La card del bus ha la
connessione, l'intervallo predefinito e l'elenco dei dispositivi («+ Aggiungi dispositivo» prende il primo unit id
libero); la card del dispositivo ha unit id, nome, ordine, intervallo (vuoto = quello del bus), timeout e mappature.

**Un indirizzo TCP con un dispositivo solo è il dispositivo** (dal 25-10-2026). Nel caso normale — un modulo, un IP —
il livello bus non si vede: nell'albero la sorgente non ha figli, e la sua card ha insieme connessione e dispositivo
(unit id, nome, mappature). Sotto c'è **«+ Un altro dispositivo dietro questo indirizzo (gateway)»**: con un secondo
unit id il bus torna un livello, coi dispositivi sotto. Nel progetto non cambia niente: `devices` c'è sempre. Una
sorgente Modbus TCP nuova nasce senza dispositivi, e il primo arriva da «+ Aggiungi dispositivo» o «Dal catalogo». Su
RTU il bus è la porta seriale e resta sempre visibile.

**Stato**: un pallino accanto al bus e a ogni dispositivo, nell'albero e nelle card — verde risponde, ambra risponde ma
qualche registro dà errore, rosso non risponde (il motivo nel tooltip), grigio non attivo (sorgente ferma, mai
collegata o non ancora salvata). È lo stato visto dal runtime con cui l'IDE parla.

**Il formato di prima** (`unit_id`, `ordine` e `registers` sulla sorgente, senza `devices`) si legge ancora come un bus
con un dispositivo; l'IDE lo riscrive nel formato nuovo alla prima modifica di un dispositivo. Con `devices` presenti, i
campi di prima sono ignorati (il validatore lo segnala).

### Il catalogo dei dispositivi

Dentro un bus, **«+ Dal catalogo…»** aggiunge un dispositivo completo e già configurato (tipo, variabile e
dispositivo si salvano subito, insieme alle altre modifiche aperte nei Protocolli): si sceglie il modello (con la
sua icona), l'unit id, il nome della variabile e i gruppi di registri da leggere. La finestra mostra **solo i modelli
che quel bus raggiunge** (dal 25-10-2026, `modbus.trasporto` nei file del catalogo): un MCM280X parla solo TCP, un
ATR121 solo RTU, e un modello messo sul bus sbagliato è un errore di validazione. Nascono dei **tipi annidati** per il modello — un sotto-tipo per gruppo (`pixsys_mcm260x_9ad__ingressi`) e il tipo
della variabile con un membro per gruppo scelto, così le variabili si leggono `mcm260x_9ad.ingressi.di1`,
`mcm260x_9ad.diagnostica.errore_fram` — e, prima di queste righe, nascevano un **tipo** per il modello
(tutti i suoi registri, i bit delle word come membri vero/falso, unità e decimali), una **variabile** istanza di quel
tipo e il **dispositivo** del bus con le mappature, l'ordine dei byte e il timeout del modello. Un secondo dispositivo
dello stesso modello riusa il tipo. Tipo e variabile si salvano subito; il dispositivo si salva coi Protocolli.

**La configurazione del modulo** (dal 25-10-2026). Un dispositivo nato dal catalogo, se il suo modello ha parametri di
configurazione (tipo di sonda di ogni ingresso, unità, tipo di uscita, modo degli encoder…), ha nella card la sezione
**«Configurazione del modulo»**: per ogni parametro si sceglie il valore che il progetto vuole, oppure «— non gestito —»
per lasciarlo com'è sul modulo. A ogni collegamento, alla prima risposta del dispositivo, il runtime **legge** quei
parametri e **scrive solo quelli diversi**: vince il progetto, e un modulo sostituito o resettato torna configurato da
solo. Sugli MCM260X la scrittura va nell'area che salva in memoria dopo 10 secondi (4001-4100) invece che a ogni
scrittura, per non consumarla. Il log del runtime dice cosa ha cambiato («setup del modulo — tipo_sensore_ai1 da 0 a
12») e cosa il modulo ha rifiutato. Indirizzo, baud e parità non si offrono: cambiati dal progetto, il runtime perderebbe
il modulo. Nel YAML è `devices[].setup: [{nome, indirizzo, valore, indirizzo_scrittura}]`, completo: il runtime non
legge il catalogo.

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
**radice** di un'istanza (un tipo struttura, Configurazione → Progetto → Tipi) si legge **un blocco**: i membri uno dopo
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

### Lo stato all'avvio (dal 25-10-2026)

MQTT è un protocollo a eventi: SWS si iscrive ai topic e riceve un valore quando qualcuno lo pubblica. Alla
sottoscrizione il broker consegna subito l'ultimo valore **solo se era stato pubblicato con `retain`**. Se non è
così, dopo un riavvio del pannello il tag resta senza valore (sul sinottico: bianco, qualità incerta) finché lo
stato non cambia.

Per questi casi una riga della mappatura può avere una **richiesta di stato**: a ogni collegamento al broker,
dopo le sottoscrizioni, SWS pubblica il `payload` sul `topic` indicato, e il dispositivo risponde sul topic di
stato della riga.

```yaml
topics:
  - tag: garage.luce1
    topic: zigbee2mqtt/garage
    json_path: state_l1
    publish_topic: zigbee2mqtt/garage/set
    richiesta_stato:
      topic: zigbee2mqtt/garage/get
      payload: '{"state_l1":""}'
```

Nella scheda della sorgente, il pulsante **⟳** di ogni riga aggiunge o toglie la richiesta (già compilata come
la vuole Zigbee2MQTT, e modificabile), e il pulsante **«⟳ Richiedi lo stato all'avvio»** sotto la tabella la
compila su tutte le righe `zigbee2mqtt/…` che non l'hanno. Più righe con la stessa richiesta la mandano una
volta sola. Il topic della richiesta non può contenere `+` né `#`: il broker chiuderebbe la connessione
dell'intera sorgente, e la validazione del progetto lo segnala come errore.

#### Zigbee2MQTT: cosa sa fare e cosa no

- **Per default Zigbee2MQTT non pubblica con `retain`.** È il motivo per cui serve la richiesta. In alternativa
  si può accendere `retain: true` sul dispositivo (in `configuration.yaml`, sezione `devices:`, o dalla sua
  interfaccia): il broker conserva l'ultimo stato e la richiesta non serve più. Le due cose possono convivere.
- **`…/get` funziona solo per gli attributi che il dispositivo sa rileggere.** Prese, interruttori e luci
  (alimentati dalla rete) rispondono. I **dispositivi a batteria** — sensori di porta, di movimento, di
  temperatura — dormono quasi sempre e non rispondono a una lettura: per quelli l'unica strada è `retain: true`,
  oppure aspettare il loro prossimo invio periodico.
- **Gli interruttori a più canali** (come uno switch a tre vie) hanno un campo per canale: `state_l1`, `state_l2`,
  `state_l3`. Il JSON path della riga è quel campo, e la richiesta chiede proprio quello.
- **Il nome nel topic è il `friendly_name`** del dispositivo: se lo si cambia in Zigbee2MQTT cambiano insieme il
  topic di stato e quello della richiesta, e le righe vanno corrette entrambe.
- Se Zigbee2MQTT usa un `base_topic` diverso da `zigbee2mqtt`, il pulsante che compila tutte le righe non le
  riconosce: si usa il ⟳ riga per riga, che segue il topic della riga qualunque sia.

### Chi sta dall'altra parte: la disponibilità (dal 29-10-2026)

**Un broker raggiungibile non vuol dire che dietro ci sia qualcuno.** Il 28-10-2026 i pulsanti delle luci del
garage non rispondevano più: SWS pubblicava i comandi, il broker li riceveva, ma **Zigbee2MQTT era spento** da oltre
trenta ore — e nell'interfaccia niente lo diceva, perché i tag tenevano l'ultimo valore con qualità buona.

Da questa versione ogni sorgente ha un tag booleano **`<sorgente>.disponibile`**, che il runtime scrive da solo:

| Sorgente | `disponibile` è vero quando |
|---|---|
| MQTT, senza disponibilità impostata | il broker è raggiungibile |
| MQTT, con disponibilità impostata | il broker è raggiungibile **e** il topic di disponibilità dice «vivo» |
| Modbus, S7, OPC-UA, EtherNet/IP, Home Assistant | la sessione col dispositivo è aperta — lo stato che il protocollo già conosce |

**Quando diventa falso, i tag della sorgente passano a qualità `Bad`.** Tengono l'ultimo valore, i sinottici li
mostrano come non aggiornati (lo stale c'è già), e **un allarme di soglia non scatta su un valore `Bad`**: un
sensore di temperatura spento non fa scattare «troppo caldo». Tornano `Good` **col primo valore vero** che arriva,
non al ritorno del bridge: fino ad allora non si sa cosa c'è.

**I comandi si mandano lo stesso.** È una scelta: il segnale di disponibilità può sbagliare, e un comando rifiutato
da SWS per un falso «morto» sarebbe peggio. Il sinottico non aggiornato dice già all'operatore che non sa cosa c'è.

#### Impostarla, per MQTT

Configurazione → Protocolli → la card della sorgente MQTT → sezione **DISPONIBILITÀ** → **Chi dice se è vivo**:

| Scelta | Topic | Campo | Valore «vivo» |
|---|---|---|---|
| Solo il broker | — | — | — |
| Zigbee2MQTT | `zigbee2mqtt/bridge/state` | `state` | `online` |
| Tasmota | `tele/{nome}/LWT` | — | `online` |
| Shelly | `{nome}/online` | — | `true` |
| ESPHome | `{nome}/status` | — | `online` |
| Personalizzato… | a mano | facoltativo | a mano |

Dove c'è `{nome}` va sostituito col nome del dispositivo: Tasmota, Shelly ed ESPHome hanno un topic per apparecchio,
Zigbee2MQTT ne ha uno per tutto il bridge. Il valore «vivo» si confronta **senza badare a maiuscole e spazi**:
`Online` di Tasmota e `online` di Zigbee2MQTT sono la stessa parola. Se il messaggio non è JSON, il campo non serve:
si confronta il testo intero.

In YAML:

```yaml
- kind: mqtt
  id: zigbee2mqtt
  host: 192.168.1.10
  disponibilita:
    topic: zigbee2mqtt/bridge/state
    json_path: state
    vivo: online
```

Accendere la disponibilità **dichiara il tag** `<sorgente>.disponibile` nel progetto, come le metriche della sorgente
host: così lo trovano il selettore dei tag e la validazione. Un topic personalizzato senza valore «vivo» è un avviso
della validazione, perché non direbbe mai che è vivo.

**Il limite di Zigbee2MQTT, da sapere.** Con la configurazione di fabbrica Zigbee2MQTT pubblica la disponibilità
**del bridge**, non di ogni dispositivo (`availability.enabled: false`). Quindi la preimpostazione dice se Zigbee2MQTT
è acceso, non se una singola lampadina risponde. La disponibilità per dispositivo va accesa in Zigbee2MQTT, e in SWS
arriverà dopo.

#### L'allarme

Sotto ogni card c'è la riga **Disponibilità: risponde / non risponde**, col pulsante **Crea l'allarme di
disponibilità**. Lo prepara nella scheda Allarmi — è un allarme normale, descritto nel capitolo
[Allarmi](07_alarms.md#un-allarme-quando-una-sorgente-non-risponde) — e da lì vale tutto quello che c'è: notifiche,
tabella eventi, telefono, storico.

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

### Il certificato del server: fiducia al primo contatto

Anche SWS deve fidarsi del server. Dal **15-10-2026** (CRA, onda 1) `trust_all_certs` vale **`false`** per
default (`sws-core/src/project.rs`, `OpcUaClientConfig`; `fiducia_al_primo_contatto` in
`sws-plugin-opcua/src/lib.rs`), come per SSH e per il TLS di MQTT:

| Situazione | Cosa fa SWS |
|---|---|
| **Primo contatto**: `trusted/` vuota, un solo certificato in `rejected/` | lo memorizza in `opcua-pki/<source-id>/trusted/` e si connette: da lì vale solo quello |
| **Certificato cambiato**: `trusted/` ha già un certificato, il server ne presenta un altro | la connessione **si ferma** e il log lo dice: un rinnovo legittimo e un attacco non si distinguono, quindi decide una persona |
| `trust_all_certs: true` | qualunque certificato è accettato — **sconsigliato**, solo per prove in laboratorio |

```yaml
sources:
  - kind: opcua_client
    id: macchina1
    endpoint_url: "opc.tcp://192.168.1.100:4840"
    security_policy: "Basic256Sha256"
    trust_all_certs: false     # il default; si può omettere
```

**Il trust store** si vede in Configurazione → Sicurezza → Certificati, una tabella per sorgente (dal 25-10-2026; prima stava nella card della sorgente):
l'elenco dei certificati fidati e rifiutati, con **Trust** per approvare quello nuovo dopo un rinnovo e l'eliminazione
di quello vecchio.

| Rotta | Ruolo minimo |
|---|---|
| `GET /api/sources/:id/opcua/certs` — l'elenco | Supervisor |
| `POST /api/sources/:id/opcua/certs/:filename/trust` — approva | Admin |
| `DELETE /api/sources/:id/opcua/certs/:filename` — elimina | Admin |

Un progetto salvato prima del 15-10 senza il campo riparte con `false`: al primo collegamento dopo
l'aggiornamento memorizza il certificato che trova.

### Tag compositi e nodi struttura (dal 25-10-2026)

Un tag **composito** (istanza di un tipo, vedi capitolo dei tag) si può mappare su un nodo OPC-UA che porta una
**struttura**: SWS la legge e consegna ogni campo alla foglia corrispondente (`motore1.velocita`,
`motore1.marcia`), con la sua scala e il suo tipo. Per farlo, a ogni collegamento la sorgente legge dal server la
definizione dei suoi `DataType` — solo se ha almeno un tag composito, perché su un PLC con migliaia di tipi è una
lettura che altrimenti non serve.

| Caso | Cosa succede |
|---|---|
| Struttura con campi scalari o array di un livello | letta, foglia per foglia |
| Campo opzionale assente | la foglia non riceve niente (resta col valore di prima) |
| **Union** | qualità `Bad`: il dato arriva, ma non si sa quale campo vale |
| Strutture **annidate**, array di strutture alla radice | fuori portata: qualità `Bad` |
| Il server non lascia leggere i suoi tipi (limiti di lettura bassi, permessi) | le strutture restano `Bad`, gli scalari funzionano; il log della sorgente dice «albero dei tipi non costruito» col motivo |

La scrittura passa dal **nodo figlio** del campo, non dalla struttura intera: molti server espongono i campi anche
come nodi a sé. Il server OPC-UA di SWS pubblica i tag compositi come variabili struttura vere, con un nodo figlio
per foglia.

### Formato NodeId

| Forma | Descrizione |
|-------|-------------|
| `ns=2;s=Machine.CycleTime` | Stringa in namespace 2 |
| `ns=2;i=1001` | Numerico in namespace 2 |
| `ns=0;i=2253` | Numerico nel namespace 0 (nodi standard) |

### Browse automatico

In **Configurazione → Progetto → Protocolli → OPC-UA → Browse**, SWS può esplorare la struttura
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
    port: 102           # opzionale, predefinita 102; un'altra per un PLC dietro un port forwarding
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

1. **Configurazione → Progetto → Protocolli → + Aggiungi [tipo]**
2. Compila i campi del form
3. **Salva** → il runtime ricarica la configurazione automaticamente

Il runtime effettua un tentativo di connessione immediato dopo il salvataggio.
Lo stato di ogni sorgente e dei suoi dispositivi (connesso / errore) è visibile nell'albero della configurazione e
nella card della sorgente (`GET /api/sources/stato`).

---

← [Indice](MAIN.md) | [← Widget](05_widget_reference.md) | [Successivo → Allarmi](07_alarms.md) →
