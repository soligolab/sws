//! HTTP su uno stream già aperto, websocket compresi.
//!
//! Lo usa il gateway dentro il tunnel di un pannello (`gateway::attraverso`) e,
//! dal 29-10-2026, il pannello verso la propria pagina operatore
//! (`crate::schermo::dal_gateway`): la stessa richiesta, girata a un altro
//! capo. Era il corpo di `attraverso`; sta qui perché i chiamanti sono due.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::Response;
use http_body_util::BodyExt as _;

/// Manda `req` su `io` come `percorso` + `query`, e torna la risposta. Un 101
/// (websocket) cuce le due socket e le lascia girare da sole.
pub(crate) async fn http_su<T>(io: T, percorso: &str, query: &str, req: Request<Body>) -> anyhow::Result<Response>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let io = hyper_util::rt::TokioIo::new(io);
    let (mut mittente, connessione) = hyper::client::conn::http1::handshake(io).await?;
    // La connessione va fatta girare, o `send_request` resta appesa. Muore da
    // sé quando `mittente` cade, cioè alla fine di questa funzione.
    // `with_upgrades`: dopo un 101 la socket passa a chi l'ha chiesta invece
    // di chiudersi (websocket, vedi sotto).
    tokio::spawn(async move {
        let _ = connessione.with_upgrades().await;
    });

    let (mut parti, corpo) = req.into_parts();
    // **I websocket nel tunnel (10-10-2026).** Senza questo, il pannello
    // rispondeva 101 e il 101 arrivava a chi chiamava, ma i due lati non
    // venivano mai collegati: i tag dal vivo dell'IDE nel cloud
    // (`/ws/remote/tags` → `/dev/<pannello>/ws/tags`) restavano fermi senza un
    // errore da nessuna parte. Si tiene la metà «client» dell'upgrade, e se il
    // pannello accetta si cuciono le due socket.
    let upgrade_dal_client = parti
        .headers
        .contains_key(hyper::header::UPGRADE)
        .then(|| parti.extensions.remove::<hyper::upgrade::OnUpgrade>())
        .flatten();
    let mut dentro = hyper::Request::builder()
        .method(parti.method)
        // `Host` non significa niente qui dentro — dall'altra parte c'è una
        // socket sola — ma HTTP/1.1 lo pretende.
        .uri(format!("http://pannello{percorso}{query}"))
        .header(hyper::header::HOST, "pannello");
    for (nome, valore) in parti.headers.iter() {
        let n = nome.as_str();
        if n.eq_ignore_ascii_case("host") || n.eq_ignore_ascii_case("content-length") {
            continue;
        }
        dentro = dentro.header(nome.clone(), valore.clone());
    }
    let dentro = dentro.body(corpo)?;

    let mut risposta = mittente.send_request(dentro).await?;
    if risposta.status() == StatusCode::SWITCHING_PROTOCOLS {
        if let Some(lato_client) = upgrade_dal_client {
            let lato_pannello = hyper::upgrade::on(&mut risposta);
            tokio::spawn(async move {
                match tokio::try_join!(lato_client, lato_pannello) {
                    Ok((c, p)) => {
                        let mut c = hyper_util::rt::TokioIo::new(c);
                        let mut p = hyper_util::rt::TokioIo::new(p);
                        let _ = tokio::io::copy_bidirectional(&mut c, &mut p).await;
                    }
                    Err(e) => tracing::warn!("websocket nel tunnel non cucito: {e}"),
                }
                drop(mittente);
            });
        }
    }
    let (parti, corpo) = risposta.into_parts();
    let mut fuori = Response::builder().status(parti.status);
    for (nome, valore) in parti.headers.iter() {
        if nome.as_str().eq_ignore_ascii_case("content-length") {
            continue;
        }
        fuori = fuori.header(nome.clone(), valore.clone());
    }
    Ok(fuori.body(Body::new(corpo.map_err(axum::Error::new)))?)
}
