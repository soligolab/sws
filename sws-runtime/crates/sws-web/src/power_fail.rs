//! The power-fail input of a device with a UPS (plan
//! `docs/archive/2026-11-14-funzioni-di-tyx-panelcontrol.md`, step 5).
//!
//! On a Tiny TY the UPS holds the board up for a few seconds and tells it
//! through a GPIO: 1 while mains is there, 0 once it is gone. Pixsys'
//! `tyx_panelcontrol` used to watch it; with SWS installed that program is
//! removed, and the watch is here. When the input falls the screen light goes
//! off (it is what drains the UPS) and the device reboots through logind: the
//! runtime then stops on SIGTERM like on any reboot, history closed.
//!
//! **Which** input is said by the installation (`--power-fail-input`, passed
//! by the Tiny TY launcher when the board has a UPS), never guessed. TC and WP
//! panels do not need this: there the system itself starts the shutdown.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// How often the input is read. A sysfs read; the UPS gives seconds.
const EVERY: Duration = Duration::from_millis(100);

/// Consecutive readings of «no mains» before acting: a glitch is not a
/// blackout.
const READINGS: u8 = 3;

/// What the readings of the input say, one after the other.
#[derive(Default)]
pub struct Watch {
    armed: bool,
    low: u8,
}

impl Watch {
    /// One reading: `Some(true)` mains present, `Some(false)` mains gone,
    /// `None` unreadable. True when power is lost, once.
    ///
    /// The watch arms only after it has seen mains present: an input stuck
    /// low (no UPS, another polarity, mains still away after the reboot) must
    /// not reboot the device in a loop.
    pub fn reading(&mut self, mains: Option<bool>) -> bool {
        match mains {
            Some(true) => {
                self.armed = true;
                self.low = 0;
            }
            Some(false) if self.armed => {
                self.low += 1;
                if self.low >= READINGS {
                    self.armed = false;
                    return true;
                }
            }
            _ => {}
        }
        false
    }
}

fn read(input: &Path) -> Option<bool> {
    match std::fs::read_to_string(input).ok()?.trim() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

/// The screen light off, wherever this user may write it: best effort.
fn light_off() {
    let Ok(lights) = std::fs::read_dir("/sys/class/backlight") else {
        return;
    };
    for light in lights.flatten() {
        let _ = std::fs::write(light.path().join("brightness"), "0");
    }
}

/// Watches `input` on a thread of its own and calls `lost` when mains goes,
/// after turning the screen light off. `lost` may be called again if mains
/// comes back and goes again before the device is down.
pub fn watch(input: PathBuf, lost: impl Fn() + Send + 'static) {
    let spawned = std::thread::Builder::new()
        .name("power-fail".into())
        .spawn(move || {
            let mut watch = Watch::default();
            loop {
                if watch.reading(read(&input)) {
                    light_off();
                    lost();
                }
                std::thread::sleep(EVERY);
            }
        });
    if let Err(e) = spawned {
        tracing::error!("power-fail watch not started: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn power_is_lost_after_three_low_readings_in_a_row() {
        let mut w = Watch::default();
        assert!(!w.reading(Some(true)));
        assert!(!w.reading(Some(false)));
        assert!(!w.reading(Some(false)));
        assert!(w.reading(Some(false)));
        // Once: the device is already going down.
        assert!(!w.reading(Some(false)));
    }

    #[test]
    fn a_glitch_or_an_unreadable_input_is_not_a_blackout() {
        let mut w = Watch::default();
        w.reading(Some(true));
        assert!(!w.reading(Some(false)));
        assert!(!w.reading(Some(false)));
        assert!(!w.reading(Some(true)));
        assert!(!w.reading(Some(false)));
        assert!(!w.reading(None));
        assert!(!w.reading(Some(false)));
        assert!(w.reading(Some(false)));
    }

    #[test]
    fn an_input_that_starts_low_never_reboots_the_device() {
        let mut w = Watch::default();
        for _ in 0..20 {
            assert!(!w.reading(Some(false)));
        }
        // Mains seen: from here on it is watched.
        w.reading(Some(true));
        assert!(!w.reading(Some(false)));
        assert!(!w.reading(Some(false)));
        assert!(w.reading(Some(false)));
    }

    #[test]
    fn the_input_is_a_sysfs_value() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("value");
        std::fs::write(&f, "1\n").unwrap();
        assert_eq!(read(&f), Some(true));
        std::fs::write(&f, "0\n").unwrap();
        assert_eq!(read(&f), Some(false));
        std::fs::write(&f, "?").unwrap();
        assert_eq!(read(&f), None);
        assert_eq!(read(&d.path().join("missing")), None);
    }
}
