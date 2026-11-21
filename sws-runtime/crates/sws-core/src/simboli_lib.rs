//! Il manifesto della libreria di simboli (`sws-editor/public/symbols/lib/manifest.json`).
//!
//! Lo scrive `scripts/simboli/genera.py` insieme agli SVG; qui c'è la sua forma,
//! la stessa di `sws-editor/src/symbols/lib/manifest.ts`. Lo leggono il
//! validatore (quali `lib:` esistono) e il pannello LVGL (la geometria delle parti
//! vive). Piano: `docs/archive/2026-10-14-motore-simboli-lib.md`.

use std::collections::BTreeMap;

use serde::Deserialize;

/// Una parte viva, in unità del viewBox del simbolo.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ParteLib {
    /// Finestra del contenuto: il disegno è pieno, si mostra la parte bassa.
    ///
    /// `dir` (19-11-2026, plan `2026-11-19-animazioni-dei-simboli`): the side
    /// the content grows from, `up` (from the bottom, as always) by default.
    Level {
        id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default)]
        dir: FillDir,
    },
    /// Gira attorno a (cx, cy); `symmetry` = gradi dopo cui il disegno si ripete.
    /// `ccw`: counter-clockwise (19-11-2026).
    Rotor {
        id: String,
        cx: f64,
        cy: f64,
        symmetry: f64,
        #[serde(default)]
        ccw: bool,
    },
    /// Disegnata a metà scala; ruota da `a0` (minimo) a `a1` (massimo), in gradi orari.
    Needle {
        id: String,
        cx: f64,
        cy: f64,
        a0: f64,
        a1: f64,
    },
    /// Disegnata in posizione `open`; `closed` è la rotazione della chiusa.
    ///
    /// `angoli` (21-10-2026) la estende a **N posizioni**: l'elenco degli
    /// angoli, il primo è quello in cui il disegno sta fermo. Vuoto o con meno
    /// di tre voci = la leva booleana di sempre. È `#[serde(default)]` apposta:
    /// un manifesto scritto da un generatore più vecchio non ha il campo, e
    /// senza il default l'intero manifesto diventerebbe illeggibile.
    Lever {
        id: String,
        cx: f64,
        cy: f64,
        open: f64,
        closed: f64,
        #[serde(default)]
        angoli: Vec<f64>,
    },
    /// Accesa = visibile.
    Lamp { id: String },
    /// Moves by `(dx, dy)` times the fraction of its input (19-11-2026): a
    /// true/false input goes from one end to the other.
    Slide {
        id: String,
        dx: f64,
        dy: f64,
        #[serde(default = "transition_ms_default")]
        transition_ms: f64,
    },
    /// Shakes along `axis` while its input is true: four steps per period,
    /// 0, +amplitude, 0, −amplitude.
    Vibrate {
        id: String,
        #[serde(default = "amplitude_default")]
        amplitude: f64,
        #[serde(default)]
        axis: Axis,
        #[serde(default = "vibrate_period_default")]
        period_ms: f64,
    },
    /// Breathes (its opacity goes down by `depth` and back) while its input is
    /// true.
    Pulse {
        id: String,
        #[serde(default = "depth_default")]
        depth: f64,
        #[serde(default = "pulse_period_default")]
        period_ms: f64,
    },
    /// Takes the colour, the blink and the visibility of the first entry its
    /// input matches, like the states of a symbol; `color` is the colour as
    /// drawn.
    Signal {
        id: String,
        #[serde(default)]
        color: Option<String>,
        #[serde(default)]
        entries: Vec<SignalEntry>,
    },
    /// A glow (neon, plan `2026-11-21-simboli-fase-8-effetti`): while its
    /// input is true, a blurred halo of the part's own shapes — in `color`, or
    /// in theirs — sits under them, `radius` units wide.
    Glow {
        id: String,
        #[serde(default)]
        color: Option<String>,
        #[serde(default = "glow_radius_default")]
        radius: f64,
    },
    /// Bubbles rising in the box `x y w h` while the input is true (plan
    /// `2026-11-21-simboli-fase-8-effetti`); see `symbol_fx`.
    Bubbles {
        id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default)]
        color: Option<String>,
        #[serde(default = "bubbles_count_default")]
        count: u32,
        #[serde(default = "fx_period_default")]
        period_ms: f64,
    },
    /// Smoke (or steam) puffing up from the bottom of the box while the input
    /// is true; see `symbol_fx`.
    Smoke {
        id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default)]
        color: Option<String>,
        #[serde(default = "fx_period_default")]
        period_ms: f64,
    },
    /// A kind this binary doesn't know: a manifest written by a newer runtime.
    /// The layer is drawn still, instead of the whole manifest becoming
    /// unreadable (which turned every project symbol into a placeholder).
    #[serde(other)]
    Unknown,
}

/// Where the content of a level comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FillDir {
    #[default]
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    #[default]
    X,
    Y,
}

/// An entry of a signal: an exact `value`, or a half-open range
/// `value_min <= v < value_max`, as the states of a symbol.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, serde::Serialize)]
pub struct SignalEntry {
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub value_min: Option<f64>,
    #[serde(default)]
    pub value_max: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub blink: bool,
    #[serde(default)]
    pub hidden: bool,
    /// The photo the part's images show while this entry matches, instead of
    /// their own (plan `2026-11-21-simboli-fase-3-foto`): a file name in the
    /// project's `images/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

fn transition_ms_default() -> f64 {
    300.0
}
fn amplitude_default() -> f64 {
    1.0
}
fn vibrate_period_default() -> f64 {
    200.0
}
fn depth_default() -> f64 {
    0.6
}
fn bubbles_count_default() -> u32 {
    6
}
fn fx_period_default() -> f64 {
    2000.0
}
fn glow_radius_default() -> f64 {
    4.0
}
fn pulse_period_default() -> f64 {
    1000.0
}

impl ParteLib {
    /// Gli angoli di una leva, col ripiego sulla coppia `open`/`closed` quando
    /// il manifesto non li dichiara. Gemella di `angoliLeva` in
    /// `sws-editor/src/symbols/lib/libreria.ts`.
    pub fn angoli_leva(&self) -> Vec<f64> {
        match self {
            ParteLib::Lever {
                open,
                closed,
                angoli,
                ..
            } => {
                if angoli.len() >= 3 {
                    angoli.clone()
                } else {
                    vec![*open, *closed]
                }
            }
            _ => Vec::new(),
        }
    }

    pub fn id(&self) -> &str {
        match self {
            ParteLib::Level { id, .. }
            | ParteLib::Rotor { id, .. }
            | ParteLib::Needle { id, .. }
            | ParteLib::Lever { id, .. }
            | ParteLib::Lamp { id }
            | ParteLib::Slide { id, .. }
            | ParteLib::Vibrate { id, .. }
            | ParteLib::Pulse { id, .. }
            | ParteLib::Signal { id, .. }
            | ParteLib::Glow { id, .. }
            | ParteLib::Bubbles { id, .. }
            | ParteLib::Smoke { id, .. } => id,
            ParteLib::Unknown => "",
        }
    }
}

/// Una bocca del disegno, dove si aggancia una tubazione (15-10-2026, piano
/// `docs/archive/2026-10-15-tubazioni-bocche-e-stili.md`). In unità del viewBox:
/// `(x, y)` è la faccia esterna della flangia, `side` il lato da cui esce il
/// tubo, `d` il diametro del tronchetto.
#[derive(Debug, Clone, PartialEq, Deserialize, serde::Serialize)]
pub struct PortaLib {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub side: String,
    pub d: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimboloLib {
    /// `lib:<famiglia>/<slug>`: è il `symbol_id` dell'oggetto.
    pub id: String,
    /// Percorso relativo a `/symbols/lib/`.
    pub file: String,
    pub family: String,
    pub kind: String,
    pub label: String,
    #[serde(rename = "viewBox")]
    pub view_box: [f64; 2],
    pub body: String,
    #[serde(default)]
    pub materials: Vec<String>,
    #[serde(default)]
    pub parts: Vec<ParteLib>,
    /// Le bocche: vuoto per i simboli che non hanno tubi (gli elettrici).
    #[serde(default)]
    pub ports: Vec<PortaLib>,
    /// Il builtin che questo disegno sostituisce (alias).
    #[serde(default)]
    pub replaces: Option<String>,
    /// A project symbol that is a variant of this library symbol
    /// (`lib:<family>/<slug>`): it is drawn in its place.
    #[serde(default)]
    pub overrides: Option<String>,
    /// The photos of a project symbol, as names in the project's `images/`
    /// (plan `2026-11-21-simboli-fase-3-foto`). The library has none.
    #[serde(default)]
    pub images: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestLib {
    pub version: String,
    /// La versione del manifesto dei simboli **del progetto** (`prj:`), quando
    /// il pannello li ha uniti a quelli della libreria: va negli URL dei loro
    /// SVG come `version` va in quelli della libreria. Non sta nel file.
    #[serde(default)]
    pub versione_progetto: String,
    pub materials: BTreeMap<String, String>,
    pub symbols: Vec<SimboloLib>,
}

impl ManifestLib {
    pub fn simbolo(&self, id: &str) -> Option<&SimboloLib> {
        self.symbols.iter().find(|s| s.id == id)
    }

    /// Per id `lib:…`, oppure per **alias**: il disegno che sostituisce il
    /// builtin `id` (`replaces`, M3 del piano). Come `cercaSimbolo` sul web.
    ///
    /// A library symbol with a project variant (`overrides`, plan
    /// 2026-11-18-editor-dei-simboli) gives the variant: every object that
    /// draws the pump draws the pump the customer redrew.
    pub fn simbolo_o_alias(&self, id: &str) -> Option<&SimboloLib> {
        let s = self.simbolo(id).or_else(|| {
            self.symbols
                .iter()
                .find(|s| s.replaces.as_deref() == Some(id))
        })?;
        if !s.id.starts_with("lib:") {
            return Some(s);
        }
        Some(
            self.symbols
                .iter()
                .find(|v| v.overrides.as_deref() == Some(s.id.as_str()))
                .unwrap_or(s),
        )
    }

    /// The library symbol itself, ignoring project variants: what «Torna
    /// all'originale» goes back to.
    pub fn simbolo_originale(&self, id: &str) -> Option<&SimboloLib> {
        self.simbolo(id).or_else(|| {
            self.symbols
                .iter()
                .find(|s| s.replaces.as_deref() == Some(id))
        })
    }
}

/// Il manifesto com'è in questo checkout: per i test, che verificano che il file
/// generato abbia la forma che il codice Rust si aspetta.
#[cfg(test)]
pub(crate) fn manifesto_incluso() -> ManifestLib {
    serde_json::from_str(include_str!(
        "../../../../sws-editor/public/symbols/lib/manifest.json"
    ))
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A kind this binary doesn't know, with keys of its own, is a still
    /// layer, and the rest of the manifest stays readable.
    #[test]
    fn an_unknown_part_kind_does_not_break_the_manifest() {
        let p: ParteLib =
            serde_json::from_str(r#"{"id":"x","kind":"wobble","foo":1,"bar":[1,2]}"#).unwrap();
        assert_eq!(p, ParteLib::Unknown);
        assert_eq!(p.id(), "");
        let s: SimboloLib = serde_json::from_str(
            r#"{"id":"prj:a","file":"prj/a.svg","family":"project","kind":"project","label":"a",
                "viewBox":[100,100],"body":"steel",
                "parts":[{"id":"x","kind":"wobble"},{"id":"r","kind":"rotor","cx":5,"cy":5,"symmetry":60}]}"#,
        )
        .unwrap();
        assert_eq!(s.parts.len(), 2);
        assert!(matches!(s.parts[1], ParteLib::Rotor { ccw: false, .. }));
    }

    #[test]
    fn the_new_kinds_read_with_their_defaults() {
        let p = |j: &str| serde_json::from_str::<ParteLib>(j).unwrap();
        assert_eq!(
            p(r#"{"id":"l","kind":"level","x":0,"y":0,"w":10,"h":10}"#),
            ParteLib::Level {
                id: "l".into(),
                x: 0.0,
                y: 0.0,
                w: 10.0,
                h: 10.0,
                dir: FillDir::Up
            }
        );
        assert!(matches!(
            p(r#"{"id":"l","kind":"level","x":0,"y":0,"w":10,"h":10,"dir":"left"}"#),
            ParteLib::Level {
                dir: FillDir::Left,
                ..
            }
        ));
        assert_eq!(
            p(r#"{"id":"s","kind":"slide","dx":0,"dy":-20}"#),
            ParteLib::Slide {
                id: "s".into(),
                dx: 0.0,
                dy: -20.0,
                transition_ms: 300.0
            }
        );
        assert_eq!(
            p(r#"{"id":"v","kind":"vibrate"}"#),
            ParteLib::Vibrate {
                id: "v".into(),
                amplitude: 1.0,
                axis: Axis::X,
                period_ms: 200.0
            }
        );
        assert_eq!(
            p(r#"{"id":"u","kind":"pulse"}"#),
            ParteLib::Pulse {
                id: "u".into(),
                depth: 0.6,
                period_ms: 1000.0
            }
        );
        let ParteLib::Signal { color, entries, .. } = p(
            r##"{"id":"g","kind":"signal","color":"#64748b","entries":[{"value":1,"color":"#22c55e"},{"value_min":2,"value_max":9,"blink":true},{"value":0,"hidden":true}]}"##,
        ) else {
            panic!("a signal");
        };
        assert_eq!(color.as_deref(), Some("#64748b"));
        assert_eq!(entries.len(), 3);
        assert!(entries[1].blink && entries[2].hidden);
        assert_eq!(entries[1].value_min, Some(2.0));
    }

    #[test]
    fn il_manifesto_generato_si_legge_e_dichiara_le_parti() {
        let m = manifesto_incluso();
        assert!(m.version.len() >= 8);
        let pompa = m
            .simbolo("lib:process/centrifugal-pump")
            .expect("la pompa c'è");
        assert_eq!(pompa.replaces.as_deref(), Some("pump"));
        assert_eq!(
            m.simbolo_o_alias("pump").map(|s| s.id.as_str()),
            Some("lib:process/centrifugal-pump")
        );
        assert!(m.simbolo_o_alias("non-esiste").is_none());
        assert!(
            matches!(pompa.parts.as_slice(), [ParteLib::Rotor { symmetry, .. }] if *symmetry == 60.0)
        );
        let serbatoio = m
            .simbolo("lib:process/vertical-tank")
            .expect("il serbatoio c'è");
        assert!(serbatoio
            .parts
            .iter()
            .any(|p| matches!(p, ParteLib::Level { .. })));
        for s in &m.symbols {
            assert!(s.id.starts_with("lib:"), "{}", s.id);
            assert!(
                m.materials.contains_key(&s.body),
                "{}: corpo {}",
                s.id,
                s.body
            );
            for mat in &s.materials {
                assert!(m.materials.contains_key(mat), "{}: materiale {mat}", s.id);
            }
        }
    }

    /// A project variant of a library symbol (`overrides`) is drawn wherever
    /// the library symbol is asked for, by id and by builtin alias; the
    /// original stays reachable.
    #[test]
    fn a_project_variant_replaces_its_library_symbol() {
        let mut m = manifesto_incluso();
        let mut v = m.simbolo("lib:process/centrifugal-pump").unwrap().clone();
        v.id = "prj:my-pump".into();
        v.file = "prj/my-pump.svg".into();
        v.replaces = None;
        v.overrides = Some("lib:process/centrifugal-pump".into());
        m.symbols.push(v);
        for id in ["lib:process/centrifugal-pump", "pump", "prj:my-pump"] {
            assert_eq!(
                m.simbolo_o_alias(id).map(|s| s.id.as_str()),
                Some("prj:my-pump"),
                "{id}"
            );
        }
        assert_eq!(
            m.simbolo_originale("pump").map(|s| s.id.as_str()),
            Some("lib:process/centrifugal-pump")
        );
        // Other library symbols are untouched.
        assert_eq!(
            m.simbolo_o_alias("lib:process/vertical-tank")
                .map(|s| s.id.as_str()),
            Some("lib:process/vertical-tank")
        );
    }
}
