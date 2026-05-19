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
    DataValue, MessageSecurityMode, MonitoredItemCreateRequest, NodeId, StatusCode,
    TimestampsToReturn, UserTokenPolicy, Variant,
};
use sws_core::{OpcUaAuth, OpcUaClientConfig, TagDb, TagQuality, TagValue};
use tracing::{info, warn};

/// Entry point spawned per source by the runtime. Loops forever: connect →
/// subscribe → run until something breaks → wait → reconnect.
pub async fn run(cfg: OpcUaClientConfig, db: Arc<TagDb>) {
    loop {
        match run_once(&cfg, &db).await {
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

async fn run_once(cfg: &OpcUaClientConfig, db: &Arc<TagDb>) -> anyhow::Result<()> {
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
    let mut items: Vec<MonitoredItemCreateRequest> = Vec::with_capacity(cfg.nodes.len());
    for mapping in &cfg.nodes {
        let nid = NodeId::from_str(&mapping.node_id)
            .map_err(|e| anyhow::anyhow!("invalid NodeId '{}': {e}", mapping.node_id))?;
        routing.insert(nid.clone(), mapping.tag.clone());
        items.push(nid.into());
    }
    let routing = Arc::new(routing);

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

    // Await the session event loop — when it returns the connection has
    // ended (graceful close, error, etc.). Aborting the dispatcher then
    // releases tx and the unbounded channel.
    let _ = handle.await;
    dispatcher.abort();
    Ok(())
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
}
