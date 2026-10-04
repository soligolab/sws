//! Il catalogo dei dispositivi noti (04-10-2026, piano
//! `docs/archive/2026-10-04-catalogo-dispositivi.md`).
//!
//! Un file JSON per modello, `<marca>/<modello>.json`, **riletto a ogni
//! richiesta**: correggere un registro è cambiare un file, senza ricompilare né
//! riavviare. Due cartelle: quella del prodotto (`--catalog-root`, nell'immagine
//! come i template) e quella dell'utente (`<config>/catalogo-dispositivi`, un
//! volume che sopravvive agli aggiornamenti). Stesso id: vince l'utente.
//!
//! I file che cominciano con `_` sono **frammenti**: non compaiono
//! nell'elenco, si includono (`"includi": ["pixsys/_atr"]`) per non ripetere i
//! registri comuni a una famiglia — una correzione si fa in un posto solo. I
//! registri del modello vengono dopo quelli inclusi; un `nome` ripetuto
//! sostituisce, così un modello corregge un frammento.
//!
//! Il runtime non interpreta i registri: li passa all'IDE, che ne fa un tipo,
//! una variabile e un dispositivo del bus (`config/sorgenti/daCatalogo.ts`).
//! La guardia `scripts/check_catalogo.sh` controlla i file del prodotto.

use crate::router::AppState;
use axum::{
    extract::{Path as PathEx, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// La cartella dell'utente, dentro `--config`.
pub const CARTELLA_UTENTE: &str = "catalogo-dispositivi";

const IMMAGINI: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
];

/// Le due radici, l'utente prima.
pub struct Radici {
    pub utente: PathBuf,
    pub prodotto: PathBuf,
}

impl Radici {
    pub fn da(s: &AppState) -> Self {
        Self { utente: s.config_dir.join(CARTELLA_UTENTE), prodotto: (*s.catalog_root).clone() }
    }

    /// Il file `<marca>/<nome>` e da dove viene: l'utente vince.
    fn trova(&self, marca: &str, nome: &str) -> Option<(PathBuf, Origine)> {
        if !nome_sicuro(marca) || !nome_sicuro(nome) {
            return None;
        }
        let u = self.utente.join(marca).join(nome);
        if u.is_file() {
            return Some((u, Origine::Utente));
        }
        let p = self.prodotto.join(marca).join(nome);
        p.is_file().then_some((p, Origine::Prodotto))
    }
}

/// Un pezzo di percorso accettabile: niente `..`, niente separatori, niente
/// nascosti.
fn nome_sicuro(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('.')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        && !s.contains("..")
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origine {
    Prodotto,
    Utente,
}

#[derive(Debug, Serialize)]
pub struct VoceElenco {
    pub id: String,
    pub marca: String,
    pub modello: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub famiglia: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descrizione: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub immagine: Option<String>,
    pub origine: Origine,
}

#[derive(Debug, Serialize)]
pub struct ErroreFile {
    pub file: String,
    pub errore: String,
}

#[derive(Debug, Serialize)]
pub struct Elenco {
    pub voci: Vec<VoceElenco>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errori: Vec<ErroreFile>,
}

fn leggi_json(p: &Path) -> Result<Map<String, Value>, String> {
    let testo = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Value>(&testo).map_err(|e| e.to_string())? {
        Value::Object(m) => Ok(m),
        _ => Err("il file non è un oggetto JSON".into()),
    }
}

fn testo(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(str::to_string)
}

/// L'elenco dei modelli (non dei frammenti), utente sopra prodotto.
pub fn elenco(r: &Radici) -> Elenco {
    let mut voci: Vec<VoceElenco> = Vec::new();
    let mut errori = Vec::new();
    let mut visti: HashSet<String> = HashSet::new();
    for (radice, origine) in [(&r.utente, Origine::Utente), (&r.prodotto, Origine::Prodotto)] {
        let Ok(marche) = std::fs::read_dir(radice) else { continue };
        let mut marche: Vec<_> = marche.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        marche.sort();
        for dir in marche {
            let Some(marca) = dir.file_name().and_then(|n| n.to_str()).map(str::to_string) else { continue };
            if !nome_sicuro(&marca) {
                continue;
            }
            let Ok(files) = std::fs::read_dir(&dir) else { continue };
            let mut files: Vec<_> = files.flatten().map(|e| e.path()).collect();
            files.sort();
            for f in files {
                let Some(stem) = f.file_stem().and_then(|n| n.to_str()).map(str::to_string) else { continue };
                if f.extension().and_then(|e| e.to_str()) != Some("json") || stem.starts_with('_') || stem.starts_with('.') {
                    continue;
                }
                let id = format!("{marca}/{stem}");
                if !visti.insert(id.clone()) {
                    continue; // l'utente ha già la sua
                }
                match leggi_json(&f) {
                    Ok(m) => voci.push(VoceElenco {
                        modello: testo(&m, "modello").unwrap_or_else(|| stem.clone()),
                        marca: testo(&m, "marca").unwrap_or_else(|| marca.clone()),
                        famiglia: testo(&m, "famiglia"),
                        descrizione: m.get("descrizione").cloned(),
                        immagine: testo(&m, "immagine"),
                        id,
                        origine,
                    }),
                    Err(e) => errori.push(ErroreFile { file: format!("{id}.json ({origine:?})"), errore: e }),
                }
            }
        }
    }
    voci.sort_by(|a, b| (a.marca.as_str(), a.famiglia.as_deref(), a.modello.as_str()).cmp(&(b.marca.as_str(), b.famiglia.as_deref(), b.modello.as_str())));
    Elenco { voci, errori }
}

/// I registri di un file con i suoi `includi` risolti, in ordine: prima gli
/// inclusi, poi i propri; un nome ripetuto sostituisce il precedente al suo posto.
fn registri_risolti(r: &Radici, id: &str, aperti: &mut Vec<String>) -> Result<(Map<String, Value>, Vec<Value>), String> {
    if aperti.iter().any(|x| x == id) {
        return Err(format!("include circolare: {} → {id}", aperti.join(" → ")));
    }
    if aperti.len() > 8 {
        return Err("include troppo annidati".into());
    }
    let (marca, nome) = id.split_once('/').ok_or_else(|| format!("id «{id}» senza marca"))?;
    let (p, _) = r.trova(marca, &format!("{nome}.json")).ok_or_else(|| format!("«{id}» non trovato"))?;
    let m = leggi_json(&p).map_err(|e| format!("{id}: {e}"))?;
    aperti.push(id.to_string());
    let mut out: Vec<Value> = Vec::new();
    let unisci = |out: &mut Vec<Value>, reg: Value| {
        let nome = reg.get("nome").and_then(Value::as_str).map(str::to_string);
        match nome.and_then(|n| out.iter().position(|x| x.get("nome").and_then(Value::as_str) == Some(n.as_str()))) {
            Some(i) => out[i] = reg,
            None => out.push(reg),
        }
    };
    for inc in m.get("includi").and_then(Value::as_array).cloned().unwrap_or_default() {
        let inc = inc.as_str().ok_or("«includi» vuole stringhe")?.to_string();
        let (_, regs) = registri_risolti(r, &inc, aperti)?;
        for reg in regs {
            unisci(&mut out, reg);
        }
    }
    for reg in m.get("registri").and_then(Value::as_array).cloned().unwrap_or_default() {
        unisci(&mut out, reg);
    }
    aperti.pop();
    Ok((m, out))
}

/// Una voce intera, con gli include risolti.
pub fn voce(r: &Radici, marca: &str, nome: &str) -> Result<Value, (StatusCode, String)> {
    let id = format!("{marca}/{nome}");
    let (_, origine) = r
        .trova(marca, &format!("{nome}.json"))
        .ok_or((StatusCode::NOT_FOUND, format!("«{id}» non è nel catalogo")))?;
    let (mut m, registri) = registri_risolti(r, &id, &mut Vec::new()).map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))?;
    m.remove("includi");
    m.insert("id".into(), Value::String(id));
    m.insert("registri".into(), Value::Array(registri));
    m.insert("origine".into(), serde_json::to_value(origine).unwrap_or(Value::Null));
    Ok(Value::Object(m))
}

/// `GET /api/catalogo/dispositivi`
pub async fn elenco_handler(State(s): State<AppState>) -> Response {
    let r = Radici::da(&s);
    match tokio::task::spawn_blocking(move || elenco(&r)).await {
        Ok(e) => Json(e).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `GET /api/catalogo/dispositivi/:marca/:nome` — un modello (`atr244`) o un
/// file accanto (`atr244.png`, l'icona).
pub async fn voce_handler(State(s): State<AppState>, PathEx((marca, nome)): PathEx<(String, String)>) -> Response {
    let r = Radici::da(&s);
    let ext = Path::new(&nome).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    if let Some((_, mime)) = ext.as_deref().and_then(|e| IMMAGINI.iter().find(|(x, _)| *x == e)) {
        let mime = *mime;
        let Some((p, _)) = r.trova(&marca, &nome) else {
            return (StatusCode::NOT_FOUND, "immagine non trovata").into_response();
        };
        return match tokio::fs::read(&p).await {
            Ok(b) => ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "max-age=300")], b).into_response(),
            Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
        };
    }
    match tokio::task::spawn_blocking(move || voce(&r, &marca, &nome)).await {
        Ok(Ok(v)) => Json(v).into_response(),
        Ok(Err((c, e))) => (c, e).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scrivi(dir: &Path, rel: &str, testo: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, testo).unwrap();
    }

    fn radici() -> (tempfile::TempDir, Radici) {
        let t = tempfile::tempdir().unwrap();
        let r = Radici { utente: t.path().join("utente"), prodotto: t.path().join("prodotto") };
        (t, r)
    }

    #[test]
    fn include_risolti_e_un_nome_ripetuto_sostituisce() {
        let (_t, r) = radici();
        scrivi(&r.prodotto, "acme/_comuni.json", r#"{"registri":[{"nome":"fw","indirizzo":1},{"nome":"pv","indirizzo":9}]}"#);
        scrivi(
            &r.prodotto,
            "acme/x1.json",
            r#"{"marca":"Acme","modello":"X1","includi":["acme/_comuni"],"registri":[{"nome":"pv","indirizzo":1000},{"nome":"sp","indirizzo":2000}]}"#,
        );
        let v = voce(&r, "acme", "x1").unwrap();
        let regs: Vec<(String, u64)> = v["registri"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| (x["nome"].as_str().unwrap().to_string(), x["indirizzo"].as_u64().unwrap()))
            .collect();
        assert_eq!(regs, vec![("fw".into(), 1), ("pv".into(), 1000), ("sp".into(), 2000)]);
        assert_eq!(v["id"], "acme/x1");
        assert!(v.get("includi").is_none());
        // I frammenti non sono nell'elenco.
        let e = elenco(&r);
        assert_eq!(e.voci.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(), vec!["acme/x1"]);
    }

    #[test]
    fn l_utente_vince_e_un_file_rotto_si_dice_senza_rompere_il_resto() {
        let (_t, r) = radici();
        scrivi(&r.prodotto, "acme/x1.json", r#"{"modello":"X1","registri":[{"nome":"a","indirizzo":1}]}"#);
        scrivi(&r.prodotto, "acme/x2.json", r#"{"modello":"X2"}"#);
        scrivi(&r.utente, "acme/x1.json", r#"{"modello":"X1 corretto","registri":[{"nome":"a","indirizzo":5}]}"#);
        scrivi(&r.utente, "acme/rotto.json", "{ non è json");
        let e = elenco(&r);
        let x1 = e.voci.iter().find(|v| v.id == "acme/x1").unwrap();
        assert_eq!((x1.modello.as_str(), x1.origine), ("X1 corretto", Origine::Utente));
        assert!(e.voci.iter().any(|v| v.id == "acme/x2" && v.origine == Origine::Prodotto));
        assert_eq!(e.errori.len(), 1, "{:?}", e.errori);
        assert_eq!(voce(&r, "acme", "x1").unwrap()["registri"][0]["indirizzo"], 5);
    }

    #[test]
    fn un_include_circolare_o_mancante_e_un_errore_e_i_percorsi_strani_non_passano() {
        let (_t, r) = radici();
        scrivi(&r.prodotto, "acme/_a.json", r#"{"includi":["acme/_b"]}"#);
        scrivi(&r.prodotto, "acme/_b.json", r#"{"includi":["acme/_a"]}"#);
        scrivi(&r.prodotto, "acme/x.json", r#"{"includi":["acme/_a"]}"#);
        scrivi(&r.prodotto, "acme/y.json", r#"{"includi":["acme/_manca"]}"#);
        assert!(voce(&r, "acme", "x").unwrap_err().1.contains("circolare"));
        assert!(voce(&r, "acme", "y").unwrap_err().1.contains("non trovato"));
        assert_eq!(voce(&r, "..", "x").unwrap_err().0, StatusCode::NOT_FOUND);
        assert!(!nome_sicuro("../etc"));
        assert!(!nome_sicuro(".nascosto"));
        assert!(nome_sicuro("atr244.png"));
    }

    /// Il catalogo del prodotto si legge tutto, senza errori.
    #[test]
    fn il_catalogo_del_prodotto_si_legge() {
        let prodotto = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../catalogo/dispositivi");
        let r = Radici { utente: PathBuf::from("/nessuna"), prodotto };
        let e = elenco(&r);
        assert!(e.errori.is_empty(), "{:?}", e.errori);
        for v in &e.voci {
            let (m, n) = v.id.split_once('/').unwrap();
            let voce = voce(&r, m, n).unwrap_or_else(|e| panic!("{}: {}", v.id, e.1));
            assert!(!voce["registri"].as_array().unwrap().is_empty(), "{} senza registri", v.id);
        }
    }
}
