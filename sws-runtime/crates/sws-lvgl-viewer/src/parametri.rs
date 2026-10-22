//! I parametri `{nome}` di un faceplate o di una pagina-finestra, e la loro
//! sostituzione — gemello di `substituteFaceplateParams` e
//! `effectiveFaceplateParams` in `sws-editor/src/canvas/SvgCanvas.tsx`
//! (22-10-2026, piano `docs/plans/2026-10-22-finestre-modali-su-lvgl.md`).
//!
//! # Perché esiste, e perché sostituisce su TUTTO
//!
//! La sostituzione c'era già su questo motore, ma era una chiusura dentro
//! `render_faceplate` applicata a **tre campi**: `tag`, `label`, `text`. Il web
//! la fa su **ogni stringa**, ricorsivamente, da F6.1 — e il commento lì dice
//! perché: «un faceplate pompa reale con `state_tag: "{p}.running"`, binding
//! `{p}.mode` o soglie nelle celle grid non funzionava».
//!
//! Quindi su questo motore non funzionava, e nessuno lo aveva misurato: un
//! faceplate con un `state_tag` parametrico mostrava il segnaposto grezzo sul
//! pannello e il valore giusto nel browser. Portare la versione ricorsiva
//! chiude quella divergenza insieme al lavoro delle finestre, invece di
//! scriverne una seconda copia parziale.
//!
//! # Perché su `serde_json::Value` e non sulla struct
//!
//! `SynopticObject` è solo `Deserialize`: non si può fare un giro di andata e
//! ritorno attraverso JSON senza aggiungergli `Serialize`, e quella struct è
//! letta da `check_lvgl_parity.sh`. Il JSON grezzo invece ce l'abbiamo già in
//! mano in tutti e due i punti d'uso — i figli di un faceplate arrivano come
//! `Vec<Value>`, e una pagina-finestra si può leggere grezza — quindi si
//! sostituisce **prima** di deserializzare. È anche l'ordine giusto: un
//! `{nome}` dentro un campo numerico non deve diventare un errore di parsing.

use std::collections::HashMap;

use crate::model::ParametroFinestra;

/// Le chiavi che NON si sostituiscono mai, come `FACEPLATE_SUB_EXCLUDE` sul
/// web: sono identità, non contenuto. Sostituire un `id` romperebbe i
/// riferimenti fra oggetti; sostituire un `type` inventerebbe tipi.
const ESCLUSE: [&str; 4] = ["id", "type", "group_id", "faceplate_id"];

/// Sostituisce `{nome}` in ogni stringa del valore, ricorsivamente.
///
/// Un segnaposto senza valore **resta testuale** (`{nome}`), come sul web: è
/// quello che rende visibile a chi disegna il sinottico che un parametro non
/// è stato passato, invece di lasciare un buco muto.
pub fn sostituisci(v: &mut serde_json::Value, params: &HashMap<String, String>) {
    if params.is_empty() {
        return;
    }
    match v {
        serde_json::Value::String(s) => {
            if s.contains('{') {
                *s = sostituisci_testo(s, params);
            }
        }
        serde_json::Value::Array(a) => {
            for x in a.iter_mut() {
                sostituisci(x, params);
            }
        }
        serde_json::Value::Object(o) => {
            for (k, val) in o.iter_mut() {
                if ESCLUSE.contains(&k.as_str()) {
                    continue;
                }
                sostituisci(val, params);
            }
        }
        _ => {}
    }
}

/// `s.replace(/\{(\w+)\}/g, …)` del web, senza una libreria di espressioni
/// regolari: una graffa aperta e mai chiusa, o una chiave sconosciuta,
/// restano nel testo tali e quali.
pub fn sostituisci_testo(s: &str, params: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        rest = &rest[open..];
        match rest.find('}') {
            Some(close) => {
                let key = &rest[1..close];
                // `\w+` del web: senza questo, `{ "a": 1 }` dentro una stringa
                // verrebbe trattato come un segnaposto.
                let chiave_valida =
                    !key.is_empty() && key.chars().all(|c| c.is_alphanumeric() || c == '_');
                match params.get(key).filter(|_| chiave_valida) {
                    Some(val) => out.push_str(val),
                    None => out.push_str(&rest[..=close]),
                }
                rest = &rest[close + 1..];
            }
            None => {
                out.push_str(rest);
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// I valori effettivi dei parametri: quelli passati da chi apre, poi i
/// `default` dichiarati dalla pagina o dal faceplate — e in coda le chiavi
/// extra di chi apre, che il web lascia passare apposta «così un template
/// rinominato non rompe in silenzio la sostituzione».
///
/// Una stringa vuota conta come «non passato», di nuovo come sul web: un campo
/// lasciato in bianco nel pannello proprietà non deve cancellare il default.
pub fn effettivi(
    dichiarati: &[ParametroFinestra],
    passati: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for p in dichiarati {
        match passati.and_then(|m| m.get(&p.name)).filter(|v| !v.is_empty()) {
            Some(v) => {
                out.insert(p.name.clone(), v.clone());
            }
            None => {
                if let Some(d) = &p.default {
                    out.insert(p.name.clone(), d.clone());
                }
            }
        }
    }
    for (k, v) in passati.into_iter().flatten() {
        if !out.contains_key(k) && !v.is_empty() {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

/// I parametri dichiarati da un faceplate, nella forma ricca `{name, default}`
/// o come stringa nuda — il web normalizza le due con
/// `normalizeFaceplateParams`, e qui si fa lo stesso.
pub fn dichiarati_da_faceplate(v: Option<&serde_json::Value>) -> Vec<ParametroFinestra> {
    let Some(serde_json::Value::Array(a)) = v else {
        return Vec::new();
    };
    a.iter()
        .filter_map(|p| match p {
            serde_json::Value::String(s) => {
                Some(ParametroFinestra { name: s.clone(), default: None })
            }
            serde_json::Value::Object(_) => serde_json::from_value(p.clone()).ok(),
            _ => None,
        })
        .collect()
}

/// Il titolo di una finestra: quello dichiarato dalla pagina coi parametri
/// sostituiti, altrimenti il nome della pagina — `titoloFinestra` del web.
pub fn titolo_finestra(
    dichiarato: Option<&str>,
    nome_pagina: &str,
    params: &HashMap<String, String>,
) -> String {
    match dichiarato.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => sostituisci_testo(t, params),
        None => nome_pagina.to_string(),
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    fn p(coppie: &[(&str, &str)]) -> HashMap<String, String> {
        coppie.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn sostituisce_ogni_stringa_anche_annidata() {
        let mut v = serde_json::json!({
            "id": "o_{p}",
            "type": "led",
            "tag": "{p}.running",
            "state_tag": "{p}.alarm",
            "bindings": { "x": "{p}.pos" },
            "grid_cells": [{ "child": { "tag": "{p}.sub" } }],
            "width": 100
        });
        sostituisci(&mut v, &p(&[("p", "pompa1")]));
        assert_eq!(v["tag"], "pompa1.running");
        assert_eq!(v["state_tag"], "pompa1.alarm", "era il caso che su questo motore non funzionava");
        assert_eq!(v["bindings"]["x"], "pompa1.pos");
        assert_eq!(v["grid_cells"][0]["child"]["tag"], "pompa1.sub");
        assert_eq!(v["width"], 100);
    }

    #[test]
    fn identita_e_tipo_non_si_toccano() {
        let mut v = serde_json::json!({ "id": "{p}", "type": "{p}", "faceplate_id": "{p}", "group_id": "{p}", "tag": "{p}" });
        sostituisci(&mut v, &p(&[("p", "x")]));
        assert_eq!(v["id"], "{p}");
        assert_eq!(v["type"], "{p}");
        assert_eq!(v["faceplate_id"], "{p}");
        assert_eq!(v["group_id"], "{p}");
        assert_eq!(v["tag"], "x");
    }

    #[test]
    fn un_segnaposto_senza_valore_resta_scritto() {
        assert_eq!(sostituisci_testo("{a}/{b}", &p(&[("a", "1")])), "1/{b}");
        assert_eq!(sostituisci_testo("niente", &p(&[("a", "1")])), "niente");
        assert_eq!(sostituisci_testo("graffa aperta {a", &p(&[("a", "1")])), "graffa aperta {a");
        assert_eq!(sostituisci_testo("{ }", &p(&[("a", "1")])), "{ }", "non e' una chiave");
    }

    #[test]
    fn il_titolo_segue_quello_del_web() {
        let v = p(&[("n", "Pompa 1")]);
        assert_eq!(titolo_finestra(Some("Dettaglio {n}"), "pagina", &v), "Dettaglio Pompa 1");
        assert_eq!(titolo_finestra(None, "pagina", &v), "pagina");
        assert_eq!(titolo_finestra(Some("   "), "pagina", &v), "pagina", "vuoto = non dichiarato");
    }

    #[test]
    fn i_parametri_di_un_faceplate_si_leggono_nelle_due_forme() {
        let v = serde_json::json!(["p", { "name": "q", "default": "zero" }]);
        let d = dichiarati_da_faceplate(Some(&v));
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].name, "p");
        assert_eq!(d[1].default.as_deref(), Some("zero"));
        assert!(dichiarati_da_faceplate(None).is_empty());
    }

    #[test]
    fn i_valori_effettivi_seguono_la_precedenza_del_web() {
        let dich = vec![
            ParametroFinestra { name: "p".into(), default: Some("pompa0".into()) },
            ParametroFinestra { name: "q".into(), default: None },
        ];
        // Passato vince sul default.
        let e = effettivi(&dich, Some(&p(&[("p", "pompa7")])));
        assert_eq!(e.get("p").map(String::as_str), Some("pompa7"));
        // Vuoto conta come non passato: resta il default.
        let e = effettivi(&dich, Some(&p(&[("p", "")])));
        assert_eq!(e.get("p").map(String::as_str), Some("pompa0"));
        // Senza default e senza valore: la chiave non c'e', e il segnaposto
        // restera' scritto.
        assert!(!e.contains_key("q"));
        // Una chiave che la pagina non dichiara piu' passa comunque.
        let e = effettivi(&dich, Some(&p(&[("extra", "v")])));
        assert_eq!(e.get("extra").map(String::as_str), Some("v"));
    }
}
