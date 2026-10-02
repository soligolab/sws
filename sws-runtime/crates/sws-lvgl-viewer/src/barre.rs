//! Il grafico a barre del pannello, disegnato come lo disegna il web
//! (30-09-2026, Fase 3 del piano `docs/plans/2026-09-30-predefiniti-espliciti.md`).
//!
//! Fino a quel giorno era una `lv_bar` per serie: solo verticale (l'orizzontale
//! non si disegnava affatto), niente impilato, niente tacche, soglie, legenda,
//! niente assi, e l'aspetto del tema. Qui si porta `SvgCanvas.tsx` (ramo
//! `bar_chart`) passo per passo: stessi margini, stesse scale (Q28: per serie
//! quando affiancate, condivisa quando impilate), stessi colori. Le forme vanno
//! in un pixmap tiny-skia, i testi escono come [`Testo`] e li scrive
//! `lvgl_render` con etichette LVGL — stesso schema di `trend.rs`.

use resvg::tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Stroke, StrokeDash, Transform};

use crate::trend::{Orizz, Rgb, Testo, Vert, TAVOLOZZA};

#[derive(Debug, Clone, PartialEq)]
pub struct Serie {
    pub etichetta: String,
    pub colore: Option<Rgb>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub w: u32,
    pub h: u32,
    pub serie: Vec<Serie>,
    pub orizzontale: bool,
    pub impilato: bool,
    pub gap: f64,
    pub valori: bool,
    pub etichette: bool,
    pub soglie: bool,
    pub legenda: bool,
    pub tacche: u32,
    pub decimali: usize,
    pub unita: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub warn_low: Option<f64>,
    pub warn_high: Option<f64>,
    pub alarm_low: Option<f64>,
    pub alarm_high: Option<f64>,
    pub sfondo: Rgb,
    pub titolo_y: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Scala {
    lo: f64,
    hi: f64,
}

impl Scala {
    fn frazione(&self, v: f64) -> f64 {
        let span = if self.hi - self.lo == 0.0 { 1.0 } else { self.hi - self.lo };
        ((v - self.lo) / span).clamp(0.0, 1.0)
    }
}

const BORDO: Rgb = (0x33, 0x41, 0x55);
const GRIGLIA: Rgb = (0x1e, 0x29, 0x3b);
const TACCA: Rgb = (0x64, 0x74, 0x8b);
const ETICHETTA: Rgb = (0x94, 0xa3, 0xb8);
const VALORE: Rgb = (0xe2, 0xe8, 0xf0);
const SU_BARRA: Rgb = (0x0f, 0x17, 0x2a);

fn scala_serie(s: &Serie) -> Scala {
    let (lo, hi) = (s.min.unwrap_or(0.0), s.max.unwrap_or(100.0));
    if hi > lo { Scala { lo, hi } } else { Scala { lo: 0.0, hi: 100.0 } }
}

fn fisso(v: f64, d: usize) -> String {
    crate::trend::to_fixed(v, d)
}

fn paint(c: Rgb, a: f32) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(c.0, c.1, c.2, (a * 255.0).round() as u8);
    p.anti_alias = true;
    p
}

fn rett(px: &mut Pixmap, x: f64, y: f64, w: f64, h: f64, c: Rgb, raggio: f32) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    if raggio <= 0.0 {
        if let Some(r) = Rect::from_xywh(x as f32, y as f32, w as f32, h as f32) {
            px.fill_rect(r, &paint(c, 1.0), Transform::identity(), None);
        }
        return;
    }
    let (x, y, w, h) = (x as f32, y as f32, w as f32, h as f32);
    let r = raggio.min(w / 2.0).min(h / 2.0);
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.quad_to(x + w, y, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.quad_to(x + w, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.quad_to(x, y + h, x, y + h - r);
    pb.line_to(x, y + r);
    pb.quad_to(x, y, x + r, y);
    pb.close();
    if let Some(p) = pb.finish() {
        px.fill_path(&p, &paint(c, 1.0), FillRule::Winding, Transform::identity(), None);
    }
}

fn linea(px: &mut Pixmap, x0: f64, y0: f64, x1: f64, y1: f64, c: Rgb, tratteggio: Option<Vec<f32>>) {
    let mut pb = PathBuilder::new();
    pb.move_to(x0 as f32, y0 as f32);
    pb.line_to(x1 as f32, y1 as f32);
    let mut st = Stroke { width: 1.0, ..Default::default() };
    if let Some(d) = tratteggio {
        st.dash = StrokeDash::new(d, 0.0);
    }
    if let Some(p) = pb.finish() {
        px.stroke_path(&p, &paint(c, 1.0), &st, Transform::identity(), None);
    }
}

fn testo(sc: &mut Vec<Testo>, x: f64, y_base: f64, t: String, c: Rgb, px: u16, o: Orizz) {
    // Il web dà la linea di base; qui ci si aggancia al fondo della riga.
    sc.push(Testo { x: x as f32, y: (y_base + 2.0) as f32, testo: t, colore: c, px, orizz: o, vert: Vert::Basso });
}

/// Disegna il grafico in `px` (`cfg.w`×`cfg.h`, origine = angolo dell'oggetto)
/// coi `valori` delle serie, e restituisce i testi da scrivere.
pub fn disegna(cfg: &Config, valori: &[f64], px: &mut Pixmap) -> Vec<Testo> {
    let (w, h) = (cfg.w as f64, cfg.h as f64);
    let mut out = Vec::new();
    px.fill(resvg::tiny_skia::Color::TRANSPARENT);
    // Il riquadro: sfondo, angoli 4, bordo #334155.
    rett(px, 0.0, 0.0, w, h, BORDO, 4.0);
    rett(px, 1.0, 1.0, w - 2.0, h - 2.0, cfg.sfondo, 3.0);

    let n_serie = cfg.serie.len();
    let val = |i: usize| valori.get(i).copied().filter(|v| v.is_finite()).unwrap_or(0.0);
    let totale: f64 = (0..n_serie).map(val).sum();
    let dati_lo = (0..n_serie).map(val).fold(0.0_f64, f64::min);
    let impilata = Scala {
        lo: cfg.min.unwrap_or(dati_lo.min(0.0)),
        hi: cfg.max.unwrap_or(totale.max(1.0)),
    };
    let comune = if cfg.impilato {
        Some(impilata)
    } else if n_serie == 0 {
        None
    } else {
        let prima = scala_serie(&cfg.serie[0]);
        cfg.serie.iter().all(|s| scala_serie(s) == prima).then_some(prima)
    };

    let righe_legenda = if cfg.legenda { n_serie.div_ceil(2) } else { 0 };
    let legenda_h = righe_legenda as f64 * 13.0 + if cfg.legenda { 4.0 } else { 0.0 };
    let tacche_visibili = cfg.tacche > 1 && comune.is_some();
    let pad_t = 20.0;
    let pad_b = (if !cfg.orizzontale && cfg.etichette { 28.0 } else { 8.0 }) + legenda_h;
    let pad_l = (if !cfg.orizzontale && tacche_visibili { 34.0 } else { 8.0 })
        + if cfg.orizzontale && cfg.etichette { 42.0 } else { 0.0 };
    let plot_w = (w - pad_l - 8.0).max(10.0);
    let plot_h = (h - pad_t - pad_b).max(10.0);
    let n = n_serie.max(1) as f64;
    let slot = (if cfg.orizzontale { plot_h } else { plot_w }) / if cfg.impilato { 1.0 } else { n };
    let barra = slot * (1.0 - cfg.gap.clamp(0.0, 0.9));
    let (bx0, by0) = (pad_l, pad_t);
    let asse_y = by0 + plot_h;

    // Assi: quello dei valori sempre, quello dello zero a scala comune.
    linea(px, bx0, by0, bx0, asse_y, BORDO, None);
    if let Some(sc) = comune {
        let zf = sc.frazione(0.0);
        if cfg.orizzontale {
            let zx = bx0 + plot_w * zf;
            linea(px, zx, by0, zx, asse_y, BORDO, None);
        } else {
            let zy = asse_y - plot_h * zf;
            linea(px, bx0, zy, bx0 + plot_w, zy, BORDO, None);
        }
    }

    // Tacche numerate (solo a scala comune).
    if let (true, Some(sc)) = (tacche_visibili, comune) {
        for i in 0..cfg.tacche {
            let f = i as f64 / (cfg.tacche - 1) as f64;
            let v = sc.lo + f * (sc.hi - sc.lo);
            let t = fisso(v, if v.abs() < 10.0 { cfg.decimali } else { 0 });
            if cfg.orizzontale {
                let tx = bx0 + plot_w * f;
                linea(px, tx, by0, tx, asse_y + 3.0, GRIGLIA, None);
                testo(&mut out, tx, asse_y + 12.0, t, TACCA, 9, Orizz::Centro);
            } else {
                let ty = asse_y - plot_h * f;
                linea(px, bx0 - 3.0, ty, bx0 + plot_w, ty, GRIGLIA, None);
                testo(&mut out, bx0 - 5.0, ty + 3.0, t, TACCA, 9, Orizz::Dx);
            }
        }
    }

    for (i, s) in cfg.serie.iter().enumerate() {
        let v = val(i);
        let colore = s.colore.unwrap_or(TAVOLOZZA[i % TAVOLOZZA.len()]);
        let vt = format!("{}{}", fisso(v, cfg.decimali), cfg.unita);
        if cfg.impilato {
            let prima: f64 = (0..i).map(val).sum();
            let (f0, f1) = (impilata.frazione(prima), impilata.frazione(prima + v));
            if cfg.orizzontale {
                let x0 = bx0 + plot_w * f0.min(f1);
                let sw = plot_w * (f1 - f0).abs();
                let by = by0 + (plot_h - barra) / 2.0;
                rett(px, x0, by, sw, barra, colore, 0.0);
                if cfg.valori && sw > 26.0 {
                    testo(&mut out, x0 + sw / 2.0, by + barra / 2.0 + 4.0, vt, SU_BARRA, 10, Orizz::Centro);
                }
            } else {
                let y0 = asse_y - plot_h * f0.max(f1);
                let sh = plot_h * (f1 - f0).abs();
                let bx = bx0 + (plot_w - barra) / 2.0;
                rett(px, bx, y0, barra, sh, colore, 0.0);
                if cfg.valori && sh > 12.0 {
                    testo(&mut out, bx + barra / 2.0, y0 + sh / 2.0 + 4.0, vt, SU_BARRA, 10, Orizz::Centro);
                }
            }
            continue;
        }
        let sc = scala_serie(s);
        let (fv, zf) = (sc.frazione(v), sc.frazione(0.0));
        if cfg.orizzontale {
            let (vx, zx) = (bx0 + plot_w * fv, bx0 + plot_w * zf);
            let (bx, bw) = (vx.min(zx), (vx - zx).abs());
            let by = by0 + i as f64 * slot + (slot - barra) / 2.0;
            rett(px, bx, by, bw, barra, colore, 2.0);
            if cfg.valori {
                let (x, o) = if v < 0.0 { (bx - 3.0, Orizz::Dx) } else { (bx + bw + 3.0, Orizz::Sx) };
                testo(&mut out, x, by + barra / 2.0 + 4.0, vt, VALORE, 10, o);
            }
            if cfg.etichette {
                testo(&mut out, 4.0, by + barra / 2.0 + 4.0, s.etichetta.clone(), ETICHETTA, 10, Orizz::Sx);
            }
        } else {
            let bx = bx0 + i as f64 * slot + (slot - barra) / 2.0;
            let (vy, zy) = (asse_y - plot_h * fv, asse_y - plot_h * zf);
            let (by, bh) = (vy.min(zy), (vy - zy).abs());
            rett(px, bx, by, barra, bh, colore, 2.0);
            if cfg.valori {
                let y = if v < 0.0 { by + bh + 11.0 } else { (by - 3.0).max(by0 + 10.0) };
                testo(&mut out, bx + barra / 2.0, y, vt, VALORE, 10, Orizz::Centro);
            }
            if cfg.etichette {
                testo(&mut out, bx + barra / 2.0, asse_y + 14.0, s.etichetta.clone(), ETICHETTA, 10, Orizz::Centro);
            }
        }
    }

    // Soglie tratteggiate, a scala comune e strettamente dentro l'intervallo.
    if let (true, Some(sc)) = (cfg.soglie, comune) {
        for (v, c) in [
            (cfg.warn_high, (0xf5, 0x9e, 0x0b)),
            (cfg.alarm_high, (0xef, 0x44, 0x44)),
            (cfg.warn_low, (0xf5, 0x9e, 0x0b)),
            (cfg.alarm_low, (0xef, 0x44, 0x44)),
        ] {
            let Some(v) = v.filter(|v| *v > sc.lo && *v < sc.hi) else { continue };
            let f = sc.frazione(v);
            let tr = Some(vec![4.0, 2.0]);
            if cfg.orizzontale {
                let x = bx0 + plot_w * f;
                linea(px, x, by0, x, asse_y, c, tr);
            } else {
                let y = asse_y - plot_h * f;
                linea(px, bx0, y, bx0 + plot_w, y, c, tr);
            }
        }
    }

    // Legenda in due colonne sotto il grafico.
    if cfg.legenda {
        for (i, s) in cfg.serie.iter().enumerate() {
            let lx = 6.0 + (i % 2) as f64 * (w / 2.0);
            let ly = h - legenda_h + 2.0 + (i / 2) as f64 * 13.0;
            rett(px, lx, ly, 8.0, 8.0, s.colore.unwrap_or(TAVOLOZZA[i % TAVOLOZZA.len()]), 1.0);
            testo(&mut out, lx + 12.0, ly + 7.0, s.etichetta.clone(), ETICHETTA, 9, Orizz::Sx);
        }
    }

    out
}

/// Il centro del titolo dell'asse Y (`bar_y_label`), relativo all'oggetto:
/// `x + 10`, a metà dell'area del grafico, come sul web. Lo scrive
/// `lvgl_render` con un'etichetta ruotata di −90°.
pub fn centro_titolo(cfg: &Config) -> (f32, f32) {
    let n = cfg.serie.len();
    let righe_legenda = if cfg.legenda { n.div_ceil(2) } else { 0 };
    let legenda_h = righe_legenda as f64 * 13.0 + if cfg.legenda { 4.0 } else { 0.0 };
    let pad_b = (if !cfg.orizzontale && cfg.etichette { 28.0 } else { 8.0 }) + legenda_h;
    let plot_h = (cfg.h as f64 - 20.0 - pad_b).max(10.0);
    (10.0, (20.0 + plot_h / 2.0) as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn serie(e: &str) -> Serie {
        Serie { etichetta: e.into(), colore: Some((255, 0, 0)), min: None, max: None }
    }

    fn cfg() -> Config {
        Config {
            w: 240,
            h: 180,
            serie: vec![serie("A"), serie("B")],
            orizzontale: false,
            impilato: false,
            gap: 0.2,
            valori: true,
            etichette: true,
            soglie: true,
            legenda: false,
            tacche: 0,
            decimali: 1,
            unita: String::new(),
            min: None,
            max: None,
            warn_low: None,
            warn_high: None,
            alarm_low: None,
            alarm_high: None,
            sfondo: (0x0f, 0x17, 0x2a),
            titolo_y: None,
        }
    }

    fn rosso(px: &Pixmap, x: u32, y: u32) -> bool {
        let p = px.pixel(x, y).unwrap().demultiply();
        p.red() > 200 && p.green() < 60
    }

    #[test]
    fn le_barre_verticali_sono_alte_quanto_il_valore() {
        let c = cfg();
        let mut px = Pixmap::new(240, 180).unwrap();
        let t = disegna(&c, &[50.0, 100.0], &mut px);
        // plot_h = 180 - 20 - 28 = 132; la serie A a metà: 66 px dal fondo.
        let asse = 20.0 + 132.0;
        let bx = 8.0 + (112.0 - 89.6) / 2.0 + 10.0;
        assert!(rosso(&px, bx as u32, (asse - 30.0) as u32));
        assert!(!rosso(&px, bx as u32, (asse - 100.0) as u32));
        assert!(t.iter().any(|x| x.testo == "50.0"));
        assert!(t.iter().any(|x| x.testo == "A"));
    }

    #[test]
    fn l_orizzontale_si_disegna() {
        // Prima su LVGL non si disegnava affatto.
        let mut c = cfg();
        c.orizzontale = true;
        let mut px = Pixmap::new(240, 180).unwrap();
        let t = disegna(&c, &[100.0, 0.0], &mut px);
        // pad_l = 8 + 42; la serie A piena fino a 50 + plot_w.
        assert!(rosso(&px, 150, 20 + 38));
        assert!(t.iter().any(|x| x.testo == "A" && x.orizz == Orizz::Sx));
    }

    #[test]
    fn impilato_somma_e_scala_condivisa_con_tacche() {
        let mut c = cfg();
        c.impilato = true;
        c.tacche = 3;
        let mut px = Pixmap::new(240, 180).unwrap();
        let t = disegna(&c, &[30.0, 70.0], &mut px);
        // Scala 0..100 (il totale): tacche 0, 50, 100.
        for v in ["0.0", "50", "100"] {
            assert!(t.iter().any(|x| x.testo == v), "{v}: {t:?}");
        }
    }

    #[test]
    fn niente_tacche_ne_soglie_se_le_scale_sono_diverse() {
        let mut c = cfg();
        c.tacche = 3;
        c.warn_high = Some(50.0);
        c.serie[1].max = Some(10.0);
        let mut px = Pixmap::new(240, 180).unwrap();
        let t = disegna(&c, &[1.0, 1.0], &mut px);
        assert!(!t.iter().any(|x| x.testo == "50"));
    }
}
