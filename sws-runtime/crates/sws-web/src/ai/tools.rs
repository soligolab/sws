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
//! Niente esecuzione di Python (l'endpoint che la offriva è stato tolto — Q47; e comunque gira senza sandbox quando
//! RestrictedPython manca, che sul PC di sviluppo è la norma), niente export
//! del progetto, nessun `PUT`, nessun deploy, nessun accesso al filesystem.
//! L'unico strumento che cambia qualcosa è `proponi_modifica`, e non cambia
//! niente: propone.
//!
//! > La ragione dell'export è cambiata e la riga lo diceva ancora (corretta il
//! > 22-10-2026): «lo ZIP porta i segreti in chiaro, decisione del
//! > 2026-07-29» non è più vero — `export_project_zip` li toglie e li rimette
//! > solo con `?segreti=1`, e la casella dell'IDE è spenta. L'export resta
//! > fuori perché è un file da scaricare, non un contesto da leggere.
//!
//! # Chi li consuma
//!
//! Due posti, e sono diversi: il ciclo della chat dell'IDE (`super::mod`), che
//! li dà al modello insieme a `proponi_modifica`; e il server MCP
//! (`crate::mcp`), che espone a un assistente esterno **i soli undici** che
//! `esegui` smista — vedi `SOLA_LETTURA` qui sotto.

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
        strumento(
            "elenca_pagine",
            "Le pagine sinottiche del progetto: id, nome, dimensioni, quanti oggetti. \
             Un nome tradotto è un token (`{{t0021}}`): allora `titolo` dice come si legge, e \
             per indicare la pagina usa l'id. Da chiamare per prima: senza, non sai su quale \
             pagina lavorare.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        strumento(
            "leggi_pagina",
            "Tutti gli oggetti di una pagina, come sono su disco. Serve prima di \
             modificarla: una proposta deve contenere la pagina INTERA, non solo \
             l'oggetto aggiunto.",
            json!({ "type": "object", "required": ["nome"], "additionalProperties": false,
                    "properties": { "nome": { "type": "string",
                        "description": "Il nome o l'id della pagina, come da elenca_pagine." } } }),
        ),
        strumento(
            "leggi_progetto",
            "Il progetto senza le pagine: tag, sorgenti, allarmi, funzioni, lingue. \
             Le password sono mascherate e restano tali: se ne rimandi indietro una \
             mascherata, il server ricompone quella vera al salvataggio.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        strumento(
            "elenca_tag",
            "I tag dichiarati, con tipo e descrizione. Un tag con `expression` o con \
             `generator` attivo è calcolato: le scritture su di esso vengono rifiutate.",
            json!({ "type": "object", "properties": {
                        "filtro": { "type": "string",
                            "description": "Sottostringa dell'id, per non leggerli tutti." } },
                    "additionalProperties": false }),
        ),
        strumento(
            "schema_oggetto",
            "I campi validi per un tipo di oggetto sinottico, con la loro \
             documentazione, i valori ammessi degli enum e un esempio YAML preso da \
             un progetto vero. CHIAMALO SEMPRE prima di scrivere un oggetto di un \
             tipo che non hai già guardato in questa conversazione.",
            json!({ "type": "object", "required": ["tipo"], "additionalProperties": false,
                    "properties": { "tipo": { "type": "string", "enum": sch::OBJECT_TYPES } } }),
        ),
        strumento(
            "schema_sorgente",
            "I campi validi per un tipo di sorgente dati e per il suo mapping \
             tag↔device, con un esempio reale. Per MQTT è qui che si scopre \
             `publish_topic`, senza il quale un comando non esce dal broker.",
            json!({ "type": "object", "required": ["kind"], "additionalProperties": false,
                    "properties": { "kind": { "type": "string", "enum": sch::SOURCE_KINDS } } }),
        ),
        strumento(
            "valida",
            "Dice se una modifica sta in piedi, SENZA salvarla. Restituisce rilievi \
             con il percorso del campo e come si aggiusta. I rilievi marcati \
             `preesistente` c'erano già prima della tua proposta: non sono compito \
             tuo e non vanno corretti se nessuno te l'ha chiesto.",
            json!({ "type": "object", "additionalProperties": false, "properties": {
                        "project": { "type": "object",
                            "description": "Il progetto intero, modificato. Ometti se non lo tocchi." },
                        "pages": { "type": "array", "items": { "type": "object" },
                            "description": "Le pagine intere, modificate. Ometti quelle che non tocchi." } } }),
        ),
        strumento(
            "proponi_modifica",
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
                            "description": "Le pagine intere, modificate." },
                        "simboli": { "type": "array", "items": { "type": "string" },
                            "description": "Gli slug delle bozze di simbolo (bozza_simbolo) da \
                                            portare nel progetto. Se manca: quelle che le pagine \
                                            proposte usano (symbol_id prj:<slug>)." } } }),
        ),
        // In coda, e non in mezzo: l'ordine entra nel prefisso della cache.
        strumento(
            "schema_tag",
            "I campi validi di una definizione di tag, con i valori ammessi. \
             CHIAMALO prima di dichiarare un tag nuovo: il campo del tipo si chiama \
             `data_type` e non `type`, ed è l'errore che costa un giro di validazione.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        // ── Python. Aggiunti in coda per la stessa ragione di sopra. ─────────
        strumento(
            "leggi_script",
            "Il codice Python di una funzione di progetto o di uno script globale. \
             `leggi_progetto` NON lo restituisce (e' lungo e quasi mai utile per \
             disegnare): per modificare del codice esistente devi leggerlo da qui \
             prima, altrimenti lo riscrivi da zero e cancelli quello che c'era.",
            json!({ "type": "object", "additionalProperties": false, "properties": {
                        "funzione": { "type": "string",
                            "description": "Nome della funzione di progetto (come da leggi_progetto)." },
                        "script_globale": { "type": "string",
                            "description": "Id dello script globale." } } }),
        ),
        strumento(
            "schema_python",
            "Cosa si puo' scrivere negli script: le variabili disponibili, cosa la \
             sandbox vieta, i tipi di trigger degli script globali e i limiti. \
             CHIAMALO prima di scrivere Python: qui non e' Python normale — non ci \
             sono `import`, e i tag si leggono e scrivono da `tags`.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        strumento(
            "istantanea_pagina",
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
                                    Con i tocchi 800-1500." },
                "pagina": { "type": "object",
                    "description": "Una pagina INTERA non ancora proposta: si fotografa questa al \
                                    posto di quella sul disco con lo stesso nome. Le bozze di \
                                    simbolo della conversazione ci sono sempre. Senza `nome` e \
                                    senza `pagina`, con delle bozze, fotografa la TAVOLA delle \
                                    bozze: è il modo di guardare i simboli che hai disegnato." } } }),
        ),
        strumento(
            "controlla_python",
            "Compila del codice Python e dice se sta in piedi, SENZA eseguirlo: \
             nessun tag scritto, nessun effetto. Distingue un errore di sintassi \
             (con la riga) da una cosa che la sandbox vieta pur essendo Python \
             valido. CHIAMALO SEMPRE prima di proporre del codice: proporre \
             Python che non compila fa perdere un giro a chi legge il diff.",
            json!({ "type": "object", "required": ["codice"], "additionalProperties": false,
                    "properties": { "codice": { "type": "string",
                        "description": "Il corpo Python, come lo metteresti in `code`." } } }),
        ),
        // ── Simboli e sinottici interi (03-11-2026). In coda, per la cache. ──
        strumento(
            "cerca_simboli",
            "Cerca fra i simboli disponibili: i 195 della libreria e quelli disegnati nel \
             progetto (prj:). Per ognuno: id da mettere in symbol_id, etichetta, tipologia, \
             dimensioni del disegno (w×h), parti vive (rotor, level, needle, lever, lamp) e \
             bocche per i tubi. CHIAMALO prima di disegnare un simbolo nuovo: se la libreria \
             ha già la macchina, si usa quella.",
            json!({ "type": "object", "additionalProperties": false, "properties": {
                "testo": { "type": "string",
                    "description": "Parole da cercare in etichetta (it/en), id e tipologia: \
                                    «pompa», «valve», «tank»…" },
                "famiglia": { "type": "string",
                    "description": "controls, process, electrical, machines, building, project" },
                "tipo": { "type": "string", "description": "La tipologia: pumps, valves, tanks, kitchen…" },
                "con_parti": { "type": "string",
                    "description": "Solo i simboli con una parte di questo tipo: rotor, level, needle, lever, lamp" },
                "con_bocche": { "type": "boolean", "description": "Solo i simboli con bocche per i tubi" } } }),
        ),
        strumento(
            "schema_simbolo",
            "Come si DISEGNA un simbolo del progetto: il formato della descrizione (forme, \
             materiali, veli, parti vive, flange e tronchetti che diventano bocche), le regole \
             di disegno della libreria e tre esempi veri. CHIAMALO prima di bozza_simbolo: un \
             simbolo non si scrive in SVG, si descrive, e SWS lo compila come quelli di libreria.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        strumento(
            "bozza_simbolo",
            "Compila la descrizione di un simbolo nuovo e la tiene come BOZZA di questa \
             conversazione: non tocca il progetto. Restituisce l'id (prj:<slug>), le bocche e le \
             parti, oppure gli errori da correggere. La persona vede la miniatura. Da lì in avanti \
             il simbolo si usa nelle pagine (valida e istantanea_pagina lo vedono), e entra nel \
             progetto con proponi_modifica. Ridisegnarlo = richiamarla con lo stesso slug. Puoi \
             chiamarla più volte nello stesso giro, una per simbolo.",
            json!({ "type": "object", "required": ["descrizione"], "additionalProperties": false,
                    "properties": { "descrizione": { "type": "object",
                        "description": "La descrizione: slug, w, h, tipo, body, it, en, ops \
                                        (vedi schema_simbolo)." } } }),
        ),
    ]
}

/// Cosa la conversazione ha in più, deciso all'apertura del socket dagli scopi
/// configurati (`ai/scopi.rs`). L'elenco degli strumenti non cambia dopo: la
/// cache è un confronto di prefisso.
#[derive(Debug, Clone, Copy, Default)]
pub struct Opzioni {
    /// Lo scopo «simboli» ha un modello suo: `disegna_simbolo` al posto di
    /// `bozza_simbolo`.
    pub disegna_simboli: bool,
    /// C'è un fornitore di immagini: `genera_sfondo` e `varia_sfondo`.
    pub sfondi: bool,
}

/// Gli strumenti di questa conversazione: quelli di sempre, più quelli degli
/// scopi configurati **in coda** (per non spostare il prefisso in cache).
pub fn definizioni_per(o: Opzioni) -> Vec<Value> {
    let mut v = definizioni();
    if o.disegna_simboli {
        v.retain(|d| d["name"] != "bozza_simbolo");
        v.push(strumento(
            "disegna_simbolo",
            "Fa disegnare un simbolo nuovo dal MODELLO DEI SIMBOLI di questa installazione (un \
             modello diverso da te, scelto per disegnare). Tu dici cosa disegnare, a parole: \
             la macchina, la forma, dove stanno le bocche dei tubi, le parti vive (rotore, \
             livello, lancetta, leva, spia), la proporzione. Lui scrive la descrizione, SWS la \
             compila e la tiene come BOZZA di questa conversazione, come faceva bozza_simbolo. \
             Restituisce l'id (prj:<slug>), le bocche e le parti. Ridisegnarlo = richiamarlo con \
             lo stesso slug e cosa cambiare. Dopo le bozze fermati e fai scegliere la persona.",
            json!({ "type": "object", "required": ["slug", "it", "en", "cosa"],
                    "additionalProperties": false,
                    "properties": {
                        "slug": { "type": "string", "description": "a-z, 0-9 e «-», 3–40 caratteri" },
                        "it": { "type": "string", "description": "etichetta italiana" },
                        "en": { "type": "string", "description": "etichetta inglese" },
                        "w": { "type": "integer", "description": "larghezza del disegno, multiplo di 10 (tipico 60–160)" },
                        "h": { "type": "integer", "description": "altezza del disegno, multiplo di 10" },
                        "cosa": { "type": "string", "description": "cosa disegnare, a parole, con bocche e parti vive" } } }),
        ));
    }
    if o.sfondi {
        v.push(strumento(
            "genera_sfondo",
            "Genera una o più BASI candidate per lo sfondo fotografico di una pagina \
             (gpt-image-2, 1536×1024: in pagina va come oggetto image a tutta pagina con \
             image_fit «cover»). Scrivi la descrizione della scena IN INGLESE: cosa c'è, dove sta \
             (sinistra, centro, destra), il punto di vista. Le basi restano in questa \
             conversazione; la persona le vede in chat. REGOLA: dopo genera_sfondo FERMATI. La \
             base la sceglie la persona col bottone «Usa come base» sotto la miniatura, non tu. \
             Le varianti di luce (giorno, tramonto, sera…) non si generano MAI da capo: si fanno \
             con varia_sfondo dalla base approvata, altrimenti gli oggetti si spostano.",
            json!({ "type": "object", "required": ["descrizione"], "additionalProperties": false,
                    "properties": {
                        "descrizione": { "type": "string", "description": "la scena, in inglese" },
                        "quante": { "type": "integer", "minimum": 1, "maximum": 3,
                                    "description": "quante candidate (default 1); ognuna costa" } } }),
        ));
        v.push(strumento(
            "varia_sfondo",
            "Crea le varianti di luce di una base APPROVATA dalla persona, modificandola: stessa \
             inquadratura, stessi oggetti negli stessi punti, cambia solo la luce. Così le \
             coordinate che misuri sulla base valgono per tutte le varianti, e la dissolvenza fra \
             loro è pulita. Rifiuta una base non approvata. Per la dissolvenza: le varianti sono \
             oggetti image sovrapposti a tutta pagina, il primo sempre pieno, gli altri con \
             bindings.opacity scalato su un tag di luce (in_min/in_max → 0..1, clamp). Il src di \
             ognuno è quello che ti restituisce questo strumento.",
            json!({ "type": "object", "required": ["base", "luci"], "additionalProperties": false,
                    "properties": {
                        "base": { "type": "string", "description": "l'id della base approvata (sfondo-N)" },
                        "luci": { "type": "array", "minItems": 1, "maxItems": 5, "items": { "type": "string" },
                                  "description": "giorno, alba, tramonto, sera, notte, o una luce a parole" } } }),
        ));
    }
    v
}

fn strumento(nome: &str, descrizione: &str, schema: Value) -> Value {
    json!({ "name": nome, "description": descrizione, "input_schema": schema })
}

/// Gli strumenti che **leggono e basta**, cioè esattamente quelli che `esegui`
/// smista qui sotto.
///
/// Esiste perché il server MCP (`crate::mcp`) esponga quelli e nessun altro, e
/// perché la scelta sia una riga che si legge invece di una deduzione da un
/// `match`. Il test `nessuno_strumento_sfugge_alla_classificazione` tiene i due
/// elenchi uguali all'insieme di `definizioni()`: aggiungere uno strumento
/// senza decidere da che parte sta fa diventare rosso quel test, che è il punto.
pub const SOLA_LETTURA: [&str; 13] = [
    "elenca_pagine",
    "leggi_pagina",
    "leggi_progetto",
    "elenca_tag",
    "schema_oggetto",
    "schema_sorgente",
    "schema_tag",
    "valida",
    "leggi_script",
    "schema_python",
    "controlla_python",
    "cerca_simboli",
    "schema_simbolo",
];

/// I due che **non** passano da `esegui`, e perché.
///
/// `proponi_modifica` non produce un risultato da rimandare al modello: chiude
/// il turno verso il browser, dove vivono il confronto, i due bottoni e il
/// passo unico di annullamento. Fuori da quella finestra non ha destinazione.
///
/// `istantanea_pagina` copia il progetto in una cartella temporanea e avvia un
/// secondo runtime per fotografarlo col motore LVGL vero: il ciclo la intercetta
/// perché il suo risultato è un blocco immagine, non un testo.
///
/// `bozza_simbolo` scrive nel **banco della conversazione**, che vive nel ciclo
/// della chat e non altrove: fuori da lì una bozza non avrebbe dove stare.
pub const FUORI_DA_ESEGUI: [&str; 6] = [
    "proponi_modifica",
    "istantanea_pagina",
    "bozza_simbolo",
    // Gli strumenti degli scopi (04-11-2026): scrivono nel banco e chiamano un
    // secondo modello, quindi vivono nel ciclo come bozza_simbolo.
    "disegna_simbolo",
    "genera_sfondo",
    "varia_sfondo",
];

/// Le definizioni dei soli strumenti di sola lettura.
pub fn definizioni_sola_lettura() -> Vec<Value> {
    definizioni()
        .into_iter()
        .filter(|d| {
            d.get("name")
                .and_then(Value::as_str)
                .is_some_and(|n| SOLA_LETTURA.contains(&n))
        })
        .collect()
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
        "cerca_simboli" => cerca_simboli(s, input).await,
        "schema_simbolo" => schema_simbolo(),
        // `proponi_modifica` non passa di qui: la intercetta il ciclo, perché
        // è l'unica che non produce un risultato da rimandare al modello ma
        // chiude il turno verso il browser.
        altro => Err(format!("strumento sconosciuto: `{altro}`")),
    }
}

fn arg_str<'a>(input: &'a Value, nome: &str) -> Result<&'a str, String> {
    input
        .get(nome)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("manca l'argomento obbligatorio `{nome}`"))
}

async fn dir_progetto(s: &AppState) -> Result<std::path::PathBuf, String> {
    active_dir(s)
        .await
        .map_err(|_| "nessun progetto aperto".to_string())
}

async fn carica_progetto(s: &AppState) -> Result<Project, String> {
    let dir = dir_progetto(s).await?;
    Project::load(&dir).map_err(|e| format!("il progetto non si carica: {e:#}"))
}

pub async fn carica_pagine(s: &AppState) -> Result<Vec<SynopticPage>, String> {
    let dir = dir_progetto(s).await?;
    let sdir = synoptics_dir_at(&dir);
    let mut out = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(&sdir).await else {
        return Ok(out);
    };
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
    // Il nome di una pagina può essere un token (`{{t0021}}`): dai template
    // del 04-11-2026 lo sono tutti, perché la cornice lo mostra tradotto. Al
    // modello serve anche quello che legge una persona, nella lingua
    // principale del progetto.
    let lingue = carica_progetto(s)
        .await
        .map(|p| p.languages)
        .unwrap_or_default();
    Ok(json!(pagine
        .iter()
        .map(|p| {
            let mut v = json!({
                "id": p.id, "nome": p.name,
                "width": p.width, "height": p.height,
                "oggetti": p.objects.len(),
            });
            if p.name.contains("{{") {
                v["titolo"] = json!(sws_core::project::resolve_msg(
                    &p.name,
                    &lingue.default,
                    &lingue
                ));
            }
            v
        })
        .collect::<Vec<_>>()))
}

async fn leggi_pagina(s: &AppState, nome: &str) -> Esito {
    let pagine = carica_pagine(s).await?;
    // Per nome o per id: un nome tradotto (`{{t0001}}`) non dice niente al
    // modello, l'id sì — e il 04-11-2026 Kimi ha chiesto `p_impianto`.
    match pagine
        .iter()
        .find(|p| p.name == nome)
        .or_else(|| pagine.iter().find(|p| p.id == nome))
    {
        Some(p) => serde_json::to_value(p).map_err(|e| e.to_string()),
        None => Err(format!(
            "la pagina `{nome}` non esiste. Ci sono (nome — id): {}",
            pagine
                .iter()
                .map(|p| format!("{} — {}", p.name, p.id))
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

async fn leggi_progetto(s: &AppState) -> Esito {
    let mut p = carica_progetto(s).await?;
    // Non ereditata dall'handler HTTP: qui si entra da dentro.
    mask_project_secrets(&mut p);
    let mut v = serde_json::to_value(&p).map_err(|e| e.to_string())?;
    // I simboli disegnati nel progetto sono descrizioni lunghe: li elenca
    // `cerca_simboli`, e `proponi_modifica` li rimette da sé quando il
    // progetto torna indietro senza (vedi `valida_interna`).
    if let Some(o) = v.as_object_mut() {
        o.remove("simboli");
    }
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

/// I tag dichiarati — e, per quelli compositi, **i percorsi delle foglie**.
///
/// Una struttura o un array non si legge e non si scrive dalla radice: gli
/// oggetti si legano a `motore1.velocita`. Un modello che vede solo `motore1`
/// e il suo `type_ref` dovrebbe indovinare i membri del tipo (o chiamare
/// `leggi_progetto` e ricostruirli a mano attraverso i `type_ref` annidati):
/// qui i percorsi ci sono già, con il tipo scalare di ognuno. Il filtro guarda
/// anche i percorsi, così `filtro: "velocita"` trova le foglie e non solo le
/// radici che si chiamano così.
async fn elenca_tag(s: &AppState, filtro: Option<&str>) -> Esito {
    let p = carica_progetto(s).await?;
    Ok(righe_tag(&p, filtro.unwrap_or("")))
}

/// La parte pura di `elenca_tag`: un progetto in mano, niente stato.
fn righe_tag(p: &sws_core::project::Project, f: &str) -> Value {
    let foglie_di = |t: &sws_core::project::TagDef| -> Vec<sws_core::percorso::Foglia> {
        match sws_core::percorso::Forma::da_tag(t, &p.types) {
            Ok(Some(forma)) => forma.foglie(&t.id, &p.types),
            // Una forma che non sta in piedi (tipo inesistente, ciclo) la
            // segnala `valida`: qui si tace e si mostra la sola radice.
            _ => Vec::new(),
        }
    };
    json!(p
        .tags
        .iter()
        .filter(|t| {
            f.is_empty()
                || t.id.contains(f)
                || foglie_di(t).iter().any(|fg| fg.percorso.contains(f))
        })
        .map(|t| {
            let mut o = serde_json::Map::new();
            o.insert("id".into(), json!(t.id));
            o.insert("data_type".into(), json!(t.data_type));
            if let Some(tr) = &t.type_ref {
                o.insert("type_ref".into(), json!(tr));
            }
            if let Some(a) = &t.array {
                o.insert("array".into(), json!(a));
            }
            if t.e_composito() {
                let fg = foglie_di(t);
                o.insert(
                    "percorsi".into(),
                    json!(fg
                        .iter()
                        .map(|x| json!({ "percorso": x.percorso, "data_type": x.tipo.nome() }))
                        .collect::<Vec<_>>()),
                );
                o.insert(
                    "nota".into(),
                    json!("Composito: lega gli oggetti ai `percorsi`, non a questo id."),
                );
            }
            if !t.description.is_empty() {
                o.insert("descrizione".into(), json!(t.description));
            }
            if let Some(u) = &t.unit {
                o.insert("unit".into(), json!(u));
            }
            if t.is_computed() {
                o.insert("calcolato".into(), json!(true));
                o.insert("scrivibile".into(), json!(false));
            }
            Value::Object(o)
        })
        .collect::<Vec<_>>())
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
        "nota": format!(
            "Il tipo di un tag è `data_type`, con valori {} o string(N); `int` e `float` \
             sono alias di i64 e f64. Un tag con `expression` o con `generator` attivo è \
             calcolato: non si può scrivere. Un tag con `type_ref` (una struttura \
             dichiarata in `types:`) o con `array` (le dimensioni, es. [4] o [2,3]) è \
             COMPOSITO: il suo id da solo non è un dato, e gli oggetti si legano ai \
             percorsi delle foglie — `motore1.velocita`, `zone[2].t`. I percorsi li dà \
             `elenca_tag`; `data_type` resta obbligatorio anche sui compositi.",
            sws_core::tipo::NOMI.join(", ")
        ),
    }))
}

fn schema_oggetto(tipo: &str) -> Esito {
    if !sch::OBJECT_TYPES.contains(&tipo) {
        return Err(format!(
            "`{tipo}` non è un tipo di oggetto. Sono: {}",
            sch::OBJECT_TYPES.join(", ")
        ));
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
        return Err(format!(
            "`{kind}` non è un tipo di sorgente. Sono: {}",
            sch::SOURCE_KINDS.join(", ")
        ));
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
    if f.required {
        o.insert("obbligatorio".into(), json!(true));
    }
    if !f.doc.is_empty() {
        o.insert("doc".into(), json!(f.doc));
    }
    Value::Object(o)
}

/// Il giudizio su una proposta. Stessa logica dell'endpoint HTTP, chiamata da
/// dentro — e con la stessa distinzione fra rilievi nuovi e preesistenti.
pub async fn valida(s: &AppState, input: &Value) -> Esito {
    valida_interna(s, input, &[], false)
        .await
        .map(|(giudizio, _)| giudizio)
}

/// Le bozze di simbolo che una proposta porta nel progetto: quelle elencate in
/// `simboli`, oppure — con `solo_usate` — quelle che le pagine proposte usano;
/// senza, tutte (è `valida`, che deve vedere quello che il modello sta
/// costruendo).
pub fn bozze_da_portare<'a>(
    input: &Value,
    raw_pages: &[Value],
    bozze: &'a [sws_core::simboli_prj::Descrizione],
    solo_usate: bool,
) -> Result<Vec<&'a sws_core::simboli_prj::Descrizione>, String> {
    if let Some(elenco) = input.get("simboli").and_then(Value::as_array) {
        let mut out = Vec::new();
        for x in elenco {
            let slug = x.as_str().unwrap_or("").trim_start_matches("prj:");
            let d = bozze.iter().find(|d| d.slug == slug).ok_or_else(|| {
                format!(
                    "`simboli` nomina «{slug}», che non è una bozza di questa conversazione: \
                         disegnala prima con bozza_simbolo"
                )
            })?;
            out.push(d);
        }
        return Ok(out);
    }
    if !solo_usate {
        return Ok(bozze.iter().collect());
    }
    let testo = serde_json::to_string(raw_pages).unwrap_or_default();
    Ok(bozze
        .iter()
        .filter(|d| testo.contains(&format!("\"prj:{}\"", d.slug)))
        .collect())
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
pub async fn valida_interna(
    s: &AppState,
    input: &Value,
    bozze: &[sws_core::simboli_prj::Descrizione],
    solo_usate: bool,
) -> Result<(Value, Option<Value>), String> {
    let dir = dir_progetto(s).await?;
    let raw_pages: Vec<Value> = input
        .get("pages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let usate = bozze_da_portare(input, &raw_pages, bozze, solo_usate)?;
    // Con delle bozze da portare il progetto cambia anche se il modello non lo
    // ha mandato: si parte da quello che `leggi_progetto` gli avrebbe dato.
    let progetto_in: Option<Value> = match input.get("project") {
        Some(v) => Some(v.clone()),
        None if !usate.is_empty() => Some(leggi_progetto(s).await?),
        None => None,
    };

    // Sul grezzo **originale**, prima di ricomporre: dopo, un `codice:` scritto
    // male non si distinguerebbe più da un corpo che il modello non ha mandato.
    let mut findings = unknown_fields(input.get("project"), &raw_pages);

    let disco =
        Project::load(&dir).map_err(|e| format!("il progetto sul disco non si carica: {e:#}"))?;

    let (project, normalizzato): (Project, Option<Value>) = match progetto_in.as_ref() {
        // Ricaricato invece di clonato: `Project` non è `Clone`, e `disco`
        // serve ancora sotto per i rilievi preesistenti.
        None => (
            Project::load(&dir).map_err(|e| format!("il progetto non si carica: {e:#}"))?,
            None,
        ),
        Some(v) => {
            let mut grezzo = v.clone();
            findings.extend(crate::validate::ricomponi_script(&mut grezzo, &disco));
            // I simboli del progetto non passano dal modello (`leggi_progetto`
            // li toglie): tornano quelli del disco, più le bozze, al loro posto
            // se lo slug c'è già.
            if grezzo.get("simboli").is_none() {
                grezzo["simboli"] = serde_json::to_value(&disco.simboli).unwrap_or(json!([]));
            }
            for d in &usate {
                let nuovo = serde_json::to_value(d).map_err(|e| e.to_string())?;
                let elenco = grezzo["simboli"]
                    .as_array_mut()
                    .ok_or("`simboli` del progetto non è un elenco")?;
                match elenco.iter().position(|x| x["slug"] == d.slug.as_str()) {
                    Some(i) => elenco[i] = nuovo,
                    None => elenco.push(nuovo),
                }
            }
            let p = serde_json::from_value(grezzo.clone()).map_err(|e| {
                format!(
                    "il progetto proposto non si legge: {e}. Deve essere il \
                                      progetto INTERO come te l'ha dato leggi_progetto, con la \
                                      tua modifica dentro — non solo la parte cambiata."
                )
            })?;
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
            Err(e) => {
                return Err(format!(
                    "pages[{i}] non si legge come pagina: {e}. Una \
                                          pagina ha bisogno di `id`, `name` e `objects`."
                ))
            }
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
    let elenco: Vec<Value> = findings
        .iter()
        .map(|f| {
            let vecchio = prima.contains(&format!("{}\u{1}{}", f.path, f.message));
            if !vecchio {
                nuovi += 1;
            }
            let mut v = serde_json::to_value(f).unwrap_or(Value::Null);
            if vecchio {
                v["preesistente"] = Value::Bool(true);
            }
            v
        })
        .collect();

    let errori_nuovi = findings
        .iter()
        .filter(|f| {
            f.severity == crate::validate::Severity::Error
                && !prima.contains(&format!("{}\u{1}{}", f.path, f.message))
        })
        .count();

    Ok((
        json!({
            "ok": errori_nuovi == 0,
            "errori_nuovi": errori_nuovi,
            "rilievi_nuovi": nuovi,
            "rilievi": elenco,
        }),
        normalizzato,
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// Simboli (piano 2026-11-03-assistente-genera-simboli-e-sinottici)
// ─────────────────────────────────────────────────────────────────────────────

/// Il catalogo della libreria, letto una volta dallo schema generato.
fn catalogo_libreria() -> &'static [Value] {
    static C: std::sync::OnceLock<Vec<Value>> = std::sync::OnceLock::new();
    C.get_or_init(|| serde_json::from_str(sch::SYMBOL_CATALOG_JSON).unwrap_or_default())
}

/// La voce di catalogo di un simbolo compilato (del progetto o in bozza).
pub fn voce_catalogo(c: &sws_core::simboli_prj::Compilato) -> Value {
    let v = &c.voce;
    let lista = |k: &str, f: &dyn Fn(&Value) -> String| -> Vec<String> {
        v[k].as_array()
            .map(|a| a.iter().map(f).collect())
            .unwrap_or_default()
    };
    json!({
        "id": v["id"], "famiglia": "project", "tipo": v["kind"],
        "it": v["labels"]["it"], "en": v["labels"]["en"],
        "w": v["viewBox"][0], "h": v["viewBox"][1],
        "parti": lista("parts", &|p| format!("{}:{}", p["id"].as_str().unwrap_or(""), p["kind"].as_str().unwrap_or(""))),
        "bocche": lista("ports", &|b| format!("{}@{}", b["id"].as_str().unwrap_or(""), b["side"].as_str().unwrap_or(""))),
    })
}

/// Il filtro di `cerca_simboli`, separato per poterlo provare.
pub fn filtra_simboli<'a>(voci: &'a [Value], input: &Value) -> Vec<&'a Value> {
    let testo = input
        .get("testo")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_lowercase();
    let parole: Vec<&str> = testo.split_whitespace().collect();
    let campo = |k: &str| {
        input
            .get(k)
            .and_then(Value::as_str)
            .filter(|x| !x.is_empty())
    };
    voci.iter()
        .filter(|v| {
            let fieno = format!(
                "{} {} {} {} {}",
                v["id"].as_str().unwrap_or(""),
                v["it"].as_str().unwrap_or(""),
                v["en"].as_str().unwrap_or(""),
                v["tipo"].as_str().unwrap_or(""),
                v["alias"].as_str().unwrap_or("")
            )
            .to_lowercase();
            parole.iter().all(|p| fieno.contains(p))
                && campo("famiglia").is_none_or(|f| v["famiglia"] == f)
                && campo("tipo").is_none_or(|t| v["tipo"] == t)
                && campo("con_parti").is_none_or(|k| {
                    v["parti"].as_array().is_some_and(|a| {
                        a.iter()
                            .any(|p| p.as_str().is_some_and(|p| p.ends_with(&format!(":{k}"))))
                    })
                })
                && (input.get("con_bocche").and_then(Value::as_bool) != Some(true)
                    || v["bocche"].as_array().is_some_and(|a| !a.is_empty()))
        })
        .collect()
}

async fn cerca_simboli(s: &AppState, input: &Value) -> Esito {
    let mut voci: Vec<Value> = catalogo_libreria().to_vec();
    if let Ok(p) = carica_progetto(s).await {
        for d in &p.simboli {
            if let Ok(c) = sws_core::simboli_prj::compila_e_controlla(d) {
                voci.push(voce_catalogo(&c));
            }
        }
    }
    let trovati = filtra_simboli(&voci, input);
    const MASSIMO: usize = 40;
    Ok(json!({
        "trovati": trovati.len(),
        "simboli": trovati.iter().take(MASSIMO).collect::<Vec<_>>(),
        "nota": if trovati.len() > MASSIMO {
            format!("mostrati i primi {MASSIMO}: restringi con testo, famiglia o tipo")
        } else {
            "w×h è il disegno: l'oggetto in pagina può avere un'altra misura, ma con le stesse \
             proporzioni il simbolo non si deforma. Le bocche (id@lato) vanno in from_port/to_port \
             di un tubo agganciato con from_obj_id/to_obj_id.".to_string()
        },
    }))
}

/// Come si disegna un simbolo: formato, materiali, veli, regole ed esempi.
pub fn schema_simbolo() -> Esito {
    use sws_core::simboli_prj::{MATERIALI, VELI};
    let esempi: Value = serde_json::from_str(sch::SYMBOL_EXAMPLES_JSON).unwrap_or(Value::Null);
    Ok(json!({
        "descrizione": {
            "slug": "id del simbolo: a-z, 0-9 e «-», da 3 a 40 caratteri. In pagina diventa symbol_id \"prj:<slug>\"",
            "w": "larghezza del disegno, multiplo di 10, al più 512 (tipico 60–160)",
            "h": "altezza del disegno, come w",
            "tipo": "la tipologia, in inglese: machines, pumps, tanks, conveyors, kitchen, lighting…",
            "body": "il materiale del corpo: è il colore delle forme dello strato «corpo» finché lo stato non lo cambia",
            "it": "etichetta italiana", "en": "etichetta inglese",
            "ops": "le operazioni, nell'ordine in cui si disegnano: prima ciò che sta dietro",
        },
        "operazioni": {
            "corpo": "{op:\"corpo\"}: apre lo strato che prende il COLORE DI STATO. Le forme qui dentro vanno SENZA mat. Ogni simbolo ne ha uno",
            "statico": "{op:\"statico\"}: apre uno strato fermo sopra i precedenti (dettagli, bulloni, vetri)",
            "forma": "{op:\"forma\", tag: rect|circle|ellipse|path, geo:{x,y,width,height,rx} | {cx,cy,r} | {cx,cy,rx,ry} | {d}, mat?, velo?, extra?}",
            "luce": "{op:\"luce\", tag, geo, velo?=glass-r, opacita?}: un riflesso di vetro senza forma piena sotto",
            "riflesso": "{op:\"riflesso\", tag, geo, opacita?=0.18}: un lampo di bianco",
            "tratto": "{op:\"tratto\", d, mat?, extra?}: una linea; senza mat prende il contorno dello strato",
            "parte": "{op:\"parte\", id, kind, geo}: apre uno strato VIVO; le forme dopo, fino al prossimo strato, sono la parte",
            "flangia_v": "{op:\"flangia_v\", x, y, w?=4, h?=16}: piastra di un tubo orizzontale. A filo del bordo sinistro o destro diventa una BOCCA",
            "flangia_o": "{op:\"flangia_o\", x, y, w?=16, h?=4}: piastra di un tubo verticale; a filo del bordo alto o basso è una bocca",
            "tubo_o": "{op:\"tubo_o\", x, y, w, h?=10}: tronchetto orizzontale, dalla flangia al corpo",
            "tubo_v": "{op:\"tubo_v\", x, y, h, w?=10}: tronchetto verticale",
            "bocca": "{op:\"bocca\", x, y, side: left|top|right|bottom, d, id?}: una bocca dichiarata a mano, dove non c'è una flangia",
        },
        "parti_vive": {
            "rotor": "geo {cx, cy, symmetry}: gira attorno a (cx,cy); symmetry = gradi dopo cui il disegno si ripete (6 pale = 60). Si accende con symbol_spin",
            "level": "geo {x, y, w, h}: la finestra del contenuto. Disegna il liquido PIENO (mat liquid): il motore ne mostra la parte bassa secondo fill_level_tag",
            "needle": "geo {cx, cy, a0, a1}: lancetta disegnata a metà scala, ruota da a0 (minimo) ad a1 (massimo) in gradi orari. Si lega in symbol_parts",
            "lever": "geo {cx, cy, open, closed}: leva disegnata nella posizione aperta; closed è la sua rotazione. Si lega in symbol_parts",
            "lamp": "geo {}: id «lamp» o «lamp-…». Disegna la lente SPENTA in uno strato statico (mat lamp-*-off) e la lente ACCESA nella parte (mat lamp-*). Si lega in symbol_parts",
        },
        "materiali": MATERIALI.iter().map(|(n, c)| json!({ "nome": n, "colore": c })).collect::<Vec<_>>(),
        "veli": VELI.iter().map(|v| v.nome).collect::<Vec<_>>(),
        "veli_come": "un velo dà volume a una forma piena. -v per superfici allungate in orizzontale (tubi orizzontali), -h per quelle verticali, -r per forme tonde, -d diagonale. paint-* sulle vernici, metal-* sui metalli, dark-* sulle parti scure, rubber-r sulla gomma, dial-r sui quadranti, glass-r (con luce) sul vetro. Senza velo la forma è piatta",
        "attributi_extra": "stroke_width (0–20), stroke_opacity e fill_opacity (0–1), stroke_linecap (butt|round|square), stroke_linejoin, stroke_dasharray (\"3 2\"), stroke e fill solo «none». Nessun colore libero: i colori vengono SOLO dai materiali",
        "regole": [
            "vista ortogonale di fronte, luce dall'alto a sinistra, lo stesso livello di dettaglio della libreria (gli esempi): la macchina si deve riconoscere dalle sue parti, e leggere a 60–120 px",
            "niente testo nel disegno: il pannello non ha font. Le scritte si mettono in pagina come oggetti text",
            "il contorno lo mette lo strato: stroke «none» solo sui dettagli che non lo vogliono",
            "i tubi della libreria hanno diametro 8 in pagina: tronchetto 10, flangia 4×16 a filo del bordo, con l'asse su un multiplo di 10. Ingresso a sinistra, uscita a destra o in alto",
            "una flangia a filo del bordo diventa una bocca da sé: l'id è n-left, n-right, n-top, n-bottom (n-left-2… se ce ne sono due sullo stesso lato)",
            "il corpo è la parte che cambia colore con lo stato: mettici la carcassa della macchina, non i tubi",
            "un simbolo descrive UNA macchina; le scritte, i valori e i tubi fra macchine stanno in pagina",
        ],
        "esempi": esempi,
    }))
}

/// Compila una descrizione arrivata dal modello: o la descrizione con il suo
/// compilato, o gli errori da rimandargli.
pub fn compila_bozza(
    input: &Value,
) -> Result<
    (
        sws_core::simboli_prj::Descrizione,
        sws_core::simboli_prj::Compilato,
    ),
    Vec<String>,
> {
    let v = input
        .get("descrizione")
        .ok_or_else(|| vec!["manca `descrizione`".to_string()])?;
    if v.to_string().len() > 32 * 1024 {
        return Err(vec![
            "descrizione oltre i 32 KB: semplifica il disegno".into()
        ]);
    }
    let mut d: sws_core::simboli_prj::Descrizione =
        serde_json::from_value(v.clone()).map_err(|e| {
            vec![format!(
                "la descrizione non si legge: {e}. Vedi schema_simbolo"
            )]
        })?;
    // Un simbolo del progetto non ha famiglia: quella la dà solo la libreria.
    d.family = None;
    let c = sws_core::simboli_prj::compila_e_controlla(&d)?;
    Ok((d, c))
}

/// Quello che il modello riceve da una bozza riuscita.
pub fn esito_bozza(c: &sws_core::simboli_prj::Compilato) -> Value {
    json!({
        "ok": true,
        "symbol_id": c.voce["id"],
        "viewBox": c.voce["viewBox"],
        "bocche": c.voce.get("ports").cloned().unwrap_or(json!([])),
        "parti": c.voce["parts"],
        "nota": "è una bozza: si vede in valida e istantanea_pagina, ed entra nel progetto con \
                 proponi_modifica. In pagina: type symbol, symbol_id come sopra, con le stesse \
                 proporzioni del viewBox. Per guardarla: istantanea_pagina senza nome.",
    })
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
    let globale = input.get("script_globale").and_then(Value::as_str);

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
                elenco_o_nessuno(p.functions.iter().map(|f| f.name.as_str()))
            )),
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
                elenco_o_nessuno(p.global_scripts.iter().map(|g| g.id.as_str()))
            )),
        },
        (Some(_), Some(_)) => Err(
            "passa `funzione` **oppure** `script_globale`, non entrambi: \
                                   sono due cose diverse e leggerne due in una volta \
                                   nasconderebbe quale hai chiesto"
                .into(),
        ),
        (None, None) => Err("manca l'argomento: `funzione` (per nome) oppure \
                            `script_globale` (per id)"
            .into()),
    }
}

fn elenco_o_nessuno<'a>(it: impl Iterator<Item = &'a str>) -> String {
    let v: Vec<&str> = it.collect();
    if v.is_empty() {
        "nessuno".into()
    } else {
        v.join(", ")
    }
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
            { "nome": "tags", "cosa": "I tag del progetto. `tags.read('id')` legge \
                (None se il tag non esiste), `tags.write('id', valore)` scrive. NON è \
                indicizzabile: `tags['id']` solleva TypeError, non è mai stato il modo \
                giusto. Un tag con `expression` o con `generator` attivo è calcolato: \
                scriverlo viene rifiutato." },
            { "nome": "print", "cosa": "Finisce nello stdout catturato e nel log. \
                Serve per la diagnosi, non per comunicare con l'operatore." },
            { "nome": "send_telegram", "cosa": "`send_telegram('testo')`. Funziona solo \
                se il canale Telegram è configurato nelle notifiche del progetto." },
            { "nome": "now_ms", "cosa": "`now_ms()` — millisecondi dall'epoch Unix \
                (T-69). Congelato all'inizio di questa esecuzione, non cambia se \
                chiamato più volte nello stesso giro." },
            { "nome": "uptime_ms", "cosa": "`uptime_ms()` — millisecondi dalla PRIMA \
                volta che questo script/funzione è girato in questo processo (T-69), \
                non dall'avvio del runtime." },
            { "nome": "delta_ms", "cosa": "`delta_ms()` — millisecondi dall'ULTIMA \
                invocazione di questo script/funzione (T-69). Vale 0 al primo giro: \
                una rampa scritta come `pos += delta_ms() / periodo` resta ferma al \
                primo giro invece di saltare, e si muove a cadenza reale indipendente \
                da quanto spesso il trigger la richiama." },
            { "nome": "state", "cosa": "`state.get('chiave', default=None)` / \
                `state.set('chiave', valore)` (T-69) — memoria persistente fra un giro \
                e l'altro dello STESSO script/funzione (es. la direzione di una \
                rampa), senza bisogno di un tag di servizio. Solo bool/int/float/str." },
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
            { "kind": "interval", "campi": {
                "interval_s": "secondi, intero, minimo 1",
                "interval_ms": "opzionale (T-69), millisecondi — quando presente VINCE \
                    su interval_s, minimo 50. Serve una cadenza sotto il secondo che \
                    interval_s non può esprimere; senza, il comportamento è quello di \
                    sempre." } },
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
        o.insert(
            "come_leggerlo".into(),
            json!(
                "`vietato: false` = errore di sintassi, guarda `riga`. \
             `vietato: true` = Python valido ma proibito dalla sandbox: cambia strada, \
             non la virgola. `sandbox_verificata: false` = i divieti non sono stati \
             controllati su questa istanza, ma sul dispositivo valgono."
            ),
        );
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    /// Nessuno strumento sfugge alla classificazione.
    ///
    /// `SOLA_LETTURA` decide cosa esce dal server MCP. Un dodicesimo strumento
    /// aggiunto a `definizioni()` senza decidere da che parte sta non deve
    /// trovarsi esposto per inerzia, né sparire in silenzio: deve far diventare
    /// rosso questo test e costringere a scegliere.
    #[test]
    fn nessuno_strumento_sfugge_alla_classificazione() {
        let mut tutti: std::collections::BTreeSet<String> = definizioni()
            .iter()
            .map(|d| d["name"].as_str().unwrap().to_string())
            .collect();
        // Con tutti gli scopi accesi compaiono gli strumenti in più.
        tutti.extend(
            definizioni_per(Opzioni {
                disegna_simboli: true,
                sfondi: true,
            })
            .iter()
            .map(|d| d["name"].as_str().unwrap().to_string()),
        );
        let classificati: std::collections::BTreeSet<String> = SOLA_LETTURA
            .iter()
            .chain(FUORI_DA_ESEGUI.iter())
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            tutti, classificati,
            "elenchi disallineati: chi manca va deciso, non dimenticato"
        );
        assert_eq!(definizioni_sola_lettura().len(), SOLA_LETTURA.len());
        for d in definizioni_sola_lettura() {
            assert!(!FUORI_DA_ESEGUI.contains(&d["name"].as_str().unwrap()));
        }
    }

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
        let campi: Vec<&str> = v["campi"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                c["nome"]
                    .as_str()
                    .or_else(|| c["name"].as_str())
                    .unwrap_or("")
            })
            .collect();
        assert!(
            campi.contains(&"button_mode"),
            "senza button_mode il modello ripiega su un altro widget: {campi:?}"
        );
        // Il campo senza i suoi valori ammessi non basta: `toggle` va nominato.
        let e = v["enum"]["button_mode"]
            .as_array()
            .expect("button_mode deve portare il suo enum");
        assert!(e.iter().any(|x| x == "toggle"), "enum: {e:?}");
    }

    /// E il verso rotto della stessa regola: non deve mostrare i campi di *altri*
    /// tipi, altrimenti il rimedio diventa il rumore da cui `TYPE_USAGE` protegge.
    #[test]
    fn ma_non_mostra_i_campi_degli_altri_tipi() {
        let v = schema_oggetto("button").unwrap();
        let campi: Vec<&str> = v["campi"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                c["nome"]
                    .as_str()
                    .or_else(|| c["name"].as_str())
                    .unwrap_or("")
            })
            .collect();
        for estraneo in [
            "gauge_min",
            "spark_points",
            "trend_dt_format",
            "pie_show_labels",
        ] {
            assert!(
                !campi.contains(&estraneo),
                "`{estraneo}` non riguarda un bottone"
            );
        }
    }

    /// Il tipo di un tag si chiama `data_type`. Il modello ha sbagliato due volte
    /// su due prove, perché nessuno strumento glielo diceva.
    #[test]
    fn lo_schema_del_tag_esiste_e_nomina_data_type() {
        let v = schema_tag().unwrap();
        let campi: Vec<&str> = v["campi"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                c["nome"]
                    .as_str()
                    .or_else(|| c["name"].as_str())
                    .unwrap_or("")
            })
            .collect();
        assert!(campi.contains(&"data_type"), "campi: {campi:?}");
        assert!(campi.contains(&"id"));
        assert!(v["nota"].as_str().unwrap().contains("data_type"));
    }

    /// Un composito porta con sé i percorsi delle sue foglie.
    ///
    /// Senza, il modello vede `motore1` con `type_ref: Motore` e deve
    /// indovinare come si chiamano i membri — o ricostruirli da
    /// `leggi_progetto` seguendo i `type_ref` annidati a mano. È il giro che
    /// `schema_tag` è nato per togliere, sulla stessa famiglia di errore.
    #[test]
    fn elenca_tag_mostra_i_percorsi_di_una_struttura() {
        // Costruito dal JSON e non a campi: `Project` non ha `Default`, e
        // così il test passa anche dal serde che usa il progetto vero.
        let p: sws_core::project::Project = serde_json::from_value(json!({
            "meta": { "name": "test", "version": "1" },
            "types": [{ "id": "Motore", "members": [
                { "name": "velocita", "data_type": "f32" },
                { "name": "marcia", "data_type": "bool" }] }],
            "tags": [
                { "id": "motore1", "data_type": "bool", "type_ref": "Motore" },
                { "id": "livello", "data_type": "f32" }],
        }))
        .unwrap();

        let v = righe_tag(&p, "");
        let righe = v.as_array().unwrap();
        assert_eq!(righe.len(), 2);
        assert_eq!(righe[0]["type_ref"], "Motore");
        let percorsi: Vec<&str> = righe[0]["percorsi"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["percorso"].as_str().unwrap())
            .collect();
        assert_eq!(percorsi, ["motore1.velocita", "motore1.marcia"]);
        assert_eq!(righe[0]["percorsi"][0]["data_type"], "f32");
        // Uno scalare resta com'era: nessun campo nuovo, nessun rumore.
        assert!(righe[1].get("percorsi").is_none());
        assert!(righe[1].get("nota").is_none());

        // Il filtro guarda anche i percorsi: chi cerca «velocita» vuole la
        // foglia, e la radice non si chiama così.
        let solo = righe_tag(&p, "velocita");
        assert_eq!(solo.as_array().unwrap().len(), 1);
        assert_eq!(solo[0]["id"], "motore1");
        assert_eq!(righe_tag(&p, "livello").as_array().unwrap().len(), 1);
    }

    /// Lo schema del tag dice che un composito non si lega dalla radice.
    #[test]
    fn lo_schema_del_tag_spiega_i_compositi() {
        let nota = schema_tag().unwrap()["nota"].as_str().unwrap().to_string();
        assert!(nota.contains("type_ref"), "{nota}");
        assert!(nota.contains("array"), "{nota}");
        assert!(nota.contains("motore1.velocita"), "{nota}");
    }

    /// `cerca_simboli` trova per parola (italiano o inglese), per parte viva e
    /// per bocche, e il catalogo generato copre tutta la libreria.
    #[test]
    fn il_catalogo_dei_simboli_si_cerca() {
        let voci = catalogo_libreria();
        assert!(voci.len() >= 195, "catalogo di {} voci", voci.len());
        let ids = |v: Vec<&Value>| {
            v.iter()
                .map(|x| x["id"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        let pompe = ids(filtra_simboli(
            voci,
            &json!({ "testo": "pompa centrifuga" }),
        ));
        assert!(
            pompe.contains(&"lib:process/centrifugal-pump".to_string()),
            "{pompe:?}"
        );
        let pompe_en = ids(filtra_simboli(voci, &json!({ "testo": "centrifugal" })));
        assert!(pompe_en.contains(&"lib:process/centrifugal-pump".to_string()));
        // Per parte viva: ogni risultato ha un livello.
        let livelli = filtra_simboli(voci, &json!({ "con_parti": "level" }));
        assert!(!livelli.is_empty());
        assert!(livelli
            .iter()
            .all(|v| v["parti"].to_string().contains(":level")));
        // Per bocche e famiglia insieme.
        let tubi = filtra_simboli(voci, &json!({ "famiglia": "process", "con_bocche": true }));
        assert!(tubi
            .iter()
            .all(|v| v["famiglia"] == "process" && !v["bocche"].as_array().unwrap().is_empty()));
        // Un alias storico si trova anche col suo nome.
        assert!(!filtra_simboli(voci, &json!({ "testo": "boiler" })).is_empty());
    }

    /// Gli esempi di `schema_simbolo` sono descrizioni vere, nella forma corta:
    /// compilate, danno la stessa voce del simbolo di libreria da cui vengono.
    #[test]
    fn gli_esempi_di_schema_simbolo_compilano_come_la_libreria() {
        let schema = schema_simbolo().unwrap();
        let esempi = schema["esempi"].as_array().unwrap();
        assert_eq!(esempi.len(), 3);
        let manifesto: Value = serde_json::from_str(include_str!(
            "../../../../../sws-editor/public/symbols/lib/manifest.json"
        ))
        .unwrap();
        for e in esempi {
            let (d, c) =
                compila_bozza(&json!({ "descrizione": e })).unwrap_or_else(|m| panic!("{m:?}"));
            let lib = manifesto["symbols"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["id"].as_str().unwrap().ends_with(&format!("/{}", d.slug)))
                .unwrap();
            assert_eq!(c.voce["parts"], lib["parts"], "{}", d.slug);
            assert_eq!(
                c.voce["ports"].as_array().map(|a| a.len()),
                lib["ports"].as_array().map(|a| a.len()),
                "{}",
                d.slug
            );
            assert_eq!(c.voce["materials"], lib["materials"], "{}", d.slug);
        }
    }

    /// Quali bozze una proposta porta nel progetto.
    #[test]
    fn le_bozze_della_proposta_sono_quelle_usate_o_elencate() {
        let d = |slug: &str| -> sws_core::simboli_prj::Descrizione {
            let mut v: Value = serde_json::from_str(include_str!(
                "../../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
            ))
            .unwrap();
            v["slug"] = json!(slug);
            serde_json::from_value(v).unwrap()
        };
        let bozze = vec![d("gabbia-a"), d("gabbia-b")];
        let pagine = vec![json!({ "name": "P", "objects": [{ "symbol_id": "prj:gabbia-b" }] })];
        let slug = |v: Vec<&sws_core::simboli_prj::Descrizione>| {
            v.iter().map(|d| d.slug.clone()).collect::<Vec<_>>()
        };
        assert_eq!(
            slug(bozze_da_portare(&json!({}), &pagine, &bozze, true).unwrap()),
            ["gabbia-b"]
        );
        assert_eq!(
            slug(bozze_da_portare(&json!({}), &pagine, &bozze, false).unwrap()),
            ["gabbia-a", "gabbia-b"]
        );
        assert_eq!(
            slug(
                bozze_da_portare(
                    &json!({ "simboli": ["prj:gabbia-a"] }),
                    &pagine,
                    &bozze,
                    true
                )
                .unwrap()
            ),
            ["gabbia-a"]
        );
        assert!(
            bozze_da_portare(&json!({ "simboli": ["nessuna"] }), &pagine, &bozze, true).is_err()
        );
    }

    /// Una bozza sbagliata torna indietro con gli errori, non come SVG.
    #[test]
    fn una_bozza_sbagliata_dice_perche() {
        let e = compila_bozza(&json!({ "descrizione": { "slug": "x" } })).unwrap_err();
        assert!(e[0].contains("schema_simbolo"), "{e:?}");
        let mut v: Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap();
        v["body"] = json!("oro");
        assert!(compila_bozza(&json!({ "descrizione": v })).is_err());
        // Una famiglia scritta dal modello non lo trasforma in un `lib:`.
        let mut v: Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap();
        v["family"] = json!("process");
        let (d, c) = compila_bozza(&json!({ "descrizione": v })).unwrap();
        assert!(d.family.is_none());
        assert_eq!(c.voce["id"], "prj:gabbia-laminazione");
        assert_eq!(esito_bozza(&c)["symbol_id"], "prj:gabbia-laminazione");
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
            "elenca_pagine",
            "leggi_pagina",
            "leggi_progetto",
            "elenca_tag",
            "schema_oggetto",
            "schema_sorgente",
            "valida",
            "proponi_modifica",
            "schema_tag",
        ];
        let d = definizioni();
        let nomi: Vec<&str> = d.iter().map(|x| x["name"].as_str().unwrap()).collect();
        assert!(nomi.len() >= PREFISSO.len(), "strumenti spariti: {nomi:?}");
        assert_eq!(
            &nomi[..PREFISSO.len()],
            &PREFISSO[..],
            "il prefisso della cache si è mosso: {nomi:?}"
        );
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
        assert!(
            tutto.contains("import"),
            "i divieti devono nominare `import`"
        );
        // 2. I tag si leggono da `tags`, non sono variabili globali.
        assert!(
            v["disponibili"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d["nome"] == "tags"),
            "`tags` deve essere fra le cose disponibili: {tutto}"
        );
        // 3. Il cron ha CINQUE campi, e un solo campo non e' valido: e'
        //    l'errore che STATUS registra come da prevenire.
        assert!(
            tutto.contains("CINQUE") || tutto.contains("cinque"),
            "la forma del cron va detta: {tutto}"
        );
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
        let spento = schema_python(false).unwrap();

        assert_eq!(acceso["sandbox_attiva"], serde_json::json!(true));
        assert_eq!(spento["sandbox_attiva"], serde_json::json!(false));

        let nota = spento["nota_sandbox"].as_str().unwrap();
        assert!(
            nota.contains("ATTENZIONE"),
            "l'avviso deve essere visibile: {nota}"
        );
        assert!(
            nota.contains("dispositivo"),
            "deve dire che sul dispositivo i divieti valgono: {nota}"
        );
        // E il ramo acceso non deve portare lo stesso avviso, altrimenti e' rumore.
        assert!(!acceso["nota_sandbox"]
            .as_str()
            .unwrap()
            .contains("ATTENZIONE"));
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
        let nomi: Vec<String> = definizioni()
            .iter()
            .map(|x| x["name"].as_str().unwrap().to_string())
            .collect();
        for atteso in ["leggi_script", "schema_python", "controlla_python"] {
            assert!(
                nomi.iter().any(|n| n == atteso),
                "manca `{atteso}`: {nomi:?}"
            );
        }
    }
}

#[cfg(test)]
mod tests_opzioni {
    use super::*;

    fn nomi(o: Opzioni) -> Vec<String> {
        definizioni_per(o)
            .iter()
            .map(|d| d["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn senza_scopi_gli_strumenti_sono_quelli_di_sempre() {
        assert_eq!(definizioni_per(Opzioni::default()), definizioni());
    }

    #[test]
    fn gli_strumenti_in_piu_vanno_in_coda_e_bozza_cede_a_disegna() {
        let base = nomi(Opzioni::default());
        let tutti = nomi(Opzioni {
            disegna_simboli: true,
            sfondi: true,
        });
        assert!(!tutti.contains(&"bozza_simbolo".to_string()));
        let fine = &tutti[tutti.len() - 3..];
        assert_eq!(fine, ["disegna_simbolo", "genera_sfondo", "varia_sfondo"]);
        // Il prefisso resta quello di sempre (tolto bozza_simbolo, che è l'ultimo).
        assert_eq!(base.last().map(String::as_str), Some("bozza_simbolo"));
        assert_eq!(&tutti[..base.len() - 1], &base[..base.len() - 1]);
    }
}
