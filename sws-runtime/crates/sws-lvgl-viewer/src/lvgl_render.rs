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
use lvgl::style::Style;
use lvgl::widgets::{Bar, Btn, Chart, Checkbox, Label, Led, Line, Meter, Slider, Table};
use lvgl::{Color, LvError, NativeObject, Part, Widget};
use sws_core::tag::{TagQuality, TagValue};

use crate::client::{self, AlarmStateLite, HistorySample, SharedAlarms, SharedHistory, TagSnapshot, TagSnapshotValue};
use crate::model::{OnValue, SynopticObject, SynopticPage, TableRow, TextListEntry};

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
pub enum LiveKind {
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
    let mut value_label = Label::create(&mut meter).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    let w = obj.width.unwrap_or(160.0).round() as i16;
    let h = obj.height.unwrap_or(140.0).round() as i16;
    value_label
        .set_pos(w / 2 - 20, (h as f64 * 0.72) as i16)
        .map_err(|e| anyhow::anyhow!("set_pos: {e:?}"))?;
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

    let mut tag_list: Vec<String> = Vec::new();
    if let Some(t) = obj.tag.as_deref() {
        if !t.is_empty() {
            tag_list.push(t.to_string());
        }
    }
    if let Some(extra) = &obj.extra_tags {
        tag_list.extend(extra.iter().filter(|t| !t.is_empty()).cloned());
    }

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
    let mut series = Vec::with_capacity(tag_list.len());
    for (i, tag) in tag_list.iter().enumerate() {
        let rgb = trend_series_color(i, obj);
        let ser = unsafe {
            lvgl_sys::lv_chart_add_series(
                ptr.as_ptr(),
                Color::from_rgb(rgb).into(),
                lvgl_sys::LV_CHART_AXIS_PRIMARY_Y as lvgl_sys::lv_chart_axis_t,
            )
        };
        let shared = client::spawn_history_poller(rt_handle, base_url.to_string(), tag.clone(), window_s, backfill);
        series.push(TrendSeriesBinding { ser, shared, last_seen_version: 0, last_samples: Vec::new() });
    }

    Ok(LiveBinding { kind: LiveKind::Trend { ptr, series, window_s, autofit } })
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

/// Prima pagina di una sessione: registra il display LVGL alla risoluzione
/// di questa pagina (`resolve_resolution` — vedi commento su `HOR_RES`) e
/// delega a `render_page_objects` per la creazione dei widget. Ritorna anche
/// `hor_res`/`ver_res` risolti: il chiamante li usa per dimensionare la
/// finestra SDL2 (`main.rs`), che deve combaciare con quanto passato a
/// `init_display`.
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
) -> anyhow::Result<(RenderSummary, Vec<Style>, Vec<LiveBinding>, u32, u32)> {
    let (hor_res, ver_res) = resolve_resolution(page);
    crate::lvgl_display::init_display(hor_res, ver_res)?;
    let (summary, styles, live) =
        render_page_objects(page, tags, tag_tx, nav_tx, base_url, rt_handle, shared_alarms, ack_tx)?;
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
    if let Some(bg) = &page.background {
        apply_bg_color(&mut screen, bg, &mut styles)?;
    }

    for obj in &page.objects {
        let (Some(id), Some(obj_type)) = (obj.id.as_deref(), obj.obj_type.as_deref()) else {
            continue; // oggetto senza id/type: dato malformato, ignorato silenziosamente
        };
        if !is_visible(obj, tags) {
            continue;
        }
        if !SUPPORTED_TYPES.contains(&obj_type) {
            summary.skipped_unsupported.push(format!("{id} ({obj_type})"));
            continue;
        }
        let result: anyhow::Result<()> = match obj_type {
            "rect" => render_rect(&mut screen, obj, &mut styles),
            "ellipse" => render_ellipse(&mut screen, obj, &mut styles),
            "line" => render_line(&mut screen, obj, &mut styles),
            "button" => render_button(&mut screen, obj, &mut styles, tag_tx),
            "navbutton" => render_navbutton(&mut screen, obj, &mut styles, nav_tx),
            "text" => render_text(&mut screen, obj, tags).map(|b| live.push(b)),
            "led" => render_led(&mut screen, obj, tags).map(|b| live.push(b)),
            "slider" => render_slider(&mut screen, obj, tags, tag_tx).map(|b| live.push(b)),
            "progress_bar" => render_progress_bar(&mut screen, obj, tags).map(|b| live.push(b)),
            "checkbox" => render_checkbox(&mut screen, obj, tags, tag_tx).map(|b| live.push(b)),
            "radio" => render_radio(&mut screen, obj, tags, tag_tx).map(|b| live.push(b)),
            "gauge" => render_gauge(&mut screen, obj, tags).map(|b| live.push(b)),
            "state_lamp" => render_state_lamp(&mut screen, obj, tags).map(|b| live.push(b)),
            "table" => render_table(&mut screen, obj, tags).map(|b| live.push(b)),
            "trend" => render_trend(&mut screen, obj, base_url, rt_handle).map(|b| live.push(b)),
            "alarm_viewer" => {
                render_alarm_viewer(&mut screen, obj, &mut styles, shared_alarms, ack_tx).map(|b| live.push(b))
            }
            _ => unreachable!("filtrato da SUPPORTED_TYPES sopra"),
        };
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
pub fn update_bindings(bindings: &mut [LiveBinding], tags: &TagSnapshot) {
    for b in bindings {
        match &mut b.kind {
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
