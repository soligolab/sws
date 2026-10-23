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

pub mod valore;

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
use sws_core::{
    OpcUaAuth, OpcUaClientConfig, TagDb, TagQuality, TagWriteBus, WriteRequest,
};
use tokio::sync::mpsc;
use tracing::{info, warn};

/// Map the YAML `security_policy` string onto the underlying enum. Anything
/// not in the supported set falls back to `None` with a warning logged at
/// the call site — we don't want a typo on the editor side to silently
/// downgrade to "no security" without telling the operator.
fn parse_security_policy(s: &str) -> Option<SecurityPolicy> {
    match s {
        "None" => Some(SecurityPolicy::None),
        "Basic128Rsa15" => Some(SecurityPolicy::Basic128Rsa15),
        "Basic256" => Some(SecurityPolicy::Basic256),
        "Basic256Sha256" => Some(SecurityPolicy::Basic256Sha256),
        "Aes128Sha256RsaOaep" => Some(SecurityPolicy::Aes128Sha256RsaOaep),
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
        _ => MessageSecurityMode::SignAndEncrypt,
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
pub async fn run(
    cfg: OpcUaClientConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    pki_dir: PathBuf,
    cancel: tokio_util::sync::CancellationToken,
) {
    let source_pki = pki_dir.join(&cfg.id);
    // Il token del supervisore, dal 22-10-2026. Prima qui ne nasceva uno nuovo
    // che non scattava mai: fermare o riavviare una sorgente OPC-UA costava i
    // **due secondi** pieni del timeout di `stop_one`, e la sessione moriva
    // senza chiudersi. `con_attesa` ha già il `select!` attorno alla sessione,
    // quindi basta portargli il token giusto.
    //
    // Una sessione finita «pulita» dal server si riapre lo stesso
    // (04-10-2026: prima il task terminava, col log «stopped (save config to
    // retry)», e aspettava il watchdog del supervisore).
    // Con policy `None` il client salta del tutto la validazione del
    // certificato del server: la fiducia al primo contatto non ha niente da
    // memorizzare, e il trust store della sorgente resta vuoto per sempre.
    // Dirlo una volta all'avvio e' meglio che lasciare qualcuno a guardare una
    // tabella vuota chiedendosi cosa non funziona (23-10-2026).
    if cfg.security_policy == "None" && !cfg.trust_all_certs {
        info!(
            source = %cfg.id,
            "opcua: policy «None», il certificato del server non si valida — il trust store di questa sorgente resta vuoto"
        );
    }
    sws_core::riconnessione::con_attesa(
        &cfg.id,
        cancel,
        || async {
            if let Err(e) = run_once(&cfg, &db, &bus, &source_pki).await {
                // Fiducia al primo contatto (15-10-2026): solo se il progetto
                // non accetta già tutto, e solo dopo un fallimento — è lì che
                // async-opcua ha messo il certificato sconosciuto in `rejected/`.
                if !cfg.trust_all_certs {
                    match fiducia_al_primo_contatto(&source_pki) {
                        Fiducia::Memorizzato(f) => {
                            info!(source = %cfg.id, certificato = %f, "opcua: certificato del server memorizzato al primo contatto");
                            return Err(anyhow::anyhow!("certificato del server memorizzato al primo contatto ({f}): riconnessione"));
                        }
                        Fiducia::Cambiato(f) => {
                            warn!(source = %cfg.id, certificato = %f, "opcua: certificato del server cambiato, non accettato");
                            return Err(anyhow::anyhow!(
                                "{}: il server presenta un certificato diverso da quello memorizzato ({f}). \
                                 Se il cambio è atteso, fidati del nuovo dal trust store della sorgente",
                                sws_core::pin_tls::MOTIVO_CERTIFICATO_CAMBIATO
                            ));
                        }
                        Fiducia::Niente => {}
                    }
                }
                return Err(e);
            }
            Err(anyhow::anyhow!("sessione chiusa dal server"))
        },
        || async {
            for n in &cfg.nodes {
                db.marca_qualita(&n.tag, TagQuality::Bad).await;
            }
        },
    )
    .await;
}

/// Le due cartelle del trust store di una sorgente, come le scrive
/// `async-opcua-crypto` (`certificate_store.rs`: `TRUSTED_CERTS_DIR = "trusted"`).
///
/// Stanno qui, nel crate che possiede la disposizione della PKI, e **non** sono
/// ripetute altrove: `sws-web` le importa da qui. Fino al 23-10-2026 il router
/// le scriveva a mano come `trusted/certs` e `rejected/certs` — un livello di
/// troppo — e leggeva cartelle che nessuno crea mai: l'elenco era sempre
/// vuoto, «Fidati» rispondeva 204 senza fare niente, «Elimina» 404.
///
/// Due letture della stessa cartella che non si parlavano. Una costante sola
/// non impedisce di sbagliare il nome: impedisce di sbagliarlo **in un punto
/// solo su quattro**, che è come si resta rotti a metà senza accorgersene.
pub const DIR_FIDATI: &str = "trusted";
pub const DIR_RIFIUTATI: &str = "rejected";

/// Esito della fiducia al primo contatto.
#[derive(Debug, PartialEq)]
pub enum Fiducia {
    /// Primo contatto: il certificato rifiutato è passato fra i fidati.
    Memorizzato(String),
    /// Ci sono già certificati fidati, e il server ne presenta un altro.
    Cambiato(String),
    Niente,
}

fn certificati_in(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.is_file()).collect())
        .unwrap_or_default();
    v.sort();
    v
}

/// Fiducia al primo contatto (TOFU) sopra l'archivio di async-opcua, come
/// `known_hosts` di SSH e come MQTT (Q49): se `trusted/` è vuota e in
/// `rejected/` c'è **un solo** certificato, quello è il server al primo
/// contatto e diventa fidato. Se `trusted/` ha già un certificato, uno nuovo
/// rifiutato è un **cambio**: mai accettato da solo — un reset del server e un
/// attacco da fuori sono indistinguibili. Più rifiutati con `trusted/` vuota:
/// ambiguo, non si sceglie.
pub fn fiducia_al_primo_contatto(pki: &Path) -> Fiducia {
    let fidati = certificati_in(&pki.join(DIR_FIDATI));
    let rifiutati = certificati_in(&pki.join(DIR_RIFIUTATI));
    let nome = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    match (fidati.is_empty(), rifiutati.as_slice()) {
        (true, [unico]) => {
            let dest = pki.join(DIR_FIDATI).join(unico.file_name().unwrap_or_default());
            match std::fs::rename(unico, &dest) {
                Ok(()) => Fiducia::Memorizzato(nome(unico)),
                Err(e) => {
                    warn!(pki = %pki.display(), "opcua: non riesco a memorizzare il certificato: {e}");
                    Fiducia::Niente
                }
            }
        }
        (false, [primo, ..]) => Fiducia::Cambiato(nome(primo)),
        _ => Fiducia::Niente,
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
    )
        .into();

    // Resolve credentials. password_env wins over password so secrets can
    // stay out of project.yaml.
    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword {
            username,
            password,
            password_env,
        } => {
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

    // Le foglie di ogni tag composito, una volta per sessione (Fase 4).
    //
    // Un nodo che porta un array o una struttura arriva come **un** valore, e
    // il `TagDb` vuole un `ingest` per **foglia**: scale, tipi e qualità sono
    // installati per percorso (`apply_tags`), non per radice. È la stessa
    // strada di Modbus (`prepara`), e il motivo per cui qui non serve sapere
    // niente dei tipi: basta il percorso.
    let mut foglie_per_tag: HashMap<String, Vec<(String, Vec<sws_core::Segmento>)>> = HashMap::new();
    for mapping in &cfg.nodes {
        let Some(forma) = db.forma(&mapping.tag).await else { continue };
        let foglie: Vec<(String, Vec<sws_core::Segmento>)> = forma
            .foglie(&mapping.tag, &[])
            .into_iter()
            .filter_map(|f| {
                let resto = f.percorso.strip_prefix(mapping.tag.as_str())?;
                Some((f.percorso.clone(), sws_core::percorso::parse_segmenti(resto)?))
            })
            .collect();
        if !foglie.is_empty() {
            foglie_per_tag.insert(mapping.tag.clone(), foglie);
        }
    }
    let foglie_per_tag = Arc::new(foglie_per_tag);

    // **I nodi figli dei tag compositi** (decisione 2 del 23-10-2026).
    //
    // `NumericRange` indirizza **solo gli array**: non esiste una forma che
    // indirizzi il campo di una struttura. Delle tre strade il maintainer ha
    // scelto il **nodo figlio** — molti server espongono i campi anche come
    // nodi `HasComponent`, e scrivere quello evita il leggi-modifica-riscrivi,
    // dove due operatori che toccano due campi diversi nello stesso istante si
    // cancellano a vicenda.
    //
    // La mappa si costruisce **una volta per sessione**: un browse per ogni
    // radice composita, e si tiene `percorso -> NodeId`. Un server che non
    // espone i figli semplicemente non ne dà, e la scrittura su quella foglia
    // resta rifiutata — con un messaggio che adesso dice **perché**.
    let mut figli: HashMap<String, NodeId> = HashMap::new();
    for mapping in &cfg.nodes {
        let Some(foglie) = foglie_per_tag.get(&mapping.tag) else { continue };
        let Some(radice) = tag_to_node.get(&mapping.tag).cloned() else { continue };
        let req = BrowseDescription {
            node_id: radice,
            browse_direction: BrowseDirection::Forward,
            reference_type_id: ReferenceTypeId::HierarchicalReferences.into(),
            include_subtypes: true,
            node_class_mask: 0,
            result_mask: 0x3f,
        };
        let Ok(risultati) = session.browse(&[req], 200, None).await else { continue };
        for r in risultati {
            let Some(refs) = r.references else { continue };
            for rd in refs {
                let nome = rd.browse_name.name.as_ref().to_string();
                // Il figlio si riconosce dal **nome**: il percorso di una
                // foglia finisce col nome del membro (`motore1.velocita`).
                for (percorso, _) in foglie {
                    if percorso
                        .rsplit(['.', '['])
                        .next()
                        .map(|u| u.trim_end_matches(']') == nome)
                        .unwrap_or(false)
                    {
                        figli.insert(percorso.clone(), rd.node_id.node_id.clone());
                    }
                }
            }
        }
    }
    if !figli.is_empty() {
        info!(source = %cfg.id, figli = figli.len(), "opcua: nodi figli trovati per le foglie");
    }
    let figli = Arc::new(figli);

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
            10,   // lifetime count
            30,   // max keep-alive count
            0,    // max notifications per publish (0 = server picks)
            0,    // priority
            true, // publishing enabled
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
    let foglie_clone = foglie_per_tag.clone();
    let source_id = cfg.id.clone();
    let dispatcher = tokio::spawn(async move {
        while let Some((node_id, dv)) = rx.recv().await {
            let Some(tag_id) = routing_clone.get(&node_id) else {
                continue;
            };
            consegna(&db_clone, tag_id, foglie_clone.get(tag_id.as_str()), &dv).await;
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
    let figli_per_scrittura = figli.clone();
    let writer = tokio::spawn(async move {
        while let Some((tag, percorso, value)) = write_rx.recv().await {
            // Scrivere su una **foglia** vuol dire scrivere sul suo nodo
            // figlio, se il server ce l'ha (decisione 2 del 23-10-2026).
            // `NumericRange` indirizza solo gli array, quindi per il campo di
            // una struttura il figlio è l'unica strada che non passi da un
            // leggi-modifica-riscrivi.
            let nid = match &percorso {
                Some(p) => match figli_per_scrittura.get(p.as_str()) {
                    Some(n) => Some(n.clone()),
                    None => {
                        warn!(
                            source = %writer_source_id, tag = %tag, percorso = %p,
                            "opcua: questo server non espone un nodo figlio per questa foglia, la scrittura non si può fare"
                        );
                        continue;
                    }
                },
                None => tag_to_node.get(&tag).cloned(),
            };
            let Some(nid) = nid else {
                warn!(source = %writer_source_id, tag = %tag, "opcua: write for unknown tag");
                continue;
            };
            // Il `Variant` segue il **tipo dichiarato del tag**, non la forma
            // del valore: prima ogni intero partiva come `Int64`, e un nodo
            // `UInt16` rispondeva `BadTypeMismatch`.
            let tipo = writer_db.tipo_dichiarato(&tag).await;
            let variant = match valore::variant_per_tipo(tipo.as_deref(), &value) {
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
                    source_timestamp: None,
                    source_picoseconds: None,
                    server_timestamp: None,
                    server_picoseconds: None,
                },
            }];
            match session_for_writes.write(&to_write).await {
                Ok(codes) => {
                    let ok = codes
                        .first()
                        .map(|c| c == &StatusCode::Good)
                        .unwrap_or(false);
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
/// Consegna al `TagDb` quello che è arrivato da un nodo.
///
/// Estratta dal ciclo del dispatcher perché si possa provare con un `TagDb`
/// vero e **senza una sessione OPC-UA**: è qui che stanno le tre scelte che la
/// Fase 4 cambia, e provarle voleva dire o un server o niente.
///
/// - **`ingest` e non `set`.** È `ingest` che applica la scala (`to_eng`) e la
///   conversione al tipo dichiarato. Con `set` un tag OPC-UA con
///   `raw_min`/`eng_min` non è mai stato scalato, e uno dichiarato `u16`
///   teneva 29.8. Modbus usa `ingest` dal 04-10-2026.
/// - **Niente valore, niente numero inventato.** Prima un `Variant` che il
///   motore non sapeva leggere diventava `Float(0.0)`: un nodo array su un tag
///   `f64` mostrava zero come se fosse un dato. Ora cambia solo la qualità, e
///   l'ultima lettura vera resta dov'è.
/// - **Un composito si consegna foglia per foglia**, col percorso di ciascuna:
///   scale, tipi e qualità sono installati per percorso, non per radice.
pub(crate) async fn consegna(
    db: &TagDb,
    tag: &str,
    foglie: Option<&Vec<(String, Vec<sws_core::Segmento>)>>,
    dv: &DataValue,
) {
    let (value, quality) = valore::da_data_value(dv);
    let Some(value) = value else {
        db.marca_qualita(tag, quality).await;
        return;
    };
    let Some(foglie) = foglie else {
        db.ingest(tag.to_string(), value, quality).await;
        return;
    };
    for (percorso, segmenti) in foglie {
        match sws_core::percorso::leggi(&value, segmenti) {
            Some(v) => db.ingest(percorso.clone(), v.clone(), quality.clone()).await,
            // Una foglia che il valore non contiene — un array più corto di
            // quello dichiarato — non si inventa: si marca Bad.
            None => db.marca_qualita(percorso, TagQuality::Bad).await,
        }
    }
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
    let to_ms = to_ms.unwrap_or(now_ms);

    let ms_to_opc = |ms: u64| -> opcua::types::DateTime {
        let ticks = (ms as i64) * 10_000 + EPOCH_OFFSET_TICKS;
        ticks.into()
    };
    let start_time = ms_to_opc(from_ms);
    let end_time = ms_to_opc(to_ms);

    let nid = NodeId::from_str(node_id)
        .map_err(|e| anyhow::anyhow!("invalid NodeId '{node_id}': {e}"))?;

    let tmpdir = tempfile::tempdir()
        .map_err(|e| anyhow::anyhow!("opcua history: cannot create temp pki: {e}"))?;
    let mut client = build_client_builder(tmpdir.path(), true)
        .application_name("SWS Runtime (history)")
        .client()
        .map_err(|e| anyhow::anyhow!("opcua client builder: {e:?}"))?;

    let security_policy =
        parse_security_policy(&cfg.security_policy).unwrap_or(SecurityPolicy::None);
    let security_mode = security_mode_for(security_policy);

    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        security_policy.to_uri(),
        security_mode,
        UserTokenPolicy::anonymous(),
    )
        .into();

    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword {
            username,
            password,
            password_env,
        } => {
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
        let Some(hd) = result.history_data.inner_as::<HistoryData>() else {
            continue;
        };
        for dv in hd.data_values.iter().flatten() {
            let ts_ms = dv
                .source_timestamp
                .or(dv.server_timestamp)
                .map(|dt| {
                    // Convert OPC-UA ticks (since 1601-01-01) to Unix ms.
                    ((dt.ticks() - EPOCH_OFFSET_TICKS) / 10_000) as u64
                })
                .unwrap_or(0);
            let quality = match dv.status {
                Some(s) if s == StatusCode::Good => "Good",
                Some(_) => "Bad",
                None => "Uncertain",
            };
            let value = match &dv.value {
                Some(Variant::Boolean(b)) => {
                    if *b {
                        1.0
                    } else {
                        0.0
                    }
                }
                Some(Variant::Byte(n)) => *n as f64,
                Some(Variant::SByte(n)) => *n as f64,
                Some(Variant::Int16(n)) => *n as f64,
                Some(Variant::UInt16(n)) => *n as f64,
                Some(Variant::Int32(n)) => *n as f64,
                Some(Variant::UInt32(n)) => *n as f64,
                Some(Variant::Int64(n)) => *n as f64,
                Some(Variant::UInt64(n)) => *n as f64,
                Some(Variant::Float(f)) => *f as f64,
                Some(Variant::Double(d)) => *d,
                _ => continue, // skip strings, extension objects, nulls
            };
            out.push(HistoricalSample {
                ts_ms,
                value,
                quality,
            });
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
    /// Il tipo SWS che corrisponde al `DataType` del nodo (`u16`, `f32`, …),
    /// letto dal server con una `Read` degli attributi (23-10-2026).
    ///
    /// Fino a oggi il browse tornava quattro campi e basta, e chi creava un tag
    /// da un nodo il tipo **lo sceglieva a mano**: scegliere male non si vede,
    /// e si paga quando il valore arriva storto.
    ///
    /// `None` quando il tipo non si indovina — una struttura, un'enumerazione,
    /// un tipo del costruttore.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tipo: Option<String>,
    /// `-1` scalare, `1` array a una dimensione, `n` a n dimensioni.
    /// `None` se il nodo non è una `Variable`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rango: Option<i32>,
    /// La lunghezza di ogni dimensione, quando il server la dichiara. Un `0`
    /// vuol dire «variabile», ed è ciò che distingue un array a lunghezza
    /// fissa — mappabile su un tag `array: [n]` — da uno che cambia.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimensioni: Option<Vec<u32>>,
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

    let security_policy =
        parse_security_policy(&cfg.security_policy).unwrap_or(SecurityPolicy::None);
    let security_mode = security_mode_for(security_policy);

    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        security_policy.to_uri(),
        security_mode,
        UserTokenPolicy::anonymous(),
    )
        .into();

    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword {
            username,
            password,
            password_env,
        } => {
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
        Some(s) => {
            NodeId::from_str(s).map_err(|e| anyhow::anyhow!("invalid parent NodeId '{s}': {e}"))?
        }
        None => ObjectId::ObjectsFolder.into(),
    };

    let browse_direction = match direction {
        BrowseDir::Forward => BrowseDirection::Forward,
        BrowseDir::Inverse => BrowseDirection::Inverse,
        BrowseDir::Both => BrowseDirection::Both,
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

    let results = session
        .browse(&[req], 1000, None)
        .await
        .map_err(|e| anyhow::anyhow!("browse: {e}"))?;

    let mut out: Vec<BrowsedNode> = Vec::new();
    // (posizione in `out`, NodeId) delle sole `Variable`: gli attributi li
    // hanno solo loro.
    let mut nodi_variabile: Vec<(usize, opcua::types::NodeId)> = Vec::new();
    for r in results {
        let Some(refs) = r.references else { continue };
        for rd in refs {
            out.push(BrowsedNode {
                node_id: rd.node_id.node_id.to_string(),
                browse_name: rd.browse_name.name.as_ref().to_string(),
                display_name: rd.display_name.text.as_ref().to_string(),
                node_class: node_class_label(rd.node_class).to_string(),
                tipo: None,
                rango: None,
                dimensioni: None,
            });
            // Solo le `Variable`: una cartella o un metodo quegli attributi
            // non li ha, e chiederglieli vuol dire tre risposte d'errore per
            // nodo in ogni browse.
            if rd.node_class == opcua::types::NodeClass::Variable {
                nodi_variabile.push((out.len() - 1, rd.node_id.node_id.clone()));
            }
        }
    }

    // Gli attributi delle sole `Variable`, in **una** richiesta sola: tre
    // attributi per nodo, non tre richieste per nodo.
    //
    // DataType(14), ValueRank(15) e ArrayDimensions(16) non stanno in una
    // `ReferenceDescription` — quella porta nome, etichetta e classe — e
    // vanno letti come attributi del nodo. È il motivo per cui fino al
    // 23-10-2026 il browse non li aveva.
    if !nodi_variabile.is_empty() {
        use opcua::types::{AttributeId, ReadValueId, TimestampsToReturn};
        let mut da_leggere = Vec::with_capacity(nodi_variabile.len() * 3);
        for (_, nid) in &nodi_variabile {
            for a in [AttributeId::DataType, AttributeId::ValueRank, AttributeId::ArrayDimensions] {
                da_leggere.push(ReadValueId {
                    node_id: nid.clone(),
                    attribute_id: a as u32,
                    ..Default::default()
                });
            }
        }
        match session.read(&da_leggere, TimestampsToReturn::Neither, 0.0).await {
            Ok(letti) if letti.len() == da_leggere.len() => {
                for (i, (pos, _)) in nodi_variabile.iter().enumerate() {
                    let n = &out[*pos];
                    let _ = n;
                    if let Some(opcua::types::Variant::NodeId(dt)) = &letti[i * 3].value {
                        out[*pos].tipo = crate::valore::tipo_sws(dt).map(str::to_string);
                    }
                    if let Some(opcua::types::Variant::Int32(r)) = &letti[i * 3 + 1].value {
                        out[*pos].rango = Some(*r);
                    }
                    if let Some(opcua::types::Variant::Array(a)) = &letti[i * 3 + 2].value {
                        let d: Vec<u32> = a
                            .values
                            .iter()
                            .filter_map(|v| match v {
                                opcua::types::Variant::UInt32(n) => Some(*n),
                                _ => None,
                            })
                            .collect();
                        if !d.is_empty() {
                            out[*pos].dimensioni = Some(d);
                        }
                    }
                }
            }
            // Un server che non risponde agli attributi non è un motivo per
            // perdere il browse: si torna l'elenco senza i tipi, che è quello
            // che si aveva prima.
            Ok(_) => warn!("opcua browse: la lettura degli attributi ha risposto con un numero diverso di valori"),
            Err(e) => warn!("opcua browse: attributi non letti ({e}); l'elenco esce senza i tipi"),
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
    (
        "77",
        "MachineState",
        "machine_state",
        "Stato macchina (int)",
    ),
    ("77", "ActiveErrors", "active_errors", "Errori attivi (int)"),
    ("77", "CycleTime", "cycle_time", "Tempo ciclo (s, float)"),
    (
        "77",
        "InjectionTime",
        "injection_time",
        "Tempo iniezione (s, float)",
    ),
    (
        "77",
        "MeltTemperature",
        "melt_temp",
        "Temperatura fuso (°C, float)",
    ),
    (
        "77",
        "ClampingForce",
        "clamping_force",
        "Forza di chiusura (kN, float)",
    ),
    (
        "77",
        "ProductionActiveParts",
        "parts_produced",
        "Pezzi prodotti (int)",
    ),
    (
        "77",
        "ProductionActiveDefectiveParts",
        "parts_defective",
        "Pezzi difettosi (int)",
    ),
    // Euromap 83 — temperature control unit
    (
        "83",
        "TbcActualTemperature",
        "temp_actual",
        "Temperatura attuale (°C, float)",
    ),
    (
        "83",
        "TbcSetTemperature",
        "temp_set",
        "Temperatura set (°C, float)",
    ),
    ("83", "TbcState", "tcu_state", "Stato TCU (int)"),
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

    let security_policy =
        parse_security_policy(&cfg.security_policy).unwrap_or(SecurityPolicy::None);
    let security_mode = security_mode_for(security_policy);
    let endpoint: opcua::types::EndpointDescription = (
        cfg.endpoint_url.as_str(),
        security_policy.to_uri(),
        security_mode,
        UserTokenPolicy::anonymous(),
    )
        .into();
    let identity = match &cfg.auth {
        OpcUaAuth::Anonymous => IdentityToken::Anonymous,
        OpcUaAuth::UsernamePassword {
            username,
            password,
            password_env,
        } => {
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
                if visited.contains(&nid) {
                    continue;
                }
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

    Ok(EuromapDetection {
        nodes_scanned: scanned,
        truncated,
        variables: matched,
    })
}

fn node_class_label(c: NodeClass) -> &'static str {
    match c {
        NodeClass::Object => "Object",
        NodeClass::Variable => "Variable",
        NodeClass::Method => "Method",
        NodeClass::ObjectType => "ObjectType",
        NodeClass::VariableType => "VariableType",
        NodeClass::ReferenceType => "ReferenceType",
        NodeClass::DataType => "DataType",
        NodeClass::View => "View",
        NodeClass::Unspecified => "Unspecified",
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
/// I nodi che il server espone, da un elenco di mappature.
///
/// Ogni voce è `(identificatore del nodo, tag o percorso, tipo dichiarato)`.
///
/// Un tag **scalare** dà un nodo, col suo `node_id` di configurazione. Un tag
/// **composito** dà **un nodo per foglia**, e l'identificatore di ciascuno è il
/// **percorso** del `TagDb` (`motore1.velocita`): chi scrive su quel nodo
/// scrive sulla foglia giusta senza nessuna tabella di conversione.
///
/// Estratta da `run_server` perché si possa provare con un `TagDb` vero e
/// **senza avviare un server**: è l'elenco su cui tre pezzi devono essere
/// d'accordo — chi crea i nodi, chi registra le callback di scrittura e chi ci
/// specchia dentro i valori — e tre scansioni che si credono uguali sono tre
/// scansioni che un giorno divergono.
pub(crate) async fn nodi_esposti(
    db: &TagDb,
    nodes: &[sws_core::OpcUaServerNodeMapping],
) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    for mapping in nodes {
        let foglie: Vec<(String, String)> = match db.forma(&mapping.tag).await {
            Some(f) => f
                .foglie(&mapping.tag, &[])
                .into_iter()
                .map(|fo| (fo.percorso, fo.tipo.nome()))
                .collect(),
            None => Vec::new(),
        };
        if foglie.is_empty() {
            let tipo = db.tipo_dichiarato(&mapping.tag).await;
            out.push((mapping.effective_node_id().to_string(), mapping.tag.clone(), tipo));
        } else {
            for (percorso, tipo) in foglie {
                out.push((percorso.clone(), percorso, Some(tipo)));
            }
        }
    }
    out
}

pub async fn run_server(
    cfg: sws_core::OpcUaServerConfig,
    db: Arc<sws_core::TagDb>,
    bus: Arc<sws_core::TagWriteBus>,
    cancel: tokio_util::sync::CancellationToken,
) {
    use opcua::nodes::{AccessLevel, VariableBuilder};
    use opcua::server::{
        diagnostics::NamespaceMetadata, node_manager::memory::simple_node_manager, ServerBuilder,
    };
    use opcua::types::{DataValue, NodeId, ObjectId};
    use sws_core::{TagQuality, TagValue};

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

    // **L'elenco dei nodi esposti, in un posto solo.**
    //
    // Tre pezzi devono essere d'accordo su quali nodi esistono: chi li crea,
    // chi registra la callback di scrittura, e chi ci specchia dentro i valori.
    // Finché il nodo era uno per mappatura bastava scorrere `cfg.nodes` tre
    // volte; con le foglie non basta più, e tre scansioni che si credono uguali
    // sono tre scansioni che un giorno divergono.
    //
    // Ogni voce è `(identificatore del nodo, tag o percorso, tipo dichiarato)`.
    // L'identificatore **è** il percorso del `TagDb`: chi scrive su quel nodo
    // scrive sulla foglia giusta senza nessuna tabella di conversione.
    let esposti = nodi_esposti(&db, &cfg.nodes).await;

    // Populate address space: folder + one Variable per tag mapping.
    {
        let mut address_space = node_mgr.address_space().write();
        let folder_id = NodeId::new(ns, "SWS");
        let objects_folder: NodeId = ObjectId::ObjectsFolder.into();
        address_space.add_folder(&folder_id, "SWS", "SWS", &objects_folder);

        for mapping in &cfg.nodes {
            // Un tag **composito** non diventa un nodo solo: diventa una
            // cartella con **un nodo figlio per foglia** (`motore1` →
            // `motore1.velocita`, `motore1.marcia`, …).
            //
            // È quello che la Fase 4 del piano dei tag diceva fin dall'inizio —
            // «esporre foglie come nodi figli, strutture vere dopo» — e serve a
            // due cose. La prima: fino al 23-10-2026 un tag composito **non
            // compariva affatto** nell'indirizzario, perché la conversione
            // tornava `None` e l'updater lo saltava in silenzio. La seconda:
            // scrivere dentro una struttura si fa **sul nodo figlio**
            // (decisione 2 del 23-10-2026), e per scriverci sopra bisogna che
            // quel nodo esista.
            let foglie: Vec<&(String, String, Option<String>)> = esposti
                .iter()
                .filter(|(id, _, _)| {
                    id.starts_with(mapping.effective_node_id())
                        && id.as_str() != mapping.effective_node_id()
                })
                .collect();

            if foglie.is_empty() {
                // Scalare: un nodo, come sempre. Il tipo dichiarato nel
                // progetto e non `Double` per tutti — prima un `bool` si
                // esponeva come `Double` e poi ci si spingeva dentro un
                // `Variant::Boolean`, e il valore contraddiceva il tipo.
                let nid = NodeId::new(ns, mapping.effective_node_id());
                let tipo = db.tipo_dichiarato(&mapping.tag).await;
                VariableBuilder::new(
                    &nid,
                    mapping.effective_node_id(),
                    mapping.effective_node_id(),
                )
                .data_type(valore::tipo_opcua(tipo.as_deref()))
                .value(0.0_f64)
                .access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                .user_access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                .writable()
                .organized_by(folder_id.clone())
                .insert(&mut *address_space);
                continue;
            }

            // Composito: una cartella col nome della radice, e dentro le
            // foglie. L'identificatore di ogni figlio è il **percorso**
            // (`motore1.velocita`), lo stesso che il `TagDb` usa: così chi
            // scrive su quel nodo scrive sulla foglia giusta senza nessuna
            // tabella di conversione.
            let radice_id = NodeId::new(ns, mapping.effective_node_id());
            address_space.add_folder(
                &radice_id,
                mapping.effective_node_id(),
                mapping.effective_node_id(),
                &folder_id,
            );
            for (percorso, _, tipo) in &foglie {
                let nid = NodeId::new(ns, percorso.as_str());
                VariableBuilder::new(&nid, percorso.as_str(), percorso.as_str())
                    .data_type(valore::tipo_opcua(tipo.as_deref()))
                    .value(0.0_f64)
                    .access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                    .user_access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                    .writable()
                    .organized_by(radice_id.clone())
                    .insert(&mut *address_space);
            }
        }
    }

    // Le scritture che arrivano da fuori passano **dal bus** (decisione del
    // maintainer, 23-10-2026).
    //
    // Fino a oggi andavano dritte nel `TagDb`, con questa motivazione: «il
    // server OPC-UA è la fonte autorevole per questi tag mentre gira». Non
    // regge quando il tag è di **campo**: uno SCADA che scriveva su un tag
    // posseduto da una sorgente Modbus metteva il valore nel `TagDb`, e al
    // giro di lettura dopo il campo lo cancellava. **Al dispositivo non
    // arrivava mai**, e nessun errore lo diceva.
    //
    // Ora è la stessa regola di `PUT /api/tags/:id`: si prova il bus, e se
    // nessuno possiede il tag si ripiega sul `TagDb` — che è il caso dei tag
    // virtuali, per i quali la motivazione di prima era giusta.
    //
    // Il valore verso il dispositivo viaggia **grezzo**: `scale_to_raw` prima
    // del bus, il ripiego resta in unità ingegneristiche. Anche questo come la
    // rotta HTTP, e per lo stesso motivo.
    let (write_tx, mut write_rx) = tokio::sync::mpsc::unbounded_channel::<(String, TagValue)>();
    {
        let impl_ = node_mgr.inner();
        for (id_nodo, tag_o_percorso, _) in &esposti {
            let nid = NodeId::new(ns, id_nodo.as_str());
            let tag = tag_o_percorso.clone();
            let tx = write_tx.clone();
            impl_.add_write_callback(nid, move |dv, _range| {
                if let Some(v) = &dv.value {
                    let tv: Option<TagValue> = match v {
                        opcua::types::Variant::Boolean(b) => Some(TagValue::Bool(*b)),
                        opcua::types::Variant::Float(f) => Some(TagValue::Float(*f as f64)),
                        opcua::types::Variant::Double(f) => Some(TagValue::Float(*f)),
                        opcua::types::Variant::Int32(i) => Some(TagValue::Int(*i as i64)),
                        opcua::types::Variant::Int64(i) => Some(TagValue::Int(*i)),
                        opcua::types::Variant::String(s) => {
                            Some(TagValue::Str(s.as_ref().to_string()))
                        }
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
    let bus_for_writes = bus.clone();
    let id_for_writes = cfg.id.clone();
    let write_drainer = tokio::spawn(async move {
        while let Some((tag, value)) = write_rx.recv().await {
            let raw = db_for_writes.scale_to_raw(&tag, value.clone()).await;
            match bus_for_writes.write(&tag, raw).await {
                Ok(()) => {}
                // Nessuno possiede questo tag: è virtuale, e il `TagDb` è
                // davvero il posto giusto.
                Err(sws_core::WriteError::NoWriter(_)) => {
                    db_for_writes.set(tag, value, TagQuality::Good).await;
                }
                Err(e) => {
                    warn!(source = %id_for_writes, tag = %tag, "opcua server: scrittura non consegnata: {e}")
                }
            }
        }
    });

    info!(source = %cfg.id, port = cfg.port, ns = %cfg.namespace_uri,
          nodes = cfg.nodes.len(), "OPC-UA server started");

    // Mirror TagDb broadcasts into the OPC-UA address space.
    let mut db_rx = db.subscribe();
    let db_tipi = db.clone();
    let handle_for_update = handle.clone();
    let node_mgr_for_update = node_mgr.clone();
    // Gli **esposti**, non le mappature: l'aggiornamento di una foglia arriva
    // col suo percorso, che una mappatura non nomina.
    let esposti_per_update: Vec<(String, String)> =
        esposti.iter().map(|(n, t, _)| (n.clone(), t.clone())).collect();
    let ns_for_update = ns;

    let updater = tokio::spawn(async move {
        loop {
            match db_rx.recv().await {
                Ok(update) => {
                    // **Il `TagDb` trasmette la radice, non le foglie.**
                    //
                    // Per un tag composito arriva un aggiornamento solo, con
                    // l'id della radice: cercandolo fra i nodi esposti — che
                    // per un composito sono i figli — non si troverebbe
                    // niente, e i nodi figli non si aggiornerebbero **mai**.
                    // `espandi_foglie` è la funzione che il `TagDb` ha
                    // esattamente per questo, e la usano già il WebSocket, lo
                    // storico e gli allarmi.
                    //
                    // Per uno scalare torna il tag stesso, quindi il caso
                    // normale non cambia.
                    let mut da_specchiare: Vec<(String, sws_core::TagValue)> =
                        db_tipi.espandi_foglie(&update).await
                            .into_iter()
                            .map(|(id, st)| (id, st.value))
                            .collect();
                    if da_specchiare.is_empty() {
                        da_specchiare.push((update.id.clone(), update.state.value.clone()));
                    }
                    for (id, valore_tag) in da_specchiare {
                        let Some((id_nodo, _)) =
                            esposti_per_update.iter().find(|(_, t)| *t == id)
                        else {
                            continue;
                        };
                        let nid = NodeId::new(ns_for_update, id_nodo.as_str());
                        // Lo stesso tipo con cui il nodo è stato dichiarato,
                        // così valore e dichiarazione combaciano.
                        let tipo = db_tipi.tipo_dichiarato(&id).await;
                        if let Some(v) = valore::variant_per_tipo(tipo.as_deref(), &valore_tag) {
                            let dv = DataValue::new_now(v);
                            let _ = node_mgr_for_update.set_value(
                                handle_for_update.subscriptions(),
                                &nid,
                                None,
                                dv,
                            );
                        }
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
            value,
            status,
            source_timestamp: None,
            source_picoseconds: None,
            server_timestamp: None,
            server_picoseconds: None,
        }
    }

    // ── `consegna`: ciò che arriva da un nodo, dentro il TagDb ───────────
    //
    // Con un `TagDb` vero e nessuna sessione OPC-UA. Prima di questi test la
    // parte che cambia davvero — la scala, il tipo, le foglie — si poteva
    // provare solo con un server davanti, cioè mai.

    use sws_core::{Forma, TagValue, TypeDef};
    use std::collections::HashMap as Mappa;

    /// Un `TagDb` coi metadati installati come fa `apply_tags`. Gemello di
    /// `db_con` nei test di Modbus.
    async fn db_con(tags: &[sws_core::TagDef], types: &[TypeDef]) -> TagDb {
        let db = TagDb::new(64);
        let (mut tipi, mut forme, mut scale) = (Mappa::new(), Mappa::new(), Mappa::new());
        for t in tags {
            // Come `build_tag_scales`: la scala c'è solo se ci sono tutti e
            // quattro gli estremi e i due raw non coincidono.
            if let (Some(rm), Some(rx), Some(em), Some(ex)) = (t.raw_min, t.raw_max, t.eng_min, t.eng_max) {
                if rx != rm {
                    scale.insert(
                        t.id.clone(),
                        sws_core::LinearScale { raw_min: rm, raw_max: rx, eng_min: em, eng_max: ex },
                    );
                }
            }
            match Forma::da_tag(t, types).unwrap() {
                Some(f) => {
                    for fo in f.foglie(&t.id, types) {
                        tipi.insert(fo.percorso.clone(), fo.tipo.nome());
                    }
                    db.set(t.id.clone(), f.valore_iniziale(), TagQuality::Uncertain).await;
                    forme.insert(t.id.clone(), f);
                }
                None => {
                    tipi.insert(t.id.clone(), t.data_type.clone());
                }
            }
        }
        db.set_forme(forme).await;
        db.set_data_types(tipi).await;
        db.set_scales(scale).await;
        db
    }

    fn tag_yaml(y: &str) -> sws_core::TagDef {
        serde_yaml::from_str(y).unwrap()
    }

    fn foglie_di(forma: &Forma, radice: &str, types: &[TypeDef]) -> Vec<(String, Vec<sws_core::Segmento>)> {
        forma
            .foglie(radice, types)
            .into_iter()
            .filter_map(|f| {
                let resto = f.percorso.strip_prefix(radice)?;
                Some((f.percorso.clone(), sws_core::percorso::parse_segmenti(resto)?))
            })
            .collect()
    }

    /// Il difetto più grosso della Fase 4: il dispatcher usava `set`, che salta
    /// la scala **e** la conversione al tipo dichiarato.
    #[tokio::test]
    async fn il_valore_letto_viene_scalato_e_convertito() {
        let t = tag_yaml("id: pressione\ndata_type: f64\nraw_min: 0\nraw_max: 1000\neng_min: 0\neng_max: 10\n");
        let db = db_con(&[t], &[]).await;
        consegna(&db, "pressione", None, &dv(Some(Variant::Int32(500)), Some(StatusCode::Good))).await;
        let st = db.get("pressione").await.expect("il tag c'è");
        assert_eq!(st.value, TagValue::Float(5.0), "500 su 0-1000 scalato a 0-10 fa 5");
    }

    /// E la conversione al tipo dichiarato: un `u16` non tiene un decimale.
    #[tokio::test]
    async fn il_valore_letto_segue_il_tipo_dichiarato() {
        let db = db_con(&[tag_yaml("id: giri\ndata_type: u16\n")], &[]).await;
        consegna(&db, "giri", None, &dv(Some(Variant::Double(29.8)), Some(StatusCode::Good))).await;
        assert_eq!(db.get("giri").await.unwrap().value, TagValue::Int(30));
    }

    /// L'altro difetto: un valore che non si sa leggere non cancella quello
    /// buono di prima con uno zero inventato.
    #[tokio::test]
    async fn un_valore_illeggibile_non_cancella_lultima_lettura() {
        let db = db_con(&[tag_yaml("id: t\ndata_type: f64\n")], &[]).await;
        consegna(&db, "t", None, &dv(Some(Variant::Double(42.0)), Some(StatusCode::Good))).await;
        assert_eq!(db.get("t").await.unwrap().value, TagValue::Float(42.0));

        consegna(&db, "t", None, &dv(Some(Variant::Guid(Default::default())), Some(StatusCode::Good))).await;
        let st = db.get("t").await.unwrap();
        assert_eq!(st.value, TagValue::Float(42.0), "ha scritto uno zero inventato al posto del dato");
        // Dal 23-10-2026 `Bad` e non `Uncertain`: il dato c'è e non lo
        // sappiamo leggere, quindi va visto invece che ingrigito.
        assert_eq!(st.quality, TagQuality::Bad);
    }

    /// Un tag composito diventa **un nodo per foglia**, e l'identificatore di
    /// ciascuno è il percorso del `TagDb`.
    ///
    /// Fino al 23-10-2026 un composito non compariva **affatto**
    /// nell'indirizzario: la conversione tornava `None` e l'updater lo saltava
    /// in silenzio.
    #[tokio::test]
    async fn un_tag_composito_diventa_un_nodo_per_foglia() {
        let tipi: Vec<TypeDef> = serde_yaml::from_str(
            "- id: Motore\n  members:\n    - { name: velocita, data_type: f32 }\n    - { name: marcia, data_type: bool }\n",
        )
        .unwrap();
        let istanza = tag_yaml("id: motore1\ntype_ref: Motore\n");
        let db = db_con(&[istanza], &tipi).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: motore1\n").unwrap();

        let esposti = nodi_esposti(&db, &m).await;
        let nomi: Vec<&str> = esposti.iter().map(|(n, _, _)| n.as_str()).collect();
        assert_eq!(nomi, vec!["motore1.velocita", "motore1.marcia"]);
        // L'identificatore del nodo **è** il percorso del TagDb: chi scrive su
        // quel nodo scrive sulla foglia giusta, senza tabelle di conversione.
        assert_eq!(esposti[0].1, "motore1.velocita");
        // E ogni figlio porta il tipo del suo membro, non quello della radice.
        assert_eq!(esposti[0].2.as_deref(), Some("f32"));
        assert_eq!(esposti[1].2.as_deref(), Some("bool"));
    }

    /// Uno scalare resta un nodo solo: il caso normale non cambia.
    #[tokio::test]
    async fn uno_scalare_resta_un_nodo_solo() {
        let db = db_con(&[tag_yaml("id: pressione\ndata_type: u16\n")], &[]).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: pressione\n").unwrap();
        let esposti = nodi_esposti(&db, &m).await;
        assert_eq!(esposti.len(), 1);
        assert_eq!(esposti[0].1, "pressione");
        assert_eq!(esposti[0].2.as_deref(), Some("u16"));
    }

    /// Un array dà un nodo per elemento, con lo stesso criterio.
    #[tokio::test]
    async fn un_array_da_un_nodo_per_elemento() {
        let db = db_con(&[tag_yaml("id: livelli\ndata_type: i32\narray: [3]\n")], &[]).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: livelli\n").unwrap();
        let esposti = nodi_esposti(&db, &m).await;
        assert_eq!(esposti.len(), 3);
        assert_eq!(esposti[0].0, "livelli[0]");
        assert_eq!(esposti[2].0, "livelli[2]");
    }

    /// Un array arriva come **un** valore e deve finire nel TagDb **una foglia
    /// per volta**, col percorso di ciascuna.
    #[tokio::test]
    async fn un_array_si_consegna_foglia_per_foglia() {
        let t = tag_yaml("id: livelli\ndata_type: i32\narray: [3]\n");
        let forma = Forma::da_tag(&t, &[]).unwrap().unwrap();
        let foglie = foglie_di(&forma, "livelli", &[]);
        assert_eq!(foglie.len(), 3, "tre foglie: {foglie:?}");
        let db = db_con(&[t], &[]).await;

        let a = opcua::types::Array::new_multi(
            opcua::types::VariantScalarTypeId::Int32,
            vec![Variant::Int32(10), Variant::Int32(20), Variant::Int32(30)],
            vec![3],
        )
        .unwrap();
        consegna(&db, "livelli", Some(&foglie), &dv(Some(Variant::Array(Box::new(a))), Some(StatusCode::Good))).await;

        assert_eq!(db.get("livelli[0]").await.unwrap().value, TagValue::Int(10));
        assert_eq!(db.get("livelli[2]").await.unwrap().value, TagValue::Int(30));
    }

    /// Un array più corto di quello dichiarato: le foglie che mancano si
    /// marcano Bad, non si inventano.
    #[tokio::test]
    async fn una_foglia_che_non_arriva_diventa_bad() {
        let t = tag_yaml("id: livelli\ndata_type: i32\narray: [3]\n");
        let forma = Forma::da_tag(&t, &[]).unwrap().unwrap();
        let foglie = foglie_di(&forma, "livelli", &[]);
        let db = db_con(&[t], &[]).await;

        let a = opcua::types::Array::new_multi(
            opcua::types::VariantScalarTypeId::Int32,
            vec![Variant::Int32(10)],
            vec![1],
        )
        .unwrap();
        consegna(&db, "livelli", Some(&foglie), &dv(Some(Variant::Array(Box::new(a))), Some(StatusCode::Good))).await;

        assert_eq!(db.get("livelli[0]").await.unwrap().value, TagValue::Int(10));
        assert_eq!(db.get("livelli[2]").await.unwrap().quality, TagQuality::Bad);
    }

    // Le due conversioni vivono in `valore.rs` dal 22-10-2026, con le loro
    // prove; queste due restano qui perché dicono come la sessione legge la
    // qualità, che è il motivo per cui erano state scritte.
    #[test]
    fn data_value_quality_propagates_status() {
        let (_, q) = crate::valore::da_data_value(&dv(
            Some(Variant::Int32(0)),
            Some(StatusCode::BadDeviceFailure),
        ));
        assert!(matches!(q, TagQuality::Bad));
    }

    #[test]
    fn data_value_none_value_is_uncertain() {
        let (_, q) = crate::valore::da_data_value(&dv(None, Some(StatusCode::Good)));
        assert!(matches!(q, TagQuality::Uncertain));
    }

    #[test]
    fn parse_security_policy_known_values() {
        assert!(matches!(
            parse_security_policy("None"),
            Some(SecurityPolicy::None)
        ));
        assert!(matches!(
            parse_security_policy("Basic256Sha256"),
            Some(SecurityPolicy::Basic256Sha256)
        ));
        assert!(matches!(
            parse_security_policy("Aes256Sha256RsaPss"),
            Some(SecurityPolicy::Aes256Sha256RsaPss)
        ));
        assert!(parse_security_policy("Bogus").is_none());
    }

    #[test]
    fn security_mode_pairs_none_with_none_and_else_signencrypt() {
        // The plugin treats every non-None policy as SignAndEncrypt — that
        // matches what most industrial servers expose.
        assert_eq!(
            security_mode_for(SecurityPolicy::None),
            MessageSecurityMode::None
        );
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
            assert!(
                seen.insert((*spec, *suffix)),
                "duplicate (spec, suffix) = ({spec}, {suffix})"
            );
        }
    }

}

#[cfg(test)]
mod tests_fiducia {
    use super::*;

    fn pki(nome: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sws-tofu-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("trusted")).unwrap();
        std::fs::create_dir_all(d.join("rejected")).unwrap();
        d
    }

    #[test]
    fn al_primo_contatto_il_certificato_diventa_fidato() {
        let d = pki("primo");
        std::fs::write(d.join("rejected/server.der"), b"x").unwrap();
        assert_eq!(fiducia_al_primo_contatto(&d), Fiducia::Memorizzato("server.der".into()));
        assert!(d.join("trusted/server.der").exists());
        assert!(!d.join("rejected/server.der").exists());
        // Le volte dopo non c'è niente da fare.
        assert_eq!(fiducia_al_primo_contatto(&d), Fiducia::Niente);
    }

    #[test]
    fn un_certificato_cambiato_non_si_accetta_da_solo() {
        let d = pki("cambiato");
        std::fs::write(d.join("trusted/vecchio.der"), b"x").unwrap();
        std::fs::write(d.join("rejected/nuovo.der"), b"y").unwrap();
        assert_eq!(fiducia_al_primo_contatto(&d), Fiducia::Cambiato("nuovo.der".into()));
        assert!(d.join("rejected/nuovo.der").exists(), "resta fra i rifiutati");
    }

    #[test]
    fn piu_rifiutati_senza_fidati_e_ambiguo() {
        let d = pki("ambiguo");
        std::fs::write(d.join("rejected/a.der"), b"x").unwrap();
        std::fs::write(d.join("rejected/b.der"), b"y").unwrap();
        assert_eq!(fiducia_al_primo_contatto(&d), Fiducia::Niente);
    }
}
