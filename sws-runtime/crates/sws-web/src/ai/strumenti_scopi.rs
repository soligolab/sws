//! Gli strumenti che usano **un altro modello** (F5 e F6 del piano
//! `docs/archive/2026-11-04-un-modello-per-ogni-scopo.md`): `disegna_simbolo` col
//! modello dei simboli, `genera_sfondo` e `varia_sfondo` col modello delle
//! immagini. Vivono nel ciclo della chat come `bozza_simbolo`, perché scrivono
//! nel banco della conversazione e la loro spesa conta nel suo tetto.

use base64::Engine as _;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::{client, immagini, prompt, scopi, tools, Banco, Misure};
use crate::router::AppState;

/// Cosa la conversazione sa fare in più, deciso all'apertura del socket.
pub(crate) struct Contesto {
    pub opzioni: tools::Opzioni,
    pub simboli: Option<client::Scelta>,
    pub sfondi: Option<scopi::SceltaImmagini>,
    pub http: reqwest::Client,
}

impl Contesto {
    pub fn da(config_dir: &std::path::Path) -> Self {
        let simboli = scopi::ha_scelta_propria(config_dir, scopi::Scopo::Simboli)
            .then(|| scopi::carica_per(config_dir, scopi::Scopo::Simboli))
            .flatten();
        let sfondi = scopi::carica_sfondi(config_dir);
        Contesto {
            opzioni: tools::Opzioni {
                disegna_simboli: simboli.is_some(),
                sfondi: sfondi.is_some(),
            },
            simboli,
            sfondi,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(300))
                .build()
                .unwrap_or_default(),
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
        let (risposta, uso) = client::chiedi_con_uso(&ctx.http, sc, &istruzioni, &messaggi, 16000)
            .await
            .map_err(|e| format!("il modello dei simboli non risponde: {e:#}"))?;
        let costo = client::costo_usd(&sc.modello, &uso);
        misure.giro(&uso, costo, t0.elapsed().as_secs_f64());
        banco.spesa_simboli += costo;
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
    banco: &Banco,
    misure: &Misure,
    sc: &scopi::SceltaImmagini,
    tetto_usd: f64,
) -> Result<f64, String> {
    let costo = immagini::costo_stimato(&sc.qualita);
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
        let costo = match controlla_tetto_sfondi(banco, misure, sc, tetto_usd) {
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
        let jpg = match immagini::genera(&ctx.http, sc, descrizione, regole.as_deref()).await {
            Ok(j) => j,
            Err(e) if fatte.is_empty() => return Err(e),
            Err(e) => {
                interrotto = Some(e);
                break;
            }
        };
        banco.spesa_sfondi += costo;
        misure.giro(
            &json!({ "immagini": 1, "qualita": sc.qualita }),
            costo,
            t0.elapsed().as_secs_f64(),
        );
        let f = immagini::Sfondo {
            id: id_nuova_base(banco),
            jpg,
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
        let costo = match controlla_tetto_sfondi(banco, misure, sc, tetto_usd) {
            Ok(c) => c,
            Err(e) if fatte.is_empty() => return Err(e),
            Err(e) => {
                interrotto = Some(e);
                break;
            }
        };
        let t0 = std::time::Instant::now();
        let jpg = match immagini::varia(&ctx.http, sc, &base.jpg, l).await {
            Ok(j) => j,
            Err(e) if fatte.is_empty() => return Err(e),
            Err(e) => {
                interrotto = Some(e);
                break;
            }
        };
        banco.spesa_sfondi += costo;
        misure.giro(
            &json!({ "immagini": 1, "qualita": sc.qualita }),
            costo,
            t0.elapsed().as_secs_f64(),
        );
        let f = immagini::Sfondo {
            id: format!("{id_base}-{}", suffisso_luce(l)),
            jpg,
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
            },
            simboli: None,
            sfondi: Some(scopi::SceltaImmagini {
                chiave: "x".into(),
                modello: "gpt-image-2".into(),
                qualita: "medium".into(),
                tetto_usd: 1.0,
            }),
            http: reqwest::Client::new(),
        };
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut m = Misure::nuove();
        let e = varia_sfondi(
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
