//! Il lato pannello: chiama fuori, e lascia entrare dentro.
//!
//! Un pannello sta nella rete di un cliente, dietro NAT: nessuno da fuori può
//! aprire una connessione verso di lui. Quindi chiama lui, una volta, e tiene
//! aperta quella chiamata. Tutto quello che l'IDE nel cloud vuole chiedergli
//! passa da lì dentro.
//!
//! **Quello che succede a ogni stream è sorprendentemente poco**: si apre una
//! connessione TCP alla propria porta di gestione e si copiano i byte, nei due
//! versi, finché uno dei due capi chiude. Il pannello non legge l'HTTP che
//! passa, non lo capisce e non deve: è lo stesso HTTP che arriverebbe da un
//! IDE sulla stessa rete, e dall'altra parte c'è lo stesso server che lo
//! servirebbe. Il tunnel non è un partecipante alla conversazione, è il filo.

use std::sync::Arc;
use std::time::Duration;

use tokio_util::compat::FuturesAsyncReadCompatExt as _;

use super::filo::Filo;
use super::multiplex::{avvia, Verso};

/// Quanto si aspetta prima di richiamare, dopo una caduta.
///
/// Cresce fino al tetto e riparte da capo appena una connessione regge. Un
/// pannello che richiama ogni secondo contro un gateway spento e' un pannello
/// che consuma la linea del cliente per niente; uno che aspetta dieci minuti
/// e' un pannello che resta irraggiungibile dopo un riavvio del gateway.
const ATTESA_MINIMA: Duration = Duration::from_secs(2);
const ATTESA_MASSIMA: Duration = Duration::from_secs(60);

/// Ogni quanto si manda un ping dentro il tunnel.
///
/// Serve contro i NAT: una connessione su cui non passa niente viene
/// dimenticata dalle tabelle di traduzione, e la si scopre solo quando si
/// prova a usarla — cioe' nel momento peggiore. Trenta secondi stanno sotto
/// al timeout di qualunque NAT domestico o aziendale ragionevole.
const PASSO_DEL_PING: Duration = Duration::from_secs(30);

/// Avvia il tunnel e lo tiene vivo per sempre, riconnettendosi da sé.
///
/// `url` e' l'indirizzo del gateway (`wss://tunnel.soligo.net/tunnel/v1`),
/// `segno` il nome con cui questo pannello si presenta, `token` quello che lo
/// autorizza, e `porta_gestione` la propria porta su cui girare gli stream.
/// `tls` dice se quella porta parla TLS (vedi [`gira_alla_porta`]).
pub fn tieni_aperto(url: String, segno: String, token: String, porta_gestione: u16, tls: bool) {
    tokio::spawn(async move {
        let mut attesa = ATTESA_MINIMA;
        loop {
            let intestazioni = vec![
                ("authorization", format!("Bearer {token}")),
                ("x-sws-pannello", segno.clone()),
            ];
            match un_giro(&url, &intestazioni, porta_gestione, tls, None).await {
                Ok(()) => {
                    tracing::info!(%url, "tunnel chiuso dall'altro capo, richiamo");
                    attesa = ATTESA_MINIMA;
                }
                Err(e) => {
                    tracing::warn!(%url, "tunnel non aperto: {e} — riprovo fra {}s", attesa.as_secs());
                }
            }
            tokio::time::sleep(attesa).await;
            attesa = (attesa * 2).min(ATTESA_MASSIMA);
        }
    });
}

/// Il tunnel di un pannello **che non è dichiarato a mano** (11-10-2026,
/// fetta D dell'abbinamento): l'indirizzo del gateway sta nell'immagine
/// (decisione 13), nome e token li dà il gateway all'abbinamento.
///
/// - abbinato al cloud: si presenta col nome e il token salvati;
/// - non ancora: si presenta **in attesa**, col codice di abbinamento,
///   l'identità hardware e il nome proposto (l'hostname). Il gateway lo tiene
///   da parte finché qualcuno non inserisce quel codice nell'IDE.
///
/// Quando il codice si consuma o arrivano le credenziali, il giro in corso si
/// chiude e se ne apre uno nuovo con quello che vale adesso.
pub fn tieni_aperto_abbinabile(
    url: String,
    abbinamento: Arc<crate::abbinamento::Abbinamento>,
    nome_proposto: String,
    porta_gestione: u16,
    tls: bool,
) {
    tokio::spawn(async move {
        let mut attesa = ATTESA_MINIMA;
        loop {
            let intestazioni = match abbinamento.tunnel() {
                Some((nome, token)) => vec![
                    ("authorization", format!("Bearer {token}")),
                    ("x-sws-pannello", nome),
                ],
                None => match (abbinamento.codice(), abbinamento.hw()) {
                    (Some(codice), Some(hw)) => vec![
                        ("x-sws-attesa", codice),
                        ("x-sws-hw", hw),
                        ("x-sws-nome", nome_proposto.clone()),
                    ],
                    _ => {
                        tracing::warn!("tunnel: nessun codice di abbinamento, non mi collego");
                        return;
                    }
                },
            };
            match un_giro(&url, &intestazioni, porta_gestione, tls, Some(abbinamento.cambiato())).await {
                Ok(()) => attesa = ATTESA_MINIMA,
                Err(e) => {
                    tracing::warn!(%url, "tunnel non aperto: {e} — riprovo fra {}s", attesa.as_secs());
                    tokio::time::sleep(attesa).await;
                    attesa = (attesa * 2).min(ATTESA_MASSIMA);
                    continue;
                }
            }
            tokio::time::sleep(ATTESA_MINIMA).await;
        }
    });
}

async fn un_giro(
    url: &str,
    intestazioni: &[(&'static str, String)],
    porta: u16,
    tls: bool,
    // Suona quando quello che il pannello presenta è cambiato: si chiude il
    // giro e se ne apre uno nuovo.
    interrompi: Option<Arc<tokio::sync::Notify>>,
) -> anyhow::Result<()> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let mut richiesta = url.into_client_request()?;
    for (n, v) in intestazioni {
        richiesta.headers_mut().insert(*n, v.parse()?);
    }

    let (socket, _) = tokio_tungstenite::connect_async(richiesta).await?;
    let segno = intestazioni
        .iter()
        .find(|(n, _)| *n == "x-sws-pannello")
        .map(|(_, v)| v.as_str())
        .unwrap_or("(in attesa di abbinamento)");
    tracing::info!(%url, pannello = %segno, "tunnel aperto");

    let filo = Filo::nuovo(socket);
    // `Risponde`: le richieste le apre il gateway, perché è lui che ha
    // qualcosa da consegnare. La maniglia serve solo al battito qui sotto.
    let (maniglia, mut in_arrivo) = avvia(filo, Verso::Risponde);

    let fermo = Arc::new(tokio::sync::Notify::new());
    let ping = {
        let fermo = fermo.clone();
        let maniglia = maniglia.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(PASSO_DEL_PING) => {}
                    _ = fermo.notified() => return,
                }
                // **Un battito che batte davvero.**
                //
                // La prima stesura (09-10-2026) dormiva e basta: il corpo era
                // vuoto, e il commento sopra spiegava diligentemente perché
                // servisse un keepalive che non c'era. Misurato sul WP630 il
                // 16-10: il tunnel si riapriva **ogni quindici minuti esatti**
                // — un timeout da 900 secondi lungo la strada, che senza
                // traffico scade.
                //
                // Si apre uno stream, ci si scrive **un byte** e lo si chiude.
                // Non c'è un ping di WebSocket a disposizione: il socket l'ha
                // preso `Filo` e `yamux` ci sta sopra, e `yamux` 0.14 un
                // keepalive suo non ce l'ha. Uno stream invece attraversa
                // tutti gli strati che il timeout guarda — TCP, TLS,
                // WebSocket.
                //
                // **Il byte non è un dettaglio.** La prima stesura apriva lo
                // stream e lo lasciava cadere: il test
                // `il_battito_arriva_dall_altra_parte` l'ha bocciata, perché
                // uno stream aperto e chiuso subito non arriva dall'altra
                // parte — yamux non manda niente finché non c'è qualcosa da
                // mandare. Sarebbe stato un keepalive che non tiene in vita
                // niente, per la seconda volta di fila.
                //
                // Dall'altra parte il gateway lascia cadere gli stream in
                // arrivo (non ne aspetta nessuno), quindi si chiude da sé.
                match maniglia.apri().await {
                    Ok(mut s) => {
                        use futures_util::io::AsyncWriteExt as _;
                        let _ = s.write_all(b"\0").await;
                        let _ = s.close().await;
                    }
                    Err(e) => {
                        // Il tunnel è caduto: non si insiste, ci pensa il giro
                        // di riconnessione.
                        tracing::debug!("battito del tunnel: {e}");
                        return;
                    }
                }
            }
        })
    };

    let interrompi = interrompi.unwrap_or_default();
    loop {
        tokio::select! {
            arrivato = in_arrivo.recv() => {
                let Some(stream) = arrivato else { break };
                tokio::spawn(async move {
                    if let Err(e) = gira_alla_porta(stream, porta, tls).await {
                        tracing::debug!("stream del tunnel finito: {e}");
                    }
                });
            }
            _ = interrompi.notified() => {
                // Il segnale arriva mentre si serve proprio la richiesta che
                // l'ha causato (la rivendica arrivata dal gateway): si lascia
                // il tempo alla risposta di uscire prima di chiudere.
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                tracing::info!("tunnel: credenziali o codice cambiati, mi ricollego");
                break;
            }
        }
    }
    fermo.notify_waiters();
    let _ = ping.await;
    Ok(())
}

/// Copia i byte fra uno stream del tunnel e la porta di gestione locale.
///
/// **Con `tls` la porta locale si raggiunge in TLS** (24-10-2026). Dalla 2.20.0 (C4)
/// un pannello accende il TLS di default, anche sulla porta di gestione, e il
/// tunnel ci copiava l'HTTP del gateway in chiaro: il runtime rifiutava
/// l'handshake, il gateway riceveva spazzatura e rispondeva 502 — ogni pannello
/// abbinato perdeva l'accesso dal cloud, aggiornamento remoto compreso.
pub(crate) async fn gira_alla_porta(stream: yamux::Stream, porta: u16, tls: bool) -> std::io::Result<()> {
    let tcp = tokio::net::TcpStream::connect(("127.0.0.1", porta)).await?;
    // Lo stream di yamux parla i tratti di `futures`, la socket TCP quelli di
    // tokio: si traduce il primo invece del secondo, perché `copy_bidirectional`
    // sta in tokio e la socket è già nella forma che vuole.
    let mut stream = stream.compat();
    if tls {
        let nome = rustls::pki_types::ServerName::IpAddress(std::net::Ipv4Addr::LOCALHOST.into());
        let mut locale = tokio_rustls::TlsConnector::from(config_loopback()).connect(nome, tcp).await?;
        tokio::io::copy_bidirectional(&mut stream, &mut locale).await.map(|_| ())
    } else {
        let mut locale = tcp;
        tokio::io::copy_bidirectional(&mut stream, &mut locale).await.map(|_| ())
    }
}

/// Il client TLS verso **sé stessi** su loopback: il certificato è quello che il
/// processo stesso serve (autofirmato, del dispositivo o caricato a mano), quindi
/// non c'è un'identità da verificare — chi risponde su `127.0.0.1:<porta di
/// gestione>` è questo runtime. Le firme dell'handshake restano verificate.
fn config_loopback() -> Arc<rustls::ClientConfig> {
    static CFG: std::sync::OnceLock<Arc<rustls::ClientConfig>> = std::sync::OnceLock::new();
    CFG.get_or_init(|| {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let cfg = rustls::ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .expect("versioni TLS di default")
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(SeStesso { provider }))
            .with_no_client_auth();
        Arc::new(cfg)
    })
    .clone()
}

#[derive(Debug)]
struct SeStesso {
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl rustls::client::danger::ServerCertVerifier for SeStesso {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}
