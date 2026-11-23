//! Gli strumenti che usano **un altro modello** (F5 e F6 del piano
//! `docs/archive/2026-11-04-un-modello-per-ogni-scopo.md`): `disegna_simbolo` col
//! modello dei simboli, `genera_sfondo` e `varia_sfondo` col modello delle
//! immagini. Vivono nel ciclo della chat come `bozza_simbolo`, perché scrivono
//! nel banco della conversazione e la loro spesa conta nel suo tetto.

use base64::Engine as _;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::background_size::{self, Facing, Scale};
use super::{
    bfl, client, floor_plan_tool, immagini, local_http, scopi, spending, symbol_draw, tools, Banco,
    Misure,
};
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
                simbolo: false,
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
    let istruzioni = symbol_draw::system(s).await?;
    // In the symbol editor the drawing can start from the open symbol
    // (23-11-2026): the same request as the editor's AI tab made, and only the
    // photos it already had may stay.
    let aperto: Option<sws_core::simboli_prj::Descrizione> =
        if input.get("dal_simbolo_aperto").and_then(Value::as_bool) == Some(true) {
            let v = banco
                .simbolo_aperto
                .as_ref()
                .ok_or("l'editor non ha mandato il simbolo aperto: disegna da zero")?;
            Some(
                serde_json::from_value(v.clone())
                    .map_err(|e| format!("il simbolo aperto non si legge: {e}"))?,
            )
        } else {
            None
        };
    let richiesta = match &aperto {
        Some(d) => format!("{}\n{misure_dette}\n{cosa}", symbol_draw::edit_text(d)),
        None => format!(
            "Disegna questo simbolo.\nslug: {slug}\nit: {it}\nen: {en}\n{misure_dette}\n{cosa}"
        ),
    };
    let messaggi = vec![json!({ "role": "user", "content": richiesta })];
    // Slug ed etichette sono quelli chiesti dall'assistente: il modello dei
    // simboli disegna, non rinomina.
    let mut fissi = serde_json::Map::new();
    fissi.insert("slug".into(), json!(slug));
    fissi.insert("it".into(), json!(it));
    fissi.insert("en".into(), json!(en));
    let mut conto = ContoChat {
        tx,
        spesa_simboli: &mut banco.spesa_simboli,
        misure,
        tetto_usd,
        tetto_simboli: sc.tetto_usd,
        modello: &sc.modello,
    };
    match symbol_draw::draw(
        s,
        &ctx.symbols_http,
        sc,
        &istruzioni,
        messaggi,
        &fissi,
        &mut conto,
    )
    .await
    {
        Ok(fatto) => {
            let fatto = match &aperto {
                Some(a) => symbol_draw::keep_known_photos(fatto, &symbol_draw::photos_of(a)),
                None => fatto,
            };
            let (d, c) = (fatto.description, fatto.compiled);
            invia(
                tx,
                json!({ "t": "simbolo", "slug": d.slug, "it": d.it,
                              "en": d.en, "svg": c.svg }),
            );
            let mut esito = tools::esito_bozza(&c);
            esito["disegnato_da"] = json!(sc.modello);
            esito["tentativi"] = json!(fatto.attempts);
            banco.metti(d);
            Ok(esito)
        }
        Err(symbol_draw::DrawError::Stopped(m)) => Err(m),
        Err(symbol_draw::DrawError::Provider(e)) => {
            Err(format!("il modello dei simboli non risponde: {e}"))
        }
        Err(symbol_draw::DrawError::Invalid(ultimi)) => Err(format!(
            "il modello dei simboli non ci è riuscito in {} tentativi. Ultimi errori: {}",
            symbol_draw::ATTEMPTS,
            ultimi.join("; ")
        )),
    }
}

/// I conti di `disegna_simbolo` nella chat: il tetto della conversazione,
/// quello dello scopo «simboli», e il frame `risorse_extra` a ogni chiamata.
struct ContoChat<'a> {
    tx: &'a mpsc::UnboundedSender<String>,
    spesa_simboli: &'a mut f64,
    misure: &'a mut Misure,
    tetto_usd: f64,
    tetto_simboli: f64,
    modello: &'a str,
}

impl symbol_draw::Meter for ContoChat<'_> {
    fn may_call(&self) -> Result<(), String> {
        if self.misure.costo_usd >= self.tetto_usd {
            return Err(format!(
                "tetto di spesa raggiunto ({:.2} $ su {:.2} $): il simbolo non si disegna",
                self.misure.costo_usd, self.tetto_usd
            ));
        }
        // Il tetto dello scopo «simboli», se ne ha uno suo: era salvato e
        // mostrato nel menù, e nessuno lo guardava.
        if *self.spesa_simboli >= self.tetto_simboli {
            return Err(format!(
                "tetto del disegno dei simboli raggiunto ({:.2} $ su {:.2} $). Alzalo in IA → Un modello per scopo",
                self.spesa_simboli, self.tetto_simboli
            ));
        }
        Ok(())
    }

    fn paid(&mut self, costo: f64, uso: &Value, secondi: f64) {
        self.misure.giro(uso, costo, secondi);
        *self.spesa_simboli += costo;
        invia(
            self.tx,
            json!({ "t": "risorse_extra", "costo": costo, "speso": self.misure.costo_usd,
                          "chi": self.modello }),
        );
    }
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
    size: (u32, u32),
) -> Result<f64, String> {
    let costo = immagini::estimated_usd(config_dir, sc, edit, size);
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

/// The frame of one image in the chat. `twin_of`: this one is the other
/// orientation of that base or variant, shown next to it without its own
/// «Usa come base».
fn mostra(tx: &mpsc::UnboundedSender<String>, f: &immagini::Sfondo, twin_of: Option<&str>) {
    invia(
        tx,
        json!({ "t": "sfondo", "id": f.id, "base": f.da.is_none(), "luce": f.luce,
                "approvata": f.approvata, "w": f.w, "h": f.h, "facing": f.facing(),
                "twin_of": twin_of,
                "jpg": base64::engine::general_purpose::STANDARD.encode(&f.jpg) }),
    );
}

/// What the model is told when it calls `genera_sfondo` without the two
/// choices of the person.
const ASK_THE_CHOICES: &str = "mancano `size` e `both_orientations`: li sceglie la persona. Se \
    non li ha già detti, chiediglieli con fai_domande (misura esatta dell'area o una volta e mezza; \
    anche col progetto girato, cioè due immagini) e chiama genera_sfondo dopo la risposta.";

/// The image from the provider at its final size (`background_size::fit`),
/// off the async threads.
async fn to_final(jpg: Vec<u8>, (w, h): (u32, u32)) -> Result<(Vec<u8>, u32, u32), String> {
    tokio::task::spawn_blocking(move || background_size::fit(&jpg, w, h))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("the image that arrived does not read ({e}); it is paid all the same"))
}

/// What the model receives of one image.
fn described(f: &immagini::Sfondo) -> Value {
    json!({ "id": f.id, "src": f.src(), "w": f.w, "h": f.h, "facing": f.facing() })
}

/// One image asked to the provider and brought to its final size: the cap
/// checked before, the cost counted after (also for a FLUX task that failed
/// once accepted). Returns the provider's image, the final one and its size;
/// `Err` is what the model is told.
#[allow(clippy::too_many_arguments)]
async fn one_image<F, Fut>(
    s: &AppState,
    banco: &mut Banco,
    misure: &mut Misure,
    sc: &scopi::SceltaImmagini,
    tetto_usd: f64,
    edit: bool,
    final_size: (u32, u32),
    call: F,
) -> Result<(Vec<u8>, Vec<u8>, u32, u32), String>
where
    F: FnOnce(f64, (u32, u32)) -> Fut,
    Fut: std::future::Future<Output = Result<immagini::Generated, immagini::Failed>>,
{
    let request =
        background_size::request_size(sc.fornitore, &sc.modello, final_size.0, final_size.1);
    let estimate =
        controlla_tetto_sfondi(&s.config_dir, banco, misure, sc, tetto_usd, edit, request)?;
    let t0 = std::time::Instant::now();
    let img = match call(estimate, request).await {
        Ok(img) => img,
        Err(failed) => return Err(failed_background(s, banco, misure, sc, failed, t0)),
    };
    pay_background(s, banco, misure, sc, &img, estimate, t0);
    let raw = img.jpg.clone();
    let (jpg, w, h) = to_final(img.jpg, final_size).await?;
    Ok((raw, jpg, w, h))
}

/// A photo for a project symbol (plan `2026-11-21-simboli-fase-3-foto`), for
/// the symbol editor: outside a conversation, so with a cap and a bill of its
/// own, the ones of the «Sfondi» purpose. The bytes as the provider sent them
/// (a PNG with transparency, or a JPEG) and what it cost.
pub(crate) async fn symbol_photo(
    s: &AppState,
    sc: &scopi::SceltaImmagini,
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    description: &str,
    size: (u32, u32),
) -> Result<(Vec<u8>, f64), String> {
    let mut banco = Banco::default();
    let mut misure = Misure::nuove();
    let request = background_size::request_size(sc.fornitore, &sc.modello, size.0, size.1);
    let estimate = controlla_tetto_sfondi(
        &s.config_dir,
        &banco,
        &misure,
        sc,
        sc.tetto_usd,
        false,
        request,
    )?;
    let t0 = std::time::Instant::now();
    let img = match immagini::genera_foto_simbolo(http, bfl_at, sc, description, estimate, request)
        .await
    {
        Ok(img) => img,
        Err(failed) => {
            return Err(failed_background(
                s,
                &mut banco,
                &mut misure,
                sc,
                failed,
                t0,
            ))
        }
    };
    pay_background(s, &mut banco, &mut misure, sc, &img, estimate, t0);
    Ok((img.jpg, banco.spesa_sfondi))
}

/// `genera_sfondo`: solo basi candidate, alla misura dell'area della pagina
/// (plan of 20-11-2026); con `both_orientations` ogni base ha la sua gemella
/// per il progetto girato. La persona ne approva una in chat.
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
    let scale = input
        .get("size")
        .and_then(Value::as_str)
        .and_then(Scale::parse)
        .ok_or(ASK_THE_CHOICES)?;
    let both = input
        .get("both_orientations")
        .and_then(Value::as_bool)
        .ok_or(ASK_THE_CHOICES)?;
    let quante = input
        .get("quante")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 3);
    let page = floor_plan_tool::page_box(s, input.get("page").and_then(Value::as_str)).await?;
    let main_size = background_size::final_size(page.area(), scale);
    let twin_size = background_size::final_size(page.turned(), scale);
    let main_facing = Facing::of(main_size.0, main_size.1);
    let twin_facing = Facing::of(twin_size.0, twin_size.1);
    let regole = super::regole_del_progetto(s, "sfondi").await;
    let mut fatte = Vec::new();
    let mut interrotto = None;
    for _ in 0..quante {
        // Un errore dopo la prima immagine non butta quelle già pagate: il
        // modello le riceve, e il turno si ferma lo stesso (sono in chat).
        let made = one_image(
            s,
            banco,
            misure,
            sc,
            tetto_usd,
            false,
            main_size,
            |estimate, request| {
                immagini::genera(
                    &ctx.http,
                    &ctx.bfl,
                    sc,
                    descrizione,
                    regole.as_deref(),
                    estimate,
                    request,
                )
            },
        )
        .await;
        let (raw, jpg, w, h) = match made {
            Ok(m) => m,
            Err(e) if fatte.is_empty() => return Err(e),
            Err(e) => {
                interrotto = Some(e);
                break;
            }
        };
        let base = id_nuova_base(banco);
        let (id, twin_id) = if both {
            (
                format!("{base}-{}", main_facing.name()),
                Some(format!("{base}-{}", twin_facing.name())),
            )
        } else {
            (base, None)
        };
        let f = immagini::Sfondo {
            id,
            jpg,
            da: None,
            luce: None,
            approvata: false,
            w,
            h,
            twin: None,
        };
        mostra(tx, &f, None);
        let mut entry = described(&f);
        banco.sfondi.push(f);
        if let Some(twin_id) = twin_id {
            let main_id = banco
                .sfondi
                .last()
                .map(|f| f.id.clone())
                .unwrap_or_default();
            let made = one_image(
                s,
                banco,
                misure,
                sc,
                tetto_usd,
                true,
                twin_size,
                |estimate, request| {
                    immagini::ricomponi(
                        &ctx.http,
                        &ctx.bfl,
                        sc,
                        &raw,
                        twin_facing,
                        estimate,
                        request,
                    )
                },
            )
            .await;
            match made {
                Ok((_, jpg, w, h)) => {
                    let t = immagini::Sfondo {
                        id: twin_id.clone(),
                        jpg,
                        da: None,
                        luce: None,
                        approvata: false,
                        w,
                        h,
                        twin: Some(main_id.clone()),
                    };
                    mostra(tx, &t, Some(&main_id));
                    entry["twin"] = described(&t);
                    banco.sfondi.push(t);
                    if let Some(m) = banco.sfondi.iter_mut().find(|f| f.id == main_id) {
                        m.twin = Some(twin_id);
                    }
                }
                Err(e) => {
                    fatte.push(entry);
                    interrotto = Some(format!("the other orientation is missing: {e}"));
                    break;
                }
            }
        }
        fatte.push(entry);
    }
    Ok(json!({
        "basi": fatte,
        "interrotto": interrotto,
        "spesa_sfondi_usd": banco.spesa_sfondi,
        "nota": "FERMATI ORA. Scrivi in chat che le candidate sono pronte e chiedi alla persona di \
                 sceglierne una col bottone «Usa come base» sotto la miniatura. Non chiamare \
                 varia_sfondo e non proporre la pagina finché non ha risposto. Una base con `twin` \
                 è la stessa scena per il progetto girato: si approva con lei, e la pagina usa \
                 quella del suo verso.",
    }))
}

/// `varia_sfondo`: le varianti di luce di una base **approvata dalla persona**,
/// e della sua gemella se c'è, ognuna alla misura della sua base.
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
    let twin = base
        .twin
        .as_ref()
        .and_then(|t| banco.sfondi.iter().find(|f| &f.id == t && f.da.is_none()))
        .cloned();
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
    'luci: for l in luci.iter().take(5) {
        let suffix = suffisso_luce(l);
        let ids: Vec<String> = std::iter::once(&base)
            .chain(twin.as_ref())
            .map(|b| format!("{}-{suffix}", b.id))
            .collect();
        let mut entry: Option<Value> = None;
        for (i, from) in std::iter::once(&base).chain(twin.as_ref()).enumerate() {
            // Come in genera_sfondi: quello che è già fatto (e pagato) resta, e
            // il modello lo riceve insieme al motivo per cui ci si è fermati.
            let made = one_image(
                s,
                banco,
                misure,
                sc,
                tetto_usd,
                true,
                (from.w, from.h),
                |estimate, request| {
                    immagini::varia(&ctx.http, &ctx.bfl, sc, &from.jpg, l, estimate, request)
                },
            )
            .await;
            let (_, jpg, w, h) = match made {
                Ok(m) => m,
                Err(e) if fatte.is_empty() && entry.is_none() => return Err(e),
                Err(e) => {
                    if let Some(e) = entry.take() {
                        fatte.push(e);
                    }
                    interrotto = Some(e);
                    break 'luci;
                }
            };
            let other = ids.iter().find(|x| **x != ids[i]).cloned();
            let f = immagini::Sfondo {
                id: ids[i].clone(),
                jpg,
                da: Some(from.id.clone()),
                luce: Some(l.clone()),
                approvata: false,
                w,
                h,
                twin: other.clone(),
            };
            mostra(tx, &f, if i == 0 { None } else { Some(&ids[0]) });
            let mut d = described(&f);
            d["luce"] = json!(l);
            match entry.as_mut() {
                None => entry = Some(d),
                Some(e) => e["twin"] = d,
            }
            banco.sfondi.retain(|x| x.id != f.id);
            banco.sfondi.push(f);
        }
        // A variant whose twin did not arrive has no twin.
        if twin.is_some() && entry.as_ref().is_some_and(|e| e.get("twin").is_none()) {
            if let Some(f) = banco.sfondi.iter_mut().find(|f| f.id == ids[0]) {
                f.twin = None;
            }
        }
        fatte.extend(entry);
    }
    Ok(json!({
        "base": described(&base),
        "varianti": fatte,
        "interrotto": interrotto,
        "spesa_sfondi_usd": banco.spesa_sfondi,
        "nota": "Gli oggetti stanno negli stessi punti della base in tutte le varianti. In pagina: \
                 un oggetto image per ognuna grande come l'area libera della pagina (image_fit \
                 cover), il più scuro per primo e sempre pieno, gli altri sopra con \
                 bindings.opacity scalato su un tag di luce. Usa le immagini del verso della \
                 pagina: le gemelle (`twin`) entrano nel progetto da sole. Le immagini entrano nel \
                 progetto con proponi_modifica.",
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
/// A base with a twin (the other orientation) approves it too.
pub(crate) fn approva(banco: &mut Banco, id: &str) -> bool {
    let twin = match banco
        .sfondi
        .iter_mut()
        .find(|f| f.id == id && f.da.is_none())
    {
        Some(f) => {
            f.approvata = true;
            f.twin.clone()
        }
        None => return false,
    };
    if let Some(t) = twin {
        if let Some(f) = banco
            .sfondi
            .iter_mut()
            .find(|f| f.id == t && f.da.is_none())
        {
            f.approvata = true;
        }
    }
    true
}

/// Gli sfondi che una proposta usa davvero: quelli il cui `src` compare nelle
/// sue pagine. Vanno al browser con la proposta, che li scrive nel progetto
/// all'applicazione.
pub(crate) fn sfondi_della_proposta(input: &Value, banco: &[immagini::Sfondo]) -> Value {
    let pagine = input.get("pages").map(Value::to_string).unwrap_or_default();
    // Solo quello che la persona ha scelto: una base approvata, o una variante
    // (che nasce solo da una base approvata). Una candidata che il modello
    // mette in pagina senza il «Usa come base» non entra.
    let chosen = |f: &&immagini::Sfondo| f.approvata || f.da.is_some();
    let used: Vec<&immagini::Sfondo> = banco
        .iter()
        .filter(chosen)
        .filter(|f| pagine.contains(&f.src()))
        .collect();
    // The twin of an image the pages use comes along: it is what the page
    // shows once the project is turned (plan of 20-11-2026).
    let wanted = |f: &&immagini::Sfondo| {
        used.iter()
            .any(|u| u.id == f.id || u.twin.as_deref() == Some(f.id.as_str()))
    };
    Value::Array(
        banco
            .iter()
            .filter(chosen)
            .filter(wanted)
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
            w: 600,
            h: 930,
            twin: None,
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
                simbolo: false,
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

    /// The size of every background until 20-11-2026: 2 MP for FLUX.
    const WIDE: (u32, u32) = (1536, 1024);

    /// A project with the TY570 page of the fair: 600×1024 in portrait, a
    /// frame with bands of 30 and 64.
    async fn open_ty_project(s: &AppState, dir: &std::path::Path) {
        let p = dir.join("ty");
        std::fs::create_dir_all(p.join("synoptics")).unwrap();
        std::fs::create_dir_all(p.join("cornici")).unwrap();
        std::fs::write(
            p.join("project.yaml"),
            "meta:\n  name: ty\n  version: \"1\"\ntags: []\n",
        )
        .unwrap();
        std::fs::write(
            p.join("synoptics/Energia.yaml"),
            "id: energia\nname: Energia\nwidth: 600\nheight: 1024\ncornice: frame\nobjects: []\n",
        )
        .unwrap();
        std::fs::write(
            p.join("cornici/frame.yaml"),
            "id: frame\nnome: Frame\nlarghezza: 600\naltezza: 1024\n\
             testata: { altezza: 30, sfondo: '#1e293b' }\npiede: { altezza: 64, sfondo: '#1e293b' }\n",
        )
        .unwrap();
        *s.project_dir.write().await = Some(p);
    }

    fn size_of(jpg: &[u8]) -> (u32, u32) {
        let i = image::load_from_memory(jpg).unwrap();
        (i.width(), i.height())
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
        let estimate =
            controlla_tetto_sfondi(&s.config_dir, &b, &m, &flux, 10.0, true, WIDE).unwrap();
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
        let estimate =
            controlla_tetto_sfondi(&s.config_dir, &b, &m, &openai, 10.0, false, WIDE).unwrap();
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
        let e = controlla_tetto_sfondi(&s.config_dir, &b, &m, &flux, 10.0, true, WIDE).unwrap_err();
        assert!(e.contains("tetto degli sfondi"), "{e}");
        assert!(controlla_tetto_sfondi(&s.config_dir, &b, &m, &flux, 10.0, false, WIDE).is_ok());
    }

    fn flux_context(at: bfl::Endpoint, cap_usd: f64) -> Contesto {
        Contesto {
            opzioni: tools::Opzioni {
                disegna_simboli: false,
                sfondi: true,
                no_snapshot: false,
                simbolo: false,
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
        open_ty_project(&s, d.path()).await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        let input = json!({ "descrizione": "a lake", "page": "Energia", "size": "exact",
                            "both_orientations": false });

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
        open_ty_project(&s, d.path()).await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        let input = json!({ "descrizione": "a lake", "page": "Energia", "size": "exact",
                            "both_orientations": false });
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

    /// The model cannot skip the interview: without the two choices of the
    /// person nothing is asked and nothing is paid.
    #[tokio::test]
    async fn without_the_two_choices_nothing_is_generated() {
        let (at, fake) = bfl::fake::start(bfl::fake::Script::ReadySized).await;
        let ctx = flux_context(at, 1.0);
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        open_ty_project(&s, d.path()).await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        for input in [
            json!({ "descrizione": "a lake" }),
            json!({ "descrizione": "a lake", "size": "exact" }),
            json!({ "descrizione": "a lake", "size": "huge", "both_orientations": true }),
        ] {
            let e = genera_sfondi(&s, &tx, &mut b, &mut m, &ctx, 10.0, &input)
                .await
                .unwrap_err();
            assert!(e.contains("fai_domande"), "{e}");
        }
        assert_eq!(fake.submits.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(b.spesa_sfondi, 0.0);
    }

    /// The TY570 in portrait: the base has the size of the area between the
    /// bands, its twin the size the area has once the project is turned, and
    /// the twin is an edit of the base.
    #[tokio::test]
    async fn a_background_has_the_size_of_the_page_and_its_twin_the_turned_one() {
        let (at, fake) = bfl::fake::start(bfl::fake::Script::ReadySized).await;
        let ctx = flux_context(at, 1.0);
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        open_ty_project(&s, d.path()).await;
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        let input = json!({ "descrizione": "a lake", "page": "Energia", "size": "exact",
                            "both_orientations": true });
        let out = genera_sfondi(&s, &tx, &mut b, &mut m, &ctx, 10.0, &input)
            .await
            .unwrap();
        assert_eq!(b.sfondi.len(), 2);
        let (main, twin) = (&b.sfondi[0], &b.sfondi[1]);
        assert!(
            main.id.ends_with("-portrait") && twin.id.ends_with("-landscape"),
            "{}",
            main.id
        );
        assert_eq!(
            main.id.trim_end_matches("-portrait"),
            twin.id.trim_end_matches("-landscape")
        );
        assert_eq!((main.w, main.h), (600, 930));
        assert_eq!(size_of(&main.jpg), (600, 930));
        assert_eq!((twin.w, twin.h), (1024, 506));
        assert_eq!(size_of(&twin.jpg), (1024, 506));
        assert_eq!(main.twin.as_deref(), Some(twin.id.as_str()));
        assert_eq!(twin.twin.as_deref(), Some(main.id.as_str()));
        // The twin was asked as an edit of the base, at the turned proportions.
        let last = fake.submitted.lock().unwrap().clone().unwrap();
        assert!(last["body"]["input_image"].is_string());
        assert_eq!(
            (
                last["body"]["width"].as_u64(),
                last["body"]["height"].as_u64()
            ),
            (Some(1424), Some(704))
        );
        assert_eq!(fake.submits.load(std::sync::atomic::Ordering::SeqCst), 2);
        // The model is told both; the chat shows the twin next to its base.
        assert_eq!(out["basi"][0]["facing"], "portrait");
        assert_eq!(out["basi"][0]["twin"]["facing"], "landscape");
        let frames: Vec<Value> = std::iter::from_fn(|| rx.try_recv().ok())
            .map(|m| serde_json::from_str(&m).unwrap())
            .filter(|v: &Value| v["t"] == "sfondo")
            .collect();
        assert_eq!(frames.len(), 2);
        assert!(frames[0]["twin_of"].is_null());
        assert_eq!(frames[1]["twin_of"], json!(main.id));
        assert_eq!(
            (frames[1]["w"].as_u64(), frames[1]["h"].as_u64()),
            (Some(1024), Some(506))
        );

        // «Usa come base» on one approves both; a light is made for both.
        let main_id = main.id.clone();
        assert!(approva(&mut b, &main_id));
        assert!(b.sfondi.iter().all(|f| f.approvata));
        let out = varia_sfondi(
            &s,
            &tx,
            &mut b,
            &mut m,
            &ctx,
            10.0,
            &json!({ "base": main_id, "luci": ["sera"] }),
        )
        .await
        .unwrap();
        let sera: Vec<_> = b
            .sfondi
            .iter()
            .filter(|f| f.luce.as_deref() == Some("sera"))
            .collect();
        assert_eq!(sera.len(), 2);
        assert_eq!(sera[0].id, format!("{main_id}-sera"));
        assert_eq!((sera[0].w, sera[0].h), (600, 930));
        assert_eq!((sera[1].w, sera[1].h), (1024, 506));
        assert_eq!(sera[0].twin.as_deref(), Some(sera[1].id.as_str()));
        assert_eq!(out["varianti"][0]["twin"]["facing"], "landscape");
    }

    #[tokio::test]
    async fn larger_is_one_and_a_half_times_the_area() {
        let (at, _fake) = bfl::fake::start(bfl::fake::Script::ReadySized).await;
        let ctx = flux_context(at, 1.0);
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        open_ty_project(&s, d.path()).await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut b = Banco::default();
        let mut m = Misure::nuove();
        let input = json!({ "descrizione": "a lake", "page": "Energia", "size": "larger",
                            "both_orientations": false });
        genera_sfondi(&s, &tx, &mut b, &mut m, &ctx, 10.0, &input)
            .await
            .unwrap();
        assert_eq!(b.sfondi.len(), 1);
        assert!(
            !b.sfondi[0].id.ends_with("-portrait"),
            "one orientation: no suffix"
        );
        assert_eq!(size_of(&b.sfondi[0].jpg), (900, 1395));
    }

    #[test]
    fn the_proposal_brings_the_twin_of_what_it_uses() {
        let mut base = sfondo("sfondo-abc123-portrait", None);
        base.twin = Some("sfondo-abc123-landscape".into());
        let mut twin = sfondo("sfondo-abc123-landscape", None);
        twin.twin = Some("sfondo-abc123-portrait".into());
        let mut b = vec![base, twin, sfondo("sfondo-ffffff", None)];
        assert!(approva_in(&mut b, "sfondo-abc123-landscape"));
        assert!(b[0].approvata && b[1].approvata && !b[2].approvata);
        let input = json!({ "pages": [{ "sfondo_immagine": "/api/project/images/ai-sfondo-abc123-portrait.jpg" }] });
        let v = sfondi_della_proposta(&input, &b);
        let file: Vec<_> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["file"].as_str().unwrap())
            .collect();
        assert_eq!(
            file,
            [
                "ai-sfondo-abc123-portrait.jpg",
                "ai-sfondo-abc123-landscape.jpg"
            ]
        );
    }

    fn approva_in(sfondi: &mut Vec<immagini::Sfondo>, id: &str) -> bool {
        let mut b = Banco {
            sfondi: std::mem::take(sfondi),
            ..Banco::default()
        };
        let ok = approva(&mut b, id);
        *sfondi = b.sfondi;
        ok
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
