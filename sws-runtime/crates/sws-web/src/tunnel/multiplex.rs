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
                else => break,
            }
        }
        tracing::debug!("tunnel: il compito che lo guida è finito");
    });

    (Maniglia { richieste: chiedi }, in_arrivo)
}

/// Le maniglie dei pannelli collegati, per nome.
#[derive(Default)]
pub struct Registro {
    dentro: tokio::sync::RwLock<std::collections::HashMap<String, Maniglia>>,
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
    }

    pub async fn esce(&self, pannello: &str) {
        self.dentro.write().await.remove(pannello);
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
}
