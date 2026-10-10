//! Quali progetti sono aperti, e per quanto ancora.
//!
//! Il gateway avvia un container per ogni progetto aperto e lo spegne quando
//! non lo usa più nessuno. Qui c'è chi lo decide; in [`super::podman`] c'è
//! chi lo esegue.
//!
//! TRE REGOLE, TUTTE DECISE DAL MAINTAINER IL 09-10-2026
//!
//! 1. **Il tetto si rifiuta, non si fa posto.** Se un'azienda ha già aperti
//!    tutti i progetti che le spettano, il successivo non si apre. Non si
//!    spegne il più vecchio: chi sta lavorando non deve ritrovarsi il
//!    progetto chiuso perché un collega ne voleva un altro.
//! 2. **Fermo vuol dire nessun browser collegato.** Finché una finestra è
//!    aperta su quel progetto c'è un WebSocket attivo. Chiusa l'ultima, parte
//!    un timer. Si è scartato «nessuna richiesta HTTP»: una scheda dimenticata
//!    ne manda da sola, e il container non si spegnerebbe mai.
//! 3. **Riavvio e pulizia li fa il gateway.** Con l'API di podman systemd non
//!    sorveglia niente: al proprio avvio il gateway ritrova i container che
//!    aveva lasciato e li **riadotta**, o restano orfani a occupare il tetto
//!    senza che nessuno li conti.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use super::podman::{nome_container, Podman, ETICHETTA_RIFERIMENTO};

/// Da quanto dev'essere fermo un progetto prima di spegnerlo.
///
/// Venti minuti: abbastanza perché una pausa non chiuda il lavoro, abbastanza
/// poco perché una scheda chiusa non tenga un container acceso tutta la notte.
pub const FERMO_PREDEFINITO: Duration = Duration::from_secs(20 * 60);

/// Un progetto aperto, dal punto di vista del gateway.
#[derive(Debug, Clone)]
pub struct Aperto {
    /// `<azienda>/<nome>`.
    pub riferimento: String,
    pub azienda: String,
    pub nome_progetto: String,
    /// Il nome del container su podman.
    pub contenitore: String,
    /// Dove raggiungerlo: `http://127.0.0.1:34567` o `http://sws-p-…:8444`.
    pub indirizzo: String,
    /// Quante finestre sono collegate adesso. Zero fa partire il timer.
    pub collegati: u32,
    /// Quando l'ultima finestra si è staccata. `None` se ce n'è ancora una.
    pub fermo_da: Option<Instant>,
}

impl Aperto {
    fn scaduto(&self, limite: Duration) -> bool {
        self.collegati == 0 && self.fermo_da.is_some_and(|t| t.elapsed() >= limite)
    }
}

/// Come il gateway raggiunge i container dei progetti.
///
/// Dipende da **dove gira il gateway**, e sono due mondi diversi:
///
/// - un processo sulla macchina non può raggiungere l'indirizzo interno di un
///   container rootless, perché vive in un'altra rete: gli serve una porta
///   pubblicata su `127.0.0.1`;
/// - un container sulla stessa rete podman lo raggiunge per nome, e le porte
///   non servono affatto.
///
/// In produzione vale il secondo (il gateway è un container dietro Traefik,
/// decisione del 09-10-2026). Il primo serve a svilupparlo e provarlo senza
/// impacchettare niente.
#[derive(Debug, Clone)]
pub enum ComeRaggiungere {
    /// Porta scelta da podman e pubblicata su `127.0.0.1`.
    PortaPubblicata,
    /// Stessa rete podman: il figlio si chiama per nome.
    Rete(String),
}

/// La porta su cui ascolta il runtime dentro il container.
pub const PORTA_FIGLIO: u16 = 8444;

/// Quanto si aspetta che un progetto appena avviato risponda.
///
/// Misurato il 09-10-2026 su questa macchina: un progetto piccolo risponde in
/// poco piu' di mezzo secondo. Quindici secondi non sono una stima di quanto
/// ci mette, sono il punto oltre il quale non ci sta mettendo: e' partito male
/// e tenerlo acceso occuperebbe il tetto dell'azienda senza servire a nessuno.
const ATTESA_AVVIO: Duration = Duration::from_secs(15);

/// `true` appena `GET <indirizzo>/health` risponde qualunque cosa.
///
/// Qualunque cosa e non 200: se il processo risponde, il listener c'e' — ed e'
/// l'unica domanda a cui questa attesa deve rispondere. Il resto lo dira' la
/// richiesta vera, con il suo stato e il suo corpo.
async fn raggiungibile_entro(indirizzo: &str, limite: Duration) -> bool {
    let scadenza = Instant::now() + limite;
    let cliente = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_default();
    let url = format!("{indirizzo}/health");
    loop {
        if cliente.get(&url).send().await.is_ok() {
            return true;
        }
        if Instant::now() >= scadenza {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

pub struct Regia {
    podman: Podman,
    /// L'immagine da avviare per un progetto.
    immagine: String,
    /// La radice dei progetti, che deve essere **lo stesso percorso
    /// sull'host e qui dentro**.
    ///
    /// Due letture diverse dello stesso valore, e questo e' il motivo del
    /// vincolo: `apri` controlla che la cartella esista — e quel controllo
    /// avviene dove gira il gateway — poi passa lo stesso percorso a podman
    /// come sorgente del bind mount, e podman lo risolve **sull'host**. Se il
    /// gateway gira in un container e vede i progetti sotto `/var/sws/...`
    /// mentre sull'host stanno sotto `/home/debian/...`, il controllo passa e
    /// il mount punta a una cartella che non esiste: il container del
    /// progetto parte vuoto. Montare la radice allo stesso percorso in tutti
    /// e due i posti toglie la differenza invece di gestirla.
    radice: std::path::PathBuf,
    come: ComeRaggiungere,
    fermo_dopo: Duration,
    /// Il segreto che il figlio pretende a ogni richiesta (`--auth-delegata`).
    /// Uno solo per tutto il gateway: i figli non si parlano fra loro, e un
    /// segreto per container vorrebbe dire tenerne traccia senza guadagno.
    segreto: Arc<String>,
    aperti: RwLock<HashMap<String, Aperto>>,
    /// Un'apertura alla volta, in tutto il gateway.
    ///
    /// Non e' prudenza astratta: caricare l'IDE manda **una decina** di
    /// richieste insieme, e se il progetto e' chiuso ognuna vorrebbe aprirlo.
    /// Senza questo lucchetto si arriverebbe in dieci dentro `apri`, e la
    /// prima riga utile di `apri` e' «togli di mezzo un container che si
    /// chiama cosi'» — cioe' il secondo arrivato cancellerebbe il container
    /// che il primo ha appena creato.
    ///
    /// Uno solo per tutto il gateway e non uno per progetto: un'apertura dura
    /// un secondo, e una mappa di lucchetti sarebbe un secondo posto dove
    /// tenere traccia dei progetti, da ripulire a mano quando si chiudono.
    apertura: tokio::sync::Mutex<()>,
}

impl Regia {
    pub fn nuova(
        podman: Podman,
        immagine: impl Into<String>,
        radice: impl Into<std::path::PathBuf>,
        come: ComeRaggiungere,
        segreto: impl Into<String>,
    ) -> Self {
        Self {
            podman,
            immagine: immagine.into(),
            radice: radice.into(),
            come,
            fermo_dopo: FERMO_PREDEFINITO,
            segreto: Arc::new(segreto.into()),
            aperti: RwLock::new(HashMap::new()),
            apertura: tokio::sync::Mutex::new(()),
        }
    }

    pub fn con_fermo_dopo(mut self, d: Duration) -> Self {
        self.fermo_dopo = d;
        self
    }

    pub fn segreto(&self) -> &str {
        &self.segreto
    }

    /// I container nostri che erano già accesi, ripresi in carico.
    ///
    /// Si chiama all'avvio del gateway. Senza, dopo un riavvio quei container
    /// resterebbero accesi e invisibili: occuperebbero memoria e il tetto dei
    /// progetti aperti senza comparire da nessuna parte, e il tentativo di
    /// riaprire quel progetto fallirebbe con «esiste già».
    ///
    /// Chi viene riadottato parte con zero collegati e il timer avviato: se
    /// nessuno torna, si spegne da sé al primo giro di pulizia. È il
    /// comportamento giusto — dopo un riavvio del gateway nessun browser è
    /// più collegato a niente.
    pub async fn riadotta(&self) -> anyhow::Result<usize> {
        let trovati = self.podman.elenca_nostri().await?;
        let mut aperti = self.aperti.write().await;
        let mut quanti = 0;
        for c in trovati {
            let Some(rif) = c.riferimento.clone() else {
                // Senza etichetta non si sa di che progetto sia. Non lo si
                // adotta e non lo si uccide: lo si lascia e lo si dice, che è
                // meglio che indovinare.
                tracing::warn!(
                    contenitore = %c.nome,
                    "container del gateway senza etichetta «{ETICHETTA_RIFERIMENTO}»: non lo adotto"
                );
                continue;
            };
            let Some((az, nome)) = rif.split_once('/').map(|(a, n)| (a.to_string(), n.to_string()))
            else {
                continue;
            };
            if c.stato != "running" {
                // Fermo: non c'è niente da adottare, e tenerlo occuperebbe il
                // nome. Si rimuove, così la prossima apertura lo ricrea.
                let _ = self.podman.rimuovi(&c.nome).await;
                continue;
            }
            let indirizzo = match self.indirizzo_di(&c.nome).await {
                Some(i) => i,
                None => {
                    tracing::warn!(contenitore = %c.nome, "non so come raggiungerlo: lo fermo");
                    let _ = self.podman.ferma(&c.nome, 5).await;
                    let _ = self.podman.rimuovi(&c.nome).await;
                    continue;
                }
            };
            aperti.insert(
                rif.clone(),
                Aperto {
                    riferimento: rif,
                    azienda: az,
                    nome_progetto: nome,
                    contenitore: c.nome,
                    indirizzo,
                    collegati: 0,
                    fermo_da: Some(Instant::now()),
                },
            );
            quanti += 1;
        }
        if quanti > 0 {
            tracing::info!(quanti, "container ripresi in carico dopo un riavvio del gateway");
        }
        Ok(quanti)
    }

    async fn indirizzo_di(&self, contenitore: &str) -> Option<String> {
        match &self.come {
            ComeRaggiungere::Rete(rete) => {
                let ip = self.podman.ip_sulla_rete(contenitore, rete).await.ok()??;
                Some(format!("http://{ip}:{PORTA_FIGLIO}"))
            }
            ComeRaggiungere::PortaPubblicata => {
                let porta = self.podman.porta_pubblicata(contenitore, PORTA_FIGLIO).await.ok()??;
                Some(format!("http://127.0.0.1:{porta}"))
            }
        }
    }

    pub async fn elenco(&self) -> Vec<Aperto> {
        self.aperti.read().await.values().cloned().collect()
    }

    /// Quanti progetti di quell'azienda sono aperti adesso.
    pub async fn aperti_di(&self, azienda: &str) -> usize {
        self.aperti.read().await.values().filter(|a| a.azienda == azienda).count()
    }

    /// Una finestra si è collegata a quel progetto.
    pub async fn collegato(&self, riferimento: &str) {
        if let Some(a) = self.aperti.write().await.get_mut(riferimento) {
            a.collegati += 1;
            a.fermo_da = None;
        }
    }

    /// Una finestra se n'è andata. Se era l'ultima, parte il timer.
    pub async fn scollegato(&self, riferimento: &str) {
        if let Some(a) = self.aperti.write().await.get_mut(riferimento) {
            a.collegati = a.collegati.saturating_sub(1);
            if a.collegati == 0 {
                a.fermo_da = Some(Instant::now());
            }
        }
    }

    /// Spegne i progetti fermi da troppo. Ritorna quali.
    pub async fn spegni_i_fermi(&self) -> Vec<String> {
        let scaduti: Vec<Aperto> = {
            let aperti = self.aperti.read().await;
            aperti.values().filter(|a| a.scaduto(self.fermo_dopo)).cloned().collect()
        };
        let mut spenti = Vec::new();
        for a in scaduti {
            if let Err(e) = self.podman.ferma(&a.contenitore, 10).await {
                tracing::warn!(contenitore = %a.contenitore, "non si ferma: {e}");
                continue;
            }
            let _ = self.podman.rimuovi(&a.contenitore).await;
            self.aperti.write().await.remove(&a.riferimento);
            tracing::info!(progetto = %a.riferimento, "spento perche fermo");
            spenti.push(a.riferimento);
        }
        spenti
    }

    /// Apre un progetto: lo trova gia aperto, oppure crea e avvia il suo
    /// container.
    ///
    /// `tetto` e quanti progetti quell'azienda puo tenere aperti insieme,
    /// `None` = nessun limite. Lo passa chi chiama, perche la regia non deve
    /// conoscere l'archivio delle identita: sapere **quanti** sono aperti e
    /// cosa suo, sapere **quanti puo** tenerne un'azienda no.
    ///
    /// Al tetto si **rifiuta** (decisione del maintainer): non si spegne il
    /// piu vecchio per far posto, perche chi sta lavorando non deve ritrovarsi
    /// il progetto chiuso.
    pub async fn apri(
        &self,
        azienda: &str,
        nome: &str,
        cartella_azienda: &str,
        tetto: Option<i64>,
    ) -> Result<Aperto, Apertura> {
        let riferimento = format!("{azienda}/{nome}");

        if let Some(gia) = self.aperti.read().await.get(&riferimento) {
            return Ok(gia.clone());
        }

        // Da qui in giu' si apre, e si apre in uno per volta.
        let _turno = self.apertura.lock().await;
        // Chi aspettava il turno puo' trovarlo gia' aperto da chi lo aveva
        // prima: e' il caso normale, non un'eccezione.
        if let Some(gia) = self.aperti.read().await.get(&riferimento) {
            return Ok(gia.clone());
        }

        // Assente = nessun limite, zero = nessun progetto aperto. La stessa
        // lettura dello spazio (`StatoQuota`), perche' due letture opposte
        // dello stesso valore prima o poi finiscono sul posto sbagliato.
        if let Some(max) = tetto {
            let ora = self.aperti_di(azienda).await as i64;
            if ora >= max {
                return Err(Apertura::TettoPieno { ora, max });
            }
        }

        // La cartella vera del progetto, che e l'unica cosa che il figlio
        // vedra del disco (decisione 25). L'azienda implicita ha la cartella
        // vuota: il progetto sta nella radice.
        let sul_disco = if cartella_azienda.is_empty() {
            self.radice.join(nome)
        } else {
            self.radice.join(cartella_azienda).join(nome)
        };
        if !sul_disco.is_dir() {
            return Err(Apertura::NonTrovato);
        }

        let contenitore = nome_container(azienda, nome);
        // Un avanzo di un giro precedente occuperebbe il nome.
        let _ = self.podman.rimuovi(&contenitore).await;

        let mut spec = serde_json::json!({
            "image": self.immagine,
            "name": contenitore,
            "labels": { ETICHETTA_RIFERIMENTO: riferimento },
            "env": {
                "SWS_SEGRETO_GATEWAY": self.segreto.as_str(),
                // La chiave con cui il container si farà riconoscere quando
                // chiama il gateway (i pannelli, `/dev/…`): vedi `ritorno.rs`.
                "SWS_CHIAVE_RITORNO": crate::gateway::ritorno::chiave_per(self.segreto.as_str(), &riferimento),
            },
            "mounts": [{
                "type": "bind",
                "source": sul_disco.to_string_lossy(),
                "destination": "/progetto",
                "options": ["rw"],
            }],
            // Gli argomenti dell'immagine, sostituiti: niente `--viewer-port`
            // (un progetto nel cloud non serve un impianto) e niente
            // `--no-admin` (l'IDE serve tutto).
            "command": [
                "--config", "/var/sws/config",
                "--projects-root", "/var/sws/projects",
                "--templates-root", "/var/sws/templates",
                "--catalog-root", "/var/sws/catalogo/dispositivi",
                "--www", "/var/sws/www",
                "--project", "/progetto",
                "--admin-port", PORTA_FIGLIO.to_string(),
                "--auth-delegata",
            ],
        });

        match &self.come {
            ComeRaggiungere::Rete(rete) => {
                // `Networks` da solo non basta, e podman lo dice chiaro:
                // «networks and static ip/mac address can only be used with
                // Bridge mode networking». Il modo predefinito di un
                // container creato via API non e' bridge, quindi va chiesto —
                // visto il 09-10-2026 alla prima prova del gateway dentro un
                // container, dove ogni apertura finiva in HTTP 500.
                spec["netns"] = serde_json::json!({ "nsmode": "bridge" });
                // L'alias col nome del container non serve a noi — lo
                // raggiungiamo per IP — ma e' quello che permette a un umano
                // di fare `podman exec … curl http://sws-p-…:8444` quando
                // qualcosa non torna. Podman lo aggiunge da se' solo quando il
                // container nasce dalla riga di comando, non via API.
                spec["Networks"] = serde_json::json!({
                    rete.as_str(): { "aliases": [contenitore.as_str()] }
                });
            }
            ComeRaggiungere::PortaPubblicata => {
                // `host_port: 0` = scegli tu. Cercarne una libera da soli
                // vuol dire una corsa fra il trovarla e l'usarla.
                spec["portmappings"] = serde_json::json!([{
                    "container_port": PORTA_FIGLIO,
                    "host_port": 0,
                    "host_ip": "127.0.0.1",
                }]);
            }
        }

        self.podman.crea(spec).await.map_err(|e| Apertura::Podman(e.to_string()))?;
        self.podman
            .avvia(&contenitore)
            .await
            .map_err(|e| Apertura::Podman(e.to_string()))?;

        let Some(indirizzo) = self.indirizzo_di(&contenitore).await else {
            let _ = self.podman.ferma(&contenitore, 5).await;
            let _ = self.podman.rimuovi(&contenitore).await;
            return Err(Apertura::Podman("avviato ma non so come raggiungerlo".into()));
        };

        // **Si aspetta che risponda**, prima di dire che e' aperto.
        //
        // `avvia` torna quando podman ha fatto partire il processo, non quando
        // quel processo ascolta: fra le due cose c'e' l'apertura del progetto,
        // che su un progetto grosso non e' istantanea. Senza questa attesa la
        // prima richiesta del browser prende un 502 e la pagina si apre rotta
        // — e al secondo tentativo funziona, che e' il modo peggiore di
        // fallire perche' non lo si riproduce mai.
        if !raggiungibile_entro(&indirizzo, ATTESA_AVVIO).await {
            let _ = self.podman.ferma(&contenitore, 5).await;
            let _ = self.podman.rimuovi(&contenitore).await;
            return Err(Apertura::Podman(format!(
                "avviato ma non risponde su {indirizzo} entro {} secondi",
                ATTESA_AVVIO.as_secs()
            )));
        }

        let aperto = Aperto {
            riferimento: riferimento.clone(),
            azienda: azienda.to_string(),
            nome_progetto: nome.to_string(),
            contenitore,
            indirizzo,
            collegati: 0,
            // Il timer parte subito: se nessuno si collega, questo container
            // non deve restare acceso per sempre.
            fermo_da: Some(Instant::now()),
        };
        self.aperti.write().await.insert(riferimento, aperto.clone());
        tracing::info!(progetto = %aperto.riferimento, indirizzo = %aperto.indirizzo, "progetto aperto");
        Ok(aperto)
    }

    /// Chiude un progetto adesso, senza aspettare il timer.
    pub async fn chiudi(&self, riferimento: &str) -> anyhow::Result<()> {
        let Some(a) = self.aperti.write().await.remove(riferimento) else {
            return Ok(());
        };
        self.podman.ferma(&a.contenitore, 10).await?;
        let _ = self.podman.rimuovi(&a.contenitore).await;
        Ok(())
    }
}

/// Perche' un'apertura non e' riuscita.
///
/// Separati perche' il chiamante risponde in modo diverso: il tetto e' un 409
/// con un messaggio che si legge, un progetto che non c'e' e' un 404, e un
/// guasto di podman e' un 500 con il motivo nei log.
#[derive(Debug)]
pub enum Apertura {
    /// L'azienda ha gia' aperti tutti i progetti che le spettano.
    TettoPieno { ora: i64, max: i64 },
    /// Sul disco quella cartella non c'e'.
    NonTrovato,
    Podman(String),
}

impl std::fmt::Display for Apertura {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TettoPieno { ora, max } => write!(
                f,
                "la tua azienda puo tenere aperti {max} progetti insieme, e sono gia {ora}. \
                 Chiudine uno e riprova."
            ),
            Self::NonTrovato => write!(f, "progetto non trovato"),
            Self::Podman(e) => write!(f, "non riesco ad avviare il progetto: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aperto(collegati: u32, fermo_da_s: Option<u64>) -> Aperto {
        Aperto {
            riferimento: "acme/impianto".into(),
            azienda: "acme".into(),
            nome_progetto: "impianto".into(),
            contenitore: nome_container("acme", "impianto"),
            indirizzo: "http://127.0.0.1:1".into(),
            collegati,
            fermo_da: fermo_da_s.map(|s| Instant::now() - Duration::from_secs(s)),
        }
    }

    /// Finche' una finestra e' collegata non si spegne niente, per quanto
    /// tempo sia passato: il segnale e' il browser, non l'orologio.
    #[test]
    fn con_qualcuno_collegato_non_scade_mai() {
        let limite = Duration::from_secs(60);
        assert!(!aperto(1, None).scaduto(limite));
        // Anche se per qualche motivo il timer risultasse avviato.
        assert!(!aperto(1, Some(9999)).scaduto(limite));
        assert!(!aperto(3, Some(9999)).scaduto(limite));
    }

    /// Staccata l'ultima finestra parte il timer, e scade solo quando e'
    /// passato il tempo intero.
    #[test]
    fn senza_nessuno_scade_quando_passa_il_tempo() {
        let limite = Duration::from_secs(60);
        assert!(!aperto(0, Some(10)).scaduto(limite), "dieci secondi non bastano");
        assert!(!aperto(0, Some(59)).scaduto(limite));
        assert!(aperto(0, Some(60)).scaduto(limite));
        assert!(aperto(0, Some(600)).scaduto(limite));
    }

    /// Il giro vero: apre un progetto in un container, lo raggiunge, lo
    /// chiude.
    ///
    /// `#[ignore]` perche' tocca podman e vuole l'immagine del runtime gia'
    /// scaricata. Si lancia a mano:
    /// `cargo test -p sws-web --lib -- --ignored apre_un_progetto --nocapture`
    /// e si puo' puntare a un'altra immagine con `SWS_IMMAGINE_PROVA`.
    #[tokio::test]
    #[ignore]
    async fn apre_un_progetto_vero_in_un_container() {
        let Some(podman) = Podman::predefinito() else {
            eprintln!("nessun socket podman: prova saltata");
            return;
        };
        if !podman.raggiungibile().await {
            eprintln!("podman non risponde: prova saltata");
            return;
        }
        let immagine = std::env::var("SWS_IMMAGINE_PROVA")
            .unwrap_or_else(|_| "localhost/sws-runtime:2.13.0-rc.1-amd64".into());

        // Un progetto vero, copiato: il container lo monta in scrittura e non
        // deve poter toccare quello del maintainer.
        let temp = std::env::temp_dir().join(format!("sws-regia-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        let dentro = temp.join("acme").join("impianto");
        std::fs::create_dir_all(&dentro).unwrap();
        std::fs::write(
            dentro.join("project.yaml"),
            "version: 1\nmeta:\n  name: impianto\n",
        )
        .unwrap();

        let regia = Regia::nuova(
            podman,
            immagine,
            &temp,
            ComeRaggiungere::PortaPubblicata,
            "segretolungoabbastanza0123",
        );

        // Il tetto si rispetta PRIMA di avviare qualunque cosa.
        match regia.apri("acme", "impianto", "acme", Some(0)).await {
            Err(Apertura::TettoPieno { .. }) => {}
            altro => panic!("un tetto a zero doveva fermarlo: {altro:?}"),
        }

        let aperto = match regia.apri("acme", "impianto", "acme", Some(3)).await {
            Ok(a) => a,
            Err(e) => panic!("apertura fallita: {e}"),
        };
        assert!(aperto.indirizzo.starts_with("http://127.0.0.1:"), "{}", aperto.indirizzo);

        // Il figlio deve rispondere. Qualche secondo per partire.
        let mut vivo = false;
        for _ in 0..30 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(r) = reqwest::get(format!("{}/health", aperto.indirizzo)).await {
                if r.status().is_success() {
                    vivo = true;
                    break;
                }
            }
        }
        assert!(vivo, "il container e partito ma non risponde su {}", aperto.indirizzo);

        // E pretende il segreto: senza, 401.
        let cl = reqwest::Client::new();
        let senza = cl.get(format!("{}/api/system", aperto.indirizzo)).send().await.unwrap();
        assert_eq!(senza.status(), 401, "il figlio si fida di chiunque");
        let con = cl
            .get(format!("{}/api/system", aperto.indirizzo))
            .header("X-SWS-Gateway", regia.segreto())
            .header("X-SWS-Utente", "tizio@acme.it")
            .send()
            .await
            .unwrap();
        assert_eq!(con.status(), 200, "col segreto giusto doveva rispondere");

        // Riaprire non crea un secondo container.
        let di_nuovo = regia.apri("acme", "impianto", "acme", Some(3)).await.unwrap();
        assert_eq!(di_nuovo.contenitore, aperto.contenitore);
        assert_eq!(regia.aperti_di("acme").await, 1);

        regia.chiudi(&aperto.riferimento).await.unwrap();
        assert_eq!(regia.aperti_di("acme").await, 0);
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// Zero collegati ma timer mai avviato: non scade. E il caso di un
    /// container appena creato, prima che qualcuno si colleghi — spegnerlo
    /// subito vorrebbe dire non riuscire mai ad aprire un progetto.
    #[test]
    fn appena_creato_non_si_spegne() {
        assert!(!aperto(0, None).scaduto(Duration::from_secs(60)));
    }
}
