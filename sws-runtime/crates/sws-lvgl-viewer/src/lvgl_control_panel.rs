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
/// Under this width the panel is laid out for a narrow screen: a portrait
/// project (600×1024 on the 7", 480×800 on the 5") has no room for a menu on
/// the left. The menu becomes a bar of tabs under the header.
const NARROW_W: i16 = 700;
const TABS_H: i16 = 48;
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
    NtpServersMode(bool),
    NtpServersEdit,
    DiagnosticsUsb,
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
    PanelCorner(cp::RebootCorner),
    ResetAsk(bool),
    ResetCancel,
    PanelHold(i8),
    PanelSize(i16),
    Flip(bool),
    RebootCorner(cp::RebootCorner),
    RebootHold(i8),
    RebootSize(i16),
    RebootConfirm(bool),
    RebootAnswer(bool),
    TzOpen,
    TzCancel,
    TzBack(u8),
    TzContinent(&'static str),
    TzCountry(String),
    TzPick(String),
    TzFocus,
    TzKey(String),
}

unsafe extern "C" fn sws_control_panel_cb(e: *mut lvgl_sys::lv_event_t) {
    let data = lvgl_sys::lv_event_get_user_data(e);
    if data.is_null() {
        return;
    }
    // A key acts on the press, and the next frame rebuilds the panel: the
    // deleted key resets the touch, and the key rebuilt under the still-down
    // finger gets a press of its own — the same character again, a frame at a
    // time (TY570, 16-11-2026: «la tastiera prende un sacco di false
    // pressioni»). One press per touch: nothing more until the finger lifts.
    if lvgl_sys::lv_event_get_code(e) == lvgl_sys::lv_event_code_t_LV_EVENT_PRESSED {
        let indev = lvgl_sys::lv_indev_get_act();
        if !indev.is_null() {
            lvgl_sys::lv_indev_wait_release(indev);
        }
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
        Action::NtpServersMode(manual) => cp::ntp_servers_mode(*manual),
        Action::NtpServersEdit => cp::ntp_servers_edit(),
        Action::DiagnosticsUsb => cp::diagnostics_to_usb(),
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
        Action::TzOpen => cp::tz_open(),
        Action::TzCancel => cp::tz_cancel(),
        Action::TzBack(step) => cp::tz_back(*step),
        Action::TzContinent(c) => cp::tz_continent(c),
        Action::TzCountry(code) => cp::tz_country(code),
        Action::TzPick(zone) => cp::tz_pick(zone),
        Action::TzFocus => cp::tz_focus(),
        Action::TzKey(k) => cp::tz_key(k),
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
        Action::PanelCorner(c) => cp::panel_corner_set(*c),
        Action::ResetAsk(keep_cloud) => cp::reset_ask(*keep_cloud),
        Action::ResetCancel => cp::reset_cancel(),
        Action::PanelHold(d) => cp::panel_hold_step(*d),
        Action::PanelSize(d) => cp::panel_size_step(*d),
        Action::Flip(on) => cp::flip_set(*on),
        Action::RebootCorner(c) => cp::reboot_corner_set(*c),
        Action::RebootHold(d) => cp::reboot_hold_step(*d),
        Action::RebootSize(d) => cp::reboot_size_step(*d),
        Action::RebootConfirm(on) => cp::reboot_confirm_set(*on),
        Action::RebootAnswer(yes) => cp::reboot_answer(*yes),
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
    /// The scrolling area of the section on screen, and how far it was
    /// scrolled when the panel was last rebuilt: a tap on a choice redraws
    /// everything, and must not jump back to the top.
    main: Option<(P, Section)>,
    scrolled: Option<(Section, i16)>,
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
                    Screen::Closed if s.rebooting || s.reboot_ask.is_some() => {
                        self.build_reboot_corner(s, lang)
                    }
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
        self.scrolled = self
            .main
            .take()
            .map(|(m, section)| (section, unsafe { lvgl_sys::lv_obj_get_scroll_y(m) }));
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

    /// A key of a keypad or keyboard: it acts when pressed, not when released.
    /// Every key changes the state and the next frame rebuilds the panel, so a
    /// key typed quickly could be rebuilt under the finger between press and
    /// release, and its click was lost (TY570, 14-11-2026: «il tastierino del
    /// PIN spesso perde la pressione del tasto»). The keyboards' Cancel and
    /// Done too: a finger that moves a pixel turned their click into a drag,
    /// and «Connect» on the Wi-Fi keyboard took dozens of presses (TY570,
    /// 16-11-2026). Lists that scroll stay on `on`: a click does not fire
    /// after a drag, a press would.
    unsafe fn on_press(&mut self, p: P, a: Action) {
        let ctx = Box::into_raw(Box::new(a));
        self.ctxs.push(ctx);
        lvgl_sys::lv_obj_add_event_cb(
            p,
            Some(sws_control_panel_cb),
            lvgl_sys::lv_event_code_t_LV_EVENT_PRESSED,
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
                (Some((f, corner, reboot)), ring) => {
                    let arc = match ring {
                        Some(a) => a,
                        None => {
                            let a = lvgl_sys::lv_arc_create(lvgl_sys::lv_disp_get_layer_sys(
                                core::ptr::null_mut(),
                            ));
                            if a.is_null() {
                                return;
                            }
                            // Wider than the finger that covers the corner:
                            // about 3 cm on a 7" screen.
                            let (w, h) = screen_size();
                            let d = (w.min(h) / 3).max(64);
                            lvgl_sys::lv_obj_set_size(a, d, d);
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
                            lvgl_sys::lv_obj_set_style_arc_width(a, 12, stile::MAIN);
                            lvgl_sys::lv_obj_set_style_arc_width(a, 12, stile::INDICATORE);
                            self.ring = Some(a);
                            a
                        }
                    };
                    // In the corner the finger is in: red where it reboots.
                    let (align, dx, dy) = match corner {
                        cp::RebootCorner::TopLeft => (lvgl_sys::LV_ALIGN_TOP_LEFT, 10, 10),
                        cp::RebootCorner::BottomLeft => (lvgl_sys::LV_ALIGN_BOTTOM_LEFT, 10, -10),
                        cp::RebootCorner::BottomRight => {
                            (lvgl_sys::LV_ALIGN_BOTTOM_RIGHT, -10, -10)
                        }
                        _ => (lvgl_sys::LV_ALIGN_TOP_RIGHT, -10, 10),
                    };
                    lvgl_sys::lv_obj_align(arc, align as lvgl_sys::lv_align_t, dx, dy);
                    // Red: it reboots. Green: it opens the panel.
                    let color = if reboot { BAD } else { OK };
                    lvgl_sys::lv_obj_set_style_arc_color(
                        arc,
                        Color::from_rgb(color).into(),
                        stile::INDICATORE,
                    );
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

    // ── Reboot corner ────────────────────────────────────────────────────────

    /// After the corner was held: the question, or the notice that the device
    /// is going down. Over the page, without a PIN: the corner has none.
    unsafe fn build_reboot_corner(&mut self, s: &State, lang: &str) {
        let (w, _) = screen_size();
        let root = full_screen(BG);
        lvgl_sys::lv_obj_set_style_bg_opa(root, lvgl_sys::LV_OPA_70 as u8, stile::MAIN);
        lvgl_sys::lv_obj_set_style_bg_color(root, Color::from_rgb((0, 0, 0)).into(), stile::MAIN);
        self.root = Some(root);
        let card = panel_box(root, PANEL);
        lvgl_sys::lv_obj_set_size(card, (w - 32).min(420), LV_SIZE_CONTENT);
        stile::margini(card, 16, 20, stile::MAIN);
        flex(card, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 12);
        lvgl_sys::lv_obj_align(
            card,
            lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t,
            0,
            0,
        );
        if s.rebooting {
            wrap(
                label(card, &cp::word(lang, "rebooting", &[]), 18, TEXT),
                pct(100),
            );
            return;
        }
        wrap(
            label(card, &cp::word(lang, "rebootAsk", &[]), 18, TEXT),
            pct(100),
        );
        let r = actions(card);
        let b = button(r, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 15);
        self.on(b, Action::RebootAnswer(false));
        let b = button(r, &cp::word(lang, "reboot", &[]), BAD, (255, 255, 255), 15);
        self.on(b, Action::RebootAnswer(true));
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
        label(
            card,
            &cp::word(
                lang,
                match (s.resetting, s.reset_keep_cloud) {
                    (true, true) => "resetKeepCloudTitle",
                    (true, false) => "resetTitle",
                    _ => "title",
                },
                &[],
            ),
            20,
            if s.resetting { BAD } else { TEXT },
        );
        let help = label(
            card,
            &cp::word(
                lang,
                match (s.resetting, s.reset_keep_cloud) {
                    (true, true) => "resetKeepCloudPinHelp",
                    (true, false) => "resetPinHelp",
                    _ => "pinHelp",
                },
                &[],
            ),
            14,
            MUTED,
        );
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
            self.on_press(b, Action::PinKey(k));
        }
        let cancel = button(keys, &cp::word(lang, "cancel", &[]), PANEL2, MUTED, 15);
        lvgl_sys::lv_obj_set_size(cancel, kw * 2 + 8, key_h);
        self.on(
            cancel,
            if s.resetting {
                Action::ResetCancel
            } else {
                Action::Close
            },
        );
        let back = button(keys, "⌫", PANEL2, MUTED, 18);
        lvgl_sys::lv_obj_set_size(back, kw, key_h);
        self.on_press(back, Action::PinBack);
        let enter = button(
            keys,
            &cp::word(
                lang,
                if s.resetting { "resetConfirm" } else { "enter" },
                &[],
            ),
            if s.resetting { BAD } else { ACCENT },
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
        let narrow = w < NARROW_W;
        // The width the menu takes from the sections: none when it is on top.
        let nav_w = if narrow { 0 } else { (w / 5).clamp(150, 220) };
        let top = HEADER_H + if narrow { TABS_H } else { 0 };

        // Header: title, host name, Close.
        let header = panel_box(root, PANEL);
        stile::raggio(header, 0.0, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(header, 0, 0);
        lvgl_sys::lv_obj_set_size(header, w, HEADER_H);
        stile::margini(header, 0, 16, stile::MAIN);
        flex(header, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 10);
        center_items(header);
        label(header, &cp::word(lang, "title", &[]), 19, TEXT);
        if let Some(i) = s.info.as_ref().filter(|_| !narrow) {
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
        if narrow {
            // A row of tabs, dragged sideways when they are more than fit.
            lvgl_sys::lv_obj_set_size(nav, w, TABS_H);
            flex(nav, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 0);
            lvgl_sys::lv_obj_add_flag(nav, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
            lvgl_sys::lv_obj_add_flag(nav, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
            lvgl_sys::lv_obj_set_scroll_dir(nav, lvgl_sys::LV_DIR_HOR as lvgl_sys::lv_dir_t);
            lvgl_sys::lv_obj_set_scrollbar_mode(
                nav,
                lvgl_sys::LV_SCROLLBAR_MODE_OFF as lvgl_sys::lv_scrollbar_mode_t,
            );
        } else {
            lvgl_sys::lv_obj_set_size(nav, nav_w, h - HEADER_H);
            stile::margini(nav, 10, 0, stile::MAIN);
            flex(nav, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 0);
        }
        let mut active_tab = None;
        let caps = s.caps.clone().unwrap_or(cp::Capabilities {
            network: true,
            time: true,
            ..Default::default()
        });
        // The resistive calibration is the viewer's: the runtime cannot know.
        // The corner that opens this panel is chosen there, on every device.
        let screen_on = true;
        let sections = [
            (Some(Section::Network), "network", caps.network),
            (Some(Section::Wifi), "wifi", caps.wifi),
            (Some(Section::Time), "time", caps.time),
            (Some(Section::Screen), "screen", screen_on),
            (Some(Section::Device), "device", true),
            (Some(Section::About), "about", true),
        ];
        for (section, key, on) in sections {
            let active = section == Some(s.section);
            let b = lvgl_sys::lv_obj_create(nav);
            plain(b);
            if narrow {
                lvgl_sys::lv_obj_set_size(b, LV_SIZE_CONTENT, TABS_H);
                stile::margini(b, 0, 16, stile::MAIN);
            } else {
                lvgl_sys::lv_obj_set_size(b, pct(100), 50);
                stile::margini(b, 0, 20, stile::MAIN);
            }
            if active {
                stile::sfondo(b, PANEL2, stile::MAIN);
                let side = if narrow {
                    lvgl_sys::LV_BORDER_SIDE_BOTTOM
                } else {
                    lvgl_sys::LV_BORDER_SIDE_LEFT
                };
                lvgl_sys::lv_obj_set_style_border_side(b, side as u8, stile::MAIN);
                stile::bordo(b, Some(ACCENT), 4.0, stile::MAIN);
                active_tab = Some(b);
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
        let typing_time = s.section == Section::Time && s.manual_time.is_some() && s.tz.is_none();
        let typing_ntp = s.section == Section::Time && s.ntp_form.is_some();
        let typing_text = typing_ntp
            || (s.section == Section::Wifi && s.wifi_form.as_ref().is_some_and(|f| !f.submitting));
        let typing_tz = s.section == Section::Time && s.tz.as_ref().is_some_and(|p| p.typing);
        let pending = matches!(s.section, Section::Network | Section::Wifi) && s.pending.is_some();
        let keypad_h: i16 = if h < 520 { 104 } else { 116 };
        let keyboard_h: i16 = if h < 520 { 196 } else { 220 };
        let bottom = if typing_ip || typing_time {
            keypad_h
        } else if typing_text || typing_tz {
            keyboard_h
        } else if pending {
            84
        } else {
            0
        };

        let main = transparent(root);
        lvgl_sys::lv_obj_set_pos(main, nav_w, top);
        lvgl_sys::lv_obj_set_size(main, w - nav_w, h - top - bottom);
        lvgl_sys::lv_obj_add_flag(main, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
        // It must take the finger too: cards and labels do not, and a drag
        // that lands on nothing scrolls nothing (TY570, 15-11-2026: Screen and
        // About were taller than the page and stayed still).
        lvgl_sys::lv_obj_add_flag(main, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
        lvgl_sys::lv_obj_set_scroll_dir(main, lvgl_sys::LV_DIR_VER as lvgl_sys::lv_dir_t);
        self.main = Some((main, s.section));
        stile::margini(main, 14, if narrow { 10 } else { 18 }, stile::MAIN);
        flex(main, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 12);
        // The tab of the section on screen, in view among the others.
        if let Some(tab) = active_tab.filter(|_| narrow) {
            lvgl_sys::lv_obj_update_layout(nav);
            lvgl_sys::lv_obj_scroll_to_view(tab, lvgl_sys::lv_anim_enable_t_LV_ANIM_OFF);
        }

        if let Some(e) = &s.error {
            let c = panel_box(main, PANEL);
            stile::bordo(c, Some(BAD), 1.0, stile::MAIN);
            lvgl_sys::lv_obj_set_size(c, pct(100), LV_SIZE_CONTENT);
            stile::margini(c, 10, 14, stile::MAIN);
            wrap(
                label(c, &cp::error_text(e, lang), 15, (241, 176, 173)),
                pct(100),
            );
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
            Section::About => self.about(main, s, lang),
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
        } else if typing_ntp {
            let f = s.ntp_form.as_ref().expect("typing_ntp");
            let keys = Keys {
                shift: f.shift,
                symbols: f.symbols,
                done: cp::word(lang, "apply", &[]),
                valid: f.valid(),
            };
            self.keyboard(root, nav_w, w - nav_w, keyboard_h, &keys, lang);
        } else if typing_text {
            let f = s.wifi_form.as_ref().expect("typing_text");
            let done = if f.hotspot { "hotspotTurnOn" } else { "join" };
            let keys = Keys {
                shift: f.shift,
                symbols: f.symbols,
                done: cp::word(lang, done, &[]),
                valid: f.valid(),
            };
            self.keyboard(root, nav_w, w - nav_w, keyboard_h, &keys, lang);
        } else if typing_tz {
            self.tz_keyboard(root, nav_w, w - nav_w, keyboard_h, lang);
        } else if pending {
            self.confirm_bar(root, w, lang);
        }

        // Where it was, if the section is the same one.
        if let Some((_, y)) = self
            .scrolled
            .filter(|(section, y)| *section == s.section && *y > 0)
        {
            lvgl_sys::lv_obj_update_layout(root);
            lvgl_sys::lv_obj_scroll_to_y(main, y, lvgl_sys::lv_anim_enable_t_LV_ANIM_OFF);
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
        // More choices than fit in the card go on a second line.
        flex(g, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW_WRAP, 0);
        lvgl_sys::lv_obj_set_style_max_width(g, pct(100), stile::MAIN);
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
            self.on_press(
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
        self.on_press(
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
            self.on_press(
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
        // Typing: only the form, so that the keyboard below leaves it in view.
        if let Some(f) = &s.ntp_form {
            let c = card(main, |_| {});
            stile::bordo(c, Some(ACCENT), 1.0, stile::MAIN);
            let r = row(c, &cp::word(lang, "ntpServers", &[]));
            let bad = !f.text.trim().is_empty() && !f.valid();
            let field = self.text_field(r, &f.text, 420, true, bad);
            wrap(
                label(c, &cp::word(lang, "ntpServersManualHelp", &[]), 13, MUTED),
                pct(100),
            );
            return Some(field);
        }
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
        if let Some(d) = t.drift.filter(|_| t.ntp) {
            let r = row(c, &cp::word(lang, "clockDrift", &[]));
            let words = cp::drift_words(&d);
            let args: Vec<(&str, &str)> = words.iter().map(|(k, v)| (*k, v.as_str())).collect();
            let key = if d.ppm >= 0.0 {
                "clockDriftFast"
            } else {
                "clockDriftSlow"
            };
            label(r, &cp::word(lang, key, &args), 15, TEXT);
        }
        if let Some(n) = &t.ntp_servers {
            let r = row(c, &cp::word(lang, "ntpServers", &[]));
            self.segmented(
                r,
                &[
                    (
                        cp::word(lang, "ntpServersAuto", &[]),
                        !n.manual,
                        Action::NtpServersMode(false),
                    ),
                    (
                        cp::word(lang, "ntpServersManual", &[]),
                        n.manual,
                        Action::NtpServersMode(true),
                    ),
                ],
            );
            if n.manual {
                let r = row(c, "");
                label(r, &n.servers.join("  "), 15, TEXT);
                let b = button(r, &cp::word(lang, "tzChange", &[]), PANEL2, TEXT, 15);
                self.on(b, Action::NtpServersEdit);
            }
        }
        let r = row(c, &cp::word(lang, "timezone", &[]));
        let current = s
            .zones
            .iter()
            .find(|z| z.zone == t.timezone)
            .cloned()
            .unwrap_or(cp::Zone {
                zone: t.timezone.clone(),
                country: None,
            });
        label(r, &cp::zone_label(&current, lang), 16, TEXT);
        label(r, &t.timezone, 13, MUTED);
        if !s.zones.is_empty() && s.tz.is_none() {
            let b = button(r, &cp::word(lang, "tzChange", &[]), PANEL2, TEXT, 15);
            self.on(b, Action::TzOpen);
        }
        if let Some(p) = &s.tz {
            let focused = self.tz_picker(main, s, p, lang);
            // The picker takes the place of the manual time while it is open.
            return focused;
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
        // Sent: the keyboard goes at once and says what is happening, until
        // the device answers (TY570, 16-11-2026: nothing moved while the
        // device was joining, and «Connect» was pressed again and again).
        if let Some(f) = s.wifi_form.as_ref().filter(|f| f.submitting) {
            card(main, |c| {
                let key = if f.hotspot { "hotspotStarting" } else { "wifiJoining" };
                wrap(
                    label(c, &cp::word(lang, key, &[("ssid", &f.ssid)]), 17, TEXT),
                    pct(100),
                );
            });
            return None;
        }
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
        // The addresses of the network joined (maintainer, 14-11-2026).
        let joined = s
            .cards
            .as_ref()
            .and_then(|cs| cs.iter().find(|x| Some(&x.name) == wf.card.as_ref()))
            .filter(|x| {
                wf.mode == "client" && !(x.addresses.is_empty() && x.addresses6.is_empty())
            });
        // Joined, but the network gave no IPv4 (its DHCP did not answer): the
        // IPv6 address, and a line that says so.
        if let Some(x) = joined.filter(|x| x.addresses.is_empty()) {
            let r = row(c, &cp::word(lang, "wifiDetails", &[]));
            label(r, &x.addresses6.join(", "), 16, TEXT);
            tag(r, &cp::word(lang, "wifiNoIpv4Tag", &[]), false);
            wrap(
                label(c, &cp::word(lang, "wifiNoIpv4", &[]), 13, WARN),
                pct(100),
            );
        } else if let Some(x) = joined {
            let r = row(c, &cp::word(lang, "wifiDetails", &[]));
            label(r, &x.addresses.join(", "), 16, TEXT);
            let manual = x.method.as_deref() == Some("manual");
            tag(
                r,
                &if manual {
                    cp::word(lang, "static", &[])
                } else {
                    "DHCP".into()
                },
                true,
            );
            if x.gateway.is_some() || !x.dns.is_empty() {
                let r = row(c, &cp::word(lang, "gatewayDns", &[]));
                let gw = x.gateway.clone().unwrap_or_else(|| "—".into());
                let dns = if x.dns.is_empty() {
                    "—".into()
                } else {
                    x.dns.join(", ")
                };
                label(r, &format!("{gw} · {dns}"), 15, TEXT);
            }
        }
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

    /// The time zone picker (TY570, 14-11-2026): the filter, then continent,
    /// country and city as lists inside the panel. A `lv_dropdown` opened its
    /// list on `lv_layer_top`, under the system layer that holds this panel:
    /// the list showed, and the finger touched the panel above it.
    unsafe fn tz_picker(&mut self, main: P, s: &State, p: &cp::TzPicker, lang: &str) -> Option<P> {
        let c = card(main, |_| {});
        stile::bordo(c, Some(ACCENT), 1.0, stile::MAIN);
        let head = transparent(c);
        lvgl_sys::lv_obj_set_size(head, pct(100), LV_SIZE_CONTENT);
        flex(head, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW_WRAP, 8);
        center_items(head);
        let field = self.text_field(head, &p.filter, 220, p.typing, false);
        self.on(field, Action::TzFocus);
        let filtering = !p.filter.trim().is_empty();
        if !filtering {
            let b = button(head, &cp::word(lang, "tzContinents", &[]), PANEL2, TEXT, 14);
            if p.continent.is_some() {
                self.on(b, Action::TzBack(0));
            } else {
                dim(b);
            }
            if let Some(cont) = &p.continent {
                let b = button(
                    head,
                    &cp::word(lang, &format!("continent_{cont}"), &[]),
                    PANEL2,
                    TEXT,
                    14,
                );
                if p.country.is_some() {
                    self.on(b, Action::TzBack(1));
                } else {
                    dim(b);
                }
            }
            if let Some(code) = &p.country {
                dim(button(
                    head,
                    &cp::country_name(code, lang),
                    PANEL2,
                    TEXT,
                    14,
                ));
            }
        }
        spacer(head);
        let b = button(head, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 14);
        self.on(b, Action::TzCancel);
        if !filtering && p.continent.is_none() {
            wrap(
                label(c, &cp::word(lang, "tzFilterHelp", &[]), 13, MUTED),
                pct(100),
            );
        }

        // The rows: wide buttons, one per line, in the scrolling section.
        let list = transparent(c);
        lvgl_sys::lv_obj_set_size(list, pct(100), LV_SIZE_CONTENT);
        stile::margini(list, 8, 0, stile::MAIN);
        flex(list, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW_WRAP, 6);
        let item = |this: &mut Self, text: &str, note: &str, a: Action, wide: bool| {
            let b = button(list, text, PANEL2, TEXT, 16);
            lvgl_sys::lv_obj_set_size(b, if wide { pct(100) } else { pct(32) }, 46);
            if !note.is_empty() {
                let n = label(b, note, 12, MUTED);
                lvgl_sys::lv_obj_align(
                    n,
                    lvgl_sys::LV_ALIGN_RIGHT_MID as lvgl_sys::lv_align_t,
                    0,
                    0,
                );
            }
            this.on(b, a);
        };
        if filtering {
            let found = cp::search_zones(&s.zones, &p.filter, lang, 40);
            if found.is_empty() {
                label(list, &cp::word(lang, "tzNoMatch", &[]), 15, MUTED);
            }
            for z in found {
                item(
                    self,
                    &cp::zone_label(&z, lang),
                    &z.zone,
                    Action::TzPick(z.zone.clone()),
                    true,
                );
            }
        } else if let Some(code) = &p.country {
            let mut zones: Vec<&cp::Zone> = s
                .zones
                .iter()
                .filter(|z| z.country.as_deref() == Some(code.as_str()))
                .collect();
            zones.sort_by_key(|z| cp::fold(&cp::city_of(&z.zone)));
            for z in zones {
                item(
                    self,
                    &cp::city_of(&z.zone),
                    &z.zone,
                    Action::TzPick(z.zone.clone()),
                    true,
                );
            }
        } else if let Some(cont) = &p.continent {
            for e in cp::countries_in(&s.zones, cont, lang) {
                let note = if e.zones.len() > 1 {
                    e.zones.len().to_string()
                } else {
                    String::new()
                };
                let a = match &e.code {
                    Some(code) => Action::TzCountry(code.clone()),
                    None => Action::TzPick(e.zones[0].clone()),
                };
                item(self, &e.name, &note, a, true);
            }
        } else {
            for cont in cp::continents_in(&s.zones) {
                item(
                    self,
                    &cp::word(lang, &format!("continent_{cont}"), &[]),
                    "",
                    Action::TzContinent(cont),
                    false,
                );
            }
        }
        p.typing.then_some(field)
    }

    /// The letters of the time zone filter: three rows, then ⌫, space and Done.
    /// Keys act on press (see `on_press`).
    unsafe fn tz_keyboard(&mut self, root: P, x: i16, w: i16, h: i16, lang: &str) {
        const LETTERS: [&str; 3] = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
        let k = panel_box(root, (20, 24, 29));
        stile::raggio(k, 0.0, stile::MAIN);
        lvgl_sys::lv_obj_set_style_border_side(k, lvgl_sys::LV_BORDER_SIDE_TOP as u8, stile::MAIN);
        lvgl_sys::lv_obj_set_pos(k, x, screen_size().1 - h);
        lvgl_sys::lv_obj_set_size(k, w, h);
        stile::margini(k, 6, 8, stile::MAIN);
        flex(k, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_COLUMN, 5);
        let kh = (h - 12 - 3 * 5) / 4;
        let kw = (w - 16 - 9 * 5) / 10;
        for keys in LETTERS {
            let r = transparent(k);
            lvgl_sys::lv_obj_set_size(r, pct(100), kh);
            flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 5);
            lvgl_sys::lv_obj_set_flex_align(
                r,
                lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
                lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
                lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
            );
            for c in keys.chars() {
                let b = button(r, &c.to_string(), PANEL2, TEXT, 18);
                lvgl_sys::lv_obj_set_size(b, kw, kh);
                stile::margini(b, 0, 0, stile::MAIN);
                self.on_press(b, Action::TzKey(c.to_string()));
            }
        }
        let r = transparent(k);
        lvgl_sys::lv_obj_set_size(r, pct(100), kh);
        flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 5);
        let b = button(r, "⌫", PANEL2, TEXT, 18);
        lvgl_sys::lv_obj_set_size(b, kw * 3 / 2, kh);
        self.on_press(b, Action::TzKey("⌫".into()));
        let b = button(r, &cp::word(lang, "kbSpace", &[]), PANEL2, MUTED, 14);
        lvgl_sys::lv_obj_set_height(b, kh);
        lvgl_sys::lv_obj_set_flex_grow(b, 1);
        self.on_press(b, Action::TzKey(" ".into()));
        let b = button(
            r,
            &cp::word(lang, "kbDone", &[]),
            ACCENT,
            (255, 255, 255),
            14,
        );
        lvgl_sys::lv_obj_set_size(b, kw * 3, kh);
        self.on_press(b, Action::TzKey("⏎".into()));
    }

    /// Letters, capitals and symbols, then Cancel and Done (join, or turn the
    /// hotspot on): four rows over the bottom of the section.
    unsafe fn keyboard(&mut self, root: P, x: i16, w: i16, h: i16, f: &Keys, lang: &str) {
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
                self.on_press(b, Action::FormKey("⇧".into()));
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
                self.on_press(b, Action::FormKey(ch.to_string()));
            }
            if i == 2 {
                let b = button(r, "⌫", PANEL2, TEXT, 18);
                lvgl_sys::lv_obj_set_size(b, kw * 3 / 2, kh);
                self.on_press(b, Action::FormKey("⌫".into()));
            }
        }
        let r = transparent(k);
        lvgl_sys::lv_obj_set_size(r, pct(100), kh);
        flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 5);
        let toggle = if f.symbols { "kbLetters" } else { "kbSymbols" };
        let b = button(r, &cp::word(lang, toggle, &[]), PANEL2, TEXT, 14);
        lvgl_sys::lv_obj_set_size(b, kw * 3 / 2, kh);
        self.on_press(
            b,
            Action::FormKey(if f.symbols { "abc" } else { "?123" }.into()),
        );
        let b = button(r, &cp::word(lang, "kbSpace", &[]), PANEL2, MUTED, 14);
        lvgl_sys::lv_obj_set_height(b, kh);
        lvgl_sys::lv_obj_set_flex_grow(b, 1);
        self.on_press(b, Action::FormKey(" ".into()));
        let b = button(r, &cp::word(lang, "cancel", &[]), PANEL2, TEXT, 14);
        lvgl_sys::lv_obj_set_size(b, kw * 2, kh);
        self.on_press(b, Action::FormCancel);
        let b = button(r, &f.done, ACCENT, (255, 255, 255), 14);
        lvgl_sys::lv_obj_set_size(b, kw * 3, kh);
        if f.valid {
            self.on_press(b, Action::FormSubmit);
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
        if let Some(flipped) = s.flipped {
            let c = card(main, |_| {});
            let r = row(c, &cp::word(lang, "flipped", &[]));
            self.segmented(
                r,
                &[
                    (cp::word(lang, "no", &[]), !flipped, Action::Flip(false)),
                    (cp::word(lang, "yes", &[]), flipped, Action::Flip(true)),
                ],
            );
            wrap(
                label(c, &cp::word(lang, "flippedHelp", &[]), 13, MUTED),
                pct(100),
            );
        }
        self.panel_corner(main, s, lang);
        if caps.reboot_corner {
            self.reboot_corner(main, s, lang);
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

    /// What runs here, read only: SWS, the project, the system, the state.
    /// Below, the diagnostic export to a USB stick where the device can.
    unsafe fn about(&mut self, main: P, s: &State, lang: &str) {
        let Some(a) = &s.about else {
            label(main, &cp::word(lang, "loading", &[]), 15, MUTED);
            return;
        };
        for c in crate::control_panel_about::cards(a, lang) {
            let box_ = card(main, |_| {});
            label(box_, &c.title, 15, MUTED);
            for (name, value) in &c.rows {
                let r = row(box_, name);
                label(r, value, 16, TEXT);
            }
        }
        if a.get("diagnostics_usb").and_then(|v| v.as_bool()) != Some(true) {
            return;
        }
        let c = card(main, |_| {});
        let r = row(c, &cp::word(lang, "diagnostics", &[]));
        let b = button(r, &cp::word(lang, "diagnosticsUsb", &[]), PANEL2, TEXT, 15);
        if s.diagnostics_busy {
            dim(b);
            label(r, &cp::word(lang, "diagnosticsWriting", &[]), 14, MUTED);
        } else {
            self.on(b, Action::DiagnosticsUsb);
        }
        match &s.diagnostics {
            Some(Ok(file)) => {
                wrap(
                    label(
                        c,
                        &cp::word(lang, "diagnosticsWritten", &[("file", file)]),
                        13,
                        OK,
                    ),
                    pct(100),
                );
            }
            Some(Err(e)) => {
                wrap(label(c, &cp::error_text(e, lang), 13, BAD), pct(100));
            }
            None => {}
        }
        wrap(
            label(c, &cp::word(lang, "diagnosticsHelp", &[]), 13, MUTED),
            pct(100),
        );
    }

    /// The corner that opens this panel when held, or none: then the button
    /// at start-up is the only way in, and the card says so.
    unsafe fn panel_corner(&mut self, main: P, s: &State, lang: &str) {
        let Some(corner) = s.panel_corner else {
            return;
        };
        let c = card(main, |_| {});
        label(c, &cp::word(lang, "panelCorner", &[]), 15, TEXT);
        let r = row(c, "");
        let taken = s
            .reboot_corner
            .map_or(cp::RebootCorner::None, |(reboot, _)| reboot);
        self.segmented(r, &corner_choices(lang, corner, taken, Action::PanelCorner));
        let o = s.panel_options;
        if corner != cp::RebootCorner::None {
            let r = row(c, &cp::word(lang, "rebootCornerHold", &[]));
            self.stepper(
                r,
                &format!("{} s", o.hold_secs),
                Action::PanelHold(-1),
                Action::PanelHold(1),
            );
            let r = row(c, &cp::word(lang, "rebootCornerSize", &[]));
            self.stepper(
                r,
                &format!("{} px", o.size_px),
                Action::PanelSize(-20),
                Action::PanelSize(20),
            );
            if let Some(root) = self.root {
                self.corner_preview(root, corner, o.size_px as i16, OK);
            }
        }
        let secs = o.hold_secs.to_string();
        let (key, color) = if corner == cp::RebootCorner::None {
            ("panelCornerNoneHelp", WARN)
        } else {
            ("panelCornerHelp", MUTED)
        };
        wrap(
            label(c, &cp::word(lang, key, &[("secs", &secs)]), 13, color),
            pct(100),
        );
    }

    /// The corner that reboots when held. The options (time, size, question)
    /// only where this viewer watches it: PixsysOS has its own, fixed.
    unsafe fn reboot_corner(&mut self, main: P, s: &State, lang: &str) {
        let c = card(main, |_| {});
        let Some((corner, options)) = s.reboot_corner else {
            label(c, &cp::word(lang, "loading", &[]), 15, MUTED);
            return;
        };
        label(c, &cp::word(lang, "rebootCorner", &[]), 15, TEXT);
        if !s.reboot_corner_allowed {
            wrap(
                label(
                    c,
                    &cp::word(lang, "rebootCornerOffByProject", &[]),
                    14,
                    MUTED,
                ),
                pct(100),
            );
            return;
        }
        let r = row(c, "");
        let taken = s.panel_corner.unwrap_or(cp::RebootCorner::TopRight);
        let options_row = corner_choices(lang, corner, taken, Action::RebootCorner);
        self.segmented(r, &options_row);
        if let Some(o) = options.filter(|_| corner != cp::RebootCorner::None) {
            let r = row(c, &cp::word(lang, "rebootCornerHold", &[]));
            self.stepper(
                r,
                &format!("{} s", o.hold_secs),
                Action::RebootHold(-1),
                Action::RebootHold(1),
            );
            let r = row(c, &cp::word(lang, "rebootCornerSize", &[]));
            self.stepper(
                r,
                &format!("{} px", o.size_px),
                Action::RebootSize(-20),
                Action::RebootSize(20),
            );
            let r = row(c, &cp::word(lang, "rebootCornerConfirm", &[]));
            self.segmented(
                r,
                &[
                    (
                        cp::word(lang, "no", &[]),
                        !o.confirm,
                        Action::RebootConfirm(false),
                    ),
                    (
                        cp::word(lang, "yes", &[]),
                        o.confirm,
                        Action::RebootConfirm(true),
                    ),
                ],
            );
        }
        if let (Some(o), Some(root)) = (options, self.root) {
            self.corner_preview(root, corner, o.size_px as i16, BAD);
        }
        let secs = options.map_or(5, |o| o.hold_secs).to_string();
        wrap(
            label(
                c,
                &cp::word(lang, "rebootCornerHelp", &[("secs", &secs)]),
                13,
                MUTED,
            ),
            pct(100),
        );
    }

    /// The area of a corner gesture, drawn where it is and as large as it is,
    /// while its card is on screen: red the one that reboots, green the one
    /// that opens the panel. It takes no touch: what is under it still works.
    unsafe fn corner_preview(&mut self, root: P, corner: cp::RebootCorner, size: i16, color: Rgb) {
        let (w, h) = screen_size();
        let (x, y) = match corner {
            cp::RebootCorner::None => return,
            cp::RebootCorner::TopLeft => (0, 0),
            cp::RebootCorner::TopRight => (w - size, 0),
            cp::RebootCorner::BottomRight => (w - size, h - size),
            cp::RebootCorner::BottomLeft => (0, h - size),
        };
        let area = transparent(root);
        lvgl_sys::lv_obj_add_flag(area, lvgl_sys::LV_OBJ_FLAG_FLOATING);
        lvgl_sys::lv_obj_set_pos(area, x, y);
        lvgl_sys::lv_obj_set_size(area, size, size);
        stile::sfondo(area, color, stile::MAIN);
        lvgl_sys::lv_obj_set_style_bg_opa(area, 70, stile::MAIN);
        stile::bordo(area, Some(color), 2.0, stile::MAIN);
    }

    /// `−  value  +`.
    unsafe fn stepper(&mut self, parent: P, value: &str, less: Action, more: Action) {
        let g = transparent(parent);
        lvgl_sys::lv_obj_set_size(g, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
        flex(g, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW, 10);
        lvgl_sys::lv_obj_set_flex_align(
            g,
            lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_START,
            lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
            lvgl_sys::lv_flex_align_t_LV_FLEX_ALIGN_CENTER,
        );
        let b = button(g, "-", PANEL2, TEXT, 18);
        lvgl_sys::lv_obj_set_width(b, 48);
        self.on(b, less);
        let l = label(g, value, 16, TEXT);
        lvgl_sys::lv_obj_set_style_min_width(l, 64, stile::MAIN);
        lvgl_sys::lv_obj_set_style_text_align(
            l,
            lvgl_sys::LV_TEXT_ALIGN_CENTER as lvgl_sys::lv_text_align_t,
            stile::MAIN,
        );
        let b = button(g, "+", PANEL2, TEXT, 18);
        lvgl_sys::lv_obj_set_width(b, 48);
        self.on(b, more);
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
        // Give the device back: a card of its own, in red, under the buttons
        // above. The PIN is asked again before anything goes.
        if s.reset_done {
            let c = card(main, |_| {});
            wrap(
                label(
                    c,
                    &cp::word(
                        lang,
                        if s.reset_keep_cloud { "resetKeepCloudDone" } else { "resetDone" },
                        &[],
                    ),
                    15,
                    OK,
                ),
                pct(100),
            );
        } else {
            // One red card, one block per way of giving the device back:
            // title, what it does, and its button on the right, with a line
            // between the two (TY570, 16-11-2026: the label column was too
            // narrow for the second title and the buttons sat half way).
            let c = card(main, |_| {});
            stile::bordo(c, Some(BAD), 1.0, stile::MAIN);
            lvgl_sys::lv_obj_set_style_pad_row(c, 6, stile::MAIN);
            label(c, &cp::word(lang, "resetSection", &[]), 17, BAD);
            self.reset_block(c, lang, "reset", "resetHelp", &[], BAD, (255, 255, 255), false);
            if let Some(cloud) = s.info.as_ref().and_then(|i| i.cloud.as_deref()) {
                let line = transparent(c);
                lvgl_sys::lv_obj_set_size(line, pct(100), 1);
                stile::sfondo(line, LINE, stile::MAIN);
                stile::margini(line, 0, 0, stile::MAIN);
                self.reset_block(
                    c,
                    lang,
                    "resetKeepCloud",
                    "resetKeepCloudHelp",
                    &[("cloud", cloud)],
                    PANEL2,
                    (241, 176, 173),
                    true,
                );
            }
        }
    }

    /// One way of giving the device back: its title, what it removes, and the
    /// button that asks the PIN.
    #[allow(clippy::too_many_arguments)]
    unsafe fn reset_block(
        &mut self,
        c: P,
        lang: &str,
        title: &str,
        help: &str,
        values: &[(&str, &str)],
        bg: Rgb,
        fg: Rgb,
        keep_cloud: bool,
    ) {
        wrap(label(c, &cp::word(lang, title, &[]), 15, TEXT), pct(100));
        wrap(label(c, &cp::word(lang, help, values), 13, MUTED), pct(100));
        let a = actions(c);
        let b = button(a, &cp::word(lang, "resetButton", &[]), bg, fg, 15);
        self.on(b, Action::ResetAsk(keep_cloud));
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

/// What the on-screen keyboard needs from the form it types into.
struct Keys {
    shift: bool,
    symbols: bool,
    /// The label of the key that confirms.
    done: String,
    valid: bool,
}

/// None and the four corners, without the one the other gesture has: two long
/// presses cannot share a corner.
fn corner_choices(
    lang: &str,
    current: cp::RebootCorner,
    taken: cp::RebootCorner,
    action: fn(cp::RebootCorner) -> Action,
) -> Vec<(String, bool, Action)> {
    [
        (cp::RebootCorner::None, "rebootCornerNone"),
        (cp::RebootCorner::TopLeft, "cornerTopLeft"),
        (cp::RebootCorner::TopRight, "cornerTopRight"),
        (cp::RebootCorner::BottomLeft, "cornerBottomLeft"),
        (cp::RebootCorner::BottomRight, "cornerBottomRight"),
    ]
    .iter()
    .filter(|(v, _)| *v == cp::RebootCorner::None || *v != taken)
    .map(|(v, key)| (cp::word(lang, key, &[]), *v == current, action(*v)))
    .collect()
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
    // What does not fit beside the label goes under it: on a narrow screen
    // a row of choices is wider than the card.
    flex(r, lvgl_sys::lv_flex_flow_t_LV_FLEX_FLOW_ROW_WRAP, 10);
    lvgl_sys::lv_obj_set_style_pad_row(r, 6, stile::MAIN);
    center_items(r);
    if !text.is_empty() {
        let l = label(r, text, 14, MUTED);
        lvgl_sys::lv_obj_set_width(l, 140);
    } else if screen_size().0 >= NARROW_W {
        // Aligned under the values of the rows above; on a narrow screen
        // the whole width is for the content.
        lvgl_sys::lv_obj_set_width(label(r, "", 14, MUTED), 140);
    }
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
