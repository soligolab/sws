# L'impianto lo tocca il dispositivo — scoperte e comunicazione dal runtime del pannello

**Stato: deciso — strada 3, il 25-10-2026.** Nato lo stesso giorno, dal maintainer che lavora ormai
solo dal cloud. Decisione del maintainer: «io sono dell'idea di adottare la soluzione 3 che mi sembra
quella più logica»; e «mi sta bene partire dal seme ma porta avanti l'attività fino a concludere il
lavoro».

> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita**
> per sviscerarne tutti i dettagli. Qui c'è l'idea e quello che si è misurato il giorno in cui è
> nata, non un disegno: fra la domanda e il lavoro passa troppo tempo perché un disegno scritto oggi
> resti vero.

## L'idea

Parole del maintainer: «ora i progetti li apro da sws.soligo.net ma il discovery di MQTT non
funziona più e immagino anche gli altri discovery… se io avvio il discovery lo devo avviare sul
dispositivo remoto e devo lavorare come fossi localmente nell'impianto… l'ideale è che i vari tipi
di discovery dei vari protocolli e la comunicazione sia fatta dal runtime del dispositivo».

Tutto ciò che **parla con l'impianto** lo fa il runtime del dispositivo. L'IDE, anche nel cloud,
ne è un client.

## Cosa si è misurato (25-10-2026)

- **Lo sfoglia MQTT dal cloud trova 0 topic.** Nel cloud l'IDE gira nel container del progetto sul
  VPS, e il VPS non raggiunge `192.168.1.6`. Per lo stesso motivo nel cloud vanno in timeout tutte le
  sorgenti MQTT di CasaDomotica: le luci si comandano solo dal pannello.
- **Le scoperte esistono solo sull'IDE**, nel router `build` di `sws-web/src/router.rs`:
  - `POST /api/sources/mqtt/browse`, `…/opcua/browse` e `…/ha/browse`;
  - `GET /api/discover` e `/api/discover/dispositivi` (mDNS).

  La porta di gestione del dispositivo (`deploy_only_app`), cioè quella che il tunnel raggiunge,
  non le ha.
- **Il modello dell'inoltro c'è già**: `remote.rs`, `proxy_get_json`, con
  `/api/remote/host/seriali`, `…/host/catalog`, `…/sources/stato` e `…/system/tls`. Il test
  `ogni_chiamata_dell_ide_ha_la_sua_rotta_sul_dispositivo` tiene la parità delle rotte. Lato web, la
  card TLS sceglie locale o remoto con `remoteConnected`.
- **Nel cloud** il container del progetto raggiunge il pannello passando dal gateway (`/dev/<pannello>`,
  con la chiave di ritorno, `gateway/ritorno.rs`) e dal tunnel.
- **Il legame progetto → dispositivo è manuale**: Configurazione → Istanza → Device → «Connetti».

## Le strade viste il giorno della domanda

1. **Inoltro scoperta per scoperta**: le rotte di scoperta sulla porta di gestione del dispositivo
   (Admin), con le varianti `/api/remote/…` nell'IDE. È lo schema delle porte seriali: poco lavoro,
   un protocollo alla volta.
2. **Un inoltro generico con un elenco chiuso** di rotte «che toccano l'impianto». Meno codice
   ripetuto, ma la sicurezza dipende dall'elenco.
3. **Il dispositivo possiede l'impianto** (la direzione del maintainer): scoperte, prova connessione,
   scansione Modbus, valori vivi e stato delle sorgenti passano tutti dal dispositivo legato al
   progetto. Senza un dispositivo, l'IDE lo dice invece di cercare dal VPS.

Raccomandazione del giorno: la 3 come direzione, con la 1 come primi passi (prima MQTT, poi OPC-UA
e Home Assistant).

## Le domande per la sessione di plan

- Il legame «questo progetto gira su `tc620-garage`»: dove sta (progetto, gateway, abbinamento) e
  chi lo stabilisce. Il deploy lo implica già?
- Più dispositivi per un progetto (stesso progetto su due pannelli): quale risponde alle scoperte?
- Senza un dispositivo raggiungibile: scoperte spente con un messaggio, o scoperte dal VPS per gli
  impianti esposti su Internet (un broker MQTT pubblico)?
- I permessi: le scoperte sul dispositivo sono Admin, e nel cloud l'identità arriva dal gateway.
- Le sorgenti nel cloud: un progetto nel cloud deve continuare a provare a collegarsi a broker che
  non vede (oggi timeout ogni 5 s), o le sorgenti «d'impianto» girano solo sul dispositivo?
- Il viewer nel cloud: i valori vivi vengono dal dispositivo (attraverso il tunnel) invece che dalle
  sorgenti del container?
