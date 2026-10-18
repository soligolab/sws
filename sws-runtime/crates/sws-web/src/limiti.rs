//! Limiti alle richieste per indirizzo (C6 dell'onda 2, seconda metà, 17-10-2026;
//! piano `docs/archive/2026-10-17-onda-2-prestazioni-e-protezioni.md`).
//!
//! Un secchio di gettoni per indirizzo IP, in memoria, due secchi distinti: le
//! **letture** (`GET`/`HEAD`) e le **scritture** (tutto il resto). Oltre il tetto
//! la risposta è `429` con `Retry-After` e un messaggio leggibile.
//!
//! **Cosa si conta**: solo le API (un percorso che contiene `/api/`, anche dietro
//! `/dev/<pannello>/…`). Restano fuori i file della SPA, i WebSocket (una
//! connessione sola, che il batcher già limita), `/health`.
//!
//! **Chi non si conta**:
//! - il **loopback**: sul pannello sono il kiosk, il viewer LVGL e il tunnel SSH
//!   dell'IDE, processi della macchina stessa;
//! - un **container di progetto** dietro il gateway (`segreto_gateway`): tutto il
//!   suo traffico arriva dal gateway, che l'ha già contato;
//! - sul gateway, le chiamate dei container figli con la chiave di ritorno giusta.
//!
//! **L'indirizzo** è quello della connessione. Solo sul gateway, che nel cloud sta
//! dietro Traefik su una rete privata, vale l'**ultimo** elemento di
//! `X-Forwarded-For` (quello che il proxy ha aggiunto lui, non quelli arrivati da
//! fuori), e solo se la connessione viene da un indirizzo privato. Su un pannello
//! un `X-Forwarded-For` non si guarda mai: chiunque in rete lo potrebbe scrivere
//! per cambiare secchio a ogni richiesta.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};

use crate::router::AppState;

/// Un tetto: quanti gettoni al massimo (la raffica) e quanti ne tornano al secondo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tetto {
    pub capienza: f64,
    pub al_secondo: f64,
}

/// I valori, dalle misure del 17-10-2026 (`docs/manual/16_prestazioni.md`), per
/// un client solo, con un margine ×3:
/// - **letture**: aprire l'IDE sul progetto `demo-items-web` e girare tre pagine
///   fa 151 richieste alle API in pochi secondi, con un picco di 23 al secondo;
///   il viewer 32 (picco 17/s). Raffica 3 × 151 ≈ 500, ritorno 3 × 23 ≈ 75/s.
/// - **scritture**: il banco ne fa una al secondo per client, e anche un cursore
///   trascinato scrive una volta sola, al rilascio (F3.6, misurato: 0 scritture in
///   3 s di trascinamento). Restano i clic di una persona, che stanno sotto le 10
///   al secondo, o i comandi a pressione (pressione e rilascio). Raffica 100, ritorno 25/s:
///   più del triplo, perché un 429 su un comando è peggio di un 429 su una lettura.
///
/// Più client dietro lo stesso indirizzo (un ufficio dietro un NAT, verso il
/// cloud) dividono lo stesso secchio: per quel caso `SWS_LIMITE_LETTURE` e
/// `SWS_LIMITE_SCRITTURE` (`<raffica>/<al secondo>`, `0` per spegnere).
pub const LETTURE: Tetto = Tetto { capienza: 500.0, al_secondo: 75.0 };
pub const SCRITTURE: Tetto = Tetto { capienza: 100.0, al_secondo: 25.0 };

#[derive(Debug, Clone, Copy)]
struct Secchio {
    gettoni: f64,
    ultimo: Instant,
}

impl Secchio {
    fn pieno(t: &Tetto, ora: Instant) -> Self {
        Secchio { gettoni: t.capienza, ultimo: ora }
    }

    /// Prende un gettone. `Err` con l'attesa fino al prossimo se non ce n'è.
    fn prendi(&mut self, t: &Tetto, ora: Instant) -> Result<(), Duration> {
        let passati = ora.saturating_duration_since(self.ultimo).as_secs_f64();
        self.gettoni = (self.gettoni + passati * t.al_secondo).min(t.capienza);
        self.ultimo = ora;
        if self.gettoni >= 1.0 {
            self.gettoni -= 1.0;
            Ok(())
        } else {
            Err(Duration::from_secs_f64((1.0 - self.gettoni) / t.al_secondo))
        }
    }

    /// Tornato pieno: si può dimenticare senza cambiare niente.
    fn e_tornato_pieno(&self, t: &Tetto, ora: Instant) -> bool {
        self.gettoni + ora.saturating_duration_since(self.ultimo).as_secs_f64() * t.al_secondo >= t.capienza
    }
}

/// Oltre questo numero di indirizzi si dimenticano quelli tornati pieni: la
/// memoria non cresce con chi passa una volta sola.
const DA_PULIRE: usize = 10_000;

pub struct Limiti {
    letture: Option<Tetto>,
    scritture: Option<Tetto>,
    secchi: Mutex<HashMap<(IpAddr, bool), Secchio>>,
    rifiuti: AtomicU64,
}

impl Limiti {
    pub fn nuovi(letture: Option<Tetto>, scritture: Option<Tetto>) -> Self {
        Limiti { letture, scritture, secchi: Mutex::new(HashMap::new()), rifiuti: AtomicU64::new(0) }
    }

    /// I tetti predefiniti, salvo `SWS_LIMITE_LETTURE`/`SWS_LIMITE_SCRITTURE`.
    pub fn dall_ambiente() -> Self {
        let leggi = |nome: &str, base: Tetto| match std::env::var(nome) {
            Ok(v) => match tetto_da_testo(&v) {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("{nome}={v:?} non valido ({e}): uso {}/{}", base.capienza, base.al_secondo);
                    Some(base)
                }
            },
            Err(_) => Some(base),
        };
        Self::nuovi(leggi("SWS_LIMITE_LETTURE", LETTURE), leggi("SWS_LIMITE_SCRITTURE", SCRITTURE))
    }

    /// `Err(attesa)` se `ip` ha finito i gettoni del suo secchio.
    pub fn prendi(&self, ip: IpAddr, scrittura: bool, ora: Instant) -> Result<(), Duration> {
        let Some(t) = (if scrittura { self.scritture } else { self.letture }) else {
            return Ok(());
        };
        let Ok(mut secchi) = self.secchi.lock() else { return Ok(()) };
        if secchi.len() >= DA_PULIRE {
            let (l, s) = (self.letture, self.scritture);
            secchi.retain(|(_, scr), b| {
                let t = if *scr { s } else { l };
                t.is_some_and(|t| !b.e_tornato_pieno(&t, ora))
            });
        }
        secchi.entry((ip, scrittura)).or_insert_with(|| Secchio::pieno(&t, ora)).prendi(&t, ora)
    }
}

/// `"500/75"` → raffica 500, 75 al secondo; `"0"` → nessun limite.
pub fn tetto_da_testo(v: &str) -> Result<Option<Tetto>, String> {
    let v = v.trim();
    if v == "0" {
        return Ok(None);
    }
    let (c, r) = v.split_once('/').ok_or("atteso <raffica>/<al secondo>, o 0")?;
    let capienza: f64 = c.trim().parse().map_err(|_| "raffica non numerica")?;
    let al_secondo: f64 = r.trim().parse().map_err(|_| "ritorno non numerico")?;
    if !(capienza >= 1.0 && al_secondo > 0.0 && capienza.is_finite() && al_secondo.is_finite()) {
        return Err("servono raffica ≥ 1 e ritorno > 0".into());
    }
    Ok(Some(Tetto { capienza, al_secondo }))
}

fn privato(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local(),
        IpAddr::V6(v) => v.is_loopback() || (v.segments()[0] & 0xfe00) == 0xfc00,
    }
}

/// L'indirizzo da contare, o `None` se la richiesta non si conta (loopback).
/// `dietro_proxy`: solo sul gateway, vedi l'intestazione del modulo.
pub fn indirizzo(peer: Option<SocketAddr>, h: &HeaderMap, dietro_proxy: bool) -> Option<IpAddr> {
    let peer = peer?.ip();
    let ip = if dietro_proxy && privato(peer) {
        h.get_all("x-forwarded-for")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(','))
            .last()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(peer)
    } else {
        peer
    };
    (!ip.is_loopback()).then_some(ip)
}

/// Le richieste che si contano: le API, non i WebSocket.
pub fn si_conta(req: &Request) -> bool {
    req.uri().path().contains("/api/")
        && !req
            .headers()
            .get(header::UPGRADE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
}

pub async fn limita(State(s): State<AppState>, req: Request, next: Next) -> Response {
    if s.segreto_gateway.is_some() || !si_conta(&req) {
        return next.run(req).await;
    }
    if let Some(regia) = s.regia.as_ref() {
        let figlio = req
            .headers()
            .get(crate::gateway::ritorno::INTESTAZIONE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| crate::gateway::ritorno::verifica(regia.segreto(), v));
        if figlio.is_some() {
            return next.run(req).await;
        }
    }
    let peer = req.extensions().get::<SocketAddr>().copied();
    let Some(ip) = indirizzo(peer, req.headers(), s.regia.is_some()) else {
        return next.run(req).await;
    };
    let scrittura = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    match s.limiti.prendi(ip, scrittura, Instant::now()) {
        Ok(()) => next.run(req).await,
        Err(attesa) => {
            let n = s.limiti.rifiuti.fetch_add(1, Ordering::Relaxed) + 1;
            // A campione: il primo, poi uno ogni cento. Una raffica non riempie il log.
            if n % 100 == 1 {
                tracing::warn!(%ip, scrittura, rifiuti = n, path = %req.uri().path(), "troppe richieste: 429");
            }
            let secondi = attesa.as_secs_f64().ceil().max(1.0) as u64;
            let mut r = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(serde_json::json!({
                    "error": "troppe_richieste",
                    "detail": format!("troppe richieste da questo indirizzo: riprova fra {secondi} s"),
                })),
            )
                .into_response();
            if let Ok(v) = HeaderValue::from_str(&secondi.to_string()) {
                r.headers_mut().insert(header::RETRY_AFTER, v);
            }
            r
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: Tetto = Tetto { capienza: 3.0, al_secondo: 2.0 };

    #[test]
    fn il_secchio_lascia_la_raffica_e_poi_il_ritorno() {
        let l = Limiti::nuovi(Some(T), Some(T));
        let ip: IpAddr = "192.168.1.50".parse().unwrap();
        let t0 = Instant::now();
        for _ in 0..3 {
            assert!(l.prendi(ip, false, t0).is_ok());
        }
        let attesa = l.prendi(ip, false, t0).unwrap_err();
        assert!((attesa.as_secs_f64() - 0.5).abs() < 1e-6, "{attesa:?}");
        // Le scritture hanno il loro secchio, un altro indirizzo anche.
        assert!(l.prendi(ip, true, t0).is_ok());
        assert!(l.prendi("192.168.1.51".parse().unwrap(), false, t0).is_ok());
        // Mezzo secondo dopo torna un gettone, uno solo.
        let t1 = t0 + Duration::from_millis(500);
        assert!(l.prendi(ip, false, t1).is_ok());
        assert!(l.prendi(ip, false, t1).is_err());
    }

    #[test]
    fn senza_tetto_non_si_limita() {
        let l = Limiti::nuovi(None, Some(T));
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let t0 = Instant::now();
        for _ in 0..1000 {
            assert!(l.prendi(ip, false, t0).is_ok());
        }
    }

    #[test]
    fn i_tetti_da_testo() {
        assert_eq!(tetto_da_testo("500/75").unwrap(), Some(Tetto { capienza: 500.0, al_secondo: 75.0 }));
        assert_eq!(tetto_da_testo(" 0 ").unwrap(), None);
        for no in ["500", "a/1", "0/5", "5/0", "-1/2", "inf/1"] {
            assert!(tetto_da_testo(no).is_err(), "{no}");
        }
    }

    fn intestazioni(xff: &[&str]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for v in xff {
            h.append("x-forwarded-for", HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn l_indirizzo_dietro_il_proxy_e_l_ultimo_aggiunto() {
        let traefik: SocketAddr = "10.89.0.2:5000".parse().unwrap();
        // Il client ha scritto «1.2.3.4» da sé, Traefik ha aggiunto l'indirizzo vero.
        let h = intestazioni(&["1.2.3.4, 203.0.113.9"]);
        assert_eq!(indirizzo(Some(traefik), &h, true), Some("203.0.113.9".parse().unwrap()));
        let h2 = intestazioni(&["1.2.3.4", "203.0.113.9"]);
        assert_eq!(indirizzo(Some(traefik), &h2, true), Some("203.0.113.9".parse().unwrap()));
    }

    #[test]
    fn sul_pannello_x_forwarded_for_non_conta() {
        let vicino: SocketAddr = "192.168.1.77:40000".parse().unwrap();
        let h = intestazioni(&["8.8.8.8"]);
        assert_eq!(indirizzo(Some(vicino), &h, false), Some("192.168.1.77".parse().unwrap()));
        // Né sul gateway, se la connessione non viene da un proxy privato.
        let fuori: SocketAddr = "198.51.100.4:1234".parse().unwrap();
        assert_eq!(indirizzo(Some(fuori), &h, true), Some("198.51.100.4".parse().unwrap()));
    }

    #[test]
    fn il_loopback_non_si_conta() {
        let locale: SocketAddr = "127.0.0.1:5555".parse().unwrap();
        assert_eq!(indirizzo(Some(locale), &HeaderMap::new(), false), None);
        assert_eq!(indirizzo(None, &HeaderMap::new(), false), None);
    }
}
