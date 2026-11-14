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
    pending: Mutex<Option<Card>>,
    pub time: Mutex<TimeState>,
    pub last_power: Mutex<Option<&'static str>>,
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
        }
    }
}

impl Fake {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            network: true,
            wifi: false,
            time: true,
            reboot: true,
            power_off: true,
        }
    }

    fn cards(&self) -> Vec<Card> {
        vec![self.card.lock().unwrap().clone()]
    }

    fn set_ipv4(&self, name: &str, change: &Ipv4Change) -> Result<(), String> {
        let mut card = self.card.lock().unwrap();
        if card.name != name {
            return Err(format!("no card called {name}"));
        }
        let mut pending = self.pending.lock().unwrap();
        if pending.is_none() {
            *pending = Some(card.clone());
        }
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
        if let Some(before) = self.pending.lock().unwrap().take() {
            *self.card.lock().unwrap() = before;
        }
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
}
