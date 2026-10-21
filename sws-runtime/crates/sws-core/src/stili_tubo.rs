//! Gli stili 2.5D del tubo e le sue estremità (15-10-2026, piano
//! `docs/archive/2026-10-15-tubazioni-bocche-e-stili.md`, ramo B).
//!
//! Una funzione pura disegna il tubo come SVG, in coordinate di pagina: il web
//! lo mette nella pagina, il pannello LVGL lo rasterizza con resvg. Il gemello è
//! `sws-editor/src/canvas/stiliTubo.ts`, e i due devono produrre **la stessa
//! stringa**: i casi stanno in `tests/fixtures/stili-tubo.json`, insieme alla
//! tabella degli stili.
//!
//! Il tubo «vero» è quello dei disegni della libreria (`scripts/simboli/disegni.py`):
//! un materiale piatto con sopra una velatura **perpendicolare** al tratto e il
//! contorno degli strati. Qui la velatura è un gradiente per tratto, quindi
//! segue anche i tratti verticali (il gradiente unico di `tube` lì spariva).

use std::collections::BTreeMap;
use std::fmt::Write as _;

use crate::tubazioni::Punto;

/// Uno stile di tubo. Le larghezze sono frazioni del diametro `d`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stile {
    pub id: &'static str,
    /// Il materiale del corpo; `None` = il colore del tubo (`stroke`), o `colore`.
    pub materiale: Option<&'static str>,
    /// Il colore quando non c'è né materiale né `stroke`.
    pub colore: &'static str,
    pub larghezza: f64,
    /// `metal`, `paint`, `dark` o `""` (nessuna velatura).
    pub velo: &'static str,
    pub contorno: bool,
    /// `round` o `miter` (il canale HVAC ha gli spigoli).
    pub giunzione: &'static str,
    /// Tratteggio sopra il corpo: fascette, corrugazione, giunti del canale.
    /// (pieno, vuoto, colore, opacità).
    pub decoro: Option<(f64, f64, &'static str, f64)>,
    /// Tratteggio del corpo stesso (la linea di segnale).
    pub tratteggio: Option<(f64, f64)>,
    /// L'estremità consigliata, che `auto` mette su una bocca.
    pub estremita: &'static str,
}

/// La tabella degli stili nuovi. `flat`, `tube` e `wire` non sono qui: restano
/// disegnati come prima, dai loro motori.
pub const STILI: &[Stile] = &[
    Stile { id: "metallo", materiale: Some("steel"), colore: "#9aa5af", larghezza: 1.0, velo: "metal", contorno: true, giunzione: "round", decoro: None, tratteggio: None, estremita: "flange" },
    Stile { id: "inox", materiale: Some("stainless"), colore: "#b4bec7", larghezza: 1.0, velo: "metal", contorno: true, giunzione: "round", decoro: None, tratteggio: None, estremita: "welded" },
    Stile { id: "coibentato", materiale: Some("stainless"), colore: "#b4bec7", larghezza: 1.35, velo: "paint", contorno: true, giunzione: "round", decoro: Some((2.0, 36.0, "#000", 0.3)), tratteggio: None, estremita: "flange" },
    Stile { id: "pvc", materiale: None, colore: "#8e9ba6", larghezza: 1.0, velo: "paint", contorno: true, giunzione: "round", decoro: None, tratteggio: None, estremita: "union" },
    Stile { id: "flessibile", materiale: Some("rubber"), colore: "#2a2d31", larghezza: 0.9, velo: "dark", contorno: true, giunzione: "round", decoro: Some((1.6, 2.4, "#fff", 0.16)), tratteggio: None, estremita: "quick" },
    Stile { id: "canale", materiale: Some("stainless"), colore: "#b4bec7", larghezza: 1.6, velo: "paint", contorno: true, giunzione: "miter", decoro: Some((2.0, 58.0, "#000", 0.25)), tratteggio: None, estremita: "collar" },
    Stile { id: "cavo", materiale: None, colore: "#2a2d31", larghezza: 0.55, velo: "dark", contorno: true, giunzione: "round", decoro: None, tratteggio: None, estremita: "gland" },
    Stile { id: "segnale", materiale: None, colore: "#94a3b8", larghezza: 0.2, velo: "", contorno: false, giunzione: "round", decoro: None, tratteggio: Some((6.0, 4.0)), estremita: "none" },
];

pub fn stile(id: &str) -> Option<&'static Stile> {
    STILI.iter().find(|s| s.id == id)
}

/// I colori dei materiali che usano tubi ed estremità, come nella libreria
/// (`MATERIALI` del generatore): valgono quando lo stile del progetto non li
/// cambia.
pub const MATERIALI_TUBO: &[(&str, &str)] = &[
    ("rubber", "#2a2d31"),
    ("stainless", "#b4bec7"),
    ("steel", "#9aa5af"),
    ("steel-dark", "#4a545d"),
];

/// Le velature della libreria (`VELI` del generatore): (posizione, colore, opacità).
fn velo(nome: &str) -> &'static [(f64, &'static str, f64)] {
    match nome {
        "metal" => &[(0.0, "#000", 0.42), (0.18, "#fff", 0.85), (0.45, "#fff", 0.25), (0.8, "#000", 0.19), (1.0, "#000", 0.49)],
        "paint" => &[(0.0, "#000", 0.25), (0.2, "#fff", 0.5), (0.45, "#fff", 0.08), (0.75, "#000", 0.12), (1.0, "#000", 0.45)],
        "dark" => &[(0.0, "#fff", 0.1), (0.2, "#fff", 0.37), (0.6, "#000", 0.17), (1.0, "#000", 0.48)],
        _ => &[],
    }
}

/// Un numero come lo scrive JavaScript (`String(n)`), arrotondato al
/// centesimo: è ciò che rende identiche le due uscite.
pub fn num(v: f64) -> String {
    let r = (v * 100.0).round() / 100.0;
    let r = if r == 0.0 { 0.0 } else { r };
    format!("{r}")
}

/// Quello che serve per disegnare un tubo.
#[derive(Debug, Clone)]
pub struct Tubo<'a> {
    /// Prefisso degli id dei gradienti: unico per oggetto.
    pub id: &'a str,
    pub punti: &'a [Punto],
    pub stile: &'a Stile,
    /// Diametro nominale in pixel.
    pub d: f64,
    /// Il colore di stato o d'allarme, se c'è: vince sul materiale.
    pub colore_stato: Option<&'a str>,
    /// `stroke` dell'oggetto: il colore degli stili senza materiale.
    pub stroke: Option<&'a str>,
    /// I colori dei materiali dello stile del progetto (mancanti = `MATERIALI_TUBO`).
    pub materiali: &'a BTreeMap<String, String>,
    /// Il volume dello stile del progetto, 0…1: moltiplica l'opacità delle velature.
    pub volume: f64,
    /// Il contorno dello stile del progetto: (colore, larghezza).
    pub contorno: (&'a str, f64),
    /// Le estremità richieste (`start_marker`, `end_marker`): `auto` o un nome.
    pub estremita: [Option<&'a str>; 2],
    /// Il diametro della bocca a cui è agganciato ciascun capo, se è una bocca.
    pub bocche: [Option<f64>; 2],
}

fn materiale<'a>(t: &'a Tubo, nome: &str) -> String {
    t.materiali
        .get(nome)
        .cloned()
        .or_else(|| MATERIALI_TUBO.iter().find(|(k, _)| *k == nome).map(|(_, v)| v.to_string()))
        .unwrap_or_else(|| "#9aa5af".to_string())
}

/// Il colore del corpo: stato o allarme, poi il materiale, poi `stroke`, poi lo stile.
pub fn colore_corpo(t: &Tubo) -> String {
    if let Some(c) = t.colore_stato {
        return c.to_string();
    }
    match t.stile.materiale {
        Some(m) => materiale(t, m),
        None => t.stroke.unwrap_or(t.stile.colore).to_string(),
    }
}

/// La larghezza del corpo in pixel.
pub fn larghezza(stile: &Stile, d: f64) -> f64 {
    (d * stile.larghezza).max(1.5)
}

/// L'estremità che si disegna davvero su un capo: `auto` su una bocca è la
/// consigliata dallo stile, o la riduzione se tubo e bocca hanno misure diverse;
/// `auto` su un capo libero è nessuna.
pub fn estremita_effettiva(stile: &Stile, richiesta: Option<&str>, bocca: Option<f64>, w: f64) -> &'static str {
    let r = richiesta.unwrap_or("auto");
    let nomi = ["flange", "welded", "union", "quick", "reducer", "gland", "collar", "arrow", "dot"];
    if let Some(n) = nomi.iter().find(|n| **n == r) {
        return n;
    }
    if r != "auto" {
        return "none";
    }
    match bocca {
        Some(dp) if stile.giunzione == "round" && (w - dp).abs() > 0.15 * w.max(dp) => "reducer",
        Some(_) => stile.estremita,
        None => "none",
    }
}

fn polilinea(p: &[Punto]) -> String {
    let mut d = String::new();
    for (i, q) in p.iter().enumerate() {
        let _ = write!(d, "{}{} {}", if i == 0 { "M" } else { " L" }, num(q.x), num(q.y));
    }
    d
}

fn gradiente(out: &mut String, id: &str, nome: &str, volume: f64, da: (f64, f64), a: (f64, f64)) {
    let _ = write!(
        out,
        r#"<linearGradient id="{id}" gradientUnits="userSpaceOnUse" x1="{}" y1="{}" x2="{}" y2="{}">"#,
        num(da.0), num(da.1), num(a.0), num(a.1)
    );
    for (o, c, op) in velo(nome) {
        let _ = write!(out, r#"<stop offset="{}" stop-color="{c}" stop-opacity="{}"/>"#, num(*o), num(op * volume));
    }
    out.push_str("</linearGradient>");
}

/// La normale «di luce»: sempre verso il basso o verso destra, così la
/// velatura ha la luce dallo stesso lato qualunque sia il verso del tratto.
fn normale(ux: f64, uy: f64) -> (f64, f64) {
    (uy.abs(), ux.abs())
}

/// Quanti tratti per un quarto di curva: abbastanza perché la luce giri senza scatti.
const TRATTI_CURVA: usize = 6;

/// La spezzata con gli spigoli raccordati da un arco di raggio `r` (ridotto
/// se i tratti sono corti): così la velatura gira con la curva, come in un
/// gomito vero, invece di interrompersi sullo spigolo.
pub fn raccorda(p: &[Punto], r: f64) -> Vec<Punto> {
    if p.len() < 3 || r <= 0.0 {
        return p.to_vec();
    }
    let mut out = vec![p[0]];
    for i in 1..p.len() - 1 {
        let (a, b, c) = (p[i - 1], p[i], p[i + 1]);
        let (l1, l2) = ((b.x - a.x).hypot(b.y - a.y), (c.x - b.x).hypot(c.y - b.y));
        if l1 == 0.0 || l2 == 0.0 {
            out.push(b);
            continue;
        }
        let (u1, u2) = (((b.x - a.x) / l1, (b.y - a.y) / l1), ((c.x - b.x) / l2, (c.y - b.y) / l2));
        let coseno = (u1.0 * u2.0 + u1.1 * u2.1).clamp(-1.0, 1.0);
        let angolo = coseno.acos();
        if angolo < 1e-6 {
            out.push(b);
            continue;
        }
        // Quanto si arretra dallo spigolo lungo i due tratti.
        let arretra = (r * (angolo / 2.0).tan()).min(l1 / 2.0).min(l2 / 2.0);
        let p1 = Punto { x: b.x - u1.0 * arretra, y: b.y - u1.1 * arretra };
        let p2 = Punto { x: b.x + u2.0 * arretra, y: b.y + u2.1 * arretra };
        // Bézier quadratica con lo spigolo come controllo: per un raccordo
        // visivo basta, e si calcola uguale nei due motori.
        let n = ((angolo / std::f64::consts::FRAC_PI_2) * TRATTI_CURVA as f64).ceil().max(2.0) as usize;
        for k in 0..=n {
            let t = k as f64 / n as f64;
            let (m1, m2, m3) = ((1.0 - t) * (1.0 - t), 2.0 * (1.0 - t) * t, t * t);
            out.push(Punto { x: m1 * p1.x + m2 * b.x + m3 * p2.x, y: m1 * p1.y + m2 * b.y + m3 * p2.y });
        }
    }
    out.push(p[p.len() - 1]);
    out
}

/// Il tubo come frammento SVG (`<g>` con le sue `<defs>`), in coordinate di pagina.
pub fn svg(t: &Tubo) -> String {
    let mut out = String::new();
    let p = t.punti;
    if p.len() < 2 {
        return out;
    }
    let s = t.stile;
    let w = larghezza(s, t.d);
    let corpo = colore_corpo(t);
    // Con la freccia il corpo si ferma alla base del triangolo, non sulla punta
    // (osservazione del maintainer, 15-10-2026); la punta resta sul capo.
    let mut base = p.to_vec();
    for (k, i, j) in [(0usize, 0usize, 1usize), (1, p.len() - 1, p.len() - 2)] {
        if estremita_effettiva(s, t.estremita[k], t.bocche[k], w) == "arrow" {
            let (a, b) = (base[i], base[j]);
            let l = (b.x - a.x).hypot(b.y - a.y);
            let accorcia = (1.1 * w.max(6.0) - 1.0).min(l * 0.9);
            if l > 0.0 {
                base[i] = Punto { x: a.x + (b.x - a.x) / l * accorcia, y: a.y + (b.y - a.y) / l * accorcia };
            }
        }
    }
    // Il corpo segue la spezzata raccordata; le estremità, sotto, i punti veri.
    let curva = if s.giunzione == "round" { raccorda(&base, w) } else { base };
    let d = polilinea(&curva);
    let (join, cap) = if s.giunzione == "miter" { ("miter", "butt") } else { ("round", "butt") };
    let mut defs = String::new();
    let mut corpo_svg = String::new();

    if s.contorno && t.contorno.1 > 0.0 {
        let _ = write!(
            corpo_svg,
            r#"<path d="{d}" fill="none" stroke="{}" stroke-width="{}" stroke-linejoin="{join}" stroke-linecap="{cap}"/>"#,
            t.contorno.0,
            num(w + 2.0 * t.contorno.1)
        );
    }
    let tratto = s.tratteggio.map(|(a, b)| format!(r#" stroke-dasharray="{} {}""#, num(a), num(b))).unwrap_or_default();
    let _ = write!(
        corpo_svg,
        r#"<path d="{d}" fill="none" stroke="{corpo}" stroke-width="{}" stroke-linejoin="{join}" stroke-linecap="{cap}"{tratto}/>"#,
        num(w)
    );
    if !s.velo.is_empty() && t.volume > 0.0 {
        for (i, q) in curva.windows(2).enumerate() {
            let (dx, dy) = (q[1].x - q[0].x, q[1].y - q[0].y);
            let l = dx.hypot(dy);
            if l == 0.0 {
                continue;
            }
            let (nx, ny) = normale(dx / l, dy / l);
            let (mx, my) = ((q[0].x + q[1].x) / 2.0, (q[0].y + q[1].y) / 2.0);
            let gid = format!("{}-v{i}", t.id);
            gradiente(&mut defs, &gid, s.velo, t.volume, (mx - nx * w / 2.0, my - ny * w / 2.0), (mx + nx * w / 2.0, my + ny * w / 2.0));
            let _ = write!(
                corpo_svg,
                r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="url(#{gid})" stroke-width="{}" stroke-linecap="butt"/>"#,
                num(q[0].x), num(q[0].y), num(q[1].x), num(q[1].y), num(w)
            );
        }
    }
    if let Some((a, b, c, op)) = s.decoro {
        let _ = write!(
            corpo_svg,
            r#"<path d="{d}" fill="none" stroke="{c}" stroke-opacity="{}" stroke-width="{}" stroke-linejoin="{join}" stroke-linecap="butt" stroke-dasharray="{} {}"/>"#,
            num(op),
            num(w),
            num(a),
            num(b)
        );
    }

    // ── estremità ──
    let n = p.len();
    for (k, (punto, prima)) in [(p[0], p[1]), (p[n - 1], p[n - 2])].into_iter().enumerate() {
        let e = estremita_effettiva(s, t.estremita[k], t.bocche[k], w);
        let (dx, dy) = (punto.x - prima.x, punto.y - prima.y);
        let l = dx.hypot(dy);
        if e == "none" || l == 0.0 {
            continue;
        }
        let (ux, uy) = (dx / l, dy / l);
        let (nx, ny) = (-uy, ux);
        // Un punto nel riferimento del capo: `a` lungo il tubo (0 = il capo,
        // negativo = dentro il tubo), `b` di traverso.
        let at = |a: f64, b: f64| (punto.x + ux * a + nx * b, punto.y + uy * a + ny * b);
        let poligono = |pts: &[(f64, f64)]| pts.iter().map(|(x, y)| format!("{},{}", num(*x), num(*y))).collect::<Vec<_>>().join(" ");
        let pezzo = |out: &mut String, defs: &mut String, idx: usize, a0: f64, a1: f64, b: f64, mat: &str| {
            let colore = materiale(t, mat);
            let gid = format!("{}-e{k}{idx}", t.id);
            let (lx, ly) = normale(ux, uy);
            let (cx, cy) = at((a0 + a1) / 2.0, 0.0);
            gradiente(defs, &gid, "metal", t.volume, (cx - lx * b, cy - ly * b), (cx + lx * b, cy + ly * b));
            let pts = poligono(&[at(a0, -b), at(a1, -b), at(a1, b), at(a0, b)]);
            let bordo = if t.contorno.1 > 0.0 {
                format!(r#" stroke="{}" stroke-width="{}" stroke-linejoin="round""#, t.contorno.0, num(t.contorno.1))
            } else {
                String::new()
            };
            let _ = write!(out, r#"<polygon points="{pts}" fill="{colore}"{bordo}/><polygon points="{pts}" fill="url(#{gid})"/>"#);
        };
        match e {
            "flange" => pezzo(&mut corpo_svg, &mut defs, 0, -0.32 * w, 0.0, 0.82 * w, "steel"),
            "welded" => pezzo(&mut corpo_svg, &mut defs, 0, -0.14 * w, 0.0, 0.56 * w, "steel-dark"),
            "union" => {
                pezzo(&mut corpo_svg, &mut defs, 0, -0.95 * w, -0.15 * w, 0.72 * w, "steel");
                pezzo(&mut corpo_svg, &mut defs, 1, -0.15 * w, 0.0, 0.6 * w, "steel");
            }
            "quick" => {
                pezzo(&mut corpo_svg, &mut defs, 0, -1.0 * w, -0.45 * w, 0.66 * w, "steel");
                pezzo(&mut corpo_svg, &mut defs, 1, -0.45 * w, 0.0, 0.52 * w, "stainless");
            }
            "gland" => pezzo(&mut corpo_svg, &mut defs, 0, -0.8 * w, 0.0, 0.7 * w, "steel-dark"),
            "collar" => pezzo(&mut corpo_svg, &mut defs, 0, -0.42 * w, 0.0, 0.6 * w, "stainless"),
            "reducer" => {
                let dp = t.bocche[k].unwrap_or(w);
                let pts = poligono(&[at(-w, -w / 2.0), at(0.0, -dp / 2.0), at(0.0, dp / 2.0), at(-w, w / 2.0)]);
                let _ = write!(corpo_svg, r#"<polygon points="{pts}" fill="{corpo}"/>"#);
            }
            // Freccia e pallino hanno una misura minima: su una linea di segnale
            // larga 2 px sarebbero invisibili.
            "arrow" => {
                let m = w.max(6.0);
                let pts = poligono(&[at(0.0, 0.0), at(-1.1 * m, -0.85 * m), at(-1.1 * m, 0.85 * m)]);
                let _ = write!(corpo_svg, r#"<polygon points="{pts}" fill="{corpo}"/>"#);
            }
            "dot" => {
                let _ = write!(corpo_svg, r#"<circle cx="{}" cy="{}" r="{}" fill="{corpo}"/>"#, num(punto.x), num(punto.y), num(0.7 * w.max(6.0)));
            }
            _ => {}
        }
    }
    let _ = write!(out, r#"<g data-tubo="{}">"#, s.id);
    if !defs.is_empty() {
        let _ = write!(out, "<defs>{defs}</defs>");
    }
    out.push_str(&corpo_svg);
    out.push_str("</g>");
    out
}

/// Quanto le estremità e il contorno sporgono dalla spezzata, per il riquadro
/// da rasterizzare sul pannello.
pub fn margine(stile: &Stile, d: f64) -> f64 {
    larghezza(stile, d) * 1.2 + 4.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Fixture {
        stili: Vec<serde_json::Value>,
        casi: Vec<Caso>,
    }
    #[derive(Deserialize)]
    struct Caso {
        nome: String,
        punti: Vec<[f64; 2]>,
        stile: String,
        d: f64,
        #[serde(default)]
        colore_stato: Option<String>,
        #[serde(default)]
        stroke: Option<String>,
        #[serde(default)]
        materiali: BTreeMap<String, String>,
        volume: f64,
        contorno: (String, f64),
        estremita: [Option<String>; 2],
        bocche: [Option<f64>; 2],
        atteso: String,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../../../../tests/fixtures/stili-tubo.json")).unwrap()
    }

    pub(crate) fn esegui(c: &Caso) -> String {
        let punti: Vec<Punto> = c.punti.iter().map(|[x, y]| Punto { x: *x, y: *y }).collect();
        svg(&Tubo {
            id: "t",
            punti: &punti,
            stile: stile(&c.stile).unwrap(),
            d: c.d,
            colore_stato: c.colore_stato.as_deref(),
            stroke: c.stroke.as_deref(),
            materiali: &c.materiali,
            volume: c.volume,
            contorno: (&c.contorno.0, c.contorno.1),
            estremita: [c.estremita[0].as_deref(), c.estremita[1].as_deref()],
            bocche: c.bocche,
        })
    }

    #[test]
    fn la_tabella_degli_stili_e_quella_della_fixture() {
        let tabella: Vec<serde_json::Value> = STILI
            .iter()
            .map(|s| {
                serde_json::json!({
                    "id": s.id, "materiale": s.materiale, "colore": s.colore, "larghezza": s.larghezza,
                    "velo": s.velo, "contorno": s.contorno, "giunzione": s.giunzione,
                    "decoro": s.decoro.map(|(a, b, c, o)| serde_json::json!([a, b, c, o])),
                    "tratteggio": s.tratteggio.map(|(a, b)| serde_json::json!([a, b])),
                    "estremita": s.estremita,
                })
            })
            .collect();
        assert_eq!(tabella, fixture().stili);
    }

    #[test]
    fn i_tubi_come_nella_fixture() {
        for c in fixture().casi {
            assert_eq!(esegui(&c), c.atteso, "{}", c.nome);
        }
    }

    #[test]
    fn auto_mette_la_riduzione_solo_quando_le_misure_non_tornano() {
        let m = stile("metallo").unwrap();
        assert_eq!(estremita_effettiva(m, None, Some(10.0), 10.0), "flange");
        assert_eq!(estremita_effettiva(m, Some("auto"), Some(6.0), 10.0), "reducer");
        assert_eq!(estremita_effettiva(m, None, None, 10.0), "none");
        assert_eq!(estremita_effettiva(m, Some("dot"), None, 10.0), "dot");
        assert_eq!(estremita_effettiva(m, Some("sconosciuta"), Some(10.0), 10.0), "none");
        // Il canale è rettangolare: niente riduzione, il suo collare.
        assert_eq!(estremita_effettiva(stile("canale").unwrap(), None, Some(4.0), 16.0), "collar");
    }

    #[test]
    fn i_numeri_come_javascript() {
        assert_eq!(num(2.0), "2");
        assert_eq!(num(1.15), "1.15");
        assert_eq!(num(-0.001), "0");
        assert_eq!(num(0.1 + 0.2), "0.3");
    }

    /// Stampa le uscite: serve a rigenerare la fixture quando cambia il disegno
    /// (`cargo test -p sws-core stampa_fixture -- --ignored --nocapture`).
    #[test]
    #[ignore]
    fn stampa_fixture() {
        for c in fixture().casi {
            println!("{}\t{}", c.nome, esegui(&c));
        }
    }
}
