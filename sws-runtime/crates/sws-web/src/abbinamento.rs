//! Il codice di abbinamento, che è anche il primo accesso del pannello
//! (11-10-2026, piano `docs/archive/2026-10-11-abbinamento-e-primo-accesso.md`).
//!
//! Un pannello appena installato non ha nessun utente. Fino a ieri questo
//! voleva dire «aperto a tutti, da Admin» — l'Admin sintetico. Ora vuol dire
//! **in attesa**: non entra nessuno, nemmeno in lettura, e il pannello mostra
//! un codice (`7KQ2-M9XD-3HWP-T4BZ`) su log, installer, pagina locale e
//! schermo. Chi lo inserisce fissa la prima credenziale, l'**Admin del
//! dispositivo**, che vive in `<config>/utenti_dispositivo.yaml`, fuori dal
//! progetto: un deploy non se lo porta via.
//!
//! Il codice:
//! - 16 caratteri in 4 gruppi, alfabeto Crockford base32 maiuscolo (niente
//!   `I L O U`): 80 bit, non si indovina, e non si confonde letto da uno
//!   schermo. In ingresso si perdonano minuscole, spazi, trattini e le lettere
//!   che si scambiano per cifre;
//! - casuale, generato al primo avvio e salvato in `<config>/abbinamento.json`:
//!   resta uguale fra reinstallazioni del container e aggiornamenti, ne nasce
//!   uno nuovo dopo un factory reset;
//! - **monouso**: usato, se ne genera subito un altro, che si mostra solo se il
//!   pannello torna senza utenti.
//!
//! Vederlo è il «possesso fisico» che certifica (decisione 14): chi sta davanti
//! allo schermo o raggiunge la pagina locale può abbinare il pannello.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// L'intestazione con cui il gateway firma le richieste che inoltra nel tunnel
/// di un pannello abbinato (fetta E, 11-10-2026).
pub const INTESTAZIONE_GATEWAY: &str = "x-sws-dal-gateway";

/// La firma del gateway: `HMAC(token del pannello, "dal-gateway")`. Il token lo
/// conoscono solo il gateway (che lo ricalcola dal suo segreto) e il pannello;
/// la firma viaggia solo dentro il tunnel, mai in LAN.
pub fn firma_gateway(token: &str) -> String {
    crate::gateway::ritorno::hmac_sha256_hex(token.as_bytes(), b"dal-gateway")
}

/// Crockford base32, maiuscolo.
const ALFABETO: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LUNGHEZZA: usize = 16;

/// Tentativi sbagliati ammessi in una finestra, per tutto il pannello. Il
/// codice ha 80 bit e non si indovina comunque: il limite serve a non far
/// girare un ciclo contro la pagina locale, e a lasciarlo scritto nel log.
const TENTATIVI: u32 = 10;
const FINESTRA: Duration = Duration::from_secs(300);

/// Un codice nuovo, `XXXX-XXXX-XXXX-XXXX`.
pub fn genera_codice() -> anyhow::Result<String> {
    use std::io::Read as _;
    let mut buf = [0u8; LUNGHEZZA];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|e| anyhow::anyhow!("nessuna sorgente casuale per il codice di abbinamento: {e}"))?;
    // 256 è multiplo di 32: il modulo non pende verso nessun simbolo.
    let grezzo: String = buf.iter().map(|b| ALFABETO[(*b % 32) as usize] as char).collect();
    Ok(a_gruppi(&grezzo))
}

fn a_gruppi(grezzo: &str) -> String {
    grezzo
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

/// Il codice come l'ha scritto una persona → la forma canonica, o `None` se
/// non è un codice. Minuscole, spazi e trattini vanno bene; `O` vale `0`,
/// `I` e `L` valgono `1` (Crockford).
pub fn normalizza(scritto: &str) -> Option<String> {
    let mut out = String::with_capacity(LUNGHEZZA);
    for c in scritto.chars() {
        let c = match c.to_ascii_uppercase() {
            ' ' | '-' | '\t' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        if !ALFABETO.contains(&(c as u8)) || !c.is_ascii() {
            return None;
        }
        out.push(c);
    }
    (out.len() == LUNGHEZZA).then(|| a_gruppi(&out))
}

/// Chi è questa scatola, in un modo che un factory reset non cambia.
///
/// Misurato il 10-10-2026 sul TC620: il seriale del device-tree resta, il MAC
/// resta, `machine-id` no. Se nessuno risponde (un PC, una VM) si torna un
/// identificativo casuale salvato accanto al codice, e lo si dice: funziona,
/// ma dopo un reset il gateway non riconoscerà la scatola.
pub fn identita_hardware() -> Option<String> {
    // `/host/devicetree` è il device-tree montato dal quadlet (lo stesso che
    // usa la sorgente Host): dentro il container podman maschera `/sys/firmware`.
    let seriale = std::fs::read("/host/devicetree/serial-number")
        .or_else(|_| std::fs::read("/sys/firmware/devicetree/base/serial-number"))
        .ok()
        .map(|b| String::from_utf8_lossy(&b).trim_matches(char::from(0)).trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(s) = seriale {
        return Some(format!("seriale:{s}"));
    }
    let mut interfacce: Vec<_> = std::fs::read_dir("/sys/class/net")
        .ok()?
        .flatten()
        .filter(|e| e.path().join("device").exists()) // solo le fisiche
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    interfacce.sort();
    for i in interfacce {
        if let Ok(mac) = std::fs::read_to_string(format!("/sys/class/net/{i}/address")) {
            let mac = mac.trim();
            if !mac.is_empty() && mac != "00:00:00:00:00:00" {
                return Some(format!("mac:{mac}"));
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Archivio {
    codice: String,
    /// `seriale:…`, `mac:…` oppure `casuale:<uuid>`.
    hw: String,
    creato_ms: u64,
    /// Nome e token nel tunnel, ricevuti dal gateway quando il pannello è
    /// stato abbinato al cloud (fetta D). Assenti: il pannello si presenta al
    /// gateway in attesa, col codice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tunnel_nome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tunnel_token: Option<String>,
}

/// Lo stato dell'abbinamento di questo pannello.
pub struct Abbinamento {
    percorso: PathBuf,
    archivio: Mutex<Option<Archivio>>,
    sbagliati: Mutex<(u32, Option<Instant>)>,
    /// Suona quando cambia qualcosa che il tunnel presenta al gateway: il
    /// codice (consumato) o le credenziali del tunnel. Il tunnel si ricollega.
    cambiato: std::sync::Arc<tokio::sync::Notify>,
}

impl Abbinamento {
    /// Legge `<config>/abbinamento.json`, o lo crea. `attivo = false` (IDE,
    /// gateway, container di progetto) non tocca il disco: lì l'abbinamento
    /// non esiste.
    pub fn apri(config_dir: &Path, attivo: bool) -> Self {
        let percorso = config_dir.join("abbinamento.json");
        let archivio = if attivo {
            match Self::carica_o_crea(&percorso) {
                Ok(a) => Some(a),
                Err(e) => {
                    tracing::error!(?percorso, "abbinamento: {e}");
                    None
                }
            }
        } else {
            None
        };
        Self {
            percorso,
            archivio: Mutex::new(archivio),
            sbagliati: Mutex::new((0, None)),
            cambiato: Default::default(),
        }
    }

    fn carica_o_crea(percorso: &Path) -> anyhow::Result<Archivio> {
        if let Ok(testo) = std::fs::read_to_string(percorso) {
            if let Ok(a) = serde_json::from_str::<Archivio>(&testo) {
                if normalizza(&a.codice).as_deref() == Some(a.codice.as_str()) {
                    return Ok(a);
                }
            }
            tracing::warn!(?percorso, "abbinamento.json illeggibile: ne creo uno nuovo");
        }
        let hw = match identita_hardware() {
            Some(h) => h,
            // Nessun identificativo dell'hardware: uno casuale, detto come tale.
            None => format!("casuale:{}", genera_codice()?.replace('-', "")),
        };
        let a = Archivio {
            codice: genera_codice()?,
            hw,
            creato_ms: ora_ms(),
            tunnel_nome: None,
            tunnel_token: None,
        };
        Self::scrivi(percorso, &a)?;
        Ok(a)
    }

    fn scrivi(percorso: &Path, a: &Archivio) -> anyhow::Result<()> {
        if let Some(d) = percorso.parent() {
            std::fs::create_dir_all(d)?;
        }
        let tmp = percorso.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(a)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&tmp, percorso)?;
        Ok(())
    }

    /// Il codice attuale, se questo pannello ne ha uno.
    pub fn codice(&self) -> Option<String> {
        self.archivio.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|a| a.codice.clone())
    }

    /// L'identità hardware (`seriale:…`, `mac:…`, `casuale:…`).
    pub fn hw(&self) -> Option<String> {
        self.archivio.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|a| a.hw.clone())
    }

    /// Nome e token nel tunnel, se il pannello è abbinato al cloud.
    pub fn tunnel(&self) -> Option<(String, String)> {
        let g = self.archivio.lock().unwrap_or_else(|e| e.into_inner());
        let a = g.as_ref()?;
        Some((a.tunnel_nome.clone()?, a.tunnel_token.clone()?))
    }

    /// La richiesta porta la firma del gateway di questo pannello?
    pub fn firma_valida(&self, intestazioni: &axum::http::HeaderMap) -> bool {
        let Some((_, token)) = self.tunnel() else { return false };
        let Some(dato) = intestazioni.get(INTESTAZIONE_GATEWAY).and_then(|v| v.to_str().ok()) else {
            return false;
        };
        crate::router::confronto_costante(dato.as_bytes(), firma_gateway(&token).as_bytes())
    }

    /// Cambia il nome nel tunnel (Rinomina dal cloud), token invariato.
    fn imposta_nome(&self, nome: &str) -> anyhow::Result<()> {
        let mut g = self.archivio.lock().unwrap_or_else(|e| e.into_inner());
        let Some(a) = g.as_mut() else { anyhow::bail!("nessun archivio di abbinamento") };
        if a.tunnel_token.is_none() {
            anyhow::bail!("il pannello non è abbinato al cloud");
        }
        a.tunnel_nome = Some(nome.to_string());
        Self::scrivi(&self.percorso, a)?;
        drop(g);
        self.cambiato.notify_one();
        Ok(())
    }

    /// Il segnale «ricollegati»: codice o credenziali del tunnel cambiati.
    pub fn cambiato(&self) -> std::sync::Arc<tokio::sync::Notify> {
        self.cambiato.clone()
    }

    fn imposta_tunnel(&self, nome: &str, token: &str) -> anyhow::Result<()> {
        let mut g = self.archivio.lock().unwrap_or_else(|e| e.into_inner());
        let Some(a) = g.as_mut() else { anyhow::bail!("nessun archivio di abbinamento") };
        a.tunnel_nome = Some(nome.to_string());
        a.tunnel_token = Some(token.to_string());
        Self::scrivi(&self.percorso, a)
    }

    /// `scritto` è il codice giusto? Conta i tentativi sbagliati: oltre il
    /// limite rifiuta tutto fino alla fine della finestra.
    fn verifica(&self, scritto: &str) -> Result<(), Rifiuto> {
        {
            let mut s = self.sbagliati.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(da) = s.1 {
                if da.elapsed() > FINESTRA {
                    *s = (0, None);
                }
            }
            if s.0 >= TENTATIVI {
                return Err(Rifiuto::TroppiTentativi);
            }
        }
        let atteso = self.codice().ok_or(Rifiuto::NonDisponibile)?;
        let ok = normalizza(scritto).is_some_and(|n| {
            crate::router::confronto_costante(n.as_bytes(), atteso.as_bytes())
        });
        if ok {
            return Ok(());
        }
        let mut s = self.sbagliati.lock().unwrap_or_else(|e| e.into_inner());
        s.0 += 1;
        s.1.get_or_insert_with(Instant::now);
        tracing::warn!(tentativi = s.0, "codice di abbinamento sbagliato");
        Err(Rifiuto::CodiceSbagliato)
    }

    /// Usato: se ne fa un altro. Quello vecchio non vale più.
    fn consuma(&self) -> anyhow::Result<()> {
        let mut g = self.archivio.lock().unwrap_or_else(|e| e.into_inner());
        let Some(a) = g.as_mut() else { return Ok(()) };
        a.codice = genera_codice()?;
        a.creato_ms = ora_ms();
        Self::scrivi(&self.percorso, a)?;
        drop(g);
        *self.sbagliati.lock().unwrap_or_else(|e| e.into_inner()) = (0, None);
        self.cambiato.notify_one();
        Ok(())
    }
}

#[derive(Debug, PartialEq)]
enum Rifiuto {
    CodiceSbagliato,
    TroppiTentativi,
    NonDisponibile,
}

fn ora_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Il nome con cui questo pannello si presenta: l'hostname.
///
/// Lo usano tre cose che devono dire la **stessa** cosa — la schermata di
/// abbinamento, l'annuncio mDNS e, dal 23-10-2026, il soggetto del certificato
/// TLS (`sws_web::system::genera_certificato`). Un certificato che dice
/// `CN=rcgen self signed cert` su ogni pannello del mondo non identifica
/// niente, ed è proprio la stringa che una colonna «soggetto» mostrerebbe a
/// tutti.
pub(crate) fn nome_proposto() -> String {
    std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "pannello".to_string())
}

/// `GET /api/abbinamento` — pre-auth, in lista bianca.
///
/// Il codice si mostra **solo** finché il pannello è in attesa: con un utente
/// qualsiasi non serve più a entrare, e mostrarlo vorrebbe dire lasciare in
/// giro una chiave che domani (abbinamento al cloud) potrebbe aprire altro.
pub async fn stato(State(s): State<crate::router::AppState>) -> Response {
    let in_attesa =
        crate::router::fonte_auth_corrente(&s).await == crate::router::FonteAutenticazione::InAttesa;
    let cloud = s.abbinamento.tunnel().map(|(n, _)| n);
    // Il codice si mostra anche a un pannello che ha già utenti ma non è
    // ancora abbinato al cloud: lì da solo non apre niente — per abbinare un
    // pannello con utenti servono anche le credenziali di un suo Admin.
    let codice = if in_attesa || cloud.is_none() { s.abbinamento.codice() } else { None };
    // Abbinato al cloud ma ancora senza utenti (fetta E): chiuso in LAN, aperto
    // al gateway, in attesa del primo progetto. Il codice non c'è più.
    let codice = if cloud.is_some() { None } else { codice };
    Json(serde_json::json!({
        "in_attesa": in_attesa,
        "codice": codice,
        "nome": nome_proposto(),
        "cloud": cloud,
        "abbinato_cloud_senza_utenti": in_attesa && cloud.is_some(),
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rivendica {
    codice: String,
    // `Option` e non `String` con default: dal gateway possono arrivare `null`
    // (abbinamento dal cloud senza utente, fetta E), che `String` rifiuta.
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    /// Dal gateway, quando l'abbinamento arriva dal cloud (fetta D): nome e
    /// token con cui il pannello si presenterà nel tunnel.
    #[serde(default)]
    tunnel: Option<CredenzialiTunnel>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CredenzialiTunnel {
    nome: String,
    token: String,
}

/// Lunghezza minima della password dell'Admin del dispositivo.
const PASSWORD_MINIMA: usize = 8;

/// `POST /api/abbinamento/rivendica` — pre-auth, in lista bianca.
///
/// Codice giusto e pannello in attesa → nasce l'Admin del dispositivo, il
/// codice si consuma, e si risponde col token di sessione: chi ha abbinato è
/// già dentro.
pub async fn rivendica(
    State(s): State<crate::router::AppState>,
    Json(r): Json<Rivendica>,
) -> Response {
    let errore = |stato: StatusCode, codice: &str, testo: &str| {
        (stato, Json(serde_json::json!({ "error": codice, "detail": testo }))).into_response()
    };
    let in_attesa =
        crate::router::fonte_auth_corrente(&s).await == crate::router::FonteAutenticazione::InAttesa;
    if !in_attesa && r.tunnel.is_none() {
        return errore(
            StatusCode::CONFLICT,
            "gia_abbinato",
            "questo pannello ha già degli utenti: si entra con quelli",
        );
    }
    match s.abbinamento.verifica(&r.codice) {
        Ok(()) => {}
        Err(Rifiuto::TroppiTentativi) => {
            return errore(
                StatusCode::TOO_MANY_REQUESTS,
                "troppi_tentativi",
                "troppi codici sbagliati: riprova fra qualche minuto",
            )
        }
        Err(Rifiuto::NonDisponibile) => {
            return errore(
                StatusCode::SERVICE_UNAVAILABLE,
                "non_disponibile",
                "questo pannello non ha un codice di abbinamento",
            )
        }
        Err(Rifiuto::CodiceSbagliato) => {
            s.audit.log("abbinamento.codice_sbagliato", None, serde_json::json!({}));
            return errore(StatusCode::UNAUTHORIZED, "codice_sbagliato", "codice sbagliato");
        }
    }
    let username = r.username.as_deref().unwrap_or("").trim().to_string();

    // **Un pannello che ha già utenti, abbinato al cloud**: il codice da solo
    // non basta — chi l'ha letto sullo schermo non deve potersi portare il
    // pannello nella sua azienda. Servono anche le credenziali di un suo Admin.
    if !in_attesa {
        let admin = s.auth.list_users().await.into_iter().chain(s.auth_dispositivo.list_users().await)
            .any(|u| u.username == username && u.role == sws_auth::Role::Admin);
        let password_giusta = s.auth.verify_user_password(&username, r.password.as_deref().unwrap_or("")).await
            || s.auth_dispositivo.verify_user_password(&username, r.password.as_deref().unwrap_or("")).await;
        if !admin || !password_giusta {
            return errore(
                StatusCode::UNAUTHORIZED,
                "credenziali_admin",
                "questo pannello ha già utenti: per abbinarlo al cloud servono utente e password di un suo amministratore",
            );
        }
        let Some(t) = r.tunnel.as_ref() else { unreachable!("controllato sopra") };
        return match salva_tunnel(&s, t) {
            Ok(()) => {
                s.audit.log("abbinamento.cloud", Some(username), serde_json::json!({ "pannello": t.nome }));
                Json(serde_json::json!({ "ok": true, "nome": t.nome })).into_response()
            }
            Err(e) => errore(StatusCode::INTERNAL_SERVER_ERROR, "salvataggio", &e.to_string()),
        };
    }

    // **Dal cloud senza utente** (fetta E, scelta del maintainer dell'11-10):
    // il pannello prende nome e token e resta senza utenti — chiuso in LAN,
    // raggiungibile dal gateway finché il primo progetto non porta i suoi.
    if username.is_empty() {
        if let Some(t) = r.tunnel.as_ref() {
            return match salva_tunnel(&s, t) {
                Ok(()) => {
                    s.audit.log("abbinamento.cloud", None, serde_json::json!({ "pannello": t.nome, "utenti": false }));
                    Json(serde_json::json!({ "ok": true, "nome": t.nome })).into_response()
                }
                Err(e) => errore(StatusCode::INTERNAL_SERVER_ERROR, "salvataggio", &e.to_string()),
            };
        }
        return errore(StatusCode::BAD_REQUEST, "utente_vuoto", "serve un nome utente");
    }
    if r.password.as_deref().unwrap_or("").chars().count() < PASSWORD_MINIMA {
        return errore(
            StatusCode::BAD_REQUEST,
            "password_corta",
            "la password deve avere almeno 8 caratteri",
        );
    }
    if let Err(e) = s
        .auth_dispositivo
        .create_user(sws_auth::CreateUser {
            username: username.clone(),
            password: r.password.clone().unwrap_or_default(),
            role: sws_auth::Role::Admin,
            must_change_password: false,
            allowed_zones: vec![],
        })
        .await
    {
        return errore(StatusCode::INTERNAL_SERVER_ERROR, "salvataggio", &format!("{e:?}"));
    }
    // `salva_tunnel` consuma già il codice: consumarlo due volte farebbe
    // ricollegare il tunnel due volte.
    let consumato = match r.tunnel.as_ref() {
        Some(t) => match salva_tunnel(&s, t) {
            Ok(()) => true,
            Err(e) => {
                tracing::error!("abbinamento: credenziali del tunnel non salvate: {e}");
                false
            }
        },
        None => false,
    };
    if !consumato {
        if let Err(e) = s.abbinamento.consuma() {
            // L'utente c'è già: il pannello è abbinato. Un codice non rinnovato
            // non apre niente da solo: per il cloud servono anche le
            // credenziali di un Admin.
            tracing::error!("abbinamento: codice non rinnovato: {e}");
        }
    }
    s.audit.log(
        "abbinamento.rivendicato",
        Some(username.clone()),
        serde_json::json!({ "fonte": if r.tunnel.is_some() { "cloud" } else { "locale" } }),
    );
    tracing::info!(utente = %username, "pannello abbinato: nato l'Admin del dispositivo");
    match s
        .auth_dispositivo
        .login(&sws_auth::Credentials { username, password: r.password.unwrap_or_default() })
        .await
    {
        Ok(ok) => Json(ok).into_response(),
        Err(_) => StatusCode::NO_CONTENT.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NuovoNome {
    nome: String,
}

/// `POST /api/abbinamento/nome` — il gateway rinomina il pannello nel tunnel.
///
/// Non passa da `require_auth`: la protegge la **firma del gateway**, sempre,
/// anche quando il pannello ha utenti — è l'unico che conosce il token, e il
/// nome nel tunnel è cosa sua.
pub async fn rinomina(
    State(s): State<crate::router::AppState>,
    intestazioni: axum::http::HeaderMap,
    Json(n): Json<NuovoNome>,
) -> Response {
    if !s.abbinamento.firma_valida(&intestazioni) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if crate::tunnel::abbinati::normalizza_nome(&n.nome).as_deref() != Some(n.nome.as_str()) {
        return (StatusCode::BAD_REQUEST, "nome non valido").into_response();
    }
    match s.abbinamento.imposta_nome(&n.nome) {
        Ok(()) => {
            tracing::info!(pannello = %n.nome, "rinominato dal cloud: mi ricollego col nome nuovo");
            s.audit.log("abbinamento.rinominato", None, serde_json::json!({ "pannello": n.nome }));
            Json(serde_json::json!({ "ok": true, "nome": n.nome })).into_response()
        }
        Err(e) => (StatusCode::CONFLICT, e.to_string()).into_response(),
    }
}

/// Nome e token del tunnel dal gateway: salvati, codice consumato, e il
/// tunnel si ricollega da abbinato.
fn salva_tunnel(s: &crate::router::AppState, t: &CredenzialiTunnel) -> anyhow::Result<()> {
    if t.token.len() < 16 || crate::tunnel::abbinati::normalizza_nome(&t.nome).as_deref() != Some(t.nome.as_str()) {
        anyhow::bail!("credenziali del tunnel non valide");
    }
    s.abbinamento.imposta_tunnel(&t.nome, &t.token)?;
    s.abbinamento.consuma()?;
    tracing::info!(pannello = %t.nome, "abbinato al cloud: mi ricollego col nuovo nome");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_codice_ha_la_forma_chiesta() {
        for _ in 0..200 {
            let c = genera_codice().unwrap();
            assert_eq!(c.len(), 19);
            let gruppi: Vec<_> = c.split('-').collect();
            assert_eq!(gruppi.len(), 4);
            assert!(gruppi.iter().all(|g| g.len() == 4));
            assert!(c.chars().all(|x| x == '-' || (x.is_ascii_uppercase() || x.is_ascii_digit())));
            assert!(!c.contains(['I', 'L', 'O', 'U']), "{c}");
            assert_eq!(normalizza(&c).as_deref(), Some(c.as_str()));
        }
    }

    #[test]
    fn si_perdona_come_lo_scrive_una_persona() {
        assert_eq!(normalizza("7kq2 m9xd 3hwp t4bz").as_deref(), Some("7KQ2-M9XD-3HWP-T4BZ"));
        assert_eq!(normalizza("7KQ2M9XD3HWPT4BZ").as_deref(), Some("7KQ2-M9XD-3HWP-T4BZ"));
        // O → 0, I e L → 1.
        assert_eq!(normalizza("OOOO-IIII-LLLL-0000").as_deref(), Some("0000-1111-1111-0000"));
        assert_eq!(normalizza("7KQ2-M9XD-3HWP"), None, "corto");
        assert_eq!(normalizza("7KQ2-M9XD-3HWP-T4BZ-X"), None, "lungo");
        assert_eq!(normalizza("UUUU-M9XD-3HWP-T4BZ"), None, "U non c'è");
        assert_eq!(normalizza("7KQ2-M9XD-3HWP-T4B€"), None);
    }

    #[test]
    fn il_codice_resta_e_si_consuma() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinamento::apri(d.path(), true);
        let c = a.codice().unwrap();
        assert!(a.hw().is_some());
        // Riaperto (container reinstallato): lo stesso.
        let b = Abbinamento::apri(d.path(), true);
        assert_eq!(b.codice().unwrap(), c);
        assert_eq!(b.verifica(&c.to_lowercase()), Ok(()));
        b.consuma().unwrap();
        let nuovo = b.codice().unwrap();
        assert_ne!(nuovo, c);
        assert_eq!(b.verifica(&c), Err(Rifiuto::CodiceSbagliato), "il vecchio non vale più");
        // Anche su disco.
        assert_eq!(Abbinamento::apri(d.path(), true).codice().unwrap(), nuovo);
    }

    #[test]
    fn troppi_sbagliati_chiudono_anche_il_giusto() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinamento::apri(d.path(), true);
        for _ in 0..TENTATIVI {
            assert_eq!(a.verifica("0000-0000-0000-0000"), Err(Rifiuto::CodiceSbagliato));
        }
        let giusto = a.codice().unwrap();
        assert_eq!(a.verifica(&giusto), Err(Rifiuto::TroppiTentativi));
    }

    #[test]
    fn la_firma_del_gateway_vale_solo_col_token_del_pannello() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinamento::apri(d.path(), true);
        let mut h = axum::http::HeaderMap::new();
        h.insert(INTESTAZIONE_GATEWAY, firma_gateway("token-del-pannello-lungo").parse().unwrap());
        assert!(!a.firma_valida(&h), "non abbinato al cloud: nessuna firma vale");
        a.imposta_tunnel("tc620", "token-del-pannello-lungo").unwrap();
        assert!(a.firma_valida(&h));
        let mut sbagliata = axum::http::HeaderMap::new();
        sbagliata.insert(INTESTAZIONE_GATEWAY, firma_gateway("altro-token").parse().unwrap());
        assert!(!a.firma_valida(&sbagliata));
        assert!(!a.firma_valida(&axum::http::HeaderMap::new()));
        // Rinominato: il token resta, la firma vale ancora.
        a.imposta_nome("tc620-casa").unwrap();
        assert_eq!(a.tunnel().unwrap().0, "tc620-casa");
        assert!(a.firma_valida(&h));
    }

    #[test]
    fn la_rivendica_dal_cloud_accetta_credenziali_assenti_o_nulle() {
        // Visto dal vivo l'11-10-2026: il gateway mandava `"username": null` e il
        // pannello rispondeva 422.
        for corpo in [
            r#"{"codice":"7KQ2-M9XD-3HWP-T4BZ","tunnel":{"nome":"tc620","token":"0123456789abcdef"}}"#,
            r#"{"codice":"7KQ2-M9XD-3HWP-T4BZ","username":null,"password":null,"tunnel":{"nome":"tc620","token":"0123456789abcdef"}}"#,
        ] {
            let r: Rivendica = serde_json::from_str(corpo).expect(corpo);
            assert!(r.username.is_none() && r.tunnel.is_some());
        }
    }

    #[test]
    fn fuori_da_un_pannello_non_si_tocca_il_disco() {
        let d = tempfile::tempdir().unwrap();
        let a = Abbinamento::apri(d.path(), false);
        assert!(a.codice().is_none());
        assert!(!d.path().join("abbinamento.json").exists());
    }
}
