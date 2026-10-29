//! I report programmati (P3, 26-10-2026; piano
//! `docs/archive/2026-10-26-report-programmati.md`).
//!
//! Un report raccoglie dallo storico i tag che dichiara e gli allarmi del
//! periodo, ne fa tre tabelle (`dati`) e le scrive in PDF (`pdf`) ed Excel
//! (`xlsx`), salvate in `<progetto>/reports/<id>/` e mandate per email con
//! l'SMTP delle notifiche. Partono da sole secondo il loro cron, nell'ora locale
//! del pannello, o a mano dall'IDE («Genera ora»).
//!
//! **Solo dove gira l'impianto**: nell'IDE e nel cloud lo storico non c'è (le
//! sorgenti non partono), e un report vuoto mandato per email ogni mattina
//! sarebbe peggio di nessun report.

pub mod dati;
pub mod pdf;
pub mod xlsx;

use crate::router::AppState;
use chrono::{Local, LocalResult, TimeZone};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use sws_core::{PeriodoReport, Project, ReportDef};
use tracing::{info, warn};

/// La cartella dei report, dentro il progetto.
pub const CARTELLA: &str = "reports";
const CONSERVA_PREDEFINITO: u32 = 30;

fn locale(ms: u64) -> chrono::DateTime<Local> {
    match Local.timestamp_millis_opt(ms as i64) {
        LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => t,
        LocalResult::None => Local.timestamp_millis_opt(0).unwrap(),
    }
}

fn ora_locale(ms: u64) -> String {
    locale(ms).format("%d/%m/%Y %H:%M").to_string()
}

/// L'inizio della finestra che finisce in `a_ms`. Il mese va dallo stesso
/// giorno del mese prima, col calendario locale: 31 giorni a marzo, 28 a
/// febbraio.
pub fn inizio_finestra(periodo: PeriodoReport, a_ms: u64) -> u64 {
    const ORA: u64 = 3_600_000;
    match periodo {
        PeriodoReport::Turno => a_ms.saturating_sub(8 * ORA),
        PeriodoReport::Giorno => a_ms.saturating_sub(24 * ORA),
        PeriodoReport::Settimana => a_ms.saturating_sub(7 * 24 * ORA),
        PeriodoReport::Mese => locale(a_ms)
            .checked_sub_months(chrono::Months::new(1))
            .map(|t| t.timestamp_millis().max(0) as u64)
            .unwrap_or_else(|| a_ms.saturating_sub(30 * 24 * ORA)),
    }
}

/// Il nome di un file: `<id>-<aaaammgg-hhmm>.<ext>`, che si ordina per data.
fn nome_file(id: &str, a_ms: u64, ext: &str) -> String {
    format!("{id}-{}.{ext}", locale(a_ms).format("%Y%m%d-%H%M"))
}

/// Un file salvato di un report.
#[derive(serde::Serialize, Debug, Clone)]
pub struct FileReport {
    pub nome: String,
    pub dimensione: u64,
    pub quando_ms: u64,
}

/// I file di un report, dal più recente.
pub fn file_di(progetto: &Path, id: &str) -> Vec<FileReport> {
    let Ok(voci) = std::fs::read_dir(progetto.join(CARTELLA).join(id)) else { return Vec::new() };
    let mut out: Vec<FileReport> = voci
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            m.is_file().then(|| FileReport {
                nome: e.file_name().to_string_lossy().to_string(),
                dimensione: m.len(),
                quando_ms: m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
            })
        })
        .collect();
    out.sort_by(|a, b| b.nome.cmp(&a.nome));
    out
}

/// Tiene le ultime `conserva` generazioni (una generazione = i suoi file, PDF ed
/// Excel, con lo stesso nome senza estensione).
fn pota(cartella: &Path, conserva: u32) {
    let Ok(voci) = std::fs::read_dir(cartella) else { return };
    let mut nomi: Vec<String> = voci.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
    nomi.sort();
    let mut generazioni: Vec<String> = nomi.iter().filter_map(|n| n.rsplit_once('.').map(|(s, _)| s.to_string())).collect();
    generazioni.dedup();
    let via = generazioni.len().saturating_sub(conserva.max(1) as usize);
    for g in &generazioni[..via] {
        for n in nomi.iter().filter(|n| n.rsplit_once('.').map(|(s, _)| s) == Some(g.as_str())) {
            let _ = std::fs::remove_file(cartella.join(n));
        }
    }
}

/// Genera un report che finisce in `a_ms`: legge, scrive, pota, manda.
/// Restituisce i file scritti.
pub async fn genera(s: &AppState, def: &ReportDef, a_ms: u64) -> anyhow::Result<Vec<FileReport>> {
    let dir = crate::router::active_dir(s).await.map_err(|_| anyhow::anyhow!("nessun progetto aperto"))?;
    let progetto = Project::load(&dir)?;
    let da_ms = inizio_finestra(def.periodo, a_ms);
    let passo_ms = def.intervallo_min.unwrap_or_else(|| def.periodo.passo_predefinito_min()) as u64 * 60_000;

    let mut campioni = HashMap::new();
    if let Some(reg) = s.registry.read().await.as_ref().cloned() {
        for t in &def.tags {
            campioni.insert(t.clone(), reg.query(t, Some(da_ms), Some(a_ms)).await);
        }
    }
    let allarmi = if def.allarmi {
        Some(match s.historian.sqlite_store().await {
            Some(store) => store.query_alarm_events(None, Some(da_ms), Some(a_ms), 10_000).await,
            None => s.alarms.journal_filtrato(None, Some(da_ms), Some(a_ms), 10_000).await,
        })
    } else {
        None
    };
    let info: HashMap<String, dati::InfoTag> = progetto
        .tags
        .iter()
        .filter(|t| def.tags.contains(&t.id))
        .map(|t| (t.id.clone(), dati::InfoTag { descrizione: t.description.clone(), unita: t.unit.clone().unwrap_or_default(), decimali: t.decimals.unwrap_or(2) }))
        .collect();
    let lingua = if progetto.languages.default.is_empty() { "it".to_string() } else { progetto.languages.default.clone() };
    let titolo = if def.titolo.is_empty() { def.id.clone() } else { def.titolo.clone() };
    let d = dati::componi(&titolo, &progetto.meta.name, &def.tags, &info, &campioni, allarmi.as_deref(), da_ms, a_ms, passo_ms, sws_core::now_ms(), &lingua, &ora_locale);

    let cartella = dir.join(CARTELLA).join(&def.id);
    tokio::fs::create_dir_all(&cartella).await?;
    let mut scritti = Vec::new();
    let mut allegati = Vec::new();
    for f in def.formati_effettivi() {
        let (byte, tipo) = match f {
            "pdf" => (pdf::scrivi(&d), "application/pdf"),
            "xlsx" => (xlsx::scrivi(&d)?, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            _ => continue,
        };
        let nome = nome_file(&def.id, a_ms, f);
        tokio::fs::write(cartella.join(&nome), &byte).await?;
        scritti.push(FileReport { nome: nome.clone(), dimensione: byte.len() as u64, quando_ms: sws_core::now_ms() });
        allegati.push((nome, byte, tipo));
    }
    let conserva = def.conserva.unwrap_or(CONSERVA_PREDEFINITO);
    let c = cartella.clone();
    let _ = tokio::task::spawn_blocking(move || pota(&c, conserva)).await;

    if !def.email.is_empty() {
        match progetto.notifications.as_ref().and_then(|n| n.smtp.clone()) {
            Some(smtp) => {
                let to: Vec<String> = def.email.iter().map(|d| d.indirizzo.clone()).collect();
                let oggetto = format!("[SWS] {titolo} — {}", d.periodo);
                let corpo = format!("{}\n{}\n", d.progetto, d.periodo);
                let r = tokio::task::spawn_blocking(move || manda(&smtp, &to, &oggetto, &corpo, allegati)).await;
                match r {
                    Ok(Ok(())) => info!(report = %def.id, "report: inviato per email"),
                    Ok(Err(e)) => warn!(report = %def.id, "report: email non inviata: {e}"),
                    Err(e) => warn!(report = %def.id, "report: email non inviata: {e}"),
                }
            }
            None => warn!(report = %def.id, "report: ha destinatari email ma il progetto non ha l'SMTP configurato (Notifiche)"),
        }
    }
    info!(report = %def.id, file = scritti.len(), "report generato");
    Ok(scritti)
}

fn manda(smtp: &sws_core::SmtpConfig, to: &[String], oggetto: &str, corpo: &str, allegati: Vec<(String, Vec<u8>, &str)>) -> anyhow::Result<()> {
    use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
    use lettre::{Message, Transport};
    let transport = crate::notifications::build_transport(smtp)?;
    for addr in to {
        let mut parti = MultiPart::mixed().singlepart(SinglePart::plain(corpo.to_string()));
        for (nome, byte, tipo) in &allegati {
            parti = parti.singlepart(Attachment::new(nome.clone()).body(byte.clone(), ContentType::parse(tipo)?));
        }
        let msg = Message::builder()
            .from(smtp.from.parse().map_err(|e| anyhow::anyhow!("From non valido: {e}"))?)
            .to(addr.parse().map_err(|e| anyhow::anyhow!("To non valido {addr}: {e}"))?)
            .subject(oggetto)
            .multipart(parti)?;
        transport.send(&msg)?;
    }
    Ok(())
}

/// Questo processo fa girare l'impianto? Né IDE, né gateway, né container di
/// progetto nel cloud: lì lo storico non c'è.
fn ruolo_impianto(s: &AppState) -> bool {
    !s.ide_only && s.segreto_gateway.is_none() && s.regia.is_none()
}

/// Il compito dei report, avviato una volta sola col primo progetto aperto: a
/// ogni minuto rilegge i report del progetto aperto e fa partire quelli il cui
/// cron cade in quel minuto, nell'ora locale. Rileggere il progetto ogni minuto
/// vuol dire che un report salvato dall'IDE vale subito, senza riavvii.
pub fn avvia_una_volta(s: &AppState) {
    static AVVIATO: std::sync::Once = std::sync::Once::new();
    if !ruolo_impianto(s) {
        return;
    }
    let s = s.clone();
    AVVIATO.call_once(move || {
        tokio::spawn(async move {
            let mut ultimo_minuto = 0u64;
            loop {
                let adesso = sws_core::now_ms();
                let minuto = adesso / 60_000;
                if minuto != ultimo_minuto {
                    ultimo_minuto = minuto;
                    giro(&s, minuto * 60_000).await;
                }
                tokio::time::sleep(std::time::Duration::from_secs(60 - (adesso / 1000) % 60)).await;
            }
        });
    });
}

async fn giro(s: &AppState, minuto_ms: u64) {
    let Ok(dir) = crate::router::active_dir(s).await else { return };
    let Ok(p) = Project::load(&dir) else { return };
    if p.reports.is_empty() {
        return;
    }
    // L'ora locale come la vede il cron: lo spostamento del fuso sull'istante.
    let scarto = locale(minuto_ms).offset().local_minus_utc() as i64;
    let locale_s = (minuto_ms / 1000) as i64 + scarto;
    for def in &p.reports {
        let (Some(cron), _) = crate::cron::analizza(def.cron()) else { continue };
        if locale_s >= 0 && cron.combacia(locale_s as u64) {
            if let Err(e) = genera(s, def, minuto_ms).await {
                warn!(report = %def.id, "report non generato: {e}");
            }
        }
    }
}

/// I file di un report che si possono scaricare: niente percorsi.
pub fn file_sicuro(nome: &str) -> bool {
    !nome.is_empty() && !nome.starts_with('.') && !nome.contains(['/', '\\']) && !nome.contains("..")
}

pub fn percorso(progetto: &Path, id: &str, nome: &str) -> Option<PathBuf> {
    (file_sicuro(id) && file_sicuro(nome)).then(|| progetto.join(CARTELLA).join(id).join(nome))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_potatura_tiene_le_ultime_generazioni_coi_loro_file() {
        let d = tempfile::tempdir().unwrap();
        for g in ["r-20261020-0600", "r-20261021-0600", "r-20261022-0600"] {
            for e in ["pdf", "xlsx"] {
                std::fs::write(d.path().join(format!("{g}.{e}")), b"x").unwrap();
            }
        }
        pota(d.path(), 2);
        let mut resto: Vec<String> = std::fs::read_dir(d.path()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        resto.sort();
        assert_eq!(resto, ["r-20261021-0600.pdf", "r-20261021-0600.xlsx", "r-20261022-0600.pdf", "r-20261022-0600.xlsx"]);
    }

    #[test]
    fn le_finestre_dei_periodi() {
        let a = 1_000 * 3_600_000;
        assert_eq!(a - inizio_finestra(PeriodoReport::Turno, a), 8 * 3_600_000);
        assert_eq!(a - inizio_finestra(PeriodoReport::Giorno, a), 24 * 3_600_000);
        let mese = a - inizio_finestra(PeriodoReport::Mese, a);
        assert!((28 * 86_400_000..=31 * 86_400_000 + 3_600_000).contains(&mese), "{mese}");
    }

    #[test]
    fn niente_percorsi_nei_nomi() {
        assert!(percorso(Path::new("/p"), "r", "r-1.pdf").is_some());
        assert!(percorso(Path::new("/p"), "r", "../segreti.yaml").is_none());
        assert!(percorso(Path::new("/p"), "..", "x.pdf").is_none());
    }
}

#[cfg(test)]
mod campione {
    /// Scrive un report di prova in `$SWS_REPORT_CAMPIONE` per guardarlo con un
    /// lettore vero (`qpdf --check`, `pdftotext`, LibreOffice). Senza la
    /// variabile non fa niente: non è un test che gira sempre.
    #[test]
    fn scrive_un_campione_se_richiesto() {
        let Ok(dir) = std::env::var("SWS_REPORT_CAMPIONE") else { return };
        use super::dati::*;
        use sws_core::{TagQuality, TagValue};
        use sws_historian::Sample;
        let h = 3_600_000u64;
        let tags: Vec<String> = (1..=12).map(|i| format!("linea.temperatura_{i}")).collect();
        let campioni = tags
            .iter()
            .enumerate()
            .map(|(k, t)| (t.clone(), (0..96).map(|i| Sample { ts_ms: i * 15 * 60_000, value: TagValue::Float(20.0 + k as f64 + (i as f64 / 7.0).sin() * 3.0), quality: TagQuality::Good }).collect()))
            .collect();
        let info = tags.iter().map(|t| (t.clone(), InfoTag { descrizione: format!("Temperatura zona {t}"), unita: "°C".into(), decimali: 1 })).collect();
        let d = componi("Report giornaliero — qualità", "Caseificio Soligo", &tags, &info, &campioni, Some(&[]), 0, 24 * h, h, 24 * h, "it", &|ms| format!("{:02}:00", ms / h));
        std::fs::write(format!("{dir}/campione.pdf"), super::pdf::scrivi(&d)).unwrap();
        std::fs::write(format!("{dir}/campione.xlsx"), super::xlsx::scrivi(&d).unwrap()).unwrap();
    }
}

// ── Le rotte ─────────────────────────────────────────────────────────────────

use axum::{
    body::Body,
    extract::{Path as PathEx, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use crate::router::AuthUser;

/// Un report del progetto e i suoi file.
#[derive(serde::Serialize)]
pub struct ReportElenco {
    #[serde(flatten)]
    pub def: ReportDef,
    pub file: Vec<FileReport>,
    /// Questo processo li genera da solo? (No nell'IDE e nel cloud: lì si
    /// vedono e si scaricano quelli del pannello.)
    pub programmati: bool,
}

/// `GET /api/reports` — i report del progetto aperto, coi file già generati.
pub async fn elenco_handler(State(s): State<AppState>) -> Response {
    let Ok(dir) = crate::router::active_dir(&s).await else { return Json(Vec::<ReportElenco>::new()).into_response() };
    let programmati = ruolo_impianto(&s);
    let r = tokio::task::spawn_blocking(move || {
        Project::load(&dir)
            .map(|p| p.reports.into_iter().map(|def| ReportElenco { file: file_di(&dir, &def.id), def, programmati }).collect::<Vec<_>>())
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default();
    Json(r).into_response()
}

/// `GET /api/reports/:id/:file` — un file generato.
pub async fn scarica_handler(State(s): State<AppState>, PathEx((id, nome)): PathEx<(String, String)>) -> Response {
    let Ok(dir) = crate::router::active_dir(&s).await else { return StatusCode::NOT_FOUND.into_response() };
    let Some(p) = percorso(&dir, &id, &nome) else { return StatusCode::BAD_REQUEST.into_response() };
    match tokio::fs::read(&p).await {
        Ok(b) => {
            let tipo = if nome.ends_with(".pdf") {
                "application/pdf"
            } else if nome.ends_with(".xlsx") {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            } else {
                "application/octet-stream"
            };
            Response::builder()
                .header("Content-Type", tipo)
                .header("Content-Disposition", format!("attachment; filename=\"{nome}\""))
                .body(Body::from(b))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `POST /api/reports/:id/genera` — «Genera ora»: la finestra finisce adesso.
pub async fn genera_handler(State(s): State<AppState>, Extension(user): Extension<AuthUser>, PathEx(id): PathEx<String>) -> Response {
    s.audit.log("report.generate", Some(user.username), serde_json::json!({ "id": id }));
    let Ok(dir) = crate::router::active_dir(&s).await else { return (StatusCode::CONFLICT, "nessun progetto aperto").into_response() };
    let Ok(p) = Project::load(&dir) else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    let Some(def) = p.reports.iter().find(|r| r.id == id).cloned() else { return (StatusCode::NOT_FOUND, "report sconosciuto").into_response() };
    match genera(&s, &def, sws_core::now_ms()).await {
        Ok(f) => Json(f).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
