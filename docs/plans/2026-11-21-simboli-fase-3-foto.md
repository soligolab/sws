# Editor dei simboli, fase 3 — le foto nei simboli — piano

> Sessione di plan del 21-11-2026 (sera), sul «gruppo 2» scelto dal maintainer: fasi 3, 7, 8 dell'[editor dei
> simboli](2026-11-18-editor-dei-simboli.md) e P6 del [piano prima fascia](2026-10-15-piano-prima-fascia-e-cra.md), in
> quest'ordine: **3 → 7 → P6 → 8**. Un ramo alla volta, annidati su `feat/project-lock` finché gli otto rami del 20 e
> 21-11 aspettano il collaudo. Piani gemelli: [fase 7](2026-11-21-simboli-fase-7-libreria-aziendale.md),
> [P6](2026-11-21-p6-2fa-e-ldap.md), [fase 8](2026-11-21-simboli-fase-8-effetti.md).

Ramo: **`feat/symbol-photo`**.

## Decisioni del maintainer (21-11-2026)
1. **Si estende la descrizione `prj:`**, niente formato `sym:`. Le fasi 1-2 hanno lavorato sulle descrizioni, e il
   formato nuovo era rimandato «a quando servono le foto»: un formato solo tiene vivi editor, IA, import SVG e
   `.swsym`.
2. **Le foto stanno in `images/` del progetto**: la stessa libreria delle immagini delle pagine (caricamento,
   ottimizzazione, deploy, backup già fatti). Una foto si riusa in più simboli.
3. Servono tutte e quattro: **sfondo fotografico**, **ritagli PNG nelle parti vive**, **foto alternativa per stato**,
   **«Genera foto» con l'IA**.

## Cosa c'era il 21-11-2026
- `sws-core/src/simboli_prj.rs`: `Descrizione` (riga 416) con `ops: Vec<Op>`; nessuna operazione raster. Gli strati
  si aprono con `statico`, `corpo`, `parte` e le forme finiscono nello strato aperto; `Costruzione::svg()` scrive
  `<g id data-layer>` uno per riga, che web e LVGL dividono.
- Sfondi delle pagine: `POST /api/project/images/:name` (5 MB), `images/` del progetto, la variante alla misura in
  `sws-web/src/sized_image.rs` (JPEG «cover», solo jpg/png), sul pannello `sfondo_del_rect` in `lvgl_render.rs` con
  zune-jpeg o resvg (`raster-images`: PNG, JPEG, GIF, WebP).
- Scopo IA «Sfondi» (`ai/immagini.rs`, FLUX in `ai/bfl.rs`) raggiungibile solo dalla chat.
- `.swsym` è JSON (`symbols/editor/symbolFile.ts`), il lettore rifiuta `PK` come «formato più nuovo»;
  `importSvg.ts` scarta `<image>` con un avviso.

## Formato
- **`Op::Image { src, x, y, w, h, opacity? }`**: `src` è un nome di file in `images/` (png, jpg, webp; niente URL,
  niente percorsi). Come ogni operazione finisce nello strato aperto: dopo `statico`/`corpo` fa da **sfondo**, dopo
  `parte rotor|slide|lamp|vibrate|pulse` è un **ritaglio** che gira, si sposta, lampeggia con la parte. Il colore per
  stato del corpo tocca solo i vettori, non le immagini.
- **Parte nuova `photo_switch`**, geo `{ input, entries: [{ is, value?, src }] }`: mostra la foto della prima voce che
  vale. Le condizioni sono quelle del valutatore condiviso (`sws-core/src/symbol_behaviour.rs` e
  `sws-editor/src/symbols/lib/behaviour.ts`), con casi nuovi in `tests/fixtures/symbol-pieces.json`.
- **Compilazione**: l'immagine esce nello strato come `<image data-src="<nome>" x y width height/>` senza `href`; la
  voce di manifesto elenca `images[]`. Limiti: 8 immagini per simbolo, ognuna entro `MAX_IMAGE_BYTES`.
- **Specchi**: tipi TS (`DescrizioneSimbolo`, `symbols/editor/model.ts`), `synoptic_schema.rs` rigenerato,
  `validate.rs` (foto mancante → avviso col nome del simbolo), rinomina e cancellazione di un'immagine in `images/` che
  avvisano «usata da N simboli».

## Rendering
- **Web**: `SimboloLibSvg` (`symbols/lib/SimboloLib.tsx`) risolve `data-src` con lo stesso fetch col token di
  `canvas/ImmagineSvg.tsx` (blob URL, cache condivisa). Canvas, viewer ed editor usano lo stesso componente: WYSIWYG.
- **LVGL** (`sws-lvgl-viewer/src/simbolo_lib.rs`): prima di `rasterizza`, ogni `<image data-src>` riceve
  `href=data:` coi byte della variante alla misura dello strato. `sized_image.rs` impara `fit=contain` e l'uscita PNG
  per le sorgenti PNG (il JPEG «cover» di oggi perderebbe la trasparenza dei ritagli); il WebP resta com'è, resvg lo
  decodifica. `photo_switch` è un fotogramma per voce, mostrato e nascosto come le spie. I ritagli dentro un rotore
  entrano nel budget dei fotogrammi che c'è già (`ANIM_BUDGET_DEFAULT`). Fixture nuove in `check_simboli_lvgl.sh`.

## Editor
- Scheda Pezzo: **«Immagine…»** (dalla libreria `images/` o caricata, con `images/optimize.ts`), spostata e
  ridimensionata come le forme.
- Parte **«Foto per stato»**: le voci con la condizione e la loro foto, provate nella scheda Prova.
- `importSvg.ts`: un `<image>` con `href=data:` non si scarta più, si carica in `images/` e diventa un'operazione.
- **IA**: in `AiPanel` «Genera foto» chiama una rotta nuova `POST /api/symbols/ai/photo`, che usa lo scopo Sfondi
  (`ai/immagini.rs`) alla misura del simbolo. La foto va in `images/` e diventa sfondo o ritaglio. Con OpenAI si
  chiede lo sfondo trasparente; FLUX non lo dà, e il pannello lo dice.
- **`.swsym`**: quando il simbolo ha foto diventa uno zip (`symbol.json` + le immagini), con `fflate` (dipendenza
  nuova, piccola); il lettore apre i file `PK` che oggi rifiuta. Senza foto resta il JSON di oggi.

## CasaDomotica e misure
- Un simbolo con foto in una pagina di CasaDomotica (per esempio la caldaia fotografata, con la spia della fiamma e il
  livello disegnati sopra).
- Memoria sul TY570 con `SWS_MISURA_SIMBOLI=1` e `VmRSS`: SSH solo chiedendo.

## Verifica
`cargo test` (compilatore con immagini e `photo_switch`, fixture del valutatore, `compila_come_genera_py` invariato,
`sized_image` con `fit=contain` e PNG), `pnpm exec vitest run` (modello, import SVG con immagini, `.swsym` zip),
`pnpm build`, `./scripts/check_static.sh`; poi `/test-changes`.

## Com'è andata (22-11-2026, notte)
Fatto sul ramo, definition of done da completare con la conferma del maintainer. Tre scostamenti dal testo sopra:
- **la «foto per stato» non è un tipo di parte nuovo**: è un campo `image` nelle voci del segnale (`SignalEntry`), che
  aveva già valore, intervallo, colore, lampeggio e nascosto. Stesso valutatore, niente `photo_switch`;
- **`check_simboli_lvgl.sh` non è esteso**: la prova sul pannello è un test del viewer
  (`photos_are_drawn_and_a_signal_swaps_them`), che senza un runtime vero non ha bisogno delle immagini sul disco;
- **due cose in più, nate facendo**: il deploy si ferma verso un pannello che non dichiara `symbol_photos` in
  `/api/system` (un runtime vecchio non riuscirebbe a leggere `project.yaml`), e `Op::Unknown` rende tollerante il
  formato per le prossime operazioni. Trovato anche un difetto di usvg 0.45 sul riquadro delle immagini, aggirato in
  `svg_raster::ingombro`.
