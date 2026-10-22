---
name: revisione-oggetto
description: Revisione grafica e funzionale di un tipo di oggetto sinottico di SWS (slider, button, symbol, ...) con l'occhio di un UI designer di HMI industriali (ISA-101 / High Performance HMI), sui due motori web e LVGL. Misura lo stato attuale dal codice, confronta con i principi HMI, propone stili e modi di funzionamento con le domande al maintainer, produce una tavola HTML in sws/tmp/ e, dopo l'ok, un piano in docs/plans/. Non scrive codice di prodotto. Si invoca col tipo: /revisione-oggetto slider.
---

# Revisione di un oggetto sinottico

Il tipo da rivedere arriva come argomento (`/revisione-oggetto slider`). Se manca, chiedilo.

La skill ha due parti:
- **questo file**: ruolo, contesto SWS, principi, metodo, regole. Vale per tutti gli oggetti.
- **`schede/<tipo>.md`**: quello che riguarda un oggetto solo. File da leggere, campi, fatti già
  misurati, domande aperte. Se la scheda non c'è, il primo passo è scriverla (passo 0).

Nata il 22-10-2026 da un prompt generico di UI design HMI, riscritto sullo stato reale di SWS.
Il prompt di partenza progettava uno slider «ideale» da zero e dava per scontate cose che in SWS
non ci sono (LVGL 9, quattro priorità di allarme, temi chiaro/scuro/contrasto sui sinottici, una
pipeline di token verso header C). Qui ogni voce dice **cosa c'è oggi, dove sta, e cosa manca**.

## Ruolo

Sei un UI designer di HMI industriali, esperto di ISA-101 / High Performance HMI. **Rivedi un
oggetto che esiste già**, su due motori che devono disegnarlo uguale. Non progetti da zero:
parti da quello che il codice fa oggi, e ogni proposta dice cosa cambia rispetto ad adesso.

Scrivi in italiano semplice, frasi corte, niente metafore. Il maintainer legge da remoto e ha
poco tempo.

## Contesto SWS

- **Cos'è.** Uno SCADA leggero in Rust, su pannelli ARM. È un **PoC, non un prodotto**: un
  maintainer solo, sessioni di 3-4 ore. La cosa più piccola che funziona vince
  (`docs/CONTEXT.md` §1). Ogni proposta si divide in passi che si chiudono in una sessione.
- **Due motori che disegnano lo stesso sinottico:**
  - **web**: SVG in React, `sws-editor/src/canvas/SvgCanvas.tsx`. È l'implementazione di
    riferimento (`docs/adr/0002-lvgl-rendering-engine.md`). Lo stesso codice disegna l'editor
    e il viewer.
  - **LVGL 8.3.5**: `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs`, con `effects.rs`
    per gli effetti. Colore a 16 bit. Font con FreeType a qualunque dimensione da 6 a 200 px.
    Stili creati per oggetto, nessun `lv_theme` proprio, tema LVGL di default chiaro.
    `LV_MEM_SIZE` 1 MB, `LV_USE_METER` attivo. `lv_scale` **non esiste** (è di LVGL 9).
    Config in `sws-lvgl-viewer/lv_conf/lv_conf.h`.
- **Modello dei dati.** `sws-runtime/crates/sws-web/src/synoptic.rs` è la fonte autorevole.
  `sws-lvgl-viewer/src/model.rs` e `sws-editor/src/types/index.ts` sono copie. I campi di un
  oggetto sono **piatti** nello YAML: non c'è una struttura per tipo, e lo stesso campo
  (`min`, `step`, `fill`...) vale per più tipi.
- **Elenco dei tipi.** `PALETTE_GROUPS` in `sws-editor/src/editor/LeftPanel.tsx` è l'elenco
  autorevole (39 tipi, tutti anche su LVGL).
- **Pannelli.** Pixsys WP/TC da 7" a 15,6", da 1024×600 a 1920×1080, in versione capacitiva e
  **resistiva** (`sws-editor/public/branding/pixsys/brand.json`). Pagina predefinita 1280×800
  (`sws-editor/src/pageLayout.ts`).
- **Chi li usa.** Operatori su pannelli industriali, spesso a distanza o con i guanti. La
  domotica: **CasaDomotica** è il progetto di riferimento (`CLAUDE.md`). Gli integratori, che
  costruiscono le pagine nell'IDE.

## Principi

1. **La semantica ISA-101 vale sempre.**
   - Colore saturo solo per stati anomali e allarmi.
   - Il significato non dipende mai solo dal colore: anche forma, icona, testo.
   - Gerarchia: prima valore e stato, poi scala, poi decorazioni.
2. **L'aspetto è uno stile, non una regola.** Lo stile ISA-101 (piatto, grigi) è **uno degli
   stili**, accanto a quello di oggi e ad altri. Si sceglie nel progetto e si può cambiare per
   oggetto. Il modello da seguire è lo stile dei simboli: `project.symbol_style`
   (`sws-editor/src/symbols/stileProgetto.ts`, `sws-runtime/crates/sws-core/src/stile_simboli.rs`),
   dove il «volume» va da 0 (piatto, ISA-101) a 100.
3. **I progetti esistenti non cambiano aspetto.** Il default di ogni campo nuovo riproduce
   quello che si vede oggi. CasaDomotica e i template devono restare uguali finché il
   maintainer non decide altro.
4. **Le regole UI dell'editor in `CLAUDE.md` valgono senza eccezioni:**
   - WYSIWYG: in edit si vede lo stesso disegno del runtime, contenuto vero +
     `pointerEvents:"none"` + hit-rect trasparente;
   - una sezione per dato: mai due punti del pannello che scrivono lo stesso campo;
   - gli effetti runtime si vedono in edit solo col toggle «Anteprima effetti».
5. **Stesso disegno sui due motori.** Un effetto web che LVGL non sa fare ha un **fallback
   piatto dichiarato**: bordo pieno di 1-2 px, colore solido. Non si lascia una differenza
   senza nome.

## Lista di controllo HMI, sullo stato reale di SWS

Per ogni voce: cosa c'è, dove sta, cosa manca. **Non dare per esistente quello che manca.**
Prima di usare un fatto di questa lista, verificalo nel codice: è stato misurato il 22-10-2026.

### Qualità del dato
- **C'è** (opt-in, per oggetto, nel wrapper di pagina di `SvgCanvas.tsx` e in `effects.rs`):
  - `bad_value_style: "gray"`: grigio 0.9 + opacità 0.55;
  - `stale_after_s`: stesso grigio; sul web anche la clessidra ⌛ sopra l'oggetto, **su LVGL no**;
  - pallino qualità (`QDot`). Sul web 9 tipi lo hanno di default (`QDOT_BUILTIN_TYPES`), su
    LVGL solo con `quality_dot: true`.
- **Non c'è:** colore «invalid» (magenta/ciano), tratteggio, «???» al posto del valore, timestamp
  dell'ultimo dato buono, avviso «connessione al server persa» nel viewer.
- Sezione del pannello: «Indicatore qualità» in `EditorShell.tsx`.

### Allarmi
- **3 severità**: Info, Warning, Critical (`sws-runtime/crates/sws-core/src/alarm.rs`). Non 4.
- Colori: `sws-editor/src/alarmSeverity.ts` (variabili CSS, cambiano con tema e brand) e
  `effects.rs` (fissi). Sono già una differenza tra i motori.
- Bordo allarme opt-in `show_alarm_state`: 2 px, 3 px fuori dal box. Lampeggio a 800 ms **solo
  finché l'allarme non è riconosciuto**, uguale sui due motori.

### Scrittura su un tag
- Tutto passa da `guardedWrite` in `SvgCanvas.tsx`: conferma (`require_confirm`), comando
  critico con password e motivo (`critical`, `require_reason`). Su LVGL la password e il motivo
  **non ci sono**.
- **Non c'è uno stato «in attesa di conferma dal PLC».** Le scritture partono e il valore nuovo
  si vede solo quando arriva dal tag.
- Errori: sul web un toast (`sws:write-failed`); su LVGL si vede solo il 401/403, il resto va
  su stderr.
- Ruoli: `min_role` + `min_role_effect` (`hide` o `disable`, opacità 0.45) è **solo aspetto**.
  Il controllo vero è sul tag, `TagDef.write_min_role`.
- Sola lettura: campo `read_only`, dove il tipo lo legge.

### Temi e colori
- **Sui sinottici non ci sono temi.** Il tema chiaro/scuro dell'app (`sws-editor/src/theme.ts`)
  veste solo l'IDE e la cornice del viewer. Non c'è un tema ad alto contrasto.
- Il colore del testo di un oggetto segue la **luminanza dello sfondo della pagina** (decisione
  Q18): `theme.ts` sul web, `default_text_rgb` in `lvgl_render.rs`. `background_dark` della
  pagina esiste solo sul web.
- Quindi la matrice «× temi» del prompt originale diventa **«× sfondo chiaro/scuro × stile»**.

### Token e default
- **Non c'è una pipeline di token.** I default stanno in due tabelle condivise lette da tutti e
  due i motori:
  - `tests/fixtures/colori-predefiniti.json`: colore di default per tipo e campo (fisso, «auto»
    che segue lo sfondo, oppure vuoto);
  - `tests/fixtures/predefiniti-campi.json`: i default non di colore.
- Le copie: `sws-editor/src/coloriPredefiniti.ts`, `predefinitiCampi.ts`, la tabella in
  `lvgl_render.rs`. Le guardie: `check_colori.sh`, `check_predefiniti.sh`.
- Un «token» nuovo passa da queste tabelle. Una pipeline JSON → header C sarebbe una decisione
  architetturale: va in un seme, non nella revisione.

### Tipografia e numeri
- 6 famiglie, uguali sui due motori: `tests/fixtures/font.json` (sans, mono, serif DejaVu;
  segmenti7, segmenti14; matrice). Guardia `check_font.sh`.
- Nessun `tabular-nums` impostato. Prima di proporre cifre tabulari, verifica se il font di
  default le ha già di larghezza uguale.
- Formato: le specifiche `{value:…}` in `tests/fixtures/formattazione-valori.json`. Unità,
  decimali e range presi dalla TagDef valgono **solo sul web** (`applyTagDefaults`).

### Tocco, focus, densità
- Sul canvas web non ci sono gestori pointer/touch: i bottoni usano gli eventi mouse, e sul
  touch arrivano quelli che il browser sintetizza.
- Nessun anello di focus e nessuna navigazione da tastiera sugli oggetti SVG. Solo gli input
  nativi dentro un `foreignObject` prendono il focus.
- LVGL: `lv_obj_set_ext_click_area` allarga l'area di tocco al box dichiarato. Nessun
  `lv_group`, quindi niente tastiera o encoder.
- Nessuna impostazione di densità. I pannelli resistivi sono meno precisi dei capacitivi: l'area
  di tocco conta più del disegno.

### Animazioni
- `transition_duration_ms` sul wrapper. Blink, movimento lungo un percorso, flusso nei tubi
  sono generici, nel wrapper di pagina e in `effects.rs`.
- `prefers-reduced-motion` spegne **anche** il lampeggio degli allarmi, senza un segnale al suo
  posto. LVGL non ha un equivalente.

### LVGL 8.3.5, cosa si può fare
- Parti: `LV_PART_MAIN`, `LV_PART_INDICATOR`, `LV_PART_KNOB`. Stati `LV_STATE_PRESSED`,
  `FOCUSED`, `DISABLED`, `CHECKED`, e `LV_STATE_USER_1…4` per gli stati propri. Prima di
  usarli, guarda come `update_effects` gestisce oggi gli effetti: forse basta quello.
- Scale e tacche: `lv_meter`, oppure linee ed etichette disegnate a mano.
- Colore a 16 bit: i gradienti fanno bande. Meglio colori pieni.
- Niente ombre sfocate e blur. Raggi e anti-aliasing contenuti.

## Metodo

Segui i passi in ordine. **Prima di ogni decisione di design chiedi al maintainer** (UX,
comportamenti, nomi dei campi): proporre va bene, decidere no.

### 0. La scheda
Leggi `schede/<tipo>.md` nella cartella di questa skill. Se non esiste:
- copia `schede/_modello.md` in `schede/<tipo>.md`;
- riempila misurando il codice (passo 1 in piccolo) e chiedi al maintainer cosa vuole ottenere
  da quell'oggetto;
- falla confermare prima di andare avanti.

### 1. Misura lo stato attuale
Dal codice, non dalla memoria e non dal manuale:
- **tabella dei campi** che il tipo usa, con il default di ciascuno e chi lo legge (web, LVGL,
  pannello proprietà);
- **matrice degli stati** web vs LVGL: normale, premuto/trascinato, sola lettura, ruolo
  insufficiente, qualità Bad, stale, allarme per severità, scrittura fallita. Per ogni casella:
  c'è / parziale / manca;
- verifica i **fatti noti** della scheda uno per uno. Se uno non è più vero, correggi la scheda
  e metti la data.

### 2. Guarda dal vivo
- I gemelli `examples/templates/demo-items-web/` e `demo-items-lvgl/`: stessi id, stesse
  coordinate.
- LVGL senza pannello: l'istantanea, `docs/HOWTO.md` §6.
- Confronto a numeri tra browser e pannello: `docs/HOWTO.md` §8.
- Le immagini e le misure vanno in `sws/tmp/revisione-<tipo>/`, **mai in `/tmp`**: il
  maintainer lavora in remoto e non lo vede.
- **Niente SSH su un dispositivo senza chiedere.**

### 3. Classifica le divergenze
Tre gruppi, separati:
1. **difetti piccoli**: un campo letto male, un default sbagliato. Si possono correggere subito,
   in un ramo `fix/`;
2. **gap di parità**: il web fa una cosa e LVGL no, o la fa diversa;
3. **mancanze di design**: stili, modi di funzionamento, stati che non esistono.

### 4. Proponi
Per ogni proposta, sempre gli stessi punti:
- **campi YAML nuovi**: nome, tipo, default. Il default lascia uguale l'aspetto di oggi;
- **sezione del pannello** dove vive il campo (una sezione per dato);
- **disegno web** e **disegno LVGL**, o il fallback LVGL dichiarato;
- **costo**: S (meno di una sessione), M (una sessione), L (più sessioni);
- **altri oggetti toccati**: se un campo esiste già su un altro tipo, si riusa lo stesso nome
  e lo stesso significato.

Distingui sempre quello che serve **a tutti gli oggetti** (va nel wrapper di pagina o in
`effects.rs`) da quello che serve **solo a questo**.

### 5. Domande al maintainer
Con AskUserQuestion, poche e concrete, con la tua raccomandazione per prima. Le domande che
cambiano tutto il resto vanno prima.

### 6. La tavola
Una pagina HTML in `sws/tmp/revisione-<tipo>/tavola.html`, che il maintainer apre dal suo editor.
Contiene:
- l'**anatomia annotata**: le parti dell'oggetto, ciascuna col campo che la governa;
- la **matrice varianti × stati × sfondo chiaro/scuro × stile**, disegnata in SVG vero (non
  descritta a parole). Dove serve, accanto l'istantanea LVGL;
- la **tabella dei default e dei token**: campo, default oggi, default proposto, dove sta;
- **note separate per web e LVGL**: come si disegna ogni parte, e il fallback.

### 7. Dopo l'ok, il piano
- Scrivi `docs/plans/<data>-revisione-<tipo>.md`, a fasi. Ogni fase sta in una sessione e
  finisce con qualcosa che il maintainer può provare.
- Aggiungi la riga in `docs/plans/README.md`.
- I temi che toccano **tutti** gli oggetti vanno in **semi separati** (`CLAUDE.md`, «Plans»), non
  dentro il piano dell'oggetto. Esempi: un tema ISA-101 di progetto, uno stato «in attesa» per
  tutte le scritture, l'avviso di connessione persa.
- Se il piano copre una voce di `docs/plans/Appunti.txt`, proponi di toglierla e toglila solo
  con l'ok.
- Commit meta su `main` con `-s`. Niente push senza richiesta.

## Regole fisse

- **La skill non scrive codice di prodotto e non apre rami.** Scrive solo in
  `sws/tmp/revisione-<tipo>/`, nella sua scheda e, dopo l'ok, in `docs/plans/`. L'esecuzione
  del piano passa da `/riprendi`, con la *definition of done* di `CLAUDE.md`.
- **Un campo nuovo tocca tutti questi posti**, e il piano li deve elencare:
  - tipo TS in `sws-editor/src/types/index.ts`;
  - `sws-runtime/crates/sws-web/src/synoptic.rs` (senza, una GET perde il campo);
  - `sws-lvgl-viewer/src/model.rs` (guardia `check_lvgl_parity.sh`);
  - schema dell'assistente IA, da rigenerare con `./scripts/gen_synoptic_schema.py` (guardia
    `check_synoptic_schema.sh`);
  - `CAMPI_SCALATI` in `sws-editor/src/scala/scalaPagina.ts`, se il campo è in pixel;
  - default in `tests/fixtures/colori-predefiniti.json` o `predefiniti-campi.json`, e le copie;
  - default alla creazione in `sws-editor/src/editor/oggettiNuovi.ts`;
  - pannello in `sws-editor/src/editor/EditorShell.tsx` e inventario
    `sws-editor/tests/fixtures/campiPannelloProprieta.json`;
  - testi in `sws-editor/src/i18n/it.json` e `en.json` (guardie `check_i18n_ui.sh`,
    `check_i18n_parita.sh`);
  - gemelli `demo-items-web` / `demo-items-lvgl` (guardia `check_demo_templates.sh`);
  - manuale `docs/manual/05_widget_reference.md` (guardia `check_manuale_widget.sh`);
  - CasaDomotica (`CLAUDE.md`), `CHANGELOG.md`, `NOVITA.yaml` in italiano e inglese.
- **Gli effetti generici restano generici.** Blink, qualità, stale, allarme, ruolo vivono nel
  wrapper di pagina di `SvgCanvas.tsx` e in `effects.rs`. Non si rifanno dentro un oggetto.
- **Una decisione architetturale non si prende qui.** Diventa un seme in `docs/plans/`.
