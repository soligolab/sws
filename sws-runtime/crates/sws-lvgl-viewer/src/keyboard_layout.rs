//! The two layouts of the text keyboard (plan
//! `docs/plans/2026-11-19-tastiera-a-5-righe.md`).
//!
//! LVGL's keyboard puts 12 keys in its first row. On the TY570 turned to
//! portrait (600 px wide) a key came out about 45 px wide and over 120 px tall:
//! «difficilissimi da usare» (the maintainer, 19-11-2026). The alphabetic
//! layout has five rows of seven. A key on the keyboard switches between the
//! two («A-Z» and «QWE»), and the panel remembers the choice.
//!
//! The maps are data here, so the tests can check them; `install` turns them
//! into LVGL's tables. `lv_keyboard_set_map` writes a table shared by every
//! keyboard: only one is open at a time, and the next one opens with the
//! layout chosen last.

use std::ffi::{c_char, CStr, CString};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    /// LVGL's own, with the «A-Z» key in the last row.
    Standard,
    /// Five rows of seven, letters in alphabetical order, with «QWE».
    Alphabetic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Lower,
    Upper,
    Special,
}

const MODES: [Mode; 3] = [Mode::Lower, Mode::Upper, Mode::Special];

/// The label of the key that switches to the other layout.
const TO_ALPHABETIC: &str = "A-Z";
const TO_STANDARD: &str = "QWE";

// The button-matrix flags, as LVGL's keyboard uses them.
const POPOVER: u16 = lvgl_sys::LV_BTNMATRIX_CTRL_POPOVER as u16;
const CHECKED: u16 = lvgl_sys::LV_BTNMATRIX_CTRL_CHECKED as u16;
const FLAGS: u16 = (lvgl_sys::LV_BTNMATRIX_CTRL_NO_REPEAT
    | lvgl_sys::LV_BTNMATRIX_CTRL_CLICK_TRIG
    | lvgl_sys::LV_BTNMATRIX_CTRL_CHECKED) as u16;

fn sym(b: &'static [u8]) -> &'static str {
    std::str::from_utf8(&b[..b.len() - 1]).unwrap_or("?")
}

/// A key: its label and its control word (flags and width 1..7).
type Key = (&'static str, u16);

fn letters(chars: &'static str) -> Vec<Key> {
    // Every letter of these strings is one byte: `chars` is ASCII.
    (0..chars.len())
        .map(|i| (&chars[i..i + 1], POPOVER | 1))
        .collect()
}

fn rows(layout: Layout, mode: Mode) -> Vec<Vec<Key>> {
    let (kbd, ok, bs) = (
        sym(lvgl_sys::LV_SYMBOL_KEYBOARD),
        sym(lvgl_sys::LV_SYMBOL_OK),
        sym(lvgl_sys::LV_SYMBOL_BACKSPACE),
    );
    match layout {
        Layout::Standard => {
            let (left, right, nl) = (
                sym(lvgl_sys::LV_SYMBOL_LEFT),
                sym(lvgl_sys::LV_SYMBOL_RIGHT),
                sym(lvgl_sys::LV_SYMBOL_NEW_LINE),
            );
            // LVGL's last row, with «A-Z» taking two units from the space bar.
            let last = vec![
                (kbd, FLAGS | 2),
                (TO_ALPHABETIC, FLAGS | 2),
                (left, CHECKED | 2),
                (" ", 4),
                (right, CHECKED | 2),
                (ok, FLAGS | 2),
            ];
            let wide = |s: &'static str, w: u16| {
                letters(s).into_iter().map(move |(l, _)| (l, POPOVER | w))
            };
            match mode {
                Mode::Lower | Mode::Upper => {
                    let up = mode == Mode::Upper;
                    let (r1, r2, r3) = if up {
                        ("QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM")
                    } else {
                        ("qwertyuiop", "asdfghjkl", "zxcvbnm")
                    };
                    let mut a = vec![("1#", FLAGS | 5)];
                    a.extend(wide(r1, 4));
                    a.push((bs, CHECKED | 7));
                    let mut b = vec![(if up { "abc" } else { "ABC" }, FLAGS | 6)];
                    b.extend(wide(r2, 3));
                    b.push((nl, CHECKED | 7));
                    let mut c = vec![("_", CHECKED | POPOVER | 1), ("-", CHECKED | POPOVER | 1)];
                    c.extend(wide(r3, 1));
                    c.extend([
                        (".", CHECKED | POPOVER | 1),
                        (",", CHECKED | POPOVER | 1),
                        (":", CHECKED | POPOVER | 1),
                    ]);
                    vec![a, b, c, last]
                }
                Mode::Special => {
                    let mut a = letters("1234567890");
                    a.push((bs, CHECKED | 2));
                    let mut b = vec![("abc", FLAGS | 2)];
                    b.extend(letters("+-/*=%!?#<>"));
                    let c = letters("\\@$(){}[];\"'");
                    vec![a, b, c, last]
                }
            }
        }
        Layout::Alphabetic => {
            let (r1, r2, r3, r4, shift) = match mode {
                Mode::Lower => ("abcdefg", "hijklmn", "opqrstu", "vwxyz.-", Some("ABC")),
                Mode::Upper => ("ABCDEFG", "HIJKLMN", "OPQRSTU", "VWXYZ.-", Some("abc")),
                Mode::Special => ("1234567", "890+-*/", "=%!?#@_", "()[]:;,", None),
            };
            let mut last = match shift {
                Some(s) => vec![("1#", FLAGS | 1), (s, FLAGS | 1)],
                None => vec![("abc", FLAGS | 2)],
            };
            last.extend([
                (TO_STANDARD, FLAGS | 1),
                (kbd, FLAGS | 1),
                (" ", 2),
                (bs, CHECKED | 1),
                (ok, FLAGS | 1),
            ]);
            vec![letters(r1), letters(r2), letters(r3), letters(r4), last]
        }
    }
}

/// The layout a key switches to, if it is one of the two switch keys.
fn switch_for(label: &[u8]) -> Option<Layout> {
    match label {
        l if l == TO_ALPHABETIC.as_bytes() => Some(Layout::Alphabetic),
        l if l == TO_STANDARD.as_bytes() => Some(Layout::Standard),
        _ => None,
    }
}

fn parse_saved(s: &str) -> Layout {
    if s.trim() == "alphabetic" {
        Layout::Alphabetic
    } else {
        Layout::Standard
    }
}

fn file() -> Option<std::path::PathBuf> {
    Some(crate::cartella_stato()?.join("lvgl_keyboard"))
}

/// 0 = not read yet, 1 = standard, 2 = alphabetic.
static CURRENT: AtomicU8 = AtomicU8::new(0);

fn current() -> Layout {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Layout::Standard,
        2 => Layout::Alphabetic,
        _ => {
            let l = file()
                .and_then(|p| std::fs::read_to_string(p).ok())
                .map(|s| parse_saved(&s))
                .unwrap_or(Layout::Standard);
            remember(l);
            l
        }
    }
}

fn remember(l: Layout) {
    CURRENT.store(
        if l == Layout::Alphabetic { 2 } else { 1 },
        Ordering::Relaxed,
    );
}

/// Best effort, like the language: a panel with a read-only home keeps the
/// choice until the viewer restarts.
fn save(l: Layout) {
    let Some(p) = file() else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let s = if l == Layout::Alphabetic {
        "alphabetic"
    } else {
        "standard"
    };
    if let Err(e) = std::fs::write(&p, s) {
        eprintln!("[keyboard] cannot save the layout in {}: {e}", p.display());
    }
}

/// One mode's map as LVGL wants it: the labels with "\n" between rows and ""
/// at the end, and one control word per key. Built once and kept for the
/// whole run: LVGL holds the pointers.
struct LvglMap {
    labels: Vec<*const c_char>,
    ctrl: Vec<u16>,
}

// The pointers point into leaked, never-written strings, and LVGL is only
// touched from the UI thread.
unsafe impl Send for LvglMap {}
unsafe impl Sync for LvglMap {}

fn build(layout: Layout, mode: Mode) -> LvglMap {
    let leak = |s: &str| -> *const c_char {
        Box::leak(CString::new(s).unwrap_or_default().into_boxed_c_str()).as_ptr()
    };
    let mut labels = Vec::new();
    let mut ctrl = Vec::new();
    for (i, row) in rows(layout, mode).into_iter().enumerate() {
        if i > 0 {
            labels.push(leak("\n"));
        }
        for (l, c) in row {
            labels.push(leak(l));
            ctrl.push(c);
        }
    }
    labels.push(leak(""));
    LvglMap { labels, ctrl }
}

fn maps(layout: Layout) -> &'static [LvglMap; 3] {
    static STANDARD: OnceLock<[LvglMap; 3]> = OnceLock::new();
    static ALPHABETIC: OnceLock<[LvglMap; 3]> = OnceLock::new();
    let cell = if layout == Layout::Alphabetic {
        &ALPHABETIC
    } else {
        &STANDARD
    };
    cell.get_or_init(|| MODES.map(|m| build(layout, m)))
}

fn lvgl_mode(m: Mode) -> lvgl_sys::lv_keyboard_mode_t {
    (match m {
        Mode::Lower => lvgl_sys::LV_KEYBOARD_MODE_TEXT_LOWER,
        Mode::Upper => lvgl_sys::LV_KEYBOARD_MODE_TEXT_UPPER,
        Mode::Special => lvgl_sys::LV_KEYBOARD_MODE_SPECIAL,
    }) as lvgl_sys::lv_keyboard_mode_t
}

/// Writes the layout's maps into LVGL's table; `kb` redraws in its mode.
unsafe fn apply(kb: *mut lvgl_sys::lv_obj_t, layout: Layout) {
    for (m, map) in MODES.iter().zip(maps(layout).iter()) {
        lvgl_sys::lv_keyboard_set_map(
            kb,
            lvgl_mode(*m),
            map.labels.as_ptr() as *mut *const c_char,
            map.ctrl.as_ptr(),
        );
    }
}

/// LVGL's keyboard handler, with the two switch keys taken first.
unsafe extern "C" fn keyboard_cb(e: *mut lvgl_sys::lv_event_t) {
    let kb = lvgl_sys::lv_event_get_target(e);
    let id = lvgl_sys::lv_btnmatrix_get_selected_btn(kb);
    if u32::from(id) != lvgl_sys::LV_BTNMATRIX_BTN_NONE {
        let txt = lvgl_sys::lv_btnmatrix_get_btn_text(kb, id);
        if !txt.is_null() {
            if let Some(next) = switch_for(CStr::from_ptr(txt).to_bytes()) {
                remember(next);
                save(next);
                apply(kb, next);
                return;
            }
        }
    }
    lvgl_sys::lv_keyboard_def_event_cb(e);
}

/// Puts the chosen layout and the switch keys on a keyboard just created.
/// Every text keyboard must go through here: on one that doesn't, «A-Z»
/// would be typed into the field.
pub unsafe fn install(kb: *mut lvgl_sys::lv_obj_t) {
    lvgl_sys::lv_obj_remove_event_cb(kb, Some(lvgl_sys::lv_keyboard_def_event_cb));
    lvgl_sys::lv_obj_add_event_cb(
        kb,
        Some(keyboard_cb),
        lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED,
        core::ptr::null_mut(),
    );
    apply(kb, current());
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAYOUTS: [Layout; 2] = [Layout::Standard, Layout::Alphabetic];

    #[test]
    fn every_map_has_one_control_word_per_key_and_a_width() {
        for l in LAYOUTS {
            for m in MODES {
                for row in rows(l, m) {
                    assert!(!row.is_empty());
                    for (label, c) in row {
                        assert!(
                            !label.is_empty() && !label.contains('\n'),
                            "{l:?} {m:?}: «{label}»"
                        );
                        assert!(
                            (1..=7).contains(&(c & 7)),
                            "{l:?} {m:?} «{label}»: width {}",
                            c & 7
                        );
                    }
                }
                let built = build(l, m);
                assert_eq!(
                    built.labels.len(),
                    built.ctrl.len() + rows(l, m).len(),
                    "{l:?} {m:?}"
                );
            }
        }
    }

    #[test]
    fn the_alphabetic_layout_has_five_rows_of_at_most_seven_keys() {
        for m in MODES {
            let r = rows(Layout::Alphabetic, m);
            assert_eq!(r.len(), 5, "{m:?}");
            for row in &r {
                assert!(row.len() <= 7, "{m:?}: {} keys", row.len());
            }
        }
        let first: Vec<_> = rows(Layout::Alphabetic, Mode::Lower)
            .concat()
            .iter()
            .map(|k| k.0)
            .collect();
        assert_eq!(&first[..7], ["a", "b", "c", "d", "e", "f", "g"]);
    }

    #[test]
    fn every_letter_once_in_both_layouts_and_cases() {
        for l in LAYOUTS {
            for (m, abc) in [(Mode::Lower, 'a'..='z'), (Mode::Upper, 'A'..='Z')] {
                let keys: Vec<&str> = rows(l, m).concat().iter().map(|k| k.0).collect();
                for ch in abc {
                    let n = keys.iter().filter(|k| **k == ch.to_string()).count();
                    assert_eq!(n, 1, "{l:?} {m:?}: «{ch}» {n} times");
                }
            }
        }
    }

    #[test]
    fn every_map_can_switch_layout_mode_confirm_and_close() {
        for l in LAYOUTS {
            let other = if l == Layout::Standard {
                TO_ALPHABETIC
            } else {
                TO_STANDARD
            };
            for m in MODES {
                let keys: Vec<&str> = rows(l, m).concat().iter().map(|k| k.0).collect();
                for needed in [
                    other,
                    sym(lvgl_sys::LV_SYMBOL_OK),
                    sym(lvgl_sys::LV_SYMBOL_KEYBOARD),
                    sym(lvgl_sys::LV_SYMBOL_BACKSPACE),
                    " ",
                ] {
                    assert!(keys.contains(&needed), "{l:?} {m:?}: «{needed}» missing");
                }
                // A way to the other modes: LVGL switches on these labels.
                let ways = ["1#", "ABC", "abc"]
                    .iter()
                    .filter(|k| keys.contains(k))
                    .count();
                assert!(ways >= 1, "{l:?} {m:?}: no mode key");
            }
        }
        assert_eq!(switch_for(b"A-Z"), Some(Layout::Alphabetic));
        assert_eq!(switch_for(b"QWE"), Some(Layout::Standard));
        assert_eq!(switch_for(b"a"), None);
    }

    #[test]
    fn the_saved_choice_reads_back_and_anything_else_is_standard() {
        assert_eq!(parse_saved("alphabetic\n"), Layout::Alphabetic);
        assert_eq!(parse_saved("standard"), Layout::Standard);
        assert_eq!(parse_saved(""), Layout::Standard);
        assert_eq!(parse_saved("qwerty"), Layout::Standard);
    }
}
