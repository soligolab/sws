use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Mirror of the TypeScript SynopticPage / SynopticObject types in sws-editor.
/// Used for JSON API and YAML persistence.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynopticPage {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub objects: Vec<SynopticObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynopticObject {
    pub id: String,
    #[serde(rename = "type")]
    pub obj_type: String,
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")] pub width:       Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub height:      Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub fill:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub tag:         Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub format:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub src:         Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub label:       Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub write_value: Option<Value>,
}

/// Sanitize a page name to a safe filename stem (keep most printable chars,
/// only strip path-separators and null bytes to prevent traversal).
pub fn safe_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | '\0' => '_',
            _ => c,
        })
        .collect()
}
