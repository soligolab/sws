//! What an LVGL pixel looks like at this build's colour depth (13-11-2026, plan
//! `docs/archive/2026-11-13-lvgl-32-bit.md`).
//!
//! Until then about twenty places wrote RGB565 by hand — `3 * w * h` alpha
//! canvases, `2 * w * h` trend canvases, `>> 11 & 0x1f` — and moving LVGL to
//! 32 bit would have left most of them compiling and wrong: buffers too small
//! that LVGL reads past the end. Every pixel written for LVGL goes through here,
//! so the depth lives in one place: `LV_COLOR_DEPTH` in `lv_conf.h`.
//!
//! At 16 bit: RGB565 little-endian (`PX` = 2), plus one alpha byte (`PX_ALPHA` =
//! 3). At 32 bit: B, G, R, A in memory (`lv_color32_t`, the same layout as DRM's
//! XRGB8888), with or without the alpha that matters.

/// Bits per colour, from `lv_conf.h`.
pub const DEPTH: u32 = lvgl_sys::LV_COLOR_DEPTH;

/// Bytes of one pixel in `LV_IMG_CF_TRUE_COLOR` (and of an `lv_color_t`).
pub const PX: usize = (lvgl_sys::LV_COLOR_SIZE / 8) as usize;

/// Bytes of one pixel in `LV_IMG_CF_TRUE_COLOR_ALPHA`.
pub const PX_ALPHA: usize = lvgl_sys::LV_IMG_PX_SIZE_ALPHA_BYTE as usize;

/// Writes one `TRUE_COLOR` pixel in the first [`PX`] bytes of `dst`.
#[inline]
pub fn put_rgb(dst: &mut [u8], r: u8, g: u8, b: u8) {
    if DEPTH == 32 {
        dst[..4].copy_from_slice(&[b, g, r, 0xff]);
    } else {
        let v = rgb565(r, g, b);
        dst[..2].copy_from_slice(&v.to_le_bytes());
    }
}

/// Writes one `TRUE_COLOR_ALPHA` pixel in the first [`PX_ALPHA`] bytes of `dst`.
/// The colour is not premultiplied: LVGL keeps the alpha apart.
#[inline]
pub fn put_rgba(dst: &mut [u8], r: u8, g: u8, b: u8, a: u8) {
    if DEPTH == 32 {
        dst[..4].copy_from_slice(&[b, g, r, a]);
    } else {
        let v = rgb565(r, g, b).to_le_bytes();
        dst[..3].copy_from_slice(&[v[0], v[1], a]);
    }
}

/// The 8-bit channels of an LVGL colour, as the screen will show them (at 16
/// bit the low bits are lost and widened back).
#[inline]
pub fn rgb_of(c: lvgl_sys::lv_color_t) -> (u8, u8, u8) {
    // `full` is u16 at 16 bit and u32 at 32: widen it to read both the same way.
    #[allow(clippy::unnecessary_cast)]
    let full = unsafe { c.full } as u32;
    if DEPTH == 32 {
        (
            ((full >> 16) & 0xff) as u8,
            ((full >> 8) & 0xff) as u8,
            (full & 0xff) as u8,
        )
    } else {
        widen565(full as u16)
    }
}

/// The colour a page background `(r, g, b)` has on screen: at 16 bit it loses
/// its low bits, at 32 bit it is itself. Whatever is painted around the page
/// (the DRM frame, Q37) must go the same way, or the two show a seam.
pub fn as_rendered(r: u8, g: u8, b: u8) -> (u8, u8, u8) {
    if DEPTH == 32 {
        (r, g, b)
    } else {
        widen565(rgb565(r, g, b))
    }
}

/// Reads back one `TRUE_COLOR_ALPHA` pixel (tests), with the channels as the
/// screen shows them.
#[cfg(test)]
pub fn read_rgba(src: &[u8]) -> (u8, u8, u8, u8) {
    if DEPTH == 32 {
        (src[2], src[1], src[0], src[3])
    } else {
        let (r, g, b) = widen565(u16::from_le_bytes([src[0], src[1]]));
        (r, g, b, src[2])
    }
}

/// The bytes of a `TRUE_COLOR_ALPHA` buffer of `w × h` pixels.
pub fn alpha_buffer_len(w: usize, h: usize) -> usize {
    w * h * PX_ALPHA
}

/// The bytes of a `TRUE_COLOR` buffer of `w × h` pixels.
pub fn buffer_len(w: usize, h: usize) -> usize {
    w * h * PX
}

fn rgb565(r: u8, g: u8, b: u8) -> u16 {
    ((r as u16 & 0xF8) << 8) | ((g as u16 & 0xFC) << 3) | (b as u16 >> 3)
}

fn widen565(v: u16) -> (u8, u8, u8) {
    let (r5, g6, b5) = ((v >> 11) & 0x1F, (v >> 5) & 0x3F, v & 0x1F);
    (
        ((r5 as u32 * 255) / 31) as u8,
        ((g6 as u32 * 255) / 63) as u8,
        ((b5 as u32 * 255) / 31) as u8,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pixel_round_trip_through_lvgl_colour() {
        let mut px = vec![0u8; PX];
        put_rgb(&mut px, 0xff, 0x80, 0x00);
        let mut c: lvgl_sys::lv_color_t = lvgl::Color::from_rgb((0, 0, 0)).into();
        // Same bytes, read back as an LVGL colour.
        unsafe {
            std::ptr::copy_nonoverlapping(px.as_ptr(), &mut c as *mut _ as *mut u8, PX);
        }
        assert_eq!(rgb_of(c), as_rendered(0xff, 0x80, 0x00));
        let lv: lvgl_sys::lv_color_t = lvgl::Color::from_rgb((0x12, 0x34, 0x56)).into();
        assert_eq!(rgb_of(lv), as_rendered(0x12, 0x34, 0x56));
    }

    #[test]
    fn sizes_follow_the_depth() {
        assert_eq!(buffer_len(10, 10), 100 * PX);
        assert_eq!(alpha_buffer_len(10, 10), 100 * PX_ALPHA);
        let mut px = vec![0u8; PX_ALPHA];
        put_rgba(&mut px, 0xff, 0, 0, 0x80);
        assert_eq!(px[PX_ALPHA - 1], 0x80, "alpha last");
        if DEPTH == 16 {
            assert_eq!(&px[..2], &[0x00, 0xF8]);
            assert_eq!(as_rendered(0x0f, 0x17, 0x2a), (8, 20, 41));
        } else {
            assert_eq!(&px[..3], &[0x00, 0x00, 0xff]);
            assert_eq!(as_rendered(0x0f, 0x17, 0x2a), (0x0f, 0x17, 0x2a));
        }
    }
}
