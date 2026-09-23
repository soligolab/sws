use crate::global_scripts::GlobalScriptSupervisor;
use crate::notifications::NotificationSupervisor;
use crate::recipe::{RecipeApplyEvent, RecipeDef};
use crate::source_supervisor::SourceSupervisor;
use crate::synoptic::{safe_filename, FaceplateDef, SynopticPage};
use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Extension, Path, Query, Request, State,
    },
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Cursor, Read, Write},
    path::PathBuf,
    sync::Arc,
};
use sws_auth::{AuthState, Credentials, LoginError, Role};
use sws_core::{
    AlarmDb, AlarmDef, AlarmEvent, AlarmState, CustomSymbol, FunctionDef, GlobalScriptDef,
    LanguageTable, LogBus, LogEvent, Membro, NotificationConfig, PageLayoutConfig, Project,
    ProjectMeta, SourceDef, TagDb, TagDef, TagId, TagQuality, TagState, TagUpdate, TagValue,
    TagWriteBus, TypeDef, WriteError, MAX_FUNCTION_CODE_BYTES,
};
use sws_historian::{DatastoreRegistry, Historian, Sample};
use sws_pyscript::{Engine as PyEngine, ExecOutput};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

/// Resolved function registry keyed by name. Hot-swapped on every
/// `PUT /api/project/functions` so the run endpoint always sees the
/// latest body without a restart.
pub type FunctionsRegistry = Arc<RwLock<HashMap<String, FunctionDef>>>;

/// Hot-swappable datastore registry. Replaced on every `open_project` so
/// the historian connects to the new project's backends without a restart.
pub type RegistryCell = Arc<RwLock<Option<Arc<DatastoreRegistry>>>>;

/// List of `(tag_id, expression)` pairs for derived/calculated tags.
/// Updated whenever the project's tag list changes; read by the derived-tag
/// evaluator task that runs in the runtime.
pub type DerivedTagsRegistry = Arc<RwLock<Vec<(String, String)>>>;

/// List of `(tag_id, GeneratorSpec)` pairs for native waveform tags (T-69
/// Fase D). Updated whenever the project's tag list changes; read by the
/// fixed-tick generator supervisor that runs in the runtime — sibling of
/// `DerivedTagsRegistry` but time-driven instead of event-driven.
pub type GeneratorTagsRegistry = Arc<RwLock<Vec<(String, sws_core::GeneratorSpec)>>>;

/// Mutable handle on the currently-active project directory. `None` means
/// "no project open" — handlers that need a project dir gate on this and
/// return 503. Wrapped in RwLock so `open`/`close` can swap it in-place
/// without rebuilding the whole AppState.
pub type ActiveProjectDir = Arc<RwLock<Option<PathBuf>>>;

/// Swappable handle for the global-script supervisor. `None` = no project open
/// or project has no global_scripts.
pub type ScriptSupervisorCell = Arc<RwLock<Option<GlobalScriptSupervisor>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<TagDb>,
    pub bus: Arc<TagWriteBus>,
    pub alarms: Arc<AlarmDb>,
    pub historian: Arc<Historian>,
    /// Multi-backend datastore registry. Hot-swapped on every `open_project`.
    /// `None` when no project is open or the project has no `datastores`.
    pub registry: RegistryCell,
    pub py: PyEngine,
    pub auth: Arc<AuthState>,
    pub supervisor: Arc<SourceSupervisor>,
    pub script_supervisor: ScriptSupervisorCell,
    /// Contatore che avanza a ogni modifica del PROGETTO (non dei tag): import,
    /// apertura, ripristino di un backup, salvataggio di un sinottico.
    ///
    /// Serve al viewer LVGL, che scarica la pagina una volta sola e non si
    /// accorgerebbe mai di una modifica — si finiva a guardare una pagina
    /// vecchia credendola nuova, e una volta è costato una diagnosi sbagliata
    /// (OPEN_QUESTIONS Q20). `/ws/tags` inoltra un messaggio
    /// `{"type":"project_changed"}` a ogni avanzamento e il viewer si ridisegna.
    ///
    /// `watch` e non `broadcast`: qui interessa solo "è cambiato qualcosa da
    /// quando guardavo", non ricevere ogni singolo evento. Un `watch` non può
    /// restare indietro, e perdere eventi intermedi è esattamente ciò che si
    /// vuole quando la reazione è "ricarica tutto".
    /// Questa istanza è un IDE senza viewer (`--viewer-port` non passato,
    /// cioè `start_editor.sh`). Serve a **negare l'esistenza** di funzioni che
    /// hanno senso solo sul PC di sviluppo: la configurazione dell'assistente
    /// IA vive qui, e su un runtime che serve un impianto non deve esserci.
    /// La decisione la prende `main.rs`, che è l'unico posto a sapere se il
    /// listener del viewer è stato aperto.
    pub ide_only: bool,
    pub project_epoch: Arc<tokio::sync::watch::Sender<u64>>,
    pub functions: FunctionsRegistry,
    pub derived_tags: DerivedTagsRegistry,
    pub generator_tags: GeneratorTagsRegistry,
    pub project_dir: ActiveProjectDir,
    pub projects_root: Arc<PathBuf>,
    pub templates_root: Arc<PathBuf>,
    pub logs: Arc<LogBus>,
    pub logs_dir: Arc<PathBuf>,
    pub started_at: std::time::Instant,
    /// Parsed CIDR entries from `SWS_IP_ALLOWLIST`. Empty = no restriction.
    pub ip_allowlist: Arc<Vec<(std::net::IpAddr, u8)>>,
    /// In-memory log of recipe apply events. Cleared on project open/close.
    pub recipe_log: Arc<RwLock<Vec<RecipeApplyEvent>>>,
    /// Active notification supervisor (email + escalation). Replaced on project open.
    pub notification_supervisor: Arc<RwLock<Option<NotificationSupervisor>>>,
    /// Active Telegram sender (drains the shared message channel). `None` when
    /// no Telegram channel is configured. Its `sender()` is shared by the alarm
    /// supervisor and the script `send_telegram` binding. Replaced on project open.
    pub telegram_sender: Arc<RwLock<Option<crate::telegram::TelegramSender>>>,
    /// Runtime config directory (where tls.crt/tls.key live). Used by TLS management endpoints.
    pub config_dir: Arc<PathBuf>,
    /// Q49: le impronte dei certificati dei dispositivi già visti (`known_hosts` per TLS).
    pub certificati: Arc<crate::certificati::ImprontaStore>,
    /// Path to the TLS certificate PEM for `GET /cert` (browser import).
    /// `None` when running in plain HTTP mode (no TLS configured).
    pub cert_path: Option<Arc<PathBuf>>,
    /// True while scripts/package.sh is running. Prevents concurrent builds.
    pub build_running: crate::packaging::BuildLock,
    /// Repository root (where scripts/package.sh lives). None on deployed instances.
    pub repo_root: crate::packaging::RepoRoot,
    /// Currently-connected remote runtime target (set by POST /api/remote/connect).
    /// `None` when no remote is connected. Used by the WS relay handlers.
    pub remote_target: Arc<RwLock<Option<crate::remote::RemoteTarget>>>,
    /// Append-only, hash-chained audit log (OPEN_QUESTIONS Q8). One process-wide
    /// log spanning project open/close — not reset on project switch, so the
    /// trail of "who did what" survives across projects.
    pub audit: Arc<sws_audit::AuditLog>,
    /// Known-projects registry (name -> path + last_opened_ms), touched on every
    /// create/open. Backs the "recent projects" list and lets projects live
    /// outside `projects_root` (custom parent path chosen at creation).
    pub known_projects: Arc<crate::project_registry::ProjectRegistry>,
    /// Short id unique to this runtime instance, persisted in
    /// `config_dir/instance_id`. Used to derive collision-free MQTT client
    /// ids when a source has `random_client_id` enabled (see
    /// `resolve_mqtt_client_ids` in `projects.rs`).
    pub instance_id: Arc<String>,
    /// Serializza open/close/delete/upload di progetto. Due `open_project`
    /// concorrenti (deploy arrivato doppio, 2026-08-21) passavano entrambi
    /// da `reload(vec![])` a mappa vuota e avviavano 4 task MQTT per 2
    /// sorgenti: il secondo `insert` orfanava i primi due, che restavano
    /// connessi al broker con gli stessi client id — takeover infinito.
    pub project_switch_lock: Arc<tokio::sync::Mutex<()>>,
    /// Un solo deploy remoto alla volta: il 2026-08-21 la sequenza
    /// delete+upload+open è arrivata DUE volte a 1 ms di distanza sul target
    /// (vedi `project_switch_lock`). `try_lock` → 409 se già in corso.
    pub deploy_lock: Arc<tokio::sync::Mutex<()>>,
    /// Serializza ogni **leggi-modifica-scrivi** su `project.yaml` (Q30).
    ///
    /// Tutte le scritture su quel file rileggono, deserializzano, modificano e
    /// riscrivono. Senza lock due scritture in volo insieme partono dallo
    /// stesso file e l'ultima cancella la modifica dell'altra — senza errore,
    /// senza avviso, col salvataggio che riesce. Misurato in un browser il
    /// 2026-08-31: una proposta dell'assistente che creava un tag **e** una
    /// sorgente; dopo Salva sul disco c'era la sorgente e non il tag.
    ///
    /// **È sempre il lock più interno.** Due percorsi lo prendono tenendo già
    /// `project_switch_lock` (`open_project` → `migrate_legacy_project_dirs`,
    /// `upload_project_zip`); nessuno fa il contrario, e nessuno deve farlo.
    ///
    /// `tokio::sync::Mutex` **non è rientrante**: chi lo tiene non può chiamare
    /// `patch_project`, che se lo prende da sé. È la trappola in cui cade il
    /// prossimo che aggiunge un percorso di scrittura — si manifesta come un
    /// handler che non risponde più, non come un errore.
    ///
    /// Uno solo per tutte le directory di progetto, deliberatamente: nel PoC un
    /// processo serve un progetto alla volta, e serializzare due progetti
    /// diversi non costa niente di percepibile.
    pub project_write_lock: Arc<tokio::sync::Mutex<()>>,
}

/// F3.1: la scrittura di `tag` è consentita a `role`? La mappa per-tag vive
/// in TagDb (riempita con lo scaling a open/import/PUT-tags); un tag senza
/// `write_min_role` segue la regola storica (Operator+).
pub(crate) async fn tag_write_allowed(
    db: &sws_core::TagDb,
    tag: &str,
    role: sws_auth::Role,
) -> bool {
    let min = match db.write_role_of(tag).await.as_deref() {
        Some("Viewer") => sws_auth::Role::Viewer,
        Some("Supervisor") => sws_auth::Role::Supervisor,
        Some("Admin") => sws_auth::Role::Admin,
        Some(_) | None => sws_auth::Role::Operator,
    };
    role >= min
}

/// Resolve the active project directory or return 503. Used at the top
/// of every handler that needs a project dir (most of them).
pub async fn active_dir(state: &AppState) -> Result<PathBuf, StatusCode> {
    state
        .project_dir
        .read()
        .await
        .clone()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)
}

// 26 argomenti: e' il vero odore di questo file, da rifare con una struct di configurazione (referto 2026-09-09).
#[allow(clippy::too_many_arguments)]
pub fn build(
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    alarms: Arc<AlarmDb>,
    historian: Arc<Historian>,
    registry: RegistryCell,
    py: PyEngine,
    auth: Arc<AuthState>,
    supervisor: Arc<SourceSupervisor>,
    script_supervisor: ScriptSupervisorCell,
    functions: FunctionsRegistry,
    derived_tags: DerivedTagsRegistry,
    generator_tags: GeneratorTagsRegistry,
    project_dir: ActiveProjectDir,
    projects_root: Arc<PathBuf>,
    templates_root: Arc<PathBuf>,
    logs: Arc<LogBus>,
    logs_dir: Arc<PathBuf>,
    started_at: std::time::Instant,
    ip_allowlist: Arc<Vec<(std::net::IpAddr, u8)>>,
    config_dir: Arc<PathBuf>,
    cert_path: Option<Arc<PathBuf>>,
    www_dir: Option<PathBuf>,
    // Operator-only hardening (--no-admin): la porta admin porta solo la gestione
    // remota e il viewer non serve la SPA dell'IDE. Vedi `deploy_only_app`.
    lockdown: bool,
    // Istanza IDE-only (nessun `--viewer-port`): vedi `AppState::ide_only`.
    ide_only: bool,
    audit: Arc<sws_audit::AuditLog>,
    known_projects: Arc<crate::project_registry::ProjectRegistry>,
    instance_id: Arc<String>,
    // Lo `AppState` torna al chiamante insieme ai due router: `main.rs` deve
    // avviare i servizi del progetto auto-aperto al boot (notifiche, script
    // globali) e quei supervisori vivono qui dentro.
) -> (Router, Router, AppState) {
    // Canale di notifica "il progetto è cambiato" (Q20). Creato qui e non
    // passato dall'esterno: nessun chiamante di `build()` ha motivo di
    // conoscerlo, e chi deve segnalare usa `signal_project_changed(&state, …)`.
    let (project_epoch, _) = tokio::sync::watch::channel(0u64);
    let project_epoch = Arc::new(project_epoch);

    // Q49: l'archivio delle impronte vive accanto alla configurazione, come known_hosts.
    let certificati = Arc::new(crate::certificati::store_dispositivi(&config_dir));
    let state = AppState {
        db,
        bus,
        alarms,
        historian,
        registry,
        py,
        auth,
        supervisor,
        script_supervisor,
        ide_only,
        project_epoch,
        functions,
        derived_tags,
        generator_tags,
        project_dir,
        projects_root,
        templates_root,
        logs,
        logs_dir,
        started_at,
        ip_allowlist,
        recipe_log: Arc::new(RwLock::new(Vec::new())),
        notification_supervisor: Arc::new(RwLock::new(None)),
        telegram_sender: Arc::new(RwLock::new(None)),
        config_dir,
        cert_path,
        build_running: crate::packaging::new_build_lock(),
        repo_root: crate::packaging::new_repo_root(),
        remote_target: Arc::new(RwLock::new(None)),
        certificati,
        audit,
        known_projects,
        instance_id,
        project_switch_lock: Arc::new(tokio::sync::Mutex::new(())),
        deploy_lock: Arc::new(tokio::sync::Mutex::new(())),
        project_write_lock: Arc::new(tokio::sync::Mutex::new(())),
    };
    // Build the runtime router (8443) before consuming state for admin.
    let runtime_app = build_runtime_inner(state.clone(), www_dir.clone());

    // Routes that need Admin privileges (PUT /api/project/* — schema edits,
    // plus the multi-user CRUD).
    let admin_routes = Router::new()
        .route("/api/project/tags", put(update_project_tags))
        .route("/api/project/types", put(update_project_types))
        .route("/api/project/tags/import-csv", post(import_tags_csv))
        .route("/api/project/languages", put(update_project_languages))
        // Traduzione automatica della tabella lingue. **Solo IDE**: tradurre è
        // progettazione, il dispositivo in campo è spesso senza Internet (Q43,
        // punto 5), e il gate sta dentro l'handler come per `/api/ai/config`.
        .route(
            "/api/project/languages/translate",
            post(crate::traduttore::traduci_progetto),
        )
        .route("/api/project/sources", put(update_project_sources))
        .route("/api/project/alarms", put(update_project_alarms))
        .route("/api/project/functions", put(update_project_functions))
        .route(
            "/api/project/custom-symbols",
            put(update_project_custom_symbols),
        )
        .route("/api/project/datastores", put(update_project_datastores))
        .route(
            "/api/project/global-scripts",
            put(update_project_global_scripts),
        )
        .route(
            "/api/project/notifications",
            put(update_project_notifications),
        )
        .route("/api/project/page-layout", put(update_project_page_layout))
        // T-58 — il motore di rendering del progetto. Fino all'11-09-2026 si
        // sceglieva solo alla creazione e poi si cambiava editando
        // `project.yaml` a mano, con una trappola: il runtime riscrive il file
        // **dalla memoria** al primo salvataggio, quindi la modifica fatta a
        // progetto aperto spariva. Passando di qui il progetto in memoria si
        // aggiorna, e `display_target::publish` riscrive `display-target` da sé.
        .route("/api/project/target", put(update_project_target))
        .route(
            "/api/project/backup-config",
            put(update_project_backup_config),
        )
        .route("/api/notifications/test-telegram", post(test_telegram))
        .route(
            "/api/notifications/telegram-bot",
            post(telegram_bot_identity),
        )
        .route(
            "/api/notifications/telegram-chats",
            post(detect_telegram_chats),
        )
        .route("/api/project/rollback", post(trigger_rollback))
        // Bulk project export/import (single ZIP carrying project.yaml +
        // every synoptic). Destructive on the import side — Admin only.
        .route("/api/project/export", get(export_project_zip))
        .route(
            "/api/project/import",
            put(import_project_zip).layer(DefaultBodyLimit::max(LIMITE_CORPO_UPLOAD)),
        )
        // Backup management (admin-only; restore is destructive).
        .route(
            "/api/backups",
            get(crate::backups::list_backups_handler).post(crate::backups::create_backup_handler),
        )
        .route(
            "/api/backups/:name",
            delete(crate::backups::delete_backup_handler),
        )
        .route(
            "/api/backups/:name/restore",
            post(crate::backups::restore_backup_handler),
        )
        .route(
            "/api/backups/:name/download",
            get(crate::backups::download_backup_handler),
        )
        .route("/api/auth/users", get(list_users).post(create_user))
        // Lato ricevente di "Aggiorna utenti sul dispositivo".
        .route(
            "/api/auth/users-file",
            put(crate::projects::replace_users_file),
        )
        // Lato ricevente di "Invia Client ID al dispositivo connesso" —
        // override per-device del client_id MQTT, esterno a project.yaml.
        .route(
            "/api/mqtt/source/:id/client-id-override",
            put(crate::projects::set_mqtt_client_id_override),
        )
        .route(
            "/api/auth/users/:username",
            axum::routing::put(update_user).delete(delete_user),
        )
        // Git push: push to default remote/branch. Admin-only (risk of exposing credentials).
        .route("/api/project/git/push", post(git_push))
        // Aggancia il progetto a un repository (init + set/replace origin) — stessa
        // classe di rischio del push (configura dove finiscono commit/tag).
        .route("/api/project/git/init", post(git_init))
        // Push/elimina un tag — stessa classe di rischio di push/rollback.
        .route("/api/project/git/tags/:name/push", post(push_git_tag))
        .route("/api/project/git/tags/:name", delete(delete_git_tag))
        // T-28: local package build + SSH device deploy.
        .route("/api/build/package", post(crate::packaging::build_package))
        .route("/api/build/packages", get(crate::packaging::list_packages))
        // Q51: dice all'editor se gira da un checkout (`repo_root`). Con `false`
        // l'editor nasconde build e deploy binario, che senza repo falliscono
        // sempre. Non sta in `deploy_only_app`: un dispositivo non ha repo.
        .route("/api/build/stato", get(crate::packaging::stato_build))
        .route("/api/deploy/device", post(crate::packaging::deploy_device))
        // Container install via SSH — stesso deploy del binario nudo sopra,
        // ma installa il runtime come container Podman rootless (nessun sudo).
        .route(
            "/api/build/container-packages",
            get(crate::packaging::list_container_packages),
        )
        .route(
            "/api/deploy/device-container",
            post(crate::packaging::deploy_device_container),
        )
        // Toglie dal known_hosts di questo PC le chiavi di un dispositivo che
        // ha cambiato identità (factory reset). Mai automatico: ci si arriva
        // solo dal pulsante che compare quando il deploy si ferma per questo.
        .route(
            "/api/device/hostkey/forget",
            post(crate::packaging::dimentica_chiave_host),
        )
        // Q49: gemello per il certificato TLS del dispositivo.
        .route(
            "/api/device/cert/forget",
            post(crate::remote::dimentica_certificato),
        )
        // Q52: sonda il dispositivo via ssh PRIMA di installare (podman, subuid,
        // linger, spazio, architettura → variante immagine). La password è solo
        // in transito: mai salvata, mai nell'audit.
        .route("/api/device/probe", post(crate::sonda::sonda_dispositivo))
        // Q52: tabella dei dispositivi in rete (ssh/sftp/workstation/sws), non
        // solo runtime SWS. Admin perché serve a installare; `/api/discover`
        // (supervisor, solo runtime SWS) resta com'è per «Connetti».
        .route(
            "/api/discover/dispositivi",
            get(crate::discover::discover_dispositivi),
        )
        // Q50: la lista dei dispositivi registrati (Configurazione → Dispositivi),
        // sul server in <progetti>/.ambiente/dispositivi.yaml invece che nel
        // browser. Etichetta, URL, utente: mai la password.
        .route(
            "/api/devices",
            get(crate::dispositivi::elenca_dispositivi).put(crate::dispositivi::salva_dispositivi),
        )
        // Lifecycle on an already-installed container (status/start/stop/
        // restart/enable/disable/restart-policy/uninstall) — locally on this
        // host or over SSH, independent of any prior deploy's remote_dir.
        .route(
            "/api/deploy/device-container/manage",
            post(crate::packaging::manage_device_container),
        )
        // Audit log (OPEN_QUESTIONS Q8): who-did-what trail, tamper-evident.
        .route("/api/audit", get(get_audit_tail))
        .route("/api/audit/verify", get(get_audit_verify))
        // T-50 — lo schema del progetto e il giudizio su una modifica proposta.
        //
        // `POST /api/project/validate` riceve un progetto e **non lo salva**:
        // è l'unico endpoint che sembra scrivere e non scrive. È deliberato —
        // serve a sapere se una modifica sta in piedi *prima* di applicarla,
        // che è il ciclo con cui un assistente si corregge da solo invece di
        // lasciare il difetto al pannello. Vale anche senza IA: prima non
        // c'era modo di chiedere «questo progetto è valido?» senza rovinarlo.
        .route(
            "/api/project/validate",
            post(crate::schema_api::validate_project),
        )
        .route(
            "/api/schema/synoptic",
            get(crate::schema_api::schema_synoptic),
        )
        .route("/api/schema/source", get(crate::schema_api::schema_source))
        // La chat dell'assistente. Admin come tutto ciò che riguarda il
        // progetto: chi non può modificarlo non ha motivo di farsi proporre
        // modifiche. Non scrive niente — manda proposte al browser.
        .route("/ws/ai", get(crate::ai::ws_ai_handler))
        .route_layer(middleware::from_fn(require_admin));

    // Routes that need Operator+ (tag writes, alarm ACK, script exec,
    // alarm-actionable observability). Viewers can read everything but
    // can't change state. Synoptic writes moved to supervisor_routes
    // below — Operators are runtime users, not project editors.
    let operator_routes = Router::new()
        .route("/api/tags/:id", put(write_tag))
        .route("/api/alarms/:id/ack", post(ack_alarm))
        .route(
            "/api/alarms/:id/shelve",
            post(shelve_alarm).delete(unshelve_alarm),
        )
        .route("/api/alarms/shelved", get(list_shelved_alarms))
        // Recipe apply — writes multiple tags atomically
        .route("/api/recipes/:id/apply", post(apply_recipe))
        // Compila e non esegue: strumento di progettazione, nessun effetto.
        .route("/api/script/check", post(check_script))
        .route("/api/script/run/:name", post(run_function))
        // Logs — read-only but Operator+ so the audit surface stays
        // narrow (logs may include schema/secret hints).
        .route("/api/logs", get(get_logs))
        .route("/api/logs/files", get(list_log_files))
        .route("/api/logs/file", get(get_log_file))
        .route("/ws/logs", get(ws_logs_handler))
        // MQTT broker browse: temporary connection, subscribe #, return topics.
        .route("/api/sources/mqtt/browse", post(mqtt_browse_handler))
        // OPC-UA server browse: one level under a NodeId (default Objects).
        .route("/api/sources/opcua/browse", post(opcua_browse_handler))
        // OPC-UA Euromap 77/83 companion-spec auto-detect.
        .route(
            "/api/sources/opcua/detect-euromap",
            post(opcua_detect_euromap_handler),
        )
        // OPC-UA historical read — fetches raw data directly from the server's historian.
        .route("/api/sources/opcua/history", post(opcua_history_handler))
        // HomeAssistant entity browse: proxy GET /api/states to HA and return entities.
        .route("/api/sources/ha/browse", post(ha_browse_handler))
        .route("/api/system", get(crate::system::get_system_status))
        .route("/api/project/deploy", post(trigger_deploy))
        .route_layer(middleware::from_fn(require_operator));

    let system_ctrl_routes = Router::new()
        .route("/api/project/migrate", post(crate::system::migrate_project))
        .route("/api/system/stop", post(crate::system::system_stop))
        .route("/api/system/start", post(crate::system::system_start))
        .route("/api/system/reboot", post(crate::system::system_reboot))
        // La configurazione dell'assistente IA. Esistono **solo** su un'istanza
        // IDE-only (il gate è dentro gli handler, `ai/config_api.rs`): su un
        // runtime che serve un impianto rispondono 404. Stanno qui perché sono
        // configurazione del runtime, come il TLS, e non del progetto.
        .route(
            "/api/ai/config",
            get(crate::ai::config_api::get_ai_config)
                .put(crate::ai::config_api::put_ai_config)
                .delete(crate::ai::config_api::delete_ai_config),
        )
        // Stesso principio, per il fornitore di traduzione automatica (F5 del
        // piano multilingua-chiusura, 18/19-09-2026): il gate è dentro
        // `traduttore::solo_ide`, non qui.
        .route(
            "/api/traduzione/config",
            get(crate::traduttore::get_config_traduzione)
                .put(crate::traduttore::put_config_traduzione)
                .delete(crate::traduttore::delete_config_traduzione),
        )
        .route("/api/host/catalog", get(crate::system::get_host_catalog))
        .route("/api/system/tls", get(crate::system::get_tls_status))
        .route(
            "/api/system/tls/generate",
            post(crate::system::generate_tls_cert),
        )
        .route("/api/system/tls", put(crate::system::upload_tls_cert))
        .route("/api/system/tls", delete(crate::system::remove_tls_cert))
        // Remote runtime bridge: connect/disconnect/status + WS relay
        .route(
            "/api/remote/connect",
            post(crate::remote::connect_remote).delete(crate::remote::disconnect_remote),
        )
        .route("/api/remote/status", get(crate::remote::remote_status))
        // Il catalogo Host (zone termiche, mount, interfacce) del dispositivo
        // connesso: è lì che il progetto girerà, non su questa macchina.
        .route(
            "/api/remote/host/catalog",
            get(crate::remote::remote_host_catalog),
        )
        .route("/api/remote/deploy", post(crate::remote::remote_deploy))
        .route(
            "/api/remote/project/delete",
            post(crate::remote::delete_remote_project),
        )
        .route(
            "/api/remote/project/export",
            get(crate::remote::remote_export_project),
        )
        // Allineamento esplicito degli account, senza ridistribuire il
        // progetto. Dall'11-09-2026 anche il deploy li porta.
        .route("/api/remote/users", post(crate::remote::remote_push_users))
        // "Invia Client ID al dispositivo connesso" — override per-device del
        // client_id MQTT, esterno a project.yaml.
        .route(
            "/api/remote/mqtt-client-id",
            post(crate::remote::remote_push_mqtt_client_id),
        )
        // Stato RUNTIME/SISTEMA del dispositivo connesso — non del backend locale.
        .route(
            "/api/remote/system",
            get(crate::remote::remote_system_status),
        )
        // Database del datastore sul dispositivo connesso — non quello locale.
        .route(
            "/api/remote/database/:id/download",
            get(crate::remote::remote_download_database),
        )
        .route(
            "/api/remote/database/:id/upload",
            post(crate::remote::remote_upload_database),
        )
        // Backup del dispositivo connesso — non quelli del progetto locale.
        .route(
            "/api/remote/backups",
            get(crate::remote::remote_list_backups).post(crate::remote::remote_create_backup),
        )
        .route(
            "/api/remote/backups/:name/download",
            get(crate::remote::remote_download_backup),
        )
        .route(
            "/api/remote/backups/:name/restore",
            post(crate::remote::remote_restore_backup),
        )
        .route(
            "/api/remote/backups/:name",
            delete(crate::remote::remote_delete_backup),
        )
        .route(
            "/ws/remote/:sub",
            get(crate::remote_relay::ws_relay_handler),
        )
        .route_layer(middleware::from_fn(require_admin));

    // Routes that need Supervisor+ — project editing surface that
    // Operators must not touch (synoptic page write + per-page YAML
    // import). PUT /api/project/* schema-level routes live in
    // admin_routes above; this group only covers what the frontend
    // editor saves.
    let supervisor_routes = Router::new()
        .route(
            "/api/synoptics/:name",
            put(save_synoptic).delete(delete_synoptic),
        )
        .route("/api/synoptics/import", post(import_synoptic_yaml))
        // Pagine di boot (T-72): documenti a sé in `boot/`, mai visti dai viewer.
        .route(
            "/api/boot-pages/:name",
            put(crate::boot::save_boot_page).delete(crate::boot::delete_boot_page),
        )
        .route(
            "/api/boot-pages/:name/png",
            put(crate::boot::put_boot_png).layer(DefaultBodyLimit::max(LIMITE_CORPO_UPLOAD)),
        )
        .route(
            "/api/boot-pages/import",
            post(crate::boot::import_boot_page),
        )
        // mDNS discovery: scan LAN for _sws._tcp.local. services (~2 s).
        // Supervisor+ only — used from the RuntimeConnectionTab deploy panel.
        .route("/api/discover", get(crate::discover::discover_runtimes))
        // Cert TLS di un runtime remoto scaricato via backend (il browser non
        // può: bloccherebbe proprio la richiesta finché il cert non è accettato).
        .route("/api/remote/cert", get(crate::remote::remote_cert))
        // Upload/rimozione immagini di progetto (le letture stanno nei tier
        // read-only di entrambe le porte).
        .route(
            "/api/project/images/:name",
            post(upload_project_image)
                .layer(DefaultBodyLimit::max(LIMITE_CORPO_UPLOAD))
                .delete(delete_project_image),
        )
        // Git commit: stage all changes and create a commit.
        .route("/api/project/git/commit", post(git_commit))
        // Crea un tag — stessa classe di rischio del commit (scrittura locale).
        .route("/api/project/git/tags", post(create_git_tag))
        .route_layer(middleware::from_fn(require_supervisor));

    // Routes any authenticated user (incl. Viewer) can hit.
    let read_routes = Router::new()
        // I rilievi semantici del progetto su disco, per l'editor dopo un
        // salvataggio (Fase 0d): avvisi, mai un blocco.
        .route(
            "/api/project/findings",
            get(crate::schema_api::project_findings),
        )
        // Tag REST (reads)
        .route("/api/tags", get(get_all_tags))
        .route("/api/tags/:id", get(get_tag))
        // Alarm REST (reads)
        .route("/api/alarms", get(get_alarms))
        .route("/api/alarms/history", get(get_alarm_history))
        // Historian
        .route("/api/history/export", get(export_history_csv)) // literal before :tag
        .route("/api/history/xy", get(get_history_xy)) // literal before :tag
        .route("/api/history/:tag/stats", get(tag_history_stats))
        .route("/api/history/:tag", get(get_history))
        // (Datastore routes are in a dedicated router below — see datastore_routes)
        // Synoptic REST (reads)
        .route("/api/synoptics", get(list_synoptics))
        .route("/api/pages/nav", get(pages_nav))
        .route("/api/synoptics/:name", get(get_synoptic))
        .route("/api/boot-pages", get(crate::boot::list_boot_pages))
        .route("/api/boot-pages/:name", get(crate::boot::get_boot_page))
        .route("/api/boot-pages/:name/png", get(crate::boot::get_boot_png))
        // Immagini di progetto (letture — servite anche al viewer, vedi sotto)
        .route("/api/project/images", get(list_project_images))
        .route("/api/project/images/:name", get(get_project_image))
        // Per-page export — raw YAML download. Same shape as the file on disk,
        // small enough to skip the ZIP wrapper used by the bulk export.
        .route("/api/synoptics/:name/export", get(export_synoptic_yaml))
        // Faceplate REST (read + write — Operator+ can read, Configurator+ can write)
        .route("/api/faceplates", get(list_faceplates))
        .route(
            "/api/faceplates/:id",
            get(get_faceplate)
                .put(save_faceplate)
                .delete(delete_faceplate),
        )
        // Recipe REST (read)
        .route("/api/recipes", get(list_recipes))
        .route("/api/recipes/history", get(get_recipe_history))
        .route(
            "/api/recipes/:id",
            get(get_recipe).put(save_recipe).delete(delete_recipe),
        )
        // GitOps status (read-only — any authenticated user)
        .route("/api/project/git-status", get(get_git_status))
        .route("/api/project/git/tags", get(list_git_tags))
        // Project fingerprint: SHA256 of project.yaml + all synoptics.
        // Clients compare local vs. remote fingerprint to verify deployment sync.
        .route("/api/project/fingerprint", get(get_project_fingerprint))
        // WebSocket streams
        .route("/ws/tags", get(ws_tags_handler))
        .route("/ws/alarms", get(ws_alarms_handler));

    // Datastore routes — all in ONE router to avoid Axum v0.7 matchit
    // conflicts when routers with overlapping `:id` prefixes are merged.
    // Admin-only operations use per-route middleware instead of a
    // shared route_layer so they coexist with the read routes.
    let require_admin_layer = middleware::from_fn(require_admin);
    let datastore_routes = Router::new()
        .route("/api/datastores", get(list_datastores))
        .route("/api/datastores/:id/stats", get(datastore_stats))
        .route(
            "/api/datastores/:id/test",
            post(datastore_test).route_layer(require_admin_layer.clone()),
        )
        .route("/api/datastores/:id/tags", get(datastore_tags))
        .route("/api/datastores/:id/delete-tag", post(datastore_delete_tag))
        .route("/api/datastores/:id/vacuum", post(datastore_vacuum))
        .route(
            "/api/datastores/:id/purge",
            post(datastore_purge).route_layer(require_admin_layer.clone()),
        )
        .route(
            "/api/datastores/:id/export",
            get(datastore_export).route_layer(require_admin_layer.clone()),
        )
        .route(
            "/api/datastores/:id/download",
            get(datastore_download).route_layer(require_admin_layer.clone()),
        )
        .route(
            "/api/datastores/:id/upload",
            post(datastore_upload).route_layer(require_admin_layer.clone()),
        );

    // OPC-UA cert trust management — separate router to avoid matchit
    // conflicts with /api/sources/opcua/browse (literal) vs :id (param).
    // GET list is Supervisor+; POST trust and DELETE are Admin-only.
    let require_supervisor_layer = middleware::from_fn(require_supervisor);
    let opcua_cert_routes = Router::new()
        .route(
            "/api/sources/:id/opcua/certs",
            get(opcua_list_certs).route_layer(require_supervisor_layer),
        )
        .route(
            "/api/sources/:id/opcua/certs/:filename/trust",
            post(opcua_trust_cert).route_layer(require_admin_layer.clone()),
        )
        .route(
            "/api/sources/:id/opcua/certs/:filename",
            delete(opcua_delete_cert).route_layer(require_admin_layer),
        );

    // The "blocking" set — all routes above plus all the operator/admin
    // routes — is gated by the must_change_password flag in addition to
    // the role checks. A user flagged for password change can still hit
    // the self-service endpoints below.
    let blocking = read_routes
        .merge(operator_routes)
        .merge(supervisor_routes)
        .merge(admin_routes)
        .merge(system_ctrl_routes)
        .merge(datastore_routes)
        .merge(opcua_cert_routes)
        .route_layer(middleware::from_fn(require_password_changed));

    // Self-service endpoints: any authenticated user, including one with
    // must_change_password=true, can hit these.
    let self_service = Router::new()
        .route("/api/auth/whoami", get(whoami))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/auth/verify-password", post(verify_password_handler))
        .route("/api/auth/refresh", post(refresh_session));

    let protected = blocking
        .merge(self_service)
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    // Pre-auth project lifecycle endpoints — the WelcomeScreen calls these
    // before any session token exists. They operate on `projects_root` and
    // `templates_root` only (no AuthState dependency).
    // GET /api/project is also pre-auth: the WelcomeScreen needs to know
    // whether a project is active (503 = none) before any session exists.
    let project_lifecycle = Router::new()
        .route("/api/project", get(get_project))
        .route(
            "/api/projects",
            get(crate::projects::list_projects).post(crate::projects::create_project),
        )
        .route(
            "/api/projects/:name/open",
            post(crate::projects::open_project),
        )
        .route(
            "/api/projects/:name/rename",
            post(crate::projects::rename_project),
        )
        .route(
            "/api/projects/:name/duplicate",
            post(crate::projects::duplicate_project),
        )
        .route(
            "/api/projects/:name",
            delete(crate::projects::delete_project),
        )
        .route("/api/projects/close", post(crate::projects::close_project))
        .route(
            "/api/projects/upload",
            post(crate::projects::upload_project_zip)
                .layer(DefaultBodyLimit::max(LIMITE_CORPO_UPLOAD)),
        )
        .route("/api/templates", get(crate::templates::list_templates))
        // Mini directory browser backing the "choose a destination folder"
        // picker in the New Project dialog. Pre-auth like the rest of this
        // group — no session exists yet when creating the first project.
        .route("/api/fs/browse-dirs", get(crate::projects::browse_dirs))
        // "New folder" inside that picker. Same pre-auth posture — see the
        // handler doc comment for why this adds no new capability.
        .route("/api/fs/mkdir", post(crate::projects::create_dir));

    // Install the Prometheus recorder once. Calling this multiple times in
    // the same process (e.g. tests that build several routers) is safe.
    crate::metrics::install_recorder();

    // Serve a self-unregistering service-worker script on the admin port.
    // The runtime SPA previously registered a SW at this origin; this stub
    // immediately unregisters it so browsers stop receiving the cached runtime
    // SPA and load index-admin.html instead.
    let sw_unregister = get(|| async {
        (
            [
                (axum::http::header::CONTENT_TYPE, "application/javascript"),
                (axum::http::header::CACHE_CONTROL, "no-store"),
            ],
            "self.addEventListener('install',()=>self.skipWaiting());\
             self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));",
        )
    });

    // Always-open routes: liveness probes + login + cert download + project lifecycle.
    let open = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/metrics", get(crate::metrics::get_metrics))
        .route("/cert", get(get_cert))
        .route("/sw.js", sw_unregister)
        .route("/api/auth/login", post(login))
        .merge(project_lifecycle);

    // ── La porta stretta di `--no-admin` ─────────────────────────────────────
    //
    // Decisione del maintainer (2026-09-02): sul dispositivo l'IDE non è il
    // default, è un caso particolare. `--no-admin` prima non legava **affatto**
    // la porta admin — e si portava via il Deploy con sé, perché
    // `remote_deploy` va proprio lì: `project_lifecycle` vive solo su questo
    // router (vedi il commento nel router del viewer). Un dispositivo così non
    // si poteva più aggiornare dall'editor.
    //
    // Quindi con `--no-admin` la porta resta, ma porta **solo la gestione
    // remota**: quello che l'editor chiama sul dispositivo, e nient'altro.
    // Cade tutto ciò che è «IDE servito dal dispositivo» — nessuna SPA admin,
    // nessuna rotta di editing dei sinottici, nessuna build dei pacchetti,
    // nessun `/api/fs/*`.
    //
    // E una cosa **più stretta** di prima: qui il ciclo di vita del progetto è
    // dietro `require_admin`, mentre sul router completo è pre-auth per
    // necessità (la WelcomeScreen deve creare il primo progetto quando nessuna
    // sessione esiste). Su un dispositivo senza IDE nessuna WelcomeScreen
    // esiste, quindi quella necessità non c'è — e `/api/fs/browse-dirs` e
    // `/api/fs/mkdir`, che in quel gruppo navigano il filesystem **senza
    // autenticazione**, non ci sono affatto.
    // Non un `return` anticipato: il tratto comune qui sotto applica il contatore
    // HTTP e il CORS, e saltarli renderebbe la porta stretta muta alle metriche.
    let mut app = if lockdown {
        deploy_only_app(state.clone())
    } else {
        open.merge(protected)
    };

    // Serve the Vite-built SPA from disk when --www is provided. Any path that
    // doesn't match an API/WS route falls through to ServeDir; 404s inside
    // ServeDir fall back to admin.html (admin SPA) so the SPA can handle
    // client-side routing on a refresh. Falls back to index.html when the
    // admin bundle hasn't been built yet (dev mode).
    //
    // In `--no-admin` **non si serve nessuna SPA**: la porta stretta è un'API di
    // gestione, non un'interfaccia. Servire l'IDE lì lo renderebbe raggiungibile
    // col browser e poi rotto a metà — ogni pulsante su una rotta che non c'è.
    if let (Some(dir), false) = (www_dir, lockdown) {
        // "index-admin.html" is the Vite output for the admin entry point.
        // Falls back to index.html when the admin bundle hasn't been built.
        let admin_html = dir.join("index-admin.html");
        let fallback_html = if admin_html.exists() {
            admin_html
        } else {
            dir.join("index.html")
        };
        // Disable ServeDir's automatic directory-index (which would serve
        // index.html for "/"), so that "/" also falls into not_found_service
        // and gets served index-admin.html instead.
        let fallback = ServeDir::new(&dir)
            .append_index_html_on_directories(false)
            .not_found_service(ServeFile::new(fallback_html));
        app = app.fallback_service(fallback);
    }

    // HTTP request counter — applied to every route, identifies the matched
    // route template (not the raw URI) so cardinality stays bounded.
    app = app.layer(middleware::from_fn(crate::metrics::track_http_metrics));

    // Permissive CORS for the "editor on laptop → runtime on PX30" deployment
    // shape (ARCH-004). The editor sets the runtime URL via localStorage and
    // talks to a different origin; without this layer the browser blocks
    // every cross-origin fetch at the preflight stage.
    //
    // Bearer-token auth is unaffected: `Allow-Credentials` stays at the
    // default (false), so no cookies cross origins. The `*` wildcard is
    // CRA-non-compliant — when the PoC graduates to product, narrow this to
    // a configured allowlist (see follow-ups in STATUS.md).
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // `state` serve anche al chiamante, quindi si clona per il router admin.
    let admin_app = app.layer(cors).with_state(state.clone());
    (runtime_app, admin_app, state)
}

/// Build the runtime router served on port 8443 (synoptic view only).
///
/// All routes are wrapped with `optional_auth` — unauthenticated requests get
/// `Role::Viewer` (anonymous read-only). Write routes (`put`, `post` that mutate
/// state) still require `Operator+` via `require_operator`.
///
/// Routes NOT included here: project editing (`PUT /api/project/*`), synoptic
/// editing (`PUT /api/synoptics/*`), backups, users, system control, project
/// lifecycle, log viewer, source browse, datastore admin.
/// La porta di `--no-admin`: **gestione remota, non IDE**.
///
/// # Come è stato scelto cosa ci sta
///
/// Non a intuito: sono gli endpoint che `remote.rs` chiama davvero sul
/// dispositivo, elencati dal codice dell'editor. Nient'altro entra qui, e
/// aggiungere una rotta significa aver deciso che il dispositivo la deve
/// esporre per default — che è la domanda che questo modo esiste per porre.
///
/// | Cosa | Rotte |
/// |---|---|
/// | login | `POST /api/auth/login` |
/// | deploy | `GET /api/projects`, `POST /api/projects/upload`, `POST /api/projects/:name/open`, `POST /api/projects/close`, `DELETE /api/projects/:name` |
/// | pull | `GET /api/project/export` |
/// | stato | `GET /api/system`, `GET /api/project` |
/// | utenti | `GET/POST /api/auth/users`, `POST /api/auth/users-file` |
/// | backup | `GET/POST /api/backups`, `GET /api/backups/:name/download`, `POST /api/backups/:name/restore`, `DELETE /api/backups/:name` |
/// | datastore | `GET /api/datastores/:id/download`, `POST /api/datastores/:id/upload` |
/// | override MQTT | `POST /api/mqtt/source/:id/client-id-override` |
///
/// # Cosa NON c'è, ed è il punto
///
/// Nessuna SPA admin. Nessuna `PUT /api/project/*` e nessuna
/// `PUT /api/synoptics/*`: il progetto non si modifica **sul** dispositivo, si
/// deploya. Nessuna build dei pacchetti. Nessun
/// `/api/fs/*` — che sul router completo naviga il filesystem **senza
/// autenticazione**, per una necessità (la WelcomeScreen al primo avvio) che su
/// un dispositivo senza IDE non esiste. Nessun `/ws/ai`, e nessun `/ws/logs`:
/// i log possono contenere segreti e non stanno su nessuna delle due porte del
/// dispositivo. `/ws/tags` e `/ws/alarms` invece **ci sono** dal 2026-09-08 —
/// l'editor collegato li apre su questa porta, ed erano l'unica cosa mancante
/// che nessuno aveva dichiarato.
///
/// # Tutto autenticato, che è più stretto di prima
///
/// Sul router completo `project_lifecycle` è **pre-auth** per necessità. Qui è
/// dietro `require_admin`: in modalità senza utenti l'admin sintetico passa
/// comunque, quindi il flusso di sviluppo non cambia, ma su un dispositivo con
/// utenti configurati caricare un progetto richiede una sessione.
fn deploy_only_app(state: AppState) -> Router<AppState> {
    use crate::projects as pj;

    let gestione = Router::new()
        // ── Deploy: la ragione per cui questa porta esiste ──────────────────
        .route("/api/projects", get(pj::list_projects))
        .route(
            "/api/projects/upload",
            post(pj::upload_project_zip).layer(DefaultBodyLimit::max(LIMITE_CORPO_UPLOAD)),
        )
        .route("/api/projects/:name/open", post(pj::open_project))
        .route("/api/projects/close", post(pj::close_project))
        .route("/api/projects/:name", delete(pj::delete_project))
        // ── Pull: il verso opposto ─────────────────────────────────────────
        .route("/api/project/export", get(export_project_zip))
        // ── Stato, che l'IDE legge per dire com'è il dispositivo ───────────
        .route("/api/project", get(get_project))
        .route("/api/system", get(crate::system::get_system_status))
        // Cosa c'è su QUESTA macchina — zone termiche, mount, interfacce — per
        // il campo «parametro» della sorgente Host. L'editor lo chiede al
        // dispositivo connesso (`/api/remote/host/catalog`), perché le zone
        // del PC di chi disegna non dicono niente su quelle del pannello:
        // il 21-09-2026 due metriche `temp` sono state salvate senza zona e
        // sono rimaste Bad in silenzio. Sola lettura, nessun segreto.
        .route("/api/host/catalog", get(crate::system::get_host_catalog))
        // ── Utenti: azione deliberata, separata dal deploy ─────────────────
        //
        // I verbi sono quelli che `remote.rs` usa davvero (`PUT`, non `POST`):
        // sbagliarli farebbe 405 dove l'editor si aspetta 204, e il messaggio
        // d'errore non direbbe perché.
        .route("/api/auth/users", get(list_users).post(create_user))
        .route("/api/auth/users-file", put(pj::replace_users_file))
        // ── Backup ─────────────────────────────────────────────────────────
        .route(
            "/api/backups",
            get(crate::backups::list_backups_handler).post(crate::backups::create_backup_handler),
        )
        .route(
            "/api/backups/:name/download",
            get(crate::backups::download_backup_handler),
        )
        .route(
            "/api/backups/:name/restore",
            post(crate::backups::restore_backup_handler),
        )
        .route(
            "/api/backups/:name",
            delete(crate::backups::delete_backup_handler),
        )
        // ── Datastore ──────────────────────────────────────────────────────
        .route("/api/datastores/:id/download", get(datastore_download))
        .route("/api/datastores/:id/upload", post(datastore_upload))
        // ── Override per-dispositivo del client id MQTT ────────────────────
        .route(
            "/api/mqtt/source/:id/client-id-override",
            put(pj::set_mqtt_client_id_override),
        )
        .route_layer(middleware::from_fn(require_admin))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    // ── Flussi in sola lettura (2026-09-08) ────────────────────────────────
    //
    // L'editor collegato a un pannello apre `/ws/tags` e `/ws/alarms` **su
    // questa porta**, perché è quella che gli hai dato in «Connetti». Non
    // c'erano: `remote_relay` prendeva 404 su ogni tentativo e ritentava per
    // sempre, due volte al secondo, senza che niente mostrasse valori vivi.
    // Il difetto non si vedeva sullo stack di sviluppo, dove la porta admin
    // serve il router completo e le rotte ci sono.
    //
    // Autenticati come tutto il resto di questa porta, ma **non** admin-only:
    // sono gli stessi dati in sola lettura che la porta viewer espone già, e
    // pretendere l'admin rimetterebbe un editor collegato come operatore
    // esattamente nel loop che questo blocco chiude. `require_auth` accetta il
    // token anche in query (`?token=`), che è come un WebSocket lo manda.
    //
    // `/ws/logs` resta **fuori**, deliberatamente: i log possono contenere
    // segreti (URL con credenziali, corpi di richieste) e su un dispositivo non
    // stanno su nessuna delle due porte. Se un giorno servisse, è una decisione
    // da prendere, non da far scivolare dentro insieme ai tag.
    let flussi = Router::new()
        .route("/ws/tags", get(ws_tags_handler))
        .route("/ws/alarms", get(ws_alarms_handler))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let aperte = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/metrics", get(crate::metrics::get_metrics))
        .route("/cert", get(get_cert))
        .route("/api/auth/login", post(login));

    // Lo stato **non** si applica qui: lo fa il chiamante alla fine, insieme al
    // CORS e al contatore HTTP. Applicarlo due volte non compila, e applicarlo
    // qui salterebbe quel tratto comune.
    aperte.merge(gestione).merge(flussi)
}

fn build_runtime_inner(state: AppState, www_dir: Option<PathBuf>) -> Router {
    // Operator-required routes: tag writes, alarm ops, recipe apply, scripts.
    let operator_routes = Router::new()
        .route("/api/tags/:id", put(write_tag))
        .route("/api/alarms/:id/ack", post(ack_alarm))
        .route(
            "/api/alarms/:id/shelve",
            post(shelve_alarm).delete(unshelve_alarm),
        )
        .route("/api/alarms/shelved", get(list_shelved_alarms))
        .route("/api/recipes/:id/apply", post(apply_recipe))
        .route("/api/script/run/:name", post(run_function))
        .route("/api/system", get(crate::system::get_system_status));
    // Q47 (2026-09-09): `/api/script/exec` — esecuzione di Python arbitrario —
    // non c'è più, da nessuna parte: nessuna interfaccia lo chiamava e gli
    // script di progetto non passano da HTTP. Resta `/api/script/run/:name`,
    // che esegue solo funzioni con un nome, dichiarate nel progetto.
    let operator_routes = operator_routes.route_layer(middleware::from_fn(require_operator));

    // Anonymous-readable routes: synoptic, tags, alarms, history, WS streams.
    let read_routes = Router::new()
        .route("/api/tags", get(get_all_tags))
        .route("/api/tags/:id", get(get_tag))
        .route("/api/alarms", get(get_alarms))
        .route("/api/alarms/history", get(get_alarm_history))
        .route("/api/history/export", get(export_history_csv))
        .route("/api/history/xy", get(get_history_xy)) // literal before :tag
        .route("/api/history/:tag/stats", get(tag_history_stats))
        .route("/api/history/:tag", get(get_history))
        .route("/api/synoptics", get(list_synoptics))
        .route("/api/pages/nav", get(pages_nav))
        .route("/api/synoptics/:name", get(get_synoptic))
        .route("/api/project/images", get(list_project_images))
        .route("/api/project/images/:name", get(get_project_image))
        .route("/api/faceplates", get(list_faceplates))
        .route("/api/faceplates/:id", get(get_faceplate))
        .route("/api/recipes", get(list_recipes))
        .route("/api/recipes/history", get(get_recipe_history))
        .route("/api/recipes/:id", get(get_recipe))
        .route("/api/datastores", get(list_datastores))
        .route("/api/datastores/:id/stats", get(datastore_stats))
        .route("/api/project/fingerprint", get(get_project_fingerprint))
        .route("/ws/tags", get(ws_tags_handler))
        .route("/ws/alarms", get(ws_alarms_handler));

    // Self-service: token must be valid but not blocked by password-change flag.
    let self_service = Router::new()
        .route("/api/auth/whoami", get(whoami))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/auth/verify-password", post(verify_password_handler))
        .route("/api/auth/refresh", post(refresh_session));

    // Wrap all gated routes with optional_auth so every request has AuthUser.
    let gated = read_routes
        .merge(operator_routes)
        .merge(self_service)
        .route_layer(middleware::from_fn_with_state(state.clone(), optional_auth));

    // Open: no auth needed. Only /api/project (current active project status)
    // is exposed on the runtime port — project management routes live on 8444 only.
    let open = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/metrics", get(crate::metrics::get_metrics))
        .route("/cert", get(get_cert))
        .route("/api/auth/login", post(login))
        .route("/api/project", get(get_project));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut router = open
        .merge(gated)
        .layer(middleware::from_fn(crate::metrics::track_http_metrics))
        .layer(cors)
        .with_state(state);

    if let Some(dir) = www_dir {
        let index_html = dir.join("index.html");
        let fallback = ServeDir::new(&dir).not_found_service(ServeFile::new(index_html));
        router = router.fallback_service(fallback);
    }

    router
}

// ── Auth middleware ──────────────────────────────────────────────────────────

/// Look up a bearer token in either the `Authorization: Bearer ...` header
/// or the `?token=...` query string (the latter is for browser WebSocket
/// upgrades, which cannot set custom headers). Inserts the resolved
/// username into request extensions for downstream handlers.
/// Questa richiesta va servita in modalità **no-auth** (Admin sintetico)?
///
/// Due casi, e il secondo è quello nuovo:
///
/// - **Nessun utente definito** — il comportamento di sempre: un runtime appena
///   installato, o con un progetto che non ha `users.yaml`, non può chiedere un
///   login che non esiste ancora.
/// - **L'istanza è un IDE** (`AppState::ide_only`, cioè `start_editor.sh` senza
///   `--viewer-port`). Qui `users.yaml` **non governa l'IDE**: è il file che
///   viaggia col deploy e che governa il **dispositivo**. Fino al 14-09-2026 i
///   due usi erano lo stesso elenco, e definire il primo utente del pannello —
///   un Operator — chiudeva fuori dall'editor chi lo stava definendo: la
///   richiesta successiva trovava l'autenticazione accesa, il token che
///   l'editor porta in no-auth è un sentinella che il server non ha mai
///   emesso, e l'unico account esistente non poteva comunque configurare
///   niente. Il progetto restava inaccessibile senza toccare i file a mano.
///
/// Il prezzo è dichiarato in `docs/OPEN_QUESTIONS.md` Q56: un IDE **raggiungibile
/// in rete** non ha più password. Sul PC di sviluppo è `localhost`; su un host
/// esposto la risposta vera è Q44 (utenti *sopra* i progetti), non questa.
pub fn senza_autenticazione(ide_only: bool, ha_utenti: bool) -> bool {
    ide_only || !ha_utenti
}

/// Va rifiutata questa creazione perché lascerebbe l'istanza senza nessuno che
/// possa amministrarla?
///
/// Solo sui **dispositivi**: il primo account di un pannello dev'essere un
/// Admin, altrimenti il pannello nasce con un'autenticazione accesa e nessuno
/// in grado di cambiarla (`applica_seed_di_recupero` non rientra — entra solo
/// se il risultato sarebbe *zero* utenti). È la simmetrica del rifiuto che
/// esiste già dall'altro lato, in `replace_users_file`, che non accetta una
/// lista vuota per non lasciare il dispositivo senza account.
///
/// Su un IDE la guardia **non** scatta: lì quegli utenti non governano niente
/// (vedi `senza_autenticazione`), e obbligare a creare un Admin prima di un
/// operatore sarebbe una regola senza scopo.
pub fn primo_utente_non_amministratore(ide_only: bool, ha_utenti: bool, ruolo: Role) -> bool {
    !ide_only && !ha_utenti && ruolo != Role::Admin
}

async fn require_auth(State(s): State<AppState>, mut req: Request, next: Next) -> Response {
    // No users defined (no project, or project without users) → open / no-auth mode.
    // Inject a synthetic AuthUser so all downstream handlers see an Admin-level
    // caller — the frontend never shows the login screen and all routes work.
    // Un'istanza IDE resta in no-auth anche *con* utenti definiti: vedi
    // `senza_autenticazione`.
    if senza_autenticazione(s.ide_only, s.auth.has_users().await) {
        req.extensions_mut().insert(AuthUser {
            username: "admin".to_string(),
            role: Role::Admin,
            must_change_password: false,
            allowed_zones: vec![],
        });
        return next.run(req).await;
    }

    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|t| t.to_string())
        .or_else(|| {
            let uri = req.uri();
            let q = uri.query().unwrap_or("");
            url_form_decode(q)
                .into_iter()
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v)
        });

    let Some(token) = token else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Some(info) = s.auth.validate(&token).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let must_change = info.must_change_password;
    req.extensions_mut().insert(AuthUser {
        username: info.username,
        role: info.role,
        must_change_password: must_change,
        allowed_zones: info.allowed_zones,
    });
    next.run(req).await
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub username: String,
    pub role: Role,
    pub must_change_password: bool,
    /// Empty = all zones allowed.
    pub allowed_zones: Vec<String>,
}

/// When the user is flagged "must change password", any API call other
/// than the self-service trio (`/api/auth/change-password`, `whoami`,
/// `logout`) is rejected with 403 + a sentinel error code so the
/// frontend can route to the dedicated screen. This middleware must run
/// AFTER `require_auth`.
async fn require_password_changed(req: Request, next: Next) -> Response {
    if let Some(user) = req.extensions().get::<AuthUser>() {
        if user.must_change_password {
            return (
                StatusCode::FORBIDDEN,
                axum::Json(serde_json::json!({
                    "error":  "password_change_required",
                    "detail": "you must change your password before using the API",
                })),
            )
                .into_response();
        }
    }
    next.run(req).await
}

/// Reject the request if the caller's role is below `min`. Must run
/// AFTER `require_auth` so the `AuthUser` extension is populated.
fn check_role(req: &Request, min: Role) -> Option<StatusCode> {
    let Some(user) = req.extensions().get::<AuthUser>() else {
        return Some(StatusCode::UNAUTHORIZED);
    };
    if user.role < min {
        Some(StatusCode::FORBIDDEN)
    } else {
        None
    }
}

async fn require_operator(req: Request, next: Next) -> Response {
    if let Some(code) = check_role(&req, Role::Operator) {
        return code.into_response();
    }
    next.run(req).await
}

async fn require_supervisor(req: Request, next: Next) -> Response {
    if let Some(code) = check_role(&req, Role::Supervisor) {
        return code.into_response();
    }
    next.run(req).await
}

async fn require_admin(req: Request, next: Next) -> Response {
    if let Some(code) = check_role(&req, Role::Admin) {
        return code.into_response();
    }
    next.run(req).await
}

/// Optional auth: tries to authenticate from the bearer token / `?token=` query
/// parameter. If the token is missing or invalid, inserts an anonymous
/// `AuthUser` with `Role::Viewer` so all downstream handlers still have an
/// `AuthUser` in extensions. Routes that need more than read access still apply
/// `require_operator` / `require_admin` on top of this.
///
/// Used by the runtime router (port 8443) to allow anonymous read-only access
/// to the synoptic SPA without removing the role-check guards on write routes.
async fn optional_auth(State(s): State<AppState>, mut req: Request, next: Next) -> Response {
    // No users defined → no-auth mode: inject synthetic Admin (mirrors require_auth).
    // La decisione è una sola per tutto il router: `senza_autenticazione`.
    if senza_autenticazione(s.ide_only, s.auth.has_users().await) {
        req.extensions_mut().insert(AuthUser {
            username: "admin".to_string(),
            role: Role::Admin,
            must_change_password: false,
            allowed_zones: vec![],
        });
        return next.run(req).await;
    }

    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.to_string())
        .or_else(|| {
            let q = req.uri().query().unwrap_or("");
            url_form_decode(q)
                .into_iter()
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v)
        });

    let auth_user = if let Some(tok) = token {
        if let Some(info) = s.auth.validate(&tok).await {
            AuthUser {
                username: info.username,
                role: info.role,
                must_change_password: info.must_change_password,
                allowed_zones: info.allowed_zones,
            }
        } else {
            // Expired / unknown token → anonymous
            AuthUser {
                username: String::new(),
                role: Role::Viewer,
                must_change_password: false,
                allowed_zones: vec![],
            }
        }
    } else {
        // No token → anonymous read-only
        AuthUser {
            username: String::new(),
            role: Role::Viewer,
            must_change_password: false,
            allowed_zones: vec![],
        }
    };
    req.extensions_mut().insert(auth_user);
    next.run(req).await
}

/// Minimal application/x-www-form-urlencoded parser — only handles the
/// shape we need (`k=v&k2=v2`) without pulling in a dep.
fn url_form_decode(q: &str) -> Vec<(String, String)> {
    q.split('&')
        .filter(|p| !p.is_empty())
        .filter_map(|p| {
            let mut it = p.splitn(2, '=');
            let k = it.next()?.to_string();
            let v = it.next().unwrap_or("").to_string();
            Some((k, v))
        })
        .collect()
}

// ── Cert download ─────────────────────────────────────────────────────────────

/// Serve the TLS certificate PEM so users can import it into their browser.
/// Open endpoint (no auth) — the cert is the public key only, no secret.
async fn get_cert(State(s): State<AppState>) -> Response {
    let Some(ref path) = s.cert_path else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::fs::read(path.as_ref()).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/x-pem-file")
            .header(
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"sws.crt\"",
            )
            .body(axum::body::Body::from(bytes))
            .unwrap(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ── Auth endpoints ───────────────────────────────────────────────────────────

async fn login(
    State(s): State<AppState>,
    peer: Option<axum::extract::Extension<std::net::SocketAddr>>,
    headers: axum::http::HeaderMap,
    Json(creds): Json<Credentials>,
) -> Response {
    // IP allowlist check — only enforced when SWS_IP_ALLOWLIST is set.
    if !s.ip_allowlist.is_empty() {
        let peer_ip: Option<std::net::IpAddr> = peer
            .map(|axum::extract::Extension(sa)| sa.ip())
            .or_else(|| {
                headers
                    .get("x-forwarded-for")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.split(',').next())
                    .and_then(|ip| ip.trim().parse().ok())
            });
        let allowed = peer_ip.is_some_and(|ip| {
            s.ip_allowlist
                .iter()
                .any(|(net, prefix)| ip_in_cidr(ip, *net, *prefix))
        });
        if !allowed {
            warn!(peer = ?peer_ip, "login blocked by IP allowlist");
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    match s.auth.login(&creds).await {
        Ok(ok) => {
            s.audit.log(
                "auth.login",
                Some(creds.username.clone()),
                serde_json::json!({"role": ok.role}),
            );
            Json(ok).into_response()
        }
        Err(LoginError::BadCredentials) => {
            s.audit.log(
                "auth.login_failed",
                Some(creds.username.clone()),
                serde_json::json!({}),
            );
            StatusCode::UNAUTHORIZED.into_response()
        }
        Err(LoginError::RateLimited { retry_after_secs }) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(
                axum::http::header::RETRY_AFTER,
                retry_after_secs.to_string(),
            )],
        )
            .into_response(),
    }
}

/// Returns true when `ip` falls within the CIDR block `network/prefix_len`.
fn ip_in_cidr(ip: std::net::IpAddr, network: std::net::IpAddr, prefix_len: u8) -> bool {
    use std::net::IpAddr;
    match (ip, network) {
        (IpAddr::V4(ip4), IpAddr::V4(net4)) => {
            if prefix_len == 0 {
                return true;
            }
            let shift = 32u32.saturating_sub(prefix_len as u32);
            u32::from(ip4) >> shift == u32::from(net4) >> shift
        }
        (IpAddr::V6(ip6), IpAddr::V6(net6)) => {
            if prefix_len == 0 {
                return true;
            }
            let shift = 128u128.saturating_sub(prefix_len as u128);
            u128::from(ip6) >> shift == u128::from(net6) >> shift
        }
        _ => false, // IPv4 vs IPv6 mismatch
    }
}

async fn logout(State(s): State<AppState>, req: Request) -> StatusCode {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    if let Some(t) = token {
        let actor = s.auth.validate(t).await.map(|si| si.username);
        s.auth.logout(t).await;
        s.audit.log("auth.logout", actor, serde_json::json!({}));
    }
    StatusCode::NO_CONTENT
}

/// Slide the session TTL and return the refreshed expiry timestamp.
/// The client uses this to reschedule its proactive refresh timer.
/// Returns 401 when the token is already expired (client should re-login).
async fn refresh_session(State(s): State<AppState>, req: Request) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    let Some(token) = token else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    match s.auth.touch(token).await {
        Some(expires_at_ms) => {
            Json(serde_json::json!({ "expires_at_ms": expires_at_ms })).into_response()
        }
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

#[derive(serde::Serialize)]
struct Whoami {
    username: String,
    role: Role,
    must_change_password: bool,
}

async fn whoami(req: Request) -> Json<Whoami> {
    // require_auth has already inserted AuthUser; missing here would be a bug.
    let user = req
        .extensions()
        .get::<AuthUser>()
        .cloned()
        .unwrap_or(AuthUser {
            username: String::new(),
            role: Role::Viewer,
            must_change_password: false,
            allowed_zones: vec![],
        });
    Json(Whoami {
        username: user.username,
        role: user.role,
        must_change_password: user.must_change_password,
    })
}

// ── User CRUD (admin) ────────────────────────────────────────────────────────

async fn list_users(State(s): State<AppState>) -> Json<Vec<sws_auth::UserSummary>> {
    Json(s.auth.list_users().await)
}

async fn create_user(
    State(s): State<AppState>,
    Json(body): Json<sws_auth::CreateUser>,
) -> Response {
    // Il primo account di un **dispositivo** dev'essere un Admin, o il pannello
    // nasce con l'autenticazione accesa e nessuno che possa amministrarlo.
    if primo_utente_non_amministratore(s.ide_only, s.auth.has_users().await, body.role) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "primo_utente_non_admin",
                "detail": "Il primo utente di un dispositivo deve avere ruolo Admin: \
                           altrimenti l'autenticazione si accende e nessuno può più \
                           amministrare il pannello. Crea prima un Admin, poi gli altri ruoli.",
            })),
        )
            .into_response();
    }
    match s.auth.create_user(body).await {
        Ok(u) => (StatusCode::CREATED, Json(u)).into_response(),
        Err(e) => user_error_to_response(e),
    }
}

async fn update_user(
    State(s): State<AppState>,
    Path(username): Path<String>,
    Json(patch): Json<sws_auth::UserPatch>,
) -> Response {
    match s.auth.update_user(&username, patch).await {
        Ok(u) => Json(u).into_response(),
        Err(e) => user_error_to_response(e),
    }
}

async fn delete_user(
    State(s): State<AppState>,
    Path(username): Path<String>,
    req: Request,
) -> Response {
    // Forbid an admin from deleting their own currently-logged-in account —
    // this would lock the operator out of their own session immediately.
    if let Some(caller) = req.extensions().get::<AuthUser>() {
        if caller.username == username {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "cannot_delete_self"})),
            )
                .into_response();
        }
    }
    match s.auth.delete_user(&username).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => user_error_to_response(e),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9
struct VerifyPasswordBody {
    password: String,
}

/// `POST /api/auth/verify-password` — re-autenticazione per i comandi
/// critici (F3.3): conferma che chi sta al terminale è ancora il titolare
/// della sessione, senza emettere token nuovi. Condivide il lockout del
/// login. In no-auth mode risponde 204 (nessuna password esiste).
async fn verify_password_handler(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<VerifyPasswordBody>,
) -> StatusCode {
    if !s.auth.has_users().await {
        return StatusCode::NO_CONTENT;
    }
    if s.auth
        .verify_user_password(&user.username, &body.password)
        .await
    {
        s.audit.log(
            "auth.reverify",
            Some(user.username),
            serde_json::json!({"ok": true}),
        );
        StatusCode::NO_CONTENT
    } else {
        s.audit.log(
            "auth.reverify",
            Some(user.username),
            serde_json::json!({"ok": false}),
        );
        StatusCode::FORBIDDEN
    }
}

async fn change_password(State(s): State<AppState>, req: Request) -> Response {
    let user = match req.extensions().get::<AuthUser>().cloned() {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    // Re-read the JSON body manually since we already consumed `req` for
    // extensions. axum 0.7 doesn't let us pass both req and Json by value
    // without re-architecting the handler — extract the body manually.
    let bytes = match axum::body::to_bytes(req.into_body(), 64 * 1024).await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("body: {e}")).into_response(),
    };
    let body: sws_auth::ChangePassword = match serde_json::from_slice(&bytes) {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("json: {e}")).into_response(),
    };
    match s.auth.change_password(&user.username, body).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => user_error_to_response(e),
    }
}

fn user_error_to_response(e: sws_auth::UserError) -> Response {
    use sws_auth::UserError::*;
    let (code, msg) = match &e {
        NotFound => (StatusCode::NOT_FOUND, "not_found"),
        AlreadyExists => (StatusCode::CONFLICT, "already_exists"),
        LastAdmin => (StatusCode::CONFLICT, "last_admin"),
        InvalidPassword => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_password"),
        StorageError(_) => (StatusCode::INTERNAL_SERVER_ERROR, "storage_error"),
    };
    (
        code,
        Json(serde_json::json!({
            "error":  msg,
            "detail": e.to_string(),
        })),
    )
        .into_response()
}

// ── Tag endpoints ────────────────────────────────────────────────────────────

/// `GET /api/tags` — tutti i valori. **Espansi in foglie** di default
/// (Fase 1d): `motore1` diventa `motore1.velocita`, `motore1.marcia`… con la
/// qualità di ognuna. `?composito=1` restituisce invece le radici intere, per
/// chi sa leggerle (un widget tabella legato a un array).
#[derive(serde::Deserialize)]
struct QueryTag {
    /// Stringa e non `bool`: `?composito=1` è la forma che viene da digitare,
    /// e con un `bool` serde risponde 400 «provided string was not true or
    /// false» — un rifiuto che non aiuta nessuno.
    #[serde(default)]
    composito: Option<String>,
}

impl QueryTag {
    fn vuole_radici(&self) -> bool {
        matches!(
            self.composito.as_deref().map(str::trim),
            Some("1" | "true" | "yes" | "si" | "sì" | "")
        )
    }
}

async fn get_all_tags(
    State(s): State<AppState>,
    Query(q): Query<QueryTag>,
) -> Json<HashMap<TagId, TagState>> {
    Json(if q.vuole_radici() {
        s.db.snapshot().await
    } else {
        s.db.snapshot_foglie().await
    })
}

async fn get_tag(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match s.db.get(&id).await {
        Some(state) => Json(state).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9
struct WriteTagBody {
    value: TagValue,
    /// F3.3: motivo del comando (comandi critici) — finisce nell'audit.
    #[serde(default)]
    reason: Option<String>,
}

async fn write_tag(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
    Json(body): Json<WriteTagBody>,
) -> axum::response::Response {
    // F3.1: ruolo minimo di scrittura per-tag (default storico: Operator+,
    // già garantito dal layer di route — qui si applica l'eventuale soglia
    // più alta dichiarata sul TagDef).
    if !tag_write_allowed(&s.db, &id, user.role).await {
        s.audit.log(
            "tag.write_denied",
            Some(user.username),
            serde_json::json!({"tag": id.clone(), "role": user.role.as_str()}),
        );
        return StatusCode::FORBIDDEN.into_response();
    }
    // T-69: un tag CALCOLATO (espressione derivata o generatore attivo) non
    // accetta scritture utente — prima d'ora questo era solo un vincolo del
    // validatore statico (`validate.rs`), non applicato qui: una PUT diretta
    // su un tag derivato passava. Bug pre-esistente, corretto insieme alla
    // Fase D perché il nuovo `generator` doveva avere la stessa guardia.
    if s.db.is_computed(&id).await {
        s.audit.log(
            "tag.write_rejected_computed",
            Some(user.username),
            serde_json::json!({"tag": id}),
        );
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": format!("il tag «{id}» è calcolato (espressione o generatore): non è scrivibile")
            })),
        )
            .into_response();
    }
    // Q27: il `data_type` dichiarato è un contratto sui percorsi di scrittura
    // utente — coercizione senza perdita, rifiuto motivato del resto.
    let value = match s.db.coerce_for_write(&id, body.value).await {
        Ok(v) => v,
        Err(msg) => {
            s.audit.log(
                "tag.write_rejected_type",
                Some(user.username),
                serde_json::json!({"tag": id, "error": msg.clone()}),
            );
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response();
        }
    };
    s.audit.log(
        "tag.write",
        Some(user.username),
        serde_json::json!({
            "tag": id.clone(), "value": value.clone(), "reason": body.reason,
        }),
    );
    // Prefer routing through a plugin (so the value is pushed to the device).
    // If no plugin owns the tag (purely virtual / scripted tags), fall back to
    // setting the TagDb directly so the UI write path keeps working.
    // F1: verso il device viaggia il valore RAW (scaling inverso); il
    // fallback TagDb resta in unità ingegneristiche (nessuno lo ri-scala).
    let raw = s.db.scale_to_raw(&id, value.clone()).await;
    match s.bus.write(&id, raw).await {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(WriteError::NoWriter(_)) => {
            s.db.set(id, value, TagQuality::Good).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e @ WriteError::ChannelClosed(_)) => {
            warn!("write_tag: {e}");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

// ── Script execution ─────────────────────────────────────────────────────────
//
// Gli script girano in RestrictedPython con `safe_builtins` **quando la
// libreria è installata** (Q1, decisa e attiva). Attenzione: sul PC di sviluppo
// spesso NON lo è, e il motore ricade sull'esecuzione non ristretta — è il
// motivo per cui uno script con `import` passa sul PC e fallisce sul pannello.
//
// Quel che resta vero della nota originale: **questo endpoint non è gated**.
// L'assunzione è che la LAN sia privata, e va chiusa quando il PoC diventa
// prodotto (vedi Q8, punti E ed F).

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct ScriptBody {
    code: String,
}

#[derive(serde::Serialize, Default)]
struct ScriptResult {
    ok: bool,
    /// Captured stdout from the script (empty string if none).
    stdout: String,
    /// Captured stderr — including the formatted traceback when the script raised.
    stderr: String,
    /// True when the script ran through RestrictedPython.
    sandboxed: bool,
    /// Human-readable error string on failure / timeout.
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// `POST /api/script/check` — compila senza eseguire.
///
/// # Perché serviva
///
/// Prima di questo, l'unico modo di sapere se uno script Python stava in piedi
/// era **eseguirlo** (l'allora `/api/script/exec`, tolto con Q47): su un dispositivo in servizio vuol
/// dire accettare che una prova scriva i tag e faccia partire quel che lo script
/// fa partire. Qui non gira niente — nessun tag letto o scritto, nessun `print`,
/// nessun `send_telegram`, nessun timeout da armare.
///
/// Serve all'assistente per correggersi da sé, come già fa `valida` per la
/// struttura del progetto, e serve al maintainer anche senza assistente.
///
/// # Perché sta solo sul router admin
///
/// Non ha effetti — niente gira — ma è uno strumento di progettazione e il
/// viewer non ne ha bisogno.
async fn check_script(
    State(s): State<AppState>,
    Json(body): Json<ScriptBody>,
) -> Json<sws_pyscript::CheckOutput> {
    // Nessuna voce di audit: non c'è niente da attribuire, non essendoci nessun
    // effetto. `script.exec` la registra perché quella esegue.
    Json(s.py.check(body.code).await)
}

// ── Historian endpoints ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HistoryQuery {
    from: Option<u64>,
    to: Option<u64>,
    /// If provided, returns at most the last `limit` samples in the range.
    /// Legacy: tronca la coda senza decimare — per le finestre lunghe usare
    /// `bucket_ms` (F5.1), che aggrega invece di buttare l'inizio.
    limit: Option<usize>,
    /// F5.1: ampiezza del bucket di aggregazione in ms. Quando presente la
    /// risposta è `Vec<BucketSample>` (ts_ms/min/max/avg/first/last/count)
    /// invece di `Vec<Sample>` — ~un bucket per pixel qualunque sia la
    /// finestra, con la banda min/max che preserva i picchi.
    bucket_ms: Option<u64>,
    /// When true, transparently backfills from the OPC-UA server's historian
    /// for any tag that originates from an OPC-UA source. Merged with and
    /// deduplicated against the local historian samples.
    #[serde(default)]
    backfill: bool,
}

async fn get_history(
    State(s): State<AppState>,
    Path(tag): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    let mut samples = s.historian.query(&tag, q.from, q.to).await;

    if q.backfill {
        samples = opcua_backfill_history(&s, &tag, q.from, q.to, samples).await;
    }

    if let Some(bucket_ms) = q.bucket_ms {
        if bucket_ms == 0 {
            return (StatusCode::BAD_REQUEST, "bucket_ms must be > 0").into_response();
        }
        return Json(sws_historian::aggregate_samples(&samples, bucket_ms)).into_response();
    }

    if let Some(n) = q.limit {
        if samples.len() > n {
            samples = samples.split_off(samples.len() - n);
        }
    }
    Json(samples).into_response()
}

// ── Backfill di un xy_plot (F5.3x/T-70) ──────────────────────────────────────
//
// `x`/`y` sono due tag storicizzati indipendentemente: nessun timestamp in
// comune garantito. `sws_historian::merge_xy` fa il merge a riempimento
// (forward-fill), non un join — vedi i suoi test per il comportamento sui
// bordi (nessun punto prima che entrambe le serie abbiano un campione).

#[derive(Deserialize)]
struct HistoryXyQuery {
    x: String,
    y: String,
    from: Option<u64>,
    to: Option<u64>,
    /// Come `HistoryQuery::limit`: tronca la coda, non decima — le due serie
    /// sono già decimate singolarmente da `Historian::query` a monte del merge.
    limit: Option<usize>,
}

async fn get_history_xy(State(s): State<AppState>, Query(q): Query<HistoryXyQuery>) -> Response {
    let x_samples = s.historian.query(&q.x, q.from, q.to).await;
    let y_samples = s.historian.query(&q.y, q.from, q.to).await;
    let mut points = sws_historian::merge_xy(&x_samples, &y_samples);

    if let Some(n) = q.limit {
        if points.len() > n {
            points = points.split_off(points.len() - n);
        }
    }
    Json(points).into_response()
}

// ── Feature #4: CSV export ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExportCsvQuery {
    /// Comma-separated list of tag IDs.
    tags: Option<String>,
    from_ms: Option<u64>,
    to_ms: Option<u64>,
}

/// GET /api/history/export?tags=a,b&from_ms=&to_ms=
/// Returns a CSV file with columns: ts_ms,ts_iso,tag_id,value,quality.
/// `ts_iso` is RFC 3339 UTC (e.g. 2026-05-22T10:30:00.000Z).
async fn export_history_csv(
    State(s): State<AppState>,
    Query(q): Query<ExportCsvQuery>,
) -> impl IntoResponse {
    let tag_list: Vec<String> = q
        .tags
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect();

    if tag_list.is_empty() {
        return (StatusCode::BAD_REQUEST, "tag parameter 'tags' required").into_response();
    }

    struct Row {
        ts_ms: u64,
        tag: String,
        val: String,
        quality: &'static str,
    }
    let mut rows: Vec<Row> = Vec::new();

    for tag in &tag_list {
        let samples = s.historian.query(tag, q.from_ms, q.to_ms).await;
        for sample in samples {
            let val = match &sample.value {
                TagValue::Float(f) => format!("{f}"),
                TagValue::Int(i) => format!("{i}"),
                TagValue::Bool(b) => {
                    if *b {
                        "1".into()
                    } else {
                        "0".into()
                    }
                }
                // Fase 1b: nel CSV un composito esce come JSON quotato.
                v @ (TagValue::Array(_) | TagValue::Struct(_)) => {
                    let j = serde_json::to_string(v).unwrap_or_default();
                    format!("\"{}\"", j.replace('"', "\"\""))
                }
                TagValue::Str(s) => format!("\"{s}\""),
            };
            let quality = match sample.quality {
                TagQuality::Good => "Good",
                TagQuality::Bad => "Bad",
                TagQuality::Uncertain => "Uncertain",
            };
            rows.push(Row {
                ts_ms: sample.ts_ms,
                tag: tag.clone(),
                val,
                quality,
            });
        }
    }

    rows.sort_by_key(|r| r.ts_ms);

    let mut csv = String::from("ts_ms,ts_iso,tag_id,value,quality\n");
    for r in &rows {
        let iso = ms_to_iso(r.ts_ms);
        csv.push_str(&format!(
            "{},{},{},{},{}\n",
            r.ts_ms, iso, r.tag, r.val, r.quality
        ));
    }

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"export.csv\"",
            ),
        ],
        csv,
    )
        .into_response()
}

/// Convert a Unix millisecond timestamp to a compact ISO 8601 UTC string
/// (e.g. "2026-05-22T10:30:00.123Z") without requiring the `formatting`
/// feature of the `time` crate.
fn ms_to_iso(ts_ms: u64) -> String {
    use time::OffsetDateTime;
    let secs = (ts_ms / 1000) as i64;
    let millis = (ts_ms % 1000) as u32;
    match OffsetDateTime::from_unix_timestamp(secs) {
        Ok(dt) => {
            let mo = dt.month() as u8;
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
                dt.year(),
                mo,
                dt.day(),
                dt.hour(),
                dt.minute(),
                dt.second(),
                millis
            )
        }
        Err(_) => format!("{ts_ms}"),
    }
}

// ── Feature #5: Statistiche aggregate ────────────────────────────────────────

#[derive(Deserialize)]
struct StatsQuery {
    from_ms: Option<u64>,
    to_ms: Option<u64>,
}

#[derive(serde::Serialize)]
struct HistoryStats {
    tag: String,
    count: usize,
    min: f64,
    max: f64,
    avg: f64,
    stddev: f64,
    first_ts: Option<u64>,
    last_ts: Option<u64>,
}

/// GET /api/history/:tag/stats?from_ms=&to_ms=
async fn tag_history_stats(
    State(s): State<AppState>,
    Path(tag): Path<String>,
    Query(q): Query<StatsQuery>,
) -> impl IntoResponse {
    let samples = s.historian.query(&tag, q.from_ms, q.to_ms).await;

    let nums: Vec<f64> = samples
        .iter()
        .filter_map(|s| match &s.value {
            TagValue::Float(f) => Some(*f),
            TagValue::Int(i) => Some(*i as f64),
            TagValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            TagValue::Str(v) => v.trim().parse().ok(),
            // Fase 1b: un composito non entra in una statistica.
            TagValue::Array(_) | TagValue::Struct(_) => None,
        })
        .collect();

    if nums.is_empty() {
        return Json(HistoryStats {
            tag,
            count: 0,
            min: 0.0,
            max: 0.0,
            avg: 0.0,
            stddev: 0.0,
            first_ts: None,
            last_ts: None,
        })
        .into_response();
    }

    let count = nums.len();
    let min = nums.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let avg = nums.iter().sum::<f64>() / count as f64;
    let variance = nums.iter().map(|v| (v - avg).powi(2)).sum::<f64>() / count as f64;
    let stddev = variance.sqrt();

    Json(HistoryStats {
        tag,
        count,
        min,
        max,
        avg,
        stddev,
        first_ts: samples.first().map(|s| s.ts_ms),
        last_ts: samples.last().map(|s| s.ts_ms),
    })
    .into_response()
}

/// If `tag` is subscribed from an OPC-UA source, query that server's historian
/// and merge the results with the existing local `samples`. No-ops silently when
/// the project can't be loaded or the tag has no OPC-UA source.
async fn opcua_backfill_history(
    s: &AppState,
    tag: &str,
    from_ms: Option<u64>,
    to_ms: Option<u64>,
    mut local: Vec<Sample>,
) -> Vec<Sample> {
    let Ok(dir) = active_dir(s).await else {
        return local;
    };
    let Ok(project) = sws_core::project::Project::load(&dir) else {
        return local;
    };

    // Find the OPC-UA source that maps this tag to a node_id.
    for source in &project.sources {
        let SourceDef::OpcUaClient(cfg) = source else {
            continue;
        };
        let Some(mapping) = cfg.nodes.iter().find(|n| n.tag == tag) else {
            continue;
        };

        match sws_plugin_opcua::read_history(cfg, &mapping.node_id, from_ms, to_ms, 1000).await {
            Ok(hist) => {
                // Build the set of timestamps already in local storage to
                // avoid adding duplicates for the overlap period.
                let local_ts: std::collections::HashSet<u64> =
                    local.iter().map(|s| s.ts_ms).collect();
                for h in hist {
                    if local_ts.contains(&h.ts_ms) {
                        continue;
                    }
                    local.push(Sample {
                        ts_ms: h.ts_ms,
                        value: TagValue::Float(h.value),
                        quality: match h.quality {
                            "Good" => TagQuality::Good,
                            "Bad" => TagQuality::Bad,
                            _ => TagQuality::Uncertain,
                        },
                    });
                }
                local.sort_unstable_by_key(|s| s.ts_ms);
                return local;
            }
            Err(e) => {
                warn!(tag = %tag, node = %mapping.node_id, "opcua history backfill: {e}");
                return local;
            }
        }
    }
    local
}

// ── Datastore endpoints ──────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct DatastoreListItem {
    id: String,
    connected: bool,
    error: Option<String>,
}

async fn list_datastores(State(s): State<AppState>) -> Json<Vec<DatastoreListItem>> {
    if let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) {
        let stats = reg.all_stats().await;
        return Json(
            stats
                .into_iter()
                .map(|(id, st)| DatastoreListItem {
                    id,
                    connected: st.connected,
                    error: st.error,
                })
                .collect(),
        );
    }
    Json(vec![])
}

/// Load a datastore backend from project.yaml for one-shot ops (test / stats).
async fn backend_from_project(
    s: &AppState,
    id: &str,
) -> Result<sws_historian::DatastoreBackend, Response> {
    let dir = active_dir(s).await.map_err(|c| c.into_response())?;
    let project = sws_core::project::Project::load(&dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("cannot load project: {e}"),
        )
            .into_response()
    })?;
    let cfg = project
        .datastores
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| {
            (StatusCode::NOT_FOUND, format!("datastore '{id}' not found")).into_response()
        })?;
    sws_historian::DatastoreBackend::from_config(&cfg.backend, &dir)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("cannot connect: {e}")).into_response())
}

async fn datastore_stats(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    // Live registry first; fall back to one-shot query from project config.
    if let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) {
        if let Some(stats) = reg.backend_stats(&id).await {
            if let Some(ref err) = stats.error {
                warn!(datastore_id = %id, "datastore stats error: {err}");
            }
            return Json(stats).into_response();
        }
    }
    match backend_from_project(&s, &id).await {
        Ok(backend) => {
            let stats = backend.stats().await;
            if let Some(ref err) = stats.error {
                warn!(datastore_id = %id, "datastore stats error: {err}");
            }
            Json(stats).into_response()
        }
        Err(r) => r,
    }
}

async fn datastore_test(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    // Live registry first.
    if let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) {
        if reg.backend_ids().contains(&id) {
            return match reg.test_backend(&id).await {
                Ok(msg) => Json(msg).into_response(),
                Err(e) => {
                    warn!(datastore_id = %id, "datastore test failed: {e}");
                    (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
                }
            };
        }
    }
    // Not in registry — one-shot test from project config (common when the
    // user just saved a new datastore and clicks Test before restarting).
    match backend_from_project(&s, &id).await {
        Ok(backend) => match backend.test().await {
            Ok(msg) => Json(msg).into_response(),
            Err(e) => {
                warn!(datastore_id = %id, "datastore test failed: {e}");
                (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
            }
        },
        Err(r) => r,
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct PurgeBody {
    retention_rows: Option<u64>,
    retention_days: Option<u64>,
}

async fn datastore_purge(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PurgeBody>,
) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    match reg
        .purge_backend(&id, body.retention_rows, body.retention_days)
        .await
    {
        Ok(n) => Json(serde_json::json!({ "deleted": n })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `GET /api/datastores/:id/tags` — tag presenti nel database, con l'indicazione
/// di quali sono **orfani**: hanno campioni ma il runtime non conosce più quel
/// tag, tipicamente dopo una rinomina o una rimozione dal progetto. Il loro
/// storico occupa spazio e non è raggiungibile da nessuna pagina.
///
/// Il confronto usa i tag che il runtime ha davvero in memoria (`TagDb`), non
/// solo `project.tags`: in molti progetti i tag nascono dalle mappature delle
/// sorgenti, e confrontarsi con la sola lista dichiarata marcherebbe come orfani
/// tag perfettamente in uso.
async fn datastore_tags(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    let db_tags = match reg.list_backend_tags(&id).await {
        Ok(t) => t,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let live: std::collections::HashSet<String> = s.db.snapshot().await.keys().cloned().collect();
    let orphan: Vec<String> = db_tags
        .iter()
        .filter(|t| !live.contains(*t))
        .cloned()
        .collect();
    Json(serde_json::json!({ "db_tags": db_tags, "orphan_tags": orphan })).into_response()
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct DeleteTagBody {
    tag: String,
}

/// `POST /api/datastores/:id/delete-tag` — cancella lo storico di un tag.
/// Irreversibile e audit-logged: è una cancellazione di dati su richiesta admin.
async fn datastore_delete_tag(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
    Json(body): Json<DeleteTagBody>,
) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    s.audit.log(
        "datastore.delete_tag",
        Some(user.username),
        serde_json::json!({
            "datastore": id.clone(), "tag": body.tag.clone(),
        }),
    );
    match reg.delete_backend_tag(&id, &body.tag).await {
        Ok(n) => Json(serde_json::json!({ "deleted": n })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/datastores/:id/vacuum` — recupera lo spazio su disco.
/// Ritorna le dimensioni prima e dopo: senza quelle non si distingue un VACUUM
/// riuscito da uno che non aveva nulla da liberare.
async fn datastore_vacuum(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    s.audit.log(
        "datastore.vacuum",
        Some(user.username),
        serde_json::json!({ "datastore": id.clone() }),
    );
    match reg.vacuum_backend(&id).await {
        Ok((before, after)) => Json(serde_json::json!({
            "bytes_before": before, "bytes_after": after,
            "bytes_freed": before.saturating_sub(after),
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct ExportQuery {
    tags: Option<String>, // comma-separated tag ids
    from_ms: Option<u64>,
    to_ms: Option<u64>,
}

#[derive(serde::Serialize)]
struct ExportTagResult {
    tag_id: String,
    samples: Vec<Sample>,
}

async fn datastore_export(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<ExportQuery>,
) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    let tags: Vec<String> = q
        .tags
        .unwrap_or_default()
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    match reg.export_backend(&id, &tags, q.from_ms, q.to_ms).await {
        Ok(pairs) => {
            let out: Vec<ExportTagResult> = pairs
                .into_iter()
                .map(|(tag_id, samples)| ExportTagResult { tag_id, samples })
                .collect();
            Json(out).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// GET /api/datastores/:id/download — raw SQLite database file, for
/// archiving. Uses `VACUUM INTO` (via `download_backend`) to produce a
/// consistent point-in-time copy in a temp file instead of reading the live
/// file directly — the live file is in WAL mode with continuous writes, so a
/// plain byte-copy could capture a torn/inconsistent snapshot.
async fn datastore_download(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp_path = std::env::temp_dir().join(format!("sws-datastore-{id}-{now_ms}.db"));

    if let Err(e) = reg.download_backend(&id, &tmp_path).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }

    let bytes = tokio::fs::read(&tmp_path).await;
    let _ = tokio::fs::remove_file(&tmp_path).await; // best-effort cleanup
    match bytes {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{id}.db\""),
            )
            .body(axum::body::Body::from(bytes))
            .unwrap(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Serialize)]
struct DatastoreUploadResult {
    bytes_written: usize,
    backup_path: String,
    requires_restart: bool,
}

/// POST /api/datastores/:id/upload — replace the database file with the
/// uploaded bytes (raw `application/octet-stream` body, same convention as
/// `import_project_zip`). Keeps a timestamped backup of the previous file.
/// Does **not** hot-swap the live connection — an already-open `SqliteStore`
/// keeps writing to the old (renamed-away) file until the process restarts,
/// so the response always reports `requires_restart: true` and the caller
/// must surface that to the user.
async fn datastore_upload(
    State(s): State<AppState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    match reg.replace_backend_file(&id, body.to_vec()).await {
        Ok(backup_path) => Json(DatastoreUploadResult {
            bytes_written: body.len(),
            backup_path: backup_path.display().to_string(),
            requires_restart: true,
        })
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── Alarm endpoints ──────────────────────────────────────────────────────────

async fn get_alarms(State(s): State<AppState>) -> Json<Vec<AlarmState>> {
    Json(s.alarms.snapshot().await)
}

#[derive(serde::Deserialize, Default)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct AckRequest {
    #[serde(default)]
    by: Option<String>,
    /// F7.5 — motivo/commento della conferma. Non entra nell'AlarmEvent (che
    /// vive nello storico allarmi e avrebbe richiesto una migrazione dello
    /// schema): finisce nel journal di audit, che è già il registro
    /// hash-chained di chi-ha-fatto-cosa ed è interrogabile da /api/audit.
    #[serde(default)]
    reason: Option<String>,
}

async fn ack_alarm(
    State(s): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<AckRequest>>,
) -> StatusCode {
    let (by, reason) = match body {
        Some(Json(b)) => (b.by, b.reason),
        None => (None, None),
    };
    // Registrato prima dell'esito: un ack su un id inesistente è comunque un
    // tentativo che vale la pena vedere nel journal.
    s.audit.log(
        "alarm.ack",
        by.clone(),
        serde_json::json!({
            "alarm": id.clone(), "reason": reason,
        }),
    );
    if s.alarms.ack(&id, by).await {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Audit log (OPEN_QUESTIONS Q8) ────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct AuditQuery {
    #[serde(default = "default_audit_limit")]
    limit: usize,
}
fn default_audit_limit() -> usize {
    200
}

/// `GET /api/audit?limit=N` (Admin) — most recent N entries of the append-only
/// audit trail, oldest first within the window.
async fn get_audit_tail(
    State(s): State<AppState>,
    Query(q): Query<AuditQuery>,
) -> Json<Vec<sws_audit::AuditEntry>> {
    Json(s.audit.tail(q.limit).await)
}

/// `GET /api/audit/verify` (Admin) — re-reads the on-disk log and checks the
/// hash chain (+ HMAC signature, when SWS_AUDIT_KEY is set) end to end.
async fn get_audit_verify(State(s): State<AppState>) -> Json<sws_audit::VerifyReport> {
    Json(s.audit.verify_self().await)
}

#[derive(serde::Deserialize, Default)]
struct AlarmHistoryQuery {
    alarm_id: Option<String>,
    from_ms: Option<u64>,
    to_ms: Option<u64>,
    #[serde(default = "default_limit")]
    limit: usize,
}
fn default_limit() -> usize {
    200
}

async fn get_alarm_history(
    State(s): State<AppState>,
    Query(q): Query<AlarmHistoryQuery>,
) -> Json<Vec<AlarmEvent>> {
    // Try SQLite first; fall back to in-memory journal.
    let events = if let Some(store) = s.historian.sqlite_store().await {
        store
            .query_alarm_events(q.alarm_id.as_deref(), q.from_ms, q.to_ms, q.limit)
            .await
    } else {
        s.alarms.journal_snapshot(q.limit).await
    };
    Json(events)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct ShelveRequest {
    reason: String,
    /// Duration in milliseconds; 0 = indefinite.
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    shelved_by: String,
}

async fn shelve_alarm(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ShelveRequest>,
) -> StatusCode {
    if s.alarms
        .shelve(&id, body.reason, body.duration_ms, body.shelved_by)
        .await
    {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn unshelve_alarm(State(s): State<AppState>, Path(id): Path<String>) -> StatusCode {
    s.alarms.unshelve(&id).await;
    StatusCode::NO_CONTENT
}

async fn list_shelved_alarms(State(s): State<AppState>) -> Json<Vec<sws_core::ShelvedAlarm>> {
    Json(s.alarms.shelved_snapshot().await)
}

async fn ws_alarms_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_alarms_ws(socket, s.alarms))
}

async fn handle_alarms_ws(mut socket: WebSocket, alarms: Arc<AlarmDb>) {
    // Send the current snapshot first so a fresh client sees the full state,
    // then forward live broadcasts.
    for state in alarms.snapshot().await {
        if let Ok(text) = serde_json::to_string(&state) {
            if socket.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
    }
    let mut rx = alarms.subscribe();
    loop {
        match rx.recv().await {
            Ok(state) => {
                if let Ok(text) = serde_json::to_string(&state) {
                    if socket.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!("ws/alarms subscriber lagged by {n}");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ── Project endpoints ─────────────────────────────────────────────────────────

/// Marker the API substitutes for stored MQTT passwords on GET responses.
/// The PUT handler treats this exact string as "keep the previous value"
/// so a round-trip GET → edit → PUT through the editor doesn't accidentally
/// wipe a secret the operator can't see.
pub(crate) const MASKED_PASSWORD: &str = "********";

/// La versione corrente di `project.yaml`: l'hash SHA-256 dei suoi byte, in
/// forma corta.
///
/// # Perché un hash e non un contatore (Q30)
///
/// Un contatore vorrebbe un posto dove vivere. In memoria si azzera a ogni
/// riavvio, e una scheda rimasta aperta si ritroverebbe un token che *combacia*
/// per caso — cioè la protezione salta proprio quando il runtime è ripartito
/// sotto i piedi di qualcuno. Dentro `project.yaml` sarebbe un campo nuovo che
/// viaggia col progetto nei deploy e negli export, per un dato che non riguarda
/// il progetto ma la sessione di chi lo modifica.
///
/// L'hash dei byte non ha nessuno dei due problemi: è esatto, sopravvive ai
/// riavvii, non aggiunge niente al file e si calcola da un testo che
/// `patch_project` **ha già in mano**.
///
/// Dell'hash del solo `project.yaml`, e non di `calcola_impronta`, che include
/// anche tutti i sinottici: con quella granularità chi salva un tag prenderebbe
/// un 409 perché un altro ha spostato un rettangolo su un'altra pagina, e un
/// conflitto che scatta quando non c'è conflitto insegna a ignorarlo.
pub(crate) fn versione_di(testo: &str) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(testo.as_bytes());
    d.iter().take(8).fold(String::new(), |mut acc, b| {
        acc.push_str(&format!("{b:02x}"));
        acc
    })
}

/// Mette l'`ETag` su una risposta che consegna un file di progetto, calcolato
/// dal **testo con cui la risposta è stata costruita**.
///
/// Dal testo e non da una seconda lettura del file: fra le due qualcuno può
/// scrivere, e il client si porterebbe via una versione più nuova dei dati che
/// ha in mano — cioè un salvataggio che passa quando doveva essere rifiutato.
pub(crate) fn con_versione(mut r: Response, testo: &str) -> Response {
    if let Ok(hv) = axum::http::HeaderValue::from_str(&format!("\"{}\"", versione_di(testo))) {
        r.headers_mut().insert(axum::http::header::ETAG, hv);
    }
    r
}

/// Il 409 da restituire se `attesa` non combacia con quello che c'è sul disco;
/// `None` quando si può scrivere.
///
/// `attesa: None` — nessun `If-Match` — significa nessun controllo, cioè il
/// comportamento di prima: uno script o un `curl` non si rompono, e la
/// protezione vale per chi la chiede.
///
/// `cosa` finisce nel messaggio: «questa pagina», «questo faceplate». Un 409
/// che non dice *cosa* è cambiato manda a cercare.
pub(crate) fn conflitto_di_versione(
    attesa: Option<&str>,
    su_disco: Option<&str>,
    cosa: &str,
) -> Option<Response> {
    let attesa = attesa?;
    let corrente = su_disco.map(versione_di);
    if corrente.as_deref() == Some(attesa) {
        return None;
    }
    let mut r = (
        StatusCode::CONFLICT,
        format!(
            "{cosa} è stato modificato da qualcun altro mentre lavoravi, e il salvataggio è \
             stato rifiutato per non cancellare le sue modifiche.\n\nRicarica il progetto per \
             vedere cosa è cambiato, poi rifai la tua modifica."
        ),
    )
        .into_response();
    // Lo stesso header del conflitto su `project.yaml`: il client ha un solo
    // modo di riconoscere «sei partito da dati vecchi», qualunque file sia.
    r.headers_mut().insert(
        "x-sws-conflitto",
        axum::http::HeaderValue::from_static("versione"),
    );
    Some(r)
}

/// L'header `If-Match` della richiesta, se c'è. Assente = nessun controllo di
/// versione, che è il comportamento di prima: uno script o un `curl` non si
/// rompono, e la protezione vale per chi la chiede.
pub(crate) fn versione_attesa(h: &axum::http::HeaderMap) -> Option<String> {
    h.get(axum::http::header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_matches('"').to_string())
}

async fn get_project(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(code) => return code.into_response(),
    };
    // Q30: la versione va letta **dallo stesso testo** da cui si costruisce la
    // risposta, non da una seconda lettura del file: fra le due qualcuno può
    // scrivere, e il client si porterebbe via una versione più nuova dei dati
    // che ha in mano — cioè un salvataggio che passa quando doveva essere
    // rifiutato. È il difetto che un `GET /api/project/versione` separato
    // avrebbe avuto per costruzione.
    let testo = tokio::fs::read_to_string(dir.join("project.yaml"))
        .await
        .ok();
    let versione = testo.as_deref().map(versione_di);
    // `Project::load` è read_to_string + `serde_yaml::from_str`: qui si fa la
    // seconda metà sul testo che abbiamo già, così i dati e la versione vengono
    // dalla **stessa** lettura. Se il file non si è letto si ricade su `load`,
    // che produce il messaggio d'errore buono.
    let caricato = match testo.as_deref() {
        Some(t) => serde_yaml::from_str::<Project>(t)
            .map_err(|e| anyhow::anyhow!("parsing project.yaml: {e}")),
        None => Project::load(&dir),
    };
    match caricato {
        Ok(mut project) => {
            // I segreti vivono in `secrets.yaml`: senza rimetterli dentro,
            // `maschera` non trova niente da mascherare e i campi escono
            // **assenti** invece che col segnaposto. Sembra innocuo e non lo
            // è: l'IDE non può rimandare indietro un campo che non ha
            // ricevuto, quindi il ripristino del segnaposto (2f) non ha niente
            // da riconoscere e al primo salvataggio della sezione la
            // credenziale sparisce. Misurato il 23-09-2026 rinominando un
            // datastore ODBC: l'etichetta cambiava e la stringa di
            // connessione se ne andava.
            if let Ok(Some(seg)) = sws_core::segreti::leggi_segreti(&dir) {
                sws_core::segreti::applica(&mut project, &seg);
            }
            mask_project_secrets(&mut project);
            let mut r = Json(project).into_response();
            if let Some(v) = versione {
                if let Ok(hv) = axum::http::HeaderValue::from_str(&format!("\"{v}\"")) {
                    r.headers_mut().insert(axum::http::header::ETAG, hv);
                }
            }
            r
        }
        Err(e) => {
            tracing::error!("project load failed: {e:#}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("project parse error: {e}"),
            )
                .into_response()
        }
    }
}

/// Sostituisce ogni campo sensibile del progetto con [`MASKED_PASSWORD`]
/// prima che venga serializzato verso chi l'ha chiesto.
///
/// Passo 2, 2f: fino al 22-09-2026 questa funzione aveva un elenco di campi
/// suo, e ne copriva **tre su sette** — token HomeAssistant, password del
/// client OPC-UA, password Postgres e stringa di connessione ODBC uscivano in
/// chiaro verso il browser (`GET /api/project`) e verso il fornitore LLM
/// esterno (`leggi_progetto`). Ora delega a `sws_core::segreti`, che la
/// tabella dei campi segreti ce l'ha già: un elenco solo, e il prossimo campo
/// segreto è mascherato dal giorno in cui entra nella tabella.
pub(crate) fn mask_project_secrets(project: &mut Project) {
    sws_core::segreti::maschera(project, MASKED_PASSWORD);
}

/// Read project.yaml (or build a minimal default), apply `f`, write back.
/// Applica `f` al progetto su disco e riscrive `project.yaml`.
///
/// Tre garanzie, tutte nate da perdite di dati reali:
///
/// 1. **Non si scrive mai un progetto che non si è riusciti a leggere.** Prima
///    un `project.yaml` illeggibile veniva sostituito da un progetto *vuoto*
///    chiamato "default": il file sopravviveva all'apertura con un avviso nel
///    log, e il primo salvataggio in qualunque tab lo azzerava. Un file assente
///    resta invece il caso legittimo di un progetto nuovo, e viene creato.
/// 2. **Le sorgenti che la struttura tipizzata non sa leggere si conservano.**
///    `deserialize_sources_tolerant` le scarta di proposito (forward-compat), ma
///    scartarle in lettura e riscrivere senza di loro significa cancellarle.
/// 3. **Le chiavi di primo livello sconosciute si conservano.** Così un
///    `project.yaml` scritto da una versione più nuova si apre su una più vecchia
///    *e sopravvive a un salvataggio*, che è la forward-compat che il punto 2
///    prometteva solo a metà.
///
/// Restituisce una `Response` e non uno `StatusCode` perché il rifiuto del punto
/// 1 deve poter spiegare cosa è successo: un 500 muto porterebbe l'utente a
/// riprovare, ed è l'unico caso in cui riprovare non serve a niente.
pub(crate) async fn patch_project<F>(
    lock: &tokio::sync::Mutex<()>,
    project_dir: &std::path::Path,
    f: F,
) -> Response
where
    F: FnOnce(&mut Project),
{
    patch_project_se(lock, project_dir, None, f).await
}

/// Come [`patch_project`], ma rifiuta se `project.yaml` è cambiato rispetto
/// alla versione `attesa` (Q30, la seconda metà).
///
/// # Cosa aggiunge al lock
///
/// Il lock impedisce a due scritture di **interlacciarsi**; non impedisce a
/// una scritta su dati vecchi di cancellare quella di prima. I `PUT` di sezione
/// sostituiscono l'elenco intero, quindi due schede che hanno caricato entrambe
/// le variabili e salvano una dopo l'altra si serializzano ordinatamente e la
/// seconda cancella comunque il lavoro della prima. Nessun lock può vederlo:
/// serve sapere **su cosa** si stava lavorando.
///
/// `attesa` è `None` per chi non porta un `If-Match`, e in quel caso si
/// comporta esattamente come prima: uno script o un `curl` non si rompono, e la
/// protezione vale per chi la chiede.
///
/// Il confronto sta **dentro** il lock, e non è un dettaglio: fuori, fra il
/// controllo e la scrittura passerebbe l'altra scrittura, e il 409 arriverebbe
/// a volte sì e a volte no.
pub(crate) async fn patch_project_se<F>(
    lock: &tokio::sync::Mutex<()>,
    project_dir: &std::path::Path,
    attesa: Option<String>,
    f: F,
) -> Response
where
    F: FnOnce(&mut Project),
{
    // Q30: il lock copre **tutto** il leggi-modifica-scrivi, non la sola
    // scrittura. Prenderlo più in basso non servirebbe a niente: la corsa sta
    // fra la lettura di uno e la scrittura dell'altro, non fra le due
    // scritture. Passato come parametro e non preso da un `static` perché è
    // `AppState::project_write_lock`, dove è documentato insieme agli altri due
    // e dove si vede — vedi lì per l'ordine dei lock e la non-rientranza.
    let _scrittura = lock.lock().await;
    let path = project_dir.join("project.yaml");
    // Il testo grezzo serve due volte: per distinguere "assente" da "illeggibile",
    // e per recuperare ciò che la struttura tipizzata non rappresenta.
    let raw_text = tokio::fs::read_to_string(&path).await.ok();

    // Q30: la versione si calcola dal testo appena letto **sotto il lock**.
    if let Some(attesa) = attesa {
        let corrente = raw_text.as_deref().map(versione_di);
        if corrente.as_deref() != Some(attesa.as_str()) {
            // L'header distingue **questo** 409 dagli altri che questa API
            // produce già — «project.yaml non è caricabile», «un deploy è in
            // corso» — senza che il client debba riconoscerli dal testo, che è
            // tradotto e riscrivibile. Un client che non lo guarda mostra il
            // messaggio e basta, che è il comportamento giusto per default.
            let mut r = (
                StatusCode::CONFLICT,
                "Questa sezione è stata modificata da qualcun altro mentre lavoravi, e il \
                 salvataggio è stato rifiutato per non cancellare le sue modifiche.\n\n\
                 Ricarica il progetto per vedere cosa è cambiato, poi rifai la tua modifica.",
            )
                .into_response();
            r.headers_mut().insert(
                "x-sws-conflitto",
                axum::http::HeaderValue::from_static("versione"),
            );
            return r;
        }
    }

    let mut project = match &raw_text {
        Some(text) => match serde_yaml::from_str::<Project>(text) {
            Ok(p) => p,
            Err(e) => {
                warn!(path = %path.display(), "patch_project: project.yaml non caricabile, salvataggio rifiutato: {e}");
                return (
                    StatusCode::CONFLICT,
                    format!(
                        "project.yaml non è caricabile e il salvataggio è stato rifiutato per non \
                         sovrascriverlo: il file su disco è intatto.\n\nErrore: {e}\n\nCorreggi il \
                         file a mano oppure ripristina un backup dalla tab Backup.",
                    ),
                )
                    .into_response();
            }
        },
        // Nessun file: progetto nuovo, si crea.
        None => Project {
            meta: ProjectMeta {
                name: "default".into(),
                version: "0.1.0".into(),
            },
            // Progetto vuoto: sorgenti non ce ne sono, niente da rivedere.
            sorgenti_da_rivedere: false,
            types: vec![],
            tags: vec![],
            sources: vec![],
            alarms: vec![],
            functions: vec![],
            custom_symbols: vec![],
            datastores: vec![],
            global_scripts: vec![],
            notifications: None,
            saved_by: None,
            languages: Default::default(),
            page_layout: None,
            target: None,
            auto_backup_interval_minutes: None,
            auto_backup_retention: None,
        },
    };
    // I segreti che il progetto ha già, rimessi dentro prima della modifica.
    //
    // Senza questo, `estrai` più sotto vedeva **solo** il segreto che la
    // sezione appena salvata ha portato, e `scrivi_segreti` riscriveva
    // `secrets.yaml` con quello solo: configurare un database con password
    // cancellava il token Telegram, e viceversa. Il difetto era per giunta
    // intermittente — un salvataggio che non porta segreti lascia la mappa
    // vuota e non scrive niente, quindi sembrava funzionare finché non si
    // salvavano due sezioni con credenziali diverse. Misurato il 23-09-2026
    // sul progetto di prova, con Telegram e un datastore ODBC.
    //
    // I segreti non tornano in `project.yaml`: `estrai` li toglie prima della
    // serializzazione, che è l'invariante del 2b.
    let segreti_esistenti = match sws_core::segreti::leggi_segreti(project_dir) {
        Ok(v) => v.unwrap_or_default(),
        Err(e) => {
            warn!(dir = %project_dir.display(), "patch_project: secrets.yaml non leggibile: {e}");
            return (
                StatusCode::CONFLICT,
                format!(
                    "secrets.yaml non è leggibile e il salvataggio è stato rifiutato per non \
                     cancellare le credenziali: i file su disco sono intatti.\n\nErrore: {e}",
                ),
            )
                .into_response();
        }
    };
    sws_core::segreti::applica(&mut project, &segreti_esistenti);

    // Le chiavi che la struttura tipizzata produce **prima** della modifica.
    //
    // Servono a distinguere due cose che altrimenti si somigliano: una chiave
    // che il file ha e la struttura non conosce (va conservata), e una chiave
    // che la struttura conosce e che è stata appena azzerata (va cancellata).
    // Entrambe, dopo la modifica, mancano dalla serializzazione.
    //
    // Si ricava serializzando invece di tenere un elenco a mano: un elenco si
    // disallinea al primo campo nuovo, e il modo in cui si romperebbe è
    // silenzioso — quel campo diventerebbe semplicemente incancellabile.
    let known_before = serde_yaml::to_string(&project)
        .ok()
        .and_then(|y| serde_yaml::from_str::<serde_yaml::Value>(&y).ok())
        .and_then(|v| v.as_mapping().cloned())
        .map(|m| m.keys().cloned().collect::<std::collections::HashSet<_>>())
        .unwrap_or_default();

    f(&mut project);
    if let Err(e) = tokio::fs::create_dir_all(project_dir).await {
        warn!("cannot create project dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    // Passo 2, sotto-passo 2b: i sette segreti escono dal progetto **prima**
    // di serializzarlo, e vanno su `secrets.yaml` (atomico, 0600) — mai su
    // `project.yaml`, che da qui in poi patch_project_se scrive sempre senza.
    // Deve succedere PRIMA della `stamp_and_serialize` sotto: un handler di
    // sezione (`update_project_notifications`, `update_project_sources`…)
    // scrive nel `Project` tipizzato attraverso `f`, quindi il segreto nuovo
    // che l'utente ha appena digitato è lì, non nel testo grezzo che
    // `merge_preserved` conserva.
    // Si scrive **sempre**, anche a mappa vuota: `scrivi_segreti` in quel caso
    // cancella il file, ed è l'unico modo perché una credenziale tolta
    // dall'IDE sparisca davvero dal disco. Prima la scrittura era condizionata
    // a `!segreti.is_empty()` e l'ultima credenziale rimossa restava lì.
    let segreti = sws_core::segreti::estrai(&mut project);
    {
        let dir = project_dir.to_path_buf();
        let esito =
            tokio::task::spawn_blocking(move || sws_core::segreti::scrivi_segreti(&dir, &segreti))
                .await;
        if let Err(e) = esito.map_err(anyhow::Error::from).and_then(|r| r) {
            // Se secrets.yaml non si scrive, project.yaml (che ormai non ha
            // più il segreto) NON si scrive: il segreto resterebbe solo in
            // memoria e sparirebbe al prossimo riavvio. Meglio rifiutare il
            // salvataggio — il vecchio project.yaml (col segreto ancora in
            // chiaro, o quello di prima) resta intatto sul disco.
            warn!("write secrets.yaml: {e:#}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "il salvataggio dei segreti è fallito: nessuna modifica è stata scritta",
            )
                .into_response();
        }
    }
    let yaml = match project.stamp_and_serialize() {
        Ok(y) => y,
        Err(e) => {
            warn!("serialize project: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let yaml = match raw_text.as_deref() {
        Some(raw) => merge_preserved(&yaml, raw, &known_before),
        None => yaml,
    };
    // La versione nuova viaggia nella risposta: senza, la scheda che ha appena
    // salvato conserverebbe quella vecchia e il **suo** salvataggio successivo
    // prenderebbe un 409 contro se stessa.
    let nuova = versione_di(&yaml);
    match scrivi_atomico(&path, yaml.as_bytes()).await {
        Ok(()) => {
            let mut r = StatusCode::NO_CONTENT.into_response();
            if let Ok(hv) = axum::http::HeaderValue::from_str(&format!("\"{nuova}\"")) {
                r.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            r
        }
        Err(e) => {
            warn!(path = %path.display(), "write project.yaml: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// Scrive `path` in modo che sul disco ci sia sempre **o** il contenuto vecchio
/// intero **o** quello nuovo intero, mai mezzo.
///
/// Un `fs::write` diretto tronca il file e poi lo riempie: se il processo muore
/// in mezzo, o il disco è pieno, resta un `project.yaml` a metà. Non è un guaio
/// come un altro — `patch_project` a quel punto **rifiuta ogni salvataggio
/// successivo** (il ramo 409 «project.yaml non è caricabile», che esiste
/// proprio per non peggiorare le cose), quindi il progetto si riapre solo da un
/// backup. Su ext4 e ubifs il `rename` dentro la stessa directory è atomico.
///
/// Il temporaneo sta accanto al file, e non in `/tmp`: `rename` fra filesystem
/// diversi non esiste. Il suffisso `.tmp` non entra nei backup, che copiano per
/// nome (`backups::BACKED_UP`), e non è un `project.yaml`, quindi la lista dei
/// progetti non lo vede.
///
/// Il nome del temporaneo è **unico per chiamata**, e non un `.tmp` fisso.
/// Trovato provando: con un nome fisso, 50 scritture concorrenti si rubano il
/// temporaneo a vicenda e per la maggioranza il `rename` fallisce con ENOENT —
/// cioè la funzione era corretta *solo* se chi la chiama tiene
/// `project_write_lock`. Una funzione che si affida a un lock che non prende
/// lei è una trappola per il prossimo che la riusa altrove.
/// Il `sync_all` prima del rename non è pignoleria: senza, dopo un taglio di
/// corrente il rename può essere già visibile e i dati no, e si riapre un file
/// vuoto — che è lo stesso guasto di prima con un giro in più. Questi girano su
/// pannelli che si spengono staccando la spina, quindi vale la fsync.
/// Il nome del file di lavoro di una singola scrittura: `project.yaml.<n>.tmp`.
///
/// Il contatore è per-processo e monotono, che basta: due scritture nello stesso
/// processo non lo condividono mai, e due processi sulla stessa cartella di
/// progetto sono già fuori da ciò che questo PoC sostiene (un runtime per
/// dispositivo).
fn temporaneo_unico(path: &std::path::Path) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let mut nome = path.file_name().unwrap_or_default().to_os_string();
    nome.push(format!(".{n}.tmp"));
    path.with_file_name(nome)
}

/// Il gemello sincrono di [`scrivi_atomico`], per i due percorsi che girano
/// fuori da un contesto async (la migrazione all'apertura del progetto).
/// Esiste per non lasciare **un'unica** eccezione alla regola «un project.yaml
/// non si sostituisce mai con una scrittura non atomica»: un'invariante con
/// un'eccezione sola è quella che si dimentica.
pub(crate) fn scrivi_atomico_sync(path: &std::path::Path, dati: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let tmp = temporaneo_unico(path);
    let scritto = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(dati)?;
        f.sync_all()
    })();
    if let Err(e) = scritto {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

pub(crate) async fn scrivi_atomico(path: &std::path::Path, dati: &[u8]) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;

    let tmp = temporaneo_unico(path);
    let scritto = async {
        let mut f = tokio::fs::File::create(&tmp).await?;
        f.write_all(dati).await?;
        f.sync_all().await
    }
    .await;
    if let Err(e) = scritto {
        // Un temporaneo scritto a metà non va lasciato in giro.
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    if let Err(e) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    Ok(())
}

/// Rimette nel YAML da scrivere ciò che la struttura `Project` non rappresenta:
/// le sorgenti che non si parsano e le chiavi di primo livello sconosciute.
///
/// Le sorgenti preservate finiscono **in coda** alla lista: l'ordine relativo
/// rispetto a quelle conosciute non è recuperabile senza un'identità stabile, e
/// conservare la voce conta più di conservarne la posizione.
///
/// Se qualcosa non si parsa (a partire dal file grezzo) si restituisce il YAML
/// tipizzato invariato: questa funzione può solo aggiungere, mai far fallire un
/// salvataggio.
fn merge_preserved(
    typed_yaml: &str,
    raw_yaml: &str,
    known_before: &std::collections::HashSet<serde_yaml::Value>,
) -> String {
    let (Ok(mut typed), Ok(raw)) = (
        serde_yaml::from_str::<serde_yaml::Value>(typed_yaml),
        serde_yaml::from_str::<serde_yaml::Value>(raw_yaml),
    ) else {
        return typed_yaml.to_string();
    };
    let (Some(typed_map), Some(raw_map)) = (typed.as_mapping().cloned(), raw.as_mapping()) else {
        return typed_yaml.to_string();
    };

    // Nomi delle sorgenti che la struttura tipizzata sta già scrivendo.
    let typed_names: std::collections::HashSet<String> = typed_map
        .get(serde_yaml::Value::from("sources"))
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|e| {
                    e.get("name")
                        .and_then(|n| n.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    // Sorgenti da conservare: quelle che non si parsano **e** che non sono già
    // presenti fra le tipizzate.
    //
    // Il secondo controllo non è teorico: senza di lui basta una piccola
    // asimmetria fra come `SourceDef` si serializza e come si deserializza per
    // far sembrare "non parsabile" una sorgente valida — che verrebbe quindi
    // accodata a una copia di sé stessa, raddoppiando a ogni salvataggio. Un
    // test lo ha colto subito (`non_duplica_le_sorgenti_conosciute`).
    let unparsed: Vec<serde_yaml::Value> = raw_map
        .get(serde_yaml::Value::from("sources"))
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter(|entry| serde_yaml::from_value::<SourceDef>((*entry).clone()).is_err())
                .filter(|entry| {
                    entry
                        .get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| !typed_names.contains(n))
                        .unwrap_or(true) // senza nome non si può dedurre: si conserva
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    let out = typed.as_mapping_mut().expect("verificato sopra");
    if !unparsed.is_empty() {
        let key = serde_yaml::Value::from("sources");
        let mut seq = out
            .get(&key)
            .and_then(|v| v.as_sequence())
            .cloned()
            .unwrap_or_default();
        let kept = unparsed.len();
        seq.extend(unparsed);
        out.insert(key, serde_yaml::Value::Sequence(seq));
        info!(
            kept,
            "patch_project: sorgenti non riconosciute conservate nel salvataggio"
        );
    }

    // Chiavi di primo livello che il file aveva e la struttura non conosce.
    //
    // `known_before` è ciò che rende possibile *cancellare*: senza,
    // qualunque campo opzionale azzerato sembrava una chiave sconosciuta e il
    // valore vecchio tornava al suo posto. `PUT /api/project/page-layout` con
    // corpo `null` rispondeva 204 e non cancellava niente — misurato sul WP630
    // il 2026-08-27, e valeva per ogni campo opzionale di primo livello.
    let mut extra = 0usize;
    for (k, v) in raw_map {
        if typed_map.contains_key(k) || known_before.contains(k) {
            continue;
        }
        out.insert(k.clone(), v.clone());
        extra += 1;
    }
    if extra > 0 {
        info!(
            extra,
            "patch_project: chiavi di primo livello sconosciute conservate"
        );
    }

    serde_yaml::to_string(&typed).unwrap_or_else(|_| typed_yaml.to_string())
}

async fn update_project_tags(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(tags): Json<Vec<TagDef>>,
) -> Response {
    s.audit.log(
        "project.change",
        Some(user.username),
        serde_json::json!({"what": "tags", "count": tags.len()}),
    );
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let per_db = tags.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.tags = tags,
    )
    .await;
    if res.status() != StatusCode::NO_CONTENT {
        return res;
    }
    // Un posto solo installa i tag nel runtime (Fase 0d): semina i nuovi,
    // toglie gli orfani, aggiorna scale/ruoli/tipi/calcolati — senza riavvio.
    // I tipi struttura (Fase 1b) si rileggono dal file appena scritto: questa
    // rotta non li tocca, ma le forme delle istanze dipendono da loro.
    let tipi = Project::load(&dir).map(|p| p.types).unwrap_or_default();
    crate::projects::apply_tags(&s.db, &s.derived_tags, &s.generator_tags, &per_db, &tipi).await;
    res
}

/// `PUT /api/project/types` — i tipi struttura del progetto (Fase 2).
///
/// Cambiare un tipo cambia **tutte le sue istanze**: la forma, il valore
/// iniziale, le mappe di scala, tipo e ruolo, e le rotte dello storico. Per
/// questo dopo la scrittura si ripassa da `apply_tags`, che è l'unico posto
/// che installa i tag nel runtime (Fase 0d), coi tag riletti dal file.
async fn update_project_types(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(types): Json<Vec<sws_core::TypeDef>>,
) -> Response {
    s.audit.log(
        "project.change",
        Some(user.username),
        serde_json::json!({"what": "types", "count": types.len()}),
    );
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let per_db = types.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.types = types,
    )
    .await;
    if res.status() != StatusCode::NO_CONTENT {
        return res;
    }
    let tags = Project::load(&dir).map(|p| p.tags).unwrap_or_default();
    crate::projects::apply_tags(&s.db, &s.derived_tags, &s.generator_tags, &tags, &per_db).await;
    res
}

/// PUT /api/project/languages
/// Body: the full `LanguageTable` (default lang, lang codes, entries). Persists
/// it into project.yaml. The viewer resolves `{{token}}` client-side (T-40), but
/// notifications resolve server-side from a snapshot: they are restarted here.
async fn update_project_languages(
    State(s): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(table): Json<LanguageTable>,
) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.languages = table,
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        // Le notifiche tengono una fotografia della tabella: va rifatta, o un
        // messaggio d'allarme appena tokenizzato parte come `{{t0031}}`.
        ricarica_lingue_notifiche(&s, &dir).await;
    }
    res
}

/// Le righe di un CSV, virgolette comprese (RFC 4180 in piccolo).
///
/// `split(',')` non bastava: l'esportazione **mette fra virgolette** i campi
/// che contengono una virgola o un a capo, e la lettura le ignorava — una
/// descrizione come «pompa 1, mandata» tornava indietro spezzata in due
/// colonne, e con un a capo dentro spezzava la riga. Andata e ritorno dello
/// stesso file: è il giro che si fa per davvero.
fn righe_csv(testo: &str) -> Vec<Vec<String>> {
    let mut righe = Vec::new();
    let mut riga: Vec<String> = Vec::new();
    let mut campo = String::new();
    let mut fra_virgolette = false;
    let mut chars = testo.chars().peekable();
    while let Some(c) = chars.next() {
        if fra_virgolette {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    campo.push('"');
                } else {
                    fra_virgolette = false;
                }
            } else {
                campo.push(c);
            }
        } else {
            match c {
                '"' if campo.trim().is_empty() => {
                    campo.clear();
                    fra_virgolette = true;
                }
                ',' => riga.push(std::mem::take(&mut campo)),
                '\n' => {
                    riga.push(std::mem::take(&mut campo));
                    righe.push(std::mem::take(&mut riga));
                }
                '\r' => {}
                _ => campo.push(c),
            }
        }
    }
    if !campo.is_empty() || !riga.is_empty() {
        riga.push(campo);
        righe.push(riga);
    }
    righe
}

/// Le dimensioni di un array come le scrive l'esportazione: `4`, `2x3`.
///
/// Non `[2,3]`: dentro un CSV una virgola costringerebbe alle virgolette ogni
/// volta, e il file si aprirebbe storto nei fogli di calcolo che il formato
/// esiste per servire.
fn dimensioni_csv(v: &str) -> Option<Vec<u32>> {
    let v = v.trim();
    if v.is_empty() {
        return None;
    }
    let dims: Vec<u32> = v
        .split(['x', 'X', '*'])
        .filter_map(|d| d.trim().parse::<u32>().ok())
        .collect();
    (!dims.is_empty()).then_some(dims)
}

/// I campi che una riga di CSV dichiara, per nome di colonna.
///
/// Una mappa e non venti campi tipati: le colonne sono quelle di `TagDef` e di
/// `Membro` messe insieme, e tenerle come struct voleva dire venti righe
/// identiche per ogni campo nuovo. Quello che conta è la regola, non la forma:
/// **una colonna che il file non ha non compare qui**, quindi non tocca
/// niente; una cella **vuota** su una colonna presente svuota il campo.
#[derive(Default)]
struct Modifiche {
    campi: Vec<(String, String)>,
}

/// I numeri: una cella vuota è «togli il valore», una cella illeggibile si
/// ignora invece di far fallire l'import di tutto il file.
fn num_csv(v: &str) -> Option<Option<f64>> {
    let v = v.trim();
    if v.is_empty() {
        return Some(None);
    }
    v.replace(',', ".").parse::<f64>().ok().map(Some)
}

fn bool_csv(v: &str) -> bool {
    matches!(
        v.trim().to_lowercase().as_str(),
        "true" | "1" | "yes" | "si" | "sì"
    )
}

impl Modifiche {
    fn get(&self, nome: &str) -> Option<&str> {
        self.campi
            .iter()
            .find(|(k, _)| k == nome)
            .map(|(_, v)| v.as_str())
    }

    /// I campi che `TagDef` e `Membro` hanno in comune, applicati con due
    /// chiusure perché i due tipi non condividono un tratto (e uno solo per
    /// questo non vale la pena).
    fn per_ogni_comune(&self, mut f: impl FnMut(&str, &str)) {
        for (k, v) in &self.campi {
            f(k, v);
        }
    }

    fn applica(&self, t: &mut TagDef) {
        self.per_ogni_comune(|k, v| {
            let testo = || (!v.is_empty()).then(|| v.to_string());
            match k {
                "data_type" => {
                    if !v.is_empty() {
                        t.data_type = v.to_string();
                    }
                }
                "description" => t.description = v.to_string(),
                "history" => t.history = bool_csv(v),
                "expression" => t.expression = testo(),
                "unit" => t.unit = testo(),
                "type_ref" => t.type_ref = testo(),
                "write_min_role" => t.write_min_role = testo(),
                "array" => t.array = dimensioni_csv(v),
                "decimals" => {
                    if let Some(n) = num_csv(v) {
                        t.decimals = n.map(|x| x as u8);
                    }
                }
                "history_min_interval_ms" => {
                    if let Some(n) = num_csv(v) {
                        t.history_min_interval_ms = n.map(|x| x as u64);
                    }
                }
                "history_deadband" => set_f64(&mut t.history_deadband, v),
                "raw_min" => set_f64(&mut t.raw_min, v),
                "raw_max" => set_f64(&mut t.raw_max, v),
                "eng_min" => set_f64(&mut t.eng_min, v),
                "eng_max" => set_f64(&mut t.eng_max, v),
                "range_lo" => set_f64(&mut t.range_lo, v),
                "range_hi" => set_f64(&mut t.range_hi, v),
                "limit_lo_lo" => set_f64(&mut t.limit_lo_lo, v),
                "limit_lo" => set_f64(&mut t.limit_lo, v),
                "limit_hi" => set_f64(&mut t.limit_hi, v),
                "limit_hi_hi" => set_f64(&mut t.limit_hi_hi, v),
                _ => {}
            }
        });
    }

    fn applica_membro(&self, m: &mut Membro) {
        self.per_ogni_comune(|k, v| {
            let testo = || (!v.is_empty()).then(|| v.to_string());
            match k {
                "data_type" => m.data_type = testo(),
                "description" => m.description = v.to_string(),
                "history" => m.history = bool_csv(v),
                "unit" => m.unit = testo(),
                "type_ref" => m.type_ref = testo(),
                "write_min_role" => m.write_min_role = testo(),
                "array" => m.array = dimensioni_csv(v),
                "decimals" => {
                    if let Some(n) = num_csv(v) {
                        m.decimals = n.map(|x| x as u8);
                    }
                }
                "history_min_interval_ms" => {
                    if let Some(n) = num_csv(v) {
                        m.history_min_interval_ms = n.map(|x| x as u64);
                    }
                }
                "history_deadband" => set_f64(&mut m.history_deadband, v),
                "raw_min" => set_f64(&mut m.raw_min, v),
                "raw_max" => set_f64(&mut m.raw_max, v),
                "eng_min" => set_f64(&mut m.eng_min, v),
                "eng_max" => set_f64(&mut m.eng_max, v),
                "range_lo" => set_f64(&mut m.range_lo, v),
                "range_hi" => set_f64(&mut m.range_hi, v),
                "limit_lo_lo" => set_f64(&mut m.limit_lo_lo, v),
                "limit_lo" => set_f64(&mut m.limit_lo, v),
                "limit_hi" => set_f64(&mut m.limit_hi, v),
                "limit_hi_hi" => set_f64(&mut m.limit_hi_hi, v),
                _ => {}
            }
        });
    }
}

fn set_f64(dst: &mut Option<f64>, v: &str) {
    if let Some(n) = num_csv(v) {
        *dst = n;
    }
}

/// Cosa dichiara una riga. La prima colonna (`kind`) lo dice; un file senza
/// quella colonna è un `tags.csv` di prima del 22-09-2026 e sono tutte
/// variabili, come è sempre stato.
enum RigaCsv {
    Tipo { id: String, m: Modifiche },
    Membro { owner: String, m: Modifiche },
    Variabile { id: String, m: Modifiche },
}

/// Fonde le righe di un CSV dentro il progetto. Pura: prende il progetto e lo
/// modifica, niente stato e niente disco, così l'ordine di applicazione (tipi,
/// membri, variabili) si può provare senza un server in piedi.
fn applica_csv(p: &mut Project, imported: &[RigaCsv]) {
    // 1. I tipi per primi: un'istanza senza il suo tipo è una forma
    //    che non sta in piedi, e il validatore la rifiuterebbe.
    for r in imported {
        if let RigaCsv::Tipo { id, m } = r {
            if let Some(esistente) = p.types.iter_mut().find(|t| &t.id == id) {
                if let Some(d) = m.get("description") {
                    esistente.description = d.to_string();
                }
            } else {
                p.types.push(TypeDef {
                    id: id.clone(),
                    description: m.get("description").unwrap_or("").to_string(),
                    members: Vec::new(),
                });
            }
        }
    }

    // 2. I membri. Un tipo che il file **nomina** prende l'elenco del
    //    file, nel suo ordine: l'ordine dei membri è l'ordine delle
    //    foglie, quindi riordinarlo è una modifica vera e non si può
    //    fondere alla cieca. Ogni membro parte da quello esistente
    //    con lo stesso nome, così le colonne assenti non azzerano.
    let mut per_tipo: Vec<(String, Vec<&Modifiche>)> = Vec::new();
    for r in imported {
        if let RigaCsv::Membro { owner, m } = r {
            match per_tipo.iter_mut().find(|(o, _)| o == owner) {
                Some((_, v)) => v.push(m),
                None => per_tipo.push((owner.clone(), vec![m])),
            }
        }
    }
    for (owner, membri) in &per_tipo {
        // Un membro di un tipo mai dichiarato: il tipo nasce qui.
        if !p.types.iter().any(|t| &t.id == owner) {
            p.types.push(TypeDef {
                id: owner.clone(),
                description: String::new(),
                members: Vec::new(),
            });
        }
        let Some(td) = p.types.iter_mut().find(|t| &t.id == owner) else {
            continue;
        };
        let vecchi = std::mem::take(&mut td.members);
        for m in membri {
            let nome = m.get("name").unwrap_or("").to_string();
            if nome.is_empty() {
                continue;
            }
            let mut nuovo = vecchi
                .iter()
                .find(|x| x.name == nome)
                .cloned()
                .unwrap_or_else(|| Membro::nuovo(&nome));
            m.applica_membro(&mut nuovo);
            td.members.push(nuovo);
        }
    }

    // 3. Le variabili.
    for r in imported {
        if let RigaCsv::Variabile { id, m } = r {
            if let Some(esistente) = p.tags.iter_mut().find(|t| &t.id == id) {
                m.applica(esistente);
            } else {
                let mut t = TagDef::nuovo(id.clone(), "float");
                m.applica(&mut t);
                p.tags.push(t);
            }
        }
    }
}

/// POST /api/project/tags/import-csv
/// Body: plain text CSV (UTF-8). La prima riga è l'intestazione e deve avere
/// almeno `id`. Con una colonna `kind` il file porta **variabili e tipi
/// insieme**: `type` è la definizione di un tipo, `member` un suo membro (il
/// tipo sta in `owner`, il nome del membro in `id`), `tag` una variabile.
/// Senza `kind`, ogni riga è una variabile — i file esportati prima del
/// 22-09-2026 si reimportano come sempre. Le colonne sconosciute si ignorano.
///
/// Fonde: aggiunge ciò che non c'è, aggiorna ciò che ha lo stesso id, lascia
/// stare ciò che il file non nomina. **Una colonna assente non azzera il
/// campo**: fino al 22-09-2026 la riga sostituiva il tag intero, quindi
/// reimportare un `tags.csv` esportato cancellava in silenzio scala, limiti,
/// unità — e, dalla Fase 2, `type_ref` e `array`, cioè trasformava una
/// struttura in uno scalare lasciando ogni pagina legata a percorsi che non
/// esistevano più.
async fn import_tags_csv(
    State(s): State<AppState>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Response {
    let text = match std::str::from_utf8(&body) {
        Ok(t) => t,
        Err(_) => return (StatusCode::BAD_REQUEST, "CSV must be UTF-8").into_response(),
    };

    let righe = righe_csv(text);
    let Some(header_line) = righe.first() else {
        return (StatusCode::BAD_REQUEST, "Empty CSV").into_response();
    };

    let cols: Vec<String> = header_line.iter().map(|c| c.trim().to_string()).collect();
    let col = |name: &str| -> Option<usize> { cols.iter().position(|c| c == name) };
    let Some(id_col) = col("id") else {
        return (StatusCode::BAD_REQUEST, "CSV missing 'id' column").into_response();
    };
    let kind_col = col("kind");
    let owner_col = col("owner");

    // Le colonne di dato: tutte quelle che non sono struttura della riga.
    let dati: Vec<(usize, String)> = cols
        .iter()
        .enumerate()
        .filter(|(i, c)| {
            Some(*i) != Some(id_col)
                && Some(*i) != kind_col
                && Some(*i) != owner_col
                && !c.is_empty()
        })
        .map(|(i, c)| (i, c.clone()))
        .collect();

    let mut imported: Vec<RigaCsv> = Vec::new();
    for fields in righe.iter().skip(1) {
        if fields.iter().all(|f| f.trim().is_empty()) {
            continue;
        }
        let get =
            |idx: usize| -> String { fields.get(idx).map(|s| s.trim()).unwrap_or("").to_string() };
        let id = get(id_col);
        if id.is_empty() {
            continue;
        }
        let m = Modifiche {
            campi: dati
                .iter()
                .filter(|(i, _)| *i < fields.len())
                .map(|(i, nome)| (nome.clone(), get(*i)))
                .collect(),
        };
        let kind = kind_col.map(&get).unwrap_or_default().to_lowercase();
        imported.push(match kind.as_str() {
            "type" | "tipo" => RigaCsv::Tipo { id, m },
            "member" | "membro" => {
                let owner = owner_col.map(&get).unwrap_or_default();
                if owner.is_empty() {
                    continue; // un membro senza tipo non sta da nessuna parte
                }
                RigaCsv::Membro {
                    owner,
                    m: Modifiche {
                        campi: [vec![("name".into(), id)], m.campi].concat(),
                    },
                }
            }
            _ => RigaCsv::Variabile { id, m },
        });
    }

    if imported.is_empty() {
        return (StatusCode::BAD_REQUEST, "No valid rows in CSV").into_response();
    }

    // Merge: load current, upsert imported.
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| applica_csv(p, &imported),
    )
    .await;
    if res.status() != StatusCode::NO_CONTENT {
        return res;
    }
    // Il runtime segue il file appena scritto: stesso posto degli altri
    // cinque siti (Fase 0d). Prima qui mancavano scale, tipi e ruoli.
    if let Ok(proj) = Project::load(&dir) {
        crate::projects::apply_tags(
            &s.db,
            &s.derived_tags,
            &s.generator_tags,
            &proj.tags,
            &proj.types,
        )
        .await;
    }
    // `imported` sono le variabili, per non cambiare il significato del campo
    // a chi lo legge già; i tipi si contano a parte.
    let variabili = imported
        .iter()
        .filter(|r| matches!(r, RigaCsv::Variabile { .. }))
        .count();
    let tipi = imported
        .iter()
        .filter_map(|r| match r {
            RigaCsv::Tipo { id, .. } => Some(id.clone()),
            RigaCsv::Membro { owner, .. } => Some(owner.clone()),
            RigaCsv::Variabile { .. } => None,
        })
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    Json(serde_json::json!({ "imported": variabili, "tipi": tipi })).into_response()
}

async fn update_project_sources(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(mut sources): Json<Vec<SourceDef>>,
) -> Response {
    s.audit.log(
        "project.change",
        Some(user.username),
        serde_json::json!({"what": "sources", "count": sources.len()}),
    );
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };

    // Q8-C, validate-before-apply: si valida PRIMA di persistere e ricaricare.
    // Il supervisor indicizza le sorgenti per id: un id duplicato non è un
    // errore visibile ma una sorgente che sparisce in silenzio (l'ultima
    // vince), un id vuoto è una chiave inutilizzabile. Meglio un 400 chiaro.
    {
        let mut seen = std::collections::HashSet::new();
        for src in &sources {
            let id = crate::source_supervisor::source_id(src);
            if id.trim().is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    "una sorgente ha id vuoto — ogni sorgente deve avere un id univoco",
                )
                    .into_response();
            }
            if !seen.insert(id.to_string()) {
                return (
                    StatusCode::BAD_REQUEST,
                    format!(
                        "id sorgente duplicato: \"{id}\" — gli id devono essere univoci, \
                             altrimenti una delle due sorgenti verrebbe scartata in silenzio"
                    ),
                )
                    .into_response();
            }
        }
    }

    // Ripristino dei segreti mascherati: un campo che torna indietro col
    // segnaposto vuol dire «lascia com'era», e il valore vero si ripesca dal
    // progetto su disco. Senza questo giro una modifica qualunque fatta
    // dall'IDE cancellerebbe le credenziali salvate.
    //
    // 2f: vale per **tutti** i campi segreti di una sorgente (password MQTT,
    // token HomeAssistant, password del client OPC-UA), non più per il solo
    // MQTT — prima gli altri due non erano nemmeno mascherati, quindi non
    // c'era niente da ripristinare; ora che lo sono, un salvataggio senza
    // questo giro li scriverebbe letteralmente «********».
    let previous = Project::load(&dir).ok();
    if let Some(prev) = previous.as_ref() {
        let precedenti = sws_core::segreti::estrai_sorgenti(&mut prev.sources.clone());
        let attuali = sws_core::segreti::estrai_sorgenti(&mut sources);
        let finali = sws_core::segreti::ripristina(attuali, &precedenti, MASKED_PASSWORD);
        sws_core::segreti::applica_sorgenti(&mut sources, &finali);
    }

    // 2026-09-07 — le righe MQTT senza topic non arrivano al disco.
    //
    // Perché si scartano invece di rifiutare il salvataggio con un 400, come
    // si fa qui sopra per gli id duplicati: un id duplicato farebbe perdere una
    // sorgente **configurata** (c'è del lavoro dentro, e va detto); una riga con
    // il topic vuoto non porta alcuna informazione — non c'è niente da perdere,
    // e rifiutare bloccherebbe il salvataggio di tutto il resto. Lasciarla
    // passare invece costa carissimo: il broker chiude la connessione appena
    // riceve una SUBSCRIBE con un filtro a lunghezza zero, e muore l'intera
    // sorgente (Sandokan, 2026-09-07: 27 topic buoni uccisi dal ventottesimo
    // vuoto). Il runtime ormai le tollera; qui si evita che tornino sul disco
    // e finiscano nel deploy.
    let mut righe_tolte: Vec<String> = Vec::new();
    for src in &mut sources {
        if let SourceDef::Mqtt(cfg) = src {
            let prima = cfg.topics.len();
            cfg.topics.retain(|t| !t.topic.trim().is_empty());
            let tolte = prima - cfg.topics.len();
            if tolte > 0 {
                righe_tolte.push(format!("{} ({tolte})", cfg.id));
            }
        }
    }
    if !righe_tolte.is_empty() {
        warn!(sorgenti = %righe_tolte.join(", "),
              "salvataggio sorgenti: righe senza topic tolte prima di scrivere");
    }

    // Hot-reload: persist first, then diff against the supervisor's current
    // set. New/removed sources are spawned/cancelled in-place — no runtime
    // restart needed.
    let mut clone = sources.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| {
            p.sources = sources;
            // Q58: salvare le sorgenti **è** la conferma. Chi arriva qui le ha
            // sotto gli occhi — la scheda mostra la banda che dice che non sono
            // avviate e perché — quindi non serve un secondo pulsante che
            // chieda la stessa cosa in un altro punto («una sezione per dato»,
            // regola UI del 2026-08-23).
            p.sorgenti_da_rivedere = false;
        },
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        // Stessa risoluzione degli altri percorsi di reload (open/import/
        // system_start): senza, dopo un salvataggio dall'IDE i client MQTT
        // con random_client_id si connettevano col client_id BASE (niente
        // suffisso instance) fino alla riapertura del progetto — id diverso
        // a seconda di quale percorso ha fatto l'ultimo reload.
        let project_name = previous
            .as_ref()
            .map(|p| p.meta.name.clone())
            .or_else(|| Project::load(&dir).ok().map(|p| p.meta.name))
            .unwrap_or_default();
        crate::projects::resolve_mqtt_client_ids(
            &project_name,
            &mut clone,
            &s.config_dir,
            &s.instance_id,
        );
        s.supervisor.reload(clone).await;
    }
    res
}

async fn update_project_alarms(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(alarms): Json<Vec<AlarmDef>>,
) -> Response {
    s.audit.log(
        "project.change",
        Some(user.username),
        serde_json::json!({"what": "alarms", "count": alarms.len()}),
    );
    // Hot-reload: AlarmDb::load fully replaces the registry (clear + insert).
    // In-flight active alarms are reset; the next TagDb update will re-evaluate
    // and re-fire any still-tripped conditions.
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let clone = alarms.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.alarms = alarms,
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        s.alarms.load(clone).await;
    }
    res
}

/// Validate + persist + hot-swap the reusable Python functions list.
/// Rejects unsafe param names and oversized code bodies before writing.
async fn update_project_functions(
    State(s): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(functions): Json<Vec<FunctionDef>>,
) -> Response {
    // 1. Code-size cap — keeps `project.yaml` from ballooning.
    for f in &functions {
        if f.code.len() > MAX_FUNCTION_CODE_BYTES {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!(
                    "function '{}' code is {} bytes; max {}",
                    f.name,
                    f.code.len(),
                    MAX_FUNCTION_CODE_BYTES
                ),
            )
                .into_response();
        }
    }

    // 2. Param-name validation — must be a Python identifier, not a keyword.
    for f in &functions {
        for p in &f.params {
            if !is_valid_python_identifier(&p.name) {
                return (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!(
                        "function '{}': param '{}' is not a valid Python identifier",
                        f.name, p.name
                    ),
                )
                    .into_response();
            }
        }
    }

    // 3. Unique names — the registry is keyed by `name`; duplicates collapse
    //    silently otherwise.
    let mut seen = std::collections::HashSet::new();
    for f in &functions {
        if !seen.insert(f.name.as_str()) {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("duplicate function name '{}'", f.name),
            )
                .into_response();
        }
    }

    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let clone = functions.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.functions = functions,
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        let mut map = s.functions.write().await;
        map.clear();
        for f in clone {
            map.insert(f.name.clone(), f);
        }
    }
    res
}

/// Il markup SVG di un simbolo custom contiene qualcosa che esegue codice o
/// carica risorse da fuori? `Some(motivo)` se sì.
///
/// Difesa in profondità, non sostituto della sanificazione lato browser
/// (`customSvg.ts`): quella toglie e disegna, questa RIFIUTA il salvataggio.
/// Un simbolo è grafica — se arriva con `<script>` dentro, o è un errore di
/// chi incolla o è un tentativo, e in entrambi i casi non va sul disco: da lì
/// finirebbe nel viewer di operatori anonimi, e in un deploy. Regex volutamente
/// larghe: un falso positivo qui costa un messaggio d'errore, un falso negativo
/// costa uno script eseguito nel browser di qualcun altro.
pub(crate) fn svg_ostile(svg: &str) -> Option<&'static str> {
    let basso = svg.to_ascii_lowercase();
    // tolgo gli spazi bianchi dentro i valori per prendere `java\nscript:` e simili
    let compatto: String = basso.chars().filter(|c| !c.is_whitespace()).collect();
    if basso.contains("<script") {
        return Some("contiene <script>");
    }
    if compatto.contains("javascript:") {
        return Some("contiene un URL javascript:");
    }
    if basso.contains("<foreignobject") {
        return Some("contiene <foreignObject>");
    }
    if basso.contains("<iframe") || basso.contains("<embed") || basso.contains("<object") {
        return Some("contiene un elemento che incorpora un documento esterno");
    }
    // handler inline: `onload=`, `onclick=`, con o senza spazi
    let mut resto = compatto.as_str();
    while let Some(i) = resto.find("on") {
        let dopo = &resto[i + 2..];
        let nome: String = dopo
            .chars()
            .take_while(|c| c.is_ascii_alphabetic())
            .collect();
        if !nome.is_empty()
            && dopo[nome.len()..].starts_with('=')
            && i > 0
            && matches!(resto.as_bytes()[i - 1], b'<' | b'"' | b'\'' | b'/' | b'>' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_')
        {
            // `<rect onload=` compattato diventa `<rectonload=`: il carattere prima di
            // `on` è una lettera. Accettiamo il falso positivo su attributi che
            // finiscono in ...on= (es. `data-version=`): costa un messaggio.
            return Some("contiene un gestore di eventi (on*=)");
        }
        resto = &resto[i + 2..];
    }
    None
}

async fn update_project_custom_symbols(
    State(s): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(symbols): Json<Vec<CustomSymbol>>,
) -> Response {
    for sym in &symbols {
        if let Some(svg) = sym.svg.as_deref() {
            if let Some(motivo) = svg_ostile(svg) {
                return (
                    StatusCode::BAD_REQUEST,
                    format!(
                        "simbolo «{}» rifiutato: il markup {motivo}. Un simbolo è solo grafica.\n",
                        sym.id
                    ),
                )
                    .into_response();
            }
        }
    }
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.custom_symbols = symbols,
    )
    .await
}

async fn update_project_datastores(
    State(s): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(mut datastores): Json<Vec<sws_core::DatastoreConfig>>,
) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| {
            // 2f: la password Postgres e la stringa di connessione ODBC ora
            // escono mascherate dalla GET, quindi rientrano col segnaposto.
            // Il ripristino va fatto **qui dentro**, sul progetto che
            // `patch_project_se` ha appena letto: è la stessa lettura che
            // verrà riscritta, e usarla evita la corsa con una GET fatta
            // fuori dal lock.
            let precedenti = sws_core::segreti::estrai_datastores(&mut p.datastores);
            let attuali = sws_core::segreti::estrai_datastores(&mut datastores);
            let finali = sws_core::segreti::ripristina(attuali, &precedenti, MASKED_PASSWORD);
            sws_core::segreti::applica_datastores(&mut datastores, &finali);
            p.datastores = datastores;
        },
    )
    .await
}

// ── Project import / export (Admin only) ─────────────────────────────────────
//
// Bundle layout inside the ZIP:
//   manifest.json         {"format_version":"1.0","name":"...","exported_at_ms":...,"secrets_masked":<bool>}
//   project.yaml          SENZA segreti (Passo 2): i sette campi sono sempre vuoti qui
//   secrets.yaml          presente solo quando i segreti viaggiano — vedi sotto
//   synoptics/<name>.yaml one per page, name sanitised via `safe_filename`
//   users.yaml            when present, so accounts travel with the project
//
// **I segreti viaggiano in un file separato, non più dentro `project.yaml`**
// (Passo 2, sotto-passo 2d, 22-09-2026 — supera la decisione del 2026-07-29
// per l'EXPORT, la conferma per il DEPLOY):
// - **Deploy** (`build_project_zip`, usato da `remote_deploy`): `secrets.yaml`
//   **sempre incluso**. Un dispositivo che riceve un progetto senza le sue
//   credenziali non si collega a niente — stesso motivo di sempre, file diverso.
// - **Export** (`GET /api/project/export`): `secrets.yaml` **escluso di
//   default**; `?segreti=1` (casella «Includi i segreti» nell'IDE, spenta) lo
//   include. Un backup/condivisione normale non deve portare le credenziali
//   solo perché qualcuno vuole le pagine.
// `secrets_masked` nel manifest dice quale dei due casi è: `true` = il bundle
// non ha `secrets.yaml` (nessun segreto disponibile a chi lo riceve), `false`
// = ce l'ha. Il nome del campo è lo stesso di prima — vuol dire "i segreti non
// sono nel bundle in chiaro", cosa ancora vera anche se prima erano dentro
// `project.yaml` e ora sono in un file loro.
//
// **`project.yaml` non ha mai i sette segreti, in nessuno dei due casi**: quel
// principio ("un posto solo", 2a) non ha eccezioni per import/export.
//
// Questo è deliberatamente diverso dal mascheramento `********` sulle GET
// (`MASKED_PASSWORD`): quello tiene i segreti fuori dal browser e si
// ripristina lato server al salvataggio. Qui il bundle è il mezzo di backup e
// trasferimento, e quando li porta li porta veri.

const BUNDLE_FORMAT_VERSION: &str = "1.0";

/// Il tetto dei corpi di upload (immagini, PNG di boot, ZIP di deploy). axum lo
/// fissa a 2 MiB per ogni estrattore `Bytes`: sotto il tetto **dichiarato** dai
/// singoli handler (5 MiB per immagini e PNG), quindi il tetto vero era quello,
/// e un PNG 1920×1080 con sfumature lo supera.
pub(crate) const LIMITE_CORPO_UPLOAD: usize = 8 * 1024 * 1024;

#[derive(serde::Serialize, serde::Deserialize)]
struct BundleManifest {
    format_version: String,
    name: String,
    exported_at_ms: u64,
    secrets_masked: bool,
}

/// Build a ZIP of the active project from `dir` (same logic as the export
/// endpoint but callable internally — used by `remote_deploy`).
/// Il bundle che viaggia col deploy.
///
/// `con_segreti` è **falso** quando il dispositivo non sa leggere
/// `secrets.yaml` (`segreti_separati` assente nel suo `/api/system`). In quel
/// caso mandarglielo sarebbe il peggio dei due mondi, misurato sul WP630 a
/// 2.11.0 il 23-09-2026: il file arriva, il runtime vecchio non lo legge, le
/// notifiche si spengono **in silenzio**, e intanto il token resta sul disco
/// del pannello in chiaro con i permessi dell'umask (0644: il `chmod 0600`
/// all'upload è codice nuovo, che lì non c'è). Meglio non mandarlo e dirlo.
pub(crate) async fn build_project_zip(
    dir: &std::path::Path,
    con_segreti: bool,
) -> anyhow::Result<Vec<u8>> {
    // Segreti inclusi, ma da 2d in `secrets.yaml` e non più dentro
    // `project.yaml`: il dispositivo che riceve il deploy deve potersi
    // collegare al broker, e prima la password MQTT veniva spogliata proprio qui.
    let mut project =
        Project::load(dir).map_err(|e| anyhow::anyhow!("cannot load project: {e}"))?;
    let segreti = sws_core::segreti::estrai(&mut project);
    let pages = load_all_synoptics(&synoptics_dir_at(dir))
        .await
        .map_err(|e| anyhow::anyhow!("cannot read synoptics: {e}"))?;
    let faceplates = read_yaml_dir(&faceplates_dir_at(dir)).await;
    let recipes = read_yaml_dir(&recipes_dir_at(dir)).await;
    let images = read_images_dir(&images_dir_at(dir)).await;
    let boot = crate::boot::leggi_per_bundle(dir).await;
    let project_name = project.meta.name.clone();
    let exported_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let manifest = BundleManifest {
        format_version: BUNDLE_FORMAT_VERSION.into(),
        name: project_name,
        exported_at_ms,
        // Il deploy li include, tranne verso un dispositivo che non li sa
        // leggere: allora il bundle è come un export senza segreti, e il
        // manifest lo deve dire — chi lo riapre non deve credere di avere
        // delle credenziali che non ci sono.
        secrets_masked: !con_segreti,
    };
    let users_yaml = std::fs::read_to_string(dir.join("users.yaml")).ok();
    build_export_zip(
        &manifest,
        &project,
        &pages,
        users_yaml.as_deref(),
        &faceplates,
        &recipes,
        &images,
        &boot,
        con_segreti.then_some(&segreti),
    )
}

async fn export_project_zip(
    State(s): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    // `?segreti=1` (o `=true`): la casella «Includi i segreti» dell'IDE,
    // spenta di default (Passo 2, 2d). Senza, il bundle non porta
    // `secrets.yaml` — un export/condivisione normale non deve portare le
    // credenziali solo perché qualcuno vuole le pagine.
    let vuoi_segreti = matches!(
        params.get("segreti").map(String::as_str),
        Some("1" | "true")
    );
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    // 1. Load the project from disk. `estrai` toglie i segreti da `project`
    //    (mai più dentro `project.yaml`, 2a): se `vuoi_segreti` li rimettiamo
    //    sotto forma di `secrets.yaml` più sotto, altrimenti restano fuori.
    let mut project = match Project::load(&dir) {
        Ok(p) => p,
        Err(e) => {
            warn!("export: cannot load project: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot load project").into_response();
        }
    };
    let segreti = sws_core::segreti::estrai(&mut project);

    // 2. Load every synoptic page from disk.
    let pages = match load_all_synoptics(&synoptics_dir_at(&dir)).await {
        Ok(v) => v,
        Err(e) => {
            warn!("export: cannot read synoptics: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot read synoptics").into_response();
        }
    };
    let faceplates = read_yaml_dir(&faceplates_dir_at(&dir)).await;
    let recipes = read_yaml_dir(&recipes_dir_at(&dir)).await;
    let images = read_images_dir(&images_dir_at(&dir)).await;
    let boot = crate::boot::leggi_per_bundle(&dir).await;

    // 3. Build the ZIP in memory.
    let project_name = project.meta.name.clone();
    let exported_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let manifest = BundleManifest {
        format_version: BUNDLE_FORMAT_VERSION.into(),
        name: project_name.clone(),
        exported_at_ms,
        secrets_masked: !vuoi_segreti,
    };

    // Include users.yaml if present so credentials travel with the project.
    let users_yaml = std::fs::read_to_string(dir.join("users.yaml")).ok();

    let buf = match build_export_zip(
        &manifest,
        &project,
        &pages,
        users_yaml.as_deref(),
        &faceplates,
        &recipes,
        &images,
        &boot,
        vuoi_segreti.then_some(&segreti),
    ) {
        Ok(b) => b,
        Err(e) => {
            warn!("export: zip build failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "zip build failed").into_response();
        }
    };

    let filename = format!(
        "sws-project-{}-{}.zip",
        sanitize_filename_chunk(&project_name),
        timestamp_for_filename(exported_at_ms),
    );

    tracing::info!(name = %project_name, bytes = buf.len(), "project export");

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        buf,
    )
        .into_response()
}

// Ogni cartella del bundle è un argomento: raggrupparle in una struct sposterebbe
// il numero, non lo ridurrebbe.
#[allow(clippy::too_many_arguments)]
fn build_export_zip(
    manifest: &BundleManifest,
    project: &Project,
    pages: &[SynopticPage],
    users_yaml: Option<&str>,
    faceplates: &[(String, String)],
    recipes: &[(String, String)],
    images: &[(String, Vec<u8>)],
    boot: &[(String, Vec<u8>)],
    // `None` = niente `secrets.yaml` nel bundle (export senza `?segreti=1`).
    // `Some(map)` = lo include, a meno che `map` sia vuota (progetto senza
    // segreti: niente da scrivere, stessa regola di `segreti::scrivi_segreti`).
    // `project` non ha MAI i segreti, in nessuno dei due casi — li toglie
    // `estrai()` presso il chiamante, prima di arrivare qui.
    secreti: Option<&sws_core::segreti::Segreti>,
) -> anyhow::Result<Vec<u8>> {
    use zip::write::SimpleFileOptions;
    let mut cursor = Cursor::new(Vec::<u8>::new());
    {
        let mut z = zip::ZipWriter::new(&mut cursor);
        // Stored (uncompressed) keeps us off the flate2 codec path; the
        // bundle is a handful of small YAML files so compression saves
        // negligible bytes.
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        z.start_file("manifest.json", opts)?;
        z.write_all(serde_json::to_string_pretty(manifest)?.as_bytes())?;

        z.start_file("project.yaml", opts)?;
        z.write_all(serde_yaml::to_string(project)?.as_bytes())?;

        if let Some(segreti) = secreti {
            if !segreti.is_empty() {
                z.start_file("secrets.yaml", opts)?;
                z.write_all(serde_yaml::to_string(segreti)?.as_bytes())?;
            }
        }

        for page in pages {
            let path = format!("synoptics/{}.yaml", safe_filename(&page.name));
            z.start_file(path, opts)?;
            z.write_all(serde_yaml::to_string(page)?.as_bytes())?;
        }
        // Faceplates/recipes di progetto (non i built-in, compilati nel
        // binario) — mancavano dal bundle: un deploy verso un runtime remoto
        // non li portava mai, quindi un faceplate built-in modificato in
        // locale (es. "Tank Level") restava alla versione vecchia/built-in
        // sul device di destinazione dopo il deploy.
        for (fname, yaml) in faceplates {
            z.start_file(format!("faceplates/{fname}"), opts)?;
            z.write_all(yaml.as_bytes())?;
        }
        for (fname, yaml) in recipes {
            z.start_file(format!("recipes/{fname}"), opts)?;
            z.write_all(yaml.as_bytes())?;
        }
        // Immagini di progetto (binarie, copiate byte-per-byte): senza, un
        // deploy/export perderebbe gli sfondi referenziati dai sinottici via
        // /api/project/images/<nome>.
        for (fname, bytes) in images {
            z.start_file(format!("images/{fname}"), opts)?;
            z.write_all(bytes)?;
        }
        // Pagine di boot e loro PNG (T-72), byte per byte.
        for (fname, bytes) in boot {
            z.start_file(format!("boot/{fname}"), opts)?;
            z.write_all(bytes)?;
        }
        if let Some(users) = users_yaml {
            z.start_file("users.yaml", opts)?;
            z.write_all(users.as_bytes())?;
        }
        z.finish()?;
    }
    Ok(cursor.into_inner())
}

/// Elenca e legge ogni `*.yaml` in `dir` come coppie (nome-file, contenuto) —
/// usato per infilare `faceplates/`/`recipes/` nel bundle di deploy/export
/// così come sono, senza bisogno di deserializzarli in `FaceplateDef`/
/// `RecipeDef`: il bundle li porta grezzi, il device di destinazione li
/// interpreta lui stesso con lo stesso codice usato in locale.
/// Come `read_yaml_dir` ma binario e filtrato dalla whitelist immagini —
/// per infilare `images/` nel bundle così com'è.
async fn read_images_dir(dir: &std::path::Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if image_content_type(&name).is_none() {
                continue;
            }
            if let Ok(bytes) = tokio::fs::read(entry.path()).await {
                out.push((name, bytes));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

async fn read_yaml_dir(dir: &std::path::Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return out,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }
        let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if let Ok(content) = tokio::fs::read_to_string(&path).await {
            out.push((fname.to_string(), content));
        }
    }
    out
}

async fn load_all_synoptics(dir: &std::path::Path) -> std::io::Result<Vec<SynopticPage>> {
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e),
    };
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }
        let text = tokio::fs::read_to_string(&path).await?;
        match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(page) => out.push(page),
            Err(e) => warn!("export: skipping malformed synoptic {:?}: {e}", path),
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

async fn import_project_zip(
    State(s): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
    body: Bytes,
) -> Response {
    // `?segreti=1`/`=true`: come per l'export, importare un bundle che
    // qualcun altro ha esportato CON i segreti non deve rimpiazzare le
    // credenziali del progetto corrente senza che l'operatore lo chieda
    // esplicitamente (Passo 2, 2d — «lo scrive solo se presente E richiesto»).
    let vuoi_segreti = matches!(
        params.get("segreti").map(String::as_str),
        Some("1" | "true")
    );
    let active_project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    // 1. Parse the ZIP from raw bytes.
    let mut archive = match zip::ZipArchive::new(Cursor::new(body.as_ref())) {
        Ok(a) => a,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("not a valid zip: {e}")).into_response()
        }
    };

    // 2. Read manifest.json and validate format_version.
    let manifest: BundleManifest = match read_zip_text(&mut archive, "manifest.json") {
        Ok(Some(text)) => match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("manifest.json parse error: {e}"),
                )
                    .into_response()
            }
        },
        Ok(None) => return (StatusCode::BAD_REQUEST, "missing manifest.json").into_response(),
        Err(e) => return (StatusCode::BAD_REQUEST, format!("zip read error: {e}")).into_response(),
    };
    if manifest.format_version != BUNDLE_FORMAT_VERSION {
        return (
            StatusCode::BAD_REQUEST,
            format!("unsupported format_version: {}", manifest.format_version),
        )
            .into_response();
    }

    // 3. Read project.yaml.
    let project_text = match read_zip_text(&mut archive, "project.yaml") {
        Ok(Some(t)) => t,
        Ok(None) => return (StatusCode::BAD_REQUEST, "missing project.yaml").into_response(),
        Err(e) => return (StatusCode::BAD_REQUEST, format!("zip read error: {e}")).into_response(),
    };
    let mut project: Project = match serde_yaml::from_str(&project_text) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("project.yaml parse error: {e}"),
            )
                .into_response()
        }
    };
    // Difensivo: si toglie il segnaposto "********" nel caso che il bundle sia
    // stato costruito a mano da una GET mascherata. Vale «nessuna password
    // impostata» — scrivere il segnaposto sembrerebbe una password configurata
    // e fallirebbe al collegamento senza dire perché. I bundle esportati dal
    // runtime portano il segreto vero, in `secrets.yaml`.
    //
    // 2f: per tutti e sette i campi, non più per il solo MQTT — dalla stessa
    // tabella della maschera. `ripristina` con un passato **vuoto** è
    // esattamente «il segnaposto sparisce»: qui non c'è un valore precedente a
    // cui tornare, il progetto sta arrivando da fuori.
    {
        let attuali = sws_core::segreti::estrai(&mut project);
        let finali = sws_core::segreti::ripristina(attuali, &Default::default(), MASKED_PASSWORD);
        sws_core::segreti::applica(&mut project, &finali);
    }

    // 4. Read every synoptics/*.yaml in the archive.
    let mut pages: Vec<SynopticPage> = Vec::new();
    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    for name in file_names {
        if !name.starts_with("synoptics/") || !name.ends_with(".yaml") {
            continue;
        }
        let text = match read_zip_text(&mut archive, &name) {
            Ok(Some(t)) => t,
            Ok(None) => continue,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("zip read error on {name}: {e}"),
                )
                    .into_response()
            }
        };
        match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(p) => pages.push(p),
            Err(e) => {
                return (StatusCode::BAD_REQUEST, format!("{name} parse error: {e}"))
                    .into_response()
            }
        }
    }

    // 5. Atomically replace on disk.
    let project_dir: &std::path::Path = active_project_dir.as_path();
    if let Err(e) = tokio::fs::create_dir_all(project_dir).await {
        warn!("import: cannot create project dir: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot create project dir",
        )
            .into_response();
    }
    let project_path = project_dir.join("project.yaml");
    // Q30: l'import sostituisce project.yaml per intero. Non è un
    // leggi-modifica-scrivi del file su disco — il contenuto viene dal bundle —
    // ma la perdita è la stessa: un `PUT /api/project/tags` in volo può
    // sovrascrivere l'import, o scrivere sopra il progetto appena importato.
    let _scrittura = s.project_write_lock.lock().await;
    let serialized_project = match project.stamp_and_serialize() {
        Ok(y) => y,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("project.yaml serialize: {e}"),
            )
                .into_response()
        }
    };
    // Q10: il project.yaml del bundle può contenere sorgenti che questo
    // binario non sa parsare (scritte da una versione più nuova) e chiavi di
    // primo livello sconosciute. Il giro dalla struct tipizzata le perderebbe:
    // si rimettono dal testo grezzo del bundle, come fa ogni patch_project.
    // Insieme vuoto: qui non c'è un "prima" da cui dedurre una cancellazione
    // voluta — il progetto È quello importato. Tutto ciò che il bundle ha e la
    // struttura non produce è per definizione da conservare.
    let serialized_project = merge_preserved(
        &serialized_project,
        &project_text,
        &std::collections::HashSet::new(),
    );
    if let Err(e) = scrivi_atomico(&project_path, serialized_project.as_bytes()).await {
        warn!("import: write project.yaml: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write project.yaml").into_response();
    }

    // secrets.yaml: solo se il bundle lo porta E l'operatore l'ha chiesto.
    // Assente da uno dei due: il progetto corrente tiene il suo (se esiste),
    // esattamente come per un deploy senza secrets.yaml nello zip.
    if vuoi_segreti {
        if let Ok(Some(testo)) = read_zip_text(&mut archive, "secrets.yaml") {
            let segreti_path = project_dir.to_path_buf();
            let esito = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
                let segreti: sws_core::segreti::Segreti = serde_yaml::from_str(&testo)?;
                sws_core::segreti::scrivi_segreti(&segreti_path, &segreti)
            })
            .await;
            if let Err(e) = esito.map_err(anyhow::Error::from).and_then(|r| r) {
                warn!("import: write secrets.yaml: {e:#}");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "il progetto è stato importato ma i segreti no: riprova, o importa senza",
                )
                    .into_response();
            }
        }
    }

    let syn_dir = synoptics_dir_at(project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&syn_dir).await {
        warn!("import: cannot create synoptics dir: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot create synoptics dir",
        )
            .into_response();
    }

    // 5a. Compute the set of filenames the bundle declares (after sanitising).
    let kept_files: std::collections::HashSet<String> = pages
        .iter()
        .map(|p| format!("{}.yaml", safe_filename(&p.name)))
        .collect();

    // 5b. Replace mode — delete any synoptic on disk not in the bundle.
    if let Ok(mut entries) = tokio::fs::read_dir(&syn_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let fname = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if !kept_files.contains(&fname) {
                if let Err(e) = tokio::fs::remove_file(&path).await {
                    warn!("import: cannot delete orphan synoptic {:?}: {e}", path);
                }
            }
        }
    }

    // 5c. Write each imported synoptic.
    for page in &pages {
        let path = syn_dir.join(format!("{}.yaml", safe_filename(&page.name)));
        let yaml = match serde_yaml::to_string(page) {
            Ok(y) => y,
            Err(e) => {
                warn!("import: serialize synoptic '{}': {e}", page.name);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("serialize synoptic '{}'", page.name),
                )
                    .into_response();
            }
        };
        if let Err(e) = tokio::fs::write(&path, yaml).await {
            warn!("import: write synoptic '{}': {e}", page.name);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("write synoptic '{}'", page.name),
            )
                .into_response();
        }
    }

    // 5d. Faceplates/recipes di progetto — stesso pattern replace-mode di
    //     5a-5c sopra, mancava del tutto: il bundle non li portava, quindi un
    //     faceplate/recipe modificato o cancellato in locale non si
    //     rifletteva mai sul device dopo un deploy.
    if let Err(e) =
        sync_yaml_dir_from_zip(&mut archive, "faceplates", &faceplates_dir_at(project_dir)).await
    {
        warn!("import: sync faceplates: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "sync faceplates").into_response();
    }
    if let Err(e) =
        sync_yaml_dir_from_zip(&mut archive, "recipes", &recipes_dir_at(project_dir)).await
    {
        warn!("import: sync recipes: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "sync recipes").into_response();
    }
    if let Err(e) =
        crate::boot::sincronizza_da_zip(&mut archive, &crate::boot::boot_dir_at(project_dir)).await
    {
        warn!("import: sync boot: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "sync boot").into_response();
    }

    // 6. Hot-reload — mirror the per-section PUT handlers' side effects so
    //    the runtime reflects the new project without a restart.
    crate::projects::apply_tags(
        &s.db,
        &s.derived_tags,
        &s.generator_tags,
        &project.tags,
        &project.types,
    )
    .await;
    s.alarms.load(project.alarms.clone()).await;
    crate::projects::resolve_mqtt_client_ids(
        &project.meta.name,
        &mut project.sources,
        &s.config_dir,
        &s.instance_id,
    );
    s.supervisor.reload(project.sources.clone()).await;
    {
        let mut map = s.functions.write().await;
        map.clear();
        for f in project.functions.iter().cloned() {
            map.insert(f.name.clone(), f);
        }
    }

    tracing::info!(
        name  = %project.meta.name,
        tags  = project.tags.len(),
        pages = pages.len(),
        "project import",
    );

    // Il progetto è stato sostituito: chi lo sta guardando deve rileggerlo.
    // È il caso che ha motivato Q20 — deploy dall'IDE, e il pannello che
    // continuava a mostrare la pagina di prima.
    signal_project_changed(&s, "import");
    StatusCode::NO_CONTENT.into_response()
}

fn read_zip_text(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> std::io::Result<Option<String>> {
    let mut file = match archive.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
    };
    let mut buf = String::new();
    file.read_to_string(&mut buf)?;
    Ok(Some(buf))
}

/// Replace-mode sync of a flat `<prefix>/*.yaml` directory from an import
/// bundle into `target_dir` — same pattern as the synoptics sync in
/// `import_project_zip` (write every file the bundle declares, delete any
/// `*.yaml` already on disk that the bundle doesn't mention), extracted so
/// `faceplates/` and `recipes/` share it instead of duplicating it twice.
async fn sync_yaml_dir_from_zip(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    prefix: &str,
    target_dir: &std::path::Path,
) -> std::io::Result<()> {
    tokio::fs::create_dir_all(target_dir).await?;
    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    let bundle_prefix = format!("{prefix}/");
    let mut kept: std::collections::HashSet<String> = std::collections::HashSet::new();
    for name in &file_names {
        let Some(fname) = name.strip_prefix(&bundle_prefix) else {
            continue;
        };
        // Solo file diretti dentro prefix/ — nessuna sottocartella attesa.
        if !fname.ends_with(".yaml") || fname.contains('/') {
            continue;
        }
        if let Some(text) = read_zip_text(archive, name)? {
            kept.insert(fname.to_string());
            tokio::fs::write(target_dir.join(fname), text).await?;
        }
    }
    if let Ok(mut entries) = tokio::fs::read_dir(target_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let fname = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if !kept.contains(&fname) {
                let _ = tokio::fs::remove_file(&path).await;
            }
        }
    }
    Ok(())
}

/// Strip filename-unsafe characters; reused for the download attachment.
fn sanitize_filename_chunk(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

/// `YYYY-MM-DDTHH-MM` from a Unix-millis timestamp, UTC. Self-rolled so
/// we don't pull in `chrono` just for a filename.
fn timestamp_for_filename(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (y, mo, d, h, mi) = unix_to_ymdhm(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}-{mi:02}")
}

fn unix_to_ymdhm(secs: i64) -> (i32, u32, u32, u32, u32) {
    // Days since 1970-01-01.
    let total_minutes = secs.div_euclid(60);
    let mi = (total_minutes.rem_euclid(60)) as u32;
    let total_hours = total_minutes.div_euclid(60);
    let h = (total_hours.rem_euclid(24)) as u32;
    let mut days = total_hours.div_euclid(24);

    // Forward-walk through years from 1970. Works fine for any reasonable
    // present-day timestamp; nothing fancier needed for filename use.
    let mut y: i32 = 1970;
    loop {
        let leap = is_leap(y);
        let yd = if leap { 366 } else { 365 };
        if days >= yd as i64 {
            days -= yd as i64;
            y += 1;
        } else {
            break;
        }
    }
    let leap = is_leap(y);
    let months: [i64; 12] = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut mo: u32 = 1;
    for (i, n) in months.iter().enumerate() {
        if days < *n {
            mo = (i + 1) as u32;
            break;
        }
        days -= n;
    }
    let d = (days + 1) as u32;
    (y, mo, d, h, mi)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct RunBody {
    #[serde(default)]
    args: serde_json::Map<String, serde_json::Value>,
}

/// Execute a named function with the provided argument bindings.
/// Restituisce `ScriptResult`, la forma che aveva anche `/api/script/exec` (tolto, Q47).
async fn run_function(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(name): Path<String>,
    body: Option<Json<RunBody>>,
) -> Response {
    s.audit.log(
        "script.run",
        Some(user.username),
        serde_json::json!({"name": name.clone()}),
    );
    let code = {
        let map = s.functions.read().await;
        match map.get(&name) {
            Some(f) => f.code.clone(),
            None => {
                return (StatusCode::NOT_FOUND, format!("no function named '{name}'"))
                    .into_response()
            }
        }
    };
    let args = body.map(|Json(b)| b.args).unwrap_or_default();
    // T-69: `name` è l'identità per `uptime_ms()`/`delta_ms()`/`state` — così
    // una funzione richiamata da più punti (pulsante, `functions.run` di uno
    // script globale, questa stessa rotta) mantiene il proprio stato ritenuto
    // a prescindere da chi la invoca.
    match s.py.execute_with_args(code, args, &name).await {
        Ok(ExecOutput {
            stdout,
            stderr,
            sandboxed,
        }) => {
            metrics::counter!("sws_script_exec_total", "endpoint" => "run", "status" => "ok")
                .increment(1);
            Json(ScriptResult {
                ok: true,
                stdout,
                stderr,
                sandboxed,
                error: None,
            })
            .into_response()
        }
        Err(e) => {
            metrics::counter!("sws_script_exec_total", "endpoint" => "run", "status" => "error")
                .increment(1);
            Json(ScriptResult {
                ok: false,
                error: Some(e),
                sandboxed: s.py.is_sandboxed(),
                ..Default::default()
            })
            .into_response()
        }
    }
}

/// Tight Python-identifier check used for FunctionParam.name. Rejects the
/// hard-coded keyword list (a subset of `keyword.kwlist` — covers everything
/// you'd reasonably shadow as a parameter).
fn is_valid_python_identifier(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return false;
    }
    const KEYWORDS: &[&str] = &[
        "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
        "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
        "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
        "try", "while", "with", "yield", "match", "case",
    ];
    !KEYWORDS.contains(&s)
}

// ── Synoptic endpoints ───────────────────────────────────────────────────────

/// Compute the synoptics directory for a given project root.
pub fn synoptics_dir_at(project_dir: &std::path::Path) -> PathBuf {
    project_dir.join("synoptics")
}

/// Returns true if `user_zones` (empty = all zones) can access a page with `page_zones`
/// (None or empty = accessible to all).
fn zone_allowed(user_zones: &[String], page_zones: &Option<Vec<String>>) -> bool {
    match page_zones {
        None => true,
        Some(pz) if pz.is_empty() => true,
        Some(pz) => {
            // user_zones empty = user has no zone restriction → can access any page
            if user_zones.is_empty() {
                return true;
            }
            user_zones.iter().any(|z| pz.contains(z))
        }
    }
}

async fn list_synoptics(
    State(s): State<AppState>,
    axum::extract::Extension(user): axum::extract::Extension<AuthUser>,
) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = synoptics_dir_at(&project_dir);
    let mut names = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    // Zone filter: peek at zones field without fully parsing objects.
                    let allowed = if user.allowed_zones.is_empty() {
                        true // admin/no-restriction users see all pages
                    } else if let Ok(text) = tokio::fs::read_to_string(&path).await {
                        if let Ok(page) = serde_yaml::from_str::<SynopticPage>(&text) {
                            zone_allowed(&user.allowed_zones, &page.zones)
                        } else {
                            true
                        }
                    } else {
                        true
                    };
                    if allowed {
                        names.push(stem.to_owned());
                    }
                }
            }
        }
    }
    names.sort();
    Json(names).into_response()
}

/// Una pagina per il navigatore: id e nome.
#[derive(serde::Serialize)]
struct PaginaNav {
    id: String,
    name: String,
}

#[derive(serde::Serialize)]
struct PagesNav {
    pages: Vec<PaginaNav>,
    tree: Vec<sws_core::PageTreeNode>,
}

/// `GET /api/pages/nav` — le pagine sinottiche visibili all'utente (id e nome,
/// per nome di file) e l'albero delle pagine del progetto. Serve al viewer LVGL,
/// che legge una pagina per volta e con `GET /api/synoptics` avrebbe solo i nomi
/// dei file: senza gli id un navigatore di pagine non saprebbe dove portare.
/// L'albero è quello **grezzo** di `page_layout`: lo riconcilia chi lo legge
/// (`sws_core::page_tree::riconcilia`), come l'editor.
async fn pages_nav(
    State(s): State<AppState>,
    axum::extract::Extension(user): axum::extract::Extension<AuthUser>,
) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = synoptics_dir_at(&project_dir);
    let mut pages: Vec<(String, PaginaNav)> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else {
                continue;
            };
            let Ok(text) = tokio::fs::read_to_string(&path).await else {
                continue;
            };
            let Ok(page) = serde_yaml::from_str::<SynopticPage>(&text) else {
                continue;
            };
            if zone_allowed(&user.allowed_zones, &page.zones) {
                pages.push((
                    stem,
                    PaginaNav {
                        id: page.id,
                        name: page.name,
                    },
                ));
            }
        }
    }
    pages.sort_by(|a, b| a.0.cmp(&b.0));
    let tree = sws_core::Project::load(&project_dir)
        .ok()
        .and_then(|p| p.page_layout)
        .and_then(|l| l.page_tree)
        .unwrap_or_default();
    Json(PagesNav {
        pages: pages.into_iter().map(|(_, p)| p).collect(),
        tree,
    })
    .into_response()
}

async fn get_synoptic(
    State(s): State<AppState>,
    axum::extract::Extension(user): axum::extract::Extension<AuthUser>,
    Path(name): Path<String>,
) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let path = synoptics_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&name)));
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(page) => {
                if !zone_allowed(&user.allowed_zones, &page.zones) {
                    return StatusCode::FORBIDDEN.into_response();
                }
                // Q30: la versione di **questa** pagina. Le pagine sono file
                // distinti, quindi la corsa è fra due che salvano la stessa —
                // e la versione va per file, non per progetto.
                con_versione(Json(page).into_response(), &text)
            }
            Err(e) => {
                warn!("failed to parse synoptic {name}: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        },
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `GET /api/synoptics/:name/export` — returns the synoptic file as raw YAML
/// with a `Content-Disposition: attachment` header so browsers download it.
/// Same content as `/api/synoptics/:name` (the file on disk), just bytes —
/// no JSON round-trip — and Content-Type set to `application/x-yaml`.
async fn export_synoptic_yaml(State(s): State<AppState>, Path(name): Path<String>) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let safe = safe_filename(&name);
    let path = synoptics_dir_at(&project_dir).join(format!("{}.yaml", safe));
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let filename = format!("{}.yaml", safe);
            (
                StatusCode::OK,
                [
                    (
                        header::CONTENT_TYPE,
                        "application/x-yaml; charset=utf-8".to_string(),
                    ),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{filename}\""),
                    ),
                ],
                bytes,
            )
                .into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `POST /api/synoptics/import` — accepts raw YAML in the request body and
/// installs it as a new page. The page's internal `id` is regenerated to
/// avoid collisions with existing pages, and the filename is derived from
/// the page's `name` (with collision handling: appending `-2`, `-3`, …).
///
/// Returns 200 + `{ id, name, filename }` on success so the editor can
/// jump to the imported page.
async fn import_synoptic_yaml(State(s): State<AppState>, body: Bytes) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = synoptics_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("import_synoptic: cannot create synoptics dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let text = match std::str::from_utf8(&body) {
        Ok(t) => t,
        Err(_) => return (StatusCode::BAD_REQUEST, "body is not UTF-8").into_response(),
    };
    let mut page: SynopticPage = match serde_yaml::from_str(text) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("invalid synoptic YAML: {e}"),
            )
                .into_response()
        }
    };

    if crate::boot::e_pagina_di_boot(&page) {
        return (
            StatusCode::BAD_REQUEST,
            "una pagina di boot si importa con POST /api/boot-pages/import",
        )
            .into_response();
    }

    // Always allocate a fresh id so imports never collide with existing pages.
    // Format mirrors the editor's `genId()` (alphanumeric base36).
    let new_id = format!(
        "imported-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    page.id = new_id.clone();

    // Resolve a non-colliding filename. If `<name>.yaml` already exists, try
    // `<name>-2.yaml`, `<name>-3.yaml`, … and rename the page in-memory to
    // match so the human-readable label stays in sync with the file on disk.
    let base = safe_filename(&page.name);
    let mut filename = format!("{base}.yaml");
    let mut suffix = 2;
    while dir.join(&filename).exists() {
        let new_name = format!("{} ({})", page.name, suffix);
        filename = format!("{}.yaml", safe_filename(&new_name));
        if !dir.join(&filename).exists() {
            page.name = new_name;
            break;
        }
        suffix += 1;
        if suffix > 100 {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "too many name collisions",
            )
                .into_response();
        }
    }

    let yaml = match serde_yaml::to_string(&page) {
        Ok(y) => y,
        Err(e) => {
            warn!("import_synoptic: serialize: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let path = dir.join(&filename);
    if let Err(e) = tokio::fs::write(&path, yaml).await {
        warn!("import_synoptic: write {}: {e}", path.display());
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    Json(serde_json::json!({
        "id":       new_id,
        "name":     page.name,
        "filename": filename,
    }))
    .into_response()
}

async fn save_synoptic(
    State(s): State<AppState>,
    Path(name): Path<String>,
    headers: axum::http::HeaderMap,
    Json(page): Json<SynopticPage>,
) -> Response {
    // Una pagina di boot vive in `boot/`, non qui: lasciarla passare la
    // farebbe vedere ai viewer, che leggono solo `synoptics/`.
    if crate::boot::e_pagina_di_boot(&page) {
        return (
            StatusCode::BAD_REQUEST,
            "una pagina di boot si salva con PUT /api/boot-pages/:name",
        )
            .into_response();
    }
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = synoptics_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("cannot create synoptics dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let new_filename = format!("{}.yaml", safe_filename(&name));
    let path = dir.join(&new_filename);

    // Q30 per i sinottici: se la pagina su disco è cambiata da quando chi
    // salva l'ha caricata, non si sovrascrive. Una pagina che ancora non esiste
    // non ha versione, e `conflitto_di_versione` la lascia passare — creare non
    // è sovrascrivere.
    let su_disco = tokio::fs::read_to_string(&path).await.ok();
    if let Some(r) = conflitto_di_versione(
        versione_attesa(&headers).as_deref(),
        su_disco.as_deref(),
        "Questa pagina",
    ) {
        return r;
    }

    let yaml = match serde_yaml::to_string(&page) {
        Ok(y) => y,
        Err(e) => {
            warn!("serialize synoptic: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    // Atomica come `project.yaml`, e per lo stesso motivo: una pagina troncata
    // da un processo ucciso a metà scrittura non si carica più, e il progetto
    // si riapre senza quella pagina.
    if let Err(e) = scrivi_atomico(&path, yaml.as_bytes()).await {
        warn!("write {}: {e}", path.display());
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    // Remove any stale files that share this page's `id` but have a different
    // filename — left behind when the user renames a page.
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let fname = entry.file_name();
            let fname_str = fname.to_string_lossy();
            if !fname_str.ends_with(".yaml") || fname_str == new_filename.as_str() {
                continue;
            }
            // Only remove if this stale file has the same internal id.
            if let Ok(text) = tokio::fs::read_to_string(entry.path()).await {
                #[derive(serde::Deserialize)]
                struct IdOnly {
                    id: String,
                }
                if let Ok(p) = serde_yaml::from_str::<IdOnly>(&text) {
                    if p.id == page.id {
                        if let Err(e) = tokio::fs::remove_file(entry.path()).await {
                            warn!("save_synoptic: cannot remove stale {:?}: {e}", entry.path());
                        }
                    }
                }
            }
        }
    }

    // Una pagina salvata è una modifica al progetto: il viewer LVGL che la
    // sta disegnando deve rileggerla (Q20).
    signal_project_changed(&s, "synoptic");
    // La versione nuova, o il prossimo salvataggio della stessa scheda
    // prenderebbe un 409 contro se stessa.
    con_versione(StatusCode::NO_CONTENT.into_response(), &yaml)
}

/// `DELETE /api/synoptics/:name` — removes the page's YAML file from disk.
/// Without this, `deletePage`/`renamePage` in the editor were purely
/// in-memory: `list_synoptics` enumerates every `*.yaml` under `synoptics/`,
/// so a page removed only from the in-memory array reappeared on the next
/// load (project reopen, deploy zip, viewer refresh) because its file was
/// never actually removed. Same pattern as `delete_faceplate`/`delete_recipe`.
async fn delete_synoptic(State(s): State<AppState>, Path(name): Path<String>) -> StatusCode {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c,
    };
    let path = synoptics_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&name)));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

// ── Faceplate endpoints ──────────────────────────────────────────────────────

// Built-in faceplates embedded at compile time — always available.
const BUILTIN_FACEPLATES: &[(&str, &str)] = &[
    (
        "motor_basic",
        include_str!("../../../assets/faceplates/motor_basic.yaml"),
    ),
    (
        "valve_basic",
        include_str!("../../../assets/faceplates/valve_basic.yaml"),
    ),
    (
        "tank_level",
        include_str!("../../../assets/faceplates/tank_level.yaml"),
    ),
];

// ── Project images ────────────────────────────────────────────────────────────
// Immagini caricate dall'utente (sfondi widget via bg_image, ecc.), salvate in
// <progetto>/images/ — cartella visibile, come history/backups/. Viaggiano col
// progetto: incluse nel bundle export/deploy, nei backup (BACKED_UP) e
// sovrascritte dal deploy (DESIGN_ARTIFACTS). Gli oggetti le referenziano con
// l'URL relativo `/api/project/images/<nome>`, servito da entrambe le porte.

pub fn images_dir_at(project_dir: &std::path::Path) -> PathBuf {
    project_dir.join("images")
}

/// Nome file sicuro + estensione riconosciuta → content-type. `None` = rifiuto.
/// Whitelist deliberata: la cartella è servita al viewer anonimo, non deve
/// poter ospitare contenuti arbitrari (html/js) caricati da un supervisor.
fn image_content_type(name: &str) -> Option<&'static str> {
    if name.is_empty() || name.len() > 128 {
        return None;
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return None;
    }
    if name.starts_with('.') || name.contains("..") {
        return None;
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize)]
struct ProjectImageInfo {
    name: String,
    size_bytes: u64,
}

/// `GET /api/project/images` — elenco delle immagini del progetto attivo.
async fn list_project_images(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let mut out: Vec<ProjectImageInfo> = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(images_dir_at(&dir)).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if image_content_type(&name).is_none() {
                continue;
            }
            let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
            out.push(ProjectImageInfo {
                name,
                size_bytes: size,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Json(out).into_response()
}

/// `GET /api/project/images/:name` — serve il file. Anche sul viewer: i
/// sinottici che referenziano un'immagine devono poterla mostrare all'operatore
/// anonimo esattamente come mostrano le pagine.
async fn get_project_image(State(s): State<AppState>, Path(name): Path<String>) -> Response {
    let Some(ctype) = image_content_type(&name) else {
        return (StatusCode::BAD_REQUEST, "nome immagine non valido").into_response();
    };
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    match tokio::fs::read(images_dir_at(&dir).join(&name)).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, ctype)
            // Cacheabile a breve: i canvas le richiedono a ogni render della
            // pagina; il nome resta stabile, chi la sostituisce ricarica.
            .header(header::CACHE_CONTROL, "max-age=60")
            .body(Body::from(bytes))
            .unwrap(),
        Err(_) => (StatusCode::NOT_FOUND, "immagine non trovata").into_response(),
    }
}

/// `POST /api/project/images/:name` — upload (corpo raw). Supervisor+.
async fn upload_project_image(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(name): Path<String>,
    body: Bytes,
) -> Response {
    if image_content_type(&name).is_none() {
        return (
            StatusCode::BAD_REQUEST,
            "nome non valido: solo lettere/numeri/._- ed estensioni png, jpg, jpeg, gif, svg, webp",
        )
            .into_response();
    }
    if body.is_empty() {
        return (StatusCode::BAD_REQUEST, "file vuoto").into_response();
    }
    if body.len() > MAX_IMAGE_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "immagine troppo grande ({} KB, max {} KB)",
                body.len() / 1024,
                MAX_IMAGE_BYTES / 1024
            ),
        )
            .into_response();
    }
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let images = images_dir_at(&dir);
    if let Err(e) = tokio::fs::create_dir_all(&images).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("mkdir images: {e}"),
        )
            .into_response();
    }
    if let Err(e) = tokio::fs::write(images.join(&name), &body).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("scrittura fallita: {e}"),
        )
            .into_response();
    }
    s.audit.log(
        "project.image_upload",
        Some(user.username),
        serde_json::json!({
            "name": name, "size_bytes": body.len(),
        }),
    );
    Json(serde_json::json!({ "name": name, "url": format!("/api/project/images/{name}") }))
        .into_response()
}

/// `DELETE /api/project/images/:name` — rimozione. Supervisor+.
async fn delete_project_image(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(name): Path<String>,
) -> Response {
    if image_content_type(&name).is_none() {
        return (StatusCode::BAD_REQUEST, "nome immagine non valido").into_response();
    }
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    match tokio::fs::remove_file(images_dir_at(&dir).join(&name)).await {
        Ok(()) => {
            s.audit.log(
                "project.image_delete",
                Some(user.username),
                serde_json::json!({ "name": name }),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "immagine non trovata").into_response(),
    }
}

fn faceplates_dir_at(project_dir: &std::path::Path) -> PathBuf {
    project_dir.join("faceplates")
}

async fn list_faceplates(State(s): State<AppState>) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = faceplates_dir_at(&project_dir);
    let mut ids: std::collections::HashSet<String> = BUILTIN_FACEPLATES
        .iter()
        .map(|(id, _)| id.to_string())
        .collect();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    ids.insert(stem.to_owned());
                }
            }
        }
    }
    let mut sorted: Vec<String> = ids.into_iter().collect();
    sorted.sort();
    Json(sorted).into_response()
}

async fn get_faceplate(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let path = faceplates_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    // Project-specific faceplate wins over built-in.
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => {
            // Fall back to built-in.
            match BUILTIN_FACEPLATES
                .iter()
                .find(|(bid, _)| *bid == id.as_str())
            {
                Some((_, yaml)) => yaml.to_string(),
                None => return StatusCode::NOT_FOUND.into_response(),
            }
        }
    };
    match serde_yaml::from_str::<FaceplateDef>(&text) {
        // Q30: la versione di questo faceplate, dal testo appena letto.
        Ok(fp) => con_versione(Json(fp).into_response(), &text),
        Err(e) => {
            warn!("failed to parse faceplate {id}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn save_faceplate(
    State(s): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(mut fp): Json<FaceplateDef>,
) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = faceplates_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("cannot create faceplates dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    fp.id = id.clone();
    let path = dir.join(format!("{}.yaml", safe_filename(&id)));
    // Q30, stesso meccanismo dei sinottici: un file per entità, e la corsa è
    // fra due che salvano lo stesso.
    let su_disco = tokio::fs::read_to_string(&path).await.ok();
    if let Some(r) = conflitto_di_versione(
        versione_attesa(&headers).as_deref(),
        su_disco.as_deref(),
        "Questo faceplate",
    ) {
        return r;
    }
    match serde_yaml::to_string(&fp) {
        Ok(yaml) => match scrivi_atomico(&path, yaml.as_bytes()).await {
            Ok(()) => con_versione(StatusCode::NO_CONTENT.into_response(), &yaml),
            Err(e) => {
                warn!("cannot write faceplate {id}: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        },
        Err(e) => {
            warn!("cannot serialize faceplate {id}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_faceplate(State(s): State<AppState>, Path(id): Path<String>) -> StatusCode {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c,
    };
    let path = faceplates_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

// ── Recipes ───────────────────────────────────────────────────────────────────

fn recipes_dir_at(project_dir: &std::path::Path) -> PathBuf {
    project_dir.join("recipes")
}

async fn list_recipes(State(s): State<AppState>) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = recipes_dir_at(&project_dir);
    let mut recipes: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Ok(text) = tokio::fs::read_to_string(&path).await {
                    if let Ok(r) = serde_yaml::from_str::<RecipeDef>(&text) {
                        recipes.push(serde_json::json!({
                            "id": r.id,
                            "name": r.name,
                            "setpoints_count": r.setpoints.len()
                        }));
                    }
                }
            }
        }
    }
    recipes.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Json(recipes).into_response()
}

async fn get_recipe(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let path = recipes_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    match tokio::fs::read_to_string(&path).await {
        Err(_) => StatusCode::NOT_FOUND.into_response(),
        Ok(text) => match serde_yaml::from_str::<RecipeDef>(&text) {
            // Q30: la versione di questa ricetta.
            Ok(r) => con_versione(Json(r).into_response(), &text),
            Err(e) => {
                warn!("failed to parse recipe {id}: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        },
    }
}

async fn save_recipe(
    State(s): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(mut recipe): Json<RecipeDef>,
) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let dir = recipes_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("cannot create recipes dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    recipe.id = id.clone();
    let path = dir.join(format!("{}.yaml", safe_filename(&id)));
    // Q30, come sinottici e faceplate.
    let su_disco = tokio::fs::read_to_string(&path).await.ok();
    if let Some(r) = conflitto_di_versione(
        versione_attesa(&headers).as_deref(),
        su_disco.as_deref(),
        "Questa ricetta",
    ) {
        return r;
    }
    match serde_yaml::to_string(&recipe) {
        Ok(yaml) => match scrivi_atomico(&path, yaml.as_bytes()).await {
            Ok(()) => con_versione(StatusCode::NO_CONTENT.into_response(), &yaml),
            Err(e) => {
                warn!("cannot write recipe {id}: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        },
        Err(e) => {
            warn!("cannot serialize recipe {id}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_recipe(State(s): State<AppState>, Path(id): Path<String>) -> StatusCode {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c,
    };
    let path = recipes_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct ApplyRecipeBody {
    #[serde(default = "default_applied_by")]
    applied_by: String,
}
fn default_applied_by() -> String {
    "operator".to_string()
}

async fn apply_recipe(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
    Json(body): Json<ApplyRecipeBody>,
) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let path = recipes_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let recipe = match serde_yaml::from_str::<RecipeDef>(&text) {
        Ok(r) => r,
        Err(e) => {
            warn!("recipe parse error {id}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    // Q17 — la soglia per-tag vale anche qui, come su PUT e WS (F3.1), e
    // vale ALL-OR-NOTHING: il ruolo di ogni setpoint è conoscibile prima di
    // toccare l'impianto, e applicare mezza ricetta è peggio che rifiutarla.
    // (Gli errori di *runtime* — tipo, canale chiuso — restano per-setpoint
    // più sotto: quelli prima non si possono sapere.)
    let mut vietati: Vec<String> = Vec::new();
    for sp in &recipe.setpoints {
        if !tag_write_allowed(&s.db, &sp.tag, user.role).await {
            vietati.push(sp.tag.clone());
        }
    }
    if !vietati.is_empty() {
        s.audit.log(
            "recipe.apply_denied",
            Some(user.username),
            serde_json::json!({
                "recipe": recipe.id, "role": user.role.as_str(), "tags": vietati,
            }),
        );
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({
            "error": format!("la ricetta «{}» scrive tag sopra il tuo ruolo ({}) — nessun setpoint applicato", recipe.id, user.role.as_str()),
            "denied": vietati,
        }))).into_response();
    }

    let mut applied = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for sp in &recipe.setpoints {
        let tv = match json_to_tag_value(&sp.value) {
            Some(v) => v,
            None => {
                errors.push(format!("{}: unsupported value type", sp.tag));
                continue;
            }
        };
        // Q27: le ricette sono un percorso di scrittura utente come gli altri.
        let tv = match s.db.coerce_for_write(&sp.tag, tv).await {
            Ok(v) => v,
            Err(msg) => {
                errors.push(msg);
                continue;
            }
        };
        let raw = s.db.scale_to_raw(&sp.tag, tv.clone()).await;
        match s.bus.write(&sp.tag, raw).await {
            Ok(()) => applied += 1,
            Err(WriteError::NoWriter(_)) => {
                s.db.set(sp.tag.clone(), tv, TagQuality::Good).await;
                applied += 1;
            }
            Err(e) => errors.push(format!("{}: {e}", sp.tag)),
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    s.recipe_log.write().await.push(RecipeApplyEvent {
        recipe_id: recipe.id.clone(),
        recipe_name: recipe.name.clone(),
        ts_ms: now,
        applied_by: body.applied_by.clone(),
        setpoints_count: applied,
    });
    // Q17 — lo storico ricette tiene l'`applied_by` del body (campo libero,
    // «chi era al pannello»); la verità firmata sta nell'audit hash-chained,
    // dove prima l'apply non lasciava traccia — unico percorso di scrittura
    // senza. `errors` qui è il conteggio dei setpoint falliti a runtime.
    s.audit.log(
        "recipe.apply",
        Some(user.username),
        serde_json::json!({
            "recipe": recipe.id, "applied": applied,
            "total": recipe.setpoints.len(), "errors": errors.len(),
            "applied_by": body.applied_by,
        }),
    );

    Json(serde_json::json!({
        "recipe_id": recipe.id,
        "applied": applied,
        "total": recipe.setpoints.len(),
        "errors": errors,
        "applied_by": body.applied_by,
        "ts_ms": now,
    }))
    .into_response()
}

async fn get_recipe_history(State(s): State<AppState>) -> impl IntoResponse {
    let mut events: Vec<RecipeApplyEvent> = s.recipe_log.read().await.clone();
    events.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms));
    Json(events)
}

fn json_to_tag_value(v: &serde_json::Value) -> Option<TagValue> {
    match v {
        serde_json::Value::Bool(b) => Some(TagValue::Bool(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(TagValue::Int(i))
            } else {
                n.as_f64().map(TagValue::Float)
            }
        }
        serde_json::Value::String(s) => Some(TagValue::Str(s.clone())),
        // Fase 1d: una ricetta può portare il valore di un array o di una
        // struttura intera. `null` resta fuori: non è un valore, è l'assenza.
        serde_json::Value::Array(a) => a
            .iter()
            .map(json_to_tag_value)
            .collect::<Option<Vec<_>>>()
            .map(TagValue::Array),
        serde_json::Value::Object(m) => m
            .iter()
            .map(|(k, v)| json_to_tag_value(v).map(|tv| (k.clone(), tv)))
            .collect::<Option<std::collections::BTreeMap<_, _>>>()
            .map(TagValue::Struct),
        serde_json::Value::Null => None,
    }
}

// ── WebSocket (T-16 delta batching + T-17 per-page subscription) ─────────────
//
// Protocol v2 (from this commit):
//   Client → Server:
//     {type:"subscribe", tags:["id1","id2",...]}  — ["*"] or [] = all tags
//     {type:"write", tag, value, req_id?}           — Operator+ only
//
//   Server → Client:
//     {type:"snapshot", tags:[{id,value,quality,ts}], seq:N}  — on connect or re-subscribe
//     {type:"delta",   changed:[{id,value,quality,ts}], seq:N} — batched updates (≤50ms window)
//     {type:"ack",     tag, ok, req_id?, error?}               — write response

/// Inbound message frame for `/ws/tags`.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum InboundMsg {
    Write {
        tag: String,
        value: TagValue,
        #[serde(default)]
        req_id: Option<String>,
    },
    /// Replace the subscription filter. ["*"] or empty = all tags (default).
    Subscribe {
        tags: Vec<String>,
        /// Fase 1d: `true` = mandami le **radici** composite intere invece
        /// delle foglie. Assente o `false` = foglie, che è il default perché
        /// questi frame sono tipizzati e una sola voce composita farebbe
        /// perdere l'intero pacchetto ai client che non se l'aspettano — il
        /// viewer LVGL fra questi.
        #[serde(default)]
        composito: bool,
    },
}

#[derive(serde::Serialize)]
struct WsTagEntry<'a> {
    id: &'a str,
    value: &'a TagValue,
    quality: &'a TagQuality,
    ts: u64,
}

#[derive(serde::Serialize)]
struct WsSnapshotMsg<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    tags: Vec<WsTagEntry<'a>>,
    seq: u64,
}

#[derive(serde::Serialize)]
struct WsDeltaMsg<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    changed: Vec<WsTagEntry<'a>>,
    seq: u64,
}

#[derive(serde::Serialize)]
struct WriteAck {
    #[serde(rename = "type")]
    ty: &'static str,
    req_id: Option<String>,
    tag: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Segnala che il PROGETTO è cambiato: chi guarda una pagina deve rileggerla.
///
/// Da chiamare dove il progetto viene sostituito o modificato sul disco, non a
/// ogni scrittura di tag — quelle viaggiano già come delta su `/ws/tags` e non
/// richiedono di ridisegnare niente.
pub fn signal_project_changed(s: &AppState, what: &str) {
    s.project_epoch.send_modify(|e| *e = e.wrapping_add(1));
    tracing::debug!(what, "progetto cambiato: notificati i viewer connessi");

    // Q25: il progetto dichiara quale motore vuole a schermo, e il pezzo lato
    // host lo legge da un file. Si aggiorna qui perché questo è l'unico punto
    // per cui passa ogni sostituzione del progetto — apertura, import,
    // ripristino di backup — invece di ripetere la stessa chiamata in tre
    // gestori che possono divergere.
    //
    // In un task a parte: questa funzione è sincrona e viene chiamata da
    // gestori che hanno già risposto o stanno per farlo. Far aspettare una
    // risposta HTTP per una lettura di file e un confronto sarebbe pagare due
    // volte per niente, e un errore qui non deve poter far fallire il
    // salvataggio che l'ha provocata.
    let config_dir = s.config_dir.clone();
    let project_dir = s.project_dir.clone();
    let what = what.to_string();
    tokio::spawn(async move {
        match project_dir.read().await.clone() {
            Some(dir) => {
                crate::display_target::publish(&config_dir, &dir).await;
                // T-72 F5: anche l'immagine di boot abilitata dal progetto.
                crate::boot_image::publish(&config_dir, &dir).await;
            }
            // Non un `if let` muto: senza questa riga il caso «nessun progetto
            // attivo» era indistinguibile da «pubblicato correttamente», ed è
            // costato una diagnosi. Su un dispositivo appena installato il
            // segnale di apertura arrivava prima che la directory attiva fosse
            // impostata, quindi qui non c'era niente da leggere e il pannello
            // non commutava — senza che nulla lo dicesse.
            None => tracing::warn!(
                what,
                "display-target non aggiornato: nessun progetto attivo al momento del segnale"
            ),
        }
    });
}

async fn ws_tags_handler(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> impl IntoResponse {
    let epoch_rx = s.project_epoch.subscribe();
    ws.on_upgrade(move |socket| handle_ws(socket, s.db, s.bus, user.role, epoch_rx))
}

async fn handle_ws(
    socket: WebSocket,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    role: Role,
    mut epoch_rx: tokio::sync::watch::Receiver<u64>,
) {
    use futures_util::{SinkExt, StreamExt};
    use std::collections::{HashMap, HashSet};

    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Message>(64);

    // Sequence counter (per-connection monotonic).
    let mut seq: u64 = 0;

    // Helper: build + send snapshot for the current subscription.
    let send_snapshot = |sub: &Option<HashSet<String>>,
                         snapshot: Vec<(TagId, TagState)>,
                         seq: u64,
                         tx: &tokio::sync::mpsc::Sender<Message>| {
        let tags: Vec<_> = snapshot
            .iter()
            .filter(|(id, _)| sub.as_ref().is_none_or(|s| s.contains(id)))
            .map(|(id, st)| (id.clone(), st.clone()))
            .collect();
        let entries: Vec<WsTagEntry> = tags
            .iter()
            .map(|(id, st)| WsTagEntry {
                id,
                value: &st.value,
                quality: &st.quality,
                ts: st.timestamp_ms,
            })
            .collect();
        let msg = WsSnapshotMsg {
            ty: "snapshot",
            tags: entries,
            seq,
        };
        if let Ok(text) = serde_json::to_string(&msg) {
            let _ = tx.try_send(Message::Text(text));
        }
    };

    // Initial snapshot. Espanso in foglie: è il default del filo (Fase 1d),
    // e finché nessuno chiede `composito` resta così.
    let snapshot = db.snapshot_foglie().await;
    {
        let entries: Vec<_> = snapshot
            .iter()
            .map(|(id, st)| (id.clone(), st.clone()))
            .collect();
        let ws_entries: Vec<WsTagEntry> = entries
            .iter()
            .map(|(id, st)| WsTagEntry {
                id,
                value: &st.value,
                quality: &st.quality,
                ts: st.timestamp_ms,
            })
            .collect();
        let msg = WsSnapshotMsg {
            ty: "snapshot",
            tags: ws_entries,
            seq,
        };
        if let Ok(text) = serde_json::to_string(&msg) {
            if out_tx.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
    }

    // Forwarder: pumps mpsc → socket.
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Delta batcher: collects incoming tag updates into a 50ms window,
    // then flushes as one delta frame.
    let mut rx = db.subscribe();
    let broadcast_tx = out_tx.clone();

    // pending accumulator: id → latest state within the current window.
    let mut pending: HashMap<String, TagState> = HashMap::new();
    let flush_interval = std::time::Duration::from_millis(50);
    let mut flush_tick = tokio::time::interval(flush_interval);
    flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // subscription_rx: notified when the subscription changes so the batcher
    // can use the current filter. We share it via an atomic-guarded cell.
    use std::sync::Arc as StdArc;
    // Fase 1d: il client vuole le radici composite intere? Un flag, condiviso
    // col batcher come `sub_cell`. Atomico e non RwLock: è un bool letto a
    // ogni flush, e un lock in più sul percorso caldo non paga.
    let composito_cell = StdArc::new(std::sync::atomic::AtomicBool::new(false));
    let composito_batcher = StdArc::clone(&composito_cell);

    let sub_cell: StdArc<tokio::sync::RwLock<Option<HashSet<String>>>> =
        StdArc::new(tokio::sync::RwLock::new(None));
    let sub_cell_batcher = StdArc::clone(&sub_cell);

    let mut batcher_seq: u64 = seq + 1; // seq 0 used by snapshot
    let db_batcher = db.clone();
    let broadcast_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                res = rx.recv() => {
                    match res {
                        Ok(update) => {
                            pending.insert(update.id, update.state);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!("ws/tags subscriber lagged by {n}");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
                // Il progetto è cambiato sul disco: chi disegna una pagina deve
                // rileggerla. Si manda una notifica secca, senza il contenuto:
                // il client sa quale pagina sta guardando, il server no — e
                // spedire l'intera pagina a ogni salvataggio, a chiunque sia
                // connesso, costerebbe molto più del round-trip che risparmia.
                res = epoch_rx.changed() => {
                    if res.is_err() { break; }  // il mittente non c'è più: il runtime sta chiudendo
                    let msg = serde_json::json!({ "type": "project_changed" }).to_string();
                    if broadcast_tx.send(Message::Text(msg)).await.is_err() { break; }
                }
                _ = flush_tick.tick() => {
                    if pending.is_empty() { continue; }
                    // Fase 1d: una radice composita si espande nelle sue
                    // foglie PRIMA del filtro, così chi si è iscritto a
                    // `motore1.velocita` riceve quella e non la struttura.
                    let grezzi: Vec<(String, TagState)> = pending.drain().collect();
                    let composito = composito_batcher.load(std::sync::atomic::Ordering::Relaxed);
                    let mut espansi: Vec<(String, TagState)> = Vec::with_capacity(grezzi.len());
                    for (id, state) in grezzi {
                        if composito {
                            espansi.push((id, state));
                        } else {
                            let update = TagUpdate { id, state };
                            espansi.extend(db_batcher.espandi_foglie(&update).await);
                        }
                    }
                    let sub = sub_cell_batcher.read().await;
                    let changed: Vec<(String, TagState)> = espansi.into_iter()
                        .filter(|(id, _)| sub.as_ref().is_none_or(|s| s.contains(id)))
                        .collect();
                    drop(sub);
                    if changed.is_empty() { continue; }
                    let entries: Vec<WsTagEntry> = changed.iter().map(|(id, st)| WsTagEntry {
                        id,
                        value: &st.value,
                        quality: &st.quality,
                        ts: st.timestamp_ms,
                    }).collect();
                    let msg = WsDeltaMsg { ty: "delta", changed: entries, seq: batcher_seq };
                    batcher_seq = batcher_seq.wrapping_add(1);
                    if let Ok(text) = serde_json::to_string(&msg) {
                        if broadcast_tx.send(Message::Text(text)).await.is_err() { break; }
                    }
                }
            }
        }
    });

    // Inbound loop: writes and subscribe messages.
    while let Some(frame) = ws_rx.next().await {
        let frame = match frame {
            Ok(f) => f,
            Err(_) => break,
        };
        match frame {
            Message::Text(text) => {
                let parsed: Result<InboundMsg, _> = serde_json::from_str(&text);
                let Ok(msg) = parsed else {
                    let ack = WriteAck {
                        ty: "ack",
                        req_id: None,
                        tag: String::new(),
                        ok: false,
                        error: Some("invalid frame".into()),
                    };
                    let _ = out_tx
                        .send(Message::Text(
                            serde_json::to_string(&ack).unwrap_or_default(),
                        ))
                        .await;
                    continue;
                };
                match msg {
                    InboundMsg::Write { tag, value, req_id } => {
                        if role < Role::Operator {
                            let ack = WriteAck {
                                ty: "ack",
                                req_id,
                                tag,
                                ok: false,
                                error: Some("forbidden: Operator+ required".into()),
                            };
                            let _ = out_tx
                                .send(Message::Text(
                                    serde_json::to_string(&ack).unwrap_or_default(),
                                ))
                                .await;
                            continue;
                        }
                        // F3.1: soglia per-tag (TagDef.write_min_role) sopra la regola storica.
                        if !tag_write_allowed(&db, &tag, role).await {
                            let ack = WriteAck {
                                ty: "ack",
                                req_id,
                                tag,
                                ok: false,
                                error: Some("forbidden: ruolo insufficiente per questo tag".into()),
                            };
                            let _ = out_tx
                                .send(Message::Text(
                                    serde_json::to_string(&ack).unwrap_or_default(),
                                ))
                                .await;
                            continue;
                        }
                        // Q27: stesso contratto del PUT — l'ack negativo porta il motivo.
                        let value = match db.coerce_for_write(&tag, value).await {
                            Ok(v) => v,
                            Err(msg) => {
                                let ack = WriteAck {
                                    ty: "ack",
                                    req_id,
                                    tag,
                                    ok: false,
                                    error: Some(msg),
                                };
                                let _ = out_tx
                                    .send(Message::Text(
                                        serde_json::to_string(&ack).unwrap_or_default(),
                                    ))
                                    .await;
                                continue;
                            }
                        };
                        let raw = db.scale_to_raw(&tag, value.clone()).await;
                        let (ok, err) = match bus.write(&tag, raw).await {
                            Ok(()) => (true, None),
                            Err(WriteError::NoWriter(_)) => {
                                db.set(tag.clone(), value, TagQuality::Good).await;
                                (true, None)
                            }
                            Err(e @ WriteError::ChannelClosed(_)) => (false, Some(e.to_string())),
                        };
                        let ack = WriteAck {
                            ty: "ack",
                            req_id,
                            tag,
                            ok,
                            error: err,
                        };
                        let _ = out_tx
                            .send(Message::Text(
                                serde_json::to_string(&ack).unwrap_or_default(),
                            ))
                            .await;
                    }
                    InboundMsg::Subscribe { tags, composito } => {
                        // Update subscription filter.
                        let new_sub: Option<HashSet<String>> =
                            if tags.is_empty() || tags.iter().any(|t| t == "*") {
                                None // all tags
                            } else {
                                Some(tags.into_iter().collect())
                            };
                        // Update shared filter for the batcher task.
                        *sub_cell.write().await = new_sub.clone();
                        composito_cell.store(composito, std::sync::atomic::Ordering::Relaxed);
                        // Send fresh snapshot for the new subscription.
                        seq = seq.wrapping_add(1);
                        let snap = if composito {
                            db.snapshot().await
                        } else {
                            db.snapshot_foglie().await
                        };
                        let snap_vec: Vec<(TagId, TagState)> = snap.into_iter().collect();
                        send_snapshot(&new_sub, snap_vec, seq, &out_tx);
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    broadcast_task.abort();
    drop(out_tx);
    let _ = forward_task.await;
}

// ── Log streaming ────────────────────────────────────────────────────────────

async fn get_logs(State(s): State<AppState>) -> Json<Vec<LogEvent>> {
    Json(s.logs.snapshot())
}

/// `GET /api/logs/files` — list available historical JSONL files in logs_dir.
/// Returns `[{ date: "YYYY-MM-DD", size_bytes }]` sorted newest-first.
async fn list_log_files(State(s): State<AppState>) -> Response {
    #[derive(serde::Serialize)]
    struct FileEntry {
        date: String,
        size_bytes: u64,
    }

    let dir = s.logs_dir.as_path();
    let mut out: Vec<FileEntry> = Vec::new();

    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let fname = entry.file_name();
            let fname_str = fname.to_string_lossy();
            // Match "runtime-YYYY-MM-DD.jsonl"
            if let Some(date) = fname_str
                .strip_prefix("runtime-")
                .and_then(|s| s.strip_suffix(".jsonl"))
            {
                // Validate date format: YYYY-MM-DD (10 chars, digits and dashes)
                if date.len() == 10 && date.chars().all(|c| c.is_ascii_digit() || c == '-') {
                    let size_bytes = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
                    out.push(FileEntry {
                        date: date.to_string(),
                        size_bytes,
                    });
                }
            }
        }
    }

    out.sort_by(|a, b| b.date.cmp(&a.date)); // newest first
    Json(out).into_response()
}

/// `GET /api/logs/file?date=YYYY-MM-DD` — parse and return a historical log file.
async fn get_log_file(
    State(s): State<AppState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let date = match q.get("date") {
        Some(d) if d.len() == 10 && d.chars().all(|c| c.is_ascii_digit() || c == '-') => d.clone(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                "missing or invalid ?date=YYYY-MM-DD",
            )
                .into_response()
        }
    };
    let path = s.logs_dir.join(format!("runtime-{date}.jsonl"));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return (StatusCode::NOT_FOUND, "log file not found").into_response();
        }
        Err(e) => {
            warn!("get_log_file: read {}: {e}", path.display());
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot read log file").into_response();
        }
    };

    let events: Vec<LogEvent> = text
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    Json(events).into_response()
}

async fn ws_logs_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_logs_ws(socket, s.logs))
}

async fn handle_logs_ws(mut socket: WebSocket, logs: Arc<LogBus>) {
    // Snapshot first so a fresh client sees recent history before the live tail.
    for ev in logs.snapshot() {
        if let Ok(text) = serde_json::to_string(&ev) {
            if socket.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
    }
    let mut rx = logs.subscribe();
    loop {
        match rx.recv().await {
            Ok(ev) => {
                if let Ok(text) = serde_json::to_string(&ev) {
                    if socket.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                // Lagged subscribers silently miss events — the snapshot
                // already covered everything up to subscribe-time and we
                // don't emit a "log about logs" to avoid a feedback loop.
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ── MQTT broker browse ────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct MqttBrowseRequest {
    host: String,
    port: u16,
    /// If provided and `password` is the masked sentinel, the real password is
    /// resolved from the saved project source with this ID.
    source_id: Option<String>,
    client_id: String,
    username: Option<String>,
    password: Option<String>,
    #[serde(default)]
    tls_enabled: bool,
    #[serde(default)]
    insecure_skip_verify: bool,
    ca_cert_path: Option<String>,
    /// Seconds to listen. Capped at 15 to avoid long-blocking requests.
    duration_secs: Option<u8>,
}

#[derive(serde::Serialize)]
struct BrowsedTopicDto {
    topic: String,
    sample_payload: String,
}

#[derive(serde::Serialize)]
struct MqttBrowseResponse {
    topics: Vec<BrowsedTopicDto>,
}

// ── OPC-UA browse (BL-005 step 3) ────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct OpcUaBrowseRequest {
    endpoint_url: String,
    /// When the caller sends the masked sentinel password, we substitute the
    /// real one from project.yaml by looking up the matching source id.
    /// Same pattern as mqtt_browse_handler.
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    auth: Option<sws_core::OpcUaAuth>,
    /// Optional NodeId to browse under (e.g. `ns=2;s=Machine`). Defaults to
    /// the Objects folder on the server.
    #[serde(default)]
    parent_node_id: Option<String>,
    /// Optional browse direction: "forward" (default), "inverse" (inbound
    /// refs), or "both". Forward is what the UI tree uses.
    #[serde(default)]
    direction: Option<sws_plugin_opcua::BrowseDir>,
    /// Optional security policy override (defaults to "None" if unset).
    /// Useful when the caller wants to test a Basic256Sha256 connection
    /// without saving the source first.
    #[serde(default)]
    security_policy: Option<String>,
}

async fn opcua_browse_handler(
    State(s): State<AppState>,
    Json(mut req): Json<OpcUaBrowseRequest>,
) -> Response {
    // Resolve a masked password from project.yaml when the editor sends
    // the sentinel — keeps secrets out of round-trips just like the MQTT
    // path. Only `UsernamePassword` carries a password.
    if let Some(sws_core::OpcUaAuth::UsernamePassword {
        password: Some(ref p),
        ..
    }) = req.auth
    {
        if p == MASKED_PASSWORD {
            if let (Some(sid), Ok(dir)) = (req.source_id.as_ref(), active_dir(&s).await) {
                if let Ok(project) = Project::load(&dir) {
                    for src in &project.sources {
                        if let SourceDef::OpcUaClient(c) = src {
                            if c.id.as_str() == sid.as_str() {
                                if let sws_core::OpcUaAuth::UsernamePassword {
                                    password: Some(stored),
                                    ..
                                } = &c.auth
                                {
                                    if let sws_core::OpcUaAuth::UsernamePassword {
                                        password, ..
                                    } = &mut req.auth.as_mut().unwrap()
                                    {
                                        *password = Some(stored.clone());
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Build a throwaway OpcUaClientConfig for the helper. We don't touch
    // the persisted project — the browse is a one-shot lookup.
    let cfg = sws_core::OpcUaClientConfig {
        id: "browse".into(),
        endpoint_url: req.endpoint_url,
        security_policy: req.security_policy.unwrap_or_else(|| "None".into()),
        auth: req.auth.unwrap_or_default(),
        subscription_interval_ms: 1000,
        nodes: Vec::new(),
        trust_all_certs: true,
    };
    let direction = req.direction.unwrap_or_default();

    match sws_plugin_opcua::browse_one_level(&cfg, req.parent_node_id.as_deref(), direction).await {
        Ok(nodes) => Json(serde_json::json!({ "nodes": nodes })).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, format!("opcua browse failed: {e}")).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct OpcUaDetectEuromapRequest {
    endpoint_url: String,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    auth: Option<sws_core::OpcUaAuth>,
    #[serde(default)]
    security_policy: Option<String>,
}

async fn opcua_detect_euromap_handler(
    State(s): State<AppState>,
    Json(mut req): Json<OpcUaDetectEuromapRequest>,
) -> Response {
    // Same masked-password sentinel resolution pattern as opcua_browse.
    if let Some(sws_core::OpcUaAuth::UsernamePassword {
        password: Some(ref p),
        ..
    }) = req.auth
    {
        if p == MASKED_PASSWORD {
            if let (Some(sid), Ok(dir)) = (req.source_id.as_ref(), active_dir(&s).await) {
                if let Ok(project) = Project::load(&dir) {
                    for src in &project.sources {
                        if let SourceDef::OpcUaClient(c) = src {
                            if c.id.as_str() == sid.as_str() {
                                if let sws_core::OpcUaAuth::UsernamePassword {
                                    password: Some(stored),
                                    ..
                                } = &c.auth
                                {
                                    if let sws_core::OpcUaAuth::UsernamePassword {
                                        password, ..
                                    } = &mut req.auth.as_mut().unwrap()
                                    {
                                        *password = Some(stored.clone());
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let cfg = sws_core::OpcUaClientConfig {
        id: "euromap".into(),
        endpoint_url: req.endpoint_url,
        security_policy: req.security_policy.unwrap_or_else(|| "None".into()),
        auth: req.auth.unwrap_or_default(),
        subscription_interval_ms: 1000,
        nodes: Vec::new(),
        trust_all_certs: true,
    };

    match sws_plugin_opcua::detect_euromap(&cfg).await {
        Ok(det) => Json(det).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("opcua euromap detection failed: {e}"),
        )
            .into_response(),
    }
}

// ── OPC-UA historical read ────────────────────────────────────────────────────
//
// POST /api/sources/opcua/history
// Body: { endpoint_url, auth?, security_policy?, node_id, from_ms?, to_ms?, max_values? }
// Returns: [ { ts_ms, value, quality }, … ] sorted ascending by ts_ms.
//
// Operator+ can call this. The source_id field (optional) is used to resolve
// credentials from project.yaml when the editor sends the masked sentinel.

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct OpcUaHistoryRequest {
    endpoint_url: String,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    auth: Option<sws_core::OpcUaAuth>,
    #[serde(default)]
    security_policy: Option<String>,
    node_id: String,
    #[serde(default)]
    from_ms: Option<u64>,
    #[serde(default)]
    to_ms: Option<u64>,
    /// Maximum data points returned by the server. Capped at 2000 server-side.
    #[serde(default)]
    max_values: Option<u32>,
}

async fn opcua_history_handler(
    State(s): State<AppState>,
    Json(mut req): Json<OpcUaHistoryRequest>,
) -> Response {
    // Resolve masked credentials from project.yaml (same pattern as browse).
    if let Some(ref sid) = req.source_id.clone() {
        if req.auth.as_ref().is_none_or(|a| {
            matches!(a, sws_core::OpcUaAuth::UsernamePassword { password: Some(p), .. } if p == MASKED_PASSWORD)
        }) {
            if let Ok(dir) = active_dir(&s).await {
                if let Ok(project) = Project::load(&dir) {
                    if let Some(sws_core::SourceDef::OpcUaClient(c)) = project.sources.iter().find(|src| {
                            matches!(src, sws_core::SourceDef::OpcUaClient(c) if c.id == *sid)
                        }) {
                            req.auth = Some(c.auth.clone());
                        }
                }
            }
        }
    }

    let cfg = sws_core::OpcUaClientConfig {
        id: "history".into(),
        endpoint_url: req.endpoint_url,
        security_policy: req.security_policy.unwrap_or_else(|| "None".into()),
        auth: req.auth.unwrap_or_default(),
        subscription_interval_ms: 1000,
        nodes: Vec::new(),
        trust_all_certs: true,
    };

    let max_values = req.max_values.unwrap_or(500).min(2000);

    match sws_plugin_opcua::read_history(&cfg, &req.node_id, req.from_ms, req.to_ms, max_values)
        .await
    {
        Ok(samples) => Json(samples).into_response(),
        Err(e) => {
            warn!(node = %req.node_id, "opcua history read failed: {e}");
            (
                StatusCode::BAD_GATEWAY,
                format!("opcua history read failed: {e}"),
            )
                .into_response()
        }
    }
}

async fn mqtt_browse_handler(
    State(s): State<AppState>,
    Json(mut req): Json<MqttBrowseRequest>,
) -> Response {
    // Resolve a masked password from the saved project if the caller sent the
    // sentinel and told us which source ID to look up.
    if req.password.as_deref() == Some(MASKED_PASSWORD) {
        if let Some(ref sid) = req.source_id {
            if let Ok(dir) = active_dir(&s).await {
                if let Ok(project) = Project::load(&dir) {
                    for src in &project.sources {
                        if let SourceDef::Mqtt(c) = src {
                            if &c.id == sid {
                                req.password = c.password.clone();
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let duration = req.duration_secs.unwrap_or(30).min(120);
    let params = sws_plugin_mqtt::BrowseParams {
        host: req.host,
        port: req.port,
        client_id: req.client_id,
        username: req.username,
        password: req.password,
        tls_enabled: req.tls_enabled,
        insecure_skip_verify: req.insecure_skip_verify,
        ca_cert_path: req.ca_cert_path,
        duration_secs: duration,
        certificati: s.supervisor.mqtt_certificati.clone(),
    };

    let topics = sws_plugin_mqtt::browse(params)
        .await
        .into_iter()
        .map(|t| BrowsedTopicDto {
            topic: t.topic,
            sample_payload: t.sample_payload,
        })
        .collect();

    Json(MqttBrowseResponse { topics }).into_response()
}

// ── OPC-UA certificate trust management ──────────────────────────────────────
//
// async-opcua writes server certs to:
//   {pki_root}/{source_id}/trusted/certs/*.der   — explicitly trusted
//   {pki_root}/{source_id}/rejected/certs/*.der  — rejected / pending review
//
// The pki_root lives at {project_dir}/opcua-pki/ (set by source_supervisor).

#[derive(serde::Serialize)]
struct OpcUaCertEntry {
    filename: String,
    status: &'static str, // "trusted" | "rejected"
    size_bytes: u64,
}

/// List certs in the per-source trust store.
/// Returns all .der files from trusted/certs and rejected/certs directories.
async fn opcua_list_certs(State(s): State<AppState>, Path(source_id): Path<String>) -> Response {
    let Ok(dir) = active_dir(&s).await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "no active project").into_response();
    };
    let pki_root = dir.join("opcua-pki").join(&source_id);
    let mut entries: Vec<OpcUaCertEntry> = vec![];
    for (subdir, status) in [("trusted/certs", "trusted"), ("rejected/certs", "rejected")] {
        let cert_dir = pki_root.join(subdir);
        let Ok(mut rd) = tokio::fs::read_dir(&cert_dir).await else {
            continue;
        };
        while let Ok(Some(ent)) = rd.next_entry().await {
            let name = ent.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".der") {
                continue;
            }
            let size = ent.metadata().await.map(|m| m.len()).unwrap_or(0);
            entries.push(OpcUaCertEntry {
                filename: name,
                status,
                size_bytes: size,
            });
        }
    }
    Json(entries).into_response()
}

/// Move a cert from rejected/certs to trusted/certs (or no-op if already there).
async fn opcua_trust_cert(
    State(s): State<AppState>,
    Path((source_id, filename)): Path<(String, String)>,
) -> Response {
    if !is_safe_cert_filename(&filename) {
        return (StatusCode::BAD_REQUEST, "invalid filename").into_response();
    }
    let Ok(dir) = active_dir(&s).await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "no active project").into_response();
    };
    let pki_root = dir.join("opcua-pki").join(&source_id);
    let rejected = pki_root.join("rejected/certs").join(&filename);
    let trusted = pki_root.join("trusted/certs");
    if rejected.exists() {
        if let Err(e) = tokio::fs::create_dir_all(&trusted).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
        if let Err(e) = tokio::fs::rename(&rejected, trusted.join(&filename)).await {
            warn!(source = %source_id, file = %filename, "opcua trust: rename failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

/// Remove a cert from either trusted or rejected store.
async fn opcua_delete_cert(
    State(s): State<AppState>,
    Path((source_id, filename)): Path<(String, String)>,
) -> Response {
    if !is_safe_cert_filename(&filename) {
        return (StatusCode::BAD_REQUEST, "invalid filename").into_response();
    }
    let Ok(dir) = active_dir(&s).await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "no active project").into_response();
    };
    let pki_root = dir.join("opcua-pki").join(&source_id);
    let mut deleted = false;
    for subdir in ["trusted/certs", "rejected/certs"] {
        let path = pki_root.join(subdir).join(&filename);
        if path.exists() {
            if let Err(e) = tokio::fs::remove_file(&path).await {
                warn!(source = %source_id, file = %filename, "opcua delete cert: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
            }
            deleted = true;
        }
    }
    if deleted {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (StatusCode::NOT_FOUND, "cert not found").into_response()
    }
}

/// Safety check: filename must be a plain `*.der` with no path components.
fn is_safe_cert_filename(name: &str) -> bool {
    !name.contains('/') && !name.contains('\\') && !name.starts_with('.') && name.ends_with(".der")
}

// ── HomeAssistant entity browse ───────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct HaBrowseRequest {
    /// Source id from the project's sources list — used to look up url+token.
    source_id: String,
    /// Optional filter: only return entities whose id starts with this prefix
    /// (e.g. "sensor.", "light.", "binary_sensor.").
    #[serde(default)]
    domain_filter: Option<String>,
}

#[derive(serde::Serialize)]
struct HaBrowsedEntity {
    entity_id: String,
    state: String,
    friendly_name: Option<String>,
    /// Non-empty attribute names for this entity (sorted, for UI display).
    attributes: Vec<String>,
}

async fn ha_browse_handler(
    State(s): State<AppState>,
    Json(req): Json<HaBrowseRequest>,
) -> Response {
    // Resolve url + token from the saved project.
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(_) => return (StatusCode::BAD_REQUEST, "no project open").into_response(),
    };
    let project = match Project::load(&dir) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("project load: {e}"),
            )
                .into_response()
        }
    };

    let (url, token) = match project.sources.iter().find_map(|src| {
        if let SourceDef::HomeAssistant(c) = src {
            if c.id == req.source_id {
                return Some((c.url.clone(), c.token.clone(), c.token_env.clone()));
            }
        }
        None
    }) {
        Some((url, token_plain, token_env)) => {
            let tok = if let Some(env) = token_env {
                std::env::var(&env).unwrap_or_default()
            } else {
                token_plain.unwrap_or_default()
            };
            (url, tok)
        }
        None => return (StatusCode::NOT_FOUND, "HomeAssistant source not found").into_response(),
    };

    if token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "HomeAssistant token not configured",
        )
            .into_response();
    }

    let states_url = format!("{}/api/states", url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = match client
        .get(&states_url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("HA unreachable: {e}")).into_response(),
    };

    if !resp.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            format!("HA returned {}", resp.status()),
        )
            .into_response();
    }

    let raw: Vec<serde_json::Value> = match resp.json().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("HA parse error: {e}")).into_response(),
    };

    let domain_filter = req.domain_filter.as_deref().unwrap_or("");
    let mut entities: Vec<HaBrowsedEntity> = raw
        .into_iter()
        .filter_map(|v| {
            let entity_id = v.get("entity_id")?.as_str()?.to_string();
            if !domain_filter.is_empty() && !entity_id.starts_with(domain_filter) {
                return None;
            }
            let state = v
                .get("state")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let attrs = v.get("attributes").and_then(|a| a.as_object());
            let friendly_name = attrs
                .and_then(|a| a.get("friendly_name"))
                .and_then(|f| f.as_str())
                .map(|s| s.to_string());
            let mut attribute_names: Vec<String> = attrs
                .map(|a| {
                    let mut names: Vec<String> = a
                        .keys()
                        .filter(|k| *k != "friendly_name")
                        .cloned()
                        .collect();
                    names.sort();
                    names
                })
                .unwrap_or_default();
            attribute_names.sort();
            Some(HaBrowsedEntity {
                entity_id,
                state,
                friendly_name,
                attributes: attribute_names,
            })
        })
        .collect();

    entities.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    Json(entities).into_response()
}

// ── Global scripts ────────────────────────────────────────────────────────────

/// `PUT /api/project/global-scripts` — replace the global script list.
/// Saves to project.yaml and hot-swaps the supervisor.
async fn update_project_global_scripts(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(scripts): Json<Vec<GlobalScriptDef>>,
) -> Response {
    s.audit.log(
        "project.change",
        Some(user.username),
        serde_json::json!({"what": "global_scripts", "count": scripts.len()}),
    );
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.global_scripts = scripts.clone(),
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        // Hot-swap: cancel running scripts, start new set.
        if let Some(old) = s.script_supervisor.write().await.take() {
            old.stop();
        }
        if !scripts.is_empty() {
            // Reuse the running Telegram sink (if any) so restarted scripts keep
            // the send_telegram binding.
            let telegram_tx = s
                .telegram_sender
                .read()
                .await
                .as_ref()
                .map(|ts| ts.text_sender());
            let sc = crate::global_scripts::GlobalScriptSupervisor::start(
                scripts,
                s.db.clone(),
                s.bus.clone(),
                telegram_tx,
                s.functions.clone(),
                s.py.clone(),
            );
            *s.script_supervisor.write().await = Some(sc);
        }
    }
    res
}

// ── T-24 Project fingerprint ─────────────────────────────────────────────────

/// SHA-256 di `project.yaml` più tutti i sinottici, in ordine di nome.
///
/// Estratta dall'handler quando l'assistente (T-50) ha avuto bisogno della
/// stessa impronta da dentro il processo: la proposta se la porta dietro e il
/// browser rifiuta di applicarla se nel frattempo il progetto è cambiato. Una
/// seconda implementazione sarebbe divergita — è già successo tre volte in
/// questo repo, e ogni volta in silenzio.
pub(crate) fn calcola_impronta(dir: &std::path::Path) -> anyhow::Result<String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();

    let yaml = std::fs::read(dir.join("project.yaml"))
        .map_err(|e| anyhow::anyhow!("project.yaml: {e}"))?;
    hasher.update(&yaml);

    // I sinottici in ordine di nome file, per determinismo.
    let syn_dir = dir.join("synoptics");
    if syn_dir.is_dir() {
        let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(&syn_dir)
            .map_err(|e| anyhow::anyhow!("synoptics/: {e}"))?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("yaml"))
            .collect();
        entries.sort();
        for path in &entries {
            // Il nome entra nell'hash: due file con lo stesso contenuto e nomi
            // diversi non sono lo stesso progetto.
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                hasher.update(name.as_bytes());
            }
            let content =
                std::fs::read(path).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
            hasher.update(&content);
        }
    }

    // Le pagine di boot (T-72): una modifica allo splash marca il deploy come
    // non aggiornato. Entrano nell'hash solo se `boot/` c'è, così l'impronta di
    // un progetto senza pagine di boot resta quella di prima.
    let boot_dir = dir.join("boot");
    if boot_dir.is_dir() {
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&boot_dir)
            .map_err(|e| anyhow::anyhow!("boot/: {e}"))?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                matches!(
                    p.extension().and_then(|s| s.to_str()),
                    Some("yaml") | Some("png")
                )
            })
            .collect();
        files.sort();
        for path in &files {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                hasher.update(b"boot/");
                hasher.update(name.as_bytes());
            }
            let content =
                std::fs::read(path).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
            hasher.update(&content);
        }
    }

    let digest = hasher.finalize();
    Ok(digest.iter().fold(String::new(), |mut s, b| {
        s.push_str(&format!("{:02x}", b));
        s
    }))
}

/// `GET /api/project/fingerprint` — SHA-256 of project.yaml + all synoptic YAMLs.
/// The fingerprint is deterministic: same file contents = same hash regardless of
/// when it is computed. Clients compare local vs. remote fingerprint to verify that
/// a deployment is in sync.
async fn get_project_fingerprint(State(s): State<AppState>) -> impl IntoResponse {
    use std::time::{SystemTime, UNIX_EPOCH};

    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let result = tokio::task::spawn_blocking(move || calcola_impronta(&dir)).await;

    match result {
        Ok(Ok(sha256)) => {
            let computed_at_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Json(serde_json::json!({ "sha256": sha256, "computed_at_ms": computed_at_ms }))
                .into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── T-20 GitOps ──────────────────────────────────────────────────────────────

/// `GET /api/project/git-status` — git commit info for the active project dir.
async fn get_git_status(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match gd.status() {
        Ok(st) => Json(st).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/deploy` — `git pull --ff-only` then soft-reload.
async fn trigger_deploy(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir.clone());
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.pull()).await {
        Ok(Ok(msg)) => {
            soft_reload_project(&s, &dir).await;
            Json(serde_json::json!({ "message": msg })).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/rollback` — `git reset --hard HEAD~1` then soft-reload.
async fn trigger_rollback(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir.clone());
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.rollback()).await {
        Ok(Ok(msg)) => {
            soft_reload_project(&s, &dir).await;
            Json(serde_json::json!({ "message": msg })).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9
struct GitCommitBody {
    #[serde(default)]
    message: String,
}

/// `POST /api/project/git/commit` — `git add -A && git commit -m <message>`.
async fn git_commit(
    State(s): State<AppState>,
    Json(body): Json<GitCommitBody>,
) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    let message = body.message.trim().to_string();
    if message.is_empty() {
        return (StatusCode::BAD_REQUEST, "commit message is required").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.commit(&message)).await {
        Ok(Ok(msg)) => Json(serde_json::json!({ "message": msg })).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/git/push` — `git push` to default remote/branch.
async fn git_push(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.push()).await {
        Ok(Ok(msg)) => Json(serde_json::json!({ "message": msg })).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct GitInitBody {
    /// `None` = solo `git init` (progetto già locale senza remote, o non
    /// ancora deciso a quale repository agganciarlo). `Some(url)` = imposta/
    /// sostituisce anche `origin`.
    #[serde(default)]
    remote_url: Option<String>,
}

/// `POST /api/project/git/init` — aggancia il progetto (non l'app SWS) a un
/// repository: `git init` (idempotente) + opzionale `origin`. Prima di questo
/// endpoint `GitOpsPanel` restava vuoto per un progetto senza `.git` — non
/// c'era modo di iniziare da qui.
async fn git_init(State(s): State<AppState>, Json(body): Json<GitInitBody>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    let remote_url = body
        .remote_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(String::from);
    match tokio::task::spawn_blocking(move || gd.init_remote(remote_url.as_deref())).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `GET /api/project/git/tags` — elenco tag del progetto, più recente prima.
async fn list_git_tags(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.list_tags()).await {
        Ok(Ok(tags)) => Json(tags).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct CreateTagBody {
    name: String,
    #[serde(default)]
    message: Option<String>,
}

/// `POST /api/project/git/tags` — crea un tag (annotato se `message` è dato).
async fn create_git_tag(
    State(s): State<AppState>,
    Json(body): Json<CreateTagBody>,
) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, "tag name is required").into_response();
    }
    let message = body
        .message
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(String::from);
    match tokio::task::spawn_blocking(move || gd.create_tag(&name, message.as_deref())).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/git/tags/:name/push` — pubblica un tag esistente su `origin`.
async fn push_git_tag(State(s): State<AppState>, Path(name): Path<String>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.push_tag(&name)).await {
        Ok(Ok(msg)) => Json(serde_json::json!({ "message": msg })).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `DELETE /api/project/git/tags/:name` — elimina un tag (locale + remote se configurato).
async fn delete_git_tag(State(s): State<AppState>, Path(name): Path<String>) -> impl IntoResponse {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.delete_tag(&name)).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// Reload project YAML without restarting sources or clearing the historian.
/// Used by GitOps deploy/rollback to apply config changes from new commits.
async fn soft_reload_project(s: &AppState, dir: &std::path::Path) {
    let project = match Project::load(dir) {
        Ok(p) => p,
        Err(e) => {
            warn!("git deploy: project reload failed: {e:#}");
            return;
        }
    };
    // Prima qui mancavano scale, tipi, ruoli di scrittura e la rimozione dei
    // tag spariti: un deploy da git con una scala nuova mostrava il valore
    // grezzo fino al riavvio (Fase 0d).
    crate::projects::apply_tags(
        &s.db,
        &s.derived_tags,
        &s.generator_tags,
        &project.tags,
        &project.types,
    )
    .await;
    s.alarms.load(project.alarms.clone()).await;
    {
        let mut funcs = s.functions.write().await;
        funcs.clear();
        for f in &project.functions {
            funcs.insert(f.name.clone(), f.clone());
        }
    }
    ricarica_lingue_notifiche(s, dir).await;
    info!(dir = %dir.display(), "git deploy: project soft-reloaded");
}

/// `PUT /api/project/notifications` — save SMTP / notification config and hot-swap supervisor.
/// Preserves the existing SMTP password if the caller sends the masked placeholder.
async fn update_project_notifications(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(config): Json<Option<NotificationConfig>>,
) -> Response {
    s.audit.log(
        "project.change",
        Some(user.username),
        serde_json::json!({"what": "notifications", "enabled": config.is_some()}),
    );
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };

    // Difesa in profondità: se stiamo per perdere un bot_token già salvato,
    // dirlo. Non è ipotetico — un client che manda `notifications` senza la
    // sezione `telegram` (bozza della UI disallineata) cancellava il token in
    // silenzio, e la sola guardia sul placeholder mascherato non lo copriva.
    // Qui non si cambia semantica (disabilitare Telegram deve poterlo
    // rimuovere), si rende l'evento visibile nel log invece che invisibile.
    if let Ok(existing) = Project::load(&dir) {
        let had_token = existing
            .notifications
            .as_ref()
            .and_then(|n| n.telegram.as_ref())
            .map(|t| !t.bot_token.trim().is_empty())
            .unwrap_or(false);
        let keeps_telegram = config
            .as_ref()
            .map(|c| c.telegram.is_some())
            .unwrap_or(false);
        if had_token && !keeps_telegram {
            warn!(
                "notifications: la nuova configurazione non contiene Telegram —                  il bot_token salvato viene rimosso. Se non era intenzionale,                  ri-inseriscilo in Configurazione → Notifiche."
            );
        }
    }

    // Preserve existing secrets when the UI sends the masked placeholder
    // (SMTP password, Telegram bot token).
    let config = if let Some(mut cfg) = config {
        let needs_smtp = cfg
            .smtp
            .as_ref()
            .map(|s| s.password.as_deref() == Some(MASKED_PASSWORD))
            .unwrap_or(false);
        let needs_tg = cfg
            .telegram
            .as_ref()
            .map(|t| t.bot_token == MASKED_PASSWORD)
            .unwrap_or(false);
        if needs_smtp || needs_tg {
            if let Ok(existing) = Project::load(&dir) {
                let existing_notif = existing.notifications;
                if needs_smtp {
                    if let Some(smtp) = &mut cfg.smtp {
                        smtp.password = existing_notif
                            .as_ref()
                            .and_then(|n| n.smtp.as_ref())
                            .and_then(|s| s.password.clone());
                    }
                }
                if needs_tg {
                    if let (Some(tg), Some(tok)) = (
                        cfg.telegram.as_mut(),
                        existing_notif
                            .as_ref()
                            .and_then(|n| n.telegram.as_ref())
                            .map(|t| t.bot_token.clone()),
                    ) {
                        tg.bot_token = tok;
                    }
                }
            }
        }
        Some(cfg)
    } else {
        None
    };

    let config_clone = config.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.notifications = config_clone,
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        riavvia_notifiche(&s, config).await;
    }
    res
}

/// Rifà la fotografia della tabella lingue delle notifiche, **solo se stanno
/// già girando**: a impianto disarmato dall'operatore (Q33) o con le notifiche
/// spente non si avvia niente per un cambio di traduzioni.
async fn ricarica_lingue_notifiche(s: &AppState, dir: &std::path::Path) {
    if s.notification_supervisor.read().await.is_none() {
        return;
    }
    let notifiche = Project::load(dir).ok().and_then(|p| p.notifications);
    riavvia_notifiche(s, notifiche).await;
}

/// Riavvia il canale Telegram e il supervisore delle notifiche con la
/// configurazione data e la tabella lingue **riletta dal progetto aperto**.
/// Serve a chi cambia le notifiche e a chi cambia la tabella lingue: entrambi
/// fotografano `LanguageTable` all'avvio, e senza un riavvio un token nuovo
/// (`{{t0031}}`) arriva grezzo sul telefono di chi è di turno.
async fn riavvia_notifiche(s: &AppState, config: Option<sws_core::NotificationConfig>) {
    // Hot-swap the Telegram sender (config swap keeps the script `tx` alive)
    // then restart the notification supervisor with the shared sink.
    // La tabella lingue si rilegge dal progetto aperto: cambiare le
    // notifiche non deve far ripartire il canale con una tabella vuota, che
    // manderebbe token grezzi a chi è di turno.
    let lingue_tg = crate::router::active_dir(s)
        .await
        .ok()
        .and_then(|d| sws_core::Project::load(&d).ok())
        .map(|p| p.languages)
        .unwrap_or_default();
    let codice_tg = config
        .as_ref()
        .map(|n| n.lingua_per(sws_core::CanaleNotifica::Telegram, &lingue_tg.default))
        .unwrap_or_else(|| lingue_tg.default.clone());
    let sinks = crate::telegram::restart_sender(
        s,
        config.as_ref().and_then(|n| n.telegram.clone()),
        (lingue_tg, codice_tg),
    )
    .await;
    // Aggiorna anche il sink delle funzioni (engine condiviso) senza reopen.
    s.py.set_telegram_sink(sinks.as_ref().map(|k| k.text.clone()));
    if let Some(old) = s.notification_supervisor.write().await.take() {
        old.stop();
    }
    if let Some(cfg) = config {
        // La tabella lingue si rilegge dal progetto aperto: cambiare le
        // notifiche non deve far ripartire il supervisore con una tabella
        // vuota, che manderebbe token grezzi.
        let lingue = crate::router::active_dir(s)
            .await
            .ok()
            .and_then(|d| sws_core::Project::load(&d).ok())
            .map(|p| p.languages)
            .unwrap_or_default();
        let sup = crate::notifications::NotificationSupervisor::start(
            s.alarms.clone(),
            cfg,
            sinks.map(|k| k.messages),
            lingue,
        );
        *s.notification_supervisor.write().await = Some(sup);
    }
}

/// DTO API di `PageLayoutConfig` (Q9): stessa forma, ma con
/// `deny_unknown_fields`. L'attributo non può stare su `PageLayoutConfig`
/// stessa, che è anche la struct di `project.yaml` — la tolleranza su disco
/// è voluta (forward-compat). Questo endpoint è il caso che ha originato Q9:
/// un PUT con `width`/`height` rispondeva 204 scartandoli in silenzio.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PageLayoutBody {
    size_mode: sws_core::project::PageSizeMode,
    #[serde(default)]
    aspect_ratio: Option<String>,
    #[serde(default)]
    home_page_id: Option<String>,
    #[serde(default)]
    hide_viewer_chrome: Option<bool>,
    #[serde(default)]
    boot_page_id: Option<String>,
    #[serde(default)]
    default_width: Option<f64>,
    #[serde(default)]
    default_height: Option<f64>,
    #[serde(default)]
    default_background: Option<String>,
    #[serde(default)]
    default_background_dark: Option<String>,
    #[serde(default)]
    page_tree: Option<Vec<sws_core::PageTreeNode>>,
}

impl From<PageLayoutBody> for PageLayoutConfig {
    fn from(b: PageLayoutBody) -> Self {
        PageLayoutConfig {
            size_mode: b.size_mode,
            aspect_ratio: b.aspect_ratio,
            home_page_id: b.home_page_id,
            hide_viewer_chrome: b.hide_viewer_chrome,
            boot_page_id: b.boot_page_id,
            default_width: b.default_width,
            default_height: b.default_height,
            default_background: b.default_background,
            default_background_dark: b.default_background_dark,
            page_tree: b.page_tree,
        }
    }
}

/// `PUT /api/project/page-layout` — save the project-wide page sizing mode
/// (Fixed/Ratio/Fluid) + home page. `null` body clears it (reverts to legacy
/// Fixed default).
async fn update_project_page_layout(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(config): Json<Option<PageLayoutBody>>,
) -> Response {
    let config: Option<PageLayoutConfig> = config.map(Into::into);
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let config_clone = config.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.page_layout = config_clone,
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        s.audit.log(
            "project.change",
            Some(user.username),
            serde_json::json!({"what": "page_layout"}),
        );
        // T-72 F5: abilitare (o togliere) la pagina di boot cambia cosa l'host
        // deve installare. Non passa da `signal_project_changed`: nessun viewer
        // deve ricaricare niente per questo.
        let config_dir = s.config_dir.clone();
        crate::boot_image::publish(&config_dir, &dir).await;
    }
    res
}

/// Il motore di rendering del progetto. `None` significa **togliere** il
/// campo, cioè tornare al default: un progetto senza `target` è web, come
/// tutti quelli creati prima che il campo esistesse (`wanted_engine`).
#[derive(serde::Deserialize, Clone)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct ProjectTargetBody {
    kind: sws_core::project::ProjectTargetKind,
    /// Significativo solo per `lvgl_framebuffer`; ignorato altrimenti.
    #[serde(default)]
    framebuffer_device: Option<String>,
}

impl From<ProjectTargetBody> for sws_core::project::ProjectTarget {
    fn from(b: ProjectTargetBody) -> Self {
        sws_core::project::ProjectTarget {
            kind: b.kind,
            framebuffer_device: b.framebuffer_device,
        }
    }
}

/// `PUT /api/project/target` — cambia il motore di rendering del progetto
/// attivo. Corpo `null` = torna al default (web), togliendo il campo.
///
/// **Non è un campo decorativo**: all'apertura e a ogni salvataggio il runtime
/// scrive `web` o `lvgl` nel file `display-target`, e sul pannello
/// `sws-display-apply.sh` commuta lo schermo fra browser e viewer LVGL. Quindi
/// convertire un progetto cambia che cosa si vede sul pannello al deploy
/// successivo.
///
/// **Il verso rischioso è uno solo.** LVGL → web non perde niente: il browser
/// disegna più tipi di quanti ne disegni il pannello. web → LVGL sì, e finché
/// non c'è il referto di compatibilità (T-59) la rotta non può dirlo — lo dice
/// l'editor, che avvisa prima di chiamarla.
async fn update_project_target(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(body): Json<Option<ProjectTargetBody>>,
) -> Response {
    let target: Option<sws_core::project::ProjectTarget> = body.map(Into::into);
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let kind = target.as_ref().map(|t| t.kind);
    let target_clone = target.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.target = target_clone,
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        s.audit.log(
            "project.change",
            Some(user.username),
            serde_json::json!({"what": "target", "kind": kind.map(|k| format!("{k:?}"))}),
        );
        // Il file che fa commutare lo schermo del pannello: si riscrive subito,
        // non al prossimo salvataggio, altrimenti la conversione resterebbe
        // senza effetto fino a una modifica qualsiasi.
        let config_dir = s.config_dir.clone();
        crate::display_target::publish(&config_dir, &dir).await;
    }
    res
}

#[derive(serde::Deserialize, Clone)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct BackupConfigBody {
    /// `None` = eredita il default di processo (`--auto-backup-interval-minutes`).
    interval_minutes: Option<u64>,
    /// `None` = eredita il default di processo (`--auto-backup-retention`).
    retention: Option<u64>,
}

/// `PUT /api/project/backup-config` — override per-progetto dell'intervallo/
/// retention di auto-backup, letto dal loop in `main.rs` a ogni tick (non
/// serve un riavvio). Campi `None` tornano a ereditare il default di processo.
async fn update_project_backup_config(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(body): Json<BackupConfigBody>,
) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let body_clone = body.clone();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| {
            p.auto_backup_interval_minutes = body_clone.interval_minutes;
            p.auto_backup_retention = body_clone.retention;
        },
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        s.audit.log(
            "project.change",
            Some(user.username),
            serde_json::json!({
                "what": "backup_config",
                "interval_minutes": body.interval_minutes,
                "retention": body.retention,
            }),
        );
    }
    res
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct DetectChatsRequest {
    #[serde(default)]
    bot_token: String,
}

#[derive(serde::Serialize)]
struct DetectedChat {
    id: String,
    label: String,
    #[serde(rename = "type")]
    kind: String,
}

/// `POST /api/notifications/telegram-chats` — elenca le chat che hanno scritto
/// al bot (`getUpdates`), risolvendo il token salvato quando la UI non lo ha in
/// chiaro. Prima questo giro lo faceva il browser: funzionava solo appena dopo
/// aver digitato il token, e non diceva nulla sulla capacità del runtime di
/// raggiungere Telegram.
/// `POST /api/notifications/telegram-bot` — chi è il bot di questo token.
///
/// Serve a **dire all'utente a chi deve scrivere**. «Rileva chat» legge i
/// messaggi arrivati al bot, ma se nessuno gli ha ancora scritto non trova
/// niente, e il messaggio che lo spiegava («manda /start al bot») non nominava
/// il bot: mancava il soggetto della frase. Il maintainer, che quel bot l'aveva
/// creato lui, non ha capito cosa doveva fare (23-09-2026).
///
/// Con lo username l'IDE può mostrare il nome e un link `t.me/<username>` che
/// apre la chat. In più un token sbagliato si scopre qui, invece che al primo
/// allarme che non parte.
async fn telegram_bot_identity(
    State(s): State<AppState>,
    Json(req): Json<DetectChatsRequest>,
) -> Response {
    let token = match risolvi_token_telegram(&s, req.bot_token).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let url = format!("https://api.telegram.org/bot{}/getMe", token.trim());
    let body: serde_json::Value = match reqwest::Client::new().get(&url).send().await {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(e) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "risposta non valida da Telegram: {}",
                        crate::telegram::redigi(e)
                    ),
                )
                    .into_response()
            }
        },
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!(
                    "impossibile raggiungere Telegram: {}",
                    crate::telegram::redigi(e)
                ),
            )
                .into_response()
        }
    };
    if body.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
        let desc = body
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("errore sconosciuto");
        return (StatusCode::BAD_GATEWAY, format!("Telegram: {desc}")).into_response();
    }
    let r = &body["result"];
    Json(serde_json::json!({
        "username": r["username"].as_str().unwrap_or(""),
        "nome": r["first_name"].as_str().unwrap_or(""),
    }))
    .into_response()
}

/// Il token da usare: quello che arriva, o quello salvato se la UI ha mandato
/// il segnaposto (o niente). Il browser non ha mai il token in chiaro, quindi
/// senza questo il pulsante funzionerebbe solo appena dopo averlo digitato.
async fn risolvi_token_telegram(s: &AppState, fornito: String) -> Result<String, Response> {
    let mut token = fornito;
    if token == MASKED_PASSWORD || token.trim().is_empty() {
        if let Ok(dir) = active_dir(s).await {
            if let Ok(existing) = Project::load(&dir) {
                if let Some(tok) = existing
                    .notifications
                    .and_then(|n| n.telegram)
                    .map(|t| t.bot_token)
                {
                    token = tok;
                }
            }
        }
    }
    if token.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "nessun bot token salvato né fornito",
        )
            .into_response());
    }
    Ok(token)
}

async fn detect_telegram_chats(
    State(s): State<AppState>,
    Json(req): Json<DetectChatsRequest>,
) -> Response {
    let token = match risolvi_token_telegram(&s, req.bot_token).await {
        Ok(t) => t,
        Err(r) => return r,
    };

    let client = reqwest::Client::new();
    // Il token sta nell'URL, e `reqwest::Error` l'URL se lo porta dietro nel
    // `Display`: senza `crate::telegram::redigi` un DNS che non risolve
    // rispedirebbe la credenziale al browser dentro il messaggio d'errore
    // (2f).
    let url = format!("https://api.telegram.org/bot{}/getUpdates", token.trim());
    let body: serde_json::Value = match client.get(&url).send().await {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(e) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "risposta non valida da Telegram: {}",
                        crate::telegram::redigi(e)
                    ),
                )
                    .into_response()
            }
        },
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!(
                    "impossibile raggiungere Telegram: {}",
                    crate::telegram::redigi(e)
                ),
            )
                .into_response()
        }
    };
    if body.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let desc = body
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("errore sconosciuto");
        return (StatusCode::BAD_GATEWAY, format!("Telegram: {desc}")).into_response();
    }

    // Un update può portare la chat in campi diversi a seconda del tipo di
    // evento; si guardano tutti quelli che nella pratica compaiono.
    let mut seen: std::collections::BTreeMap<String, DetectedChat> = Default::default();
    for upd in body
        .get("result")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[])
    {
        let chat = [
            "message",
            "edited_message",
            "channel_post",
            "edited_channel_post",
            "my_chat_member",
            "chat_member",
        ]
        .iter()
        .filter_map(|k| upd.get(*k))
        .filter_map(|c| c.get("chat"))
        .next();
        let Some(chat) = chat else { continue };
        let Some(id) = chat.get("id").and_then(|v| v.as_i64()) else {
            continue;
        };
        let id = id.to_string();
        let str_of = |k: &str| {
            chat.get(k)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let title = str_of("title");
        let label = if !title.is_empty() {
            title
        } else {
            let name = format!("{} {}", str_of("first_name"), str_of("last_name"))
                .trim()
                .to_string();
            if !name.is_empty() {
                name
            } else if !str_of("username").is_empty() {
                format!("@{}", str_of("username"))
            } else {
                id.clone()
            }
        };
        seen.entry(id.clone()).or_insert(DetectedChat {
            id,
            label,
            kind: str_of("type"),
        });
    }
    Json(seen.into_values().collect::<Vec<_>>()).into_response()
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
struct TestTelegramRequest {
    bot_token: String,
    #[serde(default)]
    chat_ids: Vec<String>,
    #[serde(default)]
    text: Option<String>,
}

/// `POST /api/notifications/test-telegram` — send a one-off test message with
/// the supplied Telegram config. Restores the real token when the UI sends the
/// masked placeholder. 204 on success; 502 + error text on failure so the UI
/// can show why (bad token, wrong chat id, no network…).
async fn test_telegram(
    State(s): State<AppState>,
    Json(req): Json<TestTelegramRequest>,
) -> Response {
    let mut token = req.bot_token;
    // Placeholder o campo vuoto: la UI non ha il token in chiaro (il server non
    // lo rimanda mai indietro), quindi si usa quello salvato. È ciò che rende
    // il test utilizzabile dopo un semplice cambio di tab, e soprattutto ciò
    // che fa provare la STESSA catena che manda gli allarmi.
    if token == MASKED_PASSWORD || token.trim().is_empty() {
        if let Ok(dir) = active_dir(&s).await {
            if let Ok(existing) = Project::load(&dir) {
                if let Some(tok) = existing
                    .notifications
                    .and_then(|n| n.telegram)
                    .map(|t| t.bot_token)
                {
                    token = tok;
                }
            }
        }
    }
    let text = req
        .text
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "✅ Messaggio di test da SWS.".to_string());
    let client = reqwest::Client::new();
    match crate::telegram::send_message(&client, &token, &req.chat_ids, &text).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, format!("{e:#}")).into_response(),
    }
}

#[cfg(test)]
mod bundle_tests {
    use super::*;

    /// Un progetto minimo su disco con dentro tutti i tipi di segreto che il
    /// modello prevede: password MQTT, bot token Telegram, password SMTP.
    fn project_with_secrets(dir: &std::path::Path) {
        std::fs::write(
            dir.join("project.yaml"),
            r#"
meta:
  name: segreti
  version: "1"
tags: []
sources:
  - kind: mqtt
    id: broker
    host: 127.0.0.1
    username: utente
    password: password-mqtt-vera
    topics: []
notifications:
  smtp:
    host: smtp.example.com
    from: sws@example.com
    username: utente
    password: password-smtp-vera
  telegram:
    bot_token: "1234567890:TOKEN-TELEGRAM-VERO"
    chat_ids: ["-100999"]
"#,
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("synoptics")).unwrap();
    }

    fn zip_entry(zip: &[u8], name: &str) -> String {
        let mut a = zip::ZipArchive::new(Cursor::new(zip.to_vec())).unwrap();
        let mut f = a
            .by_name(name)
            .unwrap_or_else(|_| panic!("{name} assente dal bundle"));
        let mut s = String::new();
        std::io::Read::read_to_string(&mut f, &mut s).unwrap();
        s
    }

    /// I segreti sono dati di progetto e devono viaggiare: un backup che li
    /// perde non ripristina, e un deploy che li perde consegna al dispositivo un
    /// progetto che non riesce a collegarsi. Decisione del maintainer, 2026-07-29
    /// — confermata per il deploy dal Passo 2 (2d, 22-09-2026), che sposta
    /// **dove** viaggiano: da dentro `project.yaml` a un `secrets.yaml` a parte.
    ///
    /// Prima la password MQTT veniva azzerata in `build_project_zip`, che è la
    /// funzione usata **anche dal deploy remoto** (`remote.rs`): il dispositivo
    /// riceveva quindi un broker senza credenziali, mentre nello stesso bundle
    /// viaggiavano in chiaro token Telegram e password SMTP — e il manifest
    /// dichiarava `secrets_masked: true`.
    #[tokio::test]
    async fn il_bundle_porta_tutti_i_segreti() {
        let tmp = tempfile::tempdir().unwrap();
        project_with_secrets(tmp.path());

        let zip = build_project_zip(tmp.path(), true)
            .await
            .expect("build zip");

        // project.yaml non li ha mai (2a): sono in secrets.yaml, un file a parte.
        let project_yaml = zip_entry(&zip, "project.yaml");
        for segreto in [
            "password-mqtt-vera",
            "TOKEN-TELEGRAM-VERO",
            "password-smtp-vera",
        ] {
            assert!(
                !project_yaml.contains(segreto),
                "«{segreto}» è ancora in project.yaml, non in secrets.yaml:\n{project_yaml}"
            );
        }

        let yaml = zip_entry(&zip, "secrets.yaml");
        assert!(
            yaml.contains("password-mqtt-vera"),
            "password MQTT persa:\n{yaml}"
        );
        assert!(
            yaml.contains("TOKEN-TELEGRAM-VERO"),
            "bot token Telegram perso:\n{yaml}"
        );
        assert!(
            yaml.contains("password-smtp-vera"),
            "password SMTP persa:\n{yaml}"
        );
        // Nessun segreto sostituito dal sentinella della UI.
        assert!(
            !yaml.contains(MASKED_PASSWORD),
            "un segreto è stato mascherato:\n{yaml}"
        );

        // Il manifest deve dirlo, così chi riceve il bundle sa cosa ha in mano.
        let manifest = zip_entry(&zip, "manifest.json");
        let m: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(
            m["secrets_masked"],
            serde_json::json!(false),
            "manifest: {manifest}"
        );
    }

    /// L'export normale (senza `?segreti=1`) non porta `secrets.yaml`, e
    /// `project.yaml` non porta comunque i segreti (mai, in nessun caso):
    /// chi apre un export condiviso non trova credenziali dentro.
    #[tokio::test]
    async fn l_export_senza_flag_non_porta_secrets_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        project_with_secrets(tmp.path());
        let mut project = Project::load(tmp.path()).unwrap();
        let segreti = sws_core::segreti::estrai(&mut project);

        let manifest = BundleManifest {
            format_version: BUNDLE_FORMAT_VERSION.into(),
            name: "p".into(),
            exported_at_ms: 0,
            secrets_masked: true,
        };
        let zip = build_export_zip(&manifest, &project, &[], None, &[], &[], &[], &[], None)
            .expect("build zip senza segreti");

        let mut a = zip::ZipArchive::new(Cursor::new(zip.clone())).unwrap();
        assert!(
            a.by_name("secrets.yaml").is_err(),
            "secrets.yaml non deve esserci"
        );
        let project_yaml = zip_entry(&zip, "project.yaml");
        assert!(
            !project_yaml.contains("password-mqtt-vera"),
            "{project_yaml}"
        );

        // E con la casella accesa, secrets.yaml compare.
        let manifest2 = BundleManifest {
            secrets_masked: false,
            ..manifest
        };
        let zip2 = build_export_zip(
            &manifest2,
            &project,
            &[],
            None,
            &[],
            &[],
            &[],
            &[],
            Some(&segreti),
        )
        .expect("build zip con segreti");
        assert!(zip_entry(&zip2, "secrets.yaml").contains("password-mqtt-vera"));
    }
}

#[cfg(test)]
mod write_safety_tests {
    use super::{merge_preserved, PageLayoutBody};

    /// Le chiavi che la struttura produceva prima della modifica: ciò che
    /// distingue "cancellata apposta" da "non la conosco".
    fn prima_conteneva(chiavi: &[&str]) -> std::collections::HashSet<serde_yaml::Value> {
        chiavi.iter().map(|k| serde_yaml::Value::from(*k)).collect()
    }

    /// Nessuna cancellazione in gioco: tutto ciò che manca è sconosciuto.
    fn niente_da_cancellare() -> std::collections::HashSet<serde_yaml::Value> {
        std::collections::HashSet::new()
    }

    /// Il YAML che la struttura tipizzata produrrebbe: contiene solo ciò che sa
    /// rappresentare.
    const TYPED: &str = "meta:\n  name: impianto\n  version: '1'\nsources:\n- kind: mqtt\n  name: broker\n  url: mqtt://localhost:1883\ntags: []\n";

    #[test]
    fn conserva_una_sorgente_che_non_si_parsa() {
        // Il caso di Q10: sul disco c'è una sorgente di un protocollo che questa
        // versione non conosce. Veniva scartata in lettura (di proposito) e poi
        // cancellata dalla riscrittura — cioè persa per sempre al primo
        // salvataggio di una qualunque altra sezione.
        let raw = "meta:\n  name: impianto\n  version: '1'\nsources:\n- kind: mqtt\n  name: broker\n  url: mqtt://localhost:1883\n- kind: protocollo_futuro\n  name: misterioso\n  parametro: 42\n";
        let out = merge_preserved(TYPED, raw, &niente_da_cancellare());
        assert!(
            out.contains("protocollo_futuro"),
            "sorgente sconosciuta persa:\n{out}"
        );
        assert!(
            out.contains("misterioso"),
            "nome della sorgente sconosciuta perso:\n{out}"
        );
        assert!(out.contains("broker"), "sorgente conosciuta persa:\n{out}");
    }

    #[test]
    fn una_lista_sostituita_dall_utente_conserva_comunque_le_non_parsabili() {
        // L'utente riscrive le sorgenti dalla tab Protocolli: la sua lista vince,
        // ma la voce che la UI non ha mai visto non può essere stata "rimossa da
        // lui", quindi resta.
        let typed_svuotato = "meta:\n  name: impianto\n  version: '1'\nsources: []\ntags: []\n";
        let raw = "meta:\n  name: impianto\n  version: '1'\nsources:\n- kind: protocollo_futuro\n  name: misterioso\n";
        let out = merge_preserved(typed_svuotato, raw, &niente_da_cancellare());
        assert!(
            out.contains("protocollo_futuro"),
            "conservazione mancata su lista svuotata:\n{out}"
        );
    }

    /// Il rovescio della conservazione: una chiave che la struttura **conosce**
    /// e che è stata deliberatamente azzerata deve sparire.
    ///
    /// Il difetto era questo: azzerare un campo opzionale lo fa sparire dalla
    /// serializzazione (`skip_serializing_if`), quindi la conservazione lo
    /// scambiava per "chiave che non conosco" e **rimetteva il valore
    /// vecchio**. Effetto: nessun campo opzionale di primo livello poteva
    /// essere cancellato — `PUT /api/project/page-layout` con corpo `null`
    /// rispondeva 204 e non cancellava niente. Misurato sul WP630 il
    /// 2026-08-27.
    #[test]
    fn una_chiave_conosciuta_e_azzerata_viene_davvero_cancellata() {
        let raw = "meta:\n  name: impianto\n  version: '1'\nsources: []\npage_layout:\n  size_mode: fixed\n  home_page_id: p1\n";
        let out = merge_preserved(TYPED, raw, &prima_conteneva(&["page_layout"]));
        assert!(
            !out.contains("page_layout"),
            "page_layout azzerato ma rimesso dalla conservazione:\n{out}"
        );
        assert!(
            !out.contains("home_page_id"),
            "il valore vecchio è tornato:\n{out}"
        );
    }

    /// La conservazione deve restare selettiva: le chiavi davvero sconosciute
    /// si tengono anche mentre quelle conosciute si possono cancellare.
    #[test]
    fn cancellare_una_conosciuta_non_butta_via_le_sconosciute() {
        let raw = "meta:\n  name: impianto\n  version: '1'\nsources: []\npage_layout:\n  size_mode: fixed\nimpostazioni_future:\n  qualcosa: vero\n";
        let out = merge_preserved(TYPED, raw, &prima_conteneva(&["page_layout"]));
        assert!(
            !out.contains("page_layout"),
            "la conosciuta doveva sparire:\n{out}"
        );
        assert!(
            out.contains("impostazioni_future"),
            "la sconosciuta doveva restare:\n{out}"
        );
    }

    #[test]
    fn conserva_le_chiavi_di_primo_livello_sconosciute() {
        let raw = "meta:\n  name: impianto\n  version: '1'\nsources: []\nimpostazioni_future:\n  qualcosa: vero\n";
        let out = merge_preserved(TYPED, raw, &niente_da_cancellare());
        assert!(
            out.contains("impostazioni_future"),
            "chiave sconosciuta persa:\n{out}"
        );
        assert!(
            out.contains("qualcosa"),
            "contenuto della chiave sconosciuta perso:\n{out}"
        );
    }

    #[test]
    fn page_layout_porta_il_formato_predefinito_e_la_pagina_di_boot() {
        // T-72: il DTO dell'API deve accettare i campi nuovi, o l'editor che li
        // manda prenderebbe un 400 su ogni salvataggio delle Impostazioni pagine.
        let b = serde_json::from_str::<PageLayoutBody>(
            r##"{"size_mode":"fixed","boot_page_id":"b1","default_width":1024,"default_height":600,
                "default_background":"#112233","default_background_dark":"#000000"}"##,
        )
        .expect("i campi del formato predefinito vanno accettati");
        let c: sws_core::project::PageLayoutConfig = b.into();
        assert_eq!(c.default_width, Some(1024.0));
        assert_eq!(c.boot_page_id.as_deref(), Some("b1"));
        // E su disco: assenti quando non impostati, così i project.yaml esistenti non cambiano.
        let solo = sws_core::project::PageLayoutConfig {
            size_mode: sws_core::project::PageSizeMode::Fixed,
            aspect_ratio: None,
            home_page_id: None,
            hide_viewer_chrome: None,
            boot_page_id: None,
            default_width: None,
            default_height: None,
            default_background: None,
            default_background_dark: None,
            page_tree: None,
        };
        let y = serde_yaml::to_string(&solo).unwrap();
        assert!(
            !y.contains("default_") && !y.contains("page_tree"),
            "campi vuoti scritti su disco:\n{y}"
        );
    }

    #[test]
    fn page_layout_accetta_l_albero_delle_pagine_e_lo_scrive_annidato() {
        let b: PageLayoutBody = serde_json::from_str(
            r#"{"size_mode":"fixed","page_tree":[{"id":"home","children":[{"id":"a"},{"id":"b"}]},{"id":"z"}]}"#,
        )
        .expect("page_tree va accettato");
        let c: sws_core::project::PageLayoutConfig = b.into();
        let albero = c.page_tree.clone().expect("albero perso");
        assert_eq!(
            sws_core::page_tree::appiattisci(&albero),
            vec!["home", "a", "b", "z"]
        );
        // Sul disco i figli vuoti non compaiono e il giro tiene la forma.
        let y = serde_yaml::to_string(&c).unwrap();
        assert!(y.contains("page_tree"), "albero non scritto:\n{y}");
        let indietro: sws_core::project::PageLayoutConfig = serde_yaml::from_str(&y).unwrap();
        assert_eq!(indietro.page_tree, c.page_tree);
    }

    #[test]
    fn page_layout_rifiuta_i_campi_sconosciuti() {
        // Il caso che ha originato Q9: PUT /api/project/page-layout con
        // width/height rispondeva 204 scartandoli in silenzio. Col DTO
        // deny_unknown_fields la stessa chiamata deve fallire il parse.
        let ok =
            serde_json::from_str::<PageLayoutBody>(r#"{"size_mode":"fixed","home_page_id":"p1"}"#);
        assert!(ok.is_ok(), "payload valido rifiutato: {:?}", ok.err());
        let bad = serde_json::from_str::<PageLayoutBody>(
            r#"{"size_mode":"fixed","width":1920,"height":1080}"#,
        );
        assert!(bad.is_err(), "campi sconosciuti accettati in silenzio");
    }

    #[test]
    fn non_duplica_le_sorgenti_conosciute() {
        // Il file grezzo e quello tipizzato contengono la stessa sorgente: deve
        // comparire una volta sola, altrimenti ogni salvataggio raddoppierebbe.
        let raw = "meta:\n  name: impianto\n  version: '1'\nsources:\n- kind: mqtt\n  name: broker\n  url: mqtt://localhost:1883\ntags: []\n";
        let out = merge_preserved(TYPED, raw, &niente_da_cancellare());
        assert_eq!(
            out.matches("name: broker").count(),
            1,
            "sorgente duplicata:\n{out}"
        );
    }

    #[test]
    fn il_valore_tipizzato_vince_sulle_chiavi_conosciute() {
        // Se il file grezzo e la patch discordano su una chiave conosciuta, deve
        // vincere la patch: è la modifica che l'utente ha appena chiesto.
        let raw = "meta:\n  name: nome_vecchio\n  version: '1'\nsources: []\n";
        let out = merge_preserved(TYPED, raw, &niente_da_cancellare());
        assert!(out.contains("impianto"), "la patch non ha vinto:\n{out}");
        assert!(
            !out.contains("nome_vecchio"),
            "il valore vecchio è sopravvissuto:\n{out}"
        );
    }

    #[test]
    fn un_file_grezzo_illeggibile_non_fa_fallire_il_salvataggio() {
        // merge_preserved può solo aggiungere: se il grezzo non si parsa,
        // restituisce il tipizzato invariato invece di rompere la scrittura.
        assert_eq!(
            merge_preserved(
                TYPED,
                "questo: [non è: yaml valido",
                &niente_da_cancellare()
            ),
            TYPED
        );
    }
}

/// Q30: le scritture su `project.yaml` non si perdono a vicenda, e non lasciano
/// il file a metà.
///
/// L'ordine dei lock non è verificabile a runtime senza provocare deadlock veri:
/// sta documentato in `AppState::project_write_lock`, e la regola è una sola —
/// `project_write_lock` è **sempre il più interno**.
#[cfg(test)]
mod q30_tests {
    use super::*;

    /// Un progetto minimo, come lo trova `patch_project` al primo salvataggio.
    fn progetto_minimo(dir: &std::path::Path) {
        std::fs::write(
            dir.join("project.yaml"),
            "meta:\n  name: prova\n  version: \"1\"\ntags: []\n",
        )
        .unwrap();
    }

    /// I `TagDef` si costruiscono per deserializzazione e non a mano: la struct
    /// ha una decina di campi con `serde(default)`, e passare da YAML usa
    /// esattamente i default del file vero invece di una copia da tenere in
    /// pari.
    fn tag(id: &str) -> sws_core::project::TagDef {
        serde_yaml::from_str(&format!("id: {id}\n")).unwrap()
    }

    fn tags_su_disco(dir: &std::path::Path) -> Vec<String> {
        let testo = std::fs::read_to_string(dir.join("project.yaml")).unwrap();
        let p: Project = serde_yaml::from_str(&testo).unwrap();
        p.tags.into_iter().map(|t| t.id).collect()
    }

    /// **Il test che conta.** Cinquanta salvataggi in volo insieme, ognuno che
    /// aggiunge un tag diverso: alla fine devono esserci tutti e cinquanta.
    ///
    /// Non è un test di velocità: la finestra fra la lettura e la scrittura di
    /// `patch_project` è un punto di `await`, quindi i task si interlacciano
    /// anche su un runtime a thread singolo e senza il lock le perdite sono
    /// sistematiche, non occasionali.
    ///
    /// **Provato rotto a mano**: togliendo il `lock.lock().await` da
    /// `patch_project`, di 50 tag ne sopravvivono una manciata. Un test
    /// concorrente che passa anche senza la cura non prova niente, ed è l'unico
    /// modo di sapere che questo la prova.
    #[tokio::test]
    async fn cinquanta_salvataggi_concorrenti_non_si_perdono() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());

        let lock = Arc::new(tokio::sync::Mutex::new(()));
        let mut task = Vec::new();
        for i in 0..50 {
            let lock = lock.clone();
            let percorso = dir.path().to_path_buf();
            task.push(tokio::spawn(async move {
                let t = tag(&format!("t{i:02}"));
                patch_project(&lock, &percorso, move |p| p.tags.push(t)).await
            }));
        }
        for t in task {
            let resp = t.await.unwrap();
            assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        }

        let mut trovati = tags_su_disco(dir.path());
        trovati.sort();
        assert_eq!(
            trovati.len(),
            50,
            "salvataggi perduti: sul disco ce ne sono {} invece di 50 — {:?}",
            trovati.len(),
            trovati
        );
    }

    /// La scrittura non lascia il temporaneo in giro, e il file resta leggibile.
    ///
    /// Il `.tmp` non è innocuo: `backups::BACKED_UP` copia per nome e non lo
    /// prenderebbe, ma un file di lavoro dimenticato nella cartella del
    /// progetto è comunque una cosa che qualcuno prima o poi apre.
    #[tokio::test]
    async fn la_scrittura_non_lascia_temporanei() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());
        let lock = tokio::sync::Mutex::new(());

        let resp = patch_project(&lock, dir.path(), |p| p.tags.push(tag("uno"))).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        let residui: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(residui.is_empty(), "temporanei rimasti: {residui:?}");
        assert_eq!(tags_su_disco(dir.path()), vec!["uno".to_string()]);
    }

    /// Il file su disco è sempre uno YAML intero: mai il vecchio troncato, mai
    /// il nuovo a metà. Con `fs::write` diretto questa proprietà non c'era, e il
    /// modo in cui non c'era era cattivo — `patch_project` rifiuta ogni
    /// salvataggio successivo su un `project.yaml` non caricabile, quindi una
    /// scrittura interrotta rendeva il progetto riapribile solo da un backup.
    #[tokio::test]
    async fn la_scrittura_sostituisce_e_non_tronca() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.yaml");
        std::fs::write(
            &path,
            "meta:\n  name: vecchio\n  version: \"1\"\ntags: []\n",
        )
        .unwrap();

        // Il contenuto nuovo è più corto del vecchio: con una scrittura in
        // luogo senza troncamento resterebbe della coda del precedente.
        scrivi_atomico(&path, b"meta:\n  name: n\n  version: \"1\"\n")
            .await
            .unwrap();

        let testo = std::fs::read_to_string(&path).unwrap();
        assert!(
            !testo.contains("vecchio"),
            "coda del file precedente:\n{testo}"
        );
        let doc: serde_yaml::Value = serde_yaml::from_str(&testo).unwrap();
        assert_eq!(doc["meta"]["name"].as_str(), Some("n"));
    }

    // ── Passo 2, sotto-passo 2b: patch_project_se non riscrive segreti ──────

    /// Un handler di sezione (qui: `f` imita `update_project_notifications`)
    /// scrive un `bot_token` nel `Project` tipizzato: `project.yaml` sul
    /// disco non deve contenerlo, e `secrets.yaml` sì, con permessi 0600.
    #[tokio::test]
    async fn un_segreto_scritto_da_una_sezione_finisce_in_secrets_yaml_non_in_project_yaml() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());
        let lock = tokio::sync::Mutex::new(());

        let resp = patch_project(&lock, dir.path(), |p| {
            p.notifications = Some(sws_core::project::NotificationConfig {
                telegram: Some(sws_core::project::TelegramConfig {
                    bot_token: "123:segretissimo".into(),
                    chat_ids: vec![],
                }),
                ..Default::default()
            });
        })
        .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        let project_yaml = std::fs::read_to_string(dir.path().join("project.yaml")).unwrap();
        assert!(
            !project_yaml.contains("123:segretissimo"),
            "il token è ancora in project.yaml:\n{project_yaml}"
        );

        let secrets_path = dir.path().join("secrets.yaml");
        let secrets_yaml = std::fs::read_to_string(&secrets_path).unwrap();
        assert!(secrets_yaml.contains("123:segretissimo"), "{secrets_yaml}");
        use std::os::unix::fs::PermissionsExt;
        let perm = std::fs::metadata(&secrets_path).unwrap().permissions();
        assert_eq!(perm.mode() & 0o777, 0o600);

        // E Project::load lo rimette in chiaro per chi legge il progetto.
        let ricaricato = Project::load(dir.path()).unwrap();
        assert_eq!(
            ricaricato
                .notifications
                .unwrap()
                .telegram
                .unwrap()
                .bot_token,
            "123:segretissimo"
        );
    }

    /// Una sezione che NON tocca segreti non produce un `secrets.yaml` vuoto.
    #[tokio::test]
    async fn una_sezione_senza_segreti_non_crea_secrets_yaml() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());
        let lock = tokio::sync::Mutex::new(());

        let resp = patch_project(&lock, dir.path(), |p| p.tags.push(tag("uno"))).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert!(!dir.path().join("secrets.yaml").exists());
    }
}

/// Q30, la seconda metà: due schede che salvano la **stessa** sezione.
#[cfg(test)]
mod q30_versione_tests {
    use super::*;

    fn progetto_minimo(dir: &std::path::Path) {
        std::fs::write(
            dir.join("project.yaml"),
            "meta:\n  name: prova\n  version: \"1\"\ntags: []\n",
        )
        .unwrap();
    }

    fn tag(id: &str) -> sws_core::project::TagDef {
        serde_yaml::from_str(&format!("id: {id}\n")).unwrap()
    }

    fn versione_su_disco(dir: &std::path::Path) -> String {
        versione_di(&std::fs::read_to_string(dir.join("project.yaml")).unwrap())
    }

    fn etag(r: &Response) -> Option<String> {
        r.headers()
            .get(axum::http::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.trim_matches('"').to_string())
    }

    /// Senza `If-Match` niente cambia: uno script o un `curl` che non conoscono
    /// il meccanismo continuano a salvare come prima.
    #[tokio::test]
    async fn senza_if_match_si_salva_come_prima() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());
        let lock = tokio::sync::Mutex::new(());
        let r = patch_project_se(&lock, dir.path(), None, |p| p.tags.push(tag("a"))).await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
    }

    /// Con la versione giusta si salva, e la risposta porta quella **nuova**:
    /// senza, la scheda che ha appena salvato prenderebbe un 409 contro se
    /// stessa al salvataggio successivo.
    #[tokio::test]
    async fn con_la_versione_giusta_si_salva_e_torna_la_nuova() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());
        let lock = tokio::sync::Mutex::new(());

        let v0 = versione_su_disco(dir.path());
        let r = patch_project_se(&lock, dir.path(), Some(v0.clone()), |p| {
            p.tags.push(tag("a"))
        })
        .await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        let v1 = etag(&r).expect("la risposta deve portare la versione nuova");
        assert_ne!(v1, v0, "la versione deve cambiare dopo una scrittura");
        assert_eq!(v1, versione_su_disco(dir.path()), "e combaciare col disco");

        // Con la versione tornata si salva di nuovo, senza rileggere.
        let r2 = patch_project_se(&lock, dir.path(), Some(v1), |p| p.tags.push(tag("b"))).await;
        assert_eq!(r2.status(), StatusCode::NO_CONTENT);
    }

    /// **Il test di Q30, seconda metà.** Due schede partono dalla stessa
    /// versione; la prima salva, la seconda viene rifiutata — e soprattutto il
    /// lavoro della prima è ancora sul disco.
    #[tokio::test]
    async fn la_seconda_scheda_viene_rifiutata_e_non_cancella_la_prima() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());
        let lock = tokio::sync::Mutex::new(());

        let vista_da_entrambe = versione_su_disco(dir.path());

        let prima = patch_project_se(&lock, dir.path(), Some(vista_da_entrambe.clone()), |p| {
            p.tags = vec![tag("della_prima")]
        })
        .await;
        assert_eq!(prima.status(), StatusCode::NO_CONTENT);

        let seconda = patch_project_se(&lock, dir.path(), Some(vista_da_entrambe), |p| {
            p.tags = vec![tag("della_seconda")]
        })
        .await;
        assert_eq!(
            seconda.status(),
            StatusCode::CONFLICT,
            "la seconda scheda partiva da dati vecchi e va rifiutata"
        );

        let testo = std::fs::read_to_string(dir.path().join("project.yaml")).unwrap();
        assert!(
            testo.contains("della_prima"),
            "il lavoro della prima scheda deve essere ancora là:\n{testo}"
        );
        assert!(
            !testo.contains("della_seconda"),
            "e quello rifiutato non deve essere finito sul disco:\n{testo}"
        );
    }

    /// Il 409 deve **spiegarsi**: senza il rimedio, chi lo riceve non sa cosa
    /// fare e prova a risalvare.
    #[tokio::test]
    async fn il_rifiuto_dice_cosa_fare() {
        let dir = tempfile::tempdir().unwrap();
        progetto_minimo(dir.path());
        let lock = tokio::sync::Mutex::new(());
        let r = patch_project_se(&lock, dir.path(), Some("non-combacia".into()), |p| {
            p.tags.push(tag("x"))
        })
        .await;
        assert_eq!(r.status(), StatusCode::CONFLICT);
        let corpo = axum::body::to_bytes(r.into_body(), 8192).await.unwrap();
        let testo = String::from_utf8_lossy(&corpo);
        assert!(testo.contains("Ricarica"), "manca il rimedio: {testo}");
    }
}

/// Q30 per i file di progetto: sinottici, faceplate, ricette. Un file per
/// entità, quindi la corsa è fra due che salvano **lo stesso**.
#[cfg(test)]
mod q30_file_tests {
    use super::*;

    #[test]
    fn senza_if_match_si_scrive() {
        assert!(conflitto_di_versione(None, Some("qualsiasi cosa"), "X").is_none());
    }

    /// **Il caso che conta.** La versione attesa non combacia con il disco:
    /// niente scrittura, e un 409 che si spiega.
    #[tokio::test]
    async fn versione_vecchia_rifiutata_con_rimedio() {
        let r = conflitto_di_versione(Some("vecchia"), Some("contenuto nuovo"), "Questa pagina")
            .expect("doveva rifiutare");
        assert_eq!(r.status(), StatusCode::CONFLICT);
        assert_eq!(
            r.headers()
                .get("x-sws-conflitto")
                .and_then(|v| v.to_str().ok()),
            Some("versione"),
            "il client riconosce questo 409 dall'header, non dal testo tradotto"
        );
        let corpo = axum::body::to_bytes(r.into_body(), 8192).await.unwrap();
        let testo = String::from_utf8_lossy(&corpo);
        assert!(
            testo.contains("Questa pagina"),
            "deve dire COSA è cambiato: {testo}"
        );
        assert!(testo.contains("Ricarica"), "e cosa fare: {testo}");
    }

    #[test]
    fn versione_giusta_passa() {
        let disco = "contenuto";
        let v = versione_di(disco);
        assert!(conflitto_di_versione(Some(&v), Some(disco), "X").is_none());
    }

    /// **Creare non è sovrascrivere.** Un file che ancora non esiste non ha
    /// versione: se il client manda un `If-Match` (perché aveva in mano una
    /// pagina poi cancellata da un altro) il rifiuto è giusto — quella pagina
    /// non c'è più, e riscriverla senza saperlo la resusciterebbe.
    #[test]
    fn su_un_file_assente_una_versione_attesa_e_un_conflitto() {
        assert!(conflitto_di_versione(Some("qualcosa"), None, "X").is_some());
        // ...ma senza pretese si crea liberamente.
        assert!(conflitto_di_versione(None, None, "X").is_none());
    }

    /// La versione è dei **byte**: due contenuti diversi non possono
    /// combaciare, e lo stesso contenuto dà sempre lo stesso valore.
    #[test]
    fn la_versione_e_deterministica_e_distingue() {
        assert_eq!(versione_di("a"), versione_di("a"));
        assert_ne!(versione_di("a"), versione_di("b"));
        assert_eq!(versione_di("a").len(), 16, "otto byte in esadecimale");
    }

    /// Difesa in profondità sui simboli SVG: il browser sanifica, il server
    /// rifiuta. Revisione del 2026-09-09.
    #[test]
    fn un_simbolo_con_codice_dentro_viene_rifiutato() {
        use super::svg_ostile;
        assert!(svg_ostile("<svg><script>alert(1)</script></svg>").is_some());
        assert!(svg_ostile("<svg><SCRIPT src=x></svg>").is_some());
        assert!(svg_ostile("<svg><rect onload=\"alert(1)\"/></svg>").is_some());
        assert!(svg_ostile("<svg><rect onload=alert(1) /></svg>").is_some());
        assert!(svg_ostile("<svg><a href=\"java\nscript:alert(1)\"/></svg>").is_some());
        assert!(svg_ostile("<svg><foreignObject><body/></foreignObject></svg>").is_some());
        assert!(svg_ostile("<svg><iframe src=x/></svg>").is_some());
    }

    #[test]
    fn un_simbolo_normale_passa() {
        use super::svg_ostile;
        let ok = r##"<svg viewBox="0 0 100 100"><g id="body"><rect x="1" y="2" width="10" height="20" fill="#f00"/><path d="M0 0L10 10" stroke="#000"/><text>on</text></g></svg>"##;
        assert_eq!(svg_ostile(ok), None);
        // `stop-color`, `stroke-linejoin`: contengono "on" senza essere handler.
        assert_eq!(
            svg_ostile(
                r##"<svg><stop offset="0" stop-color="#fff"/><path stroke-linejoin="round"/></svg>"##
            ),
            None
        );
    }
}

/// Chi decide se una richiesta è autenticata, e chi può essere il primo utente.
///
/// Il guasto da cui nascono questi test, 14-09-2026: nell'IDE, definire il primo
/// utente del progetto (`user`, Operator) dalla scheda Utenti rispondeva
/// «Sessione scaduta» e lasciava il progetto **inaccessibile**. Nessun pezzo era
/// rotto da solo — l'autenticazione si accende a `users.yaml` scritto, il token
/// che l'editor porta in no-auth non è mai stato emesso dal server, e un
/// Operator non può configurare niente. Rotto era il punto in cui i pezzi si
/// incontrano.
#[cfg(test)]
mod primo_utente_tests {
    use super::*;

    #[test]
    fn un_ide_non_si_autentica_mai() {
        // Il caso del guasto: utenti definiti **e** istanza IDE. Prima del
        // 14-09-2026 qui si tornava `false` e l'editor si chiudeva fuori da
        // solo un istante dopo aver scritto `users.yaml`.
        assert!(senza_autenticazione(true, true));
        assert!(senza_autenticazione(true, false));
    }

    #[test]
    fn un_dispositivo_con_utenti_chiede_il_login() {
        assert!(!senza_autenticazione(false, true));
    }

    #[test]
    fn un_dispositivo_senza_utenti_resta_aperto() {
        // Invariato: un pannello appena installato non può chiedere un login
        // che non esiste ancora.
        assert!(senza_autenticazione(false, false));
    }

    #[test]
    fn sul_dispositivo_il_primo_utente_deve_essere_admin() {
        assert!(primo_utente_non_amministratore(
            false,
            false,
            Role::Operator
        ));
        assert!(primo_utente_non_amministratore(false, false, Role::Viewer));
        assert!(primo_utente_non_amministratore(
            false,
            false,
            Role::Supervisor
        ));
        assert!(!primo_utente_non_amministratore(false, false, Role::Admin));
    }

    #[test]
    fn con_un_admin_gia_presente_i_ruoli_sono_liberi() {
        // La guardia protegge solo il *primo* account: dopo, chi amministra
        // c'è già e può creare quello che vuole.
        assert!(!primo_utente_non_amministratore(
            false,
            true,
            Role::Operator
        ));
    }

    #[test]
    fn sull_ide_la_guardia_non_scatta() {
        // Sull'IDE quegli utenti governano il dispositivo, non l'editor:
        // obbligare a creare prima un Admin sarebbe una regola senza scopo, e
        // l'ordine in cui il maintainer compila la scheda Utenti è affar suo.
        assert!(!primo_utente_non_amministratore(
            true,
            false,
            Role::Operator
        ));
    }
}

#[cfg(test)]
mod csv_tag_tests {
    use super::*;

    fn m(campi: &[(&str, &str)]) -> Modifiche {
        Modifiche {
            campi: campi
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    /// L'esportazione mette fra virgolette i campi con una virgola dentro; la
    /// lettura le ignorava, e la descrizione tornava indietro spezzata in due
    /// colonne — spostando di uno tutte quelle dopo.
    #[test]
    fn le_virgolette_tengono_insieme_virgole_e_a_capo() {
        let r =
            righe_csv("id,description,unit\nt1,\"pompa 1, mandata\",bar\nt2,\"riga\nsotto\",°C\n");
        assert_eq!(r.len(), 3);
        assert_eq!(r[1], ["t1", "pompa 1, mandata", "bar"]);
        assert_eq!(r[2], ["t2", "riga\nsotto", "°C"]);
    }

    #[test]
    fn le_virgolette_doppie_dentro_un_campo_tornano_singole() {
        let r = righe_csv("id,description\nt1,\"il \"\"grande\"\" motore\"");
        assert_eq!(r[1][1], "il \"grande\" motore");
    }

    /// Le dimensioni si scrivono con la «x» per non costringere alle
    /// virgolette ogni riga di un array.
    #[test]
    fn le_dimensioni_si_leggono_con_la_x() {
        assert_eq!(dimensioni_csv("4"), Some(vec![4]));
        assert_eq!(dimensioni_csv(" 2x3 "), Some(vec![2, 3]));
        assert_eq!(dimensioni_csv(""), None);
        assert_eq!(dimensioni_csv("  "), None);
        assert_eq!(dimensioni_csv("pippo"), None);
    }

    /// Il cuore della correzione del 22-09-2026: una colonna che il file non
    /// ha non azzera niente. Prima la riga sostituiva il tag intero, quindi
    /// reimportare un `tags.csv` esportato buttava via scala, limiti e — dalla
    /// Fase 2 — `type_ref`, trasformando una struttura in uno scalare mentre
    /// le pagine restavano legate alle sue foglie.
    #[test]
    fn una_colonna_assente_lascia_il_campo_comera() {
        let mut t = TagDef::nuovo("motore1", "bool");
        t.type_ref = Some("Motore".into());
        t.unit = Some("rpm".into());
        t.eng_max = Some(100.0);

        m(&[("description", "Motore principale")]).applica(&mut t);

        assert_eq!(t.description, "Motore principale");
        assert_eq!(t.type_ref.as_deref(), Some("Motore"));
        assert_eq!(t.unit.as_deref(), Some("rpm"));
        assert_eq!(t.eng_max, Some(100.0));
        assert_eq!(t.data_type, "bool");
    }

    /// Una cella vuota su una colonna **presente** svuota: è l'unico modo, da
    /// un foglio di calcolo, di dire «questa espressione toglila».
    #[test]
    fn una_cella_vuota_su_una_colonna_presente_svuota() {
        let mut t = TagDef::nuovo("t1", "float");
        t.expression = Some("{a}+1".into());
        t.unit = Some("bar".into());
        t.eng_max = Some(10.0);
        m(&[("expression", ""), ("unit", ""), ("eng_max", "")]).applica(&mut t);
        assert_eq!(t.expression, None);
        assert_eq!(t.unit, None);
        assert_eq!(t.eng_max, None);
    }

    /// Scala e limiti passano dal CSV: sono i campi che l'esportazione non
    /// aveva mai portato, e che l'import azzerava.
    #[test]
    fn scala_limiti_e_decimali_arrivano_dal_file() {
        let mut t = TagDef::nuovo("t1", "f32");
        m(&[
            ("raw_min", "0"),
            ("raw_max", "27648"),
            ("eng_min", "-50"),
            ("eng_max", "150.5"),
            ("limit_hi_hi", "140"),
            ("decimals", "2"),
            ("history_min_interval_ms", "5000"),
            ("write_min_role", "Operator"),
        ])
        .applica(&mut t);
        assert_eq!(t.raw_max, Some(27648.0));
        assert_eq!(t.eng_max, Some(150.5));
        assert_eq!(t.limit_hi_hi, Some(140.0));
        assert_eq!(t.decimals, Some(2));
        assert_eq!(t.history_min_interval_ms, Some(5000));
        assert_eq!(t.write_min_role.as_deref(), Some("Operator"));
    }

    /// Un numero illeggibile non fa fallire l'import di tutto il file: quella
    /// cella si ignora e il resto passa.
    #[test]
    fn un_numero_storto_si_ignora_invece_di_buttare_il_file() {
        let mut t = TagDef::nuovo("t1", "f32");
        t.eng_max = Some(7.0);
        m(&[("eng_max", "centocinquanta"), ("unit", "bar")]).applica(&mut t);
        assert_eq!(t.eng_max, Some(7.0));
        assert_eq!(t.unit.as_deref(), Some("bar"));
    }

    /// Un membro nuovo nasce con lo storico **acceso**, come il default di
    /// serde: un `Default` derivato lo farebbe nascere spento, e il membro
    /// sparirebbe dallo storico senza che il file lo dica.
    #[test]
    fn un_membro_nuovo_nasce_con_lo_storico_acceso() {
        let mut x = Membro::nuovo("velocita");
        assert!(x.history);
        m(&[("data_type", "f32"), ("unit", "rpm")]).applica_membro(&mut x);
        assert_eq!(x.data_type.as_deref(), Some("f32"));
        assert_eq!(x.unit.as_deref(), Some("rpm"));
        assert!(x.history);
        m(&[("history", "false")]).applica_membro(&mut x);
        assert!(!x.history);
    }

    fn progetto(json: serde_json::Value) -> Project {
        serde_json::from_value(json).unwrap()
    }

    /// L'import intero, dal testo al progetto: è il giro che fa il maintainer.
    fn importa(p: &mut Project, csv: &str) {
        let righe = righe_csv(csv);
        let cols: Vec<String> = righe[0].iter().map(|c| c.trim().to_string()).collect();
        let col = |n: &str| cols.iter().position(|c| c == n);
        let id_col = col("id").unwrap();
        let kind_col = col("kind");
        let owner_col = col("owner");
        let dati: Vec<(usize, String)> = cols
            .iter()
            .enumerate()
            .filter(|(i, c)| {
                Some(*i) != Some(id_col)
                    && Some(*i) != kind_col
                    && Some(*i) != owner_col
                    && !c.is_empty()
            })
            .map(|(i, c)| (i, c.clone()))
            .collect();
        let mut righe_csv_out = Vec::new();
        for f in righe.iter().skip(1) {
            let get = |i: usize| f.get(i).map(|s| s.trim()).unwrap_or("").to_string();
            let id = get(id_col);
            if id.is_empty() {
                continue;
            }
            let mods = Modifiche {
                campi: dati.iter().map(|(i, n)| (n.clone(), get(*i))).collect(),
            };
            let kind = kind_col.map(&get).unwrap_or_default();
            righe_csv_out.push(match kind.as_str() {
                "type" => RigaCsv::Tipo { id, m: mods },
                "member" => RigaCsv::Membro {
                    owner: owner_col.map(&get).unwrap_or_default(),
                    m: Modifiche {
                        campi: [vec![("name".to_string(), id)], mods.campi].concat(),
                    },
                },
                _ => RigaCsv::Variabile { id, m: mods },
            });
        }
        applica_csv(p, &righe_csv_out);
    }

    /// Il file porta variabili **e** tipi: esportare le prime senza i secondi
    /// dava un'istanza di un tipo inesistente, cioè un file che non si può
    /// reimportare da nessuna parte (segnalato dal maintainer il 22-09-2026).
    #[test]
    fn un_file_solo_porta_tipi_membri_e_variabili() {
        let mut p = progetto(serde_json::json!({ "meta": { "name": "t", "version": "1" } }));
        importa(
            &mut p,
            "kind,owner,id,data_type,type_ref,array,description,unit,history\n\
             type,,Motore,,,,Motore asincrono,,\n\
             member,Motore,velocita,f32,,,,rpm,true\n\
             member,Motore,marcia,bool,,,,,false\n\
             tag,,motore1,bool,Motore,,Il primo,,true\n\
             tag,,zone,f32,,2x3,,°C,true\n",
        );
        assert_eq!(p.types.len(), 1);
        assert_eq!(p.types[0].description, "Motore asincrono");
        assert_eq!(
            p.types[0]
                .members
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>(),
            ["velocita", "marcia"]
        );
        assert!(!p.types[0].members[1].history);
        assert_eq!(p.tags.len(), 2);
        assert_eq!(p.tags[0].type_ref.as_deref(), Some("Motore"));
        assert_eq!(p.tags[1].array, Some(vec![2, 3]));
    }

    /// I membri di un tipo che il file nomina prendono **l'ordine del file**:
    /// l'ordine dei membri è l'ordine delle foglie, quindi riordinarlo è una
    /// modifica vera. Ma i campi che il file non dichiara restano quelli di
    /// prima, membro per membro.
    #[test]
    fn i_membri_prendono_l_ordine_del_file_e_tengono_il_resto() {
        let mut p = progetto(serde_json::json!({
            "meta": { "name": "t", "version": "1" },
            "types": [{ "id": "Motore", "members": [
                { "name": "velocita", "data_type": "f32", "unit": "rpm", "eng_max": 3000.0 },
                { "name": "marcia", "data_type": "bool" }] }],
        }));
        // Ordine invertito, un membro nuovo in fondo, e nessuna colonna unità.
        importa(
            &mut p,
            "kind,owner,id,data_type\n\
             member,Motore,marcia,bool\n\
             member,Motore,velocita,f32\n\
             member,Motore,corrente,f32\n",
        );
        let m = &p.types[0].members;
        assert_eq!(
            m.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(),
            ["marcia", "velocita", "corrente"]
        );
        // `velocita` ha cambiato posto ma non ha perso unità e scala.
        assert_eq!(m[1].unit.as_deref(), Some("rpm"));
        assert_eq!(m[1].eng_max, Some(3000.0));
        assert_eq!(m[2].data_type.as_deref(), Some("f32"));
    }

    /// Un tipo che il file **non nomina** non si tocca: l'import è una fusione,
    /// non una sostituzione del progetto.
    #[test]
    fn un_tipo_che_il_file_non_nomina_resta_dov_era() {
        let mut p = progetto(serde_json::json!({
            "meta": { "name": "t", "version": "1" },
            "types": [
                { "id": "Motore", "members": [{ "name": "velocita", "data_type": "f32" }] },
                { "id": "Valvola", "members": [{ "name": "aperta", "data_type": "bool" }] }],
        }));
        importa(
            &mut p,
            "kind,owner,id,data_type\nmember,Motore,velocita,f64\n",
        );
        assert_eq!(p.types.len(), 2);
        assert_eq!(p.types[0].members[0].data_type.as_deref(), Some("f64"));
        assert_eq!(p.types[1].members.len(), 1);
        assert_eq!(p.types[1].members[0].name, "aperta");
    }

    /// Un `tags.csv` esportato prima del 22-09-2026 non ha la colonna `kind`:
    /// si reimporta come sempre, tutte righe variabili.
    #[test]
    fn un_file_vecchio_senza_kind_e_tutto_variabili() {
        let mut p = progetto(serde_json::json!({ "meta": { "name": "t", "version": "1" } }));
        importa(
            &mut p,
            "id,data_type,description,history,expression\nt1,f32,Primo,true,\nt2,bool,,false,\n",
        );
        assert_eq!(p.types.len(), 0);
        assert_eq!(p.tags.len(), 2);
        assert_eq!(p.tags[0].data_type, "f32");
        assert!(p.tags[0].history);
    }

    /// Andata e ritorno di una struttura: quello che l'IDE esporta, riletto.
    #[test]
    fn andata_e_ritorno_di_una_variabile_composita() {
        let esportato = "kind,owner,id,data_type,type_ref,array,description,unit,history\n\
                         type,,Motore,,,,\"Motore, asincrono\",,\n\
                         member,Motore,velocita,f32,,,,rpm,true\n\
                         member,Motore,marcia,bool,,,,,false\n\
                         tag,,motore1,bool,Motore,,Motore 1,,true\n\
                         tag,,zone,f32,,2x3,Zone,°C,true\n";
        let righe = righe_csv(esportato);
        assert_eq!(righe.len(), 6);
        assert_eq!(righe[1][6], "Motore, asincrono");

        // La forma della riga: kind in prima colonna, owner in seconda.
        let intestazione: Vec<&str> = righe[0].iter().map(|c| c.trim()).collect();
        assert_eq!(&intestazione[..3], ["kind", "owner", "id"]);

        // I membri, applicati in ordine a un tipo vuoto.
        let mut td = TypeDef {
            id: "Motore".into(),
            description: String::new(),
            members: vec![],
        };
        for r in &righe[2..4] {
            let mut x = Membro::nuovo(&r[2]);
            m(&[("data_type", &r[3]), ("unit", &r[7]), ("history", &r[8])]).applica_membro(&mut x);
            td.members.push(x);
        }
        assert_eq!(td.members.len(), 2);
        assert_eq!(td.members[0].name, "velocita");
        assert_eq!(td.members[0].unit.as_deref(), Some("rpm"));
        assert!(!td.members[1].history);

        // Le variabili.
        let mut m1 = TagDef::nuovo("motore1", "float");
        m(&[
            ("data_type", &righe[4][3]),
            ("type_ref", &righe[4][4]),
            ("array", &righe[4][5]),
        ])
        .applica(&mut m1);
        assert_eq!(m1.type_ref.as_deref(), Some("Motore"));
        assert_eq!(m1.array, None);
        assert_eq!(m1.data_type, "bool");

        let mut z = TagDef::nuovo("zone", "float");
        m(&[("array", &righe[5][5]), ("unit", &righe[5][7])]).applica(&mut z);
        assert_eq!(z.array, Some(vec![2, 3]));
        assert_eq!(z.unit.as_deref(), Some("°C"));
    }
}
