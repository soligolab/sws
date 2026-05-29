//! Spawns and tears down source plugin tasks (Modbus TCP, MQTT) so that the
//! editor can reconfigure connections at runtime without restarting the process.
//!
//! Each `SourceDef` is mapped to one Tokio task plus a `CancellationToken`.
//! `reload(new_sources)` diffs the supervisor's current map against the new
//! list and:
//!   - stops sources whose id no longer appears,
//!   - stops + respawns sources whose config has changed (compared as JSON),
//!   - starts brand-new sources.
//!
//! Stopping a source unregisters all its tags from `TagWriteBus` so writes
//! to those tags fall back to the direct `TagDb` path (or 503 if the bus
//! was the only path).

use std::{collections::HashMap, sync::Arc};
use serde_json::Value as Json;
use sws_core::{SourceDef, TagDb, TagWriteBus};
use tokio::{sync::Mutex, task::JoinHandle};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

struct RunningSource {
    handle: JoinHandle<()>,
    cancel: CancellationToken,
    /// JSON-serialised config, used to detect "same id, different config".
    config_json: Json,
    /// Tag ids registered on the write bus for this source — released on stop.
    owned_tags: Vec<String>,
}

pub struct SourceSupervisor {
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    /// Base directory under which OPC-UA cert keypairs are persisted.
    /// The plugin appends `<source-id>/` so multiple OPC-UA sources keep
    /// distinct identities. Updated when a project opens/closes via
    /// `set_pki_root`.
    opcua_pki_root: tokio::sync::RwLock<std::path::PathBuf>,
    sources: Mutex<HashMap<String, RunningSource>>,
}

impl SourceSupervisor {
    pub fn new(db: Arc<TagDb>, bus: Arc<TagWriteBus>) -> Arc<Self> {
        Arc::new(Self {
            db,
            bus,
            opcua_pki_root: tokio::sync::RwLock::new(default_pki_root()),
            sources: Mutex::new(HashMap::new()),
        })
    }

    /// Set the PKI root used by the OPC-UA plugin's secure-channel
    /// keypairs. Called on every project open/close so the cert lives
    /// inside the project directory and travels with it.
    pub async fn set_pki_root(&self, root: std::path::PathBuf) {
        *self.opcua_pki_root.write().await = root;
    }

    /// Apply `desired` as the new source list. Returns the number of
    /// (started, stopped, replaced) sources for logging / metrics.
    pub async fn reload(self: &Arc<Self>, desired: Vec<SourceDef>) -> (usize, usize, usize) {
        let mut started = 0usize;
        let mut stopped = 0usize;
        let mut replaced = 0usize;

        // Index incoming by id so we can detect duplicates and look up quickly.
        let mut incoming: HashMap<String, SourceDef> = HashMap::new();
        for s in desired {
            let id = source_id(&s).to_string();
            incoming.insert(id, s);
        }

        // First pass: stop sources whose id is gone or whose config changed.
        // Collect ids+actions first to avoid holding the lock across awaits.
        let mut to_stop: Vec<String> = Vec::new();
        {
            let map = self.sources.lock().await;
            for (id, running) in map.iter() {
                match incoming.get(id) {
                    None => to_stop.push(id.clone()),
                    Some(new_def) => {
                        let new_json = serde_json::to_value(new_def).unwrap_or(Json::Null);
                        // Restart if config changed OR if the task has already exited
                        // (error/config-problem) — gives "retry on Save" semantics.
                        if new_json != running.config_json || running.handle.is_finished() {
                            to_stop.push(id.clone());
                        }
                    }
                }
            }
        }

        for id in &to_stop {
            self.stop_one(id).await;
            stopped += 1;
        }

        // Second pass: start anything missing.
        let to_start: Vec<SourceDef> = {
            let map = self.sources.lock().await;
            incoming
                .into_iter()
                .filter(|(id, _)| !map.contains_key(id))
                .map(|(_, def)| def)
                .collect()
        };

        for def in to_start {
            // If this was an "id stayed, config changed" case we just stopped
            // a copy with the same id — count it as replaced rather than started.
            let id = source_id(&def).to_string();
            let was_replacement = to_stop.iter().any(|x| x == &id);
            self.start_one(def).await;
            if was_replacement { replaced += 1; } else { started += 1; }
        }

        info!(started, stopped = stopped.saturating_sub(replaced), replaced,
              "source supervisor reload complete");
        (started, stopped.saturating_sub(replaced), replaced)
    }

    async fn start_one(self: &Arc<Self>, def: SourceDef) {
        let id = source_id(&def).to_string();
        let cancel = CancellationToken::new();
        let config_json = serde_json::to_value(&def).unwrap_or(Json::Null);
        let owned_tags = tags_of(&def);

        let db = self.db.clone();
        let bus = self.bus.clone();
        let cancel_for_task = cancel.clone();
        let id_for_log = id.clone();
        let handle = match def {
            SourceDef::ModbusTcp(cfg) => {
                info!(source = %id_for_log, "starting Modbus TCP task");
                tokio::spawn(async move {
                    sws_plugin_modbus::run(cfg, db, bus, cancel_for_task).await;
                })
            }
            SourceDef::ModbusRtu(cfg) => {
                info!(source = %id_for_log, device = %cfg.device, "starting Modbus RTU task");
                tokio::spawn(async move {
                    sws_plugin_modbus::run_rtu(cfg, db, bus, cancel_for_task).await;
                })
            }
            SourceDef::Mqtt(cfg) => {
                info!(source = %id_for_log, "starting MQTT task");
                tokio::spawn(async move {
                    sws_plugin_mqtt::run(cfg, db, bus, cancel_for_task).await;
                })
            }
            SourceDef::OpcUaServer(cfg) => {
                info!(source = %id_for_log, port = cfg.port, "starting OPC-UA server task");
                tokio::spawn(async move {
                    sws_plugin_opcua::run_server(cfg, db, bus, cancel_for_task).await;
                })
            }
            SourceDef::OpcUaClient(cfg) => {
                // The opcua plugin has no cancel hook yet (the reconnect
                // loop is self-driven); the cancel token is unused for now
                // but kept in the supervisor's API so future graceful-shutdown
                // work can wire it in one place.
                info!(source = %id_for_log, "starting OPC-UA client task");
                let _ = cancel_for_task;
                let pki = self.opcua_pki_root.read().await.clone();
                tokio::spawn(async move {
                    sws_plugin_opcua::run(cfg, db, bus, pki).await;
                })
            }
            SourceDef::HomeAssistant(cfg) => {
                info!(source = %id_for_log, url = %cfg.url, "starting HomeAssistant task");
                tokio::spawn(async move {
                    sws_plugin_homeassistant::run(cfg, db, bus, cancel_for_task).await;
                })
            }
            SourceDef::S7(cfg) => {
                info!(source = %id_for_log, ip = %cfg.ip, "starting S7 task");
                tokio::spawn(async move {
                    sws_plugin_s7::run(cfg, db, bus, cancel_for_task).await;
                })
            }
            SourceDef::EnIp(cfg) => {
                info!(source = %id_for_log, ip = %cfg.ip, "starting EtherNet/IP task");
                tokio::spawn(async move {
                    sws_plugin_enip::run(cfg, db, bus, cancel_for_task).await;
                })
            }
        };

        self.sources.lock().await.insert(
            id,
            RunningSource { handle, cancel, config_json, owned_tags },
        );
    }

    async fn stop_one(&self, id: &str) {
        let running = self.sources.lock().await.remove(id);
        let Some(running) = running else { return };
        info!(source = %id, "stopping source task");
        running.cancel.cancel();
        // Give the task a moment to finish gracefully; abort if it doesn't.
        match tokio::time::timeout(std::time::Duration::from_secs(2), running.handle).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => warn!(source = %id, "source task join error: {e}"),
            Err(_)     => warn!(source = %id, "source task did not stop within 2 s — abort/leak"),
        }
        // Release the tag routes on the write bus.
        if !running.owned_tags.is_empty() {
            self.bus.unregister_many(&running.owned_tags).await;
        }
    }

    /// Stop every running source. Useful at shutdown.
    pub async fn stop_all(&self) {
        let ids: Vec<String> = self.sources.lock().await.keys().cloned().collect();
        for id in ids {
            self.stop_one(&id).await;
        }
    }

    pub async fn running_count(&self) -> usize {
        self.sources.lock().await.len()
    }
}

fn source_id(s: &SourceDef) -> &str {
    match s {
        SourceDef::ModbusTcp(c)      => &c.id,
        SourceDef::ModbusRtu(c)      => &c.id,
        SourceDef::OpcUaServer(c)    => &c.id,
        SourceDef::Mqtt(c)           => &c.id,
        SourceDef::OpcUaClient(c)    => &c.id,
        SourceDef::HomeAssistant(c)  => &c.id,
        SourceDef::S7(c)             => &c.id,
        SourceDef::EnIp(c)           => &c.id,
    }
}

fn tags_of(s: &SourceDef) -> Vec<String> {
    match s {
        SourceDef::ModbusTcp(c)      => c.registers.iter().map(|r| r.tag.clone()).collect(),
        SourceDef::ModbusRtu(c)      => c.registers.iter().map(|r| r.tag.clone()).collect(),
        SourceDef::OpcUaServer(c)    => c.nodes.iter().map(|n| n.tag.clone()).collect(),
        SourceDef::Mqtt(c)           => c.topics.iter().map(|t| t.tag.clone()).collect(),
        SourceDef::OpcUaClient(c)    => c.nodes.iter().map(|n| n.tag.clone()).collect(),
        SourceDef::HomeAssistant(c)  => c.entities.iter().map(|e| e.tag.clone()).collect(),
        SourceDef::S7(c)             => c.tags.iter().map(|t| t.tag.clone()).collect(),
        SourceDef::EnIp(c)           => c.tags.iter().map(|t| t.tag.clone()).collect(),
    }
}

/// Fallback PKI root used until a project is opened. Living under the
/// process's temp dir means the keypair survives the runtime's lifetime
/// (a server's trust list isn't yet curated) but disappears on reboot —
/// fine for unattached/dev runs.
fn default_pki_root() -> std::path::PathBuf {
    std::env::temp_dir().join("sws-opcua-pki")
}
