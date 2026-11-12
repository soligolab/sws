//! Client REST/WS verso un runtime `sws-web` già in esecuzione — stesso ruolo
//! che oggi ha il browser (o `sws-kiosk`): legge lo schema della pagina via
//! REST e resta iscritto a `/ws/tags` per tutta la durata della finestra,
//! aggiornando uno stato condiviso (`SharedTagSnapshot`) via snapshot iniziale
//! e delta successivi. Vedi ADR 0002: nessuna modifica al runtime, questo
//! client consuma solo il contratto REST/WS già esistente per il browser.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::Deserialize;
use sws_core::tag::{TagQuality, TagValue};
use tokio_tungstenite::tungstenite::Message;

use crate::model::{FaceplateDef, LanguageTable, RecipeListEntry, SynopticPage};
use crate::session::LoginOk;
use crate::tls::{pinned_client_config, pinned_client_config_arc};

/// Lingua *corrente* del progetto (codice, es. `"it"`) — mutabile, a
/// differenza della `LanguageTable` (tabella token→traduzioni, fissa per
/// tutta la sessione). Cambiata dal click su `lang_button`/`lang_selector`
/// (vedi `lvgl_render.rs`), letta a ogni caricamento/ricarica di pagina per
/// risolvere i token `{{key}}` nella lingua giusta — stesso principio di
/// `projectLang` in `src/store/index.ts` lato editor, ma un valore
/// process-wide invece che nello store di un browser (questo motore non ha
/// mai avuto un concetto di sessione per-tab).
pub type SharedLang = Arc<Mutex<String>>;

/// `GET /health` — risponde `ok` e non vuole autenticazione: è la sonda più
/// economica per sapere se un runtime è davvero in ascolto a quell'indirizzo.
/// La usa [`crate::base_url_viva`] prima di decidere con chi parlare.
pub async fn risponde(base_url: &str, timeout: std::time::Duration) -> bool {
    let Ok(mut url) = reqwest::Url::parse(base_url) else {
        return false;
    };
    let Ok(mut seg) = url.path_segments_mut() else {
        return false;
    };
    seg.push("health");
    drop(seg);
    let Ok(tls) = pinned_client_config(base_url) else {
        return false;
    };
    let Ok(client) = reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        .timeout(timeout)
        .build()
    else {
        return false;
    };
    matches!(client.get(url).send().await, Ok(r) if r.status().is_success())
}

/// La stessa sonda di [`risponde`], con l'errore (10-11-2026): chi deve
/// distinguere un runtime fermo da uno che risponde male (`riavvio.rs`) lo
/// legge da lì. `Ok` = qualcuno ha risposto, qualunque stato HTTP. Un
/// indirizzo o una configurazione TLS non validi non sono un runtime fermo:
/// `Ok` anche lì, e l'errore lo dirà la strada di sempre.
pub async fn sonda_health(
    base_url: &str,
    timeout: std::time::Duration,
) -> Result<(), reqwest::Error> {
    let Ok(mut url) = reqwest::Url::parse(base_url) else {
        return Ok(());
    };
    let Ok(mut seg) = url.path_segments_mut() else {
        return Ok(());
    };
    seg.push("health");
    drop(seg);
    let Ok(tls) = pinned_client_config(base_url) else {
        return Ok(());
    };
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        .timeout(timeout)
        .build()?;
    client.get(url).send().await.map(|_| ())
}

/// `GET /api/prestazioni/richiesta` — qualcuno sta guardando le prestazioni?
pub async fn prestazioni_richiesta(base_url: &str) -> anyhow::Result<bool> {
    let url = format!(
        "{}/api/prestazioni/richiesta",
        base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let v: serde_json::Value = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(v["attiva"].as_bool().unwrap_or(false))
}

/// `POST /api/prestazioni/viewer` — il riassunto delle fasi del fotogramma.
pub async fn invia_prestazioni(
    base_url: &str,
    r: &sws_core::prestazioni::Riassunto,
) -> anyhow::Result<()> {
    let url = format!("{}/api/prestazioni/viewer", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    client.post(url).json(r).send().await?.error_for_status()?;
    Ok(())
}

pub async fn fetch_page(base_url: &str, page_name: &str) -> anyhow::Result<SynopticPage> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("synoptics")
        .push(page_name);
    // La pagina composta con la sua cornice (15-10-2026): la stessa che riceve
    // il viewer web, composta dal runtime in un punto solo.
    url.query_pairs_mut().append_pair("cornice", "1");

    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let page = resp.json::<SynopticPage>().await?;
    Ok(page)
}

/// `GET /api/auth/whoami` — **questo token vale ancora?** (22-10-2026, piano
/// `docs/plans/2026-10-22-sessione-che-non-sopravvive-al-deploy.md`).
///
/// Ritorna il nome utente: **vuoto vuol dire che il server non riconosce più
/// questo token**. Sulla porta del viewer `whoami` sta sotto `optional_auth`,
/// quindi un token morto non dà 401 — risponde 200 con `username: ""`. È lo
/// stesso declassamento silenzioso che sul web lasciava l'interfaccia a dire
/// che sei Admin.
///
/// **Non** si usa `/api/system` come sonda: sta dietro `require_operator`, e
/// una sessione Viewer viva prenderebbe 403 facendosi buttare fuori per
/// sbaglio.
pub async fn whoami(base_url: &str, token: &str) -> anyhow::Result<String> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("auth")
        .push("whoami");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?
        .error_for_status()?;
    let v = resp.json::<serde_json::Value>().await?;
    Ok(v.get("username")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string())
}

/// Come [`fetch_page`], ma restituisce il JSON **grezzo** (22-10-2026).
///
/// Serve alle finestre: i parametri `{nome}` si sostituiscono prima di
/// deserializzare, perché un segnaposto dentro un campo numerico non deve
/// diventare un errore di parsing — e perché `SynopticObject` è solo
/// `Deserialize`, quindi un giro di andata e ritorno attraverso JSON non si
/// può fare dalla struct.
pub async fn fetch_page_raw(base_url: &str, page_name: &str) -> anyhow::Result<serde_json::Value> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("synoptics")
        .push(page_name);
    url.query_pairs_mut().append_pair("cornice", "1");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<serde_json::Value>().await?)
}

/// La pagina grezza che corrisponde a un **id** (non a un nome file): stessa
/// risoluzione di [`resolve_page_by_id`], che cerca per id e ripiega sul nome.
pub async fn resolve_page_raw_by_id(
    base_url: &str,
    target_page_id: &str,
) -> anyhow::Result<serde_json::Value> {
    let names = list_synoptics(base_url).await?;
    for name in &names {
        if let Ok(v) = fetch_page_raw(base_url, name).await {
            if v.get("id").and_then(|i| i.as_str()) == Some(target_page_id) {
                return Ok(v);
            }
        }
    }
    fetch_page_raw(base_url, target_page_id).await
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
        .use_preconfigured_tls(pinned_client_config(base_url)?)
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
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let list = resp.json::<Vec<RecipeListEntry>>().await?;
    Ok(list)
}

/// `POST /api/recipes/:id/apply`. Fino a Q36 nessuna delle tre scritture di
/// questo file portava un header `Authorization` — il client era anonimo
/// per costruzione. `token` è quello della sessione corrente
/// (`session::SessionState`, `None` finché non si fa login): quando presente
/// si allega come `Bearer`, altrimenti la richiesta parte com'era sempre
/// partita. `applied_by` resta fisso a `"lvgl"` (non al nome utente loggato):
/// è il motore che ha eseguito il comando, non serve duplicare l'identità
/// che il token già porta lato server.
pub async fn apply_recipe(
    base_url: String,
    id: String,
    token: Option<String>,
) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(&base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("recipes")
        .push(&id)
        .push("apply");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(&base_url)?)
        .build()?;
    let mut req = client
        .post(url)
        .json(&serde_json::json!({ "applied_by": "lvgl" }));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    req.send().await?.error_for_status()?;
    Ok(())
}

/// `POST /api/script/run/<nome>` con `{"args": …}`: la funzione Python di un
/// bottone (11-11-2026, piano parità LVGL §2.1). La rotta risponde 200 anche
/// quando la funzione fallisce, con `ok: false` e `error`: quello è un errore
/// qui, perché chi preme deve saperlo.
pub async fn esegui_funzione(
    base_url: &str,
    nome: &str,
    args: &serde_json::Value,
    token: Option<&str>,
) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("script")
        .push("run")
        .push(nome);
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let mut req = client.post(url).json(&serde_json::json!({ "args": args }));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let esito: serde_json::Value = req.send().await?.error_for_status()?.json().await?;
    esito_della_funzione(&esito)
}

/// `ScriptResult` letto: `ok: false` diventa l'errore, col testo del runtime.
fn esito_della_funzione(esito: &serde_json::Value) -> anyhow::Result<()> {
    if esito.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let e = esito
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("errore sconosciuto");
        anyhow::bail!("{e}");
    }
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
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let wrapper = resp.json::<ProjectLanguagesOnly>().await?;
    Ok(wrapper.languages)
}

/// `GET /api/system`, di cui a questo client serve solo `auth_required`
/// (Q36): sapere se il runtime ha utenti definiti decide se mostrare il
/// controllo di login o tenerlo nascosto — un pannello senza utenti non ha
/// nulla da autenticare, come nel browser (`optional_auth`, Admin
/// sintetico). Stesso principio di tolleranza di `fetch_languages`: gli
/// altri ~15 campi di `SystemInfo` non dichiarati qui vengono ignorati da
/// serde, non generano errori.
pub async fn fetch_system(base_url: &str) -> anyhow::Result<StatoSistema> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("system");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let wrapper = resp.json::<StatoSistema>().await?;
    Ok(wrapper)
}

/// I due campi di `/api/system` che servono a questo client. `uptime_s` si è
/// aggiunto il 29-09-2026 con l'avviso di aggiornamento: quando scende, il
/// runtime è ripartito — ed è così che il pannello si accorge che
/// l'aggiornamento che aveva chiesto è andato in porto, senza che nessuno
/// glielo dica. Stessa logica di `ripartito()` nel gemello web
/// (`sws-editor/src/runtime-view/AvvisoAggiornamento.tsx`).
#[derive(Debug, Clone, Deserialize)]
pub struct StatoSistema {
    pub auth_required: bool,
    /// Da quanti secondi gira **questo** processo del runtime.
    #[serde(default)]
    pub uptime_s: u64,
    /// La configurazione del servizio (i quadlet) rispetto a quella che la
    /// versione che gira si aspetta (02-10-2026). Assente su un runtime vecchio.
    #[serde(default)]
    pub quadlet: Option<QuadletSistema>,
    /// Dopo un aggiornamento: la domanda da fare (03-10-2026). Assente su un
    /// runtime vecchio o fuori da un dispositivo.
    #[serde(default)]
    pub conferma_aggiornamento: Option<ConfermaSistema>,
}

/// `conferma_aggiornamento` di `GET /api/system`: solo la domanda.
#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct ConfermaSistema {
    #[serde(default)]
    pub domanda: Option<DomandaSistema>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DomandaSistema {
    pub da: String,
    pub a: String,
    #[serde(default)]
    pub istantanea: bool,
}

/// `quadlet` di `GET /api/system`: solo quel che serve all'avviso a schermo.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct QuadletSistema {
    pub installata: Option<u32>,
    pub attesa: Option<u32>,
    #[serde(default)]
    pub da_aggiornare: bool,
    #[serde(default)]
    pub si_puo_aggiornare: bool,
}

/// Le novità di una versione, come arrivano da `GET /api/update/status`.
///
/// # Perché è dichiarata qui e non condivisa
///
/// Il tipo di partenza è `sws_web::aggiornamento::NovitaVersione`, che è
/// `Serialize` e vive nel crate del server: questo binario non dipende da
/// `sws-web` (è il client, non il server) e tirarselo dentro per cinque campi
/// sarebbe sproporzionato. Vale la stessa tolleranza di `fetch_languages` e
/// `fetch_system`: i campi non dichiarati qui serde li ignora, e quelli che il
/// server **omette** quando sono vuoti (`skip_serializing_if`) hanno tutti un
/// `default`. Il gemello TypeScript fa lo stesso da sempre.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct NovitaVersione {
    pub versione: String,
    /// Le novità in italiano (da `NOVITA.yaml`, nelle etichette dell'immagine).
    #[serde(default)]
    pub testo: String,
    /// I soli avvisi di compatibilità, che vanno in cima.
    #[serde(default)]
    pub compatibilita: String,
    #[serde(default)]
    pub testo_en: String,
    #[serde(default)]
    pub compatibilita_en: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EsitoAggiornamento {
    Riuscito,
    NonRiuscito,
}

/// L'ultimo aggiornamento concluso (`sws_web::aggiornamento_esito::Evento`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct EventoAggiornamento {
    /// Identifica l'evento per «Chiudi»: chiuso una volta, non ricompare.
    pub id: i64,
    pub da: String,
    /// Per «non riuscito», la versione che si era provato a installare.
    #[serde(default)]
    pub a: Option<String>,
    pub esito: EsitoAggiornamento,
}

/// `GET /api/update/status` — quel che ne serve al pannello.
///
/// Manca `canale` di proposito: il server riempie `disponibile` **solo** per un
/// runtime che segue un canale del registry (`aggiornamento::stato()`), quindi
/// «c'è una versione nuova» e «questo pannello si sa aggiornare da sé» sono la
/// stessa condizione, e una copia dell'enum `Canale` qui non deciderebbe niente
/// di più.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct StatoAggiornamento {
    pub versione: String,
    /// La versione più nuova del canale, se è più nuova di questa.
    #[serde(default)]
    pub disponibile: Option<String>,
    /// Cosa cambia, una voce per versione da attraversare.
    #[serde(default)]
    pub novita: Vec<NovitaVersione>,
    /// L'ultimo aggiornamento concluso, finché qualcuno non lo chiude.
    #[serde(default)]
    pub evento: Option<EventoAggiornamento>,
    /// Le Novità della versione che gira, per «Aggiornato alla Y: cosa cambia».
    #[serde(default)]
    pub novita_installata: Option<NovitaVersione>,
    /// Un aggiornamento chiesto e non ancora concluso.
    #[serde(default)]
    pub in_corso: bool,
}

/// `GET /api/update/status` sulla porta del viewer (registrata in
/// `sws-web/src/router.rs` dietro `require_admin`).
///
/// **`Ok(None)` non è un errore**: è il 401/403 di un progetto che ha utenti,
/// dove un anonimo non ha titolo per sapere nulla di aggiornamenti e l'avviso
/// non si deve mostrare affatto (decisione 41: solo su un pannello senza
/// utenti). Distinguerlo da un guasto di rete conta, perché il primo caso deve
/// **spegnere** il controllo periodico invece di ritentare ogni minuto.
pub async fn stato_aggiornamento(
    base_url: &str,
    token: Option<&str>,
) -> anyhow::Result<Option<StatoAggiornamento>> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("update")
        .push("status");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let mut req = client.get(url);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let resp = req.send().await?;
    if matches!(
        resp.status(),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
    ) {
        return Ok(None);
    }
    let resp = resp.error_for_status()?;
    Ok(Some(resp.json::<StatoAggiornamento>().await?))
}

/// `POST /api/update/apply` — chiede l'aggiornamento del runtime.
///
/// Il server risponde **prima** di chiedere a systemd, perché subito dopo
/// questo stesso processo viene fermato e sostituito: una risposta arrivata
/// non vuol dire che l'aggiornamento sia riuscito, solo che è stato chiesto.
/// Chi ha premuto lo scopre dal riavvio del runtime e poi dall'esito.
///
/// Va in coda al thread di rete (`net_worker::Comando::AvviaAggiornamento`) e
/// non chiamata dal loop di rendering: è una POST, cioè esattamente la forma
/// che il 13-09 ha bloccato per sempre il viewer (Q55).
pub async fn avvia_aggiornamento(base_url: &str, token: Option<&str>) -> anyhow::Result<()> {
    post_vuoto(base_url, &["api", "update", "apply"], token).await
}

/// `POST /api/quadlet/aggiorna` (02-10-2026): il pannello riscrive i suoi
/// quadlet e si riavvia.
pub async fn aggiorna_quadlet(base_url: &str, token: Option<&str>) -> anyhow::Result<()> {
    post_vuoto(base_url, &["api", "quadlet", "aggiorna"], token).await
}

/// `POST /api/aggiornamento/conferma` (03-10-2026): la risposta alla domanda
/// dopo un aggiornamento — `pulisci`, `dopo_riavvio`, `piu_tardi`, `ritorna`.
pub async fn conferma_aggiornamento(
    base_url: &str,
    token: Option<&str>,
    scelta: &str,
) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .extend(["api", "aggiornamento", "conferma"]);
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let mut req = client
        .post(url)
        .json(&serde_json::json!({ "scelta": scelta }));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    req.send().await?.error_for_status()?;
    Ok(())
}

async fn post_vuoto(base_url: &str, percorso: &[&str], token: Option<&str>) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .extend(percorso);
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let mut req = client.post(url);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    req.send().await?.error_for_status()?;
    Ok(())
}

/// `POST /api/auth/login` — stesso endpoint del web
/// (`sws-web/src/router.rs`, `login()`). Restituisce `Err` sia per un
/// fallimento di rete sia per credenziali rifiutate: il chiamante (il click
/// sul pulsante di login, vedi `lvgl_render.rs`) non ha bisogno di
/// distinguerli oltre al messaggio d'errore, a differenza del web che
/// discrimina 401 per "il dispositivo non ha utenti" (Q49/T-57) — qui non
/// serve: se il pannello mostra il login è perché `fetch_system` ha già
/// detto che il runtime ha utenti.
pub async fn login(base_url: &str, username: &str, password: &str) -> anyhow::Result<LoginOk> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("auth")
        .push("login");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client
        .post(url)
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send()
        .await?
        .error_for_status()
        .map_err(|e| anyhow::anyhow!("credenziali rifiutate o runtime non raggiungibile: {e}"))?;
    let ok = resp.json::<LoginOk>().await?;
    Ok(ok)
}

/// Le pagine del progetto per il navigatore (`page_navigator`): id, nome e albero.
///
/// Il viewer legge una pagina per volta e `GET /api/synoptics` dà solo i nomi
/// dei file, quindi il navigatore non avrebbe da dove prendere gli id: per
/// questo esiste `GET /api/pages/nav`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct NavPagineDati {
    #[serde(default)]
    pub pages: Vec<NavPaginaDati>,
    #[serde(default)]
    pub tree: Vec<sws_core::PageTreeNode>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NavPaginaDati {
    pub id: String,
    pub name: String,
}

/// L'ultimo elenco letto. Un valore per processo, come `SharedLang`: questo
/// viewer mostra un progetto solo, e infilare un parametro in più in
/// `render_page_objects` e in tutta la catena dei renderer per un solo oggetto
/// sarebbe stato più rumore che chiarezza.
static PAGINE_NAV: Mutex<NavPagineDati> = Mutex::new(NavPagineDati {
    pages: Vec::new(),
    tree: Vec::new(),
});

/// `GET /api/pages/nav`.
pub async fn fetch_pagine_nav(base_url: &str) -> anyhow::Result<NavPagineDati> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("pages")
        .push("nav");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<NavPagineDati>().await?)
}

/// Se l'elenco va riletto. Parte alzata (la prima apertura legge) e si rialza
/// quando il progetto cambia.
static NAV_DA_RILEGGERE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Il progetto è cambiato: l'elenco delle pagine va riletto alla prossima
/// occasione. La chiama il ciclo di rendering nello stesso punto in cui butta
/// gli SVG scaricati, che è l'unico momento in cui si sa che il disco è
/// diverso da quello che il pannello sta mostrando.
pub fn invalida_pagine_nav() {
    NAV_DA_RILEGGERE.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// L'elenco per il navigatore, riletto **solo quando serve**.
///
/// Prima si rileggeva a ogni render (Passo 3 del piano di stabilizzazione,
/// punto B8): una richiesta HTTP **bloccante**, con un client TLS costruito da
/// zero, dentro il thread che disegna — e una volta per ogni navigatore
/// presente sulla pagina, figli di griglia e faceplate compresi. Su un
/// pannello lento è il tempo che passa fra il tocco e il cambio pagina, e la
/// risposta è quasi sempre identica a quella di prima: l'elenco delle pagine
/// cambia solo quando cambia il progetto.
///
/// Se il runtime non risponde si tiene l'ultimo elenco buono (un navigatore
/// con un menù vecchio è meglio di uno vuoto) **e si riprova** al render dopo:
/// il flag si abbassa solo quando la lettura riesce.
pub fn aggiorna_pagine_nav(base_url: &str, rt_handle: &tokio::runtime::Handle) -> NavPagineDati {
    if !NAV_DA_RILEGGERE.load(std::sync::atomic::Ordering::Relaxed) {
        return PAGINE_NAV.lock().unwrap_or_else(|e| e.into_inner()).clone();
    }
    let letto = rt_handle.block_on(async {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            fetch_pagine_nav(base_url),
        )
        .await
    });
    match letto {
        Ok(Ok(d)) => {
            *PAGINE_NAV.lock().unwrap_or_else(|e| e.into_inner()) = d.clone();
            NAV_DA_RILEGGERE.store(false, std::sync::atomic::Ordering::Relaxed);
            d
        }
        Ok(Err(e)) => {
            eprintln!("[page_navigator] elenco pagine non letto: {e}");
            PAGINE_NAV.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }
        Err(_) => {
            eprintln!("[page_navigator] elenco pagine non letto: tempo scaduto");
            PAGINE_NAV.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }
    }
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
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
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
/// Solo i campi che la tabella usa. `AlarmEvent` lato runtime ne ha altri (chi
/// ha confermato, la durata): dichiararli qui senza usarli darebbe
/// l'impressione che servano. Rientro e `interrotto` servono dal 25-09-2026,
/// quando la riga ha cominciato a nascere allo scatto: una riga può essere
/// ancora aperta, e la colonna «Stato» lo dice.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AlarmHistoryEvent {
    pub alarm_id: String,
    #[serde(default)]
    pub alarm_message: String,
    pub ts_activated_ms: u64,
    #[serde(default)]
    pub ts_acked_ms: Option<u64>,
    #[serde(default)]
    pub ts_normalized_ms: Option<u64>,
    #[serde(default)]
    pub interrotto: bool,
    /// Il colore del marcatore sul trend (30-09-2026): `Info`/`Warning`/`Critical`.
    #[serde(default)]
    pub severity: String,
}

impl AlarmHistoryEvent {
    /// La colonna «Stato»: interrotta, ancora attiva, rientrata ma da
    /// confermare, o chiusa. Nell'ordine: una riga interrotta ha un rientro che
    /// non è vero, quindi quel segno viene prima di tutto.
    pub fn stato(&self) -> sws_core::testi_sistema::Testo {
        use sws_core::testi_sistema::Testo;
        if self.interrotto {
            Testo::Interrotto
        } else if self.ts_normalized_ms.is_none() {
            Testo::Attivo
        } else if self.ts_acked_ms.is_none() {
            Testo::DaConfermare
        } else {
            Testo::Chiuso
        }
    }
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
    url.query_pairs_mut()
        .append_pair("limit", &limit.to_string());
    if let Some(id) = alarm_id {
        url.query_pairs_mut().append_pair("alarm_id", id);
    }
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
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
    // Senza home dichiarata si prende la **prima dell'albero**, non la prima in
    // ordine alfabetico (Passo 3 del piano di stabilizzazione, punto B7).
    // `GET /api/synoptics` dà i nomi dei file ordinati dal filesystem, quindi
    // finora a decidere cosa vedeva il cliente all'accensione era l'alfabeto:
    // rinominare una pagina cambiava la schermata di avvio del pannello, e
    // l'ordine che il maintainer aveva messo nell'albero non contava niente.
    if let Some(p) = prima_dell_albero(base_url, &dichiarata).await {
        return Ok(p);
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

/// Il primo id in ordine d'albero. Pura: è la decisione, non la rete, ed è la
/// parte che si può provare contro la fixture condivisa con l'editor.
///
/// `riconcilia` prima di `appiattisci` perché l'albero salvato può nominare
/// pagine che non ci sono più (cancellate a mano, o arrivate con un deploy
/// parziale) e ignorare quelle aggiunte dopo: senza, la prima voce potrebbe
/// essere una pagina inesistente e il pannello partirebbe con un errore.
pub(crate) fn primo_id_dell_albero(nav: &NavPagineDati) -> Option<String> {
    let ids: Vec<String> = nav.pages.iter().map(|p| p.id.clone()).collect();
    sws_core::page_tree::appiattisci(&sws_core::page_tree::riconcilia(&nav.tree, &ids))
        .into_iter()
        .next()
}

/// La prima pagina secondo l'albero del progetto, se si riesce a saperlo.
///
/// `None` quando `GET /api/pages/nav` non risponde o il progetto non ha
/// pagine: il chiamante ripiega sull'ordine dei file, che è ciò che il viewer
/// ha sempre fatto. Un ripiego e non un errore, perché una schermata di avvio
/// nell'ordine sbagliato è meglio di un pannello nero.
async fn prima_dell_albero(base_url: &str, dichiarata: &Option<String>) -> Option<SynopticPage> {
    let nav = match fetch_pagine_nav(base_url).await {
        Ok(n) => n,
        Err(e) => {
            eprintln!("[avvio] elenco pagine non letto ({e}), uso l'ordine dei file");
            return None;
        }
    };
    let primo = &primo_id_dell_albero(&nav)?;
    // Senza albero `riconcilia` restituisce l'elenco piatto, quindi «la prima
    // dell'albero» sarebbe vera ma fuorviante: chi legge il log di un pannello
    // partito sulla pagina sbagliata deve capire **se un ordine c'era**.
    let dove = if nav.tree.is_empty() {
        "nessun albero, uso la prima pagina"
    } else {
        "uso la prima dell'albero"
    };
    match resolve_page_by_id(base_url, primo).await {
        Ok(p) => {
            match dichiarata {
                Some(_) => eprintln!("[avvio] ripiego: {dove}: '{}'", p.name),
                None => eprintln!("[avvio] nessuna home page dichiarata, {dove}: '{}'", p.name),
            }
            Some(p)
        }
        Err(e) => {
            eprintln!("[avvio] la prima dell'albero ('{primo}') non si risolve ({e})");
            None
        }
    }
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
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url).ok()?)
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    resp.json::<Progetto>()
        .await
        .ok()?
        .page_layout?
        .home_page_id
}

/// Chi può scrivere cosa (04-11-2026, lucchetto della regola R7): la mappa
/// percorso → ruolo del runtime (`sws_core::soglie_di_scrittura`), calcolata
/// qui da tag e tipi del progetto. `None` se il progetto non si legge: niente
/// lucchetti, come prima — il server resta l'unico che fa rispettare il ruolo.
pub async fn fetch_soglie_scrittura(
    base_url: &str,
) -> Option<std::collections::HashMap<String, String>> {
    #[derive(serde::Deserialize)]
    struct Progetto {
        #[serde(default)]
        tags: Vec<sws_core::TagDef>,
        #[serde(default)]
        types: Vec<sws_core::TypeDef>,
    }
    let url = format!("{}/api/project", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url).ok()?)
        .build()
        .ok()?;
    let p = client
        .get(&url)
        .send()
        .await
        .ok()?
        .json::<Progetto>()
        .await
        .ok()?;
    Some(sws_core::soglie_di_scrittura(&p.tags, &p.types))
}

pub async fn resolve_page_by_id(
    base_url: &str,
    target_page_id: &str,
) -> anyhow::Result<SynopticPage> {
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
/// `token` (Q36): quello della sessione corrente, allegato come
/// `Authorization: Bearer` quando presente — vedi `apply_recipe` per il
/// perché non c'era prima.
pub async fn put_tag(
    base_url: &str,
    tag: &str,
    value: TagValue,
    token: Option<&str>,
) -> anyhow::Result<()> {
    put_tag_con_motivo(base_url, tag, value, token, None).await
}

/// `PUT /api/tags/<tag>` col motivo, che il runtime scrive nell'audit
/// (`reason`, come il web per i comandi con `require_reason`, 11-11-2026).
pub async fn put_tag_con_motivo(
    base_url: &str,
    tag: &str,
    value: TagValue,
    token: Option<&str>,
    reason: Option<&str>,
) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("tags")
        .push(tag);

    #[derive(serde::Serialize)]
    struct WriteTagBody<'a> {
        value: TagValue,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<&'a str>,
    }

    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let mut req = client.put(url).json(&WriteTagBody { value, reason });
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    req.send().await?.error_for_status()?;
    Ok(())
}

/// `POST /api/auth/verify-password`: chi sta al pannello è ancora il titolare
/// della sessione (comandi critici, 11-11-2026, piano parità LVGL §2.2). 204 sì,
/// 403 no; il resto è un errore (un 401 fa chiedere l'accesso).
pub async fn verifica_password(
    base_url: &str,
    password: &str,
    token: Option<&str>,
) -> anyhow::Result<bool> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("auth")
        .push("verify-password");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let mut req = client
        .post(url)
        .json(&serde_json::json!({ "password": password }));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let r = req.send().await?;
    if r.status() == reqwest::StatusCode::FORBIDDEN {
        return Ok(false);
    }
    r.error_for_status()?;
    Ok(true)
}

/// Lo stesso orologio del resto del workspace (`sws_core::now_ms`).
pub use sws_core::now_ms as now_unix_ms;

/// Un campione storico — porta `Sample` di `sws-historian` (`ts_ms`, `value`,
/// `quality`) ma senza `quality`: il trend LVGL non la disegna (il web
/// nemmeno, in `TrendCanvas`), stesso principio di `TagSnapshotValue` sotto
/// che non porta il timestamp perché quello non serve a lei.
#[derive(Debug, Deserialize, Clone)]
pub struct HistorySample {
    pub ts_ms: u64,
    pub value: TagValue,
    /// Il pallino della colonna Q del data_log (1-10-2026).
    #[serde(default)]
    pub quality: Option<TagQuality>,
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
    fetch_history_con(base_url, tag, from_ms, to_ms, backfill, false).await
}

/// Come `fetch_history`; con `ancora` (trend e sparkline, 1-10-2026) il runtime
/// ripete l'ultimo valore prima della finestra all'inizio e prolunga l'ultimo
/// noto fino alla fine: un valore fermo si disegna invece di restare vuoto.
pub async fn fetch_history_con(
    base_url: &str,
    tag: &str,
    from_ms: u64,
    to_ms: u64,
    backfill: bool,
    ancora: bool,
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
        if ancora {
            q.append_pair("ancora", "true");
        }
    }
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Vec<HistorySample>>().await?)
}

/// Punto XY dal backfill (F5.3x/T-70) — già accoppiato per riempimento lato
/// server (`merge_xy` in sws-historian, non un join su timestamp identici:
/// due tag storicizzati indipendentemente non ne hanno in comune).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct HistoryXyPoint {
    pub ts_ms: u64,
    pub x: f64,
    pub y: f64,
}

/// `GET /api/history/xy?x=&y=&from=&to=` — backfill di una coppia di
/// `xy_plot` al mount della pagina, una fetch sola (non un poller: il live
/// arriva dal `TagSnapshot` locale, vedi `LiveKind::XyPlot`).
pub async fn fetch_history_xy(
    base_url: &str,
    x_tag: &str,
    y_tag: &str,
    from_ms: u64,
    to_ms: u64,
) -> anyhow::Result<Vec<HistoryXyPoint>> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("history")
        .push("xy");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("x", x_tag);
        q.append_pair("y", y_tag);
        q.append_pair("from", &from_ms.to_string());
        q.append_pair("to", &to_ms.to_string());
    }
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Vec<HistoryXyPoint>>().await?)
}

/// Il seme della mini tendenza (`sparkline`, e quella in basso nel
/// `kpi_tile`): **una** richiesta dei secchi della finestra, poi il task
/// finisce. Da lì la mini tendenza vive dei valori del socket, negli stessi
/// secchi (`mini_serie::Viva`).
///
/// Fino al 09-11-2026 qui c'era un poller che chiedeva tutta la finestra ogni
/// 2 s, per ogni mini tendenza: sulla pagina iniziale di Montagna, 12 mini
/// tendenze, erano 6 richieste al secondo, e il server rileggeva e aggregava
/// un'ora di campioni a ogni richiesta, sulla stessa CPU del pannello. Prima
/// ancora non si fermava nemmeno quando la pagina se ne andava (Q14).
///
/// Una richiesta che fallisce porta una lista vuota: si parte dal dato vivo,
/// come sul web. Senza tag non si chiede niente, come sul web.
pub fn spawn_seme_spark(
    rt_handle: &tokio::runtime::Handle,
    base_url: String,
    tag: String,
    da: u64,
    a: u64,
    secchio: u64,
) -> crate::mini_serie::SharedSeme {
    if tag.is_empty() {
        return Arc::new(Mutex::new(Some(Vec::new())));
    }
    let seme: crate::mini_serie::SharedSeme = Arc::new(Mutex::new(None));
    let dove = seme.clone();
    rt_handle.spawn(async move {
        let secchi = match fetch_history_buckets(&base_url, &tag, da, a, secchio, false).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[trend] storico di '{tag}' non raggiungibile per la mini tendenza: {e}");
                Vec::new()
            }
        };
        *dove.lock().unwrap_or_else(|e| e.into_inner()) = Some(secchi);
    });
    seme
}

/// Un secchio dello storico aggregato (`GET /api/history/:tag?bucket_ms=`).
/// Per il trend la media è la linea, min e max la banda; per la mini
/// tendenza contano primo, minimo, massimo e ultimo (`mini_serie`).
#[derive(Debug, Clone, Deserialize)]
pub struct HistoryBucket {
    pub ts_ms: u64,
    pub min: f64,
    pub max: f64,
    pub avg: f64,
    pub first: f64,
    pub last: f64,
}

/// Cosa il trend vuole vedere: la finestra che scorre, o un intervallo fisso
/// (spostato coi pulsanti o selezionato col dito). `gen` cresce a ogni
/// cambio, così il poller sa che un intervallo fisso va chiesto di nuovo.
#[derive(Debug, Clone, Default)]
pub struct TrendRichiesta {
    pub diretta: bool,
    pub da: u64,
    pub a: u64,
    pub gen: u64,
    /// La finestra della diretta, se l'operatore ha scelto un preset (18-10-2026).
    pub finestra_ms: Option<u64>,
    /// La larghezza del grafico adesso (a schermo intero è più largo): decide
    /// la larghezza dei secchi. `0` = quella di partenza.
    pub larghezza_px: u32,
}

/// L'ultima risposta. `secchi[i]` è `Some` quando la traccia `i` è arrivata
/// aggregata, con la larghezza del secchio.
#[derive(Debug, Clone, Default)]
pub struct TrendRisposta {
    pub versione: u64,
    pub serie: Vec<Vec<HistorySample>>,
    pub secchi: Vec<Option<(u64, Vec<HistoryBucket>)>>,
    pub allarmi: Vec<AlarmHistoryEvent>,
}

pub struct TrendFeed {
    pub richiesta: Mutex<TrendRichiesta>,
    pub risposta: Mutex<TrendRisposta>,
    pub sveglia: tokio::sync::Notify,
}

pub type SharedTrend = Arc<TrendFeed>;

/// Oltre questa finestra i dati arrivano a secchi, come sul web (F5.2): un
/// trend su 30 giorni non scarica tutti i campioni.
const SECCHI_OLTRE_MS: u64 = 15 * 60_000;

/// Il poller di un trend: **uno per oggetto**, non uno per traccia, perché
/// le tracce vanno chieste tutte sullo stesso intervallo, e l'intervallo lo
/// decide l'operatore (◀/▶, zoom).
///
/// In diretta chiede ogni 2 s (il `pollMs` del web); su un intervallo fisso
/// chiede una volta per cambio. Il tocco di un pulsante lo sveglia subito.
///
/// **Si ferma da solo** quando la pagina se ne va: il trend tiene l'altro
/// capo dell'`Arc`, e quando resta solo questo non c'è più nessuno a cui
/// rispondere. È il limite Q14 dei poller che vivevano per sempre, chiuso
/// qui; la mini tendenza, dal 09-11-2026, un poller non ce l'ha più.
pub fn spawn_trend_poller(
    rt_handle: &tokio::runtime::Handle,
    base_url: String,
    tags: Vec<String>,
    finestra_s: f64,
    larghezza_px: u32,
    backfill: bool,
    allarmi: bool,
) -> SharedTrend {
    let feed: SharedTrend = Arc::new(TrendFeed {
        richiesta: Mutex::new(TrendRichiesta {
            diretta: true,
            ..Default::default()
        }),
        risposta: Mutex::new(TrendRisposta::default()),
        sveglia: tokio::sync::Notify::new(),
    });
    let bg = feed.clone();
    rt_handle.spawn(async move {
        let mut primo = true;
        let mut voce = VoceAttenuata::nuova();
        let mut gen_servita: Option<u64> = None;
        loop {
            if Arc::strong_count(&bg) == 1 {
                break;
            }
            let req = bg
                .richiesta
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if req.diretta || gen_servita != Some(req.gen) {
                let (da, a) = if req.diretta {
                    let ora = now_unix_ms();
                    let finestra = req.finestra_ms.unwrap_or((finestra_s * 1000.0) as u64);
                    (ora.saturating_sub(finestra), ora)
                } else {
                    (req.da, req.a)
                };
                let span = a.saturating_sub(da);
                let larghezza = if req.larghezza_px > 0 {
                    req.larghezza_px
                } else {
                    larghezza_px
                };
                let secchio = (span > SECCHI_OLTRE_MS).then(|| {
                    let colonne = (larghezza as f64 - 60.0).max(200.0);
                    ((span as f64 / colonne).round() as u64).max(1000)
                });
                let bf = primo && backfill;
                let mut serie = Vec::with_capacity(tags.len());
                let mut secchi = Vec::with_capacity(tags.len());
                let mut ok = true;
                for tag in &tags {
                    match secchio {
                        Some(b) => {
                            match fetch_history_buckets(&base_url, tag, da, a, b, bf).await {
                                Ok(v) => {
                                    serie.push(Vec::new());
                                    secchi.push(Some((b, v)));
                                }
                                Err(e) => {
                                    if let Some(n) = voce.errore(std::time::Instant::now()) {
                                        eprintln!(
                                            "[trend] storico a secchi di '{tag}' fallito: {e}{}",
                                            taciuti(n)
                                        );
                                    }
                                    ok = false;
                                }
                            }
                        }
                        None => match fetch_history_con(&base_url, tag, da, a, bf, true).await {
                            Ok(v) => {
                                serie.push(v);
                                secchi.push(None);
                            }
                            Err(e) => {
                                if let Some(n) = voce.errore(std::time::Instant::now()) {
                                    eprintln!(
                                        "[trend] storico di '{tag}' fallito: {e}{}",
                                        taciuti(n)
                                    );
                                }
                                ok = false;
                            }
                        },
                    }
                }
                let eventi = if allarmi {
                    fetch_alarm_history_range(&base_url, da, a, 200)
                        .await
                        .unwrap_or_default()
                } else {
                    Vec::new()
                };
                // Un giro fallito tiene i dati di prima, come il web.
                if ok {
                    if voce.riuscito() {
                        eprintln!("[trend] storico di nuovo raggiungibile");
                    }
                    primo = false;
                    gen_servita = Some(req.gen);
                    let mut g = bg.risposta.lock().unwrap_or_else(|e| e.into_inner());
                    g.versione = g.versione.wrapping_add(1);
                    g.serie = serie;
                    g.secchi = secchi;
                    g.allarmi = eventi;
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
                _ = bg.sveglia.notified() => {}
            }
        }
    });
    feed
}

#[derive(Debug, Clone, Deserialize)]
struct StatisticheStorico {
    count: u64,
    avg: f64,
}

async fn fetch_media(
    base_url: &str,
    tag: &str,
    da: u64,
    a: u64,
) -> anyhow::Result<StatisticheStorico> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("history")
        .push(tag)
        .push("stats");
    url.query_pairs_mut()
        .append_pair("from_ms", &da.to_string())
        .append_pair("to_ms", &a.to_string());
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    Ok(client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

/// La variazione percentuale del `kpi_tile` (`KpiDelta` sul web): la media
/// della finestra contro quella della finestra prima, ogni 30 s. `None` se
/// una delle due è vuota o la precedente vale zero. Si ferma quando la pagina
/// se ne va, come il poller del trend.
pub type SharedDelta = Arc<Mutex<Option<f64>>>;

pub fn spawn_kpi_delta(
    rt_handle: &tokio::runtime::Handle,
    base_url: String,
    tag: String,
    finestra_s: f64,
) -> SharedDelta {
    let shared: SharedDelta = Arc::new(Mutex::new(None));
    let bg = shared.clone();
    rt_handle.spawn(async move {
        loop {
            if Arc::strong_count(&bg) == 1 {
                break;
            }
            let ora = now_unix_ms();
            let w = (finestra_s * 1000.0) as u64;
            let cur = fetch_media(&base_url, &tag, ora.saturating_sub(w), ora).await;
            let prev = fetch_media(
                &base_url,
                &tag,
                ora.saturating_sub(2 * w),
                ora.saturating_sub(w),
            )
            .await;
            let delta = match (cur, prev) {
                (Ok(c), Ok(p)) if c.count > 0 && p.count > 0 && p.avg != 0.0 => {
                    Some((c.avg - p.avg) / p.avg.abs() * 100.0)
                }
                _ => None,
            };
            *bg.lock().unwrap_or_else(|e| e.into_inner()) = delta;
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
    shared
}

/// `GET /api/history/:tag?from=&to=&bucket_ms=` — l'aggregato del web
/// (`api.getHistoryBuckets`).
pub async fn fetch_history_buckets(
    base_url: &str,
    tag: &str,
    from_ms: u64,
    to_ms: u64,
    bucket_ms: u64,
    backfill: bool,
) -> anyhow::Result<Vec<HistoryBucket>> {
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
        q.append_pair("bucket_ms", &bucket_ms.to_string());
        // Chiedono i secchi i trend e le mini tendenze: il valore fermo vale
        // anche qui.
        q.append_pair("ancora", "true");
        if backfill {
            q.append_pair("backfill", "true");
        }
    }
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Vec<HistoryBucket>>().await?)
}

/// Gli allarmi scattati in un intervallo, per i marcatori del trend.
pub async fn fetch_alarm_history_range(
    base_url: &str,
    from_ms: u64,
    to_ms: u64,
    limit: usize,
) -> anyhow::Result<Vec<AlarmHistoryEvent>> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("alarms")
        .push("history");
    url.query_pairs_mut()
        .append_pair("from_ms", &from_ms.to_string())
        .append_pair("to_ms", &to_ms.to_string())
        .append_pair("limit", &limit.to_string());
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Vec<AlarmHistoryEvent>>().await?)
}

#[derive(Debug, Deserialize)]
struct WsTagEntry {
    id: String,
    value: TagValue,
    quality: TagQuality,
    /// Quando il valore è stato prodotto, in millisecondi epoch. Il server lo
    /// manda da sempre (`WsTagEntry` in `sws-web/src/router.rs`); era questo
    /// lato a buttarlo via. Serve a `stale_after_s`: senza, "il dato è vecchio"
    /// non è una domanda a cui il pannello possa rispondere.
    ///
    /// `default`: un server più vecchio che non lo mandasse darebbe 0, che
    /// `stale_after_s` tratta come "non lo so" invece che come "vecchio dal
    /// 1970" — vedi `EffectBinding::stantio`.
    #[serde(default)]
    ts: u64,
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

/// Valore, qualità e istante di produzione di un tag — un `sws_core::TagState`
/// alleggerito (niente `unit`, `min`, `max` e il resto: il rendering non li
/// guarda), non un tipo con una semantica diversa.
///
/// `ts` è arrivato il 2026-08-31 con `stale_after_s`: il commento di prima
/// diceva che il timestamp "non ci serve per il rendering", ed era vero finché
/// il pannello non doveva distinguere un dato fresco da uno fermo da mezz'ora.
/// Su uno SCADA è la differenza fra «il valore è quello» e «il valore *era*
/// quello».
#[derive(Clone)]
pub struct TagSnapshotValue {
    pub value: TagValue,
    pub quality: TagQuality,
    /// Millisecondi epoch. `0` = sconosciuto (server che non lo manda), e va
    /// trattato come "non giudicabile", non come "vecchissimo".
    pub ts: u64,
}

pub type TagSnapshot = HashMap<String, TagSnapshotValue>;

/// Stato condiviso tra il task WS in background (che scrive) e il loop di
/// rendering sul thread principale (che legge a ogni frame). `Mutex` invece
/// di un canale: il loop di rendering vuole sempre e solo "lo stato più
/// recente", non la sequenza di eventi intermedi — un lock breve e frequente
/// è più semplice di un canale con backpressure/coalescing a mano.
pub type SharedTagSnapshot = Arc<Mutex<TagSnapshot>>;

/// Il `ts` più recente fra le voci di un messaggio, 0 se nessuna lo porta.
/// È quello che dice quanto è fresco il messaggio: le altre voci possono
/// essere foglie sorelle ritrasmesse col loro `ts` vecchio (vedi `ritardo`).
fn ts_piu_recente(entries: &[WsTagEntry]) -> u64 {
    entries.iter().map(|t| t.ts).max().unwrap_or(0)
}

fn apply_entries(map: &mut TagSnapshot, entries: Vec<WsTagEntry>) {
    for t in entries {
        map.insert(
            t.id,
            TagSnapshotValue {
                value: t.value,
                quality: t.quality,
                ts: t.ts,
            },
        );
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

/// Attesa fra un tentativo di riconnessione e il successivo: 1 s che raddoppia
/// fino a 30 s.
///
/// **Perché la riconnessione esiste.** Fino al 2026-09-08 questi task facevano
/// `return` al primo errore: il pannello restava con l'ultimo fotogramma
/// disegnato, per sempre. Sul WP630 è successo alle 15:17:14, quando
/// l'installazione ha sostituito il container del runtime — e lo schermo è
/// rimasto congelato due ore, con la retroilluminazione accesa, mentre il
/// processo girava al 43% di CPU disegnando dati fermi. Un pannello davanti a
/// un impianto non ha nessuno che se ne accorga.
const ATTESA_MIN: std::time::Duration = std::time::Duration::from_secs(1);
const ATTESA_MAX: std::time::Duration = std::time::Duration::from_secs(30);

fn prossima_attesa(a: std::time::Duration) -> std::time::Duration {
    let doppia = a.saturating_mul(2);
    if doppia > ATTESA_MAX {
        ATTESA_MAX
    } else {
        doppia
    }
}

/// Il log di un poller che fallisce sempre (29-10-2026, da `Appunti.txt`): la
/// stessa attenuazione dei WebSocket, ma sul **log** e non sul ritmo — lo
/// storico si chiede comunque ogni 2 s, perché quando torna deve tornare
/// subito. Prima ogni giro fallito scriveva una riga: un trend guasto faceva
/// 43 200 righe di journal al giorno (misurato sul WP630 il 22-10-2026).
/// Adesso la prima subito, poi dopo 1, 2, 4… fino a 30 s, con quante ne ha
/// taciute; e una riga quando torna.
struct VoceAttenuata {
    taciuti: u32,
    prossima: Option<std::time::Instant>,
    attesa: std::time::Duration,
}

impl VoceAttenuata {
    fn nuova() -> Self {
        Self {
            taciuti: 0,
            prossima: None,
            attesa: ATTESA_MIN,
        }
    }

    /// Un errore: `Some(taciuti prima)` se va scritto, `None` se si tace.
    fn errore(&mut self, adesso: std::time::Instant) -> Option<u32> {
        if let Some(t) = self.prossima {
            if adesso < t {
                self.taciuti += 1;
                return None;
            }
        }
        let taciuti = std::mem::take(&mut self.taciuti);
        self.prossima = Some(adesso + self.attesa);
        self.attesa = prossima_attesa(self.attesa);
        Some(taciuti)
    }

    /// Un giro riuscito: si riparte da capo. Vero se prima c'era un guasto,
    /// cioè se vale la pena dire che è tornato.
    fn riuscito(&mut self) -> bool {
        let guasto = self.prossima.is_some();
        *self = Self::nuova();
        guasto
    }
}

fn taciuti(n: u32) -> String {
    if n == 0 {
        String::new()
    } else {
        format!(" ({n} errori uguali taciuti)")
    }
}

type FlussoWs =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn apri_ws(url: &str) -> anyhow::Result<FlussoWs> {
    let connector = tokio_tungstenite::Connector::Rustls(pinned_client_config_arc(url)?);
    let (stream, _resp) =
        tokio_tungstenite::connect_async_tls_with_config(url, None, false, Some(connector)).await?;
    Ok(stream)
}

pub async fn spawn_tag_subscription(
    base_url: &str,
) -> anyhow::Result<(SharedTagSnapshot, ReloadFlag)> {
    let url = ws_url(base_url, "/ws/tags")?;
    let connector = tokio_tungstenite::Connector::Rustls(pinned_client_config_arc(base_url)?);
    let (mut stream, _resp) = tokio_tungstenite::connect_async_tls_with_config(
        url.as_str(),
        None,
        false,
        Some(connector),
    )
    .await?;
    // Una connessione nuova: la misura del ritardo riparte da qui, non dallo
    // snapshot (come `ricominciaMisura` del web all'apertura del socket).
    crate::ritardo::socket_aperto();

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
        let Ok(parsed) = serde_json::from_str::<WsSnapshotMsg>(&text) else {
            continue;
        };
        if parsed.ty != "snapshot" {
            continue;
        }
        crate::ritardo::snapshot_arrivato(ts_piu_recente(&parsed.tags));
        let mut map = TagSnapshot::new();
        apply_entries(&mut map, parsed.tags);
        break map;
    };

    let shared: SharedTagSnapshot = Arc::new(Mutex::new(initial));
    let shared_bg = shared.clone();
    let reload: ReloadFlag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let reload_bg = reload.clone();

    // Task in background: vive quanto il runtime tokio (main.rs lo tiene in
    // vita per tutto il programma) e **riconnette da solo**. Nessun canale di
    // shutdown esplicito: il processo esce quando si chiude la finestra.
    let url_bg = url.clone();
    tokio::spawn(async move {
        let mut attesa = ATTESA_MIN;
        loop {
            while let Some(msg) = stream.next().await {
                let msg = match msg {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[ws] errore su /ws/tags: {e}");
                        break;
                    }
                };
                let Message::Text(text) = msg else {
                    if matches!(msg, Message::Close(_)) {
                        eprintln!("[ws] /ws/tags chiuso dal server");
                        break;
                    }
                    continue;
                };
                // Un delta e uno snapshot hanno campi diversi (`changed` vs
                // `tags`) ma lo stesso discriminante "type" — proviamo prima il
                // delta (il caso comune dopo l'avvio), poi lo snapshot (caso raro:
                // il server ne rimanda uno, es. dopo una riconnessione interna).
                if let Ok(delta) = serde_json::from_str::<WsDeltaMsg>(&text) {
                    if delta.ty == "delta" {
                        let ts = ts_piu_recente(&delta.changed);
                        {
                            let mut map = shared_bg.lock().unwrap_or_else(|e| e.into_inner());
                            apply_entries(&mut map, delta.changed);
                        }
                        // Dopo la mappa, non prima: così il disegno non conta
                        // mai un'età per valori che non ha ancora.
                        crate::ritardo::delta_arrivato(ts);
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
                        crate::ritardo::snapshot_arrivato(ts_piu_recente(&snap.tags));
                        let mut map = shared_bg.lock().unwrap_or_else(|e| e.into_inner());
                        apply_entries(&mut map, snap.tags);
                    }
                }
            }
            // Qui si arriva quando il flusso è finito, in un modo o nell'altro.
            // Non si esce dal task: si riprova, perché il runtime che è stato
            // sostituito fra un istante sarà di nuovo lì.
            //
            // Da qui i valori a schermo invecchiano: oltre 5 s la fascia «Dati
            // in ritardo» lo dice (09-11-2026). La connessione nuova, appena
            // aperta, la spegne.
            crate::ritardo::socket_giu();
            eprintln!(
                "[ws] /ws/tags interrotto — riprovo fra {}s",
                attesa.as_secs()
            );
            tokio::time::sleep(attesa).await;
            match apri_ws(&url_bg).await {
                Ok(nuovo) => {
                    crate::ritardo::socket_aperto();
                    stream = nuovo;
                    attesa = ATTESA_MIN;
                    // Ricaricare la pagina, non solo riprendere i valori: se il
                    // runtime è ripartito è perché qualcosa è cambiato, e molto
                    // spesso è il PROGETTO. Senza questo, il pannello riprenderebbe
                    // ad aggiornare i tag di una pagina che non esiste più — che è
                    // peggio di uno schermo fermo, perché sembra funzionare.
                    eprintln!("[ws] /ws/tags riconnesso — ricarico la pagina");
                    reload_bg.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                Err(e) => {
                    eprintln!("[ws] riconnessione a /ws/tags fallita: {e}");
                    attesa = prossima_attesa(attesa);
                }
            }
        }
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
    /// Il tag sorvegliato dall'allarme. Il server lo manda da sempre
    /// (`AlarmDef::tag` in `sws-core/src/alarm.rs`); era questo lato a
    /// ignorarlo, e senza non si può rispondere alla domanda «questo oggetto è
    /// in allarme?» — che serve a `blink_mode: alarm` e a `show_alarm_state`.
    ///
    /// `default` a stringa vuota: un allarme senza tag non appartiene a nessun
    /// oggetto, e va saltato invece di far fallire tutta la deserializzazione
    /// dell'elenco allarmi.
    #[serde(default)]
    pub tag: String,
}

/// Sottoinsieme di `AlarmState` — `isa_state`/`ack_at_ms`/`normalized_at_ms`/
/// `last_value` ignorati (non disegnati in modalità lista).
#[derive(Debug, Deserialize, Clone)]
pub struct AlarmStateLite {
    pub def: AlarmDefLite,
    /// Stato ISA-18.2 così come arriva dal server (`normal`, `active_unacked`,
    /// `active_acked`, `normal_unacked`). Stringa e non enum come `severity`,
    /// per la stessa ragione: questo è un mirror deliberatamente povero, e uno
    /// stato sconosciuto non deve far fallire il parsing di tutto il messaggio.
    /// Serve ad `alarm_banner`, che mostra gli allarmi **da confermare** e non
    /// può derivarlo dai due booleani qui sotto: un allarme rientrato e
    /// confermato (`normal`) ha `acknowledged: false` per come `sync_compat`
    /// li deriva in `sws-core`.
    #[serde(default)]
    pub isa_state: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub acknowledged: bool,
    #[serde(default)]
    pub activated_at_ms: Option<u64>,
    /// La severità e il messaggio **del livello che sta scattando**
    /// (23-09-2026). Un allarme ha più livelli e `def.severity`/`def.message`
    /// dicono quelli del formato vecchio: il pannello deve mostrare la soglia
    /// in vigore, o un Critical si vedrebbe come il Warning che era prima.
    /// `default` perché un runtime anteriore non manda questi campi, e allora
    /// valgono quelli della definizione (vedi `severita()`/`messaggio()`).
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

impl AlarmStateLite {
    /// La severità da mostrare: quella del livello in vigore se il runtime la
    /// manda, altrimenti quella della definizione.
    pub fn severita(&self) -> String {
        self.severity
            .clone()
            .unwrap_or_else(|| self.def.severity.clone())
    }

    /// Il messaggio da mostrare, stessa regola.
    pub fn messaggio(&self) -> String {
        self.message
            .clone()
            .unwrap_or_else(|| self.def.message.clone())
    }
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
    let connector = tokio_tungstenite::Connector::Rustls(pinned_client_config_arc(base_url)?);
    let (mut stream, _resp) = tokio_tungstenite::connect_async_tls_with_config(
        url.as_str(),
        None,
        false,
        Some(connector),
    )
    .await?;

    let shared: SharedAlarms = Arc::new(Mutex::new(HashMap::new()));
    let shared_bg = shared.clone();
    let url_bg = url.clone();
    tokio::spawn(async move {
        let mut attesa = ATTESA_MIN;
        loop {
            while let Some(msg) = stream.next().await {
                let msg = match msg {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[ws] errore su /ws/alarms: {e}");
                        break;
                    }
                };
                let Message::Text(text) = msg else {
                    if matches!(msg, Message::Close(_)) {
                        eprintln!("[ws] /ws/alarms chiuso dal server");
                        break;
                    }
                    continue;
                };
                let Ok(state) = serde_json::from_str::<AlarmStateLite>(&text) else {
                    continue;
                };
                let mut map = shared_bg.lock().unwrap_or_else(|e| e.into_inner());
                map.insert(state.def.id.clone(), state);
            }
            // Un pannello che smette di mostrare gli allarmi senza dirlo è la
            // cosa peggiore che possa fare: si riprova, sempre.
            eprintln!(
                "[ws] /ws/alarms interrotto — riprovo fra {}s",
                attesa.as_secs()
            );
            tokio::time::sleep(attesa).await;
            match apri_ws(&url_bg).await {
                Ok(nuovo) => {
                    stream = nuovo;
                    attesa = ATTESA_MIN;
                    eprintln!("[ws] /ws/alarms riconnesso");
                }
                Err(e) => {
                    eprintln!("[ws] riconnessione a /ws/alarms fallita: {e}");
                    attesa = prossima_attesa(attesa);
                }
            }
        }
    });

    Ok(shared)
}

/// `POST /api/alarms/:id/ack` — stesso endpoint REST usato dal pulsante ACK
/// del web. `token` (Q36): vedi `put_tag`/`apply_recipe`.
pub async fn ack_alarm(base_url: &str, alarm_id: &str, token: Option<&str>) -> anyhow::Result<()> {
    let mut url = reqwest::Url::parse(base_url)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("base URL non può avere path segments (cannot-be-a-base)"))?
        .push("api")
        .push("alarms")
        .push(alarm_id)
        .push("ack");
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url)?)
        .build()?;
    let mut req = client
        .post(url)
        .json(&serde_json::json!({ "by": "lvgl-viewer" }));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    req.send().await?.error_for_status()?;
    Ok(())
}

// ── La lingua scelta sul pannello, che deve sopravvivere al riavvio ──────────
//
// `SharedLang` è stato per anni solo in memoria: al riavvio del viewer si
// ripartiva dal `default` della tabella. Su un PC è un dettaglio — si riclicca;
// su un **pannello d'impianto** no: il viewer riparte a ogni riavvio del
// dispositivo, e un operatore che non parla la lingua del progettista se la
// ritrova cambiata sotto ogni mattina, senza capire perché.
//
// Stesso file e stessa cartella della sessione utente (`session.rs`), che è già
// la convenzione di questo motore: un file in più, non un percorso nuovo.

// Dal 21-10-2026 passa da `cartella_stato()` e non più da `$HOME` composto a
// mano: dentro il container il quadlet monta `/data/user/sws/viewer` e dichiara
// `SWS_VIEWER_DATA`, mentre `$HOME` non è montato. Scrivendo lì la lingua
// spariva a ogni riavvio del viewer — esattamente la cosa che il commento qui
// sopra dice di non voler far succedere.
fn percorso_lingua() -> Option<std::path::PathBuf> {
    Some(crate::cartella_stato()?.join("lvgl_lang"))
}

/// La lingua salvata, così com'è, senza tabella con cui controllarla: serve
/// alla schermata «si sta riavviando» (`riavvio.rs`), che parla prima di
/// avere un progetto.
pub fn lingua_salvata_grezza() -> Option<String> {
    let l = std::fs::read_to_string(percorso_lingua()?).ok()?;
    let l = l.trim().to_string();
    (!l.is_empty()).then_some(l)
}

/// La lingua salvata, se c'è ed è ancora una di quelle del progetto.
///
/// Il controllo contro `langs` non è pedanteria: un progetto deployato che
/// toglie una lingua lascerebbe il pannello su un codice che la tabella non ha
/// più, cioè su un sinottico pieno di token grezzi.
pub fn lingua_salvata(tabella: &crate::model::LanguageTable) -> Option<String> {
    let l = std::fs::read_to_string(percorso_lingua()?).ok()?;
    let l = l.trim().to_string();
    if l.is_empty() || !tabella.langs.iter().any(|x| x == &l) {
        return None;
    }
    Some(l)
}

/// Registra la lingua scelta. Un fallimento si dice e non ferma niente: il
/// pannello deve continuare a funzionare anche con `$HOME` in sola lettura.
pub fn salva_lingua(codice: &str) {
    let Some(p) = percorso_lingua() else { return };
    if let Some(dir) = p.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("[lang] impossibile creare {}: {e}", dir.display());
            return;
        }
    }
    if let Err(e) = std::fs::write(&p, codice) {
        eprintln!(
            "[lang] impossibile salvare la lingua in {}: {e}",
            p.display()
        );
    }
}

#[cfg(test)]
mod tests_riconnessione {

    /// La colonna «Stato» dello storico (25-09-2026): quattro casi, e una riga
    /// interrotta lo dice anche se ha un rientro — quel rientro non è vero.
    #[test]
    fn lo_stato_di_una_riga_di_storico() {
        use super::AlarmHistoryEvent;
        use sws_core::testi_sistema::Testo;
        let riga = |ack: Option<u64>, rientro: Option<u64>, interrotto: bool| {
            serde_json::from_value::<AlarmHistoryEvent>(serde_json::json!({
                "alarm_id": "a", "ts_activated_ms": 1,
                "ts_acked_ms": ack, "ts_normalized_ms": rientro, "interrotto": interrotto,
            }))
            .unwrap()
            .stato()
        };
        assert_eq!(riga(None, None, false), Testo::Attivo);
        assert_eq!(riga(None, Some(5), false), Testo::DaConfermare);
        assert_eq!(riga(Some(3), Some(5), false), Testo::Chiuso);
        assert_eq!(riga(None, Some(5), true), Testo::Interrotto);
        // Un runtime di prima non manda né rientro né `interrotto`.
        let vecchio: AlarmHistoryEvent =
            serde_json::from_str(r#"{"alarm_id":"a","ts_activated_ms":1}"#).unwrap();
        assert_eq!(vecchio.stato(), Testo::Attivo);
    }

    use super::{
        primo_id_dell_albero, prossima_attesa, NavPaginaDati, NavPagineDati, VoceAttenuata,
        ATTESA_MAX, ATTESA_MIN,
    };
    use std::time::Duration;

    /// Un trend guasto scriveva una riga ogni 2 s, per sempre. Adesso la
    /// prima subito, poi sempre più di rado, con quante ne ha taciute.
    #[test]
    fn il_log_di_un_poller_guasto_si_attenua() {
        let t0 = std::time::Instant::now();
        let s = |ms: u64| t0 + Duration::from_millis(ms);
        let mut v = VoceAttenuata::nuova();
        assert_eq!(v.errore(s(0)), Some(0), "la prima si scrive");
        assert_eq!(v.errore(s(500)), None);
        assert_eq!(v.errore(s(1000)), Some(1), "dopo 1 s, con quella taciuta");
        assert_eq!(v.errore(s(2000)), None);
        assert_eq!(v.errore(s(3000)), Some(1), "poi dopo 2 s");
        // A regime una riga ogni 30 s al massimo: su un giorno di poll ogni 2 s
        // sono meno di 3 000 righe invece di 43 200.
        let mut scritte = 0;
        for i in 2..43_200u64 {
            if v.errore(s(i * 2000)).is_some() {
                scritte += 1;
            }
        }
        assert!(scritte < 3_000, "{scritte}");
        assert!(v.riuscito(), "tornato: si dice");
        assert!(!v.riuscito(), "ma una volta sola");
        assert_eq!(
            v.errore(s(100_000_000)),
            Some(0),
            "un guasto nuovo si scrive subito"
        );
    }

    #[test]
    fn raddoppia_e_si_ferma_al_tetto() {
        let mut a = ATTESA_MIN;
        let mut viste = vec![a];
        for _ in 0..10 {
            a = prossima_attesa(a);
            viste.push(a);
        }
        assert_eq!(viste[0], Duration::from_secs(1));
        assert_eq!(viste[1], Duration::from_secs(2));
        assert_eq!(viste[2], Duration::from_secs(4));
        // Non cresce all'infinito: un pannello deve riprovare spesso abbastanza
        // da tornare su da solo quando il runtime riparte.
        assert_eq!(*viste.last().unwrap(), ATTESA_MAX);
        assert!(viste.iter().all(|d| *d <= ATTESA_MAX));
    }

    #[test]
    fn non_va_mai_in_overflow() {
        // `saturating_mul` e non `*`: una durata enorme moltiplicata per due
        // andrebbe in panico in debug, e un panico in questo task spegnerebbe
        // proprio la riconnessione che deve tenere vivo il pannello.
        assert_eq!(prossima_attesa(Duration::MAX), ATTESA_MAX);
    }

    #[test]
    fn il_tetto_e_raggiungibile_in_pochi_tentativi() {
        // Sei raddoppi da 1 s: 1,2,4,8,16,30. Circa un minuto per arrivare al
        // ritmo di regime — abbastanza rado da non pesare, abbastanza fitto da
        // non lasciare uno schermo fermo per ore.
        let mut a = ATTESA_MIN;
        let mut n = 0;
        while a < ATTESA_MAX {
            a = prossima_attesa(a);
            n += 1;
        }
        assert!(n <= 6, "servono {n} tentativi per arrivare al tetto");
    }
    // ── La pagina d'avvio segue l'albero, non l'alfabeto (Passo 3, B7) ──────

    fn nav(ids: &[&str], tree: Vec<sws_core::PageTreeNode>) -> NavPagineDati {
        NavPagineDati {
            pages: ids
                .iter()
                .map(|i| NavPaginaDati {
                    id: i.to_string(),
                    name: i.to_string(),
                })
                .collect(),
            tree,
        }
    }

    fn nodo(id: &str, figli: Vec<sws_core::PageTreeNode>) -> sws_core::PageTreeNode {
        sws_core::PageTreeNode {
            id: id.to_string(),
            children: figli,
        }
    }

    /// Il caso che ha motivato il passo: le pagine arrivano in ordine di file
    /// (alfabetico) e l'albero dice un'altra cosa. Prima vinceva l'alfabeto,
    /// quindi rinominare una pagina cambiava la schermata di avvio del
    /// pannello.
    #[test]
    fn la_prima_e_quella_dell_albero_non_la_prima_in_alfabeto() {
        let d = nav(
            &["allarmi", "impianto", "zavorra"],
            vec![
                nodo("impianto", vec![nodo("allarmi", vec![])]),
                nodo("zavorra", vec![]),
            ],
        );
        assert_eq!(primo_id_dell_albero(&d).as_deref(), Some("impianto"));
    }

    /// Senza albero l'ordine resta quello di prima: `riconcilia` appende in
    /// coda le pagine che l'albero non nomina, nell'ordine in cui arrivano.
    #[test]
    fn senza_albero_vale_l_ordine_in_cui_arrivano() {
        let d = nav(&["allarmi", "impianto"], vec![]);
        assert_eq!(primo_id_dell_albero(&d).as_deref(), Some("allarmi"));
    }

    /// Un albero che nomina una pagina che non esiste più: la prima voce
    /// dev'essere una pagina **vera**, o il pannello partirebbe con un errore
    /// invece che con una schermata.
    #[test]
    fn una_pagina_sparita_dall_albero_non_diventa_la_schermata_d_avvio() {
        let d = nav(
            &["impianto"],
            vec![nodo("cancellata", vec![]), nodo("impianto", vec![])],
        );
        assert_eq!(primo_id_dell_albero(&d).as_deref(), Some("impianto"));
    }

    /// I figli di un nodo scartato salgono al suo posto, quindi il primo può
    /// essere un figlio: è la regola di `riconcilia`, e qui conta perché
    /// decide cosa si vede all'accensione.
    #[test]
    fn i_figli_di_un_nodo_sparito_salgono() {
        let d = nav(
            &["figlia", "altra"],
            vec![
                nodo("sparita", vec![nodo("figlia", vec![])]),
                nodo("altra", vec![]),
            ],
        );
        assert_eq!(primo_id_dell_albero(&d).as_deref(), Some("figlia"));
    }

    /// L'elenco si rilegge solo quando serve: la prima volta, e poi quando il
    /// progetto cambia. Il test guarda il **flag**, perché la lettura vera
    /// vuole un runtime in ascolto — e il flag è la decisione che conta.
    #[test]
    fn l_elenco_del_navigatore_si_rilegge_solo_quando_serve() {
        use std::sync::atomic::Ordering::Relaxed;
        // Parte alzato: la prima apertura deve leggere, o il navigatore
        // nascerebbe vuoto.
        assert!(super::NAV_DA_RILEGGERE.load(Relaxed));

        // Dopo una lettura riuscita si abbassa (lo fa `aggiorna_pagine_nav`,
        // qui si simula l'effetto perché la lettura vuole la rete).
        super::NAV_DA_RILEGGERE.store(false, Relaxed);
        assert!(!super::NAV_DA_RILEGGERE.load(Relaxed));

        // Il progetto cambia: si rilegge alla prossima occasione.
        super::invalida_pagine_nav();
        assert!(super::NAV_DA_RILEGGERE.load(Relaxed));
    }

    #[test]
    fn un_progetto_senza_pagine_non_ha_una_prima() {
        assert_eq!(primo_id_dell_albero(&nav(&[], vec![])), None);
    }
}

#[cfg(test)]
mod prove_seme_spark {
    use super::spawn_seme_spark;
    use std::time::{Duration, Instant};

    /// Un server finto conta le richieste dello storico: il seme ne fa una, e
    /// la risposta arriva nella mini tendenza.
    #[test]
    fn il_seme_fa_una_richiesta_sola() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let conta = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let base = rt.block_on(async {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", l.local_addr().unwrap());
            let conta = conta.clone();
            tokio::spawn(async move {
                while let Ok((mut s, _)) = l.accept().await {
                    conta.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let mut buf = [0u8; 4096];
                    let _ = s.read(&mut buf).await;
                    let corpo = r#"[{"ts_ms":1000,"min":1,"max":3,"avg":2,"first":1,"last":3}]"#;
                    let risposta = format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{corpo}",
                        corpo.len()
                    );
                    let _ = s.write_all(risposta.as_bytes()).await;
                }
            });
            base
        });
        let seme = spawn_seme_spark(rt.handle(), base, "t".into(), 0, 60_000, 517);
        let t0 = Instant::now();
        let secchi = loop {
            if let Some(s) = seme.lock().unwrap().take() {
                break s;
            }
            assert!(t0.elapsed() < Duration::from_secs(5), "il seme non arriva");
            std::thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(secchi.len(), 1);
        assert_eq!(secchi[0].last, 3.0);
        // Una sparkline senza tag non chiede niente, come sul web.
        let vuoto = spawn_seme_spark(rt.handle(), "http://x".into(), String::new(), 0, 1, 1);
        assert_eq!(vuoto.lock().unwrap().take().map(|v| v.len()), Some(0));
        // Altri tre secondi: nessuno chiede più niente.
        std::thread::sleep(Duration::from_secs(3));
        assert_eq!(conta.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}

/// Il task di `/ws/tags` misura il ritardo dei valori (09-11-2026): un server
/// finto manda snapshot, delta e chiusura, e si guarda cosa vede il disegno.
///
/// È l'unica prova che tocca lo stato del processo in `ritardo`: un'altra che
/// aprisse `/ws/tags` in parallelo le mescolerebbe le misure.
#[cfg(test)]
mod prove_ritardo_ws {
    use super::{now_unix_ms, spawn_tag_subscription};
    use crate::ritardo;
    use futures_util::SinkExt;
    use std::time::{Duration, Instant};
    use tokio_tungstenite::tungstenite::Message;

    fn voce(id: &str, v: i64, ts: u64) -> String {
        format!(r#"{{"id":"{id}","value":{v},"quality":"Good","ts":{ts}}}"#)
    }

    fn delta(voci: &[String]) -> String {
        format!(
            r#"{{"type":"delta","changed":[{}],"seq":1}}"#,
            voci.join(",")
        )
    }

    /// L'età vista dal disegno `piu_ms` dopo adesso, appena soddisfa `ok`
    /// (fino a 3 s: il task lavora su un altro thread).
    async fn aspetta(piu_ms: u64, ok: impl Fn(u64) -> bool) -> u64 {
        let t0 = Instant::now();
        loop {
            let eta = ritardo::al_fotogramma(now_unix_ms() + piu_ms);
            if ok(eta) || t0.elapsed() > Duration::from_secs(3) {
                return eta;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[test]
    fn il_task_ws_misura_il_ritardo_dei_valori() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", l.local_addr().unwrap());
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Option<String>>();
            tokio::spawn(async move {
                let (s, _) = l.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
                while let Some(m) = rx.recv().await {
                    match m {
                        Some(t) => {
                            if ws.send(Message::Text(t)).await.is_err() {
                                return;
                            }
                        }
                        None => {
                            let _ = ws.close(None).await;
                            return;
                        }
                    }
                }
            });

            // Lo snapshot: un tag scritto adesso e uno fermo da un'ora.
            let adesso = now_unix_ms();
            tx.send(Some(format!(
                r#"{{"type":"snapshot","tags":[{},{}],"seq":0}}"#,
                voce("a", 1, adesso),
                voce("b", 1, adesso - 3_600_000)
            )))
            .unwrap();
            let (_tags, _ricarica) = spawn_tag_subscription(&base).await.unwrap();
            assert_eq!(
                ritardo::al_fotogramma(now_unix_ms()),
                0,
                "lo snapshot non è un ritardo, nemmeno col tag fermo da un'ora"
            );

            // Un delta arrivato con 8 s di coda.
            tx.send(Some(delta(&[voce("a", 2, now_unix_ms() - 8_000)])))
                .unwrap();
            let eta = aspetta(0, |e| e >= 7_000).await;
            assert_eq!(
                ritardo::testo_fascia(eta, "it").as_deref(),
                Some("Dati in ritardo di 8 s"),
                "{eta} ms"
            );

            // Una foglia scritta adesso, e la sorella ritrasmessa col suo ts
            // di un'ora fa: il lotto è fresco.
            let ora = now_unix_ms();
            tx.send(Some(delta(&[
                voce("s.x", 3, ora),
                voce("s.y", 0, ora - 3_600_000),
            ])))
            .unwrap();
            let eta = aspetta(0, |e| e < ritardo::SOGLIA_MS).await;
            assert!(eta < 1_000, "la sorella vecchia non conta: {eta} ms");

            // Il server chiude: sei secondi dopo i valori sono in ritardo.
            tx.send(None).unwrap();
            let eta = aspetta(6_000, ritardo::in_ritardo).await;
            assert!(ritardo::in_ritardo(eta), "socket giù da 6 s: {eta} ms");
        });
    }
}

#[cfg(test)]
mod prove_funzioni {
    use super::esito_della_funzione;

    #[test]
    fn una_funzione_fallita_e_un_errore_col_testo_del_runtime() {
        assert!(esito_della_funzione(&serde_json::json!({"ok": true})).is_ok());
        let e = esito_della_funzione(&serde_json::json!({"ok": false, "error": "NameError: x"}))
            .unwrap_err();
        assert_eq!(e.to_string(), "NameError: x");
    }
}
