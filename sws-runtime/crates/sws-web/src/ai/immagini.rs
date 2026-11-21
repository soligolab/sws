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
//! Fino al 20-11-2026 sempre 1536×1024; da allora la misura dell'area della
//! pagina, o una volta e mezza, nei due versi se serve (`ai/background_size.rs`,
//! piano `docs/plans/2026-11-20-sfondi-alla-misura-della-pagina.md`). Le
//! funzioni qui ricevono la misura da chiedere al fornitore; il taglio alla
//! misura finale lo fa chi le chiama. In pagina l'immagine copre l'area con
//! `cover` sul web e su LVGL (`sws-lvgl-viewer/src/svg_assets.rs`).
//!
//! # Two providers (G5, 16-11-2026)
//!
//! Black Forest Labs (FLUX.2, `ai/bfl.rs`) next to OpenAI: same two steps, same
//! fixed prompts, so a page does not change when the provider does.

use base64::Engine as _;
use serde_json::{json, Value};

use crate::ai::background_size::{nearest_fixed, Facing};
use crate::ai::bfl;
use crate::ai::scopi::{ImageProvider, SceltaImmagini};

/// The size the OpenAI prices of the list are for: 1536×1024, the one size of
/// the backgrounds until 20-11-2026.
const OPENAI_PRICED_PIXELS: f64 = 1536.0 * 1024.0;

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

/// The estimate of one image of `w × h` (the size asked to the provider) with
/// the chosen provider; `edit` = an edit of a base (FLUX bills the input image
/// too). The price list file first (`price_list`), then the tables of this
/// module and of `bfl`. OpenAI prices by quality for 1536×1024: a larger image
/// is counted in proportion, a smaller one at that price, by excess.
pub fn estimated_usd(
    config_dir: &std::path::Path,
    s: &SceltaImmagini,
    edit: bool,
    (w, h): (u32, u32),
) -> f64 {
    match s.fornitore {
        ImageProvider::OpenAi => {
            crate::ai::price_list::openai_image_usd(config_dir, &s.qualita)
                * (w as f64 * h as f64 / OPENAI_PRICED_PIXELS).max(1.0)
        }
        ImageProvider::Bfl => bfl::estimate_with(
            crate::ai::price_list::bfl_prices(config_dir, &s.modello),
            w,
            h,
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

/// Una base nuova: `descrizione` (più le regole `sfondi` del progetto) → JPEG
/// di circa `size` (the size asked to the provider, `background_size`).
/// `estimate` is what the cap counted: a FLUX failure that does not say what
/// it charged is charged that.
pub async fn genera(
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    s: &SceltaImmagini,
    descrizione: &str,
    regole: Option<&str>,
    estimate: f64,
    size: (u32, u32),
) -> Result<Generated, Failed> {
    let mut prompt = format!("{}{DA_SFONDO}", descrizione.trim());
    if let Some(r) = regole {
        prompt.push_str(&format!(" Project rules: {r}"));
    }
    if s.fornitore == ImageProvider::Bfl {
        return bfl::generate(bfl_at, &s.chiave, &s.modello, &prompt, None, size.0, size.1)
            .await
            .map(Generated::from)
            .map_err(|f| Failed::from_bfl(f, estimate));
    }
    with_fixed_size_fallback(size, |(w, h)| {
        let corpo = json!({
            "model": s.modello, "prompt": prompt, "size": format!("{w}x{h}"),
            "quality": s.qualita, "n": 1, "output_format": "jpeg", "output_compression": 85,
        });
        async move {
            let r = http
                .post("https://api.openai.com/v1/images/generations")
                .bearer_auth(&s.chiave)
                .json(&corpo)
                .send()
                .await
                .map_err(|e| format!("OpenAI non raggiungibile: {e}"))?;
            immagine_da(r).await
        }
    })
    .await
    .map(openai)
    .map_err(Failed::free)
}

/// What a photo for a symbol is (plan `2026-11-21-simboli-fase-3-foto`): one
/// object, whole, that the symbol draws its live parts over.
const DA_SIMBOLO: &str = " A photograph of one single industrial object, to be used as a symbol on a \
    supervision screen: the whole object, centred, nothing cut off, seen from the front, even soft \
    light, no shadow on the ground. No text, no labels, no logos, no people, no watermark.";

/// A photo for a project symbol: `descrizione` → a PNG with a transparent
/// background from the OpenAI models that can (`supports_transparency`), a JPEG
/// on a plain light grey from the others and from Black Forest Labs (FLUX can't
/// make transparency). The bytes as the provider sends them.
pub async fn genera_foto_simbolo(
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    s: &SceltaImmagini,
    descrizione: &str,
    estimate: f64,
    size: (u32, u32),
) -> Result<Generated, Failed> {
    if s.fornitore == ImageProvider::Bfl {
        let prompt = format!(
            "{}{DA_SIMBOLO} On a plain flat light grey background.",
            descrizione.trim()
        );
        return bfl::generate(bfl_at, &s.chiave, &s.modello, &prompt, None, size.0, size.1)
            .await
            .map(Generated::from)
            .map_err(|f| Failed::from_bfl(f, estimate));
    }
    let ask = |transparent: bool| {
        let prompt = if transparent {
            format!("{}{DA_SIMBOLO} Transparent background.", descrizione.trim())
        } else {
            format!(
                "{}{DA_SIMBOLO} On a plain flat light grey background.",
                descrizione.trim()
            )
        };
        with_fixed_size_fallback(size, move |(w, h)| {
            let mut corpo = json!({
                "model": s.modello, "prompt": prompt, "size": format!("{w}x{h}"),
                "quality": s.qualita, "n": 1,
            });
            // The extension of the saved file tells the IDE which of the two it
            // got (`ai_photo`): a PNG is the transparent one.
            if transparent {
                corpo["output_format"] = json!("png");
                corpo["background"] = json!("transparent");
            } else {
                corpo["output_format"] = json!("jpeg");
            }
            async move {
                let r = http
                    .post("https://api.openai.com/v1/images/generations")
                    .bearer_auth(&s.chiave)
                    .json(&corpo)
                    .send()
                    .await
                    .map_err(|e| format!("OpenAI non raggiungibile: {e}"))?;
                immagine_da(r).await
            }
        })
    };
    let first = supports_transparency(&s.modello);
    let r = match ask(first).await {
        // A model that turned out not to know (test of 2.26.0-rc.23, 21-11-2026:
        // `gpt-image-2` answers 400 «Transparent background is not supported for
        // this model»): once more, on grey.
        Err(e) if first && refuses_transparency(&e) => {
            tracing::info!("OpenAI refused the transparent background, asking it on grey: {e}");
            ask(false).await
        }
        r => r,
    };
    r.map(openai).map_err(Failed::free)
}

/// The OpenAI image models that can make a transparent background: the
/// `gpt-image-1` family. `gpt-image-2`, the default since 20-11-2026, cannot.
fn supports_transparency(model: &str) -> bool {
    model.starts_with("gpt-image-1")
}

fn refuses_transparency(error: &str) -> bool {
    let e = error.to_ascii_lowercase();
    e.contains("transparent") && e.contains("not supported")
}

/// Una variante di luce di una base: la base va come immagine da modificare,
/// alla sua stessa misura.
pub async fn varia(
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    s: &SceltaImmagini,
    base_jpg: &[u8],
    nome_luce: &str,
    estimate: f64,
    size: (u32, u32),
) -> Result<Generated, Failed> {
    let prompt = format!("{STESSA_SCENA} {}", luce(nome_luce));
    edit(http, bfl_at, s, base_jpg, &prompt, estimate, size).await
}

/// The fixed prompt of the twin: the same scene for the other orientation
/// (plan of 20-11-2026, «due immagini, una per verso»).
fn same_scene_turned(facing: Facing) -> String {
    let frame = match facing {
        Facing::Landscape => "a landscape (wider than tall)",
        Facing::Portrait => "a portrait (taller than wide)",
    };
    format!(
        "Recompose exactly this scene for {frame} frame: the same place, the same objects with the \
         same look, the same style, light and colors. Show more of the scene where the new frame \
         needs it; never stretch, squash or crop the main elements. No text, no signs, no logos, \
         no people, no watermark."
    )
}

/// The twin of a base: the same scene, recomposed for the other orientation
/// at `size` (an edit of the base, so the place and the objects stay).
pub async fn ricomponi(
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    s: &SceltaImmagini,
    base_jpg: &[u8],
    facing: Facing,
    estimate: f64,
    size: (u32, u32),
) -> Result<Generated, Failed> {
    let prompt = same_scene_turned(facing);
    edit(http, bfl_at, s, base_jpg, &prompt, estimate, size).await
}

/// An edit of `base_jpg` with `prompt`, at `size`.
async fn edit(
    http: &reqwest::Client,
    bfl_at: &bfl::Endpoint,
    s: &SceltaImmagini,
    base_jpg: &[u8],
    prompt: &str,
    estimate: f64,
    size: (u32, u32),
) -> Result<Generated, Failed> {
    if s.fornitore == ImageProvider::Bfl {
        return bfl::generate(
            bfl_at,
            &s.chiave,
            &s.modello,
            prompt,
            Some(base_jpg),
            size.0,
            size.1,
        )
        .await
        .map(Generated::from)
        .map_err(|f| Failed::from_bfl(f, estimate));
    }
    with_fixed_size_fallback(size, |(w, h)| {
        let confine = format!("sws{}", crate::ai::uuid_breve());
        let size_field = format!("{w}x{h}");
        let mut corpo: Vec<u8> = Vec::new();
        for (k, v) in [
            ("model", s.modello.as_str()),
            ("prompt", prompt),
            ("size", size_field.as_str()),
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
        async move {
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
                .map_err(|e| format!("OpenAI non raggiungibile: {e}"))?;
            immagine_da(r).await
        }
    })
    .await
    .map(openai)
    .map_err(Failed::free)
}

/// OpenAI's answer to a size it does not take: a 400 that names it.
fn refuses_size(e: &str) -> bool {
    e.contains("(400)") && e.to_lowercase().contains("size")
}

/// One OpenAI request at `size`, and once more at its closest fixed size if
/// OpenAI refuses the size: a model or an account that takes only the three
/// fixed sizes. A 400 costs nothing.
async fn with_fixed_size_fallback<F, Fut>(size: (u32, u32), call: F) -> Result<Vec<u8>, String>
where
    F: Fn((u32, u32)) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, String>>,
{
    match call(size).await {
        Err(e) if refuses_size(&e) && nearest_fixed(size.0, size.1) != size => {
            tracing::info!(
                "OpenAI refused {}x{}, asking a fixed size: {e}",
                size.0,
                size.1
            );
            call(nearest_fixed(size.0, size.1)).await
        }
        r => r,
    }
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
    /// The size of the file (`background_size::fit`).
    pub w: u32,
    pub h: u32,
    /// The same base or variant in the other orientation, when the person
    /// asked for both: ids end in `-landscape` and `-portrait`.
    pub twin: Option<String>,
}

impl Sfondo {
    /// Il file nel progetto, all'applicazione della proposta.
    pub fn file(&self) -> String {
        format!("ai-{}.jpg", self.id)
    }
    pub fn src(&self) -> String {
        format!("/api/project/images/{}", self.file())
    }
    pub fn facing(&self) -> Facing {
        Facing::of(self.w, self.h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test of 2.26.0-rc.23 (21-11-2026): «Genera foto» always failed with the
    /// default model, which cannot make a transparent background.
    #[test]
    fn only_the_gpt_image_1_family_is_asked_for_transparency() {
        assert!(supports_transparency("gpt-image-1"));
        assert!(supports_transparency("gpt-image-1-mini"));
        assert!(supports_transparency("gpt-image-1.5"));
        assert!(!supports_transparency("gpt-image-2"));
        let refused =
            "OpenAI ha rifiutato (400): Transparent background is not supported for this model.";
        assert!(refuses_transparency(refused));
        assert!(!refuses_size(refused), "not mistaken for a refused size");
        assert!(!refuses_transparency("OpenAI ha rifiutato (400): Invalid size"));
    }

    #[test]
    fn the_twin_keeps_the_scene_and_names_the_frame() {
        let p = same_scene_turned(Facing::Portrait);
        assert!(
            p.starts_with("Recompose exactly this scene for a portrait"),
            "{p}"
        );
        assert!(same_scene_turned(Facing::Landscape).contains("landscape"));
        assert!(refuses_size(
            "OpenAI ha rifiutato (400): Invalid size '816x1248'"
        ));
        assert!(!refuses_size("OpenAI ha rifiutato (401): bad key"));
    }

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
            w: 600,
            h: 930,
            twin: None,
        };
        assert_eq!(s.src(), "/api/project/images/ai-sfondo-2-sera.jpg");
        assert_eq!(s.facing(), Facing::Portrait);
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
        let wide = (1536, 1024);
        assert_eq!(estimated_usd(d, &s, false, wide), costo_stimato("high"));
        assert_eq!(estimated_usd(d, &s, true, wide), costo_stimato("high"));
        // OpenAI: by excess, a smaller image at the price of 1536×1024, a
        // larger one in proportion.
        assert_eq!(
            estimated_usd(d, &s, false, (816, 1248)),
            costo_stimato("high")
        );
        let big = estimated_usd(d, &s, false, (2560, 1440));
        assert!((big - costo_stimato("high") * 2560.0 * 1440.0 / (1536.0 * 1024.0)).abs() < 1e-9);
        // FLUX has no quality: megapixels, and an edit pays the base too.
        s.fornitore = ImageProvider::Bfl;
        s.modello = "flux-2-pro".into();
        assert!((estimated_usd(d, &s, false, wide) - 0.045).abs() < 1e-9);
        assert!((estimated_usd(d, &s, false, (816, 1248)) - 0.03).abs() < 1e-9);
        assert!(estimated_usd(d, &s, true, wide) > estimated_usd(d, &s, false, wide));
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
            (1024, 1536),
        )
        .await
        .unwrap()
        .jpg;
        assert_eq!(&base[..3], &[0xFF, 0xD8, 0xFF], "dev'essere un JPEG");
        let sera = varia(
            &http,
            &bfl_at,
            &s,
            &base,
            "sera",
            costo_stimato("low"),
            (1024, 1536),
        )
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
