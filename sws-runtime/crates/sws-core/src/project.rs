// Hot-reload (notify crate) deferred — not needed for PoC happy path.

use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::tag::{TagDb, TagQuality, TagValue};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub name: String,
    pub version: String,
}

/// One tag definition as written in project.yaml.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDef {
    pub id: String,
    #[serde(default)]
    pub description: String,
    /// Storage type for this tag: "bool", "int", "float", or "string".
    /// Drives the initial `TagValue` variant seeded into the TagDb at startup.
    #[serde(default = "default_data_type")]
    pub data_type: String,
}

/// Discriminated union of all supported data source types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SourceDef {
    #[serde(rename = "modbus_tcp")]
    ModbusTcp(ModbusTcpConfig),
    #[serde(rename = "mqtt")]
    Mqtt(MqttConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModbusTcpConfig {
    pub id: String,
    pub host: String,
    #[serde(default = "default_modbus_port")]
    pub port: u16,
    #[serde(default = "default_unit_id")]
    pub unit_id: u8,
    /// How often to poll all registers, in milliseconds.
    #[serde(default = "default_poll_interval_ms")]
    pub poll_interval_ms: u64,
    pub registers: Vec<RegisterMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterMapping {
    /// TagId to write the value into.
    pub tag: String,
    /// Holding register start address (0-based).
    pub address: u16,
    /// Multiply the raw u16 word by this before storing. Default 1.0.
    #[serde(default = "default_scale")]
    pub scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MqttConfig {
    pub id: String,
    pub host: String,
    #[serde(default = "default_mqtt_port")]
    pub port: u16,
    #[serde(default = "default_mqtt_client_id")]
    pub client_id: String,
    pub topics: Vec<TopicMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicMapping {
    /// TagId to write the value into.
    pub tag: String,
    /// MQTT topic to subscribe to (exact match; wildcards not handled in PoC).
    pub topic: String,
    /// Optional dot-separated JSON path. If set, the payload is parsed as JSON
    /// and the field at `json_path` is extracted (e.g. "temperature" → root.temperature).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub json_path: Option<String>,
}

fn default_modbus_port() -> u16 { 502 }
fn default_unit_id() -> u8 { 1 }
fn default_poll_interval_ms() -> u64 { 1000 }
fn default_scale() -> f64 { 1.0 }
fn default_data_type() -> String { "float".to_string() }
fn default_mqtt_port() -> u16 { 1883 }
fn default_mqtt_client_id() -> String { "sws-runtime".to_string() }

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub meta: ProjectMeta,
    #[serde(default)]
    pub tags: Vec<TagDef>,
    #[serde(default)]
    pub sources: Vec<SourceDef>,
}

impl Project {
    /// Parse `<project_dir>/project.yaml`. Returns an error if the file is
    /// missing or malformed; the caller decides whether to abort or continue.
    pub fn load(project_dir: &Path) -> anyhow::Result<Self> {
        let path = project_dir.join("project.yaml");
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        serde_yaml::from_str(&text)
            .with_context(|| format!("parsing {}", path.display()))
    }

    /// Register every tag from the definition list in `db` with an initial
    /// value matching its declared `data_type`, quality `Uncertain`. Plugins
    /// will overwrite this as soon as they get a real reading.
    pub async fn populate_tags(&self, db: &TagDb) {
        for tag in &self.tags {
            let initial = match tag.data_type.as_str() {
                "bool"   => TagValue::Bool(false),
                "int"    => TagValue::Int(0),
                "string" => TagValue::Str(String::new()),
                _        => TagValue::Float(0.0), // default + unknown → float
            };
            db.set(tag.id.clone(), initial, TagQuality::Uncertain).await;
        }
    }
}
