use std::net::IpAddr;
use std::path::Path;
use std::time::Instant;

use axum::{extract::State, http::StatusCode, response::{IntoResponse, Response}, Json};
use rcgen::{CertificateParams, KeyPair, SanType};
use serde::{Deserialize, Serialize};
use sws_core::{AlarmDb, TagDb};
use sws_historian::DatastoreRegistry;
use sysinfo::{Disks, System};

use crate::router::{active_dir, AppState};
use crate::source_supervisor::SourceSupervisor;

/// Un avviso sullo stato del runtime: **il runtime non sta facendo quello che
/// credi**, e questo dice cosa e come rimediare.
///
/// # Perché un elenco unico e non un campo per caso
///
/// Al 2026-09-04 di casi ce n'erano tre, arrivati da tre lavori diversi e con
/// tre destini diversi: uno script globale che non viene schedulato per un cron
/// illeggibile (l'errore finiva solo nel log del runtime, Q34); l'acquisizione
/// ferma dall'operatore, per cui un salvataggio persiste senza avviare (Q33); e
/// una scrittura rifiutata su un `project.yaml` non caricabile, che era l'unico
/// dei tre a rispondere qualcosa di leggibile (Q30). Tre istanze della stessa
/// mancanza — il runtime prende una decisione sensata e l'interfaccia tace —
/// che il quarto caso avrebbe ripetuto.
///
/// Si **calcolano dallo stato reale** a ogni chiamata, e non si accumulano in
/// una coda di eventi: un avviso che resta appeso dopo che la causa è sparita è
/// il difetto opposto, e costringerebbe a inventare quando cancellarlo. Il cron
/// in particolare si rilegge con `crate::cron`, lo **stesso** parser che
/// schedula, quindi l'avviso non può contraddire il comportamento — è la
/// ragione per cui quel parser è stato messo in un posto solo.
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Avviso {
    /// `"errore"` = qualcosa che l'utente crede attivo non lo è.
    /// `"avviso"` = funziona, ma non come sembra.
    pub gravita: &'static str,
    /// Dove guardare, in forma leggibile: `script globale «pompa»`,
    /// `acquisizione`.
    pub dove: String,
    pub messaggio: String,
    /// Cosa fare. Senza questo un avviso dice solo che qualcosa non va, e chi
    /// lo legge deve indovinare — è la stessa ragione per cui i rilievi del
    /// validatore hanno un `hint`.
    pub rimedio: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SystemStatus {
    pub runtime_version: String,
    pub uptime_s: u64,
    /// Quale ruolo sta servendo questa istanza: `"runtime"` se ha un viewer
    /// operatori (`--viewer-port`), `"ide"` se no.
    ///
    /// # Perché è nell'API e non dedotto dal client
    ///
    /// La conseguenza pratica è grossa e invisibile: sull'IDE di un'istanza
    /// `runtime` si modifica il progetto dell'**impianto in servizio**, e il
    /// salvataggio ne ricarica sorgenti e allarmi senza riavvio; sull'IDE di
    /// un'istanza `ide` si modifica una cartella locale che il dispositivo
    /// riceve solo al deploy. Niente nella UI distingueva i due casi.
    ///
    /// Prima la SPA lo deduceva per due vie indirette — un 404 su
    /// `/api/ai/config` e una convenzione sulle porte (`runtimeUrl.ts`, che nel
    /// proprio commento dichiara di essere una convenzione). Una deduzione non
    /// basta per fondare un avviso: quando sbaglia, mente.
    ///
    /// Il nome dice il **fatto**, non la conclusione: che sia «stai toccando un
    /// impianto» è un giudizio che la UI deriva e che può cambiare, mentre
    /// «questa istanza ha un viewer» è una proprietà del processo.
    pub mode: &'static str,
    pub active_project: Option<String>,
    /// Runtime version that last saved the active project's `project.yaml`
    /// (`None` if no project is open or the file predates version stamping).
    pub project_saved_by: Option<String>,
    /// True when the active project was saved by a different runtime version
    /// and the IDE should offer to re-save it in the current format.
    pub project_needs_update: bool,
    pub tag_count: usize,
    pub source_count: usize,
    /// True when the supervisor has at least one source running.
    ///
    /// **È un effetto, non un'intenzione**, e la differenza conta: un progetto
    /// senza sorgenti dichiarate lo mette a `false` pur girando regolarmente.
    /// Per sapere se l'operatore ha fermato l'impianto si guarda `armed`.
    pub sources_running: bool,
    /// Q33: l'acquisizione è **armata**? `false` solo dopo uno Stop esplicito
    /// dell'operatore, e fino al successivo Avvia.
    ///
    /// Questo è ciò che l'IDE deve mostrare nel pallino di testata. Prima
    /// mostrava `sources_running`, cioè deduceva lo stop dall'assenza di
    /// sorgenti attive: un progetto con zero sorgenti si presentava come fermo,
    /// e un impianto fermo tornava «in marcia» appena un salvataggio riavviava
    /// le sorgenti — che è precisamente il difetto di Q33 visto dalla UI.
    pub armed: bool,
    /// Gli avvisi correnti: vedi [`Avviso`]. Vuoto quando non c'è niente da
    /// dire, che è il caso normale.
    pub avvisi: Vec<Avviso>,
    /// Il server ha utenti definiti, quindi pretende un login.
    ///
    /// Serve alla SPA per distinguere **«non sei autenticato»** da **«qui non
    /// serve autenticarsi»**: senza utenti il runtime apre tutte le rotte
    /// (no-auth mode), e i controlli riservati a chi può configurare — Stop e
    /// Avvia in testata — sparivano perché il ruolo era `null`. Un pulsante che
    /// non c'è per un permesso che non viene richiesto è un pulsante perso.
    ///
    /// Riportato e non dedotto, per la stessa ragione scritta sopra per `mode`:
    /// la SPA lo indovinava da un 404, e una deduzione quando sbaglia mente.
    pub auth_required: bool,
    pub alarm_active_count: usize,
    pub historian_samples: u64,
    pub cpu_usage_pct: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub disk_used_gb: u64,
    pub disk_total_gb: u64,
}

/// Il valore del campo `mode` a partire da `AppState::ide_only`.
///
/// Una funzione e non un letterale nei due punti che lo costruiscono: le due
/// stringhe sono un contratto con la SPA, e averle in un posto solo evita che
/// un domani una diventi `"IDE"` e l'altra `"ide"`.
pub fn mode_label(ide_only: bool) -> &'static str {
    if ide_only { "ide" } else { "runtime" }
}

pub async fn compute_system_status(
    db: &TagDb,
    alarms: &AlarmDb,
    supervisor: &SourceSupervisor,
    registry: Option<&DatastoreRegistry>,
    project_dir: Option<&Path>,
    started_at: Instant,
    // Passato, non ricavato qui: `compute_system_status` non ha accesso ad
    // `AppState`, e prenderlo come parametro fa sì che il compilatore fermi un
    // chiamante futuro che lo dimenticasse — invece di lasciarlo restituire un
    // campo sbagliato in silenzio.
    ide_only: bool,
    // Passato per la stessa ragione di `ide_only`: qui non c'è `AppState`, e
    // un chiamante che lo dimenticasse non deve poter restituire un campo
    // sbagliato in silenzio.
    auth_required: bool,
) -> SystemStatus {
    let mut sys = System::new_all();
    sys.refresh_all();
    let disks = Disks::new_with_refreshed_list();
    let disk = disks.list().first();

    let active_project = project_dir
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned());

    // Version-drift detection: read the on-disk project to compare the runtime
    // that saved it against this build. Cheap (a small YAML file) and only when
    // a project is open.
    // Il progetto su disco serve due volte: per la deriva di versione e per gli
    // avvisi. Si carica una volta sola.
    let progetto = project_dir.and_then(|p| sws_core::Project::load(p).ok());
    let (project_saved_by, project_needs_update) = match &progetto {
        Some(p) => (p.saved_by.clone(), p.needs_update()),
        None => (None, false),
    };
    let avvisi = calcola_avvisi(progetto.as_ref(), supervisor);

    let alarms_snap = alarms.snapshot().await;
    let alarm_active_count = alarms_snap.iter().filter(|a| a.active).count();

    let tags = db.snapshot().await;
    let tag_count = tags.len();
    let source_count = supervisor.running_count().await;

    // Somma i campioni di tutti i datastore configurati — prima era hardcoded
    // a 0 (mai calcolato). `all_stats()` è lo stesso metodo già usato da
    // `/api/datastores` per la card di ciascun backend.
    let historian_samples = match registry {
        Some(reg) => reg.all_stats().await.iter().map(|(_, s)| s.sample_count).sum(),
        None => 0,
    };

    SystemStatus {
        runtime_version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_s: started_at.elapsed().as_secs(),
        mode: mode_label(ide_only),
        active_project,
        project_saved_by,
        project_needs_update,
        tag_count,
        source_count,
        sources_running: source_count > 0,
        armed: supervisor.is_armed(),
        avvisi,
        auth_required,
        alarm_active_count,
        historian_samples,
        cpu_usage_pct: sys.global_cpu_info().cpu_usage(),
        mem_used_mb: sys.used_memory() / 1_048_576,
        mem_total_mb: sys.total_memory() / 1_048_576,
        disk_used_gb: disk.map(|d| (d.total_space() - d.available_space()) / 1_073_741_824).unwrap_or(0),
        disk_total_gb: disk.map(|d| d.total_space() / 1_073_741_824).unwrap_or(0),
    }
}

/// Gli avvisi correnti, calcolati dallo stato reale. Vedi [`Avviso`].
fn calcola_avvisi(
    progetto: Option<&sws_core::Project>,
    supervisor: &SourceSupervisor,
) -> Vec<Avviso> {
    let mut out = Vec::new();

    // ── Q33: l'acquisizione è ferma ──────────────────────────────────────────
    //
    // Non è un errore — è una scelta dell'operatore — ma va detto, perché ne
    // consegue una cosa che nessuno si aspetta: un salvataggio delle Sorgenti
    // persiste sul disco e **non** avvia niente. Prima quella conseguenza si
    // poteva solo dedurre dal fatto che il selettore restava su STOP.
    if !supervisor.is_armed() {
        out.push(Avviso {
            gravita: "avviso",
            dove: "acquisizione".into(),
            messaggio: "L'acquisizione è ferma: driver, script globali, notifiche e Telegram \
                        non stanno girando.".into(),
            rimedio: "Un salvataggio viene scritto sul disco ma non fa ripartire niente: \
                      premi RUN quando vuoi rimettere in marcia l'impianto.".into(),
        });
    }

    let Some(p) = progetto else { return out };

    // ── Q34: script globali che non partiranno mai ───────────────────────────
    //
    // Il cron si rilegge con `crate::cron`, cioè **lo stesso** parser che
    // schedula: l'avviso non può dire una cosa e il runtime farne un'altra. È
    // la ragione per cui quel parser vive in un posto solo — prima le regole
    // erano scritte due volte e la copia nel validatore ha mentito per un
    // giorno.
    for gs in &p.global_scripts {
        if !gs.enabled {
            continue; // disabilitato è una scelta, non un difetto.
        }
        let sws_core::ScriptTrigger::Cron { schedule } = &gs.trigger else { continue };
        let (cron, problemi) = crate::cron::analizza(schedule);
        let errori: Vec<&crate::cron::Problema> = problemi
            .iter()
            .filter(|x| x.gravita == crate::cron::Gravita::Errore)
            .collect();
        if cron.is_none() {
            let dettaglio = errori
                .iter()
                .map(|x| x.messaggio.as_str())
                .collect::<Vec<_>>()
                .join("; ");
            out.push(Avviso {
                gravita: "errore",
                dove: format!("script globale «{}»", gs.id),
                messaggio: format!(
                    "Non è schedulato e non partirà mai: il cron `{schedule}` non è \
                     utilizzabile ({dettaglio})."
                ),
                rimedio: errori
                    .first()
                    .map(|x| x.suggerimento.clone())
                    .unwrap_or_else(|| "Correggi l'espressione cron.".into()),
            });
        } else {
            // Gli avvisi del parser (campi mancanti, campi di troppo) non
            // impediscono di partire, ma cambiano *quando*: `30 4` gira ogni
            // giorno di ogni mese, che non è quasi mai ciò che si intendeva.
            for a in problemi.iter().filter(|x| x.gravita == crate::cron::Gravita::Avviso) {
                out.push(Avviso {
                    gravita: "avviso",
                    dove: format!("script globale «{}»", gs.id),
                    messaggio: format!("Il cron `{schedule}` parte, ma forse non quando credi: {}", a.messaggio),
                    rimedio: a.suggerimento.clone(),
                });
            }
        }
    }
    out
}

pub async fn get_system_status(State(state): State<AppState>) -> Json<SystemStatus> {
    let dir_guard = state.project_dir.read().await;
    let registry = state.registry.read().await.clone();
    Json(compute_system_status(
        &state.db,
        &state.alarms,
        &state.supervisor,
        registry.as_deref(),
        dir_guard.as_deref(),
        state.started_at,
        state.ide_only,
        state.auth.has_users().await,
    ).await)
}

/// `POST /api/project/migrate` — re-save the active project in the current
/// runtime's on-disk format, stamping this build's version. Reloading the
/// project through the tolerant deserializer and writing it back normalizes
/// the file and clears the IDE's "needs update" warning. 409 if no project
/// is open.
pub async fn migrate_project(State(s): State<AppState>) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(_) => return (StatusCode::CONFLICT, "no active project").into_response(),
    };
    // Q10: la ri-scrittura passa da patch_project (no-op) e non da un
    // load+save diretto — il giro dal deserializzatore tollerante da solo
    // scarterebbe le sorgenti che questo binario non sa parsare e le chiavi
    // sconosciute, e "normalizzare il formato" non deve mai voler dire
    // "cancellare ciò che una versione più nuova ha scritto".
    let resp = crate::router::patch_project(&s.project_write_lock, &project_dir, |_| {}).await;
    if resp.status().is_success() {
        tracing::info!(
            version = sws_core::project::runtime_version(),
            "project re-saved to current runtime version"
        );
    }
    resp
}

/// `POST /api/system/stop` — stop all sources and script/notification supervisors.
/// The web server and tag DB remain active; the project is still "open".
pub async fn system_stop(State(s): State<AppState>) -> StatusCode {
    // Q33: **prima** si disarma, poi si ferma. L'ordine conta: fra le due
    // istruzioni c'è un `await`, e un salvataggio delle Sorgenti che arrivasse
    // in mezzo troverebbe il supervisore ancora armato e ripartirebbe.
    s.supervisor.set_armed(false);
    s.supervisor.reload(vec![]).await;
    if let Some(sc) = s.script_supervisor.write().await.take() {
        sc.stop();
    }
    if let Some(ns) = s.notification_supervisor.write().await.take() {
        ns.stop();
    }
    crate::telegram::stop_sender(&s).await;
    tracing::info!("runtime acquisition stopped by operator");
    StatusCode::NO_CONTENT
}

/// `POST /api/system/start` — reload sources + script supervisor from the
/// current project on disk. No-op if no project is active.
pub async fn system_start(State(s): State<AppState>) -> StatusCode {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    let mut project = match sws_core::Project::load(&project_dir) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("system_start: project load failed: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    };
    crate::projects::resolve_mqtt_client_ids(&project.meta.name, &mut project.sources, &s.config_dir, &s.instance_id);
    // Q33: si arma **qui** — dopo che il progetto si è caricato, e prima del
    // reload, che altrimenti rifiuterebbe di avviare le sorgenti che gli stiamo
    // passando. Non in testa alla funzione: i due `return` sopra la
    // lascerebbero armata con niente in marcia, e l'indicatore direbbe «in
    // marcia» a impianto fermo — cioè lo stesso genere di bugia che questa
    // correzione esiste per togliere.
    //
    // Questo e `system_stop` sono i soli punti autorizzati a cambiare quel
    // flag: è l'intenzione dell'operatore, non l'effetto di un salvataggio.
    s.supervisor.set_armed(true);
    s.supervisor.reload(project.sources).await;
    crate::projects::start_project_services(&s, project.notifications, project.global_scripts).await;
    tracing::info!("runtime acquisition started by operator");
    StatusCode::NO_CONTENT
}

/// `POST /api/system/reboot` — gracefully replaces the current process with a
/// fresh instance of the same binary and args (Unix `exec`). All WebSocket
/// clients disconnect and reconnect after the new instance is up (~1-2s).
///
/// Before exec, persists the current project path to `{projects_root}/.last-opened`
/// so the new instance can auto-reopen the same project (handled in main.rs).
pub async fn system_reboot(State(s): State<AppState>) -> StatusCode {
    // Snapshot state before the async block moves ownership.
    let projects_root = (*s.projects_root).clone();
    let project_dir   = s.project_dir.read().await.clone();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;

        // Persist the currently-open project so the fresh process can reopen it.
        if let Some(dir) = &project_dir {
            let marker = projects_root.join(".last-opened");
            if let Err(e) = std::fs::write(&marker, dir.to_string_lossy().as_bytes()) {
                tracing::warn!("reboot: could not write .last-opened: {e}");
            }
        }

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let exe = match std::env::current_exe() {
                Ok(e) => e,
                Err(e) => {
                    tracing::error!("reboot: current_exe: {e}");
                    std::process::exit(1);
                }
            };
            let args: Vec<_> = std::env::args_os().skip(1).collect();
            let err = std::process::Command::new(&exe).args(&args).exec();
            tracing::error!("reboot: exec failed: {err}");
        }
        std::process::exit(0);
    });
    tracing::info!("runtime reboot requested");
    StatusCode::NO_CONTENT
}

// ── TLS management endpoints ─────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TlsStatus {
    pub enabled: bool,
}

/// `GET /api/system/tls` — returns whether TLS is currently active.
pub async fn get_tls_status(State(s): State<AppState>) -> Json<TlsStatus> {
    let enabled = s.config_dir.join("tls.crt").exists();
    Json(TlsStatus { enabled })
}

/// `POST /api/system/tls/generate` — generate a self-signed cert, write to config dir,
/// then reboot so the new TLS config takes effect.
pub async fn generate_tls_cert(State(s): State<AppState>) -> StatusCode {
    let config_dir = (*s.config_dir).clone();
    match tokio::task::spawn_blocking(move || generate_cert_files(&config_dir)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            tracing::error!("generate_tls_cert: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
        Err(e) => {
            tracing::error!("generate_tls_cert: join error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    }
    tracing::info!("TLS certificate generated — rebooting to activate HTTPS");
    system_reboot(State(s)).await
}

/// `DELETE /api/system/tls` — remove the TLS cert files and reboot into plain HTTP.
pub async fn remove_tls_cert(State(s): State<AppState>) -> StatusCode {
    let cert_path = s.config_dir.join("tls.crt");
    let key_path  = s.config_dir.join("tls.key");
    for path in [&cert_path, &key_path] {
        if path.exists() {
            if let Err(e) = tokio::fs::remove_file(path).await {
                tracing::error!("remove_tls_cert: could not remove {}: {e}", path.display());
                return StatusCode::INTERNAL_SERVER_ERROR;
            }
        }
    }
    tracing::info!("TLS certificate removed — rebooting to plain HTTP");
    system_reboot(State(s)).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct TlsUpload {
    pub cert_pem: String,
    pub key_pem: String,
}

/// `PUT /api/system/tls` — upload a user-provided certificate + private key (PEM),
/// validate that they parse and match, write them to the config dir, then reboot
/// so the new cert takes effect (HTTPS). Rejects invalid input before writing so
/// the user gets immediate feedback instead of a silent self-signed regeneration.
pub async fn upload_tls_cert(State(s): State<AppState>, Json(body): Json<TlsUpload>) -> Response {
    if let Err(e) = validate_cert_key(&body.cert_pem, &body.key_pem) {
        tracing::warn!("upload_tls_cert: invalid cert/key: {e:#}");
        return (
            StatusCode::BAD_REQUEST,
            format!("Certificato/chiave non validi: {e}"),
        )
            .into_response();
    }

    let config_dir = (*s.config_dir).clone();
    let cert = body.cert_pem;
    let key = body.key_pem;
    let write = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        use anyhow::Context;
        std::fs::create_dir_all(&config_dir).context("creating config directory")?;
        std::fs::write(config_dir.join("tls.crt"), cert.as_bytes()).context("writing tls.crt")?;
        std::fs::write(config_dir.join("tls.key"), key.as_bytes()).context("writing tls.key")?;
        Ok(())
    })
    .await;
    match write {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            tracing::error!("upload_tls_cert: write failed: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        Err(e) => {
            tracing::error!("upload_tls_cert: join error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    tracing::info!("TLS certificate uploaded — rebooting to activate HTTPS");
    system_reboot(State(s)).await.into_response()
}

/// Parse a PEM cert chain + private key and confirm they form a valid TLS
/// keypair (mirrors the runtime's startup loader). `with_single_cert` also
/// catches a key that does not match the certificate.
fn validate_cert_key(cert_pem: &str, key_pem: &str) -> anyhow::Result<()> {
    use anyhow::Context;
    let certs: Vec<rustls::pki_types::CertificateDer<'static>> =
        rustls_pemfile::certs(&mut cert_pem.as_bytes())
            .collect::<Result<_, _>>()
            .context("parsing certificate PEM")?;
    anyhow::ensure!(!certs.is_empty(), "nessun certificato trovato nel PEM");
    let key = rustls_pemfile::private_key(&mut key_pem.as_bytes())
        .context("parsing private key PEM")?
        .ok_or_else(|| anyhow::anyhow!("nessuna chiave privata trovata nel PEM"))?;
    rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("la chiave privata non corrisponde al certificato")?;
    Ok(())
}

fn generate_cert_files(config_dir: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::Context;

    std::fs::create_dir_all(config_dir).context("creating config directory")?;

    // Detect LAN IP via connected UDP socket (no packets sent).
    let lan_ip: Option<IpAddr> = (|| {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        sock.connect("8.8.8.8:80").ok()?;
        sock.local_addr().ok().map(|a| a.ip())
    })();

    let mut params = CertificateParams::new(vec!["localhost".to_string()])
        .context("rcgen: CertificateParams::new")?;
    params.subject_alt_names.push(SanType::IpAddress(
        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
    ));
    if let Some(ip) = lan_ip {
        params.subject_alt_names.push(SanType::IpAddress(ip));
        tracing::info!(%ip, "TLS cert will include LAN IP SAN");
    }

    let key_pair = KeyPair::generate().context("rcgen: KeyPair::generate")?;
    let cert = params.self_signed(&key_pair).context("rcgen: self_signed")?;

    std::fs::write(config_dir.join("tls.crt"), cert.pem()).context("writing tls.crt")?;
    std::fs::write(config_dir.join("tls.key"), key_pair.serialize_pem()).context("writing tls.key")?;
    tracing::info!(path = %config_dir.display(), "self-signed TLS certificate saved");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use sws_core::{AlarmCondition, AlarmDb, AlarmDef, AlarmSeverity, TagDb, TagQuality, TagState, TagValue};
    use sws_core::TagWriteBus;

    fn make_supervisor() -> std::sync::Arc<crate::source_supervisor::SourceSupervisor> {
        let db = std::sync::Arc::new(TagDb::new(64));
        let bus = std::sync::Arc::new(TagWriteBus::new());
        crate::source_supervisor::SourceSupervisor::new(db, bus)
    }

    #[tokio::test]
    async fn compute_system_status_reflects_inputs() {
        let db = TagDb::new(64);
        db.set("t1".into(), TagValue::Float(1.0), TagQuality::Good).await;
        db.set("t2".into(), TagValue::Float(2.0), TagQuality::Good).await;
        db.set("t3".into(), TagValue::Bool(true), TagQuality::Good).await;

        let alarms = AlarmDb::new(64);
        alarms.load(vec![]).await;

        let supervisor = make_supervisor();
        let started = Instant::now() - std::time::Duration::from_secs(5);
        let project_path = PathBuf::from("/tmp/demo-project");

        let status = compute_system_status(&db, &alarms, &supervisor, None, Some(&project_path), started, false, false).await;

        assert_eq!(status.tag_count, 3);
        assert_eq!(status.active_project.as_deref(), Some("demo-project"));
        assert!(status.uptime_s >= 5);
        assert!(!status.runtime_version.is_empty());
        assert!(status.mem_total_mb > 0);
        assert_eq!(status.source_count, 0);
        assert!(!status.sources_running);
    }

    #[tokio::test]
    async fn compute_system_status_no_project_is_none() {
        let db = TagDb::new(64);
        let alarms = AlarmDb::new(64);
        alarms.load(vec![]).await;
        let supervisor = make_supervisor();
        let status = compute_system_status(&db, &alarms, &supervisor, None, None, Instant::now(), false, false).await;
        assert!(status.active_project.is_none());
        assert_eq!(status.tag_count, 0);
        assert_eq!(status.alarm_active_count, 0);
    }

    /// Il campo `mode` deve seguire `ide_only`, e va provato in **entrambi** i
    /// versi.
    ///
    /// Il verso che conta è il secondo: un'istanza che serve un impianto e si
    /// dichiara `"ide"` farebbe sparire l'avviso proprio dove serve, e sarebbe
    /// un difetto invisibile — la UI mostrerebbe con sicurezza la cosa
    /// sbagliata. Per questo l'asserzione non è solo «non è vuoto».
    #[tokio::test]
    async fn mode_segue_ide_only_nei_due_versi() {
        let db = TagDb::new(64);
        let alarms = AlarmDb::new(64);
        alarms.load(vec![]).await;
        let supervisor = make_supervisor();

        let ide = compute_system_status(
            &db, &alarms, &supervisor, None, None, Instant::now(), true, false).await;
        assert_eq!(ide.mode, "ide", "senza viewer l'istanza è un IDE");

        let runtime = compute_system_status(
            &db, &alarms, &supervisor, None, None, Instant::now(), false, false).await;
        assert_eq!(runtime.mode, "runtime", "con un viewer l'istanza serve un impianto");

        // Le due stringhe sono un contratto con la SPA: se cambiano qui senza
        // cambiare là, il badge non si accende più e nessun test lo nota.
        assert_eq!(mode_label(true), "ide");
        assert_eq!(mode_label(false), "runtime");
    }

    #[tokio::test]
    async fn alarm_active_count_includes_only_active() {
        let db = TagDb::new(64);
        db.set("temp".into(), TagValue::Float(100.0), TagQuality::Good).await;

        let alarms = AlarmDb::new(64);
        alarms.load(vec![AlarmDef {
            id: "hi".into(),
            tag: "temp".into(),
            condition: AlarmCondition::Above { threshold: 50.0 },
            severity: AlarmSeverity::Warning,
            message: "too hot".into(),
            notify_url: None,
            dead_band: None,
            on_delay_s: None,
            off_delay_s: None,
            inhibit_tag: None,
            inhibit_condition: None,
            notify_email: None,
            escalate_after_s: None,
            escalate_to: None,
            telegram_mode: None,
            telegram_chat_ids: None,
        }]).await;

        let state = TagState {
            value: TagValue::Float(100.0),
            quality: TagQuality::Good,
            timestamp_ms: 0,
        };
        alarms.evaluate("temp", &state).await;

        let supervisor = make_supervisor();
        let status = compute_system_status(&db, &alarms, &supervisor, None, None, Instant::now(), false, false).await;
        assert_eq!(status.alarm_active_count, 1);
    }

    /// Generate a fresh self-signed cert+key PEM pair for validation tests.
    /// Also installs the ring CryptoProvider (the runtime does this in `main()`;
    /// the test process must do it before `ServerConfig::builder()` is used).
    fn make_cert_key() -> (String, String) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let key = KeyPair::generate().unwrap();
        let params = CertificateParams::new(vec!["localhost".to_string()]).unwrap();
        let cert = params.self_signed(&key).unwrap();
        (cert.pem(), key.serialize_pem())
    }

    #[test]
    fn validate_cert_key_accepts_matching_pair() {
        let (cert, key) = make_cert_key();
        assert!(validate_cert_key(&cert, &key).is_ok());
    }

    #[test]
    fn validate_cert_key_rejects_garbage() {
        assert!(validate_cert_key("not a cert", "not a key").is_err());
        let (cert, _) = make_cert_key();
        assert!(validate_cert_key(&cert, "").is_err(), "missing key must fail");
    }

    #[test]
    fn validate_cert_key_rejects_mismatched_key() {
        let (cert, _) = make_cert_key();
        let (_, other_key) = make_cert_key();
        // A valid cert and a valid key, but from different keypairs → must be rejected.
        assert!(validate_cert_key(&cert, &other_key).is_err());
    }
}

/// Gli avvisi: il runtime dice quando non sta facendo quello che si crede.
#[cfg(test)]
mod tests_avvisi {
    use super::*;

    fn supervisore() -> std::sync::Arc<SourceSupervisor> {
        SourceSupervisor::new(
            std::sync::Arc::new(TagDb::new(16)),
            std::sync::Arc::new(sws_core::TagWriteBus::new()),
        )
    }

    fn progetto(script_yaml: &str) -> sws_core::Project {
        serde_yaml::from_str(&format!(
            "meta:\n  name: p\n  version: \"1\"\nglobal_scripts:\n{script_yaml}"
        ))
        .expect("progetto di prova valido")
    }

    #[tokio::test]
    async fn niente_da_dire_niente_avvisi() {
        let s = supervisore();
        assert!(calcola_avvisi(None, &s).is_empty());
    }

    /// Q33: a impianto fermo l'avviso deve nominare la conseguenza che nessuno
    /// si aspetta — il salvataggio persiste e non avvia.
    #[tokio::test]
    async fn acquisizione_ferma_lo_dice_e_dice_cosa_ne_consegue() {
        let s = supervisore();
        s.set_armed(false);
        let a = calcola_avvisi(None, &s);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].dove, "acquisizione");
        assert!(a[0].rimedio.contains("RUN"), "manca il rimedio: {:?}", a[0]);
        assert!(
            a[0].rimedio.contains("non fa ripartire"),
            "l'avviso deve dire che un salvataggio non avvia: {:?}", a[0]
        );
    }

    /// **Il test di Q34 lato UI.** Un cron illeggibile deve comparire fra gli
    /// avvisi, dire che lo script non partirà mai, e portare il rimedio.
    #[tokio::test]
    async fn un_cron_illeggibile_diventa_un_avviso() {
        let p = progetto("  - { id: rotto, trigger: { kind: cron, schedule: \"*/0 pippo * * *\" }, code: \"x = 1\" }\n");
        let a = calcola_avvisi(Some(&p), &supervisore());
        assert_eq!(a.len(), 1, "{a:?}");
        assert_eq!(a[0].gravita, "errore");
        assert!(a[0].dove.contains("rotto"));
        assert!(a[0].messaggio.contains("non partirà mai"), "{:?}", a[0]);
        assert!(!a[0].rimedio.is_empty());
    }

    /// Il verso opposto, che è quello che si dimentica: un cron **valido** non
    /// deve produrre nessun avviso. Un indicatore che si accende sul buono
    /// insegna a ignorarlo.
    #[tokio::test]
    async fn un_cron_valido_non_avvisa() {
        let p = progetto("  - { id: ok, trigger: { kind: cron, schedule: \"*/5 * * * *\" }, code: \"x = 1\" }\n");
        assert!(calcola_avvisi(Some(&p), &supervisore()).is_empty());
    }

    /// Un cron corto parte, ma non quando si crede: è un avviso, non un errore.
    #[tokio::test]
    async fn un_cron_corto_avvisa_senza_essere_un_errore() {
        let p = progetto("  - { id: corto, trigger: { kind: cron, schedule: \"30 4\" }, code: \"x = 1\" }\n");
        let a = calcola_avvisi(Some(&p), &supervisore());
        assert_eq!(a.len(), 1, "{a:?}");
        assert_eq!(a[0].gravita, "avviso");
        assert!(a[0].messaggio.contains("non quando credi"), "{:?}", a[0]);
    }

    /// Uno script disabilitato non è un difetto: è una scelta. Avvisare su
    /// quello riempirebbe l'elenco di cose volute.
    #[tokio::test]
    async fn uno_script_disabilitato_non_avvisa() {
        let p = progetto("  - { id: spento, enabled: false, trigger: { kind: cron, schedule: \"*/0 x * * *\" }, code: \"x = 1\" }\n");
        assert!(calcola_avvisi(Some(&p), &supervisore()).is_empty());
    }

    /// E i trigger che non sono cron non hanno un'espressione da leggere.
    #[tokio::test]
    async fn un_trigger_non_cron_non_avvisa() {
        let p = progetto("  - { id: a_intervallo, trigger: { kind: interval, interval_s: 5 }, code: \"x = 1\" }\n");
        assert!(calcola_avvisi(Some(&p), &supervisore()).is_empty());
    }
}
