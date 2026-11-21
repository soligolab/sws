//! The moving effects of the symbols (plan `docs/plans/2026-11-21-simboli-fase-8-effetti.md`):
//! bubbles, smoke, flame. Decision of the maintainer (21-11-2026): **native on
//! each engine** — continuous SVG animations in the browser
//! (`sws-editor/src/symbols/lib/effects.tsx`, SMIL), frames on the panel drawn
//! from this module. The two share the numbers: where each bubble is, how big,
//! how far it goes; the cases are in `tests/fixtures/symbol-fx.json`.
//!
//! An effect lives in a box of its part (`x y w h`, viewBox units) and moves
//! while its input is true. `t` is the time in the period, 0 to 1.

use crate::simboli_lib::ParteLib;

/// Frames of a moving effect on the panel, before the page's budget.
pub const FX_FRAMES: usize = 16;
/// The shortest and longest period of an effect.
pub const MIN_FX_PERIOD_MS: f64 = 400.0;
pub const MAX_FX_PERIOD_MS: f64 = 10_000.0;

pub const BUBBLE_COLOUR: &str = "#bae6fd";
pub const SMOKE_COLOUR: &str = "#9ca3af";
/// Puffs of smoke on their way at once.
pub const SMOKE_PUFFS: usize = 4;

fn frac(v: f64) -> f64 {
    v - v.floor()
}

/// One bubble of `n`: where it starts (`cx`, `cy0`), its radius, how far it rises.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bubble {
    pub cx: f64,
    pub cy0: f64,
    pub r: f64,
    pub travel: f64,
}

/// The `i`-th bubble of `n` in the box: spread across it by the golden ratio,
/// sizes a little different, always the same for the same box.
pub fn bubble(i: usize, n: usize, x: f64, y: f64, w: f64, h: f64) -> Bubble {
    let _ = n;
    let fi = i as f64;
    let r = (w.min(h) * 0.06 * (0.7 + 0.6 * frac(fi * 0.37))).max(0.8);
    Bubble {
        cx: x + w * (0.1 + 0.8 * frac(fi * 0.618_034 + 0.13)),
        cy0: y + h - r,
        r,
        travel: (h - 2.0 * r).max(0.0),
    }
}

/// The opacity of a bubble along its way: it appears, stays, fades at the top.
/// The `keyTimes` of the web are `0;0.1;0.85;1`.
pub fn bubble_opacity(phase: f64) -> f64 {
    if phase < 0.1 {
        phase / 0.1
    } else if phase > 0.85 {
        (1.0 - phase) / 0.15
    } else {
        1.0
    }
}

/// One puff of `SMOKE_PUFFS`: where it starts and ends (`cx`, `cy`), how big it
/// starts and ends. It drifts a little sideways, odd puffs the other way.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Puff {
    pub cx0: f64,
    pub cx1: f64,
    pub cy0: f64,
    pub cy1: f64,
    pub r0: f64,
    pub r1: f64,
}

pub fn puff(i: usize, x: f64, y: f64, w: f64, h: f64) -> Puff {
    let side = if i % 2 == 0 { 1.0 } else { -1.0 };
    let mid = x + w * 0.5;
    let r0 = w * 0.12;
    Puff {
        cx0: mid - 0.1 * w * side,
        cx1: mid + 0.1 * w * side,
        cy0: y + h - r0,
        cy1: y + h * 0.15,
        r0,
        r1: w * 0.37,
    }
}

/// A puff fades as it rises: 0.6 at the bottom, 0 at the top.
pub fn smoke_opacity(phase: f64) -> f64 {
    0.6 * (1.0 - phase)
}

/// The box an effect may draw in: its part's, a little wider for what
/// spreads out of it (the smoke grows). `None` for a part that isn't an effect.
pub fn fx_box(p: &ParteLib) -> Option<(f64, f64, f64, f64)> {
    match p {
        ParteLib::Bubbles { x, y, w, h, .. } => Some((*x, *y, *w, *h)),
        // The puffs grow to about a third of the width either side.
        ParteLib::Smoke { x, y, w, h, .. } => Some((x - 0.3 * w, y - 0.1 * h, w * 1.6, h * 1.1)),
        _ => None,
    }
}

pub fn fx_period_ms(p: &ParteLib) -> Option<f64> {
    match p {
        ParteLib::Bubbles { period_ms, .. } | ParteLib::Smoke { period_ms, .. } => Some(*period_ms),
        _ => None,
    }
}

fn num(v: f64) -> String {
    crate::simboli_prj::fmt(v)
}

/// The SVG elements of the effect at `t` (0..1 of its period): what a frame
/// of the panel draws. `None` for a part that isn't a moving effect.
pub fn fx_elements(p: &ParteLib, t: f64) -> Option<String> {
    match p {
        ParteLib::Bubbles {
            x,
            y,
            w,
            h,
            color,
            count,
            ..
        } => {
            let c = color.as_deref().unwrap_or(BUBBLE_COLOUR);
            let n = (*count).clamp(1, 12) as usize;
            let mut out = String::new();
            for i in 0..n {
                let b = bubble(i, n, *x, *y, *w, *h);
                let phase = frac(t + i as f64 / n as f64);
                out.push_str(&format!(
                    "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"{c}\" fill-opacity=\"0.35\" stroke=\"{c}\" stroke-width=\"{}\" opacity=\"{}\"/>",
                    num(b.cx),
                    num(b.cy0 - phase * b.travel),
                    num(b.r),
                    num((b.r * 0.25).max(0.3)),
                    num(bubble_opacity(phase)),
                ));
            }
            Some(out)
        }
        ParteLib::Smoke {
            x, y, w, h, color, ..
        } => {
            let c = color.as_deref().unwrap_or(SMOKE_COLOUR);
            let mut out = String::new();
            for i in 0..SMOKE_PUFFS {
                let p = puff(i, *x, *y, *w, *h);
                let ph = frac(t + i as f64 / SMOKE_PUFFS as f64);
                let lerp = |a: f64, b: f64| a + (b - a) * ph;
                out.push_str(&format!(
                    "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"{c}\" stroke=\"none\" opacity=\"{}\"/>",
                    num(lerp(p.cx0, p.cx1)),
                    num(lerp(p.cy0, p.cy1)),
                    num(lerp(p.r0, p.r1)),
                    num(smoke_opacity(ph)),
                ));
            }
            Some(out)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Fixture {
        bubbles: Vec<BubbleCase>,
        bubble_opacity: Vec<(f64, f64)>,
        puffs: Vec<PuffCase>,
    }
    #[derive(serde::Deserialize)]
    struct PuffCase {
        i: usize,
        r#box: [f64; 4],
        expected: [f64; 6],
    }
    #[derive(serde::Deserialize)]
    struct BubbleCase {
        i: usize,
        n: usize,
        r#box: [f64; 4],
        expected: [f64; 4],
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../../../../tests/fixtures/symbol-fx.json")).unwrap()
    }

    #[test]
    fn the_bubbles_of_the_shared_cases() {
        for c in fixture().bubbles {
            let [x, y, w, h] = c.r#box;
            let b = bubble(c.i, c.n, x, y, w, h);
            let got = [b.cx, b.cy0, b.r, b.travel];
            for (g, e) in got.iter().zip(c.expected) {
                assert!((g - e).abs() < 1e-6, "bubble {} of {}: {got:?} vs {:?}", c.i, c.n, c.expected);
            }
        }
        for (p, want) in fixture().bubble_opacity {
            assert!((bubble_opacity(p) - want).abs() < 1e-9, "{p}");
        }
    }

    #[test]
    fn the_puffs_of_the_shared_cases() {
        for c in fixture().puffs {
            let [x, y, w, h] = c.r#box;
            let p = puff(c.i, x, y, w, h);
            let got = [p.cx0, p.cx1, p.cy0, p.cy1, p.r0, p.r1];
            for (g, e) in got.iter().zip(c.expected) {
                assert!((g - e).abs() < 1e-6, "puff {}: {got:?} vs {:?}", c.i, c.expected);
            }
        }
        let p: ParteLib = serde_json::from_value(serde_json::json!({
            "kind": "smoke", "id": "s", "x": 40, "y": 0, "w": 20, "h": 50
        }))
        .unwrap();
        assert_eq!(fx_elements(&p, 0.3).unwrap().matches("<circle").count(), SMOKE_PUFFS);
        assert_eq!(fx_box(&p), Some((34.0, -5.0, 32.0, 55.00000000000001)));
    }

    #[test]
    fn a_frame_has_every_bubble_and_they_rise() {
        let p: ParteLib = serde_json::from_value(serde_json::json!({
            "kind": "bubbles", "id": "b", "x": 10, "y": 10, "w": 20, "h": 60, "count": 4
        }))
        .unwrap();
        let a = fx_elements(&p, 0.0).unwrap();
        let b = fx_elements(&p, 0.25).unwrap();
        assert_eq!(a.matches("<circle").count(), 4);
        assert_ne!(a, b, "they move");
        assert!(a.contains(BUBBLE_COLOUR));
        assert_eq!(fx_period_ms(&p), Some(2000.0));
    }
}
