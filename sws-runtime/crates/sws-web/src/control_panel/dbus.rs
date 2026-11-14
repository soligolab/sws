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
    Capabilities, Card, CardKind, CardState, Hotspot, Ipv4Change, Ipv4Method, TimeChange,
    TimeState, WifiConnect, WifiMode, WifiNetwork, WifiSecurity, WifiState,
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
const NM_SETTINGS: &str = "org.freedesktop.NetworkManager.Settings";
const NM_SETTINGS_PATH: &str = "/org/freedesktop/NetworkManager/Settings";
const NM_WIRELESS: &str = "org.freedesktop.NetworkManager.Device.Wireless";
const NM_AP: &str = "org.freedesktop.NetworkManager.AccessPoint";
const SYSTEMD: &str = "org.freedesktop.systemd1";
const SYSTEMD_PATH: &str = "/org/freedesktop/systemd1";
const SYSTEMD_MANAGER: &str = "org.freedesktop.systemd1.Manager";
const SYSTEMD_UNIT: &str = "org.freedesktop.systemd1.Unit";
/// PixsysOS' touch calibration; `setup-user` may start it (phase 0).
const TOUCH_CALIBRATION_UNIT: &str = "touch-calibration.service";
const PIXSYS: &str = "net.pixsys.Config1";
const PIXSYS_DISPLAY_PATH: &str = "/net/pixsys/Config1/Display";
const PIXSYS_DISPLAY: &str = "net.pixsys.Config1.Display";
const TIMEDATE: &str = "org.freedesktop.timedate1";
const TIMEDATE_PATH: &str = "/org/freedesktop/timedate1";
const LOGIN: &str = "org.freedesktop.login1";
const LOGIN_PATH: &str = "/org/freedesktop/login1";
const LOGIN_MANAGER: &str = "org.freedesktop.login1.Manager";
const PROPS: &str = "org.freedesktop.DBus.Properties";

/// NetworkManager's device types we tell apart (`NMDeviceType`).
const NM_DEVICE_TYPE_ETHERNET: u32 = 1;
const NM_DEVICE_TYPE_WIFI: u32 = 2;
/// `NM_WIFI_DEVICE_CAP_AP`: the card can be an access point.
const NM_WIFI_DEVICE_CAP_AP: u32 = 0x40;
/// `NM_802_11_AP_SEC_KEY_MGMT_*`.
const KEY_MGMT_PSK: u32 = 0x100;
const KEY_MGMT_802_1X: u32 = 0x200;
const KEY_MGMT_SAE: u32 = 0x400;
/// `NM_CHECKPOINT_CREATE_FLAG_DELETE_NEW_CONNECTIONS`: an unconfirmed Wi-Fi
/// profile goes away with the rollback, instead of staying saved.
const CHECKPOINT_DELETE_NEW: u32 = 0x02;
/// The profile names SWS creates. The hotspot is one; client profiles carry
/// the SSID.
const HOTSPOT_ID: &str = "sws-hotspot";
const CLIENT_ID_PREFIX: &str = "sws-wifi-";

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
        display: backlight_by_viewer() || pixsys_display(&c).await,
        touch_calibration_service: unit_loaded(&c, TOUCH_CALIBRATION_UNIT).await,
    }
}

/// The unit exists on this system: `LoadUnit` answers for any name, so the
/// `LoadState` says whether there is a file behind it.
async fn unit_loaded(c: &zbus::Connection, unit: &str) -> bool {
    let Ok(m) = c
        .call_method(
            Some(SYSTEMD),
            SYSTEMD_PATH,
            Some(SYSTEMD_MANAGER),
            "LoadUnit",
            &(unit,),
        )
        .await
    else {
        return false;
    };
    let Ok(path) = m.body().deserialize::<OwnedObjectPath>() else {
        return false;
    };
    get_all(c, SYSTEMD, path.as_str(), SYSTEMD_UNIT)
        .await
        .ok()
        .and_then(|p| prop::<String>(&p, "LoadState"))
        .is_some_and(|s| s == "loaded")
}

pub async fn start_touch_calibration() -> Result<(), String> {
    let c = system().await?;
    c.call_method(
        Some(SYSTEMD),
        SYSTEMD_PATH,
        Some(SYSTEMD_MANAGER),
        "StartUnit",
        &(TOUCH_CALIBRATION_UNIT, "replace"),
    )
    .await
    .map_err(|e| format!("touch calibration: {e}"))?;
    Ok(())
}

/// The Tiny TY's runtime launcher says so: the viewer drives the backlight
/// (`schermo.rs`, `--retroilluminazione`) and reads the panel's value.
fn backlight_by_viewer() -> bool {
    std::env::var("SWS_BACKLIGHT_BY_VIEWER").is_ok_and(|v| v == "1")
}

/// PixsysOS: `net.pixsys.Config1.Display`, measured in phase 0.
async fn pixsys_display(c: &zbus::Connection) -> bool {
    c.call_method(
        Some(PIXSYS),
        PIXSYS_DISPLAY_PATH,
        Some(PIXSYS_DISPLAY),
        "HasDisplayCapabilities",
        &(),
    )
    .await
    .ok()
    .and_then(|r| r.body().deserialize::<bool>().ok())
    .unwrap_or(false)
}

/// Brightness in percent. On the Tiny TY there is nothing to do here: the
/// viewer applies the saved value. On PixsysOS the light is root's, and
/// `Config1.Display` sets it.
pub async fn apply_brightness(percent: u8) -> Result<(), String> {
    if backlight_by_viewer() {
        return Ok(());
    }
    let c = system().await?;
    c.call_method(
        Some(PIXSYS),
        PIXSYS_DISPLAY_PATH,
        Some(PIXSYS_DISPLAY),
        "SetBrightness",
        &(u32::from(percent),),
    )
    .await
    .map_err(|e| format!("brightness: {e}"))?;
    Ok(())
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

/// Opens the checkpoint of a change on `device`. Flags 0 = roll back only this
/// device. A previous checkpoint still open is replaced: NetworkManager refuses
/// two on the same device.
async fn checkpoint(
    c: &zbus::Connection,
    device: &OwnedObjectPath,
    rollback_secs: u32,
    flags: u32,
) -> Result<(), String> {
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
            &(devices, rollback_secs, flags),
        )
        .await
        .map_err(|e| format!("checkpoint: {e}"))?;
    let cp: OwnedObjectPath = cp.body().deserialize().map_err(|e| e.to_string())?;
    *CHECKPOINT.lock().unwrap() = Some(cp);
    Ok(())
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
    checkpoint(&c, &device, rollback_secs, 0).await?;

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

// ── Wi-Fi ───────────────────────────────────────────────────────────────────

/// The first Wi-Fi card and its device properties.
async fn wifi_device(
    c: &zbus::Connection,
) -> Result<Option<(OwnedObjectPath, HashMap<String, OwnedValue>)>, String> {
    for d in nm_devices(c).await? {
        let p = get_all(c, NM, d.as_str(), NM_DEVICE).await?;
        if prop::<u32>(&p, "DeviceType") == Some(NM_DEVICE_TYPE_WIFI) {
            return Ok(Some((d, p)));
        }
    }
    Ok(None)
}

async fn require_wifi_device(
    c: &zbus::Connection,
) -> Result<(OwnedObjectPath, HashMap<String, OwnedValue>), String> {
    wifi_device(c)
        .await?
        .ok_or_else(|| "no Wi-Fi card".to_string())
}

/// Security of an access point from its flags (`NM80211ApFlags`, and the WPA
/// and RSN `NM80211ApSecurityFlags`).
fn ap_security(flags: u32, wpa: u32, rsn: u32) -> WifiSecurity {
    let mgmt = wpa | rsn;
    if mgmt & KEY_MGMT_802_1X != 0 {
        WifiSecurity::Enterprise
    } else if mgmt & KEY_MGMT_PSK != 0 {
        WifiSecurity::Wpa
    } else if mgmt & KEY_MGMT_SAE != 0 {
        WifiSecurity::Wpa3
    } else if flags & 1 != 0 {
        // Privacy without WPA: WEP. Treated as WPA-PSK by the form; joining
        // will fail with NetworkManager's message, which is honest enough.
        WifiSecurity::Wpa
    } else {
        WifiSecurity::Open
    }
}

/// One entry per SSID, strongest first; hidden networks (empty SSID) left out.
fn dedup_networks(mut seen: Vec<WifiNetwork>) -> Vec<WifiNetwork> {
    seen.sort_by(|a, b| b.active.cmp(&a.active).then(b.signal.cmp(&a.signal)));
    let mut out: Vec<WifiNetwork> = Vec::new();
    for n in seen {
        if !n.ssid.is_empty() && !out.iter().any(|o| o.ssid == n.ssid) {
            out.push(n);
        }
    }
    out
}

/// A saved profile: its path and settings.
struct Profile {
    path: OwnedObjectPath,
    settings: Settings,
}

impl Profile {
    fn get<T: TryFrom<OwnedValue>>(&self, section: &str, key: &str) -> Option<T> {
        self.settings.get(section).and_then(|s| prop::<T>(s, key))
    }
    fn is_wifi(&self) -> bool {
        self.get::<String>("connection", "type").as_deref() == Some("802-11-wireless")
    }
    fn ssid(&self) -> Option<String> {
        self.get::<Vec<u8>>("802-11-wireless", "ssid")
            .map(|b| String::from_utf8_lossy(&b).into_owned())
    }
    fn is_ap(&self) -> bool {
        self.get::<String>("802-11-wireless", "mode").as_deref() == Some("ap")
    }
    fn id(&self) -> String {
        self.get::<String>("connection", "id").unwrap_or_default()
    }
}

async fn wifi_profiles(c: &zbus::Connection) -> Result<Vec<Profile>, String> {
    let m = c
        .call_method(
            Some(NM),
            NM_SETTINGS_PATH,
            Some(NM_SETTINGS),
            "ListConnections",
            &(),
        )
        .await
        .map_err(|e| format!("NetworkManager: {e}"))?;
    let paths: Vec<OwnedObjectPath> = m.body().deserialize().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for path in paths {
        let Ok(m) = c
            .call_method(
                Some(NM),
                path.as_str(),
                Some(NM_SETTINGS_CONN),
                "GetSettings",
                &(),
            )
            .await
        else {
            continue;
        };
        let Ok(settings) = m.body().deserialize::<Settings>() else {
            continue;
        };
        let p = Profile { path, settings };
        if p.is_wifi() {
            out.push(p);
        }
    }
    Ok(out)
}

/// The hotspot profile: the one SWS made, or any access-point profile.
fn find_hotspot(profiles: &[Profile]) -> Option<&Profile> {
    profiles
        .iter()
        .find(|p| p.id() == HOTSPOT_ID)
        .or_else(|| profiles.iter().find(|p| p.is_ap()))
}

pub async fn wifi() -> Result<WifiState, String> {
    let c = system().await?;
    let nm = get_all(&c, NM, NM_PATH, NM).await?;
    let radio = prop::<bool>(&nm, "WirelessEnabled").unwrap_or(false);
    let Some((device, dev)) = wifi_device(&c).await? else {
        return Ok(WifiState {
            card: None,
            radio,
            mode: WifiMode::Off,
            active_ssid: None,
            networks: vec![],
            saved: vec![],
            can_hotspot: false,
        });
    };
    let wl = get_all(&c, NM, device.as_str(), NM_WIRELESS).await?;
    let profiles = wifi_profiles(&c).await.unwrap_or_default();
    let saved: Vec<String> = profiles
        .iter()
        .filter(|p| !p.is_ap())
        .filter_map(Profile::ssid)
        .collect();

    let state = prop::<u32>(&dev, "State").unwrap_or(0);
    let active = match active_profile(&c, &dev).await {
        Some(path) => profiles.iter().find(|p| p.path == path),
        None => None,
    };
    let mode = match (radio, active) {
        (false, _) => WifiMode::Off,
        (true, Some(p)) if p.is_ap() => WifiMode::Hotspot,
        (true, Some(_)) if (40..=100).contains(&state) => WifiMode::Client,
        _ => WifiMode::Idle,
    };
    let active_ssid = active.and_then(Profile::ssid);

    let mut seen = Vec::new();
    let aps: Vec<OwnedObjectPath> = prop(&wl, "AccessPoints").unwrap_or_default();
    for ap in aps {
        let Ok(a) = get_all(&c, NM, ap.as_str(), NM_AP).await else {
            continue;
        };
        let ssid = prop::<Vec<u8>>(&a, "Ssid")
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default();
        seen.push(WifiNetwork {
            known: saved.contains(&ssid),
            active: mode == WifiMode::Client && active_ssid.as_deref() == Some(ssid.as_str()),
            signal: prop::<u8>(&a, "Strength").unwrap_or(0),
            security: ap_security(
                prop(&a, "Flags").unwrap_or(0),
                prop(&a, "WpaFlags").unwrap_or(0),
                prop(&a, "RsnFlags").unwrap_or(0),
            ),
            ssid,
        });
    }

    Ok(WifiState {
        card: prop::<String>(&dev, "Interface"),
        radio,
        mode,
        active_ssid: if matches!(mode, WifiMode::Client | WifiMode::Hotspot) {
            active_ssid
        } else {
            None
        },
        networks: dedup_networks(seen),
        saved,
        can_hotspot: prop::<u32>(&wl, "WirelessCapabilities").unwrap_or(0) & NM_WIFI_DEVICE_CAP_AP
            != 0,
    })
}

pub async fn wifi_scan() -> Result<(), String> {
    let c = system().await?;
    let (device, _) = require_wifi_device(&c).await?;
    let opts: HashMap<String, OwnedValue> = HashMap::new();
    c.call_method(
        Some(NM),
        device.as_str(),
        Some(NM_WIRELESS),
        "RequestScan",
        &(opts,),
    )
    .await
    .map_err(|e| format!("scan: {e}"))?;
    Ok(())
}

pub async fn wifi_radio(enabled: bool) -> Result<(), String> {
    let c = system().await?;
    c.call_method(
        Some(NM),
        NM_PATH,
        Some(PROPS),
        "Set",
        &(NM, "WirelessEnabled", Value::from(enabled)),
    )
    .await
    .map_err(|e| format!("radio: {e}"))?;
    Ok(())
}

/// A random version-4 UUID, as NetworkManager wants for a new profile.
fn new_uuid() -> String {
    let mut b = super::random_bytes::<16>();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn section(pairs: Vec<(&str, Value<'_>)>) -> Result<HashMap<String, OwnedValue>, String> {
    pairs
        .into_iter()
        .map(|(k, v)| Ok((k.to_string(), ov(v)?)))
        .collect()
}

/// A new client profile for `req`. `wpa3` = the network only offers SAE.
fn client_settings(req: &WifiConnect, card: &str, wpa3: bool) -> Result<Settings, String> {
    let mut s = Settings::new();
    s.insert(
        "connection".into(),
        section(vec![
            ("id", Value::from(format!("{CLIENT_ID_PREFIX}{}", req.ssid))),
            ("uuid", Value::from(new_uuid())),
            ("type", Value::from("802-11-wireless")),
            ("interface-name", Value::from(card.to_string())),
            ("autoconnect", Value::from(true)),
        ])?,
    );
    s.insert(
        "802-11-wireless".into(),
        section(vec![
            ("ssid", Value::from(req.ssid.as_bytes().to_vec())),
            ("mode", Value::from("infrastructure")),
            ("hidden", Value::from(req.hidden)),
        ])?,
    );
    if let Some(pw) = req.password.as_deref().filter(|p| !p.is_empty()) {
        s.insert(
            "802-11-wireless-security".into(),
            section(vec![
                (
                    "key-mgmt",
                    Value::from(if wpa3 { "sae" } else { "wpa-psk" }),
                ),
                ("psk", Value::from(pw.to_string())),
            ])?,
        );
    }
    s.insert(
        "ipv4".into(),
        section(vec![("method", Value::from("auto"))])?,
    );
    s.insert(
        "ipv6".into(),
        section(vec![("method", Value::from("auto"))])?,
    );
    Ok(s)
}

/// The hotspot profile: 2.4 GHz, WPA2-PSK (CCMP only, the combination every
/// phone accepts), `ipv4.method=shared` so NetworkManager hands out addresses
/// with dnsmasq (10.42.0.1/24). A high autoconnect priority so that, when it
/// is on, it wins over saved client networks at boot.
fn hotspot_settings(h: &Hotspot, card: &str, uuid: String) -> Result<Settings, String> {
    let mut s = Settings::new();
    s.insert(
        "connection".into(),
        section(vec![
            ("id", Value::from(HOTSPOT_ID)),
            ("uuid", Value::from(uuid)),
            ("type", Value::from("802-11-wireless")),
            ("interface-name", Value::from(card.to_string())),
            ("autoconnect", Value::from(h.enabled)),
            ("autoconnect-priority", Value::from(50i32)),
        ])?,
    );
    s.insert(
        "802-11-wireless".into(),
        section(vec![
            ("ssid", Value::from(h.ssid.as_bytes().to_vec())),
            ("mode", Value::from("ap")),
            ("band", Value::from("bg")),
        ])?,
    );
    s.insert(
        "802-11-wireless-security".into(),
        section(vec![
            ("key-mgmt", Value::from("wpa-psk")),
            ("psk", Value::from(h.password.clone())),
            ("proto", Value::from(vec!["rsn"])),
            ("pairwise", Value::from(vec!["ccmp"])),
            ("group", Value::from(vec!["ccmp"])),
        ])?,
    );
    s.insert(
        "ipv4".into(),
        section(vec![("method", Value::from("shared"))])?,
    );
    s.insert(
        "ipv6".into(),
        section(vec![("method", Value::from("ignore"))])?,
    );
    Ok(s)
}

async fn activate(
    c: &zbus::Connection,
    profile: &OwnedObjectPath,
    device: &OwnedObjectPath,
) -> Result<(), String> {
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

async fn add_profile(c: &zbus::Connection, settings: Settings) -> Result<OwnedObjectPath, String> {
    let m = c
        .call_method(
            Some(NM),
            NM_SETTINGS_PATH,
            Some(NM_SETTINGS),
            "AddConnection",
            &(settings,),
        )
        .await
        .map_err(|e| format!("add profile: {e}"))?;
    m.body().deserialize().map_err(|e| e.to_string())
}

async fn update_profile(
    c: &zbus::Connection,
    path: &OwnedObjectPath,
    settings: Settings,
) -> Result<(), String> {
    c.call_method(
        Some(NM),
        path.as_str(),
        Some(NM_SETTINGS_CONN),
        "Update",
        &(settings,),
    )
    .await
    .map_err(|e| format!("update: {e}"))?;
    Ok(())
}

/// `autoconnect` of a saved profile, keeping everything else.
async fn set_autoconnect(c: &zbus::Connection, p: &Profile, on: bool) -> Result<(), String> {
    let mut settings = p.settings.clone();
    if let Some(conn) = settings.get_mut("connection") {
        conn.insert("autoconnect".into(), ov(Value::from(on))?);
    }
    // GetSettings never returns secrets: an Update without them would wipe
    // the PSK, so they are read back first.
    if let Ok(secrets) = profile_secrets(c, &p.path).await {
        if let Some(sec) = secrets.get("802-11-wireless-security") {
            let entry = settings
                .entry("802-11-wireless-security".into())
                .or_default();
            for (k, v) in sec {
                if let Ok(v) = v.try_clone() {
                    entry.insert(k.clone(), v);
                }
            }
        }
    }
    update_profile(c, &p.path, settings).await
}

async fn profile_secrets(c: &zbus::Connection, path: &OwnedObjectPath) -> Result<Settings, String> {
    let m = c
        .call_method(
            Some(NM),
            path.as_str(),
            Some(NM_SETTINGS_CONN),
            "GetSecrets",
            &("802-11-wireless-security",),
        )
        .await
        .map_err(|e| format!("secrets: {e}"))?;
    m.body().deserialize().map_err(|e| e.to_string())
}

pub async fn wifi_connect(req: &WifiConnect, rollback_secs: u32) -> Result<(), String> {
    let c = system().await?;
    let (device, dev) = require_wifi_device(&c).await?;
    let card = prop::<String>(&dev, "Interface").unwrap_or_default();
    let state = wifi().await?;
    let net = state.networks.iter().find(|n| n.ssid == req.ssid);
    if net.is_some_and(|n| n.security == WifiSecurity::Enterprise) {
        return Err("802.1X networks cannot be joined from the panel".into());
    }
    let profiles = wifi_profiles(&c).await?;
    let existing = profiles
        .iter()
        .find(|p| !p.is_ap() && p.ssid().as_deref() == Some(req.ssid.as_str()));
    let password = req.password.as_deref().filter(|p| !p.is_empty());
    if existing.is_none()
        && password.is_none()
        && net.is_some_and(|n| n.security != WifiSecurity::Open)
    {
        return Err(format!("{} needs a password", req.ssid));
    }

    checkpoint(&c, &device, rollback_secs, CHECKPOINT_DELETE_NEW).await?;
    // The hotspot would take the card back at the next boot.
    if let Some(h) = find_hotspot(&profiles) {
        if h.get::<bool>("connection", "autoconnect").unwrap_or(true) {
            set_autoconnect(&c, h, false).await?;
        }
    }
    let wpa3 = net.is_some_and(|n| n.security == WifiSecurity::Wpa3);
    let path = match existing {
        Some(p) if password.is_none() => p.path.clone(),
        Some(p) => {
            let mut s = client_settings(req, &card, wpa3)?;
            // Same profile, new password: keep its uuid.
            if let (Some(conn), Some(uuid)) = (
                s.get_mut("connection"),
                p.get::<String>("connection", "uuid"),
            ) {
                conn.insert("uuid".into(), ov(Value::from(uuid))?);
                conn.insert("id".into(), ov(Value::from(p.id()))?);
            }
            update_profile(&c, &p.path, s).await?;
            p.path.clone()
        }
        None => add_profile(&c, client_settings(req, &card, wpa3)?).await?,
    };
    activate(&c, &path, &device).await
}

pub async fn wifi_forget(ssid: &str) -> Result<(), String> {
    let c = system().await?;
    let profiles = wifi_profiles(&c).await?;
    let mut found = false;
    for p in profiles
        .iter()
        .filter(|p| !p.is_ap() && p.ssid().as_deref() == Some(ssid))
    {
        c.call_method(
            Some(NM),
            p.path.as_str(),
            Some(NM_SETTINGS_CONN),
            "Delete",
            &(),
        )
        .await
        .map_err(|e| format!("forget: {e}"))?;
        found = true;
    }
    if found {
        Ok(())
    } else {
        Err(format!("no saved network called {ssid}"))
    }
}

pub async fn hotspot() -> Result<Option<Hotspot>, String> {
    let c = system().await?;
    let profiles = wifi_profiles(&c).await?;
    let Some(p) = find_hotspot(&profiles) else {
        return Ok(None);
    };
    let password = profile_secrets(&c, &p.path)
        .await
        .ok()
        .and_then(|s| {
            s.get("802-11-wireless-security")
                .and_then(|sec| prop::<String>(sec, "psk"))
        })
        .unwrap_or_default();
    Ok(Some(Hotspot {
        enabled: p.get::<bool>("connection", "autoconnect").unwrap_or(true),
        ssid: p.ssid().unwrap_or_default(),
        password,
    }))
}

pub async fn set_hotspot(h: &Hotspot, rollback_secs: u32) -> Result<(), String> {
    let c = system().await?;
    let (device, dev) = require_wifi_device(&c).await?;
    let card = prop::<String>(&dev, "Interface").unwrap_or_default();
    if h.enabled {
        let wl = get_all(&c, NM, device.as_str(), NM_WIRELESS).await?;
        if prop::<u32>(&wl, "WirelessCapabilities").unwrap_or(0) & NM_WIFI_DEVICE_CAP_AP == 0 {
            return Err("this Wi-Fi card cannot be an access point".into());
        }
    }
    let profiles = wifi_profiles(&c).await?;
    let existing = find_hotspot(&profiles);

    checkpoint(&c, &device, rollback_secs, CHECKPOINT_DELETE_NEW).await?;
    let uuid = existing
        .and_then(|p| p.get::<String>("connection", "uuid"))
        .unwrap_or_else(new_uuid);
    let settings = hotspot_settings(h, &card, uuid)?;
    let path = match existing {
        Some(p) => {
            update_profile(&c, &p.path, settings).await?;
            p.path.clone()
        }
        None => add_profile(&c, settings).await?,
    };
    if h.enabled {
        activate(&c, &path, &device).await
    } else {
        // Off now, not only at the next boot.
        if let Some(active) = path_or_none(prop(&dev, "ActiveConnection")) {
            if active_profile(&c, &dev).await.as_ref() == Some(&path) {
                c.call_method(
                    Some(NM),
                    NM_PATH,
                    Some(NM),
                    "DeactivateConnection",
                    &(active,),
                )
                .await
                .map_err(|e| format!("deactivate: {e}"))?;
            }
        }
        Ok(())
    }
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
    fn access_point_security_from_flags() {
        assert_eq!(ap_security(0, 0, 0), WifiSecurity::Open);
        assert_eq!(ap_security(1, 0, KEY_MGMT_PSK), WifiSecurity::Wpa);
        assert_eq!(
            ap_security(1, 0, KEY_MGMT_PSK | KEY_MGMT_SAE),
            WifiSecurity::Wpa
        );
        assert_eq!(ap_security(1, 0, KEY_MGMT_SAE), WifiSecurity::Wpa3);
        assert_eq!(ap_security(1, KEY_MGMT_802_1X, 0), WifiSecurity::Enterprise);
    }

    #[test]
    fn one_entry_per_network_strongest_first() {
        let n = |ssid: &str, signal| WifiNetwork {
            ssid: ssid.into(),
            signal,
            security: WifiSecurity::Wpa,
            known: false,
            active: false,
        };
        let out = dedup_networks(vec![n("A", 30), n("B", 60), n("A", 80), n("", 99)]);
        let names: Vec<_> = out.iter().map(|x| (x.ssid.as_str(), x.signal)).collect();
        assert_eq!(names, vec![("A", 80), ("B", 60)]);
    }

    #[test]
    fn a_uuid_is_version_4() {
        let u = new_uuid();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
        assert!(matches!(&u[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn the_hotspot_shares_its_address() {
        let h = Hotspot {
            enabled: true,
            ssid: "sws-06e990".into(),
            password: "segreta123".into(),
        };
        let s = hotspot_settings(&h, "wlan0", new_uuid()).unwrap();
        let get = |sec: &str, k: &str| s.get(sec).and_then(|x| prop::<String>(x, k));
        assert_eq!(get("802-11-wireless", "mode").as_deref(), Some("ap"));
        assert_eq!(get("ipv4", "method").as_deref(), Some("shared"));
        assert_eq!(
            get("802-11-wireless-security", "key-mgmt").as_deref(),
            Some("wpa-psk")
        );
    }

    #[test]
    fn device_states_reduce_to_four() {
        assert_eq!(card_state(100), CardState::Connected);
        assert_eq!(card_state(70), CardState::Connecting);
        assert_eq!(card_state(30), CardState::Disconnected);
        assert_eq!(card_state(20), CardState::Unavailable);
    }
}
