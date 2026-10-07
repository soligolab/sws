//! Le API della **console di amministrazione**: aziende, persone, posta.
//!
//! # Perché è un modulo a sé, e non un pezzo del router
//!
//! La console governa la piattaforma, non il progetto aperto. In particolare —
//! decisione 44 del 06-10-2026 — è da qui che si deciderà su quale versione
//! gira ogni azienda, e **lo strumento che governa le versioni non può essere
//! fissato a una di esse**: la console appartiene al gateway (Fase 4), non
//! all'IDE. Tenerla in un modulo suo, con un prefisso suo
//! (`/api/amministrazione/*`) e una guardia sua, è ciò che le permetterà di
//! traslocare senza essere riscritta.
//!
//! # La guardia
//!
//! Ogni rotta qui dentro passa da `require_auth` **più**
//! `require_amministratore_piattaforma`. Non è una disciplina da ricordare:
//! `scripts/check_amministrazione.sh` verifica che ogni rotta dichiarata in
//! questo file sia dentro quel gruppo, e fallisce se una ne esce.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use sws_identita::{Identita, ModificaAzienda, Ruolo};
use tracing::info;

use crate::router::AppState;

/// L'archivio delle identità, o 503 con un motivo leggibile.
///
/// Su un dispositivo non c'è: lì gli utenti sono quelli del progetto. Un 503
/// con una frase è meglio di un 500 muto, perché dice *perché* e non solo che
/// è andata male.
fn identita(s: &AppState) -> Result<&Identita, Response> {
    s.identita.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "questa istanza non ha un archivio delle identità: gli utenti sono quelli del progetto",
        )
            .into_response()
    })
}

fn errore(e: impl std::fmt::Display) -> Response {
    (StatusCode::BAD_REQUEST, e.to_string()).into_response()
}

// ── Aziende ──────────────────────────────────────────────────────────────────

async fn elenca_aziende(State(s): State<AppState>) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match id.elenca_aziende().await {
        Ok(v) => Json(v).into_response(),
        Err(e) => errore(e),
    }
}

#[derive(Deserialize)]
struct NuovaAzienda {
    nome: String,
}

async fn crea_azienda(State(s): State<AppState>, Json(req): Json<NuovaAzienda>) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match id.crea_azienda(&req.nome).await {
        Ok(a) => {
            info!(azienda = %a.nome, "azienda creata dalla console");
            s.audit.log(
                "amministrazione.azienda_creata",
                None,
                serde_json::json!({"nome": a.nome, "id": a.id}),
            );
            Json(a).into_response()
        }
        Err(e) => errore(e),
    }
}

async fn modifica_azienda(
    State(s): State<AppState>,
    Path(azienda_id): Path<i64>,
    Json(m): Json<ModificaAzienda>,
) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    // Lo stato di un'azienda è la cosa che decide se può avere pannelli e VPN
    // (decisione 17): va nel registro, non solo nel log.
    let stato = m.stato.map(|v| v.come_testo());
    match id.aggiorna_azienda(azienda_id, m).await {
        Ok(()) => {
            s.audit.log(
                "amministrazione.azienda_modificata",
                None,
                serde_json::json!({"id": azienda_id, "stato": stato}),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => errore(e),
    }
}

// ── Persone ──────────────────────────────────────────────────────────────────

async fn elenca_utenti(State(s): State<AppState>) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match id.elenca().await {
        Ok(v) => Json(v).into_response(),
        Err(e) => errore(e),
    }
}

#[derive(Deserialize)]
struct NuovoUtente {
    email: String,
    #[serde(default)]
    nome: String,
    password: String,
    #[serde(default)]
    amministratore: bool,
    /// Se indicata, l'utente nasce già dentro quell'azienda.
    azienda_id: Option<i64>,
}

async fn crea_utente(State(s): State<AppState>, Json(req): Json<NuovoUtente>) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let ruolo = if req.amministratore {
        Ruolo::Amministratore
    } else {
        Ruolo::Sviluppatore
    };
    // `deve_cambiare_password: true` sempre: la password l'ha scelta chi crea
    // l'account, non chi lo userà, e finché non la cambia la conoscono in due.
    match id.crea_utente(&req.email, &req.nome, &req.password, ruolo, true).await {
        Ok(u) => {
            if let Some(a) = req.azienda_id {
                if let Err(e) = id.iscrivi(a, u.id, ruolo).await {
                    return errore(e);
                }
            }
            s.audit.log(
                "amministrazione.utente_creato",
                Some(u.email.clone()),
                serde_json::json!({"ruolo": ruolo.come_testo(), "azienda": req.azienda_id}),
            );
            Json(u).into_response()
        }
        Err(e) => errore(e),
    }
}

#[derive(Deserialize)]
struct ModificaUtente {
    /// Disattivazione. Non esiste la cancellazione: un id che sparisce rende
    /// illeggibile il registro di audit, che cita gli utenti per nome.
    attivo: Option<bool>,
    amministratore_piattaforma: Option<bool>,
    /// Iscrizione a un'azienda, con il ruolo.
    azienda_id: Option<i64>,
    amministratore: Option<bool>,
}

async fn modifica_utente(
    State(s): State<AppState>,
    Path(utente_id): Path<i64>,
    Json(m): Json<ModificaUtente>,
) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    if m.attivo == Some(false) {
        if let Err(e) = id.disattiva(utente_id).await {
            return errore(e);
        }
    }
    if let Some(v) = m.amministratore_piattaforma {
        if let Err(e) = id.imposta_amministratore_piattaforma(utente_id, v).await {
            // È qui che scatta il rifiuto «è l'ultimo»: va riportato parola per
            // parola, perché spiega da solo cosa fare.
            return errore(e);
        }
    }
    if let Some(a) = m.azienda_id {
        let ruolo = if m.amministratore.unwrap_or(false) {
            Ruolo::Amministratore
        } else {
            Ruolo::Sviluppatore
        };
        if let Err(e) = id.iscrivi(a, utente_id, ruolo).await {
            return errore(e);
        }
    }
    s.audit.log(
        "amministrazione.utente_modificato",
        None,
        serde_json::json!({"id": utente_id, "attivo": m.attivo}),
    );
    StatusCode::NO_CONTENT.into_response()
}

// ── Posta ────────────────────────────────────────────────────────────────────
//
// La configurazione SMTP **dell'installazione**, distinta da quella del
// progetto. Serve a mandare le email che riguardano la piattaforma e non
// l'impianto: verifica dell'indirizzo alla registrazione, inviti, recupero
// password (Fase 5).
//
// Vive in `<config_dir>/smtp.yaml` con permessi 0600 — fuori dal progetto,
// quindi fuori da backup, export e deploy, perché non ha niente a che fare
// con l'impianto e non deve viaggiare con lui.

/// Il segnaposto della password. Stesso di `router.rs`: un secondo valore
/// «mascherato» sarebbe un secondo posto da ricordare.
const MASCHERA: &str = "********";

fn percorso_smtp(s: &AppState) -> std::path::PathBuf {
    s.config_dir.join("smtp.yaml")
}

async fn leggi_smtp(s: &AppState) -> Option<sws_core::SmtpConfig> {
    let testo = tokio::fs::read_to_string(percorso_smtp(s)).await.ok()?;
    serde_yaml::from_str(&testo).ok()
}

/// `GET /api/amministrazione/smtp` — la configurazione, **senza la password**.
///
/// Un campo vuoto resta vuoto: mascherare il nulla direbbe al browser che una
/// password c'è quando non c'è, e al primo salvataggio il segnaposto tornerebbe
/// indietro come valore vero. È la stessa regola di `segreti.rs`.
async fn leggi_posta(State(s): State<AppState>) -> Response {
    match leggi_smtp(&s).await {
        Some(mut c) => {
            if c.password.as_deref().is_some_and(|p| !p.is_empty()) {
                c.password = Some(MASCHERA.to_string());
            }
            Json(serde_json::json!({"configurata": true, "smtp": c})).into_response()
        }
        None => Json(serde_json::json!({"configurata": false})).into_response(),
    }
}

/// `PUT /api/amministrazione/smtp` — scrive la configurazione.
///
/// Se la password arriva uguale al segnaposto si **tiene quella di prima**:
/// chi modifica l'indirizzo del server non deve essere costretto a ridigitare
/// una password che non ha mai visto.
async fn scrivi_posta(
    State(s): State<AppState>,
    Json(mut nuova): Json<sws_core::SmtpConfig>,
) -> Response {
    if nuova.password.as_deref() == Some(MASCHERA) {
        nuova.password = leggi_smtp(&s).await.and_then(|v| v.password);
    }
    let testo = match serde_yaml::to_string(&nuova) {
        Ok(t) => t,
        Err(e) => return errore(e),
    };
    let p = percorso_smtp(&s);
    if let Err(e) = tokio::fs::write(&p, testo).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    info!(host = %nuova.host, "configurazione della posta salvata");
    // Nel registro va CHE è cambiata, non cosa: il contenuto è un segreto.
    s.audit.log(
        "amministrazione.smtp_salvata",
        None,
        serde_json::json!({"host": nuova.host}),
    );
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
struct Prova {
    a: String,
}

/// `POST /api/amministrazione/smtp/prova` — manda un'email di prova.
///
/// Senza, una configurazione sbagliata si scopre il giorno in cui qualcuno si
/// registra e non riceve niente — cioè quando il guasto è invisibile e la
/// colpa sembra della registrazione.
async fn prova_posta(State(s): State<AppState>, Json(req): Json<Prova>) -> Response {
    let Some(cfg) = leggi_smtp(&s).await else {
        return (StatusCode::PRECONDITION_FAILED, "la posta non è configurata").into_response();
    };
    let destinatari = vec![req.a.clone()];
    let esito = tokio::task::spawn_blocking(move || {
        crate::notifications::invia_una_prova(
            &cfg,
            &destinatari,
            "SWS — prova di invio",
            "Se leggi questo messaggio, la configurazione della posta di SWS funziona.",
        )
    })
    .await;
    match esito {
        Ok(Ok(())) => {
            s.audit.log(
                "amministrazione.smtp_prova",
                None,
                serde_json::json!({"a": req.a, "esito": "ok"}),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(Err(e)) => {
            // L'errore di lettre va riportato per intero: dice quasi sempre
            // cosa non va (porta chiusa, credenziali, TLS), e riassumerlo
            // significherebbe buttare via l'unica informazione utile.
            (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── Il router ────────────────────────────────────────────────────────────────

/// Tutte le rotte della console, **senza** il livello di autenticazione: lo
/// applica `router.rs`, insieme a `require_auth`, così il «chi può» sta in un
/// posto solo.
pub fn rotte() -> Router<AppState> {
    Router::new()
        .route(
            "/api/amministrazione/aziende",
            get(elenca_aziende).post(crea_azienda),
        )
        .route("/api/amministrazione/aziende/:id", patch(modifica_azienda))
        .route(
            "/api/amministrazione/utenti",
            get(elenca_utenti).post(crea_utente),
        )
        .route("/api/amministrazione/utenti/:id", patch(modifica_utente))
        .route(
            "/api/amministrazione/smtp",
            get(leggi_posta).put(scrivi_posta),
        )
        .route(
            "/api/amministrazione/smtp/prova",
            axum::routing::post(prova_posta),
        )
        // I marchi hanno un modulo loro (`marchi.rs`): sono file, non righe
        // di database, e portano con sé la questione di come servirli senza
        // che un SVG caricato da terzi possa eseguire script.
        .route(
            "/api/amministrazione/marchi",
            get(crate::marchi::elenca),
        )
        .route(
            "/api/amministrazione/marchi/:id",
            axum::routing::put(crate::marchi::salva).delete(crate::marchi::elimina),
        )
        .route(
            "/api/amministrazione/marchi/:id/file/:nome",
            axum::routing::put(crate::marchi::carica_file),
        )
}
