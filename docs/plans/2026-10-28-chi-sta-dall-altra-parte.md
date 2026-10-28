# Chi sta dall'altra parte: la disponibilità delle sorgenti, e un allarme quando sparisce

> **Era un seme, dal 28-10-2026 (sera) è un piano d'esecuzione.** Sessione di plan col maintainer lo stesso giorno,
> misurando il codice; le quattro decisioni sono sue. Il testo del seme resta sotto, perché è il motivo per cui il
> lavoro è nato.

## Decisioni del maintainer (28-10-2026)

1. **La disponibilità è una proprietà della sorgente**, e produce un tag booleano normale `<sorgente>.disponibile`.
   Per MQTT vale «broker raggiungibile **e** topic di disponibilità che dice vivo» (topic, percorso JSON, valore di
   «vivo», con preimpostazioni Zigbee2MQTT / Tasmota / Shelly / ESPHome). Per gli altri protocolli vale lo stato di
   collegamento che il plugin già conosce.
2. **Quando l'altro capo è morto, i tag della sorgente passano a qualità `Bad`**: tengono l'ultimo valore, i sinottici
   mostrano già lo stale, e un allarme di soglia non scatta su un valore `Bad` (regola già in `alarm.rs`). Tornano
   `Good` col primo valore vero, non col ritorno del bridge: fino ad allora non sappiamo cosa c'è.
3. **L'allarme si crea a mano, aiutato**: è un allarme normale `bool_false` sul tag di disponibilità; nella sorgente un
   pulsante «Crea l'allarme di disponibilità» lo prepara (60 s di `on_delay_s`, messaggio con il nome della sorgente),
   e da lì vale tutto quello che c'è — notifiche, tabella eventi, telefono, storico.
4. **Tutte le sorgenti**, non solo MQTT.

## Misurato il 28-10-2026

- `sws_core::stato_sorgenti` (bus + dispositivi, con `da_ms`) esiste e lo legge l'albero dell'IDE, ma **lo scrive solo
  Modbus**. MQTT, S7, OPC-UA, EtherNet/IP, Home Assistant hanno ognuno il punto in cui la sessione si apre e cade
  (`MQTT session ended`, `tunnel/sessione chiusa`…), e da lì va scritto.
- `TagDb::marca_qualita(id, q)` esiste, anche sulle foglie dei compositi (la radice prende la peggiore).
- `AlarmDef.on_delay_s` esiste: «non risponde da N secondi» non chiede niente di nuovo.
- La validazione avvisa per un allarme su un tag non dichiarato («non scatterà mai»): il tag di disponibilità si
  **dichiara nel progetto** come le metriche della sorgente host, così il selettore dei tag e la validazione lo vedono.
- Lo Zigbee2MQTT di casa ha `availability.enabled: false`: la disponibilità **per dispositivo** non c'è; c'è quella del
  bridge (`zigbee2mqtt/bridge/state`, testamento sul broker, conservato).

## Il lavoro — un ramo alla volta

### 1. `feat/disponibilita-sorgenti` (runtime)

- `sws-core`: `Disponibilita { topic, json_path?, vivo }` nella sorgente MQTT (serde default, assente = solo il
  broker); il nome del tag `<id>.disponibile` in un punto solo.
- Ogni plugin scrive lo stato del bus in `stato_sorgenti` all'apertura e alla caduta della sessione (oggi solo Modbus).
- Il supervisore deriva `<id>.disponibile` per ogni sorgente dallo stato del bus (e, per MQTT, dal topic di
  disponibilità), lo scrive ai cambi, e al passaggio a falso marca `Bad` i tag mappati di quella sorgente.
- Test: la preimpostazione Zigbee2MQTT su `{"state":"offline"}` e su `offline` in chiaro; un broker giù; il ritorno
  che non rimette `Good` finché non arriva un valore.

### 2. `feat/disponibilita-editor` (IDE)

- Nella card della sorgente MQTT: la sezione «Disponibilità» con le preimpostazioni; accenderla dichiara il tag.
- Per tutte le sorgenti: il tag di disponibilità visibile nella card, e il pulsante «Crea l'allarme di disponibilità».
- Validazione: un topic di disponibilità che nessuna preimpostazione riconosce e senza valore di «vivo» → avviso.

### 3. Documenti e CasaDomotica

- Manuale (protocolli e allarmi), CHANGELOG, NOVITA, collaudi.
- **CasaDomotica**: disponibilità Zigbee2MQTT sulle sorgenti `mqtt-*` che parlano con Zigbee2MQTT, e l'allarme con
  Telegram — è il caso che ha fatto nascere il piano.

## Fuori, dichiarato

- La disponibilità **per dispositivo** di Zigbee2MQTT (va accesa in Zigbee2MQTT; si aggiunge dopo, per riga).
- **I comandi mentre l'altro capo è morto si mandano lo stesso**: il segnale può sbagliare, e un comando rifiutato da
  SWS per un falso «morto» sarebbe peggio. Il sinottico in stale dice già all'operatore che non sa cosa c'è.
- Un avviso nel fulmine dell'IDE: viene dopo, quando il tag esiste.

---

## Il seme (28-10-2026)

## Perché nasce

I bottoni della pagina Garage di CasaDomotica non accendevano più le luci. SWS faceva la sua parte: il runtime del
TC620 pubblicava i `TOGGLE` su `zigbee2mqtt/switch_garage/l1|l2|l3/set` (log del 28-10, alle 21:05 e alle 21:12).
**Era Zigbee2MQTT a essere spento**: sul broker il messaggio conservato `zigbee2mqtt/bridge/state` diceva
`{"state":"offline"}`, e in 20 secondi sotto `zigbee2mqtt/#` non è arrivato nessun messaggio dal vivo. L'ultimo
resoconto di salute del bridge era del 27-10 alle 14:09: **oltre trenta ore** di rete Zigbee senza controllo, e
nessuno lo sapeva.

L'interfaccia non ne mostrava niente. I bottoni mandavano comandi nel vuoto, i tag tenevano l'ultimo valore con
qualità buona, e l'unico indizio stava in un messaggio conservato sul broker, che si è dovuto andare a leggere a mano.

Il maintainer (28-10-2026): «buona idea, avrebbe anche senso poter generare un allarme da collegare alle notifiche
per un avviso tempestivo».

## Cosa c'è (misurato il 28-10-2026)

| Pezzo | Oggi | Limite |
|---|---|---|
| `sws_core::stato_sorgenti` | risponde / non risponde / mai collegato, per sorgente e dispositivo; lo leggono i pallini dell'albero | lo riempie **solo Modbus**; MQTT non lo scrive |
| Sorgente MQTT | sa dire se il **broker** è raggiungibile; pubblica un proprio `last_will` | non sa niente di chi sta **dietro** il broker: un broker vivo con Zigbee2MQTT morto è, per SWS, tutto a posto |
| Qualità del tag | `Good`/`Uncertain`/`Bad`, con lo stale dei sinottici | un tag MQTT non diventa mai `Bad` per assenza dell'altro capo: tiene l'ultimo valore |
| Allarmi (`AlarmCondition`) | soglie, booleani, `And`/`Or`/`Not` su **valori** | nessuna condizione su qualità o disponibilità; il commento in `alarm.rs` ricorda che un valore `Bad` non deve far scattare soglie |
| Notifiche | email, Telegram, SMS e voce, con la tabella eventi × canali | scattano solo da un allarme |

Lo stesso schema vale oltre Zigbee2MQTT: Tasmota (`tele/<x>/LWT` = `Offline`), Shelly (`<x>/online` = `false`), ESPHome
(`<x>/status`), Home Assistant (`homeassistant/status`), un PLC che pubblica il proprio LWT. Sono **convenzioni
diverse per la stessa cosa**.

## Le strade che si vedono

1. **Un topic di disponibilità per riga o per sorgente MQTT**: il topic e i valori che vogliono dire «vivo» e «morto»,
   con preimpostazioni per Zigbee2MQTT, Tasmota, Shelly ed ESPHome, come il ⟳ dello stato iniziale (piano
   `2026-10-25-stato-iniziale-mqtt.md`). Quando è «morto», i tag collegati passano a qualità `Bad` (lo stale dei
   sinottici lo mostra già) e lo stato della sorgente entra in `stato_sorgenti`.
2. **Un allarme di disponibilità**: una condizione nuova («la sorgente o il dispositivo non risponde da N secondi»)
   oppure un tag di sistema per sorgente (`_sws.sorgente.<id>.disponibile`, booleano) su cui si mette un allarme
   `bool_false` come gli altri. La seconda riusa allarmi, storico, notifiche e tabella eventi senza toccarli; la prima
   è più leggibile per chi configura.
3. **Avvisi nel fulmine dell'IDE**: «Zigbee2MQTT non risponde dal 27-10 alle 14:09», con il rimedio. È gratis una volta
   fatto il punto 1, ma da solo non avvisa nessuno che non stia guardando l'IDE.

## Le domande da sciogliere nella sessione di plan

- **Per riga o per sorgente?** Una sorgente MQTT spesso parla con più cose (lo switch e il bridge sono due livelli).
- **Generico o per ecosistema?** Un topic + due valori copre tutto ma va scritto a mano; le preimpostazioni lo rendono
  un clic, ma sono un elenco da tenere.
- **Dopo quanto si dà per morto**, e cosa succede ai comandi mentre lo è: rifiutati con un messaggio, o mandati lo
  stesso perché il broker li tiene?
- **Lo stesso per gli altri protocolli**: Modbus e OPC-UA hanno già un «non risponde»; vale la pena che l'allarme di
  disponibilità sia unico per tutti, non solo per MQTT.
