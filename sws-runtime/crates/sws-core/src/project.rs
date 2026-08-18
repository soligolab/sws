// Hot-reload (notify crate) deferred — not needed for PoC happy path.

use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::alarm::AlarmDef;
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
    /// When true, tag samples are persisted to `datastore_id` (or the project
    /// default datastore when unset). Default false.
    #[serde(default)]
    pub history: bool,
    /// Which datastore (by `DatastoreConfig::id`) receives this tag's samples.
    /// When None and `history` is true, uses the first configured datastore (or
    /// the built-in SQLite fallback).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub datastore_id: Option<String>,
    /// Minimum absolute change required to record a new sample. Prevents
    /// chatty analog tags from flooding the datastore with near-identical values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_deadband: Option<f64>,
    /// Minimum time between recorded samples (ms). Even if the value changed,
    /// samples closer than this interval are dropped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_min_interval_ms: Option<u64>,
    /// Python expression evaluated against a `tags` dict snapshot of the current
    /// TagDb values.  Example: `tags["motor.v"] * tags["motor.i"]`.
    /// When set the tag is read-only; writes via the API or TagWriteBus are
    /// rejected.  The expression is re-evaluated whenever any tag in the project
    /// changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
}

// ── Datastore configuration ───────────────────────────────────────────────────

/// Backend-specific connection parameters. Serialised as a discriminated union
/// using `kind` as the tag field (matches the SourceDef pattern).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatastoreBackendConfig {
    /// Local SQLite file. `path` is relative to the project directory unless
    /// it starts with `/`. Default path: `.history/historian.db`.
    Sqlite {
        #[serde(default = "default_sqlite_history_path")]
        path: String,
    },
    /// PostgreSQL (or TimescaleDB). Uses standard `sslmode` values:
    /// disable / prefer / require (default: prefer).
    Postgres {
        host: String,
        #[serde(default = "default_pg_port")]
        port: u16,
        database: String,
        username: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<String>,
        #[serde(default = "default_pg_ssl_mode")]
        ssl_mode: String,
        /// Target schema (default "public").
        #[serde(default = "default_pg_schema")]
        schema: String,
    },
    /// Generic ODBC source (SQL Server, Oracle, etc. via unixODBC).
    /// Provide either `dsn` (from /etc/odbc.ini) or a raw `connection_string`.
    Odbc {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dsn: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        connection_string: Option<String>,
        /// Target table name (default "sws_samples").
        #[serde(default = "default_odbc_table")]
        table: String,
        /// Column that holds the tag identifier (default "tag_id").
        #[serde(default = "default_odbc_col_tag")]
        col_tag: String,
        /// Column that holds the numeric value (default "value").
        #[serde(default = "default_odbc_col_value")]
        col_value: String,
        /// Column for the Unix-ms timestamp (default "ts_ms").
        #[serde(default = "default_odbc_col_ts")]
        col_ts: String,
    },
}

/// A named, persistent storage destination for tag history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatastoreConfig {
    /// Unique slug used in `TagDef::datastore_id` references and API paths.
    pub id: String,
    /// Human-readable label shown in the UI.
    pub label: String,
    pub backend: DatastoreBackendConfig,
    /// Maximum samples kept per tag (ring-buffer behaviour). None = unlimited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention_rows: Option<u64>,
    /// Maximum age in days. Samples older than this are pruned only when the
    /// maintainer triggers `POST /api/datastores/:id/purge` — there is no
    /// automatic/scheduled sweep. None = keep forever.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention_days: Option<u64>,
}

fn default_sqlite_history_path() -> String { ".history/historian.db".into() }
fn default_pg_port() -> u16 { 5432 }
fn default_pg_ssl_mode() -> String { "prefer".into() }
fn default_pg_schema() -> String { "public".into() }
fn default_odbc_table() -> String { "sws_samples".into() }
fn default_odbc_col_tag() -> String { "tag_id".into() }
fn default_odbc_col_value() -> String { "value".into() }
fn default_odbc_col_ts() -> String { "ts_ms".into() }

impl TagDef {
    /// Initial `TagValue` to seed the TagDb with for this definition.
    /// Used at startup (`populate_tags`) and on hot-reload of newly-added tags.
    pub fn initial_value(&self) -> TagValue {
        match self.data_type.as_str() {
            "bool"   => TagValue::Bool(false),
            "int"    => TagValue::Int(0),
            "string" => TagValue::Str(String::new()),
            _        => TagValue::Float(0.0),
        }
    }

    pub fn is_derived(&self) -> bool {
        self.expression.is_some()
    }
}

/// Discriminated union of all supported data source types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SourceDef {
    #[serde(rename = "modbus_tcp")]
    ModbusTcp(ModbusTcpConfig),
    #[serde(rename = "modbus_rtu")]
    ModbusRtu(ModbusRtuConfig),
    #[serde(rename = "opcua_server")]
    OpcUaServer(OpcUaServerConfig),
    #[serde(rename = "mqtt")]
    Mqtt(MqttConfig),
    #[serde(rename = "opcua_client")]
    OpcUaClient(OpcUaClientConfig),
    #[serde(rename = "homeassistant")]
    HomeAssistant(HomeAssistantConfig),
    #[serde(rename = "s7")]
    S7(S7Config),
    #[serde(rename = "enip")]
    EnIp(EnIpConfig),
}

/// Home Assistant integration source.
/// Connects via WebSocket + REST to a local or remote HA instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeAssistantConfig {
    pub id: String,
    /// Base URL of the HA instance, e.g. `http://homeassistant.local:8123`.
    pub url: String,
    /// Long-lived access token (plain text). Use `token_env` in production.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// Environment variable to read the access token from at runtime.
    /// Wins over `token` when both are set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_env: Option<String>,
    pub entities: Vec<EntityMapping>,
}

/// Maps one HA entity to a SWS tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityMapping {
    /// SWS tag id to write values into.
    pub tag: String,
    /// HA entity id, e.g. `sensor.living_room_temperature`.
    pub entity_id: String,
    /// When set, read this attribute instead of the entity's main `state`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribute: Option<String>,
    /// HA service domain for write-back (e.g. `light`, `switch`, `input_number`).
    /// When absent the tag is read-only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_domain: Option<String>,
    /// HA service name for write-back (e.g. `turn_on`, `set_value`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_service: Option<String>,
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

/// Modbus RTU (serial) source. Mirrors `ModbusTcpConfig` but uses a serial
/// device instead of a TCP address.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModbusRtuConfig {
    pub id: String,
    /// Serial device path, e.g. `/dev/ttyS0` or `/dev/ttyUSB0`.
    pub device: String,
    /// Baud rate, e.g. 9600, 19200, 115200.
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    /// Parity: "N" (none), "E" (even), "O" (odd). Default "N".
    #[serde(default = "default_parity")]
    pub parity: String,
    /// Data bits: 7 or 8. Default 8.
    #[serde(default = "default_data_bits")]
    pub data_bits: u8,
    /// Stop bits: 1 or 2. Default 1.
    #[serde(default = "default_stop_bits")]
    pub stop_bits: u8,
    #[serde(default = "default_unit_id")]
    pub unit_id: u8,
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

    // ── Authentication ────────────────────────────────────────────────
    /// Plain-text password. Sits in `project.yaml` on disk — for production
    /// use `password_env` instead. The web layer masks this on GET responses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Environment variable to read the password from at runtime. Wins over
    /// `password` when both are set, so secrets stay out of the YAML.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_env: Option<String>,

    // ── Connection tuning ─────────────────────────────────────────────
    /// MQTT keep-alive interval in seconds. Default 10.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_alive_secs: Option<u16>,
    /// `false` keeps the broker-side session across reconnects. Default true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clean_session: Option<bool>,
    /// QoS for subscribes/publishes when the per-topic field is unset.
    /// Accepts 0 / 1 / 2; anything else falls back to 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qos: Option<u8>,

    /// TLS settings. Absent / `enabled: false` → plain TCP.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<MqttTlsConfig>,

    /// Last-will message published by the broker on ungraceful disconnect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_will: Option<MqttLastWill>,

    /// When set, this source operates in Sparkplug B mode: payloads are
    /// protobuf-encoded and topics follow `spBv1.0/{group_id}/...`.
    /// Regular `topics` mapping is ignored when this is present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sparkplug: Option<SparkplugConfig>,

    /// When enabled, the runtime derives the wire client_id by gluing an
    /// instance-specific id to `client_id` (used as a prefix/suffix label)
    /// instead of using `client_id` literally. Avoids collisions when the
    /// same project is opened from the IDE and/or deployed to several
    /// devices against the same broker — each instance would otherwise
    /// connect with the exact same client_id and keep kicking each other.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub random_client_id: Option<RandomClientId>,

    /// Opt-in staleness guard: if no tag owned by this source updates within
    /// this many seconds, the watchdog in `SourceSupervisor` restarts it —
    /// independent of any error from the MQTT client, which may report
    /// "connected" even when a stuck/half-open session stops producing data.
    /// Off by default: MQTT is push-based with no natural reporting
    /// interval, so a guessed default would risk restarting sources that are
    /// legitimately just quiet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_silence_secs: Option<u64>,
}

/// See `MqttConfig::random_client_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RandomClientId {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub position: AffixPosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AffixPosition {
    #[default]
    Suffix,
    Prefix,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MqttTlsConfig {
    /// Master switch — turning it off without removing the block keeps the
    /// rest of the config around for quick toggles during testing.
    #[serde(default)]
    pub enabled: bool,
    /// Path to a PEM-encoded CA certificate to trust. When unset, the
    /// runtime falls back to the OS native trust store.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ca_cert_path: Option<String>,
    /// Skip hostname / chain validation. NOT implemented in PoC — flagged
    /// here so the YAML carries the intent and the UI can show a warning.
    #[serde(default)]
    pub insecure_skip_verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MqttLastWill {
    pub topic: String,
    pub payload: String,
    /// 0 / 1 / 2 — falls back to 0.
    #[serde(default)]
    pub qos: u8,
    #[serde(default)]
    pub retain: bool,
}

/// Sparkplug B configuration. When this is attached to an `MqttConfig`,
/// the plugin subscribes to `spBv1.0/{group_id}/#` and decodes all messages
/// as Sparkplug B protobuf payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SparkplugConfig {
    /// Sparkplug B group id (e.g. "plant-a").
    pub group_id: String,
    /// Sparkplug B SCADA host id — published in STATE birth certificate.
    #[serde(default = "default_spb_host_id")]
    pub host_id: String,
    /// Metric name → SWS tag id mappings.
    pub metrics: Vec<SparkplugMetricMapping>,
}

fn default_spb_host_id() -> String { "SWS-SCADA".to_string() }

/// Map one Sparkplug B metric name to an SWS tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SparkplugMetricMapping {
    /// Sparkplug B metric name as published by the edge node (e.g. "Pump/Speed").
    pub metric_name: String,
    /// SWS tag id (e.g. "pump.speed").
    pub tag: String,
    /// When true, `PUT /api/tags/:id` sends an NCMD back to the edge node.
    #[serde(default)]
    pub writable: bool,
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
    /// Optional outbound topic. When set, a `PUT /api/tags/:id` for `tag` is
    /// forwarded to this topic as a raw string payload (`true` / `42.5` / `…`).
    /// If equal to `topic`, the same channel is used for read and write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publish_topic: Option<String>,
    /// Per-mapping QoS override (0 / 1 / 2). When absent, the source-level
    /// `MqttConfig::qos` is used, then 0 as the final fallback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qos: Option<u8>,
}

/// OPC-UA client source. Connects to an `opc.tcp://…` endpoint, creates a
/// subscription, and feeds the configured nodes into the `TagDb`.
///
/// The `security_policy` field accepts the canonical names from the spec
/// (`None`, `Basic256Sha256`, …). For the PoC we only validate the value
/// against the small whitelist below; the plugin maps it to the matching
/// `async_opcua::types::SecurityPolicy` variant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcUaClientConfig {
    pub id: String,
    /// e.g. `opc.tcp://192.168.1.100:4840`.
    pub endpoint_url: String,
    /// PoC: only "None" is wired end-to-end; the field exists so the
    /// project format doesn't need a migration when we wire the rest.
    #[serde(default = "default_opcua_security_policy")]
    pub security_policy: String,
    #[serde(default)]
    pub auth: OpcUaAuth,
    /// Server-side subscription publishing interval, in milliseconds.
    #[serde(default = "default_opcua_subscription_interval_ms")]
    pub subscription_interval_ms: u64,
    /// Nodes to subscribe to. NodeId format is the canonical OPC-UA one,
    /// e.g. `ns=2;s=Machine.CycleTime` or `ns=0;i=2253`.
    #[serde(default)]
    pub nodes: Vec<OpcUaNodeMapping>,
    /// When true (default), any server certificate is automatically trusted.
    /// Set to false to require explicit certificate approval via the trust store.
    #[serde(default = "default_true")]
    pub trust_all_certs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcUaNodeMapping {
    pub tag: String,
    pub node_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// OPC-UA server — exposes SWS tag values as OPC-UA Variable nodes so that
/// SCADA supervisors, MES, and historian tools can subscribe to SWS directly.
/// One folder ("SWS") is created under ObjectsFolder; each mapping adds a
/// Variable node under that folder. Writes from OPC-UA clients flow into
/// TagWriteBus and are reflected in the TagDb.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcUaServerConfig {
    pub id: String,
    /// TCP port to listen on. Default 4840 (OPC-UA standard).
    #[serde(default = "default_opcua_server_port")]
    pub port: u16,
    /// Namespace URI for the SWS nodes,
    /// e.g. `urn:soligolab:sws`. Default `urn:soligolab:sws`.
    #[serde(default = "default_opcua_namespace_uri")]
    pub namespace_uri: String,
    /// Tag → OPC-UA node mappings. `node_id` is the string identifier
    /// within the SWS namespace (e.g. `"pump1.speed"`).
    #[serde(default)]
    pub nodes: Vec<OpcUaServerNodeMapping>,
}

/// One tag exposed as an OPC-UA Variable node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpcUaServerNodeMapping {
    /// SWS tag identifier.
    pub tag: String,
    /// OPC-UA string node id within the server namespace.
    /// Defaults to the tag id when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
}

impl OpcUaServerNodeMapping {
    /// Returns the effective OPC-UA node id string (node_id or tag).
    pub fn effective_node_id(&self) -> &str {
        self.node_id.as_deref().unwrap_or(&self.tag)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpcUaAuth {
    #[default]
    Anonymous,
    UsernamePassword {
        username: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password_env: Option<String>,
    },
}

fn default_opcua_security_policy() -> String { "None".into() }
fn default_opcua_subscription_interval_ms() -> u64 { 500 }
fn default_true() -> bool { true }
fn default_opcua_server_port() -> u16 { 4840 }
fn default_opcua_namespace_uri() -> String { "urn:soligolab:sws".into() }

fn default_modbus_port() -> u16 { 502 }
fn default_unit_id() -> u8 { 1 }
fn default_poll_interval_ms() -> u64 { 1000 }
fn default_scale() -> f64 { 1.0 }
fn default_baud_rate() -> u32 { 9600 }
fn default_parity() -> String { "N".into() }
fn default_data_bits() -> u8 { 8 }
fn default_stop_bits() -> u8 { 1 }
fn default_data_type() -> String { "float".to_string() }
fn default_mqtt_port() -> u16 { 1883 }
fn default_mqtt_client_id() -> String { "sws-runtime".to_string() }

// ── Siemens S7 config ─────────────────────────────────────────────────────────

fn default_s7_slot() -> u16 { 1 }
fn default_s7_poll_ms() -> u64 { 500 }
fn default_s7_area() -> String { "db".into() }

/// Data type of a tag mapped from the S7 PLC.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum S7DataType {
    Bool,
    Byte,
    Int,
    Word,
    Dint,
    #[default]
    Real,
}

/// One tag mapping from an S7 PLC to a SWS tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S7TagMapping {
    /// SWS tag id.
    pub tag: String,
    /// Memory area: "db", "m" (Merker), "i" (inputs), "q" (outputs).
    #[serde(default = "default_s7_area")]
    pub area: String,
    /// Data Block number (only for area == "db").
    #[serde(default)]
    pub db_num: i32,
    /// Byte offset within the area/DB.
    pub byte_offset: i32,
    /// Bit offset within the byte (0-7). Only used for `data_type: bool`.
    #[serde(default)]
    pub bit_offset: u8,
    /// Data type of this tag at the PLC.
    #[serde(default)]
    pub data_type: S7DataType,
    /// Optional write-back: when true, `PUT /api/tags/:id` writes back to PLC.
    #[serde(default)]
    pub writable: bool,
}

/// Siemens S7 ISO-on-TCP source (S7-300/400/1200/1500).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S7Config {
    pub id: String,
    /// PLC IP address.
    pub ip: String,
    /// CPU rack number. Usually 0.
    #[serde(default)]
    pub rack: u16,
    /// CPU slot number. 1 for S7-300/400, 0 for S7-1200/1500.
    #[serde(default = "default_s7_slot")]
    pub slot: u16,
    /// Poll interval in milliseconds.
    #[serde(default = "default_s7_poll_ms")]
    pub poll_interval_ms: u64,
    #[serde(default)]
    pub tags: Vec<S7TagMapping>,
}

// ── EtherNet/IP (Allen-Bradley / CIP) config ─────────────────────────────────

fn default_enip_poll_ms() -> u64 { 500 }

/// CIP data type for an EtherNet/IP tag.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnIpDataType {
    Bool,
    Sint,
    Int,
    Dint,
    Lint,
    #[default]
    Real,
}

/// One tag mapped from an Allen-Bradley PLC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnIpTagMapping {
    /// SWS tag id.
    pub tag: String,
    /// PLC tag name (e.g. "Motor_Speed" or "Program:MainProgram.Counter").
    pub plc_tag: String,
    /// CIP data type of this PLC tag.
    #[serde(default)]
    pub data_type: EnIpDataType,
    /// When true, `PUT /api/tags/:id` writes back to the PLC.
    #[serde(default)]
    pub writable: bool,
}

/// EtherNet/IP (CIP) source for Allen-Bradley ControlLogix/CompactLogix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnIpConfig {
    pub id: String,
    /// PLC IP address (port 44818 is implied).
    pub ip: String,
    /// CIP slot number (rack/slot for ControlLogix; 0 for CompactLogix/Micro).
    #[serde(default)]
    pub slot: u8,
    /// Poll interval in milliseconds.
    #[serde(default = "default_enip_poll_ms")]
    pub poll_interval_ms: u64,
    #[serde(default)]
    pub tags: Vec<EnIpTagMapping>,
}

/// One named parameter on a `FunctionDef`. Parameters become Python locals
/// when the function runs. Default is a JSON value so we can carry the
/// natural type (bool / int / float / string) without a tagged union.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionParam {
    /// Identifier — validated server-side to match `^[A-Za-z_][A-Za-z0-9_]*$`
    /// and reject Python keywords.
    pub name: String,
    /// Used when the caller doesn't pass a value for this parameter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
}

/// A reusable Python function authored at the project level. Objects on
/// the synoptic reference these by `name` (via their `on_press_fn` /
/// `on_release_fn` fields) instead of carrying inline code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    /// Stable id, generated client-side. Not the same as `name` so renames
    /// don't break object references in flight (they break only after save).
    pub id: String,
    /// Display name — also the lookup key used by the run endpoint.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Python source — capped at `MAX_FUNCTION_CODE_BYTES` at the API layer.
    pub code: String,
    #[serde(default)]
    pub params: Vec<FunctionParam>,
}

/// Hard cap on `FunctionDef::code.len()` enforced by the web layer.
pub const MAX_FUNCTION_CODE_BYTES: usize = 64 * 1024;

/// Attribution record for a user-imported SVG symbol.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomSymbolAttribution {
    pub author: String,
    pub source: String,
    pub license: String,
}

/// A user-supplied SVG symbol stored in project.yaml.
/// Rendered via `<image href>` like a vendored symbol; state badge overlaid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomSymbol {
    /// Stable slug, generated client-side (e.g. "my_pump_v2").
    pub id: String,
    pub label: String,
    /// Absolute URL or path served by the runtime.
    pub url: String,
    pub attribution: CustomSymbolAttribution,
}

fn deserialize_sources_tolerant<'de, D>(d: D) -> Result<Vec<SourceDef>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize as _;
    let raw: Vec<serde_yaml::Value> = Vec::deserialize(d)?;
    let mut out = Vec::with_capacity(raw.len());
    for val in raw {
        let kind = val.get("kind").and_then(|k| k.as_str()).unwrap_or("?").to_string();
        match serde_yaml::from_value::<SourceDef>(val) {
            Ok(src) => out.push(src),
            Err(e) => tracing::warn!(%kind, "skipping unrecognized source kind: {e}"),
        }
    }
    Ok(out)
}

/// Trigger type for a global script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScriptTrigger {
    /// Run once when the project is loaded.
    Startup,
    /// Run every `interval_s` seconds.
    Interval { interval_s: u64 },
    /// Run on a cron schedule (5-field: min hour day month weekday).
    Cron { schedule: String },
    /// Run when `tag` changes. `edge`: "rising", "falling", or "any" (default).
    TagChange { tag: String, #[serde(default = "default_edge")] edge: String },
}

fn default_edge() -> String { "any".into() }

/// A globally-scoped Python script with a trigger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalScriptDef {
    pub id: String,
    pub trigger: ScriptTrigger,
    /// Python code. Has access to `tags` (read/write), `log(msg)`.
    pub code: String,
    /// When false, the script is loaded but never scheduled.
    #[serde(default = "bool_true")]
    pub enabled: bool,
}

fn bool_true() -> bool { true }

// ── Notification config ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpConfig {
    pub host: String,
    /// SMTP port. Defaults to 587 (STARTTLS).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// "From" address, e.g. "SWS Alerts <alerts@example.com>".
    pub from: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Use STARTTLS (default true). Set false for plain SMTP on port 25.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starttls: Option<bool>,
}

/// Telegram Bot API channel. Sends text messages to one or more chat IDs via
/// `https://api.telegram.org/bot<token>/sendMessage`. Used both as an alarm
/// notification channel and by the `send_telegram(text)` script binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    /// Bot token from BotFather. Secret — masked on GET like the SMTP password.
    pub bot_token: String,
    /// Destination chat IDs (numeric, or `@channelusername`). Messages go to all.
    #[serde(default)]
    pub chat_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotificationConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smtp: Option<SmtpConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram: Option<TelegramConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub meta: ProjectMeta,
    #[serde(default)]
    pub tags: Vec<TagDef>,
    /// Tolerant deserialization: unknown `kind` values are skipped with a
    /// warning so a project.yaml written by a newer binary still loads on
    /// an older one (forward-compat). New source kinds added in future
    /// releases won't brick existing installations.
    #[serde(default, deserialize_with = "deserialize_sources_tolerant")]
    pub sources: Vec<SourceDef>,
    #[serde(default)]
    pub alarms: Vec<AlarmDef>,
    #[serde(default)]
    pub functions: Vec<FunctionDef>,
    #[serde(default)]
    pub custom_symbols: Vec<CustomSymbol>,
    /// Named persistent storage backends for tag history. When empty, the
    /// runtime falls back to a built-in SQLite file under `<project>/.history/`.
    #[serde(default)]
    pub datastores: Vec<DatastoreConfig>,
    #[serde(default)]
    pub global_scripts: Vec<GlobalScriptDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notifications: Option<NotificationConfig>,
    /// Version of the runtime that last wrote this file (CARGO_PKG_VERSION).
    /// Informational only — used by the IDE to warn when a project on disk was
    /// saved by a different runtime build and offer a one-click re-save.
    /// `None` on projects written before this field existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_by: Option<String>,
    /// Project-level language table for translating the messages the author
    /// writes into synoptic objects. Purely client-side (the viewer resolves
    /// `{{token}}` references); the runtime only persists it. See T-40.
    #[serde(default)]
    pub languages: LanguageTable,
    /// Project-wide page sizing/scaling mode + home page. `None` = legacy
    /// behavior = equivalent to `Fixed` (every project authored before this
    /// field existed already has literal per-page width/height).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_layout: Option<PageLayoutConfig>,
    /// Target di rendering del progetto: `None` = legacy/default = Web (ogni
    /// progetto creato prima di questo campo è implicitamente web). Guida
    /// il wizard di creazione progetto e il filtro della palette oggetti
    /// nell'editor (`docs/adr/0002-lvgl-rendering-engine.md`) — non ha
    /// alcun effetto sul runtime/sui protocolli, che restano identici per
    /// ogni target (vedi ADR 0002, "protocolli già tutti disponibili").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ProjectTarget>,
    /// Override per-progetto dell'intervallo di auto-backup (minuti). `None`
    /// = eredita il default di processo (`--auto-backup-interval-minutes`,
    /// 0 = disabilitato). `Some(0)` disabilita esplicitamente l'auto-backup
    /// per questo progetto anche se il processo lo ha abilitato globalmente.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_backup_interval_minutes: Option<u64>,
    /// Override per-progetto di quanti auto-backup tenere (i più vecchi
    /// vengono potati dopo ogni scatto). `None` = eredita il default di
    /// processo (`--auto-backup-retention`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_backup_retention: Option<u64>,
}

/// Motore di rendering a cui è destinato il progetto.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectTargetKind {
    /// SPA React/SVG nel browser — il target di sempre, nessun cambiamento.
    Web,
    /// Motore LVGL, output su framebuffer/DRM diretto (Fase 4, non ancora implementato).
    LvglFramebuffer,
    /// Motore LVGL, come client Wayland (Fase 4, non ancora implementato).
    LvglWayland,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTarget {
    pub kind: ProjectTargetKind,
    /// Percorso del device framebuffer (es. "/dev/fb0"). Significativo solo
    /// per `kind == LvglFramebuffer`; ignorato altrimenti.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub framebuffer_device: Option<String>,
}

/// How synoptic pages are sized and scaled at runtime.
/// - `Fixed`: page has a literal width/height matching a known target device;
///   the viewer renders it 1:1 (no scaling) — a window/screen mismatch shows
///   scrollbars or empty margin, never distortion or cropping.
/// - `Ratio`: the project picks an aspect ratio (e.g. "16:9"); pages use a
///   standard reference resolution for that ratio, and the viewer scales to
///   fit the real screen while preserving proportions (letterbox).
/// - `Fluid`: no nominal page size at all; content draws literally into
///   whatever viewport is available (1 design unit = 1 real pixel), no
///   scaling, no guaranteed cross-viewport layout.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PageSizeMode {
    Fixed,
    Ratio,
    Fluid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageLayoutConfig {
    pub size_mode: PageSizeMode,
    /// Aspect ratio label ("16:9" / "4:3" / "21:9" / "1:1" / "custom"). Only
    /// meaningful when `size_mode == Ratio`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<String>,
    /// Id of the page the viewer opens by default (and the kiosk auto-rotate
    /// cycle restarts from). `None` = fall back to the first page allowed by
    /// the operator's zones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home_page_id: Option<String>,
    /// Viewer a schermo pieno: nasconde la barra di navigazione e la fascia
    /// allarmi, così sul pannello si renderizza solo l'area della pagina. Gli
    /// allarmi attivi compaiono sovrapposti. Non riguarda l'header dell'IDE.
    /// `Option` + `skip_serializing_if` per non toccare i project.yaml
    /// esistenti che non hanno il campo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_viewer_chrome: Option<bool>,
}

/// Tabella lingue di progetto: messaggi nativi + traduzioni, indicizzati per
/// token/chiave. Il viewer risolve i riferimenti `{{token}}` nei campi testo
/// degli oggetti secondo la lingua corrente.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LanguageTable {
    /// Codice della lingua sorgente/predefinita (es. "it"). Vuoto se non impostata.
    #[serde(default)]
    pub default: String,
    /// Codici lingua presenti nella tabella, in ordine (es. ["it","en","de"]).
    #[serde(default)]
    pub langs: Vec<String>,
    /// Voci messaggio, una per token.
    #[serde(default)]
    pub entries: Vec<LangEntry>,
}

/// Una voce della tabella lingue: un token e le sue traduzioni per codice lingua.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LangEntry {
    /// Token/chiave usato negli oggetti come `{{key}}`.
    pub key: String,
    /// codice lingua → testo tradotto.
    #[serde(default)]
    pub values: std::collections::BTreeMap<String, String>,
}

/// Version of this runtime build, stamped into `project.yaml` on every save.
/// All workspace crates share `version.workspace`, so this matches the
/// `sws-runtime` binary version.
pub fn runtime_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
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

    /// True when this project was last saved by a different runtime version
    /// (or by one too old to record it). The IDE uses this to surface an
    /// "update project" prompt.
    pub fn needs_update(&self) -> bool {
        self.saved_by.as_deref() != Some(runtime_version())
    }

    /// Stamp the current runtime version into `saved_by` and serialize to YAML.
    /// All `project.yaml` writers go through this so the on-disk stamp always
    /// reflects the runtime that produced the file.
    pub fn stamp_and_serialize(&mut self) -> Result<String, serde_yaml::Error> {
        self.saved_by = Some(runtime_version().to_string());
        serde_yaml::to_string(self)
    }

    /// Stamp the runtime version and write `<project_dir>/project.yaml`.
    pub fn save_to(&mut self, project_dir: &Path) -> anyhow::Result<()> {
        let yaml = self.stamp_and_serialize()?;
        let path = project_dir.join("project.yaml");
        std::fs::write(&path, yaml)
            .with_context(|| format!("writing {}", path.display()))
    }

    /// Register every tag from the definition list in `db` with an initial
    /// value matching its declared `data_type`, quality `Uncertain`. Plugins
    /// will overwrite this as soon as they get a real reading.
    pub async fn populate_tags(&self, db: &TagDb) {
        for tag in &self.tags {
            db.set(tag.id.clone(), tag.initial_value(), TagQuality::Uncertain).await;
        }
    }
}

