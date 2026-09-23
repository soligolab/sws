//! Segreti di progetto: un file solo, `secrets.yaml`, invece di sette campi
//! in chiaro sparsi in `project.yaml` (Passo 2 di
//! `docs/plans/2026-09-21-sessione-stabilizzazione.md`, sotto-passo 2a —
//! piano approvato dal maintainer il 22-09-2026: tutti e sette i campi, il
//! dispositivo tiene il suo `secrets.yaml` se un deploy non lo porta,
//! `.gitignore` anche nei repository già esistenti, `tls.key` a 0600 nello
//! stesso Passo, backup vecchi solo avvertiti — non riscritti).
//!
//! # Perché
//!
//! `TelegramConfig.bot_token`, `SmtpConfig.password`, `MqttConfig.password`,
//! `HomeAssistantConfig.token`, `OpcUaAuth::UsernamePassword.password`,
//! `DatastoreBackendConfig::Postgres.password` e `::Odbc.connection_string`
//! viaggiano oggi dentro `project.yaml`: in chiaro nei backup, nell'export e
//! in un repository git. Quattro di questi sette (HA, OPC-UA, Postgres, ODBC)
//! sfuggono anche alla maschera di redazione che copre solo MQTT/SMTP/
//! Telegram, quindi arrivano in chiaro pure al browser (`GET /api/project`) e
//! al fornitore LLM esterno (`leggi_progetto`) — misurato il 21-09-2026.
//!
//! # Cosa fa questo modulo
//!
//! [`estrai`] toglie i sette valori da un [`Project`](crate::project::Project)
//! e li ritorna in una mappa piatta **chiave → valore**, con chiavi stabili
//! per **id** (non per posizione: l'ordine delle sorgenti in un array cambia,
//! l'id no). [`applica`] li rimette, **senza sovrascrivere** un valore già
//! presente — un `project.yaml` con un segreto ancora in chiaro (un progetto
//! pre-migrazione) vince, ed è proprio quel segnale che dice «questo progetto
//! va migrato» (sotto-passo 2c, non qui). [`scrivi_progetto`] è l'unico punto
//! di scrittura: chi lo chiama non tocca mai `project.yaml`/`secrets.yaml` a
//! mano. Dove i due file viaggiano — deploy, backup, export, git — è il
//! sotto-passo 2d/2e; questo modulo non lo decide.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Context;

use crate::project::{DatastoreBackendConfig, OpcUaAuth, Project, SourceDef};

/// I segreti di un progetto, come mappa piatta chiave→valore. `BTreeMap` (non
/// `HashMap`): `secrets.yaml` deve restare diffabile a occhio da un umano che
/// lo apre per curiosità o per un backup a mano, e un ordine stabile conta
/// più della velocità di costruzione — sette-quindici voci non pesano.
pub type Segreti = BTreeMap<String, String>;

fn chiave_sorgente(id: &str, campo: &str) -> String {
    format!("sources.{id}.{campo}")
}
fn chiave_datastore(id: &str, campo: &str) -> String {
    format!("datastores.{id}.{campo}")
}

/// I campi che la tabella copre, nella forma `Tipo.campo` — dove `Tipo` è la
/// struct o la **variante** di enum che li dichiara in `project.rs`.
///
/// È l'unico pezzo di questo modulo che non serve al codice: serve alla
/// guardia `scripts/check_segreti.sh`, che elenca i campi di `project.rs` il
/// cui nome somiglia a un segreto (`pass|token|secret|key|pwd|
/// connection_string`) e pretende che ognuno sia o qui dentro o in un elenco
/// di eccezioni motivato. La classe di difetto che chiude è «campo segreto
/// nuovo dimenticato»: senza, un `api_key` aggiunto fra sei mesi nascerebbe in
/// chiaro in `project.yaml`, nell'export e verso il modello, e nessun test
/// esistente se ne accorgerebbe.
///
/// Un elenco a mano che duplica il codice sarebbe la stessa malattia che si
/// vuole curare: per questo un test verifica che sia lungo quanto i segreti
/// che [`estrai`] tira fuori dal progetto di prova, che i sette campi li ha
/// tutti pieni.
pub const CAMPI_COPERTI: [&str; 7] = [
    "TelegramConfig.bot_token",
    "SmtpConfig.password",
    "MqttConfig.password",
    "HomeAssistantConfig.token",
    "UsernamePassword.password", // variante di OpcUaAuth
    "Postgres.password",         // variante di DatastoreBackendConfig
    "Odbc.connection_string",    // idem — può contenere `PWD=`
];

/// Toglie i sette valori-segreto dal progetto (campo vuoto / `None`) e li
/// ritorna in una mappa. Un campo già vuoto non produce una chiave: una mappa
/// senza `sources.x.password` vuol dire «questa sorgente non ha una
/// password», non «ce l'ha e vale la stringa vuota» — la differenza conta per
/// [`applica`], che altrimenti azzererebbe un campo appena svuotato apposta.
pub fn estrai(project: &mut Project) -> Segreti {
    let mut out = estrai_notifiche(project.notifications.as_mut());
    out.append(&mut estrai_sorgenti(&mut project.sources));
    out.append(&mut estrai_datastores(&mut project.datastores));
    out
}

/// Rimette nel progetto i valori di `segreti`, **senza sovrascrivere** un
/// valore già presente — vedi il commento di modulo sulla precedenza.
pub fn applica(project: &mut Project, segreti: &Segreti) {
    applica_notifiche(project.notifications.as_mut(), segreti);
    applica_sorgenti(&mut project.sources, segreti);
    applica_datastores(&mut project.datastores, segreti);
}

// ── Le tre metà della tabella ────────────────────────────────────────────────
//
// Divise per sezione perché i gestori HTTP salvano **una sezione alla volta**
// (`PUT /api/project/sources`, `/datastores`) e ricevono un `Vec<SourceDef>`,
// non un `Project`: senza questo taglio ognuno di loro si riscriverebbe in
// casa l'elenco dei campi segreti, ed è esattamente la classe di difetto —
// «due elenchi a mano» — che questo modulo esiste per chiudere.

fn estrai_notifiche(notifiche: Option<&mut crate::project::NotificationConfig>) -> Segreti {
    let mut out = Segreti::new();
    let Some(n) = notifiche else { return out };
    if let Some(t) = n.telegram.as_mut() {
        if !t.bot_token.is_empty() {
            out.insert(
                "notifications.telegram.bot_token".into(),
                std::mem::take(&mut t.bot_token),
            );
        }
    }
    if let Some(s) = n.smtp.as_mut() {
        if let Some(p) = s.password.take() {
            out.insert("notifications.smtp.password".into(), p);
        }
    }
    out
}

fn applica_notifiche(
    notifiche: Option<&mut crate::project::NotificationConfig>,
    segreti: &Segreti,
) {
    let Some(n) = notifiche else { return };
    if let Some(t) = n.telegram.as_mut() {
        if t.bot_token.is_empty() {
            if let Some(v) = segreti.get("notifications.telegram.bot_token") {
                t.bot_token = v.clone();
            }
        }
    }
    if let Some(s) = n.smtp.as_mut() {
        if s.password.is_none() {
            if let Some(v) = segreti.get("notifications.smtp.password") {
                s.password = Some(v.clone());
            }
        }
    }
}

/// Come [`estrai`], ma sulla sola lista delle sorgenti (MQTT, HomeAssistant,
/// OPC-UA client). Le chiavi sono le stesse: `sources.<id>.<campo>`.
pub fn estrai_sorgenti(sources: &mut [SourceDef]) -> Segreti {
    let mut out = Segreti::new();
    for src in sources {
        match src {
            SourceDef::Mqtt(m) => {
                if let Some(p) = m.password.take() {
                    out.insert(chiave_sorgente(&m.id, "password"), p);
                }
            }
            SourceDef::HomeAssistant(h) => {
                if let Some(t) = h.token.take() {
                    out.insert(chiave_sorgente(&h.id, "token"), t);
                }
            }
            SourceDef::OpcUaClient(o) => {
                let id = o.id.clone();
                if let OpcUaAuth::UsernamePassword { password, .. } = &mut o.auth {
                    if let Some(p) = password.take() {
                        out.insert(chiave_sorgente(&id, "auth_password"), p);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Come [`applica`], ma sulla sola lista delle sorgenti.
pub fn applica_sorgenti(sources: &mut [SourceDef], segreti: &Segreti) {
    for src in sources {
        match src {
            SourceDef::Mqtt(m) => {
                if m.password.is_none() {
                    if let Some(v) = segreti.get(&chiave_sorgente(&m.id, "password")) {
                        m.password = Some(v.clone());
                    }
                }
            }
            SourceDef::HomeAssistant(h) => {
                if h.token.is_none() {
                    if let Some(v) = segreti.get(&chiave_sorgente(&h.id, "token")) {
                        h.token = Some(v.clone());
                    }
                }
            }
            SourceDef::OpcUaClient(o) => {
                let id = o.id.clone();
                if let OpcUaAuth::UsernamePassword { password, .. } = &mut o.auth {
                    if password.is_none() {
                        if let Some(v) = segreti.get(&chiave_sorgente(&id, "auth_password")) {
                            *password = Some(v.clone());
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// Come [`estrai`], ma sulla sola lista dei datastore (Postgres, ODBC).
pub fn estrai_datastores(datastores: &mut [crate::project::DatastoreConfig]) -> Segreti {
    let mut out = Segreti::new();
    for ds in datastores {
        let id = ds.id.clone();
        match &mut ds.backend {
            DatastoreBackendConfig::Postgres { password, .. } => {
                if let Some(p) = password.take() {
                    out.insert(chiave_datastore(&id, "password"), p);
                }
            }
            DatastoreBackendConfig::Odbc {
                connection_string, ..
            } => {
                if let Some(c) = connection_string.take() {
                    out.insert(chiave_datastore(&id, "connection_string"), c);
                }
            }
            _ => {}
        }
    }
    out
}

/// Come [`applica`], ma sulla sola lista dei datastore.
pub fn applica_datastores(datastores: &mut [crate::project::DatastoreConfig], segreti: &Segreti) {
    for ds in datastores {
        let id = ds.id.clone();
        match &mut ds.backend {
            DatastoreBackendConfig::Postgres { password, .. } => {
                if password.is_none() {
                    if let Some(v) = segreti.get(&chiave_datastore(&id, "password")) {
                        *password = Some(v.clone());
                    }
                }
            }
            DatastoreBackendConfig::Odbc {
                connection_string, ..
            } => {
                if connection_string.is_none() {
                    if let Some(v) = segreti.get(&chiave_datastore(&id, "connection_string")) {
                        *connection_string = Some(v.clone());
                    }
                }
            }
            _ => {}
        }
    }
}

// ── Maschera e ripristino (sotto-passo 2f) ───────────────────────────────────

/// Sostituisce **ogni** valore-segreto del progetto con `segnaposto` e ritorna
/// quanti ne ha sostituiti. Scritta sopra [`estrai`]/[`applica`] e non come
/// secondo elenco di campi: un campo segreto nuovo entra nella tabella una
/// volta sola e la maschera lo copre senza che nessuno se ne ricordi.
///
/// Un campo vuoto resta vuoto — mascherare il nulla direbbe al browser che una
/// password c'è quando non c'è, e al primo salvataggio il segnaposto andrebbe
/// restituito come valore vero.
pub fn maschera(project: &mut Project, segnaposto: &str) -> usize {
    let attuali = estrai(project);
    let mascherati: Segreti = attuali
        .keys()
        .map(|k| (k.clone(), segnaposto.to_string()))
        .collect();
    applica(project, &mascherati);
    mascherati.len()
}

/// Il giro inverso della maschera, sulle mappe: ogni valore uguale a
/// `segnaposto` torna al valore `precedenti` con la stessa chiave; se la chiave
/// non c'era prima, sparisce (il campo resta vuoto — un segnaposto senza un
/// passato non è una credenziale). I valori diversi dal segnaposto passano
/// come sono: sono quelli che l'operatore ha davvero scritto.
///
/// Sta sulle mappe e non sul `Project` perché i gestori salvano una sezione
/// alla volta: si estrae dalla sezione nuova, si ripristina, si riapplica.
pub fn ripristina(attuali: Segreti, precedenti: &Segreti, segnaposto: &str) -> Segreti {
    attuali
        .into_iter()
        .filter_map(|(k, v)| {
            if v == segnaposto {
                precedenti.get(&k).map(|vecchio| (k, vecchio.clone()))
            } else {
                Some((k, v))
            }
        })
        .collect()
}

/// Legge `<project_dir>/secrets.yaml`, se c'è. Un file assente non è un
/// errore (progetto senza segreti, o non ancora migrato): `None`. Un file
/// presente ma illeggibile **è** un errore — un segreto che non si carica non
/// deve sembrare un segreto assente, altrimenti il salvataggio successivo lo
/// cancellerebbe credendolo mai esistito.
pub fn leggi_segreti(project_dir: &Path) -> anyhow::Result<Option<Segreti>> {
    let path = project_dir.join("secrets.yaml");
    if !path.exists() {
        return Ok(None);
    }
    let testo =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    let segreti: Segreti =
        serde_yaml::from_str(&testo).with_context(|| format!("parsing {}", path.display()))?;
    Ok(Some(segreti))
}

/// Scrive `<project_dir>/secrets.yaml` in modo atomico e con permessi 0600
/// impostati **alla creazione** del file temporaneo — non con un `chmod`
/// dopo, che lascerebbe una finestra in cui il contenuto sensibile è già sul
/// disco con i permessi larghi dell'umask. Una mappa vuota **cancella** un
/// `secrets.yaml` preesistente invece di scriverne uno vuoto: un progetto
/// tornato senza segreti (l'ultimo tolto a mano) non deve tenersi un file
/// morto per sempre.
///
/// Pubblica (non solo usata da [`scrivi_progetto`]): `patch_project_se` in
/// `sws-web` la chiama da sola, perché deve continuare a scrivere
/// `project.yaml` col proprio `merge_preserved` (le chiavi che questo binario
/// non conosce) invece che con `Project::save_to` — [`scrivi_progetto`]
/// scriverebbe un `project.yaml` che perde quelle chiavi.
pub fn scrivi_segreti(project_dir: &Path, segreti: &Segreti) -> anyhow::Result<()> {
    let path = project_dir.join("secrets.yaml");
    if segreti.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).with_context(|| format!("removing {}", path.display()))?;
        }
        return Ok(());
    }
    let yaml = serde_yaml::to_string(segreti).context("serializing secrets.yaml")?;
    scrivi_atomico_0600(&path, yaml.as_bytes())
        .with_context(|| format!("writing {}", path.display()))
}

/// Scrittura atomica con permessi 0600: un file temporaneo nella STESSA
/// cartella (`rename` è atomico solo sullo stesso filesystem), creato già a
/// 0600 (`OpenOptionsExt::mode`, non un `chmod` successivo), poi sostituito
/// al file finale con `rename` — mai una finestra con permessi larghi o
/// contenuto a metà.
/// Pubblica dal 2f: la usa anche chi scrive `tls.key` (`sws-web::system`,
/// `sws-runtime::main`), che fino al 22-09-2026 lo lasciava a 0644 — una
/// chiave privata leggibile da ogni utente della macchina. Un segreto è un
/// segreto anche quando non sta in `secrets.yaml`, e la regola «permessi alla
/// creazione, non con un chmod dopo» vale identica.
pub fn scrivi_atomico_0600(path: &Path, dati: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let mut nome_tmp = path.file_name().unwrap_or_default().to_os_string();
    nome_tmp.push(format!(".{n}.tmp"));
    let tmp = path.with_file_name(nome_tmp);

    let scritto = (|| {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
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

/// Carica `<project_dir>/project.yaml`, applicando `secrets.yaml` sopra se
/// c'è. È quello che [`Project::load`](crate::project::Project::load)
/// chiama: **tutti** i lettori (IA, browse, plugin, `soft_reload_project`,
/// `open_project`…) vedono i valori veri senza dover sapere che i segreti
/// vivono altrove.
pub fn carica_progetto(project_dir: &Path) -> anyhow::Result<Project> {
    let mut project = Project::load_senza_segreti(project_dir)?;
    if let Some(segreti) = leggi_segreti(project_dir)? {
        applica(&mut project, &segreti);
    }
    Ok(project)
}

/// Quanti dei sette segreti sono ancora in chiaro dentro `project.yaml`
/// (`secrets.yaml` non li ha mai visti). Sola lettura: non tocca il disco.
/// Serve a chi chiama [`migra`] per decidere **prima** se vale la pena fare
/// un backup — un progetto già migrato non deve produrne uno a ogni apertura.
pub fn segreti_in_chiaro(project_dir: &Path) -> anyhow::Result<usize> {
    let mut project = Project::load_senza_segreti(project_dir)?;
    Ok(estrai(&mut project).len())
}

/// Sposta in `secrets.yaml` i segreti ancora in chiaro in `project.yaml` e
/// ritorna quanti ne ha spostati (0 se non c'era niente da fare — non scrive
/// nulla in quel caso). **Non fa un backup**: sotto-passo 2c, il piano vuole
/// un backup PRIMA di questa chiamata, e sws-core non conosce
/// `sws-web::backups` — è compito del chiamante (`migra_segreti_se_serve` in
/// sws-web), che infatti chiama prima [`segreti_in_chiaro`] per decidere se
/// backuppare, poi questa.
pub fn migra(project_dir: &Path) -> anyhow::Result<usize> {
    let mut project = Project::load_senza_segreti(project_dir)?;
    let segreti = estrai(&mut project);
    if segreti.is_empty() {
        return Ok(0);
    }
    let n = segreti.len();
    scrivi_segreti(project_dir, &segreti)?;
    project.save_to(project_dir)?;
    Ok(n)
}

/// L'unico punto di scrittura di un progetto: [`estrai`] i sette segreti,
/// scrive `secrets.yaml` (atomico, 0600) **prima**, poi `project.yaml` senza
/// segreti. Se il processo muore fra i due file, i due contenuti restano
/// comunque coerenti fra loro (il segreto è già altrove); al salvataggio
/// successivo `estrai` lo toglierebbe di nuovo da `project.yaml`, quindi non
/// c'è nessuna finestra in cui un segreto sparisce.
pub fn scrivi_progetto(project_dir: &Path, project: &mut Project) -> anyhow::Result<()> {
    let segreti = estrai(project);
    scrivi_segreti(project_dir, &segreti)?;
    project.save_to(project_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un progetto minimo con un valore-segreto in ognuno dei sette campi,
    /// costruito da YAML (non da letterali di struct) per non dover elencare
    /// ogni campo non-segreto e non romperlo a ogni campo nuovo aggiunto
    /// altrove — lo stesso idioma di `PROGETTO` in `sws-web/src/validate.rs`.
    fn progetto_con_segreti() -> Project {
        serde_yaml::from_str(
            r#"
meta: { name: p, version: "1" }
tags: []
sources:
  - { kind: mqtt, id: mq1, host: h, topics: [], password: mqtt-secret }
  - { kind: homeassistant, id: ha1, url: "http://h", entities: [], token: ha-secret }
  - kind: opcua_client
    id: ua1
    endpoint_url: "opc.tcp://h"
    nodes: []
    auth: { kind: username_password, username: u, password: ua-secret }
alarms: []
datastores:
  - id: pg1
    label: Postgres
    backend:
      kind: postgres
      host: h
      database: d
      username: u
      password: pg-secret
  - id: odbc1
    label: ODBC
    backend:
      kind: odbc
      connection_string: "DRIVER={x};PWD=odbc-secret"
notifications:
  smtp: { host: h, from: f, password: smtp-secret }
  telegram: { bot_token: tg-secret, chat_ids: [] }
"#,
        )
        .expect("progetto di prova con segreti")
    }

    /// Round-trip per ognuno dei sette campi: estrai poi applica su un
    /// progetto ripulito ritorna gli stessi valori.
    #[test]
    fn estrai_e_applica_sono_un_round_trip_sui_sette_campi() {
        let mut originale = progetto_con_segreti();
        let segreti = estrai(&mut originale);
        assert_eq!(segreti.len(), 7, "{segreti:?}");

        // Dopo estrai, il progetto non contiene più nessun valore-segreto.
        assert_eq!(
            originale
                .notifications
                .as_ref()
                .unwrap()
                .telegram
                .as_ref()
                .unwrap()
                .bot_token,
            ""
        );
        assert!(originale
            .notifications
            .as_ref()
            .unwrap()
            .smtp
            .as_ref()
            .unwrap()
            .password
            .is_none());
        let SourceDef::Mqtt(m) = &originale.sources[0] else {
            panic!()
        };
        assert!(m.password.is_none());
        let SourceDef::HomeAssistant(h) = &originale.sources[1] else {
            panic!()
        };
        assert!(h.token.is_none());
        let SourceDef::OpcUaClient(o) = &originale.sources[2] else {
            panic!()
        };
        let OpcUaAuth::UsernamePassword { password, .. } = &o.auth else {
            panic!()
        };
        assert!(password.is_none());
        let DatastoreBackendConfig::Postgres { password, .. } = &originale.datastores[0].backend
        else {
            panic!()
        };
        assert!(password.is_none());
        let DatastoreBackendConfig::Odbc {
            connection_string, ..
        } = &originale.datastores[1].backend
        else {
            panic!()
        };
        assert!(connection_string.is_none());

        // applica rimette tutto.
        applica(&mut originale, &segreti);
        let dopo = progetto_con_segreti();
        assert_eq!(
            originale
                .notifications
                .as_ref()
                .unwrap()
                .telegram
                .as_ref()
                .unwrap()
                .bot_token,
            dopo.notifications
                .as_ref()
                .unwrap()
                .telegram
                .as_ref()
                .unwrap()
                .bot_token,
        );
        let SourceDef::Mqtt(m2) = &originale.sources[0] else {
            panic!()
        };
        assert_eq!(m2.password.as_deref(), Some("mqtt-secret"));
        let SourceDef::HomeAssistant(h2) = &originale.sources[1] else {
            panic!()
        };
        assert_eq!(h2.token.as_deref(), Some("ha-secret"));
        let SourceDef::OpcUaClient(o2) = &originale.sources[2] else {
            panic!()
        };
        let OpcUaAuth::UsernamePassword { password: p2, .. } = &o2.auth else {
            panic!()
        };
        assert_eq!(p2.as_deref(), Some("ua-secret"));
        let DatastoreBackendConfig::Postgres { password: p3, .. } =
            &originale.datastores[0].backend
        else {
            panic!()
        };
        assert_eq!(p3.as_deref(), Some("pg-secret"));
        let DatastoreBackendConfig::Odbc {
            connection_string: c4,
            ..
        } = &originale.datastores[1].backend
        else {
            panic!()
        };
        assert_eq!(c4.as_deref(), Some("DRIVER={x};PWD=odbc-secret"));
    }

    /// Il progetto serializzato dopo `estrai` non contiene NESSUN valore in
    /// chiaro dei sette campi: non un segnaposto, niente — la stringa stessa
    /// non compare da nessuna parte nello YAML.
    #[test]
    fn il_progetto_serializzato_non_contiene_i_valori_segreti() {
        let mut p = progetto_con_segreti();
        estrai(&mut p);
        let yaml = serde_yaml::to_string(&p).unwrap();
        for segreto in [
            "tg-secret",
            "smtp-secret",
            "mqtt-secret",
            "ha-secret",
            "ua-secret",
            "pg-secret",
            "odbc-secret",
        ] {
            assert!(
                !yaml.contains(segreto),
                "«{segreto}» è ancora nel progetto serializzato:\n{yaml}"
            );
        }
    }

    /// `applica` con un segreto assente dalla mappa: il progetto resta
    /// invariato (campo vuoto/`None`), non produce un valore fasullo.
    #[test]
    fn applica_con_segreto_assente_non_tocca_il_campo() {
        let mut p = progetto_con_segreti();
        estrai(&mut p);
        applica(&mut p, &Segreti::new());
        assert_eq!(
            p.notifications
                .as_ref()
                .unwrap()
                .telegram
                .as_ref()
                .unwrap()
                .bot_token,
            ""
        );
        let SourceDef::Mqtt(m) = &p.sources[0] else {
            panic!()
        };
        assert!(m.password.is_none());
    }

    /// Precedenza: un progetto con un segreto ANCORA in chiaro (non ancora
    /// migrato) vince su quello — diverso — presente in `secrets.yaml`.
    #[test]
    fn un_valore_gia_in_chiaro_vince_su_quello_in_secrets_yaml() {
        let mut p = progetto_con_segreti(); // bot_token = "tg-secret", in chiaro
        let mut altro: Segreti = Segreti::new();
        altro.insert(
            "notifications.telegram.bot_token".into(),
            "vecchio-diverso".into(),
        );
        applica(&mut p, &altro);
        assert_eq!(
            p.notifications.unwrap().telegram.unwrap().bot_token,
            "tg-secret",
            "il valore già in chiaro nel progetto non va sovrascritto"
        );
    }

    /// `scrivi_progetto`/`carica_progetto`: round-trip completo su disco, coi
    /// permessi giusti su `secrets.yaml`.
    #[test]
    fn scrivi_e_carica_progetto_fanno_un_round_trip_su_disco() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = progetto_con_segreti();
        scrivi_progetto(dir.path(), &mut p).unwrap();

        let secrets_path = dir.path().join("secrets.yaml");
        assert!(secrets_path.exists());
        let perm = std::fs::metadata(&secrets_path).unwrap().permissions();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(perm.mode() & 0o777, 0o600, "secrets.yaml deve essere 0600");

        // project.yaml su disco non contiene i segreti.
        let project_yaml = std::fs::read_to_string(dir.path().join("project.yaml")).unwrap();
        assert!(!project_yaml.contains("tg-secret"));

        let ricaricato = carica_progetto(dir.path()).unwrap();
        assert_eq!(
            ricaricato
                .notifications
                .unwrap()
                .telegram
                .unwrap()
                .bot_token,
            "tg-secret"
        );
    }

    /// Una mappa vuota non scrive `secrets.yaml`: un progetto senza segreti
    /// non deve produrne uno vuoto a ogni salvataggio.
    #[test]
    fn un_progetto_senza_segreti_non_produce_secrets_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let mut p: Project =
            serde_yaml::from_str("meta: { name: p, version: \"1\" }\ntags: []\n").unwrap();
        scrivi_progetto(dir.path(), &mut p).unwrap();
        assert!(!dir.path().join("secrets.yaml").exists());
    }

    /// `segreti_in_chiaro`/`migra`: un progetto con un token ancora in chiaro
    /// (mai passato da `scrivi_progetto`, com'è ogni progetto pre-2a) viene
    /// contato e poi spostato; un secondo giro non trova più niente.
    #[test]
    fn segreti_in_chiaro_e_migra_su_un_progetto_pre_esistente() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("project.yaml"),
            "meta: { name: p, version: \"1\" }\ntags: []\n\
             notifications:\n  telegram: { bot_token: tg-vecchio, chat_ids: [] }\n",
        )
        .unwrap();

        assert_eq!(segreti_in_chiaro(dir.path()).unwrap(), 1);
        assert_eq!(migra(dir.path()).unwrap(), 1);

        let project_yaml = std::fs::read_to_string(dir.path().join("project.yaml")).unwrap();
        assert!(!project_yaml.contains("tg-vecchio"), "{project_yaml}");
        assert!(dir.path().join("secrets.yaml").exists());

        // Secondo giro: niente più da contare né da spostare, e nessuna
        // riscrittura (idempotenza — il piano lo chiede esplicitamente:
        // "secondo avvio: nessuna nuova migrazione").
        assert_eq!(segreti_in_chiaro(dir.path()).unwrap(), 0);
        assert_eq!(migra(dir.path()).unwrap(), 0);

        let ricaricato = carica_progetto(dir.path()).unwrap();
        assert_eq!(
            ricaricato
                .notifications
                .unwrap()
                .telegram
                .unwrap()
                .bot_token,
            "tg-vecchio"
        );
    }

    /// Un progetto già migrato (nessun segreto in chiaro) non produce falsi
    /// positivi: `segreti_in_chiaro` è 0 anche quando `secrets.yaml` esiste
    /// già e il progetto lo usa regolarmente.
    #[test]
    fn un_progetto_gia_migrato_non_ha_nulla_da_migrare() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = progetto_con_segreti();
        scrivi_progetto(dir.path(), &mut p).unwrap();
        assert_eq!(segreti_in_chiaro(dir.path()).unwrap(), 0);
        assert_eq!(migra(dir.path()).unwrap(), 0);
    }

    /// Tutti i template del parco (senza segreti: già `token_env`/simili)
    /// caricano com'erano — nessuna regressione da `Project::load`.
    #[test]
    fn i_template_caricano_come_prima() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../examples/templates");
        let mut trovati = 0;
        for entry in std::fs::read_dir(&dir).expect("examples/templates deve esistere") {
            let entry = entry.unwrap();
            if !entry.path().join("project.yaml").exists() {
                continue;
            }
            trovati += 1;
            Project::load(&entry.path())
                .unwrap_or_else(|e| panic!("{}: {e:#}", entry.path().display()));
        }
        assert!(trovati >= 10, "trovati solo {trovati} template");
    }
    // ── 2f: maschera e ripristino ───────────────────────────────────────────

    /// L'elenco per la guardia non è un secondo elenco a mano: deve coprire
    /// esattamente i segreti che `estrai` sa tirare fuori, né uno di più né
    /// uno di meno. Se domani la tabella cresce, questo test cade prima della
    /// guardia e dice dove.
    #[test]
    fn campi_coperti_dice_il_vero() {
        let mut p = progetto_con_segreti();
        assert_eq!(CAMPI_COPERTI.len(), estrai(&mut p).len());
    }

    /// I sette valori: quello che la maschera deve far sparire, e quello che
    /// il salvataggio deve saper ritrovare.
    const VALORI: [&str; 7] = [
        "mqtt-secret",
        "ha-secret",
        "ua-secret",
        "pg-secret",
        "odbc-secret",
        "smtp-secret",
        "tg-secret",
    ];

    /// La ragione per cui esiste il 2f: prima la maschera ne copriva tre e
    /// quattro uscivano in chiaro verso il browser e verso il modello.
    #[test]
    fn la_maschera_copre_tutti_e_sette_i_campi() {
        let mut p = progetto_con_segreti();
        assert_eq!(maschera(&mut p, "********"), 7);
        let yaml = serde_yaml::to_string(&p).unwrap();
        for v in VALORI {
            assert!(!yaml.contains(v), "«{v}» è uscito in chiaro:\n{yaml}");
        }
    }

    /// Un campo vuoto resta vuoto: mascherare il nulla direbbe al browser che
    /// una credenziale c'è, e al primo salvataggio il segnaposto tornerebbe
    /// indietro come valore vero.
    #[test]
    fn la_maschera_non_inventa_segreti_dove_non_ce_ne_sono() {
        let mut p: Project = serde_yaml::from_str(
            r#"
meta: { name: p, version: "1" }
tags: []
sources:
  - { kind: mqtt, id: mq1, host: h, topics: [] }
alarms: []
"#,
        )
        .unwrap();
        assert_eq!(maschera(&mut p, "********"), 0);
        let yaml = serde_yaml::to_string(&p).unwrap();
        assert!(!yaml.contains("********"), "{yaml}");
    }

    /// Le tre regole del ripristino, in un colpo: il segnaposto torna al
    /// valore di prima, un segnaposto senza passato **sparisce** (non si
    /// scrive «********» come password), un valore nuovo passa intatto.
    #[test]
    fn ripristina_distingue_segnaposto_passato_e_valore_nuovo() {
        let precedenti: Segreti = [
            ("a".to_string(), "vecchio".to_string()),
            ("c".to_string(), "mai-usato".to_string()),
        ]
        .into_iter()
        .collect();
        let attuali: Segreti = [
            ("a".to_string(), "********".to_string()),
            ("b".to_string(), "********".to_string()),
            ("d".to_string(), "scritto-adesso".to_string()),
        ]
        .into_iter()
        .collect();

        let finali = ripristina(attuali, &precedenti, "********");
        assert_eq!(finali.get("a").map(String::as_str), Some("vecchio"));
        assert_eq!(
            finali.get("b"),
            None,
            "un segnaposto senza passato sparisce"
        );
        assert_eq!(finali.get("d").map(String::as_str), Some("scritto-adesso"));
        assert_eq!(finali.len(), 2);
    }

    /// Il giro che fa davvero `PUT /api/project/sources`: l'IDE ha ricevuto le
    /// sorgenti mascherate, le rimanda com'erano cambiando altro (qui l'host),
    /// e sul disco le credenziali devono restare quelle vere.
    #[test]
    fn un_salvataggio_di_sezione_col_segnaposto_non_perde_le_credenziali() {
        let vero = progetto_con_segreti();
        let mut precedente = progetto_con_segreti();
        let precedenti = estrai_sorgenti(&mut precedente.sources);

        let mut dall_ide = progetto_con_segreti();
        maschera(&mut dall_ide, "********");
        if let SourceDef::Mqtt(m) = &mut dall_ide.sources[0] {
            m.host = "altro-host".into();
        }

        let attuali = estrai_sorgenti(&mut dall_ide.sources);
        let finali = ripristina(attuali, &precedenti, "********");
        applica_sorgenti(&mut dall_ide.sources, &finali);

        assert_eq!(
            serde_yaml::to_string(&dall_ide.sources[1..]).unwrap(),
            serde_yaml::to_string(&vero.sources[1..]).unwrap(),
            "HomeAssistant e OPC-UA devono tornare identici"
        );
        let SourceDef::Mqtt(m) = &dall_ide.sources[0] else {
            panic!("la prima sorgente è MQTT")
        };
        assert_eq!(m.password.as_deref(), Some("mqtt-secret"));
        assert_eq!(m.host, "altro-host", "la modifica vera deve passare");
    }

    /// E il caso opposto: una password davvero cambiata **sostituisce** quella
    /// vecchia. Senza questo, il ripristino sarebbe una prigione.
    #[test]
    fn una_password_nuova_sostituisce_quella_vecchia() {
        let mut precedente = progetto_con_segreti();
        let precedenti = estrai_sorgenti(&mut precedente.sources);

        let mut dall_ide = progetto_con_segreti();
        maschera(&mut dall_ide, "********");
        if let SourceDef::Mqtt(m) = &mut dall_ide.sources[0] {
            m.password = Some("password-nuova".into());
        }

        let attuali = estrai_sorgenti(&mut dall_ide.sources);
        let finali = ripristina(attuali, &precedenti, "********");
        applica_sorgenti(&mut dall_ide.sources, &finali);

        let SourceDef::Mqtt(m) = &dall_ide.sources[0] else {
            panic!("la prima sorgente è MQTT")
        };
        assert_eq!(m.password.as_deref(), Some("password-nuova"));
    }
}
