//! How the picture sits on the glass (plan
//! `docs/archive/2026-11-15-rotazione-dello-schermo.md`). Two things add up: the
//! project's orientation (a portrait project is drawn for a panel turned 90°
//! clockwise) and the device's own setting (mounted upside down, 180°).
//!
//! LVGL, the pages and the control panel never know: they work in the space
//! of the page as the person in front of it sees it. The glass enters in two
//! places only, the copy to the framebuffer and the touch.

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Rotation {
    #[default]
    R0,
    /// The panel turned 90° clockwise: its left side is now the top.
    R90,
    R180,
    R270,
}

impl Rotation {
    pub fn of(portrait: bool, flipped: bool) -> Self {
        match (portrait, flipped) {
            (false, false) => Rotation::R0,
            (true, false) => Rotation::R90,
            (false, true) => Rotation::R180,
            (true, true) => Rotation::R270,
        }
    }

    /// Whether width and height trade places.
    pub fn swaps(self) -> bool {
        matches!(self, Rotation::R90 | Rotation::R270)
    }

    /// The size of the screen as the person sees it, from the glass's.
    pub fn seen(self, glass_w: u32, glass_h: u32) -> (u32, u32) {
        if self.swaps() {
            (glass_h, glass_w)
        } else {
            (glass_w, glass_h)
        }
    }

    /// A point as seen → the pixel of the glass. The point must be inside
    /// [`Self::seen`].
    pub fn to_glass(self, x: u32, y: u32, glass_w: u32, glass_h: u32) -> (u32, u32) {
        match self {
            Rotation::R0 => (x, y),
            Rotation::R90 => (y, glass_h - 1 - x),
            Rotation::R180 => (glass_w - 1 - x, glass_h - 1 - y),
            Rotation::R270 => (glass_w - 1 - y, x),
        }
    }

    /// A pixel of the glass → the point as seen: the inverse of
    /// [`Self::to_glass`].
    pub fn to_seen(self, x: i32, y: i32, glass_w: i32, glass_h: i32) -> (i32, i32) {
        match self {
            Rotation::R0 => (x, y),
            Rotation::R90 => (glass_h - 1 - y, x),
            Rotation::R180 => (glass_w - 1 - x, glass_h - 1 - y),
            Rotation::R270 => (y, glass_w - 1 - x),
        }
    }
}

/// Whether this viewer turns the picture itself: only on the framebuffer
/// (DRM). In a window the compositor owns the glass, and a portrait page is
/// simply a portrait window.
static ACTIVE: AtomicBool = AtomicBool::new(false);
static PORTRAIT: AtomicBool = AtomicBool::new(false);
static FLIPPED: AtomicBool = AtomicBool::new(false);

pub fn activate() {
    ACTIVE.store(true, Ordering::Relaxed);
}

/// From the project (`page_layout.orientation`).
pub fn set_portrait(on: bool) {
    PORTRAIT.store(on, Ordering::Relaxed);
}

/// From the device (control panel → Screen).
pub fn set_flipped(on: bool) {
    FLIPPED.store(on, Ordering::Relaxed);
}

pub fn current() -> Rotation {
    if !ACTIVE.load(Ordering::Relaxed) {
        return Rotation::R0;
    }
    Rotation::of(
        PORTRAIT.load(Ordering::Relaxed),
        FLIPPED.load(Ordering::Relaxed),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [Rotation; 4] = [Rotation::R0, Rotation::R90, Rotation::R180, Rotation::R270];

    #[test]
    fn a_portrait_project_puts_the_top_left_on_the_glass_bottom_left() {
        // 1024×600 glass, turned clockwise: seen as 600×1024.
        assert_eq!(Rotation::R90.seen(1024, 600), (600, 1024));
        // What the person sees top left is the glass's bottom left…
        assert_eq!(Rotation::R90.to_glass(0, 0, 1024, 600), (0, 599));
        // …top right is the glass's top left…
        assert_eq!(Rotation::R90.to_glass(599, 0, 1024, 600), (0, 0));
        // …and bottom right is the glass's top right.
        assert_eq!(Rotation::R90.to_glass(599, 1023, 1024, 600), (1023, 0));
        // Upside down, without a portrait project.
        assert_eq!(Rotation::R180.to_glass(0, 0, 1024, 600), (1023, 599));
        // Portrait and upside down: the other way round.
        assert_eq!(Rotation::R270.to_glass(0, 0, 1024, 600), (1023, 0));
    }

    #[test]
    fn the_touch_comes_back_where_the_picture_went() {
        for r in ALL {
            let (w, h) = r.seen(1024, 600);
            for (x, y) in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (17, 301)] {
                let (gx, gy) = r.to_glass(x, y, 1024, 600);
                assert!(gx < 1024 && gy < 600, "{r:?} {x},{y}");
                assert_eq!(
                    r.to_seen(gx as i32, gy as i32, 1024, 600),
                    (x as i32, y as i32),
                    "{r:?}"
                );
            }
        }
    }

    #[test]
    fn project_and_device_add_up() {
        assert_eq!(Rotation::of(false, false), Rotation::R0);
        assert_eq!(Rotation::of(true, false), Rotation::R90);
        assert_eq!(Rotation::of(false, true), Rotation::R180);
        assert_eq!(Rotation::of(true, true), Rotation::R270);
    }
}
