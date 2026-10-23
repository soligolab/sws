# OPC-UA, Fase 4 — le sei decisioni che restano

> **Da decidere, non da leggere.** La Fase 4a (i difetti) è fatta: ramo `feat/tag-4a-opcua-difetti`.
> Qui c'è solo quello che non si può fare senza di te. Ogni voce ha le opzioni e cosa cambia nel
> lavoro a seconda della risposta.
>
> Misurato il 22-10-2026 con tre esplorazioni e uno scettico. Il piano dei tag
> ([Fase 4](2026-09-21-gestione-tag-oggetto-unico.md)) elencava dieci punti: uno era già chiuso, e
> tutti i numeri di riga erano vecchi.

## Prima: una cosa che cambia il costo di tutto il resto

**Il nostro server OPC-UA non sa esporre né array né strutture.** `tag_value_to_variant` tornava
`None` per `Array` e `Struct`, e l'updater li saltava **in silenzio**. Conta perché il modo più
naturale di collaudare la Fase 4 sarebbe «client nostro contro server nostro, dentro `cargo test`»:
ma quel server va prima insegnato a parlare. L'ha trovato lo scettico, non la misura.

E non c'è nessun server OPC-UA con strutture su questa macchina: `python3 -c "import asyncua"`
fallisce, e il template `opcua-demo` ha cinque tag tutti scalari.

---

## 1. Come si collauda una struttura, se un server con strutture non ce l'abbiamo?

| | Cosa vuol dire | Costo |
|---|---|---|
| **a** | Insegnare al **nostro** `run_server` a esporre, dietro un flag di prova, una struttura e un array. Collaudo dentro `cargo test`, senza niente da installare. | Il lavoro in più che lo scettico ha trovato. E si prova il nostro encoder contro il nostro decoder: un server vero può comportarsi diversamente |
| **b** | Installare `python-asyncua` e scrivere uno script in `scripts/` che espone una struttura. | Più vicino a un server vero. Va deciso **prima**, perché serve mentre si scrive il codice |
| **c** | Rimandare le strutture: in questo giro solo gli **array**, che il nostro server può esporre con poco. | La Fase 4 diventa due sessioni invece di tre, e le strutture restano un buco dichiarato |

**Cosa cambia:** con (c) la sessione C non esiste in questo giro.

## 2. Scrivere dentro una struttura: come?

`NumericRange` indirizza **solo gli array**. Non esiste una forma che indirizzi il campo di una
struttura (`None | Index | Range | MultipleRanges`, e basta).

| | Cosa vuol dire | Costo |
|---|---|---|
| **a** | Leggi-modifica-riscrivi: una Read del nodo, si cambia il campo, una Write dell'intero. | Funziona ovunque. Ma due operatori che scrivono due campi diversi nello stesso istante **si cancellano a vicenda**: serve un test sulla corsa e una riga di manuale |
| **b** | Rifiutarla, come oggi, e dire che una radice-struttura OPC-UA è in sola lettura. Gli array restano scrivibili. | Metà del lavoro |
| **c** | Scrivere il **nodo figlio**: molti server espongono i campi anche come nodi `HasComponent`. | Il browse tipizzato diventa la premessa, e i due vanno nello stesso ramo |

## 3. Il `DataType` del nodo, da dove arriva?

Serve a leggere gli array, a scrivere, e a scegliere il `Variant`.

| | Cosa vuol dire |
|---|---|
| **a** | Si legge dal server alla connessione, una Read degli attributi per sessione. Il modello non cambia |
| **b** | Un campo `formato` nella mappatura, come ha Modbus, scritto dal wizard quando si sfoglia il server. Il progetto dice da sé cosa si aspetta |
| **c** | Si usa il **tipo dichiarato del tag**, che il progetto ha già |

**La Fase 4a ha già scelto (c) per la scrittura**, perché era la cosa conservativa: nessun campo
nuovo, nessuna lettura in più, e il ripiego sul comportamento di prima quando il tipo non c'è. Lo
scettico ha trovato il fatto che la rafforza: il bottone «+» di ogni riga del browse apre
`QuickCreateTagModal`, che il `data_type` **lo fa già scegliere all'utente**. Quindi per i tag
creati da lì il tipo sta già nel progetto.

**La domanda che resta**: (c) basta anche per la **lettura** degli array, o serve (a)/(b)?

## 4. Quanto largo si costruisce il `DataTypeTree`?

Senza, un `ExtensionObject` non si decodifica. L'esempio del crate usa il filtro «namespace ≤ 2».

| | Cosa vuol dire |
|---|---|
| **a** | Sempre, su tutti i namespace. Semplice, ma a ogni riconnessione si sfoglia l'intera gerarchia dei tipi del server |
| **b** | Solo se almeno un nodo mappato è una radice composita. Un progetto di soli scalari non paga niente |
| **c** | Sempre, ma filtrato ai namespace che i `node_id` del progetto nominano davvero |

**Proposta mia: (b).** Con (b) i progetti di oggi non cambiano di un millisecondo, e il costo si
paga solo dove serve. Ma è una scelta tua.

## 5. Il server OPC-UA: le scritture da un SCADA passano dal bus?

Oggi vanno **dritte nel `TagDb`**, e il parametro si chiama `_bus`: è dichiarato inutilizzato.

**Cosa succede oggi**: un SCADA che scrive su un tag posseduto da una sorgente Modbus mette il
valore nel `TagDb`, e al giro di lettura dopo il campo lo cancella. **Al dispositivo non arriva
mai.** Nessun errore, nessun avviso.

| | Cosa vuol dire |
|---|---|
| **a** | `bus.write` con ripiego su `db.set` quando nessuno possiede il tag — la stessa regola di `PUT /api/tags/:id` | 
| **b** | Resta com'è, e il manuale dice che i tag esposti dal server devono essere tag virtuali |

**Cosa cambia:** (a) è un cambio di comportamento visibile e va in `NOVITA.yaml`. Serve lo
`scale_to_raw` prima del bus e un test che una scrittura arrivi fino a un dispositivo finto.

## 6. Un valore che non si sa leggere: Bad o Uncertain?

Oggi tutti e due i casi — tipo non gestito, e valore assente — danno **Uncertain**. La Fase 4a non
l'ha cambiato: ha solo smesso di inventare uno zero.

| | Cosa vuol dire |
|---|---|
| **a** | Tipo non gestito = **Bad** (il dato c'è ma non lo sappiamo leggere: è un difetto nostro o una configurazione sbagliata, e va visto). Valore assente = Uncertain |
| **b** | Tutti e due Uncertain, come oggi |
| **c** | Come (a), più un avviso **una volta sola per tag**, come fa già il `TagDb` per le conversioni |

**Cosa cambia:** sul pannello è la differenza fra un bordo di allarme e un dato ingrigito. Due
righe di codice, ma è UX e il manuale la dichiara.

---

## Quando avrai deciso

- **4b** — browse tipizzato (DataType, ValueRank, ArrayDimensions: oggi `browse_one_level` torna
  solo quattro campi), server tipizzato, scrittura negli array. Una sessione.
- **4c** — le strutture: `read_namespace_array` + `set_namespaces`, `DataTypeTreeBuilder`,
  `DynamicTypeLoader`, e la lettura di un `ExtensionObject`. Una sessione, se la decisione 1 non la
  cancella.
- **Nell'IDE** — manca solo il percorso **di massa** da un nodo-struttura a tipo + istanza. Il
  modello esiste già, scritto e collaudato, nel catalogo Modbus (`daCatalogoConfermato`): tipi,
  poi tag, poi sorgente, in quest'ordine — il commento lì spiega che l'ordine sbagliato produsse
  127 variabili orfane il 04-10-2026.
