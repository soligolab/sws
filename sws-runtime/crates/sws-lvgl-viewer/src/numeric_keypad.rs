//! The numeric keypad of the setpoint on the LVGL panel (19-11-2026, plan
//! `docs/plans/2026-11-19-setpoint-lvgl-come-il-web.md`).
//!
//! It is the web's `NumericKeypad.tsx` drawn with LVGL: a 280 px card in the
//! middle of the screen, over a dark veil, with the label, the number and its
//! unit, «min · max», the error, the 7-8-9 … C ⌫ ✓ grid and «Annulla». The ✓
//! writes in one step, through the confirmation rule of the caller.
//!
//! It lives on the **top layer**. Until this date the setpoint's keyboard was a
//! hidden child of the page created inside `render_setpoint`: every object the
//! page drew after it stayed above it and took the touches (seen on the TY570,
//! a keyboard half covered by the column next to the setpoint). Objects on the
//! top layer survive a change of screen, so the card is closed by `close`
//! whenever a page is loaded.
//!
//! The keys and the confirmation are pure ([`press`], [`validate_draft`]), twins of
//! `sws-editor/src/components/numericKeypadLogic.ts`, and both read the cases in
//! `tests/fixtures/tastierino-numerico.json`.

use std::cell::RefCell;

use crate::lvgl_render::{stile, testo_etichetta, text_cstring};
use crate::testi_sistema::{testo, testo_con, Testo};

// ── The logic ───────────────────────────────────────────────────────────────

/// Why a draft can't be written.
#[derive(Debug, Clone, PartialEq)]
pub enum KeypadError {
    Invalid,
    BelowMin(f64),
    AboveMax(f64),
}

/// A number as JavaScript's `String(n)` writes it, for the usual values: `6`,
/// `6.25`, `-0.5`. The draft and the field must read the same on both engines.
pub fn js_number(v: f64) -> String {
    format!("{v}")
}

/// The draft the keypad opens with: the current value, or empty.
pub fn initial_draft(initial: Option<f64>) -> String {
    match initial {
        Some(v) if v.is_finite() => js_number(v),
        _ => String::new(),
    }
}

/// The draft after pressing `key`. The first digit replaces the preloaded
/// value, as anyone who has used an HMI expects: you press «5» to write 5, not
/// to append it to the current value.
pub fn press(draft: &str, key: &str, initial: Option<f64>) -> String {
    match key {
        "C" => String::new(),
        "⌫" => {
            let mut d = draft.to_string();
            d.pop();
            d
        }
        "±" => match draft.strip_prefix('-') {
            Some(rest) => rest.to_string(),
            None => format!("-{draft}"),
        },
        "." if draft.contains('.') => draft.to_string(),
        _ if draft == initial_draft(initial) => {
            if key == "." {
                "0.".to_string()
            } else {
                key.to_string()
            }
        }
        _ => format!("{draft}{key}"),
    }
}

/// The value to write, or why not. min and max are checked BEFORE confirming.
pub fn validate_draft(draft: &str, min: Option<f64>, max: Option<f64>) -> Result<f64, KeypadError> {
    let t = draft.trim();
    let n = if t.is_empty() {
        None
    } else {
        t.parse::<f64>().ok().filter(|n| n.is_finite())
    };
    let Some(n) = n else {
        return Err(KeypadError::Invalid);
    };
    if let Some(m) = min.filter(|m| n < *m) {
        return Err(KeypadError::BelowMin(m));
    }
    if let Some(m) = max.filter(|m| n > *m) {
        return Err(KeypadError::AboveMax(m));
    }
    Ok(n)
}

/// The error in the content language.
pub fn error_text(e: &KeypadError, lang: &str) -> String {
    match e {
        KeypadError::Invalid => testo(Testo::KeypadInvalid, lang).to_string(),
        KeypadError::BelowMin(m) => {
            testo_con(Testo::KeypadBelowMin, lang, &[("min", &js_number(*m))])
        }
        KeypadError::AboveMax(m) => {
            testo_con(Testo::KeypadAboveMax, lang, &[("max", &js_number(*m))])
        }
    }
}

/// «min 2 · max 10», «min 2», «max 10», or nothing.
pub fn limits_text(min: Option<f64>, max: Option<f64>) -> Option<String> {
    match (min, max) {
        (Some(a), Some(b)) => Some(format!("min {} · max {}", js_number(a), js_number(b))),
        (Some(a), None) => Some(format!("min {}", js_number(a))),
        (None, Some(b)) => Some(format!("max {}", js_number(b))),
        (None, None) => None,
    }
}

// ── The layout ──────────────────────────────────────────────────────────────

/// The web's measures: card 280 wide with padding 18 and a gap of 10 between
/// the parts, keys 52 high (padding 14 and a 20 px text) with a gap of 8.
const CARD_W: i16 = 280;
const PAD: i16 = 18;
const GAP: i16 = 10;
const KEY_GAP: i16 = 8;
const KEY_H: i16 = 52;
const KEY_H_MIN: i16 = 36;
const LABEL_H: i16 = 16;
const DISPLAY_H: i16 = 56;
const LIMITS_H: i16 = 13;
const ERROR_H: i16 = 15;
const CANCEL_H: i16 = 32;

/// Where each part of the card goes, from the top of the card.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Layout {
    pub card_h: i16,
    pub label_y: Option<i16>,
    pub display_y: i16,
    pub limits_y: Option<i16>,
    pub error_y: i16,
    pub keys_y: i16,
    pub key_w: i16,
    pub key_h: i16,
    pub cancel_y: i16,
}

/// The card for a screen `screen_h` high. The row of the error is always
/// there, empty until there is one, so the keys don't jump under the finger.
/// On a low screen the keys get shorter, down to 36 px.
pub fn layout(screen_h: i16, has_label: bool, has_limits: bool) -> Layout {
    let inner_w = CARD_W - 2 * PAD;
    let key_w = (inner_w - 2 * KEY_GAP) / 3;
    let fixed = 2 * PAD
        + if has_label { LABEL_H + GAP } else { 0 }
        + DISPLAY_H
        + GAP
        + if has_limits { LIMITS_H + GAP } else { 0 }
        + ERROR_H
        + GAP
        + 4 * KEY_GAP
        + GAP
        + CANCEL_H;
    let room = (screen_h - 16 - fixed) / 5;
    let key_h = room.clamp(KEY_H_MIN, KEY_H);
    let mut y = PAD;
    let label_y = has_label.then(|| {
        let at = y;
        y += LABEL_H + GAP;
        at
    });
    let display_y = y;
    y += DISPLAY_H + GAP;
    let limits_y = has_limits.then(|| {
        let at = y;
        y += LIMITS_H + GAP;
        at
    });
    let error_y = y;
    y += ERROR_H + GAP;
    let keys_y = y;
    y += 5 * key_h + 4 * KEY_GAP + GAP;
    let cancel_y = y;
    y += CANCEL_H + PAD;
    Layout {
        card_h: y,
        label_y,
        display_y,
        limits_y,
        error_y,
        keys_y,
        key_w,
        key_h,
        cancel_y,
    }
}

// ── The card ────────────────────────────────────────────────────────────────

/// What the caller gives to open the keypad.
pub struct Request {
    pub label: Option<String>,
    pub unit: Option<String>,
    pub initial: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub confirm_fill: (u8, u8, u8),
    pub lang: String,
    /// Called with the value after a valid ✓, once the card is closed.
    pub on_confirm: Box<dyn FnOnce(f64)>,
}

const KEYS: [&str; 15] = [
    "7", "8", "9", "4", "5", "6", "1", "2", "3", "±", "0", ".", "C", "⌫", "✓",
];
const CANCEL: usize = KEYS.len();

const BG: (u8, u8, u8) = (0x0f, 0x17, 0x2a);
const SURFACE: (u8, u8, u8) = (0x1e, 0x29, 0x3b);
const SURFACE_2: (u8, u8, u8) = (0x33, 0x41, 0x55);
const TEXT: (u8, u8, u8) = (0xe2, 0xe8, 0xf0);
const MUTED: (u8, u8, u8) = (0x94, 0xa3, 0xb8);
const SUBTLE: (u8, u8, u8) = (0x64, 0x74, 0x8b);
const DANGER: (u8, u8, u8) = (0xef, 0x44, 0x44);
const DANGER_SOFT: (u8, u8, u8) = (0xfc, 0xa5, 0xa5);

type P = *mut lvgl_sys::lv_obj_t;

struct Card {
    veil: P,
    display: P,
    value: P,
    unit: Option<P>,
    error: P,
    draft: String,
    initial: Option<f64>,
    min: Option<f64>,
    max: Option<f64>,
    lang: String,
    on_confirm: Option<Box<dyn FnOnce(f64)>>,
}

thread_local! {
    /// The open card, if any: one at a time, like the web's.
    static OPEN: RefCell<Option<Card>> = const { RefCell::new(None) };
}

/// Closes the open keypad without writing. Called when a page is loaded:
/// the top layer outlives the screen.
pub fn close() {
    if let Some(card) = OPEN.with(|o| o.borrow_mut().take()) {
        unsafe { lvgl_sys::lv_obj_del_async(card.veil) };
    }
}

/// Opens the keypad, closing one that was open.
pub fn open(req: Request) {
    close();
    unsafe {
        let top = lvgl_sys::lv_disp_get_layer_top(core::ptr::null_mut());
        let sw = lvgl_sys::lv_disp_get_hor_res(core::ptr::null_mut());
        let sh = lvgl_sys::lv_disp_get_ver_res(core::ptr::null_mut());
        let limits = limits_text(req.min, req.max);
        let l = layout(sh, req.label.is_some(), limits.is_some());

        let veil = plain(lvgl_sys::lv_obj_create(top));
        if veil.is_null() {
            return;
        }
        lvgl_sys::lv_obj_set_pos(veil, 0, 0);
        lvgl_sys::lv_obj_set_size(veil, sw, sh);
        lvgl_sys::lv_obj_set_style_bg_color(
            veil,
            lvgl::Color::from_rgb((0, 0, 0)).into(),
            stile::MAIN,
        );
        // rgba(0,0,0,0.65), the web's veil.
        lvgl_sys::lv_obj_set_style_bg_opa(veil, 166, stile::MAIN);
        lvgl_sys::lv_obj_add_flag(veil, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
        // A touch outside the card cancels, as on the web. Touches on the card
        // don't bubble up to here.
        lvgl_sys::lv_obj_add_event_cb(
            veil,
            Some(sws_keypad_key_cb),
            lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
            (CANCEL + 1) as *mut core::ffi::c_void,
        );

        let card = plain(lvgl_sys::lv_obj_create(veil));
        lvgl_sys::lv_obj_set_size(card, CARD_W, l.card_h);
        lvgl_sys::lv_obj_align(
            card,
            lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t,
            0,
            0,
        );
        stile::sfondo(card, BG, stile::MAIN);
        stile::bordo(card, Some(SURFACE_2), 1.0, stile::MAIN);
        stile::raggio(card, 12.0, stile::MAIN);
        // Clickable, so a touch on the card's padding doesn't reach the veil.
        lvgl_sys::lv_obj_add_flag(card, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
        let inner_w = CARD_W - 2 * PAD;

        if let (Some(y), Some(label)) = (l.label_y, req.label.as_deref()) {
            let t = text(card, label, MUTED, 13, true);
            lvgl_sys::lv_obj_set_pos(t, PAD, y);
            lvgl_sys::lv_obj_set_width(t, inner_w);
        }

        let display = plain(lvgl_sys::lv_obj_create(card));
        lvgl_sys::lv_obj_set_pos(display, PAD, l.display_y);
        lvgl_sys::lv_obj_set_size(display, inner_w, DISPLAY_H);
        stile::sfondo(display, SURFACE, stile::MAIN);
        stile::bordo(display, Some(SURFACE_2), 1.0, stile::MAIN);
        stile::raggio(display, 8.0, stile::MAIN);
        let unit = req
            .unit
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .map(|u| text(display, u, SUBTLE, 14, false));
        let value = text(display, "", TEXT, 26, false);

        if let (Some(y), Some(limits)) = (l.limits_y, limits.as_deref()) {
            let t = text(card, limits, SUBTLE, 11, false);
            lvgl_sys::lv_obj_set_width(t, inner_w);
            lvgl_sys::lv_obj_set_style_text_align(
                t,
                lvgl_sys::LV_TEXT_ALIGN_RIGHT as lvgl_sys::lv_text_align_t,
                stile::MAIN,
            );
            lvgl_sys::lv_obj_set_pos(t, PAD, y);
        }
        let error = text(card, "", DANGER_SOFT, 12, false);
        lvgl_sys::lv_obj_set_pos(error, PAD, l.error_y);
        lvgl_sys::lv_obj_set_width(error, inner_w);

        for (i, k) in KEYS.iter().enumerate() {
            let (row, col) = ((i / 3) as i16, (i % 3) as i16);
            let fill = if *k == "✓" {
                req.confirm_fill
            } else {
                SURFACE
            };
            let colour = if *k == "✓" {
                (0xff, 0xff, 0xff)
            } else {
                TEXT
            };
            let px = if matches!(*k, "C" | "⌫") { 15 } else { 20 };
            let b = key(card, k, fill, colour, px, *k != "✓");
            lvgl_sys::lv_obj_set_pos(
                b,
                PAD + col * (l.key_w + KEY_GAP),
                l.keys_y + row * (l.key_h + KEY_GAP),
            );
            lvgl_sys::lv_obj_set_size(b, l.key_w, l.key_h);
            lvgl_sys::lv_obj_add_event_cb(
                b,
                Some(sws_keypad_key_cb),
                lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
                (i + 1) as *mut core::ffi::c_void,
            );
        }
        let cancel = key(
            card,
            testo(Testo::Annulla, &req.lang),
            SURFACE,
            SUBTLE,
            13,
            true,
        );
        stile::trasparente(cancel, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(cancel, PAD, l.cancel_y);
        lvgl_sys::lv_obj_set_size(cancel, inner_w, CANCEL_H);
        lvgl_sys::lv_obj_add_event_cb(
            cancel,
            Some(sws_keypad_key_cb),
            lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
            (CANCEL + 1) as *mut core::ffi::c_void,
        );

        let card_state = Card {
            veil,
            display,
            value,
            unit,
            error,
            draft: initial_draft(req.initial),
            initial: req.initial,
            min: req.min,
            max: req.max,
            lang: req.lang,
            on_confirm: Some(req.on_confirm),
        };
        card_state.show(None);
        OPEN.with(|o| *o.borrow_mut() = Some(card_state));
    }
}

impl Card {
    /// Writes the draft («—» when empty) and the error, if any.
    unsafe fn show(&self, error: Option<&str>) {
        let shown = if self.draft.is_empty() {
            "—"
        } else {
            self.draft.as_str()
        };
        testo_etichetta(self.value, text_cstring(shown).as_ptr());
        testo_etichetta(self.error, text_cstring(error.unwrap_or("")).as_ptr());
        stile::bordo(
            self.display,
            Some(if error.is_some() { DANGER } else { SURFACE_2 }),
            1.0,
            stile::MAIN,
        );
        // Number and unit on the right, the unit after the number, both on the
        // same bottom line: the web's `textAlign: right` with a smaller unit.
        let right = lvgl_sys::LV_ALIGN_RIGHT_MID as lvgl_sys::lv_align_t;
        match self.unit {
            Some(u) => {
                lvgl_sys::lv_obj_align(u, right, -12, 4);
                lvgl_sys::lv_obj_update_layout(u);
                lvgl_sys::lv_obj_update_layout(self.value);
                lvgl_sys::lv_obj_align_to(
                    self.value,
                    u,
                    lvgl_sys::LV_ALIGN_OUT_LEFT_BOTTOM as lvgl_sys::lv_align_t,
                    -5,
                    2,
                );
            }
            None => lvgl_sys::lv_obj_align(self.value, right, -12, 0),
        }
    }
}

/// A key, the cancel button or a touch on the veil (`user_data` = index + 1).
unsafe extern "C" fn sws_keypad_key_cb(e: *mut lvgl_sys::lv_event_t) {
    let i = lvgl_sys::lv_event_get_user_data(e) as usize;
    if i == 0 {
        return;
    }
    let i = i - 1;
    if i == CANCEL {
        // A touch on the veil arrives here only when it is the veil's own: a
        // touch on the card stops at the card.
        if lvgl_sys::lv_event_get_target(e) != lvgl_sys::lv_event_get_current_target(e) {
            return;
        }
        close();
        return;
    }
    let Some(k) = KEYS.get(i) else {
        return;
    };
    if *k == "✓" {
        let ok = OPEN.with(|o| {
            let mut o = o.borrow_mut();
            let card = o.as_mut()?;
            match validate_draft(&card.draft, card.min, card.max) {
                Ok(v) => Some(Ok((v, card.on_confirm.take()))),
                Err(err) => {
                    card.show(Some(&error_text(&err, &card.lang)));
                    Some(Err(()))
                }
            }
        });
        if let Some(Ok((v, Some(f)))) = ok {
            // Closed first, then the write: a confirmation window or the
            // password of a critical command opens over the page, not under
            // a keypad that is going away.
            close();
            f(v);
        }
        return;
    }
    OPEN.with(|o| {
        if let Some(card) = o.borrow_mut().as_mut() {
            card.draft = press(&card.draft, k, card.initial);
            card.show(None);
        }
    });
}

/// An `lv_obj` with the theme's styles removed and no scrolling: the theme
/// paints a white card with padding, which is not what the web draws.
unsafe fn plain(p: P) -> P {
    if !p.is_null() {
        lvgl_sys::lv_obj_remove_style(
            p,
            core::ptr::null_mut(),
            (lvgl_sys::LV_PART_ANY | lvgl_sys::LV_STATE_ANY) as lvgl_sys::lv_style_selector_t,
        );
        lvgl_sys::lv_obj_clear_flag(p, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
    }
    p
}

unsafe fn text(parent: P, s: &str, colour: (u8, u8, u8), px: u16, bold: bool) -> P {
    let l = lvgl_sys::lv_label_create(parent);
    testo_etichetta(l, text_cstring(s).as_ptr());
    stile::testo(l, colour, stile::MAIN);
    if bold {
        stile::font_grassetto(l, px, stile::MAIN);
    } else {
        stile::font(l, px, stile::MAIN);
    }
    l
}

/// A key like the web's: radius 8, a 1 px border, the text in the middle;
/// none of the LVGL theme (no shadow, no pill, no growing when pressed).
unsafe fn key(
    parent: P,
    s: &str,
    fill: (u8, u8, u8),
    colour: (u8, u8, u8),
    px: u16,
    border: bool,
) -> P {
    let b = plain(lvgl_sys::lv_btn_create(parent));
    stile::sfondo(b, fill, stile::MAIN);
    stile::bordo(b, border.then_some(SURFACE_2), 1.0, stile::MAIN);
    stile::raggio(b, 8.0, stile::MAIN);
    // The press is seen: a touch screen gives no other feedback.
    lvgl_sys::lv_obj_set_style_bg_opa(b, 170, lvgl_sys::LV_STATE_PRESSED);
    let t = text(b, s, colour, px, px >= 20);
    lvgl_sys::lv_obj_align(t, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
    b
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fixture() -> Value {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/tastierino-numerico.json"
        );
        let text = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("the shared cases are missing ({path}): {e}"));
        serde_json::from_str(&text).expect("invalid shared cases")
    }

    #[test]
    fn the_keys_shared_with_the_web() {
        let f = fixture();
        for c in f["tasti"].as_array().unwrap() {
            let initial = c["iniziale"].as_f64();
            let mut draft = initial_draft(initial);
            for k in c["tasti"].as_array().unwrap() {
                draft = press(&draft, k.as_str().unwrap(), initial);
            }
            assert_eq!(draft, c["atteso"].as_str().unwrap(), "{}", c["nome"]);
        }
    }

    #[test]
    fn the_confirmations_shared_with_the_web() {
        let f = fixture();
        for c in f["conferme"].as_array().unwrap() {
            let got = validate_draft(
                c["bozza"].as_str().unwrap(),
                c["min"].as_f64(),
                c["max"].as_f64(),
            );
            match c["atteso"]["errore"].as_str() {
                Some("invalid") => assert_eq!(got, Err(KeypadError::Invalid), "{}", c["nome"]),
                Some("below_min") => assert!(
                    matches!(got, Err(KeypadError::BelowMin(_))),
                    "{}",
                    c["nome"]
                ),
                Some("above_max") => assert!(
                    matches!(got, Err(KeypadError::AboveMax(_))),
                    "{}",
                    c["nome"]
                ),
                _ => assert_eq!(
                    got,
                    Ok(c["atteso"]["valore"].as_f64().unwrap()),
                    "{}",
                    c["nome"]
                ),
            }
        }
    }

    #[test]
    fn the_messages_carry_the_limit() {
        assert_eq!(
            error_text(&KeypadError::BelowMin(2.5), "it"),
            "Sotto il minimo (2.5)"
        );
        assert_eq!(
            error_text(&KeypadError::AboveMax(10.0), "en"),
            "Above the maximum (10)"
        );
        assert_eq!(
            limits_text(Some(2.0), Some(10.0)).as_deref(),
            Some("min 2 · max 10")
        );
        assert_eq!(limits_text(None, None), None);
    }

    #[test]
    fn the_card_fits_the_screens_of_the_panels() {
        // 600 (TY570, WP630), 480 (small panels), 800 (TC620 rotated).
        for h in [480, 600, 800] {
            let l = layout(h, true, true);
            assert!(l.card_h <= h, "{h}: the card is {} high", l.card_h);
            assert!(l.key_h >= KEY_H_MIN);
        }
        assert_eq!(
            layout(600, true, true).key_h,
            KEY_H,
            "on a 600 px screen the keys are the web's"
        );
        let l = layout(600, false, false);
        assert!(l.label_y.is_none() && l.limits_y.is_none());
        assert_eq!(l.display_y, PAD);
    }
}
