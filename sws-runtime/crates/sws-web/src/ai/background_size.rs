//! The size of a generated page background (plan
//! `docs/plans/2026-11-20-sfondi-alla-misura-della-pagina.md`).
//!
//! Until 20-11-2026 every background was 1536×1024: on a portrait page
//! (TY570, 600×1024) the `cover` crop left about 40 % of it. Now the size comes
//! from the area of the page the background covers, in two steps:
//!
//! 1. the **final** size: the area, or one and a half times it ([`Scale`]),
//!    for the page's orientation and, when asked, for the other one;
//! 2. the size **asked to the provider**: the same proportions within what it
//!    accepts (multiples of 16, its pixel limits), at least about a megapixel.
//!
//! The image that comes back is cut and scaled to the final size with
//! [`crate::sized_image::make`] (`cover`, like the panel), never enlarged.

use serde::Serialize;

use crate::ai::scopi::ImageProvider;

/// One and a half times the area: the maintainer's «more than the page».
const LARGER: f64 = 1.5;

/// Below this the providers draw worse, and FLUX bills a megapixel anyway. Just
/// under FLUX's megapixel (1024²), so rounding up to 16 stays within it.
const MIN_PIXELS: f64 = 1_000_000.0;

/// The proportions the providers accept (gpt-image-2: from 1:3 to 3:1), less a
/// margin for the rounding to 16, which could otherwise step past 3:1.
const MAX_RATIO: f64 = 2.9;

/// How large the background is, chosen by the person in the interview.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scale {
    /// The area of the page, pixel for pixel: the lightest.
    Exact,
    /// One and a half times the area, same proportions: sharper.
    Larger,
}

impl Scale {
    /// From the tool's `size`: `"exact"` or `"larger"`.
    pub fn parse(s: &str) -> Option<Scale> {
        match s {
            "exact" => Some(Scale::Exact),
            "larger" => Some(Scale::Larger),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Facing {
    Landscape,
    Portrait,
}

impl Facing {
    pub fn of(w: u32, h: u32) -> Facing {
        if w >= h {
            Facing::Landscape
        } else {
            Facing::Portrait
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Facing::Landscape => "landscape",
            Facing::Portrait => "portrait",
        }
    }
}

/// The area a background covers (`cornici::area_libera`, or the whole page)
/// and the height of the frame's bands above and below it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageBox {
    pub w: f64,
    pub h: f64,
    pub bands: f64,
}

impl PageBox {
    /// The area in the page's own orientation.
    pub fn area(&self) -> (u32, u32) {
        (side(self.w), side(self.h))
    }

    /// The area once the project is turned: the page trades width and height,
    /// the bands keep their height (`formatoProgetto.ts`, `cambioOrientamento`).
    pub fn turned(&self) -> (u32, u32) {
        (side(self.h + self.bands), side(self.w - self.bands))
    }
}

fn side(v: f64) -> u32 {
    v.round().clamp(16.0, crate::sized_image::MAX_SIDE as f64) as u32
}

/// The size of the file that goes in the project.
pub fn final_size((w, h): (u32, u32), scale: Scale) -> (u32, u32) {
    let k = match scale {
        Scale::Exact => 1.0,
        Scale::Larger => LARGER,
    };
    let max = crate::sized_image::MAX_SIDE as f64;
    let (fw, fh) = (w as f64 * k, h as f64 * k);
    let shrink = (max / fw.max(fh)).min(1.0);
    (
        (fw * shrink).round().max(1.0) as u32,
        (fh * shrink).round().max(1.0) as u32,
    )
}

/// What a provider and model accept.
struct Limits {
    max_pixels: f64,
    max_side: f64,
}

/// The OpenAI models that only know three sizes (before gpt-image-2).
fn fixed_sizes_only(model: &str) -> bool {
    let m = model.trim();
    m.starts_with("gpt-image-1") || m.starts_with("dall-e")
}

/// The fixed size of OpenAI closest to the proportions of `w × h`: the image
/// is then cut to them.
pub fn nearest_fixed(w: u32, h: u32) -> (u32, u32) {
    let r = w as f64 / h as f64;
    if r > 1.2 {
        (1536, 1024)
    } else if r < 1.0 / 1.2 {
        (1024, 1536)
    } else {
        (1024, 1024)
    }
}

/// The size to ask the provider for an image whose final size is `w × h`:
/// the same proportions (within 1:3 and 3:1), sides multiple of 16, at least
/// about a megapixel, within the provider's limits. Rounded up when the
/// limits allow, so the image is not smaller than the final size.
pub fn request_size(provider: ImageProvider, model: &str, w: u32, h: u32) -> (u32, u32) {
    let limits = match provider {
        // FLUX.2: up to 4 MP; some of its endpoints stop at 2048 per side.
        ImageProvider::Bfl => Limits {
            max_pixels: 4.0 * 1024.0 * 1024.0,
            max_side: 2048.0,
        },
        // gpt-image-2: above 2560×1440 is experimental.
        ImageProvider::OpenAi if fixed_sizes_only(model) => return nearest_fixed(w, h),
        ImageProvider::OpenAi => Limits {
            max_pixels: 2560.0 * 1440.0,
            max_side: 2560.0,
        },
    };
    let ratio = (w as f64 / h as f64).clamp(1.0 / MAX_RATIO, MAX_RATIO);
    let pixels = (w as f64 * h as f64).clamp(MIN_PIXELS, limits.max_pixels);
    let mut rh = (pixels / ratio).sqrt();
    let mut rw = rh * ratio;
    let over = rw.max(rh) / limits.max_side;
    if over > 1.0 {
        rw /= over;
        rh /= over;
    }
    let up = |v: f64| ((v / 16.0).ceil() * 16.0).max(16.0);
    let down = |v: f64| ((v / 16.0).floor() * 16.0).max(16.0);
    let (uw, uh) = (up(rw), up(rh));
    if uw * uh <= limits.max_pixels && uw.max(uh) <= limits.max_side {
        (uw as u32, uh as u32)
    } else {
        (down(rw) as u32, down(rh) as u32)
    }
}

/// The image from the provider cut and scaled to `w × h` (`cover`). An image
/// smaller than that is not enlarged: the size goes down instead, with the
/// same proportions. Returns the JPEG and its size. Blocking: decoding and
/// scaling a few megapixels takes some tens of milliseconds.
pub fn fit(jpg: &[u8], w: u32, h: u32) -> Result<(Vec<u8>, u32, u32), String> {
    let (iw, ih) = image::ImageReader::new(std::io::Cursor::new(jpg))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_dimensions()
        .map_err(|e| format!("the image does not read: {e}"))?;
    let grow = (w as f64 / iw as f64).max(h as f64 / ih as f64);
    let (fw, fh) = if grow > 1.0 {
        (
            ((w as f64 / grow).round() as u32).max(1),
            ((h as f64 / grow).round() as u32).max(1),
        )
    } else {
        (w, h)
    };
    let out = crate::sized_image::make(jpg, fw, fh)?;
    Ok((out, fw, fh))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The TY570 in portrait with the fair's frame: bands of 30 and 64.
    const TY: PageBox = PageBox {
        w: 600.0,
        h: 930.0,
        bands: 94.0,
    };

    #[test]
    fn the_area_and_the_turned_area() {
        assert_eq!(TY.area(), (600, 930));
        assert_eq!(TY.turned(), (1024, 506));
        let plain = PageBox {
            w: 1280.0,
            h: 800.0,
            bands: 0.0,
        };
        assert_eq!(plain.turned(), (800, 1280));
        assert_eq!(Facing::of(600, 930), Facing::Portrait);
        assert_eq!(Facing::of(1024, 506), Facing::Landscape);
    }

    #[test]
    fn larger_is_one_and_a_half_times_within_the_largest_side() {
        assert_eq!(final_size((600, 930), Scale::Exact), (600, 930));
        assert_eq!(final_size((600, 930), Scale::Larger), (900, 1395));
        assert_eq!(final_size((3000, 1000), Scale::Larger), (4096, 1365));
        assert_eq!(Scale::parse("larger"), Some(Scale::Larger));
        assert_eq!(Scale::parse("big"), None);
    }

    #[test]
    fn the_request_keeps_the_proportions_in_multiples_of_16() {
        for provider in [ImageProvider::Bfl, ImageProvider::OpenAi] {
            for (w, h) in [
                (600, 930),
                (900, 1395),
                (1024, 506),
                (1920, 1080),
                (4096, 1536),
            ] {
                let (rw, rh) = request_size(provider, "gpt-image-2", w, h);
                assert_eq!((rw % 16, rh % 16), (0, 0), "{w}×{h} → {rw}×{rh}");
                let (r, want) = (rw as f64 / rh as f64, w as f64 / h as f64);
                assert!((r / want - 1.0).abs() < 0.03, "{w}×{h} → {rw}×{rh}");
                assert!(
                    rw as f64 * rh as f64 >= 0.95 * MIN_PIXELS,
                    "{w}×{h} → {rw}×{rh}"
                );
            }
        }
        // Small areas are asked at about a megapixel, larger ones as they are.
        assert_eq!(
            request_size(ImageProvider::Bfl, "flux-2-pro", 600, 930),
            (816, 1248)
        );
        assert_eq!(
            request_size(ImageProvider::Bfl, "flux-2-pro", 900, 1395),
            (912, 1408)
        );
    }

    #[test]
    fn the_request_stays_within_the_limits_of_the_provider() {
        let (w, h) = request_size(ImageProvider::Bfl, "flux-2-pro", 4096, 2304);
        assert!(w <= 2048 && w * h <= 4 * 1024 * 1024, "{w}×{h}");
        let (w, h) = request_size(ImageProvider::OpenAi, "gpt-image-2", 3840, 2160);
        assert!(w <= 2560 && w * h <= 2560 * 1440, "{w}×{h}");
        // Beyond 3:1 the provider gets just under 3:1, and `cover` cuts the rest.
        for (a, b) in [(2000, 200), (200, 2000), (3000, 1000)] {
            let (w, h) = request_size(ImageProvider::OpenAi, "gpt-image-2", a, b);
            let r = (w as f64 / h as f64).max(h as f64 / w as f64);
            assert!((2.8..=3.0).contains(&r), "{a}×{b} → {w}×{h}");
        }
        // The older OpenAI models know three sizes.
        assert_eq!(
            request_size(ImageProvider::OpenAi, "gpt-image-1", 600, 930),
            (1024, 1536)
        );
        assert_eq!(
            request_size(ImageProvider::OpenAi, "gpt-image-1-mini", 1280, 800),
            (1536, 1024)
        );
        assert_eq!(
            request_size(ImageProvider::OpenAi, "dall-e-3", 800, 800),
            (1024, 1024)
        );
    }

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([90, 120, 150]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
            .encode_image(&img)
            .unwrap();
        out
    }

    fn size_of(jpg: &[u8]) -> (u32, u32) {
        let i = image::load_from_memory(jpg).unwrap();
        (i.width(), i.height())
    }

    #[test]
    fn the_image_is_cut_to_the_final_size_and_never_enlarged() {
        let (out, w, h) = fit(&jpeg(816, 1248), 600, 930).unwrap();
        assert_eq!((w, h), (600, 930));
        assert_eq!(size_of(&out), (600, 930));
        // A fixed 1024×1536 of OpenAI for a 900×1395 area: cut, not stretched.
        let (out, w, h) = fit(&jpeg(1024, 1536), 900, 1395).unwrap();
        assert_eq!((w, h), (900, 1395));
        assert_eq!(size_of(&out), (900, 1395));
        // Smaller than asked: same proportions, at the size there is.
        let (_, w, h) = fit(&jpeg(400, 620), 600, 930).unwrap();
        assert_eq!((w, h), (400, 620));
        assert!(fit(&[0xFF, 0xD8, 0xFF, 0xD9], 600, 930).is_err());
    }
}
