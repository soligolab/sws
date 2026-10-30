//! Il quadlet che viaggia (02-10-2026, piano
//! `docs/archive/2026-10-02-quadlet-che-viaggia.md`).
//!
//! `podman auto-update` sostituisce l'immagine, non i quadlet sul pannello: una
//! riga nuova (`Timezone=local`, il bus utente, la cartella dati del viewer)
//! arrivava solo reinstallando dall'IDE, e niente lo diceva. Da qui:
//!
//! - ogni quadlet porta la sua versione nella `Description` (`[quadlet N]`),
//!   che systemd espone come proprietà dell'unità: la si legge dal **bus
//!   utente**, che il runtime ha già, senza vedere i file dell'host;
//! - l'immagine porta i quadlet della sua versione in [`DIR_IMMAGINE`]: il
//!   numero atteso è il loro;
//! - se i quadlet installati sono più vecchi, [`aggiorna`] copia template e
//!   installer nella cartella config (montata, e visibile dall'host) e li fa
//!   girare con un **servizio transitorio dell'utente** (`--solo-unita`). Scrive
//!   solo in `~/.config` dell'utente, come l'installer: niente file di sistema,
//!   niente SSH. Decisione del maintainer del 02-10-2026, con conferma
//!   dell'operatore.
//!
//! L'esito si decide come quello dell'aggiornamento del runtime: prima di
//! lanciare si scrive «in corso», e il runtime che riparte misura le versioni
//! installate.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Dove l'immagine porta i suoi quadlet e l'installer.
pub const DIR_IMMAGINE: &str = "/usr/share/sws/quadlet";
const RUNTIME: &str = "sws-runtime.service";
const VIEWER: &str = "sws-lvgl-viewer.service";
/// Le unità **oltre** al runtime che entrano nel conto della versione. Il segno
/// delle unità scelte decide quali contare davvero. OpenPLC c'è stato dal 23 al
/// 30-10-2026: ora è un container persistente (`openplc.rs`), non un quadlet.
const ALTRE_UNITA: [&str; 1] = [VIEWER];
const FILE_ESITO: &str = "quadlet-esito.json";
/// Le unità che **questa installazione ha scelto di avere** (23-10-2026).
/// Lo scrive l'installer, che è l'unico a sapere cosa ha messo.
const FILE_UNITA: &str = "unita-scelte.json";
pub(crate) const DIR_COPIA: &str = "quadlet-nuovo";
/// Oltre questo tempo un «in corso» che non ha portato le versioni attese è un
/// aggiornamento non riuscito.
const SCADENZA_MS: i64 = 10 * 60 * 1000;

/// `[quadlet N]` in una `Description` (o in una riga `Description=`).
/// `None` se non c'è: un quadlet scritto prima del 02-10-2026.
pub fn versione_da_descrizione(d: &str) -> Option<u32> {
    let i = d.rfind("[quadlet ")?;
    let resto = &d[i + "[quadlet ".len()..];
    resto[..resto.find(']')?].trim().parse().ok()
}

/// La versione di un template: la riga `Description=` del file.
pub fn versione_template(testo: &str) -> Option<u32> {
    testo
        .lines()
        .find(|l| l.trim_start().starts_with("Description="))
        .and_then(versione_da_descrizione)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Esito {
    /// `in_corso`, `riuscito`, `non_riuscito`.
    pub esito: String,
    pub da: u32,
    pub a: u32,
    pub quando_ms: i64,
}

/// Lo stato per l'IDE e per il pannello.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Stato {
    /// La versione dei quadlet installati: la più bassa fra runtime e viewer
    /// (0 = scritti prima che la versione esistesse). `None` = non leggibile
    /// (niente bus utente: un quadlet precedente al 27-09-2026).
    pub installata: Option<u32>,
    /// La versione dei quadlet di questa immagine. `None` fuori da un container
    /// (sviluppo, installazione nativa): niente da confrontare.
    pub attesa: Option<u32>,
    pub da_aggiornare: bool,
    /// Si può aggiornare da qui (bus utente, cartella config dell'host nota,
    /// template presenti). Se no, si reinstalla dall'IDE.
    pub si_puo_aggiornare: bool,
    pub motivo: Option<String>,
    pub ultimo_esito: Option<Esito>,
}

/// La decisione, senza D-Bus né file.
pub fn decidi(installata: Option<u32>, attesa: Option<u32>, bus: bool, host_config: bool) -> (bool, bool, Option<String>) {
    let Some(attesa) = attesa else {
        return (false, false, None);
    };
    let Some(installata) = installata else {
        return (
            true,
            false,
            Some("Il pannello non espone il bus utente: la configurazione del servizio è precedente al \
                  27-09-2026 e si aggiorna solo reinstallando dall'IDE (Istanza → Device → Installazione)."
                .into()),
        );
    };
    if installata >= attesa {
        return (false, false, None);
    }
    if !bus || !host_config {
        return (
            true,
            false,
            Some("Questo pannello non sa riscrivere la sua configurazione da sé: reinstallare dall'IDE \
                  (Istanza → Device → Installazione)."
                .into()),
        );
    }
    (true, true, None)
}

fn file_esito(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_ESITO)
}

async fn leggi_esito(config_dir: &Path) -> Option<Esito> {
    let t = tokio::fs::read_to_string(file_esito(config_dir)).await.ok()?;
    serde_json::from_str(&t).ok()
}

async fn scrivi_esito(config_dir: &Path, e: &Esito) {
    if let Ok(t) = serde_json::to_string_pretty(e) {
        let _ = tokio::fs::write(file_esito(config_dir), t).await;
    }
}

/// Le unità che questa installazione ha scelto di avere.
///
/// # Perché esiste
///
/// La versione dei quadlet installati è il **minimo** fra le unità, e fino al
/// 23-10-2026 un'unità non caricata valeva 0, con questa motivazione: «è
/// un'installazione precedente al suo quadlet». Era vera finché le unità erano
/// due e **tutte e due obbligatorie**.
///
/// Dal momento in cui un'unità è **opzionale** — OpenPLC, deciso il 23-10-2026:
/// «non è detto che a tutti i clienti serva» — quella presunzione si rovescia:
/// un'unità che non si vuole varrebbe 0 **per sempre**, e il pannello
/// chiederebbe un aggiornamento dei quadlet a ogni giro, senza che aggiornarli
/// cambi niente.
///
/// Il segno dice quali unità contare. **Senza il file si fa come prima**, ed è
/// voluto: un pannello installato prima che questo file esistesse è davvero un
/// pannello che precede il suo quadlet, e la presunzione vecchia lì è giusta.
/// Il file compare al primo passaggio dell'installer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnitaScelte {
    pub unita: Vec<String>,
}

async fn leggi_unita(config_dir: &Path) -> Option<UnitaScelte> {
    let t = tokio::fs::read_to_string(config_dir.join(FILE_UNITA)).await.ok()?;
    serde_json::from_str(&t).ok()
}

/// Il minimo fra le versioni delle unità **che contano**.
///
/// Separata dal bus apposta: è qui che sta la regola, e una regola che si può
/// provare solo con un systemd davanti non si prova mai.
///
/// `altre` sono le unità diverse dal runtime, con la versione letta dal bus:
/// `None` = non caricata.
fn minimo_installato(scelte: Option<&[String]>, runtime: u32, altre: &[(&str, Option<u32>)]) -> u32 {
    let conta = |u: &str| match scelte {
        // Nessun segno: si contano tutte, come si è sempre fatto.
        None => true,
        Some(s) => s.iter().any(|x| x == u),
    };
    altre
        .iter()
        .filter(|(u, _)| conta(u))
        // Un'unità **scelta** che non è caricata vale 0: quella sì che è
        // un'installazione da aggiornare.
        .fold(runtime, |min, (_, v)| min.min(v.unwrap_or(0)))
}

/// La versione attesa: quella dei template dell'immagine.
pub async fn versione_attesa() -> Option<u32> {
    attesa().await
}

async fn attesa() -> Option<u32> {
    let t = tokio::fs::read_to_string(Path::new(DIR_IMMAGINE).join("sws-runtime.container")).await.ok()?;
    versione_template(&t)
}

/// La versione installata, dalle `Description` delle unità sul bus utente.
///
/// Il runtime c'è sempre: se non si legge la sua `Description` non si sa
/// niente, e si risponde `None` come prima. Le altre contano secondo
/// [`UnitaScelte`].
async fn installata(c: &zbus::Connection, config_dir: &Path) -> Option<u32> {
    use crate::display_target::bus::proprieta_unita;
    let r = proprieta_unita(c, RUNTIME, "Description").await?;
    let vr = versione_da_descrizione(&r).unwrap_or(0);
    let mut altre: Vec<(&str, Option<u32>)> = Vec::new();
    for u in ALTRE_UNITA {
        let v = match proprieta_unita(c, u, "LoadState").await.as_deref() {
            Some("loaded") => Some(
                proprieta_unita(c, u, "Description")
                    .await
                    .and_then(|d| versione_da_descrizione(&d))
                    .unwrap_or(0),
            ),
            _ => None,
        };
        altre.push((u, v));
    }
    let scelte = leggi_unita(config_dir).await;
    Some(minimo_installato(scelte.as_ref().map(|s| s.unita.as_slice()), vr, &altre))
}

/// La cartella config **vista dall'host** (il servizio transitorio gira lì).
pub(crate) fn host_config() -> Option<String> {
    std::env::var("SWS_HOST_CONFIG_DIR").ok().filter(|s| !s.trim().is_empty())
}

pub async fn stato(config_dir: &Path) -> Stato {
    let attesa = attesa().await;
    let utente = if attesa.is_some() { zbus::Connection::session().await.ok() } else { None };
    let installata = match &utente {
        Some(c) => installata(c, config_dir).await,
        None => None,
    };
    let (da_aggiornare, si_puo_aggiornare, motivo) =
        decidi(installata, attesa, utente.is_some(), host_config().is_some());
    Stato { installata, attesa, da_aggiornare, si_puo_aggiornare, motivo, ultimo_esito: leggi_esito(config_dir).await }
}

/// Riscrive i quadlet dai template dell'immagine. Torna appena il servizio
/// transitorio è partito: poco dopo questo processo viene riavviato.
pub async fn aggiorna(config_dir: &Path) -> Result<(), String> {
    let st = stato(config_dir).await;
    if !st.da_aggiornare {
        return Err("La configurazione del servizio è già aggiornata.".into());
    }
    if !st.si_puo_aggiornare {
        return Err(st.motivo.unwrap_or_else(|| "Non si può aggiornare da qui.".into()));
    }
    let host = host_config().ok_or("SWS_HOST_CONFIG_DIR assente")?;
    // I file nella cartella config: il container la scrive, l'host la vede.
    let copia = config_dir.join(DIR_COPIA);
    tokio::fs::create_dir_all(&copia).await.map_err(|e| format!("{}: {e}", copia.display()))?;
    for f in ["install-container.sh", "sws-runtime.container", "sws-lvgl-viewer.container"] {
        tokio::fs::copy(Path::new(DIR_IMMAGINE).join(f), copia.join(f))
            .await
            .map_err(|e| format!("copia di {f}: {e}"))?;
    }
    let utente = zbus::Connection::session().await.map_err(|e| format!("bus utente: {e}"))?;
    scrivi_esito(
        config_dir,
        &Esito {
            esito: "in_corso".into(),
            da: st.installata.unwrap_or(0),
            a: st.attesa.unwrap_or(0),
            quando_ms: chrono::Utc::now().timestamp_millis(),
        },
    )
    .await;
    let argv = comando(&host);
    let nome = format!("sws-quadlet-aggiorna-{}.service", chrono::Utc::now().timestamp());
    crate::display_target::bus::avvia_transitorio(&utente, &nome, "SWS: aggiornamento dei quadlet", &argv).await
}

/// Il comando del servizio transitorio, con i percorsi dell'host.
pub fn comando(host_config: &str) -> Vec<String> {
    let dir = format!("{}/{DIR_COPIA}", host_config.trim_end_matches('/'));
    vec!["/bin/bash".into(), format!("{dir}/install-container.sh"), "--solo-unita".into()]
}

/// All'avvio: se c'era un aggiornamento dei quadlet in corso, decide com'è
/// andato misurando le versioni installate adesso.
pub async fn all_avvio(config_dir: PathBuf) {
    let Some(mut e) = leggi_esito(&config_dir).await else { return };
    if e.esito != "in_corso" {
        return;
    }
    // Qualche secondo: il servizio transitorio riavvia anche il viewer.
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    let st = stato(&config_dir).await;
    let adesso = chrono::Utc::now().timestamp_millis();
    match decidi_esito(st.installata, e.a, adesso - e.quando_ms) {
        Some(esito) => {
            e.esito = esito.into();
            tracing::info!(esito = %e.esito, da = e.da, a = e.a, "quadlet: aggiornamento concluso");
            scrivi_esito(&config_dir, &e).await;
            crate::system::quadlet_svuota_cache().await;
        }
        None => {}
    }
}

/// L'esito di un aggiornamento in corso: riuscito se la versione installata ha
/// raggiunto quella voluta; non riuscito se non l'ha raggiunta e il tempo è
/// scaduto; `None` = ancora presto per dirlo.
pub fn decidi_esito(installata: Option<u32>, voluta: u32, trascorsi_ms: i64) -> Option<&'static str> {
    if installata.is_some_and(|v| v >= voluta) {
        Some("riuscito")
    } else if trascorsi_ms > SCADENZA_MS {
        Some("non_riuscito")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scelte(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// Senza il segno si fa **esattamente come prima**: un'unità non caricata
    /// vale 0 e trascina giù il minimo.
    ///
    /// È la compatibilità che tiene in piedi ogni pannello già installato: lì
    /// il file non c'è, e la presunzione vecchia — «se manca è
    /// un'installazione precedente al suo quadlet» — è quella giusta.
    #[test]
    fn senza_il_segno_un_unita_assente_vale_zero() {
        assert_eq!(minimo_installato(None, 6, &[(VIEWER, None)]), 0);
        assert_eq!(minimo_installato(None, 6, &[(VIEWER, Some(6))]), 6);
        assert_eq!(minimo_installato(None, 6, &[(VIEWER, Some(5))]), 5, "vince la più bassa");
    }

    /// Col segno, un'unità **non scelta** non si conta: è il caso che il
    /// 23-10-2026 ha reso necessario, quando il maintainer ha chiesto che
    /// OpenPLC fosse un'opzione. Senza questo, un pannello che non la vuole
    /// chiederebbe un aggiornamento dei quadlet a ogni giro, per sempre.
    #[test]
    fn un_unita_non_scelta_non_trascina_giu_il_minimo() {
        let solo_runtime = scelte(&[RUNTIME]);
        assert_eq!(minimo_installato(Some(&solo_runtime), 6, &[(VIEWER, None)]), 6);
        // E se per qualche motivo c'è lo stesso, continua a non contare:
        // quello che decide è la scelta, non la presenza.
        assert_eq!(minimo_installato(Some(&solo_runtime), 6, &[(VIEWER, Some(3))]), 6);
    }

    /// Un'unità **scelta** che non è caricata vale 0, e deve: quella sì che è
    /// un'installazione da sistemare.
    #[test]
    fn un_unita_scelta_ma_assente_vale_zero() {
        let tutte = scelte(&[RUNTIME, VIEWER]);
        assert_eq!(minimo_installato(Some(&tutte), 6, &[(VIEWER, None)]), 0);
        assert_eq!(minimo_installato(Some(&tutte), 6, &[(VIEWER, Some(6))]), 6);
    }

    /// Un'unità che il segno nomina ma che questo motore non conosce non rompe
    /// niente: si conta solo quello che si legge. È il caso dei pannelli che
    /// hanno avuto il quadlet di OpenPLC (23-30/10/2026).
    #[test]
    fn un_unita_che_il_motore_non_conosce_non_rompe() {
        let con_openplc = scelte(&[RUNTIME, VIEWER, "openplc-runtime.service"]);
        assert_eq!(minimo_installato(Some(&con_openplc), 6, &[(VIEWER, Some(6))]), 6);
    }

    /// Il segno si legge come lo scrive l'installer.
    #[test]
    fn il_segno_si_legge_come_lo_scrive_linstaller() {
        let u: UnitaScelte =
            serde_json::from_str(r#"{"unita": ["sws-runtime.service", "sws-lvgl-viewer.service"]}"#).unwrap();
        assert_eq!(u.unita, vec![RUNTIME.to_string(), VIEWER.to_string()]);
    }

    #[test]
    fn la_versione_si_legge_dalla_description() {
        assert_eq!(versione_da_descrizione("SWS runtime (container podman) [quadlet 3]"), Some(3));
        assert_eq!(versione_da_descrizione("SWS runtime (container podman)"), None);
        assert_eq!(versione_da_descrizione("x [quadlet ]"), None);
        let t = "[Unit]\n# commento\nDescription=SWS viewer LVGL [quadlet 12]\n[Service]\n";
        assert_eq!(versione_template(t), Some(12));
    }

    #[test]
    fn i_template_del_repo_hanno_la_versione() {
        let r = include_str!("../../../../deploy/container/sws-runtime.container");
        let v = include_str!("../../../../deploy/container/sws-lvgl-viewer.container");
        assert!(versione_template(r).is_some());
        assert_eq!(versione_template(r), versione_template(v));
    }

    #[test]
    fn la_decisione() {
        // Fuori da un container: niente da dire.
        assert_eq!(decidi(Some(0), None, true, true), (false, false, None));
        // Aggiornata.
        assert_eq!(decidi(Some(2), Some(2), true, true).0, false);
        // Vecchia, e si può aggiornare da qui.
        assert_eq!(decidi(Some(0), Some(1), true, true), (true, true, None));
        // Vecchia ma senza la cartella dell'host: si reinstalla.
        let (d, p, m) = decidi(Some(0), Some(1), true, false);
        assert!(d && !p && m.unwrap().contains("reinstallare"));
        // Senza bus utente: non si legge, e si reinstalla.
        let (d, p, m) = decidi(None, Some(1), false, true);
        assert!(d && !p && m.unwrap().contains("27-09-2026"));
    }

    #[test]
    fn l_esito() {
        assert_eq!(decidi_esito(Some(2), 2, 0), Some("riuscito"));
        assert_eq!(decidi_esito(Some(1), 2, 1000), None);
        assert_eq!(decidi_esito(Some(1), 2, SCADENZA_MS + 1), Some("non_riuscito"));
        assert_eq!(decidi_esito(None, 2, SCADENZA_MS + 1), Some("non_riuscito"));
    }

    #[test]
    fn il_comando_usa_i_percorsi_dell_host() {
        assert_eq!(
            comando("/data/user/sws/config/"),
            vec!["/bin/bash", "/data/user/sws/config/quadlet-nuovo/install-container.sh", "--solo-unita"]
        );
    }
}
