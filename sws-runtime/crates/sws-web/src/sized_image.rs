//! Project images at the size a panel draws them (plan
//! `docs/archive/2026-11-14-sfondi-alla-misura.md`).
//!
//! `GET /api/project/images/<name>?w=W&h=H` answers with a JPEG of exactly
//! W × H, scaled and cropped like `cover` (the `xMidYMid slice` of the web and
//! of LVGL). On the TY570 the first visit of a page with a 1536×1024 background
//! cost 1,8 s, all of it decoding, scaling and cropping on the panel's single
//! core: here it is done once, and kept.
//!
//! `&fit=contain` (21-11-2026, plan `2026-11-21-simboli-fase-3-foto`): the
//! image scaled to fit inside W × H, proportions kept, for a photo inside a
//! symbol. A PNG stays a PNG, so a cut-out keeps its transparency.
//!
//! The variants live outside the project (`<config>/cache/sized-images`), so
//! backups, exports and deploys never carry them. Their name hashes the
//! original's path, length and modification time with the size asked: a
//! replaced image gets a new variant, and the old one is simply never read
//! again.

use std::path::{Path, PathBuf};

/// The largest side a variant may have: the same ceiling the LVGL viewer puts
/// on a page background (`svg_raster::MAX_SIDE_SFONDO`).
pub const MAX_SIDE: u32 = 4096;

/// JPEG quality of a variant: a photograph behind the objects of a page.
const QUALITY: u8 = 85;

/// Only raster formats this module can decode; an SVG is drawn at any size.
pub fn resizable(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "jpg" | "jpeg" | "png")
}

/// How a variant fills its size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Fit {
    /// Exactly W × H, cropped: a page background.
    #[default]
    Cover,
    /// Inside W × H, proportions kept, never cropped: a photo in a symbol.
    Contain,
}

impl Fit {
    pub fn parse(s: Option<&str>) -> Fit {
        match s {
            Some("contain") => Fit::Contain,
            _ => Fit::Cover,
        }
    }
}

fn is_png(name: &Path) -> bool {
    name.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("png"))
}

/// The media type of a variant of `original`.
pub fn content_type(original: &Path, fit: Fit) -> &'static str {
    if fit == Fit::Contain && is_png(original) {
        "image/png"
    } else {
        "image/jpeg"
    }
}

pub fn cache_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("cache").join("sized-images")
}

/// Where the variant of `original` at `w × h` lives, given the original's
/// metadata. `None` if the original cannot be read.
pub fn variant_path(cache: &Path, original: &Path, w: u32, h: u32, fit: Fit) -> Option<PathBuf> {
    use sha2::{Digest, Sha256};
    let meta = std::fs::metadata(original).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let mut hash = Sha256::new();
    hash.update(original.to_string_lossy().as_bytes());
    hash.update(meta.len().to_le_bytes());
    hash.update(modified.to_le_bytes());
    let hex: String = hash
        .finalize()
        .iter()
        .take(12)
        .map(|b| format!("{b:02x}"))
        .collect();
    Some(cache.join(match fit {
        Fit::Cover => format!("{hex}-{w}x{h}.jpg"),
        Fit::Contain if is_png(original) => format!("{hex}-{w}x{h}-contain.png"),
        Fit::Contain => format!("{hex}-{w}x{h}-contain.jpg"),
    }))
}

/// Decodes `bytes`, scales to `w × h` as `fit` says, encodes a JPEG — or a
/// PNG with its transparency, when `png` and `fit` is `Contain`.
pub fn make(bytes: &[u8], w: u32, h: u32, fit: Fit, png: bool) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let filter = image::imageops::FilterType::Triangle;
    if fit == Fit::Contain {
        // Never larger than the original: a small cut-out stays sharp.
        let scaled = if img.width() > w || img.height() > h {
            img.resize(w, h, filter)
        } else {
            img
        };
        let mut buf = Vec::new();
        if png {
            scaled
                .into_rgba8()
                .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        } else {
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, QUALITY)
                .encode_image(&scaled.into_rgb8())
                .map_err(|e| e.to_string())?;
        }
        return Ok(buf);
    }
    let out = img.resize_to_fill(w, h, filter).into_rgb8();
    let mut buf = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, QUALITY)
        .encode_image(&out)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// The variant of `original` at `w × h`: read from the cache, or made and
/// written there. Blocking: call it from `spawn_blocking`.
pub fn sized(cache: &Path, original: &Path, w: u32, h: u32, fit: Fit) -> Result<Vec<u8>, String> {
    let path = variant_path(cache, original, w, h, fit).ok_or("image not found")?;
    if let Ok(b) = std::fs::read(&path) {
        return Ok(b);
    }
    let bytes = std::fs::read(original).map_err(|e| e.to_string())?;
    let out = make(&bytes, w, h, fit, is_png(original))?;
    // Written whole and then renamed: a panel asking at the same moment never
    // reads half a file. A cache that cannot be written still answers.
    if std::fs::create_dir_all(cache).is_ok() {
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, &out).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
    Ok(out)
}

/// The variants a panel will ask for, made ahead: for every page with a
/// background, at the size of its area (`cornici::sfondo_area`, the same
/// object the panel receives). Run at start and whenever the project changes,
/// so the first visit of a page finds its background ready. Blocking.
pub fn prepare(project_dir: &Path, config_dir: &Path) {
    let cache = cache_dir(config_dir);
    let default_frame = sws_core::Project::load(project_dir)
        .ok()
        .and_then(|p| p.page_layout)
        .and_then(|l| l.cornice_predefinita);
    let Ok(pages) = std::fs::read_dir(crate::router::synoptics_dir_at(project_dir)) else {
        return;
    };
    let images = crate::router::images_dir_at(project_dir);
    let mut made = 0;
    for entry in pages.flatten() {
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(mut page) = serde_yaml::from_str::<crate::synoptic::SynopticPage>(&text) else {
            continue;
        };
        let frame =
            crate::cornici::cornice_della_pagina(&page, default_frame.as_deref()).and_then(|id| {
                let path = crate::router::cornici_dir_at(project_dir)
                    .join(format!("{}.yaml", crate::synoptic::safe_filename(&id)));
                serde_yaml::from_str::<crate::cornici::Cornice>(
                    &std::fs::read_to_string(path).ok()?,
                )
                .ok()
            });
        page.objects.clear();
        crate::cornici::sfondo_area(&mut page, frame.as_ref());
        let Some(area) = page.objects.first() else {
            continue;
        };
        let Some(name) = area
            .bg_image
            .as_deref()
            .and_then(|s| s.strip_prefix("/api/project/images/"))
            .filter(|n| resizable(n) && !n.contains(['/', '?']))
        else {
            continue;
        };
        // Rounded as the LVGL viewer rounds them, or it would ask another size.
        let size = |v: Option<f64>| v.unwrap_or(0.0).round().clamp(0.0, MAX_SIDE as f64) as u32;
        let (w, h) = (size(area.width), size(area.height));
        if w == 0 || h == 0 {
            continue;
        }
        let original = images.join(name);
        let ready = variant_path(&cache, &original, w, h, Fit::Cover).is_some_and(|p| p.exists());
        if !ready {
            match sized(&cache, &original, w, h, Fit::Cover) {
                Ok(_) => made += 1,
                Err(e) => tracing::warn!("background {name} at {w}x{h}: {e}"),
            }
        }
    }
    if made > 0 {
        tracing::info!(made, "page backgrounds prepared at the panel's size");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 300×100 image: left half red, right half blue.
    fn two_halves(path: &Path) {
        let img = image::RgbImage::from_fn(300, 100, |x, _| {
            if x < 150 {
                image::Rgb([255, 0, 0])
            } else {
                image::Rgb([0, 0, 255])
            }
        });
        img.save(path).unwrap();
    }

    #[test]
    fn a_variant_has_the_size_asked_and_is_cropped_like_cover() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("bg.png");
        two_halves(&src);
        let cache = d.path().join("cache");
        let out = sized(&cache, &src, 100, 100, Fit::Cover).unwrap();
        let img = image::load_from_memory(&out).unwrap().into_rgb8();
        assert_eq!(img.dimensions(), (100, 100));
        // Cover keeps the middle: both halves are there, side by side.
        assert!(img.get_pixel(10, 50)[0] > 200);
        assert!(img.get_pixel(90, 50)[2] > 200);
        // And it was kept.
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
    }

    #[test]
    fn the_second_request_reads_the_cache_and_a_new_original_makes_a_new_variant() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("bg.png");
        two_halves(&src);
        let cache = d.path().join("cache");
        let first = variant_path(&cache, &src, 60, 40, Fit::Cover).unwrap();
        sized(&cache, &src, 60, 40, Fit::Cover).unwrap();
        // A marker in the cached file: the second call must return it as is.
        std::fs::write(&first, b"cached").unwrap();
        assert_eq!(sized(&cache, &src, 60, 40, Fit::Cover).unwrap(), b"cached");
        // Another size, another variant.
        assert_ne!(
            variant_path(&cache, &src, 61, 40, Fit::Cover).unwrap(),
            first
        );
        // A replaced original (another length): another variant.
        image::RgbImage::from_pixel(10, 10, image::Rgb([0, 255, 0]))
            .save(&src)
            .unwrap();
        assert_ne!(
            variant_path(&cache, &src, 60, 40, Fit::Cover).unwrap(),
            first
        );
    }

    #[test]
    fn prepare_makes_the_variant_of_each_page_background_at_its_area() {
        let d = tempfile::tempdir().unwrap();
        let project = d.path().join("p");
        std::fs::create_dir_all(project.join("synoptics")).unwrap();
        std::fs::create_dir_all(project.join("images")).unwrap();
        two_halves(&project.join("images/bg.png"));
        std::fs::write(
            project.join("synoptics/a.yaml"),
            "id: a\nname: A\nobjects: []\nwidth: 200.0\nheight: 120.0\nsfondo_immagine: /api/project/images/bg.png\n",
        )
        .unwrap();
        std::fs::write(
            project.join("synoptics/b.yaml"),
            "id: b\nname: B\nobjects: []\n",
        )
        .unwrap();
        let config = d.path().join("config");
        prepare(&project, &config);
        let expected = variant_path(
            &cache_dir(&config),
            &project.join("images/bg.png"),
            200,
            120,
            Fit::Cover,
        )
        .unwrap();
        assert!(expected.exists());
        assert_eq!(std::fs::read_dir(cache_dir(&config)).unwrap().count(), 1);
    }

    #[test]
    fn contain_keeps_the_proportions_and_the_transparency_of_a_png() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("cutout.png");
        // 200×100, transparent on the left, opaque green on the right.
        image::RgbaImage::from_fn(200, 100, |x, _| {
            if x < 100 {
                image::Rgba([0, 0, 0, 0])
            } else {
                image::Rgba([0, 255, 0, 255])
            }
        })
        .save(&src)
        .unwrap();
        let cache = d.path().join("cache");
        let out = sized(&cache, &src, 50, 50, Fit::Contain).unwrap();
        let img = image::load_from_memory_with_format(&out, image::ImageFormat::Png)
            .unwrap()
            .into_rgba8();
        assert_eq!(img.dimensions(), (50, 25), "inside 50×50, proportions kept");
        assert_eq!(img.get_pixel(5, 12)[3], 0, "still transparent");
        assert!(img.get_pixel(45, 12)[1] > 200);
        assert_eq!(content_type(&src, Fit::Contain), "image/png");
        // Never enlarged; a cover variant of the same size is another file.
        let small = sized(&cache, &src, 400, 400, Fit::Contain).unwrap();
        assert_eq!(image::load_from_memory(&small).unwrap().width(), 200);
        assert_ne!(
            variant_path(&cache, &src, 50, 50, Fit::Contain),
            variant_path(&cache, &src, 50, 50, Fit::Cover)
        );
        // A JPEG stays a JPEG.
        let jpg = d.path().join("photo.jpg");
        image::RgbImage::from_pixel(300, 150, image::Rgb([10, 20, 30]))
            .save(&jpg)
            .unwrap();
        let out = sized(&cache, &jpg, 60, 60, Fit::Contain).unwrap();
        assert_eq!(image::guess_format(&out).unwrap(), image::ImageFormat::Jpeg);
        assert_eq!(image::load_from_memory(&out).unwrap().height(), 30);
    }

    #[test]
    fn only_jpeg_and_png_are_resized() {
        assert!(resizable("a.JPG") && resizable("b.jpeg") && resizable("c.png"));
        assert!(!resizable("d.svg") && !resizable("e.gif") && !resizable("f.webp"));
    }
}
