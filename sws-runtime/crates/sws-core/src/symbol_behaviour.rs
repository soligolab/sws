//! What the live parts of a symbol do with their input, and how the timed
//! ones move: one rule for the two engines (plan
//! `docs/archive/2026-11-19-animazioni-dei-simboli.md`).
//!
//! The TypeScript twin is `valoriParti` in
//! `sws-editor/src/symbols/lib/libreria.ts` and
//! `sws-editor/src/symbols/lib/behaviour.ts`; the cases are in
//! `tests/fixtures/symbol-pieces.json` (and, for the five kinds that came
//! first, `tests/fixtures/parti-simbolo.json`). If the two engines diverged,
//! the same tag would draw two different symbols.

use crate::simboli_lib::{FillDir, ParteLib, SignalEntry};
use crate::tag::TagValue;

/// The value of a part; `None` inside = as drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ValoreParte {
    Frazione(Option<f64>),
    Aperta(Option<bool>),
    /// L'indice nella lista degli angoli, per una leva a più di due posizioni
    /// (21-10-2026). Le leve booleane continuano a dare `Aperta`: vedi il
    /// commento gemello in `libreria.ts`.
    Posizione(Option<usize>),
    Accesa(Option<bool>),
    /// Rotor, vibrate, pulse: whether it moves; a glow: whether it shines.
    Active(Option<bool>),
    /// Signal: the entry that matches.
    Entry(Option<usize>),
}

/// An input value, from a tag or fixed in the page: the same truthiness and
/// the same numbers whichever it comes from.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Scalar<'a> {
    Bool(bool),
    Num(f64),
    Str(&'a str),
    /// An array or a struct: never true, never a number.
    Other,
}

impl<'a> Scalar<'a> {
    pub fn of_tag(v: &'a TagValue) -> Self {
        match v {
            TagValue::Bool(b) => Scalar::Bool(*b),
            TagValue::Int(i) => Scalar::Num(*i as f64),
            TagValue::Float(f) => Scalar::Num(*f),
            TagValue::Str(s) => Scalar::Str(s),
            TagValue::Array(_) | TagValue::Struct(_) => Scalar::Other,
        }
    }

    /// A fixed value of the page; `null` is no value.
    pub fn of_json(v: &'a serde_json::Value) -> Option<Self> {
        Some(match v {
            serde_json::Value::Bool(b) => Scalar::Bool(*b),
            serde_json::Value::Number(n) => Scalar::Num(n.as_f64()?),
            serde_json::Value::String(s) => Scalar::Str(s),
            serde_json::Value::Null => return None,
            _ => Scalar::Other,
        })
    }

    /// `veroSimbolo` on the web.
    pub fn truthy(self) -> bool {
        match self {
            Scalar::Bool(b) => b,
            Scalar::Num(n) => n != 0.0,
            Scalar::Str(s) => !s.trim().is_empty(),
            Scalar::Other => false,
        }
    }

    /// `numeroParte` on the web: a number, or nothing.
    pub fn number(self) -> Option<f64> {
        match self {
            Scalar::Bool(b) => Some(if b { 1.0 } else { 0.0 }),
            Scalar::Num(n) => n.is_finite().then_some(n),
            Scalar::Str(s) if !s.trim().is_empty() => {
                s.trim().parse::<f64>().ok().filter(|f| f.is_finite())
            }
            _ => None,
        }
    }

    /// `Number(v)` in JavaScript, for the ranges of an entry: an empty text is
    /// 0, a text that isn't a number is not.
    fn js_number(self) -> Option<f64> {
        match self {
            Scalar::Bool(b) => Some(if b { 1.0 } else { 0.0 }),
            Scalar::Num(n) => n.is_finite().then_some(n),
            Scalar::Str(s) if s.trim().is_empty() => Some(0.0),
            Scalar::Str(s) => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()),
            Scalar::Other => None,
        }
    }

    /// `String(v)` in JavaScript, for the exact values of an entry.
    fn js_string(self) -> String {
        match self {
            Scalar::Bool(b) => b.to_string(),
            Scalar::Num(n) => js_number_string(n),
            Scalar::Str(s) => s.to_string(),
            Scalar::Other => String::new(),
        }
    }
}

fn js_number_string(n: f64) -> String {
    // Rust prints 1.0 as "1", like JavaScript; -0 is "0" there.
    if n == 0.0 {
        "0".into()
    } else {
        n.to_string()
    }
}

fn json_js_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.as_f64().map(js_number_string).unwrap_or_default(),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => "null".into(),
        other => other.to_string(),
    }
}

/// The first entry of a signal that `v` matches: by range when the entry has
/// `value_min` or `value_max` (half-open, `min <= v < max`), otherwise by
/// exact value compared as text. Same rule as `matchTextListEntry`.
pub fn signal_entry(entries: &[SignalEntry], v: Scalar<'_>) -> Option<usize> {
    let num = v.js_number();
    let text = v.js_string();
    entries.iter().position(|e| {
        if e.value_min.is_some() || e.value_max.is_some() {
            let Some(n) = num else { return false };
            e.value_min.is_none_or(|m| n >= m) && e.value_max.is_none_or(|m| n < m)
        } else {
            e.value.as_ref().is_some_and(|x| json_js_string(x) == text)
        }
    })
}

/// The values of the live parts from the bindings of the object
/// (`symbol_parts`: `{tag?, value?, min?, max?}` per part id). A tag wins; a
/// tag with no value yet is "as drawn"; without a tag, the fixed `value`.
///
/// A rotor or a level that is not bound is **left out**: it follows the
/// settings of the whole symbol (Rotazione, Livello), as before.
pub fn valori_parti<'a>(
    parti: &[ParteLib],
    legami: Option<&'a serde_json::Value>,
    valore: impl Fn(&str) -> Option<&'a TagValue>,
) -> Vec<(String, ValoreParte)> {
    let mut out = Vec::new();
    for p in parti {
        let l = legami.and_then(|m| m.get(p.id()));
        let tag = l
            .and_then(|l| l.get("tag"))
            .and_then(|t| t.as_str())
            .filter(|t| !t.is_empty());
        let fixed = l.and_then(|l| l.get("value")).and_then(Scalar::of_json);
        let bound = tag.is_some() || fixed.is_some();
        let v: Option<Scalar> = match tag {
            Some(t) => valore(t).map(Scalar::of_tag),
            None => fixed,
        };
        let num = |k: &str, d: f64| {
            l.and_then(|l| l.get(k))
                .and_then(|x| x.as_f64())
                .unwrap_or(d)
        };
        let fraction = |min: f64, max: f64| {
            v.and_then(Scalar::number)
                .filter(|_| max != min)
                .map(|n| ((n - min) / (max - min)).clamp(0.0, 1.0))
        };
        let valore = match p {
            ParteLib::Needle { .. } => {
                ValoreParte::Frazione(fraction(num("min", 0.0), num("max", 100.0)))
            }
            ParteLib::Lever { .. } => {
                // Due posizioni: la regola booleana di sempre. Più di due: il
                // valore **è** l'indice, arrotondato e tenuto dentro l'elenco.
                let angoli = p.angoli_leva();
                if angoli.len() >= 3 {
                    let i = v
                        .and_then(Scalar::number)
                        .map(|n| n.round().clamp(0.0, (angoli.len() - 1) as f64) as usize);
                    ValoreParte::Posizione(i)
                } else {
                    ValoreParte::Aperta(v.map(Scalar::truthy))
                }
            }
            ParteLib::Lamp { .. } => ValoreParte::Accesa(v.map(Scalar::truthy)),
            ParteLib::Rotor { .. } if bound => ValoreParte::Active(v.map(Scalar::truthy)),
            ParteLib::Level { .. } if bound => {
                ValoreParte::Frazione(fraction(num("min", 0.0), num("max", 100.0)))
            }
            ParteLib::Slide { .. } => {
                ValoreParte::Frazione(fraction(num("min", 0.0), num("max", 1.0)))
            }
            ParteLib::Vibrate { .. }
            | ParteLib::Pulse { .. }
            | ParteLib::Glow { .. }
            | ParteLib::Bubbles { .. } => {
                ValoreParte::Active(v.map(Scalar::truthy))
            }
            ParteLib::Signal { entries, .. } => {
                ValoreParte::Entry(v.and_then(|v| signal_entry(entries, v)))
            }
            _ => continue,
        };
        out.push((p.id().to_string(), valore));
    }
    out
}

// ── the timed ones ───────────────────────────────────────────────────────────
//
// Every timed effect reads the shared clock (`ms`), so pieces that move at the
// same rate stay in phase, like the blink of the objects (`effects.rs`).

/// The shortest period of a vibration: at 20 frames a second a step lasts at
/// least one frame.
pub const MIN_VIBRATE_MS: f64 = 200.0;
/// The shortest period of a pulse and of a blink.
pub const MIN_PERIOD_MS: f64 = 200.0;

/// The step of a vibration: 0, +1, 0, −1, a quarter of the period each.
pub fn vibrate_step(ms: u64, period_ms: f64) -> i8 {
    let p = period_ms.max(MIN_VIBRATE_MS) as u64;
    match (ms % p) * 4 / p {
        1 => 1,
        3 => -1,
        _ => 0,
    }
}

/// The opacity of a pulse: 1 at the start and the end of the period, `1 −
/// depth` in the middle, along a cosine (the curve of `fattore_respiro`).
pub fn pulse_opacity(ms: u64, period_ms: f64, depth: f64) -> f64 {
    let p = period_ms.max(MIN_PERIOD_MS) as u64;
    let t = (ms % p) as f64 / p as f64;
    let s = (1.0 - (2.0 * std::f64::consts::PI * t).cos()) / 2.0;
    1.0 - depth.clamp(0.0, 1.0) * s
}

/// Whether a blinking piece is dim now: the first half of the period, as the
/// blink of the states (`lampeggio_voce`) and `sws-obj-blink` with
/// `step-start` on the web.
pub fn blink_dim(ms: u64, period_ms: f64) -> bool {
    let p = period_ms.max(50.0) as u64;
    ms % p < p / 2
}

/// The window of a level at fraction `f`, in the units of the symbol: the
/// part of `[x, y, w, h]` the content fills, growing from `dir`'s side.
pub fn level_window(dir: FillDir, [x, y, w, h]: [f64; 4], f: f64) -> [f64; 4] {
    let f = f.clamp(0.0, 1.0);
    match dir {
        FillDir::Up => [x, y + h * (1.0 - f), w, h * f],
        FillDir::Down => [x, y, w, h * f],
        FillDir::Right => [x, y, w * f, h],
        FillDir::Left => [x + w * (1.0 - f), y, w * f, h],
    }
}

/// Where a slide is at fraction `f`.
pub fn slide_offset(f: f64, dx: f64, dy: f64) -> (f64, f64) {
    let f = f.clamp(0.0, 1.0);
    (dx * f, dy * f)
}

/// A linear move from `from` to `to`, started at `t0`, lasting `ms`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transition {
    pub from: f64,
    pub to: f64,
    pub t0: u64,
    pub ms: f64,
}

impl Transition {
    pub fn at(&self, now: u64) -> f64 {
        if self.ms <= 0.0 {
            return self.to;
        }
        let k = (now.saturating_sub(self.t0) as f64 / self.ms).clamp(0.0, 1.0);
        self.from + (self.to - self.from) * k
    }
}

/// The period a rotor turns with on a panel drawing `fps` frames a second.
///
/// A drawing that repeats every `symmetry` degrees, turned by half of that or
/// more in a frame, looks still or turning backwards. The step per frame is
/// kept under 0.45 × symmetry by turning slower: the web keeps the true speed,
/// the panel can't show it.
pub fn rotor_period_for_fps(period_s: f64, symmetry: f64, fps: f64) -> f64 {
    // Written so that a NaN, which compares false, keeps the period.
    let usable = symmetry > 0.0 && fps > 0.0;
    if !usable {
        return period_s;
    }
    let slowest = 360.0 / (0.45 * symmetry * fps);
    period_s.max(slowest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::Value;

    #[derive(Deserialize)]
    struct Fixture {
        parts: Vec<ParteLib>,
        values: Vec<ValuesCase>,
        signal: Vec<SignalCase>,
        time: Time,
    }
    #[derive(Deserialize)]
    struct ValuesCase {
        name: String,
        bindings: Value,
        tags: serde_json::Map<String, Value>,
        expected: serde_json::Map<String, Value>,
    }
    #[derive(Deserialize)]
    struct SignalCase {
        name: String,
        entries: Vec<SignalEntry>,
        value: Value,
        expected: Option<usize>,
    }
    #[derive(Deserialize)]
    struct Time {
        vibrate: Vec<(u64, f64, i8)>,
        pulse: Vec<(u64, f64, f64, f64)>,
        blink: Vec<(u64, f64, bool)>,
        level_window: Vec<(FillDir, [f64; 4], f64, [f64; 4])>,
        rotor_period: Vec<(f64, f64, f64, f64)>,
        transition: Vec<(f64, f64, u64, f64, u64, f64)>,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!(
            "../../../../tests/fixtures/symbol-pieces.json"
        ))
        .unwrap()
    }

    fn tag_of(v: &Value) -> TagValue {
        match v {
            Value::Bool(b) => TagValue::Bool(*b),
            Value::Number(n) if n.is_i64() => TagValue::Int(n.as_i64().unwrap()),
            Value::Number(n) => TagValue::Float(n.as_f64().unwrap()),
            Value::String(s) => TagValue::Str(s.clone()),
            other => panic!("unexpected tag value {other}"),
        }
    }

    /// Every number as a float: `1` in the fixture is `1.0` here.
    fn floats(v: &Value) -> Value {
        match v {
            Value::Number(n) => serde_json::json!(n.as_f64()),
            Value::Object(m) => {
                Value::Object(m.iter().map(|(k, v)| (k.clone(), floats(v))).collect())
            }
            other => other.clone(),
        }
    }

    fn as_json(v: ValoreParte) -> Value {
        use serde_json::json;
        match v {
            ValoreParte::Frazione(f) => json!({ "frazione": f }),
            ValoreParte::Aperta(a) => json!({ "aperta": a }),
            ValoreParte::Posizione(i) => json!({ "posizione": i }),
            ValoreParte::Accesa(a) => json!({ "accesa": a }),
            ValoreParte::Active(a) => json!({ "active": a }),
            ValoreParte::Entry(i) => json!({ "entry": i }),
        }
    }

    #[test]
    fn the_values_of_the_shared_cases() {
        let f = fixture();
        for c in &f.values {
            let tags: Vec<(String, TagValue)> =
                c.tags.iter().map(|(k, v)| (k.clone(), tag_of(v))).collect();
            let got = valori_parti(&f.parts, Some(&c.bindings), |t| {
                tags.iter().find(|(k, _)| k == t).map(|(_, v)| v)
            });
            for (id, want) in &c.expected {
                let have = got.iter().find(|(k, _)| k == id).map(|(_, v)| as_json(*v));
                // `null` = left out: the part follows the symbol.
                let have = have.unwrap_or(Value::Null);
                assert_eq!(floats(&have), floats(want), "{} — {id}", c.name);
            }
        }
    }

    #[test]
    fn the_signal_entries_of_the_shared_cases() {
        for c in fixture().signal {
            let v = Scalar::of_json(&c.value).unwrap_or(Scalar::Other);
            assert_eq!(signal_entry(&c.entries, v), c.expected, "{}", c.name);
        }
    }

    #[test]
    fn the_timed_effects_of_the_shared_cases() {
        let t = fixture().time;
        for (ms, p, want) in t.vibrate {
            assert_eq!(vibrate_step(ms, p), want, "vibrate {ms} {p}");
        }
        for (ms, p, d, want) in t.pulse {
            assert!(
                (pulse_opacity(ms, p, d) - want).abs() < 1e-3,
                "pulse {ms} {p} {d}"
            );
        }
        for (ms, p, want) in t.blink {
            assert_eq!(blink_dim(ms, p), want, "blink {ms} {p}");
        }
        for (dir, r, f, want) in t.level_window {
            let w = level_window(dir, r, f);
            for i in 0..4 {
                assert!((w[i] - want[i]).abs() < 1e-9, "level {dir:?} {f}: {w:?}");
            }
        }
        for (p, s, fps, want) in t.rotor_period {
            assert!(
                (rotor_period_for_fps(p, s, fps) - want).abs() < 1e-3,
                "rotor {p} {s} {fps}"
            );
        }
        for (from, to, t0, ms, now, want) in t.transition {
            let tr = Transition { from, to, t0, ms };
            assert!((tr.at(now) - want).abs() < 1e-9, "transition {now}");
        }
    }
}
