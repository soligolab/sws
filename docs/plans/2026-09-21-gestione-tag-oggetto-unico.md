# Tag come oggetto unico, con strutture e array — piano approfondito

> Sostituisce il seme `docs/plans/2026-09-21-gestione-tag-oggetto-unico.md` (da riscrivere con questo testo dopo l'approvazione).
> Decisioni del maintainer (22-09-2026): **valori composti nativi**; strutture come **tipi riusabili + istanze**; **prima l'oggetto unico, poi strutture/array**; protocolli prioritari **Modbus e OPC-UA**.
>
> Seconda tornata (22-09-2026, revisione del piano in ufficio):
> - **D5 — tipi scalari ricchi, decisa.** La variabile è del runtime e il suo tipo dice tutto ciò che serve a qualunque protocollo: `bool`, `i8/i16/i32/i64`, `u8/u16/u32/u64`, `f32/f64`, `string` (lunghezza massima facoltativa), `datetime`, più strutture e array. Non si distingue per protocollo («la variabile è qualcosa del runtime che i protocolli usano»). L'unica cosa che **non** è un tipo è l'ordine di byte/parole con cui un dispositivo mette un `u32` sui registri: è un fatto del dispositivo e sta nella sorgente, una volta sola. Il numero di registri Modbus si **deriva** dal tipo. Sostituisce `data_type: bool|int|float|string` (che resta accettato in lettura come alias di `bool`/`i64`/`f64`/`string`).
> - **D6 — qualità e timestamp per foglia, decisa (22-09-2026, seconda revisione).** Radice = la peggiore delle foglie. Vedi §Fase 1.
> - **D7 — `datetime` = intero, millisecondi UTC dall'epoca, decisa.** Stesso formato di `timestamp_ms`; storico Postgres numerico; formattazione leggibile in Fase 2 nella fixture condivisa.
> - **D8 — array a più dimensioni ammessi in Fase 1, decisa** (`matrice[2][3]`): la grammatica dei percorsi accetta `[i][j]…`; il layout di registri si deriva in ordine row-major.
> - **D9 — la Fase 1 si spezza in quattro rami in sequenza, decisa**: 1a tipi scalari ricchi → 1b modello composito e TagDb → 1c scrittura e filo → 1d storico, allarmi, Python.
> - **Qualità per foglia — proposta, da confermare.** *(superata da D6)* Con la mappatura a foglia (`motore1.velocita` da un registro, `motore1.marcia` da un altro) una qualità solo sulla radice o nasconde il guasto o marca Bad anche ciò che è arrivato. Proposta: qualità e timestamp **per foglia**, radice = la peggiore delle foglie; sul filo le foglie viaggiano già così.
> - **Array a lunghezza dichiarata — proposta, da confermare.** OPC-UA (dimensione 0 = variabile) e MQTT (array JSON) possono rispondere con lunghezze diverse; Modbus no. Proposta: lunghezza nel tipo; elementi in più scartati; elementi mancanti al valore precedente con qualità Uncertain, avviso nel registro una volta sola. La forma in memoria non cambia a runtime.
> - **Storico sulla radice — proposta del maintainer, da formalizzare.** L'interruttore dello storico sta sulla **radice**: acceso = tutte le foglie registrate, ognuna come serie con il suo id di percorso; deadband e intervallo minimo dal tipo, per membro; il **tipo** può escludere un membro dallo storico (vale per tutte le istanze).

## Contesto
I tag oggi sono stringhe libere citate in ~20 punti (10 card di sorgenti, ~30 campi degli oggetti, allarmi, ricette, script) e una tabella che non le controlla: nessuna creazione al salvataggio, nessuna rinomina, nessun avviso su id inesistenti (il valore semplicemente non arriva). Ci sono cinque meccanismi di creazione diversi («+var», `QuickCreateTagModal`, `pendingTags`, due wizard con `autoCreateTags`), sei punti duplicati che installano i tag nel `TagDb` (uno, `soft_reload_project`, incoerente) e quattro elenchi a mano dei campi-tag che divergono (`collectTagIds`, `CAMPI_TAG` in `validate.rs`, `sourceTagIds`, regex di `tagUsage.ts`). In più il modello è **solo scalare** (`TagValue` = Bool|Int|Float|Str): array e strutture dei dispositivi oggi diventano un `Float(0.0)` Incerto (OPC-UA) o si mappano un elemento alla volta a mano.
Esito voluto: un solo oggetto «riferimento a tag», creato dove serve e riconciliato al salvataggio; poi tipi struttura e array come cittadini di prima classe fino ai plugin.

## Progetto del modello composito (decisioni di progetto, da validare in Fase 1)

1. **Valore.** `TagValue` (sws-core/src/tag.rs:20) diventa `Bool | Int | Float | Str | Array(Vec<TagValue>) | Struct(BTreeMap<String,TagValue>)`, sempre `serde(untagged)`: JSON array/oggetto non collidono con gli scalari, quindi PUT/WS li accettano senza cambi di rotta. Il **tipo dichiarato** (D5) è più fine del valore in memoria: `u16` e `i32` vivono entrambi in `Int(i64)`, `f32` in `Float(f64)`, `datetime` in `Int` (ms epoch) o `Str` ISO — da fissare in Fase 1; è il tipo, non il valore, che guida coercizione, limiti e la codifica nei plugin. Qualità e timestamp: **per foglia** se la proposta della seconda tornata è confermata (radice = la peggiore), altrimenti uno per radice.
2. **Tipi e istanze.** Il progetto ha una sezione `types:` (definizioni struttura: membri con tipo scalare ricco (D5)/`type_ref`/array, unità, scala, limiti, deadband e intervallo dello storico, esclusione dallo storico). Un `TagDef` può avere `type_ref: Motore` o `array: {length, element}`: è **un tag radice composito** (`motore1`, `valvole`). Modificare il tipo aggiorna tutte le istanze; è il legame naturale con i faceplate (`{tag_prefix}`).
3. **Percorsi.** `motore1.velocita`, `valvole[3].stato`. Risoluzione: **corrispondenza esatta dell'id prima** (compatibilità con i 350+ id dotted piatti esistenti), poi il prefisso più lungo che sia una radice composita. La validazione vieta un id piatto che collida con un percorso di una radice.
4. **Scrittura.** `WriteRequest` porta (radice, percorso, valore); il bus instrada alla mappatura più specifica registrata, altrimenti alla radice; `TagDb` fa read-modify-write della radice. Scala e coercizione sono **per foglia**, dal tipo.
5. **Sorgenti.** Una mappatura punta a una **radice** (lettura a blocco: N registri Modbus, `Variant::Array`/struttura OPC-UA) oppure a una **foglia** (il comportamento di oggi). I due modi convivono; l'espansione «un oggetto → tanti tag», che oggi vive solo nell'editor, diventa dichiarazione nel runtime.
6. **Storico.** Si registrano **foglie** con id di percorso (`motore1.velocita`): lo schema SQLite non cambia, Postgres/ODBC (colonna numerica) restano validi. Deadband/intervallo per foglia dal tipo.
7. **Allarmi, Python, script.** `AlarmDef.tag` accetta un percorso (`by_tag` risolve la radice, `evaluate` estrae la foglia). Python: array→`list`, struct→`dict`, e `tags["a.b[2]"]` legge il percorso. `TagDef.expression` idem.
8. **Filo (WS/REST) e viewer.** Per non rompere l'LVGL vecchio (i frame sono strutture tipizzate: un valore composito farebbe fallire l'intero frame) **il default sul filo è espanso in foglie scalari**; la radice composita si riceve solo con un flag esplicito nella `subscribe`/query. I widget si legano a percorsi (foglie), come già fanno; un widget tabella/array si lega alla radice col flag.
9. **Compatibilità.** I progetti attuali (soli scalari piatti) restano validi senza migrazione; i template (id dotted, es. `pv1.*`, `batteria.*` in homeassistant-pro) sono candidati a diventare istanze ma non vanno toccati in questo lavoro.

## Fasi — un ramo alla volta, ognuna chiude con DoD + collaudo + squash merge

### Fase 0 — L'oggetto unico (nessun cambio di modello)
**0a. Un solo registro dei riferimenti.** Fonte unica dei campi-tag per tipo di oggetto (`synoptic_schema.rs` `CAMPI_TAG`, già generato da `scripts/gen_synoptic_schema.py`) esposta al TS; `collectTagIds` (`runtime-view/collectTagIds.ts`), `tagUsage.ts`, `tagCatalog.ts`/`sourceTagIds` (con il ramo `metrics` dell'host che oggi manca) e `validate.rs` la leggono. Correzioni note: `motion_tag`, `pipe_flow_tag`, `symbol_spin_tag`, `gauge_sp_tag` fuori da `TAG_FIELDS`; regex di `tagUsage.ts:33` che non copre `tags.read('…')`. Guardia `check_tag_refs.sh`: ogni campo `*_tag` di `types/index.ts` e `project.rs` è nel registro. Rosso prima.
**0b. Creazione al salvataggio — e un solo Salva.** *(**Su `main`** il 22-09-2026, `6c5cc2c3`, collaudata.)* Decisioni del maintainer in corso d'opera: si creano **tutti** gli id referenziati e non dichiarati (non solo quelli messi in attesa); **nessun dialogo**, riepilogo dopo; e **un solo «Salva», quello del progetto** — le nove schede di contenuto (Variabili, Sorgenti, Allarmi, Notifiche, Storico, Script, Lingue, Faceplate, Ricette) registrano la bozza fra le sezioni pendenti e il pulsante «Salva progetto» chiama `saveAll()`; utenti/TLS/IA/dispositivi/backup/runtime restano azioni sull'istanza. Testo originale della fase: `pendingTags` sale dallo stato locale di `ConfigView` allo store. `TagInput` mostra lo stato di ogni id (dichiarato / **verrà creato al salvataggio** / sconosciuto) e permette di definire tipo/unità/storico inline (riuso `QuickCreateTagModal`, `ConfigView:272`). Le cinque strade di creazione («+var», modal, wizard OPC-UA/MQTT) diventano una sola. In `saveAll` (`store/index.ts:2233`) una fase **«riconcilia i tag»** in serie, prima di sorgenti e pagine (stessa catena dei PUT su `project.yaml`, per non ricreare la corsa Q30): calcola i riferimenti **finali** (non quelli digitati a metà: risolve la ragione per cui la creazione automatica per tasto era sbagliata), crea gli id mancanti con tipo dedotto dalla mappatura/oggetto e `history:false`, e riepiloga «N tag creati». Lato server `PUT /api/project/tags` invariato.
**0c. Rinomina e cancellazione con propagazione.** *(**Su `main`** il 22-09-2026, collaudata. Decisioni: rinomina subito dopo anteprima e conferma, a progetto salvato; il ✕ rifiuta una variabile usata.)* Un walker unico sui riferimenti (pagine, faceplate, sorgenti, allarmi, ricette, trigger, espressioni e script Python) per `renameTag` con anteprima e conferma, e avviso d'uso prima di `removeTag` (`ConfigView:512`); `buildTagUsage` è il seme.
**0d. Server coerente.** *(**Su `main`** il 22-09-2026, collaudata. **Fase 0 chiusa.**)* Una sola funzione `apply_tags(project, db)` per i sei siti di installazione nel `TagDb` (`apply_loaded_project`, `update_project_tags`, `import_tags_csv`, import zip, `soft_reload_project`, chiusura): sistema anche l'incoerenza di `soft_reload_project` (non aggiorna scale, tipi e ruoli). `validate::semantic` (oggi solo per l'IA) chiamata nel salvataggio come **avviso**, estesa a tutte le sorgenti (oggi solo MQTT) e agli oggetti annidati.

### Fase 1 — Modello composito nel core (senza editor né plugin nuovi)
**Disegno approfondito nella sezione «Fase 1 — disegno approfondito» in coda al piano (sessione di plan del 22-09-2026, tre esplorazioni del codice).** Riassunto originale:
Il catalogo dei **tipi scalari ricchi** (D5: enum `TipoScalare` in sws-core, alias dei quattro nomi vecchi, coercizione e limiti per tipo, la larghezza in registri/byte derivata dal tipo per i plugin); `TagValue` composito; `TypeDef`/`type_ref`/`array` in `project.rs` + validazione (`validate.rs`) + `synoptic_schema.rs`; grammatica dei percorsi e risoluzione in `TagDb` (radice, foglia, read-modify-write, scala/coercizione per foglia, `coerce_value` e `descrivi`); `WriteRequest` con percorso; i `match` esaustivi (~28 file: alarm, historian `registry.rs`/`lib.rs`/`postgres_backend.rs`, pyscript `tag_value_to_py`/`py_to_tagvalue`/`eval_expression`, `global_scripts.rs`, `notifications.rs`, `lvgl_render.rs`, `effects.rs`, `router.rs` `json_to_tag_value`/history stats) — il compilatore li elenca; WS/REST con espansione in foglie di default + flag composito. Test rossi prima per ogni consumatore; guardia che i template esistenti si carichino invariati (`template_tests`, `project.rs:1580`).

### Fase 2 — Editor: tipi, istanze, percorsi
Scheda «Tipi» (definizione strutture e array), tabella variabili ad albero espandibile, `TagInput`/`BindableInput` con completamento di percorso, istanza che alimenta `{tag_prefix}` dei faceplate, IA (`elenca_tag`/`schema_tag` conoscono percorsi e tipi; rigenerare lo schema, `check_synoptic_schema.sh`), esportazione/import CSV, aggiornamento delle guardie (`check_templates.sh`, `check_tipo_scrittura.sh`).

### Fase 3 — Modbus (priorità del maintainer)
Mappatura a radice: blocco di N registri (`read_holding_registers(addr, n)`) con N **derivato dal tipo** (D5: `u16` = 1 registro, `u32`/`f32` = 2, `u64`/`f64` = 4, `string(n)` = n/2, struttura = somma dei membri nell'ordine dichiarato, array = lunghezza × elemento); ordine di parole e byte come impostazione **della sorgente**, non del tipo; scrittura con `write_multiple_registers`. **Con la fase si correggono i difetti trovati**: u16 letti senza segno (i16 negativi come grandi positivi), scala applicata due volte sull'eco di scrittura, errore di lettura che abortisce l'intera sessione.

### Fase 4 — OPC-UA (priorità del maintainer)
Browse che ritorna DataType, ValueRank, ArrayDimensions (oggi non li legge, `browse_one_level`); lettura di `Variant::Array` (con `NumericRange`) e di strutture via `DataTypeTreeBuilder`/`DynamicStructure` di async-opcua 0.18; scrittura con `index_range`; il wizard crea **tipo + istanza** da un nodo struttura. Correzioni: fine del `Float(0.0)` inventato per i valori non gestiti (si mantiene l'ultimo valore con qualità Bad/Uncertain), scala applicata anche ai valori sottoscritti, tipo dell'Variant scritto in base al DataType del nodo. OPC-UA **server** (oggi tutto `Double`): esporre foglie come nodi figli, strutture vere dopo.

### Dopo (in coda, non pianificate qui)
S7 (blocchi DB con layout dichiarato, lettura a blocco), EtherNet/IP (array `Vec<T>`, UDT con template/`list_tag`, il più costoso), MQTT (indici di array nel `json_path`, `flattenJsonLeaves` con array; Sparkplug dataset/template), HomeAssistant (attributi lista/dict oggi scartati in silenzio), Host (mappatura «collezione»: un core/mount/interfaccia per membro).

## Difetti trovati, da trattare a parte
Modbus (segno, doppia scala) e OPC-UA (scala non applicata alle sottoscrizioni, `Float(0.0)` inventato) confluiscono nelle Fasi 3-4; HA scarta senza avviso attributi lista/dict; **Sparkplug B: i numeri di campo del protobuf sembrano diversi dalla specifica** (oneof usa 7-12; da verificare sul `.proto` ufficiale prima di costruirci sopra). Per ciascuno un seme o un commit `fix` separato, non dentro le fasi.

## Rischi
- `TagValue` esteso rompe in compilazione ~28 file: è voluto (il compilatore è la lista), ma la Fase 1 è la più larga; non mescolarla con altro.
- LVGL/editor vecchi contro un runtime nuovo: il default espanso in foglie lo evita; il flag composito è opt-in.
- Percorsi vs id dotted esistenti: ambiguità risolta da «esatto prima» + divieto di collisione in validazione.
- Creazione al salvataggio: rischio di creare tag da riferimenti errati → riepilogo esplicito e annullabile; i tag creati partono con `history:false`.
- Qualità/timestamp: se restano uno per radice, una foglia guasta non è distinguibile con la mappatura a foglia; la proposta «per foglia, radice = la peggiore» (seconda tornata) chiude il rischio al prezzo di un `TagDb` più largo.
- Tipi scalari ricchi (D5) e i quattro nomi vecchi: `data_type: float` deve continuare a caricare i 350+ tag esistenti come `f64` senza migrazione; la guardia sui template lo verifica.

## File critici
`sws-runtime/crates/sws-core/src/{tag.rs,project.rs,alarm.rs}` · `sws-web/src/{router.rs,validate.rs,projects.rs,synoptic_schema.rs,source_supervisor.rs}` · `sws-historian/src/{lib.rs,registry.rs,postgres_backend.rs}` · `sws-pyscript/src/lib.rs` · `sws-lvgl-viewer/src/lvgl_render.rs` · `sws-plugin-{modbus,opcua}/src/lib.rs` · `sws-editor/src/{types/index.ts,store/index.ts,tagCatalog.ts,search/tagUsage.ts,runtime-view/collectTagIds.ts,components/{TagInput,BindableInput}.tsx,config/ConfigView.tsx}` · `scripts/{gen_synoptic_schema.py,check_templates.sh,check_tipo_scrittura.sh}`.

## Verifica (per ogni fase)
`cargo check` + `cargo test` (test rossi prima per ogni consumatore del valore), `pnpm test` + `pnpm build`, `./scripts/check_static.sh` (con le guardie nuove) e le guardie con stack che toccano i tag (`check_project_write_safety`, `check_tipo_scrittura`); collaudo del maintainer: Fase 0 = creare un tag da una sorgente/oggetto e vederlo comparire al salvataggio, rinominarlo con propagazione, cancellarne uno usato; Fase 1 = progetto vecchio identico, PUT di un array su un tag di prova; Fase 3 = blocco di registri Modbus reale/simulatore; Fase 4 = array e struttura su un server OPC-UA di prova.

## Ordine dei rami
`feat/tag-0a-registro-riferimenti` → `0b-creazione-al-salvataggio` → `0c-rinomina-cancellazione` → `0d-server-coerente` → `1-modello-composito` → `2-editor-tipi` → `3-modbus` → `4-opcua`. Ognuno una sessione, un ramo alla volta, push solo su richiesta. Il Passo 2 (segreti) e il container 2.11.1 restano fuori da questa serie.

---

## Fase 1 — disegno approfondito (sessione di plan del 22-09-2026)

Misurato sul codice prima di scrivere: 25 `match` esaustivi su `TagValue` in 15 file (il compilatore li elenca) più ~12 siti con catch-all da decidere a mano;
`TagDef` e `Project` **senza** `deny_unknown_fields` (aggiungere campi non rompe i progetti vecchi né gli 11 template, guardia `template_tests`); `TagDb` con
cinque mappe parallele su id piatto; `WriteRequest = (TagId, TagValue)` e bus a lookup esatto; frame WS tipizzati che **perdono l'intero pacchetto** se una sola
voce porta un valore composito; SQLite che già serializza il valore come JSON (nessuna migrazione) e Postgres a colonna numerica (obbliga alle foglie); il
tokenizer delle espressioni dell'editor che accetta già `{valvole[3].stato}`; `apply_tags` (Fase 0d) come unico punto d'installazione nel runtime.

### 1a — Tipi scalari ricchi (D5, D7)  `feat/tag-1a-tipi-scalari`  *(sul ramo dal 22-09-2026, da collaudare; la mappa dei tipi nel TagDb tiene il nome dichiarato e lo interpreta a ogni coercizione, non `TipoScalare` — così il messaggio d'errore nomina la parola scritta nello YAML)*
- `sws-core/src/tipo.rs`: `enum TipoScalare { Bool, I8, I16, I32, I64, U8, U16, U32, U64, F32, F64, String { max_len: Option<u32> }, DateTime }`;
  `parse(&str)` con gli **alias** `bool`, `int`→`I64`, `float`→`F64`, `string`→`String{None}`, `string(32)`, `datetime`; `nome()` ritorna il nome scritto
  (gli alias sopravvivono al round-trip: `TagDef.data_type` resta una `String` nel YAML e si interpreta con `TagDef::tipo()` — **zero migrazione**);
  `valore_iniziale()` (interi → `Int(0)`, reali → `Float(0.0)`, bool → `false`, stringa → `""`, datetime → `Int(0)`); `larghezza_bit()`/`byte()` per i plugin;
  `coerce(&self, TagValue) -> Result` con **controllo di intervallo** (`u16` rifiuta 70000 e −1, `f32` finito, stringa oltre `max_len`), messaggio che nomina
  il **nome dichiarato** (la guardia `check_tipo_scrittura.sh` fa `grep bool|int|string` sui 400).
- `coerce_value`/`descrivi` (tag.rs:291-333), `initial_value` (project.rs:211), `TIPI_DATO`/`incompatibile`/`atteso_per` (validate.rs:489, 1213, 1236) passano
  da `TipoScalare`; `TagDb.data_types: HashMap<TagId, TipoScalare>`; `write_data_type` idem.
- Editor: `TagDataType` diventa l'unione dei nomi (con alias) da una **costante condivisa** `TIPI_SCALARI` in `sws-editor/src/tag/tipiScalari.ts`; le 4
  `<select>` (ConfigView 708, 777, 913; QuickCreateTagModal 79) con optgroup; `deduciTipo`: S7 `word`→`u16`, `int`→`i16`, `dint`→`i32`, `real`→`f32`, EnIP
  `sint/int/dint/lint/real`→`i8/i16/i32/i64/f32`, Host: percentuali `f32`, byte `u64`, testo `string`; MQTT wizard invariato (`bool/int/float/string`).
- **Fixture condivisa** `tests/fixtures/tipi-scalari.json`: nomi, alias, valore iniziale, casi di coercizione (accettati/rifiutati) — letta da un test Rust
  (`tipo.rs`), da un test vitest e da una guardia **nuova** `check_tipi_scalari.sh` (i nomi in Rust, nella costante TS e nelle `<option>` coincidono; idioma
  `check_tag_refs.sh`). Rigenerare `synoptic_schema.rs` (`gen_synoptic_schema.py`) perché il commento di `data_type` cambia; aggiornare la nota di
  `ai/tools.rs:349` e il suo test. `check_tipo_scrittura.sh` va **esteso** con un caso `u16` fuori intervallo → 400, non riscritto.
- Rosso prima: `riconciliaTag.test.ts` (S7 `dint` deve dare `i32`), test Rust di `tipo.rs` sulla fixture, la guardia nuova.
- Utile da solo: `u16`, `f32`, `datetime` sui tag piatti prima che esistano le strutture.

### 1b — Modello composito e TagDb  `feat/tag-1b-modello-composito`
- **`TagValue`** += `Array(Vec<TagValue>)`, `Struct(BTreeMap<String, TagValue>)`, `serde(untagged)` invariato. I 25 `match` per classe: consumatori
  numerici (`as_f64` allarmi, `numeric` storico, deadband, `fmt_value` notifiche, `is_falsy`, verità LVGL) → un composito **non è un numero** (`None`/falso);
  `tag_value_as_string`/`stringify` MQTT/HA → JSON; pyscript ↔ `list`/`dict`; plugin in scrittura → un composito verso una foglia scalare è rifiutato con
  messaggio (le radici arrivano con le Fasi 3-4); Postgres `record` → salta (si registrano le foglie, 1d). Ogni arm un test rosso prima dove il comportamento
  è una scelta.
- **`types:`** in `Project` subito dopo `tags` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`):
  ```yaml
  types:
    - id: Motore
      members:
        - { name: velocita, data_type: f32, unit: rpm, raw_min: 0, raw_max: 16384, eng_min: 0, eng_max: 3000, history_deadband: 0.5 }
        - { name: marcia, data_type: bool }
        - { name: allarmi, data_type: bool, array: [8] }
        - { name: pid, type_ref: Pid }
        - { name: nome, data_type: string(16), history: false }
  tags:
    - { id: motore1, type_ref: Motore, history: true }
    - { id: valvole, array: [4], type_ref: Valvola }
    - { id: matrice, array: [2, 3], data_type: u16 }
  ```
  `TypeDef { id, description, members: Vec<Membro> }`; `Membro { name, data_type | type_ref, array: Option<Vec<u32>> (D8, row-major), unit, decimals,
  raw_*/eng_*, range_*, limit_*, history: bool = true, history_deadband, history_min_interval_ms, write_min_role }`; `TagDef` += `type_ref: Option<String>`,
  `array: Option<Vec<u32>>`. Un `TagDef` composito **non** può avere `expression`/`generator`/scala propria (vivono nel tipo). Validazione: id dei tipi
  univoci, cicli vietati, `type_ref` esistente, `array` senza zeri, **collisione**: un id piatto uguale a un percorso di una radice (o una radice il cui id è
  prefisso puntato di un id piatto) è errore, col suggerimento «converti in istanza». Nell'IDE la Fase 2; in 1b solo YAML e API.
- **Percorsi** `sws-core/src/percorso.rs`: grammatica `id ( '.' nome | '[' n ']' )*` con `[i][j]` (D8); `Percorso::parse`, `leggi(&TagValue)`,
  `scrivi(&mut TagValue, TagValue)`; `Forma` (l'albero derivato da tipo+array) con `foglie() -> Vec<(percorso, TipoScalare, Membro)>` e valore iniziale
  composito.
- **`TagDb`**: `radici: HashMap<TagId, Forma>` costruito da `apply_tags`; `get(id)`: chiave esatta, poi il **prefisso più lungo** che sia una radice e
  navigazione; `set(percorso, v, q)` = read-modify-write della radice; **D6**: `qualita_foglie: HashMap<TagId, HashMap<Percorso, (TagQuality, u64)>>`, la
  radice riporta la peggiore e il timestamp più recente; `marca_qualita` accetta radice o foglia; scale/tipi/ruoli chiavi per **percorso** (ruolo di
  scrittura: foglia, poi radice). `espandi_foglie(&TagUpdate) -> Vec<(TagId, TagState)>` per chi vuole le foglie (WS, storico, allarmi, snapshot delle
  espressioni). `snapshot()` resta per radice; `snapshot_foglie()` nuovo.
- `apply_tags` costruisce forme, metadati per percorso, valore iniziale composito; `AlarmDb.by_tag` indicizzata sulla radice e `evaluate` estrae la foglia.
- Rosso prima: `percorso.rs` (parse/leggi/scrivi, multi-dimensione), `TagDb` (esatto prima, prefisso, read-modify-write, qualità per foglia), validazione
  (cicli, collisioni), `template_tests` invariata, `check_synoptic_schema` rigenerato.

### 1c — Scrittura e filo  `feat/tag-1c-scrittura-e-filo`
- `WriteRequest = (TagId radice, Option<Percorso>, TagValue)`; `TagWriteBus::write(id_o_percorso, v)`: percorso intero → prefissi decrescenti → radice;
  senza writer → `db.set` sul percorso. `coerce_for_write` e `scale_to_raw` sul tipo **della foglia**. I tre ingressi (REST 1734, ricette 5366 con
  `json_to_tag_value` che accetta array/oggetto, WS 5739) passano di lì. `PUT /api/tags/:id` accetta un percorso (parentesi quadre codificate: **test**
  sul router) e, su una radice, un valore composito.
- WS: `Subscribe { tags, composito: bool = false }`; snapshot e delta **espansi in foglie** di default (id = percorso, qualità della foglia, D6); con
  `composito: true` la radice intera. `GET /api/tags` espanso, `?composito=1` per le radici; `GET /api/tags/:id` accetta radice o percorso. Il client
  LVGL (`client.rs:611-660`) e l'editor (`TagState.value` scalare) restano invariati. Guardia con stack: un runtime di scarto con `types:` → `GET /api/tags`
  non contiene array/oggetti, il WS senza flag idem, con flag sì.

### 1d — Storico, allarmi, Python, espressioni  `feat/tag-1d-storico-allarmi-python`
- Recorder (`registry.rs:306`): un `TagUpdate` di radice → N campioni di foglia con id di percorso; `TagFilter` per percorso da `Membro.history_deadband`/
  `history_min_interval_ms`; **interruttore `history` sulla radice**, `Membro.history: false` esclude (proposta del maintainer, 22-09). SQLite invariato;
  Postgres riceve solo scalari.
- Allarmi: `AlarmDef.tag` percorso (già coperto da 1b); qualità della foglia (D6) nel controllo di qualità.
- Python: `tag_value_to_py` → `list`/`dict`; `py_to_tagvalue` accetta list/dict; lo snapshot delle espressioni (`main.rs:763`) è **espanso in foglie** più le
  radici come dict/list, così `tags["a.b[2]"]` e `tags["a"]["b"][2]` funzionano entrambi; i tag calcolati restano scalari in Fase 1 (dichiarato).
- Espressioni dell'editor: nessuna modifica (il lexer accetta già i percorsi); `check_f7`/fixture di formattazione invariate.

### Fuori dalla Fase 1, annotato per le successive
- Fase 2: `TagInput` ad albero e completamento del percorso, `statoTag` che riconosce un percorso su una radice (oggi direbbe «nuovo» e 0b creerebbe un
  tag piatto: **da chiudere prima di esporre i percorsi nell'IDE**), rinomina che segue la radice (`rinominaTag` è a corrispondenza esatta), scheda «Tipi»
  (tre elenchi paralleli: `AppConfigTab`, `ConfigTab`, `visibleTabs`), widget «radice + flag» (`table`, `bar_chart`, `trend`, `pie_chart`; `xy_series` a
  due percorsi), formato `datetime` nella fixture `formattazione-valori.json`.
- Fase 3 (Modbus): `RegisterMapping` ha solo `tag/address/scale`, una richiesta per registro, FC3/FC6 soli, `u16` senza segno (lib.rs:79), `raw >= 0`
  in scrittura (:130), `unwrap_or(0)` che inventa uno zero (:79), un errore su un registro chiude la sessione (:84); `word_order`/`byte_order` sulla sorgente;
  `write_multiple_registers` già in tokio-modbus 0.6.1; **zero test** oggi. La «doppia scala» del piano **non** è confermata su Modbus (le due scale sono
  knob distinti applicati una volta per verso): è confermata su OPC-UA (sotto).
- Fase 4 (OPC-UA): `browse_one_level` non legge DataType/ValueRank/ArrayDimensions; `data_value_to_tag` inventa `Float(0.0)` (lib.rs:354-360); il
  dispatcher usa `set` e non `ingest` (scala non applicata, :239); a fine sessione `ingest` su un valore già scalato (**doppia scala reale**, :95-99);
  `tag_value_to_variant` sceglie il tipo dal valore e non dal nodo; il server espone tutto `Double` e scrive nel `TagDb` bypassando il bus (:1036); il
  `CancellationToken` del client non è cablato (supervisor :356). async-opcua 0.18 ha già `DataTypeTreeBuilder`/`DynamicStructure`.

