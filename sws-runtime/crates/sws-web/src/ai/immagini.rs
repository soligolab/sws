//! Gli sfondi delle pagine, con gpt-image-2 (F6 del piano
//! `docs/archive/2026-11-04-un-modello-per-ogni-scopo.md`).
//!
//! # I due passi, imposti qui e non solo detti nel prompt
//!
//! Il 04-11-2026 tre sfondi generati ognuno da capo avevano pensiline, condotta e
//! villaggio in punti diversi: la dissolvenza fra loro li mostrava doppi. Rifatti
//! come **modifiche** della foto del giorno restavano allo stesso posto. Quindi:
//!
//! 1. [`genera`] crea solo **basi candidate**;
//! 2. la persona ne approva una con il bottone in chat (il modello non può);
//! 3. [`varia`] parte **solo** da una base approvata e chiede di cambiare la luce,
//!    mai la scena. Non ha un parametro per «una scena nuova».
//!
//! # Il formato
//!
//! JPEG a 1536×1024, che è il formato di gpt-image-2 più vicino al 16:10 dei
//! pannelli. Non si ritaglia: l'oggetto `image` lo copre con `image_fit: cover`
//! sul web, e il viewer LVGL avvolge i raster con `preserveAspectRatio="xMidYMid
//! slice"`, che è la stessa cosa (`sws-lvgl-viewer/src/svg_assets.rs`).
//!
//! # Two providers (G5, 16-11-2026)
//!
//! Black Forest Labs (FLUX.2, `ai/bfl.rs`) next to OpenAI: same two steps, same
//! fixed prompts, same 1536×1024 JPEG (FLUX takes any size that is a multiple
//! of 16), so a page does not change when the provider does.

use base64::Engine as _;
use serde_json::{json, Value};

use crate::ai::bfl;
use crate::ai::scopi::{ImageProvider, SceltaImmagini};

pub const DIMENSIONE: &str = "1536x1024";
const WIDTH: u32 = 1536;
const HEIGHT: u32 = 1024;

/// Quanto costa un'immagine, in dollari: una **stima** per qualità, che serve
/// al tetto e non a una fattura. Per eccesso, come la tabella dei modelli di
/// testo che il prezzo non lo conosce.
pub fn costo_stimato(qualita: &str) -> f64 {
    match qualita {
        "low" => 0.02,
        "high" => 0.25,
        _ => 0.07,
    }
}

/// The estimate of one image with the chosen provider; `edit` = a variant of a
/// base (FLUX bills the input image too). The price list file first
/// (`price_list`), then the tables of this module and of `bfl`.
pub fn estimated_usd(config_dir: &std::path::Path, s: &SceltaImmagini, edit: bool) -> f64 {
    match s.fornitore {
        ImageProvider::OpenAi => crate::ai::price_list::openai_image_usd(config_dir, &s.qualita),
        ImageProvider::Bfl => bfl::estimate_with(
            crate::ai::price_list::bfl_prices(config_dir, &s.modello),
            WIDTH,
            HEIGHT,
            edit,
        ),
    }
}

/// One image, and the cost the provider settled, when it says (FLUX does).
#[derive(Debug)]
pub struct Generated {
    pub jpg: Vec<u8>,
    pub settled_usd: Option<f64>,
}

impl From<bfl::Image> for Generated {
    fn from(i: bfl::Image) -> Self {
        Generated {
            jpg: i.jpg,
            settled_usd: i.settled_usd,
        }
    }
}

fn openai(jpg: Vec<u8>) -> Generated {
    Generated {
        jpg,
        settled_usd: None,
    }
}

/// Why there is no image, and what the request cost all the same.
///
/// `charged_usd` is there when the provider had already accepted the request
/// (FLUX: the task was submitted, then it timed out, failed or could not be
/// downloaded, see `ai/bfl.rs`): the caller counts it in the caps and in the
/// spending history like an image that arrived. OpenAI answers in one call: a
/// failure there is counted as free.
#[derive(Debug)]
pub struct Failed {
    pub message: String,
    pub charged_usd: Option<f64>,
}

impl Failed {
    fn free(message: String) -> Self {
        Failed {
            message,
            charged_usd: None,
        }
    }

    /// From FLUX: the cost BFL declared, or `estimate` when it accepted the
    /// request without saying one.
    fn from_bfl(f: bfl::Failure, estimate: f64) -> Self {
        Failed {
            message: f.message,
            charged_usd: match f.charge {
                bfl::Charge::None => None,
                bfl::Charge::Declared(usd) => Some(usd),
                bfl::Charge::Unknown => Some(estimate),
            },
        }
    }
}

impl std::fmt::Display for Failed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Il prompt fisso delle varianti: stessa scena, altra luce.
const STESSA_SCENA: &str =
    "Keep exactly the same scene, camera, composition and every object in the \
    same position and size. Change only the time of day and the lighting. Photorealistic, muted \
    colors, no text, no signs, no logos, no people, no watermark.";

/// Le luci che `varia` sa chiedere. Una parola sconosciuta passa come testo
/// libero dopo il prompt fisso: il fisso, che è la regola, resta.
pub fn luce(nome: &str) -> String {
    match nome {
        "giorno" => "Clear late-morning daylight, soft diffuse light.".into(),
        "alba" => {
            "Dawn: cool pale light, pink glow behind the horizon, a few lights still on.".into()
        }
        "tramonto" => {
            "Golden hour just before sunset: warm light, longer shadows, first warm lights \
                       in a few windows."
                .into()
        }
        "sera" => {
            "Blue hour after sunset: deep blue sky, darker landscape, windows and street lamps \
                   warmly lit."
                .into()
        }
        "notte" => {
            "Night with a clear starry sky and moonlight, landscape dark, artificial lights \
                    warmly lit."
                .into()
        }
        altro => format!("Lighting: {altro}."),
    }
}

/// Le regole fisse di ogni base: è uno sfondo, non un quadro.
const DA_SFONDO: &str = " It is the background of an industrial supervision screen: all elements \
    clearly separated and fully visible, generous calm areas for overlays, soft diffuse light, \
    muted desaturated colors, low contrast. No text, no signs, no logos, no people, no watermark.";

/// Una base nuova: `descrizione` (più le regole `sfondi` del progetto) → JPEG.
/// `estimate` is what the cap counted: a FLUX failure that does not say what
/// it charged is charged that.
pub async fn genera(
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    s: &SceltaImmagini,
    descrizione: &str,
    regole: Option<&str>,
    estimate: f64,
) -> Result<Generated, Failed> {
    let mut prompt = format!("{}{DA_SFONDO}", descrizione.trim());
    if let Some(r) = regole {
        prompt.push_str(&format!(" Project rules: {r}"));
    }
    if s.fornitore == ImageProvider::Bfl {
        return bfl::generate(bfl_at, &s.chiave, &s.modello, &prompt, None, WIDTH, HEIGHT)
            .await
            .map(Generated::from)
            .map_err(|f| Failed::from_bfl(f, estimate));
    }
    let corpo = json!({
        "model": s.modello, "prompt": prompt, "size": DIMENSIONE, "quality": s.qualita,
        "n": 1, "output_format": "jpeg", "output_compression": 85,
    });
    let r = http
        .post("https://api.openai.com/v1/images/generations")
        .bearer_auth(&s.chiave)
        .json(&corpo)
        .send()
        .await
        .map_err(|e| Failed::free(format!("OpenAI non raggiungibile: {e}")))?;
    immagine_da(r).await.map(openai).map_err(Failed::free)
}

/// Una variante di luce di una base: la base va come immagine da modificare.
pub async fn varia(
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    s: &SceltaImmagini,
    base_jpg: &[u8],
    nome_luce: &str,
    estimate: f64,
) -> Result<Generated, Failed> {
    let prompt = format!("{STESSA_SCENA} {}", luce(nome_luce));
    if s.fornitore == ImageProvider::Bfl {
        return bfl::generate(
            bfl_at,
            &s.chiave,
            &s.modello,
            &prompt,
            Some(base_jpg),
            WIDTH,
            HEIGHT,
        )
        .await
        .map(Generated::from)
        .map_err(|f| Failed::from_bfl(f, estimate));
    }
    let confine = format!("sws{}", crate::ai::uuid_breve());
    let mut corpo: Vec<u8> = Vec::new();
    for (k, v) in [
        ("model", s.modello.as_str()),
        ("prompt", prompt.as_str()),
        ("size", DIMENSIONE),
        ("quality", s.qualita.as_str()),
        ("n", "1"),
        ("output_format", "jpeg"),
        ("output_compression", "85"),
    ] {
        corpo.extend_from_slice(
            format!("--{confine}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n")
                .as_bytes(),
        );
    }
    corpo.extend_from_slice(
        format!(
            "--{confine}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"base.jpg\"\r\n\
             Content-Type: image/jpeg\r\n\r\n"
        )
        .as_bytes(),
    );
    corpo.extend_from_slice(base_jpg);
    corpo.extend_from_slice(format!("\r\n--{confine}--\r\n").as_bytes());
    let r = http
        .post("https://api.openai.com/v1/images/edits")
        .bearer_auth(&s.chiave)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={confine}"),
        )
        .body(corpo)
        .send()
        .await
        .map_err(|e| Failed::free(format!("OpenAI non raggiungibile: {e}")))?;
    immagine_da(r).await.map(openai).map_err(Failed::free)
}

async fn immagine_da(r: reqwest::Response) -> Result<Vec<u8>, String> {
    let stato = r.status();
    let v: Value = r
        .json()
        .await
        .map_err(|e| format!("risposta {stato} di OpenAI illeggibile: {e}"))?;
    if !stato.is_success() {
        let msg = v
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("");
        return Err(format!("OpenAI ha rifiutato ({}): {msg}", stato.as_u16()));
    }
    let b64 = v
        .pointer("/data/0/b64_json")
        .and_then(Value::as_str)
        .ok_or("OpenAI non ha restituito un'immagine")?;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("immagine non decodificabile: {e}"))
}

/// Uno sfondo nel banco della conversazione: non tocca il progetto finché la
/// proposta non viene applicata.
#[derive(Clone, Debug)]
pub struct Sfondo {
    /// `sfondo-1`, o `sfondo-1-sera` per una variante.
    pub id: String,
    pub jpg: Vec<u8>,
    /// La base da cui viene una variante (`None` = è una base).
    pub da: Option<String>,
    pub luce: Option<String>,
    /// Solo le basi: l'ha approvata la persona, col bottone in chat.
    pub approvata: bool,
}

impl Sfondo {
    /// Il file nel progetto, all'applicazione della proposta.
    pub fn file(&self) -> String {
        format!("ai-{}.jpg", self.id)
    }
    pub fn src(&self) -> String {
        format!("/api/project/images/{}", self.file())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_varianti_cambiano_solo_la_luce() {
        for l in [
            "giorno",
            "alba",
            "tramonto",
            "sera",
            "notte",
            "nebbia mattutina",
        ] {
            let p = format!("{STESSA_SCENA} {}", luce(l));
            assert!(p.starts_with("Keep exactly the same scene"), "{p}");
        }
        assert!(luce("nebbia mattutina").contains("nebbia mattutina"));
    }

    #[test]
    fn il_file_di_uno_sfondo_sta_nelle_immagini_del_progetto() {
        let s = Sfondo {
            id: "sfondo-2-sera".into(),
            jpg: vec![],
            da: Some("sfondo-2".into()),
            luce: Some("sera".into()),
            approvata: false,
        };
        assert_eq!(s.src(), "/api/project/images/ai-sfondo-2-sera.jpg");
    }

    #[test]
    fn the_estimate_follows_the_provider() {
        let mut s = SceltaImmagini {
            fornitore: ImageProvider::OpenAi,
            chiave: "k".into(),
            modello: "gpt-image-2".into(),
            qualita: "high".into(),
            tetto_usd: 1.0,
        };
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        assert_eq!(estimated_usd(d, &s, false), costo_stimato("high"));
        assert_eq!(estimated_usd(d, &s, true), costo_stimato("high"));
        // FLUX has no quality: megapixels, and an edit pays the base too.
        s.fornitore = ImageProvider::Bfl;
        s.modello = "flux-2-pro".into();
        assert!((estimated_usd(d, &s, false) - 0.045).abs() < 1e-9);
        assert!(estimated_usd(d, &s, true) > estimated_usd(d, &s, false));
    }

    #[test]
    fn la_stima_del_costo_e_per_eccesso_e_sconosciuta_vale_media() {
        assert!(costo_stimato("high") > costo_stimato("medium"));
        assert!(costo_stimato("medium") > costo_stimato("low"));
        assert_eq!(costo_stimato("boh"), costo_stimato("medium"));
    }
}

/// La prova vera, a pagamento (circa 0,05 $ in qualità bassa): una base e una
/// sua variante. `SWS_PROVA_OPENAI_DIR=<config_dir> cargo test -p sws-web --lib
/// prova_vera_openai -- --ignored`, con la chiave in `<config_dir>/openai.key`.
#[cfg(test)]
mod prova_vera {
    use super::*;

    #[tokio::test]
    #[ignore = "chiama OpenAI e costa: SWS_PROVA_OPENAI_DIR=<config_dir>"]
    async fn prova_vera_openai() {
        let dir = std::env::var("SWS_PROVA_OPENAI_DIR").expect("SWS_PROVA_OPENAI_DIR");
        let chiave =
            crate::ai::scopi::chiave_openai(std::path::Path::new(&dir)).expect("openai.key");
        let s = SceltaImmagini {
            fornitore: ImageProvider::OpenAi,
            chiave,
            modello: "gpt-image-2".into(),
            qualita: "low".into(),
            tetto_usd: 1.0,
        };
        let http = reqwest::Client::new();
        let bfl_at = bfl::Endpoint::default();
        let base = genera(
            &http,
            &bfl_at,
            &s,
            "A small alpine lake with a wooden hut on the right.",
            None,
            costo_stimato("low"),
        )
        .await
        .unwrap()
        .jpg;
        assert_eq!(&base[..3], &[0xFF, 0xD8, 0xFF], "dev'essere un JPEG");
        let sera = varia(&http, &bfl_at, &s, &base, "sera", costo_stimato("low"))
            .await
            .unwrap()
            .jpg;
        assert_eq!(&sera[..3], &[0xFF, 0xD8, 0xFF]);
        let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tmp/sfondi");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(out.join("prova-rust-base.jpg"), &base).unwrap();
        std::fs::write(out.join("prova-rust-sera.jpg"), &sera).unwrap();
    }
}
