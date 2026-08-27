//! Client REST/WS verso un runtime `sws-web` già in esecuzione — stesso ruolo
//! che oggi ha il browser (o `sws-kiosk`): legge lo schema della pagina via
//! REST e resta iscritto a `/ws/tags` per tutta la durata della finestra,
//! aggiornando uno stato condiviso (`SharedTagSnapshot`) via snapshot iniziale
//! + delta successivi. Vedi ADR 0002: nessuna modifica al runtime, questo
//! client consuma solo il contratto REST/WS già esistente per il browser.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::Deserialize;
use sws_core::tag::{TagQuality, TagValue};
use tokio_tungstenite::tungstenite::Message;

use crate::model::{FaceplateDef, LanguageTable, RecipeListEntry, SynopticPage};
use crate::tls::insecure_client_config;

/// Lingua *corrente* del progetto (codice, es. `"it"`) — mutabile, a
/// differenza della `LanguageTable` (tabella token→traduzioni, fissa per
/// tutta la sessione). Cambiata dal click su `lang_button`/`lang_selector`
/// (vedi `lvgl_render.rs`), letta a ogni caricamento/ricarica di pagina per
/// risolvere i token `{{key}}` nella lingua giusta — stesso principio di
/// `projectLang` in `src/store/index.ts` lato editor, ma un valore
/// process-wide invece che nello store di un browser (questo motore non ha
/// mai avuto un concetto di sessione per-tab).
pub type SharedLang = Arc<Mutex<String>>;

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

/// `GET /api/faceplates/:id` — stesso endpoint anonymous-readable usato
/// dall'editor, registrato anche nel gruppo di route del viewer (vedi
/// `sws-web/src/router.rs`, righe 517-518), quindi nessun header
/// `Authorization` qui, stesso principio di `fetch_page`.
pub async fn fetch_faceplate(base_url: &str, id: &str) -> anyhow::Result<FaceplateDef> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("faceplates")
        .push(id);

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let def = resp.json::<FaceplateDef>().await?;
    Ok(def)
}

/// `GET /api/recipes` — elenco statico (`{id, name, setpoints_count}`, non
/// `RecipeDef` completo — l'endpoint non espone i setpoint stessi, non
/// servono per mostrare la lista). Chiamata una sola volta al caricamento
/// della pagina (`render_recipe_panel`), non ripetuta a intervalli: la
/// lista ricette cambia raramente durante una sessione, un poller sarebbe
/// I/O ricorrente per un dato quasi statico — gap dichiarato (lista non
/// aggiornata se le ricette cambiano mentre la pagina è aperta).
pub async fn fetch_recipes(base_url: &str) -> anyhow::Result<Vec<RecipeListEntry>> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("recipes");
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let list = resp.json::<Vec<RecipeListEntry>>().await?;
    Ok(list)
}

/// `POST /api/recipes/:id/apply` — stesso principio di `client::put_tag`:
/// nessun header `Authorization` (rotta anonymous-writable sul gruppo
/// route viewer, stesso trattamento già riservato a `PUT /api/tags/:id` e
/// `POST /api/alarms/:id/ack`). `applied_by` fisso a `"lvgl"` così un
/// operatore che guarda lo storico applicazioni sa che è arrivata da questo
/// motore, non da un utente autenticato via editor/viewer web.
pub async fn apply_recipe(base_url: String, id: String) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(&base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("recipes")
        .push(&id)
        .push("apply");
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    client
        .post(url)
        .json(&serde_json::json!({ "applied_by": "lvgl" }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// `GET /api/project` — restituisce l'intero `Project` (`sws-core::project`),
/// di cui a questo motore serve solo `languages`. Deserializzato in un
/// wrapper minimo invece che nel `Project` completo (che ha ~30 campi non
/// pertinenti): stesso principio di tolleranza già spiegato in cima a
/// `model.rs`, i campi non dichiarati vengono ignorati da serde, non
/// generano errori. Anonymous-readable (stesso gruppo di route del viewer
/// di `fetch_page`/`fetch_faceplate`), nessun header `Authorization`.
pub async fn fetch_languages(base_url: &str) -> anyhow::Result<LanguageTable> {
    #[derive(Deserialize)]
    struct ProjectLanguagesOnly {
        #[serde(default)]
        languages: LanguageTable,
    }
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("project");
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let wrapper = resp.json::<ProjectLanguagesOnly>().await?;
    Ok(wrapper.languages)
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
/// La pagina da cui partire quando nessuno l'ha detto (`--page` assente).
///
/// Serve perché il viewer possa essere avviato da una unit systemd scritta una
/// volta sola. Finché `--page` era obbligatorio, sul WP630 era cablato a
/// `"Grafici e tabelle"`: al primo progetto diverso quella unit puntava a una
/// pagina inesistente, e il viewer non partiva — senza che il nome della
/// pagina sbagliata comparisse da nessuna parte se non nel comando.
///
/// Ordine: la *home page* dichiarata dal progetto, poi la prima pagina in
/// elenco. Il ripiego non è pigrizia: un progetto senza home page dichiarata è
/// la maggioranza, e mostrare la prima pagina è meglio che non mostrare nulla.
/// Un evento dello storico allarmi, come lo restituisce `GET /api/alarms/history`.
///
/// Solo i campi che la tabella mostra. `AlarmEvent` lato runtime ne ha altri
/// (chi ha confermato, la durata, quando è rientrato): dichiararli qui senza
/// disegnarli darebbe l'impressione che siano usati.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AlarmHistoryEvent {
    pub alarm_id: String,
    #[serde(default)]
    pub alarm_message: String,
    pub ts_activated_ms: u64,
    #[serde(default)]
    pub ts_acked_ms: Option<u64>,
}

/// Lo storico allarmi, il più recente per primo.
///
/// `alarm_id` filtra su un allarme solo — è il campo `alarm_history_id`
/// dell'oggetto synottico; `None` li prende tutti, come fa il web quando quel
/// campo non è impostato.
pub async fn fetch_alarm_history(
    base_url: &str,
    alarm_id: Option<&str>,
    limit: usize,
) -> anyhow::Result<Vec<AlarmHistoryEvent>> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("alarms")
        .push("history");
    url.query_pairs_mut().append_pair("limit", &limit.to_string());
    if let Some(id) = alarm_id {
        url.query_pairs_mut().append_pair("alarm_id", id);
    }
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Vec<AlarmHistoryEvent>>().await?)
}

pub async fn resolve_start_page(base_url: &str) -> anyhow::Result<SynopticPage> {
    let dichiarata = fetch_home_page_id(base_url).await;
    if let Some(id) = &dichiarata {
        match resolve_page_by_id(base_url, id).await {
            Ok(p) => {
                eprintln!("[avvio] pagina iniziale dal progetto: '{}'", p.name);
                return Ok(p);
            }
            // Una home page dichiarata ma irrisolvibile è un progetto
            // incoerente, non un motivo per non mostrare niente: si dice e si
            // ripiega.
            Err(e) => eprintln!("[avvio] home_page_id '{id}' non risolvibile ({e})"),
        }
    }
    let names = list_synoptics(base_url).await?;
    let prima = names
        .first()
        .ok_or_else(|| anyhow::anyhow!("il progetto non ha nessuna pagina synottico"))?;
    // Il motivo del ripiego cambia il messaggio: dire "nessuna home page
    // dichiarata" dopo aver appena detto che quella dichiarata non si risolve
    // sono due righe che si contraddicono, e chi legge il log si chiede quale
    // delle due sia vera.
    match &dichiarata {
        Some(_) => eprintln!("[avvio] ripiego sulla prima pagina: '{prima}'"),
        None => eprintln!("[avvio] nessuna home page dichiarata, uso la prima: '{prima}'"),
    }
    fetch_page(base_url, prima).await
}

/// `home_page_id` dal progetto, se c'è.
///
/// `None` copre tutti i casi in cui non si può sapere — progetto non
/// leggibile, `page_layout` assente, campo non impostato — perché per chi
/// chiama sono la stessa cosa: si ripiega sulla prima pagina.
async fn fetch_home_page_id(base_url: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Layout {
        #[serde(default)]
        home_page_id: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct Progetto {
        #[serde(default)]
        page_layout: Option<Layout>,
    }
    let url = format!("{}/api/project", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build().ok()?;
    let resp = client.get(&url).send().await.ok()?;
    resp.json::<Progetto>().await.ok()?.page_layout?.home_page_id
}

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

/// Timestamp Unix in millisecondi — usato per calcolare la finestra
/// `from`/`to` di `fetch_history` e, in `lvgl_render`'s Trend, per convertire
/// i timestamp assoluti dei campioni in coordinate X relative alla finestra
/// (`lv_coord_t` è un `i16`: non regge un Unix ms assoluto, vedi `render_trend`).
pub fn now_unix_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Un campione storico — porta `Sample` di `sws-historian` (`ts_ms`, `value`,
/// `quality`) ma senza `quality`: il trend LVGL non la disegna (il web
/// nemmeno, in `TrendCanvas`), stesso principio di `TagSnapshotValue` sotto
/// che non porta il timestamp perché quello non serve a lei.
#[derive(Debug, Deserialize, Clone)]
pub struct HistorySample {
    pub ts_ms: u64,
    pub value: TagValue,
}

/// `GET /api/history/:tag?from=&to=&backfill=` — stesso endpoint REST
/// consumato dal web (`TrendCanvas.tsx` via `api.getHistory`), sulla porta
/// viewer (anonymous-readable, `sws-web/src/router.rs`).
pub async fn fetch_history(
    base_url: &str,
    tag: &str,
    from_ms: u64,
    to_ms: u64,
    backfill: bool,
) -> anyhow::Result<Vec<HistorySample>> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("history")
        .push(tag);
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("from", &from_ms.to_string());
        q.append_pair("to", &to_ms.to_string());
        if backfill {
            q.append_pair("backfill", "true");
        }
    }
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Vec<HistorySample>>().await?)
}

/// Stato condiviso tra il task di polling in background (che scrive) e il
/// loop di rendering (che legge a ogni frame dentro `update_bindings`) — un
/// `(u64, Vec<HistorySample>)` invece del solo `Vec` come `SharedTagSnapshot`:
/// il contatore di versione dà al lettore un modo economico per sapere "sono
/// arrivati dati nuovi da quando ho ridisegnato l'ultima volta" senza
/// confrontare l'intero vettore a 60fps — un `lv_chart_refresh` a ogni frame
/// anche quando i dati non cambiano (il poll è ogni 2s, il rendering a
/// 60fps) sprecherebbe redraw veri su un pannello embedded, non solo cicli
/// CPU astratti.
pub type SharedHistory = Arc<Mutex<(u64, Vec<HistorySample>)>>;

/// Interroga periodicamente (ogni 2s, stesso `pollMs` di default di
/// `TrendCanvas.tsx`) lo storico di un singolo tag e lo pubblica in
/// `SharedHistory`. Un task per serie, non uno per widget: più semplice da
/// comporre, il costo di N fetch invece di 1 è accettabile per un pannello
/// con poche trend a schermo insieme. Il backfill OPC-UA (se richiesto)
/// parte solo al primo giro, non a ogni poll — stessa logica di
/// `firstTick && opcuaBackfill` in `TrendCanvas.tsx`.
///
/// Non ha un modo per essere fermato: vive quanto il task tokio lo lascia
/// vivo, cioè quanto il processo — stesso compromesso già accettato per gli
/// `Style`/i contesti `Box::leak` delle callback (vedi `lvgl_render.rs`), ma
/// qui è un task che continua a fare I/O di rete, non un valore inerte: se
/// il maintainer naviga più volte sulla stessa pagina con un trend, ogni
/// visita apre un nuovo poller e i vecchi non vengono mai fermati — limite
/// noto, accettabile per una sessione di test, vedi `docs/OPEN_QUESTIONS.md`
/// Q14.
pub fn spawn_history_poller(
    rt_handle: &tokio::runtime::Handle,
    base_url: String,
    tag: String,
    window_s: u64,
    backfill: bool,
) -> SharedHistory {
    let shared: SharedHistory = Arc::new(Mutex::new((0, Vec::new())));
    let shared_bg = shared.clone();
    rt_handle.spawn(async move {
        let mut first = true;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            interval.tick().await;
            let now_ms = now_unix_ms();
            let from_ms = now_ms.saturating_sub(window_s.saturating_mul(1000));
            let do_backfill = first && backfill;
            first = false;
            match fetch_history(&base_url, &tag, from_ms, now_ms, do_backfill).await {
                Ok(samples) => {
                    let mut guard = shared_bg.lock().unwrap_or_else(|e| e.into_inner());
                    guard.0 = guard.0.wrapping_add(1);
                    guard.1 = samples;
                }
                Err(e) => {
                    eprintln!("[trend] storico di '{tag}' fallito: {e} — riprovo al prossimo poll");
                }
            }
        }
    });
    shared
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

/// Condivisa da `/ws/tags` e `/ws/alarms` — stessa conversione schema
/// http(s)→ws(s), cambia solo il path.
fn ws_url(base_url: &str, path: &str) -> anyhow::Result<String> {
    let mut ws_url = reqwest::Url::parse(base_url)?;
    let new_scheme = match ws_url.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => anyhow::bail!("schema URL non supportato: {other}"),
    };
    ws_url
        .set_scheme(new_scheme)
        .map_err(|_| anyhow::anyhow!("impossibile impostare lo schema WS"))?;
    ws_url.set_path(path);
    Ok(ws_url.to_string())
}

/// Si connette a `/ws/tags`, attende lo snapshot iniziale (bloccante — il
/// chiamante ha bisogno dei valori subito, per creare i widget la prima
/// volta), poi resta iscritto in un task in background che aggiorna lo
/// stato condiviso a ogni delta successivo per tutta la durata del processo.
/// La connessione non viene mai chiusa esplicitamente: muore con il processo
/// (comportamento accettabile per un viewer che gira finché non lo chiudi).
/// Segnale "il progetto è cambiato, rileggi la pagina".
///
/// Un flag e non un canale: al loop di rendering interessa solo *se* ricaricare
/// prima del prossimo frame, non quante notifiche sono arrivate nel frattempo.
/// Tre salvataggi in rapida successione devono produrre una ricarica sola.
pub type ReloadFlag = Arc<std::sync::atomic::AtomicBool>;

pub async fn spawn_tag_subscription(
    base_url: &str,
) -> anyhow::Result<(SharedTagSnapshot, ReloadFlag)> {
    let url = ws_url(base_url, "/ws/tags")?;
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
    let reload: ReloadFlag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let reload_bg = reload.clone();

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
            // Il progetto è cambiato sul disco: la pagina che stiamo
            // disegnando non è più quella giusta. Si alza un flag e basta —
            // ricaricare da qui vorrebbe dire toccare LVGL da un thread che
            // non è quello del rendering, e LVGL non è thread-safe.
            if text.contains("\"project_changed\"") {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v.get("type").and_then(|t| t.as_str()) == Some("project_changed") {
                        eprintln!("[ws] il progetto è cambiato: ricarico la pagina");
                        reload_bg.store(true, std::sync::atomic::Ordering::Relaxed);
                        continue;
                    }
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

    Ok((shared, reload))
}

/// Sottoinsieme di `AlarmDef` (`sws-core::alarm`) che `alarm_viewer` in
/// modalità lista disegna davvero — non l'intera definizione (`condition`,
/// `notify_url`, `dead_band`, `on_delay_s`/`off_delay_s`, `inhibit_tag`...
/// restano ignorati silenziosamente, stesso principio di `model.rs`).
/// `severity` resta una stringa (`"Info"`/`"Warning"`/`"Critical"`, i nomi
/// delle varianti — `AlarmSeverity` non ha `#[serde(rename_all)]` lato
/// server, verificato nel sorgente) invece di un enum Rust dedicato: non ci
/// serve altro che confrontarla per uguaglianza col filtro
/// `alarm_viewer_severities` e come chiave in `severity_color`.
#[derive(Debug, Deserialize, Clone)]
pub struct AlarmDefLite {
    pub id: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub severity: String,
}

/// Sottoinsieme di `AlarmState` — `isa_state`/`ack_at_ms`/`normalized_at_ms`/
/// `last_value` ignorati (non disegnati in modalità lista).
#[derive(Debug, Deserialize, Clone)]
pub struct AlarmStateLite {
    pub def: AlarmDefLite,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub acknowledged: bool,
    #[serde(default)]
    pub activated_at_ms: Option<u64>,
}

/// Stato condiviso tra il task WS `/ws/alarms` in background e il loop di
/// rendering — mappa per `alarm_id`, stesso principio di `SharedTagSnapshot`
/// (il lettore vuole solo lo stato più recente).
pub type SharedAlarms = Arc<Mutex<HashMap<String, AlarmStateLite>>>;

/// Si connette a `/ws/alarms` e aggiorna `SharedAlarms` in background, per
/// tutta la durata del processo (stessa non-terminazione esplicita di
/// `spawn_tag_subscription`). A differenza di `/ws/tags`, **non** blocca in
/// attesa di uno snapshot iniziale: il protocollo di `/ws/alarms`
/// (`handle_alarms_ws` in `sws-web/src/router.rs`) non distingue affatto tra
/// snapshot e delta a livello di messaggio — ogni messaggio, dal primo
/// all'ultimo, è semplicemente un `AlarmState` "nudo" (nessun involucro
/// `{type: ...}` come per i tag), quindi "upsert per id" è già il
/// trattamento corretto per ogni messaggio, non serve aspettare nulla di
/// speciale. I widget `alarm_viewer` nascono senza righe popolate e le
/// riempiono al primo `update_bindings` utile, esattamente come qualunque
/// altro widget aspetta il primo dato tag — non serve che l'elenco allarmi
/// sia già pronto al momento della creazione.
pub async fn spawn_alarm_subscription(base_url: &str) -> anyhow::Result<SharedAlarms> {
    let url = ws_url(base_url, "/ws/alarms")?;
    let connector = tokio_tungstenite::Connector::Rustls(insecure_client_config());
    let (mut stream, _resp) =
        tokio_tungstenite::connect_async_tls_with_config(url.as_str(), None, false, Some(connector)).await?;

    let shared: SharedAlarms = Arc::new(Mutex::new(HashMap::new()));
    let shared_bg = shared.clone();
    tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            let msg = match msg {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("[ws] errore su /ws/alarms: {e} — interrotto l'aggiornamento allarmi");
                    return;
                }
            };
            let Message::Text(text) = msg else {
                if matches!(msg, Message::Close(_)) {
                    eprintln!("[ws] /ws/alarms chiuso dal server — interrotto l'aggiornamento allarmi");
                    return;
                }
                continue;
            };
            let Ok(state) = serde_json::from_str::<AlarmStateLite>(&text) else { continue };
            let mut map = shared_bg.lock().unwrap_or_else(|e| e.into_inner());
            map.insert(state.def.id.clone(), state);
        }
        eprintln!("[ws] connessione /ws/alarms terminata — gli allarmi non si aggiorneranno più");
    });

    Ok(shared)
}

/// `POST /api/alarms/:id/ack` — stesso endpoint REST usato dal pulsante ACK
/// del web (`AlarmViewerWidget`/`AlarmBellPanel`), ma senza header
/// `Authorization`: questo client non ha mai avuto un concetto di sessione/
/// ruolo (`PUT /api/tags/:id` da un click checkbox/slider funziona già senza
/// token in questo ambiente — stesso principio, non un'eccezione nuova per
/// gli allarmi).
pub async fn ack_alarm(base_url: &str, alarm_id: &str) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("alarms")
        .push(alarm_id)
        .push("ack");
    let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build()?;
    client
        .post(url)
        .json(&serde_json::json!({ "by": "lvgl-viewer" }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}
