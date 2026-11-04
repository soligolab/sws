//! I simboli disegnati nel progetto: una **descrizione** che diventa lo stesso SVG
//! della libreria.
//!
//! Piano: `docs/plans/2026-11-03-assistente-genera-simboli-e-sinottici.md` (F1).
//!
//! # Perché una descrizione e non un SVG
//!
//! I due motori leggono i simboli di libreria **per strati**, e li dividono sul
//! formato testuale esatto che scrive `scripts/simboli/genera.py`
//! (`libreria.ts:preparaSimbolo`, `simbolo_lib.rs:dividi`); lo stile del progetto
//! ritinge i materiali e regola i veli a colpi di attributi (`stile_simboli.rs`).
//! Un SVG scritto da altri — a mano o da un modello — funziona sul web e rompe in
//! silenzio tutto il resto. Una descrizione invece non può uscire dalle regole:
//! è l'elenco delle chiamate a `Simbolo` di `genera.py` (forma, velo, parte,
//! flangia…), e questo modulo la compila **negli stessi byte** del generatore.
//!
//! La prova è il test `compila_come_genera_py`: tutta la libreria (195 simboli),
//! descritta da `genera.py --descrizioni` in `tests/fixtures/simboli-descrizioni.json`,
//! ricompilata qui e confrontata byte per byte con gli SVG committati.
//!
//! # Sicurezza
//!
//! Nessuna stringa della descrizione arriva all'SVG senza passare da una regola:
//! materiali e veli da una tabella chiusa, attributi extra da una lista bianca
//! con valori controllati, numeri come numeri, `d` dei path con la sola
//! grammatica dei comandi SVG. Quello che non passa è un errore, non un SVG.

use std::collections::BTreeMap;

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::simboli_lib::SimboloLib;

/// Il contorno degli strati: scala col disegno, lo ritinge lo stile.
pub const CONTORNO: &str = "#1c2329";

/// Materiali: nome → colore predefinito. Gemella di `MATERIALI` in `genera.py`
/// (la verifica il test `materiali_e_veli_come_il_manifesto`).
pub const MATERIALI: &[(&str, &str)] = &[
    ("steel", "#9aa5af"),
    ("steel-dark", "#4a545d"),
    ("stainless", "#b4bec7"),
    ("rubber", "#2a2d31"),
    ("glass-dark", "#1d2a35"),
    ("liquid", "#2b8fd6"),
    ("dial", "#eef1f3"),
    ("porcelain", "#8c4a2f"),
    ("porcelain-shed", "#a0583a"),
    ("label", "#d7dde2"),
    ("signal-red", "#c8352e"),
    ("safety-yellow", "#e3a51a"),
    ("warning-yellow", "#e0a91b"),
    ("gauge-green", "#3fae5a"),
    ("lamp-green", "#3fb950"),
    ("lamp-amber", "#e0a91b"),
    ("lamp-red", "#d13c32"),
    ("lamp-green-off", "#2f5a39"),
    ("lamp-amber-off", "#6e5a2c"),
    ("lamp-red-off", "#6b3a37"),
    ("pv-cell", "#1f3a5f"),
    ("pv-grid", "#7f9fc6"),
    ("impeller", "#1d3f62"),
    ("impeller-vane", "#9cc1e6"),
    ("body-pump", "#2f6fa8"),
    ("body-motor", "#5d6f7e"),
    ("cabinet", "#c8cdd2"),
    ("transformer", "#8a9196"),
    ("bulk", "#b9a37e"),
    ("body-boiler", "#a83a32"),
    ("body-furnace", "#6b4a3a"),
    ("flame", "#ff8c1a"),
    ("flame-core", "#ffd34d"),
    ("copper", "#b87333"),
    ("charge", "#3fb950"),
    ("instrument", "#4a7fb0"),
    ("appliance", "#e2e6ea"),
    ("wall", "#c9c2b6"),
    ("glass", "#9cc7e3"),
    ("gas", "#2e7d4f"),
    ("wood", "#b98a55"),
    ("cardboard", "#c49a63"),
];

/// Un velo: gradiente di solo bianco e nero trasparenti, sopra il colore piatto.
pub struct Velo {
    pub nome: &'static str,
    /// `linear` o `radial`.
    pub tipo: &'static str,
    pub geo: &'static [(&'static str, f64)],
    /// (offset, colore, opacità).
    pub stop: &'static [(f64, &'static str, f64)],
}

const LUCE_VERNICE: &[(f64, &str, f64)] = &[
    (0.0, "#000", 0.25),
    (0.2, "#fff", 0.5),
    (0.45, "#fff", 0.08),
    (0.75, "#000", 0.12),
    (1.0, "#000", 0.45),
];
const LUCE_METALLO: &[(f64, &str, f64)] = &[
    (0.0, "#000", 0.42),
    (0.18, "#fff", 0.85),
    (0.45, "#fff", 0.25),
    (0.8, "#000", 0.19),
    (1.0, "#000", 0.49),
];
const LUCE_SCURO: &[(f64, &str, f64)] = &[
    (0.0, "#fff", 0.1),
    (0.2, "#fff", 0.37),
    (0.6, "#000", 0.17),
    (1.0, "#000", 0.48),
];
const VERTICALE: &[(&str, f64)] = &[("x1", 0.0), ("y1", 0.0), ("x2", 0.0), ("y2", 1.0)];
const ORIZZONTALE: &[(&str, f64)] = &[("x1", 0.0), ("y1", 0.0), ("x2", 1.0), ("y2", 0.0)];

/// I veli, nell'ordine di `VELI` in `genera.py`.
pub const VELI: &[Velo] = &[
    Velo {
        nome: "paint-v",
        tipo: "linear",
        geo: VERTICALE,
        stop: LUCE_VERNICE,
    },
    Velo {
        nome: "paint-h",
        tipo: "linear",
        geo: ORIZZONTALE,
        stop: LUCE_VERNICE,
    },
    Velo {
        nome: "paint-r",
        tipo: "radial",
        geo: &[("cx", 0.36), ("cy", 0.3), ("r", 0.75)],
        stop: &[
            (0.0, "#fff", 0.55),
            (0.5, "#fff", 0.05),
            (1.0, "#000", 0.45),
        ],
    },
    Velo {
        nome: "paint-d",
        tipo: "linear",
        geo: &[("x1", 0.0), ("y1", 0.0), ("x2", 1.0), ("y2", 1.0)],
        stop: &[(0.0, "#fff", 0.35), (0.5, "#fff", 0.0), (1.0, "#000", 0.3)],
    },
    Velo {
        nome: "metal-v",
        tipo: "linear",
        geo: VERTICALE,
        stop: LUCE_METALLO,
    },
    Velo {
        nome: "metal-h",
        tipo: "linear",
        geo: ORIZZONTALE,
        stop: LUCE_METALLO,
    },
    Velo {
        nome: "metal-r",
        tipo: "radial",
        geo: &[("cx", 0.35), ("cy", 0.3), ("r", 0.8)],
        stop: &[(0.0, "#fff", 0.9), (0.5, "#fff", 0.13), (1.0, "#000", 0.46)],
    },
    Velo {
        nome: "dark-v",
        tipo: "linear",
        geo: VERTICALE,
        stop: LUCE_SCURO,
    },
    Velo {
        nome: "dark-h",
        tipo: "linear",
        geo: ORIZZONTALE,
        stop: LUCE_SCURO,
    },
    Velo {
        nome: "rubber-r",
        tipo: "radial",
        geo: &[("cx", 0.4), ("cy", 0.35), ("r", 0.7)],
        stop: &[(0.0, "#fff", 0.23), (0.7, "#fff", 0.0), (1.0, "#000", 0.52)],
    },
    Velo {
        nome: "dial-r",
        tipo: "radial",
        geo: &[("cx", 0.4), ("cy", 0.35), ("r", 0.75)],
        stop: &[(0.0, "#fff", 1.0), (0.7, "#fff", 0.0), (1.0, "#000", 0.14)],
    },
    Velo {
        nome: "glass-r",
        tipo: "radial",
        geo: &[("cx", 0.35), ("cy", 0.3), ("r", 0.7)],
        stop: &[(0.0, "#fff", 0.9), (0.3, "#fff", 0.25), (1.0, "#fff", 0.0)],
    },
];

/// I tipi di parte viva che i motori sanno muovere.
pub const TIPI_PARTE: &[&str] = &["level", "rotor", "needle", "lever", "lamp"];

/// Le forme ammesse. Sono le sole che la libreria usa, e le sole che LVGL
/// disegna senza sorprese.
pub const FORME: &[&str] = &["rect", "circle", "ellipse", "path"];

/// I lati di una bocca, nell'ordine in cui `porte()` assegna gli id.
const LATI: &[&str] = &["left", "top", "right", "bottom"];
/// Quanto una flangia può stare lontana dal bordo per contare come bocca.
const TOLLERANZA_BORDO: f64 = 2.0;

/// Limiti di una descrizione che arriva da fuori (dall'assistente, da un file):
/// la libreria ne usa al più 75 operazioni.
pub const MAX_OPERAZIONI: usize = 300;
/// Il lato massimo, come per la libreria: oltre, il pannello non lo rasterizza.
pub const MAX_LATO: u32 = 512;

pub fn colore_materiale(m: &str) -> Option<&'static str> {
    MATERIALI.iter().find(|(n, _)| *n == m).map(|(_, c)| *c)
}

pub fn velo(nome: &str) -> Option<&'static Velo> {
    VELI.iter().find(|v| v.nome == nome)
}

// ─────────────────────────────────────────────────────────────────────────────
// La descrizione
// ─────────────────────────────────────────────────────────────────────────────

/// Un valore di attributo: un numero, o un testo (un numero già formattato,
/// la `d` di un path, `round`, `none`…).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Valore {
    Num(f64),
    Testo(String),
}

/// Attributi **in ordine**: l'ordine decide i byte dell'SVG. Si leggono come
/// elenco di coppie `[["x", 4], ["y", 45]]` (è così che li scrive
/// `genera.py`) oppure come oggetto, più comodo da scrivere: allora l'ordine è
/// quello canonico della forma (`x y width height rx`, `cx cy r`, …) e poi
/// alfabetico.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct Attributi(pub Vec<(String, Valore)>);

const ORDINE_CANONICO: &[&str] = &[
    "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "d",
];

impl<'de> Deserialize<'de> for Attributi {
    fn deserialize<D: Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Forma {
            Coppie(Vec<(String, Valore)>),
            Oggetto(BTreeMap<String, Valore>),
        }
        Ok(match Forma::deserialize(de)? {
            Forma::Coppie(v) => Attributi(v),
            Forma::Oggetto(m) => {
                let mut v: Vec<(String, Valore)> = m.into_iter().collect();
                let rango = |k: &str| {
                    ORDINE_CANONICO
                        .iter()
                        .position(|c| *c == k)
                        .unwrap_or(usize::MAX)
                };
                v.sort_by(|a, b| rango(&a.0).cmp(&rango(&b.0)).then_with(|| a.0.cmp(&b.0)));
                Attributi(v)
            }
        })
    }
}

impl Attributi {
    fn get(&self, k: &str) -> Option<&Valore> {
        self.0.iter().find(|(n, _)| n == k).map(|(_, v)| v)
    }
    fn num(&self, k: &str) -> Option<f64> {
        match self.get(k)? {
            Valore::Num(n) => Some(*n),
            Valore::Testo(t) => t.trim().parse().ok(),
        }
    }
}

fn quattro() -> f64 {
    4.0
}
fn sedici() -> f64 {
    16.0
}
fn dieci() -> f64 {
    10.0
}
fn uno() -> f64 {
    1.0
}
fn diciotto_centesimi() -> f64 {
    0.18
}
fn vetro() -> String {
    "glass-r".into()
}

/// Una chiamata del disegno: le stesse di `Simbolo` in `genera.py`, più
/// quattro scorciatoie (`flangia_v`, `flangia_o`, `tubo_o`, `tubo_v`) che sono
/// gli attacchi di `disegni.py` e che si espandono prima di compilare.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    /// Un nuovo strato fermo, sopra quelli di prima.
    Statico,
    /// Lo strato `body`: le forme senza materiale prendono il colore del corpo,
    /// cioè dello stato.
    Corpo,
    /// Uno strato vivo: `kind` fra level, rotor, needle, lever, lamp, e la sua
    /// geometria in unità del viewBox.
    Parte {
        id: String,
        kind: String,
        #[serde(default)]
        geo: serde_json::Map<String, Value>,
    },
    /// Una forma piena: materiale (o il colore del corpo) e, se ha volume, un velo.
    Forma {
        tag: String,
        geo: Attributi,
        #[serde(default)]
        mat: Option<String>,
        #[serde(default)]
        velo: Option<String>,
        #[serde(default)]
        extra: Attributi,
    },
    /// Un riflesso di vetro: un velo senza forma piena sotto.
    Luce {
        tag: String,
        geo: Attributi,
        #[serde(default = "vetro")]
        velo: String,
        #[serde(default = "uno")]
        opacita: f64,
    },
    /// Un lampo di luce bianca.
    Riflesso {
        tag: String,
        geo: Attributi,
        #[serde(default = "diciotto_centesimi")]
        opacita: f64,
    },
    /// Una linea senza riempimento.
    Tratto {
        d: String,
        #[serde(default)]
        mat: Option<String>,
        #[serde(default)]
        extra: Attributi,
    },
    /// Una bocca dichiarata a mano, dove l'inferenza dalle flange non basta.
    Bocca {
        x: f64,
        y: f64,
        side: String,
        d: f64,
        #[serde(default)]
        id: Option<String>,
    },
    /// Registra una flangia già disegnata (la scrive `genera.py`).
    Flangia { rect: [f64; 4] },
    /// Registra un tronchetto già disegnato.
    Tronchetto { rect: [f64; 4] },
    /// Piastra verticale di un tubo orizzontale; sul bordo è una bocca.
    FlangiaV {
        x: f64,
        y: f64,
        #[serde(default = "quattro")]
        w: f64,
        #[serde(default = "sedici")]
        h: f64,
    },
    /// Piastra orizzontale di un tubo verticale.
    FlangiaO {
        x: f64,
        y: f64,
        #[serde(default = "sedici")]
        w: f64,
        #[serde(default = "quattro")]
        h: f64,
    },
    /// Tronchetto orizzontale (diametro 10).
    TuboO {
        x: f64,
        y: f64,
        w: f64,
        #[serde(default = "dieci")]
        h: f64,
    },
    /// Tronchetto verticale.
    TuboV {
        x: f64,
        y: f64,
        h: f64,
        #[serde(default = "dieci")]
        w: f64,
    },
}

/// Un simbolo descritto. Per la libreria `family` è una delle cinque famiglie e
/// l'etichetta è una chiave i18n; per un simbolo del progetto `family` manca e
/// `it`/`en` sono le etichette.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Descrizione {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    pub slug: String,
    pub w: u32,
    pub h: u32,
    /// La tipologia (`kind` nel manifesto): pumps, valves, machines…
    #[serde(default = "tipo_progetto")]
    pub tipo: String,
    /// Il materiale del corpo.
    pub body: String,
    pub it: String,
    pub en: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaces: Option<String>,
    pub ops: Vec<Op>,
}

fn tipo_progetto() -> String {
    "project".into()
}

impl Descrizione {
    /// L'id che gli oggetti scrivono in `symbol_id`.
    pub fn id(&self) -> String {
        match &self.family {
            Some(f) => format!("lib:{f}/{}", self.slug),
            None => format!("prj:{}", self.slug),
        }
    }
}

/// Quello che esce: l'SVG e la voce del manifesto, nella stessa forma di
/// `manifest.json`.
#[derive(Debug, Clone)]
pub struct Compilato {
    pub svg: String,
    pub voce: Value,
}

impl Compilato {
    /// La voce come la leggono i motori.
    pub fn simbolo(&self) -> Result<SimboloLib, String> {
        serde_json::from_value(self.voce.clone()).map_err(|e| format!("voce del manifesto: {e}"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// La compilazione
// ─────────────────────────────────────────────────────────────────────────────

/// Numero → testo stabile, come `fmt` di `genera.py`: al più due decimali,
/// niente zeri in coda, mai «-0».
pub fn fmt(v: f64) -> String {
    let s = format!("{:.2}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".into()
    } else {
        s.to_string()
    }
}

fn fmt_valore(v: &Valore) -> String {
    match v {
        Valore::Num(n) => fmt(*n),
        Valore::Testo(t) => t.clone(),
    }
}

/// Attributi in ordine; `stroke_width` → `stroke-width`.
fn attrs(a: &[(String, Valore)]) -> String {
    a.iter()
        .map(|(k, v)| format!(" {}=\"{}\"", k.replace('_', "-"), fmt_valore(v)))
        .collect()
}

fn testo(k: &str, v: &str) -> (String, Valore) {
    (k.to_string(), Valore::Testo(v.to_string()))
}

fn rect(x: f64, y: f64, w: f64, h: f64, rx: Option<f64>) -> Attributi {
    let mut a = vec![
        ("x".to_string(), Valore::Num(x)),
        ("y".to_string(), Valore::Num(y)),
        ("width".to_string(), Valore::Num(w)),
        ("height".to_string(), Valore::Num(h)),
    ];
    if let Some(r) = rx {
        a.push(("rx".to_string(), Valore::Num(r)));
    }
    Attributi(a)
}

/// Le scorciatoie diventano le chiamate che fanno in `disegni.py`.
pub fn espandi(ops: &[Op]) -> Vec<Op> {
    let forma = |geo: Attributi, velo: &str| Op::Forma {
        tag: "rect".into(),
        geo,
        mat: Some("steel".into()),
        velo: Some(velo.into()),
        extra: Attributi::default(),
    };
    let mut out = Vec::with_capacity(ops.len());
    for op in ops {
        match op {
            Op::FlangiaV { x, y, w, h } => {
                out.push(forma(rect(*x, *y, *w, *h, Some(0.8)), "metal-h"));
                out.push(Op::Flangia {
                    rect: [*x, *y, *w, *h],
                });
            }
            Op::FlangiaO { x, y, w, h } => {
                out.push(forma(rect(*x, *y, *w, *h, Some(0.8)), "metal-v"));
                out.push(Op::Flangia {
                    rect: [*x, *y, *w, *h],
                });
            }
            Op::TuboO { x, y, w, h } => {
                out.push(forma(rect(*x, *y, *w, *h, None), "metal-v"));
                out.push(Op::Tronchetto {
                    rect: [*x, *y, *w, *h],
                });
            }
            Op::TuboV { x, y, h, w } => {
                out.push(forma(rect(*x, *y, *w, *h, None), "metal-h"));
                out.push(Op::Tronchetto {
                    rect: [*x, *y, *w, *h],
                });
            }
            altro => out.push(altro.clone()),
        }
    }
    out
}

struct Strato {
    nome: String,
    attributi: Vec<(String, Valore)>,
    corpo: Vec<String>,
}

struct BoccaDichiarata {
    id: Option<String>,
    x: f64,
    y: f64,
    side: String,
    d: f64,
}

struct Costruzione<'a> {
    d: &'a Descrizione,
    defs: Vec<String>,
    veli_usati: Vec<&'static Velo>,
    strati: Vec<Strato>,
    parti: Vec<Value>,
    tronchetti: Vec<[f64; 4]>,
    flange: Vec<[f64; 4]>,
    bocche: Vec<BoccaDichiarata>,
    n: u32,
}

impl<'a> Costruzione<'a> {
    fn new(d: &'a Descrizione) -> Self {
        let mut c = Costruzione {
            d,
            defs: vec![],
            veli_usati: vec![],
            strati: vec![],
            parti: vec![],
            tronchetti: vec![],
            flange: vec![],
            bocche: vec![],
            n: 0,
        };
        c.statico();
        c
    }

    fn statico(&mut self) {
        let n = self
            .strati
            .iter()
            .filter(|s| s.nome.starts_with("layer-"))
            .count();
        self.strati.push(Strato {
            nome: format!("layer-{n}"),
            attributi: vec![testo("data-layer", "static")],
            corpo: vec![],
        });
    }

    fn qui(&mut self) -> &mut Vec<String> {
        &mut self.strati.last_mut().expect("c'è sempre uno strato").corpo
    }

    fn velo(&mut self, nome: &str) -> Result<String, String> {
        let v = velo(nome).ok_or_else(|| format!("velo sconosciuto «{nome}»"))?;
        if !self.veli_usati.iter().any(|u| u.nome == v.nome) {
            self.veli_usati.push(v);
        }
        Ok(format!("url(#{}-{})", self.d.slug, v.nome))
    }

    fn materiale(nome: &str) -> Result<Vec<(String, Valore)>, String> {
        let c = colore_materiale(nome).ok_or_else(|| format!("materiale sconosciuto «{nome}»"))?;
        Ok(vec![testo("fill", c), testo("data-mat", nome)])
    }

    fn esegui(&mut self, op: &Op) -> Result<(), String> {
        match op {
            Op::Statico => self.statico(),
            Op::Corpo => {
                let c = colore_materiale(&self.d.body)
                    .ok_or_else(|| format!("materiale del corpo sconosciuto «{}»", self.d.body))?;
                self.strati.push(Strato {
                    nome: "body".into(),
                    attributi: vec![
                        testo("data-layer", "part"),
                        testo("data-mat", &self.d.body),
                        testo("fill", c),
                    ],
                    corpo: vec![],
                });
            }
            Op::Parte { id, kind, geo } => {
                if !TIPI_PARTE.contains(&kind.as_str()) {
                    return Err(format!(
                        "parte «{id}»: tipo «{kind}» sconosciuto (sono {})",
                        TIPI_PARTE.join(", ")
                    ));
                }
                let mut p = serde_json::Map::new();
                p.insert("id".into(), json!(id));
                p.insert("kind".into(), json!(kind));
                for (k, v) in geo {
                    p.insert(k.clone(), v.clone());
                }
                self.parti.push(Value::Object(p));
                self.strati.push(Strato {
                    nome: id.clone(),
                    attributi: vec![testo("data-layer", "part")],
                    corpo: vec![],
                });
            }
            Op::Forma {
                tag,
                geo,
                mat,
                velo,
                extra,
            } => {
                let a = match mat {
                    Some(m) => Self::materiale(m)?,
                    None => vec![],
                };
                match velo {
                    None => {
                        let e =
                            format!("<{tag}{}{}{}/>", attrs(&geo.0), attrs(&a), attrs(&extra.0));
                        self.qui().push(e);
                    }
                    Some(v) => {
                        let url = self.velo(v)?;
                        self.n += 1;
                        let rif = format!("{}-g{}", self.d.slug, self.n);
                        self.defs
                            .push(format!("<{tag} id=\"{rif}\"{}/>", attrs(&geo.0)));
                        let pieno =
                            format!("<use href=\"#{rif}\"{}{}/>", attrs(&a), attrs(&extra.0));
                        let ombra = format!(
                            "<use href=\"#{rif}\" fill=\"{url}\" stroke=\"none\" opacity=\"1\" data-shade=\"{v}\"/>"
                        );
                        self.qui().push(pieno);
                        self.qui().push(ombra);
                    }
                }
            }
            Op::Luce {
                tag,
                geo,
                velo,
                opacita,
            } => {
                let url = self.velo(velo)?;
                let fo = if *opacita == 1.0 {
                    String::new()
                } else {
                    format!(" fill-opacity=\"{}\"", fmt(*opacita))
                };
                let e = format!(
                    "<{tag}{} fill=\"{url}\"{fo} stroke=\"none\" opacity=\"1\" data-shade=\"{velo}\"/>",
                    attrs(&geo.0)
                );
                self.qui().push(e);
            }
            Op::Riflesso { tag, geo, opacita } => {
                let e = format!(
                    "<{tag}{} fill=\"#fff\" fill-opacity=\"{}\" stroke=\"none\" opacity=\"1\" data-shade=\"highlight\"/>",
                    attrs(&geo.0),
                    fmt(*opacita)
                );
                self.qui().push(e);
            }
            Op::Tratto { d, mat, extra } => {
                let mut a = vec![testo("fill", "none")];
                if let Some(m) = mat {
                    let c = colore_materiale(m)
                        .ok_or_else(|| format!("materiale sconosciuto «{m}»"))?;
                    a.push(testo("stroke", c));
                    a.push(testo("data-mat-stroke", m));
                }
                let e = format!("<path d=\"{d}\"{}{}/>", attrs(&a), attrs(&extra.0));
                self.qui().push(e);
            }
            Op::Bocca { x, y, side, d, id } => {
                if !LATI.contains(&side.as_str()) {
                    return Err(format!(
                        "bocca: lato «{side}» sconosciuto (sono {})",
                        LATI.join(", ")
                    ));
                }
                self.bocche.push(BoccaDichiarata {
                    id: id.clone(),
                    x: *x,
                    y: *y,
                    side: side.clone(),
                    d: *d,
                });
            }
            Op::Flangia { rect } => self.flange.push(*rect),
            Op::Tronchetto { rect } => self.tronchetti.push(*rect),
            Op::FlangiaV { .. } | Op::FlangiaO { .. } | Op::TuboO { .. } | Op::TuboV { .. } => {
                unreachable!("le scorciatoie si espandono prima")
            }
        }
        Ok(())
    }

    /// Le bocche, come `Simbolo.porte()`: ogni flangia sul bordo del viewBox è
    /// una bocca, centrata sul tronchetto che la tocca, più quelle dichiarate.
    fn porte(&self) -> Vec<Value> {
        let (sw, sh) = (self.d.w as f64, self.d.h as f64);
        struct B {
            x: f64,
            y: f64,
            side: &'static str,
            d: f64,
            id: Option<String>,
        }
        let mut trovate: Vec<B> = Vec::new();
        for &[x, y, w, h] in &self.flange {
            let dist: [(&'static str, f64); 2] = if h >= w {
                [("left", x), ("right", sw - (x + w))]
            } else {
                [("top", y), ("bottom", sh - (y + h))]
            };
            // `min` di Python: a parità vince il primo.
            let (side, distanza) = if dist[1].1 < dist[0].1 {
                dist[1]
            } else {
                dist[0]
            };
            if distanza > TOLLERANZA_BORDO {
                continue;
            }
            let orizz = side == "left" || side == "right";
            let mut tubo: Option<[f64; 4]> = None;
            for &[tx, ty, tw, th] in &self.tronchetti {
                if orizz
                    && tw > th
                    && ty >= y - 0.5
                    && ty + th <= y + h + 0.5
                    && ((tx - (x + w)).abs() < 1.0
                        || (tx + tw - x).abs() < 1.0
                        || (tx <= x && x <= tx + tw))
                {
                    tubo = Some([tx, ty, tw, th]);
                }
                if !orizz
                    && th >= tw
                    && tx >= x - 0.5
                    && tx + tw <= x + w + 0.5
                    && ((ty - (y + h)).abs() < 1.0
                        || (ty + th - y).abs() < 1.0
                        || (ty <= y && y <= ty + th))
                {
                    tubo = Some([tx, ty, tw, th]);
                }
            }
            if orizz {
                let (cy, d) = match tubo {
                    Some(t) => (t[1] + t[3] / 2.0, t[3]),
                    None => (y + h / 2.0, h - 6.0),
                };
                let px = if side == "left" { 0.0 } else { sw };
                trovate.push(B {
                    x: px,
                    y: round2(cy),
                    side,
                    d,
                    id: None,
                });
            } else {
                let (cx, d) = match tubo {
                    Some(t) => (t[0] + t[2] / 2.0, t[2]),
                    None => (x + w / 2.0, w - 6.0),
                };
                let py = if side == "top" { 0.0 } else { sh };
                trovate.push(B {
                    x: round2(cx),
                    y: py,
                    side,
                    d,
                    id: None,
                });
            }
        }
        for b in &self.bocche {
            let side = LATI
                .iter()
                .find(|l| **l == b.side)
                .copied()
                .unwrap_or("left");
            trovate.push(B {
                x: b.x,
                y: b.y,
                side,
                d: b.d,
                id: b.id.clone(),
            });
        }
        let mut uniche: Vec<B> = Vec::new();
        for b in trovate {
            if !uniche
                .iter()
                .any(|u| u.side == b.side && (u.x - b.x).abs() < 1.0 && (u.y - b.y).abs() < 1.0)
            {
                uniche.push(b);
            }
        }
        let mut out = Vec::new();
        for side in LATI {
            let mut del_lato: Vec<&B> = uniche.iter().filter(|b| b.side == *side).collect();
            del_lato.sort_by(|a, b| {
                a.x.partial_cmp(&b.x)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal))
            });
            for (i, b) in del_lato.iter().enumerate() {
                let id = b.id.clone().unwrap_or_else(|| {
                    if i == 0 {
                        format!("n-{side}")
                    } else {
                        format!("n-{side}-{}", i + 1)
                    }
                });
                out.push(json!({ "id": id, "x": b.x, "y": b.y, "side": b.side, "d": b.d }));
            }
        }
        out
    }

    fn svg(&self) -> String {
        let (w, h, slug) = (self.d.w, self.d.h, &self.d.slug);
        let mut r = vec![format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\">"
        )];
        r.push("  <defs>".into());
        for v in &self.veli_usati {
            let geo: Vec<(String, Valore)> = v
                .geo
                .iter()
                .map(|(k, n)| (k.to_string(), Valore::Num(*n)))
                .collect();
            r.push(format!(
                "    <{}Gradient id=\"{slug}-{}\"{}>",
                v.tipo,
                v.nome,
                attrs(&geo)
            ));
            for (o, c, a) in v.stop {
                r.push(format!(
                    "      <stop offset=\"{}\" stop-color=\"{c}\" stop-opacity=\"{}\"/>",
                    fmt(*o),
                    fmt(*a)
                ));
            }
            r.push(format!("    </{}Gradient>", v.tipo));
        }
        for d in &self.defs {
            r.push(format!("    {d}"));
        }
        r.push("  </defs>".into());
        for s in &self.strati {
            if s.corpo.is_empty() {
                continue;
            }
            let mut base = vec![testo("id", &s.nome)];
            base.extend(s.attributi.iter().cloned());
            base.push(testo("stroke", CONTORNO));
            base.push(("stroke-width".into(), Valore::Num(1.0)));
            base.push(testo("stroke-linejoin", "round"));
            r.push(format!("  <g{}>", attrs(&base)));
            for e in &s.corpo {
                r.push(format!("    {e}"));
            }
            r.push("  </g>".into());
        }
        r.push("</svg>".into());
        r.join("\n") + "\n"
    }

    fn voce(&self, svg: &str) -> Value {
        let d = self.d;
        let mut materiali: Vec<String> = Vec::new();
        for chiave in ["data-mat=\"", "data-mat-stroke=\""] {
            let mut resto = svg;
            while let Some(i) = resto.find(chiave) {
                resto = &resto[i + chiave.len()..];
                if let Some(j) = resto.find('"') {
                    materiali.push(resto[..j].to_string());
                }
            }
        }
        materiali.sort();
        materiali.dedup();
        let (id, file, family, label) = match &d.family {
            Some(f) => (
                format!("lib:{f}/{}", d.slug),
                format!("{f}/{}.svg", d.slug),
                f.clone(),
                format!("symbols.lib.{f}.{}", d.slug),
            ),
            None => (
                format!("prj:{}", d.slug),
                format!("prj/{}.svg", d.slug),
                "project".to_string(),
                d.it.clone(),
            ),
        };
        let mut v = json!({
            "id": id, "file": file, "family": family, "kind": d.tipo, "label": label,
            "viewBox": [d.w, d.h], "body": d.body, "materials": materiali, "parts": self.parti,
        });
        let porte = self.porte();
        if !porte.is_empty() {
            v["ports"] = Value::Array(porte);
        }
        if let Some(r) = &d.replaces {
            v["replaces"] = json!(r);
        }
        if d.family.is_none() {
            // Un simbolo del progetto non ha chiavi in it.json: le etichette
            // viaggiano con lui.
            v["labels"] = json!({ "it": d.it, "en": d.en });
        }
        v
    }
}

/// `round(v, 2)` di Python.
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Compila una descrizione nell'SVG e nella voce del manifesto. Gli errori sono
/// quelli che impediscono di disegnare (un materiale che non esiste); le regole
/// di forma le controlla [`regole`].
pub fn compila(d: &Descrizione) -> Result<Compilato, String> {
    let mut c = Costruzione::new(d);
    for op in espandi(&d.ops) {
        c.esegui(&op)?;
    }
    let svg = c.svg();
    let voce = c.voce(&svg);
    Ok(Compilato { svg, voce })
}

// ─────────────────────────────────────────────────────────────────────────────
// Le regole
// ─────────────────────────────────────────────────────────────────────────────

/// Gli attributi extra ammessi, e cosa possono valere. Sono quelli che la
/// libreria usa: nessun colore libero, nessun riferimento esterno.
fn extra_ammesso(k: &str, v: &Valore) -> Result<(), String> {
    let numero = |v: &Valore, min: f64, max: f64| match v {
        Valore::Num(n) if n.is_finite() && *n >= min && *n <= max => Ok(()),
        _ => Err(format!("«{k}» vuole un numero fra {min} e {max}")),
    };
    let fra = |v: &Valore, ammessi: &[&str]| match v {
        Valore::Testo(t) if ammessi.contains(&t.as_str()) => Ok(()),
        _ => Err(format!("«{k}» vale uno di: {}", ammessi.join(", "))),
    };
    match k {
        "stroke_width" => numero(v, 0.0, 20.0),
        "stroke_opacity" | "fill_opacity" => numero(v, 0.0, 1.0),
        "stroke_linecap" => fra(v, &["butt", "round", "square"]),
        "stroke_linejoin" => fra(v, &["round", "miter", "bevel"]),
        "stroke" | "fill" => fra(v, &["none"]),
        "stroke_dasharray" => match v {
            Valore::Testo(t)
                if !t.is_empty() && t.split_whitespace().all(|p| p.parse::<f64>().is_ok()) =>
            {
                Ok(())
            }
            Valore::Num(n) if *n > 0.0 => Ok(()),
            _ => Err(format!("«{k}» vuole numeri separati da spazi")),
        },
        _ => Err(format!(
            "attributo «{k}» non ammesso (sono stroke_width, stroke_opacity, fill_opacity, \
             stroke_linecap, stroke_linejoin, stroke_dasharray, stroke e fill solo «none»)"
        )),
    }
}

/// Gli attributi che un'operazione scrive sul suo elemento, per trovare quelli
/// ripetuti: un SVG con `fill` due volte sullo stesso elemento non è XML valido,
/// e il browser (in un `<img>`) e resvg sul pannello lo rifiutano intero. La
/// libreria non lo fa mai; un modello sì — una forma col materiale, che scrive
/// già `fill`, e in più `fill: none` negli extra (visto il 03-11-2026 sulla
/// formatrice e la saldatrice di una «Linea tubi»).
fn attributo_ripetuto(op: &Op) -> Option<String> {
    let chiave = |k: &String| k.replace('_', "-");
    let mut nomi: Vec<String> = Vec::new();
    match op {
        Op::Forma {
            geo, mat, extra, ..
        } => {
            nomi.extend(geo.0.iter().map(|(k, _)| chiave(k)));
            if mat.is_some() {
                nomi.extend(["fill".into(), "data-mat".into()]);
            }
            nomi.extend(extra.0.iter().map(|(k, _)| chiave(k)));
        }
        Op::Tratto { mat, extra, .. } => {
            nomi.extend(["d".into(), "fill".into()]);
            if mat.is_some() {
                nomi.extend(["stroke".into(), "data-mat-stroke".into()]);
            }
            nomi.extend(extra.0.iter().map(|(k, _)| chiave(k)));
        }
        Op::Luce { geo, .. } | Op::Riflesso { geo, .. } => {
            nomi.extend(geo.0.iter().map(|(k, _)| chiave(k)))
        }
        _ => return None,
    }
    nomi.iter()
        .enumerate()
        .find(|(i, n)| nomi[..*i].contains(n))
        .map(|(_, n)| n.clone())
}

/// La `d` di un path: solo comandi SVG e numeri.
fn path_ammesso(d: &str) -> bool {
    !d.trim().is_empty()
        && d.len() <= 4000
        && d.chars()
            .all(|c| "MmLlHhVvCcSsQqTtAaZz0123456789.,-+eE ".contains(c))
}

fn numero_o_testo_numerico(v: &Valore) -> bool {
    match v {
        Valore::Num(n) => n.is_finite(),
        Valore::Testo(t) => t
            .trim()
            .parse::<f64>()
            .map(|n| n.is_finite())
            .unwrap_or(false),
    }
}

fn nome_ammesso(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

/// Il riquadro di una forma, se la forma ne ha uno semplice.
fn riquadro(tag: &str, geo: &Attributi) -> Option<(f64, f64, f64, f64)> {
    match tag {
        "rect" => Some((
            geo.num("x")?,
            geo.num("y")?,
            geo.num("width")?,
            geo.num("height")?,
        )),
        "circle" => {
            let (cx, cy, r) = (geo.num("cx")?, geo.num("cy")?, geo.num("r")?);
            Some((cx - r, cy - r, 2.0 * r, 2.0 * r))
        }
        "ellipse" => {
            let (cx, cy, rx, ry) = (
                geo.num("cx")?,
                geo.num("cy")?,
                geo.num("rx")?,
                geo.num("ry")?,
            );
            Some((cx - rx, cy - ry, 2.0 * rx, 2.0 * ry))
        }
        _ => None,
    }
}

/// Le regole di `regole()` in `genera.py` (tolte quelle sulle etichette i18n e
/// sui builtin, che valgono solo per la libreria), più quelle che servono a una
/// descrizione arrivata da fuori: forme, attributi e numeri ammessi, geometria
/// dentro il disegno. Vuoto = buona.
pub fn regole(d: &Descrizione, c: &Compilato) -> Vec<String> {
    let mut male = Vec::new();
    let (w, h) = (d.w as f64, d.h as f64);

    // ── chi è ──
    if !nome_ammesso(&d.slug, 3, 40) {
        male.push(format!(
            "slug «{}»: da 3 a 40 caratteri fra a-z, 0-9 e «-»",
            d.slug
        ));
    }
    if !nome_ammesso(&d.tipo, 2, 30) {
        male.push(format!(
            "tipo «{}»: da 2 a 30 caratteri fra a-z, 0-9 e «-»",
            d.tipo
        ));
    }
    for (l, t) in [("it", &d.it), ("en", &d.en)] {
        if t.trim().is_empty() || t.chars().count() > 60 || t.chars().any(|c| "<>\"&".contains(c)) {
            male.push(format!(
                "etichetta {l} «{t}»: da 1 a 60 caratteri, senza < > \" &"
            ));
        }
    }
    if colore_materiale(&d.body).is_none() {
        male.push(format!("materiale del corpo «{}» sconosciuto", d.body));
    }
    if d.w.max(d.h) > MAX_LATO {
        male.push(format!(
            "viewBox {}×{} oltre i {MAX_LATO} del pannello",
            d.w, d.h
        ));
    }
    if d.w < 10 || d.h < 10 || !d.w.is_multiple_of(10) || !d.h.is_multiple_of(10) {
        male.push(format!("viewBox {}×{} non multiplo di 10", d.w, d.h));
    }
    if d.ops.len() > MAX_OPERAZIONI {
        male.push(format!(
            "{} operazioni: al più {MAX_OPERAZIONI}",
            d.ops.len()
        ));
    }

    // ── le operazioni ──
    // Alcune regole valgono solo per un simbolo del progetto: la libreria ha
    // due casi storici (una forma che sborda di qualche decimo, due lampade
    // con lo stesso id nella macchina del caffè) che i motori reggono.
    let del_progetto = d.family.is_none();
    let fuori = |x: f64, y: f64, ww: f64, hh: f64| {
        x < -1.0 || y < -1.0 || x + ww > w + 1.0 || y + hh > h + 1.0
    };
    let mut ids_parti: Vec<&str> = Vec::new();
    for (i, op) in espandi(&d.ops).iter().enumerate() {
        let dove = format!("operazione {}", i + 1);
        if let Some(a) = attributo_ripetuto(op) {
            male.push(format!(
                "{dove}: l'attributo «{a}» c'è due volte (col materiale `fill`/`stroke` li scrive già lui; \
                 un tratto ha già fill none): l'SVG non sarebbe valido"
            ));
        }
        let controlla_forma = |tag: &str, geo: &Attributi, male: &mut Vec<String>| {
            if !FORME.contains(&tag) {
                male.push(format!(
                    "{dove}: forma «{tag}» non ammessa (sono {})",
                    FORME.join(", ")
                ));
                return;
            }
            for (k, v) in &geo.0 {
                let ok = if k == "d" {
                    matches!(v, Valore::Testo(t) if path_ammesso(t))
                } else {
                    ORDINE_CANONICO.contains(&k.as_str()) && numero_o_testo_numerico(v)
                };
                if !ok {
                    male.push(format!("{dove}: attributo di forma «{k}» non valido"));
                }
            }
            if let Some((x, y, ww, hh)) = riquadro(tag, geo) {
                if ww < 0.0 || hh < 0.0 || (del_progetto && fuori(x, y, ww, hh)) {
                    male.push(format!("{dove}: la forma esce dal disegno {}×{}", d.w, d.h));
                }
            } else if tag != "path" {
                male.push(format!("{dove}: «{tag}» senza la sua geometria"));
            }
        };
        match op {
            Op::Forma {
                tag,
                geo,
                mat,
                velo: v,
                extra,
            } => {
                controlla_forma(tag, geo, &mut male);
                if let Some(m) = mat {
                    if colore_materiale(m).is_none() {
                        male.push(format!("{dove}: materiale «{m}» sconosciuto"));
                    }
                }
                if let Some(v) = v {
                    if velo(v).is_none() {
                        male.push(format!("{dove}: velo «{v}» sconosciuto"));
                    }
                }
                for (k, val) in &extra.0 {
                    if let Err(e) = extra_ammesso(k, val) {
                        male.push(format!("{dove}: {e}"));
                    }
                }
            }
            Op::Luce {
                tag,
                geo,
                velo: v,
                opacita,
            } => {
                controlla_forma(tag, geo, &mut male);
                if velo(v).is_none() {
                    male.push(format!("{dove}: velo «{v}» sconosciuto"));
                }
                if !(0.0..=1.0).contains(opacita) {
                    male.push(format!("{dove}: opacità {opacita} fuori da 0–1"));
                }
            }
            Op::Riflesso { tag, geo, opacita } => {
                controlla_forma(tag, geo, &mut male);
                if !(0.0..=1.0).contains(opacita) {
                    male.push(format!("{dove}: opacità {opacita} fuori da 0–1"));
                }
            }
            Op::Tratto { d: dd, mat, extra } => {
                if !path_ammesso(dd) {
                    male.push(format!(
                        "{dove}: la «d» del tratto ammette solo comandi SVG e numeri"
                    ));
                }
                if let Some(m) = mat {
                    if colore_materiale(m).is_none() {
                        male.push(format!("{dove}: materiale «{m}» sconosciuto"));
                    }
                }
                for (k, val) in &extra.0 {
                    if let Err(e) = extra_ammesso(k, val) {
                        male.push(format!("{dove}: {e}"));
                    }
                }
            }
            Op::Parte { id, .. } => {
                if !nome_ammesso(id, 2, 30) || id == "body" || id.starts_with("layer-") {
                    male.push(format!("{dove}: id di parte «{id}» non valido (a-z, 0-9, «-»; non body né layer-N)"));
                }
                if del_progetto && ids_parti.contains(&id.as_str()) {
                    male.push(format!("{dove}: due parti con l'id «{id}»"));
                }
                ids_parti.push(id);
            }
            Op::Bocca { id: Some(id), .. } if !nome_ammesso(id, 2, 30) => {
                male.push(format!("{dove}: id di bocca «{id}» non valido"));
            }
            _ => {}
        }
    }

    // ── il risultato ──
    let svg = &c.svg;
    if !svg.contains("<g id=\"body\"") {
        male.push("manca lo strato body (serve un «corpo» con almeno una forma)".into());
    }
    let parti: Vec<Value> = c.voce["parts"].as_array().cloned().unwrap_or_default();
    for p in &parti {
        let id = p["id"].as_str().unwrap_or("");
        if !svg.contains(&format!("<g id=\"{id}\"")) {
            male.push(format!(
                "la parte {id} non ha forme: lo strato resterebbe vuoto"
            ));
        }
        if let Err(e) = serde_json::from_value::<crate::simboli_lib::ParteLib>(p.clone()) {
            male.push(format!(
                "la parte {id} non ha la geometria del suo tipo: {e}"
            ));
            continue;
        }
        // La geometria delle parti sta nel disegno.
        let n = |k: &str| p.get(k).and_then(Value::as_f64);
        for (kx, ky) in [("cx", "cy"), ("x", "y")] {
            if let (Some(x), Some(y)) = (n(kx), n(ky)) {
                if fuori(x, y, n("w").unwrap_or(0.0), n("h").unwrap_or(0.0)) {
                    male.push(format!("la parte {id} esce dal disegno"));
                }
            }
        }
    }
    let porte: Vec<Value> = c.voce["ports"].as_array().cloned().unwrap_or_default();
    let mut visti = Vec::new();
    for p in &porte {
        let id = p["id"].as_str().unwrap_or("");
        if visti.contains(&id) {
            male.push("due bocche con lo stesso id".into());
        }
        visti.push(id);
        let (x, y, dd) = (
            p["x"].as_f64().unwrap_or(-1.0),
            p["y"].as_f64().unwrap_or(-1.0),
            p["d"].as_f64().unwrap_or(0.0),
        );
        let side = p["side"].as_str().unwrap_or("");
        let dichiarata = d
            .ops
            .iter()
            .any(|o| matches!(o, Op::Bocca { x: bx, y: by, .. } if *bx == x && *by == y));
        if dichiarata {
            if !(0.0..=w).contains(&x) || !(0.0..=h).contains(&y) {
                male.push(format!("la bocca {id} sta fuori dal disegno ({x}, {y})"));
            }
            continue;
        }
        let sul_bordo = match side {
            "left" => x == 0.0,
            "right" => x == w,
            "top" => y == 0.0,
            "bottom" => y == h,
            _ => false,
        };
        if !sul_bordo || !(0.0..=w).contains(&x) || !(0.0..=h).contains(&y) {
            male.push(format!("la bocca {id} non sta sul bordo {side} ({x}, {y})"));
        }
        if dd <= 0.0 {
            male.push(format!("la bocca {id} ha diametro {dd}"));
        }
    }
    male
}

/// Compila e controlla: la via di chi riceve una descrizione da fuori.
pub fn compila_e_controlla(d: &Descrizione) -> Result<Compilato, Vec<String>> {
    let c = compila(d).map_err(|e| vec![e])?;
    let male = regole(d, &c);
    if male.is_empty() {
        Ok(c)
    } else {
        Err(male)
    }
}

/// Il manifesto dei simboli del progetto, nella forma di `manifest.json`. La
/// versione è l'impronta degli SVG: cambia quando cambia un disegno, ed è il
/// `?v=` che i motori mettono in coda all'URL.
pub fn manifesto(simboli: &[Descrizione]) -> (Value, BTreeMap<String, String>) {
    use sha2::{Digest, Sha256};
    let mut file = BTreeMap::new();
    let mut voci = Vec::new();
    let mut h = Sha256::new();
    for d in simboli {
        // Un simbolo che non compila più (una descrizione scritta a mano nel
        // file) si salta: meglio un segnaposto sul disegno che un manifesto
        // che non si legge.
        let Ok(c) = compila_e_controlla(d) else {
            continue;
        };
        let nome = format!("prj/{}.svg", d.slug);
        h.update(nome.as_bytes());
        h.update(c.svg.as_bytes());
        file.insert(nome, c.svg);
        voci.push(c.voce);
    }
    let versione: String = h
        .finalize()
        .iter()
        .take(6)
        .map(|b| format!("{b:02x}"))
        .collect();
    let materiali: BTreeMap<&str, &str> = MATERIALI.iter().copied().collect();
    (
        json!({ "version": versione, "materials": materiali, "symbols": voci }),
        file,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const RADICE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");

    fn descrizioni_della_libreria() -> Vec<Descrizione> {
        #[derive(Deserialize)]
        struct File {
            simboli: Vec<Descrizione>,
        }
        let testo =
            std::fs::read_to_string(format!("{RADICE}/tests/fixtures/simboli-descrizioni.json"))
                .unwrap();
        serde_json::from_str::<File>(&testo).unwrap().simboli
    }

    /// Due valori JSON uguali, con i numeri confrontati come numeri: il
    /// manifesto di Python scrive `50.0` dove qui esce `50`.
    fn uguali(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => {
                (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-9
            }
            (Value::Array(x), Value::Array(y)) => {
                x.len() == y.len() && x.iter().zip(y).all(|(p, q)| uguali(p, q))
            }
            (Value::Object(x), Value::Object(y)) => {
                x.len() == y.len()
                    && x.iter()
                        .all(|(k, v)| y.get(k).is_some_and(|w| uguali(v, w)))
            }
            _ => a == b,
        }
    }

    /// La prova che la descrizione **è** il formato: tutta la libreria,
    /// ricompilata qui, dà gli stessi byte di `genera.py` e le stesse voci del
    /// manifesto. Se fallisce dopo un cambio di `genera.py`, il gemello va
    /// aggiornato qui.
    #[test]
    fn compila_come_genera_py() {
        let manifesto: Value = serde_json::from_str(
            &std::fs::read_to_string(format!(
                "{RADICE}/sws-editor/public/symbols/lib/manifest.json"
            ))
            .unwrap(),
        )
        .unwrap();
        let voci = manifesto["symbols"].as_array().unwrap();
        let descrizioni = descrizioni_della_libreria();
        assert_eq!(descrizioni.len(), voci.len(), "una descrizione per simbolo");
        let mut diversi = Vec::new();
        for d in &descrizioni {
            let c = compila(d).unwrap_or_else(|e| panic!("{}: {e}", d.slug));
            let fam = d.family.as_deref().unwrap();
            let atteso = std::fs::read_to_string(format!(
                "{RADICE}/sws-editor/public/symbols/lib/{fam}/{}.svg",
                d.slug
            ))
            .unwrap();
            if c.svg != atteso {
                let riga = c.svg.lines().zip(atteso.lines()).find(|(a, b)| a != b);
                diversi.push(format!(
                    "{fam}/{}: SVG diverso, prima riga: {riga:?}",
                    d.slug
                ));
            }
            let voce = voci
                .iter()
                .find(|v| v["id"] == d.id())
                .expect("voce nel manifesto");
            if !uguali(&c.voce, voce) {
                diversi.push(format!(
                    "{fam}/{}: voce diversa\n  qui:   {}\n  python: {}",
                    d.slug, c.voce, voce
                ));
            }
        }
        assert!(
            diversi.is_empty(),
            "{} simboli diversi:\n{}",
            diversi.len(),
            diversi.join("\n")
        );
    }

    /// Le regole valgono anche per la libreria: nessun simbolo le viola.
    #[test]
    fn la_libreria_rispetta_le_regole() {
        let mut male = Vec::new();
        for d in descrizioni_della_libreria() {
            let c = compila(&d).unwrap();
            for m in regole(&d, &c) {
                male.push(format!("{}: {m}", d.slug));
            }
        }
        assert!(male.is_empty(), "{}", male.join("\n"));
    }

    #[test]
    fn materiali_e_veli_come_il_manifesto() {
        let manifesto: Value = serde_json::from_str(
            &std::fs::read_to_string(format!(
                "{RADICE}/sws-editor/public/symbols/lib/manifest.json"
            ))
            .unwrap(),
        )
        .unwrap();
        let m = manifesto["materials"].as_object().unwrap();
        assert_eq!(m.len(), MATERIALI.len());
        for (n, c) in MATERIALI {
            assert_eq!(m[*n], *c, "materiale {n}");
        }
    }

    #[test]
    fn fmt_come_python() {
        for (v, atteso) in [
            (0.0, "0"),
            (-0.001, "0"),
            (1.5, "1.5"),
            (0.8, "0.8"),
            (40.0, "40"),
            (12.345, "12.35"),
            (-3.1, "-3.1"),
        ] {
            assert_eq!(fmt(v), atteso, "fmt({v})");
        }
    }

    /// Un simbolo scritto come lo scriverebbe l'assistente: oggetti per gli
    /// attributi, scorciatoie per gli attacchi.
    fn gabbia() -> Descrizione {
        serde_json::from_value(json!({
            "slug": "gabbia-laminazione", "w": 120, "h": 100, "tipo": "machines",
            "body": "body-motor", "it": "Gabbia di laminazione", "en": "Rolling stand",
            "ops": [
                { "op": "tubo_o", "x": 4, "y": 45, "w": 20 }, { "op": "flangia_v", "x": 0, "y": 42 },
                { "op": "tubo_o", "x": 96, "y": 45, "w": 20 }, { "op": "flangia_v", "x": 116, "y": 42 },
                { "op": "corpo" },
                { "op": "forma", "tag": "rect", "geo": { "x": 24, "y": 10, "width": 72, "height": 80, "rx": 4 }, "velo": "paint-h" },
                { "op": "statico" },
                { "op": "parte", "id": "rotor", "kind": "rotor", "geo": { "cx": 60, "cy": 50, "symmetry": 90 } },
                { "op": "forma", "tag": "circle", "geo": { "cx": 60, "cy": 50, "r": 16 }, "mat": "steel", "velo": "metal-r" },
                { "op": "tratto", "d": "M44 50 L76 50", "mat": "steel-dark", "extra": { "stroke_width": 2 } }
            ]
        }))
        .unwrap()
    }

    #[test]
    fn un_simbolo_del_progetto_ha_bocche_e_parti() {
        let d = gabbia();
        let c = compila_e_controlla(&d).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(c.voce["id"], "prj:gabbia-laminazione");
        assert_eq!(c.voce["file"], "prj/gabbia-laminazione.svg");
        assert_eq!(c.voce["labels"]["en"], "Rolling stand");
        let s = c.simbolo().unwrap();
        assert_eq!(
            s.ports.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            ["n-left", "n-right"]
        );
        assert_eq!(s.ports[0].y, 50.0);
        assert_eq!(s.parts.len(), 1);
        // Il formato a strati che i motori dividono.
        assert!(c
            .svg
            .contains("\n  <g id=\"body\" data-layer=\"part\" data-mat=\"body-motor\""));
        assert!(c.svg.contains("\n  <g id=\"rotor\" data-layer=\"part\""));
    }

    #[test]
    fn le_regole_fermano_quello_che_romperebbe_i_motori() {
        let rotto = |f: &dyn Fn(&mut Value)| {
            let mut v = serde_json::to_value(gabbia()).unwrap();
            f(&mut v);
            let d: Descrizione = serde_json::from_value(v).unwrap();
            match compila_e_controlla(&d) {
                Ok(_) => Vec::new(),
                Err(e) => e,
            }
        };
        // Un attributo due volte: il materiale scrive già `fill`.
        let e = rotto(&|v| v["ops"][8]["extra"] = json!({ "fill": "none" }));
        assert!(e.iter().any(|m| m.contains("due volte")), "{e:?}");
        // Un colore libero.
        let e = rotto(&|v| v["ops"][9]["extra"] = json!([["stroke", "#ff0000"]]));
        assert!(e.iter().any(|m| m.contains("«stroke»")), "{e:?}");
        // Un attributo che porta altrove.
        let e = rotto(&|v| v["ops"][9]["extra"] = json!([["onload", "x"]]));
        assert!(e.iter().any(|m| m.contains("non ammesso")), "{e:?}");
        // Una forma vietata.
        let e = rotto(&|v| v["ops"][5]["tag"] = json!("text"));
        assert!(e.iter().any(|m| m.contains("non ammessa")), "{e:?}");
        // Un path che non è un path.
        let e = rotto(&|v| v["ops"][9]["d"] = json!("M0 0\"/><script>"));
        assert!(e.iter().any(|m| m.contains("«d»")), "{e:?}");
        // Un materiale che non esiste.
        let e = rotto(&|v| v["ops"][8]["mat"] = json!("oro"));
        assert!(!e.is_empty());
        // Senza corpo.
        let e = rotto(&|v| {
            let ops = v["ops"].as_array_mut().unwrap();
            ops.remove(5);
        });
        assert!(e.iter().any(|m| m.contains("body")), "{e:?}");
        // Fuori dal disegno.
        let e = rotto(&|v| v["ops"][8]["geo"] = json!({ "cx": 200, "cy": 50, "r": 16 }));
        assert!(e.iter().any(|m| m.contains("esce")), "{e:?}");
        // Una parte senza la sua geometria.
        let e = rotto(&|v| v["ops"][7]["geo"] = json!({ "cx": 60 }));
        assert!(e.iter().any(|m| m.contains("geometria")), "{e:?}");
        // viewBox fuori misura.
        let e = rotto(&|v| v["w"] = json!(125));
        assert!(e.iter().any(|m| m.contains("multiplo")), "{e:?}");
    }

    #[test]
    fn il_manifesto_del_progetto_salta_chi_non_compila() {
        let buona = gabbia();
        let mut rotta = gabbia();
        rotta.slug = "rotta".into();
        rotta.body = "oro".into();
        let (m, file) = manifesto(&[buona, rotta]);
        assert_eq!(m["symbols"].as_array().unwrap().len(), 1);
        assert!(file.contains_key("prj/gabbia-laminazione.svg"));
        assert_eq!(m["version"].as_str().unwrap().len(), 12);
    }
}
