//! L'albero delle pagine di progetto (`page_layout.page_tree`): gerarchia e
//! ordine. Funzioni pure sulla forma `PageTreeNode`, gemelle di
//! `sws-editor/src/pageTree.ts`: i casi stanno in `tests/fixtures/albero-pagine.json`
//! e li leggono entrambe, così editor e pannello non possono divergere su chi
//! c'è nell'albero e in che ordine.

use std::collections::HashSet;

use crate::project::PageTreeNode;

fn nodo(id: &str, children: Vec<PageTreeNode>) -> PageTreeNode {
    PageTreeNode { id: id.to_string(), children }
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
        v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
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
            let atteso = if c["atteso"].is_null() { None } else { Some(albero(&c["atteso"])) };
            assert_eq!(got, atteso, "sposta: {}", c["nome"]);
        }
        for c in f["rimuovi"].as_array().unwrap() {
            let got = rimuovi(&albero(&c["albero"]), c["id"].as_str().unwrap());
            assert_eq!(got, albero(&c["atteso"]), "rimuovi: {}", c["nome"]);
        }
    }
}
