//! Da dove arriva l'SVG di un oggetto, e come si tiene in memoria.
//!
//! Tre sorgenti diverse finiscono nello stesso rasterizzatore
//! (`svg_raster`), e ognuna si risolve in modo suo:
//!
//! | sorgente | come si riconosce | dove sta l'SVG |
//! |---|---|---|
//! | simbolo *vendored* | `symbol_id` nella tabella qui sotto | file statico servito dal runtime |
//! | simbolo *custom*   | `symbol_id` che inizia per `custom:` | dentro il progetto, spesso inline |
//! | widget `image`     | `type == "image"` con `src` | URL, relativo al runtime o assoluto |
//!
//! I 17 simboli *builtin* non passano di qui: sono ridisegnati con primitive
//! LVGL e ricolorati per stato (Q15 opzione B). Una bitmap non saprebbe
//! cambiare colore con lo stato senza rasterizzare una variante per colore.

use std::collections::HashMap;

use crate::model::{CustomSymbol, SynopticObject};

/// I simboli *vendored*: `symbol_id` → file servito dal runtime.
///
/// **Va tenuta allineata a `SYMBOLS` in `sws-editor/src/symbols/library.tsx`**,
/// e non basta derivare il percorso dall'id: 7 voci su 11 hanno un nome file
/// diverso dall'id (`battery` → `battery-charging-high.svg`), perché i file
/// arrivano da librerie esterne e conservano il nome d'origine. Chi si fidasse
/// della convenzione otterrebbe 7 simboli muti su 11.
///
/// Il disallineamento lo intercetta `scripts/check_lvgl_symbols.sh`, che
/// confronta questa tabella con quella dell'editor e con i file su disco.
pub const VENDORED: &[(&str, &str)] = &[
    ("heat_exchanger", "/symbols/heat_exchanger.svg"),
    ("separator", "/symbols/separator.svg"),
    ("reactor", "/symbols/reactor.svg"),
    ("filter", "/symbols/filter.svg"),
    ("solar_panel", "/symbols/solar-panel.svg"),
    ("battery", "/symbols/battery-charging-high.svg"),
    ("transmission_tower", "/symbols/transmission-tower.svg"),
    ("home_lightning", "/symbols/home-lightning-bolt.svg"),
    ("garage", "/symbols/garage-open-variant.svg"),
    ("window_open", "/symbols/window-open-variant.svg"),
    ("roller_shade", "/symbols/roller-shade.svg"),
];

/// Da dove prendere i byte dell'SVG di un oggetto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SvgSource {
    /// Da scaricare dal runtime (o da un host esterno, se `src` è assoluto).
    /// La stringa è la chiave della cache **e** l'URL da chiedere.
    Url(String),
    /// Già presente nel progetto, niente da scaricare.
    Inline(String),
}

/// Decide se un oggetto ha un SVG da rasterizzare, e quale.
///
/// `None` per tutto ciò che LVGL disegna già da sé: i builtin, e qualunque
/// oggetto che non sia un simbolo o un'immagine.
pub fn source_for(obj: &SynopticObject, custom: &[CustomSymbol]) -> Option<SvgSource> {
    match obj.obj_type.as_deref().unwrap_or("") {
        "symbol" => {
            let id = obj.symbol_id.as_deref()?;
            if let Some(rest) = id.strip_prefix("custom:") {
                let sym = custom.iter().find(|s| s.id == rest)?;
                // `svg` inline vince sull'URL: è la copia che viaggia col
                // progetto, quindi funziona anche su un pannello isolato,
                // mentre l'URL potrebbe puntare a una rete che lì non c'è.
                match sym.svg.as_deref() {
                    Some(svg) if !svg.trim().is_empty() => Some(SvgSource::Inline(svg.to_string())),
                    _ if !sym.url.trim().is_empty() => Some(SvgSource::Url(sym.url.clone())),
                    _ => None,
                }
            } else {
                VENDORED.iter().find(|(k, _)| *k == id).map(|(_, p)| SvgSource::Url(p.to_string()))
            }
        }
        "image" => {
            let src = obj.src.as_deref()?.trim();
            // Un `src` che non è un SVG (png/jpg) non è un difetto da
            // segnalare qui: semplicemente non è roba per questo modulo, e
            // chi chiama disegnerà il proprio segnaposto.
            if src.is_empty() || !src.to_ascii_lowercase().contains(".svg") {
                return None;
            }
            Some(SvgSource::Url(src.to_string()))
        }
        _ => None,
    }
}

/// Rende assoluto un URL relativo rispetto al runtime.
///
/// I percorsi dei simboli e delle immagini del catalogo sono relativi
/// (`/symbols/x.svg`): il viewer LVGL non ha una "pagina corrente" da cui
/// risolverli come farebbe un browser, quindi li si aggancia esplicitamente al
/// runtime da cui si è presa la pagina.
pub fn absolutize(base_url: &str, url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("data:") {
        return url.to_string();
    }
    format!("{}/{}", base_url.trim_end_matches('/'), url.trim_start_matches('/'))
}

/// Gli SVG già scaricati, per URL assoluto.
///
/// È globale e non passata come parametro perché il rendering la consulta da
/// quattro punti di chiamata diversi (pagina, faceplate, griglia, figli), e
/// infilare due argomenti in più in tutti sarebbe stato molto rumore per uno
/// stato che è, di fatto, uno solo per processo. Sopravvive alla navigazione
/// fra pagine: tornare su una pagina già vista non riscarica niente.
static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, Option<Vec<u8>>>>> =
    std::sync::OnceLock::new();

fn cache() -> &'static std::sync::Mutex<HashMap<String, Option<Vec<u8>>>> {
    CACHE.get_or_init(Default::default)
}

/// Svuota la cache. Da chiamare quando il progetto viene sostituito (D1): un
/// simbolo custom o un'immagine possono essere cambiati sotto lo stesso URL, e
/// una cache che non se ne accorge mostrerebbe il disegno vecchio su una
/// pagina nuova — il tipo di stranezza che si dà per colpa al pannello.
pub fn invalidate() {
    cache().lock().unwrap_or_else(|e| e.into_inner()).clear();
    *simboli().lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// I simboli custom del progetto, scaricati una volta sola.
///
/// Separati dalla cache degli SVG perché hanno un ciclo di vita diverso: gli
/// SVG si prendono per URL uno a uno, questi arrivano tutti insieme dal
/// progetto. `invalidate()` li butta entrambi.
static SIMBOLI: std::sync::OnceLock<std::sync::Mutex<Option<Vec<CustomSymbol>>>> =
    std::sync::OnceLock::new();

fn simboli() -> &'static std::sync::Mutex<Option<Vec<CustomSymbol>>> {
    SIMBOLI.get_or_init(Default::default)
}

/// Come `source_for`, ma i simboli custom se li procura da sé.
///
/// Il progetto si scarica solo se un oggetto è davvero un `custom:` — una
/// pagina di soli builtin non tocca la rete.
pub fn source_for_project(
    obj: &SynopticObject,
    base_url: &str,
    rt: &tokio::runtime::Handle,
) -> Option<SvgSource> {
    let serve_progetto = obj.obj_type.as_deref() == Some("symbol")
        && obj.symbol_id.as_deref().is_some_and(|i| i.starts_with("custom:"));
    if !serve_progetto {
        return source_for(obj, &[]);
    }
    let mut guard = simboli().lock().unwrap_or_else(|e| e.into_inner());
    let elenco = guard.get_or_insert_with(|| fetch_custom_symbols(base_url, rt));
    source_for(obj, elenco)
}

/// Legge `custom_symbols` da `/api/project`.
///
/// Un fallimento non è fatale: si torna un elenco vuoto, i simboli custom
/// mostrano il segnaposto e il resto della pagina si disegna. Una pagina che
/// non compare perché un simbolo non si è scaricato sarebbe una reazione
/// sproporzionata.
fn fetch_custom_symbols(base_url: &str, rt: &tokio::runtime::Handle) -> Vec<CustomSymbol> {
    #[derive(serde::Deserialize)]
    struct Progetto {
        #[serde(default)]
        custom_symbols: Vec<CustomSymbol>,
    }
    let url = format!("{}/api/project", base_url.trim_end_matches('/'));
    let esito: Option<Vec<CustomSymbol>> = rt.block_on(async {
        let client = reqwest::Client::builder().danger_accept_invalid_certs(true).build().ok()?;
        let resp = client.get(&url).send().await.ok()?;
        resp.json::<Progetto>().await.ok().map(|p| p.custom_symbols)
    });
    match esito {
        Some(v) => v,
        None => {
            eprintln!("[svg] {url}: simboli custom non leggibili, mostreranno il segnaposto");
            Vec::new()
        }
    }
}

/// I byte dell'SVG di questa sorgente, scaricandoli se serve.
///
/// Bloccante: il rendering LVGL è sincrono, e questa è la stessa scelta che
/// `render_trend`/`render_sparkline` fanno già per lo storico. Il blocco dura
/// una richiesta HTTP verso il runtime da cui si è appena presa la pagina —
/// nella pratica localhost o la LAN.
///
/// Un fallimento viene messo in cache **come fallimento**: un URL che non
/// risponde non va richiesto di nuovo a ogni cambio pagina, e il messaggio
/// nel log si stampa una volta sola invece che a raffica.
pub fn bytes_for(
    base_url: &str,
    rt: &tokio::runtime::Handle,
    src: &SvgSource,
) -> Option<Vec<u8>> {
    let url = match src {
        SvgSource::Inline(svg) => return Some(svg.clone().into_bytes()),
        SvgSource::Url(u) => absolutize(base_url, u),
    };
    if let Some(hit) = cache().lock().unwrap_or_else(|e| e.into_inner()).get(&url) {
        return hit.clone();
    }
    let scaricato = rt.block_on(async {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true) // stesso runtime, stesso cert self-signed (vedi tls.rs)
            .build()
            .ok()?;
        let resp = client.get(&url).send().await.ok()?;
        if !resp.status().is_success() {
            eprintln!("[svg] {url}: HTTP {}", resp.status());
            return None;
        }
        resp.bytes().await.ok().map(|b| b.to_vec())
    });
    if scaricato.is_none() {
        eprintln!("[svg] {url}: non scaricato, l'oggetto mostrerà il segnaposto");
    }
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(url, scaricato.clone());
    scaricato
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(t: &str) -> SynopticObject {
        SynopticObject { obj_type: Some(t.to_string()), ..Default::default() }
    }

    fn custom_inline(id: &str, svg: &str) -> CustomSymbol {
        CustomSymbol {
            id: id.to_string(),
            svg: Some(svg.to_string()),
            url: String::new(),
            ..Default::default()
        }
    }

    #[test]
    fn un_simbolo_builtin_non_passa_di_qui() {
        let mut o = obj("symbol");
        o.symbol_id = Some("pump".into());
        assert_eq!(source_for(&o, &[]), None, "i builtin li disegna LVGL con le primitive");
    }

    /// Il caso che rompe la convenzione: 7 vendored su 11 hanno il file con un
    /// nome diverso dall'id. Derivare il percorso dall'id li lascerebbe muti.
    #[test]
    fn un_vendored_usa_il_percorso_della_tabella_non_lid() {
        let mut o = obj("symbol");
        o.symbol_id = Some("battery".into());
        assert_eq!(
            source_for(&o, &[]),
            Some(SvgSource::Url("/symbols/battery-charging-high.svg".into())),
            "il file non si chiama come l'id"
        );
    }

    #[test]
    fn un_simbolo_custom_preferisce_lsvg_inline_allurl() {
        let mut o = obj("symbol");
        o.symbol_id = Some("custom:mio".into());
        let mut c = custom_inline("mio", "<svg/>");
        c.url = "https://esterno.example/x.svg".into();
        assert_eq!(source_for(&o, &[c]), Some(SvgSource::Inline("<svg/>".into())),
                   "l'inline viaggia col progetto, l'URL richiede una rete che sul pannello può non esserci");
    }

    #[test]
    fn un_simbolo_custom_senza_inline_ripiega_sullurl() {
        let mut o = obj("symbol");
        o.symbol_id = Some("custom:mio".into());
        let c = CustomSymbol { id: "mio".into(), url: "https://e.example/x.svg".into(), svg: None, ..Default::default() };
        assert_eq!(source_for(&o, &[c]), Some(SvgSource::Url("https://e.example/x.svg".into())));
    }

    #[test]
    fn un_custom_che_non_esiste_nel_progetto_non_esplode() {
        let mut o = obj("symbol");
        o.symbol_id = Some("custom:sparito".into());
        assert_eq!(source_for(&o, &[]), None);
    }

    #[test]
    fn limmagine_passa_solo_se_e_un_svg() {
        let mut o = obj("image");
        o.src = Some("/images/equinor/cat.svg".into());
        assert_eq!(source_for(&o, &[]), Some(SvgSource::Url("/images/equinor/cat.svg".into())));
        o.src = Some("/images/foto.png".into());
        assert_eq!(source_for(&o, &[]), None, "un png non è roba per il rasterizzatore SVG");
        o.src = Some("   ".into());
        assert_eq!(source_for(&o, &[]), None);
    }

    #[test]
    fn gli_url_relativi_si_agganciano_al_runtime() {
        assert_eq!(absolutize("https://pannello:8443", "/symbols/x.svg"), "https://pannello:8443/symbols/x.svg");
        assert_eq!(absolutize("https://pannello:8443/", "symbols/x.svg"), "https://pannello:8443/symbols/x.svg");
    }

    /// L'inline non passa dalla rete: deve funzionare anche su un pannello
    /// senza connettività, che è il motivo per cui lo si preferisce all'URL.
    #[test]
    fn linline_non_richiede_la_rete() {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let b = bytes_for("https://irraggiungibile.invalid", rt.handle(), &SvgSource::Inline("<svg/>".into()));
        assert_eq!(b.as_deref(), Some(&b"<svg/>"[..]));
    }

    #[test]
    fn gli_url_assoluti_restano_intatti() {
        for u in ["https://e.example/x.svg", "http://e.example/x.svg", "data:image/svg+xml,<svg/>"] {
            assert_eq!(absolutize("https://pannello:8443", u), u, "{u} non va riscritto");
        }
    }



}
