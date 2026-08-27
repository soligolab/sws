//! Interprete `SynopticObject` → widget LVGL, per il sottoinsieme MVP
//! (rect, text, button, led, slider). Equivalente in spirito al dispatcher
//! `SvgObject()` di `sws-editor/src/canvas/SvgCanvas.tsx`, riscritto in
//! Rust/LVGL invece che React/SVG — stessi campi, stessa semantica di
//! resolve/soglie/format dov'è ragionevole portarla (vedi ADR 0002).
//!
//! La registrazione del display passa da `crate::lvgl_display::init_display()`
//! invece che da `lvgl::Display::register()`, che ha un bug di lifetime
//! confermato (`docs/OPEN_QUESTIONS.md` Q14) — vedi `lvgl_display.rs` per il
//! perché e per il fix. `task_handler()` non viene chiamato qui: è il
//! chiamante (il loop SDL2 in `main.rs`) a guidare il redraw ripetutamente.
//!
//! **Aggiornamento live** (`LiveBinding`/`update_bindings`): i widget con
//! stato tag-dipendente (led, slider, text) vengono creati una sola volta;
//! a ogni frame `update_bindings` ne aggiorna solo il valore, senza
//! ricrearli. Gli `Style` con colore dinamico vengono mutati sul posto
//! (`Style::set_bg_color`/`set_text_color`) e poi "rinfrescati" con
//! `lv_obj_refresh_style` — mutare uno `Style` già assegnato non basta da
//! solo: LVGL cache lo stile calcolato per oggetto e va detto esplicitamente
//! che una proprietà è cambiata, altrimenti il vecchio colore resta a
//! schermo. Creare uno `Style` nuovo a ogni frame invece di mutare quello
//! esistente avrebbe fatto crescere `styles`/`Vec<LiveBinding>` senza limite
//! in una sessione lunga.

use std::cell::RefCell;
use std::sync::mpsc;

use cstr_core::CString;
use crate::lvgl_font;
use lvgl::style::Style;
use lvgl::widgets::{Bar, Btn, Chart, Checkbox, Label, Led, Line, Meter, Slider, Table};
use lvgl::{Color, LvError, NativeObject, Part, Widget};
use sws_core::tag::{TagQuality, TagValue};

use crate::client::{self, AlarmStateLite, HistorySample, SharedAlarms, SharedHistory, SharedLang, TagSnapshot, TagSnapshotValue};
use crate::model::{LanguageTable, OnValue, PieSlice, SubGrid, SynopticObject, SynopticPage, TableRow, TextListEntry};

/// Risoluzione di default se la pagina non specifica `width`/`height` — non
/// più un vincolo a compile-time (`lvgl_display::init_display` prende
/// `hor_res`/`ver_res` a runtime fin dal fix del bug di lifetime in Q14, via
/// `Box::leak` invece di un `DrawBuffer<const N>`): la risoluzione vera è
/// quella della **prima** pagina caricata in una sessione, vedi
/// `resolve_resolution`.
pub const HOR_RES: u32 = 800;
pub const VER_RES: u32 = 480;

/// Risoluzione del display per l'intera sessione: quella della prima pagina
/// caricata (fallback a `HOR_RES`/`VER_RES` se `width`/`height` non
/// impostati). Chiamata solo per la prima pagina (`interpret_page`) — le
/// pagine raggiunte per navigazione (`render_page_objects`) riusano il
/// display già registrato, anche se il loro `width`/`height` fosse diverso:
/// un pannello fisico reale non cambia risoluzione a ogni cambio pagina,
/// quindi seguire quella della prima pagina è la scelta corretta, non solo
/// la più semplice.
fn resolve_resolution(page: &SynopticPage) -> (u32, u32) {
    let hor_res = page.width.unwrap_or(HOR_RES as f64).round() as u32;
    let ver_res = page.height.unwrap_or(VER_RES as f64).round() as u32;
    (hor_res, ver_res)
}

const SUPPORTED_TYPES: &[&str] = &[
    "rect", "ellipse", "line", "text", "button", "led", "slider", "progress_bar", "checkbox", "radio", "gauge",
    "state_lamp", "table", "navbutton", "trend", "alarm_viewer",
    "text_list", "bar_chart", "sparkline", "alarm_banner", "faceplate",
    "symbol", "grid", "pipe", "alarm_bell", "recipe_panel", "setpoint", "xy_plot", "pie_chart",
    "lang_button", "lang_selector", "image", "kpi_tile", "data_log", "alarm_history",
];

#[derive(Default, Debug)]
pub struct RenderSummary {
    pub rendered: Vec<String>,
    pub skipped_unsupported: Vec<String>,
}

/// Un widget la cui apparenza dipende da un tag e va ricontrollata a ogni
/// frame — mai ricreato, solo aggiornato (vedi `update_bindings`). Il
/// puntatore raw è valido quanto il widget stesso (che vive quanto la
/// finestra: mai distrutto finché il processo non esce).
///
/// `buf` in `PieChart`/`Symbol` non viene mai letto direttamente dal codice
/// Rust (solo scritto da LVGL via puntatore raw passato a
/// `lv_canvas_set_buffer`) — deve però restare vivo quanto il canvas,
/// quindi resta un campo del binding invece di un valore temporaneo,
/// stesso principio degli `Style` altrove in questo file.
#[allow(dead_code)]
pub enum LiveKind {
    /// Riempimento progressivo di una `pipe`.
    ///
    /// `buf` possiede i punti della linea di riempimento: LVGL ne conserva il
    /// puntatore, non una copia, quindi la stessa allocazione va riusata a
    /// ogni aggiornamento — leakarne una per variazione del tag vorrebbe dire
    /// perdere memoria a ogni frame.
    PipeFill {
        fill_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        spec: PipeFill,
        buf: Vec<lvgl_sys::lv_point_t>,
        last_level: f64,
    },
    /// SVG rasterizzato (simbolo vendored/custom, widget `image`).
    ///
    /// Non ha niente da aggiornare a ogni frame: la bitmap è fissa, e non si
    /// ricolora per stato (vedi `render_svg_raster`). Sta comunque fra i
    /// `LiveBinding` per un motivo solo ma decisivo: **`buf` deve restare
    /// vivo quanto il canvas**, perché LVGL rilegge da quel puntatore a ogni
    /// redraw. Lasciarlo cadere alla fine di `render_svg_raster` darebbe un
    /// canvas che disegna memoria liberata — cioè un difetto che si manifesta
    /// a caso, molto più tardi, e altrove.
    SvgRaster {
        #[allow(dead_code)]
        canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        #[allow(dead_code)]
        buf: Vec<u8>,
    },
    Led {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        tag: Option<String>,
        on_value: OnValue,
        on_color: String,
        off_color: String,
    },
    /// Slider e progress_bar condividono lo stesso binding: `lv_slider_t` è
    /// internamente uno specializzato `lv_bar_t` (vedi `render_slider`), le
    /// stesse `lv_bar_set_range`/`set_value` funzionano su entrambi.
    BarLike {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        tag: Option<String>,
        min: f64,
        max: f64,
    },
    /// checkbox e radio (approssimato con lo stesso widget — vedi
    /// `render_radio`) condividono lo stesso binding: solo lo stato
    /// checked/unchecked cambia dal vivo, `lv_obj_add_state`/`clear_state`
    /// con `LV_STATE_CHECKED`. `checked_value` è quello che determina lo
    /// stato (confronto per stringa col tag, vedi `checkbox_is_checked`),
    /// non un booleano fisso — serve tenerlo qui per rivalutarlo a ogni
    /// frame, non solo alla creazione.
    Checkbox {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        tag: Option<String>,
        checked_value: serde_json::Value,
    },
    Text {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        tag: Option<String>,
        format: Option<String>,
        static_text: Option<String>,
        text_color_by_threshold: bool,
        alarm_low: Option<f64>,
        warn_low: Option<f64>,
        warn_high: Option<f64>,
        alarm_high: Option<f64>,
        static_color_hex: Option<String>,
        color_style: Option<Style>,
    },
    /// Ago e arco seguono il tag dal vivo; il colore dell'arco resta quello
    /// fissato alla creazione (nessun setter LVGL per il colore di un
    /// indicatore già creato — vedi `render_gauge`). `value_ptr` è il child
    /// `Label` col valore numerico, aggiornato come un `Text` qualunque.
    Gauge {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        needle_indic: *mut lvgl_sys::lv_meter_indicator_t,
        arc_indic: *mut lvgl_sys::lv_meter_indicator_t,
        value_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        tag: Option<String>,
        min: f64,
        max: f64,
        unit: Option<String>,
    },
    /// Cerchio colorato (come `led`, ma `lv_obj` normale: legge `bg_color`
    /// dallo `Style` senza le sorprese di `lv_led`) + label testo a fianco,
    /// entrambi ricalcolati da `match_text_list_entry` a ogni frame.
    StateLamp {
        lamp_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        lamp_style: Style,
        label_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        label_style: Style,
        tag: Option<String>,
        entries: Vec<TextListEntry>,
        default_label: Option<String>,
        default_color: Option<String>,
    },
    /// Tabella statica (righe fisse da `table_rows`, non un datagrid dinamico):
    /// solo le colonne valore/qualità cambiano dal vivo, la colonna
    /// label e l'intestazione sono fissate alla creazione.
    Table {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        rows: Vec<TableRow>,
    },
    /// Trend: una `lv_chart_series_t` per tag (serie 0 = `tag`, serie 1+ =
    /// `extra_tags`), ciascuna alimentata dal proprio `SharedHistory` (un
    /// task di polling REST in background, non `/ws/tags` — la storia non è
    /// un delta live). `window_s` fissa la finestra temporale e raddoppia da
    /// costante di conversione (vedi `render_trend`: le coordinate X del
    /// chart sono secondi-dall'inizio-finestra, non Unix ms assoluti —
    /// `lv_coord_t` è un `i16`, un Unix ms non ci entrerebbe). `autofit`
    /// true quando `y_min`/`y_max` sono entrambi assenti nel synottico.
    Trend {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        series: Vec<TrendSeriesBinding>,
        window_s: u64,
        autofit: bool,
    },
    /// Lista allarmi attivi (solo modalità `"list"`, vedi `render_alarm_viewer`):
    /// `rows.len()` slot fissi (uno per `alarm_viewer_max_rows`), il
    /// contenuto di ciascuno viene riassegnato a ogni frame in base a quali
    /// allarmi sono attivi in quel momento — stesso principio delle celle di
    /// `Table`, non widget ricreati.
    AlarmViewer {
        shared: SharedAlarms,
        empty_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        show_empty: bool,
        rows: Vec<AlarmRowBinding>,
        prefix: String,
        allowed_sev: Option<Vec<String>>,
    },
    /// Un solo `Label`: stessa logica value→label→color di `StateLamp`
    /// (`match_text_list_entry`), ma senza il cerchio colorato — il colore
    /// dell'entry, quando c'è, tinge direttamente il testo.
    TextList {
        label_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        label_style: Style,
        tag: Option<String>,
        entries: Vec<TextListEntry>,
        default_label: Option<String>,
        default_color: Option<String>,
    },
    /// Una `lv_bar` per serie, affiancate (equivalente dell'orientamento
    /// `"vertical"` del web: barre verticali una accanto all'altra — vedi
    /// `render_bar_chart` per perché l'orientamento `"horizontal"` non è
    /// distinto qui). `value_ptr` è la label col valore sopra la barra.
    BarChart {
        bars: Vec<BarChartBarBinding>,
    },
    /// Grafico compatto senza assi/griglia, stesso principio del `trend`
    /// (poller REST in background, non `/ws/tags`) ma una sola serie e senza
    /// range Y fisso — sempre autofit, come `SparklineWidget` in
    /// `SvgCanvas.tsx`.
    Sparkline {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        ser: *mut lvgl_sys::lv_chart_series_t,
        shared: SharedHistory,
        last_seen_version: u64,
        last_samples: Vec<HistorySample>,
        window_s: u64,
    },
    /// Riquadro compatto che mostra l'allarme attivo più recente (non una
    /// lista come `alarm_viewer`): stesso `SharedAlarms`, stesso filtro
    /// severità/prefix, ma un solo slot invece di `max_rows`.
    AlarmBanner {
        shared: SharedAlarms,
        dot_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        dot_style: Style,
        msg_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        empty_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        prefix: String,
        allowed_sev: Option<Vec<String>>,
    },
    /// Punto+scia live contro due tag (traiettoria/posizione, non tempo —
    /// a differenza di `trend`/`sparkline`, l'asse X è il valore del tag
    /// `tag`, non il tempo). Campionamento locale (nessun poller REST: i
    /// valori sono già nello `TagSnapshot` di ogni frame), throttled a un
    /// campione ogni ~200ms per non riempire `point_cnt` inutilmente a
    /// 60fps — vedi `update_xy_plot`.
    XyPlot {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        ser: *mut lvgl_sys::lv_chart_series_t,
        x_tag: Option<String>,
        y_tag: Option<String>,
        trail_s: u64,
        samples: Vec<(u64, f64, f64)>,
        last_sample_ms: u64,
        x_min: Option<f64>,
        x_max: Option<f64>,
        y_min: Option<f64>,
        y_max: Option<f64>,
    },
    /// Torta/donut — solo modalità `"donut"` disegnata (composizione di
    /// `lv_canvas_draw_arc` per spicchio, un anello reale; `"pie"` pieno al
    /// centro richiederebbe disegno custom oltre le primitive canvas
    /// disponibili, vedi `render_pie_chart`). Il buffer vive qui (non
    /// `Box::leak`-ato: il `LiveBinding` stesso vive quanto la pagina,
    /// stesso principio degli `Style` già tenuti dentro altri `LiveKind`).
    PieChart {
        canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        buf: Vec<u8>,
        w: i16,
        h: i16,
        slices: Vec<PieSlice>,
        inner_ratio: f64,
        last_values: Vec<f64>,
    },
    /// Etichetta valore corrente — l'apertura/chiusura del tastierino e la
    /// scrittura sul tag sono guidate da callback FFI (vedi
    /// `SetpointCtx`/`sws_setpoint_*_cb`), questo binding aggiorna solo il
    /// testo quando il tag cambia da un'altra sorgente (stesso principio di
    /// `Text`).
    Setpoint {
        value_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        tag: Option<String>,
        unit: String,
    },
    /// Badge con il conteggio degli allarmi attivi (filtrati come
    /// `alarm_viewer`) — il pannello a comparsa con l'elenco è gestito
    /// interamente dalla callback di click (`sws_alarm_bell_clicked_cb`),
    /// questo binding aggiorna solo il numero sul badge.
    AlarmBell {
        shared: SharedAlarms,
        badge_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        row_ptrs: Vec<core::ptr::NonNull<lvgl_sys::lv_obj_t>>,
        prefix: String,
        allowed_sev: Option<Vec<String>>,
        last_count: usize,
    },
    /// Icona simbolo SCADA — solo i 16 builtin, disegnati su un
    /// `lv_canvas` con `lv_canvas_draw_rect`/`draw_polygon`/`draw_arc` (Q15,
    /// deciso 2026-08-11, opzione B). Ridisegnato solo quando lo stato
    /// (`off`/`on`/`alarm`, derivato da `state_tag`/`alarm_tag` come nel
    /// web) cambia davvero, non a ogni frame — un canvas redraw costa più
    /// di un `Style` refresh.
    Symbol {
        canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        buf: Vec<u8>,
        w: i16,
        h: i16,
        symbol_id: String,
        state_tag: Option<String>,
        alarm_tag: Option<String>,
        off_color: String,
        on_color: String,
        alarm_color: String,
        last_state: Option<SymbolState>,
    },
    /// Movimento: i binding generici proprietà→tag applicati **a ogni frame**,
    /// non solo alla creazione.
    ///
    /// È l'unica variante che non corrisponde a un tipo di oggetto: vale per
    /// tutti e 31, perché `bindings` è una proprietà universale. Le altre
    /// varianti nascono dentro la rispettiva `render_*`, che conosce i propri
    /// widget; questa no — i widget arrivano catturati da `dispatch_render`
    /// contando i figli del padre prima e dopo il rendering, così le ~30
    /// funzioni `render_*` restano com'erano (nessuna restituisce il puntatore,
    /// e quelle geometriche non restituiscono affatto).
    Geometry {
        widgets: Vec<GeomWidget>,
        /// Copia dei soli binding di geometria: `x`, `y`, `width`, `height`,
        /// `visible`. Gli altri sono già stati applicati alla creazione da
        /// `apply_bindings` e lì restano.
        bindings: serde_json::Value,
        /// Valori di `x`/`y` risolti alla creazione: il movimento è uno
        /// scostamento da questi, non una posizione assoluta (vedi `GeomWidget`).
        start_bound_x: Option<f64>,
        start_bound_y: Option<f64>,
        /// Ultimo stato **scritto** nei widget. Si riscrive solo ciò che
        /// cambia: `lv_obj_set_x` passa per `lv_obj_refresh_style`, che
        /// invalida l'area, e rifarlo a ogni frame per un oggetto fermo
        /// significherebbe ridisegnare la pagina 30 volte al secondo per
        /// nulla — su questi pannelli si vedrebbe.
        applied_dx: i16,
        applied_dy: i16,
        applied_w: i16,
        applied_h: i16,
        applied_visible: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolState {
    Off,
    On,
    Alarm,
}

/// Uno slot barra di `bar_chart`: la `lv_bar` stessa più la label del
/// valore sopra, entrambe ricreate una volta e aggiornate a ogni frame —
/// stesso principio di `BarLike`, ma qui serve anche il testo del valore
/// (il web lo disegna sempre, `bar_show_values`).
pub struct BarChartBarBinding {
    bar_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    value_ptr: Option<core::ptr::NonNull<lvgl_sys::lv_obj_t>>,
    tag: String,
    min: f64,
    max: f64,
    unit: String,
    show_values: bool,
}

/// Una serie del trend: il puntatore LVGL, la sorgente dati condivisa col
/// task di polling, e l'ultimo stato visto — `last_seen_version`/
/// `last_samples` esistono solo per evitare di riscrivere gli stessi punti
/// (e richiamare `lv_chart_refresh`) a ogni frame quando il poller non ha
/// ancora prodotto un aggiornamento nuovo (vedi `SharedHistory`).
pub struct TrendSeriesBinding {
    ser: *mut lvgl_sys::lv_chart_series_t,
    shared: SharedHistory,
    last_seen_version: u64,
    last_samples: Vec<HistorySample>,
}

/// Uno slot riga di `alarm_viewer`: identità fissa (creato una volta),
/// contenuto riassegnato a ogni frame. `dot_style` è posseduto qui (non
/// spinto nel `Vec<Style>` "statico" del synottico) perché va mutato ogni
/// volta che cambia l'allarme assegnato a questa riga — stesso principio di
/// `StateLamp::lamp_style`. `ack_ctx` è `None` quando `alarm_viewer_show_ack`
/// è `false`: niente pulsante, niente contesto da tenere in vita.
pub struct AlarmRowBinding {
    dot_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    dot_style: Style,
    ts_ptr: Option<core::ptr::NonNull<lvgl_sys::lv_obj_t>>,
    msg_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    ack_btn_ptr: Option<core::ptr::NonNull<lvgl_sys::lv_obj_t>>,
    ack_ctx: Option<&'static AlarmAckCtx>,
}

/// Contesto per il click del pulsante ACK di una riga `alarm_viewer`: a
/// differenza degli altri pulsanti di questo file, l'id allarme associato a
/// una riga cambia da un frame all'altro (le righe sono slot fissi, il
/// contenuto dipende da quali allarmi sono attivi in quel momento — vedi
/// `AlarmRowBinding`). `RefCell` invece di un valore fisso `Box::leak`-ato
/// una volta sola: `update_alarm_viewer` lo aggiorna a ogni frame, la
/// callback lo legge al momento del click — sicuro perché il motore è
/// single-thread (le callback LVGL sparano sincrone dentro `task_handler()`,
/// sullo stesso thread del loop di rendering, mai in parallelo con
/// `update_bindings`).
struct AlarmAckCtx {
    current_id: RefCell<String>,
    tx: mpsc::Sender<String>,
}

pub struct LiveBinding {
    pub kind: LiveKind,
}

/// Un widget catturato per il movimento, con la posizione che aveva appena
/// creato. Serve la posizione *iniziale di ciascuno*, non quella dell'oggetto
/// synottico: un `gauge` mette l'etichetta sotto l'arco, un `setpoint` mette i
/// pulsanti a fianco del campo, e spostarli tutti sulla stessa coordinata
/// spiaccicherebbe l'oggetto invece di muoverlo.
pub struct GeomWidget {
    ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    start_x: i16,
    start_y: i16,
}

/// Richiesta di scrittura tag generata da un'interazione utente (click
/// bottone, toggle checkbox/radio, drag slider). Prodotta da una callback
/// LVGL — contesto FFI sincrono, niente I/O di rete lì dentro (vedi sotto) —
/// e consumata dal loop SDL2 in `main.rs`, che la gira a un task async sul
/// runtime tokio del processo (`client::put_tag`).
pub struct TagCommand {
    pub tag: String,
    pub value: TagValue,
}

/// Contesto per il click di un bottone: valore fisso da scrivere, stessa
/// semantica di `SvgCanvas.tsx` (`onWriteTag(obj.tag, obj.write_value ?? true)`)
/// — non un contatore o altro comportamento specifico di LVGL.
struct ButtonClickCtx {
    tag: String,
    write_value: TagValue,
    tx: mpsc::Sender<TagCommand>,
}

/// Contesto per checkbox/radio/slider: il valore da scrivere si legge dal
/// widget stesso al momento dell'evento (stato checked, valore bar), non è
/// precalcolato — a differenza del bottone qui non c'è nulla di fisso da
/// portarsi dietro oltre al tag.
struct WidgetChangeCtx {
    tag: String,
    tx: mpsc::Sender<TagCommand>,
}

/// Contesto per il toggle di una checkbox/radio: a differenza dello slider,
/// il valore da scrivere NON si legge dal widget (LVGL conosce solo
/// checked/unchecked, non `checked_value`/`unchecked_value` custom) — va
/// quindi precalcolato qui, stesso principio di `ButtonClickCtx.write_value`.
struct CheckboxToggleCtx {
    tag: String,
    checked_value: TagValue,
    unchecked_value: TagValue,
    tx: mpsc::Sender<TagCommand>,
}

/// Contesto per il click di un navbutton: il nome pagina è fisso quanto il
/// `write_value` di un bottone — letto dal synottico, non dal vivo.
struct NavClickCtx {
    target_page: String,
    tx: mpsc::Sender<String>,
}

/// Alloca un contesto `'static` per una callback LVGL (`Box::leak`, stesso
/// principio di `lvgl_display.rs`/`lvgl_indev.rs`: il widget e la sua
/// callback vivono quanto il processo, mai distrutti prima — niente free
/// corrispondente, accettato per la stessa ragione degli `Style` in
/// `styles`/`LiveBinding` — vedi commento di modulo) e lo converte nel
/// puntatore opaco richiesto da `lv_obj_add_event_cb`.
fn leak_ctx<T>(ctx: T) -> *mut std::ffi::c_void {
    Box::leak(Box::new(ctx)) as *mut T as *mut std::ffi::c_void
}

/// `LV_EVENT_CLICKED` — fired dal livello indev di LVGL (`lv_indev.c`) per
/// qualunque oggetto clickable su un ciclo press+release completo senza
/// drag: verificato nel sorgente C, non assunto dal solo nome dell'evento.
unsafe extern "C" fn sws_button_clicked_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const ButtonClickCtx) };
    let _ = ctx.tx.send(TagCommand { tag: ctx.tag.clone(), value: ctx.write_value.clone() });
}

/// `LV_EVENT_CLICKED` su un navbutton: stesso evento del bottone normale,
/// contesto diverso (nome pagina invece di tag/valore) — canale separato da
/// `TagCommand` perché il chiamante deve reagire in modo completamente
/// diverso (ricaricare la pagina, non scrivere un tag).
unsafe extern "C" fn sws_navbutton_clicked_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const NavClickCtx) };
    let _ = ctx.tx.send(ctx.target_page.clone());
}

/// `LV_EVENT_CLICKED` sul pulsante ACK di una riga `alarm_viewer`: legge
/// l'id corrente dal `RefCell` (aggiornato ogni frame da
/// `update_alarm_viewer`, vedi `AlarmAckCtx`) invece di portarsi dietro un
/// id fisso deciso alla creazione — la riga può aver cambiato allarme molte
/// volte da allora. Id vuoto (riga senza allarme assegnato in questo
/// momento, pulsante comunque nascosto ma la callback potrebbe teoricamente
/// sparare tra un frame e l'altro) → non manda nulla.
unsafe extern "C" fn sws_alarm_ack_clicked_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const AlarmAckCtx) };
    let id = ctx.current_id.borrow().clone();
    if !id.is_empty() {
        let _ = ctx.tx.send(id);
    }
}

/// `LV_EVENT_VALUE_CHANGED` su una checkbox/radio: lo stato CHECKED è già
/// stato aggiornato da LVGL stesso prima di inviare questo evento (vedi
/// `lv_obj.c`, ramo `LV_EVENT_RELEASED` — il toggle avviene, poi
/// `lv_event_send(LV_EVENT_VALUE_CHANGED)`), quindi `lv_obj_has_state` qui
/// legge già il nuovo valore, non quello precedente al click.
unsafe extern "C" fn sws_checkbox_toggled_cb(e: *mut lvgl_sys::lv_event_t) {
    let target = unsafe { lvgl_sys::lv_event_get_target(e) };
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if target.is_null() || user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CheckboxToggleCtx) };
    let checked = unsafe { lvgl_sys::lv_obj_has_state(target, lvgl_sys::LV_STATE_CHECKED as lvgl_sys::lv_state_t) };
    let value = if checked { ctx.checked_value.clone() } else { ctx.unchecked_value.clone() };
    let _ = ctx.tx.send(TagCommand { tag: ctx.tag.clone(), value });
}

/// `LV_EVENT_VALUE_CHANGED` su uno slider: fires ripetutamente durante il
/// drag (non solo al rilascio) — comportamento nativo LVGL, dà un feedback
/// live coerente con quello che uno slider SCADA normalmente offre.
/// `lv_bar_get_value` perché lo slider è internamente uno specializzato
/// `lv_bar_t`, stesso motivo per cui la creazione usa `lv_bar_set_range`/
/// `set_value` (vedi `init_bar_like`).
unsafe extern "C" fn sws_slider_changed_cb(e: *mut lvgl_sys::lv_event_t) {
    let target = unsafe { lvgl_sys::lv_event_get_target(e) };
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if target.is_null() || user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const WidgetChangeCtx) };
    let v = unsafe { lvgl_sys::lv_bar_get_value(target) };
    let _ = ctx.tx.send(TagCommand { tag: ctx.tag.clone(), value: TagValue::Int(v as i64) });
}

fn parse_hex_color(s: &str) -> Option<(u8, u8, u8)> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some((r, g, b))
}

/// Porta `PALETTE` di `TrendCanvas.tsx` — colori di fallback per le serie
/// oltre la 0 quando non c'è uno stile esplicito.
const TREND_PALETTE: [(u8, u8, u8); 6] = [
    (59, 130, 246),  // #3b82f6
    (34, 197, 94),   // #22c55e
    (234, 179, 8),   // #eab308
    (239, 68, 68),   // #ef4444
    (168, 85, 247),  // #a855f7
    (6, 182, 212),   // #06b6d4
];

/// Porta `resolveSeriesColor()` di `TrendCanvas.tsx` (riga ~28): stile
/// esplicito per indice > tutto, poi (solo per la serie 0) `line_color`,
/// poi la palette a rotazione.
/// Una traccia del trend, già risolta: quale tag leggere e con che colore.
#[derive(Debug, PartialEq, Eq)]
pub struct ResolvedTrace {
    pub tag: String,
    pub color: Option<String>,
}

/// Da dove prendere le tracce di un trend.
///
/// La 2.1.0 ha unificato tag e stile in `trend_tags[]` e la migrazione riscrive
/// le pagine al primo salvataggio. Questo motore continuava a leggere solo
/// `tag` + `extra_tags`: su un progetto migrato non trovava più niente e il
/// grafico restava **vuoto**. Il ripiego sul formato vecchio non è cortesia
/// verso il passato — è il formato che gira sui dispositivi in servizio finché
/// nessuno riapre il progetto nell'IDE.
///
/// Pura per poter essere verificata senza un display: è qui che sta la scelta
/// che si era rotta, non nelle chiamate FFI che seguono.
pub fn resolve_trend_traces(obj: &SynopticObject) -> Vec<ResolvedTrace> {
    // Formato nuovo, se presente e con almeno una traccia utile. Un
    // `trend_tags: []` non deve far ripiegare sul formato vecchio: significa
    // "nessuna traccia", ed è una risposta legittima.
    if let Some(traces) = obj.trend_tags.as_ref() {
        return traces
            .iter()
            .filter(|t| !t.hidden.unwrap_or(false))
            .filter(|t| !t.tag.trim().is_empty())
            .map(|t| ResolvedTrace { tag: t.tag.clone(), color: t.color.clone() })
            .collect();
    }

    // Formato precedente: `tag` è la serie 0, `extra_tags` le successive, e i
    // colori stanno a parte in `trend_series_styles` — la precedenza la applica
    // `trend_series_color`, non questa funzione.
    let mut out = Vec::new();
    if let Some(t) = obj.tag.as_deref() {
        if !t.trim().is_empty() {
            out.push(ResolvedTrace { tag: t.to_string(), color: None });
        }
    }
    if let Some(extra) = &obj.extra_tags {
        out.extend(
            extra.iter()
                .filter(|t| !t.trim().is_empty())
                .map(|t| ResolvedTrace { tag: t.clone(), color: None }),
        );
    }
    out
}

/// Serie di un `lv_chart`.
///
/// Esiste come funzione, invece di chiamare `lv_chart_add_series` nei tre punti
/// che ne hanno bisogno, perché il colore va convertito allo stesso modo ovunque
/// e perché è il posto giusto dove ricordare una cosa non ovvia.
///
/// **LVGL qui aveva un difetto** (Q22): `lv_chart_add_series` inizializzava
/// `y_ext_buf_assigned` ma non `x_ext_buf_assigned`, e la struct arriva da
/// `lv_mem_alloc`. Con un bit di spazzatura a 1,
/// `lv_chart_set_point_count` saltava la riallocazione di `x_points` ma
/// aggiornava `point_cnt` lo stesso, e ogni scrittura successiva usciva dal
/// buffer da 10 elementi — crash non deterministico, che sembrava specifico
/// della sparkline.
///
/// La correzione ora sta **nel sorgente vendorizzato**
/// (`patches/lvgl/0001-init-x_ext_buf_assigned.patch`), non qui: è lì che il
/// difetto vive, e una toppa a valle avrebbe dovuto essere ripetuta in ogni
/// punto che crea una serie. `scripts/check_vendor_patches.sh` verifica che la
/// patch sia ancora applicata e **fallisce** se una re-importazione l'ha
/// cancellata.
unsafe fn chart_add_series(
    ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    rgb: (u8, u8, u8),
) -> *mut lvgl_sys::lv_chart_series_t {
    lvgl_sys::lv_chart_add_series(
        ptr.as_ptr(),
        Color::from_rgb(rgb).into(),
        lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t,
    )
}

fn trend_series_color(i: usize, obj: &SynopticObject) -> (u8, u8, u8) {
    if let Some(rgb) = obj
        .trend_series_styles
        .as_ref()
        .and_then(|v| v.get(i))
        .and_then(|s| s.color.as_deref())
        .and_then(parse_hex_color)
    {
        return rgb;
    }
    if i == 0 {
        if let Some(rgb) = obj.line_color.as_deref().and_then(parse_hex_color) {
            return rgb;
        }
    }
    TREND_PALETTE[i % TREND_PALETTE.len()]
}

/// Porta `SEV_COLOR` di `alarmSeverity.ts` (i valori di fallback — questo
/// motore non ha un tema CSS da risolvere, quindi solo l'hex conta).
fn severity_color(sev: &str) -> (u8, u8, u8) {
    match sev {
        "Critical" => (239, 68, 68),  // #ef4444
        "Warning" => (234, 179, 8),   // #eab308
        _ => (59, 130, 246),          // #3b82f6 — "Info" e qualunque valore ignoto
    }
}

/// A differenza del web (`toLocaleTimeString`, richiede un fuso orario che
/// questo processo non ha modo di conoscere in modo affidabile senza una
/// dipendenza in più solo per questo dettaglio), mostra da quanto tempo
/// l'allarme è attivo ("Ns fa"/"Nm fa"/"Nh fa") invece dell'ora assoluta —
/// stesso scopo operativo (capire a colpo d'occhio quanto è vecchio un
/// allarme) senza aggiungere `chrono`/`time` in più.
fn format_alarm_age(activated_at_ms: u64, now_ms: u64) -> String {
    let age_s = now_ms.saturating_sub(activated_at_ms) / 1000;
    if age_s < 60 {
        format!("{age_s}s fa")
    } else if age_s < 3600 {
        format!("{}m fa", age_s / 60)
    } else {
        format!("{}h fa", age_s / 3600)
    }
}

fn apply_bg_color<W: Widget<Part = Part>>(
    w: &mut W,
    hex: &str,
    styles: &mut Vec<Style>,
) -> anyhow::Result<()> {
    let Some(rgb) = parse_hex_color(hex) else {
        return Ok(()); // colore non valido: tiene il default del tema, non è un errore fatale
    };
    let mut style = Style::default();
    style.set_bg_color(Color::from_rgb(rgb));
    w.add_style(Part::Main, &mut style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    // Lo style deve restare vivo quanto il widget a cui è applicato — LVGL
    // tiene un puntatore, non una copia. Il chiamante mantiene `styles` vivo
    // per tutta la durata di interpret_page.
    styles.push(style);
    Ok(())
}

fn text_cstring(s: &str) -> CString {
    CString::new(s).unwrap_or_else(|_| CString::new("?").unwrap())
}

fn set_pos_size(w: &mut impl Widget, obj: &SynopticObject, default_w: f64, default_h: f64) -> anyhow::Result<()> {
    let x = obj.x.unwrap_or(0.0).round() as i16;
    let y = obj.y.unwrap_or(0.0).round() as i16;
    let width = obj.width.unwrap_or(default_w).round() as i16;
    let height = obj.height.unwrap_or(default_h).round() as i16;
    w.set_pos(x, y).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    w.set_size(width, height).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    Ok(())
}

/// Porta `Number(value)` (JS) → f64: bool 1.0/0.0, numeri diretti, stringhe
/// parsate; fallback 0.0 se non numerica (stesso spirito di `SvgCanvas.tsx`,
/// senza propagare NaN dentro chiamate FFI che si aspettano `i32`).
fn tag_value_as_f64(v: &TagValue) -> f64 {
    match v {
        TagValue::Bool(b) => if *b { 1.0 } else { 0.0 },
        TagValue::Int(i) => *i as f64,
        TagValue::Float(f) => *f,
        TagValue::Str(s) => s.trim().parse::<f64>().unwrap_or(0.0),
    }
}

fn tag_value_as_string(v: &TagValue) -> String {
    match v {
        TagValue::Bool(b) => b.to_string(),
        TagValue::Int(i) => i.to_string(),
        TagValue::Float(f) => f.to_string(),
        TagValue::Str(s) => s.clone(),
    }
}

fn tag_value_as_bool(v: &TagValue) -> bool {
    match v {
        TagValue::Bool(b) => *b,
        TagValue::Int(i) => *i != 0,
        TagValue::Float(f) => *f != 0.0,
        TagValue::Str(s) => !s.trim().is_empty(),
    }
}

/// Porta `formatValue()` di `SvgCanvas.tsx`: supporta solo il pattern
/// `{value:.Nf}` (l'unico usato oggi nei progetti reali); altrimenti stringa
/// naturale del valore.
fn format_value(v: &TagValue, format: Option<&str>) -> String {
    if let (Some(fmt), TagValue::Float(_) | TagValue::Int(_)) = (format, v) {
        if let Some(start) = fmt.find("{value:.") {
            let rest = &fmt[start + "{value:.".len()..];
            if let Some(end) = rest.find('f') {
                if let Ok(decimals) = rest[..end].parse::<usize>() {
                    return format!("{:.*}", decimals, tag_value_as_f64(v));
                }
            }
        }
    }
    tag_value_as_string(v)
}

/// Porta `thresholdColor()` di `SvgCanvas.tsx`.
fn threshold_color(
    value: f64,
    alarm_low: Option<f64>,
    warn_low: Option<f64>,
    warn_high: Option<f64>,
    alarm_high: Option<f64>,
) -> Option<(u8, u8, u8)> {
    if let Some(t) = alarm_high {
        if value >= t {
            return parse_hex_color("#ef4444");
        }
    }
    if let Some(t) = alarm_low {
        if value <= t {
            return parse_hex_color("#ef4444");
        }
    }
    if let Some(t) = warn_high {
        if value >= t {
            return parse_hex_color("#eab308");
        }
    }
    if let Some(t) = warn_low {
        if value <= t {
            return parse_hex_color("#eab308");
        }
    }
    None
}

fn lookup<'a>(tags: &'a TagSnapshot, tag: &Option<String>) -> Option<&'a TagSnapshotValue> {
    tags.get(tag.as_deref()?)
}

// ── F2: binding generici proprietà→tag ───────────────────────────────────────
//
// Rispecchia `resolveObject` di `sws-editor/src/canvas/SvgCanvas.tsx`: per ogni
// voce di `obj.bindings` il valore live del tag sostituisce la proprietà
// statica omonima. Tre forme, come là: stringa (tag 1:1, storica),
// `{tag, in_min..out_max, clamp}` con scalatura lineare, `{expr}`.
//
// `{expr}` NON è supportato qui: il web ha un valutatore di espressioni
// (`evalExpr`) che sul motore LVGL non esiste. Una voce `expr` viene saltata e
// il valore statico resta — stesso esito che il web dà quando l'espressione è
// rotta, quindi il degrado è già previsto dal formato.

/// `TagValue` → `serde_json::Value`, per trattare le tre forme di spec con un
/// solo tipo. `Int` e `Float` finiscono entrambi in `Number`, così `as_f64()`
/// funziona su tutti e due senza casi speciali a valle.
fn tag_value_to_json(v: &TagValue) -> serde_json::Value {
    match v {
        TagValue::Bool(b) => serde_json::Value::Bool(*b),
        TagValue::Int(i) => serde_json::Value::Number((*i).into()),
        TagValue::Float(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        TagValue::Str(s) => serde_json::Value::String(s.clone()),
    }
}

/// Scala un valore secondo `in_min..in_max → out_min..out_max`, con clamp
/// opzionale (attivo salvo `clamp: false`, come sul web).
///
/// Pura e separata perché è l'unico pezzo con aritmetica: un errore qui sposta
/// oggetti sullo schermo di quantità plausibili, cioè il tipo di difetto che si
/// nota tardi.
fn scale_binding(v: f64, in_min: f64, in_max: f64, out_min: f64, out_max: f64, clamp: bool) -> f64 {
    if (in_max - in_min).abs() < f64::EPSILON {
        return v;
    }
    let scaled = out_min + (v - in_min) * (out_max - out_min) / (in_max - in_min);
    if clamp {
        let (lo, hi) = if out_min <= out_max { (out_min, out_max) } else { (out_max, out_min) };
        scaled.clamp(lo, hi)
    } else {
        scaled
    }
}

/// Risolve una spec di binding nel valore live corrente.
///
/// `None` = "tieni il valore statico": tag assente, spec malformata, o `expr`
/// (non valutabile qui). Mai un default inventato — un oggetto che resta dov'era
/// è meno sbagliato di uno che salta a zero.
pub fn resolve_binding_value(spec: &serde_json::Value, tags: &TagSnapshot) -> Option<serde_json::Value> {
    use serde_json::Value;
    match spec {
        Value::String(tag) => tags.get(tag.as_str()).map(|tv| tag_value_to_json(&tv.value)),
        Value::Object(m) => {
            if m.contains_key("expr") {
                return None; // nessun valutatore di espressioni sul motore LVGL
            }
            let tag = m.get("tag")?.as_str()?;
            let num = tag_value_to_json(&tags.get(tag)?.value).as_f64()?;
            let (in_min, in_max, out_min, out_max) = (
                m.get("in_min")?.as_f64()?,
                m.get("in_max")?.as_f64()?,
                m.get("out_min")?.as_f64()?,
                m.get("out_max")?.as_f64()?,
            );
            let clamp = m.get("clamp").and_then(|c| c.as_bool()).unwrap_or(true);
            serde_json::Number::from_f64(scale_binding(num, in_min, in_max, out_min, out_max, clamp))
                .map(Value::Number)
        }
        _ => None,
    }
}

/// Applica `obj.bindings` alle proprietà che il motore LVGL sa usare,
/// restituendo una copia solo quando qualcosa cambia davvero.
///
/// Sottoinsieme deliberato — geometria e visibilità — perché sono le proprietà
/// che il render legge dall'oggetto e che qui hanno un effetto visibile. Il web
/// applica il binding a *qualunque* proprietà di primo livello; allinearsi del
/// tutto vuol dire mappare a mano ~240 campi tipizzati, e va fatto insieme al
/// resto della parità (F9c), non di straforo.
pub fn apply_bindings(obj: &SynopticObject, tags: &TagSnapshot) -> Option<SynopticObject> {
    let map = obj.bindings.as_ref()?;
    if map.is_empty() {
        return None;
    }
    let mut out = obj.clone();
    let mut touched = false;
    for (prop, spec) in map {
        let Some(v) = resolve_binding_value(spec, tags) else { continue };
        match prop.as_str() {
            "x" | "y" | "width" | "height" => {
                let Some(n) = v.as_f64() else { continue };
                match prop.as_str() {
                    "x" => out.x = Some(n),
                    "y" => out.y = Some(n),
                    "width" => out.width = Some(n),
                    _ => out.height = Some(n),
                }
                touched = true;
            }
            // Stessa coercizione del web (BOOL_PROPS): numero != 0, stringa
            // non vuota, bool com'è.
            "visible" => {
                let b = match &v {
                    serde_json::Value::Bool(b) => *b,
                    serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
                    serde_json::Value::String(s) => !s.trim().is_empty(),
                    _ => continue,
                };
                out.visible = Some(b);
                touched = true;
            }
            _ => {} // proprietà non ancora mappata: valore statico
        }
    }
    touched.then_some(out)
}

/// Le proprietà di geometria che il motore sa muovere dal vivo. Le altre
/// restano applicate alla sola creazione da `apply_bindings`.
const GEOM_KEYS: [&str; 5] = ["x", "y", "width", "height", "visible"];

/// Estrae dai `bindings` dell'oggetto i soli spec di geometria, o `None` se non
/// ce n'è nessuno — nel qual caso non si cattura niente e non si accoda niente.
pub fn geometry_bindings(obj: &SynopticObject) -> Option<serde_json::Value> {
    let map = obj.bindings.as_ref()?;
    let mut out = serde_json::Map::new();
    for k in GEOM_KEYS {
        if let Some(v) = map.get(k) {
            out.insert(k.to_string(), v.clone());
        }
    }
    (!out.is_empty()).then(|| serde_json::Value::Object(out))
}

/// Geometria da applicare in un frame.
#[derive(Debug, PartialEq, Eq)]
pub struct ResolvedGeom {
    /// Scostamento dalla posizione iniziale, non posizione assoluta.
    pub dx: i16,
    pub dy: i16,
    pub w: i16,
    pub h: i16,
    pub visible: bool,
}

/// Risolve i binding di geometria per il frame corrente.
///
/// Pura di proposito — nessuna chiamata FFI, nessun puntatore — così si può
/// testare senza un display: è l'unico modo di coprire questa logica su una
/// macchina che non ha SDL2, ed è dove stanno gli errori interessanti (il
/// segno dello scostamento, il ripiego quando un tag manca).
///
/// `x`/`y` diventano uno **scostamento** da quanto risolto alla creazione:
/// i widget di un oggetto composito non stanno tutti sulla sua coordinata
/// dichiarata (l'etichetta di un gauge sta sotto l'arco), e riposizionarli
/// tutti sullo stesso punto lo spiaccicherebbe invece di muoverlo.
///
/// Un tag che non risolve **non muove niente**: si tiene l'ultima posizione
/// valida invece di far saltare l'oggetto all'origine.
pub fn resolve_geometry(
    bindings: &serde_json::Value,
    tags: &TagSnapshot,
    start_bound_x: Option<f64>,
    start_bound_y: Option<f64>,
    prev: &ResolvedGeom,
) -> ResolvedGeom {
    let num = |key: &str| -> Option<f64> {
        bindings
            .get(key)
            .and_then(|spec| resolve_binding_value(spec, tags))
            .and_then(|v| v.as_f64())
    };
    let delta = |now: Option<f64>, start: Option<f64>, fallback: i16| -> i16 {
        match (now, start) {
            (Some(n), Some(s)) => (n - s).round().clamp(i16::MIN as f64, i16::MAX as f64) as i16,
            _ => fallback,
        }
    };
    ResolvedGeom {
        dx: delta(num("x"), start_bound_x, prev.dx),
        dy: delta(num("y"), start_bound_y, prev.dy),
        w: num("width").map(|n| n.round().clamp(0.0, i16::MAX as f64) as i16).unwrap_or(prev.w),
        h: num("height").map(|n| n.round().clamp(0.0, i16::MAX as f64) as i16).unwrap_or(prev.h),
        // Stessa coercizione di `apply_bindings` e del web (BOOL_PROPS).
        visible: bindings
            .get("visible")
            .and_then(|spec| resolve_binding_value(spec, tags))
            .and_then(|v| match &v {
                serde_json::Value::Bool(b) => Some(*b),
                serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0),
                serde_json::Value::String(s) => Some(!s.trim().is_empty()),
                _ => None,
            })
            .unwrap_or(prev.visible),
    }
}

/// Porta `String(value)` di JS per gli scalari che compaiono in
/// `TextListEntry::value` / `checked_value` (numero/stringa/bool) — usato per
/// confronti per uguaglianza lasca (`match_text_list_entry`,
/// `checkbox_is_checked`), non per output visibile.
fn json_value_as_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Porta la semantica "checked" di `SvgCanvas.tsx`
/// (`tv != null && String(tv.value) === String(checkedVal)`, riga ~3130):
/// confronto per stringa contro `checked_value`, non un booleano fisso — un
/// progetto può usare `checked_value: "ON"` invece di `true`.
fn checkbox_is_checked(tv: Option<&TagSnapshotValue>, checked_value: &serde_json::Value) -> bool {
    match tv {
        Some(t) => tag_value_as_string(&t.value) == json_value_as_string(checked_value),
        None => false,
    }
}

/// Porta `matchTextListEntry()` di `SvgCanvas.tsx` (riga ~336): un'entry con
/// `value_min`/`value_max` impostato fa match per range (half-open,
/// `min <= v < max`), altrimenti per uguaglianza esatta (confronto stringa,
/// stessa semantica lasca di `String(a) === String(b)` in JS). Prima entry
/// che fa match vince.
fn match_text_list_entry<'a>(entries: &'a [TextListEntry], tv: Option<&TagSnapshotValue>) -> Option<&'a TextListEntry> {
    let tv = tv?;
    let live_str = tag_value_as_string(&tv.value);
    let live_num = tag_value_as_f64(&tv.value);
    entries.iter().find(|e| {
        if e.value_min.is_some() || e.value_max.is_some() {
            if let Some(min) = e.value_min {
                if live_num < min {
                    return false;
                }
            }
            if let Some(max) = e.value_max {
                if live_num >= max {
                    return false;
                }
            }
            true
        } else {
            json_value_as_string(&e.value) == live_str
        }
    })
}

/// Una lettera per la colonna qualità della tabella — la versione web usa un
/// pallino colorato (`qualityColor`), qui una colonna di solo testo:
/// `lv_table` non ha un modo semplice di colorare il background di una
/// singola cella (solo bit di controllo generici + un callback
/// `LV_EVENT_DRAW_PART_BEGIN` per applicarli — troppo per questo primo giro,
/// vedi Q14). Una sola lettera, non un'abbreviazione più lunga
/// ("OK"/"BAD"/"UNC"): con `LV_TABLE_CELL_CTRL_TEXT_CROP` la riga resta a
/// un'altezza di riga singola, ma dentro quello spazio il testo continua
/// comunque ad andare a capo se non ci sta in larghezza — verificato con
/// screenshot, non risolvibile solo allargando la colonna quanto basterebbe
/// per 3 lettere senza sottrarre spazio alle altre due colonne.
fn quality_abbrev(q: &TagQuality) -> &'static str {
    match q {
        TagQuality::Good => "G",
        TagQuality::Bad => "B",
        TagQuality::Uncertain => "U",
    }
}

/// Porta la parte rilevante di `isVisible()`: `visible_tag` (truthy live)
/// prevale su `visible` statico, che a sua volta prevale sul default "true".
/// Nota: valutata solo alla creazione — un oggetto che diventa visibile/
/// invisibile dopo un cambio tag non compare/scompare dal vivo (stesso
/// scope cut degli altri limiti noti, vedi STATUS.md).
fn is_visible(obj: &SynopticObject, tags: &TagSnapshot) -> bool {
    if let Some(vt) = lookup(tags, &obj.visible_tag) {
        return match &vt.value {
            TagValue::Bool(b) => *b,
            TagValue::Int(i) => *i != 0,
            TagValue::Float(f) => *f != 0.0,
            TagValue::Str(s) => !s.trim().is_empty(),
        };
    }
    obj.visible != Some(false)
}

/// `lvgl::Obj` non ha un `create(parent)` generato — a differenza degli altri
/// widget, `Obj::default()` crea uno schermo di primo livello (`lv_obj_create(NULL)`),
/// non un figlio. Stesso identico pattern usato dalla macro `define_object!`
/// per tutti gli altri widget, applicato a mano qui perché la macro non copre
/// `Obj` stesso (è il tipo `core` di cui gli altri wrapper sono fatti).
fn create_child_obj(parent: &mut impl NativeObject) -> anyhow::Result<lvgl::Obj> {
    unsafe {
        let ptr = lvgl_sys::lv_obj_create(
            parent
                .raw()
                .map_err(|e: LvError| anyhow::anyhow!("raw: {e:?}"))?
                .as_mut(),
        );
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_obj_create ha restituito null"))?;
        Ok(<lvgl::Obj as Widget>::from_raw(nn))
    }
}

fn render_rect(screen: &mut lvgl::Obj, obj: &SynopticObject, styles: &mut Vec<Style>) -> anyhow::Result<()> {
    let mut o = create_child_obj(screen)?;
    set_pos_size(&mut o, obj, 100.0, 50.0)?;
    apply_bg_color(&mut o, obj.fill.as_deref().unwrap_or("#555555"), styles)?;
    Ok(())
}

/// Calcola il colore testo (soglia se abilitata e valore numerico presente,
/// altrimenti colore statico) — condiviso tra creazione e aggiornamento così
/// le due strade non possono divergere.
/// Luminanza relativa (WCAG) di un colore RGB.
fn relative_luminance((r, g, b): (u8, u8, u8)) -> f64 {
    let ch = |v: u8| {
        let v = v as f64 / 255.0;
        if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/// Colore predefinito del testo, ricavato dallo SFONDO DELLA PAGINA (Q18).
///
/// Porta `defaultObjectTextColor` di `theme.ts`, e deve restare d'accordo con
/// quella: i due motori disegnano lo stesso progetto, e un testo leggibile sul
/// browser e invisibile sul pannello sarebbe un difetto di parità.
///
/// `None` quando lo sfondo manca o non è un colore piatto interpretabile: si
/// lascia il default del tema LVGL, come prima. Senza sapere cosa c'è sotto,
/// indovinare sarebbe peggio.
///
/// Soglia a 0.5, come sul web: per la luminanza relativa è il punto in cui il
/// contrasto verso il bianco e verso il nero si equivale.
fn default_text_rgb(page_background: Option<&str>) -> Option<(u8, u8, u8)> {
    let bg = parse_hex_color(page_background?)?;
    Some(if relative_luminance(bg) > 0.5 {
        (0x0f, 0x17, 0x2a)
    } else {
        (0xe2, 0xe8, 0xf0)
    })
}

fn text_color_hex(
    tv: Option<&TagSnapshotValue>,
    text_color_by_threshold: bool,
    alarm_low: Option<f64>,
    warn_low: Option<f64>,
    warn_high: Option<f64>,
    alarm_high: Option<f64>,
    static_color_hex: Option<&str>,
) -> Option<(u8, u8, u8)> {
    let threshold = if text_color_by_threshold {
        tv.map(|t| tag_value_as_f64(&t.value))
            .and_then(|v| threshold_color(v, alarm_low, warn_low, warn_high, alarm_high))
    } else {
        None
    };
    threshold.or_else(|| static_color_hex.and_then(parse_hex_color))
}

/// Applica `font_size` a un widget, se l'oggetto ne dichiara uno.
///
/// Fino al 2026-08-27 il campo era dichiarato e **ignorato**: ogni testo usciva
/// al corpo predefinito. Nella sola demo lo usano 40 oggetti — 33 didascalie a
/// 12px che uscivano più grandi del voluto, e i titoli a 19 e 22px che uscivano
/// più piccoli. La pagina si vedeva, quindi nessuno la chiamava rotta: era solo
/// diversa da come l'aveva disegnata chi l'ha fatta.
///
/// Prima di FreeType non si poteva fare: LVGL compila un font per corpo, e in
/// `lv_conf.h` ce n'era uno solo. Ora ogni corpo si apre a richiesta.
///
/// Un corpo non apribile lascia quello ereditato: un testo della misura
/// sbagliata si legge, un testo assente no.
fn apply_font_size(widget: &impl NativeObject, obj: &SynopticObject) -> anyhow::Result<()> {
    let Some(px) = obj.font_size else { return Ok(()) };
    let px = px.round();
    if !(1.0..=1000.0).contains(&px) {
        return Ok(());
    }
    let Some(font) = lvgl_font::at_size(px as u16) else { return Ok(()) };
    let ptr = widget.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_obj_set_style_text_font(ptr.as_ptr(), font, 0);
    }
    Ok(())
}

fn render_text(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
) -> anyhow::Result<LiveBinding> {
    let tv = lookup(tags, &obj.tag);
    let content = match tv {
        Some(t) => format_value(&t.value, obj.format.as_deref().or(Some("{value}"))),
        None => obj
            .text
            .clone()
            .or_else(|| obj.tag.clone())
            .unwrap_or_else(|| "Testo".to_string()),
    };
    let mut label = Label::create(screen).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    label
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    label
        .set_text(&text_cstring(&content))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    apply_font_size(&label, obj)?;

    let text_color_by_threshold = obj.text_color_by_threshold == Some(true);
    let static_color_hex = obj.color.clone().or_else(|| obj.fill.clone());
    let rgb = text_color_hex(
        tv,
        text_color_by_threshold,
        obj.alarm_low,
        obj.warn_low,
        obj.warn_high,
        obj.alarm_high,
        static_color_hex.as_deref(),
    );
    let color_style = if let Some(rgb) = rgb {
        let mut style = Style::default();
        style.set_text_color(Color::from_rgb(rgb));
        label
            .add_style(Part::Main, &mut style)
            .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
        Some(style)
    } else {
        None
    };

    let ptr = label.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    Ok(LiveBinding {
        kind: LiveKind::Text {
            ptr,
            tag: obj.tag.clone(),
            format: obj.format.clone(),
            static_text: obj.text.clone(),
            text_color_by_threshold,
            alarm_low: obj.alarm_low,
            warn_low: obj.warn_low,
            warn_high: obj.warn_high,
            alarm_high: obj.alarm_high,
            static_color_hex,
            color_style,
        },
    })
}

fn render_button(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tx: &mpsc::Sender<TagCommand>,
) -> anyhow::Result<()> {
    let mut btn = Btn::create(screen).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
    set_pos_size(&mut btn, obj, 120.0, 40.0)?;
    apply_bg_color(&mut btn, obj.fill.as_deref().unwrap_or("#3b82f6"), styles)?;
    let mut lbl = Label::create(&mut btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    lbl.set_text(&text_cstring(obj.label.as_deref().unwrap_or("Button")))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;

    if let Some(tag) = &obj.tag {
        // Stessa semantica del bottone web (SvgCanvas.tsx): scrive
        // write_value (default true) sul tag al click, non un'azione più
        // ricca (niente script/azioni multiple — vedi Q14).
        let write_value = obj
            .write_value
            .clone()
            .and_then(|v| serde_json::from_value::<TagValue>(v).ok())
            .unwrap_or(TagValue::Bool(true));
        let ptr = btn.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
        let ctx = leak_ctx(ButtonClickCtx { tag: tag.clone(), write_value, tx: tx.clone() });
        unsafe {
            lvgl_sys::lv_obj_add_event_cb(
                ptr.as_ptr(),
                Some(sws_button_clicked_cb),
                lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
                ctx,
            );
        }
    }
    Ok(())
}

/// Bottone di navigazione — stessa forma del bottone normale ma sempre
/// statico (nessun `LiveBinding`, come `render_button`): non scrive un tag,
/// manda `obj.target_page` su un canale separato (`nav_tx`) che il chiamante
/// (`main.rs`) usa per ricaricare l'intera pagina, non solo aggiornare un
/// widget. Bordo blu + ">" al posto della "▶" del web (stesso motivo delle
/// altre scelte ASCII-only in questo file: niente glyph mancanti nel font
/// LVGL, vedi Q14).
fn render_navbutton(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    nav_tx: &mpsc::Sender<String>,
) -> anyhow::Result<()> {
    let mut btn = Btn::create(screen).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
    set_pos_size(&mut btn, obj, 140.0, 36.0)?;
    apply_bg_color(&mut btn, obj.fill.as_deref().unwrap_or("#0f172a"), styles)?;
    let mut lbl = Label::create(&mut btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    lbl.set_text(&text_cstring(&format!("> {}", obj.label.as_deref().unwrap_or("Go to page"))))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;

    if let Some(target_page) = &obj.target_page {
        let ptr = btn.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
        let ctx = leak_ctx(NavClickCtx { target_page: target_page.clone(), tx: nav_tx.clone() });
        unsafe {
            lvgl_sys::lv_obj_add_event_cb(
                ptr.as_ptr(),
                Some(sws_navbutton_clicked_cb),
                lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
                ctx,
            );
        }
    }
    Ok(())
}

/// Colore + stato on/off del LED, condiviso tra creazione e aggiornamento.
fn led_state(
    tv: Option<&TagSnapshotValue>,
    on_value: &OnValue,
    on_color: &str,
    off_color: &str,
) -> (bool, bool, String) {
    let is_on = match tv {
        None => false,
        Some(t) => match on_value {
            OnValue::Bool(want) => tag_value_as_bool(&t.value) == *want,
            OnValue::Str(want) => &tag_value_as_string(&t.value) == want,
        },
    };
    let bad_quality = matches!(tv, Some(t) if t.quality == TagQuality::Bad);
    let color_hex = if tv.is_none() {
        "#334155".to_string()
    } else if bad_quality {
        "#ef4444".to_string()
    } else if is_on {
        on_color.to_string()
    } else {
        off_color.to_string()
    };
    (is_on, bad_quality, color_hex)
}

fn render_led(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
) -> anyhow::Result<LiveBinding> {
    let mut led = Led::create(screen).map_err(|e| anyhow::anyhow!("Led::create: {e:?}"))?;
    let d = obj.width.unwrap_or(24.0);
    set_pos_size(&mut led, obj, d, d)?;

    let on_value = obj.on_value.clone().unwrap_or(OnValue::Bool(true));
    let on_color = obj.on_color.clone().unwrap_or_else(|| "#22c55e".to_string());
    let off_color = obj.off_color.clone().unwrap_or_else(|| "#334155".to_string());

    let tv = lookup(tags, &obj.tag);
    let (is_on, bad_quality, color_hex) = led_state(tv, &on_value, &on_color, &off_color);

    let ptr = led.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    // lv_led NON legge lo style bg_color per il proprio colore (a differenza
    // di quasi tutti gli altri widget): tiene un campo interno `color`
    // impostabile solo con lv_led_set_color, di default il colore primario
    // del tema (blu) — usare lo Style qui sarebbe silenziosamente ignorato,
    // vedi il sorgente C in lv_led.c (lv_led_event, ramo LV_EVENT_DRAW_MAIN).
    if let Some(rgb) = parse_hex_color(&color_hex) {
        unsafe { lvgl_sys::lv_led_set_color(ptr.as_ptr(), Color::from_rgb(rgb).into()) };
    }
    if tv.is_some() && (is_on || bad_quality) {
        led.on().map_err(|e| anyhow::anyhow!("led on: {e:?}"))?;
    } else {
        led.off().map_err(|e| anyhow::anyhow!("led off: {e:?}"))?;
    }

    Ok(LiveBinding {
        kind: LiveKind::Led { ptr, tag: obj.tag.clone(), on_value, on_color, off_color },
    })
}

fn render_slider(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
    tx: &mpsc::Sender<TagCommand>,
) -> anyhow::Result<LiveBinding> {
    let mut slider = Slider::create(screen).map_err(|e| anyhow::anyhow!("Slider::create: {e:?}"))?;

    // lv_slider disegna la traccia grande quanto l'intero oggetto (nessun
    // padding "di sfondo" che la assottigli, a differenza di come appare
    // nel web) — scoperto sul primo test su hardware reale
    // (tc620-a-p3-c6-07aff9.local, 2026-08-10): un box alto 44px (com'è
    // nella demo) dà una traccia visivamente "grassa". Fix: l'oggetto
    // stesso è sottile (16px, la convenzione LVGL comune per una traccia
    // slider), centrato nel box dichiarato — MA con l'area di click estesa
    // (`lv_obj_set_ext_click_area`, la stessa funzione che `lv_slider_create`
    // usa già di default per un margine più piccolo — verificato in
    // vendor/lvgl/src/widgets/lv_slider.c prima di riusarla) fino a coprire
    // l'intero box originale: tocco preciso quanto prima, solo la traccia
    // disegnata è sottile.
    let box_h = obj.height.unwrap_or(50.0);
    let track_h = 16.0f64.min(box_h);
    let y_offset = (box_h - track_h) / 2.0;
    {
        let x = obj.x.unwrap_or(0.0).round() as i16;
        let y = (obj.y.unwrap_or(0.0) + y_offset).round() as i16;
        let width = obj.width.unwrap_or(200.0).round() as i16;
        slider
            .set_pos(x, y)
            .map_err(|e| anyhow::anyhow!("set_pos (slider sottile): {e:?}"))?;
        slider
            .set_size(width, track_h.round() as i16)
            .map_err(|e| anyhow::anyhow!("set_size (slider sottile): {e:?}"))?;
    }
    let ptr = slider.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_obj_set_ext_click_area(ptr.as_ptr(), y_offset.round() as lvgl_sys::lv_coord_t);
    }
    // lv_slider_t è internamente uno specializzato lv_bar_t in LVGL: non
    // esistono lv_slider_set_range/set_value dedicati, si riusano quelli di
    // bar (confermato dai bindgen bindings reali, non da supposizione) — vedi
    // init_bar_like, condivisa con progress_bar per lo stesso motivo.
    let binding = init_bar_like(ptr, obj, tags)?;

    // Solo lo slider è interattivo — non progress_bar, che condivide
    // init_bar_like ma resta un indicatore read-only (nessuna callback
    // registrata lì): la wiring va qui, non dentro init_bar_like.
    if let Some(tag) = &obj.tag {
        let ctx = leak_ctx(WidgetChangeCtx { tag: tag.clone(), tx: tx.clone() });
        unsafe {
            lvgl_sys::lv_obj_add_event_cb(
                ptr.as_ptr(),
                Some(sws_slider_changed_cb),
                lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED,
                ctx,
            );
        }
    }
    Ok(binding)
}

fn render_progress_bar(screen: &mut lvgl::Obj, obj: &SynopticObject, tags: &TagSnapshot) -> anyhow::Result<LiveBinding> {
    let mut bar = Bar::create(screen).map_err(|e| anyhow::anyhow!("Bar::create: {e:?}"))?;
    set_pos_size(&mut bar, obj, 200.0, 24.0)?;
    let ptr = bar.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    init_bar_like(ptr, obj, tags)
}

fn init_bar_like(
    ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    obj: &SynopticObject,
    tags: &TagSnapshot,
) -> anyhow::Result<LiveBinding> {
    let min = obj.min.unwrap_or(0.0);
    let max = obj.max.unwrap_or(100.0);
    let raw = lookup(tags, &obj.tag)
        .map(|t| tag_value_as_f64(&t.value))
        .unwrap_or(min)
        .clamp(min.min(max), min.max(max));
    unsafe {
        lvgl_sys::lv_bar_set_range(ptr.as_ptr(), min.round() as i32, max.round() as i32);
        lvgl_sys::lv_bar_set_value(ptr.as_ptr(), raw.round() as i32, lvgl::Animation::OFF.into());
    }
    Ok(LiveBinding { kind: LiveKind::BarLike { ptr, tag: obj.tag.clone(), min, max } })
}

/// `bar_chart`: una `lv_bar` per serie, affiancate. Solo l'orientamento
/// `"vertical"` (il default web) è disegnato — `"horizontal"` è segnalato
/// come non supportato invece di renderizzare l'orientamento sbagliato,
/// stesso principio già usato per `alarm_viewer_mode`. La scelta fra
/// riempimento orizzontale/verticale in `lv_bar` è automatica in base
/// all'aspect ratio del widget stesso (`hor = barw >= barh`, verificato in
/// `lv_bar.c` prima di scrivere questo codice): bastano barre più alte che
/// larghe per ottenere un riempimento verticale, nessun flag dedicato da
/// impostare.
fn render_bar_chart(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
) -> anyhow::Result<LiveBinding> {
    let orient = obj.bar_orientation.as_deref().unwrap_or("vertical");
    if orient != "vertical" {
        anyhow::bail!("bar_orientation '{orient}' non supportato da LVGL (solo 'vertical')");
    }
    let series = obj.bar_series.clone().unwrap_or_default();
    let w = obj.width.unwrap_or(240.0);
    let h = obj.height.unwrap_or(180.0);
    let show_values = obj.bar_show_values.unwrap_or(true);
    let show_labels = obj.bar_show_labels.unwrap_or(true);
    let unit = obj.unit.clone().unwrap_or_default();

    let pad_t = if show_values { 16.0 } else { 4.0 };
    let pad_b = if show_labels { 16.0 } else { 4.0 };
    let plot_h = (h - pad_t - pad_b).max(8.0);
    let n = series.len().max(1);
    let slot_w = w / n as f64;
    let gap = obj.bar_gap.unwrap_or(0.2).clamp(0.0, 0.9);
    // `bar_w < plot_h` non è solo estetico: `lv_bar.c` decide il riempimento
    // orizzontale/verticale confrontando le dimensioni del widget stesso
    // (`hor = barw >= barh`), quindi con poche serie/gap piccolo/box largo
    // `slot_w * (1 - gap)` può facilmente restare più largo che alto —
    // provato dal vivo: due sole serie su un box 280×110 davano barre
    // riempite da sinistra invece che dal basso, nonostante l'orientamento
    // "vertical" dichiarato. Il clamp qui sotto garantisce il riempimento
    // verticale indipendentemente da quante serie/quanto gap sceglie il
    // synottico, non solo nel caso comune con molte serie strette.
    let bar_w = (slot_w * (1.0 - gap)).min(plot_h * 0.9).max(4.0);

    let mut bars = Vec::with_capacity(series.len());
    for (i, s) in series.iter().enumerate() {
        let min = s.min.unwrap_or(0.0);
        let max = s.max.unwrap_or(100.0);
        let bx = obj.x.unwrap_or(0.0) + i as f64 * slot_w + (slot_w - bar_w) / 2.0;

        let mut bar = Bar::create(screen).map_err(|e| anyhow::anyhow!("Bar::create: {e:?}"))?;
        bar.set_pos(bx.round() as i16, (obj.y.unwrap_or(0.0) + pad_t).round() as i16)
            .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        bar.set_size(bar_w.round() as i16, plot_h.round() as i16)
            .map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
        let bar_ptr = bar.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
        unsafe {
            lvgl_sys::lv_bar_set_range(bar_ptr.as_ptr(), min.round() as i32, max.round() as i32);
        }
        if let Some(rgb) = parse_hex_color(&s.color) {
            let mut indic_style = Style::default();
            indic_style.set_bg_color(Color::from_rgb(rgb));
            bar.add_style(Part::Indicator, &mut indic_style)
                .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
            styles.push(indic_style);
        }

        let value_ptr = if show_values {
            let mut lbl = Label::create(screen).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
            lbl.set_pos(bx.round() as i16, obj.y.unwrap_or(0.0).round() as i16)
                .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
            lbl.set_text(&text_cstring("")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
            Some(lbl.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?)
        } else {
            None
        };

        if show_labels {
            let mut lbl = Label::create(screen).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
            lbl.set_pos(bx.round() as i16, (obj.y.unwrap_or(0.0) + pad_t + plot_h + 2.0).round() as i16)
                .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
            lbl.set_text(&text_cstring(&s.label)).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
        }

        bars.push(BarChartBarBinding {
            bar_ptr,
            value_ptr,
            tag: s.tag.clone(),
            min,
            max,
            unit: unit.clone(),
            show_values,
        });
    }

    // Valore iniziale, stessa logica di update_bindings — evita un frame
    // vuoto/a zero prima del primo giro di update_bindings.
    for b in &bars {
        let raw = lookup(tags, &Some(b.tag.clone()))
            .map(|t| tag_value_as_f64(&t.value))
            .unwrap_or(b.min)
            .clamp(b.min.min(b.max), b.min.max(b.max));
        unsafe {
            lvgl_sys::lv_bar_set_value(b.bar_ptr.as_ptr(), raw.round() as i32, lvgl::Animation::OFF.into());
            if let Some(vp) = b.value_ptr {
                lvgl_sys::lv_label_set_text(vp.as_ptr(), text_cstring(&format!("{raw:.1}{}", b.unit)).as_ptr());
            }
        }
    }

    Ok(LiveBinding { kind: LiveKind::BarChart { bars } })
}

fn render_checkbox(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
    tx: &mpsc::Sender<TagCommand>,
) -> anyhow::Result<LiveBinding> {
    let mut cb = Checkbox::create(screen).map_err(|e| anyhow::anyhow!("Checkbox::create: {e:?}"))?;
    // Niente set_size: la checkbox LVGL si dimensiona sul proprio testo, come
    // la stragrande maggioranza delle implementazioni checkbox — forzare una
    // size esplicita rischierebbe solo di tagliare l'etichetta.
    cb.set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    cb.set_text(&text_cstring(obj.label.as_deref().unwrap_or("Checkbox")))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let ptr = cb.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    // Stessa semantica di SvgCanvas.tsx: checked_value/unchecked_value
    // default a true/false ma possono essere qualunque scalare (es. stringhe
    // "ON"/"OFF") — vedi checkbox_is_checked e CheckboxToggleCtx.
    let checked_value = obj.checked_value.clone().unwrap_or(serde_json::Value::Bool(true));
    let unchecked_value = obj.unchecked_value.clone().unwrap_or(serde_json::Value::Bool(false));
    apply_checked_state(ptr, checkbox_is_checked(lookup(tags, &obj.tag), &checked_value));

    if let Some(tag) = &obj.tag {
        let checked_tag_value = serde_json::from_value::<TagValue>(checked_value.clone()).unwrap_or(TagValue::Bool(true));
        let unchecked_tag_value = serde_json::from_value::<TagValue>(unchecked_value.clone()).unwrap_or(TagValue::Bool(false));
        let ctx = leak_ctx(CheckboxToggleCtx {
            tag: tag.clone(),
            checked_value: checked_tag_value,
            unchecked_value: unchecked_tag_value,
            tx: tx.clone(),
        });
        unsafe {
            lvgl_sys::lv_obj_add_event_cb(
                ptr.as_ptr(),
                Some(sws_checkbox_toggled_cb),
                lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED,
                ctx,
            );
        }
    }
    Ok(LiveBinding { kind: LiveKind::Checkbox { ptr, tag: obj.tag.clone(), checked_value } })
}

/// Approssimazione dichiarata: LVGL non ha un widget "radio" nativo (solo
/// checkbox + una convenzione di stile/gruppo sopra); un radio SWS viene
/// quindi disegnato come una checkbox (quadrata, non tonda) — stesso spirito
/// di "graphics won't be pixel-perfect but that's acceptable" del brief
/// originale. Vedi ADR 0002.
fn render_radio(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
    tx: &mpsc::Sender<TagCommand>,
) -> anyhow::Result<LiveBinding> {
    render_checkbox(screen, obj, tags, tx)
}

fn apply_checked_state(ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, checked: bool) {
    unsafe {
        if checked {
            lvgl_sys::lv_obj_add_state(ptr.as_ptr(), lvgl_sys::LV_STATE_CHECKED as lvgl_sys::lv_state_t);
        } else {
            lvgl_sys::lv_obj_clear_state(ptr.as_ptr(), lvgl_sys::LV_STATE_CHECKED as lvgl_sys::lv_state_t);
        }
    }
}

/// Approssimazione dichiarata: LVGL non ha un primitivo ellisse — un cerchio
/// perfetto (raggio d'angolo massimo su un `Obj` altrimenti identico a
/// `render_rect`) quando `width == height`, altrimenti una "pillola"
/// stadium-shaped per aspect ratio diversi. Non pixel-perfect ma riconoscibile
/// — stesso compromesso accettato nel brief originale.
fn render_ellipse(screen: &mut lvgl::Obj, obj: &SynopticObject, styles: &mut Vec<Style>) -> anyhow::Result<()> {
    let mut o = create_child_obj(screen)?;
    set_pos_size(&mut o, obj, 100.0, 100.0)?;
    apply_bg_color(&mut o, obj.fill.as_deref().unwrap_or("#555555"), styles)?;
    let mut radius_style = Style::default();
    radius_style.set_radius(lvgl_sys::LV_RADIUS_CIRCLE as i16);
    o.add_style(Part::Main, &mut radius_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(radius_style);
    Ok(())
}

/// Statica, nessun tag (stessa scelta del `line` web — solo forma). A
/// differenza di quasi tutti gli altri widget di questo file, `lv_line`
/// disegna i punti **relativi alla posizione dell'oggetto stesso**, non
/// assoluti sullo schermo (verificato in `lv_line.c`, ramo `LV_EVENT_DRAW_MAIN`:
/// `p.x = point_array[i].x + area.x1`) — da cui la scelta di passare `(0,0)` e
/// `(x2-x1, y2-y1)` invece di `(x1,y1)`/`(x2,y2)`. Niente `set_size`: la classe
/// `lv_line` si auto-dimensiona sul contenuto (`LV_SIZE_CONTENT`), chiamato da
/// `lv_line_set_points` stesso.
fn render_line(screen: &mut lvgl::Obj, obj: &SynopticObject, styles: &mut Vec<Style>) -> anyhow::Result<()> {
    let mut line = Line::create(screen).map_err(|e| anyhow::anyhow!("Line::create: {e:?}"))?;
    let x1 = obj.x.unwrap_or(0.0);
    let y1 = obj.y.unwrap_or(0.0);
    let x2 = obj.x2.unwrap_or(x1 + 100.0);
    let y2 = obj.y2.unwrap_or(y1);
    line.set_pos(x1.round() as i16, y1.round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;

    // lv_line_set_points salva solo l'indirizzo dell'array ("the array needs
    // to be alive while the line exists", lv_line.h) — Box::leak per storage
    // 'static, stesso principio di lvgl_display.rs. La linea non cambia mai
    // dopo la creazione (statica, come rect/ellipse), quindi due punti bastano
    // per tutta la vita del widget.
    let points: &'static [lvgl_sys::lv_point_t; 2] = Box::leak(Box::new([
        lvgl_sys::lv_point_t { x: 0, y: 0 },
        lvgl_sys::lv_point_t { x: (x2 - x1).round() as i16, y: (y2 - y1).round() as i16 },
    ]));
    let ptr = line.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_line_set_points(ptr.as_ptr(), points.as_ptr(), 2);
    }

    let mut style = Style::default();
    if let Some(rgb) = obj.stroke.as_deref().and_then(parse_hex_color) {
        style.set_line_color(Color::from_rgb(rgb));
    }
    style.set_line_width(obj.stroke_width.unwrap_or(2.0).round() as i16);
    line.add_style(Part::Main, &mut style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(style);
    Ok(())
}

/// Ago + arco valore su una scala 270° (stesso range del gauge web,
/// `lv_meter_set_scale_range`: `rotation` è l'offset dalle ore 3 in senso
/// orario — verificato in `lv_meter.h`, non assunto dal nome — `rotation=135,
/// angle_range=270` lascia il varco in basso, stesso aspetto del gauge web).
///
/// **Semplificazione dichiarata rispetto al web**: l'arco colorato per soglia
/// (`thresholdColor`) prende colore solo alla creazione, dal valore iniziale —
/// `lv_meter` non espone un setter per il colore di un indicatore già creato
/// (solo `set_indicator_value`/`start_value`/`end_value`, verificato in
/// `lv_meter.h`), quindi non segue le soglie dal vivo come nel web. L'ago e il
/// valore numerico restano invece pienamente dal vivo. Vedi Q14.
fn render_gauge(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
) -> anyhow::Result<LiveBinding> {
    let mut meter = Meter::create(screen).map_err(|e| anyhow::anyhow!("Meter::create: {e:?}"))?;
    // `lv_meter` non forza mai una forma circolare da solo: segue fedelmente
    // il box assegnato, quindi width != height produce uno sfondo ovale (non
    // un vero cerchio) — scoperto sul primo test su hardware reale
    // (tc620-a-p3-c6-07aff9.local, 2026-08-10) con la demo del repo, che ha
    // width:220/height:190. Forza un quadrato (il lato minore) centrato nel
    // box originale invece di toccare le dimensioni dichiarate dall'oggetto
    // — un gauge resta circolare qualunque box gli venga assegnato, come
    // probabilmente fa già l'SVG web (un cerchio vero, non legato a un
    // rettangolo contenitore).
    let box_x = obj.x.unwrap_or(0.0);
    let box_y = obj.y.unwrap_or(0.0);
    let box_w = obj.width.unwrap_or(160.0);
    let box_h = obj.height.unwrap_or(140.0);
    let side = box_w.min(box_h);
    let x = (box_x + (box_w - side) / 2.0).round() as i16;
    let y = (box_y + (box_h - side) / 2.0).round() as i16;
    let side = side.round() as i16;
    meter.set_pos(x, y).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    meter.set_size(side, side).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    let ptr = meter.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let min = obj.min.unwrap_or(0.0);
    let max = obj.max.unwrap_or(100.0);
    let tv = lookup(tags, &obj.tag);
    let raw = tv.map(|t| tag_value_as_f64(&t.value)).unwrap_or(min).clamp(min.min(max), min.max(max));

    let arc_rgb = threshold_color(raw, obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high)
        .or_else(|| obj.fill.as_deref().and_then(parse_hex_color))
        .unwrap_or((34, 197, 94)); // #22c55e, stesso default del web

    let (needle_indic, arc_indic) = unsafe {
        let scale = lvgl_sys::lv_meter_add_scale(ptr.as_ptr());
        lvgl_sys::lv_meter_set_scale_range(ptr.as_ptr(), scale, min.round() as i32, max.round() as i32, 270, 135);
        lvgl_sys::lv_meter_set_scale_ticks(ptr.as_ptr(), scale, 21, 2, 6, lvgl_sys::lv_palette_main(lvgl_sys::lv_palette_t_LV_PALETTE_GREY));
        lvgl_sys::lv_meter_set_scale_major_ticks(ptr.as_ptr(), scale, 4, 3, 10, Color::from_rgb((148, 163, 184)).into(), 10);

        let arc = lvgl_sys::lv_meter_add_arc(ptr.as_ptr(), scale, 6, Color::from_rgb(arc_rgb).into(), 0);
        lvgl_sys::lv_meter_set_indicator_start_value(ptr.as_ptr(), arc, min.round() as i32);
        lvgl_sys::lv_meter_set_indicator_end_value(ptr.as_ptr(), arc, raw.round() as i32);

        let needle =
            lvgl_sys::lv_meter_add_needle_line(ptr.as_ptr(), scale, 3, Color::from_rgb((226, 232, 240)).into(), -8);
        lvgl_sys::lv_meter_set_indicator_value(ptr.as_ptr(), needle, raw.round() as i32);

        (needle, arc)
    };

    // Testo valore, centrato in basso nel quadrante (stesso posto del web) —
    // widget figlio separato, aggiornato dal vivo come qualunque altro Text.
    //
    // Si allinea invece di calcolare la x, per due motivi che prima davano
    // entrambi lo stesso sintomo (etichetta in basso a destra, fuori dal
    // cerchio — visto sul WP630 il 2026-08-26):
    //
    // 1. il padre è il **quadrato** (`side`), non il box dichiarato. Usare
    //    `w`/`h` del box su un gauge 220x190 metteva l'etichetta a 110-20=90
    //    dentro un padre largo 190: né centrata né dove si credeva.
    // 2. il `-20` era un'ipotesi sulla metà della larghezza del testo. Ma il
    //    testo cambia — "0.0" e "100.0 bar" non sono larghi uguale — e con
    //    l'unità di misura sbordava. Nessun numero fisso può indovinarlo.
    //
    // `LV_ALIGN_TOP_MID` lo centra sulla larghezza vera, qualunque essa sia;
    // l'offset verticale resta quello di prima, ma calcolato sul lato del
    // quadrato, che è ciò che il cerchio occupa davvero.
    let mut value_label = Label::create(&mut meter).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_obj_align(
            value_label.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr(),
            lvgl_sys::LV_ALIGN_TOP_MID as lvgl_sys::lv_align_t,
            0,
            (side as f64 * 0.72) as lvgl_sys::lv_coord_t,
        );
    }
    let unit_suffix = obj.unit.as_deref().map(|u| format!(" {u}")).unwrap_or_default();
    value_label
        .set_text(&text_cstring(&format!("{raw:.1}{unit_suffix}")))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let value_ptr = value_label.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    Ok(LiveBinding {
        kind: LiveKind::Gauge {
            ptr,
            needle_indic,
            arc_indic,
            value_ptr,
            tag: obj.tag.clone(),
            min,
            max,
            unit: obj.unit.clone(),
        },
    })
}

/// Stesso modello dati di `text_list` (`value`→`label`→`color`, con match per
/// range o per uguaglianza — vedi `match_text_list_entry`). A differenza del
/// `led`, il cerchio qui è un `lv_obj` normale con `radius` massimo (stessa
/// tecnica di `render_ellipse`): legge `bg_color` dallo `Style` senza le
/// sorprese di `lv_led_set_color` (vedi Q14) — è proprio `lv_led` l'eccezione,
/// non questo.
fn render_state_lamp(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
) -> anyhow::Result<LiveBinding> {
    let h = obj.height.unwrap_or(24.0);
    let entries = obj.text_list_entries.clone().unwrap_or_default();
    let tv = lookup(tags, &obj.tag);
    let entry = match_text_list_entry(&entries, tv);
    let lamp_hex = entry
        .and_then(|e| e.color.as_deref())
        .unwrap_or("#334155")
        .to_string();
    let label_text = entry
        .map(|e| e.label.clone())
        .or_else(|| obj.text_list_default.clone())
        .unwrap_or_default();
    let label_hex = if entry.is_some() { lamp_hex.clone() } else { obj.text_list_default_color.clone().unwrap_or("#94a3b8".to_string()) };

    let mut lamp = create_child_obj(screen)?;
    lamp.set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    lamp.set_size(h.round() as i16, h.round() as i16)
        .map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    let mut lamp_style = Style::default();
    lamp_style.set_radius(lvgl_sys::LV_RADIUS_CIRCLE as i16);
    if let Some(rgb) = parse_hex_color(&lamp_hex) {
        lamp_style.set_bg_color(Color::from_rgb(rgb));
    }
    lamp.add_style(Part::Main, &mut lamp_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    let lamp_ptr = lamp.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let mut label = Label::create(screen).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    label
        .set_pos((obj.x.unwrap_or(0.0) + h + 6.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    label
        .set_text(&text_cstring(&label_text))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let mut label_style = Style::default();
    if let Some(rgb) = parse_hex_color(&label_hex) {
        label_style.set_text_color(Color::from_rgb(rgb));
    }
    label
        .add_style(Part::Main, &mut label_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    let label_ptr = label.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    Ok(LiveBinding {
        kind: LiveKind::StateLamp {
            lamp_ptr,
            lamp_style,
            label_ptr,
            label_style,
            tag: obj.tag.clone(),
            entries,
            default_label: obj.text_list_default.clone(),
            default_color: obj.text_list_default_color.clone(),
        },
    })
}

/// `text_list`: stessa logica dati di `state_lamp` (`match_text_list_entry`
/// contro `text_list_entries`), ma senza il cerchio colorato — solo
/// un'etichetta, il cui colore segue quello dell'entry quando c'è.
fn render_text_list(screen: &mut lvgl::Obj, obj: &SynopticObject, tags: &TagSnapshot) -> anyhow::Result<LiveBinding> {
    let entries = obj.text_list_entries.clone().unwrap_or_default();
    let tv = lookup(tags, &obj.tag);
    let entry = match_text_list_entry(&entries, tv);
    let label_text = entry
        .map(|e| e.label.clone())
        .or_else(|| obj.text_list_default.clone())
        .unwrap_or_default();
    let label_hex = entry
        .and_then(|e| e.color.clone())
        .or_else(|| obj.text_list_default_color.clone())
        .unwrap_or_else(|| "#f1f5f9".to_string());

    let mut label = Label::create(screen).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    label
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    label
        .set_text(&text_cstring(&label_text))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let mut label_style = Style::default();
    if let Some(rgb) = parse_hex_color(&label_hex) {
        label_style.set_text_color(Color::from_rgb(rgb));
    }
    label
        .add_style(Part::Main, &mut label_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    let label_ptr = label.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    Ok(LiveBinding {
        kind: LiveKind::TextList {
            label_ptr,
            label_style,
            tag: obj.tag.clone(),
            entries,
            default_label: obj.text_list_default.clone(),
            default_color: obj.text_list_default_color.clone(),
        },
    })
}

/// Tabella statica a 3 colonne (label/valore/qualità) da `table_rows` — non
/// un datagrid dinamico (niente sort/pagine, stessa scelta della versione
/// web). `lv_table` si auto-dimensiona sul contenuto (`LV_SIZE_CONTENT`,
/// come `lv_line`): niente `set_size`, solo `set_pos` + larghezze colonna.
///
/// Ogni cella usa `LV_TABLE_CELL_CTRL_TEXT_CROP`: forza l'altezza riga a una
/// singola riga di testo indipendentemente dal contenuto (verificato in
/// `lv_table.c` — senza, `lv_table` va a capo dentro la cella e fa crescere
/// l'intera riga). **Non basta da solo**: dentro quell'altezza fissa il testo
/// che non entra in larghezza continua comunque ad andare a capo (verificato
/// con screenshot — "OK"/"UNC" a 45px di colonna si spezzavano su due righe
/// una lettera per riga). La combinazione che funziona è crop + contenuto
/// garantito corto: colonna qualità a una sola lettera (`quality_abbrev`),
/// non un'abbreviazione a 2-3 lettere.
fn render_table(screen: &mut lvgl::Obj, obj: &SynopticObject, tags: &TagSnapshot) -> anyhow::Result<LiveBinding> {
    let mut table = Table::create(screen).map_err(|e| anyhow::anyhow!("Table::create: {e:?}"))?;
    table
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;

    let rows = obj.table_rows.clone().unwrap_or_default();
    let row_cnt = (rows.len() + 1) as u16;
    table.set_col_cnt(3).map_err(|e| anyhow::anyhow!("set_col_cnt: {e:?}"))?;
    table.set_row_cnt(row_cnt).map_err(|e| anyhow::anyhow!("set_row_cnt: {e:?}"))?;

    let w = obj.width.unwrap_or(300.0);
    let ptr = table.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 0, (w * 0.40) as i16);
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 1, (w * 0.40) as i16);
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 2, (w * 0.20) as i16);
        for row in 0..row_cnt {
            for col in 0..3 {
                lvgl_sys::lv_table_add_cell_ctrl(
                    ptr.as_ptr(),
                    row,
                    col,
                    lvgl_sys::LV_TABLE_CELL_CTRL_TEXT_CROP as lvgl_sys::lv_table_cell_ctrl_t,
                );
            }
        }
    }

    table
        .set_cell_value(0, 0, &text_cstring(obj.label.as_deref().unwrap_or("DATI")))
        .map_err(|e| anyhow::anyhow!("set_cell_value: {e:?}"))?;
    table
        .set_cell_value(0, 1, &text_cstring("VAL"))
        .map_err(|e| anyhow::anyhow!("set_cell_value: {e:?}"))?;
    table
        .set_cell_value(0, 2, &text_cstring("Q"))
        .map_err(|e| anyhow::anyhow!("set_cell_value: {e:?}"))?;
    for (i, row) in rows.iter().enumerate() {
        table
            .set_cell_value((i + 1) as u16, 0, &text_cstring(&row.label))
            .map_err(|e| anyhow::anyhow!("set_cell_value: {e:?}"))?;
    }
    update_table_data_cells(ptr, &rows, tags);

    Ok(LiveBinding { kind: LiveKind::Table { ptr, rows } })
}

/// Colonne valore/qualità di una riga tabella — condivisa tra creazione e
/// aggiornamento (stesso principio di `led_state`/`text_color_hex`) così le
/// due strade non possono divergere.
fn update_table_data_cells(ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, rows: &[TableRow], tags: &TagSnapshot) {
    for (i, row) in rows.iter().enumerate() {
        let tv = tags.get(&row.tag);
        let val_text = tv.map(|t| format_value(&t.value, row.format.as_deref())).unwrap_or_else(|| "-".to_string());
        let qual_text = tv.map(|t| quality_abbrev(&t.quality)).unwrap_or("-");
        unsafe {
            lvgl_sys::lv_table_set_cell_value(ptr.as_ptr(), (i + 1) as u16, 1, text_cstring(&val_text).as_ptr());
            lvgl_sys::lv_table_set_cell_value(ptr.as_ptr(), (i + 1) as u16, 2, text_cstring(qual_text).as_ptr());
        }
    }
}

/// Trend: `lv_chart` in modalità `SCATTER` (non `LINE`) — a differenza di
/// `LINE`, dove l'asse X è solo l'indice del punto nell'array (spaziatura
/// uniforme fittizia), `SCATTER` accetta una X esplicita per punto, quindi il
/// grafico riflette il vero istante di ogni campione invece di far sembrare
/// uniformemente distribuiti campioni che potrebbero non esserlo (gap del
/// tag, deadband dello storico, ecc.) — verificato leggendo `lv_chart.h`
/// prima di scegliere, non assunto. Coordinate X in **secondi dall'inizio
/// della finestra**, non Unix ms assoluti: `lv_coord_t` è un `i16` (`vedi
/// LV_USE_LARGE_COORD` in `lv_conf.h`, qui disattivato), un Unix ms reale
/// (13 cifre) non ci entrerebbe nemmeno lontanamente — da qui anche il
/// clamp di `window_s` a `i16::MAX` secondi (~9h, ben oltre qualunque
/// finestra trend sensata per un pannello).
///
/// I dati arrivano da un poller REST in background per serie
/// (`client::spawn_history_poller`), non da `/ws/tags`: lo storico non è un
/// delta live, va interrogato a intervalli (`GET /api/history/:tag`, come fa
/// `TrendCanvas.tsx`). `update_bindings` legge `SharedHistory` a ogni frame
/// ma riscrive il chart solo quando il poller ha prodotto una versione
/// nuova.
fn render_trend(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
) -> anyhow::Result<LiveBinding> {
    let mut chart = Chart::create(screen).map_err(|e| anyhow::anyhow!("Chart::create: {e:?}"))?;
    set_pos_size(&mut chart, obj, 360.0, 180.0)?;
    let ptr = chart.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    // Stesso range accettato da lv_coord_t (i16) — vedi commento sopra.
    let window_s = obj.window_s.unwrap_or(60.0).round().clamp(1.0, i16::MAX as f64) as u64;
    let autofit = obj.y_min.is_none() && obj.y_max.is_none();

    let traces = resolve_trend_traces(obj);

    unsafe {
        lvgl_sys::lv_chart_set_type(ptr.as_ptr(), lvgl_sys::LV_CHART_TYPE_SCATTER as lvgl_sys::lv_chart_type_t);
        lvgl_sys::lv_chart_set_div_line_count(ptr.as_ptr(), 3, 3);
        lvgl_sys::lv_chart_set_range(
            ptr.as_ptr(),
            lvgl_sys::LV_CHART_AXIS_PRIMARY_X as lvgl_sys::lv_chart_axis_t,
            0,
            window_s as i16,
        );
        let (y_lo, y_hi) = match (obj.y_min, obj.y_max) {
            (Some(lo), Some(hi)) => (lo.round() as i16, hi.round() as i16),
            _ => (0, 100), // placeholder prima del primo poll quando in autofit
        };
        lvgl_sys::lv_chart_set_range(ptr.as_ptr(), lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t, y_lo, y_hi);
    }

    let backfill = obj.opcua_backfill.unwrap_or(false);
    let mut series = Vec::with_capacity(traces.len());
    for (i, trace) in traces.iter().enumerate() {
        // Il colore della traccia (formato nuovo) vince; se assente si ricade
        // sulla precedenza di prima — `trend_series_styles[i]`, poi
        // `line_color` per la serie 0, poi la tavolozza.
        let rgb = trace
            .color
            .as_deref()
            .and_then(parse_hex_color)
            .unwrap_or_else(|| trend_series_color(i, obj));
        let tag = &trace.tag;
        let ser = unsafe { chart_add_series(ptr, rgb) };
        let shared = client::spawn_history_poller(rt_handle, base_url.to_string(), tag.clone(), window_s, backfill);
        series.push(TrendSeriesBinding { ser, shared, last_seen_version: 0, last_samples: Vec::new() });
    }

    Ok(LiveBinding { kind: LiveKind::Trend { ptr, series, window_s, autofit } })
}

/// `sparkline`: stesso principio del `trend` (poller REST in background via
/// `client::spawn_history_poller`, la storia non è un delta live) ma una
/// sola serie, sempre autofit (nessun `y_min`/`y_max` nello schema web per
/// questo tipo) e senza griglia/assi — `lv_chart_set_div_line_count(0, 0)`
/// per il solo grafico "nudo" che il nome del widget implica.
fn render_sparkline(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
) -> anyhow::Result<LiveBinding> {
    let mut chart = Chart::create(screen).map_err(|e| anyhow::anyhow!("Chart::create: {e:?}"))?;
    set_pos_size(&mut chart, obj, 120.0, 30.0)?;
    let ptr = chart.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    // Sfondo/bordo del tema di default disegna un pannello — il web non ne
    // ha uno per la sparkline (solo la linea), quindi li azzeriamo qui.
    let mut bg_style = Style::default();
    bg_style.set_bg_opa(lvgl::style::Opacity::OPA_TRANSP);
    bg_style.set_border_width(0);
    bg_style.set_pad_left(0);
    bg_style.set_pad_right(0);
    bg_style.set_pad_top(0);
    bg_style.set_pad_bottom(0);
    chart
        .add_style(Part::Main, &mut bg_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(bg_style);

    let window_s = obj.spark_window_s.unwrap_or(60.0).round().clamp(1.0, i16::MAX as f64) as u64;
    unsafe {
        lvgl_sys::lv_chart_set_type(ptr.as_ptr(), lvgl_sys::LV_CHART_TYPE_SCATTER as lvgl_sys::lv_chart_type_t);
        lvgl_sys::lv_chart_set_div_line_count(ptr.as_ptr(), 0, 0);
        lvgl_sys::lv_chart_set_range(
            ptr.as_ptr(),
            lvgl_sys::LV_CHART_AXIS_PRIMARY_X as lvgl_sys::lv_chart_axis_t,
            0,
            window_s as i16,
        );
        // Placeholder prima del primo poll — sempre autofit dopo, come trend
        // quando y_min/y_max sono assenti (qui non esistono affatto nello
        // schema, quindi è l'unico comportamento).
        lvgl_sys::lv_chart_set_range(ptr.as_ptr(), lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t, 0, 100);
    }

    let rgb = parse_hex_color(obj.spark_color.as_deref().unwrap_or("#3b82f6")).unwrap_or((59, 130, 246));
    let ser = unsafe { chart_add_series(ptr, rgb) };
    let tag = obj.tag.clone().unwrap_or_default();
    let shared = client::spawn_history_poller(rt_handle, base_url.to_string(), tag, window_s, false);

    Ok(LiveBinding {
        kind: LiveKind::Sparkline { ptr, ser, shared, last_seen_version: 0, last_samples: Vec::new(), window_s },
    })
}

/// Lista allarmi attivi, modalità `"list"` soltanto — `"banner"` (marquee di
/// un solo allarme) e `"table"` (`DataTable` condiviso, sort/filtro per
/// colonna) di `AlarmViewerWidget` in `SvgCanvas.tsx` non hanno equivalente
/// qui: segnalato come non supportato invece di renderizzare una lista al
/// posto di quanto configurato (stesso principio di `render_trend` per
/// `alarm_viewer_mode` — vedi la guardia sotto).
///
/// `max_rows` slot fissi creati una volta (dot colorato + timestamp
/// opzionale + messaggio + pulsante ACK opzionale), popolati/nascosti a ogni
/// frame in `update_alarm_viewer` in base a quali allarmi sono attivi in
/// quel momento — stesso principio di `render_table`, non widget ricreati.
/// Niente scroll per righe oltre `max_rows`: stessa `slice(0, maxRows)` del
/// web, ma senza un contenitore scrollabile in questo giro (gap dichiarato).
fn render_alarm_viewer(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    shared_alarms: &SharedAlarms,
    ack_tx: &mpsc::Sender<String>,
) -> anyhow::Result<LiveBinding> {
    let mode = obj.alarm_viewer_mode.as_deref().unwrap_or("list");
    if mode != "list" {
        anyhow::bail!("alarm_viewer_mode '{mode}' non supportato da LVGL (solo 'list')");
    }

    let width = obj.width.unwrap_or(360.0);
    let height = obj.height.unwrap_or(160.0);
    let max_rows = obj.alarm_viewer_max_rows.unwrap_or(5.0).round().clamp(1.0, 50.0) as usize;
    let show_ack = obj.alarm_viewer_show_ack.unwrap_or(true);
    let show_ts = obj.alarm_viewer_show_ts.unwrap_or(true);
    let show_empty = obj.alarm_viewer_show_empty.unwrap_or(true);
    let prefix = obj.alarm_viewer_id_prefix.clone().unwrap_or_default();
    let allowed_sev = obj.alarm_viewer_severities.clone();

    let mut container = create_child_obj(screen)?;
    set_pos_size(&mut container, obj, width, height)?;
    apply_bg_color(&mut container, obj.alarm_viewer_bg_color.as_deref().unwrap_or("#0f172a"), styles)?;
    let container_ptr = container.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        // Niente scroll (vedi commento di funzione) — non solo estetico:
        // senza, LVGL lascerebbe comunque il contenitore scrollabile col
        // dito/mouse anche se il contenuto in eccesso resta semplicemente
        // tagliato, un'affordance fuorviante per qualcosa che non scrolla
        // davvero.
        lvgl_sys::lv_obj_clear_flag(container_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_SCROLLABLE as lvgl_sys::lv_obj_flag_t);
    }
    // Il tema di default applica un padding interno non nullo ai container
    // (verificato dal vivo: il pulsante ACK, posizionato assumendo tutta la
    // `width` disponibile a partire da x=0, risultava tagliato dal bordo
    // destro) — azzerato esplicitamente così le coordinate assolute delle
    // righe qui sotto corrispondono davvero allo spazio disponibile, invece
    // di dover indovinare il padding del tema.
    let mut pad_style = Style::default();
    pad_style.set_pad_left(0);
    pad_style.set_pad_right(0);
    pad_style.set_pad_top(0);
    pad_style.set_pad_bottom(0);
    container
        .add_style(Part::Main, &mut pad_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(pad_style);

    let row_h = (height / max_rows as f64).max(16.0);
    let hidden = lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t;

    let mut empty_label = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    empty_label.set_pos(4, 4).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    empty_label
        .set_text(&text_cstring("Nessun allarme attivo"))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let mut empty_style = Style::default();
    empty_style.set_text_color(Color::from_rgb((100, 116, 139))); // #64748b
    empty_label
        .add_style(Part::Main, &mut empty_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(empty_style);
    let empty_ptr = empty_label.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    // Stato iniziale nascosto: il primo update_bindings (che gira prima del
    // primo frame visibile — vedi main.rs) decide la visibilità corretta
    // rispettando show_empty, niente da anticipare qui.
    unsafe {
        lvgl_sys::lv_obj_add_flag(empty_ptr.as_ptr(), hidden);
    }

    // Ogni elemento di riga è centrato verticalmente nella propria banda
    // row_h (non incollato al bordo superiore): un pulsante/etichetta alto
    // quanto row_h intero risultava visivamente incollato al bordo del
    // contenitore o troppo schiacciato per mostrare il proprio testo,
    // verificato dal vivo con screenshot prima di questa versione.
    let dot_h = 10.0;
    let text_h = 16.0;
    let btn_h = 22.0_f64.min(row_h);

    let mut rows = Vec::with_capacity(max_rows);
    for i in 0..max_rows {
        let row_top = i as f64 * row_h;
        let center_y = |elem_h: f64| (row_top + (row_h - elem_h) / 2.0).round() as i16;

        let mut dot = create_child_obj(&mut container)?;
        dot.set_pos(4, center_y(dot_h)).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        dot.set_size(10, 10).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
        let mut dot_style = Style::default();
        dot_style.set_radius(lvgl_sys::LV_RADIUS_CIRCLE as i16);
        dot.add_style(Part::Main, &mut dot_style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
        let dot_ptr = dot.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

        let mut x_cursor: i16 = 20;
        let ts_ptr = if show_ts {
            let mut ts_lbl = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
            ts_lbl.set_pos(x_cursor, center_y(text_h)).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
            ts_lbl.set_text(&text_cstring("")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
            let mut ts_style = Style::default();
            ts_style.set_text_color(Color::from_rgb((71, 85, 105))); // #475569
            ts_lbl
                .add_style(Part::Main, &mut ts_style)
                .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
            styles.push(ts_style);
            let p = ts_lbl.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
            x_cursor += 46;
            Some(p)
        } else {
            None
        };

        let ack_w: i16 = if show_ack { 40 } else { 0 };
        let msg_w = (width as i16 - x_cursor - ack_w - 8).max(20);
        let mut msg_lbl = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
        msg_lbl.set_pos(x_cursor, center_y(text_h)).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        // Altezza fissa a una riga (non row_h, spesso più alta): verificato in
        // lv_label.c che LV_LABEL_LONG_DOT tronca con "…" solo quando il testo
        // "a capo" supererebbe l'altezza dichiarata — con un'altezza generosa
        // (es. row_h su 3 righe) il testo semplicemente va a capo su due righe
        // invece di troncare, il contrario di quanto serve qui (una riga sola,
        // come il `text-overflow: ellipsis` del web). Provato dal vivo:
        // un'altezza pari a row_h mostrava il messaggio spezzato su due righe.
        msg_lbl.set_size(msg_w, text_h as i16).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
        msg_lbl.set_text(&text_cstring("")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
        let msg_ptr = msg_lbl.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
        unsafe {
            lvgl_sys::lv_label_set_long_mode(msg_ptr.as_ptr(), lvgl_sys::LV_LABEL_LONG_DOT as lvgl_sys::lv_label_long_mode_t);
        }

        let (ack_btn_ptr, ack_ctx) = if show_ack {
            let mut btn = Btn::create(&mut container).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
            btn.set_pos(x_cursor + msg_w + 4, center_y(btn_h))
                .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
            btn.set_size(ack_w, btn_h as i16).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
            let mut lbl = Label::create(&mut btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
            lbl.set_text(&text_cstring("ACK")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
            let ptr = btn.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
            let ctx: &'static AlarmAckCtx = Box::leak(Box::new(AlarmAckCtx {
                current_id: RefCell::new(String::new()),
                tx: ack_tx.clone(),
            }));
            unsafe {
                lvgl_sys::lv_obj_add_event_cb(
                    ptr.as_ptr(),
                    Some(sws_alarm_ack_clicked_cb),
                    lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
                    ctx as *const AlarmAckCtx as *mut std::ffi::c_void,
                );
            }
            (Some(ptr), Some(ctx))
        } else {
            (None, None)
        };

        unsafe {
            lvgl_sys::lv_obj_add_flag(dot_ptr.as_ptr(), hidden);
            if let Some(p) = ts_ptr {
                lvgl_sys::lv_obj_add_flag(p.as_ptr(), hidden);
            }
            lvgl_sys::lv_obj_add_flag(msg_ptr.as_ptr(), hidden);
            if let Some(p) = ack_btn_ptr {
                lvgl_sys::lv_obj_add_flag(p.as_ptr(), hidden);
            }
        }

        rows.push(AlarmRowBinding { dot_ptr, dot_style, ts_ptr, msg_ptr, ack_btn_ptr, ack_ctx });
    }

    Ok(LiveBinding {
        kind: LiveKind::AlarmViewer {
            shared: shared_alarms.clone(),
            empty_ptr,
            show_empty,
            rows,
            prefix,
            allowed_sev,
        },
    })
}

/// `alarm_banner`: riquadro compatto per un solo allarme, il più recente fra
/// quelli attivi — stesso `SharedAlarms`/filtro severità/prefix di
/// `alarm_viewer`, ma un solo slot invece di `max_rows` (niente ACK: il web
/// (`AlarmBanner` in `SvgCanvas.tsx`) non lo prevede neppure lì, è
/// puramente informativo).
fn render_alarm_banner(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    shared_alarms: &SharedAlarms,
) -> anyhow::Result<LiveBinding> {
    let width = obj.width.unwrap_or(600.0);
    let height = obj.height.unwrap_or(32.0);
    let prefix = obj.alarm_banner_id_prefix.clone().unwrap_or_default();
    let allowed_sev = obj.alarm_banner_severities.clone();

    let mut container = create_child_obj(screen)?;
    set_pos_size(&mut container, obj, width, height)?;
    apply_bg_color(&mut container, "#1e293b", styles)?;
    let container_ptr = container.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_obj_clear_flag(container_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_SCROLLABLE as lvgl_sys::lv_obj_flag_t);
    }
    let mut pad_style = Style::default();
    pad_style.set_pad_left(8);
    pad_style.set_pad_right(8);
    pad_style.set_pad_top(0);
    pad_style.set_pad_bottom(0);
    container
        .add_style(Part::Main, &mut pad_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(pad_style);

    let dot_y = ((height - 10.0) / 2.0).round() as i16;
    let mut dot = create_child_obj(&mut container)?;
    dot.set_pos(0, dot_y).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    dot.set_size(10, 10).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    let mut dot_style = Style::default();
    dot_style.set_radius(lvgl_sys::LV_RADIUS_CIRCLE as i16);
    dot.add_style(Part::Main, &mut dot_style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    let dot_ptr = dot.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let mut msg_lbl = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    msg_lbl
        .set_pos(18, ((height - 16.0) / 2.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    msg_lbl
        .set_size((width as i16 - 26).max(20), 16)
        .map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    msg_lbl.set_text(&text_cstring("")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let msg_ptr = msg_lbl.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_label_set_long_mode(msg_ptr.as_ptr(), lvgl_sys::LV_LABEL_LONG_DOT as lvgl_sys::lv_label_long_mode_t);
        lvgl_sys::lv_obj_add_flag(dot_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
        lvgl_sys::lv_obj_add_flag(msg_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
    }

    let mut empty_label = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    empty_label
        .set_pos(0, ((height - 16.0) / 2.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    empty_label
        .set_text(&text_cstring("Nessun allarme attivo"))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let mut empty_style = Style::default();
    empty_style.set_text_color(Color::from_rgb((100, 116, 139))); // #64748b
    empty_label
        .add_style(Part::Main, &mut empty_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(empty_style);
    let empty_ptr = empty_label.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    Ok(LiveBinding {
        kind: LiveKind::AlarmBanner { shared: shared_alarms.clone(), dot_ptr, dot_style, msg_ptr, empty_ptr, prefix, allowed_sev },
    })
}

/// `xy_plot`: punto+scia contro due tag, non contro il tempo (a differenza
/// di `trend`/`sparkline`). Campionamento locale dal `TagSnapshot` di ogni
/// frame (nessun poller REST: i valori sono già lì), throttled in
/// `update_xy_plot`. Range fisso quando `xy_x_min`/`xy_x_max` (risp. Y) sono
/// entrambi impostati, altrimenti autofit sui campioni nella scia.
fn render_xy_plot(screen: &mut lvgl::Obj, obj: &SynopticObject, styles: &mut Vec<Style>) -> anyhow::Result<LiveBinding> {
    let mut chart = Chart::create(screen).map_err(|e| anyhow::anyhow!("Chart::create: {e:?}"))?;
    set_pos_size(&mut chart, obj, 200.0, 200.0)?;
    let ptr = chart.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let mut bg_style = Style::default();
    bg_style.set_pad_left(4);
    bg_style.set_pad_right(4);
    bg_style.set_pad_top(4);
    bg_style.set_pad_bottom(4);
    chart.add_style(Part::Main, &mut bg_style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(bg_style);

    let trail_s = obj.xy_trail_s.unwrap_or(30.0).round().clamp(1.0, 600.0) as u64;
    let (x_lo, x_hi) = (obj.xy_x_min.unwrap_or(0.0), obj.xy_x_max.unwrap_or(100.0));
    let (y_lo, y_hi) = (obj.xy_y_min.unwrap_or(0.0), obj.xy_y_max.unwrap_or(100.0));
    unsafe {
        lvgl_sys::lv_chart_set_type(ptr.as_ptr(), lvgl_sys::LV_CHART_TYPE_SCATTER as lvgl_sys::lv_chart_type_t);
        lvgl_sys::lv_chart_set_div_line_count(ptr.as_ptr(), 3, 3);
        lvgl_sys::lv_chart_set_range(
            ptr.as_ptr(), lvgl_sys::LV_CHART_AXIS_PRIMARY_X as lvgl_sys::lv_chart_axis_t,
            x_lo.round() as i16, x_hi.round() as i16,
        );
        lvgl_sys::lv_chart_set_range(
            ptr.as_ptr(), lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t,
            y_lo.round() as i16, y_hi.round() as i16,
        );
        lvgl_sys::lv_chart_set_point_count(ptr.as_ptr(), 64);
    }
    let rgb = parse_hex_color(obj.line_color.as_deref().unwrap_or("#3b82f6")).unwrap_or((59, 130, 246));
    let ser = unsafe { chart_add_series(ptr, rgb) };

    Ok(LiveBinding {
        kind: LiveKind::XyPlot {
            ptr, ser,
            x_tag: obj.tag.clone(),
            y_tag: obj.y_tag.clone(),
            trail_s,
            samples: Vec::new(),
            last_sample_ms: 0,
            x_min: obj.xy_x_min,
            x_max: obj.xy_x_max,
            y_min: obj.xy_y_min,
            y_max: obj.xy_y_max,
        },
    })
}

/// `pie_chart`: solo modalità `"donut"` (vedi `LiveKind::PieChart`). Uno
/// spicchio per `PieSlice`, disegnato come arco (`lv_canvas_draw_arc`) di
/// spessore `radius * (1 - inner_ratio)` — un vero anello, non un settore
/// pieno fino al centro (LVGL 8.x non ha un widget torta nativo, verificato
/// prima di scrivere questo codice — vedi Q14 seguito 14). Le proporzioni
/// sono calcolate sui valori correnti dei tag all'apertura della pagina;
/// `update_pie_chart` ridisegna solo quando cambiano davvero.
fn render_pie_chart(screen: &mut lvgl::Obj, obj: &SynopticObject, tags: &TagSnapshot) -> anyhow::Result<LiveBinding> {
    let mode = obj.pie_mode.as_deref().unwrap_or("pie");
    if mode != "donut" {
        anyhow::bail!("pie_mode '{mode}' non supportato da LVGL (solo 'donut' — LVGL 8.x non ha un widget torta nativo)");
    }
    let w = obj.width.unwrap_or(200.0).round().clamp(8.0, 1000.0) as i16;
    let h = obj.height.unwrap_or(200.0).round().clamp(8.0, 1000.0) as i16;
    let inner_ratio = obj.pie_inner_ratio.unwrap_or(0.5).clamp(0.1, 0.9);
    let slices = obj.pie_slices.clone().unwrap_or_default();

    let mut canvas = unsafe {
        let ptr = lvgl_sys::lv_canvas_create(screen.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr());
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_canvas_create ha restituito null"))?;
        <lvgl::Obj as Widget>::from_raw(nn)
    };
    canvas
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let canvas_ptr = canvas.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    // 3 byte/pixel: LV_IMG_CF_TRUE_COLOR_ALPHA a LV_COLOR_DEPTH=16 (vedi
    // LV_IMG_PX_SIZE_ALPHA_BYTE in lv_img_buf.h — macro function-like, non
    // valutabile da bindgen, calcolato a mano come per DRM_IOCTL_* altrove
    // in questo progetto). Serve l'alfa: gli angoli del canvas quadrato
    // fuori dall'anello devono restare trasparenti sullo sfondo pagina, non
    // un rettangolo pieno.
    let buf_size = 3usize * w as usize * h as usize;
    let mut buf = vec![0u8; buf_size];
    unsafe {
        lvgl_sys::lv_canvas_set_buffer(
            canvas_ptr.as_ptr(), buf.as_mut_ptr() as *mut std::ffi::c_void, w as lvgl_sys::lv_coord_t, h as lvgl_sys::lv_coord_t,
            lvgl_sys::LV_IMG_CF_TRUE_COLOR_ALPHA as lvgl_sys::lv_img_cf_t,
        );
        lvgl_sys::lv_canvas_fill_bg(canvas_ptr.as_ptr(), Color::from_rgb((0, 0, 0)).into(), 0);
    }

    let values: Vec<f64> = slices
        .iter()
        .map(|s| lookup(tags, &Some(s.tag.clone())).map(|t| tag_value_as_f64(&t.value)).unwrap_or(0.0).max(0.0))
        .collect();
    draw_pie_donut(canvas_ptr, w, h, &slices, &values, inner_ratio);

    Ok(LiveBinding {
        kind: LiveKind::PieChart { canvas_ptr, buf, w, h, slices, inner_ratio, last_values: values },
    })
}

/// Disegna l'anello: uno `lv_canvas_draw_arc` per spicchio, spessore fisso
/// `r * (1 - inner_ratio)`, angoli proporzionali al valore di ciascun tag
/// sul totale (spicchi a valore 0 semplicemente non disegnati — un arco di
/// ampiezza 0 sarebbe comunque invisibile). Richiamata sia alla creazione
/// sia da `update_pie_chart` quando i valori cambiano: `lv_canvas_fill_bg`
/// cancella il contenuto precedente prima di ridisegnare, LVGL non ha un
/// modo di "cancellare solo un arco" su un canvas raster.
fn draw_pie_donut(canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, w: i16, h: i16, slices: &[PieSlice], values: &[f64], inner_ratio: f64) {
    unsafe {
        lvgl_sys::lv_canvas_fill_bg(canvas_ptr.as_ptr(), Color::from_rgb((0, 0, 0)).into(), 0);
    }
    let total: f64 = values.iter().sum();
    if total <= 0.0 || slices.is_empty() {
        return;
    }
    let cx = w as lvgl_sys::lv_coord_t / 2;
    let cy = h as lvgl_sys::lv_coord_t / 2;
    let r = (w.min(h) as lvgl_sys::lv_coord_t / 2) - 2;
    let width = ((r as f64) * (1.0 - inner_ratio)).round().max(2.0) as lvgl_sys::lv_coord_t;
    let mut start_deg: f64 = 0.0;
    for (slice, &val) in slices.iter().zip(values.iter()) {
        let span_deg = 360.0 * (val / total);
        if span_deg <= 0.0 {
            continue;
        }
        let end_deg = start_deg + span_deg;
        let rgb = parse_hex_color(&slice.color).unwrap_or((100, 116, 139));
        unsafe {
            let mut dsc = lvgl_sys::lv_draw_arc_dsc_t::default();
            lvgl_sys::lv_draw_arc_dsc_init(&mut dsc);
            dsc.color = Color::from_rgb(rgb).into();
            dsc.width = width;
            dsc.opa = 255;
            // -90 così lo spicchio 0 parte dalle ore 12, coerente con
            // l'orientamento del donut web (SvgCanvas.tsx disegna a partire
            // dall'alto, non dalle ore 3 — verificato leggendo il blocco
            // pie_chart prima di assumerlo).
            lvgl_sys::lv_canvas_draw_arc(
                canvas_ptr.as_ptr(), cx, cy, r,
                (start_deg - 90.0).round() as i32, (end_deg - 90.0).round() as i32,
                &dsc,
            );
        }
        start_deg = end_deg;
    }
}

/// Contesto per il tastierino numerico di `setpoint`: sia il pulsante di
/// modifica (mostra l'overlay, pre-riempie la textarea col valore corrente)
/// sia la tastiera stessa (`LV_EVENT_READY`/`LV_EVENT_CANCEL`) condividono
/// lo stesso contesto — non serve differenziarli, entrambi agiscono sulla
/// stessa coppia textarea/overlay.
struct SetpointCtx {
    tag: String,
    tx: mpsc::Sender<TagCommand>,
    textarea_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    overlay_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    value_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
}

/// Click sul pulsante "✎": mostra l'overlay e pre-riempie la textarea con
/// il testo attualmente mostrato dalla label del valore (già tenuto
/// aggiornato dal vivo da `update_bindings` — niente bisogno di leggere di
/// nuovo il `TagSnapshot` qui, la callback FFI non ce l'ha comunque).
unsafe extern "C" fn sws_setpoint_edit_clicked_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const SetpointCtx) };
    unsafe {
        let current = lvgl_sys::lv_label_get_text(ctx.value_ptr.as_ptr());
        lvgl_sys::lv_textarea_set_text(ctx.textarea_ptr.as_ptr(), current);
        lvgl_sys::lv_obj_clear_flag(ctx.overlay_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
    }
}

/// `LV_EVENT_READY` sulla tastiera (tasto "OK"): legge il testo digitato,
/// prova a interpretarlo come numero, scrive il tag se valido — se non è un
/// numero valido, lascia la textarea com'è (l'operatore la corregge) invece
/// di scrivere qualcosa di sbagliato o azzerare silenziosamente, stesso
/// principio del `setpointDraft` nel web (`SvgCanvas.tsx`: un valore non
/// numerico non fa scattare `onWriteTag`).
unsafe extern "C" fn sws_setpoint_ready_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const SetpointCtx) };
    unsafe {
        let c_text = lvgl_sys::lv_textarea_get_text(ctx.textarea_ptr.as_ptr());
        if !c_text.is_null() {
            if let Ok(text) = std::ffi::CStr::from_ptr(c_text).to_str() {
                if let Ok(n) = text.trim().parse::<f64>() {
                    let _ = ctx.tx.send(TagCommand { tag: ctx.tag.clone(), value: TagValue::Float(n) });
                    lvgl_sys::lv_obj_add_flag(ctx.overlay_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
                }
            }
        }
    }
}

/// `LV_EVENT_CANCEL` sulla tastiera (tasto "Esc"): chiude l'overlay senza
/// scrivere nulla.
unsafe extern "C" fn sws_setpoint_cancel_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const SetpointCtx) };
    unsafe {
        lvgl_sys::lv_obj_add_flag(ctx.overlay_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
    }
}

/// `setpoint`: label col valore corrente + pulsante "✎" che apre un
/// overlay a schermo intero con `lv_textarea` + `lv_keyboard` in modalità
/// `LV_KEYBOARD_MODE_NUMBER`. **Primo pattern di interazione a inserimento
/// testo di questo motore** — tutti gli altri widget interattivi
/// (bottone/checkbox/slider) sono manipolazione diretta, non richiedono un
/// tastierino a schermo. `lv_keyboard_set_textarea` collega tastiera e
/// campo: i tasti scrivono direttamente nella textarea assegnata, nessun
/// `lv_group`/focus esplicito necessario per l'uso touch (verificato in
/// `lv_keyboard.c` prima di assumerlo — il gruppo serve per la navigazione
/// da encoder/tastiera fisica, non per il tocco diretto sui tasti).
/// `read_only` disabilita il pulsante invece di ometterlo, così il layout
/// resta prevedibile indipendentemente dal synottico.
fn render_setpoint(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
) -> anyhow::Result<LiveBinding> {
    let w = obj.width.unwrap_or(140.0);
    let h = obj.height.unwrap_or(56.0);
    let unit = obj.unit.clone().unwrap_or_default();
    let read_only = obj.read_only.unwrap_or(false);

    let mut container = create_child_obj(screen)?;
    set_pos_size(&mut container, obj, w, h)?;
    let container_ptr = container.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let mut y_cursor: i16 = 2;
    if let Some(label) = &obj.label {
        let mut lbl = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
        lbl.set_pos(2, y_cursor).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        lbl.set_text(&text_cstring(label)).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
        y_cursor += 16;
    }

    let mut value_lbl = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    value_lbl.set_pos(2, y_cursor).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let initial = lookup(tags, &obj.tag).map(|t| tag_value_as_f64(&t.value)).unwrap_or(0.0);
    value_lbl
        .set_text(&text_cstring(&format!("{initial:.1}{unit}")))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let value_ptr = value_lbl.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    // Overlay a schermo intero, figlio dello `screen` (non del container:
    // deve poter coprire l'intera pagina, non solo il box del setpoint) —
    // creato nascosto, mostrato solo dal click sul pulsante ✎.
    let mut overlay = create_child_obj(screen)?;
    overlay
        .set_pos(0, 0)
        .map_err(|e| anyhow::anyhow!("set_pos overlay: {e:?}"))?;
    overlay
        .set_size(HOR_RES as i16, VER_RES as i16)
        .map_err(|e| anyhow::anyhow!("set_size overlay: {e:?}"))?;
    let mut overlay_style = Style::default();
    overlay_style.set_bg_color(Color::from_rgb((15, 23, 42)));
    overlay
        .add_style(Part::Main, &mut overlay_style)
        .map_err(|e| anyhow::anyhow!("add_style overlay: {e:?}"))?;
    styles.push(overlay_style);
    let overlay_ptr = overlay.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let mut textarea = unsafe {
        let ptr = lvgl_sys::lv_textarea_create(overlay_ptr.as_ptr());
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_textarea_create ha restituito null"))?;
        <lvgl::Obj as Widget>::from_raw(nn)
    };
    textarea.set_pos(20, 20).map_err(|e| anyhow::anyhow!("set_pos textarea: {e:?}"))?;
    textarea.set_size((HOR_RES as i16) - 40, 50).map_err(|e| anyhow::anyhow!("set_size textarea: {e:?}"))?;
    let textarea_ptr = textarea.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_textarea_set_accepted_chars(textarea_ptr.as_ptr(), c"0123456789.-".as_ptr());
        lvgl_sys::lv_textarea_set_one_line(textarea_ptr.as_ptr(), true);
    }

    let keyboard_ptr = unsafe {
        let ptr = lvgl_sys::lv_keyboard_create(overlay_ptr.as_ptr());
        core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_keyboard_create ha restituito null"))?
    };
    unsafe {
        lvgl_sys::lv_keyboard_set_textarea(keyboard_ptr.as_ptr(), textarea_ptr.as_ptr());
        lvgl_sys::lv_keyboard_set_mode(keyboard_ptr.as_ptr(), lvgl_sys::LV_KEYBOARD_MODE_NUMBER as lvgl_sys::lv_keyboard_mode_t);
        lvgl_sys::lv_obj_add_flag(overlay_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
    }

    let ctx: &'static SetpointCtx = Box::leak(Box::new(SetpointCtx {
        tag: obj.tag.clone().unwrap_or_default(),
        tx: tag_tx.clone(),
        textarea_ptr,
        overlay_ptr,
        value_ptr,
    }));
    unsafe {
        lvgl_sys::lv_obj_add_event_cb(
            keyboard_ptr.as_ptr(), Some(sws_setpoint_ready_cb), lvgl_sys::lv_event_code_t_LV_EVENT_READY,
            ctx as *const SetpointCtx as *mut std::ffi::c_void,
        );
        lvgl_sys::lv_obj_add_event_cb(
            keyboard_ptr.as_ptr(), Some(sws_setpoint_cancel_cb), lvgl_sys::lv_event_code_t_LV_EVENT_CANCEL,
            ctx as *const SetpointCtx as *mut std::ffi::c_void,
        );
    }

    if !read_only {
        let mut edit_btn = Btn::create(&mut container).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
        edit_btn
            .set_pos((w - 24.0).round() as i16, y_cursor)
            .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        edit_btn.set_size(22, 22).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
        let mut edit_lbl = Label::create(&mut edit_btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
        edit_lbl.set_text(&text_cstring("E")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
        let edit_ptr = edit_btn.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
        unsafe {
            lvgl_sys::lv_obj_add_event_cb(
                edit_ptr.as_ptr(), Some(sws_setpoint_edit_clicked_cb), lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
                ctx as *const SetpointCtx as *mut std::ffi::c_void,
            );
        }
    }
    let _ = container_ptr;

    Ok(LiveBinding { kind: LiveKind::Setpoint { value_ptr, tag: obj.tag.clone(), unit } })
}

/// Click sulla campanella: apre/chiude il pannello elenco allarmi attivi
/// (`lv_obj_has_flag(HIDDEN)` come toggle — stesso approccio semplice già
/// usato per l'overlay del `setpoint`, niente stato aggiuntivo da tenere).
unsafe extern "C" fn sws_alarm_bell_clicked_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let panel_ptr = user_data as *mut lvgl_sys::lv_obj_t;
    unsafe {
        let hidden = lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t;
        if lvgl_sys::lv_obj_has_flag(panel_ptr, hidden) {
            lvgl_sys::lv_obj_clear_flag(panel_ptr, hidden);
        } else {
            lvgl_sys::lv_obj_add_flag(panel_ptr, hidden);
        }
    }
}

/// `alarm_bell`: badge con conteggio degli allarmi attivi (filtrati come
/// `alarm_viewer`) + un pannello a comparsa con l'elenco messaggi al click.
/// **Semplificazione dichiarata rispetto al web**: `AlarmBellPanel` in
/// `SvgCanvas.tsx` ha viste multiple (attivi/storico/ack/shelve) — qui solo
/// "attivi", sola lettura (niente ACK dal pannello: per quello c'è già
/// `alarm_viewer`, che lo fa bene). Un badge+lista è il sottoinsieme che
/// copre il caso d'uso principale (sapere quanti/quali allarmi sono attivi
/// ora) senza replicare l'intera superficie interattiva del componente web.
fn render_alarm_bell(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    shared_alarms: &SharedAlarms,
) -> anyhow::Result<LiveBinding> {
    let w = obj.width.unwrap_or(130.0);
    let h = obj.height.unwrap_or(34.0);
    let prefix = obj.alarm_bell_id_prefix.clone().unwrap_or_default();
    let allowed_sev = obj.alarm_bell_severities.clone();

    let mut btn = Btn::create(screen).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
    set_pos_size(&mut btn, obj, w, h)?;
    let mut bell_lbl = Label::create(&mut btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    bell_lbl.set_text(&text_cstring("Allarmi")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let btn_ptr = btn.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let mut badge = create_child_obj(&mut btn)?;
    badge
        .set_pos((w - 20.0).round() as i16, -6)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    badge.set_size(18, 18).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    let mut badge_style = Style::default();
    badge_style.set_radius(lvgl_sys::LV_RADIUS_CIRCLE as i16);
    badge_style.set_bg_color(Color::from_rgb((239, 68, 68))); // #ef4444
    badge
        .add_style(Part::Main, &mut badge_style)
        .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(badge_style);
    let mut count_lbl = Label::create(&mut badge).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    count_lbl.set_text(&text_cstring("0")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let badge_ptr = badge.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_obj_add_flag(badge_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
    }

    // Pannello elenco, figlio dello `screen` (non del bottone: deve poter
    // disegnarsi sopra il resto della pagina), nascosto finché non si clicca
    // la campanella.
    let panel_w = 260.0;
    let panel_h = 160.0;
    let mut panel = create_child_obj(screen)?;
    panel
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, (obj.y.unwrap_or(0.0) + h + 4.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    panel.set_size(panel_w as i16, panel_h as i16).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    apply_bg_color(&mut panel, "#1e293b", styles)?;
    let panel_ptr = panel.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_obj_add_flag(panel_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
        lvgl_sys::lv_obj_add_event_cb(
            btn_ptr.as_ptr(), Some(sws_alarm_bell_clicked_cb), lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
            panel_ptr.as_ptr() as *mut std::ffi::c_void,
        );
    }

    let max_rows = 6usize;
    let row_h = panel_h / max_rows as f64;
    let mut rows = Vec::with_capacity(max_rows);
    for i in 0..max_rows {
        let mut msg_lbl = Label::create(&mut panel).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
        msg_lbl
            .set_pos(4, (i as f64 * row_h + 4.0).round() as i16)
            .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        msg_lbl
            .set_size((panel_w - 8.0) as i16, (row_h - 2.0) as i16)
            .map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
        msg_lbl.set_text(&text_cstring("")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
        let ptr = msg_lbl.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
        unsafe {
            lvgl_sys::lv_label_set_long_mode(ptr.as_ptr(), lvgl_sys::LV_LABEL_LONG_DOT as lvgl_sys::lv_label_long_mode_t);
            lvgl_sys::lv_obj_add_flag(ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
        }
        rows.push(ptr);
    }

    Ok(LiveBinding {
        kind: LiveKind::AlarmBell { shared: shared_alarms.clone(), badge_ptr, row_ptrs: rows, prefix, allowed_sev, last_count: usize::MAX },
    })
}

/// `pipe`: solo routing `"straight"` (segmenti diretti fra i waypoint) —
/// `"orthogonal"`/`"diagonal"`/`"bezier"` segnalati come non supportati,
/// stesso principio di `alarm_viewer_mode`. Riusa il pattern di `render_line`
/// (array di punti relativi all'origine, `Box::leak`-ato).
///
/// **Semplificazioni dichiarate rispetto al web**: nessun gradient
/// `"tube"`, nessun marker di inizio/fine, nessuna etichetta al midpoint —
/// e soprattutto **il riempimento non è un livello progressivo ma un
/// cambio di colore statico**, deciso una volta alla creazione dal valore
/// corrente di `fill_level`/`fill_level_tag` (non segue il tag dal vivo,
/// a differenza di quasi tutti gli altri widget di questo motore — stesso
/// principio già accettato per l'arco soglia del `gauge`, che nemmeno lui
/// si aggiorna dopo la creazione). Un vero riempimento progressivo
/// richiederebbe disegnare la pipe su un `lv_canvas` invece che con
/// `lv_line`, per poter colorare solo una frazione del percorso — non
/// tentato in questo giro.
/// La porzione di polilinea corrispondente a una frazione della sua lunghezza.
///
/// Serve al riempimento progressivo delle `pipe`. Il web lo ottiene con un
/// trucco di `stroke-dasharray` su `pathLength=1`; LVGL non ha niente del
/// genere, quindi la polilinea parziale va costruita a mano — camminando i
/// segmenti e interpolando quello in cui si esaurisce la frazione.
///
/// `from_start = false` riempie dalla fine (`fill_direction: end-to-start`).
///
/// Restituisce meno di due punti quando non c'è niente da disegnare: chi
/// chiama nasconde l'oggetto di riempimento invece di disegnare una linea
/// degenere, che LVGL renderebbe come un puntino.
fn partial_polyline(points: &[(f64, f64)], fraction: f64, from_start: bool) -> Vec<(f64, f64)> {
    if points.len() < 2 || fraction <= 0.0 {
        return Vec::new();
    }
    if fraction >= 1.0 {
        return points.to_vec();
    }
    // Riempire dalla fine è riempire dall'inizio la polilinea rovesciata: una
    // sola logica da tenere giusta invece di due che possono divergere.
    let pts: Vec<(f64, f64)> = if from_start {
        points.to_vec()
    } else {
        points.iter().rev().copied().collect()
    };

    let seg_len: Vec<f64> = pts
        .windows(2)
        .map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt())
        .collect();
    let total: f64 = seg_len.iter().sum();
    if total <= 0.0 {
        return Vec::new(); // tutti i waypoint coincidenti: nessuna lunghezza da riempire
    }

    let mut restante = total * fraction;
    let mut out = vec![pts[0]];
    for (i, &len) in seg_len.iter().enumerate() {
        if restante >= len {
            out.push(pts[i + 1]);
            restante -= len;
            continue;
        }
        if len > 0.0 {
            let t = restante / len;
            out.push((
                pts[i].0 + (pts[i + 1].0 - pts[i].0) * t,
                pts[i].1 + (pts[i + 1].1 - pts[i].1) * t,
            ));
        }
        break;
    }
    if out.len() < 2 {
        return Vec::new();
    }
    out
}

/// `alarm_history`: tabella degli allarmi passati, il più recente in alto.
///
/// Diverso da `alarm_viewer`, che mostra quelli **attivi** e li fa confermare:
/// qui si guarda cosa è successo, non si agisce. Per questo non c'è nessun
/// pulsante e i dati non arrivano dal WebSocket degli allarmi ma da una
/// richiesta allo storico, una volta al disegno — come fa il web.
///
/// `alarm_history_id` filtra su un allarme solo; senza, li mostra tutti.
fn render_alarm_history(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
) -> anyhow::Result<()> {
    let larghezza = obj.width.unwrap_or(420.0).round() as i16;
    let altezza = obj.height.unwrap_or(220.0).round() as i16;
    // Quante righe ci stanno davvero: una tabella più alta del suo riquadro
    // sborderebbe sugli oggetti sotto, che sul web non succede perché lì c'è
    // una barra di scorrimento.
    let righe_max = ((altezza as f64 - 20.0) / 22.0).floor().clamp(1.0, 100.0) as usize;

    let eventi = rt_handle
        .block_on(client::fetch_alarm_history(base_url, obj.alarm_history_id.as_deref(), righe_max))
        .unwrap_or_else(|e| {
            eprintln!("[alarm_history] storico non disponibile ({e})");
            Vec::new()
        });

    let mut table = Table::create(screen).map_err(|e| anyhow::anyhow!("Table::create: {e:?}"))?;
    table
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let ptr = table.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let n = eventi.len().min(righe_max);
    unsafe {
        lvgl_sys::lv_table_set_col_cnt(ptr.as_ptr(), 3);
        lvgl_sys::lv_table_set_row_cnt(ptr.as_ptr(), (n + 1) as u16);
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 0, (larghezza / 5) as lvgl_sys::lv_coord_t);
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 1, (larghezza * 3 / 5) as lvgl_sys::lv_coord_t);
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 2, (larghezza / 5) as lvgl_sys::lv_coord_t);
        set_cell(ptr, 0, 0, "Ora");
        set_cell(ptr, 0, 1, "Allarme");
        set_cell(ptr, 0, 2, "Conf.");
        for (i, e) in eventi.iter().take(n).enumerate() {
            let r = (i + 1) as u16;
            set_cell(ptr, r, 0, &ora_utc(e.ts_activated_ms));
            // Il messaggio se c'è, altrimenti l'id: un evento senza messaggio
            // è comunque un evento, e una riga vuota non direbbe quale.
            let testo = if e.alarm_message.trim().is_empty() { &e.alarm_id } else { &e.alarm_message };
            set_cell(ptr, r, 1, testo);
            set_cell(ptr, r, 2, if e.ts_acked_ms.is_some() { "sì" } else { "no" });
        }
    }
    Ok(())
}

/// `data_log`: tabella dei campioni storici di un tag, i più recenti in alto.
///
/// Una `lv_table` riempita una volta al disegno, come fa il web: `DataLogWidget`
/// carica lo storico al montaggio e non ripete la richiesta finché il tag o la
/// finestra non cambiano.
///
/// **Limite dichiarato**: niente impaginazione. Sul web ci sono i pulsanti
/// avanti/indietro (`datalog_page_size`); qui si mostrano le prime N righe e
/// basta, dove N è quella stessa dimensione di pagina. Impaginare richiede
/// pulsanti e uno stato che LVGL non ha già pronti, e su un pannello senza
/// tastiera la prima pagina è quasi sempre quella che interessa — sono i
/// campioni più recenti.
fn render_data_log(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
) -> anyhow::Result<()> {
    let Some(tag) = obj.tag.clone() else {
        anyhow::bail!("data_log senza tag");
    };
    let righe_max = obj.datalog_page_size.unwrap_or(25.0).round().clamp(1.0, 200.0) as usize;
    let finestra_s = obj.window_s.unwrap_or(3600.0).max(1.0);
    let decimali = obj.decimals.unwrap_or(1) as usize;
    let unita = obj.unit.as_deref().map(|u| format!(" {u}")).unwrap_or_default();

    let ora_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let da_ms = ora_ms.saturating_sub((finestra_s * 1000.0) as u64);
    let campioni = rt_handle
        .block_on(client::fetch_history(base_url, &tag, da_ms, ora_ms, false))
        .unwrap_or_else(|e| {
            // Storico non raggiungibile: tabella vuota con le intestazioni,
            // non un oggetto mancante. Una tabella vuota dice "non ci sono
            // dati"; un buco nella pagina non dice niente.
            eprintln!("[data_log] {tag}: storico non disponibile ({e})");
            Vec::new()
        });

    let mut table = Table::create(screen).map_err(|e| anyhow::anyhow!("Table::create: {e:?}"))?;
    table
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let ptr = table.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let n = campioni.len().min(righe_max);
    unsafe {
        lvgl_sys::lv_table_set_col_cnt(ptr.as_ptr(), 2);
        lvgl_sys::lv_table_set_row_cnt(ptr.as_ptr(), (n + 1) as u16);
        let larghezza = obj.width.unwrap_or(380.0).round() as i16;
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 0, (larghezza / 2) as lvgl_sys::lv_coord_t);
        lvgl_sys::lv_table_set_col_width(ptr.as_ptr(), 1, (larghezza / 2) as lvgl_sys::lv_coord_t);
        set_cell(ptr, 0, 0, "Ora");
        set_cell(ptr, 0, 1, "Valore");
        // I più recenti in alto: `fetch_history` li dà in ordine crescente di
        // tempo, il web li rovescia (`hist.slice().reverse()`) e qui si fa lo
        // stesso. Su un pannello si guarda cosa è appena successo.
        for (i, c) in campioni.iter().rev().take(n).enumerate() {
            set_cell(ptr, (i + 1) as u16, 0, &ora_utc(c.ts_ms));
            let v = tag_value_as_f64(&c.value);
            set_cell(ptr, (i + 1) as u16, 1, &format!("{v:.decimali$}{unita}"));
        }
    }
    Ok(())
}

/// Scrive una cella della tabella.
unsafe fn set_cell(ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, row: u16, col: u16, testo: &str) {
    let c = text_cstring(testo);
    lvgl_sys::lv_table_set_cell_value(ptr.as_ptr(), row, col, c.as_ptr());
}

/// Un timestamp in millisecondi come `hh:mm:ss`, in UTC.
///
/// Il nome dice UTC perché è UTC: il viewer non linka una libreria di fusi
/// orari, e fingere di conoscerli darebbe orari sbagliati di un'ora per metà
/// anno. È anche il fuso con cui lo storico è registrato.
fn ora_utc(ts_ms: u64) -> String {
    let s = ts_ms / 1000;
    let (h, m, sec) = ((s / 3600) % 24, (s / 60) % 60, s % 60);
    format!("{h:02}:{m:02}:{sec:02}")
}

/// `kpi_tile`: pannello con etichetta, valore grande, unità e sparkline.
///
/// Non ha un widget LVGL suo: è **composto** dai renderer che già esistono,
/// costruendo gli oggetti synottici che servono e passandoli a `render_text` e
/// `render_sparkline`. Riscriverne il contenuto a mano avrebbe voluto dire
/// duplicare la colorazione per soglia, la formattazione del valore e
/// l'aggiornamento dal vivo — quattro cose che poi divergono.
///
/// **Limite dichiarato**: sul web l'unità di misura è in un carattere più
/// piccolo, in linea col valore (`<tspan>`). LVGL non ha corsivi di riga: qui
/// valore e unità stanno nella stessa etichetta, stesso corpo. Un'etichetta
/// separata richiederebbe di sapere quanto è largo il valore, che cambia a
/// ogni aggiornamento.
///
/// Non disegnato: la variazione sulla finestra (`KpiDelta` sul web), che
/// richiede un secondo passaggio sullo storico a ogni aggiornamento.
fn render_kpi_tile(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
    live: &mut Vec<LiveBinding>,
) -> anyhow::Result<()> {
    let (x, y) = (obj.x.unwrap_or(0.0), obj.y.unwrap_or(0.0));
    let (w, h) = (obj.width.unwrap_or(180.0), obj.height.unwrap_or(100.0));

    // Il pannello di sfondo.
    let mut sfondo = create_child_obj(screen)?;
    sfondo.set_pos(x.round() as i16, y.round() as i16).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    sfondo.set_size(w.round() as i16, h.round() as i16).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    apply_bg_color(&mut sfondo, obj.bg_color.as_deref().unwrap_or("#0f172a"), styles)?;

    // Etichetta: il nome del KPI, non un valore. `text` statico, nessun tag —
    // altrimenti `render_text` mostrerebbe il valore anche qui.
    let mut etichetta = SynopticObject {
        obj_type: Some("text".into()),
        x: Some(x + 10.0),
        y: Some(y + 6.0),
        text: Some(obj.label.clone().or_else(|| obj.tag.clone()).unwrap_or_else(|| "KPI".into())),
        color: Some("#94a3b8".into()),
        ..Default::default()
    };
    etichetta.tag = None;
    live.push(render_text(screen, &etichetta, tags)?);

    // Valore: eredita soglie e formato dall'oggetto vero, così la colorazione
    // per soglia è la stessa di un `text` qualunque.
    let unita = obj.unit.as_deref().map(|u| format!(" {u}")).unwrap_or_default();
    let valore = SynopticObject {
        obj_type: Some("text".into()),
        x: Some(x + 10.0),
        y: Some(y + 28.0),
        tag: obj.tag.clone(),
        format: Some(format!("{}{unita}", obj.format.clone().unwrap_or_else(|| "{value}".into()))),
        text_color_by_threshold: obj.text_color_by_threshold,
        alarm_low: obj.alarm_low,
        warn_low: obj.warn_low,
        warn_high: obj.warn_high,
        alarm_high: obj.alarm_high,
        color: obj.color.clone(),
        ..Default::default()
    };
    live.push(render_text(screen, &valore, tags)?);

    // Sparkline in basso, come sul web. Solo se c'è un tag: senza, il web non
    // la disegna affatto.
    if obj.tag.is_some() {
        let spark = SynopticObject {
            obj_type: Some("sparkline".into()),
            x: Some(x + 6.0),
            y: Some(y + h - 34.0),
            width: Some(w - 12.0),
            height: Some(30.0),
            tag: obj.tag.clone(),
            window_s: obj.spark_window_s.or(obj.window_s),
            stroke: obj.spark_color.clone(),
            ..Default::default()
        };
        // Un fallimento della sparkline (storico non raggiungibile) non deve
        // portarsi via l'intero riquadro: valore ed etichetta sono già a posto
        // e sono la parte che conta.
        match render_sparkline(screen, &spark, styles, base_url, rt_handle) {
            Ok(b) => live.push(b),
            Err(e) => eprintln!("[kpi] {}: sparkline non disegnata ({e})", obj.id.as_deref().unwrap_or("?")),
        }
    }
    Ok(())
}

fn render_pipe(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
) -> anyhow::Result<LiveBinding> {
    let routing = obj.routing.as_deref().unwrap_or("straight");
    if routing != "straight" {
        anyhow::bail!("routing '{routing}' non supportato da LVGL (solo 'straight')");
    }
    let waypoints = obj.points.clone().unwrap_or_default();
    if waypoints.len() < 2 {
        anyhow::bail!("pipe con meno di 2 waypoint");
    }
    let assoluti: Vec<(f64, f64)> = waypoints.iter().map(|p| (p.x, p.y)).collect();
    let (x0, y0) = assoluti[0];
    let sw = obj.stroke_width.unwrap_or(6.0).round() as i16;

    // ── Corpo del tubo: sempre tutta la polilinea, sempre il colore di stato ──
    //
    // Prima il corpo prendeva il colore di *riempimento* appena il livello
    // superava l'1%, e il tubo appariva pieno in modo uniforme a qualunque
    // livello — segnalato sul WP630 il 2026-08-26. Il livello non si vedeva
    // affatto: si vedeva solo "c'è del liquido / non ce n'è".
    let mut body = Line::create(screen).map_err(|e| anyhow::anyhow!("Line::create: {e:?}"))?;
    body.set_pos(x0.round() as i16, y0.round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let body_pts: Vec<lvgl_sys::lv_point_t> = assoluti
        .iter()
        .map(|(x, y)| lvgl_sys::lv_point_t { x: (x - x0).round() as i16, y: (y - y0).round() as i16 })
        .collect();
    let body_leaked: &'static [lvgl_sys::lv_point_t] = Box::leak(body_pts.into_boxed_slice());
    let body_ptr = body.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_line_set_points(body_ptr.as_ptr(), body_leaked.as_ptr(), body_leaked.len() as u16);
    }
    let mut body_style = Style::default();
    if let Some(rgb) = parse_hex_color(obj.stroke.as_deref().unwrap_or("#64748b")) {
        body_style.set_line_color(Color::from_rgb(rgb));
    }
    body_style.set_line_width(sw);
    body_style.set_line_rounded(true);
    body.add_style(Part::Main, &mut body_style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(body_style);

    // ── Riempimento: una seconda linea, più sottile, lunga quanto il livello ──
    //
    // I punti vivono in un `Vec` del binding e NON vengono rilasciati: LVGL
    // tiene il puntatore, non una copia. Il corpo può permettersi un
    // `Box::leak` perché non cambia mai; questo cambia a ogni variazione del
    // tag, e leakarne uno per aggiornamento vorrebbe dire perdere memoria a
    // ogni frame.
    let mut fill = Line::create(screen).map_err(|e| anyhow::anyhow!("Line::create: {e:?}"))?;
    fill.set_pos(x0.round() as i16, y0.round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let fill_ptr = fill.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    let mut fill_style = Style::default();
    if let Some(rgb) = parse_hex_color(obj.fill_color.as_deref().unwrap_or("#3b82f6")) {
        fill_style.set_line_color(Color::from_rgb(rgb));
    }
    // Più sottile del corpo, come sul web (`innerSw = sw - 2`): così il tubo
    // resta visibile attorno al liquido invece di essere coperto del tutto.
    fill_style.set_line_width((sw - 2).max(1));
    fill_style.set_line_rounded(true);
    fill.add_style(Part::Main, &mut fill_style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    styles.push(fill_style);

    let spec = PipeFill {
        waypoints: assoluti,
        origin: (x0, y0),
        tag: obj.fill_level_tag.clone(),
        statico: obj.fill_level,
        scale: obj.fill_level_scale.clone().unwrap_or_else(|| "0-100".to_string()),
        from_start: obj.fill_direction.as_deref().unwrap_or("start-to-end") == "start-to-end",
    };
    let mut buf: Vec<lvgl_sys::lv_point_t> = Vec::new();
    let level = spec.level(tags);
    apply_pipe_fill(fill_ptr, &spec, &mut buf, level);

    Ok(LiveBinding {
        kind: LiveKind::PipeFill { fill_ptr, spec, buf, last_level: level },
    })
}

/// Tutto ciò che serve a ricalcolare il riempimento di una pipe quando il tag
/// cambia — messo insieme perché creazione e aggiornamento usino esattamente
/// gli stessi dati, invece di ricavarli due volte da `SynopticObject` e
/// rischiare di divergere.
pub struct PipeFill {
    waypoints: Vec<(f64, f64)>,
    origin: (f64, f64),
    tag: Option<String>,
    statico: Option<f64>,
    scale: String,
    from_start: bool,
}

impl PipeFill {
    /// Livello come frazione 0..1.
    fn level(&self, tags: &TagSnapshot) -> f64 {
        let grezzo = match &self.tag {
            Some(t) => lookup(tags, &Some(t.clone())).map(|tv| tag_value_as_f64(&tv.value)),
            None => self.statico,
        };
        let v = grezzo.unwrap_or(0.0);
        let frazione = if self.scale == "0-1" { v } else { v / 100.0 };
        frazione.clamp(0.0, 1.0)
    }
}

/// Ridisegna la linea di riempimento al livello dato.
///
/// `buf` è il proprietario dei punti: si riusa la stessa allocazione a ogni
/// aggiornamento, perché LVGL conserva il puntatore che gli si passa.
fn apply_pipe_fill(
    fill_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    spec: &PipeFill,
    buf: &mut Vec<lvgl_sys::lv_point_t>,
    level: f64,
) {
    let parziale = partial_polyline(&spec.waypoints, level, spec.from_start);
    buf.clear();
    buf.extend(parziale.iter().map(|(x, y)| lvgl_sys::lv_point_t {
        x: (x - spec.origin.0).round() as i16,
        y: (y - spec.origin.1).round() as i16,
    }));
    unsafe {
        if buf.len() < 2 {
            // Niente da riempire: si nasconde invece di disegnare una linea
            // degenere, che LVGL renderebbe come un puntino.
            lvgl_sys::lv_obj_add_flag(fill_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
        } else {
            lvgl_sys::lv_obj_clear_flag(fill_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t);
            lvgl_sys::lv_line_set_points(fill_ptr.as_ptr(), buf.as_ptr(), buf.len() as u16);
            lvgl_sys::lv_obj_invalidate(fill_ptr.as_ptr());
        }
    }
}

/// `grid`: **unico tipo di questo motore i cui figli non compaiono affatto
/// in `page.objects`** — a differenza di `faceplate` (che comunque riusa lo
/// stesso `dispatch_render`), le celle e le loro sotto-suddivisioni
/// (`GridCell`/`SubGrid`, ricorsive senza limite di profondità dichiarato)
/// sono annidate dentro il campo `grid_cells` dell'oggetto grid stesso.
/// Geometria: colonne/righe di larghezza fissa (`col_widths`/`row_heights`,
/// il resto diviso in parti uguali — stessa logica di `SvgCanvas.tsx`),
/// `rowspan`/`colspan` sommano le celle coperte. Ogni cella disegna il
/// proprio `bg_color` (rispettando `visible`/`visible_tag`, stessa
/// `is_visible` già usata per gli oggetti di primo livello) poi ricorre nel
/// proprio `child` (via `dispatch_render`, coordinate traslate all'origine
/// della cella) o nella propria `sub` (`SubGrid`: split 1×2/2×1 per
/// `ratio`, ricorsivo).
///
/// **Semplificazione dichiarata**: `on_press_fn`/`on_release_fn` per cella
/// (script custom al click) non hanno equivalente — questo motore non
/// esegue script lato client per nessun widget, stessa scelta già presa per
/// `button`/`navbutton` (solo `write_value`/navigazione dirette).
#[allow(clippy::too_many_arguments)]
fn render_grid(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
    shared_alarms: &SharedAlarms,
    ack_tx: &mpsc::Sender<String>,
    lang_table: &LanguageTable,
    shared_lang: &SharedLang,
    own_page_id: &str,
    live: &mut Vec<LiveBinding>,
) -> anyhow::Result<()> {
    let origin_x = obj.x.unwrap_or(0.0);
    let origin_y = obj.y.unwrap_or(0.0);
    let w = obj.width.unwrap_or(400.0);
    let h = obj.height.unwrap_or(300.0);
    let n_rows = obj.grid_rows.unwrap_or(2.0).round().clamp(1.0, 20.0) as usize;
    let n_cols = obj.grid_cols.unwrap_or(2.0).round().clamp(1.0, 20.0) as usize;

    let col_widths_def = obj.col_widths.clone().unwrap_or_default();
    let used_col_w: f64 = col_widths_def.iter().take(n_cols).sum();
    let remaining_cols = n_cols.saturating_sub(col_widths_def.len().min(n_cols));
    let default_col_w = if remaining_cols > 0 { (w - used_col_w).max(0.0) / remaining_cols as f64 } else { 0.0 };
    let mut col_x = Vec::with_capacity(n_cols + 1);
    let mut col_w = Vec::with_capacity(n_cols);
    {
        let mut cx = origin_x;
        for c in 0..n_cols {
            col_x.push(cx);
            let cw = col_widths_def.get(c).copied().unwrap_or(default_col_w);
            col_w.push(cw);
            cx += cw;
        }
        col_x.push(cx);
    }

    let row_heights_def = obj.row_heights.clone().unwrap_or_default();
    let used_row_h: f64 = row_heights_def.iter().take(n_rows).sum();
    let remaining_rows = n_rows.saturating_sub(row_heights_def.len().min(n_rows));
    let default_row_h = if remaining_rows > 0 { (h - used_row_h).max(0.0) / remaining_rows as f64 } else { 0.0 };
    let mut row_y = Vec::with_capacity(n_rows + 1);
    let mut row_h = Vec::with_capacity(n_rows);
    {
        let mut ry = origin_y;
        for r in 0..n_rows {
            row_y.push(ry);
            let rh = row_heights_def.get(r).copied().unwrap_or(default_row_h);
            row_h.push(rh);
            ry += rh;
        }
        row_y.push(ry);
    }

    if obj.grid_show_borders.unwrap_or(true) {
        let border_hex = obj.grid_border_color.clone().unwrap_or_else(|| "#64748b".to_string());
        for c in 0..=n_cols {
            let mut ln = Line::create(screen).map_err(|e| anyhow::anyhow!("Line::create: {e:?}"))?;
            ln.set_pos(col_x[c].round() as i16, origin_y.round() as i16).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
            let pts: &'static [lvgl_sys::lv_point_t; 2] =
                Box::leak(Box::new([lvgl_sys::lv_point_t { x: 0, y: 0 }, lvgl_sys::lv_point_t { x: 0, y: h.round() as i16 }]));
            let ptr = ln.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
            unsafe { lvgl_sys::lv_line_set_points(ptr.as_ptr(), pts.as_ptr(), 2) };
            let mut style = Style::default();
            if let Some(rgb) = parse_hex_color(&border_hex) {
                style.set_line_color(Color::from_rgb(rgb));
            }
            style.set_line_width(1);
            ln.add_style(Part::Main, &mut style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
            styles.push(style);
        }
        for r in 0..=n_rows {
            let mut ln = Line::create(screen).map_err(|e| anyhow::anyhow!("Line::create: {e:?}"))?;
            ln.set_pos(origin_x.round() as i16, row_y[r].round() as i16).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
            let pts: &'static [lvgl_sys::lv_point_t; 2] =
                Box::leak(Box::new([lvgl_sys::lv_point_t { x: 0, y: 0 }, lvgl_sys::lv_point_t { x: w.round() as i16, y: 0 }]));
            let ptr = ln.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
            unsafe { lvgl_sys::lv_line_set_points(ptr.as_ptr(), pts.as_ptr(), 2) };
            let mut style = Style::default();
            if let Some(rgb) = parse_hex_color(&border_hex) {
                style.set_line_color(Color::from_rgb(rgb));
            }
            style.set_line_width(1);
            ln.add_style(Part::Main, &mut style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
            styles.push(style);
        }
    }

    for cell in obj.grid_cells.clone().unwrap_or_default() {
        let row = cell.row.round().clamp(0.0, (n_rows - 1) as f64) as usize;
        let col = cell.col.round().clamp(0.0, (n_cols - 1) as f64) as usize;
        let rowspan = cell.rowspan.unwrap_or(1.0).round().max(1.0) as usize;
        let colspan = cell.colspan.unwrap_or(1.0).round().max(1.0) as usize;
        let row_end = (row + rowspan).min(n_rows);
        let col_end = (col + colspan).min(n_cols);
        let cell_x = col_x[col];
        let cell_y = row_y[row];
        let cell_w = col_x[col_end] - col_x[col];
        let cell_h = row_y[row_end] - row_y[row];

        let visible = cell.visible.unwrap_or(true)
            && cell
                .visible_tag
                .as_ref()
                .map(|t| lookup(tags, &Some(t.clone())).map(|tv| tag_value_as_f64(&tv.value) != 0.0).unwrap_or(true))
                .unwrap_or(true);
        if !visible {
            continue;
        }

        if let Some(bg) = &cell.bg_color {
            let mut rect = create_child_obj(screen)?;
            rect.set_pos(cell_x.round() as i16, cell_y.round() as i16).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
            rect.set_size(cell_w.round() as i16, cell_h.round() as i16).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
            apply_bg_color(&mut rect, bg, styles)?;
        }

        render_grid_slot(
            screen, cell_x, cell_y, cell_w, cell_h, cell.child.as_deref(), cell.sub.as_deref(), styles, tags, tag_tx, nav_tx,
            base_url, rt_handle, shared_alarms, ack_tx, lang_table, shared_lang, own_page_id, live,
        )?;
    }
    Ok(())
}

/// Contenuto di uno slot (una `GridCell` diretta, o un lato `a`/`b` di una
/// `SubGrid`): un `child` singolo centrato nello slot, oppure una `sub`
/// ricorsiva che suddivide lo spazio 1×2/2×1 per `ratio` e richiama se
/// stessa sui due lati — nessun limite di profondità dichiarato nello
/// schema, quindi nessuno imposto qui.
#[allow(clippy::too_many_arguments)]
fn render_grid_slot(
    screen: &mut lvgl::Obj,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    child: Option<&SynopticObject>,
    sub: Option<&SubGrid>,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
    shared_alarms: &SharedAlarms,
    ack_tx: &mpsc::Sender<String>,
    lang_table: &LanguageTable,
    shared_lang: &SharedLang,
    own_page_id: &str,
    live: &mut Vec<LiveBinding>,
) -> anyhow::Result<()> {
    if let Some(sub) = sub {
        let ratio = sub.ratio.clamp(0.05, 0.95);
        let (a_geom, b_geom) = if sub.orientation == "cols" {
            ((x, y, w * ratio, h), (x + w * ratio, y, w * (1.0 - ratio), h))
        } else {
            ((x, y, w, h * ratio), (x, y + h * ratio, w, h * (1.0 - ratio)))
        };
        for (entry, geom) in [(&sub.a, a_geom), (&sub.b, b_geom)] {
            let Some(entry) = entry else { continue };
            let visible = entry.visible.unwrap_or(true)
                && entry
                    .visible_tag
                    .as_ref()
                    .map(|t| lookup(tags, &Some(t.clone())).map(|tv| tag_value_as_f64(&tv.value) != 0.0).unwrap_or(true))
                    .unwrap_or(true);
            if !visible {
                continue;
            }
            if let Some(bg) = &entry.bg_color {
                let mut rect = create_child_obj(screen)?;
                rect.set_pos(geom.0.round() as i16, geom.1.round() as i16).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
                rect.set_size(geom.2.round() as i16, geom.3.round() as i16).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
                apply_bg_color(&mut rect, bg, styles)?;
            }
            render_grid_slot(
                screen, geom.0, geom.1, geom.2, geom.3, entry.child.as_deref(), entry.sub.as_deref(), styles, tags, tag_tx,
                nav_tx, base_url, rt_handle, shared_alarms, ack_tx, lang_table, shared_lang, own_page_id, live,
            )?;
        }
        return Ok(());
    }
    let Some(child) = child else { return Ok(()) };
    let Some(child_type) = child.obj_type.clone() else { return Ok(()) };
    if !SUPPORTED_TYPES.contains(&child_type.as_str()) || child_type == "grid" {
        return Ok(()); // niente grid dentro grid, stesso principio di faceplate-dentro-faceplate
    }
    let mut positioned = child.clone();
    positioned.x = Some(x + child.x.unwrap_or(0.0));
    positioned.y = Some(y + child.y.unwrap_or(0.0));
    let _ = dispatch_render(
        screen, &child_type, &positioned, styles, tags, tag_tx, nav_tx, base_url, rt_handle, shared_alarms, ack_tx,
        lang_table, shared_lang, own_page_id, live,
    );
    Ok(())
}

/// Contesto per il click "Applica" di una riga `recipe_panel`: a differenza
/// delle altre callback di questo file non manda un comando su un canale —
/// spara direttamente `client::apply_recipe` come task sul runtime tokio
/// del processo (`rt_handle.spawn`, la stessa API già usata da
/// `client::spawn_history_poller` per i poller in background). Fire-and-
/// forget: nessun riscontro visivo del successo/fallimento in questo giro
/// (gap dichiarato, stesso principio del bottone/checkbox che non mostrano
/// se la `PUT /api/tags` è andata a buon fine).
struct RecipeApplyCtx {
    base_url: String,
    id: String,
    rt_handle: tokio::runtime::Handle,
}

unsafe extern "C" fn sws_recipe_apply_clicked_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const RecipeApplyCtx) };
    ctx.rt_handle.spawn(client::apply_recipe(ctx.base_url.clone(), ctx.id.clone()));
}

/// `recipe_panel`: elenco statico di ricette (`GET /api/recipes`, chiamata
/// bloccante una sola volta come `render_faceplate`) con un pulsante
/// "Applica" per riga che spara `POST /api/recipes/:id/apply` in
/// background al click. **Nessun aggiornamento live**: la lista non segue
/// nuove ricette create mentre la pagina è aperta (gap dichiarato, vedi
/// `client::fetch_recipes`) — coerente con l'assenza di un
/// `LiveBinding` per questo tipo, non un'omissione per dimenticanza.
fn render_recipe_panel(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
) -> anyhow::Result<()> {
    let w = obj.width.unwrap_or(260.0);
    let h = obj.height.unwrap_or(160.0);
    let prefix = obj.recipe_panel_id_prefix.clone().unwrap_or_default();

    let recipes = rt_handle.block_on(client::fetch_recipes(base_url))?;
    let filtered: Vec<_> = recipes.into_iter().filter(|r| prefix.is_empty() || r.id.starts_with(&prefix)).collect();

    let mut container = create_child_obj(screen)?;
    set_pos_size(&mut container, obj, w, h)?;
    apply_bg_color(&mut container, "#1e293b", styles)?;
    let container_ptr = container.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_obj_clear_flag(container_ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_SCROLLABLE as lvgl_sys::lv_obj_flag_t);
    }

    let max_rows = ((h / 28.0).floor().max(1.0)) as usize;
    for (i, recipe) in filtered.iter().take(max_rows).enumerate() {
        let row_y = (i as f64 * 28.0 + 4.0).round() as i16;
        let mut name_lbl = Label::create(&mut container).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
        name_lbl.set_pos(4, row_y + 4).map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        name_lbl
            .set_size((w - 90.0) as i16, 20)
            .map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
        name_lbl.set_text(&text_cstring(&recipe.name)).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
        let name_ptr = name_lbl.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
        unsafe {
            lvgl_sys::lv_label_set_long_mode(name_ptr.as_ptr(), lvgl_sys::LV_LABEL_LONG_DOT as lvgl_sys::lv_label_long_mode_t);
        }

        let mut apply_btn = Btn::create(&mut container).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
        apply_btn
            .set_pos((w - 80.0).round() as i16, row_y)
            .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
        apply_btn.set_size(76, 24).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
        let mut apply_lbl = Label::create(&mut apply_btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
        apply_lbl.set_text(&text_cstring("Applica")).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
        let apply_ptr = apply_btn.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

        let ctx: &'static RecipeApplyCtx =
            Box::leak(Box::new(RecipeApplyCtx { base_url: base_url.to_string(), id: recipe.id.clone(), rt_handle: rt_handle.clone() }));
        unsafe {
            lvgl_sys::lv_obj_add_event_cb(
                apply_ptr.as_ptr(), Some(sws_recipe_apply_clicked_cb), lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
                ctx as *const RecipeApplyCtx as *mut std::ffi::c_void,
            );
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// symbol — solo i 16 builtin (Q15, deciso 2026-08-11, opzione B). Ogni
// simbolo web è disegnato in uno spazio 100×100 con `<path>`/`<circle>`/
// `<rect>` SVG arbitrari (curve incluse); LVGL 8.x non ha un canale di
// disegno vettoriale a questo livello di espressività fuori da un
// `lv_canvas`, che offre solo rect/poligono/arco/linea/testo (verificato in
// `lv_canvas.h` prima di scegliere questo approccio — vedi Q14 seguito 14).
// Ogni funzione qui sotto è quindi una **semplificazione dichiarata**,
// stesso principio già usato per `ellipse`≈rettangolo arrotondato e
// `radio`≈checkbox: la forma essenziale (corpo + 1-2 accenti) è fedele,
// ma etichette (PI/TT/FT/LT/CMP), animazioni di rotazione e dettagli
// decorativi minori (tacche di scala, gocce d'acqua, pennacchi di vapore)
// sono omessi. Colore di stato sempre applicato, coerente col web.
// ─────────────────────────────────────────────────────────────────────────

/// Converte una coordinata nello spazio di disegno 100×100 in coordinate
/// canvas reali (`w`×`h` effettivi del widget).
fn sym_pt(x: f64, y: f64, w: i16, h: i16) -> lvgl_sys::lv_point_t {
    lvgl_sys::lv_point_t {
        x: (x / 100.0 * w as f64).round() as i16,
        y: (y / 100.0 * h as f64).round() as i16,
    }
}

fn sym_rect(canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, x: f64, y: f64, ww: f64, hh: f64, radius: f64, rgb: (u8, u8, u8), w: i16, h: i16) {
    let p0 = sym_pt(x, y, w, h);
    let p1 = sym_pt(x + ww, y + hh, w, h);
    unsafe {
        let mut dsc = lvgl_sys::lv_draw_rect_dsc_t::default();
        lvgl_sys::lv_draw_rect_dsc_init(&mut dsc);
        dsc.bg_color = Color::from_rgb(rgb).into();
        dsc.bg_opa = 255;
        dsc.radius = (radius / 100.0 * w.min(h) as f64).round() as lvgl_sys::lv_coord_t;
        lvgl_sys::lv_canvas_draw_rect(canvas_ptr.as_ptr(), p0.x, p0.y, (p1.x - p0.x).max(1), (p1.y - p0.y).max(1), &dsc);
    }
}

fn sym_circle(canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, cx: f64, cy: f64, r: f64, rgb: (u8, u8, u8), w: i16, h: i16) {
    let d = r * 2.0;
    sym_rect(canvas_ptr, cx - r, cy - r, d, d, 50.0, rgb, w, h);
}

fn sym_polygon(canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, pts_design: &[(f64, f64)], rgb: (u8, u8, u8), w: i16, h: i16) {
    let pts: Vec<lvgl_sys::lv_point_t> = pts_design.iter().map(|&(x, y)| sym_pt(x, y, w, h)).collect();
    unsafe {
        let mut dsc = lvgl_sys::lv_draw_rect_dsc_t::default();
        lvgl_sys::lv_draw_rect_dsc_init(&mut dsc);
        dsc.bg_color = Color::from_rgb(rgb).into();
        dsc.bg_opa = 255;
        lvgl_sys::lv_canvas_draw_polygon(canvas_ptr.as_ptr(), pts.as_ptr(), pts.len() as u32, &dsc);
    }
}

fn sym_line(canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, pts_design: &[(f64, f64)], width: f64, rgb: (u8, u8, u8), w: i16, h: i16) {
    let pts: Vec<lvgl_sys::lv_point_t> = pts_design.iter().map(|&(x, y)| sym_pt(x, y, w, h)).collect();
    unsafe {
        let mut dsc = lvgl_sys::lv_draw_line_dsc_t::default();
        lvgl_sys::lv_draw_line_dsc_init(&mut dsc);
        dsc.color = Color::from_rgb(rgb).into();
        dsc.width = (width / 100.0 * w.min(h) as f64).round().max(1.0) as lvgl_sys::lv_coord_t;
        dsc.opa = 255;
        dsc.set_round_start(1);
        dsc.set_round_end(1);
        lvgl_sys::lv_canvas_draw_line(canvas_ptr.as_ptr(), pts.as_ptr(), pts.len() as u32, &dsc);
    }
}

const SYM_DARK: (u8, u8, u8) = (15, 23, 42); // #0f172a
const SYM_OUTLINE: (u8, u8, u8) = (203, 213, 225); // #cbd5e1
// Corpo/vasca/telaio di un simbolo (tank, level_sensor, fan, mixer,
// agitator...) — **non** `SYM_DARK`: il web li disegna sempre con uno
// `stroke` chiaro che li rende visibili anche su sfondo scuro, ma
// `lv_canvas_draw_rect`/`draw_polygon` di questo motore non hanno un bordo
// impostato (semplificazione dichiarata) — un riempimento identico allo
// sfondo pagina (`SYM_DARK` ≈ #0f172a, lo stesso sfondo usato ovunque in
// questo motore) li renderebbe invisibili. Trovato dal vivo sullo
// screenshot di verifica: il corpo del tank spariva, restava visibile solo
// il liquido colorato sopra.
const SYM_PANEL: (u8, u8, u8) = (30, 41, 59); // #1e293b

/// Disegna il simbolo `id` sul canvas — dispatcher analogo a `dispatch_render`
/// ma per le 16 forme builtin invece che per i tipi di oggetto. `state_c` è
/// il colore di stato già risolto (`off`/`on`/`alarm`), stesso principio di
/// `stateFill()` in `library.tsx`.
fn draw_symbol(canvas_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>, id: &str, state: SymbolState, state_c: (u8, u8, u8), w: i16, h: i16) {
    unsafe {
        lvgl_sys::lv_canvas_fill_bg(canvas_ptr.as_ptr(), Color::from_rgb((0, 0, 0)).into(), 0);
    }
    match id {
        "pump" => {
            sym_circle(canvas_ptr, 50.0, 50.0, 36.0, state_c, w, h);
            sym_polygon(canvas_ptr, &[(50.0, 24.0), (66.0, 56.0), (34.0, 56.0)], SYM_DARK, w, h);
            sym_rect(canvas_ptr, 84.0, 42.0, 14.0, 16.0, 0.0, state_c, w, h);
            sym_rect(canvas_ptr, 20.0, 86.0, 60.0, 6.0, 0.0, SYM_DARK, w, h);
        }
        "valve" => {
            sym_polygon(canvas_ptr, &[(10.0, 30.0), (50.0, 50.0), (10.0, 70.0)], state_c, w, h);
            sym_polygon(canvas_ptr, &[(90.0, 30.0), (50.0, 50.0), (90.0, 70.0)], state_c, w, h);
            sym_rect(canvas_ptr, 46.0, 6.0, 8.0, 26.0, 0.0, SYM_DARK, w, h);
        }
        "motor" => {
            sym_circle(canvas_ptr, 45.0, 50.0, 36.0, state_c, w, h);
            sym_rect(canvas_ptr, 80.0, 42.0, 16.0, 16.0, 0.0, state_c, w, h);
        }
        "tank" => {
            sym_rect(canvas_ptr, 20.0, 14.0, 60.0, 76.0, 15.0, SYM_PANEL, w, h);
            let fill_ratio = match state {
                SymbolState::On => 0.7,
                SymbolState::Alarm => 0.9,
                SymbolState::Off => 0.2,
            };
            let liquid_h = 76.0 * fill_ratio;
            sym_rect(canvas_ptr, 22.0, 90.0 - liquid_h, 56.0, liquid_h - 2.0, 10.0, state_c, w, h);
        }
        "fan" => {
            sym_rect(canvas_ptr, 6.0, 6.0, 88.0, 88.0, 9.0, SYM_PANEL, w, h);
            for deg in [0.0_f64, 120.0, 240.0] {
                let rad = deg.to_radians();
                let rot = |x: f64, y: f64| -> (f64, f64) {
                    let (dx, dy) = (x - 50.0, y - 50.0);
                    (50.0 + dx * rad.cos() - dy * rad.sin(), 50.0 + dx * rad.sin() + dy * rad.cos())
                };
                sym_polygon(canvas_ptr, &[rot(50.0, 50.0), rot(50.0, 20.0), rot(60.0, 30.0)], state_c, w, h);
            }
            sym_circle(canvas_ptr, 50.0, 50.0, 6.0, state_c, w, h);
        }
        "compressor" => {
            sym_polygon(canvas_ptr, &[(10.0, 22.0), (80.0, 50.0), (10.0, 78.0)], state_c, w, h);
            sym_circle(canvas_ptr, 84.0, 50.0, 10.0, state_c, w, h);
        }
        "level_sensor" => {
            sym_rect(canvas_ptr, 28.0, 12.0, 44.0, 76.0, 8.0, SYM_PANEL, w, h);
            sym_line(canvas_ptr, &[(50.0, 14.0), (50.0, 84.0)], 4.0, state_c, w, h);
            let float_y = match state {
                SymbolState::On => 32.0,
                SymbolState::Alarm => 20.0,
                SymbolState::Off => 68.0,
            };
            sym_circle(canvas_ptr, 50.0, float_y, 6.0, state_c, w, h);
        }
        "flow_meter" => {
            sym_line(canvas_ptr, &[(4.0, 50.0), (28.0, 50.0)], 4.0, SYM_OUTLINE, w, h);
            sym_line(canvas_ptr, &[(72.0, 50.0), (96.0, 50.0)], 4.0, SYM_OUTLINE, w, h);
            sym_circle(canvas_ptr, 50.0, 50.0, 22.0, state_c, w, h);
            sym_line(canvas_ptr, &[(38.0, 50.0), (60.0, 50.0)], 3.0, SYM_DARK, w, h);
            sym_line(canvas_ptr, &[(52.0, 42.0), (60.0, 50.0), (52.0, 58.0)], 3.0, SYM_DARK, w, h);
        }
        "pressure_indicator" => {
            sym_circle(canvas_ptr, 50.0, 50.0, 40.0, (30, 41, 59), w, h); // #1e293b
            let needle_deg: f64 = match state {
                SymbolState::Alarm => 70.0,
                SymbolState::On => 0.0,
                SymbolState::Off => -70.0,
            };
            let rad = needle_deg.to_radians();
            let (nx, ny) = (50.0 + 32.0 * rad.sin(), 50.0 - 32.0 * rad.cos());
            sym_line(canvas_ptr, &[(50.0, 50.0), (nx, ny)], 3.0, state_c, w, h);
            sym_circle(canvas_ptr, 50.0, 50.0, 4.0, state_c, w, h);
        }
        "breaker" => {
            sym_circle(canvas_ptr, 18.0, 50.0, 6.0, state_c, w, h);
            sym_circle(canvas_ptr, 82.0, 50.0, 6.0, state_c, w, h);
            let closed = matches!(state, SymbolState::On);
            let (ex, ey) = if closed { (82.0, 50.0) } else { (70.0, 18.0) };
            sym_line(canvas_ptr, &[(18.0, 50.0), (ex, ey)], 4.0, state_c, w, h);
            sym_line(canvas_ptr, &[(82.0, 50.0), (70.0, 50.0)], 4.0, state_c, w, h);
        }
        "mixer" | "agitator" => {
            let (vx, vy, vw, vh) = if id == "mixer" { (20.0, 14.0, 60.0, 76.0) } else { (30.0, 8.0, 58.0, 84.0) };
            sym_rect(canvas_ptr, vx, vy, vw, vh, 8.0, SYM_PANEL, w, h);
            if id == "mixer" {
                sym_rect(canvas_ptr, 42.0, 4.0, 16.0, 12.0, 0.0, state_c, w, h);
                sym_line(canvas_ptr, &[(50.0, 16.0), (50.0, 70.0)], 3.0, SYM_OUTLINE, w, h);
                sym_line(canvas_ptr, &[(30.0, 70.0), (70.0, 70.0)], 4.0, state_c, w, h);
                sym_line(canvas_ptr, &[(50.0, 62.0), (50.0, 78.0)], 4.0, state_c, w, h);
            } else {
                sym_rect(canvas_ptr, 4.0, 40.0, 20.0, 20.0, 8.0, state_c, w, h);
                sym_line(canvas_ptr, &[(24.0, 50.0), (58.0, 50.0)], 3.0, SYM_OUTLINE, w, h);
                sym_line(canvas_ptr, &[(58.0, 32.0), (58.0, 68.0)], 4.0, state_c, w, h);
                sym_line(canvas_ptr, &[(40.0, 50.0), (76.0, 50.0)], 4.0, state_c, w, h);
            }
        }
        "heat_pump" => {
            sym_rect(canvas_ptr, 18.0, 16.0, 64.0, 10.0, 30.0, state_c, w, h);
            sym_circle(canvas_ptr, 50.0, 50.0, 13.0, state_c, w, h);
            sym_rect(canvas_ptr, 18.0, 70.0, 64.0, 10.0, 30.0, (100, 116, 139), w, h); // #64748b
        }
        "temperature_sensor" => {
            sym_line(canvas_ptr, &[(50.0, 4.0), (50.0, 24.0)], 4.0, SYM_OUTLINE, w, h);
            sym_circle(canvas_ptr, 50.0, 50.0, 24.0, state_c, w, h);
            let fill_h = match state {
                SymbolState::Alarm => 34.0,
                SymbolState::On => 22.0,
                SymbolState::Off => 10.0,
            };
            sym_rect(canvas_ptr, 46.0, 32.0, 8.0, 26.0, 30.0, (15, 23, 42), w, h);
            sym_rect(canvas_ptr, 47.0, 58.0 - fill_h, 6.0, fill_h, 30.0, SYM_DARK, w, h);
            sym_circle(canvas_ptr, 50.0, 64.0, 7.0, SYM_DARK, w, h);
        }
        "boiler" => {
            sym_rect(canvas_ptr, 46.0, 2.0, 8.0, 12.0, 0.0, SYM_OUTLINE, w, h);
            sym_rect(canvas_ptr, 22.0, 12.0, 56.0, 58.0, 10.0, (30, 41, 59), w, h);
            sym_rect(canvas_ptr, 23.0, 48.0, 54.0, 21.0, 8.0, SYM_DARK, w, h);
            sym_polygon(canvas_ptr, &[(34.0, 92.0), (44.0, 76.0), (50.0, 92.0), (58.0, 78.0), (66.0, 92.0)], state_c, w, h);
            sym_rect(canvas_ptr, 24.0, 70.0, 52.0, 6.0, 3.0, (71, 85, 105), w, h); // #475569
        }
        "cooling_tower" => {
            sym_polygon(canvas_ptr, &[(18.0, 92.0), (28.0, 16.0), (72.0, 16.0), (82.0, 92.0)], (30, 41, 59), w, h);
            sym_rect(canvas_ptr, 28.0, 12.0, 44.0, 8.0, 4.0, SYM_DARK, w, h);
            sym_line(canvas_ptr, &[(36.0, 16.0), (64.0, 16.0)], 2.0, state_c, w, h);
            sym_line(canvas_ptr, &[(50.0, 8.0), (50.0, 24.0)], 2.0, state_c, w, h);
        }
        _ => {
            // symbol_id sconosciuto (né builtin né "custom:"): riquadro
            // d'errore, stesso principio del placeholder web ("simbolo?").
            sym_rect(canvas_ptr, 4.0, 4.0, 92.0, 92.0, 4.0, (127, 29, 29), w, h); // #7f1d1d
        }
    }
    unsafe {
        lvgl_sys::lv_obj_invalidate(canvas_ptr.as_ptr());
    }
}

/// Deriva lo stato dai tag, stessa logica di `truthy()`/`state` in
/// `SvgCanvas.tsx`: `alarm_tag` vince su `state_tag`, che vince sull'`off`
/// di default.
fn resolve_symbol_state(tags: &TagSnapshot, state_tag: &Option<String>, alarm_tag: &Option<String>) -> SymbolState {
    let truthy = |tag: &Option<String>| -> bool {
        lookup(tags, tag).map(|t| tag_value_as_f64(&t.value) != 0.0).unwrap_or(false)
    };
    if truthy(alarm_tag) {
        SymbolState::Alarm
    } else if truthy(state_tag) {
        SymbolState::On
    } else {
        SymbolState::Off
    }
}

/// Disegna un SVG rasterizzato dentro un `lv_canvas` (D2, Q15 residuo + Q16).
///
/// Copre le tre sorgenti che LVGL da solo non sa disegnare — simboli
/// *vendored*, simboli *custom*, widget `image` — e che fino a oggi erano
/// semplicemente **mute** sul pannello: il progettista le vedeva nell'IDE e
/// non sul dispositivo.
///
/// La bitmap se la tiene `LiveBinding` in un `Vec<u8>` nostro, non il pool di
/// LVGL: `LV_MEM_SIZE` è 1 MB e un solo simbolo 128x128 ne occuperebbe 48 KB,
/// quindi una pagina ricca lo esaurirebbe — e in LVGL un pool esaurito
/// fallisce in silenzio (la lezione di Q22). Fuori dal pool, la memoria è
/// quella del processo, dove finirla dà un errore che si legge.
///
/// **Limite dichiarato**: la bitmap non si ricolora per stato. I 17 simboli
/// builtin lo fanno perché sono disegnati con primitive; qui servirebbe una
/// bitmap per stato. Un simbolo vendored/custom mostra dunque sempre il
/// proprio colore, e lo stato lo comunica come tutti gli altri oggetti
/// (bordo di allarme, `state_lamp` accanto). Dichiararlo è la differenza fra
/// un limite noto e un difetto silenzioso.
fn render_svg_raster(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    src: &crate::svg_assets::SvgSource,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
) -> anyhow::Result<LiveBinding> {
    let w = obj.width.unwrap_or(80.0).round().clamp(8.0, 500.0) as i16;
    let h = obj.height.unwrap_or(80.0).round().clamp(8.0, 500.0) as i16;

    let svg = crate::svg_assets::bytes_for(base_url, rt_handle, src)
        .ok_or_else(|| anyhow::anyhow!("SVG non disponibile"))?;
    let raster = crate::svg_raster::rasterize(&svg, w as u32, h as u32)
        .ok_or_else(|| anyhow::anyhow!("SVG non rasterizzabile a {w}x{h}"))?;
    let mut buf = raster.to_lvgl_true_color_alpha();
    // Le dimensioni del canvas si prendono dalla bitmap prodotta, non dai `w`/`h`
    // chiesti: sono le stesse, ma ricalcolarle sarebbe un secondo conto che un
    // giorno potrebbe divergere dal primo — e un canvas dichiarato più grande
    // della sua bitmap fa leggere a LVGL oltre la fine del buffer.
    let (w, h) = (raster.width as i16, raster.height as i16);

    let mut canvas = unsafe {
        let ptr = lvgl_sys::lv_canvas_create(screen.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr());
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_canvas_create ha restituito null"))?;
        <lvgl::Obj as Widget>::from_raw(nn)
    };
    canvas
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let canvas_ptr = canvas.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    unsafe {
        lvgl_sys::lv_canvas_set_buffer(
            canvas_ptr.as_ptr(),
            buf.as_mut_ptr() as *mut std::ffi::c_void,
            w as lvgl_sys::lv_coord_t,
            h as lvgl_sys::lv_coord_t,
            lvgl_sys::LV_IMG_CF_TRUE_COLOR_ALPHA as lvgl_sys::lv_img_cf_t,
        );
    }

    // `buf` sopravvive nel LiveBinding, che vive quanto la finestra: LVGL
    // continuerà a leggere da quel puntatore a ogni redraw, e un `Vec`
    // rilasciato qui lascerebbe il canvas a leggere memoria liberata.
    Ok(LiveBinding { kind: LiveKind::SvgRaster { canvas_ptr, buf } })
}

/// Segnaposto per un SVG che non si è potuto disegnare — non scaricato, non
/// interpretabile, o `src` vuoto.
///
/// Esiste perché l'alternativa è **niente**: un oggetto che sparisce dalla
/// pagina non dice se è stato dimenticato, se l'URL è sbagliato o se il
/// pannello non arriva in rete. Un riquadro tratteggiato al posto giusto e
/// della misura giusta dice almeno "qui ci doveva essere qualcosa".
fn render_svg_placeholder(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
) -> anyhow::Result<()> {
    let w = obj.width.unwrap_or(80.0).round().clamp(8.0, 500.0) as i16;
    let h = obj.height.unwrap_or(80.0).round().clamp(8.0, 500.0) as i16;
    let mut ph = create_child_obj(screen)?;
    ph.set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    ph.set_size(w, h).map_err(|e| anyhow::anyhow!("set_size: {e:?}"))?;
    let mut st = Style::default();
    st.set_bg_opa(lvgl::style::Opacity::OPA_0);
    st.set_border_color(Color::from_rgb((0x64, 0x74, 0x8b)));
    st.set_border_width(1);
    styles.push(st);
    let st = styles.last_mut().expect("appena inserito");
    ph.add_style(Part::Main, st).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
    Ok(())
}

/// `symbol`: canvas quadrato, ridisegnato solo quando lo stato cambia
/// davvero (`update_bindings` confronta con `last_state`) — un redraw
/// completo del canvas costa più di un semplice refresh di `Style`.
fn render_symbol(screen: &mut lvgl::Obj, obj: &SynopticObject, tags: &TagSnapshot) -> anyhow::Result<LiveBinding> {
    let symbol_id = obj.symbol_id.clone().unwrap_or_default();
    if symbol_id.starts_with("custom:") {
        anyhow::bail!("simboli 'vendored'/custom non supportati da LVGL (solo i 16 builtin, Q15 opzione B)");
    }
    let w = obj.width.unwrap_or(80.0).round().clamp(8.0, 500.0) as i16;
    let h = obj.height.unwrap_or(80.0).round().clamp(8.0, 500.0) as i16;

    let mut canvas = unsafe {
        let ptr = lvgl_sys::lv_canvas_create(screen.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr());
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_canvas_create ha restituito null"))?;
        <lvgl::Obj as Widget>::from_raw(nn)
    };
    canvas
        .set_pos(obj.x.unwrap_or(0.0).round() as i16, obj.y.unwrap_or(0.0).round() as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
    let canvas_ptr = canvas.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let buf_size = 3usize * w as usize * h as usize; // vedi render_pie_chart per la derivazione
    let mut buf = vec![0u8; buf_size];
    unsafe {
        lvgl_sys::lv_canvas_set_buffer(
            canvas_ptr.as_ptr(), buf.as_mut_ptr() as *mut std::ffi::c_void, w as lvgl_sys::lv_coord_t, h as lvgl_sys::lv_coord_t,
            lvgl_sys::LV_IMG_CF_TRUE_COLOR_ALPHA as lvgl_sys::lv_img_cf_t,
        );
    }

    let off_color = obj.state_off_color.clone().unwrap_or_else(|| "#64748b".to_string());
    let on_color = obj.state_on_color.clone().unwrap_or_else(|| "#22c55e".to_string());
    let alarm_color = obj.state_alarm_color.clone().unwrap_or_else(|| "#ef4444".to_string());
    let state = resolve_symbol_state(tags, &obj.state_tag, &obj.alarm_tag);
    let state_hex = match state {
        SymbolState::Off => &off_color,
        SymbolState::On => &on_color,
        SymbolState::Alarm => &alarm_color,
    };
    let state_c = parse_hex_color(state_hex).unwrap_or((100, 116, 139));
    draw_symbol(canvas_ptr, &symbol_id, state, state_c, w, h);

    Ok(LiveBinding {
        kind: LiveKind::Symbol {
            canvas_ptr, buf, w, h, symbol_id,
            state_tag: obj.state_tag.clone(), alarm_tag: obj.alarm_tag.clone(),
            off_color, on_color, alarm_color, last_state: Some(state),
        },
    })
}

/// Sostituisce le occorrenze `{{token}}` in `s` con la traduzione per `lang`
/// (fallback: default della tabella → token grezzo fra graffe se
/// sconosciuto) — porta `resolveMsg` di `projectI18n.ts` 1:1. Testo senza
/// `{{` passa invariato senza nemmeno scandire la stringa.
fn resolve_msg(s: &str, lang: &str, table: &LanguageTable) -> String {
    if s.is_empty() || !s.contains("{{") {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find("{{") {
        out.push_str(&rest[..open]);
        rest = &rest[open + 2..];
        match rest.find("}}") {
            Some(close) => {
                let key = rest[..close].trim();
                let resolved = table
                    .entries
                    .iter()
                    .find(|e| e.key == key)
                    .and_then(|e| e.values.get(lang).or_else(|| e.values.get(&table.default)))
                    .cloned()
                    .unwrap_or_else(|| format!("{{{{{key}}}}}"));
                out.push_str(&resolved);
                rest = &rest[close + 2..];
            }
            None => {
                out.push_str("{{");
                out.push_str(rest);
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Risolve i token `{{key}}` nei campi testo noti di un oggetto — porta
/// `localizeObject` di `projectI18n.ts`. A differenza della versione TS
/// (che ritorna l'oggetto originale per identità quando non serve, per
/// evitare un re-render React) qui clona sempre: questo motore non ha un
/// concetto di re-render da evitare, gli oggetti sono piccoli e la
/// funzione gira solo al caricamento/ricarica di una pagina, mai per
/// frame. Copre `label`/`text`/`unit`/`text_list_default` più le label
/// dentro `table_rows`/`text_list_entries` — sottoinsieme dei
/// `TEXT_FIELDS` TS limitato ai campi che questo motore conosce
/// (`pipe_label`/`bar_y_label`/`pie_center_text`/`options[].label` non
/// sono renderizzati da nessun widget di questo file, risolverli sarebbe
/// lavoro sprecato).
fn localize_object(obj: &SynopticObject, lang: &str, table: &LanguageTable) -> SynopticObject {
    if lang.is_empty() || table.entries.is_empty() {
        return obj.clone();
    }
    let mut out = obj.clone();
    if let Some(v) = &out.label {
        out.label = Some(resolve_msg(v, lang, table));
    }
    if let Some(v) = &out.text {
        out.text = Some(resolve_msg(v, lang, table));
    }
    if let Some(v) = &out.unit {
        out.unit = Some(resolve_msg(v, lang, table));
    }
    if let Some(v) = &out.text_list_default {
        out.text_list_default = Some(resolve_msg(v, lang, table));
    }
    if let Some(rows) = &out.table_rows {
        out.table_rows = Some(rows.iter().map(|r| TableRow { label: resolve_msg(&r.label, lang, table), ..r.clone() }).collect());
    }
    if let Some(entries) = &out.text_list_entries {
        out.text_list_entries =
            Some(entries.iter().map(|e| TextListEntry { label: resolve_msg(&e.label, lang, table), ..e.clone() }).collect());
    }
    out
}

/// Contesto per il click di `lang_button`: cambia la lingua *corrente*
/// (`SharedLang`, process-wide — questo motore non ha un concetto di
/// sessione per-tab come lo store del browser) e ricarica la pagina
/// **corrente** mandandone l'id su `nav_tx`, riusando esattamente la stessa
/// strada di un `navbutton` invece di una coda dedicata — `resolve_msg`
/// gira di nuovo al prossimo `render_page_objects`, che legge `SharedLang`
/// all'inizio (vedi `dispatch_render`).
struct LangButtonCtx {
    target_lang: String,
    shared_lang: SharedLang,
    own_page_id: String,
    nav_tx: mpsc::Sender<String>,
}

unsafe extern "C" fn sws_lang_button_clicked_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const LangButtonCtx) };
    *ctx.shared_lang.lock().unwrap_or_else(|e| e.into_inner()) = ctx.target_lang.clone();
    let _ = ctx.nav_tx.send(ctx.own_page_id.clone());
}

/// `lang_button`: bottone "attivo" (evidenziato) se `target_lang` combacia
/// con la lingua corrente — calcolato una volta alla creazione, non un
/// `LiveBinding`: dato che il click ricarica l'intera pagina (stesso
/// meccanismo di un `navbutton`), lo stato "attivo" si ricalcola da sé al
/// prossimo giro di `render_page_objects`, non serve seguirlo dal vivo fra
/// un caricamento e l'altro.
fn render_lang_button(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    nav_tx: &mpsc::Sender<String>,
    shared_lang: &SharedLang,
    own_page_id: &str,
) -> anyhow::Result<()> {
    let w = obj.width.unwrap_or(80.0);
    let h = obj.height.unwrap_or(32.0);
    let target_lang = obj.target_lang.clone().unwrap_or_default();
    let current = shared_lang.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let active = !target_lang.is_empty() && target_lang == current;

    let mut btn = Btn::create(screen).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
    set_pos_size(&mut btn, obj, w, h)?;
    {
        // Colore esplicito in ENTRAMBI i casi, non solo per "attivo": il
        // tema di default di LVGL colora già i bottoni in un blu molto
        // simile al blu "active" del web (#3b82f6) — senza uno stile
        // esplicito anche per lo stato inattivo, i due bottoni risultavano
        // visivamente identici, trovato dal vivo sullo screenshot di
        // verifica (IT ed EN indistinguibili nonostante il colore
        // applicato correttamente solo al bottone giusto).
        let mut style = Style::default();
        let rgb = if active { (59, 130, 246) } else { (51, 65, 85) }; // #3b82f6 attivo, #334155 inattivo
        style.set_bg_color(Color::from_rgb(rgb));
        btn.add_style(Part::Main, &mut style).map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
        styles.push(style);
    }
    let label_text = obj.label.clone().unwrap_or_else(|| target_lang.to_uppercase());
    let mut lbl = Label::create(&mut btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    lbl.set_text(&text_cstring(&label_text)).map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    let btn_ptr = btn.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;

    let ctx: &'static LangButtonCtx = Box::leak(Box::new(LangButtonCtx {
        target_lang,
        shared_lang: shared_lang.clone(),
        own_page_id: own_page_id.to_string(),
        nav_tx: nav_tx.clone(),
    }));
    unsafe {
        lvgl_sys::lv_obj_add_event_cb(
            btn_ptr.as_ptr(), Some(sws_lang_button_clicked_cb), lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
            ctx as *const LangButtonCtx as *mut std::ffi::c_void,
        );
    }
    Ok(())
}

/// Contesto per il cambio selezione di `lang_selector`: stesso principio di
/// `LangButtonCtx`, ma il codice lingua si legge dall'indice selezionato
/// nella dropdown invece di essere fisso (precalcolato qui: `langs` è la
/// stessa lista passata a `lv_dropdown_set_options`, l'indice che LVGL
/// riporta nell'evento corrisponde 1:1 alla riga `\n`-separata).
struct LangSelectorCtx {
    langs: Vec<String>,
    shared_lang: SharedLang,
    own_page_id: String,
    nav_tx: mpsc::Sender<String>,
}

unsafe extern "C" fn sws_lang_selector_changed_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let target = unsafe { lvgl_sys::lv_event_get_target(e) };
    if target.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const LangSelectorCtx) };
    let sel = unsafe { lvgl_sys::lv_dropdown_get_selected(target as *const lvgl_sys::lv_obj_t) } as usize;
    let Some(code) = ctx.langs.get(sel) else { return };
    *ctx.shared_lang.lock().unwrap_or_else(|e| e.into_inner()) = code.clone();
    let _ = ctx.nav_tx.send(ctx.own_page_id.clone());
}

/// `lang_selector`: `lv_dropdown` con `languages.langs` come opzioni
/// (`\n`-separate, convenzione standard LVGL — verificato in
/// `lv_dropdown.h` prima di usarla), selezione iniziale sulla lingua
/// corrente. Fedele al `<select>` nativo del web, a differenza di
/// `alarm_bell`/altri pannelli a comparsa di questo motore che
/// approssimano un componente web più ricco con qualcosa di più semplice —
/// qui LVGL ha un widget diretto, nessuna semplificazione necessaria.
fn render_lang_selector(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    nav_tx: &mpsc::Sender<String>,
    lang_table: &LanguageTable,
    shared_lang: &SharedLang,
    own_page_id: &str,
) -> anyhow::Result<()> {
    let w = obj.width.unwrap_or(120.0);
    let h = obj.height.unwrap_or(32.0);
    let langs = lang_table.langs.clone();

    let mut dd = unsafe {
        let ptr = lvgl_sys::lv_dropdown_create(screen.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr());
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_dropdown_create ha restituito null"))?;
        <lvgl::Obj as Widget>::from_raw(nn)
    };
    set_pos_size(&mut dd, obj, w, h)?;
    let dd_ptr = dd.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
    let options = std::ffi::CString::new(langs.join("\n")).unwrap_or_default();
    let current = shared_lang.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let selected = langs.iter().position(|l| l == &current).unwrap_or(0);
    unsafe {
        lvgl_sys::lv_dropdown_set_options(dd_ptr.as_ptr(), options.as_ptr());
        lvgl_sys::lv_dropdown_set_selected(dd_ptr.as_ptr(), selected as u16);
    }
    let _ = styles; // nessuno Style dedicato in questo giro, coerente col tema di default

    let ctx: &'static LangSelectorCtx = Box::leak(Box::new(LangSelectorCtx {
        langs,
        shared_lang: shared_lang.clone(),
        own_page_id: own_page_id.to_string(),
        nav_tx: nav_tx.clone(),
    }));
    unsafe {
        lvgl_sys::lv_obj_add_event_cb(
            dd_ptr.as_ptr(), Some(sws_lang_selector_changed_cb), lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED,
            ctx as *const LangSelectorCtx as *mut std::ffi::c_void,
        );
    }
    Ok(())
}

/// Smista un oggetto verso la sua `render_*` in base al tipo — estratto dal
/// corpo del loop di `render_page_objects` perché `render_faceplate` deve
/// richiamare esattamente la stessa logica sui suoi oggetti figli
/// (posizioni relative all'origine del faceplate, sostituzione parametri —
/// vedi `render_faceplate`), non una copia parallela che rischierebbe di
/// disallinearsi dal dispatcher principale.
#[allow(clippy::too_many_arguments)]
fn dispatch_render(
    screen: &mut lvgl::Obj,
    obj_type: &str,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
    shared_alarms: &SharedAlarms,
    ack_tx: &mpsc::Sender<String>,
    lang_table: &LanguageTable,
    shared_lang: &SharedLang,
    own_page_id: &str,
    live: &mut Vec<LiveBinding>,
) -> anyhow::Result<()> {
    // Risoluzione token `{{key}}` (T-40, `docs/OPEN_QUESTIONS.md` Q14
    // seguito 15): applicata qui, non con un pre-processing separato su
    // `page.objects`, perché è l'unico punto per cui passano davvero TUTTI
    // gli oggetti — di primo livello, figli di `faceplate`, figli di
    // `grid` — senza dover ripetere la stessa logica in tre punti diversi.
    // Clona solo se serve (nessun token trovato → stesso oggetto, stesso
    // principio di `localizeObject` in `projectI18n.ts`).
    let current_lang = shared_lang.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let localized = localize_object(obj, &current_lang, lang_table);
    let obj = &localized;

    // ── Cattura per il movimento ────────────────────────────────────────────
    //
    // `apply_bindings` (chiamata da `render_page_objects`) dà la geometria
    // giusta al momento della creazione, ma poi l'oggetto resta fermo: sul web
    // i binding si risolvono a ogni render perché il web ridisegna tutto, qui i
    // widget si creano una volta e si aggiornano per puntatore.
    //
    // Il puntatore però non c'è: le ~30 `render_*` non lo restituiscono, e
    // quelle geometriche non restituiscono nulla. Invece di cambiarne le firme
    // — refactor ampio, e per giunta inutile — si contano i figli del padre
    // prima e dopo: quelli comparsi in mezzo sono i widget di questo oggetto.
    // Regge anche gli oggetti che ne creano più d'uno (gauge, setpoint, grid).
    //
    // Limite noto: un renderer che creasse widget su un padre diverso da
    // `screen` sfuggirebbe al conteggio e resterebbe fermo. Oggi nessuno lo fa.
    let geom_spec = geometry_bindings(obj);
    let parent_ptr = screen.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr();
    let children_before = if geom_spec.is_some() {
        unsafe { lvgl_sys::lv_obj_get_child_cnt(parent_ptr) }
    } else {
        0
    };

    let result = match obj_type {
        "rect" => render_rect(screen, obj, styles),
        "ellipse" => render_ellipse(screen, obj, styles),
        "line" => render_line(screen, obj, styles),
        "button" => render_button(screen, obj, styles, tag_tx),
        "navbutton" => render_navbutton(screen, obj, styles, nav_tx),
        "text" => render_text(screen, obj, tags).map(|b| live.push(b)),
        "led" => render_led(screen, obj, tags).map(|b| live.push(b)),
        "slider" => render_slider(screen, obj, tags, tag_tx).map(|b| live.push(b)),
        "progress_bar" => render_progress_bar(screen, obj, tags).map(|b| live.push(b)),
        "checkbox" => render_checkbox(screen, obj, tags, tag_tx).map(|b| live.push(b)),
        "radio" => render_radio(screen, obj, tags, tag_tx).map(|b| live.push(b)),
        "gauge" => render_gauge(screen, obj, tags).map(|b| live.push(b)),
        "state_lamp" => render_state_lamp(screen, obj, tags).map(|b| live.push(b)),
        "table" => render_table(screen, obj, tags).map(|b| live.push(b)),
        "trend" => render_trend(screen, obj, base_url, rt_handle).map(|b| live.push(b)),
        "alarm_viewer" => render_alarm_viewer(screen, obj, styles, shared_alarms, ack_tx).map(|b| live.push(b)),
        "text_list" => render_text_list(screen, obj, tags).map(|b| live.push(b)),
        "bar_chart" => render_bar_chart(screen, obj, styles, tags).map(|b| live.push(b)),
        "sparkline" => render_sparkline(screen, obj, styles, base_url, rt_handle).map(|b| live.push(b)),
        "alarm_banner" => render_alarm_banner(screen, obj, styles, shared_alarms).map(|b| live.push(b)),
        "faceplate" => render_faceplate(
            screen, obj, styles, tags, tag_tx, nav_tx, base_url, rt_handle, shared_alarms, ack_tx, lang_table,
            shared_lang, own_page_id, live,
        ),
        // Un simbolo è o una forma builtin disegnata con le primitive
        // (ricolorabile per stato), o un SVG da rasterizzare. `source_for`
        // distingue i due casi; lo stesso ramo serve il widget `image`.
        "symbol" | "image" => match crate::svg_assets::source_for_project(obj, base_url, rt_handle) {
            Some(src) => match render_svg_raster(screen, obj, &src, base_url, rt_handle) {
                Ok(b) => { live.push(b); Ok(()) }
                Err(e) => {
                    eprintln!("[svg] {}: {e}", obj.id.as_deref().unwrap_or("?"));
                    render_svg_placeholder(screen, obj, styles)
                }
            },
            None if obj_type == "image" => render_svg_placeholder(screen, obj, styles),
            None => render_symbol(screen, obj, tags).map(|b| live.push(b)),
        },
        "grid" => render_grid(
            screen, obj, styles, tags, tag_tx, nav_tx, base_url, rt_handle, shared_alarms, ack_tx, lang_table,
            shared_lang, own_page_id, live,
        ),
        "pipe" => render_pipe(screen, obj, styles, tags).map(|b| live.push(b)),
        "kpi_tile" => render_kpi_tile(screen, obj, styles, tags, base_url, rt_handle, live),
        "data_log" => render_data_log(screen, obj, base_url, rt_handle),
        "alarm_history" => render_alarm_history(screen, obj, base_url, rt_handle),
        "alarm_bell" => render_alarm_bell(screen, obj, styles, shared_alarms).map(|b| live.push(b)),
        "recipe_panel" => render_recipe_panel(screen, obj, styles, base_url, rt_handle),
        "setpoint" => render_setpoint(screen, obj, styles, tags, tag_tx).map(|b| live.push(b)),
        "xy_plot" => render_xy_plot(screen, obj, styles).map(|b| live.push(b)),
        "pie_chart" => render_pie_chart(screen, obj, tags).map(|b| live.push(b)),
        "lang_button" => render_lang_button(screen, obj, styles, nav_tx, shared_lang, own_page_id),
        "lang_selector" => render_lang_selector(screen, obj, styles, nav_tx, lang_table, shared_lang, own_page_id),
        _ => unreachable!("filtrato da SUPPORTED_TYPES sopra"),
    };

    // Si accoda solo se il rendering è andato a buon fine: catturare i figli di
    // un oggetto creato a metà vorrebbe dire muovere dei rottami.
    if let (Some(bindings), Ok(())) = (geom_spec, &result) {
        let mut widgets = Vec::new();
        unsafe {
            // OBBLIGATORIO prima di leggere le coordinate.
            //
            // `lv_obj_get_x/y` non restituiscono la proprietà di stile appena
            // impostata da `set_pos`: restituiscono la posizione **calcolata**
            // (`coords.x1` meno quella del padre), che finché il layout non
            // gira vale 0. Catturando senza questa chiamata ogni widget
            // risultava a (0,0), e al primo movimento l'oggetto veniva
            // riscritto lì: saltava in cima allo schermo e usciva a sinistra,
            // rientrando solo quando il tag tornava al valore che aveva al
            // caricamento. Misurato sul WP630 il 2026-08-24 su un'ellisse a
            // y=160 — segnalato dal maintainer, non trovato leggendo.
            lvgl_sys::lv_obj_update_layout(parent_ptr);

            let after = lvgl_sys::lv_obj_get_child_cnt(parent_ptr);
            for i in children_before..after {
                let child = lvgl_sys::lv_obj_get_child(parent_ptr, i as i32);
                if let Some(ptr) = core::ptr::NonNull::new(child) {
                    let (sx, sy) = (lvgl_sys::lv_obj_get_x(child), lvgl_sys::lv_obj_get_y(child));
                    if std::env::var_os("SWS_LVGL_DEBUG_GEOM").is_some() {
                        eprintln!(
                            "[geom] {} figlio {}: catturato a ({sx},{sy}), oggetto dichiarato a ({:?},{:?})",
                            obj.id.as_deref().unwrap_or("?"), i, obj.x, obj.y
                        );
                    }
                    widgets.push(GeomWidget { ptr, start_x: sx, start_y: sy });
                }
            }
        }
        if !widgets.is_empty() {
            // Dimensioni iniziali dal primo widget: è quello che porta la
            // geometria dell'oggetto (gli altri sono decorazioni interne).
            let (w0, h0) = unsafe {
                let p = widgets[0].ptr.as_ptr();
                (lvgl_sys::lv_obj_get_width(p), lvgl_sys::lv_obj_get_height(p))
            };
            // `obj` qui è già passato da `apply_bindings`, quindi `x`/`y` sono
            // i valori RISOLTI alla creazione: sono loro l'origine da cui
            // misurare lo scostamento, non le coordinate statiche del synottico.
            let start_bound_x = bindings.get("x").and_then(|s| resolve_binding_value(s, tags)).and_then(|v| v.as_f64());
            let start_bound_y = bindings.get("y").and_then(|s| resolve_binding_value(s, tags)).and_then(|v| v.as_f64());
            live.push(LiveBinding {
                kind: LiveKind::Geometry {
                    widgets,
                    bindings,
                    start_bound_x,
                    start_bound_y,
                    applied_dx: 0,
                    applied_dy: 0,
                    applied_w: w0,
                    applied_h: h0,
                    applied_visible: obj.visible.unwrap_or(true),
                },
            });
        }
    }
    result
}

/// `faceplate`: template composito di oggetti già ordinari (`FaceplateDef`
/// in `sws-web/src/synoptic.rs`, `objects: Vec<serde_json::Value>` —
/// **non** contiene SVG, quindi non è bloccato dal vincolo che ferma
/// `symbol`/Q15). Recupera la definizione via `GET /api/faceplates/:id`
/// (`client::fetch_faceplate`, stesso endpoint anonymous-readable già usato
/// da `fetch_page`/`fetch_tag_snapshot`), sostituisce i placeholder
/// `{param}` nei campi stringa (`tag`/`label`/`text`, sottoinsieme di quanto
/// fa `substituteParams` in `SvgCanvas.tsx` — solo i campi che il modello
/// di questo motore conosce) e richiama `dispatch_render` per ciascun
/// figlio, con le coordinate traslate all'origine dell'istanza. Un
/// `fetch_faceplate` bloccante (`rt_handle.block_on`) durante il rendering
/// della pagina, non in background: la definizione serve prima di poter
/// creare i widget dei figli, non è un dato che possa arrivare più tardi
/// come gli aggiornamenti tag.
///
/// **Niente faceplate dentro faceplate**: un figlio di tipo `"faceplate"`
/// viene scartato come qualunque altro tipo non in `SUPPORTED_TYPES` (la
/// guardia sotto lo esclude esplicitamente) — evita ricorsione illimitata
/// per una funzionalità che né il web né questo motore hanno mai previsto
/// come caso d'uso reale, non una limitazione imposta per pigrizia.
#[allow(clippy::too_many_arguments)]
fn render_faceplate(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    styles: &mut Vec<Style>,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
    shared_alarms: &SharedAlarms,
    ack_tx: &mpsc::Sender<String>,
    lang_table: &LanguageTable,
    shared_lang: &SharedLang,
    own_page_id: &str,
    live: &mut Vec<LiveBinding>,
) -> anyhow::Result<()> {
    let id = obj
        .faceplate_id
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("faceplate senza faceplate_id"))?;
    let defn = rt_handle.block_on(client::fetch_faceplate(base_url, id))?;
    let params = obj.faceplate_params.clone().unwrap_or_default();
    let origin_x = obj.x.unwrap_or(0.0);
    let origin_y = obj.y.unwrap_or(0.0);

    // Porta `s.replace(/\{(\w+)\}/g, ...)` di `substituteParams` in
    // `SvgCanvas.tsx`: un placeholder senza valore in `params` resta
    // testuale (`{key}`), stesso comportamento del web.
    let subst = |s: &str| -> String {
        let mut out = String::with_capacity(s.len());
        let mut rest = s;
        while let Some(open) = rest.find('{') {
            out.push_str(&rest[..open]);
            rest = &rest[open..];
            match rest.find('}') {
                Some(close) => {
                    let key = &rest[1..close];
                    match params.get(key) {
                        Some(val) => out.push_str(val),
                        None => out.push_str(&rest[..=close]),
                    }
                    rest = &rest[close + 1..];
                }
                None => {
                    out.push_str(rest);
                    rest = "";
                    break;
                }
            }
        }
        out.push_str(rest);
        out
    };

    for raw_child in &defn.objects {
        let Ok(mut child) = serde_json::from_value::<SynopticObject>(raw_child.clone()) else {
            continue; // figlio malformato: ignorato silenziosamente, stesso principio del resto del parser
        };
        let Some(child_type) = child.obj_type.clone() else { continue };
        if !SUPPORTED_TYPES.contains(&child_type.as_str()) || child_type == "faceplate" {
            continue;
        }
        child.x = Some(origin_x + child.x.unwrap_or(0.0));
        child.y = Some(origin_y + child.y.unwrap_or(0.0));
        if let Some(t) = &child.tag {
            child.tag = Some(subst(t));
        }
        if let Some(l) = &child.label {
            child.label = Some(subst(l));
        }
        if let Some(t) = &child.text {
            child.text = Some(subst(t));
        }
        // Errori sul singolo figlio non abortiscono l'intero faceplate —
        // stesso principio di tolleranza del loop principale in
        // render_page_objects, un widget rotto non deve far sparire
        // l'intera istanza.
        let _ = dispatch_render(
            screen, &child_type, &child, styles, tags, tag_tx, nav_tx, base_url, rt_handle, shared_alarms, ack_tx,
            lang_table, shared_lang, own_page_id, live,
        );
    }
    Ok(())
}

/// Prima pagina di una sessione: registra il display LVGL alla risoluzione
/// di questa pagina (`resolve_resolution` — vedi commento su `HOR_RES`) e
/// delega a `render_page_objects` per la creazione dei widget. Ritorna anche
/// `hor_res`/`ver_res` risolti: il chiamante li usa per dimensionare la
/// finestra SDL2 (`main.rs`), che deve combaciare con quanto passato a
/// `init_display`.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
pub fn interpret_page(
    page: &SynopticPage,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
    shared_alarms: &SharedAlarms,
    ack_tx: &mpsc::Sender<String>,
    lang_table: &LanguageTable,
    shared_lang: &SharedLang,
) -> anyhow::Result<(RenderSummary, Vec<Style>, Vec<LiveBinding>, u32, u32)> {
    let (hor_res, ver_res) = resolve_resolution(page);
    crate::lvgl_display::init_display(hor_res, ver_res)?;
    let (summary, styles, live) = render_page_objects(
        page, tags, tag_tx, nav_tx, base_url, rt_handle, shared_alarms, ack_tx, lang_table, shared_lang,
    )?;
    Ok((summary, styles, live, hor_res, ver_res))
}

/// Crea un widget per ogni oggetto supportato della pagina su uno schermo
/// **nuovo** (non chiama `init_display` — per quello vedi `interpret_page`,
/// solo per la prima pagina di una sessione), poi lo carica con
/// `lv_disp_load_scr` (quello dietro la macro `lv_scr_load` di LVGL — non
/// esposta dal binding perché `static inline` nell'header C, verificato
/// prima di reimplementarla a mano) e distrugge lo schermo precedente.
///
/// **Perché uno schermo nuovo invece di ripulire quello attivo** (prima
/// versione di questa funzione, sostituita): `lv_obj_clean` sullo schermo
/// attivo + ricreazione dei widget ha prodotto, su navigazioni ripetute con
/// il catalogo widget completo (in particolare `gauge`/`lv_meter`), sia un
/// crash (`_lv_obj_style_apply_color_filter` su un puntatore non più
/// valido durante il ridisegno) sia un artefatto visivo distinto (testo con
/// un pattern a righe sopra) — non risolti aggiungendo un
/// `lv_obj_invalidate` esplicito. Non è stato isolato il meccanismo esatto
/// (indagine approfondita ma non conclusiva, vedi Q14), ma
/// `lv_disp_load_scr`/`lv_obj_del` è il pattern standard e testato di LVGL
/// per il cambio schermo — schermo vecchio e nuovo restano alberi
/// completamente separati finché lo scambio non è completo, invece di
/// mutare in-place quello attivo — e si è mostrato stabile nei test.
///
/// **Non chiama `task_handler()`**: tocca al chiamante guidare il redraw
/// (loop SDL2 in `main.rs`), ripetutamente per tutta la durata della
/// finestra.
///
/// Ritorna anche gli `Style` statici e i `LiveBinding` (widget tag-
/// dipendenti, con i loro `Style` dinamici): entrambi devono restare vivi
/// quanto la pagina corrente, non solo quanto questa funzione — LVGL tiene
/// puntatori, non copie. Il chiamante passa i `LiveBinding` a
/// `update_bindings` a ogni frame per riflettere i valori tag correnti senza
/// ricreare nulla, e li sostituisce per intero (non li accumula) alla
/// prossima chiamata di questa funzione, quando naviga altrove.
#[allow(clippy::too_many_arguments)]
pub fn render_page_objects(
    page: &SynopticPage,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
    base_url: &str,
    rt_handle: &tokio::runtime::Handle,
    shared_alarms: &SharedAlarms,
    ack_tx: &mpsc::Sender<String>,
    lang_table: &LanguageTable,
    shared_lang: &SharedLang,
) -> anyhow::Result<(RenderSummary, Vec<Style>, Vec<LiveBinding>)> {
    let mut summary = RenderSummary::default();
    let mut styles: Vec<Style> = Vec::new();
    let mut live: Vec<LiveBinding> = Vec::new();

    // Schermo precedente (se c'è già un display registrato — non c'è al
    // primissimo avvio, lv_disp_get_scr_act restituirebbe comunque lo
    // schermo di default auto-creato da LVGL, che va trattato allo stesso
    // modo: distrutto dopo lo scambio, nessun caso speciale per la prima
    // pagina).
    let old_scr_ptr = unsafe { lvgl_sys::lv_disp_get_scr_act(core::ptr::null_mut()) };

    // lv_obj_create(NULL) crea uno schermo di primo livello, non un figlio
    // (stesso motivo per cui create_child_obj esiste per il caso figlio —
    // vedi il suo commento). Non ancora "attivo": lo diventa solo dopo
    // lv_disp_load_scr più sotto, quando tutti i widget sono già a posto.
    let mut screen: lvgl::Obj = unsafe {
        let ptr = lvgl_sys::lv_obj_create(core::ptr::null_mut());
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_obj_create(NULL) ha restituito null"))?;
        <lvgl::Obj as Widget>::from_raw(nn)
    };

    // Il font va messo su OGNI schermo, non una volta all'avvio: qui se ne
    // crea uno nuovo a ogni pagina, e uno stile impostato sul precedente non
    // segue. `text_font` è ereditabile, quindi lo raccolgono tutti i widget
    // che finiranno dentro (Q24).
    lvgl_font::apply_to(screen.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr());
    if let Some(bg) = &page.background {
        apply_bg_color(&mut screen, bg, &mut styles)?;
    }

    // Q18 — colore predefinito del testo dallo sfondo della pagina.
    //
    // Si applica allo SCHERMO, non a ogni widget: in LVGL `text_color` è una
    // proprietà ereditabile, quindi i figli senza colore esplicito la prendono
    // da qui. È l'equivalente della custom property `--synoptic-text` che fa
    // lo stesso mestiere sul web, e per lo stesso motivo: non dover infilare
    // il colore in ogni firma di render.
    //
    // Un oggetto con `color` proprio continua a vincere: questo è solo il
    // valore di partenza, non un'imposizione.
    if let Some(rgb) = default_text_rgb(page.background.as_deref()) {
        let mut text_style = Style::default();
        text_style.set_text_color(Color::from_rgb(rgb));
        screen
            .add_style(Part::Main, &mut text_style)
            .map_err(|e| anyhow::anyhow!("add_style testo: {e:?}"))?;
        styles.push(text_style);
    }

    // Id della pagina corrente: serve a `lang_button`/`lang_selector` per
    // ricaricarla via `nav_tx` dopo un cambio lingua — un navbutton verso se
    // stessa, riusando la stessa strada di qualunque altra navigazione
    // invece di una coda dedicata (vedi `render_lang_button`).
    let own_page_id = page.id.clone().unwrap_or_default();

    for obj in &page.objects {
        let (Some(id), Some(obj_type)) = (obj.id.as_deref(), obj.obj_type.as_deref()) else {
            continue; // oggetto senza id/type: dato malformato, ignorato silenziosamente
        };
        // F2: i binding proprietà→tag vanno risolti PRIMA del render, come fa
        // `resolveObject` sul web — altrimenti il widget nasce con la
        // geometria statica e la posizione live non arriva mai.
        // NOTA: questo dà lo stato iniziale corretto, non ancora il movimento
        // continuo. Per quello serve il puntatore al widget dentro
        // `update_bindings`, e le funzioni `render_*` oggi non lo restituiscono
        // — vedi STATUS.md, va fatto col resto della parità F9c.
        let bound = apply_bindings(obj, tags);
        let obj = bound.as_ref().unwrap_or(obj);
        if !is_visible(obj, tags) {
            continue;
        }
        if !SUPPORTED_TYPES.contains(&obj_type) {
            summary.skipped_unsupported.push(format!("{id} ({obj_type})"));
            continue;
        }
        let result: anyhow::Result<()> = dispatch_render(
            &mut screen, obj_type, obj, &mut styles, tags, tag_tx, nav_tx, base_url, rt_handle, shared_alarms, ack_tx,
            lang_table, shared_lang, &own_page_id, &mut live,
        );
        match result {
            Ok(()) => summary.rendered.push(format!("{id} ({obj_type})")),
            Err(e) => summary.skipped_unsupported.push(format!("{id} ({obj_type}) — errore: {e}")),
        }
    }

    unsafe {
        let new_scr_ptr = screen.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_ptr();
        // lv_disp_load_scr (dietro lv_scr_load, vedi commento della
        // funzione): rende attivo il nuovo schermo. Il vecchio smette di
        // essere quello attivo ma non viene distrutto da questa chiamata
        // (auto_del=false dentro la sua implementazione) — tocca a noi,
        // subito dopo, ora che il nuovo è già a schermo.
        lvgl_sys::lv_disp_load_scr(new_scr_ptr);
        if !old_scr_ptr.is_null() {
            lvgl_sys::lv_obj_del(old_scr_ptr);
        }
    }

    Ok((summary, styles, live))
}

/// Aggiorna tutti i widget tag-dipendenti in base allo stato corrente dei
/// tag — chiamata dal chiamante a ogni frame (o quasi). Nessuna allocazione
/// di `Style` qui: quelli esistenti vengono mutati sul posto e "rinfrescati"
/// con `lv_obj_refresh_style` (mutare le proprietà di uno `Style` già
/// assegnato non basta da solo — LVGL cache lo stile calcolato per oggetto).
/// Quanta memoria occupano le bitmap SVG di questa pagina.
///
/// Il numero su cui si giocava tutta la decisione D2 — vale la pena vederlo a
/// ogni caricamento invece di ricavarlo a mano quando qualcosa va storto. Sono
/// byte del processo, non del pool da 1 MB di LVGL (vedi `render_svg_raster`).
pub fn svg_bitmap_bytes(bindings: &[LiveBinding]) -> usize {
    bindings
        .iter()
        .map(|b| match &b.kind {
            LiveKind::SvgRaster { buf, .. } => buf.len(),
            _ => 0,
        })
        .sum()
}

pub fn update_bindings(bindings: &mut [LiveBinding], tags: &TagSnapshot) {
    for b in bindings {
        match &mut b.kind {
            LiveKind::PipeFill { fill_ptr, spec, buf, last_level } => {
                let level = spec.level(tags);
                // Si ridisegna solo a variazione percettibile: ricostruire la
                // polilinea a ogni frame costerebbe senza cambiare un pixel.
                // Mezzo punto percentuale su un tubo di 350 px è mezzo pixel.
                if (level - *last_level).abs() > 0.005 {
                    apply_pipe_fill(*fill_ptr, spec, buf, level);
                    *last_level = level;
                }
            }
            // Bitmap fissa: non si ricolora per stato (vedi `render_svg_raster`).
            // Sta fra i binding solo perché `buf` deve restare vivo quanto il
            // canvas.
            LiveKind::SvgRaster { .. } => {}
            LiveKind::Led { ptr, tag, on_value, on_color, off_color } => {
                let tv = lookup(tags, tag);
                let (is_on, bad_quality, color_hex) = led_state(tv, on_value, on_color, off_color);
                unsafe {
                    if let Some(rgb) = parse_hex_color(&color_hex) {
                        lvgl_sys::lv_led_set_color(ptr.as_ptr(), Color::from_rgb(rgb).into());
                    }
                    if tv.is_some() && (is_on || bad_quality) {
                        lvgl_sys::lv_led_on(ptr.as_ptr());
                    } else {
                        lvgl_sys::lv_led_off(ptr.as_ptr());
                    }
                }
            }
            LiveKind::BarLike { ptr, tag, min, max } => {
                // Se l'utente sta trascinando lo slider in questo momento
                // (LV_STATE_PRESSED), non sovrascrivere il valore con quello
                // — ancora vecchio — nello snapshot tag: il round-trip verso
                // il backend (scrittura + delta WS di ritorno) richiede
                // qualche frame, e senza questa guardia il valore "salterebbe
                // indietro" a ogni frame per tutta la durata del drag,
                // combattendo continuamente il gesto dell'utente. Su
                // progress_bar (stesso binding, mai in stato PRESSED in uso
                // normale) questo controllo è un no-op innocuo.
                let dragging = unsafe {
                    lvgl_sys::lv_obj_has_state(ptr.as_ptr(), lvgl_sys::LV_STATE_PRESSED as lvgl_sys::lv_state_t)
                };
                if dragging {
                    continue;
                }
                let raw = lookup(tags, tag)
                    .map(|t| tag_value_as_f64(&t.value))
                    .unwrap_or(*min)
                    .clamp(min.min(*max), min.max(*max));
                unsafe {
                    lvgl_sys::lv_bar_set_value(ptr.as_ptr(), raw.round() as i32, lvgl::Animation::OFF.into());
                }
            }
            LiveKind::Checkbox { ptr, tag, checked_value } => {
                apply_checked_state(*ptr, checkbox_is_checked(lookup(tags, tag), checked_value));
            }
            LiveKind::Text {
                ptr,
                tag,
                format,
                static_text,
                text_color_by_threshold,
                alarm_low,
                warn_low,
                warn_high,
                alarm_high,
                static_color_hex,
                color_style,
            } => {
                let tv = lookup(tags, tag);
                let content = match tv {
                    Some(t) => format_value(&t.value, format.as_deref().or(Some("{value}"))),
                    None => static_text
                        .clone()
                        .or_else(|| tag.clone())
                        .unwrap_or_else(|| "Testo".to_string()),
                };
                unsafe {
                    lvgl_sys::lv_label_set_text(ptr.as_ptr(), text_cstring(&content).as_ptr());
                }
                if let Some(style) = color_style {
                    let rgb = text_color_hex(
                        tv,
                        *text_color_by_threshold,
                        *alarm_low,
                        *warn_low,
                        *warn_high,
                        *alarm_high,
                        static_color_hex.as_deref(),
                    );
                    if let Some(rgb) = rgb {
                        style.set_text_color(Color::from_rgb(rgb));
                        unsafe {
                            lvgl_sys::lv_obj_refresh_style(
                                ptr.as_ptr(),
                                Part::Main.into(),
                                lvgl_sys::lv_style_prop_t_LV_STYLE_TEXT_COLOR,
                            );
                        }
                    }
                }
            }
            LiveKind::Gauge { ptr, needle_indic, arc_indic, value_ptr, tag, min, max, unit } => {
                let raw = lookup(tags, tag)
                    .map(|t| tag_value_as_f64(&t.value))
                    .unwrap_or(*min)
                    .clamp(min.min(*max), min.max(*max));
                let unit_suffix = unit.as_deref().map(|u| format!(" {u}")).unwrap_or_default();
                unsafe {
                    lvgl_sys::lv_meter_set_indicator_value(ptr.as_ptr(), *needle_indic, raw.round() as i32);
                    lvgl_sys::lv_meter_set_indicator_end_value(ptr.as_ptr(), *arc_indic, raw.round() as i32);
                    lvgl_sys::lv_label_set_text(
                        value_ptr.as_ptr(),
                        text_cstring(&format!("{raw:.1}{unit_suffix}")).as_ptr(),
                    );
                }
            }
            LiveKind::StateLamp { lamp_ptr, lamp_style, label_ptr, label_style, tag, entries, default_label, default_color } => {
                let tv = lookup(tags, tag);
                let entry = match_text_list_entry(entries, tv);
                let lamp_hex = entry.and_then(|e| e.color.as_deref()).unwrap_or("#334155").to_string();
                let label_text = entry
                    .map(|e| e.label.clone())
                    .or_else(|| default_label.clone())
                    .unwrap_or_default();
                let label_hex = if entry.is_some() {
                    lamp_hex.clone()
                } else {
                    default_color.clone().unwrap_or_else(|| "#94a3b8".to_string())
                };
                unsafe {
                    if let Some(rgb) = parse_hex_color(&lamp_hex) {
                        lamp_style.set_bg_color(Color::from_rgb(rgb));
                        lvgl_sys::lv_obj_refresh_style(
                            lamp_ptr.as_ptr(),
                            Part::Main.into(),
                            lvgl_sys::lv_style_prop_t_LV_STYLE_BG_COLOR,
                        );
                    }
                    lvgl_sys::lv_label_set_text(label_ptr.as_ptr(), text_cstring(&label_text).as_ptr());
                    if let Some(rgb) = parse_hex_color(&label_hex) {
                        label_style.set_text_color(Color::from_rgb(rgb));
                        lvgl_sys::lv_obj_refresh_style(
                            label_ptr.as_ptr(),
                            Part::Main.into(),
                            lvgl_sys::lv_style_prop_t_LV_STYLE_TEXT_COLOR,
                        );
                    }
                }
            }
            LiveKind::Table { ptr, rows } => {
                update_table_data_cells(*ptr, rows, tags);
            }
            LiveKind::Trend { ptr, series, window_s, autofit } => {
                update_trend(*ptr, series, *window_s, *autofit);
            }
            LiveKind::AlarmViewer { shared, empty_ptr, show_empty, rows, prefix, allowed_sev } => {
                update_alarm_viewer(shared, *empty_ptr, *show_empty, rows, prefix, allowed_sev.as_deref());
            }
            LiveKind::TextList { label_ptr, label_style, tag, entries, default_label, default_color } => {
                let tv = lookup(tags, tag);
                let entry = match_text_list_entry(entries, tv);
                let label_text = entry
                    .map(|e| e.label.clone())
                    .or_else(|| default_label.clone())
                    .unwrap_or_default();
                let label_hex = entry
                    .and_then(|e| e.color.clone())
                    .or_else(|| default_color.clone())
                    .unwrap_or_else(|| "#f1f5f9".to_string());
                unsafe {
                    lvgl_sys::lv_label_set_text(label_ptr.as_ptr(), text_cstring(&label_text).as_ptr());
                    if let Some(rgb) = parse_hex_color(&label_hex) {
                        label_style.set_text_color(Color::from_rgb(rgb));
                        lvgl_sys::lv_obj_refresh_style(
                            label_ptr.as_ptr(),
                            Part::Main.into(),
                            lvgl_sys::lv_style_prop_t_LV_STYLE_TEXT_COLOR,
                        );
                    }
                }
            }
            LiveKind::BarChart { bars } => update_bar_chart(bars, tags),
            LiveKind::Sparkline { ptr, ser, shared, last_seen_version, last_samples, window_s } => {
                update_sparkline(*ptr, *ser, shared, last_seen_version, last_samples, *window_s);
            }
            LiveKind::AlarmBanner { shared, dot_ptr, dot_style, msg_ptr, empty_ptr, prefix, allowed_sev } => {
                update_alarm_banner(shared, *dot_ptr, dot_style, *msg_ptr, *empty_ptr, prefix, allowed_sev.as_deref());
            }
            LiveKind::XyPlot { ptr, ser, x_tag, y_tag, trail_s, samples, last_sample_ms, x_min, x_max, y_min, y_max } => {
                update_xy_plot(*ptr, *ser, tags, x_tag, y_tag, *trail_s, samples, last_sample_ms, *x_min, *x_max, *y_min, *y_max);
            }
            LiveKind::PieChart { canvas_ptr, w, h, slices, inner_ratio, last_values, .. } => {
                let values: Vec<f64> = slices
                    .iter()
                    .map(|s| lookup(tags, &Some(s.tag.clone())).map(|t| tag_value_as_f64(&t.value)).unwrap_or(0.0).max(0.0))
                    .collect();
                if values != *last_values {
                    draw_pie_donut(*canvas_ptr, *w, *h, slices, &values, *inner_ratio);
                    *last_values = values;
                }
            }
            LiveKind::Setpoint { value_ptr, tag, unit } => {
                // Se l'overlay di modifica è visibile, non sovrascrivere:
                // stesso principio della guardia "dragging" di `BarLike`,
                // altrimenti il valore digitato verrebbe rimpiazzato dal
                // vecchio valore del tag a metà digitazione.
                let raw = lookup(tags, tag).map(|t| tag_value_as_f64(&t.value));
                if let Some(v) = raw {
                    unsafe {
                        lvgl_sys::lv_label_set_text(value_ptr.as_ptr(), text_cstring(&format!("{v:.1}{unit}")).as_ptr());
                    }
                }
            }
            LiveKind::AlarmBell { shared, badge_ptr, row_ptrs, prefix, allowed_sev, last_count } => {
                update_alarm_bell(shared, *badge_ptr, row_ptrs, prefix, allowed_sev.as_deref(), last_count);
            }
            LiveKind::Symbol { canvas_ptr, w, h, symbol_id, state_tag, alarm_tag, off_color, on_color, alarm_color, last_state, buf: _ } => {
                let state = resolve_symbol_state(tags, state_tag, alarm_tag);
                if Some(state) != *last_state {
                    let hex = match state {
                        SymbolState::Off => off_color.as_str(),
                        SymbolState::On => on_color.as_str(),
                        SymbolState::Alarm => alarm_color.as_str(),
                    };
                    let rgb = parse_hex_color(hex).unwrap_or((100, 116, 139));
                    draw_symbol(*canvas_ptr, symbol_id, state, rgb, *w, *h);
                    *last_state = Some(state);
                }
            }
            LiveKind::Geometry {
                widgets, bindings, start_bound_x, start_bound_y,
                applied_dx, applied_dy, applied_w, applied_h, applied_visible,
            } => {
                let prev = ResolvedGeom {
                    dx: *applied_dx, dy: *applied_dy,
                    w: *applied_w, h: *applied_h,
                    visible: *applied_visible,
                };
                let next = resolve_geometry(bindings, tags, *start_bound_x, *start_bound_y, &prev);
                if next == prev {
                    continue; // fermo: non toccare nulla, o si ridisegna per niente
                }
                unsafe {
                    if next.dx != prev.dx || next.dy != prev.dy {
                        // Tutti i widget si muovono insieme, ciascuno dalla
                        // PROPRIA posizione iniziale: l'oggetto trasla, non
                        // collassa su un punto.
                        for g in widgets.iter() {
                            lvgl_sys::lv_obj_set_x(g.ptr.as_ptr(), g.start_x + next.dx);
                            lvgl_sys::lv_obj_set_y(g.ptr.as_ptr(), g.start_y + next.dy);
                        }
                    }
                    // Larghezza e altezza solo sul widget principale: su un
                    // oggetto composito non esiste un modo univoco di
                    // ridimensionare le parti interne, e indovinare vorrebbe
                    // dire deformarle. Limite dichiarato, non nascosto.
                    if let Some(main) = widgets.first() {
                        if next.w != prev.w {
                            lvgl_sys::lv_obj_set_width(main.ptr.as_ptr(), next.w);
                        }
                        if next.h != prev.h {
                            lvgl_sys::lv_obj_set_height(main.ptr.as_ptr(), next.h);
                        }
                    }
                    if next.visible != prev.visible {
                        for g in widgets.iter() {
                            if next.visible {
                                lvgl_sys::lv_obj_clear_flag(g.ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN);
                            } else {
                                lvgl_sys::lv_obj_add_flag(g.ptr.as_ptr(), lvgl_sys::LV_OBJ_FLAG_HIDDEN);
                            }
                        }
                    }
                }
                *applied_dx = next.dx;
                *applied_dy = next.dy;
                *applied_w = next.w;
                *applied_h = next.h;
                *applied_visible = next.visible;
            }
        }
    }
}

/// Aggiorna `xy_plot`: campiona (x,y) dal `TagSnapshot` corrente, throttled
/// a un campione ogni ~200ms (a 60fps sarebbero fino a 12 campioni identici
/// al secondo, inutili — `point_cnt` è comunque fissato a 64 in
/// `render_xy_plot`). Range fisso quando entrambi gli estremi sono
/// impostati nel synottico, altrimenti autofit sulla scia corrente.
#[allow(clippy::too_many_arguments)]
fn update_xy_plot(
    ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    ser: *mut lvgl_sys::lv_chart_series_t,
    tags: &TagSnapshot,
    x_tag: &Option<String>,
    y_tag: &Option<String>,
    trail_s: u64,
    samples: &mut Vec<(u64, f64, f64)>,
    last_sample_ms: &mut u64,
    x_min: Option<f64>,
    x_max: Option<f64>,
    y_min: Option<f64>,
    y_max: Option<f64>,
) {
    let now_ms = client::now_unix_ms();
    if now_ms.saturating_sub(*last_sample_ms) < 200 {
        return;
    }
    let (Some(xv), Some(yv)) = (lookup(tags, x_tag), lookup(tags, y_tag)) else { return };
    *last_sample_ms = now_ms;
    samples.push((now_ms, tag_value_as_f64(&xv.value), tag_value_as_f64(&yv.value)));
    let cutoff = now_ms.saturating_sub(trail_s.saturating_mul(1000));
    samples.retain(|(ts, _, _)| *ts >= cutoff);

    let point_count = samples.len().min(64).max(1);
    unsafe {
        lvgl_sys::lv_chart_set_point_count(ptr.as_ptr(), point_count as u16);
    }
    let start = samples.len().saturating_sub(64);
    let mut x_lo = f64::INFINITY;
    let mut x_hi = f64::NEG_INFINITY;
    let mut y_lo = f64::INFINITY;
    let mut y_hi = f64::NEG_INFINITY;
    for (i, (_, x, y)) in samples[start..].iter().enumerate() {
        x_lo = x_lo.min(*x);
        x_hi = x_hi.max(*x);
        y_lo = y_lo.min(*y);
        y_hi = y_hi.max(*y);
        unsafe {
            lvgl_sys::lv_chart_set_value_by_id2(ptr.as_ptr(), ser, i as u16, x.round() as i16, y.round() as i16);
        }
    }
    unsafe {
        let (xl, xh) = match (x_min, x_max) {
            (Some(lo), Some(hi)) => (lo, hi),
            _ if x_lo.is_finite() => (x_lo, if (x_hi - x_lo).abs() < 1.0 { x_lo + 1.0 } else { x_hi }),
            _ => (0.0, 100.0),
        };
        let (yl, yh) = match (y_min, y_max) {
            (Some(lo), Some(hi)) => (lo, hi),
            _ if y_lo.is_finite() => (y_lo, if (y_hi - y_lo).abs() < 1.0 { y_lo + 1.0 } else { y_hi }),
            _ => (0.0, 100.0),
        };
        lvgl_sys::lv_chart_set_range(ptr.as_ptr(), lvgl_sys::LV_CHART_AXIS_PRIMARY_X as lvgl_sys::lv_chart_axis_t, xl.round() as i16, xh.round() as i16);
        lvgl_sys::lv_chart_set_range(ptr.as_ptr(), lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t, yl.round() as i16, yh.round() as i16);
        lvgl_sys::lv_chart_refresh(ptr.as_ptr());
    }
}

/// Aggiorna il pannello `alarm_bell`: badge (conteggio) sempre, righe del
/// pannello elenco solo quando il conteggio cambia davvero (evita di
/// riscrivere `row_ptrs.len()` label a ogni frame per un pannello quasi
/// sempre nascosto).
fn update_alarm_bell(
    shared: &SharedAlarms,
    badge_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    row_ptrs: &[core::ptr::NonNull<lvgl_sys::lv_obj_t>],
    prefix: &str,
    allowed_sev: Option<&[String]>,
    last_count: &mut usize,
) {
    let mut alarms: Vec<AlarmStateLite> = {
        let map = shared.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|a| a.active)
            .filter(|a| prefix.is_empty() || a.def.id.starts_with(prefix))
            .filter(|a| allowed_sev.map_or(true, |sevs| sevs.iter().any(|s| s == &a.def.severity)))
            .cloned()
            .collect()
    };
    alarms.sort_by(|a, b| b.activated_at_ms.unwrap_or(0).cmp(&a.activated_at_ms.unwrap_or(0)));
    let count = alarms.len();
    unsafe {
        let hidden = lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t;
        if count == 0 {
            lvgl_sys::lv_obj_add_flag(badge_ptr.as_ptr(), hidden);
        } else {
            lvgl_sys::lv_obj_clear_flag(badge_ptr.as_ptr(), hidden);
            if let Some(child) = lvgl_sys::lv_obj_get_child(badge_ptr.as_ptr(), 0).as_mut() {
                lvgl_sys::lv_label_set_text(child, text_cstring(&count.to_string()).as_ptr());
            }
        }
    }
    if count == *last_count {
        return;
    }
    *last_count = count;
    let hidden = lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t;
    for (i, row_ptr) in row_ptrs.iter().enumerate() {
        unsafe {
            match alarms.get(i) {
                Some(a) => {
                    lvgl_sys::lv_label_set_text(row_ptr.as_ptr(), text_cstring(&a.def.message).as_ptr());
                    lvgl_sys::lv_obj_clear_flag(row_ptr.as_ptr(), hidden);
                }
                None => lvgl_sys::lv_obj_add_flag(row_ptr.as_ptr(), hidden),
            }
        }
    }
}

/// Aggiorna un `alarm_viewer` (modalità lista): legge `SharedAlarms`,
/// filtra/ordina/limita esattamente come `AlarmViewerWidget` in
/// `SvgCanvas.tsx` (solo attivi, `prefix`/`allowed_sev` opzionali, più
/// recente prima, tagliato a `rows.len()`), poi riassegna ogni slot riga
/// all'allarme che gli tocca in questo frame — non ricrea mai i widget,
/// stesso principio di `update_table_data_cells`.
fn update_alarm_viewer(
    shared: &SharedAlarms,
    empty_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    show_empty: bool,
    rows: &mut [AlarmRowBinding],
    prefix: &str,
    allowed_sev: Option<&[String]>,
) {
    let mut alarms: Vec<AlarmStateLite> = {
        let map = shared.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|a| a.active)
            .filter(|a| prefix.is_empty() || a.def.id.starts_with(prefix))
            .filter(|a| allowed_sev.map_or(true, |sevs| sevs.iter().any(|s| s == &a.def.severity)))
            .cloned()
            .collect()
    };
    alarms.sort_by(|a, b| b.activated_at_ms.unwrap_or(0).cmp(&a.activated_at_ms.unwrap_or(0)));
    alarms.truncate(rows.len());

    let hidden = lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t;
    unsafe {
        if alarms.is_empty() && show_empty {
            lvgl_sys::lv_obj_clear_flag(empty_ptr.as_ptr(), hidden);
        } else {
            lvgl_sys::lv_obj_add_flag(empty_ptr.as_ptr(), hidden);
        }
    }

    let now_ms = client::now_unix_ms();
    for (i, row) in rows.iter_mut().enumerate() {
        match alarms.get(i) {
            Some(a) => unsafe {
                let rgb = severity_color(&a.def.severity);
                row.dot_style.set_bg_color(Color::from_rgb(rgb));
                lvgl_sys::lv_obj_refresh_style(
                    row.dot_ptr.as_ptr(),
                    Part::Main.into(),
                    lvgl_sys::lv_style_prop_t_LV_STYLE_BG_COLOR,
                );
                lvgl_sys::lv_obj_clear_flag(row.dot_ptr.as_ptr(), hidden);

                lvgl_sys::lv_label_set_text(row.msg_ptr.as_ptr(), text_cstring(&a.def.message).as_ptr());
                lvgl_sys::lv_obj_clear_flag(row.msg_ptr.as_ptr(), hidden);

                if let Some(ts_ptr) = row.ts_ptr {
                    let ts_text = a.activated_at_ms.map(|ts| format_alarm_age(ts, now_ms)).unwrap_or_default();
                    lvgl_sys::lv_label_set_text(ts_ptr.as_ptr(), text_cstring(&ts_text).as_ptr());
                    lvgl_sys::lv_obj_clear_flag(ts_ptr.as_ptr(), hidden);
                }

                if let (Some(btn_ptr), Some(ctx)) = (row.ack_btn_ptr, row.ack_ctx) {
                    *ctx.current_id.borrow_mut() = a.def.id.clone();
                    if a.acknowledged {
                        lvgl_sys::lv_obj_add_flag(btn_ptr.as_ptr(), hidden);
                    } else {
                        lvgl_sys::lv_obj_clear_flag(btn_ptr.as_ptr(), hidden);
                    }
                }
            },
            None => unsafe {
                lvgl_sys::lv_obj_add_flag(row.dot_ptr.as_ptr(), hidden);
                lvgl_sys::lv_obj_add_flag(row.msg_ptr.as_ptr(), hidden);
                if let Some(p) = row.ts_ptr {
                    lvgl_sys::lv_obj_add_flag(p.as_ptr(), hidden);
                }
                if let Some(p) = row.ack_btn_ptr {
                    lvgl_sys::lv_obj_add_flag(p.as_ptr(), hidden);
                }
                if let Some(ctx) = row.ack_ctx {
                    // Niente id valido finché questo slot non viene
                    // riassegnato: se il click arrivasse comunque tra un
                    // frame e l'altro (pulsante già nascosto, ma la callback
                    // non lo sa) non manda nulla, vedi sws_alarm_ack_clicked_cb.
                    ctx.current_id.borrow_mut().clear();
                }
            },
        }
    }
}

/// Aggiorna un chart trend: legge `SharedHistory` per ogni serie, e se
/// almeno una ha una versione nuova dal poller, riscrive **tutte** le serie
/// (non solo quella cambiata) e chiama `lv_chart_refresh` una volta sola.
///
/// Perché tutte e non solo quella cambiata: `point_cnt` è una proprietà
/// dell'intero `lv_chart_t`, non per-serie (`lv_chart_set_point_count`
/// ridimensiona gli array `x_points`/`y_points` di **ogni** serie sul
/// chart — verificato in `lv_chart.c` prima di scrivere questo codice).
/// Impostarlo dentro un giro per-serie farebbe sì che l'ultima serie
/// processata sovrascriva silenziosamente il conteggio delle precedenti;
/// tenere `last_samples` per serie e riscriverle tutte insieme quando una
/// qualunque cambia evita quel bug per costruzione, al costo di qualche
/// riscrittura in più non strettamente necessaria (accettabile: succede al
/// massimo al ritmo del poll, ogni 2s, non a ogni frame).
fn update_trend(
    ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    series: &mut [TrendSeriesBinding],
    window_s: u64,
    autofit: bool,
) {
    let mut any_changed = false;
    for sb in series.iter_mut() {
        let (version, samples) = {
            let guard = sb.shared.lock().unwrap_or_else(|e| e.into_inner());
            (guard.0, guard.1.clone())
        };
        if version != sb.last_seen_version {
            sb.last_seen_version = version;
            sb.last_samples = samples;
            any_changed = true;
        }
    }
    if !any_changed {
        return;
    }

    let point_count = series.iter().map(|sb| sb.last_samples.len()).max().unwrap_or(0).max(1);
    unsafe {
        lvgl_sys::lv_chart_set_point_count(ptr.as_ptr(), point_count as u16);
    }

    let now_ms = client::now_unix_ms();
    let window_start_ms = now_ms.saturating_sub(window_s.saturating_mul(1000));
    let mut y_lo = f64::INFINITY;
    let mut y_hi = f64::NEG_INFINITY;
    for sb in series.iter() {
        for i in 0..point_count {
            match sb.last_samples.get(i) {
                Some(s) => {
                    let x = (s.ts_ms.saturating_sub(window_start_ms) / 1000).min(window_s) as i16;
                    let y_f = tag_value_as_f64(&s.value);
                    y_lo = y_lo.min(y_f);
                    y_hi = y_hi.max(y_f);
                    unsafe {
                        lvgl_sys::lv_chart_set_value_by_id2(ptr.as_ptr(), sb.ser, i as u16, x, y_f.round() as i16);
                    }
                }
                None => unsafe {
                    // LV_CHART_POINT_NONE su entrambe le coordinate: "non
                    // disegnare questo punto" (vedi lv_chart.h) — serie più
                    // corte della point_count del chart (imposta dalla serie
                    // più lunga, vedi sopra) restano corrette invece di
                    // mostrare l'ultimo valore stantio in quegli slot.
                    let none = lvgl_sys::LV_CHART_POINT_NONE as i16;
                    lvgl_sys::lv_chart_set_value_by_id2(ptr.as_ptr(), sb.ser, i as u16, none, none);
                },
            }
        }
    }

    if autofit && y_lo.is_finite() && y_hi.is_finite() {
        let (lo, hi) = if (y_hi - y_lo) < 1.0 { (y_lo - 1.0, y_hi + 1.0) } else { (y_lo, y_hi) };
        unsafe {
            lvgl_sys::lv_chart_set_range(
                ptr.as_ptr(),
                lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t,
                lo.round() as i16,
                hi.round() as i16,
            );
        }
    }
    unsafe {
        lvgl_sys::lv_chart_refresh(ptr.as_ptr());
    }
}

/// Versione a una sola serie di `update_trend`, sempre autofit — niente
/// `point_cnt` da riconciliare fra più serie (il problema per cui
/// `update_trend` riscrive tutte le serie insieme non esiste con una sola).
fn update_sparkline(
    ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    ser: *mut lvgl_sys::lv_chart_series_t,
    shared: &SharedHistory,
    last_seen_version: &mut u64,
    last_samples: &mut Vec<HistorySample>,
    window_s: u64,
) {
    let (version, samples) = {
        let guard = shared.lock().unwrap_or_else(|e| e.into_inner());
        (guard.0, guard.1.clone())
    };
    if version == *last_seen_version {
        return;
    }
    *last_seen_version = version;
    *last_samples = samples;

    let point_count = last_samples.len().max(1);
    unsafe {
        lvgl_sys::lv_chart_set_point_count(ptr.as_ptr(), point_count as u16);
    }

    let now_ms = client::now_unix_ms();
    let window_start_ms = now_ms.saturating_sub(window_s.saturating_mul(1000));
    let mut y_lo = f64::INFINITY;
    let mut y_hi = f64::NEG_INFINITY;
    for i in 0..point_count {
        match last_samples.get(i) {
            Some(s) => {
                let x = (s.ts_ms.saturating_sub(window_start_ms) / 1000).min(window_s) as i16;
                let y_f = tag_value_as_f64(&s.value);
                y_lo = y_lo.min(y_f);
                y_hi = y_hi.max(y_f);
                unsafe {
                    lvgl_sys::lv_chart_set_value_by_id2(ptr.as_ptr(), ser, i as u16, x, y_f.round() as i16);
                }
            }
            None => unsafe {
                let none = lvgl_sys::LV_CHART_POINT_NONE as i16;
                lvgl_sys::lv_chart_set_value_by_id2(ptr.as_ptr(), ser, i as u16, none, none);
            },
        }
    }
    if y_lo.is_finite() && y_hi.is_finite() {
        let (lo, hi) = if (y_hi - y_lo) < 1.0 { (y_lo - 1.0, y_hi + 1.0) } else { (y_lo, y_hi) };
        unsafe {
            lvgl_sys::lv_chart_set_range(
                ptr.as_ptr(),
                lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t,
                lo.round() as i16,
                hi.round() as i16,
            );
        }
    }
    unsafe {
        lvgl_sys::lv_chart_refresh(ptr.as_ptr());
    }
}

/// Aggiorna un `bar_chart`: stessa guardia anti-"combattimento durante il
/// drag" di `BarLike` non serve qui (le barre non sono trascinabili), quindi
/// scrive sempre il valore corrente.
fn update_bar_chart(bars: &mut [BarChartBarBinding], tags: &TagSnapshot) {
    for b in bars.iter() {
        let raw = lookup(tags, &Some(b.tag.clone()))
            .map(|t| tag_value_as_f64(&t.value))
            .unwrap_or(b.min)
            .clamp(b.min.min(b.max), b.min.max(b.max));
        unsafe {
            lvgl_sys::lv_bar_set_value(b.bar_ptr.as_ptr(), raw.round() as i32, lvgl::Animation::OFF.into());
            if b.show_values {
                if let Some(vp) = b.value_ptr {
                    lvgl_sys::lv_label_set_text(vp.as_ptr(), text_cstring(&format!("{raw:.1}{}", b.unit)).as_ptr());
                }
            }
        }
    }
}

/// Aggiorna `alarm_banner`: stesso `SharedAlarms`/filtro di `alarm_viewer`
/// ma un solo slot (l'allarme attivo più recente, non una lista).
fn update_alarm_banner(
    shared: &SharedAlarms,
    dot_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    dot_style: &mut Style,
    msg_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    empty_ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
    prefix: &str,
    allowed_sev: Option<&[String]>,
) {
    let top: Option<AlarmStateLite> = {
        let map = shared.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|a| a.active)
            .filter(|a| prefix.is_empty() || a.def.id.starts_with(prefix))
            .filter(|a| allowed_sev.map_or(true, |sevs| sevs.iter().any(|s| s == &a.def.severity)))
            .max_by_key(|a| a.activated_at_ms.unwrap_or(0))
            .cloned()
    };
    let hidden = lvgl_sys::LV_OBJ_FLAG_HIDDEN as lvgl_sys::lv_obj_flag_t;
    unsafe {
        match top {
            Some(a) => {
                let rgb = severity_color(&a.def.severity);
                dot_style.set_bg_color(Color::from_rgb(rgb));
                lvgl_sys::lv_obj_refresh_style(dot_ptr.as_ptr(), Part::Main.into(), lvgl_sys::lv_style_prop_t_LV_STYLE_BG_COLOR);
                lvgl_sys::lv_obj_clear_flag(dot_ptr.as_ptr(), hidden);
                lvgl_sys::lv_label_set_text(msg_ptr.as_ptr(), text_cstring(&a.def.message).as_ptr());
                lvgl_sys::lv_obj_clear_flag(msg_ptr.as_ptr(), hidden);
                lvgl_sys::lv_obj_add_flag(empty_ptr.as_ptr(), hidden);
            }
            None => {
                lvgl_sys::lv_obj_add_flag(dot_ptr.as_ptr(), hidden);
                lvgl_sys::lv_obj_add_flag(msg_ptr.as_ptr(), hidden);
                lvgl_sys::lv_obj_clear_flag(empty_ptr.as_ptr(), hidden);
            }
        }
    }
}

#[cfg(test)]
mod binding_tests {
    use super::*;
    use serde_json::json;

    fn snapshot(pairs: &[(&str, TagValue)]) -> TagSnapshot {
        pairs
            .iter()
            .map(|(k, v)| {
                (k.to_string(), TagSnapshotValue { value: v.clone(), quality: TagQuality::Good })
            })
            .collect()
    }

    /// La forma storica: il valore del tag sostituisce la proprietà, senza
    /// scalature. È quella dell'ellisse vista sul WP630, `{x: "slideX"}`.
    #[test]
    fn spec_stringa_prende_il_valore_del_tag() {
        let t = snapshot(&[("slideX", TagValue::Int(640))]);
        assert_eq!(resolve_binding_value(&json!("slideX"), &t), Some(json!(640)));
    }

    /// Tag assente = si tiene il valore statico. Un oggetto che resta dov'era
    /// è meno sbagliato di uno che salta a zero.
    #[test]
    fn tag_assente_non_produce_valore() {
        assert_eq!(resolve_binding_value(&json!("nessuno"), &snapshot(&[])), None);
    }

    #[test]
    fn spec_con_scalatura_mappa_e_limita() {
        let t = snapshot(&[("lvl", TagValue::Float(50.0))]);
        let spec = json!({"tag":"lvl","in_min":0,"in_max":100,"out_min":0,"out_max":1000});
        assert_eq!(resolve_binding_value(&spec, &t).and_then(|v| v.as_f64()), Some(500.0));
    }

    /// Il clamp è attivo salvo `clamp: false`, come sul web: un tag fuori
    /// scala non deve poter spedire un oggetto fuori dallo schermo.
    #[test]
    fn il_clamp_e_attivo_per_default_e_disattivabile() {
        let t = snapshot(&[("lvl", TagValue::Float(150.0))]);
        let base = json!({"tag":"lvl","in_min":0,"in_max":100,"out_min":0,"out_max":1000});
        assert_eq!(resolve_binding_value(&base, &t).and_then(|v| v.as_f64()), Some(1000.0));
        let libero = json!({"tag":"lvl","in_min":0,"in_max":100,"out_min":0,"out_max":1000,"clamp":false});
        assert_eq!(resolve_binding_value(&libero, &t).and_then(|v| v.as_f64()), Some(1500.0));
    }

    /// Intervallo di ingresso degenere: nessuna divisione per zero, si
    /// restituisce il valore così com'è.
    #[test]
    fn intervallo_nullo_non_divide_per_zero() {
        assert_eq!(scale_binding(7.0, 5.0, 5.0, 0.0, 100.0, true), 7.0);
    }

    /// `{expr}` non è valutabile qui (il web ha `evalExpr`, il motore LVGL no):
    /// va saltata, non indovinata.
    #[test]
    fn expr_non_e_supportata_e_lascia_il_valore_statico() {
        let t = snapshot(&[("a", TagValue::Float(1.0))]);
        assert_eq!(resolve_binding_value(&json!({"expr":"a * 2"}), &t), None);
    }

    #[test]
    fn apply_bindings_sposta_la_geometria() {
        let t = snapshot(&[("slideX", TagValue::Int(640))]);
        let mut obj = SynopticObject { x: Some(0.0), ..Default::default() };
        obj.bindings = Some([("x".to_string(), json!("slideX"))].into_iter().collect());
        let out = apply_bindings(&obj, &t).expect("dovrebbe produrre una copia");
        assert_eq!(out.x, Some(640.0));
    }

    /// Nessun binding risolvibile = nessuna copia, così il render continua a
    /// usare l'oggetto originale senza allocare per niente.
    #[test]
    fn senza_binding_risolvibili_non_copia() {
        let obj = SynopticObject { x: Some(10.0), ..Default::default() };
        assert!(apply_bindings(&obj, &snapshot(&[])).is_none());
    }

    /// Stessa coercizione booleana del web (BOOL_PROPS).
    #[test]
    fn visible_coercisce_come_sul_web() {
        let t = snapshot(&[("z", TagValue::Int(0)), ("uno", TagValue::Int(1))]);
        for (tag, atteso) in [("z", false), ("uno", true)] {
            let mut obj = SynopticObject::default();
            obj.bindings = Some([("visible".to_string(), json!(tag))].into_iter().collect());
            assert_eq!(apply_bindings(&obj, &t).unwrap().visible, Some(atteso));
        }
    }

    // ── Parità dei campi col mirror autorevole (F9c) ────────────────────
    //
    // `scripts/check_lvgl_parity.sh` verifica che i NOMI ci siano tutti,
    // confrontando le due struct nei sorgenti. Questi test verificano la cosa
    // che uno script sui sorgenti non può vedere: che serde li accetti davvero
    // e che i valori arrivino interi.
    //
    // La differenza conta. Un campo dichiarato col tipo sbagliato compila, il
    // controllo di parità lo dà per presente, e serde lo scarta a runtime —
    // esattamente il difetto silenzioso che tutto questo lotto esiste per
    // chiudere.

    #[test]
    fn i_campi_aggiunti_sopravvivono_al_parsing() {
        // Uno per tipo fra quelli aggiunti: stringa, booleano, numero, lista.
        let raw = json!({
            "id": "o1", "type": "gauge",
            "gauge_zones": [{"from": 0, "to": 50, "color": "#22c55e"}],
            "gauge_ticks": 12,
            "led_shape": "square",
            "trend_show_thresholds": true,
            "pie_show_legend": true,
            "table_columns": [{"key": "a"}],
            "motion_path": [[0, 0], [10, 10]],
            "corner_radius": 8
        });
        let o: SynopticObject = serde_json::from_value(raw).expect("deve interpretarsi");
        assert_eq!(o.gauge_ticks, Some(12.0));
        assert_eq!(o.led_shape.as_deref(), Some("square"));
        assert_eq!(o.trend_show_thresholds, Some(true));
        assert_eq!(o.pie_show_legend, Some(true));
        assert_eq!(o.corner_radius, Some(8.0));
        assert!(o.gauge_zones.is_some(), "le zone del gauge non devono sparire");
        assert!(o.table_columns.is_some());
        assert!(o.motion_path.is_some());
    }

    /// Un oggetto che usa SOLO campi nuovi deve comunque interpretarsi: è il
    /// caso di una pagina disegnata con funzioni recenti dell'editor e aperta
    /// su un pannello.
    #[test]
    fn un_oggetto_di_soli_campi_nuovi_non_fa_fallire_il_parsing() {
        let raw = json!({
            "id": "o2", "type": "rect",
            "bg_color": "#123456", "axis_color": "#abcdef",
            "font_family": "mono", "font_weight": "bold",
            "hide_when_empty": true
        });
        let o: SynopticObject = serde_json::from_value(raw).expect("deve interpretarsi");
        assert_eq!(o.bg_color.as_deref(), Some("#123456"));
        assert_eq!(o.font_family.as_deref(), Some("mono"));
    }

    /// La tolleranza di serde resta: un campo che NESSUNO dei due conosce non
    /// deve far fallire il parsing, altrimenti un pannello vecchio non
    /// aprirebbe più un progetto salvato da un IDE più nuovo.
    #[test]
    fn un_campo_sconosciuto_non_fa_fallire_il_parsing() {
        let raw = json!({"id": "o3", "type": "rect", "campo_del_futuro": 42});
        let o: SynopticObject = serde_json::from_value(raw).expect("deve tollerare l'ignoto");
        assert_eq!(o.id.as_deref(), Some("o3"));
    }

    // ── Colore del testo dallo sfondo pagina (Q18) ──────────────────────
    //
    // Questi casi sono gli STESSI di `tests/textOnBackground.test.ts` nel
    // frontend, di proposito: i due motori disegnano lo stesso progetto, e un
    // testo leggibile sul browser e invisibile sul pannello sarebbe
    // esattamente il difetto di parità che il template gemello esiste per
    // scoprire. Se qui si cambia una soglia, va cambiata anche là.

    #[test]
    fn su_sfondo_scuro_il_testo_e_chiaro() {
        assert_eq!(default_text_rgb(Some("#0f172a")), Some((0xe2, 0xe8, 0xf0)));
        assert_eq!(default_text_rgb(Some("#000000")), Some((0xe2, 0xe8, 0xf0)));
    }

    #[test]
    fn su_sfondo_chiaro_il_testo_e_scuro() {
        assert_eq!(default_text_rgb(Some("#ffffff")), Some((0x0f, 0x17, 0x2a)));
        assert_eq!(default_text_rgb(Some("#f8fafc")), Some((0x0f, 0x17, 0x2a)));
    }

    /// Senza sfondo non si inventa un colore: resta il default del tema LVGL,
    /// cioè il comportamento di prima.
    #[test]
    fn senza_sfondo_non_si_impone_niente() {
        assert_eq!(default_text_rgb(None), None);
        assert_eq!(default_text_rgb(Some("")), None);
        assert_eq!(default_text_rgb(Some("non-un-colore")), None);
    }

    /// Il verde puro è chiaro nonostante rosso e blu a zero: la luminanza pesa
    /// il verde per il 72%. Una media aritmetica sbaglierebbe questo caso, ed è
    /// l'errore facile riscrivendo la funzione.
    #[test]
    fn i_canali_pesano_come_la_luminanza_non_come_una_media() {
        assert_eq!(default_text_rgb(Some("#00ff00")), Some((0x0f, 0x17, 0x2a)));
        assert_eq!(default_text_rgb(Some("#0000ff")), Some((0xe2, 0xe8, 0xf0)));
    }

    #[test]
    fn la_luminanza_e_monotona_dal_nero_al_bianco() {
        let nero = relative_luminance((0, 0, 0));
        let grigio = relative_luminance((128, 128, 128));
        let bianco = relative_luminance((255, 255, 255));
        assert!((nero - 0.0).abs() < 1e-9);
        assert!((bianco - 1.0).abs() < 1e-9);
        assert!(nero < grigio && grigio < bianco);
    }

    // ── Movimento (LiveKind::Geometry) ──────────────────────────────────────
    //
    // Solo la parte pura: `resolve_geometry` non tocca LVGL di proposito,
    // proprio perché sia verificabile senza un display.

    fn fermo() -> ResolvedGeom {
        ResolvedGeom { dx: 0, dy: 0, w: 100, h: 50, visible: true }
    }

    #[test]
    fn geometry_bindings_prende_solo_la_geometria() {
        let mut obj = SynopticObject::default();
        obj.bindings = Some([
            ("x".to_string(), json!("a")),
            ("visible".to_string(), json!("b")),
            ("fill".to_string(), json!("c")), // non è geometria
        ].into_iter().collect());
        let g = geometry_bindings(&obj).expect("x e visible sono geometria");
        assert!(g.get("x").is_some() && g.get("visible").is_some());
        assert!(g.get("fill").is_none(), "le proprietà non geometriche non vanno catturate");
    }

    #[test]
    fn senza_binding_di_geometria_non_si_cattura_niente() {
        let mut obj = SynopticObject::default();
        obj.bindings = Some([("fill".to_string(), json!("c"))].into_iter().collect());
        assert!(geometry_bindings(&obj).is_none());
        assert!(geometry_bindings(&SynopticObject::default()).is_none());
    }

    #[test]
    fn lo_scostamento_e_relativo_al_valore_iniziale() {
        // Creato con slideX=100, ora slideX=340 → si sposta di +240, non a 340.
        let t = snapshot(&[("slideX", TagValue::Int(340))]);
        let b = json!({ "x": "slideX" });
        let g = resolve_geometry(&b, &t, Some(100.0), None, &fermo());
        assert_eq!(g.dx, 240);
        assert_eq!(g.dy, 0, "senza binding su y non si muove in verticale");
    }

    #[test]
    fn scostamento_negativo() {
        let t = snapshot(&[("slideX", TagValue::Int(20))]);
        let g = resolve_geometry(&json!({ "x": "slideX" }), &t, Some(100.0), None, &fermo());
        assert_eq!(g.dx, -80);
    }

    #[test]
    fn tag_assente_tiene_la_posizione_invece_di_saltare_a_zero() {
        let t = snapshot(&[]);
        let prev = ResolvedGeom { dx: 42, dy: 7, w: 100, h: 50, visible: true };
        let g = resolve_geometry(&json!({ "x": "manca", "y": "manca" }), &t, Some(0.0), Some(0.0), &prev);
        assert_eq!((g.dx, g.dy), (42, 7), "un tag che sparisce non deve far saltare l'oggetto all'origine");
    }

    #[test]
    fn senza_valore_iniziale_non_si_muove() {
        // x non era risolvibile alla creazione: non c'è un'origine da cui
        // misurare, quindi si resta fermi invece di inventare uno scostamento.
        let t = snapshot(&[("slideX", TagValue::Int(500))]);
        let g = resolve_geometry(&json!({ "x": "slideX" }), &t, None, None, &fermo());
        assert_eq!(g.dx, 0);
    }

    #[test]
    fn larghezza_e_altezza_sono_assolute_non_relative() {
        let t = snapshot(&[("w", TagValue::Int(250)), ("h", TagValue::Int(80))]);
        let g = resolve_geometry(&json!({ "width": "w", "height": "h" }), &t, None, None, &fermo());
        assert_eq!((g.w, g.h), (250, 80));
    }

    #[test]
    fn dimensioni_negative_non_arrivano_a_lvgl() {
        let t = snapshot(&[("w", TagValue::Int(-40))]);
        let g = resolve_geometry(&json!({ "width": "w" }), &t, None, None, &fermo());
        assert_eq!(g.w, 0, "una larghezza negativa va tagliata a 0, non passata a lv_obj_set_width");
    }

    #[test]
    fn visible_segue_la_coercizione_del_web() {
        let t = snapshot(&[("on", TagValue::Int(1)), ("off", TagValue::Int(0))]);
        for (tag, atteso) in [("on", true), ("off", false)] {
            let g = resolve_geometry(&json!({ "visible": tag }), &t, None, None, &fermo());
            assert_eq!(g.visible, atteso);
        }
    }

    #[test]
    fn la_scalatura_vale_anche_qui() {
        // 0..100 del tag → 0..640 di schermo, com'è nella spec del web.
        let t = snapshot(&[("liv", TagValue::Float(50.0))]);
        let b = json!({ "x": { "tag": "liv", "in_min": 0, "in_max": 100, "out_min": 0, "out_max": 640 } });
        let g = resolve_geometry(&b, &t, Some(0.0), None, &fermo());
        assert_eq!(g.dx, 320);
    }

    // ── Tracce del trend: formato nuovo, ripiego sul vecchio ────────────────

    fn traccia(tag: &str, hidden: Option<bool>, color: Option<&str>) -> crate::model::TrendTrace {
        crate::model::TrendTrace {
            tag: tag.to_string(),
            hidden,
            color: color.map(str::to_string),
        }
    }

    /// La regressione che ha motivato il lotto: dopo la migrazione 2.1.0 le
    /// tracce stanno in `trend_tags` e il motore le cercava in `tag`, quindi il
    /// grafico restava vuoto.
    #[test]
    fn il_formato_nuovo_viene_letto() {
        let obj = SynopticObject {
            trend_tags: Some(vec![traccia("t1", None, Some("#ff0000")), traccia("t2", None, None)]),
            ..Default::default()
        };
        let r = resolve_trend_traces(&obj);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].tag, "t1");
        assert_eq!(r[0].color.as_deref(), Some("#ff0000"));
        assert_eq!(r[1].color, None);
    }

    /// I progetti sui dispositivi in servizio non sono ancora migrati: devono
    /// continuare a disegnare.
    #[test]
    fn il_formato_precedente_continua_a_funzionare() {
        let obj = SynopticObject {
            tag: Some("principale".into()),
            extra_tags: Some(vec!["secondo".into(), "terzo".into()]),
            ..Default::default()
        };
        let r = resolve_trend_traces(&obj);
        assert_eq!(r.iter().map(|t| t.tag.as_str()).collect::<Vec<_>>(),
                   vec!["principale", "secondo", "terzo"]);
    }

    #[test]
    fn le_tracce_nascoste_non_si_disegnano() {
        let obj = SynopticObject {
            trend_tags: Some(vec![
                traccia("visibile", Some(false), None),
                traccia("nascosta", Some(true), None),
            ]),
            ..Default::default()
        };
        let r = resolve_trend_traces(&obj);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].tag, "visibile");
    }

    /// Un elenco vuoto significa "nessuna traccia", non "usa il formato
    /// vecchio": ripiegare qui farebbe ricomparire tag che l'utente ha tolto.
    #[test]
    fn elenco_vuoto_non_fa_ripiegare_sul_formato_vecchio() {
        let obj = SynopticObject {
            trend_tags: Some(vec![]),
            tag: Some("vecchio".into()),
            ..Default::default()
        };
        assert!(resolve_trend_traces(&obj).is_empty());
    }

    #[test]
    fn i_tag_vuoti_vengono_scartati_in_entrambi_i_formati() {
        let nuovo = SynopticObject {
            trend_tags: Some(vec![traccia("  ", None, None), traccia("buono", None, None)]),
            ..Default::default()
        };
        assert_eq!(resolve_trend_traces(&nuovo).len(), 1);

        let vecchio = SynopticObject {
            tag: Some("".into()),
            extra_tags: Some(vec!["".into(), "buono".into()]),
            ..Default::default()
        };
        let r = resolve_trend_traces(&vecchio);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].tag, "buono");
    }

    #[test]
    fn un_trend_senza_niente_non_produce_serie() {
        assert!(resolve_trend_traces(&SynopticObject::default()).is_empty());
    }

    #[test]
    fn frame_identico_non_produce_scritture() {
        let t = snapshot(&[("slideX", TagValue::Int(100))]);
        let b = json!({ "x": "slideX" });
        let prev = resolve_geometry(&b, &t, Some(100.0), None, &fermo());
        let next = resolve_geometry(&b, &t, Some(100.0), None, &prev);
        assert_eq!(prev, next, "a tag fermo il risultato deve essere identico, così update_bindings salta");
    }

    /// Il riempimento progressivo delle pipe. La L della demo: due tratti
    /// orizzontali da 140 e uno verticale da 70, totale 350.
    fn elle() -> Vec<(f64, f64)> {
        vec![(650.0, 242.0), (790.0, 242.0), (790.0, 312.0), (930.0, 312.0)]
    }

    fn lunghezza(p: &[(f64, f64)]) -> f64 {
        p.windows(2).map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt()).sum()
    }

    #[test]
    fn a_meta_riempie_meta_della_lunghezza() {
        let p = partial_polyline(&elle(), 0.5, true);
        assert!((lunghezza(&p) - 175.0).abs() < 0.001, "atteso 175, ottenuto {}", lunghezza(&p));
        assert_eq!(p[0], (650.0, 242.0), "deve partire dall'inizio");
        // 175 = 140 del primo tratto + 35 sul verticale
        assert_eq!(*p.last().unwrap(), (790.0, 277.0));
    }

    #[test]
    fn pieno_e_vuoto_sono_i_casi_limite() {
        assert_eq!(partial_polyline(&elle(), 1.0, true), elle(), "pieno = tutta la polilinea");
        assert!(partial_polyline(&elle(), 1.5, true) == elle(), "oltre il pieno resta pieno");
        assert!(partial_polyline(&elle(), 0.0, true).is_empty(), "vuoto = niente da disegnare");
        assert!(partial_polyline(&elle(), -0.3, true).is_empty(), "negativo = vuoto, non un errore");
    }

    #[test]
    fn dalla_fine_riempie_dallaltro_capo() {
        let p = partial_polyline(&elle(), 0.5, false);
        assert!((lunghezza(&p) - 175.0).abs() < 0.001);
        assert_eq!(p[0], (930.0, 312.0), "deve partire dalla fine");
        assert_eq!(*p.last().unwrap(), (790.0, 277.0), "e arrivare allo stesso punto di mezzo");
    }

    /// Una frazione piccolissima non deve produrre una polilinea di un punto
    /// solo: LVGL la disegnerebbe come un puntino isolato, che sembra sporco
    /// sullo schermo e non "quasi vuoto".
    #[test]
    fn una_frazione_minima_da_comunque_un_segmento_o_niente() {
        let p = partial_polyline(&elle(), 0.0001, true);
        assert!(p.is_empty() || p.len() >= 2, "mai un punto solo: {p:?}");
    }

    #[test]
    fn casi_degeneri_non_esplodono() {
        assert!(partial_polyline(&[], 0.5, true).is_empty());
        assert!(partial_polyline(&[(1.0, 1.0)], 0.5, true).is_empty(), "un punto solo non è una linea");
        assert!(
            partial_polyline(&[(5.0, 5.0), (5.0, 5.0)], 0.5, true).is_empty(),
            "waypoint coincidenti: lunghezza zero, niente da riempire"
        );
    }
}
