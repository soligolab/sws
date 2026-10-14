//! Il manifesto della libreria di simboli (`sws-editor/public/symbols/lib/manifest.json`).
//!
//! Lo scrive `scripts/simboli/genera.py` insieme agli SVG; qui c'è la sua forma,
//! la stessa di `sws-editor/src/symbols/lib/manifest.ts`. Lo leggono il
//! validatore (quali `lib:` esistono) e il pannello LVGL (la geometria delle parti
//! vive). Piano: `docs/plans/2026-10-14-motore-simboli-lib.md`.

use std::collections::BTreeMap;

use serde::Deserialize;

/// Una parte viva, in unità del viewBox del simbolo.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ParteLib {
    /// Finestra del contenuto: il disegno è pieno, si mostra la parte bassa.
    Level { id: String, x: f64, y: f64, w: f64, h: f64 },
    /// Gira attorno a (cx, cy); `symmetry` = gradi dopo cui il disegno si ripete.
    Rotor { id: String, cx: f64, cy: f64, symmetry: f64 },
    /// Disegnata a metà scala; ruota da `a0` (minimo) a `a1` (massimo), in gradi orari.
    Needle { id: String, cx: f64, cy: f64, a0: f64, a1: f64 },
    /// Disegnata in posizione `open`; `closed` è la rotazione della chiusa.
    Lever { id: String, cx: f64, cy: f64, open: f64, closed: f64 },
    /// Accesa = visibile.
    Lamp { id: String },
}

impl ParteLib {
    pub fn id(&self) -> &str {
        match self {
            ParteLib::Level { id, .. }
            | ParteLib::Rotor { id, .. }
            | ParteLib::Needle { id, .. }
            | ParteLib::Lever { id, .. }
            | ParteLib::Lamp { id } => id,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimboloLib {
    /// `lib:<famiglia>/<slug>`: è il `symbol_id` dell'oggetto.
    pub id: String,
    /// Percorso relativo a `/symbols/lib/`.
    pub file: String,
    pub family: String,
    pub kind: String,
    pub label: String,
    #[serde(rename = "viewBox")]
    pub view_box: [f64; 2],
    pub body: String,
    #[serde(default)]
    pub materials: Vec<String>,
    #[serde(default)]
    pub parts: Vec<ParteLib>,
    /// Il builtin che questo disegno sostituisce (alias).
    #[serde(default)]
    pub replaces: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestLib {
    pub version: String,
    pub materials: BTreeMap<String, String>,
    pub symbols: Vec<SimboloLib>,
}

impl ManifestLib {
    pub fn simbolo(&self, id: &str) -> Option<&SimboloLib> {
        self.symbols.iter().find(|s| s.id == id)
    }

    /// Per id `lib:…`, oppure per **alias**: il disegno che sostituisce il
    /// builtin `id` (`replaces`, M3 del piano). Come `cercaSimbolo` sul web.
    pub fn simbolo_o_alias(&self, id: &str) -> Option<&SimboloLib> {
        self.simbolo(id).or_else(|| self.symbols.iter().find(|s| s.replaces.as_deref() == Some(id)))
    }
}

/// Il manifesto com'è in questo checkout: per i test, che verificano che il file
/// generato abbia la forma che il codice Rust si aspetta.
#[cfg(test)]
pub(crate) fn manifesto_incluso() -> ManifestLib {
    serde_json::from_str(include_str!("../../../../sws-editor/public/symbols/lib/manifest.json")).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_manifesto_generato_si_legge_e_dichiara_le_parti() {
        let m = manifesto_incluso();
        assert!(m.version.len() >= 8);
        let pompa = m.simbolo("lib:process/centrifugal-pump").expect("la pompa c'è");
        assert_eq!(pompa.replaces.as_deref(), Some("pump"));
        assert_eq!(m.simbolo_o_alias("pump").map(|s| s.id.as_str()), Some("lib:process/centrifugal-pump"));
        assert!(m.simbolo_o_alias("non-esiste").is_none());
        assert!(matches!(pompa.parts.as_slice(), [ParteLib::Rotor { symmetry, .. }] if *symmetry == 60.0));
        let serbatoio = m.simbolo("lib:process/vertical-tank").expect("il serbatoio c'è");
        assert!(serbatoio.parts.iter().any(|p| matches!(p, ParteLib::Level { .. })));
        for s in &m.symbols {
            assert!(s.id.starts_with("lib:"), "{}", s.id);
            assert!(m.materials.contains_key(&s.body), "{}: corpo {}", s.id, s.body);
            for mat in &s.materials {
                assert!(m.materials.contains_key(mat), "{}: materiale {mat}", s.id);
            }
        }
    }
}
