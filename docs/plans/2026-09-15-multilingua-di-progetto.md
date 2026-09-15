# Multilingua di progetto: dalla tabella che c'è al multilingua che serve

## Contesto

Richiesta del maintainer (15-09-2026), prima della revisione dei template perché «poi toccherà
tutti i template». In sostanza: quando il progettista digita una stringa, questa deve diventare da
sola una voce della tabella lingue; se il testo esiste già va proposto il riutilizzo; da lì
traduzione automatica nelle altre colonne, e una bandiera per identificare la lingua. Il tutto
deve coprire **anche allarmi, messaggi Telegram e stringhe prodotte dagli script**.

Vincolo dichiarato dal maintainer: **non esistono progetti in produzione**, i template si
sistemano subito dopo. Quindi si sceglie il modello giusto, non quello compatibile.

### La premessa va corretta: la tabella esiste già, ed è coperta a metà

`LanguageTable` è in `sws-core/src/project.rs:1218` (campo `Project.languages`, dentro
`project.yaml`, quindi viaggia già con export/deploy/backup). `{{token}}` si risolve in
`projectI18n.ts:44` (web) e `lvgl_render.rs:8113` (LVGL). La scheda Lingue esiste
(`ConfigView.tsx:10484`) con CSV import/export. Esistono i tipi `lang_selector` e `lang_button`,
resi su entrambi i motori. Tutto da T-40.

**Il vero lavoro non è costruire: è chiudere i buchi.** Misurati sul codice:

| Buco | Evidenza |
|---|---|
| Il web **non** localizza i figli di `grid` e di `faceplate`; LVGL **sì** | `RuntimeView.tsx:216` localizza solo l'array di primo livello; LVGL ha un imbuto unico a `lvgl_render.rs:8419` |
| Il web risolve 11 campi + 5 array annidati, LVGL **6** | `projectI18n.ts:53-60` contro `lvgl_render.rs:8153-8158` |
| Dieci campi di testo visibile non sono coperti **da nessuno dei due** | `table_label_header`, `table_rows[].unit`/`.format`, `xy_x_label`, `xy_y_label`, `xy_series[].label`, `trend_tags[].label`, `pie_group_label`, `symbol_states[].label`, `faceplate_overrides.*` |
| Gli allarmi sono tradotti sul web e **grezzi su LVGL** | `lvgl_render.rs:10118`, `:10182`, `:10485` passano `a.def.message` a `lv_label_set_text` |
| Lo **storico** allarmi è grezzo su entrambi | `AlarmHistory.tsx:93`, `TrendCanvas.tsx:1087`, `lvgl_render.rs:5790` |
| Telegram ed email mandano il token grezzo, dentro un template **cablato in italiano** | `notifications.rs:123-133` («Allarme:», «Messaggio:», «Severità:»), `:204`, `:208`, `:272` |
| `TagDef.unit` non si risolverebbe mai | `applyTagDefaults` gira a `SvgCanvas.tsx:3174`, **dopo** `localizeObjects` |
| Le intestazioni dei widget sono **italiano cablato nel viewer operatore** | `"Messaggio"`, `"Attivato"`, `"ID"`, `"DATI"`, `"N/D"`, `"altro"` (`SvgCanvas.tsx:2924-2951`, `:4707`, `:4958`, `:5274`); su LVGL `"Ora"`, `"Allarme"`, `"Conf."`, `"sì"`/`"no"` (`lvgl_render.rs:5782-5796`) |
| **Zero test** su `resolveMsg`/`resolve_msg`, **zero guardie** di parità | nessun `check_i18n*.sh`; `check_lvgl_parity.sh` dichiara da sé che «un campo dichiarato non significa disegnato» |
| Il manuale dichiara il falso | `docs/manual/15_multilingua.md` §4 dice che i template sono conformi IT/EN; `sparkplug-demo`, `enip-demo` e `t69-collaudo` hanno `entries: []`, e gli allarmi di `casa-locale` sono testo letterale |

### Quattro decisioni prese dal maintainer, 15-09-2026

1. **La chiave è un id opaco** (`t0001`), e il testo digitato diventa il valore nella lingua
   principale. La tabella si legge dalla colonna, non dalla chiave. Cambiare il testo non fa
   mentire la chiave — che è il difetto degli slug: oggi `casa-locale` ha davvero una chiave
   `aggiornare_shelly_id_in_project_yaml_con`.
2. **Traduzione automatica dietro un'astrazione**, con due realizzazioni: il fornitore IA già in
   piedi (Anthropic/Kimi) e Google Translate.
3. **Le bandiere si fanno leggendo `bg_image` anche su LVGL.** Il campo è già dichiarato in
   `model.rs:488` e non viene mai letto: è una divergenza web/LVGL che esiste comunque.
4. **Lo storico allarmi tiene sia il token sia il testo risolto** al momento dello scatto.

### Cosa NON si può fare, e va detto prima

Il viewer LVGL carica DejaVu Sans (`lvgl_font.rs:37-42`): latino esteso, **greco e cirillico
funzionano già oggi a costo zero**. Il **cinese non si disegna affatto** — LVGL senza glifo non
mostra nemmeno un quadratino, solo un avviso a ogni ridisegno (Q24). Arabo ed ebraico sono
esclusi due volte in `lv_conf.h:464,475` (`LV_USE_BIDI 0`, `LV_USE_ARABIC_PERSIAN_CHARS 0`).
Il piano copre le lingue che il pannello sa disegnare; le altre vanno rifiutate **nell'editor**,
con un messaggio, invece di produrre un pannello vuoto in campo.

---

## Fase 0 — la rete, prima di allargare

Ogni fase successiva allarga la copertura, e oggi **non esiste un solo test** su questo
meccanismo. Prima la rete, o le fasi dopo sono verdi senza significare niente.

- **Test puri sul risolutore**, TS e Rust, sulla stessa tabella di casi: token semplice, testo
  misto (`"{{a}}: {{b}}"`), spazi interni, chiave assente, entry senza valore nella lingua
  richiesta (ripiego su `default`), stringa senza token.
- **`scripts/check_i18n_parita.sh`**: l'insieme dei campi localizzati dal web
  (`projectI18n.ts`) e quello di LVGL (`lvgl_render.rs`) devono **coincidere**. Le eccezioni
  volute si dichiarano in una lista nel file della guardia — che alla fine della Fase 1 deve
  essere **vuota**. È la guardia che oggi manca e che avrebbe intercettato tutta la tabella qui
  sopra.
- **Guardia di catena** sui due motori veri (stile `check_primo_utente.sh`): una pagina con token
  in un oggetto di primo livello, in una cella di `grid` e dentro un `faceplate`; entrambi i
  motori devono mostrare il testo tradotto. **Va provata rossa adesso**: sul web i due casi
  annidati falliscono già.

## Fase 1 — un solo imbuto, e la copertura che manca

- **Il web adotta la forma di LVGL**: la localizzazione si sposta nel punto in cui passano
  *tutti* gli oggetti (il componente `SvgObject`), invece di stare su `RuntimeView.tsx:216`. È la
  correzione dei figli di `grid` e `faceplate`, e toglie la possibilità che il buco si riapra.
- **LVGL prende i campi mancanti**: `pipe_label`, `bar_y_label`, `pie_center_text`,
  `options[].label`, `bar_series[].label`, `pie_slices[].label`, `format` e derivati,
  `confirm_message` (già dichiarato in `model.rs:494` e mai localizzato).
- **I dieci campi mai coperti** entrano nell'elenco condiviso.
- **`TagDef.unit`**: `applyTagDefaults` deve girare **prima** della localizzazione, o l'unità
  ereditata dal tag non si tradurrà mai.
- **Nome pagina su LVGL** (oggi solo web) e nel titolo finestra.
- L'elenco dei campi diventa **un dato solo**, non due elenchi da tenere d'accordo a mano:
  generato per il Rust dallo stesso posto da cui nasce `synoptic_schema.rs`, che questo repo già
  genera.

## Fase 2 — allarmi e notifiche, che è dove il multilingua serve davvero

Un sinottico tradotto a metà è brutto; un **allarme** non tradotto è un problema di esercizio.

- **Viewer LVGL**: `resolve_msg` su `def.message` nei tre punti (`:10118`, `:10182`, `:10485`).
- **Storico**: `AlarmEvent` prende il campo in più deciso dal maintainer — token **e** testo
  risolto allo scatto (`alarm.rs:271`, schema SQLite in `sws-historian/src/sqlite.rs:296`). Alla
  lettura si traduce se la chiave esiste ancora, altrimenti si mostra il testo d'epoca. Vale per
  `AlarmHistory.tsx:93`, il marker sul trend (`TrendCanvas.tsx:1087`) e LVGL (`:5790`).
- **Telegram ed email** (`notifications.rs`): qui c'è una **domanda che il codice non pone
  ancora** — una notifica non ha uno schermo, quindi non ha «la lingua corrente». Serve una
  **lingua delle notifiche**, configurata nel progetto, distinta da quella del viewer; e per la
  scala, potenzialmente una per destinatario. Il piano prevede il campo unico di progetto e
  **registra in `OPEN_QUESTIONS` la variante per-destinatario**, che è una decisione di prodotto.
- Il **template del messaggio** smette di essere italiano cablato: le sue etichette diventano
  voci di una tabella di sistema (non di progetto — un progetto non deve poter rompere il
  formato di una notifica), con `severity` e `true`/`false` inclusi.

## Fase 3 — la chiave che nasce da sola

Il cuore della richiesta. Oggi il pannello proprietà lavora sugli oggetti **grezzi**
(`EditorShell.tsx:310-317` localizza solo l'anteprima), quindi l'autore vede e scrive `{{t0001}}`.
Deve vedere e scrivere **il testo**.

- Un modulo puro e provato — sulla forma di `percorsoMovimento.ts` e `targetProgetto.ts` — che
  decide, dato il testo digitato e la tabella: riusa una chiave esistente, ne crea una nuova, o
  non tokenizza affatto. Le regole, tutte fissate dai test:
  - **si tokenizza** il testo visibile all'operatore;
  - **non si tokenizza** una stringa vuota, un numero puro, o un campo che è un identificatore;
  - un campo `format` contiene segnaposto (`{value:.1f}`): si tokenizza **la parte di testo**, e
    il segnaposto resta fuori — è il punto 3 di Q43, ed è la cosa che rompe un pannello se
    sbagliata;
  - serve una **via di fuga** dichiarata per il testo che non deve essere tradotto (sigle,
    codici macchina, nomi di reparto).
- **Riutilizzo**: quando il testo digitato coincide con un valore già presente **nella colonna
  principale**, si propone la chiave esistente. Proporre e non imporre, perché due «Avvio»
  identici in italiano possono divergere in tedesco: la scelta va offerta con il contesto (dove
  è già usata quella chiave), e ricordata per quella sessione.
- Il pannello proprietà mostra il testo nella lingua principale e scrive nella tabella; la
  colonna con la lingua di anteprima resta quella che è (`editorPreviewLang` esiste già).
- Chiavi orfane: la scheda Lingue deve saperle mostrare, perché da qui in poi se ne generano
  a ogni digitazione.

## Fase 4 — traduzione automatica

- Un tratto `Traduttore` con due realizzazioni. La prima è **quella che esiste già**: `ai/client.rs`
  ha `enum Fornitore`, la chiave **fuori dal progetto** (`ai/client.rs:168-170`: «Mai nel progetto:
  il progetto si esporta, si manda in giro e finisce su un dispositivo»), permessi 0600, e gli
  endpoint gatekeeperati «solo IDE» (`router.rs:507-512`). Q43 immaginava di costruire questo:
  è già in piedi. La seconda è Google Translate, che aggiunge una chiave e un client.
- **Mai a runtime.** L'operazione è di progettazione; il dispositivo è spesso senza Internet
  (punto 5 di Q43). L'endpoint vive solo su istanze IDE, come `/api/ai/config`. In più il viewer
  LVGL ha Q55 aperta — una POST via `spawn` che riceve 200 si blocca per sempre — che è un
  secondo motivo indipendente perché quel codice non stia lì.
- **Cosa non si traduce**: segnaposto di formato, sigle, codici. Stessa funzione pura della Fase 3.
- **Una traduzione corretta a mano non si sovrascrive**: serve un segno per riga/lingua, o la
  passata successiva cancella il lavoro umano (punto 4 di Q43).
- **Riletura umana**: si traduce in blocco nell'IDE e si rilegge lì, prima del deploy. Il
  passaggio umano sta nell'IDE, che è la risposta al punto 2 di Q43.
- Le lingue offerte sono quelle che il pannello sa disegnare; le altre si rifiutano **spiegando**.

## Fase 5 — scegliere la lingua, e vederla

- **`bg_image` su LVGL** per `lang_button` (decisione 3). Chiude la divergenza e dà le bandiere.
- **La lingua scelta non sopravvive al riavvio del viewer**: `SharedLang` riparte dal `default`
  (`main.rs:317`). Sul web c'è `localStorage`; sul pannello non c'è niente. Va persistita.
- `SharedLang` è **di processo, non di sessione** — corretto per un pannello, sbagliato per più
  operatori sullo stesso runtime. Il piano lo lascia com'è e lo **dichiara**.
- Le intestazioni cablate (`"Messaggio"`, `"Ora"`, `"Conf."`, `"sì"`/`"no"`, `"DATI"`, `"N/D"`,
  `"altro"`) non sono né contenuto di progetto né i18n dell'editor: sono una **terza categoria**,
  testo di sistema del viewer operatore. Il web può usare l'i18n che già ha; **LVGL non ha
  nessun asse i18n**, e va aggiunto — piccolo, chiuso, non di progetto.

## Fase 6 — script Python

- Uno script che vuole parlare all'operatore deve poter usare la tabella: si espone `tr("chiave")`
  accanto a `tags`/`send_telegram` (`sws-pyscript/src/lib.rs:154-186`). La tabella arriva allo
  script per iniezione, come `__sws_args__`: **`sws-pyscript` resta senza HTTP**, che è la regola
  dichiarata in `telegram.rs:8-9`.
- Un **valore di tag `string`** che contiene un token va risolto **al momento di mostrarlo**: è la
  via per cui uno script scrive uno stato leggibile in tutte le lingue. Regola nuova e piccola,
  da fissare con un test su entrambi i motori.
- I **toast** degli script nel viewer (`RuntimeView.tsx:20-26`) sono operator-facing e oggi
  grezzi: stessa risoluzione.

## Fase 7 — i template, che è il ponte verso l'attività successiva

Il maintainer ha già detto che i template si sistemano dopo. Qui entra solo il minimo perché la
revisione dei template parta da una base vera: la migrazione degli attuali `{{slug}}` a id opachi,
gli allarmi dei template tokenizzati, e **`docs/manual/15_multilingua.md` che smette di dichiarare
una conformità IT/EN che tre template non hanno**.

---

## File principali

- **Editor**: `src/i18n/projectI18n.ts` (il risolutore e l'elenco campi), `src/canvas/SvgCanvas.tsx`
  (imbuto di localizzazione, intestazioni cablate), `src/editor/EditorShell.tsx` (pannello
  proprietà, creazione chiavi), `src/config/ConfigView.tsx` (scheda Lingue, orfane, traduzione),
  `src/runtime-view/RuntimeView.tsx`, `src/components/{AlarmHistory,AlarmBanner,AlarmBellPanel}.tsx`
- **Runtime**: `crates/sws-core/src/{project.rs,alarm.rs}`, `crates/sws-web/src/notifications.rs`,
  `crates/sws-web/src/ai/` (l'astrazione fornitore da riusare), `crates/sws-historian/src/sqlite.rs`,
  `crates/sws-pyscript/src/lib.rs`
- **LVGL**: `crates/sws-lvgl-viewer/src/{lvgl_render.rs,model.rs,client.rs,main.rs}`
- **Guardie/documenti**: `scripts/check_i18n_parita.sh` (nuova), `scripts/check_static.sh`,
  `docs/manual/15_multilingua.md`, `docs/OPEN_QUESTIONS.md` (Q43 da timbrare, più la scheda nuova
  sulla lingua per-destinatario)

## Verifica

`cargo test --workspace`, clippy, fmt; `pnpm test`, `tsc`, eslint, `pnpm build`;
`./scripts/check_static.sh` — che dal 14-09 è nella *definition of done*.

La verifica che conta è la **guardia di catena della Fase 0**, provata rossa prima: un token deve
risolversi allo stesso modo nell'anteprima dell'IDE, nel viewer web e sul pannello LVGL, **anche
dentro una griglia e dentro un faceplate**. È esattamente il punto in cui i pezzi si incontrano, ed
è l'unico posto in cui nessuno guardava.

Collaudo a mano, per ogni fase: un progetto con `it`/`en`/`de`, un allarme tokenizzato che deve
arrivare tradotto **sul pannello, nello storico e su Telegram**, e un giro sul WP630 — perché il
greco e il cirillico li ho verificati nel font, non sul vetro.

## Rischi dichiarati

- **È lavoro da più sessioni.** Le fasi sono ordinate per poter chiudere e mergiare una per volta,
  ma la Fase 3 (chiave automatica) cambia il pannello proprietà per **tutti** i tipi di oggetto:
  è la più esposta, e va dopo la rete della Fase 0.
- **Il cinese non si può promettere**: il pannello non lo disegna. Se serve, è un lavoro a sé
  (secondo TTF sul dispositivo, decine di MB, e il limite `lv_freetype_init(8, 8, …)`).
- **La lingua delle notifiche è una decisione di prodotto** che il piano prende al minimo (una
  per progetto) e registra come domanda aperta nella variante per-destinatario.
- **Le chiavi opache rendono il YAML dei sinottici meno leggibile a occhio nudo.** È il prezzo
  scelto consapevolmente: in cambio, cambiare un testo non fa più mentire la chiave.
