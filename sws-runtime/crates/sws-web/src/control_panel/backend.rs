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
                Ok(())
            }
        }
    }

    pub async fn timezones(&self) -> Result<Vec<String>, String> {
        match self {
            Backend::Dbus => super::dbus::timezones().await,
            Backend::Fake(_) => Ok(vec!["Europe/Rome".into(), "UTC".into()]),
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

#[cfg(test)]
mod tests {
    use super::*;

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
