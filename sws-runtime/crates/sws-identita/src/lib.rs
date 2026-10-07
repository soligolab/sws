//! Identity of an **installation**: who may open the IDE, independently of any project.
//!
//! # Perché questo crate esiste, e perché non è `sws-auth`
//!
//! `sws-auth` tiene gli utenti **del progetto**: vivono in `users.yaml` dentro la cartella del
//! progetto, viaggiano con il deploy e proteggono l'impianto. Sono gli operatori di reparto.
//!
//! Qui stanno gli utenti **dell'installazione**: chi apre l'editor. Sono due cose diverse e
//! mescolarle è già costato caro — il 14-09-2026 definire il primo utente di un progetto
//! (un Operator, pensato per il pannello) ha chiuso il maintainer fuori dal proprio editor,
//! perché scrivere `users.yaml` accendeva l'autenticazione **nello stesso runtime** che serviva
//! l'IDE. La correzione di allora spense l'autenticazione sull'IDE del tutto, con un prezzo
//! dichiarato: «un IDE raggiungibile in rete non ha più password» (Q56). Questo crate è il modo
//! di pagare quel debito senza rifare la confusione: due archivi, due scopi.
//!
//! Lo dice anche la decisione 22 del piano identità: account cloud e account d'impianto separati.
//!
//! # Scelte, con il loro motivo
//!
//! - **SQLite e non YAML.** Gli utenti del progetto sono pochi e si leggono tutti insieme; qui
//!   servono ricerche per email, conteggi per le quote (decisione 23) e — soprattutto — scritture
//!   da **più processi**: il gateway e i container dei progetti condividono lo stesso archivio.
//!   Un file YAML riscritto per intero da due processi si perde pezzi. `rusqlite` è già una
//!   dipendenza del workspace (lo usa lo storico), quindi non se ne aggiungono.
//! - **Le sessioni sono persistite**, al contrario di `sws-auth` che le tiene in RAM. Dietro un
//!   gateway che avvia e ferma container, una sessione che muore al riavvio del processo
//!   significa buttare fuori l'utente ogni volta che la piattaforma si muove.
//! - **Il token non è salvato in chiaro**: nel database va il suo SHA-256. Se il file finisce
//!   nelle mani sbagliate — una copia di sicurezza, un disco dismesso — non contiene sessioni
//!   utilizzabili. È la stessa ragione per cui le password non si salvano in chiaro, applicata a
//!   una credenziale che vale quanto una password finché non scade.
//! - **L'identità è l'email** (decisione 19): serve per la verifica dell'indirizzo, il recupero
//!   password e gli inviti, che arrivano in Fase 5.
//! - **Il limite ai tentativi resta in memoria.** È per sua natura effimero: un riavvio azzera il
//!   blocco, come in `sws-auth`. Persisterlo darebbe a chi prova password un modo di bloccare un
//!   utente vero in modo duraturo.
//!
//! # Fuori perimetro, per ora
//!
//! Aziende, appartenenze e quote (Fase 3), TOTP e verifica dell'indirizzo (Fase 5). Lo schema
//! lascia il posto a `totp_segreto` perché aggiungere una colonna a una tabella già popolata è
//! più scomodo che prevederla, ma qui nessuno la legge.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::task;
use tracing::{info, warn};

/// Ruolo di un utente dell'installazione.
///
/// Ordinato dal più debole al più forte, così `>=` confronta correttamente — stessa convenzione
/// di `sws_auth::Role`, e per la stessa ragione: i controlli di permesso si scrivono una volta.
///
/// Sono **due** e non quattro perché la decisione 18 ne prevede due per l'azienda
/// (amministratore e sviluppatore). Il terzo, l'amministratore di piattaforma che approva le
/// aziende (decisione 17), arriva con le aziende stesse in Fase 3: aggiungerlo ora vorrebbe dire
/// inventare adesso cosa può fare, e si deciderebbe per inerzia.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Ruolo {
    Sviluppatore,
    Amministratore,
}

impl Ruolo {
    pub fn come_testo(self) -> &'static str {
        match self {
            Ruolo::Sviluppatore => "sviluppatore",
            Ruolo::Amministratore => "amministratore",
        }
    }

    fn da_testo(s: &str) -> anyhow::Result<Self> {
        match s {
            "sviluppatore" => Ok(Ruolo::Sviluppatore),
            "amministratore" => Ok(Ruolo::Amministratore),
            altro => Err(anyhow::anyhow!("ruolo sconosciuto nel database: {altro}")),
        }
    }
}

/// Stato di un'azienda nel suo percorso di approvazione (decisione 17): chi si
/// registra prova l'editor con quote piccole, e i pannelli si abbinano solo ad
/// azienda approvata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatoAzienda {
    InProva,
    Approvata,
    Sospesa,
}

impl StatoAzienda {
    pub fn come_testo(self) -> &'static str {
        match self {
            StatoAzienda::InProva => "in_prova",
            StatoAzienda::Approvata => "approvata",
            StatoAzienda::Sospesa => "sospesa",
        }
    }
    fn da_testo(s: &str) -> Self {
        match s {
            "approvata" => StatoAzienda::Approvata,
            "sospesa" => StatoAzienda::Sospesa,
            // Nel dubbio la meno potente: uno stato illeggibile non deve
            // promuovere un'azienda ad approvata.
            _ => StatoAzienda::InProva,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Azienda {
    pub id: i64,
    pub nome: String,
    pub stato: StatoAzienda,
    pub marchio: Option<String>,
    /// Predefinita per i progetti **nuovi**, e tetto massimo — non la versione
    /// con cui si apre un progetto, che e del progetto (decisione 44). Vedi il
    /// commento nello schema: **non ha ancora effetto**.
    pub versione_predefinita: Option<String>,
    pub implicita: bool,
    pub max_progetti: Option<i64>,
    pub max_pannelli: Option<i64>,
    pub max_byte: Option<i64>,
    pub creata_ms: u64,
}

/// Distingue «campo assente» da «campo a `null`».
///
/// Serve perche serde, per un `Option<Option<T>>`, legge `null` come `None` —
/// cioe come se il campo non ci fosse — e cosi la differenza fra «non
/// toccare» e «metti a vuoto» sparisce proprio dove conta: una PATCH che
/// manda solo lo stato non deve cancellare il marchio, e una che manda
/// `marchio: null` deve cancellarlo.
fn doppia_opzione<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(d).map(Some)
}

/// Quello che si puo cambiare di un'azienda dalla console.
///
/// Campo **assente** = non toccare. Campo a **`null`** = metti a vuoto. Due
/// cose diverse, e per tenerle diverse serve `doppia_opzione` qui sopra.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModificaAzienda {
    #[serde(default)]
    pub nome: Option<String>,
    #[serde(default)]
    pub stato: Option<StatoAzienda>,
    #[serde(default, deserialize_with = "doppia_opzione")]
    pub marchio: Option<Option<String>>,
    #[serde(default, deserialize_with = "doppia_opzione")]
    pub versione_predefinita: Option<Option<String>>,
    #[serde(default, deserialize_with = "doppia_opzione")]
    pub max_progetti: Option<Option<i64>>,
    #[serde(default, deserialize_with = "doppia_opzione")]
    pub max_pannelli: Option<Option<i64>>,
    #[serde(default, deserialize_with = "doppia_opzione")]
    pub max_byte: Option<Option<i64>>,
}

/// Un utente, senza la sua password. Il tipo pubblico non porta l'hash: così non può finire in
/// una risposta HTTP per distrazione.
#[derive(Debug, Clone, Serialize)]
pub struct Utente {
    pub id: i64,
    pub email: String,
    pub nome: String,
    pub ruolo: Ruolo,
    pub attivo: bool,
    pub deve_cambiare_password: bool,
    /// Chi approva le aziende (decisione 17). **Asse diverso** dal ruolo in
    /// azienda, non un grado piu alto: un amministratore d'azienda non deve
    /// poter approvare se stesso.
    pub amministratore_piattaforma: bool,
    pub creato_ms: u64,
}

/// Esito di un accesso riuscito.
#[derive(Debug, Clone, Serialize)]
pub struct Accesso {
    pub token: String,
    pub utente: Utente,
    pub scade_ms: u64,
}

/// Perché un accesso è stato rifiutato.
///
/// `Bloccato` è distinto da `CredenzialiErrate` perché il chiamante deve rispondere 429 con
/// `Retry-After` e non 401: un client che riprova a oltranza contro un 401 peggiora il blocco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rifiuto {
    CredenzialiErrate,
    Bloccato { riprova_fra: Duration },
    UtenteDisattivato,
}

impl std::fmt::Display for Rifiuto {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Rifiuto::CredenzialiErrate => write!(f, "credenziali errate"),
            Rifiuto::Bloccato { riprova_fra } => {
                write!(f, "troppi tentativi, riprova fra {}s", riprova_fra.as_secs())
            }
            Rifiuto::UtenteDisattivato => write!(f, "utente disattivato"),
        }
    }
}

/// Quante volte si può sbagliare, e per quanto si resta fuori.
const TENTATIVI_MAX: u32 = 5;
const FINESTRA: Duration = Duration::from_secs(300);
/// Durata di una sessione. Scorre a ogni uso (vedi [`Identita::valida`]).
const DURATA_SESSIONE: Duration = Duration::from_secs(8 * 3600);

#[derive(Debug, Clone, Copy)]
struct Fallimenti {
    inizio: Instant,
    quanti: u32,
    bloccato_fino: Option<Instant>,
}

/// L'archivio delle identità dell'installazione.
///
/// Si clona a buon mercato (`Arc` dentro) e si condivide fra i gestori delle rotte.
#[derive(Clone)]
pub struct Identita {
    conn: Arc<Mutex<Connection>>,
    /// Effimero di proposito: vedi la nota in testa al modulo.
    fallimenti: Arc<Mutex<HashMap<String, Fallimenti>>>,
    percorso: PathBuf,
}

fn ora_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// L'impronta di un token. Nel database non finisce mai il token in chiaro.
fn impronta(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    format!("{:x}", h.finalize())
}

pub fn cifra_password(password: &str) -> anyhow::Result<String> {
    let sale = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &sale)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hash password: {e}"))
}

/// Un hash malformato vale «non combacia», non un errore: un record corrotto non deve far
/// passare nessuno, ma nemmeno rompere l'accesso di tutti gli altri.
pub fn verifica_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(h) => Argon2::default()
            .verify_password(password.as_bytes(), &h)
            .is_ok(),
        Err(_) => false,
    }
}

/// C'e gia la colonna che questo `ALTER TABLE` aggiungerebbe?
///
/// SQLite non ha `ADD COLUMN IF NOT EXISTS`, e tentare e ignorare l'errore
/// nasconderebbe anche gli errori veri. Si guarda invece l'elenco delle
/// colonne, che e una domanda diretta con una risposta chiara.
fn colonna_presente(conn: &Connection, tabella: &str, sql_alter: &str) -> bool {
    let Some(nome) = sql_alter.split("ADD COLUMN ").nth(1).and_then(|r| r.split(' ').next()) else {
        return true; // non so cosa aggiungere: meglio non provarci
    };
    let mut q = match conn.prepare(&format!("PRAGMA table_info({tabella})")) {
        Ok(q) => q,
        Err(_) => return true,
    };
    let trovata = q
        .query_map([], |r| r.get::<_, String>(1))
        .map(|righe| righe.flatten().any(|c| c == nome))
        .unwrap_or(true);
    trovata
}

/// Lo schema. `user_version` di SQLite fa da numero di revisione: una migrazione futura guarda
/// quello e sa da dove partire, senza doverlo indovinare dalle tabelle presenti.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS utenti (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    email                  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    nome                   TEXT    NOT NULL DEFAULT '',
    hash_password          TEXT    NOT NULL,
    ruolo                  TEXT    NOT NULL,
    attivo                 INTEGER NOT NULL DEFAULT 1,
    deve_cambiare_password INTEGER NOT NULL DEFAULT 0,
    totp_segreto           TEXT,
    totp_attivo            INTEGER NOT NULL DEFAULT 0,
    creato_ms              INTEGER NOT NULL,
    aggiornato_ms          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessioni (
    impronta_token TEXT    PRIMARY KEY,
    utente_id      INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
    creata_ms      INTEGER NOT NULL,
    scade_ms       INTEGER NOT NULL,
    ultimo_uso_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessioni_utente ON sessioni(utente_id);

-- ── Aziende (schema 2, 06-10-2026) ──────────────────────────────────────────
--
-- Le aziende esistono SEMPRE, anche su un'installazione singola, che ne ha una
-- sola e `implicita = 1` e non la mostra mai. Una forma sola di sistema invece
-- di due: e il vincolo della decisione 27 — il cloud e un modo di far girare
-- l'IDE, non un prodotto diverso — e significa un percorso solo da provare.
CREATE TABLE IF NOT EXISTS aziende (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    nome             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    stato            TEXT    NOT NULL DEFAULT 'in_prova',
    -- Id di un marchio del catalogo (decisione 43). NULL = quello predefinito.
    marchio          TEXT,
    -- Versione dell'immagine PREDEFINITA per i progetti nuovi di questa
    -- azienda, e tetto massimo. NON e la versione con cui si apre un progetto:
    -- quella e del PROGETTO (decisione 44, 06-10-2026).
    --
    -- Perche: un'azienda con decine di pannelli non li ha tutti aggiornati, e
    -- l'unita che si deploya su un parco di pannelli e il progetto, non
    -- l'azienda. Il dato per progetto esiste gia e non va inventato: e
    -- `saved_by` in project.yaml, che `stamp_and_serialize` scrive a ogni
    -- salvataggio (sws-core/src/project.rs:1956) e su cui `needs_update()` si
    -- basa gia oggi.
    --
    -- NON HA ANCORA EFFETTO: nessuno avvia container per versione finche non
    -- c'e il gateway (Fase 4). E qui perche aggiungere una colonna a una
    -- tabella popolata e piu scomodo che prevederla — ma un campo inerte che
    -- sembra funzionare e peggio di uno assente, quindi la console DEVE dirlo
    -- a schermo.
    versione_predefinita TEXT,
    implicita        INTEGER NOT NULL DEFAULT 0,
    -- Quote (decisione 23). Anche queste senza effetto in 3a: le colonne ci
    -- sono, il conteggio arriva con la 3b.
    max_progetti     INTEGER,
    max_pannelli     INTEGER,
    max_byte         INTEGER,
    creata_ms        INTEGER NOT NULL,
    aggiornata_ms    INTEGER NOT NULL
);

-- Chi sta in quale azienda, e con che ruolo (decisione 18).
CREATE TABLE IF NOT EXISTS membri (
    azienda_id INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    utente_id  INTEGER NOT NULL REFERENCES utenti(id)  ON DELETE CASCADE,
    ruolo      TEXT    NOT NULL,
    PRIMARY KEY (azienda_id, utente_id)
);

CREATE INDEX IF NOT EXISTS idx_membri_utente ON membri(utente_id);
"#;

/// `amministratore_piattaforma` arriva con lo schema 2 su una tabella che puo
/// gia esistere, quindi va aggiunta a parte: `CREATE TABLE IF NOT EXISTS` non
/// tocca una tabella presente.
///
/// E un asse **diverso** dal ruolo in azienda, non un grado piu alto: chi
/// approva le aziende (decisione 17) fa un altro mestiere rispetto a chi
/// amministra la propria. Un amministratore d'azienda non deve poter approvare
/// se stesso.
const COLONNE_V2: &[(&str, &str)] = &[(
    "utenti",
    "ALTER TABLE utenti ADD COLUMN amministratore_piattaforma INTEGER NOT NULL DEFAULT 0",
)];

impl Identita {
    /// Apre (o crea) l'archivio in `percorso`, di solito `<config_dir>/identita.db`.
    pub async fn apri(percorso: impl AsRef<Path>) -> anyhow::Result<Self> {
        let percorso = percorso.as_ref().to_path_buf();
        let p = percorso.clone();
        let conn = task::spawn_blocking(move || -> anyhow::Result<Connection> {
            if let Some(dir) = p.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let conn = Connection::open(&p)?;
            // WAL: il gateway e i container dei progetti leggono lo stesso file insieme, e senza
            // questo un lettore blocca uno scrittore.
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            conn.execute_batch(SCHEMA)?;
            // Colonne aggiunte a tabelle che possono gia esistere. Un errore
            // qui vuol dire quasi sempre «c'e gia», e in quel caso si tira
            // dritto: non esiste un `ADD COLUMN IF NOT EXISTS` in SQLite.
            for (tabella, sql) in COLONNE_V2 {
                if !colonna_presente(&conn, tabella, sql) {
                    conn.execute(sql, [])?;
                }
            }
            conn.pragma_update(None, "user_version", 2)?;
            // Il file contiene hash di password e sessioni: non deve essere leggibile da altri.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
            }
            Ok(conn)
        })
        .await??;
        info!(percorso = %percorso.display(), "archivio identità aperto");
        let id = Self {
            conn: Arc::new(Mutex::new(conn)),
            fallimenti: Arc::new(Mutex::new(HashMap::new())),
            percorso,
        };
        id.assicura_azienda_implicita().await?;
        id.assicura_amministratore_piattaforma().await?;
        Ok(id)
    }

    pub fn percorso(&self) -> &Path {
        &self.percorso
    }

    /// Vero se esiste almeno un utente. È la domanda su cui si decide se mostrare la schermata
    /// del **primo accesso** invece di quella di login.
    pub async fn ha_utenti(&self) -> anyhow::Result<bool> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<bool> {
            let c = conn.lock().unwrap();
            let n: i64 = c.query_row("SELECT COUNT(*) FROM utenti", [], |r| r.get(0))?;
            Ok(n > 0)
        })
        .await?
    }

    pub async fn crea_utente(
        &self,
        email: &str,
        nome: &str,
        password: &str,
        ruolo: Ruolo,
        deve_cambiare_password: bool,
    ) -> anyhow::Result<Utente> {
        let email_pulita = email.trim().to_string();
        if email_pulita.is_empty() || !email_pulita.contains('@') {
            anyhow::bail!("email non valida: «{email}»");
        }
        if password.len() < 8 {
            anyhow::bail!("la password deve essere di almeno 8 caratteri");
        }
        let hash = cifra_password(password)?;
        let nome = nome.trim().to_string();
        let conn = self.conn.clone();
        let utente = task::spawn_blocking(move || -> anyhow::Result<Utente> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms();
            // Il PRIMO utente di un'installazione e anche l'amministratore di
            // piattaforma: e chi ha appena dimostrato di avere accesso alla
            // macchina, e senza di lui non ci sarebbe nessuno a approvare le
            // aziende. Dal secondo in poi lo si assegna a mano dalla console.
            let primo: i64 = c
                .query_row("SELECT COUNT(*) FROM utenti", [], |r| r.get(0))
                .unwrap_or(1);
            let piattaforma = primo == 0;
            c.execute(
                "INSERT INTO utenti (email, nome, hash_password, ruolo, attivo,
                                     deve_cambiare_password, amministratore_piattaforma,
                                     creato_ms, aggiornato_ms)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?7)",
                params![
                    email_pulita,
                    nome,
                    hash,
                    ruolo.come_testo(),
                    deve_cambiare_password as i64,
                    piattaforma as i64,
                    adesso as i64
                ],
            )
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(f, _)
                    if f.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    anyhow::anyhow!("esiste già un utente con l'indirizzo «{email_pulita}»")
                }
                altro => anyhow::anyhow!("creazione utente: {altro}"),
            })?;
            Ok(Utente {
                id: c.last_insert_rowid(),
                email: email_pulita,
                nome,
                ruolo,
                attivo: true,
                deve_cambiare_password,
                amministratore_piattaforma: piattaforma,
                creato_ms: adesso,
            })
        })
        .await??;
        info!(email = %utente.email, ruolo = utente.ruolo.come_testo(), "utente creato");
        Ok(utente)
    }

    /// Verifica le credenziali e apre una sessione.
    ///
    /// Il limite ai tentativi è **per email**, non per indirizzo IP: dietro un gateway tutti gli
    /// utenti condividono l'indirizzo, e bloccare quello chiuderebbe fuori anche gli innocenti.
    pub async fn accedi(&self, email: &str, password: &str) -> Result<Accesso, Rifiuto> {
        let chiave = email.trim().to_lowercase();

        if let Some(attesa) = self.blocco_residuo(&chiave) {
            return Err(Rifiuto::Bloccato { riprova_fra: attesa });
        }

        let conn = self.conn.clone();
        let chiave_sql = chiave.clone();
        let trovato = task::spawn_blocking(
            move || -> Option<(i64, String, String, String, bool, bool, bool, u64)> {
                let c = conn.lock().unwrap();
                c.query_row(
                    "SELECT id, email, nome, hash_password, attivo, deve_cambiare_password,
                            amministratore_piattaforma, creato_ms
                     FROM utenti WHERE email = ?1",
                    params![chiave_sql],
                    |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, i64>(4)? != 0,
                            r.get::<_, i64>(5)? != 0,
                            r.get::<_, i64>(6)? != 0,
                            r.get::<_, i64>(7)? as u64,
                        ))
                    },
                )
                .optional()
                .ok()
                .flatten()
            },
        )
        .await
        .ok()
        .flatten();

        // Un utente inesistente e una password sbagliata danno la stessa risposta: dire «questo
        // indirizzo non esiste» regalerebbe a chi prova l'elenco degli iscritti.
        let Some((id, email_vera, nome, hash, attivo, deve_cambiare, piattaforma, creato_ms)) =
            trovato
        else {
            self.segna_fallimento(&chiave);
            return Err(Rifiuto::CredenzialiErrate);
        };
        let ruolo = self.ruolo_di(id).await.unwrap_or(Ruolo::Sviluppatore);

        if !verifica_password(password, &hash) {
            self.segna_fallimento(&chiave);
            return Err(Rifiuto::CredenzialiErrate);
        }
        if !attivo {
            return Err(Rifiuto::UtenteDisattivato);
        }

        self.fallimenti.lock().unwrap().remove(&chiave);

        let token = uuid::Uuid::new_v4().to_string();
        let scade_ms = ora_ms() + DURATA_SESSIONE.as_millis() as u64;
        let imp = impronta(&token);
        let conn = self.conn.clone();
        let _ = task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms();
            c.execute(
                "INSERT INTO sessioni (impronta_token, utente_id, creata_ms, scade_ms, ultimo_uso_ms)
                 VALUES (?1, ?2, ?3, ?4, ?3)",
                params![imp, id, adesso as i64, scade_ms as i64],
            )?;
            // Pulizia opportunistica: le sessioni scadute non servono a nessuno e il momento in
            // cui se ne crea una è quello giusto per toglierle, senza un lavoro periodico in più.
            let _ = c.execute("DELETE FROM sessioni WHERE scade_ms < ?1", params![adesso as i64]);
            Ok(())
        })
        .await;

        info!(email = %email_vera, "accesso riuscito");
        Ok(Accesso {
            token,
            utente: Utente {
                id,
                email: email_vera,
                nome,
                ruolo,
                attivo,
                deve_cambiare_password: deve_cambiare,
                amministratore_piattaforma: piattaforma,
                creato_ms,
            },
            scade_ms,
        })
    }

    async fn ruolo_di(&self, id: i64) -> anyhow::Result<Ruolo> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Ruolo> {
            let c = conn.lock().unwrap();
            let s: String =
                c.query_row("SELECT ruolo FROM utenti WHERE id = ?1", params![id], |r| r.get(0))?;
            Ruolo::da_testo(&s)
        })
        .await?
    }

    /// Valida un token e **fa scorrere** la scadenza.
    ///
    /// Lo scorrimento è deliberato: chi sta lavorando non deve essere buttato fuori a metà di una
    /// modifica solo perché sono passate otto ore dall'accesso. Chi ha smesso, invece, scade.
    pub async fn valida(&self, token: &str) -> Option<Utente> {
        let imp = impronta(token);
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> Option<Utente> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms();
            let riga = c
                .query_row(
                    "SELECT u.id, u.email, u.nome, u.ruolo, u.attivo, u.deve_cambiare_password,
                            u.creato_ms, s.scade_ms, u.amministratore_piattaforma
                     FROM sessioni s JOIN utenti u ON u.id = s.utente_id
                     WHERE s.impronta_token = ?1",
                    params![imp],
                    |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, i64>(4)? != 0,
                            r.get::<_, i64>(5)? != 0,
                            r.get::<_, i64>(6)? as u64,
                            r.get::<_, i64>(7)? as u64,
                            r.get::<_, i64>(8)? != 0,
                        ))
                    },
                )
                .optional()
                .ok()
                .flatten()?;

            let (id, email, nome, ruolo, attivo, deve_cambiare, creato_ms, scade_ms, piattaforma) =
                riga;
            if scade_ms <= adesso {
                let _ = c.execute("DELETE FROM sessioni WHERE impronta_token = ?1", params![imp]);
                return None;
            }
            // Un utente disattivato perde la sessione subito, senza aspettarne la scadenza:
            // altrimenti una revoca non arriverebbe a destinazione per ore.
            if !attivo {
                let _ = c.execute("DELETE FROM sessioni WHERE impronta_token = ?1", params![imp]);
                return None;
            }
            let nuova_scadenza = adesso + DURATA_SESSIONE.as_millis() as u64;
            let _ = c.execute(
                "UPDATE sessioni SET ultimo_uso_ms = ?1, scade_ms = ?2 WHERE impronta_token = ?3",
                params![adesso as i64, nuova_scadenza as i64, imp],
            );
            Some(Utente {
                id,
                email,
                nome,
                ruolo: Ruolo::da_testo(&ruolo).unwrap_or(Ruolo::Sviluppatore),
                attivo,
                deve_cambiare_password: deve_cambiare,
                amministratore_piattaforma: piattaforma,
                creato_ms,
            })
        })
        .await
        .ok()
        .flatten()
    }

    pub async fn esci(&self, token: &str) -> anyhow::Result<()> {
        let imp = impronta(token);
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute("DELETE FROM sessioni WHERE impronta_token = ?1", params![imp])?;
            Ok(())
        })
        .await?
    }

    pub async fn elenca(&self) -> anyhow::Result<Vec<Utente>> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<Utente>> {
            let c = conn.lock().unwrap();
            let mut q = c.prepare(
                "SELECT id, email, nome, ruolo, attivo, deve_cambiare_password, creato_ms,
                        amministratore_piattaforma
                 FROM utenti ORDER BY email",
            )?;
            let righe = q
                .query_map([], |r| {
                    Ok(Utente {
                        id: r.get(0)?,
                        email: r.get(1)?,
                        nome: r.get(2)?,
                        ruolo: Ruolo::da_testo(&r.get::<_, String>(3)?)
                            .unwrap_or(Ruolo::Sviluppatore),
                        attivo: r.get::<_, i64>(4)? != 0,
                        deve_cambiare_password: r.get::<_, i64>(5)? != 0,
                        creato_ms: r.get::<_, i64>(6)? as u64,
                        amministratore_piattaforma: r.get::<_, i64>(7)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(righe)
        })
        .await?
    }

    /// Cambia la password e **chiude tutte le sessioni** di quell'utente.
    ///
    /// Non è zelo: se la password è stata cambiata perché si temeva fosse nota a qualcun altro,
    /// lasciare vive le sessioni aperte rende il cambio inutile — chi era dentro resta dentro.
    pub async fn cambia_password(&self, utente_id: i64, nuova: &str) -> anyhow::Result<()> {
        if nuova.len() < 8 {
            anyhow::bail!("la password deve essere di almeno 8 caratteri");
        }
        let hash = cifra_password(nuova)?;
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            let n = c.execute(
                "UPDATE utenti SET hash_password = ?1, deve_cambiare_password = 0,
                                   aggiornato_ms = ?2 WHERE id = ?3",
                params![hash, ora_ms() as i64, utente_id],
            )?;
            if n == 0 {
                anyhow::bail!("nessun utente con id {utente_id}");
            }
            c.execute("DELETE FROM sessioni WHERE utente_id = ?1", params![utente_id])?;
            Ok(())
        })
        .await?
    }

    /// Disattiva un utente: non può più accedere e le sue sessioni cadono subito.
    ///
    /// Si disattiva invece di cancellare perché l'identità è citata dal registro di audit: un id
    /// che sparisce rende illeggibile la storia di chi ha fatto cosa.
    pub async fn disattiva(&self, utente_id: i64) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "UPDATE utenti SET attivo = 0, aggiornato_ms = ?1 WHERE id = ?2",
                params![ora_ms() as i64, utente_id],
            )?;
            c.execute("DELETE FROM sessioni WHERE utente_id = ?1", params![utente_id])?;
            Ok(())
        })
        .await?
    }

    // ── Aziende ──────────────────────────────────────────────────────────────

    /// L'azienda implicita, creata da se la prima volta che serve.
    ///
    /// Le aziende esistono **sempre**: un'installazione singola ne ha una sola,
    /// mai mostrata (vedi lo schema). Questa funzione la crea quando ci sono
    /// utenti e nessuna azienda, e **vi iscrive tutti gli utenti esistenti**.
    ///
    /// Non e un caso di scuola: l'installazione di sviluppo ha gia un
    /// amministratore creato in Fase 1 e nessuna azienda, quindi il primo
    /// archivio ad attraversare questa migrazione e uno vero.
    pub async fn assicura_azienda_implicita(&self) -> anyhow::Result<Option<i64>> {
        let conn = self.conn.clone();
        let creata = task::spawn_blocking(move || -> anyhow::Result<Option<i64>> {
            let c = conn.lock().unwrap();
            let aziende: i64 = c.query_row("SELECT COUNT(*) FROM aziende", [], |r| r.get(0))?;
            if aziende > 0 {
                return Ok(None);
            }
            let utenti: i64 = c.query_row("SELECT COUNT(*) FROM utenti", [], |r| r.get(0))?;
            if utenti == 0 {
                // Installazione vergine: l'azienda nascera col primo utente,
                // cosi un archivio vuoto resta vuoto.
                return Ok(None);
            }
            let adesso = ora_ms();
            c.execute(
                "INSERT INTO aziende (nome, stato, implicita, creata_ms, aggiornata_ms)
                 VALUES (?1, 'approvata', 1, ?2, ?2)",
                params!["Questa installazione", adesso as i64],
            )?;
            let id = c.last_insert_rowid();
            // Tutti dentro, con il ruolo che gia hanno: chi era amministratore
            // dell'installazione lo e dell'azienda.
            c.execute(
                "INSERT OR IGNORE INTO membri (azienda_id, utente_id, ruolo)
                 SELECT ?1, id, ruolo FROM utenti",
                params![id],
            )?;
            Ok(Some(id))
        })
        .await??;
        if let Some(id) = creata {
            info!(azienda = id, "azienda implicita creata e popolata con gli utenti esistenti");
        }
        Ok(creata)
    }

    /// Un'installazione non puo restare senza nessuno che possa amministrarla.
    ///
    /// **Perche serve, con il caso vero che l'ha rivelata**: la colonna
    /// `amministratore_piattaforma` e nata con lo schema 2, con valore 0 di
    /// default, e la regola «il primo utente lo e» vale solo alla creazione.
    /// Un'installazione che aveva gia utenti — come quella di sviluppo dopo la
    /// Fase 1 — si e quindi ritrovata con una console che **nessuno poteva
    /// aprire**: non un errore, una porta murata.
    ///
    /// Qui si ripara: se nessun utente attivo ha quel ruolo, lo prende il piu
    /// vecchio fra gli amministratori, o il piu vecchio in assoluto se nessuno
    /// lo e. La scelta del piu vecchio non e arbitraria: su
    /// un'installazione singola e chi l'ha creata col codice di primo accesso.
    pub async fn assicura_amministratore_piattaforma(&self) -> anyhow::Result<Option<String>> {
        let conn = self.conn.clone();
        let promosso = task::spawn_blocking(move || -> anyhow::Result<Option<String>> {
            let c = conn.lock().unwrap();
            let quanti: i64 = c.query_row(
                "SELECT COUNT(*) FROM utenti WHERE amministratore_piattaforma = 1 AND attivo = 1",
                [],
                |r| r.get(0),
            )?;
            if quanti > 0 {
                return Ok(None);
            }
            // Prima gli amministratori, poi chiunque: in ordine di anzianita.
            let scelto: Option<(i64, String)> = c
                .query_row(
                    "SELECT id, email FROM utenti WHERE attivo = 1
                     ORDER BY (ruolo = 'amministratore') DESC, id ASC LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let Some((id, email)) = scelto else {
                return Ok(None); // nessun utente: niente da riparare
            };
            c.execute(
                "UPDATE utenti SET amministratore_piattaforma = 1, aggiornato_ms = ?1 WHERE id = ?2",
                params![ora_ms() as i64, id],
            )?;
            Ok(Some(email))
        })
        .await??;
        if let Some(ref email) = promosso {
            warn!(
                utente = %email,
                "nessun amministratore di piattaforma: promosso d'ufficio, \
                 altrimenti la console non sarebbe apribile da nessuno"
            );
        }
        Ok(promosso)
    }

    pub async fn crea_azienda(&self, nome: &str) -> anyhow::Result<Azienda> {
        let nome = nome.trim().to_string();
        if nome.is_empty() {
            anyhow::bail!("il nome dell'azienda non puo essere vuoto");
        }
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Azienda> {
            let c = conn.lock().unwrap();
            let adesso = ora_ms();
            c.execute(
                "INSERT INTO aziende (nome, stato, implicita, creata_ms, aggiornata_ms)
                 VALUES (?1, 'in_prova', 0, ?2, ?2)",
                params![nome, adesso as i64],
            )
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(f, _)
                    if f.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    anyhow::anyhow!("esiste gia un'azienda di nome «{nome}»")
                }
                altro => anyhow::anyhow!("creazione azienda: {altro}"),
            })?;
            Ok(Azienda {
                id: c.last_insert_rowid(),
                nome,
                stato: StatoAzienda::InProva,
                marchio: None,
                versione_predefinita: None,
                implicita: false,
                max_progetti: None,
                max_pannelli: None,
                max_byte: None,
                creata_ms: adesso,
            })
        })
        .await?
    }

    pub async fn elenca_aziende(&self) -> anyhow::Result<Vec<Azienda>> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<Azienda>> {
            let c = conn.lock().unwrap();
            let mut q = c.prepare(
                "SELECT id, nome, stato, marchio, versione_predefinita, implicita,
                        max_progetti, max_pannelli, max_byte, creata_ms
                 FROM aziende ORDER BY implicita DESC, nome",
            )?;
            let righe = q
                .query_map([], |r| {
                    Ok(Azienda {
                        id: r.get(0)?,
                        nome: r.get(1)?,
                        stato: StatoAzienda::da_testo(&r.get::<_, String>(2)?),
                        marchio: r.get(3)?,
                        versione_predefinita: r.get(4)?,
                        implicita: r.get::<_, i64>(5)? != 0,
                        max_progetti: r.get(6)?,
                        max_pannelli: r.get(7)?,
                        max_byte: r.get(8)?,
                        creata_ms: r.get::<_, i64>(9)? as u64,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(righe)
        })
        .await?
    }

    /// Cambia un'azienda. I campi `None` restano come sono; per svuotare un
    /// campo nullable si passa `Some(None)` — la distinzione fra «non toccare»
    /// e «metti a vuoto» non si puo esprimere con un `Option` solo.
    pub async fn aggiorna_azienda(&self, id: i64, m: ModificaAzienda) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            let implicita: i64 = c
                .query_row("SELECT implicita FROM aziende WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .map_err(|_| anyhow::anyhow!("nessuna azienda con id {id}"))?;
            if implicita != 0 && m.nome.is_some() {
                // Rinominarla non serve a nessuno: non si vede da nessuna parte.
                anyhow::bail!("l'azienda implicita non si rinomina");
            }
            if let Some(v) = m.nome {
                c.execute("UPDATE aziende SET nome = ?1 WHERE id = ?2", params![v, id])?;
            }
            if let Some(v) = m.stato {
                c.execute(
                    "UPDATE aziende SET stato = ?1 WHERE id = ?2",
                    params![v.come_testo(), id],
                )?;
            }
            if let Some(v) = m.marchio {
                c.execute("UPDATE aziende SET marchio = ?1 WHERE id = ?2", params![v, id])?;
            }
            if let Some(v) = m.versione_predefinita {
                c.execute(
                    "UPDATE aziende SET versione_predefinita = ?1 WHERE id = ?2",
                    params![v, id],
                )?;
            }
            for (campo, valore) in [
                ("max_progetti", m.max_progetti),
                ("max_pannelli", m.max_pannelli),
                ("max_byte", m.max_byte),
            ] {
                if let Some(v) = valore {
                    c.execute(
                        &format!("UPDATE aziende SET {campo} = ?1 WHERE id = ?2"),
                        params![v, id],
                    )?;
                }
            }
            c.execute(
                "UPDATE aziende SET aggiornata_ms = ?1 WHERE id = ?2",
                params![ora_ms() as i64, id],
            )?;
            Ok(())
        })
        .await?
    }

    /// Iscrive un utente a un'azienda, o ne cambia il ruolo.
    pub async fn iscrivi(&self, azienda_id: i64, utente_id: i64, ruolo: Ruolo) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "INSERT INTO membri (azienda_id, utente_id, ruolo) VALUES (?1, ?2, ?3)
                 ON CONFLICT(azienda_id, utente_id) DO UPDATE SET ruolo = excluded.ruolo",
                params![azienda_id, utente_id, ruolo.come_testo()],
            )?;
            Ok(())
        })
        .await?
    }

    /// Le aziende di cui un utente fa parte, con il suo ruolo in ciascuna.
    pub async fn aziende_di(&self, utente_id: i64) -> anyhow::Result<Vec<(i64, Ruolo)>> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<(i64, Ruolo)>> {
            let c = conn.lock().unwrap();
            let mut q =
                c.prepare("SELECT azienda_id, ruolo FROM membri WHERE utente_id = ?1")?;
            let righe = q
                .query_map(params![utente_id], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(righe
                .into_iter()
                .map(|(a, r)| (a, Ruolo::da_testo(&r).unwrap_or(Ruolo::Sviluppatore)))
                .collect())
        })
        .await?
    }

    /// Promuove o toglie l'amministratore di piattaforma.
    pub async fn imposta_amministratore_piattaforma(
        &self,
        utente_id: i64,
        valore: bool,
    ) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            if !valore {
                // Non si resta senza nessuno che possa approvare: e la stessa
                // regola per cui `sws-auth` rifiuta di togliere l'ultimo Admin.
                let altri: i64 = c.query_row(
                    "SELECT COUNT(*) FROM utenti
                     WHERE amministratore_piattaforma = 1 AND attivo = 1 AND id != ?1",
                    params![utente_id],
                    |r| r.get(0),
                )?;
                if altri == 0 {
                    anyhow::bail!(
                        "e l'ultimo amministratore di piattaforma: toglierlo lascerebbe \
                         l'installazione senza nessuno che possa approvare le aziende"
                    );
                }
            }
            c.execute(
                "UPDATE utenti SET amministratore_piattaforma = ?1, aggiornato_ms = ?2 WHERE id = ?3",
                params![valore as i64, ora_ms() as i64, utente_id],
            )?;
            Ok(())
        })
        .await?
    }

    // ── limite ai tentativi ──────────────────────────────────────────────────

    fn blocco_residuo(&self, chiave: &str) -> Option<Duration> {
        let mappa = self.fallimenti.lock().unwrap();
        let f = mappa.get(chiave)?;
        let fino = f.bloccato_fino?;
        let adesso = Instant::now();
        (fino > adesso).then(|| fino - adesso)
    }

    fn segna_fallimento(&self, chiave: &str) {
        let mut mappa = self.fallimenti.lock().unwrap();
        let adesso = Instant::now();
        let f = mappa.entry(chiave.to_string()).or_insert(Fallimenti {
            inizio: adesso,
            quanti: 0,
            bloccato_fino: None,
        });
        if adesso.duration_since(f.inizio) > FINESTRA {
            f.inizio = adesso;
            f.quanti = 0;
            f.bloccato_fino = None;
        }
        f.quanti += 1;
        if f.quanti >= TENTATIVI_MAX {
            f.bloccato_fino = Some(adesso + FINESTRA);
            warn!(utente = %chiave, "troppi tentativi di accesso: bloccato");
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    async fn archivio() -> (Identita, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let id = Identita::apri(dir.path().join("identita.db")).await.unwrap();
        (id, dir)
    }

    #[tokio::test]
    async fn archivio_nuovo_non_ha_utenti() {
        let (id, _d) = archivio().await;
        assert!(!id.ha_utenti().await.unwrap());
    }

    #[tokio::test]
    async fn crea_e_accede() {
        let (id, _d) = archivio().await;
        let u = id
            .crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        assert!(id.ha_utenti().await.unwrap());
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        assert_eq!(a.utente.id, u.id);
        assert_eq!(a.utente.ruolo, Ruolo::Amministratore);
        assert!(id.valida(&a.token).await.is_some());
    }

    #[tokio::test]
    async fn email_non_distingue_maiuscole() {
        let (id, _d) = archivio().await;
        id.crea_utente("M@Soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        // Chi si registra con la maiuscola e accede con la minuscola è la stessa persona.
        assert!(id.accedi("m@soligo.net", "unapassword").await.is_ok());
        // E non deve poterne nascere un secondo che sembra diverso.
        let doppio = id
            .crea_utente("m@SOLIGO.NET", "Altro", "unapassword", Ruolo::Sviluppatore, false)
            .await;
        assert!(doppio.is_err(), "due utenti con lo stesso indirizzo");
    }

    #[tokio::test]
    async fn password_sbagliata_e_utente_inesistente_danno_lo_stesso_esito() {
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        assert_eq!(
            id.accedi("m@soligo.net", "sbagliata").await.unwrap_err(),
            Rifiuto::CredenzialiErrate
        );
        assert_eq!(
            id.accedi("nessuno@soligo.net", "unapassword").await.unwrap_err(),
            Rifiuto::CredenzialiErrate
        );
    }

    #[tokio::test]
    async fn il_token_non_e_in_chiaro_nel_database() {
        // Questo test è stato riscritto il 06-10-2026 perché la prima versione non provava
        // nulla: leggeva il solo `identita.db` e, in modalità WAL, la scrittura stava ancora nel
        // registro `-wal`. Il file principale era vuoto, quindi «il token non c'è» passava anche
        // se il token fosse stato salvato in chiaro. Ora si guardano TUTTI i file del database, e
        // si verifica anche il verso positivo: che l'impronta ci sia davvero.
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();

        let base = id.percorso().to_path_buf();
        let mut grezzo = Vec::new();
        for suffisso in ["", "-wal", "-shm"] {
            let p = base.with_file_name(format!(
                "{}{suffisso}",
                base.file_name().unwrap().to_string_lossy()
            ));
            if let Ok(mut b) = std::fs::read(&p) {
                grezzo.append(&mut b);
            }
        }
        let testo = String::from_utf8_lossy(&grezzo);
        assert!(
            !testo.contains(&a.token),
            "il token è finito in chiaro nei file del database"
        );
        assert!(
            testo.contains(&impronta(&a.token)),
            "l'impronta non si trova: il test non sta guardando dove scrive il database"
        );
    }

    #[tokio::test]
    async fn la_sessione_sopravvive_alla_riapertura() {
        // È metà del motivo per cui questo crate non tiene le sessioni in RAM: dietro un gateway
        // che riavvia i container, una sessione in memoria butta fuori l'utente a ogni riavvio.
        let dir = tempfile::tempdir().unwrap();
        let percorso = dir.path().join("identita.db");
        let token = {
            let id = Identita::apri(&percorso).await.unwrap();
            id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
                .await
                .unwrap();
            id.accedi("m@soligo.net", "unapassword").await.unwrap().token
        };
        let id2 = Identita::apri(&percorso).await.unwrap();
        assert!(
            id2.valida(&token).await.is_some(),
            "la sessione non è sopravvissuta alla riapertura dell'archivio"
        );
    }

    #[tokio::test]
    async fn uscire_invalida_il_token() {
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        id.esci(&a.token).await.unwrap();
        assert!(id.valida(&a.token).await.is_none());
    }

    #[tokio::test]
    async fn cambiare_password_chiude_le_sessioni() {
        let (id, _d) = archivio().await;
        let u = id
            .crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        id.cambia_password(u.id, "nuovapassword").await.unwrap();
        assert!(
            id.valida(&a.token).await.is_none(),
            "la sessione aperta con la vecchia password è sopravvissuta al cambio"
        );
        assert!(id.accedi("m@soligo.net", "nuovapassword").await.is_ok());
    }

    #[tokio::test]
    async fn disattivare_butta_fuori_subito() {
        let (id, _d) = archivio().await;
        let u = id
            .crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let a = id.accedi("m@soligo.net", "unapassword").await.unwrap();
        id.disattiva(u.id).await.unwrap();
        assert!(id.valida(&a.token).await.is_none(), "revoca non arrivata");
        assert_eq!(
            id.accedi("m@soligo.net", "unapassword").await.unwrap_err(),
            Rifiuto::UtenteDisattivato
        );
    }

    #[tokio::test]
    async fn troppi_tentativi_bloccano() {
        let (id, _d) = archivio().await;
        id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        for _ in 0..TENTATIVI_MAX {
            let _ = id.accedi("m@soligo.net", "sbagliata").await;
        }
        // Anche con la password GIUSTA: altrimenti il blocco non bloccherebbe nulla.
        match id.accedi("m@soligo.net", "unapassword").await.unwrap_err() {
            Rifiuto::Bloccato { .. } => {}
            altro => panic!("atteso blocco, ottenuto {altro:?}"),
        }
    }

    // ── Aziende ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn un_archivio_vuoto_non_crea_aziende() {
        // Nessun utente, nessuna azienda: un'installazione vergine resta
        // vergine, e l'azienda nasce col primo utente.
        let (id, _d) = archivio().await;
        assert!(id.elenca_aziende().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn il_primo_utente_e_amministratore_di_piattaforma() {
        let (id, _d) = archivio().await;
        let primo = id
            .crea_utente("a@soligo.net", "A", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        assert!(primo.amministratore_piattaforma, "il primo non puo approvare nessuno");
        let secondo = id
            .crea_utente("b@soligo.net", "B", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        assert!(
            !secondo.amministratore_piattaforma,
            "il secondo si promuove a mano, non per nascita"
        );
    }

    #[tokio::test]
    async fn un_archivio_con_utenti_e_senza_aziende_ne_riceve_una_implicita() {
        // È il caso vero dell'installazione di sviluppo, che dopo la Fase 1 ha
        // un amministratore e nessuna azienda: alla riapertura deve trovarsi
        // l'azienda implicita, con dentro gli utenti che già c'erano.
        let dir = tempfile::tempdir().unwrap();
        let percorso = dir.path().join("identita.db");
        {
            let id = Identita::apri(&percorso).await.unwrap();
            id.crea_utente("m@soligo.net", "Mauro", "unapassword", Ruolo::Amministratore, false)
                .await
                .unwrap();
            // Qui l'azienda non c'è ancora: è nata prima dell'utente.
            assert!(id.elenca_aziende().await.unwrap().is_empty());
        }
        let id2 = Identita::apri(&percorso).await.unwrap();
        let aziende = id2.elenca_aziende().await.unwrap();
        assert_eq!(aziende.len(), 1, "manca l'azienda implicita");
        assert!(aziende[0].implicita);
        assert_eq!(aziende[0].stato, StatoAzienda::Approvata);
        let utenti = id2.elenca().await.unwrap();
        let appartenenze = id2.aziende_di(utenti[0].id).await.unwrap();
        assert_eq!(
            appartenenze.len(),
            1,
            "l'utente che c'era già non è stato iscritto all'azienda implicita"
        );
        assert_eq!(appartenenze[0].1, Ruolo::Amministratore, "il ruolo non è stato conservato");
    }

    #[tokio::test]
    async fn l_azienda_implicita_si_crea_una_volta_sola() {
        let dir = tempfile::tempdir().unwrap();
        let percorso = dir.path().join("identita.db");
        {
            let id = Identita::apri(&percorso).await.unwrap();
            id.crea_utente("m@soligo.net", "M", "unapassword", Ruolo::Sviluppatore, false)
                .await
                .unwrap();
        }
        for _ in 0..3 {
            let id = Identita::apri(&percorso).await.unwrap();
            assert_eq!(id.elenca_aziende().await.unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn un_installazione_non_resta_senza_amministratore_di_piattaforma() {
        // Il caso vero del 06-10-2026: l'installazione di sviluppo aveva un
        // utente creato PRIMA che la colonna esistesse, quindi con valore 0 —
        // e la console non era apribile da nessuno. Non un errore: una porta
        // murata, che si scopre solo provando.
        let dir = tempfile::tempdir().unwrap();
        let percorso = dir.path().join("identita.db");
        {
            let id = Identita::apri(&percorso).await.unwrap();
            let u = id
                .crea_utente("m@soligo.net", "M", "unapassword", Ruolo::Amministratore, false)
                .await
                .unwrap();
            // Si simula lo stato di allora: il flag a zero.
            id.imposta_amministratore_piattaforma(u.id, false).await.ok();
            let c = id.conn.lock().unwrap();
            c.execute("UPDATE utenti SET amministratore_piattaforma = 0", []).unwrap();
        }
        let id2 = Identita::apri(&percorso).await.unwrap();
        let utenti = id2.elenca().await.unwrap();
        assert!(
            utenti.iter().any(|u| u.amministratore_piattaforma),
            "riaperto senza nessuno che possa amministrare: console murata"
        );
    }

    #[tokio::test]
    async fn chi_amministra_gia_non_viene_sostituito() {
        let (id, _d) = archivio().await;
        let primo = id
            .crea_utente("a@soligo.net", "A", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        id.crea_utente("b@soligo.net", "B", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        assert!(id.assicura_amministratore_piattaforma().await.unwrap().is_none());
        let utenti = id.elenca().await.unwrap();
        let quanti = utenti.iter().filter(|u| u.amministratore_piattaforma).count();
        assert_eq!(quanti, 1, "promosso qualcuno che non serviva");
        assert!(utenti.iter().find(|u| u.id == primo.id).unwrap().amministratore_piattaforma);
    }

    #[tokio::test]
    async fn due_aziende_non_possono_chiamarsi_uguale() {
        let (id, _d) = archivio().await;
        id.crea_azienda("Acme").await.unwrap();
        assert!(id.crea_azienda("acme").await.is_err(), "nome duplicato accettato");
    }

    #[tokio::test]
    async fn una_azienda_nasce_in_prova_e_si_approva() {
        let (id, _d) = archivio().await;
        let a = id.crea_azienda("Acme").await.unwrap();
        assert_eq!(a.stato, StatoAzienda::InProva, "nasce già approvata");
        id.aggiorna_azienda(
            a.id,
            ModificaAzienda {
                stato: Some(StatoAzienda::Approvata),
                marchio: Some(Some("pixsys".into())),
                versione_predefinita: Some(Some("2.12.0".into())),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let dopo = &id.elenca_aziende().await.unwrap()[0];
        assert_eq!(dopo.stato, StatoAzienda::Approvata);
        assert_eq!(dopo.marchio.as_deref(), Some("pixsys"));
        assert_eq!(dopo.versione_predefinita.as_deref(), Some("2.12.0"));
    }

    #[tokio::test]
    async fn svuotare_un_campo_e_diverso_da_non_toccarlo() {
        let (id, _d) = archivio().await;
        let a = id.crea_azienda("Acme").await.unwrap();
        id.aggiorna_azienda(
            a.id,
            ModificaAzienda { marchio: Some(Some("pixsys".into())), ..Default::default() },
        )
        .await
        .unwrap();
        // `None` non tocca…
        id.aggiorna_azienda(a.id, ModificaAzienda::default()).await.unwrap();
        assert_eq!(id.elenca_aziende().await.unwrap()[0].marchio.as_deref(), Some("pixsys"));
        // …`Some(None)` svuota.
        id.aggiorna_azienda(a.id, ModificaAzienda { marchio: Some(None), ..Default::default() })
            .await
            .unwrap();
        assert!(id.elenca_aziende().await.unwrap()[0].marchio.is_none());
    }

    #[test]
    fn assente_e_null_sono_due_cose_diverse() {
        // È la distinzione su cui si regge ogni PATCH parziale: mandare solo
        // lo stato non deve cancellare il marchio, e mandare `marchio: null`
        // deve cancellarlo. Con il comportamento predefinito di serde per
        // `Option<Option<T>>` le due cose coincidono, e la seconda non si può
        // esprimere affatto.
        let assente: ModificaAzienda = serde_json::from_str(r#"{"stato":"approvata"}"#).unwrap();
        assert!(assente.marchio.is_none(), "un campo assente non deve toccare nulla");

        let vuoto: ModificaAzienda = serde_json::from_str(r#"{"marchio":null}"#).unwrap();
        assert_eq!(vuoto.marchio, Some(None), "`null` deve voler dire «svuota»");

        let pieno: ModificaAzienda = serde_json::from_str(r#"{"marchio":"pixsys"}"#).unwrap();
        assert_eq!(pieno.marchio, Some(Some("pixsys".into())));
    }

    #[tokio::test]
    async fn non_si_resta_senza_amministratori_di_piattaforma() {
        let (id, _d) = archivio().await;
        let primo = id
            .crea_utente("a@soligo.net", "A", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        assert!(
            id.imposta_amministratore_piattaforma(primo.id, false).await.is_err(),
            "tolto l'ultimo: nessuno potrebbe più approvare un'azienda"
        );
        let secondo = id
            .crea_utente("b@soligo.net", "B", "unapassword", Ruolo::Amministratore, false)
            .await
            .unwrap();
        id.imposta_amministratore_piattaforma(secondo.id, true).await.unwrap();
        // Ora che sono due, il primo si può togliere.
        id.imposta_amministratore_piattaforma(primo.id, false).await.unwrap();
    }

    #[tokio::test]
    async fn password_corta_rifiutata() {
        let (id, _d) = archivio().await;
        assert!(id
            .crea_utente("m@soligo.net", "Mauro", "corta", Ruolo::Sviluppatore, false)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn email_senza_chiocciola_rifiutata() {
        let (id, _d) = archivio().await;
        assert!(id
            .crea_utente("mauro", "Mauro", "unapassword", Ruolo::Sviluppatore, false)
            .await
            .is_err());
    }
}
