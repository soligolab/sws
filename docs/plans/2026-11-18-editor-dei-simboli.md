# L'editor dei simboli — piano

> **Piano, in corso.** Nato il 18-11-2026 dalla sessione di plan sull'«Aggiunta del 18-11-2026» del seme
> [libreria dei simboli più ricca](semi/2026-11-03-libreria-simboli-piu-ricca.md), con le decisioni del maintainer qui
> sotto. Le fasi dopo la prima si riverificano col maintainer prima di aprire il ramo.

## Contesto
Appunti di una riunione del maintainer (18-11-2026), registrati nel seme della libreria.
Oggi **non esiste un editor**: i simboli del progetto (`prj:`) nascono solo dall'assistente come *descrizione* a
vocabolario chiuso (4 forme, 42 materiali, niente raster), i `custom:` sono SVG fissi, e il comportamento sta
sull'oggetto in pagina (`symbol_states`, `symbol_spin`, `symbol_parts`) con cinque parti vive fisse.

**Decisioni del maintainer (18-11-2026):**
1. **Editor completo**: prima la **struttura** (ingressi: quanti, di che tipo, parametri), poi la grafica.
2. La grafica si **disegna** con strumenti di modifica grafica, si **importa da SVG** o la **genera l'IA**.
3. **Ingressi e parametri sono la stessa cosa**: ogni ingresso, in pagina, si collega a un tag **o** si fissa a un valore.
4. Il comportamento sta **nel simbolo**; in pagina si collega solo un valore per ingresso.
5. **Foto sotto, pezzi sopra**: un'immagine fotorealistica (PNG/JPG/WebP) fa da sfondo; sopra, pezzi vettoriali o
   ritagli PNG che cambiano colore, ruotano, si riempiono.
6. **SVG importato esploso, coi colori suoi** (filtri, testo, script tolti); un simbolo duplicato dalla libreria
   tiene i materiali e quindi segue lo stile di progetto.
7. **Su PC**: export/import del simbolo come file **e** una libreria personale/aziendale condivisa fra i progetti.
8. Effetti difficili (neon, sfocatura, bollicine, fumo, fuoco) **in una fase loro, dopo**.

## Il formato nuovo: `SymbolDef` (famiglia `sym:`)
La *descrizione* dei `prj:` non basta (colori chiusi, niente raster): si affianca un formato nuovo; `lib:`, `prj:` e
`custom:` restano come sono e funzionano come oggi. Codice e chiavi in inglese.
- **Dove sta**: nel progetto, `symbols/<slug>/symbol.yaml` + i file grafici accanto (`*.png|jpg|webp`). Viaggia col
  deploy come le altre risorse del progetto.
- **Struttura**: `view_box`, `label {it,en}`, `category`, `ports[]` (attacchi dei tubi, come i `custom:`),
  `inputs[]` con `name`, `kind` (`bool` | `number` | `enum` | `text` | `color`), `default`, `min/max/unit`,
  `options[]` per gli enum, `label {it,en}`.
- **Grafica**: lista ordinata di **elementi** — `image` (file raster, rettangolo, opacità), `shape` (`rect`, `circle`,
  `ellipse`, `line`, `polyline`, `polygon`, `path`, gradienti lineari/radiali) con colori propri **oppure** `mat`/`shade`
  (per seguire lo stile di progetto), `group` con trasformazione.
- **Pezzi**: un `group` (o un'`image` ritagliata) può essere un **pezzo**: `id`, `anchor`, `rules[]`, `anim?`.
  - **regola**: `when {input, is: true|false|eq|gte|lte|between|in, value?}` → `color`, `visible`, `opacity`, `blink`,
    `image` (foto alternativa); vince la prima che vale;
  - **animazione** (una per pezzo): `rotate` (spin o per valore), `oscillate`, `vibrate`, `pulse`, `fill`
    (finestra + verso), `move` (spostamento per valore); `scroll` e gli effetti difficili più avanti.
- **Compilazione** (Rust, `sws-core/src/symbol_def.rs`, nuovo): `SymbolDef` → SVG a strati nel formato rigido che
  web e LVGL già sanno dividere (`<g id data-layer>` uno per riga), più una voce di manifesto con `inputs`, `pieces`
  e `images` (`#[serde(default)]`, così i pannelli vecchi ignorano). Le immagini **non** finiscono dentro l'SVG: sono
  strati a parte, disegnati dai motori in modo nativo.
- **Sicurezza**: liste bianche come `free_symbol.rs` (elementi, attributi, niente `href` esterni, niente script/stile),
  limiti di misura (elementi, byte, lato) e per le immagini (formato, pixel, MB).
- **Valutatore condiviso**: `sws-core/src/symbol_behaviour.rs` + gemello `sws-editor/src/symbols/def/behaviour.ts`,
  fixture `tests/fixtures/symbol-pieces.json` (valori degli ingressi, t_ms → colore, visibile, opacità, angolo,
  spostamento, riempimento, immagine). Solo curve lineari/triangolo/gradino.
- **In pagina**: oggetto `symbol` con `symbol: "sym:<slug>"` e nuovo campo `symbol_inputs:
  Record<input, {tag?: string, value?: any, min?, max?}>` (tag **o** valore fisso). Specchi: `types/index.ts`,
  `synoptic.rs`, `model.rs`, `synoptic_schema.rs`, `validate.rs`, `collectTagIds.ts`, `slotTag.ts`, rinomina dei tag.
  **Una sezione per dato**: per un `sym:` il pannello mostra solo «Ingressi» (uno per riga: tag oppure valore), e
  nasconde Stato, Rotazione, Parti, livello.

## Rendering
- **Web** (nuovo `symbols/def/SymbolDefSvg.tsx`, riusato da canvas, viewer ed editor — WYSIWYG): `<image>` per le foto,
  `<g>` per i pezzi con `transformOrigin` = ancoraggio, keyframe nuovi `sws-osc`, `sws-vib`, `sws-pulse` accanto a quelli
  di `SvgCanvas.tsx` (~2049). Animazioni a tempo solo con `!isEditMode || previewEffects`; `data-anim` per
  `prefers-reduced-motion`.
- **LVGL** (`sws-lvgl-viewer`): strati vettoriali come oggi (resvg → `lv_canvas`, `simbolo_lib.rs`); **le foto con il
  decodificatore degli sfondi di pagina** (il runtime prepara la variante alla misura dell'oggetto, come
  `sfondi-alla-misura`); spin e oscillazione a fotogrammi con perno (come `RotoreLib`, budget), rotazione per valore con
  `transform_angle` (come `PernoLib`), vibrazione con `set_pos`, opacità/visibile/lampeggio con `img_opa`, riempimento
  generalizzato da `LivelloLib`, colore con la cache generalizzata da `CacheCorpo`. Budget di memoria **per pagina**,
  fissato misurando sul TY570. Misure M2 già note (WP630): fotogrammi 0,88 ms, `transform_angle` 1,77 ms.
- **Testo** (ingressi `text`): resvg sul pannello non ha font → il testo si disegna come etichetta LVGL sopra il simbolo,
  non dentro l'SVG. Da confermare in fase 4.

## L'editor
Spazio di lavoro a tutto schermo, `sws-editor/src/symbols/editor/`, stato `symbolEditor` nello store, **annulla
locale**. Si apre da Strumenti ▸ Simboli (`LeftPanel.tsx`, `RamoSimboli`: «+ Nuovo», «Modifica» sui `sym:`,
«Duplica nell'editor» su `lib:`/`prj:`/`custom:`) e da «Modifica simbolo» nel pannello proprietà.
- **Scheda Struttura**: nome, categoria, misura, ingressi (aggiungi, tipo, default, intervallo, unità, opzioni),
  attacchi dei tubi.
- **Scheda Grafica**, con gli **strumenti**: seleziona/sposta/ridimensiona/ruota, rettangolo, ellisse, linea, polilinea,
  tracciato con modifica dei nodi, immagine; riempimento/contorno/gradiente col selettore colori o un materiale; ordine,
  raggruppa/separa, allinea e distribuisci, griglia e calamita, zoom; albero degli elementi a sinistra.
  - **Importa SVG** (file o incolla): ripulito ed esploso in elementi e gruppi, colori suoi.
  - **Importa foto** (PNG/JPG/WebP) come sfondo o come ritaglio-pezzo.
  - **Duplica dalla libreria**: la descrizione del `lib:` (`tests/fixtures/simboli-descrizioni.json`, servita con
    `include_str!` da `GET /api/simboli/library/{family}/{slug}/description`) compilata e importata con `mat`/`shade`
    intatti (segue lo stile di progetto). Le due violazioni note della libreria si correggono nella copia.
- **Scheda Comportamento**: «Fai un pezzo» da una selezione, croce dell'ancoraggio trascinabile, regole per ingresso,
  animazione dal menù con i suoi parametri.
- **Anteprima**: un controllo per ingresso (interruttore, cursore, menù, testo) che pilota il simbolo; «Anima» accende
  le animazioni a tempo.
- **Genera con l'IA** (pannello dedicato nell'editor): «disegna» → SVG (strada `free_symbol`/`custom:` dell'assistente,
  ora importato esploso), «foto» → immagine (lo scopo «Sfondi» con FLUX.2, già c'è), «modifica» → l'IA riceve il
  `SymbolDef` aperto e restituisce la versione nuova, mostrata nell'editor prima di accettare.
- **File**: «Esporta» scarica un pacchetto `<slug>.swsym` (zip: `symbol.yaml` + immagini); «Importa» lo legge.
- **Libreria personale/aziendale**: nel cloud per account o azienda, nell'IDE locale una cartella accanto ai progetti;
  i simboli salvati lì compaiono in tutti i progetti come famiglia a parte e si copiano nel progetto all'uso (il
  pannello non dipende dalla libreria). Le domande sul cloud (chi vede cosa, azienda) si chiariscono a inizio fase 7.
- Salvataggio con rotte nuove `GET/PUT /api/project/symbols/<slug>` (versionate come le altre), anteprima con
  `POST /api/symbols/compile`. «Usato da N oggetti» visibile. Testi in `i18n/{it,en}.json` sotto `symbolEditor.*`.

## Fasi (un ramo per fase, annidati se il collaudo arriva dopo)
| # | Ramo | Cosa provi alla fine |
|---|---|---|
| 1 | `feat/symbol-def` | formato `sym:` e rotte; editor con **Struttura** (ingressi e tipi) e grafica minima (rettangolo, ellisse, colore); salva; in pagina il pannello «Ingressi» con tag o valore; si vede su web e LVGL; export/import `.swsym` |
| 2 | `feat/symbol-editor-tools` | gli strumenti grafici completi (tracciati e nodi, gruppi, allinea, gradienti, griglia), annulla; **Importa SVG** esploso; **Duplica dalla libreria** |
| 3 | `feat/symbol-photo` | foto di sfondo e ritagli PNG; web e LVGL (variante alla misura); prima misura di memoria sul TY570 |
| 4 | `feat/symbol-behaviour` | pezzi, ancoraggio, regole (colore, visibile, opacità, lampeggio, foto alternativa), anteprima con i controlli; uguale sul pannello; testo come etichetta LVGL |
| 5 | `feat/symbol-anim` | rotazione (continua e per valore), oscillazione, vibrazione, pulsazione, riempimento, spostamento sui due motori; «Anteprima effetti»; pagina «Laboratorio simboli» in CasaDomotica misurata sul TY570 |
| 6 | `feat/symbol-ai` | pannello IA: disegna SVG, genera foto, modifica il simbolo aperto |
| 7 | `feat/symbol-library` | libreria personale/aziendale nel cloud e nell'IDE locale |
| 8+ | `feat/symbol-fx-*` | neon, sfocatura, bollicine, fumo, fuoco: un effetto per ramo |

Ogni fase mette un esempio in CasaDomotica (regola di `CLAUDE.md`). La fase 1 è quella da cui si parte; le altre si
riverificano col maintainer prima di aprirle.

## Verifica (ogni fase)
- `cargo check`, `cargo test` (compilatore `symbol_def`, sicurezza dell'import, fixture `symbol-pieces.json`,
  `compila_come_genera_py` invariato), `pnpm build`, `pnpm exec vitest run` (riduttore dell'editor, valutatore, import
  SVG), `./scripts/check_static.sh` (dentro: `check_synoptic_schema`, `check_lvgl_parity`, `check_i18n_parita`,
  `check_libreria_simboli`).
- Pannello: `check_simboli_lvgl.sh` esteso ai `sym:` con fixture in `tests/fixtures/symbols/`; dalla fase 3 misura sul
  TY570 (`SWS_MISURA_SIMBOLI=1`, `SWS_TEMPI_LOG=1`, `VmRSS`). SSH sul TY solo chiedendo.
- Conferma del maintainer con `/test-changes`, poi squash merge e ramo eliminato.

## Rischi
- Le foto pesano sui pannelli piccoli: variante alla misura dell'oggetto, limiti di pixel, budget per pagina.
- Un SVG importato può essere enorme o ostile: liste bianche e limiti, come `free_symbol.rs`.
- Colori propri vs stile di progetto: un `sym:` con colori suoi non segue ISA-101/volume — va detto nell'editor.
- Tre formati di simbolo convivono (`lib:`, `prj:`, `custom:`) più `sym:`: la galleria li deve tenere distinti.
- Gli strumenti grafici sono tanti: la fase 2 è la più lunga e può spezzarsi in due rami.
- Modificare un simbolo cambia tutti gli oggetti che lo usano.
