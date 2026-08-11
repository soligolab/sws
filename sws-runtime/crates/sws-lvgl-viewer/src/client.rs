//! Client REST/WS verso un runtime `sws-web` già in esecuzione — stesso ruolo
//! che oggi ha il browser (o `sws-kiosk`): legge lo schema della pagina via
//! REST e i valori correnti dei tag via il primo messaggio "snapshot" di
//! `/ws/tags`. Nessuna scrittura, nessuna sottoscrizione continua — per
//! l'MVP (rendering di un singolo frame) uno snapshot iniziale basta. Vedi
//! ADR 0002: nessuna modifica al runtime, questo client consuma solo il
//! contratto REST/WS già esistente per il browser.

use std::collections::HashMap;

use futures_util::StreamExt;
use serde::Deserialize;
use sws_core::tag::{TagQuality, TagValue};
use tokio_tungstenite::tungstenite::Message;

use crate::model::SynopticPage;
use crate::tls::insecure_client_config;

pub async fn fetch_page(base_url: &str, page_name: &str) -> anyhow::Result<SynopticPage> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("synoptics")
        .push(page_name);

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true) // vedi tls.rs: stesso runtime, stesso cert self-signed
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let page = resp.json::<SynopticPage>().await?;
    Ok(page)
}

#[derive(Debug, Deserialize)]
struct WsTagEntry {
    id: String,
    value: TagValue,
    quality: TagQuality,
}

#[derive(Debug, Deserialize)]
struct WsSnapshotMsg {
    #[serde(rename = "type")]
    ty: String,
    #[serde(default)]
    tags: Vec<WsTagEntry>,
}

/// Valore + qualità di un tag, senza il timestamp (non serve per un frame
/// statico) — evita di dover rinominare `ts` → `timestamp_ms` per riusare
/// `sws_core::TagState` di peso.
pub struct TagSnapshotValue {
    pub value: TagValue,
    pub quality: TagQuality,
}

pub type TagSnapshot = HashMap<String, TagSnapshotValue>;

/// Si connette a `/ws/tags`, legge il primo messaggio `"type":"snapshot"` e
/// chiude la connessione. Non sottoscrive delta successivi (MVP one-shot).
pub async fn fetch_tag_snapshot(base_url: &str) -> anyhow::Result<TagSnapshot> {
    let mut ws_url = reqwest::Url::parse(base_url)?;
    let new_scheme = match ws_url.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => anyhow::bail!("schema URL non supportato: {other}"),
    };
    ws_url
        .set_scheme(new_scheme)
        .map_err(|_| anyhow::anyhow!("impossibile impostare lo schema WS"))?;
    ws_url.set_path("/ws/tags");

    let connector = tokio_tungstenite::Connector::Rustls(insecure_client_config());
    let (mut stream, _resp) = tokio_tungstenite::connect_async_tls_with_config(
        ws_url.as_str(),
        None,
        false,
        Some(connector),
    )
    .await?;

    while let Some(msg) = stream.next().await {
        let msg = msg?;
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => anyhow::bail!("/ws/tags chiuso prima dello snapshot"),
            _ => continue,
        };
        let parsed: WsSnapshotMsg = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(_) => continue, // messaggio non riconosciuto (es. un formato futuro) — ignora e continua
        };
        if parsed.ty != "snapshot" {
            continue;
        }
        let mut out = TagSnapshot::new();
        for t in parsed.tags {
            out.insert(
                t.id,
                TagSnapshotValue {
                    value: t.value,
                    quality: t.quality,
                },
            );
        }
        return Ok(out);
    }
    anyhow::bail!("/ws/tags si è chiuso senza inviare uno snapshot")
}
