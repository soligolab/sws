//! La ritenzione automatica dei datastore: lo stato per progetto, il giro notturno e
//! la conferma del primo giro (piano `docs/plans/2026-10-20-ritenzione-automatica.md`).
//!
//! Le parti pure (il conto dell'anteprima, «è dovuto?», «la conferma vale ancora?»)
//! stanno in `sws_historian::ritenzione` con i loro test; qui c'è quello che tocca il
//! disco e la rete.
//!
//! **Lo stato** sta in `<progetto>/history/ritenzione.json`, accanto allo storico che
//! descrive: l'ultimo giro e, per ogni datastore, i valori che un Admin ha confermato.
//! Non va in git (`RIGHE_GITIGNORE_DATI`, `git_deploy.rs`) e non viaggia col deploy:
//! la conferma vale per **quel** storico, sul dispositivo che lo cancellerà.
//!
//! **Il primo giro non parte da solo** (decisione del maintainer, 20-10-2026): finché un
//! datastore non è confermato, il giro lo salta, e l'IDE mostra all'Admin quante righe
//! e quanti byte cancellerebbe. CasaDomotica aveva 540 MB e un `retention_days` mai
//! applicato: un primo giro senza avviso sarebbe stato irreversibile.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Path as AxPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sws_historian::ritenzione::{self, Anteprima};
use tracing::{info, warn};

use crate::router::{active_dir, AppState, AuthUser, RegistryCell};

/// Scritture dello stato una alla volta: il giro e una conferma possono arrivare
/// nello stesso minuto, e ognuno rilegge il file prima di riscriverlo.
static SCRITTURA: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct StatoFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ultimo_giro_ms: Option<u64>,
    #[serde(default)]
    pub conferme: BTreeMap<String, Conferma>,
}

/// I valori che un Admin ha visto e confermato. Se poi diventano più stretti la
/// conferma decade (`ritenzione::conferma_vale`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conferma {
    pub retention_rows: Option<u64>,
    pub retention_days: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub da: Option<String>,
    pub il_ms: u64,
}

fn percorso(dir: &Path) -> PathBuf {
    dir.join("history").join("ritenzione.json")
}

pub fn leggi(dir: &Path) -> StatoFile {
    std::fs::read(percorso(dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn scrivi(dir: &Path, st: &StatoFile) -> std::io::Result<()> {
    let p = percorso(dir);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(st).unwrap_or_default())?;
    std::fs::rename(tmp, p)
}

fn adesso_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// L'istante di **oggi** all'ora `minuti` (dalla mezzanotte), nell'ora locale del
/// dispositivo: il container vede il fuso dell'host (`Timezone=local` nel quadlet),
/// come per la finestra degli aggiornamenti (`aggiornamento_finestra.rs`). Un'ora
/// saltata dal cambio d'ora vale l'ora dopo; una ripetuta, la prima delle due.
fn istante_di_oggi_ms(minuti: u32) -> u64 {
    use chrono::{Duration, NaiveTime, TimeZone};
    let adesso = chrono::Local::now();
    let ora = NaiveTime::from_hms_opt(minuti / 60, minuti % 60, 0).unwrap_or_default();
    let locale = adesso.date_naive().and_time(ora);
    let t = match chrono::Local.from_local_datetime(&locale) {
        chrono::LocalResult::Single(t) | chrono::LocalResult::Ambiguous(t, _) => t,
        chrono::LocalResult::None => match chrono::Local.from_local_datetime(&(locale + Duration::hours(1))) {
            chrono::LocalResult::Single(t) | chrono::LocalResult::Ambiguous(t, _) => t,
            chrono::LocalResult::None => adesso,
        },
    };
    t.timestamp_millis().max(0) as u64
}

fn ora_del_progetto(p: &sws_core::Project) -> u32 {
    p.ritenzione_ora
        .as_deref()
        .and_then(ritenzione::leggi_ora)
        .or_else(|| ritenzione::leggi_ora(ritenzione::ORA_PREDEFINITA))
        .unwrap_or(180)
}

async fn carica_progetto(dir: &Path) -> Option<sws_core::Project> {
    let d = dir.to_path_buf();
    tokio::task::spawn_blocking(move || sws_core::Project::load(&d).ok())
        .await
        .ok()
        .flatten()
}

/// Il giro notturno, se è dovuto. Lo chiama ogni minuto un task di `sws-runtime`.
///
/// Pulisce solo i datastore **confermati** per i valori di adesso; gli altri li salta
/// in silenzio — li mostra l'IDE. Il giro si segna fatto comunque: senza, un progetto
/// senza conferme lo rifarebbe a ogni minuto dopo l'ora.
pub async fn giro_se_dovuto(dir: &Path, registry: &RegistryCell, audit: &Arc<sws_audit::AuditLog>) {
    let Some(project) = carica_progetto(dir).await else { return };
    let ora = ora_del_progetto(&project);
    let adesso = adesso_ms();
    let st = leggi(dir);
    let Some(ultimo) = st.ultimo_giro_ms else {
        // Primo sguardo a questo progetto: si segna «adesso» e non si pulisce, così il
        // primo giro è all'ora del progetto e non un minuto dopo l'apertura o la conferma.
        let _g = SCRITTURA.lock().await;
        let mut st = leggi(dir);
        st.ultimo_giro_ms.get_or_insert(adesso);
        if let Err(e) = scrivi(dir, &st) {
            warn!("ritenzione: stato non scritto: {e}");
        }
        return;
    };
    if !ritenzione::dovuto(adesso, istante_di_oggi_ms(ora), ultimo) {
        return;
    }
    let Some(reg) = registry.read().await.as_ref().map(Arc::clone) else { return };

    for ds in &project.datastores {
        if ds.retention_rows.is_none() && ds.retention_days.is_none() {
            continue;
        }
        let Some(c) = st.conferme.get(&ds.id) else { continue };
        if !ritenzione::conferma_vale(
            (c.retention_rows, c.retention_days),
            (ds.retention_rows, ds.retention_days),
        ) {
            continue;
        }
        let prima = reg.backend_stats(&ds.id).await.map(|s| s.sample_count).unwrap_or(0);
        match reg.purge_backend(&ds.id, ds.retention_rows, ds.retention_days).await {
            Ok(cancellate) => {
                let vacuum = if ritenzione::serve_vacuum(cancellate, prima) {
                    reg.vacuum_backend(&ds.id).await.ok()
                } else {
                    None
                };
                info!(datastore = %ds.id, cancellate, prima, vacuum = ?vacuum, "ritenzione: giro notturno");
                audit.log(
                    "datastore.ritenzione_auto",
                    None,
                    serde_json::json!({
                        "datastore": ds.id,
                        "cancellate": cancellate,
                        "righe_prima": prima,
                        "vacuum_byte": vacuum,
                    }),
                );
            }
            Err(e) => warn!(datastore = %ds.id, "ritenzione: giro fallito: {e:#}"),
        }
    }

    let _g = SCRITTURA.lock().await;
    let mut st = leggi(dir);
    st.ultimo_giro_ms = Some(adesso);
    if let Err(e) = scrivi(dir, &st) {
        warn!("ritenzione: stato non scritto: {e}");
    }
}

/// I datastore che aspettano la conferma del primo giro, senza contare righe: lo
/// chiede `/api/system`, che l'IDE interroga ogni pochi secondi, per l'avviso in testata.
/// I numeri li dà `GET /api/datastores/retention`, quando l'Admin apre la scheda.
pub async fn da_confermare(dir: &Path) -> Vec<String> {
    let Some(project) = carica_progetto(dir).await else { return Vec::new() };
    let st = leggi(dir);
    project
        .datastores
        .iter()
        .filter(|ds| ds.retention_rows.is_some() || ds.retention_days.is_some())
        .filter(|ds| {
            !st.conferme.get(&ds.id).is_some_and(|c| {
                ritenzione::conferma_vale(
                    (c.retention_rows, c.retention_days),
                    (ds.retention_rows, ds.retention_days),
                )
            })
        })
        .map(|ds| if ds.label.is_empty() { ds.id.clone() } else { format!("{} ({})", ds.label, ds.id) })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct StatoDatastore {
    pub id: String,
    pub label: String,
    pub retention_rows: Option<u64>,
    pub retention_days: Option<u64>,
    /// `non_configurata` (nessun limite), `da_confermare`, `attiva`.
    pub stato: &'static str,
    /// Solo per `da_confermare`: quello che il primo giro cancellerà.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anteprima: Option<Anteprima>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errore: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StatoRitenzione {
    /// L'ora del giro, `"HH:MM"`.
    pub ora: String,
    pub ultimo_giro_ms: Option<u64>,
    pub datastores: Vec<StatoDatastore>,
}

pub async fn calcola_stato(dir: &Path, registry: &RegistryCell) -> Option<StatoRitenzione> {
    let project = carica_progetto(dir).await?;
    let ora = ora_del_progetto(&project);
    let st = leggi(dir);
    let reg = registry.read().await.as_ref().map(Arc::clone);
    let mut out = Vec::new();
    for ds in &project.datastores {
        let configurata = ds.retention_rows.is_some() || ds.retention_days.is_some();
        let confermata = st.conferme.get(&ds.id).is_some_and(|c| {
            ritenzione::conferma_vale(
                (c.retention_rows, c.retention_days),
                (ds.retention_rows, ds.retention_days),
            )
        });
        let stato = match (configurata, confermata) {
            (false, _) => "non_configurata",
            (true, false) => "da_confermare",
            (true, true) => "attiva",
        };
        let (anteprima, errore) = if stato == "da_confermare" {
            match &reg {
                Some(r) => match r.anteprima_backend(&ds.id, ds.retention_rows, ds.retention_days).await {
                    Ok(a) => (Some(a), None),
                    Err(e) => (None, Some(format!("{e:#}"))),
                },
                None => (None, Some("nessun datastore aperto".into())),
            }
        } else {
            (None, None)
        };
        out.push(StatoDatastore {
            id: ds.id.clone(),
            label: ds.label.clone(),
            retention_rows: ds.retention_rows,
            retention_days: ds.retention_days,
            stato,
            anteprima,
            errore,
        });
    }
    Some(StatoRitenzione {
        ora: format!("{:02}:{:02}", ora / 60, ora % 60),
        ultimo_giro_ms: st.ultimo_giro_ms,
        datastores: out,
    })
}

/// `GET /api/datastores/retention` — lo stato della ritenzione per ogni datastore,
/// con l'anteprima di quelli da confermare. Admin: è chi può confermare.
pub async fn get_ritenzione(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    match calcola_stato(&dir, &s.registry).await {
        Some(st) => Json(st).into_response(),
        None => (StatusCode::NOT_FOUND, "progetto non leggibile").into_response(),
    }
}

/// `POST /api/datastores/:id/retention/confirm` — l'Admin ha visto l'anteprima e
/// conferma: da qui il giro notturno pulisce quel datastore, finché i suoi limiti
/// non diventano più stretti. Finisce nell'audit con i numeri che erano in vista.
pub async fn conferma_ritenzione(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    AxPath(id): AxPath<String>,
) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let Some(project) = carica_progetto(&dir).await else {
        return (StatusCode::NOT_FOUND, "progetto non leggibile").into_response();
    };
    let Some(ds) = project.datastores.iter().find(|d| d.id == id) else {
        return (StatusCode::NOT_FOUND, format!("datastore '{id}' non trovato")).into_response();
    };
    if ds.retention_rows.is_none() && ds.retention_days.is_none() {
        return (StatusCode::BAD_REQUEST, "questo datastore non ha limiti di ritenzione").into_response();
    }
    let anteprima = match s.registry.read().await.as_ref().map(Arc::clone) {
        Some(r) => r.anteprima_backend(&id, ds.retention_rows, ds.retention_days).await.ok(),
        None => None,
    };
    {
        let _g = SCRITTURA.lock().await;
        let mut st = leggi(&dir);
        st.conferme.insert(
            id.clone(),
            Conferma {
                retention_rows: ds.retention_rows,
                retention_days: ds.retention_days,
                da: Some(user.username.clone()),
                il_ms: adesso_ms(),
            },
        );
        if let Err(e) = scrivi(&dir, &st) {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("stato non scritto: {e}")).into_response();
        }
    }
    s.audit.log(
        "datastore.ritenzione_confermata",
        Some(user.username),
        serde_json::json!({
            "datastore": id,
            "retention_rows": ds.retention_rows,
            "retention_days": ds.retention_days,
            "anteprima": anteprima,
        }),
    );
    match calcola_stato(&dir, &s.registry).await {
        Some(st) => Json(st).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lo_stato_si_scrive_e_si_rilegge() {
        let d = tempfile::tempdir().unwrap();
        assert!(leggi(d.path()).ultimo_giro_ms.is_none(), "senza file: stato vuoto");
        let mut st = StatoFile::default();
        st.ultimo_giro_ms = Some(42);
        st.conferme.insert(
            "default".into(),
            Conferma { retention_rows: None, retention_days: Some(365), da: Some("admin".into()), il_ms: 7 },
        );
        scrivi(d.path(), &st).unwrap();
        let r = leggi(d.path());
        assert_eq!(r.ultimo_giro_ms, Some(42));
        assert_eq!(r.conferme["default"].retention_days, Some(365));
        assert!(d.path().join("history/ritenzione.json").exists());
    }

    #[test]
    fn un_file_rotto_vale_come_nessuno_stato() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("history")).unwrap();
        std::fs::write(d.path().join("history/ritenzione.json"), b"{rotto").unwrap();
        let st = leggi(d.path());
        assert!(st.conferme.is_empty(), "nessuna conferma inventata da un file rotto");
    }
}
