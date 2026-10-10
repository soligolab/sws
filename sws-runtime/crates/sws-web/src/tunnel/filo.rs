//! Il WebSocket visto come un flusso di byte.
//!
//! `yamux` vuole qualcosa che si legga e si scriva — `AsyncRead` + `AsyncWrite`
//! — mentre un WebSocket consegna **messaggi**. Questo modulo mette i due in
//! fila: ogni scrittura diventa un frame binario, e ogni frame binario che
//! arriva viene servito un pezzo per volta a chi legge.
//!
//! **Perché un WebSocket e non una connessione TCP nuda.** Il pannello chiama
//! da dentro la rete di un cliente, dove l'unica cosa che passa sempre è HTTPS
//! sulla 443: un proxy in mezzo, un firewall che guarda i protocolli, e una
//! connessione TCP qualunque si ferma. Il WebSocket nasce da una richiesta
//! HTTPS normale, quindi passa dove passa un browser — e dall'altra parte
//! Traefik lo instrada per nome host come qualunque altra cosa, senza una
//! porta in più da aprire.
//!
//! **Il confine dei messaggi non conta niente.** Qui dentro i frame non hanno
//! significato: sono solo il mezzo con cui i byte attraversano. Chi legge può
//! ricevere mezzo frame o tre frame di fila, ed è giusto così — `yamux` sopra
//! ha i suoi confini, che non sono questi.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures_util::io::{AsyncRead, AsyncWrite};
use futures_util::{Sink, SinkExt, Stream, StreamExt};

/// Un flusso di byte sopra un WebSocket.
///
/// Generico sul tipo di socket perché i due lati usano librerie diverse: il
/// gateway ha l'`axum::extract::ws::WebSocket` del suo server, il pannello ha
/// quello di `tokio-tungstenite`. Le due parlano lo stesso protocollo ma non
/// hanno un tipo in comune, e scrivere l'adattatore due volte vorrebbe dire
/// due posti dove sbagliare lo stesso dettaglio.
pub struct Filo<S, M> {
    socket: S,
    _messaggio: std::marker::PhantomData<fn() -> M>,
    /// Quello che è arrivato e non è ancora stato letto da nessuno.
    avanzo: Bytes,
    /// Vero quando l'altro capo ha chiuso: da lì in poi leggere dà 0 byte,
    /// che è il modo in cui `AsyncRead` dice «finito».
    chiuso: bool,
}

impl<S, M> Filo<S, M> {
    pub fn nuovo(socket: S) -> Self {
        Self {
            socket,
            _messaggio: std::marker::PhantomData,
            avanzo: Bytes::new(),
            chiuso: false,
        }
    }
}

/// Cosa portava un messaggio appena arrivato.
///
/// Tre casi e non due: un messaggio di servizio (ping, pong) **non** è «fine
/// del flusso», ed è l'errore che questo tipo esiste per rendere impossibile.
pub enum Pezzo {
    Byte(Vec<u8>),
    Servizio,
    Fine,
}

/// Quello che esce dallo `Stream` di un socket WebSocket, qualunque libreria.
///
/// Esiste per non dover nominare il tipo dell'errore nei vincoli: `Stream` lo
/// porta dentro `Item`, e un parametro in più che non compare nel tipo non si
/// può scrivere (`E0207`).
pub trait VoceWs {
    fn pezzo(self) -> Result<Pezzo, String>;
}

impl<M: MessaggioWs, E: std::fmt::Display> VoceWs for Result<M, E> {
    fn pezzo(self) -> Result<Pezzo, String> {
        match self {
            Err(e) => Err(e.to_string()),
            Ok(m) if m.e_chiusura() => Ok(Pezzo::Fine),
            Ok(m) => Ok(m.in_byte().map(Pezzo::Byte).unwrap_or(Pezzo::Servizio)),
        }
    }
}

/// Quello che il `Filo` deve saper fare con un socket, qualunque libreria sia.
///
/// Tre operazioni e nessuna di più: impacchettare byte in un messaggio,
/// riconoscere i byte dentro un messaggio ricevuto, e dire se un messaggio va
/// ignorato (ping, pong, testo) invece che consegnato.
pub trait MessaggioWs: Sized {
    fn da_byte(b: Vec<u8>) -> Self;
    /// `Some(byte)` se porta dati, `None` se è un messaggio di servizio.
    fn in_byte(self) -> Option<Vec<u8>>;
    /// Vero se questo messaggio chiude la conversazione.
    fn e_chiusura(&self) -> bool;
}

impl<S, M> AsyncRead for Filo<S, M>
where
    S: Stream + Unpin,
    S::Item: VoceWs,
{
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut [u8],
    ) -> Poll<io::Result<usize>> {
        loop {
            if !self.avanzo.is_empty() {
                let quanti = self.avanzo.len().min(buf.len());
                buf[..quanti].copy_from_slice(&self.avanzo[..quanti]);
                let _ = self.avanzo.split_to(quanti);
                return Poll::Ready(Ok(quanti));
            }
            if self.chiuso {
                return Poll::Ready(Ok(0));
            }
            match futures_util::ready!(self.socket.poll_next_unpin(cx)) {
                None => {
                    self.chiuso = true;
                    return Poll::Ready(Ok(0));
                }
                Some(voce) => match voce.pezzo() {
                    Err(e) => return Poll::Ready(Err(errore(e))),
                    Ok(Pezzo::Fine) => {
                        self.chiuso = true;
                        return Poll::Ready(Ok(0));
                    }
                    // Un messaggio di servizio non porta byte: si riprova,
                    // invece di restituire «zero byte letti», che per
                    // `AsyncRead` vorrebbe dire fine del flusso.
                    Ok(Pezzo::Servizio) => continue,
                    Ok(Pezzo::Byte(b)) => self.avanzo = Bytes::from(b),
                },
            }
        }
    }
}

impl<S, M> AsyncWrite for Filo<S, M>
where
    S: Sink<M> + Unpin,
    S::Error: std::fmt::Display,
    M: MessaggioWs,
{
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        futures_util::ready!(self.socket.poll_ready_unpin(cx)).map_err(errore)?;
        self.socket
            .start_send_unpin(M::da_byte(buf.to_vec()))
            .map_err(errore)?;
        Poll::Ready(Ok(buf.len()))
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.socket.poll_flush_unpin(cx).map_err(errore)
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.socket.poll_close_unpin(cx).map_err(errore)
    }
}

fn errore(e: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::BrokenPipe, format!("tunnel: {e}"))
}

// ── Le due incarnazioni del messaggio ────────────────────────────────────────

impl MessaggioWs for axum::extract::ws::Message {
    fn da_byte(b: Vec<u8>) -> Self {
        Self::Binary(b)
    }
    fn in_byte(self) -> Option<Vec<u8>> {
        match self {
            Self::Binary(b) => Some(b),
            // Il testo non si converte in byte di proposito: dentro il tunnel
            // non passa mai testo, e accettarlo vorrebbe dire accettare
            // qualcosa che non abbiamo mandato noi.
            _ => None,
        }
    }
    fn e_chiusura(&self) -> bool {
        matches!(self, Self::Close(_))
    }
}

impl MessaggioWs for tokio_tungstenite::tungstenite::Message {
    fn da_byte(b: Vec<u8>) -> Self {
        Self::Binary(b)
    }
    fn in_byte(self) -> Option<Vec<u8>> {
        match self {
            Self::Binary(b) => Some(b),
            _ => None,
        }
    }
    fn e_chiusura(&self) -> bool {
        matches!(self, Self::Close(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::tungstenite::Message as TMsg;

    /// Un finto socket: legge da una coda, scrive in un'altra.
    struct Finto {
        in_arrivo: std::collections::VecDeque<Result<TMsg, String>>,
        spediti: std::sync::Arc<std::sync::Mutex<Vec<Vec<u8>>>>,
    }

    impl Stream for Finto {
        type Item = Result<TMsg, String>;
        fn poll_next(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            Poll::Ready(self.in_arrivo.pop_front())
        }
    }

    impl Sink<TMsg> for Finto {
        type Error = String;
        fn poll_ready(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), String>> {
            Poll::Ready(Ok(()))
        }
        fn start_send(self: Pin<&mut Self>, m: TMsg) -> Result<(), String> {
            if let TMsg::Binary(b) = m {
                self.spediti.lock().unwrap().push(b);
            }
            Ok(())
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), String>> {
            Poll::Ready(Ok(()))
        }
        fn poll_close(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), String>> {
            Poll::Ready(Ok(()))
        }
    }

    fn filo(msg: Vec<Result<TMsg, String>>) -> (Filo<Finto, TMsg>, std::sync::Arc<std::sync::Mutex<Vec<Vec<u8>>>>) {
        let spediti = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let f = Filo::nuovo(Finto {
            in_arrivo: msg.into_iter().collect(),
            spediti: spediti.clone(),
        });
        (f, spediti)
    }

    #[tokio::test]
    async fn i_confini_dei_messaggi_non_contano() {
        // Tre frame, una lettura sola: chi legge vede byte, non messaggi.
        let (mut f, _) = filo(vec![
            Ok(TMsg::Binary(b"abc".to_vec())),
            Ok(TMsg::Binary(b"de".to_vec())),
            Ok(TMsg::Binary(b"f".to_vec())),
        ]);
        let mut buf = [0u8; 3];
        f.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"abc");
        let mut resto = [0u8; 3];
        f.read_exact(&mut resto).await.unwrap();
        assert_eq!(&resto, b"def");
    }

    #[tokio::test]
    async fn un_frame_grosso_si_legge_a_pezzi() {
        let (mut f, _) = filo(vec![Ok(TMsg::Binary(b"abcdef".to_vec()))]);
        let mut due = [0u8; 2];
        f.read_exact(&mut due).await.unwrap();
        assert_eq!(&due, b"ab");
        let mut quattro = [0u8; 4];
        f.read_exact(&mut quattro).await.unwrap();
        assert_eq!(&quattro, b"cdef");
    }

    #[tokio::test]
    async fn un_ping_non_e_la_fine_del_flusso() {
        // Il difetto che questo test esiste per fermare: trattare un messaggio
        // di servizio come «zero byte letti» vorrebbe dire dire a yamux che il
        // tunnel e' finito, al primo keepalive.
        let (mut f, _) = filo(vec![
            Ok(TMsg::Ping(vec![])),
            Ok(TMsg::Binary(b"ok".to_vec())),
        ]);
        let mut buf = [0u8; 2];
        f.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"ok");
    }

    #[tokio::test]
    async fn la_chiusura_e_fine_del_flusso() {
        let (mut f, _) = filo(vec![Ok(TMsg::Close(None)), Ok(TMsg::Binary(b"x".to_vec()))]);
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).await.unwrap();
        assert!(buf.is_empty(), "dopo la chiusura non si legge piu' niente");
    }

    #[tokio::test]
    async fn scrivere_fa_un_frame_binario() {
        let (mut f, spediti) = filo(vec![]);
        f.write_all(b"ciao").await.unwrap();
        f.flush().await.unwrap();
        assert_eq!(spediti.lock().unwrap().as_slice(), &[b"ciao".to_vec()]);
    }
}
