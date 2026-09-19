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
    /// Per Google e LibreTranslate. Mai su disco tramite `salva()`: la chiave
    /// vive in un file a parte (F5, `nome_file_chiave`), come per l'IA.
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

/// Il nome del file che porta la chiave di un fornitore, `None` per chi non
/// ne ha uno persistito da noi: MyMemory non ne vuole, IA riusa quella già
/// salvata per l'assistente (`ai::client`) — una seconda copia sarebbe una
/// fonte di verità in più da tenere allineata, non un vantaggio.
fn nome_file_chiave(f: Fornitore) -> Option<&'static str> {
    match f {
        Fornitore::Google => Some("google_translate.key"),
        Fornitore::LibreTranslate => Some("libretranslate.key"),
        Fornitore::MyMemory | Fornitore::Ia => None,
    }
}

/// La chiave persistita per un fornitore, se ne ha una e se l'ha scritta (F5).
fn chiave_persistita(config_dir: &std::path::Path, f: Fornitore) -> Option<String> {
    let nome = nome_file_chiave(f)?;
    crate::segreti::leggi_chiave(&config_dir.join(nome))
}

/// La configurazione da usare per una traduzione, decisa con la precedenza di
/// F5: **esplicita** (arrivata con la richiesta) > **persistita** (istanza) >
/// **default** (MyMemory, D3). Pura e senza `AppState` apposta — è la regola
/// che deve restare vera a prescindere da come la si chiama, e si prova senza
/// un server acceso.
///
/// Anche quando arriva esplicita ma senza chiave si prova comunque il file:
/// così l'IDE può mandare solo fornitore+url e lasciare che sia il server a
/// completare con la chiave salvata, invece di doverla rileggere e rispedire
/// lui stesso a ogni traduzione.
fn risolvi_config(
    config_dir: &std::path::Path,
    esplicita: Option<ConfigTraduzione>,
) -> ConfigTraduzione {
    let mut cfg = esplicita
        .or_else(|| ConfigTraduzione::carica(config_dir))
        .unwrap_or_default();
    if cfg.chiave.is_none() {
        cfg.chiave = chiave_persistita(config_dir, cfg.fornitore);
    }
    cfg
}

impl ConfigTraduzione {
    fn percorso_impostazioni(config_dir: &std::path::Path) -> std::path::PathBuf {
        config_dir.join("traduzione.yaml")
    }

    /// Le impostazioni persistite — fornitore e url, **mai la chiave**, che
    /// vive nel suo file a parte (`nome_file_chiave`). `None` se il file non
    /// c'è o è malformato: chi chiama ripiega sul default (F5, come
    /// `ai::client::Impostazioni::carica`, stesso principio).
    fn carica(config_dir: &std::path::Path) -> Option<Self> {
        let testo = std::fs::read_to_string(Self::percorso_impostazioni(config_dir)).ok()?;
        match serde_yaml::from_str::<Self>(&testo) {
            Ok(c) => Some(Self { chiave: None, ..c }),
            Err(e) => {
                tracing::warn!("traduzione.yaml malformato, ignorato: {e:#}");
                None
            }
        }
    }

    /// Scrive fornitore e url su disco. La chiave, anche se `self.chiave` la
    /// porta, non viene mai scritta qui — va a `crate::segreti::scrivi_chiave`
    /// dal chiamante (l'endpoint `PUT`), che sa in quale file.
    fn salva(&self, config_dir: &std::path::Path) -> std::io::Result<()> {
        std::fs::create_dir_all(config_dir)?;
        let da_scrivere = Self {
            chiave: None,
            ..self.clone()
        };
        let testo = serde_yaml::to_string(&da_scrivere)
            .map_err(|e| std::io::Error::other(format!("{e}")))?;
        std::fs::write(Self::percorso_impostazioni(config_dir), testo)
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
         Il testo può contenere caratteri speciali che fanno da segnaposto tecnico: \
         riportali IDENTICI, uno per uno, nella posizione giusta per la lingua di \
         arrivo. Non tradurli, non spaziarli, non sostituirli."
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

use crate::router::{AppState, AuthUser, MASKED_PASSWORD};
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use sws_core::traduzione::{
    bordi, da_mandare, da_tradurre, proponi, scrivi_automatica, segmenta, va_approvata, Pezzo,
};

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
    /// Le voci tornate **mutilate**, salvate come proposta da correggere a mano
    /// invece che scartate. Tipicamente un segnaposto di formato perso per
    /// strada: la frase c'è, il numero no.
    pub proposte: usize,
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

    let cfg = risolvi_config(&s.config_dir, req.config.clone());
    let lavoro = da_tradurre(&progetto.languages, &da, &req.a, req.sovrascrivi);
    let saltate = progetto.languages.entries.len() - lavoro.len();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default();

    let mut tradotte = 0usize;
    let mut proposte = 0usize;
    let mut problemi = Vec::new();
    for voce in lavoro {
        // **Il segnaposto non esce dal nostro processo.**
        //
        // Tre guardiani diversi sono falliti nel tentativo di farlo
        // sopravvivere dentro il testo: NUL (non arrivava a destinazione),
        // `⟦0⟧` (tornava riordinato, «Warm stay: ⟦⟧0°C»), un carattere
        // dell'area privata (cancellato). Un fornitore di traduzione è una
        // scatola nera: ciò che gli mandi può tornare cambiato in modi che non
        // si finisce mai di prevedere.
        //
        // Quindi si traduce solo il testo **attorno** al segnaposto, un pezzo
        // per volta, e il segnaposto lo rimettiamo noi — che sappiamo dov'era.
        // Il prezzo dichiarato è che il traduttore non può riordinare il testo
        // attorno al segnaposto: il risultato può essere imperfetto, ma è
        // sempre INTERO.
        let pezzi = segmenta(&voce.testo);
        let mut composto = String::with_capacity(voce.testo.len());
        let mut fallito: Option<String> = None;
        for pezzo in &pezzi {
            match pezzo {
                Pezzo::Segnaposto(sp) => composto.push_str(sp),
                Pezzo::Testo(t) if !da_mandare(pezzo) => composto.push_str(t),
                Pezzo::Testo(t) => {
                    // Gli spazi ai bordi sono **giunzioni** verso il
                    // segnaposto, e non si affidano al fornitore: quasi tutti
                    // restituiscono la frase ripulita, e «Soggiorno caldo: »
                    // tornerebbe senza lo spazio, incollata al numero.
                    let (prima, dentro, dopo) = bordi(t);
                    match traduci(&client, &cfg, &s.config_dir, dentro, &da, &req.a).await {
                        Ok(tradotto) => {
                            composto.push_str(prima);
                            composto.push_str(tradotto.trim());
                            composto.push_str(dopo);
                        }
                        Err(e) => {
                            fallito = Some(e.to_string());
                            break;
                        }
                    }
                }
            }
        }

        let Some(e) = progetto
            .languages
            .entries
            .iter_mut()
            .find(|e| e.key == voce.key)
        else {
            continue;
        };
        match fallito {
            // D4 (decisione del maintainer, 18-09-2026): una voce con un
            // segnaposto o un simbolo arriva al traduttore a pezzi, senza
            // contesto, e un pezzo corto può tornare com'era — «e testo» →
            // «E Testo». Sembra tradotto e non lo è: va in rosso, da rileggere.
            None if va_approvata(&voce.testo) => {
                proponi(e, &req.a, composto);
                proposte += 1;
            }
            None => {
                scrivi_automatica(e, &req.a, composto);
                tradotte += 1;
            }
            // Una riga persa per strada a metà: ciò che si è ottenuto non si
            // butta, diventa una proposta da correggere a mano.
            Some(motivo) => {
                if !composto.trim().is_empty() {
                    proponi(e, &req.a, composto);
                    proposte += 1;
                }
                problemi.push(format!("{}: {motivo}", voce.key));
            }
        }
    }

    if !progetto.languages.langs.iter().any(|l| l == &req.a) {
        progetto.languages.langs.push(req.a.clone());
    }
    if tradotte == 0 && proposte == 0 {
        return Json(EsitoTraduzione {
            tradotte,
            saltate,
            proposte,
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
        proposte,
        problemi,
    })
    .into_response()
}

// ── Configurazione del fornitore, persistita nell'istanza (F5) ──────────────
//
// Stesso schema di `ai/config_api.rs`: le impostazioni (fornitore, url) in un
// file YAML dell'istanza, la chiave — quando il fornitore ne vuole una — in un
// file a parte con permessi 0600. La `GET` non restituisce mai la chiave,
// nemmeno mascherata: solo `ha_chiave`, come per l'assistente IA.

#[derive(Serialize)]
struct ConfigTraduzioneEsposta {
    fornitore: Fornitore,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    ha_chiave: bool,
}

/// `GET /api/traduzione/config` — Admin, solo IDE.
pub async fn get_config_traduzione(State(s): State<AppState>) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let cfg = ConfigTraduzione::carica(&s.config_dir).unwrap_or_default();
    let ha_chiave = chiave_persistita(&s.config_dir, cfg.fornitore).is_some();
    Json(ConfigTraduzioneEsposta {
        fornitore: cfg.fornitore,
        url: cfg.url,
        ha_chiave,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct ConfigTraduzioneBody {
    pub fornitore: Fornitore,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub chiave: Option<String>,
}

/// `PUT /api/traduzione/config` — Admin, solo IDE. Salva sempre
/// fornitore+url; la chiave solo se ne arriva una nuova e diversa dalla
/// sentinella `MASKED_PASSWORD` — la stessa convenzione di `/api/ai/config`,
/// «lascia vuoto/mascherato per non cambiarla».
pub async fn put_config_traduzione(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<ConfigTraduzioneBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }

    let nuova = body
        .chiave
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty() && *k != MASKED_PASSWORD);
    if let Some(k) = nuova {
        let Some(nome) = nome_file_chiave(body.fornitore) else {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "errore": "questo fornitore non prende una chiave da qui \
                               (MyMemory non ne vuole, IA riusa quella dell'assistente)",
                })),
            )
                .into_response();
        };
        if let Err(e) = crate::segreti::scrivi_chiave(&s.config_dir, nome, k) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "errore": format!("la chiave non si è potuta scrivere: {e}"),
                })),
            )
                .into_response();
        }
        s.audit.log(
            "traduzione.key_set",
            Some(user.username.clone()),
            serde_json::json!({ "fornitore": body.fornitore }),
        );
    }

    let cfg = ConfigTraduzione {
        fornitore: body.fornitore,
        url: body.url.clone(),
        chiave: None,
    };
    if let Err(e) = cfg.salva(&s.config_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "errore": format!("le impostazioni non si sono potute scrivere: {e}"),
            })),
        )
            .into_response();
    }
    s.audit.log(
        "traduzione.config_changed",
        Some(user.username),
        serde_json::json!({ "fornitore": body.fornitore, "url": body.url }),
    );

    Json(serde_json::json!({ "ok": true })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigTraduzioneDeleteBody {
    pub fornitore: Fornitore,
}

/// `DELETE /api/traduzione/config` — Admin, solo IDE. Cancella solo la
/// chiave del fornitore indicato; le impostazioni (fornitore/url persistiti)
/// restano — stesso principio di `/api/ai/config`.
pub async fn delete_config_traduzione(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<ConfigTraduzioneDeleteBody>,
) -> Response {
    if let Err(r) = solo_ide(&s) {
        return r;
    }
    let Some(nome) = nome_file_chiave(body.fornitore) else {
        // Niente chiave da cancellare per questo fornitore: non è un errore,
        // è lo stato in cui è sempre stato.
        return StatusCode::NO_CONTENT.into_response();
    };
    match crate::segreti::cancella_chiave(&s.config_dir, nome) {
        Ok(cera) => {
            if cera {
                s.audit.log(
                    "traduzione.key_removed",
                    Some(user.username),
                    serde_json::json!({ "fornitore": body.fornitore }),
                );
            }
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "errore": format!("cancellazione fallita: {e}") })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests_config_persistita {
    use super::*;

    #[test]
    fn la_configurazione_persistita_si_rilegge() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = ConfigTraduzione {
            fornitore: Fornitore::Google,
            url: None,
            chiave: None,
        };
        cfg.salva(dir.path()).unwrap();
        let riletta = ConfigTraduzione::carica(dir.path()).unwrap();
        assert_eq!(riletta.fornitore, Fornitore::Google);
    }

    #[test]
    fn la_chiave_non_finisce_in_traduzione_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = ConfigTraduzione {
            fornitore: Fornitore::LibreTranslate,
            url: Some("http://localhost:5000".into()),
            // Anche se qui c'è una chiave, `salva` non deve scriverla: va nel
            // suo file a parte, mai in `traduzione.yaml`.
            chiave: Some("una-chiave-segretissima".into()),
        };
        cfg.salva(dir.path()).unwrap();
        let testo = std::fs::read_to_string(dir.path().join("traduzione.yaml")).unwrap();
        assert!(
            !testo.contains("una-chiave-segretissima"),
            "la chiave è finita nel file delle impostazioni: {testo}"
        );
        assert!(
            !testo.contains("chiave"),
            "il campo chiave non doveva comparire affatto: {testo}"
        );
    }

    #[test]
    fn una_configurazione_assente_o_rotta_ripiega_su_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(ConfigTraduzione::carica(dir.path()).is_none());

        std::fs::write(dir.path().join("traduzione.yaml"), "{{{non è yaml").unwrap();
        assert!(ConfigTraduzione::carica(dir.path()).is_none());
    }

    #[test]
    fn la_richiesta_esplicita_vince_sul_file() {
        let dir = tempfile::tempdir().unwrap();
        // Persistito: Google.
        ConfigTraduzione {
            fornitore: Fornitore::Google,
            url: None,
            chiave: None,
        }
        .salva(dir.path())
        .unwrap();

        // Esplicito nella richiesta: LibreTranslate — deve vincere lui.
        let esplicita = ConfigTraduzione {
            fornitore: Fornitore::LibreTranslate,
            url: Some("http://mio-server:5000".into()),
            chiave: None,
        };
        let risolta = risolvi_config(dir.path(), Some(esplicita));
        assert_eq!(risolta.fornitore, Fornitore::LibreTranslate);
    }

    #[test]
    fn senza_richiesta_esplicita_si_usa_il_persistito() {
        let dir = tempfile::tempdir().unwrap();
        ConfigTraduzione {
            fornitore: Fornitore::LibreTranslate,
            url: Some("http://mio-server:5000".into()),
            chiave: None,
        }
        .salva(dir.path())
        .unwrap();

        let risolta = risolvi_config(dir.path(), None);
        assert_eq!(risolta.fornitore, Fornitore::LibreTranslate);
        assert_eq!(risolta.url.as_deref(), Some("http://mio-server:5000"));
    }

    #[test]
    fn senza_nulla_si_ripiega_sul_default_mymemory() {
        let dir = tempfile::tempdir().unwrap();
        let risolta = risolvi_config(dir.path(), None);
        assert_eq!(risolta.fornitore, Fornitore::MyMemory);
    }

    #[test]
    fn una_richiesta_esplicita_senza_chiave_la_completa_dal_file() {
        let dir = tempfile::tempdir().unwrap();
        crate::segreti::scrivi_chiave(dir.path(), "google_translate.key", "chiave-salvata")
            .unwrap();

        let esplicita = ConfigTraduzione {
            fornitore: Fornitore::Google,
            url: None,
            chiave: None,
        };
        let risolta = risolvi_config(dir.path(), Some(esplicita));
        assert_eq!(risolta.chiave.as_deref(), Some("chiave-salvata"));
    }

    #[test]
    fn una_richiesta_esplicita_con_chiave_non_va_a_cercarla_sul_file() {
        let dir = tempfile::tempdir().unwrap();
        crate::segreti::scrivi_chiave(dir.path(), "google_translate.key", "quella-sul-disco")
            .unwrap();

        let esplicita = ConfigTraduzione {
            fornitore: Fornitore::Google,
            url: None,
            chiave: Some("quella-della-richiesta".into()),
        };
        let risolta = risolvi_config(dir.path(), Some(esplicita));
        assert_eq!(risolta.chiave.as_deref(), Some("quella-della-richiesta"));
    }

    #[test]
    fn mymemory_e_ia_non_hanno_un_file_chiave() {
        assert_eq!(nome_file_chiave(Fornitore::MyMemory), None);
        assert_eq!(nome_file_chiave(Fornitore::Ia), None);
        assert!(nome_file_chiave(Fornitore::Google).is_some());
        assert!(nome_file_chiave(Fornitore::LibreTranslate).is_some());
    }
}
