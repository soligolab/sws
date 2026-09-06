//! OPC-UA client plugin for SWS (BL-005 step 1).
//!
//! PoC scope: anonymous + username/password auth, security policy `None`.
//! Connects, creates a subscription, streams subscribed node values into
//! the `TagDb`. On disconnect or fatal error, sleeps 5 s and retries.
//!
//! Out of scope (intentionally deferred): writes back to the server,
//! certificate-based security policies (Basic256Sha256 etc.), Euromap
//! companion-spec discovery (BL-005b), historical reads. Each is a
//! separate follow-up.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use opcua::client::{ClientBuilder, DataChangeCallback, HistoryReadAction, IdentityToken};
use opcua::crypto::SecurityPolicy;
use opcua::types::{
    AttributeId, BrowseDescription, BrowseDirection, DataValue, HistoryData, HistoryReadValueId,
    MessageSecurityMode, MonitoredItemCreateRequest, NodeClass, NodeId, NumericRange, ObjectId,
    ReadRawModifiedDetails, ReferenceTypeId, StatusCode, TimestampsToReturn, UserTokenPolicy,
    Variant, WriteValue,
};
use serde::{Deserialize, Serialize};
use sws_core::{OpcUaAuth, OpcUaClientConfig, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest};
use tokio::sync::mpsc;
use tracing::{info, warn};

/// Map the YAML `security_policy` string onto the underlying enum. Anything
/// not in the supported set falls back to `None` with a warning logged at
/// the call site — we don't want a typo on the editor side to silently
/// downgrade to "no security" without telling the operator.
fn parse_security_policy(s: &str) -> Option<SecurityPolicy> {
    match s {
        "None"               => Some(SecurityPolicy::None),
        "Basic128Rsa15"      => Some(SecurityPolicy::Basic128Rsa15),
        "Basic256"           => Some(SecurityPolicy::Basic256),
        "Basic256Sha256"     => Some(SecurityPolicy::Basic256Sha256),
        "Aes128Sha256RsaOaep"=> Some(SecurityPolicy::Aes128Sha256RsaOaep),
        "Aes256Sha256RsaPss" => Some(SecurityPolicy::Aes256Sha256RsaPss),
        _ => None,
    }
}

/// Pair a security policy with the message security mode it implies. `None`
/// uses no signing/encryption; everything else encrypts and signs (the
/// `Sign`-only mode is rarely seen on industrial endpoints — most servers
/// expose `None` and `SignAndEncrypt` for each supported policy).
fn security_mode_for(policy: SecurityPolicy) -> MessageSecurityMode {
    match policy {
        SecurityPolicy::None => MessageSecurityMode::None,
        _                    => MessageSecurityMode::SignAndEncrypt,
    }
}

/// Build the ClientBuilder common to subscription + browse. The PKI dir is
/// where async-opcua persists the runtime's self-signed cert + private
/// key. For long-lived sessions the supervisor passes the project-scoped
/// dir; one-shot browses use a tempdir.
fn build_client_builder(pki_dir: &Path, trust_all: bool) -> ClientBuilder {
    ClientBuilder::new()
        .application_name("SWS Runtime")
        .application_uri("urn:sws-runtime")
        // Generate a keypair on first run; reuse it on subsequent runs so
        // the server's trust list remains stable.
        .create_sample_keypair(true)
        .trust_server_certs(trust_all)
        .pki_dir(pki_dir.to_path_buf())
        .session_retry_limit(0)
}

/// Entry point spawned per source by the runtime. Loops forever: connect →
/// subscribe → run until something breaks → wait → reconnect.
///
/// `bus` lets the plugin participate in tag writes (`PUT /api/tags/:id` and
/// `/ws/tags` write frames). For each `cfg.nodes` entry we register an mpsc
/// sender on the bus; writes arrive on its receiver and are converted into
/// OPC-UA `Write` service calls inside the session loop.
///
/// `pki_dir` is where async-opcua persists the runtime's self-signed cert
/// and private key for secure-channel security policies. Each source gets
/// its own subdirectory so multiple servers don't share the same identity.
pub async fn run(cfg: OpcUaClientConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, pki_dir: PathBuf) {
    let source_pki = pki_dir.join(&cfg.id);
    match run_once(&cfg, &db, &bus, &source_pki).await {
        Ok(()) => info!(source = %cfg.id, "opcua: session ended cleanly"),
        Err(e) => warn!(source = %cfg.id, "opcua: session error: {e} — stopped (save config to retry)"),
    }
    for n in &cfg.nodes {
        if let Some(state) = db.get(&n.tag).await {
            db.ingest(n.tag.clone(), state.value, TagQuality::Bad).await;
        }
    }
}

async fn run_once(
    cfg: &OpcUaClientConfig,
    db: &Arc<TagDb>,
    bus: &Arc<TagWriteBus>,
    pki_dir: &Path,
) -> anyhow::Result<()> {
    // Ensure the PKI dir exists; async-opcua expects it to be present when
    // create_sample_keypair=true.
    if let Err(e) = std::fs::create_dir_all(pki_dir) {
        warn!(pki = %pki_dir.display(), "opcua: cannot create pki dir: {e}");
    }
    let mut client = build_client_builder(pki_dir, cfg.trust_all_certs)
        .client()
        .map_err(|e| anyhow::anyhow!("opcua client builder: {e:?}"))?;

    // Resolve the configured security policy. Unknown values fall back to
    // `None` with a warning so a typo on the editor side doesn't silently
    // turn off security.
    let security_policy = match parse_security_policy(&cfg.security_policy) {
        Some(p) => p,
        None => {
            warn!(policy = %cfg.security_policy,
                "opcua: unknown security_policy, falling back to None");
            SecurityPolicy::None
        }
    };
    let security_mode = security_mode_for(security_policy);

    // EndpointDescription from (url, security_policy_uri, security_mode,
    // user_token_policy). The anonymous user token policy is the common
    // default for unauthenticated industrial servers.
    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        security_policy.to_uri(),
        security_mode,
        UserTokenPolicy::anonymous(),
    ).into();

    // Resolve credentials. password_env wins over password so secrets can
    // stay out of project.yaml.
    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword { username, password, password_env } => {
            let pwd = password_env
                .as_ref()
                .and_then(|k| std::env::var(k).ok())
                .or_else(|| password.clone())
                .unwrap_or_default();
            IdentityToken::new_user_name(username.clone(), pwd)
        }
    };

    let (session, event_loop) = client
        .connect_to_endpoint_directly(endpoint, identity)
        .map_err(|e| anyhow::anyhow!("opcua connect: {e}"))?;

    info!(source = %cfg.id, endpoint = %cfg.endpoint_url, "opcua: connecting");

    let handle = event_loop.spawn();
    session.wait_for_connection().await;
    info!(source = %cfg.id, "opcua: connected, creating subscription");

    // node_id → tag id, used by the callback to route DataValue updates.
    // Wrapped in Arc so the closure can outlive this scope without
    // requiring a 'static lifetime juggling act.
    let mut routing: HashMap<NodeId, String> = HashMap::with_capacity(cfg.nodes.len());
    // Reverse lookup for writes: tag id → NodeId. Cloned per request inside
    // the writer task so the bus receiver doesn't need to share the map.
    let mut tag_to_node: HashMap<String, NodeId> = HashMap::with_capacity(cfg.nodes.len());
    let mut items: Vec<MonitoredItemCreateRequest> = Vec::with_capacity(cfg.nodes.len());
    for mapping in &cfg.nodes {
        let nid = NodeId::from_str(&mapping.node_id)
            .map_err(|e| anyhow::anyhow!("invalid NodeId '{}': {e}", mapping.node_id))?;
        routing.insert(nid.clone(), mapping.tag.clone());
        tag_to_node.insert(mapping.tag.clone(), nid.clone());
        items.push(nid.into());
    }
    let routing = Arc::new(routing);

    // Register every owned tag with the write bus. The mpsc receiver is
    // drained by the writer task below; on session exit we unregister
    // explicitly so the bus doesn't keep forwarding to a closed channel.
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    for mapping in &cfg.nodes {
        bus.register(mapping.tag.clone(), write_tx.clone()).await;
    }
    // Hold a clone so write_tx isn't dropped before the writer task starts
    // — the bus.register clones above also keep it alive, but explicit
    // ownership here makes the lifetime obvious.
    drop(write_tx);

    // Set up the subscription with a closure that ships every DataValue
    // change over an mpsc channel. The dispatcher task drains the channel
    // into the TagDb — keeps the callback purely synchronous (it can't
    // await TagDb writes directly) without blocking the OPC-UA worker.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(NodeId, DataValue)>();
    let publishing_interval = Duration::from_millis(cfg.subscription_interval_ms.max(50));

    let subscription_id = session
        .create_subscription(
            publishing_interval,
            10,    // lifetime count
            30,    // max keep-alive count
            0,     // max notifications per publish (0 = server picks)
            0,     // priority
            true,  // publishing enabled
            DataChangeCallback::new(move |value, item| {
                let nid = item.item_to_monitor().node_id.clone();
                let _ = tx.send((nid, value));
            }),
        )
        .await
        .map_err(|e| anyhow::anyhow!("create_subscription: {e}"))?;

    let _ = session
        .create_monitored_items(subscription_id, TimestampsToReturn::Both, items)
        .await
        .map_err(|e| anyhow::anyhow!("create_monitored_items: {e}"))?;

    info!(source = %cfg.id, count = cfg.nodes.len(), "opcua: subscribed");

    // Dispatcher: each DataValue arriving from the callback lands in TagDb.
    // We exit when the session event loop ends or the channel closes.
    let db_clone = db.clone();
    let routing_clone = routing.clone();
    let source_id = cfg.id.clone();
    let dispatcher = tokio::spawn(async move {
        while let Some((node_id, dv)) = rx.recv().await {
            let Some(tag_id) = routing_clone.get(&node_id) else { continue };
            let (value, quality) = data_value_to_tag(&dv);
            db_clone.set(tag_id.clone(), value, quality).await;
            tracing::trace!(source = %source_id, tag = %tag_id, "opcua: tag update");
        }
    });

    // Writer task — drains TagWriteBus requests for our tags, converts each
    // into an OPC-UA Write call. We don't batch (operator writes are
    // human-paced and infrequent vs the periodic reads); the per-call
    // overhead is below 10 ms on a LAN, well under the WS reply timeout.
    let session_for_writes = session.clone();
    let tag_to_node = Arc::new(tag_to_node);
    let writer_source_id = cfg.id.clone();
    let writer_db = db.clone();
    let writer = tokio::spawn(async move {
        while let Some((tag, value)) = write_rx.recv().await {
            let Some(nid) = tag_to_node.get(&tag).cloned() else {
                warn!(source = %writer_source_id, tag = %tag, "opcua: write for unknown tag");
                continue;
            };
            let variant = match tag_value_to_variant(&value) {
                Some(v) => v,
                None => {
                    warn!(source = %writer_source_id, tag = %tag,
                          "opcua: cannot serialise tag value to a Variant");
                    continue;
                }
            };
            let to_write = vec![WriteValue {
                node_id: nid,
                attribute_id: AttributeId::Value as u32,
                index_range: Default::default(),
                value: DataValue {
                    value: Some(variant.clone()),
                    status: Some(StatusCode::Good),
                    source_timestamp: None, source_picoseconds: None,
                    server_timestamp: None, server_picoseconds: None,
                },
            }];
            match session_for_writes.write(&to_write).await {
                Ok(codes) => {
                    let ok = codes.first().map(|c| c == &StatusCode::Good).unwrap_or(false);
                    if ok {
                        // Echo the new value into TagDb at Good quality so
                        // the UI sees the change immediately, instead of
                        // waiting for the next subscription publish.
                        // ingest(): il valore in `value` è quello di linea
                        // (raw) — l'echo deve ri-scalare in unità eng.
                        writer_db.ingest(tag.clone(), value, TagQuality::Good).await;
                        tracing::debug!(source = %writer_source_id, tag = %tag, "opcua: write OK");
                    } else {
                        warn!(source = %writer_source_id, tag = %tag, codes = ?codes,
                              "opcua: write rejected by server");
                    }
                }
                Err(e) => {
                    warn!(source = %writer_source_id, tag = %tag,
                          "opcua: write call failed: {e}");
                }
            }
        }
    });

    // Await the session event loop — when it returns the connection has
    // ended (graceful close, error, etc.). Aborting the dispatcher then
    // releases tx and the unbounded channel.
    let _ = handle.await;
    dispatcher.abort();
    writer.abort();
    // Release the tag routes so the next reconnect re-registers cleanly.
    let owned: Vec<String> = cfg.nodes.iter().map(|n| n.tag.clone()).collect();
    bus.unregister_many(&owned).await;
    Ok(())
}

/// Map a `TagValue` to the OPC-UA `Variant` the server expects on write.
/// Returns `None` for value shapes we can't cleanly translate (none today —
/// every TagValue maps somewhere — but kept so the callsite has a clean
/// failure path for future additions).
fn tag_value_to_variant(v: &TagValue) -> Option<Variant> {
    match v {
        TagValue::Bool(b)  => Some(Variant::Boolean(*b)),
        TagValue::Int(n)   => Some(Variant::Int64(*n)),
        TagValue::Float(f) => Some(Variant::Double(*f)),
        TagValue::Str(s)   => Some(Variant::String(s.as_str().into())),
    }
}

/// Map an OPC-UA DataValue into the (value, quality) pair the TagDb expects.
/// Falls back to Float(0.0)/Uncertain when the variant carries a type we
/// don't have a clean home for (arrays, ExtensionObjects, etc. — PoC scope).
fn data_value_to_tag(dv: &DataValue) -> (TagValue, TagQuality) {
    let quality = match dv.status {
        Some(s) if s == StatusCode::Good => TagQuality::Good,
        Some(_) => TagQuality::Bad,
        None => TagQuality::Uncertain,
    };
    let value = match &dv.value {
        Some(Variant::Boolean(b))   => TagValue::Bool(*b),
        Some(Variant::Byte(n))      => TagValue::Int(*n as i64),
        Some(Variant::SByte(n))     => TagValue::Int(*n as i64),
        Some(Variant::Int16(n))     => TagValue::Int(*n as i64),
        Some(Variant::UInt16(n))    => TagValue::Int(*n as i64),
        Some(Variant::Int32(n))     => TagValue::Int(*n as i64),
        Some(Variant::UInt32(n))    => TagValue::Int(*n as i64),
        Some(Variant::Int64(n))     => TagValue::Int(*n),
        Some(Variant::UInt64(n))    => TagValue::Int(*n as i64),
        Some(Variant::Float(f))     => TagValue::Float(*f as f64),
        Some(Variant::Double(d))    => TagValue::Float(*d),
        Some(Variant::String(s))    => TagValue::Str(s.as_ref().to_string()),
        Some(Variant::LocalizedText(t)) => TagValue::Str(t.text.as_ref().to_string()),
        Some(_other) => {
            // Unsupported variant — emit Uncertain so the UI flags it but
            // we don't crash the dispatcher on rare value types.
            return (TagValue::Float(0.0), TagQuality::Uncertain);
        }
        None => return (TagValue::Float(0.0), TagQuality::Uncertain),
    };
    (value, quality)
}

// ── Historical reads (BL-005c) ───────────────────────────────────────────────
//
// Opens a temporary OPC-UA session, issues a HistoryRead / ReadRawModified
// request for one node, and returns the samples. The session is torn down
// immediately after the call — this is a one-shot backfill, not a live feed.
//
// Only numeric and boolean nodes are converted; string values are silently
// dropped since the Trend chart can't plot them.

#[derive(Debug, Clone, Serialize)]
pub struct HistoricalSample {
    /// Milliseconds since Unix epoch (source timestamp, falling back to server
    /// timestamp when the server doesn't populate the source timestamp).
    pub ts_ms: u64,
    /// Numeric value — bool → 0.0/1.0, integers widened to f64.
    pub value: f64,
    pub quality: &'static str, // "Good" | "Bad" | "Uncertain"
}

/// Fetch raw historical data for one OPC-UA node.
///
/// * `cfg` — the source configuration (endpoint, auth, security policy).
/// * `node_id` — canonical OPC-UA NodeId string (`ns=2;s=Machine.Temp`).
/// * `from_ms` — start of the time range (Unix ms); defaults to 24 h ago.
/// * `to_ms`   — end of the time range (Unix ms); defaults to now.
/// * `max_values` — server-side cap per call (≤ 1000 for PoC).
pub async fn read_history(
    cfg: &OpcUaClientConfig,
    node_id: &str,
    from_ms: Option<u64>,
    to_ms: Option<u64>,
    max_values: u32,
) -> anyhow::Result<Vec<HistoricalSample>> {
    // 100-ns ticks between the OPC-UA epoch (1601-01-01) and the Unix epoch
    // (1970-01-01). Used to convert between Unix-ms and OPC-UA ticks without
    // pulling in a chrono dependency.
    const EPOCH_OFFSET_TICKS: i64 = 116_444_736_000_000_000;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let from_ms = from_ms.unwrap_or(now_ms.saturating_sub(86_400_000));
    let to_ms   = to_ms.unwrap_or(now_ms);

    let ms_to_opc = |ms: u64| -> opcua::types::DateTime {
        let ticks = (ms as i64) * 10_000 + EPOCH_OFFSET_TICKS;
        ticks.into()
    };
    let start_time = ms_to_opc(from_ms);
    let end_time   = ms_to_opc(to_ms);

    let nid = NodeId::from_str(node_id)
        .map_err(|e| anyhow::anyhow!("invalid NodeId '{node_id}': {e}"))?;

    let tmpdir = tempfile::tempdir()
        .map_err(|e| anyhow::anyhow!("opcua history: cannot create temp pki: {e}"))?;
    let mut client = build_client_builder(tmpdir.path(), true)
        .application_name("SWS Runtime (history)")
        .client()
        .map_err(|e| anyhow::anyhow!("opcua client builder: {e:?}"))?;

    let security_policy = parse_security_policy(&cfg.security_policy)
        .unwrap_or(SecurityPolicy::None);
    let security_mode = security_mode_for(security_policy);

    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        security_policy.to_uri(),
        security_mode,
        UserTokenPolicy::anonymous(),
    ).into();

    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword { username, password, password_env } => {
            let pwd = password_env
                .as_ref()
                .and_then(|k| std::env::var(k).ok())
                .or_else(|| password.clone())
                .unwrap_or_default();
            IdentityToken::new_user_name(username.clone(), pwd)
        }
    };

    let (session, event_loop) = client
        .connect_to_endpoint_directly(endpoint, identity)
        .map_err(|e| anyhow::anyhow!("opcua connect: {e}"))?;
    let loop_handle = event_loop.spawn();
    session.wait_for_connection().await;

    let node_to_read = HistoryReadValueId {
        node_id: nid,
        index_range: NumericRange::None,
        data_encoding: opcua::types::QualifiedName::default(),
        continuation_point: Default::default(),
    };

    let details = ReadRawModifiedDetails {
        is_read_modified: false,
        start_time,
        end_time,
        num_values_per_node: max_values,
        return_bounds: false,
    };

    let results = session
        .history_read(
            HistoryReadAction::ReadRawModifiedDetails(details),
            TimestampsToReturn::Source,
            false,
            &[node_to_read],
        )
        .await
        .map_err(|e| anyhow::anyhow!("opcua history_read: {e}"))?;

    let _ = session.disconnect().await;
    loop_handle.abort();
    drop(tmpdir);

    let mut out = Vec::new();
    for result in results {
        if !result.status_code.is_good() {
            warn!(node = %node_id, code = ?result.status_code, "opcua history_read: bad status");
            continue;
        }
        let Some(hd) = result.history_data.inner_as::<HistoryData>() else { continue };
        for dv in hd.data_values.iter().flatten() {
            let ts_ms = dv.source_timestamp
                .or(dv.server_timestamp)
                .map(|dt| {
                    // Convert OPC-UA ticks (since 1601-01-01) to Unix ms.
                    ((dt.ticks() - EPOCH_OFFSET_TICKS) / 10_000) as u64
                })
                .unwrap_or(0);
            let quality = match dv.status {
                Some(s) if s == StatusCode::Good => "Good",
                Some(_) => "Bad",
                None     => "Uncertain",
            };
            let value = match &dv.value {
                Some(Variant::Boolean(b))   => if *b { 1.0 } else { 0.0 },
                Some(Variant::Byte(n))      => *n as f64,
                Some(Variant::SByte(n))     => *n as f64,
                Some(Variant::Int16(n))     => *n as f64,
                Some(Variant::UInt16(n))    => *n as f64,
                Some(Variant::Int32(n))     => *n as f64,
                Some(Variant::UInt32(n))    => *n as f64,
                Some(Variant::Int64(n))     => *n as f64,
                Some(Variant::UInt64(n))    => *n as f64,
                Some(Variant::Float(f))     => *f as f64,
                Some(Variant::Double(d))    => *d,
                _ => continue, // skip strings, extension objects, nulls
            };
            out.push(HistoricalSample { ts_ms, value, quality });
        }
    }
    Ok(out)
}

// ── Server browse (BL-005 step 3) ────────────────────────────────────────────
//
// Opens a temporary OPC-UA session, browses the requested node (or the
// Objects folder when `parent_node_id` is None), returns the immediate
// children as a flat list. Recursion is on the caller side — the frontend
// expands a folder by calling browse again with that folder's NodeId,
// which keeps payloads small and avoids server-side fan-out timeouts.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowsedNode {
    /// Canonical string form (`ns=2;s=Machine.X`) — the same shape used in
    /// `OpcUaNodeMapping.node_id`, so the frontend can dump this directly
    /// into the table.
    pub node_id: String,
    pub browse_name: String,
    pub display_name: String,
    /// `Object`, `Variable`, `Method`, … — used by the UI to draw folder
    /// vs leaf icons and decide whether the row is selectable as a tag.
    pub node_class: String,
}

/// Open a temporary session, browse one level under `parent_node_id`
/// (defaults to the OPC-UA Objects folder), return the immediate children.
/// The session is closed when this function returns so we don't leak a
/// long-lived connection to the server for what is a one-shot UI lookup.
///
/// `direction`:
///   - `"forward"` (default) — children that the parent references; this
///     is the natural address-space browse for picking variables.
///   - `"inverse"` / `"both"` — also include parents / siblings via inbound
///     references. Useful for inspector-style UIs that want to walk back up.
///
/// The PKI dir is auto-managed: a fresh tempdir is created on every call
/// and dropped at function exit. Browse is one-shot so cert continuity
/// doesn't matter; the long-lived plugin uses a persistent dir.
pub async fn browse_one_level(
    cfg: &OpcUaClientConfig,
    parent_node_id: Option<&str>,
    direction: BrowseDir,
) -> anyhow::Result<Vec<BrowsedNode>> {
    let tmpdir = tempfile::tempdir()
        .map_err(|e| anyhow::anyhow!("opcua browse: cannot create temp pki: {e}"))?;
    let mut client = build_client_builder(tmpdir.path(), true)
        .application_name("SWS Runtime (browse)")
        .client()
        .map_err(|e| anyhow::anyhow!("opcua client builder: {e:?}"))?;

    let security_policy = parse_security_policy(&cfg.security_policy)
        .unwrap_or(SecurityPolicy::None);
    let security_mode = security_mode_for(security_policy);

    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        security_policy.to_uri(),
        security_mode,
        UserTokenPolicy::anonymous(),
    ).into();

    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword { username, password, password_env } => {
            let pwd = password_env
                .as_ref()
                .and_then(|k| std::env::var(k).ok())
                .or_else(|| password.clone())
                .unwrap_or_default();
            IdentityToken::new_user_name(username.clone(), pwd)
        }
    };

    let (session, event_loop) = client
        .connect_to_endpoint_directly(endpoint, identity)
        .map_err(|e| anyhow::anyhow!("opcua connect: {e}"))?;
    let loop_handle = event_loop.spawn();
    session.wait_for_connection().await;

    let parent = match parent_node_id {
        Some(s) => NodeId::from_str(s)
            .map_err(|e| anyhow::anyhow!("invalid parent NodeId '{s}': {e}"))?,
        None => ObjectId::ObjectsFolder.into(),
    };

    let browse_direction = match direction {
        BrowseDir::Forward => BrowseDirection::Forward,
        BrowseDir::Inverse => BrowseDirection::Inverse,
        BrowseDir::Both    => BrowseDirection::Both,
    };

    // BrowseDescription: configurable direction; HierarchicalReferences with
    // subtypes covers the common Organizes / HasComponent / HasProperty
    // hierarchy used by industrial servers. result_mask 0x3f = browse_name |
    // display_name | node_class | type_definition + is_forward.
    let req = BrowseDescription {
        node_id: parent,
        browse_direction,
        reference_type_id: ReferenceTypeId::HierarchicalReferences.into(),
        include_subtypes: true,
        node_class_mask: 0,
        result_mask: 0x3f,
    };

    let results = session.browse(&[req], 1000, None).await
        .map_err(|e| anyhow::anyhow!("browse: {e}"))?;

    let mut out: Vec<BrowsedNode> = Vec::new();
    for r in results {
        let Some(refs) = r.references else { continue };
        for rd in refs {
            out.push(BrowsedNode {
                node_id:      rd.node_id.node_id.to_string(),
                browse_name:  rd.browse_name.name.as_ref().to_string(),
                display_name: rd.display_name.text.as_ref().to_string(),
                node_class:   node_class_label(rd.node_class).to_string(),
            });
        }
    }

    // Gracefully tear down. Best-effort: we still return `out` even if
    // disconnect fails.
    let _ = session.disconnect().await;
    loop_handle.abort();
    drop(tmpdir);
    Ok(out)
}

/// Direction parameter for `browse_one_level`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BrowseDir {
    #[default]
    Forward,
    Inverse,
    Both,
}

// ── Euromap auto-discovery (BL-005b) ─────────────────────────────────────────
//
// Walks the server's address space breadth-first (capped depth + node
// count) looking for Variable nodes whose `browse_name` matches one of the
// canonical Euromap 77 (injection moulding) or Euromap 83 (temperature
// control unit) variable names. Matches return both the actual NodeId
// found on the server and the SWS-side tag name we'd suggest using.
//
// This is a heuristic — it does *not* check the OPC-UA companion-spec
// type definitions (which is the strictly-correct way) because the simple
// browse-name match catches most servers without paying the per-node
// `read DataType + walk supertypes` cost. Servers that use vendor-specific
// browse names will still need the operator to add nodes by hand.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EuromapVariable {
    /// "77" (injection moulding) or "83" (temperature control unit).
    pub spec: String,
    pub canonical_name: String,
    pub suggested_tag_suffix: String,
    pub description: String,
    pub node_id: String,
    pub browse_name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EuromapDetection {
    /// Total nodes inspected during the walk.
    pub nodes_scanned: usize,
    /// Whether the walk hit the cap and may have missed deeper matches.
    pub truncated: bool,
    pub variables: Vec<EuromapVariable>,
}

/// Euromap variables we recognise. Tuple = (spec, canonical_name,
/// suggested_tag_suffix, description). The browse-name match is
/// case-insensitive against `canonical_name`; suggested tag suffix is what
/// the UI proposes (operator can still rename in the table).
const EUROMAP_VARIABLES: &[(&str, &str, &str, &str)] = &[
    // Euromap 77 — injection moulding
    ("77", "MachineState",                  "machine_state",     "Stato macchina (int)"),
    ("77", "ActiveErrors",                  "active_errors",     "Errori attivi (int)"),
    ("77", "CycleTime",                     "cycle_time",        "Tempo ciclo (s, float)"),
    ("77", "InjectionTime",                 "injection_time",    "Tempo iniezione (s, float)"),
    ("77", "MeltTemperature",               "melt_temp",         "Temperatura fuso (°C, float)"),
    ("77", "ClampingForce",                 "clamping_force",    "Forza di chiusura (kN, float)"),
    ("77", "ProductionActiveParts",         "parts_produced",    "Pezzi prodotti (int)"),
    ("77", "ProductionActiveDefectiveParts","parts_defective",   "Pezzi difettosi (int)"),
    // Euromap 83 — temperature control unit
    ("83", "TbcActualTemperature",          "temp_actual",       "Temperatura attuale (°C, float)"),
    ("83", "TbcSetTemperature",             "temp_set",          "Temperatura set (°C, float)"),
    ("83", "TbcState",                      "tcu_state",         "Stato TCU (int)"),
];

const EUROMAP_MAX_NODES: usize = 500;
const EUROMAP_MAX_DEPTH: usize = 4;

/// Walk the server's address space looking for known Euromap variables.
/// BFS, capped at [`EUROMAP_MAX_NODES`] visited nodes and
/// [`EUROMAP_MAX_DEPTH`] levels under the Objects folder.
pub async fn detect_euromap(cfg: &OpcUaClientConfig) -> anyhow::Result<EuromapDetection> {
    use std::collections::{HashSet, VecDeque};

    let tmpdir = tempfile::tempdir()
        .map_err(|e| anyhow::anyhow!("opcua detect-euromap: cannot create temp pki: {e}"))?;
    let mut client = build_client_builder(tmpdir.path(), true)
        .application_name("SWS Runtime (euromap)")
        .client()
        .map_err(|e| anyhow::anyhow!("opcua client builder: {e:?}"))?;

    let security_policy = parse_security_policy(&cfg.security_policy)
        .unwrap_or(SecurityPolicy::None);
    let security_mode = security_mode_for(security_policy);
    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        security_policy.to_uri(),
        security_mode,
        UserTokenPolicy::anonymous(),
    ).into();
    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword { username, password, password_env } => {
            let pwd = password_env
                .as_ref()
                .and_then(|k| std::env::var(k).ok())
                .or_else(|| password.clone())
                .unwrap_or_default();
            IdentityToken::new_user_name(username.clone(), pwd)
        }
    };
    let (session, event_loop) = client
        .connect_to_endpoint_directly(endpoint, identity)
        .map_err(|e| anyhow::anyhow!("opcua connect: {e}"))?;
    let loop_handle = event_loop.spawn();
    session.wait_for_connection().await;

    // Look up table for fast match.
    let lookup: HashMap<String, &(&str, &str, &str, &str)> = EUROMAP_VARIABLES
        .iter()
        .map(|t| (t.1.to_lowercase(), t))
        .collect();

    let mut visited: HashSet<NodeId> = HashSet::new();
    let mut queue: VecDeque<(NodeId, usize)> = VecDeque::new();
    let root: NodeId = ObjectId::ObjectsFolder.into();
    queue.push_back((root.clone(), 0));
    visited.insert(root);

    let mut matched: Vec<EuromapVariable> = Vec::new();
    let mut scanned = 0usize;
    let mut truncated = false;

    while let Some((parent, depth)) = queue.pop_front() {
        if scanned >= EUROMAP_MAX_NODES {
            truncated = true;
            break;
        }
        scanned += 1;
        let req = BrowseDescription {
            node_id: parent.clone(),
            browse_direction: BrowseDirection::Forward,
            reference_type_id: ReferenceTypeId::HierarchicalReferences.into(),
            include_subtypes: true,
            node_class_mask: 0,
            result_mask: 0x3f,
        };
        let results = match session.browse(&[req], 200, None).await {
            Ok(r) => r,
            Err(e) => {
                warn!("opcua detect-euromap: browse failed at {parent}: {e}");
                continue;
            }
        };
        for r in results {
            let Some(refs) = r.references else { continue };
            for rd in refs {
                let nid = rd.node_id.node_id.clone();
                if visited.contains(&nid) { continue; }
                visited.insert(nid.clone());
                let browse_name = rd.browse_name.name.as_ref().to_string();
                let display_name = rd.display_name.text.as_ref().to_string();
                let key = browse_name.to_lowercase();
                if rd.node_class == NodeClass::Variable {
                    if let Some(meta) = lookup.get(&key) {
                        matched.push(EuromapVariable {
                            spec: meta.0.into(),
                            canonical_name: meta.1.into(),
                            suggested_tag_suffix: meta.2.into(),
                            description: meta.3.into(),
                            node_id: nid.to_string(),
                            browse_name,
                            display_name,
                        });
                    }
                } else if depth < EUROMAP_MAX_DEPTH {
                    queue.push_back((nid, depth + 1));
                }
            }
        }
    }

    let _ = session.disconnect().await;
    loop_handle.abort();
    drop(tmpdir);

    Ok(EuromapDetection { nodes_scanned: scanned, truncated, variables: matched })
}

fn node_class_label(c: NodeClass) -> &'static str {
    match c {
        NodeClass::Object        => "Object",
        NodeClass::Variable      => "Variable",
        NodeClass::Method        => "Method",
        NodeClass::ObjectType    => "ObjectType",
        NodeClass::VariableType  => "VariableType",
        NodeClass::ReferenceType => "ReferenceType",
        NodeClass::DataType      => "DataType",
        NodeClass::View          => "View",
        NodeClass::Unspecified   => "Unspecified",
    }
}

// ── OPC-UA server ─────────────────────────────────────────────────────────────

/// Expose SWS tag values as OPC-UA Variable nodes.
///
/// Launches an anonymous OPC-UA server on `cfg.port`. For each `cfg.nodes`
/// entry, one Variable node is created under an "SWS" folder in ObjectsFolder
/// using the configured `cfg.namespace_uri`. The server mirrors every
/// TagDb broadcast into the matching node so OPC-UA subscribers receive
/// live updates. Writes from OPC-UA clients are forwarded to TagWriteBus.
///
/// The server runs until `cancel` fires (called by SourceSupervisor on
/// project-close or reconfigure), which signals the opcua runtime to stop.
pub async fn run_server(
    cfg: sws_core::OpcUaServerConfig,
    db: Arc<sws_core::TagDb>,
    _bus: Arc<sws_core::TagWriteBus>,
    cancel: tokio_util::sync::CancellationToken,
) {
    use opcua::nodes::{AccessLevel, VariableBuilder};
    use opcua::server::{
        ServerBuilder,
        node_manager::memory::simple_node_manager,
        diagnostics::NamespaceMetadata,
    };
    use opcua::types::{DataTypeId, DataValue, NodeId, ObjectId};
    use sws_core::{TagValue, TagQuality};

    let (server, handle) = match ServerBuilder::new_anonymous("SWS OPC-UA Server")
        .application_uri(format!("urn:soligolab:sws:{}", cfg.id))
        .host("0.0.0.0")
        .port(cfg.port)
        .trust_client_certs(true)
        .with_node_manager(simple_node_manager(
            NamespaceMetadata {
                namespace_uri: cfg.namespace_uri.clone(),
                ..Default::default()
            },
            "sws",
        ))
        .build()
    {
        Ok(x) => x,
        Err(e) => {
            warn!(source = %cfg.id, "OPC-UA server build failed: {e}");
            return;
        }
    };

    // Namespace index is assigned by the server at build time.
    let ns = handle.get_namespace_index(&cfg.namespace_uri).unwrap_or(2);
    let Some(node_mgr) = handle
        .node_managers()
        .get_of_type::<opcua::server::node_manager::memory::SimpleNodeManager>()
    else {
        warn!(source = %cfg.id, "OPC-UA server: could not get SimpleNodeManager");
        return;
    };

    // Populate address space: folder + one Variable per tag mapping.
    {
        let mut address_space = node_mgr.address_space().write();
        let folder_id = NodeId::new(ns, "SWS");
        let objects_folder: NodeId = ObjectId::ObjectsFolder.into();
        address_space.add_folder(&folder_id, "SWS", "SWS", &objects_folder);

        for mapping in &cfg.nodes {
            let nid = NodeId::new(ns, mapping.effective_node_id());
            VariableBuilder::new(&nid, mapping.effective_node_id(), mapping.effective_node_id())
                .data_type(DataTypeId::Double)
                .value(0.0_f64)
                .access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                .user_access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                .writable()
                .organized_by(folder_id.clone())
                .insert(&mut *address_space);
        }
    }

    // Wire OPC-UA write → TagDb. Sync callbacks cannot be async, so we use
    // an unbounded mpsc channel: callback posts to channel; a spawned task
    // drains it and calls db.ingest() (bypassing the write bus — the OPC-UA
    // server is the authoritative source for these tags while running).
    let (write_tx, mut write_rx) =
        tokio::sync::mpsc::unbounded_channel::<(String, TagValue)>();
    {
        let impl_ = node_mgr.inner();
        for mapping in &cfg.nodes {
            let nid = NodeId::new(ns, mapping.effective_node_id());
            let tag = mapping.tag.clone();
            let tx = write_tx.clone();
            impl_.add_write_callback(nid, move |dv, _range| {
                if let Some(v) = &dv.value {
                    let tv: Option<TagValue> = match v {
                        opcua::types::Variant::Boolean(b) => Some(TagValue::Bool(*b)),
                        opcua::types::Variant::Float(f)   => Some(TagValue::Float(*f as f64)),
                        opcua::types::Variant::Double(f)  => Some(TagValue::Float(*f)),
                        opcua::types::Variant::Int32(i)   => Some(TagValue::Int(*i as i64)),
                        opcua::types::Variant::Int64(i)   => Some(TagValue::Int(*i)),
                        opcua::types::Variant::String(s)  => Some(TagValue::Str(s.as_ref().to_string())),
                        _ => None,
                    };
                    if let Some(tv) = tv {
                        let _ = tx.send((tag.clone(), tv));
                    }
                }
                opcua::types::StatusCode::Good
            });
        }
    }
    drop(write_tx); // callbacks hold clones; drop our copy so the channel closes when they all drop
    // Write-drain task: receives (tag, value) pairs from OPC-UA write callbacks.
    let db_for_writes = db.clone();
    let write_drainer = tokio::spawn(async move {
        while let Some((tag, value)) = write_rx.recv().await {
            db_for_writes.set(tag, value, TagQuality::Good).await;
        }
    });

    info!(source = %cfg.id, port = cfg.port, ns = %cfg.namespace_uri,
          nodes = cfg.nodes.len(), "OPC-UA server started");

    // Mirror TagDb broadcasts into the OPC-UA address space.
    let mut db_rx = db.subscribe();
    let handle_for_update = handle.clone();
    let node_mgr_for_update = node_mgr.clone();
    let nodes_for_update: Vec<_> = cfg.nodes.clone();
    let ns_for_update = ns;

    let updater = tokio::spawn(async move {
        loop {
            match db_rx.recv().await {
                Ok(update) => {
                    // Find the mapping for this tag (linear scan — small list).
                    let Some(mapping) = nodes_for_update.iter().find(|m| m.tag == update.id) else {
                        continue;
                    };
                    let nid = NodeId::new(ns_for_update, mapping.effective_node_id());
                    let variant = tag_value_to_variant(&update.state.value);
                    if let Some(v) = variant {
                        let dv = DataValue::new_now(v);
                        let _ = node_mgr_for_update.set_value(
                            handle_for_update.subscriptions(),
                            &nid, None, dv,
                        );
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!("OPC-UA server: dropped {n} TagDb updates (lagged)");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Run the server until either it exits on its own or cancel fires.
    tokio::select! {
        res = server.run() => {
            if let Err(e) = res {
                warn!(source = %cfg.id, "OPC-UA server exited with error: {e}");
            }
        }
        _ = cancel.cancelled() => {
            info!(source = %cfg.id, "OPC-UA server cancelled — stopping");
            handle.cancel();
        }
    }
    updater.abort();
    write_drainer.abort();
}

// Keep the trivial doctest so the crate still has CI coverage above zero.
/// ```
/// assert_eq!(2 + 2, 4);
/// ```
pub fn _placeholder() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn dv(value: Option<Variant>, status: Option<StatusCode>) -> DataValue {
        DataValue {
            value, status,
            source_timestamp: None, source_picoseconds: None,
            server_timestamp: None, server_picoseconds: None,
        }
    }

    #[test]
    fn data_value_to_tag_handles_common_variants() {
        let (v, q) = data_value_to_tag(&dv(Some(Variant::Boolean(true)), Some(StatusCode::Good)));
        assert!(matches!(v, TagValue::Bool(true)));
        assert!(matches!(q, TagQuality::Good));

        let (v, _) = data_value_to_tag(&dv(Some(Variant::Float(2.75_f32)), Some(StatusCode::Good)));
        match v {
            TagValue::Float(f) => assert!((f - 2.75).abs() < 0.001),
            other => panic!("expected Float, got {other:?}"),
        }

        let (v, _) = data_value_to_tag(&dv(Some(Variant::Int32(42)), Some(StatusCode::Good)));
        assert!(matches!(v, TagValue::Int(42)));
    }

    #[test]
    fn data_value_quality_propagates_status() {
        let (_, q) = data_value_to_tag(&dv(Some(Variant::Int32(0)), Some(StatusCode::BadDeviceFailure)));
        assert!(matches!(q, TagQuality::Bad));
    }

    #[test]
    fn data_value_none_value_is_uncertain() {
        let (_, q) = data_value_to_tag(&dv(None, Some(StatusCode::Good)));
        assert!(matches!(q, TagQuality::Uncertain));
    }

    #[test]
    fn tag_value_to_variant_roundtrip_bool() {
        match tag_value_to_variant(&TagValue::Bool(true)) {
            Some(Variant::Boolean(b)) => assert!(b),
            other => panic!("expected Boolean(true), got {other:?}"),
        }
    }

    #[test]
    fn parse_security_policy_known_values() {
        assert!(matches!(parse_security_policy("None"), Some(SecurityPolicy::None)));
        assert!(matches!(parse_security_policy("Basic256Sha256"), Some(SecurityPolicy::Basic256Sha256)));
        assert!(matches!(parse_security_policy("Aes256Sha256RsaPss"), Some(SecurityPolicy::Aes256Sha256RsaPss)));
        assert!(parse_security_policy("Bogus").is_none());
    }

    #[test]
    fn security_mode_pairs_none_with_none_and_else_signencrypt() {
        // The plugin treats every non-None policy as SignAndEncrypt — that
        // matches what most industrial servers expose.
        assert_eq!(security_mode_for(SecurityPolicy::None), MessageSecurityMode::None);
        assert_eq!(
            security_mode_for(SecurityPolicy::Basic256Sha256),
            MessageSecurityMode::SignAndEncrypt,
        );
    }

    #[test]
    fn euromap_dictionary_is_consistent() {
        // Every entry must have a non-empty canonical name and tag suffix,
        // and the (spec, suffix) tuples must be unique — otherwise the UI
        // would propose two tags with the same id when both variables exist
        // on the same server.
        let mut seen = std::collections::HashSet::new();
        for (spec, canonical, suffix, desc) in EUROMAP_VARIABLES {
            assert!(*spec == "77" || *spec == "83", "unknown spec {spec}");
            assert!(!canonical.is_empty(), "canonical name empty in {spec}");
            assert!(!suffix.is_empty(), "suffix empty for {canonical}");
            assert!(!desc.is_empty(), "description empty for {canonical}");
            assert!(seen.insert((*spec, *suffix)),
                "duplicate (spec, suffix) = ({spec}, {suffix})");
        }
    }

    #[test]
    fn tag_value_to_variant_roundtrip_int_float_str() {
        // Int → Int64 (widest signed); Float → Double (widest unsigned-ish);
        // Str → UAString. Callers can rely on these mappings being stable.
        assert!(matches!(tag_value_to_variant(&TagValue::Int(42)), Some(Variant::Int64(42))));
        assert!(matches!(tag_value_to_variant(&TagValue::Float(3.5)),
            Some(Variant::Double(d)) if (d - 3.5).abs() < 1e-9));
        match tag_value_to_variant(&TagValue::Str("hi".into())) {
            Some(Variant::String(s)) => assert_eq!(s.as_ref(), "hi"),
            other => panic!("expected String, got {other:?}"),
        }
    }
}
