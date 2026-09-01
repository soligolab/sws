//! Gli endpoint che servono all'assistente: **lo schema** e **il giudizio**.
//!
//! Sono due facce della stessa idea. Lo schema dice cosa si può scrivere prima
//! di scriverlo; la validazione dice se quel che è stato scritto sta in piedi,
//! **senza salvarlo**. Insieme chiudono il ciclo in cui un modello si corregge
//! da solo invece di lasciare il difetto al pannello.
//!
//! Valgono anche da soli, senza nessuna IA: `POST /api/project/validate` è il
//! primo posto in cui si può chiedere «questo progetto è valido?» senza
//! prima rovinarlo.

use axum::{extract::{Query, State}, response::{IntoResponse, Response}, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use sws_core::Project;

use crate::router::{active_dir, synoptics_dir_at, AppState};
use crate::synoptic::SynopticPage;
use crate::synoptic_schema as sch;
use crate::validate::{semantic, unknown_fields, Finding, Severity};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/project/validate
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ValidateBody {
    /// Il progetto proposto. Assente = quello su disco.
    #[serde(default)]
    pub project: Option<Value>,
    /// Le pagine proposte. Si **sovrappongono per nome** a quelle su disco:
    /// mandarne una non fa sparire le altre, altrimenti ogni proposta parziale
    /// sembrerebbe rompere tutte le navigazioni.
    #[serde(default)]
    pub pages: Option<Vec<Value>>,
}

#[derive(Debug, Serialize)]
struct ValidateOut {
    /// Nessun rilievo di gravità `error` **fra quelli nuovi**. Gli avvisi non
    /// tolgono l'`ok`, e nemmeno i difetti che c'erano già.
    ok: bool,
    /// Ogni rilievo porta `preesistente: true` se c'era anche prima della
    /// proposta. Senza questa distinzione un modello legge come colpa sua i
    /// difetti di pagine che non ha toccato, e prova a «sistemarli» — cioè fa
    /// esattamente quello che non gli è stato chiesto.
    findings: Vec<Value>,
    /// Quanti dei rilievi sono nuovi. È il numero che conta.
    nuovi: usize,
    /// Cosa è stato effettivamente guardato: senza, un `ok` su zero pagine
    /// sembrerebbe una promessa.
    checked: Value,
}

/// Chiave di confronto fra due passate di validazione. Percorso + messaggio:
/// la gravità e il suggerimento derivano da questi due.
fn chiave(f: &Finding) -> String {
    format!("{}\u{1}{}", f.path, f.message)
}

fn con_preesistenza(findings: Vec<Finding>, prima: &std::collections::HashSet<String>)
    -> (Vec<Value>, usize)
{
    let mut nuovi = 0;
    let out = findings.into_iter().map(|f| {
        let vecchio = prima.contains(&chiave(&f));
        if !vecchio {
            nuovi += 1;
        }
        let mut v = serde_json::to_value(&f).unwrap_or(Value::Null);
        if vecchio {
            v["preesistente"] = Value::Bool(true);
        }
        v
    }).collect();
    (out, nuovi)
}

/// `POST /api/project/validate` — Admin.
///
/// **Non scrive niente.** È l'unico endpoint che riceve un progetto e non lo
/// salva: se un giorno sembrerà strano, è deliberato.
///
/// Risponde sempre 200 con l'elenco dei rilievi. Un progetto non valido non è
/// un errore di protocollo: è una risposta con dentro cosa non va. Il 400 resta
/// per una richiesta malformata — cioè per chi sbaglia a chiedere, non a
/// progettare.
pub async fn validate_project(State(s): State<AppState>, Json(body): Json<ValidateBody>) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };

    let mut findings: Vec<Finding> = Vec::new();

    // ── 1. I campi inventati, dal JSON grezzo ────────────────────────────────
    // Prima di qualunque deserializzazione: dopo, l'informazione non c'è più.
    let raw_pages: Vec<Value> = body.pages.clone().unwrap_or_default();
    findings.extend(unknown_fields(body.project.as_ref(), &raw_pages));

    // ── 2. Il parser vero ────────────────────────────────────────────────────
    //
    // In mezzo passa la ricomposizione degli script: un progetto proposto che
    // omette `functions`/`global_scripts`, o che manda le entry senza `code`
    // come le restituisce `leggi_progetto`, va completato dal disco **prima**
    // di serde. Senza, il primo caso cancellava le funzioni e il secondo non si
    // leggeva affatto. Vedi `validate::ricomponi_script`.
    let disco = match Project::load(&dir) {
        Ok(p) => p,
        Err(e) => return (axum::http::StatusCode::SERVICE_UNAVAILABLE,
                          format!("il progetto su disco non si carica: {e:#}")).into_response(),
    };
    let mut grezzo = body.project.clone();
    if let Some(v) = grezzo.as_mut() {
        findings.extend(crate::validate::ricomponi_script(v, &disco));
    }
    let project: Project = match &grezzo {
        None => disco,
        Some(v) => match serde_json::from_value::<Project>(v.clone()) {
            Ok(p) => p,
            Err(e) => {
                findings.push(Finding {
                    severity: Severity::Error,
                    path: "project".into(),
                    message: format!("il progetto non si legge: {e}"),
                    hint: Some("manca un campo obbligatorio o un tipo non torna; il progetto \
                                deve essere completo, non una modifica parziale".into()),
                });
                let (findings, nuovi) = con_preesistenza(findings, &Default::default());
                return Json(ValidateOut { ok: false, findings, nuovi, checked: json!({}) })
                    .into_response();
            }
        },
    };

    // ── 3. Le pagine: quelle proposte sopra quelle su disco, per nome ────────
    let mut pages = match carica_pagine(&dir).await {
        Ok(p) => p,
        Err(e) => return (axum::http::StatusCode::SERVICE_UNAVAILABLE, e).into_response(),
    };
    for (i, raw) in raw_pages.iter().enumerate() {
        match serde_json::from_value::<SynopticPage>(raw.clone()) {
            Ok(p) => {
                match pages.iter().position(|x| x.name == p.name) {
                    Some(k) => pages[k] = p,
                    None => pages.push(p),
                }
            }
            Err(e) => findings.push(Finding {
                severity: Severity::Error,
                path: format!("pages[{i}]"),
                message: format!("la pagina non si legge: {e}"),
                hint: Some("una pagina ha bisogno almeno di `id`, `name` e `objects`".into()),
            }),
        }
    }

    // ── 4. Il giro completo, YAML compreso ───────────────────────────────────
    // Il progetto vive su disco in YAML: un valore che JSON accetta e serde_yaml
    // non sa scrivere passerebbe la validazione e romperebbe il salvataggio.
    if let Err(e) = serde_yaml::to_string(&project) {
        findings.push(Finding {
            severity: Severity::Error,
            path: "project".into(),
            message: format!("il progetto non si può scrivere in YAML: {e}"),
            hint: Some("è la forma in cui vive su disco: se non si serializza, non si salva".into()),
        });
    }

    findings.extend(semantic(&project, &pages));

    // ── 5. Cosa c'era già ────────────────────────────────────────────────────
    // Stessa validazione sul progetto e sulle pagine **come stanno su disco**.
    // Costa una manciata di millisecondi e cambia la qualità della risposta:
    // senza, la proposta si porta addosso ogni difetto ereditato del progetto.
    let mut prima: std::collections::HashSet<String> = Default::default();
    if let (Ok(p0), Ok(pg0)) = (Project::load(&dir), carica_pagine(&dir).await) {
        for f in semantic(&p0, &pg0) {
            prima.insert(chiave(&f));
        }
    }

    let ok = !findings.iter()
        .any(|f| f.severity == Severity::Error && !prima.contains(&chiave(f)));
    let checked = json!({
        "pages": pages.len(),
        "pages_proposte": raw_pages.len(),
        "tags": project.tags.len(),
        "sources": project.sources.len(),
        "alarms": project.alarms.len(),
    });
    let (findings, nuovi) = con_preesistenza(findings, &prima);
    Json(ValidateOut { ok, findings, nuovi, checked }).into_response()
}

async fn carica_pagine(dir: &std::path::Path) -> Result<Vec<SynopticPage>, String> {
    let sdir = synoptics_dir_at(dir);
    let mut out = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(&sdir).await else { return Ok(out) };
    while let Ok(Some(e)) = entries.next_entry().await {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("yaml") {
            continue;
        }
        let testo = tokio::fs::read_to_string(&path).await
            .map_err(|err| format!("{}: {err}", path.display()))?;
        // Una pagina su disco illeggibile non è colpa della proposta: la si
        // salta e si valida il resto, invece di rifiutare tutto.
        if let Ok(p) = serde_yaml::from_str::<SynopticPage>(&testo) {
            out.push(p);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schema/synoptic  e  GET /api/schema/source
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TipoQuery {
    /// Restringe la risposta a un tipo di oggetto (`button`, `gauge`, …).
    #[serde(default)]
    pub tipo: Option<String>,
}

/// `GET /api/schema/synoptic[?tipo=button]` — Admin.
///
/// Senza `tipo`: tutti i campi, tutti i tipi, tutti gli enum. Sono ~90 KB, e
/// vanno bene in un prompt che si mette in cache una volta sola.
///
/// Con `tipo`: i campi che quel tipo usa davvero nei progetti veri, più un
/// esempio. È la forma che serve quando il modello sta scrivendo un oggetto e
/// non deve leggersi 238 campi per trovarne otto.
pub async fn schema_synoptic(Query(q): Query<TipoQuery>) -> Response {
    let campi: Vec<Value> = sch::OBJECT_FIELDS.iter().map(campo_json).collect();
    let enums: Value = sch::FIELD_ENUMS.iter()
        .map(|(k, v)| (k.to_string(), json!(v)))
        .collect::<serde_json::Map<_, _>>().into();

    let Some(tipo) = q.tipo.as_deref() else {
        return Json(json!({
            "tipi": sch::OBJECT_TYPES,
            "campi_oggetto": campi,
            "campi_pagina": sch::PAGE_FIELDS.iter().map(campo_json).collect::<Vec<_>>(),
            "campi_tag": sch::TAG_FIELDS.iter().map(campo_json).collect::<Vec<_>>(),
            "enum": enums,
        })).into_response();
    };

    if !sch::OBJECT_TYPES.contains(&tipo) {
        return (axum::http::StatusCode::NOT_FOUND, Json(json!({
            "errore": format!("`{tipo}` non è un tipo di oggetto"),
            "tipi": sch::OBJECT_TYPES,
        }))).into_response();
    }

    let usati: &[&str] = sch::TYPE_USAGE.iter()
        .find(|(t, _)| *t == tipo).map(|(_, f)| *f).unwrap_or(&[]);
    // I campi che quel tipo usa nei progetti veri, con la loro documentazione.
    let campi_del_tipo: Vec<Value> = sch::OBJECT_FIELDS.iter()
        .filter(|f| usati.contains(&f.name))
        .map(campo_json)
        .collect();
    let esempio = sch::TYPE_EXAMPLES.iter().find(|(t, _)| *t == tipo).map(|(_, e)| *e);
    // Solo gli enum che riguardano questo tipo: gli altri sono rumore.
    let enum_del_tipo: Value = sch::FIELD_ENUMS.iter()
        .filter(|(k, _)| usati.contains(k))
        .map(|(k, v)| (k.to_string(), json!(v)))
        .collect::<serde_json::Map<_, _>>().into();

    Json(json!({
        "tipo": tipo,
        "campi": campi_del_tipo,
        "enum": enum_del_tipo,
        "esempio_yaml": esempio,
        "nota": "«campi» sono quelli che questo tipo usa nei progetti reali, non un elenco \
                 chiuso: il modello dati è piatto. Se ti serve un campo che non c'è qui, \
                 cercalo nell'elenco completo (GET /api/schema/synoptic senza ?tipo).",
    })).into_response()
}

/// `GET /api/schema/source[?kind=mqtt]` — Admin.
///
/// Serve per il caso che ha dato il via a T-50: senza, un modello non sa che
/// esiste `publish_topic`, e produce un bottone che accende una luce solo
/// sullo schermo.
pub async fn schema_source(Query(q): Query<KindQuery>) -> Response {
    let Some(kind) = q.kind.as_deref() else {
        return Json(json!({ "kinds": sch::SOURCE_KINDS })).into_response();
    };
    let Some((_, campi)) = sch::SOURCE_FIELDS.iter().find(|(k, _)| *k == kind) else {
        return (axum::http::StatusCode::NOT_FOUND, Json(json!({
            "errore": format!("`{kind}` non è un tipo di sorgente"),
            "kinds": sch::SOURCE_KINDS,
        }))).into_response();
    };
    Json(json!({
        "kind": kind,
        "campi": campi.iter().map(campo_json).collect::<Vec<_>>(),
        "mapping": mapping_json(kind),
        "esempio_yaml": sch::SOURCE_EXAMPLES.iter().find(|(k, _)| *k == kind).map(|(_, e)| *e),
    })).into_response()
}

#[derive(Debug, Deserialize)]
pub struct KindQuery {
    #[serde(default)]
    pub kind: Option<String>,
}

/// I campi del mapping tag↔device di una sorgente, che sono la parte che conta
/// per legare un tag a un indirizzo reale.
fn mapping_json(kind: &str) -> Value {
    let campi: &[sch::Field] = match kind {
        "mqtt" => sch::SOURCE_MQTT_TOPICMAPPING_FIELDS,
        "modbus_tcp" => sch::SOURCE_MODBUS_TCP_REGISTERMAPPING_FIELDS,
        "modbus_rtu" => sch::SOURCE_MODBUS_RTU_REGISTERMAPPING_FIELDS,
        "opcua_client" => sch::SOURCE_OPCUA_CLIENT_OPCUANODEMAPPING_FIELDS,
        "opcua_server" => sch::SOURCE_OPCUA_SERVER_OPCUASERVERNODEMAPPING_FIELDS,
        "homeassistant" => sch::SOURCE_HOMEASSISTANT_ENTITYMAPPING_FIELDS,
        "s7" => sch::SOURCE_S7_S7TAGMAPPING_FIELDS,
        "enip" => sch::SOURCE_ENIP_ENIPTAGMAPPING_FIELDS,
        _ => &[],
    };
    json!(campi.iter().map(campo_json).collect::<Vec<_>>())
}

fn campo_json(f: &sch::Field) -> Value {
    let mut o = serde_json::Map::new();
    o.insert("nome".into(), json!(f.name));
    o.insert("tipo".into(), json!(f.ty));
    if f.required {
        o.insert("obbligatorio".into(), json!(true));
    }
    if !f.group.is_empty() {
        o.insert("sezione".into(), json!(f.group));
    }
    if !f.doc.is_empty() {
        o.insert("doc".into(), json!(f.doc));
    }
    Value::Object(o)
}
