//! Multi-project endpoints — list / create / open / close / upload-zip.
//!
//! Pre-auth: these endpoints run outside the auth middleware so the
//! WelcomeScreen can show a project picker without a session token. Once
//! a project is opened, the per-project AuthState gates everything else.

use crate::global_scripts::GlobalScriptSupervisor;
use crate::notifications::NotificationSupervisor;
use crate::router::{active_dir, AppState, AuthUser, DerivedTagsRegistry, FunctionsRegistry, RegistryCell};
use crate::source_supervisor::SourceSupervisor;
use crate::templates::copy_dir_all;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    Extension,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Cursor, Read},
    path::{Path as StdPath, PathBuf},
    sync::Arc,
};
use sws_core::{
    AffixPosition, AlarmDb, DatastoreBackendConfig, DatastoreConfig, GlobalScriptDef,
    NotificationConfig, Project, ProjectMeta, SourceDef, TagDb,
};
use sws_historian::{DatastoreRegistry, Historian};
use tracing::{info, warn};

/// Avvia i servizi che vivono quanto il progetto aperto: canale Telegram, script
/// globali, supervisore delle notifiche.
///
/// Esiste come funzione condivisa perché **tre** percorsi aprono un progetto —
/// `open_project` (dall'IDE), `system_start` (presa in carico dall'operatore) e
/// l'auto-apertura al boot in `main.rs` — e quest'ultimo se l'era dimenticata.
/// Effetto sul dispositivo: dopo ogni riavvio gli allarmi non mandavano né email
/// né Telegram e gli script globali non partivano, finché qualcuno non riapriva
/// il progetto dall'IDE. Il sintomo riportato dal maintainer era proprio "la
/// notifica di test mi arriva ma il messaggio dell'allarme no": il test invia da
/// sé, l'allarme dipende da questo supervisore.
///
/// Va chiamata **dopo** `supervisor.reload(sources)`, così gli script globali
/// trovano i valori dei tag già popolati.
pub async fn start_project_services(
    s: &AppState,
    notifications: Option<sws_core::NotificationConfig>,
    global_scripts: Vec<sws_core::GlobalScriptDef>,
) {
    // Il canale Telegram si crea prima dei due supervisori, così condividono
    // lo stesso sink e una riconfigurazione a caldo li aggiorna entrambi.
    let sinks = crate::telegram::restart_sender(
        s, notifications.as_ref().and_then(|n| n.telegram.clone()),
    ).await;
    // Il send_telegram delle FUNZIONI passa dall'engine condiviso s.py.
    s.py.set_telegram_sink(sinks.as_ref().map(|k| k.text.clone()));
    if !global_scripts.is_empty() {
        let n = global_scripts.len();
        let sc = GlobalScriptSupervisor::start(
            global_scripts,
            s.db.clone(),
            s.bus.clone(),
            sinks.as_ref().map(|k| k.text.clone()),
        );
        info!(scripts = n, "global script supervisor started");
        *s.script_supervisor.write().await = Some(sc);
    }
    if let Some(notif) = notifications {
        let ns = NotificationSupervisor::start(s.alarms.clone(), notif, sinks.map(|k| k.messages));
        info!("notification supervisor started");
        *s.notification_supervisor.write().await = Some(ns);
    }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ProjectListEntry {
    pub name: String,
    pub has_project_yaml: bool,
    pub last_modified_ms: Option<u64>,
    /// Absolute path on the server's filesystem — lets the UI disambiguate
    /// projects living outside the default `projects_root`.
    pub path: String,
    /// When this project was last created/opened (registry-tracked). `None`
    /// for a legacy root-scoped project never touched by the new code path
    /// yet — sorts after every timestamped entry.
    pub last_opened_ms: Option<u64>,
    /// True when the project's path is NOT a direct child of `projects_root`
    /// (i.e. a custom parent_path was chosen at creation). Drives softer
    /// rename/delete semantics in the UI (never touches the maintainer's own
    /// folder on disk).
    pub external: bool,
}

#[derive(Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    /// Optional template id (subfolder under `templates_root`).
    /// When None, a minimal `project.yaml` is written instead.
    #[serde(default)]
    pub template: Option<String>,
    /// Optional absolute parent directory to create the project under, instead
    /// of the default `projects_root` (e.g. the maintainer's Documents folder,
    /// or a backup share). Must be an absolute path; created if missing. When
    /// absent, behavior is 100% unchanged from before this field existed.
    #[serde(default)]
    pub parent_path: Option<String>,
}

#[derive(Serialize)]
pub struct OpenProjectResponse {
    pub name: String,
    pub must_login: bool,
}

// ── safe_project_name ────────────────────────────────────────────────────────

/// Sanitize a user-supplied project name into a safe folder name.
/// Rejects empty / dot-prefixed / parent-traversal / slash-bearing inputs.
/// Also used to validate plain folder names (see `POST /api/fs/mkdir`) — the
/// rules are exactly the same.
pub fn safe_project_name(name: &str) -> Result<String, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty");
    }
    if trimmed.starts_with('.') {
        return Err("project name cannot start with '.'");
    }
    if trimmed.len() > 64 {
        return Err("project name is too long (max 64 chars)");
    }
    for c in trimmed.chars() {
        if matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            return Err("project name contains an invalid character");
        }
    }
    if trimmed == "." || trimmed == ".." {
        return Err("invalid project name");
    }
    Ok(trimmed.to_string())
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// `GET /api/projects` — list subfolders of `projects_root` that contain a
/// `project.yaml`. Pre-auth so the WelcomeScreen can populate without a
/// session.
pub async fn list_projects(State(s): State<AppState>) -> Response {
    let root: &StdPath = s.projects_root.as_path();
    let mut by_name: std::collections::HashMap<String, ProjectListEntry> =
        std::collections::HashMap::new();

    // 1. Legacy scan of projects_root — finds pre-existing root-scoped
    //    projects that predate the registry and were never create/open'd
    //    through the new code path yet.
    match tokio::fs::read_dir(root).await {
        Ok(mut dir) => {
            while let Ok(Some(entry)) = dir.next_entry().await {
                let path = entry.path();
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                if name.starts_with('.') {
                    continue;
                }
                let meta = match tokio::fs::metadata(&path).await {
                    Ok(m) if m.is_dir() => m,
                    _ => continue,
                };
                let yaml_path = path.join("project.yaml");
                // Skip directories that don't look like projects (e.g. the
                // `logs/` subdirectory the runtime creates by default).
                if !tokio::fs::try_exists(&yaml_path).await.unwrap_or(false) {
                    continue;
                }
                let last_modified_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                by_name.insert(
                    name.clone(),
                    ProjectListEntry {
                        name,
                        has_project_yaml: true,
                        last_modified_ms,
                        path: path.to_string_lossy().to_string(),
                        last_opened_ms: None,
                        external: false,
                    },
                );
            }
        }
        Err(e) => warn!("list_projects: cannot read {}: {e}", root.display()),
    }

    // 2. Registry entries — covers projects created/opened at a custom
    //    parent_path (never found by the scan above), and refreshes
    //    last_opened_ms/path for anything the scan already picked up.
    for (name, reg_entry) in s.known_projects.snapshot().await {
        let yaml_path = reg_entry.path.join("project.yaml");
        if !tokio::fs::try_exists(&yaml_path).await.unwrap_or(false) {
            // Stale entry (folder moved/deleted outside SWS) — skip rather
            // than show a dead link in the welcome list.
            continue;
        }
        let external = reg_entry.path.parent() != Some(root);
        let last_modified_ms = tokio::fs::metadata(&reg_entry.path)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        by_name.insert(
            name.clone(),
            ProjectListEntry {
                name,
                has_project_yaml: true,
                last_modified_ms,
                path: reg_entry.path.to_string_lossy().to_string(),
                last_opened_ms: Some(reg_entry.last_opened_ms),
                external,
            },
        );
    }

    let mut entries: Vec<ProjectListEntry> = by_name.into_values().collect();
    // Most recently opened first; untouched legacy entries (no registry
    // timestamp) sort after every timestamped one, alphabetically among
    // themselves.
    entries.sort_by(|a, b| {
        b.last_opened_ms
            .unwrap_or(0)
            .cmp(&a.last_opened_ms.unwrap_or(0))
            .then_with(|| a.name.cmp(&b.name))
    });
    Json(entries).into_response()
}

/// `POST /api/projects` — create a new project folder under `projects_root`,
/// optionally seeded from a template. Returns 409 if the folder exists.
pub async fn create_project(
    State(s): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> Response {
    let safe_name = match safe_project_name(&req.name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };

    // Resolve the parent directory: default projects_root (unchanged behavior)
    // or a maintainer-chosen absolute path (Documents folder, backup share...).
    let parent_dir: PathBuf = match req.parent_path.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let parent = PathBuf::from(p);
            if !parent.is_absolute() {
                return (StatusCode::BAD_REQUEST, "parent_path must be an absolute path").into_response();
            }
            if let Err(e) = tokio::fs::create_dir_all(&parent).await {
                warn!("create_project: mkdir parent {}: {e}", parent.display());
                return (StatusCode::BAD_REQUEST, format!("cannot create/access parent_path: {e}")).into_response();
            }
            parent
        }
        None => s.projects_root.as_ref().clone(),
    };

    // Uniqueness must hold across BOTH the projects_root scan and the registry
    // (a name already used by an external project can't be reused here).
    if s.known_projects.get_path(&safe_name).await.is_some() {
        return (StatusCode::CONFLICT, "project already exists").into_response();
    }
    let target = parent_dir.join(&safe_name);
    if tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "project already exists").into_response();
    }

    if let Err(e) = tokio::fs::create_dir_all(&target).await {
        warn!("create_project: mkdir {}: {e}", target.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create project dir").into_response();
    }

    match req.template.as_deref().filter(|t| !t.is_empty()) {
        Some(template_id) => {
            let source = s.templates_root.join(template_id);
            if !tokio::fs::try_exists(&source).await.unwrap_or(false) {
                let _ = tokio::fs::remove_dir_all(&target).await;
                return (StatusCode::NOT_FOUND, "template not found").into_response();
            }
            // Recursive copy, skipping `template.yaml` (metadata-only).
            if let Err(e) = copy_dir_all(&source, &target, &["template.yaml"]).await {
                warn!("create_project: copy template: {e}");
                let _ = tokio::fs::remove_dir_all(&target).await;
                return (StatusCode::INTERNAL_SERVER_ERROR, "copy template failed")
                    .into_response();
            }
            // Update meta.name in the copied project.yaml to match the user's
            // chosen name instead of the template's internal id.
            let yaml_path = target.join("project.yaml");
            match patch_project_name(&yaml_path, &safe_name).await {
                Ok(()) => {}
                Err(e) => {
                    warn!("create_project: patch meta.name: {e}");
                    // Non-fatal — project is usable, name just stays as template id.
                }
            }
            info!(name = %safe_name, template = template_id, "project created from template");
        }
        None => {
            // Write a minimal project.yaml so the welcome list sees it.
            let mut project = Project {
                meta: ProjectMeta {
                    name: safe_name.clone(),
                    version: "0.1.0".into(),
                },
                tags: vec![],
                sources: vec![],
                alarms: vec![],
                functions: vec![],
                custom_symbols: vec![],
                datastores: vec![default_datastore()],
                global_scripts: vec![],
                notifications: None,
                saved_by: None,
                languages: Default::default(),
                page_layout: None,
            };
            let yaml = match project.stamp_and_serialize() {
                Ok(y) => y,
                Err(e) => {
                    warn!("create_project: serialize: {e}");
                    return (StatusCode::INTERNAL_SERVER_ERROR, "serialize failed")
                        .into_response();
                }
            };
            if let Err(e) = tokio::fs::write(target.join("project.yaml"), yaml).await {
                warn!("create_project: write project.yaml: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, "write project.yaml failed")
                    .into_response();
            }
            info!(name = %safe_name, "project created (empty)");
        }
    }

    // Every created project — root-scoped or at a custom parent_path — enters
    // the known-projects registry, so the "recent projects" list picks it up
    // immediately (not just custom-path ones).
    s.known_projects.touch(&safe_name, &target).await;

    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "name": safe_name })),
    )
        .into_response()
}

/// `POST /api/projects/:name/open` — switch the runtime's active project.
/// Loads `project.yaml`, populates TagDb (clear + populate), reloads
/// AlarmDb / supervisor / functions registry, swaps AuthState to the new
/// `users.yaml`. **Invalidates all current session tokens** — clients
/// must re-login.
/// Applies an already-loaded `Project` to the live runtime pieces: seeds
/// derived tags, populates `TagDb`, initialises the datastore registry,
/// swaps the historian to the project's SQLite store, loads alarms (with
/// the journal→SQLite wiring), resolves MQTT client ids
/// (`resolve_mqtt_client_ids`), reloads the source supervisor, and
/// populates the function registry.
///
/// Does **not** start notification/global-script services — those need an
/// `AppState` that doesn't exist yet at one of the two call sites (see
/// below) — so it returns `(notifications, global_scripts)` for the
/// caller to start once it can.
///
/// Shared by `open_project` (this file — HTTP handler, `AppState` already
/// built) and the boot-time project auto-open in `sws-runtime/src/main.rs`
/// (runs *before* `AppState` exists, on the individual pieces that later
/// get assembled into it). Before this function existed the two paths
/// hand-copied each other, and a step added to one and not the other
/// stayed invisible until it was needed — the historian/notifications
/// wiring and, most recently, MQTT client id resolution all went missing
/// this way in turn. One function, one place to add the next step.
#[allow(clippy::too_many_arguments)]
pub async fn apply_loaded_project(
    project_dir: &StdPath,
    mut project: Project,
    db: &Arc<TagDb>,
    registry: &RegistryCell,
    historian: &Arc<Historian>,
    alarms: &Arc<AlarmDb>,
    supervisor: &Arc<SourceSupervisor>,
    derived_tags: &DerivedTagsRegistry,
    functions: &FunctionsRegistry,
    config_dir: &StdPath,
    instance_id: &str,
) -> (Option<NotificationConfig>, Vec<GlobalScriptDef>) {
    info!(
        name = %project.meta.name,
        tags = project.tags.len(),
        alarms = project.alarms.len(),
        functions = project.functions.len(),
        "project opened",
    );
    // Seed derived tags before populate_tags so they start Uncertain until
    // the evaluator task computes the first real value.
    {
        let derived: Vec<(String, String)> = project.tags.iter()
            .filter_map(|t| t.expression.as_ref().map(|e| (t.id.clone(), e.clone())))
            .collect();
        *derived_tags.write().await = derived;
    }
    project.populate_tags(db).await;
    // Init datastore registry before consuming the project fields.
    match DatastoreRegistry::from_project(&project, project_dir).await {
        Ok(Some(reg)) => {
            reg.clone().spawn_recorder(db.clone());
            info!(backends = project.datastores.len(), "datastore registry initialised");
            *registry.write().await = Some(reg);
        }
        Ok(None) => {
            *registry.write().await = None;
        }
        Err(e) => {
            warn!("apply_loaded_project: datastore registry init failed: {e:#}");
            *registry.write().await = None;
        }
    }
    // Swap the global historian's SQLite to this project's primary store.
    // All history reads/writes now go to <project>/.history/historian.db.
    {
        let hist_store = registry.read().await.as_ref()
            .and_then(|r| r.primary_sqlite_store());
        historian.swap_store(hist_store).await;
    }
    alarms.load(project.alarms).await;
    // Wire the alarm journal → SQLite if a store is open.
    if let Some(store) = historian.sqlite_store().await {
        alarms.set_journal_callback(move |ev| {
            let store = store.clone();
            tokio::spawn(async move { store.append_alarm_event(&ev).await; });
        }).await;
    }
    resolve_mqtt_client_ids(&project.meta.name, &mut project.sources, config_dir, instance_id);
    supervisor.reload(project.sources).await;
    {
        let mut map = functions.write().await;
        for f in project.functions {
            map.insert(f.name.clone(), f);
        }
    }
    (project.notifications, project.global_scripts)
}

pub async fn open_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let safe_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    // Resolve via the registry first (covers custom-path/external projects),
    // falling back to the default projects_root location as before.
    let project_dir = match s.known_projects.get_path(&safe_name).await {
        Some(p) => p,
        None => s.projects_root.join(&safe_name),
    };
    if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
        return (StatusCode::NOT_FOUND, "project not found").into_response();
    }

    // Read seed from env so newly-opened projects without a users.yaml
    // get bootstrapped with admin/etc. — same flow as the legacy
    // single-project boot.
    let seed = build_seed_accounts();

    // 1. Load the new project FIRST — if it's invalid, leave the current
    //    state untouched and return an error without disrupting the operator.
    let mut project = match Project::load(&project_dir) {
        Ok(p) => p,
        Err(e) => {
            warn!("open_project: project.yaml missing or invalid: {e:#}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("project parse error: {e}"),
            )
            .into_response();
        }
    };
    // Retroactively add the per-project default datastore for legacy projects
    // that were created before this field existed (datastores: []).
    // This ensures every project records history into its own .history/
    // directory instead of the shared global historian.
    if project.datastores.is_empty() {
        project.datastores.push(default_datastore());
        // Solo in memoria: **aprire un progetto non deve modificarlo.**
        //
        // Prima qui si riscriveva `project.yaml`, e quella riscrittura passava
        // fuori da `patch_project`: si portava via le sorgenti che questa versione
        // non sa leggere e le chiavi di primo livello sconosciute, all'apertura e
        // senza che nessuno avesse chiesto un salvataggio. Verificato con
        // `scripts/check_project_write_safety.sh`, che ha colto proprio questo.
        //
        // Il runtime funziona identico: la registry dei datastore si costruisce
        // dal progetto in memoria. Il file si aggiorna al primo salvataggio vero,
        // che è il momento in cui l'utente si aspetta che cambi.
        info!(name = %project.meta.name, "default datastore iniettato in memoria (file non modificato)");
    }

    // 2. Project is valid — clear the current runtime state.
    // Stop sources FIRST so no plugin can write to TagDb after we clear it.
    // reload(vec![]) waits up to 2 s per source for clean shutdown.
    s.supervisor.reload(vec![]).await;
    // Stop any running global scripts before clearing tag state.
    if let Some(sc) = s.script_supervisor.write().await.take() {
        sc.stop();
    }
    if let Some(ns) = s.notification_supervisor.write().await.take() {
        ns.stop();
    }
    crate::telegram::stop_sender(&s).await;
    s.db.clear().await;
    s.historian.clear().await;
    s.alarms.load(vec![]).await;
    s.functions.write().await.clear();
    s.derived_tags.write().await.clear();
    s.recipe_log.write().await.clear();

    // Point the OPC-UA plugin at this project's PKI dir so cert + key
    // travel with the project (back up + restore included).
    s.supervisor.set_pki_root(project_dir.join(".opcua-pki")).await;

    // 3. Apply the new project.
    let (notifications, global_scripts) = apply_loaded_project(
        &project_dir, project,
        &s.db, &s.registry, &s.historian, &s.alarms, &s.supervisor,
        &s.derived_tags, &s.functions, &s.config_dir, &s.instance_id,
    ).await;
    start_project_services(&s, notifications, global_scripts).await;

    // 4. Swap auth store. Drops all sessions → forces re-login.
    if let Err(e) = s.auth.swap_store(project_dir.join("users.yaml"), seed).await {
        warn!("open_project: swap_store failed: {e:#}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("auth swap failed: {e}"),
        )
            .into_response();
    }

    // 4. Mark the project as active and persist the choice so the runtime
    //    reopens it after a plain restart (single-project model).
    let marker = s.projects_root.join(".active-project");
    if let Err(e) = tokio::fs::write(&marker, project_dir.to_string_lossy().as_bytes()).await {
        warn!("open_project: could not write .active-project marker: {e}");
    }
    *s.project_dir.write().await = Some(project_dir.clone());

    // Every successful open — not just creation — refreshes last_opened_ms,
    // which is what makes this a "recent projects" list rather than just a
    // "created projects" list.
    s.known_projects.touch(&safe_name, &project_dir).await;

    Json(OpenProjectResponse {
        name: safe_name,
        must_login: true,
    })
    .into_response()
}

/// `POST /api/projects/close` — close the active project.
/// Drops TagDb / AlarmDb / supervisor sources / functions / auth.
/// All sessions become invalid.
pub async fn close_project(State(s): State<AppState>) -> Response {
    // Check there's something to close.
    if active_dir(&s).await.is_err() {
        return (StatusCode::NO_CONTENT, ()).into_response();
    }
    s.supervisor.reload(vec![]).await;
    if let Some(sc) = s.script_supervisor.write().await.take() {
        sc.stop();
    }
    if let Some(ns) = s.notification_supervisor.write().await.take() {
        ns.stop();
    }
    crate::telegram::stop_sender(&s).await;
    s.db.clear().await;
    s.historian.swap_store(None).await; // RAM-only between projects
    s.alarms.load(vec![]).await;
    s.functions.write().await.clear();
    s.derived_tags.write().await.clear();
    s.recipe_log.write().await.clear();
    *s.registry.write().await = None;
    s.auth.clear().await;
    *s.project_dir.write().await = None;
    info!("project closed");
    StatusCode::NO_CONTENT.into_response()
}

// ── Delete / Rename / Duplicate ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RenameRequest {
    pub new_name: String,
}

/// A project's directory is "external" when it doesn't live directly under
/// `projects_root` (i.e. it was created at a maintainer-chosen custom
/// `parent_path`). Derived from the path rather than stored, so there's
/// nothing to keep in sync.
fn is_external(dir: &StdPath, root: &StdPath) -> bool {
    dir.parent() != Some(root)
}

/// Resolve a project name to its directory: registry first (covers external
/// and any previously-touched root project), falling back to the legacy
/// `projects_root/<name>` location.
async fn resolve_project_dir(s: &AppState, name: &str) -> PathBuf {
    match s.known_projects.get_path(name).await {
        Some(p) => p,
        None => s.projects_root.join(name),
    }
}

/// `DELETE /api/projects/:name` — remove a project. For a root-scoped project
/// this deletes the folder on disk (today's behavior); for an external
/// project (custom parent_path, e.g. the maintainer's Documents folder or a
/// backup share) it only de-registers it from the known-projects list —
/// files the maintainer deliberately placed outside the editor are never
/// touched.
/// Query params for `DELETE /api/projects/:name`.
#[derive(Deserialize, Default)]
pub struct DeleteQuery {
    /// `true` → rimuovi solo gli artefatti di **progettazione** (`project.yaml`,
    /// `synoptics/`) e lascia intatto tutto lo stato locale del dispositivo.
    ///
    /// Serve al deploy remoto, che prima di caricare il progetto nuovo cancellava
    /// la cartella intera — portandosi via `.history/`, cioè il database storico.
    /// Lo storico è l'unica cosa in un progetto che **non si può ricreare**: le
    /// pagine si riesportano dall'IDE, i mesi di campioni no.
    ///
    /// Il default (nessun parametro) resta distruttivo: è il pulsante "Elimina"
    /// della WelcomeScreen, dove cancellare tutto è la richiesta esplicita.
    #[serde(default)]
    pub preserve_state: bool,
}

/// Ciò che il deploy sovrascrive: artefatti di progettazione, prodotti dall'IDE
/// e riesportabili in qualsiasi momento.
const DESIGN_ARTIFACTS: &[&str] = &["project.yaml", "synoptics"];

pub async fn delete_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<DeleteQuery>,
) -> Response {
    let safe_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let target = resolve_project_dir(&s, &safe_name).await;
    if !tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Reject if the project is currently open.
    if let Ok(active) = active_dir(&s).await {
        if active == target {
            return (StatusCode::CONFLICT, "project is currently open — close it first")
                .into_response();
        }
    }

    if is_external(&target, s.projects_root.as_path()) {
        s.known_projects.remove(&safe_name).await;
        info!(name = %safe_name, path = %target.display(), "external project removed from list (files untouched)");
        return StatusCode::NO_CONTENT.into_response();
    }

    // Deploy: si rimuovono solo gli artefatti di progettazione. `.history/` (il
    // database), `.bak/`, `recipes/`, `.opcua-pki/` e `users.yaml` restano dove
    // sono — sono stato del dispositivo, non del progetto che stai distribuendo.
    // Il progetto NON viene rimosso da `known_projects`: la cartella esiste
    // ancora e sta per ricevere i file nuovi.
    if q.preserve_state {
        for name in DESIGN_ARTIFACTS {
            let path = target.join(name);
            let res = if tokio::fs::metadata(&path).await.map(|m| m.is_dir()).unwrap_or(false) {
                tokio::fs::remove_dir_all(&path).await
            } else {
                match tokio::fs::remove_file(&path).await {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    other => other,
                }
            };
            if let Err(e) = res {
                warn!("delete_project(preserve_state): remove {}: {e}", path.display());
                return (StatusCode::INTERNAL_SERVER_ERROR, "cannot clear design files")
                    .into_response();
            }
        }
        info!(name = %safe_name, "design files cleared, local state preserved (deploy)");
        return StatusCode::NO_CONTENT.into_response();
    }

    if let Err(e) = tokio::fs::remove_dir_all(&target).await {
        warn!("delete_project: remove {}: {e}", target.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot delete project dir").into_response();
    }
    s.known_projects.remove(&safe_name).await;
    // Clear the auto-open marker if it pointed at the deleted project, so the
    // runtime doesn't try to reopen a missing directory on next restart.
    let marker = s.projects_root.join(".active-project");
    if let Ok(txt) = tokio::fs::read_to_string(&marker).await {
        if std::path::Path::new(txt.trim()) == target {
            let _ = tokio::fs::remove_file(&marker).await;
        }
    }
    info!(name = %safe_name, "project deleted");
    StatusCode::NO_CONTENT.into_response()
}

/// `POST /api/projects/:name/rename` — rename a project.
/// Body: `{ "new_name": "..." }`.
/// Root-scoped: renames the physical folder under `projects_root` (today's
/// behavior). External (custom parent_path): the folder is left exactly
/// where the maintainer put it — only `meta.name` and the registry key
/// change.
pub async fn rename_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<RenameRequest>,
) -> Response {
    let old_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let new_name = match safe_project_name(&req.new_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    if old_name == new_name {
        return (StatusCode::BAD_REQUEST, "new name is the same as the current name").into_response();
    }
    let old_dir = resolve_project_dir(&s, &old_name).await;
    if !tokio::fs::try_exists(&old_dir).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // The new name must be free both in the registry and in projects_root.
    if s.known_projects.get_path(&new_name).await.is_some() {
        return (StatusCode::CONFLICT, "a project with the new name already exists").into_response();
    }

    if is_external(&old_dir, s.projects_root.as_path()) {
        let yaml_path = old_dir.join("project.yaml");
        if let Err(e) = patch_project_name(&yaml_path, &new_name).await {
            warn!("rename_project: patch meta.name {}: {e}", yaml_path.display());
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot update project.yaml").into_response();
        }
        s.known_projects.rename_key(&old_name, &new_name).await;
        info!(old = %old_name, new = %new_name, path = %old_dir.display(), "external project renamed (folder unchanged)");
        return Json(serde_json::json!({ "name": new_name })).into_response();
    }

    let new_dir = s.projects_root.join(&new_name);
    if tokio::fs::try_exists(&new_dir).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "a project with the new name already exists").into_response();
    }
    if let Err(e) = tokio::fs::rename(&old_dir, &new_dir).await {
        warn!("rename_project: rename {old_name} → {new_name}: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot rename project dir").into_response();
    }
    // If the renamed project was open, update the active pointer.
    {
        let mut lock = s.project_dir.write().await;
        if lock.as_deref() == Some(old_dir.as_path()) {
            *lock = Some(new_dir.clone());
        }
    }
    s.known_projects.remove(&old_name).await;
    s.known_projects.touch(&new_name, &new_dir).await;
    info!(old = %old_name, new = %new_name, "project renamed");
    Json(serde_json::json!({ "name": new_name })).into_response()
}

/// `POST /api/projects/:name/duplicate` — copy a project to a new folder.
/// Body: `{ "new_name": "..." }`.
/// External projects are duplicated as a sibling folder next to the
/// original (same custom parent), not pulled into `projects_root`.
pub async fn duplicate_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<RenameRequest>,
) -> Response {
    let src_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let dst_name = match safe_project_name(&req.new_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let src_dir = resolve_project_dir(&s, &src_name).await;
    if !tokio::fs::try_exists(&src_dir).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if s.known_projects.get_path(&dst_name).await.is_some() {
        return (StatusCode::CONFLICT, "a project with the new name already exists").into_response();
    }
    let dst_dir = if is_external(&src_dir, s.projects_root.as_path()) {
        match src_dir.parent() {
            Some(parent) => parent.join(&dst_name),
            None => return (StatusCode::INTERNAL_SERVER_ERROR, "source project has no parent directory").into_response(),
        }
    } else {
        s.projects_root.join(&dst_name)
    };
    if tokio::fs::try_exists(&dst_dir).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "a project with the new name already exists").into_response();
    }
    if let Err(e) = copy_dir_all(&src_dir, &dst_dir, &[]).await {
        warn!("duplicate_project: copy {src_name} → {dst_name}: {e}");
        let _ = tokio::fs::remove_dir_all(&dst_dir).await;
        return (StatusCode::INTERNAL_SERVER_ERROR, "copy failed").into_response();
    }
    s.known_projects.touch(&dst_name, &dst_dir).await;
    info!(src = %src_name, dst = %dst_name, "project duplicated");
    (StatusCode::CREATED, Json(serde_json::json!({ "name": dst_name }))).into_response()
}

// ── Mini file-browser (choose a project parent directory) ────────────────────

#[derive(Deserialize)]
pub struct BrowseDirsQuery {
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct BrowseDirEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct BrowseDirsResponse {
    pub path: String,
    pub parent: Option<String>,
    pub dirs: Vec<BrowseDirEntry>,
}

/// `GET /api/fs/browse-dirs?path=<abs|absent>` — backend for the "choose a
/// destination folder" UI shown when creating a project. Lists only the
/// subdirectories of `path` (or a sensible default when absent: `$HOME`,
/// falling back to `projects_root`). No whitelist by design — same
/// pre-auth/LAN-trusted posture as the rest of the project-lifecycle
/// endpoints; the maintainer explicitly wants free navigation, not a
/// restricted picker.
pub async fn browse_dirs(
    State(s): State<AppState>,
    Query(q): Query<BrowseDirsQuery>,
) -> Response {
    let current: PathBuf = match q.path.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p);
            if !p.is_absolute() {
                return (StatusCode::BAD_REQUEST, "path must be absolute").into_response();
            }
            p
        }
        None => std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| s.projects_root.as_ref().clone()),
    };

    let mut dir = match tokio::fs::read_dir(&current).await {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("cannot list {}: {e}", current.display()),
            )
                .into_response();
        }
    };

    let mut dirs = Vec::new();
    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        match tokio::fs::metadata(&path).await {
            Ok(m) if m.is_dir() => {}
            _ => continue,
        }
        dirs.push(BrowseDirEntry { name, path: path.to_string_lossy().to_string() });
    }
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let parent = current.parent().map(|p| p.to_string_lossy().to_string());
    Json(BrowseDirsResponse {
        path: current.to_string_lossy().to_string(),
        parent,
        dirs,
    })
    .into_response()
}

#[derive(Deserialize)]
pub struct CreateDirRequest {
    /// Absolute path of the (already existing) parent directory.
    pub parent: String,
    /// Name of the folder to create inside `parent`.
    pub name: String,
}

#[derive(Serialize)]
pub struct CreateDirResponse {
    pub path: String,
}

/// Pure part of `POST /api/fs/mkdir`: validate the inputs and build the target
/// path. Split out from the handler so it can be unit-tested without an
/// `AppState` or a filesystem.
fn resolve_new_dir(parent: &str, name: &str) -> Result<PathBuf, &'static str> {
    let trimmed = parent.trim();
    let p = PathBuf::from(trimmed);
    if trimmed.is_empty() || !p.is_absolute() {
        return Err("parent must be an absolute path");
    }
    // A folder name has the same constraints as a project name.
    let safe = safe_project_name(name)?;
    Ok(p.join(safe))
}

/// `POST /api/fs/mkdir` — create one directory, for the "new folder" button in
/// the destination picker. Pre-auth like `browse_dirs` and the rest of the
/// project-lifecycle group: the picker is reachable from the WelcomeScreen
/// before any session exists, which is precisely when the first project (and
/// its folder) gets created. This adds no new capability class — an
/// unauthenticated caller can already materialise arbitrary directory trees
/// via `POST /api/projects` / `?parent_path=` (both `create_dir_all`).
pub async fn create_dir(
    State(_s): State<AppState>,
    Json(req): Json<CreateDirRequest>,
) -> Response {
    let target = match resolve_new_dir(&req.parent, &req.name) {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
    };

    // The parent must already exist: `create_dir` (not `create_dir_all`) so a
    // typo in `parent` can't silently produce a whole tree.
    match tokio::fs::metadata(target.parent().unwrap_or(&target)).await {
        Ok(m) if m.is_dir() => {}
        _ => return (StatusCode::BAD_REQUEST, "parent directory does not exist").into_response(),
    }

    match tokio::fs::create_dir(&target).await {
        Ok(()) => {
            info!(path = %target.display(), "directory created");
            (
                StatusCode::CREATED,
                Json(CreateDirResponse { path: target.to_string_lossy().to_string() }),
            )
                .into_response()
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists =>
            (StatusCode::CONFLICT, "directory already exists").into_response(),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied =>
            (StatusCode::FORBIDDEN, format!("cannot create {}: {e}", target.display())).into_response(),
        Err(e) =>
            (StatusCode::BAD_REQUEST, format!("cannot create {}: {e}", target.display())).into_response(),
    }
}

// ── Upload from ZIP ───────────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
pub struct UploadQuery {
    /// Optional project name override. When absent the name is read from the
    /// ZIP's `manifest.json`; if `manifest.json` is missing the upload is
    /// rejected with 400.
    #[serde(default)]
    pub name: Option<String>,
    /// Optional absolute parent directory to create the project under,
    /// mirroring `CreateProjectRequest::parent_path`. Absent = projects_root
    /// (unchanged behavior).
    #[serde(default)]
    pub parent_path: Option<String>,
    /// `true` → questa è la seconda metà di un deploy: la cartella target
    /// **esiste già** (l'ha appena svuotata dei soli file di progettazione
    /// `DELETE …?preserve_state=true`) e va riempita senza rifiutare il conflitto.
    ///
    /// Cambia tre comportamenti, tutti necessari perché lo stato locale sopravviva:
    ///   - i due controlli di conflitto (progetto già noto / cartella esistente)
    ///     non si applicano;
    ///   - `users.yaml` presente nello ZIP viene **saltato**: gli account del
    ///     dispositivo sono stato locale e si aggiornano solo su richiesta
    ///     esplicita (Configurazione → Runtime), non di straforo con un deploy;
    ///   - in caso di errore **non** si fa `remove_dir_all` della cartella —
    ///     il rollback distruttivo cancellerebbe proprio il database che stiamo
    ///     cercando di preservare.
    #[serde(default)]
    pub deploy: bool,
}

// Minimal manifest — we only need `name` to derive the folder name.
#[derive(serde::Deserialize)]
struct UploadManifest {
    name: String,
}

/// `POST /api/projects/upload` — create a new project by uploading an SWS
/// export ZIP (same format as `GET /api/project/export`).
///
/// - Body: raw `application/zip` bytes.
/// - Query param `?name=<override>` is optional; falls back to `manifest.json`.
/// - Returns 201 `{"name": "..."}` on success, 409 if the folder exists.
/// - Pre-auth: no session token required.
pub async fn upload_project_zip(
    State(s): State<AppState>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Response {
    // 1. Parse the ZIP.
    let mut archive = match zip::ZipArchive::new(Cursor::new(body.as_ref())) {
        Ok(a)  => a,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("not a valid zip: {e}")).into_response(),
    };

    // 2. Determine the project name.
    let raw_name = match q.name.filter(|n| !n.trim().is_empty()) {
        Some(n) => n,
        None => {
            // Read manifest.json from the archive.
            match read_zip_entry(&mut archive, "manifest.json") {
                Ok(Some(bytes)) => match serde_json::from_slice::<UploadManifest>(&bytes) {
                    Ok(m) => m.name,
                    Err(e) => return (StatusCode::BAD_REQUEST,
                        format!("manifest.json parse error: {e}")).into_response(),
                },
                Ok(None) => return (StatusCode::BAD_REQUEST,
                    "ZIP has no manifest.json — supply ?name= query param").into_response(),
                Err(e) => return (StatusCode::BAD_REQUEST,
                    format!("zip read error: {e}")).into_response(),
            }
        }
    };

    let safe_name = match safe_project_name(&raw_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };

    // 3. Resolve the parent directory (default projects_root, or a
    //    maintainer-chosen absolute path), then reject if the folder already
    //    exists — include the real name so the client can display a
    //    confirmation dialog before deleting + re-uploading.
    let parent_dir: PathBuf = match q.parent_path.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let parent = PathBuf::from(p);
            if !parent.is_absolute() {
                return (StatusCode::BAD_REQUEST, "parent_path must be an absolute path").into_response();
            }
            if let Err(e) = tokio::fs::create_dir_all(&parent).await {
                warn!("upload_project_zip: mkdir parent {}: {e}", parent.display());
                return (StatusCode::BAD_REQUEST, format!("cannot create/access parent_path: {e}")).into_response();
            }
            parent
        }
        None => s.projects_root.as_ref().clone(),
    };
    // In deploy la cartella DEVE esistere già: il conflitto non è un errore.
    if !q.deploy && s.known_projects.get_path(&safe_name).await.is_some() {
        return (
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({ "name": safe_name })),
        ).into_response();
    }
    let target = parent_dir.join(&safe_name);
    if !q.deploy && tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return (
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({ "name": safe_name })),
        ).into_response();
    }
    if let Err(e) = tokio::fs::create_dir_all(&target).await {
        warn!("upload_project_zip: mkdir {}: {e}", target.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create project dir").into_response();
    }

    // 4. Extract every file from the ZIP into the project folder.
    //    We trust the manifest.json name and skip it; everything else lands at
    //    its relative path under `target`. We refuse `..` components.
    let file_names: Vec<String> = archive.file_names().map(|n| n.to_string()).collect();
    // Rollback: solo per una cartella creata da noi adesso. In deploy la cartella
    // conteneva già `.history/` & co. e cancellarla vanificherebbe tutto il fix.
    let rollback = |target: std::path::PathBuf, deploy: bool| async move {
        if !deploy {
            let _ = tokio::fs::remove_dir_all(&target).await;
        }
    };
    for entry_name in &file_names {
        if entry_name == "manifest.json" {
            continue; // metadata only — not needed on disk
        }
        // Deploy: gli utenti del dispositivo non si toccano. Preservarli alla
        // cancellazione non basterebbe — il bundle contiene `users.yaml` e
        // l'estrazione lo riscriverebbe comunque, chiudendo fuori dal pannello
        // chi lo stava usando.
        if q.deploy && entry_name == "users.yaml" {
            info!("deploy: users.yaml dello ZIP ignorato — account del dispositivo preservati");
            continue;
        }
        // Safety: reject traversal paths.
        if entry_name.contains("..") || entry_name.starts_with('/') {
            warn!("upload_project_zip: skipping suspicious entry '{entry_name}'");
            continue;
        }
        let dest = target.join(entry_name);
        // Ensure parent dirs exist (e.g. synoptics/).
        if let Some(parent) = dest.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                warn!("upload_project_zip: mkdir {}: {e}", parent.display());
                rollback(target.clone(), q.deploy).await;
                return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create subdirectory")
                    .into_response();
            }
        }
        match read_zip_entry(&mut archive, entry_name) {
            Ok(Some(bytes)) => {
                if let Err(e) = tokio::fs::write(&dest, bytes).await {
                    warn!("upload_project_zip: write {entry_name}: {e}");
                    rollback(target.clone(), q.deploy).await;
                    return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
                }
            }
            Ok(None) => { /* entry disappeared between listing and reading — skip */ }
            Err(e) => {
                warn!("upload_project_zip: read {entry_name}: {e}");
                rollback(target.clone(), q.deploy).await;
                return (StatusCode::INTERNAL_SERVER_ERROR, "zip read failed").into_response();
            }
        }
    }

    s.known_projects.touch(&safe_name, &target).await;
    info!(name = %safe_name, "project created from uploaded ZIP");
    (StatusCode::CREATED, Json(serde_json::json!({ "name": safe_name }))).into_response()
}

/// Read a named entry from a ZipArchive into a byte vector.
/// Returns `Ok(None)` if the entry does not exist.
fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> zip::result::ZipResult<Option<Vec<u8>>> {
    match archive.by_name(name) {
        Ok(mut entry) => {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            Ok(Some(buf))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(e),
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────


/// `PUT /api/auth/users-file` — sostituisce `users.yaml` del progetto attivo con
/// il corpo della richiesta (YAML), poi ricarica lo store di autenticazione.
///
/// È il lato ricevente di "Aggiorna utenti sul dispositivo": il deploy non tocca
/// più gli account, quindi serve un modo dichiarato per allinearli. Si trasferisce
/// il file, che contiene gli hash Argon2 — le password restano ignote a chi lo
/// spedisce.
///
/// Due rifiuti deliberati, entrambi perché il danno sarebbe irreversibile e
/// scoperto tardi (nessuno riesce più a entrare nel pannello):
///   - YAML non valido o senza la chiave `users`;
///   - lista **vuota**, che lascerebbe il dispositivo senza account.
///
/// Ricaricare lo store invalida tutte le sessioni: chi era collegato rifà il
/// login. È inevitabile — le credenziali sono cambiate — e va detto al chiamante.
pub async fn replace_users_file(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    body: String,
) -> Response {
    let names = crate::remote::read_usernames(&body);
    if names.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "users.yaml non valido o senza utenti: rifiutato per non lasciare il dispositivo senza account.",
        ).into_response();
    }
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let path = dir.join("users.yaml");
    if let Err(e) = tokio::fs::write(&path, body.as_bytes()).await {
        warn!("replace_users_file: write {}: {e}", path.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot write users.yaml").into_response();
    }
    s.audit.log("auth.users_replaced", Some(user.username), serde_json::json!({
        "count": names.len(), "users": names.clone(),
    }));
    if let Err(e) = s.auth.swap_store(path, build_seed_accounts()).await {
        warn!("replace_users_file: swap_store: {e:#}");
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("utenti scritti ma non ricaricati: {e}"))
            .into_response();
    }
    info!(count = names.len(), "users.yaml replaced from remote — all sessions invalidated");
    (StatusCode::OK, Json(serde_json::json!({ "users": names.len() }))).into_response()
}

// ── MQTT client_id resolution ───────────────────────────────────────────────
//
// `client_id` in project.yaml is a literal string, identical on every
// instance that opens the project — IDE included. Deploying the same
// project to several devices (or testing from the IDE while a device is
// live) makes them all connect to the broker with the exact same
// client_id, and the broker (standard MQTT behaviour: a new connection
// with an already-connected client_id evicts the old session) keeps
// kicking whichever side is older. Two independent opt-in mitigations,
// applied in `resolve_mqtt_client_ids` right before sources start:
//   - `random_client_id` (in project.yaml, travels with the project):
//     glues this instance's persisted `instance_id` to `client_id` as a
//     prefix/suffix, so every instance — IDE and every device — gets a
//     distinct-but-recognizable id automatically.
//   - a manual per-device override (NOT in project.yaml, see
//     `set_mqtt_client_id_override` below): lets an operator pin an exact
//     client_id on one specific device, e.g. to match a broker ACL.
// The two are mutually exclusive per source: Random wins if enabled, the
// override endpoint refuses to write one while it's on.

fn client_id_overrides_path(config_dir: &StdPath) -> PathBuf {
    config_dir.join("mqtt_client_id_overrides.yaml")
}

fn load_client_id_overrides(config_dir: &StdPath) -> std::collections::HashMap<String, String> {
    std::fs::read_to_string(client_id_overrides_path(config_dir))
        .ok()
        .and_then(|text| serde_yaml::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_client_id_overrides(
    config_dir: &StdPath,
    overrides: &std::collections::HashMap<String, String>,
) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let yaml = serde_yaml::to_string(overrides)
        .unwrap_or_default();
    std::fs::write(client_id_overrides_path(config_dir), yaml)
}

/// Applies, in place, the effective wire `client_id` of every MQTT source in
/// `sources`. Called once, right before the resolved list reaches
/// `SourceSupervisor::reload` — the supervisor itself stays generic and
/// never sees the literal project.yaml value.
fn resolve_mqtt_client_ids(
    project_name: &str,
    sources: &mut [SourceDef],
    config_dir: &StdPath,
    instance_id: &str,
) {
    let overrides = load_client_id_overrides(config_dir);
    for src in sources.iter_mut() {
        let SourceDef::Mqtt(cfg) = src else { continue };
        if cfg.random_client_id.as_ref().is_some_and(|r| r.enabled) {
            let position = cfg.random_client_id.as_ref().unwrap().position;
            cfg.client_id = match position {
                AffixPosition::Suffix => format!("{}-{instance_id}", cfg.client_id),
                AffixPosition::Prefix => format!("{instance_id}-{}", cfg.client_id),
            };
            continue;
        }
        if let Some(over) = overrides.get(&format!("{project_name}/{}", cfg.id)) {
            cfg.client_id = over.clone();
        }
    }
}

#[derive(Deserialize)]
pub struct ClientIdOverrideBody {
    #[serde(default)]
    pub client_id: Option<String>,
}

/// `PUT /api/mqtt/source/:id/client-id-override` — force a specific wire
/// `client_id` for one MQTT source, on **this device only**, without
/// touching `project.yaml`. Persisted in
/// `config_dir/mqtt_client_id_overrides.yaml` — external to the project, so
/// a redeploy doesn't silently erase it. Send `client_id: null` (or an
/// empty string) to clear a previously-set override.
///
/// Refuses (400) if the source has `random_client_id` enabled: the two
/// mechanisms are alternatives, not layered — overriding a value the
/// device already derives on its own would be confusing state to reason
/// about ("what is this device's client_id right now?" should have exactly
/// one answer).
pub async fn set_mqtt_client_id_override(
    State(s): State<AppState>,
    Path(source_id): Path<String>,
    Json(body): Json<ClientIdOverrideBody>,
) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let mut project = match Project::load(&dir) {
        Ok(p) => p,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("project parse error: {e}"))
                .into_response();
        }
    };

    let mqtt_cfg = project.sources.iter().find_map(|src| match src {
        SourceDef::Mqtt(cfg) if cfg.id == source_id => Some(cfg),
        _ => None,
    });
    let Some(cfg) = mqtt_cfg else {
        return (StatusCode::NOT_FOUND, "nessuna sorgente MQTT con questo id").into_response();
    };
    if cfg.random_client_id.as_ref().is_some_and(|r| r.enabled) {
        return (
            StatusCode::BAD_REQUEST,
            "questa sorgente ha \"Random Client ID\" attivo: disattivalo prima di impostare un override manuale",
        ).into_response();
    }

    let key = format!("{}/{source_id}", project.meta.name);
    let mut overrides = load_client_id_overrides(&s.config_dir);
    match body.client_id.as_deref().map(str::trim) {
        Some(v) if !v.is_empty() => { overrides.insert(key, v.to_string()); }
        _ => { overrides.remove(&key); }
    }
    if let Err(e) = save_client_id_overrides(&s.config_dir, &overrides) {
        warn!("set_mqtt_client_id_override: write failed: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "impossibile salvare l'override").into_response();
    }

    resolve_mqtt_client_ids(&project.meta.name, &mut project.sources, &s.config_dir, &s.instance_id);
    let (started, stopped, replaced) = s.supervisor.reload(project.sources).await;
    info!(source = %source_id, started, stopped, replaced, "mqtt client_id override applied");
    (StatusCode::OK, Json(serde_json::json!({ "applied": true }))).into_response()
}

/// Default per-project SQLite datastore injected when a project has none.
/// Stores history inside the project directory so it travels with backups.
fn default_datastore() -> DatastoreConfig {
    DatastoreConfig {
        id: "default".into(),
        label: "Storico locale".into(),
        backend: DatastoreBackendConfig::Sqlite {
            path: ".history/historian.db".into(),
        },
        retention_rows: None,
        retention_days: None,
    }
}

/// Re-read SWS_ADMIN_PASSWORD etc. from env so a freshly-opened project
/// without a `users.yaml` gets seeded. Mirrors main.rs bootstrap.
fn build_seed_accounts() -> Vec<(String, sws_auth::Role, String)> {
    use sws_auth::Role;
    let mut accounts: Vec<(String, Role, String)> = Vec::new();
    let admin_user = std::env::var("SWS_ADMIN_USER").unwrap_or_else(|_| "admin".into());
    if let Ok(pwd) = std::env::var("SWS_ADMIN_PASSWORD") {
        accounts.push((admin_user, Role::Admin, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_SUPERVISOR_PASSWORD") {
        let user = std::env::var("SWS_SUPERVISOR_USER").unwrap_or_else(|_| "supervisor".into());
        accounts.push((user, Role::Supervisor, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_OPERATOR_PASSWORD") {
        let user = std::env::var("SWS_OPERATOR_USER").unwrap_or_else(|_| "operator".into());
        accounts.push((user, Role::Operator, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_VIEWER_PASSWORD") {
        let user = std::env::var("SWS_VIEWER_USER").unwrap_or_else(|_| "viewer".into());
        accounts.push((user, Role::Viewer, pwd));
    }
    accounts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_project_name_accepts_basic() {
        assert_eq!(safe_project_name("foo").unwrap(), "foo");
        assert_eq!(safe_project_name("foo-bar_2026").unwrap(), "foo-bar_2026");
        assert_eq!(safe_project_name("  foo  ").unwrap(), "foo");
    }

    #[test]
    fn safe_project_name_rejects_traversal_and_slashes() {
        assert!(safe_project_name("").is_err());
        assert!(safe_project_name(".hidden").is_err());
        assert!(safe_project_name("..").is_err());
        assert!(safe_project_name("foo/bar").is_err());
        assert!(safe_project_name("foo\\bar").is_err());
        assert!(safe_project_name("foo:bar").is_err());
        assert!(safe_project_name(&"x".repeat(100)).is_err());
    }

    #[test]
    fn resolve_new_dir_accepts_and_joins() {
        assert_eq!(resolve_new_dir("/tmp", "nuova").unwrap(), PathBuf::from("/tmp/nuova"));
        // both sides are trimmed
        assert_eq!(resolve_new_dir("  /tmp  ", " nuova ").unwrap(), PathBuf::from("/tmp/nuova"));
    }

    #[test]
    fn resolve_new_dir_rejects_relative_parent_and_bad_names() {
        assert!(resolve_new_dir("tmp", "x").is_err());        // not absolute
        assert!(resolve_new_dir("", "x").is_err());
        assert!(resolve_new_dir("/tmp", "").is_err());
        assert!(resolve_new_dir("/tmp", "..").is_err());      // traversal
        assert!(resolve_new_dir("/tmp", "a/b").is_err());     // no nesting
        assert!(resolve_new_dir("/tmp", ".hidden").is_err());
    }
}

/// Rewrite `meta.name` in a copied `project.yaml` to match the user-chosen
/// project folder name, so the ConfigView title reflects the real project
/// name instead of the template's internal id.
async fn patch_project_name(yaml_path: &StdPath, name: &str) -> anyhow::Result<()> {
    let raw = tokio::fs::read_to_string(yaml_path).await?;
    let mut doc: serde_yaml::Value = serde_yaml::from_str(&raw)?;
    if let Some(meta) = doc.get_mut("meta") {
        meta["name"] = serde_yaml::Value::String(name.to_string());
    }
    let updated = serde_yaml::to_string(&doc)?;
    tokio::fs::write(yaml_path, updated).await?;
    Ok(())
}

#[allow(unused_imports)]
use PathBuf as _; // keep PathBuf import discoverable for future extensions
