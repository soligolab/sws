//! `yamux` reso usabile da più punti del programma.
//!
//! `yamux::Connection` è un oggetto solo che va **sondato** perché il
//! protocollo avanzi: i pacchetti di controllo, le conferme, le chiusure, non
//! succedono da sé. Chi vuole un nuovo stream deve quindi passare da chi tiene
//! in mano la connessione, e non può semplicemente chiamare un metodo.
//!
//! Qui dentro c'è quel pezzo: un compito che possiede la connessione e la fa
//! girare, e una `Maniglia` che si può copiare e portare dove serve — in un
//! handler HTTP, per esempio — per chiedere «aprimi uno stream».

use std::sync::Arc;

use futures_util::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};
use yamux::{Config, Connection, Mode, Stream};

/// Con chi si parla, da questo capo del tunnel.
pub enum Verso {
    /// Apre stream: il gateway, che manda le richieste dell'IDE.
    Chiama,
    /// Accetta stream: il pannello, che li gira alla propria porta.
    Risponde,
}

/// Il permesso di chiedere stream nuovi a una connessione che vive altrove.
#[derive(Clone)]
pub struct Maniglia {
    richieste: mpsc::Sender<oneshot::Sender<Result<Stream, String>>>,
    /// Suona per far finire il compito che guida la connessione (ramo 7 dei
    /// residui, 26-10-2026): il gateway che ha smesso di sentire il pannello
    /// non può aspettare che sia yamux ad accorgersene, perché su una
    /// half-open non se ne accorge mai.
    basta: Arc<tokio::sync::Notify>,
}

impl Maniglia {
    /// Uno stream nuovo verso l'altro capo.
    pub async fn apri(&self) -> Result<Stream, String> {
        let (dimmi, saprai) = oneshot::channel();
        self.richieste
            .send(dimmi)
            .await
            .map_err(|_| "il tunnel non c'è più".to_string())?;
        saprai.await.map_err(|_| "il tunnel è caduto mentre aprivo".to_string())?
    }

    /// Chiude la connessione da questo capo, anche se l'altro tace.
    pub fn chiudi(&self) {
        self.basta.notify_one();
    }

    /// Vero se le due maniglie guidano la stessa connessione.
    pub fn stessa(&self, altra: &Maniglia) -> bool {
        self.richieste.same_channel(&altra.richieste)
    }

    /// Falso quando il compito che guida la connessione è finito.
    pub fn vivo(&self) -> bool {
        !self.richieste.is_closed()
    }
}

/// Fa girare una connessione yamux fino a quando cade.
///
/// Restituisce la `Maniglia` per chiedere stream e un ricevitore per quelli
/// che arrivano dall'altra parte. Chi non se ne aspetta — il gateway — lascia
/// cadere il ricevitore, e allora gli stream in arrivo vengono chiusi subito:
/// è la risposta giusta a uno stream che nessuno aspettava.
pub fn avvia<T>(socket: T, verso: Verso) -> (Maniglia, mpsc::Receiver<Stream>)
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let modo = match verso {
        Verso::Chiama => Mode::Client,
        Verso::Risponde => Mode::Server,
    };
    let mut cfg = Config::default();
    // Il corpo di un progetto esportato passa di qui: con la finestra
    // predefinita il mittente si ferma ogni manciata di kilobyte in attesa
    // della conferma, e su una linea con latenza quello si vede.
    cfg.set_max_num_streams(256);

    let (chiedi, mut chieste) = mpsc::channel::<oneshot::Sender<Result<Stream, String>>>(32);
    let (arrivati, in_arrivo) = mpsc::channel::<Stream>(32);
    let basta = Arc::new(tokio::sync::Notify::new());
    let fine = basta.clone();

    tokio::spawn(async move {
        let mut conn = Connection::new(socket, cfg, modo);
        loop {
            tokio::select! {
                // `poll_next_inbound` non serve solo a ricevere: è ciò che fa
                // **avanzare** la connessione. Senza chiamarlo, anche
                // un'apertura in uscita resterebbe ferma.
                in_ingresso = futures_util::future::poll_fn(|cx| conn.poll_next_inbound(cx)) => {
                    match in_ingresso {
                        Some(Ok(s)) => {
                            if arrivati.send(s).await.is_err() {
                                // Nessuno li aspetta: li si lascia cadere, che
                                // per yamux vuol dire chiuderli.
                            }
                        }
                        Some(Err(e)) => {
                            tracing::debug!("tunnel caduto: {e}");
                            break;
                        }
                        None => break,
                    }
                }
                Some(dimmi) = chieste.recv() => {
                    let esito = futures_util::future::poll_fn(|cx| conn.poll_new_outbound(cx))
                        .await
                        .map_err(|e| e.to_string());
                    let era_guasto = esito.is_err();
                    let _ = dimmi.send(esito);
                    if era_guasto {
                        break;
                    }
                }
                _ = fine.notified() => break,
                else => break,
            }
        }
        tracing::debug!("tunnel: il compito che lo guida è finito");
    });

    (Maniglia { richieste: chiedi, basta }, in_arrivo)
}

/// Le maniglie dei pannelli collegati, per nome.
#[derive(Default)]
pub struct Registro {
    dentro: tokio::sync::RwLock<std::collections::HashMap<String, Maniglia>>,
    /// I pannelli che si sono **annunciati** spenti, con l'ora (ms): uno
    /// spegnimento ordinato — l'UPS lo rende possibile anche a corrente
    /// mancata — non è una caduta, e la console lo dice.
    spenti: std::sync::Mutex<std::collections::HashMap<String, u64>>,
}

impl Registro {
    pub fn nuovo() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Prende il posto del pannello con quel nome.
    ///
    /// Se c'era già una connessione **vince la nuova**, e va detto perché: il
    /// caso normale non è un impostore ma un pannello che ha perso la linea e
    /// ha richiamato prima che noi ci accorgessimo della caduta. Tenere la
    /// vecchia vorrebbe dire un pannello irraggiungibile finché un timeout non
    /// scade, cioè proprio quando serve.
    pub async fn entra(&self, pannello: &str, m: Maniglia) {
        self.dentro.write().await.insert(pannello.to_string(), m);
        self.spenti.lock().unwrap_or_else(|e| e.into_inner()).remove(pannello);
    }

    /// Toglie il pannello **solo se la maniglia è ancora la sua**. La
    /// connessione vecchia di un pannello che ha già richiamato finisce dopo
    /// che la nuova è entrata: togliere per nome cancellerebbe la nuova, e il
    /// pannello resterebbe collegato ma irraggiungibile.
    pub async fn esce(&self, pannello: &str, m: &Maniglia) {
        let mut d = self.dentro.write().await;
        if d.get(pannello).is_some_and(|c| c.stessa(m)) {
            d.remove(pannello);
        }
    }

    /// Stacca il pannello **davvero**: lo toglie e chiude la connessione, così
    /// che richiami e passi di nuovo dal riconoscimento. Toglierlo soltanto
    /// (com'era fino al 26-10-2026) lasciava il socket aperto: il pannello non
    /// richiamava, e restava irraggiungibile senza saperlo.
    pub async fn stacca(&self, pannello: &str) {
        if let Some(m) = self.dentro.write().await.remove(pannello) {
            m.chiudi();
        }
    }

    /// Il pannello ha annunciato lo spegnimento prima di chiudere.
    pub fn spento(&self, pannello: &str, ms: u64) {
        self.spenti.lock().unwrap_or_else(|e| e.into_inner()).insert(pannello.to_string(), ms);
    }

    /// Quando si è annunciato spento, se dopo non è più tornato.
    pub fn spento_il(&self, pannello: &str) -> Option<u64> {
        self.spenti.lock().unwrap_or_else(|e| e.into_inner()).get(pannello).copied()
    }

    pub async fn di(&self, pannello: &str) -> Option<Maniglia> {
        let m = self.dentro.read().await.get(pannello).cloned()?;
        m.vivo().then_some(m)
    }

    pub async fn collegati(&self) -> Vec<String> {
        let d = self.dentro.read().await;
        let mut v: Vec<String> = d.iter().filter(|(_, m)| m.vivo()).map(|(k, _)| k.clone()).collect();
        v.sort();
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::io::{AsyncReadExt, AsyncWriteExt};

    /// Due capi veri di yamux, uno contro l'altro su una socket in memoria.
    #[tokio::test]
    async fn uno_stream_attraversa_il_multiplexer() {
        let (a, b) = tokio::io::duplex(64 * 1024);
        use tokio_util::compat::TokioAsyncReadCompatExt as _;
        let (chiamante, _) = avvia(a.compat(), Verso::Chiama);
        let (_risponde, mut in_arrivo) = avvia(b.compat(), Verso::Risponde);

        let scrivi = tokio::spawn(async move {
            let mut s = chiamante.apri().await.expect("stream aperto");
            s.write_all(b"ciao pannello").await.unwrap();
            s.close().await.unwrap();
        });

        let mut ricevuto = in_arrivo.recv().await.expect("stream arrivato");
        let mut detto = String::new();
        ricevuto.read_to_string(&mut detto).await.unwrap();
        assert_eq!(detto, "ciao pannello");
        scrivi.await.unwrap();
    }

    /// Il battito del tunnel: uno stream aperto e lasciato cadere **arriva**
    /// dall'altra parte, cioe' e' traffico vero.
    ///
    /// E' la prova che manca al difetto del 09-10, dove il compito del
    /// keepalive dormiva e basta: il tunnel si riapriva ogni quindici minuti
    /// (misurato sul WP630 il 16-10-2026). Un test che guardi «il compito
    /// esiste» non l'avrebbe visto — quello esisteva.
    #[tokio::test]
    async fn il_battito_arriva_dall_altra_parte() {
        use tokio_util::compat::TokioAsyncReadCompatExt as _;
        let (a, b) = tokio::io::duplex(64 * 1024);
        // Il pannello **risponde** agli stream, ma il battito lo apre lui: e'
        // il verso che conta, perche' su `Mode::Server` aprire deve comunque
        // funzionare.
        let (pannello, _) = avvia(a.compat(), Verso::Risponde);
        let (_gw, mut al_gateway) = avvia(b.compat(), Verso::Chiama);

        let battito = tokio::spawn(async move {
            use futures_util::io::AsyncWriteExt as _;
            let mut s = pannello.apri().await.expect("il battito non si e' aperto");
            // Il byte e' la parte che conta: senza, yamux non manda niente e
            // lo stream non arriva mai.
            s.write_all(b"\0").await.unwrap();
            s.close().await.unwrap();
        });
        let arrivato = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            al_gateway.recv(),
        )
        .await
        .expect("il battito non e' arrivato entro 5 s");
        assert!(arrivato.is_some(), "nessuno stream dall'altra parte");
        battito.await.unwrap();
    }

    #[tokio::test]
    async fn il_registro_dimentica_un_tunnel_morto() {
        let (a, _b) = tokio::io::duplex(1024);
        use tokio_util::compat::TokioAsyncReadCompatExt as _;
        let (m, _) = avvia(a.compat(), Verso::Chiama);
        let r = Registro::nuovo();
        r.entra("pannello-1", m).await;
        assert_eq!(r.collegati().await, vec!["pannello-1"]);
        // L'altro capo non esiste piu': il compito finisce e la maniglia
        // smette di valere. Il registro non deve far finta di niente.
        drop(_b);
        for _ in 0..50 {
            if r.di("pannello-1").await.is_none() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("il registro tiene ancora un tunnel caduto");
    }

    /// Una connessione vecchia che finisce dopo che la nuova è entrata non
    /// deve portarsi via la nuova (era documentato, non asserito).
    #[tokio::test]
    async fn la_connessione_vecchia_non_toglie_la_nuova() {
        use tokio_util::compat::TokioAsyncReadCompatExt as _;
        let (a, _b) = tokio::io::duplex(1024);
        let (c, _d) = tokio::io::duplex(1024);
        let (vecchia, _) = avvia(a.compat(), Verso::Chiama);
        let (nuova, _) = avvia(c.compat(), Verso::Chiama);
        let r = Registro::nuovo();
        r.entra("p", vecchia.clone()).await;
        r.entra("p", nuova.clone()).await;
        r.esce("p", &vecchia).await;
        assert!(r.di("p").await.is_some_and(|m| m.stessa(&nuova)), "la nuova deve restare");
        r.esce("p", &nuova).await;
        assert!(r.di("p").await.is_none());
    }

    #[tokio::test]
    async fn chiudi_ferma_la_connessione_anche_se_l_altro_tace() {
        use tokio_util::compat::TokioAsyncReadCompatExt as _;
        let (a, _b) = tokio::io::duplex(1024);
        let (m, _) = avvia(a.compat(), Verso::Chiama);
        assert!(m.vivo());
        m.chiudi();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while m.vivo() {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("la connessione doveva finire");
    }

    #[test]
    fn rientrare_cancella_lo_spegnimento_annunciato() {
        let r = Registro::default();
        r.spento("p", 42);
        assert_eq!(r.spento_il("p"), Some(42));
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        rt.block_on(async {
            use tokio_util::compat::TokioAsyncReadCompatExt as _;
            let (a, _b) = tokio::io::duplex(1024);
            let (m, _) = avvia(a.compat(), Verso::Chiama);
            r.entra("p", m).await;
        });
        assert_eq!(r.spento_il("p"), None);
    }
}
