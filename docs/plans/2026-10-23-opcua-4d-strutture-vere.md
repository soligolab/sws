# Fase 4d — strutture OPC-UA vere, dai due lati

> **Misurato il 23-10-2026** con quattro letture indipendenti e due scettici, e con una **sonda
> eseguita**: `tmp/misura-opcua-collaudo/` fa la catena intera — il nostro server pubblica un
> `DataType` con `DataTypeDefinition::Structure`, il nostro client ne decodifica
> `velocita = Float(12,5)` e `marcia = Boolean(true)` — in ~167 ms su runtime `current_thread`,
> cioè quello di un `#[tokio::test]`. **La fattibilità è provata eseguendo, non leggendo.**
>
> È l'ultimo pezzo della Fase 4 del [piano dei tag](2026-09-21-gestione-tag-oggetto-unico.md).
> Le decisioni stanno in [opcua-fase-4-decisioni](2026-10-22-opcua-fase-4-decisioni.md).

## La domanda, e la risposta — **il flag cade del tutto** (23-10-2026)

**Deciso dal maintainer**: nessun flag e nessun interruttore di compatibilità. Ogni tag composito
diventa una struttura OPC-UA vera, subito.

La conseguenza gli era stata detta prima della scelta: un client di terzi che sfogliava `motore1`
come cartella ci trova una `Variable` con un `DataType` struttura. I nodi figli **restano** — la
decisione 2 vuole che la scrittura ci passi — quindi chi leggeva le foglie continua a leggerle; a
cambiare è la radice, che da contenitore diventa un dato.

**E la preoccupazione, oggi, non ha nessuno dentro.** Subito dopo la scelta il maintainer ha
precisato il contesto, che vale ben oltre questo ramo: «ad oggi ho solo due client di prova, non
c'è nulla di rilasciato, quindi la retrocompatibilità serve solo per poter aprire i progetti e
editarli ma sui client c'è sempre l'ultimo runtime». Non esiste un parco di pannelli con runtime
vecchi, né uno SCADA di un cliente che stia leggendo il nostro server.

Quindi la differenza con la policy OPC-UA (decisione 1 dei certificati) e coi nomi di tipo storici
di Modbus (Fase 3) **non è un'incoerenza**: lì a rompersi sarebbe stata l'apertura di un progetto
esistente, qui soltanto la forma sul filo. La prima si difende, la seconda no. Una riga in
`NOVITA.yaml` ci va lo stesso, perché chi guarda il server se ne accorge.

## Perché era una domanda


La **decisione 1** del maintainer, opzione (a), dice: «insegnare al nostro `run_server` a esporre,
**dietro un flag di prova**, una struttura e un array». Il piano misurato quel flag non lo nomina
mai, e lo scettico l'ha trovato.

Non è un dettaglio redazionale. **Senza flag, ogni progetto che ha già un tag composito cambia
come appare sul server OPC-UA**: la radice passa da `Folder` a `Variable` con un `DataType`
struttura, e un client di terzi che la sfogliava come cartella vede un'altra cosa. È la stessa
famiglia di compatibilità di cui la Fase 3 si è occupata per i nomi di tipo storici di Modbus e la
decisione 1 dei certificati per la policy OPC-UA.

Quando il flag era stato deciso, esporre strutture era **impalcatura per il collaudo**. Nel
frattempo la 4c ha reso i nodi figli una funzione di prodotto, e il piano dei tag dice «strutture
vere **dopo**» — cioè prodotto, non impalcatura. Le due cose non coincidevano più, e la differenza
l'ha decisa il maintainer: prodotto, senza rete.

## Cosa si fa, in ordine

Col flag caduto, **nessun passo dipende più da una risposta**. I passi 1 e 2 sono fatti.

| | passo | dipende dal flag? |
|---|---|---|
| 1 | Il **nome del tipo** arriva al `TagDb` (`tipi_struttura`, accanto a `forme`) | no — **fatto** |
| 2 | `definizione_struttura`: da `Forma` a `StructureDefinition`, più il difetto di `color` | no |
| 3 | `tipi_pubblicati`: quali tipi si pubblicano, deciso in un posto solo | no (flag caduto) |
| 4 | Il `DataTypeTree` del server, costruito a mano |no (flag caduto) |
| 5 | Il nodo `DataType` **e il nodo di encoding** |no (flag caduto) |
| 6 | La radice diventa `Variable`, i figli `HasComponent` |no (flag caduto) |
| 7 | L'updater specchia la struttura sulla radice |no (flag caduto) |
| 8 | `run_server` collaudabile: listener e pki dai test | no |
| 9 | Il collaudo client-contro-server, con **due** tipi |no (flag caduto) |
| 10-12 | Il lato client: albero, `da_variant`, prove e documenti | no |

**Passi 1-9 fatti il 23-10-2026.** Il collaudo client-contro-server passa in 0,23 s con due tipi.
Restano i passi 10-12, il lato client: `DataTypeTree` + `DynamicTypeLoader` sulla sessione, e
`da_variant` che impara a leggere un `ExtensionObject` da un server di terzi. Finché non ci sono,
un `ExtensionObject` in arrivo resta `Bad` — che è il comportamento di oggi, non una regressione.

**Due cose trovate dal collaudo, non da una rilettura**: il `ServerBuilder` non è `Send` e una
variabile che lo tiene resta nello stato della future anche dopo essere stata consumata (va
chiuso in un blocco suo); e il lock dell'indirizzario era tenuto **attraverso un `await`**, cosa
che funzionava per coincidenza.

**Punto di fermata pulito dopo il passo 9**: il server pubblica strutture vere ed è collaudato, il
client le legge ancora come `Bad` — che è il comportamento di oggi (`valore.rs:48`). Niente a metà.

## Le insidie, quelle che il compilatore non vede

1. **Il nodo di encoding non è opzionale.** L'esempio del crate lo salta
   (`tests/integration/custom_types.rs:18`, `default_encoding_id: NodeId::null()`) e passa lo
   stesso, ma per un motivo che da noi non regge: lì client e server condividono **lo stesso**
   albero. Da noi l'id viaggia sul filo. Con **due** tipi compositi, due id nulli finiscono nella
   stessa chiave della mappa encoding→tipo (`type_tree.rs:398-403`) e il client decodifica col
   tipo sbagliato **senza nessun errore**. Il nodo si deve chiamare esattamente `Default Binary`:
   è la stringa su cui il client fa match (`client/custom_types/mod.rs:248`). Nessun builder
   della 0.18 lo crea: va composto a mano.
2. **L'ordine dei campi non è quello della mappa.** `TagValue::Struct` è una `BTreeMap`
   (alfabetica), `Forma::Struttura` è un `Vec` (ordine dichiarato), e `DynamicStructure::new_struct`
   riempie **per posizione**. Si scorre `StructTypeInfo.fields` e si cerca per nome nella mappa,
   mai il contrario: con due campi dello stesso tipo i valori si scambierebbero e la qualità
   resterebbe `Good`.
3. **`new_struct` fallisce e oggi nessuno lo sente.** L'updater è un `if let Some(v) = …`
   (`lib.rs:1510`): un `Err` fa saltare il giro in silenzio e il nodo si congela per sempre
   sull'ultimo valore buono.
4. **Un namespace sbagliato è un `panic!`, non un errore** (`server/address_space/mod.rs:219`):
   porterebbe giù il runtime all'apertura del progetto, non la singola sorgente.
5. **Due tag dello stesso tipo condividono un `DataType` solo**: la deduplica va fatta per id del
   `TypeDef`, mai per tag.
6. **`color` dichiara un tipo e ne manda un altro**: `tipo_opcua` lo manda in `_ => Double`
   mentre `variant_per_tipo` ne fa una `Variant::String`. Oggi innocuo; dentro una struttura
   `validate` lo rifiuta, e per l'insidia 3 il rifiuto non si vede.
7. **La radice cambia natura e i figli devono seguirla**: da `Folder`+`organized_by` a
   `Variable`+`component_of`. I figli devono **restare**: la decisione 2 vuole che la scrittura ci
   passi.
8. **Il filtro delle foglie è un prefisso nudo** (`id.starts_with(...)`, `lib.rs:1342`): le foglie
   di `motore10` cadono dentro `motore1`. Difetto che c'è già; costruirci sopra la scelta del tipo
   lo trasforma in due tag che condividono il `DataType` sbagliato.
9. **Un `?` sulla costruzione dell'albero spegne un client che funzionava.** `DataTypeTreeBuilder`
   non guarda gli `OperationLimits` del server: un PLC con `MaxNodesPerRead` basso fa fallire la
   build **tutta**. `values_per_read(100)` e degradare a `None` con un `warn!`.
10. **Le union si decodificano ma non si leggono**: il discriminante è privato. L'unica risposta
    onesta è `Bad`, e la decisione 6 la copre già.
11. **L'albero non si mette in cache fra sessioni**: gli id di encoding portano l'indice di
    namespace **di quella** sessione. Si rifà: 32 ms.
12. **I `ParentIds` vanno completati prima, tutti**, o l'esito dipende dall'ordine di iterazione
    di una `HashMap` — un errore che compare su alcune esecuzioni e non su altre.
13. **Gli id del tipo vanno stringa, non numero**: `type:Motore` è stabile per costruzione, un
    contatore cambia appena si aggiunge un tipo.
14. **Un test che chiama `run_server` sporca il checkout**: il default della pki è `<cwd>/pki` e
    le cartelle nascono dentro `build()`. Nel test un tempdir; **in produzione non si tocca**,
    perché spostare la pki sposta il certificato e chi l'aveva memorizzato smette di fidarsi.
15. **Nove secondi per test, regalati**: `create_sample_keypair(true)` è cablato (`lib.rs:72`) e
    con policy `None` non serve.
16. **Non «sistemare» il `Bad` a metà strada**: a ramo aperto è il comportamento di oggi, non una
    regressione introdotta.

### Le correzioni degli scettici al piano misurato

- **I membri array si possono dichiarare, ma solo a un livello.** `validate` confronta **solo** il
  `value_rank` (`type_tree.rs:62-69`), e un valore costruito da `Array::new` ha `dimensions: None`,
  cioè rank 1: un membro `Forma::Array(n, Scalare)` con `value_rank: 1` è riempibile. Un array
  **annidato** no: `variant_per_tipo` torna `None` per l'intera conversione, quindi quel tipo non
  si pubblica affatto. Il piano misurato proponeva `value_rank: 2`, che avrebbe prodotto un campo
  che niente sa riempire — e per l'insidia 3 il difetto sarebbe stato silenzioso.
- **`run_with(listener)` non basta**: il `ServerBuilder` continua a dichiarare `cfg.port` negli
  `EndpointDescription` (`server.rs:288-296`), quindi host e porta vanno impostati lo stesso.
- **I criteri dei passi 3 e 6 non coincidono**: `nodi_esposti` nomina le foglie col percorso del
  **tag**, il blocco dell'address space filtra con `effective_node_id()` — che è
  `node_id.unwrap_or(tag)`. Quando una mappatura ha un `node_id` suo, i due divergono. Va usato un
  criterio solo.

## Fuori portata, dichiarato

Strutture **annidate** e **array di strutture** alla radice: la libreria le regge, ma costano una
catena ricorsiva di `DataType`, `ParentIds` e `TypeInfo`. In questo ramo un composito di quel
genere tiene il comportamento di oggi — cartella con le foglie dentro. Nessuna regressione.

Fuori anche: le **union** in lettura (il discriminante è privato), `StructureWithSubtypedValues`
(la libreria non la regge), **scrivere una struttura intera** sulla radice (la decisione 2 dice
nodo figlio), il **nome del tipo letto da un server di terzi** (`RawTypeData.name` non viene mai
assegnato dal builder del client: è un difetto loro), il percorso di massa nell'IDE da nodo-struttura
a tipo+istanza, e lo spostamento della **pki di produzione** (va in `Appunti.txt`).

## Verifica

Oltre alla *definition of done* di sempre: il collaudo del passo 9 con **due** tipi, perché con uno
solo passa anche sbagliando il nodo di encoding. E la prova contro un server di **terzi** qui non
si può fare — `python3 -c "import asyncua"` fallisce e il template `opcua-demo` ha cinque tag tutti
scalari: va in [`COLLAUDI_IN_SOSPESO.md`](../COLLAUDI_IN_SOSPESO.md), da fare da casa.
