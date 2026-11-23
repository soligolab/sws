//! I simboli di libreria (`lib:<famiglia>/<slug>`) sul pannello.
//!
//! Piano: `docs/archive/2026-10-14-motore-simboli-lib.md`, Fase 2. Lo stesso SVG
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

use sws_core::simboli_lib::{FillDir, ManifestLib, ParteLib, SimboloLib};
#[cfg(test)]
use sws_core::stile_simboli::Contorno;
use sws_core::stile_simboli::{applica_stile, StileSimbolo};

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
    *manifest_with_custom_ports()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
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
            let client = reqwest::Client::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .ok()?;
            let resp = client.get(&url).send().await.ok()?;
            resp.json::<Progetto>().await.ok()
        })
        .and_then(|p| p.symbol_style)
        .map(Arc::new);
    *g = Some(letto.clone());
    letto
}

/// Il manifesto del runtime da cui si è presa la pagina, scaricato una volta:
/// quello della libreria più quello dei simboli disegnati nel progetto
/// (`prj:`, piano 2026-11-03-assistente-genera-simboli-e-sinottici), uniti.
/// Da lì in avanti un `prj:` è un simbolo come gli altri: strati, parti vive,
/// bocche dei tubi.
pub fn manifesto(base_url: &str, rt: &tokio::runtime::Handle) -> Option<Arc<ManifestLib>> {
    let mut g = stato_manifesto().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(m) = g.as_ref() {
        return m.clone();
    }
    let letto = svg_assets::bytes_for(
        base_url,
        rt,
        &SvgSource::Url("/symbols/lib/manifest.json".into()),
    )
    .and_then(|b| match serde_json::from_slice::<ManifestLib>(&b) {
        Ok(m) => Some(m),
        Err(e) => {
            eprintln!("[simboli-lib] manifest.json illeggibile: {e}");
            None
        }
    })
    .map(|mut m| {
        if let Some(p) = manifesto_progetto(base_url, rt) {
            unisci(&mut m, p);
        }
        Arc::new(m)
    });
    *g = Some(letto.clone());
    letto
}

static WITH_CUSTOM_PORTS: OnceLock<Mutex<Option<Option<Arc<ManifestLib>>>>> = OnceLock::new();

fn manifest_with_custom_ports() -> &'static Mutex<Option<Option<Arc<ManifestLib>>>> {
    WITH_CUSTOM_PORTS.get_or_init(Default::default)
}

/// The manifest a pipe reads the ports from (plan
/// 2026-11-10-assistente-secondo-giro, G3).
///
/// It is [`manifesto`] — and, when an end of the pipe is on a `custom:`
/// symbol, the same with the ports of the custom symbols drawn as free SVG
/// added ([`with_custom_ports`]). Only then: the custom symbols come with
/// `/api/project`, and a page whose pipes touch no custom symbol must not
/// download the project to draw them. Built once, until the next deploy.
pub fn manifest_for_pipe(
    base_url: &str,
    rt: &tokio::runtime::Handle,
    pipe: &crate::model::SynopticObject,
    objects: &[crate::model::SynopticObject],
) -> Option<Arc<ManifestLib>> {
    if !ends_on_custom_symbol(pipe, objects) {
        return manifesto(base_url, rt);
    }
    let mut g = manifest_with_custom_ports()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(m) = g.as_ref() {
        return m.clone();
    }
    let merged = with_custom_ports(
        manifesto(base_url, rt),
        &svg_assets::custom_symbols(base_url, rt),
    );
    *g = Some(merged.clone());
    merged
}

/// An end of `pipe` is attached to a custom symbol of the page.
pub fn ends_on_custom_symbol(
    pipe: &crate::model::SynopticObject,
    objects: &[crate::model::SynopticObject],
) -> bool {
    [pipe.from_obj_id.as_deref(), pipe.to_obj_id.as_deref()]
        .into_iter()
        .flatten()
        .any(|id| {
            objects.iter().any(|o| {
                o.id.as_deref() == Some(id)
                    && o.symbol_id
                        .as_deref()
                        .is_some_and(|s| s.starts_with("custom:"))
            })
        })
}

/// `base` with one entry more for every custom symbol that declares ports
/// (`custom:<id>`: size of the drawing and ports, nothing to draw). Without a
/// library manifest the custom symbols alone still give a manifest: their
/// ports do not depend on the library being there.
pub fn with_custom_ports(
    base: Option<Arc<ManifestLib>>,
    custom: &[crate::model::CustomSymbol],
) -> Option<Arc<ManifestLib>> {
    let entries: Vec<SimboloLib> = custom.iter().filter_map(|c| c.port_entry()).collect();
    if entries.is_empty() {
        return base;
    }
    let mut m = match base {
        Some(m) => (*m).clone(),
        None => ManifestLib {
            version: String::new(),
            versione_progetto: String::new(),
            materials: Default::default(),
            symbols: Vec::new(),
        },
    };
    m.symbols.extend(entries);
    Some(Arc::new(m))
}

/// I simboli del progetto. Un runtime più vecchio della funzione risponde 404:
/// allora non ce ne sono, e i `prj:` restano segnaposto.
fn manifesto_progetto(base_url: &str, rt: &tokio::runtime::Handle) -> Option<ManifestLib> {
    let b = svg_assets::bytes_for(
        base_url,
        rt,
        &SvgSource::Url("/api/project/simboli/manifest.json".into()),
    )?;
    match serde_json::from_slice::<ManifestLib>(&b) {
        Ok(m) => Some(m),
        Err(e) => {
            eprintln!("[simboli-lib] manifesto dei simboli del progetto illeggibile: {e}");
            None
        }
    }
}

/// Aggiunge al manifesto della libreria i simboli del progetto.
pub fn unisci(lib: &mut ManifestLib, progetto: ManifestLib) {
    lib.versione_progetto = progetto.version;
    lib.symbols.extend(
        progetto
            .symbols
            .into_iter()
            .filter(|s| s.id.starts_with("prj:")),
    );
}

/// L'SVG di un simbolo, con la versione del manifesto nell'URL (`/symbols` è
/// servito senza Cache-Control: è lo stesso motivo del web).
pub fn svg_simbolo(
    base_url: &str,
    rt: &tokio::runtime::Handle,
    m: &ManifestLib,
    s: &SimboloLib,
) -> Option<String> {
    let url = match s.file.strip_prefix("prj/") {
        Some(f) => format!("/api/project/simboli/{f}?v={}", m.versione_progetto),
        None => format!("/symbols/lib/{}?v={}", s.file, m.version),
    };
    svg_assets::bytes_for(base_url, rt, &SvgSource::Url(url))
        .and_then(|b| String::from_utf8(b).ok())
}

// ── photos (plan 2026-11-21-simboli-fase-3-foto) ───────────────────────────

/// The photos of a symbol as `data:` URIs, by name in the project's `images/`.
pub type Foto = std::collections::HashMap<String, String>;

/// A photo at the size of the object: inside it, proportions kept, a PNG with
/// its transparency (`sws_web::sized_image`, `fit=contain`). Every photo of a
/// symbol is smaller than the symbol, so one size serves them all — and the
/// photo a signal swaps in fits wherever it goes.
pub fn url_foto(name: &str, q: Quadro) -> String {
    format!(
        "/api/project/images/{name}?w={}&h={}&fit=contain",
        q.w.max(1),
        q.h.max(1)
    )
}

/// Downloads the photos of `s` at the size `q`. A photo that doesn't arrive
/// is left out: its image draws nothing, the rest of the symbol is there.
pub fn scarica_foto(
    base_url: &str,
    rt: &tokio::runtime::Handle,
    s: &SimboloLib,
    q: Quadro,
) -> Foto {
    use base64::Engine as _;
    s.images
        .iter()
        .filter(|n| sws_core::simboli_prj::image_name_ok(n))
        .filter_map(|n| {
            let b = svg_assets::bytes_for(base_url, rt, &SvgSource::Url(url_foto(n, q)))?;
            let mime = svg_assets::tipo_dai_byte(&b)?;
            let dati = base64::engine::general_purpose::STANDARD.encode(&b);
            Some((n.clone(), format!("data:{mime};base64,{dati}")))
        })
        .collect()
}

/// A line with an `<image …>`, with `href` set to `uri` (any other `href` it had
/// taken out).
fn metti_href(riga: &str, uri: &str) -> String {
    let Some(i) = riga.find("<image") else {
        return riga.to_string();
    };
    let (prima, resto) = riga.split_at(i + "<image".len());
    let resto = match resto.find(" href=\"") {
        Some(a) => {
            let b = resto[a + 7..].find('"').map_or(resto.len(), |k| a + 7 + k + 1);
            format!("{}{}", &resto[..a], &resto[b..])
        }
        None => resto.to_string(),
    };
    format!("{prima} href=\"{uri}\"{resto}")
}

/// The SVG with every `<image data-src="N">` pointing at the data of photo N.
/// The compiler writes one element per line, so it goes line by line.
pub fn con_foto(svg: &str, foto: &Foto) -> String {
    if foto.is_empty() {
        return svg.to_string();
    }
    let mut out = String::with_capacity(svg.len());
    for riga in svg.split_inclusive('\n') {
        let nome = riga
            .find("<image data-src=\"")
            .map(|i| &riga[i + 17..])
            .and_then(|r| r.find('"').map(|j| &r[..j]));
        match nome.and_then(|n| foto.get(n)) {
            Some(uri) => out.push_str(&metti_href(riga, uri)),
            None => out.push_str(riga),
        }
    }
    out
}

/// A layer whose photos all show `uri` instead: a signal entry with a photo.
pub fn con_foto_al_posto(markup: &str, uri: &str) -> String {
    markup
        .split_inclusive('\n')
        .map(|riga| {
            if riga.contains("<image ") {
                metti_href(riga, uri)
            } else {
                riga.to_string()
            }
        })
        .collect()
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
        Some((a, cx, cy)) => {
            format!("{testa}<g transform=\"rotate({a} {cx} {cy})\">\n{markup}</g>\n</svg>\n")
        }
        None => format!("{testa}{markup}</svg>\n"),
    }
}

/// Lo stile del disegno, senza progetto né oggetto: per i test.
#[cfg(test)]
pub fn stile_del_disegno(m: &ManifestLib, corpo: Option<String>) -> StileSimbolo {
    StileSimbolo {
        materials: m.materials.clone(),
        volume: 100.0,
        outline: Contorno {
            color: sws_core::stile_simboli::CONTORNO_DISEGNO.into(),
            width: 1.0,
        },
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
    crate::tempi::misura("canvas.simbolo", || rasterizza_(svg, q, dove))
}

fn rasterizza_(svg: &str, q: Quadro, dove: Option<Ritaglio>) -> Option<BitmapStrato> {
    let dove = match dove {
        Some(r) => r,
        None => svg_raster::ingombro(svg.as_bytes(), q.w, q.h, q.flip_h, q.flip_v)?,
    };
    let r = svg_raster::rasterize_ritaglio(svg.as_bytes(), q.w, q.h, q.flip_h, q.flip_v, dove)?;
    Some(BitmapStrato {
        dove,
        buf: r.to_lvgl_true_color_alpha(),
    })
}

/// Un punto del disegno (unità del viewBox) in pixel dell'oggetto.
pub fn in_pixel(view_box: [f64; 2], q: Quadro, x: f64, y: f64) -> (f32, f32) {
    let t = svg_raster::trasformazione(
        (view_box[0] as f32, view_box[1] as f32),
        q.w,
        q.h,
        q.flip_h,
        q.flip_v,
    );
    let mut p = [resvg::tiny_skia::Point::from_xy(x as f32, y as f32)];
    t.map_points(&mut p);
    (p[0].x, p[0].y)
}

/// La finestra del livello in pixel: (x, y, w, h), e se il contenuto sale dal
/// basso (con lo specchio verticale sale dall'alto, come sul web, dove lo
/// specchio sta fuori dal ritaglio).
pub fn finestra_livello(
    view_box: [f64; 2],
    q: Quadro,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> (Ritaglio, bool) {
    let a = in_pixel(view_box, q, x, y);
    let b = in_pixel(view_box, q, x + w, y + h);
    let pts = [
        resvg::tiny_skia::Point::from_xy(a.0, a.1),
        resvg::tiny_skia::Point::from_xy(b.0, b.1),
    ];
    let x0 = pts[0].x.min(pts[1].x).round().max(0.0) as u32;
    let y0 = pts[0].y.min(pts[1].y).round().max(0.0) as u32;
    let x1 = (pts[0].x.max(pts[1].x).round() as u32).min(q.w);
    let y1 = (pts[0].y.max(pts[1].y).round() as u32).min(q.h);
    (
        Ritaglio {
            x: x0,
            y: y0,
            w: x1.saturating_sub(x0).max(1),
            h: y1.saturating_sub(y0).max(1),
        },
        !q.flip_v,
    )
}

/// I fotogrammi di un rotore: quanti, e il riquadro quadrato che li contiene
/// tutti (il disegno ruotato esce dal riquadro di quello fermo).
pub fn fotogrammi_rotore(symmetry: f64) -> usize {
    ((symmetry / PASSO_ROTORE).round() as usize).clamp(1, 120)
}

/// Quanta memoria possono prendere i fotogrammi di un rotore: su un simbolo
/// grande mezzo schermo una girante a simmetria piena (120 fotogrammi di
/// 300×300) sarebbe una trentina di MB. Oltre il budget i fotogrammi calano
/// e il rotore gira a scatti più larghi, ma gira; sui simboli di misura
/// normale il budget non scatta mai.
pub const BUDGET_ROTORE_BYTE: usize = 8 * 1024 * 1024;

/// I fotogrammi di un rotore entro il budget, dato il riquadro che li contiene.
pub fn fotogrammi_entro(symmetry: f64, dove: Ritaglio) -> usize {
    let per_fotogramma = crate::pixel::alpha_buffer_len(dove.w as usize, dove.h as usize).max(1);
    fotogrammi_rotore(symmetry).min((BUDGET_ROTORE_BYTE / per_fotogramma).max(4))
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

// The rule moved to `sws-core` on 19-11-2026 (plan
// `2026-11-19-animazioni-dei-simboli`), with the new kinds: the same one the
// web follows, with the cases in `tests/fixtures/symbol-pieces.json`.
pub use sws_core::symbol_behaviour::{valori_parti, ValoreParte};

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
    pub fn metti(
        &mut self,
        c: (u8, u8, u8),
        buf: Vec<u8>,
        in_uso: Option<(u8, u8, u8)>,
    ) -> &mut Vec<u8> {
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
    Perno {
        id: String,
        bitmap: BitmapStrato,
        perno: (i16, i16),
    },
    /// Una spia: accesa = visibile.
    Spia {
        id: String,
        bitmap: BitmapStrato,
    },
    Corpo {
        bitmap: BitmapStrato,
    },
    Livello {
        id: String,
        bitmap: BitmapStrato,
        finestra: Ritaglio,
        /// The side the content grows from, on the screen (mirrors included).
        dir: FillDir,
    },
    Rotore {
        id: String,
        fotogrammi: Vec<Vec<u8>>,
        dove: Ritaglio,
        symmetry: f64,
        ccw: bool,
    },
    /// A slide or a vibration (19-11-2026): a picture moved with `set_pos`.
    /// `passo` is the whole way of a slide, or one step of a vibration, in
    /// pixels on the screen (mirrors included).
    Mobile {
        id: String,
        bitmap: BitmapStrato,
        passo: (f32, f32),
    },
    /// A pulse: a picture whose opacity breathes.
    Pulse {
        id: String,
        bitmap: BitmapStrato,
    },
    /// A signal: the picture as drawn, and one more for every colour of its
    /// entries, all in the same box. `entry_variant[i]`: the picture of entry
    /// `i` (`None` = as drawn: no colour of its own, or no room in the budget).
    Signal {
        id: String,
        bitmap: BitmapStrato,
        variants: Vec<Vec<u8>>,
        entry_variant: Vec<Option<usize>>,
    },
    /// A glow (plan 2026-11-21-simboli-fase-8-effetti): the layer as drawn,
    /// and under it its blurred halo, shown while the input is true. `None`:
    /// no room in the page's budget, the layer stays without.
    Glow {
        id: String,
        bitmap: BitmapStrato,
        halo: Option<BitmapStrato>,
    },
    /// A moving effect (bubbles, smoke, flame): its frames over one period,
    /// all in the same box, shown in turn while the input is true.
    Effetto {
        id: String,
        fotogrammi: Vec<Vec<u8>>,
        dove: Ritaglio,
        period_ms: f64,
    },
}

/// The SVG of a layer's halo: its shapes blurred by `radius` (viewBox units),
/// in `color` or in their own. The filter covers the whole drawing, so the
/// blur is never cut at the shapes' box. Twin of the filter in `SimboloLib.tsx`.
pub fn svg_alone(testa: &str, markup: &str, view_box: [f64; 2], radius: f64, color: Option<&str>) -> String {
    let r = sws_core::simboli_prj::fmt(radius);
    let effetto = match color {
        Some(c) => format!(
            "<feGaussianBlur in=\"SourceAlpha\" stdDeviation=\"{r}\" result=\"b\"/>\
             <feFlood flood-color=\"{c}\" result=\"f\"/><feComposite in=\"f\" in2=\"b\" operator=\"in\"/>"
        ),
        None => format!("<feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"{r}\"/>"),
    };
    format!(
        "{testa}<defs><filter id=\"sws-glow\" filterUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"{}\" height=\"{}\">{effetto}</filter></defs>\n<g filter=\"url(#sws-glow)\">\n{markup}</g>\n</svg>\n",
        sws_core::simboli_prj::fmt(view_box[0]),
        sws_core::simboli_prj::fmt(view_box[1])
    )
}

/// `r` grown by `m` pixels on every side, inside the object.
fn allarga(r: Ritaglio, m: u32, q: Quadro) -> Ritaglio {
    let x0 = r.x.saturating_sub(m);
    let y0 = r.y.saturating_sub(m);
    let x1 = (r.x + r.w + m).min(q.w);
    let y1 = (r.y + r.h + m).min(q.h);
    Ritaglio { x: x0, y: y0, w: x1.saturating_sub(x0).max(1), h: y1.saturating_sub(y0).max(1) }
}

// ── the animation budget of a page ─────────────────────────────────────────

/// What the animated pieces of a page may take beyond their first picture:
/// the frames of the rotors and the colours of the signals (plan
/// 2026-11-19-animazioni-dei-simboli). A starting value, to fix with the
/// measures on the TY570 (viewer `MemoryHigh=40M`, ~21 MB at rest);
/// `SWS_ANIM_BUDGET_KB` changes it for the measures.
pub const ANIM_BUDGET_DEFAULT: usize = 6 * 1024 * 1024;

// Per thread: LVGL lives on one, and the tests, each on its own, don't take
// from each other's budget.
thread_local! {
    static ANIM_USED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

pub fn anim_budget() -> usize {
    std::env::var("SWS_ANIM_BUDGET_KB")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .map(|kb| kb * 1024)
        .unwrap_or(ANIM_BUDGET_DEFAULT)
}

/// A new page: the budget starts again.
pub fn anim_budget_reset() {
    ANIM_USED.with(|u| u.set(0));
}

pub fn anim_budget_used() -> usize {
    ANIM_USED.with(|u| u.get())
}

/// Takes `bytes` from the budget, if there is room.
fn anim_take(bytes: usize) -> bool {
    let used = anim_budget_used();
    if used + bytes > anim_budget() {
        return false;
    }
    ANIM_USED.with(|u| u.set(used + bytes));
    true
}

/// How many frames of `per_frame` bytes the budget leaves to a rotor that
/// wants `n`: the first is always there (it is the drawing).
fn frames_in_budget(n: usize, per_frame: usize) -> usize {
    let left = anim_budget().saturating_sub(anim_budget_used());
    let extra = (n.saturating_sub(1)).min(left / per_frame.max(1));
    1 + extra
}

/// The side a level grows from on the screen: a mirror swaps it.
pub fn dir_on_screen(dir: FillDir, q: Quadro) -> FillDir {
    match dir {
        FillDir::Up if q.flip_v => FillDir::Down,
        FillDir::Down if q.flip_v => FillDir::Up,
        FillDir::Left if q.flip_h => FillDir::Right,
        FillDir::Right if q.flip_h => FillDir::Left,
        d => d,
    }
}

/// A move of the drawing, `(dx, dy)` in its units, in pixels on the screen.
pub fn move_in_pixel(view_box: [f64; 2], q: Quadro, dx: f64, dy: f64) -> (f32, f32) {
    let o = in_pixel(view_box, q, 0.0, 0.0);
    let p = in_pixel(view_box, q, dx, dy);
    (p.0 - o.0, p.1 - o.1)
}

/// The markup of a layer with another colour on its first line: the layer's
/// own `fill`, which the shapes without a material take. Twin of
/// `withLayerFill` in `SimboloLib.tsx`.
pub fn with_layer_fill(markup: &str, colour: &str) -> String {
    let (head, rest) = markup
        .split_once('\n')
        .map_or((markup, ""), |(h, r)| (h, r));
    let head = match head.find(" fill=\"") {
        Some(i) => {
            let j = head[i + 7..]
                .find('"')
                .map_or(head.len(), |k| i + 7 + k + 1);
            format!("{} fill=\"{colour}\"{}", &head[..i], &head[j..])
        }
        None => head.to_string(),
    };
    if markup.contains('\n') {
        format!("{head}\n{rest}")
    } else {
        head
    }
}

/// Prepara tutti gli strati di `s` a `q`, con lo stile dato (vedi `stile_effettivo`).
pub fn prepara(s: &SimboloLib, svg: &str, q: Quadro, stile: &StileSimbolo) -> Preparato {
    prepara_con_foto(s, svg, q, stile, &Foto::new())
}

/// Like [`prepara`], with the photos the signal entries swap in (`svg` already
/// has its own, see [`con_foto`]).
pub fn prepara_con_foto(
    s: &SimboloLib,
    svg: &str,
    q: Quadro,
    stile: &StileSimbolo,
    foto: &Foto,
) -> Preparato {
    let con_stile = applica_stile(svg, stile);
    let d = dividi(&con_stile);
    let mut out = Vec::new();
    for (id, _parte, markup) in &d.strati {
        let parte = s.parts.iter().find(|p| p.id() == id);
        let svg1 = svg_di_strato(&d.testa, markup, None);
        match parte {
            // The moving effects (plan 2026-11-21-simboli-fase-8-effetti): the
            // layer's own shapes still, the effect in frames over them.
            Some(p) if sws_core::symbol_fx::fx_box(p).is_some() => {
                // A flame of shapes (22-11-2026): its shapes still under it,
                // and its frames are the same shapes flickering over them.
                let fiamma = matches!(p, ParteLib::Flame { .. });
                if let Some(b) = rasterizza(&svg1, q, None) {
                    // A flame with its input off is not drawn at all (decision
                    // of the maintainer, 23-11-2026): its shapes hide like a
                    // lamp's. The other effects draw over shapes that stay.
                    out.push(if fiamma {
                        PezzoStrato::Spia { id: id.clone(), bitmap: b }
                    } else {
                        PezzoStrato::Fermo(b)
                    });
                }
                let (x, y, w, h) = sws_core::symbol_fx::fx_box(p).expect("checked");
                let a = in_pixel(s.view_box, q, x, y);
                let b = in_pixel(s.view_box, q, x + w, y + h);
                let pts = [
                    resvg::tiny_skia::Point::from_xy(a.0, a.1),
                    resvg::tiny_skia::Point::from_xy(b.0, b.1),
                ];
                let Some(dove) = svg_raster::ritaglio_di(&pts, q.w, q.h) else {
                    continue;
                };
                let per_frame = crate::pixel::alpha_buffer_len(dove.w as usize, dove.h as usize);
                let n = frames_in_budget(sws_core::symbol_fx::FX_FRAMES, per_frame);
                if !anim_take(n * per_frame) {
                    eprintln!(
                        "[simboli-lib] {}/{id}: the effect stays out, the animation budget of the page is full",
                        s.id
                    );
                    continue;
                }
                let fotogrammi: Vec<Vec<u8>> = (0..n)
                    .filter_map(|k| {
                        let t = k as f64 / n as f64;
                        let el = if fiamma {
                            sws_core::symbol_fx::flame_of_shapes(p, markup, t)?
                        } else {
                            sws_core::symbol_fx::fx_elements(p, t)?
                        };
                        let svgk = format!("{}<g>{el}</g>\n</svg>\n", d.testa);
                        rasterizza(&svgk, q, Some(dove)).map(|b| b.buf)
                    })
                    .collect();
                if fotogrammi.len() == n {
                    out.push(PezzoStrato::Effetto {
                        id: id.clone(),
                        fotogrammi,
                        dove,
                        period_ms: sws_core::symbol_fx::fx_period_ms(p).unwrap_or(2000.0),
                    });
                }
            }
            Some(ParteLib::Rotor {
                cx,
                cy,
                symmetry,
                ccw,
                ..
            }) => {
                let Some(fermo) =
                    svg_raster::ingombro(svg1.as_bytes(), q.w, q.h, q.flip_h, q.flip_v)
                else {
                    continue;
                };
                let dove = riquadro_rotore(fermo, in_pixel(s.view_box, q, *cx, *cy), q);
                let voluti = fotogrammi_entro(*symmetry, dove);
                // The page budget: the frames beyond the first.
                let per_frame = crate::pixel::alpha_buffer_len(dove.w as usize, dove.h as usize);
                let n = frames_in_budget(voluti, per_frame);
                anim_take((n - 1) * per_frame);
                if n < voluti {
                    eprintln!(
                        "[simboli-lib] {}/{id}: {n} frames of {voluti}, the animation budget of the page is full",
                        s.id
                    );
                }
                let fotogrammi: Vec<Vec<u8>> = (0..n)
                    .filter_map(|k| {
                        let a = *symmetry * k as f64 / n as f64;
                        let svgk = svg_di_strato(&d.testa, markup, Some((a, *cx, *cy)));
                        rasterizza(&svgk, q, Some(dove)).map(|b| b.buf)
                    })
                    .collect();
                if fotogrammi.len() == n {
                    out.push(PezzoStrato::Rotore {
                        id: id.clone(),
                        fotogrammi,
                        dove,
                        symmetry: *symmetry,
                        ccw: *ccw,
                    });
                }
            }
            Some(ParteLib::Level {
                x, y, w, h, dir, ..
            }) => {
                let Some(bitmap) = rasterizza(&svg1, q, None) else {
                    continue;
                };
                let (finestra, _) = finestra_livello(s.view_box, q, *x, *y, *w, *h);
                out.push(PezzoStrato::Livello {
                    id: id.clone(),
                    bitmap,
                    finestra,
                    dir: dir_on_screen(*dir, q),
                });
            }
            Some(ParteLib::Slide { dx, dy, .. }) => {
                if let Some(bitmap) = rasterizza(&svg1, q, None) {
                    let passo = move_in_pixel(s.view_box, q, *dx, *dy);
                    out.push(PezzoStrato::Mobile {
                        id: id.clone(),
                        bitmap,
                        passo,
                    });
                }
            }
            Some(ParteLib::Vibrate {
                amplitude, axis, ..
            }) => {
                if let Some(bitmap) = rasterizza(&svg1, q, None) {
                    let (dx, dy) = match axis {
                        sws_core::simboli_lib::Axis::X => (*amplitude, 0.0),
                        sws_core::simboli_lib::Axis::Y => (0.0, *amplitude),
                    };
                    let passo = move_in_pixel(s.view_box, q, dx, dy);
                    out.push(PezzoStrato::Mobile {
                        id: id.clone(),
                        bitmap,
                        passo,
                    });
                }
            }
            Some(ParteLib::Pulse { .. }) => {
                if let Some(bitmap) = rasterizza(&svg1, q, None) {
                    out.push(PezzoStrato::Pulse {
                        id: id.clone(),
                        bitmap,
                    });
                }
            }
            Some(ParteLib::Signal { color, entries, .. }) => {
                let Some(bitmap) = rasterizza(&svg1, q, None) else {
                    continue;
                };
                // One picture per colour and photo, never one per entry: two
                // entries in red share it. All rasterised now, with the page:
                // never resvg in the frame loop.
                let mut colours: Vec<String> = Vec::new();
                let mut variants: Vec<Vec<u8>> = Vec::new();
                let mut entry_variant = Vec::with_capacity(entries.len());
                for e in entries {
                    let c = e
                        .color
                        .as_deref()
                        .filter(|c| Some(*c) != color.as_deref() && !e.hidden);
                    // The photo of the entry (plan 2026-11-21-simboli-fase-3-foto).
                    let photo = e
                        .image
                        .as_deref()
                        .filter(|_| !e.hidden)
                        .and_then(|n| foto.get(n).map(|uri| (n, uri)));
                    if c.is_none() && photo.is_none() {
                        entry_variant.push(None);
                        continue;
                    }
                    let key = format!("{}|{}", c.unwrap_or(""), photo.map_or("", |p| p.0));
                    if let Some(i) = colours.iter().position(|x| *x == key) {
                        entry_variant.push(Some(i));
                        continue;
                    }
                    let mut layer = match c {
                        Some(c) => with_layer_fill(markup, c),
                        None => markup.clone(),
                    };
                    if let Some((_, uri)) = photo {
                        layer = con_foto_al_posto(&layer, uri);
                    }
                    let c = key.as_str();
                    let svgc = svg_di_strato(&d.testa, &layer, None);
                    let Some(b) = rasterizza(&svgc, q, Some(bitmap.dove)) else {
                        entry_variant.push(None);
                        continue;
                    };
                    if !anim_take(b.buf.len()) {
                        eprintln!(
                            "[simboli-lib] {}/{id}: the colour {c} stays as drawn, the animation budget of the page is full",
                            s.id
                        );
                        entry_variant.push(None);
                        continue;
                    }
                    colours.push(c.to_string());
                    variants.push(b.buf);
                    entry_variant.push(Some(variants.len() - 1));
                }
                out.push(PezzoStrato::Signal {
                    id: id.clone(),
                    bitmap,
                    variants,
                    entry_variant,
                });
            }
            Some(ParteLib::Glow { radius, color, .. }) => {
                let Some(bitmap) = rasterizza(&svg1, q, None) else {
                    continue;
                };
                // The blur spreads about three radii: the halo's box is the
                // layer's, that much wider.
                let k = (q.w as f64 / s.view_box[0]).min(q.h as f64 / s.view_box[1]);
                let dove = allarga(bitmap.dove, (3.0 * radius * k).ceil() as u32, q);
                let alone = svg_alone(&d.testa, markup, s.view_box, *radius, color.as_deref());
                let halo = rasterizza(&alone, q, Some(dove)).filter(|h| {
                    let ok = anim_take(h.buf.len());
                    if !ok {
                        eprintln!(
                            "[simboli-lib] {}/{id}: no glow, the animation budget of the page is full",
                            s.id
                        );
                    }
                    ok
                });
                out.push(PezzoStrato::Glow {
                    id: id.clone(),
                    bitmap,
                    halo,
                });
            }
            _ if id == "body" => {
                if let Some(bitmap) = rasterizza(&svg1, q, None) {
                    out.push(PezzoStrato::Corpo { bitmap });
                }
            }
            Some(ParteLib::Needle { cx, cy, .. } | ParteLib::Lever { cx, cy, .. }) => {
                let Some(fermo) =
                    svg_raster::ingombro(svg1.as_bytes(), q.w, q.h, q.flip_h, q.flip_v)
                else {
                    continue;
                };
                let centro = in_pixel(s.view_box, q, *cx, *cy);
                let dove = riquadro_rotore(fermo, centro, q);
                if let Some(bitmap) = rasterizza(&svg1, q, Some(dove)) {
                    let perno = (
                        (centro.0 - dove.x as f32).round() as i16,
                        (centro.1 - dove.y as f32).round() as i16,
                    );
                    out.push(PezzoStrato::Perno {
                        id: id.clone(),
                        bitmap,
                        perno,
                    });
                }
            }
            Some(ParteLib::Lamp { .. }) => {
                if let Some(bitmap) = rasterizza(&svg1, q, None) {
                    out.push(PezzoStrato::Spia {
                        id: id.clone(),
                        bitmap,
                    });
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
pub fn corpo_colorato(
    svg: &str,
    q: Quadro,
    dove: Ritaglio,
    stile: &StileSimbolo,
) -> Option<Vec<u8>> {
    let con_stile = applica_stile(svg, stile);
    let d = dividi(&con_stile);
    let (_, _, markup) = d.strati.iter().find(|(id, _, _)| id == "body")?;
    rasterizza(&svg_di_strato(&d.testa, markup, None), q, Some(dove)).map(|b| b.buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifesto_incluso() -> ManifestLib {
        serde_json::from_str(include_str!(
            "../../../../sws-editor/public/symbols/lib/manifest.json"
        ))
        .unwrap()
    }
    const POMPA: &str =
        include_str!("../../../../sws-editor/public/symbols/lib/process/centrifugal-pump.svg");
    const SERBATOIO: &str =
        include_str!("../../../../sws-editor/public/symbols/lib/process/vertical-tank.svg");

    /// Un simbolo disegnato nel progetto (`prj:`) passa dalla stessa strada di
    /// uno di libreria: si divide negli strati, il rotore ha i suoi fotogrammi,
    /// e il manifesto unito lo trova per id.
    /// A picture of the photo boiler in its three flame states, drawn by the
    /// panel's engine with photos made up here: for looking, not for checking.
    /// `SWS_SNAPSHOT_DIR=<dir> cargo test -p sws-lvgl-viewer photo_boiler_snapshot -- --ignored`
    #[test]
    #[ignore]
    fn photo_boiler_snapshot() {
        use base64::Engine as _;
        use resvg::tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Transform};
        let dir = std::path::PathBuf::from(std::env::var("SWS_SNAPSHOT_DIR").expect("SWS_SNAPSHOT_DIR"));
        let uri = |p: &Pixmap| {
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(p.encode_png().unwrap())
            )
        };
        let paint = |r, g, b, a| {
            let mut p = Paint::default();
            p.set_color(Color::from_rgba8(r, g, b, a));
            p.anti_alias = true;
            p
        };
        // The "photo" of the boiler: a white casing with a darker panel.
        let mut bg = Pixmap::new(200, 240).unwrap();
        bg.fill(Color::from_rgba8(0, 0, 0, 0));
        let rect = |x, y, w, h| PathBuilder::from_rect(resvg::tiny_skia::Rect::from_xywh(x, y, w, h).unwrap());
        bg.fill_path(&rect(10.0, 4.0, 180.0, 232.0), &paint(232, 234, 236, 255), FillRule::Winding, Transform::identity(), None);
        bg.fill_path(&rect(20.0, 120.0, 160.0, 100.0), &paint(70, 78, 88, 255), FillRule::Winding, Transform::identity(), None);
        // A fan with three blades, transparent around.
        let mut fan = Pixmap::new(64, 64).unwrap();
        for k in 0..3 {
            let a = k as f32 * 120.0;
            let mut pb = PathBuilder::new();
            pb.move_to(32.0, 32.0);
            pb.line_to(28.0, 4.0);
            pb.line_to(38.0, 6.0);
            pb.close();
            fan.fill_path(&pb.finish().unwrap(), &paint(60, 200, 90, 255), FillRule::Winding,
                Transform::from_rotate_at(a, 32.0, 32.0), None);
        }
        // Three flames: none, low, high.
        let flame = |h: f32, r, g| {
            let mut p = Pixmap::new(72, 96).unwrap();
            if h > 0.0 {
                let mut pb = PathBuilder::new();
                pb.move_to(36.0, 96.0 - h);
                pb.quad_to(64.0, 80.0, 36.0, 94.0);
                pb.quad_to(8.0, 80.0, 36.0, 96.0 - h);
                pb.close();
                p.fill_path(&pb.finish().unwrap(), &paint(r, g, 20, 255), FillRule::Winding, Transform::identity(), None);
            } else {
                p.fill_path(&rect(30.0, 88.0, 12.0, 6.0), &paint(120, 120, 120, 255), FillRule::Winding, Transform::identity(), None);
            }
            p
        };
        let mut foto = Foto::new();
        foto.insert("boiler.jpg".into(), uri(&bg));
        foto.insert("fan-cutout.png".into(), uri(&fan));
        foto.insert("flame-off.png".into(), uri(&flame(0.0, 0, 0)));
        foto.insert("flame-low.png".into(), uri(&flame(40.0, 255, 170)));
        foto.insert("flame-high.png".into(), uri(&flame(88.0, 255, 90)));
        let d: sws_core::simboli_prj::Descrizione = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/photo-boiler.json"
        ))
        .unwrap();
        let c = sws_core::simboli_prj::compila_e_controlla(&d).unwrap();
        let svg = con_foto(&c.svg, &foto);
        let parts = dividi(&svg);
        for (state, img) in [("0-off", "flame-off.png"), ("1-low", "flame-low.png"), ("2-high", "flame-high.png")] {
            let layers: String = parts
                .strati
                .iter()
                .map(|(id, _, mk)| if id == "flame" { con_foto_al_posto(mk, &foto[img]) } else { mk.clone() })
                .collect();
            let whole = format!("{}{layers}</svg>\n", parts.testa);
            let (w, h) = (300, 360);
            let r = svg_raster::rasterize(whole.as_bytes(), w, h, false, false).expect("raster");
            let mut out = Pixmap::new(w, h).unwrap();
            out.fill(Color::from_rgba8(30, 35, 41, 255));
            let pm = Pixmap::from_vec(r.pixels.clone(), resvg::tiny_skia::IntSize::from_wh(w, h).unwrap()).unwrap();
            out.draw_pixmap(0, 0, pm.as_ref(), &resvg::tiny_skia::PixmapPaint::default(), Transform::identity(), None);
            out.save_png(dir.join(format!("photo-boiler-{state}.png"))).unwrap();
        }
    }

    /// The glow (plan 2026-11-21-simboli-fase-8-effetti): the layer as drawn,
    /// and a halo wider than it, with colour outside the shape.
    #[test]
    fn a_glow_has_its_halo() {
        let d: sws_core::simboli_prj::Descrizione = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/effects.json"
        ))
        .unwrap();
        let c = sws_core::simboli_prj::compila_e_controlla(&d).unwrap_or_else(|e| panic!("{e:?}"));
        let s = c.simbolo().unwrap();
        let m = manifesto_incluso();
        let q = Quadro { w: 240, h: 200, flip_h: false, flip_v: false };
        let p = prepara(&s, &c.svg, q, &stile_del_disegno(&m, None));
        let Some(PezzoStrato::Glow { bitmap, halo: Some(halo), .. }) =
            p.strati.iter().find(|x| matches!(x, PezzoStrato::Glow { .. }))
        else {
            panic!("a glow with its halo")
        };
        assert!(halo.dove.w > bitmap.dove.w + 20 && halo.dove.h > bitmap.dove.h + 20, "{:?} {:?}", halo.dove, bitmap.dove);
        // Some colour in the halo's top-left corner area, outside the shape.
        let bpp = halo.buf.len() / (halo.dove.w * halo.dove.h) as usize;
        let alpha_at = |x: u32, y: u32| halo.buf[((y * halo.dove.w + x) as usize) * bpp + bpp - 1];
        let y = (bitmap.dove.y - halo.dove.y) / 2;
        let x = halo.dove.w / 2;
        assert!(alpha_at(x, y) > 0, "the halo spreads above the shape");
        assert!(svg_alone("<svg>", "<g/>", [120.0, 100.0], 5.0, None).contains("in=\"SourceGraphic\" stdDeviation=\"5\""));
    }

    /// A picture of the effects, as the panel's engine draws them: the glow's
    /// halo and one frame of each moving effect. For looking, not checking.
    /// `SWS_SNAPSHOT_DIR=<dir> cargo test -p sws-lvgl-viewer effects_snapshot -- --ignored`
    #[test]
    #[ignore]
    fn effects_snapshot() {
        use resvg::tiny_skia::{Color, Pixmap, PixmapPaint, Transform};
        let dir = std::path::PathBuf::from(std::env::var("SWS_SNAPSHOT_DIR").expect("SWS_SNAPSHOT_DIR"));
        let d: sws_core::simboli_prj::Descrizione = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/effects.json"
        ))
        .unwrap();
        let c = sws_core::simboli_prj::compila_e_controlla(&d).unwrap();
        let s = c.simbolo().unwrap();
        let parts = dividi(&c.svg);
        for (name, t) in [("a", 0.1), ("b", 0.45), ("c", 0.8)] {
            let mut body = String::new();
            for (id, _, mk) in &parts.strati {
                if let Some(ParteLib::Glow { radius, color, .. }) = s.parts.iter().find(|p| p.id() == id) {
                    let halo = svg_alone("", mk, s.view_box, *radius, color.as_deref());
                    body.push_str(halo.trim_end_matches("</svg>\n"));
                }
                let parte = s.parts.iter().find(|p| p.id() == id);
                // A flame of shapes: its own shapes flickering, as `prepara` does.
                match parte.and_then(|p| sws_core::symbol_fx::flame_of_shapes(p, mk, t)) {
                    Some(f) => body.push_str(&f),
                    None => {
                        body.push_str(mk);
                        if let Some(el) = parte.and_then(|p| sws_core::symbol_fx::fx_elements(p, t)) {
                            body.push_str(&format!("<g>{el}</g>\n"));
                        }
                    }
                }
            }
            let svg = format!("{}{body}</svg>\n", parts.testa);
            let (w, h) = (480, 400);
            let r = svg_raster::rasterize(svg.as_bytes(), w, h, false, false).expect("raster");
            let mut out = Pixmap::new(w, h).unwrap();
            out.fill(Color::from_rgba8(30, 35, 41, 255));
            let pm = Pixmap::from_vec(r.pixels.clone(), resvg::tiny_skia::IntSize::from_wh(w, h).unwrap()).unwrap();
            out.draw_pixmap(0, 0, pm.as_ref(), &PixmapPaint::default(), Transform::identity(), None);
            out.save_png(dir.join(format!("effects-{name}.png"))).unwrap();
        }
    }

    /// The moving effects (plan 2026-11-21-simboli-fase-8-effetti): frames in
    /// the effect's box, all different, none of them empty.
    #[test]
    fn an_effect_has_its_frames() {
        let d: sws_core::simboli_prj::Descrizione = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/effects.json"
        ))
        .unwrap();
        let c = sws_core::simboli_prj::compila_e_controlla(&d).unwrap_or_else(|e| panic!("{e:?}"));
        let s = c.simbolo().unwrap();
        let m = manifesto_incluso();
        let q = Quadro { w: 240, h: 200, flip_h: false, flip_v: false };
        let p = prepara(&s, &c.svg, q, &stile_del_disegno(&m, None));
        let Some(PezzoStrato::Effetto { fotogrammi, dove, period_ms, id }) =
            p.strati.iter().find(|x| matches!(x, PezzoStrato::Effetto { .. }))
        else {
            panic!("the bubbles")
        };
        // Effects of groups (22-11-2026): the bubbles of the tank «vasca».
        assert_eq!(id, "fx-2");
        assert_eq!(*period_ms, 1800.0);
        assert_eq!(fotogrammi.len(), sws_core::symbol_fx::FX_FRAMES);
        assert!((62..=68).contains(&dove.w) && (78..=84).contains(&dove.h), "{dove:?}");
        assert_ne!(fotogrammi[0], fotogrammi[4]);
        assert!(fotogrammi.iter().all(|f| f.iter().any(|b| *b != 0)));
        // The smoke too, in a box wider than its part (the puffs grow).
        let Some(PezzoStrato::Effetto { dove, .. }) = p
            .strati
            .iter()
            .find(|x| matches!(x, PezzoStrato::Effetto { id, .. } if id == "fx-3"))
        else {
            panic!("the smoke")
        };
        assert!(dove.w > 40, "{dove:?}");
        let Some(PezzoStrato::Effetto { fotogrammi, period_ms, .. }) = p
            .strati
            .iter()
            .find(|x| matches!(x, PezzoStrato::Effetto { id, .. } if id == "fx-4"))
        else {
            panic!("the flame")
        };
        assert_eq!(*period_ms, 800.0);
        assert_ne!(fotogrammi[0], fotogrammi[4], "it flickers");
        // Its still shapes hide when its input is off (23-11-2026), as a lamp's.
        assert!(
            p.strati.iter().any(|x| matches!(x, PezzoStrato::Spia { id, .. } if id == "fx-4")),
            "the flame's shapes can hide"
        );
    }

    #[test]
    fn photos_are_drawn_and_a_signal_swaps_them() {
        use base64::Engine as _;
        let png = |r: u8, g: u8, b: u8| {
            let mut p = resvg::tiny_skia::Pixmap::new(8, 8).unwrap();
            p.fill(resvg::tiny_skia::Color::from_rgba8(r, g, b, 255));
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(p.encode_png().unwrap())
            )
        };
        let d: sws_core::simboli_prj::Descrizione = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/photo-boiler.json"
        ))
        .unwrap();
        let c = sws_core::simboli_prj::compila_e_controlla(&d).unwrap();
        let s = c.simbolo().unwrap();
        let q = Quadro {
            w: 100,
            h: 120,
            flip_h: false,
            flip_v: false,
        };
        assert_eq!(
            url_foto("boiler.jpg", q),
            "/api/project/images/boiler.jpg?w=100&h=120&fit=contain"
        );
        let mut foto = Foto::new();
        foto.insert("boiler.jpg".into(), png(255, 0, 0));
        foto.insert("fan-cutout.png".into(), png(0, 255, 0));
        foto.insert("flame-off.png".into(), png(80, 80, 80));
        foto.insert("flame-low.png".into(), png(255, 160, 0));
        // flame-high.png never arrived: that entry stays as drawn.
        let svg = con_foto(&c.svg, &foto);
        assert!(svg.contains("<image href=\"data:image/png;base64,"));
        assert!(svg.contains("data-src=\"boiler.jpg\""), "the name stays");
        let m = manifesto_incluso();
        let p = prepara_con_foto(&s, &svg, q, &stile_del_disegno(&m, None), &foto);
        let PezzoStrato::Fermo(sfondo) = &p.strati[0] else {
            panic!("the first layer is the photo")
        };
        // A square photo in a 100×120 box: as wide as the box, proportions
        // kept (`meet`, like the web).
        assert_eq!(sfondo.dove.w, 100);
        assert!((100..=112).contains(&sfondo.dove.h), "{:?}", sfondo.dove);
        let kinds: Vec<&str> = p
            .strati
            .iter()
            .map(|x| match x {
                PezzoStrato::Fermo(_) => "fermo",
                PezzoStrato::Corpo { .. } => "corpo",
                PezzoStrato::Rotore { .. } => "rotore",
                PezzoStrato::Signal { .. } => "signal",
                _ => "altro",
            })
            .collect();
        assert_eq!(kinds, ["fermo", "corpo", "rotore", "signal"]);
        let Some(PezzoStrato::Signal {
            variants,
            entry_variant,
            ..
        }) = p.strati.iter().find(|x| matches!(x, PezzoStrato::Signal { .. }))
        else {
            panic!("the flame is a signal")
        };
        assert_eq!(variants.len(), 2);
        assert_eq!(entry_variant, &[Some(0), Some(1), None]);
        assert_ne!(variants[0], variants[1], "two photos, two pictures");
        // Without photos the image draws nothing and the rest is there.
        let p = prepara(&s, &c.svg, q, &stile_del_disegno(&m, None));
        assert!(!p.strati.iter().any(|x| matches!(x, PezzoStrato::Fermo(_))));
    }

    #[test]
    fn un_simbolo_del_progetto_si_prepara_come_uno_di_libreria() {
        let d: sws_core::simboli_prj::Descrizione = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap();
        let c = sws_core::simboli_prj::compila_e_controlla(&d).unwrap();
        let ids: Vec<String> = dividi(&c.svg)
            .strati
            .into_iter()
            .map(|(i, _, _)| i)
            .collect();
        assert_eq!(
            ids,
            ["layer-0", "body", "layer-1", "rotor", "layer-2", "lamp"]
        );

        let mut m = manifesto_incluso();
        let progetto = ManifestLib {
            version: "abc".into(),
            versione_progetto: String::new(),
            materials: m.materials.clone(),
            symbols: vec![c.simbolo().unwrap()],
        };
        unisci(&mut m, progetto);
        assert_eq!(m.versione_progetto, "abc");
        let s = m
            .simbolo("prj:gabbia-laminazione")
            .expect("il manifesto unito lo trova");
        assert_eq!(s.ports.len(), 2);
        let p = prepara(
            s,
            &c.svg,
            Quadro {
                w: 120,
                h: 100,
                flip_h: false,
                flip_v: false,
            },
            &stile_del_disegno(&m, None),
        );
        let PezzoStrato::Rotore {
            fotogrammi,
            symmetry,
            ..
        } = &p.strati[3]
        else {
            panic!("il quarto strato è il rotore")
        };
        assert_eq!(*symmetry, 90.0);
        assert!(fotogrammi.len() > 1);
    }

    #[test]
    fn la_pompa_si_divide_negli_strati_del_web() {
        let d = dividi(POMPA);
        let ids: Vec<&str> = d.strati.iter().map(|(i, _, _)| i.as_str()).collect();
        assert_eq!(ids, ["layer-0", "body", "layer-1", "rotor"]);
        assert!(d.testa.starts_with("<svg ") && d.testa.contains("</defs>"));
        assert!(!d.testa.contains("data-layer"));
        assert_eq!(
            d.strati.iter().filter(|(_, p, _)| *p).count(),
            2,
            "body e rotor sono parti"
        );
        // Ricomporre gli strati ridà il file.
        let ricomposto = format!(
            "{}{}</svg>\n",
            d.testa,
            d.strati
                .iter()
                .map(|(_, _, m)| m.as_str())
                .collect::<String>()
        );
        assert_eq!(ricomposto, POMPA);
    }

    #[test]
    fn gli_strati_rasterizzati_ricompongono_il_disegno_intero() {
        let m = manifesto_incluso();
        let s = m.simbolo("lib:process/centrifugal-pump").unwrap();
        let q = Quadro {
            w: 160,
            h: 160,
            flip_h: false,
            flip_v: false,
        };
        let p = prepara(s, POMPA, q, &stile_del_disegno(&m, None));
        assert_eq!(p.strati.len(), 4);
        let intero = svg_raster::rasterize(POMPA.as_bytes(), 160, 160, false, false).unwrap();
        // Il pixel al centro del corpo (fuori dalla girante) ha il colore del
        // disegno intero: lo strato `body` è nel posto giusto.
        let (cx, cy) = in_pixel(s.view_box, q, 30.0, 40.0);
        let PezzoStrato::Corpo { bitmap, .. } = &p.strati[1] else {
            panic!("il secondo strato è il corpo")
        };
        let (lx, ly) = (cx as u32 - bitmap.dove.x, cy as u32 - bitmap.dove.y);
        let i = (ly * bitmap.dove.w + lx) as usize * crate::pixel::PX_ALPHA;
        let j = ((cy as u32 * 160 + cx as u32) * 4) as usize;
        let (r, g, _, _) = crate::pixel::read_rgba(&bitmap.buf[i..]);
        assert!(
            (r as i16 - (intero.pixels[j] & 0xf8) as i16).abs() <= 8,
            "rosso {r} contro {}",
            intero.pixels[j]
        );
        assert!((g as i16 - (intero.pixels[j + 1] & 0xfc) as i16).abs() <= 8);
    }

    #[test]
    fn il_rotore_ha_i_fotogrammi_della_sua_simmetria() {
        let m = manifesto_incluso();
        let s = m.simbolo("lib:process/centrifugal-pump").unwrap();
        let p = prepara(
            s,
            POMPA,
            Quadro {
                w: 80,
                h: 80,
                flip_h: false,
                flip_v: false,
            },
            &stile_del_disegno(&m, None),
        );
        let PezzoStrato::Rotore {
            fotogrammi,
            dove,
            symmetry,
            ..
        } = &p.strati[3]
        else {
            panic!("il quarto strato è il rotore")
        };
        assert_eq!(*symmetry, 60.0);
        assert_eq!(fotogrammi.len(), 20);
        assert!(fotogrammi
            .iter()
            .all(|f| f.len() == (dove.w * dove.h) as usize * crate::pixel::PX_ALPHA));
        assert_ne!(
            fotogrammi[0], fotogrammi[5],
            "fotogrammi diversi sono angoli diversi"
        );
        // Il riquadro è centrato sul centro del manifesto (40, 50).
        let (cx, cy) = (
            dove.x as f32 + dove.w as f32 / 2.0,
            dove.y as f32 + dove.h as f32 / 2.0,
        );
        assert!(
            (cx - 40.0).abs() <= 1.0 && (cy - 50.0).abs() <= 1.0,
            "centro {cx},{cy}"
        );
    }

    /// Su un simbolo grande i fotogrammi del rotore stanno nel budget; su uno
    /// di misura normale sono quelli della simmetria.
    #[test]
    fn i_fotogrammi_del_rotore_stanno_nel_budget() {
        let piccolo = Ritaglio {
            x: 0,
            y: 0,
            w: 60,
            h: 60,
        };
        assert_eq!(fotogrammi_entro(60.0, piccolo), 20);
        let grande = Ritaglio {
            x: 0,
            y: 0,
            w: 400,
            h: 400,
        };
        let n = fotogrammi_entro(360.0, grande);
        assert!(
            n < 120 && n * 400 * 400 * crate::pixel::PX_ALPHA <= BUDGET_ROTORE_BYTE,
            "{n}"
        );
        assert!(
            fotogrammi_entro(
                360.0,
                Ritaglio {
                    x: 0,
                    y: 0,
                    w: 2048,
                    h: 2048
                }
            ) >= 4,
            "gira comunque"
        );
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
        let (f, su) = finestra_livello(
            s.view_box,
            Quadro {
                w: 80,
                h: 160,
                flip_h: false,
                flip_v: false,
            },
            31.0,
            40.0,
            18.0,
            80.0,
        );
        assert_eq!((f.x, f.y, f.w, f.h, su), (31, 40, 18, 80, true));
        // Dentro un quadrato 80×80 (contain, M4): scala 0,5 e centrato.
        let (f, _) = finestra_livello(
            s.view_box,
            Quadro {
                w: 80,
                h: 80,
                flip_h: false,
                flip_v: false,
            },
            31.0,
            40.0,
            18.0,
            80.0,
        );
        assert_eq!((f.x, f.y, f.w, f.h), (36, 20, 9, 40));
        // Con lo specchio verticale il contenuto scende dall'alto.
        let (_, su) = finestra_livello(
            s.view_box,
            Quadro {
                w: 80,
                h: 160,
                flip_h: false,
                flip_v: true,
            },
            31.0,
            40.0,
            18.0,
            80.0,
        );
        assert!(!su);
        let p = prepara(
            s,
            SERBATOIO,
            Quadro {
                w: 80,
                h: 160,
                flip_h: false,
                flip_v: false,
            },
            &stile_del_disegno(&m, None),
        );
        assert!(p
            .strati
            .iter()
            .any(|x| matches!(x, PezzoStrato::Livello { .. })));
    }

    #[test]
    fn il_corpo_cambia_colore_e_il_resto_no() {
        let m = manifesto_incluso();
        let s = m.simbolo("lib:process/centrifugal-pump").unwrap();
        let q = Quadro {
            w: 80,
            h: 80,
            flip_h: false,
            flip_v: false,
        };
        let p = prepara(s, POMPA, q, &stile_del_disegno(&m, None));
        let PezzoStrato::Corpo { bitmap, .. } = &p.strati[1] else {
            panic!()
        };
        let verde = corpo_colorato(
            POMPA,
            q,
            bitmap.dove,
            &stile_del_disegno(&m, Some("#22c55e".into())),
        )
        .unwrap();
        assert_eq!(verde.len(), bitmap.buf.len());
        assert_ne!(verde, bitmap.buf);
    }

    fn animated() -> (SimboloLib, String) {
        let d: sws_core::simboli_prj::Descrizione = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/animated-pieces.json"
        ))
        .unwrap();
        let c = sws_core::simboli_prj::compila_e_controlla(&d).unwrap();
        (serde_json::from_value(c.voce.clone()).unwrap(), c.svg)
    }

    fn quadro(w: u32, h: u32, flip_h: bool, flip_v: bool) -> Quadro {
        Quadro {
            w,
            h,
            flip_h,
            flip_v,
        }
    }

    /// The animated pieces (19-11-2026): every kind becomes its piece, and a
    /// signal has one picture per colour of its entries, never one per entry.
    #[test]
    fn the_animated_pieces_prepare_into_their_pieces() {
        let (sim, svg) = animated();
        let m = manifesto_incluso();
        anim_budget_reset();
        let p = prepara(
            &sim,
            &svg,
            quadro(240, 200, false, false),
            &stile_del_disegno(&m, None),
        );
        let mut kinds = Vec::new();
        for x in &p.strati {
            match x {
                PezzoStrato::Rotore {
                    id,
                    ccw,
                    fotogrammi,
                    ..
                } => {
                    assert!(*ccw && fotogrammi.len() > 1);
                    kinds.push(format!("rotor:{id}"));
                }
                PezzoStrato::Livello { id, dir, .. } => {
                    assert_eq!(*dir, FillDir::Right);
                    kinds.push(format!("level:{id}"));
                }
                PezzoStrato::Mobile { id, passo, .. } => {
                    kinds.push(format!("mobile:{id}"));
                    // Twice the size: the gate goes 32 px up, the motor 4 px right.
                    let want = if id == "gate" {
                        (0.0, -32.0)
                    } else {
                        (4.0, 0.0)
                    };
                    assert!(
                        (passo.0 - want.0).abs() < 0.01 && (passo.1 - want.1).abs() < 0.01,
                        "{id} {passo:?}"
                    );
                }
                PezzoStrato::Pulse { id, .. } => kinds.push(format!("pulse:{id}")),
                PezzoStrato::Signal {
                    id,
                    bitmap,
                    variants,
                    entry_variant,
                } => {
                    kinds.push(format!("signal:{id}"));
                    assert_eq!(variants.len(), 2);
                    assert_eq!(entry_variant, &[Some(0), Some(1), None]);
                    assert!(variants.iter().all(|v| v.len() == bitmap.buf.len()));
                    assert_ne!(variants[0], bitmap.buf);
                }
                _ => {}
            }
        }
        assert_eq!(
            kinds,
            [
                "rotor:fan",
                "level:tank",
                "mobile:gate",
                "mobile:motor",
                "pulse:glow",
                "signal:beacon"
            ]
        );
        assert!(anim_budget_used() > 0);
    }

    #[test]
    fn a_full_budget_leaves_the_rotor_still_and_the_signal_as_drawn() {
        let (sim, svg) = animated();
        let m = manifesto_incluso();
        anim_budget_reset();
        // Fill the budget first.
        assert!(anim_take(anim_budget()));
        let p = prepara(
            &sim,
            &svg,
            quadro(240, 200, false, false),
            &stile_del_disegno(&m, None),
        );
        for x in &p.strati {
            match x {
                PezzoStrato::Rotore { fotogrammi, .. } => assert_eq!(fotogrammi.len(), 1),
                PezzoStrato::Signal {
                    variants,
                    entry_variant,
                    ..
                } => {
                    assert!(variants.is_empty());
                    assert_eq!(entry_variant, &[None, None, None]);
                }
                _ => {}
            }
        }
        anim_budget_reset();
    }

    #[test]
    fn mirrors_turn_the_directions_and_the_moves() {
        let q = quadro(120, 100, true, false);
        assert_eq!(dir_on_screen(FillDir::Right, q), FillDir::Left);
        assert_eq!(dir_on_screen(FillDir::Up, q), FillDir::Up);
        assert_eq!(
            dir_on_screen(FillDir::Up, quadro(120, 100, false, true)),
            FillDir::Down
        );
        let (dx, dy) = move_in_pixel([120.0, 100.0], q, 10.0, -5.0);
        assert!(
            (dx + 10.0).abs() < 0.01 && (dy + 5.0).abs() < 0.01,
            "{dx} {dy}"
        );
    }

    #[test]
    fn the_layer_fill_is_rewritten_on_the_first_line_only() {
        let m = "  <g id=\"b\" data-layer=\"part\" fill=\"#64748b\" stroke=\"#1c2329\">\n    <circle fill=\"#000\"/>\n  </g>\n";
        let r = with_layer_fill(m, "#22c55e");
        assert!(r.starts_with("  <g id=\"b\" data-layer=\"part\" fill=\"#22c55e\" stroke="));
        assert!(r.contains("<circle fill=\"#000\"/>"));
        assert_eq!(
            with_layer_fill("  <g id=\"x\">\n  </g>\n", "#fff"),
            "  <g id=\"x\">\n  </g>\n"
        );
    }

    /// I casi del web (`sws-editor/tests/partiSimbolo.test.ts`).
    #[test]
    fn i_valori_delle_parti_sono_quelli_del_web() {
        use sws_core::tag::TagValue;
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
        let f: F = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/parti-simbolo.json"
        ))
        .unwrap();
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
                    (Some(ValoreParte::Aperta(x)), a) => {
                        a.get("aperta").map(|v| v.as_bool()) == Some(x)
                    }
                    (Some(ValoreParte::Posizione(x)), a) => {
                        a.get("posizione").map(|v| v.as_u64().map(|n| n as usize)) == Some(x)
                    }
                    (Some(ValoreParte::Accesa(x)), a) => {
                        a.get("accesa").map(|v| v.as_bool()) == Some(x)
                    }
                    (Some(ValoreParte::Active(x)), a) => {
                        a.get("active").map(|v| v.as_bool()) == Some(x)
                    }
                    (Some(ValoreParte::Entry(x)), a) => {
                        a.get("entry").map(|v| v.as_u64().map(|n| n as usize)) == Some(x)
                    }
                    (None, _) => false,
                };
                assert!(
                    ok,
                    "caso «{}», parte {id}: {trovato:?} contro {atteso}",
                    c.nome
                );
            }
        }
    }

    #[test]
    fn manometro_valvola_e_colonna_hanno_le_loro_parti() {
        let m = manifesto_incluso();
        let q = Quadro {
            w: 120,
            h: 120,
            flip_h: false,
            flip_v: false,
        };
        for (id, file, attese) in [
            (
                "lib:process/pressure-gauge",
                "process/pressure-gauge.svg",
                1usize,
            ),
            ("lib:process/ball-valve", "process/ball-valve.svg", 1),
        ] {
            let s = m.simbolo(id).unwrap();
            let svg = std::fs::read_to_string(format!(
                "{}/../../../sws-editor/public/symbols/lib/{file}",
                env!("CARGO_MANIFEST_DIR")
            ))
            .unwrap();
            let p = prepara(s, &svg, q, &stile_del_disegno(&m, None));
            let perni: Vec<_> = p
                .strati
                .iter()
                .filter_map(|x| {
                    if let PezzoStrato::Perno { perno, bitmap, .. } = x {
                        Some((*perno, bitmap.dove))
                    } else {
                        None
                    }
                })
                .collect();
            assert_eq!(perni.len(), attese, "{id}");
            let ((px, py), dove) = perni[0];
            assert!(
                px > 0 && py > 0 && (px as u32) < dove.w && (py as u32) < dove.h,
                "{id}: perno {px},{py} fuori dalla bitmap {dove:?}"
            );
        }
        let s = m.simbolo("lib:machines/stack-light").unwrap();
        let svg = std::fs::read_to_string(format!(
            "{}/../../../sws-editor/public/symbols/lib/machines/stack-light.svg",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        let p = prepara(
            s,
            &svg,
            Quadro {
                w: 30,
                h: 100,
                flip_h: false,
                flip_v: false,
            },
            &stile_del_disegno(&m, None),
        );
        assert_eq!(
            p.strati
                .iter()
                .filter(|x| matches!(x, PezzoStrato::Spia { .. }))
                .count(),
            3
        );
    }

    #[test]
    fn la_cache_non_butta_il_buffer_in_uso() {
        let mut c = CacheCorpo::default();
        for i in 0..COLORI_IN_CACHE as u8 {
            c.metti((i, 0, 0), vec![i], Some((0, 0, 0)));
        }
        c.metti((99, 0, 0), vec![99], Some((0, 0, 0)));
        assert!(c.prendi((0, 0, 0)).is_some(), "quello in uso resta");
        assert!(
            c.prendi((1, 0, 0)).is_none(),
            "il più vecchio non in uso esce"
        );
        assert!(c.prendi((99, 0, 0)).is_some());
    }
}
