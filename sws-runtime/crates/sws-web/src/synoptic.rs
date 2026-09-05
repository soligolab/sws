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
    /// Dark-theme override of `background`. Same drop-on-round-trip gap as
    /// `auto_rotate_skip` below — found during a systematic TS↔Rust field
    /// audit, not from a specific bug report.
    #[serde(skip_serializing_if = "Option::is_none")] pub background_dark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub width:        Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub height:       Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub groups:       Option<Value>,
    /// Zone restriction: if set, only users whose `allowed_zones` intersects this list
    /// can view or load this page. Empty list or None = accessible to all.
    #[serde(skip_serializing_if = "Option::is_none")] pub zones:        Option<Vec<String>>,
    /// When true, this page is skipped by the kiosk auto-rotate cycle. Was
    /// missing from this mirror (pre-existing gap: GET /api/synoptics/:name
    /// deserializes through this struct and would silently drop it on
    /// round-trip) — added here alongside `locked` since both are read via
    /// the same endpoint.
    #[serde(skip_serializing_if = "Option::is_none")] pub auto_rotate_skip: Option<bool>,
    /// When true, the page is read-only in the editor (no object/property edits).
    /// Does not block duplicate/delete (already confirm-gated separately).
    #[serde(skip_serializing_if = "Option::is_none")] pub locked:       Option<bool>,
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
    // Universal background layer (color + image URL) drawn behind the
    // object's own content — same convention grid cells already used.
    #[serde(skip_serializing_if = "Option::is_none")] pub bg_color:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bg_image:       Option<String>,
    // Chart axes/grid colors (trend today, shared by future chart widgets).
    #[serde(skip_serializing_if = "Option::is_none")] pub axis_color:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_color:     Option<String>,
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
    // F3 — pipeline di comando
    #[serde(skip_serializing_if = "Option::is_none")] pub button_mode:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub release_value:    Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub require_confirm:  Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub confirm_message:  Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub min_role:         Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub min_role_effect:  Option<String>,
    // F4 — allarmi e qualità per-oggetto
    #[serde(skip_serializing_if = "Option::is_none")] pub blink_mode:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub blink_tag:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub blink_rate_ms:    Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub show_alarm_state: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bad_value_style:  Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stale_after_s:    Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub critical:         Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub require_reason:   Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub write_on_release: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub write_deadband:   Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub checked_value:  Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub unchecked_value: Option<Value>,
    // Navigation
    #[serde(skip_serializing_if = "Option::is_none")] pub target_page:    Option<String>,
    // Numeric range
    #[serde(skip_serializing_if = "Option::is_none")] pub min:            Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub max:            Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub unit:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub decimals:       Option<u8>,
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
    /// When true, backfills from the OPC-UA server's historian on mount.
    /// Was missing from this mirror (same round-trip-drop gap as
    /// `auto_rotate_skip` above) — the checkbox in the editor appeared to
    /// work until the next save/reload silently reset it.
    #[serde(skip_serializing_if = "Option::is_none")] pub opcua_backfill: Option<bool>,
    /// Per-trace style overrides (width/dash/fill/smooth/color), parallel to
    /// [tag, ...extra_tags]. Generic JSON passthrough like `options`/`table_rows`
    /// above — the frontend owns the shape (see TrendSeriesStyle in types/index.ts).
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_series_styles: Option<Value>,
    /// Seconds moved per ◀/▶ pan click on the compact Trend widget. Defaults
    /// to 25% of window_s when unset.
    #[serde(skip_serializing_if = "Option::is_none")] pub pan_step_s: Option<f64>,
    // Trend date/time format (axis labels + hover tooltip)
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_dt_date_order:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_dt_separator:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_dt_time_format:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_dt_show_seconds:     Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_dt_show_year:        Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_dt_two_lines:        Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_dt_always_show_date: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_show_thresholds:     Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_show_alarm_markers:  Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_log_scale:           Option<bool>,
    /// Tracce unificate del trend (migrazione 2026-08-23): [{tag,label,color,…}].
    /// I campi legacy tag/extra_tags/trend_series_styles/line_color restano per
    /// i progetti non ancora ri-salvati.
    #[serde(skip_serializing_if = "Option::is_none")] pub trend_tags:                Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub datalog_page_size:         Option<f64>,
    // F6.6/F6.10 — simboli N-stati, rotazione, flusso pipe
    #[serde(skip_serializing_if = "Option::is_none")] pub symbol_states:             Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub symbol_spin:               Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub symbol_spin_tag:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub symbol_spin_s:             Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_flow:                 Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_flow_tag:             Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub motion_path:               Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub motion_tag:                Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub motion_min:                Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub motion_max:                Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub motion_anchor:             Option<String>,
    // F7.6 — rifiniture di forma (rect/ellipse, gauge, led, grid, image)
    #[serde(skip_serializing_if = "Option::is_none")] pub corner_radius:             Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill_gradient:             Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gauge_zones:               Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gauge_ticks:               Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gauge_start_angle:         Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gauge_end_angle:           Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gauge_sp_tag:              Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gauge_sp_color:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub led_shape:                 Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_gap:                  Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_padding:              Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub image_fit:                 Option<String>,
    // F7.4 — testo multiriga
    #[serde(skip_serializing_if = "Option::is_none")] pub text_wrap:                  Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub text_valign:                Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub line_height:                Option<f64>,
    // F7.2 — bar chart
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_mode:                   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_ticks:                  Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_show_legend:            Option<bool>,
    // F7.3 — pie chart
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_label_mode:             Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_group_below_pct:        Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_group_label:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_group_color:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_explode_px:             Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_hole_color:             Option<String>,
    // F7.1 — table 2.0 (le opzioni per-riga viaggiano dentro table_rows, Value)
    #[serde(skip_serializing_if = "Option::is_none")] pub table_columns:              Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub table_sortable:             Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub table_filterable:           Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub table_font_size:            Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub table_label_header:         Option<String>,
    // F7.5 — allarmi: ACK massivo, messa in silenzio, storico piazzabile
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_show_ack_all:   Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_show_shelve:    Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_shelve_minutes:        Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_history_id:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_bell_sound:            Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_bell_sound_severities: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_bell_sound_repeat_s:   Option<f64>,
    // XY plot (live point + trail, not a time series). `tag` above is the X axis.
    #[serde(skip_serializing_if = "Option::is_none")] pub y_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub xy_trail_s: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub xy_x_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub xy_x_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub xy_y_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub xy_y_max: Option<f64>,
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
    #[serde(skip_serializing_if = "Option::is_none")] pub text_color_by_threshold: Option<bool>,
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
    /// F2: il valore può essere una stringa (tag id, forma storica) oppure un
    /// oggetto BindingSpec {tag, in_min…out_max, clamp} / {expr}. Passthrough
    /// opaco: il runtime non lo interpreta, lo conserva e lo serve alla SPA.
    #[serde(skip_serializing_if = "Option::is_none")] pub bindings:         Option<std::collections::HashMap<String, serde_json::Value>>,
    // Grid layout object (type === "grid")
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_rows:         Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_cols:         Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")] pub col_widths:        Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub row_heights:       Option<Value>,
    // `grid_cells` is an opaque JSON array of GridCell records. Recent
    // additions on the TS side (`sub` mini-grids for split cells, merge
    // spans via rowspan/colspan) ride along without schema changes here.
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_cells:        Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_show_borders: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grid_border_color: Option<String>,
    // Quality dot
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot:                Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot_good_color:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot_bad_color:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub quality_dot_uncertain_color: Option<String>,
    // Editor-only metadata
    #[serde(skip_serializing_if = "Option::is_none")] pub locked:                     Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub group_id:                   Option<String>,
    // Built-in runtime action — opaque JSON so we don't need to mirror the
    // TypeScript discriminated union on the Rust side. The runtime SPA reads
    // the raw `type` field directly; the backend never interprets it.
    #[serde(skip_serializing_if = "Option::is_none")] pub button_action:              Option<Value>,
    // Alarm viewer (type === "alarm_viewer") — pre-existing widget, these 8
    // fields were never mirrored here: every save silently dropped them, the
    // same class of bug documented above for auto_rotate_skip/opcua_backfill.
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_max_rows:      Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_severities:    Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_id_prefix:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_show_ack:      Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_show_ts:       Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_show_empty:    Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_mode:          Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_viewer_bg_color:      Option<String>,
    // Alarm bell (type === "alarm_bell") — new in this session (T-42), mirrored
    // from day one so it doesn't repeat the alarm_viewer gap above.
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_bell_id_prefix:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_bell_severities:    Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_bell_show_history:  Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_bell_show_shelve:   Option<bool>,
    // Alarm banner (type === "alarm_banner") — new in this session (T-43),
    // mirrored from day one, same reasoning as alarm_bell above.
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_banner_id_prefix:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub alarm_banner_severities:  Option<Value>,
    // Recipe panel (type === "recipe_panel") — new in this session, mirrored
    // from day one, same reasoning as alarm_bell/alarm_banner above.
    #[serde(skip_serializing_if = "Option::is_none")] pub recipe_panel_id_prefix:   Option<String>,
    // Sparkline (type === "sparkline") — same pre-existing gap as alarm_viewer above.
    #[serde(skip_serializing_if = "Option::is_none")] pub spark_window_s:        Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub spark_color:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub spark_stroke_width:    Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub spark_fill:            Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub spark_fill_opacity:    Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub spark_show_last:       Option<bool>,
    // Pipe / connector (type === "pipe") — same pre-existing gap.
    #[serde(skip_serializing_if = "Option::is_none")] pub points:                Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub routing:               Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_style:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_gradient:         Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gradient_light_color:  Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub gradient_dark_color:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill_level:            Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill_level_tag:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill_level_scale:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill_color:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill_direction:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub start_marker:          Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub end_marker:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub marker_size:           Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_label:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_label_tag:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_label_format:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pipe_label_offset:     Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stroke_dasharray:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub from_obj_id:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub from_port:             Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub to_obj_id:             Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub to_port:               Option<String>,
    // Faceplate instance (type === "faceplate") — same pre-existing gap.
    #[serde(skip_serializing_if = "Option::is_none")] pub faceplate_id:          Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub faceplate_params:      Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub faceplate_scale:       Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub faceplate_overrides:   Option<Value>,
    // Text list (type === "text_list") — same pre-existing gap.
    #[serde(skip_serializing_if = "Option::is_none")] pub text_list_entries:       Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub text_list_default:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub text_list_default_color: Option<String>,
    // Bar chart (type === "bar_chart") — same pre-existing gap.
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_series:            Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_orientation:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_show_values:       Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_show_labels:       Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_show_thresholds:   Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_gap:               Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub bar_y_label:           Option<String>,
    // Pie / donut chart (type === "pie_chart") — same pre-existing gap.
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_slices:            Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_mode:              Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_inner_ratio:       Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_show_labels:       Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_center_text:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_center_tag:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_center_format:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pie_show_legend:       Option<bool>,
    // Language selector (type === "lang_selector") — same pre-existing gap.
    #[serde(skip_serializing_if = "Option::is_none")] pub target_lang:           Option<String>,
}

// Note: `symbol_kind` and `symbol_path` are NOT stored on the object —
// they are properties of the SymbolMeta registry on the editor side.
// The object carries only `symbol_id`; the renderer looks the kind up.

// ── T-52: il fuori pagina ────────────────────────────────────────────────────
//
// Adattatore sottile verso `sws_core::geometry`, che è dove sta la definizione.
// Qui non si ridefinisce niente: si estraggono i numeri da questo mirror, che
// ha una forma sua (`x`/`y` sono `f64` nudi, `points` è un `Value` opaco) e non
// coincide con quella del mirror LVGL. Il gemello in TypeScript è `isOffPage`
// in `sws-editor/src/pageLayout.ts`.
impl SynopticObject {
    /// I waypoint di una pipe, letti dal passthrough JSON. Un punto malformato
    /// viene saltato invece di far fallire tutto: questo campo non è tipizzato
    /// da nessuna parte del percorso, e un dato storto in un file non deve
    /// impedire di dire dove sta il resto dell'oggetto.
    fn punti(&self) -> Vec<(f64, f64)> {
        let Some(v) = self.points.as_ref().and_then(|p| p.as_array()) else { return Vec::new() };
        v.iter()
            .filter_map(|p| Some((p.get("x")?.as_f64()?, p.get("y")?.as_f64()?)))
            .collect()
    }

    pub fn bbox(&self) -> sws_core::BBox {
        sws_core::bbox_of(
            &self.obj_type,
            self.x,
            self.y,
            self.width.unwrap_or(0.0),
            self.height.unwrap_or(0.0),
            self.x2,
            self.y2,
            &self.punti(),
        )
    }

    /// Vero se l'oggetto è interamente fuori dal foglio, e quindi non va
    /// disegnato né controllato.
    ///
    /// Le pipe **agganciate** non lo sono mai: con `from_obj_id`/`to_obj_id` la
    /// geometria vera è dove stanno i capi, e una pipe ancorata con `points`
    /// vuoti vive nel file come [(0,0),(0,0)]. Per parcheggiarne una si
    /// staccano i capi. Identico al gemello TypeScript.
    pub fn is_off_page(&self, page: &SynopticPage) -> bool {
        if self.from_obj_id.is_some() || self.to_obj_id.is_some() {
            return false;
        }
        sws_core::is_off_page(&self.bbox(), page.width, page.height)
    }
}

/// A reusable parametric component. `objects` use `{param}` placeholders in
/// string fields (tag, label, text…). Each instance supplies concrete values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaceplateDef {
    pub id: String,
    pub label: String,
    /// Parametri del faceplate (F6.2): stringa nuda (forma storica) oppure
    /// oggetto tipizzato {name, type, default, required}. Passthrough opaco.
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
    /// Template objects. Positions are relative to the faceplate origin (0,0).
    #[serde(default)]
    pub objects: Vec<serde_json::Value>,
}

/// Sanitize a page name to a safe filename stem.
pub fn safe_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | '\0' => '_',
            _ => c,
        })
        .collect()
}

#[cfg(test)]
mod tests_fuori_pagina {
    use super::*;

    fn pagina(w: Option<f64>, h: Option<f64>) -> SynopticPage {
        let mut p: SynopticPage =
            serde_json::from_str(r#"{"id":"p","name":"P","objects":[],"background":null,"background_dark":null}"#)
                .expect("pagina minima");
        p.width = w;
        p.height = h;
        p
    }

    fn oggetto(json: &str) -> SynopticObject {
        serde_json::from_str(json).expect("oggetto di prova")
    }

    /// Il mirror web legge i waypoint da un `serde_json::Value` opaco, quindi
    /// ha un pezzo di codice suo che il gemello LVGL non ha: qui si prova che
    /// dice la stessa cosa.
    #[test]
    fn le_pipe_si_misurano_sui_waypoint() {
        let pg = pagina(Some(1280.0), Some(800.0));
        let dentro = r#"{"id":"p1","type":"pipe","x":0,"y":0,
            "points":[{"x":50,"y":400},{"x":250,"y":100}]}"#;
        assert!(!oggetto(dentro).is_off_page(&pg));
        let fuori = r#"{"id":"p1","type":"pipe","x":0,"y":0,
            "points":[{"x":5000,"y":400},{"x":5200,"y":100}]}"#;
        assert!(oggetto(fuori).is_off_page(&pg));
    }

    /// Un waypoint malformato viene saltato invece di far fallire tutto:
    /// `points` non è tipizzato in nessun punto del percorso, e un dato storto
    /// in un file non deve impedire di dire dove sta il resto dell'oggetto.
    #[test]
    fn un_waypoint_storto_non_fa_esplodere_la_misura() {
        let pg = pagina(Some(1280.0), Some(800.0));
        let misto = r#"{"id":"p1","type":"pipe","x":0,"y":0,
            "points":[{"x":50,"y":400},{"y":100},"boh"]}"#;
        assert!(!oggetto(misto).is_off_page(&pg));
    }

    #[test]
    fn una_pipe_agganciata_non_e_mai_fuori_pagina() {
        let pg = pagina(Some(1280.0), Some(800.0));
        let sciolta = r#"{"id":"p1","type":"pipe","x":0,"y":0,"points":[{"x":9000,"y":9000}]}"#;
        assert!(oggetto(sciolta).is_off_page(&pg));
        let agganciata = r#"{"id":"p1","type":"pipe","x":0,"y":0,
            "points":[{"x":9000,"y":9000}],"to_obj_id":"tank"}"#;
        assert!(!oggetto(agganciata).is_off_page(&pg));
    }
}
