//! Lo stato dei tag pubblicato sul broker (01-11-2026, piano
//! docs/archive/2026-11-01-inverter-solarman.md, fase 5).
//!
//! Prima SWS mandava sul broker solo le scritture dell'operatore. Ma un
//! dispositivo che regge **un client solo** — la chiavetta Solarman di un
//! inverter, che con due lettori mescola le risposte e a volte si riavvia — vuole
//! un lettore unico, e gli altri che leggono da lui. Con le pubblicazioni quel
//! lettore è SWS: legge l'inverter e mette lo stato su `inverter/<id>/state`, e
//! Home Assistant smette di interrogare la chiavetta.
//!
//! Ogni pubblicazione è un elenco di tag (un tag, una variabile, un suo ramo) e
//! un topic: in JSON un oggetto piatto con le foglie relative a ciascun tag,
//! `null` dove il valore non è buono — chi legge vede «non disponibile», non un
//! numero vecchio spacciato per buono. Si pubblica quando qualcosa cambia (gli
//! aggiornamenti di un giro di lettura arrivano a raffica: si raccolgono in un
//! messaggio solo) e, se chiesto, a intervallo fisso. Qui le parti pure: cosa
//! riguarda una pubblicazione e cosa si manda.

use std::collections::BTreeMap;

use serde_json::{Map, Value};
use sws_core::{FormatoPubblicazione, PubblicazioneMqtt, TagDb, TagQuality, TagState, TagUpdate, TagValue};

/// Il tag (radice) `id` tocca il prefisso `p`? Vale in tutti e due i versi: un
/// aggiornamento di `inverter` tocca `inverter.main`, e uno di
/// `casa.luce` tocca il prefisso `casa`.
pub fn tocca(p: &str, id: &str) -> bool {
    id == p || id.starts_with(&format!("{p}.")) || p.starts_with(&format!("{id}."))
}

/// La pubblicazione è toccata dall'aggiornamento di `id`?
pub fn riguarda(p: &PubblicazioneMqtt, id: &str) -> bool {
    p.tags.iter().any(|t| tocca(t, id)) || p.disponibilita.as_ref().is_some_and(|d| tocca(&d.tag, id))
}

fn json_di(v: &TagValue) -> Value {
    match v {
        TagValue::Bool(b) => Value::Bool(*b),
        TagValue::Int(i) => Value::from(*i),
        TagValue::Float(f) => serde_json::Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
        TagValue::Str(s) => Value::String(s.clone()),
        TagValue::Array(a) => Value::Array(a.iter().map(json_di).collect()),
        TagValue::Struct(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), json_di(v))).collect()),
    }
}

/// Le foglie sotto il prefisso `p`, con la chiave relativa a `p`.
async fn foglie_sotto(db: &TagDb, radici: &BTreeMap<String, TagState>, p: &str) -> Vec<(String, TagState)> {
    let mut out = Vec::new();
    for (id, st) in radici.iter().filter(|(id, _)| tocca(p, id)) {
        let foglie = db.espandi_foglie(&TagUpdate { id: id.clone(), state: st.clone() }).await;
        for (f, s) in foglie {
            let chiave = if f == p {
                // Il prefisso è proprio questa foglia: il suo ultimo segmento.
                f.rsplit('.').next().unwrap_or(&f).to_string()
            } else if let Some(rel) = f.strip_prefix(&format!("{p}.")) {
                rel.to_string()
            } else {
                continue;
            };
            out.push((chiave, s));
        }
    }
    out
}

/// Il messaggio di stato di una pubblicazione, o `None` se non c'è niente da
/// dire (nessun tag trovato; in formato valore, più di un valore).
pub async fn stato(db: &TagDb, p: &PubblicazioneMqtt) -> Option<String> {
    let radici: BTreeMap<String, TagState> = db.snapshot().await.into_iter().collect();
    let mut foglie = Vec::new();
    for t in &p.tags {
        foglie.extend(foglie_sotto(db, &radici, t).await);
    }
    match p.formato {
        FormatoPubblicazione::Json => {
            if foglie.is_empty() {
                return None;
            }
            let mut m = Map::new();
            for (k, s) in foglie {
                m.insert(k, if s.quality == TagQuality::Good { json_di(&s.value) } else { Value::Null });
            }
            Some(Value::Object(m).to_string())
        }
        FormatoPubblicazione::Valore => match foglie.as_slice() {
            [(_, s)] => Some(match (&s.value, s.quality == TagQuality::Good) {
                (_, false) => String::new(),
                (TagValue::Str(x), true) => x.clone(),
                (v, true) => json_di(v).to_string(),
            }),
            _ => None,
        },
    }
}

/// Il messaggio di disponibilità: `online` se il tag è vero e buono.
pub async fn disponibilita(db: &TagDb, p: &PubblicazioneMqtt) -> Option<(String, String)> {
    let d = p.disponibilita.as_ref()?;
    let vivo = db
        .get(&d.tag)
        .await
        .is_some_and(|s| s.quality == TagQuality::Good && matches!(s.value, TagValue::Bool(true)));
    Some((d.topic.clone(), if vivo { d.online.clone() } else { d.offline.clone() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use sws_core::{Forma, TagDef, TypeDef};

    fn pubblica(tags: &[&str]) -> PubblicazioneMqtt {
        serde_json::from_value(serde_json::json!({ "topic": "inverter/zcs/state", "tags": tags })).unwrap()
    }

    /// Un `TagDb` con una variabile strutturata `inverter` (main e
    /// diagnostics) e un tag semplice.
    async fn db() -> TagDb {
        let tipi: Vec<TypeDef> = serde_json::from_value(serde_json::json!([
            { "id": "main", "members": [{ "name": "battery_soc", "data_type": "f32" }, { "name": "grid_power", "data_type": "f32" }, { "name": "inverter_status", "data_type": "string" }] },
            { "id": "diag", "members": [{ "name": "bus_voltage", "data_type": "f32" }] },
            { "id": "inv", "members": [{ "name": "main", "type_ref": "main" }, { "name": "diagnostics", "type_ref": "diag" }] }
        ]))
        .unwrap();
        let tags: Vec<TagDef> = serde_json::from_value(serde_json::json!([
            { "id": "inverter", "type_ref": "inv" }, { "id": "inv_sorgente.disponibile", "data_type": "bool" }
        ]))
        .unwrap();
        let db = TagDb::new(64);
        let mut forme = HashMap::new();
        for t in &tags {
            if let Some(f) = Forma::da_tag(t, &tipi).unwrap() {
                db.set(t.id.clone(), f.valore_iniziale(), TagQuality::Uncertain).await;
                forme.insert(t.id.clone(), f);
            }
        }
        db.set_forme(forme).await;
        db
    }

    #[tokio::test]
    async fn un_ramo_diventa_un_json_piatto_con_null_dove_non_e_buono() {
        let db = db().await;
        db.set("inverter.main.battery_soc".into(), TagValue::Float(17.0), TagQuality::Good).await;
        db.set("inverter.main.inverter_status".into(), TagValue::Str("running".into()), TagQuality::Good).await;
        db.set("inverter.main.grid_power".into(), TagValue::Float(-70.0), TagQuality::Bad).await;
        db.set("inverter.diagnostics.bus_voltage".into(), TagValue::Float(380.0), TagQuality::Good).await;
        let s: Value = serde_json::from_str(&stato(&db, &pubblica(&["inverter.main"])).await.unwrap()).unwrap();
        assert_eq!(s, serde_json::json!({ "battery_soc": 17.0, "inverter_status": "running", "grid_power": null }));
    }

    #[tokio::test]
    async fn una_variabile_intera_porta_i_rami_nella_chiave() {
        let db = db().await;
        db.set("inverter.diagnostics.bus_voltage".into(), TagValue::Float(380.0), TagQuality::Good).await;
        let s: Value = serde_json::from_str(&stato(&db, &pubblica(&["inverter"])).await.unwrap()).unwrap();
        assert_eq!(s["diagnostics.bus_voltage"], serde_json::json!(380.0));
    }

    #[tokio::test]
    async fn chi_riguarda_chi() {
        let p = pubblica(&["inverter.main"]);
        assert!(riguarda(&p, "inverter"), "l'aggiornamento della radice tocca il ramo");
        assert!(!riguarda(&p, "inverter2"));
        assert!(!riguarda(&p, "casa.luce"));
        assert!(tocca("casa", "casa.luce"));
    }

    #[tokio::test]
    async fn la_disponibilita_segue_il_tag() {
        let db = db().await;
        let mut p = pubblica(&["inverter.main"]);
        p.disponibilita = serde_json::from_value(serde_json::json!({ "topic": "inverter/zcs/availability", "tag": "inv_sorgente.disponibile" })).unwrap();
        assert_eq!(disponibilita(&db, &p).await.unwrap().1, "offline", "senza valore");
        db.set("inv_sorgente.disponibile".into(), TagValue::Bool(true), TagQuality::Good).await;
        assert_eq!(disponibilita(&db, &p).await, Some(("inverter/zcs/availability".into(), "online".into())));
        assert!(riguarda(&p, "inv_sorgente.disponibile"));
    }

    #[tokio::test]
    async fn il_valore_nudo_di_un_tag_solo() {
        let db = db().await;
        db.set("inverter.main.battery_soc".into(), TagValue::Float(17.5), TagQuality::Good).await;
        let mut p = pubblica(&["inverter.main.battery_soc"]);
        p.formato = FormatoPubblicazione::Valore;
        assert_eq!(stato(&db, &p).await.as_deref(), Some("17.5"));
        p.tags = vec!["inverter.main".into()];
        assert_eq!(stato(&db, &p).await, None, "più di un valore non sta in un valore nudo");
    }
}
