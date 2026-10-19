# Piano — il manuale rifatto, e un capitolo nuovo su container e comunicazione

> 19-10-2026. Dal seme [`2026-09-19-screenshot-del-manuale.md`](../archive/2026-09-19-screenshot-del-manuale.md)
> (rimandato «a progetto stabilizzato»): il maintainer avvia il lavoro sulla documentazione e chiede in più «un
> capitolo molto esaustivo su come è organizzato il container runtime, e tutto quello che riguarda la comunicazione».

## Decisioni del maintainer (19-10-2026)

- **Perimetro del capitolo nuovo**: l'immagine `sws-runtime` **ovunque** — com'è fatta, e i suoi tre ruoli: sul
  pannello, come gateway del cloud, come container di progetto nel cloud.
- **Comunicazione**: **tutto, dal browser al campo** — porte e listener, API e WebSocket, autenticazione, IDE ↔
  dispositivo, cloud ↔ pannello (tunnel), gateway ↔ container, TLS e fiducia nei certificati, mDNS, aggiornamenti
  dal registry; i protocolli di campo con un rimando al capitolo 06.
- **Pubblico**: **integratore e chi installa** — cosa gira dove, quali porte aprire, cosa passa sulla rete, come si
  diagnostica. Schemi e tabelle; i file di codice solo come riferimento in fondo alle sezioni.
- **Ordine**: prima il capitolo nuovo, poi ogni capitolo riletto contro il codice (uno per ramo, con l'elenco di
  cosa è cambiato), infine le schermate (prima l'elenco delle inquadrature da approvare, poi lo scatto).

## Ramo 1 — capitolo 18 «Container e comunicazione»

Misure da fare sul codice, non sulla memoria: Containerfile (base, pacchetti, utente, cartelle, etichette,
healthcheck, entrypoint), quadlet del pannello e del VPS, `install-container.sh`, `immagini.sh`; `gateway/` (container
per progetto, inoltro, identità, chiave di ritorno); `tunnel/` (WebSocket uscente, multiplexing); `remote.rs` e
`remote_relay.rs`; listener e porte in `sws-runtime/src/main.rs`; certificati; mDNS; aggiornamento e conferma.

Schemi in Mermaid (GitHub li disegna): l'immagine e i suoi tre ruoli; le porte; i flussi (operatore → pannello,
IDE → pannello in LAN, IDE nel cloud → pannello via tunnel, deploy, aggiornamento). Tabelle: porte, canali WebSocket,
intestazioni e token, cartelle e volumi, variabili d'ambiente. Una sezione di diagnosi («non si collega» → cosa
guardare).

## Ramo 2 — revisione dei capitoli 01–17

Uno per ramo, contro il codice. Per ognuno: cosa è cambiato, cosa manca, cosa togliere. `MAIN.md` (dice ancora
«versione documentata 2026.7.0») e il capitolo 03 vanno allineati al 18.

## Ramo 3 — Parte II, il tutorial (aggiunto il 19-10-2026)

Richiesta del maintainer: «una sezione stile tutorial che un capitolo alla volta spieghi come creare un progetto
vuoto, creare tag e type, mappare i protocolli (sarebbe bello un esempio OpenPLC con cui comunicare per ogni
protocollo), il deploy e l'abbinamento del dispositivo».

Decisioni (19-10-2026):
- **Dove**: una **Parte II — Tutorial** del manuale, capitoli `T01…` in `docs/manual/`, nell'indice di `MAIN.md`; i
  capitoli di riferimento rimandano ai passi del tutorial.
- **Laboratorio**: **OpenPLC Runtime v4** con un solo programma (un piccolo impianto simulato: pompa, serbatoio,
  allarme) esposto in **Modbus TCP, S7 e OPC UA**, più **Mosquitto** per MQTT; tutto in container podman, con uno
  script che lo avvia e lo ferma. EtherNet/IP con OpenPLC v3 come capitolo facoltativo; Home Assistant e Modbus RTU
  solo descritti.
- **Filo**: **un impianto unico** che cresce capitolo dopo capitolo, con il progetto finale scaricabile.
- **Verifica**: **ogni passo eseguito davvero** contro il laboratorio, con le schermate prese durante l'esecuzione
  (Playwright).

Capitoli proposti (da confermare all'inizio del ramo):

| | Capitolo |
|---|---|
| T01 | Il laboratorio: avviare OpenPLC e Mosquitto, caricare il programma dell'impianto |
| T02 | Un progetto vuoto, la risoluzione, le lingue |
| T03 | Tag e type: le variabili dell'impianto, un type «pompa» riusato |
| T04 | Modbus TCP verso OpenPLC: lettura, scrittura, catalogo |
| T05 | OPC UA verso OpenPLC: certificati e fiducia al primo contatto |
| T06 | S7 verso OpenPLC |
| T07 | MQTT con Mosquitto: OpenPLC non parla MQTT, quindi un ponte o un publisher di prova |
| T08 | Le pagine: cornice, simboli, tubi, una finestra di dettaglio con parametri |
| T09 | Allarmi e storico: soglie, banner, trend |
| T10 | Utenti e ruoli |
| T11 | Il pannello: deploy in rete locale e abbinamento col codice |
| T12 | Il pannello dal cloud: abbinamento, tunnel, deploy remoto |
| T13 | Aggiornare il pannello |
| T14 | (facoltativo) EtherNet/IP con OpenPLC v3 |

Da misurare all'inizio del ramo: come si installa OpenPLC Runtime v4 in container (immagine pronta o build), quali
indirizzi espone per ogni protocollo, e se il programma si carica senza l'editor grafico.

## Ramo 4 — le schermate

Prima l'elenco delle inquadrature, capitolo per capitolo, da approvare; poi lo scatto con
`sws-editor/e2e/screenshots.spec.ts` (`./scripts/check_e2e.sh --screenshots`). Oggi dieci schermate, quattro non
citate da nessun capitolo.

## Stato

- **19-10-2026 — ramo 1 fatto**: `docs/manual/18_container_e_comunicazione.md` (540 righe), nell'indice di `MAIN.md`.
  Verificato contro il codice punto per punto; corretti in rilettura il limite dei login (falliti, per nome utente),
  i permessi di `/ws/logs` e il trust store di OPC UA. Da rileggere dal maintainer.
- Prossimo: ramo 2, la revisione dei capitoli 01–17; poi il ramo 3 (tutorial) e il 4 (schermate dei capitoli di
  riferimento, che potranno riusare quelle del tutorial).
