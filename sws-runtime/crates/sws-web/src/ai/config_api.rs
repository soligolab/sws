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

use axum::{extract::State, response::{IntoResponse, Response}, Extension, Json};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::json;

use crate::ai::client::{self, Fornitore, Impostazioni};
use crate::router::{AppState, AuthUser, MASKED_PASSWORD};

/// Le rotte esistono solo dove hanno senso. Vedi il commento in testa.
fn solo_ide(s: &AppState) -> Result<(), Response> {
    if s.ide_only {
        Ok(())
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({
            "errore": "la configurazione dell'assistente esiste solo sull'istanza IDE \
                       (quella avviata senza viewer)",
        }))).into_response())
    }
}

/// `GET /api/ai/config` — Admin, solo IDE.
///
/// Non restituisce **niente** della chiave, nemmeno mascherata: al pannello
/// serve sapere *se* è configurata, non com'è fatta.
pub async fn get_ai_config(State(s): State<AppState>) -> Response {
    if let Err(r) = solo_ide(&s) { return r; }

    let imp = Impostazioni::carica(&s.config_dir);
    let scelta = client::carica(&s.config_dir);

    // Quale variabile d'ambiente sta scavalcando il file, se ce n'è una. Serve
    // al pannello per dirlo: senza, si configura dall'IDE, non cambia niente, e
    // sembra un difetto nostro.
    let ambiente: Vec<&str> = ["SWS_AI_FORNITORE", "SWS_AI_MODELLO",
                               "ANTHROPIC_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY"]
        .into_iter()
        .filter(|v| std::env::var(v).map(|x| !x.trim().is_empty()).unwrap_or(false))
        .collect();

    Json(json!({
        "configurato": scelta.is_some(),
        // Il fornitore *effettivo* se c'è una chiave, altrimenti quello scelto.
        "fornitore": scelta.as_ref().map(|x| x.fornitore.nome().to_string())
            .or_else(|| imp.fornitore.clone()),
        "modello": scelta.as_ref().map(|x| x.modello.clone()).or_else(|| imp.modello.clone()),
        // Con quale chiave, per fornitore: permette al pannello di dire «Kimi
        // configurato, Anthropic no» invece di un solo pallino.
        "chiavi": json!({
            "anthropic": client::ha_chiave(&s.config_dir, Fornitore::Anthropic),
            "kimi": client::ha_chiave(&s.config_dir, Fornitore::Kimi),
        }),
        "modelli_default": json!({
            "anthropic": Fornitore::Anthropic.modello_default(),
            "kimi": Fornitore::Kimi.modello_default(),
        }),
        "da_ambiente": ambiente,
        "percorsi": client::percorsi_chiave(&s.config_dir).iter()
            .map(|p| p.display().to_string()).collect::<Vec<_>>(),
    })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiConfigBody {
    pub fornitore: String,
    #[serde(default)]
    pub modello: Option<String>,
    /// La chiave. Assente **o** uguale alla sentinella `********` significa
    /// «tieni quella che c'è» — la stessa convenzione delle password MQTT, SMTP
    /// e del token Telegram (`router.rs`). Senza, un giro GET → cambio del
    /// modello → PUT cancellerebbe la chiave che l'utente non può vedere.
    #[serde(default)]
    pub chiave: Option<String>,
}

/// `PUT /api/ai/config` — Admin, solo IDE.
pub async fn put_ai_config(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<AiConfigBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) { return r; }

    let Some(f) = Fornitore::da_nome(&body.fornitore) else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "errore": format!("fornitore `{}` sconosciuto: sono `anthropic` o `kimi`",
                              body.fornitore),
        }))).into_response();
    };

    // ── La chiave, se ne è arrivata una nuova ────────────────────────────────
    let nuova = body.chiave.as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty() && *k != MASKED_PASSWORD);

    if let Some(k) = nuova {
        // Validazione minima e non «intelligente»: nessun controllo sul prefisso
        // (`sk-ant-`, `sk-`), perché i fornitori li cambiano e un controllo che
        // rifiuta una chiave valida è peggio di nessun controllo. Si rifiuta
        // solo ciò che non può essere una chiave.
        if k.len() < 16 || k.split_whitespace().count() > 1 {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "errore": "la chiave non sembra una chiave: deve essere una sola parola \
                           di almeno 16 caratteri",
            }))).into_response();
        }
        if let Err(e) = client::salva_chiave(&s.config_dir, f, k) {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "errore": format!("la chiave non si è potuta scrivere: {e}"),
            }))).into_response();
        }
        // Solo metadati nel registro, mai la chiave — come `script.exec`, che
        // registra quanti byte di codice e non il codice.
        s.audit.log("ai.key_set", Some(user.username.clone()),
                    json!({ "fornitore": f.nome() }));
    }

    // ── Fornitore e modello ─────────────────────────────────────────────────
    let modello = body.modello.as_deref().map(str::trim).filter(|m| !m.is_empty());
    let imp = Impostazioni {
        fornitore: Some(f.nome().to_string()),
        modello: modello.map(str::to_string),
    };
    if let Err(e) = imp.salva(&s.config_dir) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "errore": format!("le impostazioni non si sono potute scrivere: {e}"),
        }))).into_response();
    }
    s.audit.log("ai.config_changed", Some(user.username),
                json!({ "fornitore": f.nome(), "modello": modello }));

    Json(json!({
        "ok": true,
        "configurato": client::ha_chiave(&s.config_dir, f),
        // Il pannello deve riaprire il socket: la chiave si legge all'apertura
        // della sessione, non a ogni turno.
        "riconnetti": true,
    })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiDeleteBody {
    pub fornitore: String,
}

/// `DELETE /api/ai/config` — Admin, solo IDE. Cancella la chiave di un
/// fornitore; le impostazioni restano, così si può rimettere la chiave senza
/// riscegliere il modello.
pub async fn delete_ai_config(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<AiDeleteBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) { return r; }

    let Some(f) = Fornitore::da_nome(&body.fornitore) else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "errore": format!("fornitore `{}` sconosciuto", body.fornitore),
        }))).into_response();
    };

    match client::cancella_chiave(&s.config_dir, f) {
        Ok(cera) => {
            if cera {
                s.audit.log("ai.key_removed", Some(user.username), json!({ "fornitore": f.nome() }));
            }
            Json(json!({ "ok": true, "cera": cera, "riconnetti": true })).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "errore": format!("la chiave non si è potuta cancellare: {e}"),
        }))).into_response(),
    }
}
