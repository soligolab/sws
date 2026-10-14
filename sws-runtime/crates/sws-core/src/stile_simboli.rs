//! «Applica stile»: lo stile effettivo di un simbolo di libreria, scritto dentro
//! il suo SVG prima di rasterizzarlo.
//!
//! È il gemello di `sws-editor/src/symbols/lib/applicaStile.ts`: devono dare **lo
//! stesso testo**, byte per byte, perché web e pannello disegnano lo stesso
//! progetto. I casi stanno in `tests/fixtures/stile-simboli.json` e li verificano
//! entrambi. Piano: `docs/plans/2026-10-14-motore-simboli-lib.md`.
//!
//! Lavora sul formato che esce da `scripts/simboli/genera.py` (un tag per riga,
//! attributi fra virgolette doppie) e tocca solo gli attributi:
//! - `data-mat="m"`        → `fill` = colore del materiale m
//! - `data-mat-stroke="m"` → `stroke` = colore del materiale m
//! - `data-shade`          → `opacity` = volume / 100
//! - `data-layer`          → `stroke` = colore del contorno
//! - `stroke-width`        → moltiplicato per il fattore del contorno
//! - `id="body"`           → `fill` = colore del corpo, se dato (lo stato vince)

use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Contorno {
    pub color: String,
    pub width: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StileSimbolo {
    /// Colore per materiale; quelli assenti restano quelli del disegno.
    #[serde(default)]
    pub materials: BTreeMap<String, String>,
    /// 0 = piatto, 100 = il volume del disegno.
    pub volume: f64,
    pub outline: Contorno,
    /// Colore del corpo (di stato o scelto sull'oggetto); `None` = quello del materiale.
    #[serde(default)]
    pub body: Option<String>,
}

/// Numero → testo: tre decimali al più, niente zeri in coda. Uguale in TypeScript.
pub fn numero_stile(x: f64) -> String {
    let n = (x * 1000.0).round() as i64;
    let intero = n / 1000;
    let resto = (n % 1000).abs();
    if resto == 0 {
        return intero.to_string();
    }
    let segno = if n < 0 && intero == 0 { "-" } else { "" };
    let frazione = format!("{resto:03}");
    format!("{segno}{intero}.{}", frazione.trim_end_matches('0'))
}

/// Un tag d'apertura letto: nome, attributi in ordine, auto-chiuso o no.
struct Tag<'a> {
    nome: &'a str,
    attr: Vec<(String, String)>,
    chiuso: bool,
}

/// Legge `<nome a="v" b="w">` o `<nome …/>` a partire da `s` (che comincia con
/// `<`). Restituisce il tag e la lunghezza consumata; `None` se non è un tag
/// d'apertura nella forma attesa (chiusure, commenti, prologo: passano com'è).
fn leggi_tag(s: &str) -> Option<(Tag<'_>, usize)> {
    let b = s.as_bytes();
    if b.len() < 2 || !b[1].is_ascii_alphabetic() {
        return None;
    }
    let mut i = 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b':' | b'-')) {
        i += 1;
    }
    let nome = &s[1..i];
    let mut attr = Vec::new();
    loop {
        let inizio_spazi = i;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() {
            return None;
        }
        match b[i] {
            b'>' => return Some((Tag { nome, attr, chiuso: false }, i + 1)),
            b'/' if b.get(i + 1) == Some(&b'>') => return Some((Tag { nome, attr, chiuso: true }, i + 2)),
            _ => {}
        }
        if i == inizio_spazi {
            return None; // un attributo deve essere preceduto da spazio
        }
        let k0 = i;
        while i < b.len() && !matches!(b[i], b'=' | b'/' | b'>') && !b[i].is_ascii_whitespace() {
            i += 1;
        }
        if b.get(i) != Some(&b'=') || b.get(i + 1) != Some(&b'"') {
            return None;
        }
        let chiave = s[k0..i].to_string();
        let v0 = i + 2;
        let fine = s[v0..].find('"')? + v0;
        attr.push((chiave, s[v0..fine].to_string()));
        i = fine + 1;
    }
}

pub fn applica_stile(svg: &str, stile: &StileSimbolo) -> String {
    let opacita = numero_stile(stile.volume.clamp(0.0, 100.0) / 100.0);
    let mut out = String::with_capacity(svg.len() + 64);
    let mut resto = svg;
    while let Some(pos) = resto.find('<') {
        out.push_str(&resto[..pos]);
        resto = &resto[pos..];
        let Some((mut tag, usati)) = leggi_tag(resto) else {
            out.push('<');
            resto = &resto[1..];
            continue;
        };
        let val = |t: &Tag, k: &str| t.attr.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        let metti = |t: &mut Tag, k: &str, v: String| match t.attr.iter_mut().find(|(n, _)| n == k) {
            Some(slot) => slot.1 = v,
            None => t.attr.push((k.to_string(), v)),
        };
        if let Some(c) = val(&tag, "data-mat").and_then(|m| stile.materials.get(&m).cloned()) {
            metti(&mut tag, "fill", c);
        }
        if let Some(c) = val(&tag, "data-mat-stroke").and_then(|m| stile.materials.get(&m).cloned()) {
            metti(&mut tag, "stroke", c);
        }
        if val(&tag, "data-shade").is_some() {
            metti(&mut tag, "opacity", opacita.clone());
        }
        if val(&tag, "data-layer").is_some() {
            metti(&mut tag, "stroke", stile.outline.color.clone());
        }
        if let Some(sw) = val(&tag, "stroke-width").and_then(|v| v.parse::<f64>().ok()) {
            metti(&mut tag, "stroke-width", numero_stile(sw * stile.outline.width));
        }
        if val(&tag, "id").as_deref() == Some("body") {
            if let Some(c) = &stile.body {
                metti(&mut tag, "fill", c.clone());
            }
        }
        out.push('<');
        out.push_str(tag.nome);
        for (k, v) in &tag.attr {
            out.push(' ');
            out.push_str(k);
            out.push_str("=\"");
            out.push_str(v);
            out.push('"');
        }
        out.push_str(if tag.chiuso { "/>" } else { ">" });
        resto = &resto[usati..];
    }
    out.push_str(resto);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Caso {
        nome: String,
        svg: String,
        stile: StileSimbolo,
        atteso: String,
    }
    #[derive(Deserialize)]
    struct Fixture {
        casi: Vec<Caso>,
    }

    /// I casi sono quelli del test web (`sws-editor/tests/stileSimboli.test.ts`).
    #[test]
    fn i_casi_condivisi_col_web() {
        let f: Fixture = serde_json::from_str(include_str!("../../../../tests/fixtures/stile-simboli.json")).unwrap();
        assert!(f.casi.len() >= 3);
        for c in &f.casi {
            assert_eq!(applica_stile(&c.svg, &c.stile), c.atteso, "caso «{}»", c.nome);
        }
    }

    #[test]
    fn i_numeri_si_scrivono_come_in_typescript() {
        for (x, atteso) in [
            (1.0, "1"), (1.5, "1.5"), (0.7 * 1.5, "1.05"), (0.7 * 0.6667, "0.467"), (2.0 / 3.0, "0.667"),
            (0.0, "0"), (0.0004, "0"), (0.0005, "0.001"), (12.3456, "12.346"), (-0.25, "-0.25"),
        ] {
            assert_eq!(numero_stile(x), atteso, "{x}");
        }
    }

    #[test]
    fn i_disegni_veri_restano_identici_con_lo_stile_del_disegno() {
        let m = crate::simboli_lib::manifesto_incluso();
        let neutro = StileSimbolo {
            materials: m.materials.clone(),
            volume: 100.0,
            outline: Contorno { color: "#1c2329".into(), width: 1.0 },
            body: None,
        };
        let svg = include_str!("../../../../sws-editor/public/symbols/lib/process/centrifugal-pump.svg");
        assert_eq!(applica_stile(svg, &neutro), svg);
    }

    #[test]
    fn un_testo_che_non_e_un_tag_passa_com_e() {
        let s = StileSimbolo { materials: BTreeMap::new(), volume: 50.0, outline: Contorno { color: "#fff".into(), width: 2.0 }, body: None };
        for t in ["a < b", "<!-- x -->", "<?xml version=\"1.0\"?>", "</g>", "<g id=\"x\" broken>"] {
            assert_eq!(applica_stile(t, &s), t, "{t}");
        }
    }
}
