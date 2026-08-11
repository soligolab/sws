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

use std::sync::mpsc;

use cstr_core::CString;
use lvgl::style::Style;
use lvgl::widgets::{Bar, Btn, Checkbox, Label, Led, Line, Meter, Slider, Table};
use lvgl::{Color, LvError, NativeObject, Part, Widget};
use sws_core::tag::{TagQuality, TagValue};

use crate::client::{TagSnapshot, TagSnapshotValue};
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
    "state_lamp", "table", "navbutton",
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
    set_pos_size(&mut slider, obj, 200.0, 50.0)?;
    let ptr = slider.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?;
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
    set_pos_size(&mut meter, obj, 160.0, 140.0)?;
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

/// Prima pagina di una sessione: registra il display LVGL alla risoluzione
/// di questa pagina (`resolve_resolution` — vedi commento su `HOR_RES`) e
/// delega a `render_page_objects` per la creazione dei widget. Ritorna anche
/// `hor_res`/`ver_res` risolti: il chiamante li usa per dimensionare la
/// finestra SDL2 (`main.rs`), che deve combaciare con quanto passato a
/// `init_display`.
pub fn interpret_page(
    page: &SynopticPage,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
) -> anyhow::Result<(RenderSummary, Vec<Style>, Vec<LiveBinding>, u32, u32)> {
    let (hor_res, ver_res) = resolve_resolution(page);
    crate::lvgl_display::init_display(hor_res, ver_res)?;
    let (summary, styles, live) = render_page_objects(page, tags, tag_tx, nav_tx)?;
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
pub fn render_page_objects(
    page: &SynopticPage,
    tags: &TagSnapshot,
    tag_tx: &mpsc::Sender<TagCommand>,
    nav_tx: &mpsc::Sender<String>,
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
        }
    }
}
