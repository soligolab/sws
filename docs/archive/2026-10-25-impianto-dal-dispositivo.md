# L'impianto lo tocca il dispositivo — scoperte e comunicazione dal pannello (strada 3)

> **Una gamba e' collaudata, il 28-10-2026.** «Nel cloud le sorgenti non partono» si vede adesso
> **dal vivo**, e per una via che non era prevista: da quando ogni protocollo ha un thread col suo
> nome, basta guardare i thread del container di progetto sul VPS.
>
> ```
>   container del progetto nel cloud        il WP630
>   4 tokio-rt-worker                      11 tokio-rt-worker
>   1 sws-storico     nice 10               7 sws-host
>   1 sws-ritenzione  nice 10               1 sws-mqtt
>   1 sws-backup      nice 10               2 sws-storico   nice 10
>   1 sws-log         nice 10               … e gli altri di fondo
> ```
>
> Nel cloud **non c'e' ne' `sws-mqtt` ne' `sws-host`**: nessuna sorgente e' partita. Sul pannello
> ci sono. La regola era leggibile solo nel codice (`imposta_nel_cloud`, `main.rs:571`); adesso si
> vede con un `ps`.
>
> **Restano da vedere a schermo**, e sono due minuti all'IDE: lo «Sfoglia broker» dal cloud che
> trova i topic passando dal pannello collegato, e i valori vivi nell'editor. Quelli vogliono un
> pannello abbinato e un occhio, non un comando.

**Stato: piano d'esecuzione — in corso** sul ramo `feat/impianto-dal-dispositivo` (annidato su
`fix/esito-ricordato-dal-runtime`). Deciso il 25-10-2026 dal maintainer: strada 3, credenziali del
pannello salvate per progetto, nel cloud le sorgenti non partono. Sessione di plan fatta lo stesso
giorno; il seme originale è in fondo.

## Context

Il maintainer lavora ormai solo dal cloud (sws.soligo.net). Dal cloud lo «Sfoglia broker» MQTT
trova 0 topic: le scoperte girano sulla macchina dell'IDE, che nel cloud è il container del progetto
sul VPS, e il VPS non vede l'impianto (`192.168.1.6`). Per la stessa ragione le sorgenti di
CasaDomotica vanno in timeout ogni 5 s.

**Decisione del maintainer (25-10-2026): strada 3**, cioè tutto ciò che parla con l'impianto lo fa
il runtime del dispositivo e l'IDE nel cloud ne è un client. Più due scelte:
- **credenziali del pannello salvate per progetto**, nella cartella di configurazione persistente,
  così l'IDE si ricollega da solo;
- **nel cloud le sorgenti d'impianto non partono**: i valori vivi vengono dal pannello collegato.

Il seme è `docs/archive/2026-10-25-impianto-dal-dispositivo.md`; questo piano lo sostituisce come
disegno.

## Cosa c'è già (dalle esplorazioni)

- **Il collegamento al dispositivo**: `RemoteTarget {url, token, credenziali, …}` in
  `AppState.remote_target`, **solo in memoria** (`sws-web/src/remote.rs:17-38`). È uno per processo,
  ma nel cloud il processo è uno per progetto.
  - Connessione: `connect_remote` (remote.rs:127-495). Rientro con le credenziali in memoria:
    `assicura_sessione` / `rientra` (~2844-2955).
- **Il cloud raggiunge il pannello** con `RemoteTarget.url = https://<gateway>/dev/<pannello>`. La
  chiave di ritorno (`gateway/ritorno.rs`) si aggiunge solo quando l'origine del gateway è nota, e
  `ricorda_origine` (router.rs:2278) la impara **dalla prima richiesta del browser**, non all'avvio.
- **Il pannello accetta la firma del gateway solo senza utenti** (`utente_dal_cloud`,
  router.rs:2125, usata solo in `InAttesa`). Un pannello con utenti vuole il login: da qui le
  credenziali salvate.
- **Gli inoltri GET**: `proxy_get_json` (remote.rs:1842). Un generico per gli altri metodi è
  `inoltra_aggiornamento` (remote.rs:1162), con audit e mappatura 404 → «dispositivo vecchio».
  - **La guardia di parità** `ogni_chiamata_dell_ide_ha_la_sua_rotta_sul_dispositivo`
    (router.rs:12276) legge i letterali `"{base}/api/..."` in remote.rs e li cerca come `"/api/..."`
    dentro `deploy_only_app`. Se l'inoltro passa per un helper, il percorso va scritto in un
    commento.
- **Porta di gestione del dispositivo**: `deploy_only_app` (router.rs:1407). Il gruppo `gestione` è
  tutto Admin.
- **Le funzioni che toccano l'impianto e oggi esistono solo sull'IDE** (router `build`):

  | Funzione | Rotta | Handler |
  |---|---|---|
  | Sfoglia MQTT | `POST /api/sources/mqtt/browse` | `mqtt_browse_handler` (router.rs:8755) |
  | Sfoglia OPC-UA | `POST /api/sources/opcua/browse` | ~8551 |
  | Rilevamento Euromap | `POST /api/sources/opcua/detect-euromap` | |
  | Sfoglia Home Assistant | `POST /api/sources/ha/browse` | ~8970 |
  | Prova del datastore | `POST /api/datastores/:id/test` | ~3609 |
  | Certificati OPC-UA | `GET/POST/DELETE /api/sources/:id/opcua/certs…` | ~8840-8950 |

  - Le password arrivano mascherate (`"********"`) e l'handler le risolve dal progetto **locale**
    (`Project::load` + `secrets.yaml`).
  - HA prende URL e token solo dal progetto locale.
- **Interfaccia**: un flag `remoteConnected` nello store e, nei componenti,
  `remoteConnected ? api.remoteX() : api.X()`. C'è già la variante «prima il dispositivo,
  poi il PC, e dimmi se il pannello è vecchio» in `CampoPortaSeriale.tsx:32-52` (test
  `tests/campoPortaSeriale.test.tsx`).
  - Le scoperte (`MqttBrowseModal`, `OpcUaBrowseModal`, `OpcUaEuromapModal`, `HaBrowseModal`,
    test datastore in `DatastoresTab`, certificati in `OpcUaSourceCard`) non hanno il ramo remoto.
  - Nel cloud nessuno ricollega all'apertura (App.tsx:850 «senza tentare nulla in automatico»).
- **Le sorgenti**: `SourceSupervisor::reload` (`source_supervisor.rs:224`) filtra già due casi
  (impianto fermo, sola lettura dell'IDE). È il punto giusto per «nel cloud non partono».

## Ramo

`feat/impianto-dal-dispositivo`, **nidificato** su `fix/esito-ricordato-dal-runtime`, secondo la
regola «un ramo alla volta», opzione 2. Rientra passando da lì.

## Il lavoro

### 1. Il pannello del progetto, ricordato e ricollegato (solo nel cloud)
- **Il file**: `config/dispositivo.yaml` (0600, nella cartella persistente per progetto, fuori dal
  progetto) con `{url, username, password}`.
  - **Lo scrive** `connect_remote` quando riesce, solo con `--auth-delegata`: in locale `config/` è
    dell'istanza, non del progetto, e App.tsx vuole che lì non si ricolleghi da solo.
  - **Lo cancella** `DELETE /api/remote/connect` («Disconnetti»).
  - **Helper** in `remote.rs` (`ricorda_dispositivo` / `dispositivo_ricordato` / `dimentica_dispositivo`),
    scritti con `segreti::scrivi_chiave`.
- **Il ricollegamento è pigro**, perché all'avvio il container non conosce ancora l'origine del gateway.
  - `ripristina_se_serve(&s)` ricollega con il file se `remote_target` è vuoto, riusando la logica di
    `connect_remote`, estratta in `fn collega(s, url, user, pass) -> esito`.
  - **Chi la chiama**: `GET /api/remote/status` e gli helper d'inoltro quando il target manca.
- **Frontend** (`App.tsx`): nel cloud (`prefissoGateway()`), all'apertura del progetto una
  `api.remoteStatus()` aggiorna `setRemoteConnected`. Con quello passano al pannello anche i
  WebSocket dei valori vivi (`ws/wsUrl.ts`).
- **Test**: scrivi / leggi / cancella del file e permessi 0600; nel cloud sì, in locale no.

### 2. Nel cloud le sorgenti non partono
- `SourceSupervisor::imposta_nel_cloud(bool)`, chiamata da `main.rs` con `args.auth_delegata`.
- In `reload`, nel cloud `desired` diventa vuoto, con un log a info che dice perché.
- **Riguarda tutti i tipi**, `host` compreso: nel cloud misurerebbe il VPS. I tag interni
  (espressioni, generatori) non sono sorgenti e restano.
- **Interfaccia**: nella scheda Sorgenti, nel cloud, una riga dice «Le sorgenti girano sul pannello
  collegato», e lo stato arriva già da `remoteStatoSorgenti`.
- **Test**: unitario sul supervisore, sulla falsariga dei test di `set_armed`
  (source_supervisor.rs:597-633).

### 3. Le scoperte sul dispositivo
- **Porta di gestione** (`deploy_only_app`, gruppo `gestione`, Admin): si aggiungono le stesse rotte
  dell'IDE, cioè sfoglia MQTT, sfoglia OPC-UA, Euromap, sfoglia HA, i tre dei certificati OPC-UA e
  la prova del datastore. Gli handler sono quelli esistenti.
- **La sorgente può non esistere sul pannello** (progetto non ancora distribuito, o segreti diversi):
  - **MQTT e OPC-UA**: sul pannello arrivano con la password già vera.
  - **HA**: `HaBrowseRequest` accetta `url` e `token` opzionali; se ci sono, vincono sulla ricerca
    nel progetto.
  - **Datastore**: una variante `POST /api/datastores/prova` con la definizione intera nel corpo, già
    risolta.
- **IDE**: rotte `/api/remote/sources/mqtt/browse`, `…/opcua/browse`, `…/opcua/detect-euromap`,
  `…/ha/browse`, `…/:id/opcua/certs…` e `/api/remote/datastores/:id/test`, con lo stesso ruolo delle
  locali.
  - **Prima di inoltrare** risolvono dal progetto dell'IDE quello che il dispositivo non può sapere:
    password mascherata, URL e token HA, definizione del datastore. Una funzione pura per tipo, con il
    suo test. Il progetto che fa fede è quello del cloud.
  - **L'inoltro**: un helper unico `proxy_json(s, metodo, percorso, corpo)`.
    - Se manca il target chiama prima `ripristina_se_serve`.
    - Usa il timeout lungo: lo sfoglia MQTT dura fino a 120 s.
    - Mappa 404/405 su 502 con `x-sws-dispositivo-vecchio: 1`.
  - Il percorso d'inoltro va scritto in un commento `"{base}/api/…"`, perché la guardia di parità lo
    trovi.
- **Interfaccia**: un helper `suDispositivo(locale, remota)` in `src/api/` decide:
  - `remoteConnected` → remota;
  - nel cloud senza pannello → un errore leggibile, «Collega il pannello dell'impianto (Configurazione
    → Istanza → Device): le scoperte le fa lui»;
  - altrimenti → locale, come oggi.

  Con `x-sws-dispositivo-vecchio` il messaggio diventa «Il pannello ha una versione senza questa
  funzione: aggiornalo». Si applica ai sei punti dell'interfaccia elencati sopra.
- **Restano sull'IDE di proposito**: la scoperta mDNS dei dispositivi (`/api/discover…`, già
  consapevole del cloud), la sonda SSH di installazione, le prove Telegram ed e-mail.
- **Test**:
  - vitest sul modello di `campoPortaSeriale.test.tsx`: locale, remoto, cloud senza pannello,
    pannello vecchio;
  - test Rust della risoluzione dei segreti e di HA con URL/token espliciti;
  - la guardia di parità copre le rotte nuove.

### 4. Documenti
- **Manuale**: nel capitolo delle sorgenti, «nel cloud le scoperte e le sorgenti sono del pannello
  collegato».
- **HOWTO**: un capitolo «lavorare dal cloud su un impianto».
- **CHANGELOG e NOVITA**.
- **Il seme**: `docs/archive/2026-10-25-impianto-dal-dispositivo.md` diventa questo piano, aggiornato
  nell'indice.

## Scelte prese eseguendo (25-10-2026)

- **La prova del datastore** si inoltra così com'è, senza la variante «definizione nel corpo»: sul pannello prova
  il datastore **distribuito**, cioè quello che lavora davvero. Se non c'è, il pannello lo dice (404 → «non
  trovato»): va distribuito il progetto.
- **Il segnale «pannello vecchio»** è il testo della risposta, non un'intestazione: `request()` già mostra il
  testo dei 502 delle rotte `/api/remote/…`, e le finestre lo stampano così com'è.
- **Il flag del pannello collegato** sta in `src/api/pannello.ts`, modulo senza dipendenze: lo store importa il
  client (un ciclo altrimenti) e i test sostituiscono `@/api/client` con mock parziali.

## Verifica

- **Guardie**: `cargo test`, `pnpm exec vitest run`, `pnpm build` e `check_static.sh` verdi.
- **Immagini**: `<hash>-arm64` sul TC620 (le rotte nuove servono lì) e `<hash>-amd64` sul VPS.
- **Dal vivo, nel cloud su CasaDomotica**:
  1. «Connetti» a `tc620-garage`, con le credenziali inserite dal maintainer.
  2. Sfoglia broker → compaiono i topic di `192.168.1.6`, con `zigbee2mqtt/switch_garage` fra loro.
  3. Ricreare il container del progetto: riaprendo, l'IDE è già collegato al pannello, senza
     password.
  4. I log del container non mostrano più i timeout MQTT ogni 5 s.
  5. «Disconnetti» → il file sparisce, e la riapertura non si ricollega.
- **Le luci**: dopo il deploy dal cloud, i tre pulsanti della pagina Garage comandano dal pannello.


---

## Il seme (25-10-2026), com'era


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
