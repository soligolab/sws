//! I simboli di libreria (`lib:<famiglia>/<slug>`) sul pannello.
//!
//! Piano: `docs/plans/2026-10-14-motore-simboli-lib.md`, Fase 2. Lo stesso SVG
//! che il web inietta strato per strato qui diventa **un `lv_canvas` per
//! strato**, dentro un contenitore che ha la posizione e la misura dell'oggetto:
//!
//! - gli strati statici si rasterizzano una volta;
//! - `body` si ri-rasterizza quando cambia il colore di stato, con una cache
//!   dei colori già visti (resvg costa qualche millisecondo, uno stato che
//!   oscilla non deve farlo pagare a ogni cambio);
//! - `level` si rasterizza **pieno**, una volta, dentro un sotto-contenitore
//!   che ne ritaglia l'altezza dal basso: un cambio di livello è un
//!   `lv_obj_set_y`/`set_height`, niente resvg, e va bene per qualunque forma;
//! - `rotor` si rasterizza in fotogrammi sfruttando la simmetria (una girante a
//!   sei pale si ripete ogni 60°): girare è scambiare il buffer del canvas,
//!   senza la trasformazione per fotogramma che oggi costa ai builtin.
//!
//! Ogni bitmap sta in un `Vec<u8>` nostro, non nel pool LVGL da 1 MB, come per
//! gli altri SVG (`svg_raster.rs`).

use std::sync::{Arc, Mutex, OnceLock};

use sws_core::simboli_lib::{ManifestLib, ParteLib, SimboloLib};
use sws_core::stile_simboli::{applica_stile, StileSimbolo};
#[cfg(test)]
use sws_core::stile_simboli::Contorno;

use crate::svg_assets::{self, SvgSource};
use crate::svg_raster::{self, Ritaglio};

/// Gradi per fotogramma del rotore: 3° a 60 Hz di disegno restano fluidi fino a
/// un giro ogni ~1,2 s; un rotore più veloce salta fotogrammi, non si ferma.
const PASSO_ROTORE: f64 = 3.0;
/// Colori del corpo tenuti in cache per simbolo (stato fermo, marcia, allarme e
/// qualche voce di `symbol_states`).
const COLORI_IN_CACHE: usize = 6;

// ── manifesto ──────────────────────────────────────────────────────────────

static MANIFESTO: OnceLock<Mutex<Option<Option<Arc<ManifestLib>>>>> = OnceLock::new();

fn stato_manifesto() -> &'static Mutex<Option<Option<Arc<ManifestLib>>>> {
    MANIFESTO.get_or_init(Default::default)
}

/// Da chiamare con `svg_assets::invalidate()`: un aggiornamento del runtime può
/// aver portato un manifesto nuovo.
pub fn invalida() {
    *stato_manifesto().lock().unwrap_or_else(|e| e.into_inner()) = None;
    *stato_stile().lock().unwrap_or_else(|e| e.into_inner()) = None;
}

// ── lo stile del progetto ──────────────────────────────────────────────────

type StileProgetto = sws_core::project::StileSimboliProgetto;
static STILE: OnceLock<Mutex<Option<Option<Arc<StileProgetto>>>>> = OnceLock::new();

fn stato_stile() -> &'static Mutex<Option<Option<Arc<StileProgetto>>>> {
    STILE.get_or_init(Default::default)
}

/// `project.symbol_style` del runtime, letto una volta per progetto (Fase 4).
/// Un progetto senza stile, o un runtime che non risponde, dà `None`: i simboli
/// restano col loro disegno, come prima che lo stile esistesse.
pub fn stile_progetto(base_url: &str, rt: &tokio::runtime::Handle) -> Option<Arc<StileProgetto>> {
    let mut g = stato_stile().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(s) = g.as_ref() {
        return s.clone();
    }
    #[derive(serde::Deserialize)]
    struct Progetto {
        #[serde(default)]
        symbol_style: Option<StileProgetto>,
    }
    let url = format!("{}/api/project", base_url.trim_end_matches('/'));
    let letto: Option<Arc<StileProgetto>> = rt
        .block_on(async {
            let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build().ok()?;
            let resp = client.get(&url).send().await.ok()?;
            resp.json::<Progetto>().await.ok()
        })
        .and_then(|p| p.symbol_style)
        .map(Arc::new);
    *g = Some(letto.clone());
    letto
}

/// Il manifesto del runtime da cui si è presa la pagina, scaricato una volta.
pub fn manifesto(base_url: &str, rt: &tokio::runtime::Handle) -> Option<Arc<ManifestLib>> {
    let mut g = stato_manifesto().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(m) = g.as_ref() {
        return m.clone();
    }
    let letto = svg_assets::bytes_for(base_url, rt, &SvgSource::Url("/symbols/lib/manifest.json".into()))
        .and_then(|b| match serde_json::from_slice::<ManifestLib>(&b) {
            Ok(m) => Some(Arc::new(m)),
            Err(e) => {
                eprintln!("[simboli-lib] manifest.json illeggibile: {e}");
                None
            }
        });
    *g = Some(letto.clone());
    letto
}

/// L'SVG di un simbolo, con la versione del manifesto nell'URL (`/symbols` è
/// servito senza Cache-Control: è lo stesso motivo del web).
pub fn svg_simbolo(base_url: &str, rt: &tokio::runtime::Handle, m: &ManifestLib, s: &SimboloLib) -> Option<String> {
    let url = format!("/symbols/lib/{}?v={}", s.file, m.version);
    svg_assets::bytes_for(base_url, rt, &SvgSource::Url(url)).and_then(|b| String::from_utf8(b).ok())
}

// ── strati ─────────────────────────────────────────────────────────────────

/// Un SVG del generatore diviso nei suoi strati.
#[derive(Debug, Clone, PartialEq)]
pub struct Strati {
    /// `<svg …>` e `<defs>…</defs>`: tutto quello che c'è prima del primo strato.
    pub testa: String,
    /// (id, è una parte viva, markup completo del `<g>`).
    pub strati: Vec<(String, bool, String)>,
}

/// Divide nel formato di `scripts/simboli/genera.py`: uno strato comincia con
/// una riga `  <g id="…" data-layer="…"` e finisce con la riga `  </g>`. È la
/// stessa regola di `preparaSimbolo` in `sws-editor/src/symbols/lib/libreria.ts`.
pub fn dividi(svg: &str) -> Strati {
    let mut testa = String::new();
    let mut strati = Vec::new();
    let mut corrente: Option<(String, bool, String)> = None;
    for riga in svg.lines() {
        if let Some((id, parte, markup)) = corrente.as_mut() {
            markup.push_str(riga);
            markup.push('\n');
            if riga == "  </g>" {
                strati.push((std::mem::take(id), *parte, std::mem::take(markup)));
                corrente = None;
            }
            continue;
        }
        if let Some(resto) = riga.strip_prefix("  <g id=\"") {
            if let Some(fine) = resto.find('"') {
                let dopo = &resto[fine..];
                if dopo.starts_with("\" data-layer=\"") {
                    let parte = dopo.starts_with("\" data-layer=\"part\"");
                    corrente = Some((resto[..fine].to_string(), parte, format!("{riga}\n")));
                    continue;
                }
            }
        }
        if strati.is_empty() && riga != "</svg>" {
            testa.push_str(riga);
            testa.push('\n');
        }
    }
    Strati { testa, strati }
}

/// Un SVG con un solo strato, eventualmente ruotato attorno a (cx, cy).
pub fn svg_di_strato(testa: &str, markup: &str, rotazione: Option<(f64, f64, f64)>) -> String {
    match rotazione {
        Some((a, cx, cy)) => format!("{testa}<g transform=\"rotate({a} {cx} {cy})\">\n{markup}</g>\n</svg>\n"),
        None => format!("{testa}{markup}</svg>\n"),
    }
}

/// Lo stile del disegno, senza progetto né oggetto: per i test.
#[cfg(test)]
pub fn stile_del_disegno(m: &ManifestLib, corpo: Option<String>) -> StileSimbolo {
    StileSimbolo {
        materials: m.materials.clone(),
        volume: 100.0,
        outline: Contorno { color: sws_core::stile_simboli::CONTORNO_DISEGNO.into(), width: 1.0 },
        body: corpo,
    }
}

/// Una bitmap pronta per un `lv_canvas`, col suo posto dentro l'oggetto.
pub struct BitmapStrato {
    pub dove: Ritaglio,
    pub buf: Vec<u8>,
}

/// Le misure dell'oggetto sul pannello, condivise da tutti gli strati.
#[derive(Debug, Clone, Copy)]
pub struct Quadro {
    pub w: u32,
    pub h: u32,
    pub flip_h: bool,
    pub flip_v: bool,
}

pub fn rasterizza(svg: &str, q: Quadro, dove: Option<Ritaglio>) -> Option<BitmapStrato> {
    let dove = match dove {
        Some(r) => r,
        None => svg_raster::ingombro(svg.as_bytes(), q.w, q.h, q.flip_h, q.flip_v)?,
    };
    let r = svg_raster::rasterize_ritaglio(svg.as_bytes(), q.w, q.h, q.flip_h, q.flip_v, dove)?;
    Some(BitmapStrato { dove, buf: r.to_lvgl_true_color_alpha() })
}

/// Un punto del disegno (unità del viewBox) in pixel dell'oggetto.
pub fn in_pixel(view_box: [f64; 2], q: Quadro, x: f64, y: f64) -> (f32, f32) {
    let t = svg_raster::trasformazione((view_box[0] as f32, view_box[1] as f32), q.w, q.h, q.flip_h, q.flip_v);
    let mut p = [resvg::tiny_skia::Point::from_xy(x as f32, y as f32)];
    t.map_points(&mut p);
    (p[0].x, p[0].y)
}

/// La finestra del livello in pixel: (x, y, w, h), e se il contenuto sale dal
/// basso (con lo specchio verticale sale dall'alto, come sul web, dove lo
/// specchio sta fuori dal ritaglio).
pub fn finestra_livello(view_box: [f64; 2], q: Quadro, x: f64, y: f64, w: f64, h: f64) -> (Ritaglio, bool) {
    let a = in_pixel(view_box, q, x, y);
    let b = in_pixel(view_box, q, x + w, y + h);
    let pts = [resvg::tiny_skia::Point::from_xy(a.0, a.1), resvg::tiny_skia::Point::from_xy(b.0, b.1)];
    let x0 = pts[0].x.min(pts[1].x).round().max(0.0) as u32;
    let y0 = pts[0].y.min(pts[1].y).round().max(0.0) as u32;
    let x1 = (pts[0].x.max(pts[1].x).round() as u32).min(q.w);
    let y1 = (pts[0].y.max(pts[1].y).round() as u32).min(q.h);
    (Ritaglio { x: x0, y: y0, w: x1.saturating_sub(x0).max(1), h: y1.saturating_sub(y0).max(1) }, !q.flip_v)
}

/// I fotogrammi di un rotore: quanti, e il riquadro quadrato che li contiene
/// tutti (il disegno ruotato esce dal riquadro di quello fermo).
pub fn fotogrammi_rotore(symmetry: f64) -> usize {
    ((symmetry / PASSO_ROTORE).round() as usize).clamp(1, 120)
}

pub fn riquadro_rotore(fermo: Ritaglio, centro: (f32, f32), q: Quadro) -> Ritaglio {
    let angoli = [
        (fermo.x as f32, fermo.y as f32),
        ((fermo.x + fermo.w) as f32, fermo.y as f32),
        (fermo.x as f32, (fermo.y + fermo.h) as f32),
        ((fermo.x + fermo.w) as f32, (fermo.y + fermo.h) as f32),
    ];
    let r = angoli
        .iter()
        .map(|(x, y)| ((x - centro.0).powi(2) + (y - centro.1).powi(2)).sqrt())
        .fold(0.0f32, f32::max);
    let pts = [
        resvg::tiny_skia::Point::from_xy(centro.0 - r, centro.1 - r),
        resvg::tiny_skia::Point::from_xy(centro.0 + r, centro.1 + r),
    ];
    svg_raster::ritaglio_di(&pts, q.w, q.h).unwrap_or(fermo)
}

/// Quale fotogramma mostrare a `ms` (tick LVGL): un giro ogni `periodo_s`.
pub fn fotogramma(ms: u64, periodo_s: f64, symmetry: f64, n: usize) -> usize {
    let periodo_ms = (periodo_s.max(0.05) * 1000.0) as u64;
    let gradi = (ms % periodo_ms) as f64 / periodo_ms as f64 * 360.0;
    (((gradi % symmetry) / symmetry * n as f64).floor() as usize).min(n - 1)
}

// ── i valori delle parti vive ──────────────────────────────────────────────

/// Il valore di una parte; `None` dentro = come nel disegno. Stessa regola di
/// `valoriParti` in `sws-editor/src/symbols/lib/libreria.ts`, con gli stessi
/// casi (`tests/fixtures/parti-simbolo.json`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ValoreParte {
    Frazione(Option<f64>),
    Aperta(Option<bool>),
    Accesa(Option<bool>),
}

use sws_core::tag::TagValue;

fn vero(v: &TagValue) -> bool {
    match v {
        TagValue::Bool(b) => *b,
        TagValue::Int(i) => *i != 0,
        TagValue::Float(f) => *f != 0.0,
        TagValue::Str(s) => !s.trim().is_empty(),
        TagValue::Array(_) | TagValue::Struct(_) => false,
    }
}

fn numero(v: &TagValue) -> Option<f64> {
    match v {
        TagValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        TagValue::Int(i) => Some(*i as f64),
        TagValue::Float(f) => f.is_finite().then_some(*f),
        TagValue::Str(s) if !s.trim().is_empty() => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()),
        _ => None,
    }
}

pub fn valori_parti<'a>(
    parti: &[ParteLib],
    legami: Option<&serde_json::Value>,
    valore: impl Fn(&str) -> Option<&'a TagValue>,
) -> Vec<(String, ValoreParte)> {
    let mut out = Vec::new();
    for p in parti {
        let l = legami.and_then(|m| m.get(p.id()));
        let tag = l.and_then(|l| l.get("tag")).and_then(|t| t.as_str()).filter(|t| !t.is_empty());
        let v = tag.and_then(&valore);
        let valore = match p {
            ParteLib::Needle { .. } => {
                let min = l.and_then(|l| l.get("min")).and_then(|x| x.as_f64()).unwrap_or(0.0);
                let max = l.and_then(|l| l.get("max")).and_then(|x| x.as_f64()).unwrap_or(100.0);
                let f = v.and_then(numero).filter(|_| max != min).map(|n| ((n - min) / (max - min)).clamp(0.0, 1.0));
                ValoreParte::Frazione(f)
            }
            ParteLib::Lever { .. } => ValoreParte::Aperta(v.map(vero)),
            ParteLib::Lamp { .. } => ValoreParte::Accesa(v.map(vero)),
            _ => continue,
        };
        out.push((p.id().to_string(), valore));
    }
    out
}

// ── la cache dei colori del corpo ──────────────────────────────────────────

/// Le bitmap del corpo per colore. Un `Vec<u8>` spostato nella mappa non sposta
/// i suoi byte: il canvas può continuare a leggere dal puntatore dato a LVGL.
#[derive(Default)]
pub struct CacheCorpo {
    voci: Vec<((u8, u8, u8), Vec<u8>)>,
}

impl CacheCorpo {
    pub fn prendi(&mut self, c: (u8, u8, u8)) -> Option<&mut Vec<u8>> {
        self.voci.iter_mut().find(|(k, _)| *k == c).map(|(_, v)| v)
    }

    /// Inserisce e restituisce il buffer appena messo. Oltre il limite butta il
    /// più vecchio **che non è quello in uso** (`in_uso`), perché LVGL lo sta leggendo.
    pub fn metti(&mut self, c: (u8, u8, u8), buf: Vec<u8>, in_uso: Option<(u8, u8, u8)>) -> &mut Vec<u8> {
        if self.voci.len() >= COLORI_IN_CACHE {
            if let Some(i) = self.voci.iter().position(|(k, _)| Some(*k) != in_uso) {
                self.voci.remove(i);
            }
        }
        self.voci.push((c, buf));
        &mut self.voci.last_mut().expect("appena inserito").1
    }
}

/// Il colore come lo vuole lo stile: `#rrggbb`.
pub fn esadecimale(c: (u8, u8, u8)) -> String {
    format!("#{:02x}{:02x}{:02x}", c.0, c.1, c.2)
}

/// I pezzi del simbolo pronti per LVGL, prima di creare gli oggetti: separati
/// dalla creazione perché si possano verificare senza un display.
pub struct Preparato {
    pub strati: Vec<PezzoStrato>,
}

pub enum PezzoStrato {
    Fermo(BitmapStrato),
    /// Lancetta o leva: una bitmap quadrata attorno al perno, che LVGL ruota.
    /// `perno` è in pixel dentro la bitmap.
    Perno { id: String, bitmap: BitmapStrato, perno: (i16, i16) },
    /// Una spia: accesa = visibile.
    Spia { id: String, bitmap: BitmapStrato },
    Corpo { bitmap: BitmapStrato },
    Livello { bitmap: BitmapStrato, finestra: Ritaglio, dal_basso: bool },
    Rotore { fotogrammi: Vec<Vec<u8>>, dove: Ritaglio, symmetry: f64 },
}

/// Prepara tutti gli strati di `s` a `q`, con lo stile dato (vedi `stile_effettivo`).
pub fn prepara(s: &SimboloLib, svg: &str, q: Quadro, stile: &StileSimbolo) -> Preparato {
    let con_stile = applica_stile(svg, stile);
    let d = dividi(&con_stile);
    let mut out = Vec::new();
    for (id, _parte, markup) in &d.strati {
        let parte = s.parts.iter().find(|p| p.id() == id);
        let svg1 = svg_di_strato(&d.testa, markup, None);
        match parte {
            Some(ParteLib::Rotor { cx, cy, symmetry, .. }) => {
                let Some(fermo) = svg_raster::ingombro(svg1.as_bytes(), q.w, q.h, q.flip_h, q.flip_v) else { continue };
                let dove = riquadro_rotore(fermo, in_pixel(s.view_box, q, *cx, *cy), q);
                let n = fotogrammi_rotore(*symmetry);
                let fotogrammi: Vec<Vec<u8>> = (0..n)
                    .filter_map(|k| {
                        let a = *symmetry * k as f64 / n as f64;
                        let svgk = svg_di_strato(&d.testa, markup, Some((a, *cx, *cy)));
                        rasterizza(&svgk, q, Some(dove)).map(|b| b.buf)
                    })
                    .collect();
                if fotogrammi.len() == n {
                    out.push(PezzoStrato::Rotore { fotogrammi, dove, symmetry: *symmetry });
                }
            }
            Some(ParteLib::Level { x, y, w, h, .. }) => {
                let Some(bitmap) = rasterizza(&svg1, q, None) else { continue };
                let (finestra, dal_basso) = finestra_livello(s.view_box, q, *x, *y, *w, *h);
                out.push(PezzoStrato::Livello { bitmap, finestra, dal_basso });
            }
            _ if id == "body" => {
                if let Some(bitmap) = rasterizza(&svg1, q, None) {
                    out.push(PezzoStrato::Corpo { bitmap });
                }
            }
            Some(ParteLib::Needle { cx, cy, .. } | ParteLib::Lever { cx, cy, .. }) => {
                let Some(fermo) = svg_raster::ingombro(svg1.as_bytes(), q.w, q.h, q.flip_h, q.flip_v) else { continue };
                let centro = in_pixel(s.view_box, q, *cx, *cy);
                let dove = riquadro_rotore(fermo, centro, q);
                if let Some(bitmap) = rasterizza(&svg1, q, Some(dove)) {
                    let perno = ((centro.0 - dove.x as f32).round() as i16, (centro.1 - dove.y as f32).round() as i16);
                    out.push(PezzoStrato::Perno { id: id.clone(), bitmap, perno });
                }
            }
            Some(ParteLib::Lamp { .. }) => {
                if let Some(bitmap) = rasterizza(&svg1, q, None) {
                    out.push(PezzoStrato::Spia { id: id.clone(), bitmap });
                }
            }
            _ => {
                if let Some(b) = rasterizza(&svg1, q, None) {
                    out.push(PezzoStrato::Fermo(b));
                }
            }
        }
    }
    Preparato { strati: out }
}

/// Solo lo strato `body` con lo stile dato (e il suo colore di stato), nello
/// stesso riquadro di prima.
pub fn corpo_colorato(svg: &str, q: Quadro, dove: Ritaglio, stile: &StileSimbolo) -> Option<Vec<u8>> {
    let con_stile = applica_stile(svg, stile);
    let d = dividi(&con_stile);
    let (_, _, markup) = d.strati.iter().find(|(id, _, _)| id == "body")?;
    rasterizza(&svg_di_strato(&d.testa, markup, None), q, Some(dove)).map(|b| b.buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifesto_incluso() -> ManifestLib {
        serde_json::from_str(include_str!("../../../../sws-editor/public/symbols/lib/manifest.json")).unwrap()
    }
    const POMPA: &str = include_str!("../../../../sws-editor/public/symbols/lib/process/centrifugal-pump.svg");
    const SERBATOIO: &str = include_str!("../../../../sws-editor/public/symbols/lib/process/vertical-tank.svg");

    #[test]
    fn la_pompa_si_divide_negli_strati_del_web() {
        let d = dividi(POMPA);
        let ids: Vec<&str> = d.strati.iter().map(|(i, _, _)| i.as_str()).collect();
        assert_eq!(ids, ["layer-0", "body", "layer-1", "rotor"]);
        assert!(d.testa.starts_with("<svg ") && d.testa.contains("</defs>"));
        assert!(!d.testa.contains("data-layer"));
        assert_eq!(d.strati.iter().filter(|(_, p, _)| *p).count(), 2, "body e rotor sono parti");
        // Ricomporre gli strati ridà il file.
        let ricomposto = format!("{}{}</svg>\n", d.testa, d.strati.iter().map(|(_, _, m)| m.as_str()).collect::<String>());
        assert_eq!(ricomposto, POMPA);
    }

    #[test]
    fn gli_strati_rasterizzati_ricompongono_il_disegno_intero() {
        let m = manifesto_incluso();
        let s = m.simbolo("lib:process/centrifugal-pump").unwrap();
        let q = Quadro { w: 160, h: 160, flip_h: false, flip_v: false };
        let p = prepara(s, POMPA, q, &stile_del_disegno(&m, None));
        assert_eq!(p.strati.len(), 4);
        let intero = svg_raster::rasterize(POMPA.as_bytes(), 160, 160, false, false).unwrap();
        // Il pixel al centro del corpo (fuori dalla girante) ha il colore del
        // disegno intero: lo strato `body` è nel posto giusto.
        let (cx, cy) = in_pixel(s.view_box, q, 30.0, 40.0);
        let PezzoStrato::Corpo { bitmap, .. } = &p.strati[1] else { panic!("il secondo strato è il corpo") };
        let (lx, ly) = (cx as u32 - bitmap.dove.x, cy as u32 - bitmap.dove.y);
        let i = ((ly * bitmap.dove.w + lx) * 3) as usize;
        let j = ((cy as u32 * 160 + cx as u32) * 4) as usize;
        let rgb565 = u16::from_le_bytes([bitmap.buf[i], bitmap.buf[i + 1]]);
        let (r, g) = (((rgb565 >> 11) as u8) << 3, (((rgb565 >> 5) & 0x3f) as u8) << 2);
        assert!((r as i16 - (intero.pixels[j] & 0xf8) as i16).abs() <= 8, "rosso {r} contro {}", intero.pixels[j]);
        assert!((g as i16 - (intero.pixels[j + 1] & 0xfc) as i16).abs() <= 8);
    }

    #[test]
    fn il_rotore_ha_i_fotogrammi_della_sua_simmetria() {
        let m = manifesto_incluso();
        let s = m.simbolo("lib:process/centrifugal-pump").unwrap();
        let p = prepara(s, POMPA, Quadro { w: 80, h: 80, flip_h: false, flip_v: false }, &stile_del_disegno(&m, None));
        let PezzoStrato::Rotore { fotogrammi, dove, symmetry } = &p.strati[3] else { panic!("il quarto strato è il rotore") };
        assert_eq!(*symmetry, 60.0);
        assert_eq!(fotogrammi.len(), 20);
        assert!(fotogrammi.iter().all(|f| f.len() == (dove.w * dove.h * 3) as usize));
        assert_ne!(fotogrammi[0], fotogrammi[5], "fotogrammi diversi sono angoli diversi");
        // Il riquadro è centrato sul centro del manifesto (40, 50).
        let (cx, cy) = (dove.x as f32 + dove.w as f32 / 2.0, dove.y as f32 + dove.h as f32 / 2.0);
        assert!((cx - 40.0).abs() <= 1.0 && (cy - 50.0).abs() <= 1.0, "centro {cx},{cy}");
    }

    #[test]
    fn il_fotogramma_segue_il_tempo_e_la_simmetria() {
        assert_eq!(fotogramma(0, 2.0, 60.0, 20), 0);
        assert_eq!(fotogramma(167, 2.0, 60.0, 20), 10); // 167 ms ≈ 30,06°: metà dei 60° → 10
        assert_eq!(fotogramma(166, 2.0, 60.0, 20), 9); // 29,88°: ancora il 9
        // Un giro intero torna all'inizio.
        assert_eq!(fotogramma(2000, 2.0, 60.0, 20), 0);
    }

    #[test]
    fn la_finestra_del_livello_e_quella_del_manifesto_in_pixel() {
        let m = manifesto_incluso();
        let s = m.simbolo("lib:process/vertical-tank").unwrap();
        // 80×160 dentro 80×160: scala 1, nessuno spostamento.
        let (f, su) = finestra_livello(s.view_box, Quadro { w: 80, h: 160, flip_h: false, flip_v: false }, 31.0, 40.0, 18.0, 80.0);
        assert_eq!((f.x, f.y, f.w, f.h, su), (31, 40, 18, 80, true));
        // Dentro un quadrato 80×80 (contain, M4): scala 0,5 e centrato.
        let (f, _) = finestra_livello(s.view_box, Quadro { w: 80, h: 80, flip_h: false, flip_v: false }, 31.0, 40.0, 18.0, 80.0);
        assert_eq!((f.x, f.y, f.w, f.h), (36, 20, 9, 40));
        // Con lo specchio verticale il contenuto scende dall'alto.
        let (_, su) = finestra_livello(s.view_box, Quadro { w: 80, h: 160, flip_h: false, flip_v: true }, 31.0, 40.0, 18.0, 80.0);
        assert!(!su);
        let p = prepara(s, SERBATOIO, Quadro { w: 80, h: 160, flip_h: false, flip_v: false }, &stile_del_disegno(&m, None));
        assert!(p.strati.iter().any(|x| matches!(x, PezzoStrato::Livello { .. })));
    }

    #[test]
    fn il_corpo_cambia_colore_e_il_resto_no() {
        let m = manifesto_incluso();
        let s = m.simbolo("lib:process/centrifugal-pump").unwrap();
        let q = Quadro { w: 80, h: 80, flip_h: false, flip_v: false };
        let p = prepara(s, POMPA, q, &stile_del_disegno(&m, None));
        let PezzoStrato::Corpo { bitmap, .. } = &p.strati[1] else { panic!() };
        let verde = corpo_colorato(POMPA, q, bitmap.dove, &stile_del_disegno(&m, Some("#22c55e".into()))).unwrap();
        assert_eq!(verde.len(), bitmap.buf.len());
        assert_ne!(verde, bitmap.buf);
    }

    /// I casi del web (`sws-editor/tests/partiSimbolo.test.ts`).
    #[test]
    fn i_valori_delle_parti_sono_quelli_del_web() {
        #[derive(serde::Deserialize)]
        struct Caso {
            nome: String,
            legami: serde_json::Value,
            tag: std::collections::BTreeMap<String, TagValue>,
            atteso: std::collections::BTreeMap<String, serde_json::Value>,
        }
        #[derive(serde::Deserialize)]
        struct F {
            parti: Vec<ParteLib>,
            casi: Vec<Caso>,
        }
        let f: F = serde_json::from_str(include_str!("../../../../tests/fixtures/parti-simbolo.json")).unwrap();
        for c in &f.casi {
            let v = valori_parti(&f.parti, Some(&c.legami), |t| c.tag.get(t));
            for (id, atteso) in &c.atteso {
                let trovato = v.iter().find(|(i, _)| i == id).map(|(_, x)| *x);
                // I numeri si confrontano come numeri: in JSON 0 e 0.0 sono diversi.
                let ok = match (trovato, atteso) {
                    (Some(ValoreParte::Frazione(x)), a) => {
                        let a = a.get("frazione").and_then(|v| v.as_f64());
                        match (x, a) {
                            (Some(x), Some(a)) => (x - a).abs() < 1e-9,
                            (None, None) => true,
                            _ => false,
                        }
                    }
                    (Some(ValoreParte::Aperta(x)), a) => a.get("aperta").map(|v| v.as_bool()) == Some(x),
                    (Some(ValoreParte::Accesa(x)), a) => a.get("accesa").map(|v| v.as_bool()) == Some(x),
                    (None, _) => false,
                };
                assert!(ok, "caso «{}», parte {id}: {trovato:?} contro {atteso}", c.nome);
            }
        }
    }

    #[test]
    fn manometro_valvola_e_colonna_hanno_le_loro_parti() {
        let m = manifesto_incluso();
        let q = Quadro { w: 120, h: 120, flip_h: false, flip_v: false };
        for (id, file, attese) in [
            ("lib:process/pressure-gauge", "process/pressure-gauge.svg", 1usize),
            ("lib:process/ball-valve", "process/ball-valve.svg", 1),
        ] {
            let s = m.simbolo(id).unwrap();
            let svg = std::fs::read_to_string(format!("{}/../../../sws-editor/public/symbols/lib/{file}", env!("CARGO_MANIFEST_DIR"))).unwrap();
            let p = prepara(s, &svg, q, &stile_del_disegno(&m, None));
            let perni: Vec<_> = p.strati.iter().filter_map(|x| if let PezzoStrato::Perno { perno, bitmap, .. } = x { Some((*perno, bitmap.dove)) } else { None }).collect();
            assert_eq!(perni.len(), attese, "{id}");
            let ((px, py), dove) = perni[0];
            assert!(px > 0 && py > 0 && (px as u32) < dove.w && (py as u32) < dove.h, "{id}: perno {px},{py} fuori dalla bitmap {dove:?}");
        }
        let s = m.simbolo("lib:machines/stack-light").unwrap();
        let svg = std::fs::read_to_string(format!("{}/../../../sws-editor/public/symbols/lib/machines/stack-light.svg", env!("CARGO_MANIFEST_DIR"))).unwrap();
        let p = prepara(s, &svg, Quadro { w: 30, h: 100, flip_h: false, flip_v: false }, &stile_del_disegno(&m, None));
        assert_eq!(p.strati.iter().filter(|x| matches!(x, PezzoStrato::Spia { .. })).count(), 3);
    }

    #[test]
    fn la_cache_non_butta_il_buffer_in_uso() {
        let mut c = CacheCorpo::default();
        for i in 0..COLORI_IN_CACHE as u8 {
            c.metti((i, 0, 0), vec![i], Some((0, 0, 0)));
        }
        c.metti((99, 0, 0), vec![99], Some((0, 0, 0)));
        assert!(c.prendi((0, 0, 0)).is_some(), "quello in uso resta");
        assert!(c.prendi((1, 0, 0)).is_none(), "il più vecchio non in uso esce");
        assert!(c.prendi((99, 0, 0)).is_some());
    }
}
