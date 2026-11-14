//! The service PIN that opens the control panel.
//!
//! Two sources, decided by the maintainer on 13-11-2026:
//!
//! - the **project's PIN**, stored as an argon2 hash in `project.yaml`
//!   (`control_panel.pin_hash`), so it travels with the deploy;
//! - otherwise the **device's initial PIN**: the low six hex digits of the MAC
//!   of the first wired card. It is the same suffix as the network name
//!   (`ty570-1ad-p1-06e990` → `06e990`), so it is printed on the MAC label.
//!
//! The initial PIN is not a secret: whoever sees the mDNS name or the ARP table
//! knows it. It keeps a curious finger out of the settings, nothing more; the
//! real protection is the project's PIN, and the IDE says so until there is one.

use std::path::Path;

/// Where the cards are listed. A parameter so the tests can build a fake tree.
pub const SYS_CLASS_NET: &str = "/sys/class/net";

/// The card whose MAC gives the initial PIN: `eth0` (Tiny TY, PC), then
/// `ethernet0` (PixsysOS names its cards so), then the first physical card in
/// name order. A physical card has a `device` link; bridges, bonds, veth and
/// `lo` do not.
pub fn pin_card(sys_class_net: &Path) -> Option<String> {
    for name in ["eth0", "ethernet0"] {
        if sys_class_net.join(name).join("address").exists() {
            return Some(name.to_string());
        }
    }
    let mut physical: Vec<String> = std::fs::read_dir(sys_class_net)
        .ok()?
        .flatten()
        .filter(|e| e.path().join("device").exists())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    physical.sort();
    physical.into_iter().next()
}

/// The initial PIN: the last three bytes of the card's MAC, lowercase hex.
pub fn initial_pin(sys_class_net: &Path) -> Option<String> {
    let card = pin_card(sys_class_net)?;
    let mac = std::fs::read_to_string(sys_class_net.join(card).join("address")).ok()?;
    pin_from_mac(mac.trim())
}

/// `7c:6c:39:06:e9:90` → `06e990`. `None` for anything that is not a MAC, and
/// for the all-zero MAC some virtual cards report.
pub fn pin_from_mac(mac: &str) -> Option<String> {
    let hex: String = mac.split(':').collect::<Vec<_>>().concat().to_lowercase();
    if hex.len() != 12 || !hex.chars().all(|c| c.is_ascii_hexdigit()) || hex == "000000000000" {
        return None;
    }
    Some(hex[6..].to_string())
}

/// Where the PIN that counts comes from, for the screen and the IDE.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PinSource {
    Project,
    Device,
    /// No project PIN and no card to read a MAC from: nobody can enter.
    None,
}

pub fn pin_source(project_hash: Option<&str>, initial: Option<&str>) -> PinSource {
    match (project_hash, initial) {
        (Some(_), _) => PinSource::Project,
        (None, Some(_)) => PinSource::Device,
        (None, None) => PinSource::None,
    }
}

/// Whether `typed` opens the panel. The project's PIN wins over the device's:
/// once a project sets one, the MAC no longer opens anything.
pub fn pin_matches(typed: &str, project_hash: Option<&str>, initial: Option<&str>) -> bool {
    let typed = typed.trim();
    if typed.is_empty() {
        return false;
    }
    match (project_hash, initial) {
        (Some(hash), _) => sws_auth::verify_password(typed, hash),
        (None, Some(pin)) => typed.eq_ignore_ascii_case(pin),
        (None, None) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(root: &Path, name: &str, mac: &str, physical: bool) {
        let d = root.join(name);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("address"), format!("{mac}\n")).unwrap();
        if physical {
            std::fs::create_dir_all(d.join("device")).unwrap();
        }
    }

    #[test]
    fn the_pin_is_the_low_half_of_the_mac() {
        assert_eq!(pin_from_mac("7c:6c:39:06:e9:90").as_deref(), Some("06e990"));
        assert_eq!(pin_from_mac("7C:6C:39:07:AF:F9").as_deref(), Some("07aff9"));
        assert_eq!(pin_from_mac("00:00:00:00:00:00"), None);
        assert_eq!(pin_from_mac("not a mac"), None);
    }

    #[test]
    fn eth0_then_ethernet0_then_the_first_physical_card() {
        let t = tempfile::tempdir().unwrap();
        card(t.path(), "lo", "00:00:00:00:00:00", false);
        card(t.path(), "enp3s0", "aa:bb:cc:11:22:33", true);
        card(t.path(), "docker0", "aa:bb:cc:99:99:99", false);
        assert_eq!(initial_pin(t.path()).as_deref(), Some("112233"));
        card(t.path(), "ethernet0", "7c:6c:39:07:af:f9", true);
        assert_eq!(initial_pin(t.path()).as_deref(), Some("07aff9"));
        card(t.path(), "eth0", "7c:6c:39:06:e9:90", true);
        assert_eq!(initial_pin(t.path()).as_deref(), Some("06e990"));
    }

    #[test]
    fn the_project_pin_replaces_the_device_pin() {
        let hash = sws_auth::hash_password("4711").unwrap();
        assert!(pin_matches("06E990", None, Some("06e990")));
        assert!(pin_matches("4711", Some(&hash), Some("06e990")));
        assert!(!pin_matches("06e990", Some(&hash), Some("06e990")));
        assert!(!pin_matches("", None, Some("06e990")));
        assert!(!pin_matches("06e990", None, None));
        assert_eq!(pin_source(Some(&hash), Some("06e990")), PinSource::Project);
        assert_eq!(pin_source(None, Some("06e990")), PinSource::Device);
        assert_eq!(pin_source(None, None), PinSource::None);
    }
}
