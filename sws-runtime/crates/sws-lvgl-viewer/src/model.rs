//! Sottoinsieme minimo dello schema `SynopticObject`/`SynopticPage` che il
//! motore LVGL sa interpretare (Fase 2 dell'MVP: rect, text, button, led,
//! slider). Parser deliberatamente tollerante — `#[serde(default)]` ovunque —
//! perché lo schema reale ha ~150 campi opzionali (vedi
//! `sws-web/src/synoptic.rs`) di cui questo motore ne conosce solo una
//! manciata: tutto il resto viene ignorato silenziosamente da serde, non
//! genera errori. Non è un mirror completo (vedi ADR 0002, "duplicazione
//! accettata" — questo è un terzo sottoinsieme minimo, non una copia
//! integrale del mirror TS/Rust esistente).

use serde::Deserialize;

// width/height letti (documentano lo schema reale) ma non ancora usati: la
// risoluzione di rendering è fissa a compile-time (vedi lvgl_render::HOR_RES),
// non deriva dalla pagina — v. commento su HOR_RES in lvgl_render.rs.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct SynopticPage {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub objects: Vec<SynopticObject>,
}

/// Valore grezzo di `on_value`: in TS è `boolean | string`. Confrontato con
/// il valore live del tag secondo la stessa logica di `SvgCanvas.tsx` (riga
/// ~2637): se booleano, confronto booleano; altrimenti confronto stringa.
#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum OnValue {
    Bool(bool),
    Str(String),
}

// stroke/color/font_size/text_color_by_threshold: letti per completezza dello
// schema ma non ancora disegnati (styling di dettaglio rimandato oltre l'MVP
// dei 5 tipi widget — vedi commento in lvgl_render::render_text).
#[allow(dead_code)]
#[derive(Debug, Deserialize, Default)]
pub struct SynopticObject {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub obj_type: Option<String>,

    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,

    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub color: Option<String>,

    pub tag: Option<String>,
    pub visible: Option<bool>,
    pub visible_tag: Option<String>,

    // ── text ──
    pub text: Option<String>,
    pub format: Option<String>,
    pub font_size: Option<f64>,
    pub text_color_by_threshold: Option<bool>,
    pub alarm_low: Option<f64>,
    pub warn_low: Option<f64>,
    pub warn_high: Option<f64>,
    pub alarm_high: Option<f64>,

    // ── button ──
    pub label: Option<String>,

    // ── led ──
    pub on_value: Option<OnValue>,
    pub on_color: Option<String>,
    pub off_color: Option<String>,

    // ── slider ──
    pub min: Option<f64>,
    pub max: Option<f64>,
}
