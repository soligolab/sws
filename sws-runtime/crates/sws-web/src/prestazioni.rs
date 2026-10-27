//! Dove se ne va il tempo, lato runtime (piano
//! `docs/plans/2026-10-26-dove-se-ne-va-il-tempo.md`).
//!
//! - `GET /api/prestazioni` (Supervisor): la finestra del registro del
//!   processo (`sws_core::prestazioni`) e l'ultimo riassunto del viewer LVGL.
//!   **Chi la chiede accende la richiesta per un minuto**: è il segnale che fa
//!   parlare il viewer.
//! - `GET /api/prestazioni/richiesta` e `POST /api/prestazioni/viewer`: le due
//!   del viewer, **senza sessione**. Il viewer di un pannello in chiaro o senza
//!   utenti non ne ha una, e sul pannello il runtime pubblica le porte su una
//!   rete rootless, dove l'indirizzo di chi chiama non dice se è la stessa
//!   macchina: un controllo «solo da loopback» non si potrebbe fidare. Sono
//!   innocue per costruzione — la prima dice solo sì o no, la seconda accetta
//!   un riassunto piccolo, e solo mentre qualcuno sta guardando.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use sws_core::prestazioni::{self, Riassunto};

/// Quanto dura una richiesta: la pagina dell'IDE la rinnova a ogni lettura.
const DURATA_RICHIESTA: Duration = Duration::from_secs(60);
/// Un riassunto del viewer più vecchio di così non si mostra.
const VIEWER_SCADUTO: Duration = Duration::from_secs(15);
/// Le voci del viewer sono una dozzina: oltre, qualcosa non va.
const MASSIMO_VOCI: usize = 64;
/// Due pagine aperte non si rubano la finestra: sotto questo intervallo si
/// rimanda la stessa.
const FINESTRA_MINIMA: Duration = Duration::from_millis(1500);

static RICHIESTA_FINO_MS: AtomicU64 = AtomicU64::new(0);
static VIEWER: Mutex<Option<(Riassunto, Instant)>> = Mutex::new(None);
static RUNTIME: Mutex<Option<(Riassunto, Instant)>> = Mutex::new(None);

fn ora_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn attiva() -> bool {
    ora_ms() < RICHIESTA_FINO_MS.load(Ordering::Relaxed)
}

/// La finestra del runtime, presa al più ogni [`FINESTRA_MINIMA`].
fn finestra_runtime() -> Riassunto {
    let mut g = RUNTIME.lock().unwrap_or_else(|e| e.into_inner());
    match g.as_ref() {
        Some((r, quando)) if quando.elapsed() < FINESTRA_MINIMA => r.clone(),
        _ => {
            let r = prestazioni::finestra_e_azzera();
            *g = Some((r.clone(), Instant::now()));
            r
        }
    }
}

/// `GET /api/prestazioni`
pub async fn leggi() -> Response {
    RICHIESTA_FINO_MS.store(ora_ms() + DURATA_RICHIESTA.as_millis() as u64, Ordering::Relaxed);
    let viewer = VIEWER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .filter(|(_, quando)| quando.elapsed() < VIEWER_SCADUTO)
        .map(|(r, quando)| (r.clone(), quando.elapsed().as_secs_f64()));
    Json(serde_json::json!({
        "runtime": finestra_runtime(),
        "viewer": viewer.as_ref().map(|v| &v.0),
        "viewer_eta_s": viewer.as_ref().map(|v| v.1),
    }))
    .into_response()
}

/// `GET /api/prestazioni/richiesta` — il viewer chiede se qualcuno guarda.
pub async fn richiesta() -> Response {
    Json(serde_json::json!({ "attiva": attiva() })).into_response()
}

/// `POST /api/prestazioni/viewer` — il riassunto del viewer.
pub async fn dal_viewer(Json(mut r): Json<Riassunto>) -> Response {
    if !attiva() {
        // Nessuno guarda: non si tiene niente.
        return StatusCode::NO_CONTENT.into_response();
    }
    if r.voci.len() > MASSIMO_VOCI {
        return (StatusCode::BAD_REQUEST, "troppe voci").into_response();
    }
    for v in &mut r.voci {
        v.nome.truncate(64);
        v.secchi.truncate(prestazioni::SOGLIE_MS.len() + 1);
    }
    *VIEWER.lock().unwrap_or_else(|e| e.into_inner()) = Some((r, Instant::now()));
    StatusCode::NO_CONTENT.into_response()
}

/// Il totale del registro come istogrammi Prometheus, per `/metrics`:
/// `sws_lavoro_secondi_bucket{lavoro=…,le=…}`, `_sum`, `_count`.
pub fn testo_prometheus() -> String {
    use std::fmt::Write as _;
    let tot = prestazioni::totale();
    if tot.voci.is_empty() {
        return String::new();
    }
    let mut s = String::from(
        "# HELP sws_lavoro_secondi Tempo di parete per lavoro (sorgenti, storico, allarmi, script, invio dei tag).\n\
         # TYPE sws_lavoro_secondi histogram\n",
    );
    for v in &tot.voci {
        let nome = v.nome.replace('\\', "\\\\").replace('"', "\\\"");
        let mut cumulato = 0u64;
        for (i, c) in v.secchi.iter().enumerate() {
            cumulato += c;
            let le = prestazioni::SOGLIE_MS
                .get(i)
                .map(|ms| format!("{}", ms / 1000.0))
                .unwrap_or_else(|| "+Inf".into());
            let _ = writeln!(s, "sws_lavoro_secondi_bucket{{lavoro=\"{nome}\",le=\"{le}\"}} {cumulato}");
        }
        let _ = writeln!(s, "sws_lavoro_secondi_sum{{lavoro=\"{nome}\"}} {}", v.somma_ms / 1000.0);
        let _ = writeln!(s, "sws_lavoro_secondi_count{{lavoro=\"{nome}\"}} {}", v.n);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn riassunto(voci: usize) -> Riassunto {
        Riassunto {
            intervallo_s: 2.0,
            voci: (0..voci)
                .map(|i| sws_core::prestazioni::Voce { nome: format!("v{i}"), n: 1, somma_ms: 1.0, max_ms: 1.0, secchi: vec![1, 0, 0, 0, 0, 0, 0, 0] })
                .collect(),
        }
    }

    /// Un test solo, perché lo stato è del processo: l'ordine conta.
    #[tokio::test]
    async fn il_viewer_parla_solo_mentre_qualcuno_guarda() {
        RICHIESTA_FINO_MS.store(0, Ordering::Relaxed);
        *VIEWER.lock().unwrap() = None;
        let r = dal_viewer(Json(riassunto(3))).await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        assert!(VIEWER.lock().unwrap().is_none(), "nessuno guarda: niente si tiene");

        let _ = leggi().await; // la pagina dell'IDE accende la richiesta
        assert!(attiva());
        let r = dal_viewer(Json(riassunto(3))).await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        assert!(VIEWER.lock().unwrap().is_some());

        let r = dal_viewer(Json(riassunto(MASSIMO_VOCI + 1))).await;
        assert_eq!(r.status(), StatusCode::BAD_REQUEST, "un riassunto enorme si rifiuta");
    }

    #[test]
    fn prometheus_cumula_i_secchi() {
        sws_core::prestazioni::registra("prova.prometheus", Duration::from_micros(1500));
        sws_core::prestazioni::registra("prova.prometheus", Duration::from_millis(50));
        let t = testo_prometheus();
        assert!(t.contains("sws_lavoro_secondi_bucket{lavoro=\"prova.prometheus\",le=\"0.002\"} 1"));
        assert!(t.contains("sws_lavoro_secondi_bucket{lavoro=\"prova.prometheus\",le=\"+Inf\"} 2"));
        assert!(t.contains("sws_lavoro_secondi_count{lavoro=\"prova.prometheus\"} 2"));
    }
}
