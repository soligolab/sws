//! La tabella del pannello (`table` e `data_log`), disegnata come la disegna
//! il web (1-10-2026, Fase 4 del piano `docs/plans/2026-09-30-predefiniti-espliciti.md`).
//!
//! Il maintainer, al collaudo della Fase 1: «l'oggetto table in LVGL è
//! totalmente diverso da quello che è il web». Era una `lv_table` col tema: tre
//! colonne fisse, intestazioni scritte a mano, la qualità a lettere, niente
//! ordinamento, filtri, soglie per riga, celle scrivibili. Il maintainer ha
//! scelto il disegno in proprio (come trend e barre), con ordinamento, filtri e
//! celle scrivibili; la paginazione del data_log no.
//!
//! Il riferimento è `DataTable.tsx` in modalità compatta e scura, come la usa
//! `SvgCanvas.tsx`: margini 3/6, intestazione #1e293b col testo #94a3b8,
//! righe separate da #1e293b, testo #cbd5e1. Qui c'è la logica pura — righe
//! visibili, ordinamento, filtri, scorrimento, tocchi — provata senza display;
//! `lvgl_render` fornisce le celle già calcolate e scrive i testi.

use resvg::tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Transform};

use crate::trend::{Orizz, Rett, Rgb, Testo, Vert};

#[derive(Debug, Clone, PartialEq)]
pub struct Colonna {
    pub intestazione: String,
    /// Larghezza fissa in px; `None` = si divide lo spazio che resta.
    pub larghezza: Option<f32>,
    pub allinea: Orizz,
    pub ordinabile: bool,
    pub filtrabile: bool,
}

/// Come si ordina una cella: i numeri come numeri, il resto come testo.
#[derive(Debug, Clone, PartialEq)]
pub enum Chiave {
    Numero(f64),
    Testo(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cella {
    pub testo: String,
    pub colore: Rgb,
    /// Il pallino della qualità (al posto del testo).
    pub punto: Option<Rgb>,
    pub chiave: Chiave,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Riga {
    pub celle: Vec<Cella>,
    /// Indice della colonna scrivibile (il valore), se la riga lo è.
    pub scrivibile: Option<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub w: u32,
    pub h: u32,
    pub colonne: Vec<Colonna>,
    pub corpo_px: u16,
    pub sfondo: Rgb,
    pub filtri: bool,
    pub vuoto: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pressione {
    x0: f32,
    y0: f32,
    y: f32,
    scorri0: f32,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Stato {
    /// (colonna, crescente)
    pub ordina: Option<(usize, bool)>,
    pub filtri: Vec<String>,
    pub scorri: f32,
    pressione: Option<Pressione>,
}

/// Dove è finito un tocco: cosa deve fare chi disegna.
#[derive(Debug, Clone, PartialEq)]
pub enum Esito {
    Niente,
    Ridisegna,
    /// Aprire la tastiera per il filtro di questa colonna.
    Filtro(usize),
    /// Aprire il tastierino per scrivere la riga (indice nelle righe date).
    Scrivi(usize),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Bersaglio {
    Intestazione(usize),
    Filtro(usize),
    Valore(usize),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Scena {
    pub testi: Vec<Testo>,
    pub bersagli: Vec<(Rett, Bersaglio)>,
    /// Quanto si può scorrere al massimo.
    pub scorri_max: f32,
}

const INTESTAZIONE_BG: Rgb = (0x1e, 0x29, 0x3b);
const BORDO: Rgb = (0x33, 0x41, 0x55);
const RIGA: Rgb = (0x1e, 0x29, 0x3b);
const FILTRO_BG: Rgb = (0x0f, 0x17, 0x2a);
const TESTO_INT: Rgb = (0x94, 0xa3, 0xb8);
const TESTO_FILTRO: Rgb = (0xe2, 0xe8, 0xf0);
const SOTTILE: Rgb = (0x94, 0xa3, 0xb8);
const PAD_V: f32 = 3.0;
const PAD_O: f32 = 6.0;
const SOGLIA_PX: f32 = 8.0;

impl Config {
    fn riga_h(&self) -> f32 {
        (self.corpo_px as f32 * 1.2).round() + 2.0 * PAD_V
    }
    fn filtro_h(&self) -> f32 {
        if self.filtri && self.colonne.iter().any(|c| c.filtrabile) {
            (self.corpo_px as f32 - 1.0) * 1.2 + 8.0
        } else {
            0.0
        }
    }
    /// Le x di inizio di ogni colonna e la larghezza, dentro il bordo.
    fn colonne_x(&self) -> Vec<(f32, f32)> {
        let interno = self.w as f32 - 2.0;
        let fisse: f32 = self.colonne.iter().filter_map(|c| c.larghezza).sum();
        let libere = self.colonne.iter().filter(|c| c.larghezza.is_none()).count().max(1) as f32;
        let quota = ((interno - fisse) / libere).max(20.0);
        let mut x = 1.0;
        self.colonne
            .iter()
            .map(|c| {
                let w = c.larghezza.unwrap_or(quota);
                let r = (x, w);
                x += w;
                r
            })
            .collect()
    }
}

impl Stato {
    pub fn nuovo(cfg: &Config) -> Stato {
        Stato { filtri: vec![String::new(); cfg.colonne.len()], ..Default::default() }
    }

    /// Le righe da mostrare, filtrate e ordinate: indici nelle righe date.
    pub fn visibili(&self, righe: &[Riga]) -> Vec<usize> {
        let mut v: Vec<usize> = (0..righe.len())
            .filter(|i| {
                self.filtri.iter().enumerate().all(|(c, f)| {
                    f.is_empty()
                        || righe[*i]
                            .celle
                            .get(c)
                            .is_some_and(|cel| cel.testo.to_lowercase().contains(&f.to_lowercase()))
                })
            })
            .collect();
        if let Some((c, cresc)) = self.ordina {
            v.sort_by(|a, b| {
                let (ka, kb) = (righe[*a].celle.get(c).map(|x| &x.chiave), righe[*b].celle.get(c).map(|x| &x.chiave));
                let o = match (ka, kb) {
                    (Some(Chiave::Numero(x)), Some(Chiave::Numero(y))) => x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal),
                    (Some(Chiave::Numero(_)), Some(Chiave::Testo(_))) => std::cmp::Ordering::Less,
                    (Some(Chiave::Testo(_)), Some(Chiave::Numero(_))) => std::cmp::Ordering::Greater,
                    (Some(Chiave::Testo(x)), Some(Chiave::Testo(y))) => x.to_lowercase().cmp(&y.to_lowercase()),
                    _ => std::cmp::Ordering::Equal,
                };
                if cresc { o } else { o.reverse() }
            });
        }
        v
    }

    /// `toggleSort` del web: un'altra colonna → crescente; crescente →
    /// decrescente; decrescente → nessun ordinamento.
    pub fn ordina_per(&mut self, c: usize) {
        self.ordina = match self.ordina {
            Some((k, true)) if k == c => Some((c, false)),
            Some((k, false)) if k == c => None,
            _ => Some((c, true)),
        };
    }

    /// Il tocco è stato perso (il dito è uscito, o un altro oggetto l'ha preso).
    pub fn annulla(&mut self) {
        self.pressione = None;
    }

    pub fn premi(&mut self, x: f32, y: f32) {
        self.pressione = Some(Pressione { x0: x, y0: y, y, scorri0: self.scorri });
    }

    /// Il dito si muove: la tabella scorre (l'intestazione resta ferma).
    pub fn trascina(&mut self, y: f32, scorri_max: f32) -> bool {
        let Some(p) = self.pressione.as_mut() else { return false };
        p.y = y;
        if (y - p.y0).abs() <= SOGLIA_PX {
            return false;
        }
        let nuovo = (p.scorri0 - (y - p.y0)).clamp(0.0, scorri_max.max(0.0));
        let cambiato = nuovo != self.scorri;
        self.scorri = nuovo;
        cambiato
    }

    pub fn rilascia(&mut self, scena: &Scena) -> Esito {
        let Some(p) = self.pressione.take() else { return Esito::Niente };
        if (p.y - p.y0).abs() > SOGLIA_PX {
            return Esito::Niente;
        }
        for (r, b) in &scena.bersagli {
            if p.x0 >= r.x && p.x0 <= r.x + r.w && p.y0 >= r.y && p.y0 <= r.y + r.h {
                return match *b {
                    Bersaglio::Intestazione(c) => {
                        self.ordina_per(c);
                        Esito::Ridisegna
                    }
                    Bersaglio::Filtro(c) => Esito::Filtro(c),
                    Bersaglio::Valore(i) => Esito::Scrivi(i),
                };
            }
        }
        Esito::Niente
    }
}

fn paint(c: Rgb) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(c.0, c.1, c.2, 255);
    p.anti_alias = true;
    p
}

fn rett(px: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, c: Rgb) {
    if let Some(r) = Rect::from_xywh(x, y, w, h) {
        px.fill_rect(r, &paint(c), Transform::identity(), None);
    }
}

fn arrotondato(px: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, r: f32, c: Rgb) {
    let r = r.min(w / 2.0).min(h / 2.0);
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
        px.fill_path(&p, &paint(c), FillRule::Winding, Transform::identity(), None);
    }
}

/// Disegna la tabella in `px` e dice cosa scrivere e dove si può toccare.
/// `misura(testo, px)` serve a tagliare un testo che non entra nella colonna.
pub fn disegna(cfg: &Config, righe: &[Riga], stato: &Stato, px: &mut Pixmap, misura: &dyn Fn(&str, u16) -> f32) -> Scena {
    let (w, h) = (cfg.w as f32, cfg.h as f32);
    let mut sc = Scena::default();
    px.fill(resvg::tiny_skia::Color::TRANSPARENT);
    arrotondato(px, 0.0, 0.0, w, h, 4.0, BORDO);
    arrotondato(px, 1.0, 1.0, w - 2.0, h - 2.0, 3.0, cfg.sfondo);

    let cx = cfg.colonne_x();
    let rh = cfg.riga_h();
    let fh = cfg.filtro_h();
    let testa = 1.0 + rh + fh;
    let corpo = cfg.corpo_px;
    let taglia = |t: &str, larg: f32| -> String {
        if misura(t, corpo) <= larg {
            return t.to_string();
        }
        let mut s: String = t.to_string();
        while !s.is_empty() && misura(&format!("{s}…"), corpo) > larg {
            s.pop();
        }
        format!("{s}…")
    };
    let testo_in = |sc: &mut Scena, c: usize, y_mezzo: f32, t: &str, colore: Rgb| {
        let (x, cw) = cx[c];
        let larg = (cw - 2.0 * PAD_O).max(4.0);
        let (ax, o) = match cfg.colonne[c].allinea {
            Orizz::Sx => (x + PAD_O, Orizz::Sx),
            Orizz::Centro => (x + cw / 2.0, Orizz::Centro),
            Orizz::Dx => (x + cw - PAD_O, Orizz::Dx),
        };
        sc.testi.push(Testo { x: ax, y: y_mezzo, testo: taglia(t, larg), colore, px: corpo, orizz: o, vert: Vert::Mezzo });
    };

    // Il corpo, ritagliato sotto l'intestazione.
    let vis = stato.visibili(righe);
    let altezza_corpo = vis.len() as f32 * rh;
    let spazio = h - testa - 1.0;
    sc.scorri_max = (altezza_corpo - spazio).max(0.0);
    let scorri = stato.scorri.min(sc.scorri_max);
    if vis.is_empty() {
        sc.testi.push(Testo {
            x: w / 2.0,
            y: testa + 16.0 + corpo as f32 / 2.0,
            testo: cfg.vuoto.clone(),
            colore: SOTTILE,
            px: corpo,
            orizz: Orizz::Centro,
            vert: Vert::Mezzo,
        });
    }
    for (k, &i) in vis.iter().enumerate() {
        let y = testa + k as f32 * rh - scorri;
        if y + rh <= testa || y >= h - 1.0 {
            continue;
        }
        // Separatore sotto la riga (il bordo inferiore del web).
        rett(px, 1.0, (y + rh - 1.0).max(testa), w - 2.0, 1.0, RIGA);
        // Una riga tagliata dall'intestazione non si scrive a metà: le
        // etichette LVGL non si ritagliano, e un testo sopra l'intestazione
        // sarebbe peggio di una riga che compare un attimo dopo.
        if y < testa || y + rh > h - 1.0 {
            continue;
        }
        let ym = y + rh / 2.0;
        for (c, cel) in righe[i].celle.iter().enumerate().take(cfg.colonne.len()) {
            match cel.punto {
                Some(col) => {
                    let (x, cw) = cx[c];
                    if let Some(p) = PathBuilder::from_circle(x + cw / 2.0, ym, 4.0) {
                        px.fill_path(&p, &paint(col), FillRule::Winding, Transform::identity(), None);
                    }
                }
                None => testo_in(&mut sc, c, ym, &cel.testo, cel.colore),
            }
        }
        if let Some(c) = righe[i].scrivibile {
            let (x, cw) = cx[c];
            sc.bersagli.push((Rett { x, y, w: cw, h: rh }, Bersaglio::Valore(i)));
        }
    }

    // L'intestazione, ferma sopra il corpo che scorre.
    rett(px, 1.0, 1.0, w - 2.0, rh, INTESTAZIONE_BG);
    rett(px, 1.0, rh, w - 2.0, 1.0, BORDO);
    for (c, col) in cfg.colonne.iter().enumerate() {
        let freccia = match stato.ordina {
            Some((k, true)) if k == c => " ▲",
            Some((k, false)) if k == c => " ▼",
            _ => "",
        };
        testo_in(&mut sc, c, 1.0 + rh / 2.0, &format!("{}{freccia}", col.intestazione), TESTO_INT);
        if col.ordinabile {
            let (x, cw) = cx[c];
            sc.bersagli.push((Rett { x, y: 1.0, w: cw, h: rh }, Bersaglio::Intestazione(c)));
        }
    }
    if fh > 0.0 {
        let y0 = 1.0 + rh;
        rett(px, 1.0, y0, w - 2.0, fh, FILTRO_BG);
        rett(px, 1.0, y0 + fh - 1.0, w - 2.0, 1.0, BORDO);
        for (c, col) in cfg.colonne.iter().enumerate() {
            if !col.filtrabile {
                continue;
            }
            let (x, cw) = cx[c];
            let r = Rett { x: x + 4.0, y: y0 + 2.0, w: cw - 8.0, h: fh - 4.0 };
            arrotondato(px, r.x, r.y, r.w, r.h, 3.0, BORDO);
            arrotondato(px, r.x + 1.0, r.y + 1.0, r.w - 2.0, r.h - 2.0, 2.0, INTESTAZIONE_BG);
            let f = stato.filtri.get(c).cloned().unwrap_or_default();
            if !f.is_empty() {
                sc.testi.push(Testo {
                    x: r.x + 4.0,
                    y: r.y + r.h / 2.0,
                    testo: taglia(&f, r.w - 8.0),
                    colore: TESTO_FILTRO,
                    px: corpo.saturating_sub(1).max(6),
                    orizz: Orizz::Sx,
                    vert: Vert::Mezzo,
                });
            }
            sc.bersagli.push((r, Bersaglio::Filtro(c)));
        }
    }
    sc
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(n: &str, filtrabile: bool) -> Colonna {
        Colonna { intestazione: n.into(), larghezza: None, allinea: Orizz::Sx, ordinabile: true, filtrabile }
    }

    fn cella(t: &str, n: Option<f64>) -> Cella {
        Cella {
            testo: t.into(),
            colore: (1, 1, 1),
            punto: None,
            chiave: n.map(Chiave::Numero).unwrap_or(Chiave::Testo(t.into())),
        }
    }

    fn cfg(filtri: bool) -> Config {
        Config {
            w: 300,
            h: 200,
            colonne: vec![col("DATI", true), col("VALORE", false)],
            corpo_px: 11,
            sfondo: (0x1e, 0x29, 0x3b),
            filtri,
            vuoto: "—".into(),
        }
    }

    fn righe() -> Vec<Riga> {
        vec![
            Riga { celle: vec![cella("Pompa", None), cella("10", Some(10.0))], scrivibile: Some(1) },
            Riga { celle: vec![cella("Valvola", None), cella("2", Some(2.0))], scrivibile: None },
            Riga { celle: vec![cella("pompa due", None), cella("30", Some(30.0))], scrivibile: None },
        ]
    }

    fn misura(t: &str, _: u16) -> f32 {
        t.chars().count() as f32 * 6.0
    }

    #[test]
    fn l_ordinamento_ha_tre_stati_e_i_numeri_si_ordinano_come_numeri() {
        let c = cfg(false);
        let mut s = Stato::nuovo(&c);
        let r = righe();
        s.ordina_per(1);
        assert_eq!(s.visibili(&r), vec![1, 0, 2]);
        s.ordina_per(1);
        assert_eq!(s.visibili(&r), vec![2, 0, 1]);
        s.ordina_per(1);
        assert_eq!(s.visibili(&r), vec![0, 1, 2]);
    }

    #[test]
    fn il_filtro_cerca_senza_maiuscole() {
        let c = cfg(true);
        let mut s = Stato::nuovo(&c);
        s.filtri[0] = "POMPA".into();
        assert_eq!(s.visibili(&righe()), vec![0, 2]);
    }

    #[test]
    fn toccare_l_intestazione_ordina_e_il_valore_scrivibile_apre_il_tastierino() {
        let c = cfg(true);
        let mut s = Stato::nuovo(&c);
        let r = righe();
        let mut px = Pixmap::new(300, 200).unwrap();
        let sc = disegna(&c, &r, &s, &mut px, &misura);
        let (ri, _) = sc.bersagli.iter().find(|(_, b)| *b == Bersaglio::Intestazione(1)).unwrap();
        s.premi(ri.x + 5.0, ri.y + 5.0);
        assert_eq!(s.rilascia(&sc), Esito::Ridisegna);
        assert_eq!(s.ordina, Some((1, true)));
        let (rv, _) = sc.bersagli.iter().find(|(_, b)| *b == Bersaglio::Valore(0)).unwrap();
        s.premi(rv.x + 5.0, rv.y + 5.0);
        assert_eq!(s.rilascia(&sc), Esito::Scrivi(0));
        let (rf, _) = sc.bersagli.iter().find(|(_, b)| *b == Bersaglio::Filtro(0)).unwrap();
        s.premi(rf.x + 5.0, rf.y + 5.0);
        assert_eq!(s.rilascia(&sc), Esito::Filtro(0));
        // Solo le colonne filtrabili hanno la casella del filtro.
        assert!(!sc.bersagli.iter().any(|(_, b)| *b == Bersaglio::Filtro(1)));
    }

    #[test]
    fn trascinare_scorre_e_non_tocca() {
        let mut c = cfg(false);
        c.h = 60;
        let r: Vec<Riga> = (0..20).map(|i| Riga { celle: vec![cella(&format!("r{i}"), None), cella("1", Some(1.0))], scrivibile: None }).collect();
        let mut s = Stato::nuovo(&c);
        let mut px = Pixmap::new(300, 60).unwrap();
        let sc = disegna(&c, &r, &s, &mut px, &misura);
        assert!(sc.scorri_max > 0.0);
        s.premi(50.0, 50.0);
        assert!(s.trascina(10.0, sc.scorri_max));
        assert_eq!(s.scorri, 40.0);
        assert_eq!(s.rilascia(&sc), Esito::Niente);
        // Non oltre la fine.
        s.premi(50.0, 50.0);
        s.trascina(-5000.0, sc.scorri_max);
        assert_eq!(s.scorri, sc.scorri_max);
    }

    #[test]
    fn un_testo_troppo_lungo_si_taglia_coi_puntini() {
        let mut c = cfg(false);
        c.w = 80;
        let r = vec![Riga { celle: vec![cella("Una etichetta lunghissima", None), cella("1", Some(1.0))], scrivibile: None }];
        let mut px = Pixmap::new(80, 200).unwrap();
        let sc = disegna(&c, &r, &Stato::nuovo(&c), &mut px, &misura);
        assert!(sc.testi.iter().any(|t| t.testo.ends_with('…')), "{:?}", sc.testi);
    }

    #[test]
    fn senza_righe_lo_dice() {
        let c = cfg(false);
        let mut px = Pixmap::new(300, 200).unwrap();
        let sc = disegna(&c, &[], &Stato::nuovo(&c), &mut px, &misura);
        assert!(sc.testi.iter().any(|t| t.testo == "—"));
    }
}
