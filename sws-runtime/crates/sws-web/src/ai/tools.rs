//! Gli strumenti dell'assistente. È la parte che decide se funziona.
//!
//! # Perché sono modellati sul dominio e non sui file
//!
//! La tentazione è dare al modello `leggi_file` / `scrivi_file` e lasciarlo
//! lavorare sullo YAML. Sarebbe l'errore: inventerebbe nomi di campo, e ce ne
//! accorgeremmo dal pannello. Modellati sul dominio, invece, le cose sbagliate
//! diventano difficili da esprimere e quelle che restano le dice il validatore.
//!
//! # Chiamate interne, non HTTP
//!
//! Nessuno strumento fa una richiesta HTTP verso questo stesso processo: un
//! giro sulla rete per parlare con sé stessi sarebbe latenza e una superficie
//! in più a parità di tutto. Una conseguenza però va scritta a mano e non
//! ereditata: **la mascheratura dei segreti**. `GET /api/project` passa da
//! `mask_project_secrets`, ma quella vive nell'handler HTTP — leggendo da
//! dentro la si salterebbe, e le password dei driver finirebbero nel contesto
//! del modello. Qui si chiama esplicitamente (`leggi_progetto`).
//!
//! # Cosa NON c'è
//!
//! Niente esecuzione di Python (`/api/script/exec` gira senza sandbox quando
//! RestrictedPython manca, che sul PC di sviluppo è la norma), niente export
//! del progetto (lo ZIP porta i segreti in chiaro, decisione del 2026-07-29),
//! nessun `PUT`, nessun deploy, nessun accesso al filesystem. L'unico strumento
//! che cambia qualcosa è `proponi_modifica`, e non cambia niente: propone.

use serde_json::{json, Value};
use sws_core::Project;

use crate::router::{active_dir, mask_project_secrets, synoptics_dir_at, AppState};
use crate::synoptic::SynopticPage;
use crate::synoptic_schema as sch;
use crate::validate::{semantic, unknown_fields};

/// Le definizioni per l'API. L'ordine è stabile: entra nel prefisso della
/// cache, e un ordine che cambia butterebbe la cache a ogni turno.
pub fn definizioni() -> Vec<Value> {
    vec![
        strumento("elenca_pagine",
            "Le pagine sinottiche del progetto: id, nome, dimensioni, quanti oggetti. \
             Da chiamare per prima: senza, non sai su quale pagina lavorare.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false })),

        strumento("leggi_pagina",
            "Tutti gli oggetti di una pagina, come sono su disco. Serve prima di \
             modificarla: una proposta deve contenere la pagina INTERA, non solo \
             l'oggetto aggiunto.",
            json!({ "type": "object", "required": ["nome"], "additionalProperties": false,
                    "properties": { "nome": { "type": "string",
                        "description": "Il nome della pagina, come da elenca_pagine." } } })),

        strumento("leggi_progetto",
            "Il progetto senza le pagine: tag, sorgenti, allarmi, funzioni, lingue. \
             Le password sono mascherate e restano tali: se ne rimandi indietro una \
             mascherata, il server ricompone quella vera al salvataggio.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false })),

        strumento("elenca_tag",
            "I tag dichiarati, con tipo e descrizione. Un tag con `expression` è \
             calcolato: le scritture su di esso vengono rifiutate.",
            json!({ "type": "object", "properties": {
                        "filtro": { "type": "string",
                            "description": "Sottostringa dell'id, per non leggerli tutti." } },
                    "additionalProperties": false })),

        strumento("schema_oggetto",
            "I campi validi per un tipo di oggetto sinottico, con la loro \
             documentazione, i valori ammessi degli enum e un esempio YAML preso da \
             un progetto vero. CHIAMALO SEMPRE prima di scrivere un oggetto di un \
             tipo che non hai già guardato in questa conversazione.",
            json!({ "type": "object", "required": ["tipo"], "additionalProperties": false,
                    "properties": { "tipo": { "type": "string", "enum": sch::OBJECT_TYPES } } })),

        strumento("schema_sorgente",
            "I campi validi per un tipo di sorgente dati e per il suo mapping \
             tag↔device, con un esempio reale. Per MQTT è qui che si scopre \
             `publish_topic`, senza il quale un comando non esce dal broker.",
            json!({ "type": "object", "required": ["kind"], "additionalProperties": false,
                    "properties": { "kind": { "type": "string", "enum": sch::SOURCE_KINDS } } })),

        strumento("valida",
            "Dice se una modifica sta in piedi, SENZA salvarla. Restituisce rilievi \
             con il percorso del campo e come si aggiusta. I rilievi marcati \
             `preesistente` c'erano già prima della tua proposta: non sono compito \
             tuo e non vanno corretti se nessuno te l'ha chiesto.",
            json!({ "type": "object", "additionalProperties": false, "properties": {
                        "project": { "type": "object",
                            "description": "Il progetto intero, modificato. Ometti se non lo tocchi." },
                        "pages": { "type": "array", "items": { "type": "object" },
                            "description": "Le pagine intere, modificate. Ometti quelle che non tocchi." } } })),

        strumento("proponi_modifica",
            "Manda la proposta alla persona che sta chattando, che la vede come diff \
             e decide se applicarla. NON salva e NON applica niente. Chiude il tuo \
             turno: dopo questa chiamata aspetti una risposta umana. Valida da sola \
             prima di inviare, e se trova errori te li ridà invece di inoltrarla.",
            json!({ "type": "object", "required": ["motivo"], "additionalProperties": false,
                    "properties": {
                        "motivo": { "type": "string",
                            "description": "Una riga, in italiano, che dice cosa fa la modifica. \
                                            Finisce nell'etichetta dell'annullamento: \
                                            «Assistente: <motivo>»." },
                        "project": { "type": "object",
                            "description": "Il progetto intero, modificato. Ometti se non lo tocchi." },
                        "pages": { "type": "array", "items": { "type": "object" },
                            "description": "Le pagine intere, modificate." } } })),

        // In coda, e non in mezzo: l'ordine entra nel prefisso della cache.
        strumento("schema_tag",
            "I campi validi di una definizione di tag, con i valori ammessi. \
             CHIAMALO prima di dichiarare un tag nuovo: il campo del tipo si chiama \
             `data_type` e non `type`, ed è l'errore che costa un giro di validazione.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false })),

        // ── Python. Aggiunti in coda per la stessa ragione di sopra. ─────────
        strumento("leggi_script",
            "Il codice Python di una funzione di progetto o di uno script globale. \
             `leggi_progetto` NON lo restituisce (e' lungo e quasi mai utile per \
             disegnare): per modificare del codice esistente devi leggerlo da qui \
             prima, altrimenti lo riscrivi da zero e cancelli quello che c'era.",
            json!({ "type": "object", "additionalProperties": false, "properties": {
                        "funzione": { "type": "string",
                            "description": "Nome della funzione di progetto (come da leggi_progetto)." },
                        "script_globale": { "type": "string",
                            "description": "Id dello script globale." } } })),

        strumento("schema_python",
            "Cosa si puo' scrivere negli script: le variabili disponibili, cosa la \
             sandbox vieta, i tipi di trigger degli script globali e i limiti. \
             CHIAMALO prima di scrivere Python: qui non e' Python normale — non ci \
             sono `import`, e i tag si leggono e scrivono da `tags`.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false })),

        strumento("istantanea_pagina",
            "GUARDA come il motore LVGL disegna una pagina: restituisce \
             un'IMMAGINE. E' l'unico modo di verificare quello che hai \
             disegnato invece di dichiararlo fatto — il motore del pannello e \
             quello del browser disegnano lo stesso progetto in modo diverso, e \
             le differenze non danno nessun altro segnale. Fotografa il \
             progetto COME STA SUL DISCO, quindi dopo che una proposta e' stata \
             applicata. Due cose da sapere leggendo l'immagine: i colori tornano \
             quantizzati in RGB565 (un #3b82f6 esce come rgb(57,129,246)), \
             quindi NON concludere che il colore e' sbagliato per una \
             differenza di uno o due; e un widget che disegna a piu' giri \
             (gauge, grafici) vuole piu' millisecondi, altrimenti lo fotografi \
             a meta'. \
             IMPORTANTE: i tag valgono il loro valore INIZIALE, non quello del \
             campo — il banco di prova non si collega alle sorgenti di \
             proposito, perche' un secondo runtime collegato all'impianto \
             manderebbe notifiche e disturberebbe il broker. Quindi questa \
             immagine dice COM'E' FATTA la pagina (posizioni, dimensioni, \
             colori, testi, quali widget LVGL disegna e quali no), NON cosa \
             mostra l'impianto adesso: non usarla per concludere niente sui \
             valori.",
            json!({ "type": "object", "additionalProperties": false, "properties": {
                "nome": { "type": "string",
                    "description": "La pagina da fotografare. Se manca, quella iniziale del progetto." },
                "tocca": { "type": "string",
                    "description": "Tocchi prima dello scatto, `x,y` separati da `;` \
                                    (coordinate di pagina, le stesse dell'IDE). Serve a vedere \
                                    cosa succede DOPO un tocco: la finestra di conferma di un \
                                    comando, un pulsante premuto. Con i tocchi alza `ms`." },
                "ms": { "type": "integer",
                    "description": "Millisecondi di rendering prima dello scatto (default 500). \
                                    Con i tocchi 800-1500." } } })),

        strumento("controlla_python",
            "Compila del codice Python e dice se sta in piedi, SENZA eseguirlo: \
             nessun tag scritto, nessun effetto. Distingue un errore di sintassi \
             (con la riga) da una cosa che la sandbox vieta pur essendo Python \
             valido. CHIAMALO SEMPRE prima di proporre del codice: proporre \
             Python che non compila fa perdere un giro a chi legge il diff.",
            json!({ "type": "object", "required": ["codice"], "additionalProperties": false,
                    "properties": { "codice": { "type": "string",
                        "description": "Il corpo Python, come lo metteresti in `code`." } } })),
    ]
}

fn strumento(nome: &str, descrizione: &str, schema: Value) -> Value {
    json!({ "name": nome, "description": descrizione, "input_schema": schema })
}

/// Il risultato di uno strumento, o il motivo per cui non si è potuto fare.
/// L'errore torna al modello come `tool_result` con `is_error`, non come
/// eccezione: un errore che il modello non vede è un errore che ripete.
pub type Esito = Result<Value, String>;

pub async fn esegui(s: &AppState, nome: &str, input: &Value) -> Esito {
    match nome {
        "elenca_pagine" => elenca_pagine(s).await,
        "leggi_pagina" => leggi_pagina(s, arg_str(input, "nome")?).await,
        "leggi_progetto" => leggi_progetto(s).await,
        "elenca_tag" => elenca_tag(s, input.get("filtro").and_then(Value::as_str)).await,
        "schema_oggetto" => schema_oggetto(arg_str(input, "tipo")?),
        "schema_sorgente" => schema_sorgente(arg_str(input, "kind")?),
        "schema_tag" => schema_tag(),
        "valida" => valida(s, input).await,
        "leggi_script" => leggi_script(s, input).await,
        "schema_python" => schema_python(s.py.is_sandboxed()),
        "controlla_python" => controlla_python(s, arg_str(input, "codice")?).await,
        // `proponi_modifica` non passa di qui: la intercetta il ciclo, perché
        // è l'unica che non produce un risultato da rimandare al modello ma
        // chiude il turno verso il browser.
        altro => Err(format!("strumento sconosciuto: `{altro}`")),
    }
}

fn arg_str<'a>(input: &'a Value, nome: &str) -> Result<&'a str, String> {
    input.get(nome).and_then(Value::as_str)
        .ok_or_else(|| format!("manca l'argomento obbligatorio `{nome}`"))
}

async fn dir_progetto(s: &AppState) -> Result<std::path::PathBuf, String> {
    active_dir(s).await.map_err(|_| "nessun progetto aperto".to_string())
}

async fn carica_progetto(s: &AppState) -> Result<Project, String> {
    let dir = dir_progetto(s).await?;
    Project::load(&dir).map_err(|e| format!("il progetto non si carica: {e:#}"))
}

pub async fn carica_pagine(s: &AppState) -> Result<Vec<SynopticPage>, String> {
    let dir = dir_progetto(s).await?;
    let sdir = synoptics_dir_at(&dir);
    let mut out = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(&sdir).await else { return Ok(out) };
    while let Ok(Some(e)) = entries.next_entry().await {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("yaml") {
            continue;
        }
        if let Ok(testo) = tokio::fs::read_to_string(&path).await {
            if let Ok(p) = serde_yaml::from_str::<SynopticPage>(&testo) {
                out.push(p);
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

async fn elenca_pagine(s: &AppState) -> Esito {
    let pagine = carica_pagine(s).await?;
    Ok(json!(pagine.iter().map(|p| json!({
        "id": p.id, "nome": p.name,
        "width": p.width, "height": p.height,
        "oggetti": p.objects.len(),
    })).collect::<Vec<_>>()))
}

async fn leggi_pagina(s: &AppState, nome: &str) -> Esito {
    let pagine = carica_pagine(s).await?;
    match pagine.iter().find(|p| p.name == nome) {
        Some(p) => serde_json::to_value(p).map_err(|e| e.to_string()),
        None => Err(format!("la pagina `{nome}` non esiste. Ci sono: {}",
                            pagine.iter().map(|p| p.name.as_str())
                                  .collect::<Vec<_>>().join(", "))),
    }
}

async fn leggi_progetto(s: &AppState) -> Esito {
    let mut p = carica_progetto(s).await?;
    // Non ereditata dall'handler HTTP: qui si entra da dentro.
    mask_project_secrets(&mut p);
    let mut v = serde_json::to_value(&p).map_err(|e| e.to_string())?;
    // Le funzioni portano il corpo Python: lungo, e quasi mai utile per
    // disegnare. Restano i nomi, che è ciò che serve per agganciare un evento.
    if let Some(f) = v.get_mut("functions").and_then(Value::as_array_mut) {
        for fn_ in f.iter_mut() {
            if let Some(o) = fn_.as_object_mut() {
                o.remove("code");
            }
        }
    }
    Ok(v)
}

async fn elenca_tag(s: &AppState, filtro: Option<&str>) -> Esito {
    let p = carica_progetto(s).await?;
    let f = filtro.unwrap_or("");
    Ok(json!(p.tags.iter()
        .filter(|t| f.is_empty() || t.id.contains(f))
        .map(|t| {
            let mut o = serde_json::Map::new();
            o.insert("id".into(), json!(t.id));
            o.insert("data_type".into(), json!(t.data_type));
            if !t.description.is_empty() { o.insert("descrizione".into(), json!(t.description)); }
            if let Some(u) = &t.unit { o.insert("unit".into(), json!(u)); }
            if t.expression.is_some() {
                o.insert("calcolato".into(), json!(true));
                o.insert("scrivibile".into(), json!(false));
            }
            Value::Object(o)
        }).collect::<Vec<_>>()))
}

/// I campi di un tag.
///
/// Esisteva già `TAG_FIELDS` nel mirror e l'endpoint HTTP lo serviva
/// (`GET /api/schema/synoptic` senza `?tipo`), ma nessuno **strumento** lo
/// esponeva: `schema_oggetto` e `schema_sorgente` sì, i tag no. Il risultato,
/// misurato due volte su due prove con Kimi K3 il 2026-09-01, è che il modello
/// scriveva `type` invece di `data_type`, veniva rifiutato dal validatore e si
/// correggeva — un giro buttato per proposta, ogni volta che il progetto non ha
/// già un tag da cui copiare la forma.
fn schema_tag() -> Esito {
    let nomi: Vec<&str> = sch::TAG_FIELDS.iter().map(|f| f.name).collect();
    Ok(json!({
        "campi": sch::TAG_FIELDS.iter().map(campo).collect::<Vec<_>>(),
        "enum": sch::FIELD_ENUMS.iter().filter(|(k, _)| nomi.contains(k))
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect::<serde_json::Map<_, _>>(),
        "nota": "Il tipo di un tag è `data_type`, con valori \"bool\", \"int\", \"float\" \
                 o \"string\". Un tag con `expression` è calcolato: non si può scrivere.",
    }))
}

fn schema_oggetto(tipo: &str) -> Esito {
    if !sch::OBJECT_TYPES.contains(&tipo) {
        return Err(format!("`{tipo}` non è un tipo di oggetto. Sono: {}",
                           sch::OBJECT_TYPES.join(", ")));
    }
    // Stessa regola dell'endpoint HTTP, e la ragione per cui è una funzione sola
    // sta nel suo commento: `TYPE_USAGE` da solo aveva convinto un modello che
    // `button_mode` non esiste.
    Ok(json!({
        "tipo": tipo,
        "campi": crate::schema_api::campi_del_tipo(tipo).into_iter()
            .map(campo).collect::<Vec<_>>(),
        "enum": crate::schema_api::enum_del_tipo(tipo),
        "esempio_yaml": sch::TYPE_EXAMPLES.iter().find(|(t, _)| *t == tipo).map(|(_, e)| *e),
        "nota": "«campi» sono quelli che questo tipo usa nei progetti reali, più tutti \
                 quelli che ne portano il prefisso. Il modello dati è piatto: se ti serve \
                 un campo che non è elencato qui esiste comunque — ma verifica il nome, \
                 non inventarlo.",
    }))
}

fn schema_sorgente(kind: &str) -> Esito {
    let Some((_, campi)) = sch::SOURCE_FIELDS.iter().find(|(k, _)| *k == kind) else {
        return Err(format!("`{kind}` non è un tipo di sorgente. Sono: {}",
                           sch::SOURCE_KINDS.join(", ")));
    };
    Ok(json!({
        "kind": kind,
        "campi": campi.iter().map(campo).collect::<Vec<_>>(),
        "mapping": crate::ai::mapping_di(kind).iter().map(campo).collect::<Vec<_>>(),
        "esempio_yaml": sch::SOURCE_EXAMPLES.iter().find(|(k, _)| *k == kind).map(|(_, e)| *e),
    }))
}

fn campo(f: &sch::Field) -> Value {
    let mut o = serde_json::Map::new();
    o.insert("nome".into(), json!(f.name));
    o.insert("tipo".into(), json!(f.ty));
    if f.required { o.insert("obbligatorio".into(), json!(true)); }
    if !f.doc.is_empty() { o.insert("doc".into(), json!(f.doc)); }
    Value::Object(o)
}

/// Il giudizio su una proposta. Stessa logica dell'endpoint HTTP, chiamata da
/// dentro — e con la stessa distinzione fra rilievi nuovi e preesistenti.
pub async fn valida(s: &AppState, input: &Value) -> Esito {
    valida_interna(s, input).await.map(|(giudizio, _)| giudizio)
}

/// Come [`valida`], ma restituisce anche il progetto **ricomposto**.
///
/// Serve a `proponi`, che deve mandare al browser quello che ha davvero
/// validato. Prima mandava `input["project"]` grezzo: se la proposta ometteva
/// `functions`, il browser riceveva un progetto senza funzioni e il Salva le
/// cancellava dal disco — la validazione era corretta e l'oggetto spedito no.
///
/// `None` significa «la proposta non toccava il progetto»: si è validato quello
/// del disco e non c'è niente da spedire.
pub async fn valida_interna(s: &AppState, input: &Value) -> Result<(Value, Option<Value>), String> {
    let dir = dir_progetto(s).await?;
    let raw_pages: Vec<Value> = input.get("pages").and_then(Value::as_array)
        .cloned().unwrap_or_default();

    // Sul grezzo **originale**, prima di ricomporre: dopo, un `codice:` scritto
    // male non si distinguerebbe più da un corpo che il modello non ha mandato.
    let mut findings = unknown_fields(input.get("project"), &raw_pages);

    let disco = Project::load(&dir)
        .map_err(|e| format!("il progetto sul disco non si carica: {e:#}"))?;

    let (project, normalizzato): (Project, Option<Value>) = match input.get("project") {
        // Ricaricato invece di clonato: `Project` non è `Clone`, e `disco`
        // serve ancora sotto per i rilievi preesistenti.
        None => (Project::load(&dir)
                     .map_err(|e| format!("il progetto non si carica: {e:#}"))?, None),
        Some(v) => {
            let mut grezzo = v.clone();
            findings.extend(crate::validate::ricomponi_script(&mut grezzo, &disco));
            let p = serde_json::from_value(grezzo.clone())
                .map_err(|e| format!("il progetto proposto non si legge: {e}. Deve essere il \
                                      progetto INTERO come te l'ha dato leggi_progetto, con la \
                                      tua modifica dentro — non solo la parte cambiata."))?;
            (p, Some(grezzo))
        }
    };

    let mut pagine = carica_pagine(s).await?;
    for (i, raw) in raw_pages.iter().enumerate() {
        match serde_json::from_value::<SynopticPage>(raw.clone()) {
            Ok(p) => match pagine.iter().position(|x| x.name == p.name) {
                Some(k) => pagine[k] = p,
                None => pagine.push(p),
            },
            Err(e) => return Err(format!("pages[{i}] non si legge come pagina: {e}. Una \
                                          pagina ha bisogno di `id`, `name` e `objects`.")),
        }
    }

    findings.extend(semantic(&project, &pagine));

    let mut prima = std::collections::HashSet::new();
    {
        let pg0 = carica_pagine(s).await.unwrap_or_default();
        for f in semantic(&disco, &pg0) {
            prima.insert(format!("{}\u{1}{}", f.path, f.message));
        }
    }

    let mut nuovi = 0usize;
    let elenco: Vec<Value> = findings.iter().map(|f| {
        let vecchio = prima.contains(&format!("{}\u{1}{}", f.path, f.message));
        if !vecchio { nuovi += 1; }
        let mut v = serde_json::to_value(f).unwrap_or(Value::Null);
        if vecchio { v["preesistente"] = Value::Bool(true); }
        v
    }).collect();

    let errori_nuovi = findings.iter().filter(|f|
        f.severity == crate::validate::Severity::Error
        && !prima.contains(&format!("{}\u{1}{}", f.path, f.message))).count();

    Ok((json!({
        "ok": errori_nuovi == 0,
        "errori_nuovi": errori_nuovi,
        "rilievi_nuovi": nuovi,
        "rilievi": elenco,
    }), normalizzato))
}

// ─────────────────────────────────────────────────────────────────────────────
// Python
// ─────────────────────────────────────────────────────────────────────────────

/// Il codice di una funzione o di uno script globale.
///
/// `leggi_progetto` toglie `code` di proposito: il corpo Python è lungo e per
/// disegnare un sinottico non serve mai. Ma senza un modo di leggerlo, un
/// assistente cui si chiede «aggiungi un controllo a questa funzione» non può
/// che **riscriverla da zero**, cancellando quello che c'era senza accorgersene
/// — e il diff mostrerebbe una funzione «modificata», non che ne è sparita
/// metà. Questo strumento è la via per non arrivarci.
async fn leggi_script(s: &AppState, input: &Value) -> Esito {
    let p = carica_progetto(s).await?;
    let funzione = input.get("funzione").and_then(Value::as_str);
    let globale  = input.get("script_globale").and_then(Value::as_str);

    match (funzione, globale) {
        (Some(nome), None) => match p.functions.iter().find(|f| f.name == nome) {
            Some(f) => Ok(json!({
                "tipo": "funzione", "nome": f.name, "id": f.id,
                "descrizione": f.description,
                "parametri": f.params.iter().map(|x| json!({ "nome": x.name })).collect::<Vec<_>>(),
                "codice": f.code,
                "righe": f.code.lines().count(),
            })),
            None => Err(format!(
                "la funzione `{nome}` non esiste. Ci sono: {}",
                elenco_o_nessuno(p.functions.iter().map(|f| f.name.as_str())))),
        },
        (None, Some(id)) => match p.global_scripts.iter().find(|g| g.id == id) {
            Some(g) => Ok(json!({
                "tipo": "script_globale", "id": g.id,
                "trigger": g.trigger, "enabled": g.enabled,
                "codice": g.code,
                "righe": g.code.lines().count(),
            })),
            None => Err(format!(
                "lo script globale `{id}` non esiste. Ci sono: {}",
                elenco_o_nessuno(p.global_scripts.iter().map(|g| g.id.as_str())))),
        },
        (Some(_), Some(_)) => Err("passa `funzione` **oppure** `script_globale`, non entrambi: \
                                   sono due cose diverse e leggerne due in una volta \
                                   nasconderebbe quale hai chiesto".into()),
        (None, None) => Err("manca l'argomento: `funzione` (per nome) oppure \
                            `script_globale` (per id)".into()),
    }
}

fn elenco_o_nessuno<'a>(it: impl Iterator<Item = &'a str>) -> String {
    let v: Vec<&str> = it.collect();
    if v.is_empty() { "nessuno".into() } else { v.join(", ") }
}

/// L'ambiente in cui gli script girano.
///
/// Non è Python normale, e le differenze sono esattamente quelle su cui un
/// modello sbaglia: non ci sono `import`, i tag non sono variabili globali ma
/// voci di `tags`, e il corpo ha un tetto di byte. Dirlo qui costa una chiamata
/// e risparmia un giro di validazione — la stessa ragione per cui esiste
/// `schema_tag`.
///
/// `sandbox_attiva` è letta dal motore e **non** cablata: sul PC di sviluppo
/// RestrictedPython spesso manca, e in quel caso un `import` passa qui e viene
/// rifiutato sul dispositivo. È una differenza che va detta, non taciuta.
/// Prende il `bool` e non `&AppState`: cosi' e' una funzione pura e il suo
/// **contenuto** si puo' provare. Quel contenuto e' un elenco di fatti sul
/// sandbox — cosa c'e', cosa e' vietato, la forma del cron, il tetto di byte —
/// ed e' esattamente il genere di testo che resta indietro quando il codice
/// cambia, senza che niente lo segnali.
fn schema_python(sandbox_attiva: bool) -> Esito {
    Ok(json!({
        "disponibili": [
            { "nome": "tags", "cosa": "I tag del progetto. `tags['id']` legge, \
                `tags['id'] = valore` scrive. Un tag con `expression` è calcolato: \
                scriverlo viene rifiutato." },
            { "nome": "print", "cosa": "Finisce nello stdout catturato e nel log. \
                Serve per la diagnosi, non per comunicare con l'operatore." },
            { "nome": "send_telegram", "cosa": "`send_telegram('testo')`. Funziona solo \
                se il canale Telegram è configurato nelle notifiche del progetto." },
        ],
        "vietati": [
            "`import` di qualunque modulo — niente `os`, `time`, `requests`, `math`.",
            "gli attributi dunder (`__class__`, `__globals__`…).",
            "`exec`, `eval`, `open`, l'accesso al filesystem e alla rete.",
        ],
        "sandbox_attiva": sandbox_attiva,
        "nota_sandbox": if sandbox_attiva {
            "La sandbox è attiva su questa istanza: i divieti sopra sono applicati."
        } else {
            "ATTENZIONE: RestrictedPython non è installata su questa istanza, quindi i \
             divieti NON sono applicati **qui**. Sul dispositivo lo sono: scrivere un \
             `import` funzionerebbe in prova e verrebbe rifiutato in campo. Non usarli."
        },
        "trigger_script_globali": [
            { "kind": "startup", "quando": "una volta all'apertura del progetto" },
            { "kind": "interval", "campi": { "interval_s": "secondi, intero" } },
            { "kind": "cron", "campi": { "schedule": "cron a CINQUE campi: \
                `min ora giorno mese giorno-settimana`. `*/5 * * * *` = ogni cinque \
                minuti. Un solo campo (`*/5`) NON è valido." } },
            { "kind": "tag_change", "campi": { "tag": "id del tag",
                "edge": "\"rising\" | \"falling\" | \"any\" (default)" } },
        ],
        "limiti": {
            "byte_massimi_del_codice": sws_core::project::MAX_FUNCTION_CODE_BYTES,
            "timeout": "impostato da SWS_SCRIPT_TIMEOUT_MS (5 s per default). Uno script \
                        che lo supera viene interrotto.",
        },
        "dove_va_il_codice": {
            "functions[]": "funzioni richiamabili dagli oggetti (`on_press_fn`, \
                            `on_release_fn`) e da `POST /api/script/run/<nome>`. \
                            Campi: `id`, `name`, `code`, `params`.",
            "global_scripts[]": "script con un trigger proprio. Campi: `id`, `trigger`, \
                                 `code`, `enabled`.",
        },
    }))
}

/// Compila e non esegue. Vedi `Engine::check`.
///
/// Il valore non è «dire se compila»: è **quale** dei due guasti è. Un errore di
/// sintassi si corregge rileggendo la riga; un divieto della sandbox no — quel
/// codice è Python valido e va cambiato approccio. Collassarli in un solo
/// messaggio manderebbe il modello a cercare una virgola inesistente.
async fn controlla_python(s: &AppState, codice: &str) -> Esito {
    let esito = s.py.check(codice.to_string()).await;
    let mut v = serde_json::to_value(&esito).map_err(|e| e.to_string())?;
    if let Some(o) = v.as_object_mut() {
        o.insert("come_leggerlo".into(), json!(
            "`vietato: false` = errore di sintassi, guarda `riga`. \
             `vietato: true` = Python valido ma proibito dalla sandbox: cambia strada, \
             non la virgola. `sandbox_verificata: false` = i divieti non sono stati \
             controllati su questa istanza, ma sul dispositivo valgono."));
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il difetto che ha fatto proporre un checkbox invece di un bottone.
    ///
    /// `TYPE_USAGE` elenca i campi che i template usano davvero, e nessuno dei
    /// nostri usa `button_mode`: il modello ha chiesto lo schema, ha letto 12
    /// campi senza la modalità, e ne ha dedotto — scrivendolo — che il toggle
    /// non esiste. Misurato con Kimi K3 il 2026-09-01.
    #[test]
    fn lo_schema_del_bottone_dice_come_si_fa_un_toggle() {
        let v = schema_oggetto("button").expect("button è un tipo valido");
        let campi: Vec<&str> = v["campi"].as_array().unwrap().iter()
            .map(|c| c["nome"].as_str().or_else(|| c["name"].as_str()).unwrap_or(""))
            .collect();
        assert!(campi.contains(&"button_mode"),
                "senza button_mode il modello ripiega su un altro widget: {campi:?}");
        // Il campo senza i suoi valori ammessi non basta: `toggle` va nominato.
        let e = v["enum"]["button_mode"].as_array()
            .expect("button_mode deve portare il suo enum");
        assert!(e.iter().any(|x| x == "toggle"), "enum: {e:?}");
    }

    /// E il verso rotto della stessa regola: non deve mostrare i campi di *altri*
    /// tipi, altrimenti il rimedio diventa il rumore da cui `TYPE_USAGE` protegge.
    #[test]
    fn ma_non_mostra_i_campi_degli_altri_tipi() {
        let v = schema_oggetto("button").unwrap();
        let campi: Vec<&str> = v["campi"].as_array().unwrap().iter()
            .map(|c| c["nome"].as_str().or_else(|| c["name"].as_str()).unwrap_or(""))
            .collect();
        for estraneo in ["gauge_min", "spark_points", "trend_dt_format", "pie_show_labels"] {
            assert!(!campi.contains(&estraneo), "`{estraneo}` non riguarda un bottone");
        }
    }

    /// Il tipo di un tag si chiama `data_type`. Il modello ha sbagliato due volte
    /// su due prove, perché nessuno strumento glielo diceva.
    #[test]
    fn lo_schema_del_tag_esiste_e_nomina_data_type() {
        let v = schema_tag().unwrap();
        let campi: Vec<&str> = v["campi"].as_array().unwrap().iter()
            .map(|c| c["nome"].as_str().or_else(|| c["name"].as_str()).unwrap_or(""))
            .collect();
        assert!(campi.contains(&"data_type"), "campi: {campi:?}");
        assert!(campi.contains(&"id"));
        assert!(v["nota"].as_str().unwrap().contains("data_type"));
    }

    /// L'ordine degli strumenti entra nel prefisso della cache: uno strumento
    /// nuovo va in coda, e cambiarne la posizione butta la cache a ogni turno.
    ///
    /// Il test asseriva anche che l'ultimo fosse `schema_tag`, cioè «l'ultimo
    /// aggiunto finora»: vero quando è stato scritto, e falso al primo strumento
    /// successivo. Ora asserisce **il prefisso**, che è l'invariante vera — chi
    /// aggiunge in coda passa, chi riordina il prefisso no.
    #[test]
    fn il_prefisso_degli_strumenti_non_si_muove() {
        const PREFISSO: [&str; 9] = [
            "elenca_pagine", "leggi_pagina", "leggi_progetto", "elenca_tag",
            "schema_oggetto", "schema_sorgente", "valida", "proponi_modifica",
            "schema_tag",
        ];
        let d = definizioni();
        let nomi: Vec<&str> = d.iter().map(|x| x["name"].as_str().unwrap()).collect();
        assert!(nomi.len() >= PREFISSO.len(), "strumenti spariti: {nomi:?}");
        assert_eq!(&nomi[..PREFISSO.len()], &PREFISSO[..],
                   "il prefisso della cache si è mosso: {nomi:?}");
    }

    /// Lo schema Python nomina le tre cose su cui un modello sbaglia.
    ///
    /// Non e' un test di forma: sono i fatti che, se restano indietro, fanno
    /// perdere un giro a ogni proposta con del codice — la stessa famiglia del
    /// difetto per cui `schema_tag` e' nato (il modello scriveva `type` invece
    /// di `data_type` e veniva rifiutato dal validatore).
    #[test]
    fn lo_schema_python_dice_i_fatti_che_contano() {
        let v = schema_python(true).unwrap();
        let tutto = serde_json::to_string(&v).unwrap();

        // 1. Gli `import` sono vietati: e' la differenza piu' grossa da Python.
        assert!(tutto.contains("import"), "i divieti devono nominare `import`");
        // 2. I tag si leggono da `tags`, non sono variabili globali.
        assert!(v["disponibili"].as_array().unwrap().iter()
                    .any(|d| d["nome"] == "tags"),
                "`tags` deve essere fra le cose disponibili: {tutto}");
        // 3. Il cron ha CINQUE campi, e un solo campo non e' valido: e'
        //    l'errore che STATUS registra come da prevenire.
        assert!(tutto.contains("CINQUE") || tutto.contains("cinque"),
                "la forma del cron va detta: {tutto}");
        // Il tetto di byte viene dalla costante, non da un numero copiato.
        assert!(tutto.contains(&sws_core::project::MAX_FUNCTION_CODE_BYTES.to_string()));
    }

    /// E il verso che conta di piu': senza sandbox non deve **far credere** di
    /// aver controllato i divieti. Sul PC di sviluppo RestrictedPython manca,
    /// quindi un `import` passa in prova e viene rifiutato in campo: se lo
    /// schema tacesse, il modello lo userebbe.
    #[test]
    fn senza_sandbox_lo_schema_avverte_invece_di_tacere() {
        let acceso = schema_python(true).unwrap();
        let spento  = schema_python(false).unwrap();

        assert_eq!(acceso["sandbox_attiva"], serde_json::json!(true));
        assert_eq!(spento["sandbox_attiva"], serde_json::json!(false));

        let nota = spento["nota_sandbox"].as_str().unwrap();
        assert!(nota.contains("ATTENZIONE"), "l'avviso deve essere visibile: {nota}");
        assert!(nota.contains("dispositivo"),
                "deve dire che sul dispositivo i divieti valgono: {nota}");
        // E il ramo acceso non deve portare lo stesso avviso, altrimenti e' rumore.
        assert!(!acceso["nota_sandbox"].as_str().unwrap().contains("ATTENZIONE"));
    }

    /// Gli strumenti Python sono dichiarati e raggiungibili dal dispatch.
    ///
    /// Il verso rotto è preciso e capitato altrove in questa stessa famiglia
    /// (`schema_tag` esisteva come endpoint ma nessuno strumento lo esponeva, e
    /// il modello ci ha rimesso un giro per proposta): uno strumento dichiarato
    /// ma non instradato risponderebbe «strumento sconosciuto» al modello, che è
    /// un errore che il modello ripete.
    #[test]
    fn gli_strumenti_python_sono_dichiarati() {
        let nomi: Vec<String> = definizioni().iter()
            .map(|x| x["name"].as_str().unwrap().to_string()).collect();
        for atteso in ["leggi_script", "schema_python", "controlla_python"] {
            assert!(nomi.iter().any(|n| n == atteso), "manca `{atteso}`: {nomi:?}");
        }
    }
}
