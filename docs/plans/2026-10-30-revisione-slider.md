# Lo slider: difetti, disegno SVG proprio, quattro stili, tacche, bande, PV, molla

**Piano d'esecuzione, approvato il 30-10-2026.** Nato da `/revisione-oggetto slider`. La tavola con le istantanee
di oggi, la matrice stili × stati × sfondo, i modi e i campi è in
[`allegati/2026-10-30-revisione-slider/tavola.html`](allegati/2026-10-30-revisione-slider/tavola.html). Lì accanto
c'è anche il progetto di prova (`progetto-di-prova/`), con nove slider su sfondo scuro e chiaro. La scheda
dell'oggetto, con i fatti misurati, è `.claude/skills/revisione-oggetto/schede/slider.md`.

## Context

La voce di `Appunti.txt`, completata dal maintainer il 30-10-2026: «L'oggetto slider va impreziosito, servono più
stili e modi di funzionamento, è un oggetto molto importante che si deve adattare a vari stili grafici, disegni di
impianti, scada di domotica e simili, per questo motivo l'aspetto grafico SVG deve permettere di scegliere molteplici
stili oltre ad avere le impostazioni delle tacche di divisione, delle tacche marcate, prevedere l'effetto di ritorno
in posizione stile molla di ritenuta».

Oggi lo slider è diverso sui due motori. Il web usa il controllo nativo del browser, che accetta solo un colore.
LVGL usa `lv_slider` coi colori del suo tema. In più ci sono una dozzina di difetti, misurati il 30-10-2026 e fotografati
nella tavola.

## Decisioni del maintainer (30-10-2026)

1. **Uso:** domotica e impianti, con **priorità alla domotica**.
2. **Web:** lo slider diventa un **disegno SVG proprio**, con puntatore, dito e tastiera gestiti a mano. Il controllo
   nativo se ne va.
3. **Stile «classico»:** uno solo per i due motori, **quello LVGL di oggi** (traccia piena di 16 px, cursore tondo,
   valore sotto e centrato). Sul web l'aspetto dei progetti esistenti cambia un po': la traccia si ispessisce.
4. **Stili:** classico, pillola, piastra (domotica), ISA-101 (piatto).
5. **Modi:** bipolare, valore misurato (PV), bande e tacche, **ritorno a molla**.
6. **Tacche per passo**, nelle unità del valore («marcata ogni 10, divisione ogni 2»), con l'aggancio facoltativo.
7. **Molla:** mentre si tiene, scrive al massimo 5 volte al secondo. Al rilascio torna al riposo in 150 ms e scrive il
   riposo una volta. Se il riposo non è scritto, vale l'origine quando lo slider è bipolare, altrimenti il minimo.
8. **Icone della piastra:** 8 fisse (lampadina, tapparella, termometro, ventola, presa, volume, goccia, sole), uguali
   sui due motori.
9. **Immagine di sfondo** dietro tutto il riquadro (`bg_image`, esiste già), con un'opacità da regolare:
   `bg_image_opacity` nuovo e **universale**, più `slider_track_opacity` per la parte vuota della traccia.
10. **I difetti** sono la prima fase di questo piano, non un ramo a parte.
11. **Fuori:** l'intervallo a due cursori (in `Appunti.txt`).

## I campi nuovi

Il prefisso `slider_` segue l'uso di `gauge_ticks` e `bar_mode`. **Ogni default lascia l'aspetto di oggi**, tranne il
classico del web, che è una scelta esplicita (decisione 3).

| Campo | Tipo | Default | Fase |
|---|---|---|---|
| `slider_track_color` | colore | «auto»: segue lo sfondo della pagina | 2 |
| `slider_track_thickness` | px | dallo stile: 16 / 28 / riquadro / 6 | 2 |
| `slider_value_position` | `sotto` \| `sopra` \| `dentro` \| `cursore` | `sotto` (piastra: `dentro`) | 2 |
| `slider_style` | `classico` \| `pillola` \| `piastra` \| `isa` | assente = classico | 3 |
| `slider_icon` | uno degli 8 nomi | nessuna | 3 |
| `bg_image_opacity` | 0-100 | 100 | 3 — **universale** |
| `slider_track_opacity` | 0-100 | 100 | 3 |
| `slider_tick_major`, `slider_tick_minor` | numero, nelle unità | assente = nessuna tacca | 4 |
| `slider_tick_labels` | bool | vero se ci sono tacche marcate | 4 |
| `slider_snap_ticks` | bool | falso | 4 |
| `slider_bands` | `sempre` \| `in_allarme` \| `mai` | `mai` | 4 |
| `slider_origin` | numero | assente = dal minimo | 5 |
| `slider_pv_tag`, `slider_pv_color` | tag, colore | nessuno / auto | 5 |
| `slider_rest_value` | numero | assente = niente molla | 6 |

Si riusano col loro significato: `fill`, `unit`, `decimals`, `show_value`, `bg_color`, `bg_image`, `warn_low`,
`warn_high`, `alarm_low`, `alarm_high` (anche dai limiti della TagDef, come oggi sul web), `write_on_release`,
`write_deadband`, `read_only`, `require_confirm`, `critical`.

**Ogni campo nuovo tocca tutti questi posti**, in ogni fase che ne aggiunge uno:
- tipo TS in `sws-editor/src/types/index.ts`;
- `sws-runtime/crates/sws-web/src/synoptic.rs`: senza, una GET perde il campo;
- `sws-lvgl-viewer/src/model.rs` (guardia `check_lvgl_parity.sh`);
- schema dell'assistente, rigenerato con `./scripts/gen_synoptic_schema.py` (guardia `check_synoptic_schema.sh`);
- `CAMPI_SCALATI` in `sws-editor/src/scala/scalaPagina.ts`, se il campo è in pixel;
- default in `tests/fixtures/colori-predefiniti.json` o `predefiniti-campi.json`, e le loro copie;
- `sws-editor/src/editor/oggettiNuovi.ts`;
- pannello in `EditorShell.tsx`, e l'inventario `sws-editor/tests/fixtures/campiPannelloProprieta.json`;
- `i18n/it.json` e `en.json` (guardie `check_i18n_ui.sh`, `check_i18n_parita.sh`);
- gemelli `demo-items-web` / `demo-items-lvgl` (guardia `check_demo_templates.sh`);
- manuale `docs/manual/05_widget_reference.md` (guardia `check_manuale_widget.sh`);
- `CHANGELOG.md` e `NOVITA.yaml` (italiano e inglese).

## Le fasi

Un ramo per fase, uno alla volta (`CLAUDE.md`). Ogni fase finisce con qualcosa da provare sul progetto di prova degli
allegati e sui gemelli, nell'IDE e con l'istantanea LVGL (`docs/HOWTO.md` §6). **Il primo passo di ogni fase è
rimisurare** i punti che tocca: il codice si muove.

### Fase 1 — difetti e parità, senza cambiare aspetto (M)

> **Scritta il 30-10-2026** sul ramo `feat/slider-fase-1`, in attesa del collaudo del maintainer. Scelte prese
> scrivendola:
> - il bordo tratteggiato dell'attesa è sul **riquadro**, non sul cursore: l'input nativo non si lascia
>   tratteggiare. Con il disegno SVG della fase 2 passa al cursore;
> - il contorno di pagina usa una tabella `MISURA_DI_RIPIEGO` per **tutti** i tipi, non solo per lo slider: era lo
>   stesso difetto ovunque;
> - i limiti della TagDef arrivano a LVGL **dal server**, nella pagina composta (`?cornice=1`): il pannello non ha i
>   `TagDef`. Valgono per tutti i tipi, ma solo per gli oggetti della pagina, non per i figli di griglie e faceplate;
> - su LVGL il blocco etichetta-traccia-valore è centrato come la colonna del web, quindi senza etichetta la traccia
>   sale di qualche pixel rispetto a prima;
> - su LVGL **non** c'è l'attesa dopo la scrittura: il cursore torna al valore del tag finché non risponde, di solito
>   un giro. Arriva con la fase 2, insieme al cursore disegnato.
>
> Istantanee LVGL e web della pagina di prova: `sws/tmp/prova-slider/`.

- **Pannello:** la casella «Mostra valore» legge `obj.show_value !== false`, come i motori. Stesso difetto in `gauge`
  e `progress_bar`, che si correggono qui. Entrano i campi `unit` e `decimals`.
- **Web:** dopo la scrittura il cursore **resta dov'è**, col bordo tratteggiato, finché il tag non arriva o per 3 s
  (oggi `setSliderDraft(null)` lo fa saltare indietro). Un valore non numerico mostra «—», non `NaN`.
- **LVGL:**
  - range **in passi** (0..N con N = (max−min)/step, valore = min + i·step): 0..1 col passo 0,05 funziona;
  - scrittura `Float` quando passo o range non sono interi;
  - `write_on_release` (`LV_EVENT_RELEASED`) e `write_deadband`;
  - `read_only` (via `CLICKABLE`);
  - `require_confirm` e `critical` con la conferma che i bottoni hanno già (`RegolaConferma`);
  - nell'orizzontale il valore va **dentro il riquadro**, sotto la traccia e centrato, come sul web;
  - sfondo universale, `bg_color` e `bg_image`, col pezzo che disegna gli sfondi di pagina (`sfondo_del_rect`);
  - i limiti della TagDef come sul web.
- **Wrapper di pagina:** il bordo d'allarme usa la misura di ripiego del tipo, non 100 fisso.
- **Validatore:** `min < max`, `step > 0`, `write_deadband >= 0`.
- **Manuale:** la voce Slider con tutti i campi. **Gemelli:** `o_slider` con etichetta, sola lettura e passo frazionario.
- **Si prova con:** le istantanee della tavola rifatte. I cinque difetti della sezione 1 della tavola non ci sono più.

### Fase 2 — il web in SVG, uno stile classico per i due motori (M)

> **Scritta il 30-10-2026** sul ramo `feat/slider-fase-2`, annidato. Scelte prese scrivendola:
> - il colore «auto» della traccia è il **riempimento al 20 %**, non un colore calcolato dallo sfondo: è quello che
>   il tema LVGL faceva col suo blu, lascia vedere la pagina in chiaro e in scuro, e non chiede ai due motori di
>   sapere il colore della pagina;
> - il fumetto `cursore` compare mentre si trascina (e sul web anche durante l'attesa); nel verticale sta a destra
>   del cursore;
> - nell'orizzontale vale ancora la colonna centrata di prima (etichetta, traccia, valore).

- Un componente suo, `sws-editor/src/canvas/slider/`, invece del ramo dentro `SvgCanvas.tsx`:
  - geometria in una **funzione pura**, testata senza DOM;
  - disegno in SVG;
  - **Pointer Events** con `setPointerCapture`, per mouse, dito e penna; `touch-action:none`;
  - area di tocco = tutto il riquadro, con almeno 44 px di spessore;
  - **tastiera:** `tabindex`, `role="slider"`, `aria-value*`. Frecce = un passo, PagSu/PagGiù = una tacca marcata o
    il 10 %, Home/Fine = estremi. Anello di focus visibile;
  - in edit lo stesso disegno con `pointerEvents:"none"` e hit-rect (WYSIWYG).
- **Classico** = LVGL di oggi: traccia 16 px arrotondata, cursore tondo, riempimento `fill`, traccia
  `slider_track_color` «auto». Su LVGL gli stessi colori, ma nostri e non del tema: parti `MAIN`, `INDICATOR`, `KNOB`.
- Campi: `slider_track_color`, `slider_track_thickness`, `slider_value_position` (`cursore` = fumetto sopra il
  cursore mentre si trascina).
- Il gestore del puntatore si scrive **riusabile**, perché servirà al bottone. Il bottone però non si tocca qui.
- **Si prova con:** un pannello touch (WP630, viewer web) e la tastiera nell'IDE. Le due istantanee della pagina di
  prova devono coincidere.

### Fase 3 — pillola, piastra, ISA-101, e l'immagine in trasparenza (M)

- `slider_style`, con gli stati della matrice della tavola:
  - **pillola:** traccia spessa, cursore dentro la traccia;
  - **piastra:** la traccia è il riquadro, niente cursore, si trascina ovunque; etichetta, valore e icona dentro;
  - **ISA-101:** traccia grigia sottile, cursore rettangolare, nessun colore acceso.
- `slider_icon`: le 8 icone in SVG. Su LVGL sono rasterizzate una volta con resvg, come il corpo del tubo.
- `bg_image_opacity` (**universale**: il `bgLayer` del web, e su LVGL gli sfondi che il motore già disegna) e
  `slider_track_opacity`.
- **Fallback LVGL dichiarati:** niente ombre né gradienti; il cursore ISA è un `KNOB` con raggio 2.
- **Si prova con:** la matrice della tavola rifatta coi due motori veri, sfondo scuro e chiaro.

### Fase 4 — tacche e bande (M)

- `slider_tick_major`, `slider_tick_minor`, `slider_tick_labels`, `slider_snap_ticks`.
- `slider_bands` con i quattro limiti.
- LVGL con `lv_line` ed etichette a mano, non `lv_meter`, che è circolare. Le bande sono rettangoli sotto la traccia.
- **Si prova con:** una scala 0..100 con marcata ogni 10 e divisione ogni 2; aggancio acceso e spento; bande dai limiti
  della TagDef.

### Fase 5 — bipolare e valore misurato (S)

- `slider_origin`: il riempimento parte dall'origine, con una linea sull'origine.
- `slider_pv_tag`, `slider_pv_color`: un triangolino sulla traccia, come la lancetta SP del gauge al contrario, e il
  PV accanto al valore.
- **Si prova con:** un termostato 15..30 con PV su un tag a rampa; un offset −50..50.

### Fase 6 — ritorno a molla (S)

- `slider_rest_value`, con le regole della decisione 7. Su LVGL l'animazione è un `lv_anim` di 150 ms.
- Il validatore segnala come **errore** la molla insieme a conferma o comando critico: una conferma a ogni scrittura
  renderebbe la leva inutilizzabile.
- **Si prova con:** un jog bipolare: nel log del runtime, le scritture mentre si tiene e lo zero al rilascio.

### Fase 7 — CasaDomotica (S)

- Luci e tapparelle in piastra, un termostato con PV (regola di `CLAUDE.md`), quando lo slider nuovo entra in `main`.
- Il progetto sta sul VPS: si fa dal cloud, col maintainer.

## Fuori da questo piano

- **Seme** [uno stile grafico di progetto per tutti gli oggetti](2026-10-30-stile-grafico-di-progetto.md): qui lo
  stile è per oggetto.
- **Seme** [lo stato «in attesa» per tutte le scritture](2026-10-30-in-attesa-per-tutte-le-scritture.md): lo slider
  ha il suo in fase 1.
- **Appunti:** l'intervallo a due cursori.
- Il bottone col gestore del puntatore nuovo.

## Verifica

Per ogni fase, la *definition of done* di `CLAUDE.md`: `cargo check`, `cargo test`, `pnpm build`,
`pnpm exec vitest run`, `./scripts/check_static.sh` e la conferma del maintainer a schermo. In più:
- vitest sulla geometria pura del componente: posizione del cursore, passi, aggancio, origine, molla;
- test LVGL sulla conversione in passi e sul tipo del valore scritto;
- istantanee LVGL della pagina di prova, confrontate con la tavola.
