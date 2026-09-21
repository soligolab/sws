# Gestione dei tag: un oggetto unico, con strutture e array

> **Stato**: seme — decisione (21-09-2026, rivisto lo stesso giorno per strutture e array). Materiale, non piano d'esecuzione.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, in Plan mode, per
> sviscerarne tutti i dettagli.** Non si progetta qui: fra la domanda e il lavoro cambia troppo.
>
> **Le due richieste vanno progettate insieme**, non una dopo l'altra: strutture e array cambiano che cosa *è* un
> tag, e ridisegnare la gestione prima per poi ridisegnarla di nuovo sarebbe il lavoro sprecato.

## L'idea (maintainer, 21-09-2026)

1. **Un oggetto unico.** I tag oggi vivono in due posti che non si parlano: la **tabella variabili** (il registro:
   tipo, unità, storico, allarmi, scala) e i **riferimenti** sparsi nel resto del progetto (mappature delle sorgenti,
   oggetti sinottici, allarmi, trend…), che citano un id in un campo di testo libero. Il maintainer li vuole un
   oggetto solo, **usato e creato dove serve**, con la creazione **al salvataggio**. «La gestione attuale mi lascia
   molto perplesso.»
2. **Strutture e array** (annunciato il 21-09-2026, «a breve»): un tag che non sia solo uno scalare.

## Misurato nel codice (21-09-2026)

**Gestione attuale** (`sws-editor/src/config/ConfigView.tsx`):
- il campo tag di una mappatura è testo libero (`TagInput`) e non crea niente da solo;
- il tag si crea a mano col pulsante **«+var»** (`:1547` Host, `:1415`, `:1660`, `:4538` altre sorgenti), default
  `float`/`string`, `history: false`; i wizard di importazione hanno la casella «crea i tag» attiva (`:2824`, `:3943`);
- un id inesistente **non dà avvisi**: il valore non arriva. Non verificato se un altro punto dell'editor lo segnali;
- motivi plausibili (**non documentati**, ipotesi): campo modificato a ogni tasto (creazione di tag spuri), `history`
  pesa sul database, l'id può puntare a un tag già esistente.

**Modello dei valori: oggi solo scalari.**
- `TagValue` (`sws-core/src/tag.rs:20`) è `Bool | Int(i64) | Float(f64) | Str`, serializzato **untagged** come JSON
  nativo; `TagDataType` (`sws-editor/src/types/index.ts:853`) è `bool | int | float | string`.
- `TagDef` (`sws-core/src/project.rs:17`, `types/index.ts:871`) è una riga piatta: id, tipo, scala, storico
  (deadband, intervallo), `expression`, `generator`, `write_data_type` (Q29).
- **Nessuno dei plugin** (`opcua`, `enip`, `s7`, `modbus`, `mqtt`, `homeassistant`), né lo storico, né
  `sws-pyscript`, ha una gestione esplicita di array, strutture o UDT (ricerca testuale, a zero). Quello che un
  dispositivo espone come array o UDT oggi o non si può mappare o si mappa un elemento alla volta a mano.

## Che cosa cambia con strutture e array

Un tag smette di essere una riga e diventa un **nodo di un albero**: `motore`, `motore.velocita`, `valvole[3].stato`.
Da qui le domande che l'«oggetto unico» deve già contenere, altrimenti viene rifatto:

- **Identità e indirizzo**: come si scrive e si risolve un percorso (`a.b[2].c`); che cosa è «il tag» quando ne
  esistono padre e figli; cosa diventa il campo di testo libero.
- **Definizione riusabile**: una struttura è un **tipo** definito una volta e istanziato più volte (un motore, dieci
  motori)? È l'idea naturale dell'oggetto unico, e sposta il lavoro dal singolo tag al tipo.
- **Modello del valore**: valori composti nativi (`TagValue` con array/oggetto) oppure **foglie scalari** con id
  strutturato, raggruppate da una definizione. Le due strade decidono quanto cambiano runtime, storico, viewer LVGL,
  espressioni Python (`tags["x"]`), allarmi e scala — il costo va misurato, non intuito.
- **Sorgenti**: mappare array/UDT dove il protocollo li ha nativi (OPC-UA array e strutture, EtherNet/IP UDT e array,
  blocchi S7, registri Modbus contigui, JSON di MQTT/HA) e come si crea in blocco l'albero da un browse.
- **Storico e allarmi**: per foglia, per elemento, per intera struttura? Lo storico registra oggi campioni scalari.
- **Oggetti sinottici e IA**: un widget legato a un elemento o a un intero array (tabella, trend multi-serie);
  come l'assistente IA scrive progetti con tag strutturati; template e progetti esistenti (migrazione: «Migra i
  testi…» è il precedente).

## Domande di base per la sessione di plan

- Quali sono **tutti i punti** che citano un tag (sorgenti, oggetti, allarmi, trend, azioni, IA)?
- **Chi possiede** la definizione quando due riferimenti chiedono cose diverse (tipo, unità, storico)?
- Creazione **al salvataggio**: con quali default, e che succede a un id **rinominato** o **tolto** (tag orfani:
  il pannello database ne conta già)?
- Compatibilità: tutti i progetti attuali hanno solo tag scalari piatti e devono continuare a funzionare senza
  migrazione obbligatoria.
