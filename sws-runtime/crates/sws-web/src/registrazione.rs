//! Le quattro rotte pre-auth della registrazione e del PIN (30-10-2026, ramo C
//! di `docs/plans/2026-10-26-aprire-sws-soligo-net.md`).
//!
//! La meccanica dei codici sta in `sws-identita` (`registrazione.rs`): qui si
//! decide **se** la porta è aperta, si scrive l'e-mail e si risponde.
//!
//! **Due regole valgono per tutte e quattro:**
//!
//! - **la risposta non dice mai chi è iscritto.** «Mandami un PIN» e «registrami»
//!   rispondono uguale per un indirizzo nuovo, uno iscritto e uno inesistente; e
//!   l'e-mail parte **dopo** la risposta, così nemmeno il tempo lo dice;
//! - **la posta è sempre quella dell'installazione.** Quando arriva la richiesta
//!   si conosce solo l'indirizzo, e cercare a quale azienda appartiene prima di
//!   far entrare qualcuno direbbe a chi prova indirizzi a caso dove sono iscritti.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use sws_identita::{Registrato, Rifiuto};
use tracing::warn;

use crate::router::AppState;

/// La registrazione è aperta: gateway acceso con `--gateway-registrazione`, un
/// archivio delle identità, e una posta con cui mandare il codice.
pub(crate) async fn registrazione_aperta(s: &AppState) -> bool {
    s.identita.is_some()
        && s.regia.as_ref().is_some_and(|r| r.registrazione_aperta())
        && crate::amministrazione::leggi_smtp(s).await.is_some()
}

/// Il PIN si può chiedere dove c'è un archivio delle identità e una posta.
pub(crate) async fn pin_disponibile(s: &AppState) -> bool {
    s.identita.is_some() && crate::amministrazione::leggi_smtp(s).await.is_some()
}

fn inglese(lingua: &str) -> bool {
    lingua.starts_with("en")
}

/// Manda un'e-mail **dopo** aver risposto: chi chiede non deve poter misurare
/// se è partita. Un errore finisce nel log, non nella risposta.
fn spedisci(s: &AppState, a: String, oggetto: String, corpo: String) {
    let s = s.clone();
    tokio::spawn(async move {
        let Some(cfg) = crate::amministrazione::leggi_smtp(&s).await else { return };
        let dest = vec![a.clone()];
        let esito = tokio::task::spawn_blocking(move || {
            crate::notifications::invia_una_prova(&cfg, &dest, &oggetto, &corpo)
        })
        .await;
        match esito {
            Ok(Ok(())) => {}
            Ok(Err(e)) => warn!(a = %a, "posta della registrazione non partita: {e:#}"),
            Err(e) => warn!(a = %a, "posta della registrazione non partita: {e}"),
        }
    });
}

fn bloccato(riprova_fra: std::time::Duration) -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(axum::http::header::RETRY_AFTER, riprova_fra.as_secs().to_string())],
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct Registrazione {
    email: String,
    password: String,
    /// Le condizioni d'uso e l'informativa.
    #[serde(default)]
    condizioni: bool,
    /// L'approvazione specifica delle clausole (artt. 1341-1342 c.c.): una
    /// casella a parte, come vuole `docs/legale/LEGGIMI.md`.
    #[serde(default)]
    clausole: bool,
    #[serde(default)]
    lingua: String,
}

/// `POST /api/identita/registrazione` — 202 in ogni caso in cui la richiesta è
/// ben fatta, iscritto o no.
pub async fn registra(State(s): State<AppState>, Json(r): Json<Registrazione>) -> Response {
    if !registrazione_aperta(&s).await {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !r.condizioni || !r.clausole {
        return (StatusCode::BAD_REQUEST, "servono tutte e due le accettazioni").into_response();
    }
    let Some(id) = s.identita.as_ref() else { return StatusCode::NOT_FOUND.into_response() };
    let en = inglese(&r.lingua);
    match id.registra(&r.email, &r.password).await {
        Ok(Registrato::Codice(codice)) => {
            s.audit.log("auth.registrazione", Some(r.email.trim().to_string()), serde_json::json!({}));
            let (oggetto, corpo) = if en {
                (
                    format!("SWS — your confirmation code {codice}"),
                    format!(
                        "Welcome to SWS.\n\nYour confirmation code is:\n\n    {codice}\n\n\
                         It is valid for 10 minutes. If you did not sign up, ignore this message: \
                         without the code no account is created."
                    ),
                )
            } else {
                (
                    format!("SWS — il tuo codice di conferma {codice}"),
                    format!(
                        "Benvenuto in SWS.\n\nIl tuo codice di conferma è:\n\n    {codice}\n\n\
                         Vale 10 minuti. Se non ti sei registrato tu, ignora questo messaggio: \
                         senza il codice nessun account viene attivato."
                    ),
                )
            };
            spedisci(&s, r.email.trim().to_string(), oggetto, corpo);
        }
        Ok(Registrato::GiaIscritto) => {
            let (oggetto, corpo) = if en {
                (
                    "SWS — you already have an account".to_string(),
                    "Someone tried to sign up to SWS with this address, which already has an \
                     account. If it was you, just sign in — with your password or with a PIN by \
                     e-mail. If it was not you, no action is needed."
                        .to_string(),
                )
            } else {
                (
                    "SWS — hai già un account".to_string(),
                    "Qualcuno ha provato a registrarsi a SWS con questo indirizzo, che ha già un \
                     account. Se eri tu, accedi pure — con la password o con un PIN per e-mail. \
                     Se non eri tu, non serve fare niente."
                        .to_string(),
                )
            };
            spedisci(&s, r.email.trim().to_string(), oggetto, corpo);
        }
        Ok(Registrato::TroppoPresto) => {}
        // Indirizzo o password non validi: questo si può dire, non rivela niente.
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
    StatusCode::ACCEPTED.into_response()
}

#[derive(Deserialize)]
pub struct Conferma {
    email: String,
    codice: String,
}

/// `POST /api/identita/registrazione/conferma` — il codice giusto attiva
/// l'account, crea l'azienda personale e fa entrare.
pub async fn conferma(State(s): State<AppState>, Json(r): Json<Conferma>) -> Response {
    if !registrazione_aperta(&s).await {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(id) = s.identita.as_ref() else { return StatusCode::NOT_FOUND.into_response() };
    match id.conferma_registrazione(&r.email, &r.codice).await {
        Ok((accesso, azienda)) => {
            s.audit.log(
                "auth.registrazione_confermata",
                Some(accesso.utente.email.clone()),
                serde_json::json!({"azienda": azienda.cartella}),
            );
            crate::router::entra(&s, accesso, "registrazione", false).await
        }
        Err(Rifiuto::Bloccato { riprova_fra }) => bloccato(riprova_fra),
        Err(_) => StatusCode::UNAUTHORIZED.into_response(),
    }
}

#[derive(Deserialize)]
pub struct ChiediPin {
    email: String,
    #[serde(default)]
    lingua: String,
}

/// `POST /api/auth/pin` — «mandami un PIN». **Sempre 204**, esista o no
/// l'indirizzo.
pub async fn chiedi_pin(State(s): State<AppState>, Json(r): Json<ChiediPin>) -> Response {
    if !pin_disponibile(&s).await {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(id) = s.identita.as_ref() else { return StatusCode::NOT_FOUND.into_response() };
    if let Some(pin) = id.chiedi_pin(&r.email).await {
        let (oggetto, corpo) = if inglese(&r.lingua) {
            (
                format!("SWS — your sign-in PIN {pin}"),
                format!(
                    "Your PIN to sign in to SWS is:\n\n    {pin}\n\nIt is valid for 10 minutes and \
                     can be used once. If you did not ask for it, ignore this message: your \
                     password has not changed."
                ),
            )
        } else {
            (
                format!("SWS — il tuo PIN di accesso {pin}"),
                format!(
                    "Il PIN per accedere a SWS è:\n\n    {pin}\n\nVale 10 minuti e si usa una \
                     volta sola. Se non l'hai chiesto tu, ignora questo messaggio: la tua \
                     password non è cambiata."
                ),
            )
        };
        spedisci(&s, r.email.trim().to_string(), oggetto, corpo);
    }
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
pub struct AccessoPin {
    email: String,
    pin: String,
    #[serde(default)]
    ricordami: bool,
    /// Dal modale «Sessione scaduta»: vedi `router::entra`.
    #[serde(default)]
    riautentica: bool,
}

/// `POST /api/auth/pin/accesso` — entra con il PIN.
pub async fn accedi_con_pin(State(s): State<AppState>, Json(r): Json<AccessoPin>) -> Response {
    if !pin_disponibile(&s).await {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(id) = s.identita.as_ref() else { return StatusCode::NOT_FOUND.into_response() };
    let durata = r.ricordami.then_some(sws_identita::DURATA_RICORDAMI);
    match id.accedi_con_pin(&r.email, &r.pin, durata).await {
        Ok(a) => crate::router::entra(&s, a, "pin", r.riautentica).await,
        Err(Rifiuto::Bloccato { riprova_fra }) => bloccato(riprova_fra),
        Err(motivo) => {
            s.audit.log(
                "auth.login_failed",
                Some(r.email.trim().to_string()),
                serde_json::json!({"fonte": "installazione", "via": "pin", "motivo": motivo.to_string()}),
            );
            StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

/// Le condizioni d'uso e l'informativa, come stanno in `docs/legale/`.
/// Compilate dentro il binario: viaggiano con la versione che le applica.
const CONDIZIONI: &str = include_str!("../../../../docs/legale/condizioni-d-uso.md");
const PRIVACY: &str = include_str!("../../../../docs/legale/informativa-privacy.md");

/// `GET /condizioni` e `GET /privacy` — pubbliche, perché chi si registra le
/// deve poter leggere prima di avere un account. **Esistono solo a
/// registrazione aperta**: finché le bozze non sono riviste
/// (`docs/legale/LEGGIMI.md`) nessun gateway le mostra. In testo semplice per
/// ora; la pagina impaginata arriva col testo definitivo.
pub async fn condizioni(State(s): State<AppState>) -> Response {
    testo_legale(&s, CONDIZIONI).await
}

pub async fn privacy(State(s): State<AppState>) -> Response {
    testo_legale(&s, PRIVACY).await
}

async fn testo_legale(s: &AppState, testo: &'static str) -> Response {
    if !registrazione_aperta(s).await {
        return StatusCode::NOT_FOUND.into_response();
    }
    ([(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")], testo).into_response()
}

#[cfg(test)]
mod test {
    use super::*;
    use axum::body::to_bytes;

    async fn stato(nome: &str, con_posta: bool) -> (AppState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("sws-prova-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut s = crate::router::stato_di_prova(&dir).await;
        let id = sws_identita::Identita::apri(dir.join("identita.db")).await.unwrap();
        id.crea_utente("admin@sws.it", "Admin", "password-lunga", sws_identita::Ruolo::Amministratore, false)
            .await
            .unwrap();
        s.identita = Some(id);
        if con_posta {
            // Un server che non risponde: la posta parte dopo la risposta, e
            // il suo fallimento finisce nel log, non qui.
            std::fs::write(s.config_dir.join("smtp.yaml"), "host: 127.0.0.1\nport: 9\nfrom: sws@prova.it\n").unwrap();
        }
        (s, dir)
    }

    #[tokio::test]
    async fn senza_gateway_la_registrazione_non_esiste() {
        let (s, dir) = stato("registrazione-chiusa", true).await;
        let r = registra(
            State(s.clone()),
            Json(Registrazione {
                email: "nuovo@sws.it".into(),
                password: "password-lunga".into(),
                condizioni: true,
                clausole: true,
                lingua: "it".into(),
            }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        let r = conferma(State(s), Json(Conferma { email: "nuovo@sws.it".into(), codice: "AAAA-AAAA".into() })).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn il_pin_risponde_uguale_per_tutti_e_vuole_la_posta() {
        let (s, dir) = stato("pin-senza-posta", false).await;
        let r = chiedi_pin(State(s), Json(ChiediPin { email: "admin@sws.it".into(), lingua: "it".into() })).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND, "senza posta il PIN non c'e");
        let _ = std::fs::remove_dir_all(&dir);

        let (s, dir) = stato("pin-con-posta", true).await;
        for email in ["admin@sws.it", "nessuno@sws.it", "non-un-indirizzo"] {
            let r = chiedi_pin(State(s.clone()), Json(ChiediPin { email: email.into(), lingua: "en".into() })).await;
            assert_eq!(r.status(), StatusCode::NO_CONTENT, "{email}: la risposta non dice chi e iscritto");
            assert!(to_bytes(r.into_body(), 1024).await.unwrap().is_empty());
        }
        let r = accedi_con_pin(
            State(s),
            Json(AccessoPin { email: "admin@sws.it".into(), pin: "AAAA-AAAA".into(), ricordami: false, riautentica: false }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
