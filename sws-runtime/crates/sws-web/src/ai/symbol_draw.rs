//! One project symbol drawn by the model of the «Simboli» purpose, with the
//! compiler as its checker: the description it writes is compiled, and the
//! errors go back to it, up to three times.
//!
//! Two callers: the chat's `disegna_simbolo` (`strumenti_scopi::disegna`) and
//! the AI tab of the symbol editor, `POST /api/symbols/ai` ([`editor`]; plan
//! `docs/archive/2026-11-19-assistente-ia-simboli.md`). They differ in what they
//! ask and in what they count; the drawing itself is this.

use serde::Deserialize;
use serde_json::{json, Map, Value};
use sws_core::simboli_prj::{Compilato, Descrizione};

use super::{client, price_list, prompt, scopi, spending, strumenti_scopi::estrai_json, tools};
use crate::router::AppState;

pub(crate) const ATTEMPTS: usize = 3;

/// The longest answer: a symbol with its parts is a few KB of JSON, and a
/// model that thinks out loud first needs the rest.
const MAX_TOKENS: u32 = 16000;

/// Who keeps the accounts of a drawing. The chat counts every call in the
/// conversation's cap and in the frames it sends; the editor in the request.
pub(crate) trait Meter {
    /// Before each call: an error stops the drawing (a cap reached).
    fn may_call(&self) -> Result<(), String>;
    /// After each call, with what it cost and how long it took.
    fn paid(&mut self, cost_usd: f64, usage: &Value, secs: f64);
}

/// A symbol that compiled.
pub(crate) struct Drawn {
    pub description: Descrizione,
    pub compiled: Compilato,
    pub attempts: usize,
}

#[derive(Debug)]
pub(crate) enum DrawError {
    /// The meter said no before a call.
    Stopped(String),
    /// The provider failed: unreachable, refused, an answer in no known shape.
    Provider(String),
    /// Every attempt gave a description that does not compile: the last errors.
    Invalid(Vec<String>),
}

/// The instructions of the symbol model: the format with its rules and
/// examples, and the project's own rules for symbols.
pub(crate) async fn system(s: &AppState) -> Result<String, String> {
    let schema = tools::schema_simbolo()?;
    let mut istruzioni = format!(
        "Disegni i simboli di SWS, uno SCADA: macchine viste di fronte, per i sinottici di un \
         pannello industriale. Rispondi SOLO con un oggetto JSON: la descrizione del simbolo, \
         nel formato qui sotto. Niente testo prima o dopo.\n\nFormato, regole ed esempi:\n{schema}"
    );
    if let Some(r) = super::regole_del_progetto(s, "simboli").await {
        istruzioni.push_str("\n\n");
        istruzioni.push_str(&prompt::blocco_regole(&r));
    }
    Ok(istruzioni)
}

/// What a model may answer, as JSON Schema: the shape of a description. A
/// local server turns it into a grammar (see [`client::ask_shaped`]), and a
/// small model stops writing JSON that does not read (20-11-2026: qwen3.5:9b,
/// 0 readable answers in 8 without it, 8 in 8 with it). Only the shape: the
/// compiler still checks the rest — sizes, shapes inside the drawing, a body
/// with a shape — and its errors go back to the model.
pub(crate) fn answer_schema() -> Value {
    use sws_core::simboli_prj::{FORME, MATERIALI, TIPI_PARTE, VELI};
    let num = json!({ "type": "number" });
    let materials: Vec<&str> = MATERIALI.iter().map(|(n, _)| *n).collect();
    let veils: Vec<&str> = VELI.iter().map(|v| v.nome).collect();
    let mat = json!({ "anyOf": [{ "enum": materials }, { "type": "null" }] });
    let veil = json!({ "anyOf": [{ "enum": veils }, { "type": "null" }] });
    let colour = json!({ "type": "string", "pattern": "^(none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$" });
    let path = json!({ "type": "string", "pattern": "^[MmLlHhVvCcSsQqTtAaZz0-9.,+eE -]+$" });
    let id = json!({ "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,29}$" });
    // The extras as an object, or as the pairs the library writes.
    let extra = json!({ "anyOf": [
        { "type": "object", "additionalProperties": false, "properties": {
            "stroke_width": num, "stroke_opacity": num, "fill_opacity": num,
            "fill": colour, "stroke": colour,
            "stroke_linecap": { "enum": ["butt", "round", "square"] },
            "stroke_linejoin": { "enum": ["round", "miter", "bevel"] },
            "stroke_dasharray": { "type": "string" } } },
        { "type": "array", "items": { "type": "array",
            "items": { "anyOf": [{ "type": "string" }, { "type": "number" }] } } },
    ] });
    let object = |props: Value, required: &[&str]| json!({ "type": "object", "additionalProperties": false, "required": required, "properties": props });
    let geo = |tag: &str| match tag {
        "rect" => object(
            json!({ "x": num, "y": num, "width": num, "height": num, "rx": num, "ry": num }),
            &["x", "y", "width", "height"],
        ),
        "circle" => object(
            json!({ "cx": num, "cy": num, "r": num }),
            &["cx", "cy", "r"],
        ),
        "ellipse" => object(
            json!({ "cx": num, "cy": num, "rx": num, "ry": num }),
            &["cx", "cy", "rx", "ry"],
        ),
        _ => object(json!({ "d": path }), &["d"]),
    };
    let op = |name: &str, props: Value, required: &[&str]| {
        let mut p = props.as_object().cloned().unwrap_or_default();
        p.insert("op".into(), json!({ "const": name }));
        let mut r = vec!["op"];
        r.extend_from_slice(required);
        object(Value::Object(p), &r)
    };
    let xywh = json!({ "x": num, "y": num, "w": num, "h": num });
    let mut ops = vec![
        op("statico", json!({}), &[]),
        op("corpo", json!({}), &[]),
        op(
            "tratto",
            json!({ "d": path, "mat": mat, "extra": extra }),
            &["d"],
        ),
        op(
            "bocca",
            json!({ "x": num, "y": num, "side": { "enum": ["left", "top", "right", "bottom"] },
                    "d": num, "id": { "anyOf": [id, { "type": "null" }] } }),
            &["x", "y", "side", "d"],
        ),
        op("flangia_v", xywh.clone(), &["x", "y"]),
        op("flangia_o", xywh.clone(), &["x", "y"]),
        op("tubo_o", xywh.clone(), &["x", "y", "w"]),
        op("tubo_v", xywh, &["x", "y", "h"]),
    ];
    // A part with the geometry of its kind (`ParteLib`): without it the
    // compiler says «missing field cx», and a small model said it five times.
    for kind in TIPI_PARTE {
        let (props, required): (Value, &[&str]) = match *kind {
            "level" => (
                json!({ "x": num, "y": num, "w": num, "h": num,
                        "dir": { "enum": ["up", "down", "left", "right"] } }),
                &["x", "y", "w", "h"],
            ),
            "rotor" => (
                json!({ "cx": num, "cy": num, "symmetry": num, "ccw": { "type": "boolean" } }),
                &["cx", "cy", "symmetry"],
            ),
            "needle" => (
                json!({ "cx": num, "cy": num, "a0": num, "a1": num }),
                &["cx", "cy", "a0", "a1"],
            ),
            "lever" => (
                json!({ "cx": num, "cy": num, "open": num, "closed": num,
                        "angoli": { "type": "array", "items": num } }),
                &["cx", "cy", "open", "closed"],
            ),
            "slide" => (
                json!({ "dx": num, "dy": num, "transition_ms": num }),
                &["dx", "dy"],
            ),
            "vibrate" => (
                json!({ "amplitude": num, "axis": { "enum": ["x", "y"] }, "period_ms": num }),
                &[],
            ),
            "pulse" => (json!({ "depth": num, "period_ms": num }), &[]),
            "signal" => (
                json!({ "color": colour, "entries": { "type": "array", "items": { "type": "object" } } }),
                &[],
            ),
            "glow" => (json!({ "color": colour, "radius": num }), &[]),
            "bubbles" => (
                json!({ "x": num, "y": num, "w": num, "h": num, "color": colour,
                        "count": num, "period_ms": num }),
                &["x", "y", "w", "h"],
            ),
            _ => (json!({}), &[]),
        };
        let geo = json!({ "type": "object", "required": required, "properties": props });
        ops.push(op(
            "parte",
            json!({ "id": id, "kind": { "const": kind }, "geo": geo }),
            &["id", "kind", "geo"],
        ));
    }
    // A photo of the project, kept from the symbol being changed.
    ops.push(op(
        "image",
        json!({ "src": { "type": "string", "pattern": "^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$" }, "geo": object(
            json!({ "x": num, "y": num, "width": num, "height": num }),
            &["x", "y", "width", "height"],
        ), "opacity": num }),
        &["src", "geo"],
    ));
    let rect4 = json!({ "type": "array", "items": num, "minItems": 4, "maxItems": 4 });
    for name in ["flangia", "tronchetto"] {
        ops.push(op(name, json!({ "rect": rect4 }), &["rect"]));
    }
    for tag in FORME {
        let t = json!({ "const": tag });
        ops.push(op(
            "forma",
            json!({ "tag": t, "geo": geo(tag), "mat": mat, "velo": veil, "extra": extra }),
            &["tag", "geo"],
        ));
        ops.push(op(
            "luce",
            json!({ "tag": t, "geo": geo(tag), "velo": { "enum": veils }, "opacita": num }),
            &["tag", "geo"],
        ));
        ops.push(op(
            "riflesso",
            json!({ "tag": t, "geo": geo(tag), "opacita": num }),
            &["tag", "geo"],
        ));
    }
    let sizes: Vec<u32> = (1..=51).map(|k| k * 10).collect();
    let text = json!({ "type": "string" });
    object(
        json!({
            "slug": text, "it": text, "en": text, "tipo": text,
            "w": { "enum": sizes }, "h": { "enum": sizes }, "body": { "enum": materials },
            "ops": { "type": "array", "items": { "anyOf": ops } },
        }),
        &["w", "h", "body", "ops"],
    )
}

/// Asks, compiles, and sends the errors back, up to [`ATTEMPTS`] times.
/// `fixed` = the fields the model may not change, written over its answer
/// (a null removes the field): whoever asks names the symbol, the model draws
/// it.
pub(crate) async fn draw(
    s: &AppState,
    http: &reqwest::Client,
    choice: &client::Scelta,
    system: &str,
    mut messages: Vec<Value>,
    fixed: &Map<String, Value>,
    meter: &mut (dyn Meter + Send),
) -> Result<Drawn, DrawError> {
    let mut last: Vec<String> = Vec::new();
    let shape = answer_schema();
    for attempt in 1..=ATTEMPTS {
        meter.may_call().map_err(DrawError::Stopped)?;
        let t0 = std::time::Instant::now();
        let (answer, usage) =
            client::ask_shaped(http, choice, system, &messages, MAX_TOKENS, Some(&shape))
                .await
                .map_err(|e| DrawError::Provider(format!("{e:#}")))?;
        let cost = price_list::cost_usd(
            &s.config_dir,
            choice.fornitore,
            &choice.modello,
            &usage,
            s.in_cloud(),
        );
        spending::add(
            &s.config_dir,
            scopi::Scopo::Simboli.nome(),
            choice.fornitore.nome(),
            cost,
        );
        meter.paid(cost, &usage, t0.elapsed().as_secs_f64());

        let errors = match serde_json::from_str::<Value>(estrai_json(&answer)).map(unwrapped) {
            Err(e) => vec![format!("la risposta non è un JSON valido: {e}")],
            Ok(mut d) => {
                if let Some(o) = d.as_object_mut() {
                    for (k, v) in fixed {
                        if v.is_null() {
                            o.remove(k);
                        } else {
                            o.insert(k.clone(), v.clone());
                        }
                    }
                }
                match tools::compila_bozza(&json!({ "descrizione": d })) {
                    Ok((description, compiled)) => {
                        return Ok(Drawn {
                            description,
                            compiled,
                            attempts: attempt,
                        })
                    }
                    Err(e) => e,
                }
            }
        };
        // What the model wrote, for whoever looks into a drawing that fails.
        let head: String = answer.chars().take(1500).collect();
        tracing::info!(attempt, errors = ?errors, answer = %head, "symbol drawing rejected");
        messages.push(json!({ "role": "assistant", "content": answer }));
        messages.push(json!({ "role": "user", "content": format!(
            "La descrizione ha questi errori:\n- {}\nCorreggili e rimanda la descrizione intera, \
             solo il JSON.", errors.join("\n- ")) }));
        last = errors;
    }
    Err(DrawError::Invalid(last))
}

/// The description, also when the model wraps it the way the format shows it
/// (`{"descrizione": {…}}`: qwen3.5:9b, 20-11-2026). What sits beside the
/// wrapper counts too, unless the description says it already.
fn unwrapped(v: Value) -> Value {
    let Value::Object(mut outer) = v else {
        return v;
    };
    if outer.contains_key("ops") {
        return Value::Object(outer);
    }
    match outer.remove("descrizione") {
        Some(Value::Object(mut inner)) => {
            for (k, x) in outer {
                inner.entry(k).or_insert(x);
            }
            Value::Object(inner)
        }
        Some(other) => {
            outer.insert("descrizione".into(), other);
            Value::Object(outer)
        }
        None => Value::Object(outer),
    }
}

// ── The symbol editor's AI tab ─────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// A new drawing in place of the open one: the model does not see it.
    New,
    /// The open drawing changed as the instruction says.
    Edit,
}

#[derive(Debug, Deserialize)]
pub struct Photo {
    pub media_type: String,
    /// Base64, without the `data:` prefix.
    pub data: String,
}

/// `POST /api/symbols/ai`.
#[derive(Debug, Deserialize)]
pub struct EditorRequest {
    pub mode: Mode,
    #[serde(default)]
    pub instruction: String,
    /// The symbol open in the editor, or the proposal being retouched: its
    /// slug, labels, category and variant stay whatever the model answers.
    pub description: Value,
    #[serde(default)]
    pub photo: Option<Photo>,
}

/// A photo of a phone, reduced by the editor to 1024 px, is 100–300 KB.
const PHOTO_MAX_BASE64: usize = 4 * 1024 * 1024;
const INSTRUCTION_MAX_CHARS: usize = 4000;

/// The editor's count: the cap of the purpose for one request, as a
/// conversation has it for the chat.
struct RequestMeter {
    cap_usd: f64,
    spent_usd: f64,
    calls: usize,
}

impl Meter for RequestMeter {
    fn may_call(&self) -> Result<(), String> {
        if self.spent_usd >= self.cap_usd {
            return Err(format!("{:.2} $ of {:.2} $", self.spent_usd, self.cap_usd));
        }
        Ok(())
    }
    fn paid(&mut self, cost_usd: f64, _usage: &Value, _secs: f64) {
        self.spent_usd += cost_usd;
        self.calls += 1;
    }
}

fn refused(code: &str, message: impl Into<String>) -> Value {
    json!({ "ok": false, "code": code, "message": message.into() })
}

/// What the model is asked, as the editor says it.
fn editor_messages(req: &EditorRequest, d: &Descrizione) -> Value {
    let mut text = match req.mode {
        Mode::New => format!(
            "Draw this symbol.\nslug: {}\nit: {}\nen: {}\n",
            d.slug, d.it, d.en
        ),
        Mode::Edit => format!(
            "This is the symbol as it is now:\n{}\n\nChange it as asked below. Answer with the \
             whole description, not only what changes. Keep the ids of the ports and of the parts \
             unless the request asks to change them: the pages bind them by id. Keep `w` and \
             `h` too, unless the request asks for another size: every shape stays inside them. \
             The operations `flangia` and `tronchetto` record a flange or a stub already drawn \
             by the shapes before them: keep them as they are, next to their shapes. The \
             operations `image` are photos of the project: keep them with their `src`; you may \
             move, resize or put them in another layer, never invent a new one.\n",
            serde_json::to_string_pretty(&readable(d)).unwrap_or_default()
        ),
    };
    if req.photo.is_some() {
        text.push_str(
            "\nThe photo shows the machine: draw it seen from the front, in the style of the \
             examples, with simple shapes. Leave out the background, the people and the text \
             on it.\n",
        );
    }
    if !req.instruction.trim().is_empty() {
        text.push('\n');
        text.push_str(req.instruction.trim());
    }
    match &req.photo {
        None => json!({ "role": "user", "content": text }),
        Some(p) => json!({ "role": "user", "content": [
            { "type": "image", "source": { "type": "base64", "media_type": p.media_type, "data": p.data } },
            { "type": "text", "text": text },
        ] }),
    }
}

/// A description as the format shows it: `geo` as an object. The library's
/// descriptions keep it as pairs, to keep the order of the attributes
/// (`genera.py`), and a model shown pairs answers in a shape of its own
/// (qwen3.5:9b, 20-11-2026: `op` inside `geo`). The compiler reads both, and
/// puts the keys of `geo` in the same canonical order; `extra` stays as it is,
/// since an object would sort its keys and change the drawing's text.
fn readable(d: &Descrizione) -> Value {
    let mut v = serde_json::to_value(d).unwrap_or_default();
    // Not the model's to write: a library field, and the variant the caller
    // keeps (`fixed`). The answer schema has no place for them.
    if let Some(o) = v.as_object_mut() {
        for k in ["family", "replaces", "overrides"] {
            o.remove(k);
        }
    }
    for op in v
        .get_mut("ops")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        if op
            .get("extra")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            if let Some(o) = op.as_object_mut() {
                o.remove("extra");
            }
        }
        let Some(pairs) = op.get("geo").and_then(Value::as_array) else {
            continue;
        };
        let obj: Map<String, Value> = pairs
            .iter()
            .filter_map(|p| Some((p.get(0)?.as_str()?.to_string(), p.get(1)?.clone())))
            .collect();
        op["geo"] = Value::Object(obj);
    }
    v
}

/// The AI tab of the symbol editor: one drawing, its compiled preview, what
/// it cost. Every outcome is a 200 with `ok` and, when it is false, a `code`
/// the editor says in its own language: `no_model`, `blind_model`,
/// `bad_request`, `cap_reached`, `provider`, `invalid`.
pub(crate) async fn editor(
    s: &AppState,
    choice: Option<client::Scelta>,
    http: &reqwest::Client,
    req: EditorRequest,
) -> Value {
    let Some(choice) = choice else {
        return refused("no_model", "no AI model is configured");
    };
    let d: Descrizione = match serde_json::from_value(req.description.clone()) {
        Ok(d) => d,
        Err(e) => return refused("bad_request", format!("description: {e}")),
    };
    if req.instruction.trim().is_empty() && req.photo.is_none() {
        return refused("bad_request", "nothing asked");
    }
    if req.instruction.chars().count() > INSTRUCTION_MAX_CHARS {
        return refused("bad_request", "instruction too long");
    }
    if let Some(p) = &req.photo {
        if !matches!(
            p.media_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp"
        ) {
            return refused("bad_request", format!("photo of type {}", p.media_type));
        }
        if p.data.len() > PHOTO_MAX_BASE64 {
            return refused("bad_request", "photo too big");
        }
        // Before paying: a model that does not see images would draw from
        // the words alone, and say nothing about it.
        if !choice.sees_images {
            return json!({ "ok": false, "code": "blind_model", "model": choice.modello });
        }
    }
    let system = match system(s).await {
        Ok(v) => v,
        Err(e) => return refused("provider", e),
    };
    let mut fixed = Map::new();
    fixed.insert("slug".into(), json!(d.slug));
    fixed.insert("it".into(), json!(d.it));
    fixed.insert("en".into(), json!(d.en));
    fixed.insert("tipo".into(), json!(d.tipo));
    fixed.insert("overrides".into(), json!(d.overrides));
    let mut meter = RequestMeter {
        cap_usd: choice.tetto_usd,
        spent_usd: 0.0,
        calls: 0,
    };
    let messages = vec![editor_messages(&req, &d)];
    let result = draw(s, http, &choice, &system, messages, &fixed, &mut meter).await;
    // The photos are the project's (plan 2026-11-21-simboli-fase-3-foto): a
    // model can keep and move them, never name one the symbol didn't have.
    let photos: Vec<String> = sws_core::simboli_prj::compila(&d)
        .ok()
        .and_then(|c| serde_json::from_value(c.voce["images"].clone()).ok())
        .unwrap_or_default();
    let result = result.map(|drawn| keep_known_photos(drawn, &photos));
    let mut out = match result {
        Ok(drawn) => json!({
            "ok": true,
            "description": drawn.description,
            "svg": drawn.compiled.svg,
            "voce": drawn.compiled.voce,
        }),
        Err(DrawError::Stopped(m)) => refused("cap_reached", m),
        Err(DrawError::Provider(m)) => refused("provider", m),
        Err(DrawError::Invalid(errors)) => {
            json!({ "ok": false, "code": "invalid", "errors": errors })
        }
    };
    out["attempts"] = json!(meter.calls);
    out["cost_usd"] = json!(meter.spent_usd);
    out["model"] = json!(choice.modello);
    out
}

/// `drawn` without the photos it names that are not in `known`, compiled
/// again when something went.
fn keep_known_photos(mut drawn: Drawn, known: &[String]) -> Drawn {
    use sws_core::simboli_prj::Op;
    let before = drawn.description.ops.len();
    drawn
        .description
        .ops
        .retain(|op| !matches!(op, Op::Image { src, .. } if !known.contains(src)));
    if drawn.description.ops.len() != before {
        if let Ok(c) = sws_core::simboli_prj::compila(&drawn.description) {
            drawn.compiled = c;
        }
    }
    drawn
}

// ── The interview before the drawing ───────────────────────────────────────
//
// The maintainer, 20-11-2026, after a vague request drawn badly: «vorrei che
// fosse la chat, nel primo step, a fare una intervista all'utente per definire
// veramente cosa vuole, l'equivalente della modalità plan». The model asks
// what the request leaves open, at most [`MAX_ROUNDS`] rounds, then writes a
// brief the user can correct; the drawing is asked from the brief.

/// Rounds of questions before the brief is due.
pub(crate) const MAX_ROUNDS: usize = 2;
const MAX_QUESTIONS: usize = 4;
const MAX_CHOICES: usize = 4;

/// A round already answered: the questions, and the answers in their order
/// (an empty answer = «decide yourself»).
#[derive(Debug, Deserialize)]
pub struct Round {
    pub questions: Vec<String>,
    #[serde(default)]
    pub answers: Vec<String>,
}

/// `POST /api/symbols/ai/interview`.
#[derive(Debug, Deserialize)]
pub struct InterviewRequest {
    pub mode: Mode,
    #[serde(default)]
    pub instruction: String,
    pub description: Value,
    #[serde(default)]
    pub photo: Option<Photo>,
    #[serde(default)]
    pub rounds: Vec<Round>,
}

const INTERVIEW_SYSTEM: &str = "You prepare the drawing of a symbol for SWS, a SCADA: a machine or a \
device seen from the front, for the synoptic pages of an industrial or home panel. Another model will \
draw it from what you write, so the request must say what matters before anyone draws.\n\n\
What a symbol can have:\n\
- shapes in the materials of the library (steel, stainless steel, dark steel, glass, rubber, liquid, \
paint…) or in colours of its own, inside a box of w×h units (multiples of 10, at most 510);\n\
- a body, whose colour follows the state of the machine on the page (off, on, alarm);\n\
- pipe ports on its borders: each has an id, a side (left, top, right, bottom) and a diameter; the \
pipes of the page attach there;\n\
- live parts, each driven by a tag of the page or by a fixed value: a rotor turns while a yes/no is \
true; a needle turns to a number between a minimum and a maximum; a lever goes between two or more \
positions (an index); a level fills from a side with a number; a signal changes colour, blinks or \
hides by value or range (up to 8 entries, e.g. green at 1, red blinking from 2 to 9); a slide moves \
between two positions; vibrate and pulse act while a yes/no is true.\n\
- No text: the panel has no fonts in a symbol. Labels go on the page.\n\n\
Read the request. Ask ONLY what it leaves open and what changes the drawing: what the thing is and \
how it looks, the proportions, how many ports and on which side, which parts move or change and \
with which value (yes/no, a number and its range, an index and how many positions), and whether \
several parts follow the same value. At most 4 short questions, each with 2 to 4 likely answers. \
Do not ask what you can decide well yourself.\n\n\
When nothing that matters is open, write the brief instead: what the drawer must do, in order — \
size, the shapes and where they are, the materials, each port with its id and side, each live part \
with its kind, its id, its values and the tag it follows. At most 1500 characters, plain sentences.\n\n\
Write the questions and the brief in the language of the request. Answer ONLY with JSON: \
{\"questions\": [{\"text\": \"…\", \"choices\": [\"…\"]}]} or {\"brief\": \"…\"}.";

/// What the answer may be, as JSON Schema (held to it on a local server).
fn interview_schema() -> Value {
    json!({ "type": "object", "additionalProperties": false, "properties": {
        "questions": { "type": "array", "items": { "type": "object", "additionalProperties": false,
            "required": ["text"], "properties": {
                "text": { "type": "string" },
                "choices": { "type": "array", "items": { "type": "string" } } } } },
        "brief": { "type": "string" },
    } })
}

/// The conversation of the interview so far.
fn interview_messages(req: &InterviewRequest, d: &Descrizione) -> Vec<Value> {
    let mut text = match req.mode {
        Mode::New => "The user wants a new symbol.\n".to_string(),
        Mode::Edit => format!(
            "The user wants to change the symbol open in the editor ({} × {}), which is now:\n{}\n",
            d.w,
            d.h,
            serde_json::to_string(&readable(d)).unwrap_or_default()
        ),
    };
    if req.photo.is_some() {
        text.push_str("The photo shows the machine to draw.\n");
    }
    text.push_str("\nThe request:\n");
    text.push_str(req.instruction.trim());
    let first = match &req.photo {
        None => json!({ "role": "user", "content": text }),
        Some(p) => json!({ "role": "user", "content": [
            { "type": "image", "source": { "type": "base64", "media_type": p.media_type, "data": p.data } },
            { "type": "text", "text": text },
        ] }),
    };
    let mut out = vec![first];
    for (n, r) in req.rounds.iter().enumerate() {
        out.push(json!({ "role": "assistant", "content": json!({
            "questions": r.questions.iter().map(|q| json!({ "text": q })).collect::<Vec<_>>() }).to_string() }));
        let mut answers = String::from("The answers:\n");
        for (i, q) in r.questions.iter().enumerate() {
            let a = r.answers.get(i).map(|a| a.trim()).filter(|a| !a.is_empty());
            answers.push_str(&format!("- {q} → {}\n", a.unwrap_or("(decide yourself)")));
        }
        if n + 1 >= MAX_ROUNDS {
            answers.push_str("\nNo more questions now: write the brief.");
        }
        out.push(json!({ "role": "user", "content": answers }));
    }
    out
}

/// What the model answered, cleaned: at most four questions with four
/// choices, or a brief no longer than an instruction may be.
fn interview_answer(v: &Value) -> Option<Value> {
    let brief = v
        .get("brief")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|b| !b.is_empty());
    if let Some(b) = brief {
        return Some(json!({ "brief": b.chars().take(INSTRUCTION_MAX_CHARS).collect::<String>() }));
    }
    let questions: Vec<Value> = v
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|q| {
            let text = q.get("text").and_then(Value::as_str)?.trim();
            (!text.is_empty()).then(|| {
                let choices: Vec<&str> = q
                    .get("choices")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|c| !c.is_empty())
                    .take(MAX_CHOICES)
                    .collect();
                json!({ "text": text, "choices": choices })
            })
        })
        .take(MAX_QUESTIONS)
        .collect();
    (!questions.is_empty()).then(|| json!({ "questions": questions }))
}

/// One round of the interview: questions, or the brief. Codes as [`editor`]:
/// `no_model`, `blind_model`, `bad_request`, `cap_reached`, `provider`, and
/// `invalid` when the answer did not read twice.
pub(crate) async fn interview(
    s: &AppState,
    choice: Option<client::Scelta>,
    http: &reqwest::Client,
    req: InterviewRequest,
) -> Value {
    let Some(choice) = choice else {
        return refused("no_model", "no AI model is configured");
    };
    let d: Descrizione = match serde_json::from_value(req.description.clone()) {
        Ok(d) => d,
        Err(e) => return refused("bad_request", format!("description: {e}")),
    };
    if req.instruction.trim().is_empty() && req.photo.is_none() {
        return refused("bad_request", "nothing asked");
    }
    if req.instruction.chars().count() > INSTRUCTION_MAX_CHARS || req.rounds.len() > MAX_ROUNDS {
        return refused("bad_request", "instruction too long or too many rounds");
    }
    if let Some(p) = &req.photo {
        if p.data.len() > PHOTO_MAX_BASE64 {
            return refused("bad_request", "photo too big");
        }
        if !choice.sees_images {
            return json!({ "ok": false, "code": "blind_model", "model": choice.modello });
        }
    }
    let mut meter = RequestMeter {
        cap_usd: choice.tetto_usd,
        spent_usd: 0.0,
        calls: 0,
    };
    let mut messages = interview_messages(&req, &d);
    let shape = interview_schema();
    let mut out = refused("invalid", "the answer did not read");
    for _ in 0..2 {
        if let Err(m) = meter.may_call() {
            out = refused("cap_reached", m);
            break;
        }
        let (answer, usage) = match client::ask_shaped(
            http,
            &choice,
            INTERVIEW_SYSTEM,
            &messages,
            4000,
            Some(&shape),
        )
        .await
        {
            Ok(a) => a,
            Err(e) => {
                out = refused("provider", format!("{e:#}"));
                break;
            }
        };
        let cost = price_list::cost_usd(
            &s.config_dir,
            choice.fornitore,
            &choice.modello,
            &usage,
            s.in_cloud(),
        );
        spending::add(
            &s.config_dir,
            scopi::Scopo::Simboli.nome(),
            choice.fornitore.nome(),
            cost,
        );
        meter.paid(cost, &usage, 0.0);
        let read = serde_json::from_str::<Value>(estrai_json(&answer)).ok();
        if let Some(mut good) = read.as_ref().and_then(interview_answer) {
            good["ok"] = json!(true);
            out = good;
            break;
        }
        tracing::info!(answer = %answer.chars().take(800).collect::<String>(), "symbol interview unreadable");
        messages.push(json!({ "role": "assistant", "content": answer }));
        messages.push(json!({ "role": "user", "content":
            "That is not the JSON asked: answer only {\"questions\": [...]} or {\"brief\": \"...\"}." }));
    }
    out["cost_usd"] = json!(meter.spent_usd);
    out["model"] = json!(choice.modello);
    out
}

#[cfg(test)]
mod photo_tests {
    use super::*;

    #[test]
    fn a_model_keeps_the_photos_and_cannot_invent_one() {
        let mut d: Descrizione = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-prj/photo-boiler.json"
        ))
        .unwrap();
        d.ops.push(
            serde_json::from_value(json!({ "op": "image", "src": "invented.png",
                "geo": { "x": 0, "y": 0, "width": 10, "height": 10 } }))
            .unwrap(),
        );
        let compiled = sws_core::simboli_prj::compila(&d).unwrap();
        let drawn = Drawn { description: d, compiled, attempts: 1 };
        let known = vec!["boiler.jpg".to_string(), "fan-cutout.png".to_string(), "flame-off.png".to_string()];
        let kept = keep_known_photos(drawn, &known);
        assert!(!kept.compiled.svg.contains("invented.png"));
        assert!(kept.compiled.svg.contains("boiler.jpg"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    type Seen = Arc<Mutex<Vec<Value>>>;

    /// A local model on localhost that answers each request with the next
    /// text of `answers`, and keeps the bodies it received.
    async fn fake_model(answers: Vec<String>) -> (String, Seen) {
        let seen: Seen = Default::default();
        let queue = Arc::new(Mutex::new(answers.into_iter()));
        let seen2 = seen.clone();
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let (seen, queue) = (seen2.clone(), queue.clone());
                async move {
                    seen.lock().unwrap().push(body);
                    let text = queue.lock().unwrap().next().unwrap_or_default();
                    axum::Json(json!({
                        "choices": [{ "index": 0, "finish_reason": "stop",
                                      "message": { "role": "assistant", "content": text } }],
                        "usage": { "prompt_tokens": 900, "completion_tokens": 300 },
                    }))
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        (format!("http://{addr}/v1/chat/completions"), seen)
    }

    fn local(url: &str, sees_images: bool) -> client::Scelta {
        client::Scelta {
            fornitore: client::Fornitore::Local,
            chiave: "local".into(),
            source: client::KeySource::Project,
            modello: "qwen3.5:9b".into(),
            tetto_usd: 1.0,
            endpoint: Some(url.into()),
            sees_images,
        }
    }

    /// A symbol that compiles, as a model would write it.
    fn gabbia() -> Value {
        serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap()
    }

    /// The symbol open in the editor: a new one, with its name and category.
    fn open_symbol() -> Value {
        json!({ "slug": "mixer-tank", "w": 100, "h": 100, "tipo": "tanks", "body": "body-pump",
                "it": "Serbatoio miscelatore", "en": "Mixer tank",
                "ops": [{ "op": "corpo" }, { "op": "forma", "tag": "rect",
                          "geo": { "x": 10, "y": 10, "width": 80, "height": 80 } }] })
    }

    async fn ask(answers: Vec<String>, sees: bool, req: Value) -> (Value, Seen, tempfile::TempDir) {
        let (url, seen) = fake_model(answers).await;
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        let req: EditorRequest = serde_json::from_value(req).unwrap();
        let out = editor(&s, Some(local(&url, sees)), &reqwest::Client::new(), req).await;
        (out, seen, dir)
    }

    /// A new drawing that compiles at once: the names of the open symbol stay,
    /// whatever the model wrote; the call is in the history of the purpose.
    #[tokio::test]
    async fn a_new_symbol_keeps_the_names_of_the_open_one() {
        let (out, seen, dir) = ask(
            vec![format!("Here it is:\n```json\n{}\n```", gabbia())],
            false,
            json!({ "mode": "new", "instruction": "un serbatoio con l'agitatore",
                    "description": open_symbol() }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["attempts"], 1);
        assert_eq!(out["model"], "qwen3.5:9b");
        let d = &out["description"];
        assert_eq!(d["slug"], "mixer-tank");
        assert_eq!(
            (d["it"].as_str(), d["en"].as_str()),
            (Some("Serbatoio miscelatore"), Some("Mixer tank"))
        );
        assert_eq!(d["tipo"], "tanks");
        assert!(out["svg"].as_str().unwrap().contains("<svg"));
        assert_eq!(out["voce"]["id"], "prj:mixer-tank");

        let seen = seen.lock().unwrap();
        let system = seen[0]["messages"][0]["content"].as_str().unwrap();
        assert!(system.contains("Formato, regole ed esempi"), "{system}");
        let user = seen[0]["messages"][1]["content"].as_str().unwrap();
        assert!(
            user.contains("slug: mixer-tank") && user.contains("agitatore"),
            "{user}"
        );
        assert!(
            !user.contains("\"ops\""),
            "a new drawing does not show the old one: {user}"
        );

        let r = spending::Record::load(dir.path());
        assert_eq!(
            r.months[&spending::current_month()]["simboli"]["local"].calls,
            1
        );
    }

    /// A wrong answer goes back with its errors, and the second one passes.
    #[tokio::test]
    async fn the_errors_go_back_to_the_model() {
        let mut broken = gabbia();
        broken["body"] = json!("no-such-material");
        let (out, seen, _dir) = ask(
            vec![broken.to_string(), gabbia().to_string()],
            false,
            json!({ "mode": "new", "instruction": "x", "description": open_symbol() }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["attempts"], 2);
        let seen = seen.lock().unwrap();
        let back = seen[1]["messages"].as_array().unwrap();
        let last = back.last().unwrap()["content"].as_str().unwrap();
        assert!(
            last.contains("errori") && last.contains("no-such-material"),
            "{last}"
        );
    }

    /// Three wrong answers: the errors, and no more calls than that.
    #[tokio::test]
    async fn three_wrong_answers_give_the_errors() {
        let (out, seen, _dir) = ask(
            vec![
                "not json".into(),
                "{}".into(),
                "{\"ops\": 3}".into(),
                gabbia().to_string(),
            ],
            false,
            json!({ "mode": "new", "instruction": "x", "description": open_symbol() }),
        )
        .await;
        assert_eq!(out["ok"], false);
        assert_eq!(out["code"], "invalid");
        assert_eq!(out["attempts"], 3);
        assert!(!out["errors"].as_array().unwrap().is_empty());
        assert_eq!(seen.lock().unwrap().len(), 3);
    }

    /// An edit shows the model the symbol as it is, and keeps the variant it
    /// is (`overrides`) even when the model drops it.
    #[tokio::test]
    async fn an_edit_shows_the_symbol_and_keeps_the_variant() {
        let mut open = gabbia();
        open["slug"] = json!("my-pump");
        open["overrides"] = json!("lib:process/centrifugal-pump");
        let mut answer = gabbia();
        answer["slug"] = json!("renamed-by-the-model");
        let (out, seen, _dir) = ask(
            vec![answer.to_string()],
            false,
            json!({ "mode": "edit", "instruction": "fai il motore più grande", "description": open }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["description"]["slug"], "my-pump");
        assert_eq!(
            out["description"]["overrides"],
            "lib:process/centrifugal-pump"
        );
        let seen = seen.lock().unwrap();
        let user = seen[0]["messages"][1]["content"].as_str().unwrap();
        assert!(
            user.contains("\"ops\"") && user.contains("motore più grande"),
            "{user}"
        );
    }

    /// The symbol is shown as the format writes it: `geo` as an object, and a
    /// description written back that way compiles to the same drawing.
    #[test]
    fn the_symbol_is_shown_in_the_format_of_the_schema() {
        let lib = crate::simboli_progetto::library_variant("lib:process/centrifugal-pump").unwrap();
        let shown = readable(&lib);
        assert!(shown["ops"][0]["geo"].is_object(), "{}", shown["ops"][0]);
        assert!(shown.get("family").is_none());
        let back: Descrizione = serde_json::from_value(shown).unwrap();
        let a = sws_core::simboli_prj::compila_e_controlla(&lib).unwrap();
        let b = sws_core::simboli_prj::compila_e_controlla(&back).unwrap();
        assert_eq!(a.svg, b.svg);
    }

    /// Does `v` fit `s`? The JSON Schema [`answer_schema`] writes, no more:
    /// objects, arrays, anyOf, const, enum, types. Patterns are the compiler's
    /// business. A numeric string fits a number: the library writes some
    /// (`"cx": "56.5"`), the compiler reads both, a model held to the schema
    /// writes the number.
    fn fits(v: &Value, s: &Value) -> bool {
        if let Some(any) = s.get("anyOf").and_then(Value::as_array) {
            return any.iter().any(|x| fits(v, x));
        }
        if let Some(c) = s.get("const") {
            return v == c;
        }
        if let Some(e) = s.get("enum").and_then(Value::as_array) {
            return e.contains(v);
        }
        let count = |k: &str| s.get(k).and_then(Value::as_u64);
        match s.get("type").and_then(Value::as_str) {
            Some("null") => v.is_null(),
            Some("number") => {
                v.is_number() || v.as_str().is_some_and(|t| t.trim().parse::<f64>().is_ok())
            }
            Some("string") => v.is_string(),
            Some("array") => v.as_array().is_some_and(|a| {
                count("minItems").is_none_or(|n| a.len() as u64 >= n)
                    && count("maxItems").is_none_or(|n| a.len() as u64 <= n)
                    && s.get("items")
                        .is_none_or(|it| a.iter().all(|x| fits(x, it)))
            }),
            Some("object") => v.as_object().is_some_and(|o| {
                let props = s.get("properties").and_then(Value::as_object);
                let required = s.get("required").and_then(Value::as_array);
                required.is_none_or(|r| {
                    r.iter()
                        .all(|k| k.as_str().is_some_and(|k| o.contains_key(k)))
                }) && (s.get("additionalProperties") != Some(&json!(false))
                    || o.keys().all(|k| props.is_some_and(|p| p.contains_key(k))))
                    && o.iter()
                        .all(|(k, x)| props.and_then(|p| p.get(k)).is_none_or(|ps| fits(x, ps)))
            }),
            _ => true,
        }
    }

    /// The schema a local model is held to takes every symbol of the library,
    /// as an edit shows it, and the examples of the format: a model can write
    /// whatever the library draws.
    #[test]
    fn the_answer_schema_takes_the_library_and_the_examples() {
        let schema = answer_schema();
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-descrizioni.json"
        ))
        .unwrap();
        let mut n = 0;
        for v in fixture["simboli"].as_array().unwrap() {
            let d: Descrizione = serde_json::from_value(v.clone()).unwrap();
            let shown = readable(&d);
            for op in shown["ops"].as_array().unwrap() {
                assert!(
                    fits(op, &schema["properties"]["ops"]["items"]),
                    "{}: {op}",
                    d.slug
                );
            }
            assert!(fits(&shown, &schema), "{}", d.slug);
            n += 1;
        }
        assert!(n > 150, "{n}");
        let examples: Value =
            serde_json::from_str(crate::synoptic_schema::SYMBOL_EXAMPLES_JSON).unwrap();
        for e in examples.as_array().unwrap() {
            assert!(fits(e, &schema), "{}", e["slug"]);
        }
        // Every kind of part has its branch, with its geometry.
        let items = &schema["properties"]["ops"]["items"];
        for kind in sws_core::simboli_prj::TIPI_PARTE {
            let part = json!({ "op": "parte", "id": "p1", "kind": kind, "geo": {} });
            let needs_geo = !matches!(*kind, "lamp" | "vibrate" | "pulse" | "signal" | "glow");
            assert_eq!(fits(&part, items), !needs_geo, "{kind}");
        }
        // And what it is for: a description that does not read does not fit.
        assert!(!fits(
            &json!({ "w": 100, "h": 100, "body": "steel" }),
            &schema
        ));
        assert!(!fits(
            &json!({ "w": 100, "h": 100, "body": "steel", "ops": [{ "op": "tubo_diagn" }] }),
            &schema
        ));
        assert!(!fits(
            &json!({ "w": 85, "h": 100, "body": "steel", "ops": [] }),
            &schema
        ));
    }

    /// A local model is held to the schema; the request says it.
    #[tokio::test]
    async fn a_local_model_is_held_to_the_schema() {
        let (out, seen, _dir) = ask(
            vec![gabbia().to_string()],
            false,
            json!({ "mode": "new", "instruction": "x", "description": open_symbol() }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        let seen = seen.lock().unwrap();
        let f = &seen[0]["response_format"];
        assert_eq!(f["type"], "json_schema");
        assert_eq!(
            f["json_schema"]["schema"]["required"],
            json!(["w", "h", "body", "ops"])
        );
    }

    async fn interview_with(answers: Vec<String>, req: Value) -> (Value, Seen, tempfile::TempDir) {
        let (url, seen) = fake_model(answers).await;
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        let req: InterviewRequest = serde_json::from_value(req).unwrap();
        let out = interview(&s, Some(local(&url, false)), &reqwest::Client::new(), req).await;
        (out, seen, dir)
    }

    /// A vague request gets questions, at most four with four choices each,
    /// asked with the interview's instructions and held to its schema.
    #[tokio::test]
    async fn a_vague_request_gets_questions() {
        let qs: Vec<Value> = (1..=6)
            .map(|n| json!({ "text": format!("domanda {n}?"), "choices": ["a", "b", "c", "d", "e"] }))
            .collect();
        let (out, seen, _dir) = interview_with(
            vec![json!({ "questions": qs }).to_string()],
            json!({ "mode": "new", "instruction": "un collettore a 5 ingressi", "description": open_symbol() }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["questions"].as_array().unwrap().len(), 4);
        assert_eq!(out["questions"][0]["choices"].as_array().unwrap().len(), 4);
        assert!(out.get("brief").is_none());
        let seen = seen.lock().unwrap();
        assert!(seen[0]["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("Ask ONLY what it leaves open"));
        assert!(seen[0]["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("collettore a 5 ingressi"));
        assert_eq!(seen[0]["response_format"]["type"], "json_schema");
    }

    /// The answers go back with the questions, an empty one as «decide
    /// yourself»; after the last round the model is told to write the brief.
    #[tokio::test]
    async fn the_answers_go_back_and_the_last_round_asks_for_the_brief() {
        let (out, seen, _dir) = interview_with(
            vec![json!({ "brief": "  Un collettore orizzontale 160×100 in inox.  " }).to_string()],
            json!({ "mode": "new", "instruction": "un collettore", "description": open_symbol(),
                    "rounds": [
                        { "questions": ["Gli ingressi dove?"], "answers": ["sopra"] },
                        { "questions": ["Quanti LED?", "Che tag?"], "answers": ["5", ""] },
                    ] }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["brief"], "Un collettore orizzontale 160×100 in inox.");
        let seen = seen.lock().unwrap();
        let m = seen[0]["messages"].as_array().unwrap();
        // system, request, then question and answers for each round.
        assert_eq!(m.len(), 6);
        assert!(m[2]["content"]
            .as_str()
            .unwrap()
            .contains("Gli ingressi dove?"));
        let last = m[5]["content"].as_str().unwrap();
        assert!(
            last.contains("Quanti LED? → 5") && last.contains("Che tag? → (decide yourself)"),
            "{last}"
        );
        assert!(last.contains("write the brief"), "{last}");
        assert!(!m[3]["content"]
            .as_str()
            .unwrap()
            .contains("write the brief"));
    }

    /// An answer that does not read is asked again once; twice, it is said.
    #[tokio::test]
    async fn an_unreadable_interview_is_asked_again_once() {
        let req = json!({ "mode": "new", "instruction": "x", "description": open_symbol() });
        let (out, seen, _dir) = interview_with(
            vec![
                "sure, here are my questions".into(),
                json!({ "brief": "ok" }).to_string(),
            ],
            req.clone(),
        )
        .await;
        assert_eq!(out["brief"], "ok", "{out}");
        assert_eq!(seen.lock().unwrap().len(), 2);
        let (out, _seen, _dir) = interview_with(vec!["no".into(), "{}".into()], req).await;
        assert_eq!(out["code"], "invalid", "{out}");
        // Too many rounds, and no model: said before calling anyone.
        let (out, seen, _dir) = interview_with(
            vec![],
            json!({ "mode": "new", "instruction": "x", "description": open_symbol(),
                    "rounds": [{ "questions": [] }, { "questions": [] }, { "questions": [] }] }),
        )
        .await;
        assert_eq!(out["code"], "bad_request");
        assert!(seen.lock().unwrap().is_empty());
    }

    /// A model that adds a variant on its own does not make one.
    #[tokio::test]
    async fn a_new_symbol_is_not_a_variant() {
        let mut answer = gabbia();
        answer["overrides"] = json!("lib:process/centrifugal-pump");
        let (out, _seen, _dir) = ask(
            vec![answer.to_string()],
            false,
            json!({ "mode": "new", "instruction": "x", "description": open_symbol() }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        assert!(out["description"].get("overrides").is_none(), "{out}");
    }

    /// A photo for a model that does not see images: refused before calling it.
    #[tokio::test]
    async fn a_photo_for_a_blind_model_is_refused_before_paying() {
        let (out, seen, _dir) = ask(
            vec![gabbia().to_string()],
            false,
            json!({ "mode": "new", "instruction": "", "description": open_symbol(),
                    "photo": { "media_type": "image/jpeg", "data": "AAAA" } }),
        )
        .await;
        assert_eq!(out["code"], "blind_model", "{out}");
        assert!(seen.lock().unwrap().is_empty());
    }

    /// A photo for a model that sees: it leaves as an image part.
    #[tokio::test]
    async fn a_photo_reaches_a_model_that_sees() {
        let (out, seen, _dir) = ask(
            vec![gabbia().to_string()],
            true,
            json!({ "mode": "new", "instruction": "", "description": open_symbol(),
                    "photo": { "media_type": "image/jpeg", "data": "AAAA" } }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        let seen = seen.lock().unwrap();
        let parts = seen[0]["messages"][1]["content"].as_array().unwrap();
        let url = parts
            .iter()
            .find(|p| p["type"] == "image_url")
            .map(|p| p["image_url"].to_string())
            .unwrap_or_default();
        assert!(url.contains("data:image/jpeg;base64,AAAA"), "{parts:?}");
    }

    /// A description wrapped as the format shows it is a description.
    #[tokio::test]
    async fn a_wrapped_description_is_read() {
        let mut inner = gabbia();
        let w = inner.as_object_mut().unwrap().remove("w").unwrap();
        let (out, _seen, _dir) = ask(
            vec![json!({ "descrizione": inner, "w": w }).to_string()],
            false,
            json!({ "mode": "new", "instruction": "x", "description": open_symbol() }),
        )
        .await;
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["attempts"], 1);
        assert_eq!(
            unwrapped(json!({ "ops": [], "descrizione": 1 }))["descrizione"],
            1
        );
    }

    /// The error says which operation: the model can't fix what it can't find.
    #[test]
    fn an_unreadable_operation_is_named() {
        let mut d = open_symbol();
        d["ops"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "op": "tubo_v", "x": 1, "y": 2 }));
        let e = tools::compila_bozza(&json!({ "descrizione": d })).unwrap_err();
        assert!(e[0].contains("ops[2]"), "{e:?}");
    }

    #[tokio::test]
    async fn no_model_and_bad_requests_are_said() {
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        let http = reqwest::Client::new();
        let req = |v: Value| serde_json::from_value::<EditorRequest>(v).unwrap();
        let out = editor(
            &s,
            None,
            &http,
            req(json!({ "mode": "new", "instruction": "x",
                                                       "description": open_symbol() })),
        )
        .await;
        assert_eq!(out["code"], "no_model");
        let sc = Some(local("http://127.0.0.1:9/v1/chat/completions", true));
        let out = editor(
            &s,
            sc.clone(),
            &http,
            req(json!({ "mode": "new", "instruction": " ",
                                                             "description": open_symbol() })),
        )
        .await;
        assert_eq!(out["code"], "bad_request");
        let out = editor(&s, sc, &http, req(json!({ "mode": "new", "instruction": "x",
                                                     "description": open_symbol(),
                                                     "photo": { "media_type": "image/gif", "data": "R0" } }))).await;
        assert_eq!(out["code"], "bad_request");
    }

    /// The cap of the purpose holds for one request: a call that passes it
    /// stops the next attempt.
    #[tokio::test]
    async fn the_cap_stops_the_next_attempt() {
        let mut m = RequestMeter {
            cap_usd: 0.10,
            spent_usd: 0.0,
            calls: 0,
        };
        assert!(m.may_call().is_ok());
        m.paid(0.12, &Value::Null, 1.0);
        assert!(m.may_call().unwrap_err().contains("0.12 $ of 0.10 $"));
    }
}
