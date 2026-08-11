//! Client REST/WS verso un runtime `sws-web` già in esecuzione — stesso ruolo
//! che oggi ha il browser (o `sws-kiosk`): legge lo schema della pagina via
//! REST e resta iscritto a `/ws/tags` per tutta la durata della finestra,
//! aggiornando uno stato condiviso (`SharedTagSnapshot`) via snapshot iniziale
//! + delta successivi. Vedi ADR 0002: nessuna modifica al runtime, questo
//! client consuma solo il contratto REST/WS già esistente per il browser.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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

/// Elenca i nomi file (senza estensione) delle pagine del progetto attivo —
/// `GET /api/synoptics`, stessi nomi accettati da `fetch_page`. **Non** gli
/// `id:` interni delle pagine (l'endpoint non li espone, vedi
/// `resolve_page_by_id` per il motivo per cui serve comunque).
async fn list_synoptics(base_url: &str) -> anyhow::Result<Vec<String>> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("synoptics");
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Vec<String>>().await?)
}

/// Risolve un `navbutton.target_page` (l'`id:` **interno** della pagina di
/// destinazione — stessa convenzione del navbutton web, vedi
/// `SvgCanvas.tsx`/lo store dell'editor) nella pagina corrispondente.
///
/// **Non lo stesso valore del nome file**: `GET /api/synoptics/:name`
/// (`fetch_page`) risolve per nome file (`sws-web/src/router.rs`,
/// `get_synoptic`: `format!("{name}.yaml")`), ma i `navbutton` puntano
/// all'`id:` interno della pagina — spesso coincidono per abitudine (l'IDE
/// li fa combaciare quando genera l'id da un nome semplice), ma non è
/// garantito, quindi non si può assumere. `GET /api/synoptics` restituisce
/// solo i nomi file, non gli id, quindi l'unico modo corretto è elencare le
/// pagine e leggerne l'`id:` una per una finché non si trova quella giusta —
/// accettabile per un progetto demo con poche pagine, non scalerebbe a
/// centinaia. Se nessuna pagina ha quell'id, riprova a interpretare
/// `target_page` come nome file direttamente: fallback permissivo per chi
/// scrive comunque il filename (funziona comunque se combaciano).
pub async fn resolve_page_by_id(base_url: &str, target_page_id: &str) -> anyhow::Result<SynopticPage> {
    let names = list_synoptics(base_url).await?;
    for name in &names {
        if let Ok(page) = fetch_page(base_url, name).await {
            if page.id.as_deref() == Some(target_page_id) {
                return Ok(page);
            }
        }
    }
    fetch_page(base_url, target_page_id).await
}

/// Scrive un valore su un tag — stesso endpoint REST usato dall'editor web
/// (`PUT /api/tags/:id`, body `{"value": ...}`, `TagValue` è `#[serde(untagged)]`
/// quindi serializza come scalare JSON nativo). Chiamata da un task spawnato
/// sul runtime tokio del processo (`Handle::spawn`, non dentro la callback
/// FFI sincrona di LVGL — vedi `lvgl_render.rs`), quindi può restare async.
pub async fn put_tag(base_url: &str, tag: &str, value: TagValue) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("tags")
        .push(tag);

    #[derive(serde::Serialize)]
    struct WriteTagBody {
        value: TagValue,
    }

    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    client.put(url).json(&WriteTagBody { value }).send().await?.error_for_status()?;
    Ok(())
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

#[derive(Debug, Deserialize)]
struct WsDeltaMsg {
    #[serde(rename = "type")]
    ty: String,
    #[serde(default)]
    changed: Vec<WsTagEntry>,
}

/// Valore + qualità di un tag, senza il timestamp (non ci serve per il
/// rendering) — evita di dover rinominare `ts` → `timestamp_ms` per riusare
/// `sws_core::TagState` di peso.
#[derive(Clone)]
pub struct TagSnapshotValue {
    pub value: TagValue,
    pub quality: TagQuality,
}

pub type TagSnapshot = HashMap<String, TagSnapshotValue>;

/// Stato condiviso tra il task WS in background (che scrive) e il loop di
/// rendering sul thread principale (che legge a ogni frame). `Mutex` invece
/// di un canale: il loop di rendering vuole sempre e solo "lo stato più
/// recente", non la sequenza di eventi intermedi — un lock breve e frequente
/// è più semplice di un canale con backpressure/coalescing a mano.
pub type SharedTagSnapshot = Arc<Mutex<TagSnapshot>>;

fn apply_entries(map: &mut TagSnapshot, entries: Vec<WsTagEntry>) {
    for t in entries {
        map.insert(t.id, TagSnapshotValue { value: t.value, quality: t.quality });
    }
}

fn ws_url(base_url: &str) -> anyhow::Result<String> {
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
    Ok(ws_url.to_string())
}

/// Si connette a `/ws/tags`, attende lo snapshot iniziale (bloccante — il
/// chiamante ha bisogno dei valori subito, per creare i widget la prima
/// volta), poi resta iscritto in un task in background che aggiorna lo
/// stato condiviso a ogni delta successivo per tutta la durata del processo.
/// La connessione non viene mai chiusa esplicitamente: muore con il processo
/// (comportamento accettabile per un viewer che gira finché non lo chiudi).
pub async fn spawn_tag_subscription(base_url: &str) -> anyhow::Result<SharedTagSnapshot> {
    let url = ws_url(base_url)?;
    let connector = tokio_tungstenite::Connector::Rustls(insecure_client_config());
    let (mut stream, _resp) =
        tokio_tungstenite::connect_async_tls_with_config(url.as_str(), None, false, Some(connector)).await?;

    // Blocca finché non arriva lo snapshot iniziale — i widget non possono
    // essere creati con valori mancanti.
    let initial = loop {
        let Some(msg) = stream.next().await else {
            anyhow::bail!("/ws/tags si è chiuso senza inviare uno snapshot");
        };
        let msg = msg?;
        let Message::Text(text) = msg else {
            if matches!(msg, Message::Close(_)) {
                anyhow::bail!("/ws/tags chiuso prima dello snapshot");
            }
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<WsSnapshotMsg>(&text) else { continue };
        if parsed.ty != "snapshot" {
            continue;
        }
        let mut map = TagSnapshot::new();
        apply_entries(&mut map, parsed.tags);
        break map;
    };

    let shared: SharedTagSnapshot = Arc::new(Mutex::new(initial));
    let shared_bg = shared.clone();

    // Task in background: vive quanto il runtime tokio (main.rs lo tiene in
    // vita per tutto il programma). Nessun canale di shutdown esplicito —
    // il task termina da solo quando la connessione si chiude (es. runtime
    // fermato) e il processo comunque esce quando si chiude la finestra.
    tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            let msg = match msg {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("[ws] errore su /ws/tags: {e} — interrotto l'aggiornamento live");
                    return;
                }
            };
            let Message::Text(text) = msg else {
                if matches!(msg, Message::Close(_)) {
                    eprintln!("[ws] /ws/tags chiuso dal server — interrotto l'aggiornamento live");
                    return;
                }
                continue;
            };
            // Un delta e uno snapshot hanno campi diversi (`changed` vs
            // `tags`) ma lo stesso discriminante "type" — proviamo prima il
            // delta (il caso comune dopo l'avvio), poi lo snapshot (caso raro:
            // il server ne rimanda uno, es. dopo una riconnessione interna).
            if let Ok(delta) = serde_json::from_str::<WsDeltaMsg>(&text) {
                if delta.ty == "delta" {
                    let mut map = shared_bg.lock().unwrap_or_else(|e| e.into_inner());
                    apply_entries(&mut map, delta.changed);
                    continue;
                }
            }
            if let Ok(snap) = serde_json::from_str::<WsSnapshotMsg>(&text) {
                if snap.ty == "snapshot" {
                    let mut map = shared_bg.lock().unwrap_or_else(|e| e.into_inner());
                    apply_entries(&mut map, snap.tags);
                }
            }
        }
        eprintln!("[ws] connessione /ws/tags terminata — i valori non si aggiorneranno più");
    });

    Ok(shared)
}
