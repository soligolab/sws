//! Il trend del pannello, disegnato come lo disegna il web (30-09-2026).
//!
//! Il maintainer, dopo aver cambiato stile della linea e sfondo di un trend sul
//! WP630: «prendi l'oggetto trend LVGL e completalo di tutte le funzioni».
//! Fino a quel giorno il trend LVGL era un `lv_chart` che onorava il colore
//! delle tracce e il range Y — nient'altro. E non poteva fare molto di più:
//! `lv_chart` ha **uno** stile di linea per tutte le serie, niente
//! riempimenti, niente bande, niente soglie, niente etichette degli assi, e
//! coordinate `i16` — un valore 0,37 finiva disegnato come 0.
//!
//! Qui il grafico si disegna in proprio, **con tiny-skia** (arriva già con
//! resvg, nessuna dipendenza nuova), su un buffer che `lvgl_render` copia in un
//! `lv_canvas`. Le scritte non passano da tiny-skia, che non ha testo: questo
//! modulo dice **cosa** scrivere e **dove** ([`Testo`]), e `lvgl_render` lo
//! scrive con etichette LVGL figlie del canvas, nel font del pannello.
//!
//! Il riferimento è `sws-editor/src/canvas/TrendCanvas.tsx`, passo per passo:
//! stessi margini, stesse divisioni della griglia, stessi colori di ripiego,
//! stesse formule per le scale. Dove il pannello fa diversamente è per il
//! dito al posto del mouse, ed è detto dove succede ([`Stato::premi`]).
//!
//! Tutto ciò che decide qualcosa è puro e provato senza display: layout,
//! scale, formato di data e ora, tocchi. L'unica cosa che richiede LVGL è
//! misurare un testo, e la si riceve come funzione.

use std::collections::HashSet;

use resvg::tiny_skia::{
    self, FillRule, LineJoin, Paint, PathBuilder, Pixmap, PixmapPaint, Rect, Stroke, StrokeDash,
    Transform,
};

pub type Rgb = (u8, u8, u8);

/// `PALETTE` di `TrendCanvas.tsx`.
pub const TAVOLOZZA: [Rgb; 6] = [
    (59, 130, 246),
    (34, 197, 94),
    (234, 179, 8),
    (239, 68, 68),
    (168, 85, 247),
    (6, 182, 212),
];

/// `TREND_FRAME_DEFAULT`: la cornice senza `axis_color`.
const CORNICE: Rgb = (0x33, 0x41, 0x55);
const AMBRA: Rgb = (0xf5, 0x9e, 0x0b);
const ROSSO: Rgb = (0xef, 0x44, 0x44);
const BLU: Rgb = (0x3b, 0x82, 0xf6);

// ── Configurazione ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Tratto {
    Pieno,
    Tratteggio,
    Punti,
}

impl Tratto {
    pub fn da(s: Option<&str>) -> Tratto {
        match s {
            Some("dashed") => Tratto::Tratteggio,
            Some("dotted") => Tratto::Punti,
            _ => Tratto::Pieno,
        }
    }
    /// `DASH_MAP` di `TrendCanvas.tsx`.
    fn schema(self) -> Option<Vec<f32>> {
        match self {
            Tratto::Pieno => None,
            Tratto::Tratteggio => Some(vec![6.0, 3.0]),
            Tratto::Punti => Some(vec![1.0, 3.0]),
        }
    }
}

/// Una traccia, già risolta dal formato nuovo o da quello legacy.
#[derive(Debug, Clone, PartialEq)]
pub struct Traccia {
    pub tag: String,
    pub nome: String,
    pub colore: Rgb,
    pub spessore: f32,
    pub tratto: Tratto,
    pub riempi: bool,
    pub opacita_riempimento: f32,
    pub smussa: bool,
    pub scala_propria: bool,
    /// Visibilità **di partenza**: l'operatore la cambia toccando la legenda.
    pub nascosta: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OrdineData {
    Gma,
    Mga,
    Amg,
}

/// `TrendDateTimeConfig` di `TrendCanvas.tsx`, con gli stessi default.
#[derive(Debug, Clone, PartialEq)]
pub struct FormatoOra {
    pub ordine: OrdineData,
    pub separatore: String,
    pub h12: bool,
    pub secondi: bool,
    pub anno: bool,
    pub due_righe: bool,
    pub sempre_data: bool,
}

impl Default for FormatoOra {
    fn default() -> Self {
        FormatoOra {
            ordine: OrdineData::Gma,
            separatore: "/".into(),
            h12: false,
            secondi: false,
            anno: false,
            due_righe: true,
            sempre_data: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub w: u32,
    pub h: u32,
    pub tracce: Vec<Traccia>,
    pub finestra_s: f64,
    pub y_min: Option<f64>,
    pub y_max: Option<f64>,
    pub formato: FormatoOra,
    pub soglie: bool,
    pub warn_low: Option<f64>,
    pub warn_high: Option<f64>,
    pub alarm_low: Option<f64>,
    pub alarm_high: Option<f64>,
    pub marcatori: bool,
    pub log: bool,
    pub unita: Option<String>,
    pub sfondo: Rgb,
    /// Cornice ed etichette degli assi: `axis_color`, se c'è.
    pub assi: Option<Rgb>,
    /// Le etichette senza `axis_color` (il colore predefinito del tipo).
    pub assi_predefinito: Rgb,
    pub griglia: Rgb,
    pub passo_pan_s: Option<f64>,
    pub lingua: String,
}

impl Config {
    fn n(&self) -> usize {
        self.tracce.len()
    }
    /// Il range Y fisso vale solo con entrambi i limiti e non entrambi zero —
    /// `autoFit` di `TrendCanvas.tsx`.
    fn range_fisso(&self, zoom_y: Option<(f64, f64)>) -> Option<(f64, f64)> {
        if let Some(z) = zoom_y {
            return Some(z);
        }
        match (self.y_min, self.y_max) {
            (Some(lo), Some(hi)) if lo != 0.0 || hi != 0.0 => Some((lo, hi)),
            _ => None,
        }
    }
    fn passo_pan_ms(&self) -> u64 {
        (self.passo_pan_s.unwrap_or(self.finestra_s * 0.25) * 1000.0).round().max(1000.0) as u64
    }
}

// ── Dati ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Campione {
    pub ts: u64,
    /// `None`: un campione che non è un numero — la penna si alza.
    pub v: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Secchio {
    pub ts: u64,
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Marcatore {
    pub ts: u64,
    pub colore: Rgb,
    pub messaggio: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Dati {
    /// Una per traccia, in ordine di tempo.
    pub serie: Vec<Vec<Campione>>,
    /// La banda min/max per traccia, solo quando i dati arrivano a secchi.
    pub bande: Vec<Vec<Secchio>>,
    pub allarmi: Vec<Marcatore>,
}

// ── Stato dell'operatore ────────────────────────────────────────────────────

/// Quale intervallo si guarda.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Vista {
    /// La finestra che scorre con l'ora.
    Diretta,
    /// Spostata indietro coi pulsanti ◀/▶: l'intervallo è fisso.
    Spostata { indietro_ms: u64, da: u64, a: u64 },
    /// Selezionata col dito: tempo, e se la selezione era alta anche Y.
    Zoom { da: u64, a: u64, y: Option<(f64, f64)> },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pressione {
    pub x0: f32,
    pub y0: f32,
    pub x: f32,
    pub y: f32,
    pub dal_ms: u64,
    /// Tenuto fermo abbastanza: il trascinamento seleziona uno zoom invece di
    /// leggere i valori. Vedi [`Stato::premi`].
    pub seleziona: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stato {
    pub nascoste: HashSet<usize>,
    pub vista: Vista,
    pub pressione: Option<Pressione>,
}

/// Soglia di trascinamento di `TrendCanvas.tsx` (`DRAG_THRESHOLD_PX`).
const SOGLIA_PX: f32 = 8.0;
/// Quanto tenere fermo il dito prima che il trascinamento diventi una
/// selezione di zoom.
pub const TENUTA_MS: u64 = 500;
/// I pulsanti disegnati sono quelli del web, piccoli; il bersaglio del dito è
/// più largo di così da ogni lato.
const MARGINE_DITO: f32 = 10.0;

impl Stato {
    pub fn nuovo(cfg: &Config) -> Stato {
        Stato {
            nascoste: cfg
                .tracce
                .iter()
                .enumerate()
                .filter(|(_, t)| t.nascosta)
                .map(|(i, _)| i)
                .collect(),
            vista: Vista::Diretta,
            pressione: None,
        }
    }

    /// L'intervallo di tempo da mostrare e da chiedere allo storico.
    pub fn intervallo(&self, cfg: &Config, ora_ms: u64) -> (u64, u64) {
        match self.vista {
            Vista::Diretta => (ora_ms.saturating_sub((cfg.finestra_s * 1000.0) as u64), ora_ms),
            Vista::Spostata { da, a, .. } | Vista::Zoom { da, a, .. } => (da, a),
        }
    }

    pub fn in_diretta(&self) -> bool {
        self.vista == Vista::Diretta
    }

    /// Il dito si appoggia.
    ///
    /// Sul web il mouse ha due gesti — passarci sopra legge i valori,
    /// trascinare seleziona uno zoom — e il dito ne ha uno solo. Qui:
    /// **trascinare legge** (il gesto che serve di più su un pannello), e
    /// **tenere fermo mezzo secondo e poi trascinare seleziona uno zoom**.
    pub fn premi(&mut self, x: f32, y: f32, ora_ms: u64) {
        self.pressione = Some(Pressione { x0: x, y0: y, x, y, dal_ms: ora_ms, seleziona: false });
    }

    /// Il dito si muove. `true` se c'è da ridisegnare.
    pub fn trascina(&mut self, x: f32, y: f32, ora_ms: u64) -> bool {
        let Some(p) = self.pressione.as_mut() else { return false };
        let fermo = (x - p.x0).abs() <= SOGLIA_PX && (y - p.y0).abs() <= SOGLIA_PX;
        if !p.seleziona && fermo && ora_ms.saturating_sub(p.dal_ms) >= TENUTA_MS {
            p.seleziona = true;
        }
        let cambiato = p.x != x || p.y != y;
        p.x = x;
        p.y = y;
        cambiato
    }

    /// Il dito si alza. Dice cosa è cambiato.
    pub fn rilascia(&mut self, cfg: &Config, scena: &Scena, ora_ms: u64) -> Esito {
        let Some(p) = self.pressione.take() else { return Esito::Niente };
        let dx = (p.x - p.x0).abs();
        let dy = (p.y - p.y0).abs();
        if dx <= SOGLIA_PX && dy <= SOGLIA_PX {
            return self.tocco(cfg, scena, p.x0, p.y0, ora_ms);
        }
        if !p.seleziona {
            // Era una lettura dei valori: finisce col dito.
            return Esito::Ridisegna;
        }
        let Some(d) = scena.dominio else { return Esito::Ridisegna };
        let ts = |x: f32| {
            let f = ((x - d.sx) / d.plot_w).clamp(0.0, 1.0) as f64;
            d.t_min as f64 + f * d.t_span as f64
        };
        let (a, b) = (ts(p.x0), ts(p.x));
        let (da, a_) = (a.min(b) as u64, a.max(b) as u64);
        if a_ <= da + 100 {
            return Esito::Ridisegna;
        }
        let y = if dy > SOGLIA_PX && d.y_invertibile {
            let inv = |py: f32| {
                d.y_lo + ((d.alto + d.plot_h - py) / d.plot_h) as f64 * (d.y_hi - d.y_lo)
            };
            let (v1, v2) = (inv(p.y0), inv(p.y));
            Some((v1.min(v2), v1.max(v2)))
        } else {
            None
        };
        self.vista = Vista::Zoom { da, a: a_, y };
        Esito::NuovoIntervallo
    }

    fn tocco(&mut self, cfg: &Config, scena: &Scena, x: f32, y: f32, ora_ms: u64) -> Esito {
        for (r, i) in &scena.legenda {
            if r.contiene(x, y, 2.0) {
                if !self.nascoste.remove(i) {
                    self.nascoste.insert(*i);
                }
                return Esito::Ridisegna;
            }
        }
        for (r, p) in &scena.pulsanti {
            if !r.contiene(x, y, MARGINE_DITO) {
                continue;
            }
            let passo = cfg.passo_pan_ms();
            let finestra = (cfg.finestra_s * 1000.0) as u64;
            let indietro = match (self.vista, p) {
                (_, Pulsante::Ripristina) => {
                    self.vista = Vista::Diretta;
                    return Esito::NuovoIntervallo;
                }
                (Vista::Diretta, Pulsante::Indietro) => passo,
                (Vista::Spostata { indietro_ms, .. }, Pulsante::Indietro) => indietro_ms + passo,
                (Vista::Spostata { indietro_ms, .. }, Pulsante::Avanti) => indietro_ms.saturating_sub(passo),
                _ => return Esito::Niente,
            };
            self.vista = if indietro == 0 {
                Vista::Diretta
            } else {
                let a = ora_ms.saturating_sub(indietro);
                Vista::Spostata { indietro_ms: indietro, da: a.saturating_sub(finestra), a }
            };
            return Esito::NuovoIntervallo;
        }
        Esito::Niente
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Esito {
    Niente,
    Ridisegna,
    /// Cambia l'intervallo: i dati vanno richiesti di nuovo.
    NuovoIntervallo,
}

// ── Scena: quello che il disegno lascia a chi scrive i testi e ai tocchi ────

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rett {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rett {
    fn contiene(&self, x: f32, y: f32, margine: f32) -> bool {
        x >= self.x - margine
            && x <= self.x + self.w + margine
            && y >= self.y - margine
            && y <= self.y + self.h + margine
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pulsante {
    Indietro,
    Avanti,
    Ripristina,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Orizz {
    Sx,
    Centro,
    Dx,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Vert {
    Alto,
    Mezzo,
    Basso,
}

/// Una scritta: il punto d'aggancio e come si allinea a quel punto, come
/// `textAlign`/`textBaseline` del canvas web.
#[derive(Debug, Clone, PartialEq)]
pub struct Testo {
    pub x: f32,
    pub y: f32,
    pub testo: String,
    pub colore: Rgb,
    pub px: u16,
    pub orizz: Orizz,
    pub vert: Vert,
}

/// La mappatura dell'ultimo disegno, per tradurre un tocco in tempo e valore.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Dominio {
    pub t_min: u64,
    pub t_span: u64,
    pub sx: f32,
    pub plot_w: f32,
    pub alto: f32,
    pub plot_h: f32,
    pub y_lo: f64,
    pub y_hi: f64,
    /// Lo zoom in verticale vale solo sulla scala condivisa lineare.
    pub y_invertibile: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Scena {
    pub testi: Vec<Testo>,
    pub legenda: Vec<(Rett, usize)>,
    pub pulsanti: Vec<(Rett, Pulsante)>,
    pub dominio: Option<Dominio>,
}

// ── Formato dei numeri e delle ore ──────────────────────────────────────────

/// `Number.prototype.toFixed` di JavaScript: la metà si arrotonda lontano da
/// zero (32,5 → «33»), mentre `format!("{:.0}")` di Rust la porta al pari
/// («32»). Una tacca che dice un numero diverso dal web è una divergenza vera.
pub fn to_fixed(v: f64, d: usize) -> String {
    let m = 10f64.powi(d as i32);
    let r = (v * m).round() / m;
    format!("{r:.d$}")
}

/// `fmtValue` di `TrendCanvas.tsx`.
pub fn fmt_valore(v: f64) -> String {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e15 {
        return format!("{}", v as i64);
    }
    if v.abs() >= 1000.0 {
        return to_fixed(v, 0);
    }
    to_fixed(v, 2)
}

/// `fmtOffset` di `TrendCanvas.tsx`: «45s», «12m», «2h05m».
pub fn fmt_scostamento(ms: u64) -> String {
    let tot_min = (ms as f64 / 60000.0).round() as u64;
    if tot_min < 1 {
        return format!("{}s", (ms as f64 / 1000.0).round() as u64);
    }
    if tot_min < 60 {
        return format!("{tot_min}m");
    }
    let (h, m) = (tot_min / 60, tot_min % 60);
    if m == 0 {
        format!("{h}h")
    } else {
        format!("{h}h{m:02}m")
    }
}

/// Un istante nell'ora del pannello.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OraLocale {
    pub anno: i32,
    pub mese: u32,
    pub giorno: u32,
    pub ora: u32,
    pub minuto: u32,
    pub secondo: u32,
}

/// L'ora locale del pannello, dal fuso di sistema.
pub fn ora_locale(ts_ms: u64) -> OraLocale {
    let t = (ts_ms / 1000) as libc::time_t;
    // SAFETY: `localtime_r` scrive solo nella struct che le si passa.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe {
        libc::localtime_r(&t, &mut tm);
    }
    OraLocale {
        anno: tm.tm_year + 1900,
        mese: (tm.tm_mon + 1) as u32,
        giorno: tm.tm_mday as u32,
        ora: tm.tm_hour as u32,
        minuto: tm.tm_min as u32,
        secondo: tm.tm_sec as u32,
    }
}

/// `fmtDateTimeParts` di `TrendCanvas.tsx`: una riga, o due (data sopra, ora
/// sotto) quando si mostra la data e `due_righe` è acceso.
pub fn fmt_data_ora(o: OraLocale, span_ms: u64, f: &FormatoOra) -> (String, Option<String>) {
    let (ore, suffisso) = if f.h12 {
        let s = if o.ora >= 12 { " PM" } else { " AM" };
        let h = o.ora % 12;
        ((if h == 0 { 12 } else { h }).to_string(), s)
    } else {
        (format!("{:02}", o.ora), "")
    };
    let sec = if f.secondi { format!(":{:02}", o.secondo) } else { String::new() };
    let ora = format!("{ore}:{:02}{sec}{suffisso}", o.minuto);
    if !(f.sempre_data || span_ms > 86_400_000) {
        return (ora, None);
    }
    let (g, m, a) = (format!("{:02}", o.giorno), format!("{:02}", o.mese), o.anno.to_string());
    // «ymd» senza anno non ha senso: diventa «mdy», come sul web.
    let ordine = if !f.anno && f.ordine == OrdineData::Amg { OrdineData::Mga } else { f.ordine };
    let campi: Vec<&str> = match (ordine, f.anno) {
        (OrdineData::Amg, _) => vec![&a, &m, &g],
        (OrdineData::Gma, true) => vec![&g, &m, &a],
        (OrdineData::Gma, false) => vec![&g, &m],
        (OrdineData::Mga, true) => vec![&m, &g, &a],
        (OrdineData::Mga, false) => vec![&m, &g],
    };
    let data = campi.join(&f.separatore);
    if f.due_righe {
        (data, Some(ora))
    } else {
        (format!("{data} {ora}"), None)
    }
}

// ── Scale ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
struct Scala {
    lo: f64,
    hi: f64,
    log: bool,
}

impl Scala {
    /// Dal minimo e massimo visti: senza dati 0..1, piatta ±0,5 — come sul web.
    fn da_estremi(lo: f64, hi: f64) -> (f64, f64) {
        let (mut lo, mut hi) = (lo, hi);
        if !lo.is_finite() || !hi.is_finite() {
            lo = 0.0;
            hi = 1.0;
        }
        if lo == hi {
            lo -= 0.5;
            hi += 0.5;
        }
        (lo, hi)
    }
    /// Frazione dal basso (0) all'alto (1).
    fn frazione(&self, v: f64) -> f64 {
        if self.log {
            let (l_lo, l_hi) = (self.lo.log10(), self.hi.log10());
            (v.max(self.lo).log10() - l_lo) / (l_hi - l_lo).max(1e-9)
        } else {
            (v - self.lo) / (self.hi - self.lo).max(1e-9)
        }
    }
    /// Il valore della tacca `i` di 0..=4, dall'alto.
    fn tacca(&self, i: usize) -> f64 {
        if self.log {
            let (l_lo, l_span) = (self.lo.log10(), (self.hi.log10() - self.lo.log10()).max(1e-9));
            10f64.powf(l_lo + l_span * (4 - i) as f64 / 4.0)
        } else {
            self.hi - (self.hi - self.lo) * i as f64 / 4.0
        }
    }
}

fn estremi<'a>(
    campioni: impl Iterator<Item = &'a Campione>,
    secchi: impl Iterator<Item = &'a Secchio>,
) -> (f64, f64) {
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for c in campioni {
        if let Some(v) = c.v {
            lo = lo.min(v);
            hi = hi.max(v);
        }
    }
    // La banda entra nel dominio, o i picchi uscirebbero dal grafico.
    for s in secchi {
        lo = lo.min(s.min);
        hi = hi.max(s.max);
    }
    (lo, hi)
}

// ── Disegno ─────────────────────────────────────────────────────────────────

fn colore(c: Rgb, a: f32) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(c.0, c.1, c.2, (a.clamp(0.0, 1.0) * 255.0).round() as u8);
    p.anti_alias = true;
    p
}

fn tratto(w: f32, schema: Option<Vec<f32>>) -> Stroke {
    let mut s = Stroke { width: w, line_join: LineJoin::Round, ..Default::default() };
    if let Some(d) = schema {
        s.dash = StrokeDash::new(d, 0.0);
    }
    s
}

fn linea(px: &mut Pixmap, x0: f32, y0: f32, x1: f32, y1: f32, c: Rgb, a: f32, st: &Stroke) {
    let mut pb = PathBuilder::new();
    pb.move_to(x0, y0);
    pb.line_to(x1, y1);
    if let Some(p) = pb.finish() {
        px.stroke_path(&p, &colore(c, a), st, Transform::identity(), None);
    }
}

fn rett_pieno(px: &mut Pixmap, r: Rett, c: Rgb, a: f32) {
    if let Some(rr) = Rect::from_xywh(r.x, r.y, r.w, r.h) {
        px.fill_rect(rr, &colore(c, a), Transform::identity(), None);
    }
}

fn rett_bordo(px: &mut Pixmap, r: Rett, c: Rgb, a: f32) {
    if let Some(rr) = Rect::from_xywh(r.x, r.y, r.w, r.h) {
        let p = PathBuilder::from_rect(rr);
        px.stroke_path(&p, &colore(c, a), &tratto(1.0, None), Transform::identity(), None);
    }
}

/// `tracePoints` di `TrendCanvas.tsx`: la smussatura è cosmetica (curve
/// quadratiche sui punti medi), non ricampiona i valori.
fn traccia_punti(pb: &mut PathBuilder, pts: &[(f32, f32)], smussa: bool) {
    pb.move_to(pts[0].0, pts[0].1);
    if !smussa || pts.len() < 3 {
        for p in &pts[1..] {
            pb.line_to(p.0, p.1);
        }
        return;
    }
    for i in 1..pts.len() - 1 {
        let mx = (pts[i].0 + pts[i + 1].0) / 2.0;
        let my = (pts[i].1 + pts[i + 1].1) / 2.0;
        pb.quad_to(pts[i].0, pts[i].1, mx, my);
    }
    let l = pts[pts.len() - 1];
    pb.line_to(l.0, l.1);
}

/// Spezza una serie in tratti continui, alzando la penna sui campioni che non
/// sono numeri (`buildRuns`).
fn tratti(punti: &[Campione], x_at: impl Fn(u64) -> f32, y_at: impl Fn(f64) -> f32) -> Vec<Vec<(f32, f32)>> {
    let mut out = Vec::new();
    let mut cur = Vec::new();
    for c in punti {
        match c.v {
            Some(v) => cur.push((x_at(c.ts), y_at(v))),
            None => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Disegna il trend in `px` (grande `cfg.w`×`cfg.h`) e dice cosa scrivere.
///
/// `misura(testo, px)` è la larghezza di un testo nel font del pannello: serve
/// alla legenda e al riquadro dei valori, che si dimensionano sul testo.
/// `fuso` converte un istante nell'ora del pannello.
#[allow(clippy::too_many_arguments)]
pub fn disegna(
    cfg: &Config,
    dati: &Dati,
    stato: &Stato,
    ora_ms: u64,
    sfondo_img: Option<&Pixmap>,
    px: &mut Pixmap,
    misura: &dyn Fn(&str, u16) -> f32,
    fuso: &dyn Fn(u64) -> OraLocale,
) -> Scena {
    let (w, h) = (cfg.w as f32, cfg.h as f32);
    let mut sc = Scena::default();
    let testo = |sc: &mut Scena, x: f32, y: f32, t: String, c: Rgb, px_: u16, o: Orizz, v: Vert| {
        sc.testi.push(Testo { x, y, testo: t, colore: c, px: px_, orizz: o, vert: v })
    };

    // Sfondo e cornice.
    px.fill(tiny_skia::Color::from_rgba8(cfg.sfondo.0, cfg.sfondo.1, cfg.sfondo.2, 255));
    if let Some(img) = sfondo_img {
        px.draw_pixmap(0, 0, img.as_ref(), &PixmapPaint::default(), Transform::identity(), None);
    }
    rett_bordo(px, Rett { x: 0.5, y: 0.5, w: w - 1.0, h: h - 1.0 }, cfg.assi.unwrap_or(CORNICE), 1.0);

    let pan = !matches!(stato.vista, Vista::Zoom { .. });
    let n = cfg.n();
    let alto = 6.0 + if n > 1 { 14.0 } else { 0.0 };
    let basso_base = 18.0 + if pan { 14.0 } else { 0.0 };
    let proprie: Vec<usize> = (0..n)
        .filter(|i| cfg.tracce[*i].scala_propria && !stato.nascoste.contains(i))
        .collect();
    const COL_W: f32 = 40.0;
    let sx = 6.0 + proprie.len() as f32 * COL_W;
    let plot_w = w - sx - 48.0;
    let (t_min, t_max) = stato.intervallo(cfg, ora_ms);
    let t_span = t_max.saturating_sub(t_min).max(1);

    // I pulsanti del web (DOM sopra il canvas): qui li disegna il canvas.
    pulsanti(cfg, stato, px, &mut sc, w, h, pan);

    let con_dati = dati.serie.iter().any(|s| s.len() >= 2);
    if !con_dati {
        let voce = if cfg.tracce.is_empty() {
            sws_core::testi_sistema::Testo::TrendNessunTag
        } else {
            sws_core::testi_sistema::Testo::TrendInAttesa
        };
        testo(
            &mut sc,
            w / 2.0,
            h / 2.0,
            sws_core::testi_sistema::testo(voce, &cfg.lingua).into(),
            (0x47, 0x55, 0x69),
            11,
            Orizz::Centro,
            Vert::Basso,
        );
        return sc;
    }

    // Scala condivisa: solo le tracce visibili senza scala propria.
    let condivise: Vec<usize> = (0..n).filter(|i| !proprie.contains(i) && !stato.nascoste.contains(i)).collect();
    let zoom_y = match stato.vista {
        Vista::Zoom { y, .. } => y,
        _ => None,
    };
    let (y_lo, y_hi) = match cfg.range_fisso(zoom_y) {
        Some((lo, hi)) => Scala::da_estremi(lo, hi),
        None => {
            let (lo, hi) = estremi(
                condivise.iter().flat_map(|i| dati.serie.get(*i).into_iter().flatten()),
                condivise.iter().flat_map(|i| dati.bande.get(*i).into_iter().flatten()),
            );
            Scala::da_estremi(lo, hi)
        }
    };
    let usa_log = cfg.log && y_lo > 0.0 && y_hi > y_lo;
    let condivisa = Scala { lo: y_lo, hi: y_hi, log: usa_log };
    let scale_proprie: Vec<(usize, Scala)> = proprie
        .iter()
        .map(|i| {
            let (lo, hi) = estremi(
                dati.serie.get(*i).into_iter().flatten(),
                dati.bande.get(*i).into_iter().flatten(),
            );
            let (lo, hi) = Scala::da_estremi(lo, hi);
            (*i, Scala { lo, hi, log: false })
        })
        .collect();
    let scala_di = |i: usize| scale_proprie.iter().find(|(j, _)| *j == i).map(|(_, s)| *s).unwrap_or(condivisa);

    let mostra_data = cfg.formato.sempre_data || t_span > 86_400_000;
    let riga_h = 11.0;
    let basso = basso_base + if mostra_data && cfg.formato.due_righe { riga_h } else { 0.0 };
    let plot_h = h - alto - basso;
    let x_at = |ts: u64| sx + ((ts as f64 - t_min as f64) / t_span as f64) as f32 * plot_w;
    let y_con = |s: Scala| move |v: f64| alto + plot_h - s.frazione(v) as f32 * plot_h;
    sc.dominio = Some(Dominio {
        t_min,
        t_span,
        sx,
        plot_w,
        alto,
        plot_h,
        y_lo,
        y_hi,
        y_invertibile: !condivise.is_empty() && !usa_log,
    });

    // Griglia: 4 divisioni per lato.
    let st1 = tratto(1.0, None);
    for i in 1..4 {
        let y = alto + plot_h * i as f32 / 4.0;
        linea(px, sx, y, sx + plot_w, y, cfg.griglia, 1.0, &st1);
        let x = sx + plot_w * i as f32 / 4.0;
        linea(px, x, alto, x, alto + plot_h, cfg.griglia, 1.0, &st1);
    }

    let col_assi = cfg.assi.unwrap_or(cfg.assi_predefinito);
    // Asse Y condiviso, a destra — solo se qualcuno lo usa.
    if !condivise.is_empty() {
        for i in 0..=4 {
            let y = alto + plot_h * i as f32 / 4.0;
            let mut t = fmt_valore(condivisa.tacca(i));
            if i == 0 {
                if let Some(u) = cfg.unita.as_deref().filter(|u| !u.is_empty()) {
                    t = format!("{t} {u}");
                }
            }
            testo(&mut sc, sx + plot_w + 4.0, y, t, col_assi, 10, Orizz::Sx, Vert::Mezzo);
        }
    }
    // Una colonna a sinistra per ogni traccia con scala propria, nel suo colore.
    for (col, (i, s)) in scale_proprie.iter().enumerate() {
        let x_dx = 6.0 + (col as f32 + 1.0) * COL_W - 4.0;
        for k in 0..=4 {
            let y = alto + plot_h * k as f32 / 4.0;
            testo(&mut sc, x_dx, y, fmt_valore(s.tacca(k)), cfg.tracce[*i].colore, 10, Orizz::Dx, Vert::Mezzo);
        }
    }
    // Asse dei tempi.
    for i in 0..=4 {
        let ts = t_min + t_span * i / 4;
        let x = sx + plot_w * i as f32 / 4.0;
        let o = match i {
            0 => Orizz::Sx,
            4 => Orizz::Dx,
            _ => Orizz::Centro,
        };
        let (r1, r2) = fmt_data_ora(fuso(ts), t_span, &cfg.formato);
        testo(&mut sc, x, alto + plot_h + 3.0, r1, col_assi, 10, o, Vert::Alto);
        if let Some(r2) = r2 {
            testo(&mut sc, x, alto + plot_h + 3.0 + riga_h, r2, col_assi, 10, o, Vert::Alto);
        }
    }

    // Soglie di avviso e d'allarme, sulla scala condivisa.
    if cfg.soglie && !condivise.is_empty() {
        let st = tratto(1.0, Some(vec![5.0, 4.0]));
        let y_at = y_con(condivisa);
        for (v, c) in [
            (cfg.warn_low, AMBRA),
            (cfg.warn_high, AMBRA),
            (cfg.alarm_low, ROSSO),
            (cfg.alarm_high, ROSSO),
        ] {
            let Some(v) = v else { continue };
            let y = y_at(v);
            if y < alto || y > alto + plot_h {
                continue;
            }
            linea(px, sx, y, sx + plot_w, y, c, 1.0, &st);
        }
    }

    // Tutto ciò che sta nell'area del grafico si ritaglia lì dentro: un
    // campione appena fuori finestra non deve sporcare gli assi.
    let maschera = {
        let mut m = tiny_skia::Mask::new(cfg.w, cfg.h);
        if let (Some(m), Some(r)) = (m.as_mut(), Rect::from_xywh(sx, alto, plot_w.max(1.0), plot_h.max(1.0))) {
            m.fill_path(&PathBuilder::from_rect(r), FillRule::Winding, true, Transform::identity());
        }
        m
    };
    let maschera = maschera.as_ref();

    // Banda min/max dei dati a secchi.
    for (i, secchi) in dati.bande.iter().enumerate() {
        if secchi.len() < 2 || stato.nascoste.contains(&i) || i >= n {
            continue;
        }
        let y_at = y_con(scala_di(i));
        let mut pb = PathBuilder::new();
        pb.move_to(x_at(secchi[0].ts), y_at(secchi[0].max));
        for s in &secchi[1..] {
            pb.line_to(x_at(s.ts), y_at(s.max));
        }
        for s in secchi.iter().rev() {
            pb.line_to(x_at(s.ts), y_at(s.min));
        }
        pb.close();
        if let Some(p) = pb.finish() {
            px.fill_path(&p, &colore(cfg.tracce[i].colore, 0.16), FillRule::Winding, Transform::identity(), maschera);
        }
    }

    // Le linee, con riempimento sotto se chiesto.
    for (i, punti) in dati.serie.iter().enumerate() {
        if punti.is_empty() || stato.nascoste.contains(&i) || i >= n {
            continue;
        }
        let tr = &cfg.tracce[i];
        let runs = tratti(punti, x_at, y_con(scala_di(i)));
        if tr.riempi {
            for run in runs.iter().filter(|r| r.len() >= 2) {
                let mut pb = PathBuilder::new();
                traccia_punti(&mut pb, run, tr.smussa);
                pb.line_to(run[run.len() - 1].0, alto + plot_h);
                pb.line_to(run[0].0, alto + plot_h);
                pb.close();
                if let Some(p) = pb.finish() {
                    px.fill_path(&p, &colore(tr.colore, tr.opacita_riempimento), FillRule::Winding, Transform::identity(), maschera);
                }
            }
        }
        let st = tratto(tr.spessore, tr.tratto.schema());
        for run in runs.iter().filter(|r| r.len() >= 2) {
            let mut pb = PathBuilder::new();
            traccia_punti(&mut pb, run, tr.smussa);
            if let Some(p) = pb.finish() {
                px.stroke_path(&p, &colore(tr.colore, 1.0), &st, Transform::identity(), maschera);
            }
        }
    }

    // Marcatori degli allarmi: una verticale tratteggiata e un triangolo in alto.
    if cfg.marcatori {
        let st = tratto(1.0, Some(vec![2.0, 3.0]));
        for m in &dati.allarmi {
            if m.ts < t_min || m.ts > t_max {
                continue;
            }
            let x = x_at(m.ts);
            linea(px, x, alto, x, alto + plot_h, m.colore, 0.55, &st);
            let mut pb = PathBuilder::new();
            pb.move_to(x - 4.0, alto);
            pb.line_to(x + 4.0, alto);
            pb.line_to(x, alto + 6.0);
            pb.close();
            if let Some(p) = pb.finish() {
                px.fill_path(&p, &colore(m.colore, 1.0), FillRule::Winding, Transform::identity(), None);
            }
        }
    }

    // Legenda, con più di una traccia: si tocca per nascondere o mostrare.
    if n > 1 {
        let mut cx = sx + 2.0;
        let cy = alto - 8.0;
        for (i, tr) in cfg.tracce.iter().enumerate() {
            let nascosta = stato.nascoste.contains(&i);
            rett_pieno(px, Rett { x: cx, y: cy - 4.0, w: 8.0, h: 8.0 }, if nascosta { CORNICE } else { tr.colore }, 1.0);
            let c = if nascosta { (0x47, 0x55, 0x69) } else { (0xcb, 0xd5, 0xe1) };
            testo(&mut sc, cx + 12.0, cy, tr.nome.clone(), c, 10, Orizz::Sx, Vert::Mezzo);
            let lw = misura(&tr.nome, 10);
            sc.legenda.push((Rett { x: cx, y: cy - 7.0, w: 12.0 + lw, h: 14.0 }, i));
            cx += 12.0 + lw + 12.0;
        }
    }

    // Il dito sul grafico.
    let lettura = stato.pressione.filter(|p| !p.seleziona);
    if let Some(p) = stato.pressione.filter(|p| p.seleziona) {
        let x0 = sx.max(p.x0.min(p.x));
        let x1 = (sx + plot_w).min(p.x0.max(p.x));
        let (ry0, ry1) = (p.y0.min(p.y), p.y0.max(p.y));
        let alta = ry1 - ry0 > SOGLIA_PX;
        let y0 = if alta { alto.max(ry0) } else { alto };
        let y1 = if alta { (alto + plot_h).min(ry1) } else { alto + plot_h };
        if x1 > x0 && y1 > y0 {
            let r = Rett { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            rett_pieno(px, r, BLU, 0.18);
            rett_bordo(px, Rett { x: x0 + 0.5, y: y0 + 0.5, w: r.w - 1.0, h: r.h - 1.0 }, BLU, 1.0);
        }
    }
    if let Some(p) = lettura.filter(|p| p.x >= sx && p.x <= sx + plot_w) {
        leggi(cfg, dati, stato, px, &mut sc, p.x, t_min, t_span, x_at, &scala_di, y_con, misura, fuso);
    } else if stato.pressione.is_none() && n == 1 {
        // Il valore corrente in alto a destra, con una traccia sola.
        if let Some(v) = dati.serie.first().and_then(|s| s.last()).and_then(|c| c.v) {
            testo(&mut sc, sx + plot_w - 4.0, alto + 4.0, fmt_valore(v), (0x94, 0xa3, 0xb8), 11, Orizz::Dx, Vert::Alto);
        }
    }
    sc
}

/// Il mirino e il riquadro dei valori sotto il dito — il passaggio del mouse
/// del web.
#[allow(clippy::too_many_arguments)]
fn leggi<Y: Fn(f64) -> f32>(
    cfg: &Config,
    dati: &Dati,
    stato: &Stato,
    px: &mut Pixmap,
    sc: &mut Scena,
    x: f32,
    t_min: u64,
    t_span: u64,
    x_at: impl Fn(u64) -> f32,
    scala_di: &dyn Fn(usize) -> Scala,
    y_con: impl Fn(Scala) -> Y,
    misura: &dyn Fn(&str, u16) -> f32,
    fuso: &dyn Fn(u64) -> OraLocale,
) {
    let Some(d) = sc.dominio else { return };
    linea(px, x, d.alto, x, d.alto + d.plot_h, (0x47, 0x55, 0x69), 1.0, &tratto(1.0, Some(vec![3.0, 3.0])));
    let ts = t_min as f64 + ((x - d.sx) / d.plot_w) as f64 * t_span as f64;
    let mut righe: Vec<(String, Rgb)> = Vec::new();
    let (r1, r2) = fmt_data_ora(fuso(ts.max(0.0) as u64), t_span, &cfg.formato);
    righe.push((r1, (0x94, 0xa3, 0xb8)));
    if let Some(r2) = r2 {
        righe.push((r2, (0x94, 0xa3, 0xb8)));
    }
    let mut colpi = 0;
    for (i, punti) in dati.serie.iter().enumerate() {
        if punti.is_empty() || stato.nascoste.contains(&i) || i >= cfg.n() {
            continue;
        }
        let Some(best) = punti.iter().min_by(|a, b| {
            (a.ts as f64 - ts).abs().partial_cmp(&(b.ts as f64 - ts).abs()).unwrap_or(std::cmp::Ordering::Equal)
        }) else {
            continue;
        };
        let Some(v) = best.v else { continue };
        let tr = &cfg.tracce[i];
        let y = y_con(scala_di(i))(v);
        if let Some(c) = PathBuilder::from_circle(x_at(best.ts), y, 3.0) {
            px.fill_path(&c, &colore(tr.colore, 1.0), FillRule::Winding, Transform::identity(), None);
        }
        righe.push((format!("{}: {}", tr.nome, fmt_valore(v)), tr.colore));
        colpi += 1;
    }
    if cfg.marcatori {
        for m in &dati.allarmi {
            if (x_at(m.ts) - x).abs() < 5.0 {
                righe.push((format!("⚠ {}", m.messaggio), m.colore));
            }
        }
    }
    if colpi == 0 {
        return;
    }
    let riga = 14.0;
    let bw = righe.iter().map(|(t, _)| misura(t, 11)).fold(0.0, f32::max) + 16.0;
    let bh = righe.len() as f32 * riga + 8.0;
    let mut bx = x + 8.0;
    if bx + bw > d.sx + d.plot_w {
        bx = x - bw - 8.0;
    }
    let by = (d.alto + 8.0).min(d.alto + d.plot_h - bh - 2.0).max(d.alto + 2.0);
    rett_pieno(px, Rett { x: bx, y: by, w: bw, h: bh }, (0x0f, 0x17, 0x2a), 0xee as f32 / 255.0);
    rett_bordo(px, Rett { x: bx + 0.5, y: by + 0.5, w: bw - 1.0, h: bh - 1.0 }, CORNICE, 1.0);
    for (k, (t, c)) in righe.into_iter().enumerate() {
        sc.testi.push(Testo {
            x: bx + 8.0,
            y: by + 4.0 + k as f32 * riga,
            testo: t,
            colore: c,
            px: 11,
            orizz: Orizz::Sx,
            vert: Vert::Alto,
        });
    }
}

/// ◀ ▶ e lo scostamento in basso, ⟲ in alto quando c'è uno zoom: gli stessi
/// posti e colori dei pulsanti del web.
fn pulsanti(cfg: &Config, stato: &Stato, px: &mut Pixmap, sc: &mut Scena, w: f32, h: f32, pan: bool) {
    let (bg, bordo, fg) = ((0x1e, 0x29, 0x3b), CORNICE, (0x64, 0x74, 0x8b));
    let (bw, bh) = (18.0, 16.0);
    let tasto = |px: &mut Pixmap, r: Rett, attivo: bool| {
        let a = if attivo { 0.7 } else { 0.4 };
        rett_pieno(px, r, bg, a);
        rett_bordo(px, Rett { x: r.x + 0.5, y: r.y + 0.5, w: r.w - 1.0, h: r.h - 1.0 }, bordo, a);
    };
    let freccia = |px: &mut Pixmap, r: Rett, verso: f32, c: Rgb, a: f32| {
        let (cx, cy) = (r.x + r.w / 2.0, r.y + r.h / 2.0);
        let mut pb = PathBuilder::new();
        pb.move_to(cx - 3.0 * verso, cy);
        pb.line_to(cx + 3.0 * verso, cy - 4.0);
        pb.line_to(cx + 3.0 * verso, cy + 4.0);
        pb.close();
        if let Some(p) = pb.finish() {
            px.fill_path(&p, &colore(c, a), FillRule::Winding, Transform::identity(), None);
        }
    };
    if pan {
        let indietro = Rett { x: 4.0, y: h - 4.0 - bh, w: bw, h: bh };
        tasto(px, indietro, true);
        freccia(px, indietro, 1.0, fg, 1.0);
        sc.pulsanti.push((indietro, Pulsante::Indietro));
        let spostato = match stato.vista {
            Vista::Spostata { indietro_ms, .. } => Some(indietro_ms),
            _ => None,
        };
        let avanti = Rett { x: w - 4.0 - bw, y: h - 4.0 - bh, w: bw, h: bh };
        tasto(px, avanti, spostato.is_some());
        freccia(px, avanti, -1.0, if spostato.is_some() { fg } else { CORNICE }, 1.0);
        sc.pulsanti.push((avanti, Pulsante::Avanti));
        if let Some(ms) = spostato {
            sc.testi.push(Testo {
                x: w / 2.0,
                y: h - 4.0 - bh / 2.0,
                testo: format!("-{}", fmt_scostamento(ms)),
                colore: fg,
                px: 10,
                orizz: Orizz::Centro,
                vert: Vert::Mezzo,
            });
        }
    } else {
        // ⟲: un arco con la punta, disegnato — il glifo non è in tutti i font.
        let r = Rett { x: w - 4.0 - bw, y: 4.0, w: bw, h: bh };
        tasto(px, r, true);
        let (cx, cy, rr) = (r.x + r.w / 2.0, r.y + r.h / 2.0, 4.5);
        let mut pb = PathBuilder::new();
        let passi = 12;
        for k in 0..=passi {
            let a = std::f32::consts::PI * (0.35 + 1.5 * k as f32 / passi as f32);
            let (x, y) = (cx + rr * a.cos(), cy - rr * a.sin());
            if k == 0 {
                pb.move_to(x, y);
            } else {
                pb.line_to(x, y);
            }
        }
        if let Some(p) = pb.finish() {
            px.stroke_path(&p, &colore(fg, 1.0), &tratto(1.4, None), Transform::identity(), None);
        }
        let a = std::f32::consts::PI * 0.35;
        let (x, y) = (cx + rr * a.cos(), cy - rr * a.sin());
        let mut pb = PathBuilder::new();
        pb.move_to(x + 2.5, y - 1.5);
        pb.line_to(x, y);
        pb.line_to(x - 2.5, y - 2.5);
        if let Some(p) = pb.finish() {
            px.stroke_path(&p, &colore(fg, 1.0), &tratto(1.4, None), Transform::identity(), None);
        }
        sc.pulsanti.push((r, Pulsante::Ripristina));
    }
    let _ = cfg;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn traccia(tag: &str, colore: Rgb) -> Traccia {
        Traccia {
            tag: tag.into(),
            nome: tag.into(),
            colore,
            spessore: 1.5,
            tratto: Tratto::Pieno,
            riempi: false,
            opacita_riempimento: 0.15,
            smussa: false,
            scala_propria: false,
            nascosta: false,
        }
    }

    fn cfg(tracce: Vec<Traccia>) -> Config {
        Config {
            w: 360,
            h: 180,
            tracce,
            finestra_s: 60.0,
            y_min: None,
            y_max: None,
            formato: FormatoOra::default(),
            soglie: false,
            warn_low: None,
            warn_high: None,
            alarm_low: None,
            alarm_high: None,
            marcatori: false,
            log: false,
            unita: None,
            sfondo: (0x0f, 0x17, 0x2a),
            assi: None,
            assi_predefinito: (0x64, 0x74, 0x8b),
            griglia: (0x1e, 0x29, 0x3b),
            passo_pan_s: None,
            lingua: "it".into(),
        }
    }

    fn misura(t: &str, _px: u16) -> f32 {
        t.chars().count() as f32 * 6.0
    }

    fn utc(ts: u64) -> OraLocale {
        let s = ts / 1000;
        OraLocale {
            anno: 2026,
            mese: 9,
            giorno: 30,
            ora: ((s / 3600) % 24) as u32,
            minuto: ((s / 60) % 60) as u32,
            secondo: (s % 60) as u32,
        }
    }

    fn rampa(da: u64, n: u64, passo: u64, v0: f64) -> Vec<Campione> {
        (0..n).map(|i| Campione { ts: da + i * passo, v: Some(v0 + i as f64) }).collect()
    }

    fn pixel(px: &Pixmap, x: u32, y: u32) -> (u8, u8, u8) {
        let p = px.pixel(x, y).unwrap().demultiply();
        (p.red(), p.green(), p.blue())
    }

    const ORA: u64 = 1_000_000_000;

    #[test]
    fn i_numeri_come_sul_web() {
        assert_eq!(fmt_valore(5.0), "5");
        assert_eq!(fmt_valore(-12.0), "-12");
        assert_eq!(fmt_valore(0.375), "0.38");
        assert_eq!(fmt_valore(1234.56), "1235");
        // La metà lontano da zero, come `toFixed`: «33», non «32».
        assert_eq!(to_fixed(32.5, 0), "33");
        assert_eq!(to_fixed(0.125, 2), "0.13");
        assert_eq!(fmt_scostamento(25_000), "25s");
        // Come `Math.round` del web: 45 s sono già «1m».
        assert_eq!(fmt_scostamento(45_000), "1m");
        assert_eq!(fmt_scostamento(12 * 60_000), "12m");
        assert_eq!(fmt_scostamento(125 * 60_000), "2h05m");
        assert_eq!(fmt_scostamento(120 * 60_000), "2h");
    }

    #[test]
    fn data_e_ora_seguono_la_configurazione() {
        let o = OraLocale { anno: 2026, mese: 9, giorno: 3, ora: 14, minuto: 5, secondo: 9 };
        let f = FormatoOra::default();
        // Finestra corta: solo l'ora.
        assert_eq!(fmt_data_ora(o, 60_000, &f), ("14:05".into(), None));
        // Oltre le 24 ore compare la data, sopra l'ora.
        assert_eq!(fmt_data_ora(o, 90_000_000, &f), ("03/09".into(), Some("14:05".into())));
        let f2 = FormatoOra { h12: true, secondi: true, anno: true, due_righe: false, sempre_data: true, ordine: OrdineData::Amg, separatore: "-".into() };
        assert_eq!(fmt_data_ora(o, 60_000, &f2), ("2026-09-03 2:05:09 PM".into(), None));
        // «ymd» senza anno diventa «mdy», come sul web.
        let f3 = FormatoOra { ordine: OrdineData::Amg, sempre_data: true, due_righe: false, ..FormatoOra::default() };
        assert_eq!(fmt_data_ora(o, 60_000, &f3).0, "09/03 14:05");
    }

    #[test]
    fn senza_tracce_o_senza_dati_lo_dice() {
        let mut px = Pixmap::new(360, 180).unwrap();
        let c = cfg(vec![]);
        let sc = disegna(&c, &Dati::default(), &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        assert!(sc.testi.iter().any(|t| t.testo == "Tag non configurato"));
        let c = cfg(vec![traccia("a", BLU)]);
        let sc = disegna(&c, &Dati { serie: vec![vec![]], ..Default::default() }, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        assert!(sc.testi.iter().any(|t| t.testo.starts_with("In attesa")));
    }

    #[test]
    fn lo_sfondo_e_la_linea_hanno_i_colori_del_progetto() {
        // Il difetto del WP630: sfondo e stile della linea non cambiavano.
        let mut c = cfg(vec![Traccia { spessore: 4.0, ..traccia("a", (255, 0, 0)) }]);
        c.sfondo = (0x20, 0x40, 0x10);
        c.y_min = Some(0.0);
        c.y_max = Some(100.0);
        let dati = Dati { serie: vec![vec![Campione { ts: ORA - 60_000, v: Some(50.0) }, Campione { ts: ORA, v: Some(50.0) }]], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        assert_eq!(pixel(&px, 150, 30), (0x20, 0x40, 0x10));
        let d = sc.dominio.unwrap();
        let y = (d.alto + d.plot_h / 2.0) as u32;
        assert_eq!(pixel(&px, 150, y), (255, 0, 0));
    }

    #[test]
    fn il_tratteggio_lascia_buchi_e_il_pieno_no() {
        let conta = |t: Tratto| {
            let mut c = cfg(vec![Traccia { tratto: t, spessore: 2.0, ..traccia("a", (255, 0, 0)) }]);
            c.y_min = Some(0.0);
            c.y_max = Some(100.0);
            let dati = Dati { serie: vec![vec![Campione { ts: ORA - 60_000, v: Some(50.0) }, Campione { ts: ORA, v: Some(50.0) }]], ..Default::default() };
            let mut px = Pixmap::new(360, 180).unwrap();
            let sc = disegna(&c, &dati, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
            let d = sc.dominio.unwrap();
            let y = (d.alto + d.plot_h / 2.0) as u32;
            (d.sx as u32 + 2..(d.sx + d.plot_w) as u32 - 2).filter(|x| pixel(&px, *x, y).0 > 200).count() as f32
                / (d.plot_w - 4.0)
        };
        assert!(conta(Tratto::Pieno) > 0.95);
        let t = conta(Tratto::Tratteggio);
        assert!(t > 0.5 && t < 0.8, "{t}");
        assert!(conta(Tratto::Punti) < 0.45);
    }

    #[test]
    fn il_riempimento_colora_sotto_la_curva() {
        let mut c = cfg(vec![Traccia { riempi: true, opacita_riempimento: 1.0, ..traccia("a", (255, 0, 0)) }]);
        c.y_min = Some(0.0);
        c.y_max = Some(100.0);
        let dati = Dati { serie: vec![vec![Campione { ts: ORA - 60_000, v: Some(50.0) }, Campione { ts: ORA, v: Some(50.0) }]], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        let d = sc.dominio.unwrap();
        let sotto = (d.alto + d.plot_h * 0.8) as u32;
        let sopra = (d.alto + d.plot_h * 0.2) as u32;
        assert_eq!(pixel(&px, 150, sotto), (255, 0, 0));
        assert_ne!(pixel(&px, 150, sopra), (255, 0, 0));
    }

    #[test]
    fn i_valori_decimali_non_si_arrotondano_all_intero() {
        // `lv_chart` aveva coordinate i16: 0,2 e 0,8 finivano entrambi a 0 o 1.
        let c = cfg(vec![traccia("a", BLU)]);
        let dati = Dati { serie: vec![vec![Campione { ts: ORA - 60_000, v: Some(0.2) }, Campione { ts: ORA, v: Some(0.8) }]], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        let d = sc.dominio.unwrap();
        assert_eq!((d.y_lo, d.y_hi), (0.2, 0.8));
        assert!(sc.testi.iter().any(|t| t.testo == "0.80"));
    }

    #[test]
    fn scala_propria_ha_la_sua_colonna_e_l_unita_sta_in_cima() {
        let mut c = cfg(vec![traccia("a", BLU), Traccia { scala_propria: true, ..traccia("b", (255, 0, 0)) }]);
        c.unita = Some("°C".into());
        let dati = Dati { serie: vec![rampa(ORA - 50_000, 10, 5000, 0.0), rampa(ORA - 50_000, 10, 5000, 200.0)], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        assert_eq!(sc.dominio.unwrap().sx, 46.0);
        assert!(sc.testi.iter().any(|t| t.testo == "9 °C"));
        assert!(sc.testi.iter().any(|t| t.testo == "209" && t.colore == (255, 0, 0)));
    }

    #[test]
    fn la_legenda_si_tocca_e_nasconde_la_traccia() {
        let c = cfg(vec![traccia("a", BLU), traccia("b", (255, 0, 0))]);
        let mut st = Stato::nuovo(&c);
        let dati = Dati { serie: vec![rampa(ORA - 50_000, 10, 5000, 0.0), rampa(ORA - 50_000, 10, 5000, 100.0)], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &st, ORA, None, &mut px, &misura, &utc);
        let (r, i) = sc.legenda[1];
        assert_eq!(i, 1);
        st.premi(r.x + 3.0, r.y + 5.0, ORA);
        assert_eq!(st.rilascia(&c, &sc, ORA), Esito::Ridisegna);
        assert!(st.nascoste.contains(&1));
        // Nascosta, non conta più per la scala condivisa.
        let sc = disegna(&c, &dati, &st, ORA, None, &mut px, &misura, &utc);
        assert_eq!(sc.dominio.unwrap().y_hi, 9.0);
    }

    #[test]
    fn la_visibilita_di_partenza_viene_dal_progetto() {
        let c = cfg(vec![traccia("a", BLU), Traccia { nascosta: true, ..traccia("b", BLU) }]);
        assert!(Stato::nuovo(&c).nascoste.contains(&1));
    }

    #[test]
    fn indietro_e_avanti_spostano_la_finestra() {
        let c = cfg(vec![traccia("a", BLU)]);
        let mut st = Stato::nuovo(&c);
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &Dati::default(), &st, ORA, None, &mut px, &misura, &utc);
        let (ind, _) = sc.pulsanti.iter().find(|(_, p)| *p == Pulsante::Indietro).unwrap();
        st.premi(ind.x + 2.0, ind.y + 2.0, ORA);
        assert_eq!(st.rilascia(&c, &sc, ORA), Esito::NuovoIntervallo);
        // Il passo di default è un quarto della finestra.
        assert_eq!(st.intervallo(&c, ORA), (ORA - 15_000 - 60_000, ORA - 15_000));
        let sc = disegna(&c, &Dati::default(), &st, ORA, None, &mut px, &misura, &utc);
        assert!(sc.testi.iter().any(|t| t.testo == "-15s"));
        let (av, _) = sc.pulsanti.iter().find(|(_, p)| *p == Pulsante::Avanti).unwrap();
        st.premi(av.x + 2.0, av.y + 2.0, ORA);
        st.rilascia(&c, &sc, ORA);
        assert!(st.in_diretta());
    }

    #[test]
    fn trascinare_legge_i_valori_e_non_zooma() {
        let c = cfg(vec![traccia("a", BLU)]);
        let mut st = Stato::nuovo(&c);
        let dati = Dati { serie: vec![rampa(ORA - 55_000, 12, 5000, 0.0)], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        st.premi(100.0, 80.0, ORA);
        st.trascina(160.0, 80.0, ORA + 50);
        let sc = disegna(&c, &dati, &st, ORA, None, &mut px, &misura, &utc);
        assert!(sc.testi.iter().any(|t| t.testo.starts_with("a: ")), "{:?}", sc.testi);
        assert_eq!(st.rilascia(&c, &sc, ORA), Esito::Ridisegna);
        assert!(st.in_diretta());
    }

    #[test]
    fn tenere_fermo_e_poi_trascinare_fa_lo_zoom() {
        let c = cfg(vec![traccia("a", BLU)]);
        let mut st = Stato::nuovo(&c);
        let dati = Dati { serie: vec![rampa(ORA - 55_000, 12, 5000, 0.0)], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &st, ORA, None, &mut px, &misura, &utc);
        let d = sc.dominio.unwrap();
        st.premi(d.sx + d.plot_w * 0.25, 80.0, ORA);
        st.trascina(d.sx + d.plot_w * 0.25, 80.0, ORA + TENUTA_MS);
        st.trascina(d.sx + d.plot_w * 0.75, 82.0, ORA + TENUTA_MS + 100);
        assert_eq!(st.rilascia(&c, &sc, ORA), Esito::NuovoIntervallo);
        match st.vista {
            Vista::Zoom { da, a, y } => {
                assert_eq!((da, a), (ORA - 45_000, ORA - 15_000));
                assert_eq!(y, None);
            }
            v => panic!("{v:?}"),
        }
        // Con lo zoom: niente ◀/▶, c'è ⟲ che torna in diretta.
        let sc = disegna(&c, &dati, &st, ORA, None, &mut px, &misura, &utc);
        let (r, _) = sc.pulsanti.iter().find(|(_, p)| *p == Pulsante::Ripristina).unwrap();
        st.premi(r.x + 1.0, r.y + 1.0, ORA);
        assert_eq!(st.rilascia(&c, &sc, ORA), Esito::NuovoIntervallo);
        assert!(st.in_diretta());
    }

    #[test]
    fn la_scala_log_mette_le_decadi_sulle_tacche() {
        let mut c = cfg(vec![traccia("a", BLU)]);
        c.log = true;
        c.y_min = Some(1.0);
        c.y_max = Some(10000.0);
        let dati = Dati { serie: vec![rampa(ORA - 50_000, 10, 5000, 1.0)], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        for v in ["10000", "1000", "100", "10", "1"] {
            assert!(sc.testi.iter().any(|t| t.testo == v), "{v}: {:?}", sc.testi);
        }
    }

    #[test]
    fn le_soglie_si_vedono_nel_loro_colore() {
        let mut c = cfg(vec![traccia("a", BLU)]);
        c.soglie = true;
        c.alarm_high = Some(75.0);
        c.y_min = Some(0.0);
        c.y_max = Some(100.0);
        let dati = Dati { serie: vec![vec![Campione { ts: ORA - 60_000, v: Some(10.0) }, Campione { ts: ORA, v: Some(10.0) }]], ..Default::default() };
        let mut px = Pixmap::new(360, 180).unwrap();
        let sc = disegna(&c, &dati, &Stato::nuovo(&c), ORA, None, &mut px, &misura, &utc);
        let d = sc.dominio.unwrap();
        // Una linea da 1 px su una coordinata intera si divide fra due righe
        // (antialiasing, come nel canvas del web): si guardano entrambe.
        let y = (d.alto + d.plot_h * 0.25).floor() as u32;
        let rossi = (d.sx as u32..(d.sx + d.plot_w) as u32).filter(|x| {
            [y - 1, y].iter().any(|yy| {
                let p = pixel(&px, *x, *yy);
                p.0 as i32 > p.1 as i32 + 40 && p.0 as i32 > p.2 as i32 + 20
            })
        });
        assert!(rossi.count() > 50);
    }
}
