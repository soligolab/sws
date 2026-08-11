//! Interprete `SynopticObject` → widget LVGL, per il sottoinsieme MVP
//! (rect, text, button, led, slider). Equivalente in spirito al dispatcher
//! `SvgObject()` di `sws-editor/src/canvas/SvgCanvas.tsx`, riscritto in
//! Rust/LVGL invece che React/SVG — stessi campi, stessa semantica di
//! resolve/soglie/format dov'è ragionevole portarla (vedi ADR 0002).
//!
//! **Niente redraw/export immagine qui** (arriverebbe naturalmente dopo la
//! creazione dei widget, come un passo in più): un giro di
//! `lvgl::task_handler()` sui widget creati da questo modulo causa oggi un
//! segfault, causato da un bug di lifetime confermato in
//! `lvgl::Display::register()` (crate `lvgl` 0.6.2) — vedi
//! `docs/OPEN_QUESTIONS.md` Q14 per l'analisi completa (backtrace GDB
//! incluso: puntatore dangling in `lv_color_fill`, perché `DisplayDriver`
//! — che possiede il buffer registrato in LVGL — è una variabile locale
//! privata al crate che viene distrutta al ritorno di `register()`/
//! `register_raw()`, entrambi affetti). Questo modulo si ferma quindi
//! subito dopo aver creato con successo i widget, che è già la parte
//! difficile/di valore (l'interprete `SynopticObject` → LVGL): la
//! registrazione del display e il primo redraw restano un TODO bloccato,
//! non implementato qui per non lasciare nel binario un percorso che
//! crasherebbe in modo affidabile ad ogni esecuzione.

use cstr_core::CString;
use lvgl::style::Style;
use lvgl::widgets::{Btn, Label, Led, Slider};
use lvgl::{Color, Display, DrawBuffer, LvError, NativeObject, Part, Widget};
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

const SUPPORTED_TYPES: &[&str] = &["rect", "text", "button", "led", "slider"];

#[derive(Default, Debug)]
pub struct RenderSummary {
    pub rendered: Vec<String>,
    pub skipped_unsupported: Vec<String>,
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

fn render_text(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
    styles: &mut Vec<Style>,
) -> anyhow::Result<()> {
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

    // Porta la precedenza di SvgCanvas.tsx: soglia (se abilitata e valore
    // numerico) → altrimenti colore statico (color/fill) → altrimenti default
    // del tema (nessuno style aggiunto).
    let threshold = if obj.text_color_by_threshold == Some(true) {
        tv.map(|t| tag_value_as_f64(&t.value))
            .and_then(|v| threshold_color(v, obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high))
    } else {
        None
    };
    let static_hex = obj.color.as_deref().or(obj.fill.as_deref());
    let rgb = threshold.or_else(|| static_hex.and_then(parse_hex_color));
    if let Some(rgb) = rgb {
        let mut style = Style::default();
        style.set_text_color(Color::from_rgb(rgb));
        label
            .add_style(Part::Main, &mut style)
            .map_err(|e| anyhow::anyhow!("add_style: {e:?}"))?;
        styles.push(style);
    }
    Ok(())
}

fn render_button(screen: &mut lvgl::Obj, obj: &SynopticObject, styles: &mut Vec<Style>) -> anyhow::Result<()> {
    let mut btn = Btn::create(screen).map_err(|e| anyhow::anyhow!("Btn::create: {e:?}"))?;
    set_pos_size(&mut btn, obj, 120.0, 40.0)?;
    apply_bg_color(&mut btn, obj.fill.as_deref().unwrap_or("#3b82f6"), styles)?;
    let mut lbl = Label::create(&mut btn).map_err(|e| anyhow::anyhow!("Label::create: {e:?}"))?;
    lbl.set_text(&text_cstring(obj.label.as_deref().unwrap_or("Button")))
        .map_err(|e| anyhow::anyhow!("set_text: {e:?}"))?;
    Ok(())
}

fn render_led(
    screen: &mut lvgl::Obj,
    obj: &SynopticObject,
    tags: &TagSnapshot,
    styles: &mut Vec<Style>,
) -> anyhow::Result<()> {
    let mut led = Led::create(screen).map_err(|e| anyhow::anyhow!("Led::create: {e:?}"))?;
    let d = obj.width.unwrap_or(24.0);
    set_pos_size(&mut led, obj, d, d)?;

    let tv = lookup(tags, &obj.tag);
    let on_value = obj.on_value.clone().unwrap_or(OnValue::Bool(true));
    let is_on = match tv {
        None => false,
        Some(t) => match &on_value {
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
        obj.on_color.clone().unwrap_or_else(|| "#22c55e".to_string())
    } else {
        obj.off_color.clone().unwrap_or_else(|| "#334155".to_string())
    };
    apply_bg_color(&mut led, &color_hex, styles)?;
    if tv.is_some() && (is_on || bad_quality) {
        led.on().map_err(|e| anyhow::anyhow!("led on: {e:?}"))?;
    } else {
        led.off().map_err(|e| anyhow::anyhow!("led off: {e:?}"))?;
    }
    Ok(())
}

fn tag_value_as_bool(v: &TagValue) -> bool {
    match v {
        TagValue::Bool(b) => *b,
        TagValue::Int(i) => *i != 0,
        TagValue::Float(f) => *f != 0.0,
        TagValue::Str(s) => !s.trim().is_empty(),
    }
}

fn render_slider(screen: &mut lvgl::Obj, obj: &SynopticObject, tags: &TagSnapshot) -> anyhow::Result<()> {
    let mut slider = Slider::create(screen).map_err(|e| anyhow::anyhow!("Slider::create: {e:?}"))?;
    set_pos_size(&mut slider, obj, 200.0, 50.0)?;

    let min = obj.min.unwrap_or(0.0);
    let max = obj.max.unwrap_or(100.0);
    let raw = lookup(tags, &obj.tag)
        .map(|t| tag_value_as_f64(&t.value))
        .unwrap_or(min)
        .clamp(min.min(max), min.max(max));

    unsafe {
        // lv_slider_t è internamente uno specializzato lv_bar_t in LVGL: non
        // esistono lv_slider_set_range/set_value dedicati, si riusano quelli
        // di bar (confermato dai bindgen bindings reali, non da supposizione).
        let ptr = slider.raw().map_err(|e| anyhow::anyhow!("raw: {e:?}"))?.as_mut() as *mut _;
        lvgl_sys::lv_bar_set_range(ptr, min.round() as i32, max.round() as i32);
        lvgl_sys::lv_bar_set_value(ptr, raw.round() as i32, lvgl::Animation::OFF.into());
    }
    Ok(())
}

/// Registra un display LVGL (necessario anche solo per avere uno `screen`
/// come parent — vedi `create_child_obj`) e crea un widget per ogni oggetto
/// supportato della pagina. **Non chiama `task_handler()`**: vedi il
/// commento di modulo in cima al file per il perché.
pub fn interpret_page(page: &SynopticPage, tags: &TagSnapshot) -> anyhow::Result<RenderSummary> {
    let mut summary = RenderSummary::default();
    let mut styles: Vec<Style> = Vec::new();

    let buffer = DrawBuffer::<{ (HOR_RES * VER_RES) as usize }>::default();
    let display = Display::register(buffer, HOR_RES, VER_RES, |_refresh| {
        // Mai invocata: nessun task_handler() viene chiamato in questo modulo
        // (vedi commento di modulo). Tenuta comunque per completare la
        // registrazione del display, richiesta da get_scr_act()/create().
    })
    .map_err(|e| anyhow::anyhow!("Display::register: {e:?}"))?;

    let mut screen = display
        .get_scr_act()
        .map_err(|e| anyhow::anyhow!("get_scr_act: {e:?}"))?;
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
        let result = match obj_type {
            "rect" => render_rect(&mut screen, obj, &mut styles),
            "text" => render_text(&mut screen, obj, tags, &mut styles),
            "button" => render_button(&mut screen, obj, &mut styles),
            "led" => render_led(&mut screen, obj, tags, &mut styles),
            "slider" => render_slider(&mut screen, obj, tags),
            _ => unreachable!("filtrato da SUPPORTED_TYPES sopra"),
        };
        match result {
            Ok(()) => summary.rendered.push(format!("{id} ({obj_type})")),
            Err(e) => summary.skipped_unsupported.push(format!("{id} ({obj_type}) — errore: {e}")),
        }
    }

    Ok(summary)
}
