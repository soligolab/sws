//! The 2D drawing of a floor plan (plan
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G2).
//!
//! A floor plan (`planimetrie/<id>.yaml`, model in
//! `sws-editor/src/planimetrie/modello.ts`) is in **metres**: walls as
//! polylines with a thickness, openings (doors and windows) hooked to a wall,
//! areas on the floor. `planimetrie.rs` stores it without reading it, and the
//! IDE draws it in 3D. Here is the part the assistant needs, which has to live
//! on the server because the assistant does:
//!
//! - [`normalize`] takes what a model wrote, fills the defaults of the editor,
//!   turns an opening given as a point (`at`) into wall + fraction, and says
//!   what is wrong;
//! - [`svg`] draws it flat — walls, doors with their arc, windows, areas, no
//!   text — at the size of the area of a page, to be its background;
//! - [`layout`] says where rooms, windows and doors ended up **in page
//!   pixels**, so lights, shutters and thermostats go in the right place.
//!
//! The keys of the file stay the Italian ones the format already has (`muri`,
//! `aperture`, `aree`): only the Rust names are new.

use serde::Deserialize;
use serde_json::{json, Map, Value};

pub type Point = [f64; 2];

// The defaults of the editor (`PREDEFINITI` and `nuovaPlanimetria` in
// `modello.ts`): a plan written by the assistant must open there like one
// drawn by hand.
const WALL_THICKNESS: f64 = 0.2;
const WALL_HEIGHT: f64 = 2.7;
const DOOR_WIDTH: f64 = 0.9;
const DOOR_HEIGHT: f64 = 2.1;
const WINDOW_WIDTH: f64 = 1.2;
const WINDOW_HEIGHT: f64 = 1.2;
const WINDOW_SILL: f64 = 0.9;
const AREA_COLOR: &str = "#1e3a5f";
const EDITOR_PX_PER_M: f64 = 50.0;
const BACKGROUND_3D: &str = "#0f172a";

// Limits of a plan that comes from outside.
const MAX_WALLS: usize = 200;
const MAX_OPENINGS: usize = 200;
const MAX_AREAS: usize = 100;
const MAX_POINTS: usize = 200;
/// No coordinate farther than this from the origin, in metres.
const MAX_COORDINATE: f64 = 1000.0;
/// How far from a wall an opening given as a point may be, in metres.
const MAX_SNAP_DISTANCE: f64 = 1.0;

/// The colour of walls and door leaves when nobody chooses one: a mid slate
/// that reads on a light page and on a dark one.
pub const DEFAULT_WALL_COLOR: &str = "#475569";
const GLASS_COLOR: &str = "#7dd3fc";

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Wall {
    pub id: String,
    #[serde(rename = "punti")]
    pub points: Vec<Point>,
    #[serde(rename = "spessore")]
    pub thickness: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum OpeningKind {
    #[serde(rename = "porta")]
    Door,
    #[serde(rename = "finestra")]
    Window,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Opening {
    pub id: String,
    #[serde(rename = "muro")]
    pub wall: String,
    /// Where the centre is, from 0 to 1 along the polyline of the wall.
    pub t: f64,
    #[serde(rename = "larghezza")]
    pub width: f64,
    #[serde(rename = "tipo")]
    pub kind: OpeningKind,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Area {
    pub id: String,
    #[serde(rename = "punti")]
    pub points: Vec<Point>,
    #[serde(rename = "colore")]
    pub color: String,
    #[serde(rename = "etichetta", default)]
    pub label: Option<String>,
}

/// What the 2D drawing reads of a floor plan. Blocks, heights and the 3D
/// camera are in the file and not here: a plan seen from above does not use
/// them.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FloorPlan {
    pub id: String,
    #[serde(rename = "nome", default)]
    pub name: String,
    #[serde(rename = "muri", default)]
    pub walls: Vec<Wall>,
    #[serde(rename = "aperture", default)]
    pub openings: Vec<Opening>,
    #[serde(rename = "aree", default)]
    pub areas: Vec<Area>,
}

/// A rectangle, in pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry along a polyline (twin of `lunghezza`, `puntoA`, `proiezione` in
// `modello.ts`)
// ─────────────────────────────────────────────────────────────────────────────

fn distance(a: Point, b: Point) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

pub fn length(points: &[Point]) -> f64 {
    points.windows(2).map(|s| distance(s[0], s[1])).sum()
}

/// The point at `d` metres along the polyline, and the direction of the
/// stretch it falls in (unit vector). Outside the polyline it stops at the ends.
fn point_at_distance(points: &[Point], d: f64) -> (Point, Point) {
    match points {
        [] => ([0.0, 0.0], [1.0, 0.0]),
        [p] => (*p, [1.0, 0.0]),
        _ => {
            let mut rest = d.clamp(0.0, length(points));
            let mut last = (points[0], [1.0, 0.0]);
            for (i, s) in points.windows(2).enumerate() {
                let l = distance(s[0], s[1]);
                if l == 0.0 {
                    continue;
                }
                let dir = [(s[1][0] - s[0][0]) / l, (s[1][1] - s[0][1]) / l];
                if rest <= l || i == points.len() - 2 {
                    let f = rest.min(l);
                    return ([s[0][0] + dir[0] * f, s[0][1] + dir[1] * f], dir);
                }
                rest -= l;
                last = (s[1], dir);
            }
            last
        }
    }
}

/// The fraction `t` of the point of the polyline nearest to `p`, and how far
/// it is.
fn project(points: &[Point], p: Point) -> (f64, f64) {
    let total = length(points);
    if points.len() < 2 || total == 0.0 {
        return (
            0.0,
            points.first().map_or(f64::INFINITY, |a| distance(*a, p)),
        );
    }
    let mut best = (0.0, f64::INFINITY);
    let mut walked = 0.0;
    for s in points.windows(2) {
        let (a, b) = (s[0], s[1]);
        let l = distance(a, b);
        let f = if l == 0.0 {
            0.0
        } else {
            (((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l))
                .clamp(0.0, 1.0)
        };
        let q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        let d = distance(q, p);
        if d < best.1 {
            best = ((walked + f * l) / total, d);
        }
        walked += l;
    }
    best
}

/// The piece of the polyline between `from` and `to` metres, corners included.
fn sub_polyline(points: &[Point], from: f64, to: f64) -> Vec<Point> {
    let mut out = vec![point_at_distance(points, from).0];
    let mut walked = 0.0;
    for s in points.windows(2) {
        walked += distance(s[0], s[1]);
        if walked > from + 1e-9 && walked < to - 1e-9 {
            out.push(s[1]);
        }
    }
    out.push(point_at_distance(points, to).0);
    out
}

/// Where an opening sits on its wall, in metres along the polyline: cut at the
/// ends of the wall, like `trattiDelMuro`.
fn opening_span(wall: &Wall, o: &Opening) -> (f64, f64) {
    let l = length(&wall.points);
    let centre = o.t.clamp(0.0, 1.0) * l;
    (
        (centre - o.width / 2.0).max(0.0),
        (centre + o.width / 2.0).min(l),
    )
}

/// The stretches of a wall where the wall is: what is left between its
/// openings. Seen from above a window is a gap like a door (the 3D keeps the
/// sill; here it gets a glass line instead). Overlapping openings merge.
fn solid_stretches(wall: &Wall, openings: &[Opening]) -> Vec<(f64, f64)> {
    let l = length(&wall.points);
    let mut gaps: Vec<(f64, f64)> = openings
        .iter()
        .filter(|o| o.wall == wall.id)
        .map(|o| opening_span(wall, o))
        .filter(|(a, b)| b > a)
        .collect();
    gaps.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mut out = Vec::new();
    let mut cursor = 0.0;
    for (a, b) in gaps {
        if a > cursor {
            out.push((cursor, a));
        }
        cursor = cursor.max(b);
    }
    if cursor < l {
        out.push((cursor, l));
    }
    out
}

fn contains(polygon: &[Point], p: Point) -> bool {
    let mut inside = false;
    let n = polygon.len();
    for i in 0..n {
        let (a, b) = (polygon[i], polygon[(i + n - 1) % n]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    inside
}

/// The centroid of a polygon (by area; the mean of the points when it has no
/// area): where the label of a room goes.
fn centroid(polygon: &[Point]) -> Point {
    let n = polygon.len();
    let (mut area, mut cx, mut cy) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (a, b) = (polygon[i], polygon[(i + 1) % n]);
        let cross = a[0] * b[1] - b[0] * a[1];
        area += cross;
        cx += (a[0] + b[0]) * cross;
        cy += (a[1] + b[1]) * cross;
    }
    if area.abs() < 1e-9 {
        let k = n.max(1) as f64;
        return [
            polygon.iter().map(|p| p[0]).sum::<f64>() / k,
            polygon.iter().map(|p| p[1]).sum::<f64>() / k,
        ];
    }
    [cx / (3.0 * area), cy / (3.0 * area)]
}

// ─────────────────────────────────────────────────────────────────────────────
// What a model wrote → the model of the editor
// ─────────────────────────────────────────────────────────────────────────────

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// An id that can also be a file name in `planimetrie/` and in `images/`.
pub fn is_valid_id(id: &str) -> bool {
    (1..=40).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

fn points_of(
    v: Option<&Value>,
    at_least: usize,
    path: &str,
    errors: &mut Vec<String>,
) -> Vec<Point> {
    let Some(list) = v.and_then(Value::as_array) else {
        errors.push(format!("{path}: missing, it is a list of [x, y] in metres"));
        return Vec::new();
    };
    if list.len() < at_least || list.len() > MAX_POINTS {
        errors.push(format!(
            "{path}: {} points, from {at_least} to {MAX_POINTS} are allowed",
            list.len()
        ));
        return Vec::new();
    }
    let mut out = Vec::with_capacity(list.len());
    for (i, p) in list.iter().enumerate() {
        match serde_json::from_value::<Point>(p.clone()) {
            Ok(q) if q.iter().all(|c| c.is_finite() && c.abs() <= MAX_COORDINATE) => out.push(q),
            _ => {
                errors.push(format!(
                    "{path}[{i}]: not a point [x, y] in metres within ±{MAX_COORDINATE}"
                ));
                return Vec::new();
            }
        }
    }
    out
}

/// Sets a number that is missing; one that is there must be within the range.
fn number_or(
    o: &mut Map<String, Value>,
    key: &str,
    default: f64,
    (lo, hi): (f64, f64),
    path: &str,
    errors: &mut Vec<String>,
) -> f64 {
    match o.get(key) {
        None | Some(Value::Null) => {
            o.insert(key.into(), json!(default));
            default
        }
        Some(v) => match number(Some(v)).filter(|x| (lo..=hi).contains(x)) {
            Some(x) => x,
            None => {
                errors.push(format!("{path}.{key}: a number from {lo} to {hi} (metres)"));
                default
            }
        },
    }
}

fn id_of(
    o: &Map<String, Value>,
    path: &str,
    seen: &mut Vec<String>,
    errors: &mut Vec<String>,
) -> String {
    match o.get("id").and_then(Value::as_str) {
        Some(id) if !id.is_empty() && id.len() <= 40 => {
            if seen.iter().any(|s| s == id) {
                errors.push(format!("{path}.id: `{id}` is used twice"));
            }
            seen.push(id.to_string());
            id.to_string()
        }
        _ => {
            errors.push(format!(
                "{path}.id: missing (a short text, unique in the plan)"
            ));
            String::new()
        }
    }
}

/// A floor plan as a model wrote it, made into one the editor opens: the
/// missing measures get the defaults of the editor, an opening given as a
/// point (`at: [x, y]`) is hooked to the nearest wall, and everything that
/// cannot be drawn is an error. Returns the plan to store and its typed view.
pub fn normalize(raw: &Value) -> Result<(Value, FloorPlan), Vec<String>> {
    let mut errors = Vec::new();
    let Some(mut plan) = raw.as_object().cloned() else {
        return Err(vec!["the floor plan must be an object".into()]);
    };
    match plan.get("id").and_then(Value::as_str) {
        Some(id) if is_valid_id(id) => {}
        _ => errors
            .push("id: missing or not valid (letters, digits, `-` and `_`, at most 40)".into()),
    }
    if plan.get("nome").and_then(Value::as_str).is_none() {
        let id = plan.get("id").cloned().unwrap_or(json!(""));
        plan.insert("nome".into(), id);
    }
    if number(plan.get("unita_px_m")).is_none() {
        plan.insert("unita_px_m".into(), json!(EDITOR_PX_PER_M));
    }
    if plan.get("sfondo").and_then(Value::as_str).is_none() {
        plan.insert("sfondo".into(), json!(BACKGROUND_3D));
    }
    let mut lists_ok = true;
    for key in ["muri", "aperture", "aree", "blocchi"] {
        match plan.get(key) {
            None | Some(Value::Null) => {
                plan.insert(key.into(), json!([]));
            }
            Some(Value::Array(_)) => {}
            Some(_) => {
                lists_ok = false;
                errors.push(format!("{key}: must be a list"));
            }
        }
    }
    if !lists_ok {
        return Err(errors);
    }
    let mut seen = Vec::new();

    // Walls first: openings are placed on them.
    let mut walls: Vec<(String, Vec<Point>)> = Vec::new();
    let list = plan["muri"].as_array_mut().expect("checked above");
    if list.len() > MAX_WALLS {
        errors.push(format!("muri: {} walls, at most {MAX_WALLS}", list.len()));
    }
    for (i, w) in list.iter_mut().enumerate() {
        let path = format!("muri[{i}]");
        let Some(o) = w.as_object_mut() else {
            errors.push(format!("{path}: must be an object"));
            continue;
        };
        let id = id_of(o, &path, &mut seen, &mut errors);
        let points = points_of(o.get("punti"), 2, &format!("{path}.punti"), &mut errors);
        if !points.is_empty() && length(&points) == 0.0 {
            errors.push(format!("{path}.punti: the wall has no length"));
        }
        number_or(
            o,
            "spessore",
            WALL_THICKNESS,
            (0.02, 2.0),
            &path,
            &mut errors,
        );
        number_or(o, "altezza", WALL_HEIGHT, (0.1, 20.0), &path, &mut errors);
        walls.push((id, points));
    }

    let list = plan["aperture"].as_array_mut().expect("checked above");
    if list.len() > MAX_OPENINGS {
        errors.push(format!(
            "aperture: {} openings, at most {MAX_OPENINGS}",
            list.len()
        ));
    }
    for (i, a) in list.iter_mut().enumerate() {
        let path = format!("aperture[{i}]");
        let Some(o) = a.as_object_mut() else {
            errors.push(format!("{path}: must be an object"));
            continue;
        };
        id_of(o, &path, &mut seen, &mut errors);
        let window = match o.get("tipo").and_then(Value::as_str) {
            Some("porta") => false,
            Some("finestra") => true,
            _ => {
                errors.push(format!(
                    "{path}.tipo: must be `porta` (door) or `finestra` (window)"
                ));
                continue;
            }
        };
        let (width, height) = if window {
            (WINDOW_WIDTH, WINDOW_HEIGHT)
        } else {
            (DOOR_WIDTH, DOOR_HEIGHT)
        };
        number_or(o, "larghezza", width, (0.2, 10.0), &path, &mut errors);
        number_or(o, "altezza", height, (0.1, 20.0), &path, &mut errors);
        if window {
            number_or(o, "da_terra", WINDOW_SILL, (0.0, 20.0), &path, &mut errors);
        }
        // `at` is the easy way for who writes the plan: a point in metres, on
        // the wall or near it. The file keeps only wall + fraction.
        let named = o.get("muro").and_then(Value::as_str).map(str::to_string);
        if let Some(at) = o.remove("at") {
            let Ok(p) = serde_json::from_value::<Point>(at) else {
                errors.push(format!("{path}.at: must be a point [x, y] in metres"));
                continue;
            };
            let candidates = walls
                .iter()
                .filter(|(id, pts)| !pts.is_empty() && named.as_ref().is_none_or(|n| n == id));
            let nearest = candidates
                .map(|(id, pts)| (id, project(pts, p)))
                .min_by(|x, y| x.1 .1.total_cmp(&y.1 .1));
            match nearest {
                Some((id, (t, d))) if d <= MAX_SNAP_DISTANCE => {
                    o.insert("muro".into(), json!(id));
                    o.insert("t".into(), json!((t * 1e6).round() / 1e6));
                }
                Some((id, (_, d))) => errors.push(format!(
                    "{path}.at: [{}, {}] is {d:.2} m from the nearest wall (`{id}`): an opening sits on a wall",
                    p[0], p[1]
                )),
                None => errors.push(match &named {
                    Some(n) => format!("{path}.muro: there is no wall `{n}`"),
                    None => format!("{path}.at: the plan has no walls"),
                }),
            }
            continue;
        }
        match named {
            Some(n) if walls.iter().any(|(id, _)| *id == n) => {
                if number(o.get("t"))
                    .filter(|t| (0.0..=1.0).contains(t))
                    .is_none()
                {
                    errors.push(format!(
                        "{path}.t: a number from 0 to 1 along the wall — or give `at: [x, y]` instead"
                    ));
                }
            }
            Some(n) => errors.push(format!("{path}.muro: there is no wall `{n}`")),
            None => errors.push(format!(
                "{path}: needs `at: [x, y]` (a point on a wall, in metres), or `muro` and `t`"
            )),
        }
    }

    let list = plan["aree"].as_array_mut().expect("checked above");
    if list.len() > MAX_AREAS {
        errors.push(format!("aree: {} areas, at most {MAX_AREAS}", list.len()));
    }
    for (i, a) in list.iter_mut().enumerate() {
        let path = format!("aree[{i}]");
        let Some(o) = a.as_object_mut() else {
            errors.push(format!("{path}: must be an object"));
            continue;
        };
        id_of(o, &path, &mut seen, &mut errors);
        points_of(o.get("punti"), 3, &format!("{path}.punti"), &mut errors);
        match o.get("colore") {
            None | Some(Value::Null) => {
                o.insert("colore".into(), json!(AREA_COLOR));
            }
            Some(c) if c.as_str().is_some_and(is_hex_color) => {}
            Some(_) => errors.push(format!("{path}.colore: must be a colour like #e2e8f0")),
        }
    }

    if walls.is_empty() && plan["aree"].as_array().is_some_and(Vec::is_empty) {
        errors.push("the plan has no walls and no areas: there is nothing to draw".into());
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    let value = Value::Object(plan);
    let typed = serde_json::from_value::<FloorPlan>(value.clone())
        .map_err(|e| vec![format!("the floor plan cannot be read: {e}")])?;
    Ok((value, typed))
}

// ─────────────────────────────────────────────────────────────────────────────
// Metres → pixels
// ─────────────────────────────────────────────────────────────────────────────

/// How the plan sits on the drawing: `pixel = metre * scale + offset`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub scale: f64,
    pub dx: f64,
    pub dy: f64,
}

impl Placement {
    /// The plan as large as it fits in `into`, centred, with the same scale
    /// on the two axes. `None` when there is nothing to measure.
    pub fn fit(plan: &FloorPlan, into: Rect) -> Option<Self> {
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        for w in &plan.walls {
            for p in &w.points {
                // Half the thickness on each side: the face of an outer wall
                // must not be cut by the edge.
                xs.extend([p[0] - w.thickness / 2.0, p[0] + w.thickness / 2.0]);
                ys.extend([p[1] - w.thickness / 2.0, p[1] + w.thickness / 2.0]);
            }
        }
        for a in &plan.areas {
            xs.extend(a.points.iter().map(|p| p[0]));
            ys.extend(a.points.iter().map(|p| p[1]));
        }
        let min = |v: &[f64]| v.iter().copied().fold(f64::INFINITY, f64::min);
        let max = |v: &[f64]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if xs.is_empty() || into.w <= 0.0 || into.h <= 0.0 {
            return None;
        }
        let (x0, x1, y0, y1) = (min(&xs), max(&xs), min(&ys), max(&ys));
        let (w, h) = ((x1 - x0).max(0.01), (y1 - y0).max(0.01));
        let scale = (into.w / w).min(into.h / h);
        Some(Self {
            scale,
            dx: into.x + (into.w - w * scale) / 2.0 - x0 * scale,
            dy: into.y + (into.h - h * scale) / 2.0 - y0 * scale,
        })
    }

    fn px(&self, p: Point) -> Point {
        [p[0] * self.scale + self.dx, p[1] * self.scale + self.dy]
    }
}

/// A coordinate in the SVG: one decimal, and no `-0`.
fn n(v: f64) -> String {
    let r = (v * 10.0).round() / 10.0;
    if r == 0.0 {
        "0".into()
    } else {
        format!("{r}")
    }
}

fn path_of(points: &[Point]) -> String {
    points
        .iter()
        .enumerate()
        .map(|(i, p)| format!("{}{} {}", if i == 0 { "M" } else { "L" }, n(p[0]), n(p[1])))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The floor plan drawn flat, `width` × `height` pixels: areas, then walls
/// with their openings left open, then a glass line in each window and the
/// leaf of each door with the arc it sweeps. **No text**: a panel has no font
/// for it, and the names of the rooms are objects of the page.
///
/// Transparent where there is nothing: the page keeps its own background.
pub fn svg(
    plan: &FloorPlan,
    place: &Placement,
    width: f64,
    height: f64,
    wall_color: &str,
) -> String {
    let wall_color = if is_hex_color(wall_color) {
        wall_color
    } else {
        DEFAULT_WALL_COLOR
    };
    let mut out = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">\n",
        w = n(width),
        h = n(height)
    );

    out.push_str("<g id=\"areas\" stroke=\"none\">\n");
    for a in &plan.areas {
        let points = a
            .points
            .iter()
            .map(|p| {
                let q = place.px(*p);
                format!("{},{}", n(q[0]), n(q[1]))
            })
            .collect::<Vec<_>>()
            .join(" ");
        let color = if is_hex_color(&a.color) {
            &a.color
        } else {
            AREA_COLOR
        };
        out.push_str(&format!(
            "<polygon points=\"{points}\" fill=\"{color}\"/>\n"
        ));
    }
    out.push_str("</g>\n");

    out.push_str(&format!(
        "<g id=\"walls\" fill=\"none\" stroke=\"{wall_color}\" stroke-linejoin=\"miter\" stroke-linecap=\"butt\">\n"
    ));
    for w in &plan.walls {
        let total = length(&w.points);
        for (from, to) in solid_stretches(w, &plan.openings) {
            let mut points = sub_polyline(&w.points, from, to);
            // The two ends of the wall go half a thickness further, so two
            // walls that meet at a corner close it. The edges of an opening
            // stay where they are.
            let half = w.thickness / 2.0;
            if from <= 1e-9 {
                let dir = point_at_distance(&w.points, 0.0).1;
                points[0] = [points[0][0] - dir[0] * half, points[0][1] - dir[1] * half];
            }
            if to >= total - 1e-9 {
                let dir = point_at_distance(&w.points, total).1;
                let last = points.len() - 1;
                points[last] = [
                    points[last][0] + dir[0] * half,
                    points[last][1] + dir[1] * half,
                ];
            }
            let px: Vec<Point> = points.iter().map(|p| place.px(*p)).collect();
            out.push_str(&format!(
                "<path d=\"{}\" stroke-width=\"{}\"/>\n",
                path_of(&px),
                n((w.thickness * place.scale).max(1.0))
            ));
        }
    }
    out.push_str("</g>\n");

    out.push_str("<g id=\"openings\" fill=\"none\" stroke-linecap=\"butt\">\n");
    for o in &plan.openings {
        let Some(w) = plan.walls.iter().find(|w| w.id == o.wall) else {
            continue;
        };
        let (from, to) = opening_span(w, o);
        if to <= from {
            continue;
        }
        let thickness = (w.thickness * place.scale).max(1.0);
        match o.kind {
            OpeningKind::Window => {
                let px: Vec<Point> = sub_polyline(&w.points, from, to)
                    .iter()
                    .map(|p| place.px(*p))
                    .collect();
                let d = path_of(&px);
                out.push_str(&format!(
                    "<path d=\"{d}\" stroke=\"{GLASS_COLOR}\" stroke-width=\"{}\"/>\n",
                    n(thickness)
                ));
                out.push_str(&format!(
                    "<path d=\"{d}\" stroke=\"{wall_color}\" stroke-width=\"{}\"/>\n",
                    n((thickness * 0.2).max(1.0))
                ));
            }
            OpeningKind::Door => {
                // Hinge on the first edge of the gap; the leaf stands square to
                // the wall, and the arc is the quarter of a circle it sweeps
                // to close. The model has no side nor hand for a door: it
                // opens to the left of the direction the wall is drawn in.
                let hinge = place.px(point_at_distance(&w.points, from).0);
                let end = place.px(point_at_distance(&w.points, to).0);
                let r = distance(hinge, end);
                if r <= 0.0 {
                    continue;
                }
                let dir = [(end[0] - hinge[0]) / r, (end[1] - hinge[1]) / r];
                let leaf = [hinge[0] - dir[1] * r, hinge[1] + dir[0] * r];
                out.push_str(&format!(
                    "<path d=\"M{} {} L{} {} A{r} {r} 0 0 0 {} {}\" stroke=\"{wall_color}\" stroke-width=\"{}\"/>\n",
                    n(hinge[0]),
                    n(hinge[1]),
                    n(leaf[0]),
                    n(leaf[1]),
                    n(end[0]),
                    n(end[1]),
                    n((place.scale * 0.04).clamp(1.5, 4.0)),
                    r = n(r),
                ));
            }
        }
    }
    out.push_str("</g>\n</svg>\n");
    out
}

/// Where the things of the plan are **in page pixels**: `place` is the one the
/// drawing was made with, `origin` the corner of the drawing on the page.
///
/// - `rooms`: the areas, with their box and the point for a label;
/// - `windows` and `doors`: centre, length and angle of the wall there; for a
///   window, the room it gives light to and a point just inside it, which is
///   where a shutter or a contact sensor goes.
pub fn layout(plan: &FloorPlan, place: &Placement, origin: Point) -> Value {
    let page = |p: Point| {
        let q = place.px(p);
        [(q[0] + origin[0]).round(), (q[1] + origin[1]).round()]
    };
    let rooms: Vec<Value> = plan
        .areas
        .iter()
        .map(|a| {
            let px: Vec<Point> = a.points.iter().map(|p| page(*p)).collect();
            let min = |i: usize| px.iter().map(|p| p[i]).fold(f64::INFINITY, f64::min);
            let max = |i: usize| px.iter().map(|p| p[i]).fold(f64::NEG_INFINITY, f64::max);
            json!({
                "id": a.id,
                "label": a.label,
                "x": min(0), "y": min(1), "w": max(0) - min(0), "h": max(1) - min(1),
                "center": page(centroid(&a.points)),
            })
        })
        .collect();

    let mut windows = Vec::new();
    let mut doors = Vec::new();
    for o in &plan.openings {
        let Some(w) = plan.walls.iter().find(|w| w.id == o.wall) else {
            continue;
        };
        let (from, to) = opening_span(w, o);
        let (centre, dir) = point_at_distance(&w.points, (from + to) / 2.0);
        let c = page(centre);
        let mut v = json!({
            "id": o.id, "wall": w.id,
            "x": c[0], "y": c[1],
            "length": ((to - from) * place.scale).round(),
            "angle": dir[1].atan2(dir[0]).to_degrees().round(),
        });
        if o.kind == OpeningKind::Door {
            doors.push(v);
            continue;
        }
        // Half a metre past the face of the wall, on the side where a room is.
        let reach = w.thickness / 2.0 + 0.5;
        let room = [1.0, -1.0].iter().find_map(|side| {
            let p = [
                centre[0] - dir[1] * reach * side,
                centre[1] + dir[0] * reach * side,
            ];
            plan.areas
                .iter()
                .find(|a| contains(&a.points, p))
                .map(|a| (a, p))
        });
        if let Some((a, p)) = room {
            v["room"] = json!(a.id);
            v["inside"] = json!(page(p));
        }
        windows.push(v);
    }
    json!({
        "scale_px_per_m": (place.scale * 100.0).round() / 100.0,
        "rooms": rooms,
        "windows": windows,
        "doors": doors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two rooms side by side, 10 × 6 m: a window on the north wall of each,
    /// a door between them and the front door on the south wall.
    fn house() -> Value {
        json!({
            "id": "casa",
            "nome": "Casa",
            "muri": [
                { "id": "ext", "punti": [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]] },
                { "id": "mid", "punti": [[6, 0], [6, 6]], "spessore": 0.1 },
            ],
            "aperture": [
                { "id": "w-living", "tipo": "finestra", "at": [3, 0], "larghezza": 1.6 },
                { "id": "w-kitchen", "tipo": "finestra", "at": [8, 0.05] },
                { "id": "d-mid", "tipo": "porta", "at": [6, 4], "muro": "mid" },
                { "id": "d-front", "tipo": "porta", "muro": "ext", "t": 0.7 },
            ],
            "aree": [
                { "id": "living", "etichetta": "Soggiorno", "colore": "#f1f5f9",
                  "punti": [[0, 0], [6, 0], [6, 6], [0, 6]] },
                { "id": "kitchen", "etichetta": "Cucina",
                  "punti": [[6, 0], [10, 0], [10, 6], [6, 6]] },
            ],
        })
    }

    #[test]
    fn a_plan_written_by_a_model_becomes_one_the_editor_opens() {
        let (value, plan) = normalize(&house()).unwrap();
        // The defaults of the editor, where the model said nothing.
        assert_eq!(value["unita_px_m"], 50.0);
        assert_eq!(value["blocchi"], json!([]));
        assert_eq!(value["muri"][0]["spessore"], 0.2);
        assert_eq!(value["muri"][0]["altezza"], 2.7);
        assert_eq!(value["muri"][1]["spessore"], 0.1);
        assert_eq!(value["aperture"][1]["larghezza"], 1.2);
        assert_eq!(value["aperture"][1]["da_terra"], 0.9);
        assert_eq!(value["aperture"][2]["altezza"], 2.1);
        assert_eq!(value["aree"][1]["colore"], "#1e3a5f");
        // `at` became wall + fraction, and is gone: the file has no such key.
        let w = &value["aperture"][0];
        assert!(w.get("at").is_none());
        assert_eq!(w["muro"], "ext");
        assert!(
            (w["t"].as_f64().unwrap() - 3.0 / 32.0).abs() < 1e-5,
            "3 m along a wall of 32"
        );
        assert_eq!(value["aperture"][2]["muro"], "mid");
        assert!((value["aperture"][2]["t"].as_f64().unwrap() - 4.0 / 6.0).abs() < 1e-3);
        assert_eq!(plan.openings[3].t, 0.7);
        // And the server stores it as it is.
        let stored: crate::planimetrie::Planimetria =
            serde_json::from_value(value.clone()).unwrap();
        assert_eq!(stored.id, "casa");
        assert_eq!(serde_json::to_value(&stored).unwrap(), value);
    }

    #[test]
    fn what_cannot_be_drawn_is_said_with_its_path() {
        let e = normalize(&json!({
            "id": "casa mia",
            "muri": [
                { "id": "a", "punti": [[0, 0]] },
                { "id": "a", "punti": [[0, 0], [4, 0]], "spessore": 9 },
            ],
            "aperture": [
                { "id": "p", "tipo": "portone", "at": [1, 0] },
                { "id": "q", "tipo": "porta", "at": [2, 5] },
                { "id": "r", "tipo": "finestra", "muro": "zz", "t": 0.5 },
                { "id": "s", "tipo": "finestra", "muro": "a" },
            ],
            "aree": [{ "id": "z", "punti": [[0, 0], [1, 1]], "colore": "blue" }],
        }))
        .unwrap_err();
        let all = e.join("\n");
        for expected in [
            "id: missing or not valid",
            "muri[0].punti: 1 points",
            "muri[1].id: `a` is used twice",
            "muri[1].spessore",
            "aperture[0].tipo",
            "aperture[1].at: [2, 5] is 5.00 m from the nearest wall",
            "aperture[2].muro: there is no wall `zz`",
            "aperture[3].t",
            "aree[0].punti: 2 points",
            "aree[0].colore",
        ] {
            assert!(all.contains(expected), "missing «{expected}» in:\n{all}");
        }
        assert!(normalize(&json!({ "id": "x" })).unwrap_err()[0].contains("nothing to draw"));
        assert!(normalize(&json!([])).is_err());
    }

    #[test]
    fn the_drawing_has_walls_cut_at_the_openings_a_door_arc_and_no_text() {
        let (_, plan) = normalize(&house()).unwrap();
        let place = Placement::fit(
            &plan,
            Rect {
                x: 24.0,
                y: 24.0,
                w: 1232.0,
                h: 636.0,
            },
        )
        .unwrap();
        let s = svg(&plan, &place, 1280.0, 684.0, DEFAULT_WALL_COLOR);
        assert!(s.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1280 684\""));
        assert!(!s.contains("<text"), "no text in the drawing");
        assert_eq!(s.matches("<polygon").count(), 2, "one polygon per area");
        assert!(s.contains("fill=\"#f1f5f9\""));
        let walls = s
            .split("<g id=\"walls\"")
            .nth(1)
            .unwrap()
            .split("</g>")
            .next()
            .unwrap();
        // `ext` has two windows and a door: four stretches. `mid` has a door: two.
        assert_eq!(walls.matches("<path").count(), 6, "{walls}");
        let openings = s.split("<g id=\"openings\"").nth(1).unwrap();
        assert_eq!(
            openings.matches(GLASS_COLOR).count(),
            2,
            "a glass line per window"
        );
        assert_eq!(openings.matches(" A").count(), 2, "an arc per door");
        // Nothing drawn out of the canvas: every coordinate of a wall is in it.
        for d in walls.split("d=\"").skip(1) {
            let d = d.split('"').next().unwrap();
            let v: Vec<f64> = d
                .split(|c: char| c == 'M' || c == 'L' || c == ' ')
                .filter(|x| !x.is_empty())
                .map(|x| x.parse().unwrap())
                .collect();
            for p in v.chunks(2) {
                assert!(
                    (0.0..=1280.0).contains(&p[0]) && (0.0..=684.0).contains(&p[1]),
                    "{d}"
                );
            }
        }
    }

    #[test]
    fn a_door_is_a_leaf_square_to_the_wall_and_a_quarter_of_a_circle() {
        let (_, plan) = normalize(&json!({
            "id": "p",
            "muri": [{ "id": "m", "punti": [[0, 0], [4, 0]] }],
            "aperture": [{ "id": "d", "tipo": "porta", "muro": "m", "t": 0.5, "larghezza": 1 }],
        }))
        .unwrap();
        let place = Placement {
            scale: 100.0,
            dx: 0.0,
            dy: 0.0,
        };
        let s = svg(&plan, &place, 400.0, 200.0, "#000000");
        // Hinge at 1.5 m, leaf 1 m long going down the page, arc back to 2.5 m:
        // sweep 0, so its centre is the hinge and not the mirrored one.
        assert!(
            s.contains("<path d=\"M150 0 L150 100 A100 100 0 0 0 250 0\" stroke=\"#000000\""),
            "{s}"
        );
        // The wall stops at the two edges of the door, and runs half a
        // thickness past its own ends.
        assert!(
            s.contains("<path d=\"M-10 0 L150 0\" stroke-width=\"20\"/>"),
            "{s}"
        );
        assert!(
            s.contains("<path d=\"M250 0 L410 0\" stroke-width=\"20\"/>"),
            "{s}"
        );
    }

    #[test]
    fn rooms_and_windows_come_in_page_pixels() {
        let (_, plan) = normalize(&house()).unwrap();
        // The free area of a 1280×800 page with a 56 px header and a 60 px
        // footer, with a margin of 24.
        let place = Placement::fit(
            &plan,
            Rect {
                x: 24.0,
                y: 24.0,
                w: 1232.0,
                h: 636.0,
            },
        )
        .unwrap();
        let l = layout(&plan, &place, [0.0, 56.0]);
        // 10.2 × 6.2 m with the walls: the height decides, 636 / 6.2 px per metre.
        let scale = 636.0 / 6.2;
        assert_eq!(l["scale_px_per_m"], (scale * 100.0f64).round() / 100.0);
        let x = |m: f64| (24.0 + (1232.0 - 10.2 * scale) / 2.0 + (m + 0.1) * scale).round();
        let y = |m: f64| (56.0 + 24.0 + (m + 0.1) * scale).round();

        // Within a pixel: a fraction along a wall is stored with six decimals.
        let near = |v: &Value, expected: f64| {
            let got = v.as_f64().unwrap();
            assert!((got - expected).abs() <= 1.0, "{got} is not {expected}");
        };

        let living = &l["rooms"][0];
        assert_eq!(living["label"], "Soggiorno");
        near(&living["x"], x(0.0));
        near(&living["y"], y(0.0));
        near(&living["w"], 6.0 * scale);
        near(&living["center"][0], x(3.0));
        near(&living["center"][1], y(3.0));
        assert_eq!(l["rooms"][1]["id"], "kitchen");

        let w = &l["windows"][0];
        assert_eq!(w["id"], "w-living");
        near(&w["x"], x(3.0));
        near(&w["y"], y(0.0));
        near(&w["length"], 1.6 * scale);
        assert_eq!(w["angle"], 0.0);
        assert_eq!(w["room"], "living");
        // Inside the room: below the north wall, half a metre past its face.
        near(&w["inside"][0], x(3.0));
        near(&w["inside"][1], y(0.6));
        assert_eq!(l["windows"][1]["room"], "kitchen");

        let doors = l["doors"].as_array().unwrap();
        assert_eq!(doors.len(), 2);
        assert_eq!(doors[0]["id"], "d-mid");
        assert_eq!(doors[0]["angle"], 90.0);
        near(&doors[0]["x"], x(6.0));
        near(&doors[0]["y"], y(4.0));
        // Everything is on the page, inside the area.
        for r in l["rooms"].as_array().unwrap() {
            assert!(r["y"].as_f64().unwrap() >= 56.0);
            assert!(r["y"].as_f64().unwrap() + r["h"].as_f64().unwrap() <= 56.0 + 684.0);
        }
    }

    #[test]
    fn overlapping_openings_merge_and_one_past_the_end_is_cut() {
        let wall = Wall {
            id: "m".into(),
            points: vec![[0.0, 0.0], [4.0, 0.0]],
            thickness: 0.2,
        };
        let o = |t: f64| Opening {
            id: "o".into(),
            wall: "m".into(),
            t,
            width: 1.0,
            kind: OpeningKind::Door,
        };
        assert_eq!(
            solid_stretches(&wall, &[o(0.5), o(0.625)]),
            [(0.0, 1.5), (3.0, 4.0)]
        );
        assert_eq!(solid_stretches(&wall, &[o(1.0)]), [(0.0, 3.5)]);
        assert_eq!(solid_stretches(&wall, &[]), [(0.0, 4.0)]);
    }
}
