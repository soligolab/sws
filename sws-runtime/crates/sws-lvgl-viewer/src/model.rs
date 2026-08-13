//! Sottoinsieme minimo dello schema `SynopticObject`/`SynopticPage` che il
//! motore LVGL sa interpretare — cresce widget per widget (vedi
//! `lvgl_render::SUPPORTED_TYPES` per l'elenco aggiornato). Parser
//! deliberatamente tollerante — `#[serde(default)]` ovunque —
//! perché lo schema reale ha ~150 campi opzionali (vedi
//! `sws-web/src/synoptic.rs`) di cui questo motore ne conosce solo una
//! manciata: tutto il resto viene ignorato silenziosamente da serde, non
//! genera errori. Non è un mirror completo (vedi ADR 0002, "duplicazione
//! accettata" — questo è un terzo sottoinsieme minimo, non una copia
//! integrale del mirror TS/Rust esistente).

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
