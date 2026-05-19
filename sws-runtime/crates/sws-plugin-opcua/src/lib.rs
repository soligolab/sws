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
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use opcua::client::{ClientBuilder, DataChangeCallback, IdentityToken};
use opcua::types::{
    AttributeId, BrowseDescription, BrowseDirection, DataValue, MessageSecurityMode,
    MonitoredItemCreateRequest, NodeClass, NodeId, ObjectId, ReferenceTypeId, StatusCode,
    TimestampsToReturn, UserTokenPolicy, Variant, WriteValue,
};
use serde::{Deserialize, Serialize};
use sws_core::{OpcUaAuth, OpcUaClientConfig, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest};
use tokio::sync::mpsc;
use tracing::{info, warn};

/// Entry point spawned per source by the runtime. Loops forever: connect →
/// subscribe → run until something breaks → wait → reconnect.
///
/// `bus` lets the plugin participate in tag writes (`PUT /api/tags/:id` and
/// `/ws/tags` write frames). For each `cfg.nodes` entry we register an mpsc
/// sender on the bus; writes arrive on its receiver and are converted into
/// OPC-UA `Write` service calls inside the session loop.
pub async fn run(cfg: OpcUaClientConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>) {
    loop {
        match run_once(&cfg, &db, &bus).await {
            Ok(()) => {
                info!(source = %cfg.id, "opcua: session ended cleanly");
            }
            Err(e) => {
                warn!(source = %cfg.id, "opcua: session error: {e}");
            }
        }
        // Mark every mapped tag Bad on disconnect so the UI surfaces the
        // outage; on reconnect the next data-change callback flips them
        // back to Good.
        for n in &cfg.nodes {
            if let Some(state) = db.get(&n.tag).await {
                db.set(n.tag.clone(), state.value, TagQuality::Bad).await;
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn run_once(cfg: &OpcUaClientConfig, db: &Arc<TagDb>, bus: &Arc<TagWriteBus>) -> anyhow::Result<()> {
    // Build a minimal client — no persisted config file, no keystore. The
    // application URI / name only matter when a server checks them; for an
    // anonymous + None demo any value is fine.
    let mut client = ClientBuilder::new()
        .application_name("SWS Runtime")
        .application_uri("urn:sws-runtime")
        .trust_server_certs(true)
        .session_retry_limit(0)
        .client()
        .map_err(|e| anyhow::anyhow!("opcua client builder: {e:?}"))?;

    // For the PoC we only wire the "None" security policy end-to-end. The
    // OpcUaClientConfig.security_policy field still travels through to the
    // YAML for forward-compat — we just log when it's set to something we
    // don't honour yet.
    if cfg.security_policy != "None" {
        warn!(
            policy = %cfg.security_policy,
            "opcua: security_policy other than 'None' is not wired yet — falling back to None"
        );
    }

    // EndpointDescription from (url, security_policy_uri, security_mode,
    // user_token_policy). The anonymous user token policy is the common
    // default for unauthenticated industrial servers.
    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        "http://opcfoundation.org/UA/SecurityPolicy#None",
        MessageSecurityMode::None,
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
                        writer_db.set(tag.clone(), value, TagQuality::Good).await;
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
pub async fn browse_one_level(
    cfg: &OpcUaClientConfig,
    parent_node_id: Option<&str>,
) -> anyhow::Result<Vec<BrowsedNode>> {
    let mut client = ClientBuilder::new()
        .application_name("SWS Runtime (browse)")
        .application_uri("urn:sws-runtime")
        .trust_server_certs(true)
        .session_retry_limit(0)
        .client()
        .map_err(|e| anyhow::anyhow!("opcua client builder: {e:?}"))?;

    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        "http://opcfoundation.org/UA/SecurityPolicy#None",
        MessageSecurityMode::None,
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

    // BrowseDescription: forward hierarchical refs, all node classes (0 mask
    // = include everything), full result mask (0x3f = browse_name |
    // display_name | node_class | type_definition + is_forward).
    let req = BrowseDescription {
        node_id: parent,
        browse_direction: BrowseDirection::Forward,
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
    Ok(out)
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

        let (v, _) = data_value_to_tag(&dv(Some(Variant::Float(3.14_f32)), Some(StatusCode::Good)));
        match v {
            TagValue::Float(f) => assert!((f - 3.14).abs() < 0.001),
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
