// I fornitori di traduzione automatica, dietro un tratto solo (Fase 4 del piano
// multilingua, 15-09-2026).
//
// **Il tratto esiste perché i fornitori sono diversi per natura, non per
// prudenza.** Uno è gratuito e senza chiave ma con un tetto giornaliero; uno si
// ospita in casa; uno costa e capisce il contesto. Su un impianto sono scelte
// diverse, non alternative equivalenti, e chi installa deve poter scegliere
// senza che il resto del codice se ne accorga.
//
// Cosa NON sta qui: la decisione di cosa tradurre e la protezione dei
// segnaposti, che sono pure e vivono in `sws_core::traduzione` con i loro test.
// Un traduttore non si prova senza rete; una decisione sì.
//
// **Mai a runtime.** Tradurre è un'operazione di progettazione: il dispositivo
// in campo è spesso senza Internet (Q43, punto 5), e il viewer LVGL ha per di
// più Q55 aperta — una POST via `spawn` che riceve 200 si blocca per sempre.
// L'endpoint che usa questo modulo vive solo sulle istanze IDE.

use serde::{Deserialize, Serialize};

/// Chi traduce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Fornitore {
    /// **Modalità semplice: nessuna chiave, nessuna configurazione.**
    ///
    /// MyMemory è una memoria di traduzione pubblica con un'API aperta. Il
    /// prezzo dichiarato: un tetto di caratteri al giorno per indirizzo IP, e
    /// una qualità che varia — è una memoria, quindi su frasi già viste è
    /// ottima e su frasi nuove meno. Per riempire una colonna di etichette di
    /// un sinottico è più che sufficiente; per il testo di un allarme va
    /// riletto, come dice Q43 punto 2 per qualunque fornitore.
    MyMemory,
    /// Libero e ospitabile in casa. Senza chiave verso un'istanza pubblica,
    /// con chiave verso una privata. È la scelta di chi non vuole che le
    /// stringhe del proprio impianto escano da un server che non controlla.
    LibreTranslate,
    /// Google Cloud Translation, a consumo e con chiave. È il fornitore
    /// nominato dal maintainer quando ha aperto Q43: deterministico,
    /// economico per volume, e con una copertura di lingue che nessun altro
    /// qui eguaglia.
    Google,
    /// Il fornitore IA già configurato per l'assistente dell'editor
    /// (`ai/client.rs`): chiave fuori dal progetto, permessi 0600, endpoint
    /// solo-IDE. Costa, e in cambio è l'unico che può ricevere il contesto —
    /// «questa è l'etichetta di un pulsante di un impianto industriale» — che
    /// è esattamente ciò che distingue «Avvio» di una pompa da «Avvio» di un
    /// ciclo.
    Ia,
}

impl Fornitore {
    /// Serve una chiave per usarlo?
    pub fn richiede_chiave(self) -> bool {
        matches!(self, Fornitore::Ia | Fornitore::Google)
    }

    /// Un nome da mostrare, e una riga che dice cosa si sta scegliendo.
    pub fn descrizione(self) -> (&'static str, &'static str) {
        match self {
            Fornitore::MyMemory => (
                "MyMemory (semplice, gratuito)",
                "Nessuna chiave. Tetto di caratteri al giorno; qualità variabile — \
                 ottima sulle frasi comuni, meno su quelle di impianto.",
            ),
            Fornitore::LibreTranslate => (
                "LibreTranslate (libero, ospitabile in casa)",
                "Senza chiave verso l'istanza pubblica, con chiave verso la tua. \
                 Le stringhe non escono dal tuo server se lo ospiti tu.",
            ),
            Fornitore::Google => (
                "Google Cloud Translation (a consumo)",
                "Chiave richiesta. Deterministico e con la copertura di lingue più \
                 ampia; si paga a caratteri.",
            ),
            Fornitore::Ia => (
                "Assistente IA (Claude / Kimi)",
                "Usa la chiave già configurata per l'assistente dell'editor. È \
                 l'unico che riceve il CONTESTO — «etichetta di un pulsante di un \
                 impianto industriale» — e quindi l'unico che può distinguere \
                 «Avvio» di una pompa da «Avvio» di un ciclo.",
            ),
        }
    }
}

/// Come è configurata la traduzione automatica su questa istanza.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTraduzione {
    pub fornitore: Fornitore,
    /// Per LibreTranslate: l'istanza da usare. Assente = quella pubblica.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Per LibreTranslate: chiave, se l'istanza la vuole.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chiave: Option<String>,
}

impl Default for ConfigTraduzione {
    /// Il default è la modalità semplice: chi apre l'editor e preme «traduci»
    /// deve ottenere una traduzione, non un modulo di configurazione.
    fn default() -> Self {
        Self {
            fornitore: Fornitore::MyMemory,
            url: None,
            chiave: None,
        }
    }
}

const LIBRE_PUBBLICA: &str = "https://libretranslate.com";

/// Traduce un testo alla volta.
///
/// Uno alla volta e non in blocco: i tre fornitori hanno tre forme di richiesta
/// multipla diverse (o non ce l'hanno), e sbagliare l'accoppiamento fra righe
/// mandate e righe tornate scriverebbe la traduzione di una frase sotto la
/// chiave di un'altra — un difetto che nessuno nota finché non legge il
/// pannello in quella lingua. Il chiamante scandisce e si ferma al primo
/// errore.
pub async fn traduci(
    client: &reqwest::Client,
    cfg: &ConfigTraduzione,
    // Dove vivono le chiavi del fornitore IA: **fuori dal progetto**, che è la
    // regola scritta in `ai/client.rs` («il progetto si esporta, si manda in
    // giro e finisce su un dispositivo»).
    config_dir: &std::path::Path,
    testo: &str,
    da: &str,
    a: &str,
) -> anyhow::Result<String> {
    match cfg.fornitore {
        Fornitore::MyMemory => mymemory(client, testo, da, a).await,
        Fornitore::LibreTranslate => libretranslate(client, cfg, testo, da, a).await,
        Fornitore::Google => google(client, cfg, testo, da, a).await,
        Fornitore::Ia => ia(client, config_dir, testo, da, a).await,
    }
}

/// Google Cloud Translation v2: una GET/POST secca con la chiave in query.
/// `format=text` perché il nostro testo non è HTML — con `html` Google
/// escaperebbe i caratteri e ci tornerebbe indietro `&#39;` al posto degli
/// apostrofi, che su un pannello si vedono.
async fn google(
    client: &reqwest::Client,
    cfg: &ConfigTraduzione,
    testo: &str,
    da: &str,
    a: &str,
) -> anyhow::Result<String> {
    let chiave = cfg
        .chiave
        .as_deref()
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("Google Cloud Translation richiede una chiave API"))?;
    #[derive(Deserialize)]
    struct Risposta {
        data: Option<Dati>,
        error: Option<Errore>,
    }
    #[derive(Deserialize)]
    struct Dati {
        translations: Vec<Tradotta>,
    }
    #[derive(Deserialize)]
    struct Tradotta {
        #[serde(rename = "translatedText")]
        testo: String,
    }
    #[derive(Deserialize)]
    struct Errore {
        message: String,
    }
    let resp = client
        .post("https://translation.googleapis.com/language/translate/v2")
        .query(&[("key", chiave)])
        .json(&serde_json::json!({
            "q": testo, "source": da, "target": a, "format": "text",
        }))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Google non raggiungibile: {e}"))?;
    let stato = resp.status();
    let r: Risposta = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Google ha risposto {stato} in un formato ignoto: {e}"))?;
    if let Some(e) = r.error {
        anyhow::bail!("Google ha rifiutato ({stato}): {}", e.message);
    }
    r.data
        .and_then(|d| d.translations.into_iter().next())
        .map(|t| t.testo)
        .ok_or_else(|| anyhow::anyhow!("Google non ha restituito nessun testo"))
}

/// Il fornitore IA già configurato per l'assistente dell'editor.
///
/// Riusa `ai::client::carica`, quindi **la chiave non entra mai nel progetto**:
/// vive in `<config_dir>/<fornitore>.key` con permessi 0600, come dice il
/// commento in `ai/client.rs` — «il progetto si esporta, si manda in giro e
/// finisce su un dispositivo».
///
/// Il prompt dice al modello **che cosa sta traducendo**: è l'unica cosa che
/// questo fornitore ha in più, e non sfruttarla vorrebbe dire pagare un modello
/// per fare il lavoro di un traduttore secco. E gli si ordina di restituire
/// **solo** la traduzione: un modello che spiega la propria scelta finirebbe
/// con la spiegazione dentro l'etichetta di un pulsante.
async fn ia(
    client: &reqwest::Client,
    config_dir: &std::path::Path,
    testo: &str,
    da: &str,
    a: &str,
) -> anyhow::Result<String> {
    let scelta = crate::ai::client::carica(config_dir).ok_or_else(|| {
        anyhow::anyhow!(
            "nessun fornitore IA configurato: impostalo in Configurazione → IDE, oppure usa \
             la modalità semplice"
        )
    })?;
    let istruzioni = format!(
        "Traduci dal {da} al {a} il testo dell'interfaccia di un sistema SCADA industriale \
         (etichette di pulsanti, unità di misura, messaggi di allarme). \
         Rispondi SOLO con la traduzione, senza virgolette e senza spiegazioni. \
         Le sequenze fra caratteri NUL sono segnaposto tecnici: riportale IDENTICHE, \
         nella posizione giusta per la lingua di arrivo."
    );
    crate::ai::client::chiedi_una_volta(client, &scelta, &istruzioni, testo, 1024).await
}

async fn mymemory(
    client: &reqwest::Client,
    testo: &str,
    da: &str,
    a: &str,
) -> anyhow::Result<String> {
    #[derive(Deserialize)]
    struct Risposta {
        #[serde(rename = "responseData")]
        dati: Option<Dati>,
        #[serde(rename = "responseStatus")]
        stato: Option<serde_json::Value>,
        #[serde(rename = "responseDetails")]
        dettagli: Option<String>,
    }
    #[derive(Deserialize)]
    struct Dati {
        #[serde(rename = "translatedText")]
        testo: Option<String>,
    }

    let resp = client
        .get("https://api.mymemory.translated.net/get")
        .query(&[("q", testo), ("langpair", &format!("{da}|{a}"))])
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("MyMemory non raggiungibile: {e}"))?;
    let stato_http = resp.status();
    let corpo: Risposta = resp.json().await.map_err(|e| {
        anyhow::anyhow!("MyMemory ha risposto {stato_http} in un formato ignoto: {e}")
    })?;

    // MyMemory risponde 200 anche quando rifiuta: il motivo sta nel corpo. Un
    // controllo sul solo codice HTTP salverebbe in tabella la stringa
    // «MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY»
    // come se fosse una traduzione.
    let numerico = corpo.stato.as_ref().and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    });
    if numerico != Some(200) {
        anyhow::bail!(
            "MyMemory ha rifiutato: {}",
            corpo
                .dettagli
                .unwrap_or_else(|| "motivo non dichiarato".into())
        );
    }
    let tradotto = corpo
        .dati
        .and_then(|d| d.testo)
        .ok_or_else(|| anyhow::anyhow!("MyMemory non ha restituito nessun testo"))?;
    if tradotto.to_uppercase().contains("MYMEMORY WARNING") {
        anyhow::bail!("MyMemory: tetto giornaliero gratuito esaurito ({tradotto})");
    }
    Ok(tradotto)
}

async fn libretranslate(
    client: &reqwest::Client,
    cfg: &ConfigTraduzione,
    testo: &str,
    da: &str,
    a: &str,
) -> anyhow::Result<String> {
    #[derive(Deserialize)]
    struct Risposta {
        #[serde(rename = "translatedText")]
        testo: Option<String>,
        error: Option<String>,
    }
    let base = cfg
        .url
        .as_deref()
        .unwrap_or(LIBRE_PUBBLICA)
        .trim_end_matches('/');
    let mut corpo = serde_json::json!({
        "q": testo, "source": da, "target": a, "format": "text",
    });
    if let Some(k) = cfg.chiave.as_deref().filter(|k| !k.trim().is_empty()) {
        corpo["api_key"] = serde_json::Value::String(k.to_string());
    }
    let resp = client
        .post(format!("{base}/translate"))
        .json(&corpo)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("LibreTranslate ({base}) non raggiungibile: {e}"))?;
    let stato = resp.status();
    let r: Risposta = resp.json().await.map_err(|e| {
        anyhow::anyhow!("LibreTranslate ha risposto {stato} in un formato ignoto: {e}")
    })?;
    if let Some(err) = r.error {
        anyhow::bail!("LibreTranslate ha rifiutato ({stato}): {err}");
    }
    r.testo
        .ok_or_else(|| anyhow::anyhow!("LibreTranslate non ha restituito nessun testo"))
}

// ── L'endpoint ──────────────────────────────────────────────────────────────

use crate::router::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use sws_core::traduzione::{da_tradurre, ripristina, scrivi_automatica};

/// Tradurre è **progettazione**, non esercizio: l'endpoint esiste solo
/// sull'istanza IDE e risponde 404 altrove. Non è prudenza — è che sul
/// dispositivo la rete verso Internet spesso non c'è (Q43, punto 5) e il
/// viewer LVGL ha Q55 aperta. Un 404 e non un 403: su quella macchina la
/// funzione non deve esistere, non «non ti è permessa».
#[allow(clippy::result_large_err)]
fn solo_ide(s: &AppState) -> Result<(), Response> {
    if s.ide_only {
        Ok(())
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "errore": "la traduzione automatica esiste solo sull'istanza IDE: è \
                           un'operazione di progettazione, e il dispositivo in campo è \
                           spesso senza Internet",
            })),
        )
            .into_response())
    }
}

#[derive(Debug, Deserialize)]
pub struct RichiestaTraduzione {
    /// Lingua sorgente. Assente = la principale della tabella.
    #[serde(default)]
    pub da: Option<String>,
    /// Lingua di arrivo.
    pub a: String,
    /// Rifare anche ciò che era già stato tradotto **dalla macchina**. Le
    /// traduzioni umane restano intoccabili comunque (Q43, punto 4).
    #[serde(default)]
    pub sovrascrivi: bool,
    #[serde(default)]
    pub config: Option<ConfigTraduzione>,
}

#[derive(Debug, Serialize)]
pub struct EsitoTraduzione {
    pub tradotte: usize,
    pub saltate: usize,
    /// Le voci che il fornitore non ha saputo tradurre, con il motivo. Non è
    /// un fallimento della richiesta: una riga rifiutata su venti non deve
    /// buttare via le altre diciannove.
    pub problemi: Vec<String>,
}

/// `POST /api/project/languages/translate`
pub async fn traduci_progetto(
    State(s): State<AppState>,
    Json(req): Json<RichiestaTraduzione>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let dir = match crate::router::active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let mut progetto = match sws_core::Project::load(&dir) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "errore": format!("progetto illeggibile: {e}") })),
            )
                .into_response()
        }
    };

    let da = req
        .da
        .clone()
        .unwrap_or_else(|| progetto.languages.default.clone());
    if da.trim().is_empty() {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({
                "errore": "il progetto non ha una lingua principale: impostala in Configurazione → Lingue",
            })),
        )
            .into_response();
    }
    if da == req.a {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "errore": "lingua di partenza e di arrivo coincidono" })),
        )
            .into_response();
    }

    let cfg = req.config.clone().unwrap_or_default();
    let lavoro = da_tradurre(&progetto.languages, &da, &req.a, req.sovrascrivi);
    let saltate = progetto.languages.entries.len() - lavoro.len();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default();

    let mut tradotte = 0usize;
    let mut problemi = Vec::new();
    for voce in lavoro {
        match traduci(&client, &cfg, &s.config_dir, &voce.testo, &da, &req.a).await {
            Ok(grezzo) => match ripristina(&grezzo, &voce.segnaposti) {
                // Un segnaposto che non torna indietro fa scartare la riga: una
                // traduzione mutilata salvata è peggio di una riga non tradotta,
                // perché il widget mostrerebbe la frase senza il proprio valore.
                None => problemi.push(format!(
                    "{}: il fornitore ha perso un segnaposto di formato, riga scartata",
                    voce.key
                )),
                Some(finito) => {
                    if let Some(e) = progetto
                        .languages
                        .entries
                        .iter_mut()
                        .find(|e| e.key == voce.key)
                    {
                        scrivi_automatica(e, &req.a, finito);
                        tradotte += 1;
                    }
                }
            },
            Err(e) => problemi.push(format!("{}: {e}", voce.key)),
        }
    }

    if !progetto.languages.langs.iter().any(|l| l == &req.a) {
        progetto.languages.langs.push(req.a.clone());
    }
    if tradotte == 0 {
        return Json(EsitoTraduzione {
            tradotte,
            saltate,
            problemi,
        })
        .into_response();
    }

    // La scrittura passa dall'helper del repo e non da un `save` a mano: c'è un
    // lock che esiste per un motivo (Q30 — `patch_project` è un
    // leggi-modifica-scrivi, e due scritture concorrenti si perdevano a
    // vicenda).
    //
    // `patch_project` e **non** `patch_project_se`: qui non si confronta
    // nessun `If-Match`, come per `/api/project/migrate`. Il motivo è che fra
    // la lettura e la scrittura passano minuti — quelli spesi a parlare col
    // fornitore — e un confronto farebbe fallire la traduzione ogni volta che
    // qualcuno salva qualcos'altro nel frattempo, buttando via venti richieste
    // di rete già pagate. Si riscrive **solo** `languages`, quindi una modifica
    // concorrente ad altre sezioni sopravvive; resta scoperta quella alla
    // tabella lingue stessa, che è una finestra stretta e dichiarata.
    //
    // Usare `patch_project_se` con `None` sarebbe stato lo stesso comportamento
    // con un nome che promette un confronto che non c'è — e
    // `check_versione_progetto.sh` lo ha giustamente segnalato.
    let tabella = progetto.languages.clone();
    let esito =
        crate::router::patch_project(&s.project_write_lock, &dir, move |p| p.languages = tabella)
            .await;
    if !esito.status().is_success() {
        return esito;
    }

    Json(EsitoTraduzione {
        tradotte,
        saltate,
        problemi,
    })
    .into_response()
}
