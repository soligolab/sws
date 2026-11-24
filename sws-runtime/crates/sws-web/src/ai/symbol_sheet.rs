//! The symbol sheet (plan docs/plans/2026-11-23-assistente-dei-simboli.md,
//! session 2): what the interview of the symbol editor's assistant decides,
//! as data. The model writes it with `symbol_sheet`, the person corrects it
//! in the chat, and the steps after read only it.
//!
//! Two things here are code and not the model, because they must not get the
//! format wrong (the weak point measured with the small models):
//! - [`drawing_request`]: what the drawing model is asked, with the names;
//! - [`complete`]: the structure and the effects put into whatever was drawn
//!   (T1 and T4 of the plan): the inputs, the ports, the effects.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sws_core::simboli_lib::{FxLevel, FxWhen};
use sws_core::simboli_prj::{nome_ammesso, Descrizione, Op, TIPI_PARTE};

/// The sheet. Unknown fields are kept out, missing lists are empty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sheet {
    /// The symbol's name as people read it.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub size: Size,
    /// `vector`, `photo` or `mixed`.
    pub style: String,
    /// The body is coloured by the state (alarm, running, stopped).
    #[serde(default)]
    pub state_colors: bool,
    #[serde(default)]
    pub inputs: Vec<Input>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo: Option<PhotoPlan>,
    #[serde(default)]
    pub parts: Vec<Part>,
    #[serde(default)]
    pub ports: Vec<Port>,
    #[serde(default)]
    pub effects: Vec<Effect>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub w: u32,
    pub h: u32,
}

/// An input that drives the symbol: what a page binds a tag to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Input {
    pub id: String,
    /// `bool`, `number` or `states`.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub states: Vec<String>,
}

/// The photo of a photographic or mixed symbol (generated in session 3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhotoPlan {
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub varies_with: Option<PhotoVariation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhotoVariation {
    pub input: String,
    /// `on_off`, `states` or `steps`.
    pub mode: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<PhotoStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhotoStep {
    pub min: f64,
    pub max: f64,
    pub description: String,
}

/// A part people refer to by name: a group of shapes, or the layer of a
/// moving part.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Part {
    pub id: String,
    /// What it is, in words, for the drawing.
    pub what: String,
    /// A moving part: a kind of the format (`rotor`, `level`, `needle`…),
    /// driven by `input`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Port {
    pub id: String,
    /// `left`, `right`, `top` or `bottom`.
    pub side: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Effect {
    /// `flame`, `smoke`, `glow` or `bubbles`.
    pub kind: String,
    /// The part (group) it belongs to.
    pub part: String,
    pub input: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<FxWhen>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<FxLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

const STYLES: &[&str] = &["vector", "photo", "mixed"];
const INPUT_KINDS: &[&str] = &["bool", "number", "states"];
const SIDES: &[&str] = &["left", "right", "top", "bottom"];
const EFFECTS: &[&str] = &["flame", "smoke", "glow", "bubbles"];
const PHOTO_MODES: &[&str] = &["on_off", "states", "steps"];
const MAX_SIDE: u32 = 512;

/// The rule of the compiler for the id of an input or a part, which the
/// names of groups and ports follow too.
fn id_ok(id: &str) -> bool {
    nome_ammesso(id, 2, 30) && id != "body" && !id.starts_with("layer-") && !id.starts_with("fx-")
}

/// Reads and checks a sheet: every problem, in words the model and the person
/// can act on.
pub fn read(v: &Value) -> Result<Sheet, Vec<String>> {
    let sheet: Sheet =
        serde_json::from_value(v.clone()).map_err(|e| vec![format!("scheda: {e}")])?;
    let errors = check(&sheet);
    if errors.is_empty() {
        Ok(sheet)
    } else {
        Err(errors)
    }
}

pub fn check(s: &Sheet) -> Vec<String> {
    let mut e = Vec::new();
    if s.name.trim().is_empty() || s.name.chars().count() > 60 {
        e.push("name: da 1 a 60 caratteri".to_string());
    }
    for (k, v) in [("w", s.size.w), ("h", s.size.h)] {
        if !(20..=MAX_SIDE).contains(&v) || v % 10 != 0 {
            e.push(format!("size.{k} {v}: multiplo di 10, da 20 a {MAX_SIDE}"));
        }
    }
    if !STYLES.contains(&s.style.as_str()) {
        e.push(format!("style «{}»: uno di {}", s.style, STYLES.join(", ")));
    }
    if matches!(s.style.as_str(), "photo" | "mixed") && s.photo.is_none() {
        e.push("style foto o misto: serve photo con la descrizione".to_string());
    }
    let mut ids: Vec<String> = Vec::new();
    let mut taken = |id: &str, what: &str, e: &mut Vec<String>| {
        if !id_ok(id) {
            e.push(format!(
                "{what} «{id}»: a-z, 0-9 e «-», da 2 a 30; non body, layer-N né fx-N"
            ));
        }
        if ids.iter().any(|x| x == id) {
            e.push(format!("{what} «{id}»: il nome è già usato"));
        }
        ids.push(id.to_string());
    };
    for i in &s.inputs {
        taken(&i.id, "ingresso", &mut e);
        if !INPUT_KINDS.contains(&i.kind.as_str()) {
            e.push(format!(
                "ingresso «{}»: type uno di {}",
                i.id,
                INPUT_KINDS.join(", ")
            ));
        }
        if i.kind == "states" && i.states.len() < 2 {
            e.push(format!("ingresso «{}»: almeno due stati", i.id));
        }
        if let (Some(a), Some(b)) = (i.min, i.max) {
            if a >= b {
                e.push(format!("ingresso «{}»: min {a} non è sotto max {b}", i.id));
            }
        }
    }
    let inputs: Vec<&str> = s.inputs.iter().map(|i| i.id.as_str()).collect();
    for p in &s.parts {
        taken(&p.id, "parte", &mut e);
        if let Some(m) = &p.motion {
            if !TIPI_PARTE.contains(&m.as_str()) {
                e.push(format!(
                    "parte «{}»: motion uno di {}",
                    p.id,
                    TIPI_PARTE.join(", ")
                ));
            }
            match &p.input {
                Some(i) if inputs.contains(&i.as_str()) => {}
                Some(i) => e.push(format!("parte «{}»: l'ingresso «{i}» non c'è", p.id)),
                None => e.push(format!(
                    "parte «{}»: un movimento vuole il suo ingresso",
                    p.id
                )),
            }
        }
    }
    for p in &s.ports {
        taken(&p.id, "bocca", &mut e);
        if !SIDES.contains(&p.side.as_str()) {
            e.push(format!(
                "bocca «{}»: side uno di {}",
                p.id,
                SIDES.join(", ")
            ));
        }
    }
    let parts: Vec<&str> = s.parts.iter().map(|p| p.id.as_str()).collect();
    for f in &s.effects {
        if !EFFECTS.contains(&f.kind.as_str()) {
            e.push(format!(
                "effetto «{}»: kind uno di {}",
                f.kind,
                EFFECTS.join(", ")
            ));
        }
        if !parts.contains(&f.part.as_str()) {
            e.push(format!(
                "effetto {} sulla parte «{}», che non c'è",
                f.kind, f.part
            ));
        }
        if !inputs.contains(&f.input.as_str()) {
            e.push(format!(
                "effetto {}: l'ingresso «{}» non c'è",
                f.kind, f.input
            ));
        }
    }
    let fire = |f: &&Effect| matches!(f.kind.as_str(), "flame" | "glow");
    for (k, f) in s.effects.iter().enumerate().filter(|(_, f)| fire(f)) {
        if s.effects[..k].iter().filter(fire).any(|g| g.part == f.part) {
            e.push(format!(
                "parte «{}»: al più uno fra fiamma e bagliore",
                f.part
            ));
        }
    }
    if let Some(v) = s.photo.as_ref().and_then(|p| p.varies_with.as_ref()) {
        if !inputs.contains(&v.input.as_str()) {
            e.push(format!(
                "photo.varies_with: l'ingresso «{}» non c'è",
                v.input
            ));
        }
        if !PHOTO_MODES.contains(&v.mode.as_str()) {
            e.push(format!(
                "photo.varies_with.mode uno di {}",
                PHOTO_MODES.join(", ")
            ));
        }
        if v.mode == "steps" && !(2..=5).contains(&v.steps.len()) {
            e.push("photo.varies_with: da 2 a 5 gradini".to_string());
        }
    }
    e
}

/// What the drawing model is asked from a sheet: the names it must use and
/// what is left to the code. In English, like the rest of its request.
pub fn drawing_request(s: &Sheet) -> String {
    let mut t = format!(
        "Draw this symbol from its sheet.\nname: {}\nw: {}\nh: {}\n",
        s.name, s.size.w, s.size.h
    );
    t.push_str(match s.style.as_str() {
        "vector" => "Style: vector, sober (ISA-101), in the style of the library.\n",
        "photo" => "Style: a photo will be the symbol, added later: draw only a simple outline of the body and the moving parts.\n",
        _ => "Style: mixed, a photo will go under the drawing, added later: draw the live parts (needle, level, lamp) and a light outline.\n",
    });
    if s.state_colors {
        t.push_str(
            "The body follows the state colour: put the main shapes in the body (`corpo`).\n",
        );
    } else {
        t.push_str("The colours are its own: materials, no state colour on the shapes.\n");
    }
    if !s.parts.is_empty() {
        t.push_str("\nParts, with the names to use:\n");
        for p in &s.parts {
            match (&p.motion, &p.input) {
                (Some(m), Some(i)) => t.push_str(&format!(
                    "- {}: {}. It moves: put its shapes in a `parte` layer with id \"{i}\" and kind \"{m}\".\n",
                    p.id, p.what
                )),
                _ => t.push_str(&format!(
                    "- {}: {}. Set `group: \"{}\"` on every shape of it.\n",
                    p.id, p.what, p.id
                )),
            }
        }
    }
    if !s.ports.is_empty() {
        t.push_str("\nPipe ports: ");
        let ps: Vec<String> = s
            .ports
            .iter()
            .map(|p| format!("\"{}\" on the {} side", p.id, p.side))
            .collect();
        t.push_str(&ps.join(", "));
        t.push_str(".\n");
    }
    if !s.effects.is_empty() {
        t.push_str(
            "\nDo not write `effetto` or `ingresso` operations: the effects and the inputs are \
             added afterwards from the sheet. Only keep the groups named above.\n",
        );
    }
    t
}

/// The structure and the effects of the sheet put into a drawing (T1 and T4):
/// the size, an `ingresso` for every input no part carries, the ports that
/// are missing, the effects on their groups. What could not be done comes
/// back in words.
pub fn complete(mut d: Descrizione, s: &Sheet) -> (Descrizione, Vec<String>) {
    let mut notes = Vec::new();
    d.w = s.size.w;
    d.h = s.size.h;
    // Inputs: a `parte` with the id carries it already.
    let carried = |d: &Descrizione, id: &str| {
        d.ops
            .iter()
            .any(|o| matches!(o, Op::Parte { id: p, .. } | Op::Ingresso { id: p } if p == id))
    };
    let missing: Vec<Op> = s
        .inputs
        .iter()
        .filter(|i| !carried(&d, &i.id))
        .map(|i| Op::Ingresso { id: i.id.clone() })
        .collect();
    let at = d
        .ops
        .iter()
        .take_while(|o| matches!(o, Op::Ingresso { .. }))
        .count();
    d.ops.splice(at..at, missing);
    // Ports: in the middle of their side.
    let (w, h) = (s.size.w as f64, s.size.h as f64);
    for p in &s.ports {
        let there = d
            .ops
            .iter()
            .any(|o| matches!(o, Op::Bocca { id: Some(i), .. } if *i == p.id));
        if there {
            continue;
        }
        let (x, y) = match p.side.as_str() {
            "left" => (0.0, h / 2.0),
            "right" => (w, h / 2.0),
            "top" => (w / 2.0, 0.0),
            _ => (w / 2.0, h),
        };
        d.ops.push(Op::Bocca {
            x,
            y,
            side: p.side.clone(),
            d: 10.0,
            id: Some(p.id.clone()),
        });
    }
    // Effects: on the shapes of their group; none of the drawing's own.
    d.ops.retain(|o| !matches!(o, Op::Effetto { .. }));
    for f in &s.effects {
        if !d.ops.iter().any(|o| o.group() == Some(f.part.as_str())) {
            notes.push(format!(
                "effetto {} sulla parte «{}»: il disegno non ha forme con group «{}»",
                f.kind, f.part, f.part
            ));
            continue;
        }
        d.ops.push(Op::Effetto {
            kind: f.kind.clone(),
            group: f.part.clone(),
            input: f.input.clone(),
            when: f.when.clone(),
            level: f.level.clone(),
            color: f.color.clone(),
            period_ms: None,
            count: (f.kind == "bubbles").then_some(6),
            radius: (f.kind == "glow").then_some(4.0),
        });
    }
    (d, notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stove() -> Value {
        json!({
            "name": "Stufa a pellet", "size": { "w": 100, "h": 140 }, "style": "vector", "state_colors": true,
            "inputs": [
                { "id": "acceso", "type": "bool" },
                { "id": "potenza", "type": "number", "min": 0, "max": 100, "unit": "%" },
                { "id": "girante", "type": "bool" }
            ],
            "parts": [
                { "id": "fiamma", "what": "la fiamma dietro il vetro" },
                { "id": "camino", "what": "il tubo del fumo in alto" },
                { "id": "ventola", "what": "la ventola in basso", "motion": "rotor", "input": "girante" }
            ],
            "ports": [{ "id": "fumi", "side": "top" }],
            "effects": [
                { "kind": "flame", "part": "fiamma", "input": "acceso", "level": { "min": 0, "max": 100 } },
                { "kind": "smoke", "part": "camino", "input": "acceso", "when": { "op": "eq", "value": 1 } }
            ]
        })
    }

    /// A good sheet reads; the mistakes a model makes are each said.
    #[test]
    fn a_sheet_is_read_and_its_mistakes_said() {
        assert!(read(&stove()).is_ok());
        let mut bad = stove();
        bad["size"]["w"] = json!(105);
        bad["inputs"][1]["id"] = json!("acceso");
        bad["effects"][0]["part"] = json!("vetro");
        bad["parts"][2]["input"] = json!("nessuno");
        bad["style"] = json!("photo");
        let e = read(&bad).unwrap_err().join(" | ");
        for want in [
            "size.w 105",
            "«acceso»: il nome è già usato",
            "«vetro», che non c'è",
            "«nessuno» non c'è",
            "serve photo",
        ] {
            assert!(e.contains(want), "{want} in {e}");
        }
        let mut two = stove();
        two["effects"][1] = json!({ "kind": "glow", "part": "fiamma", "input": "acceso" });
        assert!(read(&two)
            .unwrap_err()
            .join(" ")
            .contains("al più uno fra fiamma e bagliore"));
    }

    /// The drawing is asked with the names of the sheet: groups for the
    /// parts, a layer for the moving one, the ports, no effects.
    #[test]
    fn the_drawing_is_asked_with_the_names() {
        let s = read(&stove()).unwrap();
        let t = drawing_request(&s);
        assert!(t.contains("w: 100\nh: 140"));
        assert!(t.contains("`group: \"fiamma\"`") && t.contains("`group: \"camino\"`"));
        assert!(t.contains("`parte` layer with id \"girante\" and kind \"rotor\""));
        assert!(t.contains("\"fumi\" on the top side"));
        assert!(t.contains("Do not write `effetto`"));
    }

    /// T1 and T4: inputs no part carries, the missing ports, the effects on
    /// their groups; a group the drawing forgot is said, and the result
    /// compiles.
    #[test]
    fn the_code_completes_the_drawing() {
        let s = read(&stove()).unwrap();
        let drawn: Descrizione = serde_json::from_value(json!({
            "slug": "stufa", "w": 100, "h": 140, "tipo": "project", "body": "body-furnace", "it": "Stufa", "en": "Stove",
            "ops": [
                { "op": "corpo" },
                { "op": "forma", "tag": "rect", "geo": { "x": 10, "y": 40, "width": 80, "height": 90 } },
                { "op": "statico" },
                { "op": "forma", "tag": "path", "geo": { "d": "M45 100 Q50 80 55 100 Z" }, "group": "fiamma",
                  "extra": { "fill": "#ff8c1a" } },
                { "op": "parte", "id": "girante", "kind": "rotor", "geo": { "cx": 50, "cy": 120, "symmetry": 4 } },
                { "op": "forma", "tag": "circle", "geo": { "cx": 50, "cy": 120, "r": 6 }, "mat": "steel" },
                { "op": "effetto", "kind": "glow", "group": "fiamma", "input": "acceso" }
            ]
        }))
        .unwrap();
        let (d, notes) = complete(drawn, &s);
        // `girante` is the rotor's part already; `acceso` and `potenza` are added.
        let ingressi: Vec<&str> = d
            .ops
            .iter()
            .filter_map(|o| match o {
                Op::Ingresso { id } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(ingressi, ["acceso", "potenza"]);
        assert!(d
            .ops
            .iter()
            .any(|o| matches!(o, Op::Bocca { id: Some(i), side, x, y, .. }
            if i == "fumi" && side == "top" && *x == 50.0 && *y == 0.0)));
        let effetti: Vec<&str> = d
            .ops
            .iter()
            .filter_map(|o| match o {
                Op::Effetto { kind, .. } => Some(kind.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(
            effetti,
            ["flame"],
            "the drawing's own glow went, the smoke has no chimney"
        );
        assert_eq!(notes.len(), 1);
        assert!(notes[0].contains("«camino»"), "{notes:?}");
        sws_core::simboli_prj::compila_e_controlla(&d).unwrap_or_else(|e| panic!("{e:?}"));
        // Twice is the same.
        let (again, _) = complete(d.clone(), &s);
        assert_eq!(
            serde_json::to_value(&again).unwrap(),
            serde_json::to_value(&d).unwrap()
        );
    }
}
