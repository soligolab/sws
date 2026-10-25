use crate::router::{AppState, AuthUser};
use axum::{
    body::{Body, Bytes},
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Credentials for a connected remote runtime. Stored in AppState and used
/// by the WS relay handlers to proxy `/ws/remote/{tags,alarms,logs}`.
/// Volatile — cleared on local runtime restart.
#[derive(Clone, Debug)]
pub struct RemoteTarget {
    pub url: String,          // "http://192.168.1.10:7444" — no trailing slash
    pub token: String,        // UUID session token issued by the remote
    pub connected_at_ms: u64, // Unix epoch ms
    /// Le credenziali con cui si è entrati, **solo in memoria**.
    ///
    /// Servono a rientrare dopo un deploy: distribuire un progetto con i suoi
    /// utenti cambia le credenziali del dispositivo, e il token di prima
    /// smette di valere. Senza queste, l'unico modo di continuare era
    /// ridigitarle a mano — e intanto l'IDE diceva «connesso».
    ///
    /// Non finiscono su disco da nessuna parte: `RemoteTarget` è volatile e si
    /// perde al riavvio, come dice il commento sopra, e la lista dei
    /// dispositivi registrati la password non l'ha mai salvata.
    pub credenziali: Option<(String, String)>,
    /// Falso quando il token non vale più e non si è riusciti a rientrare.
    ///
    /// Esiste perché `remote_status` diceva «connesso» appena un bersaglio era
    /// memorizzato: una risposta vera a una domanda diversa da quella che
    /// faceva chi guardava il pulsante verde (16-10-2026).
    pub autenticato: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct ConnectBody {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Il codice di abbinamento del pannello (11-10-2026): se il pannello è in
    /// attesa, con codice + utente + password si crea il suo Admin e si entra.
    #[serde(default)]
    pub codice: Option<String>,
}

#[derive(Serialize)]
pub struct ConnectResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Riuscito, ma c'è qualcosa da sapere (es. il dispositivo non ha utenti e
    /// le credenziali sono state ignorate). Separata da `error` perché una
    /// connessione riuscita non deve comparire come fallita.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nota: Option<String>,
    /// Q49: cosa può fare l'utente per sbloccarsi, quando esiste un gesto
    /// preciso. Oggi solo `certificato-cambiato` → il pulsante «dimentica il
    /// certificato e riprova», gemello di quello per la chiave host SSH.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub azione: Option<&'static str>,
    /// L'impronta SHA-256 del certificato del dispositivo, quando il
    /// collegamento è in HTTPS (in chiaro non c'è niente da verificare).
    ///
    /// **Perché si mostra** (23-10-2026, decisione del maintainer sulla domanda
    /// di riga 64 del piano CRA). La fiducia al primo contatto era **muta**:
    /// l'impronta entrava in `dispositivi_conosciuti.yaml` prima ancora che il
    /// codice di abbinamento venisse chiesto, e chi si collegava non aveva modo
    /// di accorgersene — al primissimo «Connetti» ci si fidava di chiunque
    /// rispondesse. Mostrarla è il modello di SSH: il pannello la dice sul suo
    /// schermo e nell'installer, chi vuole confronta. Niente cerimonia nuova,
    /// niente da digitare, nessun accoppiamento fra archivi.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impronta: Option<String>,
    /// `true` quando l'impronta è stata memorizzata **adesso**, al primo
    /// contatto — cioè l'unico momento in cui un attacco in mezzo funziona, e
    /// l'unico in cui vale la pena guardare lo schermo del pannello.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impronta_nuova: Option<bool>,
}

#[derive(Serialize)]
pub struct RemoteStatus {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at_ms: Option<u64>,
    /// `false` quando il collegamento c'è ma le credenziali non valgono più.
    /// Assente da un runtime più vecchio: chi legge consideri `true`.
    ///
    /// Si serializza **sempre**, anche quando è `false`. Fino al 22-10-2026
    /// c'era `skip_serializing_if = "std::ops::Not::not"`, che lo toglieva dal
    /// JSON esattamente nel caso in cui serve: l'IDE lo legge con
    /// `s.autenticato === false` e un campo assente è `undefined`, quindi
    /// l'avviso non poteva comparire mai. C'era anche un `default = "si"`
    /// inerte — questa struct è solo `Serialize`, nessuno la deserializza.
    pub autenticato: bool,
}

/// `POST /api/remote/connect` — authenticate against a remote runtime and
/// store the session token. Used by RuntimeConnectionTab instead of the old
/// browser-side fetch to `{target}/api/auth/login`.
/// Cosa dire dell'impronta, dato cosa c'era nell'archivio **prima** della
/// richiesta e cosa c'è adesso.
///
/// È pura perché è la riga che si sbaglia: «nuova» non vuol dire «c'è», vuol
/// dire «prima non c'era» — ed è quella differenza che decide se chi si collega
/// deve andare a guardare lo schermo del pannello. Su `http://` non c'è
/// impronta e non c'è niente da dire: il campo resta assente, invece di
/// mostrare una riga vuota che farebbe credere a un'identità verificata.
fn impronta_da_mostrare(prima: Option<&str>, adesso: Option<String>) -> (Option<String>, Option<bool>) {
    match adesso {
        None => (None, None),
        Some(i) => {
            let nuova = prima.is_none();
            (Some(i), Some(nuova))
        }
    }
}

pub async fn connect_remote(
    State(s): State<AppState>,
    Json(body): Json<ConnectBody>,
) -> (StatusCode, Json<ConnectResult>) {
    let url = body.url.trim().trim_end_matches('/').to_string();

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return (
            StatusCode::OK,
            Json(ConnectResult {
                ok: false,
                impronta: None,
                impronta_nuova: None,
                nota: None,
                azione: None,
                error: Some("URL must start with http:// or https://".into()),
            }),
        );
    }

    // Q49: fiducia al primo contatto. Il certificato del pannello è self-signed,
    // quindi non si verifica una catena: si memorizza l'impronta la prima volta
    // e si pretende la stessa le volte dopo. Se cambia, si rifiuta e si dice.
    //
    // Si guarda **prima** cosa c'era nell'archivio, perché è l'unico modo di
    // sapere dopo se l'impronta è stata memorizzata adesso: lo store non lo
    // dice, e «adesso» è esattamente il momento che vale la pena mostrare.
    let chiave_impronta = crate::certificati::host_port_da_url(&url);
    let impronta_prima = chiave_impronta
        .as_deref()
        .and_then(|k| s.certificati.impronta_di(k));
    let client = match costruisci_client(&s, &url, 8) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::OK,
                Json(ConnectResult {
                    ok: false,
                    impronta: None,
                    impronta_nuova: None,
                    nota: None,
                    azione: None,
                    error: Some(format!("HTTP client error: {e}")),
                }),
            )
        }
    };

    // If credentials are provided, authenticate against the remote; otherwise
    // connect without a token (the remote is in no-auth / no-users mode).
    let username = body.username.as_deref().unwrap_or("").trim().to_string();
    let mut nota: Option<String> = None;

    // **Un pannello in attesa di abbinamento** (11-10-2026): non ha utenti e
    // non lascia entrare nessuno. Senza codice si dice cosa serve; col codice
    // si crea il suo Admin con le credenziali del modulo e si entra con quello.
    // Un pannello più vecchio non ha la rotta: si va avanti come sempre.
    let mut token_abbinamento: Option<String> = None;
    // **Abbinato al cloud e ancora senza utenti** (fetta E): ci si entra solo
    // dal gateway, che firma le richieste nel tunnel. Niente codice e niente
    // credenziali da chiedere: gli utenti li porterà il primo progetto.
    let stato = stato_abbinamento(&client, &url).await;
    let cloud_senza_utenti = stato
        .as_ref()
        .and_then(|v| v.get("abbinato_cloud_senza_utenti").and_then(|b| b.as_bool()))
        .unwrap_or(false);
    if cloud_senza_utenti {
        nota = Some(format!(
            "{url} è abbinato al cloud e non ha ancora utenti: li porterà il primo progetto distribuito."
        ));
    } else if stato
        .as_ref()
        .and_then(|v| v.get("in_attesa").and_then(|b| b.as_bool()))
        .unwrap_or(false)
    {
        let codice = body.codice.as_deref().unwrap_or("").trim();
        let password = body.password.as_deref().unwrap_or("");
        if codice.is_empty() || username.is_empty() || password.is_empty() {
            return (
                StatusCode::OK,
                Json(ConnectResult {
                    ok: false,
                    impronta: None,
                    impronta_nuova: None,
                    nota: None,
                    azione: Some(AZIONE_ABBINAMENTO),
                    error: Some(format!(
                        "{url} è un pannello nuovo, in attesa di abbinamento: inserisci il codice \
                         mostrato sul suo schermo (o nel log) e scegli utente e password del suo \
                         amministratore."
                    )),
                }),
            );
        }
        match rivendica(&client, &url, codice, &username, password).await {
            Ok(t) => {
                nota = Some(format!(
                    "{url} abbinato: «{username}» è il suo amministratore."
                ));
                token_abbinamento = Some(t);
            }
            Err(motivo) => {
                return (
                    StatusCode::OK,
                    Json(ConnectResult {
                        ok: false,
                        impronta: None,
                        impronta_nuova: None,
                        nota: None,
                        azione: Some(AZIONE_ABBINAMENTO),
                        error: Some(motivo),
                    }),
                )
            }
        }
    }

    // Senza credenziali verso un pannello che ha utenti la sonda qui sotto
    // passerebbe lo stesso (`/api/projects` è aperta sulla porta di gestione):
    // la connessione sembrerebbe riuscita e poi ogni deploy prenderebbe 401.
    // Visto l'11-10-2026 dopo il primo deploy di un pannello del cloud.
    if token_abbinamento.is_none()
        && !cloud_senza_utenti
        && username.is_empty()
        && !senza_utenti(&client, &url).await
    {
        return (
            StatusCode::OK,
            Json(ConnectResult {
                ok: false,
                impronta: None,
                impronta_nuova: None,
                nota: None,
                azione: None,
                error: Some(format!(
                    "{url} ha i suoi utenti: inserisci utente e password (quelli del progetto distribuito)."
                )),
            }),
        );
    }

    let token = if let Some(t) = token_abbinamento {
        t
    } else if cloud_senza_utenti || username.is_empty() {
        String::new()
    } else {
        let password = body.password.as_deref().unwrap_or("").to_string();
        let login_url = format!("{url}/api/auth/login");
        let res = match client
            .post(&login_url)
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let testo = format!("{e:?}");
                if crate::certificati::e_certificato_cambiato(&testo) {
                    return (StatusCode::OK, Json(ConnectResult {
                        ok: false, nota: None,
                        impronta: None, impronta_nuova: None,
                        azione: Some(crate::certificati::AZIONE_CERTIFICATO_CAMBIATO),
                        error: Some(format!(
                            "Il certificato TLS di {url} non è quello memorizzato su questo PC. \
                             Succede a ogni factory reset o reinstallazione del pannello. Se l'hai \
                             appena resettato tu, dimentica il vecchio certificato e riprova; \
                             altrimenti fermati e verifica di stare parlando con la macchina giusta."
                        )),
                    }));
                }
                return (
                    StatusCode::OK,
                    Json(ConnectResult {
                        ok: false,
                        impronta: None,
                        impronta_nuova: None,
                        nota: None,
                        azione: None,
                        error: Some(format!("Cannot reach {url}: {e}")),
                    }),
                );
            }
        };

        if res.status() == 401 {
            // Prima di dare del bugiardo all'utente: il dispositivo potrebbe
            // semplicemente non avere utenti definiti. Succede appena si
            // distribuisce un progetto senza `users.yaml` — e allora il login
            // fallisce non perché la password è sbagliata, ma perché non c'è
            // nessuna password al mondo che vada bene.
            //
            // Segnalato il 2026-09-08: credenziali rimaste nel modulo da un
            // dispositivo precedente, «unauthorized» sullo schermo, e nessun
            // indizio su cosa fare.
            if senza_utenti(&client, &url).await {
                nota = Some(format!(
                    "{url} non ha utenti definiti: connesso senza autenticazione \
                     (utente e password sono stati ignorati)."
                ));
                String::new()
            } else {
                return (
                    StatusCode::OK,
                    Json(ConnectResult {
                        ok: false,
                        impronta: None,
                        impronta_nuova: None,
                        nota: None,
                        azione: None,
                        error: Some(format!(
                            "credenziali rifiutate da {url}: l'utente «{username}» non esiste \
                         o la password è sbagliata."
                        )),
                    }),
                );
            }
        } else {
            if !res.status().is_success() {
                let code = res.status();
                return (
                    StatusCode::OK,
                    Json(ConnectResult {
                        ok: false,
                        impronta: None,
                        impronta_nuova: None,
                        nota: None,
                        azione: None,
                        error: Some(format!("Remote login returned {code}")),
                    }),
                );
            }

            let payload: serde_json::Value = match res.json().await {
                Ok(j) => j,
                Err(e) => {
                    return (
                        StatusCode::OK,
                        Json(ConnectResult {
                            ok: false,
                            impronta: None,
                            impronta_nuova: None,
                            nota: None,
                            azione: None,
                            error: Some(format!("Bad JSON from remote login: {e}")),
                        }),
                    )
                }
            };

            match payload.get("token").and_then(|t| t.as_str()) {
                Some(t) => t.to_string(),
                None => {
                    return (
                        StatusCode::OK,
                        Json(ConnectResult {
                            ok: false,
                            impronta: None,
                            impronta_nuova: None,
                            nota: None,
                            azione: None,
                            error: Some("Remote login response has no 'token' field".into()),
                        }),
                    )
                }
            }
        }
    };

    // Verify the URL really points at an ADMIN/IDE port before declaring the
    // connection good. Two reasons this check has to exist:
    //  - in no-auth mode the block above performs NO request at all, so any
    //    reachable (or even unreachable) URL used to turn the UI green;
    //  - probing /health would not help: it answers on the viewer port too.
    // The project-lifecycle routes live only on the admin port (dual-port
    // architecture), so `GET /api/projects` is the discriminating probe — it
    // is pre-auth there, hence usable with or without a token.
    // Without this, connecting to the viewer port succeeded and the failure
    // surfaced only later as "404 Not Found" + "405 Method Not Allowed"
    // in the middle of a deploy.
    let probe_url = format!("{url}/api/projects");
    let mut probe = client.get(&probe_url);
    if !token.is_empty() {
        probe = probe.bearer_auth(&token);
    }
    match probe.send().await {
        Ok(r) if r.status().is_success() => {}
        Ok(r) if r.status() == StatusCode::NOT_FOUND => {
            return (
                StatusCode::OK,
                Json(ConnectResult {
                    ok: false,
                    impronta: None,
                    impronta_nuova: None,
                    nota: None,
                    azione: None,
                    error: Some(format!(
                        "{url} answers but exposes no project API — this looks like the \
                     viewer port. Use the IDE/admin port instead (7444 by default)."
                    )),
                }),
            );
        }
        Ok(r) => {
            let code = r.status();
            return (
                StatusCode::OK,
                Json(ConnectResult {
                    ok: false,
                    impronta: None,
                    impronta_nuova: None,
                    nota: None,
                    azione: None,
                    error: Some(format!("Target returned {code} on /api/projects")),
                }),
            );
        }
        Err(e) => {
            return (
                StatusCode::OK,
                Json(ConnectResult {
                    ok: false,
                    impronta: None,
                    impronta_nuova: None,
                    nota: None,
                    azione: None,
                    error: Some(format!("Cannot reach {url}: {e}")),
                }),
            );
        }
    }

    let connected_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    *s.remote_target.write().await = Some(RemoteTarget {
        url: url.clone(),
        token,
        connected_at_ms,
        // Si tengono solo se ci sono: verso un pannello senza utenti non si
        // digita niente, e inventarle non si può — in `users.yaml` c'è un
        // hash argon2, non una password.
        credenziali: (!username.is_empty())
            .then(|| (username.clone(), body.password.clone().unwrap_or_default())),
        autenticato: true,
    });
    tracing::info!(remote = %url, "connected to remote runtime");
    // Nel cloud il pannello del progetto si ricorda (25-10-2026): riaprendo il
    // progetto l'IDE si ricollega da solo. Vedi `ripristina_se_serve`.
    if s.supervisor.e_nel_cloud() {
        let d = DispositivoRicordato {
            url: url.clone(),
            username: username.clone(),
            password: body.password.clone().unwrap_or_default(),
        };
        if let Err(e) = ricorda_dispositivo(&s.config_dir, &d) {
            tracing::warn!("pannello del progetto non ricordato: {e}");
        }
    }

    // Su `http://` non c'è nessuna impronta, e non è un errore: non c'è
    // nessuna identità da verificare. Il campo resta assente e l'IDE non
    // mostra niente.
    let (impronta, impronta_nuova) = impronta_da_mostrare(
        impronta_prima.as_deref(),
        chiave_impronta.as_deref().and_then(|k| s.certificati.impronta_di(k)),
    );

    (
        StatusCode::OK,
        Json(ConnectResult {
            ok: true,
            error: None,
            nota,
            azione: None,
            impronta,
            impronta_nuova,
        }),
    )
}

/// `GET /api/remote/cloud` — questo IDE gira nel cloud, dietro il gateway?
/// Dice all'IDE se mostrare «Abbina un pannello» (11-10-2026, fetta D).
pub async fn cloud(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "cloud": s.ritorno.origine_se_dietro_al_gateway().is_some() }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbbinaCloud {
    codice: String,
    #[serde(default)]
    nome: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

/// `POST /api/remote/abbina-cloud` — abbina al gateway il pannello che mostra
/// quel codice. La chiamata parte da qui, il container del progetto, con la
/// sua chiave di ritorno: il pannello va all'azienda del progetto.
pub async fn abbina_cloud(
    State(s): State<AppState>,
    Json(b): Json<AbbinaCloud>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(origine) = s.ritorno.origine_se_dietro_al_gateway() else {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "non_cloud", "detail": "questo IDE non gira nel cloud: un pannello in LAN si abbina con «Connetti» e il codice" })),
        );
    };
    let url = format!("{origine}/api/pannelli/abbina");
    let client = match costruisci_client(&s, &url, 30) {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "detail": e.to_string() }))),
    };
    let r = match client
        .post(&url)
        .json(&serde_json::json!({ "codice": b.codice, "nome": b.nome, "username": b.username, "password": b.password }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "detail": format!("il gateway non risponde: {e}") })),
            )
        }
    };
    let stato = StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let v: serde_json::Value = r.json().await.unwrap_or_default();
    (stato, Json(v))
}

/// `GET /api/remote/pannello-cloud/:nome` — il riepilogo di un pannello
/// appena abbinato dal cloud (fetta E): nome, azienda, seriale, versione,
/// progetto. Si chiede attraverso il gateway con la chiave di ritorno: il
/// pannello risponde a `/api/system` finché non ha utenti (firma del gateway);
/// dopo, resta quel che dice `/api/abbinamento`.
pub async fn pannello_cloud(
    State(s): State<AppState>,
    axum::extract::Path(nome): axum::extract::Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(origine) = s.ritorno.origine_se_dietro_al_gateway() else {
        return (StatusCode::CONFLICT, Json(serde_json::json!({ "detail": "questo IDE non gira nel cloud" })));
    };
    let base = format!("{origine}/dev/{nome}");
    let client = match costruisci_client(&s, &base, 15) {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "detail": e.to_string() }))),
    };
    let abbinamento = stato_abbinamento(&client, &base).await;
    let collegato = abbinamento.is_some();
    let sistema: Option<serde_json::Value> = match client.get(format!("{base}/api/system")).send().await {
        Ok(r) if r.status().is_success() => r.json().await.ok(),
        _ => None,
    };
    let campo = |v: &Option<serde_json::Value>, k: &str| v.as_ref().and_then(|x| x.get(k)).cloned();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "nome": nome,
            "url": base,
            "collegato": collegato,
            "senza_utenti": campo(&abbinamento, "abbinato_cloud_senza_utenti"),
            "hostname": campo(&sistema, "hostname").or_else(|| campo(&abbinamento, "nome")),
            "versione": campo(&sistema, "runtime_version"),
            "arch": campo(&sistema, "arch"),
            "progetto": campo(&sistema, "active_project"),
        })),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RinominaCloud {
    nuovo: String,
}

/// `POST /api/remote/pannello-cloud/:nome/rinomina` — al gateway, con la chiave
/// di ritorno: il pannello deve essere della stessa azienda del progetto.
pub async fn rinomina_cloud(
    State(s): State<AppState>,
    axum::extract::Path(nome): axum::extract::Path<String>,
    Json(b): Json<RinominaCloud>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(origine) = s.ritorno.origine_se_dietro_al_gateway() else {
        return (StatusCode::CONFLICT, Json(serde_json::json!({ "detail": "questo IDE non gira nel cloud" })));
    };
    let url = format!("{origine}/api/pannelli/{nome}/rinomina");
    let client = match costruisci_client(&s, &url, 30) {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "detail": e.to_string() }))),
    };
    match client.post(&url).json(&serde_json::json!({ "nuovo": b.nuovo })).send().await {
        Ok(r) => {
            let stato = StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            (stato, Json(r.json().await.unwrap_or_default()))
        }
        Err(e) => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "detail": format!("il gateway non risponde: {e}") }))),
    }
}

/// `azione` di «Connetti» quando il pannello aspetta il codice di abbinamento.
pub const AZIONE_ABBINAMENTO: &str = "abbinamento-richiesto";

/// `GET /api/abbinamento` del target, se ce l'ha.
async fn stato_abbinamento(client: &reqwest::Client, url: &str) -> Option<serde_json::Value> {
    let r = client.get(format!("{url}/api/abbinamento")).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.json::<serde_json::Value>().await.ok()
}

/// Crea l'Admin del pannello col codice; il token di sessione, o il motivo.
async fn rivendica(
    client: &reqwest::Client,
    url: &str,
    codice: &str,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let r = client
        .post(format!("{url}/api/abbinamento/rivendica"))
        .json(&serde_json::json!({ "codice": codice, "username": username, "password": password }))
        .send()
        .await
        .map_err(|e| format!("{url} non risponde: {e}"))?;
    let stato = r.status();
    let v: serde_json::Value = r.json().await.unwrap_or_default();
    if stato.is_success() {
        return v
            .get("token")
            .and_then(|t| t.as_str())
            .map(str::to_string)
            .ok_or_else(|| "abbinato, ma il pannello non ha restituito una sessione: riprova «Connetti» con le stesse credenziali".to_string());
    }
    Err(v
        .get("detail")
        .and_then(|d| d.as_str())
        .map(|d| format!("abbinamento rifiutato da {url}: {d}"))
        .unwrap_or_else(|| format!("abbinamento rifiutato da {url} ({stato})")))
}

/// La decisione di `senza_utenti`, separata dalla rete perché è la parte che
/// può sbagliare e va provata.
///
/// `passata` = la richiesta senza token ha ricevuto 2xx; `auth_required` = il
/// campo omonimo di `SystemStatus`, quando la risposta si è potuta leggere.
/// Nel dubbio si risponde «ha utenti»: dichiarare aperto un dispositivo che non
/// lo è sarebbe l'errore peggiore dei due.
pub(crate) fn niente_autenticazione(passata: bool, auth_required: Option<bool>) -> bool {
    passata && auth_required != Some(true)
}

/// Il runtime all'altro capo ha utenti definiti, o è in modalità no-auth?
///
/// Si sonda `GET /api/system` **senza token**: la rotta sta dietro
/// `require_auth` su tutti i router, quindi dove non ci sono utenti l'Admin
/// sintetico la fa rispondere 200, e dove ci sono risponde 401. Il corpo porta
/// anche `auth_required`, che è il fatto dichiarato invece che dedotto — ed è
/// nato apposta per non farlo indovinare da un codice di stato.
///
/// # Perché non più `/api/auth/whoami`
///
/// Perché **non è montata** in `deploy_only_app`, cioè sulla porta di gestione
/// di ogni runtime in container, che gira sempre con `--no-admin`. Là rispondeva
/// 404, questa funzione leggeva «non riuscita» e concludeva che il dispositivo
/// avesse utenti: un pannello appena installato — nessun progetto, nessun
/// `users.yaml` — rifiutava la connessione dicendo «l'utente «X» non esiste o la
/// password è sbagliata», mentre avrebbe accettato una connessione senza
/// autenticazione. La protezione scritta il 2026-09-08 non ha quindi mai
/// funzionato sui container, che sono tutti i dispositivi veri.
///
/// Misurato sul WP630 il 2026-09-11, prima della correzione: `whoami` → 404,
/// `/api/system` → 200 con `auth_required: false`, `login` → 401.
async fn senza_utenti(client: &reqwest::Client, url: &str) -> bool {
    let Ok(r) = client.get(format!("{url}/api/system")).send().await else {
        return false;
    };
    let passata = r.status().is_success();
    // Il corpo si legge solo se serve: a 401 non c'è niente da leggere.
    let auth_required = if passata {
        r.json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("auth_required").and_then(|b| b.as_bool()))
    } else {
        None
    };
    niente_autenticazione(passata, auth_required)
}

/// Il pannello del progetto, ricordato **nel cloud** (25-10-2026, piano
/// `docs/plans/2026-10-25-impianto-dal-dispositivo.md`, scelta del maintainer:
/// credenziali salvate per progetto). Sta in `config/dispositivo.yaml`, 0600:
/// nel cloud `config/` è la cartella persistente **del progetto**, fuori dal
/// progetto — non finisce in git, nei backup né in un deploy. In locale non si
/// scrive: lì `config/` è dell'istanza, e l'IDE non si ricollega da solo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct DispositivoRicordato {
    pub url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

const FILE_DISPOSITIVO: &str = "dispositivo.yaml";

pub(crate) fn ricorda_dispositivo(config_dir: &std::path::Path, d: &DispositivoRicordato) -> std::io::Result<()> {
    let testo = serde_yaml::to_string(d).map_err(std::io::Error::other)?;
    crate::segreti::scrivi_chiave(config_dir, FILE_DISPOSITIVO, &testo).map(|_| ())
}

pub(crate) fn dispositivo_ricordato(config_dir: &std::path::Path) -> Option<DispositivoRicordato> {
    let testo = crate::segreti::leggi_chiave(&config_dir.join(FILE_DISPOSITIVO))?;
    serde_yaml::from_str(&testo).ok()
}

pub(crate) fn dimentica_dispositivo(config_dir: &std::path::Path) {
    if let Err(e) = crate::segreti::cancella_chiave(config_dir, FILE_DISPOSITIVO) {
        tracing::warn!("pannello del progetto non dimenticato: {e}");
    }
}

/// Ricollega il pannello ricordato, se serve: nel cloud, senza un collegamento
/// in corso, con un ricordo su disco. **Pigro** di proposito: all'avvio il
/// container non conosce ancora l'origine del gateway (la impara dalla prima
/// richiesta del browser, `ricorda_origine`), e senza quella la chiave di
/// ritorno non parte e il gateway rifiuta. Lo chiamano `remote_status` — che
/// l'IDE nel cloud chiede all'apertura del progetto — e gli inoltri.
///
/// Un tentativo ogni 30 s al massimo: un pannello spento non deve trasformare
/// ogni richiesta in un login da 8 s.
pub(crate) async fn ripristina_se_serve(s: &AppState) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static ULTIMO_TENTATIVO_MS: AtomicU64 = AtomicU64::new(0);
    if !s.supervisor.e_nel_cloud() || s.remote_target.read().await.is_some() {
        return;
    }
    let Some(d) = dispositivo_ricordato(&s.config_dir) else { return };
    let ora = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let prima = ULTIMO_TENTATIVO_MS.load(Ordering::Relaxed);
    if ora.saturating_sub(prima) < 30_000
        || ULTIMO_TENTATIVO_MS.compare_exchange(prima, ora, Ordering::Relaxed, Ordering::Relaxed).is_err()
    {
        return;
    }
    let corpo = ConnectBody {
        url: d.url.clone(),
        username: (!d.username.is_empty()).then(|| d.username.clone()),
        password: (!d.password.is_empty()).then(|| d.password.clone()),
        codice: None,
    };
    let (_, Json(esito)) = connect_remote(State(s.clone()), Json(corpo)).await;
    if esito.ok {
        tracing::info!(url = %d.url, "pannello del progetto ricollegato da solo");
    } else {
        tracing::warn!(url = %d.url, errore = ?esito.error, "pannello del progetto non ricollegato");
    }
}

// ── L'impianto lo tocca il dispositivo (25-10-2026) ─────────────────────────
//
// Le scoperte dei protocolli e le prove di collegamento girano sul pannello
// collegato, che vede l'impianto; questi inoltri le chiamano sulla sua porta di
// gestione. Prima di inoltrare si risolve dal progetto **dell'IDE** — quello che
// fa fede, nel cloud — ciò che il pannello non può sapere: la password che
// l'editor manda mascherata, URL e token di Home Assistant. Sul pannello la
// sorgente può non esserci ancora (progetto non distribuito) o avere altri
// segreti. Piano `docs/plans/2026-10-25-impianto-dal-dispositivo.md`.

/// Il progetto aperto in questa istanza, con i segreti (`secrets.yaml`).
async fn progetto_ide(s: &AppState) -> Option<sws_core::project::Project> {
    let dir = crate::router::active_dir(s).await.ok()?;
    sws_core::project::Project::load(&dir).ok()
}

fn mascherata(v: &serde_json::Value) -> bool {
    v.as_str() == Some(crate::router::MASKED_PASSWORD)
}

/// Sfoglia MQTT: la password mascherata diventa quella della sorgente
/// `source_id` del progetto dell'IDE. Pura, per il test.
pub(crate) fn risolvi_mqtt(mut b: serde_json::Value, p: Option<&sws_core::project::Project>) -> serde_json::Value {
    if b.get("password").is_some_and(mascherata) {
        let sid = b.get("source_id").and_then(|v| v.as_str()).unwrap_or("");
        let vera = p.and_then(|p| {
            p.sources.iter().find_map(|src| match src {
                sws_core::project::SourceDef::Mqtt(c) if c.id == sid => c.password.clone(),
                _ => None,
            })
        });
        b["password"] = vera.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null);
    }
    b
}

/// Sfoglia OPC-UA ed Euromap: come MQTT, dentro `auth.password`.
pub(crate) fn risolvi_opcua(mut b: serde_json::Value, p: Option<&sws_core::project::Project>) -> serde_json::Value {
    if b.pointer("/auth/password").is_some_and(mascherata) {
        let sid = b.get("source_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let vera = p.and_then(|p| {
            p.sources.iter().find_map(|src| match src {
                sws_core::project::SourceDef::OpcUaClient(c) if c.id == sid => match &c.auth {
                    sws_core::OpcUaAuth::UsernamePassword { password, .. } => password.clone(),
                    _ => None,
                },
                _ => None,
            })
        });
        b["auth"]["password"] = vera.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null);
    }
    b
}

/// Sfoglia HA: URL e token della sorgente `source_id`, dal progetto dell'IDE.
/// `token_env` si lascia al pannello: nel cloud l'ambiente del container non è
/// quello dell'impianto, e se il token vive in una variabile d'ambiente vive là.
pub(crate) fn risolvi_ha(mut b: serde_json::Value, p: Option<&sws_core::project::Project>) -> serde_json::Value {
    let sid = b.get("source_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let trovata = p.and_then(|p| {
        p.sources.iter().find_map(|src| match src {
            sws_core::project::SourceDef::HomeAssistant(c) if c.id == sid && c.token_env.is_none() => {
                Some((c.url.clone(), c.token.clone().unwrap_or_default()))
            }
            _ => None,
        })
    });
    if let Some((url, token)) = trovata.filter(|(_, t)| !t.is_empty()) {
        b["url"] = serde_json::Value::String(url);
        b["token"] = serde_json::Value::String(token);
    }
    b
}

/// Un segmento di percorso codificato (id di sorgente, nome di file).
fn segmento(v: &str) -> String {
    percent_encoding::utf8_percent_encode(v, percent_encoding::NON_ALPHANUMERIC).to_string()
}

/// L'inoltro di una scoperta al pannello collegato. Le risposte passano così
/// come sono (anche i 502 dello sfoglia, che portano il motivo nel testo); un
/// pannello senza la rotta lo si dice in chiaro, invece di un 404 muto.
async fn inoltra_al_pannello(
    s: &AppState,
    user: Option<&AuthUser>,
    metodo: reqwest::Method,
    percorso: &str,
    corpo: Option<serde_json::Value>,
    timeout_s: u64,
) -> Response {
    ripristina_se_serve(s).await;
    let Some(target) = s.remote_target.read().await.clone() else {
        return (
            StatusCode::BAD_GATEWAY,
            "Nessun pannello collegato: collegalo in Configurazione → Istanza → Device. Le scoperte le fa lui, che vede l'impianto.",
        )
            .into_response();
    };
    if let (Some(u), true) = (user, metodo != reqwest::Method::GET) {
        s.audit.log("remote.impianto", Some(u.username.clone()), serde_json::json!({ "url": target.url, "percorso": percorso, "metodo": metodo.as_str() }));
    }
    let client = match costruisci_client(s, &target.url, timeout_s) {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let mut req = client.request(metodo, format!("{}{percorso}", target.url.trim_end_matches('/')));
    if let Some(c) = corpo {
        req = req.json(&c);
    }
    if !target.token.is_empty() {
        req = req.bearer_auth(&target.token);
    }
    match req.send().await {
        Ok(r) if r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::METHOD_NOT_ALLOWED => (
            StatusCode::BAD_GATEWAY,
            "Il pannello ha una versione di SWS senza questa funzione: aggiornalo per fare le scoperte da lì.",
        )
            .into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il pannello ha rifiutato le credenziali: riconnettiti con un utente Admin del pannello.",
        )
            .into_response(),
        Ok(r) => {
            let codice = StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let tipo = r.headers().get(reqwest::header::CONTENT_TYPE).cloned();
            let byte = r.bytes().await.unwrap_or_default();
            let mut risposta = (codice, byte).into_response();
            if let Some(t) = tipo.and_then(|t| axum::http::HeaderValue::from_bytes(t.as_bytes()).ok()) {
                risposta.headers_mut().insert(axum::http::header::CONTENT_TYPE, t);
            }
            risposta
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Il pannello non risponde: {e}")).into_response(),
    }
}

/// `POST /api/remote/sources/mqtt/browse` → `"{base}/api/sources/mqtt/browse"`.
pub async fn remote_mqtt_browse(State(s): State<AppState>, Json(b): Json<serde_json::Value>) -> Response {
    let durata = b.get("duration_secs").and_then(|v| v.as_u64()).unwrap_or(30).min(120);
    let b = risolvi_mqtt(b, progetto_ide(&s).await.as_ref());
    inoltra_al_pannello(&s, None, reqwest::Method::POST, "/api/sources/mqtt/browse", Some(b), durata + 30).await
}

/// `POST /api/remote/sources/opcua/browse` → `"{base}/api/sources/opcua/browse"`.
pub async fn remote_opcua_browse(State(s): State<AppState>, Json(b): Json<serde_json::Value>) -> Response {
    let b = risolvi_opcua(b, progetto_ide(&s).await.as_ref());
    inoltra_al_pannello(&s, None, reqwest::Method::POST, "/api/sources/opcua/browse", Some(b), 60).await
}

/// `POST /api/remote/sources/opcua/detect-euromap` → `"{base}/api/sources/opcua/detect-euromap"`.
pub async fn remote_opcua_euromap(State(s): State<AppState>, Json(b): Json<serde_json::Value>) -> Response {
    let b = risolvi_opcua(b, progetto_ide(&s).await.as_ref());
    inoltra_al_pannello(&s, None, reqwest::Method::POST, "/api/sources/opcua/detect-euromap", Some(b), 60).await
}

/// `POST /api/remote/sources/ha/browse` → `"{base}/api/sources/ha/browse"`.
pub async fn remote_ha_browse(State(s): State<AppState>, Json(b): Json<serde_json::Value>) -> Response {
    let b = risolvi_ha(b, progetto_ide(&s).await.as_ref());
    inoltra_al_pannello(&s, None, reqwest::Method::POST, "/api/sources/ha/browse", Some(b), 30).await
}

/// `GET /api/remote/sources/:id/opcua/certs` → `"{base}/api/sources/{}/opcua/certs"`.
pub async fn remote_opcua_certs(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let p = format!("/api/sources/{}/opcua/certs", segmento(&id));
    inoltra_al_pannello(&s, None, reqwest::Method::GET, &p, None, 30).await
}

/// `POST /api/remote/sources/:id/opcua/certs/:filename/trust` →
/// `"{base}/api/sources/{}/opcua/certs/{}/trust"`.
pub async fn remote_opcua_trust(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((id, file)): Path<(String, String)>,
) -> Response {
    let p = format!("/api/sources/{}/opcua/certs/{}/trust", segmento(&id), segmento(&file));
    inoltra_al_pannello(&s, Some(&user), reqwest::Method::POST, &p, None, 30).await
}

/// `DELETE /api/remote/sources/:id/opcua/certs/:filename` →
/// `"{base}/api/sources/{}/opcua/certs/{}"`.
pub async fn remote_opcua_delete_cert(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((id, file)): Path<(String, String)>,
) -> Response {
    let p = format!("/api/sources/{}/opcua/certs/{}", segmento(&id), segmento(&file));
    inoltra_al_pannello(&s, Some(&user), reqwest::Method::DELETE, &p, None, 30).await
}

/// `POST /api/remote/datastores/:id/test` → `"{base}/api/datastores/{}/test"`.
/// Prova il datastore **distribuito** sul pannello: quello che lavora davvero.
pub async fn remote_datastore_test(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let p = format!("/api/datastores/{}/test", segmento(&id));
    inoltra_al_pannello(&s, None, reqwest::Method::POST, &p, None, 60).await
}

/// `GET /api/remote/certificati` → `"{base}/api/certificati"`: la vista dei
/// certificati del dispositivo collegato (25-10-2026, decisione 3).
pub async fn remote_certificati(State(s): State<AppState>) -> Response {
    proxy_get_json(&s, "/api/certificati").await
}

/// `POST /api/remote/certificati/dimentica` → `"{base}/api/certificati/dimentica"`.
pub async fn remote_certificati_dimentica(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(b): Json<serde_json::Value>,
) -> Response {
    inoltra_al_pannello(&s, Some(&user), reqwest::Method::POST, "/api/certificati/dimentica", Some(b), 30).await
}

/// `DELETE /api/remote/connect` — clear the remote target state.
pub async fn disconnect_remote(State(s): State<AppState>) -> StatusCode {
    if s.remote_target.write().await.take().is_some() {
        tracing::info!("disconnected from remote runtime");
    }
    // «Disconnetti» è anche «dimentica»: riaprendo, il progetto non si ricollega.
    dimentica_dispositivo(&s.config_dir);
    StatusCode::NO_CONTENT
}

/// Il client HTTP verso il runtime remoto. Q49: per `https://` la fiducia è per
/// impronta (`certificati::client_config_pinnato`), non «accetta tutto» come
/// era fino al 2026-09-09. Per `http://` non c'è niente da verificare.
fn make_remote_client(s: &AppState, url: &str) -> reqwest::Client {
    costruisci_client(s, url, 60).expect("reqwest client")
}

pub(crate) fn costruisci_client(
    s: &AppState,
    url: &str,
    timeout_s: u64,
) -> Result<reqwest::Client, reqwest::Error> {
    let mut b = reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_s));
    if let Some(chiave) = s.ritorno.per(url) {
        let mut h = reqwest::header::HeaderMap::new();
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&chiave) {
            h.insert(crate::gateway::ritorno::INTESTAZIONE, v);
        }
        b = b.default_headers(h);
    }
    if url.starts_with("https://") {
        let host_port =
            crate::certificati::host_port_da_url(url).unwrap_or_else(|| url.to_string());
        b = b.use_preconfigured_tls(crate::certificati::client_config_pinnato(
            &host_port,
            s.certificati.clone(),
        ));
    }
    b.build()
}

/// Nome del progetto e utenti contenuti in un bundle di export.
///
/// Si legge dal bundle e non dallo stato locale perché è *questo* che arriverà
/// sul target: il nome decide se il deploy sta ridistribuendo lo stesso progetto
/// (e quindi va preservato lo stato del dispositivo), gli utenti servono solo per
/// dire al maintainer se differiscono da quelli sul dispositivo.
fn read_bundle_meta(zip: &[u8]) -> (Option<String>, Vec<String>) {
    let entry = |a: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>, name: &str| -> Option<String> {
        use std::io::Read;
        let mut e = a.by_name(name).ok()?;
        let mut buf = String::new();
        e.read_to_string(&mut buf).ok()?;
        Some(buf)
    };
    let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(zip)) {
        Ok(a) => a,
        Err(_) => return (None, Vec::new()),
    };
    let name = entry(&mut archive, "manifest.json")
        .and_then(|txt| serde_json::from_str::<serde_json::Value>(&txt).ok())
        .and_then(|v| v["name"].as_str().map(|s| s.to_string()));
    // `users.yaml` è `{ users: [ { username, password_hash, … } ] }` (sws-auth).
    let users = entry(&mut archive, "users.yaml")
        .map(|txt| read_usernames(&txt))
        .unwrap_or_default();
    (name, users)
}

/// Username configurati sul dispositivo, o `None` se l'elenco non è leggibile
/// (dispositivo con utenti e connessione senza credenziali admin).
///
/// Va chiamata **prima** di toccare il progetto sul dispositivo: `open_project`
/// passa da `auth.swap_store`, che azzera ogni sessione, e da lì in poi questa
/// GET risponde 401 qualunque token si presenti.
/// Come sopra, ma **dice se il rifiuto è un 401**.
///
/// Serve perché le due cose hanno rimedi opposti: un dispositivo che non sa
/// rispondere va aggiornato, un token morto va rinnovato. Fino al 20-10-2026
/// questa differenza si perdeva in un `_ => None`, e il deploy consigliava di
/// aggiornare il runtime a chi invece doveva solo riautenticarsi.
async fn utenti_dispositivo_o_401(
    client: &reqwest::Client,
    base: &str,
    auth_hdr: &Option<String>,
) -> Result<Option<Vec<String>>, ()> {
    let mut r = client.get(format!("{base}/api/auth/users"));
    if let Some(h) = auth_hdr {
        r = r.header("Authorization", h);
    }
    match r.send().await {
        Ok(resp) if resp.status() == reqwest::StatusCode::UNAUTHORIZED => Err(()),
        Ok(resp) if resp.status().is_success() => {
            let v: serde_json::Value = resp.json().await.unwrap_or_default();
            Ok(Some(
                v.as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|u| u["username"].as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default(),
            ))
        }
        _ => Ok(None),
    }
}

/// Il dispositivo sa leggere `secrets.yaml`?
///
/// `false` anche quando la domanda non ottiene risposta: se non si riesce a
/// sapere se le credenziali gli servirebbero a qualcosa, non gliele si manda.
/// Un runtime anteriore al Passo 2 non conosce il campo e serde lo lascia a
/// `false`, che è la risposta giusta.
async fn dispositivo_legge_i_segreti(
    client: &reqwest::Client,
    base: &str,
    auth_hdr: &Option<String>,
) -> bool {
    let mut r = client.get(format!("{base}/api/system"));
    if let Some(h) = auth_hdr {
        r = r.header("Authorization", h);
    }
    match r.send().await {
        Ok(resp) if resp.status().is_success() => {
            legge_i_segreti(&resp.json().await.unwrap_or_default())
        }
        _ => false,
    }
}

/// La decisione, separata dalla rete perché è l'unica parte che può sbagliare
/// in silenzio: un campo assente deve valere `false`, non «boh».
pub(crate) fn legge_i_segreti(corpo: &serde_json::Value) -> bool {
    corpo["segreti_separati"].as_bool().unwrap_or(false)
}

/// Chi c'è solo di qua e chi solo di là, in ordine. Pura: è il confronto, non
/// la rete.
pub(crate) fn differenza_utenti(
    progetto: &[String],
    dispositivo: &[String],
) -> (Vec<String>, Vec<String>) {
    let mut solo_progetto: Vec<String> = progetto
        .iter()
        .filter(|u| !dispositivo.contains(u))
        .cloned()
        .collect();
    let mut solo_dispositivo: Vec<String> = dispositivo
        .iter()
        .filter(|u| !progetto.contains(u))
        .cloned()
        .collect();
    solo_progetto.sort();
    solo_dispositivo.sort();
    (solo_progetto, solo_dispositivo)
}

/// Dice nel log cosa il deploy **sta per fare** agli account, prima di farlo.
///
/// Si stampa prima della cancellazione, quando l'elenco del dispositivo è stato
/// letto con un token ancora valido. La versione precedente confrontava **dopo**
/// l'attivazione del progetto e, siccome `open_project` aveva già invalidato il
/// token, finiva sempre nel ramo «elenco non leggibile» dichiarando «il deploy
/// non ha modificato gli account» — che era falso due volte: il deploy con nome
/// diverso li sostituiva già, e la 401 che portava lì era causata dal deploy
/// stesso.
fn riferisci_piano_utenti(
    sostituisci: bool,
    utenti_progetto: &[String],
    utenti_dispositivo: Option<&Vec<String>>,
    send: &impl Fn(&str),
) {
    if !sostituisci {
        send("ⓘ Utenti: non toccati («Sostituisci anche gli utenti» è spenta).");
        if let Some(dispositivo) = utenti_dispositivo {
            let (solo_progetto, solo_dispositivo) = differenza_utenti(utenti_progetto, dispositivo);
            if !solo_progetto.is_empty() || !solo_dispositivo.is_empty() {
                send(&format!(
                    "    solo nel progetto: {} — solo sul dispositivo: {}",
                    elenco(&solo_progetto),
                    elenco(&solo_dispositivo)
                ));
                send("    Per allinearli: accendi la casella, oppure Configurazione → Istanza → Device → Connessione → \"Aggiorna utenti sul dispositivo\".");
            }
        }
        return;
    }
    if utenti_progetto.is_empty() {
        send("⚠ Il progetto non ha utenti: il dispositivo resterà senza account.");
        return;
    }
    send(&format!(
        "Utenti: verranno sostituiti con quelli del progetto ({}).",
        elenco(utenti_progetto)
    ));
    match utenti_dispositivo {
        Some(dispositivo) => {
            let (solo_progetto, solo_dispositivo) = differenza_utenti(utenti_progetto, dispositivo);
            if !solo_dispositivo.is_empty() {
                send(&format!("    spariranno dal dispositivo: {}", elenco(&solo_dispositivo)));
            }
            if !solo_progetto.is_empty() {
                send(&format!("    arriveranno: {}", elenco(&solo_progetto)));
            }
        }
        None => send(
            "    Elenco del dispositivo non leggibile (serve una connessione con credenziali admin): non posso dire quali spariranno.",
        ),
    }
}

fn elenco(v: &[String]) -> String {
    if v.is_empty() {
        "nessuno".to_string()
    } else {
        v.join(", ")
    }
}

/// `POST /api/remote/users` — spedisce `users.yaml` del progetto locale al
/// runtime remoto connesso, sostituendo gli account del dispositivo.
///
/// Esiste perché il deploy **non** li tocca più (decisione del maintainer): chi
/// aggiunge un utente nell'IDE deve poterlo mandare sul dispositivo, ma come
/// azione dichiarata, non come effetto collaterale invisibile di un deploy.
///
/// Si trasferisce il **file**, non le password: contiene gli hash Argon2, quindi
/// gli account arrivano funzionanti senza che né l'IDE né questa richiesta
/// vedano mai una password in chiaro.
pub async fn remote_push_users(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let proj_dir = match s.project_dir.read().await.clone() {
        Some(d) => d,
        None => return (StatusCode::BAD_REQUEST, "No active project").into_response(),
    };
    let users_path = proj_dir.join("users.yaml");
    let yaml = match tokio::fs::read_to_string(&users_path).await {
        Ok(y) => y,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                "Il progetto locale non ha utenti definiti: non c'è nulla da inviare.",
            )
                .into_response()
        }
    };
    let count = read_usernames(&yaml).len();
    if count == 0 {
        // Rifiutare è più sicuro che obbedire: spedire una lista vuota
        // chiuderebbe fuori dal pannello chiunque lo stia usando.
        return (
            StatusCode::BAD_REQUEST,
            "Il progetto locale non ha utenti: inviarli lascerebbe il dispositivo senza account.",
        )
            .into_response();
    }

    s.audit.log(
        "remote.push_users",
        Some(user.username),
        serde_json::json!({
            "url": target.url, "users": count,
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client
        .put(format!("{base}/api/auth/users-file"))
        .header("Content-Type", "application/x-yaml")
        .body(yaml);
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => (
            StatusCode::OK,
            Json(serde_json::json!({
                "users": count,
                "note": "Le sessioni aperte sul dispositivo sono state invalidate: chi era collegato deve rifare il login.",
            })),
        ).into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Sostituire gli account \
             richiede una connessione con credenziali admin: riconnettiti compilando utente e \
             password del dispositivo, poi riprova.".to_string(),
        ).into_response(),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (StatusCode::BAD_GATEWAY, format!("Il dispositivo ha risposto {code}: {body}")).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Richiesta al dispositivo fallita: {e}")).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct PushClientIdBody {
    pub source_id: String,
    /// `None`/stringa vuota cancella un override già impostato sul device.
    #[serde(default)]
    pub client_id: Option<String>,
}

/// `POST /api/remote/mqtt-client-id` — inoltra al dispositivo connesso un
/// override manuale del client_id MQTT per una sorgente, senza toccare
/// `project.yaml`. Lato "Invia Client ID al dispositivo connesso" del
/// pannello sorgente MQTT: stesso schema di `remote_push_users` sopra, solo
/// che qui a decidere cosa è "accettabile" è il dispositivo stesso (rifiuta
/// con 400 se quella sorgente ha Random Client ID attivo).
pub async fn remote_push_mqtt_client_id(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<PushClientIdBody>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };

    s.audit.log(
        "remote.push_mqtt_client_id",
        Some(user.username),
        serde_json::json!({
            "url": target.url, "source_id": body.source_id, "client_id": body.client_id,
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client
        .put(format!(
            "{base}/api/mqtt/source/{}/client-id-override",
            body.source_id
        ))
        .json(&serde_json::json!({ "client_id": body.client_id }));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            (StatusCode::OK, Json(serde_json::json!({ "applied": true }))).into_response()
        }
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Riconnettiti con \
             credenziali admin e riprova."
                .to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `GET /api/remote/database/:id/download` — scarica il database del
/// datastore indicato **dal dispositivo connesso**, non dal progetto locale.
/// Stesso principio di `remote_push_users`: il backend locale fa lui stesso
/// la richiesta al dispositivo (token di sessione già in `remote_target`), il
/// browser non parla mai direttamente col device.
pub async fn remote_download_database(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.database_download",
        Some(user.username),
        serde_json::json!({
            "url": target.url, "id": id,
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.get(format!(
        "{base}/api/datastores/{}/download",
        pct_encode(&id)
    ));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let bytes = match r.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        format!("Lettura della risposta dal dispositivo fallita: {e}"),
                    )
                        .into_response()
                }
            };
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/octet-stream")
                .header(
                    "Content-Disposition",
                    format!("attachment; filename=\"{id}.db\""),
                )
                .body(Body::from(bytes))
                .unwrap()
        }
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `POST /api/remote/database/:id/clean-history` — come la pulizia locale,
/// sul dispositivo connesso (proxy: il browser non parla mai col device).
/// Serve un dispositivo col runtime del 26-09-2026 o successivo: prima
/// l'endpoint lì non esiste e la risposta lo dice.
/// Gira una richiesta di aggiornamento al dispositivo collegato: stesso
/// schema degli altri proxy, con i messaggi per i runtime che non la conoscono.
async fn inoltra_aggiornamento(
    s: &AppState,
    user: &AuthUser,
    metodo: reqwest::Method,
    corpo: Option<serde_json::Value>,
    url: impl Fn(&str) -> String,
) -> Response {
    ripristina_se_serve(s).await;
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    if metodo != reqwest::Method::GET {
        s.audit.log("remote.update", Some(user.username.clone()), serde_json::json!({ "url": target.url, "metodo": metodo.as_str() }));
    }
    let client = make_remote_client(s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.request(metodo, url(base));
    if let Some(c) = corpo {
        req = req.json(&c);
    }
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let code = r.status();
            let corpo: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::from_u16(code.as_u16()).unwrap_or(StatusCode::OK), Json(corpo)).into_response()
        }
        Ok(r) if r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::METHOD_NOT_ALLOWED => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo non conosce l'aggiornamento del runtime: è precedente alla 2.12.0-rc.1, \
             va aggiornato una volta dall'Installazione."
                .to_string(),
        )
            .into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Riconnettiti con \
             credenziali admin e riprova."
                .to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let testo = r.text().await.unwrap_or_default();
            (StatusCode::BAD_GATEWAY, format!("Il dispositivo ha risposto {code}: {testo}")).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Dispositivo non raggiungibile: {e}")).into_response(),
    }
}

/// `GET /api/remote/update/schedule`
pub async fn remote_finestra_leggi(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::GET, None, |base| format!("{base}/api/update/schedule")).await
}

/// `PUT /api/remote/update/schedule`
pub async fn remote_finestra_scrivi(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(corpo): Json<serde_json::Value>,
) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::PUT, Some(corpo), |base| format!("{base}/api/update/schedule")).await
}

/// `GET /api/remote/history/export?tags=&from_ms=&to_ms=` (18-10-2026): il CSV
/// dello storico del dispositivo collegato. Il pannello non ha dove salvare un
/// file; l'IDE sì. La query passa così com'è.
pub async fn remote_history_export(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    axum::extract::RawQuery(q): axum::extract::RawQuery,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let q = q.unwrap_or_default();
    s.audit.log("remote.history_export", Some(user.username), serde_json::json!({ "url": target.url, "query": q }));
    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.get(format!("{base}/api/history/export?{q}"));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(b) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "text/csv; charset=utf-8")
                .header("Content-Disposition", "attachment; filename=\"storico.csv\"")
                .body(axum::body::Body::from(b))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
            Err(e) => (StatusCode::BAD_GATEWAY, format!("Lettura della risposta dal dispositivo fallita: {e}")).into_response(),
        },
        Ok(r) => {
            let st = r.status();
            (StatusCode::BAD_GATEWAY, format!("il dispositivo ha risposto {st}")).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("dispositivo non raggiungibile: {e}")).into_response(),
    }
}

/// `GET /api/remote/security/frame-origins` (C6, 17-10-2026)
pub async fn remote_sicurezza_leggi(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::GET, None, |base| format!("{base}/api/security/frame-origins")).await
}

/// `PUT /api/remote/security/frame-origins`
pub async fn remote_sicurezza_scrivi(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(corpo): Json<serde_json::Value>,
) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::PUT, Some(corpo), |base| format!("{base}/api/security/frame-origins")).await
}

/// `GET /api/remote/update/status`
pub async fn remote_update_status(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::GET, None, |base| format!("{base}/api/update/status")).await
}

/// `POST /api/remote/quadlet/aggiorna` (02-10-2026): riscrive i quadlet del
/// pannello dai template della sua immagine — il quadlet che viaggia.
pub async fn remote_quadlet_aggiorna(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::POST, None, |base| format!("{base}/api/quadlet/aggiorna")).await
}

/// `POST /api/remote/aggiornamento/conferma` — la risposta alla domanda dopo un aggiornamento.
pub async fn remote_conferma_aggiornamento(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(corpo): Json<serde_json::Value>,
) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::POST, Some(corpo), |base| format!("{base}/api/aggiornamento/conferma")).await
}

/// `POST /api/remote/aggiornamento/istantanea` — l'istantanea dei dati prima di
/// un deploy da archivio.
pub async fn remote_istantanea_dati(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::POST, None, |base| format!("{base}/api/aggiornamento/istantanea")).await
}

/// `POST /api/remote/update/apply`
pub async fn remote_update_apply(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    inoltra_aggiornamento(&s, &user, reqwest::Method::POST, None, |base| format!("{base}/api/update/apply")).await
}

/// `POST /api/remote/boot-image/reset` — il ripristino dell'immagine di
/// fabbrica, girato al dispositivo collegato.
pub async fn remote_boot_image_reset(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.boot_image_reset",
        Some(user.username),
        serde_json::json!({ "url": target.url }),
    );
    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.post(format!("{base}/api/boot-image/reset"));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let corpo: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::OK, Json(corpo)).into_response()
        }
        Ok(r) if r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::METHOD_NOT_ALLOWED => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo non conosce il ripristino dell'immagine: aggiorna il suo runtime (2.12.0-dev.4 o successivo)."
                .to_string(),
        )
            .into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Riconnettiti con \
             credenziali admin e riprova."
                .to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let testo = r.text().await.unwrap_or_default();
            (StatusCode::BAD_GATEWAY, format!("Il dispositivo ha risposto {code}: {testo}")).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Dispositivo non raggiungibile: {e}")).into_response(),
    }
}

pub async fn remote_pulisci_storico(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.pulisci_storico",
        Some(user.username),
        serde_json::json!({ "url": target.url, "id": id, "corpo": body.clone() }),
    );
    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client
        .post(format!("{base}/api/datastores/{}/clean-history", pct_encode(&id)))
        .json(&body);
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let corpo: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::OK, Json(corpo)).into_response()
        }
        Ok(r) if r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::METHOD_NOT_ALLOWED => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo non conosce la pulizia dello storico: aggiorna il suo runtime (2.12.0-dev.2 o successivo)."
                .to_string(),
        )
            .into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Riconnettiti con \
             credenziali admin e riprova."
                .to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let testo = r.text().await.unwrap_or_default();
            (StatusCode::BAD_GATEWAY, format!("Il dispositivo ha risposto {code}: {testo}")).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Richiesta al dispositivo fallita: {e}")).into_response(),
    }
}

/// `POST /api/remote/database/:id/upload` — sostituisce il database del
/// datastore indicato **sul dispositivo connesso**. Inoltra il corpo grezzo
/// così com'è (già un file SQLite valido, prodotto da un download precedente
/// o da un backup) e rilancia la risposta JSON del dispositivo (che include
/// `requires_restart: true` — nessun hot-swap, va riavviato per usare il
/// nuovo file, vedi `SqliteStore::replace_file_at`).
pub async fn remote_upload_database(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.database_upload",
        Some(user.username),
        serde_json::json!({
            "url": target.url, "id": id, "bytes": body.len(),
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client
        .post(format!("{base}/api/datastores/{}/upload", pct_encode(&id)))
        .header("Content-Type", "application/octet-stream")
        .body(body);
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Riconnettiti con \
             credenziali admin e riprova."
                .to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `GET /api/remote/backups` — elenco degli snapshot presenti **sul
/// dispositivo connesso** (non quelli del progetto locale — la tab Backup
/// dell'editor mostra già quelli). Stesso principio di proxy di
/// `remote_download_database`.
pub async fn remote_list_backups(State(s): State<AppState>) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.get(format!("{base}/api/backups"));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `GET /api/remote/backups/:name/download` — scarica lo zip di uno snapshot
/// **dal dispositivo connesso**.
pub async fn remote_download_backup(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(name): Path<String>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.backup_download",
        Some(user.username),
        serde_json::json!({
            "url": target.url, "name": name,
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.get(format!("{base}/api/backups/{}/download", pct_encode(&name)));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let bytes = match r.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        format!("Lettura della risposta dal dispositivo fallita: {e}"),
                    )
                        .into_response()
                }
            };
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/zip")
                .header(
                    "Content-Disposition",
                    format!("attachment; filename=\"{name}.zip\""),
                )
                .body(Body::from(bytes))
                .unwrap()
        }
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `GET /api/remote/project/export` — scarica il bundle del progetto che gira
/// **sul dispositivo connesso** e lo restituisce così com'è.
///
/// È il verso opposto del deploy, e mancava del tutto: `Configurazione →
/// Runtime` sapeva solo spingere. Chi si siede davanti a un pannello già in
/// servizio deve poter riprendere il progetto che gira *lì*, invece di ripartire
/// da una copia locale che può essere vecchia o di un altro impianto.
///
/// Lato dispositivo non serve niente di nuovo: `GET /api/project/export` esiste
/// da sempre. Qui c'è solo il proxy, perché la fetch diretta browser→dispositivo
/// morirebbe sul certificato self-signed — lo stesso motivo per cui passano di
/// qui `remote_download_backup` e `remote_cert`.
///
/// Il nome del progetto viaggia in `X-Project-Name` letto dal manifest del
/// bundle: il client lo usa come proposta di default per la scelta del nome, e
/// leggerlo qui gli evita di dover aprire uno zip nel browser.
///
/// **Il bundle contiene i segreti e `users.yaml`** — stessa scelta del
/// deploy, per lo stesso motivo (Passo 2, 2d): chi riprende il progetto che
/// gira *lì* deve poterci lavorare senza reinserire ogni password, quindi la
/// richiesta al dispositivo porta `?segreti=1` esplicito — `GET
/// /api/project/export` da sola, da un browser, li escluderebbe di default.
/// Chi importa sta quindi sostituendo anche le proprie credenziali locali:
/// l'avviso è nell'interfaccia, non qui, ma va detto che questo endpoint è la
/// sorgente di quel rischio.
pub async fn remote_export_project(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.project_pull",
        Some(user.username),
        serde_json::json!({
            "url": target.url,
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.get(format!("{base}/api/project/export?segreti=1"));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let bytes = match r.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        format!("Lettura della risposta dal dispositivo fallita: {e}"),
                    )
                        .into_response()
                }
            };
            // Il nome esce dal manifest del bundle, non dallo stato locale: è
            // *questo* il progetto che il client sta per importare.
            let (name, _users) = read_bundle_meta(&bytes);
            let name = name.unwrap_or_else(|| "progetto".to_string());
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/zip")
                .header("X-Project-Name", &name)
                // Perché il browser possa leggere l'header su una risposta che
                // il client consuma con fetch(): senza questo, `X-Project-Name`
                // esiste ma `res.headers.get()` torna null.
                .header("Access-Control-Expose-Headers", "X-Project-Name")
                .header(
                    "Content-Disposition",
                    format!("attachment; filename=\"{name}.zip\""),
                )
                .body(Body::from(bytes))
                .unwrap()
        }
        // 503 = nessun progetto attivo sul dispositivo: non è un guasto, ed è
        // l'unico caso in cui il messaggio deve dire cosa fare.
        Ok(r) if r.status() == StatusCode::SERVICE_UNAVAILABLE => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo non ha un progetto attivo da scaricare.".to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `GET /api/remote/system` — stato RUNTIME/SISTEMA **del dispositivo
/// connesso**, non del backend a cui l'editor è attaccato. Usata da
/// `SystemTab` al posto di `GET /api/system` quando `remoteConnected` è
/// vero — "il runtime" a cui riferirsi è quello connesso, non un secondo
/// riquadro affiancato (a differenza di Datastore/Backup, dove locale e
/// remoto sono entrambi dati interessanti). Rilancia il JSON grezzo così
/// com'è (stesso principio di `remote_list_backups`): non serve un tipo
/// condiviso, il frontend interpreta lo stesso `SystemStatus` che già
/// conosce da `GET /api/system`.
pub async fn remote_system_status(State(s): State<AppState>) -> Response {
    proxy_get_json(&s, "/api/system").await
}

/// `GET /api/remote/host/catalog` — le zone termiche, i mount e le interfacce
/// **del dispositivo connesso**, per il campo «parametro» della sorgente Host.
///
/// Il catalogo locale (`/api/host/catalog`) descrive la macchina dell'editor,
/// e su un PC le zone si chiamano `x86_pkg_temp`, sul pannello `soc-thermal`:
/// suggerire le prime per configurare il secondo è peggio che non suggerire
/// niente. Il 21-09-2026 due metriche `temp` sono state salvate senza zona
/// proprio così, e i tag sono rimasti Bad senza che niente lo dicesse.
pub async fn remote_host_catalog(State(s): State<AppState>) -> Response {
    proxy_get_json(&s, "/api/host/catalog").await
}

/// `GET /api/remote/host/seriali` — le porte seriali **del dispositivo
/// connesso**, viste dal suo runtime (dentro il container, se ci gira).
pub async fn remote_porte_seriali(State(s): State<AppState>) -> Response {
    proxy_get_json(&s, "/api/host/seriali").await
}

/// `GET /api/remote/sources/stato` — lo stato delle sorgenti e dei dispositivi
/// **del dispositivo connesso**. Al collaudo del 04-10-2026 l'albero mostrava i
/// valori del TC620 e i pallini del PC: bus rosso («/dev/ttyCOM2 non esiste»)
/// sopra variabili che si aggiornavano.
pub async fn remote_stato_sorgenti(State(s): State<AppState>) -> Response {
    proxy_get_json(&s, "/api/sources/stato").await
}

/// `GET /api/remote/system/tls` — se il **dispositivo connesso** ha un
/// certificato, non questa istanza.
///
/// Decisione 2 del piano dei certificati (23-10-2026). La card «Certificato
/// TLS» della scheda Device leggeva e scriveva **la macchina sbagliata**: tutto
/// il resto della scheda usa la variante remota, per il TLS quella rotta non
/// esisteva, e con un pannello connesso i tre pulsanti agivano sul PC
/// dell'editor. Il piano la chiama «il presupposto di C4», perché accendere il
/// TLS di default sul pannello vuol dire poterlo governare da qui.
pub async fn remote_tls_stato(State(s): State<AppState>) -> Response {
    // Per `ogni_chiamata_dell_ide_ha_la_sua_rotta_sul_dispositivo`: "{base}/api/system/tls".
    proxy_get_json(&s, "/api/system/tls").await
}

/// Inoltra al dispositivo connesso una richiesta che **cambia il suo
/// certificato**, e la scrive nell'audit di qui oltre che nel suo.
///
/// Tre cose la distinguono dagli altri inoltri.
///
/// **Il dispositivo riparte.** Tutte e tre le operazioni finiscono in
/// `system_reboot`, che risponde 204 e poi fa `exec()` dopo 400 ms: la risposta
/// arriva, ma un errore di trasporto non vuol dire «non è successo niente», e
/// il messaggio lo dice invece di far credere a un fallimento pulito.
///
/// **Un runtime vecchio non ha queste rotte** sulla porta di gestione: prima del
/// 23-10-2026 `deploy_only_app` il TLS non lo nominava affatto. Un 404 va
/// tradotto, come per la ritenzione.
///
/// **Cambiare il certificato cambia l'impronta**, e quella memorizzata dall'IDE
/// resta la vecchia: al prossimo collegamento il pinning rifiuta. Dimenticarla
/// **non** è affare di questa funzione — il «dimentica» non è mai automatico
/// (è la regola scritta sul gemello `/api/device/hostkey/forget`) — e la card
/// lo dice prima, con il suo pulsante lì accanto.
async fn inoltra_tls(
    s: &AppState,
    user: &AuthUser,
    evento: &'static str,
    metodo: reqwest::Method,
    percorso: &str,
    corpo: Option<serde_json::Value>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        evento,
        Some(user.username.clone()),
        serde_json::json!({ "url": target.url }),
    );
    let client = make_remote_client(s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.request(metodo, format!("{base}{percorso}"));
    if let Some(c) = corpo {
        req = req.json(&c);
    }
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(r) if r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::METHOD_NOT_ALLOWED => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo non sa gestire il proprio certificato TLS da remoto: è precedente \
             alla 2.20.0, va aggiornato una volta dall'Installazione."
                .to_string(),
        )
            .into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Riconnettiti con \
             credenziali admin e riprova."
                .to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let testo = r.text().await.unwrap_or_default();
            (StatusCode::BAD_GATEWAY, format!("Il dispositivo ha risposto {code}: {testo}")).into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!(
                "Il dispositivo non ha risposto: {e}\nCambiare il certificato lo fa ripartire, \
                 quindi può essere riuscito lo stesso: ricollegati e guarda lo stato."
            ),
        )
            .into_response(),
    }
}

/// `POST /api/remote/system/tls/generate` — genera un autofirmato **sul
/// dispositivo** e lo fa ripartire in HTTPS.
pub async fn remote_tls_genera(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    // Per il test delle rotte del dispositivo: "{base}/api/system/tls/generate".
    inoltra_tls(&s, &user, "remote.tls_generate", reqwest::Method::POST, "/api/system/tls/generate", None).await
}

/// `PUT /api/remote/system/tls` — carica sul dispositivo un certificato e una
/// chiave propri. La validazione (che la chiave corrisponda) la fa il
/// dispositivo, con lo stesso `rustls` che poi li userà: rifarla qui vorrebbe
/// dire avere due giudici che un giorno non saranno d'accordo.
pub async fn remote_tls_carica(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(corpo): Json<crate::system::TlsUpload>,
) -> Response {
    // "{base}/api/system/tls".
    inoltra_tls(
        &s,
        &user,
        "remote.tls_upload",
        reqwest::Method::PUT,
        "/api/system/tls",
        Some(serde_json::json!({ "cert_pem": corpo.cert_pem, "key_pem": corpo.key_pem })),
    )
    .await
}

/// `DELETE /api/remote/system/tls` — toglie il certificato del dispositivo e lo
/// fa ripartire in chiaro.
pub async fn remote_tls_rimuovi(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    // "{base}/api/system/tls".
    inoltra_tls(&s, &user, "remote.tls_remove", reqwest::Method::DELETE, "/api/system/tls", None).await
}

/// Una GET al dispositivo connesso, con la sua sessione, e il JSON com'è.
/// 400 senza dispositivo; 502 con il codice e il testo del dispositivo se
/// risponde male, così l'errore che arriva all'editor dice da che parte è.
async fn proxy_get_json(s: &AppState, percorso: &str) -> Response {
    ripristina_se_serve(s).await;
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let client = make_remote_client(s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.get(format!("{base}{percorso}"));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `POST /api/remote/backups` — crea uno snapshot **sul dispositivo
/// connesso** (non del progetto locale). Stesso principio di proxy delle
/// altre azioni "sul device attualmente connesso".
pub async fn remote_create_backup(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.post(format!("{base}/api/backups"));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    let res = match req.send().await {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    };
    if res.status().is_success() {
        s.audit.log(
            "remote.backup_create",
            Some(user.username),
            serde_json::json!({ "url": target.url }),
        );
    }
    res
}

/// `POST /api/remote/backups/:name/restore` — ripristina uno snapshot **sul
/// dispositivo connesso**, sovrascrivendo project.yaml/synoptics/users.yaml/
/// `.history`/recipes lì. Non tocca in alcun modo il progetto locale aperto
/// in questo editor — è il device connesso a cambiare stato.
pub async fn remote_restore_backup(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(name): Path<String>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.backup_restore",
        Some(user.username),
        serde_json::json!({
            "url": target.url, "name": name,
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.post(format!("{base}/api/backups/{}/restore", pct_encode(&name)));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// `DELETE /api/remote/backups/:name` — elimina uno snapshot **sul
/// dispositivo connesso**. Irreversibile, audit-logged.
pub async fn remote_delete_backup(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(name): Path<String>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    s.audit.log(
        "remote.backup_delete",
        Some(user.username),
        serde_json::json!({
            "url": target.url, "name": name,
        }),
    );

    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/');
    let mut req = client.delete(format!("{base}/api/backups/{}", pct_encode(&name)));
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                format!("Il dispositivo ha risposto {code}: {body}"),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

/// Username contenuti in un `users.yaml` (`{ users: [ { username, … } ] }`).
/// `users.yaml` ha almeno un Admin?
pub fn ha_admin(yaml: &str) -> bool {
    serde_yaml::from_str::<serde_yaml::Value>(yaml)
        .ok()
        .and_then(|v| {
            v["users"]
                .as_sequence()
                .map(|seq| seq.iter().any(|u| u["role"].as_str() == Some("Admin")))
        })
        .unwrap_or(false)
}

/// Il deploy va fermato perché lascerebbe il pannello senza nessun Admin?
/// Solo se il pannello è in attesa (nessun utente) e il deploy non gli porta
/// un Admin: perché il progetto non ne ha, o perché gli utenti non viaggiano.
pub fn serve_admin(pannello_in_attesa: bool, porta_utenti: bool, progetto_ha_admin: bool) -> bool {
    pannello_in_attesa && !(porta_utenti && progetto_ha_admin)
}

pub fn read_usernames(yaml: &str) -> Vec<String> {
    serde_yaml::from_str::<serde_yaml::Value>(yaml)
        .ok()
        .and_then(|v| {
            v["users"].as_sequence().map(|seq| {
                seq.iter()
                    .filter_map(|u| u["username"].as_str().map(|s| s.to_string()))
                    .collect()
            })
        })
        .unwrap_or_default()
}

/// Percent-encode a string for use in a URL path segment (simple ASCII-safe version).
/// `GET /api/remote/cert?url=<runtime-url>` — scarica il certificato TLS di
/// un runtime remoto PASSANDO DAL BACKEND, e lo rilancia al browser come
/// allegato `sws.crt`.
///
/// Esiste per rompere l'uovo-e-gallina del pulsante "Scarica cert" originale:
/// scaricava con una fetch dal browser verso `{target}/cert`, cioè esattamente
/// la richiesta che il browser blocca finché il certificato non è già stato
/// accettato — e il fallback suggeriva `curl -k` in un terminale. Il backend
/// invece parla già con i self-signed (`danger_accept_invalid_certs`), quindi
/// da qui il download funziona sempre, anche prima di ogni accettazione.
///
/// L'URL arriva come query param (non da `remote_target`): il caso d'uso è
/// proprio un runtime a cui NON si è ancora connessi.
#[derive(Debug, Deserialize)]
pub struct RemoteCertQuery {
    pub url: String,
}

pub async fn remote_cert(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(q): Query<RemoteCertQuery>,
) -> Response {
    let url = q.url.trim().trim_end_matches('/').to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return (
            StatusCode::BAD_REQUEST,
            "url deve iniziare con http:// o https://",
        )
            .into_response();
    }
    s.audit.log(
        "remote.cert_download",
        Some(user.username),
        serde_json::json!({ "url": url }),
    );

    // Q49: scaricare il certificato da un runtime mai visto È il primo contatto:
    // l'impronta si memorizza qui, e «Connetti» la troverà uguale.
    let client = make_remote_client(&s, &url);
    match client.get(format!("{url}/cert")).send().await {
        Ok(r) if r.status().is_success() => {
            let bytes = match r.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        format!("Lettura della risposta dal dispositivo fallita: {e}"),
                    )
                        .into_response()
                }
            };
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/x-x509-ca-cert")
                .header("Content-Disposition", "attachment; filename=\"sws.crt\"")
                .body(Body::from(bytes))
                .unwrap()
        }
        Ok(r) => {
            let code = r.status();
            (StatusCode::BAD_GATEWAY, format!(
                "Il dispositivo ha risposto {code} a /cert — il runtime remoto ha il TLS attivo? (in HTTP semplice non c'è nessun certificato da scaricare)"
            )).into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Richiesta al dispositivo fallita: {e}"),
        )
            .into_response(),
    }
}

fn pct_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}

/// `POST /api/remote/deploy` — export the active local project as a ZIP and
/// Le opzioni del deploy. Corpo assente = tutti i default: `remote_deploy`
/// veniva chiamata senza corpo dall'auto-deploy dello store, e un corpo mancante
/// non deve voler dire «tutto spento».
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeployBody {
    /// Casella «Sostituisci anche gli utenti», **accesa di default**: gli utenti
    /// appartengono al progetto e viaggiano col deploy (2026-09-11).
    #[serde(default = "vero")]
    pub replace_users: bool,
    /// L'editor ha mostrato la conferma «il pannello resterà accessibile senza
    /// password» e l'utente ha detto sì. Senza, il caso si ferma con un 428.
    #[serde(default)]
    pub confirm_no_users: bool,
    /// Porta anche `secrets.yaml`? **Acceso di default**, per i client di prima.
    /// Il deploy «del progetto» dell'IDE (pulsante e salvataggio) lo spegne dal
    /// 26-09-2026 (maintainer: utenti e segreti sono un gesto distinto dal
    /// deploy): il dispositivo tiene allora i suoi, perché il deploy
    /// conservativo toglie solo i file di disegno (`DESIGN_ARTIFACTS`).
    #[serde(default = "vero")]
    pub con_segreti: bool,
    /// L'editor ha mostrato «il deploy cancella dal pannello questi progetti,
    /// storico compreso» e l'utente ha detto sì (03-10-2026). Senza, il caso si
    /// ferma con un 428 `sostituisce-progetti`.
    #[serde(default)]
    pub confirm_replace: bool,
    /// L'editor ha mostrato «il pannello non conosce questi simboli di
    /// libreria» e l'utente ha detto di procedere (M9, 14-10-2026). Senza, il
    /// caso si ferma con un 428 `simboli-mancanti`.
    #[serde(default)]
    pub confirm_missing_symbols: bool,
}

/// Gli id `lib:` usati dalle pagine, dai faceplate e dalle cornici del progetto, in ordine.
async fn simboli_lib_usati(dir: &std::path::Path) -> Vec<String> {
    let mut usati = std::collections::BTreeSet::new();
    for cartella in ["synoptics", "faceplates", "cornici"] {
        let Ok(mut rd) = tokio::fs::read_dir(dir.join(cartella)).await else { continue };
        while let Ok(Some(e)) = rd.next_entry().await {
            if e.path().extension().is_some_and(|x| x == "yaml" || x == "yml") {
                if let Ok(testo) = tokio::fs::read_to_string(e.path()).await {
                    if let Ok(v) = serde_yaml::from_str::<serde_yaml::Value>(&testo) {
                        raccogli_simboli_lib(&v, &mut usati);
                    }
                }
            }
        }
    }
    usati.into_iter().collect()
}

/// Ogni `symbol_id: lib:…`, a qualunque profondità (celle di griglia, figli).
pub(crate) fn raccogli_simboli_lib(v: &serde_yaml::Value, out: &mut std::collections::BTreeSet<String>) {
    match v {
        serde_yaml::Value::Mapping(m) => {
            for (k, x) in m {
                if k.as_str() == Some("symbol_id") {
                    if let Some(id) = x.as_str().filter(|i| i.starts_with("lib:")) {
                        out.insert(id.to_string());
                    }
                }
                raccogli_simboli_lib(x, out);
            }
        }
        serde_yaml::Value::Sequence(s) => s.iter().for_each(|x| raccogli_simboli_lib(x, out)),
        _ => {}
    }
}

/// Gli id del manifesto della libreria del pannello; `None` se non ne ha uno
/// (un runtime di prima della libreria risponde 404 o con la SPA).
async fn leggi_manifesto_pannello(client: &reqwest::Client, base: &str) -> Option<Vec<String>> {
    let r = client.get(format!("{base}/symbols/lib/manifest.json")).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let m: sws_core::simboli_lib::ManifestLib = r.json().await.ok()?;
    Some(m.symbols.into_iter().map(|s| s.id).collect())
}

/// Gli usati che il pannello non conosce; senza manifesto, tutti.
pub(crate) fn simboli_mancanti(usati: &[String], noti: Option<&Vec<String>>) -> Vec<String> {
    usati.iter().filter(|u| !noti.is_some_and(|n| n.contains(u))).cloned().collect()
}

/// Un progetto sul pannello che il deploy cancellerebbe.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct DaSostituire {
    pub nome: String,
    /// Il peso del suo storico, se il pannello lo dice (runtime dal 03-10-2026).
    pub storico_byte: Option<u64>,
}

/// I progetti sul pannello che il deploy di `nome` cancellerebbe **per intero**:
/// tutti quelli con un altro nome (lo stesso nome si ridistribuisce conservando
/// database e backup). Senza nome — manifest illeggibile — li cancellerebbe
/// tutti, ed è così che va detto. Pura.
pub(crate) fn progetti_da_sostituire(sul_pannello: &[DaSostituire], nome: Option<&str>) -> Vec<DaSostituire> {
    sul_pannello.iter().filter(|p| Some(p.nome.as_str()) != nome).cloned().collect()
}

/// L'elenco dei progetti del pannello, col peso dello storico. Vuoto se non si
/// legge: allora non si chiede niente, come prima (e il deploy non riuscirebbe
/// comunque a cancellarli, perché li legge dalla stessa rotta).
async fn leggi_progetti_dispositivo(
    client: &reqwest::Client,
    base: &str,
    auth_hdr: &Option<String>,
) -> Vec<DaSostituire> {
    let mut r = client.get(format!("{base}/api/projects"));
    if let Some(h) = auth_hdr {
        r = r.header("Authorization", h);
    }
    let Ok(resp) = r.send().await else { return Vec::new() };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let v: serde_json::Value = resp.json().await.unwrap_or_default();
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    Some(DaSostituire { nome: p["name"].as_str()?.to_string(), storico_byte: p["storico_byte"].as_u64() })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn vero() -> bool {
    true
}

impl Default for DeployBody {
    fn default() -> Self {
        Self {
            replace_users: true,
            confirm_no_users: false,
            con_segreti: true,
            confirm_replace: false,
            confirm_missing_symbols: false,
        }
    }
}

/// Serve la conferma esplicita dell'editor?
///
/// Solo quando il deploy toglierebbe **ogni** account a un dispositivo che ne
/// ha. `utenti_dispositivo = None` significa elenco non leggibile (dispositivo
/// con utenti, connessione senza credenziali admin): nel dubbio si chiede,
/// perché l'errore da evitare è lasciare un pannello aperto senza saperlo.
pub(crate) fn serve_conferma(
    sostituisci: bool,
    utenti_progetto: usize,
    utenti_dispositivo: Option<usize>,
) -> bool {
    sostituisci && utenti_progetto == 0 && utenti_dispositivo.is_none_or(|n| n > 0)
}

/// L'URL di upload verso il dispositivo. **Unico punto** in cui i parametri del
/// deploy si compongono: `deploy`, `name` e `replace_users` devono viaggiare
/// insieme, e il ritentativo dopo un 409 è il posto in cui storicamente se ne
/// perde uno.
pub(crate) fn url_upload(
    base: &str,
    nome: Option<&str>,
    preserva: bool,
    sostituisci: bool,
) -> String {
    let mut u = format!("{base}/api/projects/upload?replace_users={sostituisci}");
    if preserva {
        u.push_str("&deploy=true");
        if let Some(n) = nome {
            u.push_str(&format!("&name={}", pct_encode(n)));
        }
    }
    u
}

/// upload it to the connected remote runtime server-side (AcceptAnyCert,
/// reuses the existing session token from `remote_target`).
/// Returns a streaming newline-delimited text log.
pub async fn remote_deploy(
    State(s): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    // Ultimo, com'è obbligatorio per un estrattore di corpo. `Option<_>` perché
    // l'auto-deploy dello store chiama senza corpo.
    corpo: Option<Json<DeployBody>>,
) -> Response {
    let opz = corpo.map(|Json(b)| b).unwrap_or_default();
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let proj_dir = match s.project_dir.read().await.clone() {
        Some(d) => d,
        None => return (StatusCode::BAD_REQUEST, "No active project").into_response(),
    };

    // Un deploy alla volta: la guardia viaggia nel task e si rilascia da sola
    // alla fine (anche su errore), qualunque sia il ramo di uscita.
    let Ok(deploy_guard) = s.deploy_lock.clone().try_lock_owned() else {
        return (
            StatusCode::CONFLICT,
            "Un deploy è già in corso — attendi che finisca",
        )
            .into_response();
    };

    // ── Precheck, prima di toccare qualunque cosa ────────────────────────────
    //
    // Si legge qui, e non dentro il task, per due motivi: l'elenco degli utenti
    // del dispositivo va letto mentre il token è ancora valido (dopo
    // `open_project` non lo è più), e se il deploy lascerebbe il pannello senza
    // account bisogna potersi fermare **prima** di aver cancellato qualcosa.
    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/').to_string();
    let mut auth_hdr: Option<String> =
        (!target.token.is_empty()).then(|| format!("Bearer {}", target.token));

    // Utenti del PROGETTO: si legge il file, perché è il file che viaggia nel
    // bundle (`build_export_zip` lo copia così com'è).
    let utenti_progetto = read_usernames(
        &tokio::fs::read_to_string(proj_dir.join("users.yaml"))
            .await
            .unwrap_or_default(),
    );
    // **Prima di tutto: la sessione è ancora buona?** Se non lo è si rientra da
    // soli. Fino al 20-10-2026 il deploy tirava dritto con un token morto: le
    // sonde qui sotto rispondevano 401, degradavano a un avviso che dava la
    // colpa al dispositivo («non sa leggere secrets.yaml: aggiorna il
    // runtime»), e il guasto vero compariva solo alla fine come «Upload
    // fallito: 401».
    let utenti_dispositivo = match assicura_sessione(&s, &client, &base, &mut auth_hdr).await {
        Ok(u) => u,
        Err(esito) => {
            let motivo = match esito {
                Esito::ServonoCredenziali =>
                    "la sessione col dispositivo è scaduta e non ho le credenziali per rientrare \
                     (si perdono al riavvio del servizio): rifai «Connetti» con utente e password.",
                _ =>
                    "la sessione col dispositivo è scaduta e le credenziali di prima non valgono \
                     più: rifai «Connetti» con utente e password dell'Admin del progetto.",
            };
            tracing::warn!(remote = %base, "deploy non avviato: {motivo}");
            return (StatusCode::UNAUTHORIZED, motivo).into_response();
        }
    };
    // Come il precedente, va letta ORA: dopo `open_project` sul target ogni
    // sessione è decaduta e la GET risponderebbe 401.
    let target_legge_i_segreti = dispositivo_legge_i_segreti(&client, &base, &auth_hdr).await;
    let quanti_segreti = sws_core::segreti::leggi_segreti(&proj_dir)
        .ok()
        .flatten()
        .map(|s| s.len())
        .unwrap_or(0);

    // **Un pannello senza utenti li riceve da questo deploy** (fetta E,
    // 11-10-2026). Senza almeno un Admin nel progetto resterebbe chiuso a tutti
    // in impianto, schermo compreso: si ferma qui, senza toccare niente, e non
    // si conferma — si corregge il progetto. Solo per i pannelli che hanno
    // l'abbinamento (`in_attesa`): un runtime più vecchio fa come prima.
    let pannello_in_attesa = stato_abbinamento(&client, &base)
        .await
        .and_then(|v| v.get("in_attesa").and_then(|b| b.as_bool()))
        .unwrap_or(false);
    let progetto_ha_admin = ha_admin(
        &tokio::fs::read_to_string(proj_dir.join("users.yaml")).await.unwrap_or_default(),
    );
    if serve_admin(pannello_in_attesa, opz.replace_users, progetto_ha_admin) {
        return (
            StatusCode::PRECONDITION_REQUIRED,
            Json(serde_json::json!({
                "conferma": "serve-admin",
                "detail": "il pannello non ha ancora utenti: questo progetto deve portarne almeno uno Admin, altrimenti in impianto non entrerebbe nessuno",
            })),
        )
            .into_response();
    }

    if !opz.confirm_no_users
        && serve_conferma(
            opz.replace_users,
            utenti_progetto.len(),
            utenti_dispositivo.as_ref().map(Vec::len),
        )
    {
        // Niente è stato toccato. 428 e non 409: il 409 qui significa già «un
        // deploy è in corso», e i due casi non devono confondersi.
        return (
            StatusCode::PRECONDITION_REQUIRED,
            Json(serde_json::json!({
                "conferma": "utenti-vuoti",
                "utenti_dispositivo": utenti_dispositivo,
            })),
        )
            .into_response();
    }

    // Il deploy di un progetto con un altro nome cancella dal pannello quello
    // che c'era, storico compreso (03-10-2026: `rc14_lvgl` sparito dal TC620
    // senza una domanda). Si chiede prima di toccare qualunque cosa. Il nome è
    // quello che finirà nel manifest dello ZIP: `meta.name`.
    if !opz.confirm_replace {
        let nome = sws_core::Project::load(&proj_dir).ok().map(|p| p.meta.name);
        let sul_pannello = leggi_progetti_dispositivo(&client, &base, &auth_hdr).await;
        let da_sostituire = progetti_da_sostituire(&sul_pannello, nome.as_deref());
        if !da_sostituire.is_empty() {
            return (
                StatusCode::PRECONDITION_REQUIRED,
                Json(serde_json::json!({
                    "conferma": "sostituisce-progetti",
                    "progetto": nome,
                    "progetti": da_sostituire,
                })),
            )
                .into_response();
        }
    }

    // **Simboli di libreria che il pannello non conosce** (M9 del piano dei
    // simboli di libreria): la libreria viaggia con l'immagine del runtime, non
    // col progetto. Un pannello più vecchio li disegnerebbe come segnaposto: si
    // dice quali, e si può procedere lo stesso. Gli alias dei builtin non
    // contano: un pannello vecchio disegna il suo builtin.
    if !opz.confirm_missing_symbols {
        let usati = simboli_lib_usati(&proj_dir).await;
        if !usati.is_empty() {
            let noti = leggi_manifesto_pannello(&client, &base).await;
            let mancanti = simboli_mancanti(&usati, noti.as_ref());
            if !mancanti.is_empty() {
                return (
                    StatusCode::PRECONDITION_REQUIRED,
                    Json(serde_json::json!({
                        "conferma": "simboli-mancanti",
                        "simboli": mancanti,
                        "senza_libreria": noti.is_none(),
                    })),
                )
                    .into_response();
            }
        }
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);
    // Il primo deploy verso un pannello abbinato al cloud e senza utenti (fetta
    // E) gli porta gli utenti: da quel momento la firma del gateway non vale più
    // e la connessione senza credenziali con cui si è entrati non apre niente.
    let primo_deploy_cloud = pannello_in_attesa && target.token.is_empty();
    let bersaglio = s.remote_target.clone();
    let url_bersaglio = target.url.clone();
    let config_ricordo = s.config_dir.clone();

    tokio::spawn(async move {
        let _deploy_guard = deploy_guard;
        let send = |msg: &str| {
            let _ = tx.try_send(format!("{msg}\n"));
        };

        send("Esportazione progetto locale…");
        let zip = match crate::router::build_project_zip(&proj_dir, target_legge_i_segreti && opz.con_segreti).await {
            Ok(z) => z,
            Err(e) => {
                send(&format!("✗ {e}"));
                return;
            }
        };
        send(&format!(
            "✓ Esportato ({:.1} KB)",
            zip.len() as f64 / 1024.0
        ));

        // Il caso misurato sul WP630 il 23-09-2026: un pannello anteriore al
        // Passo 2 riceveva `secrets.yaml`, non lo leggeva, e le notifiche si
        // spegnevano senza che niente lo dicesse — mentre il token restava sul
        // suo disco in chiaro. Ora il file non parte e il motivo si legge qui.
        if !opz.con_segreti && quanti_segreti > 0 {
            send("Segreti non inviati: il dispositivo tiene i suoi (per aggiornarli, «Utenti e segreti»).");
        }
        if opz.con_segreti && quanti_segreti > 0 && !target_legge_i_segreti {
            send(&format!(
                "⚠ Il dispositivo non sa leggere `secrets.yaml`: {quanti_segreti} credenziali del \
                 progetto NON viaggiano, e ciò che le usa (notifiche, broker, database) resterà \
                 spento. Aggiorna il runtime del dispositivo e rifai il deploy."
            ));
        }

        // Nome con cui il progetto arriverà sul target: si legge dal manifest
        // dello ZIP appena costruito, così è esattamente quello che userà
        // l'upload — e non una ricostruzione dal nome della cartella locale.
        let (deploy_name, bundle_users) = read_bundle_meta(&zip);

        // Cosa sta per succedere agli account, detto prima di farlo e mentre
        // l'elenco del dispositivo è ancora quello vero.
        // `bundle_users` e non la lettura fatta nel precheck: è ciò che sta
        // davvero nello ZIP appena costruito, cioè quello che arriverà.
        riferisci_piano_utenti(
            opz.replace_users,
            &bundle_users,
            utenti_dispositivo.as_ref(),
            &send,
        );

        // Single-project runtime: wipe every existing project on the target so
        // the deploy fully overwrites it (not just the same-named one).
        // Vero se sul target esisteva un progetto con lo stesso nome e ne abbiamo
        // conservato lo stato: solo allora l'upload deve accettare la cartella
        // già esistente (e non cancellarla in caso di errore).
        let mut preserved_same_name = false;
        send("Aggiornamento progetto sul target…");
        let mut r = client.get(format!("{base}/api/projects"));
        if let Some(h) = &auth_hdr {
            r = r.header("Authorization", h);
        }
        match r.send().await {
            Ok(resp) if resp.status().is_success() => {
                let list: serde_json::Value = resp.json().await.unwrap_or_default();
                if let Some(arr) = list.as_array() {
                    if !arr.is_empty() {
                        // Close any active project first so delete isn't rejected (409).
                        let mut rc = client.post(format!("{base}/api/projects/close"));
                        if let Some(h) = &auth_hdr {
                            rc = rc.header("Authorization", h);
                        }
                        let _ = rc.send().await;
                    }
                    for item in arr {
                        if let Some(n) = item["name"].as_str() {
                            // Stesso nome = stai ridistribuendo QUESTO progetto: si
                            // rimuovono solo i file di progettazione e si lascia lo
                            // stato del dispositivo (database storico in testa).
                            // Nome diverso = lo stai sostituendo con un altro
                            // progetto, e preservarne lo storico non ha senso.
                            let same = deploy_name.as_deref() == Some(n);
                            let url = if same {
                                format!("{base}/api/projects/{}?preserve_state=true", pct_encode(n))
                            } else {
                                format!("{base}/api/projects/{}", pct_encode(n))
                            };
                            let mut rd = client.delete(url);
                            if let Some(h) = &auth_hdr {
                                rd = rd.header("Authorization", h);
                            }
                            match rd.send().await {
                                Ok(d) if d.status().is_success() => {
                                    if same {
                                        preserved_same_name = true;
                                        send(&format!("  ✓ \"{n}\": pagine sostituite, database e backup conservati"));
                                    } else {
                                        send(&format!("  ✓ rimosso \"{n}\""));
                                    }
                                }
                                Ok(d) => send(&format!("  ⚠ \"{n}\": {}", d.status())),
                                Err(e) => send(&format!("  ⚠ \"{n}\": {e}")),
                            }
                        }
                    }
                }
            }
            Ok(resp) => send(&format!(
                "⚠ Lista progetti non disponibile: {}",
                resp.status()
            )),
            Err(e) => send(&format!("⚠ Lista progetti non disponibile: {e}")),
        }

        // Upload ZIP
        send("Upload ZIP al target…");
        // `deploy=true` quando la cartella esiste già (svuotata dei soli file di
        // progettazione): i conflitti non si applicano e un errore non deve
        // cancellarla. Degli utenti decide `replace_users`, non questo flag.
        let upload_url = url_upload(
            &base,
            deploy_name.as_deref(),
            preserved_same_name,
            opz.replace_users,
        );
        let mut req = client
            .post(upload_url)
            .header("Content-Type", "application/zip")
            .body(zip.clone());
        if let Some(h) = &auth_hdr {
            req = req.header("Authorization", h);
        }
        let upload_res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                send(&format!("✗ {e}"));
                return;
            }
        };

        // Handle 409 conflict: close + delete old project, then retry
        let upload_res = if upload_res.status() == 409 {
            let body: serde_json::Value = upload_res.json().await.unwrap_or_default();
            let existing = body["name"].as_str().unwrap_or("?").to_string();
            send(&format!("Conflitto: rimozione \"{existing}\" dal target…"));

            // close active project on remote (ignore errors — might already be closed)
            let mut r = client.post(format!("{base}/api/projects/close"));
            if let Some(h) = &auth_hdr {
                r = r.header("Authorization", h);
            }
            let _ = r.send().await;

            // delete the conflicting project
            // Lo stesso nome è lo stesso progetto ridistribuito: si tolgono solo i
            // file di disegno, database e backup restano (04-10-2026 — prima qui si
            // cancellava tutto, storico compreso).
            let mut r = client.delete(format!("{base}/api/projects/{}?preserve_state=true", pct_encode(&existing)));
            if let Some(h) = &auth_hdr {
                r = r.header("Authorization", h);
            }
            let del = match r.send().await {
                Ok(d) => d,
                Err(e) => {
                    send(&format!("✗ {e}"));
                    return;
                }
            };
            if !del.status().is_success() {
                send(&format!("✗ Delete fallito: {}", del.status()));
                return;
            }
            send(&format!("✓ \"{existing}\": pagine sostituite, database e backup conservati"));

            // Ritentativo: la cartella è rimasta (svuotata dei soli file di
            // disegno), quindi `deploy=true` col suo nome — e `replace_users`,
            // che è il motivo per cui l'URL si compone in un posto solo.
            let mut req = client
                .post(url_upload(&base, Some(&existing), true, opz.replace_users))
                .header("Content-Type", "application/zip")
                .body(zip.clone());
            if let Some(h) = &auth_hdr {
                req = req.header("Authorization", h);
            }
            match req.send().await {
                Ok(u) => u,
                Err(e) => {
                    send(&format!("✗ {e}"));
                    return;
                }
            }
        } else {
            upload_res
        };

        if !upload_res.status().is_success() {
            send(&format!("✗ Upload fallito: {}", upload_res.status()));
            return;
        }
        let body: serde_json::Value = upload_res.json().await.unwrap_or_default();
        let uploaded_name = body["name"].as_str().unwrap_or("?").to_string();
        send(&format!("✓ Caricato come \"{uploaded_name}\""));

        // Open (activate) the uploaded project on the remote
        send("Attivazione progetto…");
        let mut r = client.post(format!(
            "{base}/api/projects/{}/open",
            pct_encode(&uploaded_name)
        ));
        if let Some(h) = &auth_hdr {
            r = r.header("Authorization", h);
        }
        match r.send().await {
            Ok(o) if o.status().is_success() => {
                send(&format!("✓ \"{uploaded_name}\" attivo sul runtime"));
                // Lo stato degli account **dopo**, dichiarato invece che dedotto.
                // Qui il token non vale più — `open_project` passa da
                // `swap_store`, che azzera le sessioni — quindi si usa la sonda
                // senza token: `/api/system` risponde 200 con
                // `auth_required:false` solo dove non c'è nessun utente.
                // **Si rientra da soli, se si può.**
                //
                // Il deploy porta `users.yaml` del progetto, quindi da adesso
                // il dispositivo pretende quelle credenziali e il token di
                // prima non vale più. Finora l'IDE restava «connesso» col
                // token morto e ogni azione dopo rispondeva 401 senza che
                // niente lo dicesse (16-10-2026).
                let mut hdr = auth_hdr.clone();
                match assicura_sessione(&s, &client, &base, &mut hdr).await {
                    Ok(_) => {}
                    Err(Esito::ServonoCredenziali) => {
                        send("⚠ Il dispositivo adesso ha i suoi utenti e le credenziali di prima non ci sono \
                              (ti eri collegato a un pannello senza account). Riconnettiti con l'utente e la \
                              password dell'Admin del progetto appena distribuito.");
                    }
                    Err(_) => {
                        send("⚠ Le credenziali di prima non valgono più sul dispositivo: riconnettiti con \
                              quelle dell'Admin del progetto appena distribuito.");
                    }
                }
                if senza_utenti(&client, &base).await {
                    // Copre anche il caso del seed di recupero: se sul
                    // dispositivo c'è SWS_ADMIN_PASSWORD, un progetto senza
                    // utenti fa ripartire l'account d'ambiente e qui si legge
                    // «richiede il login» invece che «aperto», senza che il
                    // deploy debba indovinare l'ambiente del dispositivo.
                    send(
                        "⚠ Il dispositivo non ha utenti: il pannello è accessibile senza password.",
                    );
                } else {
                    send("✓ Il dispositivo richiede il login.");
                }
                send("🚀 Deploy completato!");
                if primo_deploy_cloud {
                    // Visto nel collaudo dell'11-10-2026: il primo deploy
                    // riusciva, i «sync» dopo davano errore senza spiegare
                    // perché (401). Si dice, e si chiude la connessione: la
                    // prossima la si apre con le credenziali del progetto.
                    let mut g = bersaglio.write().await;
                    if g.as_ref().is_some_and(|t| t.url == url_bersaglio) {
                        *g = None;
                    }
                    // Il ricordo era senza credenziali: non varrebbe più.
                    dimentica_dispositivo(&config_ricordo);
                    send(
                        "ⓘ Il pannello ora ha i suoi utenti, arrivati con questo progetto: la connessione \
                         senza credenziali è chiusa. Per i prossimi deploy riconnettiti con utente e \
                         password del progetto.",
                    );
                }
            }
            Ok(o) => send(&format!("✗ Attivazione fallita: {}", o.status())),
            Err(e) => send(&format!("✗ {e}")),
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|l| Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(l)));
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(stream))
        .unwrap()
}

/// `POST /api/remote/project/delete` — delete the project currently active on
/// the connected remote runtime (close + DELETE). Single-project model: there
/// is at most one project, so we resolve its name from the remote's
/// `/api/system` and remove it.
pub async fn delete_remote_project(
    State(s): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let client = make_remote_client(&s, &target.url);
    let base = target.url.trim_end_matches('/').to_string();
    let auth_hdr: Option<String> = if target.token.is_empty() {
        None
    } else {
        Some(format!("Bearer {}", target.token))
    };

    // Resolve the active project name from the remote system status.
    let mut r = client.get(format!("{base}/api/system"));
    if let Some(h) = &auth_hdr {
        r = r.header("Authorization", h);
    }
    let active = match r.send().await {
        Ok(resp) if resp.status().is_success() => {
            let v: serde_json::Value = resp.json().await.unwrap_or_default();
            v["active_project"].as_str().map(|s| s.to_string())
        }
        Ok(resp) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Stato runtime: {}", resp.status()),
            )
                .into_response()
        }
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("Stato runtime: {e}")).into_response(),
    };
    let name = match active {
        Some(n) => n,
        None => return (StatusCode::CONFLICT, "No active project on the runtime").into_response(),
    };

    // Close (so delete isn't rejected with 409) then delete.
    let mut rc = client.post(format!("{base}/api/projects/close"));
    if let Some(h) = &auth_hdr {
        rc = rc.header("Authorization", h);
    }
    let _ = rc.send().await;

    let mut rd = client.delete(format!("{base}/api/projects/{}", pct_encode(&name)));
    if let Some(h) = &auth_hdr {
        rd = rd.header("Authorization", h);
    }
    match rd.send().await {
        Ok(d) if d.status().is_success() => {
            tracing::info!(project = %name, "deleted active project on remote runtime");
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(d) => (
            StatusCode::BAD_GATEWAY,
            format!("Delete fallito: {}", d.status()),
        )
            .into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, format!("{e}")).into_response(),
    }
}

/// Com'è andato il tentativo di rientrare dopo un deploy.
pub(crate) enum Esito {
    /// Il token vale ancora: il dispositivo non ha cambiato regime.
    NienteDaFare,
    Rientrato,
    /// Non c'erano credenziali da riusare — ci si era collegati a un pannello
    /// senza utenti, e una password dal progetto non si ricava: in
    /// `users.yaml` c'è un hash argon2.
    ServonoCredenziali,
    Rifiutato,
}

/// Il token vale ancora? Se no, rientra. Da chiamare **prima** di lavorare.
///
/// È la correzione del difetto tornato tre volte (20-10-2026): «una volta che
/// sono connesso a un pannello devo rimanere connesso per tutta la fase di
/// sviluppo». Il rientro automatico esisteva già, ma girava **dopo** il
/// caricamento e **solo** se quel deploy aveva sostituito gli utenti: un «Invia
/// ora», che è un deploy parziale, non lo attivava mai, e il primo 401 lo
/// prendeva in faccia l'upload. Chi usava l'IDE doveva fare Disconnetti e
/// Riconnetti a mano — cioè esattamente questo, a mano.
///
/// La sonda è `GET /api/auth/users`, che esiste anche sulla porta ridotta di un
/// pannello (`--no-admin`) e vuole un Admin: un 401 lì dice davvero «questo
/// token non vale più», non «questa rotta non c'è».
///
/// Ritorna l'elenco degli utenti del dispositivo quando la sessione è buona,
/// così chi chiama non deve richiederlo una seconda volta.
pub(crate) async fn assicura_sessione(
    s: &AppState,
    client: &reqwest::Client,
    base: &str,
    auth_hdr: &mut Option<String>,
) -> Result<Option<Vec<String>>, Esito> {
    match utenti_dispositivo_o_401(client, base, auth_hdr).await {
        Ok(utenti) => Ok(utenti),
        Err(()) => {
            tracing::warn!(remote = %base, "sessione remota scaduta: provo a rientrare");
            match rientra(s, client, base, true).await {
                Esito::Rientrato => {
                    // Il token è cambiato: l'intestazione di chi chiama no.
                    let nuovo = s.remote_target.read().await.as_ref().map(|t| t.token.clone());
                    *auth_hdr = nuovo
                        .filter(|t| !t.is_empty())
                        .map(|t| format!("Bearer {t}"));
                    tracing::info!(remote = %base, "sessione remota rinnovata");
                    Ok(utenti_dispositivo_o_401(client, base, auth_hdr).await.ok().flatten())
                }
                altro => Err(altro),
            }
        }
    }
}

/// Dopo il deploy: se il token non vale più, si rientra con le credenziali del
/// «Connetti». Aggiorna il bersaglio e la bandiera `autenticato`.
///
/// `forza` salta la deduzione «il token muore se e solo se gli utenti sono
/// stati sostituiti»: chi ha già visto un 401 non ha bisogno di dedurre niente.
async fn rientra(
    s: &AppState,
    client: &reqwest::Client,
    base: &str,
    forza: bool,
) -> Esito {
    let Some(t) = s.remote_target.read().await.clone() else {
        return Esito::NienteDaFare;
    };
    // **Non si sonda: si sa.**
    //
    // La prima stesura chiedeva `/api/auth/whoami` col token per vedere se
    // valeva ancora, e la guardia `ogni_chiamata_dell_ide_ha_la_sua_rotta_sul_dispositivo`
    // l'ha bocciata: quella rotta sulla porta di gestione di un pannello
    // **non esiste** (`--no-admin`), quindi la sonda avrebbe risposto 404
    // ovunque e il token sarebbe risultato morto a ogni deploy. Nemmeno
    // `/api/projects` serviva: su quella porta è aperta, quindi avrebbe
    // risposto 200 anche con un token scaduto.
    //
    // La domanda vera non ha bisogno di nessuna sonda: il token muore se e
    // solo se **questo deploy ha sostituito gli utenti**, e questo lo sappiamo
    // senza chiedere a nessuno.
    if !forza || senza_utenti(client, base).await {
        return Esito::NienteDaFare;
    }
    let Some((utente, password)) = t.credenziali.clone() else {
        segna_non_autenticato(s).await;
        return Esito::ServonoCredenziali;
    };
    let res = client
        .post(format!("{base}/api/auth/login"))
        .json(&serde_json::json!({ "username": utente, "password": password }))
        .send()
        .await;
    let token = match res {
        Ok(o) if o.status().is_success() => o
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(str::to_string)),
        _ => None,
    };
    match token {
        Some(token) => {
            if let Some(t) = s.remote_target.write().await.as_mut() {
                t.token = token;
                t.autenticato = true;
            }
            Esito::Rientrato
        }
        None => {
            segna_non_autenticato(s).await;
            Esito::Rifiutato
        }
    }
}

async fn segna_non_autenticato(s: &AppState) {
    if let Some(t) = s.remote_target.write().await.as_mut() {
        t.autenticato = false;
    }
}

/// `GET /api/remote/status` — lo stato della connessione, che l'IDE chiede
/// ogni 5 s per accorgersi di un riavvio del remoto o di una sessione scaduta.
///
/// (Questo commento stava su `Esito`, due funzioni più su: ci era finito con
/// una modifica e ci è rimasto. Rimesso al suo posto il 20-10-2026.)
pub async fn remote_status(State(s): State<AppState>) -> Json<RemoteStatus> {
    ripristina_se_serve(&s).await;
    let guard = s.remote_target.read().await;
    match guard.as_ref() {
        Some(t) => Json(RemoteStatus {
            connected: true,
            url: Some(t.url.clone()),
            connected_at_ms: Some(t.connected_at_ms),
            autenticato: t.autenticato,
        }),
        None => Json(RemoteStatus {
            connected: false,
            url: None,
            connected_at_ms: None,
            autenticato: true,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn progetto_con_segreti() -> sws_core::project::Project {
        serde_yaml::from_str(
            r#"
meta: { name: prova, version: 0.1.0 }
sources:
- kind: mqtt
  id: casa
  host: 192.168.1.6
  port: 1883
  client_id: x
  password: vera-mqtt
  topics: []
- kind: opcua_client
  id: pressa
  endpoint_url: opc.tcp://10.0.0.5:4840
  auth: { kind: username_password, username: op, password: vera-opcua }
  nodes: []
- kind: homeassistant
  id: ha
  url: http://ha.local:8123
  token: vero-token
  entities: []
"#,
        )
        .unwrap()
    }

    /// L'impianto lo tocca il pannello (25-10-2026): prima di inoltrare, i
    /// segreti mascherati diventano quelli del progetto dell'IDE — quello che
    /// fa fede — e una password vera digitata adesso resta com'è.
    #[test]
    fn i_segreti_si_risolvono_dal_progetto_dell_ide() {
        let p = progetto_con_segreti();
        let m = crate::router::MASKED_PASSWORD;
        let b = risolvi_mqtt(serde_json::json!({"source_id": "casa", "password": m}), Some(&p));
        assert_eq!(b["password"], "vera-mqtt");
        let b = risolvi_mqtt(serde_json::json!({"source_id": "casa", "password": "digitata"}), Some(&p));
        assert_eq!(b["password"], "digitata", "una password scritta adesso non si tocca");
        let b = risolvi_mqtt(serde_json::json!({"source_id": "altra", "password": m}), Some(&p));
        assert!(b["password"].is_null(), "il segnaposto non deve mai arrivare al broker");

        let b = risolvi_opcua(
            serde_json::json!({"source_id": "pressa", "auth": {"kind": "username_password", "username": "op", "password": m}}),
            Some(&p),
        );
        assert_eq!(b["auth"]["password"], "vera-opcua");

        let b = risolvi_ha(serde_json::json!({"source_id": "ha"}), Some(&p));
        assert_eq!(b["url"], "http://ha.local:8123");
        assert_eq!(b["token"], "vero-token");
        let b = risolvi_ha(serde_json::json!({"source_id": "nessuna"}), Some(&p));
        assert!(b.get("token").is_none(), "senza sorgente decide il pannello");
    }

    /// Il pannello del progetto (25-10-2026): si scrive in 0600, si rilegge
    /// uguale, si dimentica — e dimenticare due volte non è un errore.
    #[test]
    fn il_pannello_del_progetto_si_ricorda_e_si_dimentica() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(dispositivo_ricordato(d.path()), None);
        let p = DispositivoRicordato {
            url: "https://sws.example/dev/tc620-garage".into(),
            username: "admin".into(),
            password: "segreta: con due punti".into(),
        };
        ricorda_dispositivo(d.path(), &p).unwrap();
        assert_eq!(dispositivo_ricordato(d.path()), Some(p));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let m = std::fs::metadata(d.path().join(FILE_DISPOSITIVO)).unwrap().permissions().mode();
            assert_eq!(m & 0o777, 0o600, "le credenziali del pannello non devono essere leggibili da altri");
        }
        dimentica_dispositivo(d.path());
        assert_eq!(dispositivo_ricordato(d.path()), None);
        dimentica_dispositivo(d.path());
    }

    /// `autenticato: false` deve **arrivare** all'IDE.
    ///
    /// L'avviso «il collegamento c'è ma le credenziali non valgono più»
    /// (16-10-2026) lo decide `RuntimeConnectionTab.tsx` con
    /// `s.autenticato === false`: un campo assente è `undefined`, e `undefined
    /// === false` è falso. Finché questa struct saltava il campo proprio
    /// quando valeva `false`, quell'avviso non poteva comparire mai.
    #[test]
    fn il_collegamento_scaduto_si_vede_nel_json() {
        let j = serde_json::to_string(&RemoteStatus {
            connected: true,
            url: Some("https://x".into()),
            connected_at_ms: Some(1),
            autenticato: false,
        })
        .unwrap();
        assert!(j.contains("\"autenticato\":false"), "il campo non c'e': {j}");
    }

    /// Un dispositivo che non conosce la domanda non sa la risposta.
    ///
    /// Il caso vero, misurato sul WP630 a 2.11.0 il 23-09-2026: il suo
    /// `/api/system` non ha il campo, quindi il deploy non deve mandargli le
    /// credenziali. Il numero di versione non basta a saperlo — `2.11.1` è
    /// stata pubblicata prima dei segreti e riusata dal ramo che li introduce.
    #[test]
    fn la_capacita_assente_vale_no() {
        let vecchio = serde_json::json!({ "runtime_version": "2.11.0", "mode": "runtime" });
        assert!(!legge_i_segreti(&vecchio));

        let nuovo = serde_json::json!({ "runtime_version": "2.11.1", "segreti_separati": true });
        assert!(legge_i_segreti(&nuovo));

        // Dichiarata e spenta, e una risposta che non è nemmeno un oggetto:
        // in entrambi i casi non si manda niente.
        assert!(!legge_i_segreti(
            &serde_json::json!({ "segreti_separati": false })
        ));
        assert!(!legge_i_segreti(&serde_json::Value::Null));
        assert!(!legge_i_segreti(&serde_json::json!("pagina di errore")));
        // Un `true` che arriva come stringa non è un sì: `as_bool` è severo di
        // proposito, perché un proxy che risponde HTML non deve autorizzare
        // l'invio di un segreto.
        assert!(!legge_i_segreti(
            &serde_json::json!({ "segreti_separati": "true" })
        ));
    }

    // ── Gli utenti viaggiano col progetto (2026-09-11) ───────────────────────

    /// La conferma serve **solo** quando il deploy toglierebbe ogni account a un
    /// dispositivo che ne ha: è l'unico esito che lascia un pannello aperto.
    #[test]
    fn i_simboli_di_libreria_che_il_pannello_non_conosce() {
        let pagina: serde_yaml::Value = serde_yaml::from_str(
            "objects:\n  - { id: a, type: symbol, symbol_id: 'lib:process/centrifugal-pump' }\n  - { id: b, type: symbol, symbol_id: pump }\n  - id: g\n    type: grid\n    grid_cells:\n      - child: { id: c, type: symbol, symbol_id: 'lib:process/vertical-tank' }\n",
        )
        .unwrap();
        let mut usati = std::collections::BTreeSet::new();
        raccogli_simboli_lib(&pagina, &mut usati);
        let usati: Vec<String> = usati.into_iter().collect();
        assert_eq!(usati, ["lib:process/centrifugal-pump", "lib:process/vertical-tank"], "i builtin non contano, le celle sì");
        let noti = vec!["lib:process/centrifugal-pump".to_string()];
        assert_eq!(simboli_mancanti(&usati, Some(&noti)), ["lib:process/vertical-tank"]);
        assert_eq!(simboli_mancanti(&usati, None), usati, "senza manifesto mancano tutti");
        assert!(simboli_mancanti(&usati, Some(&usati.clone())).is_empty());
    }

    #[test]
    fn la_conferma_serve_solo_se_il_pannello_resta_senza_account() {
        // Progetto con utenti: si sostituisce e basta, niente da confermare.
        assert!(!serve_conferma(true, 2, Some(3)));
        // Progetto vuoto e dispositivo già vuoto: non si toglie niente a nessuno.
        assert!(!serve_conferma(true, 0, Some(0)));
        // Progetto vuoto, dispositivo con account: è il caso.
        assert!(serve_conferma(true, 0, Some(1)));
        // Elenco non leggibile: nel dubbio si chiede.
        assert!(serve_conferma(true, 0, None));
        // Casella spenta: gli account non si toccano, quindi mai.
        assert!(!serve_conferma(false, 0, Some(3)));
        assert!(!serve_conferma(false, 0, None));
    }

    /// `replace_users` deve esserci in **tutte** le forme dell'URL, compreso il
    /// ritentativo dopo un 409 (che dal 04-10-2026 conserva lo stato e ha `deploy=true`): è il punto in cui
    /// storicamente si perdeva un parametro.
    /// `con_segreti` assente vale **acceso**: un client di prima del 26-09-2026
    /// (o una chiamata senza corpo) continua a portare i segreti.
    #[test]
    fn deploy_body_porta_i_segreti_salvo_richiesta() {
        let vecchio: DeployBody = serde_json::from_str("{}").unwrap();
        assert!(vecchio.con_segreti && vecchio.replace_users);
        let progetto: DeployBody =
            serde_json::from_str(r#"{"replace_users":false,"con_segreti":false}"#).unwrap();
        assert!(!progetto.con_segreti && !progetto.replace_users);
        assert!(DeployBody::default().con_segreti);
    }

    #[test]
    fn l_url_di_upload_porta_sempre_replace_users() {
        let a = url_upload("http://d:8444", Some("impianto"), true, true);
        assert!(
            a.contains("replace_users=true")
                && a.contains("deploy=true")
                && a.contains("name=impianto")
        );
        let b = url_upload("http://d:8444", Some("impianto"), true, false);
        assert!(b.contains("replace_users=false"));
        // Ritentativo: niente deploy, niente nome — ma il flag resta.
        let c = url_upload("http://d:8444", None, false, true);
        assert_eq!(c, "http://d:8444/api/projects/upload?replace_users=true");
        assert!(!c.contains("deploy=true"));
        let d = url_upload("http://d:8444", Some("ignorato"), false, false);
        assert_eq!(d, "http://d:8444/api/projects/upload?replace_users=false");
    }

    #[test]
    fn la_differenza_fra_gli_elenchi_e_ordinata_e_simmetrica() {
        let progetto = vec!["zeta".to_string(), "admin".to_string()];
        let dispositivo = vec!["admin".to_string(), "vecchio".to_string()];
        let (solo_p, solo_d) = differenza_utenti(&progetto, &dispositivo);
        assert_eq!(solo_p, vec!["zeta".to_string()]);
        assert_eq!(solo_d, vec!["vecchio".to_string()]);
        // Elenchi uguali: nessuna differenza da riferire.
        let (a, b) = differenza_utenti(&progetto, &progetto);
        assert!(a.is_empty() && b.is_empty());
    }

    /// Corpo assente = default, non «tutto spento»: l'auto-deploy dello store
    /// chiama senza corpo, e un default a `false` gli farebbe fare una cosa
    /// diversa da quella dichiarata.
    #[test]
    fn il_deploy_sostituisce_solo_i_progetti_con_un_altro_nome() {
        let p = |n: &str, b: Option<u64>| DaSostituire { nome: n.into(), storico_byte: b };
        let pannello = vec![p("rc14_lvgl", Some(51_000_000)), p("tc620-sistema", Some(1_000))];
        assert_eq!(progetti_da_sostituire(&pannello, Some("tc620-sistema")), vec![p("rc14_lvgl", Some(51_000_000))]);
        assert!(progetti_da_sostituire(&[p("tc620-sistema", None)], Some("tc620-sistema")).is_empty());
        assert!(progetti_da_sostituire(&[], Some("x")).is_empty());
        assert_eq!(progetti_da_sostituire(&pannello, None).len(), 2, "senza nome li cancellerebbe tutti");
        let d: DeployBody = serde_json::from_str(r#"{"confirm_replace": true}"#).unwrap();
        assert!(d.confirm_replace);
        let d: DeployBody = serde_json::from_str("{}").unwrap();
        assert!(!d.confirm_replace);
    }

    #[test]
    fn il_corpo_del_deploy_ha_i_default_giusti() {
        let d = DeployBody::default();
        assert!(d.replace_users && !d.confirm_no_users);
        let vuoto: DeployBody = serde_json::from_str("{}").unwrap();
        assert!(vuoto.replace_users, "senza campo, si sostituisce");
        let spento: DeployBody = serde_json::from_str(r#"{"replace_users":false}"#).unwrap();
        assert!(!spento.replace_users && !spento.confirm_no_users);
        // Q9: un campo sconosciuto è un errore, non un silenzio.
        assert!(serde_json::from_str::<DeployBody>(r#"{"replace_userz":true}"#).is_err());
    }

    /// Il caso che ha rotto il primo deploy dopo un'installazione pulita
    /// (2026-09-11, WP630): il dispositivo non ha utenti, la sonda passa e
    /// dichiara `auth_required: false` → ci si collega senza autenticazione,
    /// invece di dare del bugiardo a chi ha digitato una password.
    #[test]
    fn un_dispositivo_senza_utenti_si_riconosce() {
        assert!(niente_autenticazione(true, Some(false)));
    }

    /// Con utenti definiti `/api/system` risponde 401 senza token: la sonda non
    /// passa, e le credenziali sbagliate restano credenziali sbagliate.
    #[test]
    fn un_dispositivo_con_utenti_resta_protetto() {
        assert!(!niente_autenticazione(false, None));
        // Difesa in profondità: se un domani la rotta rispondesse 200 anche a
        // chi ha utenti, il campo dichiarato vince sul codice di stato.
        assert!(!niente_autenticazione(true, Some(true)));
    }

    /// Runtime più vecchio del campo `auth_required`: vale il fatto che la
    /// richiesta senza token è passata.
    #[test]
    fn senza_il_campo_vale_l_esito_della_richiesta() {
        assert!(niente_autenticazione(true, None));
        assert!(!niente_autenticazione(false, Some(false)));
    }

    /// Costruisce uno ZIP di export minimo in memoria.
    fn bundle(manifest: Option<&str>, users: Option<&str>) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            if let Some(m) = manifest {
                z.start_file("manifest.json", opts).unwrap();
                z.write_all(m.as_bytes()).unwrap();
            }
            z.start_file("project.yaml", opts).unwrap();
            z.write_all(b"meta:\n  name: impianto\n").unwrap();
            if let Some(u) = users {
                z.start_file("users.yaml", opts).unwrap();
                z.write_all(u.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        buf
    }

    /// Il nome decide se il deploy prende il percorso che PRESERVA lo stato del
    /// dispositivo (nome uguale) o quello distruttivo (nome diverso). Se questa
    /// lettura fallisce in silenzio si torna a cancellare il database: è la
    /// ragione per cui il caso ha un test e non un'ispezione a occhio.
    #[test]
    fn legge_nome_e_utenti_dal_bundle() {
        let z = bundle(
            Some(r#"{"name":"impianto","version":"1"}"#),
            Some("users:\n  - username: admin_ide\n    role: Admin\n  - username: operatore\n    role: Operator\n"),
        );
        let (name, users) = read_bundle_meta(&z);
        assert_eq!(name.as_deref(), Some("impianto"));
        assert_eq!(
            users,
            vec!["admin_ide".to_string(), "operatore".to_string()]
        );
    }

    #[test]
    fn bundle_senza_users_yaml_non_ha_utenti() {
        let (name, users) = read_bundle_meta(&bundle(Some(r#"{"name":"x"}"#), None));
        assert_eq!(name.as_deref(), Some("x"));
        assert!(users.is_empty());
    }

    #[test]
    fn bundle_illeggibile_non_finge_un_nome() {
        // Nessun nome → il deploy NON deve credere di stare ridistribuendo lo
        // stesso progetto: meglio il comportamento distruttivo di prima che
        // sovrapporre pagine nuove a un progetto diverso.
        assert_eq!(read_bundle_meta(b"non uno zip").0, None);
        assert_eq!(read_bundle_meta(&bundle(None, None)).0, None);
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DimenticaCertificatoBody {
    pub host: String,
}

/// `POST /api/device/cert/forget` — toglie dall'archivio di **questo PC**
/// l'impronta del certificato di un dispositivo, per tutte le porte.
///
/// Gemello di `dimentica_chiave_host`: esiste per il factory reset (il pannello
/// si rigenera un certificato), non è mai automatico, e resta nell'audit.
/// Admin per posizione nel router.
pub async fn dimentica_certificato(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<DimenticaCertificatoBody>,
) -> Response {
    let host = req.host.trim();
    if !crate::packaging::host_sicuro(host) {
        return (
            StatusCode::BAD_REQUEST,
            format!("nome host non valido: «{host}»\n"),
        )
            .into_response();
    }
    let tolte = match s.certificati.dimentica_host(host) {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "impossibile aggiornare {}: {e}\n",
                    s.certificati.path().display()
                ),
            )
                .into_response()
        }
    };
    s.audit.log(
        "device.cert_forget",
        Some(user.username),
        serde_json::json!({ "host": host, "tolte": tolte }),
    );
    tracing::info!(
        host,
        tolte = tolte.len(),
        "certificato dimenticato su richiesta"
    );
    Json(serde_json::json!({
        "tolte": tolte,
        "messaggio": if tolte.is_empty() {
            format!("nessun certificato memorizzato per {host}")
        } else {
            format!("dimenticato il certificato di {host}: al prossimo collegamento si memorizza quello nuovo")
        },
    })).into_response()
}

#[cfg(test)]
mod prove_impronta_mostrata {
    use super::impronta_da_mostrare;

    /// `http://`: nessuna identità da verificare, niente da dire. Una riga
    /// vuota farebbe credere il contrario.
    #[test]
    fn in_chiaro_non_si_dice_niente() {
        assert_eq!(impronta_da_mostrare(None, None), (None, None));
        assert_eq!(impronta_da_mostrare(Some("ab:cd"), None), (None, None));
    }

    /// Primo contatto: è l'unico momento in cui un attacco in mezzo funziona,
    /// ed è l'unico in cui vale la pena guardare lo schermo del pannello.
    #[test]
    fn al_primo_contatto_e_nuova() {
        assert_eq!(
            impronta_da_mostrare(None, Some("ab:cd".into())),
            (Some("ab:cd".into()), Some(true))
        );
    }

    /// Già memorizzata: si mostra lo stesso — serve a confrontare quando si
    /// vuole — ma non si allarma nessuno.
    #[test]
    fn gia_conosciuta_non_e_nuova() {
        assert_eq!(
            impronta_da_mostrare(Some("ab:cd"), Some("ab:cd".into())),
            (Some("ab:cd".into()), Some(false))
        );
    }
}

#[cfg(test)]
mod tests_serve_admin {
    use super::*;

    #[test]
    fn il_primo_deploy_deve_portare_un_admin() {
        assert!(serve_admin(true, true, false), "progetto senza Admin");
        assert!(serve_admin(true, false, true), "utenti che non viaggiano");
        assert!(!serve_admin(true, true, true));
        assert!(!serve_admin(false, true, false), "pannello che ha già utenti: regole di prima");
    }

    #[test]
    fn admin_nel_file_degli_utenti() {
        assert!(ha_admin("users:\n  - username: mauro\n    role: Admin\n"));
        assert!(!ha_admin("users:\n  - username: op\n    role: Operator\n"));
        assert!(!ha_admin(""));
    }
}

/// Inoltra al dispositivo collegato una richiesta della ritenzione e ne restituisce il
/// corpo, con gli errori detti come per la pulizia dello storico. Un 404 vuol dire un
/// runtime di prima del 20-10-2026, che la ritenzione automatica non ce l'ha.
async fn inoltra_ritenzione(s: &AppState, metodo: reqwest::Method, percorso: &str) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "No remote runtime connected").into_response(),
    };
    let client = make_remote_client(s, &target.url);
    let base = target.url.trim_end_matches('/');
    let url = format!("{base}{percorso}");
    let mut req = client.request(metodo, url);
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => {
            let corpo: serde_json::Value = r.json().await.unwrap_or_default();
            (StatusCode::OK, Json(corpo)).into_response()
        }
        Ok(r) if r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::METHOD_NOT_ALLOWED => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo non conosce la ritenzione automatica: aggiorna il suo runtime.".to_string(),
        )
            .into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Riconnettiti con \
             credenziali admin e riprova."
                .to_string(),
        )
            .into_response(),
        Ok(r) => {
            let code = r.status();
            let testo = r.text().await.unwrap_or_default();
            (StatusCode::BAD_GATEWAY, format!("Il dispositivo ha risposto {code}: {testo}")).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Dispositivo non raggiungibile: {e}")).into_response(),
    }
}

/// `GET /api/remote/datastores/retention` — lo stato della ritenzione **sul
/// dispositivo**: i numeri dell'anteprima sono i suoi, non quelli del PC (20-10-2026).
pub async fn remote_ritenzione(State(s): State<AppState>) -> Response {
    // Scritto per esteso, fra virgolette, perché lo trovi il test
    // `ogni_chiamata_dell_ide_ha_la_sua_rotta_sul_dispositivo`: "{base}/api/datastores/retention".
    inoltra_ritenzione(&s, reqwest::Method::GET, "/api/datastores/retention").await
}

/// `POST /api/remote/datastores/:id/retention/confirm` — conferma il primo giro sul
/// dispositivo collegato. Anche qui finisce nell'audit, oltre che su quello del pannello.
pub async fn remote_conferma_ritenzione(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Response {
    let url = s.remote_target.read().await.as_ref().map(|t| t.url.clone());
    s.audit.log(
        "remote.ritenzione_confermata",
        Some(user.username),
        serde_json::json!({ "url": url, "datastore": id }),
    );
    // Per il test delle rotte del dispositivo: "{base}/api/datastores/{}/retention/confirm".
    inoltra_ritenzione(
        &s,
        reqwest::Method::POST,
        &format!("/api/datastores/{}/retention/confirm", pct_encode(&id)),
    )
    .await
}

