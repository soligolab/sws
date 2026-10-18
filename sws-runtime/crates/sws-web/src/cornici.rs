//! Cornici di pagina (piano `docs/archive/2026-10-15-cornici-di-pagina.md`, ramo 2).
//!
//! Una cornice è una testata e un piede comuni alle pagine che la usano: due
//! fasce riservate, ognuna con la sua altezza e un fondo facoltativo, e gli
//! oggetti che ci stanno sopra, in coordinate di pagina. Vive in
//! `cornici/<id>.yaml`, come i faceplate in `faceplates/`.
//!
//! La composizione si fa **qui e solo qui**: `GET /api/synoptics/:nome?cornice=1`
//! restituisce la pagina con la sua cornice già dentro, e la chiedono sia il
//! viewer web sia quello LVGL. Così la regola (quale cornice, segnaposti, id) è
//! una, e i due motori ricevono la stessa lista di oggetti.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::synoptic::{SynopticObject, SynopticPage};

/// Il prefisso degli id degli oggetti che vengono da una cornice: l'editor lo
/// usa per riconoscerli (attenuati, non selezionabili) e per non salvarli mai
/// dentro la pagina.
pub const PREFISSO_ID: &str = "cornice:";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Fascia {
    /// Altezza in px; 0 = la fascia non c'è.
    #[serde(default)]
    pub altezza: f64,
    /// Fondo della fascia (`#rrggbb`); assente = trasparente, si vede lo
    /// sfondo della pagina.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sfondo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cornice {
    pub id: String,
    pub nome: String,
    pub larghezza: f64,
    pub altezza: f64,
    #[serde(default)]
    pub testata: Fascia,
    #[serde(default)]
    pub piede: Fascia,
    #[serde(default)]
    pub oggetti: Vec<SynopticObject>,
}

/// `cornice` di una pagina: tre stati, e il file li deve distinguere.
/// Assente → `None` (la predefinita del progetto); `cornice: null` →
/// `Some(None)` (nessuna); `cornice: barra` → `Some(Some("barra"))`.
/// Senza questo, serde leggerebbe `null` come «assente».
pub fn tre_stati<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

/// L'id della cornice che una pagina mostra, o `None` se nessuna.
/// Le pagine di boot (`kind: boot`) non ne hanno mai: sono un'immagine, non
/// una pagina che si naviga.
pub fn cornice_della_pagina(pagina: &SynopticPage, predefinita: Option<&str>) -> Option<String> {
    // Una pagina-finestra (P1) non ha mai una cornice: è un riquadro sopra la pagina.
    if pagina.kind.as_deref() == Some("boot") || pagina.finestra.is_some() {
        return None;
    }
    match &pagina.cornice {
        None => predefinita.filter(|s| !s.is_empty()).map(str::to_owned),
        Some(None) => None,
        Some(Some(id)) if id.is_empty() => None,
        Some(Some(id)) => Some(id.clone()),
    }
}

/// I segnaposti che una cornice può usare nei suoi testi.
pub struct Segnaposti<'a> {
    pub pagina_nome: &'a str,
    pub pagina_id: &'a str,
    pub progetto_nome: &'a str,
}

impl Segnaposti<'_> {
    fn sostituisci(&self, s: &str) -> String {
        if !s.contains("{{") {
            return s.to_owned();
        }
        s.replace("{{pagina.nome}}", self.pagina_nome)
            .replace("{{pagina.id}}", self.pagina_id)
            .replace("{{progetto.nome}}", self.progetto_nome)
    }
}

/// Sostituisce i segnaposti in **ogni** stringa dell'oggetto: un elenco dei
/// campi di testo invecchierebbe a ogni tipo nuovo (etichette di bottoni,
/// titoli di tabelle, testi di elenchi…), e i segnaposti non collidono con i
/// token di lingua `{{tNNNN}}` né con le espressioni `{value}`.
fn risolvi_in(v: &mut Value, sp: &Segnaposti) {
    match v {
        Value::String(s) => {
            if s.contains("{{") {
                *s = sp.sostituisci(s);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| risolvi_in(x, sp)),
        Value::Object(m) => m.values_mut().for_each(|x| risolvi_in(x, sp)),
        _ => {}
    }
}

fn id_composto(cornice: &str, oggetto: &str) -> String {
    format!("{PREFISSO_ID}{cornice}:{oggetto}")
}

/// Il fondo di una fascia come rettangolo, se la fascia ha altezza e colore.
fn fondo(cornice: &Cornice, quale: &str, f: &Fascia, y: f64) -> Option<SynopticObject> {
    let colore = f.sfondo.as_deref().filter(|c| !c.is_empty())?;
    if f.altezza <= 0.0 {
        return None;
    }
    serde_json::from_value(serde_json::json!({
        "id": id_composto(&cornice.id, &format!("_{quale}")),
        "type": "rect",
        "x": 0.0, "y": y,
        "width": cornice.larghezza, "height": f.altezza,
        "fill": colore,
    }))
    .ok()
}

/// La pagina con la cornice dentro: fondi delle fasce, poi gli oggetti della
/// cornice (segnaposti risolti, id con prefisso), poi quelli della pagina —
/// nell'ordine in cui si disegnano, quindi la cornice sta **sotto**.
pub fn componi(pagina: &mut SynopticPage, cornice: &Cornice, progetto_nome: &str) {
    let sp = Segnaposti {
        pagina_nome: &pagina.name,
        pagina_id: &pagina.id,
        progetto_nome,
    };
    let propri: std::collections::HashSet<&str> =
        cornice.oggetti.iter().map(|o| o.id.as_str()).collect();
    let mut composti: Vec<SynopticObject> = Vec::with_capacity(cornice.oggetti.len() + 2);
    composti.extend(fondo(cornice, "testata", &cornice.testata, 0.0));
    composti.extend(fondo(
        cornice,
        "piede",
        &cornice.piede,
        cornice.altezza - cornice.piede.altezza,
    ));
    for o in &cornice.oggetti {
        let Ok(mut v) = serde_json::to_value(o) else { continue };
        risolvi_in(&mut v, &sp);
        let Ok(mut o) = serde_json::from_value::<SynopticObject>(v) else { continue };
        // Un tubo agganciato a un oggetto della cornice segue il nuovo id.
        for capo in [&mut o.from_obj_id, &mut o.to_obj_id] {
            if let Some(id) = capo.as_mut().filter(|id| propri.contains(id.as_str())) {
                *id = id_composto(&cornice.id, id);
            }
        }
        o.id = id_composto(&cornice.id, &o.id);
        composti.push(o);
    }
    composti.append(&mut pagina.objects);
    pagina.objects = composti;
}

/// Il riquadro approssimato di un oggetto, per capire se due si coprono. Un
/// testo senza riquadro ha `y` sulla linea di base: il suo corpo sta sopra, e
/// la larghezza si stima dal contenuto.
fn riquadro(o: &SynopticObject) -> (f64, f64, f64, f64) {
    let (x, y) = (o.x, o.y);
    match (o.width, o.height) {
        (Some(w), Some(h)) => (x, y, x + w, y + h),
        _ if o.obj_type == "text" => {
            let fs = o.font_size.unwrap_or(14.0);
            let n = o.text.as_deref().map(|t| t.chars().count()).unwrap_or(4) as f64;
            let w = o.width.unwrap_or(n * fs * 0.6);
            (x, y - fs, x + w, y)
        }
        (w, h) => (x, y, x + w.unwrap_or(0.0), y + h.unwrap_or(0.0)),
    }
}

fn si_coprono(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 < b.2 && b.0 < a.2 && a.1 < b.3 && b.1 < a.3
}

/// Gli oggetti di una pagina che finiscono **sopra** un oggetto della cornice,
/// dentro una fascia: la cornice ci sta sotto e resterebbe coperta a metà. Un
/// oggetto della pagina nello spazio libero di una fascia (il titolo della
/// pagina accanto all'orologio della testata) è legittimo e non si segnala
/// (affinato il 17-10-2026: prima bastava entrare nella fascia).
pub fn oggetti_nelle_fasce<'a>(pagina: &'a SynopticPage, cornice: &Cornice) -> Vec<&'a str> {
    let (t, p) = (cornice.testata.altezza.max(0.0), cornice.piede.altezza.max(0.0));
    let inizio_piede = cornice.altezza - p;
    let suoi: Vec<_> = cornice.oggetti.iter().map(riquadro).collect();
    pagina
        .objects
        .iter()
        .filter(|o| {
            let r = riquadro(o);
            let nella_fascia = (t > 0.0 && r.1 < t) || (p > 0.0 && r.3 > inizio_piede);
            nella_fascia && suoi.iter().any(|c| si_coprono(r, *c))
        })
        .map(|o| o.id.as_str())
        .collect()
}

/// Gli oggetti di una cornice che escono dalle sue fasce.
pub fn oggetti_fuori_dalle_fasce(cornice: &Cornice) -> Vec<&str> {
    let t = cornice.testata.altezza.max(0.0);
    let inizio_piede = cornice.altezza - cornice.piede.altezza.max(0.0);
    cornice
        .oggetti
        .iter()
        .filter(|o| {
            let (y0, y1) = (o.y, o.y + o.height.unwrap_or(0.0));
            let in_testata = y1 <= t;
            let nel_piede = y0 >= inizio_piede && cornice.piede.altezza > 0.0;
            !(in_testata && t > 0.0) && !nel_piede
        })
        .map(|o| o.id.as_str())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pagina(yaml: &str) -> SynopticPage {
        serde_yaml::from_str(yaml).unwrap()
    }

    fn cornice() -> Cornice {
        serde_yaml::from_str(
            r#"
id: base
nome: Base
larghezza: 1280
altezza: 800
testata: { altezza: 56, sfondo: '#1e293b' }
piede: { altezza: 60 }
oggetti:
- { id: titolo, type: text, x: 20, y: 20, text: '{{pagina.nome}} · {{progetto.nome}} · {{t0001}}' }
- { id: ora, type: clock, x: 1080, y: 10, width: 180, height: 36 }
- { id: nav, type: page_navigator, x: 10, y: 750, width: 1260, height: 44, label: '{{pagina.id}}' }
- { id: tubo, type: pipe, x: 0, y: 0, to_obj_id: ora, from_obj_id: fuori }
"#,
        )
        .unwrap()
    }

    /// La stessa fixture dell'editor (`sws-editor/tests/cornici.test.ts`).
    #[test]
    fn la_fixture_condivisa_con_l_editor() {
        let fx: serde_json::Value =
            serde_json::from_str(include_str!("../../../../tests/fixtures/cornici.json")).unwrap();
        let c: Cornice = serde_json::from_value(fx["cornice"].clone()).unwrap();
        let mut p: SynopticPage = serde_json::from_value(fx["pagina"].clone()).unwrap();
        componi(&mut p, &c, fx["progetto"].as_str().unwrap());
        let atteso = fx["atteso"].as_array().unwrap();
        // gli oggetti della cornice, poi quelli della pagina
        assert_eq!(p.objects.len(), atteso.len() + 1);
        for (o, a) in p.objects.iter().zip(atteso) {
            let v = serde_json::to_value(o).unwrap();
            for (k, x) in a.as_object().unwrap() {
                match (v[k].as_f64(), x.as_f64()) {
                    (Some(a), Some(b)) => assert_eq!(a, b, "{} . {k}", o.id),
                    _ => assert_eq!(&v[k], x, "{} . {k}", o.id),
                }
            }
        }
    }

    #[test]
    fn i_tre_stati_della_cornice_di_una_pagina() {
        let assente = pagina("id: p\nname: P\n");
        let nessuna = pagina("id: p\nname: P\ncornice: null\n");
        let scelta = pagina("id: p\nname: P\ncornice: altra\n");
        assert_eq!(cornice_della_pagina(&assente, Some("base")).as_deref(), Some("base"));
        assert_eq!(cornice_della_pagina(&assente, None), None);
        assert_eq!(cornice_della_pagina(&nessuna, Some("base")), None);
        assert_eq!(cornice_della_pagina(&scelta, Some("base")).as_deref(), Some("altra"));
        let boot = pagina("id: p\nname: P\nkind: boot\ncornice: altra\n");
        assert_eq!(cornice_della_pagina(&boot, Some("base")), None);
        let finestra = pagina("id: p\nname: P\nfinestra: { modale: true }\n");
        assert_eq!(cornice_della_pagina(&finestra, Some("base")), None);
    }

    #[test]
    fn null_resta_null_sul_file() {
        let nessuna = pagina("id: p\nname: P\ncornice: null\n");
        assert!(serde_yaml::to_string(&nessuna).unwrap().contains("cornice: null"));
        let assente = pagina("id: p\nname: P\n");
        assert!(!serde_yaml::to_string(&assente).unwrap().contains("cornice"));
    }

    #[test]
    fn la_composizione_mette_la_cornice_sotto_con_segnaposti_e_prefissi() {
        let mut p = pagina("id: pg1\nname: Cucina\nobjects:\n- { id: a, type: rect, x: 100, y: 100 }\n");
        componi(&mut p, &cornice(), "Casa");
        let ids: Vec<&str> = p.objects.iter().map(|o| o.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "cornice:base:_testata",
                "cornice:base:titolo",
                "cornice:base:ora",
                "cornice:base:nav",
                "cornice:base:tubo",
                "a"
            ]
        );
        assert_eq!(p.objects[0].fill.as_deref(), Some("#1e293b"));
        assert_eq!(p.objects[0].height, Some(56.0));
        assert_eq!(p.objects[1].text.as_deref(), Some("Cucina · Casa · {{t0001}}"));
        assert_eq!(p.objects[3].label.as_deref(), Some("pg1"));
        // il capo agganciato a un oggetto della cornice segue il prefisso,
        // quello agganciato a qualcosa che la cornice non ha resta com'era
        assert_eq!(p.objects[4].to_obj_id.as_deref(), Some("cornice:base:ora"));
        assert_eq!(p.objects[4].from_obj_id.as_deref(), Some("fuori"));
    }

    #[test]
    fn le_fasce_senza_colore_non_disegnano_un_fondo() {
        let mut c = cornice();
        c.testata.sfondo = None;
        let mut p = pagina("id: p\nname: P\n");
        componi(&mut p, &c, "X");
        assert!(p.objects.iter().all(|o| !o.id.starts_with("cornice:base:_")));
    }

    #[test]
    fn oggetti_della_pagina_nelle_fasce_e_della_cornice_fuori() {
        // «alto» copre il titolo della cornice, «basso» il navigatore; «libero»
        // sta in testata ma lontano da tutto; «giusto» fra le due fasce.
        let p = pagina(
            "id: p\nname: P\nobjects:\n- { id: alto, type: rect, x: 0, y: 10, width: 200, height: 40 }\n- { id: libero, type: rect, x: 600, y: 10, width: 100, height: 30 }\n- { id: giusto, type: rect, x: 0, y: 60, width: 100, height: 600 }\n- { id: basso, type: rect, x: 0, y: 700, width: 100, height: 60 }\n",
        );
        let c = cornice();
        assert_eq!(oggetti_nelle_fasce(&p, &c), ["alto", "basso"]);
        let mut c2 = cornice();
        c2.oggetti.push(serde_yaml::from_str("{ id: mezzo, type: rect, x: 0, y: 300, height: 20 }").unwrap());
        assert_eq!(oggetti_fuori_dalle_fasce(&c2), ["mezzo"]);
    }
}
