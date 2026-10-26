# Lo stato iniziale dei tag MQTT

> **FATTO il 25-10-2026, da collaudare** sul ramo `feat/stato-iniziale-mqtt`. Nato come seme; il maintainer ha
> chiesto lo stesso giorno di fare «la parte MQTT per quello che può fare SWS» e di documentare i limiti di
> Zigbee2MQTT. Fatte le strade **b** e **c** qui sotto; la **a** è documentata nel manuale (capitolo 06, «Lo stato
> all'avvio»), con i limiti di Zigbee2MQTT.

## L'osservazione (maintainer, 25-10-2026)

«All'accensione del pannello lo stato dei 3 led agganciati allo switch a 3 vie li mostra tutti bianchi come non
definiti; appena agisco su uno dei 3 si allinea lo stato del led alla situazione reale.» Lo switch è il dispositivo
Zigbee `0xa4c13818559e363b` (luci del banco del garage), su Zigbee2MQTT, nel progetto CasaDomotica.

## La misura (25-10-2026)

- `sws-plugin-mqtt` (`lib.rs`, `run_session`) si collega, fa `subscribe` su ogni topic della mappatura e **aspetta**.
  Non c'è nessuna richiesta di stato all'avvio: il primo valore arriva solo se il broker lo consegna alla
  sottoscrizione, cioè se il messaggio era pubblicato con `retain`.
- **Zigbee2MQTT per default non pubblica lo stato con `retain`** (opzione `retain` per dispositivo, spenta). Quindi
  dopo un riavvio del pannello il tag resta senza valore — il led bianco è il comportamento giusto per «nessun valore
  ancora» — finché lo stato non cambia e Zigbee2MQTT ripubblica.
- Zigbee2MQTT sa rispondere a una richiesta: un publish su `zigbee2mqtt/<dispositivo>/get` con
  `{"state_l1":"","state_l2":"","state_l3":""}` fa ripubblicare lo stato attuale. Home Assistant via MQTT ha lo stesso
  problema con dispositivi diversi, e convenzioni diverse.

## Le strade già visibili

- **a — dal lato dell'impianto, senza codice**: `retain: true` sul dispositivo in Zigbee2MQTT (`devices:` in
  `configuration.yaml`, o dalla sua interfaccia). Risolve CasaDomotica subito; ogni impianto deve saperlo.
- **b — una «richiesta di stato» per sorgente o per riga della mappatura**: dopo la sottoscrizione SWS pubblica un
  payload configurato su un topic configurato (per Zigbee2MQTT, il `…/get`). Generale, ma è un campo in più da capire.
- **c — un preset Zigbee2MQTT**: la scoperta riconosce i topic `zigbee2mqtt/…` e compila da sola la richiesta di b.
- Da decidere anche cosa mostra il sinottico **finché** il valore non arriva: oggi bianco senza spiegazione.

Rimedio immediato per il maintainer, indipendente dalla scelta: la strada **a** sul dispositivo del garage.

## Com'è andata (25-10-2026)

- **`TopicMapping.richiesta_stato: {topic, payload}`** (`sws-core`). `sws-plugin-mqtt` la pubblica a ogni sessione,
  dopo le SUBSCRIBE e nella stessa coda del client, quindi la risposta trova la sottoscrizione attiva; le richieste
  uguali partono una volta; un topic vuoto o con `+`/`#` si scarta (errore di protocollo, morirebbe la sorgente) e
  la validazione lo dice come errore.
- **Nell'editor** il ⟳ di riga aggiunge la richiesta già compilata alla Zigbee2MQTT (`<topic>/get`,
  `{"<primo livello del json_path>":""}`, `state` se non c'è path), modificabile in una sotto-riga; il pulsante sotto
  la tabella la compila su tutte le righe `zigbee2mqtt/…` che non l'hanno.
- **Non fatto, di proposito**: cosa mostra il sinottico *mentre* aspetta il valore. Oggi resta il bianco della
  qualità incerta, che è vero; un'indicazione diversa è una decisione di aspetto per tutti i protocolli, non di MQTT.
- **CasaDomotica**: le righe del garage vanno compilate col pulsante dopo l'aggiornamento (regola del progetto di
  riferimento).
