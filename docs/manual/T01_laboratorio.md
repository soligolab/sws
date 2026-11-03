← [Indice](MAIN.md) | [Container e comunicazione ←](18_container_e_comunicazione.md) | [Un progetto vuoto →](T02_progetto_vuoto.md)

---

# T01 — Il laboratorio: un PLC vero sul tuo PC

> **Parte II — Tutorial.** Per chi usa SWS la prima volta e vuole arrivare, un capitolo alla volta, da un PC vuoto a un
> pannello che comanda un impianto. Ogni passo è stato eseguito davvero contro questo laboratorio, e le schermate
> sono quelle di quell'esecuzione. Eseguito il 03-11-2026 con SWS 2.24.1 e OpenPLC Runtime v4.3.1.

Un tutorial su uno SCADA ha bisogno di qualcosa da supervisionare. Qui è un **PLC vero**, OpenPLC Runtime v4, che
gira in un container sul tuo PC con un piccolo programma: una pompa riempie un serbatoio, e quando il livello passa
una soglia scatta un allarme che ferma la pompa. Il PLC espone le sue variabili in **Modbus TCP, S7 e OPC UA**, così
ogni capitolo sui protocolli parla con lo stesso impianto. Accanto c'è un broker **MQTT**.

È lo stesso OpenPLC che SWS installa su un pannello con «Installa anche OpenPLC», sulle stesse porte: quello che si
impara qui vale là.

---

## Cosa serve

| | |
|---|---|
| **Sistema** | Linux x86_64 o ARM64 |
| **Podman** | rootless, come per SWS ([02 — Quick Start](02_quickstart.md)) |
| **Spazio** | circa 1,2 GB: l'immagine di OpenPLC (1 GB), il broker (30 MB), la CLI dell'Editor OpenPLC (200 MB) |
| **Porte libere** | 8443, 1502, 10102, 14840, 11883 |
| **Il repository di SWS** | il laboratorio sta in [`examples/laboratorio/`](../../examples/laboratorio/README.md) |

> **La 8443.** È la porta dell'API di OpenPLC, e la CLI dell'Editor non ne accetta un'altra. Il viewer di SWS
> stava lì fino alla 2.16; dalla 2.16 è sulla 7443, quindi su un PC con SWS recente è libera.

---

## L'impianto

Il programma è in [`examples/laboratorio/impianto/pous/programs/main.st`](../../examples/laboratorio/impianto/pous/programs/main.st),
in Structured Text:

```iecst
IF soglia_alta <= 0 THEN soglia_alta := 900; END_IF;

passo := passo + 1;                  (* ciclo di 50 ms: ogni 2 cicli, 0,1 s, il livello si muove di 1 mm *)
IF passo >= 2 THEN
  passo := 0;
  IF pompa_in_marcia THEN livello := livello + 1;
  ELSIF livello > 0 THEN livello := livello - 1;
  END_IF;
END_IF;
allarme_livello := livello >= soglia_alta;
pompa_in_marcia := comando_marcia AND NOT allarme_livello;
IF pompa_in_marcia THEN portata := 120; ELSE portata := 0; END_IF;
```

Il serbatoio si riempie di 10 mm al secondo: dalla partenza alla soglia di 900 mm passa un minuto e mezzo. Chi
comanda accende `comando_marcia`; la pompa parte se il livello è sotto la soglia, e il serbatoio si riempie. Arrivato
alla soglia scatta `allarme_livello` e la pompa si ferma; a pompa ferma il serbatoio si svuota da solo (un'utenza che
consuma), e appena il livello torna sotto la soglia l'allarme rientra e la pompa riparte. Il livello oscilla attorno
alla soglia finché qualcuno non spegne il comando.

Le sei variabili e dove si trovano in ciascun protocollo:

| Variabile | Tipo | Cosa | Modbus TCP | S7 | OPC UA (`ns=2;s=…`) |
|---|---|---|---|---|---|
| `comando_marcia` | BOOL | il comando, scritto da SWS | coil 0 | DB2 bit 0.0 | `impianto.comando_marcia` |
| `pompa_in_marcia` | BOOL | la pompa gira | coil 1 | DB2 bit 0.1 | `impianto.pompa_in_marcia` |
| `allarme_livello` | BOOL | livello oltre la soglia | coil 2 | DB2 bit 0.2 | `impianto.allarme_livello` |
| `livello` | INT | livello del serbatoio | holding 0 | DB1 byte 0 | `impianto.livello` |
| `soglia_alta` | INT | soglia di allarme, 900 all'avvio | holding 1 | DB1 byte 2 | `impianto.soglia_alta` |
| `portata` | INT | 120 a pompa in marcia, altrimenti 0 | holding 2 | DB1 byte 4 | `impianto.portata` |

> **Perché 50 ms.** Il task del PLC gira ogni 50 ms. Con i 20 ms di partenza, su un PC che intanto compila, il
> watchdog di OpenPLC fermava il PLC («stuck in one scan for 10 periods»): senza priorità realtime un PC da scrivania
> non garantisce i tempi. Su un pannello con OpenPLC la priorità realtime si può dare (HOWTO, §OpenPLC).

I tre server sono dichiarati nel progetto dell'Editor, in `impianto/devices/servers/` (`modbus.json`, `s7.json`,
`opcua.json`): è lì che OpenPLC v4 decide cosa accendere, non in una pagina web.

Il server **OPC UA** accetta solo connessioni **firmate e cifrate** (`Basic256Sha256`, SignAndEncrypt) con utente e
password: `sws` / `laboratorio`, ruolo *operator*. È la configurazione che si incontra in un impianto vero, ed è
quella che il [T05](T05_opcua.md) usa per mostrare i certificati.

---

## Avviare il laboratorio

Dalla cartella del repository:

```bash
cd examples/laboratorio
./laboratorio.sh avvia
```

```text
OpenPLC acceso (API https://127.0.0.1:8443, utente «laboratorio»), broker MQTT su 127.0.0.1:11883.
Per caricare (o ricaricare) l'impianto: ./laboratorio.sh carica
```

La prima volta scarica le immagini, circa 1 GB. Lo script crea anche il primo utente di OpenPLC (`laboratorio`, password
`laboratorio`): un OpenPLC appena nato dà l'amministrazione al primo che la chiede, ed è meglio che il primo sia tu.

> **Solo per il laboratorio.** Utente e password fissi vanno bene su un PC di prova. Su un pannello vero il primo
> utente lo crei tu dall'Editor, con una password tua ([18 — Container e comunicazione](18_container_e_comunicazione.md)).

## Caricare il programma

OpenPLC parte vuoto. Il programma si compila con la CLI dell'Editor OpenPLC, che lo script scarica la prima volta in
`~/.cache/sws-laboratorio`, e si carica sul runtime:

```bash
./laboratorio.sh carica
```

```text
…
Plugin summary: 3/5 enabled (3 Python, 2 Native)
Compilation completed successfully (exit code: 0).
PLC started.
Upload complete.

Compilation complete
Uploaded "impianto" to 127.0.0.1 (OpenPLC Runtime v4).
OpenPLC: {"status":"STATUS:RUNNING","switchPosition":"run"}
  porta 1502: aperta
  porta 10102: aperta
  porta 14840: aperta
  porta 11883: aperta
```

I tre «plugin» accesi sono Modbus, S7 e OPC UA. Il PLC è in **RUN**: il livello è a 0, la soglia a 900, la pompa
ferma, perché nessuno ha ancora acceso `comando_marcia`.

> **Con l'Editor grafico.** Lo stesso progetto si apre con l'Editor OpenPLC v4 («File → Apri» sulla cartella
> `impianto/`) e si carica sul runtime puntandolo a `127.0.0.1`. La CLI è la stessa cosa senza finestre: serve a
> rendere il laboratorio ripetibile.

## Le porte

| Porta | Cosa | Chi la usa nel tutorial |
|---|---|---|
| 8443 | API di OpenPLC (HTTPS) | lo script e l'Editor OpenPLC |
| **1502** | Modbus TCP | [T04](T04_modbus.md) |
| **14840** | OPC UA, `opc.tcp://127.0.0.1:14840/openplc/opcua`, Basic256Sha256, utente `sws` | [T05](T05_opcua.md) |
| **10102** | S7 (ISO-on-TCP) | T06 |
| **11883** | MQTT, anonimo | T07 |

Sono le porte del pannello con OpenPLC, spostate di proposito da quelle standard (502, 102, 4840): sul pannello la 4840
è del server OPC UA di SWS, e una porta sotto la 1024 un container rootless non la apre.

## MQTT dal terminale

Il broker è **NanoMQ**, e porta con sé il suo client. Lo script lo usa per due comandi che serviranno al T07:

```bash
./laboratorio.sh ascolta 'lab/#'          # stampa ogni messaggio che arriva sotto lab/
./laboratorio.sh pubblica lab/prova 42     # da un altro terminale
```

```text
lab/prova: 42
```

## Fermare

```bash
./laboratorio.sh stato    # cosa risponde, in qualunque momento
./laboratorio.sh ferma    # toglie i due container
```

Fermato il laboratorio, il programma va ricaricato con `carica` al prossimo `avvia`: OpenPLC riparte vuoto.

---

## Riferimenti

| | |
|---|---|
| Il laboratorio | [`examples/laboratorio/`](../../examples/laboratorio/README.md) |
| OpenPLC sul pannello | `deploy/container/install-container.sh` (`--con-openplc`), HOWTO §OpenPLC |
| La misura di OpenPLC v4 | [`docs/plans/2026-10-19-manuale-rifatto.md`](../plans/2026-10-19-manuale-rifatto.md), §«La misura, fatta il 20-10-2026» |

---

← [Indice](MAIN.md) | [Container e comunicazione ←](18_container_e_comunicazione.md) | [Un progetto vuoto →](T02_progetto_vuoto.md)
