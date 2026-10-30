//! Il giro quotidiano del gateway sugli account e sul registro delle attività
//! (30-10-2026, ramo C di `docs/plans/2026-10-26-aprire-sws-soligo-net.md`).
//!
//! Tre cose, una volta al giorno, solo sul gateway (`--gateway`):
//!
//! - **l'avviso dei 12 mesi** a chi si è registrato da sé e non entra da allora
//!   (posta d'installazione; senza posta l'avviso non parte, e quindi non parte
//!   nemmeno la cancellazione: nessuno si cancella senza essere stato avvisato);
//! - **le cancellazioni**: inattivi avvisati da 30 giorni, account chiusi da 30
//!   giorni, registrazioni mai confermate. Con l'account se ne vanno l'azienda
//!   personale e la sua cartella di progetti, dopo aver spento i progetti aperti;
//! - **il registro delle attività si tiene 12 mesi**: le voci più vecchie si
//!   tolgono (`AuditLog::pota`).
//!
//! Le regole su *chi* stanno in `sws-identita` (`ciclo_di_vita.rs`); qui si
//! manda la posta, si tolgono le cartelle e si scrive il registro.

use std::path::Path;
use std::time::Duration;

use serde_json::json;
use sws_identita::Motivo;
use tracing::{info, warn};

use crate::router::AppState;

/// Quanto si tiene il registro delle attività (decisione del maintainer del 30-10-2026).
pub const CONSERVAZIONE_REGISTRO: Duration = Duration::from_secs(365 * 24 * 3600);

fn ora_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Il giro, una volta al giorno. Il primo dopo cinque minuti: un riavvio non
/// deve far partire posta prima che il gateway sia in piedi.
pub fn avvia(s: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(300)).await;
        let mut t = tokio::time::interval(Duration::from_secs(24 * 3600));
        loop {
            t.tick().await;
            giro(&s, ora_ms()).await;
        }
    });
}

/// Un giro, col tempo che arriva da fuori.
pub async fn giro(s: &AppState, adesso_ms: u64) {
    match s.audit.pota(adesso_ms.saturating_sub(CONSERVAZIONE_REGISTRO.as_millis() as u64)).await {
        Ok(0) => {}
        Ok(n) => {
            info!("registro delle attività: tolte {n} voci più vecchie di 12 mesi");
            s.audit.log("audit.potatura", None, json!({ "tolte": n }));
        }
        Err(e) => warn!("registro delle attività non potato: {e:#}"),
    }
    let Some(identita) = s.identita.as_ref() else { return };

    if let Some(cfg) = crate::amministrazione::leggi_smtp(s).await {
        match identita.da_avvisare(adesso_ms).await {
            Ok(elenco) => {
                for a in elenco {
                    let (oggetto, corpo) = avviso(&a.email);
                    let dest = vec![a.email.clone()];
                    let cfg = cfg.clone();
                    let esito = tokio::task::spawn_blocking(move || {
                        crate::notifications::invia_una_prova(&cfg, &dest, &oggetto, &corpo)
                    })
                    .await;
                    match esito {
                        Ok(Ok(())) => {
                            if let Err(e) = identita.segna_avvisato(a.id, adesso_ms).await {
                                warn!(utente = a.id, "avviso spedito ma non segnato: {e:#}");
                                continue;
                            }
                            s.audit.log("account.avviso_inattivita", None, json!({ "utente_id": a.id }));
                        }
                        Ok(Err(e)) => warn!(utente = a.id, "avviso d'inattività non partito: {e:#}"),
                        Err(e) => warn!(utente = a.id, "avviso d'inattività non partito: {e}"),
                    }
                }
            }
            Err(e) => warn!("inattivi non letti: {e:#}"),
        }
    }

    let cancellati = match identita.cancella_scaduti(adesso_ms).await {
        Ok(c) => c,
        Err(e) => {
            warn!("cancellazioni non fatte: {e:#}");
            return;
        }
    };
    for c in cancellati {
        if let Some(regia) = s.regia.as_ref() {
            for aperto in regia.elenco().await {
                if c.aziende.contains(&aperto.azienda) || c.cartelle.contains(&aperto.azienda) {
                    if let Err(e) = regia.chiudi(&aperto.riferimento).await {
                        warn!(progetto = %aperto.riferimento, "non spento prima della cancellazione: {e:#}");
                    }
                }
            }
        }
        for cartella in &c.cartelle {
            togli_cartella(&s.projects_root, cartella).await;
        }
        // Nel registro l'id e il motivo, non l'indirizzo: l'account non c'è più.
        let motivo = match c.motivo {
            Motivo::Inattivo => "inattivo",
            Motivo::Chiuso => "chiuso",
            Motivo::NonConfermato => "non_confermato",
        };
        info!(utente = c.id, motivo, "account cancellato");
        s.audit.log("account.cancellato", None, json!({ "utente_id": c.id, "motivo": motivo }));
    }
}

/// `GET /api/identita/account` — l'account di chi chiede si può chiudere da sé?
/// Solo chi si è registrato da sé: gli altri li gestisce l'azienda.
pub async fn stato_account(
    axum::extract::State(s): axum::extract::State<AppState>,
    axum::extract::Extension(user): axum::extract::Extension<crate::router::AuthUser>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let chiudibile = match s.identita.as_ref() {
        Some(id) => id.chiudibile(&user.username).await,
        None => false,
    };
    axum::Json(json!({ "chiudibile": chiudibile })).into_response()
}

#[derive(serde::Deserialize)]
pub struct Chiusura {
    password: String,
}

/// `POST /api/identita/chiudi-account` — chi si è registrato chiude il proprio
/// account con la sua password: fuori da subito, cancellato fra 30 giorni.
pub async fn chiudi_account(
    axum::extract::State(s): axum::extract::State<AppState>,
    axum::extract::Extension(user): axum::extract::Extension<crate::router::AuthUser>,
    axum::Json(b): axum::Json<Chiusura>,
) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    let Some(id) = s.identita.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match id.chiudi_account(&user.username, &b.password, ora_ms()).await {
        Ok(()) => {
            s.audit.log("account.chiuso", Some(user.username.clone()), json!({}));
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (StatusCode::UNPROCESSABLE_ENTITY, axum::Json(json!({ "error": e.to_string() }))).into_response(),
    }
}

/// Toglie la cartella di un'azienda personale, solo se è davvero una cartella
/// sotto la radice dei progetti. Il nome viene dall'archivio, ma un `..` o un
/// percorso assoluto finito lì per qualunque motivo non deve poter cancellare
/// altro.
async fn togli_cartella(radice: &Path, cartella: &str) {
    let semplice = !cartella.is_empty()
        && !cartella.contains(['/', '\\'])
        && cartella != "."
        && cartella != "..";
    if !semplice {
        warn!(cartella, "cartella d'azienda sospetta, non tolta");
        return;
    }
    let dir = radice.join(cartella);
    match tokio::fs::remove_dir_all(&dir).await {
        Ok(()) => info!(dir = %dir.display(), "cartella dei progetti tolta"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => warn!(dir = %dir.display(), "cartella dei progetti non tolta: {e}"),
    }
}

/// L'e-mail dei 12 mesi, in italiano e in inglese insieme: chi la riceve non è
/// entrato da un anno, e la lingua dell'interfaccia non la sappiamo.
fn avviso(email: &str) -> (String, String) {
    (
        "SWS: il tuo account sarà cancellato fra 30 giorni / your account will be deleted in 30 days".to_string(),
        format!(
            "Ciao,\n\nl'account SWS {email} non è stato usato negli ultimi 12 mesi. Se non entri entro 30 \
             giorni, l'account e i suoi progetti saranno cancellati, come dice l'informativa.\n\
             Per tenerlo basta entrare una volta.\n\n\
             Hello,\n\nthe SWS account {email} has not been used in the last 12 months. If you do not sign in \
             within 30 days, the account and its projects will be deleted, as the privacy notice says.\n\
             To keep it, just sign in once.\n"
        ),
    )
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn una_cartella_sospetta_non_si_tocca() {
        let radice = std::env::temp_dir().join(format!("sws-ciclo-acc-{}", ora_ms()));
        let fuori = radice.join("fuori");
        std::fs::create_dir_all(radice.join("progetti/u7")).unwrap();
        std::fs::create_dir_all(&fuori).unwrap();
        let progetti = radice.join("progetti");
        togli_cartella(&progetti, "../fuori").await;
        togli_cartella(&progetti, "").await;
        assert!(fuori.exists());
        togli_cartella(&progetti, "u7").await;
        assert!(!progetti.join("u7").exists());
        assert!(progetti.exists(), "la radice resta");
        let _ = std::fs::remove_dir_all(radice);
    }

    #[tokio::test]
    async fn il_giro_cancella_l_account_chiuso_e_la_sua_cartella() {
        let dir = std::env::temp_dir().join(format!("sws-giro-account-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut s = crate::router::stato_di_prova(&dir).await;
        let id = sws_identita::Identita::apri(dir.join("identita.db")).await.unwrap();
        let sws_identita::Registrato::Codice(codice) = id.registra("mario@tizio.it", "password-lunga").await.unwrap()
        else {
            panic!("registrazione rifiutata")
        };
        let (_, azienda) = id.conferma_registrazione("mario@tizio.it", &codice).await.unwrap();
        let cartella = s.projects_root.join(&azienda.cartella);
        std::fs::create_dir_all(cartella.join("impianto")).unwrap();
        id.chiudi_account("mario@tizio.it", "password-lunga", ora_ms()).await.unwrap();
        s.identita = Some(id);

        giro(&s, ora_ms()).await;
        assert!(cartella.exists(), "non prima dei 30 giorni");
        giro(&s, ora_ms() + 31 * 24 * 3600 * 1000).await;
        assert!(!cartella.exists(), "la cartella dell'azienda personale se ne va con l'account");
        assert!(s.projects_root.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
