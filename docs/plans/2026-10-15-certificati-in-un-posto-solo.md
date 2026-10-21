# Seme — i certificati in un posto solo («Security Agent» di SWS)

> **Seme — decisione.** Domanda del maintainer, 15-10-2026: «la gestione dei certificati ha senso gestirla in un menù
> dedicato dove gestire tutti i certificati di tutti i protocolli e modi di accesso? qualcosa ispirato a CODESYS
> Security Agent?». Annotata mentre si chiudeva il C3 dell'onda 1
> ([piano](2026-10-15-piano-prima-fascia-e-cra.md)), che ha appena aggiunto la fiducia al primo contatto per OPC UA.
>
> **Quando questo lavoro inizia, il primo passo è una sessione di plan approfondita per definirne tutti i dettagli.**
> Qui ci sono l'idea e le misure di oggi, non il progetto.

## L'idea

Una vista sola, **Configurazione → Sicurezza → Certificati**, come il Security Agent di CODESYS: tutti i certificati
del dispositivo e dell'IDE, divisi per **uso** (server web, OPC UA client e server, MQTT, dispositivi raggiunti
dall'IDE, viewer LVGL), con due elenchi per ciascuno:

- **i propri certificati**: soggetto, emittente, validità, impronta; generare, rinnovare, importarne uno firmato da
  una CA, esportare quello pubblico;
- **i certificati di cui ci si fida** (e quelli rifiutati): fidati, rifiuta, dimentica, con il motivo e la data.

Più quello che oggi non fa nessuno: **avvisi di scadenza**, e un posto unico dove si conferma un certificato cambiato
qualunque sia il protocollo.

## Misurato oggi (main `be8ae1c6` + ramo `fix/cra-default-sicuri`)

Sei archivi, ognuno con regole, formato e interfaccia propri:

| Uso | Archivio | Formato | Interfaccia oggi |
|---|---|---|---|
| Certificato del server web (8443/8444) | `<config>/tls.crt` + chiave | PEM | Configurazione → Istanza → Device → Stato → Certificato TLS (opt-in: senza, HTTP in chiaro) |
| IDE → dispositivi remoti (TOFU) | `<config>/dispositivi_conosciuti.yaml` | impronte SHA-256 (`sws_core::pin_tls`) | «dimentica» nella connessione al dispositivo |
| Broker MQTT (TOFU, Q49) | `<config>/mqtt_broker_conosciuti.yaml` | impronte SHA-256 | nessuna: si cancella a mano la riga |
| OPC UA client, per sorgente | `<progetto>/opcua-pki/<sorgente>/{own,private,trusted,rejected}` | DER/PEM di async-opcua | trust store nella scheda della sorgente (elenco, fidati, elimina) |
| OPC UA server | identità del server OPC UA del runtime (`run_server`) | da misurare | nessuna |
| Viewer LVGL → proprio runtime (TOFU) | `~/.config/sws/<file>` (`sws-lvgl-viewer/src/tls.rs`) | impronte SHA-256 | nessuna: si cancella a mano |
| Gateway cloud e tunnel | CA pubblica (Let's Encrypt) | — | nessuna serve: verifica come i browser |

Due modelli convivono: le **impronte** (`pin_tls`, stile `known_hosts`) e l'**archivio PKI** di OPC UA (cartelle
`trusted/rejected`). La vista unica dovrebbe mostrarli allo stesso modo senza fonderli per forza.

## Perché ha senso, e quando

- Il **CRA** chiede impostazioni sicure e un modo per tornarci (requisiti b, d, m): un posto solo dove vedere e
  revocare la fiducia lo rende verificabile, e lo stesso posto serve al **reset di fabbrica** (C5) per sapere cosa
  cancellare.
- Il **TLS di default sul pannello** (C4, onda 3) cambia proprio il primo archivio e il modo in cui l'IDE si fida del
  pannello: è il momento naturale. Proposta: **progettarlo nella stessa sessione di plan dell'onda 3** (P6 + C4),
  e farlo come ramo di quell'onda o subito dopo.

## Domande aperte per la sessione di plan

- Dove vive la vista per un pannello senza IDE (pagina di servizio del runtime?) e per l'IDE nel cloud.
- Chi può toccarla (solo Admin? doppia conferma per «fidati»?), e cosa finisce nell'audit.
- Importazione di certificati firmati da una CA del cliente: formati, catena, chiave privata.
- Avvisi di scadenza: dove si vedono (barra dell'IDE, allarme di sistema, email).

## Rimisurato il 21-10-2026 — gli archivi sono cinque, e due cose nuove

- **Il cambio di porte non tocca il certificato del server web**: il titolo «(8443/8444)» nella
  tabella è solo testo. Il certificato ha come SAN `localhost`, gli IP di loopback e quello della
  LAN, nessuna porta (`sws-runtime/src/main.rs:2144-2156`).
- **Tocca invece il pinning**, e in un modo che va scritto: la chiave delle impronte è
  **`host:porta`**, non `host` (`sws-web/src/certificati.rs:38-46`,
  `sws-lvgl-viewer/src/tls.rs:42-53`). Passare da 8443 a 7443 è una chiave nuova, cioè una fiducia
  al primo contatto da capo, e la riga vecchia resta lì. «Dimentica» è già a posto — toglie tutte
  le porte di quell'host (`pin_tls.rs:120-137`) — ma nessuno fa pulizia da sé. Da decidere quando
  si costruisce la vista: la riga morta si lascia, o la si toglie quando il ripiego di porta
  scatta?
- **La riga 5 si cancella: il trust store del server OPC UA non esiste.** `run_server` usa
  `ServerBuilder::new_anonymous` (`sws-plugin-opcua/src/lib.rs:1029-1033`), che dichiara un solo
  endpoint `none`; `create_sample_keypair` e `pki_dir` li chiama solo il **client**. Il
  `.trust_client_certs(true)` è inerte. Il server OPC UA di SWS non ha identità né trust store
  perché parla solo in chiaro: è una mancanza da gap analysis CRA, non una voce di questo menù.
  **Gli archivi sono cinque, non sei.**
- **Gli avvisi di scadenza non hanno niente da avvisare**, sul certificato del pannello: rcgen
  0.13.2 ha `not_after` al 4096 e nessuno dei due generatori lo cambia (`main.rs:2144-2167`,
  `system.rs:1013-1035`). Il self-signed non scade mai; l'avviso serve solo per un certificato di
  CA caricato a mano.
- **Non c'è un sottoinsieme veloce.** Nemmeno «una vista in sola lettura»: oggi nessuna rotta
  elenca gli archivi a impronte (c'è solo il gesto di dimenticare, `remote.rs:3019`), e nessuno
  dei campi che la vista vorrebbe mostrare — soggetto, emittente, validità — è disponibile senza
  una dipendenza nuova che parsi i certificati.

Reggono: `dispositivi_conosciuti.yaml`, `mqtt_broker_conosciuti.yaml`, `opcua-pki/<sorgente>/`,
`tls.crt`/`tls.key`, e il doppio modello impronte-contro-PKI.
