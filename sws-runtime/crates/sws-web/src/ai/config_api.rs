//! Configurare l'assistente dall'IDE, invece che da una shell.
//!
//! # Perché esisteva solo la shell
//!
//! Fino a qui la chiave si metteva in un file e l'unica «interfaccia» era il
//! messaggio che il pannello mostra quando la chat è spenta: un testo con dentro
//! tre percorsi, cioè istruzioni per andare in un terminale. Va bene per chi
//! sviluppa, non per chi usa l'IDE.
//!
//! # Dove queste rotte esistono, e dove no
//!
//! **Solo su un'istanza IDE-only** (`AppState::ide_only`, cioè nessun
//! `--viewer-port`: `start_editor.sh`). Su un runtime che serve un impianto
//! rispondono **404**, non 403 — la differenza conta: un 403 dice «esiste ma non
//! ti è permesso», e per una funzione che su quella macchina non deve esistere
//! affatto il 404 è la risposta onesta.
//!
//! È anche la risposta alla riserva che il piano aveva messo per iscritto: oggi
//! l'assistente è spento sul dispositivo **per assenza di chiave**, non per
//! scelta. Con queste rotte assenti lì, la scelta diventa esplicita.
//!
//! # Cosa si scrive
//!
//! Due file distinti, e non è pignoleria:
//!
//! - `config_dir/<fornitore>.key` — la chiave, con permessi **0600**. È il primo
//!   percorso che `client::percorsi_chiave_di` già cerca, quindi nessuna
//!   migrazione: chi ha la chiave in `~/.config/sws/` continua a funzionare.
//! - `config_dir/ai.yaml` — fornitore e modello (`client::Impostazioni`).
//!
//! Separati perché il segreto merita permessi che un file di impostazioni non
//! deve avere.
//!
//! # La chiave si rilegge solo riconnettendo
//!
//! `client::carica` è chiamata **una volta per sessione WebSocket** (`ai/mod.rs`),
//! prima del ciclo dei messaggi: scrivere il file non ha effetto su una chat già
//! aperta. Il pannello deve chiudere e riaprire il socket dopo un `PUT`
//! riuscito, e la risposta lo dice con `riconnetti: true` invece di lasciarlo
//! dedurre.

use axum::http::StatusCode;
use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::ai::client::{self, Fornitore, Impostazioni};
use crate::ai::scopi::{self, Scopo, ScopoCfg};
use crate::router::{AppState, AuthUser, MASKED_PASSWORD};

/// Le rotte esistono solo dove hanno senso. Vedi il commento in testa.
// `Response` come Err è grande, ma è un ritorno anticipato che il chiamante
// restituisce così com'è: incartarlo in un Box aggiungerebbe solo rumore.
#[allow(clippy::result_large_err)]
fn solo_ide(s: &AppState) -> Result<(), Response> {
    // Not on the gateway either, which has no `--viewer-port` and so looks
    // like an IDE: it opens no project, its AI settings serve nobody, and
    // every user of every company is an Admin there.
    if s.ide_only && s.regia.is_none() {
        Ok(())
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(json!({
                "errore": "la configurazione dell'assistente esiste solo sull'istanza IDE \
                           (quella avviata senza viewer)",
            })),
        )
            .into_response())
    }
}

/// `GET /api/ai/config` — Admin, solo IDE. Tutto quello che il menù IA mostra:
/// i fornitori con le loro chiavi (se ci sono, mai quali), gli scopi con la
/// scelta salvata e quella **effettiva** (cosa userà davvero), le variabili
/// d'ambiente che scavalcano il file. Non restituisce **niente** della chiave,
/// nemmeno mascherata: al pannello serve sapere *se* è configurata.
pub async fn get_ai_config(State(s): State<AppState>, req: axum::extract::Request) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    // The key the project would use for each provider: its own, or that of the
    // user asking (behind the gateway), or none (`source`). Read before any
    // await: the request is not held across them.
    let username = req
        .extensions()
        .get::<crate::router::AuthUser>()
        .map(|a| a.username.clone())
        .unwrap_or_default();
    let user_keys = crate::ai::user_keys::fetch_all(&s, &username).await;

    let imp = Impostazioni::carica(&s.config_dir);
    let ambiente: Vec<&str> = [
        "SWS_AI_FORNITORE",
        "SWS_AI_MODELLO",
        "SWS_AI_TETTO_USD",
        "ANTHROPIC_API_KEY",
        "MOONSHOT_API_KEY",
        "KIMI_API_KEY",
        "MISTRAL_API_KEY",
        "OPENAI_API_KEY",
        "BFL_API_KEY",
    ]
    .into_iter()
    .filter(|v| {
        std::env::var(v)
            .map(|x| !x.trim().is_empty())
            .unwrap_or(false)
    })
    .collect();

    let fornitori: Vec<_> = scopi::FORNITORI
        .iter()
        .map(|(id, nome, sa)| {
            json!({
                "id": id,
                "nome": nome,
                "scopi": sa,
                "chiave": scopi::ha_chiave(&s.config_dir, id),
                // Which key the project would use: `project`, `user` (the key
                // of whoever opens this menu) or null.
                "source": match Fornitore::da_nome(id) {
                    Some(f) => client::resolve_key(&s.config_dir, f, &user_keys).map(|(_, src)| src.name()),
                    None if scopi::ha_chiave(&s.config_dir, id) => Some("project"),
                    None => user_keys.key_of(id).map(|_| "user"),
                },
                // The model the user prefers in their account, if any.
                "modello_account": user_keys.model_of(id),
                "modello_default": match scopi::ImageProvider::from_name(id) {
                    Some(p) => p.default_model().to_string(),
                    None => Fornitore::da_nome(id)
                        .map(|f| client::default_model_of(&s.config_dir, f))
                        .unwrap_or_default(),
                },
            })
        })
        .collect();

    let mut per_scopo = serde_json::Map::new();
    for sc in Scopo::TUTTI {
        let (attivo, fornitore, modello, tetto) = if sc.immagini() {
            match scopi::carica_sfondi_con(&s.config_dir, &user_keys) {
                Some(x) => (
                    true,
                    Some(x.fornitore.name().to_string()),
                    Some(x.modello),
                    Some(x.tetto_usd),
                ),
                None => (false, None, None, None),
            }
        } else {
            match scopi::carica_per_con(&s.config_dir, sc, &user_keys) {
                Some(x) => (
                    true,
                    Some(x.fornitore.nome().to_string()),
                    Some(x.modello),
                    Some(x.tetto_usd),
                ),
                None => (false, None, None, None),
            }
        };
        per_scopo.insert(
            sc.nome().to_string(),
            json!({
                "salvato": imp.scopo(sc),
                "attivo": attivo,
                "effettivo": { "fornitore": fornitore, "modello": modello, "tetto_usd": tetto },
                // Simboli e traduzione senza scelta propria sono l'assistente.
                // With the keys of the user asking: in the cloud a project
                // without keys of its own has no assistant to compare with
                // otherwise, and every purpose would look like its own choice.
                "eredita": !matches!(sc, Scopo::Assistente | Scopo::Sfondi)
                    && !scopi::ha_scelta_propria_con(&s.config_dir, sc, &user_keys),
            }),
        );
    }

    // The local model as saved, even half done (an address without a model
    // yet): the menu shows what was typed. Its key, as the others, only as
    // «there is one».
    let local = imp.local.as_ref().map(|c| {
        json!({
            "url": c.url,
            "model": c.model,
            "sees_images": c.sees_images,
            "has_key": client::chiave_di(&s.config_dir, Fornitore::Local).is_some(),
        })
    });

    Json(json!({
        "fornitori": fornitori,
        "local": local,
        // The providers the user asking prefers in their account (cloud only):
        // the menu says so where the project chose none.
        "preferito_account": {
            "testo": user_keys.preferred_text(),
            "immagini": user_keys.preferred_images(),
        },
        "scopi": per_scopo,
        "da_ambiente": ambiente,
        "tetto_usd_default": client::TETTO_DEFAULT_USD,
        "tetto_sfondi_default": scopi::TETTO_SFONDI_USD,
        // A local model is free on a panel or a local IDE, and its cap means
        // nothing there; in the cloud it is counted as an estimate.
        "in_cloud": s.in_cloud(),
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiConfigBody {
    /// Uno scopo → la sua scelta, o `null` per toglierla (simboli e traduzione
    /// tornano all'assistente). Gli scopi non nominati non si toccano.
    pub scopi: std::collections::BTreeMap<String, Option<ScopoCfg>>,
}

/// `PUT /api/ai/config` — Admin, solo IDE. Gli scopi; le chiavi hanno la loro
/// rotta, perché il segreto non viaggi insieme a un'impostazione qualunque.
pub async fn put_ai_config(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<AiConfigBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let mut imp = Impostazioni::carica(&s.config_dir);
    for (nome, cfg) in body.scopi {
        let Some(sc) = Scopo::da_nome(&nome) else {
            return errore(
                StatusCode::BAD_REQUEST,
                format!("scopo `{nome}` sconosciuto"),
            );
        };
        let cfg = cfg.map(|mut c| {
            c.fornitore = c
                .fornitore
                .map(|f| f.trim().to_ascii_lowercase())
                .filter(|f| !f.is_empty());
            c.modello = c
                .modello
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty());
            c.tetto_usd = c.tetto_usd.filter(|t| t.is_finite() && *t > 0.0);
            c
        });
        if let Some(f) = cfg.as_ref().and_then(|c| c.fornitore.as_deref()) {
            let adatto = scopi::FORNITORI
                .iter()
                .any(|(id, _, sa)| *id == f && sa.contains(&sc.nome()));
            if !adatto {
                return errore(
                    StatusCode::BAD_REQUEST,
                    format!("il fornitore `{f}` non serve per lo scopo `{nome}`"),
                );
            }
        }
        imp.imposta(sc, cfg);
    }
    if let Err(e) = imp.salva(&s.config_dir) {
        return errore(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("le impostazioni non si sono potute scrivere: {e}"),
        );
    }
    s.audit.log(
        "ai.config_changed",
        Some(user.username),
        json!({ "scopi": imp.scopi.keys().collect::<Vec<_>>() }),
    );
    // La scelta si legge all'apertura del socket della chat: il pannello deve
    // riconnettersi per vederla.
    Json(json!({ "ok": true, "riconnetti": true })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChiaveBody {
    pub fornitore: String,
    #[serde(default)]
    pub chiave: Option<String>,
    /// Only for testing the local model: the address typed in the menu, not
    /// saved yet (the models it lists are what the menu then offers).
    #[serde(default)]
    pub url: Option<String>,
}

/// `PUT /api/ai/chiavi` — Admin, solo IDE. Scrive la chiave di un fornitore
/// (0600, `config_dir/<fornitore>.key`).
pub async fn put_chiave(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<ChiaveBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let Some(file) = scopi::file_chiave(&body.fornitore) else {
        return errore(
            StatusCode::BAD_REQUEST,
            format!("fornitore `{}` sconosciuto", body.fornitore),
        );
    };
    let k = body.chiave.as_deref().map(str::trim).unwrap_or("");
    if k == MASKED_PASSWORD || k.is_empty() {
        return Json(json!({ "ok": true, "cambiata": false })).into_response();
    }
    if k.len() < 16 || k.split_whitespace().count() > 1 {
        return errore(
            StatusCode::BAD_REQUEST,
            "la chiave non sembra una chiave: deve essere una sola parola di almeno 16 caratteri"
                .to_string(),
        );
    }
    if let Err(e) = crate::segreti::scrivi_chiave(&s.config_dir, file, k) {
        return errore(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("la chiave non si è potuta scrivere: {e}"),
        );
    }
    s.audit.log(
        "ai.key_set",
        Some(user.username),
        json!({ "fornitore": body.fornitore }),
    );
    Json(json!({ "ok": true, "cambiata": true, "riconnetti": true })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalBody {
    /// The base of the OpenAI-compatible API (`http://host:11434/v1`). Empty =
    /// no local model any more.
    pub url: String,
    /// May be empty for now: the menu saves the address, tests it, and then
    /// offers the models it lists.
    #[serde(default)]
    pub model: String,
    /// Absent, empty or masked = unchanged.
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub sees_images: bool,
}

/// `PUT /api/ai/local` — Admin, IDE only. The local model: address, model,
/// whether it reads images, and its optional key.
///
/// The address is checked here and not only when it is used: in the cloud a
/// private one is refused at once, with the same rule as `local_http` (which
/// still guards every request, a name being free to resolve differently
/// later). The key has no 16-character minimum: a vLLM `--api-key` is
/// whatever its owner chose.
pub async fn put_local(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<LocalBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let mut imp = Impostazioni::carica(&s.config_dir);
    let url = body.url.trim();
    if url.is_empty() {
        // No address, no local model: its key goes too, it would be the key
        // of nothing.
        imp.local = None;
        if let Err(e) = imp.salva(&s.config_dir) {
            return errore(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("the settings could not be written: {e}"),
            );
        }
        let _ = crate::segreti::cancella_chiave(&s.config_dir, Fornitore::Local.file_chiave());
        s.audit
            .log("ai.local_removed", Some(user.username), json!({}));
        return Json(json!({ "ok": true, "riconnetti": true })).into_response();
    }
    let cfg = client::LocalCfg {
        url: url.to_string(),
        model: body.model.trim().to_string(),
        sees_images: body.sees_images,
    };
    if let Err(e) = crate::ai::local_http::check_url(cfg.base(), s.in_cloud()) {
        return address_refused(
            StatusCode::BAD_REQUEST,
            &e,
            json!({ "errore": e.to_string() }),
        );
    }
    let key = body
        .key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty() && *k != MASKED_PASSWORD);
    if let Some(k) = key {
        if k.split_whitespace().count() > 1 {
            return errore(
                StatusCode::BAD_REQUEST,
                "the key must be a single word".to_string(),
            );
        }
        if let Err(e) =
            crate::segreti::scrivi_chiave(&s.config_dir, Fornitore::Local.file_chiave(), k)
        {
            return errore(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("the key could not be written: {e}"),
            );
        }
    }
    // A new server without a new key: the saved key was for the old one, and
    // would otherwise go to an address typed by someone who never saw it.
    let key_dropped = key.is_none()
        && imp
            .local
            .as_ref()
            .is_some_and(|old| !crate::ai::local_http::same_origin(old.base(), cfg.base()))
        && crate::segreti::cancella_chiave(&s.config_dir, Fornitore::Local.file_chiave())
            .unwrap_or(false);
    // The host is enough to tell which server: the audit keeps no more.
    let host = reqwest::Url::parse(cfg.base())
        .ok()
        .and_then(|u| u.host_str().map(str::to_string));
    let audit = json!({
        "host": host,
        "model": cfg.model,
        "key_changed": key.is_some(),
        "key_dropped": key_dropped,
    });
    imp.local = Some(cfg);
    if let Err(e) = imp.salva(&s.config_dir) {
        return errore(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("the settings could not be written: {e}"),
        );
    }
    s.audit.log("ai.local_set", Some(user.username), audit);
    Json(json!({ "ok": true, "riconnetti": true })).into_response()
}

/// `DELETE /api/ai/chiavi` — Admin, solo IDE.
pub async fn delete_chiave(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<ChiaveBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let Some(file) = scopi::file_chiave(&body.fornitore) else {
        return errore(
            StatusCode::BAD_REQUEST,
            format!("fornitore `{}` sconosciuto", body.fornitore),
        );
    };
    match crate::segreti::cancella_chiave(&s.config_dir, file) {
        Ok(cera) => {
            if cera {
                s.audit.log(
                    "ai.key_removed",
                    Some(user.username),
                    json!({ "fornitore": body.fornitore }),
                );
            }
            Json(json!({ "ok": true, "cera": cera, "riconnetti": true })).into_response()
        }
        Err(e) => errore(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("la chiave non si è potuta cancellare: {e}"),
        ),
    }
}

/// `POST /api/ai/chiavi/prova` — Admin, solo IDE. «Prova la chiave»: l'elenco
/// dei modelli del fornitore, che non costa niente.
pub async fn prova_chiave(
    State(s): State<AppState>,
    Extension(user): Extension<crate::router::AuthUser>,
    Json(body): Json<ChiaveBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    // Without a key of the project, the one of whoever asks (cloud only).
    let user_keys = crate::ai::user_keys::fetch_all(&s, &user.username).await;
    // A masked key is the saved one: the menu shows it that way.
    let typed_key = body
        .chiave
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty() && *k != MASKED_PASSWORD);
    let local = body.url.as_deref().map(|u| (u, typed_key));
    // An address refused before any request: with its code, for the menu to
    // say it in its language.
    if Fornitore::da_nome(&body.fornitore) == Some(Fornitore::Local) {
        let url = match body.url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
            Some(u) => client::LocalCfg {
                url: u.to_string(),
                ..Default::default()
            },
            None => Impostazioni::carica(&s.config_dir)
                .local
                .unwrap_or_default(),
        };
        if !url.base().is_empty() {
            if let Err(e) = crate::ai::local_http::check_url(url.base(), s.in_cloud()) {
                return address_refused(
                    StatusCode::OK,
                    &e,
                    json!({ "ok": false, "errore": e.to_string() }),
                );
            }
        }
    }
    match scopi::prova_chiave(
        &s.config_dir,
        &body.fornitore,
        &user_keys,
        local,
        s.in_cloud(),
    )
    .await
    {
        Ok(modelli) => Json(json!({ "ok": true, "modelli": modelli })).into_response(),
        Err(e) => Json(json!({ "ok": false, "errore": e })).into_response(),
    }
}

/// `GET /api/ai/spending` — Admin, IDE only, like the rest of the AI
/// configuration. The spending history of the installation (`ai/spending.rs`):
/// the months from the newest, each with its total and the split by purpose
/// and by provider. The current month is always there, even at zero, so the
/// tab has a first row to show.
pub async fn get_spending(State(s): State<AppState>) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let config_dir = s.config_dir.clone();
    let record =
        tokio::task::spawn_blocking(move || crate::ai::spending::Record::load(&config_dir))
            .await
            .unwrap_or_default();
    Json(crate::ai::spending::report(
        &record,
        &crate::ai::spending::current_month(),
    ))
    .into_response()
}

/// A refused address of the local model: `body` with the code the IDE
/// translates, when there is one.
fn address_refused(
    status: StatusCode,
    e: &crate::ai::local_http::AddressError,
    mut body: serde_json::Value,
) -> Response {
    if let Some(c) = e.code() {
        body["codice"] = c;
    }
    (status, Json(body)).into_response()
}

fn errore(codice: StatusCode, msg: String) -> Response {
    (codice, Json(json!({ "errore": msg }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body_of(r: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(r.into_body(), 1 << 20).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// The spending history is configuration of the IDE like the keys: 404 on
    /// a runtime that serves a plant, the months on the IDE instance.
    #[tokio::test]
    async fn spending_is_served_only_by_the_ide_instance() {
        let d = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(d.path()).await;
        crate::ai::spending::add(d.path(), "sfondi", "bfl", 0.045);
        crate::ai::spending::add(d.path(), "assistente", "anthropic", 1.0);

        s.ide_only = false;
        let r = get_spending(State(s.clone())).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);

        s.ide_only = true;
        let r = get_spending(State(s)).await;
        assert_eq!(r.status(), StatusCode::OK);
        let v = body_of(r).await;
        let now = crate::ai::spending::current_month();
        assert_eq!(v["current_month"], now.as_str());
        assert_eq!(v["months"][0]["month"], now.as_str());
        assert_eq!(v["months"][0]["calls"], 2);
        assert!((v["months"][0]["usd"].as_f64().unwrap() - 1.045).abs() < 1e-9);
        let rows = v["months"][0]["rows"].as_array().unwrap();
        assert!(rows
            .iter()
            .any(|r| r["purpose"] == "sfondi" && r["provider"] == "bfl"));
    }

    /// The AI menu lists Black Forest Labs with its key, and the backgrounds
    /// say which provider they will really use.
    #[tokio::test]
    async fn the_menu_lists_bfl_and_the_backgrounds_say_their_provider() {
        // The environment of whoever runs the tests may hold real keys.
        if std::env::var_os("OPENAI_API_KEY").is_some() || std::env::var_os("BFL_API_KEY").is_some()
        {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(d.path()).await;
        s.ide_only = true;
        std::fs::write(d.path().join("bfl.key"), "bfl-prova-0123456789abcdef").unwrap();
        let req = axum::extract::Request::new(axum::body::Body::empty());
        let v = body_of(get_ai_config(State(s), req).await).await;
        // Not the cloud: a local model would be free here, with no cap.
        assert_eq!(v["in_cloud"], false);
        let bfl = v["fornitori"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == "bfl")
            .expect("bfl is in the menu");
        assert_eq!(bfl["chiave"], true);
        assert_eq!(bfl["source"], "project");
        assert_eq!(bfl["modello_default"], "flux-2-pro");
        assert_eq!(bfl["scopi"], json!(["sfondi"]));
        let eff = &v["scopi"]["sfondi"];
        assert_eq!(eff["attivo"], true);
        assert_eq!(eff["effettivo"]["fornitore"], "bfl");
        assert_eq!(eff["effettivo"]["modello"], "flux-2-pro");
    }

    /// In the cloud the menu reads the account of whoever opens it: the keys,
    /// the preferred provider (shown, and used where the project chose none),
    /// and whether a purpose really inherits the assistant.
    #[tokio::test]
    async fn in_the_cloud_the_menu_follows_the_account_of_who_opens_it() {
        let d = tempfile::tempdir().unwrap();
        if std::env::var_os("SWS_AI_FORNITORE").is_some()
            || std::env::var_os("SWS_AI_MODELLO").is_some()
            || [Fornitore::Anthropic, Fornitore::Kimi, Fornitore::Mistral]
                .iter()
                .any(|f| client::chiave_di(d.path(), *f).is_some())
        {
            return;
        }
        // A fake gateway: account keys for Kimi and Mistral, Mistral preferred.
        let headers = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let seen = headers.clone();
        let app = axum::Router::new()
            .route(
                "/api/internal/ai-key/:provider",
                axum::routing::get(
                    |axum::extract::Path(p): axum::extract::Path<String>| async move {
                        match p.as_str() {
                            "kimi" | "mistral" => {
                                Json(json!({ "key": format!("sk-account-{p}"), "model": null }))
                                    .into_response()
                            }
                            _ => StatusCode::NOT_FOUND.into_response(),
                        }
                    },
                ),
            )
            .route(
                "/api/internal/ai-preferences",
                axum::routing::get(move |h: axum::http::HeaderMap| {
                    let seen = seen.clone();
                    async move {
                        let key = h
                            .get(crate::gateway::ritorno::INTESTAZIONE)
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("-")
                            .to_string();
                        seen.lock().unwrap().push(key);
                        Json(json!({ "text": "mistral", "images": null }))
                    }
                }),
            );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", l.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });

        let mut s = crate::router::stato_di_prova(d.path()).await;
        s.ide_only = true;
        s.ritorno = std::sync::Arc::new(crate::gateway::ritorno::Ritorno::for_tests(
            "acme/x:firma",
            &origin,
        ));
        // Translation chose Kimi, which has no key in the project: its own
        // choice all the same, thanks to the account.
        std::fs::write(
            d.path().join("ai.yaml"),
            "scopi:\n  traduzione: {fornitore: kimi}\n",
        )
        .unwrap();
        let mut req = axum::extract::Request::new(axum::body::Body::empty());
        req.extensions_mut().insert(AuthUser {
            username: "m@soligo.net".into(),
            ..admin()
        });
        let v = body_of(get_ai_config(State(s), req).await).await;
        assert_eq!(
            v["preferito_account"],
            json!({ "testo": "mistral", "immagini": null })
        );
        assert_eq!(
            v["scopi"]["assistente"]["effettivo"]["fornitore"],
            "mistral"
        );
        assert_eq!(v["scopi"]["traduzione"]["effettivo"]["fornitore"], "kimi");
        assert_eq!(v["scopi"]["traduzione"]["eredita"], false);
        assert_eq!(v["scopi"]["simboli"]["eredita"], true);
        // The preferences were asked with the container's return key.
        assert_eq!(*headers.lock().unwrap(), ["acme/x:firma"]);
    }

    fn admin() -> AuthUser {
        AuthUser {
            username: "admin".into(),
            role: sws_auth::Role::Admin,
            must_change_password: false,
            allowed_zones: vec![],
            amministratore_piattaforma: false,
        }
    }

    async fn put_local_(s: &AppState, body: serde_json::Value) -> Response {
        put_local(
            State(s.clone()),
            Extension(admin()),
            Json(serde_json::from_value(body).unwrap()),
        )
        .await
    }

    /// The local model from the IDE: any address on a panel or a local IDE,
    /// only public ones in the cloud; a short key is a key; the menu reads
    /// it back, the key as «there is one».
    #[tokio::test]
    async fn the_local_model_is_saved_from_the_ide() {
        let d = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(d.path()).await;
        s.ide_only = false;
        let r = put_local_(&s, json!({ "url": "http://192.168.1.20:11434/v1" })).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        s.ide_only = true;

        for bad in ["ftp://host/v1", "not an address", "file:///etc/passwd"] {
            let r = put_local_(&s, json!({ "url": bad, "model": "m" })).await;
            assert_eq!(r.status(), StatusCode::BAD_REQUEST, "{bad}");
        }
        let r = put_local_(
            &s,
            json!({ "url": "http://192.168.1.20:11434/v1", "model": "qwen3:1.7b",
                    "key": "token-abc", "sees_images": true }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(
            std::fs::read_to_string(d.path().join("local.key")).unwrap(),
            "token-abc"
        );
        let c = client::local_cfg(d.path()).unwrap();
        assert_eq!(
            (c.url.as_str(), c.model.as_str(), c.sees_images),
            ("http://192.168.1.20:11434/v1", "qwen3:1.7b", true)
        );
        // A masked key leaves the saved one; two words are not a key.
        let r = put_local_(
            &s,
            json!({ "url": "http://192.168.1.20:11434/v1", "model": "llama3.3",
                    "key": MASKED_PASSWORD }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        assert!(d.path().join("local.key").exists());
        let r = put_local_(
            &s,
            json!({ "url": "http://192.168.1.20:11434/v1", "key": "two words" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);

        // The menu: the provider is ready, its model is the saved one.
        let req = axum::extract::Request::new(axum::body::Body::empty());
        let v = body_of(get_ai_config(State(s.clone()), req).await).await;
        assert_eq!(
            v["local"],
            json!({ "url": "http://192.168.1.20:11434/v1", "model": "llama3.3",
                    "sees_images": false, "has_key": true })
        );
        let local = v["fornitori"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == "local")
            .expect("local is in the menu");
        assert_eq!(local["chiave"], true);
        assert_eq!(local["modello_default"], "llama3.3");

        // In the cloud a private address is refused at once.
        s.segreto_gateway = Some(std::sync::Arc::new("secret".into()));
        for private in [
            "http://192.168.1.20:11434/v1",
            "http://127.0.0.1:11434/v1",
            "http://[::1]:8000/v1",
        ] {
            let r = put_local_(&s, json!({ "url": private, "model": "m" })).await;
            assert_eq!(r.status(), StatusCode::BAD_REQUEST, "{private}");
        }
        let r = put_local_(
            &s,
            json!({ "url": "https://llm.example.com/v1", "model": "m" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);

        // No address, no local model, and no key of nothing.
        let r = put_local_(&s, json!({ "url": "" })).await;
        assert_eq!(r.status(), StatusCode::OK);
        assert!(Impostazioni::carica(d.path()).local.is_none());
        assert!(!d.path().join("local.key").exists());
    }

    /// Review of 17-11-2026: the saved key of the local model went to any new
    /// address, typed by an Admin who never saw it. It stays with its server:
    /// a new path on the same server keeps it, a new server drops it.
    #[tokio::test]
    async fn the_local_key_stays_with_its_server() {
        let d = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(d.path()).await;
        s.ide_only = true;
        let key = d.path().join("local.key");
        let r = put_local_(
            &s,
            json!({ "url": "http://192.168.1.20:8000/v1", "model": "m", "key": "vllm-secret" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        let r = put_local_(
            &s,
            json!({ "url": "http://192.168.1.20:8000/openai/v1", "model": "m" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        assert!(key.exists(), "same server, same key");
        let r = put_local_(
            &s,
            json!({ "url": "https://attacker.example/v1", "model": "m" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        assert!(!key.exists(), "the key followed the address");
        // A new server with its own key: that key is kept.
        let r = put_local_(
            &s,
            json!({ "url": "http://10.0.0.5:11434/v1", "model": "m", "key": "other" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(std::fs::read_to_string(&key).unwrap(), "other");
    }

    /// A user and a password in the address are refused: the address goes
    /// back to the menu and into messages, where a secret never goes.
    #[tokio::test]
    async fn an_address_with_a_password_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(d.path()).await;
        s.ide_only = true;
        let r = put_local_(
            &s,
            json!({ "url": "http://u:secret@192.168.1.20:8000/v1", "model": "m" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        let v = body_of(r).await;
        assert!(!v.to_string().contains("secret"), "{v}");
        assert_eq!(v["codice"]["id"], "local_address_has_credentials");
        // The test of the address too, before any request.
        let r = prova_chiave(
            State(s.clone()),
            Extension(admin()),
            Json(
                serde_json::from_value(
                    json!({ "fornitore": "local", "url": "http://u:secret@192.168.1.20/v1" }),
                )
                .unwrap(),
            ),
        )
        .await;
        let v = body_of(r).await;
        assert_eq!(v["ok"], false);
        assert_eq!(v["codice"]["id"], "local_address_has_credentials");
        assert!(Impostazioni::carica(d.path()).local.is_none());
    }

    /// Review of 17-11-2026: the gateway runs without a viewer, so it looked
    /// like an IDE, and every user of every company is an Admin there. Its AI
    /// routes do not exist, and it counts as the cloud for the local model.
    #[tokio::test]
    async fn the_gateway_has_no_ai_settings() {
        let d = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(d.path()).await;
        s.ide_only = true;
        assert!(!s.in_cloud());
        s.regia = Some(std::sync::Arc::new(crate::gateway::progetti::Regia::nuova(
            crate::gateway::podman::Podman::nuovo(d.path().join("podman.sock")),
            "image",
            d.path(),
            crate::gateway::progetti::ComeRaggiungere::PortaPubblicata,
            "segretolungoabbastanza0123",
        )));
        assert!(s.in_cloud());
        let r = put_local_(
            &s,
            json!({ "url": "http://sws-p-other-company:8444/x?", "model": "m" }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        assert!(Impostazioni::carica(d.path()).local.is_none());
        let r = prova_chiave(
            State(s.clone()),
            Extension(admin()),
            Json(
                serde_json::from_value(
                    json!({ "fornitore": "local", "url": "http://169.254.169.254/latest?x=" }),
                )
                .unwrap(),
            ),
        )
        .await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        let req = axum::extract::Request::new(axum::body::Body::empty());
        assert_eq!(
            get_ai_config(State(s.clone()), req).await.status(),
            StatusCode::NOT_FOUND
        );
    }
}
