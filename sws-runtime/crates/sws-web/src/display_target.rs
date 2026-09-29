//! Quale motore di rendering deve occupare lo schermo del pannello (Q25), e la
//! commutazione vera e propria, **dal runtime, via D-Bus** (Fase 4 del piano
//! `docs/plans/2026-09-27-aggiornamento-runtime-e-bus-utente.md`, 29-09-2026).
//!
//! Il progetto lo dichiara: `target.kind` vale `web`, `lvgl_framebuffer` o
//! `lvgl_wayland`.
//!
//! ## Da un file sull'host a D-Bus dal container
//!
//! Fino al 29-09-2026 il runtime scriveva `web`/`lvgl` in `display-target` e sull'host
//! tre pezzi (`sws-display.path`, `.service` e uno script di ~270 righe) lo
//! applicavano: un container non parlava col systemd dell'host. Ora il container
//! ha il bus di sistema (per il launcher e il browser, unit di sistema) e il bus
//! utente (per il viewer LVGL, unit utente), e commuta lui. Provato sul TC620 il
//! 29-09: da dentro il container, con `UserNS=keep-id`, polkit concede di
//! riavviare `chromium@main-app.service` come lo concedeva allo script.
//!
//! Il file non si scrive più (decisione 61): così i pezzi vecchi rimasti
//! sull'host non scattano, finché una reinstallazione non li toglie (62).
//!
//! ## Le regole portate dallo script, che costano care se si perdono
//!
//! - **La modalità configurazione non si tocca.** Tenendo premuto STOP
//!   all'accensione il launcher apre Cockpit (`chromium@wp-control.service`) e
//!   non raggiunge `desktop.target`: prendere lo schermo lì rende
//!   irraggiungibile la via di fuga. Si aspetta che il launcher si decida (fino a
//!   60 s) e, nel dubbio, non si tocca niente.
//! - **Passando a LVGL il viewer si *riavvia*, non si avvia**: un viewer già in
//!   esecuzione resterebbe sul progetto di prima (WP630, 08-09-2026).
//! - **Passando al web l'URL si imposta prima di avviare il browser**, che lo
//!   rilegge a ogni avvio; e se il browser non parte si ripiega su LVGL, perché
//!   uno schermo nero è peggio del motore sbagliato — e lo si dice.
//! - **PixsysOS < 2.1 non è supportato** (decisione 59): senza
//!   `WebBrowser.SetEnabled` la commutazione risulta «non supportata».
//! - **CODESYS non si tocca** (60): se può cambiare l'URL del browser, lo stato
//!   lo segnala, perché all'avvio si riprenderebbe lo schermo.

use std::path::Path;

use serde::Serialize;
use sws_core::project::{Project, ProjectTargetKind};

/// Il file che il runtime scriveva fino al 29-09-2026. Non si scrive più; resta
/// il nome, perché l'installer lo tolga insieme ai pezzi vecchi.
pub const FILE_NAME: &str = "display-target";

/// I due motori, come li distingue chi deve scegliere cosa mandare a schermo:
/// `lvgl_framebuffer` e `lvgl_wayland` sono la stessa cosa a questo livello.
pub const WEB: &str = "web";
pub const LVGL: &str = "lvgl";

const BROWSER: &str = "chromium@main-app.service";
const CONFIGURAZIONE: &str = "chromium@wp-control.service";
const DESKTOP: &str = "desktop.target";
const VIEWER: &str = "sws-lvgl-viewer.service";
const ATTESA_MAX_S: u64 = 60;

/// Il motore che questo progetto chiede. Senza `target` è un progetto nato
/// prima del campo, e quei progetti sono tutti web: continuità, non una scelta.
pub fn wanted_engine(project: &Project) -> &'static str {
    match project.target.as_ref().map(|t| t.kind) {
        Some(ProjectTargetKind::LvglFramebuffer) | Some(ProjectTargetKind::LvglWayland) => LVGL,
        Some(ProjectTargetKind::Web) | None => WEB,
    }
}

/// Perché si chiede di pubblicare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Motivo {
    /// L'avvio del runtime.
    Avvio,
    /// Il progetto è stato sostituito: apertura, deploy, import, ripristino.
    Progetto,
    /// Una modifica dentro lo stesso progetto (una pagina, il tipo di destinazione).
    Modifica,
}

/// Cosa fare, dato ciò che è stato applicato l'ultima volta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Azione {
    Niente,
    Commuta,
    /// Stesso motore LVGL, progetto nuovo: il viewer va riavviato per leggerlo.
    RiavviaViewer,
}

/// Il cuore della decisione, senza D-Bus. Una commutazione fa sfarfallare lo
/// schermo: non si rifà a ogni salvataggio di una qualunque sezione.
pub fn decidi(applicato: Option<&str>, voluto: &str, motivo: Motivo) -> Azione {
    match applicato {
        None => Azione::Commuta,
        Some(a) if a != voluto => Azione::Commuta,
        Some(_) if voluto == LVGL && motivo == Motivo::Progetto => Azione::RiavviaViewer,
        Some(_) => Azione::Niente,
    }
}

/// Com'è andata l'ultima commutazione, per l'IDE (decisione 61: lo stato si
/// legge da lì, non da un file).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StatoDisplay {
    /// Il motore che il progetto chiede.
    pub voluto: String,
    /// `web`, `lvgl`, `ripiego_lvgl` (il browser non è partito), `configurazione`
    /// (STOP all'accensione: non toccato), `indeciso` (il launcher non si è
    /// deciso in tempo), `non_supportato` (niente launcher Pixsys ≥ 2.1), `errore`.
    pub esito: String,
    pub messaggio: Option<String>,
    /// CODESYS può riprendersi il browser all'avvio (decisione 60: si segnala).
    pub codesys_url_override: Option<bool>,
    pub quando: String,
}

static STATO: std::sync::RwLock<Option<StatoDisplay>> = std::sync::RwLock::new(None);
/// Il motore applicato l'ultima volta, e il lucchetto che mette in fila le
/// commutazioni: due richieste ravvicinate non devono intrecciarsi.
static APPLICATO: tokio::sync::Mutex<Option<&'static str>> = tokio::sync::Mutex::const_new(None);

pub fn stato() -> Option<StatoDisplay> {
    STATO.read().ok().and_then(|g| g.clone())
}

fn registra(voluto: &str, esito: &str, messaggio: Option<String>, codesys: Option<bool>) {
    let st = StatoDisplay {
        voluto: voluto.into(),
        esito: esito.into(),
        messaggio: messaggio.clone(),
        codesys_url_override: codesys,
        quando: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string(),
    };
    tracing::info!(voluto, esito, messaggio = ?messaggio, codesys = ?codesys, "display: commutazione");
    if let Ok(mut g) = STATO.write() {
        *g = Some(st);
    }
}

/// Pubblica il motore del progetto: se serve, commuta lo schermo. Torna subito
/// — la commutazione può aspettare il launcher fino a un minuto — e gli errori
/// si registrano nello stato, senza far fallire chi l'ha chiamata.
pub async fn publish(_config_dir: &Path, project_dir: &Path, motivo: Motivo) {
    let project = match Project::load(project_dir) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(dir = %project_dir.display(), "display: progetto non leggibile, schermo non toccato: {e:#}");
            return;
        }
    };
    let voluto = wanted_engine(&project);
    tokio::spawn(async move {
        let mut applicato = APPLICATO.lock().await;
        match decidi(*applicato, voluto, motivo) {
            Azione::Niente => {}
            azione => {
                if let Some(fatto) = commuta(voluto, azione).await {
                    *applicato = Some(fatto);
                }
            }
        }
    });
}

/// Le operazioni D-Bus, una per riga di quello che faceva lo script.
mod bus {
    use zbus::{zvariant::OwnedValue, Connection};

    const SD: &str = "org.freedesktop.systemd1";
    const SD_PATH: &str = "/org/freedesktop/systemd1";
    const SD_IFACE: &str = "org.freedesktop.systemd1.Manager";
    const PX: &str = "net.pixsys.Config1";
    const PX_BROWSER: &str = "/net/pixsys/Config1/WebBrowser/MainApp";
    const PX_IFACE: &str = "net.pixsys.Config1.WebBrowser";

    pub async fn unit_attiva(c: &Connection, unit: &str) -> bool {
        let Ok(m) = c.call_method(Some(SD), SD_PATH, Some(SD_IFACE), "GetUnit", &(unit)).await else {
            return false; // NoSuchUnit: una unit non caricata non è attiva
        };
        let Ok(path) = m.body().deserialize::<zbus::zvariant::OwnedObjectPath>() else { return false };
        let Ok(r) = c
            .call_method(Some(SD), path.as_str(), Some("org.freedesktop.DBus.Properties"), "Get",
                &("org.freedesktop.systemd1.Unit", "ActiveState"))
            .await
        else {
            return false;
        };
        r.body()
            .deserialize::<OwnedValue>()
            .ok()
            .and_then(|v| String::try_from(v).ok())
            .map(|s| s == "active")
            .unwrap_or(false)
    }

    pub async fn unit(c: &Connection, metodo: &str, unit: &str) -> Result<(), String> {
        c.call_method(Some(SD), SD_PATH, Some(SD_IFACE), metodo, &(unit, "replace"))
            .await
            .map(|_| ())
            .map_err(|e| format!("{metodo} {unit}: {e}"))
    }

    /// `GetEnabled`: una lettura, per sapere se il launcher è un Pixsys ≥ 2.1
    /// senza scoprirlo scrivendo.
    pub async fn launcher_supportato(c: &Connection) -> bool {
        c.call_method(Some(PX), PX_BROWSER, Some(PX_IFACE), "GetEnabled", &()).await.is_ok()
    }

    pub async fn browser_abilitato(c: &Connection, si: bool) -> Result<(), String> {
        c.call_method(Some(PX), PX_BROWSER, Some(PX_IFACE), "SetEnabled", &(si))
            .await
            .map(|_| ())
            .map_err(|e| format!("SetEnabled: {e}"))
    }

    pub async fn browser_url(c: &Connection, url: &str) -> Result<(), String> {
        c.call_method(Some(PX), PX_BROWSER, Some(PX_IFACE), "SetUrl", &(url))
            .await
            .map(|_| ())
            .map_err(|e| format!("SetUrl: {e}"))
    }

    pub async fn codesys_override(c: &Connection) -> Option<bool> {
        let m = c.call_method(Some(PX), PX_BROWSER, Some(PX_IFACE), "GetCodesysAllowUrlOverride", &()).await.ok()?;
        m.body().deserialize::<bool>().ok()
    }
}

/// La commutazione. Restituisce il motore applicato, o `None` se non ha
/// toccato lo schermo (configurazione, launcher indeciso, non supportato).
async fn commuta(voluto: &'static str, azione: Azione) -> Option<&'static str> {
    let Ok(sistema) = zbus::Connection::system().await else {
        registra(voluto, "non_supportato", Some("bus di sistema non raggiungibile".into()), None);
        return None;
    };
    if !bus::launcher_supportato(&sistema).await {
        registra(voluto, "non_supportato",
            Some("nessun launcher Pixsys con WebBrowser.SetEnabled (PixsysOS ≥ 2.1): lo schermo non si commuta".into()), None);
        return None;
    }
    let codesys = bus::codesys_override(&sistema).await;

    // Il launcher ha la precedenza: si aspetta che si decida.
    let mut attesa = 0;
    loop {
        if bus::unit_attiva(&sistema, CONFIGURAZIONE).await {
            registra(voluto, "configurazione",
                Some("modalità configurazione (STOP all'accensione): lo schermo resta a Cockpit, il runtime continua".into()), codesys);
            return None;
        }
        if bus::unit_attiva(&sistema, DESKTOP).await {
            break;
        }
        if attesa >= ATTESA_MAX_S {
            registra(voluto, "indeciso",
                Some(format!("dopo {ATTESA_MAX_S} s né {DESKTOP} né {CONFIGURAZIONE} sono attivi: non commuto")), codesys);
            return None;
        }
        attesa += 1;
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    let utente = match zbus::Connection::session().await {
        Ok(c) => c,
        Err(e) => {
            registra(voluto, "errore",
                Some(format!("bus utente non raggiungibile ({e}): il quadlet è precedente al 27-09-2026, reinstallare dall'Installazione")), codesys);
            return None;
        }
    };

    if azione == Azione::RiavviaViewer {
        let r = bus::unit(&utente, "RestartUnit", VIEWER).await;
        registra(voluto, if r.is_ok() { LVGL } else { "errore" }, r.err(), codesys);
        return Some(LVGL);
    }

    if voluto == LVGL {
        let mut note = Vec::new();
        // La politica vale dal prossimo avvio (la legge il launcher); per questa
        // sessione il browser va comunque fermato.
        if let Err(e) = bus::browser_abilitato(&sistema, false).await {
            note.push(e);
        }
        if let Err(e) = bus::unit(&sistema, "StopUnit", BROWSER).await {
            note.push(e);
        }
        return match bus::unit(&utente, "RestartUnit", VIEWER).await {
            Ok(()) => {
                registra(voluto, LVGL, (!note.is_empty()).then(|| note.join("; ")), codesys);
                Some(LVGL)
            }
            Err(e) => {
                registra(voluto, "errore", Some(e), codesys);
                None
            }
        };
    }

    // Web.
    let mut note = Vec::new();
    let _ = bus::unit(&utente, "StopUnit", VIEWER).await; // se non gira, niente da fermare
    let url = std::env::var("SWS_VIEWER_URL").unwrap_or_else(|_| "http://127.0.0.1:8443".into());
    // Prima l'URL: il browser lo rilegge a ogni avvio.
    if let Err(e) = bus::browser_url(&sistema, &url).await {
        note.push(e);
    }
    if let Err(e) = bus::browser_abilitato(&sistema, true).await {
        note.push(e);
    }
    if let Err(e) = bus::unit(&sistema, "StartUnit", BROWSER).await {
        note.push(e);
    }
    // Un istante per fallire davvero: StartUnit torna quando il servizio è
    // partito, non quando è stabile.
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    if !bus::unit_attiva(&sistema, BROWSER).await {
        let _ = bus::unit(&utente, "StartUnit", VIEWER).await;
        note.push("il browser non è attivo dopo l'avvio: a schermo c'è LVGL, NON ciò che il progetto chiede".into());
        registra(voluto, "ripiego_lvgl", Some(note.join("; ")), codesys);
        return Some(LVGL);
    }
    if codesys == Some(true) {
        note.push("CODESYS può cambiare l'URL del browser (allow_url_override): all'avvio potrebbe riprendersi lo schermo".into());
    }
    registra(voluto, WEB, (!note.is_empty()).then(|| note.join("; ")), codesys);
    Some(WEB)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il progetto si costruisce dal YAML, non con un letterale di struct.
    ///
    /// Due motivi: un letterale va aggiornato a ogni campo nuovo di `Project`
    /// (e infatti si è rotto subito), e soprattutto questo è il percorso vero —
    /// `target` arriva da `project.yaml`, quindi il test verifica anche che si
    /// deserializzi come si crede.
    fn progetto(target_yaml: &str) -> Project {
        let yaml =
            format!("meta:\n  name: prova\n  version: '1'\ntags: []\nsources: []\n{target_yaml}");
        serde_yaml::from_str(&yaml)
            .unwrap_or_else(|e| panic!("YAML di prova non valido: {e}\n{yaml}"))
    }

    /// Un progetto senza `target` è precedente al campo, e quei progetti sono
    /// tutti web: il default è continuità, non una scelta arbitraria.
    #[test]
    fn senza_target_si_resta_sul_web() {
        assert_eq!(wanted_engine(&progetto("")), WEB);
    }

    #[test]
    fn web_esplicito_resta_web() {
        assert_eq!(wanted_engine(&progetto("target:\n  kind: web\n")), WEB);
    }

    /// Framebuffer e Wayland sono la stessa cosa per chi deve scegliere quale
    /// programma mandare a schermo.
    #[test]
    fn entrambe_le_varianti_lvgl_danno_lvgl() {
        assert_eq!(
            wanted_engine(&progetto("target:\n  kind: lvgl_framebuffer\n")),
            LVGL
        );
        assert_eq!(
            wanted_engine(&progetto("target:\n  kind: lvgl_wayland\n")),
            LVGL
        );
    }

    /// Una commutazione fa sfarfallare lo schermo: si fa solo quando serve.
    #[test]
    fn si_commuta_solo_quando_serve() {
        // Al primo avvio si applica sempre (lo stato dello schermo è ignoto).
        assert_eq!(decidi(None, WEB, Motivo::Avvio), Azione::Commuta);
        // Motore cambiato: si commuta, qualunque sia il motivo.
        assert_eq!(decidi(Some(WEB), LVGL, Motivo::Modifica), Azione::Commuta);
        // Stesso motore, un salvataggio qualunque: niente sfarfallio.
        assert_eq!(decidi(Some(WEB), WEB, Motivo::Modifica), Azione::Niente);
        assert_eq!(decidi(Some(LVGL), LVGL, Motivo::Modifica), Azione::Niente);
        // Stesso motore LVGL ma progetto nuovo (deploy): il viewer va riavviato,
        // o resta sul progetto di prima (WP630, 08-09-2026).
        assert_eq!(decidi(Some(LVGL), LVGL, Motivo::Progetto), Azione::RiavviaViewer);
        // Il web si ricarica da sé quando cambia il progetto.
        assert_eq!(decidi(Some(WEB), WEB, Motivo::Progetto), Azione::Niente);
    }
}
