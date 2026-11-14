//! The calibration of resistive touch screens (TY750/TY770), phase 4 of the
//! control panel plan (`docs/plans/2026-11-13-pannello-di-controllo.md`).
//!
//! Measured on 14-11-2026: PixsysOS for the Tiny TY keeps the calibration in
//! the **tslib** format, `/usr/local/etc/pointercal`, written by
//! `/data/calibrate.sh` (`ts_calibrate`). The viewer used to read the TSC2007
//! raw and stretch it between minimum and maximum, ignoring it: a resistive
//! screen was uncalibrated under SWS. Now a resistive device applies the
//! matrix: SWS's own (`/var/lib/sws/viewer/pointercal`) first, Pixsys' after.
//! SWS writes only its own; the factory file stays as it is.
//!
//! The format: `a b c d e f s xres yres`, with
//! `x = (a·X + b·Y + c) / s` and `y = (d·X + e·Y + f) / s` in a screen of
//! `xres × yres`, scaled when the screen in use has another size.
//!
//! Built without a resistive device to try it on (decision of the maintainer,
//! 14-11-2026): the tests cover the matrix, the fit and the Pixsys file.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// SWS's calibration: under the viewer's data, owned by `sws`.
pub const OWN_FILE: &str = "/var/lib/sws/viewer/pointercal";
/// The factory one, read only.
pub const PIXSYS_FILE: &str = "/usr/local/etc/pointercal";

/// Margin of the crosses from the edges, in pixels.
pub const MARGIN: i32 = 50;
/// Without a touch for this long, the calibration gives up and the previous
/// one comes back: a resistive screen off by a lot must not lock anyone out.
pub const GIVE_UP: Duration = Duration::from_secs(30);

/// A touched cross: the raw `X, Y` and the screen point it should be.
pub type Point = ((i32, i32), (i32, i32));

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Matrix {
    pub a: [i64; 7],
    pub xres: i32,
    pub yres: i32,
}

impl Matrix {
    pub fn parse(text: &str) -> Option<Matrix> {
        let n: Vec<i64> = text
            .split_whitespace()
            .map(|t| t.parse().ok())
            .collect::<Option<_>>()?;
        if n.len() < 7 || n[6] == 0 {
            return None;
        }
        let (xres, yres) = match n.get(7..9) {
            Some([x, y]) => (*x as i32, *y as i32),
            _ => (0, 0),
        };
        Some(Matrix {
            a: [n[0], n[1], n[2], n[3], n[4], n[5], n[6]],
            xres,
            yres,
        })
    }

    pub fn format(&self) -> String {
        let a = self.a;
        format!(
            "{} {} {} {} {} {} {} {} {}",
            a[0], a[1], a[2], a[3], a[4], a[5], a[6], self.xres, self.yres
        )
    }

    /// Raw `X, Y` to a point of a `w × h` screen.
    pub fn apply(&self, x: i32, y: i32, w: i32, h: i32) -> (i32, i32) {
        let [a, b, c, d, e, f, s] = self.a;
        let (x, y) = (x as i64, y as i64);
        let mut sx = (a * x + b * y + c) / s;
        let mut sy = (d * x + e * y + f) / s;
        if self.xres > 0 && self.xres != w {
            sx = sx * w as i64 / self.xres as i64;
        }
        if self.yres > 0 && self.yres != h {
            sy = sy * h as i64 / self.yres as i64;
        }
        (
            sx.clamp(0, (w - 1).max(0) as i64) as i32,
            sy.clamp(0, (h - 1).max(0) as i64) as i32,
        )
    }

    /// Least squares on the touched points, as `ts_calibrate` does: each
    /// screen axis as a plane over the raw `X, Y`. `None` when the points do
    /// not span a plane (all on one line, or the same touch five times).
    pub fn fit(points: &[Point], w: i32, h: i32) -> Option<Matrix> {
        if points.len() < 3 {
            return None;
        }
        // Normal equations: [Σxx Σxy Σx; Σxy Σyy Σy; Σx Σy n] · k = [Σx·t; Σy·t; Σt].
        let (mut sxx, mut sxy, mut syy, mut sx, mut sy) = (0f64, 0f64, 0f64, 0f64, 0f64);
        let n = points.len() as f64;
        for ((x, y), _) in points {
            let (x, y) = (*x as f64, *y as f64);
            sxx += x * x;
            sxy += x * y;
            syy += y * y;
            sx += x;
            sy += y;
        }
        let m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
        let solve = |target: &dyn Fn(&(i32, i32)) -> f64| -> Option<[f64; 3]> {
            let mut r = [0f64; 3];
            for ((x, y), t) in points {
                let t = target(t);
                r[0] += *x as f64 * t;
                r[1] += *y as f64 * t;
                r[2] += t;
            }
            solve3(m, r)
        };
        let kx = solve(&|t| t.0 as f64)?;
        let ky = solve(&|t| t.1 as f64)?;
        const S: f64 = 65536.0;
        let k = |v: f64| (v * S).round() as i64;
        Some(Matrix {
            a: [
                k(kx[0]),
                k(kx[1]),
                k(kx[2]),
                k(ky[0]),
                k(ky[1]),
                k(ky[2]),
                S as i64,
            ],
            xres: w,
            yres: h,
        })
    }
}

/// Cramer's rule on a 3×3 system; `None` when it is singular.
fn solve3(m: [[f64; 3]; 3], r: [f64; 3]) -> Option<[f64; 3]> {
    let det = |m: [[f64; 3]; 3]| {
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    };
    let d = det(m);
    if d.abs() < 1e-6 {
        return None;
    }
    let mut out = [0f64; 3];
    for (i, o) in out.iter_mut().enumerate() {
        let mut mi = m;
        for row in 0..3 {
            mi[row][i] = r[row];
        }
        *o = det(mi) / d;
    }
    Some(out)
}

/// Resistive controllers by the name the kernel gives them: the TSC2007 of the
/// TY750/770, and the common ones of the same family. The ILITEK capacitive
/// of the TY570 needs none.
pub fn is_resistive(device_name: &str) -> bool {
    let n = device_name.to_ascii_lowercase();
    !n.contains("ilitek")
        && ["tsc20", "ads7846", "ar1021", "resistive"]
            .iter()
            .any(|k| n.contains(k))
}

/// The first readable calibration among `files`.
pub fn load(files: &[&Path]) -> Option<(Matrix, String)> {
    files.iter().find_map(|p| {
        let m = Matrix::parse(&std::fs::read_to_string(p).ok()?)?;
        Some((m, p.display().to_string()))
    })
}

pub fn save(m: &Matrix, file: &Path) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, format!("{}\n", m.format()))?;
    std::fs::rename(tmp, file)
}

// ── Live state, shared by the touch thread and the panel ─────────────────────

static RESISTIVE: AtomicBool = AtomicBool::new(false);
static MATRIX: Mutex<Option<Matrix>> = Mutex::new(None);
/// While the crosses are on screen, the touch goes here raw instead of LVGL.
static CAPTURE: Mutex<Option<Capture>> = Mutex::new(None);
/// The last calibrated point and when the finger was last down: the trial
/// after the fit draws the point under the finger and gives up after
/// [`GIVE_UP`] without touches.
static LAST: Mutex<Option<((i32, i32), Instant)>> = Mutex::new(None);

/// The five crosses being touched.
#[derive(Debug, Clone)]
pub struct Capture {
    /// The calibration to go back to when giving up or cancelling.
    pub previous: Option<Matrix>,
    pub points: Vec<Point>,
    /// Samples of the press in progress, averaged at release.
    samples: Vec<(i32, i32)>,
    pub last_touch: Instant,
    pub size: (i32, i32),
}

/// The crosses: four corners at [`MARGIN`], then the centre.
pub fn targets(w: i32, h: i32) -> [(i32, i32); 5] {
    [
        (MARGIN, MARGIN),
        (w - MARGIN, MARGIN),
        (w - MARGIN, h - MARGIN),
        (MARGIN, h - MARGIN),
        (w / 2, h / 2),
    ]
}

/// The touch thread, at start: whether this device is resistive, and its
/// matrix if one is saved.
pub fn init(device_name: &str) {
    let resistive = is_resistive(device_name);
    RESISTIVE.store(resistive, Ordering::Relaxed);
    if !resistive {
        return;
    }
    match load(&[Path::new(OWN_FILE), Path::new(PIXSYS_FILE)]) {
        Some((m, from)) => {
            eprintln!("[touch] resistive '{device_name}': calibration from {from}");
            *MATRIX.lock().unwrap_or_else(|e| e.into_inner()) = Some(m);
        }
        None => eprintln!("[touch] resistive '{device_name}': no calibration, min-max stretch"),
    }
}

pub fn resistive() -> bool {
    RESISTIVE.load(Ordering::Relaxed)
}

/// A raw sample from the touch thread. `Some((x, y))` = the screen point to
/// give LVGL; `None` = the calibration takes it (or there is no matrix and the
/// caller stretches min-max).
pub enum Routed {
    Calibrated(i32, i32),
    Captured,
    Uncalibrated,
}

pub fn route(x: i32, y: i32, pressed: bool, w: i32, h: i32) -> Routed {
    {
        let mut c = CAPTURE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cap) = c.as_mut() {
            cap.last_touch = Instant::now();
            if pressed {
                cap.samples.push((x, y));
            } else if !cap.samples.is_empty() {
                let n = cap.samples.len() as i64;
                let (sx, sy) = cap
                    .samples
                    .drain(..)
                    .fold((0i64, 0i64), |(a, b), (x, y)| (a + x as i64, b + y as i64));
                let i = cap.points.len();
                if let Some(t) = targets(cap.size.0, cap.size.1).get(i) {
                    cap.points.push((((sx / n) as i32, (sy / n) as i32), *t));
                }
            }
            return Routed::Captured;
        }
    }
    match *MATRIX.lock().unwrap_or_else(|e| e.into_inner()) {
        Some(m) => {
            let (sx, sy) = m.apply(x, y, w, h);
            if pressed {
                *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(((sx, sy), Instant::now()));
            }
            Routed::Calibrated(sx, sy)
        }
        None => Routed::Uncalibrated,
    }
}

/// The last calibrated touch: where, and when.
pub fn last_touch() -> Option<((i32, i32), Instant)> {
    *LAST.lock().unwrap_or_else(|e| e.into_inner())
}

/// Starts the crosses on a `w × h` screen.
pub fn begin(w: i32, h: i32) {
    let previous = *MATRIX.lock().unwrap_or_else(|e| e.into_inner());
    *CAPTURE.lock().unwrap_or_else(|e| e.into_inner()) = Some(Capture {
        previous,
        points: Vec::new(),
        samples: Vec::new(),
        last_touch: Instant::now(),
        size: (w, h),
    });
}

/// Where the calibration stands, for the panel's frame tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// Waiting for cross `n` (0-4).
    Cross(usize),
    /// Five points fitted: the candidate matrix is live, try it.
    Trying,
    /// The points did not make a calibration: start over.
    Failed,
    /// No touch for [`GIVE_UP`]: the previous calibration is back.
    GaveUp,
}

/// Advances the capture: after the fifth cross, fits and puts the candidate
/// live (the panel keeps the previous one to restore). Call at every frame.
pub fn step(now: Instant) -> Option<Progress> {
    let mut c = CAPTURE.lock().unwrap_or_else(|e| e.into_inner());
    let cap = c.as_ref()?;
    if now.duration_since(cap.last_touch) > GIVE_UP {
        let prev = cap.previous;
        *c = None;
        *MATRIX.lock().unwrap_or_else(|e| e.into_inner()) = prev;
        return Some(Progress::GaveUp);
    }
    if cap.points.len() < 5 {
        return Some(Progress::Cross(cap.points.len()));
    }
    let (w, h) = cap.size;
    let fitted = Matrix::fit(&cap.points, w, h);
    *c = None;
    match fitted {
        Some(m) => {
            *MATRIX.lock().unwrap_or_else(|e| e.into_inner()) = Some(m);
            Some(Progress::Trying)
        }
        None => Some(Progress::Failed),
    }
}

/// Stops the crosses without changing anything.
pub fn cancel_capture() -> Option<Matrix> {
    CAPTURE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .and_then(|c| c.previous)
}

/// Puts a calibration live (the previous one, when the try is refused).
pub fn set_live(m: Option<Matrix>) {
    *MATRIX.lock().unwrap_or_else(|e| e.into_inner()) = m;
}

pub fn live() -> Option<Matrix> {
    *MATRIX.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The file measured on the TY570 on 14-11-2026.
    const PIXSYS: &str = "4157 4 -683600 37 4135 -846804 65536 1024 600";

    #[test]
    fn the_pixsys_file_is_read() {
        let m = Matrix::parse(PIXSYS).unwrap();
        assert_eq!(m.a[6], 65536);
        assert_eq!((m.xres, m.yres), (1024, 600));
        assert_eq!(Matrix::parse(&m.format()), Some(m));
        assert!(Matrix::parse("1 2 3").is_none());
        assert!(Matrix::parse("1 2 3 4 5 6 0").is_none(), "s = 0");
        // A raw point in the middle of the TSC2007's range lands on screen.
        let (x, y) = m.apply(10_000, 10_000, 1024, 600);
        assert!((0..1024).contains(&x) && (0..600).contains(&y));
    }

    #[test]
    fn the_resolution_scales() {
        let m = Matrix {
            a: [65536, 0, 0, 0, 65536, 0, 65536],
            xres: 1024,
            yres: 600,
        };
        assert_eq!(m.apply(512, 300, 1024, 600), (512, 300));
        assert_eq!(m.apply(512, 300, 800, 480), (400, 240));
    }

    #[test]
    fn five_points_give_back_the_transform() {
        // A raw range 200..3900 on both axes, Y upside down: a typical
        // resistive panel mounted the other way.
        let (w, h) = (800, 480);
        let raw = |sx: i32, sy: i32| (200 + sx * 3700 / w, 3900 - sy * 3700 / h);
        let points: Vec<_> = targets(w, h).iter().map(|t| (raw(t.0, t.1), *t)).collect();
        let m = Matrix::fit(&points, w, h).unwrap();
        for t in targets(w, h) {
            let (x, y) = m.apply(raw(t.0, t.1).0, raw(t.0, t.1).1, w, h);
            assert!(
                (x - t.0).abs() <= 1 && (y - t.1).abs() <= 1,
                "{t:?} → {x},{y}"
            );
        }
        let (x, y) = raw(123, 321);
        let (sx, sy) = m.apply(x, y, w, h);
        assert!((sx - 123).abs() <= 1 && (sy - 321).abs() <= 1);
    }

    #[test]
    fn the_same_touch_five_times_is_no_calibration() {
        let points: Vec<_> = targets(800, 480)
            .iter()
            .map(|t| ((1000, 1000), *t))
            .collect();
        assert!(Matrix::fit(&points, 800, 480).is_none());
    }

    #[test]
    fn only_resistive_controllers_are_calibrated() {
        assert!(is_resistive("TSC2007 Touchscreen"));
        assert!(!is_resistive("ILITEK ILITEK-TP"));
        assert!(!is_resistive("ILITEK ILITEK-TP Mouse"));
    }

    #[test]
    fn saved_and_loaded() {
        let d = tempfile::tempdir().unwrap();
        let own = d.path().join("viewer/pointercal");
        let factory = d.path().join("factory");
        std::fs::write(&factory, PIXSYS).unwrap();
        let (m, from) = load(&[&own, &factory]).unwrap();
        assert!(from.ends_with("factory"));
        let mine = Matrix { xres: 800, ..m };
        save(&mine, &own).unwrap();
        let (back, from) = load(&[&own, &factory]).unwrap();
        assert_eq!(back, mine);
        assert!(from.ends_with("pointercal"), "SWS's own comes first");
    }
}
