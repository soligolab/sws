//! Mirror dello schema `SynopticObject`/`SynopticPage` per il motore LVGL.
//!
//! **Dal 2026-08-26 è un mirror COMPLETO**: dichiara tutti i 238 campi di
//! `sws-web/src/synoptic.rs`, che resta la definizione autorevole. Prima ne
//! conosceva 101, e i restanti 137 venivano scartati in silenzio da serde —
//! un oggetto che li usava si disegnava sbagliato senza che niente lo
//! segnalasse. È già costato caro: la migrazione a `trend_tags[]` della 2.1.0
//! lasciò i trend del pannello a disegnare grafici vuoti per settimane.
//!
//! `scripts/check_lvgl_parity.sh` confronta le due struct e **fallisce** se il
//! web aggiunge un campo e questo file resta indietro. È il controllo che
//! sarebbe servito allora.
//!
//! ## Dichiarato non vuol dire disegnato
//!
//! Conoscere un campo e renderlo sono due cose diverse, e vanno tenute
//! distinte anche nel modo di parlarne:
//!
//! * **conosciuto** — il valore attraversa il modello intero, quindi
//!   sopravvive a un round-trip e può essere reso quando qualcuno lo
//!   implementerà. Lo garantisce il controllo di parità;
//! * **reso** — esiste il codice nel `render_*` corrispondente. Dove LVGL non
//!   ha un equivalente (SVG, gradienti, tipografia arbitraria) il limite è
//!   scritto accanto al campo: un gap dichiarato, non un difetto muto.
//!
//! Il parser resta deliberatamente tollerante (`#[serde(default)]` ovunque):
//! un campo che NESSUNO dei due conosce non deve far fallire l'apertura di una
//! pagina, altrimenti un pannello non aggiornato smetterebbe di aprire i
//! progetti salvati da un IDE più recente.
//!
//! Vedi ADR 0002 ("duplicazione accettata") per il perché di un mirror
//! separato invece di un tipo condiviso.

use serde::Deserialize;

// width/height determinano la risoluzione del display LVGL, letti dalla
// PRIMA pagina caricata in una sessione (vedi lvgl_render::resolve_resolution)
// — un display fisico reale non cambia risoluzione a ogni cambio pagina,
// quindi le pagine successive raggiunte per navigazione la ereditano anche se
// il loro campo width/height dicesse altro.
#[derive(Debug, Deserialize)]
pub struct SynopticPage {
    /// Identificatore stabile della pagina — quello a cui puntano i
    /// `navbutton.target_page` (**non** il nome file: `GET /api/synoptics/:name`
    /// risolve per nome file, i navbutton per `id`, sono cose diverse anche
    /// se spesso coincidono per abitudine — vedi `client::resolve_page_by_id`).
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub objects: Vec<SynopticObject>,
}

/// Valore grezzo di `on_value`: in TS è `boolean | string`. Confrontato con
/// il valore live del tag secondo la stessa logica di `SvgCanvas.tsx` (riga
/// ~2637): se booleano, confronto booleano; altrimenti confronto stringa.
#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum OnValue {
    Bool(bool),
    Str(String),
}

// stroke/color/font_size/text_color_by_threshold: letti per completezza dello
// schema ma non ancora disegnati (styling di dettaglio rimandato oltre l'MVP
// dei 5 tipi widget — vedi commento in lvgl_render::render_text).
#[allow(dead_code)]
#[derive(Debug, Deserialize, Default, Clone)]
pub struct SynopticObject {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub obj_type: Option<String>,

    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,

    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub color: Option<String>,

    pub tag: Option<String>,
    pub visible: Option<bool>,
    pub visible_tag: Option<String>,

    /// F2 — binding generici proprietà→tag: `{ "x": "slideX" }`, oppure
    /// `{ "x": {tag, in_min, in_max, out_min, out_max, clamp} }`, oppure
    /// `{ "x": {expr} }`. Il runtime non li interpreta, li serve così come
    /// sono (vedi `sws-web/src/synoptic.rs`), quindi il valore resta opaco
    /// anche qui e lo risolve `lvgl_render::resolve_binding_value`.
    ///
    /// Mancava del tutto fino al 2026-08-24: un'ellisse con
    /// `bindings: {x: "slideX"}` su LVGL restava immobile mentre sul web
    /// seguiva lo slider — visto sul pannello, non dedotto.
    pub bindings: Option<std::collections::HashMap<String, serde_json::Value>>,

    // ── text ──
    pub text: Option<String>,
    pub format: Option<String>,
    pub font_size: Option<f64>,
    pub text_color_by_threshold: Option<bool>,
    pub alarm_low: Option<f64>,
    pub warn_low: Option<f64>,
    pub warn_high: Option<f64>,
    pub alarm_high: Option<f64>,

    // ── button ──
    pub label: Option<String>,
    /// Valore scritto sul tag al click, come in `SvgCanvas.tsx`
    /// (`onWriteTag(obj.tag, obj.write_value ?? true)`) — un bottone LVGL
    /// segue la stessa semantica del bottone web, non un contatore o altro
    /// comportamento inventato apposta per LVGL.
    pub write_value: Option<serde_json::Value>,

    // ── checkbox / radio ──
    /// Valore che rappresenta lo stato "checked" (default `true`, come
    /// `SvgCanvas.tsx`: `obj.checked_value ?? true`) — confrontato per
    /// stringa col valore del tag, non un booleano fisso: un progetto può
    /// usare `"ON"`/`"OFF"` invece di `true`/`false`.
    pub checked_value: Option<serde_json::Value>,
    /// Valore scritto sul tag quando l'utente deseleziona (default `false`,
    /// `obj.unchecked_value ?? false`).
    pub unchecked_value: Option<serde_json::Value>,

    // ── led ──
    pub on_value: Option<OnValue>,
    pub on_color: Option<String>,
    pub off_color: Option<String>,

    // ── slider / gauge ──
    pub min: Option<f64>,
    pub max: Option<f64>,

    // ── gauge ──
    pub unit: Option<String>,

    // ── line ──
    pub x2: Option<f64>,
    pub y2: Option<f64>,
    pub stroke_width: Option<f64>,

    // ── state_lamp ── (stesso modello dati di text_list: value→label→color)
    pub text_list_entries: Option<Vec<TextListEntry>>,
    pub text_list_default: Option<String>,
    pub text_list_default_color: Option<String>,

    // ── table ──
    pub table_rows: Option<Vec<TableRow>>,

    // ── navbutton ──
    pub target_page: Option<String>,

    // ── trend ──
    /// Secondi di storico visibili nella finestra (default 60, come
    /// `SvgCanvas.tsx`/`TrendCanvas`).
    pub window_s: Option<f64>,
    /// Range Y fisso quando entrambi impostati; autofit sui dati ricevuti
    /// quando assenti (stessa semantica di `TrendCanvas`, non un default
    /// arbitrario).
    pub y_min: Option<f64>,
    pub y_max: Option<f64>,
    /// Colore della serie 0 — fallback legacy quando
    /// `trend_series_styles[0].color` non è impostato (stessa precedenza di
    /// `resolveSeriesColor()` in `TrendCanvas.tsx`).
    pub line_color: Option<String>,
    /// Tag aggiuntivi sovrapposti sullo stesso trend (serie 1, 2, ...).
    pub extra_tags: Option<Vec<String>>,
    /// Backfill dallo storico OPC-UA, solo al primo poll — passthrough del
    /// parametro querystring `backfill` di `GET /api/history/:tag`.
    pub opcua_backfill: Option<bool>,
    /// Solo `color` è onorato da `render_trend`; `width`/`dash`/`fill`/
    /// `fill_opacity`/`smooth` esistono nello schema web ma non hanno
    /// equivalente disegnato qui — gap dichiarato (non un nome mancante),
    /// stesso principio di tolleranza silenziosa di serde spiegato in cima
    /// al file: un campo non dichiarato qui viene ignorato, non genera
    /// errori di parsing.
    pub trend_series_styles: Option<Vec<TrendSeriesStyle>>,
    /// Tracce del trend nel formato introdotto dalla 2.1.0, che ha unificato
    /// tag e stile in un elenco solo. La migrazione riscrive le pagine al primo
    /// salvataggio, quindi su un progetto aggiornato `tag`/`extra_tags` non ci
    /// sono più: questo motore continuava a cercarle lì, e i trend disegnavano
    /// un grafico **vuoto**. Non una rifinitura mancante — una regressione.
    ///
    /// `tag` + `extra_tags` restano come ripiego per i progetti non ancora
    /// migrati, che sono esattamente quelli che girano sui dispositivi in
    /// servizio finché nessuno li riapre nell'IDE.
    pub trend_tags: Option<Vec<TrendTrace>>,

    // ── alarm_viewer ──
    pub alarm_viewer_max_rows: Option<f64>,
    /// Severità ammesse (`"Info"`/`"Warning"`/`"Critical"`, i nomi delle
    /// varianti Rust di `AlarmSeverity` — nessun `#[serde(rename_all)]` lato
    /// server, verificato prima di assumerlo); assente o vuoto = tutte.
    pub alarm_viewer_severities: Option<Vec<String>>,
    pub alarm_viewer_id_prefix: Option<String>,
    pub alarm_viewer_show_ack: Option<bool>,
    pub alarm_viewer_show_ts: Option<bool>,
    pub alarm_viewer_show_empty: Option<bool>,
    /// Solo `"list"` (il default web) è disegnato — `"banner"`/`"table"`
    /// vengono segnalati come non supportati invece di renderizzare qualcosa
    /// di diverso da quanto configurato, vedi `render_alarm_viewer`.
    pub alarm_viewer_mode: Option<String>,
    pub alarm_viewer_bg_color: Option<String>,

    // ── alarm_banner (riusa SharedAlarms già letto per alarm_viewer) ──
    pub alarm_banner_id_prefix: Option<String>,
    pub alarm_banner_severities: Option<Vec<String>>,

    // ── bar_chart ──
    pub bar_series: Option<Vec<BarChartSeries>>,
    pub bar_orientation: Option<String>,
    pub bar_gap: Option<f64>,
    pub bar_show_values: Option<bool>,
    pub bar_show_labels: Option<bool>,

    // ── sparkline ── (riusa lo stesso poller storico di trend, vedi
    // render_sparkline: una sola serie, nessuna decorazione asse/griglia)
    pub spark_window_s: Option<f64>,
    pub spark_color: Option<String>,

    // ── faceplate ── (composito di oggetti ordinari, non contiene SVG — non
    // bloccato dal vincolo che ferma `symbol`, Q15)
    pub faceplate_id: Option<String>,
    pub faceplate_params: Option<std::collections::HashMap<String, String>>,

    // ── symbol ── (solo i 17 builtin, vedi Q15 — Decided 2026-08-11, opzione B)
    pub symbol_id: Option<String>,
    pub state_tag: Option<String>,
    pub alarm_tag: Option<String>,
    pub state_off_color: Option<String>,
    pub state_on_color: Option<String>,
    pub state_alarm_color: Option<String>,

    // ── grid ── (contenitore ricorrente: ogni cella può avere un `child`
    // proprio o una `sub` — vedi render_grid, unico tipo di questo motore
    // i cui "figli" non compaiono affatto in page.objects)
    pub grid_rows: Option<f64>,
    pub grid_cols: Option<f64>,
    pub col_widths: Option<Vec<f64>>,
    pub row_heights: Option<Vec<f64>>,
    pub grid_cells: Option<Vec<GridCell>>,
    pub grid_show_borders: Option<bool>,
    pub grid_border_color: Option<String>,

    // ── lang_button ── (lang_selector non ha campi propri oltre a
    // width/height, la lista lingue viene dalla LanguageTable del progetto)
    pub target_lang: Option<String>,

    // ── pipe ── (solo routing "straight", vedi render_pipe — gap dichiarati:
    // niente gradient/marker/animazione di riempimento, fill_level colora
    // l'intera pipe invece di riempirla progressivamente)
    pub points: Option<Vec<PipePoint>>,
    pub routing: Option<String>,
    pub pipe_style: Option<String>,
    pub fill_level: Option<f64>,
    pub fill_level_tag: Option<String>,
    pub fill_level_scale: Option<String>,
    pub fill_color: Option<String>,

    // ── alarm_bell ── (badge conteggio + un solo pannello "attivi", niente
    // storico/shelve — vedi render_alarm_bell)
    pub alarm_bell_id_prefix: Option<String>,
    pub alarm_bell_severities: Option<Vec<String>>,

    // ── recipe_panel ──
    pub recipe_panel_id_prefix: Option<String>,

    // ── setpoint ──
    pub step: Option<f64>,
    pub read_only: Option<bool>,

    // ── xy_plot ──
    pub y_tag: Option<String>,
    pub xy_trail_s: Option<f64>,
    pub xy_x_min: Option<f64>,
    pub xy_x_max: Option<f64>,
    pub xy_y_min: Option<f64>,
    pub xy_y_max: Option<f64>,

    // ── pie_chart ── (solo modalità "donut", vedi render_pie_chart — "pie"
    // pieno-al-centro richiederebbe disegno custom oltre lv_canvas_draw_arc)
    pub pie_slices: Option<Vec<PieSlice>>,
    pub pie_mode: Option<String>,
    pub pie_inner_ratio: Option<f64>,

    // ══════════════════════════════════════════════════════════════════════
    // F9c — parità col mirror autorevole (`sws-web/src/synoptic.rs`)
    // ══════════════════════════════════════════════════════════════════════
    //
    // I 137 campi qui sotto erano dichiarati dal web e ASSENTI da questo
    // modello. Serde li scartava in silenzio: un oggetto che li usa si
    // disegnava sbagliato, e nessuno lo collegava alla modifica che li aveva
    // introdotti. È già costato caro una volta — la migrazione a `trend_tags[]`
    // della 2.1.0 lasciò i trend del pannello a disegnare grafici vuoti per
    // settimane.
    //
    // **Dichiarato non vuol dire disegnato.** Sono due garanzie diverse:
    //
    //   * che il campo sia conosciuto → lo verifica `scripts/check_lvgl_parity.sh`,
    //     che fallisce se il web ne aggiunge uno e questo modello resta indietro;
    //   * che il campo sia reso → si vede nel `render_*` corrispondente, e dove
    //     non c'è equivalente in LVGL è un limite noto, non un difetto muto.
    //
    // Conoscere un campo senza disegnarlo ha comunque valore: il dato
    // sopravvive al round-trip di un progetto che passa da qui, invece di
    // essere silenziosamente perso.

    // ── Trend — asse dei tempi ──
    pub trend_dt_date_order: Option<String>,
    pub trend_dt_separator: Option<String>,
    pub trend_dt_time_format: Option<String>,
    pub trend_dt_show_seconds: Option<bool>,
    pub trend_dt_show_year: Option<bool>,
    pub trend_dt_two_lines: Option<bool>,
    pub trend_dt_always_show_date: Option<bool>,

    // ── Trend — soglie, marcatori, scala ──
    pub trend_show_thresholds: Option<bool>,
    pub trend_show_alarm_markers: Option<bool>,
    pub trend_log_scale: Option<bool>,

    // ── Storico allarmi ──
    pub alarm_history_id: Option<String>,

    // ── Lista allarmi ──
    pub alarm_viewer_show_ack_all: Option<bool>,
    pub alarm_viewer_show_shelve: Option<bool>,

    // ── Campanella allarmi ──
    pub alarm_bell_sound: Option<bool>,
    pub alarm_bell_sound_severities: Option<serde_json::Value>,
    pub alarm_bell_sound_repeat_s: Option<f64>,
    pub alarm_bell_show_history: Option<bool>,
    pub alarm_bell_show_shelve: Option<bool>,

    // ── Allarmi ──
    pub alarm_shelve_minutes: Option<f64>,

    // ── Grafico a barre ──
    pub bar_mode: Option<String>,
    pub bar_ticks: Option<f64>,
    pub bar_show_legend: Option<bool>,
    pub bar_show_thresholds: Option<bool>,
    pub bar_y_label: Option<String>,

    // ── Grafico a torta ──
    pub pie_label_mode: Option<String>,
    pub pie_group_below_pct: Option<f64>,
    pub pie_group_label: Option<String>,
    pub pie_group_color: Option<String>,
    pub pie_explode_px: Option<f64>,
    pub pie_hole_color: Option<String>,
    pub pie_show_labels: Option<bool>,
    pub pie_center_text: Option<String>,
    pub pie_center_tag: Option<String>,
    pub pie_center_format: Option<String>,
    pub pie_show_legend: Option<bool>,

    // ── Griglia ──
    pub grid_color: Option<String>,
    pub grid_gap: Option<f64>,
    pub grid_padding: Option<f64>,

    // ── Indicatore analogico ──
    pub gauge_zones: Option<serde_json::Value>,
    pub gauge_ticks: Option<f64>,
    pub gauge_start_angle: Option<f64>,
    pub gauge_end_angle: Option<f64>,
    pub gauge_sp_tag: Option<String>,
    pub gauge_sp_color: Option<String>,

    // ── LED ──
    pub led_shape: Option<String>,

    // ── Tabella ──
    pub table_columns: Option<serde_json::Value>,
    pub table_sortable: Option<bool>,
    pub table_filterable: Option<bool>,
    pub table_font_size: Option<f64>,
    pub table_label_header: Option<String>,

    // ── Testo ──
    pub text_wrap: Option<bool>,
    pub text_valign: Option<String>,
    pub text_anchor: Option<String>,

    // ── Simboli ──
    pub symbol_states: Option<serde_json::Value>,
    pub symbol_spin: Option<String>,
    pub symbol_spin_tag: Option<String>,
    pub symbol_spin_s: Option<f64>,

    // ── Tubazioni ──
    pub pipe_flow: Option<bool>,
    pub pipe_flow_tag: Option<String>,
    pub pipe_gradient: Option<bool>,
    pub pipe_label: Option<String>,
    pub pipe_label_tag: Option<String>,
    pub pipe_label_format: Option<String>,
    pub pipe_label_offset: Option<f64>,

    // ── Sparkline ──
    pub spark_stroke_width: Option<f64>,
    pub spark_fill: Option<bool>,
    pub spark_fill_opacity: Option<f64>,
    pub spark_show_last: Option<bool>,

    // ── Registro dati (solo web) ──
    pub datalog_page_size: Option<f64>,

    // ── Faceplate ──
    pub faceplate_scale: Option<bool>,
    pub faceplate_overrides: Option<serde_json::Value>,

    // ── Animazione di movimento ──
    pub motion_path: Option<serde_json::Value>,
    pub motion_tag: Option<String>,
    pub motion_min: Option<f64>,
    pub motion_max: Option<f64>,
    pub motion_anchor: Option<String>,

    // ── Tipografia ──
    pub font_family: Option<String>,
    pub font_weight: Option<serde_json::Value>,
    pub font_style: Option<String>,

    // ── Riempimento ──
    pub fill_gradient: Option<String>,
    pub fill_direction: Option<String>,

    // ── Bordo ──
    pub stroke_dasharray: Option<String>,

    // ── Azioni al tocco ──
    pub on_press_fn: Option<String>,
    pub on_press_args: Option<serde_json::Value>,

    // ── Scrittura tag ──
    pub write_on_release: Option<bool>,
    pub write_deadband: Option<f64>,

    // ── Limiti ──
    pub min_role: Option<String>,
    pub min_role_effect: Option<String>,

    // ── Visibilità di parti ──
    pub show_alarm_state: Option<bool>,
    pub show_value: Option<bool>,

    // ── Aspetto e comportamento generale ──
    pub name: Option<String>,
    pub bg_color: Option<String>,
    pub bg_image: Option<String>,
    pub axis_color: Option<String>,
    pub src: Option<String>,
    pub button_mode: Option<String>,
    pub release_value: Option<serde_json::Value>,
    pub require_confirm: Option<bool>,
    pub confirm_message: Option<String>,
    pub blink_mode: Option<String>,
    pub blink_tag: Option<String>,
    pub blink_rate_ms: Option<f64>,
    pub bad_value_style: Option<String>,
    pub stale_after_s: Option<f64>,
    pub critical: Option<bool>,
    pub require_reason: Option<bool>,
    pub decimals: Option<u8>,
    pub orientation: Option<String>,
    pub options: Option<serde_json::Value>,
    pub pan_step_s: Option<f64>,
    pub corner_radius: Option<f64>,
    pub image_fit: Option<String>,
    pub line_height: Option<f64>,
    pub z_index: Option<i32>,
    pub on_release_fn: Option<String>,
    pub on_release_args: Option<serde_json::Value>,
    pub rotation: Option<f64>,
    pub flip_h: Option<bool>,
    pub flip_v: Option<bool>,
    pub opacity: Option<f64>,
    pub transition_duration_ms: Option<u64>,
    pub quality_dot: Option<bool>,
    pub quality_dot_good_color: Option<String>,
    pub quality_dot_bad_color: Option<String>,
    pub quality_dot_uncertain_color: Option<String>,
    pub locked: Option<bool>,
    pub group_id: Option<String>,
    pub button_action: Option<serde_json::Value>,
    pub gradient_light_color: Option<String>,
    pub gradient_dark_color: Option<String>,
    pub start_marker: Option<String>,
    pub end_marker: Option<String>,
    pub marker_size: Option<f64>,
    pub from_obj_id: Option<String>,
    pub from_port: Option<String>,
    pub to_obj_id: Option<String>,
    pub to_port: Option<String>,

}

/// Porta `GridCell` di `types/index.ts`. `child`/`sub` sono `Box` perché
/// `SynopticObject`/`SubGrid` non hanno una dimensione nota a compile-time
/// dentro un tipo che li contiene (ricorsione) — serde li deserializza
/// comunque senza differenze di comportamento rispetto a un campo diretto.
#[derive(Debug, Deserialize, Clone)]
pub struct GridCell {
    pub row: f64,
    pub col: f64,
    pub rowspan: Option<f64>,
    pub colspan: Option<f64>,
    pub bg_color: Option<String>,
    pub visible: Option<bool>,
    pub visible_tag: Option<String>,
    pub child: Option<Box<SynopticObject>>,
    pub sub: Option<Box<SubGrid>>,
}

/// Porta `SubGrid` di `types/index.ts` — suddivisione 1×2/2×1 locale di una
/// `GridCell`, ricorsiva (`SubCellEntry::sub` può ripetersi).
#[derive(Debug, Deserialize, Clone)]
pub struct SubGrid {
    pub orientation: String,
    pub ratio: f64,
    pub a: Option<Box<SubCellEntry>>,
    pub b: Option<Box<SubCellEntry>>,
}

/// Porta `SubCellEntry` di `types/index.ts`.
#[derive(Debug, Deserialize, Clone)]
pub struct SubCellEntry {
    pub bg_color: Option<String>,
    pub visible: Option<bool>,
    pub visible_tag: Option<String>,
    pub child: Option<Box<SynopticObject>>,
    pub sub: Option<Box<SubGrid>>,
}

/// Porta `PipePoint` di `types/index.ts`.
#[derive(Debug, Deserialize, Clone, Copy)]
pub struct PipePoint {
    pub x: f64,
    pub y: f64,
}

/// Voce di `GET /api/recipes` — non `RecipeDef` completo, l'endpoint non
/// espone i setpoint (vedi `sws-web/src/router.rs::list_recipes`).
#[derive(Debug, Deserialize, Clone)]
pub struct RecipeListEntry {
    pub id: String,
    pub name: String,
}

/// Porta `PieSlice` di `types/index.ts`.
/// `label` non è ancora disegnato: `pie_show_legend` (legenda testuale) non
/// è implementato in questo giro — gap dichiarato, vedi Q14 seguito 14.
#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
pub struct PieSlice {
    pub tag: String,
    pub label: String,
    pub color: String,
}

/// Sottoinsieme di `FaceplateDef` (`sws-web/src/synoptic.rs`): solo
/// `objects` serve a questo motore (`params` è implicito — i nomi che
/// contano sono quelli usati davvero dentro le stringhe `{param}` dei
/// figli, non serve validare l'elenco dichiarato).
#[derive(Debug, Deserialize)]
pub struct FaceplateDef {
    #[serde(default)]
    pub objects: Vec<serde_json::Value>,
}

/// Porta `BarChartSeries` di `types/index.ts`.
#[derive(Debug, Deserialize, Clone)]
pub struct BarChartSeries {
    pub tag: String,
    pub label: String,
    pub color: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// Porta (parzialmente) `TrendSeriesStyle` di `types/index.ts` — vedi
/// `SynopticObject::trend_series_styles` per quali campi sono davvero
/// disegnati.
#[derive(Debug, Deserialize, Clone)]
pub struct TrendSeriesStyle {
    pub color: Option<String>,
}

/// Porta `TrendTrace` di `types/index.ts` — il formato con cui la 2.1.0 ha
/// unificato tag e stile in un elenco solo.
///
/// Dichiarati qui solo i campi che questo motore sa usare: `tag`, `color`,
/// `hidden`. `label` (legenda), `own_scale` (secondo asse Y), `width`, `dash`,
/// `fill`, `fill_opacity` e `smooth` esistono nello schema web ma non hanno
/// equivalente disegnato — gap dichiarato, non un nome dimenticato. Serde li
/// ignora senza errori, come tutto il resto del file.
#[derive(Debug, Deserialize, Clone)]
pub struct TrendTrace {
    pub tag: String,
    /// Traccia esclusa dal disegno. Onorata perché una traccia nascosta che
    /// comparisse comunque sarebbe visibilmente sbagliata, non un dettaglio.
    pub hidden: Option<bool>,
    pub color: Option<String>,
}

/// Porta `TextListEntry` di `types/index.ts` — un valore scalare o un range
/// (`value_min`/`value_max`, half-open) mappato a `label`/`color`.
#[derive(Debug, Deserialize, Clone)]
pub struct TextListEntry {
    pub value: serde_json::Value,
    pub label: String,
    pub color: Option<String>,
    pub value_min: Option<f64>,
    pub value_max: Option<f64>,
}

/// Porta `TableRow` di `types/index.ts`: una riga statica (label fisso, tag
/// letto dal vivo) — non una tabella dati dinamica (niente sort/pagine).
#[derive(Debug, Deserialize, Clone)]
pub struct TableRow {
    pub label: String,
    pub tag: String,
    pub format: Option<String>,
}

/// Porta `LanguageTable` di `types/index.ts` (`sws-core::project::LanguageTable`
/// lato Rust) — mappa token `{{key}}` → traduzioni per codice lingua. Letta
/// una sola volta all'avvio (`client::fetch_languages`, `GET /api/project`),
/// non cambia durante la sessione (a differenza della lingua *corrente*,
/// che invece è mutabile — vedi `lvgl_render::SharedLang`).
#[derive(Debug, Deserialize, Clone, Default)]
pub struct LanguageTable {
    #[serde(default)]
    pub default: String,
    #[serde(default)]
    pub langs: Vec<String>,
    #[serde(default)]
    pub entries: Vec<LangEntry>,
}

/// Porta `LangEntry` di `types/index.ts`.
#[derive(Debug, Deserialize, Clone)]
pub struct LangEntry {
    pub key: String,
    #[serde(default)]
    pub values: std::collections::HashMap<String, String>,
}

/// Porta `CustomSymbol` di `sws-core/src/project.rs` — i simboli SVG che
/// l'utente aggiunge al progetto, che il viewer LVGL rasterizza con
/// `svg_raster` (vedi `svg_assets`).
///
/// Si dichiarano solo i campi che servono a disegnare. `attribution`,
/// `colorable_ids` e il resto restano fuori: `colorable_ids` in particolare
/// serve alla ricolorazione per stato, che qui non facciamo — rasterizzare
/// una variante per colore costerebbe una bitmap per stato, e sui simboli
/// custom lo stato lo si mostra col bordo di allarme come per gli altri
/// oggetti.
#[derive(Debug, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct CustomSymbol {
    pub id: String,
    /// SVG inline. Presente quasi sempre: è la copia che viaggia col progetto.
    #[serde(default)]
    pub svg: Option<String>,
    /// URL d'origine, usato solo se `svg` manca.
    #[serde(default)]
    pub url: String,
}
