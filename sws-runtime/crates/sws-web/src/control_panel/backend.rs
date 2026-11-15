//! What the control panel can read and change on the operating system, and
//! who does it.
//!
//! One real backend, over the system D-Bus ([`super::dbus`]): NetworkManager,
//! `timedate1`, `login1`. It is the same on every product (TC/WP on PixsysOS,
//! Tiny TY on Ubuntu, a generic Linux PC): what changes is who grants the
//! permissions (polkit), measured in phase 0 of the plan. The fake backend
//! serves the tests and development on a machine where the runtime must not
//! touch the network it is working on (`SWS_CONTROL_PANEL_FAKE=1`).

use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::sync::Mutex;

/// What this device can do, probed and not presumed: the screen shows only
/// these sections.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Capabilities {
    pub network: bool,
    pub wifi: bool,
    pub time: bool,
    pub reboot: bool,
    pub power_off: bool,
    /// The screen's brightness can be set: a backlight in `/sys/class/backlight`
    /// (Tiny TY, applied by the viewer) or Pixsys' `Config1.Display` (TC/WP).
    #[serde(default)]
    pub display: bool,
    /// PixsysOS' own calibration (`touch-calibration.service`), which the
    /// container's user may start. The resistive calibration of the LVGL
    /// viewer is the viewer's own and is not here.
    #[serde(default)]
    pub touch_calibration_service: bool,
    /// A corner of the screen, held for a few seconds, reboots the device:
    /// Pixsys' `Config1.TouchReboot` (TC/WP) or the LVGL viewer (Tiny TY).
    #[serde(default)]
    pub reboot_corner: bool,
}

/// The corner that reboots the device when held. The order is the one of
/// Pixsys' `Config1.TouchReboot` (measured on the TC620, 15-11-2026).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RebootCorner {
    #[default]
    None,
    TopLeft,
    TopRight,
    BottomRight,
    BottomLeft,
}

impl RebootCorner {
    pub const ALL: [RebootCorner; 5] = [
        RebootCorner::None,
        RebootCorner::TopLeft,
        RebootCorner::TopRight,
        RebootCorner::BottomRight,
        RebootCorner::BottomLeft,
    ];

    pub fn pixsys(self) -> u32 {
        Self::ALL.iter().position(|c| *c == self).unwrap_or(0) as u32
    }

    pub fn from_pixsys(v: u32) -> Option<Self> {
        Self::ALL.get(v as usize).copied()
    }
}

/// How the corner behaves where the LVGL viewer watches it (Tiny TY). The
/// defaults are PixsysOS' behaviour, measured by the maintainer on the TC620
/// (15-11-2026): 5 seconds, about 2 cm of screen, no confirmation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct RebootCornerOptions {
    pub hold_secs: u8,
    /// The side of the corner in pixels: the viewer does not know the
    /// screen's physical size. 100 px are about 2 cm on a Tiny TY.
    pub size_px: u16,
    /// Ask before rebooting.
    pub confirm: bool,
}

/// How the corner that opens the control panel behaves: the same two
/// measures as the reboot corner's (maintainer, 15-11-2026: «lo stesso
/// meccanismo»), without the question.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct PanelCornerOptions {
    pub hold_secs: u8,
    pub size_px: u16,
}

impl Default for PanelCornerOptions {
    fn default() -> Self {
        // What the gesture always was: 5 seconds in an 80 px square.
        Self {
            hold_secs: 5,
            size_px: 80,
        }
    }
}

impl PanelCornerOptions {
    pub fn validate(&self) -> Result<(), String> {
        RebootCornerOptions {
            hold_secs: self.hold_secs,
            size_px: self.size_px,
            confirm: false,
        }
        .validate()
    }
}

impl Default for RebootCornerOptions {
    fn default() -> Self {
        Self {
            hold_secs: 5,
            size_px: 100,
            confirm: false,
        }
    }
}

impl RebootCornerOptions {
    pub fn validate(&self) -> Result<(), String> {
        if !(2..=15).contains(&self.hold_secs) {
            return Err(format!(
                "hold_secs {} is not between 2 and 15",
                self.hold_secs
            ));
        }
        if !(40..=200).contains(&self.size_px) {
            return Err(format!(
                "size_px {} is not between 40 and 200",
                self.size_px
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Ipv4Method {
    /// DHCP.
    Auto,
    Manual,
    Disabled,
    /// Anything else NetworkManager reports (`link-local`, `shared`): shown,
    /// never written.
    Other,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Card {
    /// Kernel name: `eth0`, `ethernet0`, `wlan0`.
    pub name: String,
    pub kind: CardKind,
    /// Link and activation state, in NetworkManager's words reduced to four.
    pub state: CardState,
    pub mac: Option<String>,
    /// The addresses the card has now, `a.b.c.d/prefix`.
    pub addresses: Vec<String>,
    /// The IPv6 addresses that are not link-local, `addr/prefix`. A Wi-Fi card
    /// whose network gives no DHCP answer has only these (TY570, 15-11-2026):
    /// without them the panel showed nothing of a connection that works.
    pub addresses6: Vec<String>,
    pub gateway: Option<String>,
    pub dns: Vec<String>,
    /// How the active profile asks for IPv4. `None` = no profile active.
    pub method: Option<Ipv4Method>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CardKind {
    Ethernet,
    Wifi,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CardState {
    /// Configured and up.
    Connected,
    /// Being configured (DHCP running, …).
    Connecting,
    /// Cable present, no profile active.
    Disconnected,
    /// No cable, or the card is not usable.
    Unavailable,
}

/// A change to the IPv4 of one card, as the screen sends it.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Ipv4Change {
    pub method: Ipv4Method,
    #[serde(default)]
    pub address: Option<Ipv4Addr>,
    #[serde(default)]
    pub prefix: Option<u8>,
    #[serde(default)]
    pub gateway: Option<Ipv4Addr>,
    #[serde(default)]
    pub dns: Vec<Ipv4Addr>,
}

impl Ipv4Change {
    /// The checks that do not need the system: a static address needs an
    /// address and a sensible prefix; DHCP takes nothing else.
    pub fn validate(&self) -> Result<(), String> {
        match self.method {
            Ipv4Method::Auto => Ok(()),
            Ipv4Method::Manual => {
                let addr = self.address.ok_or("a static address needs `address`")?;
                let prefix = self.prefix.ok_or("a static address needs `prefix`")?;
                if !(1..=32).contains(&prefix) {
                    return Err(format!("prefix {prefix} is not between 1 and 32"));
                }
                if addr.is_unspecified() || addr.is_broadcast() || addr.is_multicast() {
                    return Err(format!("{addr} cannot be a card's address"));
                }
                Ok(())
            }
            Ipv4Method::Disabled | Ipv4Method::Other => {
                Err("only `auto` (DHCP) and `manual` can be set".into())
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TimeState {
    pub timezone: String,
    pub ntp: bool,
    pub can_ntp: bool,
    pub ntp_synchronized: bool,
    /// Microseconds since the epoch, UTC.
    pub time_usec: u64,
    /// What the NTP client measured, where it can be asked.
    pub drift: Option<ClockDrift>,
    /// Which servers the clock follows; `None` where this system gives no
    /// clean way to choose them.
    pub ntp_servers: Option<NtpServers>,
}

/// The NTP servers: the system's own list, or one to four written by hand
/// (a plant without internet has its own: the PLC, the factory's server).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct NtpServers {
    pub manual: bool,
    /// Kept when `manual` goes off, so that they come back.
    #[serde(default)]
    pub servers: Vec<String>,
}

pub const MAX_NTP_SERVERS: usize = 4;

/// The servers of the automatic mode on chrony: the same the installer of the
/// Tiny TY writes (`deploy/tiny-ty/remove-panelcontrol.sh`).
const CHRONY_POOLS: [&str; 4] = [
    "0.ubuntu.pool.ntp.org",
    "1.ubuntu.pool.ntp.org",
    "2.ubuntu.pool.ntp.org",
    "ntp.ubuntu.com",
];
const CHRONY_MANUAL: &str = "# sws: manual";
const CHRONY_AUTO: &str = "# sws: automatic";
const CHRONY_KEPT: &str = "# kept: ";

/// A host name or an address, as it goes into a configuration file: nothing
/// that could start another directive.
pub fn valid_ntp_server(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'))
        && !s.starts_with(['-', '.'])
}

impl NtpServers {
    pub fn validate(&self) -> Result<(), String> {
        if self.servers.len() > MAX_NTP_SERVERS {
            return Err(format!("at most {MAX_NTP_SERVERS} NTP servers"));
        }
        if self.manual && self.servers.is_empty() {
            return Err("the manual mode needs at least one NTP server".into());
        }
        match self.servers.iter().find(|s| !valid_ntp_server(s)) {
            Some(bad) => Err(format!("\"{bad}\" is not a host name or an address")),
            None => Ok(()),
        }
    }

    /// The sources file of chrony for these servers.
    pub fn to_chrony(&self) -> String {
        let mut out = String::from("# Written by the SWS control panel (Time → NTP servers).\n");
        if self.manual {
            out.push_str(CHRONY_MANUAL);
            out.push('\n');
            for s in &self.servers {
                out.push_str(&format!("server {s} iburst\n"));
            }
        } else {
            out.push_str(CHRONY_AUTO);
            out.push('\n');
            for s in &self.servers {
                out.push_str(&format!("{CHRONY_KEPT}{s}\n"));
            }
            for p in CHRONY_POOLS {
                out.push_str(&format!("pool {p} iburst\n"));
            }
        }
        out
    }

    /// A sources file read back. One this panel did not write is automatic.
    pub fn from_chrony(text: &str) -> Self {
        let manual = text.lines().any(|l| l.trim() == CHRONY_MANUAL);
        let servers = text
            .lines()
            .filter_map(|l| {
                let l = l.trim();
                if manual {
                    let mut words = l.split_whitespace();
                    (words.next() == Some("server")).then(|| words.next())?
                } else {
                    l.strip_prefix(CHRONY_KEPT)
                }
            })
            .filter(|s| valid_ntp_server(s))
            .take(MAX_NTP_SERVERS)
            .map(str::to_string)
            .collect();
        Self { manual, servers }
    }
}

/// The clock against its NTP sources.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct ClockDrift {
    /// How much the clock runs fast (positive) or slow, in parts per million.
    pub ppm: f64,
    /// The last distance from the NTP time, in seconds.
    pub offset_secs: f64,
}

/// One line of `chronyc -c tracking`: the last offset is the sixth field, the
/// frequency the eighth.
pub fn parse_chrony_tracking(line: &str) -> Option<ClockDrift> {
    let f: Vec<&str> = line.trim().split(',').collect();
    Some(ClockDrift {
        offset_secs: f.get(5)?.parse().ok()?,
        ppm: f.get(7)?.parse().ok()?,
    })
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct TimeChange {
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub ntp: Option<bool>,
    /// Microseconds since the epoch, UTC. Setting it turns NTP off first,
    /// as `timedatectl` requires.
    #[serde(default)]
    pub time_usec: Option<u64>,
    #[serde(default)]
    pub ntp_servers: Option<NtpServers>,
}

/// What the Wi-Fi card is doing.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WifiMode {
    /// Connected, or trying, to a network.
    Client,
    /// The device is the access point (phase 4, «modalità APN» in the
    /// maintainer's words of 14-11-2026).
    Hotspot,
    /// Radio on, nothing active.
    Idle,
    /// Radio off.
    Off,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WifiSecurity {
    Open,
    Wpa,
    Wpa3,
    /// 802.1X: listed, not connectable from the panel.
    Enterprise,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WifiNetwork {
    pub ssid: String,
    /// 0-100.
    pub signal: u8,
    pub security: WifiSecurity,
    /// A profile for this network is saved.
    pub known: bool,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WifiState {
    /// The Wi-Fi card, `None` = no card (the section is hidden anyway).
    pub card: Option<String>,
    pub radio: bool,
    pub mode: WifiMode,
    /// The network in use, as client or as hotspot.
    pub active_ssid: Option<String>,
    /// Networks seen by the last scan, strongest first, one per SSID.
    pub networks: Vec<WifiNetwork>,
    /// SSIDs of the saved client profiles.
    pub saved: Vec<String>,
    /// The card can be an access point (`NM_WIFI_DEVICE_CAP_AP`).
    pub can_hotspot: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct WifiConnect {
    pub ssid: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub hidden: bool,
}

/// The hotspot profile. The password is NetworkManager's, read back with
/// `GetSecrets` only behind the service session: SWS keeps no copy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hotspot {
    pub enabled: bool,
    pub ssid: String,
    pub password: String,
}

/// WPA2-PSK: 8 to 63 printable ASCII characters. An SSID is 1 to 32 bytes.
pub fn validate_ssid(ssid: &str) -> Result<(), String> {
    if ssid.is_empty() || ssid.len() > 32 {
        return Err("an SSID is 1 to 32 bytes".into());
    }
    Ok(())
}

pub fn validate_psk(password: &str) -> Result<(), String> {
    let n = password.chars().count();
    if !(8..=63).contains(&n) || !password.chars().all(|c| (' '..='~').contains(&c)) {
        return Err("a WPA password is 8 to 63 printable ASCII characters".into());
    }
    Ok(())
}

impl WifiConnect {
    pub fn validate(&self) -> Result<(), String> {
        validate_ssid(&self.ssid)?;
        match self.password.as_deref() {
            Some(p) if !p.is_empty() => validate_psk(p),
            _ => Ok(()),
        }
    }
}

impl Hotspot {
    pub fn validate(&self) -> Result<(), String> {
        validate_ssid(&self.ssid)?;
        validate_psk(&self.password)
    }
}

/// The joining string of a Wi-Fi QR code, escaped as the format wants
/// (`\`, `;`, `,`, `:` and `"` get a backslash).
pub fn wifi_qr(ssid: &str, password: &str) -> String {
    fn esc(s: &str) -> String {
        let mut o = String::with_capacity(s.len());
        for c in s.chars() {
            if matches!(c, '\\' | ';' | ',' | ':' | '"') {
                o.push('\\');
            }
            o.push(c);
        }
        o
    }
    format!("WIFI:T:WPA;S:{};P:{};;", esc(ssid), esc(password))
}

/// How long a network change waits for a confirmation before it is undone.
pub const CONFIRM_WITHIN_SECS: u32 = 60;

pub enum Backend {
    Dbus,
    Fake(Box<Fake>),
}

impl Backend {
    pub fn from_env() -> Self {
        if std::env::var("SWS_CONTROL_PANEL_FAKE").is_ok_and(|v| v == "1") {
            Backend::Fake(Box::default())
        } else {
            Backend::Dbus
        }
    }

    pub async fn capabilities(&self) -> Capabilities {
        match self {
            Backend::Dbus => super::dbus::capabilities().await,
            Backend::Fake(f) => f.capabilities(),
        }
    }

    pub async fn cards(&self) -> Result<Vec<Card>, String> {
        match self {
            Backend::Dbus => super::dbus::cards().await,
            Backend::Fake(f) => Ok(f.cards()),
        }
    }

    /// Applies the change under a checkpoint that NetworkManager rolls back by
    /// itself after [`CONFIRM_WITHIN_SECS`] unless [`Self::confirm_network`]
    /// arrives: whoever changes the address from a browser must not lock
    /// themselves out.
    pub async fn set_ipv4(&self, card: &str, change: &Ipv4Change) -> Result<(), String> {
        change.validate()?;
        match self {
            Backend::Dbus => super::dbus::set_ipv4(card, change, CONFIRM_WITHIN_SECS).await,
            Backend::Fake(f) => f.set_ipv4(card, change),
        }
    }

    pub async fn confirm_network(&self) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::confirm_network().await,
            Backend::Fake(f) => f.confirm(),
        }
    }

    /// Puts the network back as it was before the pending change, at once.
    pub async fn rollback_network(&self) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::rollback_network().await,
            Backend::Fake(f) => {
                if f.pending.lock().unwrap().is_none() {
                    return Err("no network change waiting for a confirmation".into());
                }
                f.expire();
                Ok(())
            }
        }
    }

    pub async fn wifi(&self) -> Result<WifiState, String> {
        match self {
            Backend::Dbus => super::dbus::wifi().await,
            Backend::Fake(f) => Ok(f.wifi.lock().unwrap().clone()),
        }
    }

    /// Asks the card for a new scan; the list comes back with [`Self::wifi`]
    /// a few seconds later.
    pub async fn wifi_scan(&self) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::wifi_scan().await,
            Backend::Fake(_) => Ok(()),
        }
    }

    /// Joins a network under the same checkpoint as [`Self::set_ipv4`]: the
    /// device may be reached through the hotspot or the network it leaves.
    pub async fn wifi_connect(&self, req: &WifiConnect) -> Result<(), String> {
        req.validate()?;
        match self {
            Backend::Dbus => super::dbus::wifi_connect(req, CONFIRM_WITHIN_SECS).await,
            Backend::Fake(f) => f.wifi_connect(req),
        }
    }

    pub async fn wifi_forget(&self, ssid: &str) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::wifi_forget(ssid).await,
            Backend::Fake(f) => {
                let mut w = f.wifi.lock().unwrap();
                if !w.saved.iter().any(|s| s == ssid) {
                    return Err(format!("no saved network called {ssid}"));
                }
                w.saved.retain(|s| s != ssid);
                for n in &mut w.networks {
                    if n.ssid == ssid {
                        n.known = false;
                        n.active = false;
                    }
                }
                if w.mode == WifiMode::Client && w.active_ssid.as_deref() == Some(ssid) {
                    w.mode = WifiMode::Idle;
                    w.active_ssid = None;
                }
                Ok(())
            }
        }
    }

    pub async fn wifi_radio(&self, enabled: bool) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::wifi_radio(enabled).await,
            Backend::Fake(f) => {
                let mut w = f.wifi.lock().unwrap();
                w.radio = enabled;
                w.mode = if enabled {
                    WifiMode::Idle
                } else {
                    WifiMode::Off
                };
                w.active_ssid = None;
                Ok(())
            }
        }
    }

    /// The hotspot profile, `None` = never created.
    pub async fn hotspot(&self) -> Result<Option<Hotspot>, String> {
        match self {
            Backend::Dbus => super::dbus::hotspot().await,
            Backend::Fake(f) => Ok(f.hotspot.lock().unwrap().clone()),
        }
    }

    /// Saves the hotspot and turns it on or off, under the checkpoint: whoever
    /// is connected through it and turns it off gets it back in 60 s.
    pub async fn set_hotspot(&self, h: &Hotspot) -> Result<(), String> {
        h.validate()?;
        match self {
            Backend::Dbus => super::dbus::set_hotspot(h, CONFIRM_WITHIN_SECS).await,
            Backend::Fake(f) => f.set_hotspot(h),
        }
    }

    /// Applies a brightness in percent. Only where the runtime is the one that
    /// drives the light (Pixsys' `Config1.Display`); on the Tiny TY the viewer
    /// reads the saved value and applies it itself.
    pub async fn apply_brightness(&self, percent: u8) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::apply_brightness(percent).await,
            Backend::Fake(f) => {
                *f.brightness.lock().unwrap() = Some(percent);
                Ok(())
            }
        }
    }

    /// The reboot corner is the LVGL viewer's work (Tiny TY): the value lives
    /// in the device's settings and the viewer reads it from there.
    /// Whether the viewer turns the picture itself (a portrait project, a
    /// device upside down): where it owns the glass, not under a compositor.
    pub fn rotation_by_viewer(&self) -> bool {
        match self {
            Backend::Dbus => super::dbus::rotation_by_viewer(),
            Backend::Fake(_) => true,
        }
    }

    /// PixsysOS turns the screen (and restarts the panel to do it).
    pub async fn rotation_by_system(&self) -> bool {
        match self {
            Backend::Dbus => super::dbus::rotation_by_system().await,
            Backend::Fake(_) => false,
        }
    }

    pub async fn system_rotation(&self) -> Result<u32, String> {
        match self {
            Backend::Dbus => super::dbus::system_rotation().await,
            Backend::Fake(_) => Err("the viewer turns the screen".into()),
        }
    }

    pub async fn set_system_rotation(&self, quarter_turns: u32) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::set_system_rotation(quarter_turns).await,
            Backend::Fake(_) => Err("the viewer turns the screen".into()),
        }
    }

    pub fn reboot_corner_by_viewer(&self) -> bool {
        match self {
            Backend::Dbus => super::dbus::reboot_corner_by_viewer(),
            Backend::Fake(_) => true,
        }
    }

    /// The corner as PixsysOS has it. Not for [`Self::reboot_corner_by_viewer`].
    pub async fn reboot_corner(&self) -> Result<RebootCorner, String> {
        match self {
            Backend::Dbus => super::dbus::reboot_corner().await,
            Backend::Fake(_) => Err("the reboot corner is the viewer's".into()),
        }
    }

    pub async fn set_reboot_corner(&self, corner: RebootCorner) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::set_reboot_corner(corner).await,
            Backend::Fake(_) => Err("the reboot corner is the viewer's".into()),
        }
    }

    /// Starts PixsysOS' calibration, which takes the screen by itself.
    pub async fn start_touch_calibration(&self) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::start_touch_calibration().await,
            Backend::Fake(f) => {
                *f.last_power.lock().unwrap() = Some("touch_calibration");
                Ok(())
            }
        }
    }

    pub async fn time(&self) -> Result<TimeState, String> {
        match self {
            Backend::Dbus => super::dbus::time().await,
            Backend::Fake(f) => Ok(f.time.lock().unwrap().clone()),
        }
    }

    pub async fn set_time(&self, change: &TimeChange) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::set_time(change).await,
            Backend::Fake(f) => {
                let mut t = f.time.lock().unwrap();
                if let Some(tz) = &change.timezone {
                    t.timezone = tz.clone();
                }
                if let Some(usec) = change.time_usec {
                    t.ntp = false;
                    t.time_usec = usec;
                }
                if let Some(ntp) = change.ntp {
                    t.ntp = ntp;
                }
                if let Some(servers) = &change.ntp_servers {
                    t.ntp_servers = Some(servers.clone());
                }
                Ok(())
            }
        }
    }

    /// Every time zone, with the country it belongs to: the screen picks
    /// continent, then country, then city (TY570, 14-11-2026: one list of 400
    /// names could not be used on a 7" screen).
    pub async fn timezones(&self) -> Result<Vec<Zone>, String> {
        match self {
            Backend::Dbus => {
                let zones = super::dbus::timezones().await?;
                let countries = std::fs::read_to_string(ZONE_TAB)
                    .map(|t| zone_countries(&t))
                    .unwrap_or_default();
                Ok(with_countries(zones, &countries))
            }
            Backend::Fake(_) => Ok([
                ("America/Argentina/Buenos_Aires", Some("AR")),
                ("America/Chicago", Some("US")),
                ("America/New_York", Some("US")),
                ("Asia/Tokyo", Some("JP")),
                ("Europe/Paris", Some("FR")),
                ("Europe/Rome", Some("IT")),
                ("UTC", None),
            ]
            .into_iter()
            .map(|(z, c)| Zone {
                zone: z.into(),
                country: c.map(Into::into),
            })
            .collect()),
        }
    }

    pub async fn reboot(&self) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::reboot(false).await,
            Backend::Fake(f) => {
                *f.last_power.lock().unwrap() = Some("reboot");
                Ok(())
            }
        }
    }

    pub async fn power_off(&self) -> Result<(), String> {
        match self {
            Backend::Dbus => super::dbus::reboot(true).await,
            Backend::Fake(f) => {
                *f.last_power.lock().unwrap() = Some("power_off");
                Ok(())
            }
        }
    }
}

/// An in-memory device with one wired card in DHCP. A change stays pending
/// until confirmed; [`Fake::expire`] plays NetworkManager's rollback.
pub struct Fake {
    pub card: Mutex<Card>,
    /// What [`Fake::expire`] puts back: the wired card, the Wi-Fi and the
    /// hotspot as they were before the first unconfirmed change.
    pending: Mutex<Option<(Card, WifiState, Option<Hotspot>)>>,
    pub time: Mutex<TimeState>,
    pub last_power: Mutex<Option<&'static str>>,
    pub wifi: Mutex<WifiState>,
    pub hotspot: Mutex<Option<Hotspot>>,
    pub brightness: Mutex<Option<u8>>,
}

impl Default for Fake {
    fn default() -> Self {
        Self {
            card: Mutex::new(Card {
                name: "eth0".into(),
                kind: CardKind::Ethernet,
                state: CardState::Connected,
                mac: Some("7c:6c:39:06:e9:90".into()),
                addresses: vec!["192.168.1.242/24".into()],
                addresses6: vec![],
                gateway: Some("192.168.1.1".into()),
                dns: vec!["192.168.1.1".into()],
                method: Some(Ipv4Method::Auto),
            }),
            pending: Mutex::new(None),
            time: Mutex::new(TimeState {
                timezone: "Europe/Rome".into(),
                ntp: true,
                can_ntp: true,
                ntp_synchronized: true,
                time_usec: 1_794_600_000_000_000,
                drift: Some(ClockDrift {
                    ppm: 21.136,
                    offset_secs: 0.000_138,
                }),
                ntp_servers: Some(NtpServers::default()),
            }),
            last_power: Mutex::new(None),
            wifi: Mutex::new(WifiState {
                card: Some("wlan0".into()),
                radio: true,
                mode: WifiMode::Client,
                active_ssid: Some("Casa".into()),
                networks: vec![
                    fake_net("Casa", 78, WifiSecurity::Wpa, true, true),
                    fake_net("Officina", 54, WifiSecurity::Wpa3, false, false),
                    fake_net("Ospiti", 41, WifiSecurity::Open, false, false),
                    fake_net("Aziendale", 33, WifiSecurity::Enterprise, false, false),
                ],
                saved: vec!["Casa".into()],
                can_hotspot: true,
            }),
            hotspot: Mutex::new(None),
            brightness: Mutex::new(None),
        }
    }
}

impl Fake {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            network: true,
            wifi: true,
            time: true,
            reboot: true,
            power_off: true,
            display: true,
            touch_calibration_service: false,
            reboot_corner: true,
        }
    }

    /// Takes the snapshot [`Fake::expire`] goes back to, once per change.
    fn remember(&self) {
        let mut pending = self.pending.lock().unwrap();
        if pending.is_none() {
            *pending = Some((
                self.card.lock().unwrap().clone(),
                self.wifi.lock().unwrap().clone(),
                self.hotspot.lock().unwrap().clone(),
            ));
        }
    }

    fn wifi_connect(&self, req: &WifiConnect) -> Result<(), String> {
        let w = self.wifi.lock().unwrap();
        let net = w.networks.iter().find(|n| n.ssid == req.ssid).cloned();
        if net.is_none() && !req.hidden {
            return Err(format!("{} is not in range", req.ssid));
        }
        if net
            .as_ref()
            .is_some_and(|n| n.security == WifiSecurity::Enterprise)
        {
            return Err("802.1X networks cannot be joined from the panel".into());
        }
        let needs_password = net
            .as_ref()
            .is_some_and(|n| n.security != WifiSecurity::Open)
            && !w.saved.contains(&req.ssid);
        if needs_password && req.password.as_deref().unwrap_or("").is_empty() {
            return Err(format!("{} needs a password", req.ssid));
        }
        drop(w);
        self.remember();
        let mut w = self.wifi.lock().unwrap();
        if !w.saved.contains(&req.ssid) {
            w.saved.push(req.ssid.clone());
        }
        for n in &mut w.networks {
            n.active = n.ssid == req.ssid;
            n.known |= n.active;
        }
        w.radio = true;
        w.mode = WifiMode::Client;
        w.active_ssid = Some(req.ssid.clone());
        if let Some(h) = self.hotspot.lock().unwrap().as_mut() {
            h.enabled = false;
        }
        Ok(())
    }

    fn set_hotspot(&self, h: &Hotspot) -> Result<(), String> {
        if h.enabled && !self.wifi.lock().unwrap().can_hotspot {
            return Err("this Wi-Fi card cannot be an access point".into());
        }
        self.remember();
        *self.hotspot.lock().unwrap() = Some(h.clone());
        let mut w = self.wifi.lock().unwrap();
        for n in &mut w.networks {
            n.active = false;
        }
        if h.enabled {
            w.radio = true;
            w.mode = WifiMode::Hotspot;
            w.active_ssid = Some(h.ssid.clone());
        } else if w.mode == WifiMode::Hotspot {
            w.mode = WifiMode::Idle;
            w.active_ssid = None;
        }
        Ok(())
    }

    fn cards(&self) -> Vec<Card> {
        vec![self.card.lock().unwrap().clone()]
    }

    fn set_ipv4(&self, name: &str, change: &Ipv4Change) -> Result<(), String> {
        let card = self.card.lock().unwrap();
        if card.name != name {
            return Err(format!("no card called {name}"));
        }
        drop(card);
        self.remember();
        let mut card = self.card.lock().unwrap();
        card.method = Some(change.method);
        if change.method == Ipv4Method::Manual {
            card.addresses = vec![format!(
                "{}/{}",
                change.address.unwrap_or(Ipv4Addr::UNSPECIFIED),
                change.prefix.unwrap_or(24)
            )];
            card.gateway = change.gateway.map(|g| g.to_string());
            card.dns = change.dns.iter().map(|d| d.to_string()).collect();
        }
        Ok(())
    }

    fn confirm(&self) -> Result<(), String> {
        self.pending
            .lock()
            .unwrap()
            .take()
            .map(|_| ())
            .ok_or_else(|| "no network change waiting for a confirmation".into())
    }

    /// The confirmation never came: back to how it was.
    pub fn expire(&self) {
        if let Some((card, wifi, hotspot)) = self.pending.lock().unwrap().take() {
            *self.card.lock().unwrap() = card;
            *self.wifi.lock().unwrap() = wifi;
            *self.hotspot.lock().unwrap() = hotspot;
        }
    }
}

fn fake_net(
    ssid: &str,
    signal: u8,
    security: WifiSecurity,
    known: bool,
    active: bool,
) -> WifiNetwork {
    WifiNetwork {
        ssid: ssid.into(),
        signal,
        security,
        known,
        active,
    }
}

/// One time zone and its country (ISO 3166 code), as `zone.tab` says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Zone {
    pub zone: String,
    pub country: Option<String>,
}

/// Where tzdata says which country each zone belongs to. Present on Ubuntu
/// (the Tiny TY, 14-11-2026); without it every zone has no country and the
/// screen falls back to continent and city.
pub const ZONE_TAB: &str = "/usr/share/zoneinfo/zone.tab";

/// `zone.tab`: `CC<TAB>coordinates<TAB>Zone[<TAB>comment]`, `#` for comments.
pub fn zone_countries(text: &str) -> std::collections::HashMap<String, String> {
    text.lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| {
            let mut f = l.split('\t');
            let cc = f.next()?.trim();
            let zone = f.nth(1)?.trim();
            (cc.len() == 2 && !zone.is_empty()).then(|| (zone.to_string(), cc.to_string()))
        })
        .collect()
}

pub fn with_countries(
    zones: Vec<String>,
    countries: &std::collections::HashMap<String, String>,
) -> Vec<Zone> {
    zones
        .into_iter()
        .map(|zone| Zone {
            country: countries.get(&zone).cloned(),
            zone,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ntp_servers_go_to_chrony_and_come_back() {
        let manual = NtpServers {
            manual: true,
            servers: vec!["192.168.1.10".into(), "ntp.plant.example".into()],
        };
        assert_eq!(manual.validate(), Ok(()));
        let text = manual.to_chrony();
        assert!(text.contains("server 192.168.1.10 iburst\n"));
        assert!(!text.contains("pool "));
        assert_eq!(NtpServers::from_chrony(&text), manual);
        // Back to automatic: the pools, and the servers kept for next time.
        let auto = NtpServers {
            manual: false,
            ..manual.clone()
        };
        let text = auto.to_chrony();
        assert!(text.contains("pool 0.ubuntu.pool.ntp.org iburst\n"));
        assert!(!text.contains("server 192.168.1.10"));
        assert_eq!(NtpServers::from_chrony(&text), auto);
        // The installer's file, which this panel never wrote.
        assert_eq!(
            NtpServers::from_chrony("pool 0.ubuntu.pool.ntp.org iburst\n"),
            NtpServers::default()
        );
        // Nothing that could become another directive.
        for bad in ["", "a b", "x\nserver evil", "-x", "a;b", "a#b"] {
            assert!(!valid_ntp_server(bad), "{bad:?}");
        }
        let none = NtpServers {
            manual: true,
            servers: vec![],
        };
        assert!(none.validate().is_err());
        let many = NtpServers {
            manual: true,
            servers: vec!["a".into(); 5],
        };
        assert!(many.validate().is_err());
    }

    #[test]
    fn the_drift_is_read_from_chrony() {
        let line = "8E4E8C97,2a00:dcc0::123,3,1794733220.371,0.000014152,0.000138435,0.000128346,21.136,0.012,0.428,0.0131,0.0010,64.3,Normal\n";
        assert_eq!(
            parse_chrony_tracking(line),
            Some(ClockDrift {
                ppm: 21.136,
                offset_secs: 0.000138435
            })
        );
        assert_eq!(parse_chrony_tracking("506 Cannot talk to daemon"), None);
    }

    #[test]
    fn the_reboot_corner_keeps_pixsys_numbers() {
        assert_eq!(RebootCorner::None.pixsys(), 0);
        assert_eq!(RebootCorner::BottomLeft.pixsys(), 4);
        for c in RebootCorner::ALL {
            assert_eq!(RebootCorner::from_pixsys(c.pixsys()), Some(c));
        }
        assert_eq!(RebootCorner::from_pixsys(5), None);
        assert!(RebootCornerOptions::default().validate().is_ok());
        let long = RebootCornerOptions {
            hold_secs: 60,
            ..Default::default()
        };
        assert!(long.validate().is_err());
        assert_eq!(
            serde_json::to_string(&RebootCorner::TopLeft).unwrap(),
            "\"top_left\""
        );
    }

    #[test]
    fn zone_tab_gives_each_zone_its_country() {
        let tab = "# comment\nIT\t+4154+01229\tEurope/Rome\nUS\t+404251-0740023\tAmerica/New_York\tEastern (most areas)\nbad line\n";
        let m = zone_countries(tab);
        assert_eq!(m.get("Europe/Rome").map(String::as_str), Some("IT"));
        assert_eq!(m.get("America/New_York").map(String::as_str), Some("US"));
        assert_eq!(m.len(), 2);
        let z = with_countries(vec!["Europe/Rome".into(), "UTC".into()], &m);
        assert_eq!(z[0].country.as_deref(), Some("IT"));
        assert_eq!(z[1].country, None);
    }

    fn manual(addr: &str, prefix: u8) -> Ipv4Change {
        Ipv4Change {
            method: Ipv4Method::Manual,
            address: Some(addr.parse().unwrap()),
            prefix: Some(prefix),
            gateway: Some("192.168.1.1".parse().unwrap()),
            dns: vec![],
        }
    }

    #[test]
    fn a_static_address_needs_address_and_prefix() {
        assert!(manual("192.168.1.50", 24).validate().is_ok());
        assert!(manual("192.168.1.50", 0).validate().is_err());
        assert!(manual("192.168.1.50", 33).validate().is_err());
        assert!(manual("0.0.0.0", 24).validate().is_err());
        let mut no_addr = manual("192.168.1.50", 24);
        no_addr.address = None;
        assert!(no_addr.validate().is_err());
        let dhcp = Ipv4Change {
            method: Ipv4Method::Auto,
            address: None,
            prefix: None,
            gateway: None,
            dns: vec![],
        };
        assert!(dhcp.validate().is_ok());
        let off = Ipv4Change {
            method: Ipv4Method::Disabled,
            ..dhcp
        };
        assert!(off.validate().is_err(), "the panel never turns IPv4 off");
    }

    #[tokio::test]
    async fn an_unconfirmed_change_goes_back() {
        let b = Backend::Fake(Box::default());
        b.set_ipv4("eth0", &manual("10.0.0.5", 8)).await.unwrap();
        let Backend::Fake(f) = &b else { unreachable!() };
        assert_eq!(f.cards()[0].addresses, vec!["10.0.0.5/8".to_string()]);
        f.expire();
        assert_eq!(f.cards()[0].addresses, vec!["192.168.1.242/24".to_string()]);
        assert_eq!(f.cards()[0].method, Some(Ipv4Method::Auto));
    }

    #[tokio::test]
    async fn a_confirmed_change_stays() {
        let b = Backend::Fake(Box::default());
        b.set_ipv4("eth0", &manual("10.0.0.5", 8)).await.unwrap();
        b.confirm_network().await.unwrap();
        let Backend::Fake(f) = &b else { unreachable!() };
        f.expire();
        assert_eq!(f.cards()[0].addresses, vec!["10.0.0.5/8".to_string()]);
        assert!(
            b.confirm_network().await.is_err(),
            "nothing left to confirm"
        );
    }

    #[tokio::test]
    async fn setting_the_time_turns_ntp_off() {
        let b = Backend::Fake(Box::default());
        b.set_time(&TimeChange {
            time_usec: Some(1),
            ..Default::default()
        })
        .await
        .unwrap();
        let t = b.time().await.unwrap();
        assert!(!t.ntp);
        assert_eq!(t.time_usec, 1);
    }

    #[test]
    fn hotspot_and_wifi_rules() {
        assert!(validate_psk("1234567").is_err());
        assert!(validate_psk("12345678").is_ok());
        assert!(validate_psk(&"x".repeat(64)).is_err());
        assert!(validate_psk("pàssword1").is_err(), "ASCII only");
        assert!(validate_ssid("").is_err());
        assert!(validate_ssid(&"s".repeat(33)).is_err());
        let open = WifiConnect {
            ssid: "Ospiti".into(),
            password: None,
            hidden: false,
        };
        assert!(open.validate().is_ok());
    }

    #[test]
    fn the_qr_escapes_its_separators() {
        assert_eq!(
            wifi_qr("sws-06e990", "ab;c:d"),
            r"WIFI:T:WPA;S:sws-06e990;P:ab\;c\:d;;"
        );
    }

    #[tokio::test]
    async fn the_hotspot_turns_the_client_off_and_rolls_back() {
        let b = Backend::Fake(Box::default());
        let h = Hotspot {
            enabled: true,
            ssid: "sws-06e990".into(),
            password: "segreta123".into(),
        };
        b.set_hotspot(&h).await.unwrap();
        let w = b.wifi().await.unwrap();
        assert_eq!(w.mode, WifiMode::Hotspot);
        assert!(w.networks.iter().all(|n| !n.active));
        let Backend::Fake(f) = &b else { unreachable!() };
        f.expire();
        let w = b.wifi().await.unwrap();
        assert_eq!(w.mode, WifiMode::Client, "the client is back");
        assert_eq!(b.hotspot().await.unwrap(), None);
    }

    #[tokio::test]
    async fn joining_a_network_wants_its_password() {
        let b = Backend::Fake(Box::default());
        let mut req = WifiConnect {
            ssid: "Officina".into(),
            password: None,
            hidden: false,
        };
        assert!(b.wifi_connect(&req).await.is_err());
        req.password = Some("officina2026".into());
        b.wifi_connect(&req).await.unwrap();
        b.confirm_network().await.unwrap();
        let w = b.wifi().await.unwrap();
        assert_eq!(w.active_ssid.as_deref(), Some("Officina"));
        assert!(w.saved.contains(&"Officina".to_string()));
        let ent = WifiConnect {
            ssid: "Aziendale".into(),
            password: Some("whatever1".into()),
            hidden: false,
        };
        assert!(b.wifi_connect(&ent).await.is_err(), "802.1X is not offered");
    }
}
