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
    if s.ide_only {
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
pub async fn get_ai_config(State(s): State<AppState>) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }

    let imp = Impostazioni::carica(&s.config_dir);
    let ambiente: Vec<&str> = [
        "SWS_AI_FORNITORE",
        "SWS_AI_MODELLO",
        "SWS_AI_TETTO_USD",
        "ANTHROPIC_API_KEY",
        "MOONSHOT_API_KEY",
        "KIMI_API_KEY",
        "OPENAI_API_KEY",
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
                "modello_default": match *id {
                    "openai" => scopi::MODELLO_SFONDI,
                    f => Fornitore::da_nome(f).map(|f| f.modello_default()).unwrap_or(""),
                },
            })
        })
        .collect();

    let mut per_scopo = serde_json::Map::new();
    for sc in Scopo::TUTTI {
        let (attivo, fornitore, modello, tetto) = if sc.immagini() {
            match scopi::carica_sfondi(&s.config_dir) {
                Some(x) => (
                    true,
                    Some("openai".to_string()),
                    Some(x.modello),
                    Some(x.tetto_usd),
                ),
                None => (false, None, None, None),
            }
        } else {
            match scopi::carica_per(&s.config_dir, sc) {
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
                "eredita": !matches!(sc, Scopo::Assistente | Scopo::Sfondi)
                    && !scopi::ha_scelta_propria(&s.config_dir, sc),
            }),
        );
    }

    Json(json!({
        "fornitori": fornitori,
        "scopi": per_scopo,
        "da_ambiente": ambiente,
        "tetto_usd_default": client::TETTO_DEFAULT_USD,
        "tetto_sfondi_default": scopi::TETTO_SFONDI_USD,
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
pub async fn prova_chiave(State(s): State<AppState>, Json(body): Json<ChiaveBody>) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    match scopi::prova_chiave(&s.config_dir, &body.fornitore).await {
        Ok(modelli) => Json(json!({ "ok": true, "modelli": modelli })).into_response(),
        Err(e) => Json(json!({ "ok": false, "errore": e })).into_response(),
    }
}

fn errore(codice: StatusCode, msg: String) -> Response {
    (codice, Json(json!({ "errore": msg }))).into_response()
}
