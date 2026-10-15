//! `/.well-known/security.txt` (RFC 9116): dove si segnala una vulnerabilità.
//!
//! 15-10-2026, piano `docs/plans/2026-10-15-piano-prima-fascia-e-cra.md`, onda 1
//! (C1): il CRA chiede un punto di contatto per le vulnerabilità che chiunque
//! trovi, e `security.txt` è il posto dove lo si cerca. Lo serve ogni pannello e
//! ogni IDE, senza credenziali, come `/health`. Le stesse informazioni stanno in
//! `SECURITY.md`.
//!
//! `Expires` è obbligatorio e non deve superare un anno: si calcola a ogni
//! richiesta (sei mesi avanti), così un pannello rimasto senza aggiornamenti
//! non pubblica mai un file scaduto — il contatto resta valido finché vale
//! `SECURITY.md`.

use axum::http::header;
use axum::response::IntoResponse;
use chrono::{DateTime, Duration, SecondsFormat, Utc};

/// Il contenuto, per un dato istante: separato dal gestore per poterlo provare.
pub fn testo(ora: DateTime<Utc>) -> String {
    let scade = (ora + Duration::days(182)).to_rfc3339_opts(SecondsFormat::Secs, true);
    format!(
        "Contact: mailto:security@soligo.net\n\
         Contact: https://github.com/soligolab/sws/security/advisories/new\n\
         Expires: {scade}\n\
         Policy: https://github.com/soligolab/sws/blob/main/SECURITY.md\n\
         Preferred-Languages: it, en\n"
    )
}

pub async fn get_security_txt() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], testo(Utc::now()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn ha_i_campi_obbligatori_e_scade_entro_un_anno() {
        let ora = Utc.with_ymd_and_hms(2026, 10, 15, 12, 0, 0).unwrap();
        let t = testo(ora);
        assert!(t.contains("Contact: mailto:security@soligo.net\n"), "{t}");
        assert!(t.contains("Expires: 2027-04-15T12:00:00Z\n"), "{t}");
        assert!(t.lines().all(|l| l.contains(": ")), "una riga per campo: {t}");
    }
}
