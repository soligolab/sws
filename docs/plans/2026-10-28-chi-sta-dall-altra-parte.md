# Chi sta dall'altra parte: la disponibilità del dispositivo, e un allarme quando sparisce

> **Seme — decisione.** Nato il 28-10-2026 da un guasto diagnosticato sul TC620 di casa.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita per sviscerarne
> tutti i dettagli.** Quello che segue sono le misure di oggi e le strade che si vedono, non un disegno.

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
