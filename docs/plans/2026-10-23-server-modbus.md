# Seme — il server Modbus (slave) di SWS

> **Seme — decisione.** Nato il 23-10-2026 mentre si decideva OpenPLC, e tenuto fuori da quel
> piano per scelta del maintainer: non è una funzione di OpenPLC, è una funzione di SWS. OpenPLC
> è solo il primo caso d'uso che la rende necessaria.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio. Qui c'è l'idea e le misure di oggi, non un progetto.

## L'idea

Oggi SWS parla Modbus **solo da client**: va a bussare a un dispositivo e legge. Un PLC o uno
SCADA che volesse venire a **prendersi** i dati da SWS non ha come farlo.

Un server Modbus (slave) ribalta la direzione: SWS ascolta, e chi comanda è l'altro.

## Perché è nato

Il piano [OpenPLC sul dispositivo](2026-10-20-openplc-sul-dispositivo.md) è stato deciso con
l'idea che **l'utente scelga chi è il master**. Misurando le quattro combinazioni, due funzionano
e due no:

| Chi legge chi | Via | Oggi |
|---|---|---|
| SWS legge OpenPLC | OPC-UA (OpenPLC server, SWS client) | **funziona** |
| SWS legge OpenPLC | Modbus (OpenPLC server, SWS master) | **funziona** |
| OpenPLC legge SWS | Modbus (OpenPLC master, SWS slave) | **manca, ed è nostro** |
| OpenPLC legge SWS | OPC-UA (SWS server, OpenPLC client) | manca, **e non è nostro**: OpenPLC non ha un client OPC-UA |

Delle due che mancano, **una sola la possiamo costruire noi**.

## Misurato il 23-10-2026

- `SourceDef` ha nove varianti: `ModbusTcp`, `ModbusRtu`, `OpcUaServer`, `Mqtt`, `OpcUaClient`,
  `HomeAssistant`, `S7`, `EnIp`, `Host`. **`OpcUaServer` è l'unica che espone**; tutte le altre
  vanno a prendere.
- `ModbusTcpConfig` ha `host` e `port`: la forma stessa dice che è un client. Nei due plugin
  Modbus e S7 non c'è **nessun** `listener` né `bind`.
- Quindi esiste **un solo precedente** di «SWS che serve dati a qualcun altro», ed è il server
  OPC-UA (`run_server`, `sws-plugin-opcua`). È lì che vanno guardate le scelte già prese — e i
  difetti già noti: espone tutto come `Double`, e fino al 23-10-2026 le scritture entranti
  saltavano il bus.
- `tokio-modbus` 0.6.1 è già fra le dipendenze e ha la **feature `server`** — i test di Fase 3 la
  usano già come dev-dependency per il server TCP in memoria. Il mattone c'è.

## Le domande per la sessione di plan

- **Quali tag si espongono, e come si mappano sui registri.** Il server OPC-UA espone i tag
  nominati nella sua configurazione; qui serve in più un **indirizzo**, perché Modbus non ha nomi.
  Lo decide chi configura, o si deriva?
- **Le scritture entranti.** Il 23-10-2026 si è deciso che quelle del server OPC-UA passano dal
  bus, col ripiego sul `TagDb` quando nessuno possiede il tag. La stessa regola vale qui, e va
  scritta una volta sola per tutti i server.
- **Quali aree**: holding e input bastano, o servono anche coil e discrete?
- **Chi può collegarsi**: nessuna autenticazione (Modbus non ne ha), quindi la domanda è
  l'indirizzo su cui si ascolta e chi lo raggiunge. Sul pannello, in rootless, **sotto la 1024 non
  si pubblica**: la 502 non si può usare senza il sysctl che oggi esiste solo sul VPS.
- **Il rapporto col server OPC-UA**: due server che espongono gli stessi tag con regole diverse, o
  una nozione sola di «cosa questo runtime serve a chi arriva»?

## Quello che non va deciso qui

Il tempo reale, la convivenza con CODESYS e lo spazio sui pannelli stanno nel piano di OpenPLC:
questo seme non li tocca.
