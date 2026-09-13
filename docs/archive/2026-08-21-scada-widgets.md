# SWS → SCADA commerciale: programma di evoluzione dei widget

> Sostituisce il piano precedente (UX certificati TLS, completato e mergiato).
> Programma lungo, deciso col maintainer il 2026-08-21 con 16 domande di indirizzo.
> All'avvio dell'implementazione questo file va copiato in `docs/plans/2026-08-21-scada-widgets.md`
> e committato (regola CLAUDE.md: i piani che attraversano sessioni/macchine viaggiano con git).

## Contesto

Obiettivo: avvicinare i 32 oggetti sinottici di SWS a quello che offre uno SCADA commerciale
(Ignition, WinCC, FactoryTalk, Movicon). L'analisi (3 esplorazioni: inventario per-tipo,
infrastruttura trasversale, vincoli LVGL) ha trovato che i limiti non sono nei singoli widget ma
in 5 gap infrastrutturali che si moltiplicano tra loro:

1. **Nessun motore di espressioni/scaling nei binding** — un binding copia il valore raw 1:1.
2. **Faceplate parametrizza solo 4 campi** (`tag`,`label`,`name`,`text`) e non si apre come popup.
3. **Sicurezza ferma alla pagina** — nessun ruolo per-oggetto, nessuna conferma, nessuna re-auth.
4. **Oggetti ciechi ad allarmi/qualità/stale** — Bad stampato come valido, nessun lampeggio.
5. **Storico raw-only per un solo widget** + **BUG reale**: i tag usati solo dai binding
   (`visible_tag`, `state_tag`, `bindings[*]`, …) ricevono lo snapshot e poi si congelano —
   `RuntimeView.tsx:185-207` sottoscrive solo `o.tag` più campi legacy inesistenti.

## Decisioni di indirizzo (risposte del maintainer, 2026-08-21)

| Asse | Decisione |
|---|---|
| Espressioni | Motore completo a fasi: prima scaling dichiarativo, poi espressioni client-side |
| Parità LVGL | Web-first; ogni feature classificata banale/costosa/impossibile; lotti parità dedicati |
| Sicurezza | Fino in fondo: min_role per oggetto + conferma + re-auth/motivo per comandi critici |
| Faceplate | Massimo: sostituzione totale, parametri tipizzati, popup a click, scaling istanza, override |
| Allarmi/qualità per-oggetto | **Opt-in** per oggetto (non automatico di default) |
| Storico | Pacchetto completo: aggregazione server, backfill, widget data-log, statistiche |
| Animazioni | Tutte: lampeggio universale, flusso pipe, simboli rotanti, movimento su percorso |
| Simboli | Tutto: N-stati, libreria ISA ampliata, livello continuo, **editor di simboli** |
| Modello tag | Tag = fonte di verità per unità/decimali/range/limiti; i widget ereditano con override |
| Controlli | Tutto: modalità bottone complete, tastierino touch, slider al rilascio, feedback comando |
| Editor | Tutto: smart guides, multi-edit+copia stile, trova-usi, rotazione interattiva+layer |
| Trend | Tutto: data/ora assoluta, cursori misura, export CSV/PNG, scala log+unità assi |
| Tabelle | Table 2.0 ricostruita su `DataTable` (senza righe-da-pattern, per ora) |
| Allarmi UI | Tutto: suono, shelve+commento ACK, ACK massivo+filtri, AlarmHistory piazzabile |
| Grafici | Tutto: bar stacked/negativi, pie assoluti+«altro», XY multi-curva, widget KPI tile |
| Ordine | **Fondamenta prima**: bugfix → infrastruttura → template → storico → widget → editor |

## Modello di lavoro

- **Branch annidati con un solo capo testabile**: `feat/scada-f0` → `feat/scada-f1` → … ;
  il maintainer sta sempre sull'ultimo. A ogni sua conferma: squash-merge della fase su main
  (mantenendo la catena rebasata) — stesso rito delle fasi A/B.
- Ogni campo nuovo di `SynopticObject` va **specchiato in 3 posti**: `sws-editor/src/types/index.ts`,
  `sws-runtime/crates/sws-web/src/synoptic.rs` (altrimenti si perde nel round-trip YAML),
  `sws-lvgl-viewer/src/model.rs` (altrimenti LVGL lo scarta in silenzio).
- Ogni fase chiude con: `cargo check` + `pnpm build` verdi, verifica visiva Playwright su
  runtime di test (porte scratch, sempre terminato), riga in CHANGELOG, scheda in STATUS.md.
- Parità LVGL: ogni task porta l'etichetta **[L-ban]** (banale: campo scalare→widget nativo),
  **[L-cost]** (canvas/testo libero/anim/endpoint nuovo), **[L-web]** (impossibile: SVG, raster,
  hover, audio → dichiarato web-only). I lotti L (fase F9) portano le banali + selezione costose.

---

## FASE F0 — Bugfix e debiti (breve, il fondamento del fondamento)

**F0.1 — Fix sottoscrizione tag congelati (BUG).** Nuova funzione unica `collectTagIds(obj)`
che raccoglie TUTTI i campi tag-bearing: `tag`, `bindings[*]` (valori), `visible_tag`,
`state_tag`, `alarm_tag`, `fill_level_tag`, `pipe_label_tag`, `y_tag`, `extra_tags[]`,
`table_rows[].tag`, `bar_series[].tag`, `pie_slices[].tag`, `pie_center_tag`, celle grid
(ricorsivo), figli faceplate (post-sostituzione). Sostituisce la raccolta rotta in
`RuntimeView.tsx:185-202` (che cerca campi legacy inesistenti). È anche il gancio su cui
F2 (espressioni) registrerà le proprie dipendenze.

**F0.2 — Config morta sanata** (l'utente configura, il rendering ignora):
`bg_color` ignorato su rect/button/navbutton/lang_button; `show_value` del gauge mai letto;
`orientation` della progress_bar (implementare la verticale); `stroke_dasharray` della line;
`bar_y_label` (implementarlo o rimuoverlo dal pannello); `read_only` mancante su radio;
colori label hardcoded su navbutton e pipe (esporli); «Attuale:» del setpoint non tradotto.

---

## FASE F1 — Tag come fonte di verità

**F1.1 — Estensione `TagDef`** (TS + Rust `sws-core/src/project.rs` + editor tag):
`unit`, `decimals`, scaling raw→eng (`raw_min/raw_max/eng_min/eng_max`, offset), range
ingegneristico (`eng_lo/eng_hi` per default dei widget), limiti `lo_lo/lo/hi/hi_hi`.
Migrazione dolce: tutti opzionali, i progetti esistenti non cambiano. **[L-ban]**

**F1.2 — Ereditarietà nei widget**: unit/min/max/soglie/decimali di gauge, progress_bar, text,
slider, setpoint, trend, bar diventano «dal tag» di default con override per-oggetto
(UI: valore ereditato mostrato in grigio, override esplicito). Le soglie visive smettono di
divergere dagli `AlarmDef`. **[L-ban]**

**F1.3 — Formattazione numerica strutturata**: `formatValue` esteso (decimali, separatore
migliaia locale-aware, notazione ingegneristica, percentuale, formato data/ora); campi
`format` con builder UI invece della stringa `{value:.1f}`. Localizzazione dei campi oggi
esclusi (formati con suffissi, `bar_series[].label`, `pie_slices[].label`) e dei
**messaggi di allarme** (`AlarmDef.message` via `resolveMsg` — il testo più letto
dall'operatore) e dei nomi pagina. **[L-cost]** (formatter da replicare in Rust)

---

## FASE F2 — Binding 2.0: scaling + espressioni

**F2.1 — Scaling dichiarativo per-binding**: il binding smette d'essere una stringa e diventa
`{ tag, in_min?, in_max?, out_min?, out_max?, clamp? }` (retro-compatibile: la stringa nuda
resta valida). Risolto in `resolveObject` (`SvgCanvas.tsx:382`). **[L-cost]**

**F2.2 — Motore di espressioni client-side**: parser/evaluator scritto in casa (nessun `eval`,
nessuna dipendenza pesante): riferimenti `{tag.id}`, aritmetica, confronti, logica, ternario,
funzioni (`min,max,abs,round,clamp,if`). Le dipendenze estratte dal parse alimentano
`collectTagIds` (F0.1). Valutazione memoizzata per non rifare il parse a ogni render.

**F2.3 — UI binding a tre modalità**: tag diretto / scala / espressione, con validazione live
(tag inesistenti segnalati, errore di sintassi inline) e anteprima del valore corrente.
Audit binding esistente (`EditorShell.tsx:3797`) esteso alle espressioni.

**Parità LVGL**: serve un mini-evaluator Rust equivalente (subset identico, condiviso via test
fixture comuni) — lotto **[L-cost]** dedicato in F9; fino ad allora i binding-espressione sono
dichiarati web-only nel badge dell'editor.

---

## FASE F3 — Sicurezza operativa e pipeline di comando

**F3.1 — `min_role` per-oggetto** con tre effetti: `hidden` / `disabled` (visibile, non
operabile, stile attenuato) / `operable`. Enforcement client + **enforcement server vero**:
`TagDef.write_min_role` (la whitelist per-tag è ciò che il server può davvero garantire;
il min_role dell'oggetto è UX, quello del tag è sicurezza). **[L-cost]** (il viewer LVGL ha
il concetto di ruolo? verificare — probabilmente gira anonimo: allora enforcement solo server)

**F3.2 — Conferma configurabile**: `require_confirm` + `confirm_message` (localizzabile) su
qualunque oggetto scrivente; dialog con valore che sta per essere scritto. **[L-cost]**

**F3.3 — Re-auth e motivo per comandi critici**: livello `critical` per-oggetto → il comando
chiede password (endpoint di re-verifica) e, opzionale, motivo obbligatorio; tutto nel
journal audit (`sws-audit` è già hash-chained). **[L-web]** per ora (tastiera+form su LVGL
in un secondo momento)

**F3.4 — Tastierino numerico touch** per setpoint/slider: keypad virtuale in overlay con
validazione min/max esplicita e messaggio d'errore (oggi `<input type=number>` non digitabile
da pannello). LVGL ha già `lv_keyboard` per il setpoint — allineare i comportamenti. **[L-ban]**

**F3.5 — Modalità bottone complete**: `momentary` (on alla pressione/off al rilascio),
`toggle`, `set`/`reset`, `increment`/`decrement` con step e limiti. Oggi esiste solo
«scrivi costante». **[L-ban]**

**F3.6 — Slider disciplinato**: modalità «scrivi al rilascio» (default nuovo), deadband e
throttle configurabili — oggi scrive a ogni pixel (tempesta di scritture verso PLC). **[L-ban]**

**F3.7 — Feedback comando**: stato visivo pending/ok/errore sul controllo; la write API è già
sincrona, va solo esposto l'esito (oggi fire-and-forget). Toast di errore col motivo. **[L-cost]**

---

## FASE F4 — Allarmi e qualità per-oggetto (opt-in)

**F4.1 — Lampeggio universale**: campo `blink` per-oggetto (off / fisso / legato a tag /
legato ad allarme attivo del proprio tag), `blink_rate`. Implementato una volta sola in
`applyTransform`/wrapper (`SvgCanvas.tsx:407`). **[L-cost]** (lv_anim, oggi mai usato)

**F4.2 — Consapevolezza allarme (opt-in)**: `show_alarm_state: true` → l'oggetto consulta
l'indice tag→allarme-attivo (dallo store, già alimentato da `/ws/alarms`) e mostra bordo
colorato per severità + lampeggio se unacked. Nessun tag booleano ausiliario da creare a mano.

**F4.3 — Qualità estesa**: QDot disponibile su tutti i tipi (oggi 8/33); opt-in
`bad_value_style` (barrato/grigio/ultimo-valore-valido) così Bad non viene più stampato come
valido; **stale detection**: `stale_after_s` (per-oggetto o ereditato dal tag) confronta
`timestamp_ms` con l'orologio → stile «dato vecchio». **[L-ban]** per QDot/stile, già
parzialmente presente su LVGL (lettera qualità)

---

## FASE F5 — Storico 2.0

**F5.1 — Aggregazione server-side**: `GET /api/history/:tag` guadagna `bucket_ms` +
`agg=min|max|avg|first|last|minmax` (envelope); decimazione automatica quando
`campioni > 2×pixel`. Oggi `limit` tronca la coda (`router.rs:1133`) — sostituire. È il
prerequisito di tutto il resto della fase. **[L-ban]** lato LVGL (già polla `/api/history`)

**F5.2 — Trend su aggregati**: finestre lunghe usano bucket + banda min/max; con lo zoom si
scende al raw. Selettore **data/ora assoluto** (calendario), **cursori di misura** (1-2 cursori
con letture per traccia e delta t/valore), **export CSV/PNG** della finestra visibile,
**scala logaritmica** opzionale, **unità sugli assi** ereditata dal tag (F1). **[L-cost]**
(su LVGL restano i gap strutturali asse-X/i16 — dichiarare il subset)

**F5.3 — Backfill sparkline e XY**: entrambe ripartono dallo storico all'apertura pagina
(oggi buffer RAM da zero). XY: **multi-coppia** X/Y, curva di riferimento/target, assi con
etichette, campionamento configurabile. **[L-ban]** sparkline / **[L-cost]** XY

**F5.4 — Widget nuovo `data_log`**: tabella storica paginata (server-side) con colonne
tag/valore/qualità/timestamp, filtri intervallo, export CSV (endpoint già esistente). **[L-cost]**

**F5.5 — Widget nuovo `kpi_tile`**: valore grande + micro-trend + confronto vs periodo
precedente (via `/api/history/:tag/stats` su due range) + colore soglia. **[L-ban]**

---

## FASE F6 — Faceplate 2.0 e simboli

**F6.1 — Sostituzione totale**: walker generico su tutte le proprietà stringa di
`SynopticObject` incluse le annidate (`bindings[*]`, `state_tag`, `alarm_tag`, soglie, colori,
`table_rows[].tag`, `on_press_args`, …) e ricorsione nei faceplate annidati. Sostituisce le
4 righe hardcoded (`SvgCanvas.tsx:2079-2082`).

**F6.2 — Parametri tipizzati**: `params: {name, type: tag|string|number|color, default?,
required?}`; validazione all'istanza (parametri mancanti segnalati in editor), UI con
TagInput per i parametri di tipo tag.

**F6.3 — Faceplate come popup**: nuova azione universale `open_faceplate {id, params}` su
qualunque oggetto → modale runtime col faceplate parametrizzato (il gesto «click sulla
pompa → finestra della pompa»). Chiusura, posizionamento, un solo popup per volta.

**F6.4 — Scaling e override**: i figli scalano al box dell'istanza (viewBox virtuale dal
bounding box della def); override per-istanza di singole proprietà di un figlio
(`overrides: {childName.prop: value}`), con indicatore visivo «link spezzato».

**F6.5 — Trova usi**: conteggio istanze per def, lista pagine che la usano, avviso alla
modifica/rinomina di un parametro.

**Parità LVGL faceplate**: la sostituzione avviene lato client web; su LVGL il faceplate è
già renderizzato — la sostituzione estesa è **[L-cost]** (walker Rust equivalente), il popup
**[L-cost]** (overlay già usato per keyboard).

**F6.6 — Simboli N-stati**: mappatura valore→stato come `text_list_entries` (valore esatto o
range) con colore + lampeggio + label per stato; sostituisce il limite dei 3 stati truthy.
**[L-cost]** (i 16 builtin LVGL sono ridisegnati a mano)

**F6.7 — Livello continuo**: `level_tag` sul tank (e simboli «a livello» futuri) — riempimento
proporzionale, non più 70%/20% hardcoded. **[L-ban]** (barra dentro canvas)

**F6.8 — Libreria ISA/P&ID ampliata**: nuovo set di simboli builtin colorabili per stato
(valvole motorizzate/pneumatiche, scambiatori, sensori, attuatori, strumentazione ISA-5.1) —
lista esatta da concordare col maintainer su catalogo proposto (~30-50). **[L-cost]** (ogni
builtin va ridisegnato su lv_canvas — porting selettivo)

**F6.9 — Editor di simboli nell'IDE**: import SVG con mappatura elementi→ruoli
(corpo/parte-colorabile/indicatore) e stati; salvataggio come `CustomSymbol 2.0` multi-stato
di progetto (niente ricompilazione). **[L-web]** (i custom restano web-only: LVGL non ha SVG)

**F6.10 — Animazioni**: simboli rotanti (ventola/pompa/agitatore quando on, velocità
opzionale da tag) **[L-cost]**; flusso animato pipe (dash marching, direzione/velocità da tag)
**[L-cost]**; movimento su percorso (oggetto che trasla lungo una polilinea in funzione del
valore — carrelli, ascensori) **[L-cost]**. Tutte rispettano `prefers-reduced-motion`.

---

## FASE F7 — Widget restanti

**F7.1 — Table 2.0** su `components/DataTable.tsx` (già usato da alarm_viewer table-mode):
colonne configurabili, ordinamento, filtri, scroll, font-size, colori soglia per riga,
celle scrivibili opzionali (con la pipeline comandi di F3). **[L-cost]**

**F7.2 — Bar chart**: stacked/grouped, valori negativi (oggi clamp a 0), etichette e tick
d'asse, legenda, soglie anche in orizzontale. **[L-cost]**

**F7.3 — Pie chart**: etichette valore+unità oltre alla %, raggruppamento «altro», explode
fetta, colore foro donut configurabile. **[L-ban/L-cost]**

**F7.4 — Text**: multiriga/wrap con width/height reali, allineamento verticale,
formattazione F1.3. **[L-cost]** (LVGL label ha wrap nativo → forse banale, verificare)

**F7.5 — Allarmi UI**: suono configurabile per severità con tacita/silenzia **[L-web]**;
shelve dall'alarm_viewer + commento/motivo su ACK (nel journal) **[L-cost]**; ACK massivo +
filtri per zona/area/tag **[L-cost]**; `AlarmHistory` come oggetto piazzabile **[L-cost]**.

**F7.6 — Rifiniture sparse** (dal debito d'inventario): rect con raggio angoli/gradiente/dash;
gauge con zone colorate, tacche numerate, apertura arco configurabile, secondo indicatore
(setpoint); led con lampeggio e forme; image con W/H nel pannello, placeholder se src vuoto,
`preserveAspectRatio`; grid con gap/padding e bordi per-cella; navbutton con colori esposti.

---

## FASE F8 — Ergonomia editor (solo web, nessuna parità)

**F8.1 — Smart guides**: allineamento dinamico a bordi/centri degli altri oggetti durante il
drag; match-size (uguaglia larghezza/altezza); distribute con gap uguali (l'attuale
`store/index.ts:1412` distribuisce le posizioni, non i gap).

**F8.2 — Multi-edit + copia stile**: pannello proprietà su selezione multipla (proprietà
comuni editabili in blocco); format painter (copia stile → applica a N oggetti).

**F8.3 — Trova usi / ricerca**: ricerca oggetti per nome/tipo/tag; «dove è usato questo tag»
cross-pagina (oggetti + allarmi + script); pannello risultati navigabile.

**F8.4 — Rotazione interattiva + layer**: maniglia di rotazione sul canvas (e resize
funzionante su oggetti ruotati); layer nominati con show/lock di insieme (sopra i gruppi
attuali, che restano organizzativi).

---

## FASE F9 — Lotti parità LVGL (ricorrenti)

Dopo F2, F4/F5 e F6/F7: un lotto ciascuno che porta su LVGL le feature **[L-ban]** accumulate
+ una selezione concordata delle **[L-cost]** (priorità: campi Fase A già mancanti —
`bg_color`/`axis_color`/soglie/marker trend — poi mini-evaluator binding, blink, popup
faceplate). Ogni lotto aggiorna `model.rs`, `lvgl_render.rs`, `LVGL_SUPPORTED_TYPES` e il
badge «L» dell'editor (`LeftPanel.tsx:561` — oggi disallineabile in silenzio: aggiungere un
check di coerenza generato). Le **[L-web]** (SVG, raster, hover, audio, editor simboli)
restano dichiarate web-only nella doc.

---

## Ordine, branch e stima di massima

```
F0 (bugfix)          ~1 sessione     feat/scada-f0
F1 (tag verità)      ~1-2 sessioni   feat/scada-f1
F2 (binding 2.0)     ~2-3 sessioni   feat/scada-f2
F3 (sicurezza)       ~2-3 sessioni   feat/scada-f3
F4 (allarmi/qualità) ~1-2 sessioni   feat/scada-f4
F9a (parità LVGL 1)  ~1-2 sessioni   feat/scada-f9a
F5 (storico 2.0)     ~2-3 sessioni   feat/scada-f5
F6 (faceplate+simboli) ~3-4 sessioni feat/scada-f6   (F6.9 editor simboli: +2)
F9b (parità LVGL 2)  ~1-2 sessioni   feat/scada-f9b
F7 (widget restanti) ~3-4 sessioni   feat/scada-f7
F8 (editor)          ~2 sessioni     feat/scada-f8
F9c (parità LVGL 3)  ~1-2 sessioni   feat/scada-f9c
```

Ogni fase = un branch annidato sul precedente; il maintainer testa sempre il capo della
catena; a conferma → squash-merge su main e la catena si rebasa. Le fasi sono pensate per
chiudersi a punti puliti (sessioni sparse da 3-4h).

## File critici ricorrenti

- `sws-editor/src/types/index.ts` (schema oggetti/tag) — ogni fase
- `sws-editor/src/canvas/SvgCanvas.tsx` (`resolveObject:382`, wrapper eventi `:1234`,
  `applyTransform:407`, `bgLayer:2300`) — F0/F2/F3/F4/F6
- `sws-editor/src/editor/EditorShell.tsx` (pannello proprietà) — tutte
- `sws-editor/src/runtime-view/RuntimeView.tsx:185-207` (sottoscrizione, F0.1)
- `sws-runtime/crates/sws-core/src/project.rs` (TagDef, F1) + `sws-web/src/synoptic.rs`
  (mirror campi) + `sws-web/src/router.rs:1120` (history API, F5)
- `sws-lvgl-viewer/src/model.rs` + `lvgl_render.rs` (F9)
- `sws-editor/src/components/DataTable.tsx` (F7.1), `symbols/library.tsx` (F6)

## Verifica (per ogni fase)

1. `cargo check --workspace` + `pnpm type-check && pnpm build` verdi.
2. Round-trip di persistenza dei campi nuovi (PUT synoptic → GET → presenti) — il test che
   conta per il mirror Rust.
3. Verifica visiva Playwright su runtime di test (porte scratch, dichiarato e terminato).
4. Test del maintainer sul capo della catena → squash-merge.
5. STATUS.md + CHANGELOG a ogni chiusura di fase; le decisioni architettoniche emerse →
   `docs/OPEN_QUESTIONS.md` (mai risolte in autonomia).
