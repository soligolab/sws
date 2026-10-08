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

use crate::router::AuthUser;
use axum::Extension;
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

/// Il confine di chi sta guardando la console.
///
/// `None` = la piattaforma, che non ha confine. `Some(ids)` = le aziende che
/// quella persona amministra, e **solo** quelle: essere sviluppatore di
/// un'azienda non dà nessun titolo ad amministrarla.
///
/// Un posto solo. Il confinamento della 3c è la stessa domanda ripetuta su
/// ogni oggetto che la console mostra — «di quale azienda è questo?» — e la
/// risposta la deve dare una funzione sola, o le risposte divergono. È la
/// lezione di `visibilita()` per i progetti, applicata qui.
/// Lo stesso confine, per chi sta in un altro modulo (`marchi.rs`).
///
/// La funzione resta una sola: esporla e meglio che lasciarne nascere una
/// seconda altrove, che e il modo in cui le due risposte iniziano a divergere.
pub async fn confine_pubblico(s: &AppState, chi: &AuthUser) -> Option<Vec<i64>> {
    confine(s, chi).await
}

async fn confine(s: &AppState, chi: &AuthUser) -> Option<Vec<i64>> {
    if chi.amministratore_piattaforma {
        return None;
    }
    Some(crate::projects::appartenenze_di(s, Some(chi)).await.amministrate)
}

// ── Aziende ──────────────────────────────────────────────────────────────────

async fn elenca_aziende(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let mie = confine(&s, &chi).await;
    match id.elenca_aziende().await {
        Ok(v) => {
            let v: Vec<_> = match &mie {
                None => v,
                Some(ids) => v.into_iter().filter(|a| ids.contains(&a.id)).collect(),
            };
            Json(v).into_response()
        }
        Err(e) => errore(e),
    }
}

#[derive(Deserialize)]
struct NuovaAzienda {
    nome: String,
}

async fn crea_azienda(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Json(req): Json<NuovaAzienda>,
) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match id.crea_azienda(&req.nome).await {
        Ok(a) => {
            info!(azienda = %a.nome, "azienda creata dalla console");
            s.audit.log(
                "amministrazione.azienda_creata",
                Some(chi.username.clone()),
                serde_json::json!({"nome": a.nome, "id": a.id}),
            );
            Json(a).into_response()
        }
        Err(e) => errore(e),
    }
}

async fn modifica_azienda(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Path(azienda_id): Path<i64>,
    Json(m): Json<ModificaAzienda>,
) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    // **Il confine, prima di toccare qualunque cosa.** Un elenco filtrato non
    // e una guardia: chi amministra un'azienda conosce gli id delle altre
    // (gli bastano le sue appartenenze passate) e senza questo potrebbe
    // modificarle. Stessa lezione di `risolvi_progetto` nella 3b.
    //
    // 404 e non 403: che quell'azienda esista non e cosa sua.
    if let Some(mie) = confine(&s, &chi).await {
        if !mie.contains(&azienda_id) {
            return (StatusCode::NOT_FOUND, "nessuna azienda con questo id").into_response();
        }
        // E dentro la **sua** azienda non puo toccare tutto: approvazione,
        // marchio e quote sono della piattaforma — sono cio che l'azienda ha
        // *concordato*, e una parte che rinegozia da sola non e un accordo.
        let riservati = m.stato.is_some()
            || m.marchio.is_some()
            || m.versione_predefinita.is_some()
            || m.max_progetti.is_some()
            || m.max_pannelli.is_some()
            || m.max_byte.is_some();
        if riservati {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": "riservato_alla_piattaforma",
                    "detail": "stato, marchio, versione e quote li decide l'amministratore di piattaforma"
                })),
            )
                .into_response();
        }
    }
    // Lo stato di un'azienda è la cosa che decide se può avere pannelli e VPN
    // (decisione 17): va nel registro, non solo nel log.
    let stato = m.stato.map(|v| v.come_testo());
    match id.aggiorna_azienda(azienda_id, m).await {
        Ok(()) => {
            s.audit.log(
                "amministrazione.azienda_modificata",
                Some(chi.username.clone()),
                serde_json::json!({"id": azienda_id, "stato": stato}),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => errore(e),
    }
}

// ── Persone ──────────────────────────────────────────────────────────────────

/// L'elenco delle persone, **con le loro appartenenze**.
///
/// Le appartenenze viaggiano insieme all'utente e non su una chiamata a parte:
/// la console deve poter mostrare «di quali aziende fa parte» accanto al nome,
/// e senza questo dato l'unica cosa che poteva fare era offrire un menu per
/// aggiungere — senza mai dire a cosa. Il 07-10-2026 il maintainer ha
/// giustamente cercato un pulsante che non c'era: il difetto non era il
/// pulsante, era che la pagina non sapeva cosa mostrare.
async fn elenca_utenti(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let utenti = match id.elenca().await {
        Ok(v) => v,
        Err(e) => return errore(e),
    };
    let mie = confine(&s, &chi).await;
    let aziende = id.elenca_aziende().await.unwrap_or_default();
    let mut fuori = Vec::new();
    for u in utenti {
        let appartenenze = id.aziende_di(u.id).await.unwrap_or_default();
        // Chi amministra un'azienda vede le persone **di quell'azienda**, e
        // di ciascuna solo le appartenenze che lo riguardano: che il tale sia
        // anche di un altro cliente non e cosa sua.
        if let Some(ids) = &mie {
            if !appartenenze.iter().any(|(aid, _)| ids.contains(aid)) {
                continue;
            }
        }
        let appartenenze: Vec<_> = match &mie {
            None => appartenenze,
            Some(ids) => appartenenze
                .into_iter()
                .filter(|(aid, _)| ids.contains(aid))
                .collect(),
        };
        let elenco: Vec<_> = appartenenze
            .iter()
            .filter_map(|(aid, ruolo)| {
                aziende.iter().find(|a| a.id == *aid).map(|a| {
                    serde_json::json!({
                        "id": a.id,
                        "nome": if a.implicita { "—".to_string() } else { a.nome.clone() },
                        "implicita": a.implicita,
                        "ruolo": ruolo.come_testo(),
                    })
                })
            })
            .collect();
        let mut v = serde_json::to_value(&u).unwrap_or_default();
        if let Some(o) = v.as_object_mut() {
            o.insert("aziende".into(), serde_json::Value::Array(elenco));
        }
        fuori.push(v);
    }
    Json(fuori).into_response()
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

async fn crea_utente(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Json(req): Json<NuovoUtente>,
) -> Response {
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
    // Chi amministra un'azienda crea utenti **in liberta** (decisione del
    // maintainer, 08-10-2026: il numero di utenti non e una quota) — ma solo
    // dentro una delle sue. Senza azienda l'utente nascerebbe fuori da
    // qualunque confine, e non sarebbe piu suo da gestire.
    if let Some(mie) = confine(&s, &chi).await {
        match req.azienda_id {
            Some(a) if mie.contains(&a) => {}
            _ => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({
                        "error": "fuori_dalle_tue_aziende",
                        "detail": "un utente nuovo va messo in un'azienda che amministri"
                    })),
                )
                    .into_response()
            }
        }
    }
    match id.crea_utente(&req.email, &req.nome, &req.password, ruolo, true).await {
        Ok(u) => {
            if let Some(a) = req.azienda_id {
                if let Err(e) = id.iscrivi(a, u.id, ruolo).await {
                    return errore(e);
                }
            }
            s.audit.log(
                "amministrazione.utente_creato",
                Some(chi.username.clone()),
                serde_json::json!({"creato": u.email, "ruolo": ruolo.come_testo(), "azienda": req.azienda_id}),
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
    /// Il nome visualizzato. L'email no: e l'identita, ed e la chiave con cui
    /// il registro di audit cita le persone.
    nome: Option<String>,
    /// Il ruolo nell'installazione.
    ruolo: Option<String>,
    /// **Tutte** le appartenenze volute, non una differenza da applicare.
    ///
    /// Il pannello della console salva lo stato che si vede: manda l'elenco
    /// intero e il server lo fa diventare vero in una transazione. Prima
    /// c'erano `azienda_id` + `amministratore` per aggiungerne una e
    /// `togli_da_azienda` per toglierne una, cioe tre campi per una cosa sola
    /// e un'operazione per volta: con un pannello che salva tutto insieme,
    /// un errore a meta avrebbe lasciato l'utente in uno stato che nessuno
    /// aveva chiesto.
    aziende: Option<Vec<Appartenenza>>,
    /// Reset della password dall'amministrazione: chiude le sessioni e
    /// obbliga l'interessato a sceglierne una sua al primo accesso.
    nuova_password: Option<String>,
}

#[derive(Deserialize)]
struct Appartenenza {
    azienda_id: i64,
    #[serde(default)]
    amministratore: bool,
}

async fn modifica_utente(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Path(utente_id): Path<i64>,
    Json(m): Json<ModificaUtente>,
) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    // **Il confine.** Il bersaglio dev'essere una persona di una delle mie
    // aziende, e i poteri della piattaforma restano alla piattaforma.
    let mie = confine(&s, &chi).await;
    if let Some(mie) = &mie {
        let sue = id.aziende_di(utente_id).await.unwrap_or_default();
        if !sue.iter().any(|(aid, _)| mie.contains(aid)) {
            return (StatusCode::NOT_FOUND, "nessun utente con questo id").into_response();
        }
        if m.amministratore_piattaforma.is_some() {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": "riservato_alla_piattaforma",
                    "detail": "l'amministratore di piattaforma lo nomina la piattaforma"
                })),
            )
                .into_response();
        }
    }

    // L'ordine conta. Il nome e il ruolo per primi, perche non possono
    // fallire per causa d'altri; i rifiuti che proteggono l'installazione
    // («e l'ultimo amministratore») vengono dopo, e fermano il salvataggio
    // prima di aver toccato quello che li riguarda.
    let ruolo_nuovo = match m.ruolo.as_deref() {
        None => None,
        Some("amministratore") => Some(Ruolo::Amministratore),
        Some("sviluppatore") => Some(Ruolo::Sviluppatore),
        Some(altro) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": "ruolo", "detail": format!("ruolo sconosciuto «{altro}»")})),
            )
                .into_response()
        }
    };
    if let Err(e) = id.aggiorna_utente(utente_id, m.nome.as_deref(), ruolo_nuovo).await {
        return errore(e);
    }
    match m.attivo {
        Some(false) => {
            if let Err(e) = id.disattiva(utente_id).await {
                return errore(e);
            }
        }
        Some(true) => {
            if let Err(e) = id.riattiva(utente_id).await {
                return errore(e);
            }
        }
        None => {}
    }
    if let Some(ref pw) = m.nuova_password {
        if let Err(e) = id.reimposta_password(utente_id, pw).await {
            return errore(e);
        }
        // Nel registro va CHE è stata reimpostata, mai il valore.
        s.audit.log(
            "amministrazione.password_reimpostata",
            Some(chi.username.clone()),
            serde_json::json!({"id": utente_id}),
        );
    }
    if let Some(v) = m.amministratore_piattaforma {
        if let Err(e) = id.imposta_amministratore_piattaforma(utente_id, v).await {
            // È qui che scatta il rifiuto «è l'ultimo»: va riportato parola per
            // parola, perché spiega da solo cosa fare.
            return errore(e);
        }
    }
    if let Some(volute) = m.aziende {
        let mut volute: Vec<(i64, Ruolo)> = volute
            .into_iter()
            .map(|a| {
                (
                    a.azienda_id,
                    if a.amministratore { Ruolo::Amministratore } else { Ruolo::Sviluppatore },
                )
            })
            .collect();
        if let Some(mie) = &mie {
            // `imposta_appartenenze` sostituisce l'elenco INTERO. Chi
            // amministra un'azienda ne vede solo una fetta, e salvando
            // cancellerebbe le appartenenze che non vede — quelle di un altro
            // cliente, che non sono cosa sua ne' da vedere ne' da togliere.
            // Quindi: si tiene cio che sta fuori dal suo confine e si
            // sostituisce solo cio che ci sta dentro.
            if volute.iter().any(|(aid, _)| !mie.contains(aid)) {
                return (
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({
                        "error": "fuori_dalle_tue_aziende",
                        "detail": "puoi cambiare solo le appartenenze alle aziende che amministri"
                    })),
                )
                    .into_response();
            }
            let fuori: Vec<(i64, Ruolo)> = id
                .aziende_di(utente_id)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|(aid, _)| !mie.contains(aid))
                .collect();
            volute.extend(fuori);
        }
        if let Err(e) = id.imposta_appartenenze(utente_id, volute).await {
            return errore(e);
        }
    }
    s.audit.log(
        "amministrazione.utente_modificato",
        Some(chi.username.clone()),
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
    Extension(chi): Extension<AuthUser>,
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
        Some(chi.username.clone()),
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
async fn prova_posta(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Json(req): Json<Prova>,
) -> Response {
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
                Some(chi.username.clone()),
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
/// Le rotte aperte anche a chi amministra **un'azienda**, non la piattaforma.
///
/// Ognuna confina da sé ciò che restituisce: `elenca_aziende` dà le aziende
/// che chi guarda amministra, `elenca_utenti` le persone di quelle aziende.
/// Il confinamento sta **nell'handler** e non in un filtro attorno, perché
/// quello che va filtrato è il contenuto della risposta, non il diritto di
/// fare la chiamata.
pub fn rotte_di_azienda() -> Router<AppState> {
    Router::new()
        .route("/api/amministrazione/risorse", get(risorse))
        .route("/api/amministrazione/aziende", get(elenca_aziende))
        .route("/api/amministrazione/aziende/:id", patch(modifica_azienda))
        .route(
            "/api/amministrazione/utenti",
            get(elenca_utenti).post(crea_utente),
        )
        .route("/api/amministrazione/utenti/:id", patch(modifica_utente))
        // I marchi si **leggono** per mostrarli; sceglierli è della
        // piattaforma (decisione del maintainer, 08-10-2026: un marchio è
        // anche il nome di qualcun altro).
        .route("/api/amministrazione/marchi", get(crate::marchi::elenca))
}

/// Le rotte che restano alla sola piattaforma.
///
/// Non sono di nessuna azienda: la posta è dell'installazione, i marchi sono
/// un catalogo comune, e creare un'azienda è l'atto con cui la piattaforma
/// accetta un cliente nuovo.
pub fn rotte_di_piattaforma() -> Router<AppState> {
    Router::new()
        .route("/api/amministrazione/aziende", axum::routing::post(crea_azienda))
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
            "/api/amministrazione/marchi/:id",
            axum::routing::put(crate::marchi::salva).delete(crate::marchi::elimina),
        )
        .route(
            "/api/amministrazione/marchi/:id/file/:nome",
            axum::routing::put(crate::marchi::carica_file),
        )
}

// ── Le risorse ───────────────────────────────────────────────────────────────
//
// La prima pagina della console (decisione del maintainer, 08-10-2026): «un
// sinottico dove poter visualizzare in un colpo d'occhio unico tutte le
// risorse disponibili e quante sono al limite».
//
// Due risorse hanno un tetto concordato — lo **spazio** e i **progetti
// aperti** — e una terza, lo stato della macchina, non è di nessuna azienda
// ma dice se il limite vero sta arrivando per tutti.
//
// **Lo spazio si spacca in progetti e storico.** Chi arriva al limite ci
// arriva quasi sempre per lo storico, che cresce da solo nel tempo mentre i
// sinottici no: dire «sei pieno» senza dire di cosa non aiuta a decidere cosa
// cancellare.

/// Per quanto vale una misura prima di rifarla.
///
/// Sommare le dimensioni di un albero di cartelle costa, e il sinottico si
/// apre spesso: si misura una volta al minuto e si serve l'ultimo valore. Il
/// momento della misura viaggia nella risposta — **un dato vecchio che si
/// dichiara vecchio è utile, uno che finge di essere fresco no**.
const VALIDITA_MISURA_MS: u64 = 60_000;

static MISURA: std::sync::OnceLock<tokio::sync::Mutex<Option<(u64, serde_json::Value)>>> =
    std::sync::OnceLock::new();

/// Lo spazio di una cartella, diviso fra storico e tutto il resto.
///
/// Ricorsiva e sincrona: gira in `spawn_blocking`, perché su un disco lento e
/// con molti progetti non deve tenere occupato l'esecutore asincrono.
fn pesa(dir: &std::path::Path) -> (u64, u64) {
    let (mut progetti, mut storico) = (0u64, 0u64);
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    for e in rd.flatten() {
        let Ok(tipo) = e.file_type() else { continue };
        if tipo.is_dir() {
            // `history/` è lo storico, ovunque si trovi nell'albero: è il
            // nome che il runtime usa per i suoi database.
            let (p, s) = pesa(&e.path());
            if e.file_name() == "history" {
                storico += p + s;
            } else {
                progetti += p;
                storico += s;
            }
        } else if let Ok(m) = e.metadata() {
            progetti += m.len();
        }
    }
    (progetti, storico)
}

async fn risorse(State(s): State<AppState>, Extension(chi): Extension<AuthUser>) -> Response {
    let id = match identita(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let mie = confine(&s, &chi).await;

    let cella = MISURA.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut cache = cella.lock().await;
    let adesso = sws_core::now_ms();
    let fresca = cache
        .as_ref()
        .is_some_and(|(quando, _)| adesso.saturating_sub(*quando) < VALIDITA_MISURA_MS);

    if !fresca {
        let aziende = id.elenca_aziende().await.unwrap_or_default();
        let radice = s.projects_root.as_ref().clone();
        let misurato = tokio::task::spawn_blocking(move || {
            let mut righe = Vec::new();
            for a in &aziende {
                // L'azienda implicita è la radice stessa: si pesano i suoi
                // progetti, non le sottocartelle delle altre aziende.
                let (progetti, storico) = if a.cartella.is_empty() {
                    let mut p = 0u64;
                    let mut st = 0u64;
                    if let Ok(rd) = std::fs::read_dir(&radice) {
                        for e in rd.flatten() {
                            if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                continue;
                            }
                            // Una sottocartella che è di un'altra azienda non
                            // è della radice: si salta, o verrebbe contata due
                            // volte.
                            let nome = e.file_name().to_string_lossy().to_string();
                            if aziende.iter().any(|x| !x.cartella.is_empty() && x.cartella == nome) {
                                continue;
                            }
                            let (pp, ss) = pesa(&e.path());
                            p += pp;
                            st += ss;
                        }
                    }
                    (p, st)
                } else {
                    pesa(&radice.join(&a.cartella))
                };
                righe.push(serde_json::json!({
                    "id": a.id,
                    "nome": a.nome,
                    "implicita": a.implicita,
                    "progetti_byte": progetti,
                    "storico_byte": storico,
                    "max_byte": a.max_byte,
                    "max_progetti_aperti": a.max_progetti,
                }));
            }
            righe
        })
        .await
        .unwrap_or_default();

        let mut sys = sysinfo::System::new_all();
        sys.refresh_all();
        let dischi = sysinfo::Disks::new_with_refreshed_list();
        let disco = dischi.list().first();
        let macchina = serde_json::json!({
            "disco_totale_byte": disco.map(|d| d.total_space()).unwrap_or(0),
            "disco_libero_byte": disco.map(|d| d.available_space()).unwrap_or(0),
            "ram_totale_byte": sys.total_memory(),
            "ram_usata_byte": sys.used_memory(),
            "cpu_percento": sys.global_cpu_info().cpu_usage(),
        });
        *cache = Some((adesso, serde_json::json!({"aziende": misurato, "macchina": macchina})));
    }

    let (quando, dati) = cache.clone().unwrap_or((adesso, serde_json::json!({})));
    drop(cache);

    let mut aziende = dati
        .get("aziende")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if let Some(ids) = &mie {
        aziende.retain(|a| a.get("id").and_then(|x| x.as_i64()).is_some_and(|x| ids.contains(&x)));
    }

    // Quanti progetti sono aperti **adesso**: su un'istanza sola, al più uno.
    // Il tetto si configura e si mostra, applicarlo tocca al gateway (Fase 4):
    // lo dice la risposta, e la console lo scrive accanto al numero — un campo
    // inerte va bene, un campo inerte che finge di funzionare no.
    let aperto_qui = s.project_dir.read().await.is_some();

    Json(serde_json::json!({
        "aziende": aziende,
        // Lo stato della macchina non è di nessuna azienda: lo vede solo chi
        // amministra la piattaforma.
        "macchina": if mie.is_none() { dati.get("macchina").cloned() } else { None },
        "misurato_ms": quando,
        "validita_ms": VALIDITA_MISURA_MS,
        "progetti_aperti_ora": if aperto_qui { 1 } else { 0 },
        "progetti_aperti_si_applicano": false,
    }))
    .into_response()
}
