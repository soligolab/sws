//! Che cosa il browser può tenersi, e per quanto.
//!
//! PERCHÉ ESISTE
//!
//! Il 09-10-2026 il maintainer ha detto «credo tu debba rilanciare l'IDE»
//! davanti a una modifica che non vedeva. Il processo era aggiornato, il
//! binario e la `dist` più vecchi di lui: non c'era niente da rilanciare.
//! Guardando le intestazioni è saltato fuori il motivo vero:
//!
//! ```text
//! GET /index-admin.html
//!   HTTP/1.1 200 OK
//!   last-modified: ...        ← e nient'altro
//! ```
//!
//! **Nessun `Cache-Control`.** Senza, il browser applica la propria euristica
//! e può tenersi la pagina d'ingresso. E quella pagina non è un file come un
//! altro: contiene i **nomi dei bundle con l'hash**, quindi tenersi lei
//! significa continuare a caricare il JavaScript vecchio anche quando sul
//! disco c'è il nuovo. Una classe intera di «serve un riavvio?» nasce da qui.
//!
//! LA REGOLA, CHE È IL ROVESCIO DI QUELLA ISTINTIVA
//!
//! Gli asset con l'hash nel nome si possono tenere **per sempre**: se il
//! contenuto cambia, cambia il nome, e il browser chiede un file diverso. È
//! la pagina che li nomina a non doversi cacheare **mai**.
//!
//! `no-cache` non vuol dire «non conservarla»: vuol dire «prima di usarla
//! chiedi se è ancora buona». Con `last-modified` già presente, la domanda
//! costa un 304 vuoto.

use axum::{
    extract::Request,
    http::{header, HeaderValue},
    middleware::Next,
    response::Response,
};

/// Un anno. È il massimo che ha senso dichiarare, e vale solo per i file il
/// cui nome cambia col contenuto.
const PER_SEMPRE: &str = "public, max-age=31536000, immutable";

/// «Tienila pure, ma chiedimi se è ancora buona prima di usarla.»
const RIVALIDA: &str = "no-cache";

/// La decisione, da sola: funzione pura, così si prova senza alzare un
/// server — stessa scelta di `router::fonte_autenticazione` e di
/// `projects::visibilita`.
///
/// `None` = non si dice niente, e vale per tutto ciò che non è la SPA: le
/// API, i marchi, i file di progetto. Allargare questo strato a cose che non
/// si sono misurate vorrebbe dire indovinare.
pub fn politica(percorso: &str, tipo: Option<&str>, gia_dichiarata: bool) -> Option<&'static str> {
    // Chi ha già deciso per conto suo ne sa di più di questo strato generico.
    if gia_dichiarata {
        return None;
    }
    // Il **tipo** e non l'estensione: la SPA viene servita anche su percorsi
    // senza estensione (`/qualunque-cosa` ricade su `index-admin.html` per il
    // routing lato client), e sono proprio quelli più facili da dimenticare.
    if tipo.is_some_and(|v| v.starts_with("text/html")) {
        return Some(RIVALIDA);
    }
    if percorso.starts_with("/assets/") {
        return Some(PER_SEMPRE);
    }
    None
}

pub async fn intestazioni_cache(req: Request, next: Next) -> Response {
    let percorso = req.uri().path().to_string();
    let mut res = next.run(req).await;
    let tipo = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());
    let gia = res.headers().contains_key(header::CACHE_CONTROL);
    if let Some(v) = politica(&percorso, tipo.as_deref(), gia) {
        res.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(v));
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML: Option<&str> = Some("text/html; charset=utf-8");

    /// La pagina d'ingresso non si tiene **mai**: nomina i bundle con
    /// l'hash, e tenersi lei significa caricare il JavaScript vecchio.
    #[test]
    fn la_pagina_si_rivalida_sempre() {
        assert_eq!(politica("/index-admin.html", HTML, false), Some(RIVALIDA));
    }

    /// Anche da un percorso senza estensione: la SPA ricade su
    /// `index-admin.html` per il routing lato client. Per questo si guarda il
    /// TIPO e non come finisce il nome.
    #[test]
    fn vale_anche_senza_estensione() {
        assert_eq!(politica("/qualunque-cosa", HTML, false), Some(RIVALIDA));
    }

    /// Gli asset col nome che cambia col contenuto si tengono per sempre: se
    /// cambiano, il browser chiede un file con un altro nome.
    #[test]
    fn gli_asset_con_hash_si_tengono_per_sempre() {
        assert_eq!(
            politica("/assets/admin-ABC123.js", Some("text/javascript"), false),
            Some(PER_SEMPRE)
        );
    }

    /// Le API non si toccano: questo strato esiste per la SPA.
    #[test]
    fn le_api_restano_come_sono() {
        assert_eq!(politica("/api/system", Some("application/json"), false), None);
    }

    /// E nemmeno i marchi, che hanno gia' le loro intestazioni di sicurezza.
    #[test]
    fn i_marchi_restano_come_sono() {
        assert_eq!(politica("/branding/pixsys/logo.svg", Some("image/svg+xml"), false), None);
    }

    /// Chi ha gia' dichiarato una politica ne sa di piu'.
    #[test]
    fn una_politica_gia_dichiarata_non_si_sovrascrive() {
        assert_eq!(politica("/index-admin.html", HTML, true), None);
        assert_eq!(politica("/assets/x-ABC.js", Some("text/javascript"), true), None);
    }
}
