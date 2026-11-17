//! Gli strumenti che usano **un altro modello** (F5 e F6 del piano
//! `docs/archive/2026-11-04-un-modello-per-ogni-scopo.md`): `disegna_simbolo` col
//! modello dei simboli, `genera_sfondo` e `varia_sfondo` col modello delle
//! immagini. Vivono nel ciclo della chat come `bozza_simbolo`, perché scrivono
//! nel banco della conversazione e la loro spesa conta nel suo tetto.

use base64::Engine as _;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::{bfl, client, immagini, local_http, prompt, scopi, spending, tools, Banco, Misure};
use crate::router::AppState;

/// Cosa la conversazione sa fare in più, deciso all'apertura del socket.
pub(crate) struct Contesto {
    pub opzioni: tools::Opzioni,
    pub simboli: Option<client::Scelta>,
    pub sfondi: Option<scopi::SceltaImmagini>,
    pub http: reqwest::Client,
    /// The client of the symbol model: [`Contesto::http`] itself for a cloud
    /// provider, a guarded one for an address the customer chose
    /// (`local_http.rs`).
    pub symbols_http: reqwest::Client,
    /// Where Black Forest Labs is: the real one, a fake in the tests.
    pub bfl: bfl::Endpoint,
}

impl Contesto {
    /// With the keys of the user who is writing (`user_keys.rs`); empty = the
    /// project's alone. `in_cloud` = a container behind the gateway.
    /// `assistant` = the model of the conversation: one that does not read
    /// images gets no page snapshot.
    pub fn da_con(
        config_dir: &std::path::Path,
        user: &client::UserKeys,
        in_cloud: bool,
        assistant: Option<&client::Scelta>,
    ) -> Self {
        let mut simboli = scopi::ha_scelta_propria_con(config_dir, scopi::Scopo::Simboli, user)
            .then(|| scopi::carica_per_con(config_dir, scopi::Scopo::Simboli, user))
            .flatten();
        let sfondi = scopi::carica_sfondi_con(config_dir, user);
        let http_base = || reqwest::Client::builder().timeout(std::time::Duration::from_secs(300));
        let http = http_base().build().unwrap_or_default();
        let symbols_http = match simboli.as_ref().filter(|sc| sc.endpoint.is_some()) {
            None => http.clone(),
            // An address the cloud refuses: no symbol model, the assistant
            // draws by itself (`bozza_simbolo`) instead of failing every call.
            Some(sc) => match local_http::client_for(sc, in_cloud, http_base()) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = %e, "the symbol model cannot be reached: left out");
                    simboli = None;
                    http.clone()
                }
            },
        };
        Contesto {
            opzioni: tools::Opzioni {
                disegna_simboli: simboli.is_some(),
                sfondi: sfondi.is_some(),
                no_snapshot: assistant.is_some_and(|a| !a.sees_images),
            },
            simboli,
            sfondi,
            http,
            symbols_http,
            bfl: bfl::Endpoint::default(),
        }
    }
}

fn invia(tx: &mpsc::UnboundedSender<String>, v: Value) {
    let _ = tx.send(v.to_string());
}

fn testo<'a>(input: &'a Value, k: &str) -> Result<&'a str, String> {
    input
        .get(k)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("manca `{k}`"))
}

/// Il JSON dentro una risposta: tolti i recinti ``` e quello che sta fuori dalle
/// graffe esterne. I modelli lo mettono anche quando si chiede di non farlo.
pub(crate) fn estrai_json(s: &str) -> &str {
    match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if b > a => &s[a..=b],
        _ => s,
    }
}

const TENTATIVI_SIMBOLO: usize = 3;

/// `disegna_simbolo`: il modello dei simboli scrive la descrizione, SWS la
/// compila; gli errori tornano a lui, fino a tre volte.
pub(crate) async fn disegna(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    banco: &mut Banco,
    misure: &mut Misure,
    ctx: &Contesto,
    tetto_usd: f64,
    input: &Value,
) -> Result<Value, String> {
    let sc = ctx
        .simboli
        .as_ref()
        .ok_or("nessun modello dei simboli configurato: usa bozza_simbolo")?;
    let (slug, it, en, cosa) = (
        testo(input, "slug")?,
        testo(input, "it")?,
        testo(input, "en")?,
        testo(input, "cosa")?,
    );
    let misure_dette = match (
        input.get("w").and_then(Value::as_u64),
        input.get("h").and_then(Value::as_u64),
    ) {
        (Some(w), Some(h)) => format!("w: {w}\nh: {h}\n"),
        _ => String::new(),
    };
    // Slug ed etichette si controllano prima di pagare: il modello dei simboli
    // non li può correggere (li impone l'assistente a ogni tentativo), quindi
    // un valore sbagliato bruciava tre chiamate per niente.
    let slug_ok = (3..=40).contains(&slug.len())
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !slug.starts_with('-')
        && !slug.ends_with('-');
    if !slug_ok {
        return Err(format!(
            "slug «{slug}»: da 3 a 40 caratteri fra a-z, 0-9 e «-»"
        ));
    }
    for (l, e) in [("it", it), ("en", en)] {
        if e.chars().count() > 60 || e.chars().any(|c| "<>\"&".contains(c)) {
            return Err(format!(
                "etichetta {l} «{e}»: da 1 a 60 caratteri, senza < > \" &"
            ));
        }
    }
    let schema = tools::schema_simbolo()?;
    let mut istruzioni = format!(
        "Disegni i simboli di SWS, uno SCADA: macchine viste di fronte, per i sinottici di un \
         pannello industriale. Rispondi SOLO con un oggetto JSON: la descrizione del simbolo, \
         nel formato qui sotto. Niente testo prima o dopo.\n\nFormato, regole ed esempi:\n{schema}"
    );
    if let Some(r) = super::regole_del_progetto(s, "simboli").await {
        istruzioni.push_str("\n\n");
        istruzioni.push_str(&prompt::blocco_regole(&r));
    }
    let mut messaggi = vec![json!({ "role": "user", "content": format!(
        "Disegna questo simbolo.\nslug: {slug}\nit: {it}\nen: {en}\n{misure_dette}\n{cosa}") })];

    let mut ultimi: Vec<String> = Vec::new();
    for tentativo in 1..=TENTATIVI_SIMBOLO {
        if misure.costo_usd >= tetto_usd {
            return Err(format!(
                "tetto di spesa raggiunto ({:.2} $ su {:.2} $): il simbolo non si disegna",
                misure.costo_usd, tetto_usd
            ));
        }
        // Il tetto dello scopo «simboli», se ne ha uno suo: era salvato e
        // mostrato nel menù, e nessuno lo guardava.
        if banco.spesa_simboli >= sc.tetto_usd {
            return Err(format!(
                "tetto del disegno dei simboli raggiunto ({:.2} $ su {:.2} $). Alzalo in IA → Un modello per scopo",
                banco.spesa_simboli, sc.tetto_usd
            ));
        }
        let t0 = std::time::Instant::now();
        let (risposta, uso) =
            client::chiedi_con_uso(&ctx.symbols_http, sc, &istruzioni, &messaggi, 16000)
                .await
                .map_err(|e| format!("il modello dei simboli non risponde: {e:#}"))?;
        let costo = crate::ai::price_list::cost_usd(
            &s.config_dir,
            sc.fornitore,
            &sc.modello,
            &uso,
            s.in_cloud(),
        );
        misure.giro(&uso, costo, t0.elapsed().as_secs_f64());
        banco.spesa_simboli += costo;
        spending::add(
            &s.config_dir,
            scopi::Scopo::Simboli.nome(),
            sc.fornitore.nome(),
            costo,
        );
        invia(
            tx,
            json!({ "t": "risorse_extra", "costo": costo, "speso": misure.costo_usd,
                          "chi": sc.modello }),
        );

        let errori = match serde_json::from_str::<Value>(estrai_json(&risposta)) {
            Err(e) => vec![format!("la risposta non è un JSON valido: {e}")],
            Ok(mut d) => {
                // Slug ed etichette sono quelli chiesti dall'assistente: il
                // modello dei simboli disegna, non rinomina.
                if let Some(o) = d.as_object_mut() {
                    o.insert("slug".into(), json!(slug));
                    o.insert("it".into(), json!(it));
                    o.insert("en".into(), json!(en));
                }
                match tools::compila_bozza(&json!({ "descrizione": d })) {
                    Ok((d, c)) => {
                        invia(
                            tx,
                            json!({ "t": "simbolo", "slug": d.slug, "it": d.it,
                                          "en": d.en, "svg": c.svg }),
                        );
                        let mut esito = tools::esito_bozza(&c);
                        esito["disegnato_da"] = json!(sc.modello);
                        esito["tentativi"] = json!(tentativo);
                        banco.metti(d);
                        return Ok(esito);
                    }
                    Err(e) => e,
                }
            }
        };
        messaggi.push(json!({ "role": "assistant", "content": risposta }));
        messaggi.push(json!({ "role": "user", "content": format!(
            "La descrizione ha questi errori:\n- {}\nCorreggili e rimanda la descrizione intera, \
             solo il JSON.", errori.join("\n- ")) }));
        ultimi = errori;
    }
    Err(format!(
        "il modello dei simboli non ci è riuscito in {TENTATIVI_SIMBOLO} tentativi. Ultimi errori: {}",
        ultimi.join("; ")
    ))
}

/// Il tetto degli sfondi: la loro stima di spesa, e anche quello della
/// conversazione, che li conta.
fn controlla_tetto_sfondi(
    config_dir: &std::path::Path,
    banco: &Banco,
    misure: &Misure,
    sc: &scopi::SceltaImmagini,
    tetto_usd: f64,
    edit: bool,
) -> Result<f64, String> {
    let costo = immagini::estimated_usd(config_dir, sc, edit);
    if banco.spesa_sfondi + costo > sc.tetto_usd {
        return Err(format!(
            "tetto degli sfondi raggiunto: {:.2} $ su {:.2} $ (stima). Alzalo in IA → Un modello per scopo",
            banco.spesa_sfondi, sc.tetto_usd
        ));
    }
    if misure.costo_usd + costo > tetto_usd {
        return Err(format!(
            "tetto della conversazione raggiunto: {:.2} $ su {:.2} $",
            misure.costo_usd, tetto_usd
        ));
    }
    Ok(costo)
}

/// The cost of one request for a background enters the cap of the purpose,
/// the cap of the conversation and the spending history of the installation.
/// `settled` says whether the provider declared the cost (`None`: not known,
/// for a request that failed); `delivered` whether the image arrived.
#[allow(clippy::too_many_arguments)]
fn count_background(
    s: &AppState,
    banco: &mut Banco,
    misure: &mut Misure,
    sc: &scopi::SceltaImmagini,
    cost: f64,
    settled: Option<bool>,
    delivered: bool,
    started: std::time::Instant,
) {
    banco.spesa_sfondi += cost;
    misure.giro(
        &json!({ "immagini": u8::from(delivered), "qualita": sc.qualita,
                 "provider": sc.fornitore.name(), "settled": settled,
                 "delivered": delivered }),
        cost,
        started.elapsed().as_secs_f64(),
    );
    spending::add(
        &s.config_dir,
        scopi::Scopo::Sfondi.nome(),
        sc.fornitore.name(),
        cost,
    );
}

/// One background was made. The cost is the one the provider settled (FLUX
/// says it), else the estimate the cap was checked with.
fn pay_background(
    s: &AppState,
    banco: &mut Banco,
    misure: &mut Misure,
    sc: &scopi::SceltaImmagini,
    img: &immagini::Generated,
    estimate: f64,
    started: std::time::Instant,
) {
    let cost = img.settled_usd.unwrap_or(estimate);
    let settled = Some(img.settled_usd.is_some());
    count_background(s, banco, misure, sc, cost, settled, true, started);
}

/// A request for a background failed. When the provider had already accepted
/// it (FLUX: the task was submitted, then it timed out, failed or could not be
/// downloaded) it is counted like an image that arrived. Otherwise a slow FLUX
/// would let the model open one paid task after another with the cap of the
/// purpose still at zero, and the history would not show them. Returns what
/// the model is told.
fn failed_background(
    s: &AppState,
    banco: &mut Banco,
    misure: &mut Misure,
    sc: &scopi::SceltaImmagini,
    failed: immagini::Failed,
    started: std::time::Instant,
) -> String {
    let Some(cost) = failed.charged_usd.filter(|usd| *usd > 0.0) else {
        return failed.message;
    };
    count_background(s, banco, misure, sc, cost, None, false, started);
    format!(
        "{}. The provider had already accepted the request: {cost:.3} $ are counted all the \
         same. Tell the person before asking for it again.",
        failed.message.trim_end_matches('.')
    )
}

fn mostra(tx: &mpsc::UnboundedSender<String>, f: &immagini::Sfondo) {
    invia(
        tx,
        json!({ "t": "sfondo", "id": f.id, "base": f.da.is_none(), "luce": f.luce,
                "approvata": f.approvata,
                "jpg": base64::engine::general_purpose::STANDARD.encode(&f.jpg) }),
    );
}

/// `genera_sfondo`: solo basi candidate. La persona ne approva una in chat.
pub(crate) async fn genera_sfondi(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    banco: &mut Banco,
    misure: &mut Misure,
    ctx: &Contesto,
    tetto_usd: f64,
    input: &Value,
) -> Result<Value, String> {
    let sc = ctx
        .sfondi
        .as_ref()
        .ok_or("nessun modello di immagini configurato")?;
    let descrizione = testo(input, "descrizione")?;
    let quante = input
        .get("quante")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 3);
    let regole = super::regole_del_progetto(s, "sfondi").await;
    let mut fatte = Vec::new();
    let mut interrotto = None;
    for _ in 0..quante {
        let estimate =
            match controlla_tetto_sfondi(&s.config_dir, banco, misure, sc, tetto_usd, false) {
                Ok(c) => c,
                Err(e) if fatte.is_empty() => return Err(e),
                Err(e) => {
                    interrotto = Some(e);
                    break;
                }
            };
        let t0 = std::time::Instant::now();
        // Un errore dopo la prima immagine non butta quelle già pagate: il
        // modello le riceve, e il turno si ferma lo stesso (sono in chat).
        let made = immagini::genera(
            &ctx.http,
            &ctx.bfl,
            sc,
            descrizione,
            regole.as_deref(),
            estimate,
        )
        .await;
        let img = match made {
            Ok(j) => j,
            Err(failed) => {
                let e = failed_background(s, banco, misure, sc, failed, t0);
                if fatte.is_empty() {
                    return Err(e);
                }
                interrotto = Some(e);
                break;
            }
        };
        pay_background(s, banco, misure, sc, &img, estimate, t0);
        let f = immagini::Sfondo {
            id: id_nuova_base(banco),
            jpg: img.jpg,
            da: None,
            luce: None,
            approvata: false,
        };
        mostra(tx, &f);
        fatte.push(json!({ "id": f.id, "src": f.src() }));
        banco.sfondi.push(f);
    }
    Ok(json!({
        "basi": fatte,
        "interrotto": interrotto,
        "spesa_sfondi_usd": banco.spesa_sfondi,
        "nota": "FERMATI ORA. Scrivi in chat che le candidate sono pronte e chiedi alla persona di \
                 sceglierne una col bottone «Usa come base» sotto la miniatura. Non chiamare \
                 varia_sfondo e non proporre la pagina finché non ha risposto.",
    }))
}

/// `varia_sfondo`: le varianti di luce di una base **approvata dalla persona**.
pub(crate) async fn varia_sfondi(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    banco: &mut Banco,
    misure: &mut Misure,
    ctx: &Contesto,
    tetto_usd: f64,
    input: &Value,
) -> Result<Value, String> {
    let sc = ctx
        .sfondi
        .as_ref()
        .ok_or("nessun modello di immagini configurato")?;
    let id_base = testo(input, "base")?.to_string();
    let base = banco
        .sfondi
        .iter()
        .find(|f| f.id == id_base && f.da.is_none())
        .cloned()
        .ok_or_else(|| format!("la base `{id_base}` non c'è: le basi vengono da genera_sfondo"))?;
    if !base.approvata {
        return Err(format!(
            "la base `{id_base}` non è approvata: la sceglie la persona col bottone «Usa come base» \
             sotto la miniatura. Chiediglielo e aspetta."
        ));
    }
    let luci: Vec<String> = input
        .get("luci")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if luci.is_empty() {
        return Err("manca `luci`: per esempio [\"tramonto\", \"sera\"]".into());
    }
    let mut fatte = Vec::new();
    let mut interrotto = None;
    for l in luci.iter().take(5) {
        // Come in genera_sfondi: quello che è già fatto (e pagato) resta, e il
        // modello lo riceve insieme al motivo per cui ci si è fermati.
        let estimate =
            match controlla_tetto_sfondi(&s.config_dir, banco, misure, sc, tetto_usd, true) {
                Ok(c) => c,
                Err(e) if fatte.is_empty() => return Err(e),
                Err(e) => {
                    interrotto = Some(e);
                    break;
                }
            };
        let t0 = std::time::Instant::now();
        let img = match immagini::varia(&ctx.http, &ctx.bfl, sc, &base.jpg, l, estimate).await {
            Ok(j) => j,
            Err(failed) => {
                let e = failed_background(s, banco, misure, sc, failed, t0);
                if fatte.is_empty() {
                    return Err(e);
                }
                interrotto = Some(e);
                break;
            }
        };
        pay_background(s, banco, misure, sc, &img, estimate, t0);
        let f = immagini::Sfondo {
            id: format!("{id_base}-{}", suffisso_luce(l)),
            jpg: img.jpg,
            da: Some(id_base.clone()),
            luce: Some(l.clone()),
            approvata: false,
        };
        mostra(tx, &f);
        fatte.push(json!({ "id": f.id, "luce": l, "src": f.src() }));
        banco.sfondi.retain(|x| x.id != f.id);
        banco.sfondi.push(f);
    }
    Ok(json!({
        "base": { "id": base.id, "src": base.src() },
        "varianti": fatte,
        "interrotto": interrotto,
        "spesa_sfondi_usd": banco.spesa_sfondi,
        "nota": "Gli oggetti stanno negli stessi punti della base in tutte le varianti. In pagina: \
                 un oggetto image per ognuna a tutta pagina (image_fit cover), il più scuro per \
                 primo e sempre pieno, gli altri sopra con bindings.opacity scalato su un tag di \
                 luce. Le immagini entrano nel progetto con proponi_modifica.",
    }))
}

/// L'id di una base nuova: unico nel progetto, non solo nella conversazione.
///
/// Era `sfondo-<n>` col contatore della conversazione, che riparte da 1 a ogni
/// socket: la seconda conversazione generava di nuovo `ai-sfondo-1.jpg`, e al
/// Salva sovrascriveva la foto di una pagina già fatta (revisione del
/// 04-11-2026). Una sigla casuale lo evita senza dover leggere `images/`.
fn id_nuova_base(banco: &Banco) -> String {
    use std::hash::{BuildHasher, Hasher};
    loop {
        // `RandomState` ha chiavi casuali per processo e per istanza: con il
        // tempo dentro, due chiamate non danno la stessa sigla.
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        let id = format!("sfondo-{:06x}", h.finish() & 0xff_ffff);
        if !banco.sfondi.iter().any(|f| f.id == id) {
            return id;
        }
    }
}

/// La luce nel nome del file: solo a-z, 0-9 e «-», al più 24 caratteri. Una
/// luce scritta a parole lunghe faceva un nome oltre i 128 caratteri che
/// `POST /api/project/images/:name` rifiuta, e la variante pagata non arrivava
/// mai al progetto.
pub(crate) fn suffisso_luce(l: &str) -> String {
    let s: String = l
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let mut s: String = s
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    s.truncate(24);
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "luce".into()
    } else {
        s
    }
}

/// La persona ha cliccato «Usa come base» in chat.
pub(crate) fn approva(banco: &mut Banco, id: &str) -> bool {
    match banco
        .sfondi
        .iter_mut()
        .find(|f| f.id == id && f.da.is_none())
    {
        Some(f) => {
            f.approvata = true;
            true
        }
        None => false,
    }
}

/// Gli sfondi che una proposta usa davvero: quelli il cui `src` compare nelle
/// sue pagine. Vanno al browser con la proposta, che li scrive nel progetto
/// all'applicazione.
pub(crate) fn sfondi_della_proposta(input: &Value, banco: &[immagini::Sfondo]) -> Value {
    let pagine = input.get("pages").map(Value::to_string).unwrap_or_default();
    Value::Array(
        banco
            .iter()
            // Solo quello che la persona ha scelto: una base approvata, o una
            // variante (che nasce solo da una base approvata). Una candidata
            // che il modello mette in pagina senza il «Usa come base» non entra.
            .filter(|f| f.approvata || f.da.is_some())
            .filter(|f| pagine.contains(&f.src()))
            .map(|f| {
                json!({ "file": f.file(),
                             "jpg": base64::engine::general_purpose::STANDARD.encode(&f.jpg) })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sfondo(id: &str, da: Option<&str>) -> immagini::Sfondo {
        immagini::Sfondo {
            id: id.into(),
            jpg: vec![1, 2, 3],
            da: da.map(str::to_string),
            luce: None,
            approvata: false,
        }
    }

    #[test]
    fn il_json_si_trova_anche_dentro_i_recinti() {
        assert_eq!(estrai_json("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(
            estrai_json("Ecco: {\"a\":{\"b\":2}} fine"),
            "{\"a\":{\"b\":2}}"
        );
        assert_eq!(estrai_json("niente"), "niente");
    }

    #[test]
    fn si_approva_solo_una_base() {
        let mut b = Banco::default();
        b.sfondi.push(sfondo("sfondo-1", None));
        b.sfondi.push(sfondo("sfondo-1-sera", Some("sfondo-1")));
        assert!(
            !approva(&mut b, "sfondo-1-sera"),
            "una variante non è una base"
        );
        assert!(!approva(&mut b, "sfondo-9"));
        assert!(approva(&mut b, "sfondo-1"));
        assert!(b.sfondi[0].approvata);
    }

    #[tokio::test]
    async fn varia_rifiuta_una_base_non_approvata() {
        let mut b = Banco::default();
        b.sfondi.push(sfondo("sfondo-1", None));
        let ctx = Contesto {
            opzioni: tools::Opzioni {
                disegna_simboli: false,
                sfondi: true,
                no_snapshot: false,
            },
            simboli: None,
            sfondi: Some(openai_choice()),
            http: reqwest::Client::new(),
            symbols_http: reqwest::Client::new(),
            bfl: bfl::Endpoint::default(),
        };
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut m = Misure::nuove();
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        let e = varia_sfondi(
            &s,
            &tx,
            &mut b,
            &mut m,
            &ctx,
            10.0,
            &json!({ "base": "sfondo-1", "luci": ["sera"] }),
        )
        .await
        .unwrap_err();
        assert!(e.contains("non è approvata"), "{e}");
        // Nessuna chiamata, nessuna spesa.
        assert_eq!(b.spesa_sfondi, 0.0);
        assert!(spending::Record::load(&s.config_dir).months.is_empty());
    }

    fn openai_choice() -> scopi::SceltaImmagini {
        scopi::SceltaImmagini {
            fornitore: scopi::ImageProvider::OpenAi,
            chiave: "x".into(),
            modello: "gpt-image-2".into(),
            qualita: "medium".into(),
            tetto_usd: 1.0,
        }
    }

    /// A background that was made is counted in three places: the cap of the
    /// purpose, the cap of the conversation, the history of the installation.
    /// FLUX says what it cost; OpenAI does not, and the estimate stands.
    #[tokio::test]
    async fn a_background_enters_both_caps_and_the_history() {
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        let t0 = std::time::Instant::now();

        let flux = scopi::SceltaImmagini {
            fornitore: scopi::ImageProvider::Bfl,
            modello: "flux-2-pro".into(),
            ..openai_choice()
        };
        let estimate = controlla_tetto_sfondi(&s.config_dir, &b, &m, &flux, 10.0, true).unwrap();
        assert!((estimate - 0.075).abs() < 1e-9, "an edit pays the base too");
        let settled = immagini::Generated {
            jpg: vec![],
            settled_usd: Some(0.06),
        };
        pay_background(&s, &mut b, &mut m, &flux, &settled, estimate, t0);
        assert!(
            (b.spesa_sfondi - 0.06).abs() < 1e-9,
            "the settled cost wins"
        );

        let openai = openai_choice();
        let estimate = controlla_tetto_sfondi(&s.config_dir, &b, &m, &openai, 10.0, false).unwrap();
        let unsettled = immagini::Generated {
            jpg: vec![],
            settled_usd: None,
        };
        pay_background(&s, &mut b, &mut m, &openai, &unsettled, estimate, t0);
        assert!((b.spesa_sfondi - 0.13).abs() < 1e-9);
        assert!((m.costo_usd - 0.13).abs() < 1e-9);

        let r = spending::Record::load(&s.config_dir);
        let month = &r.months[&spending::current_month()]["sfondi"];
        assert!((month["bfl"].usd - 0.06).abs() < 1e-9);
        assert_eq!(month["bfl"].calls, 1);
        assert!((month["openai"].usd - 0.07).abs() < 1e-9);

        // The cap of the purpose counts FLUX's estimate before the call.
        b.spesa_sfondi = 0.95;
        let e = controlla_tetto_sfondi(&s.config_dir, &b, &m, &flux, 10.0, true).unwrap_err();
        assert!(e.contains("tetto degli sfondi"), "{e}");
        assert!(controlla_tetto_sfondi(&s.config_dir, &b, &m, &flux, 10.0, false).is_ok());
    }

    fn flux_context(at: bfl::Endpoint, cap_usd: f64) -> Contesto {
        Contesto {
            opzioni: tools::Opzioni {
                disegna_simboli: false,
                sfondi: true,
                no_snapshot: false,
            },
            simboli: None,
            sfondi: Some(scopi::SceltaImmagini {
                fornitore: scopi::ImageProvider::Bfl,
                modello: "flux-2-pro".into(),
                tetto_usd: cap_usd,
                ..openai_choice()
            }),
            http: reqwest::Client::new(),
            symbols_http: reqwest::Client::new(),
            bfl: at,
        }
    }

    /// BFL accepts the task, says its cost, and never finishes: every attempt
    /// is a paid task. It has to enter the cap of the purpose, or the model
    /// could ask again without end, and the history, or nobody would see it.
    #[tokio::test]
    async fn a_flux_task_that_never_ends_is_counted_and_trips_the_cap() {
        let (at, fake) = bfl::fake::start(bfl::fake::Script::NeverReady).await;
        // Each task is declared at 0.045 $: the cap leaves room for two.
        let ctx = flux_context(at, 0.10);
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        let input = json!({ "descrizione": "a lake" });

        for attempt in 1..=2u32 {
            let e = genera_sfondi(&s, &tx, &mut b, &mut m, &ctx, 10.0, &input)
                .await
                .unwrap_err();
            assert!(e.contains("did not finish"), "{e}");
            assert!(e.contains("0.045 $ are counted"), "{e}");
            let spent = 0.045 * f64::from(attempt);
            assert!((b.spesa_sfondi - spent).abs() < 1e-9);
            assert!((m.costo_usd - spent).abs() < 1e-9);
        }
        assert!(b.sfondi.is_empty(), "no image arrived");
        let r = spending::Record::load(&s.config_dir);
        let cell = r.months[&spending::current_month()]["sfondi"]["bfl"];
        assert_eq!(cell.calls, 2);
        assert!((cell.usd - 0.09).abs() < 1e-9);

        // The third attempt stops at the cap, before reaching BFL.
        let e = genera_sfondi(&s, &tx, &mut b, &mut m, &ctx, 10.0, &input)
            .await
            .unwrap_err();
        assert!(e.contains("tetto degli sfondi"), "{e}");
        assert_eq!(fake.submits.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    /// A request BFL never accepted costs nothing, and is not counted.
    #[tokio::test]
    async fn a_refused_flux_request_is_not_counted() {
        let (at, _fake) = bfl::fake::start(bfl::fake::Script::Refused(402)).await;
        let ctx = flux_context(at, 1.0);
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        let input = json!({ "descrizione": "a lake" });
        let e = genera_sfondi(&s, &tx, &mut b, &mut m, &ctx, 10.0, &input)
            .await
            .unwrap_err();
        assert!(e.contains("credits are finished"), "{e}");
        assert!(!e.contains("counted"), "{e}");
        assert_eq!(b.spesa_sfondi, 0.0);
        assert_eq!(m.costo_usd, 0.0);
        assert!(spending::Record::load(&s.config_dir).months.is_empty());
    }

    #[test]
    fn la_proposta_porta_solo_gli_sfondi_che_usa_e_che_la_persona_ha_scelto() {
        let mut approvata = sfondo("sfondo-2", None);
        approvata.approvata = true;
        let b = vec![
            sfondo("sfondo-1", None),
            approvata,
            sfondo("sfondo-2-sera", Some("sfondo-2")),
        ];
        let input = json!({ "pages": [{ "objects": [
            { "type": "image", "src": "/api/project/images/ai-sfondo-1.jpg" },
            { "type": "image", "src": "/api/project/images/ai-sfondo-2.jpg" },
            { "type": "image", "src": "/api/project/images/ai-sfondo-2-sera.jpg" } ] }] });
        let v = sfondi_della_proposta(&input, &b);
        let file: Vec<_> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["file"].as_str().unwrap())
            .collect();
        // sfondo-1 è una candidata mai approvata: non entra anche se è in pagina.
        assert_eq!(file, ["ai-sfondo-2.jpg", "ai-sfondo-2-sera.jpg"]);
    }

    #[test]
    fn le_basi_hanno_un_id_che_non_si_ripete_fra_conversazioni() {
        let a = id_nuova_base(&Banco::default());
        let b = id_nuova_base(&Banco::default());
        assert!(
            a.starts_with("sfondo-") && a.len() == "sfondo-".len() + 6,
            "{a}"
        );
        assert_ne!(a, b, "due conversazioni nuove non danno lo stesso id");
    }

    #[test]
    fn la_luce_nel_nome_del_file_e_corta_e_pulita() {
        assert_eq!(suffisso_luce("sera"), "sera");
        assert_eq!(suffisso_luce("Alba d'estate!"), "alba-d-estate");
        let lunga =
            suffisso_luce("late afternoon golden light with long soft shadows across the meadow");
        assert!(lunga.len() <= 24 && !lunga.ends_with('-'), "{lunga}");
        assert_eq!(suffisso_luce("!!!"), "luce");
    }
}
