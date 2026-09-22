# Tag come oggetto unico, con strutture e array — piano approfondito

> Sostituisce il seme `docs/plans/2026-09-21-gestione-tag-oggetto-unico.md` (da riscrivere con questo testo dopo l'approvazione).
> Decisioni del maintainer (22-09-2026): **valori composti nativi**; strutture come **tipi riusabili + istanze**; **prima l'oggetto unico, poi strutture/array**; protocolli prioritari **Modbus e OPC-UA**.

## Contesto
I tag oggi sono stringhe libere citate in ~20 punti (10 card di sorgenti, ~30 campi degli oggetti, allarmi, ricette, script) e una tabella che non le controlla: nessuna creazione al salvataggio, nessuna rinomina, nessun avviso su id inesistenti (il valore semplicemente non arriva). Ci sono cinque meccanismi di creazione diversi («+var», `QuickCreateTagModal`, `pendingTags`, due wizard con `autoCreateTags`), sei punti duplicati che installano i tag nel `TagDb` (uno, `soft_reload_project`, incoerente) e quattro elenchi a mano dei campi-tag che divergono (`collectTagIds`, `CAMPI_TAG` in `validate.rs`, `sourceTagIds`, regex di `tagUsage.ts`). In più il modello è **solo scalare** (`TagValue` = Bool|Int|Float|Str): array e strutture dei dispositivi oggi diventano un `Float(0.0)` Incerto (OPC-UA) o si mappano un elemento alla volta a mano.
Esito voluto: un solo oggetto «riferimento a tag», creato dove serve e riconciliato al salvataggio; poi tipi struttura e array come cittadini di prima classe fino ai plugin.

## Progetto del modello composito (decisioni di progetto, da validare in Fase 1)

1. **Valore.** `TagValue` (sws-core/src/tag.rs:20) diventa `Bool | Int | Float | Str | Array(Vec<TagValue>) | Struct(BTreeMap<String,TagValue>)`, sempre `serde(untagged)`: JSON array/oggetto non collidono con gli scalari, quindi PUT/WS li accettano senza cambi di rotta. Qualità e timestamp restano **uno per radice** (foglia = qualità della radice).
2. **Tipi e istanze.** Il progetto ha una sezione `types:` (definizioni struttura: membri con `data_type`/`type_ref`/array, unità, scala, limiti, storico di default). Un `TagDef` può avere `type_ref: Motore` o `array: {length, element}`: è **un tag radice composito** (`motore1`, `valvole`). Modificare il tipo aggiorna tutte le istanze; è il legame naturale con i faceplate (`{tag_prefix}`).
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
**0b. Creazione al salvataggio.** `pendingTags` sale dallo stato locale di `ConfigView` allo store. `TagInput` mostra lo stato di ogni id (dichiarato / **verrà creato al salvataggio** / sconosciuto) e permette di definire tipo/unità/storico inline (riuso `QuickCreateTagModal`, `ConfigView:272`). Le cinque strade di creazione («+var», modal, wizard OPC-UA/MQTT) diventano una sola. In `saveAll` (`store/index.ts:2233`) una fase **«riconcilia i tag»** in serie, prima di sorgenti e pagine (stessa catena dei PUT su `project.yaml`, per non ricreare la corsa Q30): calcola i riferimenti **finali** (non quelli digitati a metà: risolve la ragione per cui la creazione automatica per tasto era sbagliata), crea gli id mancanti con tipo dedotto dalla mappatura/oggetto e `history:false`, e riepiloga «N tag creati». Lato server `PUT /api/project/tags` invariato.
**0c. Rinomina e cancellazione con propagazione.** Un walker unico sui riferimenti (pagine, faceplate, sorgenti, allarmi, ricette, trigger, espressioni e script Python) per `renameTag` con anteprima e conferma, e avviso d'uso prima di `removeTag` (`ConfigView:512`); `buildTagUsage` è il seme.
**0d. Server coerente.** Una sola funzione `apply_tags(project, db)` per i sei siti di installazione nel `TagDb` (`apply_loaded_project`, `update_project_tags`, `import_tags_csv`, import zip, `soft_reload_project`, chiusura): sistema anche l'incoerenza di `soft_reload_project` (non aggiorna scale, tipi e ruoli). `validate::semantic` (oggi solo per l'IA) chiamata nel salvataggio come **avviso**, estesa a tutte le sorgenti (oggi solo MQTT) e agli oggetti annidati.

### Fase 1 — Modello composito nel core (senza editor né plugin nuovi)
`TagValue` composito; `TypeDef`/`type_ref`/`array` in `project.rs` + validazione (`validate.rs`) + `synoptic_schema.rs`; grammatica dei percorsi e risoluzione in `TagDb` (radice, foglia, read-modify-write, scala/coercizione per foglia, `coerce_value` e `descrivi`); `WriteRequest` con percorso; i `match` esaustivi (~28 file: alarm, historian `registry.rs`/`lib.rs`/`postgres_backend.rs`, pyscript `tag_value_to_py`/`py_to_tagvalue`/`eval_expression`, `global_scripts.rs`, `notifications.rs`, `lvgl_render.rs`, `effects.rs`, `router.rs` `json_to_tag_value`/history stats) — il compilatore li elenca; WS/REST con espansione in foglie di default + flag composito. Test rossi prima per ogni consumatore; guardia che i template esistenti si carichino invariati (`template_tests`, `project.rs:1580`).

### Fase 2 — Editor: tipi, istanze, percorsi
Scheda «Tipi» (definizione strutture e array), tabella variabili ad albero espandibile, `TagInput`/`BindableInput` con completamento di percorso, istanza che alimenta `{tag_prefix}` dei faceplate, IA (`elenca_tag`/`schema_tag` conoscono percorsi e tipi; rigenerare lo schema, `check_synoptic_schema.sh`), esportazione/import CSV, aggiornamento delle guardie (`check_templates.sh`, `check_tipo_scrittura.sh`).

### Fase 3 — Modbus (priorità del maintainer)
Mappatura a radice: blocco di N registri (`read_holding_registers(addr, n)`), tipi multi-registro 16/32/64 bit con e senza segno/float/stringa, ordine di parole e byte, scrittura con `write_multiple_registers`; array e strutture come layout di registri nel tipo. **Con la fase si correggono i difetti trovati**: u16 letti senza segno (i16 negativi come grandi positivi), scala applicata due volte sull'eco di scrittura, errore di lettura che abortisce l'intera sessione.

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
- Qualità/timestamp uno per radice: una foglia guasta non è distinguibile finché una mappatura a foglia non la marca (da decidere in Fase 1 se serve una qualità per foglia).

## File critici
`sws-runtime/crates/sws-core/src/{tag.rs,project.rs,alarm.rs}` · `sws-web/src/{router.rs,validate.rs,projects.rs,synoptic_schema.rs,source_supervisor.rs}` · `sws-historian/src/{lib.rs,registry.rs,postgres_backend.rs}` · `sws-pyscript/src/lib.rs` · `sws-lvgl-viewer/src/lvgl_render.rs` · `sws-plugin-{modbus,opcua}/src/lib.rs` · `sws-editor/src/{types/index.ts,store/index.ts,tagCatalog.ts,search/tagUsage.ts,runtime-view/collectTagIds.ts,components/{TagInput,BindableInput}.tsx,config/ConfigView.tsx}` · `scripts/{gen_synoptic_schema.py,check_templates.sh,check_tipo_scrittura.sh}`.

## Verifica (per ogni fase)
`cargo check` + `cargo test` (test rossi prima per ogni consumatore del valore), `pnpm test` + `pnpm build`, `./scripts/check_static.sh` (con le guardie nuove) e le guardie con stack che toccano i tag (`check_project_write_safety`, `check_tipo_scrittura`); collaudo del maintainer: Fase 0 = creare un tag da una sorgente/oggetto e vederlo comparire al salvataggio, rinominarlo con propagazione, cancellarne uno usato; Fase 1 = progetto vecchio identico, PUT di un array su un tag di prova; Fase 3 = blocco di registri Modbus reale/simulatore; Fase 4 = array e struttura su un server OPC-UA di prova.

## Ordine dei rami
`feat/tag-0a-registro-riferimenti` → `0b-creazione-al-salvataggio` → `0c-rinomina-cancellazione` → `0d-server-coerente` → `1-modello-composito` → `2-editor-tipi` → `3-modbus` → `4-opcua`. Ognuno una sessione, un ramo alla volta, push solo su richiesta. Il Passo 2 (segreti) e il container 2.11.1 restano fuori da questa serie.
