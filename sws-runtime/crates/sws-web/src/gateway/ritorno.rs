//! La chiave di ritorno: come un container di progetto si fa riconoscere dal
//! gateway quando lo chiama (10-10-2026).
//!
//! Il container IDE di un progetto parla col pannello passando dal gateway
//! (`https://sws.soligo.net/dev/<pannello>/…`), ma quella chiamata parte dal
//! **server**, non dal browser: non porta nessuna sessione, e `/dev/` sta dietro
//! `require_auth`. Al primo collaudo col TC620 «Connetti» dava 401.
//!
//! Scelta del maintainer: **una chiave per container**, che vale come «questa
//! azienda» e non come un utente. Non si memorizza: è
//! `HMAC-SHA256(segreto del gateway, "<azienda>/<progetto>")`, quindi il gateway
//! la ricalcola quando serve (anche per un container riadottato dopo un suo
//! riavvio) e un container non può ricavare quella di un altro, perché non
//! conosce il segreto.
//!
//! Il container la riceve all'avvio in `SWS_CHIAVE_RITORNO`, già nella forma
//! che rimanda: `<azienda>/<progetto>:<hmac esadecimale>`, nell'intestazione
//! `X-SWS-Figlio` — **mai** `Authorization`, che attraverso il tunnel arriva al
//! pannello e serve ai suoi utenti.

use sha2::{Digest, Sha256};

/// L'intestazione con cui il container si presenta al gateway.
pub const INTESTAZIONE: &str = "x-sws-figlio";

/// HMAC-SHA256 (RFC 2104), esadecimale.
fn hmac_sha256_hex(chiave: &[u8], messaggio: &[u8]) -> String {
    const BLOCCO: usize = 64;
    let mut k = [0u8; BLOCCO];
    if chiave.len() > BLOCCO {
        k[..32].copy_from_slice(&Sha256::digest(chiave));
    } else {
        k[..chiave.len()].copy_from_slice(chiave);
    }
    let mut ipad = [0x36u8; BLOCCO];
    let mut opad = [0x5cu8; BLOCCO];
    for i in 0..BLOCCO {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let interno = Sha256::new().chain_update(ipad).chain_update(messaggio).finalize();
    let esterno = Sha256::new().chain_update(opad).chain_update(interno).finalize();
    esterno.iter().map(|b| format!("{b:02x}")).collect()
}

/// La chiave del container del progetto `riferimento` (`<azienda>/<nome>`),
/// nella forma che il container rimanda.
pub fn chiave_per(segreto: &str, riferimento: &str) -> String {
    format!("{riferimento}:{}", hmac_sha256_hex(segreto.as_bytes(), riferimento.as_bytes()))
}

/// Il container che ha mandato `valore`, se la chiave è giusta: l'azienda e il
/// riferimento. `None` per qualunque cosa non torni.
pub fn verifica(segreto: &str, valore: &str) -> Option<Chiamante> {
    let (riferimento, firma) = valore.trim().rsplit_once(':')?;
    let (azienda, nome) = riferimento.split_once('/')?;
    if azienda.is_empty() || nome.is_empty() || segreto.is_empty() {
        return None;
    }
    let attesa = hmac_sha256_hex(segreto.as_bytes(), riferimento.as_bytes());
    if !crate::router::confronto_costante(firma.as_bytes(), attesa.as_bytes()) {
        return None;
    }
    Some(Chiamante { azienda: azienda.to_string(), riferimento: riferimento.to_string() })
}

/// Un container di progetto che chiama il gateway, riconosciuto dalla chiave.
#[derive(Debug, Clone, PartialEq)]
pub struct Chiamante {
    pub azienda: String,
    pub riferimento: String,
}

/// L'origine pubblica (`https://sws.soligo.net`) di una richiesta arrivata al
/// gateway: il container manderà la chiave **solo** lì, mai verso un altro
/// indirizzo scritto nel campo «Connetti».
pub fn origine_della_richiesta(h: &axum::http::HeaderMap) -> Option<String> {
    // `Host` prima: dietro Traefik deve combaciare con la regola del router
    // (`sws.soligo.net`), mentre `X-Forwarded-Host` un client può provare a
    // scriverlo lui. Il secondo serve solo dove `Host` manca.
    let host = h.get("host").or_else(|| h.get("x-forwarded-host"))?.to_str().ok()?.trim();
    if host.is_empty() || host.contains(['/', ' ']) {
        return None;
    }
    let proto = h
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|p| *p == "http" || *p == "https")
        .unwrap_or("https");
    Some(format!("{proto}://{host}"))
}

/// La chiave va aggiunta a una chiamata verso `url`? Solo verso il gateway da
/// cui arriva il lavoro, e solo sui pannelli (`/dev/…`) o sul loro elenco.
pub fn va_aggiunta(url: &str, origine: &str) -> bool {
    url.strip_prefix(origine)
        .is_some_and(|resto| resto.starts_with("/dev/") || resto == "/api/pannelli")
}

/// Il lato del container: la sua chiave (dall'ambiente) e l'origine pubblica
/// del gateway, imparata dalle richieste che il gateway gli inoltra.
#[derive(Default)]
pub struct Ritorno {
    chiave: Option<String>,
    origine: std::sync::RwLock<Option<String>>,
}

impl Ritorno {
    /// `SWS_CHIAVE_RITORNO`, letta solo dietro il gateway (`--auth-delegata`).
    pub fn dall_ambiente(dietro_al_gateway: bool) -> Self {
        let chiave = dietro_al_gateway
            .then(|| std::env::var("SWS_CHIAVE_RITORNO").ok())
            .flatten()
            .filter(|c| !c.trim().is_empty());
        Ritorno { chiave, origine: Default::default() }
    }

    pub fn ricorda_origine(&self, origine: &str) {
        let origine = origine.trim().trim_end_matches('/');
        if origine.is_empty() || self.chiave.is_none() {
            return;
        }
        let mut o = self.origine.write().unwrap_or_else(|e| e.into_inner());
        if o.as_deref() != Some(origine) {
            *o = Some(origine.to_string());
        }
    }

    /// L'origine del gateway, se questo container ha una chiave e l'ha già
    /// imparata: vuol dire «l'IDE gira nel cloud, dietro il gateway».
    pub fn origine_se_dietro_al_gateway(&self) -> Option<String> {
        self.chiave.as_ref()?;
        self.origine.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// La chiave da mandare con una chiamata verso `url`, se ci va.
    pub fn per(&self, url: &str) -> Option<String> {
        let chiave = self.chiave.as_ref()?;
        let o = self.origine.read().unwrap_or_else(|e| e.into_inner());
        va_aggiunta(url, o.as_deref()?).then(|| chiave.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_come_la_rfc_4231() {
        // RFC 4231, caso 2.
        assert_eq!(
            hmac_sha256_hex(b"Jefe", b"what do ya want for nothing?"),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn la_chiave_vale_per_il_suo_progetto_e_basta() {
        let k = chiave_per("segretodelgateway", "acme/impianto");
        assert!(k.starts_with("acme/impianto:"));
        assert_eq!(
            verifica("segretodelgateway", &k),
            Some(Chiamante { azienda: "acme".into(), riferimento: "acme/impianto".into() })
        );
        // Un altro riferimento con la stessa firma: no.
        let firma = k.rsplit_once(':').unwrap().1;
        assert_eq!(verifica("segretodelgateway", &format!("rossi/impianto:{firma}")), None);
        // Un altro segreto: no. Niente forma: no.
        assert_eq!(verifica("altro", &k), None);
        assert_eq!(verifica("segretodelgateway", "acme/impianto"), None);
        assert_eq!(verifica("", &k), None);
        // La radice si chiama «-».
        let r = chiave_per("s", "-/dimostrazione");
        assert_eq!(verifica("s", &r).unwrap().azienda, "-");
    }

    #[test]
    fn la_chiave_parte_solo_verso_il_gateway_e_sui_pannelli() {
        let o = "https://sws.soligo.net";
        assert!(va_aggiunta("https://sws.soligo.net/dev/tc620-casa/api/projects", o));
        assert!(!va_aggiunta("https://sws.soligo.net/p/acme/x/api", o));
        assert!(va_aggiunta("https://sws.soligo.net/api/pannelli", o));
        assert!(!va_aggiunta("https://sws.soligo.net/api/pannelli/x", o));
        assert!(!va_aggiunta("https://sws.soligo.net.evil.com/dev/x", o));
        assert!(!va_aggiunta("https://192.168.1.10:8444/dev/x", o));
    }

    #[test]
    fn il_container_manda_la_chiave_solo_all_origine_imparata() {
        let r = Ritorno { chiave: Some("acme/x:ab".into()), origine: Default::default() };
        assert_eq!(r.per("https://sws.soligo.net/dev/p/api/projects"), None, "origine non ancora nota");
        r.ricorda_origine("https://sws.soligo.net/");
        assert_eq!(r.per("https://sws.soligo.net/dev/p/api/projects").as_deref(), Some("acme/x:ab"));
        assert_eq!(r.per("https://192.168.1.10:8444/api/projects"), None);
        let senza = Ritorno::default();
        senza.ricorda_origine("https://sws.soligo.net");
        assert_eq!(senza.per("https://sws.soligo.net/dev/p/x"), None);
    }

    #[test]
    fn origine_dalle_intestazioni() {
        let mut h = axum::http::HeaderMap::new();
        h.insert("host", "sws.soligo.net".parse().unwrap());
        assert_eq!(origine_della_richiesta(&h).as_deref(), Some("https://sws.soligo.net"));
        h.insert("x-forwarded-host", "evil.com".parse().unwrap());
        assert_eq!(origine_della_richiesta(&h).as_deref(), Some("https://sws.soligo.net"), "Host vince");
        h.insert("x-forwarded-proto", "http".parse().unwrap());
        h.insert("host", "localhost:8460".parse().unwrap());
        assert_eq!(origine_della_richiesta(&h).as_deref(), Some("http://localhost:8460"));
        h.insert("host", "a/b".parse().unwrap());
        assert_eq!(origine_della_richiesta(&h), None);
    }
}
