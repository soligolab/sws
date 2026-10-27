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
    Forma, OpcUaAuth, OpcUaClientConfig, TagDb, TagQuality, TagWriteBus, WriteRequest,
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

    // **L'albero dei tipi del server** (Fase 4d, passi 10-12, 25-10-2026). Un
    // nodo struttura arriva come `ExtensionObject`, e per decodificarlo la
    // sessione vuole un type loader costruito sui `DataType` del server. Si fa
    // solo se la sorgente ha tag compositi — su un PLC con migliaia di tipi è un
    // browse che altrimenti non serve — e **a ogni sessione**: gli id di encoding
    // portano l'indice di namespace di quella sessione (insidia 11).
    //
    // Un errore **non** spegne la sorgente (insidia 9): `DataTypeTreeBuilder`
    // non guarda gli `OperationLimits`, e un server con `MaxNodesPerRead` basso
    // farebbe fallire la costruzione intera. Si legge a pacchi di 100 e, se va
    // male lo stesso, le strutture restano `Bad` come prima e gli scalari vanno.
    let albero: Option<Arc<opcua::types::custom::DataTypeTree>> = if foglie_per_tag.is_empty() {
        None
    } else {
        match opcua::client::custom_types::DataTypeTreeBuilder::new(|_: &NodeId| true)
            .values_per_read(100)
            .build(&session)
            .await
        {
            Ok(t) => {
                let t = Arc::new(t);
                session.add_type_loader(Arc::new(opcua::types::custom::DynamicTypeLoader::new(t.clone()))
                    as Arc<dyn opcua::types::TypeLoader>);
                Some(t)
            }
            Err(e) => {
                warn!(source = %cfg.id, "opcua: albero dei tipi non costruito ({e}): le strutture restano Bad");
                None
            }
        }
    };

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
    let albero_clone = albero.clone();
    let source_id = cfg.id.clone();
    let dispatcher = tokio::spawn(async move {
        let nome_misura = format!("sorgente.opcua.{source_id}");
        while let Some((node_id, dv)) = rx.recv().await {
            let _valore = sws_core::prestazioni::Misura::nuova(nome_misura.as_str());
            let Some(tag_id) = routing_clone.get(&node_id) else {
                continue;
            };
            consegna(&db_clone, tag_id, foglie_clone.get(tag_id.as_str()), &dv, albero_clone.as_deref()).await;
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
    albero: Option<&opcua::types::custom::DataTypeTree>,
) {
    let (value, quality) = valore::da_data_value_con(dv, albero);
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
/// Un nodo che il server espone.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NodoEsposto {
    /// L'identificatore OPC-UA del nodo.
    pub id_nodo: String,
    /// Il tag o il percorso del `TagDb` da cui prende il valore.
    pub tag: String,
    /// Il tipo dichiarato nel progetto.
    pub tipo: Option<String>,
    /// L'identificatore della **radice**, se questo nodo è una sua foglia.
    ///
    /// Esiste per non dover indovinare la parentela da un prefisso. Prima la si
    /// ricavava con `id.starts_with(radice)`, e sbagliava in due modi: le foglie
    /// di `motore10` cadevano dentro `motore1`, e una mappatura con un `node_id`
    /// diverso dal tag non ritrovava più le sue foglie — perché le foglie sono
    /// nominate col percorso del **tag** mentre il filtro cercava il `node_id`.
    pub radice: Option<String>,
}

pub(crate) async fn nodi_esposti(
    db: &TagDb,
    nodes: &[sws_core::OpcUaServerNodeMapping],
) -> Vec<NodoEsposto> {
    let mut out = Vec::new();
    for mapping in nodes {
        let esterno = mapping.effective_node_id();
        let foglie: Vec<(String, String)> = match db.forma(&mapping.tag).await {
            Some(f) => f
                .foglie(&mapping.tag, &[])
                .into_iter()
                .map(|fo| (fo.percorso, fo.tipo.nome()))
                .collect(),
            None => Vec::new(),
        };
        if foglie.is_empty() {
            out.push(NodoEsposto {
                id_nodo: esterno.to_string(),
                tag: mapping.tag.clone(),
                tipo: db.tipo_dichiarato(&mapping.tag).await,
                radice: None,
            });
        } else {
            for (percorso, tipo) in foglie {
                // Il **percorso** nomina il nodo, tranne quando la mappatura ha
                // un `node_id` suo: allora il prefisso del tag si sostituisce
                // con quello, e dentro il `TagDb` si continua a usare il
                // percorso vero.
                let id_nodo = match percorso.strip_prefix(&mapping.tag) {
                    Some(resto) if esterno != mapping.tag => format!("{esterno}{resto}"),
                    _ => percorso.clone(),
                };
                out.push(NodoEsposto {
                    id_nodo,
                    tag: percorso,
                    tipo: Some(tipo),
                    radice: Some(esterno.to_string()),
                });
            }
        }
    }
    out
}

/// Un tipo struttura che il server pubblica come `DataType`.
pub(crate) struct TipoPubblicato {
    /// L'id del `TypeDef` nel progetto (`Motore`).
    pub nome: String,
    /// Il nodo `DataType`. **Id a stringa, mai numerico**: un contatore cambia
    /// appena si aggiunge un tipo, e un client che aveva memorizzato
    /// `ns=2;i=5` non lo ritroverebbe più.
    pub tipo_id: NodeId,
    /// Il nodo di codifica `Default Binary`.
    pub enc_id: NodeId,
    pub definizione: opcua::types::DataTypeDefinition,
    /// I campi **nell'ordine dichiarato**, con il tipo di ciascuno. È lo stesso
    /// ordine con cui `definizione_struttura` ha costruito la
    /// `StructureDefinition`, ed è quello che conta: `DynamicStructure` riempie
    /// per **posizione**, non per nome.
    pub campi: Vec<(String, String)>,
}

/// I tipi struttura da pubblicare, e quale radice usa quale.
///
/// Gemella di [`nodi_esposti`], accanto a quella e per lo stesso motivo: chi
/// crea i nodi, chi costruisce l'albero dei tipi e chi specchia i valori devono
/// essere d'accordo, e tre scansioni che si credono uguali un giorno divergono.
///
/// **Deduplicata per nome del `TypeDef`, non per tag.** Due istanze di `Motore`
/// devono condividere **un** `DataType`: altrimenti il secondo `insert`
/// nell'indirizzario torna `false` con un `error!` che non legge nessuno, e si
/// pubblicano due tipi identici — il contrario del motivo per cui si pubblica
/// una struttura.
pub(crate) async fn tipi_pubblicati(
    db: &TagDb,
    nodes: &[sws_core::OpcUaServerNodeMapping],
    ns: u16,
) -> (Vec<TipoPubblicato>, HashMap<String, String>) {
    let mut tipi: Vec<TipoPubblicato> = Vec::new();
    let mut per_radice: HashMap<String, String> = HashMap::new();
    for mapping in nodes {
        let (Some(nome), Some(forma)) = (
            db.tipo_struttura(&mapping.tag).await,
            db.forma(&mapping.tag).await,
        ) else {
            continue;
        };
        let tipo_id = NodeId::new(ns, format!("type:{nome}"));
        let enc_id = NodeId::new(ns, format!("type:{nome}:binary"));
        let Some(definizione) = valore::definizione_struttura(&forma, &enc_id) else {
            // Forma che non si pubblica (membro struttura, array annidato):
            // quel tag tiene il comportamento di oggi, cartella con le foglie.
            continue;
        };
        per_radice.insert(mapping.effective_node_id().to_string(), nome.clone());
        if tipi.iter().any(|t| t.nome == nome) {
            continue;
        }
        let Forma::Struttura(membri) = &forma else { continue };
        let campi = membri
            .iter()
            .filter_map(|(n, f)| match f {
                Forma::Scalare(t) => Some((n.clone(), t.nome())),
                Forma::Array(_, interno) => match interno.as_ref() {
                    Forma::Scalare(t) => Some((n.clone(), t.nome())),
                    _ => None,
                },
                Forma::Struttura(_) => None,
            })
            .collect();
        tipi.push(TipoPubblicato { nome, tipo_id, enc_id, definizione, campi });
    }
    (tipi, per_radice)
}

/// Il `Variant` di una struttura, costruito **nell'ordine dichiarato**.
///
/// `TagValue::Struct` è una `BTreeMap`, quindi alfabetica; i campi di una
/// struttura OPC-UA si riempiono per **posizione**. Si scorre l'ordine
/// dichiarato e si cerca per nome nella mappa — **mai il contrario**: con due
/// campi dello stesso tipo i valori si scambierebbero e la qualità resterebbe
/// `Good`.
///
/// Torna `Err` e non `None` di proposito: un fallimento qui congela il nodo
/// sull'ultimo valore buono, e chi lo subisce deve poterlo leggere nel log.
pub(crate) fn variant_struttura(
    t: &TipoPubblicato,
    albero: &Arc<opcua::types::custom::DataTypeTree>,
    valore: &sws_core::TagValue,
) -> Result<Variant, String> {
    use opcua::types::custom::DynamicStructure;
    use opcua::types::IntoVariant;
    let sws_core::TagValue::Struct(mappa) = valore else {
        return Err(format!("il valore di «{}» non è una struttura", t.nome));
    };
    let st = albero
        .get_struct_type(&t.tipo_id)
        .ok_or_else(|| format!("il tipo «{}» non è nell'albero", t.nome))?
        .clone();
    let mut valori = Vec::with_capacity(t.campi.len());
    for (nome, tipo) in &t.campi {
        let v = mappa
            .get(nome)
            .ok_or_else(|| format!("manca il campo «{nome}» di «{}»", t.nome))?;
        valori.push(
            valore::variant_per_tipo(Some(tipo), v)
                .ok_or_else(|| format!("il campo «{nome}» di «{}» non si converte", t.nome))?,
        );
    }
    DynamicStructure::new_struct(st, albero.clone(), valori)
        .map(|d| d.into_variant())
        .map_err(|e| format!("«{}»: {e}", t.nome))
}

pub async fn run_server(
    cfg: sws_core::OpcUaServerConfig,
    db: Arc<sws_core::TagDb>,
    bus: Arc<sws_core::TagWriteBus>,
    cancel: tokio_util::sync::CancellationToken,
) {
    run_server_con(cfg, db, bus, cancel, None, None).await
}

/// Il corpo di [`run_server`], con due appigli che servono **solo ai test**.
///
/// `ascoltatore`: una porta già aperta. `run_server` ne lega una fissa su
/// `0.0.0.0`, e due test in parallelo si pesterebbero i piedi; col socket già
/// aperto su `127.0.0.1:0` ognuno ha la sua, e la sa. Attenzione: il
/// `ServerBuilder` continua comunque a **dichiarare** `host`/`port` negli
/// endpoint, quindi vanno impostati lo stesso — passarli sbagliati vuol dire
/// endpoint che mentono e un client che non trova dove collegarsi.
///
/// `pki`: dove tenere i certificati. Il default di async-opcua è `<cwd>/pki` e
/// le cartelle nascono dentro `build()`, **sempre**, anche con policy `None`:
/// in un `cargo test` il cwd è la cartella del crate, e comparirebbe un
/// `pki/` dentro il checkout. In **produzione non si tocca**: spostarla
/// sposterebbe il certificato del server, e ogni client che l'aveva
/// memorizzato smetterebbe di fidarsi.
pub(crate) async fn run_server_con(
    cfg: sws_core::OpcUaServerConfig,
    db: Arc<sws_core::TagDb>,
    bus: Arc<sws_core::TagWriteBus>,
    cancel: tokio_util::sync::CancellationToken,
    ascoltatore: Option<tokio::net::TcpListener>,
    pki: Option<PathBuf>,
) {
    use opcua::nodes::{AccessLevel, VariableBuilder};
    use opcua::server::{
        diagnostics::NamespaceMetadata, node_manager::memory::simple_node_manager, ServerBuilder,
    };
    use opcua::types::{DataValue, NodeId, ObjectId};
    use sws_core::{TagQuality, TagValue};

    // Host e porta **si dichiarano comunque**, anche con un ascoltatore già
    // aperto: il `ServerBuilder` li usa per gli `EndpointDescription`, e un
    // endpoint che annuncia una porta diversa da quella su cui si ascolta è un
    // endpoint che mente.
    let (host, porta) = match &ascoltatore {
        Some(l) => match l.local_addr() {
            Ok(a) => (a.ip().to_string(), a.port()),
            Err(e) => {
                warn!(source = %cfg.id, "OPC-UA server: ascoltatore senza indirizzo: {e}");
                return;
            }
        },
        None => ("0.0.0.0".to_string(), cfg.port),
    };
    // Il `ServerBuilder` vive dentro un blocco suo, e non e un vezzo: **non e
    // `Send`**, e una variabile che lo tiene resta nello stato della future
    // anche dopo essere stata consumata. Con un `await` piu in la — ce ne sono
    // — `run_server_con` smette di essere spawnabile, e il messaggio del
    // compilatore punta all'await e non al builder.
    let costruito = {
        let mut builder = ServerBuilder::new_anonymous("SWS OPC-UA Server")
            .application_uri(format!("urn:soligolab:sws:{}", cfg.id))
            .host(host)
            .port(porta)
            .trust_client_certs(true);
        if let Some(dir) = pki {
            builder = builder.pki_dir(dir);
        }
        builder
            .with_node_manager(simple_node_manager(
                NamespaceMetadata {
                    namespace_uri: cfg.namespace_uri.clone(),
                    ..Default::default()
                },
                "sws",
            ))
            .build()
    };
    let (server, handle) = match costruito {
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

    // **I tipi struttura** (Fase 4d). Un tag composito non è più una cartella
    // con dentro le foglie: è una `Variable` con un `DataType` vero, e le
    // foglie restano come nodi figli perché la scrittura ci passa (decisione 2).
    let (tipi, tipo_di_radice) = tipi_pubblicati(&db, &cfg.nodes, ns).await;

    // L'albero dei tipi del server, costruito a mano: senza, non si saprebbe
    // codificare il proprio `ExtensionObject`.
    //
    // L'ordine è obbligato: **prima** tutti i `ParentIds`, poi i `TypeInfo`.
    // `from_type_definition` risolve ogni tipo di campo attraverso i
    // `ParentIds`, e riempirli man mano darebbe un esito che dipende
    // dall'ordine di iterazione di una `HashMap` — un errore che compare su
    // alcune esecuzioni e non su altre. Oggi coi soli tipi predefiniti non
    // morde; morderebbe il giorno dei tipi annidati, cioè quando nessuno si
    // ricorda più di questa riga.
    let albero = {
        use opcua::types::custom::{DataTypeTree, EncodingIds, ParentIds, TypeInfo};
        use opcua::types::DataTypeId;
        let mut pids = ParentIds::new();
        for t in &tipi {
            pids.add_type(t.tipo_id.clone(), DataTypeId::Structure.into());
        }
        let mut infos = Vec::new();
        for t in &tipi {
            // Gli `EncodingIds` non devono **mai** essere `None`:
            // `from_type_definition` risponderebbe «Missing encoding IDs».
            match TypeInfo::from_type_definition(
                t.definizione.clone(),
                t.nome.clone(),
                Some(EncodingIds { binary_id: t.enc_id.clone(), ..Default::default() }),
                false,
                &t.tipo_id,
                &pids,
            ) {
                Ok(info) => infos.push((t.tipo_id.clone(), info)),
                Err(e) => warn!(source = %cfg.id, tipo = %t.nome, "OPC-UA: tipo non pubblicabile: {e}"),
            }
        }
        let mut albero = DataTypeTree::new(pids);
        for (id, info) in infos {
            albero.add_type(id, info);
        }
        Arc::new(albero)
    };
    if !tipi.is_empty() {
        handle.info().add_type_loader(Arc::new(
            opcua::types::custom::DynamicTypeLoader::new(albero.clone()),
        ) as Arc<dyn opcua::types::TypeLoader>);
    }

    // **Tutto quello che serve chiedere al `TagDb` si chiede PRIMA del lock.**
    //
    // L'indirizzario sta dietro un lock sincrono: tenerlo attraverso un `await`
    // vuol dire che il task può essere messo in pausa mentre lo possiede, e chi
    // altro lo vuole aspetta. Qui dentro c'erano due `await` — uno è arrivato
    // con le strutture, l'altro c'era già — e la cosa funzionava per
    // coincidenza, perché il `TagDb` ha un lock suo.
    let mut iniziali: HashMap<String, Variant> = HashMap::new();
    let mut tipi_scalari: HashMap<String, Option<String>> = HashMap::new();
    for mapping in &cfg.nodes {
        let esterno = mapping.effective_node_id();
        match tipo_di_radice.get(esterno).and_then(|n| tipi.iter().find(|t| &t.nome == n)) {
            Some(t) => {
                if let Some(st) = db.get(&mapping.tag).await {
                    match variant_struttura(t, &albero, &st.value) {
                        Ok(v) => {
                            iniziali.insert(esterno.to_string(), v);
                        }
                        // Si parte vuoti e l'updater riempie al primo
                        // aggiornamento, ma lo si dice: un nodo che resta
                        // vuoto per sempre è il difetto che si sta chiudendo.
                        Err(e) => warn!(source = %cfg.id, tag = %mapping.tag,
                                        "OPC-UA: valore iniziale non costruito: {e}"),
                    }
                }
            }
            None => {
                tipi_scalari.insert(mapping.tag.clone(), db.tipo_dichiarato(&mapping.tag).await);
            }
        }
    }

    // Populate address space: folder + one Variable per tag mapping.
    {
        let mut address_space = node_mgr.address_space().write();
        let folder_id = NodeId::new(ns, "SWS");
        let objects_folder: NodeId = ObjectId::ObjectsFolder.into();
        address_space.add_folder(&folder_id, "SWS", "SWS", &objects_folder);

        // Il nodo `DataType` di ogni tipo, e **il suo nodo di codifica**.
        //
        // Il nodo di codifica non è opzionale, ed è il punto più facile da
        // saltare: l'esempio del crate lo salta e funziona lo stesso, ma lì
        // client e server condividono **lo stesso** albero. Qui l'id viaggia
        // sul filo, e con due tipi due id nulli finirebbero nella stessa chiave
        // della mappa encoding→tipo del client: il secondo si decodificherebbe
        // col tipo del primo, **senza nessun errore**. Si deve chiamare
        // esattamente «Default Binary»: è la stringa su cui il client fa match.
        for t in &tipi {
            opcua::nodes::DataTypeBuilder::new(&t.tipo_id, &t.nome, &t.nome)
                .data_type_definition(t.definizione.clone())
                .subtype_of(opcua::types::DataTypeId::Structure)
                .insert(&mut *address_space);
            opcua::nodes::ObjectBuilder::new(&t.enc_id, "Default Binary", "Default Binary")
                .has_type_definition(opcua::types::ObjectTypeId::DataTypeEncodingType)
                .reference(
                    t.tipo_id.clone(),
                    ReferenceTypeId::HasEncoding,
                    opcua::nodes::ReferenceDirection::Inverse,
                )
                .insert(&mut *address_space);
        }

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
            // La parentela la porta `NodoEsposto::radice`, non un prefisso: con
            // `starts_with` le foglie di `motore10` cadevano dentro `motore1`,
            // e una mappatura con un `node_id` diverso dal tag non ritrovava
            // le proprie foglie affatto.
            let esterno = mapping.effective_node_id();
            let foglie: Vec<&NodoEsposto> = esposti
                .iter()
                .filter(|n| n.radice.as_deref() == Some(esterno))
                .collect();

            if foglie.is_empty() {
                // Scalare: un nodo, come sempre. Il tipo dichiarato nel
                // progetto e non `Double` per tutti — prima un `bool` si
                // esponeva come `Double` e poi ci si spingeva dentro un
                // `Variant::Boolean`, e il valore contraddiceva il tipo.
                let nid = NodeId::new(ns, mapping.effective_node_id());
                let tipo = tipi_scalari.get(&mapping.tag).cloned().flatten();
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

            // Composito. La radice è una **struttura vera** quando il suo tipo
            // è stato pubblicato (Fase 4d), altrimenti resta la cartella di
            // prima — che è il caso di una forma che non si può descrivere
            // (membro struttura, array annidato).
            //
            // In tutti e due i casi **le foglie restano**: la decisione 2 vuole
            // che la scrittura passi dal nodo figlio, e per scriverci sopra
            // bisogna che quel nodo esista. L'identificatore di ogni figlio è
            // il percorso, lo stesso che il `TagDb` usa.
            let radice_id = NodeId::new(ns, esterno);
            let tipo_radice = tipo_di_radice
                .get(esterno)
                .and_then(|nome| tipi.iter().find(|t| &t.nome == nome));

            match tipo_radice {
                Some(t) => {
                    // Il valore iniziale è stato costruito prima del lock.
                    let iniziale = iniziali.get(esterno).cloned().unwrap_or(Variant::Empty);
                    VariableBuilder::new(&radice_id, esterno, esterno)
                        .data_type(t.tipo_id.clone())
                        .value(iniziale)
                        // Sola lettura: si scrive sul **nodo figlio**
                        // (decisione 2), perché `NumericRange` indirizza solo
                        // gli array e non il campo di una struttura.
                        .access_level(AccessLevel::CURRENT_READ)
                        .user_access_level(AccessLevel::CURRENT_READ)
                        .organized_by(folder_id.clone())
                        .reference(
                            opcua::types::VariableTypeId::BaseDataVariableType,
                            ReferenceTypeId::HasTypeDefinition,
                            opcua::nodes::ReferenceDirection::Forward,
                        )
                        .insert(&mut *address_space);
                }
                None => {
                    address_space.add_folder(&radice_id, esterno, esterno, &folder_id);
                }
            }

            for n in &foglie {
                let nid = NodeId::new(ns, n.id_nodo.as_str());
                let b = VariableBuilder::new(&nid, n.id_nodo.as_str(), n.id_nodo.as_str())
                    .data_type(valore::tipo_opcua(n.tipo.as_deref()))
                    .value(0.0_f64)
                    .access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                    .user_access_level(AccessLevel::CURRENT_READ | AccessLevel::CURRENT_WRITE)
                    .writable();
                // Una `Variable` appesa a una `Variable` per `Organizes` è
                // ammessa ma qualche client non la mostra: sotto una struttura
                // i campi stanno per `HasComponent`.
                let b = if tipo_radice.is_some() {
                    b.component_of(radice_id.clone())
                } else {
                    b.organized_by(radice_id.clone())
                };
                b.insert(&mut *address_space);
            }
        }
    }

    // E l'albero dei tipi *del server* deve sapere che i nostri tipi sono
    // sottotipi di `Structure`: senza, la codifica non li riconosce.
    for t in &tipi {
        handle.type_tree().write().add_type_node(
            &t.tipo_id,
            &opcua::types::DataTypeId::Structure.into(),
            NodeClass::DataType,
        );
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
        for n in &esposti {
            let nid = NodeId::new(ns, n.id_nodo.as_str());
            let tag = n.tag.clone();
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
        esposti.iter().map(|n| (n.id_nodo.clone(), n.tag.clone())).collect();
    let ns_for_update = ns;
    // Le radici che sono una **struttura pubblicata**: tag del `TagDb`,
    // identificatore del nodo, e il tipo. L'aggiornamento arriva col tag, il
    // nodo si chiama col `node_id`: quando la mappatura ne ha uno suo i due
    // non coincidono, e cercare col nome sbagliato vuol dire non aggiornare
    // mai niente.
    let radici_struttura: Vec<(String, String, usize)> = cfg
        .nodes
        .iter()
        .filter_map(|m| {
            let nome = tipo_di_radice.get(m.effective_node_id())?;
            let i = tipi.iter().position(|t| &t.nome == nome)?;
            Some((m.tag.clone(), m.effective_node_id().to_string(), i))
        })
        .collect();
    let tipi_per_update = Arc::new(tipi);
    let albero_per_update = albero.clone();
    let id_per_update = cfg.id.clone();

    let updater = tokio::spawn(async move {
        // Un fallimento nel costruire la struttura congela il nodo sull'ultimo
        // valore buono. Lo si dice **una volta per tag**: a ogni giro sarebbe
        // un log che si auto-cancella, e in silenzio è il difetto che questa
        // fase esiste per togliere.
        let mut gia_detto: std::collections::HashSet<String> = std::collections::HashSet::new();
        loop {
            match db_rx.recv().await {
                Ok(update) => {
                    // **La radice, come struttura intera.** `espandi_foglie`
                    // dà solo le foglie: senza questo pezzo il nodo struttura
                    // non si aggiornerebbe mai — lo stesso difetto che la 4c
                    // ha trovato al contrario sui nodi figli.
                    if let Some((_, id_nodo, i)) =
                        radici_struttura.iter().find(|(tag, _, _)| *tag == update.id)
                    {
                        let t = &tipi_per_update[*i];
                        match variant_struttura(t, &albero_per_update, &update.state.value) {
                            Ok(v) => {
                                let nid = NodeId::new(ns_for_update, id_nodo.as_str());
                                let _ = node_mgr_for_update.set_value(
                                    handle_for_update.subscriptions(),
                                    &nid,
                                    None,
                                    DataValue::new_now(v),
                                );
                                gia_detto.remove(&update.id);
                            }
                            Err(e) => {
                                if gia_detto.insert(update.id.clone()) {
                                    warn!(source = %id_per_update, tag = %update.id,
                                          "OPC-UA: la struttura non si aggiorna più: {e}");
                                }
                            }
                        }
                    }
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
    let in_corsa = async move {
        match ascoltatore {
            Some(l) => server.run_with(l).await,
            None => server.run().await,
        }
    };
    tokio::select! {
        res = in_corsa => {
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
        let forme_di_prova = forme.clone();
        db.set_forme(forme).await;
        db.set_data_types(tipi).await;
        db.set_scales(scale).await;
        // Come `apply_tags`: senza questa riga ogni prova del server vedrebbe
        // zero tipi struttura e passerebbe tenendo il ramo di prima — cioè non
        // proverebbe niente.
        db.set_tipi_struttura(
            tags.iter()
                .filter(|t| matches!(forme_di_prova.get(&t.id), Some(Forma::Struttura(_))))
                .filter_map(|t| t.type_ref.clone().map(|r| (t.id.clone(), r)))
                .collect(),
        )
        .await;
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
        consegna(&db, "pressione", None, &dv(Some(Variant::Int32(500)), Some(StatusCode::Good)), None).await;
        let st = db.get("pressione").await.expect("il tag c'è");
        assert_eq!(st.value, TagValue::Float(5.0), "500 su 0-1000 scalato a 0-10 fa 5");
    }

    /// E la conversione al tipo dichiarato: un `u16` non tiene un decimale.
    #[tokio::test]
    async fn il_valore_letto_segue_il_tipo_dichiarato() {
        let db = db_con(&[tag_yaml("id: giri\ndata_type: u16\n")], &[]).await;
        consegna(&db, "giri", None, &dv(Some(Variant::Double(29.8)), Some(StatusCode::Good)), None).await;
        assert_eq!(db.get("giri").await.unwrap().value, TagValue::Int(30));
    }

    /// L'altro difetto: un valore che non si sa leggere non cancella quello
    /// buono di prima con uno zero inventato.
    #[tokio::test]
    async fn un_valore_illeggibile_non_cancella_lultima_lettura() {
        let db = db_con(&[tag_yaml("id: t\ndata_type: f64\n")], &[]).await;
        consegna(&db, "t", None, &dv(Some(Variant::Double(42.0)), Some(StatusCode::Good)), None).await;
        assert_eq!(db.get("t").await.unwrap().value, TagValue::Float(42.0));

        consegna(&db, "t", None, &dv(Some(Variant::Guid(Default::default())), Some(StatusCode::Good)), None).await;
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
        let nomi: Vec<&str> = esposti.iter().map(|n| n.id_nodo.as_str()).collect();
        assert_eq!(nomi, vec!["motore1.velocita", "motore1.marcia"]);
        // L'identificatore del nodo **è** il percorso del TagDb: chi scrive su
        // quel nodo scrive sulla foglia giusta, senza tabelle di conversione.
        assert_eq!(esposti[0].tag, "motore1.velocita");
        // E ogni figlio porta il tipo del suo membro, non quello della radice.
        assert_eq!(esposti[0].tipo.as_deref(), Some("f32"));
        assert_eq!(esposti[1].tipo.as_deref(), Some("bool"));
        // E ogni foglia sa di chi è figlia, senza indovinarlo da un prefisso.
        assert_eq!(esposti[0].radice.as_deref(), Some("motore1"));
    }

    /// **Il collaudo che dice se i passi 2-7 sono veri**: il nostro server
    /// pubblica due tipi struttura, il nostro client si collega, costruisce
    /// l'albero dei tipi dal browse e decodifica i due `ExtensionObject`.
    ///
    /// **Due tipi, non uno.** Con uno solo il test passerebbe anche sbagliando
    /// il nodo di encoding: il client rimappa un id nullo sull'unico tipo che
    /// conosce, e il giro torna lo stesso. È con il secondo che due chiavi
    /// nulle si pestano e si decodifica col tipo sbagliato — in silenzio.
    ///
    /// Niente rete, niente da installare: porta 0 su loopback, anonimo, senza
    /// certificati (`create_sample_keypair(false)` — generarne uno costa nove
    /// secondi e con policy `None` non serve a niente), e due cartelle
    /// temporanee per le pki, che altrimenti nascerebbero nel checkout.
    #[tokio::test]
    async fn il_client_legge_le_strutture_del_nostro_server() {
        use opcua::client::custom_types::DataTypeTreeBuilder;
        use opcua::client::ClientBuilder;
        use opcua::types::custom::{DynamicStructure, DynamicTypeLoader};
        use opcua::types::{ReadValueId, TimestampsToReturn, TypeLoader};

        let tipi_def: Vec<TypeDef> = serde_yaml::from_str(concat!(
            "- id: Motore\n  members:\n    - { name: velocita, data_type: f32 }\n    - { name: marcia, data_type: bool }\n",
            "- id: Serbatoio\n  members:\n    - { name: livello, data_type: f32 }\n",
        ))
        .unwrap();
        let tags = [
            tag_yaml("id: motore1\ntype_ref: Motore\n"),
            tag_yaml("id: serbatoio1\ntype_ref: Serbatoio\n"),
        ];
        let db = Arc::new(db_con(&tags, &tipi_def).await);
        // Valori veri, così si vede se i campi finiscono nella casella giusta.
        let mut m = std::collections::BTreeMap::new();
        m.insert("velocita".to_string(), sws_core::TagValue::Float(12.5));
        m.insert("marcia".to_string(), sws_core::TagValue::Bool(true));
        db.set("motore1".into(), sws_core::TagValue::Struct(m), TagQuality::Good).await;
        let mut m2 = std::collections::BTreeMap::new();
        m2.insert("livello".to_string(), sws_core::TagValue::Float(73.25));
        db.set("serbatoio1".into(), sws_core::TagValue::Struct(m2), TagQuality::Good).await;

        let ascoltatore = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta = ascoltatore.local_addr().unwrap().port();
        let pki_server = tempfile::tempdir().unwrap();
        let pki_client = tempfile::tempdir().unwrap();

        let cfg: sws_core::OpcUaServerConfig = serde_yaml::from_str(&format!(
            "id: prova\nport: {porta}\nnamespace_uri: urn:sws:prova\nnodes:\n  - tag: motore1\n  - tag: serbatoio1\n"
        ))
        .unwrap();
        let cancel = tokio_util::sync::CancellationToken::new();
        let bus = Arc::new(sws_core::TagWriteBus::default());
        let server = tokio::spawn(run_server_con(
            cfg,
            db.clone(),
            bus,
            cancel.clone(),
            Some(ascoltatore),
            Some(pki_server.path().to_path_buf()),
        ));

        let mut client = ClientBuilder::new()
            .application_name("prova")
            .application_uri("urn:sws:prova:client")
            .create_sample_keypair(false)
            .trust_server_certs(true)
            .pki_dir(pki_client.path().to_path_buf())
            .session_retry_limit(0)
            .client()
            .unwrap();
        let endpoint: opcua::types::EndpointDescription = (
            format!("opc.tcp://127.0.0.1:{porta}/").as_str(),
            SecurityPolicy::None.to_uri(),
            MessageSecurityMode::None,
            UserTokenPolicy::anonymous(),
        )
            .into();
        let (session, loop_) = client
            .connect_to_endpoint_directly(endpoint, IdentityToken::Anonymous)
            .unwrap();
        loop_.spawn();
        session.wait_for_connection().await;

        let albero = Arc::new(
            DataTypeTreeBuilder::new(|_: &NodeId| true)
                .build(&session)
                .await
                .expect("l'albero dei tipi si costruisce dal browse"),
        );
        session.add_type_loader(Arc::new(DynamicTypeLoader::new(albero.clone())) as Arc<dyn TypeLoader>);

        let ns = 2;
        let letti = session
            .read(
                &[
                    ReadValueId::new_value(NodeId::new(ns, "motore1")),
                    ReadValueId::new_value(NodeId::new(ns, "serbatoio1")),
                ],
                TimestampsToReturn::Both,
                0.0,
            )
            .await
            .expect("read");

        let campo = |dv: &DataValue, nome: &str| -> Option<Variant> {
            let Some(Variant::ExtensionObject(eo)) = dv.value.clone() else { return None };
            eo.into_inner_as::<DynamicStructure>()?.get_field_by_name(nome).cloned()
        };

        assert_eq!(
            campo(&letti[0], "velocita"),
            Some(Variant::Float(12.5)),
            "il primo tipo si decodifica"
        );
        assert_eq!(campo(&letti[0], "marcia"), Some(Variant::Boolean(true)));
        // **Il secondo è quello che conta**: con un nodo di encoding nullo si
        // decodificherebbe col tipo del primo, e `livello` non esisterebbe.
        assert_eq!(
            campo(&letti[1], "livello"),
            Some(Variant::Float(73.25)),
            "il secondo tipo NON si decodifica col tipo del primo"
        );

        // E l'aggiornamento arriva: il `TagDb` trasmette la radice, e senza il
        // ramo apposta nell'updater il nodo struttura resterebbe fermo.
        let mut m3 = std::collections::BTreeMap::new();
        m3.insert("velocita".to_string(), sws_core::TagValue::Float(99.0));
        m3.insert("marcia".to_string(), sws_core::TagValue::Bool(false));
        db.set("motore1".into(), sws_core::TagValue::Struct(m3), TagQuality::Good).await;
        let mut visto = None;
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let r = session
                .read(&[ReadValueId::new_value(NodeId::new(ns, "motore1"))], TimestampsToReturn::Both, 0.0)
                .await
                .expect("read");
            if let Some(v) = campo(&r[0], "velocita") {
                visto = Some(v.clone());
                if v == Variant::Float(99.0) {
                    break;
                }
            }
        }
        assert_eq!(visto, Some(Variant::Float(99.0)), "il nodo struttura si aggiorna");

        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    /// **Il collaudo dei passi 10-12** (25-10-2026): un client SWS vero — la
    /// stessa `run` che il supervisore lancia — iscritto ai nodi struttura del
    /// server SWS. Prima del passo 10 l'`ExtensionObject` restava `Bad` e le
    /// foglie del tag del client non ricevevano niente. Due tipi, per la stessa
    /// ragione del collaudo del server: con uno solo passa anche sbagliando
    /// l'encoding. E un aggiornamento, perché la sottoscrizione segua.
    #[tokio::test]
    async fn il_client_sws_riceve_le_strutture_foglia_per_foglia() {
        let tipi_def: Vec<TypeDef> = serde_yaml::from_str(concat!(
            "- id: Motore\n  members:\n    - { name: velocita, data_type: f32 }\n    - { name: marcia, data_type: bool }\n",
            "- id: Serbatoio\n  members:\n    - { name: livello, data_type: f32 }\n",
        ))
        .unwrap();
        let db_s = Arc::new(
            db_con(&[tag_yaml("id: motore1\ntype_ref: Motore\n"), tag_yaml("id: serbatoio1\ntype_ref: Serbatoio\n")], &tipi_def)
                .await,
        );
        let struttura = |coppie: &[(&str, sws_core::TagValue)]| {
            sws_core::TagValue::Struct(coppie.iter().map(|(k, v)| (k.to_string(), v.clone())).collect())
        };
        db_s.set(
            "motore1".into(),
            struttura(&[("velocita", sws_core::TagValue::Float(12.5)), ("marcia", sws_core::TagValue::Bool(true))]),
            TagQuality::Good,
        )
        .await;
        db_s.set("serbatoio1".into(), struttura(&[("livello", sws_core::TagValue::Float(73.25))]), TagQuality::Good).await;

        let ascoltatore = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta = ascoltatore.local_addr().unwrap().port();
        let pki_server = tempfile::tempdir().unwrap();
        let pki_client = tempfile::tempdir().unwrap();
        let cfg_s: sws_core::OpcUaServerConfig = serde_yaml::from_str(&format!(
            "id: prova\nport: {porta}\nnamespace_uri: urn:sws:prova\nnodes:\n  - tag: motore1\n  - tag: serbatoio1\n"
        ))
        .unwrap();
        let cancel = tokio_util::sync::CancellationToken::new();
        let server = tokio::spawn(run_server_con(
            cfg_s,
            db_s.clone(),
            Arc::new(sws_core::TagWriteBus::default()),
            cancel.clone(),
            Some(ascoltatore),
            Some(pki_server.path().to_path_buf()),
        ));

        // Il client: tag dello stesso tipo, nomi diversi, così si vede che
        // arriva dal filo e non dal db del server.
        let db_c = Arc::new(
            db_con(&[tag_yaml("id: m\ntype_ref: Motore\n"), tag_yaml("id: s\ntype_ref: Serbatoio\n")], &tipi_def).await,
        );
        let cfg_c: OpcUaClientConfig = serde_yaml::from_str(&format!(
            "id: c\nendpoint_url: opc.tcp://127.0.0.1:{porta}/\nsecurity_policy: None\ntrust_all_certs: true\n\
             subscription_interval_ms: 50\nnodes:\n  - {{ tag: m, node_id: \"ns=2;s=motore1\" }}\n  - {{ tag: s, node_id: \"ns=2;s=serbatoio1\" }}\n"
        ))
        .unwrap();
        let client = tokio::spawn(run(
            cfg_c,
            db_c.clone(),
            Arc::new(sws_core::TagWriteBus::default()),
            pki_client.path().to_path_buf(),
            cancel.clone(),
        ));

        let attendi = |id: &'static str, atteso: sws_core::TagValue| {
            let db_c = db_c.clone();
            async move {
                for _ in 0..300 {
                    if let Some(st) = db_c.get(id).await {
                        if st.value == atteso && st.quality == TagQuality::Good {
                            return true;
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                false
            }
        };
        assert!(attendi("m.velocita", sws_core::TagValue::Float(12.5)).await, "la prima struttura arriva foglia per foglia");
        assert!(attendi("m.marcia", sws_core::TagValue::Bool(true)).await);
        assert!(
            attendi("s.livello", sws_core::TagValue::Float(73.25)).await,
            "il secondo tipo NON si decodifica col tipo del primo"
        );

        db_s.set(
            "motore1".into(),
            struttura(&[("velocita", sws_core::TagValue::Float(99.0)), ("marcia", sws_core::TagValue::Bool(false))]),
            TagQuality::Good,
        )
        .await;
        assert!(attendi("m.velocita", sws_core::TagValue::Float(99.0)).await, "la sottoscrizione segue la struttura");
        assert!(attendi("m.marcia", sws_core::TagValue::Bool(false)).await);

        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(5), client).await;
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    fn tipi_motore() -> Vec<TypeDef> {
        serde_yaml::from_str(
            "- id: Motore\n  members:\n    - { name: velocita, data_type: f32 }\n    - { name: marcia, data_type: bool }\n",
        )
        .unwrap()
    }

    /// **Due istanze dello stesso tipo condividono un `DataType` solo.** Se la
    /// deduplica fosse per tag, il secondo `insert` nell'indirizzario
    /// tornerebbe `false` con un `error!` che non legge nessuno, e si
    /// pubblicherebbero due tipi identici — il contrario del motivo per cui si
    /// pubblica una struttura.
    #[tokio::test]
    async fn due_istanze_dello_stesso_tipo_danno_un_datatype_solo() {
        let tipi_def = tipi_motore();
        let db = db_con(
            &[
                tag_yaml("id: motore1\ntype_ref: Motore\n"),
                tag_yaml("id: motore2\ntype_ref: Motore\n"),
            ],
            &tipi_def,
        )
        .await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: motore1\n- tag: motore2\n").unwrap();

        let (tipi, per_radice) = tipi_pubblicati(&db, &m, 2).await;
        assert_eq!(tipi.len(), 1, "un tipo solo, non uno per istanza");
        assert_eq!(tipi[0].nome, "Motore");
        assert_eq!(per_radice.get("motore1").map(String::as_str), Some("Motore"));
        assert_eq!(per_radice.get("motore2").map(String::as_str), Some("Motore"));
        // Gli id a stringa, nel nostro namespace: stabili fra due avvii per
        // costruzione, mentre un contatore cambierebbe appena si aggiunge un
        // tipo. E un namespace sbagliato non è un errore ma un panic.
        assert_eq!(tipi[0].tipo_id, NodeId::new(2, "type:Motore"));
        assert_eq!(tipi[0].enc_id, NodeId::new(2, "type:Motore:binary"));
        // I campi, nell'ordine dichiarato: è l'ordine con cui si riempiono.
        assert_eq!(
            tipi[0].campi,
            vec![("velocita".to_string(), "f32".to_string()), ("marcia".to_string(), "bool".to_string())]
        );
    }

    /// Una forma che non si sa descrivere non si pubblica, e quel tag tiene il
    /// comportamento di prima: cartella con le foglie dentro.
    #[tokio::test]
    async fn una_forma_che_non_si_descrive_non_si_pubblica() {
        let tipi_def: Vec<TypeDef> = serde_yaml::from_str(
            "- id: Pid\n  members:\n    - { name: kp, data_type: f32 }\n- id: Gruppo\n  members:\n    - { name: pid, type_ref: Pid }\n",
        )
        .unwrap();
        let db = db_con(&[tag_yaml("id: g1\ntype_ref: Gruppo\n")], &tipi_def).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> = serde_yaml::from_str("- tag: g1\n").unwrap();

        let (tipi, per_radice) = tipi_pubblicati(&db, &m, 2).await;
        assert!(tipi.is_empty(), "una struttura annidata non si pubblica in questo giro");
        assert!(per_radice.is_empty(), "e la radice non deve credersi una struttura");
        // Ma le foglie ci sono lo stesso: il tag resta usabile.
        assert!(!nodi_esposti(&db, &m).await.is_empty());
    }

    /// Il difetto del prefisso nudo: le foglie di `motore10` non devono cadere
    /// dentro `motore1`.
    #[tokio::test]
    async fn due_radici_con_un_prefisso_in_comune_non_si_mescolano() {
        let tipi_def = tipi_motore();
        let db = db_con(
            &[
                tag_yaml("id: motore1\ntype_ref: Motore\n"),
                tag_yaml("id: motore10\ntype_ref: Motore\n"),
            ],
            &tipi_def,
        )
        .await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: motore1\n- tag: motore10\n").unwrap();
        let esposti = nodi_esposti(&db, &m).await;

        let di_uno: Vec<&str> = esposti
            .iter()
            .filter(|n| n.radice.as_deref() == Some("motore1"))
            .map(|n| n.id_nodo.as_str())
            .collect();
        assert_eq!(di_uno, vec!["motore1.velocita", "motore1.marcia"]);
        assert_eq!(
            esposti.iter().filter(|n| n.radice.as_deref() == Some("motore10")).count(),
            2
        );
    }

    /// Una mappatura con un `node_id` suo: il nodo si chiama col `node_id`, ma
    /// dentro il `TagDb` si continua a leggere il percorso vero. Prima le
    /// foglie restavano orfane — nominate col tag, cercate col `node_id` — e il
    /// tag finiva esposto come uno scalare `Double`.
    #[tokio::test]
    async fn un_node_id_suo_rinomina_i_nodi_ma_non_i_tag() {
        let tipi_def = tipi_motore();
        let db = db_con(&[tag_yaml("id: motore1\ntype_ref: Motore\n")], &tipi_def).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: motore1\n  node_id: M1\n").unwrap();
        let esposti = nodi_esposti(&db, &m).await;

        assert_eq!(
            esposti.iter().map(|n| n.id_nodo.as_str()).collect::<Vec<_>>(),
            vec!["M1.velocita", "M1.marcia"]
        );
        assert_eq!(
            esposti.iter().map(|n| n.tag.as_str()).collect::<Vec<_>>(),
            vec!["motore1.velocita", "motore1.marcia"],
            "il TagDb non sa niente di M1"
        );
        assert!(esposti.iter().all(|n| n.radice.as_deref() == Some("M1")));
    }

    /// **L'ordine dei campi è quello dichiarato, non quello della mappa.**
    /// `TagValue::Struct` è una `BTreeMap`, quindi alfabetica, e
    /// `DynamicStructure` riempie per posizione: i due campi qui hanno nomi il
    /// cui ordine alfabetico è l'inverso di quello dichiarato, e sono dello
    /// stesso tipo — così uno scambio non lo prenderebbe nessuna validazione.
    #[tokio::test]
    async fn i_campi_si_riempiono_nell_ordine_dichiarato() {
        use opcua::types::custom::{DataTypeTree, EncodingIds, ParentIds, TypeInfo};
        use opcua::types::DataTypeId;

        let tipi_def: Vec<TypeDef> = serde_yaml::from_str(
            "- id: Coppia\n  members:\n    - { name: zeta, data_type: f32 }\n    - { name: alfa, data_type: f32 }\n",
        )
        .unwrap();
        let db = db_con(&[tag_yaml("id: c1\ntype_ref: Coppia\n")], &tipi_def).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> = serde_yaml::from_str("- tag: c1\n").unwrap();
        let (tipi, _) = tipi_pubblicati(&db, &m, 2).await;
        let t = &tipi[0];

        let mut pids = ParentIds::new();
        pids.add_type(t.tipo_id.clone(), DataTypeId::Structure.into());
        let info = TypeInfo::from_type_definition(
            t.definizione.clone(),
            t.nome.clone(),
            Some(EncodingIds { binary_id: t.enc_id.clone(), ..Default::default() }),
            false,
            &t.tipo_id,
            &pids,
        )
        .expect("from_type_definition");
        let mut albero = DataTypeTree::new(pids);
        albero.add_type(t.tipo_id.clone(), info);
        let albero = Arc::new(albero);

        let mut mappa = std::collections::BTreeMap::new();
        mappa.insert("alfa".to_string(), sws_core::TagValue::Float(1.0));
        mappa.insert("zeta".to_string(), sws_core::TagValue::Float(2.0));
        assert_eq!(
            mappa.keys().next().map(String::as_str),
            Some("alfa"),
            "la mappa è alfabetica: è il punto del test"
        );

        let v = variant_struttura(t, &albero, &sws_core::TagValue::Struct(mappa))
            .expect("la struttura si costruisce");
        let opcua::types::Variant::ExtensionObject(eo) = v else { panic!("non è un ExtensionObject") };
        let ds = eo
            .inner_as::<opcua::types::custom::DynamicStructure>()
            .expect("DynamicStructure");
        assert_eq!(ds.get_field_by_name("zeta"), Some(&opcua::types::Variant::Float(2.0)));
        assert_eq!(ds.get_field_by_name("alfa"), Some(&opcua::types::Variant::Float(1.0)));
    }

    /// Un campo che manca non produce una struttura mezza vuota: produce un
    /// errore che si può leggere. Prima un fallimento qui congelava il nodo in
    /// silenzio.
    #[tokio::test]
    async fn una_struttura_incompleta_dice_perche() {
        let tipi_def = tipi_motore();
        let db = db_con(&[tag_yaml("id: motore1\ntype_ref: Motore\n")], &tipi_def).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> = serde_yaml::from_str("- tag: motore1\n").unwrap();
        let (tipi, _) = tipi_pubblicati(&db, &m, 2).await;
        let albero = Arc::new(opcua::types::custom::DataTypeTree::new(
            opcua::types::custom::ParentIds::new(),
        ));
        let e = variant_struttura(&tipi[0], &albero, &sws_core::TagValue::Float(1.0))
            .expect_err("un numero non è una struttura");
        assert!(e.contains("Motore"), "l'errore nomina il tipo: {e}");
    }

    /// Uno scalare resta un nodo solo: il caso normale non cambia.
    #[tokio::test]
    async fn uno_scalare_resta_un_nodo_solo() {
        let db = db_con(&[tag_yaml("id: pressione\ndata_type: u16\n")], &[]).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: pressione\n").unwrap();
        let esposti = nodi_esposti(&db, &m).await;
        assert_eq!(esposti.len(), 1);
        assert_eq!(esposti[0].tag, "pressione");
        assert_eq!(esposti[0].tipo.as_deref(), Some("u16"));
        assert_eq!(esposti[0].radice, None, "uno scalare non è figlio di niente");
    }

    /// Un array dà un nodo per elemento, con lo stesso criterio.
    #[tokio::test]
    async fn un_array_da_un_nodo_per_elemento() {
        let db = db_con(&[tag_yaml("id: livelli\ndata_type: i32\narray: [3]\n")], &[]).await;
        let m: Vec<sws_core::OpcUaServerNodeMapping> =
            serde_yaml::from_str("- tag: livelli\n").unwrap();
        let esposti = nodi_esposti(&db, &m).await;
        assert_eq!(esposti.len(), 3);
        assert_eq!(esposti[0].id_nodo, "livelli[0]");
        assert_eq!(esposti[2].id_nodo, "livelli[2]");
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
        consegna(&db, "livelli", Some(&foglie), &dv(Some(Variant::Array(Box::new(a))), Some(StatusCode::Good)), None).await;

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
        consegna(&db, "livelli", Some(&foglie), &dv(Some(Variant::Array(Box::new(a))), Some(StatusCode::Good)), None).await;

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
