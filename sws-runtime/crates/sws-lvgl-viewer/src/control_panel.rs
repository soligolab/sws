//! The device control panel on the LVGL viewer (plan
//! `docs/plans/2026-11-13-pannello-di-controllo.md`, phase 3): the twin of
//! `sws-editor/src/control-panel/`, on the same API (`/api/control-panel/*`).
//!
//! Here: the state, the words, the corner gesture and the network thread —
//! no LVGL, so the tests reach all of it. The drawing is in
//! `lvgl_control_panel.rs`, which only reads this state and calls the
//! functions below from its callbacks.
//!
//! # The words are the web's
//!
//! They are read at build time from `sws-editor/src/i18n/{it,en}.json`
//! (`controlPanel.*`): one copy for both engines, so they cannot drift apart.
//! Like the web, the panel speaks the project's **content** language (the
//! language button), with English for a language the panel has no words for
//! (decision of the maintainer, 14-11-2026).
//!
//! # The three ways in
//!
//! 1. a button for [`BOOT_BUTTON`] when the viewer starts — always, even when
//!    the project disabled the panel: it is the way back for a device left
//!    without a network;
//! 2. a finger held still for [`HOLD`] in the top-right corner
//!    ([`filter_pointer`], called by `lvgl_indev` before LVGL sees the touch);
//! 3. the synoptic action `open_control_panel`.
//!
//! 2 and 3 follow the project (`control_panel.enabled`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;

pub const CORNER_PX: i32 = 80;
pub const HOLD: Duration = Duration::from_millis(5_000);
pub const MOVE_TOLERANCE_PX: i32 = 15;
pub const BOOT_BUTTON: Duration = Duration::from_secs(5);
const SESSION_HEADER: &str = "x-sws-control-panel";

// ── Words ────────────────────────────────────────────────────────────────────

fn words(lang: &str) -> &'static serde_json::Value {
    static IT: OnceLock<serde_json::Value> = OnceLock::new();
    static EN: OnceLock<serde_json::Value> = OnceLock::new();
    let parse = |json: &str| {
        serde_json::from_str::<serde_json::Value>(json)
            .ok()
            .and_then(|mut v| v.get_mut("controlPanel").map(serde_json::Value::take))
            .unwrap_or_default()
    };
    match lang {
        "it" => IT.get_or_init(|| parse(include_str!("../../../../sws-editor/src/i18n/it.json"))),
        _ => EN.get_or_init(|| parse(include_str!("../../../../sws-editor/src/i18n/en.json"))),
    }
}

/// The panel language for a content language: the same rule as
/// `panelLanguage` on the web. With no content language the viewer has no UI
/// language to fall back on, so English.
pub fn panel_language(content_lang: &str) -> &'static str {
    let base = content_lang
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if base == "it" {
        "it"
    } else {
        "en"
    }
}

/// `controlPanel.<key>` (dotted for nested keys, `state.connected`), with
/// `{{name}}` replaced by the values. A missing key shows itself.
pub fn word(lang: &str, key: &str, values: &[(&str, &str)]) -> String {
    let found = key
        .split('.')
        .try_fold(words(lang), |v, k| v.get(k))
        .and_then(|v| v.as_str());
    let mut s = found.map_or_else(|| key.to_string(), str::to_string);
    for (name, value) in values {
        s = s.replace(&format!("{{{{{name}}}}}"), value);
    }
    s
}

// ── The API ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Capabilities {
    pub network: bool,
    #[serde(default)]
    pub wifi: bool,
    pub time: bool,
    pub reboot: bool,
    pub power_off: bool,
    #[serde(default)]
    pub display: bool,
    #[serde(default)]
    pub touch_calibration_service: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WifiNetwork {
    pub ssid: String,
    pub signal: u8,
    /// `open`, `wpa`, `wpa3`, `enterprise`.
    pub security: String,
    pub known: bool,
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WifiState {
    pub card: Option<String>,
    pub radio: bool,
    /// `client`, `hotspot`, `idle`, `off`.
    pub mode: String,
    pub active_ssid: Option<String>,
    pub networks: Vec<WifiNetwork>,
    pub can_hotspot: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Hotspot {
    pub ssid: String,
    pub password: String,
    #[serde(default)]
    pub proposed: bool,
    #[serde(default)]
    pub qr: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Card {
    pub name: String,
    pub state: String,
    pub mac: Option<String>,
    pub addresses: Vec<String>,
    pub gateway: Option<String>,
    pub dns: Vec<String>,
    pub method: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TimeState {
    pub timezone: String,
    pub ntp: bool,
    pub can_ntp: bool,
    pub ntp_synchronized: bool,
    pub time_usec: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceInfo {
    pub model: Option<String>,
    pub serial: Option<String>,
    pub hostname: String,
    pub sws_version: String,
    pub initial_pin: Option<String>,
}

/// `a.b.c.d` with four numbers 0-255.
pub fn is_ipv4(s: &str) -> bool {
    let parts: Vec<&str> = s.trim().split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 3
                && p.bytes().all(|b| b.is_ascii_digit())
                && p.parse::<u16>().is_ok_and(|n| n <= 255)
        })
}

// ── State ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Screen {
    #[default]
    Closed,
    Pin,
    Panel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Section {
    #[default]
    Network,
    Wifi,
    Time,
    Screen,
    Device,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Power {
    Reboot,
    PowerOff,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinError {
    Wrong,
    Locked(u64),
}

/// The fields of a static address, in keypad order.
pub const FIELDS: [&str; 4] = ["address", "prefix", "gateway", "dns"];

/// A network change being typed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Draft {
    pub card: String,
    pub manual: bool,
    /// Address, prefix, gateway, DNS.
    pub fields: [String; 4],
    pub focus: usize,
}

impl Draft {
    fn of(c: &Card) -> Draft {
        let (address, prefix) = c
            .addresses
            .first()
            .and_then(|a| a.split_once('/'))
            .map_or((String::new(), "24".to_string()), |(a, p)| {
                (a.to_string(), p.to_string())
            });
        Draft {
            card: c.name.clone(),
            manual: c.method.as_deref() == Some("manual"),
            fields: [
                address,
                prefix,
                c.gateway.clone().unwrap_or_default(),
                c.dns.first().cloned().unwrap_or_default(),
            ],
            focus: 0,
        }
    }

    /// Whether one field holds something that cannot be sent.
    pub fn field_bad(&self, i: usize) -> bool {
        let v = self.fields[i].trim();
        match i {
            1 => !v.parse::<u8>().is_ok_and(|p| (1..=32).contains(&p)),
            0 => !is_ipv4(v),
            _ => !v.is_empty() && !is_ipv4(v),
        }
    }

    pub fn valid(&self) -> bool {
        !self.manual || (0..FIELDS.len()).all(|i| !self.field_bad(i))
    }

    fn change(&self) -> serde_json::Value {
        if !self.manual {
            return serde_json::json!({ "method": "auto" });
        }
        let [address, prefix, gateway, dns] = self.fields.clone().map(|f| f.trim().to_string());
        let mut v = serde_json::json!({
            "method": "manual",
            "address": address,
            "prefix": prefix.parse::<u8>().unwrap_or(24),
            "dns": if dns.is_empty() { vec![] } else { vec![dns] },
        });
        if !gateway.is_empty() {
            v["gateway"] = serde_json::Value::String(gateway);
        }
        v
    }
}

/// A network change applied and waiting for «Confirm».
#[derive(Debug, Clone)]
pub struct Pending {
    pub until: Instant,
    /// How the card was before, as the confirmation bar says it.
    pub before: String,
}

/// SSID and password being typed on the on-screen keyboard: to join a
/// network, or to turn the hotspot on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WifiForm {
    pub hotspot: bool,
    /// The SSID can be typed: a hidden network, or the hotspot.
    pub ssid_editable: bool,
    pub ssid: String,
    pub password: String,
    /// 0 = SSID, 1 = password.
    pub focus: usize,
    pub reveal: bool,
    pub shift: bool,
    pub symbols: bool,
    pub proposed: bool,
    /// A protected network not saved yet: no joining without its password.
    pub needs_password: bool,
}

/// WPA2-PSK: 8 to 63 printable ASCII characters.
pub fn is_psk(p: &str) -> bool {
    (8..=63).contains(&p.chars().count()) && p.chars().all(|c| (' '..='~').contains(&c))
}

impl WifiForm {
    pub fn valid(&self) -> bool {
        !self.ssid.is_empty()
            && self.ssid.len() <= 32
            && if self.hotspot || self.needs_password {
                is_psk(&self.password)
            } else {
                self.password.is_empty() || is_psk(&self.password)
            }
    }
}

/// The calibration of a resistive screen, on top of everything.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Calibration {
    /// The crosses: waiting for cross `n`.
    Cross(usize),
    /// The fit is live: try it, then Save or Redo.
    Trying {
        since: Instant,
    },
    Failed,
}

/// The date and time typed by hand, with the field in focus.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ManualTime {
    pub date: String,
    pub time: String,
    pub focus: usize,
}

#[derive(Debug, Default)]
pub struct State {
    /// Bumped at every change the screen must show.
    pub generation: u64,
    base_url: String,
    /// `control_panel.enabled` of the project; until the runtime answers, on.
    pub enabled: bool,
    pub boot_until: Option<Instant>,
    pub screen: Screen,
    pub pin: String,
    pub pin_error: Option<PinError>,
    pub busy: bool,
    token: Option<String>,
    pub caps: Option<Capabilities>,
    pub info: Option<DeviceInfo>,
    pub section: Section,
    pub cards: Option<Vec<Card>>,
    pub draft: Option<Draft>,
    pub pending: Option<Pending>,
    /// The device time and when it was read: the clock runs on from there.
    pub time: Option<(TimeState, Instant)>,
    pub zones: Vec<String>,
    pub manual_time: Option<ManualTime>,
    pub ask: Option<Power>,
    pub powering: Option<Power>,
    pub wifi: Option<WifiState>,
    pub hotspot: Option<Hotspot>,
    pub wifi_form: Option<WifiForm>,
    /// The device's brightness as the runtime has it: `Some(None)` = the
    /// project's. `None` = not read yet.
    pub brightness: Option<Option<u8>>,
    /// The slider, also while it moves.
    pub brightness_draft: u8,
    pub calibration: Option<Calibration>,
    /// The matrix in use before the calibration: back to it on Redo, on
    /// Cancel and when nobody touches.
    calibration_previous: Option<crate::touch_calibration::Matrix>,
    /// A note under the Screen section after a calibration ends.
    pub calibration_note: Option<&'static str>,
    pub error: Option<String>,
    reload_network_at: Option<Instant>,
    boot_shown: bool,
}

impl State {
    fn changed(&mut self) {
        self.generation += 1;
        ARMED.store(
            self.enabled && self.screen == Screen::Closed,
            Ordering::Relaxed,
        );
    }

    /// Back to the PIN: the service session expired, or the runtime restarted.
    fn expired(&mut self) {
        let base_url = std::mem::take(&mut self.base_url);
        let (enabled, generation) = (self.enabled, self.generation);
        *self = State {
            base_url,
            enabled,
            generation,
            screen: Screen::Pin,
            boot_shown: true,
            ..State::default()
        };
    }
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| {
        Mutex::new(State {
            enabled: true,
            ..State::default()
        })
    })
}

/// Reads the state; `f` must not call back into this module.
pub fn with_state<T>(f: impl FnOnce(&State) -> T) -> T {
    f(&state().lock().unwrap_or_else(|e| e.into_inner()))
}

fn change(f: impl FnOnce(&mut State)) {
    let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
    f(&mut s);
    s.changed();
}

/// Starts the panel: the network thread, the boot button, and the project
/// setting read from the runtime.
pub fn start(base_url: &str) {
    change(|s| {
        s.base_url = base_url.to_string();
        s.boot_until = Some(Instant::now() + BOOT_BUTTON);
    });
    send(Job::Status);
}

/// `--pannello-di-prova`: open, type the PIN, go to the section.
pub fn try_out(spec: &str) {
    open(true);
    if spec == "pin" {
        return;
    }
    let (pin, section) = spec.split_once(':').unwrap_or((spec, "network"));
    change(|s| {
        s.pin = pin.to_ascii_lowercase();
        s.section = match section {
            "time" => Section::Time,
            "device" => Section::Device,
            "wifi" => Section::Wifi,
            "screen" | "calibration" => Section::Screen,
            _ => Section::Network,
        };
    });
    pin_submit();
    // The crosses of the calibration, for a snapshot on a machine with no
    // resistive touch.
    if section == "calibration" {
        calibrate_start();
    }
}

/// The project may have changed (a reload): read `enabled` again.
pub fn refresh_status() {
    send(Job::Status);
}

/// Opens the PIN. `always`: the boot button, which ignores the project.
pub fn open(always: bool) {
    change(|s| {
        if s.screen == Screen::Closed && (always || s.enabled) {
            s.expired();
            s.boot_until = None;
        }
    });
}

pub fn close() {
    change(|s| {
        let base_url = std::mem::take(&mut s.base_url);
        let (enabled, generation) = (s.enabled, s.generation);
        *s = State {
            base_url,
            enabled,
            generation,
            boot_shown: true,
            ..State::default()
        };
    });
}

pub fn pin_key(k: char) {
    change(|s| {
        if s.pin.len() < 6 {
            s.pin.push(k.to_ascii_lowercase());
        }
        s.pin_error = None;
    });
}

pub fn pin_back() {
    change(|s| {
        s.pin.pop();
    });
}

pub fn pin_submit() {
    let pin = with_state(|s| (!s.busy && !s.pin.is_empty()).then(|| s.pin.clone()));
    if let Some(pin) = pin {
        change(|s| s.busy = true);
        send(Job::Session(pin));
    }
}

pub fn select(section: Section) {
    change(|s| {
        s.section = section;
        s.draft = None;
        s.manual_time = None;
        s.ask = None;
        s.error = None;
    });
    change(|s| {
        s.wifi_form = None;
        s.calibration_note = None;
    });
    match section {
        Section::Network => send(Job::Network),
        Section::Wifi => {
            send(Job::Wifi);
            send(Job::Hotspot);
        }
        Section::Time => {
            send(Job::Time);
            send(Job::Timezones);
        }
        Section::Screen => send(Job::Display),
        Section::Device => {}
    }
}

// Network

pub fn edit_start(card: &str) {
    change(|s| {
        s.draft = s
            .cards
            .as_ref()
            .and_then(|cs| cs.iter().find(|c| c.name == card))
            .map(Draft::of);
    });
}

pub fn edit_manual(manual: bool) {
    change(|s| {
        if let Some(d) = s.draft.as_mut() {
            d.manual = manual;
        }
    });
}

pub fn edit_focus(i: usize) {
    change(|s| {
        if let Some(d) = s.draft.as_mut() {
            d.focus = i.min(FIELDS.len() - 1);
        }
    });
}

/// A keypad key on the draft: a digit or `.` (the prefix takes digits only),
/// `⌫`, `←` and `→` to move between fields.
pub fn edit_key(k: &str) {
    change(|s| {
        let Some(d) = s.draft.as_mut() else { return };
        match k {
            "⌫" => {
                d.fields[d.focus].pop();
            }
            "←" => d.focus = (d.focus + FIELDS.len() - 1) % FIELDS.len(),
            "→" => d.focus = (d.focus + 1) % FIELDS.len(),
            "." if d.focus == 1 => {}
            k if k.len() == 1 && (k == "." || k.as_bytes()[0].is_ascii_digit()) => {
                if d.fields[d.focus].len() < 15 {
                    d.fields[d.focus].push_str(k);
                }
            }
            _ => {}
        }
    });
}

pub fn edit_cancel() {
    change(|s| s.draft = None);
}

pub fn edit_apply() {
    let job = with_state(|s| {
        let d = s.draft.as_ref().filter(|d| d.valid() && !s.busy)?;
        let before = s.cards.as_ref()?.iter().find(|c| c.name == d.card)?;
        let first = before
            .addresses
            .first()
            .cloned()
            .unwrap_or_else(|| "—".into());
        let before = if before.method.as_deref() == Some("manual") {
            first
        } else {
            format!("DHCP ({first})")
        };
        Some(Job::SetIpv4 {
            card: d.card.clone(),
            change: d.change(),
            before,
        })
    });
    if let Some(job) = job {
        change(|s| s.busy = true);
        send(job);
    }
}

pub fn confirm_network() {
    change(|s| s.busy = true);
    send(Job::Confirm);
}

pub fn rollback_network() {
    change(|s| s.busy = true);
    send(Job::Rollback);
}

// Time

pub fn set_ntp(on: bool) {
    send(Job::SetTime(serde_json::json!({ "ntp": on })));
}

pub fn set_timezone(zone: &str) {
    send(Job::SetTime(serde_json::json!({ "timezone": zone })));
}

pub fn manual_time_start() {
    change(|s| {
        let now = chrono::Local::now();
        s.manual_time = Some(ManualTime {
            date: now.format("%Y-%m-%d").to_string(),
            time: now.format("%H:%M").to_string(),
            focus: 0,
        });
    });
}

pub fn manual_time_focus(i: usize) {
    change(|s| {
        if let Some(m) = s.manual_time.as_mut() {
            m.focus = i.min(1);
        }
    });
}

/// A keypad key on the date (`-` allowed) or the time (`:` allowed).
pub fn manual_time_key(k: &str) {
    change(|s| {
        let Some(m) = s.manual_time.as_mut() else {
            return;
        };
        let (field, sep, max) = if m.focus == 0 {
            (&mut m.date, "-", 10)
        } else {
            (&mut m.time, ":", 5)
        };
        match k {
            "⌫" => {
                field.pop();
            }
            "←" | "→" => m.focus = 1 - m.focus,
            k if k == sep || (k.len() == 1 && k.as_bytes()[0].is_ascii_digit()) => {
                if field.len() < max {
                    field.push_str(k);
                }
            }
            _ => {}
        }
    });
}

/// The typed date and time as microseconds, in the device's local time.
pub fn manual_time_usec(m: &ManualTime) -> Option<i64> {
    use chrono::TimeZone;
    let naive =
        chrono::NaiveDateTime::parse_from_str(&format!("{} {}", m.date, m.time), "%Y-%m-%d %H:%M")
            .ok()?;
    let local = chrono::Local.from_local_datetime(&naive).earliest()?;
    Some(local.timestamp_micros())
}

pub fn manual_time_cancel() {
    change(|s| s.manual_time = None);
}

pub fn manual_time_apply() {
    let usec = with_state(|s| s.manual_time.as_ref().and_then(manual_time_usec));
    if let Some(usec) = usec {
        change(|s| s.manual_time = None);
        send(Job::SetTime(serde_json::json!({ "time_usec": usec })));
    }
}

// Wi-Fi

/// What the Wi-Fi was before a change, for the confirmation bar: an SSID is
/// the same in every language.
fn wifi_before(s: &State) -> String {
    match s.wifi.as_ref() {
        Some(w) if w.mode == "client" => {
            format!("Wi-Fi {}", w.active_ssid.as_deref().unwrap_or("—"))
        }
        Some(w) if w.mode == "hotspot" => {
            format!("hotspot {}", w.active_ssid.as_deref().unwrap_or("—"))
        }
        _ => "Wi-Fi —".into(),
    }
}

pub fn wifi_scan() {
    send(Job::WifiScan);
}

pub fn wifi_radio(on: bool) {
    send(Job::WifiRadio(on));
}

pub fn wifi_forget(ssid: &str) {
    send(Job::WifiForget(ssid.to_string()));
}

/// A network of the list: a saved or open one joins at once, the others open
/// the keyboard for the password. `None` = a hidden network.
pub fn wifi_join(ssid: Option<&str>) {
    let direct = with_state(|s| {
        let net = ssid.and_then(|n| {
            s.wifi
                .as_ref()?
                .networks
                .iter()
                .find(|x| x.ssid == n)
                .cloned()
        })?;
        (net.known || net.security == "open").then(|| (net.ssid, wifi_before(s)))
    });
    match direct {
        Some((ssid, before)) => {
            change(|s| s.busy = true);
            send(Job::WifiConnect {
                body: serde_json::json!({ "ssid": ssid }),
                before,
            });
        }
        None => change(|s| {
            s.wifi_form = Some(WifiForm {
                ssid_editable: ssid.is_none(),
                needs_password: ssid.is_some(),
                ssid: ssid.unwrap_or_default().to_string(),
                focus: if ssid.is_some() { 1 } else { 0 },
                ..WifiForm::default()
            })
        }),
    }
}

/// «Turn the hotspot on»: the form with the saved SSID and password, or the
/// runtime's proposal.
pub fn hotspot_start() {
    change(|s| {
        let Some(h) = s.hotspot.as_ref() else { return };
        s.wifi_form = Some(WifiForm {
            hotspot: true,
            ssid_editable: true,
            ssid: h.ssid.clone(),
            password: h.password.clone(),
            focus: 1,
            reveal: true,
            proposed: h.proposed,
            ..WifiForm::default()
        });
    });
}

pub fn hotspot_off() {
    let job = with_state(|s| {
        let h = s.hotspot.as_ref()?;
        Some(Job::SetHotspot {
            body: serde_json::json!({ "enabled": false, "ssid": h.ssid, "password": h.password }),
            before: wifi_before(s),
        })
    });
    if let Some(j) = job {
        change(|s| s.busy = true);
        send(j);
    }
}

pub fn form_focus(i: usize) {
    change(|s| {
        if let Some(f) = s.wifi_form.as_mut() {
            if i == 1 || f.ssid_editable {
                f.focus = i.min(1);
            }
        }
    });
}

/// A key of the on-screen keyboard: a character, `⌫`, `⇧` (capitals),
/// `?123`/`abc` (symbols), `👁` (show the password).
pub fn form_key(k: &str) {
    change(|s| {
        let Some(f) = s.wifi_form.as_mut() else {
            return;
        };
        match k {
            "⇧" => f.shift = !f.shift,
            "?123" | "abc" => f.symbols = !f.symbols,
            "👁" => f.reveal = !f.reveal,
            _ => {
                let (field, max) = if f.focus == 0 {
                    (&mut f.ssid, 32)
                } else {
                    (&mut f.password, 63)
                };
                if k == "⌫" {
                    field.pop();
                } else if field.chars().count() < max {
                    field.push_str(k);
                }
                f.proposed = false;
            }
        }
    });
}

pub fn form_cancel() {
    change(|s| s.wifi_form = None);
}

pub fn form_submit() {
    let job = with_state(|s| {
        let f = s.wifi_form.as_ref().filter(|f| f.valid() && !s.busy)?;
        let before = wifi_before(s);
        Some(if f.hotspot {
            Job::SetHotspot {
                body: serde_json::json!({ "enabled": true, "ssid": f.ssid, "password": f.password }),
                before,
            }
        } else {
            let mut body = serde_json::json!({ "ssid": f.ssid, "hidden": f.ssid_editable });
            if !f.password.is_empty() {
                body["password"] = serde_json::Value::String(f.password.clone());
            }
            Job::WifiConnect { body, before }
        })
    });
    if let Some(j) = job {
        change(|s| s.busy = true);
        send(j);
    }
}

// Screen

/// The slider moves: the light follows at once, nothing is saved yet.
pub fn brightness_preview(percent: u8) {
    let p = percent.clamp(5, 100);
    crate::schermo::device_brightness(Some(p));
    // No `change`: rebuilding under a finger dragging the slider would drop it.
    state()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .brightness_draft = p;
}

/// Saves the brightness: `None` = back to the project's.
pub fn brightness_set(percent: Option<u8>) {
    let p = percent.map(|p| p.clamp(5, 100));
    crate::schermo::device_brightness(p);
    change(|s| {
        s.brightness = Some(p);
        if let Some(p) = p {
            s.brightness_draft = p;
        }
    });
    send(Job::SetDisplay(p));
}

pub fn pixsys_calibration() {
    send(Job::TouchCalibration);
}

/// The five crosses of a resistive screen.
pub fn calibrate_start() {
    let (w, h) = crate::lvgl_display::dims();
    let (w, h) = (w as i32, h as i32);
    change(|s| {
        s.calibration_previous = crate::touch_calibration::live();
        s.calibration = Some(Calibration::Cross(0));
        s.calibration_note = None;
    });
    crate::touch_calibration::begin(w, h);
}

pub fn calibrate_redo() {
    let previous = with_state(|s| s.calibration_previous);
    crate::touch_calibration::set_live(previous);
    let (w, h) = crate::lvgl_display::dims();
    change(|s| s.calibration = Some(Calibration::Cross(0)));
    crate::touch_calibration::begin(w as i32, h as i32);
}

pub fn calibrate_cancel() {
    crate::touch_calibration::cancel_capture();
    let previous = with_state(|s| s.calibration_previous);
    crate::touch_calibration::set_live(previous);
    change(|s| s.calibration = None);
}

pub fn calibrate_save() {
    let note = match crate::touch_calibration::live() {
        Some(m) => match crate::touch_calibration::save(
            &m,
            std::path::Path::new(crate::touch_calibration::OWN_FILE),
        ) {
            Ok(()) => "calibrationSaved",
            Err(e) => {
                eprintln!("[touch] calibration not saved: {e}");
                "calibrationNotSaved"
            }
        },
        None => "calibrationNotSaved",
    };
    change(|s| {
        s.calibration = None;
        s.calibration_note = Some(note);
    });
}

/// The calibration at every frame: crosses touched, the fit, the try, and the
/// 30 s without touches that put the previous one back.
fn calibration_tick(s: &mut State, now: Instant) -> bool {
    use crate::touch_calibration::{self as tc, Progress};
    match s.calibration {
        Some(Calibration::Cross(n)) => match tc::step(now) {
            Some(Progress::Cross(m)) if m != n => {
                s.calibration = Some(Calibration::Cross(m));
                true
            }
            Some(Progress::Trying) => {
                s.calibration = Some(Calibration::Trying { since: now });
                true
            }
            Some(Progress::Failed) => {
                s.calibration = Some(Calibration::Failed);
                tc::set_live(s.calibration_previous);
                true
            }
            Some(Progress::GaveUp) | None => {
                s.calibration = None;
                tc::set_live(s.calibration_previous);
                s.calibration_note = Some("calibrationGaveUp");
                true
            }
            _ => false,
        },
        Some(Calibration::Trying { since }) => {
            let last = tc::last_touch().map_or(since, |(_, t)| t.max(since));
            if now.duration_since(last) > tc::GIVE_UP {
                s.calibration = None;
                tc::set_live(s.calibration_previous);
                s.calibration_note = Some("calibrationGaveUp");
                true
            } else {
                false
            }
        }
        _ => false,
    }
}

// Device

pub fn ask(p: Option<Power>) {
    change(|s| s.ask = p);
}

pub fn power(p: Power) {
    change(|s| {
        s.ask = None;
        s.busy = true;
    });
    send(Job::Power(p));
}

// ── Time passing ─────────────────────────────────────────────────────────────

/// Called at every frame by the overlay: the countdowns, the reloads they
/// lead to, the end of the boot button and the corner gesture.
pub fn tick(now: Instant) {
    let mut jobs = Vec::new();
    {
        let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
        let mut changed = false;
        if let Some(p) = &s.pending {
            if now > p.until + Duration::from_secs(2) {
                s.pending = None;
                jobs.push(Job::Network);
                jobs.push(Job::Wifi);
                changed = true;
            }
        }
        if s.reload_network_at.is_some_and(|t| now >= t) {
            s.reload_network_at = None;
            match s.section {
                Section::Wifi => {
                    jobs.push(Job::Wifi);
                    jobs.push(Job::Hotspot);
                }
                _ => jobs.push(Job::Network),
            }
        }
        if s.calibration.is_some() && calibration_tick(&mut s, now) {
            changed = true;
        }
        if !s.boot_shown && s.boot_until.is_some_and(|t| now >= t) {
            s.boot_shown = true;
            s.boot_until = None;
            changed = true;
        }
        if changed {
            s.changed();
        }
    }
    if gesture_fires(now) {
        open(false);
    }
    for j in jobs {
        send(j);
    }
}

/// Whether the boot button is on screen.
pub fn boot_button(now: Instant) -> Option<Duration> {
    with_state(|s| {
        s.boot_until
            .filter(|_| s.screen == Screen::Closed)
            .and_then(|t| t.checked_duration_since(now))
    })
}

// ── The corner gesture ───────────────────────────────────────────────────────

/// Whether a new press may start the gesture: the project allows it and the
/// panel is closed. Read by the touch thread without the state lock.
static ARMED: AtomicBool = AtomicBool::new(true);

#[derive(Debug, Clone, Copy)]
struct Hold {
    x: i32,
    y: i32,
    start: Instant,
    fired: bool,
}

#[derive(Debug, Default)]
struct Gesture {
    hold: Option<Hold>,
    down: bool,
}

fn gesture() -> &'static Mutex<Gesture> {
    static G: OnceLock<Mutex<Gesture>> = OnceLock::new();
    G.get_or_init(Mutex::default)
}

pub fn in_corner(x: i32, y: i32, width: i32) -> bool {
    x >= width - CORNER_PX && y <= CORNER_PX
}

/// What a touch becomes, decided before LVGL sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pointer {
    /// To LVGL as it is.
    Pass,
    /// Held back: a finger in the corner, maybe the gesture.
    Withhold,
    /// Released before the gesture completed: LVGL gets the press it did not
    /// see, then the release — so a project button in the corner still works.
    Click,
}

pub fn filter_pointer(x: i32, y: i32, pressed: bool, width: i32, now: Instant) -> Pointer {
    let mut g = gesture().lock().unwrap_or_else(|e| e.into_inner());
    // Before the display exists there is no corner to speak of.
    let armed = ARMED.load(Ordering::Relaxed) && width > 0;
    decide(&mut g, armed, x, y, pressed, width, now)
}

fn decide(
    g: &mut Gesture,
    armed: bool,
    x: i32,
    y: i32,
    pressed: bool,
    width: i32,
    now: Instant,
) -> Pointer {
    let new_press = pressed && !g.down;
    g.down = pressed;
    if let Some(h) = g.hold {
        if h.fired {
            // The panel opened under the finger: LVGL never saw this press.
            if !pressed {
                g.hold = None;
            }
            return Pointer::Withhold;
        }
        if !pressed {
            g.hold = None;
            return Pointer::Click;
        }
        if (x - h.x).abs() > MOVE_TOLERANCE_PX || (y - h.y).abs() > MOVE_TOLERANCE_PX {
            // A drag, not the gesture: from here on LVGL has it.
            g.hold = None;
            return Pointer::Pass;
        }
        return Pointer::Withhold;
    }
    if new_press && armed && in_corner(x, y, width) {
        g.hold = Some(Hold {
            x,
            y,
            start: now,
            fired: false,
        });
        return Pointer::Withhold;
    }
    Pointer::Pass
}

/// How far the finger in the corner is, 0..1, for the ring.
pub fn hold_progress(now: Instant) -> Option<f32> {
    let g = gesture().lock().unwrap_or_else(|e| e.into_inner());
    g.hold
        .filter(|h| !h.fired)
        .map(|h| (now.duration_since(h.start).as_secs_f32() / HOLD.as_secs_f32()).min(1.0))
}

fn gesture_fires(now: Instant) -> bool {
    let mut g = gesture().lock().unwrap_or_else(|e| e.into_inner());
    match g.hold.as_mut() {
        Some(h) if !h.fired && now.duration_since(h.start) >= HOLD => {
            h.fired = true;
            true
        }
        _ => false,
    }
}

// ── The network thread ───────────────────────────────────────────────────────

enum Job {
    Status,
    Session(String),
    Network,
    SetIpv4 {
        card: String,
        change: serde_json::Value,
        before: String,
    },
    Confirm,
    Rollback,
    Time,
    Timezones,
    SetTime(serde_json::Value),
    Power(Power),
    Wifi,
    WifiScan,
    WifiRadio(bool),
    WifiForget(String),
    WifiConnect {
        body: serde_json::Value,
        before: String,
    },
    Hotspot,
    SetHotspot {
        body: serde_json::Value,
        before: String,
    },
    Display,
    SetDisplay(Option<u8>),
    TouchCalibration,
}

fn send(job: Job) {
    static TX: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();
    let tx = TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        // A thread of its own with `block_on`, like `net_worker` (Q55): the
        // render loop never waits for the network.
        let _ = std::thread::Builder::new()
            .name("sws-ctl-panel".into())
            .spawn(move || {
                let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                else {
                    return;
                };
                while let Ok(job) = rx.recv() {
                    rt.block_on(run(job));
                }
            });
        Mutex::new(tx)
    });
    let _ = tx.lock().unwrap_or_else(|e| e.into_inner()).send(job);
}

struct Reply {
    status: u16,
    body: serde_json::Value,
}

async fn call(
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<Reply, String> {
    let (base_url, token) = with_state(|s| (s.base_url.clone(), s.token.clone()));
    let config = crate::tls::pinned_client_config(&base_url).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(config)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}/api/control-panel{path}", base_url.trim_end_matches('/'));
    let mut req = client.request(method, url);
    if let Some(t) = token {
        req = req.header(SESSION_HEADER, t);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.json::<serde_json::Value>().await.unwrap_or_default();
    Ok(Reply { status, body })
}

/// A session call: `Some(body)` when it went through. An expired session goes
/// back to the PIN, any other failure becomes the error line.
async fn session_call(
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Option<serde_json::Value> {
    let r = call(method, path, body).await;
    let mut out = None;
    change(|s| {
        s.busy = false;
        match r {
            Ok(r) if r.status == 401 => s.expired(),
            Ok(r) if (200..300).contains(&r.status) => {
                s.error = None;
                out = Some(r.body);
            }
            Ok(r) => {
                s.error = Some(
                    r.body
                        .get("error")
                        .and_then(|e| e.as_str())
                        .map_or_else(|| format!("HTTP {}", r.status), str::to_string),
                )
            }
            Err(e) => s.error = Some(e),
        }
    });
    out
}

/// A change under the 60-second checkpoint: on success, the confirmation bar.
async fn confirmable(method: reqwest::Method, path: &str, body: serde_json::Value, before: String) {
    if let Some(r) = session_call(method, path, Some(body)).await {
        let secs = r
            .get("confirm_within_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(60);
        change(|s| {
            s.pending = Some(Pending {
                until: Instant::now() + Duration::from_secs(secs),
                before,
            });
            s.draft = None;
            s.wifi_form = None;
            s.reload_network_at = Some(Instant::now() + Duration::from_secs(3));
        });
    }
}

fn parse<T: serde::de::DeserializeOwned>(v: Option<serde_json::Value>) -> Option<T> {
    v.and_then(|v| serde_json::from_value(v).ok())
}

async fn run(job: Job) {
    use reqwest::Method as M;
    match job {
        Job::Status => {
            if let Ok(r) = call(M::GET, "", None).await {
                if let Some(on) = r.body.get("enabled").and_then(|e| e.as_bool()) {
                    change(|s| s.enabled = on);
                }
                // The device's brightness wins over the project's, also
                // before anyone opens the panel.
                if r.body.get("brightness").is_some() {
                    let b = r
                        .body
                        .get("brightness")
                        .and_then(|b| b.as_u64())
                        .map(|b| b.clamp(5, 100) as u8);
                    crate::schermo::device_brightness(b);
                }
            }
        }
        Job::Session(pin) => {
            let r = call(M::POST, "/session", Some(serde_json::json!({ "pin": pin }))).await;
            let opened = matches!(&r, Ok(r) if r.status == 200);
            change(|s| {
                s.busy = false;
                match r {
                    Ok(r) if r.status == 200 => {
                        s.token = r
                            .body
                            .get("token")
                            .and_then(|t| t.as_str())
                            .map(str::to_string);
                        s.screen = Screen::Panel;
                        s.pin.clear();
                        s.pin_error = None;
                    }
                    Ok(r) if r.status == 429 => {
                        s.pin.clear();
                        s.pin_error = Some(PinError::Locked(
                            r.body
                                .get("retry_after_secs")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(60),
                        ));
                    }
                    Ok(r) if r.status == 401 => {
                        s.pin.clear();
                        s.pin_error = Some(PinError::Wrong);
                    }
                    Ok(r) => s.error = Some(format!("HTTP {}", r.status)),
                    Err(e) => s.error = Some(e),
                }
            });
            if opened {
                let caps = parse::<Capabilities>(session_call(M::GET, "/capabilities", None).await);
                let info = parse::<DeviceInfo>(session_call(M::GET, "/info", None).await);
                change(|s| {
                    s.caps = caps;
                    s.info = info;
                });
                let section = with_state(|s| s.section);
                select(section);
            }
        }
        Job::Network => {
            if let Some(cards) = parse::<Vec<Card>>(session_call(M::GET, "/network", None).await) {
                change(|s| s.cards = Some(cards));
            }
        }
        Job::SetIpv4 {
            card,
            change: body,
            before,
        } => {
            let path = format!("/network/{card}");
            if let Some(r) = session_call(M::PUT, &path, Some(body)).await {
                let secs = r
                    .get("confirm_within_secs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(60);
                change(|s| {
                    s.pending = Some(Pending {
                        until: Instant::now() + Duration::from_secs(secs),
                        before,
                    });
                    s.draft = None;
                    s.reload_network_at = Some(Instant::now() + Duration::from_secs(3));
                });
            }
        }
        Job::Confirm => {
            session_call(M::POST, "/network/confirm", None).await;
            change(|s| s.pending = None);
            match with_state(|s| s.section) {
                Section::Wifi => {
                    send(Job::Wifi);
                    send(Job::Hotspot);
                }
                _ => send(Job::Network),
            }
        }
        Job::Rollback => {
            session_call(M::POST, "/network/rollback", None).await;
            change(|s| {
                s.pending = None;
                s.reload_network_at = Some(Instant::now() + Duration::from_secs(2));
            });
        }
        Job::Time => {
            if let Some(t) = parse::<TimeState>(session_call(M::GET, "/time", None).await) {
                change(|s| s.time = Some((t, Instant::now())));
            }
        }
        Job::Timezones => {
            if let Some(z) = parse::<Vec<String>>(session_call(M::GET, "/timezones", None).await) {
                change(|s| s.zones = z);
            }
        }
        Job::SetTime(body) => {
            session_call(M::PUT, "/time", Some(body)).await;
            send(Job::Time);
        }
        Job::Wifi => {
            if let Some(w) = parse::<WifiState>(session_call(M::GET, "/wifi", None).await) {
                change(|s| s.wifi = Some(w));
            }
        }
        Job::Hotspot => {
            if let Some(h) = parse::<Hotspot>(session_call(M::GET, "/wifi/hotspot", None).await) {
                change(|s| s.hotspot = Some(h));
            }
        }
        Job::WifiScan => {
            session_call(M::POST, "/wifi/scan", None).await;
            change(|s| s.reload_network_at = Some(Instant::now() + Duration::from_secs(3)));
        }
        Job::WifiRadio(on) => {
            session_call(
                M::PUT,
                "/wifi/radio",
                Some(serde_json::json!({ "enabled": on })),
            )
            .await;
            change(|s| s.reload_network_at = Some(Instant::now() + Duration::from_secs(2)));
        }
        Job::WifiForget(ssid) => {
            session_call(
                M::POST,
                "/wifi/forget",
                Some(serde_json::json!({ "ssid": ssid })),
            )
            .await;
            send(Job::Wifi);
        }
        Job::WifiConnect { body, before } => {
            confirmable(M::POST, "/wifi/connect", body, before).await;
        }
        Job::SetHotspot { body, before } => {
            confirmable(M::PUT, "/wifi/hotspot", body, before).await;
        }
        Job::Display => {
            if let Some(d) = session_call(M::GET, "/display", None).await {
                let b = d
                    .get("brightness")
                    .and_then(|b| b.as_u64())
                    .map(|b| b.clamp(5, 100) as u8);
                change(|s| {
                    s.brightness = Some(b);
                    s.brightness_draft = b.unwrap_or(80);
                });
            }
        }
        Job::SetDisplay(b) => {
            session_call(
                M::PUT,
                "/display",
                Some(serde_json::json!({ "brightness": b })),
            )
            .await;
        }
        Job::TouchCalibration => {
            session_call(M::POST, "/touch-calibration", None).await;
        }
        Job::Power(p) => {
            let path = match p {
                Power::Reboot => "/reboot",
                Power::PowerOff => "/power-off",
            };
            if session_call(M::POST, path, None).await.is_some() {
                change(|s| s.powering = Some(p));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_words_are_the_webs_in_the_content_language() {
        assert_eq!(word("it", "title", &[]), "Impostazioni dispositivo");
        assert_eq!(word("en", "state.unavailable", &[]), "cable unplugged");
        assert_eq!(
            word("it", "pinLocked", &[("secs", "42")]),
            "Troppi tentativi: riprova fra 42 s."
        );
        assert_eq!(panel_language("it-IT"), "it");
        assert_eq!(panel_language("de"), "en");
        assert_eq!(panel_language(""), "en");
    }

    #[test]
    fn the_wifi_form_wants_a_wpa_password() {
        let mut f = WifiForm {
            ssid: "Officina".into(),
            ..WifiForm::default()
        };
        assert!(f.valid(), "an open network needs none");
        f.password = "corta".into();
        assert!(!f.valid());
        f.password = "abbastanza".into();
        assert!(f.valid());
        f.password.clear();
        f.needs_password = true;
        assert!(!f.valid(), "a WPA network not saved yet needs one");
        f.needs_password = false;
        f.hotspot = true;
        assert!(!f.valid(), "the hotspot always has one");
        assert!(!is_psk("pàssword1"));
    }

    #[test]
    fn a_static_address_is_checked_before_it_is_sent() {
        let card = Card {
            name: "eth0".into(),
            state: "connected".into(),
            mac: None,
            addresses: vec!["192.168.1.242/24".into()],
            gateway: Some("192.168.1.254".into()),
            dns: vec![],
            method: Some("auto".into()),
        };
        let mut d = Draft::of(&card);
        assert!(!d.manual);
        assert_eq!(d.change(), serde_json::json!({ "method": "auto" }));
        d.manual = true;
        assert!(d.valid());
        d.fields[0] = "192.168.1.300".into();
        assert!(!d.valid());
        d.fields[0] = "192.168.1.50".into();
        d.fields[1] = "33".into();
        assert!(d.field_bad(1));
        d.fields[1] = "24".into();
        assert_eq!(
            d.change(),
            serde_json::json!({ "method": "manual", "address": "192.168.1.50", "prefix": 24, "gateway": "192.168.1.254", "dns": [] })
        );
    }

    #[test]
    fn only_a_still_finger_in_the_corner_is_the_gesture() {
        let t0 = Instant::now();
        let mut g = Gesture::default();
        // Outside the corner: LVGL has it.
        assert_eq!(decide(&mut g, true, 500, 20, true, 1024, t0), Pointer::Pass);
        assert_eq!(
            decide(&mut g, true, 500, 20, false, 1024, t0),
            Pointer::Pass
        );
        // In the corner: held back, and released early it becomes a click.
        assert_eq!(
            decide(&mut g, true, 1000, 20, true, 1024, t0),
            Pointer::Withhold
        );
        assert_eq!(
            decide(&mut g, true, 1005, 25, true, 1024, t0),
            Pointer::Withhold
        );
        assert_eq!(
            decide(&mut g, true, 1005, 25, false, 1024, t0),
            Pointer::Click
        );
        // A drag out of the tolerance goes back to LVGL.
        assert_eq!(
            decide(&mut g, true, 1000, 20, true, 1024, t0),
            Pointer::Withhold
        );
        assert_eq!(
            decide(&mut g, true, 1000, 60, true, 1024, t0),
            Pointer::Pass
        );
        assert_eq!(
            decide(&mut g, true, 1000, 60, false, 1024, t0),
            Pointer::Pass
        );
        // Disabled by the project: nothing is held back.
        assert_eq!(
            decide(&mut g, false, 1000, 20, true, 1024, t0),
            Pointer::Pass
        );
    }

    #[test]
    fn the_manual_time_is_local() {
        let m = ManualTime {
            date: "2026-11-14".into(),
            time: "09:30".into(),
            focus: 0,
        };
        let usec = manual_time_usec(&m).expect("a valid date");
        let back = chrono::DateTime::from_timestamp_micros(usec)
            .unwrap()
            .with_timezone(&chrono::Local);
        assert_eq!(
            back.format("%Y-%m-%d %H:%M").to_string(),
            "2026-11-14 09:30"
        );
        assert!(manual_time_usec(&ManualTime {
            date: "2026-13-01".into(),
            ..m
        })
        .is_none());
    }
}
