//! Le parti del tubo che una `lv_line` non sa fare: le estremità (freccia,
//! pallino, flangia) e il flusso animato. 1-10-2026, dopo la Fase 3 del piano
//! `docs/plans/2026-09-30-predefiniti-espliciti.md`.
//!
//! Riferimento: `SvgCanvas.tsx`, ramo `pipe`.
//! - **Estremità**: `<marker>` SVG con `markerUnits` di default
//!   (`strokeWidth`), quindi la forma è grande `mSz × spessore` — `mSz =
//!   max(4, sw × marker_size)` — centrata sul punto finale e orientata lungo
//!   l'ultimo tratto; all'inizio è rovesciata (`auto-start-reverse`).
//! - **Flusso**: un tratteggio `6 14` largo `max(2, sw × 0.35)` nel colore di
//!   riempimento (o #e2e8f0), opaco al 90 %, che scorre di 20 px ogni 0,8 s
//!   (`@keyframes sws-flow`), all'indietro se il valore del tag è negativo.
//!
//! Si disegna su un canvas trasparente sopra il tubo, coordinate relative al
//! suo angolo.

use resvg::tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Stroke, StrokeDash, Transform};

use crate::trend::Rgb;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Estremita {
    Freccia,
    Pallino,
    Flangia,
}

impl Estremita {
    pub fn da(s: Option<&str>) -> Option<Estremita> {
        match s {
            Some("arrow") => Some(Estremita::Freccia),
            Some("dot") => Some(Estremita::Pallino),
            Some("flange") => Some(Estremita::Flangia),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Extra {
    /// I punti del tubo, relativi all'angolo del canvas.
    pub punti: Vec<(f32, f32)>,
    /// Spessore del corpo (`bodySw` del web: il filo «wire» è più sottile).
    pub spessore_corpo: f32,
    /// Spessore nominale (`stroke_width`), per il flusso.
    pub spessore: f32,
    pub inizio: Option<Estremita>,
    pub fine: Option<Estremita>,
    pub dimensione: f32,
    pub colore_flusso: Rgb,
}

impl Extra {
    /// Lato del marcatore in pixel: `mSz × spessore`.
    pub fn lato(&self) -> f32 {
        (self.spessore * self.dimensione).max(4.0) * self.spessore_corpo
    }
}

/// Lo scostamento del tratteggio al tempo `ms`: 20 px ogni 800 ms, all'indietro
/// se `indietro`. Intero, così non si ridisegna per frazioni di pixel.
pub fn scostamento(ms: u64, indietro: bool) -> f32 {
    let f = (ms % 800) as f32 / 800.0 * 20.0;
    let f = f.floor();
    if indietro { f } else { -f }
}

fn paint(c: Rgb, a: f32) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(c.0, c.1, c.2, (a * 255.0).round() as u8);
    p.anti_alias = true;
    p
}

/// Una forma di estremità centrata in `(cx, cy)`, girata dell'angolo `a`.
fn estremita(px: &mut Pixmap, e: Estremita, cx: f32, cy: f32, a: f32, lato: f32, c: Rgb) {
    let m = lato;
    let mut pb = PathBuilder::new();
    match e {
        // `M 0 0 L m m/2 L 0 m Z`, col riferimento a metà: la punta avanti.
        Estremita::Freccia => {
            pb.move_to(-m / 2.0, -m / 2.0);
            pb.line_to(m / 2.0, 0.0);
            pb.line_to(-m / 2.0, m / 2.0);
            pb.close();
        }
        Estremita::Pallino => {
            if let Some(r) = resvg::tiny_skia::Rect::from_xywh(-m / 2.0, -m / 2.0, m, m) {
                pb.push_oval(r);
            }
        }
        Estremita::Flangia => {
            if let Some(r) = resvg::tiny_skia::Rect::from_xywh(-m / 2.0, -m / 2.0, m * 0.35, m) {
                pb.push_rect(r);
            }
        }
    }
    if let Some(p) = pb.finish() {
        let t = Transform::from_translate(cx, cy).pre_rotate(a.to_degrees());
        px.fill_path(&p, &paint(c, 1.0), FillRule::Winding, t, None);
    }
}

/// Disegna estremità (nel colore del tubo) e, se `flusso` è `Some(scostamento)`,
/// il tratteggio che scorre.
pub fn disegna(x: &Extra, colore: Rgb, flusso: Option<f32>, px: &mut Pixmap) {
    px.fill(resvg::tiny_skia::Color::TRANSPARENT);
    let n = x.punti.len();
    if n < 2 {
        return;
    }
    if let Some(off) = flusso {
        let mut pb = PathBuilder::new();
        pb.move_to(x.punti[0].0, x.punti[0].1);
        for p in &x.punti[1..] {
            pb.line_to(p.0, p.1);
        }
        if let Some(path) = pb.finish() {
            let st = Stroke {
                width: (x.spessore * 0.35).max(2.0),
                line_cap: resvg::tiny_skia::LineCap::Round,
                line_join: resvg::tiny_skia::LineJoin::Round,
                dash: StrokeDash::new(vec![6.0, 14.0], off),
                ..Default::default()
            };
            px.stroke_path(&path, &paint(x.colore_flusso, 0.9), &st, Transform::identity(), None);
        }
    }
    let lato = x.lato();
    if let Some(e) = x.inizio {
        let (a, b) = (x.punti[0], x.punti[1]);
        // Rovesciata: punta verso l'esterno, contro il primo tratto.
        let ang = (a.1 - b.1).atan2(a.0 - b.0);
        estremita(px, e, a.0, a.1, ang, lato, colore);
    }
    if let Some(e) = x.fine {
        let (a, b) = (x.punti[n - 2], x.punti[n - 1]);
        let ang = (b.1 - a.1).atan2(b.0 - a.0);
        estremita(px, e, b.0, b.1, ang, lato, colore);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extra(inizio: Option<Estremita>, fine: Option<Estremita>) -> Extra {
        Extra {
            punti: vec![(40.0, 50.0), (160.0, 50.0)],
            spessore_corpo: 2.0,
            spessore: 2.0,
            inizio,
            fine,
            dimensione: 1.0,
            colore_flusso: (0, 0, 255),
        }
    }

    fn rosso(px: &Pixmap, x: u32, y: u32) -> bool {
        px.pixel(x, y).unwrap().demultiply().red() > 200
    }

    #[test]
    fn il_lato_e_quello_dei_marker_svg() {
        // max(4, 2×1) = 4, per lo spessore del corpo 2 → 8 px.
        assert_eq!(extra(None, None).lato(), 8.0);
    }

    #[test]
    fn la_freccia_finale_punta_avanti_e_quella_iniziale_indietro() {
        let mut px = Pixmap::new(200, 100).unwrap();
        disegna(&extra(Some(Estremita::Freccia), Some(Estremita::Freccia)), (255, 0, 0), None, &mut px);
        // Fine (160,50): la punta è a destra, la base a sinistra.
        assert!(rosso(&px, 163, 50));
        assert!(rosso(&px, 157, 47));
        assert!(!rosso(&px, 163, 47));
        // Inizio (40,50): rovesciata, la punta è a sinistra.
        assert!(rosso(&px, 37, 50));
        assert!(!rosso(&px, 37, 47));
    }

    #[test]
    fn il_flusso_scorre_e_torna_indietro_col_segno() {
        assert_eq!(scostamento(0, false), 0.0);
        assert_eq!(scostamento(400, false), -10.0);
        assert_eq!(scostamento(400, true), 10.0);
        assert_eq!(scostamento(800, false), 0.0);
        let mut a = Pixmap::new(200, 100).unwrap();
        let mut b = Pixmap::new(200, 100).unwrap();
        disegna(&extra(None, None), (0, 0, 0), Some(0.0), &mut a);
        disegna(&extra(None, None), (0, 0, 0), Some(-10.0), &mut b);
        assert_ne!(a.data(), b.data(), "lo scostamento sposta il tratteggio");
    }
}
