//! A symbol drawn as free SVG, with ports for the pipes (plan
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G3).
//!
//! The normal way to draw a symbol is a description that SWS compiles
//! (`simboli_prj.rs`). What the description cannot say stays an SVG written by
//! hand, or by the assistant: a `custom:` symbol ([`crate::CustomSymbol`]) with
//! two optional fields, `view_box` and `ports`, so a pipe attaches to it as to
//! a library symbol.
//!
//! An SVG that comes from outside is checked here before it is kept:
//!
//! - **size**: 32 KB, 400 elements, a drawing of at most 510 units per side;
//! - **elements**: only the ones both engines draw the same way. The browser
//!   drops what its sanitizer does not know (`symbols/customSvg.ts`) and the
//!   panel has no fonts and no filters: the list is what the two have in
//!   common, less the elements `scripts/simboli/genera.py` forbids in the
//!   library (`<text>`, `<style>`, `<image>`, `<filter>`, `animate*`…);
//! - **references**: `href` and `url(…)` only to an id of the same drawing;
//! - **root**: only `xmlns` and `viewBox`, and the `viewBox` is the declared
//!   one. The browser keeps the content of the root and not its attributes,
//!   the panel keeps both: a `fill` on the root would colour one and not the
//!   other;
//! - **ports**: inside the drawing, on a known side, with ids that are not
//!   the five anchors of the box.
//!
//! These are the rules of a drawing that enters **through the assistant**
//! ([`check`]). A custom symbol written by hand in `project.yaml` is held only
//! to what makes a port impossible to place ([`check_ports`]): the validator
//! and the `PUT` of the custom symbols use that one, and agree.
//!
//! What comes out is the same drawing written again in one form: one element
//! per line, double quotes, ids prefixed with the id of the symbol (two
//! symbols with a gradient called `g1` would otherwise share the first one
//! found in the page).
//!
//! Not here: scripts and event handlers. `svg_ostile` in `sws-web` refuses
//! them for every custom symbol, and stays the one place that does.

use crate::simboli_lib::PortaLib;

/// The largest SVG text kept, as for a symbol description.
pub const MAX_SVG_BYTES: usize = 32 * 1024;
/// The largest side of the drawing: the limit of the library
/// (`simboli_prj::MAX_LATO`, 512) on the grid of 10.
pub const MAX_SIDE: f64 = 510.0;
pub const MAX_ELEMENTS: usize = 400;
pub const MAX_DEPTH: usize = 16;
pub const MAX_PORTS: usize = 12;

/// The elements a free symbol can contain: shapes, groups, gradients, clips.
pub const ALLOWED_ELEMENTS: &[&str] = &[
    "g",
    "defs",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "use",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
];

/// The elements that draw something.
const SHAPES: &[&str] = &[
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use",
];

const SIDES: &[&str] = &["left", "top", "right", "bottom"];
/// The anchors every object has on its box: a port cannot take their name, a
/// pipe end called `left` would not say which of the two it means.
const BOX_ANCHORS: &[&str] = &["top", "bottom", "left", "right", "center"];

/// Why an element is refused, when there is something more useful to say than
/// «not in the list».
fn why_forbidden(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if matches!(lower.as_str(), "text" | "tspan" | "textpath") {
        return Some("the panel has no fonts: labels and values are objects of the page");
    }
    if lower == "style" {
        return Some("write the presentation attributes on the elements");
    }
    if lower == "image" {
        return Some("a symbol is a vector drawing");
    }
    if lower == "filter" || (name.starts_with("fe") && name.len() > 2) {
        return Some("the panel draws no filters: use gradients");
    }
    if lower.starts_with("animate") || lower == "set" {
        return Some("a free symbol has no live parts: what moves is drawn with a description");
    }
    if matches!(
        lower.as_str(),
        "script" | "foreignobject" | "iframe" | "embed" | "object"
    ) {
        return Some("a symbol is only a drawing");
    }
    if lower == "svg" {
        return Some("one <svg> only, the root");
    }
    None
}

/// A name of a port or of an id: lowercase letters, digits and `-`.
fn slug_like(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

fn number(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

/// The size of the drawing: whole numbers, multiples of 10, like the library
/// (the axis of a port falls on the grid of the pipes).
pub fn check_view_box(view_box: [f64; 2]) -> Vec<String> {
    let mut errors = Vec::new();
    for (name, v) in [("width", view_box[0]), ("height", view_box[1])] {
        if !v.is_finite() || !(10.0..=MAX_SIDE).contains(&v) || v % 10.0 != 0.0 {
            errors.push(format!(
                "view_box: the {name} is {}, it must be a multiple of 10 from 10 to {MAX_SIDE}",
                number(v)
            ));
        }
    }
    errors
}

/// The ports of **any** custom symbol with a drawing of `view_box` units,
/// also one written by hand in `project.yaml`: only what makes a port
/// impossible to place. It is the rule of the validator and of the `PUT` of
/// the custom symbols, which must not refuse what both engines draw — a
/// drawing of 64 × 64 is fine, the grid of 10 is a rule of the assistant's
/// way ([`check_drawn_ports`]).
pub fn check_ports(view_box: [f64; 2], ports: &[PortaLib]) -> Vec<String> {
    ports_errors(view_box, ports, false)
}

/// The ports of a symbol the assistant draws: [`check_ports`], and the rules
/// that keep its drawings like the library — at most [`MAX_PORTS`], ids
/// written as slugs that are not the five anchors of the box, a diameter
/// that fits the drawing.
pub fn check_drawn_ports(view_box: [f64; 2], ports: &[PortaLib]) -> Vec<String> {
    ports_errors(view_box, ports, true)
}

fn ports_errors(view_box: [f64; 2], ports: &[PortaLib], drawn: bool) -> Vec<String> {
    let mut errors = Vec::new();
    let [w, h] = view_box;
    if drawn && ports.len() > MAX_PORTS {
        errors.push(format!("{} ports: at most {MAX_PORTS}", ports.len()));
    }
    let mut seen: Vec<&str> = Vec::new();
    for p in ports {
        let id = p.id.as_str();
        if id.trim().is_empty() {
            errors.push("a port has no id".to_string());
        } else if drawn && !slug_like(id, 2, 30) {
            errors.push(format!(
                "port «{id}»: the id is a-z, 0-9 and «-», from 2 to 30 characters"
            ));
        } else if drawn && BOX_ANCHORS.contains(&id) {
            errors.push(format!(
                "port «{id}»: {} are the anchors of the box, call it n-{id}",
                BOX_ANCHORS.join(", ")
            ));
        }
        if seen.contains(&id) {
            errors.push(format!("two ports with the id «{id}»"));
        }
        seen.push(id);
        if !SIDES.contains(&p.side.as_str()) {
            errors.push(format!(
                "port «{id}»: side «{}» unknown (they are {})",
                p.side,
                SIDES.join(", ")
            ));
        }
        if !(p.x.is_finite()
            && p.y.is_finite()
            && (0.0..=w).contains(&p.x)
            && (0.0..=h).contains(&p.y))
        {
            errors.push(format!(
                "port «{id}» is outside the drawing ({}, {}): the drawing is {} × {}",
                number(p.x),
                number(p.y),
                number(w),
                number(h)
            ));
        }
        if !p.d.is_finite() || p.d <= 0.0 {
            errors.push(format!(
                "port «{id}»: the diameter is {}, it must be more than 0",
                number(p.d)
            ));
        } else if drawn && p.d > w.min(h) {
            errors.push(format!(
                "port «{id}»: the diameter is {}, it goes from 1 to {}",
                number(p.d),
                number(w.min(h))
            ));
        }
    }
    errors
}

/// The name of an attribute as XML wants it, in ASCII: a letter or `_`, then
/// letters, digits, `_`, `.`, `:` and `-`.
fn xml_name(s: &str) -> bool {
    let mut chars = s.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'))
}

/// The next `url(` of a value: where it starts and where its argument
/// starts. A CSS function name has no case, and the browser's sanitizer
/// looks for it with white space before the parenthesis too
/// (`symbols/customSvg.ts`): the same here, or the two would disagree.
fn find_url(value: &str) -> Option<(usize, usize)> {
    // ASCII lowercase keeps every byte where it was.
    let lower = value.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find("url") {
        let start = from + i;
        let after = start + 3;
        let open = after + (lower[after..].len() - lower[after..].trim_start().len());
        if lower[open..].starts_with('(') {
            return Some((start, open + 1));
        }
        from = after;
    }
    None
}

/// One start tag: its name, its attributes in order, and whether it closes
/// itself.
struct Tag {
    name: String,
    attributes: Vec<(String, String)>,
    empty: bool,
}

/// Reads a start tag from `text` (which begins after the `<`). Returns the
/// tag and how many bytes it took, `>` included.
fn read_tag(text: &str) -> Result<(Tag, usize), String> {
    let bytes = text.as_bytes();
    let mut i = 0;
    let name_end = bytes
        .iter()
        .position(|b| b.is_ascii_whitespace() || *b == b'>' || *b == b'/')
        .ok_or("a tag is not closed")?;
    let name = text[..name_end].to_string();
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '-' || c == '_')
    {
        return Err(format!("«<{name}» is not the start of an element"));
    }
    i += name_end;
    let mut attributes = Vec::new();
    loop {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        match bytes.get(i) {
            None => return Err(format!("<{name}> is not closed")),
            Some(b'>') => {
                return Ok((
                    Tag {
                        name,
                        attributes,
                        empty: false,
                    },
                    i + 1,
                ))
            }
            Some(b'/') => {
                if bytes.get(i + 1) != Some(&b'>') {
                    return Err(format!("<{name}>: «/» without «>»"));
                }
                return Ok((
                    Tag {
                        name,
                        attributes,
                        empty: true,
                    },
                    i + 2,
                ));
            }
            Some(_) => {}
        }
        let start = i;
        while i < bytes.len()
            && !bytes[i].is_ascii_whitespace()
            && !matches!(bytes[i], b'=' | b'>' | b'/')
        {
            i += 1;
        }
        let key = text[start..i].to_string();
        // What a strict XML parser refuses is refused here: the panel reads
        // the drawing with one, the browser with a tolerant one, and a
        // drawing only the second reads is a placeholder on the panel.
        if !xml_name(&key) {
            return Err(format!("<{name}>: «{key}» is not the name of an attribute"));
        }
        if attributes.iter().any(|(k, _)| *k == key) {
            return Err(format!(
                "<{name}>: the attribute «{key}» is written twice, keep one"
            ));
        }
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if bytes.get(i) != Some(&b'=') {
            return Err(format!("<{name}>: the attribute «{key}» has no value"));
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let quote = match bytes.get(i) {
            Some(q @ (b'"' | b'\'')) => *q,
            _ => {
                return Err(format!(
                    "<{name}>: the value of «{key}» must be between quotes"
                ))
            }
        };
        i += 1;
        let end = bytes[i..]
            .iter()
            .position(|b| *b == quote)
            .ok_or_else(|| format!("<{name}>: the value of «{key}» is not closed"))?;
        let value = text[i..i + end].to_string();
        if value.contains('<') {
            return Err(format!("<{name}>: «<» inside the value of «{key}»"));
        }
        // An entity or a CSS escape writes a character without showing it:
        // `&#117;rl(…)` and `u\72l(…)` are an `url(` the checks below would
        // not see. A drawing needs neither.
        if value.contains('&') || value.contains('\\') {
            return Err(format!(
                "<{name}>: the value of «{key}» has «&» or «\\»: no entities and no escapes, \
                 write the characters themselves"
            ));
        }
        i += end + 1;
        attributes.push((key, value));
    }
}

/// Removes the comments. An SVG that leaves one open is refused.
fn without_comments(svg: &str) -> Result<String, String> {
    let mut out = String::with_capacity(svg.len());
    let mut rest = svg;
    while let Some(i) = rest.find("<!--") {
        out.push_str(&rest[..i]);
        let end = rest[i..].find("-->").ok_or("a comment is not closed")?;
        rest = &rest[i + end + 3..];
    }
    out.push_str(rest);
    Ok(out)
}

/// The value of an attribute, with its references to ids checked and
/// prefixed. `Err` says what is wrong with it.
fn scoped_value(key: &str, value: &str, prefix: &str) -> Result<String, String> {
    let scope = |id: &str| -> Result<String, String> {
        if id.is_empty()
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(format!("«{id}» is not an id (letters, digits, «-», «_»)"));
        }
        Ok(if id.starts_with(prefix) {
            id.to_string()
        } else {
            format!("{prefix}{id}")
        })
    };
    let lower = key.to_ascii_lowercase();
    if lower == "id" {
        return scope(value);
    }
    if lower == "href" || lower == "xlink:href" {
        let id = value.trim().strip_prefix('#').ok_or_else(|| {
            format!("«{value}» points outside the drawing: only «#id» of this drawing")
        })?;
        return Ok(format!("#{}", scope(id)?));
    }
    // The browser drops a whole `style` that has an `url(`, the panel reads
    // it: the reference goes in the attribute, where both read it.
    if lower == "style" && find_url(value).is_some() {
        return Err("no url() inside style: write the attribute (fill=\"url(#id)\")".to_string());
    }
    // Every `url(…)`, in any attribute (`fill`, `clip-path`, `mask`…), in
    // any case: written back as `url(#id)`, the one form both engines read.
    let mut out = String::with_capacity(value.len() + prefix.len());
    let mut rest = value;
    while let Some((start, argument)) = find_url(rest) {
        out.push_str(&rest[..start]);
        out.push_str("url(");
        let after = &rest[argument..];
        let end = after.find(')').ok_or("an «url(» is not closed")?;
        let target = after[..end].trim().trim_matches(|c| c == '\'' || c == '"');
        let id = target.strip_prefix('#').ok_or_else(|| {
            format!("«url({target})» points outside the drawing: only «url(#id)»")
        })?;
        out.push('#');
        out.push_str(&scope(id)?);
        out.push(')');
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Checks a free SVG and writes it again in the form both engines read.
///
/// `id` is the id of the symbol (the part after `custom:`): it prefixes the
/// ids of the drawing. The result is `<svg xmlns=… viewBox="0 0 w h">` with
/// one element per line. `Err` lists what to fix.
pub fn normalize(id: &str, svg: &str, view_box: [f64; 2]) -> Result<String, Vec<String>> {
    if svg.len() > MAX_SVG_BYTES {
        return Err(vec![format!(
            "the SVG is {} KB: at most {} KB, simplify the drawing",
            svg.len() / 1024,
            MAX_SVG_BYTES / 1024
        )]);
    }
    let mut errors = check_view_box(view_box);
    if !errors.is_empty() {
        return Err(errors);
    }
    let text = without_comments(svg).map_err(|e| vec![e])?;
    let mut rest = text.trim();
    // An XML prolog says nothing a symbol needs.
    if rest.starts_with("<?xml") {
        match rest.find("?>") {
            Some(i) => rest = rest[i + 2..].trim_start(),
            None => return Err(vec!["the XML prolog is not closed".into()]),
        }
    }
    if rest.contains("<!") || rest.contains("<?") {
        return Err(vec![
            "no DOCTYPE, CDATA or processing instructions: only elements".into(),
        ]);
    }
    if !rest.starts_with("<svg") {
        return Err(vec!["the drawing must start with <svg …>".into()]);
    }

    let prefix = format!("cs-{id}-");
    let [w, h] = view_box;
    let expected = format!("0 0 {} {}", number(w), number(h));
    let mut out = String::with_capacity(rest.len() + 128);
    let mut open: Vec<String> = Vec::new();
    let mut elements = 0usize;
    let mut shapes = 0usize;
    let mut root_seen = false;
    let mut root_closed = false;
    let mut uses_xlink = false;
    let mut body = String::new();

    while !rest.is_empty() {
        let Some(lt) = rest.find('<') else {
            if !rest.trim().is_empty() {
                errors.push("text after the end of the drawing".into());
            }
            break;
        };
        if !rest[..lt].trim().is_empty() {
            errors.push(format!(
                "text between the elements («{}»): a symbol has no text",
                rest[..lt].trim().chars().take(30).collect::<String>()
            ));
        }
        rest = &rest[lt + 1..];
        if root_closed {
            errors.push("something after </svg>".into());
            break;
        }
        if let Some(after) = rest.strip_prefix('/') {
            let end = match after.find('>') {
                Some(i) => i,
                None => {
                    errors.push("a closing tag is not closed".into());
                    break;
                }
            };
            let name = after[..end].trim();
            match open.pop() {
                Some(expected_name) if expected_name == name => {}
                Some(expected_name) => {
                    errors.push(format!("</{name}> closes <{expected_name}>"));
                    break;
                }
                None => {
                    errors.push(format!("</{name}> closes nothing"));
                    break;
                }
            }
            if open.is_empty() {
                root_closed = true;
            } else {
                body.push_str(&"  ".repeat(open.len()));
                body.push_str(&format!("</{name}>\n"));
            }
            rest = &after[end + 1..];
            continue;
        }
        let (tag, used) = match read_tag(rest) {
            Ok(t) => t,
            Err(e) => {
                errors.push(e);
                break;
            }
        };
        rest = &rest[used..];

        if !root_seen {
            root_seen = true;
            if tag.name != "svg" {
                errors.push("the drawing must start with <svg …>".into());
                break;
            }
            for (k, v) in &tag.attributes {
                match k.as_str() {
                    "xmlns" | "xmlns:xlink" | "version" => {}
                    "viewBox" => {
                        let given: Vec<f64> = v
                            .split(|c: char| c.is_whitespace() || c == ',')
                            .filter(|s| !s.is_empty())
                            .filter_map(|s| s.parse().ok())
                            .collect();
                        if given != [0.0, 0.0, w, h] {
                            errors.push(format!(
                                "the viewBox of the SVG is «{v}» and view_box says «{expected}»: they must be the same"
                            ));
                        }
                    }
                    other => errors.push(format!(
                        "<svg> has the attribute «{other}»: the root takes only xmlns and viewBox \
                         (the browser would not read it, the panel would). Put it on a <g> inside"
                    )),
                }
            }
            if tag.empty {
                root_closed = true;
            } else {
                open.push(tag.name);
            }
            continue;
        }

        elements += 1;
        if elements > MAX_ELEMENTS {
            errors.push(format!(
                "more than {MAX_ELEMENTS} elements: simplify the drawing"
            ));
            break;
        }
        if open.len() > MAX_DEPTH {
            errors.push(format!("elements nested more than {MAX_DEPTH} deep"));
            break;
        }
        if !ALLOWED_ELEMENTS.contains(&tag.name.as_str()) {
            errors.push(match why_forbidden(&tag.name) {
                Some(why) => format!("<{}> is not allowed: {why}", tag.name),
                None => format!(
                    "<{}> is not allowed. A free symbol is made of: {}",
                    tag.name,
                    ALLOWED_ELEMENTS.join(", ")
                ),
            });
        }
        if SHAPES.contains(&tag.name.as_str()) {
            shapes += 1;
        }
        body.push_str(&"  ".repeat(open.len()));
        body.push('<');
        body.push_str(&tag.name);
        for (k, v) in &tag.attributes {
            let lower = k.to_ascii_lowercase();
            if lower.starts_with("on") {
                errors.push(format!(
                    "<{}>: «{k}» is an event handler, a symbol is only a drawing",
                    tag.name
                ));
                continue;
            }
            if v.to_ascii_lowercase()
                .replace(char::is_whitespace, "")
                .contains("javascript:")
            {
                errors.push(format!("<{}>: «{k}» has a javascript: URL", tag.name));
                continue;
            }
            if lower.starts_with("xlink:") {
                uses_xlink = true;
            }
            match scoped_value(k, v, &prefix) {
                // Only a value between single quotes can have one, and no
                // attribute of a shape needs it: written out it would be an
                // entity, which this check refuses on the way in.
                Ok(value) if value.contains('"') => errors.push(format!(
                    "<{}> {k}: a double quote inside the value",
                    tag.name
                )),
                Ok(value) => {
                    body.push(' ');
                    body.push_str(k);
                    body.push_str("=\"");
                    body.push_str(&value);
                    body.push('"');
                }
                Err(e) => errors.push(format!("<{}> {k}: {e}", tag.name)),
            }
        }
        if tag.empty {
            body.push_str("/>\n");
        } else {
            body.push_str(">\n");
            open.push(tag.name);
        }
    }

    if errors.is_empty() {
        if let Some(name) = open.last() {
            errors.push(format!("<{name}> is not closed"));
        } else if !root_closed {
            errors.push("the drawing must end with </svg>".into());
        } else if shapes == 0 {
            errors.push("the drawing has no shapes: nothing would be seen".into());
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    out.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\"");
    if uses_xlink {
        out.push_str(" xmlns:xlink=\"http://www.w3.org/1999/xlink\"");
    }
    out.push_str(&format!(" viewBox=\"{expected}\">\n"));
    out.push_str(&body);
    out.push_str("</svg>\n");
    Ok(out)
}

/// The whole check of a free symbol with ports: the drawing written again, or
/// everything there is to fix, drawing and ports together.
pub fn check(
    id: &str,
    svg: &str,
    view_box: [f64; 2],
    ports: &[PortaLib],
) -> Result<String, Vec<String>> {
    let mut errors = Vec::new();
    if !slug_like(id, 3, 40) {
        errors.push(format!(
            "slug «{id}»: a-z, 0-9 and «-», from 3 to 40 characters"
        ));
    }
    let drawing = match normalize(id, svg, view_box) {
        Ok(d) => Some(d),
        Err(e) => {
            errors.extend(e);
            None
        }
    };
    if check_view_box(view_box).is_empty() {
        errors.extend(check_drawn_ports(view_box, ports));
    }
    match drawing {
        Some(d) if errors.is_empty() => Ok(d),
        _ => Err(errors),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(id: &str, x: f64, y: f64, side: &str) -> PortaLib {
        PortaLib {
            id: id.into(),
            x,
            y,
            side: side.into(),
            d: 10.0,
        }
    }

    const CYCLONE: &str = r##"<?xml version="1.0"?>
<!-- a cyclone separator -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 120">
  <defs>
    <linearGradient id='body' x1="0" x2="1">
      <stop offset="0" stop-color="#94a3b8"/>
      <stop offset="1" stop-color="#475569"/>
    </linearGradient>
  </defs>
  <g stroke="#1c2329" stroke-width="1">
    <rect x="0" y="15" width="12" height="10" fill="#64748b"/>
    <path d="M12 10 H68 V60 L46 110 H34 L12 60 Z" fill="url(#body)"/>
    <rect x="35" y="110" width="10" height="10" fill="#64748b"/>
  </g>
</svg>"##;

    #[test]
    fn a_plain_drawing_passes_and_is_written_in_one_form() {
        let ports = [
            port("n-left", 0.0, 20.0, "left"),
            port("n-bottom", 40.0, 120.0, "bottom"),
        ];
        let out = check("cyclone", CYCLONE, [80.0, 120.0], &ports).expect("it is a plain drawing");
        assert!(
            out.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 80 120\">\n")
        );
        assert!(out.ends_with("</svg>\n"));
        // Prolog and comment are gone, quotes are double, ids carry the symbol.
        assert!(!out.contains("<?xml") && !out.contains("<!--"));
        assert!(out.contains("<linearGradient id=\"cs-cyclone-body\" x1=\"0\" x2=\"1\">"));
        assert!(out.contains("fill=\"url(#cs-cyclone-body)\""));
        assert_eq!(out.matches("<rect ").count(), 2);
        // Written again, it is the same: the check can run on its own output.
        assert_eq!(check("cyclone", &out, [80.0, 120.0], &ports).unwrap(), out);
    }

    #[test]
    fn the_root_takes_only_xmlns_and_the_declared_view_box() {
        let svg = |root: &str| format!("<svg {root}><rect width=\"10\" height=\"10\"/></svg>");
        let errors = |root: &str| normalize("abc", &svg(root), [40.0, 40.0]).unwrap_err();
        assert!(errors("viewBox=\"0 0 100 100\"")[0].contains("view_box says «0 0 40 40»"));
        assert!(errors("viewBox=\"0 0 40 40\" fill=\"none\"")[0].contains("«fill»"));
        assert!(errors("width=\"40\" height=\"40\"")
            .iter()
            .any(|e| e.contains("«width»")));
        // Without a viewBox the declared one is written.
        let out = normalize("abc", &svg(""), [40.0, 40.0]).unwrap();
        assert!(out.contains("viewBox=\"0 0 40 40\""));
    }

    #[test]
    fn what_the_engines_do_not_draw_the_same_way_is_refused() {
        let with = |inner: &str| {
            normalize(
                "abc",
                &format!(
                    "<svg viewBox=\"0 0 40 40\"><rect width=\"4\" height=\"4\"/>{inner}</svg>"
                ),
                [40.0, 40.0],
            )
        };
        for (inner, word) in [
            ("<text x=\"1\" y=\"9\">P1</text>", "no fonts"),
            ("<style>.a{fill:red}</style>", "<style>"),
            ("<image href=\"#a\"/>", "<image>"),
            (
                "<filter id=\"f\"><feGaussianBlur stdDeviation=\"2\"/></filter>",
                "<filter>",
            ),
            (
                "<animateTransform attributeName=\"transform\"/>",
                "live parts",
            ),
            ("<script>alert(1)</script>", "<script>"),
            ("<foreignObject/>", "<foreignObject>"),
            ("<svg/>", "one <svg> only"),
            ("<marker id=\"m\"/>", "<marker> is not allowed"),
            (
                "<rect onclick=\"x()\" width=\"1\" height=\"1\"/>",
                "event handler",
            ),
            (
                "<use href=\"http://example.com/a.svg#x\"/>",
                "outside the drawing",
            ),
            (
                "<rect fill=\"url(http://example.com/g)\" width=\"1\" height=\"1\"/>",
                "outside the drawing",
            ),
            ("<use xlink:href=\"javascript:alert(1)\"/>", "javascript:"),
            (
                "<rect style=\"fill:url(#g)\" width=\"1\" height=\"1\"/>",
                "inside style",
            ),
            // A CSS function name has no case: `URL(` is an `url(`.
            (
                "<rect fill=\"URL(http://example.com/x.svg#g)\" width=\"1\" height=\"1\"/>",
                "outside the drawing",
            ),
            (
                "<rect style=\"fill:URL(http://example.com/x.svg#g)\" width=\"1\" height=\"1\"/>",
                "inside style",
            ),
            (
                "<rect style=\"fill:url (#g)\" width=\"1\" height=\"1\"/>",
                "inside style",
            ),
            // Entities and escapes would hide it from the check.
            (
                "<rect fill=\"&#117;rl(http://example.com/g)\" width=\"1\" height=\"1\"/>",
                "no entities",
            ),
            (
                "<rect fill=\"u\\72l(http://example.com/g)\" width=\"1\" height=\"1\"/>",
                "no escapes",
            ),
            (
                "<rect fill=\"&undefined;\" width=\"1\" height=\"1\"/>",
                "no entities",
            ),
            // What a strict XML parser refuses: the panel has one.
            (
                "<rect width=\"10\" width=\"20\" height=\"1\"/>",
                "«width» is written twice",
            ),
            (
                "<rect =\"1\" width=\"1\" height=\"1\"/>",
                "not the name of an attribute",
            ),
            (
                "<rect a\"b=\"1\" width=\"1\" height=\"1\"/>",
                "not the name of an attribute",
            ),
            (
                "<rect data-a='say \"hi\"' width=\"1\" height=\"1\"/>",
                "double quote",
            ),
            ("<g><rect width=\"1\" height=\"1\"/>", "</svg> closes <g>"),
            ("</g>", "closes"),
            ("<!DOCTYPE svg>", "DOCTYPE"),
        ] {
            let e = with(inner).expect_err(inner).join(" | ");
            assert!(e.contains(word), "{inner}: {e}");
        }
        assert!(with("<circle cx=\"5\" cy=\"5\" r=\"2\"/>").is_ok());
    }

    #[test]
    fn an_url_in_any_case_is_scoped_and_written_in_one_form() {
        let svg = "<svg viewBox=\"0 0 40 40\"><defs><linearGradient id=\"g\">\
                   <stop offset=\"0\" stop-color=\"#fff\"/></linearGradient>\
                   <clipPath id=\"c\"><rect width=\"40\" height=\"20\"/></clipPath></defs>\
                   <rect width=\"40\" height=\"40\" fill=\"URL( '#g' )\" clip-path=\"Url (#c)\"/></svg>";
        let out = normalize("abc", svg, [40.0, 40.0]).unwrap();
        assert!(out.contains("fill=\"url(#cs-abc-g)\""), "{out}");
        assert!(out.contains("clip-path=\"url(#cs-abc-c)\""), "{out}");
        assert!(!out.contains("URL") && !out.contains("Url"));
        assert_eq!(normalize("abc", &out, [40.0, 40.0]).unwrap(), out);
    }

    /// What the check writes, a strict XML parser reads: it is the parser the
    /// panel rasterizes custom symbols with (resvg), and the one behind an
    /// `<img>` with an SVG in it (the thumbnail in chat).
    #[test]
    fn what_passes_is_well_formed_xml() {
        let ports = [port("n-left", 0.0, 20.0, "left")];
        let out = check("cyclone", CYCLONE, [80.0, 120.0], &ports).unwrap();
        let doc = roxmltree::Document::parse(&out).expect("well-formed");
        assert_eq!(doc.root_element().tag_name().name(), "svg");
        assert_eq!(
            doc.descendants()
                .filter(|n| n.tag_name().name() == "rect")
                .count(),
            2
        );
        // Single quotes, xlink, a value with `>` in it: still one form.
        let odd = "<svg xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 40 40'>\
                   <defs><rect id='r' width='4' height='4'/></defs>\
                   <use xlink:href='#r' data-note='a > b'/></svg>";
        let out = normalize("abc", odd, [40.0, 40.0]).unwrap();
        let doc = roxmltree::Document::parse(&out).expect("well-formed");
        let used = doc
            .descendants()
            .find(|n| n.tag_name().name() == "use")
            .unwrap();
        assert_eq!(
            used.attribute(("http://www.w3.org/1999/xlink", "href")),
            Some("#cs-abc-r")
        );
    }

    #[test]
    fn size_and_emptiness_have_limits() {
        let big = format!(
            "<svg viewBox=\"0 0 40 40\"><path d=\"{}\"/></svg>",
            "M0 0 ".repeat(8000)
        );
        assert!(normalize("abc", &big, [40.0, 40.0]).unwrap_err()[0].contains("KB"));
        let many = format!(
            "<svg viewBox=\"0 0 40 40\">{}</svg>",
            "<rect width=\"1\" height=\"1\"/>".repeat(MAX_ELEMENTS + 1)
        );
        assert!(normalize("abc", &many, [40.0, 40.0])
            .unwrap_err()
            .iter()
            .any(|e| e.contains("elements")));
        let empty = "<svg viewBox=\"0 0 40 40\"><g></g></svg>";
        assert!(normalize("abc", empty, [40.0, 40.0]).unwrap_err()[0].contains("no shapes"));
        for bad in [
            [45.0, 40.0],
            [0.0, 40.0],
            [40.0, 520.0],
            [512.0, 40.0],
            [f64::NAN, 40.0],
        ] {
            assert!(!check_view_box(bad).is_empty(), "{bad:?}");
        }
        assert!(check_view_box([510.0, 10.0]).is_empty());
    }

    #[test]
    fn the_ports_are_inside_the_drawing_and_have_their_own_names() {
        let vb = [80.0, 120.0];
        assert!(check_drawn_ports(vb, &[port("n-left", 0.0, 20.0, "left")]).is_empty());
        let errors = |p: PortaLib| check_drawn_ports(vb, &[p]).join(" | ");
        assert!(errors(port("left", 0.0, 20.0, "left")).contains("anchors of the box"));
        assert!(errors(port("N Left", 0.0, 20.0, "left")).contains("a-z"));
        assert!(errors(port("n-left", 0.0, 20.0, "west")).contains("side «west»"));
        assert!(errors(port("n-left", -4.0, 20.0, "left")).contains("outside the drawing"));
        assert!(errors(port("n-left", 0.0, 130.0, "left")).contains("outside the drawing"));
        let mut wide = port("n-left", 0.0, 20.0, "left");
        wide.d = 200.0;
        assert!(errors(wide).contains("diameter"));
        let twice = [
            port("n-a", 0.0, 20.0, "left"),
            port("n-a", 80.0, 20.0, "right"),
        ];
        assert!(check_drawn_ports(vb, &twice)
            .join(" ")
            .contains("two ports"));
        // Drawing and ports are judged together: one answer, everything to fix.
        let all = check("cyclone", "<svg><text>x</text></svg>", vb, &twice).unwrap_err();
        assert!(all.iter().any(|e| e.contains("<text>")));
        assert!(all.iter().any(|e| e.contains("two ports")));
    }

    /// A symbol written by hand is held only to what makes a port
    /// impossible to place: the engines draw the rest, and the `PUT` of the
    /// custom symbols must not refuse a project that opens and works.
    #[test]
    fn a_hand_written_symbol_is_held_only_to_what_cannot_be_placed() {
        // An imported drawing of 64 × 64: not on the grid of 10.
        let vb = [64.0, 64.0];
        let mut wide = port("In 1", 0.0, 32.0, "left");
        wide.d = 100.0;
        let by_hand = [wide, port("left", 64.0, 32.0, "right")];
        assert_eq!(check_ports(vb, &by_hand), Vec::<String>::new());
        assert!(!check_drawn_ports(vb, &by_hand).is_empty());
        let many: Vec<PortaLib> = (0..MAX_PORTS + 1)
            .map(|i| port(&format!("p{i}"), 0.0, i as f64, "left"))
            .collect();
        assert!(check_ports(vb, &many).is_empty());

        let errors = |p: PortaLib| check_ports(vb, &[p]).join(" | ");
        assert!(errors(port("a", 70.0, 32.0, "right")).contains("outside the drawing"));
        assert!(errors(port("a", f64::NAN, 32.0, "right")).contains("outside the drawing"));
        assert!(errors(port("a", 0.0, 32.0, "west")).contains("side «west»"));
        assert!(errors(port(" ", 0.0, 32.0, "left")).contains("no id"));
        let mut flat = port("a", 0.0, 32.0, "left");
        flat.d = 0.0;
        assert!(errors(flat).contains("more than 0"));
        let twice = [port("a", 0.0, 2.0, "left"), port("a", 0.0, 9.0, "left")];
        assert!(check_ports(vb, &twice).join(" ").contains("two ports"));
    }

    /// `project.yaml` stays compatible: a symbol saved before the two fields
    /// existed reads as it did and is written back without them.
    #[test]
    fn the_two_fields_are_optional_in_the_project_file() {
        let old = "id: valve\nlabel: Valve\nurl: ''\nattribution: { author: a, source: s, license: l }\nsvg: <svg/>\n";
        let symbol: crate::CustomSymbol = serde_yaml::from_str(old).unwrap();
        assert!(symbol.view_box.is_none() && symbol.ports.is_none());
        assert!(symbol.ports_with_view_box().is_none());
        let written = serde_yaml::to_string(&symbol).unwrap();
        assert!(!written.contains("view_box") && !written.contains("ports"));

        let new = format!("{old}view_box: [80, 120]\nports:\n  - {{ id: n-left, x: 0, y: 20, side: left, d: 10 }}\n");
        let symbol: crate::CustomSymbol = serde_yaml::from_str(&new).unwrap();
        assert_eq!(symbol.symbol_id(), "custom:valve");
        let (view_box, ports) = symbol.ports_with_view_box().expect("size and ports");
        assert_eq!(view_box, [80.0, 120.0]);
        assert_eq!(ports, [port("n-left", 0.0, 20.0, "left")]);
        let back: crate::CustomSymbol =
            serde_yaml::from_str(&serde_yaml::to_string(&symbol).unwrap()).unwrap();
        assert_eq!(back.ports, symbol.ports);
        // Ports without the size of the drawing cannot be placed: ignored.
        let mut lame = symbol.clone();
        lame.view_box = None;
        assert!(lame.ports_with_view_box().is_none());
    }
}
