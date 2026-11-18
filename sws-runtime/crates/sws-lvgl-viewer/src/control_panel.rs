//! The device control panel on the LVGL viewer (plan
//! `docs/archive/2026-11-13-pannello-di-controllo.md`, phase 3): the twin of
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
//! 2 and 3 follow the project (`control_panel.enabled`, split in `gesture_enabled`
//! and `button_enabled`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;

pub const CORNER_PX: i32 = 80;
pub const HOLD: Duration = Duration::from_millis(5_000);
/// A touch in a corner counts for nothing during this first moment: no ring, no
/// counting. A tap or a brush on a button there must not look like the start of
/// a gesture (TY570, 15-11-2026: «non c'è un delay prima di iniziare a contare i
/// 5 secondi»). The time of the gesture is counted after it.
pub const GRACE: Duration = Duration::from_millis(1_000);
pub const MOVE_TOLERANCE_PX: i32 = 15;
pub const BOOT_BUTTON: Duration = Duration::from_secs(5);
/// How often an open panel looks at the cards again.
const WATCH_CARDS: Duration = Duration::from_secs(3);
const SESSION_HEADER: &str = "x-sws-control-panel";
/// A request the panel makes by itself: it does not keep the session alive.
const WATCH_HEADER: &str = "x-sws-control-panel-watch";

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

// ── Time zones ───────────────────────────────────────────────────────────────
//
// Continent, then country, then city, or a filter over all three (TY570,
// 14-11-2026: one list of 400 names could not be used on a 7" screen). The
// same rules as `sws-editor/src/control-panel/timezones.ts`; the country names
// are the web's table, read at compile time.

/// One zone and its country (ISO 3166 code), as the runtime reads `zone.tab`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Zone {
    pub zone: String,
    pub country: Option<String>,
}

pub const CONTINENTS: [&str; 10] = [
    "Europe",
    "America",
    "Asia",
    "Africa",
    "Australia",
    "Pacific",
    "Atlantic",
    "Indian",
    "Antarctica",
    "Arctic",
];
pub const OTHER: &str = "other";

pub fn continent_of(zone: &str) -> &'static str {
    let c = zone.split_once('/').map_or("", |(c, _)| c);
    CONTINENTS
        .iter()
        .find(|x| **x == c)
        .copied()
        .unwrap_or(OTHER)
}

/// `America/Argentina/Buenos_Aires` → `Buenos Aires`.
pub fn city_of(zone: &str) -> String {
    zone.rsplit('/').next().unwrap_or(zone).replace('_', " ")
}

pub fn country_name(code: &str, lang: &str) -> String {
    static NAMES: OnceLock<serde_json::Value> = OnceLock::new();
    let names = NAMES.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../sws-editor/src/i18n/countries.json"
        ))
        .unwrap_or_default()
    });
    let lang = if lang == "it" { "it" } else { "en" };
    names[lang][code]
        .as_str()
        .or_else(|| names["en"][code].as_str())
        // The typographic apostrophe of «Costa d’Avorio»: not every panel font has it.
        .map_or_else(|| code.to_string(), |n| n.replace('’', "'"))
}

/// `Rome — Italia`, or the city alone for a zone without a country.
pub fn zone_label(z: &Zone, lang: &str) -> String {
    match &z.country {
        Some(c) => format!("{} — {}", city_of(&z.zone), country_name(c, lang)),
        None => city_of(&z.zone),
    }
}

/// The zones a person picks from: those with a country, and UTC. tzdata also
/// lists ~180 old aliases with no country (`US/Eastern`, `Etc/GMT+1`,
/// `Europe/Belfast`: TY570, 14-11-2026); among the countries they were noise.
pub fn pickable(z: &Zone) -> bool {
    z.country.is_some() || z.zone == "UTC"
}

pub fn continents_in(zones: &[Zone]) -> Vec<&'static str> {
    CONTINENTS
        .iter()
        .copied()
        .chain([OTHER])
        .filter(|c| {
            zones
                .iter()
                .any(|z| pickable(z) && continent_of(&z.zone) == *c)
        })
        .collect()
}

/// A row of the second step: a country with its zones, or a zone without a
/// country (`code: None`), picked directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CountryEntry {
    pub code: Option<String>,
    pub name: String,
    pub zones: Vec<String>,
}

pub fn countries_in(zones: &[Zone], continent: &str, lang: &str) -> Vec<CountryEntry> {
    let mut by: Vec<CountryEntry> = Vec::new();
    let mut loose = Vec::new();
    for z in zones
        .iter()
        .filter(|z| pickable(z) && continent_of(&z.zone) == continent)
    {
        match &z.country {
            None => loose.push(CountryEntry {
                code: None,
                name: city_of(&z.zone),
                zones: vec![z.zone.clone()],
            }),
            Some(c) => match by.iter_mut().find(|e| e.code.as_deref() == Some(c)) {
                Some(e) => e.zones.push(z.zone.clone()),
                None => by.push(CountryEntry {
                    code: Some(c.clone()),
                    name: country_name(c, lang),
                    zones: vec![z.zone.clone()],
                }),
            },
        }
    }
    by.sort_by_key(|e| fold(&e.name));
    loose.sort_by_key(|e| fold(&e.name));
    by.extend(loose);
    by
}

/// Lowercase, with the accents of the Latin letters taken off: «Itàl» finds Italia.
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ý' | 'ÿ' => 'y',
            '_' => ' ',
            c => c,
        })
        .collect()
}

/// The zones whose city, country or name contain `filter`, accents ignored.
pub fn search_zones(zones: &[Zone], filter: &str, lang: &str, max: usize) -> Vec<Zone> {
    let f = fold(filter.trim());
    if f.is_empty() {
        return Vec::new();
    }
    let mut found: Vec<Zone> = zones
        .iter()
        .filter(|z| pickable(z))
        .filter(|z| {
            // The city path, not the continent: «ro» would find every «Europe/…».
            fold(
                z.zone
                    .split_once('/')
                    .map_or(z.zone.as_str(), |(_, rest)| rest),
            )
            .contains(&f)
                || z.country
                    .as_deref()
                    .is_some_and(|c| fold(&country_name(c, lang)).contains(&f))
        })
        .cloned()
        .collect();
    found.sort_by_key(|z| fold(&zone_label(z, lang)));
    found.truncate(max);
    found
}

/// Where the time zone picker stands: the filter, or the steps chosen so far.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TzPicker {
    pub filter: String,
    pub typing: bool,
    pub continent: Option<String>,
    pub country: Option<String>,
}

/// The runtime's error, in words when it is one of its stable codes — the
/// same rule as `errorText` on the web.
pub fn error_text(e: &str, lang: &str) -> String {
    if e == "wifi-wrong-password" {
        word(lang, "wifiWrongPassword", &[])
    } else if e.starts_with("wifi-failed") {
        word(lang, "wifiFailed", &[])
    } else if e == "usb-not-mounted" {
        word(lang, "diagnosticsNoUsb", &[])
    } else if e == "usb-mounting" {
        word(lang, "diagnosticsMounting", &[])
    } else if e == "usb-format" {
        word(lang, "diagnosticsFormat", &[])
    } else {
        e.to_string()
    }
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
    #[serde(default)]
    pub reboot_corner: bool,
    /// OpenPLC is installed here: the panel shows its section (CRA D20).
    #[serde(default)]
    pub openplc: bool,
}

/// The corner that reboots the device when held (`sws_web::control_panel`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RebootCorner {
    #[default]
    None,
    TopLeft,
    TopRight,
    BottomRight,
    BottomLeft,
}

/// How the corner that opens the panel behaves: the two measures of the
/// reboot corner, without the question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(default)]
pub struct PanelOptions {
    pub hold_secs: u8,
    pub size_px: u16,
}

impl Default for PanelOptions {
    fn default() -> Self {
        Self {
            hold_secs: HOLD.as_secs() as u8,
            size_px: CORNER_PX as u16,
        }
    }
}

/// How the corner behaves when this viewer watches it (Tiny TY).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(default)]
pub struct RebootOptions {
    pub hold_secs: u8,
    pub size_px: u16,
    pub confirm: bool,
}

impl Default for RebootOptions {
    fn default() -> Self {
        Self {
            hold_secs: 5,
            size_px: 100,
            confirm: false,
        }
    }
}

/// How long the question «reboot?» waits for an answer.
const REBOOT_ASK: Duration = Duration::from_secs(15);

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

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Card {
    pub name: String,
    pub state: String,
    pub mac: Option<String>,
    pub addresses: Vec<String>,
    /// The IPv6 addresses that are not link-local.
    #[serde(default)]
    pub addresses6: Vec<String>,
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
    #[serde(default)]
    pub drift: Option<ClockDrift>,
    #[serde(default)]
    pub ntp_servers: Option<NtpServers>,
}

/// The system's own NTP servers, or one to four written by hand.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, serde::Serialize)]
pub struct NtpServers {
    pub manual: bool,
    #[serde(default)]
    pub servers: Vec<String>,
}

pub const MAX_NTP_SERVERS: usize = 4;

/// The same rule as the runtime (`sws_web::control_panel::backend`).
pub fn valid_ntp_server(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'))
        && !s.starts_with(['-', '.'])
}

/// The NTP servers being typed: one line, names or addresses with a space
/// between them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NtpForm {
    pub text: String,
    pub shift: bool,
    pub symbols: bool,
}

impl NtpForm {
    pub fn servers(&self) -> Vec<String> {
        self.text
            .split([' ', ','])
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    }

    pub fn valid(&self) -> bool {
        let servers = self.servers();
        (1..=MAX_NTP_SERVERS).contains(&servers.len())
            && servers.iter().all(|s| valid_ntp_server(s))
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct ClockDrift {
    pub ppm: f64,
    pub offset_secs: f64,
}

/// The numbers of a drift for its text: ppm, seconds a day, milliseconds off.
pub fn drift_words(d: &ClockDrift) -> [(&'static str, String); 3] {
    [
        ("ppm", format!("{:.1}", d.ppm.abs())),
        ("perDay", format!("{:.1}", d.ppm.abs() * 0.0864)),
        ("offset", format!("{:.1}", d.offset_secs.abs() * 1000.0)),
    ]
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceInfo {
    pub model: Option<String>,
    pub serial: Option<String>,
    pub hostname: String,
    pub sws_version: String,
    pub initial_pin: Option<String>,
    /// The cloud the panel is paired to: the reset can then keep it.
    #[serde(default)]
    pub cloud: Option<String>,
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
    OpenPlc,
    About,
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
    /// Sent to the device, waiting for its answer: no keyboard meanwhile.
    pub submitting: bool,
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
    /// The gesture opens the panel (`control_panel.enabled` and
    /// `gesture_enabled` of the project); until the runtime answers, on.
    pub enabled: bool,
    /// The synoptic button opens it (`enabled` and `button_enabled`).
    pub button_enabled: bool,
    pub boot_until: Option<Instant>,
    pub screen: Screen,
    pub pin: String,
    pub pin_error: Option<PinError>,
    /// The PIN screen is asking the PIN again, to give the device back
    /// (project, users and pairing removed): not to open a session.
    pub resetting: bool,
    /// The reset keeps the cloud pairing: only the application goes.
    pub reset_keep_cloud: bool,
    /// The reset went through: the runtime is starting again.
    pub reset_done: bool,
    pub busy: bool,
    token: Option<String>,
    pub caps: Option<Capabilities>,
    pub info: Option<DeviceInfo>,
    /// `GET /about` as it came: `control_panel_about` reads it.
    pub about: Option<serde_json::Value>,
    /// `GET /openplc` as it came: [`openplc_rows`] reads it.
    pub openplc: Option<serde_json::Value>,
    /// The diagnostic export to the USB stick: being written, or how it ended.
    pub diagnostics: Option<Result<String, String>>,
    pub diagnostics_busy: bool,
    pub section: Section,
    pub cards: Option<Vec<Card>>,
    pub draft: Option<Draft>,
    pub pending: Option<Pending>,
    /// The device time and when it was read: the clock runs on from there.
    pub time: Option<(TimeState, Instant)>,
    pub zones: Vec<Zone>,
    pub tz: Option<TzPicker>,
    pub manual_time: Option<ManualTime>,
    pub ask: Option<Power>,
    pub powering: Option<Power>,
    pub wifi: Option<WifiState>,
    pub hotspot: Option<Hotspot>,
    pub wifi_form: Option<WifiForm>,
    /// The NTP servers being typed, on the same keyboard.
    pub ntp_form: Option<NtpForm>,
    /// The device's brightness as the runtime has it: `Some(None)` = the
    /// project's. `None` = not read yet.
    pub brightness: Option<Option<u8>>,
    /// The slider, also while it moves.
    pub brightness_draft: u8,
    /// The reboot corner as the runtime has it; the options only where this
    /// viewer watches the corner. `None` = not read yet.
    pub reboot_corner: Option<(RebootCorner, Option<RebootOptions>)>,
    /// `false`: the project switched the reboot corner off.
    pub reboot_corner_allowed: bool,
    /// The device mounted upside down; `None` where the system turns the
    /// screen, not this viewer.
    pub flipped: Option<bool>,
    /// The corner that opens this panel, as the Screen section read it.
    pub panel_corner: Option<RebootCorner>,
    pub panel_options: PanelOptions,
    /// The corner was held and wants a confirmation, until this instant.
    pub reboot_ask: Option<Instant>,
    /// The corner asked for a reboot: the notice is on screen.
    pub rebooting: bool,
    pub calibration: Option<Calibration>,
    /// The matrix in use before the calibration: back to it on Redo, on
    /// Cancel and when nobody touches.
    calibration_previous: Option<crate::touch_calibration::Matrix>,
    /// A note under the Screen section after a calibration ends.
    pub calibration_note: Option<&'static str>,
    pub error: Option<String>,
    reload_network_at: Option<Instant>,
    /// The next look at the cards while the panel is open: a Wi-Fi dongle
    /// plugged in or pulled out shows up by itself, and turns the Wi-Fi
    /// section on or off (TY570, 14-11-2026).
    watch_cards_at: Option<Instant>,
    boot_shown: bool,
}

impl State {
    fn changed(&mut self) {
        self.generation += 1;
        ARMED.store(
            self.enabled && self.screen == Screen::Closed,
            Ordering::Relaxed,
        );
        REBOOT_ARMED.store(
            self.screen == Screen::Closed && self.reboot_ask.is_none() && !self.rebooting,
            Ordering::Relaxed,
        );
    }

    /// Back to the PIN: the service session expired, or the runtime restarted.
    fn expired(&mut self) {
        let base_url = std::mem::take(&mut self.base_url);
        let (enabled, button_enabled, generation) =
            (self.enabled, self.button_enabled, self.generation);
        *self = State {
            base_url,
            enabled,
            button_enabled,
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
            button_enabled: true,
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
            "time" | "timezone" | "timezone-america" | "timezone-us" | "timezone-filter" => {
                Section::Time
            }
            "device" => Section::Device,
            "about" => Section::About,
            "openplc" => Section::OpenPlc,
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
    // The time zone picker at one of its steps, for the snapshots.
    if let Some(step) = section.strip_prefix("timezone") {
        change(|s| {
            s.tz = Some(TzPicker {
                continent: matches!(step, "-america" | "-us").then(|| "America".into()),
                country: (step == "-us").then(|| "US".into()),
                filter: if step == "-filter" {
                    "ro".into()
                } else {
                    String::new()
                },
                typing: step == "-filter",
            })
        });
    }
}

/// The project may have changed (a reload): read `enabled` again.
pub fn refresh_status() {
    send(Job::Status);
}

/// Opens the PIN. `always`: the boot button, which ignores the project.
pub fn open(always: bool) {
    change(|s| {
        // The synoptic button follows its own switch; the boot button is always.
        if s.screen == Screen::Closed && (always || s.button_enabled) {
            s.expired();
            s.boot_until = None;
        }
    });
}

pub fn close() {
    change(|s| {
        let base_url = std::mem::take(&mut s.base_url);
        let (enabled, button_enabled, generation) = (s.enabled, s.button_enabled, s.generation);
        *s = State {
            base_url,
            enabled,
            button_enabled,
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
    let pin = with_state(|s| {
        (!s.busy && !s.pin.is_empty()).then(|| (s.pin.clone(), s.resetting, s.reset_keep_cloud))
    });
    if let Some((pin, resetting, keep_cloud)) = pin {
        change(|s| s.busy = true);
        send(if resetting {
            Job::Reset(pin, keep_cloud)
        } else {
            Job::Session(pin)
        });
    }
}

/// «Remove project and pairing», or with `keep_cloud` only the project: the
/// PIN screen again, in its other role.
pub fn reset_ask(keep_cloud: bool) {
    change(|s| {
        s.resetting = true;
        s.reset_keep_cloud = keep_cloud;
        s.pin.clear();
        s.pin_error = None;
        s.error = None;
        s.screen = Screen::Pin;
    });
}

pub fn reset_cancel() {
    change(|s| {
        s.resetting = false;
        s.pin.clear();
        s.pin_error = None;
        s.screen = Screen::Panel;
    });
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
        s.ntp_form = None;
        s.calibration_note = None;
    });
    match section {
        Section::Network => send(Job::Network),
        Section::Wifi => {
            send(Job::Wifi);
            send(Job::Hotspot);
            // The addresses of the network joined, as the Network section has them.
            send(Job::Network);
        }
        Section::Time => {
            send(Job::Time);
            send(Job::Timezones);
        }
        Section::Screen => send(Job::Display),
        Section::Device => {}
        Section::OpenPlc => send(Job::OpenPlc),
        Section::About => send(Job::About),
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
    // Shown at once: the system takes seconds to switch, and a choice that
    // does not move looks broken. The read after the change has the truth.
    change(|s| {
        if let Some((t, _)) = s.time.as_mut() {
            t.ntp = on;
            t.ntp_synchronized = false;
            t.drift = None;
        }
        // A manual time left half typed would switch NTP off again when applied.
        if on {
            s.manual_time = None;
        }
    });
    send(Job::SetTime(serde_json::json!({ "ntp": on })));
}

/// Automatic applies at once, with the servers typed before kept for next
/// time; manual opens the keyboard, and applies when the servers are in.
pub fn ntp_servers_mode(manual: bool) {
    let current = with_state(|s| {
        s.time
            .as_ref()
            .and_then(|(t, _)| t.ntp_servers.clone())
            .unwrap_or_default()
    });
    if manual {
        ntp_servers_edit();
    } else if current.manual {
        change(|s| s.ntp_form = None);
        send(Job::SetTime(serde_json::json!({
            "ntp_servers": { "manual": false, "servers": current.servers }
        })));
    }
}

pub fn ntp_servers_edit() {
    change(|s| {
        let servers = s
            .time
            .as_ref()
            .and_then(|(t, _)| t.ntp_servers.as_ref())
            .map(|n| n.servers.join(" "))
            .unwrap_or_default();
        s.manual_time = None;
        s.tz = None;
        s.ntp_form = Some(NtpForm {
            text: servers,
            // Addresses first: the digits are on the symbols page.
            symbols: true,
            ..Default::default()
        });
    });
}

/// Writes the diagnostic export on the USB stick.
pub fn diagnostics_to_usb() {
    let busy = with_state(|s| s.diagnostics_busy);
    if busy {
        return;
    }
    change(|s| {
        s.diagnostics_busy = true;
        s.diagnostics = None;
    });
    send(Job::DiagnosticsUsb);
}

pub fn set_timezone(zone: &str) {
    send(Job::SetTime(serde_json::json!({ "timezone": zone })));
}

pub fn tz_open() {
    change(|s| {
        s.manual_time = None;
        s.tz = Some(TzPicker::default());
    });
}

pub fn tz_cancel() {
    change(|s| s.tz = None);
}

/// Back to a step: 0 the continents, 1 the countries of the continent.
pub fn tz_back(step: u8) {
    change(|s| {
        if let Some(p) = s.tz.as_mut() {
            p.country = None;
            if step == 0 {
                p.continent = None;
            }
        }
    });
}

pub fn tz_continent(c: &str) {
    change(|s| {
        if let Some(p) = s.tz.as_mut() {
            p.continent = Some(c.to_string());
            p.country = None;
        }
    });
}

/// A country: its only zone is chosen at once, otherwise its cities follow.
pub fn tz_country(code: &str) {
    let only = with_state(|s| {
        let zones: Vec<&Zone> = s
            .zones
            .iter()
            .filter(|z| z.country.as_deref() == Some(code))
            .collect();
        (zones.len() == 1).then(|| zones[0].zone.clone())
    });
    match only {
        Some(z) => tz_pick(&z),
        None => change(|s| {
            if let Some(p) = s.tz.as_mut() {
                p.country = Some(code.to_string());
            }
        }),
    }
}

pub fn tz_pick(zone: &str) {
    change(|s| s.tz = None);
    set_timezone(zone);
}

pub fn tz_focus() {
    change(|s| {
        if let Some(p) = s.tz.as_mut() {
            p.typing = true;
        }
    });
}

/// A key of the filter keyboard: a letter, `⌫`, ` `, or `⏎` to close it.
pub fn tz_key(k: &str) {
    change(|s| {
        let Some(p) = s.tz.as_mut() else {
            return;
        };
        match k {
            "⏎" => p.typing = false,
            "⌫" => {
                p.filter.pop();
            }
            _ if p.filter.chars().count() < 30 => p.filter.push_str(k),
            _ => {}
        }
    });
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
        if let Some(f) = s.ntp_form.as_mut() {
            match k {
                "⇧" => f.shift = !f.shift,
                "?123" | "abc" => f.symbols = !f.symbols,
                "⌫" => {
                    f.text.pop();
                }
                _ if f.text.chars().count() < 4 * 64 => f.text.push_str(&k.to_ascii_lowercase()),
                _ => {}
            }
            return;
        }
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
    change(|s| {
        s.wifi_form = None;
        s.ntp_form = None;
    });
}

pub fn form_submit() {
    let ntp = with_state(|s| s.ntp_form.clone());
    if let Some(f) = ntp {
        if f.valid() {
            change(|s| s.ntp_form = None);
            send(Job::SetTime(serde_json::json!({
                "ntp_servers": { "manual": true, "servers": f.servers() }
            })));
        }
        return;
    }
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
        change(|s| {
            s.busy = true;
            if let Some(f) = s.wifi_form.as_mut() {
                f.submitting = true;
            }
        });
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

/// Changes the reboot corner or its options, here and on the runtime.
fn reboot_corner_change(f: impl FnOnce(&mut RebootCorner, &mut Option<RebootOptions>)) {
    let mut now = None;
    change(|s| {
        if let Some((corner, options)) = s.reboot_corner.as_mut() {
            f(corner, options);
            now = Some((*corner, *options));
        }
    });
    if let Some((corner, options)) = now {
        // Only where this viewer is the one that watches the corner.
        if let Some(o) = options {
            watch_reboot_corner(Some((corner, o)));
        }
        send(Job::SetRebootCorner(corner, options));
    }
}

/// The device mounted upside down: the picture turns at once, here and in
/// the runtime's settings.
pub fn flip_set(on: bool) {
    change(|s| s.flipped = Some(on));
    crate::rotation::set_flipped(on);
    send(Job::SetFlip(on));
}

/// Moves the corner that opens the panel, or switches it off.
pub fn panel_corner_set(corner: RebootCorner) {
    panel_corner_change(|c, _| *c = corner);
}

pub fn panel_hold_step(delta: i8) {
    panel_corner_change(|_, o| {
        o.hold_secs = (o.hold_secs as i16 + delta as i16).clamp(2, 15) as u8
    });
}

pub fn panel_size_step(delta: i16) {
    panel_corner_change(|_, o| o.size_px = (o.size_px as i16 + delta).clamp(40, 200) as u16);
}

fn panel_corner_change(f: impl FnOnce(&mut RebootCorner, &mut PanelOptions)) {
    let mut now = None;
    change(|s| {
        if let Some(corner) = s.panel_corner.as_mut() {
            f(corner, &mut s.panel_options);
            now = Some((*corner, s.panel_options));
        }
    });
    if let Some((corner, options)) = now {
        watch_panel_corner(corner, options);
        send(Job::SetPanelCorner(corner, options));
    }
}

pub fn reboot_corner_set(corner: RebootCorner) {
    reboot_corner_change(|c, _| *c = corner);
}

pub fn reboot_hold_step(delta: i8) {
    reboot_corner_change(|_, o| {
        if let Some(o) = o {
            o.hold_secs = (o.hold_secs as i8 + delta).clamp(2, 15) as u8;
        }
    });
}

pub fn reboot_size_step(delta: i16) {
    reboot_corner_change(|_, o| {
        if let Some(o) = o {
            o.size_px = (o.size_px as i16 + delta).clamp(40, 200) as u16;
        }
    });
}

pub fn reboot_confirm_set(confirm: bool) {
    reboot_corner_change(|_, o| {
        if let Some(o) = o {
            o.confirm = confirm;
        }
    });
}

/// The answer to «reboot?» after the corner was held.
pub fn reboot_answer(yes: bool) {
    if yes {
        reboot_now();
    } else {
        change(|s| s.reboot_ask = None);
    }
}

/// The reboot the corner asked for. `systemctl` goes through logind, which
/// the installation lets this user do; the runtime closes on its SIGTERM.
fn reboot_now() {
    change(|s| {
        s.reboot_ask = None;
        s.rebooting = true;
    });
    std::thread::spawn(|| {
        let outcome = std::process::Command::new("systemctl")
            .arg("reboot")
            .status();
        match outcome {
            Ok(st) if st.success() => {}
            Ok(st) => eprintln!("[control-panel] reboot corner: systemctl reboot: {st}"),
            Err(e) => eprintln!("[control-panel] reboot corner: systemctl reboot: {e}"),
        }
        // Still here after a while: the reboot did not happen.
        std::thread::sleep(Duration::from_secs(30));
        change(|s| s.rebooting = false);
    });
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
        if s.screen == Screen::Panel {
            match s.watch_cards_at {
                Some(t) if now >= t => {
                    s.watch_cards_at = Some(now + WATCH_CARDS);
                    jobs.push(Job::WatchCards);
                }
                None => s.watch_cards_at = Some(now + WATCH_CARDS),
                _ => {}
            }
        } else {
            s.watch_cards_at = None;
        }
        if s.calibration.is_some() && calibration_tick(&mut s, now) {
            changed = true;
        }
        if !s.boot_shown && s.boot_until.is_some_and(|t| now >= t) {
            s.boot_shown = true;
            s.boot_until = None;
            changed = true;
        }
        if s.reboot_ask.is_some_and(|t| now >= t) {
            s.reboot_ask = None;
            changed = true;
        }
        if changed {
            s.changed();
        }
    }
    match gesture_fires(now) {
        Some(Fired::Panel) => open(false),
        Some(Fired::Reboot { confirm: true }) => {
            change(|s| s.reboot_ask = Some(now + REBOOT_ASK));
        }
        Some(Fired::Reboot { confirm: false }) => reboot_now(),
        None => {}
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

/// Whether a new press may start the reboot corner: nothing of the panel is
/// on screen. The project's `enabled` does not count here.
static REBOOT_ARMED: AtomicBool = AtomicBool::new(true);

/// The reboot corner this viewer watches: `None` where it is not its work
/// (PixsysOS has its own) or no corner is chosen.
fn reboot_watch() -> &'static Mutex<Option<(RebootCorner, RebootOptions)>> {
    static W: OnceLock<Mutex<Option<(RebootCorner, RebootOptions)>>> = OnceLock::new();
    W.get_or_init(Mutex::default)
}

/// The corner that opens the panel: top right until the runtime says
/// otherwise, `None` when it was switched off from the panel.
fn panel_watch() -> &'static Mutex<(RebootCorner, PanelOptions)> {
    static W: OnceLock<Mutex<(RebootCorner, PanelOptions)>> = OnceLock::new();
    W.get_or_init(|| Mutex::new((RebootCorner::TopRight, PanelOptions::default())))
}

fn watch_panel_corner(c: RebootCorner, o: PanelOptions) {
    *panel_watch().lock().unwrap_or_else(|e| e.into_inner()) = (c, o);
}

fn watch_reboot_corner(w: Option<(RebootCorner, RebootOptions)>) {
    *reboot_watch().lock().unwrap_or_else(|e| e.into_inner()) =
        w.filter(|(c, _)| *c != RebootCorner::None);
}

#[derive(Debug, Clone, Copy)]
struct Hold {
    start: Instant,
    fired: bool,
    /// How long the finger must stay.
    hold: Duration,
    /// The corner it started in, and the side of its square.
    corner: RebootCorner,
    size: i32,
    /// `Some`: the reboot corner's options. `None`: the hold opens the panel.
    reboot: Option<RebootOptions>,
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

/// Whether a point is in the square of `size` pixels at a corner.
pub fn in_reboot_corner(
    corner: RebootCorner,
    size: i32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> bool {
    let (left, right) = (x <= size, x >= width - size);
    let (top, bottom) = (y <= size, y >= height - size);
    match corner {
        RebootCorner::None => false,
        RebootCorner::TopLeft => left && top,
        RebootCorner::TopRight => right && top,
        RebootCorner::BottomRight => right && bottom,
        RebootCorner::BottomLeft => left && bottom,
    }
}

/// A finger resting on the glass drifts and rolls: the hold lasts while it
/// stays in the corner it started in, and ends only when it leaves it by more
/// than the tolerance (TY570, 15-11-2026: a tolerance around the first touch
/// lost the gesture at every small movement).
fn still_held(h: &Hold, x: i32, y: i32, width: i32, height: i32) -> bool {
    in_reboot_corner(h.corner, h.size + MOVE_TOLERANCE_PX, x, y, width, height)
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

pub fn filter_pointer(
    x: i32,
    y: i32,
    pressed: bool,
    width: i32,
    height: i32,
    now: Instant,
) -> Pointer {
    let mut g = gesture().lock().unwrap_or_else(|e| e.into_inner());
    // Before the display exists there is no corner to speak of.
    let panel = if ARMED.load(Ordering::Relaxed) && width > 0 {
        *panel_watch().lock().unwrap_or_else(|e| e.into_inner())
    } else {
        (RebootCorner::None, PanelOptions::default())
    };
    let reboot = if REBOOT_ARMED.load(Ordering::Relaxed) && width > 0 {
        *reboot_watch().lock().unwrap_or_else(|e| e.into_inner())
    } else {
        None
    };
    decide(&mut g, panel, reboot, x, y, pressed, (width, height), now)
}

#[allow(clippy::too_many_arguments)]
fn decide(
    g: &mut Gesture,
    (panel, panel_options): (RebootCorner, PanelOptions),
    reboot: Option<(RebootCorner, RebootOptions)>,
    x: i32,
    y: i32,
    pressed: bool,
    (width, height): (i32, i32),
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
        if !still_held(&h, x, y, width, height) {
            // A drag, not the gesture: from here on LVGL has it.
            g.hold = None;
            return Pointer::Pass;
        }
        return Pointer::Withhold;
    }
    if !new_press {
        return Pointer::Pass;
    }
    // The panel's corner first: the runtime refuses the same one for both,
    // but a file written by hand must not hide the panel.
    let panel_size = panel_options.size_px as i32;
    let kind = if in_reboot_corner(panel, panel_size, x, y, width, height) {
        let hold = Duration::from_secs(panel_options.hold_secs as u64);
        Some((hold, panel, panel_size, None))
    } else {
        reboot
            .filter(|(c, o)| in_reboot_corner(*c, o.size_px as i32, x, y, width, height))
            .map(|(c, o)| {
                (
                    Duration::from_secs(o.hold_secs as u64),
                    c,
                    o.size_px as i32,
                    Some(o),
                )
            })
    };
    match kind {
        Some((hold, corner, size, reboot)) => {
            g.hold = Some(Hold {
                start: now,
                fired: false,
                hold,
                corner,
                size,
                reboot,
            });
            Pointer::Withhold
        }
        None => Pointer::Pass,
    }
}

/// How far the finger in the corner is, 0..1, for the ring; which corner it
/// is; and whether it is the one that reboots.
pub fn hold_progress(now: Instant) -> Option<(f32, RebootCorner, bool)> {
    let g = gesture().lock().unwrap_or_else(|e| e.into_inner());
    g.hold
        .filter(|h| !h.fired && now.duration_since(h.start) > GRACE)
        .map(|h| {
            let counted = now.duration_since(h.start) - GRACE;
            (
                (counted.as_secs_f32() / h.hold.as_secs_f32()).min(1.0),
                h.corner,
                h.reboot.is_some(),
            )
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fired {
    Panel,
    Reboot { confirm: bool },
}

fn gesture_fires(now: Instant) -> Option<Fired> {
    let mut g = gesture().lock().unwrap_or_else(|e| e.into_inner());
    fires(&mut g, now)
}

fn fires(g: &mut Gesture, now: Instant) -> Option<Fired> {
    match g.hold.as_mut() {
        Some(h) if !h.fired && now.duration_since(h.start) >= GRACE + h.hold => {
            h.fired = true;
            Some(match h.reboot {
                Some(o) => Fired::Reboot { confirm: o.confirm },
                None => Fired::Panel,
            })
        }
        _ => None,
    }
}

// ── The network thread ───────────────────────────────────────────────────────

enum Job {
    Status,
    SetRebootCorner(RebootCorner, Option<RebootOptions>),
    SetPanelCorner(RebootCorner, PanelOptions),
    Reset(String, bool),
    SetFlip(bool),
    Session(String),
    Network,
    /// The cards again, applied only if something changed.
    WatchCards,
    /// After a card came or went: the Wi-Fi section follows the dongle.
    Capabilities,
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
    About,
    OpenPlc,
    DiagnosticsUsb,
    SetDisplay(Option<u8>),
    TouchCalibration,
}

/// The OpenPLC section, from `GET /openplc` (CRA D20, 18-11-2026): label and
/// value rows, then the Editor's credentials, or the line that says why there
/// are none. Pure, like `control_panel_about`, so the tests need no screen.
pub struct OpenPlcView {
    pub state: Vec<(String, String)>,
    pub credentials: Vec<(String, String)>,
    pub note: String,
}

pub fn openplc_rows(v: &serde_json::Value, lang: &str) -> OpenPlcView {
    let w = |key: &str| word(lang, key, &[]);
    let port = |k: &str| {
        v.pointer(&format!("/ports/{k}"))
            .and_then(|p| p.as_u64())
            .map_or_else(|| "—".to_string(), |p| p.to_string())
    };
    let answers = v.get("answers").and_then(|a| a.as_bool()) == Some(true);
    let state = vec![
        (
            w("openplcState"),
            w(if answers {
                "openplcAnswers"
            } else {
                "openplcSilent"
            }),
        ),
        (
            w("openplcVersion"),
            v.get("version")
                .and_then(|x| x.as_str())
                .unwrap_or("—")
                .to_string(),
        ),
        (
            w("openplcPorts"),
            word(
                lang,
                "openplcPortsValue",
                &[
                    ("editor", &port("editor")),
                    ("modbus", &port("modbus")),
                    ("s7", &port("s7")),
                    ("opcua", &port("opcua")),
                ],
            ),
        ),
    ];
    let credentials = v.get("credentials").filter(|c| !c.is_null());
    let text = |c: &serde_json::Value, k: &str| {
        c.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };
    match credentials {
        Some(c) => OpenPlcView {
            state,
            credentials: vec![
                (w("openplcUser"), text(c, "username")),
                (w("openplcPassword"), text(c, "password")),
            ],
            note: word(lang, "openplcHelp", &[("port", &port("editor"))]),
        },
        None => {
            let flag = |k: &str| v.get(k).and_then(|u| u.as_bool()) == Some(true);
            OpenPlcView {
                state,
                credentials: Vec::new(),
                note: w(if flag("credentials_foreign") {
                    "openplcForeign"
                } else if flag("credentials_unknown") {
                    "openplcUnknown"
                } else {
                    "openplcNone"
                }),
            }
        }
    }
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
    call_as(method, path, body, false).await
}

/// `watch`: a request nobody asked for, which must not count as use of the
/// session (`WATCH_HEADER`).
async fn call_as(
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
    watch: bool,
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
    if watch {
        req = req.header(WATCH_HEADER, "1");
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
    let Some(r) = session_call(method, path, Some(body)).await else {
        // Refused: the form again, with the error above it.
        change(|s| {
            if let Some(f) = s.wifi_form.as_mut() {
                f.submitting = false;
            }
        });
        return;
    };
    {
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
                // The two ways, already composed with the master by the runtime.
                // An older runtime only has `enabled`: it stands for both.
                let master = r.body.get("enabled").and_then(|e| e.as_bool());
                let gesture = r
                    .body
                    .get("gesture_enabled")
                    .and_then(|e| e.as_bool())
                    .or(master);
                let button = r
                    .body
                    .get("button_enabled")
                    .and_then(|e| e.as_bool())
                    .or(master);
                if let (Some(gesture), Some(button)) = (gesture, button) {
                    change(|s| {
                        s.enabled = gesture;
                        s.button_enabled = button;
                    });
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
                // The device mounted upside down (`rotation.rs`).
                crate::rotation::set_flipped(
                    r.body.get("flipped").and_then(|f| f.as_bool()) == Some(true),
                );
                // Absent on an older runtime: top right, as it always was.
                if let Some(c) = r
                    .body
                    .get("panel_corner")
                    .and_then(|c| serde_json::from_value::<RebootCorner>(c.clone()).ok())
                {
                    let options = r
                        .body
                        .get("panel_corner_options")
                        .and_then(|o| serde_json::from_value::<PanelOptions>(o.clone()).ok())
                        .unwrap_or_default();
                    watch_panel_corner(c, options);
                }
                // `null` where the corner is not this viewer's to watch.
                let corner = r.body.get("reboot_corner").filter(|c| !c.is_null());
                watch_reboot_corner(corner.and_then(|c| {
                    Some((
                        serde_json::from_value(c.get("corner")?.clone()).ok()?,
                        serde_json::from_value(c.get("options")?.clone()).ok()?,
                    ))
                }));
            }
        }
        Job::Reset(pin, keep_cloud) => {
            let r = call(
                M::POST,
                "/reset",
                Some(serde_json::json!({ "pin": pin, "keep_cloud": keep_cloud })),
            )
            .await;
            change(|s| {
                s.busy = false;
                s.pin.clear();
                match r {
                    Ok(r) if (200..300).contains(&r.status) => {
                        s.resetting = false;
                        s.reset_done = true;
                        s.screen = Screen::Panel;
                    }
                    Ok(r) if r.status == 401 => s.expired(),
                    // A wrong PIN leaves the screen where it is, for another try.
                    Ok(r) if r.status == 429 => {
                        s.pin_error = Some(PinError::Locked(
                            r.body
                                .get("retry_after_secs")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(60),
                        ));
                    }
                    Ok(r) if r.status == 403 => s.pin_error = Some(PinError::Wrong),
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
        }
        Job::SetFlip(on) => {
            session_call(M::PUT, "/flip", Some(serde_json::json!({ "flipped": on }))).await;
        }
        Job::SetPanelCorner(corner, options) => {
            session_call(
                M::PUT,
                "/panel-corner",
                Some(serde_json::json!({ "corner": corner, "options": options })),
            )
            .await;
        }
        Job::SetRebootCorner(corner, options) => {
            session_call(
                M::PUT,
                "/reboot-corner",
                Some(serde_json::json!({ "corner": corner, "options": options })),
            )
            .await;
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
        Job::WatchCards => {
            // Not `session_call`: no error line, no `busy`, no rebuild unless
            // something changed — a rebuild every 3 s would close what the
            // person is typing or scrolling.
            let r = match call_as(M::GET, "/network", None, true).await {
                Ok(r) => r,
                Err(_) => return,
            };
            if r.status == 401 {
                change(|s| s.expired());
                return;
            }
            let Ok(cards) = serde_json::from_value::<Vec<Card>>(r.body) else {
                return;
            };
            let names = |c: &[Card]| c.iter().map(|c| c.name.clone()).collect::<Vec<_>>();
            let (same, plugged, section) = with_state(|s| {
                let old = s.cards.as_deref();
                (
                    old == Some(cards.as_slice()),
                    old.is_some_and(|o| names(o) != names(&cards)),
                    s.section,
                )
            });
            if same {
                return;
            }
            if matches!(section, Section::Network | Section::Wifi) {
                change(|s| s.cards = Some(cards));
            } else {
                // Kept for the comparison only: the section on screen does not show them.
                state().lock().unwrap_or_else(|e| e.into_inner()).cards = Some(cards);
            }
            if plugged {
                send(Job::Capabilities);
                if section == Section::Wifi {
                    send(Job::Wifi);
                    send(Job::Hotspot);
                }
            }
        }
        Job::Capabilities => {
            let caps = parse::<Capabilities>(session_call(M::GET, "/capabilities", None).await);
            if caps.is_some() {
                change(|s| s.caps = caps);
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
            if let Some(z) = parse::<Vec<Zone>>(session_call(M::GET, "/timezones", None).await) {
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
        Job::DiagnosticsUsb => {
            let r = call(M::POST, "/diagnostics/usb", None).await;
            change(|s| {
                s.diagnostics_busy = false;
                s.diagnostics = Some(match r {
                    Ok(r) if r.status == 401 => {
                        s.expired();
                        return;
                    }
                    Ok(r) if (200..300).contains(&r.status) => Ok(r
                        .body
                        .get("file")
                        .and_then(|f| f.as_str())
                        .unwrap_or_default()
                        .to_string()),
                    Ok(r) => Err(r
                        .body
                        .get("error")
                        .and_then(|e| e.as_str())
                        .map_or_else(|| format!("HTTP {}", r.status), str::to_string)),
                    Err(e) => Err(e),
                });
            });
        }
        Job::About => {
            if let Some(a) = session_call(M::GET, "/about", None).await {
                change(|s| s.about = Some(a));
            }
        }
        Job::OpenPlc => {
            if let Some(v) = session_call(M::GET, "/openplc", None).await {
                change(|s| s.openplc = Some(v));
            }
        }
        Job::Display => {
            if let Some(d) = session_call(M::GET, "/display", None).await {
                let b = d
                    .get("brightness")
                    .and_then(|b| b.as_u64())
                    .map(|b| b.clamp(5, 100) as u8);
                let corner = d
                    .get("reboot_corner")
                    .and_then(|c| serde_json::from_value::<RebootCorner>(c.clone()).ok());
                let panel = d
                    .get("panel_corner")
                    .and_then(|c| serde_json::from_value::<RebootCorner>(c.clone()).ok());
                let options = d
                    .get("reboot_corner_options")
                    .and_then(|o| serde_json::from_value::<RebootOptions>(o.clone()).ok());
                change(|s| {
                    s.brightness = Some(b);
                    s.brightness_draft = b.unwrap_or(80);
                    s.reboot_corner = corner.map(|c| (c, options));
                    s.panel_corner = panel;
                    s.panel_options = d
                        .get("panel_corner_options")
                        .and_then(|o| serde_json::from_value::<PanelOptions>(o.clone()).ok())
                        .unwrap_or_default();
                    s.flipped = d.get("flipped").and_then(|f| f.as_bool());
                    s.reboot_corner_allowed = d
                        .get("reboot_corner_allowed")
                        .and_then(|a| a.as_bool())
                        .unwrap_or(true);
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
    fn the_openplc_section_shows_the_editor_access() {
        let v = serde_json::json!({
            "installed": true, "answers": true, "version": "v4.3.1",
            "credentials": {"username": "admin", "password": "abc2345def"},
            "credentials_unknown": false,
            "ports": {"editor": 8443, "modbus": 1502, "s7": 10102, "opcua": 14840},
        });
        let OpenPlcView {
            state,
            credentials,
            note,
        } = openplc_rows(&v, "it");
        assert!(state.iter().any(|(_, v)| v == "v4.3.1"));
        assert!(state
            .iter()
            .any(|(_, v)| v.contains("8443") && v.contains("1502")));
        assert_eq!(credentials[1].1, "abc2345def");
        assert!(note.contains("8443"), "{note}");

        let unknown = serde_json::json!({"answers": false, "credentials": null, "credentials_unknown": true, "ports": {}});
        let OpenPlcView {
            state,
            credentials,
            note,
        } = openplc_rows(&unknown, "en");
        assert!(credentials.is_empty());
        assert!(note.contains("not known"), "{note}");
        assert!(state.iter().any(|(_, v)| v == "not answering"));
    }

    fn zones() -> Vec<Zone> {
        [
            ("Europe/Rome", Some("IT")),
            ("Europe/Paris", Some("FR")),
            ("America/New_York", Some("US")),
            ("America/Chicago", Some("US")),
            ("America/Argentina/Buenos_Aires", Some("AR")),
            ("UTC", None),
        ]
        .into_iter()
        .map(|(z, c)| Zone {
            zone: z.into(),
            country: c.map(Into::into),
        })
        .collect()
    }

    #[test]
    fn time_zones_by_continent_country_and_city_like_the_web() {
        let z = zones();
        assert_eq!(continents_in(&z), vec!["Europe", "America", OTHER]);
        let am = countries_in(&z, "America", "it");
        let names: Vec<&str> = am.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Argentina", "Stati Uniti"]);
        assert_eq!(am[1].zones, ["America/New_York", "America/Chicago"]);
        assert_eq!(city_of("America/Argentina/Buenos_Aires"), "Buenos Aires");
        assert_eq!(zone_label(&z[0], "it"), "Rome — Italia");
        assert_eq!(zone_label(&z[0], "en"), "Rome — Italy");
        let found: Vec<String> = search_zones(&z, "itàl", "it", 10)
            .into_iter()
            .map(|z| z.zone)
            .collect();
        assert_eq!(found, ["Europe/Rome"]);
        let found: Vec<String> = search_zones(&z, "buenos", "en", 10)
            .into_iter()
            .map(|z| z.zone)
            .collect();
        assert_eq!(found, ["America/Argentina/Buenos_Aires"]);
        // «ro» is Rome, not every zone of «Europe».
        let found: Vec<String> = search_zones(&z, "ro", "en", 10)
            .into_iter()
            .map(|z| z.zone)
            .collect();
        assert_eq!(found, ["Europe/Rome"]);
        assert!(search_zones(&z, "  ", "en", 10).is_empty());
        // The old aliases without a country are not offered.
        assert!(search_zones(&z, "belfast", "en", 10).is_empty());
        assert!(countries_in(&z, "Europe", "en")
            .iter()
            .all(|e| e.code.is_some()));
        // The table has every country of zone.tab, without the curly apostrophe.
        assert_eq!(country_name("CI", "it"), "Costa d'Avorio");
    }

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
            addresses6: vec![],
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
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                500,
                20,
                true,
                (1024, 600),
                t0
            ),
            Pointer::Pass
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                500,
                20,
                false,
                (1024, 600),
                t0
            ),
            Pointer::Pass
        );
        // In the corner: held back, and released early it becomes a click.
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                1000,
                20,
                true,
                (1024, 600),
                t0
            ),
            Pointer::Withhold
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                1005,
                25,
                true,
                (1024, 600),
                t0
            ),
            Pointer::Withhold
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                1005,
                25,
                false,
                (1024, 600),
                t0
            ),
            Pointer::Click
        );
        // A finger that drifts inside the corner is still the gesture; a drag
        // out of it goes back to LVGL.
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                1000,
                20,
                true,
                (1024, 600),
                t0
            ),
            Pointer::Withhold
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                960,
                70,
                true,
                (1024, 600),
                t0
            ),
            Pointer::Withhold
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                1000,
                120,
                true,
                (1024, 600),
                t0
            ),
            Pointer::Pass
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                None,
                1000,
                120,
                false,
                (1024, 600),
                t0
            ),
            Pointer::Pass
        );
        // Disabled by the project: nothing is held back.
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::None, PanelOptions::default()),
                None,
                1000,
                20,
                true,
                (1024, 600),
                t0
            ),
            Pointer::Pass
        );
    }

    #[test]
    fn a_touch_in_the_corner_counts_only_after_the_first_moment() {
        let t0 = Instant::now();
        let size = (1024, 600);
        let mut g = Gesture::default();
        let panel = (RebootCorner::TopRight, PanelOptions::default());
        assert_eq!(
            decide(&mut g, panel, None, 1000, 20, true, size, t0),
            Pointer::Withhold
        );
        // During the grace: nothing fires, even long enough for the hold...
        assert_eq!(fires(&mut g, t0 + GRACE - Duration::from_millis(1)), None);
        // ...and the time of the gesture starts after it, not with the touch.
        assert_eq!(fires(&mut g, t0 + HOLD), None);
        assert_eq!(fires(&mut g, t0 + GRACE + HOLD), Some(Fired::Panel));
    }

    #[test]
    fn the_ntp_servers_typed_are_one_to_four_names() {
        let form = |text: &str| NtpForm {
            text: text.into(),
            ..Default::default()
        };
        assert!(form("192.168.1.10").valid());
        assert_eq!(
            form("192.168.1.10  ntp.plant.example").servers(),
            vec!["192.168.1.10", "ntp.plant.example"]
        );
        assert!(!form("").valid());
        assert!(!form("a b c d e").valid());
        assert!(!form("ntp_server").valid());
        assert!(!form("-x").valid());
    }

    #[test]
    fn the_panel_corner_has_its_own_time_and_size() {
        let t0 = Instant::now();
        let size = (1024, 600);
        let wide = (
            RebootCorner::TopLeft,
            PanelOptions {
                hold_secs: 2,
                size_px: 160,
            },
        );
        let mut g = Gesture::default();
        // Outside the 80 px of once, inside the 160 chosen.
        assert_eq!(
            decide(&mut g, wide, None, 150, 150, true, size, t0),
            Pointer::Withhold
        );
        assert_eq!(fires(&mut g, t0 + GRACE + Duration::from_secs(1)), None);
        assert_eq!(
            fires(&mut g, t0 + GRACE + Duration::from_secs(2)),
            Some(Fired::Panel)
        );
        decide(&mut g, wide, None, 150, 150, false, size, t0);
        // The finger may drift in the whole square, not in the old one.
        decide(&mut g, wide, None, 20, 20, true, size, t0);
        assert_eq!(
            decide(&mut g, wide, None, 150, 150, true, size, t0),
            Pointer::Withhold
        );
        assert_eq!(
            decide(&mut g, wide, None, 200, 150, true, size, t0),
            Pointer::Pass
        );
    }

    #[test]
    fn the_reboot_corner_fires_after_its_own_time_and_never_hides_the_panels() {
        let t0 = Instant::now();
        let options = RebootOptions {
            hold_secs: 3,
            size_px: 100,
            confirm: true,
        };
        let size = (1024, 600);
        let watch = Some((RebootCorner::BottomLeft, options));
        let mut g = Gesture::default();
        // Bottom left, inside the 100 px: held back.
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                watch,
                90,
                520,
                true,
                size,
                t0
            ),
            Pointer::Withhold
        );
        assert_eq!(fires(&mut g, t0 + GRACE + Duration::from_secs(2)), None);
        assert_eq!(
            fires(&mut g, t0 + GRACE + Duration::from_secs(3)),
            Some(Fired::Reboot { confirm: true })
        );
        // Once only, and the release never reaches LVGL.
        assert_eq!(fires(&mut g, t0 + GRACE + Duration::from_secs(4)), None);
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                watch,
                90,
                520,
                false,
                size,
                t0
            ),
            Pointer::Withhold
        );
        // A finger that drifts inside the corner keeps the hold; one that
        // leaves it becomes a drag.
        decide(
            &mut g,
            (RebootCorner::TopRight, PanelOptions::default()),
            watch,
            90,
            520,
            true,
            size,
            t0,
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                watch,
                30,
                580,
                true,
                size,
                t0
            ),
            Pointer::Withhold
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                watch,
                140,
                520,
                true,
                size,
                t0
            ),
            Pointer::Pass
        );
        assert_eq!(fires(&mut g, t0 + GRACE + Duration::from_secs(3)), None);
        decide(
            &mut g,
            (RebootCorner::TopRight, PanelOptions::default()),
            watch,
            140,
            520,
            false,
            size,
            t0,
        );
        decide(
            &mut g,
            (RebootCorner::TopRight, PanelOptions::default()),
            watch,
            90,
            520,
            true,
            size,
            t0,
        );
        fires(&mut g, t0 + GRACE + Duration::from_secs(3));
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                watch,
                90,
                520,
                false,
                size,
                t0
            ),
            Pointer::Withhold
        );
        // Outside the corner: LVGL has it.
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopRight, PanelOptions::default()),
                watch,
                120,
                520,
                true,
                size,
                t0
            ),
            Pointer::Pass
        );
        decide(
            &mut g,
            (RebootCorner::TopRight, PanelOptions::default()),
            watch,
            120,
            520,
            false,
            size,
            t0,
        );
        // The same corner as the panel's: the panel wins, with its 5 seconds.
        let same = Some((RebootCorner::TopRight, options));
        decide(
            &mut g,
            (RebootCorner::TopRight, PanelOptions::default()),
            same,
            1000,
            20,
            true,
            size,
            t0,
        );
        assert_eq!(fires(&mut g, t0 + GRACE + Duration::from_secs(3)), None);
        assert_eq!(fires(&mut g, t0 + GRACE + HOLD), Some(Fired::Panel));
        decide(
            &mut g,
            (RebootCorner::TopRight, PanelOptions::default()),
            same,
            1000,
            20,
            false,
            size,
            t0,
        );
        // The panel's corner moved: the old one is a corner like any other.
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopLeft, PanelOptions::default()),
                None,
                1000,
                20,
                true,
                size,
                t0
            ),
            Pointer::Pass
        );
        decide(
            &mut g,
            (RebootCorner::TopLeft, PanelOptions::default()),
            None,
            1000,
            20,
            false,
            size,
            t0,
        );
        assert_eq!(
            decide(
                &mut g,
                (RebootCorner::TopLeft, PanelOptions::default()),
                None,
                20,
                20,
                true,
                size,
                t0
            ),
            Pointer::Withhold
        );
        assert_eq!(fires(&mut g, t0 + GRACE + HOLD), Some(Fired::Panel));
        decide(
            &mut g,
            (RebootCorner::TopLeft, PanelOptions::default()),
            None,
            20,
            20,
            false,
            size,
            t0,
        );
        assert!(!in_reboot_corner(RebootCorner::None, 100, 0, 0, 1024, 600));
        assert!(in_reboot_corner(
            RebootCorner::BottomRight,
            100,
            1000,
            590,
            1024,
            600
        ));
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
