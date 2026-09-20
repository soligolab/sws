//! L'albero delle pagine di progetto (`page_layout.page_tree`): gerarchia e
//! ordine. Funzioni pure sulla forma `PageTreeNode`, gemelle di
//! `sws-editor/src/pageTree.ts`: i casi stanno in `tests/fixtures/albero-pagine.json`
//! e li leggono entrambe, così editor e pannello non possono divergere su chi
//! c'è nell'albero e in che ordine.

use std::collections::HashSet;

use crate::project::PageTreeNode;

fn nodo(id: &str, children: Vec<PageTreeNode>) -> PageTreeNode {
    PageTreeNode {
        id: id.to_string(),
        children,
    }
}

/// L'albero coerente con le pagine che esistono: scarta gli id inesistenti e i
/// duplicati (vince la prima occorrenza; i figli di un nodo scartato salgono al
/// suo posto) e appende in coda alla radice le pagine che l'albero non nomina,
/// nell'ordine in cui arrivano. Un albero assente è quindi un elenco piatto.
pub fn riconcilia(albero: &[PageTreeNode], pagine: &[String]) -> Vec<PageTreeNode> {
    let esistenti: HashSet<&str> = pagine.iter().map(String::as_str).collect();
    let mut visti: HashSet<String> = HashSet::new();

    fn visita(
        nodi: &[PageTreeNode],
        esistenti: &HashSet<&str>,
        visti: &mut HashSet<String>,
    ) -> Vec<PageTreeNode> {
        let mut out = Vec::new();
        for n in nodi {
            if !esistenti.contains(n.id.as_str()) || visti.contains(&n.id) {
                out.extend(visita(&n.children, esistenti, visti));
                continue;
            }
            visti.insert(n.id.clone());
            let figli = visita(&n.children, esistenti, visti);
            out.push(nodo(&n.id, figli));
        }
        out
    }

    let mut out = visita(albero, &esistenti, &mut visti);
    for p in pagine {
        if visti.insert(p.clone()) {
            out.push(nodo(p, Vec::new()));
        }
    }
    out
}

/// Gli id in ordine di visita in profondità: l'ordine in cui le pagine si
/// mostrano quando serve un elenco solo.
pub fn appiattisci(albero: &[PageTreeNode]) -> Vec<String> {
    let mut out = Vec::new();
    for n in albero {
        out.push(n.id.clone());
        out.extend(appiattisci(&n.children));
    }
    out
}

fn contiene(nodi: &[PageTreeNode], id: &str) -> bool {
    nodi.iter().any(|n| n.id == id || contiene(&n.children, id))
}

fn estrai(nodi: &mut Vec<PageTreeNode>, id: &str) -> Option<PageTreeNode> {
    if let Some(i) = nodi.iter().position(|n| n.id == id) {
        return Some(nodi.remove(i));
    }
    nodi.iter_mut().find_map(|n| estrai(&mut n.children, id))
}

fn trova_mut<'a>(nodi: &'a mut [PageTreeNode], id: &str) -> Option<&'a mut PageTreeNode> {
    for n in nodi.iter_mut() {
        if n.id == id {
            return Some(n);
        }
        if let Some(t) = trova_mut(&mut n.children, id) {
            return Some(t);
        }
    }
    None
}

/// Sposta un nodo (con i suoi figli) sotto `genitore` (`None` = radice) alla
/// posizione `indice`, contata **dopo** l'estrazione e limitata alla coda.
/// `None` se l'id o il genitore non esistono, o se lo spostamento farebbe un
/// ciclo (un nodo dentro se stesso o dentro un suo discendente).
pub fn sposta(
    albero: &[PageTreeNode],
    id: &str,
    genitore: Option<&str>,
    indice: usize,
) -> Option<Vec<PageTreeNode>> {
    let mut out = albero.to_vec();
    let sottoalbero = estrai(&mut out, id)?;
    if let Some(g) = genitore {
        if g == id || contiene(&sottoalbero.children, g) {
            return None;
        }
        let padre = trova_mut(&mut out, g)?;
        let i = indice.min(padre.children.len());
        padre.children.insert(i, sottoalbero);
    } else {
        let i = indice.min(out.len());
        out.insert(i, sottoalbero);
    }
    Some(out)
}

/// Toglie un nodo: i suoi figli salgono al suo posto, nello stesso ordine. Un
/// id sconosciuto lascia l'albero com'è.
pub fn rimuovi(albero: &[PageTreeNode], id: &str) -> Vec<PageTreeNode> {
    let mut out = Vec::new();
    for n in albero {
        if n.id == id {
            out.extend(n.children.iter().cloned());
        } else {
            out.push(nodo(&n.id, rimuovi(&n.children, id)));
        }
    }
    out
}

/// I figli diretti di un nodo, in ordine; `None` = i nodi di primo livello.
pub fn figli_di(albero: &[PageTreeNode], id: Option<&str>) -> Vec<String> {
    match id {
        None => albero.iter().map(|n| n.id.clone()).collect(),
        Some(id) => trova(albero, id)
            .map(|n| n.children.iter().map(|c| c.id.clone()).collect())
            .unwrap_or_default(),
    }
}

fn trova<'a>(albero: &'a [PageTreeNode], id: &str) -> Option<&'a PageTreeNode> {
    for n in albero {
        if n.id == id {
            return Some(n);
        }
        if let Some(t) = trova(&n.children, id) {
            return Some(t);
        }
    }
    None
}

/// Gli id dalla radice fino a `id` compreso, o vuoto se non c'è.
pub fn percorso_fino_a(albero: &[PageTreeNode], id: &str) -> Vec<String> {
    for n in albero {
        if n.id == id {
            return vec![n.id.clone()];
        }
        let sotto = percorso_fino_a(&n.children, id);
        if !sotto.is_empty() {
            let mut v = vec![n.id.clone()];
            v.extend(sotto);
            return v;
        }
    }
    Vec::new()
}

/// Dove sta un nodo: il genitore (`None` = radice) e la posizione fra i fratelli.
pub fn posizione_di(
    albero: &[PageTreeNode],
    id: &str,
    genitore: Option<&str>,
) -> Option<(Option<String>, usize)> {
    if let Some(i) = albero.iter().position(|n| n.id == id) {
        return Some((genitore.map(str::to_string), i));
    }
    albero
        .iter()
        .find_map(|n| posizione_di(&n.children, id, Some(&n.id)))
}

/// Una pagina, per il navigatore: id e nome (che può contenere `{{token}}`).
#[derive(Debug, Clone)]
pub struct NavPagina {
    pub id: String,
    pub name: String,
}

/// Un'eccezione per pagina: etichetta, posizione, esclusione.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NavVoceOverride {
    pub page_id: String,
    pub label: Option<String>,
    pub order: Option<f64>,
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavSource {
    All,
    Roots,
    ChildrenOf,
    ChildrenOfCurrent,
}

impl NavSource {
    /// Il valore scritto in `nav_source`; uno sconosciuto o assente vale «tutte».
    pub fn da_testo(t: Option<&str>) -> Self {
        match t {
            Some("roots") => NavSource::Roots,
            Some("children_of") => NavSource::ChildrenOf,
            Some("children_of_current") => NavSource::ChildrenOfCurrent,
            _ => NavSource::All,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NavConfig {
    pub source: NavSource,
    pub node: Option<String>,
    pub breadcrumb: bool,
    pub items: Vec<NavVoceOverride>,
}

/// Una voce da disegnare.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NavVoce {
    pub id: String,
    pub label: String,
    /// È la pagina in cui ci si trova adesso.
    pub attiva: bool,
    /// Viene dal percorso (briciole), non dalle voci vere e proprie.
    pub percorso: bool,
}

/// Le voci di un navigatore di pagine: quali pagine, in che ordine, con che
/// etichetta. Gemella di `vociNavigatore` (`sws-editor/src/pageNavigator.ts`);
/// `risolvi` traduce un'etichetta o un nome (i `{{token}}`) nella lingua corrente.
pub fn voci_navigatore(
    albero: &[PageTreeNode],
    pagine: &[NavPagina],
    corrente: &str,
    cfg: &NavConfig,
    risolvi: &dyn Fn(&str) -> String,
) -> Vec<NavVoce> {
    let ids: Vec<String> = pagine.iter().map(|p| p.id.clone()).collect();
    let alb = riconcilia(albero, &ids);
    let nome = |id: &str| pagine.iter().find(|p| p.id == id).map(|p| p.name.as_str());

    let mut elenco: Vec<String> = Vec::new();
    let mut contenitore: Option<String> = None;
    match cfg.source {
        NavSource::Roots => elenco = figli_di(&alb, None),
        NavSource::ChildrenOf => {
            if let Some(n) = cfg.node.as_deref() {
                if posizione_di(&alb, n, None).is_some() {
                    elenco = figli_di(&alb, Some(n));
                    contenitore = Some(n.to_string());
                }
            }
        }
        NavSource::ChildrenOfCurrent => {
            let figli = figli_di(&alb, Some(corrente));
            if !figli.is_empty() {
                elenco = figli;
                contenitore = Some(corrente.to_string());
            } else if let Some((genitore, _)) = posizione_di(&alb, corrente, None) {
                elenco = figli_di(&alb, genitore.as_deref());
                contenitore = genitore;
            }
        }
        NavSource::All => elenco = appiattisci(&alb),
    }

    let eccezione = |id: &str| {
        cfg.items
            .iter()
            .find(|i| i.page_id == id && nome(id).is_some())
    };
    let visibile = |id: &str| !eccezione(id).is_some_and(|e| e.hidden);

    let mut base: Vec<String> = elenco
        .iter()
        .filter(|id| visibile(id) && eccezione(id).and_then(|e| e.order).is_none())
        .cloned()
        .collect();
    let mut con_posto: Vec<(usize, f64, String)> = elenco
        .iter()
        .enumerate()
        .filter(|(_, id)| visibile(id))
        .filter_map(|(i, id)| {
            let o = eccezione(id).and_then(|e| e.order)?;
            o.is_finite().then(|| (i, o, id.clone()))
        })
        .collect();
    con_posto.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap().then(a.0.cmp(&b.0)));
    for (_, ordine, id) in con_posto {
        let pos = ((ordine.floor() as i64) - 1).clamp(0, base.len() as i64) as usize;
        base.insert(pos, id);
    }

    let percorso: Vec<String> = match (cfg.breadcrumb, contenitore.as_deref()) {
        (true, Some(c)) => percorso_fino_a(&alb, c)
            .into_iter()
            .filter(|id| visibile(id))
            .collect(),
        _ => Vec::new(),
    };

    let voce = |id: &str, dal_percorso: bool| {
        let propria = eccezione(id)
            .and_then(|e| e.label.as_deref())
            .map(str::trim)
            .filter(|l| !l.is_empty());
        NavVoce {
            id: id.to_string(),
            label: risolvi(propria.unwrap_or_else(|| nome(id).unwrap_or(id))),
            attiva: id == corrente,
            percorso: dal_percorso,
        }
    };
    percorso
        .iter()
        .map(|id| voce(id, true))
        .chain(base.iter().map(|id| voce(id, false)))
        .collect()
}

/// Come si dispongono i bottoni di un navigatore.
#[derive(Debug, Clone, Copy)]
pub struct NavGeometria {
    pub verticale: bool,
    pub riempie: bool,
    pub misura: f64,
    pub gap: f64,
    /// 0 = inizio, 1 = centro, 2 = fine.
    pub allineamento: u8,
}

impl NavGeometria {
    /// Dai campi `nav_*` dell'oggetto; i valori assenti prendono il predefinito.
    pub fn da_campi(
        orientamento: Option<&str>,
        riempie: Option<bool>,
        misura: Option<f64>,
        gap: Option<f64>,
        allineamento: Option<&str>,
    ) -> Self {
        NavGeometria {
            verticale: orientamento == Some("vertical"),
            riempie: riempie.unwrap_or(true),
            misura: misura.unwrap_or(120.0),
            gap: gap.unwrap_or(4.0),
            allineamento: match allineamento {
                Some("center") => 1,
                Some("end") => 2,
                _ => 0,
            },
        }
    }
}

/// Un bottone: posizione e misure in pixel interi, relative all'origine dell'oggetto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RettangoloBottone {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Dove cade ogni bottone. Gemella di `geometriaNavigatore` (`pageNavigator.ts`),
/// stessa fixture: i bottoni cadono negli stessi pixel sul web e su LVGL. Sull'asse
/// trasversale i bottoni riempiono l'oggetto.
pub fn geometria_navigatore(w: f64, h: f64, n: usize, g: &NavGeometria) -> Vec<RettangoloBottone> {
    if n == 0 {
        return Vec::new();
    }
    let (principale, trasversale) = if g.verticale { (h, w) } else { (w, h) };
    let gap = g.gap.max(0.0);
    let disponibile = (principale - gap * (n as f64 - 1.0)).max(0.0);
    let uno = disponibile / n as f64;
    let esatto = if g.riempie {
        uno
    } else {
        g.misura.max(1.0).min(uno)
    };
    let totale = esatto * n as f64 + gap * (n as f64 - 1.0);
    let inizio = if g.riempie {
        0.0
    } else {
        match g.allineamento {
            1 => (principale - totale) / 2.0,
            2 => principale - totale,
            _ => 0.0,
        }
    };
    (0..n)
        .map(|i| {
            let pos = (inizio + i as f64 * (esatto + gap)).round() as i32;
            let len = esatto.round() as i32;
            let tr = trasversale.round() as i32;
            if g.verticale {
                RettangoloBottone {
                    x: 0,
                    y: pos,
                    w: tr,
                    h: len,
                }
            } else {
                RettangoloBottone {
                    x: pos,
                    y: 0,
                    w: len,
                    h: tr,
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn albero(v: &Value) -> Vec<PageTreeNode> {
        if v.is_null() {
            return Vec::new();
        }
        serde_json::from_value(v.clone()).expect("albero non valido")
    }

    fn stringhe(v: &Value) -> Vec<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn i_casi_condivisi_con_l_editor() {
        let percorso = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/albero-pagine.json"
        );
        let testo = std::fs::read_to_string(percorso)
            .unwrap_or_else(|e| panic!("la tabella di casi condivisa manca ({percorso}): {e}"));
        let f: Value = serde_json::from_str(&testo).expect("tabella di casi non valida");

        for c in f["riconcilia"].as_array().unwrap() {
            let got = riconcilia(&albero(&c["albero"]), &stringhe(&c["pagine"]));
            assert_eq!(got, albero(&c["atteso"]), "riconcilia: {}", c["nome"]);
        }
        for c in f["appiattisci"].as_array().unwrap() {
            assert_eq!(appiattisci(&albero(&c["albero"])), stringhe(&c["atteso"]));
        }
        for c in f["sposta"].as_array().unwrap() {
            let genitore = c["genitore"].as_str();
            let got = sposta(
                &albero(&c["albero"]),
                c["id"].as_str().unwrap(),
                genitore,
                c["indice"].as_u64().unwrap() as usize,
            );
            let atteso = if c["atteso"].is_null() {
                None
            } else {
                Some(albero(&c["atteso"]))
            };
            assert_eq!(got, atteso, "sposta: {}", c["nome"]);
        }
        for c in f["rimuovi"].as_array().unwrap() {
            let got = rimuovi(&albero(&c["albero"]), c["id"].as_str().unwrap());
            assert_eq!(got, albero(&c["atteso"]), "rimuovi: {}", c["nome"]);
        }
    }

    #[test]
    fn i_casi_del_navigatore_condivisi_con_l_editor() {
        use crate::project::{resolve_msg, LanguageTable};
        let percorso = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/navigatore-pagine.json"
        );
        let testo = std::fs::read_to_string(percorso)
            .unwrap_or_else(|e| panic!("la tabella di casi condivisa manca ({percorso}): {e}"));
        let f: Value = serde_json::from_str(&testo).expect("tabella di casi non valida");
        let albero: Vec<PageTreeNode> = serde_json::from_value(f["albero"].clone()).unwrap();
        let tabella: LanguageTable = serde_json::from_value(f["tabella"].clone()).unwrap();
        let pagine: Vec<NavPagina> = f["pagine"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| NavPagina {
                id: p["id"].as_str().unwrap().to_string(),
                name: p["name"].as_str().unwrap().to_string(),
            })
            .collect();

        for c in f["casi"].as_array().unwrap() {
            let cfg_j = &c["cfg"];
            let cfg = NavConfig {
                source: NavSource::da_testo(cfg_j["source"].as_str()),
                node: cfg_j["node"].as_str().map(str::to_string),
                breadcrumb: cfg_j["breadcrumb"].as_bool().unwrap_or(false),
                items: cfg_j["items"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .map(|i| NavVoceOverride {
                                page_id: i["page_id"].as_str().unwrap().to_string(),
                                label: i["label"].as_str().map(str::to_string),
                                order: i["order"].as_f64(),
                                hidden: i["hidden"].as_bool().unwrap_or(false),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            };
            let lang = c["lang"].as_str().unwrap();
            let got = voci_navigatore(
                &albero,
                &pagine,
                c["corrente"].as_str().unwrap(),
                &cfg,
                &|t| resolve_msg(t, lang, &tabella),
            );
            let atteso: Vec<NavVoce> = c["atteso"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| NavVoce {
                    id: v["id"].as_str().unwrap().to_string(),
                    label: v["label"].as_str().unwrap().to_string(),
                    attiva: v["attiva"].as_bool().unwrap(),
                    percorso: v["percorso"].as_bool().unwrap(),
                })
                .collect();
            assert_eq!(got, atteso, "navigatore: {}", c["nome"]);
        }
    }

    #[test]
    fn la_geometria_condivisa_con_l_editor() {
        let percorso = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/geometria-navigatore.json"
        );
        let testo = std::fs::read_to_string(percorso)
            .unwrap_or_else(|e| panic!("la tabella di casi condivisa manca ({percorso}): {e}"));
        let f: Value = serde_json::from_str(&testo).expect("tabella di casi non valida");
        for c in f["casi"].as_array().unwrap() {
            let cfg = &c["cfg"];
            let g = NavGeometria::da_campi(
                cfg["orientation"].as_str(),
                cfg["fill"].as_bool(),
                cfg["size"].as_f64(),
                cfg["gap"].as_f64(),
                cfg["align"].as_str(),
            );
            let got = geometria_navigatore(
                c["w"].as_f64().unwrap(),
                c["h"].as_f64().unwrap(),
                c["n"].as_u64().unwrap() as usize,
                &g,
            );
            let atteso: Vec<RettangoloBottone> = c["atteso"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| RettangoloBottone {
                    x: r["x"].as_i64().unwrap() as i32,
                    y: r["y"].as_i64().unwrap() as i32,
                    w: r["w"].as_i64().unwrap() as i32,
                    h: r["h"].as_i64().unwrap() as i32,
                })
                .collect();
            assert_eq!(got, atteso, "geometria: {}", c["nome"]);
        }
    }
}
