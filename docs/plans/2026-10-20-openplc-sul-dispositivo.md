# OpenPLC sul dispositivo, come funzione di SWS — seme

> Nato il 20-10-2026. Il maintainer, preparando il laboratorio del tutorial: «valuta se può avere più senso far girare
> OpenPLC direttamente sul device e poterlo usare anche in produzione», e poi «quindi non solo un laboratorio ma una
> funzione di SWS».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per decidere ogni dettaglio:
> qui ci sono l'idea, le misure di oggi e le strade che si vedono già, non un progetto.

## L'idea

Un pannello SWS che è anche il **PLC**: OpenPLC Runtime v4 accanto a `sws-runtime` sullo stesso dispositivo, la logica
in IEC 61131-3 scritta e caricata dall'IDE di SWS, i tag letti in locale. Un solo strumento per sinottico e logica,
dal PC o dal cloud attraverso il tunnel.

## Cosa è stato misurato il 20-10-2026

- **Il runtime** è un'immagine pronta, `ghcr.io/autonomy-logic/openplc-runtime` (v4.3.1, MIT, amd64/arm64/armv7,
  **1,0 GB**). Senza interfaccia: si comanda con un'API REST su **8443** (la porta del viewer di SWS) con JWT; il primo
  utente si crea senza autenticazione.
- **Il programma** arriva come `program.zip` (C già generato + `conf/` con i server dei protocolli) e il runtime lo
  compila con gcc al caricamento: il dispositivo deve avere toolchain e spazio per compilare (l'immagine li porta).
- **La compilazione da ST** la fa l'Editor v4, che ha una **CLI senza testa** (`openplc-cli compile`), un AppImage
  Electron da 153 MB. Provata qui: `create` → `compile` → caricamento con l'API, ciclo completo in pochi secondi. La
  CLI ha la porta 8443 fissa per caricare (`RUNTIME_API_PORT`), quindi il caricamento va fatto con l'API, non con la
  CLI. Va lanciata senza `ELECTRON_RUN_AS_NODE` nell'ambiente.
- **I protocolli** del runtime: Modbus TCP server, S7 (Snap7), OPC UA server, Modbus master, EtherCAT. **Niente
  EtherNet/IP.** Provati tutti e tre i server con un programma di prova: valori coerenti fra i tre protocolli, e una
  scrittura da SWS in S7 riletta in Modbus.
- **Tempo reale**: nel container rootless `sched_setscheduler failed: Operation not permitted` — il ciclo gira senza
  priorità realtime. In produzione servono capacità in più (`SYS_NICE`) o un container non rootless.
- **Maturità**: il server REST è Flask con il server di sviluppo («do not use in production» nel log); il port
  forwarding di podman ha risposto solo in IPv4. Nessuna certificazione di sicurezza funzionale.
- **Sui pannelli Pixsys c'è già CODESYS** come PLC (`docs/TEST_SETUPS.md`, «CODESYS si prende il browser»): due PLC
  sullo stesso dispositivo, o uno al posto dell'altro, è una scelta di prodotto, non tecnica.

## Le strade che si vedono già

1. **Companion container**, come il viewer LVGL ([[feedback-lvgl-deploy-unified]]: companion opzionale di
   `sws-runtime`, mai un fork): un quadlet `openplc-runtime.container` che l'installer e l'aggiornamento di SWS
   gestiscono, porta REST interna (non la 8443), SWS che legge i tag in locale via Modbus o OPC UA. È la più piccola.
2. **Il PLC nell'IDE**: una scheda «Logica» con l'ST del progetto, compilata dall'IDE con la CLI dell'Editor e caricata
   sul dispositivo attraverso le rotte di gestione di SWS (e il tunnel, dal cloud). I tag di SWS nascono dalle
   variabili del programma. Pesa: Electron nell'immagine dell'IDE, o un compilatore ST in casa.
3. **Solo laboratorio**: OpenPLC resta il PLC del tutorial, e in produzione il PLC è quello del cliente (CODESYS sui
   Pixsys, un Siemens, un Modbus). È lo stato di oggi.

## Un seme figlio, da decidere insieme

L'API REST di OpenPLC ascolta sulla **8443**, che è la porta del viewer di SWS. Il conflitto non
è un dettaglio di questo laboratorio: è la prima volta che sul pannello deve girare qualcosa
accanto a `sws-runtime`. Le porte di SWS sono misurate nel seme
[le porte di SWS](2026-10-21-porte-di-sws.md), del 21-10-2026, che va aperto **nella stessa
sessione di plan**: la strada più piccola che risolve OpenPLC (dare al companion una porta
interna nostra) è anche quella che lascia il problema intatto per il servizio successivo.

## Domande per la sessione di plan

- Per chi è: un cliente senza PLC (il pannello fa tutto), o un'alternativa a CODESYS sui Pixsys?
- Chi risponde del ciclo PLC in produzione (tempo reale, watchdog, cosa succede se `sws-runtime` si aggiorna)?
- Spazio e memoria sui TC620/WP630 (l'immagine è 1 GB, e il disco del TC620 si è già riempito una volta).
- Come si versiona la logica: dentro il progetto SWS (git, deploy, istantanea) o a parte.
