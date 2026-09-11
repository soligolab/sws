//! Quale motore di rendering deve occupare lo schermo del pannello (Q25).
//!
//! Il progetto lo dichiara già: `target.kind` vale `web`, `lvgl_framebuffer` o
//! `lvgl_wayland`. Fino al 2026-08-27 **nessuno lo leggeva** — il campo esisteva
//! nel modello Rust, nel modello TypeScript e nel `project.yaml` sul device, e
//! non produceva alcun effetto.
//!
//! ## Perché un file e non una chiamata
//!
//! Il runtime gira in un container rootless e **non può parlare col systemd
//! dell'host**, dove vivono il browser (`chromium@main-app.service`, unit
//! dell'OS Pixsys) e il container del viewer LVGL. Quindi non commuta lui:
//! scrive *cosa vuole* in un file del volume già condiviso, e un pezzo lato
//! host agisce.
//!
//! Il file non aggiunge privilegi, si legge a mano quando qualcosa non torna, e
//! sopravvive al riavvio del runtime — tre proprietà che una chiamata diretta
//! al systemd dell'host non avrebbe.
//!
//! ## Cosa NON decide
//!
//! Il ripiego «se Chromium non è avviato, usa comunque LVGL» **non sta qui**:
//! il runtime non può sapere se un servizio dell'host è attivo. Quella è una
//! decisione di chi legge il file, che il systemd dell'host ce l'ha sotto mano.
//! Qui si scrive solo ciò che il progetto chiede.

use std::path::Path;

use sws_core::project::{Project, ProjectTargetKind};

/// Nome del file nella directory di configurazione.
///
/// Sul dispositivo è `/data/user/sws/config/display-target`, che dentro il
/// container è `/var/sws/config/display-target`.
pub const FILE_NAME: &str = "display-target";

/// I due valori possibili, come finiscono nel file.
///
/// Sono due e non tre di proposito: `lvgl_framebuffer` e `lvgl_wayland` sono la
/// stessa cosa per chi deve scegliere *quale programma mandare a schermo*. La
/// differenza fra i due riguarda come il viewer parla col display, ed è già un
/// parametro del viewer — duplicarla qui vorrebbe dire due posti da tenere
/// d'accordo per una distinzione che a questo livello non serve.
pub const WEB: &str = "web";
pub const LVGL: &str = "lvgl";

/// Il motore che questo progetto chiede.
///
/// Un progetto senza `target` è un progetto creato prima che il campo
/// esistesse: sono la maggioranza, e sono tutti progetti web. Il default non è
/// una scelta arbitraria, è la continuità col comportamento di sempre.
pub fn wanted_engine(project: &Project) -> &'static str {
    match project.target.as_ref().map(|t| t.kind) {
        Some(ProjectTargetKind::LvglFramebuffer) | Some(ProjectTargetKind::LvglWayland) => LVGL,
        Some(ProjectTargetKind::Web) | None => WEB,
    }
}

/// Scrive il motore richiesto dal progetto in `<config_dir>/display-target`.
///
/// Non fa nulla se il valore è già quello: riscrivere un file identico farebbe
/// scattare l'osservatore lato host, che fermerebbe e riavvierebbe il
/// programma a schermo — un lampeggio a ogni salvataggio di una qualunque
/// sezione del progetto.
///
/// Gli errori si registrano e basta. Un progetto che non si legge, o una
/// directory non scrivibile, non sono un motivo per far fallire il
/// salvataggio che ha provocato questa chiamata: al massimo lo schermo resta
/// su quello che stava mostrando, che è esattamente ciò che accadeva prima che
/// questo meccanismo esistesse.
pub async fn publish(config_dir: &Path, project_dir: &Path) {
    let project = match Project::load(project_dir) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(dir = %project_dir.display(), "display-target: progetto non leggibile, non aggiornato: {e:#}");
            return;
        }
    };
    let voluto = wanted_engine(&project);
    let path = config_dir.join(FILE_NAME);

    if let Ok(attuale) = tokio::fs::read_to_string(&path).await {
        if attuale.trim() == voluto {
            return;
        }
    }
    if let Err(e) = tokio::fs::create_dir_all(config_dir).await {
        tracing::warn!(dir = %config_dir.display(), "display-target: directory non creabile: {e}");
        return;
    }
    // Con la newline finale: il file è pensato per essere letto anche da uno
    // script di shell, e un file senza newline finale fa inciampare `read`.
    match tokio::fs::write(&path, format!("{voluto}\n")).await {
        Ok(()) => {
            tracing::info!(engine = voluto, path = %path.display(), "display-target aggiornato")
        }
        Err(e) => tracing::warn!(path = %path.display(), "display-target: scrittura fallita: {e}"),
    }
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

    /// Scrive un progetto vero su disco: `publish` passa da `Project::load`,
    /// quindi un letterale di struct proverebbe un percorso che non esiste.
    fn progetto_su_disco(dir: &std::path::Path, target_yaml: &str) {
        std::fs::write(
            dir.join("project.yaml"),
            format!("meta:\n  name: prova\n  version: '1'\ntags: []\nsources: []\n{target_yaml}"),
        )
        .unwrap();
    }

    /// **Il vincolo più facile da rompere senza accorgersene** (piano del
    /// 2026-09-03, vincolo 8): lo script lato host scatta su `PathChanged=`,
    /// che guarda la *scrittura*, non il contenuto. Riscrivere lo stesso valore
    /// fermerebbe e riavvierebbe il programma a schermo — un lampeggio del
    /// pannello a ogni salvataggio di una qualunque sezione del progetto.
    ///
    /// Il file di partenza è senza newline finale di proposito: `publish`
    /// scrive sempre `"{valore}\n"`, quindi se toccasse il file la newline
    /// comparirebbe. È il modo di distinguere «non ha scritto» da «ha
    /// riscritto identico» senza dipendere dalla risoluzione dell'mtime.
    #[tokio::test]
    async fn non_riscrive_un_valore_identico() {
        let t = tempfile::tempdir().unwrap();
        let cfg = t.path().join("config");
        let proj = t.path().join("progetto");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::create_dir_all(&proj).unwrap();
        progetto_su_disco(&proj, "target:\n  kind: web\n");
        std::fs::write(cfg.join(FILE_NAME), "web").unwrap();

        publish(&cfg, &proj).await;

        assert_eq!(
            std::fs::read_to_string(cfg.join(FILE_NAME)).unwrap(),
            "web",
            "il file è stato riscritto: sul pannello questo è uno sfarfallio a ogni salvataggio"
        );
    }

    #[tokio::test]
    async fn scrive_quando_il_progetto_cambia_motore() {
        let t = tempfile::tempdir().unwrap();
        let cfg = t.path().join("config");
        let proj = t.path().join("progetto");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::create_dir_all(&proj).unwrap();
        progetto_su_disco(&proj, "target:\n  kind: lvgl_framebuffer\n");
        std::fs::write(cfg.join(FILE_NAME), "web\n").unwrap();

        publish(&cfg, &proj).await;

        assert_eq!(
            std::fs::read_to_string(cfg.join(FILE_NAME)).unwrap(),
            "lvgl\n"
        );
    }

    /// La directory di configurazione può non esistere ancora al primo avvio.
    #[tokio::test]
    async fn crea_il_file_e_la_cartella_se_mancano() {
        let t = tempfile::tempdir().unwrap();
        let cfg = t.path().join("config-che-non-ce");
        let proj = t.path().join("progetto");
        std::fs::create_dir_all(&proj).unwrap();
        progetto_su_disco(&proj, "target:\n  kind: lvgl_wayland\n");

        publish(&cfg, &proj).await;

        assert_eq!(
            std::fs::read_to_string(cfg.join(FILE_NAME)).unwrap(),
            "lvgl\n"
        );
    }

    /// Un progetto illeggibile non è un motivo per cambiare quello che il
    /// pannello sta mostrando: nel dubbio non si tocca lo schermo (vincolo 3).
    #[tokio::test]
    async fn un_progetto_illeggibile_lascia_il_file_com_era() {
        let t = tempfile::tempdir().unwrap();
        let cfg = t.path().join("config");
        let proj = t.path().join("progetto");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("project.yaml"), "questo: [non è: yaml valido").unwrap();
        std::fs::write(cfg.join(FILE_NAME), "lvgl\n").unwrap();

        publish(&cfg, &proj).await;

        assert_eq!(
            std::fs::read_to_string(cfg.join(FILE_NAME)).unwrap(),
            "lvgl\n"
        );
    }

    /// I due valori scritti sul file sono un contratto con lo script lato host:
    /// cambiarli lo romperebbe in silenzio, perché quello script non fallisce —
    /// semplicemente non riconosce il valore e non commuta.
    #[test]
    fn i_valori_sul_file_sono_quelli_attesi() {
        assert_eq!(WEB, "web");
        assert_eq!(LVGL, "lvgl");
    }
}
