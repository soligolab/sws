//! Multi-project endpoints — list / create / open / close / upload-zip.
//!
//! Pre-auth: these endpoints run outside the auth middleware so the
//! WelcomeScreen can show a project picker without a session token. Once
//! a project is opened, the per-project AuthState gates everything else.

use crate::global_scripts::GlobalScriptSupervisor;
use crate::notifications::NotificationSupervisor;
use crate::router::{
    active_dir, AppState, AuthUser, DerivedTagsRegistry, FunctionsRegistry, GeneratorTagsRegistry,
    RegistryCell,
};
use crate::source_supervisor::SourceSupervisor;
use crate::templates::copy_dir_all;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Cursor, Read},
    path::{Path as StdPath, PathBuf},
    sync::Arc,
};
use sws_core::{
    AffixPosition, AlarmDb, DatastoreBackendConfig, DatastoreConfig, GlobalScriptDef,
    NotificationConfig, Project, ProjectMeta, ProjectTarget, SourceDef, TagDb,
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
    // La tabella lingue del progetto che si sta aprendo: le notifiche la
    // usano per risolvere i token nel messaggio d'allarme. Fotografata qui,
    // come `notifications`, perché il supervisore vive quanto il progetto.
    languages: sws_core::LanguageTable,
) {
    // Ferma quello che sta già girando, PRIMA di sostituirlo.
    //
    // Più sotto il supervisore nuovo viene assegnato con `= Some(sc)`, che
    // sovrascrive il riferimento senza cancellare il task precedente: quello
    // resta vivo e continua a eseguire il proprio codice a tempo, per sempre.
    // I chiamanti che fermavano da soli erano quattro su cinque —
    // `system_start` (POST /api/system/start) no, e bastava premere "Avvia" due
    // volte per ritrovarsi con due supervisori attivi.
    //
    // Misurato sul WP630 il 2026-08-25: dopo aver sostituito il progetto e
    // premuto Avvia, il log mostrava 10 esecuzioni riuscite e 10 fallite ogni
    // 10 secondi — lo script nuovo e quello del progetto precedente, entrambi
    // a 1 Hz, sugli stessi tag. Su un impianto vero significa codice che
    // l'operatore crede sostituito e che invece continua a scrivere.
    //
    // La guardia sta qui e non nei chiamanti apposta: così vale anche per chi
    // verrà aggiunto domani.
    if let Some(old) = s.script_supervisor.write().await.take() {
        tracing::debug!("global script supervisor precedente fermato prima di riavviare");
        old.stop();
    }
    if let Some(old) = s.notification_supervisor.write().await.take() {
        old.stop();
    }

    // Q33: a impianto disarmato non si riavvia niente, e per la stessa ragione
    // per cui la guardia sopra sta qui — vale anche per i chiamanti di domani.
    //
    // Lo Stop dell'operatore spegne sorgenti, script globali, notifiche e
    // Telegram: `SourceSupervisor::reload` copre le prime, questo copre le
    // altre tre. Coprire solo le sorgenti avrebbe lasciato in piedi metà del
    // difetto, e la metà peggiore: uno script globale che scrive tag
    // ripartirebbe su un impianto che l'operatore crede fermo.
    //
    // Lo stop di ciò che gira sta **sopra** questo controllo e non sotto, di
    // proposito: un `start_project_services` a impianto fermo deve comunque
    // spegnere quello che trova, altrimenti un salvataggio lascerebbe vivi i
    // servizi del progetto precedente.
    if !s.supervisor.is_armed() {
        info!(
            "acquisizione ferma dall'operatore: script globali, notifiche e Telegram \
               NON riavviati (premi Avvia)"
        );
        s.py.set_telegram_sink(None);
        return;
    }

    // Il canale Telegram si crea prima dei due supervisori, così condividono
    // lo stesso sink e una riconfigurazione a caldo li aggiorna entrambi.
    let sinks = crate::telegram::restart_sender(
        s,
        notifications.as_ref().and_then(|n| n.telegram.clone()),
        (
            languages.clone(),
            // La lingua DEL CANALE Telegram (Q57): la risoluzione sta in un
            // punto solo, `lingua_per`, non ripetuta qui.
            notifications
                .as_ref()
                .map(|n| n.lingua_per(sws_core::CanaleNotifica::Telegram, &languages.default))
                .unwrap_or_else(|| languages.default.clone()),
        ),
    )
    .await;
    // Il send_telegram delle FUNZIONI passa dall'engine condiviso s.py.
    s.py.set_telegram_sink(sinks.as_ref().map(|k| k.text.clone()));
    // Le chiavi della tabella lingue, per `tr()` negli script. Qui e non
    // altrove: è lo stesso punto in cui il motore riceve il canale Telegram,
    // cioè l'unico che sa che il progetto è cambiato.
    s.py.set_chiavi_lingua(languages.entries.iter().map(|e| e.key.clone()).collect());
    if !global_scripts.is_empty() {
        let n = global_scripts.len();
        let sc = GlobalScriptSupervisor::start(
            global_scripts,
            s.db.clone(),
            s.bus.clone(),
            sinks.as_ref().map(|k| k.text.clone()),
            s.functions.clone(),
            s.py.clone(),
        );
        info!(scripts = n, "global script supervisor started");
        *s.script_supervisor.write().await = Some(sc);
    }
    // Nell'IDE niente supervisore delle notifiche: niente email, niente
    // escalation, niente Telegram — l'editor non è l'impianto (26-09-2026).
    if s.ide_only {
        info!("istanza IDE: notifiche (Telegram, email, escalation) NON avviate");
    } else if let Some(notif) = notifications {
        let ns = NotificationSupervisor::start(
            s.alarms.clone(),
            notif,
            sinks.map(|k| k.messages),
            languages,
        );
        info!("notification supervisor started");
        *s.notification_supervisor.write().await = Some(ns);
    }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ProjectListEntry {
    pub name: String,
    /// `<azienda>/<nome>`, con `-` per l'azienda implicita: è **l'indirizzo**
    /// del progetto, quello che va nelle rotte. Il nome da solo non basta più
    /// da quando due aziende possono avere un «impianto» ciascuna.
    pub riferimento: String,
    /// Il nome dell'azienda a cui appartiene, quando non e quella implicita.
    /// `None` = l'azienda implicita, cioe «questa installazione»: la
    /// schermata non deve nominarla, perche chi ha un impianto solo non ha
    /// motivo di sapere che esiste il concetto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub azienda: Option<String>,
    /// Vero quando il progetto sta in un'azienda a cui chi guarda **non**
    /// appartiene. Puo capitare solo a un amministratore di piattaforma: a
    /// tutti gli altri questi progetti non arrivano proprio.
    ///
    /// Serve alla schermata per tenerli in una sezione a parte e contrassegnarli
    /// (scelta del maintainer, 07-10-2026): vederli e utile per l'assistenza,
    /// confonderli con i propri no.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub altra_azienda: bool,
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
    /// Quanto pesa lo storico (`history/`) del progetto, in byte (03-10-2026):
    /// l'IDE lo dice prima di un deploy che sostituirebbe questo progetto.
    /// Assente da un runtime più vecchio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storico_byte: Option<u64>,
}

/// La somma dei file in `<progetto>/history/` (un livello: lì ci sono solo i
/// database e le loro copie). `None` se la cartella non c'è.
fn peso_storico(progetto: &StdPath) -> Option<u64> {
    let rd = std::fs::read_dir(progetto.join("history")).ok()?;
    Some(rd.flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct CreateProjectRequest {
    pub name: String,
    /// La lingua principale del progetto nuovo: quella dell'IDE di chi lo crea.
    ///
    /// Fino al 18-09-2026 un progetto vuoto nasceva con `languages.default: ''`
    /// e nessuna lingua: il maintainer, creando un allarme prima di aver
    /// aperto la scheda Lingue, non trovava poi il messaggio in tabella — e
    /// ogni `select` che offre le lingue del progetto era vuoto. Un progetto
    /// che nasce senza lingua è un progetto che non può ancora dire niente.
    #[serde(default)]
    pub lang: Option<String>,
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
    /// L'azienda a cui il progetto appartiene. Il server ne ricava la
    /// cartella: il client non manda mai un percorso per questa strada, cosi
    /// non c'e un secondo modo di dire dove va un progetto.
    #[serde(default)]
    pub azienda_id: Option<i64>,
    /// Target di rendering scelto nel wizard (Web/LVGL). `None` = Web,
    /// comportamento invariato. Solo per progetti vuoti (`template: None`) —
    /// i progetti da template restano sempre Web per ora, vedi ADR 0002.
    #[serde(default)]
    pub target: Option<ProjectTarget>,
}

#[derive(Serialize)]
pub struct OpenProjectResponse {
    pub name: String,
    /// Vero solo se le credenziali sono quelle del **progetto**: aprirne uno
    /// ne cambia l'elenco degli utenti e azzera quelle sessioni. Per chi usa
    /// le credenziali dell'**installazione** non cambia niente, e dirgli di
    /// riautenticarsi sarebbe falso.
    pub must_login: bool,
}

// ── safe_project_name ────────────────────────────────────────────────────────

/// `p` sta dentro `radice`? Restituisce il percorso **canonico** di `p`, o il
/// motivo del rifiuto.
///
/// Q46 (2026-09-09): il selettore di cartelle della WelcomeScreen e `parent_path`
/// non escono più dalla cartella dei progetti. Prima `browse-dirs` partiva da
/// `$HOME` e accettava qualunque percorso assoluto — pre-auth, sul router
/// completo: chiunque raggiungesse la porta poteva elencare il disco.
///
/// Si confronta dopo `canonicalize`, non sulle stringhe: `radice/../etc` è una
/// stringa che «comincia con» la radice e un percorso che ne esce; un link
/// simbolico dentro la radice che punta fuori idem. Il percorso deve esistere
/// per essere canonicalizzato — è voluto: qui si elencano e si scelgono cartelle
/// che ci sono, e chi ne crea una passa da `dentro_radice_nuovo`.
pub(crate) fn dentro_radice(
    radice: &std::path::Path,
    p: &std::path::Path,
) -> Result<PathBuf, &'static str> {
    let radice_c = radice
        .canonicalize()
        .map_err(|_| "la cartella dei progetti non esiste")?;
    let p_c = p.canonicalize().map_err(|_| "la cartella non esiste")?;
    if p_c == radice_c || p_c.starts_with(&radice_c) {
        Ok(p_c)
    } else {
        Err("fuori dalla cartella dei progetti")
    }
}

/// Come `dentro_radice`, per un percorso che **non esiste ancora**: si
/// canonicalizza il genitore (che deve esistere) e si riattacca l'ultimo
/// segmento, che deve essere un nome semplice.
pub(crate) fn dentro_radice_nuovo(
    radice: &std::path::Path,
    p: &std::path::Path,
) -> Result<PathBuf, &'static str> {
    let nome = p.file_name().ok_or("nome della cartella mancante")?;
    if nome == ".." || nome == "." {
        return Err("nome della cartella non valido");
    }
    let genitore = p.parent().ok_or("percorso senza genitore")?;
    let genitore_c = dentro_radice(radice, genitore)?;
    Ok(genitore_c.join(nome))
}

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
        if matches!(
            c,
            '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        ) {
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
pub async fn list_projects(
    State(s): State<AppState>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
) -> Response {
    let root: &StdPath = s.projects_root.as_path();
    // Indicizzata per **riferimento**, non per nome: con le cartelle per
    // azienda due progetti possono chiamarsi uguale, e una mappa per nome ne
    // perderebbe uno in silenzio — che è esattamente il guasto da chiudere.
    let mut per_riferimento: std::collections::HashMap<String, ProjectListEntry> =
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
                let riferimento = crate::project_registry::riferimento(
                    crate::project_registry::AZIENDA_IMPLICITA,
                    &name,
                );
                per_riferimento.insert(
                    riferimento.clone(),
                    ProjectListEntry {
                        name,
                        riferimento,
                        azienda: None,
                        altra_azienda: false,
                        has_project_yaml: true,
                        last_modified_ms,
                        path: path.to_string_lossy().to_string(),
                        last_opened_ms: None,
                        external: false,
                        storico_byte: None,
                    },
                );
            }
        }
        Err(e) => warn!("list_projects: cannot read {}: {e}", root.display()),
    }

    // 1b. Le cartelle delle aziende, un livello piu sotto.
    //
    // L'azienda IMPLICITA ha la cartella vuota, cioe la radice stessa: i suoi
    // progetti li ha gia trovati la scansione qui sopra, e non si sposta
    // niente su un'installazione che esisteva gia. Le altre aziende hanno una
    // sottocartella, e si scandisce quella.
    if let Some(identita) = s.identita.as_ref() {
        for azienda in identita.elenca_aziende().await.unwrap_or_default() {
            if azienda.cartella.is_empty() {
                continue; // implicita: e la radice, gia fatta
            }
            let dir_azienda = root.join(&azienda.cartella);
            let Ok(mut dir) = tokio::fs::read_dir(&dir_azienda).await else {
                continue; // nessun progetto ancora: la cartella puo non esserci
            };
            while let Ok(Some(entry)) = dir.next_entry().await {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()).map(String::from) else {
                    continue;
                };
                if name.starts_with('.') {
                    continue;
                }
                let Ok(meta) = tokio::fs::metadata(&path).await else { continue };
                if !meta.is_dir() {
                    continue;
                }
                if !tokio::fs::try_exists(path.join("project.yaml")).await.unwrap_or(false) {
                    continue;
                }
                let last_modified_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                let riferimento =
                    crate::project_registry::riferimento(&azienda.cartella, &name);
                per_riferimento.insert(
                    riferimento.clone(),
                    ProjectListEntry {
                        name,
                        riferimento,
                        azienda: Some(azienda.nome.clone()),
                        altra_azienda: false,
                        has_project_yaml: true,
                        last_modified_ms,
                        path: path.to_string_lossy().to_string(),
                        last_opened_ms: None,
                        external: false,
                        storico_byte: None,
                    },
                );
            }
        }
    }

    // 2. Registry entries — covers projects created/opened at a custom
    //    parent_path (never found by the scan above), and refreshes
    //    last_opened_ms/path for anything the scan already picked up.
    for (rif, reg_entry) in s.known_projects.snapshot().await {
        let yaml_path = reg_entry.path.join("project.yaml");
        if !tokio::fs::try_exists(&yaml_path).await.unwrap_or(false) {
            // Stale entry (folder moved/deleted outside SWS) — skip rather
            // than show a dead link in the welcome list.
            continue;
        }
        // Stessa regola di `is_external`, non una seconda copia: prima qui
        // c'era `parent() != Some(root)` ripetuto a mano, e con le cartelle
        // per azienda avrebbe detto «esterno» per ogni progetto d'azienda.
        let external = is_external(&reg_entry.path, root);
        // L'azienda si ricava dalla cartella: il percorso E il fatto, quindi
        // non c'e un secondo posto da tenere allineato.
        let azienda_reg = per_riferimento.get(&rif).and_then(|e| e.azienda.clone());
        // Il nome e la coda del riferimento. Una chiave senza barra non
        // dovrebbe esistere dopo la migrazione del registro: se c'e, la si
        // tratta come implicita invece di lasciare una voce senza nome.
        let name = match rif.split_once('/') {
            Some((_, n)) => n.to_string(),
            None => rif.clone(),
        };
        let last_modified_ms = tokio::fs::metadata(&reg_entry.path)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        per_riferimento.insert(
            rif.clone(),
            ProjectListEntry {
                name,
                riferimento: rif,
                azienda: azienda_reg,
                altra_azienda: false,
                has_project_yaml: true,
                last_modified_ms,
                path: reg_entry.path.to_string_lossy().to_string(),
                last_opened_ms: Some(reg_entry.last_opened_ms),
                external,
                storico_byte: None,
            },
        );
    }

    let mut entries: Vec<ProjectListEntry> = per_riferimento.into_values().collect();
    marca_e_filtra_per_appartenenza(&s, chi.map(|e| e.0), &mut entries).await;
    for e in &mut entries {
        e.storico_byte = peso_storico(StdPath::new(&e.path));
    }
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

/// Le aziende di chi sta guardando, lette una volta sola.
///
/// Nomi **e** cartelle insieme: l'elenco ragiona per nome (e quello che si
/// mostra), l'indirizzo di un progetto ragiona per cartella (e quello che sta
/// sul disco). Due chiavi diverse della stessa cosa, prese dalla stessa
/// lettura — perche prenderle da due letture e il modo in cui iniziano a non
/// combaciare.
#[derive(Default)]
pub struct Appartenenze {
    pub nomi: Vec<String>,
    pub cartelle: Vec<String>,
    /// Gli id di **tutte** le aziende di cui fa parte, con qualunque ruolo.
    pub ids: Vec<i64>,
    /// Gli id di quelle che **amministra**. Sottoinsieme di `ids`.
    ///
    /// E questo, non `ids`, a decidere chi entra nella console e cosa ci
    /// vede: essere sviluppatore di un'azienda non da' nessun titolo ad
    /// amministrarla.
    pub amministrate: Vec<i64>,
    /// Se fa parte dell'azienda implicita, cioe della radice.
    pub implicita: bool,
    /// Se non c'e `identita`, o se chi guarda non e un utente
    /// dell'installazione (admin sintetico, utente di progetto): allora non
    /// si filtra e non si nega niente, come e sempre stato sul dispositivo.
    pub fuori_dal_modello: bool,
}

pub async fn appartenenze_di(s: &AppState, chi: Option<&crate::router::AuthUser>) -> Appartenenze {
    let fuori = Appartenenze { fuori_dal_modello: true, ..Default::default() };
    let (Some(identita), Some(chi)) = (s.identita.as_ref(), chi) else {
        return fuori;
    };
    let Ok(utenti) = identita.elenca().await else { return fuori };
    let Some(io) = utenti.iter().find(|u| u.email == chi.username) else {
        return fuori;
    };
    let tutte = identita.elenca_aziende().await.unwrap_or_default();
    let mut a = Appartenenze::default();
    for (aid, ruolo) in identita.aziende_di(io.id).await.unwrap_or_default() {
        if let Some(az) = tutte.iter().find(|x| x.id == aid) {
            if az.cartella.is_empty() {
                a.implicita = true;
            } else {
                a.cartelle.push(az.cartella.clone());
            }
            a.nomi.push(az.nome.clone());
            a.ids.push(az.id);
            if ruolo == sws_identita::Ruolo::Amministratore {
                a.amministrate.push(az.id);
            }
        }
    }
    a
}

/// Un progetto risolto da un riferimento `<azienda>/<nome>`.
pub struct Progetto {
    /// La chiave con cui lo conosce il registro: `<azienda>/<nome>`.
    pub chiave: String,
    pub nome: String,
    pub dir: PathBuf,
}

/// Dall'indirizzo al progetto, **passando dall'autorizzazione**.
///
/// È l'unico punto da cui si risale da un riferimento a una cartella, e lo è
/// di proposito. Prima ogni rotta prendeva un nome e lo risolveva da sé:
/// l'appartenenza non la guardava nessuna, il filtro viveva solo
/// nell'**elenco**, e un elenco non è una guardia — chi conosceva il nome di
/// un progetto di un'altra azienda lo apriva lo stesso.
///
/// **404 e non 403** quando l'azienda non è tua: un 403 confermerebbe che quel
/// progetto esiste, che è precisamente la cosa che non deve sapere. Chi
/// amministra la piattaforma passa comunque, come nell'elenco.
pub async fn risolvi_progetto(
    s: &AppState,
    chi: Option<&crate::router::AuthUser>,
    azienda: &str,
    nome: &str,
) -> Result<Progetto, Response> {
    let nome = safe_project_name(nome)
        .map_err(|m| (StatusCode::BAD_REQUEST, m).into_response())?;
    // Il segmento dell'azienda passa dallo stesso setaccio del nome: è un
    // pezzo di percorso quanto l'altro, e `..` qui varrebbe `..` lì.
    if azienda != crate::project_registry::AZIENDA_IMPLICITA {
        safe_project_name(azienda)
            .map_err(|m| (StatusCode::BAD_REQUEST, format!("azienda: {m}")).into_response())?;
    }
    let chiave = crate::project_registry::riferimento(azienda, &nome);

    let app = appartenenze_di(s, chi).await;
    if !app.fuori_dal_modello {
        // **La stessa funzione dell'elenco**, con la chiave che serve qui.
        // `visibilita` non sa se le stai dando nomi o cartelle: sa dire se
        // quell'azienda è tua. Scriverne una seconda versione per le cartelle
        // vorrebbe dire due regole da tenere d'accordo, e una delle due
        // prima o poi resterebbe indietro — che è esattamente come è nato il
        // buco che questo risolutore chiude.
        let segmento = (azienda != crate::project_registry::AZIENDA_IMPLICITA).then_some(azienda);
        let piattaforma = chi.is_some_and(|c| c.amministratore_piattaforma);
        if visibilita(segmento, &app.cartelle, app.implicita, piattaforma).is_none() {
            return Err((StatusCode::NOT_FOUND, "project not found").into_response());
        }
    }

    // Il registro per primo: copre i progetti «esterni», che stanno fuori
    // dalla radice e che nessuna scansione troverebbe.
    let dir = match s.known_projects.get_path(&chiave).await {
        Some(p) => p,
        None if azienda == crate::project_registry::AZIENDA_IMPLICITA => {
            s.projects_root.join(&nome)
        }
        None => s.projects_root.join(azienda).join(&nome),
    };
    Ok(Progetto { chiave, nome, dir })
}

// ── Le forme a UN segmento: `/api/projects/<nome>/...` ───────────────────────
//
// Restano, e non per nostalgia. L'IDE distribuisce su **dispositivi**, e un
// dispositivo con un runtime più vecchio conosce solo questa forma: è quella
// che `remote.rs` gli manda. Toglierla qui romperebbe il deploy verso ogni
// pannello non ancora aggiornato — e su un pannello le aziende non esistono
// comunque, c'è un progetto solo.
//
// **Non è una scorciatoia che salta i controlli**: un segmento solo vuol dire
// azienda implicita, e da lì in poi è la stessa strada, stesso risolutore,
// stessa verifica di appartenenza.

/// Avvisa quando la forma vecchia arriva dove non dovrebbe più arrivare.
///
/// Su un **dispositivo** è normale: aziende non ce ne sono, e `remote.rs`
/// manda esattamente questo. Su un'istanza **IDE** no — lì l'elenco porta il
/// riferimento di ogni progetto, quindi un indirizzo a un segmento solo è un
/// chiamante che non è stato aggiornato. Il guaio è che non fallisce: si
/// risolve sull'azienda implicita, e se per caso esiste un omonimo in radice
/// l'operazione riesce **sul progetto sbagliato**. Un `rename` sarebbe un
/// errore visibile, un `delete` no.
///
/// Successo il 07-10-2026 con «rinomina» dal menu dell'editor, che mandava
/// `meta.name` e basta.
fn avvisa_se_indirizzo_vecchio(s: &AppState, nome: &str) {
    if s.identita.is_some() {
        warn!(
            progetto = %nome,
            "indirizzo di progetto a un segmento su un'istanza IDE: \
             risolto sull'azienda implicita. Il chiamante dovrebbe mandare \
             «<azienda>/<nome>» — «-» per l'implicita."
        );
    }
}

pub async fn open_project_implicito(
    State(s): State<AppState>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path(nome): Path<String>,
) -> Response {
    avvisa_se_indirizzo_vecchio(&s, &nome);
    let implicita = crate::project_registry::AZIENDA_IMPLICITA.to_string();
    open_project(State(s), chi, Path((implicita, nome))).await
}

pub async fn delete_project_implicito(
    State(s): State<AppState>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path(nome): Path<String>,
    q: Query<DeleteQuery>,
) -> Response {
    avvisa_se_indirizzo_vecchio(&s, &nome);
    let implicita = crate::project_registry::AZIENDA_IMPLICITA.to_string();
    delete_project(State(s), chi, Path((implicita, nome)), q).await
}

pub async fn rename_project_implicito(
    State(s): State<AppState>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path(nome): Path<String>,
    req: Json<RenameRequest>,
) -> Response {
    avvisa_se_indirizzo_vecchio(&s, &nome);
    let implicita = crate::project_registry::AZIENDA_IMPLICITA.to_string();
    rename_project(State(s), chi, Path((implicita, nome)), req).await
}

pub async fn duplicate_project_implicito(
    State(s): State<AppState>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path(nome): Path<String>,
    req: Json<RenameRequest>,
) -> Response {
    avvisa_se_indirizzo_vecchio(&s, &nome);
    let implicita = crate::project_registry::AZIENDA_IMPLICITA.to_string();
    duplicate_project(State(s), chi, Path((implicita, nome)), req).await
}

/// Toglie dall'elenco i progetti delle aziende altrui, e contrassegna quelli
/// che restano a chi puo vederli comunque.
///
/// **Prima non c'era nessun filtro**: la scansione trovava le cartelle di
/// tutte le aziende e le serviva a chiunque fosse collegato, cioe uno
/// sviluppatore dell'azienda A vedeva — e poteva aprire — i progetti
/// dell'azienda B. Le cartelle per azienda sono nate il 07-10-2026 e il filtro
/// e nato lo stesso giorno: una separazione che si vede solo nel percorso non
/// e una separazione.
///
/// L'amministratore di piattaforma li vede **tutti**, contrassegnati
/// (decisione del maintainer, 07-10-2026): e il mestiere di chi fa assistenza,
/// e nasconderglieli lo costringerebbe a iscriversi ovunque.
///
/// Su un dispositivo non c'e `identita` e non ci sono aziende: li non si filtra
/// niente, come e sempre stato.
async fn marca_e_filtra_per_appartenenza(
    s: &AppState,
    chi: Option<crate::router::AuthUser>,
    entries: &mut Vec<ProjectListEntry>,
) {
    let piattaforma = chi.as_ref().is_some_and(|c| c.amministratore_piattaforma);
    let app = appartenenze_di(s, chi.as_ref()).await;
    if app.fuori_dal_modello {
        return; // dispositivo o admin sintetico: nessun filtro, come sempre
    }
    entries.retain_mut(|e| {
        match visibilita(e.azienda.as_deref(), &app.nomi, app.implicita, piattaforma) {
            Some(altra) => {
                e.altra_azienda = altra;
                true
            }
            None => false,
        }
    });
}

/// La regola, da sola: `None` = non si vede, `Some(altra)` = si vede, e
/// `altra` dice se va contrassegnato come di un'azienda non tua.
///
/// Funzione pura, cosi si prova senza alzare un server — stessa scelta di
/// `router::fonte_autenticazione`. Una regola di visibilita sepolta dentro un
/// handler e una regola che nessun test puo guardare.
/// `azienda` e `mie` vanno nella **stessa chiave**, e quale sia la sceglie il
/// chiamante: l'elenco ragiona per nome d'azienda (è quello che mostra),
/// l'indirizzo di un progetto per cartella (è quello che sta sul disco).
/// `None` è sempre l'azienda implicita.
pub fn visibilita(
    azienda: Option<&str>,
    mie: &[String],
    membro_implicita: bool,
    amministratore_piattaforma: bool,
) -> Option<bool> {
    let mia = match azienda {
        // Nessuna azienda = l'azienda implicita, cioe la radice stessa.
        None => membro_implicita,
        Some(nome) => mie.iter().any(|n| n == nome),
    };
    if mia {
        Some(false)
    } else if amministratore_piattaforma {
        Some(true)
    } else {
        None
    }
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
                return (
                    StatusCode::BAD_REQUEST,
                    "parent_path must be an absolute path",
                )
                    .into_response();
            }
            // Q46: il genitore deve ESISTERE e stare nella cartella dei progetti.
            // Prima qui c'era un `create_dir_all` su qualunque percorso assoluto:
            // un caller senza sessione poteva materializzare alberi di directory
            // ovunque il processo potesse scrivere.
            match dentro_radice(s.projects_root.as_ref(), &parent) {
                Ok(c) => c,
                Err(m) => {
                    return (StatusCode::BAD_REQUEST, format!("parent_path: {m}")).into_response()
                }
            }
        }
        None => match cartella_dell_azienda(&s, req.azienda_id).await {
            Ok(p) => p,
            Err(m) => return (StatusCode::BAD_REQUEST, m).into_response(),
        },
    };

    // Il riferimento del progetto nuovo. Un `parent_path` scelto a mano
    // rende il progetto «esterno», e un esterno non sta in nessuna azienda:
    // segmento implicito.
    let segmento = match req.parent_path.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(_) => crate::project_registry::AZIENDA_IMPLICITA.to_string(),
        None => segmento_dell_azienda(&s, req.azienda_id).await,
    };
    let chiave = crate::project_registry::riferimento(&segmento, &safe_name);

    // **La quota, prima di scrivere.** Si rifiuta al limite, dopo aver
    // avvisato sopra la soglia: un progetto nuovo e cio che fa crescere lo
    // spazio, quindi e qui che si ferma. Quello che gia gira non si tocca —
    // lo storico continua a scrivere, perche fermarlo perderebbe dati
    // d'impianto (decisione del maintainer, 08-10-2026).
    if let Some(rifiuto) = rifiuta_se_piena(&s, req.azienda_id).await {
        return rifiuto;
    }

    // L'unicità vale **dentro l'azienda**, non in tutta l'installazione: due
    // aziende possono avere un «impianto» ciascuna, ed è tutto il punto delle
    // cartelle per azienda. Prima la chiave era il nome nudo e la seconda
    // azienda si sentiva dire «esiste già» per un progetto che non vedeva.
    if s.known_projects.get_path(&chiave).await.is_some() {
        return (StatusCode::CONFLICT, "project already exists").into_response();
    }
    let target = parent_dir.join(&safe_name);
    if tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "project already exists").into_response();
    }

    if let Err(e) = tokio::fs::create_dir_all(&target).await {
        warn!("create_project: mkdir {}: {e}", target.display());
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot create project dir",
        )
            .into_response();
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
                return (StatusCode::INTERNAL_SERVER_ERROR, "copy template failed").into_response();
            }
            // Update meta.name in the copied project.yaml to match the user's
            // chosen name instead of the template's internal id.
            let yaml_path = target.join("project.yaml");
            // Q30: due leggi-modifica-scrivi **consecutivi** sullo stesso file,
            // il nome e poi il timbro. Il lock sta attorno a entrambi, non
            // dentro ciascuno.
            //
            // Detto onestamente: qui una corsa non è stata misurata, e non è
            // nemmeno facile — `target` è una directory appena creata, di cui
            // nessun altro conosce il percorso. Il lock c'è perché la regola
            // «ogni leggi-modifica-scrivi su un project.yaml passa da
            // project_write_lock» non abbia eccezioni da ricordare: una
            // invariante con eccezioni non la verifica nessuno.
            let _scrittura = s.project_write_lock.lock().await;
            match patch_project_name(&yaml_path, &safe_name).await {
                Ok(()) => {}
                Err(e) => {
                    warn!("create_project: patch meta.name: {e}");
                    // Non-fatal — project is usable, name just stays as template id.
                }
            }
            // Il progetto lo produce questo runtime, adesso: senza il timbro
            // l'IDE lo segnalerebbe «da aggiornare» appena creato. Non fatale
            // per lo stesso motivo del nome: un avviso di troppo è meglio di un
            // progetto non creato.
            if let Err(e) = stamp_saved_by(&yaml_path).await {
                warn!("create_project: timbro saved_by: {e}");
            }
            // Q58: gli indirizzi sono quelli dell'esempio. Il runtime non li
            // userà finché l'utente non conferma dalla scheda Sorgenti.
            if let Err(e) = segna_sorgenti_da_rivedere(&yaml_path).await {
                warn!("create_project: flag sorgenti_da_rivedere: {e}");
            }
            info!(name = %safe_name, template = template_id, "project created from template");
            // T-72: ogni progetto nasce con una pagina di boot, anche da template
            // (i template nel repo non la portano: la mette il runtime).
            if let Err(e) = crate::boot::semina(&target, false).await {
                warn!("create_project: pagina di boot: {e}");
            }
        }
        None => {
            // Write a minimal project.yaml so the welcome list sees it.
            let mut project = Project {
                meta: ProjectMeta {
                    name: safe_name.clone(),
                    version: "0.1.0".into(),
                },
                types: vec![],
                tags: vec![],
                // Progetto vuoto: sorgenti non ce ne sono, niente da rivedere.
                sorgenti_da_rivedere: false,
                sources: vec![],
                alarms: vec![],
                functions: vec![],
                custom_symbols: vec![],
                datastores: vec![default_datastore()],
                global_scripts: vec![],
                notifications: None,
                saved_by: None,
                languages: lingua_iniziale(req.lang.as_deref()),
                page_layout: None,
                target: req.target.clone(),
                auto_backup_interval_minutes: None,
                auto_backup_retention: None,
            };
            let yaml = match project.stamp_and_serialize() {
                Ok(y) => y,
                Err(e) => {
                    warn!("create_project: serialize: {e}");
                    return (StatusCode::INTERNAL_SERVER_ERROR, "serialize failed").into_response();
                }
            };
            if let Err(e) = tokio::fs::write(target.join("project.yaml"), yaml).await {
                warn!("create_project: write project.yaml: {e}");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "write project.yaml failed",
                )
                    .into_response();
            }
            info!(name = %safe_name, "project created (empty)");
            // T-72: una pagina di boot e una sinottica vuota, subito.
            if let Err(e) = crate::boot::semina(&target, true).await {
                warn!("create_project: pagine iniziali: {e}");
            }
        }
    }

    // Every created project — root-scoped or at a custom parent_path — enters
    // the known-projects registry, so the "recent projects" list picks it up
    // immediately (not just custom-path ones).
    s.known_projects.touch(&chiave, &target).await;

    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "name": safe_name, "riferimento": chiave })),
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
/// Mappa tag→scaling lineare dai `TagDef` che definiscono tutti e quattro i
/// campi raw/eng (F1). Riusata da open/import/PUT-tags per tenere allineata
/// la mappa in `TagDb` a ogni modifica delle variabili.
pub(crate) fn build_tag_scales(
    tags: &[sws_core::TagDef],
    types: &[sws_core::TypeDef],
) -> std::collections::HashMap<String, sws_core::LinearScale> {
    let scala = |raw_min, raw_max, eng_min, eng_max| match (raw_min, raw_max, eng_min, eng_max) {
        (Some(raw_min), Some(raw_max), Some(eng_min), Some(eng_max)) if raw_max != raw_min => {
            Some(sws_core::LinearScale {
                raw_min,
                raw_max,
                eng_min,
                eng_max,
            })
        }
        _ => None,
    };
    let mut out = std::collections::HashMap::new();
    for t in tags {
        // Fase 1b: per un'istanza la scala è **della foglia**, e viene dal
        // membro del tipo — così due istanze dello stesso tipo la ereditano
        // senza ripeterla.
        for f in foglie_di(t, types) {
            if let Some(m) = &f.membro {
                if let Some(s) = scala(m.raw_min, m.raw_max, m.eng_min, m.eng_max) {
                    out.insert(f.percorso.clone(), s);
                }
            }
        }
        if let Some(s) = scala(t.raw_min, t.raw_max, t.eng_min, t.eng_max) {
            out.insert(t.id.clone(), s);
        }
    }
    out
}

/// Le foglie di un tag: vuoto per un tag piatto, l'albero del tipo per
/// un'istanza. Un tipo malformato non blocca il runtime (lo dice il
/// validatore): si tratta il tag come se non avesse forma.
pub(crate) fn foglie_di(
    t: &sws_core::TagDef,
    types: &[sws_core::TypeDef],
) -> Vec<sws_core::Foglia> {
    match sws_core::Forma::da_tag(t, types) {
        Ok(Some(f)) => f.foglie(&t.id, types),
        _ => Vec::new(),
    }
}

/// Mappa tag→ruolo minimo di scrittura (F3.1), stessi punti di refresh
/// di `build_tag_scales`.
pub(crate) fn build_tag_write_roles(
    tags: &[sws_core::TagDef],
    types: &[sws_core::TypeDef],
) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for t in tags {
        if let Some(r) = &t.write_min_role {
            out.insert(t.id.clone(), r.clone());
        }
        for f in foglie_di(t, types) {
            if let Some(r) = f.membro.as_ref().and_then(|m| m.write_min_role.clone()) {
                out.insert(f.percorso.clone(), r);
            }
        }
    }
    out
}

/// Mappa tag→`data_type` dichiarato (Q27), stessi punti di refresh di
/// `build_tag_scales`. Tutti i tag ci finiscono: il default serde è "float".
pub(crate) fn build_tag_data_types(
    tags: &[sws_core::TagDef],
    types: &[sws_core::TypeDef],
) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for t in tags {
        // Per un'istanza il tipo è quello **della foglia**: è la foglia che
        // si scrive, ed è il suo tipo a dover reggere la coercizione.
        let foglie = foglie_di(t, types);
        if foglie.is_empty() {
            out.insert(t.id.clone(), t.data_type.clone());
        } else {
            for f in foglie {
                out.insert(f.percorso, f.tipo.nome());
            }
        }
    }
    out
}

/// Le radici composite e la loro forma, per il `TagDb` (Fase 1b).
pub(crate) fn build_forme(
    tags: &[sws_core::TagDef],
    types: &[sws_core::TypeDef],
) -> std::collections::HashMap<String, sws_core::Forma> {
    let mut out = std::collections::HashMap::new();
    for t in tags {
        match sws_core::Forma::da_tag(t, types) {
            Ok(Some(f)) => {
                out.insert(t.id.clone(), f);
            }
            Ok(None) => {}
            Err(e) => warn!(tag = %t.id, "forma non valida, il tag resta scalare: {e}"),
        }
    }
    out
}

/// Insieme dei tag calcolati (`TagDef::is_computed`, T-69), stessi punti di
/// refresh di `build_tag_scales`. `write_tag` li rifiuta in scrittura.
pub(crate) fn build_computed_tags(tags: &[sws_core::TagDef]) -> std::collections::HashSet<String> {
    tags.iter()
        .filter(|t| t.is_computed())
        .map(|t| t.id.clone())
        .collect()
}

/// Coppie `(tag_id, GeneratorSpec)` dei generatori attivi, stessi punti di
/// refresh di `build_tag_scales`. Letta dal supervisor a tick fisso in
/// `sws-runtime::main`.
pub(crate) fn build_generator_tags(
    tags: &[sws_core::TagDef],
) -> Vec<(String, sws_core::GeneratorSpec)> {
    tags.iter()
        .filter_map(|t| {
            t.generator
                .as_ref()
                .filter(|g| g.enabled)
                .map(|g| (t.id.clone(), g.clone()))
        })
        .collect()
}

/// Installa nel `TagDb` e nei registri **tutto** ciò che deriva da
/// `project.tags`, in un posto solo (Fase 0d del piano tag).
///
/// Fino al 22-09-2026 lo facevano sei siti a mano — apertura del progetto,
/// `PUT /api/project/tags`, import CSV, import zip, ricarica da git, chiusura
/// — e divergevano: la ricarica da git non aggiornava scale, tipi e ruoli di
/// scrittura e non toglieva i tag spariti; l'import CSV non aggiornava scale,
/// tipi e ruoli. Un progetto deployato via git con una scala nuova continuava
/// a mostrare il valore grezzo finché qualcuno non riavviava.
///
/// Cosa fa, sempre nello stesso ordine: semina i tag nuovi (valore iniziale
/// del tipo, qualità Uncertain — «non ancora letto»), toglie quelli che non
/// esistono più, poi tag calcolati, generatori, scale, ruoli di scrittura,
/// tipi e insieme dei tag calcolati. Con `tags` vuoto azzera tutto: è la
/// chiusura del progetto. Ritorna (seminati, tolti).
pub async fn apply_tags(
    db: &TagDb,
    derived_tags: &DerivedTagsRegistry,
    generator_tags: &GeneratorTagsRegistry,
    tags: &[sws_core::TagDef],
    types: &[sws_core::TypeDef],
) -> (usize, usize) {
    let prima = db.snapshot().await;
    let attuali: std::collections::HashSet<String> = prima.keys().cloned().collect();
    let nuovi: std::collections::HashSet<&str> = tags.iter().map(|t| t.id.as_str()).collect();
    // Le forme PRIMA della semina (Fase 1b): un'istanza nasce col valore
    // composito, e `set` deve già sapere che `motore1` è una radice.
    let forme = build_forme(tags, types);
    db.set_forme(forme.clone()).await;
    let mut seminati = 0;
    for t in tags.iter().filter(|t| !attuali.contains(&t.id)) {
        let iniziale = match forme.get(&t.id) {
            Some(f) => f.valore_iniziale(),
            None => t.initial_value(),
        };
        db.set(t.id.clone(), iniziale, sws_core::TagQuality::Uncertain)
            .await;
        seminati += 1;
    }
    // Un'istanza che c'era GIÀ ma la cui forma è cambiata: aggiungere un
    // membro a un tipo deve far comparire la foglia nuova su tutte le
    // istanze, senza azzerare quelle che un PLC sta scrivendo. Senza questo
    // la foglia restava invisibile fino al riavvio — misurato il 22-09-2026
    // con un import CSV che aggiungeva un membro a `Motore`.
    for t in tags.iter().filter(|t| attuali.contains(&t.id)) {
        let (Some(forma), Some(stato)) = (forme.get(&t.id), prima.get(&t.id)) else {
            continue;
        };
        let riconciliato = forma.riconcilia(&stato.value);
        // Solo se cambia davvero: `apply_tags` gira a ogni salvataggio, e un
        // `set` inutile è un aggiornamento WebSocket a tutti i client.
        if riconciliato != stato.value {
            db.set(t.id.clone(), riconciliato, stato.quality.clone())
                .await;
        }
    }
    let mut tolti = 0;
    for id in attuali.iter().filter(|id| !nuovi.contains(id.as_str())) {
        db.remove(id).await;
        tolti += 1;
    }
    *derived_tags.write().await = tags
        .iter()
        .filter_map(|t| t.expression.as_ref().map(|e| (t.id.clone(), e.clone())))
        .collect();
    *generator_tags.write().await = build_generator_tags(tags);
    db.set_scales(build_tag_scales(tags, types)).await;
    db.set_write_roles(build_tag_write_roles(tags, types)).await;
    db.set_data_types(build_tag_data_types(tags, types)).await;
    db.set_computed_tags(build_computed_tags(tags)).await;
    (seminati, tolti)
}

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
    generator_tags: &GeneratorTagsRegistry,
    functions: &FunctionsRegistry,
    config_dir: &StdPath,
    instance_id: &str,
    // Un'istanza IDE non registra dati (26-09-2026, maintainer: «perché l'IDE
    // debba registrare dati? è solo un IDE»): niente campioni e niente
    // eventi d'allarme sul disco del progetto. Il buffer in RAM dei grafici
    // dal vivo resta.
    ide_only: bool,
) -> (Option<NotificationConfig>, Vec<GlobalScriptDef>) {
    info!(
        name = %project.meta.name,
        tags = project.tags.len(),
        alarms = project.alarms.len(),
        functions = project.functions.len(),
        "project opened",
    );
    apply_tags(
        db,
        derived_tags,
        generator_tags,
        &project.tags,
        &project.types,
    )
    .await;
    // Init datastore registry before consuming the project fields.
    // Il registro di prima si ferma: senza, il suo registratore restava vivo e
    // i registratori si accumulavano a ogni apertura.
    if let Some(vecchio) = registry.read().await.as_ref() {
        vecchio.chiudi();
    }
    match DatastoreRegistry::from_project(&project, project_dir).await {
        Ok(Some(reg)) => {
            if !ide_only {
                reg.clone().spawn_recorder(db.clone());
            }
            info!(
                backends = project.datastores.len(),
                "datastore registry initialised"
            );
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
    // All history reads/writes now go to <project>/history/historian.db.
    {
        let hist_store = registry
            .read()
            .await
            .as_ref()
            .and_then(|r| r.primary_sqlite_store());
        historian.swap_store(hist_store).await;
    }
    // `load` chiude come interrotte le righe ancora aperte e le passa al
    // callback attuale, cioè allo store del progetto a cui appartenevano: va
    // chiamato **prima** di agganciare quello nuovo.
    alarms.carica(project.alarms, Some(project_dir.to_path_buf())).await;
    // Lo storico allarmi → SQLite, se c'è uno store.
    //
    // **Uno scrittore solo** (25-09-2026): dalla stessa data ogni scatto
    // riscrive la sua riga più volte (scatto, conferma, rientro), e con un
    // `tokio::spawn` per riga l'aggiornamento poteva arrivare prima
    // dell'inserimento. Un canale e un task ne tengono l'ordine; sostituendo
    // il callback il canale si chiude e il task finisce dopo aver scritto
    // ciò che aveva in coda.
    if ide_only {
        // Nell'IDE gli allarmi si valutano (li mostra l'editor), ma il loro
        // storico non si scrive: non sono eventi d'impianto.
        alarms.clear_journal_callback().await;
    } else if let Some(store) = historian.sqlite_store().await {
        // Ciò che una caduta ha lasciato aperto si chiude come interrotto,
        // prima che gli allarmi di questo giro comincino a scrivere — tranne
        // gli scatti che `carica` ha appena ripreso, ancora in corso.
        let vive = alarms.eventi_aperti().await;
        let chiuse = store.chiudi_eventi_interrotti(sws_core::now_ms(), &vive).await;
        if chiuse > 0 {
            info!(chiuse, "storico allarmi: righe rimaste aperte chiuse come interrotte");
        }
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<sws_core::AlarmEvent>();
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
                store.upsert_alarm_event(&ev).await;
            }
        });
        alarms
            .set_journal_callback(move |ev| {
                let _ = tx.send(ev);
            })
            .await;
    } else {
        alarms.clear_journal_callback().await;
    }
    resolve_mqtt_client_ids(
        &project.meta.name,
        &mut project.sources,
        config_dir,
        instance_id,
    );
    // Q58: un progetto nato da un template porta gli indirizzi dell'esempio.
    // Finché una persona non li ha guardati, non ci si collega — e lo si dice,
    // perché un silenzio qui sembrerebbe un guasto.
    if project.sorgenti_da_rivedere {
        let quante = project.sources.len();
        supervisor.reload(vec![]).await;
        info!(
            progetto = %project.meta.name,
            sorgenti = quante,
            "sorgenti NON avviate: il progetto viene da un template e gli indirizzi \
             non li ha ancora confermati nessuno — Configurazione → Sorgenti → «Ho \
             controllato gli indirizzi»"
        );
    } else {
        supervisor.reload(project.sources).await;
    }
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
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path((azienda, nome)): Path<(String, String)>,
) -> Response {
    // Un solo cambio-progetto alla volta: vedi `AppState::project_switch_lock`.
    let _switch = s.project_switch_lock.lock().await;
    let p = match risolvi_progetto(&s, chi.as_ref().map(|e| &e.0), &azienda, &nome).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    let (safe_name, chiave, project_dir) = (p.nome, p.chiave, p.dir);
    if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
        return (StatusCode::NOT_FOUND, "project not found").into_response();
    }
    {
        // Q30: la migrazione riscrive project.yaml (il percorso SQLite di
        // default) con un leggi-modifica-scrivi. Tiene già
        // `project_switch_lock`: l'ordine è switch → write, ed è quello
        // giusto — vedi `AppState::project_write_lock`.
        let _scrittura = s.project_write_lock.lock().await;
        migrate_legacy_project_dirs(&project_dir);
        if let Some(n) = migra_segreti_se_serve(&project_dir) {
            s.audit.log(
                "project.change",
                None,
                serde_json::json!({"what": "secrets_migrated", "count": n}),
            );
        }
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
    // This ensures every project records history into its own history/
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
    // Messo da parte, non buttato: se si riapre lo stesso progetto (un deploy
    // fa chiudi → sostituisci → riapri) gli allarmi riprendono il loro stato.
    s.alarms.chiudi().await;
    s.functions.write().await.clear();
    s.derived_tags.write().await.clear();
    s.generator_tags.write().await.clear();
    s.recipe_log.write().await.clear();

    // Point the OPC-UA plugin at this project's PKI dir so cert + key
    // travel with the project (back up + restore included).
    s.supervisor
        .set_pki_root(project_dir.join("opcua-pki"))
        .await;

    // 3. Apply the new project.
    // La tabella lingue serve alle notifiche e `apply_loaded_project` consuma
    // `project`: si copia prima.
    let languages = project.languages.clone();
    let (notifications, global_scripts) = apply_loaded_project(
        &project_dir,
        project,
        &s.db,
        &s.registry,
        &s.historian,
        &s.alarms,
        &s.supervisor,
        &s.derived_tags,
        &s.generator_tags,
        &s.functions,
        &s.config_dir,
        &s.instance_id,
        s.ide_only,
    )
    .await;
    start_project_services(&s, notifications, global_scripts, languages).await;

    // 4. Swap auth store. Drops all sessions → forces re-login.
    if let Err(e) = s
        .auth
        .swap_store(project_dir.join("users.yaml"), seed)
        .await
    {
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

    // Progetto diverso da quello di prima: chi ne sta disegnando una pagina
    // deve ricominciare da capo (Q20).
    //
    // **Dopo** la riga qui sopra, non prima. Il segnale non si limita a
    // svegliare i viewer: pubblica anche quale motore il progetto vuole a
    // schermo (Q25), e per farlo legge `project_dir`. Segnalando prima, quel
    // pezzo leggeva la directory *precedente* — su un dispositivo appena
    // installato `None`, e non pubblicava niente.
    //
    // Effetto misurato sul WP630 il 2026-08-28: si caricava un progetto LVGL e
    // il pannello restava sulla schermata di prima. Nessun errore: il file
    // la commutazione dello schermo semplicemente non partiva.
    crate::router::signal_project_changed(&s, "open");

    // Every successful open — not just creation — refreshes last_opened_ms,
    // which is what makes this a "recent projects" list rather than just a
    // "created projects" list.
    s.known_projects.touch(&chiave, &project_dir).await;

    // `must_login` solo quando le credenziali sono quelle del PROGETTO.
    //
    // Aprire un progetto fa `swap_store`, che azzera le sessioni di
    // `sws-auth` — ed e giusto, perche cambiando progetto cambia l'elenco di
    // chi puo entrare. Ma la sessione di chi usa l'IDE vive nell'archivio
    // dell'INSTALLAZIONE, che con il progetto non c'entra: dichiararla
    // scaduta era falso, e il maintainer si e trovato a riautenticarsi
    // all'apertura di ogni progetto, con una sessione appena creata
    // (07-10-2026).
    let deve_riautenticarsi = crate::router::fonte_auth_corrente(&s).await
        == crate::router::FonteAutenticazione::Progetto;

    Json(OpenProjectResponse {
        name: safe_name,
        must_login: deve_riautenticarsi,
    })
    .into_response()
}

/// `POST /api/projects/close` — close the active project.
/// Drops TagDb / AlarmDb / supervisor sources / functions / auth.
/// All sessions become invalid.
pub async fn close_project(State(s): State<AppState>) -> Response {
    let _switch = s.project_switch_lock.lock().await;
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
    // Nessun tag: azzera scale, ruoli, tipi, calcolati, derivati e generatori.
    apply_tags(&s.db, &s.derived_tags, &s.generator_tags, &[], &[]).await;
    s.historian.swap_store(None).await; // RAM-only between projects
    // Messo da parte, non buttato: se si riapre lo stesso progetto (un deploy
    // fa chiudi → sostituisci → riapri) gli allarmi riprendono il loro stato.
    s.alarms.chiudi().await;
    s.functions.write().await.clear();
    s.recipe_log.write().await.clear();
    if let Some(vecchio) = s.registry.read().await.as_ref() {
        vecchio.chiudi();
    }
    *s.registry.write().await = None;
    s.auth.clear().await;
    *s.project_dir.write().await = None;
    info!("project closed");
    StatusCode::NO_CONTENT.into_response()
}

// ── Delete / Rename / Duplicate ───────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct RenameRequest {
    pub new_name: String,
}

/// A project's directory is "external" when it doesn't live directly under
/// `projects_root` (i.e. it was created at a maintainer-chosen custom
/// `parent_path`). Derived from the path rather than stored, so there's
/// nothing to keep in sync.
fn is_external(dir: &StdPath, root: &StdPath) -> bool {
    // `starts_with` e non «il genitore e la radice», dal 07-10-2026: con i
    // progetti sotto la cartella dell'azienda — `<radice>/<azienda>/<nome>` —
    // il genitore non e piu la radice, e la vecchia regola avrebbe dichiarato
    // **esterni tutti i progetti di ogni azienda**. Non un errore cosmetico:
    // «esterno» governa la cancellazione (toglie solo dal registro e lascia i
    // file), la rinomina (non muove la cartella) e la duplicazione (accanto
    // all'originale). Tutti e tre avrebbero cambiato comportamento in silenzio.
    //
    // Esterno resta quello che e sempre stato: un progetto registrato che vive
    // FUORI dalla radice dei progetti, creato prima che Q46 lo impedisse.
    !dir.starts_with(root)
}

/// La cartella in cui va un progetto di quell'azienda, creandola se manca.
///
/// L'azienda **implicita** ha la cartella vuota, cioe la radice stessa: su
/// un'installazione che esisteva gia i progetti restano dove sono, e le
/// aziende nuove nascono in sottocartelle accanto a loro. Una migrazione che
/// non muove dati e una migrazione che non puo perderli.
///
/// Senza `azienda_id` si usa la radice, che e il comportamento di sempre.
/// Lo spazio di una cartella, diviso fra **storico** e tutto il resto.
///
/// Ricorsiva e sincrona: va chiamata in `spawn_blocking`, perché su un disco
/// lento e con molti progetti non deve tenere occupato l'esecutore asincrono.
///
/// **Conta i byte dei file, non lo spazio occupato sul disco.** Non è lo
/// stesso numero: il filesystem assegna blocchi interi e ogni cartella costa
/// un inode, quindi `du` dà sempre di più. Misurato il 09-10-2026:
///
/// | progetto | byte dei file | sul disco | scarto |
/// |---|---|---|---|
/// | con storico vero, 84 MB | 84,2 MB | 84,3 MB | **0%** |
/// | quasi vuoto | 0,04 MB | 0,07 MB | 47% |
///
/// Lo scarto conta solo sui progetti praticamente vuoti, che non si avvicinano
/// a una quota in gigabyte. Su un progetto vero i due numeri coincidono, e
/// contare i byte è più semplice e non dipende dal filesystem.
///
/// Lo si scrive perché inganna: provando le quote con progetti da pochi
/// kilobyte, una soglia calcolata con `du` non scatta mai — e sembra un
/// difetto del controllo.
///
/// Lo spacco non è un vezzo: chi arriva al limite ci arriva quasi sempre per
/// lo storico, che cresce da solo nel tempo mentre i sinottici no. Dire «sei
/// pieno» senza dire di cosa non aiuta a decidere cosa cancellare.
pub fn pesa_cartella(dir: &StdPath) -> (u64, u64) {
    let (mut progetti, mut storico) = (0u64, 0u64);
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    for e in rd.flatten() {
        let Ok(tipo) = e.file_type() else { continue };
        if tipo.is_dir() {
            // `history/` è lo storico, ovunque si trovi nell'albero: è il
            // nome che il runtime usa per i suoi database.
            let (p, st) = pesa_cartella(&e.path());
            if e.file_name() == "history" {
                storico += p + st;
            } else {
                progetti += p;
                storico += st;
            }
        } else if let Ok(m) = e.metadata() {
            progetti += m.len();
        }
    }
    (progetti, storico)
}

/// Lo spazio occupato da un'azienda: `(progetti, storico)`.
///
/// L'azienda **implicita** è la radice stessa, quindi le sue sottocartelle
/// che appartengono ad altre aziende vanno saltate — altrimenti il suo totale
/// conterrebbe anche quello di tutte le altre, e la sua quota scatterebbe per
/// colpa dei vicini.
pub fn spazio_di_azienda(
    radice: &StdPath,
    azienda: &sws_identita::Azienda,
    tutte: &[sws_identita::Azienda],
) -> (u64, u64) {
    if !azienda.cartella.is_empty() {
        return pesa_cartella(&radice.join(&azienda.cartella));
    }
    let (mut p, mut st) = (0u64, 0u64);
    let Ok(rd) = std::fs::read_dir(radice) else {
        return (0, 0);
    };
    for e in rd.flatten() {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let nome = e.file_name().to_string_lossy().to_string();
        if tutte.iter().any(|x| !x.cartella.is_empty() && x.cartella == nome) {
            continue;
        }
        let (pp, ss) = pesa_cartella(&e.path());
        p += pp;
        st += ss;
    }
    (p, st)
}

/// Sopra quale frazione della quota si **avvisa**, prima di rifiutare.
///
/// Decisione del maintainer dell'08-10-2026: avvisa prima, rifiuta al limite.
/// Un limite che arriva addosso senza che nessuno l'abbia visto avvicinarsi
/// arriva sempre mentre si sta facendo altro.
pub const SOGLIA_AVVISO: f64 = 0.85;

/// Lo stato della quota di spazio di un'azienda, per chi deve decidere.
pub struct StatoQuota {
    pub usato: u64,
    pub massimo: Option<u64>,
}

impl StatoQuota {
    /// **Assente = nessun limite, zero = niente spazio.**
    ///
    /// Sono due cose diverse e vanno lette diverse. Fino al 09-10-2026 qui
    /// `0` valeva «nessun limite», con la scusa che un'azienda a cui si
    /// concede zero spazio non puo' esistere e quindi era un errore di
    /// battitura. Ma la stessa colonna, sui **progetti aperti**, ha `0` come
    /// stato legittimo — un'azienda sospesa — e due letture opposte dello
    /// stesso valore sono il modo in cui una delle due, un giorno, viene
    /// applicata al posto sbagliato. Se ne tiene una sola: `NULL` non limita,
    /// `0` non concede.
    pub fn frazione(&self) -> Option<f64> {
        match self.massimo {
            None => None,
            // Con tetto zero qualunque uso e' oltre: si evita la divisione
            // per zero e si dice la cosa vera.
            Some(0) => Some(1.0),
            Some(m) => Some(self.usato as f64 / m as f64),
        }
    }
    pub fn piena(&self) -> bool {
        self.frazione().is_some_and(|f| f >= 1.0)
    }
    pub fn vicina(&self) -> bool {
        self.frazione().is_some_and(|f| f >= SOGLIA_AVVISO)
    }
}

/// Lo spazio di un'azienda **adesso**, misurato sul momento.
///
/// Non si usa la misura in cache della console: quella vale un minuto, ed è
/// giusta per un cruscotto che si guarda. Qui si sta decidendo se **rifiutare
/// qualcosa a qualcuno**, e un rifiuto basato su un dato vecchio è sbagliato
/// in tutte e due le direzioni — nega a chi ha appena liberato spazio, e
/// concede a chi l'ha appena riempito.
pub async fn quota_spazio(s: &AppState, azienda_id: Option<i64>) -> Option<StatoQuota> {
    let identita = s.identita.as_ref()?;
    let tutte = identita.elenca_aziende().await.ok()?;
    // Senza azienda indicata si guarda l'implicita: è lì che nasce un
    // progetto creato senza sceglierne una.
    let azienda = match azienda_id {
        Some(id) => tutte.iter().find(|a| a.id == id)?.clone(),
        None => tutte.iter().find(|a| a.implicita)?.clone(),
    };
    let massimo = azienda.max_byte.and_then(|v| u64::try_from(v).ok());
    // Nessun tetto: non c'è niente da misurare, e misurare costa. Un tetto a
    // **zero** invece e' un tetto, e il piu' stretto che ci sia.
    massimo?;
    let radice = s.projects_root.as_ref().clone();
    let tutte2 = tutte.clone();
    let (p, st) = tokio::task::spawn_blocking(move || {
        spazio_di_azienda(&radice, &azienda, &tutte2)
    })
    .await
    .ok()?;
    Some(StatoQuota { usato: p + st, massimo })
}

/// Il rifiuto, se la quota è piena. `None` = si può procedere.
///
/// **Un posto solo.** Sono due le strade che fanno nascere un progetto —
/// `create_project` e `upload_project_zip` — ed è esattamente la coppia su
/// cui Q46 aveva corretto una e dimenticato l'altra per un mese. La regola
/// sta qui, e `check_quota_progetti.sh` verifica che le attraversino
/// entrambe.
pub async fn rifiuta_se_piena(s: &AppState, azienda_id: Option<i64>) -> Option<Response> {
    let stato = quota_spazio(s, azienda_id).await?;
    if !stato.piena() {
        return None;
    }
    // L'unita segue il numero. Con «0.0 GB di 0.0 GB» il rifiuto non dice
    // niente, e un rifiuto e fatto del suo messaggio: e l'unica cosa che chi
    // lo riceve puo usare per decidere cosa fare.
    let misura = |b: u64| {
        const U: [&str; 4] = ["KB", "MB", "GB", "TB"];
        if b < 1024 {
            return format!("{b} B");
        }
        let mut v = b as f64 / 1024.0;
        let mut i = 0;
        while v >= 1024.0 && i < U.len() - 1 {
            v /= 1024.0;
            i += 1;
        }
        if v < 10.0 {
            format!("{v:.1} {}", U[i])
        } else {
            format!("{} {}", v.round(), U[i])
        }
    };
    Some(
        (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "quota_spazio",
                "detail": format!(
                    "lo spazio dell'azienda è esaurito: {} di {}. \
                     Libera spazio — spesso è lo storico — o chiedi un aumento.",
                    misura(stato.usato),
                    misura(stato.massimo.unwrap_or(0)),
                ),
            })),
        )
            .into_response(),
    )
}

/// Il segmento dell'azienda ricavato da **dove sta** il progetto.
///
/// Serve dove l'azienda non arriva come id ma come posizione sul disco —
/// l'upload, per esempio. Un progetto subito sotto la radice, o fuori dalla
/// radice del tutto, è dell'azienda implicita; uno un livello più sotto
/// appartiene alla cartella che lo contiene. Il percorso è il fatto.
pub fn segmento_da_percorso(radice: &StdPath, dir: &StdPath) -> String {
    let implicita = crate::project_registry::AZIENDA_IMPLICITA.to_string();
    let Some(genitore) = dir.parent() else { return implicita };
    if genitore == radice {
        return implicita;
    }
    match genitore.strip_prefix(radice) {
        // Esattamente un livello: `<radice>/<azienda>/<progetto>`.
        Ok(resto) if resto.components().count() == 1 => resto.to_string_lossy().to_string(),
        _ => implicita,
    }
}

/// Il **segmento** dell'azienda per un riferimento: la sua cartella, o `-`.
///
/// Gemello di [`cartella_dell_azienda`], che dà la directory: l'uno serve a
/// scrivere l'indirizzo, l'altro a scrivere sul disco, e vengono dalla stessa
/// riga del database perché siano sempre d'accordo.
async fn segmento_dell_azienda(s: &AppState, azienda_id: Option<i64>) -> String {
    let implicita = crate::project_registry::AZIENDA_IMPLICITA.to_string();
    let (Some(id), Some(identita)) = (azienda_id, s.identita.as_ref()) else {
        return implicita;
    };
    let Ok(aziende) = identita.elenca_aziende().await else {
        return implicita;
    };
    match aziende.iter().find(|a| a.id == id) {
        Some(a) if !a.cartella.is_empty() => a.cartella.clone(),
        _ => implicita,
    }
}

async fn cartella_dell_azienda(
    s: &AppState,
    azienda_id: Option<i64>,
) -> Result<PathBuf, String> {
    let radice = s.projects_root.as_ref().clone();
    let (Some(id), Some(identita)) = (azienda_id, s.identita.as_ref()) else {
        return Ok(radice);
    };
    let aziende = identita
        .elenca_aziende()
        .await
        .map_err(|e| format!("aziende: {e}"))?;
    let Some(a) = aziende.iter().find(|a| a.id == id) else {
        return Err(format!("nessuna azienda con id {id}"));
    };
    if a.cartella.is_empty() {
        return Ok(radice);
    }
    let dir = radice.join(&a.cartella);
    // Anche qui il confinamento, benche la cartella venga dal nostro
    // database e non da fuori: e una riga, e rende la regola vera senza
    // eccezioni — le eccezioni sono il modo in cui queste cose si riaprono.
    let dir = dentro_radice_nuovo(&radice, &dir).map_err(|m| format!("cartella azienda: {m}"))?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("creazione cartella azienda: {e}"))?;
    Ok(dir)
}

/// Resolve a project name to its directory: registry first (covers external
/// and any previously-touched root project), falling back to the legacy
/// `projects_root/<name>` location.
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
    /// la cartella intera — portandosi via `history/`, cioè il database storico.
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
// `images` è qui perché viaggia nel bundle: senza rimozione preventiva, le
// immagini eliminate nell'IDE resterebbero per sempre sul device dopo un
// deploy (il bundle le riporta tutte, ma non cancella quelle orfane).
// `boot` idem (T-72): le pagine di boot e i loro PNG viaggiano nel bundle, e una
// pagina eliminata nell'IDE non deve restare sul device.
const DESIGN_ARTIFACTS: &[&str] = &["project.yaml", "synoptics", "images", "boot"];

/// L'entry `users.yaml` del bundle va ignorata in estrazione?
///
/// Solo quando il chiamante l'ha chiesto esplicitamente. `None` (import) e
/// `Some(true)` (deploy che sostituisce) la scrivono entrambi.
pub(crate) fn salta_users_yaml(replace_users: Option<bool>) -> bool {
    replace_users == Some(false)
}

/// Il deploy deve **togliere** `users.yaml` dal dispositivo?
///
/// `build_export_zip` scrive l'entry solo se il file esiste (`router.rs`),
/// quindi il bundle di un progetto senza utenti non ne ha nessuna: l'estrazione
/// non può togliere niente, e senza questo passo il dispositivo terrebbe per
/// sempre gli account di un progetto precedente. «Il progetto non ha utenti» è
/// un fatto da propagare, non un'assenza da ignorare.
pub(crate) fn deve_svuotare_utenti(replace_users: Option<bool>, bundle_ha_utenti: bool) -> bool {
    replace_users == Some(true) && !bundle_ha_utenti
}

pub async fn delete_project(
    State(s): State<AppState>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path((azienda, nome)): Path<(String, String)>,
    Query(q): Query<DeleteQuery>,
) -> Response {
    let _switch = s.project_switch_lock.lock().await;
    let p = match risolvi_progetto(&s, chi.as_ref().map(|e| &e.0), &azienda, &nome).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    let (safe_name, chiave, target) = (p.nome, p.chiave, p.dir);
    if !tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Reject if the project is currently open.
    if let Ok(active) = active_dir(&s).await {
        if active == target {
            return (
                StatusCode::CONFLICT,
                "project is currently open — close it first",
            )
                .into_response();
        }
    }

    if is_external(&target, s.projects_root.as_path()) {
        s.known_projects.remove(&chiave).await;
        info!(name = %safe_name, path = %target.display(), "external project removed from list (files untouched)");
        return StatusCode::NO_CONTENT.into_response();
    }

    // Deploy: si rimuovono solo gli artefatti di progettazione. `history/` (il
    // database), `backups/`, `recipes/` e `opcua-pki/` restano dove sono: sono
    // stato del dispositivo, non del progetto che stai distribuendo.
    //
    // `users.yaml` non si tocca **qui** (dall'11-09-2026 non è più stato locale:
    // gli utenti appartengono al progetto). A deciderne è l'upload, con
    // `replace_users`, così fra la cancellazione e la scrittura il dispositivo
    // non resta mai senza account.
    // Il progetto NON viene rimosso da `known_projects`: la cartella esiste
    // ancora e sta per ricevere i file nuovi.
    if q.preserve_state {
        for name in DESIGN_ARTIFACTS {
            let path = target.join(name);
            let res = if tokio::fs::metadata(&path)
                .await
                .map(|m| m.is_dir())
                .unwrap_or(false)
            {
                tokio::fs::remove_dir_all(&path).await
            } else {
                match tokio::fs::remove_file(&path).await {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    other => other,
                }
            };
            if let Err(e) = res {
                warn!(
                    "delete_project(preserve_state): remove {}: {e}",
                    path.display()
                );
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "cannot clear design files",
                )
                    .into_response();
            }
        }
        info!(name = %safe_name, "design files cleared, local state preserved (deploy)");
        return StatusCode::NO_CONTENT.into_response();
    }

    if let Err(e) = tokio::fs::remove_dir_all(&target).await {
        warn!("delete_project: remove {}: {e}", target.display());
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot delete project dir",
        )
            .into_response();
    }
    s.known_projects.remove(&chiave).await;
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
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path((azienda, nome)): Path<(String, String)>,
    Json(req): Json<RenameRequest>,
) -> Response {
    let p = match risolvi_progetto(&s, chi.as_ref().map(|e| &e.0), &azienda, &nome).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    let (old_name, chiave_vecchia) = (p.nome, p.chiave);
    let new_name = match safe_project_name(&req.new_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    // Rinominare non cambia azienda: la chiave nuova sta nello stesso
    // segmento di quella vecchia.
    let chiave_nuova = crate::project_registry::riferimento(&azienda, &new_name);
    if old_name == new_name {
        return (
            StatusCode::BAD_REQUEST,
            "new name is the same as the current name",
        )
            .into_response();
    }
    let old_dir = p.dir;
    if !tokio::fs::try_exists(&old_dir).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // The new name must be free both in the registry and in projects_root.
    if s.known_projects.get_path(&chiave_nuova).await.is_some() {
        return (
            StatusCode::CONFLICT,
            "a project with the new name already exists",
        )
            .into_response();
    }

    if is_external(&old_dir, s.projects_root.as_path()) {
        let yaml_path = old_dir.join("project.yaml");
        // Q30: qui la corsa è vera, non teorica — rinominare il progetto
        // **aperto** mentre qualcuno salva i tag mette due leggi-modifica-scrivi
        // sullo stesso file.
        let _scrittura = s.project_write_lock.lock().await;
        if let Err(e) = patch_project_name(&yaml_path, &new_name).await {
            warn!(
                "rename_project: patch meta.name {}: {e}",
                yaml_path.display()
            );
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "cannot update project.yaml",
            )
                .into_response();
        }
        s.known_projects.rename_key(&chiave_vecchia, &chiave_nuova).await;
        info!(old = %old_name, new = %new_name, path = %old_dir.display(), "external project renamed (folder unchanged)");
        return Json(serde_json::json!({ "name": new_name })).into_response();
    }

    // **Accanto alla cartella di prima**, non nella radice. Con `projects_root`
    // un progetto di un'azienda cambiava nome e usciva dalla sua cartella,
    // finendo fra quelli di tutti: la rinomina diventava un trasloco che
    // nessuno aveva chiesto.
    let new_dir = match old_dir.parent() {
        Some(genitore) => genitore.join(&new_name),
        None => s.projects_root.join(&new_name),
    };
    if tokio::fs::try_exists(&new_dir).await.unwrap_or(false) {
        return (
            StatusCode::CONFLICT,
            "a project with the new name already exists",
        )
            .into_response();
    }
    // Q30: il lock parte **prima** dello spostamento della cartella, non solo
    // attorno al `patch_project_name` che segue. Un salvataggio in volo scrive
    // in `old_dir`: se lo spostamento gli capita in mezzo, quella scrittura
    // finisce in una directory che non esiste più. Tenerlo da qui non risolve
    // il caso in cui il salvataggio ha già risolto il percorso (quello è il
    // difetto separato annotato in Q30: `rename_project` non prende
    // `project_switch_lock`), ma serializza tutto ciò che tocca i file.
    let _scrittura = s.project_write_lock.lock().await;
    if let Err(e) = tokio::fs::rename(&old_dir, &new_dir).await {
        warn!("rename_project: rename {old_name} → {new_name}: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot rename project dir",
        )
            .into_response();
    }
    // Keep meta.name in sync with the folder/registry name — otherwise a
    // project renamed while open would keep showing its old name in the UI
    // (GET /api/project serves project.yaml as-is, never reconciled against
    // the folder it lives in).
    let yaml_path = new_dir.join("project.yaml");
    if let Err(e) = patch_project_name(&yaml_path, &new_name).await {
        warn!(
            "rename_project: patch meta.name {}: {e}",
            yaml_path.display()
        );
    }
    // If the renamed project was open, update the active pointer.
    {
        let mut lock = s.project_dir.write().await;
        if lock.as_deref() == Some(old_dir.as_path()) {
            *lock = Some(new_dir.clone());
        }
    }
    s.known_projects.remove(&chiave_vecchia).await;
    s.known_projects.touch(&chiave_nuova, &new_dir).await;
    info!(old = %chiave_vecchia, new = %chiave_nuova, "project renamed");
    Json(serde_json::json!({ "name": new_name })).into_response()
}

/// Dove nasce un progetto copiato da `src_dir` con il nome `dst_name`:
/// accanto all'originale se è esterno a `projects_root`, dentro altrimenti.
/// 409 se il nome è già preso, nel registro o sul disco. In comune fra
/// «Duplica» e il fork da un commit (`POST /api/project/git/fork`).
pub(crate) async fn cartella_nuovo_progetto(
    s: &AppState,
    src_dir: &std::path::Path,
    dst_name: &str,
) -> Result<PathBuf, Response> {
    let conflitto = || {
        (
            StatusCode::CONFLICT,
            "a project with the new name already exists",
        )
            .into_response()
    };
    // **Accanto all'originale, sempre.** Prima il ramo non-esterno diceva
    // `projects_root.join(dst_name)`: la copia di un progetto d'azienda
    // nasceva nella radice, cioe fuori dall'azienda, e l'originale e la copia
    // finivano in due posti diversi. Il genitore vale per tutti e due i casi,
    // ed e anche quello che tiene il duplicato nella stessa azienda.
    let Some(genitore) = src_dir.parent() else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "source project has no parent directory",
        )
            .into_response());
    };
    let dst_dir = genitore.join(dst_name);
    let chiave = crate::project_registry::riferimento(
        &segmento_da_percorso(s.projects_root.as_path(), &dst_dir),
        dst_name,
    );
    if s.known_projects.get_path(&chiave).await.is_some() {
        return Err(conflitto());
    }
    if tokio::fs::try_exists(&dst_dir).await.unwrap_or(false) {
        return Err(conflitto());
    }
    Ok(dst_dir)
}

/// `POST /api/projects/:name/duplicate` — copy a project to a new folder.
/// Body: `{ "new_name": "..." }`.
/// External projects are duplicated as a sibling folder next to the
/// original (same custom parent), not pulled into `projects_root`.
pub async fn duplicate_project(
    State(s): State<AppState>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
    Path((azienda, nome)): Path<(String, String)>,
    Json(req): Json<RenameRequest>,
) -> Response {
    let p = match risolvi_progetto(&s, chi.as_ref().map(|e| &e.0), &azienda, &nome).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    let (src_name, src_dir) = (p.nome, p.dir);
    let dst_name = match safe_project_name(&req.new_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    // La copia nasce **nella stessa azienda** dell'originale: duplicare non e
    // un modo di spostare un progetto da un'azienda all'altra.
    let chiave_dst = crate::project_registry::riferimento(&azienda, &dst_name);
    if !tokio::fs::try_exists(&src_dir).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let dst_dir = match cartella_nuovo_progetto(&s, &src_dir, &dst_name).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    // Q30: come `create_backup_handler`, qui il lock protegge un **lettore** —
    // duplicare mentre un salvataggio è a metà produrrebbe una copia con un
    // project.yaml troncato, e il difetto si scoprirebbe aprendo il duplicato.
    let _scrittura = s.project_write_lock.lock().await;
    if let Err(e) = copy_dir_all(&src_dir, &dst_dir, &[]).await {
        warn!("duplicate_project: copy {src_name} → {dst_name}: {e}");
        let _ = tokio::fs::remove_dir_all(&dst_dir).await;
        return (StatusCode::INTERNAL_SERVER_ERROR, "copy failed").into_response();
    }
    s.known_projects.touch(&chiave_dst, &dst_dir).await;
    info!(src = %src_name, dst = %dst_name, "project duplicated");
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "name": dst_name })),
    )
        .into_response()
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
/// subdirectories of `path` (or `projects_root` itself when absent). Stays
/// pre-auth like the rest of the project-lifecycle endpoints (the picker is
/// reachable from the WelcomeScreen before any session exists), but since
/// Q46 (2026-09-09) navigation is clamped to `projects_root` via
/// `dentro_radice` below — this docstring used to say "no whitelist by
/// design, free navigation", which stopped being true once that restriction
/// was added and was never updated to match.
pub async fn browse_dirs(State(s): State<AppState>, Query(q): Query<BrowseDirsQuery>) -> Response {
    let radice: &std::path::Path = s.projects_root.as_ref();
    let richiesto: PathBuf = match q.path.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p);
            if !p.is_absolute() {
                return (StatusCode::BAD_REQUEST, "path must be absolute").into_response();
            }
            p
        }
        None => radice.to_path_buf(),
    };
    // Q46: non si esce dalla cartella dei progetti. Il rifiuto è un 400 che dice
    // il perché, non un elenco vuoto che sembra una cartella vuota.
    let current = match dentro_radice(radice, &richiesto) {
        Ok(c) => c,
        Err(m) => return (StatusCode::BAD_REQUEST, m).into_response(),
    };
    let radice_c = radice
        .canonicalize()
        .unwrap_or_else(|_| radice.to_path_buf());

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
        dirs.push(BrowseDirEntry {
            name,
            path: path.to_string_lossy().to_string(),
        });
    }
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Alla radice niente «su»: la UI nasconde il pulsante quando è None.
    let parent = if current == radice_c {
        None
    } else {
        current.parent().map(|p| p.to_string_lossy().to_string())
    };
    Json(BrowseDirsResponse {
        path: current.to_string_lossy().to_string(),
        parent,
        dirs,
    })
    .into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
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
/// its folder) gets created. Da Q46 (2026-09-09) né questa né `parent_path`
/// escono dalla cartella dei progetti: pre-auth resta, ma il perimetro è quello.
pub async fn create_dir(State(s): State<AppState>, Json(req): Json<CreateDirRequest>) -> Response {
    let target = match resolve_new_dir(&req.parent, &req.name) {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
    };
    // Q46: la nuova cartella deve nascere dentro la cartella dei progetti.
    let target = match dentro_radice_nuovo(s.projects_root.as_ref(), &target) {
        Ok(p) => p,
        Err(m) => return (StatusCode::BAD_REQUEST, m).into_response(),
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
                Json(CreateDirResponse {
                    path: target.to_string_lossy().to_string(),
                }),
            )
                .into_response()
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            (StatusCode::CONFLICT, "directory already exists").into_response()
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => (
            StatusCode::FORBIDDEN,
            format!("cannot create {}: {e}", target.display()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            format!("cannot create {}: {e}", target.display()),
        )
            .into_response(),
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
    ///   - in caso di errore **non** si fa `remove_dir_all` della cartella —
    ///     il rollback distruttivo cancellerebbe proprio il database che stiamo
    ///     cercando di preservare.
    ///
    /// Degli utenti non decide più questo flag: vedi `replace_users`.
    #[serde(default)]
    pub deploy: bool,

    /// Che fare di `users.yaml` del bundle. Dall'11-09-2026 **gli utenti
    /// appartengono al progetto**: il deploy li porta sul dispositivo come porta
    /// i sinottici (rovescia la decisione del 2026-07-30, che li dichiarava
    /// stato locale del dispositivo).
    ///
    ///   - **assente** → import normale: il bundle arriva com'è, `users.yaml`
    ///     compreso. È la WelcomeScreen che importa uno ZIP, non un deploy.
    ///   - **`Some(true)`** → sostituisci: il file del bundle vince e, se il
    ///     bundle **non** ha l'entry (progetto senza utenti), quello del
    ///     dispositivo va **rimosso** — vedi `deve_svuotare_utenti`.
    ///   - **`Some(false)`** → casella «Sostituisci anche gli utenti» spenta:
    ///     gli account del dispositivo restano intatti. Serve al caso futuro in
    ///     cui è una vista del progetto a creare utenti sul dispositivo (Q54).
    ///
    /// Il parametro sta qui e non sulla `DELETE …?preserve_state=true` di
    /// proposito: se la cancellazione togliesse `users.yaml` e poi l'upload
    /// fallisse, il pannello resterebbe senza account per un errore invece che
    /// per una scelta. Così gli account vecchi ci sono fino all'istante in cui
    /// arrivano i nuovi.
    #[serde(default)]
    pub replace_users: Option<bool>,
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
    let _switch = s.project_switch_lock.lock().await;

    // **La quota per prima, prima ancora di guardare lo zip.** L'upload e
    // l'altra strada che fa nascere un progetto, e rifiutare dopo aver letto
    // un archivio da cento megabyte e un rifiuto che costa quanto
    // l'accettazione.
    //
    // In **deploy** non si ferma: li il progetto sta sostituendo se stesso su
    // un dispositivo, non sta aggiungendo niente, e rifiutarlo lascerebbe un
    // impianto a meta. L'upload arriva nella radice, cioe nell'azienda
    // implicita.
    if !q.deploy {
        if let Some(rifiuto) = rifiuta_se_piena(&s, None).await {
            return rifiuto;
        }
    }

    // 1. Parse the ZIP.
    let mut archive = match zip::ZipArchive::new(Cursor::new(body.as_ref())) {
        Ok(a) => a,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("not a valid zip: {e}")).into_response()
        }
    };

    // 2. Determine the project name.
    //
    // Se il nome arriva dal chiamante e non dal manifest, alla fine va scritto
    // anche DENTRO `project.yaml`: la lista progetti mostra il nome della
    // cartella, l'intestazione dell'editor mostra `meta.name`, e senza questo
    // allineamento lo stesso progetto compare con due nomi diversi nei due
    // punti. Si vede appena si importa un bundle scegliendo un nome — cioè
    // sempre, nel pull da un dispositivo.
    let name_was_explicit = q.name.as_deref().is_some_and(|n| !n.trim().is_empty());
    let raw_name = match q.name.filter(|n| !n.trim().is_empty()) {
        Some(n) => n,
        None => {
            // Read manifest.json from the archive.
            match read_zip_entry(&mut archive, "manifest.json") {
                Ok(Some(bytes)) => match serde_json::from_slice::<UploadManifest>(&bytes) {
                    Ok(m) => m.name,
                    Err(e) => {
                        return (
                            StatusCode::BAD_REQUEST,
                            format!("manifest.json parse error: {e}"),
                        )
                            .into_response()
                    }
                },
                Ok(None) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        "ZIP has no manifest.json — supply ?name= query param",
                    )
                        .into_response()
                }
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, format!("zip read error: {e}"))
                        .into_response()
                }
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
                return (
                    StatusCode::BAD_REQUEST,
                    "parent_path must be an absolute path",
                )
                    .into_response();
            }
            // Q46 anche qui, dal 07-10-2026. Prima questo ramo faceva un
            // `create_dir_all` su **qualunque** percorso assoluto, senza
            // passare dal confinamento: un chiamante poteva materializzare
            // alberi di directory ovunque il processo potesse scrivere, e
            // depositarci dentro un progetto. `create_project` era stato
            // corretto il 09-09; questo no, ed è rimasto aperto un mese.
            //
            // Si usa `dentro_radice_nuovo` e non `dentro_radice` perché qui
            // una cartella nuova ci vuole davvero: è il caso «primo progetto
            // di un'azienda», cioè `<radice>/<azienda>` che ancora non esiste.
            // Quella funzione ne concede **una sola**, sotto un genitore che
            // esiste già ed è dentro la radice: una risalita o un percorso
            // profondo inventato vengono rifiutati.
            let parent = match dentro_radice_nuovo(s.projects_root.as_ref(), &parent) {
                Ok(c) => c,
                Err(m) => {
                    return (StatusCode::BAD_REQUEST, format!("parent_path: {m}")).into_response()
                }
            };
            if let Err(e) = tokio::fs::create_dir_all(&parent).await {
                warn!("upload_project_zip: mkdir parent {}: {e}", parent.display());
                return (
                    StatusCode::BAD_REQUEST,
                    format!("cannot create/access parent_path: {e}"),
                )
                    .into_response();
            }
            parent
        }
        None => s.projects_root.as_ref().clone(),
    };
    // In deploy la cartella DEVE esistere già: il conflitto non è un errore.
    let chiave_caricato = crate::project_registry::riferimento(
        &segmento_da_percorso(s.projects_root.as_path(), &parent_dir.join(&safe_name)),
        &safe_name,
    );
    if !q.deploy && s.known_projects.get_path(&chiave_caricato).await.is_some() {
        return (
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({ "name": safe_name })),
        )
            .into_response();
    }
    let target = parent_dir.join(&safe_name);
    if !q.deploy && tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return (
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({ "name": safe_name })),
        )
            .into_response();
    }
    if let Err(e) = tokio::fs::create_dir_all(&target).await {
        warn!("upload_project_zip: mkdir {}: {e}", target.display());
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot create project dir",
        )
            .into_response();
    }

    // 4. Extract every file from the ZIP into the project folder.
    //    We trust the manifest.json name and skip it; everything else lands at
    //    its relative path under `target`. We refuse `..` components.
    let file_names: Vec<String> = archive.file_names().map(|n| n.to_string()).collect();
    // Rollback: solo per una cartella creata da noi adesso. In deploy la cartella
    // conteneva già `history/` & co. e cancellarla vanificherebbe tutto il fix.
    let rollback = |target: std::path::PathBuf, deploy: bool| async move {
        if !deploy {
            let _ = tokio::fs::remove_dir_all(&target).await;
        }
    };
    for entry_name in &file_names {
        if entry_name == "manifest.json" {
            continue; // metadata only — not needed on disk
        }
        // Gli utenti arrivano col progetto, salvo richiesta contraria.
        if entry_name == "users.yaml" && salta_users_yaml(q.replace_users) {
            info!("deploy: users.yaml dello ZIP ignorato — «Sostituisci anche gli utenti» spenta");
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
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "cannot create subdirectory",
                )
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
                // Passo 2, 2d: secrets.yaml è 0600 dovunque venga scritto, non
                // solo da segreti::scrivi_segreti. L'estrazione generica sopra
                // usa i permessi di default (umask): qui si stringono. Assente
                // dallo ZIP (deploy senza segreti — non dovrebbe capitare, ma
                // se capita) → il dispositivo tiene il suo secrets.yaml, che
                // questo ciclo non tocca affatto (conferma 2 del maintainer).
                if entry_name == "secrets.yaml" {
                    use std::os::unix::fs::PermissionsExt;
                    if let Err(e) =
                        tokio::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o600))
                            .await
                    {
                        warn!("upload_project_zip: chmod secrets.yaml: {e}");
                    }
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

    // 4b. Progetto senza utenti ⇒ dispositivo senza utenti: il pannello
    //     rispecchia il progetto (decisione del maintainer, 2026-09-11).
    //     Conseguenza dichiarata: senza nemmeno un account di recupero da
    //     variabili d'ambiente il runtime riparte in no-auth, cioè accessibile
    //     senza password. L'editor lo fa confermare prima di arrivare qui.
    if deve_svuotare_utenti(
        q.replace_users,
        file_names.iter().any(|n| n == "users.yaml"),
    ) {
        let path = target.join("users.yaml");
        match tokio::fs::remove_file(&path).await {
            Ok(()) => {
                info!("deploy: il progetto non ha utenti — users.yaml rimosso dal dispositivo")
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            // Non fatale: il progetto è già arrivato tutto. Fallire qui
            // lascerebbe il dispositivo con le pagine nuove e nessun modo di
            // saperlo; l'incoerenza si vede dal log e dagli account rimasti.
            Err(e) => warn!("upload_project_zip: remove {}: {e}", path.display()),
        }
    }

    // 5. Allinea `meta.name` alla cartella quando il nome l'ha scelto il
    //    chiamante. Si passa da `serde_yaml::Value` e non dalla struct
    //    `Project` di proposito: il giro dalla struct tipizzata perderebbe le
    //    chiavi che questo binario non conosce (bundle scritto da una versione
    //    più nuova), stesso motivo per cui l'import usa `merge_preserved`.
    //
    //    In deploy è un no-op: `remote_deploy` passa il nome letto dal manifest,
    //    quindi coincide già con quello dentro project.yaml.
    if name_was_explicit {
        let yaml_path = target.join("project.yaml");
        // Q30: leggi-modifica-scrivi su project.yaml. Come sopra tiene già
        // `project_switch_lock`, quindi switch → write.
        let _scrittura = s.project_write_lock.lock().await;
        if let Ok(text) = tokio::fs::read_to_string(&yaml_path).await {
            match serde_yaml::from_str::<serde_yaml::Value>(&text) {
                Ok(mut doc) => {
                    let differs = doc.get("meta").and_then(|m| m.get("name")).and_then(|n| n.as_str())
                        != Some(safe_name.as_str());
                    if differs {
                        if let Some(meta) = doc.get_mut("meta").and_then(|m| m.as_mapping_mut()) {
                            meta.insert(
                                serde_yaml::Value::String("name".into()),
                                serde_yaml::Value::String(safe_name.clone()),
                            );
                            match serde_yaml::to_string(&doc) {
                                Ok(out) => {
                                    if let Err(e) = crate::router::scrivi_atomico(&yaml_path, out.as_bytes()).await {
                                        warn!("upload_project_zip: rewrite meta.name: {e}");
                                    } else {
                                        info!(name = %safe_name, "meta.name allineato al nome scelto");
                                    }
                                }
                                Err(e) => warn!("upload_project_zip: serialize project.yaml: {e}"),
                            }
                        }
                    }
                }
                // Un project.yaml illeggibile è un problema che si manifesterà
                // all'apertura con un messaggio molto più chiaro di qualunque
                // cosa potremmo dire qui: non è questo il punto in cui fermarsi.
                Err(e) => warn!("upload_project_zip: project.yaml non interpretabile, meta.name lasciato com'è: {e}"),
            }
        }
    }

    s.known_projects.touch(&chiave_caricato, &target).await;
    info!(name = %safe_name, "project created from uploaded ZIP");
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "name": safe_name, "riferimento": chiave_caricato })),
    )
        .into_response()
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
/// È il lato ricevente di "Aggiorna utenti sul dispositivo". Dall'11-09-2026 gli
/// utenti viaggiano già col deploy (appartengono al progetto); questa resta la
/// via per mandarli **da soli**, senza ridistribuire il progetto — utile quando
/// sul dispositivo gira lo stesso progetto e sono cambiate solo le password. Si
/// trasferisce il file, che contiene gli hash Argon2: le password restano ignote
/// a chi lo spedisce.
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
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let path = dir.join("users.yaml");
    if let Err(e) = tokio::fs::write(&path, body.as_bytes()).await {
        warn!("replace_users_file: write {}: {e}", path.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot write users.yaml").into_response();
    }
    s.audit.log(
        "auth.users_replaced",
        Some(user.username),
        serde_json::json!({
            "count": names.len(), "users": names.clone(),
        }),
    );
    if let Err(e) = s.auth.swap_store(path, build_seed_accounts()).await {
        warn!("replace_users_file: swap_store: {e:#}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("utenti scritti ma non ricaricati: {e}"),
        )
            .into_response();
    }
    info!(
        count = names.len(),
        "users.yaml replaced from remote — all sessions invalidated"
    );
    (
        StatusCode::OK,
        Json(serde_json::json!({ "users": names.len() })),
    )
        .into_response()
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
    let yaml = serde_yaml::to_string(overrides).unwrap_or_default();
    std::fs::write(client_id_overrides_path(config_dir), yaml)
}

/// Applies, in place, the effective wire `client_id` of every MQTT source in
/// `sources`. Called once, right before the resolved list reaches
/// `SourceSupervisor::reload` — the supervisor itself stays generic and
/// never sees the literal project.yaml value.
pub(crate) fn resolve_mqtt_client_ids(
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
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let mut project = match Project::load(&dir) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("project parse error: {e}"),
            )
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
        Some(v) if !v.is_empty() => {
            overrides.insert(key, v.to_string());
        }
        _ => {
            overrides.remove(&key);
        }
    }
    if let Err(e) = save_client_id_overrides(&s.config_dir, &overrides) {
        warn!("set_mqtt_client_id_override: write failed: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "impossibile salvare l'override",
        )
            .into_response();
    }

    resolve_mqtt_client_ids(
        &project.meta.name,
        &mut project.sources,
        &s.config_dir,
        &s.instance_id,
    );
    let (started, stopped, replaced) = s.supervisor.reload(project.sources).await;
    info!(source = %source_id, started, stopped, replaced, "mqtt client_id override applied");
    (StatusCode::OK, Json(serde_json::json!({ "applied": true }))).into_response()
}

/// Default per-project SQLite datastore injected when a project has none.
/// Stores history inside the project directory so it travels with backups.
///
/// `pub` (not `pub(crate)`): also called from `sws-runtime`'s boot-time
/// auto-open path (`main.rs`), a different crate — see the injection there
/// for why it needs to run in both places.
pub fn default_datastore() -> DatastoreConfig {
    DatastoreConfig {
        id: "default".into(),
        label: "Storico locale".into(),
        backend: DatastoreBackendConfig::Sqlite {
            path: "history/historian.db".into(),
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
    crate::router::scrivi_atomico(yaml_path, updated.as_bytes()).await?;
    Ok(())
}

/// La tabella lingue con cui nasce un progetto vuoto: **una** lingua, quella di
/// chi lo crea, principale e unica. Nessuna voce — le voci arrivano quando
/// l'autore scrive il primo testo.
///
/// `lang` vuota o assente → `it`, che è la lingua in cui è scritto questo
/// progetto e l'unica scelta che non finge di sapere qualcosa che non sa.
pub(crate) fn lingua_iniziale(lang: Option<&str>) -> sws_core::LanguageTable {
    let codice = lang
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| l.chars().take(2).collect::<String>().to_lowercase())
        .unwrap_or_else(|| "it".to_string());
    sws_core::LanguageTable {
        default: codice.clone(),
        langs: vec![codice],
        entries: vec![],
    }
}

/// Le sorgenti che non hanno indirizzi da rivedere: leggono la macchina su cui
/// gira il runtime. Un template fatto solo di queste (03-10-2026, `tc620-sistema`)
/// non deve partire con le sorgenti ferme: non c'è niente dell'esempio da
/// correggere, e il pannello mostrava tutto «Uncertain» senza dire perché.
const SORGENTI_LOCALI: &[&str] = &["host"];

/// Il progetto ha almeno una sorgente che parla con qualcun altro (un PLC, un
/// broker, un server): solo allora gli indirizzi dell'esempio vanno rivisti.
fn ha_sorgenti_con_indirizzi(doc: &serde_yaml::Value) -> bool {
    doc.get("sources")
        .and_then(|s| s.as_sequence())
        .is_some_and(|v| {
            v.iter().any(|s| {
                s.get("kind").and_then(|k| k.as_str()).is_none_or(|k| !SORGENTI_LOCALI.contains(&k))
            })
        })
}

/// Accende `sorgenti_da_rivedere` sul progetto appena copiato da un template.
///
/// Sta qui e non dentro `patch_project_name` per la stessa ragione di
/// `stamp_saved_by`: quella funzione la usa anche il rinomina, e un rinomina
/// non deve rimettere in discussione sorgenti che l'utente ha già confermato.
async fn segna_sorgenti_da_rivedere(yaml_path: &StdPath) -> anyhow::Result<()> {
    let raw = tokio::fs::read_to_string(yaml_path).await?;
    let mut doc: serde_yaml::Value = serde_yaml::from_str(&raw)?;
    if !ha_sorgenti_con_indirizzi(&doc) {
        return Ok(());
    }
    if let Some(m) = doc.as_mapping_mut() {
        m.insert(
            serde_yaml::Value::String("sorgenti_da_rivedere".into()),
            serde_yaml::Value::Bool(true),
        );
    }
    crate::router::scrivi_atomico(yaml_path, serde_yaml::to_string(&doc)?.as_bytes()).await?;
    Ok(())
}

/// Scrive `saved_by` con la versione di questo runtime.
///
/// Serve al progetto creato **da template**: i file del template si copiano
/// così come sono, e i template non hanno `saved_by` — giustamente, perché un
/// template non è "stato salvato da" una versione. Il progetto però sì: è
/// prodotto adesso, da questo runtime. Senza il timbro, `needs_update()` lo
/// confronta con `None` e l'IDE lo segnala «da aggiornare» al primo minuto di
/// vita, per una deriva che non esiste.
///
/// **Deliberatamente separata da `patch_project_name`**, che è usata anche da
/// `rename_project` e `duplicate_project`: lì il timbro sarebbe sbagliato. Un
/// progetto salvato dalla 2.1.0 e rinominato oggi *è ancora* della 2.1.0, e
/// azzerarne l'avviso nasconderebbe una deriva vera.
///
/// Lavora sullo YAML **grezzo** e non sulla struct tipizzata: passare di lì
/// farebbe cadere i campi che questo build non conosce, che è il difetto di Q10
/// per cui esiste `merge_preserved`.
async fn stamp_saved_by(yaml_path: &StdPath) -> anyhow::Result<()> {
    let raw = tokio::fs::read_to_string(yaml_path).await?;
    let mut doc: serde_yaml::Value = serde_yaml::from_str(&raw)?;
    if let Some(map) = doc.as_mapping_mut() {
        map.insert(
            serde_yaml::Value::from("saved_by"),
            serde_yaml::Value::from(sws_core::project::runtime_version()),
        );
    }
    let updated = serde_yaml::to_string(&doc)?;
    crate::router::scrivi_atomico(yaml_path, updated.as_bytes()).await?;
    Ok(())
}

/// Dot-prefixed working directories this codebase used to create inside a
/// project, mapped to the visible name they migrate to. `.git` is
/// deliberately absent: it's not ours to rename — git itself hardcodes that
/// name, and a project versioned via "Versionamento progetto" needs it
/// exactly as-is.
const LEGACY_HIDDEN_DIRS: &[(&str, &str)] = &[
    (".history", "history"),
    (".bak", "backups"),
    (".opcua-pki", "opcua-pki"),
];

/// Passo 2, sotto-passo 2c: se `project.yaml` ha ancora uno o più dei sette
/// segreti in chiaro (`sws_core::segreti::segreti_in_chiaro`), fa un backup
/// **prima** di toccare qualunque file — un progetto già migrato non ne
/// produce uno a ogni apertura, perché non c'è niente da migrare — poi sposta
/// i segreti in `secrets.yaml` (`sws_core::segreti::migra`). Silenzioso e
/// senza effetto quando non c'è nulla da fare: la funzione è pensata per
/// essere chiamata a **ogni** apertura, non solo la prima.
///
/// Ritorna quanti campi ha spostato, per chi vuole scriverlo nell'audit
/// (`open_project`, con l'utente); il boot (`main.rs`, dove l'audit non
/// esiste ancora — nasce con `AppState` in `router::build()`) lo ignora e si
/// affida al solo `tracing::info!` qui sotto.
///
/// Se il backup fallisce, la migrazione **non parte**: spostare un segreto
/// senza una via per tornare indietro non è la garanzia che il maintainer ha
/// confermato (Passo 2, conferma 5 — i backup vecchi restano in chiaro e si
/// avverte soltanto, ma un backup che dovrebbe esserci e non c'è è un'altra
/// cosa: qui si può evitarlo, quindi si evita).
///
/// Stesso schema di [`migrate_legacy_project_dirs`] qui sotto (stessi due
/// chiamanti, stesso motivo per cui bastano loro due).
pub fn migra_segreti_se_serve(project_dir: &StdPath) -> Option<usize> {
    match sws_core::segreti::segreti_in_chiaro(project_dir) {
        Ok(0) => return None,
        Ok(_) => {}
        Err(e) => {
            warn!("migra_segreti_se_serve: {e:#}");
            return None;
        }
    }
    if let Err(e) = crate::backups::backup_now(project_dir) {
        warn!("migra_segreti_se_serve: backup fallito, migrazione rimandata: {e}");
        return None;
    }
    match sws_core::segreti::migra(project_dir) {
        Ok(n) => {
            info!(n, dir = %project_dir.display(), "segreti migrati in secrets.yaml");
            Some(n)
        }
        Err(e) => {
            warn!("migra_segreti_se_serve: migrazione fallita dopo il backup: {e:#}");
            None
        }
    }
}

/// Migrates a project's legacy dot-prefixed working directories (historian
/// DB, backup snapshots, OPC-UA PKI store) to their new visible names, and
/// keeps the SQLite datastore path in `project.yaml` in sync so it doesn't
/// keep pointing at a folder that no longer exists. Idempotent — a project
/// already migrated (or one that never had these directories) is untouched.
///
/// Called once whenever a project directory becomes the active one (runtime
/// boot auto-open in `main.rs`, and `open_project` here) — the only two
/// places that resolve the historian/PKI paths for a project, see their
/// call sites for why nothing else needs to run this.
pub fn migrate_legacy_project_dirs(project_dir: &StdPath) {
    for (old, new) in LEGACY_HIDDEN_DIRS {
        let old_path = project_dir.join(old);
        let new_path = project_dir.join(new);
        if !old_path.exists() || new_path.exists() {
            continue;
        }
        match std::fs::rename(&old_path, &new_path) {
            Ok(()) => {
                info!(project = %project_dir.display(), old, new, "migrated legacy hidden directory")
            }
            Err(e) => {
                warn!(project = %project_dir.display(), old, new, "migrate_legacy_project_dirs: rename failed: {e}")
            }
        }
    }
    migrate_legacy_sqlite_path(project_dir);
}

/// The `.history` → `history` rename above only moves the folder; if
/// `project.yaml` stores the exact legacy default path (`.history/historian.db`
/// — written whenever a project ever got the default datastore injected and
/// then saved), the datastore would keep looking for the old location.
/// Any other value (custom path, absolute path, non-SQLite backend) is left
/// untouched — this only follows the one rename this migration performs.
fn migrate_legacy_sqlite_path(project_dir: &StdPath) {
    let yaml_path = project_dir.join("project.yaml");
    let Ok(raw) = std::fs::read_to_string(&yaml_path) else {
        return;
    };
    let Ok(mut doc) = serde_yaml::from_str::<serde_yaml::Value>(&raw) else {
        return;
    };
    let Some(datastores) = doc.get_mut("datastores").and_then(|d| d.as_sequence_mut()) else {
        return;
    };
    let mut changed = false;
    for ds in datastores {
        let Some(backend) = ds.get_mut("backend") else {
            continue;
        };
        if backend.get("kind").and_then(|k| k.as_str()) != Some("sqlite") {
            continue;
        }
        if backend.get("path").and_then(|p| p.as_str()) == Some(".history/historian.db") {
            backend["path"] = serde_yaml::Value::String("history/historian.db".into());
            changed = true;
        }
    }
    if !changed {
        return;
    }
    match serde_yaml::to_string(&doc) {
        Ok(updated) => {
            if let Err(e) = crate::router::scrivi_atomico_sync(&yaml_path, updated.as_bytes()) {
                warn!(
                    "migrate_legacy_sqlite_path: write {}: {e}",
                    yaml_path.display()
                );
            }
        }
        Err(e) => warn!(
            "migrate_legacy_sqlite_path: serialize {}: {e}",
            yaml_path.display()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fase 0d: un posto solo installa i tag nel runtime, e fa sempre tutto.
    /// Prima la ricarica da git non aggiornava scale, tipi e ruoli e non
    /// toglieva i tag spariti; l'import CSV saltava scale, tipi e ruoli.
    #[tokio::test]
    async fn apply_tags_semina_toglie_e_aggiorna_tutto() {
        let db = TagDb::new(8);
        let derived: DerivedTagsRegistry = Default::default();
        let generators: GeneratorTagsRegistry = Default::default();
        // Dal YAML, com'è nel progetto: TagDef non ha un Default.
        let tag =
            |yaml: &str| -> sws_core::TagDef { serde_yaml::from_str(yaml).expect("tag di prova") };
        let scalato =
            tag("id: a\ndata_type: float\nraw_min: 0\nraw_max: 100\neng_min: 0\neng_max: 1000");
        let calcolato = tag("id: c\ndata_type: float\nexpression: 'tags[\"a\"] * 2'");
        let b = tag("id: b\ndata_type: int");
        let a_senza_scala = tag("id: a\ndata_type: float");

        let (seminati, tolti) = apply_tags(
            &db,
            &derived,
            &generators,
            &[scalato.clone(), calcolato.clone(), b.clone()],
            &[],
        )
        .await;
        assert_eq!((seminati, tolti), (3, 0));
        let mut ids: Vec<String> = db.snapshot().await.into_keys().collect();
        ids.sort();
        assert_eq!(ids, ["a", "b", "c"]);
        assert!(
            db.is_computed("c").await,
            "il tag con espressione è calcolato"
        );
        assert_eq!(derived.read().await.len(), 1);
        // La scala c'è: 50 grezzi → 500 ingegneristici, e la coercizione
        // conosce il tipo di `b`.
        assert_eq!(
            db.scale_to_raw("a", sws_core::TagValue::Float(500.0)).await,
            sws_core::TagValue::Float(50.0)
        );
        assert_eq!(
            db.coerce_for_write("b", sws_core::TagValue::Float(7.0))
                .await,
            Ok(sws_core::TagValue::Int(7))
        );

        // Secondo giro: `c` sparisce, `a` perde la scala. Niente resta indietro.
        let (seminati, tolti) =
            apply_tags(&db, &derived, &generators, &[a_senza_scala, b], &[]).await;
        assert_eq!((seminati, tolti), (0, 1));
        assert!(db.get("c").await.is_none());
        assert!(!db.is_computed("c").await);
        assert!(derived.read().await.is_empty());
        assert_eq!(
            db.scale_to_raw("a", sws_core::TagValue::Float(500.0)).await,
            sws_core::TagValue::Float(500.0)
        );

        // Nessun tag = chiusura: tutto azzerato, senza toccare quel che il
        // chiamante ha già svuotato con `clear()`.
        db.clear().await;
        let (seminati, tolti) = apply_tags(&db, &derived, &generators, &[], &[]).await;
        assert_eq!((seminati, tolti), (0, 0));
        assert!(db.snapshot().await.is_empty());
    }

    #[test]
    fn il_deploy_sovrascrive_anche_le_pagine_di_boot() {
        // Senza `boot` qui, una pagina di boot eliminata nell'IDE resterebbe per
        // sempre sul dispositivo dopo un deploy.
        assert!(DESIGN_ARTIFACTS.contains(&"boot"));
    }

    #[test]
    fn un_progetto_vuoto_nasce_con_la_lingua_di_chi_lo_crea() {
        // Prima nasceva con `default: ''` e nessuna lingua: un allarme scritto
        // prima di aprire la scheda Lingue non finiva in tabella, e ogni select
        // delle lingue del progetto era vuoto.
        let t = lingua_iniziale(Some("en"));
        assert_eq!(t.default, "en");
        assert_eq!(t.langs, vec!["en".to_string()]);
        assert!(t.entries.is_empty());
        // `en-US` dal browser → `en`; vuoto o assente → `it`.
        assert_eq!(lingua_iniziale(Some("en-US")).default, "en");
        assert_eq!(lingua_iniziale(Some("  ")).default, "it");
        assert_eq!(lingua_iniziale(None).default, "it");
        assert!(
            !lingua_iniziale(None).default.is_empty(),
            "mai più una lingua principale vuota"
        );
    }

    /// Q58 — creare un progetto da un template accende `sorgenti_da_rivedere`.
    ///
    /// Si prova l'helper e non la rotta intera perché la rotta vuole uno stato
    /// applicativo completo; quello che può rompersi in silenzio è la scrittura
    /// nel YAML — un campo messo nel posto sbagliato, o un `project.yaml` che
    /// dopo non si rilegge più.
    #[test]
    fn solo_le_sorgenti_con_indirizzi_vanno_rivedute() {
        let y = |t: &str| serde_yaml::from_str::<serde_yaml::Value>(t).unwrap();
        assert!(!ha_sorgenti_con_indirizzi(&y("sources:\n- kind: host\n  id: h\n")));
        assert!(!ha_sorgenti_con_indirizzi(&y("meta: {name: x}\n")));
        assert!(ha_sorgenti_con_indirizzi(&y("sources:\n- kind: host\n  id: h\n- kind: modbus\n  id: m\n")));
        assert!(ha_sorgenti_con_indirizzi(&y("sources:\n- id: senza_kind\n")));
    }

    #[tokio::test]
    async fn il_flag_finisce_nel_project_yaml_e_il_file_resta_leggibile() {
        let dir = tempfile::tempdir().unwrap();
        let yaml = dir.path().join("project.yaml");
        tokio::fs::write(
            &yaml,
            // Una sorgente con indirizzi: è il caso per cui il flag esiste (dal
            // 03-10-2026 un progetto con sole sorgenti `host` non lo riceve).
            "meta:\n  name: pippo\n  version: 0.1.0\ntags: []\nsources:\n- kind: mqtt\n  id: m\n  host: mqtt.example.invalid\n  port: 1883\n  topics: []\n",
        )
        .await
        .unwrap();

        let prima = Project::load(dir.path()).unwrap();
        assert!(!prima.sorgenti_da_rivedere, "non doveva esserci già");

        segna_sorgenti_da_rivedere(&yaml).await.unwrap();

        let dopo = Project::load(dir.path()).unwrap();
        assert!(
            dopo.sorgenti_da_rivedere,
            "il flag non è arrivato sul disco"
        );
        // Il resto del progetto non si tocca: è un `insert` in una mappa, non
        // una riscrittura.
        assert_eq!(dopo.meta.name, "pippo");
    }

    // ── Chi decide di `users.yaml` in un upload (2026-09-11) ────────────────
    //
    // La matrice completa dei tre stati, perché è la regola su cui si regge
    // «gli utenti appartengono al progetto» e l'errore possibile è lasciare un
    // pannello senza account.

    #[test]
    fn import_normale_scrive_gli_utenti_del_bundle_e_non_svuota_mai() {
        // `None` = WelcomeScreen che importa uno ZIP: comportamento storico.
        assert!(!salta_users_yaml(None));
        assert!(!deve_svuotare_utenti(None, true));
        assert!(
            !deve_svuotare_utenti(None, false),
            "un import non deve poter svuotare"
        );
    }

    #[test]
    fn casella_spenta_non_tocca_gli_account_del_dispositivo() {
        assert!(salta_users_yaml(Some(false)));
        assert!(!deve_svuotare_utenti(Some(false), true));
        assert!(!deve_svuotare_utenti(Some(false), false));
    }

    #[test]
    fn casella_accesa_sostituisce_e_se_il_progetto_e_vuoto_svuota() {
        // Bundle con utenti: si estrae e basta, l'estrazione sovrascrive.
        assert!(!salta_users_yaml(Some(true)));
        assert!(!deve_svuotare_utenti(Some(true), true));
        // Bundle senza utenti: l'estrazione non può togliere niente, serve il
        // passo esplicito. È il caso che lascia il pannello senza password.
        assert!(deve_svuotare_utenti(Some(true), false));
    }

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
        assert_eq!(
            resolve_new_dir("/tmp", "nuova").unwrap(),
            PathBuf::from("/tmp/nuova")
        );
        // both sides are trimmed
        assert_eq!(
            resolve_new_dir("  /tmp  ", " nuova ").unwrap(),
            PathBuf::from("/tmp/nuova")
        );
    }

    #[test]
    fn resolve_new_dir_rejects_relative_parent_and_bad_names() {
        assert!(resolve_new_dir("tmp", "x").is_err()); // not absolute
        assert!(resolve_new_dir("", "x").is_err());
        assert!(resolve_new_dir("/tmp", "").is_err());
        assert!(resolve_new_dir("/tmp", "..").is_err()); // traversal
        assert!(resolve_new_dir("/tmp", "a/b").is_err()); // no nesting
        assert!(resolve_new_dir("/tmp", ".hidden").is_err());
    }

    #[test]
    fn migrate_legacy_project_dirs_renames_old_dot_dirs() {
        let tmp = tempfile::TempDir::new().unwrap();
        let project = tmp.path();
        std::fs::create_dir_all(project.join(".history")).unwrap();
        std::fs::write(project.join(".history/historian.db"), b"db").unwrap();
        std::fs::create_dir_all(project.join(".bak/2026-01-01T00-00-00Z")).unwrap();
        std::fs::create_dir_all(project.join(".opcua-pki/mysource")).unwrap();

        migrate_legacy_project_dirs(project);

        assert!(!project.join(".history").exists());
        assert!(!project.join(".bak").exists());
        assert!(!project.join(".opcua-pki").exists());
        assert_eq!(
            std::fs::read(project.join("history/historian.db")).unwrap(),
            b"db"
        );
        assert!(project.join("backups/2026-01-01T00-00-00Z").is_dir());
        assert!(project.join("opcua-pki/mysource").is_dir());
    }

    #[test]
    fn migrate_legacy_project_dirs_is_a_noop_once_migrated() {
        let tmp = tempfile::TempDir::new().unwrap();
        let project = tmp.path();
        std::fs::create_dir_all(project.join("history")).unwrap();
        std::fs::write(project.join("history/historian.db"), b"already-migrated").unwrap();

        migrate_legacy_project_dirs(project); // must not touch anything or error
        migrate_legacy_project_dirs(project); // idempotent on a second run too

        assert!(!project.join(".history").exists());
        assert_eq!(
            std::fs::read(project.join("history/historian.db")).unwrap(),
            b"already-migrated"
        );
    }

    #[test]
    fn migrate_legacy_project_dirs_never_overwrites_an_existing_new_dir() {
        // A project that somehow ended up with both names (e.g. a manual
        // partial migration) must not lose data by having the rename clobber
        // the new directory — leave both exactly as found.
        let tmp = tempfile::TempDir::new().unwrap();
        let project = tmp.path();
        std::fs::create_dir_all(project.join(".history")).unwrap();
        std::fs::write(project.join(".history/historian.db"), b"old").unwrap();
        std::fs::create_dir_all(project.join("history")).unwrap();
        std::fs::write(project.join("history/historian.db"), b"new").unwrap();

        migrate_legacy_project_dirs(project);

        assert_eq!(
            std::fs::read(project.join(".history/historian.db")).unwrap(),
            b"old"
        );
        assert_eq!(
            std::fs::read(project.join("history/historian.db")).unwrap(),
            b"new"
        );
    }

    #[test]
    fn migrate_legacy_project_dirs_rewrites_the_default_sqlite_path_in_project_yaml() {
        let tmp = tempfile::TempDir::new().unwrap();
        let project = tmp.path();
        std::fs::write(
            project.join("project.yaml"),
            "\
meta:
  name: test
  version: \"0.1.0\"
datastores:
  - id: default
    label: Storico locale
    backend:
      kind: sqlite
      path: .history/historian.db
",
        )
        .unwrap();

        migrate_legacy_project_dirs(project);

        let raw = std::fs::read_to_string(project.join("project.yaml")).unwrap();
        let doc: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        let path = doc["datastores"][0]["backend"]["path"].as_str().unwrap();
        assert_eq!(path, "history/historian.db");
    }

    #[test]
    fn migrate_legacy_project_dirs_leaves_a_custom_sqlite_path_untouched() {
        let tmp = tempfile::TempDir::new().unwrap();
        let project = tmp.path();
        std::fs::write(
            project.join("project.yaml"),
            "\
meta:
  name: test
  version: \"0.1.0\"
datastores:
  - id: default
    label: Storico locale
    backend:
      kind: sqlite
      path: /custom/altrove/storico.db
",
        )
        .unwrap();

        migrate_legacy_project_dirs(project);

        let raw = std::fs::read_to_string(project.join("project.yaml")).unwrap();
        let doc: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        let path = doc["datastores"][0]["backend"]["path"].as_str().unwrap();
        assert_eq!(path, "/custom/altrove/storico.db");
    }

    /// Un progetto creato da template è prodotto da QUESTO runtime: deve
    /// nascere col timbro, altrimenti l'IDE lo segnala «da aggiornare» al primo
    /// minuto per una deriva che non esiste.
    #[tokio::test]
    async fn il_timbro_marca_la_versione_corrente() {
        let dir = tempfile::tempdir().expect("tempdir");
        let yaml = dir.path().join("project.yaml");
        // Come un template: nessun `saved_by`.
        std::fs::write(
            &yaml,
            "meta:\n  name: da-template\n  version: '1'\ntags: []\n",
        )
        .unwrap();

        super::stamp_saved_by(&yaml).await.expect("timbro");

        let doc: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(&yaml).unwrap()).unwrap();
        assert_eq!(
            doc["saved_by"].as_str(),
            Some(sws_core::project::runtime_version())
        );
        assert_eq!(
            doc["meta"]["name"].as_str(),
            Some("da-template"),
            "il resto non si tocca"
        );
    }

    /// Il timbro non deve cadere dentro `patch_project_name`: rinominare un
    /// progetto vecchio non lo rende nuovo, e azzerarne l'avviso nasconderebbe
    /// una deriva vera.
    #[tokio::test]
    async fn rinominare_non_cambia_il_timbro() {
        let dir = tempfile::tempdir().expect("tempdir");
        let yaml = dir.path().join("project.yaml");
        std::fs::write(
            &yaml,
            "meta:\n  name: vecchio\n  version: '1'\nsaved_by: 2.1.0\ntags: []\n",
        )
        .unwrap();

        super::patch_project_name(&yaml, "nuovo-nome")
            .await
            .expect("rinomina");

        let doc: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(&yaml).unwrap()).unwrap();
        assert_eq!(doc["meta"]["name"].as_str(), Some("nuovo-nome"));
        assert_eq!(
            doc["saved_by"].as_str(),
            Some("2.1.0"),
            "rinominare ha cancellato la provenienza: l'avviso di deriva sparirebbe"
        );
    }

    /// I campi che questo build non conosce devono sopravvivere al timbro —
    /// è il difetto di Q10, e il timbro lavora sullo YAML grezzo apposta.
    #[tokio::test]
    async fn il_timbro_non_perde_i_campi_sconosciuti() {
        let dir = tempfile::tempdir().expect("tempdir");
        let yaml = dir.path().join("project.yaml");
        std::fs::write(
            &yaml,
            "meta:\n  name: x\n  version: '1'\ntags: []\nroba_futura:\n  chiave: valore\n",
        )
        .unwrap();

        super::stamp_saved_by(&yaml).await.expect("timbro");

        let testo = std::fs::read_to_string(&yaml).unwrap();
        assert!(
            testo.contains("roba_futura"),
            "chiave sconosciuta persa:\n{testo}"
        );
        assert!(
            testo.contains("valore"),
            "contenuto della chiave sconosciuta perso:\n{testo}"
        );
    }

    /// Q46: il confine è la cartella dei progetti, e si misura dopo
    /// `canonicalize` — `radice/../altro` è una stringa che comincia con la
    /// radice e un percorso che ne esce.
    #[test]
    fn dentro_radice_tiene_dentro_e_rifiuta_fuori() {
        let tmp = tempfile::tempdir().unwrap();
        let radice = tmp.path().join("progetti");
        std::fs::create_dir_all(radice.join("impianto_a")).unwrap();
        std::fs::create_dir_all(tmp.path().join("altrove")).unwrap();

        assert!(dentro_radice(&radice, &radice).is_ok(), "la radice stessa");
        assert!(dentro_radice(&radice, &radice.join("impianto_a")).is_ok());
        assert!(
            dentro_radice(&radice, &radice.join("impianto_a/../..")).is_err(),
            "risale fuori"
        );
        assert!(dentro_radice(&radice, &tmp.path().join("altrove")).is_err());
        assert!(dentro_radice(&radice, std::path::Path::new("/etc")).is_err());
        assert!(
            dentro_radice(&radice, &radice.join("non_esiste")).is_err(),
            "deve esistere"
        );
    }

    #[test]
    fn dentro_radice_non_si_fa_ingannare_da_un_link_simbolico() {
        let tmp = tempfile::tempdir().unwrap();
        let radice = tmp.path().join("progetti");
        std::fs::create_dir_all(&radice).unwrap();
        std::fs::create_dir_all(tmp.path().join("fuori")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("fuori"), radice.join("scorciatoia")).unwrap();
        assert!(
            dentro_radice(&radice, &radice.join("scorciatoia")).is_err(),
            "un link dentro la radice che punta fuori è fuori"
        );
    }

    /// La forma che usa l'**upload**: la cartella di un'azienda che non esiste
    /// ancora, sotto la radice che esiste.
    ///
    /// Fino al 07-10-2026 `upload_project_zip` non passava da qui affatto:
    /// faceva `create_dir_all` su qualunque percorso assoluto gli arrivasse.
    /// `create_project` era stato corretto il 09-09 con Q46, l'upload no — e
    /// il buco e rimasto aperto un mese, su una rotta che fino a ieri era
    /// perfino pre-auth.

    /// La soglia che avvisa e il limite che rifiuta sono due cose diverse.
    ///
    /// Decisione del maintainer dell'08-10-2026: avvisa prima, rifiuta al
    /// limite. Senza tetto non si avvisa e non si rifiuta — e il caso
    /// normale, e misurare costerebbe per niente.
    #[test]
    fn la_quota_avvisa_prima_e_rifiuta_al_limite() {
        use super::StatoQuota;
        let q = |usato: u64, massimo: Option<u64>| StatoQuota { usato, massimo };

        // Nessun tetto: niente da dire.
        assert!(!q(1_000_000, None).vicina());
        assert!(!q(1_000_000, None).piena());

        // Sotto la soglia: silenzio.
        assert!(!q(80, Some(100)).vicina());

        // Dalla soglia in su: avvisa, ma non ferma.
        assert!(q(85, Some(100)).vicina());
        assert!(!q(85, Some(100)).piena());
        assert!(q(99, Some(100)).vicina());
        assert!(!q(99, Some(100)).piena());

        // Al limite, e oltre: ferma. «Vicina» resta vero — chi e oltre e
        // anche vicino, e l'avviso non deve sparire proprio quando serve.
        assert!(q(100, Some(100)).piena());
        assert!(q(100, Some(100)).vicina());
        assert!(q(250, Some(100)).piena());

        // Tetto a zero: non e' «nessun tetto», e' «niente spazio». Fino al
        // 09-10-2026 valeva il contrario, e contraddiceva la stessa colonna
        // sui progetti aperti, dove zero e' uno stato legittimo.
        assert!(q(5, Some(0)).piena());
        assert!(q(0, Some(0)).piena());
        // E assente resta assente: non limita niente.
        assert!(!q(1_000_000, None).piena());
    }

    /// La stessa regola, data in **cartelle** invece che in nomi: è così che
    /// la usa `risolvi_progetto` per decidere se un indirizzo è tuo.
    ///
    /// Sta qui, accanto all'altro, perché la funzione è una sola: se
    /// qualcuno ne scrivesse una seconda per le cartelle, questi due test
    /// resterebbero verdi mentre le due regole divergono.
    #[test]
    fn la_stessa_regola_vale_per_le_cartelle() {
        use super::visibilita;
        let mie_cartelle = vec!["sws".to_string()];

        // `-` nell'indirizzo = azienda implicita = `None` qui.
        assert_eq!(visibilita(None, &mie_cartelle, true, false), Some(false));
        assert_eq!(visibilita(None, &mie_cartelle, false, false), None);
        assert_eq!(visibilita(Some("sws"), &mie_cartelle, false, false), Some(false));
        // Un'azienda che non e tua: 404, perche `None` qui diventa 404 la.
        assert_eq!(visibilita(Some("pixsys"), &mie_cartelle, true, false), None);
        // L'amministratore di piattaforma passa, come nell'elenco.
        assert_eq!(visibilita(Some("pixsys"), &mie_cartelle, true, true), Some(true));
    }

    /// Il segmento dell'azienda si ricava da **dove sta** il progetto.
    #[test]
    fn il_segmento_viene_dal_percorso() {
        use super::segmento_da_percorso;
        let radice = StdPath::new("/progetti");
        // Subito sotto la radice: azienda implicita.
        assert_eq!(segmento_da_percorso(radice, StdPath::new("/progetti/impianto")), "-");
        // Un livello piu sotto: la cartella e l'azienda.
        assert_eq!(segmento_da_percorso(radice, StdPath::new("/progetti/acme/impianto")), "acme");
        // Fuori dalla radice — un progetto «esterno» — non sta in nessuna
        // azienda: implicita, come e sempre stato.
        assert_eq!(segmento_da_percorso(radice, StdPath::new("/altrove/impianto")), "-");
        // Due livelli sotto non e una cartella d'azienda: non si inventa
        // un'azienda da un percorso che non ha quella forma.
        assert_eq!(segmento_da_percorso(radice, StdPath::new("/progetti/a/b/impianto")), "-");
    }

    /// Chi non e di quell'azienda non vede quei progetti; l'amministratore di
    /// piattaforma li vede contrassegnati.
    ///
    /// Prima del 07-10-2026 non c'era nessun filtro: la scansione trovava le
    /// cartelle di tutte le aziende e le serviva a chiunque fosse collegato.
    #[test]
    fn i_progetti_di_un_altra_azienda_non_si_vedono() {
        use super::visibilita;
        let mie = vec!["Soligonet".to_string()];

        // I propri: visibili e non contrassegnati.
        assert_eq!(visibilita(Some("Soligonet"), &mie, false, false), Some(false));
        // Quelli dell'azienda implicita, se ne fai parte.
        assert_eq!(visibilita(None, &mie, true, false), Some(false));
        assert_eq!(visibilita(None, &mie, false, false), None);
        // Di un'altra azienda: invisibili a chi non amministra la piattaforma.
        assert_eq!(visibilita(Some("Pixsys"), &mie, true, false), None);
        // E visibili, contrassegnati, a chi la amministra.
        assert_eq!(visibilita(Some("Pixsys"), &mie, true, true), Some(true));
        // Anche l'amministratore vede i PROPRI senza contrassegno: il
        // contrassegno dice «non e tua», non «sei amministratore».
        assert_eq!(visibilita(Some("Soligonet"), &mie, true, true), Some(false));
    }

    #[test]
    fn una_cartella_di_azienda_nuova_si_puo_creare_ma_solo_dentro_la_radice() {
        let d = tempfile::tempdir().unwrap();
        let radice = d.path();

        // Il caso buono: `<radice>/acme` non esiste, la radice si.
        let ok = dentro_radice_nuovo(radice, &radice.join("acme"));
        assert!(ok.is_ok(), "cartella d'azienda nuova rifiutata: {ok:?}");

        // Un livello inventato in piu: il genitore non esiste, si rifiuta.
        assert!(dentro_radice_nuovo(radice, &radice.join("acme").join("impianto")).is_err());

        // Fuori dalla radice: rifiutato anche se il genitore esiste.
        assert!(dentro_radice_nuovo(radice, &PathBuf::from("/tmp/altrove-sws")).is_err());

        // Risalita mascherata.
        assert!(dentro_radice_nuovo(radice, &radice.join("..").join("fuori")).is_err());
    }

    #[test]
    fn dentro_radice_nuovo_accetta_solo_un_nome_semplice_sotto_un_genitore_esistente() {
        let tmp = tempfile::tempdir().unwrap();
        let radice = tmp.path().join("progetti");
        std::fs::create_dir_all(&radice).unwrap();
        assert!(dentro_radice_nuovo(&radice, &radice.join("nuova")).is_ok());
        assert!(
            dentro_radice_nuovo(&radice, &radice.join("manca/nuova")).is_err(),
            "genitore inesistente"
        );
        assert!(
            dentro_radice_nuovo(&radice, &tmp.path().join("nuova")).is_err(),
            "genitore fuori"
        );
        assert!(dentro_radice_nuovo(&radice, &radice.join("..")).is_err());
    }
}

// ── Passo 2, sotto-passo 2c: migrazione automatica dei segreti ─────────────
#[cfg(test)]
mod segreti_migrazione_tests {
    use super::*;

    fn progetto_con_token_in_chiaro(dir: &std::path::Path) {
        std::fs::write(
            dir.join("project.yaml"),
            "meta: { name: p, version: \"1\" }\ntags: []\n\
             notifications:\n  telegram: { bot_token: tg-vecchio, chat_ids: [] }\n",
        )
        .unwrap();
    }

    /// Il caso che conta: un progetto con un token in chiaro (com'è ogni
    /// progetto salvato prima di questa sessione) viene backuppato **prima**
    /// e poi migrato.
    #[test]
    fn un_progetto_con_token_in_chiaro_viene_backuppato_e_migrato() {
        let dir = tempfile::tempdir().unwrap();
        progetto_con_token_in_chiaro(dir.path());

        let n = migra_segreti_se_serve(dir.path());
        assert_eq!(n, Some(1));

        assert!(dir.path().join("secrets.yaml").exists());
        let project_yaml = std::fs::read_to_string(dir.path().join("project.yaml")).unwrap();
        assert!(!project_yaml.contains("tg-vecchio"), "{project_yaml}");

        let backups = crate::backups::list_backups(dir.path());
        assert_eq!(
            backups.len(),
            1,
            "deve esserci un backup, fatto prima della migrazione"
        );
    }

    /// Idempotenza esplicitamente richiesta dal piano: «secondo avvio:
    /// nessuna nuova migrazione». Niente secondo backup, nessuna riscrittura.
    #[test]
    fn un_secondo_giro_non_migra_e_non_backuppa_di_nuovo() {
        let dir = tempfile::tempdir().unwrap();
        progetto_con_token_in_chiaro(dir.path());
        assert_eq!(migra_segreti_se_serve(dir.path()), Some(1));
        assert_eq!(migra_segreti_se_serve(dir.path()), None);
        assert_eq!(
            crate::backups::list_backups(dir.path()).len(),
            1,
            "il secondo giro non deve produrre un secondo backup"
        );
    }

    /// Un progetto senza nessun segreto in chiaro (il caso normale, dopo 2a/2b)
    /// non produce nessun backup: aprirlo non deve costare un backup a ogni giro.
    #[test]
    fn un_progetto_senza_segreti_non_produce_backup() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("project.yaml"),
            "meta: { name: p, version: \"1\" }\ntags: []\n",
        )
        .unwrap();
        assert_eq!(migra_segreti_se_serve(dir.path()), None);
        assert!(crate::backups::list_backups(dir.path()).is_empty());
    }
}
