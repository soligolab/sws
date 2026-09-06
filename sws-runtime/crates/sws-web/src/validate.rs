//! Dice se una modifica al progetto è accettabile, **senza salvarla**.
//!
//! # Perché esiste
//!
//! Fino a oggi le validazioni vivevano dentro i singoli `PUT`: si scopriva che
//! qualcosa era sbagliato *salvandolo*. Per una persona che disegna a mano va
//! bene — vede il risultato e torna indietro. Per un assistente che propone una
//! modifica non va: senza un giudizio prima del salvataggio, l'unico modo di
//! sapere se ha scritto bene è scrivere sul disco e guardare il pannello.
//!
//! Questo modulo è quel giudizio. Restituisce rilievi strutturati — percorso
//! del campo, cosa non va, come si aggiusta — perché il destinatario non è un
//! umano che legge un messaggio d'errore ma un modello che deve correggersi da
//! solo. Un `anyhow` appiattito non serve a niente a nessuno dei due.
//!
//! # Le due metà
//!
//! [`unknown_fields`] guarda il JSON **grezzo**: i campi inventati. È la metà
//! che conta di più, perché serde scarta in silenzio ciò che non conosce — il
//! modello scrive `objects:` dentro una cella di griglia, la cella resta vuota,
//! e nessuno collega le due cose. Sono due difetti veri del 2026-08-31.
//!
//! [`semantic`] guarda il progetto già tipizzato: riferimenti che non
//! risolvono, tipi che non tornano, comandi che non arriveranno mai al device.
//!
//! # Cosa NON fa
//!
//! Non dice se una pagina è *bella*, né se il pannello LVGL la disegnerà come
//! il browser. La prima non è verificabile; la seconda vuole l'istantanea del
//! viewer, che è un'altra cosa (`docs/HOWTO.md` §6).

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use sws_core::{Project, SourceDef, TopicMapping};

use crate::synoptic::{SynopticObject, SynopticPage};
use crate::synoptic_schema::{FIELD_ENUMS, OBJECT_FIELDS, OBJECT_TYPES, PAGE_FIELDS, TAG_FIELDS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Il progetto è rotto: qualcosa non funzionerà, o sparirà nel salvataggio.
    Error,
    /// Il progetto funziona ma probabilmente non fa quel che si voleva.
    Warning,
}

/// Un rilievo. `path` è pensato per essere letto da un modello e usato per
/// tornare esattamente sul campo giusto, non per essere mostrato a un umano.
#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub severity: Severity,
    /// Percorso puntato, es. `pages[Indicatori].objects[btn_luce].write_value`.
    pub path: String,
    pub message: String,
    /// Come si aggiusta. È la parte che chiude il ciclo di autocorrezione:
    /// senza, il modello sa di aver sbagliato ma non cosa scrivere al posto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl Finding {
    fn err(path: impl Into<String>, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Finding { severity: Severity::Error, path: path.into(), message: message.into(),
                  hint: Some(hint.into()) }
    }
    fn warn(path: impl Into<String>, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Finding { severity: Severity::Warning, path: path.into(), message: message.into(),
                  hint: Some(hint.into()) }
    }
}

/// I tipi di oggetto che scrivono su un tag quando l'operatore li tocca.
/// `navbutton` e `lang_button` non ci sono: cambiano pagina o lingua, non tag.
const INTERATTIVI: &[&str] = &["button", "checkbox", "radio", "slider", "setpoint"];

/// Campi stringa di un oggetto che contengono un id di tag. Elencati a mano
/// perché il mirror non li distingue da qualunque altra stringa — ma sbagliarne
/// uno costa un riferimento morto che nessuno segnala.
const CAMPI_TAG: &[&str] = &[
    "tag", "blink_tag", "visible_tag", "state_tag", "alarm_tag", "motion_tag",
    "pipe_flow_tag", "symbol_spin_tag", "fill_level_tag", "gauge_sp_tag",
    "pie_center_tag", "pipe_label_tag", "y_tag",
];

/// Un id di tag che contiene `{` è un segnaposto di faceplate (`{motore}.stato`),
/// non un riferimento: si risolve all'istanza, non qui.
fn e_segnaposto(s: &str) -> bool {
    s.contains('{')
}

// ─────────────────────────────────────────────────────────────────────────────
// Metà 1 — i campi inventati
// ─────────────────────────────────────────────────────────────────────────────

/// Campi presenti nel JSON che nessuna struct dichiara: serde li butta via
/// senza dire niente, e la modifica sembra applicata.
///
/// `raw_pages` e `raw_project` sono il corpo della proposta **come è arrivato**,
/// prima di qualunque deserializzazione tipizzata — dopo, l'informazione non
/// esiste più.
pub fn unknown_fields(raw_project: Option<&Value>, raw_pages: &[Value]) -> Vec<Finding> {
    let mut out = Vec::new();
    let campi_pagina: HashSet<&str> = PAGE_FIELDS.iter().map(|f| f.name).collect();
    let campi_oggetto: HashSet<&str> = OBJECT_FIELDS.iter().map(|f| f.name).collect();
    let campi_tag: HashSet<&str> = TAG_FIELDS.iter().map(|f| f.name).collect();

    for page in raw_pages {
        let nome = page.get("name").and_then(Value::as_str).unwrap_or("?");
        if let Some(map) = page.as_object() {
            for k in map.keys() {
                if !campi_pagina.contains(k.as_str()) {
                    out.push(Finding::err(
                        format!("pages[{nome}].{k}"),
                        format!("il campo `{k}` non esiste su una pagina"),
                        suggerisci(k, &campi_pagina),
                    ));
                }
            }
        }
        for obj in page.get("objects").and_then(Value::as_array).into_iter().flatten() {
            let id = obj.get("id").and_then(Value::as_str).unwrap_or("?");
            let Some(map) = obj.as_object() else { continue };
            for k in map.keys() {
                if !campi_oggetto.contains(k.as_str()) {
                    out.push(Finding::err(
                        format!("pages[{nome}].objects[{id}].{k}"),
                        format!("il campo `{k}` non esiste su un oggetto sinottico"),
                        suggerisci(k, &campi_oggetto),
                    ));
                }
            }
        }
    }

    if let Some(tags) = raw_project.and_then(|p| p.get("tags")).and_then(Value::as_array) {
        for t in tags {
            let id = t.get("id").and_then(Value::as_str).unwrap_or("?");
            let Some(map) = t.as_object() else { continue };
            for k in map.keys() {
                if !campi_tag.contains(k.as_str()) {
                    out.push(Finding::err(
                        format!("project.tags[{id}].{k}"),
                        format!("il campo `{k}` non esiste su una definizione di tag"),
                        suggerisci(k, &campi_tag),
                    ));
                }
            }
        }
    }
    out.extend(campi_inventati_script(raw_project));
    out
}

/// Campi di una `FunctionDef` e di un `GlobalScriptDef`, elencati a mano.
///
/// Non vengono da `synoptic_schema.rs` di proposito: quel file è **generato**
/// (`gen_synoptic_schema.py`, e `check_synoptic_schema.sh` lo confronta byte a
/// byte), quindi toccarlo a mano fa fallire una guardia. Il disaccoppiamento si
/// tiene onesto con un test che serializza le due struct e confronta le chiavi:
/// aggiungere un campo e non aggiornare queste costanti fa diventare rosso
/// `cargo test`, non silenzioso il validatore.
const CAMPI_FUNZIONE: &[&str] = &["id", "name", "description", "code", "params"];
const CAMPI_SCRIPT_GLOBALE: &[&str] = &["id", "trigger", "code", "enabled"];

/// Campi inventati dentro `functions` e `global_scripts`. Stessa logica di
/// [`unknown_fields`], tenuta separata perché lavora sul progetto e non sulle
/// pagine, e perché serve **prima** della ricomposizione (dopo, un `codice:`
/// scritto male sarebbe indistinguibile da un corpo non mandato).
fn campi_inventati_script(raw_project: Option<&Value>) -> Vec<Finding> {
    let mut out = Vec::new();
    let coppie: [(&str, &[&str]); 2] =
        [("functions", CAMPI_FUNZIONE), ("global_scripts", CAMPI_SCRIPT_GLOBALE)];
    for (collezione, validi) in coppie {
        let validi: HashSet<&str> = validi.iter().copied().collect();
        let Some(arr) = raw_project.and_then(|p| p.get(collezione)).and_then(Value::as_array)
        else { continue };
        for e in arr {
            let id = e.get("id").and_then(Value::as_str)
                .or_else(|| e.get("name").and_then(Value::as_str)).unwrap_or("?");
            let Some(map) = e.as_object() else { continue };
            for k in map.keys() {
                if !validi.contains(k.as_str()) {
                    out.push(Finding::err(
                        format!("project.{collezione}[{id}].{k}"),
                        format!("il campo `{k}` non esiste qui"),
                        suggerisci(k, &validi),
                    ));
                }
            }
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Metà 1-bis — il round-trip degli script
// ─────────────────────────────────────────────────────────────────────────────

/// Rimette nel progetto proposto gli script che la proposta non porta.
///
/// # Perché esiste, e perché sta prima della deserializzazione
///
/// Due difetti opposti nascevano dallo stesso punto, e nessuno dei due era
/// raggiungibile da una regola semantica — perché una regola gira su un
/// progetto già tipizzato, e qui il progetto o non si legge o si legge male.
///
/// **Uno cancellava.** `Project.functions` ha `#[serde(default)]`: un progetto
/// proposto che *omette* `functions` diventa una lista vuota. Da lì
/// `applyAiProposal` lo mette nello store e il Salva scrive
/// `updateFunctions([])`: tutte le funzioni via dal disco, senza un avviso e
/// senza niente nel diff. È lo stesso modo di perdere dati già pagato il
/// 2026-07-28 sui tag, e per cui tag/sorgenti/allarmi non si salvano più da
/// `saveAll`.
///
/// **L'altro bloccava.** `FunctionDef.code` è obbligatorio, ma `leggi_progetto`
/// lo rimuove: un modello che rimanda le funzioni *come le ha lette* fa fallire
/// la deserializzazione con «missing field `code`» su qualunque progetto che
/// abbia almeno una funzione. Cioè: il caso normale.
///
/// La cura è una sola e sta al confine — qui, sul JSON grezzo, prima che serde
/// abbia l'occasione di decidere per conto suo. Vale per ogni client, non solo
/// per l'editor.
///
/// # Assente e vuoto non sono la stessa cosa
///
/// `functions` **mancante** significa «non ne ho parlato»: si rimette quella del
/// disco. `functions: []` **presente** significa «via tutte»: si rispetta. Sul
/// JSON grezzo i due casi si distinguono; sul `Project` tipizzato no, ed è
/// esattamente l'informazione che serve.
///
/// # I due avvisi non sono decorativi
///
/// Ricomporre apre un buco nuovo: se il modello scrive `codice:` invece di
/// `code:`, serde scarta il campo ignoto, la ricomposizione rimette il corpo
/// vecchio, e la modifica **sparisce in silenzio** — la famiglia di difetti che
/// questo modulo esiste per impedire. Gli avvisi la rendono visibile al modello
/// e alla persona che approva; `campi_inventati_script` prende il refuso.
pub fn ricomponi_script(proposta: &mut Value, disco: &Project) -> Vec<Finding> {
    let mut out = Vec::new();
    let Some(obj) = proposta.as_object_mut() else { return out };

    // ── functions ────────────────────────────────────────────────────────────
    if !obj.contains_key("functions") {
        if !disco.functions.is_empty() {
            out.push(Finding::warn(
                "project.functions",
                format!("la proposta non conteneva `functions`: restano le {} del progetto",
                        disco.functions.len()),
                "se volevi cambiarle, mandale nel progetto; se volevi cancellarle tutte, \
                 scrivi `functions: []` — omettere significa «non ne ho parlato»",
            ));
        }
        if let Ok(v) = serde_json::to_value(&disco.functions) {
            obj.insert("functions".into(), v);
        }
    } else if let Some(arr) = obj.get_mut("functions").and_then(Value::as_array_mut) {
        for e in arr.iter_mut() {
            let (id, nome) = (stringa(e, "id"), stringa(e, "name"));
            let etichetta = id.clone().or_else(|| nome.clone()).unwrap_or_else(|| "?".into());
            if e.get("code").and_then(Value::as_str).is_some() {
                continue;
            }
            let sul_disco = disco.functions.iter().find(|f| {
                id.as_deref().is_some_and(|i| f.id == i)
                    || nome.as_deref().is_some_and(|n| f.name == n)
            });
            match sul_disco {
                Some(f) => {
                    out.push(Finding::warn(
                        format!("project.functions[{etichetta}].code"),
                        "il corpo non era nella proposta: resta quello del progetto".to_string(),
                        "`leggi_progetto` non porta i corpi Python. Per leggerne uno usa \
                         `leggi_script`; per cambiarlo, mandalo intero",
                    ));
                    if let Some(m) = e.as_object_mut() {
                        m.insert("code".into(), Value::String(f.code.clone()));
                    }
                }
                None => {
                    // Riempito con "" per far girare le regole tipizzate, che
                    // lo bocciano a loro volta: due guardie indipendenti sulla
                    // stessa cosa, perché un corpo vuoto sul disco è peggio di
                    // un errore in più.
                    out.push(Finding::err(
                        format!("project.functions[{etichetta}].code"),
                        "una funzione che il progetto non ha deve portare il suo `code`"
                            .to_string(),
                        "manda il corpo Python della funzione nuova; se volevi modificarne una \
                         esistente, usa il suo `id`",
                    ));
                    if let Some(m) = e.as_object_mut() {
                        m.insert("code".into(), Value::String(String::new()));
                    }
                }
            }
        }
    }

    // ── global_scripts ───────────────────────────────────────────────────────
    if !obj.contains_key("global_scripts") {
        if !disco.global_scripts.is_empty() {
            out.push(Finding::warn(
                "project.global_scripts",
                format!("la proposta non conteneva `global_scripts`: restano i {} del progetto",
                        disco.global_scripts.len()),
                "come per `functions`: omettere significa «non ne ho parlato», \
                 `global_scripts: []` significa «via tutti»",
            ));
        }
        if let Ok(v) = serde_json::to_value(&disco.global_scripts) {
            obj.insert("global_scripts".into(), v);
        }
    } else if let Some(arr) = obj.get_mut("global_scripts").and_then(Value::as_array_mut) {
        for e in arr.iter_mut() {
            let id = stringa(e, "id");
            let etichetta = id.clone().unwrap_or_else(|| "?".into());
            if e.get("code").and_then(Value::as_str).is_some() {
                continue;
            }
            let sul_disco = disco.global_scripts.iter()
                .find(|g| id.as_deref().is_some_and(|i| g.id == i));
            match sul_disco {
                Some(g) => {
                    out.push(Finding::warn(
                        format!("project.global_scripts[{etichetta}].code"),
                        "il corpo non era nella proposta: resta quello del progetto".to_string(),
                        "per cambiarlo, mandalo intero; per leggerlo, `leggi_script`",
                    ));
                    if let Some(m) = e.as_object_mut() {
                        m.insert("code".into(), Value::String(g.code.clone()));
                    }
                }
                None => {
                    out.push(Finding::err(
                        format!("project.global_scripts[{etichetta}].code"),
                        "uno script globale nuovo deve portare il suo `code`".to_string(),
                        "manda il corpo Python; e ricorda `trigger`, senza cui non partirebbe",
                    ));
                    if let Some(m) = e.as_object_mut() {
                        m.insert("code".into(), Value::String(String::new()));
                    }
                }
            }
        }
    }

    out
}

fn stringa(v: &Value, chiave: &str) -> Option<String> {
    v.get(chiave).and_then(Value::as_str).map(str::to_string)
}

/// «Volevi dire…?». Distanza di Levenshtein contro i campi veri: un campo
/// inventato di solito è un campo vero storpiato, e dirlo risparmia un giro.
fn suggerisci(sbagliato: &str, validi: &HashSet<&str>) -> String {
    let mut best: Option<(usize, &str)> = None;
    for v in validi {
        let d = distanza(sbagliato, v);
        if d <= sbagliato.len() / 2 + 1 && best.is_none_or(|(bd, _)| d < bd) {
            best = Some((d, v));
        }
    }
    match best {
        Some((_, v)) => format!("il campo esistente più simile è `{v}` — se intendevi altro, \
                                 chiedi lo schema del tipo prima di riscriverlo"),
        None => "chiedi lo schema del tipo: i campi validi sono solo quelli".to_string(),
    }
}

fn distanza(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut prec: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let costo = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prec[j] + 1).min(cur[j - 1] + 1).min(prec[j - 1] + costo);
        }
        std::mem::swap(&mut prec, &mut cur);
    }
    prec[b.len()]
}

// ─────────────────────────────────────────────────────────────────────────────
// Metà 2 — le regole semantiche
// ─────────────────────────────────────────────────────────────────────────────

pub fn semantic(project: &Project, pages: &[SynopticPage]) -> Vec<Finding> {
    let mut out = Vec::new();
    let tipi: HashSet<&str> = OBJECT_TYPES.iter().copied().collect();
    let enums: HashMap<&str, &[&str]> = FIELD_ENUMS.iter().copied().collect();

    // Tag: indice per id, e quali sono di sola lettura.
    let mut per_id: HashMap<&str, &sws_core::TagDef> = HashMap::new();
    for t in &project.tags {
        if t.id.trim().is_empty() {
            out.push(Finding::err("project.tags[]", "un tag ha id vuoto",
                "ogni tag deve avere un id non vuoto: è la chiave con cui lo cercano \
                 gli oggetti, gli allarmi e i driver"));
            continue;
        }
        if per_id.insert(t.id.as_str(), t).is_some() {
            out.push(Finding::err(
                format!("project.tags[{}]", t.id),
                format!("il tag `{}` è dichiarato due volte", t.id),
                "gli id dei tag sono chiavi: la seconda dichiarazione sovrascrive la prima \
                 in silenzio, e uno dei due comportamenti sparisce"));
        }
        const TIPI_DATO: &[&str] = &["bool", "int", "float", "string"];
        if !TIPI_DATO.contains(&t.data_type.as_str()) {
            out.push(Finding::err(
                format!("project.tags[{}].data_type", t.id),
                format!("`{}` non è un tipo di dato valido", t.data_type),
                "i tipi sono bool, int, float, string"));
        }
    }

    // Sorgenti: id univoci, e i tag mappati devono esistere.
    let mut visti_src: HashSet<String> = HashSet::new();
    // Per ogni tag: se una sorgente MQTT lo mappa, sa anche scriverlo?
    let mut mqtt_per_tag: HashMap<&str, bool> = HashMap::new();
    for src in &project.sources {
        let id = source_id(src);
        if id.trim().is_empty() {
            out.push(Finding::err("project.sources[]", "una sorgente ha id vuoto",
                "il supervisor indicizza le sorgenti per id: un id vuoto è una chiave \
                 inutilizzabile"));
        } else if !visti_src.insert(id.to_string()) {
            out.push(Finding::err(
                format!("project.sources[{id}]"),
                format!("id sorgente duplicato: `{id}`"),
                "il supervisor tiene l'ultima e scarta la prima, senza dirlo"));
        }
        for (i, m) in topic_mappings(src).into_iter().enumerate() {
            if !m.tag.is_empty() && !per_id.contains_key(m.tag.as_str()) {
                out.push(Finding::err(
                    format!("project.sources[{id}].topics[{i}].tag"),
                    format!("la sorgente scrive nel tag `{}`, che non è dichiarato", m.tag),
                    "dichiara il tag in project.tags, oppure correggi il riferimento: \
                     un mapping verso un tag inesistente riceve dati e li butta"));
            }
            let scrive = m.publish_topic.is_some();
            let e = mqtt_per_tag.entry(m.tag.as_str()).or_insert(false);
            *e = *e || scrive;
        }
    }

    // Allarmi.
    for a in &project.alarms {
        if !a.tag.is_empty() && !per_id.contains_key(a.tag.as_str()) {
            out.push(Finding::err(
                format!("project.alarms[{}].tag", a.id),
                format!("l'allarme osserva il tag `{}`, che non è dichiarato", a.tag),
                "un allarme su un tag inesistente non scatterà mai, e non lo dirà"));
        }
    }

    // ── Script globali ───────────────────────────────────────────────────────
    //
    // Nessuno di questi rilievi impedisce un salvataggio: sono cose che il
    // runtime accetta e poi non fa, che è la forma peggiore. Uno script globale
    // che non parte mai non lascia traccia da nessuna parte — non c'è un errore,
    // non c'è una riga di log, non c'è un pulsante che diventi rosso.
    let mut visti_gs: HashSet<&str> = HashSet::new();
    for g in &project.global_scripts {
        let base = format!("project.global_scripts[{}]", g.id);

        if g.id.trim().is_empty() {
            out.push(Finding::err("project.global_scripts[]",
                "uno script globale ha id vuoto",
                "l'id è la chiave con cui il supervisore lo indicizza e lo ferma"));
        } else if !visti_gs.insert(g.id.as_str()) {
            out.push(Finding::err(format!("{base}.id"),
                format!("lo script globale `{}` è dichiarato due volte", g.id),
                "il supervisore ne avvia due con lo stesso nome: fermarne uno \
                 diventa ambiguo"));
        }

        if g.code.trim().is_empty() && g.enabled {
            out.push(Finding::warn(format!("{base}.code"),
                "lo script è abilitato ma il corpo è vuoto",
                "verrà schedulato e non farà niente: metti del codice, oppure \
                 `enabled: false`"));
        }

        // Il cap sui byte è imposto dal `PUT /api/project/functions`, ma **solo
        // per le funzioni**: sui `global_scripts` nessuno lo controlla. Qui si
        // dice, così l'asimmetria non resta invisibile.
        if g.code.len() > sws_core::MAX_FUNCTION_CODE_BYTES {
            out.push(Finding::err(format!("{base}.code"),
                format!("il corpo è {} byte, oltre il tetto di {}",
                        g.code.len(), sws_core::MAX_FUNCTION_CODE_BYTES),
                "è lo stesso tetto delle funzioni, e serve a non far gonfiare \
                 project.yaml: spezza lo script o spostane una parte in una funzione"));
        }

        match &g.trigger {
            sws_core::ScriptTrigger::Startup => {}
            sws_core::ScriptTrigger::Interval { interval_s } => {
                if *interval_s == 0 {
                    out.push(Finding::err(format!("{base}.trigger.interval_s"),
                        "un intervallo di 0 secondi",
                        "il supervisore girerebbe senza pause: metti almeno 1"));
                }
            }
            sws_core::ScriptTrigger::TagChange { tag, edge } => {
                if !tag.is_empty() && !per_id.contains_key(tag.as_str()) {
                    out.push(Finding::err(format!("{base}.trigger.tag"),
                        format!("lo script osserva il tag `{tag}`, che non è dichiarato"),
                        "non scatterà mai, e non lo dirà: dichiara il tag o correggi \
                         il riferimento"));
                }
                const EDGE: &[&str] = &["rising", "falling", "any"];
                if !EDGE.contains(&edge.as_str()) {
                    out.push(Finding::err(format!("{base}.trigger.edge"),
                        format!("`{edge}` non è un fronte valido"),
                        "i valori sono \"rising\", \"falling\" e \"any\" (default)"));
                }
            }
            sws_core::ScriptTrigger::Cron { schedule } => {
                for f in cron_rilievi(&base, schedule) { out.push(f); }
            }
        }
    }

    let funzioni: HashSet<&str> =
        project.functions.iter().map(|f| f.name.as_str()).collect();

    // Pagine: nomi e id univoci, e ogni pagina è un bersaglio di navigazione.
    let mut nomi_pagina: HashSet<&str> = HashSet::new();
    let mut id_pagina: HashSet<&str> = HashSet::new();
    for p in pages {
        if !nomi_pagina.insert(p.name.as_str()) {
            out.push(Finding::err(
                format!("pages[{}]", p.name),
                format!("due pagine si chiamano `{}`", p.name),
                "il nome è il nome del file su disco: la seconda sovrascrive la prima"));
        }
        id_pagina.insert(p.id.as_str());
    }

    for p in pages {
        let mut id_oggetti: HashSet<&str> = HashSet::new();
        for o in &p.objects {
            if !id_oggetti.insert(o.id.as_str()) {
                out.push(Finding::err(
                    format!("pages[{}].objects[{}]", p.name, o.id),
                    format!("due oggetti hanno lo stesso id `{}`", o.id),
                    "gli id devono essere univoci nella pagina: le pipe e i gruppi si \
                     ancorano per id, e con un doppione si ancorano al primo che capita"));
            }
        }
        let ids: HashSet<&str> = p.objects.iter().map(|o| o.id.as_str()).collect();
        // T-52 — un oggetto portato interamente fuori dal foglio è parcheggiato:
        // resta nel file ma non viene disegnato, quindi i suoi rilievi semantici
        // (tag inesistente, `target_page` che non risolve, funzione mancante)
        // parlerebbero di qualcosa che non c'è. Si spegne quel pacco e basta:
        // gli **id duplicati** restano accesi, nel ciclo qui sopra, perché un id
        // doppio rompe l'ancoraggio delle pipe che sono rimaste dentro.
        //
        // Il controllo sta **prima** della chiamata e non dentro
        // `controlla_oggetto`, che comincia con un `serde_json::to_value(o)`:
        // è l'operazione costosa, e su una pagina con molti oggetti parcheggiati
        // si pagherebbe per niente.
        let mut fuori = 0usize;
        for o in &p.objects {
            if o.is_off_page(p) {
                fuori += 1;
                continue;
            }
            controlla_oggetto(&mut out, p, o, &tipi, &enums, &per_id, &ids,
                              &id_pagina, &nomi_pagina, &funzioni, &mqtt_per_tag);
        }
        // Rischio R8 — e la ragione per cui questo avviso esiste. Rimpicciolire
        // una pagina, o aggiornare un progetto disegnato quando il fuori pagina
        // non voleva dire niente, disabilita in silenzio tutto quello che resta
        // oltre il bordo. Un avviso **per pagina**, col numero: nessun rilievo
        // per-oggetto, che sarebbe l'inizio di una famiglia intera di controlli
        // geometrici che il validatore non ha mai fatto (Q39).
        if fuori > 0 {
            out.push(Finding::warn(
                format!("pages[{}]", p.name),
                if fuori == 1 {
                    "un oggetto è interamente fuori dal foglio e non verrà disegnato".to_string()
                } else {
                    format!("{fuori} oggetti sono interamente fuori dal foglio e non verranno disegnati")
                },
                "restano nel file e si rivedono in editor, in grigio: trascinali dentro il bordo \
                 tratteggiato per riattivarli, o allarga la pagina. Se li hai messi lì apposta \
                 per toglierli dalla grafica, va bene così"));
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
/// I rilievi su un'espressione cron di uno script globale.
///
/// # Il guasto che questa funzione esiste per cogliere
///
/// `global_scripts::parse_cron` accetta **cinque** campi, e per ciascuno solo
/// `*` oppure una lista di interi separati da virgola. Non ci sono passi
/// (`*/5`) e non ci sono intervalli (`1-5`): `parse_field` fa
/// `filter_map(parse::<u8>)`, quindi un campo che non capisce non è un errore —
/// diventa un **insieme vuoto**, e un insieme vuoto non combacia con nessun
/// minuto. Lo script viene schedulato regolarmente e non parte mai.
///
/// Non c'è niente che lo segnali: nessun errore all'avvio, nessuna riga di log,
/// nessuna spia. `*/5 * * * *` è la prima cosa che chiunque scriverebbe per
/// «ogni cinque minuti», ed è precisamente il caso che tace.
///
/// Vedi `docs/OPEN_QUESTIONS.md` Q34: se il parser debba imparare passi e
/// intervalli, o se il limite vada solo documentato, è una decisione del
/// maintainer. Finché non è presa, il validatore lo dice.
/// I rilievi su un'espressione cron. **Non** reimplementa le regole: le chiede
/// a `crate::cron`, che è lo stesso parser che poi schedula.
///
/// Prima erano due elenchi. Questo, fino al 2026-09-03, diceva «questo cron non
/// capisce né i passi (`*/n`) né gli intervalli (`n-m`)» e suggeriva di
/// scrivere i dodici minuti a mano: era vero, ed è diventato falso nel momento
/// in cui il parser li ha imparati. Un validatore che mente su cosa il runtime
/// accetta è peggio di nessun validatore, perché fa riscrivere codice che
/// andava bene.
fn cron_rilievi(base: &str, schedule: &str) -> Vec<Finding> {
    let campo = format!("{base}.trigger.schedule");
    let (_, problemi) = crate::cron::analizza(schedule);
    problemi
        .into_iter()
        .map(|p| {
            let messaggio = p.messaggio;
            match p.gravita {
                // La conseguenza va detta a lettere: un cron che non si capisce
                // non è un dettaglio di stile, è uno script che non parte.
                crate::cron::Gravita::Errore => Finding::err(
                    campo.clone(),
                    format!("{messaggio} — lo script NON verrebbe schedulato"),
                    p.suggerimento,
                ),
                crate::cron::Gravita::Avviso => Finding::warn(campo.clone(), messaggio, p.suggerimento),
            }
        })
        .collect()
}

fn controlla_oggetto(
    out: &mut Vec<Finding>,
    page: &SynopticPage,
    o: &SynopticObject,
    tipi: &HashSet<&str>,
    enums: &HashMap<&str, &[&str]>,
    tags: &HashMap<&str, &sws_core::TagDef>,
    ids_pagina: &HashSet<&str>,
    id_pagine: &HashSet<&str>,
    nomi_pagine: &HashSet<&str>,
    funzioni: &HashSet<&str>,
    mqtt_scrivibile: &HashMap<&str, bool>,
) {
    let base = format!("pages[{}].objects[{}]", page.name, o.id);
    let t = o.obj_type.as_str();

    if !tipi.contains(t) {
        out.push(Finding::err(
            format!("{base}.type"),
            format!("`{t}` non è un tipo di oggetto conosciuto"),
            "l'editor non lo disegnerà affatto: i tipi validi sono quelli dello schema"));
        return; // senza il tipo, le regole che dipendono dal tipo non dicono niente
    }

    // Il JSON dell'oggetto: serve per le regole generiche sui campi.
    let json = serde_json::to_value(o).unwrap_or(Value::Null);
    let map = json.as_object();

    // Valori fuori dagli insiemi chiusi. 29 enum coperti da una regola sola.
    if let Some(map) = map {
        for (k, v) in map {
            let Some(s) = v.as_str() else { continue };
            let Some(validi) = enums.get(k.as_str()) else { continue };
            if !validi.contains(&s) {
                out.push(Finding::err(
                    format!("{base}.{k}"),
                    format!("`{s}` non è un valore ammesso per `{k}`"),
                    format!("i valori sono: {}", validi.join(", "))));
            }
        }
    }

    // Riferimenti a tag.
    if let Some(map) = map {
        for campo in CAMPI_TAG {
            let Some(v) = map.get(*campo).and_then(Value::as_str) else { continue };
            if v.is_empty() || e_segnaposto(v) {
                continue;
            }
            if !tags.contains_key(v) {
                out.push(Finding::err(
                    format!("{base}.{campo}"),
                    format!("il tag `{v}` non è dichiarato nel progetto"),
                    "dichiaralo in project.tags oppure usa un tag esistente: un oggetto \
                     legato a un tag inesistente resta fermo e non dice perché"));
            }
        }
    }
    for extra in o.extra_tags.iter().flatten() {
        if !extra.is_empty() && !e_segnaposto(extra) && !tags.contains_key(extra.as_str()) {
            out.push(Finding::err(
                format!("{base}.extra_tags"),
                format!("il tag `{extra}` non è dichiarato nel progetto"),
                "ogni traccia in più deve puntare a un tag che esiste"));
        }
    }

    // Il valore SCRITTO deve stare nel tipo del tag. Il server non lo fa
    // rispettare (Q27): se non lo diciamo qui non lo dice nessuno, e un
    // `write_value: 'true'` su un tag bool funziona per caso finché smette.
    //
    // Scrivere e confrontare non sono la stessa cosa, e all'inizio li avevo
    // messi insieme — sbagliando. Questi quattro campi finiscono in
    // `PUT /api/tags` (per la checkbox: `guardedWrite`, SvgCanvas.tsx:4276);
    // `on_value` no, e sta nel blocco dopo.
    let tag_def = o.tag.as_deref().and_then(|id| tags.get(id)).copied();
    for (campo, valore) in [
        ("write_value", &o.write_value),
        ("release_value", &o.release_value),
        ("checked_value", &o.checked_value),
        ("unchecked_value", &o.unchecked_value),
    ] {
        let (Some(v), Some(td)) = (valore.as_ref(), tag_def) else { continue };
        if let Some(msg) = incompatibile(v, &td.data_type) {
            out.push(Finding::err(
                format!("{base}.{campo}"),
                format!("{msg} ma il tag `{}` è dichiarato `{}`", td.id, td.data_type),
                atteso_per(&td.data_type)));
        }
    }

    // `on_value` invece CONFRONTA, e il confronto è bimodale per progetto: con
    // un booleano i due motori confrontano booleani, con una stringa
    // confrontano stringhe (`led_state` in lvgl_render.rs:2212, e il ramo
    // gemello in SvgCanvas.tsx:3690). Quindi `on_value: 'true'` su un tag bool
    // funziona davvero — nei modelli demo è così da sempre.
    //
    // Non è però quello che si voleva scrivere: regge perché i due motori
    // stringificano un bool allo stesso modo, non perché sia giusto. Avviso,
    // non errore: bocciarlo vorrebbe dire bocciare i nostri stessi modelli per
    // qualcosa che funziona.
    if let (Some(v), Some(td)) = (o.on_value.as_ref(), tag_def) {
        if td.data_type == "bool" && v.is_string() {
            out.push(Finding::warn(
                format!("{base}.on_value"),
                format!("`{}` è un tag bool ma il confronto è su una stringa", td.id),
                "scrivi `true` senza virgolette: funziona anche così, ma solo perché i due \
                 motori stringificano un booleano allo stesso modo"));
        } else if let Some(msg) = incompatibile(v, &td.data_type) {
            out.push(Finding::warn(
                format!("{base}.on_value"),
                format!("{msg} ma il tag `{}` è dichiarato `{}`", td.id, td.data_type),
                "il confronto avverrà fra stringhe: assicurati che sia quello che vuoi"));
        }
    }

    // Un comando verso un tag calcolato non arriva da nessuna parte.
    if INTERATTIVI.contains(&t) {
        match tag_def {
            Some(td) if td.expression.is_some() => out.push(Finding::err(
                format!("{base}.tag"),
                format!("`{}` è un tag calcolato (ha un'espressione): le scritture su di \
                         esso vengono rifiutate", td.id),
                "lega il comando al tag che il driver scrive davvero, non al derivato")),
            None if o.tag.as_deref().unwrap_or("").is_empty() => out.push(Finding::warn(
                format!("{base}.tag"),
                format!("un `{t}` senza tag non comanda niente"),
                "indica il tag su cui scrivere")),
            _ => {}
        }
        // Il bersaglio: un comando MQTT senza canale di ritorno.
        if let Some(id) = o.tag.as_deref() {
            if mqtt_scrivibile.get(id) == Some(&false) {
                out.push(Finding::warn(
                    format!("{base}.tag"),
                    format!("il tag `{id}` arriva da MQTT ma il suo mapping non ha \
                             `publish_topic`: il comando resta dentro SWS"),
                    "aggiungi `publish_topic` al mapping della sorgente, altrimenti il \
                     valore cambia sullo schermo e il device non lo sa"));
            }
        }
    }

    // Navigazione verso una pagina che non c'è. Sedici pulsanti così nei due
    // modelli demo, il 2026-08-28: schermo nero e nessun messaggio.
    if let Some(target) = o.target_page.as_deref() {
        if !target.is_empty() && !id_pagine.contains(target) && !nomi_pagine.contains(target) {
            out.push(Finding::err(
                format!("{base}.target_page"),
                format!("la pagina `{target}` non esiste"),
                "premendo il pulsante lo schermo diventa nero, senza nessun messaggio: \
                 usa l'id di una pagina esistente"));
        }
    }

    // Funzioni agganciate agli eventi.
    for (campo, nome) in [("on_press_fn", &o.on_press_fn), ("on_release_fn", &o.on_release_fn)] {
        let Some(n) = nome.as_deref() else { continue };
        if !n.is_empty() && !funzioni.contains(n) {
            out.push(Finding::err(
                format!("{base}.{campo}"),
                format!("la funzione `{n}` non esiste nel progetto"),
                "il gesto non farà niente: usa il nome di una funzione dichiarata"));
        }
    }

    // Ancoraggi delle pipe.
    for (campo, riferimento) in [("from_obj_id", &o.from_obj_id), ("to_obj_id", &o.to_obj_id)] {
        let Some(r) = riferimento.as_deref() else { continue };
        if !r.is_empty() && !ids_pagina.contains(r) {
            out.push(Finding::err(
                format!("{base}.{campo}"),
                format!("l'oggetto `{r}` non esiste in questa pagina"),
                "la pipe finirà dove capita, di solito nell'angolo"));
        }
    }

    // `points` su una `line`: nessuno dei due motori lo legge. Difetto
    // introdotto e trovato lo stesso giorno, il 2026-08-31.
    if t == "line" && o.points.is_some() {
        out.push(Finding::err(
            format!("{base}.points"),
            "una `line` non legge `points`: nessun motore lo disegna",
            "una linea va da (x,y) a (x2,y2); per una spezzata serve una `pipe`"));
    }

    // Celle di griglia che non disegnano niente: il campo è `child`, non
    // `objects`. Le celle dei modelli demo erano vuote da mesi, anche nel browser.
    if let Some(celle) = o.grid_cells.as_ref().and_then(Value::as_array) {
        for (i, c) in celle.iter().enumerate() {
            let Some(cm) = c.as_object() else { continue };
            if cm.contains_key("objects") {
                out.push(Finding::err(
                    format!("{base}.grid_cells[{i}].objects"),
                    "`objects` non è un campo di una cella di griglia: la cella resta vuota",
                    "il campo è `child`, e contiene UN oggetto"));
            }
            // # E l'oggetto DENTRO la cella, che prima nessuno guardava
            //
            // Il ciclo che chiama questa funzione scorre `SynopticPage.objects`,
            // cioè il primo livello. Il `child` di una cella è un oggetto a
            // tutti gli effetti — con un `tag`, un `type`, un `on_press_fn` — ma
            // vive dentro un `Value` opaco, quindi non passava da nessun
            // controllo: un bottone in una cella che punta a una funzione
            // inesistente o a un tag non dichiarato era **muto**. Il gesto non
            // fa niente e non lo dice.
            //
            // Qui si scende, e ricorsivamente: una cella può contenere un'altra
            // griglia, e fermarsi al primo livello lascerebbe lo stesso buco un
            // gradino più sotto.
            let Some(child) = cm.get("child") else { continue };
            if child.is_null() { continue; }
            match serde_json::from_value::<SynopticObject>(child.clone()) {
                Ok(figlio) => controlla_oggetto(out, page, &figlio, tipi, enums, tags,
                                                ids_pagina, id_pagine, nomi_pagine,
                                                funzioni, mqtt_scrivibile),
                Err(e) => out.push(Finding::warn(
                    format!("{base}.grid_cells[{i}].child"),
                    format!("il contenuto della cella non si legge come oggetto: {e}"),
                    "la cella non disegnerà niente; controlla `type` e i campi obbligatori")),
            }
        }
    }
}

/// `None` se il valore sta nel tipo dichiarato, altrimenti cosa c'è invece.
fn incompatibile(v: &Value, data_type: &str) -> Option<String> {
    let descrizione = match v {
        Value::Bool(_) => "booleano",
        Value::String(_) => "stringa",
        Value::Number(n) if n.is_f64() && n.as_i64().is_none() => "numero con virgola",
        Value::Number(_) => "numero intero",
        Value::Null => return None,
        _ => "struttura",
    };
    let ok = match data_type {
        "bool" => v.is_boolean(),
        "int" => v.as_i64().is_some(),
        "float" => v.is_number(),
        "string" => v.is_string(),
        _ => true,
    };
    if ok { None } else { Some(format!("il valore è un {descrizione}")) }
}

fn atteso_per(data_type: &str) -> String {
    match data_type {
        "bool" => "scrivi `true` / `false` senza virgolette: in YAML `'true'` è una stringa, \
                   e un tag bool che contiene una stringa funziona per caso finché smette",
        "int" => "scrivi un intero senza virgolette",
        "float" => "scrivi un numero senza virgolette",
        _ => "scrivi una stringa",
    }.to_string()
}

/// I mapping tag↔topic di una sorgente, per le sole sorgenti che ne hanno.
/// Le altre varianti non entrano in queste regole e non fingiamo che lo facciano.
fn topic_mappings(src: &SourceDef) -> Vec<&TopicMapping> {
    match src {
        SourceDef::Mqtt(c) => c.topics.iter().collect(),
        _ => Vec::new(),
    }
}

/// Copia locale di `source_supervisor::source_id`, che è `pub(crate)` e vive in
/// un modulo che non vogliamo tirare dentro per una riga.
fn source_id(s: &SourceDef) -> &str {
    match s {
        SourceDef::ModbusTcp(c) => &c.id,
        SourceDef::ModbusRtu(c) => &c.id,
        SourceDef::OpcUaServer(c) => &c.id,
        SourceDef::Mqtt(c) => &c.id,
        SourceDef::OpcUaClient(c) => &c.id,
        SourceDef::HomeAssistant(c) => &c.id,
        SourceDef::S7(c) => &c.id,
        SourceDef::EnIp(c) => &c.id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn carica(dir: &std::path::Path) -> (Project, Vec<SynopticPage>) {
        let project = Project::load(dir).unwrap_or_else(|e| panic!("{}: {e:#}", dir.display()));
        let mut pages = Vec::new();
        let sdir = dir.join("synoptics");
        if sdir.is_dir() {
            let mut files: Vec<_> = std::fs::read_dir(&sdir).unwrap()
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.extension().is_some_and(|x| x == "yaml"))
                .collect();
            files.sort();
            for f in files {
                let testo = std::fs::read_to_string(&f).unwrap();
                match serde_yaml::from_str::<SynopticPage>(&testo) {
                    Ok(p) => pages.push(p),
                    Err(e) => panic!("{} non si legge come pagina: {e}", f.display()),
                }
            }
        }
        (project, pages)
    }

    // ─────────────────────────────────────────────────────────────────────
    // Il round-trip degli script
    // ─────────────────────────────────────────────────────────────────────

    /// Un progetto con due funzioni e uno script globale, il minimo che serve.
    fn con_script() -> Project {
        serde_yaml::from_str(
            r#"
meta: { name: prova, version: "1.0" }
tags: []
functions:
  - { id: f1, name: apri,   code: "tags.write('v', True)" }
  - { id: f2, name: chiudi, code: "tags.write('v', False)" }
global_scripts:
  - { id: g1, trigger: { kind: interval, interval_s: 60 }, code: "pass" }
"#,
        )
        .expect("il progetto di prova deve caricarsi")
    }

    /// Il difetto che cancellava: una proposta che non parla di `functions` non
    /// deve farle sparire. Il verso rotto è nella seconda metà del test, e non è
    /// decorativo — è lo stato in cui il ramo era.
    #[test]
    fn funzioni_omesse_non_spariscono() {
        let disco = con_script();
        let mut proposta = serde_json::json!({
            "meta": { "name": "prova", "version": "1.0" },
            "tags": [{ "id": "v", "data_type": "bool" }],
        });

        let rilievi = ricomponi_script(&mut proposta, &disco);
        let dopo: Project = serde_json::from_value(proposta).expect("si deve leggere");
        assert_eq!(dopo.functions.len(), 2, "le funzioni del disco devono restare");
        assert_eq!(dopo.global_scripts.len(), 1, "e anche gli script globali");
        assert!(rilievi.iter().any(|f| f.path == "project.functions"
                                    && f.severity == Severity::Warning),
                "e la ricomposizione deve dirlo, altrimenti la modifica sparita è invisibile");

        // Il verso rotto: senza ricomposizione, `#[serde(default)]` su
        // `Project.functions` le fa diventare zero. Da lì `applyAiProposal` le
        // mette nello store e il Salva scrive `updateFunctions([])`.
        let crudo: Project = serde_json::from_value(serde_json::json!({
            "meta": { "name": "prova", "version": "1.0" }, "tags": [],
        })).unwrap();
        assert_eq!(crudo.functions.len(), 0,
                   "se questo cambia, `serde(default)` è stato toccato: rileggi il commento \
                    di ricomponi_script prima di cancellare il test");
    }

    /// Il difetto gemello, quello che bloccava: `leggi_progetto` toglie il corpo
    /// delle funzioni, quindi un modello che le rimanda come le ha lette faceva
    /// fallire la deserializzazione su qualunque progetto con almeno una
    /// funzione — cioè nel caso normale.
    #[test]
    fn codice_assente_si_ricompone() {
        let disco = con_script();
        let come_le_legge_il_modello = serde_json::json!({
            "meta": { "name": "prova", "version": "1.0" },
            "tags": [],
            "functions": [
                { "id": "f1", "name": "apri" },
                { "id": "f2", "name": "chiudi" },
            ],
            "global_scripts": [{ "id": "g1", "trigger": { "kind": "interval", "interval_s": 60 } }],
        });

        // Il verso rotto, prima: senza ricomposizione non si legge affatto.
        let e = serde_json::from_value::<Project>(come_le_legge_il_modello.clone())
            .expect_err("senza ricomposizione deve fallire");
        assert!(e.to_string().contains("missing field `code`"),
                "la dizione di serde è cambiata: era «missing field `code`», ora «{e}»");

        let mut proposta = come_le_legge_il_modello;
        let rilievi = ricomponi_script(&mut proposta, &disco);
        let dopo: Project = serde_json::from_value(proposta).expect("ora si deve leggere");
        assert_eq!(dopo.functions[0].code, "tags.write('v', True)",
                   "il corpo deve tornare quello del disco, non una stringa vuota");
        assert_eq!(dopo.global_scripts[0].code, "pass");
        assert_eq!(rilievi.iter().filter(|f| f.severity == Severity::Warning).count(), 3,
                   "un avviso per ogni corpo rimesso: senza, un `codice:` storpiato \
                    rimetterebbe il corpo vecchio in silenzio");
    }

    /// Una funzione che il progetto non ha e che non porta il corpo è un errore,
    /// non una funzione vuota: riempirla con "" la manderebbe sul disco muta.
    #[test]
    fn funzione_nuova_senza_code_e_un_errore() {
        let disco = con_script();
        let mut proposta = serde_json::json!({
            "meta": { "name": "prova", "version": "1.0" }, "tags": [],
            "functions": [{ "id": "f9", "name": "nuova" }],
        });
        let rilievi = ricomponi_script(&mut proposta, &disco);
        assert!(rilievi.iter().any(|f| f.severity == Severity::Error
                                    && f.path == "project.functions[f9].code"),
                "rilievi: {rilievi:?}");

        // Il verso giusto: con il corpo, nessun rilievo.
        let mut ok = serde_json::json!({
            "meta": { "name": "prova", "version": "1.0" }, "tags": [],
            "functions": [{ "id": "f9", "name": "nuova", "code": "pass" }],
            "global_scripts": [],
        });
        assert!(ricomponi_script(&mut ok, &disco).is_empty());
    }

    /// Assente e vuoto non sono la stessa cosa: `functions: []` è un'intenzione
    /// esprimibile, e va rispettata.
    #[test]
    fn vuoto_esplicito_si_rispetta() {
        let disco = con_script();
        let mut proposta = serde_json::json!({
            "meta": { "name": "prova", "version": "1.0" }, "tags": [],
            "functions": [], "global_scripts": [],
        });
        let rilievi = ricomponi_script(&mut proposta, &disco);
        let dopo: Project = serde_json::from_value(proposta).unwrap();
        assert!(dopo.functions.is_empty(), "svuotare deve restare possibile");
        assert!(rilievi.is_empty(), "e non deve produrre rilievi: {rilievi:?}");
    }

    /// Le due costanti dei campi sono scritte a mano perché `synoptic_schema.rs`
    /// è generato. Questo test è ciò che tiene onesto il disaccoppiamento:
    /// aggiungere un campo alla struct e non alla costante diventa rosso qui.
    #[test]
    fn i_campi_degli_script_sono_tutti_elencati() {
        let f = sws_core::FunctionDef {
            id: "i".into(), name: "n".into(), description: Some("d".into()),
            code: "c".into(),
            params: vec![sws_core::FunctionParam { name: "p".into(), default: None }],
        };
        let v = serde_json::to_value(&f).unwrap();
        let mut chiavi: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        chiavi.sort();
        let mut attesi: Vec<&str> = CAMPI_FUNZIONE.to_vec();
        attesi.sort();
        assert_eq!(chiavi, attesi, "CAMPI_FUNZIONE non combacia con FunctionDef");

        let g = sws_core::GlobalScriptDef {
            id: "i".into(), trigger: sws_core::ScriptTrigger::Startup,
            code: "c".into(), enabled: true,
        };
        let v = serde_json::to_value(&g).unwrap();
        let mut chiavi: Vec<&str> = v.as_object().unwrap().keys()
            .map(String::as_str).filter(|k| *k != "kind").collect();
        chiavi.sort();
        let mut attesi: Vec<&str> = CAMPI_SCRIPT_GLOBALE.to_vec();
        attesi.sort();
        assert_eq!(chiavi, attesi, "CAMPI_SCRIPT_GLOBALE non combacia con GlobalScriptDef");
    }

    /// Il buco che la ricomposizione stessa apre: un `codice:` invece di `code:`
    /// verrebbe scartato da serde e il corpo vecchio rimesso. Deve saltare qui.
    #[test]
    fn campo_storpiato_in_una_funzione() {
        let raw = serde_json::json!({
            "functions": [{ "id": "f1", "name": "apri", "codice": "pass" }],
        });
        let rilievi = unknown_fields(Some(&raw), &[]);
        assert!(rilievi.iter().any(|f| f.path == "project.functions[f1].codice"
                                    && f.severity == Severity::Error),
                "rilievi: {rilievi:?}");
        // Verso giusto.
        let raw = serde_json::json!({
            "functions": [{ "id": "f1", "name": "apri", "code": "pass" }],
        });
        assert!(unknown_fields(Some(&raw), &[]).is_empty());
    }

    fn templates() -> Vec<std::path::PathBuf> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../examples/templates");
        let mut out: Vec<_> = std::fs::read_dir(&dir)
            .expect("examples/templates deve esistere")
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_dir() && p.join("project.yaml").exists())
            .collect();
        out.sort();
        assert!(out.len() >= 10, "trovati solo {} template: il percorso è sbagliato", out.len());
        out
    }

    /// Ogni template che spediamo deve passare il giudizio che diamo
    /// all'assistente. Gemello di `tutti_i_template_si_caricano` in sws-core:
    /// se le nostre regole bocciano i nostri progetti, o le regole sono
    /// sbagliate o i progetti lo sono — e in entrambi i casi lo vogliamo sapere
    /// qui, non da un modello che ci gira intorno per tre turni.
    /// Le uniche eccezioni ammesse, con nome e cognome.
    ///
    /// I dodici pulsanti dei rulli di `casa-locale` scrivono `"open"` / `"stop"`
    /// / `"close"` su tag dichiarati `float`: lo stesso tag porta la posizione
    /// 0-100 in lettura (topic `/pos`) e un comando testuale in scrittura
    /// (`publish_topic` → `/command`). Funziona, perché il server non fa
    /// rispettare il `data_type` (Q27) e il plugin pubblica il valore così
    /// com'è. Ma il tipo dichiarato è falso metà del tempo.
    ///
    /// Non è un refuso da correggere di notte: è una scelta di modellazione
    /// sull'impianto di casa del maintainer, e la domanda «un tag può servire
    /// due direzioni con due tipi diversi?» è **Q29** in
    /// `docs/OPEN_QUESTIONS.md`. Finché non è decisa, queste dodici restano
    /// elencate qui una per una — così una tredicesima fallisce.
    const ECCEZIONI_NOTE: &[&str] = &[
        "casa-locale: pages[Domotica].objects[cl5_t1_open].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t1_stop].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t1_close].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t2_open].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t2_stop].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t2_close].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t3_open].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t3_stop].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t3_close].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t4_open].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t4_stop].write_value",
        "casa-locale: pages[Domotica].objects[cl5_t4_close].write_value",
    ];

    #[test]
    fn i_template_non_hanno_errori() {
        let mut rotti = Vec::new();
        let mut eccezioni_viste = Vec::new();
        for dir in templates() {
            let nome = dir.file_name().unwrap().to_string_lossy().to_string();
            let (project, pages) = carica(&dir);
            for f in semantic(&project, &pages) {
                if f.severity != Severity::Error {
                    continue;
                }
                let chiave = format!("{nome}: {}", f.path);
                if ECCEZIONI_NOTE.contains(&chiave.as_str()) {
                    eccezioni_viste.push(chiave);
                } else {
                    rotti.push(format!("{chiave} — {}", f.message));
                }
            }
        }
        assert!(rotti.is_empty(),
            "{} errori nei template che spediamo:\n  {}", rotti.len(), rotti.join("\n  "));

        // Un'eccezione che non scatta più è un'eccezione da togliere: se il
        // template è stato sistemato, l'elenco qui sopra mente e va accorciato.
        let mancanti: Vec<&&str> = ECCEZIONI_NOTE.iter()
            .filter(|e| !eccezioni_viste.contains(&e.to_string()))
            .collect();
        assert!(mancanti.is_empty(),
            "{} eccezioni non scattano più — il template è stato corretto, togli queste \
             righe da ECCEZIONI_NOTE:\n  {:?}", mancanti.len(), mancanti);
    }

    /// Gli avvisi non fanno fallire nulla, ma restare ciechi su quanti sono è
    /// il modo di svegliarsi con duecento avvisi che nessuno guarda più.
    #[test]
    fn gli_avvisi_dei_template_sono_pochi_e_noti() {
        let mut avvisi = Vec::new();
        for dir in templates() {
            let nome = dir.file_name().unwrap().to_string_lossy().to_string();
            let (project, pages) = carica(&dir);
            for f in semantic(&project, &pages) {
                if f.severity == Severity::Warning {
                    avvisi.push(format!("{nome}: {} — {}", f.path, f.message));
                }
            }
        }
        assert!(avvisi.len() <= 40,
            "{} avvisi nei template (soglia 40):\n  {}", avvisi.len(), avvisi.join("\n  "));
    }
}

#[cfg(test)]
mod regole {
    //! Ogni regola provata nel verso rotto. Una guardia che non si è mai vista
    //! fallire non è una guardia: è una speranza con un `assert` intorno.
    use super::*;

    /// Progetto minimo con due tag, uno normale e uno calcolato.
    const PROGETTO: &str = r#"
meta: { name: prova, version: "1.0.0" }
tags:
  - { id: luce.salotto, data_type: bool, description: Luce }
  - { id: pos, data_type: float }
  - { id: calcolato, data_type: float, expression: 'tags["pos"] * 2' }
sources: []
alarms: []
"#;

    fn rilievi(progetto: &str, pagina: &str) -> Vec<Finding> {
        let p: Project = serde_yaml::from_str(progetto).expect("progetto di prova");
        let pg: SynopticPage = serde_yaml::from_str(pagina).expect("pagina di prova");
        semantic(&p, &[pg])
    }

    /// Una pagina con un solo oggetto, descritto dalle righe passate.
    fn pagina(corpo: &str) -> String {
        format!("id: pg1\nname: Prova\nobjects:\n{corpo}")
    }

    /// Il rilievo nomina questo pezzo da qualche parte — percorso, messaggio o
    /// suggerimento. Il suggerimento conta: spesso è lì che sta il nome giusto.
    fn cita(rs: &[Finding], pezzo: &str) -> bool {
        rs.iter().any(|f| f.path.contains(pezzo) || f.message.contains(pezzo)
                          || f.hint.as_deref().is_some_and(|h| h.contains(pezzo)))
    }

    fn errori(rs: &[Finding]) -> Vec<Finding> {
        rs.iter().filter(|f| f.severity == Severity::Error).cloned().collect()
    }

    // ── T-52: il fuori pagina spegne i rilievi semantici ────────────────────

    /// Un oggetto parcheggiato fuori dal foglio non viene disegnato, quindi il
    /// suo tag inesistente non è un problema di nessuno. Dentro, lo stesso
    /// oggetto lo è.
    #[test]
    fn un_oggetto_fuori_pagina_non_genera_rilievi_semantici() {
        let dentro = rilievi(PROGETTO, &format!(
            "id: pg1\nname: Prova\nwidth: 1280\nheight: 800\nobjects:\n{}",
            "  - { id: v1, type: text, x: 100, y: 100, width: 120, height: 40, tag: non.esiste }\n"));
        assert!(cita(&errori(&dentro), "non.esiste"), "{dentro:?}");

        let fuori = rilievi(PROGETTO, &format!(
            "id: pg1\nname: Prova\nwidth: 1280\nheight: 800\nobjects:\n{}",
            "  - { id: v1, type: text, x: 3000, y: 100, width: 120, height: 40, tag: non.esiste }\n"));
        assert!(!cita(&fuori, "non.esiste"), "{fuori:?}");
    }

    /// …ma non si spegne in silenzio: la pagina lo dice, una volta sola e col
    /// numero. È il presidio del rischio R8 — chi rimpicciolisce una pagina
    /// disabilita quel che resta fuori, e deve accorgersene senza aprire il
    /// viewer.
    #[test]
    fn la_pagina_avvisa_di_quanti_ne_sono_fuori() {
        let rs = rilievi(PROGETTO, &format!(
            "id: pg1\nname: Prova\nwidth: 1280\nheight: 800\nobjects:\n{}{}",
            "  - { id: r1, type: rect, x: 3000, y: 100, width: 120, height: 40 }\n",
            "  - { id: r2, type: rect, x: 100, y: 3000, width: 120, height: 40 }\n"));
        let avvisi: Vec<_> = rs.iter().filter(|f| f.severity == Severity::Warning).collect();
        assert_eq!(avvisi.len(), 1, "un avviso per pagina, non uno per oggetto: {rs:?}");
        assert_eq!(avvisi[0].path, "pages[Prova]");
        assert!(avvisi[0].message.contains('2'), "{:?}", avvisi[0].message);
    }

    /// Gli id duplicati restano accesi anche fuori pagina: un id doppio rompe
    /// l'ancoraggio delle pipe che sono rimaste dentro, e quella rottura non è
    /// parcheggiata insieme all'oggetto.
    #[test]
    fn gli_id_duplicati_si_vedono_anche_fuori_pagina() {
        let rs = rilievi(PROGETTO, &format!(
            "id: pg1\nname: Prova\nwidth: 1280\nheight: 800\nobjects:\n{}{}",
            "  - { id: dop, type: rect, x: 3000, y: 100, width: 120, height: 40 }\n",
            "  - { id: dop, type: rect, x: 3200, y: 100, width: 120, height: 40 }\n"));
        assert!(errori(&rs).iter().any(|f| f.message.contains("stesso id")), "{rs:?}");
    }

    /// Pagina fluida: nessun bordo ⇒ niente è fuori ⇒ i rilievi restano tutti.
    /// È la regola unica dei tre punti di T-52, vista dal validatore.
    #[test]
    fn su_una_pagina_fluida_niente_e_fuori() {
        let rs = rilievi(PROGETTO, &pagina(
            "  - { id: v1, type: text, x: 9000, y: 9000, width: 120, height: 40, tag: non.esiste }\n"));
        assert!(cita(&errori(&rs), "non.esiste"), "{rs:?}");
        assert!(!rs.iter().any(|f| f.message.contains("fuori dal foglio")), "{rs:?}");
    }

    #[test]
    fn un_campo_inventato_non_passa() {
        let pagine = vec![serde_json::json!({
            "id": "pg1", "name": "Prova",
            "objects": [{ "id": "b1", "type": "button", "x": 0, "y": 0, "etichetta": "Luce" }]
        })];
        let rs = unknown_fields(None, &pagine);
        assert_eq!(rs.len(), 1, "{rs:?}");
        assert!(rs[0].path.ends_with(".etichetta"));
    }

    /// Un campo storpiato deve sentirsi dire il nome giusto: è la differenza
    /// fra un modello che si corregge al primo giro e uno che ne fa tre.
    #[test]
    fn un_campo_storpiato_riceve_il_nome_giusto() {
        let pagine = vec![serde_json::json!({
            "id": "pg1", "name": "Prova",
            "objects": [{ "id": "b1", "type": "button", "x": 0, "y": 0, "lable": "Luce" }]
        })];
        let rs = unknown_fields(None, &pagine);
        assert_eq!(rs.len(), 1, "{rs:?}");
        assert!(rs[0].hint.as_ref().unwrap().contains("`label`"), "{:?}", rs[0].hint);
    }

    /// E una parola tutta diversa NON deve ricevere un suggerimento a caso:
    /// «etichetta» non è un refuso di «label», è un'altra lingua. Suggerire
    /// il campo meno lontano sarebbe peggio che tacere.
    #[test]
    fn una_parola_diversa_non_riceve_suggerimenti_a_caso() {
        let pagine = vec![serde_json::json!({
            "id": "pg1", "name": "Prova",
            "objects": [{ "id": "b1", "type": "button", "x": 0, "y": 0, "etichetta": "Luce" }]
        })];
        let rs = unknown_fields(None, &pagine);
        assert!(rs[0].hint.as_ref().unwrap().starts_with("chiedi lo schema"), "{:?}", rs[0].hint);
    }

    #[test]
    fn un_campo_giusto_passa() {
        let pagine = vec![serde_json::json!({
            "id": "pg1", "name": "Prova",
            "objects": [{ "id": "b1", "type": "button", "x": 0, "y": 0,
                          "label": "Luce", "tag": "luce.salotto", "write_value": true }]
        })];
        assert!(unknown_fields(None, &pagine).is_empty());
    }

    #[test]
    fn un_tipo_sconosciuto_non_passa() {
        let rs = rilievi(PROGETTO, &pagina("- { id: x, type: bottone, x: 0, y: 0 }"));
        assert!(cita(&errori(&rs), "bottone"), "{rs:?}");
    }

    #[test]
    fn un_tag_non_dichiarato_non_passa() {
        let rs = rilievi(PROGETTO, &pagina("- { id: x, type: led, x: 0, y: 0, tag: inesistente }"));
        assert!(cita(&errori(&rs), "inesistente"), "{rs:?}");
    }

    #[test]
    fn un_segnaposto_di_faceplate_non_e_un_tag_rotto() {
        let rs = rilievi(PROGETTO, &pagina("- { id: x, type: led, x: 0, y: 0, tag: '{motore}.stato' }"));
        assert!(errori(&rs).is_empty(), "{rs:?}");
    }

    /// Il difetto del 2026-08-31, quello che ha aperto Q27.
    #[test]
    fn una_stringa_su_un_tag_bool_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: x, type: button, x: 0, y: 0, tag: luce.salotto, write_value: 'true' }"));
        let e = errori(&rs);
        assert!(cita(&e, "write_value"), "{rs:?}");
        assert!(e[0].hint.as_ref().unwrap().contains("senza virgolette"));
    }

    #[test]
    fn un_booleano_vero_su_un_tag_bool_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: x, type: button, x: 0, y: 0, tag: luce.salotto, write_value: true }"));
        assert!(errori(&rs).is_empty(), "{rs:?}");
    }

    #[test]
    fn un_valore_fuori_dall_enum_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: x, type: button, x: 0, y: 0, tag: luce.salotto, button_mode: interruttore }"));
        let e = errori(&rs);
        assert!(cita(&e, "button_mode"), "{rs:?}");
        // L'elenco dei valori validi è la parte che permette di correggersi.
        assert!(e[0].hint.as_ref().unwrap().contains("toggle"), "{:?}", e[0].hint);
    }

    /// I sedici pulsanti rotti dei modelli demo, il 2026-08-28.
    #[test]
    fn una_navigazione_verso_il_nulla_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: x, type: navbutton, x: 0, y: 0, target_page: pagina_che_non_ce }"));
        assert!(cita(&errori(&rs), "pagina_che_non_ce"), "{rs:?}");
    }

    #[test]
    fn una_navigazione_verso_la_propria_pagina_passa() {
        let rs = rilievi(PROGETTO, &pagina("- { id: x, type: navbutton, x: 0, y: 0, target_page: pg1 }"));
        assert!(errori(&rs).is_empty(), "{rs:?}");
    }

    #[test]
    fn points_su_una_line_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: x, type: line, x: 0, y: 0, points: [[0,0],[10,10]] }"));
        assert!(cita(&errori(&rs), "points"), "{rs:?}");
    }

    #[test]
    fn una_cella_di_griglia_con_objects_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: g, type: grid, x: 0, y: 0, grid_cells: [{ row: 0, col: 0, objects: [] }] }"));
        assert!(cita(&errori(&rs), "child"), "{rs:?}");
    }

    #[test]
    fn una_pipe_ancorata_al_nulla_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: p, type: pipe, x: 0, y: 0, from_obj_id: fantasma }"));
        assert!(cita(&errori(&rs), "fantasma"), "{rs:?}");
    }

    #[test]
    fn un_comando_su_un_tag_calcolato_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: x, type: button, x: 0, y: 0, tag: calcolato }"));
        assert!(cita(&errori(&rs), "calcolato"), "{rs:?}");
    }

    // ── Script globali e cron ────────────────────────────────────────────────

    /// **Il verso che è cambiato il 2026-09-03.** `*/5 * * * *` è la prima cosa
    /// che chiunque scrive per «ogni cinque minuti»: prima il parser non lo
    /// capiva, il campo diventava un insieme vuoto e lo script non partiva mai
    /// in silenzio, quindi il validatore lo bocciava — giustamente. Ora il
    /// parser lo capisce, e **il validatore deve tacere**: un validatore che
    /// boccia un cron valido fa riscrivere codice che andava bene, e insegna a
    /// ignorarlo.
    ///
    /// Questo test è lo stesso di prima con l'aspettativa rovesciata, e lo dice
    /// apposta: è il punto in cui le due copie delle regole avrebbero divergiuto
    /// se il parser fosse rimasto in due posti.
    #[test]
    fn un_cron_con_i_passi_ora_passa_pulito() {
        let prog = format!("{PROGETTO}global_scripts:\n              - {{ id: ogni5, trigger: {{ kind: cron, schedule: \"*/5 * * * *\" }},                  code: \"print(1)\" }}\n");
        let rs = rilievi(&prog, &pagina("- { id: t, type: text, x: 0, y: 0 }"));
        assert!(!cita(&rs, "schedule"), "nessun rilievo atteso su `*/5`: {rs:?}");
    }

    /// Ciò che il parser **non** capisce resta un errore, e deve dire la
    /// conseguenza — non che l'espressione è invalida, ma che lo script non
    /// verrebbe schedulato.
    #[test]
    fn un_cron_illeggibile_non_passa_e_dice_la_conseguenza() {
        let prog = format!("{PROGETTO}global_scripts:\n              - {{ id: rotto, trigger: {{ kind: cron, schedule: \"*/0 pippo * * *\" }},                  code: \"print(1)\" }}\n");
        let rs = rilievi(&prog, &pagina("- { id: t, type: text, x: 0, y: 0 }"));
        let e = errori(&rs);
        assert!(cita(&e, "NON verrebbe schedulato"),
                "deve dire la conseguenza, non solo che è invalido: {rs:?}");
    }

    /// Il verso opposto, altrettanto importante: la forma che il parser capisce
    /// deve passare **pulita**. Un validatore che si lamenta di un cron valido
    /// insegna a ignorarlo.
    #[test]
    fn un_cron_a_lista_di_interi_passa_pulito() {
        let prog = format!("{PROGETTO}global_scripts:\n              - {{ id: ogni5, trigger: {{ kind: cron,                  schedule: \"0,5,10,15,20,25,30,35,40,45,50,55 * * * *\" }},                  code: \"print(1)\" }}\n");
        let rs = rilievi(&prog, &pagina("- { id: t, type: text, x: 0, y: 0 }"));
        assert!(!cita(&rs, "schedule"), "nessun rilievo atteso sul cron: {rs:?}");
    }

    /// Un cron corto è un **avviso**, non un errore: `30 4` gira davvero, solo
    /// molto più spesso di quanto chi l'ha scritto pensasse. Bocciarlo
    /// fermerebbe uno script che oggi funziona, e togliere di mezzo in silenzio
    /// qualcosa che andava è peggio del difetto che stiamo correggendo.
    #[test]
    fn un_cron_con_meno_di_cinque_campi_avvisa_ma_non_e_errore() {
        let prog = format!("{PROGETTO}global_scripts:\n              - {{ id: corto, trigger: {{ kind: cron, schedule: \"30 4\" }},                  code: \"print(1)\" }}\n");
        let rs = rilievi(&prog, &pagina("- { id: t, type: text, x: 0, y: 0 }"));
        assert!(cita(&rs, "cinque"), "l'avviso ci deve essere: {rs:?}");
        assert!(!cita(&errori(&rs), "cinque"),
                "ma non come errore, o si blocca un salvataggio buono: {rs:?}");
    }

    #[test]
    fn uno_script_su_un_tag_inesistente_non_passa() {
        let prog = format!("{PROGETTO}global_scripts:\n              - {{ id: s1, trigger: {{ kind: tag_change, tag: mai.dichiarato }},                  code: \"print(1)\" }}\n");
        let rs = rilievi(&prog, &pagina("- { id: t, type: text, x: 0, y: 0 }"));
        assert!(cita(&errori(&rs), "mai.dichiarato"), "{rs:?}");
    }

    #[test]
    fn un_intervallo_di_zero_secondi_non_passa() {
        let prog = format!("{PROGETTO}global_scripts:\n              - {{ id: s1, trigger: {{ kind: interval, interval_s: 0 }},                  code: \"print(1)\" }}\n");
        let rs = rilievi(&prog, &pagina("- { id: t, type: text, x: 0, y: 0 }"));
        assert!(cita(&errori(&rs), "interval_s"), "{rs:?}");
    }

    #[test]
    fn due_script_globali_con_lo_stesso_id_non_passano() {
        let prog = format!("{PROGETTO}global_scripts:\n              - {{ id: doppio, trigger: {{ kind: startup }}, code: \"print(1)\" }}\n              - {{ id: doppio, trigger: {{ kind: startup }}, code: \"print(2)\" }}\n");
        let rs = rilievi(&prog, &pagina("- { id: t, type: text, x: 0, y: 0 }"));
        assert!(cita(&errori(&rs), "due volte"), "{rs:?}");
    }

    /// Il buco delle griglie: un bottone **dentro una cella** che punta a una
    /// funzione inesistente. Prima passava — il ciclo guardava solo il primo
    /// livello — e il gesto restava muto sul pannello.
    #[test]
    fn una_funzione_inesistente_dentro_una_cella_di_griglia_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: g, type: grid, x: 0, y: 0, grid_cells: [{ row: 0, col: 0, child: { id: b, type: button, x: 0, y: 0, tag: luce.salotto, on_press_fn: mai_scritta } }] }"));
        assert!(cita(&errori(&rs), "mai_scritta"),
                "l'oggetto dentro la cella deve essere controllato: {rs:?}");
    }

    /// E lo stesso per un tag: dentro una cella non c'è nessuna ragione per cui
    /// un riferimento sbagliato debba passare.
    #[test]
    fn un_tag_inesistente_dentro_una_cella_di_griglia_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: g, type: grid, x: 0, y: 0, grid_cells: [{ row: 0, col: 0, child: { id: l, type: led, x: 0, y: 0, tag: mai.dichiarato } }] }"));
        assert!(cita(&errori(&rs), "mai.dichiarato"), "{rs:?}");
    }

    #[test]
    fn una_funzione_inesistente_non_passa() {
        let rs = rilievi(PROGETTO, &pagina(
            "- { id: x, type: button, x: 0, y: 0, tag: luce.salotto, on_press_fn: mai_scritta }"));
        assert!(cita(&errori(&rs), "mai_scritta"), "{rs:?}");
    }

    #[test]
    fn due_sorgenti_con_lo_stesso_id_non_passano() {
        let prog = r#"
meta: { name: prova, version: "1.0.0" }
tags: [{ id: luce.salotto, data_type: bool }]
sources:
  - { kind: mqtt, id: broker, host: h, topics: [] }
  - { kind: mqtt, id: broker, host: h2, topics: [] }
alarms: []
"#;
        let rs = rilievi(prog, &pagina("- { id: x, type: rect, x: 0, y: 0 }"));
        assert!(cita(&errori(&rs), "duplicato"), "{rs:?}");
    }

    /// Il bersaglio di T-50, nel verso rotto: il bottone c'è, il tag c'è, la
    /// sorgente c'è — ma il comando non esce dal broker.
    #[test]
    fn un_comando_mqtt_senza_publish_topic_avvisa() {
        let prog = r#"
meta: { name: prova, version: "1.0.0" }
tags: [{ id: luce.salotto, data_type: bool }]
sources:
  - kind: mqtt
    id: broker
    host: 192.168.1.50
    topics: [{ tag: luce.salotto, topic: casa/salotto/luce/stato }]
alarms: []
"#;
        let rs = rilievi(prog, &pagina(
            "- { id: x, type: button, x: 0, y: 0, tag: luce.salotto, write_value: true }"));
        assert!(errori(&rs).is_empty(), "non è un errore, il progetto è valido: {rs:?}");
        assert!(rs.iter().any(|f| f.severity == Severity::Warning
                                  && f.message.contains("publish_topic")), "{rs:?}");
    }

    /// E nel verso giusto: con `publish_topic`, silenzio.
    #[test]
    fn il_bersaglio_di_t50_non_ha_rilievi() {
        let prog = r#"
meta: { name: prova, version: "1.0.0" }
tags: [{ id: luce.salotto, data_type: bool, description: Luce del salotto }]
sources:
  - kind: mqtt
    id: broker-casa
    host: 192.168.1.50
    port: 1883
    topics:
      - tag: luce.salotto
        topic: casa/salotto/luce/stato
        publish_topic: casa/salotto/luce/set
alarms: []
"#;
        let rs = rilievi(prog, &pagina(
            "- { id: btn_luce, type: button, x: 40, y: 40, width: 120, height: 48, \
                 label: Luce salotto, tag: luce.salotto, button_mode: toggle }"));
        assert!(rs.is_empty(), "il bersaglio deve passare pulito, invece: {rs:?}");
    }
}
