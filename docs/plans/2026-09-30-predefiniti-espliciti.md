# Predefiniti espliciti: il pannello dice il valore vero, web e LVGL lo applicano uguale

## Context

Il maintainer (30-09-2026 sera): un `data_log` è scuro nell'editor e **bianco sul pannello**; il campo
sfondo mostra solo il segnaposto `#0f172a`. Verificato: il web ripiega su `#0f172a`
(`SvgCanvas.tsx` ramo `data_log`), `render_data_log` (`lvgl_render.rs:6804`) **non legge affatto
`bg_color`** → tema LVGL bianco. Il difetto è doppio: l'IDE non scrive/mostra il valore, e LVGL
ignora il campo. Stesso per `label` («prende un valore ma vedo solo il campo grigio»).

Analisi a tappeto (tre ricerche) — il pannello inganna in tre modi:
- **segnaposto grigio che non è il ripiego vero** (label: gauge/setpoint/radio/data_log «Gauge»…
  che nessuno disegna; checkbox: web `""`, LVGL «Checkbox»; kpi_tile: in realtà il nome del tag);
- **numeri mostrati come valori salvati** (`numInput` mostra il ripiego in testo normale): trend/xy
  y 0/100 mentre i motori si adattano ai dati;
- **colori**: `bg_color` mostra sempre `*`=#0f172a anche dove il web è trasparente; ~25 coppie
  tipo×colore divergono, 17 perché LVGL ignora il campo.

Fuori dai colori **non esiste una tabella dei predefiniti**: ogni ripiego è un letterale nel codice
di ciascun motore, ed è da lì che nascono le divergenze. Le guardie attuali (`check_colori.sh`,
test della tabella colori) non possono vederle.

**Decisioni del maintainer (30-09-2026):**
1. Colori **auto** (testo, linee, bordo rect, tubo, colore navbutton/gauge): restano auto nel file,
   ma il campo lo **dichiara** — badge «auto» + colore risultante in chiaro; un clic lo fissa.
2. Predefiniti fissi scritti **nel file**, anche nei progetti esistenti: riempiti all'apertura.
3. «Vuoto» con significato proprio (range Y = adatta ai dati, label kpi = nome del tag, label vuota
   = nessuna etichetta): **stato esplicito** nel campo, niente numeri o segnaposto finti.
4. **A fasi, IDE prima**; poi i campi ignorati da LVGL, a gruppi.

## Primo passo all'approvazione

Scrivere questo piano in `docs/plans/2026-09-30-predefiniti-espliciti.md` + riga in
`docs/plans/README.md` («piano a fasi, in corso»). Ramo: **annidato** su `fix/sfondi-predefiniti-colore`
(ancora da collaudare, stessa area) → `feat/predefiniti-espliciti`; le fasi 2-3 annidate in coda,
collaudo del maintainer a fine di ogni fase. Editor rilanciato da me dopo ogni cambio di codice.

## Fase 1 — Tabella unica e pannello onesto (IDE)

1. **Fixture `tests/fixtures/predefiniti-campi.json`** (stesso schema a fonte unica dei colori): per
   tipo×campo non-colore o `{ "valore": … }` (fisso) o `{ "vuoto": "adatta" | "nome_tag" |
   "nessuna" | "trasparente" … }` (stato voluto). I colori restano in `colori-predefiniti.json`, che
   si corregge dove mente: `bg_color` per tipo (data_log/xy/bar/pie #0f172a, kpi_tile/table/
   alarm_history/progress #1e293b come il web; «trasparente» per text/gauge/led/…);
   `text_list_default_color` creazione (#ef4444) vs tabella (#94a3b8) allineate.
   Valori di riferimento = **quelli del web** (è il WYSIWYG): checkbox label `""`, navbutton senza
   «> », `lang_button` «LANG»… Mirror TS `sws-editor/src/predefinitiCampi.ts` (come
   `coloriPredefiniti.ts`) e Rust nel viewer (come `mod colori_predefiniti`, `TABELLA`), con test
   che confrontano le due con la fixture.
2. **Creazione** (`editor/oggettiNuovi.ts`): scrive tutti i predefiniti fissi dalle due tabelle
   (niente più letterali inline, es. `#4a90d9` di rect/ellipse).
3. **Apertura**: nuovo passo idempotente `riempiPredefiniti(obj)` nella catena di `setPages`
   (`store/index.ts:1170-1183`, accanto a `normalizeTrendObjects`/`normalizzaColoriOggetti`): solo i
   campi fissi mancanti, solo per i tipi che li usano; gli auto e i «vuoto voluto» restano assenti.
4. **Pannello** (`editor/EditorShell.tsx`):
   - `CampoColore.tsx`: per regola auto, badge «auto» + hex risultante leggibile (non segnaposto),
     clic sullo swatch/«fissa» lo scrive; senza regola né valore → stato «nessuno» dichiarato.
   - `numInput`/`textInput`/`CampoTestoTradotto`: per campi con `vuoto` voluto, stato esplicito
     («Auto — adatta ai dati», «Nome del tag», «Nessuna etichetta») con azione per impostare un
     valore; via i segnaposto che mentono (Gauge/Setpoint/Radio/Data log/KPI/Bottone…).
   - Range Y di trend/sparkline/xy: «Auto» esplicito invece di 0/100.
   - `slider`: aggiungere il campo `label` che il web già disegna (regola UI 2 rispettata).
5. **Web**: i ripieghi `?? letterale` dei campi in tabella passano da `predefinito()`/tabella campi
   (così un valore mancante in un file non ancora riaperto resta coerente).
6. **Guardia** `scripts/check_predefiniti.sh` in `check_static.sh`: fixture = TS = Rust; nessun
   `?? letterale` nei renderer web per campi in tabella; `oggettiNuovi.ts` scrive ogni fisso.
   Inventario `tests/fixtures/campiPannelloProprieta.json` aggiornato (slider label).

## Fase 2 — LVGL: colori e sfondi ignorati (`lvgl_render.rs`)

`bg_color` su data_log, table, bar_chart, pie_chart, xy_plot, alarm_history, alarm_banner, traccia di
progress_bar, kpi_tile (#1e293b come web); `fill` di progress_bar/slider/checkbox/radio; `stroke` di
rect/ellipse/navbutton; gauge ago (`stroke`) e `gauge_sp_color`; `text_list` colori di ripiego;
`pie_hole_color`; gradienti rect/pipe; stati del tubo; alarm_bell. Ogni ripiego dalla `TABELLA`
Rust estesa (niente letterali: #f1f5f9, (226,232,240)…).

## Fase 3 — LVGL: campi non-colore ignorati

`label` su gauge/led/progress_bar/data_log/slider; navbutton senza «> »; gauge `decimals`,
angoli, `gauge_ticks`; **kpi_tile finestra sparkline sempre 60 s** (`render_sparkline` legge solo
`spark_window_s`, `lvgl_render.rs:4832`); xy_plot range auto; `text_list` font_size;
intestazione tabella tradotta; `lang_button` «LANG».

## Fase 4 — La tabella LVGL rifatta come quella web

Il maintainer, al collaudo della Fase 1 (30-09-2026): «l'oggetto table in LVGL è totalmente diverso
da quello che è il web». Il web usa `DataTable` (intestazioni, colonne etichetta/valore/unità/qualità,
ordinamento, filtri, sfondo, font); LVGL un `lv_table` col tema di default e solo parte dei campi.
Non è un colore da correggere ma un rifacimento, come il trend del 30-09 (disegno in proprio o
`lv_table` stilizzata cella per cella): prima un confronto a fotografie web/LVGL campo per campo,
poi la scelta della tecnica col maintainer.

## Stato

- **Fase 1** — su `feat/predefiniti-espliciti` (`1f7e4264`), **collaudata dal maintainer** il 30-09-2026.
- **Fase 2** — fatta, da collaudare sul pannello: rect (bordo, angoli, sfumatura), ellipse (contorno),
  navbutton (bordo), progress_bar (traccia e riempimento), slider (indicatore e manopola),
  checkbox/radio (spunta), gauge (niente disco bianco, ago = `stroke`), data_log e alarm_history
  (tabella scura), kpi_tile (#1e293b + bordo), bar_chart e pie_chart (riquadro), pie (foro),
  xy_plot (sfondo scuro, niente griglia), alarm_banner (trasparente, niente bordo), recipe_panel
  e alarm_bell (colore dal campo), text_list (#94a3b8 e auto come il web). 20 coppie nuove nella
  `TABELLA` Rust. **Spostati in Fase 3** perché sono funzioni mancanti, non colori: stati e
  sfumature del tubo, `gauge_sp_color` (il setpoint del gauge non esiste su LVGL), la disposizione
  del bar_chart (assi, impilate) che resta diversa dal web.

- **Fase 3** — fatta, da collaudare sul pannello: `label` su gauge/led/progress_bar/slider/data_log;
  navbutton col ▶ del web; checkbox senza «Checkbox» di ripiego; lang_button «LANG»; text_list
  (testo di ripiego → valore → «N/D», corpo 16, centrato nel riquadro); gauge (angoli, tacche come
  il web, decimali, setpoint con `gauge_sp_color`, archi da 10); kpi_tile (finestra della sparkline
  che era sempre 60 s, corpi 11/26, «—» senza valore, colore per soglia); tubo (stili tube/wire,
  tratteggio, colori di stato dal vivo, etichetta anche dal tag, spessore 8); **grafico a barre
  rifatto** come il trend (`barre.rs`, tiny-skia): verticale e orizzontale, impilato, tacche, soglie,
  legenda, scale per serie. `toFixed` come JavaScript (32,5 → 33). Poi, il 1-10-2026, anche ciò che
  era rimasto fuori: estremità (freccia, pallino, flangia) e flusso animato del tubo (`tubo.rs`), la
  variazione percentuale del kpi_tile, il titolo dell'asse Y delle barre ruotato di −90°. Da notare
  per il maintainer: il web scala le estremità per lo spessore (marker SVG in unità `strokeWidth`),
  quindi su un tubo da 10 px il pallino è largo 100 px — il pannello fa lo stesso.
- **Fase 4** — fatta, da collaudare sul pannello. Scelte del maintainer (1-10-2026): **disegno in
  proprio** (come trend e barre), con **ordinamento, filtri e celle scrivibili**; la paginazione del
  data_log no. `tabella.rs` (logica pura: righe visibili, ordinamento a tre stati, filtro «contiene»
  senza maiuscole, scorrimento col dito con l'intestazione ferma, testi tagliati coi puntini, bersagli
  del tocco) + `render_table`/`render_data_log` su canvas. Colonne da `table_columns`, intestazioni
  nella lingua dei contenuti, valore con decimali/unità/soglie per riga e colore di qualità, pallino
  della qualità, ora locale; il data_log con data e ora locali (prima UTC) e il pallino. Tastierino a
  schermo sul layer superiore (numerico per le celle, alfabetico per i filtri), grande quanto il
  display vero — e il setpoint ora usa la stessa misura (prima 800×480 fissi). Test che legge il
  sorgente: ogni coppia chiesta a `predefinito_lvgl`/`colore_campo` sta in `TABELLA` (due panici
  presi solo alla fotografia).

## Verifica (per fase)

- `cargo check`, `cargo test -p sws-lvgl-viewer`, `pnpm build`, `pnpm vitest run` (nuovi test:
  `riempiPredefiniti` idempotente e limitato ai fissi; pannello mostra badge auto / stati espliciti;
  creazione = tabella), `./scripts/check_static.sh` con la guardia nuova.
- Fasi 2-3: runtime di prova (dichiarato e terminato) con una pagina di tutti i tipi toccati, senza
  e con valori espliciti; `--istantanea` LVGL confrontata col web; `check_istantanea.sh`.
- Collaudo del maintainer: il `data_log` del suo progetto, riaperto e salvato, scuro nell'editor e
  sul pannello (dopo la fase 2; rc solo quando c'è lavoro vero da portare, regola build non sprecate).
