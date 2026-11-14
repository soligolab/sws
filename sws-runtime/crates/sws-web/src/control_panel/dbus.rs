//! The real backend: NetworkManager, `timedate1` and `login1` over the system
//! D-Bus. The socket of the system bus is already in the container on TC/WP
//! (`display_target.rs`, `launcher_dbus.rs`); on the Tiny TY and a PC the
//! runtime is a plain process.
//!
//! Permissions, measured on 13-11-2026 (plan, phase 0): PixsysOS grants the
//! `setup-user` group — the container's user — NetworkManager (with
//! `checkpoint-rollback`), `timedate1` and `login1.reboot`; on the Tiny TY the
//! installer adds a polkit file for `sws`. A call refused by polkit comes back
//! as an error string and the panel shows it; nothing here asks for a password.

use super::backend::{
    Capabilities, Card, CardKind, CardState, Ipv4Change, Ipv4Method, TimeChange, TimeState,
};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::Mutex;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

const NM: &str = "org.freedesktop.NetworkManager";
const NM_PATH: &str = "/org/freedesktop/NetworkManager";
const NM_DEVICE: &str = "org.freedesktop.NetworkManager.Device";
const NM_IP4: &str = "org.freedesktop.NetworkManager.IP4Config";
const NM_ACTIVE: &str = "org.freedesktop.NetworkManager.Connection.Active";
const NM_SETTINGS_CONN: &str = "org.freedesktop.NetworkManager.Settings.Connection";
const TIMEDATE: &str = "org.freedesktop.timedate1";
const TIMEDATE_PATH: &str = "/org/freedesktop/timedate1";
const LOGIN: &str = "org.freedesktop.login1";
const LOGIN_PATH: &str = "/org/freedesktop/login1";
const LOGIN_MANAGER: &str = "org.freedesktop.login1.Manager";
const PROPS: &str = "org.freedesktop.DBus.Properties";

/// NetworkManager's device types we tell apart (`NMDeviceType`).
const NM_DEVICE_TYPE_ETHERNET: u32 = 1;
const NM_DEVICE_TYPE_WIFI: u32 = 2;

/// The checkpoint of the last network change, until it is confirmed.
static CHECKPOINT: Mutex<Option<OwnedObjectPath>> = Mutex::new(None);

type Settings = HashMap<String, HashMap<String, OwnedValue>>;

async fn system() -> Result<zbus::Connection, String> {
    zbus::Connection::system()
        .await
        .map_err(|e| format!("system bus not reachable: {e}"))
}

async fn get_all(
    c: &zbus::Connection,
    dest: &str,
    path: &str,
    iface: &str,
) -> Result<HashMap<String, OwnedValue>, String> {
    let m = c
        .call_method(Some(dest), path, Some(PROPS), "GetAll", &(iface,))
        .await
        .map_err(|e| e.to_string())?;
    m.body().deserialize().map_err(|e| e.to_string())
}

fn prop<T>(props: &HashMap<String, OwnedValue>, key: &str) -> Option<T>
where
    T: TryFrom<OwnedValue>,
{
    props
        .get(key)
        .and_then(|v| v.try_clone().ok())
        .and_then(|v| T::try_from(v).ok())
}

fn path_or_none(p: Option<OwnedObjectPath>) -> Option<OwnedObjectPath> {
    p.filter(|p| p.as_str() != "/")
}

pub async fn capabilities() -> Capabilities {
    let Ok(c) = system().await else {
        return Capabilities::default();
    };
    let devices = nm_devices(&c).await;
    let mut wifi = false;
    if let Ok(devs) = &devices {
        for d in devs {
            if let Ok(p) = get_all(&c, NM, d.as_str(), NM_DEVICE).await {
                wifi |= prop::<u32>(&p, "DeviceType") == Some(NM_DEVICE_TYPE_WIFI);
            }
        }
    }
    let time = get_all(&c, TIMEDATE, TIMEDATE_PATH, TIMEDATE).await.is_ok();
    // `yes` only: `challenge` means polkit would ask for a password nobody
    // can type on the screen, so the button would only fail.
    let can = |m: &'static str| {
        let c = c.clone();
        async move {
            c.call_method(Some(LOGIN), LOGIN_PATH, Some(LOGIN_MANAGER), m, &())
                .await
                .ok()
                .and_then(|r| r.body().deserialize::<String>().ok())
                .is_some_and(|s| s == "yes")
        }
    };
    Capabilities {
        network: devices.is_ok(),
        wifi,
        time,
        reboot: can("CanReboot").await,
        power_off: can("CanPowerOff").await,
    }
}

async fn nm_devices(c: &zbus::Connection) -> Result<Vec<OwnedObjectPath>, String> {
    let m = c
        .call_method(Some(NM), NM_PATH, Some(NM), "GetDevices", &())
        .await
        .map_err(|e| format!("NetworkManager: {e}"))?;
    m.body().deserialize().map_err(|e| e.to_string())
}

/// `NMDeviceState` reduced to the four the screen shows.
fn card_state(nm: u32) -> CardState {
    match nm {
        100 => CardState::Connected,
        40..=90 => CardState::Connecting,
        30 => CardState::Disconnected,
        _ => CardState::Unavailable,
    }
}

fn ipv4_method(s: &str) -> Ipv4Method {
    match s {
        "auto" => Ipv4Method::Auto,
        "manual" => Ipv4Method::Manual,
        "disabled" => Ipv4Method::Disabled,
        _ => Ipv4Method::Other,
    }
}

/// `aa{sv}` with an `address` string in each entry (`AddressData`,
/// `NameserverData`).
fn address_list(props: &HashMap<String, OwnedValue>, key: &str, with_prefix: bool) -> Vec<String> {
    let Some(list) = prop::<Vec<HashMap<String, OwnedValue>>>(props, key) else {
        return vec![];
    };
    list.iter()
        .filter_map(|e| {
            let a = prop::<String>(e, "address")?;
            if with_prefix {
                Some(format!("{a}/{}", prop::<u32>(e, "prefix").unwrap_or(32)))
            } else {
                Some(a)
            }
        })
        .collect()
}

pub async fn cards() -> Result<Vec<Card>, String> {
    let c = system().await?;
    let mut out = Vec::new();
    for d in nm_devices(&c).await? {
        let p = get_all(&c, NM, d.as_str(), NM_DEVICE).await?;
        let kind = match prop::<u32>(&p, "DeviceType") {
            Some(NM_DEVICE_TYPE_ETHERNET) => CardKind::Ethernet,
            Some(NM_DEVICE_TYPE_WIFI) => CardKind::Wifi,
            _ => continue, // loopback, bond, can, dummy: not the panel's business
        };
        let name = prop::<String>(&p, "Interface").unwrap_or_default();
        let mut card = Card {
            mac: std::fs::read_to_string(format!("/sys/class/net/{name}/address"))
                .ok()
                .map(|m| m.trim().to_string()),
            name,
            kind,
            state: card_state(prop::<u32>(&p, "State").unwrap_or(0)),
            addresses: vec![],
            gateway: None,
            dns: vec![],
            method: None,
        };
        if let Some(ip4) = path_or_none(prop(&p, "Ip4Config")) {
            if let Ok(ip) = get_all(&c, NM, ip4.as_str(), NM_IP4).await {
                card.addresses = address_list(&ip, "AddressData", true);
                card.gateway = prop::<String>(&ip, "Gateway").filter(|g| !g.is_empty());
                card.dns = address_list(&ip, "NameserverData", false);
            }
        }
        if let Some(settings) = active_settings(&c, &p).await {
            card.method = settings
                .get("ipv4")
                .and_then(|s| prop::<String>(s, "method"))
                .map(|m| ipv4_method(&m));
        }
        out.push(card);
    }
    Ok(out)
}

/// The saved profile behind the device's active connection, and its path.
async fn active_profile(
    c: &zbus::Connection,
    device_props: &HashMap<String, OwnedValue>,
) -> Option<OwnedObjectPath> {
    let active = path_or_none(prop(device_props, "ActiveConnection"))?;
    let a = get_all(c, NM, active.as_str(), NM_ACTIVE).await.ok()?;
    path_or_none(prop(&a, "Connection"))
}

async fn active_settings(
    c: &zbus::Connection,
    device_props: &HashMap<String, OwnedValue>,
) -> Option<Settings> {
    let profile = active_profile(c, device_props).await?;
    let m = c
        .call_method(
            Some(NM),
            profile.as_str(),
            Some(NM_SETTINGS_CONN),
            "GetSettings",
            &(),
        )
        .await
        .ok()?;
    m.body().deserialize().ok()
}

async fn device_by_name(
    c: &zbus::Connection,
    name: &str,
) -> Result<(OwnedObjectPath, HashMap<String, OwnedValue>), String> {
    for d in nm_devices(c).await? {
        let p = get_all(c, NM, d.as_str(), NM_DEVICE).await?;
        if prop::<String>(&p, "Interface").as_deref() == Some(name) {
            return Ok((d, p));
        }
    }
    Err(format!("no card called {name}"))
}

fn ov(v: Value<'_>) -> Result<OwnedValue, String> {
    OwnedValue::try_from(v).map_err(|e| e.to_string())
}

/// The `ipv4` section of a profile rewritten for `change`. The old keys that
/// NetworkManager would otherwise merge with the new ones (`addresses`,
/// `address-data`, `gateway`, `dns`) go first; `dns` is `au` in network byte
/// order, the form NetworkManager 1.36 (Tiny TY) still reads.
fn ipv4_section(
    mut ipv4: HashMap<String, OwnedValue>,
    change: &Ipv4Change,
) -> Result<HashMap<String, OwnedValue>, String> {
    for k in ["addresses", "address-data", "gateway", "dns"] {
        ipv4.remove(k);
    }
    match change.method {
        Ipv4Method::Auto => {
            ipv4.insert("method".into(), ov(Value::from("auto"))?);
        }
        Ipv4Method::Manual => {
            let addr = change.address.ok_or("missing address")?;
            let prefix = change.prefix.ok_or("missing prefix")?;
            ipv4.insert("method".into(), ov(Value::from("manual"))?);
            let mut entry: HashMap<String, Value> = HashMap::new();
            entry.insert("address".into(), Value::from(addr.to_string()));
            entry.insert("prefix".into(), Value::from(u32::from(prefix)));
            ipv4.insert("address-data".into(), ov(Value::from(vec![entry]))?);
            if let Some(g) = change.gateway {
                ipv4.insert("gateway".into(), ov(Value::from(g.to_string()))?);
            }
            if !change.dns.is_empty() {
                let dns: Vec<u32> = change.dns.iter().map(dns_u32).collect();
                ipv4.insert("dns".into(), ov(Value::from(dns))?);
            }
        }
        Ipv4Method::Disabled | Ipv4Method::Other => return Err("not settable".into()),
    }
    Ok(ipv4)
}

/// An IPv4 address as NetworkManager's `au`: the four bytes in network order,
/// read as a native integer.
fn dns_u32(a: &Ipv4Addr) -> u32 {
    u32::from_ne_bytes(a.octets())
}

pub async fn set_ipv4(card: &str, change: &Ipv4Change, rollback_secs: u32) -> Result<(), String> {
    let c = system().await?;
    let (device, props) = device_by_name(&c, card).await?;
    let profile = active_profile(&c, &props)
        .await
        .ok_or_else(|| format!("{card} has no active profile to change"))?;
    let m = c
        .call_method(
            Some(NM),
            profile.as_str(),
            Some(NM_SETTINGS_CONN),
            "GetSettings",
            &(),
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut settings: Settings = m.body().deserialize().map_err(|e| e.to_string())?;
    let ipv4 = settings.remove("ipv4").unwrap_or_default();
    settings.insert("ipv4".into(), ipv4_section(ipv4, change)?);

    // A checkpoint on this device first: if the confirmation does not come,
    // NetworkManager puts back the profile and the device by itself.
    // Flags 0 = roll back only this device. A previous checkpoint still open
    // is replaced: NetworkManager refuses two on the same device.
    let previous = CHECKPOINT.lock().unwrap().take();
    if let Some(old) = previous {
        let _ = c
            .call_method(Some(NM), NM_PATH, Some(NM), "CheckpointDestroy", &(old,))
            .await;
    }
    let devices = vec![device.clone()];
    let cp = c
        .call_method(
            Some(NM),
            NM_PATH,
            Some(NM),
            "CheckpointCreate",
            &(devices, rollback_secs, 0u32),
        )
        .await
        .map_err(|e| format!("checkpoint: {e}"))?;
    let cp: OwnedObjectPath = cp.body().deserialize().map_err(|e| e.to_string())?;
    *CHECKPOINT.lock().unwrap() = Some(cp);

    c.call_method(
        Some(NM),
        profile.as_str(),
        Some(NM_SETTINGS_CONN),
        "Update",
        &(settings,),
    )
    .await
    .map_err(|e| format!("update: {e}"))?;
    let root = zbus::zvariant::ObjectPath::try_from("/").map_err(|e| e.to_string())?;
    c.call_method(
        Some(NM),
        NM_PATH,
        Some(NM),
        "ActivateConnection",
        &(profile, device, root),
    )
    .await
    .map_err(|e| format!("activate: {e}"))?;
    Ok(())
}

pub async fn confirm_network() -> Result<(), String> {
    let cp = CHECKPOINT
        .lock()
        .unwrap()
        .take()
        .ok_or("no network change waiting for a confirmation")?;
    let c = system().await?;
    c.call_method(Some(NM), NM_PATH, Some(NM), "CheckpointDestroy", &(cp,))
        .await
        .map_err(|e| format!("the change was already undone ({e})"))?;
    Ok(())
}

/// Undoes the pending change now, instead of waiting for the timeout.
pub async fn rollback_network() -> Result<(), String> {
    let cp = CHECKPOINT
        .lock()
        .unwrap()
        .take()
        .ok_or("no network change waiting for a confirmation")?;
    let c = system().await?;
    c.call_method(Some(NM), NM_PATH, Some(NM), "CheckpointRollback", &(cp,))
        .await
        .map_err(|e| format!("the change was already undone ({e})"))?;
    Ok(())
}

pub async fn time() -> Result<TimeState, String> {
    let c = system().await?;
    let p = get_all(&c, TIMEDATE, TIMEDATE_PATH, TIMEDATE).await?;
    Ok(TimeState {
        timezone: prop(&p, "Timezone").unwrap_or_default(),
        ntp: prop(&p, "NTP").unwrap_or(false),
        can_ntp: prop(&p, "CanNTP").unwrap_or(false),
        ntp_synchronized: prop(&p, "NTPSynchronized").unwrap_or(false),
        time_usec: prop(&p, "TimeUSec").unwrap_or(0),
    })
}

pub async fn set_time(change: &TimeChange) -> Result<(), String> {
    let c = system().await?;
    if let Some(tz) = &change.timezone {
        c.call_method(
            Some(TIMEDATE),
            TIMEDATE_PATH,
            Some(TIMEDATE),
            "SetTimezone",
            &(tz.as_str(), false),
        )
        .await
        .map_err(|e| format!("timezone: {e}"))?;
    }
    if let Some(usec) = change.time_usec {
        // timedated refuses a manual time while NTP is on.
        c.call_method(
            Some(TIMEDATE),
            TIMEDATE_PATH,
            Some(TIMEDATE),
            "SetNTP",
            &(false, false),
        )
        .await
        .map_err(|e| format!("ntp: {e}"))?;
        let usec = i64::try_from(usec).map_err(|_| "time out of range")?;
        c.call_method(
            Some(TIMEDATE),
            TIMEDATE_PATH,
            Some(TIMEDATE),
            "SetTime",
            &(usec, false, false),
        )
        .await
        .map_err(|e| format!("time: {e}"))?;
    }
    if let Some(ntp) = change.ntp {
        c.call_method(
            Some(TIMEDATE),
            TIMEDATE_PATH,
            Some(TIMEDATE),
            "SetNTP",
            &(ntp, false),
        )
        .await
        .map_err(|e| format!("ntp: {e}"))?;
    }
    Ok(())
}

pub async fn timezones() -> Result<Vec<String>, String> {
    let c = system().await?;
    let m = c
        .call_method(
            Some(TIMEDATE),
            TIMEDATE_PATH,
            Some(TIMEDATE),
            "ListTimezones",
            &(),
        )
        .await
        .map_err(|e| e.to_string())?;
    m.body().deserialize().map_err(|e| e.to_string())
}

/// `power_off` false = reboot.
pub async fn reboot(power_off: bool) -> Result<(), String> {
    let c = system().await?;
    let method = if power_off { "PowerOff" } else { "Reboot" };
    c.call_method(
        Some(LOGIN),
        LOGIN_PATH,
        Some(LOGIN_MANAGER),
        method,
        &(false,),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dns_goes_in_network_byte_order() {
        let a: Ipv4Addr = "192.168.1.1".parse().unwrap();
        assert_eq!(dns_u32(&a).to_ne_bytes(), [192, 168, 1, 1]);
    }

    #[test]
    fn the_old_addresses_do_not_survive_a_change() {
        let mut old = HashMap::new();
        old.insert("method".to_string(), ov(Value::from("manual")).unwrap());
        old.insert("gateway".to_string(), ov(Value::from("10.0.0.1")).unwrap());
        old.insert("may-fail".to_string(), ov(Value::from(true)).unwrap());
        let dhcp = Ipv4Change {
            method: Ipv4Method::Auto,
            address: None,
            prefix: None,
            gateway: None,
            dns: vec![],
        };
        let s = ipv4_section(old, &dhcp).unwrap();
        assert_eq!(prop::<String>(&s, "method").as_deref(), Some("auto"));
        assert!(!s.contains_key("gateway"));
        assert_eq!(prop::<bool>(&s, "may-fail"), Some(true), "other keys stay");
    }

    #[test]
    fn a_static_section_has_address_data() {
        let change = Ipv4Change {
            method: Ipv4Method::Manual,
            address: Some("192.168.1.50".parse().unwrap()),
            prefix: Some(24),
            gateway: Some("192.168.1.1".parse().unwrap()),
            dns: vec!["192.168.1.1".parse().unwrap()],
        };
        let s = ipv4_section(HashMap::new(), &change).unwrap();
        assert_eq!(
            address_list(&s, "address-data", true),
            vec!["192.168.1.50/24".to_string()]
        );
        assert_eq!(
            prop::<String>(&s, "gateway").as_deref(),
            Some("192.168.1.1")
        );
        assert_eq!(prop::<Vec<u32>>(&s, "dns").map(|v| v.len()), Some(1));
    }

    #[test]
    fn device_states_reduce_to_four() {
        assert_eq!(card_state(100), CardState::Connected);
        assert_eq!(card_state(70), CardState::Connecting);
        assert_eq!(card_state(30), CardState::Disconnected);
        assert_eq!(card_state(20), CardState::Unavailable);
    }
}
