//! Sparkplug B support for sws-plugin-mqtt.
//!
//! Sparkplug B is an MQTT-based IIoT payload specification (Eclipse Foundation).
//! Payloads are protobuf-encoded; topics follow:
//!   spBv1.0/{group_id}/{msg_type}/{edge_node_id}[/{device_id}]
//!
//! This module handles:
//!   - SCADA Host STATE birth (online/offline), nella forma di Sparkplug 3.0
//!   - NBIRTH / NDATA / DBIRTH / DDATA → tag updates
//!   - NDEATH / DDEATH → Bad quality on the tags **of that node or device**
//!   - NCMD / DCMD write-back for writable metrics, al nodo o dispositivo che
//!     ha annunciato la metrica
//!
//! Le ultime tre righe sono del 29-10-2026. Fino a quel giorno lo STATE aveva
//! il topic della 3.0 e il contenuto della 2.x (`ONLINE`), la morte di un nodo
//! marcava `Bad` i tag di tutto il gruppo, e un comando partiva verso
//! `NCMD/<host_id>` — cioè verso il nome di SWS, dove nessun nodo ascolta —
//! e il valore scritto si vedeva buono lo stesso.
//!
//! Protobuf structs are hand-written (no protoc/build.rs needed — the schema
//! is small and stable).

use prost::Message as ProstMessage;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use sws_core::{
    MqttConfig, SparkplugConfig, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest,
};

// ── Le struct protobuf di Sparkplug B, scritte a mano ────────────────────────
//
// **I numeri di campo sono quelli di `sparkplug_b.proto` di Eclipse Tahu, e
// vanno lasciati stare.** Fino al 23-10-2026 erano sbagliati — il `oneof` usava
// 7…12 invece di 10…15 — e il piano dei tag lo aveva messo per iscritto come
// sospetto («i numeri di campo del protobuf sembrano diversi dalla specifica»).
// Lo erano.
//
// Perché nessuno se n'era accorto: non c'era un test, e i nostri test non
// avrebbero comunque detto niente, perché avrebbero codificato con queste
// stesse struct e fatto round-trip su sé stessi. Il difetto si vede **solo**
// contro byte scritti da qualcun altro, ed è per questo che la prova in coda a
// questo file i byte se li costruisce a mano dai numeri della specifica.
//
// Cosa succedeva davvero contro un impianto vero:
//   - campo 10, `int_value` (varint): noi lo dichiaravamo `double` (fixed64).
//     Tipo di wire diverso → **prost rifiuta l'intero payload**. Ogni metrica
//     intera buttava via tutto il messaggio.
//   - campo 11, `long_value` (varint): noi `bool` (varint). Stesso tipo di
//     wire, quindi **nessun errore**: un numero diventava `true`. Il caso
//     peggiore, perché silenzioso.
//   - campo 7, `is_null` (bool): noi `int_value` (uint32). Anche qui stesso
//     wire: una metrica dichiarata nulla arrivava come il valore 1.
//   - campi 8 e 9 (`metadata` e `properties`, messaggi): noi `long` e `float`.
//     Tipo di wire diverso → ogni NBIRTH con metadati veniva rifiutato intero.
//
// **Quello che NON dichiariamo qui è una scelta, non una dimenticanza**:
// `is_historical` (5), `is_transient` (6), `metadata` (8), `properties` (9),
// `bytes_value` (16), `dataset_value` (17), `template_value` (18),
// `extension_value` (19). prost salta i campi che non conosce qualunque sia il
// loro tipo di wire, quindi non dichiararli è **sicuro**; dichiararli col tipo
// sbagliato è fatale. È esattamente la differenza che ha prodotto questo
// difetto.

#[derive(Clone, PartialEq, prost::Message)]
pub struct Payload {
    #[prost(uint64, optional, tag = "1")]
    pub timestamp: Option<u64>,
    #[prost(message, repeated, tag = "2")]
    pub metrics: Vec<Metric>,
    #[prost(uint64, optional, tag = "3")]
    pub seq: Option<u64>,
    #[prost(string, optional, tag = "4")]
    pub uuid: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Metric {
    #[prost(string, optional, tag = "1")]
    pub name: Option<String>,
    /// L'**alias**: il numero con cui un NBIRTH battezza una metrica, e con cui
    /// tutti gli NDATA e DDATA successivi la nominano **al posto del nome** —
    /// è il modo normale di lavorare di Sparkplug, e il default di Ignition.
    /// Non lo leggevamo: ogni dato di un impianto che usa gli alias arrivava
    /// senza nome e veniva scartato in silenzio.
    #[prost(uint64, optional, tag = "2")]
    pub alias: Option<u64>,
    #[prost(uint64, optional, tag = "3")]
    pub timestamp: Option<u64>,
    /// Il codice del tipo Sparkplug: 1=Int8 … 8=UInt64, 9=Float, 10=Double,
    /// 11=Boolean, 12=String, 13=DateTime (verificati su `MetricDataType.java`
    /// di Tahu il 23-10-2026: questi erano giusti).
    #[prost(uint32, optional, tag = "4")]
    pub datatype: Option<u32>,
    /// «Il valore è nullo», detto esplicitamente invece di mandare uno zero.
    /// Chi lo manda sta dicendo che non ha un dato, non che il dato vale 0.
    #[prost(bool, optional, tag = "7")]
    pub is_null: Option<bool>,
    #[prost(oneof = "MetricValue", tags = "10, 11, 12, 13, 14, 15")]
    pub value: Option<MetricValue>,
}

// I nomi delle varianti sono quelli della specifica Sparkplug B (`int_value`,
// `long_value`, …): il suffisso comune è del protocollo, non una svista nostra.
#[allow(clippy::enum_variant_names)]
#[derive(Clone, PartialEq, prost::Oneof)]
pub enum MetricValue {
    #[prost(uint32, tag = "10")]
    IntValue(u32),
    #[prost(uint64, tag = "11")]
    LongValue(u64),
    #[prost(float, tag = "12")]
    FloatValue(f32),
    #[prost(double, tag = "13")]
    DoubleValue(f64),
    #[prost(bool, tag = "14")]
    BooleanValue(bool),
    #[prost(string, tag = "15")]
    StringValue(String),
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Run a Sparkplug B session until `cancel`. Reconnects on error with backoff.
pub async fn run_sparkplug(
    cfg: MqttConfig,
    spb: SparkplugConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    cancel: CancellationToken,
) {
    loop {
        match session(&cfg, &spb, &db, &bus, cancel.clone()).await {
            Ok(()) => break,
            Err(e) => {
                if cancel.is_cancelled() {
                    break;
                }
                warn!(source = %cfg.id, "Sparkplug B session error: {e:#} — retry in 5s");
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    }
    // Mark all mapped tags Bad on exit.
    for m in &spb.metrics {
        db.marca_qualita(&m.tag, TagQuality::Bad).await;
    }
}

async fn session(
    cfg: &MqttConfig,
    spb: &SparkplugConfig,
    db: &Arc<TagDb>,
    bus: &Arc<TagWriteBus>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    let mut opts = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
    opts.set_max_packet_size(crate::MAX_PACKET_SIZE_BYTES, crate::MAX_PACKET_SIZE_BYTES);
    opts.set_keep_alive(Duration::from_secs(u64::from(
        cfg.keep_alive_secs.unwrap_or(10),
    )));
    if let Some(clean) = cfg.clean_session {
        opts.set_clean_session(clean);
    }

    if let Some(user) = cfg.username.clone() {
        let pw = cfg
            .password_env
            .as_deref()
            .and_then(|n| std::env::var(n).ok())
            .or_else(|| cfg.password.clone())
            .unwrap_or_default();
        opts.set_credentials(user, pw);
    }

    // SCADA Host STATE: last-will = offline, birth = online. Lo stesso
    // istante nei due: la 3.0 lo chiede, ed è così che un nodo distingue il
    // testamento di questa sessione da quello di una vecchia.
    let state_topic = topic_stato_host(&spb.host_id);
    let istante = adesso_ms();
    opts.set_last_will(rumqttc::LastWill::new(
        &state_topic,
        stato_host(false, istante),
        QoS::AtLeastOnce,
        true,
    ));

    let (client, mut eventloop) = AsyncClient::new(opts, 64);

    // Subscribe to the entire group namespace.
    let group_topic = format!("spBv1.0/{}/#", spb.group_id);
    client
        .subscribe(&group_topic, QoS::AtLeastOnce)
        .await
        .map_err(|e| anyhow::anyhow!("subscribe '{group_topic}': {e}"))?;

    // Publish SCADA Host online STATE.
    client
        .publish(&state_topic, QoS::AtLeastOnce, true, stato_host(true, istante))
        .await
        .map_err(|e| anyhow::anyhow!("publish STATE ONLINE: {e}"))?;

    info!(source = %cfg.id, group = %spb.group_id, host = %spb.host_id,
          client_id = %cfg.client_id, "Sparkplug B connected");

    // See the identical comment in lib.rs::run_session: a poll() that never
    // resolves (neither Ok nor Err) bypasses the retry-with-backoff in
    // run_sparkplug entirely, since this function would just never return.
    let poll_timeout = Duration::from_secs(
        u64::from(cfg.keep_alive_secs.unwrap_or(10))
            .saturating_mul(3)
            .max(30),
    );

    // Quello che la sessione sa dei nodi. Vive quanto la sessione: una
    // riconnessione riparte da zero e aspetta le nascite nuove, che è
    // esattamente quello che Sparkplug prescrive.
    let mut stato = Stato::nuovo(spb);

    // Register writable metrics on the write bus.
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    for m in spb.metrics.iter().filter(|m| m.writable) {
        bus.register(m.tag.clone(), write_tx.clone()).await;
    }
    drop(write_tx);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = client.publish(&state_topic, QoS::AtLeastOnce, true, stato_host(false, istante)).await;
                return Ok(());
            }

            Some((tag, percorso, value)) = write_rx.recv() => {
                // Fase 1d: una scrittura su una FOGLIA di una radice che
                // questo plugin possiede. Nessun protocollo sa ancora
                // scrivere dentro un blocco (arriva con le Fasi 3-4): meglio
                // dirlo che scrivere la cosa sbagliata.
                if let Some(p) = &percorso {
                    warn!(tag = %tag, percorso = %p, "scrittura su una foglia: non ancora supportata da questa sorgente");
                    continue;
                }
                let Some(idx) = spb.metrics.iter().position(|m| m.tag == tag) else { continue };
                let m = &spb.metrics[idx];

                // Il comando va al nodo (NCMD) o al dispositivo (DCMD) che ha
                // annunciato la metrica: è l'unico che lo ascolta. Prima della
                // sua nascita non sappiamo a chi mandarlo, e non lo mandiamo.
                let Some((destinazione, vivo)) = stato.comando(&spb.group_id, idx) else {
                    warn!(source = %cfg.id, %tag, metrica = %m.metric_name,
                          "Sparkplug: nessun nodo ha ancora annunciato questa metrica, comando non mandato");
                    continue;
                };
                let payload_bytes = build_cmd_payload(&m.metric_name, &value);
                if let Err(e) = client.publish(&destinazione, QoS::AtLeastOnce, false, payload_bytes).await {
                    warn!(source = %cfg.id, tag, "Sparkplug command publish failed: {e}");
                } else {
                    // Come per MQTT (28-10-2026): il comando parte anche verso
                    // un nodo morto, ma il valore si scrive buono solo se
                    // dall'altra parte c'è qualcuno. Il nodo vivo lo conferma
                    // comunque col suo NDATA/DDATA.
                    if vivo {
                        db.ingest(tag.clone(), value, TagQuality::Good).await;
                    }
                    info!(source = %cfg.id, %tag, %destinazione, vivo, "Sparkplug command");
                }
            }

            res = tokio::time::timeout(poll_timeout, eventloop.poll()) => {
                let event = match res {
                    Err(_) => return Err(anyhow::anyhow!(
                        "eventloop.poll() sospeso da oltre {poll_timeout:?} — tratteremo come sessione morta"
                    )),
                    Ok(inner) => inner.map_err(|e| anyhow::anyhow!("eventloop: {e}"))?,
                };
                if let Event::Incoming(Packet::Publish(p)) = event {
                    handle_message(&p.topic, &p.payload, db, spb, &mut stato).await;
                }
            }
        }
    }
}

/// Il topic dello stato dell'host: `spBv1.0/STATE/<host_id>` (Sparkplug 3.0).
fn topic_stato_host(host_id: &str) -> String {
    format!("spBv1.0/STATE/{host_id}")
}

/// Il contenuto dello stato dell'host nella forma della 3.0: un JSON con
/// `online` e `timestamp`. Era la stringa `ONLINE`/`OFFLINE` della 2.x, su un
/// topic della 3.0: un nodo 3.0 legge il JSON, e una stringa non la capisce.
/// Le due versioni non si possono servire insieme — il testamento di una
/// connessione MQTT è uno solo — e la 3.0 è quella in vigore.
fn stato_host(online: bool, timestamp: u64) -> String {
    format!(r#"{{"online":{online},"timestamp":{timestamp}}}"#)
}

fn adesso_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Da dove arriva una metrica: il nodo, e il dispositivo se è sua.
#[derive(Debug, Clone, PartialEq)]
struct Origine {
    nodo: String,
    dispositivo: Option<String>,
    /// Falso dopo la morte del nodo o del dispositivo, vero alla nascita o al
    /// primo dato.
    vivo: bool,
}

/// Quello che una sessione sa dei nodi del gruppo.
struct Stato {
    per_nome: HashMap<String, usize>,
    /// (ambito, alias) → indice della metrica. Si riempie dalle **nascite**
    /// (NBIRTH/DBIRTH), che sono le uniche a portare nome e alias insieme, e
    /// la leggono i dati, che di solito portano solo l'alias.
    alias: HashMap<(String, u64), usize>,
    /// Per ogni metrica mappata, chi l'ha mandata per ultimo. Serve a due
    /// cose: sapere a chi mandare un comando, e quali tag una morte tocca.
    origine: Vec<Option<Origine>>,
}

impl Stato {
    fn nuovo(spb: &SparkplugConfig) -> Self {
        Self {
            per_nome: spb.metrics.iter().enumerate().map(|(i, m)| (m.metric_name.clone(), i)).collect(),
            alias: HashMap::new(),
            origine: vec![None; spb.metrics.len()],
        }
    }

    /// Il topic del comando per la metrica `idx`, e se dall'altra parte c'è
    /// qualcuno. `None` se nessuno l'ha ancora annunciata.
    fn comando(&self, group_id: &str, idx: usize) -> Option<(String, bool)> {
        let o = self.origine.get(idx)?.as_ref()?;
        let topic = match &o.dispositivo {
            Some(d) => format!("spBv1.0/{group_id}/DCMD/{}/{d}", o.nodo),
            None => format!("spBv1.0/{group_id}/NCMD/{}", o.nodo),
        };
        Some((topic, o.vivo))
    }
}

async fn handle_message(
    topic: &str,
    payload: &[u8],
    db: &TagDb,
    spb: &SparkplugConfig,
    stato: &mut Stato,
) {
    // Topic format: spBv1.0/{group}/{msg_type}/{edge_node}[/{device}]
    let parts: Vec<&str> = topic.splitn(6, '/').collect();
    if parts.len() < 4 {
        return;
    }
    let msg_type = parts[2];
    let nodo = parts[3];
    let dispositivo = parts.get(4).copied();
    // Un alias vale dentro **un** nodo, e un suo dispositivo: due dispositivi
    // possono usare il numero 7 per due metriche diverse. La chiave porta
    // quindi tutto quello che nel topic viene dopo il tipo di messaggio.
    let ambito = parts[3..].join("/");

    match msg_type {
        "NBIRTH" | "NDATA" | "DBIRTH" | "DDATA" => match Payload::decode(payload) {
            Ok(pl) => {
                let nascita = msg_type.ends_with("BIRTH");
                if nascita {
                    // Una nascita ribattezza tutto. Tenere gli alias di prima
                    // vorrebbe dire, dopo un riavvio del nodo, scrivere il
                    // valore di una metrica sul tag di un'altra.
                    stato.alias.retain(|(a, _), _| a != &ambito);
                }
                for metric in &pl.metrics {
                    let idx = match metric.name.as_deref() {
                        Some(name) => {
                            let Some(&idx) = stato.per_nome.get(name) else {
                                debug!(topic, metric = name, "Sparkplug metric not mapped");
                                continue;
                            };
                            // Solo la nascita battezza: un alias che comparisse
                            // in un NDATA accanto al nome non è una definizione.
                            if nascita {
                                if let Some(a) = metric.alias {
                                    stato.alias.insert((ambito.clone(), a), idx);
                                }
                            }
                            idx
                        }
                        None => {
                            let Some(a) = metric.alias else { continue };
                            let Some(&idx) = stato.alias.get(&(ambito.clone(), a)) else {
                                debug!(topic, alias = a, "Sparkplug: alias sconosciuto, manca la nascita che lo battezza");
                                continue;
                            };
                            idx
                        }
                    };
                    stato.origine[idx] = Some(Origine {
                        nodo: nodo.to_string(),
                        dispositivo: dispositivo.map(str::to_string),
                        vivo: true,
                    });
                    let tag = &spb.metrics[idx].tag;
                    match metric_to_tagvalue(metric) {
                        Some(value) => db.ingest(tag.clone(), value, TagQuality::Good).await,
                        // `is_null`, o una metrica senza valore: chi la manda
                        // sta dicendo che un dato **non ce l'ha**. Inventare
                        // uno zero sarebbe lo stesso difetto che la Fase 4a ha
                        // tolto a OPC-UA — si tiene l'ultimo valore e si dice
                        // che non è più buono.
                        None => db.marca_qualita(tag, TagQuality::Uncertain).await,
                    }
                }
            }
            Err(e) => warn!(topic, "Sparkplug proto decode error: {e}"),
        },
        // Una morte tocca i tag di chi è morto, non quelli di tutto il gruppo.
        // La morte di un nodo porta con sé i suoi dispositivi; quella di un
        // dispositivo lascia stare il nodo e gli altri dispositivi.
        "NDEATH" | "DDEATH" => {
            for (i, o) in stato.origine.iter_mut().enumerate() {
                let Some(o) = o else { continue };
                let tocca = o.nodo == nodo
                    && (msg_type == "NDEATH" || o.dispositivo.as_deref() == dispositivo);
                if tocca {
                    o.vivo = false;
                    db.marca_qualita(&spb.metrics[i].tag, TagQuality::Bad).await;
                }
            }
        }
        _ => {}
    }
}

/// Il valore di una metrica, oppure `None` quando **non ce n'è uno**.
///
/// `None` non vuol dire zero: vuol dire che il nodo ha dichiarato la metrica
/// senza darle un valore (`is_null`, o una nascita che definisce e basta).
/// Prima qui si inventava uno `0.0` — lo stesso difetto che la Fase 4a ha
/// tolto a OPC-UA, dove si chiamava `Float(0.0)`.
fn metric_to_tagvalue(m: &Metric) -> Option<TagValue> {
    if m.is_null == Some(true) {
        return None;
    }
    let dt = m.datatype.unwrap_or(0);
    Some(match m.value.as_ref()? {
        MetricValue::BooleanValue(b) => TagValue::Bool(*b),
        // I tipi **con segno** viaggiano dentro `int_value`, che è senza
        // segno: il complemento a due ci sta dentro e va riletto col tipo
        // dichiarato, altrimenti un −1 arriva come 4 294 967 295. È lo stesso
        // difetto che la Fase 3 ha tolto a Modbus sugli `i16`.
        MetricValue::IntValue(i) => TagValue::Int(match dt {
            1 => *i as u8 as i8 as i64,   // Int8
            2 => *i as u16 as i16 as i64, // Int16
            3 => *i as i32 as i64,        // Int32
            _ => i64::from(*i),           // UInt8/16/32, o tipo non dichiarato
        }),
        // Int64 ci sta per definizione. Un UInt64 oltre `i64::MAX` no: `as`
        // lo avvolge e diventa negativo. `TagValue::Int` è un `i64` e non ha
        // un posto dove metterlo — è un limite del nostro modello, non della
        // decodifica, e vale la pena saperlo prima di inseguirlo.
        MetricValue::LongValue(l) => TagValue::Int(*l as i64),
        MetricValue::FloatValue(f) => TagValue::Float(f64::from(*f)),
        MetricValue::DoubleValue(d) => TagValue::Float(*d),
        MetricValue::StringValue(s) => TagValue::Str(s.clone()),
    })
}

/// Build a minimal Sparkplug B payload with a single metric command value.
fn build_cmd_payload(metric_name: &str, value: &TagValue) -> Vec<u8> {
    let metric_value = match value {
        TagValue::Bool(b) => Some(MetricValue::BooleanValue(*b)),
        TagValue::Int(i) => Some(MetricValue::LongValue(*i as u64)),
        TagValue::Float(f) => Some(MetricValue::DoubleValue(*f)),
        TagValue::Str(s) => Some(MetricValue::StringValue(s.clone())),
        // Fase 1b: Sparkplug ha dataset e template per i compositi, ma non
        // sono mappati (vedi la coda del piano tag): meglio non spedire nulla
        // che spedire uno zero.
        TagValue::Array(_) | TagValue::Struct(_) => None,
    };
    // Il **tipo dichiarato**: molti host rifiutano un NCMD che non lo porta, e
    // fino al 23-10-2026 non lo portavamo. I codici sono quelli di Tahu
    // (`MetricDataType.java`): 4=Int64, 10=Double, 11=Boolean, 12=String.
    let datatype = match value {
        TagValue::Bool(_) => Some(11),
        TagValue::Int(_) => Some(4),
        TagValue::Float(_) => Some(10),
        TagValue::Str(_) => Some(12),
        TagValue::Array(_) | TagValue::Struct(_) => None,
    };
    let payload = Payload {
        timestamp: None,
        seq: None,
        uuid: None,
        metrics: vec![Metric {
            name: Some(metric_name.to_string()),
            // Un comando nomina la metrica per nome: l'alias lo assegna il
            // nodo, e non è nostro da usare.
            alias: None,
            timestamp: None,
            datatype,
            is_null: None,
            value: metric_value,
        }],
    };
    payload.encode_to_vec()
}

#[cfg(test)]
mod prove_sparkplug {
    use super::*;
    use sws_core::SparkplugMetricMapping;

    /// Un codificatore protobuf **a mano**, che non passa dalle nostre struct.
    ///
    /// È il punto di tutta questa prova. Se i byte li costruissimo con
    /// `Payload { … }.encode_to_vec()`, il test farebbe round-trip su sé stesso
    /// e direbbe «verde» anche coi numeri di campo sbagliati — che è
    /// esattamente quello che è successo: il difetto è vissuto per mesi perché
    /// nessun test guardava byte scritti da qualcun altro.
    ///
    /// I numeri qui sotto sono quelli di `sparkplug_b.proto` di Eclipse Tahu,
    /// scritti a mano apposta: se qualcuno ritocca i `tag = "…"` del modulo,
    /// questa prova diventa rossa.
    mod specifica {
        pub fn varint(mut v: u64, out: &mut Vec<u8>) {
            while v >= 0x80 {
                out.push((v as u8) | 0x80);
                v >>= 7;
            }
            out.push(v as u8);
        }
        fn chiave(campo: u32, wire: u32, out: &mut Vec<u8>) {
            varint(u64::from((campo << 3) | wire), out);
        }
        pub fn vint(campo: u32, v: u64, out: &mut Vec<u8>) {
            chiave(campo, 0, out);
            varint(v, out);
        }
        pub fn fisso64(campo: u32, v: f64, out: &mut Vec<u8>) {
            chiave(campo, 1, out);
            out.extend_from_slice(&v.to_le_bytes());
        }
        pub fn fisso32(campo: u32, v: f32, out: &mut Vec<u8>) {
            chiave(campo, 5, out);
            out.extend_from_slice(&v.to_le_bytes());
        }
        pub fn blocco(campo: u32, v: &[u8], out: &mut Vec<u8>) {
            chiave(campo, 2, out);
            varint(v.len() as u64, out);
            out.extend_from_slice(v);
        }
        pub fn stringa(campo: u32, v: &str, out: &mut Vec<u8>) {
            blocco(campo, v.as_bytes(), out);
        }
    }

    /// I numeri di campo della specifica, scritti una volta sola e usati dalle
    /// prove: `Metric.name = 1`, `alias = 2`, `timestamp = 3`, `datatype = 4`,
    /// `is_null = 7`, e il `oneof value` da 10 a 15.
    const NOME: u32 = 1;
    const ALIAS: u32 = 2;
    const DATATYPE: u32 = 4;
    const IS_NULL: u32 = 7;
    const INT_VALUE: u32 = 10;
    const LONG_VALUE: u32 = 11;
    const FLOAT_VALUE: u32 = 12;
    const DOUBLE_VALUE: u32 = 13;
    const BOOLEAN_VALUE: u32 = 14;
    const STRING_VALUE: u32 = 15;

    fn payload(metriche: Vec<Vec<u8>>) -> Vec<u8> {
        let mut out = Vec::new();
        specifica::vint(1, 1_700_000_000_000, &mut out); // Payload.timestamp
        for m in &metriche {
            specifica::blocco(2, m, &mut out); // Payload.metrics
        }
        specifica::vint(3, 7, &mut out); // Payload.seq
        out
    }

    #[test]
    fn un_double_scritto_dalla_specifica_si_legge() {
        let mut m = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut m);
        specifica::vint(DATATYPE, 10, &mut m); // Double
        specifica::fisso64(DOUBLE_VALUE, 21.5, &mut m);

        let pl = Payload::decode(&payload(vec![m])[..]).expect("il payload deve decodificarsi");
        assert_eq!(pl.metrics.len(), 1);
        assert_eq!(pl.metrics[0].name.as_deref(), Some("Pump/Speed"));
        assert_eq!(metric_to_tagvalue(&pl.metrics[0]), Some(TagValue::Float(21.5)));
    }

    /// Il caso che prima **buttava via l'intero messaggio**: `int_value` è il
    /// campo 10, varint; noi ci avevamo messo un `double`, che è fixed64.
    /// Tipo di wire diverso = prost rifiuta tutto il payload, non solo il campo.
    #[test]
    fn un_intero_non_fa_piu_cadere_il_payload() {
        let mut m = Vec::new();
        specifica::stringa(NOME, "Pump/Count", &mut m);
        specifica::vint(DATATYPE, 3, &mut m); // Int32
        specifica::vint(INT_VALUE, 42, &mut m);

        let pl = Payload::decode(&payload(vec![m])[..]).expect("un intero non deve far cadere il payload");
        assert_eq!(metric_to_tagvalue(&pl.metrics[0]), Some(TagValue::Int(42)));
    }

    /// E il caso **silenzioso**, che è il peggiore: `long_value` è il campo 11
    /// e noi ci avevamo messo un `bool`. Stesso tipo di wire, nessun errore: un
    /// numero diventava `true` e nessuno se ne accorgeva.
    #[test]
    fn un_long_non_diventa_un_booleano() {
        let mut m = Vec::new();
        specifica::stringa(NOME, "Pump/Hours", &mut m);
        specifica::vint(DATATYPE, 4, &mut m); // Int64
        specifica::vint(LONG_VALUE, 123_456_789, &mut m);

        let pl = Payload::decode(&payload(vec![m])[..]).unwrap();
        assert_eq!(metric_to_tagvalue(&pl.metrics[0]), Some(TagValue::Int(123_456_789)));
    }

    #[test]
    fn gli_altri_quattro_tipi_del_oneof() {
        for (campo, dt, atteso) in [
            (FLOAT_VALUE, 9u64, TagValue::Float(1.5)),
            (BOOLEAN_VALUE, 11, TagValue::Bool(true)),
        ] {
            let mut m = Vec::new();
            specifica::stringa(NOME, "x", &mut m);
            specifica::vint(DATATYPE, dt, &mut m);
            match campo {
                FLOAT_VALUE => specifica::fisso32(campo, 1.5, &mut m),
                _ => specifica::vint(campo, 1, &mut m),
            }
            let pl = Payload::decode(&payload(vec![m])[..]).unwrap();
            assert_eq!(metric_to_tagvalue(&pl.metrics[0]), Some(atteso), "campo {campo}");
        }
        let mut m = Vec::new();
        specifica::stringa(NOME, "x", &mut m);
        specifica::vint(DATATYPE, 12, &mut m);
        specifica::stringa(STRING_VALUE, "ciao", &mut m);
        let pl = Payload::decode(&payload(vec![m])[..]).unwrap();
        assert_eq!(metric_to_tagvalue(&pl.metrics[0]), Some(TagValue::Str("ciao".into())));
    }

    /// I tipi con segno viaggiano dentro campi **senza** segno: un −1 arriva
    /// come 4 294 967 295, e va riletto col tipo dichiarato. Stesso difetto
    /// che la Fase 3 ha tolto a Modbus sugli `i16`.
    #[test]
    fn i_tipi_con_segno_si_rileggono_col_tipo_dichiarato() {
        for (dt, grezzo, atteso) in [
            (1u64, 0xFFu64, -1i64),         // Int8
            (2, 0xFFFF, -1),                // Int16
            (3, 0xFFFF_FFFF, -1),           // Int32
            (3, 0xFFFF_FFFE, -2),           // Int32
            (7, 0xFFFF_FFFF, 4_294_967_295), // UInt32: resta positivo
        ] {
            let mut m = Vec::new();
            specifica::stringa(NOME, "x", &mut m);
            specifica::vint(DATATYPE, dt, &mut m);
            specifica::vint(INT_VALUE, grezzo, &mut m);
            let pl = Payload::decode(&payload(vec![m])[..]).unwrap();
            assert_eq!(
                metric_to_tagvalue(&pl.metrics[0]),
                Some(TagValue::Int(atteso)),
                "datatype {dt}, grezzo {grezzo}"
            );
        }
    }

    /// `is_null` è il campo 7 — dove prima stava il nostro `int_value`. Una
    /// metrica dichiarata nulla arrivava quindi come il **valore 1**.
    #[test]
    fn una_metrica_nulla_non_diventa_il_valore_uno() {
        let mut m = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut m);
        specifica::vint(DATATYPE, 10, &mut m);
        specifica::vint(IS_NULL, 1, &mut m);

        let pl = Payload::decode(&payload(vec![m])[..]).unwrap();
        assert_eq!(pl.metrics[0].is_null, Some(true));
        assert_eq!(
            metric_to_tagvalue(&pl.metrics[0]),
            None,
            "nulla vuol dire «non ho un dato», non «vale zero»"
        );
    }

    /// Una nascita con `metadata` (campo 8, un messaggio) faceva cadere tutto,
    /// perché noi dichiaravamo un `uint64` su quel numero. Adesso il campo non
    /// lo conosciamo, e un campo ignoto prost lo salta — qualunque sia il suo
    /// tipo di wire. È la ragione per cui **non** dichiariamo 5, 6, 8, 9 e
    /// 16-19.
    #[test]
    fn i_campi_che_non_conosciamo_si_saltano() {
        let mut meta = Vec::new();
        specifica::stringa(1, "qualcosa", &mut meta);
        let mut m = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut m);
        specifica::vint(5, 1, &mut m); // is_historical
        specifica::vint(6, 0, &mut m); // is_transient
        specifica::blocco(8, &meta, &mut m); // metadata
        specifica::blocco(9, &meta, &mut m); // properties
        specifica::vint(DATATYPE, 10, &mut m);
        specifica::fisso64(DOUBLE_VALUE, 3.25, &mut m);
        specifica::blocco(16, b"xyz", &mut m); // bytes_value

        let pl = Payload::decode(&payload(vec![m])[..])
            .expect("i campi che non usiamo non devono far cadere il payload");
        assert_eq!(metric_to_tagvalue(&pl.metrics[0]), Some(TagValue::Float(3.25)));
    }

    // ── L'alias, dall'ingresso al TagDb ────────────────────────────────────

    fn cfg_di_prova() -> SparkplugConfig {
        SparkplugConfig {
            group_id: "plant-a".into(),
            host_id: "SWS-SCADA".into(),
            metrics: vec![SparkplugMetricMapping {
                metric_name: "Pump/Speed".into(),
                tag: "pompa.velocita".into(),
                writable: false,
            }],
        }
    }

    async fn valore(db: &TagDb, tag: &str) -> Option<TagValue> {
        db.get(tag).await.map(|s| s.value)
    }

    /// Il modo **normale** di lavorare di Sparkplug: la nascita porta nome e
    /// alias, i dati portano solo l'alias. Prima scartavamo ogni metrica senza
    /// nome, quindi di un impianto così non arrivava **niente**, in silenzio.
    #[tokio::test]
    async fn i_dati_che_portano_solo_l_alias_arrivano() {
        let db = TagDb::new(16);
        let spb = cfg_di_prova();
        let mut stato = Stato::nuovo(&spb);

        let mut nascita = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut nascita);
        specifica::vint(ALIAS, 7, &mut nascita);
        specifica::vint(DATATYPE, 10, &mut nascita);
        specifica::fisso64(DOUBLE_VALUE, 10.0, &mut nascita);
        handle_message(
            "spBv1.0/plant-a/NBIRTH/edge1",
            &payload(vec![nascita]),
            &db, &spb, &mut stato,
        ).await;
        assert_eq!(valore(&db, "pompa.velocita").await, Some(TagValue::Float(10.0)));

        let mut dato = Vec::new();
        specifica::vint(ALIAS, 7, &mut dato); // solo l'alias, nessun nome
        specifica::fisso64(DOUBLE_VALUE, 42.0, &mut dato);
        handle_message(
            "spBv1.0/plant-a/NDATA/edge1",
            &payload(vec![dato]),
            &db, &spb, &mut stato,
        ).await;
        assert_eq!(valore(&db, "pompa.velocita").await, Some(TagValue::Float(42.0)));
    }

    /// Due nodi possono usare lo stesso numero per metriche diverse: l'alias
    /// vale dentro un ambito. Se la chiave fosse il solo numero, il dato di
    /// `edge2` finirebbe sul tag di `edge1`.
    #[tokio::test]
    async fn l_alias_di_un_nodo_non_vale_per_un_altro() {
        let db = TagDb::new(16);
        let spb = cfg_di_prova();
        let mut stato = Stato::nuovo(&spb);

        let mut nascita = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut nascita);
        specifica::vint(ALIAS, 7, &mut nascita);
        specifica::vint(DATATYPE, 10, &mut nascita);
        specifica::fisso64(DOUBLE_VALUE, 1.0, &mut nascita);
        handle_message("spBv1.0/plant-a/NBIRTH/edge1", &payload(vec![nascita]), &db, &spb, &mut stato).await;

        let mut dato = Vec::new();
        specifica::vint(ALIAS, 7, &mut dato);
        specifica::fisso64(DOUBLE_VALUE, 99.0, &mut dato);
        handle_message("spBv1.0/plant-a/NDATA/edge2", &payload(vec![dato]), &db, &spb, &mut stato).await;

        assert_eq!(
            valore(&db, "pompa.velocita").await,
            Some(TagValue::Float(1.0)),
            "l'alias 7 di edge2 non è quello di edge1"
        );
    }

    /// Una nascita nuova ribattezza: gli alias di prima non valgono più.
    /// Tenerli vorrebbe dire, dopo un riavvio del nodo, scrivere il valore di
    /// una metrica sul tag di un'altra.
    #[tokio::test]
    async fn una_nascita_nuova_cancella_gli_alias_di_prima() {
        let db = TagDb::new(16);
        let spb = cfg_di_prova();
        let mut stato = Stato::nuovo(&spb);

        let mut prima = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut prima);
        specifica::vint(ALIAS, 7, &mut prima);
        specifica::vint(DATATYPE, 10, &mut prima);
        specifica::fisso64(DOUBLE_VALUE, 1.0, &mut prima);
        handle_message("spBv1.0/plant-a/NBIRTH/edge1", &payload(vec![prima]), &db, &spb, &mut stato).await;

        // Rinasce, e stavolta Pump/Speed ha l'alias 9.
        let mut dopo = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut dopo);
        specifica::vint(ALIAS, 9, &mut dopo);
        specifica::vint(DATATYPE, 10, &mut dopo);
        specifica::fisso64(DOUBLE_VALUE, 2.0, &mut dopo);
        handle_message("spBv1.0/plant-a/NBIRTH/edge1", &payload(vec![dopo]), &db, &spb, &mut stato).await;

        // Il 7 non vuol più dire niente: un dato che lo usa si scarta.
        let mut vecchio = Vec::new();
        specifica::vint(ALIAS, 7, &mut vecchio);
        specifica::fisso64(DOUBLE_VALUE, 777.0, &mut vecchio);
        handle_message("spBv1.0/plant-a/NDATA/edge1", &payload(vec![vecchio]), &db, &spb, &mut stato).await;
        assert_eq!(valore(&db, "pompa.velocita").await, Some(TagValue::Float(2.0)));

        // Il 9 sì.
        let mut nuovo = Vec::new();
        specifica::vint(ALIAS, 9, &mut nuovo);
        specifica::fisso64(DOUBLE_VALUE, 3.0, &mut nuovo);
        handle_message("spBv1.0/plant-a/NDATA/edge1", &payload(vec![nuovo]), &db, &spb, &mut stato).await;
        assert_eq!(valore(&db, "pompa.velocita").await, Some(TagValue::Float(3.0)));
    }

    /// Una metrica nulla non riscrive il valore: lo tiene e dice che non è più
    /// buono. Prima scriveva uno zero inventato.
    #[tokio::test]
    async fn una_metrica_nulla_tiene_il_valore_e_segna_incerto() {
        let db = TagDb::new(16);
        let spb = cfg_di_prova();
        let mut stato = Stato::nuovo(&spb);

        let mut buono = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut buono);
        specifica::vint(DATATYPE, 10, &mut buono);
        specifica::fisso64(DOUBLE_VALUE, 12.5, &mut buono);
        handle_message("spBv1.0/plant-a/NDATA/edge1", &payload(vec![buono]), &db, &spb, &mut stato).await;

        let mut nullo = Vec::new();
        specifica::stringa(NOME, "Pump/Speed", &mut nullo);
        specifica::vint(DATATYPE, 10, &mut nullo);
        specifica::vint(IS_NULL, 1, &mut nullo);
        handle_message("spBv1.0/plant-a/NDATA/edge1", &payload(vec![nullo]), &db, &spb, &mut stato).await;

        let st = db.get("pompa.velocita").await.expect("il tag esiste");
        assert_eq!(st.value, TagValue::Float(12.5), "il valore buono resta");
        assert_eq!(st.quality, TagQuality::Uncertain, "ma non è più buono");
    }

    /// Il comando che spediamo deve essere leggibile da chi lo riceve: stessi
    /// numeri di campo, e il **tipo dichiarato**, che prima non mettevamo.
    #[test]
    fn il_comando_porta_il_tipo_e_i_numeri_giusti() {
        let byte = build_cmd_payload("Pump/Setpoint", &TagValue::Float(7.5));
        let pl = Payload::decode(&byte[..]).unwrap();
        assert_eq!(pl.metrics[0].name.as_deref(), Some("Pump/Setpoint"));
        assert_eq!(pl.metrics[0].datatype, Some(10), "Double");
        assert_eq!(metric_to_tagvalue(&pl.metrics[0]), Some(TagValue::Float(7.5)));

        // E il campo usato è davvero il 13: lo si cerca nei byte grezzi.
        let mut chiave = Vec::new();
        specifica::varint(u64::from((DOUBLE_VALUE << 3) | 1), &mut chiave);
        assert!(
            byte.windows(chiave.len()).any(|w| w == chiave),
            "il valore non è sul campo 13 della specifica"
        );
    }

    // ── A chi va un comando, e chi tocca una morte (29-10-2026) ────────────

    fn due_metriche() -> SparkplugConfig {
        SparkplugConfig {
            group_id: "plant-a".into(),
            host_id: "SWS-SCADA".into(),
            metrics: vec![
                SparkplugMetricMapping { metric_name: "Pump/Speed".into(), tag: "pompa.velocita".into(), writable: true },
                SparkplugMetricMapping { metric_name: "Valve/Open".into(), tag: "valvola.aperta".into(), writable: true },
            ],
        }
    }

    fn metrica(nome: &str, v: f64) -> Vec<u8> {
        let mut m = Vec::new();
        specifica::stringa(NOME, nome, &mut m);
        specifica::vint(DATATYPE, 10, &mut m);
        specifica::fisso64(DOUBLE_VALUE, v, &mut m);
        m
    }

    async fn qualita(db: &TagDb, tag: &str) -> TagQuality {
        db.get(tag).await.expect("il tag esiste").quality
    }

    /// Il comando andava a `NCMD/<host_id>`, cioè al nome di SWS: nessun nodo
    /// ascolta lì. Va al nodo che ha annunciato la metrica, o al suo
    /// dispositivo con DCMD — e prima della nascita a nessuno.
    #[tokio::test]
    async fn il_comando_va_a_chi_ha_annunciato_la_metrica() {
        let db = TagDb::new(16);
        let spb = due_metriche();
        let mut stato = Stato::nuovo(&spb);
        assert_eq!(stato.comando("plant-a", 0), None, "prima della nascita non si sa a chi");

        handle_message("spBv1.0/plant-a/NBIRTH/edge1", &payload(vec![metrica("Pump/Speed", 1.0)]), &db, &spb, &mut stato).await;
        handle_message("spBv1.0/plant-a/DBIRTH/edge1/pump3", &payload(vec![metrica("Valve/Open", 0.0)]), &db, &spb, &mut stato).await;

        assert_eq!(stato.comando("plant-a", 0), Some(("spBv1.0/plant-a/NCMD/edge1".into(), true)));
        assert_eq!(stato.comando("plant-a", 1), Some(("spBv1.0/plant-a/DCMD/edge1/pump3".into(), true)));
    }

    /// La morte di un nodo marcava `Bad` i tag di tutto il gruppo.
    #[tokio::test]
    async fn la_morte_di_un_nodo_tocca_solo_i_suoi_tag() {
        let db = TagDb::new(16);
        let spb = due_metriche();
        let mut stato = Stato::nuovo(&spb);
        handle_message("spBv1.0/plant-a/NBIRTH/edge1", &payload(vec![metrica("Pump/Speed", 1.0)]), &db, &spb, &mut stato).await;
        handle_message("spBv1.0/plant-a/NBIRTH/edge2", &payload(vec![metrica("Valve/Open", 1.0)]), &db, &spb, &mut stato).await;

        handle_message("spBv1.0/plant-a/NDEATH/edge1", &payload(vec![]), &db, &spb, &mut stato).await;

        assert_eq!(qualita(&db, "pompa.velocita").await, TagQuality::Bad);
        assert_eq!(qualita(&db, "valvola.aperta").await, TagQuality::Good, "edge2 è vivo");
        assert_eq!(stato.comando("plant-a", 0).map(|(_, v)| v), Some(false), "il comando parte, ma il nodo è morto");
    }

    /// Un dispositivo che muore non si porta via il nodo; il nodo che muore
    /// si porta via i suoi dispositivi.
    #[tokio::test]
    async fn la_morte_di_un_dispositivo_lascia_stare_il_nodo() {
        let db = TagDb::new(16);
        let spb = due_metriche();
        let mut stato = Stato::nuovo(&spb);
        handle_message("spBv1.0/plant-a/NBIRTH/edge1", &payload(vec![metrica("Pump/Speed", 1.0)]), &db, &spb, &mut stato).await;
        handle_message("spBv1.0/plant-a/DBIRTH/edge1/pump3", &payload(vec![metrica("Valve/Open", 1.0)]), &db, &spb, &mut stato).await;

        handle_message("spBv1.0/plant-a/DDEATH/edge1/pump3", &payload(vec![]), &db, &spb, &mut stato).await;
        assert_eq!(qualita(&db, "valvola.aperta").await, TagQuality::Bad);
        assert_eq!(qualita(&db, "pompa.velocita").await, TagQuality::Good);

        handle_message("spBv1.0/plant-a/DBIRTH/edge1/pump3", &payload(vec![metrica("Valve/Open", 2.0)]), &db, &spb, &mut stato).await;
        handle_message("spBv1.0/plant-a/NDEATH/edge1", &payload(vec![]), &db, &spb, &mut stato).await;
        assert_eq!(qualita(&db, "valvola.aperta").await, TagQuality::Bad, "il dispositivo muore col suo nodo");
        assert_eq!(qualita(&db, "pompa.velocita").await, TagQuality::Bad);
    }

    /// Lo stato dell'host nella forma della 3.0: JSON con `online` e
    /// `timestamp`, lo stesso istante nel testamento e nella nascita.
    #[test]
    fn lo_stato_dell_host_e_quello_della_3_0() {
        assert_eq!(topic_stato_host("SWS-SCADA"), "spBv1.0/STATE/SWS-SCADA");
        let nascita: serde_json::Value = serde_json::from_str(&stato_host(true, 1_700_000_000_123)).unwrap();
        let morte: serde_json::Value = serde_json::from_str(&stato_host(false, 1_700_000_000_123)).unwrap();
        assert_eq!(nascita["online"], serde_json::json!(true));
        assert_eq!(morte["online"], serde_json::json!(false));
        assert_eq!(nascita["timestamp"], morte["timestamp"]);
    }
}
