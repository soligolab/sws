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

use base64::Engine as _;
use serde_json::{json, Value};

use crate::ai::scopi::SceltaImmagini;

pub const DIMENSIONE: &str = "1536x1024";

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
pub async fn genera(
    http: &reqwest::Client,
    s: &SceltaImmagini,
    descrizione: &str,
    regole: Option<&str>,
) -> Result<Vec<u8>, String> {
    let mut prompt = format!("{}{DA_SFONDO}", descrizione.trim());
    if let Some(r) = regole {
        prompt.push_str(&format!(" Project rules: {r}"));
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
        .map_err(|e| format!("OpenAI non raggiungibile: {e}"))?;
    immagine_da(r).await
}

/// Una variante di luce di una base: la base va come immagine da modificare.
pub async fn varia(
    http: &reqwest::Client,
    s: &SceltaImmagini,
    base_jpg: &[u8],
    nome_luce: &str,
) -> Result<Vec<u8>, String> {
    let prompt = format!("{STESSA_SCENA} {}", luce(nome_luce));
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
        .map_err(|e| format!("OpenAI non raggiungibile: {e}"))?;
    immagine_da(r).await
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
            chiave,
            modello: "gpt-image-2".into(),
            qualita: "low".into(),
            tetto_usd: 1.0,
        };
        let http = reqwest::Client::new();
        let base = genera(
            &http,
            &s,
            "A small alpine lake with a wooden hut on the right.",
            None,
        )
        .await
        .unwrap();
        assert_eq!(&base[..3], &[0xFF, 0xD8, 0xFF], "dev'essere un JPEG");
        let sera = varia(&http, &s, &base, "sera").await.unwrap();
        assert_eq!(&sera[..3], &[0xFF, 0xD8, 0xFF]);
        let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tmp/sfondi");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(out.join("prova-rust-base.jpg"), &base).unwrap();
        std::fs::write(out.join("prova-rust-sera.jpg"), &sera).unwrap();
    }
}
