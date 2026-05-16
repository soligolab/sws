use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Mirror of the TypeScript SynopticPage / SynopticObject types in sws-editor.
/// Used for JSON API and YAML persistence.
/// Fields use skip_serializing_if so YAML files stay compact.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynopticPage {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub objects: Vec<SynopticObject>,
    #[serde(skip_serializing_if = "Option::is_none")] pub background:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub width:        Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub height:       Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynopticObject {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub name:           Option<String>,
    #[serde(rename = "type")]
    pub obj_type: String,
    pub x: f64,
    pub y: f64,
    // Geometry
    #[serde(skip_serializing_if = "Option::is_none")] pub width:          Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub height:         Option<f64>,
    // Appearance
    #[serde(skip_serializing_if = "Option::is_none")] pub fill:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stroke:         Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stroke_width:   Option<f64>,
    // Line endpoint
    #[serde(skip_serializing_if = "Option::is_none")] pub x2:             Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub y2:             Option<f64>,
    // Tag binding
    #[serde(skip_serializing_if = "Option::is_none")] pub tag:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub format:         Option<String>,
    // Text / label
    #[serde(skip_serializing_if = "Option::is_none")] pub label:          Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub src:            Option<String>,
    // Control write
    #[serde(skip_serializing_if = "Option::is_none")] pub write_value:    Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub checked_value:  Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub unchecked_value: Option<Value>,
    // Navigation
    #[serde(skip_serializing_if = "Option::is_none")] pub target_page:    Option<String>,
    // Numeric range
    #[serde(skip_serializing_if = "Option::is_none")] pub min:            Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub max:            Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub unit:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub step:           Option<f64>,
    // Thresholds
    #[serde(skip_serializing_if = "Option::is_none")] pub warn_low:       Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub warn_high:      Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_low:      Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_high:     Option<f64>,
    // LED
    #[serde(skip_serializing_if = "Option::is_none")] pub on_value:       Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub on_color:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub off_color:      Option<String>,
    // Flags
    #[serde(skip_serializing_if = "Option::is_none")] pub show_value:     Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub read_only:      Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub orientation:    Option<String>,
    // Radio options / table rows (generic JSON arrays)
    #[serde(skip_serializing_if = "Option::is_none")] pub options:        Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub table_rows:     Option<Value>,
    // Trend chart
    #[serde(skip_serializing_if = "Option::is_none")] pub window_s:       Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub y_min:          Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub y_max:          Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub line_color:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub extra_tags:     Option<Vec<String>>,
    // Layer / visibility (cross-cutting)
    #[serde(skip_serializing_if = "Option::is_none")] pub z_index:        Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")] pub visible:        Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub visible_tag:    Option<String>,
    // Event handlers — function name to invoke on press/release.
    // Previous inline-Python `on_press` / `on_release` strings are now
    // function references resolved against `Project.functions` at run time.
    // (The legacy raw-code form is intentionally not honoured anymore.)
    #[serde(skip_serializing_if = "Option::is_none")] pub on_press_fn:    Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub on_release_fn:  Option<String>,
    /// Per-binding overrides for the picked function's parameters.
    #[serde(skip_serializing_if = "Option::is_none")] pub on_press_args:  Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub on_release_args: Option<Value>,
    // Text object styling
    #[serde(skip_serializing_if = "Option::is_none")] pub text:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub font_size:      Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub font_family:    Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub font_weight:    Option<Value>, // string ("bold") or number (700)
    #[serde(skip_serializing_if = "Option::is_none")] pub font_style:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub text_anchor:    Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub color:          Option<String>,
    // Built-in SCADA symbol (type === "symbol")
    #[serde(skip_serializing_if = "Option::is_none")] pub symbol_id:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub state_off_color:  Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub state_on_color:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub state_alarm_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub state_tag:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_tag:        Option<String>,
    /// Rotation in degrees around the bounding-box centre.
    #[serde(skip_serializing_if = "Option::is_none")] pub rotation:         Option<f64>,
    /// Mirror along the vertical axis.
    #[serde(skip_serializing_if = "Option::is_none")] pub flip_h:           Option<bool>,
    /// Mirror along the horizontal axis.
    #[serde(skip_serializing_if = "Option::is_none")] pub flip_v:           Option<bool>,
    /// Opacity 0..1 (default 1).
    #[serde(skip_serializing_if = "Option::is_none")] pub opacity:          Option<f64>,
    /// Optional CSS transition duration (ms) for CSS-animatable bound props
    /// (fill / stroke / opacity / transform). 0 or absent → no animation.
    #[serde(skip_serializing_if = "Option::is_none")] pub transition_duration_ms: Option<u64>,
    /// Generic prop-to-tag bindings. Keys are SynopticObject prop names.
    #[serde(skip_serializing_if = "Option::is_none")] pub bindings:         Option<std::collections::HashMap<String, String>>,
    // Grid layout object (type === "grid")
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_rows:         Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_cols:         Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")] pub col_widths:        Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub row_heights:       Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_cells:        Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_show_borders: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_border_color: Option<String>,
    // Quality dot
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot:                Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot_good_color:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot_bad_color:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot_uncertain_color: Option<String>,
}

// Note: `symbol_kind` and `symbol_path` are NOT stored on the object —
// they are properties of the SymbolMeta registry on the editor side.
// The object carries only `symbol_id`; the renderer looks the kind up.

/// Sanitize a page name to a safe filename stem.
pub fn safe_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | '\0' => '_',
            _ => c,
        })
        .collect()
}
