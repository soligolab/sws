# Modbus TCP: il bus che non serve, e il trasporto che il catalogo non dichiara

> **Seme — decisione.** Nato il 06-10-2026 da un'osservazione del maintainer mentre configurava
> Modbus: «per la configurazione Modbus TCP il concetto di bus non ha senso, ogni dispositivo che
> configuro è un dispositivo TCP con un IP univoco… poi bisognerebbe distinguere MCM280 (che ha solo
> Modbus TCP) dagli altri device che hanno il Modbus RTU e basta».
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita** che rilegga queste misure contro il codice di allora. Quello che segue è materiale,
> non un piano d'esecuzione: la riorganizzazione a bus e dispositivi è del 04-10-2026 e può muoversi
> ancora. **Non è urgente** — decisione del maintainer, 06-10-2026: «per il Modbus per ora lasciamo
> così com'è».

## Sono due questioni, non una

Vengono dalla stessa frase ma hanno dimensioni molto diverse: la prima tocca il modello e
l'interfaccia, la seconda è un campo mancante.

## 1. Il bus su Modbus TCP

**Dove il maintainer ha ragione.** Nel caso normale un modulo TCP è un IP e basta. L'interfaccia di
oggi obbliga comunque a creare un contenitore — il bus — che conterrà sempre e solo quell'unico
dispositivo, e a scendere due livelli nell'albero della Configurazione per arrivarci. È cerimonia
pagata da tutti per un caso che riguarda pochi.

**Perché però il bus non va tolto dal modello.** Misurato il 06-10-2026: `ModbusTcpConfig.devices`
esiste con un motivo dichiarato nel codice (`sws-runtime/crates/sws-core/src/project.rs:578`):

> «I dispositivi sul bus (04-10-2026): per un gateway, più unit id dietro lo stesso indirizzo.»

È il convertitore Modbus TCP→RTU: **un solo IP:porta, e dietro una catena di slave RS-485 con unit
id diversi**. Lì il raggruppamento è la cosa giusta e non un sovrappiù — una sessione TCP sola,
interrogazione in ordine, timeout e pallino di stato per dispositivo, che è esattamente la macchina
costruita il 04-10. Togliere il bus dal modello toglierebbe l'unico modo di esprimere quel caso.

**Quindi la domanda vera è dove si corregge**, e le opzioni visibili oggi sono tre:

1. **Solo interfaccia, bus implicito.** Il modello non cambia. Si aggiunge un dispositivo TCP con il
   suo IP, il bus nasce dietro le quinte, e compare come livello **solo** quando si mette un secondo
   unit id dietro lo stesso indirizzo. Costo: nascondere un livello senza renderlo irraggiungibile è
   la parte difficile, e tocca l'albero della Configurazione rifatto da poco.
2. **Due forme nel modello**: un `modbus_tcp` «dispositivo singolo» accanto a un `modbus_tcp`
   «gateway». Più esplicito a schermo, ma raddoppia i casi nel validatore, nel motore e nell'editor —
   ed è il genere di sdoppiamento che la regola «una sezione per dato» vieta nell'editor per ragioni
   che valgono anche qui.
3. **Lasciare com'è** e spiegarlo nel manuale. È il default di oggi, ed è la scelta presa per ora.

## 2. Il trasporto, che il catalogo non dichiara

Qui non ci sono due campane: **è un buco**, e il maintainer ha ragione senza riserve.

Il catalogo la distinzione la porta già, ma **solo per implicito** — un dispositivo RTU ha il blocco
`modbus.seriale`, un TCP no. Misurato il 06-10-2026 in `catalogo/dispositivi/pixsys/`:

```
mcm280x      modbus = {ordine: cdab, timeout_ms: 1000}
mcm260x-5ad  modbus = {ordine: abcd, timeout_ms: 1000, seriale: {baud_rate: 19200, parity: N, …}}
atr121       modbus = {ordine: cdab, timeout_ms: 1000, seriale: {baud_rate: 19200, parity: N, …}}
```

Nessun campo dichiara il trasporto e **nessuno lo controlla**. Oggi «+ Dal catalogo…» lascia mettere
un **MCM280X su un bus RTU** o un **ATR121 su un bus TCP**: il dispositivo nasce, non comunica, e per
capire perché bisogna già sapere che quel modello la seriale non ce l'ha.

Dedurre il trasporto dall'assenza di una chiave è fragile: basta un dispositivo che esista in due
varianti, o qualcuno che aggiunga `seriale` per completezza, e la deduzione mente senza dirlo.

**Forma proposta** — piccola, indipendente dal punto 1, fattibile in un ramo corto:

- un campo esplicito `modbus.trasporto: "tcp" | "rtu" | "entrambi"` nei file del catalogo;
- il selettore «Dal catalogo» mostra **solo** i dispositivi compatibili col bus che si sta riempiendo;
- il validatore rifiuta la combinazione sbagliata con un messaggio che la nomina;
- una guardia verifica che ogni file del catalogo lo dichiari — sul modello di `check_catalogo.sh`,
  da provare rossa.

## Rapporto con il resto

- Il catalogo dei dispositivi è del 04-10-2026, piano in
  [archivio](../archive/2026-10-04-catalogo-dispositivi.md); la riorganizzazione a bus e dispositivi
  è dello stesso giorno, [qui](../archive/2026-10-04-bus-e-dispositivi.md).
- Tocca la stessa superficie del seme
  [configuratore dei moduli all'avvio](2026-10-04-configuratore-moduli.md): se un giorno il runtime
  scrive la configurazione dentro il modulo, saprà anche su che trasporto ci arriva. Le due cose
  conviene guardarle insieme.
