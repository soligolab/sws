//! L'immagine di boot applicata **dal container**, parlando D-Bus col launcher
//! Pixsys — senza niente sull'host.
//!
//! # Perché esiste
//!
//! Fino al 24-09-2026 il giro era: il runtime scriveva un file `trigger`, e
//! sull'host tre pezzi installati a mano (`sws-boot-image.path`, il suo
//! `.service` e uno script con `busctl`) lo osservavano e chiamavano il
//! launcher. Quel file esisteva **solo** perché un container non parla col bus
//! di sistema.
//!
//! Vincolo del maintainer, 24-09-2026: «nell'host non puoi toccare nulla,
//! tutto deve essere fatto con chiamate dBus dal container». Quindi il socket
//! del bus si monta nel container e la chiamata la fa il runtime.
//!
//! # Le tre cose che non sono ovvie
//!
//! Misurate sul WP630 il 19-09-2026 (PixsysOS 2.1.1) e portate qui dallo
//! script che se ne occupava prima — è sapere pagato con prove dal vivo, non
//! va perso nella traduzione.
//!
//! 1. **Il percorso che il launcher vuole** è pensato come *relativo al mount
//!    USB* (`/run/media`). Con un percorso assoluto funziona lo stesso, ma per
//!    un difetto: `PathBuf::push` con un assoluto sostituisce invece di
//!    concatenare. Se un giorno Pixsys normalizza l'input, la via assoluta
//!    smette di funzionare **senza preavviso**. Sul WP630 `/run/media` è di
//!    root e l'utente non ci scrive, quindi l'assoluto è il caso normale: si
//!    usa, e lo si **dichiara** nell'esito.
//! 2. **Il nome del file resta**: il launcher copia in
//!    `…/assets/<nome originale>`, quindi il PNG si chiama sempre `boot.png` e
//!    la verifica confronta `GetBackgroundImage` con quel nome.
//! 3. **Non ha effetto immediato**: il launcher legge il suo TOML all'avvio.
//!    L'immagine compare al prossimo riavvio del pannello, e l'esito lo dice.
//!
//! # Il percorso è quello dell'HOST, non quello del container
//!
//! Questa è la trappola che il disegno vecchio non aveva: lo script girava
//! sull'host e vedeva i suoi percorsi. Il runtime vede `/var/sws/config/…`
//! mentre sul disco dell'host quel file sta in `/data/user/sws/config/…`, e al
//! launcher va dato **il secondo**. La mappatura non è deducibile da dentro il
//! container: la dichiara il quadlet con `SWS_HOST_CONFIG_DIR`, e senza quella
//! variabile non si prova nemmeno a chiamare — meglio dire «non configurato»
//! che far scrivere al launcher un percorso che sull'host non esiste.

use std::path::Path;

const SERVIZIO: &str = "net.pixsys.Config1";
const OGGETTO: &str = "/net/pixsys/Config1/Launcher";
const INTERFACCIA: &str = "net.pixsys.Config1.Launcher";
/// Il nome con cui il launcher ritrova l'immagine (vedi punto 2).
pub const NOME_PNG: &str = "boot.png";

/// Come è andata la richiesta al launcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Esito {
    /// Applicata: comparirà al prossimo avvio del pannello.
    Applicata {
        /// `true` se si è passato un percorso assoluto (vedi punto 1).
        percorso_assoluto: bool,
    },
    /// Il dispositivo non espone il launcher: non è un errore, è un PC.
    NonSupportato,
    /// Manca `SWS_HOST_CONFIG_DIR`: il container non sa come si chiama il file
    /// sull'host, e un percorso sbagliato è peggio di nessuna chiamata.
    PercorsoHostIgnoto,
    Errore(String),
}

/// Il percorso **dell'host** per un file che nel container sta sotto la config.
///
/// `SWS_HOST_CONFIG_DIR` è la stessa cartella vista da fuori. Ritorna `None`
/// se la variabile non c'è o se il file non è sotto la config del container.
pub fn percorso_host(config_dir: &Path, file: &Path) -> Option<String> {
    let host = std::env::var("SWS_HOST_CONFIG_DIR").ok()?;
    let rel = file.strip_prefix(config_dir).ok()?;
    Some(Path::new(&host).join(rel).to_string_lossy().into_owned())
}

/// Dice al launcher di usare questo PNG come immagine di accensione.
///
/// `png_host` è il percorso **sull'host**. Non riavvia niente e non scrive
/// file: l'esito torna al chiamante, che decide cosa farne.
pub async fn imposta_immagine(png_host: &str) -> Esito {
    let conn = match zbus::Connection::system().await {
        Ok(c) => c,
        // Nessun bus raggiungibile: o il socket non è montato, o siamo su una
        // macchina senza D-Bus di sistema. In entrambi i casi non è un guasto
        // del progetto.
        Err(e) => return Esito::Errore(format!("bus di sistema non raggiungibile: {e}")),
    };

    let arg = png_host.to_string();
    let esito: zbus::Result<()> = conn
        .call_method(
            Some(SERVIZIO),
            OGGETTO,
            Some(INTERFACCIA),
            "SetBackgroundImage",
            &(arg.as_str()),
        )
        .await
        .map(|_| ());

    if let Err(e) = esito {
        // Un servizio che non risponde sul bus è «questo non è un pannello
        // Pixsys», non un errore da mostrare come rosso.
        let testo = e.to_string();
        if testo.contains("ServiceUnknown") || testo.contains("was not provided by any") {
            return Esito::NonSupportato;
        }
        return Esito::Errore(format!("SetBackgroundImage: {testo}"));
    }

    // Verifica (punto 2): il launcher risponde col solo nome del file.
    match conn
        .call_method(
            Some(SERVIZIO),
            OGGETTO,
            Some(INTERFACCIA),
            "GetBackgroundImage",
            &(),
        )
        .await
        .and_then(|m| m.body().deserialize::<String>())
    {
        Ok(letto) if letto == NOME_PNG => Esito::Applicata {
            percorso_assoluto: png_host.starts_with('/'),
        },
        Ok(letto) => Esito::Errore(format!(
            "il launcher risponde «{letto}» invece di {NOME_PNG}"
        )),
        Err(e) => Esito::Errore(format!("GetBackgroundImage: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// La traduzione container → host: è la trappola che il disegno vecchio
    /// non aveva, perché lo script girava già sull'host.
    #[test]
    fn il_percorso_diventa_quello_dell_host() {
        let cfg = PathBuf::from("/var/sws/config");
        let png = cfg.join("boot-image").join("boot.png");

        // Senza la variabile non si indovina: meglio non chiamare affatto.
        std::env::remove_var("SWS_HOST_CONFIG_DIR");
        assert_eq!(percorso_host(&cfg, &png), None);

        std::env::set_var("SWS_HOST_CONFIG_DIR", "/data/user/sws/config");
        assert_eq!(
            percorso_host(&cfg, &png).as_deref(),
            Some("/data/user/sws/config/boot-image/boot.png")
        );

        // Un file fuori dalla config non si traduce: non sappiamo dove sia.
        assert_eq!(percorso_host(&cfg, Path::new("/altrove/x.png")), None);
        std::env::remove_var("SWS_HOST_CONFIG_DIR");
    }

    /// Un percorso assoluto si dichiara, perché si appoggia a un comportamento
    /// non documentato del launcher (punto 1 della testata).
    #[test]
    fn l_esito_distingue_l_assoluto() {
        assert_eq!(
            Esito::Applicata {
                percorso_assoluto: true
            },
            Esito::Applicata {
                percorso_assoluto: true
            }
        );
        assert_ne!(
            Esito::Applicata {
                percorso_assoluto: true
            },
            Esito::Applicata {
                percorso_assoluto: false
            }
        );
    }
}
