//! The device control panel **drawn** on the LVGL viewer: the twin of
//! `sws-editor/src/control-panel/ControlPanel.tsx`, with its colours and its
//! layout. What to show, the network and the gesture are in
//! [`crate::control_panel`]; here there is only LVGL.
//!
//! # On the system layer
//!
//! Above the page, the modal windows and the update notice with its login
//! (`lv_disp_get_layer_top`): the panel is the way out of a device in trouble,
//! and nothing the project or the viewer shows may cover it.
//!
//! # Rebuilt when the state changes
//!
//! Like `lvgl_avviso`: a callback only changes the state, and the next frame
//! sees the generation changed and rebuilds — deleting the object that is
//! running its own callback would be a use-after-free. What changes every
//! second (the clock, the countdowns) only rewrites its label.

use std::ffi::c_void;
use std::time::Instant;

use lvgl::Color;

use crate::control_panel::{self as cp, Power, Screen, Section, State};
use crate::lvgl_render::{stile, testo_etichetta, text_cstring};

type P = *mut lvgl_sys::lv_obj_t;
type Rgb = (u8, u8, u8);

// The palette of the web panel (`C` in ControlPanel.tsx).
const BG: Rgb = (27, 31, 36);
const PANEL: Rgb = (36, 42, 49);
const PANEL2: Rgb = (44, 51, 59);
const LINE: Rgb = (58, 67, 77);
const TEXT: Rgb = (230, 233, 236);
const MUTED: Rgb = (154, 165, 177);
const ACCENT: Rgb = (79, 156, 240);
const OK: Rgb = (70, 179, 122);
const WARN: Rgb = (224, 164, 58);
const BAD: Rgb = (217, 83, 79);

const HEADER_H: i16 = 50;
const LV_SIZE_CONTENT: i16 = 2001 | (1 << 13);
const fn pct(v: i16) -> i16 {
    v | (1 << 13)
}

/// What a button does. A callback only calls into `control_panel`.
#[derive(Clone)]
enum Action {
    Open,
    Close,
    PinKey(char),
    PinBack,
    PinSubmit,
    Section(Section),
    EditStart(String),
    EditManual(bool),
    EditFocus(usize),
    EditKey(&'static str),
    EditCancel,
    EditApply,
    Confirm,
    Rollback,
    Ntp(bool),
    ManualStart,
    ManualFocus(usize),
    ManualKey(&'static str),
    ManualCancel,
    ManualApply,
    Ask(Option<Power>),
    Power(Power),
    WifiScan,
    WifiRadio(bool),
    WifiJoin(Option<String>),
    WifiForget(String),
    HotspotStart,
    HotspotOff,
    FormFocus(usize),
    FormKey(String),
    FormCancel,
    FormSubmit,
    BrightnessMode(bool),
    PixsysCalibration,
    CalibrateStart,
    CalibrateSave,
    CalibrateRedo,
    CalibrateCancel,
}

unsafe extern "C" fn sws_control_panel_cb(e: *mut lvgl_sys::lv_event_t) {
    let data = lvgl_sys::lv_event_get_user_data(e);
    if data.is_null() {
        return;
    }
    match &*(data as *const Action) {
        Action::Open => cp::open(true),
        Action::Close => cp::close(),
        Action::PinKey(k) => cp::pin_key(*k),
        Action::PinBack => cp::pin_back(),
        Action::PinSubmit => cp::pin_submit(),
        Action::Section(s) => cp::select(*s),
        Action::EditStart(c) => cp::edit_start(c),
        Action::EditManual(m) => cp::edit_manual(*m),
        Action::EditFocus(i) => cp::edit_focus(*i),
        Action::EditKey(k) => cp::edit_key(k),
        Action::EditCancel => cp::edit_cancel(),
        Action::EditApply => cp::edit_apply(),
        Action::Confirm => cp::confirm_network(),
        Action::Rollback => cp::rollback_network(),
        Action::Ntp(on) => cp::set_ntp(*on),
        Action::ManualStart => cp::manual_time_start(),
        Action::ManualFocus(i) => cp::manual_time_focus(*i),
        Action::ManualKey(k) => cp::manual_time_key(k),
        Action::ManualCancel => cp::manual_time_cancel(),
        Action::ManualApply => cp::manual_time_apply(),
        Action::Ask(p) => cp::ask(*p),
        Action::Power(p) => cp::power(*p),
        Action::WifiScan => cp::wifi_scan(),
        Action::WifiRadio(on) => cp::wifi_radio(*on),
        Action::WifiJoin(ssid) => cp::wifi_join(ssid.as_deref()),
        Action::WifiForget(ssid) => cp::wifi_forget(ssid),
        Action::HotspotStart => cp::hotspot_start(),
        Action::HotspotOff => cp::hotspot_off(),
        Action::FormFocus(i) => cp::form_focus(*i),
        Action::FormKey(k) => cp::form_key(k),
        Action::FormCancel => cp::form_cancel(),
        Action::FormSubmit => cp::form_submit(),
        Action::BrightnessMode(here) => {
            let draft = cp::with_state(|s| s.brightness_draft);
            cp::brightness_set(here.then_some(draft));
        }
        Action::PixsysCalibration => cp::pixsys_calibration(),
        Action::CalibrateStart => cp::calibrate_start(),
        Action::CalibrateSave => cp::calibrate_save(),
        Action::CalibrateRedo => cp::calibrate_redo(),
        Action::CalibrateCancel => cp::calibrate_cancel(),
    }
}

/// The brightness slider: the light follows while it moves, and is saved
/// when the finger lifts.
unsafe extern "C" fn sws_control_panel_slider_cb(e: *mut lvgl_sys::lv_event_t) {
    let slider = lvgl_sys::lv_event_get_target(e);
    let v = lvgl_sys::lv_bar_get_value(slider).clamp(5, 100) as u8;
    if lvgl_sys::lv_event_get_code(e) == lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED {
        cp::brightness_preview(v);
        let l = lvgl_sys::lv_event_get_user_data(e) as P;
        if !l.is_null() {
            testo_etichetta(l, text_cstring(&format!("{v} %")).as_ptr());
        }
    } else {
        cp::brightness_set(Some(v));
    }
}

unsafe extern "C" fn sws_control_panel_zone_cb(e: *mut lvgl_sys::lv_event_t) {
    let dd = lvgl_sys::lv_event_get_target(e);
    let mut buf = [0 as std::ffi::c_char; 64];
    lvgl_sys::lv_dropdown_get_selected_str(dd, buf.as_mut_ptr(), buf.len() as u32);
    let zone = std::ffi::CStr::from_ptr(buf.as_ptr())
        .to_string_lossy()
        .into_owned();
    if !zone.is_empty() {
        cp::set_timezone(&zone);
    }
}

/// The labels rewritten every frame instead of rebuilt.
enum Tick {
    BootSeconds,
    Clock,
    Date,
    Countdown,
    ConfirmHelp,
    /// The dot under the finger while a calibration is tried.
    CalibrationDot,
}

#[derive(Default)]
pub struct Overlay {
    root: Option<P>,
    ring: Option<P>,
    ctxs: Vec<*mut Action>,
    key: Option<(u64, &'static str)>,
    ticks: Vec<(P, Tick)>,
}

impl Overlay {
    pub fn new() -> Overlay {
        Overlay::default()
    }

    /// At every frame. `content_lang`: the language of the project's contents.
    pub fn sincronizza(&mut self, content_lang: &str) {
        let now = Instant::now();
        cp::tick(now);
        let lang = cp::panel_language(content_lang);
        let generation = cp::with_state(|s| s.generation);
        if self.key != Some((generation, lang)) {
            self.destroy();
            self.key = Some((generation, lang));
            let boot = cp::boot_button(now).is_some();
            cp::with_state(|s| unsafe {
                match s.screen {
                    Screen::Closed if boot => self.build_boot(lang),
                    Screen::Closed => {}
                    Screen::Pin => self.build_pin(s, lang),
                    Screen::Panel if s.calibration.is_some() => self.build_calibration(s, lang),
                    Screen::Panel => self.build_panel(s, lang),
                }
            });
        }
        unsafe { self.update_ticks(lang, now) };
        self.update_ring(now);
    }

    fn destroy(&mut self) {
        if let Some(r) = self.root.take() {
            unsafe { lvgl_sys::lv_obj_del(r) };
        }
        // After the objects, never before: LVGL holds these pointers.
        for c in self.ctxs.drain(..) {
            drop(unsafe { Box::from_raw(c) });
        }
        self.ticks.clear();
    }

    unsafe fn on(&mut self, p: P, a: Action) {
        let ctx = Box::into_raw(Box::new(a));
        self.ctxs.push(ctx);
        lvgl_sys::lv_obj_add_event_cb(
            p,
            Some(sws_control_panel_cb),
            lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
            ctx as *mut c_void,
        );
    }

    unsafe fn update_ticks(&self, lang: &str, now: Instant) {
        if self.ticks.is_empty() {
            return;
        }
        let (boot, time, pending) = cp::with_state(|s| {
            (
                s.boot_until,
                s.time.clone(),
                s.pending.as_ref().map(|p| (p.until, p.before.clone())),
            )
        });
        let secs_to = |t: Instant| t.saturating_duration_since(now).as_secs_f32().ceil() as u64;
        let clock = time.map(|(t, read)| {
            let usec = t.time_usec + now.duration_since(read).as_micros() as i64;
            chrono::DateTime::from_timestamp_micros(usec)
                .unwrap_or_default()
                .with_timezone(&chrono::Local)
        });
        for (label, tick) in &self.ticks {
            if let Tick::CalibrationDot = tick {
                if let Some(((x, y), _)) = crate::touch_calibration::last_touch() {
                    lvgl_sys::lv_obj_set_pos(*label, x as i16 - 12, y as i16 - 12);
                    lvgl_sys::lv_obj_clear_flag(*label, lvgl_sys::LV_OBJ_FLAG_HIDDEN);
                }
                continue;
            }
            let text = match tick {
                Tick::BootSeconds => boot.map(|t| secs_to(t).to_string()),
                Tick::Clock => clock.map(|c| c.format("%H:%M:%S").to_string()),
                Tick::Date => clock.map(|c| {
                    c.format(if lang == "it" { "%d/%m/%Y" } else { "%Y-%m-%d" })
                        .to_string()
                }),
                Tick::Countdown => pending.as_ref().map(|(u, _)| secs_to(*u).to_string()),
                Tick::ConfirmHelp => pending.as_ref().map(|(u, before)| {
                    cp::word(
                        lang,
                        "confirmHelp",
                        &[("secs", &secs_to(*u).to_string()), ("before", before)],
                    )
                }),
                Tick::CalibrationDot => None,
            };
            if let Some(t) = text {
                testo_etichetta(*label, text_cstring(&t).as_ptr());
            }
        }
    }

    /// The ring of the corner gesture, while a finger is in the corner.
    fn update_ring(&mut self, now: Instant) {
        unsafe {
            match (cp::hold_progress(now), self.ring) {
                (Some(f), ring) => {
                    let arc = match ring {
                        Some(a) => a,
                        None => {
                            let a = lvgl_sys::lv_arc_create(lvgl_sys::lv_disp_get_layer_sys(
                                core::ptr::null_mut(),
                            ));
                            if a.is_null() {
                                return;
                            }
                            lvgl_sys::lv_obj_set_size(a, 64, 64);
                            lvgl_sys::lv_obj_align(
                                a,
                                lvgl_sys::LV_ALIGN_TOP_RIGHT as lvgl_sys::lv_align_t,
                                -10,
                                10,
                            );
                            lvgl_sys::lv_arc_set_bg_angles(a, 0, 360);
                            lvgl_sys::lv_arc_set_rotation(a, 270);
                            lvgl_sys::lv_arc_set_range(a, 0, 100);
                            lvgl_sys::lv_obj_remove_style(
                                a,
                                core::ptr::null_mut(),
                                lvgl_sys::LV_PART_KNOB,
                            );
                            lvgl_sys::lv_obj_clear_flag(a, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
                            lvgl_sys::lv_obj_set_style_arc_color(
                                a,
                                Color::from_rgb(LINE).into(),
                                stile::MAIN,
                            );
                            lvgl_sys::lv_obj_set_style_arc_color(
                                a,
                                Color::from_rgb(ACCENT).into(),
                                stile::INDICATORE,
                            );
                            lvgl_sys::lv_obj_set_style_arc_width(a, 6, stile::MAIN);
                            lvgl_sys::lv_obj_set_style_arc_width(a, 6, stile::INDICATORE);
                            self.ring = Some(a);
                            a
                        }
                    };
                    lvgl_sys::lv_arc_set_value(arc, (f * 100.0) as i16);
                }
                (None, Some(a)) => {
                    lvgl_sys::lv_obj_del(a);
                    self.ring = None;
                }
                (None, None) => {}
            }
        }
    }

    // ── Boot button ──────────────────────────────────────────────────────────

    unsafe fn build_boot(&mut self, lang: &str) {
        let b = lvgl_sys::lv_btn_create(layer());
        if b.is_null() {
            return;
        }
        self.root = Some(b);
        button_style(b, PANEL2, LINE);
        stile::margini(b, 10, 16, stile::MAIN);
        lvgl_sys::lv_obj_set_size(b, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
        flex(b, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 10);
        lvgl_sys::lv_obj_align(
            b,
            lvgl_sys::LV_ALIGN_TOP_RIGHT as lvgl_sys::lv_align_t,
            -16,
            14,
        );
        let n = label(b, "5", 18, ACCENT);
        self.ticks.push((n, Tick::BootSeconds));
        label(b, &cp::word(lang, "title", &[]), 16, TEXT);
        self.on(b, Action::Open);
    }

    // ── PIN ──────────────────────────────────────────────────────────────────

    unsafe fn build_pin(&mut self, s: &State, lang: &str) {
        let (w, h) = screen_size();
        let root = full_screen(BG);
        lvgl_sys::lv_obj_set_style_bg_opa(root, lvgl_sys::LV_OPA_70 as u8, stile::MAIN);
        lvgl_sys::lv_obj_set_style_bg_color(root, Color::from_rgb((0, 0, 0)).into(), stile::MAIN);
        self.root = Some(root);

        let card = panel_box(root, PANEL);
        let cw = (w - 32).min(420);
        lvgl_sys::lv_obj_set_size(card, cw, LV_SIZE_CONTENT);
        stile::margini(card, 16, 20, stile::MAIN);
        flex(card, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 8);
        label(card, &cp::word(lang, "title", &[]), 20, TEXT);
        let help = label(card, &cp::word(lang, "pinHelp", &[]), 14, MUTED);
        wrap(help, pct(100));

        // The six boxes.
        let boxes = transparent(card);
        lvgl_sys::lv_obj_set_size(boxes, pct(100), LV_SIZE_CONTENT);
        flex(boxes, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 8);
        lvgl_sys::lv_obj_set_flex_align(
            boxes,
            lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
            lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
            lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
        );
        let box_h = if h < 520 { 42 } else { 52 };
        for i in 0..6 {
            let c = s.pin.chars().nth(i);
            let b = panel_box(boxes, BG);
            stile::bordo(
                b,
                Some(if c.is_some() { ACCENT } else { LINE }),
                1.0,
                stile::MAIN,
            );
            lvgl_sys::lv_obj_set_size(b, 44, box_h);
            let l = label(b, &c.map_or("·".to_string(), |c| c.to_string()), 24, TEXT);
            lvgl_sys::lv_obj_align(l, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
        }
        let err = match &s.pin_error {
            Some(cp::PinError::Wrong) => cp::word(lang, "pinWrong", &[]),
            Some(cp::PinError::Locked(secs)) => {
                cp::word(lang, "pinLocked", &[("secs", &secs.to_string())])
            }
            None => s.error.clone().unwrap_or_default(),
        };
        let e = label(card, &err, 14, (241, 176, 173));
        wrap(e, pct(100));
        lvgl_sys::lv_obj_set_style_text_align(e, lvgl_sys::LV_TEXT_ALIGN_CENTER as u8, stile::MAIN);

        // The hex keypad: four rows of four, then Cancel, ⌫, Enter.
        let key_h = ((h - 260) / 5 - 8).clamp(36, 50);
        let keys = transparent(card);
        lvgl_sys::lv_obj_set_size(keys, pct(100), LV_SIZE_CONTENT);
        flex(keys, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW_WRAP, 8);
        // The card border takes a pixel on each side: without it the fourth key
        // wraps to the next row.
        let kw = (cw - 40 - 2 - 3 * 8) / 4;
        for k in "123a456b789cd0ef".chars() {
            let b = button(
                keys,
                &k.to_string(),
                PANEL2,
                if k.is_ascii_digit() {
                    TEXT
                } else {
                    (156, 198, 245)
                },
                20,
            );
            lvgl_sys::lv_obj_set_size(b, kw, key_h);
            self.on(b, Action::PinKey(k));
        }
        let cancel = button(keys, &cp::word(lang, "cancel", &[]), PANEL2, MUTED, 15);
        lvgl_sys::lv_obj_set_size(cancel, kw * 2 + 8, key_h);
        self.on(cancel, Action::Close);
        let back = button(keys, "⌫", PANEL2, MUTED, 18);
        lvgl_sys::lv_obj_set_size(back, kw, key_h);
        self.on(back, Action::PinBack);
        let enter = button(
            keys,
            &cp::word(lang, "enter", &[]),
            ACCENT,
            (255, 255, 255),
            15,
        );
        lvgl_sys::lv_obj_set_size(enter, kw, key_h);
        if s.pin.is_empty() || s.busy {
            dim(enter);
        } else {
            self.on(enter, Action::PinSubmit);
        }
        lvgl_sys::lv_obj_align(
            card,
            lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t,
            0,
            0,
        );
    }

    // ── The panel ────────────────────────────────────────────────────────────

    unsafe fn build_panel(&mut self, s: &State, lang: &str) {
        let (w, h) = screen_size();
        let root = full_screen(BG);
        self.root = Some(root);
        let nav_w = (w / 5).clamp(150, 220);

        // Header: title, host name, Close.
        let header = panel_box(root, PANEL);
        stile::raggio(header, 0.0, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(header, 0, 0);
        lvgl_sys::lv_obj_set_size(header, w, HEADER_H);
        stile::margini(header, 0, 16, stile::MAIN);
        flex(header, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 10);
        center_items(header);
        label(header, &cp::word(lang, "title", &[]), 19, TEXT);
        if let Some(i) = &s.info {
            let host = label(header, &i.hostname, 13, MUTED);
            lvgl_sys::lv_obj_set_flex_grow(host, 1);
        } else {
            lvgl_sys::lv_obj_set_flex_grow(transparent(header), 1);
        }
        let close = button(
            header,
            &format!("{} ✕", cp::word(lang, "close", &[])),
            PANEL2,
            TEXT,
            15,
        );
        self.on(close, Action::Close);

        // Navigation.
        let nav = panel_box(root, PANEL);
        stile::raggio(nav, 0.0, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(nav, 0, HEADER_H);
        lvgl_sys::lv_obj_set_size(nav, nav_w, h - HEADER_H);
        stile::margini(nav, 10, 0, stile::MAIN);
        flex(nav, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 0);
        let caps = s.caps.clone().unwrap_or(cp::Capabilities {
            network: true,
            time: true,
            ..Default::default()
        });
        // The resistive calibration is the viewer's: the runtime cannot know.
        let screen_on =
            caps.display || caps.touch_calibration_service || crate::touch_calibration::resistive();
        let sections = [
            (Some(Section::Network), "network", caps.network),
            (Some(Section::Wifi), "wifi", caps.wifi),
            (Some(Section::Time), "time", caps.time),
            (Some(Section::Screen), "screen", screen_on),
            (Some(Section::Device), "device", true),
        ];
        for (section, key, on) in sections {
            let active = section == Some(s.section);
            let b = lvgl_sys::lv_obj_create(nav);
            plain(b);
            lvgl_sys::lv_obj_set_size(b, pct(100), 50);
            stile::margini(b, 0, 20, stile::MAIN);
            if active {
                stile::sfondo(b, PANEL2, stile::MAIN);
                lvgl_sys::lv_obj_set_style_border_side(
                    b,
                    lvgl_sys::LV_BORDER_SIDE_LEFT as u8,
                    stile::MAIN,
                );
                stile::bordo(b, Some(ACCENT), 4.0, stile::MAIN);
            }
            let l = label(
                b,
                &cp::word(lang, key, &[]),
                16,
                if active { TEXT } else { MUTED },
            );
            lvgl_sys::lv_obj_align(l, lvgl_sys::LV_ALIGN_LEFT_MID as lvgl_sys::lv_align_t, 0, 0);
            match section.filter(|_| on) {
                Some(sec) => {
                    lvgl_sys::lv_obj_add_flag(b, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
                    self.on(b, Action::Section(sec));
                }
                None => lvgl_sys::lv_obj_set_style_opa(b, 89, stile::MAIN),
            }
        }

        // What sits at the bottom: the keypad of a field being typed, or the
        // bar of a network change waiting for confirmation.
        let typing_ip = s.section == Section::Network && s.draft.as_ref().is_some_and(|d| d.manual);
        let typing_time = s.section == Section::Time && s.manual_time.is_some();
        let typing_text = s.section == Section::Wifi && s.wifi_form.is_some();
        let pending = matches!(s.section, Section::Network | Section::Wifi) && s.pending.is_some();
        let keypad_h: i16 = if h < 520 { 104 } else { 116 };
        let keyboard_h: i16 = if h < 520 { 196 } else { 220 };
        let bottom = if typing_ip || typing_time {
            keypad_h
        } else if typing_text {
            keyboard_h
        } else if pending {
            84
        } else {
            0
        };

        let main = transparent(root);
        lvgl_sys::lv_obj_set_pos(main, nav_w, HEADER_H);
        lvgl_sys::lv_obj_set_size(main, w - nav_w, h - HEADER_H - bottom);
        lvgl_sys::lv_obj_add_flag(main, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
        stile::margini(main, 14, 18, stile::MAIN);
        flex(main, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 12);

        if let Some(e) = &s.error {
            let c = panel_box(main, PANEL);
            stile::bordo(c, Some(BAD), 1.0, stile::MAIN);
            lvgl_sys::lv_obj_set_size(c, pct(100), LV_SIZE_CONTENT);
            stile::margini(c, 10, 14, stile::MAIN);
            wrap(label(c, e, 15, (241, 176, 173)), pct(100));
        }
        if let Some(p) = s.powering {
            let key = if p == Power::Reboot {
                "rebooting"
            } else {
                "poweringOff"
            };
            label(main, &cp::word(lang, key, &[]), 20, TEXT);
            return;
        }
        let mut focused = None;
        match s.section {
            Section::Network => focused = self.network(main, s, lang),
            Section::Wifi => focused = self.wifi(main, s, lang),
            Section::Time => focused = self.time(main, s, lang),
            Section::Screen => self.screen(main, s, lang, &caps),
            Section::Device => self.device(main, s, lang, &caps),
        }

        if typing_ip {
            let d = s.draft.as_ref().expect("typing_ip");
            let keys: &[&'static str] = &[
                "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ".", "⌫", "←", "→",
            ];
            self.keypad(
                root,
                nav_w,
                w - nav_w,
                keypad_h,
                keys,
                lang,
                d.valid(),
                true,
            );
        } else if typing_time {
            let m = s.manual_time.as_ref().expect("typing_time");
            let keys: &[&'static str] = &[
                "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", ":", "⌫", "←", "→",
            ];
            self.keypad(
                root,
                nav_w,
                w - nav_w,
                keypad_h,
                keys,
                lang,
                cp::manual_time_usec(m).is_some(),
                false,
            );
        } else if typing_text {
            let f = s.wifi_form.as_ref().expect("typing_text");
            self.keyboard(root, nav_w, w - nav_w, keyboard_h, f, lang);
        } else if pending {
            self.confirm_bar(root, w, lang);
        }

        // The field being typed stays in view above the keypad.
        if let Some(f) = focused {
            lvgl_sys::lv_obj_update_layout(root);
            lvgl_sys::lv_obj_scroll_to_view(f, lvgl_sys::lv_anim_enable_t_LV_ANIM_OFF);
        }
    }

    unsafe fn network(&mut self, main: P, s: &State, lang: &str) -> Option<P> {
        let Some(cards) = &s.cards else {
            label(main, &cp::word(lang, "loading", &[]), 15, MUTED);
            return None;
        };
        if cards.is_empty() {
            card(main, |c| {
                label(c, &cp::word(lang, "noCards", &[]), 15, TEXT);
            });
        }
        let mut focused = None;
        for c in cards {
            let pending_here = s.pending.is_some();
            let editing = s.draft.as_ref().filter(|d| d.card == c.name);
            let box_ = card(main, |_| {});
            if c.state == "unavailable" {
                lvgl_sys::lv_obj_set_style_opa(box_, 153, stile::MAIN);
            }
            // Card and state, with the coloured dot.
            let r = row(box_, &cp::word(lang, "card", &[]));
            let dot = lvgl_sys::lv_obj_create(r);
            plain(dot);
            lvgl_sys::lv_obj_set_size(dot, 10, 10);
            stile::raggio(dot, 5.0, stile::MAIN);
            stile::sfondo(
                dot,
                if pending_here {
                    WARN
                } else {
                    match c.state.as_str() {
                        "connected" => OK,
                        "connecting" => WARN,
                        _ => LINE,
                    }
                },
                stile::MAIN,
            );
            label(
                r,
                &format!(
                    "{} · {}",
                    c.name,
                    cp::word(lang, &format!("state.{}", c.state), &[])
                ),
                16,
                TEXT,
            );
            if !c.addresses.is_empty() {
                let r = row(box_, &cp::word(lang, "addressNow", &[]));
                label(r, &c.addresses.join(", "), 16, TEXT);
                match c.method.as_deref() {
                    Some("auto") => tag(r, "DHCP", true),
                    Some("manual") if pending_here => {
                        tag(r, &cp::word(lang, "staticToConfirm", &[]), false)
                    }
                    Some("manual") => tag(r, &cp::word(lang, "static", &[]), true),
                    _ => {}
                }
            }
            if c.gateway.is_some() || !c.dns.is_empty() {
                let r = row(box_, &cp::word(lang, "gatewayDns", &[]));
                let dns = if c.dns.is_empty() {
                    "—".to_string()
                } else {
                    c.dns.join(", ")
                };
                label(
                    r,
                    &format!("{} · {dns}", c.gateway.as_deref().unwrap_or("—")),
                    16,
                    TEXT,
                );
            }
            if let Some(mac) = &c.mac {
                let r = row(box_, "MAC");
                label(r, mac, 16, MUTED);
            }
            match editing {
                None if c.method.is_some() && !pending_here && s.draft.is_none() => {
                    let r = actions(box_);
                    let b = button(r, &cp::word(lang, "change", &[]), PANEL2, TEXT, 15);
                    self.on(b, Action::EditStart(c.name.clone()));
                }
                None => {}
                Some(d) => {
                    let sep = lvgl_sys::lv_obj_create(box_);
                    plain(sep);
                    lvgl_sys::lv_obj_set_size(sep, pct(100), 1);
                    stile::sfondo(sep, LINE, stile::MAIN);
                    let r = row(box_, "IPv4");
                    self.segmented(
                        r,
                        &[
                            ("DHCP".into(), !d.manual, Action::EditManual(false)),
                            (
                                cp::word(lang, "static", &[]),
                                d.manual,
                                Action::EditManual(true),
                            ),
                        ],
                    );
                    if d.manual {
                        let r = row(box_, &cp::word(lang, "address", &[]));
                        focused = focused.or(self.field(r, d, 0, 180));
                        label(r, "/", 16, MUTED);
                        focused = focused.or(self.field(r, d, 1, 60));
                        let r = row(box_, &cp::word(lang, "gateway", &[]));
                        focused = focused.or(self.field(r, d, 2, 180));
                        let r = row(box_, "DNS");
                        focused = focused.or(self.field(r, d, 3, 180));
                    } else {
                        // With the keypad closed, Cancel and Apply live here.
                        let r = actions(box_);
                        let b = button(r, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 15);
                        self.on(b, Action::EditCancel);
                        let b = button(
                            r,
                            &cp::word(lang, "apply", &[]),
                            ACCENT,
                            (255, 255, 255),
                            15,
                        );
                        if s.busy {
                            dim(b);
                        } else {
                            self.on(b, Action::EditApply);
                        }
                    }
                }
            }
        }
        focused
    }

    /// One address field: shown, not edited in place — the keypad writes.
    unsafe fn field(&mut self, parent: P, d: &cp::Draft, i: usize, width: i16) -> Option<P> {
        let focus = d.focus == i;
        let bad = !d.fields[i].is_empty() && d.field_bad(i);
        let f = self.text_field(parent, &d.fields[i], width, focus, bad);
        self.on(f, Action::EditFocus(i));
        focus.then_some(f)
    }

    unsafe fn text_field(
        &mut self,
        parent: P,
        text: &str,
        width: i16,
        focus: bool,
        bad: bool,
    ) -> P {
        let f = panel_box(parent, BG);
        lvgl_sys::lv_obj_set_size(f, width, 40);
        stile::raggio(f, 5.0, stile::MAIN);
        stile::bordo(
            f,
            Some(if bad {
                BAD
            } else if focus {
                ACCENT
            } else {
                LINE
            }),
            if focus { 2.0 } else { 1.0 },
            stile::MAIN,
        );
        stile::margini(f, 0, 10, stile::MAIN);
        lvgl_sys::lv_obj_add_flag(f, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
        let shown = if focus {
            format!("{text}|")
        } else {
            text.to_string()
        };
        let l = label(f, &shown, 16, TEXT);
        lvgl_sys::lv_obj_align(l, lvgl_sys::LV_ALIGN_LEFT_MID as lvgl_sys::lv_align_t, 0, 0);
        f
    }

    unsafe fn segmented(&mut self, parent: P, options: &[(String, bool, Action)]) {
        let g = panel_box(parent, BG);
        lvgl_sys::lv_obj_set_size(g, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
        stile::raggio(g, 6.0, stile::MAIN);
        lvgl_sys::lv_obj_set_style_clip_corner(g, true, stile::MAIN);
        flex(g, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 0);
        for (text, on, action) in options {
            let b = lvgl_sys::lv_obj_create(g);
            plain(b);
            lvgl_sys::lv_obj_set_size(b, LV_SIZE_CONTENT, 40);
            stile::margini(b, 0, 18, stile::MAIN);
            if *on {
                stile::sfondo(b, ACCENT, stile::MAIN);
            }
            let l = label(b, text, 15, if *on { (255, 255, 255) } else { MUTED });
            lvgl_sys::lv_obj_align(l, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
            lvgl_sys::lv_obj_add_flag(b, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
            self.on(b, action.clone());
        }
    }

    /// The keypad at the bottom: the keys, then Cancel and Apply.
    #[allow(clippy::too_many_arguments)]
    unsafe fn keypad(
        &mut self,
        root: P,
        x: i16,
        w: i16,
        h: i16,
        keys: &[&'static str],
        lang: &str,
        valid: bool,
        ip: bool,
    ) {
        let k = panel_box(root, (20, 24, 29));
        stile::raggio(k, 0.0, stile::MAIN);
        lvgl_sys::lv_obj_set_style_border_side(k, lvgl_sys::LV_BORDER_SIDE_TOP as u8, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(k, x, screen_size().1 - h);
        lvgl_sys::lv_obj_set_size(k, w, h);
        stile::margini(k, 8, 10, stile::MAIN);
        flex(k, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW_WRAP, 6);
        // Two rows: the keys share them with Cancel and Apply (two keys each).
        let per_row = (keys.len() + 4).div_ceil(2) as i16;
        let kw = (w - 20 - (per_row - 1) * 6) / per_row;
        let kh = (h - 16 - 6) / 2;
        for key in keys {
            let shown = match *key {
                "←" => format!("← {}", cp::word(lang, "field", &[])),
                "→" => format!("{} →", cp::word(lang, "field", &[])),
                k => k.to_string(),
            };
            let b = button(
                k,
                &shown,
                PANEL2,
                TEXT,
                if key.len() == 1 { 18 } else { 14 },
            );
            let wide = matches!(*key, "←" | "→");
            lvgl_sys::lv_obj_set_size(b, if wide { kw * 2 + 6 } else { kw }, kh);
            self.on(
                b,
                if ip {
                    Action::EditKey(key)
                } else {
                    Action::ManualKey(key)
                },
            );
        }
        let cancel = button(k, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 14);
        lvgl_sys::lv_obj_set_flex_grow(cancel, 1);
        lvgl_sys::lv_obj_set_height(cancel, kh);
        self.on(
            cancel,
            if ip {
                Action::EditCancel
            } else {
                Action::ManualCancel
            },
        );
        let apply = button(
            k,
            &cp::word(lang, "apply", &[]),
            ACCENT,
            (255, 255, 255),
            14,
        );
        lvgl_sys::lv_obj_set_flex_grow(apply, 1);
        lvgl_sys::lv_obj_set_height(apply, kh);
        if valid {
            self.on(
                apply,
                if ip {
                    Action::EditApply
                } else {
                    Action::ManualApply
                },
            );
        } else {
            dim(apply);
        }
    }

    unsafe fn confirm_bar(&mut self, root: P, w: i16, lang: &str) {
        let bar = panel_box(root, (59, 47, 18));
        stile::raggio(bar, 0.0, stile::MAIN);
        lvgl_sys::lv_obj_set_style_border_side(
            bar,
            lvgl_sys::LV_BORDER_SIDE_TOP as u8,
            stile::MAIN,
        );
        stile::bordo(bar, Some(WARN), 2.0, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(bar, 0, screen_size().1 - 84);
        lvgl_sys::lv_obj_set_size(bar, w, 84);
        stile::margini(bar, 8, 18, stile::MAIN);
        flex(bar, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 14);
        center_items(bar);
        let n = label(bar, "60", 30, WARN);
        lvgl_sys::lv_obj_set_width(n, 50);
        lvgl_sys::lv_obj_set_style_text_align(n, lvgl_sys::LV_TEXT_ALIGN_CENTER as u8, stile::MAIN);
        self.ticks.push((n, Tick::Countdown));
        let col = transparent(bar);
        lvgl_sys::lv_obj_set_height(col, LV_SIZE_CONTENT);
        lvgl_sys::lv_obj_set_flex_grow(col, 1);
        flex(col, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 2);
        label(col, &cp::word(lang, "confirmQuestion", &[]), 17, TEXT);
        let help = label(col, "", 13, (233, 216, 176));
        wrap(help, pct(100));
        self.ticks.push((help, Tick::ConfirmHelp));
        let b = button(bar, &cp::word(lang, "rollback", &[]), PANEL2, TEXT, 15);
        self.on(b, Action::Rollback);
        let b = button(
            bar,
            &cp::word(lang, "confirm", &[]),
            ACCENT,
            (255, 255, 255),
            15,
        );
        self.on(b, Action::Confirm);
    }

    unsafe fn time(&mut self, main: P, s: &State, lang: &str) -> Option<P> {
        let Some((t, _)) = &s.time else {
            label(main, &cp::word(lang, "loading", &[]), 15, MUTED);
            return None;
        };
        let c = card(main, |_| {});
        let r = row(c, &cp::word(lang, "deviceTime", &[]));
        let clock = label(r, "", 30, TEXT);
        self.ticks.push((clock, Tick::Clock));
        let col = transparent(r);
        lvgl_sys::lv_obj_set_size(col, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
        flex(col, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 0);
        let date = label(col, "", 14, MUTED);
        self.ticks.push((date, Tick::Date));
        label(col, &t.timezone, 13, MUTED);

        let c = card(main, |_| {});
        let r = row(c, &cp::word(lang, "sync", &[]));
        if t.can_ntp {
            self.segmented(
                r,
                &[
                    (cp::word(lang, "ntp", &[]), t.ntp, Action::Ntp(true)),
                    (cp::word(lang, "manual", &[]), !t.ntp, Action::Ntp(false)),
                ],
            );
        }
        if t.ntp {
            let (key, ok) = if t.ntp_synchronized {
                ("synced", true)
            } else {
                ("notSynced", false)
            };
            tag(r, &cp::word(lang, key, &[]), ok);
        }
        let r = row(c, &cp::word(lang, "timezone", &[]));
        if !s.zones.is_empty() {
            let dd = lvgl_sys::lv_dropdown_create(r);
            if !dd.is_null() {
                let options = std::ffi::CString::new(s.zones.join("\n")).unwrap_or_default();
                lvgl_sys::lv_dropdown_set_options(dd, options.as_ptr());
                if let Some(i) = s.zones.iter().position(|z| z == &t.timezone) {
                    lvgl_sys::lv_dropdown_set_selected(dd, i as u16);
                }
                lvgl_sys::lv_obj_set_width(dd, 260);
                stile::font(dd, 15, stile::MAIN);
                lvgl_sys::lv_obj_set_style_text_font(
                    dd,
                    &lvgl_sys::lv_font_montserrat_14 as *const lvgl_sys::lv_font_t,
                    lvgl_sys::LV_PART_INDICATOR,
                );
                stile::sfondo(dd, BG, stile::MAIN);
                stile::testo(dd, TEXT, stile::MAIN);
                stile::bordo(dd, Some(LINE), 1.0, stile::MAIN);
                lvgl_sys::lv_obj_add_event_cb(
                    dd,
                    Some(sws_control_panel_zone_cb),
                    lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED,
                    core::ptr::null_mut(),
                );
                // The list LVGL opens below: dark, like the rest.
                let list = lvgl_sys::lv_dropdown_get_list(dd);
                if !list.is_null() {
                    stile::sfondo(list, PANEL2, stile::MAIN);
                    stile::testo(list, TEXT, stile::MAIN);
                    stile::bordo(list, Some(LINE), 1.0, stile::MAIN);
                    stile::font(list, 15, stile::MAIN);
                    lvgl_sys::lv_obj_set_style_max_height(list, screen_size().1 / 2, stile::MAIN);
                }
            }
        } else {
            label(r, &t.timezone, 16, TEXT);
        }
        let r = row(c, &cp::word(lang, "dateTime", &[]));
        if t.ntp {
            wrap(
                label(r, &cp::word(lang, "manualOnlyWhenOff", &[]), 14, MUTED),
                300,
            );
            return None;
        }
        match &s.manual_time {
            None => {
                let b = button(r, &cp::word(lang, "change", &[]), PANEL2, TEXT, 15);
                self.on(b, Action::ManualStart);
                None
            }
            Some(m) => {
                let date_bad = m.date.len() == 10
                    && chrono::NaiveDate::parse_from_str(&m.date, "%Y-%m-%d").is_err();
                let f0 = self.text_field(r, &m.date, 150, m.focus == 0, date_bad);
                self.on(f0, Action::ManualFocus(0));
                let f1 = self.text_field(r, &m.time, 90, m.focus == 1, false);
                self.on(f1, Action::ManualFocus(1));
                Some(if m.focus == 0 { f0 } else { f1 })
            }
        }
    }

    // ── Wi-Fi ────────────────────────────────────────────────────────────────

    unsafe fn wifi(&mut self, main: P, s: &State, lang: &str) -> Option<P> {
        let Some(wf) = &s.wifi else {
            label(main, &cp::word(lang, "loading", &[]), 15, MUTED);
            return None;
        };
        let Some(card_name) = &wf.card else {
            card(main, |c| {
                wrap(
                    label(c, &cp::word(lang, "noWifiCard", &[]), 15, TEXT),
                    pct(100),
                );
            });
            return None;
        };
        let pending = s.pending.is_some();
        let hotspot_on = wf.mode == "hotspot";
        // Typing: only the form, so that the keyboard below leaves it in view.
        if let Some(f) = &s.wifi_form {
            return self.wifi_form(main, f, lang);
        }

        let c = card(main, |_| {});
        let r = row(c, &cp::word(lang, "wifiCard", &[]));
        dot(
            r,
            if pending {
                WARN
            } else if wf.mode == "client" || hotspot_on {
                OK
            } else {
                LINE
            },
        );
        let mut line = format!(
            "{card_name} · {}",
            cp::word(lang, &format!("wifiState.{}", wf.mode), &[])
        );
        if let Some(ssid) = &wf.active_ssid {
            line.push_str(&format!(" · {ssid}"));
        }
        label(r, &line, 16, TEXT);
        let r = row(c, &cp::word(lang, "radio", &[]));
        self.segmented(
            r,
            &[
                (cp::word(lang, "on", &[]), wf.radio, Action::WifiRadio(true)),
                (
                    cp::word(lang, "off", &[]),
                    !wf.radio,
                    Action::WifiRadio(false),
                ),
            ],
        );

        if wf.radio && !hotspot_on {
            let c = card(main, |_| {});
            let head = transparent(c);
            lvgl_sys::lv_obj_set_size(head, pct(100), LV_SIZE_CONTENT);
            flex(head, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 8);
            center_items(head);
            let t = label(head, &cp::word(lang, "networks", &[]), 16, TEXT);
            lvgl_sys::lv_obj_set_flex_grow(t, 1);
            let b = button(
                head,
                &cp::word(lang, "hiddenNetwork", &[]),
                PANEL2,
                TEXT,
                14,
            );
            self.on(b, Action::WifiJoin(None));
            let b = button(head, &cp::word(lang, "scan", &[]), PANEL2, TEXT, 14);
            self.on(b, Action::WifiScan);
            if wf.networks.is_empty() {
                label(c, &cp::word(lang, "noNetworks", &[]), 15, MUTED);
            }
            for n in &wf.networks {
                let r = transparent(c);
                // A fixed height: LVGL 8 does not centre the items of a row
                // that only has a minimum one.
                lvgl_sys::lv_obj_set_size(r, pct(100), 50);
                lvgl_sys::lv_obj_set_style_border_side(
                    r,
                    lvgl_sys::LV_BORDER_SIDE_TOP as u8,
                    stile::MAIN,
                );
                stile::bordo(r, Some(LINE), 1.0, stile::MAIN);
                flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 10);
                center_items(r);
                let enterprise = n.security == "enterprise";
                if enterprise {
                    lvgl_sys::lv_obj_set_style_opa(r, 128, stile::MAIN);
                }
                bars(r, n.signal);
                let name = label(r, &n.ssid, 16, TEXT);
                lvgl_sys::lv_obj_set_style_max_width(name, 260, stile::MAIN);
                label(
                    r,
                    &cp::word(lang, &format!("security.{}", n.security), &[]),
                    13,
                    MUTED,
                );
                if n.active {
                    tag(r, &cp::word(lang, "connected", &[]), true);
                } else if n.known {
                    tag(r, &cp::word(lang, "saved", &[]), false);
                }
                spacer(r);
                if n.known && !n.active {
                    let b = button(r, &cp::word(lang, "forget", &[]), PANEL2, MUTED, 14);
                    self.on(b, Action::WifiForget(n.ssid.clone()));
                }
                if !n.active && !enterprise && !pending {
                    let b = button(r, &cp::word(lang, "join", &[]), PANEL2, TEXT, 14);
                    if s.busy {
                        dim(b);
                    } else {
                        self.on(b, Action::WifiJoin(Some(n.ssid.clone())));
                    }
                }
            }
        }

        let c = card(main, |_| {});
        let head = transparent(c);
        lvgl_sys::lv_obj_set_size(head, pct(100), LV_SIZE_CONTENT);
        flex(head, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 8);
        center_items(head);
        label(head, &cp::word(lang, "hotspot", &[]), 16, TEXT);
        if hotspot_on {
            tag(head, &cp::word(lang, "on", &[]), true);
        }
        spacer(head);
        if !wf.can_hotspot {
            wrap(
                label(c, &cp::word(lang, "hotspotCannot", &[]), 14, MUTED),
                pct(100),
            );
            return None;
        }
        if s.hotspot.is_some() && !pending {
            if hotspot_on {
                let b = button(
                    head,
                    &cp::word(lang, "hotspotTurnOff", &[]),
                    PANEL2,
                    TEXT,
                    14,
                );
                self.on(b, Action::HotspotOff);
            } else {
                let b = button(
                    head,
                    &cp::word(lang, "hotspotTurnOn", &[]),
                    ACCENT,
                    (255, 255, 255),
                    14,
                );
                self.on(b, Action::HotspotStart);
            }
        }
        wrap(
            label(
                c,
                &format!(
                    "{} {}",
                    cp::word(lang, "hotspotHelp", &[]),
                    cp::word(lang, "hotspotExcludes", &[])
                ),
                14,
                MUTED,
            ),
            pct(100),
        );
        if let (true, Some(h)) = (hotspot_on, &s.hotspot) {
            let r = transparent(c);
            lvgl_sys::lv_obj_set_size(r, pct(100), LV_SIZE_CONTENT);
            flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 18);
            center_items(r);
            qr(r, &h.qr, 140);
            let col = transparent(r);
            lvgl_sys::lv_obj_set_size(col, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
            flex(col, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 4);
            label(col, &cp::word(lang, "hotspotScan", &[]), 14, MUTED);
            label(
                col,
                &format!("{}: {}", cp::word(lang, "ssid", &[]), h.ssid),
                16,
                TEXT,
            );
            label(
                col,
                &format!("{}: {}", cp::word(lang, "password", &[]), h.password),
                16,
                TEXT,
            );
        }
        None
    }

    /// SSID and password, typed on the keyboard below.
    unsafe fn wifi_form(&mut self, main: P, f: &cp::WifiForm, lang: &str) -> Option<P> {
        let c = card(main, |_| {});
        stile::bordo(c, Some(ACCENT), 1.0, stile::MAIN);
        let r = row(c, &cp::word(lang, "ssid", &[]));
        let mut focused = None;
        if f.ssid_editable {
            let bad = f.ssid.len() > 32;
            let t = self.text_field(r, &f.ssid, 260, f.focus == 0, bad);
            self.on(t, Action::FormFocus(0));
            if f.focus == 0 {
                focused = Some(t);
            }
        } else {
            label(r, &f.ssid, 16, TEXT);
        }
        let r = row(c, &cp::word(lang, "password", &[]));
        let shown = if f.reveal {
            f.password.clone()
        } else {
            "•".repeat(f.password.chars().count())
        };
        let bad = !f.password.is_empty() && !cp::is_psk(&f.password);
        let t = self.text_field(r, &shown, 260, f.focus == 1, bad);
        self.on(t, Action::FormFocus(1));
        if f.focus == 1 {
            focused = Some(t);
        }
        let b = button(
            r,
            &cp::word(lang, if f.reveal { "hide" } else { "show" }, &[]),
            PANEL2,
            TEXT,
            14,
        );
        self.on(b, Action::FormKey("👁".into()));
        if bad {
            label(
                c,
                &cp::word(lang, "passwordShort", &[]),
                13,
                (241, 176, 173),
            );
        } else if f.hotspot && f.proposed {
            label(c, &cp::word(lang, "hotspotProposed", &[]), 13, MUTED);
        }
        focused
    }

    /// Letters, capitals and symbols, then Cancel and Done (join, or turn the
    /// hotspot on): four rows over the bottom of the section.
    unsafe fn keyboard(&mut self, root: P, x: i16, w: i16, h: i16, f: &cp::WifiForm, lang: &str) {
        const LETTERS: [&str; 3] = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
        const SYMBOLS: [&str; 3] = ["1234567890", "-_@#&*+=()", ".,:;!?'\"/"];
        let k = panel_box(root, (20, 24, 29));
        stile::raggio(k, 0.0, stile::MAIN);
        lvgl_sys::lv_obj_set_style_border_side(k, lvgl_sys::LV_BORDER_SIDE_TOP as u8, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(k, x, screen_size().1 - h);
        lvgl_sys::lv_obj_set_size(k, w, h);
        stile::margini(k, 6, 8, stile::MAIN);
        flex(k, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 5);
        let kh = (h - 12 - 3 * 5) / 4;
        let kw = (w - 16 - 9 * 5) / 10;
        let rows = if f.symbols { SYMBOLS } else { LETTERS };
        for (i, keys) in rows.iter().enumerate() {
            let r = transparent(k);
            lvgl_sys::lv_obj_set_size(r, pct(100), kh);
            flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 5);
            lvgl_sys::lv_obj_set_flex_align(
                r,
                lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
                lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
                lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
            );
            if i == 2 && !f.symbols {
                let b = button(r, "⇧", if f.shift { ACCENT } else { PANEL2 }, TEXT, 18);
                lvgl_sys::lv_obj_set_size(b, kw * 3 / 2, kh);
                self.on(b, Action::FormKey("⇧".into()));
            }
            for c in keys.chars() {
                let ch = if f.shift && !f.symbols {
                    c.to_ascii_uppercase()
                } else {
                    c
                };
                let b = button(r, &ch.to_string(), PANEL2, TEXT, 18);
                lvgl_sys::lv_obj_set_size(b, kw, kh);
                stile::margini(b, 0, 0, stile::MAIN);
                self.on(b, Action::FormKey(ch.to_string()));
            }
            if i == 2 {
                let b = button(r, "⌫", PANEL2, TEXT, 18);
                lvgl_sys::lv_obj_set_size(b, kw * 3 / 2, kh);
                self.on(b, Action::FormKey("⌫".into()));
            }
        }
        let r = transparent(k);
        lvgl_sys::lv_obj_set_size(r, pct(100), kh);
        flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 5);
        let toggle = if f.symbols { "kbLetters" } else { "kbSymbols" };
        let b = button(r, &cp::word(lang, toggle, &[]), PANEL2, TEXT, 14);
        lvgl_sys::lv_obj_set_size(b, kw * 3 / 2, kh);
        self.on(
            b,
            Action::FormKey(if f.symbols { "abc" } else { "?123" }.into()),
        );
        let b = button(r, &cp::word(lang, "kbSpace", &[]), PANEL2, MUTED, 14);
        lvgl_sys::lv_obj_set_height(b, kh);
        lvgl_sys::lv_obj_set_flex_grow(b, 1);
        self.on(b, Action::FormKey(" ".into()));
        let b = button(r, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 14);
        lvgl_sys::lv_obj_set_size(b, kw * 2, kh);
        self.on(b, Action::FormCancel);
        let done = if f.hotspot { "hotspotTurnOn" } else { "join" };
        let b = button(r, &cp::word(lang, done, &[]), ACCENT, (255, 255, 255), 14);
        lvgl_sys::lv_obj_set_size(b, kw * 3, kh);
        if f.valid() {
            self.on(b, Action::FormSubmit);
        } else {
            dim(b);
        }
    }

    // ── Screen ───────────────────────────────────────────────────────────────

    unsafe fn screen(&mut self, main: P, s: &State, lang: &str, caps: &cp::Capabilities) {
        if let Some(note) = s.calibration_note {
            card(main, |c| {
                wrap(label(c, &cp::word(lang, note, &[]), 15, TEXT), pct(100));
            });
        }
        if caps.display {
            let c = card(main, |_| {});
            match s.brightness {
                None => {
                    label(c, &cp::word(lang, "loading", &[]), 15, MUTED);
                }
                Some(b) => {
                    let r = row(c, &cp::word(lang, "brightness", &[]));
                    self.segmented(
                        r,
                        &[
                            (
                                cp::word(lang, "brightnessProject", &[]),
                                b.is_none(),
                                Action::BrightnessMode(false),
                            ),
                            (
                                cp::word(lang, "brightnessHere", &[]),
                                b.is_some(),
                                Action::BrightnessMode(true),
                            ),
                        ],
                    );
                    if b.is_some() {
                        let r = row(c, "");
                        let sl = lvgl_sys::lv_slider_create(r);
                        let value = label(r, &format!("{} %", s.brightness_draft), 16, TEXT);
                        if !sl.is_null() {
                            lvgl_sys::lv_obj_set_width(sl, 300);
                            lvgl_sys::lv_bar_set_range(sl, 5, 100);
                            lvgl_sys::lv_bar_set_value(
                                sl,
                                s.brightness_draft as i32,
                                lvgl_sys::lv_anim_enable_t_LV_ANIM_OFF,
                            );
                            stile::sfondo(sl, LINE, stile::MAIN);
                            stile::sfondo(sl, ACCENT, stile::INDICATORE);
                            stile::sfondo(sl, TEXT, lvgl_sys::LV_PART_KNOB);
                            // A finger is not a mouse: room around the knob.
                            lvgl_sys::lv_obj_set_ext_click_area(sl, 20);
                            for code in [
                                lvgl_sys::lv_event_code_t_LV_EVENT_VALUE_CHANGED,
                                lvgl_sys::lv_event_code_t_LV_EVENT_RELEASED,
                            ] {
                                lvgl_sys::lv_obj_add_event_cb(
                                    sl,
                                    Some(sws_control_panel_slider_cb),
                                    code,
                                    value as *mut c_void,
                                );
                            }
                        }
                    }
                    wrap(
                        label(c, &cp::word(lang, "brightnessHelp", &[]), 13, MUTED),
                        pct(100),
                    );
                }
            }
        }
        let resistive = crate::touch_calibration::resistive();
        if resistive || caps.touch_calibration_service {
            let c = card(main, |_| {});
            let r = row(c, &cp::word(lang, "calibration", &[]));
            if resistive {
                label(r, &cp::word(lang, "calibrationResistive", &[]), 15, MUTED);
            }
            let b = button(r, &cp::word(lang, "calibrate", &[]), PANEL2, TEXT, 15);
            self.on(
                b,
                if resistive {
                    Action::CalibrateStart
                } else {
                    Action::PixsysCalibration
                },
            );
        }
    }

    /// The crosses, the try and the failure: on top of the panel, the whole
    /// screen. While the crosses show the touch does not reach LVGL, so there
    /// are no buttons: 30 s without touches give up.
    unsafe fn build_calibration(&mut self, s: &State, lang: &str) {
        let (w, h) = screen_size();
        let root = full_screen((0, 0, 0));
        self.root = Some(root);
        let msg = |text: &str, y: i16| {
            let l = label(root, text, 17, TEXT);
            wrap(l, w - 160);
            lvgl_sys::lv_obj_set_style_text_align(
                l,
                lvgl_sys::LV_TEXT_ALIGN_CENTER as u8,
                stile::MAIN,
            );
            lvgl_sys::lv_obj_align(l, lvgl_sys::LV_ALIGN_TOP_MID as lvgl_sys::lv_align_t, 0, y);
        };
        match s.calibration {
            Some(cp::Calibration::Cross(n)) => {
                let (tx, ty) = crate::touch_calibration::targets(w as i32, h as i32)[n.min(4)];
                for (bw, bh) in [(40i16, 2i16), (2, 40)] {
                    let line = transparent(root);
                    stile::sfondo(line, (255, 255, 255), stile::MAIN);
                    lvgl_sys::lv_obj_set_size(line, bw, bh);
                    lvgl_sys::lv_obj_set_pos(line, tx as i16 - bw / 2, ty as i16 - bh / 2);
                }
                let ring = transparent(root);
                lvgl_sys::lv_obj_set_size(ring, 16, 16);
                stile::raggio(ring, 8.0, stile::MAIN);
                stile::bordo(ring, Some(ACCENT), 2.0, stile::MAIN);
                lvgl_sys::lv_obj_set_pos(ring, tx as i16 - 8, ty as i16 - 8);
                msg(
                    &format!(
                        "{}\n{}",
                        cp::word(lang, "calibrationCross", &[("n", &(n + 1).to_string())]),
                        cp::word(lang, "calibrationHelp", &[])
                    ),
                    h / 2 - 90,
                );
            }
            Some(cp::Calibration::Trying { .. }) => {
                msg(&cp::word(lang, "calibrationTry", &[]), 60);
                for (tx, ty) in crate::touch_calibration::targets(w as i32, h as i32) {
                    let d = transparent(root);
                    lvgl_sys::lv_obj_set_size(d, 6, 6);
                    stile::raggio(d, 3.0, stile::MAIN);
                    stile::sfondo(d, MUTED, stile::MAIN);
                    lvgl_sys::lv_obj_set_pos(d, tx as i16 - 3, ty as i16 - 3);
                }
                let d = transparent(root);
                lvgl_sys::lv_obj_set_size(d, 24, 24);
                stile::raggio(d, 12.0, stile::MAIN);
                stile::sfondo(d, ACCENT, stile::MAIN);
                lvgl_sys::lv_obj_add_flag(d, lvgl_sys::LV_OBJ_FLAG_HIDDEN);
                self.ticks.push((d, Tick::CalibrationDot));
                self.calibration_buttons(root, lang, true);
            }
            _ => {
                msg(&cp::word(lang, "calibrationFailed", &[]), h / 2 - 60);
                self.calibration_buttons(root, lang, false);
            }
        }
    }

    unsafe fn calibration_buttons(&mut self, root: P, lang: &str, can_save: bool) {
        let r = transparent(root);
        lvgl_sys::lv_obj_set_size(r, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
        flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 14);
        lvgl_sys::lv_obj_align(
            r,
            lvgl_sys::LV_ALIGN_BOTTOM_MID as lvgl_sys::lv_align_t,
            0,
            -110,
        );
        let b = button(r, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 16);
        self.on(b, Action::CalibrateCancel);
        let b = button(r, &cp::word(lang, "redo", &[]), PANEL2, TEXT, 16);
        self.on(b, Action::CalibrateRedo);
        if can_save {
            let b = button(r, &cp::word(lang, "save", &[]), ACCENT, (255, 255, 255), 16);
            self.on(b, Action::CalibrateSave);
        }
    }

    unsafe fn device(&mut self, main: P, s: &State, lang: &str, caps: &cp::Capabilities) {
        let c = card(main, |_| {});
        let Some(i) = &s.info else {
            label(c, &cp::word(lang, "loading", &[]), 15, MUTED);
            return;
        };
        for (key, value) in [
            ("model", i.model.clone()),
            ("serial", i.serial.clone()),
            ("hostname", Some(i.hostname.clone())),
            ("swsVersion", Some(i.sws_version.clone())),
        ] {
            let r = row(c, &cp::word(lang, key, &[]));
            label(r, value.as_deref().unwrap_or("—"), 16, TEXT);
        }
        if let Some(pin) = &i.initial_pin {
            let r = row(c, &cp::word(lang, "pin", &[]));
            label(r, pin, 16, TEXT);
            tag(r, &cp::word(lang, "pinInitial", &[]), false);
            let w = label(
                c,
                &cp::word(lang, "pinInitialWarning", &[]),
                14,
                (240, 201, 122),
            );
            wrap(w, pct(100));
        }

        let c = card(main, |_| {});
        match s.ask {
            Some(p) => {
                let (ask, act) = match p {
                    Power::Reboot => ("rebootAsk", "reboot"),
                    Power::PowerOff => ("powerOffAsk", "powerOff"),
                };
                wrap(label(c, &cp::word(lang, ask, &[]), 16, TEXT), pct(100));
                let r = actions(c);
                let b = button(r, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 15);
                self.on(b, Action::Ask(None));
                let b = button(r, &cp::word(lang, act, &[]), BAD, (255, 255, 255), 15);
                self.on(b, Action::Power(p));
            }
            None => {
                let r = actions(c);
                lvgl_sys::lv_obj_set_flex_align(
                    r,
                    lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_START,
                    lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
                    lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
                );
                if caps.reboot {
                    let b = button(r, &cp::word(lang, "reboot", &[]), PANEL2, TEXT, 15);
                    self.on(b, Action::Ask(Some(Power::Reboot)));
                }
                if caps.power_off {
                    let b = button(
                        r,
                        &cp::word(lang, "powerOff", &[]),
                        PANEL2,
                        (241, 176, 173),
                        15,
                    );
                    self.on(b, Action::Ask(Some(Power::PowerOff)));
                }
            }
        }
    }
}

impl Drop for Overlay {
    fn drop(&mut self) {
        self.destroy();
        if let Some(r) = self.ring.take() {
            unsafe { lvgl_sys::lv_obj_del(r) };
        }
    }
}

// ── Small pieces ─────────────────────────────────────────────────────────────

fn layer() -> P {
    unsafe { lvgl_sys::lv_disp_get_layer_sys(core::ptr::null_mut()) }
}

fn screen_size() -> (i16, i16) {
    unsafe {
        (
            lvgl_sys::lv_disp_get_hor_res(core::ptr::null_mut()),
            lvgl_sys::lv_disp_get_ver_res(core::ptr::null_mut()),
        )
    }
}

/// No theme padding, border or scrolling: what is drawn is what is styled.
unsafe fn plain(p: P) {
    stile::margini(p, 0, 0, stile::MAIN);
    stile::bordo(p, None, 0.0, stile::MAIN);
    stile::raggio(p, 0.0, stile::MAIN);
    stile::trasparente(p, stile::MAIN);
    lvgl_sys::lv_obj_clear_flag(p, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
    lvgl_sys::lv_obj_clear_flag(p, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
}

unsafe fn full_screen(bg: Rgb) -> P {
    let r = lvgl_sys::lv_obj_create(layer());
    plain(r);
    let (w, h) = screen_size();
    lvgl_sys::lv_obj_set_pos(r, 0, 0);
    lvgl_sys::lv_obj_set_size(r, w, h);
    stile::sfondo(r, bg, stile::MAIN);
    // It takes every touch: nothing reaches the page below.
    lvgl_sys::lv_obj_add_flag(r, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
    r
}

unsafe fn transparent(parent: P) -> P {
    let p = lvgl_sys::lv_obj_create(parent);
    plain(p);
    p
}

unsafe fn panel_box(parent: P, bg: Rgb) -> P {
    let p = transparent(parent);
    stile::sfondo(p, bg, stile::MAIN);
    stile::bordo(p, Some(LINE), 1.0, stile::MAIN);
    stile::raggio(p, 8.0, stile::MAIN);
    p
}

unsafe fn flex(p: P, flow: lvgl_sys::lv_flex_flow_t, gap: i16) {
    lvgl_sys::lv_obj_set_flex_flow(p, flow);
    lvgl_sys::lv_obj_set_style_pad_row(p, gap, stile::MAIN);
    lvgl_sys::lv_obj_set_style_pad_column(p, gap, stile::MAIN);
}

unsafe fn center_items(p: P) {
    lvgl_sys::lv_obj_set_flex_align(
        p,
        lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_START,
        lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
        lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
    );
}

unsafe fn label(parent: P, text: &str, px: u16, rgb: Rgb) -> P {
    let l = lvgl_sys::lv_label_create(parent);
    if !l.is_null() {
        testo_etichetta(l, text_cstring(text).as_ptr());
        stile::testo(l, rgb, stile::MAIN);
        stile::font(l, px, stile::MAIN);
    }
    l
}

unsafe fn wrap(l: P, width: i16) {
    if !l.is_null() {
        lvgl_sys::lv_label_set_long_mode(l, lvgl_sys::LV_LABEL_LONG_WRAP as u8);
        lvgl_sys::lv_obj_set_width(l, width);
    }
}

unsafe fn button_style(b: P, bg: Rgb, border: Rgb) {
    stile::sfondo(b, bg, stile::MAIN);
    stile::bordo(b, Some(border), 1.0, stile::MAIN);
    stile::raggio(b, 6.0, stile::MAIN);
    lvgl_sys::lv_obj_set_style_shadow_width(b, 0, stile::MAIN);
}

unsafe fn button(parent: P, text: &str, bg: Rgb, fg: Rgb, px: u16) -> P {
    let b = lvgl_sys::lv_btn_create(parent);
    button_style(b, bg, if bg == PANEL2 { LINE } else { bg });
    lvgl_sys::lv_obj_set_size(b, LV_SIZE_CONTENT, 42);
    stile::margini(b, 0, 16, stile::MAIN);
    let l = label(b, text, px, fg);
    lvgl_sys::lv_obj_align(l, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
    b
}

/// A button that cannot be pressed now.
unsafe fn dim(b: P) {
    lvgl_sys::lv_obj_set_style_opa(b, 128, stile::MAIN);
    lvgl_sys::lv_obj_clear_flag(b, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
}

unsafe fn card(parent: P, fill: impl FnOnce(P)) -> P {
    let c = panel_box(parent, PANEL);
    lvgl_sys::lv_obj_set_size(c, pct(100), LV_SIZE_CONTENT);
    stile::margini(c, 12, 16, stile::MAIN);
    flex(c, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 2);
    fill(c);
    c
}

/// A labelled row: the label on the left, what follows on the right.
unsafe fn row(parent: P, text: &str) -> P {
    let r = transparent(parent);
    lvgl_sys::lv_obj_set_size(r, pct(100), LV_SIZE_CONTENT);
    lvgl_sys::lv_obj_set_style_min_height(r, 44, stile::MAIN);
    flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 10);
    center_items(r);
    let l = label(r, text, 14, MUTED);
    lvgl_sys::lv_obj_set_width(l, 140);
    r
}

/// The buttons of a card, on the right.
unsafe fn actions(parent: P) -> P {
    let r = transparent(parent);
    lvgl_sys::lv_obj_set_size(r, pct(100), LV_SIZE_CONTENT);
    stile::margini(r, 6, 0, stile::MAIN);
    flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 10);
    lvgl_sys::lv_obj_set_flex_align(
        r,
        lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_END,
        lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
        lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
    );
    r
}

/// Pushes what follows to the right of a flex row. One pixel high: LVGL's
/// default object size would make the row 100 px tall.
unsafe fn spacer(parent: P) {
    let s = transparent(parent);
    lvgl_sys::lv_obj_set_size(s, 1, 1);
    lvgl_sys::lv_obj_set_flex_grow(s, 1);
}

unsafe fn dot(parent: P, rgb: Rgb) {
    let d = lvgl_sys::lv_obj_create(parent);
    plain(d);
    lvgl_sys::lv_obj_set_size(d, 10, 10);
    stile::raggio(d, 5.0, stile::MAIN);
    stile::sfondo(d, rgb, stile::MAIN);
}

/// Four bars of signal, as on a phone.
unsafe fn bars(parent: P, signal: u8) {
    let n = match signal {
        75.. => 4,
        50.. => 3,
        25.. => 2,
        _ => 1,
    };
    let b = transparent(parent);
    lvgl_sys::lv_obj_set_size(b, 4 * 4 + 3 * 2, 16);
    for i in 1..=4i16 {
        let bar = transparent(b);
        lvgl_sys::lv_obj_set_size(bar, 4, 4 * i);
        lvgl_sys::lv_obj_set_pos(bar, (i - 1) * 6, 16 - 4 * i);
        stile::sfondo(bar, if i <= n { TEXT } else { LINE }, stile::MAIN);
    }
}

/// The joining QR of the hotspot. `lv_qrcode` keeps a canvas in the LVGL heap
/// (`size`² × 2 bytes, 39 KB at 140): freed with the panel.
unsafe fn qr(parent: P, text: &str, size: i16) {
    let dark: lvgl_sys::lv_color_t = Color::from_rgb((0, 0, 0)).into();
    let light: lvgl_sys::lv_color_t = Color::from_rgb((255, 255, 255)).into();
    // A white frame: phones read a QR badly without its quiet zone.
    let frame = transparent(parent);
    stile::sfondo(frame, (255, 255, 255), stile::MAIN);
    stile::raggio(frame, 6.0, stile::MAIN);
    lvgl_sys::lv_obj_set_size(frame, size + 16, size + 16);
    let q = lvgl_sys::lv_qrcode_create(frame, size, dark, light);
    if q.is_null() {
        return;
    }
    lvgl_sys::lv_obj_align(q, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
    lvgl_sys::lv_qrcode_update(q, text.as_ptr().cast(), text.len() as u32);
}

unsafe fn tag(parent: P, text: &str, ok: bool) {
    let t = transparent(parent);
    lvgl_sys::lv_obj_set_size(t, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    stile::raggio(t, 10.0, stile::MAIN);
    stile::margini(t, 2, 8, stile::MAIN);
    stile::sfondo(t, if ok { (34, 56, 48) } else { (61, 52, 33) }, stile::MAIN);
    label(
        t,
        text,
        12,
        if ok { (143, 214, 173) } else { (240, 201, 122) },
    );
}
