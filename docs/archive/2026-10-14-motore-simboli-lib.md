# Il motore dei simboli di libreria: parti vive, stile del progetto, sostituzione dei builtin

> **Piano d'esecuzione, scritto il 14-10-2026 nella sessione plan approfondita che il seme
> [libreria di simboli SCADA](2026-10-14-libreria-simboli-scada.md) chiedeva. Le decisioni M1–M11
> sono del maintainer.** Le decisioni grafiche e di prodotto (1–19) restano nel seme. Qui c'è il
> *come*.
>
> **Concluso il 14-10-2026, sera.** Tutte e sette le fasi sono fatte. Le Fasi 1–6 sono state confermate
> dal maintainer e squashate su `main`. La Fase 7 (i 91 simboli che mancavano, in quattro lotti) sta
> sul ramo `feat/simboli-lib-lotti`, in attesa del collaudo.
>
> **Stato di metà giornata**: Fase 1 fatta sul ramo `feat/simboli-lib-formato`. Fase 2 fatta
> sul ramo `feat/simboli-lib-fetta`, **annidato** sul primo (regola «un ramo alla volta», opzione
> 2), con la misura M2 sul WP630. Nessuno dei due è mergiato: aspettano la conferma del
> maintainer, prima la Fase 1 (aspetto dei campioni), poi la 2.

**Riassunto**: i disegni della libreria diventano oggetti `symbol` (`lib:<famiglia>/<slug>`). Le
parti vive sono dichiarate in un manifesto generato e disegnate dai due viewer con strategie
diverse ma con lo stesso risultato. Uno stile del progetto si mette fra il manifesto e l'oggetto.
I 40 builtin diventano alias dei disegni nuovi. Le fasi sono sette, un ramo ciascuna.

## Decisioni del maintainer (14-10-2026)

| # | Domanda | Scelta |
|---|---|---|
| M1 | Dove si dichiara la geometria delle parti | **manifesto JSON generato** accanto agli SVG |
| M2 | Rotore sul pannello | **fotogrammi precalcolati**, ma prima si misura anche `lv_img_set_angle`: se costa poco si usa quello, che è più semplice |
| M3 | Progetti con `pump`, `valve`… | **alias permanente**: il file non cambia, il runtime nuovo lo risolve sul disegno nuovo |
| M4 | Vecchio riquadro, proporzioni nuove | **contenuto e centrato** (contain), più un comando «Adatta proporzioni» nell'editor |
| M5 | Dove si modifica lo stile | **Configurazione → Progetto → «Stile»**, con anteprima viva |
| M6 | Colori di stato scritti nei file dal 30-09 | **tolti all'apertura se uguali ai vecchi predefiniti**: il simbolo passa a «da progetto» |
| M7 | Personalizzabili per oggetto | **colore del corpo, colore del contenuto, volume e contorno, animazioni**, oltre ai colori di stato |
| M8 | Legare le parti ai tag | **sezione «Parti» costruita dal manifesto**: compare solo quello che il simbolo ha |
| M9 | Pannello che non conosce un `lib:` | **avviso con l'elenco prima del deploy**, che resta permesso |
| M10 | Difetti trovati nel sistema attuale | **corretti dentro il motore, ognuno con un test** che lo dimostra prima della correzione |
| M11 | Ordine | **prima il formato, poi una fetta verticale** (due simboli completi su web e LVGL), poi il resto |

## Misurato il 14-10-2026

Nel codice di `main` a `9ead07f8`, con tre ricognizioni (web, LVGL, modello e distribuzione) e
una misura di resvg.

**Web**:
- Il ramo `symbol` è in `SvgCanvas.tsx:5962-6107`.
  - I builtin sono JSX su viewBox 0..100 (`library.tsx:807`, `SymbolRenderProps` = state più
    level).
  - I custom inline passano per `sanitizeSvg` → `applyStateColor` → `dangerouslySetInnerHTML`,
    **senza prefisso sugli id**: più istanze nella stessa pagina condividono gradienti e `id`.
- La rotazione gira **tutto** il gruppo su `50px 50px`, anche nei custom con un altro viewBox.
- Il lampeggio per stato c'è solo nei builtin.
- Il picker (`SymbolGallery`, `EditorShell.tsx:130`) è una griglia piatta con etichette italiane
  scritte nel codice, senza gruppi, senza ricerca e senza chiavi i18n. Un simbolo nuovo nasce
  80×80 fisso e ignora `defaultWidth`.
- Pannello proprietà: sezione «Parametri» (`EditorShell.tsx:4749-4841`). `fill_level` statico,
  `fill_level_scale` e `colorable_ids` non hanno un campo. Ogni campo nuovo va in
  `tests/fixtures/campiPannelloProprieta.json`.
- Stile del progetto: **non esiste**. Il tema è nel browser, il marchio è per installazione, i
  predefiniti delle pagine stanno in `PageLayoutConfig`.

**LVGL**:
- `draw_symbol` (`lvgl_render.rs:8937-9863`) usa un `lv_canvas` per simbolo e primitive scritte a
  mano in 39 rami. Si ridisegna solo quando cambiano stato o colore.
- **Il livello dei simboli non c'è**: tank e silo usano una frazione fissa scelta dallo stato.
- La rotazione è `transform_angle` su tutto il canvas. Questo porta l'oggetto su un layer di
  trasformazione preso dal pool LVGL da 1 MB e lo ricampiona a ogni refresh (ogni 30 ms).
- Gli SVG sono rasterizzati da resvg in modo sincrono alla costruzione della pagina. Poi sono
  bitmap fisse a 3 B/px in un `Vec` Rust, fuori dal pool.
- LVGL è alla 8.3.5, quindi `lv_img_set_angle`, `lv_img_set_pivot` e `lv_img_set_zoom` ci sono, ma
  il codice non li usa mai. `resvg::render_node` (resvg 0.45.1, `lib.rs:62`) rasterizza un solo
  nodo dell'albero: è quello che serve per gli strati.
- **Divergenze col web**:
  - un tag stringa «on» vale spento (`tag_value_as_f64 != 0`);
  - una voce di `symbol_states` che corrisponde non significa «on»;
  - niente lampeggio per voce;
  - nell'istantanea la rotazione usa l'orologio di sistema, quindi non è deterministica.

**Modello e distribuzione**:
- Oggetti e pagine sono struct tipizzate senza `flatten`: in `sws-web/src/synoptic.rs`, e ogni
  campo deve avere il suo specchio in `model.rs` (guardia `check_lvgl_parity`). Un campo non
  dichiarato **sparisce** al GET, al PUT e nello ZIP di deploy.
- Il validatore accetta per `symbol_id` solo i 40 nomi. Rifiuta i `custom:`, e questo è già un
  difetto. Il vocabolario dell'IA (`gen_synoptic_schema.py:195-210`) e `check_simboli_lvgl.sh:65`
  estraggono gli id con `id:\s*"([a-z_0-9]+)"`, che non può riconoscere `lib:famiglia/slug`.
- Gli asset di `public/` arrivano sul pannello dentro `www/` dell'immagine (`package.sh`,
  Containerfile, `deploy/yocto`). Il deploy del progetto non li porta.
- `/symbols/...` è servito senza `Cache-Control`.
- Non c'è un numero di versione dello schema. Il precedente per «il pannello sa fare X?» è un flag
  di capacità in `/api/system` (`segreti_separati`).
- **Usi reali dei builtin**: `pump` 5 template, `valve` e `heat_exchanger` 2 ciascuno, gli altri 37
  in nessuno. Più `check_forme_lvgl.sh` (2 volte `pump`) e l'esempio IA in `synoptic_schema.rs`.

**resvg** (Xeon Gold 5218, i 16 campioni):
- parse 0,2 ms; rasterizzazione 0,6–1,7 ms a 120 px e 1,4–3,2 ms a 240 px;
- RGBA 28–450 KiB.

Sul PX30 (Cortex-A35) ci si aspettano 8–10 volte tanto, quindi **10–30 ms**: va bene a ogni cambio
di stato, non a ogni fotogramma. **Da misurare sul pannello** nella Fase 2.

## Il disegno

### Formato (generato, mai a mano)

- **Sorgente**: `scripts/simboli/` contiene il generatore (dal prototipo `gen.py`), la tabella dei
  materiali e le funzioni di disegno per famiglia.
- **Uscita**:
  - `sws-editor/public/symbols/lib/<famiglia>/<slug>.svg`, con le famiglie `process`,
    `electrical`, `machines`, `building`;
  - `sws-editor/public/symbols/lib/manifest.json`.
  - Si committa tutto, e una guardia rigenera e confronta.
- **SVG a strati**: i figli diretti dell'`<svg>` sono, in ordine, `base` statico, poi le parti vive
  (`body`, `level`, `rotor`, `needle`, `lever`, `lamp-*`), poi gli strati statici che ci stanno
  sopra.
  - Ogni forma ha un colore piatto con `data-mat="<materiale>"`.
  - I veli del volume sono gruppi con `data-shade`.
  - Gli spessori del tratto sono in unità di disegno.
  - Non ci sono `<text>`, `<style>`, `animate*`, filtri né raster.
- **Manifesto**:

  ```json
  { "version": "2026.10.1",
    "materials": { "steel": "#9aa5af", "steel-dark": "#4a545d", "rubber": "#2a2d31", "liquid": "#2b8fd6",
                   "body-pump": "#2f6fa8", "body-motor": "#5d6f7e", "cabinet": "#c8cdd2", … },
    "symbols": [ {
      "id": "lib:process/centrifugal-pump", "file": "process/centrifugal-pump.svg",
      "family": "process", "kind": "pumps", "label": "symbols.lib.process.centrifugal-pump",
      "viewBox": [80, 80], "body": "body-pump", "replaces": "pump",
      "parts": { "rotor": { "cx": 40, "cy": 50, "symmetry": 60 } } },
    { "id": "lib:process/vertical-tank", …,
      "parts": { "level": { "x": 31, "y": 40, "w": 18, "h": 81 } } } ] }
  ```

  Le altre parti si dichiarano così:
  - `needle`: `{cx, cy, a0, a1}`;
  - `lever`: `{cx, cy, open, closed}`;
  - `lamps`: `[{id, material}]`.
- **«Applica stile»**: una funzione pura `(svg, stile effettivo) → svg`. Assegna i colori per
  materiale, dà al velo un'opacità proporzionale al volume, imposta il colore del contorno e
  moltiplica gli spessori.
  - Ha due implementazioni: TypeScript in `sws-editor/src/symbols/lib/` e Rust in
    `sws-core/src/stile_simboli.rs`. Il viewer LVGL dipende già da sws-core.
  - Una fixture condivisa, `tests/fixtures/stile-simboli.json`, verifica che diano lo stesso
    risultato, come per `colori-predefiniti.json`.

### Stile effettivo e precedenza

`oggetto → stile del progetto → manifesto`. I gruppi sono quattro:

- **stati**: off, on, alarm, più la tavolozza N-stati predefinita;
- **materiali**: le chiavi del manifesto;
- **resa**: volume 0–100 e contorno (colore, fattore di spessore);
- **animazioni**: `spin_s`, `blink_ms`, transizione del livello.

Per oggetto si sovrascrivono:
- colori di stato;
- colore del corpo;
- colore del contenuto;
- volume e contorno;
- animazioni (M7).

### Web

- Il manifesto si carica una volta. L'SVG si scarica con `?v=<versione del manifesto>` e si tiene
  in cache per id.
- Poi si applica lo stile, si mette **un prefisso agli id per istanza**, e le parti si comandano
  da React:
  - `fill` su `body`;
  - un rettangolo di ritaglio per `level`, con la transizione dello stile;
  - una rotazione CSS sul centro del manifesto per `rotor`, con `transform-box: view-box`;
  - `rotate` con transizione per `needle` e `lever`;
  - opacità per `lamp-*`.
- In modalità edit (WYSIWYG): contenuto vero, `pointerEvents:none`, **hit-rect sopra il
  contenuto**. Questo corregge il clic che oggi deseleziona i builtin. Gli effetti si vedono solo
  con «Anteprima effetti».

### LVGL

- Un nuovo `LiveKind::SimboloLib`: un contenitore e, dentro, un `lv_img` per strato. Ogni bitmap è
  ritagliata al bbox del suo strato e prodotta con `resvg::render_node` dall'SVG già con lo stile
  applicato.
- **`body`**: si ri-rasterizza quando cambia colore, con una cache LRU dei colori già visti.
- **`level`**: lo strato del liquido si rasterizza una volta a pieno livello, dentro un contenitore
  LVGL che ne ritaglia l'altezza dal basso. Costa zero e va bene per qualsiasi forma.
- **`rotor`**: M2. Fotogrammi `symmetry / passo`, scambiati a tempo, oppure `lv_img_set_angle` se
  la misura lo consente. Il tempo è quello delle tick LVGL e non l'orologio, così l'istantanea
  diventa deterministica.
- **`needle` e `lever`**: `lv_img_set_angle` sul perno, si paga solo al cambio di valore.
- **`lamp-*`**: opacità sopra la lente spenta, che sta nello strato base.
- La lettura vero/falso e la scelta dello stato N vengono da **una fixture condivisa**,
  `tests/fixtures/stato-simbolo.json` (bool, numeri, stringhe, `symbol_states`, priorità
  dell'allarme). Così il tag stringa «on» del pannello diventa acceso come sul web (M10).

### Modello

- **Oggetto**: `symbol_id` accetta `lib:…`. Gli alias del manifesto (`replaces`) risolvono gli id
  vecchi. Campi nuovi, tutti in `synoptic.rs`, `model.rs` e nei tipi TS:
  - `symbol_parts`: JSON opaco come `symbol_states`, che lega `{needle: {tag, min, max}, lever:
    {tag}, "lamp-red": {tag}}`. Va registrato anche in `check_tag_refs` e nella ricerca degli usi
    dei tag;
  - le sovrascritture di M7.
- **Progetto**: un campo tipizzato `symbol_style` nel `Project` di `sws-core/src/project.rs`.
  Deve essere tipizzato perché lo ZIP di deploy scrive il `Project` tipizzato. Ha un suo endpoint
  e il suo salvataggio nello store.
- **Colori «da progetto»**:
  - una regola nuova `{progetto: chiave}` in `colori-predefiniti.json`, che non si scrive mai nel
    file e che `coloreEffettivo` risolve con lo stile del progetto;
  - `CampoColore` mostra «da progetto» con il pulsante ↺;
  - `riempiPredefiniti` smette di scrivere i colori di stato dei simboli;
  - una normalizzazione idempotente all'apertura toglie quelli uguali a `#64748b`, `#22c55e`,
    `#ef4444` (M6).
- **Validatore e IA**: `symbol_id` è valido se è un builtin (alias), un `lib:` del manifesto o un
  `custom:` del progetto. `gen_synoptic_schema.py` e `check_simboli_lvgl.sh` leggono il manifesto
  invece della regex su `library.tsx`.

### Distribuzione e compatibilità

- La libreria viaggia in `www/`, quindi è versionata con SWS.
- **Avviso al deploy** (M9): `remote_deploy` legge `/symbols/lib/manifest.json` dal pannello (un
  404 vuol dire che non ha la libreria). Se il progetto usa id `lib:` che il pannello non conosce,
  li elenca e permette comunque il deploy.
- Gli alias non danno avviso: un pannello vecchio disegna il suo builtin.
- Un pannello vecchio che riceve un progetto con `symbol_parts` o `symbol_style` li ignora (è
  tollerante sui campi ignoti, test in `lvgl_render.rs:13161`): mostra il simbolo come oggi.

## Le fasi (un ramo ciascuna, chiuso prima del successivo)

**Fase 1 — Formato** (`feat/simboli-lib-formato`). Niente pannello.
1. Il generatore entra in `scripts/simboli/`, con i nomi in inglese, i materiali piatti più il
   velo per **tutte** le parti, gli strati e il manifesto.
2. I 16 campioni si rigenerano e si ripubblica la tavola. **Il maintainer conferma che l'aspetto
   non è cambiato.**
3. «Applica stile» in TS e Rust, con la fixture condivisa e i test da entrambe le parti.
4. Le etichette `symbols.lib.*` in `it.json` e `en.json`.
5. La guardia `check_libreria_simboli.sh`, in `check_static.sh` fra quelle statiche. Verifica:
   - rigenerare dà gli stessi file;
   - manifesto e file corrispondono;
   - ogni parte dichiarata esiste;
   - nessun costrutto vietato;
   - ogni `data-mat` è nella tabella;
   - ogni `replaces` è un builtin vero.

**Fase 2 — Fetta verticale** (`feat/simboli-lib-fetta`): `centrifugal-pump` (corpo e rotore) e
`vertical-tank` (corpo e livello), completi.
1. Web: caricamento, stile, prefisso agli id, parti, WYSIWYG con hit-rect sopra. Nel picker un
   gruppo «Libreria» provvisorio.
2. Validatore, schema IA e regex delle guardie leggono il manifesto. Si corregge anche il
   difetto dei `custom:` (M10).
3. LVGL: `SimboloLib` con strati, livello ritagliato, rotore. **Misura sul pannello**:
   - tempo di rasterizzazione per strato;
   - fotogrammi contro `lv_img_set_angle`, in CPU e in fluidità, con 10 rotori in pagina.

   Serve un device: **si chiede al maintainer quale e l'indirizzo**, niente SSH senza permesso.
4. La fixture `stato-simbolo.json` con i test web e Rust. Si corregge il «on» stringa su LVGL
   (M10).
5. `check_simboli_lvgl.sh` si estende ai `lib:`, più una prova con l'istantanea: il livello al 30 e
   al 70 % cambia i pixel solo dentro la finestra.

> **Fasi 1 e 2 fatte il 14-10-2026** (vedi STATUS.md). Misura M2 sul WP630: fotogrammi 0,88 ms per
> fotogramma con 10 rotori, contro 1,77 ms di `lv_img_set_angle` e 4,57 ms dei builtin di oggi.
> **M2 si chiude sui fotogrammi.** Scostamenti dal disegno:
> - gli strati si dividono per testo, nel formato del generatore, e non con `resvg::render_node`:
>   così il rotore ruota dentro l'SVG e il ritaglio si calcola su un SVG con un solo strato;
> - la valvola di prova è alta 70 e non 60, per lasciare posto alla leva chiusa.

**Fase 3 — Tutte le parti** (`feat/simboli-lib-parti`).
1. `needle`, `lever` e `lamp-*` su entrambi i viewer.
2. `symbol_parts` in tutti gli specchi: TS, `synoptic.rs`, `model.rs`, `check_lvgl_parity`,
   `check_tag_refs`, ricerca degli usi.
3. **Sezione «Parti»** dal manifesto (M8), con l'aggiornamento di `campiPannelloProprieta.json`.
4. Il picker per famiglia e tipologia, con ricerca ed etichette tradotte. Il simbolo nasce con le
   proporzioni del manifesto.
5. Lampeggio per voce di `symbol_states` anche su LVGL (M10).

> **Fase 3 fatta il 14-10-2026.** In più rispetto al piano, su richiesta del maintainer:
> `bindings.symbol_spin_s`, cioè il periodo di rotazione legabile a un tag, su web e LVGL e per tutti
> i simboli. Il lampeggio per voce sul pannello usa `img_opa`, così non si pesta con l'`opa` degli
> effetti.

**Fase 4 — Stile del progetto** (`feat/stile-del-progetto`).
1. `symbol_style` in Rust, TS, endpoint e store, con i predefiniti uguali all'aspetto attuale.
2. La scheda **Configurazione → Progetto → Stile** (M5): quattro sezioni e un'anteprima viva di
   qualche simbolo.
3. La regola `{progetto: chiave}`, la dicitura «da progetto», la normalizzazione M6 e
   l'aggiornamento di `check_predefiniti`.
4. Le sovrascritture per oggetto (M7) nel pannello proprietà.
5. LVGL legge lo stile da `/api/project` e lo applica con la funzione Rust.

> **Fase 4 fatta il 14-10-2026.** Scostamento dal disegno: i colori di stato non sono una regola
> nuova `{progetto: chiave}` dentro `colori-predefiniti.json`. Sono un elenco a parte,
> `da_progetto`, e i loro `hex` restano come ripiego. Così non è cambiato nessun test delle coppie
> `lvgl` né la tabella del pannello.

**Fase 5 — Avviso al deploy e cache** (`feat/simboli-lib-deploy`).
1. Il controllo M9 in `remote_deploy`, con un test che usa un pannello finto senza manifesto e uno
   con un manifesto parziale.
2. `?v=` sugli URL e `Cache-Control: no-cache` per `/symbols/lib/`.

> **Fase 5 fatta il 14-10-2026**, come da disegno. Un manifesto illeggibile (un runtime vecchio
> risponde con la SPA, non con un 404) vale come «senza libreria».

**Fase 6 — I 40 sostitutivi** (`feat/simboli-lib-sostitutivi`).
1. Disegnare i 40 con `replaces`, risolvere gli alias nei due viewer e aggiungere il comando
   «Adatta proporzioni» (M4).
2. Togliere il JSX dei builtin e `draw_symbol` (circa 900 righe). Si aggiornano `check_lvgl_symbols`,
   `check_forme_lvgl` e l'esempio IA.
3. I template restano con gli id vecchi: valgono come alias, e così si prova anche l'alias.
4. `NOVITA.yaml` con la voce `compatibilita:` («l'aspetto dei simboli cambia»), in italiano e in
   inglese, e `CHANGELOG` sotto ⚠ Compatibilità. È il precedente Q40 fatto per bene: lì il cambio
   d'aspetto era passato in silenzio.

> **Fase 6a fatta il 14-10-2026**: 31 sostitutivi, alias su web e LVGL con i builtin come ripiego,
> «Adatta proporzioni», voce di compatibilità. **La 6b**, cioè il ritiro del JSX e di `draw_symbol`,
> **aspetta la conferma del maintainer sui sostitutivi**: con gli alias i builtin non servono più
> a disegnare, ma toglierli è il passo che non si annulla, e il ripiego tiene in piedi i pannelli
> finché il manifesto non arriva.

**Fase 7 — Il resto della libreria**, a lotti per famiglia, uno per sessione, dalla lista del seme.

## Rischi e cose da tenere d'occhio

- **Il pool LVGL da 1 MB**: gli strati vanno in `Vec` Rust, come gli SVG di oggi. Nel pool ci
  sono solo gli oggetti. Da guardare il costo di un contenitore più 3–5 `lv_img` per simbolo in
  una pagina con 30 simboli.
- **La memoria dei fotogrammi**: va dimensionata col bbox del rotore e non col simbolo.
- **Parità visiva**: la quantizzazione RGB565 obbliga a confronti con tolleranza. Un confronto
  automatico web/LVGL non esiste ancora: la Fase 2 ne fa uno minimo, con l'istantanea e coordinate
  note.
- **Il rumore delle sessioni concorrenti** sullo stesso checkout: build in un worktree isolato,
  come da memoria di progetto.
