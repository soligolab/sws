# OPC-UA, Fase 4 — le decisioni, prese il 23-10-2026

> **Tutte e sei decise.** Il riassunto è qui in testa; sotto, ogni voce porta il perché e le
> opzioni scartate. Da qui si apre un ramo, non un'altra sessione di plan.

| | Decisione |
|---|---|
| **1. Collaudo** | **Il nostro server impara** a esporre una struttura e un array dietro un flag di prova. Il collaudo è client nostro contro server nostro, dentro `cargo test` |
| **2. Scrittura in una struttura** | **Il nodo figlio** (`HasComponent`). Il browse tipizzato diventa la premessa: 4b e 4c vanno nello **stesso ramo** |
| **3. Il `DataType`** | **Dal tipo dichiarato del tag**, anche in lettura. La Fase 4a l'aveva già scelto per la scrittura |
| **4. Il `DataTypeTree`** | **Sempre**, su tutti i namespace |
| **5. Scritture dal server** | **Passano dal bus**, con ripiego sul `TagDb` quando nessuno possiede il tag |
| **6. Bad o Uncertain** | **Tipo non gestito = Bad**; valore assente con stato Good resta Uncertain |

### Stato al 23-10-2026 sera

**Fatto**, ramo `feat/tag-4b-opcua-tipi`: le decisioni **5** (scritture dal server sul bus), **6**
(tipo non gestito = `Bad`), **3 estesa al server** (ogni nodo si dichiara col tipo del progetto,
non `Double` per tutti), la **metà array** della 1 (il server sa esporre gli array: prima li
saltava in silenzio), e il **browse tipizzato** — che non era una decisione ma è la premessa della
2, e serve già da solo: il «＋» di ogni riga propone il tipo letto dal server invece di farlo
scegliere a mano.

**Fatto**, ramo `feat/tag-4c-opcua-strutture`: le **foglie come nodi figli**, dai due lati.

- **Sul nostro server**: un tag composito non è più un nodo solo che l'updater saltava in
  silenzio — è una cartella con **un nodo figlio per foglia**, e l'identificatore di ciascuno è il
  **percorso del `TagDb`** (`motore1.velocita`). Così chi scrive su quel nodo scrive sulla foglia
  giusta senza nessuna tabella di conversione. Era quello che la Fase 4 del piano dei tag diceva
  fin dall'inizio: «esporre foglie come nodi figli, strutture vere dopo».
- **Sul client**: la **decisione 2** è dentro. Un browse per radice composita a inizio sessione
  costruisce `percorso → NodeId` del figlio, e la scrittura su una foglia ci va sopra. Un server
  che i figli non li espone riceve un rifiuto che adesso dice **perché**, invece di «non ancora
  supportata».
- Un difetto che il compilatore non vedeva: il `TagDb` trasmette la **radice**, non le foglie, e
  i nodi figli non si sarebbero aggiornati mai. `espandi_foglie` è la funzione che esiste per
  questo, e la usano già il WebSocket, lo storico e gli allarmi.

**Resta solo la struttura OPC-UA vera**: un `DataType` pubblicato dal nostro server con
`DataTypeBuilder::data_type_definition`, e il `DataTypeTree` + `DynamicTypeLoader` sul client per
leggere un `ExtensionObject` da un server di terzi.

**Gli appigli ci sono, verificati il 23-10-2026**: `node_mgr.address_space()` ce l'abbiamo già,
`DataTypeBuilder::data_type_definition` esiste (`async-opcua-nodes/src/data_type.rs:35`) e
`.insert(address_space)` è il solito (`lib.rs:200`). L'esempio del crate usa `add_node` su un
node manager di prova, che `SimpleNodeManager` non espone — ma la strada dell'address space
funziona lo stesso. **L'avvertimento che avevo scritto è risolto.**

**Una misura utile per quando si farà.** Il crate ha un esempio completo e funzionante:
`async-opcua-0.18.0/tests/integration/custom_types.rs`, 156 righe. Pubblica un tipo struttura con
`DataTypeBuilder::new(...).data_type_definition(DataTypeDefinition::Structure(...))` e `add_node`,
costruisce il valore con `DynamicStructure::new_struct`, e dall'altra parte usa
`DataTypeTreeBuilder` + `DynamicTypeLoader`. **L'opzione (a) regge**, e costa meno di quanto
sembrava.

Un avvertimento, però: quell'esempio usa le API **interne** del node manager
(`nm.inner().add_node(...)`, `nm.address_space()`, `handle.type_tree()`), e il nostro `run_server`
costruisce l'indirizzario in un altro modo. **Il primo passo di quel lavoro è verificare che il
nostro node manager esponga gli stessi appigli**: se non li espone, la stima cambia di nuovo.

### Quello che le decisioni cambiano, messo insieme

**4b e 4c diventano un ramo solo.** La decisione 2 lo impone: se un campo di struttura si scrive
sul nodo figlio, bisogna prima **sapere che quel figlio esiste** — e lo dice il browse tipizzato,
che è la 4b. Non si possono più fare in due sessioni separate.

**Il server cresce in due direzioni nello stesso giro**: deve imparare a esporre array e strutture
(decisione 1) e a far passare le scritture entranti dal bus (decisione 5). Le due cose si toccano
nello stesso file e conviene farle insieme.

**Il `DataTypeTree` sempre, e il costo si paga anche dove non serve.** Era la scelta che avevo
sconsigliato: un progetto di soli scalari sfoglia la gerarchia dei tipi del server a **ogni
riconnessione**. Il maintainer l'ha scelta lo stesso, e la scelta è difendibile — è semplice, è
**misurabile** sul primo server vero, e tornare a «solo se serve» è una riga. Va misurata, non
dimenticata: se su un server grosso la riconnessione diventa lenta, è il primo posto da guardare.

**Il tipo dichiarato come fonte del `DataType` ha una conseguenza da dire nel manuale**: se il tag
dichiara `u16` e il nodo è un `Float`, vince quello che dice il progetto. È il contrario di oggi
per la lettura, dove vince il `Variant` che arriva. Un errore di dichiarazione diventa un errore
visibile invece che un valore storto in silenzio — ma va scritto.

---

# Il materiale che ha istruito le decisioni

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

## 1. Come si collauda una struttura? — **DECISA: il nostro server impara**

| | Cosa vuol dire | Costo |
|---|---|---|
| **a** | Insegnare al **nostro** `run_server` a esporre, dietro un flag di prova, una struttura e un array. Collaudo dentro `cargo test`, senza niente da installare. | Il lavoro in più che lo scettico ha trovato. E si prova il nostro encoder contro il nostro decoder: un server vero può comportarsi diversamente |
| **b** | Installare `python-asyncua` e scrivere uno script in `scripts/` che espone una struttura. | Più vicino a un server vero. Va deciso **prima**, perché serve mentre si scrive il codice |
| **c** | Rimandare le strutture: in questo giro solo gli **array**, che il nostro server può esporre con poco. | La Fase 4 diventa due sessioni invece di tre, e le strutture restano un buco dichiarato |

**Cosa cambia:** con (c) la sessione C non esiste in questo giro.

## 2. Scrivere dentro una struttura: come? — **DECISA: il nodo figlio**

`NumericRange` indirizza **solo gli array**. Non esiste una forma che indirizzi il campo di una
struttura (`None | Index | Range | MultipleRanges`, e basta).

| | Cosa vuol dire | Costo |
|---|---|---|
| **a** | Leggi-modifica-riscrivi: una Read del nodo, si cambia il campo, una Write dell'intero. | Funziona ovunque. Ma due operatori che scrivono due campi diversi nello stesso istante **si cancellano a vicenda**: serve un test sulla corsa e una riga di manuale |
| **b** | Rifiutarla, come oggi, e dire che una radice-struttura OPC-UA è in sola lettura. Gli array restano scrivibili. | Metà del lavoro |
| **c** | Scrivere il **nodo figlio**: molti server espongono i campi anche come nodi `HasComponent`. | Il browse tipizzato diventa la premessa, e i due vanno nello stesso ramo |

## 3. Il `DataType` del nodo, da dove arriva? — **DECISA: dal tipo dichiarato del tag**

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

## 4. Quanto largo si costruisce il `DataTypeTree`? — **DECISA: sempre**

Senza, un `ExtensionObject` non si decodifica. L'esempio del crate usa il filtro «namespace ≤ 2».

| | Cosa vuol dire |
|---|---|
| **a** | Sempre, su tutti i namespace. Semplice, ma a ogni riconnessione si sfoglia l'intera gerarchia dei tipi del server |
| **b** | Solo se almeno un nodo mappato è una radice composita. Un progetto di soli scalari non paga niente |
| **c** | Sempre, ma filtrato ai namespace che i `node_id` del progetto nominano davvero |

**Proposta mia era (b)**; il maintainer ha scelto **(a), sempre**. Il costo è reale e va
**misurato sul primo server vero**: un progetto di soli scalari paga una browse della gerarchia dei
tipi a ogni riconnessione. Se diventa lento, tornare a (b) è una riga.

## 5. Il server OPC-UA: le scritture da un SCADA passano dal bus? — **DECISA (a), 23-10-2026**

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

> **Decisa il 23-10-2026: (a), si passa dal bus.** Il maintainer l'ha presa parlando d'altro — di
> OpenPLC, e di chi fra i due sia il master — ed è il contesto che la rende ovvia: un SWS esposto a
> un altro sistema che scrive su un tag di campo e non lo manda al campo è un difetto che nessuno
> vede finché non guarda il dispositivo. La stessa regola varrà per il **server Modbus**, quando
> si farà: vedi il seme [server Modbus](2026-10-23-server-modbus.md).

## 6. Un valore che non si sa leggere: Bad o Uncertain? — **DECISA: non gestito = Bad**

Oggi tutti e due i casi — tipo non gestito, e valore assente — danno **Uncertain**. La Fase 4a non
l'ha cambiato: ha solo smesso di inventare uno zero.

| | Cosa vuol dire |
|---|---|
| **a** | Tipo non gestito = **Bad** (il dato c'è ma non lo sappiamo leggere: è un difetto nostro o una configurazione sbagliata, e va visto). Valore assente = Uncertain |
| **b** | Tutti e due Uncertain, come oggi |
| **c** | Come (a), più un avviso **una volta sola per tag**, come fa già il `TagDb` per le conversioni |

**Cosa cambia:** sul pannello è la differenza fra un bordo di allarme e un dato ingrigito. Due
righe di codice, ma è UX e il manuale la dichiara.

> **Decisa il 23-10-2026: tipo non gestito = `Bad`**, valore assente con stato Good resta
> `Uncertain`. Scartata la variante con l'avviso una volta sola.
>
> **Dove si tocca**: `valore.rs`, `da_data_value`, il ramo in cui `da_variant` torna `None`. Oggi
> dà `Uncertain` per tutti e due i casi, perché la Fase 4a ha cambiato **solo** lo zero inventato
> e non la qualità. Sono due righe, e vanno nel ramo 4b/4c — non da sole: la 2.19.0 è già
> pubblicata, e un cambio di qualità a schermo merita di viaggiare con il resto e la sua voce
> nelle Novità.

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
