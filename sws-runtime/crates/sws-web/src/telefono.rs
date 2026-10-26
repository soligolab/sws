//! SMS, chiamate e reperibilità con Twilio (P4, 26-10-2026; piano
//! `docs/plans/2026-10-26-sms-voce-reperibilita.md`).
//!
//! Un allarme che la tabella eventi × canali manda «al telefono» avvisa il
//! primo reperibile **di turno adesso**; se nessuno lo riconosce entro
//! `telefono_attesa_min`, il successivo, e così via. Un riconoscimento — dal
//! pannello, dall'IDE o dal telefono — ferma la catena.
//!
//! **La conferma dal telefono** vuole un indirizzo pubblico che Twilio possa
//! richiamare: c'è solo per un pannello collegato al cloud, attraverso il
//! gateway (`/telefono/<pannello>/…`, senza sessione). Il pannello non si fida
//! di nessuno: verifica la **firma di Twilio** (`X-Twilio-Signature`) col suo
//! token, e per la chiamata un **gettone** monouso dell'allarme.

use crate::router::AppState;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Form,
};
use base64::Engine;
use hmac::{Hmac, Mac};
use std::collections::HashMap;
use std::sync::Mutex;
use sws_core::{Project, Reperibile, TwilioConfig};
use tracing::{info, warn};

// ── Chi è di turno ──────────────────────────────────────────────────────────

fn minuti(hhmm: &str) -> Option<u32> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// `giorno` da 1 (lunedì) a 7 (domenica), `adesso` in minuti dalla mezzanotte.
/// Una fascia che finisce prima di cominciare passa la mezzanotte: la parte dopo
/// mezzanotte appartiene al **giorno prima** (il turno di notte del lunedì
/// finisce martedì mattina).
pub fn di_turno(r: &Reperibile, giorno: u8, adesso: u32) -> bool {
    let giorno_ok = |g: u8| r.giorni.is_empty() || r.giorni.contains(&g);
    let (Some(da), Some(a)) = (minuti(&r.dalle), minuti(&r.alle)) else {
        // Fascia non scritta (o scritta male): tutto il giorno.
        return giorno_ok(giorno);
    };
    if da <= a {
        giorno_ok(giorno) && adesso >= da && adesso < a
    } else {
        let ieri = if giorno == 1 { 7 } else { giorno - 1 };
        (giorno_ok(giorno) && adesso >= da) || (giorno_ok(ieri) && adesso < a)
    }
}

/// I reperibili di turno, nell'ordine dell'elenco (l'ordine di escalation).
pub fn reperibili_di_turno(tutti: &[Reperibile], giorno: u8, adesso: u32) -> Vec<&Reperibile> {
    tutti.iter().filter(|r| di_turno(r, giorno, adesso)).collect()
}

// ── Twilio ──────────────────────────────────────────────────────────────────

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn voce_di(lingua: &str) -> &'static str {
    if lingua.starts_with("en") { "en-US" } else { "it-IT" }
}

/// Le parole della chiamata e degli SMS.
fn parole(lingua: &str) -> (&'static str, &'static str, &'static str) {
    if lingua.starts_with("en") {
        ("Press 1 to acknowledge the alarm.", "Alarm acknowledged. Thank you.", "Reply OK to acknowledge.")
    } else {
        ("Premi 1 per riconoscere l'allarme.", "Allarme riconosciuto. Grazie.", "Rispondi OK per riconoscerlo.")
    }
}

/// Il TwiML della chiamata: il testo letto due volte e, se c'è un indirizzo di
/// conferma, «premi 1».
pub fn twiml_chiamata(testo: &str, lingua: &str, conferma: Option<&str>) -> String {
    let v = voce_di(lingua);
    let t = xml(testo);
    match conferma {
        Some(url) => format!(
            r#"<Response><Gather numDigits="1" action="{}" method="POST"><Say language="{v}">{t}</Say><Say language="{v}">{}</Say><Say language="{v}">{t}</Say></Gather></Response>"#,
            xml(url),
            xml(parole(lingua).0)
        ),
        None => format!(r#"<Response><Say language="{v}">{t}</Say><Pause length="1"/><Say language="{v}">{t}</Say></Response>"#),
    }
}

/// La firma che Twilio mette in `X-Twilio-Signature`: HMAC-SHA1 col token
/// dell'account dell'URL chiamato seguito dai parametri del POST, ordinati per
/// nome e concatenati come nome+valore, in base64.
pub fn firma(token: &str, url: &str, parametri: &HashMap<String, String>) -> String {
    let mut chiavi: Vec<&String> = parametri.keys().collect();
    chiavi.sort();
    let mut dati = url.to_string();
    for k in chiavi {
        dati.push_str(k);
        dati.push_str(&parametri[k]);
    }
    let mut m = Hmac::<sha1::Sha1>::new_from_slice(token.as_bytes()).expect("HMAC accetta chiavi di ogni lunghezza");
    m.update(dati.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(m.finalize().into_bytes())
}

/// La firma ricevuta combacia? Confronto a tempo costante.
pub fn firma_valida(token: &str, url: &str, parametri: &HashMap<String, String>, ricevuta: &str) -> bool {
    let attesa = firma(token, url, parametri);
    attesa.len() == ricevuta.len() && attesa.bytes().zip(ricevuta.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

async fn twilio(cfg: &TwilioConfig, risorsa: &str, campi: &[(&str, &str)]) -> anyhow::Result<()> {
    let url = format!("https://api.twilio.com/2010-04-01/Accounts/{}/{risorsa}.json", cfg.account_sid);
    let r = reqwest::Client::new()
        .post(url)
        .basic_auth(&cfg.account_sid, Some(&cfg.auth_token))
        .form(campi)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await?;
    if !r.status().is_success() {
        let codice = r.status();
        anyhow::bail!("Twilio ha risposto {codice}: {}", r.text().await.unwrap_or_default());
    }
    Ok(())
}

pub async fn manda_sms(cfg: &TwilioConfig, a: &str, testo: &str) -> anyhow::Result<()> {
    twilio(cfg, "Messages", &[("To", a), ("From", &cfg.numero), ("Body", testo)]).await
}

pub async fn chiama(cfg: &TwilioConfig, a: &str, twiml: &str) -> anyhow::Result<()> {
    twilio(cfg, "Calls", &[("To", a), ("From", &cfg.numero), ("Twiml", twiml)]).await
}

// ── L'indirizzo pubblico e i gettoni ────────────────────────────────────────

static PUBBLICO: Mutex<Option<String>> = Mutex::new(None);

/// Il tunnel aperto dice al modulo dove Twilio può richiamare questo pannello:
/// `wss://sws.soligo.net/tunnel/v1` + nome → `https://sws.soligo.net/telefono/<nome>`.
pub fn registra_pubblico(url_tunnel: &str, nome: &str) {
    let base = url_tunnel
        .replacen("wss://", "https://", 1)
        .replacen("ws://", "http://", 1);
    let base = base.split("/tunnel").next().unwrap_or(&base).trim_end_matches('/').to_string();
    *PUBBLICO.lock().expect("PUBBLICO") = Some(format!("{base}/telefono/{nome}"));
}

fn pubblico() -> Option<String> {
    PUBBLICO.lock().ok()?.clone()
}

/// Gettone → (allarme, telefono, scadenza). Monouso, e scade dopo un'ora.
static GETTONI: Mutex<Option<HashMap<String, (String, String, u64)>>> = Mutex::new(None);
/// L'ultimo allarme mandato a ogni numero, per la risposta «OK» a un SMS.
static ULTIMO: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn gettone_nuovo(allarme: &str, telefono: &str) -> String {
    // `/dev/urandom` come il segreto del gateway: niente crate in più.
    let mut b = [0u8; 16];
    {
        use std::io::Read as _;
        let _ = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b));
    }
    let g: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let mut m = GETTONI.lock().expect("GETTONI");
    let m = m.get_or_insert_with(HashMap::new);
    let adesso = sws_core::now_ms();
    m.retain(|_, (_, _, scade)| *scade > adesso);
    m.insert(g.clone(), (allarme.to_string(), telefono.to_string(), adesso + 3_600_000));
    g
}

fn usa_gettone(g: &str) -> Option<(String, String)> {
    let mut m = GETTONI.lock().ok()?;
    let (a, t, scade) = m.as_mut()?.remove(g)?;
    (scade > sws_core::now_ms()).then_some((a, t))
}

fn ricorda_ultimo(telefono: &str, allarme: &str) {
    if let Ok(mut m) = ULTIMO.lock() {
        m.get_or_insert_with(HashMap::new).insert(telefono.to_string(), allarme.to_string());
    }
}

// ── La catena di escalation ─────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Catena {
    passo: usize,
    prossimo_ms: u64,
}

static CATENE: Mutex<Option<HashMap<String, Catena>>> = Mutex::new(None);

/// Avvisa un reperibile di un allarme, coi canali della riga della tabella.
async fn avvisa(cfg: &TwilioConfig, r: &Reperibile, allarme: &str, testo: &str, lingua: &str, sms: bool, voce: bool) {
    if sms {
        let corpo = if pubblico().is_some() { format!("{testo} {}", parole(lingua).2) } else { testo.to_string() };
        match manda_sms(cfg, &r.telefono, &corpo).await {
            Ok(()) => info!(allarme, reperibile = %r.nome, "telefono: SMS mandato"),
            Err(e) => warn!(allarme, reperibile = %r.nome, "telefono: SMS non mandato: {e}"),
        }
    }
    if voce {
        let conferma = pubblico().map(|b| format!("{b}/voce?g={}", gettone_nuovo(allarme, &r.telefono)));
        match chiama(cfg, &r.telefono, &twiml_chiamata(testo, lingua, conferma.as_deref())).await {
            Ok(()) => info!(allarme, reperibile = %r.nome, "telefono: chiamata partita"),
            Err(e) => warn!(allarme, reperibile = %r.nome, "telefono: chiamata non partita: {e}"),
        }
    }
    ricorda_ultimo(&r.telefono, allarme);
}

fn ruolo_impianto(s: &AppState) -> bool {
    !s.ide_only && s.segreto_gateway.is_none() && s.regia.is_none()
}

/// Il compito del telefono, avviato una volta sola: ogni 30 secondi guarda gli
/// allarmi attivi e non riconosciuti e fa avanzare le loro catene. Un
/// controllo periodico e non un'attesa sugli eventi, così un riavvio a metà
/// catena non la perde: riparte dal primo reperibile.
pub fn avvia_una_volta(s: &AppState) {
    static AVVIATO: std::sync::Once = std::sync::Once::new();
    if !ruolo_impianto(s) {
        return;
    }
    let s = s.clone();
    AVVIATO.call_once(move || {
        tokio::spawn(async move {
            loop {
                giro(&s).await;
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });
    });
}

async fn giro(s: &AppState) {
    let Ok(dir) = crate::router::active_dir(s).await else { return };
    let Ok(p) = Project::load(&dir) else { return };
    let Some(n) = p.notifications.as_ref() else { return };
    let Some(cfg) = n.twilio.as_ref().filter(|t| !t.account_sid.is_empty() && !t.auth_token.is_empty()) else { return };
    let tabella = n.tabella();
    if !tabella.scatto.telefono() && !tabella.escalation.telefono() {
        return;
    }
    let lingua = n.lingua_per(sws_core::CanaleNotifica::Voce, if p.languages.default.is_empty() { "it" } else { &p.languages.default });
    let attesa_ms = n.telefono_attesa_min.unwrap_or(10).max(1) as u64 * 60_000;
    let adesso = sws_core::now_ms();
    let locale = chrono::Local::now();
    use chrono::{Datelike, Timelike};
    let giorno = locale.weekday().number_from_monday() as u8;
    let minuti_ora = locale.hour() * 60 + locale.minute();

    let stati = s.alarms.snapshot().await;
    let mut da_avvisare = Vec::new();
    {
        let mut catene = CATENE.lock().expect("CATENE");
        let catene = catene.get_or_insert_with(HashMap::new);
        // Una catena finisce quando l'allarme è riconosciuto o rientrato.
        catene.retain(|id, _| stati.iter().any(|st| &st.def.id == id && st.active && !st.acknowledged));
        for st in stati.iter().filter(|st| st.active && !st.acknowledged) {
            let eta_s = st.activated_at_ms.map(|t| adesso.saturating_sub(t) / 1000).unwrap_or(0) as f64;
            let (riga, parte) = if tabella.scatto.telefono() {
                (tabella.scatto, true)
            } else {
                (tabella.escalation, st.def.escalate_after_s.is_some_and(|e| eta_s >= e))
            };
            if !parte {
                continue;
            }
            let c = catene.entry(st.def.id.clone()).or_insert(Catena { passo: 0, prossimo_ms: adesso });
            if c.prossimo_ms > adesso {
                continue;
            }
            let turno = reperibili_di_turno(&n.reperibili, giorno, minuti_ora);
            match turno.get(c.passo) {
                Some(r) => {
                    let testo = format!("{} — {}", st.def.id, sws_core::project::resolve_msg(&st.message, &lingua, &p.languages));
                    da_avvisare.push(((*r).clone(), st.def.id.clone(), testo, riga));
                    c.passo += 1;
                    c.prossimo_ms = adesso + attesa_ms;
                }
                None if c.passo == 0 => {
                    warn!(allarme = %st.def.id, "telefono: nessun reperibile di turno adesso, nessuno avvisato");
                    c.prossimo_ms = adesso + attesa_ms;
                }
                // La lista è finita: si ricomincia dal primo al giro dopo.
                None => {
                    c.passo = 0;
                    c.prossimo_ms = adesso + attesa_ms;
                }
            }
        }
    }
    for (r, id, testo, riga) in da_avvisare {
        avvisa(cfg, &r, &id, &testo, &lingua, riga.sms, riga.voce).await;
    }
}

// ── Le rotte ────────────────────────────────────────────────────────────────

/// L'URL che Twilio ha chiamato, come lo ha firmato: il gateway lo passa in
/// un'intestazione, perché dentro il tunnel il pannello vede solo il percorso.
pub const INTESTAZIONE_URL: &str = "x-sws-url-pubblica";

fn twiml(s: String) -> Response {
    ([("content-type", "text/xml")], s).into_response()
}

/// Twilio è davvero lui? Firma valida col token del progetto aperto.
async fn verifica(s: &AppState, h: &HeaderMap, campi: &HashMap<String, String>) -> Option<(TwilioConfig, String, Project)> {
    let dir = crate::router::active_dir(s).await.ok()?;
    let p = Project::load(&dir).ok()?;
    let n = p.notifications.as_ref()?;
    let cfg = n.twilio.clone()?;
    let url = h.get(INTESTAZIONE_URL)?.to_str().ok()?;
    let ricevuta = h.get("x-twilio-signature")?.to_str().ok()?;
    if !firma_valida(&cfg.auth_token, url, campi, ricevuta) {
        warn!("telefono: richiesta con una firma Twilio non valida, ignorata");
        return None;
    }
    let lingua = n.lingua_per(sws_core::CanaleNotifica::Voce, if p.languages.default.is_empty() { "it" } else { &p.languages.default });
    Some((cfg, lingua, p))
}

/// `POST /api/telefono/voce?g=<gettone>` — il tasto premuto durante la chiamata.
pub async fn voce(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>, h: HeaderMap, Form(campi): Form<HashMap<String, String>>) -> Response {
    let Some((_, lingua, p)) = verifica(&s, &h, &campi).await else { return StatusCode::FORBIDDEN.into_response() };
    if campi.get("Digits").map(String::as_str) != Some("1") {
        return twiml("<Response/>".into());
    }
    let Some((allarme, telefono)) = q.get("g").and_then(|g| usa_gettone(g)) else { return twiml("<Response/>".into()) };
    let chi = p.notifications.as_ref().and_then(|n| n.reperibili.iter().find(|r| r.telefono == telefono)).map(|r| r.nome.clone()).unwrap_or(telefono);
    s.alarms.ack(&allarme, Some(format!("telefono: {chi}"))).await;
    s.audit.log("alarm.ack", Some(format!("telefono: {chi}")), serde_json::json!({ "id": allarme, "via": "voce" }));
    info!(%allarme, %chi, "telefono: allarme riconosciuto dalla chiamata");
    twiml(format!(r#"<Response><Say language="{}">{}</Say></Response>"#, voce_di(&lingua), xml(parole(&lingua).1)))
}

/// `POST /api/telefono/sms` — la risposta a un SMS («OK», «1», «SI»): riconosce
/// l'ultimo allarme mandato a quel numero. Il webhook va impostato sul numero
/// nella console di Twilio.
pub async fn sms(State(s): State<AppState>, h: HeaderMap, Form(campi): Form<HashMap<String, String>>) -> Response {
    let Some((_, lingua, p)) = verifica(&s, &h, &campi).await else { return StatusCode::FORBIDDEN.into_response() };
    let corpo = campi.get("Body").map(|b| b.trim().to_uppercase()).unwrap_or_default();
    let Some(da) = campi.get("From") else { return twiml("<Response/>".into()) };
    if !["OK", "1", "SI", "SÌ", "YES"].contains(&corpo.as_str()) {
        return twiml("<Response/>".into());
    }
    let allarme = ULTIMO.lock().ok().and_then(|m| m.as_ref().and_then(|m| m.get(da).cloned()));
    let Some(allarme) = allarme else { return twiml("<Response/>".into()) };
    let chi = p.notifications.as_ref().and_then(|n| n.reperibili.iter().find(|r| &r.telefono == da)).map(|r| r.nome.clone()).unwrap_or(da.clone());
    s.alarms.ack(&allarme, Some(format!("telefono: {chi}"))).await;
    s.audit.log("alarm.ack", Some(format!("telefono: {chi}")), serde_json::json!({ "id": allarme, "via": "sms" }));
    twiml(format!("<Response><Message>{}</Message></Response>", xml(parole(&lingua).1)))
}

/// `POST /api/telefono/prova` — un SMS di prova al numero dato (Admin).
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Prova {
    pub numero: String,
}

pub async fn prova(
    State(s): State<AppState>,
    axum::Extension(user): axum::Extension<crate::router::AuthUser>,
    axum::Json(b): axum::Json<Prova>,
) -> Response {
    s.audit.log("notifications.test_sms", Some(user.username), serde_json::json!({ "numero": b.numero }));
    let Ok(dir) = crate::router::active_dir(&s).await else { return (StatusCode::CONFLICT, "nessun progetto aperto").into_response() };
    let Some(cfg) = Project::load(&dir).ok().and_then(|p| p.notifications).and_then(|n| n.twilio) else {
        return (StatusCode::BAD_REQUEST, "Twilio non configurato").into_response();
    };
    match manda_sms(&cfg, &b.numero, "SWS: prova di invio SMS.").await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rep(giorni: &[u8], dalle: &str, alle: &str) -> Reperibile {
        Reperibile { nome: "x".into(), telefono: "+39".into(), giorni: giorni.to_vec(), dalle: dalle.into(), alle: alle.into() }
    }

    #[test]
    fn i_turni_anche_a_cavallo_della_mezzanotte() {
        let giorno = rep(&[1, 2, 3, 4, 5], "08:00", "18:00");
        assert!(di_turno(&giorno, 1, 8 * 60));
        assert!(!di_turno(&giorno, 1, 18 * 60), "la fine è esclusa");
        assert!(!di_turno(&giorno, 6, 10 * 60), "il sabato no");
        let notte = rep(&[1], "22:00", "06:00");
        assert!(di_turno(&notte, 1, 23 * 60), "lunedì sera");
        assert!(di_turno(&notte, 2, 5 * 60), "martedì all'alba è ancora il turno del lunedì");
        assert!(!di_turno(&notte, 1, 5 * 60), "lunedì all'alba è il turno della domenica, che non c'è");
        let sempre = rep(&[], "", "");
        assert!(di_turno(&sempre, 7, 3 * 60));
        let tutti = [giorno.clone(), notte.clone(), sempre.clone()];
        assert_eq!(reperibili_di_turno(&tutti, 1, 23 * 60).len(), 2, "l'ordine dell'elenco resta");
    }

    /// La firma con l'esempio della documentazione di Twilio («Validating
    /// Requests are coming from Twilio»): token, URL e parametri pubblicati, e
    /// la firma che pubblicano.
    #[test]
    fn la_firma_di_twilio_come_la_documenta_twilio() {
        let parametri: HashMap<String, String> = [
            ("CallSid", "CA1234567890ABCDE"),
            ("Caller", "+12349013030"),
            ("Digits", "1234"),
            ("From", "+12349013030"),
            ("To", "+18005551212"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let url = "https://mycompany.com/myapp.php?foo=1&bar=2";
        assert_eq!(firma("12345", url, &parametri), "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
        assert!(firma_valida("12345", url, &parametri, "0/KCTR6DLpKmkAf8muzZqo1nDgQ="));
        assert!(!firma_valida("altro", url, &parametri, "0/KCTR6DLpKmkAf8muzZqo1nDgQ="));
    }

    #[test]
    fn il_twiml_della_chiamata() {
        let con = twiml_chiamata("Pompa ferma <P1>", "it", Some("https://g/telefono/tc620/voce?g=ab&x=1"));
        assert!(con.contains(r#"<Gather numDigits="1" action="https://g/telefono/tc620/voce?g=ab&amp;x=1""#), "{con}");
        assert!(con.contains("Pompa ferma &lt;P1&gt;") && con.contains("Premi 1"));
        let senza = twiml_chiamata("Pompa ferma", "en", None);
        assert!(!senza.contains("Gather") && senza.contains(r#"language="en-US""#));
    }

    #[test]
    fn l_indirizzo_pubblico_dal_tunnel() {
        registra_pubblico("wss://sws.soligo.net/tunnel/v1", "tc620");
        assert_eq!(pubblico().as_deref(), Some("https://sws.soligo.net/telefono/tc620"));
    }

    #[test]
    fn un_gettone_si_usa_una_volta() {
        let g = gettone_nuovo("pompa", "+39");
        assert_eq!(usa_gettone(&g), Some(("pompa".into(), "+39".into())));
        assert_eq!(usa_gettone(&g), None);
    }
}
