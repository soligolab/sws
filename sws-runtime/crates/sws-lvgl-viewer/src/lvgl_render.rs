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
use lvgl::widgets::{Bar, Btn, Checkbox, Label, Led, Slider};
use lvgl::{Color, LvError, NativeObject, Part, Widget};
use sws_core::tag::{TagQuality, TagValue};

use crate::client::{TagSnapshot, TagSnapshotValue};
use crate::model::{OnValue, SynopticObject, SynopticPage};

/// Risoluzione fissa a compile-time: `DrawBuffer<const N: usize>` di LVGL
/// richiede una dimensione nota in compilazione, quindi non può dipendere
/// dalla `width`/`height` (runtime) della pagina SWS. Su un target embedded
/// reale la risoluzione è comunque fissa (il pannello ha una dimensione
/// fisica), quindi questo non è un compromesso ad-hoc: le pagine più grandi
/// di questa risoluzione verrebbero semplicemente "tagliate" da LVGL stesso,
/// come accadrebbe su un pannello fisico più piccolo della pagina. Non
/// influisce sul bug Q14 (riprodotto identico anche a 240×240, la
/// risoluzione dell'esempio ufficiale del crate).
pub const HOR_RES: u32 = 800;
pub const VER_RES: u32 = 480;

const SUPPORTED_TYPES: &[&str] =
    &["rect", "ellipse", "text", "button", "led", "slider", "progress_bar", "checkbox", "radio"];

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
    /// con `LV_STATE_CHECKED`.
    Checkbox {
        ptr: core::ptr::NonNull<lvgl_sys::lv_obj_t>,
        tag: Option<String>,
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
    let ctx = unsafe { &*(user_data as *const WidgetChangeCtx) };
    let checked = unsafe { lvgl_sys::lv_obj_has_state(target, lvgl_sys::LV_STATE_CHECKED as lvgl_sys::lv_state_t) };
    let _ = ctx.tx.send(TagCommand { tag: ctx.tag.clone(), value: TagValue::Bool(checked) });
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
    apply_checked_state(ptr, lookup(tags, &obj.tag).map(|t| tag_value_as_bool(&t.value)).unwrap_or(false));

    if let Some(tag) = &obj.tag {
        let ctx = leak_ctx(WidgetChangeCtx { tag: tag.clone(), tx: tx.clone() });
        unsafe {
            lvgl_sys::lv_obj_add_event_cb(
                ptr.as_ptr(),
                Some(sws_checkbox_toggled_cb),
                lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED,
                ctx,
            );
        }
    }
    Ok(LiveBinding { kind: LiveKind::Checkbox { ptr, tag: obj.tag.clone() } })
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

/// Registra un display LVGL `HOR_RES`×`VER_RES` (via `lvgl_display::init_display`,
/// non `lvgl::Display::register()` — vedi commento di modulo) e crea un
/// widget per ogni oggetto supportato della pagina. **Non chiama
/// `task_handler()`**: tocca al chiamante guidare il redraw (loop SDL2 in
/// `main.rs`), ripetutamente per tutta la durata della finestra.
///
/// Ritorna anche gli `Style` statici e i `LiveBinding` (widget tag-dipendenti,
/// con i loro `Style` dinamici): entrambi devono restare vivi quanto la
/// finestra, non solo quanto questa funzione — LVGL tiene puntatori, non
/// copie. Il chiamante passa i `LiveBinding` a `update_bindings` a ogni
/// frame per riflettere i valori tag correnti senza ricreare nulla.
pub fn interpret_page(
    page: &SynopticPage,
    tags: &TagSnapshot,
    tx: &mpsc::Sender<TagCommand>,
) -> anyhow::Result<(RenderSummary, Vec<Style>, Vec<LiveBinding>)> {
    let mut summary = RenderSummary::default();
    let mut styles: Vec<Style> = Vec::new();
    let mut live: Vec<LiveBinding> = Vec::new();

    crate::lvgl_display::init_display(HOR_RES, VER_RES)?;

    // lv_disp_get_scr_act(NULL) = "lo schermo attivo del display di default"
    // — c'è un solo display registrato, quindi è inequivocabile. Stesso
    // pattern raw di create_child_obj: lvgl::Obj::from_raw() su un puntatore
    // ottenuto direttamente da lvgl-sys.
    let mut screen: lvgl::Obj = unsafe {
        let ptr = lvgl_sys::lv_disp_get_scr_act(core::ptr::null_mut());
        let nn = core::ptr::NonNull::new(ptr).ok_or_else(|| anyhow::anyhow!("lv_disp_get_scr_act ha restituito null"))?;
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
            "button" => render_button(&mut screen, obj, &mut styles, tx),
            "text" => render_text(&mut screen, obj, tags).map(|b| live.push(b)),
            "led" => render_led(&mut screen, obj, tags).map(|b| live.push(b)),
            "slider" => render_slider(&mut screen, obj, tags, tx).map(|b| live.push(b)),
            "progress_bar" => render_progress_bar(&mut screen, obj, tags).map(|b| live.push(b)),
            "checkbox" => render_checkbox(&mut screen, obj, tags, tx).map(|b| live.push(b)),
            "radio" => render_radio(&mut screen, obj, tags, tx).map(|b| live.push(b)),
            _ => unreachable!("filtrato da SUPPORTED_TYPES sopra"),
        };
        match result {
            Ok(()) => summary.rendered.push(format!("{id} ({obj_type})")),
            Err(e) => summary.skipped_unsupported.push(format!("{id} ({obj_type}) — errore: {e}")),
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
            LiveKind::Checkbox { ptr, tag } => {
                let checked = lookup(tags, tag).map(|t| tag_value_as_bool(&t.value)).unwrap_or(false);
                apply_checked_state(*ptr, checked);
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
        }
    }
}
