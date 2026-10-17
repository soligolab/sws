//! Le intestazioni di sicurezza di ogni risposta (C6 dell'onda 2, 17-10-2026, piano
//! `docs/plans/2026-10-17-onda-2-prestazioni-e-protezioni.md`).
//!
//! - `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`;
//! - una `Content-Security-Policy` che dice da dove possono arrivare script, stili,
//!   immagini e connessioni, e chi può mostrare SWS dentro un iframe
//!   (`frame-ancestors`): `'self'`, più le origini dichiarate dall'istanza in
//!   `<config>/sicurezza.yaml` (`origini_iframe`);
//! - `Strict-Transport-Security` solo quando la richiesta è arrivata in HTTPS
//!   (`X-Forwarded-Proto: https`, come nel cloud dietro Traefik): un pannello in
//!   HTTP non deve diventare irraggiungibile perché un browser si è ricordato HTTPS.
//!
//! La CSP si mette **solo se manca**. Due casi la portano già: i file dei marchi
//! (`marchi.rs`, una CSP più stretta con `sandbox`) e, nel cloud, le risposte che il
//! gateway inoltra da un container di progetto: lì vale la politica del container,
//! cioè le origini dichiarate da chi gestisce quel progetto, non quelle del gateway.

use std::path::Path;
use std::sync::RwLock;

use axum::{
    extract::Request,
    http::{header, HeaderValue},
    middleware::Next,
    response::Response,
};

pub const FILE: &str = "sicurezza.yaml";

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Impostazioni {
    /// Le origini che possono mostrare SWS in un iframe, oltre a SWS stesso
    /// (es. `https://casa.example:8123`). Vuoto = nessuna.
    #[serde(default)]
    pub origini_iframe: Vec<String>,
}

static ORIGINI: RwLock<Vec<String>> = RwLock::new(Vec::new());

/// Una origine scritta bene: schema http(s), host, porta facoltativa, niente
/// percorso. Il resto finirebbe dentro la CSP così com'è.
pub fn origine_valida(o: &str) -> bool {
    let Some(resto) = o.strip_prefix("https://").or_else(|| o.strip_prefix("http://")) else {
        return false;
    };
    !resto.is_empty()
        && resto.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '*'))
        && !resto.starts_with(':')
}

/// Legge `<config>/sicurezza.yaml` all'avvio; un file assente vale «nessuna origine».
pub fn carica(config_dir: &Path) {
    let imp = std::fs::read_to_string(config_dir.join(FILE))
        .ok()
        .and_then(|t| serde_yaml::from_str::<Impostazioni>(&t).ok())
        .unwrap_or_default();
    imposta(&imp.origini_iframe);
}

pub fn imposta(origini: &[String]) {
    let buone: Vec<String> = origini.iter().map(|o| o.trim().trim_end_matches('/').to_string())
        .filter(|o| origine_valida(o)).collect();
    if let Ok(mut g) = ORIGINI.write() {
        *g = buone;
    }
}

pub fn origini() -> Vec<String> {
    ORIGINI.read().map(|g| g.clone()).unwrap_or_default()
}

/// La politica, da sola: funzione pura, così si prova senza alzare un server.
///
/// Le eccezioni rispetto a un `default-src 'self'` stretto, ognuna col suo perché:
/// - `style-src 'unsafe-inline'`: l'IDE e i sinottici usano stili in linea ovunque
///   (React `style={…}`), e gli attributi `style` non hanno alternativa;
/// - `img-src` e `connect-src` aperti a `http:`/`https:`: le pagine possono usare
///   immagini da URL esterni, e l'IDE interroga direttamente gli altri runtime
///   (stato e impronta dei dispositivi registrati);
/// - `ws:`/`wss:`: i dati vivi.
///
/// Restano chiusi gli **script** (`script-src 'self'`: dal 17-10-2026 nemmeno le
/// pagine HTML ne hanno in linea), i plugin (`object-src 'none'`), il `<base>` e
/// chi può incorniciare SWS.
pub fn politica(origini: &[String]) -> String {
    let mut cornice = String::from("'self'");
    for o in origini {
        cornice.push(' ');
        cornice.push_str(o);
    }
    format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob: http: https:; font-src 'self' data:; \
         connect-src 'self' http: https: ws: wss:; worker-src 'self'; \
         object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors {cornice}"
    )
}

pub async fn intestazioni(req: Request, next: Next) -> Response {
    let https = req
        .headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("https"));
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    if !h.contains_key(header::CONTENT_SECURITY_POLICY) {
        if let Ok(v) = HeaderValue::from_str(&politica(&origini())) {
            h.insert(header::CONTENT_SECURITY_POLICY, v);
        }
    }
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("same-origin"));
    if https {
        h.insert(header::STRICT_TRANSPORT_SECURITY, HeaderValue::from_static("max-age=31536000"));
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_politica_chiude_script_e_cornici() {
        let p = politica(&[]);
        assert!(p.contains("script-src 'self';"));
        assert!(p.contains("object-src 'none'"));
        assert!(p.ends_with("frame-ancestors 'self'"));
        let p2 = politica(&["https://casa.example:8123".into()]);
        assert!(p2.ends_with("frame-ancestors 'self' https://casa.example:8123"));
    }

    #[test]
    fn solo_origini_scritte_bene() {
        for buona in ["https://casa.example:8123", "http://192.168.1.10", "https://*.example.com"] {
            assert!(origine_valida(buona), "{buona}");
        }
        for cattiva in ["casa.example", "https://", "https://a.b/percorso", "javascript:alert(1)", "https://a; script-src *", "https://:80"] {
            assert!(!origine_valida(cattiva), "{cattiva}");
        }
    }
}
